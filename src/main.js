/*
 * Spiral Drop — bootstrap, session orchestration, input, persistence.
 * Modules: rules (deterministic sim), content, render, ui, audio, platform.
 */
import { createRenderer, CAM } from './render.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { createPlatform } from './platform.js';

const R = window.SpiralRules;
const C = window.SpiralContent;

const DT = 1 / R.TICK_RATE;
const BINDINGS = { left: '← / A', right: '→ / D', undo: 'U', hint: 'H' };

const ACHIEVEMENTS = [
  { key: 'first_clear', name: 'First Descent', desc: 'Complete any stage.' },
  { key: 'combo_master', name: 'Freefall', desc: 'Drop through 4+ rings in one fall.' },
  { key: 'streak_keeper', name: 'Creature of Habit', desc: 'Complete the Daily Drop 3 days in a row.' },
  { key: 'milestone_hard', name: 'Crown of the Spiral', desc: 'Clear Journey stage 40.' },
  { key: 'long_haul', name: 'Thousand Layers', desc: 'Descend 1000 layers total.' }
];

// ---------------- persistence ----------------
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const doc = JSON.parse(raw);
    if (doc.v !== 1 || R.hashString(JSON.stringify(doc.data)) !== doc.checksum) return fallback;
    return doc.data;
  } catch { return fallback; }
}
function saveJSON(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ v: 1, data, checksum: R.hashString(JSON.stringify(data)) }));
  } catch { /* storage full/blocked: play on without persistence */ }
}

const settings = Object.assign({
  music: 0.6, effects: 0.8, ambience: 0.5, voice: 0.8, muted: false,
  quality: 'high', reducedMotion: false, highContrast: false, cvdPalette: false,
  largeText: false, leftHanded: false, holdToRotate: true, captions: true
}, loadJSON('spiraldrop.settings.v1', {}));

const progress = Object.assign({
  stages: {}, lessons: {}, achievements: {}, lifetimeLayers: 0,
  dailyStreak: { last: null, count: 0 }, bestScores: {}, nextStage: 0
}, loadJSON('spiraldrop.progress.v1', {}));

const telemetry = Object.assign({
  starts: 0, tutorialSteps: 0, roundEnds: 0, retries: 0, settingsChanges: 0, errors: 0
}, loadJSON('spiraldrop.telemetry.v1', {}));

function saveSettings() { saveJSON('spiraldrop.settings.v1', settings); syncCloud(); }
function saveProgress() { saveJSON('spiraldrop.progress.v1', progress); syncCloud(); }
function bumpTel(key) { telemetry[key] = (telemetry[key] || 0) + 1; saveJSON('spiraldrop.telemetry.v1', telemetry); syncCloud(); }

// Cloud mirror of the local save doc (settings + progress + telemetry).
// localStorage stays the offline cache; the platform slot is a remote mirror,
// written debounced and flushed on pagehide. Remote wins on conflict.
const CLOUD_SETTINGS_KEYS = ['music', 'effects', 'ambience', 'voice', 'muted', 'quality', 'reducedMotion', 'highContrast', 'cvdPalette', 'largeText', 'leftHanded', 'holdToRotate', 'captions'];
const CLOUD_PROGRESS_KEYS = ['stages', 'lessons', 'achievements', 'lifetimeLayers', 'dailyStreak', 'bestScores', 'nextStage'];
const CLOUD_TELEMETRY_KEYS = ['starts', 'tutorialSteps', 'roundEnds', 'retries', 'settingsChanges', 'errors'];
function collectCloudDoc() { return { settings, progress, telemetry, savedAt: Date.now() }; }
function syncCloud() { if (platform.hosted && platform.authenticated) platform.cloudSave(collectCloudDoc()); }
function adoptCloudDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;
  let any = false;
  if (doc.settings) for (const k of CLOUD_SETTINGS_KEYS) if (k in doc.settings) { settings[k] = doc.settings[k]; any = true; }
  if (doc.progress) for (const k of CLOUD_PROGRESS_KEYS) if (k in doc.progress) { progress[k] = doc.progress[k]; any = true; }
  if (doc.telemetry) for (const k of CLOUD_TELEMETRY_KEYS) if (k in doc.telemetry) { telemetry[k] = doc.telemetry[k]; any = true; }
  return any;
}

// ---------------- platform / audio ----------------
const platform = createPlatform();
const audio = createAudio(settings);
audio.onCaption((t) => { if (settings.captions) ui.caption(t); });

