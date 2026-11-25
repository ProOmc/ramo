'use strict';
// Ramo Pet — Ringo-style segmented ring companion.
// Visual core ported from the "segmented-ring desktop pet" reference: five
// rotating glowing arcs + a small sphere face with expressive eyes, all
// eased toward the current pet phase (idle/listening/thinking/responding/error).

/* =====================================================
   STATE + EXPRESSION DEFINITIONS
   ===================================================== */
const STATES = {
  listening:  { color:[0,179,240],    speed:15,  gap:32, w:[1,.62,1.12,.74,0],  wobA:.04, wobF:1.5, expr:'dot',    breath:[.014,1.7] },
  processing: { color:[255,216,0],    speed:150, gap:26, w:[.8,.55,.42,.75,.5], wobA:.28, wobF:3.4, expr:'dotS',   breath:[.010,6]   },
  responding: { color:[15,230,62],    speed:52,  gap:22, w:[1,.78,.9,.66,.84],  wobA:.30, wobF:7.5, expr:'happy',  breath:[.012,4]   },
  error:      { color:[255,29,29],    speed:-5,  gap:27, w:[1,.7,1.05,.8,0],    wobA:0,   wobF:1,   expr:'squint', breath:[.004,2]   }
};
// eye shapes: three points per eye (left eye; right eye mirrored)
const EXPR = {
  dot:    { y:-29, x:37, w:31, pts:[0,0, 0,0, 0,0],        hl:1 },
  dotS:   { y:-27, x:34, w:28, pts:[0,0, 0,0, 0,0],        hl:1 },
  happy:  { y:-22, x:38, w:17.5, pts:[-20,13, 1,-13, 20,11], hl:0 },
  squint: { y:-29, x:37, w:17.5, pts:[-22,-16, 20,0, -22,16],hl:0 }
};
// pet phases -> ring states (idle rests in the calm blue listening look)
const PHASE = { idle:'listening', listening:'listening', thinking:'processing', responding:'responding', error:'error' };

/* =====================================================
   DOM
   ===================================================== */
const pet = document.getElementById('pet');
const body = document.getElementById('petBody');
const segs = [0,1,2,3,4].map(i => document.getElementById('s' + i));
const uMain = document.getElementById('uMain');
const uGlow = document.getElementById('uGlow');
const eL = document.getElementById('eL'), eR = document.getElementById('eR');
const hL = document.getElementById('hL'), hR = document.getElementById('hR');

/* =====================================================
   ANIMATED PARAMETERS (everything eases toward the state)
   ===================================================== */
let state = 'listening', stateT = 0;
const S0 = STATES.listening, E0 = EXPR.dot;
const P = {
  color: [...S0.color], gap: S0.gap, w: [...S0.w], wobA: S0.wobA, wobF: S0.wobF,
  eY: E0.y, eX: E0.x, ew: E0.w, pts: [...E0.pts], hl: E0.hl,
  bAmp: S0.breath[0], bF: S0.breath[1], speed: S0.speed
};
let rot = -40, yaw = 0, pitch = 0;
let sq = 0, sqV = 0;            // squash spring
let tilt = 0;                   // idle tilt (no dragging in pet mode)
let shakeAmt = 0, talkAmt = 0;
let blinkT = -1, nextBlink = 2.2, doubleBlink = false;

/* =====================================================
   GEOMETRY
   ===================================================== */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const RAD = Math.PI / 180;
const R = 98, STROKE = 15, CAP = (STROKE / 2) / R / RAD;
const fmt = n => n.toFixed(2);
function arcPath(a0, a1) {
  const x0 = 120 + R * Math.cos(a0 * RAD), y0 = 120 + R * Math.sin(a0 * RAD);
  const x1 = 120 + R * Math.cos(a1 * RAD), y1 = 120 + R * Math.sin(a1 * RAD);
  return `M${fmt(x0)} ${fmt(y0)}A${R} ${R} 0 ${(a1 - a0) > 180 ? 1 : 0} 1 ${fmt(x1)} ${fmt(y1)}`;
}

