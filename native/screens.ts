// The browser build's DOM shell (src/ui.js + index.html + css/style.css) as
// starhermit:ui, built every frame over the tower: the play HUD (objective,
// score, layer progress, the smash charge, the clock or rotation budget,
// pause; the round rotate buttons with Undo and Hint between them, mirrored
// for left-handed controls), the countdown, the cue captions, the toast, and
// every screen (title, mode setup, journey map, practice, challenges, learn,
// scores, how to play, settings, pause, results, the erase confirmation) as
// a panel over the dimmed tower. The old media queries are layouts picked by
// the window's logical size: portrait phones (≤ 640 px wide: bottom sheets,
// smaller rotate buttons), short landscape (≤ 480 px tall: the HUD in two
// side columns) and the rest (centred panels, 720 px wide from 1024 px).
import { frame, openMenu } from "starhermit:engine";
import { bindings, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Data, Rules } from "./game.ts";
import { N, S, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import {
  app, bestKeyName, canHint, canUndo, challengeSetup, closeOnce, contentName, dailySetup, eraseData, fresh, hint, home, invite,
  journeySetup, journeyUnlocked, later, leaveToTitle, lessonSetup, next, nextJourneyIndex, objectiveText, open, pause, practiceSetup, restart,
  resultsLbLine, resume, showHelp, showJourney, showScores, showSettings, showSetup, showTitle, signIn, smashStreak, sound, stages,
  titleSummary, today, toggleButton, undo, watchReplay,
} from "./main.ts";
import { token } from "./style.ts";

/** The HUD controls' window rectangles this frame (a press on one is not a playfield drag). */
export const hudRects: ui.Rect[] = [];

interface Layout { lw: number; lh: number; sc: number; phone: boolean; land: boolean; wide: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const land = lw > lh && lh <= 480;
  return { lw, lh, sc, phone: lw <= 640 && !land, land, wide: lw >= 1024 };
}
const lastSize = new Map<string, ui.Rect>();
function textWidth(text: string, style: string, kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: [style] }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "text", id?: string): void {
  if (!text) return;
  let u = ui.style(cls);
  if (id) u = u.id(id);
  if (textWidth(text, cls) <= width) u.label(text);
  else u.paragraph(text, Math.max(20, width));
}
interface Btn { id: string; text: string; style?: string; act: () => void; disabled?: boolean; name?: string; selected?: boolean; width?: number; content?: () => void; }
const buttonWidth = (text: string, style: string): number => textWidth(text, style, "button") + 2;
function button(b: Btn): void {
  const style = b.style ?? "ghost";
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  if (b.selected !== undefined) opts.selected = b.selected;
  if (b.content) opts.content = b.content;
  else if (b.width != null && buttonWidth(b.text, style) > b.width) {
    const inner = b.width - 40;
    opts.content = () => { ui.style(style === "big" ? "wrap-ink" : "wrap").paragraph(b.text, Math.max(20, inner)); };
  } else if (b.name && b.name !== b.text) opts.content = () => { ui.label(b.text); };
  const st: ui.Style = {};
  if (b.width != null) st.width = b.width;
  if (ui.style(style, st).id(b.id).button(b.name ?? b.text, opts) && fresh()) {
    later(() => { sound("uiTap"); b.act(); });
  }
}
/** Buttons at their own widths in rows that wrap at `width` (.btn-row flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 10): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  const bw = (b: Btn): number => Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? "ghost"));
  for (const b of list) {
    const w = bw(b);
    if (rows[rows.length - 1]!.length && used + gap + w > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + w;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => { for (const b of row) button({ ...b, width: bw(b) }); }, { spacing: gap, align: "center" }));
  }, { spacing: gap, width });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  if (app.state && app.phase !== "results") hud(L);
  if (app.countdown && !app.screen) countdown(L);
  if (app.caption && !app.screen) captionLine(L);
  panel(L);
  toastBox(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

// ------------------------------------------------------------------ the HUD
function chip(id: string, text: string, cls = "chip-text", tip?: string): void {
  ui.row(id, () => { ui.style(cls).id(`${id}-t`).label(text, tip ? { tooltip: tip } : undefined); }, { style: "chip", align: "center" });
}
function hud(L: Layout): void {
  const s = app.state!;
  const pad = 12;
  const left = platform.options.leftHanded;
  const midChips = (): void => {
    chip("hud-score", String(Rules.totalScore(s)), "score-text", T("Score"));
    chip("hud-progress", T("Layer {n} / {total}", { n: Math.max(0, s.ball.layer + 1), total: s.config.layers.length }));
    if (s.streak > 0) chip("hud-streak", "⚡".repeat(Math.min(3, s.streak)) + (s.streak >= smashStreak(s) ? " " + T("SMASH") : ""), "chip-text", T("Smash charge"));
    const timer = timerText();
    if (timer) chip("hud-timer", timer);
  };
  const pauseBtn = (): void => {
    const r = ui.row("hud-pause-wrap", () => {
      const res = ui.style("hud-btn").id("btn-pause").widget(T("Pause (Esc)"), {
        role: "button", size: { width: 44, height: 44 },
        draw: (rect, st) => {
          const k = st.scale, bw = 4 * k, bh = 16 * k, cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
          draw.rect(cx - bw - 2 * k, cy - bh / 2, bw, bh, token("ui-fg"));
          draw.rect(cx + 2 * k, cy - bh / 2, bw, bh, token("ui-fg"));
        },
      });
      if (res.activated && fresh()) later(() => { sound("uiTap"); if (app.phase === "paused") resume(); else pause(); });
    });
    hudRects.push(r);
  };
  if (!L.land) {
    // #hud-top: objective, then the chips and pause at the end
    ui.place("hud-top", { anchor: "top-start", x: pad, y: 10 }, () => {
      const midW = (lastSize.get("hud-mid")?.width ?? 200 * L.sc) / L.sc;
      const objW = Math.max(80, Math.min(L.lw - 2 * pad - midW - 10, 70 * 8.2, textWidth(objectiveText(), "objective-text") + 28));
      ui.row("hud-top-row", () => {
        ui.column("hud-objective", () => para(objectiveText(), objW - 26, "objective-text", "hud-objective-t"), { style: "chip", width: objW });
        ui.spacer();
        lastSize.set("hud-mid", ui.row("hud-mid", () => { midChips(); pauseBtn(); }, { spacing: 10, align: "start" }));
      }, { width: L.lw - 2 * pad, spacing: 10, align: "start" });
    });
  } else {
    // short landscape: the status in a column at the start
    ui.place("hud-top", { anchor: "top-start", x: pad, y: 8 }, () => {
      ui.column("hud-top-col", () => {
        ui.column("hud-objective", () => para(objectiveText(), Math.min(260, L.lw * 0.32) - 26, "objective-text", "hud-objective-t"), { style: "chip", width: Math.min(260, L.lw * 0.32) });
        ui.row("hud-mid", () => midChips(), { spacing: 8 });
        pauseBtn();
      }, { spacing: 8 });
    });
  }
  // #hud-bottom: the round rotate buttons, Undo and Hint between them
  const size = L.land ? 56 : L.phone ? 68 : 76;
  const rot = (dir: number): void => {
    const name = dir < 0 ? T("Rotate tower left") : T("Rotate tower right");
    const r = ui.row(`rot-${dir < 0 ? "left" : "right"}-wrap`, () => {
      const res = ui.id(dir < 0 ? "btn-rot-left" : "btn-rot-right").widget(name, {
        role: "button", size: { width: size, height: size },
        draw: (rect, st) => {
          const k = st.scale, cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2, rad = rect.width / 2;
          const on = st.pressed || app.buttonDir === dir;
          draw.circle(cx, cy, rad, on ? token("ui-accent") : token("ui-bg"));
          draw.strokeCircle(cx, cy, rad - 0.5 * k, st.focused ? token("ui-accent") : token("ui-line"), (st.focused ? 3 : 1) * k);
          arrowGlyph(cx, cy, rad * 0.42, dir, on ? token("ui-ink") : token("ui-fg"), k);
        },
      });
      if (platform.options.holdToRotate) { if (res.pressed) held = dir; }
      else if (res.activated && fresh()) later(() => toggleButton(dir));
    });
    hudRects.push(r);
  };
  let held = 0;
  const actions = (): void => {
    const list: Btn[] = [];
    if (canUndo()) list.push({ id: "btn-undo", text: T("Undo"), style: "hud-btn", act: undo });
    if (canHint()) list.push({ id: "btn-hint", text: T("Hint"), style: "hud-btn", act: hint });
    if (!list.length) return;
    const r = (L.land ? ui.column : ui.row)("hud-actions", () => { for (const b of list) button(b); }, { spacing: 8 });
    hudRects.push(r);
  };
  const order = left ? [1, 0, -1] : [-1, 0, 1];
  if (!L.land) {
    ui.place("hud-bottom", { anchor: "bottom-start", x: 16, y: 14 }, () => {
      ui.row("hud-bottom-row", () => {
        for (const o of order) { if (o === 0) { ui.spacer(); actions(); ui.spacer(); } else rot(o); }
      }, { width: L.lw - 32, align: "end", spacing: 12 });
    });
  } else {
    ui.place("hud-bottom", { anchor: left ? "bottom-start" : "bottom-end", x: 16, y: 10 }, () => {
      ui.column("hud-bottom-col", () => { for (const o of order) { if (o === 0) actions(); else rot(o); } }, { spacing: 10, align: "center" });
    });
  }
  app.buttonDir = app.screen === null ? held : 0;
}
/** ⟲ / ⟳: an open circle with an arrow head (the old glyphs, drawn: the math arrows are missing from the UI fonts). */
function arrowGlyph(cx: number, cy: number, r: number, dir: number, color: string, k: number): void {
  const n = 20, a0 = -Math.PI * 0.3, a1 = Math.PI * 1.2, m = dir < 0 ? -1 : 1;
  const at = (a: number): [number, number] => [cx + Math.cos(a) * r * m, cy + Math.sin(a) * r];
  for (let i = 0; i < n; i++) {
    const [x0, y0] = at(a0 + ((a1 - a0) * i) / n), [x1, y1] = at(a0 + ((a1 - a0) * (i + 1)) / n);
    draw.line(x0, y0, x1, y1, color, 2.2 * k);
  }
  // the head at the arc's end, pointing along it
  const [ex, ey] = at(a1);
  const tx = -Math.sin(a1) * m, ty = Math.cos(a1);
  const h = r * 0.55;
  for (const side of [1, -1]) draw.line(ex, ey, ex - tx * h + ty * m * 0 + -ty * h * 0.6 * side, ey - ty * h + tx * h * 0.6 * side, color, 2.2 * k);
}
function timerText(): string | null {
  const s = app.state!;
  if (s.config.timeLimitTicks) return "⏱ " + Math.ceil(Math.max(0, s.config.timeLimitTicks - s.tick) / Rules.TICK_RATE) + "s";
  if (s.config.moveLimitTicks) return "⟳ " + (Math.max(0, s.config.moveLimitTicks - s.stats.rotationTicks) / Rules.TICK_RATE).toFixed(1) + "s";
  return null;
}
function countdown(L: Layout): void {
  const size = Math.max(64, Math.min(144, 0.18 * L.lw));
  ui.place("countdown", "center", () => { ui.style("countdown", { text: { size } }).id("countdown-t").label(app.countdown!); });
}
function captionLine(L: Layout): void {
  ui.place("caption", { anchor: "bottom", y: L.land ? 8 : 108 }, () => {
    ui.row("caption-box", () => ui.style("caption-text").id("caption-t").label(app.caption!.text), { style: "caption" });
  });
}
function toastBox(L: Layout): void {
  if (!app.toast) return;
  const w = Math.min(L.lw * 0.8, 520);
  ui.place("toast", { anchor: "top", y: 64 }, () => {
    ui.column("toast-box", () => para(app.toast!.text, w - 38, "toast-text", "toast-t"), { style: "toast" });
  });
}