// ---------------- renderer (with fallback message) ----------------
let renderer = null;
const fatalEl = document.getElementById('fatal');
function fatal(msg) {
  fatalEl.hidden = false;
  fatalEl.innerHTML = '<div class="panel"><h1>Spiral Drop</h1><p>' + msg + '</p></div>';
}
try {
  renderer = createRenderer(document.getElementById('gl'), {
    cvdPatch: C.CVD_THEME_PATCH,
    onContextLost(kind) {
      if (kind === 'unavailable') return;
      ui.announceUrgent('Graphics context lost — recovering.');
      if (session.phase === 'active') pauseGame();
    },
    onContextRestored() { ui.toast('Graphics recovered.'); }
  });
} catch (e) {
  fatal('Your browser could not create a WebGL context, so the 3D playfield is unavailable. ' +
    'Your settings and progress are safe. Try updating your browser or enabling hardware acceleration.');
  throw e;
}
renderer.setTier(settings.quality);
renderer.setReducedMotion(settings.reducedMotion);
renderer.setHighContrast(settings.highContrast);

// ---------------- session state machine ----------------
// boot → title → preparing → countdown → active ↔ paused → results → progression
const session = {
  phase: 'title',        // title | setup | countdown | active | paused | results | replay
  state: null,           // rules state
  content: null,
  mode: null,
  opts: null,
  acc: 0,
  prev: { angle: 0, ballY: 0 },
  cmdCounter: 0,
  replayEnv: null,
  replayIndex: 0,
  lessonGoalMet: false,
  startedAt: 0,
  resumeWithCountdown: false
};

const stages = C.journeyStages();
// recomputed once the platform has synced server time (see boot), so the daily
// board follows the authoritative UTC day rather than a skewed device clock
let daily = C.dailyFor(platform.now());

function journeyUnlocked() {
  let u = 0;
  for (let i = 0; i < stages.length; i++) {
    if (progress.stages[stages[i].id]) u = i + 1; else break;
  }
  return Math.min(u, stages.length - 1);
}

function nextJourneyIndex() {
  for (let i = 0; i < stages.length; i++) if (!progress.stages[stages[i].id]) return i;
  return stages.length - 1;
}

function themeFor(content) { return C.themeById(content.theme || 'ember'); }

function modeSetupInfo(kind, id) {
  if (kind === 'journey') {
    const st = stages[id];
    return {
      title: 'Stage ' + (st.index + 1) + ' — ' + st.name,
      description: 'Theme: ' + themeFor(st).name + '. Par ' + Math.round(st.parTicks / R.TICK_RATE) + 's.',
      duration: Math.ceil(st.params.layers * 3 / 10) * 10 + 's',
      ranked: false, assists: 'none',
      rules: ['Reach the base by dropping through every ring’s gap.', 'Striped sectors end the run.', 'Falls of 3+ rings charge a smash.'],
      onStart: () => startRun(st, 'journey', { allowUndo: false })
    };
  }
  if (kind === 'practice') {
    const pr = C.PRACTICE.find(p => p.id === id);
    const content = { id: 'practice-' + pr.id + '-' + Date.now(), version: 1, seed: 'practice-' + pr.id + '-' + Math.floor(Math.random() * 1e9), params: pr.params, mechanics: { smashStreak: 3 }, theme: 'tide' };
    return {
      title: 'Practice — ' + pr.name,
      description: 'A fresh seeded tower. The seed is shown in results for inspection.',
      duration: Math.ceil(pr.params.layers * 3 / 10) * 10 + 's',
      ranked: false, assists: 'undo + hints',
      rules: ['Undo rewinds the last drop.', 'Hints point at the nearest gap.', 'Nothing here affects ratings.'],
      onStart: () => startRun(content, 'practice', { allowUndo: true })
    };
  }
  if (kind === 'challenge') {
    const ch = C.CHALLENGES.find(c => c.id === id);
    const rules = ['Reach the base under the constraint.'];
    if (ch.moveLimitTicks) rules.push('Rotation budget: ' + Math.round(ch.moveLimitTicks / R.TICK_RATE) + 's of total turning.');
    if (ch.timeLimitTicks) rules.push('Clock: ' + Math.round(ch.timeLimitTicks / R.TICK_RATE) + 's.');
    return {
      title: ch.name, description: ch.description,
      duration: '1–3 min', ranked: false, assists: 'none', rules,
      onStart: () => startRun(ch, 'challenge', { allowUndo: false })
    };
  }
  if (kind === 'daily') {
    return {
      title: daily.name,
      description: 'One shared seed per UTC day. Everyone gets the same tower. Best valid run is submitted.',
      duration: '1–2 min', ranked: platform.hosted, assists: 'none',
      rules: ['Same seed and ruleset for all players today.', 'Score is validated by deterministic replay.'],
      onStart: () => startRun(daily, 'daily', { allowUndo: false, ranked: true })
    };
  }
  if (kind === 'learn') {
    const l = C.LESSONS[id];
    return {
      title: 'Lesson ' + (id + 1) + ' — ' + l.name,
      description: l.brief,
      duration: '<1 min', ranked: false, assists: 'hints',
      rules: [l.brief],
      onStart: () => startRun(l, 'learn', { allowUndo: true, lesson: l })
    };
  }
}

