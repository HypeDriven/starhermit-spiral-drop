// Spiral Drop — graphics quality model: presets, per-category overrides, StarHermit
// hardware-level detection, per-preset budgets and a cost summary. Pure (no three.js) so the settings panel, the
// renderer and the unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],
  detail: ['plain', 'detailed'],
  particles: ['low', 'high'],
  background: ['static', 'animated'],
};

// Each preset is a row of tiers plus a render scale (multiplies the device
// pixel ratio) and a device-pixel-ratio cap.
const TABLE = {
  low: { scale: 1, dprCap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', detail: 'plain', particles: 'low', background: 'static' },
  balanced: { scale: 1, dprCap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', detail: 'detailed', particles: 'low', background: 'animated' },
  high: { scale: 1, dprCap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' },
  ultra: { scale: 1.25, dprCap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', detail: 'detailed', particles: 'high', background: 'animated' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

// Auto picks the preset from the StarHermit hardware level (src/gpu-level.js → window.StarHermitGpu, a
// classic script loaded before main.js; 0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX 5090, each level
// ≈ 1.23× the one below): Low from 0, Balanced from 4, High from 10, Ultra from 17. Phones, tablets and
// ≤ 4 GB machines are capped at level 9 (Balanced).
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  if (!G) return LEVELS.balanced;
  return G.detectLevel({ webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') });
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it
 * (Low → level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Gameplay and
 * hit areas are identical on every preset — only visuals change.
 *   material   lit-surface shader: Lambert (Low), Standard (Balanced), Physical with clearcoat (High/Ultra)
 *   curve      arc segments per ring sector (ExtrudeGeometry curveSegments); bevel segments on Surface detail
 *   bevel      bevel segments on rounded ring edges (Surface detail: detailed)
 *   round      ball/pillar/base/sky tessellation (radial segments of the ball and pillar)
 *   texture    procedural grain texture size in px (fluting is twice as wide)
 *   puffs      landing-dust particle pool at Particles "high" (shards: half; Particles "low": a fifth),
 *              scaled with the level inside the preset
 *   motes      drifting ambient motes at Particles "high" (none on "low"), scaled with the level
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 *   panelBlur  frosted (CSS backdrop-filter) panels over the live tower — High/Ultra only
 */
export const BUDGETS = {
  low: { material: 'lambert', curve: 12, bevel: 1, round: 16, texture: 64, puffs: 1000, motes: 80, bloomRes: 0.5, aoRes: 0.5, panelBlur: false },
  balanced: { material: 'standard', curve: 20, bevel: 1, round: 24, texture: 128, puffs: 1500, motes: 120, bloomRes: 0.5, aoRes: 0.5, panelBlur: false },
  high: { material: 'physical', curve: 28, bevel: 2, round: 28, texture: 128, puffs: 2000, motes: 160, bloomRes: 0.5, aoRes: 0.5, panelBlur: true },
  ultra: { material: 'physical', curve: 40, bevel: 3, round: 40, texture: 256, puffs: 3000, motes: 260, bloomRes: 1, aoRes: 1, panelBlur: true },
};
export const PUFF_MAX = 6000;
export const MOTE_MAX = 520;

/** A preset's concrete budget for a hardware level and Particles tier (counts scale ≤ 2× within the preset). */
export function budgetFor(preset, level, particles = 'high') {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.puffs = Math.min(PUFF_MAX, Math.round(b.puffs * k * (particles === 'low' ? 0.2 : 1)));
  b.motes = particles === 'low' ? 0 : Math.min(MOTE_MAX, Math.round(b.motes * k));
  return b;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const preset = PRESETS.includes(s.preset) ? s.preset : (PRESETS.includes(detected) ? detected : 'balanced');
  const row = TABLE[preset];
  const userScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto: !PRESETS.includes(s.preset), scale: row.scale * userScale, userScale, dprCap: row.dprCap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level, out.particles);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Choosing a preset clears every per-category override (scale/adaptive/fps are kept). */
export function choosePreset(saved, preset) {
  const s = saved || {};
  const out = { preset: PRESETS.includes(preset) ? preset : 'auto' };
  for (const k of ['render_scale', 'adaptive', 'show_fps']) if (k in s) out[k] = s[k];
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

const DESCRIBE_EN = {
  noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoFull: 'full ambient occlusion',
  bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing',
};

/** Cost summary, e.g. "2048² shadows · bloom · SMAA · 1280×800 px". `words` localizes it. */
export function describe(r, pixels, words) {
  const w = Object.assign({}, DESCRIBE_EN, words || {});
  const parts = [
    r.shadows === 'off' ? w.noShadows : w.shadows.replace('{n}', SHADOW_MAP[r.shadows]),
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoFull : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.reflections === 'on' ? w.reflections : null,
    r.antialias === 'off' ? w.noAA : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