// ------------------------------------------------------------------ panels (.screen > .panel)
function panel(L: Layout): void {
  const o = app.screen;
  if (!o) return;
  const sheet = L.phone;
  const w = sheet ? L.lw : Math.min(L.wide ? 720 : 680, 0.94 * L.lw);
  const padX = sheet ? 16 : 26, padY = sheet ? 16 : 22;
  const inner = w - 2 * padX;
  const maxH = (sheet ? 0.82 * L.lh : L.lh - 32 - 24) - (app.toast ? 72 : 0);
  const key = `panel-${o}`;
  const prev = lastSize.get(key);
  const footH = (lastSize.get(`${key}-foot`)?.height ?? 0) / L.sc;
  const scroll = !!prev && prev.height / L.sc + 2 * padY + footH + 10 > maxH;
  const opening = frame().frame - app.openedFrame <= 6;
  const build = (): void => {
    ui.column("panel", () => {
      const iw = inner - (scroll ? 14 : 0);
      footerList = null;
      const body = (): void => { lastSize.set(key, ui.column(`${key}-in`, () => buildPanel(o, iw, L), { spacing: 10, width: iw })); };
      if (scroll) ui.scrollArea(`${key}-scroll`, { width: inner + 6, height: Math.max(60, maxH - 2 * padY - footH - 10) }, body, opening ? { scrollTo: { top: 0 } } : undefined);
      else body();
      // the panel's buttons stay below its scrolling body (always in view)
      const list = footerList as Btn[] | null;
      if (list) lastSize.set(`${key}-foot`, ui.column(`${key}-foot`, () => flow(`${key}-row`, list, inner), { width: inner }));
      else lastSize.delete(`${key}-foot`);
    }, { style: sheet ? "sheet" : "panel", width: w, spacing: 10, padding: { top: padY, bottom: padY, start: padX, end: padX } });
  };
  const isOpen = ui.dialog(panelLabel(o), "", true, () => {
    if (sheet) ui.column("sheet-wrap", () => { ui.spacer(); build(); }, { width: L.lw, height: L.lh, spacing: 0, justify: "end" });
    else build();
  });
  if (!isOpen && fresh()) {
    // Escape / Back: the pause panel resumes, menus go back
    if (o === "pause") closeOnce(resume);
    else if (o === "settings" || o === "help") closeOnce(home);
    else if (o === "erase") closeOnce(() => open("settings"));
    else if (o !== "title" && o !== "results") closeOnce(app.phase === "paused" ? home : showTitle);
  }
}
let footerList: Btn[] | null = null;
/** The panel's action row (.btn-row), drawn after its body, outside the scroll area. */
function footer(list: Btn[], _w?: number): void { footerList = list; }
function panelLabel(o: NonNullable<typeof app.screen>): string {
  switch (o) {
    case "title": return "Spiral Drop";
    case "setup": return app.setup ? app.setup().title : "";
    case "journey": return T("Journey");
    case "practice": return T("Practice");
    case "challenges": return T("Challenges");
    case "learn": return T("Learn to Play");
    case "scores": return T("Scores");
    case "help": return T("How to Play");
    case "settings": return T("Settings");
    case "pause": return T("Paused");
    case "results": return app.results?.won ? T("Base Reached!") : T(app.results?.headline ?? "Run over");
    case "erase": return T("Erase local data");
  }
}
function buildPanel(o: NonNullable<typeof app.screen>, w: number, L: Layout): void {
  switch (o) {
    case "title": titlePanel(w); break;
    case "setup": setupPanel(w); break;
    case "journey": journeyPanel(w, L); break;
    case "practice": practicePanel(w); break;
    case "challenges": challengePanel(w); break;
    case "learn": learnPanel(w); break;
    case "scores": scoresPanel(w); break;
    case "help": helpPanel(w); break;
    case "settings": settingsPanel(w); break;
    case "pause": pausePanel(w); break;
    case "results": resultsPanel(w); break;
    case "erase": erasePanel(w); break;
  }
}
const back = (act: () => void, label = N("Back")): Btn => ({ id: "btn-back", text: "← " + T(label), act });

