'use strict';
// Renders validated sketch strokes on the transparent overlay. Every number
// has already been bounded by src/native/pet-sketch.cjs in the main process;
// this file only builds SVG elements and runs the short draw/fade animation.

const SVG_NS = 'http://www.w3.org/2000/svg';
const layer = document.getElementById('sketchLayer');
let fadeTimer = 0;
let doneTimer = 0;
let strokeCount = 0;

function element(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [name, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) el.setAttribute(name, String(value));
  }
  return el;
}

function polar(cx, cy, r, degrees) {
  const a = degrees * Math.PI / 180;
  return {x: cx + r * Math.cos(a), y: cy + r * Math.sin(a)};
}

function arcPath(stroke) {
  const delta = ((stroke.a2 - stroke.a1) % 360 + 360) % 360 || 359.99;
  const start = polar(stroke.cx, stroke.cy, stroke.r, stroke.a1);
  const end = polar(stroke.cx, stroke.cy, stroke.r, stroke.a1 + delta);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${stroke.r} ${stroke.r} 0 ${delta > 180 ? 1 : 0} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function drawOn(el, delay) {
  el.setAttribute('pathLength', '1');
  el.style.strokeDasharray = '1';
  el.style.strokeDashoffset = '1';
  el.style.animation = `sketch-draw .62s ease-out ${delay.toFixed(2)}s forwards`;
}

function drawStatic(el) {
  el.style.strokeDasharray = 'none';
  el.style.strokeDashoffset = '0';
  el.style.animation = 'none';
}

function appendShape(shape, style, delay, color, instant) {
  const strokeColor = color || style.color;
  shape.setAttribute('class', 'stroke');
  shape.setAttribute('stroke-width', String(style.width));
  shape.setAttribute('stroke', strokeColor);
  if (instant) {
    drawStatic(shape);
    layer.append(shape);
    return;
  }
  const shadow = shape.cloneNode(true);
  shadow.setAttribute('class', 'stroke-shadow');
  shadow.setAttribute('stroke-width', String(style.width + 4));
  shadow.setAttribute('stroke', 'rgba(0,0,0,.45)');
  drawOn(shadow, delay);
  layer.append(shadow);
  drawOn(shape, delay);
  layer.append(shape);
}

function appendText(stroke, style, delay, color) {
  const text = element('text', {
    x: stroke.x,
    y: stroke.y,
    'font-size': stroke.size,
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    fill: color || style.color,
    stroke: 'rgba(0,0,0,.62)',
    'stroke-width': Math.max(3, style.width + 1),
    class: 'label'
  });
  text.textContent = stroke.text;
  text.style.animation = `sketch-appear .35s ease-out ${delay.toFixed(2)}s both`;
  layer.append(text);
}

function appendArrow(stroke, style, delay, color) {
  const strokeColor = color || style.color;
  const line = element('line', {x1: stroke.x1, y1: stroke.y1, x2: stroke.x2, y2: stroke.y2});
  appendShape(line, style, delay, strokeColor);
  const angle = Math.atan2(stroke.y2 - stroke.y1, stroke.x2 - stroke.x1);
  const length = Math.max(14, style.width * 3.2);
  const spread = Math.PI / 7;
  const a = [stroke.x2 - length * Math.cos(angle - spread), stroke.y2 - length * Math.sin(angle - spread)];
  const b = [stroke.x2 - length * Math.cos(angle + spread), stroke.y2 - length * Math.sin(angle + spread)];
  const head = element('polygon', {
    points: `${stroke.x2.toFixed(2)},${stroke.y2.toFixed(2)} ${a[0].toFixed(2)},${a[1].toFixed(2)} ${b[0].toFixed(2)},${b[1].toFixed(2)}`,
    fill: strokeColor,
    stroke: 'rgba(0,0,0,.45)',
    'stroke-width': '1.5',
    'stroke-linejoin': 'round'
  });
  head.style.animation = `sketch-appear .2s ease-out ${(delay + .45).toFixed(2)}s both`;
  layer.append(head);
}

function appendStroke(stroke, style, index, instant) {
  if (!stroke || !stroke.type) return;
  const delay = Math.min(1.1, index * 0.035);
  const color = stroke.color;
  if (stroke.type === 'text') {
    appendText(stroke, style, instant ? 0 : delay, color);
    return;
  }
  if (stroke.type === 'arrow') {
    appendArrow(stroke, style, instant ? 0 : delay, color);
    return;
  }
  let shape = null;
  if (stroke.type === 'circle') {
    shape = element('circle', {cx: stroke.cx, cy: stroke.cy, r: stroke.r});
  } else if (stroke.type === 'line') {
    shape = element('line', {x1: stroke.x1, y1: stroke.y1, x2: stroke.x2, y2: stroke.y2});
  } else if (stroke.type === 'rect') {
    shape = element('rect', {x: stroke.x, y: stroke.y, width: stroke.w, height: stroke.h, rx: 2});
  } else if (stroke.type === 'polyline') {
    const points = (stroke.points || []).map((point) => `${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)}`).join(' ');
    shape = element('polyline', {points});
  } else if (stroke.type === 'arc') {
    shape = element('path', {d: arcPath(stroke)});
  }
  if (shape) appendShape(shape, style, delay, color, instant);
}

function publish() {
  const state = {
    visible: strokeCount > 0,
    count: strokeCount,
    fading: layer.classList.contains('fading'),
    width: Number(layer.getAttribute('viewBox')?.split(/\s+/)[2] || 0),
    height: Number(layer.getAttribute('viewBox')?.split(/\s+/)[3] || 0)
  };
  window.__ocSketchState = state;
  document.documentElement.dataset.drawing = state.visible ? '1' : '0';
  document.documentElement.dataset.strokes = String(state.count);
}

function cancelTimers() {
  if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = 0; }
  if (doneTimer) { clearTimeout(doneTimer); doneTimer = 0; }
}

