/*
 * Spiral Drop — content: themes, layer generation, journey stages, daily,
 * challenges, lessons, and offline content validators.
 * Content is versioned data: { id, version, seed, params, goals, mechanics, parTicks, theme }.
 * UMD: browser (window.SpiralContent) and Node (tests/server).
 */
(function (root, factory) {
  var R = (typeof module === 'object' && module.exports) ? require('./rules.js') : root.SpiralRules;
  if (typeof module === 'object' && module.exports) module.exports = factory(R);
  else root.SpiralContent = factory(R);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  var CONTENT_VERSION = 1;

  // ---------- Themes (5 visual themes; cosmetic only — never change hitboxes/timing)
  var THEMES = [
    {
      id: 'ember', name: 'Ember Dusk',
      skyTop: '#2b1055', skyBottom: '#ff7e5f', fog: '#3a1c5f',
      pillar: '#4a2a6a', safe: '#f2b950', safeEmissive: '#201002',
      danger: '#e0342f', accent: '#ffd66e', ball: '#fff3d6', base: '#8be09a'
    },
    {
      id: 'tide', name: 'Deep Tide',
      skyTop: '#062a3f', skyBottom: '#1fd4c0', fog: '#0a3a4d',
      pillar: '#0e4a5e', safe: '#7ce8d5', safeEmissive: '#02201c',
      danger: '#ff5d73', accent: '#ffe37c', ball: '#eafcff', base: '#ffd166'
    },
    {
      id: 'orchard', name: 'Neon Orchard',
      skyTop: '#12061f', skyBottom: '#c83ee0', fog: '#22103a',
      pillar: '#33144f', safe: '#59f2a6', safeEmissive: '#03240f',
      danger: '#ff3d5e', accent: '#6ee7ff', ball: '#ffffff', base: '#ffe37c'
    },
    {
      id: 'dawn', name: 'Paper Dawn',
      skyTop: '#f7d9c4', skyBottom: '#7f9df0', fog: '#e8cdbb',
      pillar: '#5a6aa8', safe: '#fff7ec', safeEmissive: '#28200f',
      danger: '#c22f4e', accent: '#3ec1b9', ball: '#2c2f4a', base: '#3ec1b9'
    },
    {
      id: 'mono', name: 'Monochrome Signal',
      skyTop: '#0b0b10', skyBottom: '#3d3d4d', fog: '#14141c',
      pillar: '#23232e', safe: '#e8e8ef', safeEmissive: '#101014',
      danger: '#ff7a00', accent: '#00e0ff', ball: '#ffffff', base: '#00e0ff'
    }
  ];

  // Color-vision-safe palette override (shapes/stripes reinforce color already).
  var CVD_THEME_PATCH = { danger: '#0072B2', accent: '#E69F00', safe: '#F0E442' };

  // ---------- Layer generation (deterministic from seed)
  // params = { layers, gapWidth, dangerProb, dangerArc, driftProb, driftSpeed, comboEvery }
  function makeLayers(seed, params) {
    var rng = R.makeRng(R.hashString('layers:' + seed));
    var layers = [];
    var prevGap = rng.range(0, Math.PI * 2);
    for (var i = 0; i < params.layers; i++) {
      var gapWidth = params.gapWidth * rng.range(0.9, 1.1);
      var gapCenter;
      // Periodically align gaps into "combo shafts" so uninterrupted drops are possible.
      if (params.comboEvery && i > 0 && i % params.comboEvery < 2) {
        gapCenter = prevGap + rng.range(-0.15, 0.15);
      } else {
        gapCenter = prevGap + rng.range(-2.2, 2.2);
      }
      gapCenter = R.normAngle(gapCenter);
      prevGap = gapCenter;

      var danger = [];
      if (rng.next() < params.dangerProb) {
        var arcs = 1 + (rng.next() < (params.dangerExtraProb || 0) ? 1 : 0);
        for (var a = 0; a < arcs; a++) {
          var w = params.dangerArc * rng.range(0.8, 1.3);
          // keep danger arcs out of the gap with a safety margin
          var margin = 0.25;
          var free = Math.PI * 2 - gapWidth - w - margin * 2;
          if (free > 0.05) {
            var start = gapCenter + gapWidth / 2 + margin + rng.next() * free;
            danger.push([R.normAngle(start), w]);
          }
        }
      }
      var drift = 0;
      if (params.driftProb && rng.next() < params.driftProb) {
        drift = (rng.next() < 0.5 ? -1 : 1) * params.driftSpeed * rng.range(0.6, 1.4);
      }
      layers.push({
        offset: 0,
        gapCenter: gapCenter,
        gapWidth: gapWidth,
        danger: danger,
        drift: drift
      });
    }
    return layers;
  }

  // ---------- Journey: 40 authored stages (8 per theme), one concept at a time
  function journeyStages() {
    var stages = [];
    var names = [
      'First Drop', 'Steady Hand', 'Around the Rim', 'Long Way Down', 'Rhythm', 'High Tower', 'Quickstep', 'Summit Drill',
      'Narrow Door', 'Thread It', 'Twin Turns', 'Patient Fall', 'Combo Shaft', 'Deep Combo', 'Needle', 'Mastery Ring',
      'First Hazard', 'Red Arc', 'Watch the Paint', 'Hazard Pair', 'Threaded Needle', 'Split Decision', 'Hazard Rows', 'Mastery Fire',
      'Drift Lesson', 'Slow Sway', 'Counterspin', 'Drift Shaft', 'Moving Target', 'Double Drift', 'Hazard Drift', 'Mastery Tide',
      'Tight Squeeze', 'Gauntlet', 'Thin Ice', 'Combo Weave', 'Pressure Drop', 'Long Fall', 'Last Door', 'Mastery Crown'
    ];
    for (var i = 0; i < 40; i++) {
      var tier = Math.floor(i / 8);        // 0..4 → theme + concept block
      var step = i % 8;                    // position inside the block
      var mastery = step === 7;
      var p = {
        layers: 8 + tier * 4 + step,
        gapWidth: 1.5,
        dangerProb: 0,
        dangerArc: 0.9,
        dangerExtraProb: 0,
        driftProb: 0,
        driftSpeed: 0.004,
        comboEvery: step >= 4 ? 4 : 0
      };
      if (tier === 1) { p.gapWidth = 1.5 - 0.07 * (step + 1); p.comboEvery = 4; }
      if (tier === 2) { p.gapWidth = 1.15; p.dangerProb = 0.25 + 0.06 * step; p.dangerArc = 0.8 + 0.06 * step; p.comboEvery = 4; }
      if (tier === 3) { p.gapWidth = 1.1; p.dangerProb = 0.5; p.driftProb = 0.25 + 0.08 * step; p.dangerExtraProb = 0.2; p.comboEvery = 5; }
      if (tier === 4) { p.gapWidth = 1.0 - 0.02 * step; p.dangerProb = 0.6; p.dangerArc = 1.1; p.driftProb = 0.45; p.dangerExtraProb = 0.35; p.comboEvery = 5; }
      if (mastery) { p.layers += 6; p.dangerProb = Math.min(0.75, p.dangerProb + 0.15); p.gapWidth *= 0.92; }
      stages.push({
        id: 'j' + String(i + 1).padStart(2, '0'),
        version: CONTENT_VERSION,
        name: names[i],
        index: i,
        theme: THEMES[tier].id,
        seed: 'journey-' + (i + 1),
        params: p,
        mechanics: { smashStreak: 3 },
        parTicks: Math.round((p.layers * 4.2 + 30) * R.TICK_RATE / 4),
        mastery: mastery,
        goals: { type: 'reach-base' }
      });
    }
    return stages;
  }

  // ---------- Daily: one shared seed + ruleset per UTC day
  function dailyFor(date) {
    var d = date || new Date();
    var key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    var h = R.hashString('daily:' + key);
    var rng = R.makeRng(h);
    var params = {
      layers: 18 + rng.int(0, 8),
      gapWidth: rng.range(1.05, 1.3),
      dangerProb: rng.range(0.35, 0.6),
      dangerArc: rng.range(0.8, 1.15),
      dangerExtraProb: 0.25,
      driftProb: rng.range(0.15, 0.45),
      driftSpeed: 0.004,
      comboEvery: 4
    };
    return {
      id: 'daily-' + key,
      version: CONTENT_VERSION,
      name: 'Daily Drop — ' + key,
      day: key,
      theme: THEMES[h % THEMES.length].id,
      seed: 'daily:' + key,
      params: params,
      mechanics: { smashStreak: 3 },
      parTicks: Math.round((params.layers * 4.2 + 30) * R.TICK_RATE / 4),
      goals: { type: 'reach-base' },
      ranked: true
    };
  }

  // ---------- Practice presets
  var PRACTICE = [
    { id: 'calm', name: 'Calm', params: { layers: 10, gapWidth: 1.6, dangerProb: 0.15, dangerArc: 0.8, dangerExtraProb: 0, driftProb: 0, driftSpeed: 0.004, comboEvery: 3 } },
    { id: 'standard', name: 'Standard', params: { layers: 16, gapWidth: 1.25, dangerProb: 0.4, dangerArc: 0.95, dangerExtraProb: 0.15, driftProb: 0.15, driftSpeed: 0.004, comboEvery: 4 } },
    { id: 'expert', name: 'Expert', params: { layers: 26, gapWidth: 1.0, dangerProb: 0.65, dangerArc: 1.15, dangerExtraProb: 0.35, driftProb: 0.45, driftSpeed: 0.005, comboEvery: 5 } }
  ];

  // ---------- Challenges: constrained goals
  var CHALLENGES = [
    {
      id: 'c-moves', name: 'Minimal Touch', version: CONTENT_VERSION, theme: 'tide',
      seed: 'challenge-moves', description: 'Reach the base with a tight rotation budget.',
      params: { layers: 12, gapWidth: 1.35, dangerProb: 0.3, dangerArc: 0.9, dangerExtraProb: 0.1, driftProb: 0, driftSpeed: 0, comboEvery: 3 },
      moveLimitTicks: 60 * 14, mechanics: { smashStreak: 3 }
    },
    {
      id: 'c-speed', name: 'Speedrun Spiral', version: CONTENT_VERSION, theme: 'ember',
      seed: 'challenge-speed', description: 'Beat the clock to the base.',
      params: { layers: 14, gapWidth: 1.3, dangerProb: 0.35, dangerArc: 0.9, dangerExtraProb: 0.1, driftProb: 0.1, driftSpeed: 0.004, comboEvery: 3 },
      timeLimitTicks: 60 * 35, mechanics: { smashStreak: 3 }
    },
    {
      id: 'c-needle', name: 'Needlework', version: CONTENT_VERSION, theme: 'mono',
      seed: 'challenge-needle', description: 'Very narrow gaps. Precision is everything.',
      params: { layers: 10, gapWidth: 0.85, dangerProb: 0.3, dangerArc: 0.8, dangerExtraProb: 0, driftProb: 0, driftSpeed: 0, comboEvery: 0 },
      mechanics: { smashStreak: 3 }
    },
    {
      id: 'c-storm', name: 'Drift Storm', version: CONTENT_VERSION, theme: 'orchard',
      seed: 'challenge-storm', description: 'Every layer drifts. Read the motion.',
      params: { layers: 14, gapWidth: 1.2, dangerProb: 0.4, dangerArc: 0.95, dangerExtraProb: 0.2, driftProb: 1.0, driftSpeed: 0.006, comboEvery: 4 },
      mechanics: { smashStreak: 3 }
    },
    {
      id: 'c-deep', name: 'The Long Drop', version: CONTENT_VERSION, theme: 'dawn',
      seed: 'challenge-deep', description: 'Forty layers. Endurance and nerve.',
      params: { layers: 40, gapWidth: 1.2, dangerProb: 0.5, dangerArc: 1.0, dangerExtraProb: 0.25, driftProb: 0.3, driftSpeed: 0.004, comboEvery: 4 },
      mechanics: { smashStreak: 3 }
    },
    {
      id: 'c-smash', name: 'Breaker', version: CONTENT_VERSION, theme: 'ember',
      seed: 'challenge-smash', description: 'Danger everywhere — chain drops to smash through.',
      params: { layers: 15, gapWidth: 1.3, dangerProb: 0.85, dangerArc: 1.2, dangerExtraProb: 0.3, driftProb: 0.1, driftSpeed: 0.004, comboEvery: 3 },
      mechanics: { smashStreak: 3 }
    }
  ];

  // ---------- Learn-mode lessons (interactive; one rule at a time)
  var LESSONS = [
    {
      id: 'l1', name: 'Rotate the Tower', theme: 'tide', seed: 'lesson-1',
      brief: 'The tower turns; the ball does not. Rotate left and right with ←/→, A/D, the on-screen arrows, or by dragging.',
      goal: { type: 'rotate', ticks: 90 },
      params: { layers: 3, gapWidth: 2.2, dangerProb: 0, dangerArc: 0.8, dangerExtraProb: 0, driftProb: 0, driftSpeed: 0, comboEvery: 0 }
    },
    {
      id: 'l2', name: 'Find the Gap', theme: 'tide', seed: 'lesson-2',
      brief: 'Line the glowing gap up with the ball and it drops through. Pass every layer to reach the base.',
      goal: { type: 'reach-base' },
      params: { layers: 4, gapWidth: 1.9, dangerProb: 0, dangerArc: 0.8, dangerExtraProb: 0, driftProb: 0, driftSpeed: 0, comboEvery: 0 }
    },
    {
      id: 'l3', name: 'Danger Sectors', theme: 'ember', seed: 'lesson-3',
      brief: 'Striped sectors are dangerous. Never land on one — rotate past them before you drop.',
      goal: { type: 'reach-base' },
      params: { layers: 5, gapWidth: 1.7, dangerProb: 0.6, dangerArc: 0.9, dangerExtraProb: 0, driftProb: 0, driftSpeed: 0, comboEvery: 0 }
    },
    {
      id: 'l4', name: 'Combos', theme: 'orchard', seed: 'lesson-4',
      brief: 'Drop through several layers without landing for bonus points. Aligned gaps make a shaft — release and fall!',
      goal: { type: 'reach-base' },
      params: { layers: 8, gapWidth: 1.6, dangerProb: 0.25, dangerArc: 0.85, dangerExtraProb: 0, driftProb: 0, driftSpeed: 0, comboEvery: 3 }
    },
    {
      id: 'l5', name: 'Smash Through', theme: 'mono', seed: 'lesson-5',
      brief: 'Pass 3 layers in one drop and the ball charges up — the next danger sector shatters instead of stopping you.',
      goal: { type: 'reach-base' },
      params: { layers: 9, gapWidth: 1.5, dangerProb: 0.7, dangerArc: 1.0, dangerExtraProb: 0.2, driftProb: 0, driftSpeed: 0, comboEvery: 3 }
    }
  ];

  // ---------- Materialize a content descriptor into a rules config
  function toConfig(content, opts) {
    opts = opts || {};
    return {
      contentId: content.id,
      contentVersion: content.version || CONTENT_VERSION,
      seed: content.seed,
      mode: opts.mode || 'journey',
      layers: content._layers || makeLayers(content.seed, content.params),
      mechanics: content.mechanics || { smashStreak: 3 },
      moveLimitTicks: content.moveLimitTicks || 0,
      timeLimitTicks: content.timeLimitTicks || 0,
      parTicks: content.parTicks || 0,
      allowUndo: !!opts.allowUndo
    };
  }

  // ---------- Offline validators: legality, reachable goals, bounded duration, no soft locks
  function validateContent(content) {
    var issues = [];
    if (!content.id || !content.seed) issues.push('missing id/seed');
    if (!content.params || !(content.params.layers > 0) || content.params.layers > 200) issues.push('layers out of bounds');
    if (!(content.params.gapWidth >= 0.5 && content.params.gapWidth <= 2.6)) issues.push('gapWidth out of bounds');
    if (content.params.dangerProb < 0 || content.params.dangerProb > 1) issues.push('dangerProb out of bounds');
    var layers = content._layers || makeLayers(content.seed, content.params);
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i];
      var dangerTotal = 0;
      for (var d = 0; d < l.danger.length; d++) dangerTotal += l.danger[d][1];
      if (dangerTotal + l.gapWidth >= Math.PI * 2 - 0.3) issues.push('layer ' + i + ' has no safe landing sector');
      if (l.gapWidth <= 0.15) issues.push('layer ' + i + ' gap impassable');
    }
    // Reachability: a "wait forever, rotate toward the hint" policy must finish
    // within a bounded number of ticks on a seeded run.
    if (issues.length === 0) {
      var cfg = toConfig(content, { mode: 'validation' });
      var state = R.createGame(cfg);
      var guard = 0;
      while (state.phase !== 'terminal' && guard < R.MAX_TICKS) {
        var h = R.hint(state);
        if (h.action === 'rotateLeft') R.applyCommand(state, { type: 'rotateStart', dir: -1 });
        else if (h.action === 'rotateRight') R.applyCommand(state, { type: 'rotateStart', dir: 1 });
        else if (state.rotating !== 0) R.applyCommand(state, { type: 'rotateStop' });
        R.step(state);
        guard++;
      }
      if (state.phase !== 'terminal') issues.push('unbounded: solver did not terminate');
      else if (state.terminal.reason === 'tick-limit') issues.push('unbounded: hit tick limit');
      else if (guard > 60 * 60 * 10) issues.push('duration exceeds 10-minute bound');
      // Note: solver may lose to danger (it does not look ahead); that is not a
      // soft lock. Soft lock = non-termination, checked above.
    }
    return { ok: issues.length === 0, issues: issues };
  }

  return {
    CONTENT_VERSION: CONTENT_VERSION,
    THEMES: THEMES,
    CVD_THEME_PATCH: CVD_THEME_PATCH,
    makeLayers: makeLayers,
    journeyStages: journeyStages,
    dailyFor: dailyFor,
    PRACTICE: PRACTICE,
    CHALLENGES: CHALLENGES,
    LESSONS: LESSONS,
    toConfig: toConfig,
    validateContent: validateContent,
    themeById: function (id) {
      for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
      return THEMES[0];
    }
  };
}));