function titlePanel(w: number): void {
  const p = platform.progress();
  const ni = nextJourneyIndex();
  const done = Object.keys(p.stages).length;
  para("Spiral Drop", w, "h1", "title-h");
  para(T("Rotate the tower. Thread the gaps. Dodge the danger sectors."), w, "dim", "title-sub");
  const nextLabel = done === 0 ? T("start the Journey") : T("Stage {n} — {name}", { n: ni + 1, name: T(stages[ni]!.name!) });
  const col: Btn[] = [
    { id: "btn-play", text: T("▶ Play — {next}", { next: nextLabel }), style: "big", act: () => showSetup(journeySetup(nextJourneyIndex())) },
    { id: "btn-daily", text: p.dailyStreak.last === today().day ? T("Daily Drop ✓ done today") : T("Daily Drop"), act: () => showSetup(dailySetup()) },
    { id: "btn-journey", text: T("Journey"), act: showJourney },
    { id: "btn-practice", text: T("Practice"), act: () => open("practice") },
    { id: "btn-challenges", text: T("Challenges"), act: () => open("challenges") },
    { id: "btn-learn", text: T("Learn to Play"), act: () => open("learn") },
    { id: "btn-scores", text: T("Scores"), act: showScores },
    { id: "btn-settings", text: T("Settings"), act: showSettings },
    { id: "btn-help", text: T("How to Play"), act: showHelp },
  ];
  if (!platform.signedIn()) col.push({ id: "btn-signin", text: S("signIn"), act: signIn });
  if (platform.inviteLink()) col.push({ id: "btn-invite", text: S("invite"), act: invite });
  ui.column("title-col", () => { for (const b of col) button({ ...b, width: w }); }, { spacing: 10, width: w });
  para(titleSummary(), w, "dim", "title-summary");
}

