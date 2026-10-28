// Spiral Drop — the engine client's save model and progression rules. Pure
// (no storage, no platform) so the engine client (native/platform.ts,
// native/main.ts) and the node tests share it.
//
// The engine save (starhermit:storage `saves`, schema 1) holds what the
// browser build kept in localStorage (spiraldrop.progress.v1 and
// spiraldrop.telemetry.v1) and mirrored to the cloud slot game:<slug>
// through the JS SDK: { v: 1, progress: { stages, lessons, achievements,
// lifetimeLayers, dailyStreak, bestScores, nextStage }, telemetry: { starts,
// tutorialSteps, roundEnds, retries, settingsChanges, errors } }. Two saves
// merge with mergeProgress (the browser build's rules: more stars and higher
// scores win, unions, the later daily streak) and the larger telemetry
// counters. readForeign() reads that old cloud slot ({ settings, progress,
// telemetry, savedAt }).

export const ACHIEVEMENTS = [
  { key: 'first_clear', name: 'First Descent', desc: 'Complete any stage.' },
  { key: 'combo_master', name: 'Freefall', desc: 'Drop through 4+ rings in one fall.' },
  { key: 'streak_keeper', name: 'Creature of Habit', desc: 'Complete the Daily Drop 3 days in a row.' },
  { key: 'milestone_hard', name: 'Crown of the Spiral', desc: 'Clear Journey stage 40.' },
  { key: 'long_haul', name: 'Thousand Layers', desc: 'Descend 1000 layers total.' },
];
export const TELEMETRY_KEYS = ['starts', 'tutorialSteps', 'roundEnds', 'retries', 'settingsChanges', 'errors'];

const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});

export function emptyProgress() {
  return { stages: {}, lessons: {}, achievements: {}, lifetimeLayers: 0, dailyStreak: { last: null, count: 0 }, bestScores: {}, nextStage: 0 };
}
export function emptySave() {
  const telemetry = {};
  for (const k of TELEMETRY_KEYS) telemetry[k] = 0;
  return { v: 1, progress: emptyProgress(), telemetry };
}

/**
 * Merge two progress docs without dropping either side (platform.js
 * mergeProgress, unchanged): stages keep the more stars and the higher
 * score, best scores the higher value, lessons and achievements are unioned
 * (earliest unlock kept), lifetime layers and the next stage take the larger
 * value, and the daily streak with the later day (then the longer run) wins.
 */
export function mergeProgress(a, b) {
  const A = obj(a), B = obj(b);
  const stages = Object.assign({}, obj(A.stages));
  for (const [k, v] of Object.entries(obj(B.stages))) {
    const cur = stages[k];
    stages[k] = !cur ? v : { stars: Math.max(cur.stars || 0, (v && v.stars) || 0), score: Math.max(cur.score || 0, (v && v.score) || 0) };
  }
  const bestScores = Object.assign({}, obj(A.bestScores));
  for (const [k, v] of Object.entries(obj(B.bestScores))) if (!(Number(bestScores[k]) >= Number(v))) bestScores[k] = v;
  const achievements = Object.assign({}, obj(A.achievements));
  for (const [k, v] of Object.entries(obj(B.achievements))) if (!achievements[k] || (v && v < achievements[k])) achievements[k] = v;
  const sa = obj(A.dailyStreak), sb = obj(B.dailyStreak);
  const streak = String(sa.last || '') > String(sb.last || '') ? sa : String(sb.last || '') > String(sa.last || '') ? sb
    : ((sa.count || 0) >= (sb.count || 0) ? sa : sb);
  return {
    stages, bestScores, achievements,
    lessons: Object.assign({}, obj(A.lessons), obj(B.lessons)),
    lifetimeLayers: Math.max(Number(A.lifetimeLayers) || 0, Number(B.lifetimeLayers) || 0),
    nextStage: Math.max(Number(A.nextStage) || 0, Number(B.nextStage) || 0),
    dailyStreak: { last: streak.last || null, count: streak.count || 0 },
  };
}

/** A save document from anything (missing or broken fields from the empty one). */
export function normalize(raw) {
  const r = obj(raw);
  const p = mergeProgress(obj(JSON.parse(JSON.stringify(obj(r.progress)))), null);
  const telemetry = {};
  for (const k of TELEMETRY_KEYS) telemetry[k] = Math.max(0, Number(obj(r.telemetry)[k]) || 0);
  return { v: 1, progress: p, telemetry };
}

/** Merge two saves (this device's and another device's / the old cloud slot's). */
export function mergeSave(remote, local) {
  const a = normalize(local), b = normalize(remote);
  const telemetry = {};
  for (const k of TELEMETRY_KEYS) telemetry[k] = Math.max(a.telemetry[k], b.telemetry[k]);
  return normalize({ progress: mergeProgress(b.progress, a.progress), telemetry });
}

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
/** Same content, whatever the key order. */
export function sameSave(a, b) { return stable(normalize(a)) === stable(normalize(b)); }