// ---------------- run lifecycle ----------------
function startRun(content, mode, opts) {
  session.content = content;
  session.mode = mode;
  session.opts = opts || {};
  const cfg = C.toConfig(content, { mode, allowUndo: !!session.opts.allowUndo });
  session.state = R.createGame(cfg);
  session.phase = 'countdown';
  session.acc = 0;
  session.prev = { angle: 0, ballY: 0 };
  session.lessonGoalMet = false;
  session.resumeWithCountdown = false;
  session.startedAt = Date.now();
  audio.seedVariants(R.hashString(content.seed));
  renderer.applyTheme(themeFor(content), settings.cvdPalette);
  renderer.setLayers(cfg.layers);
  ui.close();
  ui.showHud(true);
  audio.unlock();
  audio.setIntensity(0);
  platform.startActivity(mode, content.id);
  bumpTel('starts');
  runCountdown();
}

let countdownTimers = [];
function runCountdown() {
  clearCountdown();
  const seq = ['3', '2', '1', 'Drop!'];
  seq.forEach((t, i) => {
    countdownTimers.push(setTimeout(() => {
      ui.countdown(t);
      audio.event('countdown');
      if (i === seq.length - 1) {
        countdownTimers.push(setTimeout(() => {
          ui.countdown(null);
          session.phase = 'active';
          ui.announce('Go. ' + objectiveText());
        }, 550));
      }
    }, i * 700));
  });
}
function clearCountdown() { countdownTimers.forEach(clearTimeout); countdownTimers = []; ui.countdown(null); }

function objectiveText() {
  const c = session.content;
  if (session.mode === 'learn') return session.opts.lesson.brief;
  if (session.mode === 'daily') return 'Daily Drop — reach the base.';
  if (session.mode === 'journey') return 'Stage ' + (c.index + 1) + ': ' + c.name + ' — reach the base.';
  if (session.mode === 'challenge') return c.description;
  return 'Reach the base.';
}

function pauseGame() {
  // pausing mid-countdown must also stop the countdown, or the run starts
  // unattended behind the pause screen
  if (session.phase === 'countdown') {
    clearCountdown();
    session.resumeWithCountdown = true;
  } else if (session.phase !== 'active') return;
  session.phase = 'paused';
  stopRotation();
  ui.pause();
}
function resumeGame() {
  if (session.phase !== 'paused') return;
  ui.close();
  if (session.resumeWithCountdown) {
    session.resumeWithCountdown = false;
    session.phase = 'countdown';
    runCountdown();
    return;
  }
  session.phase = 'active';
}
function leaveToTitle() {
  clearCountdown();
  stopRotation();
  platform.endActivity();
  session.phase = 'title';
  session.resumeWithCountdown = false;
  session.state = null;
  ui.showHud(false);
  showTitle();
}

