/*
 * Spiral Drop — rules engine.
 * Pure, deterministic, serializable. No rendering, no DOM, no timers.
 * UMD: usable from the browser (window.SpiralRules) and from Node (server/tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpiralRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RULES_VERSION = 1;
  var TICK_RATE = 60;                    // fixed simulation step
  var TWO_PI = Math.PI * 2;

  // ---- Tunables (fixed for a rules version; never change without bumping RULES_VERSION)
  var ROT_SPEED = 0.055;                 // rad per tick while a rotate input is held
  var GRAVITY = 0.0016;                  // layer-units per tick^2
  var MAX_FALL_SPEED = 0.09;             // layer-units per tick
  var BALL_CLEARANCE = 0.045;            // rad of ball angular radius subtracted from gap
  var SMASH_STREAK = 3;                  // consecutive passed layers required to smash danger
  var RESOLVE_TICKS = 4;                 // short non-interruptible landing resolution
  var MAX_TICKS = TICK_RATE * 60 * 30;   // hard bound: 30 sim-minutes, no unbounded loops

  var SCORE = {
    LAYER: 10,          // per layer descended
    COMBO_STEP: 15,     // per extra layer in one uninterrupted drop
    PRECISION: 10,      // centered drop (alignment quality >= PRECISION_MIN)
    PRECISION_MIN: 0.75,
    COMPLETION: 100,
    TIME_BONUS_PER_TICK: 0.5, // per tick under par
    SMASH: 25
  };

  // ---------- Seeded RNG (mulberry32) + string hash (FNV-1a 32-bit)
  function hashString(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    var a = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
    var state = { a: a };
    return {
      next: function () {
        state.a = (state.a + 0x6D2B79F5) >>> 0;
        var t = state.a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      range: function (min, max) { return min + (max - min) * this.next(); },
      int: function (min, max) { return Math.floor(this.range(min, max + 1)); },
      pick: function (arr) { return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))]; },
      getState: function () { return state.a; }
    };
  }

  // ---------- Angle helpers
  function normAngle(a) {
    a = a % TWO_PI;
    if (a < 0) a += TWO_PI;
    return a;
  }
  // Signed shortest distance from a to b, in (-PI, PI].
  function angleDelta(from, to) {
    var d = normAngle(to) - normAngle(from);
    if (d > Math.PI) d -= TWO_PI;
    if (d < -Math.PI) d += TWO_PI;
    return d;
  }

  // ---------- Layers
  // layer = { offset, gapCenter, gapWidth, danger: [[start,width],...], drift }
  // World angle of a layer-local angle `local` at tick t:
  //   world = towerAngle + layer.offset + layer.drift * t + local
  function layerBaseAngle(state, layer) {
    return state.towerAngle + layer.offset + layer.drift * state.tick;
  }

  // Ball sits at fixed world angle 0. Returns angular distance from ball to the
  // center of the layer's gap (signed), and whether the ball clears the gap.
  function gapAlignment(state, layerIndex) {
    var layer = state.config.layers[layerIndex];
    var gapWorld = layerBaseAngle(state, layer) + layer.gapCenter;
    var d = angleDelta(0, gapWorld); // from ball (0) to gap center
    var half = layer.gapWidth / 2 - BALL_CLEARANCE;
    return { delta: d, clear: Math.abs(d) < half, quality: half > 0 ? 1 - Math.abs(d) / half : 0 };
  }

  function pointInDanger(state, layerIndex) {
    var layer = state.config.layers[layerIndex];
    var base = layerBaseAngle(state, layer);
    for (var i = 0; i < layer.danger.length; i++) {
      var start = normAngle(base + layer.danger[i][0]);
      var w = layer.danger[i][1];
      var rel = normAngle(0 - start); // ball is at world angle 0
      if (rel < w) return true;
    }
    return false;
  }

  // ---------- Game creation
  // config = {
  //   contentId, contentVersion, seed, mode,
  //   layers: [...], mechanics?: { smashStreak }, moveLimitTicks?, timeLimitTicks?,
  //   parTicks?, allowUndo?
  // }
  function validateConfig(config) {
    if (!config || typeof config !== 'object') return 'config-missing';
    if (typeof config.seed === 'undefined') return 'seed-missing';
    if (!Array.isArray(config.layers) || config.layers.length === 0) return 'layers-missing';
    if (config.layers.length > 500) return 'layers-unbounded';
    for (var i = 0; i < config.layers.length; i++) {
      var l = config.layers[i];
      if (!l || typeof l.gapCenter !== 'number' || typeof l.gapWidth !== 'number') return 'layer-malformed';
      if (!(l.gapWidth > 0.15 && l.gapWidth < TWO_PI - 0.5)) return 'gap-out-of-range';
      if (!Array.isArray(l.danger)) return 'danger-malformed';
      if (typeof l.offset !== 'number' || typeof l.drift !== 'number') return 'layer-malformed';
    }
    return null;
  }

  function createGame(config) {
    var err = validateConfig(config);
    if (err) throw new Error('invalid-config: ' + err);
    var mechanics = config.mechanics || {};
    return {
      rulesVersion: RULES_VERSION,
      contentId: config.contentId || 'custom',
      contentVersion: config.contentVersion || 1,
      seed: String(config.seed),
      mode: config.mode || 'practice',
      config: config,
      tick: 0,
      phase: 'rest',            // rest | falling | resolving | terminal
      towerAngle: 0,
      rotating: 0,              // -1 | 0 | 1
      ball: { layer: -1, y: 0, vy: 0 },  // rests on top of ring 0 (start deck)
      fallFrom: -1,
      fallQuality: 0,
      fallPassed: 0,
      streak: 0,                // layers passed without resting (drives smash)
      resolveTicks: 0,
      smashAvailableNotified: false,
      score: { layers: 0, combo: 0, precision: 0, smash: 0, completion: 0, timeBonus: 0 },
      stats: {
        moves: 0, rotationTicks: 0, invalidActions: 0, undos: 0,
        layersPassed: 0, bestFall: 0, smashes: 0
      },
      undoStack: [],
      terminal: null,           // { reason, detail }
      inputLog: [],             // { tick, type, dir?, id? }
      seenCommandIds: {},
      hashes: [],               // periodic state hashes for the replay envelope
      lastEvent: null           // set by step/applyCommand for render/audio mapping
    };
  }

  // ---------- Legal actions
  function legalActions(state) {
    if (state.phase === 'terminal') return [];
    var actions = [];
    if (state.phase !== 'resolving') {
      if (state.rotating !== -1) actions.push('rotateLeft');
      if (state.rotating !== 1) actions.push('rotateRight');
      if (state.rotating !== 0) actions.push('rotateStop');
    }
    if (state.config.allowUndo && state.phase === 'rest' && state.undoStack.length > 0) actions.push('undo');
    actions.push('abandon');
    return actions;
  }

  function isLegal(state, cmd) {
    var legal = legalActions(state);
    if (cmd.type === 'rotateStart') return legal.indexOf(cmd.dir === -1 ? 'rotateLeft' : 'rotateRight') !== -1 ? null : 'rotate-not-available';
    if (cmd.type === 'rotateStop') return legal.indexOf('rotateStop') !== -1 ? null : 'not-rotating';
    if (cmd.type === 'undo') return legal.indexOf('undo') !== -1 ? null : 'undo-not-available';
    if (cmd.type === 'abandon') return legal.indexOf('abandon') !== -1 ? null : 'not-available';
    return 'unknown-command';
  }

  function totalScore(state) {
    var s = state.score;
    return s.layers + s.combo + s.precision + s.smash + s.completion + s.timeBonus;
  }

  function snapshot(state) {
    // Serializable snapshot of everything needed to resume deterministically.
    return {
      tick: state.tick, phase: state.phase, towerAngle: state.towerAngle,
      rotating: state.rotating,
      ball: { layer: state.ball.layer, y: state.ball.y, vy: state.ball.vy },
      fallFrom: state.fallFrom, fallQuality: state.fallQuality, fallPassed: state.fallPassed,
      streak: state.streak, resolveTicks: state.resolveTicks,
      score: Object.assign({}, state.score),
      stats: Object.assign({}, state.stats),
      terminal: state.terminal ? Object.assign({}, state.terminal) : null
    };
  }

  function restoreSnapshot(state, snap) {
    state.tick = snap.tick; state.phase = snap.phase; state.towerAngle = snap.towerAngle;
    state.rotating = snap.rotating;
    state.ball = Object.assign({}, snap.ball);
    state.fallFrom = snap.fallFrom; state.fallQuality = snap.fallQuality; state.fallPassed = snap.fallPassed;
    state.streak = snap.streak; state.resolveTicks = snap.resolveTicks;
    state.score = Object.assign({}, snap.score);
    state.stats = Object.assign({}, snap.stats);
    state.terminal = snap.terminal ? Object.assign({}, snap.terminal) : null;
  }

  // ---------- Commands
  // cmd = { type:'rotateStart', dir:-1|1, id? } | { type:'rotateStop', id? } |
  //       { type:'undo', id? } | { type:'abandon', id? }
  // Returns { ok:true } or { ok:false, reason }. Duplicates by id are rejected idempotently.
  function applyCommand(state, cmd) {
    state.lastEvent = null;
    if (!cmd || typeof cmd.type !== 'string') { state.stats.invalidActions++; return { ok: false, reason: 'malformed-command' }; }
    if (cmd.id != null) {
      if (state.seenCommandIds[cmd.id]) return { ok: true, duplicate: true };
    }
    var reason = isLegal(state, cmd);
    if (reason) {
      state.stats.invalidActions++;
      state.lastEvent = { type: 'invalid', reason: reason };
      return { ok: false, reason: reason };
    }
    if (cmd.id != null) state.seenCommandIds[cmd.id] = true;

    switch (cmd.type) {
      case 'rotateStart':
        state.rotating = cmd.dir;
        state.stats.moves++;
        state.inputLog.push({ tick: state.tick, type: 'rotateStart', dir: cmd.dir, id: cmd.id });
        state.lastEvent = { type: 'rotateStart', dir: cmd.dir };
        break;
      case 'rotateStop':
        state.rotating = 0;
        state.inputLog.push({ tick: state.tick, type: 'rotateStop', id: cmd.id });
        state.lastEvent = { type: 'rotateStop' };
        break;
      case 'undo': {
        var snap = state.undoStack.pop();
        restoreSnapshot(state, snap);
        state.stats.undos++;
        state.inputLog.push({ tick: state.tick, type: 'undo', id: cmd.id });
        state.lastEvent = { type: 'undo' };
        break;
      }
      case 'abandon':
        finish(state, 'abandoned', null);
        state.inputLog.push({ tick: state.tick, type: 'abandon', id: cmd.id });
        break;
    }
    return { ok: true };
  }

  function finish(state, reason, detail) {
    state.phase = 'terminal';
    state.rotating = 0;
    state.terminal = { reason: reason, detail: detail || null };
    if (reason === 'completed') {
      // the final fall still earns its combo/precision components
      if (state.fallPassed > 1) state.score.combo += SCORE.COMBO_STEP * (state.fallPassed - 1);
      if (state.fallPassed >= 1 && state.fallQuality >= SCORE.PRECISION_MIN) state.score.precision += SCORE.PRECISION;
      state.score.completion += SCORE.COMPLETION;
      var par = state.config.parTicks;
      if (par && state.tick < par) {
        state.score.timeBonus += Math.round((par - state.tick) * SCORE.TIME_BONUS_PER_TICK);
      }
    }
    state.lastEvent = { type: 'terminal', reason: reason };
    pushHash(state);
  }

  // ---------- Simulation step (one fixed tick)
  function step(state) {
    state.lastEvent = null;
    if (state.phase === 'terminal') return state;
    if (state.tick >= MAX_TICKS) { finish(state, 'tick-limit', null); return state; }
    state.tick++;

    // rotation input applies every tick (except during the short resolve lock)
    if (state.phase !== 'resolving' && state.rotating !== 0) {
      state.towerAngle = normAngle(state.towerAngle + state.rotating * ROT_SPEED);
      state.stats.rotationTicks++;
      if (state.config.moveLimitTicks && state.stats.rotationTicks > state.config.moveLimitTicks) {
        finish(state, 'move-limit-exceeded', { limit: state.config.moveLimitTicks });
        return state;
      }
    }
    if (state.config.timeLimitTicks && state.tick > state.config.timeLimitTicks) {
      finish(state, 'time-expired', { limit: state.config.timeLimitTicks });
      return state;
    }

    var n = state.config.layers.length;

    if (state.phase === 'rest') {
      // ball.layer = last ring fully passed (-1 = start deck). The ball bounces
      // on top of ring `restRing`; to descend it must drop through that ring's gap.
      var restRing = state.ball.layer + 1;
      var al = restRing >= n ? { delta: 0, clear: true, quality: 1 } : gapAlignment(state, restRing);
      if (al.clear) {
        // commit the pass through ring `restRing` (gap confirmed under the ball)
        if (state.config.allowUndo) state.undoStack.push(snapshot(state));
        if (restRing < n) {
          state.ball.layer = restRing;
          state.fallPassed = 1;
          state.streak++;
          state.stats.layersPassed++;
          if (state.fallPassed > state.stats.bestFall) state.stats.bestFall = state.fallPassed;
          state.score.layers += SCORE.LAYER;
        } else {
          state.fallPassed = 0; // dropping to the base
        }
        state.phase = 'falling';
        state.fallFrom = restRing - 1;
        state.fallQuality = al.quality;
        state.ball.vy = 0.012; // initial drop speed
        state.lastEvent = { type: 'fallStart', layer: restRing, quality: al.quality };
      }
    } else if (state.phase === 'falling') {
      state.ball.vy = Math.min(MAX_FALL_SPEED, state.ball.vy + GRAVITY);
      state.ball.y += state.ball.vy;
      var surface = state.ball.layer + 1; // top plane of the next ring below
      if (surface >= n) {
        // no rings left below — falling to the base
        if (state.ball.y >= n) {
          state.ball.y = n;
          finish(state, 'completed', { falls: state.fallPassed });
          return state;
        }
      } else if (state.ball.y >= surface) {
        // Reached the plane of ring `surface`. The tower may have rotated during
        // the fall, so legality is re-evaluated at the crossing instant.
        var g = gapAlignment(state, surface);
        if (g.clear) {
          // passes cleanly through the gap of ring `surface`
          state.ball.layer = surface;
          state.fallPassed++;
          state.streak++;
          state.stats.layersPassed++;
          if (state.fallPassed > state.stats.bestFall) state.stats.bestFall = state.fallPassed;
          state.score.layers += SCORE.LAYER;
          state.lastEvent = { type: 'passThrough', layer: surface, streak: state.streak };
          if (state.tick % TICK_RATE === 0) pushHash(state);
          return state;
        }
        // The gap is not under the ball: it lands on top of ring `surface`
        // (ball.layer stays at surface-1 — the ring is landed on, not passed).
        var danger = pointInDanger(state, surface);
        var smashStreak = (state.config.mechanics && state.config.mechanics.smashStreak) || SMASH_STREAK;
        if (danger && state.streak < smashStreak) {
          state.ball.y = surface;
          finish(state, 'danger-sector', { layer: surface, streak: state.streak });
          return state;
        }
        if (danger) {
          // streak charged: smash straight through the danger sector, keep falling
          state.ball.layer = surface;
          state.streak = 0;
          state.stats.smashes++;
          state.stats.layersPassed++;
          state.fallPassed++;
          state.score.smash += SCORE.SMASH;
          state.score.layers += SCORE.LAYER;
          state.lastEvent = { type: 'smash', layer: surface };
          pushHash(state);
          return state;
        }
        // safe landing: settle on top of ring `surface`
        state.ball.y = surface;
        state.ball.vy = 0;
        if (state.fallPassed > 1) state.score.combo += SCORE.COMBO_STEP * (state.fallPassed - 1);
        if (state.fallQuality >= SCORE.PRECISION_MIN) state.score.precision += SCORE.PRECISION;
        state.streak = 0;
        state.phase = 'resolving';
        state.resolveTicks = RESOLVE_TICKS;
        state.lastEvent = {
          type: 'land', layer: surface, falls: state.fallPassed,
          precision: state.fallQuality >= SCORE.PRECISION_MIN
        };
        pushHash(state);
        return state;
      }
    } else if (state.phase === 'resolving') {
      state.resolveTicks--;
      if (state.resolveTicks <= 0) {
        state.phase = 'rest';
        state.lastEvent = { type: 'settled', layer: state.ball.layer };
      }
    }

    if (state.tick % TICK_RATE === 0) pushHash(state); // once per sim-second
    return state;
  }

  // ---------- Hints (uses the same legality data as play)
  // Suggests a rotation direction that moves the next gap toward the ball.
  function hint(state) {
    if (state.phase === 'terminal') return { action: 'none', reason: 'game-over' };
    var next = state.ball.layer + 1;
    if (next >= state.config.layers.length) return { action: 'none', reason: 'at-base' };
    var al = gapAlignment(state, next);
    if (al.clear) return { action: 'wait', reason: 'gap-aligned' };
    // Rotating +1 moves gapWorld by +ROT_SPEED per tick; we want delta→0.
    var dir = al.delta > 0 ? -1 : 1;
    return { action: dir === -1 ? 'rotateLeft' : 'rotateRight', degreesOff: Math.abs(al.delta) * 180 / Math.PI };
  }

  // ---------- Serialization & hashing
  function serialize(state) {
    return JSON.stringify({
      rulesVersion: state.rulesVersion,
      contentId: state.contentId, contentVersion: state.contentVersion,
      seed: state.seed, mode: state.mode, config: state.config,
      tick: state.tick, phase: state.phase, towerAngle: state.towerAngle, rotating: state.rotating,
      ball: state.ball, fallFrom: state.fallFrom, fallQuality: state.fallQuality,
      fallPassed: state.fallPassed, streak: state.streak, resolveTicks: state.resolveTicks,
      score: state.score, stats: state.stats, undoStack: state.undoStack,
      terminal: state.terminal, inputLog: state.inputLog, hashes: state.hashes
    });
  }

  function deserialize(json) {
    var s = typeof json === 'string' ? JSON.parse(json) : json;
    if (s.rulesVersion !== RULES_VERSION) throw new Error('unsupported-rules-version: ' + s.rulesVersion);
    var st = createGame(s.config);
    st.tick = s.tick; st.phase = s.phase; st.towerAngle = s.towerAngle; st.rotating = s.rotating;
    st.ball = s.ball; st.fallFrom = s.fallFrom; st.fallQuality = s.fallQuality;
    st.fallPassed = s.fallPassed; st.streak = s.streak; st.resolveTicks = s.resolveTicks;
    st.score = s.score; st.stats = s.stats; st.undoStack = s.undoStack || [];
    st.terminal = s.terminal; st.inputLog = s.inputLog || []; st.hashes = s.hashes || [];
    st.seenCommandIds = {};
    for (var i = 0; i < st.inputLog.length; i++) {
      var c = st.inputLog[i];
      if (c.id != null) st.seenCommandIds[c.id] = true;
    }
    return st;
  }

  // Stable hash of the authoritative state (excludes logs and cosmetics).
  function stateHash(state) {
    var snap = snapshot(state);
    snap.towerAngle = Math.round(snap.towerAngle * 1e9) / 1e9;
    snap.ball.y = Math.round(snap.ball.y * 1e9) / 1e9;
    snap.ball.vy = Math.round(snap.ball.vy * 1e9) / 1e9;
    // invalidActions counts rejected client commands, which are not part of the
    // replayed input log; exclude so replays reproduce the hash exactly.
    snap.stats.invalidActions = 0;
    return hashString(JSON.stringify(snap)).toString(16);
  }

  function pushHash(state) {
    state.hashes.push({ tick: state.tick, hash: stateHash(state) });
    if (state.hashes.length > 2048) state.hashes.shift();
  }

  // ---------- Replay
  // Re-runs config + inputLog and returns the resulting state.
  function replay(config, inputLog, maxTicks) {
    var state = createGame(config);
    var log = (inputLog || []).slice().sort(function (a, b) { return a.tick - b.tick; });
    var li = 0;
    var limit = maxTicks || MAX_TICKS;
    while (state.phase !== 'terminal' && state.tick < limit) {
      while (li < log.length && log[li].tick <= state.tick) {
        applyCommand(state, log[li]);
        li++;
      }
      step(state);
    }
    // drain commands scheduled at/after terminal tick (idempotent no-ops mostly)
    return state;
  }

  // Envelope = { schemaVersion, rulesVersion, contentVersion, contentId, seed, config,
  //             startedAtOffset, inputLog, hashes, result }
  function verifyEnvelope(env) {
    if (!env || env.schemaVersion !== 1) return { ok: false, reason: 'bad-schema' };
    if (env.rulesVersion !== RULES_VERSION) return { ok: false, reason: 'stale-version' };
    var state = replay(env.config, env.inputLog);
    var expected = stateHash(state);
    var actual = env.hashes && env.hashes.length ? env.hashes[env.hashes.length - 1].hash : null;
    if (actual !== expected) return { ok: false, reason: 'hash-mismatch', expected: expected, actual: actual };
    if (!state.terminal || !env.result || state.terminal.reason !== env.result.reason) {
      return { ok: false, reason: 'result-mismatch' };
    }
    if (totalScore(state) !== env.result.score) return { ok: false, reason: 'score-mismatch' };
    return { ok: true, score: totalScore(state), terminal: state.terminal.reason };
  }

  function buildEnvelope(state, startedAtOffset) {
    return {
      schemaVersion: 1,
      rulesVersion: RULES_VERSION,
      contentVersion: state.contentVersion,
      contentId: state.contentId,
      seed: state.seed,
      config: state.config,
      startedAtOffset: startedAtOffset || 0,
      inputLog: state.inputLog,
      hashes: state.hashes,
      result: {
        reason: state.terminal ? state.terminal.reason : 'incomplete',
        score: totalScore(state),
        components: Object.assign({}, state.score),
        stats: Object.assign({}, state.stats),
        ticks: state.tick
      }
    };
  }

  // Tie-break ordering: completion, fewer invalid actions, lower elapsed ticks, then stable id.
  function compareResults(a, b) {
    var ca = a.reason === 'completed' ? 1 : 0;
    var cb = b.reason === 'completed' ? 1 : 0;
    if (ca !== cb) return cb - ca;
    if (a.score !== b.score) return b.score - a.score;
    if (a.invalidActions !== b.invalidActions) return a.invalidActions - b.invalidActions;
    if (a.ticks !== b.ticks) return a.ticks - b.ticks;
    return String(a.sessionId).localeCompare(String(b.sessionId));
  }

  return {
    RULES_VERSION: RULES_VERSION,
    TICK_RATE: TICK_RATE,
    ROT_SPEED: ROT_SPEED,
    MAX_TICKS: MAX_TICKS,
    SCORE: SCORE,
    SMASH_STREAK: SMASH_STREAK,
    hashString: hashString,
    makeRng: makeRng,
    normAngle: normAngle,
    angleDelta: angleDelta,
    gapAlignment: gapAlignment,
    pointInDanger: pointInDanger,
    layerBaseAngle: layerBaseAngle,
    validateConfig: validateConfig,
    createGame: createGame,
    legalActions: legalActions,
    isLegal: isLegal,
    applyCommand: applyCommand,
    step: step,
    hint: hint,
    totalScore: totalScore,
    serialize: serialize,
    deserialize: deserialize,
    stateHash: stateHash,
    replay: replay,
    buildEnvelope: buildEnvelope,
    verifyEnvelope: verifyEnvelope,
    compareResults: compareResults
  };
}));
