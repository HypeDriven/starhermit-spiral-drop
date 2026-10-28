// Spiral Drop on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (src/rules.js) and content
// (src/content.js) are the browser build's, unchanged; this module is what
// src/main.js did around them — the session state machine (title → setup →
// the 3-2-1-Drop! countdown → active ⇄ paused → results), starting every
// mode (Journey, Daily, Practice, Challenges, Learn), rotating the tower from
// keys, pads, the round on-screen buttons (held, or toggled with the game's
// option) and sideways drags, undo and hints (Practice and Learn), the
// lesson goals, sounds and captions per rules event, progression and
// achievements, posting a finished Journey, Daily or Challenge run to the
// high-score board, watching the replay of the last run, the attract tower
// behind the title, and the lifecycle (a hidden window pauses the run, the
// countdown included, as visibilitychange did). Screens are drawn by
// screens.ts (starhermit:ui), the tower by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps at 60 Hz, one rules tick (TICK_RATE 60)
// a step: each step applies the rotation held then (the browser build sent
// rotateStart / rotateStop as keys went down and up, between its ticks),
// then runs the tick — so pauses, a hidden window and slow frames never cost
// time, and play scripts replay exactly. The countdown's beats (700 ms, then
// 550 ms to go), the drag's 130 ms idle stop and the toasts count the same
// steps. The tower is drawn between the last two steps (the interpolation),
// as the browser build drew it with its accumulator's alpha.
import "./i18n.ts";
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { isDown, isKeyDown, onAction, onPointerButton, onPointerMove, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Data, Prog, Rules, type Achievement, type Content, type Envelope, type Lesson, type SimEvent, type State } from "./game.ts";
import * as audio from "./audio.ts";
import { N, S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens, hudRects } from "./screens.ts";
import { applyContrast, initStyles } from "./style.ts";

export type Screen = "title" | "setup" | "journey" | "practice" | "challenges" | "learn" | "scores" | "help" | "settings" | "pause" | "results" | "erase";
export type Phase = "title" | "countdown" | "active" | "paused" | "results" | "replay";
export type Mode = "journey" | "daily" | "practice" | "challenge" | "learn";
export interface SetupInfo { title: string; description: string; assists: string; rules: string[]; duration: string; ranked: boolean; start: () => void }
export interface Results {
  reason: string; won: boolean; headline: string; components: [string, number][]; total: number;
  layers: string; bestFall: number; smashes: number; time: string; invalid: number; stars: number | null; nextLabel: string | null;
  achievements: Achievement[]; lb: platform.Posted | "posting" | null;
}
export interface ScoresData { local: { key: string; score: number }[]; global: platform.BoardRow[]; friends: platform.BoardRow[]; tab: "local" | "global" | "friends" }

const DT = 1 / 60;
export const app = {
  screen: "title" as Screen | null,
  openedFrame: 0,
  focusNext: null as string | null,
  phase: "title" as Phase,
  state: null as State | null,
  content: null as Content | null,
  mode: "journey" as Mode,
  allowUndo: false,
  lesson: null as Lesson | null,
  lessonGoalMet: false,
  setup: null as (() => SetupInfo) | null,
  countdown: null as string | null,
  results: null as Results | null,
  replayEnv: null as Envelope | null,
  nextStage: null as Content | null,
  scores: null as ScoresData | null,
  /** Where Settings / How to Play go back to (main.js onHome: the pause panel mid-run, else the title). */
  backTo: "title" as "title" | "pause",
  toast: null as { text: string; until: number } | null,
  caption: null as { text: string; until: number } | null,
  /** The round on-screen buttons this frame (−1, 0, 1), from screens.ts. */
  buttonDir: 0,
};
let steps = 0;
const now = (): number => steps / 60;
export const fresh = (): boolean => frame().frame !== app.openedFrame;
export const stages: Content[] = Data.journeyStages();
let daily: Content = Data.dailyFor(new Date(platform.nowMs()));
export function today(): Content {
  const d = Data.dailyFor(new Date(platform.nowMs()));
  if (d.id !== daily.id) daily = d;
  return daily;
}

