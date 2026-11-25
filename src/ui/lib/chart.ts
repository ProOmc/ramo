/**
 * Tiny, forgiving chart specs for assistant turns.
 *
 * The model emits a fenced ```chart block with one item per line. No JSON key
 * names, no nested objects, no HTML from the model. This parser accepts the
 * common ways a small local model gets the syntax slightly wrong and falls
 * back to showing the raw lines as text when nothing can be plotted.
 *
 * Hand-rolled SVG, no chart dependency. The only existing chart-like code in
 * Ramo is the legacy hardware sparkline in src/compat/ramo-desktop-pages.js
 * (a polyline over a history array); this follows the same self-owned pattern.
 */

export type ChartType = "bar" | "line" | "pie";
export interface ChartSeries { name: string; values: number[] }
export interface ChartSpec { type: ChartType; title: string; labels: string[]; series: ChartSeries[]; raw: string }

const MAX_ROWS = 20;
const MAX_SERIES = 4;
const PALETTE = ["#8fb7ff", "#e8c98a", "#9fd6a3", "#e3a8d8"];

export function escapeXml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function numbersFrom(text: string): number[] {
  return text
    .split(/[,;\s]+/)
    .map((part) => part.trim().replace(/[%$]/g, ""))
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value) && Math.abs(value) < 1e12)
    .slice(0, MAX_SERIES);
}

/** Parse a chart fence. Returns null only when there is nothing plottable. */
export function parseChart(raw: string): ChartSpec | null {
  // Lines containing markup are never data; the raw text is still available
  // for the plain-text fallback, but it cannot become a label or title.
  const lines = String(raw ?? "").replace(/\r/g, "").split("\n").map((line) => line.trim()).filter((line) => line && !/[<>]/.test(line));
  if (lines.length === 0) return null;
  let type: ChartType = "bar";
  let title = "";
  let namedSeries: string[] = [];
  let index = 0;
  const header = lines[0];
  const typed = header.match(/^(bar|line|pie)\s*:\s*(.*)$/i);
  if (typed) {
    type = typed[1].toLowerCase() as ChartType;
    title = typed[2].trim();
    index += 1;
  } else if (/^(bar|line|pie)$/i.test(header)) {
    type = header.toLowerCase() as ChartType;
    index += 1;
  } else if (/^series\s*:/i.test(header)) {
    namedSeries = header.replace(/^series\s*:\s*/i, "").split(/[,;]/).map((name) => name.trim()).filter(Boolean).slice(0, MAX_SERIES);
    index += 1;
  } else if (!/\d/.test(header)) {
    title = header;
    index += 1;
  }

  const rows: { label: string; values: number[] }[] = [];
  for (const line of lines.slice(index)) {
    if (/^series\s*:/i.test(line)) {
      namedSeries = line.replace(/^series\s*:\s*/i, "").split(/[,;]/).map((name) => name.trim()).filter(Boolean).slice(0, MAX_SERIES);
      continue;
    }
    let text = line.replace(/^[-*]\s+/, "").replace(/^\|\s*/, "").replace(/\s*\|$/, "").replace(/\s*\|\s*/g, ":").trim();
    let label = text;
    let values: number[] = [];
    const split = text.match(/^(.*?)\s*[:=]\s*(.+)$/);
    if (split) { label = split[1].trim(); values = numbersFrom(split[2]); }
    else {
      const tail = text.match(/([-+]?\d[\d.,;%$ ]*)\s*$/);
      if (tail && tail.index !== undefined) { values = numbersFrom(tail[1]); label = text.slice(0, tail.index).trim(); }
    }
    label = label.replace(/[,;:|]+$/, "").trim();
    if (!values.length || !label) continue;
    rows.push({ label: label.slice(0, 48), values });
    if (rows.length >= MAX_ROWS) break;
  }
  if (rows.length === 0) return null;
  // Small models often put the kind on its own first row instead of the title.
  const firstLabel = (rows[0]?.label || "").trim().toLowerCase();
  if (!typed && ["bar", "line", "pie"].includes(firstLabel)) {
    type = firstLabel as ChartType;
    rows.shift();
    if (rows.length === 0) return null;
  }
  const count = Math.max(...rows.map((row) => row.values.length));
  const names = namedSeries.length ? namedSeries : count > 1 ? Array.from({ length: count }, (_, i) => `Series ${i + 1}`) : ["Value"];
  const series: ChartSeries[] = Array.from({ length: Math.min(count, names.length || 1) }, (_, i) => ({
    name: (names[i] || `Series ${i + 1}`).slice(0, 32),
    values: rows.map((row) => row.values[i] ?? 0),
  }));
  return { type, title: title.slice(0, 80), labels: rows.map((row) => row.label), series, raw };
}