function onTerminal() {
  if (session.phase === 'results') return; // guard against double entry
  const s = session.state;
  stopRotation();
  const total = R.totalScore(s);
  const won = s.terminal.reason === 'completed';
  bumpTel('roundEnds');
  progress.lifetimeLayers += s.stats.layersPassed;

  const newlyUnlocked = checkAchievements(s, won);

  // mode-specific progression
  let stars = null, nextLabel = null;
  if (session.mode === 'journey' && won) {
    const c = session.content;
    stars = 1 + (s.tick <= c.parTicks ? 1 : 0) + (s.stats.bestFall >= 3 ? 1 : 0);
    const prev = progress.stages[c.id];
    if (!prev || stars > prev.stars || total > prev.score) {
      progress.stages[c.id] = { stars: Math.max(stars, prev ? prev.stars : 0), score: Math.max(total, prev ? prev.score : 0) };
    }
    const ni = nextJourneyIndex();
    if (stages[ni] && ni > c.index) nextLabel = stages[ni].name;
  }
  if (session.mode === 'learn') {
    const l = session.opts.lesson;
    const met = l.goal.type === 'rotate' ? session.lessonGoalMet : won;
    if (met) {
      progress.lessons[l.id] = true;
      bumpTel('tutorialSteps');
    }
  }
  if (session.mode === 'daily' && won) {
    const today = daily.day;
    const y = new Date(platform.now().getTime() - 86400000);
    const yesterday = y.getUTCFullYear() + '-' + String(y.getUTCMonth() + 1).padStart(2, '0') + '-' + String(y.getUTCDate()).padStart(2, '0');
    if (progress.dailyStreak.last !== today) {
      progress.dailyStreak.count = progress.dailyStreak.last === yesterday ? progress.dailyStreak.count + 1 : 1;
      progress.dailyStreak.last = today;
    }
  }
  // best scores (local) + ranked submission
  const bestKey = session.content.id.startsWith('daily-') ? session.content.id : session.content.id.split('-').slice(0, 2).join('-');
  if (won && total > (progress.bestScores[bestKey] || 0)) progress.bestScores[bestKey] = total;
  saveProgress();

  const env = R.buildEnvelope(s, session.startedAt);
  env.playerName = platform.playerName || null; // server labels unnamed entries 'guest'
  session.replayEnv = env;
  let rankLine = null;
  if (session.opts.ranked && won) {
    if (platform.hosted) {
      rankLine = 'Submitting for validation…';
      platform.submitScore(env)
        .then((res) => ui.toast(res.validated ? 'Score validated and ranked.' : 'Score recorded (casual board).'))
        .catch((e) => ui.toast(e.rateLimited ? 'Rate limited — score kept locally.' : 'Submission failed — score kept locally.'));
    } else {
      rankLine = 'Offline — ranked submission needs the hosted version.';
    }
  }

  platform.endActivity();
  session.phase = 'results';
  const reasonText = {
    'completed': 'Base Reached!',
    'danger-sector': 'Shattered on a danger sector',
    'move-limit-exceeded': 'Out of rotation budget',
    'time-expired': 'Time expired',
    'abandoned': 'Run abandoned',
    'tick-limit': 'Run timed out'
  };
  ui.showHud(false);
  ui.results({
    reason: s.terminal.reason,
    headline: reasonText[s.terminal.reason] || 'Run over',
    subline: session.content.name || session.content.id,
    components: [
      ['Layers descended', s.score.layers],
      ['Combo bonuses', s.score.combo],
      ['Precision landings', s.score.precision],
      ['Smashes', s.score.smash],
      ['Completion', s.score.completion],
      ['Time bonus', s.score.timeBonus]
    ],
    total,
    stats: s.stats,
    totalLayers: s.config.layers.length,
    time: (s.tick / R.TICK_RATE).toFixed(1) + 's',
    stars,
    nextLabel,
    achievements: newlyUnlocked,
    rankLine
  });
  audio.event(won ? 'win' : 'danger');
}

function checkAchievements(s, won) {
  const newly = [];
  const unlock = (key) => {
    if (!progress.achievements[key]) {
      progress.achievements[key] = Date.now();
      const a = ACHIEVEMENTS.find(x => x.key === key);
      newly.push(a.name);
      audio.event('achievement');
      ui.toast('Achievement: ' + a.name + ' — ' + a.desc);
    }
  };
  if (won) unlock('first_clear');
  if (s.stats.bestFall >= 4) unlock('combo_master');
  if (progress.dailyStreak.count >= 3) unlock('streak_keeper');
  if (session.mode === 'journey' && won && session.content.index === 39) unlock('milestone_hard');
  if (progress.lifetimeLayers >= 1000) unlock('long_haul');
  return newly;
}

// ---------------- input ----------------
let rotating = 0;
function sendCmd(cmd) {
  if (!session.state || session.phase === 'replay') return;
  cmd.id = 'c' + (++session.cmdCounter);
  const res = R.applyCommand(session.state, cmd);
  if (!res.ok && !res.duplicate) {
    audio.event('invalid');
    ui.caption('Not available: ' + res.reason.replace(/-/g, ' '));
  }
}
function startRotate(dir) {
  if (session.phase !== 'active' || rotating === dir) return;
  rotating = dir;
  sendCmd({ type: 'rotateStart', dir });
  audio.event('rotateStart');
}
function stopRotation() {
  if (rotating !== 0) {
    rotating = 0;
    sendCmd({ type: 'rotateStop' });
  }
}

const KEYMAP = {
  ArrowLeft: -1, KeyA: -1,
  ArrowRight: 1, KeyD: 1
};
const held = new Set();
// Keys must not be stolen from focused controls: arrows drive sliders/selects and
// Space activates the focused button. Only claim them outside form/button focus.
function isFormTarget(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  audio.unlock();
  const formTarget = isFormTarget(e.target);
  if (e.code in KEYMAP) {
    if (formTarget) return;
    held.add(e.code);
    startRotate(KEYMAP[e.code]);
    e.preventDefault();
    return;
  }
  switch (e.code) {
    case 'Escape':
      if (session.phase === 'active' || session.phase === 'countdown') pauseGame();
      else if (session.phase === 'paused') resumeGame();
      else if (session.phase === 'replay') leaveToTitle();
      else if (session.phase === 'title' && ui.isScreenOpen) showTitle();
      break;
    case 'Space':
      // let a focused button or control consume its own activation key
      if (formTarget || (e.target && e.target.tagName === 'BUTTON')) return;
      if (session.phase === 'active' || session.phase === 'countdown') pauseGame();
      else if (session.phase === 'paused') resumeGame();
      e.preventDefault();
      break;
    case 'KeyU':
      if (formTarget) return;
      if (session.phase === 'active' && session.state.config.allowUndo) { sendCmd({ type: 'undo' }); }
      break;
    case 'KeyH':
      if (formTarget) return;
      if (session.phase === 'active' && (session.mode === 'practice' || session.mode === 'learn')) giveHint();
      break;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code in KEYMAP) {
    held.delete(e.code);
    // if the opposite direction key is still held, flip; else stop
    let dir = 0;
    for (const code of held) dir = KEYMAP[code];
    if (dir === 0) stopRotation();
    else startRotate(dir);
    e.preventDefault();
  }
});
// Losing focus swallows the keyup, which would otherwise leave the tower
// spinning forever once the window comes back.
window.addEventListener('blur', () => { held.clear(); stopRotation(); });