// ------------------------------------------------------------------ helpers
const spoken: string[] = [];
let spokenAssertive = false;
/** The live regions (polite / assertive): at most one announcement a frame, joined. */
export function announce(text: string, assertive = false): void {
  if (!text) return;
  spoken.push(text);
  spokenAssertive ||= assertive;
}
export function toast(text: string, ms = 2600): void { app.toast = { text, until: now() + ms / 1000 }; }
export function caption(text: string): void { app.caption = { text, until: now() + 1.6 }; }
const CAPTIONS: Partial<Record<audio.Sfx, string>> = {
  fallStart: N("Drop"), smash: N("Danger sector smashed"), danger: N("Danger sector — run over"), invalid: N("Action not available"),
  undo: N("Undone"), win: N("Stage complete"), achievement: N("Achievement unlocked"),
};
/** audio.js event with its caption hook (main.js onCaption: shown when Captions is on). */
export function sound(ev: audio.Sfx, data?: SimEvent): void {
  audio.play(ev);
  if (!platform.options.captions) return;
  let text: string | null = CAPTIONS[ev] ? T(CAPTIONS[ev]!) : null;
  if (ev === "passThrough") text = T("Layer passed ×{n}", { n: Math.min(6, data?.streak || 1) });
  if (ev === "land") {
    if (data && (data.falls ?? 0) > 1) text = T("Combo ×{n}", { n: data.falls! });
    if (data && data.precision) text = T("Precision landing");
  }
  if (text) caption(text);
}
const pending: (() => void)[] = [];
/** A widget's press, run once the frame's UI is built (state changes mid-build would break later widgets). */
export function later(fn: () => void): void { pending.push(fn); }
export function themeFor(c: Content): ReturnType<typeof Data.themeById> { return Data.themeById(c.theme || "ember"); }
/** main.js contentName: the player-facing name of any run content. */
export function contentName(c: Content | null): string {
  if (!c) return "";
  if (c.id && c.id.startsWith("daily-") && c.day) return T("Daily Drop — {date}", { date: c.day });
  return c.name ? T(c.name) : c.id;
}
export const smashStreak = (s: State): number => (s.config.mechanics && s.config.mechanics.smashStreak) || Rules.SMASH_STREAK;
export function journeyUnlocked(): number {
  const p = platform.progress();
  let u = 0;
  for (let i = 0; i < stages.length; i++) { if (p.stages[stages[i]!.id]) u = i + 1; else break; }
  return Math.min(u, stages.length - 1);
}
export function nextJourneyIndex(): number {
  const p = platform.progress();
  for (let i = 0; i < stages.length; i++) if (!p.stages[stages[i]!.id]) return i;
  return stages.length - 1;
}