function setupPanel(w: number): void {
  if (!app.setup) return;
  const info = app.setup();
  para(info.title, w, "h2", "setup-h");
  para(info.description, w, "dim", "setup-desc");
  ui.row("setup-badges", () => {
    ui.row("badge-rank", () => ui.style(info.ranked ? "badge-ranked-text" : "badge-dim-text").label(info.ranked ? T("Ranked") : T("Casual — not rated")), { style: info.ranked ? "badge-ranked" : "badge" });
    ui.row("badge-dur", () => ui.style("badge-text").label("~" + info.duration), { style: "badge" });
    if (info.assists) ui.row("badge-assist", () => ui.style("badge-text").label(T("Assists: {list}", { list: info.assists })), { style: "badge" });
  }, { spacing: 6, align: "center" });
  para(T("Rules"), w, "h3", "setup-rules-h");
  ui.column("setup-rules", () => { info.rules.forEach((r, i) => para("• " + r, w - 20, "dim", `setup-rule-${i}`)); }, { spacing: 4, width: w, padding: { start: 20 } });
  footer([{ id: "btn-start", text: T("Start"), style: "big", act: info.start }, back(home)], w);
}

function journeyPanel(w: number, L: Layout): void {
  const p = platform.progress();
  const done = p.stages;
  para(T("Journey"), w, "h2", "journey-h");
  para(T("{done} / {total} stages cleared. Mastery stages glow gold.", { done: Object.keys(done).length, total: stages.length }), w, "dim", "journey-sub");
  const gap = L.phone ? 6 : 8, min = L.phone ? 46 : 64;
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  const cw = (w - (cols - 1) * gap) / cols;
  const unlocked = journeyUnlocked();
  ui.column("stage-grid", () => {
    for (let r = 0; r * cols < stages.length; r++) {
      ui.row(`stage-grid-r${r}`, () => {
        for (let i = r * cols; i < Math.min(stages.length, (r + 1) * cols); i++) {
          const st = stages[i]!;
          const cleared = !!done[st.id];
          const ok = i <= unlocked;
          const stars = cleared ? done[st.id]!.stars : 0;
          const name = T("Stage {n} {name}", { n: i + 1, name: T(st.name!) }) + (cleared ? T(", cleared, {n} stars", { n: stars }) : ok ? "" : T(", locked"));
          button({
            id: `stage-${i + 1}`, text: String(i + 1), name, style: st.mastery ? "stage-mastery" : "stage", width: cw, disabled: !ok,
            act: () => showSetup(journeySetup(i)),
            content: () => ui.column(`stage-${i + 1}-face`, () => {
              ui.style("stage-n").label(String(i + 1));
              ui.style("stars").label("★".repeat(stars) + "☆".repeat(Math.max(0, 3 - stars)));
            }, { spacing: 2, align: "center", width: cw - 10, height: cw - 10, justify: "center" }),
          });
        }
      }, { spacing: gap });
    }
  }, { spacing: gap, width: w });
  footer([back(showTitle)], w);
}

