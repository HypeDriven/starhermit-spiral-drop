// The engine client's save model and progression (src/progress.js): two-device
// merges (stars, best scores, unions, the later daily streak, telemetry
// maxima), the browser build's cloud doc read as a foreign save with its game
// options, the settings KV's options picked, and main.js onTerminal's
// progression rules for every mode (Journey stars and the next stage, lesson
// completion, the daily streak, local bests, achievements in the old order).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as P from '../src/progress.js';

const require = createRequire(import.meta.url);
const R = require('../src/rules.js');
const C = require('../src/content.js');
const stages = C.journeyStages();
const j = (o) => JSON.parse(JSON.stringify(o));

test('merge keeps the best of both devices', () => {
  const a = { progress: { stages: { j01: { stars: 2, score: 300 } }, lessons: { l1: true }, achievements: { first_clear: 50 }, lifetimeLayers: 40,
    dailyStreak: { last: '2026-10-20', count: 2 }, bestScores: { j01: 300 }, nextStage: 1 }, telemetry: { starts: 5 } };
  const b = { progress: { stages: { j01: { stars: 3, score: 250 }, j02: { stars: 1, score: 90 } }, lessons: { l2: true }, achievements: { first_clear: 20, combo_master: 30 },
    lifetimeLayers: 70, dailyStreak: { last: '2026-10-21', count: 1 }, bestScores: { j01: 280, 'c-moves': 265 }, nextStage: 0 }, telemetry: { starts: 3, retries: 2 } };
  const m = P.mergeSave(a, b);
  assert.deepEqual(m.progress.stages, { j01: { stars: 3, score: 300 }, j02: { stars: 1, score: 90 } });
  assert.deepEqual(m.progress.lessons, { l1: true, l2: true });
  assert.deepEqual(m.progress.achievements, { first_clear: 20, combo_master: 30 });
  assert.equal(m.progress.lifetimeLayers, 70);
  assert.deepEqual(m.progress.dailyStreak, { last: '2026-10-21', count: 1 });
  assert.deepEqual(m.progress.bestScores, { j01: 300, 'c-moves': 265 });
  assert.equal(m.telemetry.starts, 5);
  assert.equal(m.telemetry.retries, 2);
  assert.ok(P.sameSave(m, P.mergeSave(b, a)));
  assert.ok(P.sameSave(P.mergeSave(m, m), m));
});

test('normalize repairs anything into an empty save', () => {
  for (const raw of [null, 7, 'x', [], { progress: 'no' }]) assert.ok(P.sameSave(P.normalize(raw), P.emptySave()));
});

test('the browser build\'s cloud doc migrates with its game options', () => {
  const doc = {
    settings: { music: 0.2, captions: false, cvdPalette: true, leftHanded: 'yes', holdToRotate: false, gfx: { preset: 'high' } },
    progress: { stages: { j03: { stars: 2, score: 410 } }, lessons: {}, achievements: {}, lifetimeLayers: 9, dailyStreak: { last: null, count: 0 }, bestScores: { j03: 410 }, nextStage: 0 },
    telemetry: { starts: 4 }, savedAt: 1,
  };
  const f = P.readForeign(JSON.stringify(doc));
  assert.deepEqual(f.options, { captions: false, cvdPalette: true, holdToRotate: false });
  assert.deepEqual(f.save.progress.stages, { j03: { stars: 2, score: 410 } });
  assert.equal(f.save.telemetry.starts, 4);
  assert.equal(P.readForeign('not json'), null);
  assert.equal(P.readForeign(JSON.stringify({ hello: 1 })), null);
  assert.deepEqual(P.pickOptions({ leftHanded: true, muted: true, captions: 'x' }), { leftHanded: true });
});

function finished(content, mode, dirs) {
  const cfg = C.toConfig(content, { mode, allowUndo: mode === 'learn' || mode === 'practice' });
  const s = R.createGame(cfg);
  for (const d of dirs) {
    if (s.phase === 'terminal') break;
    if (d !== s.rotating && s.phase !== 'resolving') R.applyCommand(s, d ? { type: 'rotateStart', dir: d } : { type: 'rotateStop' });
    R.step(s);
  }
  return s;
}