function giveHint() {
  const hint = R.hint(session.state);
  const msg = hint.action === 'wait' ? 'Gap aligned — hold still!' :
    hint.action === 'rotateLeft' ? 'Rotate left (' + Math.round(hint.degreesOff) + '° to go)' :
    hint.action === 'rotateRight' ? 'Rotate right (' + Math.round(hint.degreesOff) + '° to go)' : 'Keep going.';
  ui.toast(msg);
  ui.announce(msg);
}

// pointer: drag to rotate, pointer capture, safe cancel
const canvas = document.getElementById('gl');
let dragId = null, dragLastX = 0, dragDir = 0, dragIdleTimer = null;
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (session.phase !== 'active') return;
  dragId = e.pointerId;
  dragLastX = e.clientX;
  dragDir = 0;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (dragId !== e.pointerId) return;
  const dx = e.clientX - dragLastX;
  dragLastX = e.clientX;
  if (Math.abs(dx) >= 1) {
    const dir = dx > 0 ? 1 : -1;
    if (dir !== dragDir) { dragDir = dir; startRotate(dir); }
    clearTimeout(dragIdleTimer);
    dragIdleTimer = setTimeout(() => { dragDir = 0; stopRotation(); }, 130);
  }
});
function endDrag(e) {
  if (dragId !== e.pointerId) return;
  dragId = null;
  dragDir = 0;
  clearTimeout(dragIdleTimer);
  stopRotation();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);

// touch rotate buttons (hold or toggle per settings)
function bindRotButton(id, dir) {
  const el = document.getElementById(id);
  const down = (e) => {
    e.preventDefault();
    audio.unlock();
    if (!settings.holdToRotate) {
      // toggle mode
      if (rotating === dir) stopRotation(); else startRotate(dir);
      return;
    }
    startRotate(dir);
  };
  const up = () => { if (settings.holdToRotate) stopRotation(); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
  // the buttons are focusable, so they must also work from the keyboard
  el.addEventListener('keydown', (e) => {
    if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
    e.preventDefault();
    down(e);
  });
  el.addEventListener('keyup', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    up();
  });
  el.addEventListener('blur', up);
}
bindRotButton('btn-rot-left', -1);
bindRotButton('btn-rot-right', 1);

document.getElementById('btn-pause').addEventListener('click', () => {
  if (session.phase === 'paused') resumeGame(); else pauseGame();
});
document.getElementById('btn-undo').addEventListener('click', () => sendCmd({ type: 'undo' }));
document.getElementById('btn-hint').addEventListener('click', giveHint);

// gamepad: focus navigation + axes/buttons, edge-triggered
let padPrev = {};
function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = pads && pads[0];
  if (!gp) return;
  const axis = gp.axes[0] || 0;
  const left = axis < -0.4 || (gp.buttons[14] && gp.buttons[14].pressed);
  const right = axis > 0.4 || (gp.buttons[15] && gp.buttons[15].pressed);
  if (session.phase === 'active') {
    if (left && rotating !== -1) startRotate(-1);
    else if (right && rotating !== 1) startRotate(1);
    else if (!left && !right && rotating !== 0) stopRotation();
  }
  const edge = (i) => gp.buttons[i] && gp.buttons[i].pressed && !padPrev[i];
  if (edge(9)) { if (session.phase === 'active') pauseGame(); else if (session.phase === 'paused') resumeGame(); }
  if (edge(0) && ui.isScreenOpen) {
    const f = document.activeElement;
    if (f && f.click) f.click();
  }
  if (edge(1) && session.phase === 'active') pauseGame();
  padPrev = {};
  gp.buttons.forEach((b, i) => { padPrev[i] = b.pressed; });
}