function practicePanel(w: number): void {
  para(T("Practice"), w, "h2", "practice-h");
  para(T("Free play. Undo and hints allowed. Never affects ratings."), w, "dim", "practice-sub");
  ui.column("practice-col", () => {
    for (const pr of Data.PRACTICE) {
      const danger = pr.params.dangerProb > 0.5 ? T("heavy danger") : pr.params.dangerProb > 0.25 ? T("some danger") : T("light danger");
      button({ id: `practice-${pr.id}`, text: T("{name} — {n} layers, {danger}", { name: T(pr.name), n: pr.params.layers, danger }), width: w, act: () => showSetup(practiceSetup(pr.id)) });
    }
  }, { spacing: 10, width: w });
  footer([back(showTitle)], w);
}

function challengePanel(w: number): void {
  const best = platform.progress().bestScores;
  para(T("Challenges"), w, "h2", "challenges-h");
  para(T("Constrained goals: move budgets, clocks, altered layouts."), w, "dim", "challenges-sub");
  ui.column("challenge-col", () => {
    for (const c of Data.CHALLENGES) {
      const b = best[c.id];
      const desc = T(c.description!) + (b ? " — " + T("best {n}", { n: b }) : "");
      button({
        id: `challenge-${c.id}`, text: T(c.name!), name: `${T(c.name!)}. ${desc}`, style: "ghost-left", width: w, act: () => showSetup(challengeSetup(c.id)),
        content: () => ui.column(`challenge-${c.id}-face`, () => { para(T(c.name!), w - 40, "strong"); para(desc, w - 40, "small"); }, { spacing: 2, width: w - 40 }),
      });
    }
  }, { spacing: 10, width: w });
  footer([back(showTitle)], w);
}