// ------------------------------------------------------------------ screens
export function open(s: Screen | null, focus: string | null = null): void {
  app.screen = s;
  app.openedFrame = frame().frame;
  app.caption = null; // a round's cue caption does not carry over onto a panel
  app.focusNext = s ? (focus ?? firstFocus(s)) : null;
  ui.setFocus(null);
}
function firstFocus(s: Screen): string | null {
  switch (s) {
    case "title": return "btn-play";
    case "setup": return "btn-start";
    case "journey": return `stage-${journeyUnlocked() + 1}`;
    case "pause": return "btn-resume";
    case "results": return "btn-primary";
    case "erase": return "btn-erase-no";
    default: return "btn-back";
  }
}
export function showTitle(): void {
  open("title");
  announce(T("Title screen. {summary}", { summary: titleSummary() }));
}
export function titleSummary(): string {
  const p = platform.progress();
  const done = Object.keys(p.stages).length;
  const sync = platform.syncState();
  const label = sync === "synced" ? N("cloud synced") : sync === "saving" || sync === "connecting" ? N("saving…") : sync === "error" ? N("cloud sync issue") : N("offline");
  return T("{done}/{total} journey stages · daily streak {streak} · {ach}/5 achievements", {
    done, total: stages.length, streak: p.dailyStreak.count, ach: Object.keys(p.achievements).length,
  }) + (platform.signedIn() ? " · " + (platform.displayName() || T("Player")) + " · " + T(label) : " · " + T("offline mode"));
}
/** main.js onHome: back to the pause panel mid-run, else the title. */
export function home(): void { if (app.phase === "paused") open("pause"); else showTitle(); }
export function showSettings(): void { app.backTo = app.phase === "paused" ? "pause" : "title"; open("settings"); }
export function showHelp(): void { app.backTo = app.phase === "paused" ? "pause" : "title"; open("help"); }
export function showJourney(): void { open("journey"); announce(T("Journey map opened.")); }
export function showSetup(fn: () => SetupInfo): void { app.setup = fn; open("setup"); }
export function showScores(): void {
  const p = platform.progress();
  const local = Object.entries(p.bestScores).map(([key, score]) => ({ key, score })).sort((a, b) => b.score - a.score);
  const data: ScoresData = { local, global: [], friends: [], tab: app.scores?.tab ?? "local" };
  app.scores = data;
  open("scores");
  void platform.entries(false).then((rows) => { data.global = rows; });
  if (platform.signedIn()) void platform.entries(true).then((rows) => { data.friends = rows; });
}
/** main.js bestKeyName: a local best-score key's name. */
export function bestKeyName(k: string): string {
  if (k.startsWith("daily-")) return T("Daily Drop — {date}", { date: k.slice(6) });
  const st = stages.find((x) => x.id === k);
  if (st) return T("Stage {n} — {name}", { n: st.index! + 1, name: T(st.name!) });
  const ch = Data.CHALLENGES.find((x) => x.id === k);
  if (ch) return T(ch.name!);
  const pr = k.startsWith("practice-") ? Data.PRACTICE.find((x) => x.id === k.slice(9)) : null;
  if (pr) return T("Practice — {name}", { name: T(pr.name) });
  const l = Data.LESSONS.find((x) => x.id === k);
  if (l) return T(l.name);
  return k;
}

// ------------------------------------------------------------------ mode setup (main.js modeSetupInfo)
const seconds = (layers: number): string => Math.ceil((layers * 3) / 10) * 10 + "s";
export function journeySetup(i: number): () => SetupInfo {
  const st = stages[i]!;
  return () => ({
    title: T("Stage {n} — {name}", { n: st.index! + 1, name: T(st.name!) }),
    description: T("Theme: {theme}. Par {n}s.", { theme: T(themeFor(st).name), n: Math.round(st.parTicks! / Rules.TICK_RATE) }),
    assists: T("none"),
    rules: [T("Reach the base by dropping through every ring’s gap."), T("Striped sectors end the run."), T("Falls of 3+ rings charge a smash.")],
    duration: seconds(st.params.layers), ranked: false,
    start: () => startRun(st, "journey", false),
  });
}
export function practiceSetup(id: string): () => SetupInfo {
  const pr = Data.PRACTICE.find((p) => p.id === id)!;
  const content: Content = {
    id: "practice-" + pr.id + "-" + Date.now(), version: 1, seed: "practice-" + pr.id + "-" + Math.floor(Math.random() * 1e9),
    params: pr.params, mechanics: { smashStreak: 3 }, theme: "tide", practice: pr.id,
  };
  return () => ({
    title: T("Practice — {name}", { name: T(pr.name) }),
    description: T("A fresh seeded tower. The seed is shown in results for inspection."),
    assists: T("undo + hints"),
    rules: [T("Undo rewinds the last drop."), T("Hints point at the nearest gap."), T("Nothing here affects ratings.")],
    duration: seconds(pr.params.layers), ranked: false,
    start: () => startRun(content, "practice", true),
  });
}
export function challengeSetup(id: string): () => SetupInfo {
  const ch = Data.CHALLENGES.find((c) => c.id === id)!;
  return () => {
    const rules = [T("Reach the base under the constraint.")];
    if (ch.moveLimitTicks) rules.push(T("Rotation budget: {n}s of total turning.", { n: Math.round(ch.moveLimitTicks / Rules.TICK_RATE) }));
    if (ch.timeLimitTicks) rules.push(T("Clock: {n}s.", { n: Math.round(ch.timeLimitTicks / Rules.TICK_RATE) }));
    return { title: T(ch.name!), description: T(ch.description!), assists: T("none"), rules, duration: T("1–3 min"), ranked: false, start: () => startRun(ch, "challenge", false) };
  };
}
export function dailySetup(): () => SetupInfo {
  return () => {
    const d = today();
    return {
      title: contentName(d),
      description: T("One shared seed per UTC day. Everyone gets the same tower. Your best run is kept."),
      assists: T("none"),
      rules: [T("Same seed and ruleset for all players today."), T("No undo or hints.")],
      duration: T("1–2 min"), ranked: false,
      start: () => startRun(d, "daily", false),
    };
  };
}
export function lessonSetup(i: number): () => SetupInfo {
  const l = Data.LESSONS[i]!;
  return () => ({
    title: T("Lesson {n} — {name}", { n: i + 1, name: T(l.name) }),
    description: T(l.brief), assists: T("hints"), rules: [T(l.brief)], duration: T("<1 min"), ranked: false,
    start: () => startRun(l, "learn", true, l),
  });
}