function clear() {
  cancelTimers();
  strokeCount = 0;
  layer.classList.remove('fading');
  layer.replaceChildren();
  publish();
}

function finish() {
  cancelTimers();
  strokeCount = 0;
  layer.replaceChildren();
  layer.classList.remove('fading');
  publish();
  try { if (window.ocSketch && typeof window.ocSketch.done === 'function') window.ocSketch.done(); } catch (_) {}
}

function draw(payload) {
  if (!payload || !Array.isArray(payload.strokes) || !payload.strokes.length) { clear(); return; }
  cancelTimers();
  layer.classList.remove('fading');
  layer.replaceChildren();
  const width = Math.max(1, Math.round(Number(payload.width) || window.innerWidth || 1));
  const height = Math.max(1, Math.round(Number(payload.height) || window.innerHeight || 1));
  layer.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const style = {
    color: /^#[0-9a-f]{6}$/i.test(String(payload.color || '')) ? payload.color : '#ffd54a',
    width: Math.max(1, Math.min(12, Number(payload.widthPx) || 5))
  };
  payload.strokes.forEach((stroke, index) => appendStroke(stroke, style, index, payload.instant === true));
  strokeCount = payload.strokes.length;
  publish();
  // An instant payload is the tracker's frame: no entrance animation, no
  // auto-hide. The tracker owns the lifetime, not the fade timer.
  if (payload.instant === true) return;
  const holdMs = Math.max(1500, Math.min(20000, Number(payload.holdMs) || 8000));
  fadeTimer = setTimeout(() => {
    layer.classList.add('fading');
    publish();
  }, Math.max(400, holdMs - 650));
  doneTimer = setTimeout(finish, holdMs + 120);
}

if (window.ocSketch) {
  window.ocSketch.onClear(clear);
  window.ocSketch.onDraw(draw);
}
window.addEventListener('pagehide', cancelTimers, {once: true});
publish();
