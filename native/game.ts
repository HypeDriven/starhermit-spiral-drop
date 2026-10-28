// The browser build's pure game scripts, unchanged and shared with the node
// tests and server.js: the rules (src/rules.js: the 60 Hz deterministic
// simulation, commands, scoring, hints, replay envelopes) and the content
// (src/content.js: themes, layer generation, the 40 Journey stages, the
// Daily, Practice presets, Challenges, lessons), evaluated as classic
// scripts (UMD) so their globals SpiralRules / SpiralContent are this
// module's exports, typed for this client. The save model and progression
// (src/progress.js) are an ES module.
import { loadClassic } from "starhermit:script";
import * as progressMod from "../src/progress.js";

loadClassic("src/rules.js");
loadClassic("src/content.js");

export interface Layer { offset: number; gapCenter: number; gapWidth: number; danger: [number, number][]; drift: number }
export interface Params {
  layers: number; gapWidth: number; dangerProb: number; dangerArc: number; dangerExtraProb?: number;
  driftProb: number; driftSpeed: number; comboEvery: number;
}
export interface Content {
  id: string; version?: number; seed: string; name?: string; params: Params; theme?: string; mechanics?: { smashStreak: number };
  parTicks?: number; moveLimitTicks?: number; timeLimitTicks?: number; index?: number; mastery?: boolean; day?: string;
  description?: string; practice?: string; brief?: string; goal?: { type: string; ticks?: number };
}
export interface Lesson extends Content { name: string; brief: string; goal: { type: string; ticks?: number } }
export interface Theme {
  id: string; name: string; skyTop: string; skyBottom: string; fog: string; pillar: string; safe: string; safeEmissive: string;
  danger: string; accent: string; ball: string; base: string;
}
export interface Config {
  contentId: string; contentVersion: number; seed: string; mode: string; layers: Layer[]; mechanics: { smashStreak: number };
  moveLimitTicks: number; timeLimitTicks: number; parTicks: number; allowUndo: boolean;
}
export interface SimEvent { type: string; layer?: number; streak?: number; falls?: number; precision?: boolean; reason?: string; quality?: number; dir?: number }
export interface Command { type: string; dir?: number; id?: string; tick?: number }
export interface Stats { moves: number; rotationTicks: number; invalidActions: number; undos: number; layersPassed: number; bestFall: number; smashes: number }
export interface ScoreParts { layers: number; combo: number; precision: number; smash: number; completion: number; timeBonus: number }
export interface State {
  config: Config; tick: number; phase: "rest" | "falling" | "resolving" | "terminal"; towerAngle: number; rotating: number;
  ball: { layer: number; y: number; vy: number }; streak: number; score: ScoreParts; stats: Stats;
  undoStack: unknown[]; terminal: { reason: string; detail: unknown } | null; inputLog: Command[]; lastEvent: SimEvent | null;
}
export interface Envelope { config: Config; inputLog: Command[]; result: { reason: string; score: number } }

interface RulesApi {
  TICK_RATE: number; SMASH_STREAK: number; MAX_TICKS: number;
  hashString(s: string): number;
  createGame(cfg: Config): State;
  applyCommand(s: State, c: Command): { ok: boolean; reason?: string; duplicate?: boolean };
  step(s: State): State;
  hint(s: State): { action: string; degreesOff?: number; reason?: string };
  legalActions(s: State): string[];
  gapAlignment(s: State, layer: number): { delta: number; clear: boolean; quality: number };
  totalScore(s: State): number;
  angleDelta(a: number, b: number): number;
  buildEnvelope(s: State, startedAt: number): Envelope;
}
interface ContentApi {
  THEMES: Theme[]; CVD_THEME_PATCH: Partial<Theme>;
  PRACTICE: { id: string; name: string; params: Params }[];
  CHALLENGES: Content[]; LESSONS: Lesson[];
  journeyStages(): Content[];
  dailyFor(d: Date): Content;
  makeLayers(seed: string, p: Params): Layer[];
  toConfig(c: Content, o: { mode: string; allowUndo?: boolean }): Config;
  themeById(id: string): Theme;
}
export interface Progress {
  stages: Record<string, { stars: number; score: number }>; lessons: Record<string, boolean>; achievements: Record<string, number>;
  lifetimeLayers: number; dailyStreak: { last: string | null; count: number }; bestScores: Record<string, number>; nextStage: number;
}
export interface Save { v: number; progress: Progress; telemetry: Record<string, number> }
export interface Options { captions: boolean; cvdPalette: boolean; leftHanded: boolean; holdToRotate: boolean }
export interface Achievement { key: string; name: string; desc: string }
interface ProgressApi {
  ACHIEVEMENTS: Achievement[];
  emptySave(): Save; normalize(raw: unknown): Save; mergeSave(remote: unknown, local: unknown): Save; sameSave(a: unknown, b: unknown): boolean;
  readForeign(text: string): { save: Save; options: Partial<Options> } | null;
  DEFAULT_OPTIONS: Options; OPTION_KEYS: (keyof Options)[]; BROWSER_KEYS: string[];
  pickOptions(raw: unknown): Partial<Options>;
  dayKey(ms: number): string;
  applyRun(p: Progress, run: {
    mode: string; content: Content; state: State; won: boolean; total: number; lessonGoalMet: boolean; lesson: Lesson | null; nowMs: number; now: number;
  }, stages: Content[]): { stars: number | null; nextIndex: number | null; newly: Achievement[]; lessonDone: boolean };
}

const g = globalThis as unknown as { SpiralRules: RulesApi; SpiralContent: ContentApi };
export const Rules = g.SpiralRules;
export const Data = g.SpiralContent;
export const Prog = progressMod as unknown as ProgressApi;