// ------------------------------------------------------------------ the run
let prevAngle = 0, prevBallY = 0;
let countdownStep = 0;
let resumeWithCountdown = false;
let cmdCounter = 0;
let replayIndex = 0;
let lastLayer = -1;
export function startRun(content: Content, mode: Mode, allowUndo: boolean, lesson: Lesson | null = null): void {
  app.content = content;
  app.mode = mode;
  app.allowUndo = allowUndo;
  app.lesson = lesson;
  const cfg = Data.toConfig(content, { mode, allowUndo });
  app.state = Rules.createGame(cfg);
  prevAngle = 0; prevBallY = 0;
  app.lessonGoalMet = false;
  resumeWithCountdown = false;
  cmdCounter = 0;
  lastLayer = -1;
  rotating = 0;
  toggleDir = 0;
  drag = null;
  render.applyTheme(themeFor(content));
  render.setLayers(cfg.layers);
  render.clearParticles();
  open(null);
  audio.setIntensity(0);
  audio.setSuspended(false);
  platform.bump("starts");
  platform.persist();
  beginCountdown();
}
function beginCountdown(): void {
  app.phase = "countdown";
  countdownStep = 0;
  app.countdown = null;
}
/** main.js runCountdown: "3", "2", "1", "Drop!" 700 ms apart, active 550 ms after "Drop!". */
function countdownTick(): void {
  const k = countdownStep++;
  const beats = ["3", "2", "1", T("Drop!")];
  if (k % 42 === 0 && k / 42 < 4) {
    app.countdown = beats[k / 42]!;
    announce(app.countdown);
    sound("countdown");
  }
  if (k === 3 * 42 + 33) {
    app.countdown = null;
    app.phase = "active";
    announce(T("Go. {objective}", { objective: objectiveText() }));
  }
}
export function objectiveText(): string {
  const c = app.content!;
  if (app.mode === "learn" && app.lesson) return T(app.lesson.brief);
  if (app.mode === "daily") return T("Daily Drop — reach the base.");
  if (app.mode === "journey") return T("Stage {n}: {name} — reach the base.", { n: c.index! + 1, name: T(c.name!) });
  if (app.mode === "challenge") return T(c.description!);
  return T("Reach the base.");
}
export function pause(): void {
  if (app.phase === "countdown") { resumeWithCountdown = true; app.countdown = null; }
  else if (app.phase !== "active") return;
  app.phase = "paused";
  stopRotation();
  audio.setSuspended(true);
  open("pause");
  announce(T("Paused. Resume is the first option."));
}
export function resume(): void {
  if (app.phase !== "paused") return;
  open(null);
  audio.setSuspended(false);
  if (resumeWithCountdown) { resumeWithCountdown = false; beginCountdown(); return; }
  app.phase = "active";
}
export function leaveToTitle(): void {
  stopRotation();
  app.phase = "title";
  resumeWithCountdown = false;
  app.state = null;
  app.countdown = null;
  audio.setSuspended(false);
  audio.setIntensity(0);
  attractTheme();
  showTitle();
}
export function restart(): void {
  platform.bump("retries");
  if (app.content) startRun(app.content, app.mode, app.allowUndo, app.lesson);
}
/** Results: "Next: <stage>" on a won Journey stage advances the content before starting. */
export function next(): void {
  if (app.mode === "journey" && app.nextStage) startRun(app.nextStage, "journey", false);
  else if (app.content) startRun(app.content, app.mode, app.allowUndo, app.lesson);
}