// Eyes live on a small sphere: turning the "head" toward the cursor moves AND foreshortens them.
const RF = 82;
function eyeCenter(side, ex, ey, yawD, pitchD) {
  const th = Math.asin(clamp(ey / RF, -.95, .95));
  const cth = Math.cos(th);
  const phi = side * Math.asin(clamp(ex / (RF * cth), -.95, .95));
  const x0 = cth * Math.sin(phi), y0 = Math.sin(th), z0 = cth * Math.cos(phi);
  const cY = Math.cos(yawD * RAD), sY = Math.sin(yawD * RAD);
  const cP = Math.cos(pitchD * RAD), sP = Math.sin(pitchD * RAD);
  const x1 = x0 * cY + z0 * sY, z1 = -x0 * sY + z0 * cY;
  const y2 = y0 * cP + z1 * sP, z2 = -y0 * sP + z1 * cP;
  let X = RF * x1, Y = RF * y2;
  const d = Math.hypot(X, Y), maxR = 66;
  if (d > maxR) { X *= maxR / d; Y *= maxR / d; }
  const zr = clamp(z2 / (cth * Math.cos(phi)), 0, 1);
  return { x: 120 + X, y: 120 + Y, zr };
}

function drawEye(side, pathEl, haloEl, blink, jx, jy) {
  const c = eyeCenter(side, P.eX, P.eY, yaw, pitch);
  const other = eyeCenter(-side, P.eX, P.eY, yaw, pitch);
  const level = (c.y + other.y) / 2;
  c.y = level + clamp((c.y - level) * .25, -2.5, 2.5);
  const sx = .74 + .26 * c.zr, sy = .90 + .10 * c.zr;
  const b = blink * P.hl;                    // only dot-eyes blink
  const w = P.ew * (1 - .68 * b);
  const spread = b * P.ew * .36;
  const mir = side < 0 ? 1 : -1;
  let d = '';
  for (let i = 0; i < 3; i++) {
    let px = P.pts[i * 2], py = P.pts[i * 2 + 1];
    if (i === 0) px -= spread;
    if (i === 2) px += spread;
    const X = c.x + jx + mir * px * sx, Y = c.y + jy + py * sy;
    d += (i ? 'L' : 'M') + fmt(X) + ' ' + fmt(Y);
  }
  const sw = w * (sx * .5 + sy * .5);
  pathEl.setAttribute('d', d); pathEl.setAttribute('stroke-width', fmt(sw));
  haloEl.setAttribute('d', d); haloEl.setAttribute('stroke-width', fmt(sw + 5));
}

/* =====================================================
   GAZE (cursor position feeds)
   ===================================================== */
let mx = null, my = 0, lastMove = 0;
let wanderNext = 0, wanderYaw = 0, wanderPitch = 0;

/* =====================================================
   MAIN LOOP
   ===================================================== */