// ---------------- ui actions ----------------
function showTitle() {
  const ni = nextJourneyIndex();
  const done = Object.keys(progress.stages).length;
  const dailyDone = progress.dailyStreak.last === daily.day;
  ui.title({
    nextLabel: done === 0 ? 'start the Journey' : 'Stage ' + (ni + 1) + ' — ' + stages[ni].name,
    dailyDone,
    summary: done + '/' + stages.length + ' journey stages · daily streak ' + progress.dailyStreak.count +
      ' · ' + Object.keys(progress.achievements).length + '/5 achievements' +
      (platform.authenticated
        ? ' · ' + (platform.playerName || 'Player') + ' · ' + platform.syncLabel
        : platform.hosted ? '' : ' · offline mode')
  });
}

const ui = createUI({
  onPlay: () => { ui.close(); ui.setup(modeSetupInfo('journey', nextJourneyIndex())); },
  onDaily: () => { ui.close(); ui.setup(modeSetupInfo('daily')); },
  onShowJourney: () => ui.journey(stages, progress, progress.bestScores),
  onShowPractice: () => ui.practice(C.PRACTICE),
  onShowChallenge: () => ui.challenge(C.CHALLENGES, progress.bestScores),
  onShowLearn: () => ui.learn(C.LESSONS, progress),
  onShowScores: showScores,
  onShowSettings: () => ui.settings(settings),
  onShowHelp: () => ui.help(BINDINGS),
  onHome: () => { session.phase === 'paused' ? ui.pause() : showTitle(); },
  journeyUnlocked,
  onStartStage: (i) => ui.setup(modeSetupInfo('journey', i)),
  onStartPractice: (id) => ui.setup(modeSetupInfo('practice', id)),
  onStartChallenge: (id) => ui.setup(modeSetupInfo('challenge', id)),
  onStartLesson: (i) => ui.setup(modeSetupInfo('learn', i)),
  onResume: resumeGame,
  onRestart: () => { bumpTel('retries'); ui.close(); startRun(session.content, session.mode, session.opts); },
  onRetry: () => { bumpTel('retries'); ui.close(); startRun(session.content, session.mode, session.opts); },
  onLeave: leaveToTitle,
  onWatchReplay: watchReplay,
  onReplayTutorial: () => { ui.close(); ui.setup(modeSetupInfo('learn', 0)); },
  onResetData: () => {
    if (confirm('Erase all local Spiral Drop progress and settings?')) {
      localStorage.removeItem('spiraldrop.settings.v1');
      localStorage.removeItem('spiraldrop.progress.v1');
      localStorage.removeItem('spiraldrop.telemetry.v1');
      location.reload();
    }
  },
  onSettingsChanged: (patch) => {
    Object.assign(settings, patch);
    saveSettings();
    bumpTel('settingsChanges');
    applySettings();
  }
});
ui.applyA11y(settings);

function applySettings() {
  ui.applyA11y(settings);
  renderer.setTier(settings.quality);
  renderer.setReducedMotion(settings.reducedMotion);
  renderer.setHighContrast(settings.highContrast);
  if (session.content) renderer.applyTheme(themeFor(session.content), settings.cvdPalette);
  audio.setVolume('music', settings.music);
  audio.setVolume('effects', settings.effects);
  audio.setVolume('ambience', settings.ambience);
  audio.setVolume('voice', settings.voice);
  audio.setMuted(settings.muted);
}

async function showScores() {
  const local = Object.entries(progress.bestScores)
    .map(([k, v]) => ({ name: k, score: v }))
    .sort((a, b) => b.score - a.score);
  let global = [], friends = [];
  if (platform.hosted) {
    try {
      const res = await platform.leaderboard(daily.id, false);
      global = res.entries || [];
      const fr = await platform.leaderboard(daily.id, true);
      friends = fr.entries || [];
    } catch { /* offline between init and now */ }
  }
  ui.scores({
    local, global, friends, hosted: platform.hosted,
    globalLabel: platform.authenticated
      ? 'Global (platform leaderboard — read-only).'
      : 'Global (validated replays).'
  });
}

// ---------------- replay viewing ----------------
function watchReplay() {
  if (!session.replayEnv) return;
  const env = session.replayEnv;
  ui.close();
  session.state = R.createGame(env.config);
  session.phase = 'replay';
  session.replayIndex = 0;
  session.acc = 0;
  session.prev = { angle: session.state.towerAngle, ballY: session.state.ball.y };
  ui.showHud(true);
  ui.toast('Replay — Esc to exit');
  ui.announce('Watching replay of the recorded run.');
}

