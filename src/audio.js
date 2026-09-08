/*
 * Spiral Drop — audio: WebAudio procedural synth plus authored one-shot
 * samples (sfx/*.opus) that are lazy-fetched after the user-gesture unlock;
 * synthesis remains the fallback while a clip loads or fails.
 * Buses: music / effects / ambience / voice, independent gains.
 * Short transients are tied to logical game events; variants are seeded so
 * replays sound identical. Captions are emitted through onCaption for the UI.
 */
export function createAudio(opts) {
  const settings = Object.assign({
    music: 0.6, effects: 0.8, ambience: 0.5, voice: 0.8, muted: false
  }, opts || {});

  let ctx = null;
  let buses = null;
  let master = null;
  let started = false;
  let musicTimer = null;
  let ambienceNodes = null;
  let intensity = 0; // 0..1 adaptive music intensity (driven by combo/streak)
  let captionCb = null;
  let variantSeed = 1;
  let suppressSynth = false; // true while an authored sample covers an event

  // ---- authored one-shot samples (sfx/*.opus), lazy-fetched after unlock.
  // Each event prefers its mapped clip; procedural synthesis runs only while
  // the clip is still loading or failed to load (see sfx/manifest.json).
  const SFX = {
    uiTap: 'ui-tap',
    rotateStart: 'rotate-start',
    fallStart: 'fall-start',
    passThrough: 'pass-through',
    land: 'land',
    smash: 'smash',
    danger: 'danger-hit',
    invalid: 'invalid',
    undo: 'undo',
    win: 'stage-win',
    countdown: 'countdown',
    achievement: 'achievement'
  };
  const sampleCache = new Map(); // clip -> 'loading' | AudioBuffer | null (failed)

  function loadSample(clip) {
    if (!ctx || sampleCache.has(clip)) return;
    sampleCache.set(clip, 'loading');
    fetch('sfx/' + clip + '.opus')
      .then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); })
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => sampleCache.set(clip, buf))
      .catch(() => sampleCache.set(clip, null));
  }

  // returns true when a decoded clip was played through the effects bus
  function playSample(clip) {
    const cached = sampleCache.get(clip);
    if (!cached || cached === 'loading') return false;
    const src = ctx.createBufferSource();
    src.buffer = cached;
    src.connect(buses.effects);
    src.start();
    return true;
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    buses = {};
    for (const name of ['music', 'effects', 'ambience', 'voice']) {
      const g = ctx.createGain();
      g.gain.value = settings.muted ? 0 : settings[name];
      g.connect(master);
      buses[name] = g;
    }
    return ctx;
  }

  function applyVolumes() {
    if (!buses) return;
    for (const name of Object.keys(buses)) {
      buses[name].gain.value = settings.muted ? 0 : settings[name];
    }
  }

  // seeded pitch variant (±6%) so replays sound the same
  function variant() {
    variantSeed = (variantSeed * 1103515245 + 12345) & 0x7fffffff;
    return 1 + ((variantSeed % 1000) / 1000 - 0.5) * 0.12;
  }

  function caption(text) { if (captionCb) captionCb(text); }

  function blip(bus, freq, dur, type, gain, when, slide) {
    if (suppressSynth || !ensureCtx()) return;
    const t = (when || ctx.currentTime);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(buses[bus]);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noiseBurst(bus, dur, gain, filterFreq, when) {
    if (suppressSynth || !ensureCtx()) return;
    const t = when || ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    const g = ctx.createGain();
    g.gain.value = gain || 0.3;
    src.connect(f); f.connect(g); g.connect(buses[bus]);
    src.start(t);
  }

  // ---- public event mapping (called from session events)
  const events = {
    uiTap() { blip('effects', 660 * variant(), 0.06, 'triangle', 0.12); },
    rotateStart() { blip('effects', 340 * variant(), 0.05, 'sine', 0.06); },
    fallStart() { noiseBurst('effects', 0.25, 0.12, 2400); caption('Drop'); },
    passThrough(e) {
      const k = Math.min(6, (e && e.streak) || 1);
      blip('effects', 520 + k * 90, 0.09, 'triangle', 0.16);
      caption('Layer passed ×' + k);
    },
    land(e) {
      noiseBurst('effects', 0.09, 0.22, 700);
      blip('effects', 180 * variant(), 0.12, 'sine', 0.2);
      if (e && e.falls > 1) { blip('effects', 700 + e.falls * 60, 0.15, 'triangle', 0.14, ctx ? ctx.currentTime + 0.05 : undefined); caption('Combo ×' + e.falls); }
      if (e && e.precision) { blip('effects', 990, 0.14, 'sine', 0.12, ctx ? ctx.currentTime + 0.1 : undefined); caption('Precision landing'); }
    },
    smash() {
      noiseBurst('effects', 0.3, 0.4, 3200);
      blip('effects', 90, 0.25, 'sawtooth', 0.25, undefined, -40);
      caption('Danger sector smashed');
    },
    danger() {
      blip('effects', 140, 0.5, 'sawtooth', 0.3, undefined, -80);
      noiseBurst('effects', 0.4, 0.3, 500);
      caption('Danger sector — run over');
    },
    invalid() { blip('effects', 160, 0.09, 'square', 0.08); caption('Action not available'); },
    undo() { blip('effects', 440, 0.08, 'sine', 0.1, undefined, -180); caption('Undone'); },
    win() {
      if (!ensureCtx()) return;
      const t0 = ctx.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => blip('effects', f, 0.35, 'triangle', 0.18, t0 + i * 0.11));
      caption('Stage complete');
    },
    countdown() { blip('effects', 880, 0.08, 'sine', 0.12); },
    achievement() {
      if (!ensureCtx()) return;
      const t0 = ctx.currentTime;
      [784, 988].forEach((f, i) => blip('effects', f, 0.25, 'sine', 0.14, t0 + i * 0.09));
      caption('Achievement unlocked');
    }
  };

  // ---- adaptive music: quiet pad loop; intensity raises brightness/tempo feel
  const CHORDS = [
    [220.0, 277.18, 329.63], [196.0, 246.94, 293.66],
    [174.61, 220.0, 261.63], [196.0, 233.08, 311.13]
  ];
  let chordIdx = 0;
  function musicBar() {
    musicTimer = null;
    // Muted or suspended is a pause, not the end of the loop: keep the timer
    // alive (silently) so unmuting / returning to the tab restores the music.
    if (!ctx || settings.muted || ctx.state !== 'running') {
      musicTimer = setTimeout(musicBar, 1000);
      return;
    }
    const chord = CHORDS[chordIdx % CHORDS.length];
    chordIdx++;
    const t = ctx.currentTime;
    const barLen = intensity > 0.6 ? 1.6 : 2.4;
    for (const f of chord) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f * (intensity > 0.3 ? 2 : 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05 + intensity * 0.04, t + barLen * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + barLen);
      o.connect(g); g.connect(buses.music);
      o.start(t); o.stop(t + barLen + 0.1);
    }
    if (intensity > 0.5) {
      const f = chord[0] * 4;
      blip('music', f, 0.12, 'triangle', 0.05, t + barLen * 0.5);
    }
    musicTimer = setTimeout(musicBar, barLen * 1000);
  }

  function startAmbience() {
    if (!ensureCtx() || ambienceNodes) return;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 240; f.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(f); f.connect(g); g.connect(buses.ambience);
    src.start();
    ambienceNodes = { src, g };
  }

  return {
    // must be called from a user gesture at least once
    unlock() {
      if (!ensureCtx()) return false;
      if (ctx.state === 'suspended') ctx.resume();
      if (!started) {
        started = true;
        startAmbience();
        musicBar();
      }
      return true;
    },
    event(name, data) {
      if (!events[name] || !started || !ctx || ctx.state !== 'running') return;
      const clip = SFX[name];
      if (clip) {
        if (!sampleCache.has(clip)) loadSample(clip);
        if (playSample(clip)) {
          // sample covers the sound; run the handler for captions only
          suppressSynth = true;
          try { events[name](data); } finally { suppressSynth = false; }
          return;
        }
      }
      events[name](data);
    },
    setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); },
    setVolume(bus, v) { settings[bus] = v; applyVolumes(); },
    setMuted(m) { settings.muted = m; applyVolumes(); },
    getSettings() { return Object.assign({}, settings); },
    onCaption(cb) { captionCb = cb; },
    seedVariants(seed) { variantSeed = (seed >>> 0) || 1; },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  };
}
