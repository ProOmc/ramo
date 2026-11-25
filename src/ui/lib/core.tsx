/**
 * Shared ASTER core state + motion.
 *
 * Ported from `src/compat/workspace.js` (`_coreState` + `_beginCoreMotion`).
 * The full physics loop is preserved because the idle artwork and the per-model
 * colour/speed rules ARE the identity of this application. Do not simplify here.
 */
import { useEffect, useRef } from 'react';
import type { LegacyObject } from '../../renderer/legacy-boundary';

export type CorePhase = 'idle' | 'error' | 'speak' | 'think' | 'generate' | 'search' | 'memory';
export type CoreMode = 'idle' | 'thinking' | 'generating' | 'tool';
export type CoreMood = 'calm' | 'attentive' | 'curious' | 'alert';
export type CoreModelClass = 'fast' | 'medium' | 'strong' | 'moe';

export interface CoreStateSnapshot {
  model: string;
  job: 'chat' | 'research' | 'memory' | 'files';
  phase: CorePhase;
  effort: 0 | 1 | 2 | 3 | 4;
  primary: string;
  secondary: string;
  mode: CoreMode;
  mood: CoreMood;
  modelClass: CoreModelClass;
  workload: { inputTokens: number; estimated: boolean; think: 'off' | 'unspecified' | 'on' | 'high' } | null;
}

/** The raw state machine, ported faithfully. */
export function computeCoreState(getNamed: (n: string, d?: unknown) => unknown, getVar: (n: string, d?: unknown) => unknown, currentPage: string): CoreStateSnapshot {
  const research = Number(getNamed('Research Runtime Active', 0)) === 1;
  const busy = Number(getVar('tamai_shell_busy_v1', 0)) === 1;
  const mic = Number(getVar('tamai_shell_mic_in_v1', 0)) === 1;
  const activity = String(getNamed('Core Activity', getVar('v28_4_core_activity', 'READY')) ?? 'READY').toUpperCase();
  const configuredModel = research
    ? getNamed('Research Report Model', '')
    : getNamed('Assistant Model', '');
  const model = String(configuredModel ?? '');
  let job: CoreStateSnapshot['job'] = 'chat';
  if (research) job = 'research';
  else if (/MEMORY|RECALL/.test(activity)) job = 'memory';
  else if (/SEARCH/.test(activity)) job = 'research';
  else if (currentPage === 'files') job = 'files';

  let phase: CorePhase = 'idle';
  if (/ERROR|FAIL/.test(activity)) phase = 'error';
  else if (mic || /SPEAK|LISTEN/.test(activity)) phase = 'speak';
  else if (/SEARCH|FETCH|RETRIEV|\bREAD(?:ING)?\b/.test(activity) || research) phase = 'search';
  else if (/MEMORY|RECALL/.test(activity)) phase = 'memory';
  else if (/GENERAT|RESPOND|WRITE|ANSWER/.test(activity) || busy) phase = 'generate';
  else if (/THINK|DEEP|PLANN/.test(activity)) phase = 'think';

  const id = model.toLowerCase();
  const primary = id.includes('bonsai') ? '#8ff15a'
    : id.includes('35b') || id.includes('qwen36') || id.includes('qwen3.6') ? '#ffcf54'
    : id.includes('9b') ? '#51dad1'
    : id.includes('4b') ? '#5cecac'
    : '#8fe8a6';
  const jobColors: Record<CoreStateSnapshot['job'], string> = { chat: '#eff16b', research: '#4bc6ff', memory: '#ffab64', files: '#bba3fd' };
  const secondary = ({ think: '#b89aff', generate: '#6ee8bf', search: '#4bc6ff', memory: '#ffab64', error: '#ff7a8c', speak: '#f3b968' } as Record<string, string>)[phase] || jobColors[job] || '#9dbef7';

  const modelClass: CoreModelClass = /(moe|a3b|a22b|a2b|experts|mixtral|gpt-oss)/i.test(id) ? 'moe'
    : /(35b|27b|32b|70b|72b|80b|strong|qwen36|qwen3\.6)/i.test(id) ? 'strong'
    : /(9b|12b|14b|medium)/i.test(id) ? 'medium'
    : 'fast';

  const mode: CoreMode = phase === 'think' ? 'thinking'
    : phase === 'search' || phase === 'memory' ? 'tool'
    : phase === 'generate' || phase === 'speak' ? 'generating'
    : 'idle';

  const mood: CoreMood = phase === 'error' ? 'alert'
    : phase === 'memory' ? 'curious'
    : phase === 'idle' ? 'calm'
    : 'attentive';

  const explicit = String((getNamed('Core Effort Level', '') as unknown as string) || '').toLowerCase();
  const levels: Record<string, number> = { idle: 0, light: 1, medium: 2, high: 3, extreme: 4, 'very high': 4 };
  const effort = (explicit && Object.hasOwn(levels, explicit) ? levels[explicit] : phase === 'idle' ? 0 : 1) as CoreStateSnapshot['effort'];

  return { model, job, phase, effort, primary, secondary, mode, mood, modelClass, workload: null };
}