let rotating = 0;
function sendCmd(cmd: { type: string; dir?: number }): void {
  const s = app.state;
  if (!s || app.phase === "replay") return;
  const res = Rules.applyCommand(s, { ...cmd, id: "c" + (++cmdCounter) });
  if (!res.ok && !res.duplicate) {
    audio.play("invalid");
    caption(T("Action not available"));
  }
}
function setRotation(dir: number): void {
  if (dir === rotating) return;
  if (dir === 0) { rotating = 0; sendCmd({ type: "rotateStop" }); return; }
  rotating = dir;
  sendCmd({ type: "rotateStart", dir });
  sound("rotateStart");
}
function stopRotation(): void { setRotation(0); toggleDir = 0; drag = null; }
export function undo(): void {
  const s = app.state;
  if (!s || app.phase !== "active" || !s.config.allowUndo) return;
  sendCmd({ type: "undo" });
  if (s.lastEvent && s.lastEvent.type === "undo") { sound("undo"); rotating = s.rotating; }
}
export function canUndo(): boolean { return !!app.state && app.phase === "active" && Rules.legalActions(app.state).includes("undo"); }
export const canHint = (): boolean => app.phase === "active" && (app.mode === "practice" || app.mode === "learn");
export function hint(): void {
  if (!app.state || !canHint()) return;
  const h = Rules.hint(app.state);
  const msg = h.action === "wait" ? T("Gap aligned — hold still!")
    : h.action === "rotateLeft" ? T("Rotate left ({n}° to go)", { n: Math.round(h.degreesOff ?? 0) })
    : h.action === "rotateRight" ? T("Rotate right ({n}° to go)", { n: Math.round(h.degreesOff ?? 0) }) : T("Keep going.");
  toast(msg);
  announce(msg);
}

/** main.js onTerminal: progress, achievements, the score post, the results. */
function finishRun(): void {
  const s = app.state!;
  const c = app.content!;
  stopRotation();
  const total = Rules.totalScore(s);
  const won = s.terminal!.reason === "completed";
  platform.bump("roundEnds");
  const run = Prog.applyRun(platform.progress(), {
    mode: app.mode, content: c, state: s, won, total, lessonGoalMet: app.lessonGoalMet, lesson: app.lesson, nowMs: platform.nowMs(), now: Date.now(),
  }, stages);
  if (run.lessonDone) platform.bump("tutorialSteps");
  for (let i = 0; i < run.newly.length; i++) sound("achievement");
  platform.persist();
  app.nextStage = run.nextIndex != null ? stages[run.nextIndex]! : null;
  app.replayEnv = Rules.buildEnvelope(s, 0);
  app.phase = "results";
  const reasonText: Record<string, string> = {
    "completed": N("Base Reached!"), "danger-sector": N("Shattered on a danger sector"), "move-limit-exceeded": N("Out of rotation budget"),
    "time-expired": N("Time expired"), "abandoned": N("Run abandoned"), "tick-limit": N("Run timed out"),
  };
  const r: Results = {
    reason: s.terminal!.reason, won, headline: reasonText[s.terminal!.reason] ?? N("Run over"),
    components: [
      [N("Layers descended"), s.score.layers], [N("Combo bonuses"), s.score.combo], [N("Precision landings"), s.score.precision],
      [N("Smashes"), s.score.smash], [N("Completion"), s.score.completion], [N("Time bonus"), s.score.timeBonus],
    ],
    total, layers: s.stats.layersPassed + " / " + s.config.layers.length, bestFall: s.stats.bestFall, smashes: s.stats.smashes,
    time: (s.tick / Rules.TICK_RATE).toFixed(1) + "s", invalid: s.stats.invalidActions, stars: run.stars,
    nextLabel: app.nextStage ? app.nextStage.name! : null, achievements: run.newly, lb: null,
  };
  app.results = r;
  // Signed in: Journey, Daily and Challenge runs (no undo or hints) post to the high-score board.
  if (platform.signedIn() && (app.mode === "journey" || app.mode === "daily" || app.mode === "challenge")) {
    r.lb = "posting";
    void platform.postScore(total).then((res) => { r.lb = res; });
  }
  open("results");
  announce(T(won ? "Stage complete. Total score {n}." : "Run over. Total score {n}.", { n: total }), true);
  sound(won ? "win" : "danger");
}
export function resultsLbLine(): string | null {
  const lb = app.results?.lb;
  if (!lb) return null;
  if (lb === "posting") return S("lbPosting");
  return !lb.posted ? S("lbNotPosted") : lb.rank ? S("lbRank", { rank: lb.rank }) : S("lbPosted");
}