function learnPanel(w: number): void {
  const lessons = platform.progress().lessons;
  para(T("Learn to Play"), w, "h2", "learn-h");
  para(T("One rule at a time. You must perform each action to advance."), w, "dim", "learn-sub");
  ui.column("learn-col", () => {
    Data.LESSONS.forEach((l, i) => button({ id: `lesson-${i + 1}`, text: (lessons[l.id] ? "✓ " : "") + (i + 1) + ". " + T(l.name), width: w, act: () => showSetup(lessonSetup(i)) }));
  }, { spacing: 10, width: w });
  footer([back(showTitle)], w);
}

function scoresPanel(w: number): void {
  const d = app.scores;
  if (!d) return;
  para(T("Scores"), w, "h2", "scores-h");
  const tabs: [typeof d.tab, string][] = [["local", T("Local")], ["global", T("Global")], ["friends", T("Friends")]];
  ui.row("score-tabs", () => {
    for (const [k, label] of tabs) {
      if (ui.style("ghost").id(`tab-${k}`).button(label, { selected: d.tab === k }) && fresh()) later(() => { sound("uiTap"); d.tab = k; });
    }
  }, { spacing: 6 });
  const rows: { name: string; score: number }[] = d.tab === "local" ? d.local.map((r) => ({ name: bestKeyName(r.key), score: r.score }))
    : (d.tab === "global" ? d.global : d.friends).map((r) => ({ name: r.name || T("Player"), score: r.score }));
  const label = d.tab === "local" ? T("Local bests on this device.") : d.tab === "global" ? T("Global (platform leaderboard — read-only).") : T("Friends-only board.");
  if (!rows.length) para(T("No scores yet — be the first."), w, "dim", "scores-empty");
  else {
    para(label, w, "dim", "scores-label");
    ui.column("scores-list", () => rows.slice(0, 20).forEach((r, i) => kv(`score-${i}`, `${i + 1}. ${r.name}`, String(r.score), w)), { spacing: 0, width: w });
  }
  footer([back(showTitle)], w);
}
function kv(id: string, k: string, v: string, w: number, total = false): void {
  ui.row(id, () => {
    ui.style(total ? "total-k" : "kv-k").label(k);
    ui.spacer();
    ui.style(total ? "total-v" : "kv-v").id(`${id}-v`).label(v);
  }, { style: total ? "kv-total" : "kv", width: w, align: "center" });
}