const ASTER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" class="oc-core-svg oc-aster-svg" viewBox="0 0 560 560" preserveAspectRatio="xMidYMid meet" role="presentation" aria-label="Precise segmented luminous circular assistant presence" style="--model:#6d86ff;--aura1:#dff7ff;--aura2:#99b8d8;--auraStroke:#bbd1e2">'
  + '<defs>'
  + '<radialGradient id="ocAsterHaloFade"><stop offset="0" stop-color="var(--aura1)" stop-opacity=".34"/><stop offset=".35" stop-color="var(--aura1)" stop-opacity=".14"/><stop offset=".72" stop-color="var(--aura2)" stop-opacity=".05"/><stop offset="1" stop-color="var(--aura2)" stop-opacity="0"/></radialGradient>'
  + '<filter id="ocAsterBloom" x="-50%" y="-70%" width="200%" height="240%"><feGaussianBlur stdDeviation="5.2"/></filter>'
  + '</defs>'
  + '<g class="oc-aster-pieces" transform="translate(280 280)">'
  + [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => '<g class="outer-piece" data-i="' + (a / 30) + '" data-angle="' + a + '" transform="rotate(' + a + ')"><path class="segment-bloom" d="M-34 -184 A187 187 0 0 1 34 -184"/><path class="segment-face" d="M-34 -184 A187 187 0 0 1 34 -184"/></g>').join('')
  + '</g>'
  + '<g class="oc-aster-inner" transform="translate(280 280)">'
  + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => '<g class="inner-piece" data-i="' + (a / 45) + '" data-angle="' + a + '" transform="rotate(' + a + ')"><path class="inner-bloom" d="M-18 -138 A139 139 0 0 1 18 -138"/><path class="inner-face" d="M-18 -138 A139 139 0 0 1 18 -138"/></g>').join('')
  + '</g>'
  + '<g class="oc-aster-alive" transform="translate(280 280)">'
  + '<circle class="core-halo" r="98"/>'
  + '<circle class="core-body" r="28"/>'
  + '<circle class="core-innerglow" r="17"/>'
  + '<circle class="core-center" r="9.2"/>'
  + '<circle class="wave-ripple" id="ocAsterRipple" r="62"/>'
  + '</g>'
  + '</svg>';

export interface AsterVars {
  model: string;
  aura1: string;
  aura2: string;
  auraStroke: string;
}
const IDLE_VARS: AsterVars = { model: '#8ff15a', aura1: '#9bf5d6', aura2: '#5fbfbe', auraStroke: '#5fbfbe' };

export function AsterSvg({ vars }: { vars?: AsterVars }) {
  const markup = vars
    ? ASTER_SVG
      .replace('--model:#6d86ff', `--model:${vars.model}`)
      .replace('--aura1:#dff7ff', `--aura1:${vars.aura1}`)
      .replace('--aura2:#99b8d8', `--aura2:${vars.aura2}`)
      .replace('--auraStroke:#bbd1e2', `--auraStroke:${vars.auraStroke}`)
    : ASTER_SVG;
  return <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />;
}