/** Deterministic SVG. All model-supplied strings are XML-escaped. */
export function renderChartSvg(raw: string): string {
  const spec = parseChart(raw);
  if (!spec) return `<pre class="oc-chart-raw">${escapeXml(raw).slice(0, 12000)}</pre>`;
  const width = 640;
  const height = 280;
  const left = 54;
  const right = 18;
  const top = spec.title ? 64 : 44;
  const bottom = 44;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const all = spec.series.flatMap((series) => series.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (value: number) => top + plotH - ((value - min) / span) * plotH;
  const parts: string[] = [];
  parts.push(`<svg class="oc-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(spec.title || "Chart")}">`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" rx="10" class="oc-chart-bg"/>`);
  if (spec.title) parts.push(`<text x="${left}" y="30" class="oc-chart-title">${escapeXml(spec.title)}</text>`);
  parts.push(`<line x1="${left}" y1="${y(0)}" x2="${width - right}" y2="${y(0)}" class="oc-chart-axis"/>`);
  for (let tick = 0; tick <= 3; tick++) {
    const value = min + (span * tick) / 3;
    const py = y(value);
    parts.push(`<text x="${left - 8}" y="${py + 4}" text-anchor="end" class="oc-chart-tick">${escapeXml(Math.round(value * 100) / 100)}</text>`);
  }
  const legend = spec.series.map((series, i) => `<g><rect x="${left + i * 130}" y="${height - 20}" width="10" height="10" rx="2" fill="${PALETTE[i % PALETTE.length]}"/><text x="${left + i * 130 + 15}" y="${height - 11}" class="oc-chart-legend">${escapeXml(series.name)}</text></g>`).join("");
  parts.push(legend);

  if (spec.type === "pie") {
    const total = spec.series[0]?.values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const cx = left + plotW / 2;
    const cy = top + plotH / 2;
    const radius = Math.min(plotW, plotH) / 2 - 8;
    let angle = -Math.PI / 2;
    spec.labels.forEach((label, i) => {
      const value = Math.max(0, spec.series[0]?.values[i] ?? 0);
      const next = angle + (value / total) * Math.PI * 2;
      const x1 = cx + radius * Math.cos(angle);
      const y1 = cy + radius * Math.sin(angle);
      const x2 = cx + radius * Math.cos(next);
      const y2 = cy + radius * Math.sin(next);
      const large = next - angle > Math.PI ? 1 : 0;
      parts.push(`<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${PALETTE[i % PALETTE.length]}"/>`);
      parts.push(`<text x="${left + (i % 2) * 280 + 12}" y="${top - 8 + Math.floor(i / 2) * 18}" class="oc-chart-legend">${escapeXml(label)}</text>`);
      angle = next;
    });
  } else if (spec.type === "line") {
    spec.series.forEach((series, seriesIndex) => {
      const points = series.values.map((value, i) => `${(left + (plotW * i) / Math.max(1, series.values.length - 1)).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
      parts.push(`<polyline points="${points}" fill="none" stroke="${PALETTE[seriesIndex % PALETTE.length]}" stroke-width="2.5" stroke-linejoin="round"/>`);
      series.values.forEach((value, i) => parts.push(`<circle cx="${(left + (plotW * i) / Math.max(1, series.values.length - 1)).toFixed(1)}" cy="${y(value).toFixed(1)}" r="3" fill="${PALETTE[seriesIndex % PALETTE.length]}"/>`));
    });
    spec.labels.forEach((label, i) => parts.push(`<text x="${left + (plotW * i) / Math.max(1, spec.labels.length - 1)}" y="${height - 32}" text-anchor="middle" class="oc-chart-label">${escapeXml(label.slice(0, 14))}</text>`));
  } else {
    const group = plotW / spec.labels.length;
    const barW = Math.max(4, (group * 0.7) / spec.series.length);
    spec.labels.forEach((label, i) => {
      spec.series.forEach((series, seriesIndex) => {
        const value = series.values[i] ?? 0;
        const bx = left + group * i + group * 0.15 + seriesIndex * barW;
        const by = y(value);
        parts.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, y(0) - by).toFixed(1)}" rx="2" fill="${PALETTE[seriesIndex % PALETTE.length]}"/>`);
      });
      parts.push(`<text x="${(left + group * i + group / 2).toFixed(1)}" y="${height - 32}" text-anchor="middle" class="oc-chart-label">${escapeXml(label.slice(0, 14))}</text>`);
    });
  }
  parts.push("</svg>");
  return parts.join("");
}