const GLYPH: Record<string, string> = { "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→", Escape: "Esc" };
function keysFor(action: string): string {
  let list: string[] = [];
  try { list = bindings(action).filter((b) => b.device === "keyboard").map((b) => GLYPH[b.label] ?? b.label); } catch { /* not yet */ }
  return [...new Set(list)].join(" / ");
}
function kbd(id: string, text: string): void { ui.row(id, () => ui.style("kbd-text").label(text), { style: "kbd" }); }
function card(id: string, title: string, w: number, body: () => void): void {
  ui.column(id, () => { para(title, w - 30, "strong", `${id}-h`); body(); }, { style: "rule-card", width: w, spacing: 4 });
}
function helpPanel(w: number): void {
  const iw = w - 30;
  para(T("How to Play"), w, "h2", "help-h");
  card("rule-goal", T("Goal"), w, () => para(T("Guide the ball to the base by rotating the tower so each ring’s gap passes beneath the ball."), iw, "dim"));
  card("rule-rotate", T("Rotate"), w, () => {
    ui.row("rule-rotate-keys", () => { kbd("kbd-left", keysFor("left")); ui.label("/"); kbd("kbd-right", keysFor("right")); }, { spacing: 6, align: "center" });
    para(T(", the round arrow buttons, drag sideways, or a gamepad stick. The ball never moves sideways — only the tower turns.").replace(/^,\s*/, ""), iw, "dim");
  });
  card("rule-danger", T("Danger sectors"), w, () => para(T("Striped arcs. Landing on one ends the run. They are striped as well as colored, so color is never the only signal."), iw, "dim"));
  card("rule-combo", T("Combos & smashing"), w, () => para(T("Fall through 3+ rings without landing to charge the ball. A charged ball smashes straight through one danger sector. Centered drops earn precision bonuses."), iw, "dim"));
  card("rule-keys", T("Other keys"), w, () => {
    const items: [string, string][] = [[keysFor("pause"), T("pause")], [keysFor("undo"), T("undo (practice)")], [keysFor("hint"), T("hint")], ["Enter", T("confirm")]];
    items.forEach(([k, label], i) => ui.row(`rule-key-${i}`, () => { kbd(`kbd-o-${i}`, k); para(label, iw - 120, "dim"); }, { spacing: 8, align: "center" }));
  });
  footer([back(home)], w);
}