// ---------------- fixed-timestep loop ----------------
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  pollGamepad();

  const s = session.state;
  if (!s) { return; }

  if (session.phase === 'active' || session.phase === 'replay') {
    session.prev.angle = s.towerAngle;
    session.prev.ballY = s.ball.y;
    session.acc += dt;
    let guard = 0;
    while (session.acc >= DT && guard++ < 8) {
      if (session.phase === 'replay') {
        const log = session.replayEnv.inputLog;
        while (session.replayIndex < log.length && log[session.replayIndex].tick <= s.tick) {
          R.applyCommand(s, log[session.replayIndex]);
          session.replayIndex++;
        }
      }
      R.step(s);
      session.acc -= DT;
      if (s.lastEvent) {
        renderer.handleEvent(s.lastEvent);
        mapEventToAudio(s.lastEvent);
      }
      if (s.phase === 'terminal') {
        if (session.phase === 'replay') {
          ui.toast('Replay finished.');
          leaveToTitle();
        } else {
          onTerminal();
        }
        break;
      }
    }
    // learn lesson 1 goal: rotate for N ticks total — mark immediately, play on
    if (session.mode === 'learn' && session.opts.lesson.goal.type === 'rotate' && !session.lessonGoalMet) {
      if (s.stats.rotationTicks >= session.opts.lesson.goal.ticks) {
        session.lessonGoalMet = true;
        progress.lessons[session.opts.lesson.id] = true;
        saveProgress();
        bumpTel('tutorialSteps');
        ui.toast('Good! Rotation mastered — now reach the base, or leave from pause.');
        ui.announce('Lesson goal complete.');
      }
    }
  }

  // interpolated render view (sim state + interpolation alpha)
  const alpha = session.phase === 'active' || session.phase === 'replay' ? session.acc / DT : 1;
  const view = {
    towerAngle: lerpAngle(session.prev.angle, s.towerAngle, alpha),
    ballY: session.prev.ballY + (s.ball.y - session.prev.ballY) * alpha,
    phase: s.phase,
    streak: s.streak,
    smashReady: s.streak >= ((s.config.mechanics && s.config.mechanics.smashStreak) || R.SMASH_STREAK),
    restRing: Math.min(s.ball.layer + 1, s.config.layers.length - 1),
    tick: s.tick
  };
  renderer.update(view, dt);
  renderer.adaptQuality(dt);
  updateHud(s);
}

function lerpAngle(a, b, t) {
  return a + R.angleDelta(a, b) * t;
}

function mapEventToAudio(ev) {
  if (ev.type === 'fallStart') audio.event('fallStart');
  else if (ev.type === 'passThrough') { audio.event('passThrough', ev); audio.setIntensity(Math.min(1, ev.streak / 4)); }
  else if (ev.type === 'land') { audio.event('land', ev); audio.setIntensity(0); }
  else if (ev.type === 'smash') audio.event('smash');
  else if (ev.type === 'invalid') audio.event('invalid');
  else if (ev.type === 'undo') audio.event('undo');
}

let hudTimer = 0;
function updateHud(s) {
  const now = performance.now();
  if (now - hudTimer < 150) return;
  hudTimer = now;
  let timer = null;
  if (s.config.timeLimitTicks) {
    const left = Math.max(0, s.config.timeLimitTicks - s.tick);
    timer = '⏱ ' + Math.ceil(left / R.TICK_RATE) + 's';
  } else if (s.config.moveLimitTicks) {
    const left = Math.max(0, s.config.moveLimitTicks - s.stats.rotationTicks);
    timer = '⟳ ' + (left / R.TICK_RATE).toFixed(1) + 's';
  }
  ui.hudView({
    objective: objectiveText(),
    score: R.totalScore(s),
    layer: Math.max(0, s.ball.layer + 1),
    totalLayers: s.config.layers.length,
    streak: s.streak,
    smashReady: s.streak >= ((s.config.mechanics && s.config.mechanics.smashStreak) || R.SMASH_STREAK),
    timer,
    canUndo: R.legalActions(s).includes('undo'),
    canHint: session.phase === 'active' && (session.mode === 'practice' || session.mode === 'learn')
  });
}

// ---------------- lifecycle ----------------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (session.phase === 'active' || session.phase === 'countdown') pauseGame();
    audio.suspend();
  } else {
    audio.resume();
    lastT = performance.now(); // avoid a giant dt
  }
});
window.addEventListener('error', () => bumpTel('errors'));
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
// One-input confidence: every button press (pointer or keyboard) acknowledges
// with the ui-tap sound. Rotate-hold buttons are excluded — startRotate already
// plays rotateStart, and undo/hint play their own event sounds.
document.getElementById('app').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && !b.disabled && b.id !== 'btn-rot-left' && b.id !== 'btn-rot-right') audio.event('uiTap');
});

// content validation in dev console (offline validators from the spec)
window.SpiralDrop = { R, C, session, validateAll: () => C.journeyStages().map(st => [st.id, C.validateContent(st)]) };

