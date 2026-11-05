// The look per graphics level: the engine's level settings (levelSettings():
// shadows and their map size, AO, bloom resolution, grade, anti-aliasing) plus
// the browser build's art budgets (src/gfx.js BUDGETS) keyed by the runtime's
// quality tier (frame().quality), with the particle pools scaled within the
// tier by the level's particle budget (at most 2×). The runtime owns the rest
// of what the old Graphics panel did: Auto and the level choice, render scale
// and the pixel-ratio cap, adaptive resolution, the frame-rate limit and
// readout. The old panel's per-effect overrides are not offered (the runtime's
// Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Lit-surface shader: Lambert (Low), Standard (Balanced), Physical with clearcoat (High/Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Arc segments per ring sector; bevel segments on rounded ring edges (Surface detail). */
  curve: number;
  bevel: number;
  /** Ball / pillar / base tessellation. */
  round: number;
  /** Procedural grain texture size in px (fluting is twice as wide). */
  texture: number;
  /** Landing-dust pool (shards: half); motes. */
  puffs: number;
  motes: number;
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map: the level's size (0 = off). */
  shadows: number;
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  /** Bevelled rings, clearcoat, grain and fluting, soft particles. */
  detailed: boolean;
  particles: "low" | "high";
  /** Sky bands and stars. */
  animatedSky: boolean;
  /** The composer ran (anything but plain MSAA): the sky is pre-darkened for its tone mapping. */
  post: boolean;
  budget: Budget;
}

type Art = Pick<Look, "reflections" | "detailed" | "particles" | "animatedSky">;
const ART: Record<QualityTier, Art> = {
  low: { reflections: false, detailed: false, particles: "low", animatedSky: false },
  balanced: { reflections: true, detailed: true, particles: "low", animatedSky: true },
  high: { reflections: true, detailed: true, particles: "high", animatedSky: true },
  ultra: { reflections: true, detailed: true, particles: "high", animatedSky: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", curve: 12, bevel: 1, round: 16, texture: 64, puffs: 1000, motes: 80 },
  balanced: { material: "standard", curve: 20, bevel: 1, round: 24, texture: 128, puffs: 1500, motes: 120 },
  high: { material: "physical", curve: 28, bevel: 2, round: 28, texture: 128, puffs: 2000, motes: 160 },
  ultra: { material: "physical", curve: 40, bevel: 3, round: 40, texture: 256, puffs: 3000, motes: 260 },
};
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };
const PUFF_MAX = 6000, MOTE_MAX = 520;

/** The look for a graphics level's settings: gfx.js resolve + budgetFor. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  const art = ART[preset];
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.puffs = Math.min(PUFF_MAX, Math.round(b.puffs * k * (art.particles === "low" ? 0.2 : 1)));
  b.motes = art.particles === "low" ? 0 : Math.min(MOTE_MAX, Math.round(b.motes * k));
  const post = !!s.ao || !!s.bloom || s.grade || s.antialias === "fxaa" || s.antialias === "smaa";
  return {
    preset, ...art, post, budget: b,
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
  };
}