export function watchReplay(): void {
  const env = app.replayEnv;
  if (!env) return;
  app.state = Rules.createGame(env.config);
  app.phase = "replay";
  replayIndex = 0;
  prevAngle = app.state.towerAngle; prevBallY = app.state.ball.y;
  render.clearParticles();
  open(null);
  toast(T("Replay — Esc to exit"));
  announce(T("Watching replay of the recorded run."));
}

export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function invite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(S("copied")); } catch { toast(S("copyFailed") + ": " + link, 5000); }
}
export function eraseData(): void {
  platform.erase();
  toast(T("Progress erased."));
  showTitle();
}

// ------------------------------------------------------------------ keys and pads (main.js keydown)
let lastKeyDir = 0;
let closedFrame = -1;
/** One back/close a frame (a dialog's own Escape and the pause action both see it). */
export function closeOnce(fn: () => void): void {
  const f = frame().frame;
  if (f === closedFrame) return;
  closedFrame = f;
  later(fn);
}
onAction((e) => {
  if (ui.capturingKeys()) return;
  if (e.action === "left" || e.action === "right") {
    if (e.pressed) lastKeyDir = e.action === "left" ? -1 : 1;
    // rotation keys must not also walk the UI focus over the HUD
    if (app.screen === null) ui.setFocus(null);
    return;
  }
  if (!e.pressed || !fresh()) return;
  // Space on a focused button is the button's (main.js: let a focused control consume its activation key)
  const spaceOnButton = isKeyDown("Space") && ui.focused() !== null;
  switch (e.action) {
    case "pause":
      if (spaceOnButton) return;
      if (app.phase === "active" || app.phase === "countdown") { if (app.screen === null) later(pause); }
      else if (app.phase === "paused" && app.screen === "pause") closeOnce(resume);
      else if (app.phase === "replay") later(leaveToTitle);
      else if (app.screen === "settings" || app.screen === "help") closeOnce(home);
      else if (app.screen && app.screen !== "title" && app.screen !== "results" && app.phase === "title") closeOnce(showTitle);
      break;
    case "undo": if (app.screen === null) later(undo); break;
    case "hint": if (app.screen === null) later(hint); break;
  }
});

