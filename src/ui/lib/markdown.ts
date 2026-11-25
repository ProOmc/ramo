/**
 * Markdown → HTML for assistant turns. Ported verbatim (semantics unchanged)
 * from `src/compat/workspace.js#_renderMarkdown`, with fenced code blocks
 * upgraded to the AnythingLLM pattern (highlight.js highlight + sticky
 * "Copy block" header bar). Rendered output is escaped except for its own
 * tags; do not add new raw-HTML paths here.
 */

import hljs from 'highlight.js/lib/common';
import { parseChart } from './chart.js';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);

export function escInline(s: unknown): string {
  return esc(s);
}

export function renderMarkdown(text: unknown): string {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  let out = '';
  let inList = false;
  let ol = false;

  const inline = (value: unknown): string => {
    const held: string[] = [];
    const hold = (html: string) => '\u0000' + (held.push(html) - 1) + '\u0000';
    let s = String(value ?? '').replace(/`([^`]+)`/g, (_, code: string) => hold('<code>' + esc(code) + '</code>'));
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s<>]+)\)/g, (whole: string, label: string, raw: string) => {
      try {
        const url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol)) return whole;
        const href = esc(url.href).replace(/"/g, '&quot;');
        return hold('<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>');
      } catch {
        return whole;
      }
    });
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>').replace(/\u0000(\d+)\u0000/g, (_, i: string) => held[Number(i)] || '');
  };

  const close = () => {
    if (inList) {
      out += ol ? '</ol>' : '</ul>';
      inList = false;
    }
  };

  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const fence = line.match(/^\s*(`{3,}|~{3,})([\w-]*)\s*$/);
    if (fence) {
      close();
      const code: string[] = [];
      const mark = fence[1][0];
      for (i++; i < lines.length; i++) {
        if (lines[i].trim().startsWith(mark.repeat(fence[1].length))) break;
        code.push(lines[i]);
      }
      const lang = (fence[2] || '').trim().toLowerCase();
      const raw = code.join('\n');
      // A tiny line-based chart spec is rendered by the React turn as SVG.
      // The raw text is carried as an encoded attribute; the renderer treats
      // it strictly as data and escapes every string before drawing.
      const chartTag = lang === 'chart' || lang === 'ramo-chart';
      const plainTag = ['', 'text', 'txt', 'md', 'markdown'].includes(lang);
      const chartLike = chartTag || (plainTag && (parseChart(raw)?.labels.length ?? 0) >= 2);
      if (chartLike) {
        out += '<div class="oc-chart-block" data-oc-chart="' + esc(encodeURIComponent(raw)) + '"></div>\n';
        continue;
      }
      let highlighted: string;
      try {
        highlighted = lang && hljs.getLanguage(lang)
          ? hljs.highlight(raw, { language: lang, ignoreIllegals: true }).value
          : hljs.highlightAuto(raw).value;
      } catch {
        highlighted = esc(raw);
      }
      out += '<div class="oc-code-block" data-oc-codelang="' + esc(lang) + '"><div class="oc-code-head"><span class="oc-code-lang">' + (lang ? esc(lang) : 'code') + '</span><button type="button" class="oc-code-copy" data-oc-copy-code="true">Copy block</button></div><pre tabindex="0"><code class="hljs">' + highlighted + '</code></pre></div>\n';
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && cells(lines[i + 1]).length >= 2 && cells(lines[i + 1]).every((c) => /^:?-{3,}:?$/.test(c))) {
      close();
      const headers = cells(line);
      out += '<div class="oc-markdown-table"><table><thead><tr>' + headers.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
      i++;
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) {
        const row = cells(lines[++i]);
        out += '<tr>' + headers.map((_, j) => '<td>' + inline(row[j] || '') + '</td>').join('') + '</tr>';
      }
      out += '</tbody></table></div>';
      continue;
    }
    const hm = line.match(/^(#{1,4})\s+(.+)$/);
    if (hm) {
      close();
      out += '<h' + hm[1].length + '>' + inline(hm[2]) + '</h' + hm[1].length + '>';
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      close();
      out += '<hr>';
      continue;
    }
    const bm = line.match(/^[-*]\s+(.+)$/);
    const nm = line.match(/^\d+[.)]\s+(.+)$/);
    if (bm || nm) {
      const nowOl = !!nm;
      if (!inList || ol !== nowOl) {
        close();
        ol = nowOl;
        inList = true;
        const start = nowOl ? Number.parseInt(line, 10) : 1;
        out += ol ? (Number.isSafeInteger(start) && start !== 1 ? '<ol start="' + start + '">' : '<ol>') : '<ul>';
      }
      out += '<li>' + inline(((bm || nm) as RegExpMatchArray)[1]) + '</li>';
      continue;
    }
    close();
    if (!line.trim()) {
      out += '<div class="ramo-space"></div>';
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    out += quote ? '<blockquote>' + inline(quote[1]) + '</blockquote>' : '<p>' + inline(line) + '</p>';
  }
  close();
  return out;
}
