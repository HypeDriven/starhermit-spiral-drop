// A planning bot for play scripts: plays a run on the client's fixed steps
// exactly as native/main.ts does (one rules tick a 60 Hz step; the rotation
// held at a step is applied before its tick, except while a landing
// resolves; a reversal releases one key a step before the other goes down)
// and returns the rotation per step. Each decision tries holding left, right
// or nothing for a while, then a simple policy (turn toward the next gap,
// stop while falling), and keeps the choice whose rollout goes deepest
// without ending on a danger sector.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const R = require('../src/rules.js');
export const C = require('../src/content.js');

function clone(s) {
  const cfg = s.config;
  s.config = null;
  const c = JSON.parse(JSON.stringify(s));
  s.config = cfg;
  c.config = cfg;
  return c;
}
/** main.ts's fixed step: the held rotation, then the tick. */
export function stepWith(s, dir, ids) {
  if (s.phase !== 'resolving' && dir !== s.rotating && s.phase !== 'terminal') {
    R.applyCommand(s, dir === 0 ? { type: 'rotateStop', id: 'b' + ids.n++ } : { type: 'rotateStart', dir, id: 'b' + ids.n++ });
  }
  R.step(s);
}
function basic(s) {
  if (s.phase === 'falling') return 0;
  const next = s.ball.layer + 1;
  if (next >= s.config.layers.length) return 0;
  const al = R.gapAlignment(s, next);
  if (al.clear) return 0;
  return al.delta > 0 ? -1 : 1;
}
function value(s) {
  if (s.phase === 'terminal') return s.terminal.reason === 'completed' ? 1e7 + R.totalScore(s) * 10 - s.tick : -1e7 + s.stats.layersPassed * 1000;
  return s.stats.layersPassed * 1000 + R.totalScore(s) - s.tick * 0.5;
}
const LENS = [1, 3, 6, 10, 16, 24, 36, 52, 72];

/** The rotation per step for a run of `cfg`, the final state and its total. `prefer(state, k)` may force a step's rotation. */
export function plan(cfg, { maxSteps = 60 * 240, horizon = 420, force = null } = {}) {
  const s = R.createGame(cfg);
  const ids = { n: 0 };
  const dirs = [];
  let queue = [];
  while (s.phase !== 'terminal' && dirs.length < maxSteps) {
    let d;
    const forced = force ? force(s, dirs.length) : null;
    if (forced !== null && forced !== undefined) d = forced;
    else {
      if (!queue.length) {
        let best = null;
        const cands = [[null, 0]];
        for (const dir of [0, -1, 1]) for (const len of LENS) cands.push([dir, len]);
        for (const [dir, len] of cands) {
          const t = clone(s);
          const tid = { n: 0 };
          let prev = dirs.length ? dirs[dirs.length - 1] : 0;
          const seq = [];
          for (let i = 0; i < len + horizon && t.phase !== 'terminal'; i++) {
            let x = i < len ? dir : basic(t);
            if (prev !== 0 && x === -prev) x = 0;
            if (seq.length < 3) seq.push(x);
            stepWith(t, x, tid); prev = x;
          }
          const v = value(t);
          if (!best || v > best.v) best = { v, seq };
        }
        queue = best.seq.slice(0, 3);
      }
      d = queue.shift();
    }
    const prev = dirs.length ? dirs[dirs.length - 1] : 0;
    if (prev !== 0 && d === -prev) { d = 0; queue = []; }
    dirs.push(d);
    stepWith(s, d, ids);
  }
  return { dirs, state: s, terminal: s.terminal, total: R.totalScore(s) };
}

/** A run of `cfg` replayed from planned rotations (to check a plan). */
export function replayDirs(cfg, dirs) {
  const s = R.createGame(cfg);
  const ids = { n: 0 };
  for (const d of dirs) { if (s.phase === 'terminal') break; stepWith(s, d, ids); }
  return s;
}