/**
 * The game's own options (engine `settings`, synced with the account). The
 * browser build's volumes, mute, graphics, reduced motion, high contrast and
 * larger text are the runtime's Options now; captions, the colour-vision
 * palette, left-handed controls and hold-to-rotate stay the game's.
 */
export const DEFAULT_OPTIONS = { captions: true, cvdPalette: false, leftHanded: false, holdToRotate: true };
export const OPTION_KEYS = Object.keys(DEFAULT_OPTIONS);
/** main.js CLOUD_SETTINGS_KEYS: what the browser build wrote to the account's settings KV. */
export const BROWSER_KEYS = ['music', 'effects', 'ambience', 'voice', 'muted', 'reducedMotion', 'highContrast', 'cvdPalette', 'largeText', 'leftHanded', 'holdToRotate', 'captions', 'gfx'];

/** Valid option values from anything. */
export function pickOptions(raw) {
  const r = obj(raw);
  const out = {};
  for (const k of OPTION_KEYS) if (typeof r[k] === 'boolean') out[k] = r[k];
  return out;
}

/** The browser build's cloud slot text: { save, options } or null when it is not one. */
export function readForeign(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const doc = JSON.parse(text);
    if (!doc || typeof doc !== 'object' || (!doc.progress && !doc.telemetry)) return null;
    return { save: normalize(doc), options: pickOptions(doc.settings) };
  } catch { return null; }
}

/** UTC day key YYYY-MM-DD (content.js dailyFor). */
export function dayKey(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

/**
 * main.js onTerminal's progression for a finished run, applied to `p` (the
 * progress doc): lifetime layers, Journey stars and the next stage, a
 * lesson's completion, the daily streak, the local best score, and the
 * newly unlocked achievements. `run` = { mode, content, state, won, total,
 * lessonGoalMet, nowMs, now (for unlock stamps) }. Returns
 * { stars, nextIndex, newly: [achievement…], lessonDone }.
 */
export function applyRun(p, run, stages) {
  const s = run.state, c = run.content;
  p.lifetimeLayers = (Number(p.lifetimeLayers) || 0) + s.stats.layersPassed;
  // main.js checked the achievements before the stage/lesson/daily updates below (so a
  // third daily day counts toward Creature of Habit on the next finished run): kept
  const newly = [];
  const unlock = (key) => {
    if (p.achievements[key]) return;
    p.achievements[key] = run.now || 1;
    newly.push(ACHIEVEMENTS.find((a) => a.key === key));
  };
  if (run.won) unlock('first_clear');
  if (s.stats.bestFall >= 4) unlock('combo_master');
  if (p.dailyStreak.count >= 3) unlock('streak_keeper');
  if (run.mode === 'journey' && run.won && c.index === 39) unlock('milestone_hard');
  if (p.lifetimeLayers >= 1000) unlock('long_haul');
  let stars = null, nextIndex = null, lessonDone = false;
  if (run.mode === 'journey' && run.won) {
    stars = 1 + (s.tick <= c.parTicks ? 1 : 0) + (s.stats.bestFall >= 3 ? 1 : 0);
    const prev = p.stages[c.id];
    if (!prev || stars > prev.stars || run.total > prev.score) {
      p.stages[c.id] = { stars: Math.max(stars, prev ? prev.stars : 0), score: Math.max(run.total, prev ? prev.score : 0) };
    }
    let ni = stages.length - 1;
    for (let i = 0; i < stages.length; i++) if (!p.stages[stages[i].id]) { ni = i; break; }
    if (stages[ni] && ni > c.index) nextIndex = ni;
  }
  if (run.mode === 'learn') {
    const l = run.lesson;
    if (l.goal.type === 'rotate' ? run.lessonGoalMet : run.won) { p.lessons[l.id] = true; lessonDone = true; }
  }
  if (run.mode === 'daily' && run.won) {
    const today = c.day;
    const yesterday = dayKey(run.nowMs - 86400000);
    if (p.dailyStreak.last !== today) {
      p.dailyStreak.count = p.dailyStreak.last === yesterday ? p.dailyStreak.count + 1 : 1;
      p.dailyStreak.last = today;
    }
  }
  // best scores (main.js: daily keyed by its id, the rest by the id's first two dash parts)
  const bestKey = c.id.startsWith('daily-') ? c.id : c.id.split('-').slice(0, 2).join('-');
  if (run.won && run.total > (p.bestScores[bestKey] || 0)) p.bestScores[bestKey] = run.total;
  return { stars, nextIndex, newly, lessonDone };
}
