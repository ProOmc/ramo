import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChart, renderChartSvg, escapeXml } from '../build/chart.js';
import { renderMarkdown } from '../build/markdown.js';

const simple = `Token speed\nFast 22\nSmart 12\nBonsai 30`;

test('minimal line format parses without JSON or type declarations', () => {
  const spec = parseChart(simple);
  assert.ok(spec);
  assert.equal(spec.type, 'bar');
  assert.equal(spec.title, 'Token speed');
  assert.deepEqual(spec.labels, ['Fast', 'Smart', 'Bonsai']);
  assert.deepEqual(spec.series[0].values, [22, 12, 30]);
});

test('bar, line and pie prefixes, colons, tables and extra text are tolerated', () => {
  assert.equal(parseChart(`pie: Share\nA: 60\nB 40`).type, 'pie');
  assert.equal(parseChart(`line: Trend\nMon 1\nTue 2`).type, 'line');
  const table = parseChart(`Results\n| A | 12 |\n| B | 8 |`);
  assert.deepEqual(table.labels, ['A', 'B']);
  assert.deepEqual(table.series[0].values, [12, 8]);
  const messy = parseChart(`Speed\nhere is a sentence\nFast = 22\nSlow, 4\nno numbers here`);
  assert.deepEqual(messy.labels, ['Fast', 'Slow']);
});

test('multiple series and a series line work', () => {
  const spec = parseChart(`series: 4B, 9B\nFast 22; 12\nSmart 9, 6`);
  assert.deepEqual(spec.series.map((s) => s.name), ['4B', '9B']);
  assert.deepEqual(spec.series[0].values, [22, 9]);
  assert.deepEqual(spec.series[1].values, [12, 6]);
});

test('small-model output with a leading kind row and pipe tables parses', () => {
  const pie = parseChart('pie\n| Ramo | 60 |\n| OpenCode | 30 |\n| Other | 10 |');
  assert.equal(pie.type, 'pie');
  assert.deepEqual(pie.labels, ['Ramo', 'OpenCode', 'Other']);
  const fence = renderMarkdown('```text\n| Fast 4B | 22 |\n| Smart 9B | 12 |\n```');
  assert.match(fence, /oc-chart-block/);
});

test('malformed specs fail safe as plain text and never break chat', () => {
  assert.equal(parseChart(''), null);
  assert.equal(parseChart('just words and no numbers'), null);
  const fallback = renderChartSvg('just words and no numbers');
  assert.match(fallback, /oc-chart-raw/);
  assert.match(fallback, /just words and no numbers/);
  assert.ok(!fallback.includes('<script'));
});

test('model strings are escaped and cannot inject markup or scripts', () => {
  const svg = renderChartSvg(`<script>alert(1)</script>\n<img src=x onerror=alert(1)> 5`);
  assert.ok(!svg.includes('<script'));
  assert.ok(!svg.includes('<img'));
  assert.match(svg, /&lt;script&gt;/);
  assert.match(svg, /&lt;img/);
  assert.equal(escapeXml(`"'&<>`), `&quot;&#39;&amp;&lt;&gt;`);
});

test('markdown emits a chart placeholder and leaves ordinary code blocks alone', () => {
  const html = renderMarkdown('```chart\nSpeed\nFast 22\n```');
  assert.match(html, /oc-chart-block/);
  assert.match(html, /data-oc-chart="Speed%0AFast%2022"/);
  const normal = renderMarkdown('```js\nconst a = 1;\n```');
  assert.match(normal, /oc-code-block/);
  assert.ok(!normal.includes('oc-chart-block'));
});

test('very large specs are capped', () => {
  const rows = Array.from({ length: 60 }, (_, i) => `Row ${i} ${i}`).join('\n');
  const spec = parseChart(rows);
  assert.equal(spec.labels.length, 20);
});