// ---------------- boot ----------------
(async function boot() {
  await platform.init();
  if (platform.timeSynced) daily = C.dailyFor(platform.now());
  // cloud save: the remote mirror wins on conflict; when the slot is empty
  // the local doc is uploaded so other devices converge on it
  if (platform.authenticated) {
    if (adoptCloudDoc(platform.cloudDoc)) {
      saveSettings();
      saveProgress();
    }
    if (!platform.cloudDoc) platform.cloudSave(collectCloudDoc());
  }
  applySettings();
  showTitle();
  renderer.applyTheme(C.themeById('ember'), settings.cvdPalette);
  renderer.setLayers(C.makeLayers('attract', { layers: 12, gapWidth: 1.4, dangerProb: 0.3, dangerArc: 0.9, dangerExtraProb: 0.1, driftProb: 0.2, driftSpeed: 0.003, comboEvery: 4 }));
  session.state = null;
  // attract-mode backdrop: idle rotating tower behind the title
  session.phase = 'title';
  requestAnimationFrame(frame);
  // idle animation while on menus: slowly spin a dummy state
  const attract = R.createGame(C.toConfig({ id: 'attract', version: 1, seed: 'attract', params: { layers: 12, gapWidth: 1.4, dangerProb: 0.3, dangerArc: 0.9, dangerExtraProb: 0.1, driftProb: 0.2, driftSpeed: 0.003, comboEvery: 4 } }, { mode: 'attract' }));
  setInterval(() => {
    if (session.state) return;
    if (document.hidden) return;
    attract.rotating = 1;
    R.step(attract);
    if (attract.phase === 'terminal') {
      const fresh = R.createGame(attract.config);
      Object.assign(attract, fresh);
    }
    renderer.update({
      towerAngle: attract.towerAngle, ballY: attract.ball.y, phase: attract.phase,
      streak: attract.streak, smashReady: false,
      restRing: Math.min(attract.ball.layer + 1, attract.config.layers.length - 1), tick: attract.tick
    }, 1 / 30);
  }, 33);

  // ---- headless self-test: drives the real session path (?selftest)
  if (location.search.includes('selftest')) {
    const out = [];
    const check = (name, v) => out.push(name + '=' + (v ? 'ok' : 'FAIL'));
    try {
      check('title', !!document.querySelector('.panel h1'));
      const content = { id: 'selftest', version: 1, seed: 'selftest', theme: 'tide', params: { layers: 6, gapWidth: 1.5, dangerProb: 0.2, dangerArc: 0.9, dangerExtraProb: 0, driftProb: 0.1, driftSpeed: 0.004, comboEvery: 3 }, mechanics: { smashStreak: 3 } };
      startRun(content, 'practice', { allowUndo: true });
      check('countdown', session.phase === 'countdown');
      clearCountdown();
      session.phase = 'active';
      const s = session.state;
      let guard = 0;
      while (s.phase !== 'terminal' && guard++ < R.MAX_TICKS) {
        if (s.phase !== 'falling') {
          const next = s.ball.layer + 1;
          if (next < s.config.layers.length) {
            const al = R.gapAlignment(s, next);
            const want = al.delta > 0 ? -1 : 1;
            if (!al.clear && s.rotating !== want) {
              if (s.rotating) sendCmd({ type: 'rotateStop' });
              sendCmd({ type: 'rotateStart', dir: want });
            } else if (al.clear && s.rotating) sendCmd({ type: 'rotateStop' });
          }
        }
        R.step(s);
        if (s.lastEvent) renderer.handleEvent(s.lastEvent);
      }
      check('terminal-' + (s.terminal && s.terminal.reason), s.phase === 'terminal' && s.terminal.reason === 'completed');
      renderer.update({
        towerAngle: s.towerAngle, ballY: s.ball.y, phase: s.phase, streak: 0, smashReady: false,
        restRing: Math.min(s.ball.layer + 1, s.config.layers.length - 1), tick: s.tick
      }, 1 / 60);
      check('drawcalls-' + renderer.drawCalls, renderer.drawCalls > 0 && renderer.drawCalls <= 150);
      check('triangles-' + renderer.triangles, renderer.triangles > 0 && renderer.triangles <= 350000);
      onTerminal();
      check('results', !!document.querySelector('.panel h2'));
      check('hud-hidden', document.getElementById('hud').hidden);
    } catch (e) {
      out.push('error=' + (e && e.message));
    }
    const pass = out.every(x => x.endsWith('=ok') || !x.endsWith('=FAIL'));
    const summary = (pass ? 'SELFTEST-PASS' : 'SELFTEST-FAIL') + ' ' + out.join(' ');
    document.title = summary;
    const div = document.createElement('div');
    div.id = 'selftest-result';
    div.textContent = summary;
    document.body.append(div);
  }
})();