let last = performance.now();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function frame(now) {
  const t = now / 1000;
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const S = STATES[state], E = EXPR[S.expr];
  const kc = 1 - Math.exp(-dt * 7), kw = 1 - Math.exp(-dt * 5), kf = 1 - Math.exp(-dt * 12);

  // --- ease parameters toward current state
  for (let i = 0; i < 3; i++) P.color[i] = lerp(P.color[i], S.color[i], kc);
  P.gap = lerp(P.gap, S.gap, kw);
  for (let i = 0; i < 5; i++) P.w[i] = lerp(P.w[i], S.w[i], kw);
  P.wobA = lerp(P.wobA, S.wobA, kw); P.wobF = lerp(P.wobF, S.wobF, kw);
  P.bAmp = lerp(P.bAmp, S.breath[0], kw); P.bF = lerp(P.bF, S.breath[1], kw);
  P.eY = lerp(P.eY, E.y, kf); P.eX = lerp(P.eX, E.x, kf); P.ew = lerp(P.ew, E.w, kf); P.hl = lerp(P.hl, E.hl, kf);
  for (let i = 0; i < 6; i++) P.pts[i] = lerp(P.pts[i], E.pts[i], kf);

  // --- envelopes
  const since = t - stateT;
  shakeAmt = lerp(shakeAmt, state === 'error' ? 1 : 0, 1 - Math.exp(-dt * 6));
  talkAmt = lerp(talkAmt, state === 'responding' ? 1 : 0, 1 - Math.exp(-dt * 6));
  let errEnv = 0;
  if (state === 'error') {
    const ph = since % 1.9;
    errEnv = Math.max(Math.exp(-since * 2.4), ph < .5 ? (1 - ph / .5) * .55 : 0);
  }
  const shake = shakeAmt * errEnv;

  // --- ring rotation
  let target = S.speed;
  if (state === 'processing') target *= .72 + .28 * Math.sin(t * 2.3);
  P.speed = lerp(P.speed, target, 1 - Math.exp(-dt * 3));
  rot += P.speed * dt * (reduceMotion ? .35 : 1);

  // --- ring segments
  const ws = [];
  let sumW = 0, gapSum = 0;
  for (let i = 0; i < 5; i++) {
    const w = Math.max(0, P.w[i]);
    const we = w * (1 + P.wobA * Math.sin(t * P.wobF + i * 1.9));
    ws[i] = we;
    sumW += we; gapSum += P.gap * clamp(w * 5, 0, 1);
  }
  const arcTot = 360 - gapSum;
  let a = rot - 90;
  for (let i = 0; i < 5; i++) {
    const span = arcTot * ws[i] / Math.max(sumW, .001);
    const j = Math.sin(t * 43 + i * 2.7) * shake * 3.2;
    const a0 = a + CAP + j, a1 = a + span - CAP + j;
    segs[i].setAttribute('d', (a1 - a0) > .8 ? arcPath(a0, a1) : '');
    a += span + P.gap * clamp(P.w[i] * 5, 0, 1);
  }
  const col = `rgb(${P.color.map(v => Math.round(v)).join(',')})`;
  uMain.setAttribute('stroke', col); uGlow.setAttribute('stroke', col);

  // --- gaze: follow the cursor, wander when it's idle / gone
  const rect = pet.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let yawT = 0, pitchT = 0;
  if (mx !== null && now / 1000 - lastMove < 8) {
    const dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy) || 1;
    const reach = Math.max(rect.width * .85, 120);
    let s = Math.min(1, d / reach); s = 1 - (1 - s) * (1 - s);
    const nx = clamp(dx / d * 1.25, -1, 1), ny = clamp(dy / d * 1.25, -1, 1);
    yawT = 38 * s * nx;
    pitchT = (ny < 0 ? 20 : 25) * s * ny;
  } else {
    if (t > wanderNext) {
      wanderNext = t + 1.3 + Math.random() * 2.8;
      wanderYaw = (Math.random() * 2 - 1) * 24; wanderPitch = (Math.random() * 2 - 1) * 10;
    }
    yawT = wanderYaw; pitchT = wanderPitch;
  }
  if (state === 'processing') { yawT += 8 * Math.sin(t * 1.3); pitchT += -4 - 4 * Math.cos(t * 2); }
  const kg = 1 - Math.exp(-dt * 11);
  yaw = lerp(yaw, yawT, kg); pitch = lerp(pitch, pitchT, kg);

  // --- blinking
  if (blinkT < 0 && t > nextBlink) {
    blinkT = t; doubleBlink = Math.random() < .18;
    nextBlink = t + 2.4 + Math.random() * 3.6;
  }
  let blink = 0;
  if (blinkT >= 0) {
    const u = (t - blinkT) / .17;
    if (u >= 1) { blinkT = -1; if (doubleBlink) { doubleBlink = false; nextBlink = t + .12; } }
    else blink = Math.sin(u * Math.PI);
  }

  // --- eyes
  const u = 200 / 190;          // pet area is 190px inside a 240 viewBox
  const jx = Math.sin(t * 61) * shake * 1.4, jy = Math.cos(t * 53) * shake * .9;
  const fy = Math.sin(t * 11) * talkAmt * 1.3 - Math.abs(Math.sin(t * 5.6)) * talkAmt * .9;
  drawEye(-1, eL, hL, blink, jx, jy + fy);
  drawEye(1, eR, hR, blink, jx, jy + fy);

  // --- body: squash spring, breathing, shake, talking bob, gentle float
  sqV += (-220 * sq - 11 * sqV) * dt; sq += sqV * dt;
  const br = P.bAmp * Math.sin(t * P.bF);
  const bx = Math.sin(t * 58) * shake * 3.4 / u;
  const floatY = Math.sin(t * 1.05) * 1.15;
  const by = floatY - Math.abs(Math.sin(t * 5.6)) * talkAmt * (.6 + .4 * Math.sin(t * 1.9 + 1)) * 7 / u;
  const rb = tilt + yaw * .05 + Math.sin(t * 47) * shake * 2.4;
  body.style.transform = `translate(${bx.toFixed(2)}px,${by.toFixed(2)}px) rotate(${rb.toFixed(2)}deg) scale(${(1 + sq + br).toFixed(4)},${(1 - sq * .75 + br).toFixed(4)})`;

  requestAnimationFrame(frame);
}

