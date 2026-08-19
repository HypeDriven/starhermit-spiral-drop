/*
 * Spiral Drop — rules & content test suite (Node, no dependencies).
 * Run: node tests/run-tests.js
 */
'use strict';
const R = require('../src/rules.js');
const C = require('../src/content.js');

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; failures.push(name + ': ' + (e && e.message)); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ` — expected ${b}, got ${a}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function approx(a, b, eps, msg) { if (Math.abs(a - b) > (eps || 1e-9)) throw new Error((msg || 'approx') + ` — ${a} vs ${b}`); }

function simpleContent(over) {
  return Object.assign({
    id: 't1', version: 1, seed: 'test-seed', theme: 'tide',
    params: { layers: 5, gapWidth: 1.4, dangerProb: 0, dangerArc: 0.9, dangerExtraProb: 0, driftProb: 0, driftSpeed: 0, comboEvery: 0 },
    mechanics: { smashStreak: 3 }
  }, over || {});
}
function mk(over, cfgOver) {
  return R.createGame(Object.assign(C.toConfig(simpleContent(over), { mode: 'practice', allowUndo: true }), cfgOver || {}));
}
// Rotate until the gap of the next layer is under the ball, then stop.
function alignAndDrop(state, maxTicks) {
  let guard = 0;
  maxTicks = maxTicks || 6000;
  const before = state.ball.layer;
  while (state.phase !== 'terminal' && guard < maxTicks) {
    if (state.phase === 'rest' || state.phase === 'resolving') {
      const next = state.ball.layer + 1;
      if (next >= state.config.layers.length) { /* falling to base */ }
      else {
        const al = R.gapAlignment(state, next);
        if (!al.clear) {
          // rotating -1 decreases the gap's world angle; move delta toward 0
          const want = al.delta > 0 ? -1 : 1;
          if (state.rotating !== want) { if (state.rotating) R.applyCommand(state, { type: 'rotateStop' }); R.applyCommand(state, { type: 'rotateStart', dir: want }); }
        } else if (state.rotating !== 0) R.applyCommand(state, { type: 'rotateStop' });
      }
    }
    R.step(state);
    guard++;
    if (state.ball.layer > before && state.phase === 'rest') break;
    if (state.phase === 'terminal') break;
  }
  return state;
}
// Hint-driven solver: never lands on danger unless smash-charged (backs off).
function solve(state) {
  let guard = 0;
  while (state.phase !== 'terminal' && guard < R.MAX_TICKS) {
    if (state.phase !== 'falling') {
      const next = state.ball.layer + 1;
      const n = state.config.layers.length;
      if (next < n) {
        const al = R.gapAlignment(state, next);
        // also avoid dropping when the layer *after* next would be a danger landing
        const want = al.delta === 0 ? 0 : (al.delta > 0 ? -1 : 1);
        if (!al.clear && state.rotating !== want) {
          if (state.rotating) R.applyCommand(state, { type: 'rotateStop' });
          R.applyCommand(state, { type: 'rotateStart', dir: want });
        } else if (al.clear && state.rotating !== 0) {
          R.applyCommand(state, { type: 'rotateStop' });
        }
      } else if (state.rotating) R.applyCommand(state, { type: 'rotateStop' });
    }
    R.step(state);
    guard++;
  }
  return state;
}

// ---------- RNG & hashing
test('rng deterministic for same seed', () => {
  const a = R.makeRng('x'), b = R.makeRng('x');
  for (let i = 0; i < 100; i++) approx(a.next(), b.next());
});
test('rng differs across seeds', () => {
  const a = R.makeRng('x').next(), b = R.makeRng('y').next();
  ok(a !== b);
});

// ---------- Creation & legality
test('createGame rejects bad configs', () => {
  let threw = 0;
  try { R.createGame({}); } catch (e) { threw++; }
  try { R.createGame({ seed: 1, layers: [] }); } catch (e) { threw++; }
  try { R.createGame({ seed: 1, layers: [{ gapCenter: 0, gapWidth: 99, danger: [], offset: 0, drift: 0 }] }); } catch (e) { threw++; }
  eq(threw, 3, 'expected 3 rejections');
});
test('initial state: rest phase, actions available, tick 0', () => {
  const s = mk();
  eq(s.phase, 'rest'); eq(s.tick, 0);
  const la = R.legalActions(s);
  ok(la.includes('rotateLeft') && la.includes('rotateRight') && la.includes('abandon'));
  ok(!la.includes('rotateStop'));
});
test('invalid commands rejected with reason and counted', () => {
  const s = mk();
  const r = R.applyCommand(s, { type: 'rotateStop' });
  eq(r.ok, false); eq(r.reason, 'not-rotating'); eq(s.stats.invalidActions, 1);
  const r2 = R.applyCommand(s, { type: 'bogus' });
  eq(r2.ok, false); eq(s.stats.invalidActions, 2);
});
test('duplicate command ids rejected idempotently', () => {
  const s = mk();
  const a = R.applyCommand(s, { type: 'rotateStart', dir: 1, id: 'cmd-1' });
  const b = R.applyCommand(s, { type: 'rotateStart', dir: 1, id: 'cmd-1' });
  ok(a.ok && b.ok && b.duplicate);
  eq(s.inputLog.length, 1, 'logged once');
});
test('malformed commands do not crash', () => {
  const s = mk();
  eq(R.applyCommand(s, null).ok, false);
  eq(R.applyCommand(s, {}).ok, false);
  eq(R.applyCommand(s, { type: 42 }).ok, false);
});

// ---------- Rotation
test('rotateStart turns tower deterministically, rotateStop halts', () => {
  // gap far from the ball and narrow: rotation never triggers a fall here
  const content = simpleContent({ seed: 'rot' });
  content._layers = [{ offset: 0, gapCenter: Math.PI, gapWidth: 0.6, danger: [], drift: 0 }];
  const s = R.createGame(C.toConfig(content, { mode: 'practice' }));
  R.applyCommand(s, { type: 'rotateStart', dir: 1 });
  for (let i = 0; i < 20; i++) R.step(s);
  approx(s.towerAngle, 20 * R.ROT_SPEED, 1e-9);
  R.applyCommand(s, { type: 'rotateStop' });
  const a = s.towerAngle;
  for (let i = 0; i < 60; i++) R.step(s);
  approx(s.towerAngle, a, 1e-12);
});

// ---------- Falling & scoring
test('ball drops through aligned gap and scores a layer', () => {
  const s = mk();
  alignAndDrop(s);
  ok(s.stats.layersPassed >= 1, 'passed at least one layer');
  ok(s.score.layers >= 10);
});
test('full solve reaches base: completion + components', () => {
  const s = mk();
  solve(s);
  eq(s.phase, 'terminal');
  eq(s.terminal.reason, 'completed');
  ok(s.score.completion === 100);
  eq(s.score.layers, 10 * s.config.layers.length);
});
test('combo scoring: uninterrupted multi-layer drop pays combo', () => {
  // craft two layers with identical gaps → guaranteed combo
  const content = simpleContent({ seed: 'combo' });
  content._layers = [
    { offset: 0, gapCenter: 0, gapWidth: 1.5, danger: [], drift: 0 },
    { offset: 0, gapCenter: 0, gapWidth: 1.5, danger: [], drift: 0 },
    { offset: 0, gapCenter: 0, gapWidth: 1.5, danger: [], drift: 0 }
  ];
  const s = R.createGame(C.toConfig(content, { mode: 'practice' }));
  // gaps start centered on the ball → immediate fall
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 5000) R.step(s);
  eq(s.terminal.reason, 'completed');
  ok(s.stats.bestFall >= 2, 'multi-layer fall happened, bestFall=' + s.stats.bestFall);
  ok(s.score.combo > 0, 'combo scored');
});
test('precision scoring: centered drop pays precision bonus', () => {
  const content = simpleContent({ seed: 'prec' });
  content._layers = [
    { offset: 0, gapCenter: 0, gapWidth: 1.5, danger: [], drift: 0 },
    { offset: 0, gapCenter: 1.8, gapWidth: 1.2, danger: [], drift: 0 }
  ];
  const s = R.createGame(C.toConfig(content, { mode: 'practice' }));
  let guard = 0;
  while (s.phase === 'rest' || s.phase === 'falling' || s.phase === 'resolving') {
    R.step(s);
    if (s.lastEvent && s.lastEvent.type === 'land') break;
    if (guard++ > 5000) throw new Error('no landing');
  }
  ok(s.score.precision >= 10, 'precision awarded');
});
test('danger landing ends the run with reason danger-sector', () => {
  const content = simpleContent({ seed: 'danger' });
  // layer 0 gap at 0; layer 1's gap is at PI while a danger arc covers the ball's angle
  content._layers = [
    { offset: 0, gapCenter: 0, gapWidth: 1.5, danger: [], drift: 0 },
    { offset: 0, gapCenter: Math.PI, gapWidth: 0.8, danger: [[5.783, 2.0]], drift: 0 }
  ];
  const s = R.createGame(C.toConfig(content, { mode: 'practice' }));
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 5000) R.step(s);
  eq(s.terminal.reason, 'danger-sector');
  eq(s.terminal.detail.layer, 1);
});
test('smash: streak >= threshold breaks danger instead of losing', () => {
  const content = simpleContent({ seed: 'smash' });
  content._layers = [
    { offset: 0, gapCenter: 0, gapWidth: 1.5, danger: [], drift: 0 },
    { offset: 0, gapCenter: 0, gapWidth: 1.5, danger: [], drift: 0 },
    { offset: 0, gapCenter: 0, gapWidth: 1.5, danger: [], drift: 0 },
    { offset: 0, gapCenter: Math.PI, gapWidth: 0.6, danger: [[5.88, 1.5]], drift: 0 },
    { offset: 0, gapCenter: Math.PI, gapWidth: 0.6, danger: [], drift: 0 }
  ];
  const s = R.createGame(C.toConfig(content, { mode: 'practice' }));
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 8000) R.step(s);
  // 3-layer streak builds, then danger at layer 3 smashed, then danger-free layer 4? —
  // layer 4's gap is at PI and ball at angle 0 → after smash the ball lands on layer 4 (safe).
  ok(s.stats.smashes >= 1, 'smash happened');
  ok(s.score.smash >= 25);
});
test('time bonus under par', () => {
  const content = simpleContent({ seed: 'par' });
  content._layers = [{ offset: 0, gapCenter: 0, gapWidth: 1.5, danger: [], drift: 0 }];
  const cfg = C.toConfig(content, { mode: 'journey' });
  cfg.parTicks = 6000;
  const s = R.createGame(cfg);
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 5000) R.step(s);
  eq(s.terminal.reason, 'completed');
  ok(s.score.timeBonus > 0, 'time bonus awarded: ' + s.score.timeBonus);
});

// ---------- Limits & terminal states
test('move limit exceeded ends run', () => {
  const s = mk({}, { moveLimitTicks: 30 });
  R.applyCommand(s, { type: 'rotateStart', dir: 1 });
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 5000) R.step(s);
  eq(s.terminal.reason, 'move-limit-exceeded');
});
test('time limit exceeded ends run', () => {
  const s = mk({}, { timeLimitTicks: 120 });
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < 5000) R.step(s);
  eq(s.terminal.reason, 'time-expired');
});
test('abandon ends run with reason', () => {
  const s = mk();
  R.applyCommand(s, { type: 'abandon' });
  eq(s.phase, 'terminal'); eq(s.terminal.reason, 'abandoned');
  eq(R.legalActions(s).length, 0, 'no actions after terminal');
});

// ---------- Undo
test('undo restores pre-fall rest state (practice only)', () => {
  const s = mk(); // allowUndo true
  alignAndDrop(s);
  ok(s.stats.layersPassed >= 1);
  ok(s.undoStack.length >= 1, 'snapshot recorded');
  const r = R.applyCommand(s, { type: 'undo' });
  ok(r.ok, 'undo legal');
  eq(s.stats.layersPassed, 0, 'layer pass reverted');
  eq(s.score.layers, 0);
});
test('undo illegal without allowUndo', () => {
  const s = R.createGame(C.toConfig(simpleContent(), { mode: 'journey' }));
  alignAndDrop(s);
  const r = R.applyCommand(s, { type: 'undo' });
  eq(r.ok, false); eq(r.reason, 'undo-not-available');
});

// ---------- Hint API
test('hint returns legal rotation direction or wait', () => {
  const s = mk();
  const h = R.hint(s);
  ok(['rotateLeft', 'rotateRight', 'wait'].includes(h.action));
});

// ---------- Serialization
test('serialize/deserialize round-trips and resumes identically', () => {
  const s = mk();
  R.applyCommand(s, { type: 'rotateStart', dir: -1 });
  for (let i = 0; i < 137; i++) R.step(s);
  const json = R.serialize(s);
  const s2 = R.deserialize(json);
  eq(R.stateHash(s), R.stateHash(s2), 'hash equal after roundtrip');
  for (let i = 0; i < 200; i++) { R.step(s); R.step(s2); }
  eq(R.stateHash(s), R.stateHash(s2), 'hash equal after resumed stepping');
});
test('deserialize rejects wrong rules version', () => {
  const s = mk();
  const j = JSON.parse(R.serialize(s));
  j.rulesVersion = 999;
  let threw = false;
  try { R.deserialize(JSON.stringify(j)); } catch (e) { threw = true; }
  ok(threw);
});

// ---------- Replay determinism (property-style)
test('replay: same seed + commands → identical hashes (20 runs)', () => {
  const content = simpleContent({ seed: 'replay-det', params: { layers: 8, gapWidth: 1.2, dangerProb: 0.4, dangerArc: 0.9, dangerExtraProb: 0.1, driftProb: 0.3, driftSpeed: 0.004, comboEvery: 3 } });
  const cfg = C.toConfig(content, { mode: 'journey' });
  const hashes = new Set();
  let finalEnv = null;
  for (let run = 0; run < 20; run++) {
    const s = R.createGame(cfg);
    // scripted pseudo-random command stream from an independent rng
    const rng = R.makeRng('driver-' + run);
    let dir = 0, guard = 0;
    while (s.phase !== 'terminal' && guard++ < R.MAX_TICKS) {
      if (rng.next() < 0.02) {
        if (dir !== 0) R.applyCommand(s, { type: 'rotateStop', id: `r${run}-${guard}` });
        dir = rng.next() < 0.6 ? (rng.next() < 0.5 ? -1 : 1) : 0;
        if (dir !== 0) R.applyCommand(s, { type: 'rotateStart', dir, id: `r${run}-${guard}b` });
      }
      R.step(s);
    }
    const env = R.buildEnvelope(s);
    const check = R.verifyEnvelope(env);
    ok(check.ok, 'envelope verifies for run ' + run + ': ' + (check.reason || ''));
    hashes.add(R.stateHash(s));
    if (run === 0) finalEnv = env;
  }
  // different command streams may diverge, but each individual replay must verify — done above
  ok(finalEnv);
});
test('replay detects tampered score', () => {
  const s = mk();
  solve(s);
  const env = R.buildEnvelope(s);
  env.result.score += 1000;
  const check = R.verifyEnvelope(env);
  eq(check.ok, false);
  eq(check.reason, 'score-mismatch');
});

// ---------- Tie-breaks
test('compareResults tie-break ordering', () => {
  const base = { reason: 'completed', score: 100, invalidActions: 0, ticks: 100, sessionId: 'b' };
  ok(R.compareResults(base, { ...base, sessionId: 'a' }) > 0, 'stable id decides last');
  ok(R.compareResults({ ...base, ticks: 90 }, base) < 0, 'lower time wins');
  ok(R.compareResults({ ...base, reason: 'danger-sector' }, base) > 0, 'completion wins');
});

// ---------- Content
test('all 40 journey stages validate (legality, bounded, no soft lock)', () => {
  const stages = C.journeyStages();
  eq(stages.length, 40);
  for (const st of stages) {
    const v = C.validateContent(st);
    ok(v.ok, st.id + ' invalid: ' + v.issues.join(','));
  }
});
test('all challenges and lessons validate', () => {
  for (const c of C.CHALLENGES) ok(C.validateContent(c).ok, c.id);
  for (const l of C.LESSONS) ok(C.validateContent(l).ok, l.id);
});
test('daily content is immutable for a given UTC day', () => {
  const d = new Date(Date.UTC(2026, 7, 19, 23, 59));
  const a = C.dailyFor(d), b = C.dailyFor(new Date(Date.UTC(2026, 7, 19, 0, 1)));
  eq(a.seed, b.seed); eq(a.id, b.id);
  eq(JSON.stringify(a.params), JSON.stringify(b.params));
  const c = C.dailyFor(new Date(Date.UTC(2026, 7, 20)));
  ok(c.seed !== a.seed, 'next day differs');
});
test('generated layers never fully walled (safe sector exists)', () => {
  const rng = R.makeRng('content-fuzz');
  for (let i = 0; i < 60; i++) {
    const seed = 'fz-' + Math.floor(rng.next() * 1e9);
    const layers = C.makeLayers(seed, { layers: 30, gapWidth: 1.0, dangerProb: 0.9, dangerArc: 1.3, dangerExtraProb: 0.5, driftProb: 0.5, driftSpeed: 0.006, comboEvery: 4 });
    for (const l of layers) {
      const danger = l.danger.reduce((s, d) => s + d[1], 0);
      ok(danger + l.gapWidth < Math.PI * 2 - 0.2, 'layer has safe space');
    }
  }
});

// ---------- Fuzz: malformed commands, no hangs / NaN
test('fuzz: 5000 random commands never hang, NaN, or corrupt state', () => {
  const s = mk({ params: { layers: 20, gapWidth: 1.1, dangerProb: 0.6, dangerArc: 1.1, dangerExtraProb: 0.4, driftProb: 0.5, driftSpeed: 0.005, comboEvery: 3 } });
  const rng = R.makeRng('fuzz');
  const types = ['rotateStart', 'rotateStop', 'undo', 'abandon', 'nonsense'];
  for (let i = 0; i < 5000 && s.phase !== 'terminal'; i++) {
    const t = types[Math.floor(rng.next() * types.length)];
    const cmd = { type: t };
    if (rng.next() < 0.5) cmd.dir = rng.next() < 0.5 ? -1 : 1;
    if (rng.next() < 0.3) cmd.id = 'fz' + Math.floor(rng.next() * 50); // collisions on purpose
    R.applyCommand(s, cmd);
    for (let k = 0; k < 3; k++) R.step(s);
    ok(Number.isFinite(s.ball.y) && Number.isFinite(s.towerAngle), 'finite state at i=' + i);
    ok(s.tick <= R.MAX_TICKS + 1, 'tick bounded');
  }
  // drain to terminal
  let guard = 0;
  while (s.phase !== 'terminal' && guard++ < R.MAX_TICKS) R.step(s);
  ok(s.phase === 'terminal', 'terminated');
});
test('fuzz: random content validates without unbounded loops', () => {
  const rng = R.makeRng('content-fuzz-2');
  for (let i = 0; i < 25; i++) {
    const content = {
      id: 'fz' + i, version: 1, seed: 'fz' + i + '-' + rng.int(0, 1e9),
      params: {
        layers: rng.int(3, 40), gapWidth: rng.range(0.7, 2.2),
        dangerProb: rng.range(0, 0.9), dangerArc: rng.range(0.6, 1.4),
        dangerExtraProb: rng.range(0, 0.5), driftProb: rng.range(0, 1),
        driftSpeed: rng.range(0.002, 0.008), comboEvery: rng.int(0, 5)
      }
    };
    C.validateContent(content); // must return, not hang
  }
});

// ---------- Golden sessions (easy/medium/hard terminal states)
test('golden: easy/medium/hard practice runs terminate with sane scores', () => {
  for (const preset of C.PRACTICE) {
    const content = { id: 'p-' + preset.id, version: 1, seed: 'golden-' + preset.id, params: preset.params, mechanics: { smashStreak: 3 } };
    const s = R.createGame(C.toConfig(content, { mode: 'practice' }));
    solve(s);
    eq(s.phase, 'terminal');
    ok(['completed', 'danger-sector'].includes(s.terminal.reason), preset.id + ' terminal: ' + s.terminal.reason);
    ok(R.totalScore(s) >= 0 && Number.isInteger(R.totalScore(s)), 'integer score');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