/** A check box row (a role "checkbox" widget: built-in check box labels don't wrap). */
function toggleRow(id: string, label: string, on: boolean, w: number, set: (v: boolean) => void): void {
  ui.row(`${id}-row`, () => {
    const res = ui.id(id).widget(label, {
      role: "checkbox", checked: on, size: { width: 36, height: 40 },
      draw: (r, st) => {
        const s = st.scale, box = 20 * s, bx = r.x + (r.width - box) / 2, by = r.y + (r.height - box) / 2;
        draw.roundRect(bx, by, box, box, 4, on ? token("ui-accent") : token("ui-bg-solid"));
        draw.strokeRoundRect(bx, by, box, box, 4, st.focused ? token("ui-accent") : token("ui-dim"), (st.focused ? 3 : 1.5));
        if (on) draw.text("✓", bx + box / 2, by + 1 * s, { size: 16 * s, color: token("ui-ink"), align: "center", weight: "bold" });
      },
    });
    para(label, w - 46, "text", `${id}-label`);
    if (res.activated && fresh()) later(() => set(!on));
  }, { width: w, align: "center", spacing: 10 });
}
function settingsPanel(w: number): void {
  const o = platform.options;
  para(T("Settings"), w, "h2", "settings-h");
  para(T("Audio"), w, "h3", "set-audio-h");
  para(T("Volumes, mute, graphics quality, language, larger text, high contrast and reduced motion are in the StarHermit Options."), w, "dim", "options-note");
  flow("set-runtime", [
    { id: "btn-options", text: T("Open Options"), act: () => openMenu() },
    { id: "btn-rebind", text: T("Key bindings"), act: () => requestRebind() },
  ], w);
  toggleRow("set-captions", T("Captions for audio cues"), o.captions, w, (v) => platform.setOption("captions", v));
  para(T("Accessibility & controls"), w, "h3", "set-a11y-h");
  toggleRow("set-cvd", T("Color-vision-safe palette"), o.cvdPalette, w, (v) => platform.setOption("cvdPalette", v));
  toggleRow("set-left", T("Left-handed controls"), o.leftHanded, w, (v) => platform.setOption("leftHanded", v));
  toggleRow("set-hold", T("Hold-to-rotate buttons (vs toggle)"), o.holdToRotate, w, (v) => platform.setOption("holdToRotate", v));
  para(T("Data"), w, "h3", "set-data-h");
  flow("set-data", [
    { id: "btn-tutorial", text: T("Replay tutorial"), act: () => showSetup(lessonSetup(0)) },
    { id: "btn-erase", text: T("Erase local data"), act: () => open("erase") },
  ], w);
  footer([back(home)], w);
}
function erasePanel(w: number): void {
  para(T("Erase local data"), w, "h2", "erase-h");
  para(T("Erase all local Spiral Drop progress and settings?"), w, "dim", "erase-q");
  footer([
    { id: "btn-erase-yes", text: T("Erase"), style: "big", act: eraseData },
    { id: "btn-erase-no", text: T("Cancel"), act: () => open("settings") },
  ], w);
}
function pausePanel(w: number): void {
  para(T("Paused"), w, "h2", "pause-h");
  ui.column("pause-col", () => {
    button({ id: "btn-resume", text: T("Resume"), style: "big", width: w, act: resume });
    button({ id: "btn-restart", text: T("Restart"), width: w, act: restart });
    button({ id: "btn-settings", text: T("Settings"), width: w, act: showSettings });
    button({ id: "btn-help", text: T("Help"), width: w, act: showHelp });
    button({ id: "btn-leave", text: T("Leave round"), width: w, act: leaveToTitle });
  }, { spacing: 10, width: w });
}
function resultsPanel(w: number): void {
  const r = app.results;
  if (!r) return;
  para(r.won ? T("Base Reached!") : T(r.headline), w, "h2", "results-h");
  para(contentName(app.content), w, "dim", "results-sub");
  para(T("Score breakdown"), w, "h3", "results-score-h");
  ui.column("results-score", () => {
    r.components.forEach(([k, v], i) => kv(`comp-${i}`, T(k), String(v), w));
    kv("comp-total", T("Total"), String(r.total), w, true);
  }, { spacing: 0, width: w });
  para(T("Run"), w, "h3", "results-run-h");
  ui.column("results-run", () => {
    kv("run-layers", T("Layers descended"), r.layers, w);
    kv("run-best", T("Best single drop"), "×" + r.bestFall, w);
    kv("run-smashes", T("Smashes"), String(r.smashes), w);
    kv("run-time", T("Time"), r.time, w);
    kv("run-invalid", T("Invalid actions"), String(r.invalid), w);
  }, { spacing: 0, width: w });
  if (r.stars != null) para(T("Journey stars: {stars}", { stars: "★".repeat(r.stars) + "☆".repeat(3 - r.stars) }), w, "dim", "results-stars");
  if (r.achievements.length) para("🏆 " + r.achievements.map((a) => T(a.name)).join(", "), w, "dim", "results-ach");
  const lb = resultsLbLine();
  if (lb) para(lb, w, "small", "results-lb");
  const nextOk = r.won && !!r.nextLabel;
  const list: Btn[] = [{ id: "btn-primary", text: nextOk ? T("Next: {name}", { name: T(r.nextLabel!) }) : T("Retry"), style: "big", act: nextOk ? next : restart }];
  if (nextOk) list.push({ id: "btn-replay-stage", text: T("Replay this stage"), act: restart });
  list.push({ id: "btn-watch", text: T("Watch replay"), act: watchReplay });
  list.push(back(leaveToTitle, N("Menu")));
  footer(list, w);
}