export const ASTER_IDLE_VARS = IDLE_VARS;

/**
 * Run the legacy physics loop against an ASTER svg element.
 * Signature mirrors `_beginCoreMotion` but is driven by React state snapshots.
 */
export function useCoreMotion(ref: React.RefObject<HTMLElement | null>, state: CoreStateSnapshot) {
  const motionRef = useRef<Record<string, unknown> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const svg = ref.current?.querySelector?.('.oc-aster-svg') as SVGSVGElement | null;
    if (!svg) return undefined;
    const outerPieces = Array.from(svg.querySelectorAll('.outer-piece')).map((el, i) => ({ el: el as SVGGElement, i, angle: Number((el as SVGGElement).dataset.angle), position: 0, velocity: 0 }));
    const innerPieces = Array.from(svg.querySelectorAll('.inner-piece')).map((el, i) => ({ el: el as SVGGElement, i, angle: Number((el as SVGGElement).dataset.angle) }));
    const outerGroup = svg.querySelector('.oc-aster-pieces') as SVGGElement | null;
    const innerGroup = svg.querySelector('.oc-aster-inner') as SVGGElement | null;
    const core = svg.querySelector('.oc-aster-alive') as SVGGElement | null;
    const halo = svg.querySelector('.core-halo') as SVGCircleElement | null;
    const ripple = svg.querySelector('.wave-ripple') as SVGCircleElement | null;
    if (outerPieces.length !== 12 || innerPieces.length !== 8 || !outerGroup || !innerGroup || !core || !halo || !ripple) return undefined;

    const pairColors: Record<CoreModelClass, [string, string]> = { fast: ['#ffe24d', '#54ff77'], medium: ['#41e2ff', '#4f7cff'], strong: ['#5564ff', '#9a55ff'], moe: ['#ff52be', '#ff855f'] };
    const moodColors: Record<CoreMood, [string, string]> = { calm: ['#9bf5d6', '#5fbfbe'], attentive: ['#d7f0ff', '#87b7ff'], curious: ['#cfb7ff', '#73e3ff'], alert: ['#ffd67f', '#ff7ea6'] };
    const hexToRgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] as [number, number, number];
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const blend = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const rgbCss = (a: [number, number, number]) => `rgb(${a.map((v) => Math.round(v)).join(',')})`;
    const nearby = (a: number, b: number, n: number) => { const d = Math.abs(a - b); return Math.min(d, n - d); };

    const motion = {
      outer: outerPieces,
      inner: innerPieces,
      svg,
      outerGroup,
      innerGroup,
      core,
      halo,
      ripple,
      mode: 'idle' as CoreMode,
      model: 'medium' as CoreModelClass,
      mood: 'attentive' as CoreMood,
      modeBlend: { idle: 1, thinking: 0, generating: 0, tool: 0 },
      currentColor: hexToRgb('#5c86ff'),
      currentAura1: hexToRgb('#d7f0ff'),
      currentAura2: hexToRgb('#87b7ff'),
      seconds: 0,
      last: null as number | null,
      outerAngle: 0,
      innerAngle: 0,
      colors: [state.primary, state.secondary] as [string, string],
      activityColors: [state.secondary, state.primary] as [string, string],
    };
    motionRef.current = motion as unknown as Record<string, unknown>;

    const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
    let frame = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const snap = stateRef.current;
      motion.model = snap.modelClass;
      motion.mode = snap.mode;
      motion.mood = snap.mood;
      motion.colors = [snap.primary, snap.secondary] as [string, string];
      motion.activityColors = [snap.secondary, snap.primary] as [string, string];

      const dt = motion.last === null ? 0 : Math.min(0.035, Math.max(0, (now - motion.last) / 1000));
      motion.last = now;
      if (document.hidden || reduced()) return;
      motion.seconds += dt;
      const s = motion.seconds;
      const targets: Record<CoreMode, number> = { idle: snap.mode === 'idle' ? 1 : 0, thinking: snap.mode === 'thinking' ? 1 : 0, generating: snap.mode === 'generating' ? 1 : 0, tool: snap.mode === 'tool' ? 1 : 0 };
      for (const k of Object.keys(targets) as (keyof typeof targets)[]) motion.modeBlend[k] += (targets[k] - motion.modeBlend[k]) * Math.min(1, dt * 6.5);
      const { idle: idleW, thinking: thinkW, generating: genW, tool: toolW } = motion.modeBlend;
      const modelPulse = 0.5 + 0.32 * Math.sin(s * (motion.model === 'fast' ? 0.26 : motion.model === 'medium' ? 0.2 : motion.model === 'strong' ? 0.17 : 0.23));
      const mp = pairColors[motion.model];
      const targetColor = blend(hexToRgb(mp[0]), hexToRgb(mp[1]), modelPulse);
      const mpd = moodColors[motion.mood];
      const targetAura1 = blend(hexToRgb(mpd[0]), targetColor, motion.mood === 'alert' ? 0.26 : motion.mood === 'curious' ? 0.18 : 0.1);
      const targetAura2 = blend(hexToRgb(mpd[1]), targetColor, motion.mood === 'alert' ? 0.18 : motion.mood === 'curious' ? 0.13 : 0.06);
      const k = Math.min(1, dt * 3.1);
      motion.currentColor = blend(motion.currentColor, targetColor, k);
      motion.currentAura1 = blend(motion.currentAura1, targetAura1, k);
      motion.currentAura2 = blend(motion.currentAura2, targetAura2, k);
      svg.style.setProperty('--model', rgbCss(motion.currentColor));
      svg.style.setProperty('--aura1', rgbCss(motion.currentAura1));
      svg.style.setProperty('--aura2', rgbCss(motion.currentAura2));
      svg.style.setProperty('--auraStroke', rgbCss(motion.currentAura2));

      const breath = Math.sin(s * (idleW + 1.65 * thinkW + 2.2 * genW + 1.35 * toolW + (motion.mood === 'calm' ? -0.1 : 0)));
      const outputPulse = (Math.sin(s * 2 * Math.PI * 1.5) + 1) / 2;
      const outerSpeed = 0.17 * idleW + 0.26 * thinkW + 0.42 * genW + 0.68 * toolW;
      const innerSpeed = 0.20 * idleW + 0.63 * thinkW + 0.48 * genW + 1.8 * toolW;
      motion.outerAngle = (motion.outerAngle + outerSpeed * dt * 180 / Math.PI) % 360;
      motion.innerAngle = (motion.innerAngle - innerSpeed * dt * 180 / Math.PI) % 360;
      const outerScale = 1 + idleW * 0.002 + thinkW * (0.013 + 0.008 * (0.5 + 0.5 * Math.sin(s * 2.2))) + genW * (0.020 + 0.014 * outputPulse) + toolW * 0.004;
      outerGroup.setAttribute('transform', `translate(280 280) rotate(${motion.outerAngle.toFixed(3)}) scale(${outerScale.toFixed(4)})`);
      innerGroup.setAttribute('transform', `translate(280 280) rotate(${motion.innerAngle.toFixed(3)})`);

      for (const piece of motion.outer) {
        let target = 0.45 * idleW * breath + genW * (1.1 + 3.6 * outputPulse);
        if (thinkW > 0.001) {
          const head = (s * 5.8) % 12;
          target += thinkW * (10.2 * Math.exp(-Math.pow(nearby(piece.i, head, 12), 2) / 1.35) + 9.1 * Math.exp(-Math.pow(nearby(piece.i, (head + 6) % 12, 12), 2) / 1.35) + 1.25 * Math.sin(s * 3.5 + piece.i * 0.48));
        }
        if (toolW > 0.001) {
          const d = nearby(piece.i, (s * 0.7) % 12, 12);
          target += toolW * 1.6 * Math.exp(-d * d / 1.2);
        }
        piece.velocity += (target - piece.position) * 75 * dt;
        piece.velocity *= Math.exp(-12.6 * dt);
        piece.position += piece.velocity * dt;
        const amount = Math.max(-32, Math.min(32, piece.position));
        piece.el.setAttribute('transform', `rotate(${piece.angle}) translate(0 ${(-amount).toFixed(3)})`);
        const phase = s * (0.35 * idleW + 1.6 * thinkW + 1.3 * genW + 2 * toolW) + piece.i * (0.52 * genW - 0.2 * idleW - 0.45 * toolW);
        const head = (s * 5.8) % 12;
        const crestLight = thinkW * (0.12 * Math.exp(-Math.pow(nearby(piece.i, head, 12), 2) / 1.35) + 0.12 * Math.exp(-Math.pow(nearby(piece.i, (head + 6) % 12, 12), 2) / 1.35));
        const bright = 0.02 * idleW + 0.10 * thinkW + crestLight + genW * (0.18 + 0.22 * (0.5 + 0.5 * Math.sin(phase))) + toolW * (0.05 + 0.1 * (0.5 + 0.5 * Math.sin(phase)));
        const face = piece.el.querySelector('.segment-face') as SVGPathElement | null;
        const bloom = piece.el.querySelector('.segment-bloom') as SVGPathElement | null;
        if (face) face.style.opacity = (0.66 + bright).toFixed(3);
        if (bloom) bloom.style.strokeOpacity = (0.1 + genW * 0.24 + toolW * 0.08 + thinkW * 0.18).toFixed(3);
      }
      for (const piece of motion.inner) {
        const phase = s * (0.4 * idleW + 3.2 * thinkW + 1.8 * genW + 7.2 * toolW) - piece.i * 0.78;
        const signal = (Math.sin(phase) + 1) / 2;
        const alpha = 0.1 * idleW + (0.28 + 0.65 * signal) * thinkW + (0.18 + 0.95 * signal) * toolW + (0.16 + 0.28 * signal) * genW;
        const face = piece.el.querySelector('.inner-face') as SVGPathElement | null;
        const bloom = piece.el.querySelector('.inner-bloom') as SVGPathElement | null;
        if (face) face.style.opacity = alpha.toFixed(3);
        if (bloom) bloom.style.opacity = (alpha * (0.38 + 0.2 * thinkW + 0.34 * toolW)).toFixed(3);
        const lift = 1.8 * signal * thinkW + 2.8 * signal * toolW + 0.85 * signal * genW + 0.08 * signal * idleW;
        piece.el.setAttribute('transform', `rotate(${piece.angle}) translate(0 ${(-lift).toFixed(3)})`);
      }
      let coreScale = 1 + (0.006 * idleW + 0.012 * thinkW + 0.018 * genW + 0.014 * toolW) * breath;
      if (motion.mood === 'curious') coreScale += 0.028 * Math.sin(s * 2.8);
      if (motion.mood === 'calm') coreScale = 1 + 0.006 * Math.sin(s * 0.95);
      if (motion.mood === 'alert') coreScale += 0.014 * Math.sin(s * 4);
      if (genW > 0.001) coreScale += 0.038 * outputPulse * genW;
      if (toolW > 0.001) coreScale += 0.012 * (0.5 + 0.5 * Math.sin(s * 5.5)) * toolW;
      halo.style.opacity = (0.18 + 0.08 * idleW + 0.18 * thinkW + 0.28 * genW + 0.25 * toolW + (motion.mood === 'alert' ? 0.1 : 0) + (motion.mood === 'curious' ? 0.05 : 0)).toFixed(3);
      ripple.setAttribute('r', (62 + Math.min(120, 0)).toFixed(2));
      core.setAttribute('transform', `translate(280 280) rotate(${(motion.innerAngle * 0.35).toFixed(3)}) scale(${coreScale.toFixed(4)})`);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ref]);
}