// ------------------------------------------------------------------ drags on the playfield (main.js pointer handlers)
let drag: { id: number; lastX: number; dir: number; idle: number } | null = null;
let toggleDir = 0;
const presses: { id: number; x: number; y: number }[] = [];
let lastTouch = -1e9;
function dragMove(id: number, x: number): void {
  if (!drag || drag.id !== id) return;
  const dx = (x - drag.lastX) / frame().scale;
  drag.lastX = x;
  if (Math.abs(dx) >= 1) { drag.dir = dx > 0 ? 1 : -1; drag.idle = 8; } // 130 ms idle stops
}
function dragEnd(id: number): void { if (drag && drag.id === id) drag = null; }
onTouch((e) => {
  lastTouch = frame().time;
  if (e.control) return;
  if (e.phase === "start") presses.push({ id: e.id, x: e.x, y: e.y });
  else if (e.phase === "move") dragMove(e.id, e.x);
  else dragEnd(e.id);
});
onPointerButton((e) => {
  if (e.button !== 0 || frame().time - lastTouch < 0.6) return;
  if (e.pressed) presses.push({ id: -1, x: e.x, y: e.y }); else dragEnd(-1);
});
onPointerMove((x) => { if (frame().time - lastTouch >= 0.6) dragMove(-1, x); });
/** Presses decided after the UI is built: one on the playfield (not on a HUD control) starts a drag. */
function decidePresses(wasPlaying: boolean): void {
  const list = presses.splice(0);
  if (!wasPlaying || app.phase !== "active" || app.screen !== null) return;
  for (const p of list) {
    if (hudRects.some((r) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height)) continue;
    drag = { id: p.id, lastX: p.x, dir: 0, idle: 0 };
  }
}
/** The rotation this step: keys and pads, else the round buttons (held or toggled), else a drag. */
function steering(): number {
  const l = isDown("left"), r = isDown("right");
  if (l || r) return l && r ? lastKeyDir : l ? -1 : 1;
  if (!platform.options.holdToRotate) return toggleDir;
  if (app.buttonDir) return app.buttonDir;
  if (drag && drag.dir) {
    if (--drag.idle <= 0) drag.dir = 0;
    return drag.dir;
  }
  return 0;
}
/** Toggle mode (Hold-to-rotate off): a press on a round button starts it turning that way, a second press stops it. */
export function toggleButton(dir: number): void { toggleDir = toggleDir === dir ? 0 : dir; }

// ------------------------------------------------------------------ the attract tower behind the menus
const ATTRACT_PARAMS = { layers: 12, gapWidth: 1.4, dangerProb: 0.3, dangerArc: 0.9, dangerExtraProb: 0.1, driftProb: 0.2, driftSpeed: 0.003, comboEvery: 4 };
const attractCfg = Data.toConfig({ id: "attract", version: 1, seed: "attract", params: ATTRACT_PARAMS }, { mode: "attract" });
let attract: State = Rules.createGame(attractCfg);
let attractPrev = { angle: 0, y: 0 };
function attractTheme(): void {
  render.applyTheme(Data.themeById("ember"));
  render.setLayers(attractCfg.layers);
  render.clearParticles();
}
/** main.js's 33 ms interval: the dummy state spins and drops, every other fixed step. */
function attractStep(): void {
  if (steps % 2) return;
  attractPrev = { angle: attract.towerAngle, y: attract.ball.y };
  attract.rotating = 1;
  Rules.step(attract);
  if (attract.phase === "terminal") { attract = Rules.createGame(attractCfg); attractPrev = { angle: 0, y: 0 }; }
}