test('a won Journey stage: stars, the next stage, bests and achievements', async () => {
  const { plan } = await import('../tools/bot.mjs');
  const p = P.emptyProgress();
  const st = stages[0];
  const run = plan(C.toConfig(st, { mode: 'journey' }));
  const s = finished(st, 'journey', run.dirs);
  assert.equal(s.terminal.reason, 'completed');
  const total = R.totalScore(s);
  const r = P.applyRun(p, { mode: 'journey', content: st, state: s, won: true, total, lessonGoalMet: false, lesson: null, nowMs: Date.UTC(2026, 9, 28), now: 5 }, stages);
  const stars = 1 + (s.tick <= st.parTicks ? 1 : 0) + (s.stats.bestFall >= 3 ? 1 : 0);
  assert.equal(r.stars, stars);
  assert.equal(r.nextIndex, 1);
  assert.deepEqual(p.stages.j01, { stars, score: total });
  assert.equal(p.bestScores.j01, total);
  assert.deepEqual(r.newly.map((a) => a.key).filter((k) => k === 'first_clear'), ['first_clear']);
  assert.equal(p.achievements.first_clear, 5);
  // a worse replay keeps the better record
  P.applyRun(p, { mode: 'journey', content: st, state: s, won: true, total: 1, lessonGoalMet: false, lesson: null, nowMs: 0, now: 9 }, stages);
  assert.equal(p.stages.j01.score, total);
  assert.equal(p.achievements.first_clear, 5);
});

test('the daily streak counts consecutive UTC days; Creature of Habit unlocks on the run after the third', () => {
  const p = P.emptyProgress();
  const won = (day) => {
    const d = C.dailyFor(new Date(day));
    const s = { tick: 100, stats: { layersPassed: 1, bestFall: 1 } };
    return P.applyRun(p, { mode: 'daily', content: d, state: s, won: true, total: 10, lessonGoalMet: false, lesson: null, nowMs: day, now: day }, stages);
  };
  const day = (n) => Date.UTC(2026, 9, n, 12);
  won(day(1)); won(day(2));
  const third = won(day(3));
  assert.equal(p.dailyStreak.count, 3);
  assert.ok(!third.newly.some((a) => a.key === 'streak_keeper'), 'checked before the streak update, as main.js did');
  won(day(3));
  assert.ok(p.achievements.streak_keeper);
  won(day(5));
  assert.deepEqual(p.dailyStreak, { last: '2026-10-05', count: 1 });
  assert.equal(p.bestScores['daily-2026-10-01'], 10);
});

test('lessons: the rotation goal or reaching the base', () => {
  const p = P.emptyProgress();
  const [l1, l2] = C.LESSONS;
  const s = { tick: 50, stats: { layersPassed: 3, bestFall: 3 } };
  assert.equal(P.applyRun(p, { mode: 'learn', content: l1, state: s, won: true, total: 1, lessonGoalMet: false, lesson: l1, nowMs: 0, now: 1 }, stages).lessonDone, false);
  assert.equal(P.applyRun(p, { mode: 'learn', content: l1, state: s, won: false, total: 1, lessonGoalMet: true, lesson: l1, nowMs: 0, now: 1 }, stages).lessonDone, true);
  assert.equal(P.applyRun(p, { mode: 'learn', content: l2, state: s, won: true, total: 1, lessonGoalMet: false, lesson: l2, nowMs: 0, now: 1 }, stages).lessonDone, true);
  assert.deepEqual(p.lessons, { l1: true, l2: true });
  // practice bests key by preset (the id's first two dash parts)
  P.applyRun(p, { mode: 'practice', content: { id: 'practice-calm-123', params: {} }, state: s, won: true, total: 77, lessonGoalMet: false, lesson: null, nowMs: 0, now: 1 }, stages);
  assert.equal(p.bestScores['practice-calm'], 77);
  p.lifetimeLayers = 999;
  assert.ok(P.applyRun(p, { mode: 'practice', content: { id: 'practice-calm-1', params: {} }, state: s, won: false, total: 0, lessonGoalMet: false, lesson: null, nowMs: 0, now: 1 }, stages)
    .newly.some((a) => a.key === 'long_haul'));
});
