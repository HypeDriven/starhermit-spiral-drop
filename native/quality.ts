// The look per graphics level: the browser build's four presets and budgets
// (src/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the particle pools scaled within the tier by the level
// (frame().levelIndex, at most 2×), as the browser build scaled them by its
// hardware level. The runtime owns the rest of what the old Graphics panel
// did: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution, the frame-rate limit and readout. The old panel's
// per-effect overrides are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
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
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
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

/** gfx.js TABLE. */
const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget" | "post">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, detailed: false, particles: "low", animatedSky: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, detailed: true, particles: "low", animatedSky: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, detailed: true, particles: "high", animatedSky: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, detailed: true, particles: "high", animatedSky: true },
};
/** gfx.js BUDGETS. */
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", curve: 12, bevel: 1, round: 16, texture: 64, puffs: 1000, motes: 80, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", curve: 20, bevel: 1, round: 24, texture: 128, puffs: 1500, motes: 120, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", curve: 28, bevel: 2, round: 28, texture: 128, puffs: 2000, motes: 160, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", curve: 40, bevel: 3, round: 40, texture: 256, puffs: 3000, motes: 260, bloomRes: 1, aoRes: 1 },
};
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };
const PUFF_MAX = 6000, MOTE_MAX = 520;

/** The look for a quality tier at a level index (0 … 9): gfx.js resolve + budgetFor. */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  const row = TABLE[preset];
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.puffs = Math.min(PUFF_MAX, Math.round(b.puffs * k * (row.particles === "low" ? 0.2 : 1)));
  b.motes = row.particles === "low" ? 0 : Math.min(MOTE_MAX, Math.round(b.motes * k));
  const post = row.ao !== "off" || row.bloom || row.grade || row.antialias === "fxaa" || row.antialias === "smaa";
  return { preset, ...row, post, budget: b };
}
