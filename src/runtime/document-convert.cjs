'use strict';
/**
 * Local document-to-Markdown conversion for Ramo. Node side of the Python
 * ramo-markitdown-worker.py process. No cloud calls, API keys or LLMs.
 * OCRia-nano-1 is installed on first OCR use and runs on CPU through LiteParse.
 *
 * Used by two paths:
 *  - web results: an unsupported fetched type (PDF/DOCX/...) is downloaded to
 *    a temp file and converted; the model sees Markdown, never raw bytes.
 *  - chat attachments: a selected file is converted before it becomes context.
 *
 * The OCR fallback only calls an Ollama already listening on loopback; it never
 * starts a server, and the worker unloads the vision model after use.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CONVERTIBLE_EXT = new Set([
  '.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt',
  '.csv', '.zip', '.epub', '.msg', '.rtf', '.odt', '.ods', '.odp',
  '.wav', '.mp3', '.m4a',
]);
const CONVERTIBLE_MIME = /^(?:application\/(?:pdf|vnd\.openxmlformats-|msword|vnd\.ms-|zip|epub\+zip|vnd\.oasis\.|vnd\.ms-outlook)|audio\/(?:wav|mpeg|mp4))/i;
const MAX_BYTES = 40 * 1024 * 1024;
const DEFAULT_PYTHON = '';

function safeName(name) {
  return String(name || 'document').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'document';
}
function extOf(name, url) {
  let value = String(name || '');
  if (!value && url) { try { value = new URL(url).pathname; } catch (_) { value = ''; } }
  const match = value.toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}
function isConvertibleDocument({ url = '', name = '', contentType = '' } = {}) {
  const ext = extOf(name, url);
  if (ext && CONVERTIBLE_EXT.has(ext)) return true;
  return CONVERTIBLE_MIME.test(String(contentType || ''));
}
function pythonPath(dataDir) {
  if (process.env.RAMO_MARKITDOWN_PYTHON) return process.env.RAMO_MARKITDOWN_PYTHON;
  const local = path.join(String(dataDir || ''), 'documents-venv', process.platform === 'win32'
    ? 'Scripts/python.exe' : 'bin/python');
  if (fs.existsSync(local)) return local;
  return DEFAULT_PYTHON;
}
function workerPath() {
  const candidates = [
    // Packaged app: worker sits in app/, converter in app/work/.
    path.join(__dirname, '..', 'ramo-markitdown-worker.py'),
    // Source tree: converter in src/runtime/, worker in src/native/.
    path.join(__dirname, '..', 'native', 'ramo-markitdown-worker.py'),
    path.join(__dirname, 'ramo-markitdown-worker.py'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}
function contentTypeLooksSupported(contentType) {
  return /^text\//i.test(String(contentType || '')) || /^application\/json/i.test(String(contentType || ''));
}

/** Create a converter. spawnProcess and fetchImpl are injectable for tests. */
function createConverter({ spawnProcess = spawn, fetchImpl = globalThis.fetch, dataDir = '', setupRuntime } = {}) {
  const prepare = setupRuntime || (async (dir, ocr) => {
    if (process.env.RAMO_MARKITDOWN_PYTHON) return;
    for (const candidate of [path.join(__dirname, '..', 'ramo-document-runtime.js'), path.join(__dirname, '..', 'native', 'ramo-document-runtime.js')]) {
      if (fs.existsSync(candidate)) return require(candidate).ensureDocumentRuntime(dir, { ocr });
    }
    throw Error('The app-managed document runtime is missing. Reinstall Ramo.');
  });
  const tempFiles = new Set();
  const cleanup = () => { for (const file of tempFiles) { try { fs.unlinkSync(file); } catch (_) {} } tempFiles.clear(); };
  const runWorker = async (file, name, ocr) => {
    await prepare(dataDir, ocr);
    return new Promise((resolve, reject) => {
    const python = pythonPath(dataDir);
    if (!python || !fs.existsSync(python)) return reject(Error('MarkItDown Python environment is not installed. Set RAMO_MARKITDOWN_PYTHON to a Python with markitdown installed.'));
    const args = ['-u', workerPath(), '--file', file, '--name', safeName(name)];
    if (ocr) args.push('--ocr');
    const child = spawnProcess(python, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', done = false;
    const finish = (fn, value) => { if (done) return; done = true; fn(value); };
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} finish(reject, Error('MarkItDown conversion timed out')); }, 300000);
    child.stdout?.on('data', chunk => { out += chunk.toString(); });
    child.stderr?.on('data', chunk => { err += chunk.toString(); });
    child.on('error', error => { clearTimeout(timer); finish(reject, error); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const lines = out.split(/\r?\n/).filter(Boolean);
        const packet = JSON.parse(lines.at(-1) || '{}');
        if (!packet.ok && !packet.markdown) throw Error(packet.error || err.slice(-400) || 'conversion failed');
        finish(resolve, packet);
      } catch (error) { finish(reject, Error(error.message)); }
    });
  });
  };
  const convertFile = async ({ file, name, ocr = false }) => {
    const result = await runWorker(file, name, ocr);
    // OCR fallback on a second pass when core returned almost no text.
    if (!ocr && result.chars < 200 && process.env.RAMO_MARKITDOWN_OCR !== '0') {
      const retried = await runWorker(file, name, true);
      return { ...retried, core_chars: result.chars };
    }
    return result;
  };
  const convert = async (input = {}) => {
    const ocr = !!input.ocr;
    if (input.data) {
      const bytes = Buffer.from(String(input.data), 'base64');
      if (!bytes.length) throw Error('Document is empty');
      if (bytes.length > MAX_BYTES) throw Error('Document exceeds the 40 MB local conversion limit');
      const name = safeName(input.name);
      const file = path.join(os.tmpdir(), 'ramo-md-' + Date.now() + '-' + name);
      fs.writeFileSync(file, bytes);
      tempFiles.add(file);
      try { return await convertFile({ file, name, ocr }); } finally { try { fs.unlinkSync(file); } catch (_) {} tempFiles.delete(file); }
    }
    if (input.file) {
      if (!fs.existsSync(input.file)) throw Error('Document not found');
      return convertFile({ file: input.file, name: input.name || path.basename(input.file), ocr });
    }
    if (input.url) {
      let url;
      try { url = new URL(input.url); } catch (_) { throw Error('Invalid document URL'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw Error('Only http(s) document URLs are supported');
      const response = await fetchImpl(url.href, { redirect: 'follow', signal: input.signal });
      if (!response.ok) throw Error('Download failed: HTTP ' + response.status);
      const contentType = response.headers?.get?.('content-type') || '';
      const name = input.name || path.basename(url.pathname) || 'document';
      if (!isConvertibleDocument({ name, contentType }) && !contentTypeLooksSupported(contentType) && !ocr) {
        throw Error('Unsupported document type: ' + (contentType || extOf(name)));
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw Error('Downloaded document is empty');
      if (bytes.length > MAX_BYTES) throw Error('Downloaded document exceeds the 40 MB local conversion limit');
      const file = path.join(os.tmpdir(), 'ramo-md-' + Date.now() + '-' + safeName(name));
      fs.writeFileSync(file, bytes);
      tempFiles.add(file);
      try { return await convertFile({ file, name, ocr }); } finally { try { fs.unlinkSync(file); } catch (_) {} tempFiles.delete(file); }
    }
    throw Error('Provide a document url, file path, or base64 data');
  };
  return { convert, isConvertibleDocument, cleanup };
}
module.exports = { CONVERTIBLE_EXT, isConvertibleDocument, extOf, safeName, createConverter, convertDocument: (...args) => createConverter().convert(...args) };