// ------------------------------------------------------------------ the clock
let hidden = false;
function mapEvent(ev: SimEvent | null): void {
  if (!ev) return;
  render.handleEvent(ev);
  if (ev.type === "fallStart") sound("fallStart");
  else if (ev.type === "passThrough") { sound("passThrough", ev); audio.setIntensity(Math.min(1, (ev.streak ?? 0) / 4)); }
  else if (ev.type === "land") { sound("land", ev); audio.setIntensity(0); }
  else if (ev.type === "smash") sound("smash");
  else if (ev.type === "invalid") audio.play("invalid");
  else if (ev.type === "undo") sound("undo");
}
onFixedUpdate(() => {
  if (hidden) return;
  steps++;
  if (!app.state) { attractStep(); return; }
  if (app.phase === "countdown") { countdownTick(); return; }
  const s = app.state;
  if (app.phase === "replay") {
    prevAngle = s.towerAngle; prevBallY = s.ball.y;
    const log = app.replayEnv!.inputLog;
    while (replayIndex < log.length && log[replayIndex]!.tick! <= s.tick) Rules.applyCommand(s, log[replayIndex++]!);
    Rules.step(s);
    mapEvent(s.lastEvent);
    if (s.phase === "terminal") { toast(T("Replay finished.")); leaveToTitle(); }
    return;
  }
  if (app.phase !== "active") return;
  prevAngle = s.towerAngle; prevBallY = s.ball.y;
  if (s.phase !== "resolving") setRotation(steering()); else if (drag && drag.dir && --drag.idle <= 0) drag.dir = 0;
  Rules.step(s);
  mapEvent(s.lastEvent);
  // lesson 1's goal: rotate for N ticks in all — marked at once, play on
  const l = app.lesson;
  if (app.mode === "learn" && l && l.goal.type === "rotate" && !app.lessonGoalMet && s.stats.rotationTicks >= (l.goal.ticks ?? 0)) {
    app.lessonGoalMet = true;
    platform.progress().lessons[l.id] = true;
    platform.bump("tutorialSteps");
    platform.persist();
    toast(T("Good! Rotation mastered — now reach the base, or leave from pause."));
    announce(T("Lesson goal complete."));
  }
  const layer = Math.max(0, s.ball.layer + 1);
  if (layer !== lastLayer) {
    lastLayer = layer;
    announce(T("Layer {n} of {total}. Score {score}.", { n: layer, total: s.config.layers.length, score: Rules.totalScore(s) }));
  }
  if (s.phase === "terminal") finishRun();
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  audio.startMusic();
  render.setReducedMotion(preferences().reducedMotion);
  render.setPalette(platform.options.cvdPalette, Data.CVD_THEME_PATCH);
  applyLook();
  attractTheme();
  render.setActive(true);
  showTitle();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onOptionsChange(() => render.setPalette(platform.options.cvdPalette, Data.CVD_THEME_PATCH));
platform.onProgressMerged(() => { if (app.screen === "title") announce(T("Progress restored from your StarHermit cloud save.")); });
platform.onPlayer((on) => { if (!on) toast(S("signedOut"), 4000); });
onSessionEnded(() => toast(S("signedOut"), 4000));
onSuspend(() => {
  hidden = true;
  if (app.phase === "active" || app.phase === "countdown") pause();
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => { hidden = false; if (app.phase !== "paused") audio.setSuspended(false); });

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  const hc = ui.preferences().highContrast;
  applyContrast(hc);
  render.setHighContrast(hc);
  audio.update();
  const t = now();
  if (app.toast && t > app.toast.until) app.toast = null;
  if (app.caption && (t > app.caption.until || app.screen !== null)) app.caption = null;
});
const lerpAngle = (a: number, b: number, t: number): number => a + Rules.angleDelta(a, b) * t;
onRender((interp) => {
  const wasPlaying = app.phase === "active" && app.screen === null;
  hudRects.length = 0;
  drawScreens();
  for (const fn of pending.splice(0)) fn();
  decidePresses(wasPlaying);
  if (spoken.length) {
    const text = spoken.splice(0).join(" ").slice(0, 500);
    try { ui.announce(text, { politeness: spokenAssertive ? "assertive" : "polite" }); } catch { /* the runtime keeps the newest */ }
    spokenAssertive = false;
  }
  const f = frame();
  const s = app.state;
  let view: render.View;
  if (s) {
    const moving = app.phase === "active" || app.phase === "replay";
    const a = moving ? interp : 1;
    view = {
      towerAngle: lerpAngle(prevAngle, s.towerAngle, a), ballY: prevBallY + (s.ball.y - prevBallY) * a, phase: s.phase, streak: s.streak,
      smashReady: s.streak >= smashStreak(s), restRing: Math.min(s.ball.layer + 1, s.config.layers.length - 1), tick: s.tick,
    };
  } else {
    const a = interp;
    view = {
      towerAngle: lerpAngle(attractPrev.angle, attract.towerAngle, a), ballY: attractPrev.y + (attract.ball.y - attractPrev.y) * a,
      phase: attract.phase, streak: attract.streak, smashReady: false,
      restRing: Math.min(attract.ball.layer + 1, attract.config.layers.length - 1), tick: attract.tick,
    };
  }
  render.update(view, frameDt || DT, f.width, f.height);
});
