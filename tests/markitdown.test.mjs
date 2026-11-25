import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {isConvertibleDocument, createConverter} = require('../src/runtime/document-convert.cjs');

test('unsupported document types are detected by extension and content-type', () => {
  assert.equal(isConvertibleDocument({url:'https://example.org/report.pdf'}), true);
  assert.equal(isConvertibleDocument({name:'sheet.XLSX'}), true);
  assert.equal(isConvertibleDocument({name:'slides.pptx'}), true);
  assert.equal(isConvertibleDocument({contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}), true);
  assert.equal(isConvertibleDocument({url:'https://example.org/page.html'}), false);
  assert.equal(isConvertibleDocument({contentType:'text/html'}), false);
});

class FakeChild extends EventEmitter {
  constructor(args) { super(); this.stdout = new EventEmitter(); this.stderr = new EventEmitter(); this.args = args; }
}
function fakeSpawn(store) {
  return (command, args) => { const child = new FakeChild(args); store.push(child); return child; };
}
async function settle() { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); }
const WORKER_JSON = JSON.stringify({ok:true,name:'paper.pdf',markdown:'# Paper\ntext',chars:240,ocr_used:false,ocr_error:'',ocr_model:''});

test('converter spawns the local worker, feeds only Markdown back, and cleans up the temp file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-md-test-'));
  const python = path.join(dir, 'python.exe');
  fs.writeFileSync(python, 'fake');
  const children = [];
  const converter = createConverter({
    dataDir: dir,
    spawnProcess: fakeSpawn(children),
    setupRuntime: async () => {},
    fetchImpl: async () => ({
      ok:true,
      headers:{get:()=>'application/pdf'},
      arrayBuffer:async()=>Uint8Array.from([37,80,68,70]).buffer,
    }),
  });
  process.env.RAMO_MARKITDOWN_PYTHON = python;
  const pending = converter.convert({url:'https://example.org/paper.pdf'});
  await settle();
  const child = children[0];
  child.stdout.emit('data', Buffer.from(WORKER_JSON + '\n'));
  child.emit('close', 0);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.markdown, '# Paper\ntext');
  assert.ok(!child.args.includes('--ollama-url'));
  assert.ok(!child.args.includes('--ocr-model'));
  assert.deepEqual(fs.readdirSync(dir), ['python.exe']);
  delete process.env.RAMO_MARKITDOWN_PYTHON;
  fs.rmSync(dir, {recursive:true, force:true});
});

test('converter administers the OCR fallback when core text is near-empty', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ramo-md-test-'));
  const python = path.join(dir, 'python.exe');
  fs.writeFileSync(python, 'fake');
  const children = [];
  const converter = createConverter({ dataDir: dir, spawnProcess: fakeSpawn(children), setupRuntime: async () => {} });
  process.env.RAMO_MARKITDOWN_PYTHON = python;
  const bytes = Buffer.from('scanned pdf').toString('base64');
  const pending = converter.convert({data:bytes, name:'scan.pdf'});
  await settle();
  children[0].stdout.emit('data', Buffer.from(JSON.stringify({ok:true,markdown:'',chars:0,ocr_used:false}) + '\n'));
  children[0].emit('close', 0);
  await settle();
  children[1].stdout.emit('data', Buffer.from(JSON.stringify({ok:true,markdown:'# Scanned\nOCR text',chars:14,ocr_used:true,ocr_model:'OCRia-nano-1'}) + '\n'));
  children[1].emit('close', 0);
  const result = await pending;
  assert.equal(result.ocr_used, true);
  assert.equal(result.markdown, '# Scanned\nOCR text');
  assert.ok(children[1].args.includes('--ocr'));
  assert.ok(!children[1].args.includes('bonsai-2:2b'));
  assert.ok(!children[1].args.includes('--ollama-url'));
  delete process.env.RAMO_MARKITDOWN_PYTHON;
  fs.rmSync(dir, {recursive:true, force:true});
});