/* =====================================================
   STATE EVENTS + GAZE EVENTS (bridged from electron-main)
   ===================================================== */
function setState(phase) {
  const s = PHASE[phase] || 'listening';
  const changed = s !== state;
  if (!changed) return;
  state = s; stateT = performance.now() / 1000;
  sqV = { listening: 1.0, processing: 1.2, responding: 2.0, error: -2.3 }[s];
  pet.dataset.state = phase || 'idle';
  pet.setAttribute('aria-label', 'Ramo deskpet — ' + ({ listening: 'listening', thinking: 'thinking', responding: 'responding', error: 'error', idle: 'resting' }[phase] || 'resting'));
}

let captionTimer = null;
function setCaption(text, isStatus) {
  const caption = document.getElementById('petCaption');
  if (!caption) return;
  caption.textContent = text || '';
  caption.classList.toggle('has-text', !!text);
  caption.classList.toggle('status', !!isStatus);
  clearTimeout(captionTimer);
  if (text) captionTimer = setTimeout(() => {
    caption.textContent = '';
    caption.classList.remove('has-text', 'status');
  }, 8000);
}
function clearCaption() {
  const caption = document.getElementById('petCaption');
  if (!caption) return;
  clearTimeout(captionTimer);
  caption.textContent = '';
  caption.classList.remove('has-text', 'status');
}

if (window.ocPet) {
  window.ocPet.onState((s) => { if (s) setState(s.phase || 'idle'); });
  window.ocPet.onCursor((c) => {
    if (!c) return;
    mx = c.x; my = c.y; lastMove = performance.now() / 1000;
  });
  window.ocPet.onCaption((c) => {
    if (!c) return;
    if (typeof c.text === 'string') setCaption(c.text, false);
    else if (typeof c.status === 'string') setCaption(c.status, true);
  });
  let petVolume = .95;
  const audioQueue = [];
  let audioBusy = false;
  function playNextAudio() {
    if (audioBusy || !audioQueue.length) return;
    audioBusy = true;
    const b64 = audioQueue.shift();
    try {
      const a = new Audio('data:audio/wav;base64,' + b64);
      a.volume = petVolume;
      const done = () => {
        try { clearCaption(); } catch (_) {}
        if (audioQueue.length === 0 && typeof window.ocPet.audioDone === 'function') {
          try { window.ocPet.audioDone(); } catch (_) {}
        }
        audioBusy = false;
        playNextAudio();
      };
      a.onended = done;
      a.play().catch(done);
    } catch (e) {
      try { clearCaption(); if (typeof window.ocPet.audioDone === 'function') window.ocPet.audioDone(); } catch (_) {}
      audioBusy = false;
      playNextAudio();
    }
  }

  window.ocPet.onSettings((s2) => { if (s2 && Number.isFinite(Number(s2.volume))) petVolume = Math.max(0.05, Math.min(1, Number(s2.volume))); });
  window.ocPet.onAudio((b64) => {
    if (!b64) return;
    audioQueue.push(b64);
    playNextAudio();
  });
}

// Fallback gaze when the window is hovered directly (forwarded mouse moves).
window.addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; lastMove = performance.now() / 1000; });

setState('idle');
requestAnimationFrame((ts) => { last = ts; requestAnimationFrame(frame); });
