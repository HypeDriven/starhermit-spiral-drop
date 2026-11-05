// Sound, as the browser build's src/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, the adaptive music
// pad and the quiet ambience. audio.js synthesized the music bar by bar (four
// chords of three sines, 2.4 s bars; an octave up above intensity 0.3; 1.6 s
// bars and a high triangle blip above 0.6 / 0.5) and looped low-passed noise
// on its ambience bus; here each intensity band renders once into a loop clip
// (OfflineAudioContext, in onStart) and the bands cross-fade as the drop streak
// changes the intensity. The ambience noise (low-passed at 240 Hz, gain 0.05)
// is a 4 s seamless loop on the music bus — the runtime has no ambience bus —
// at the old ambience-to-music ratio (0.5 / 0.6). The synthesized transients
// audio.js played while a clip was still decoding are not ported: a clip still
// loading is silent (so are its seeded pitch variants, which only the synth
// used). The runtime's Options own the volumes and the mute. Everything loads
// in onStart; only starting the loops waits for the mixer (in a browser, the
// first press).
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

/** audio.js SFX. */
const SFX = {
  uiTap: "ui-tap", rotateStart: "rotate-start", fallStart: "fall-start", passThrough: "pass-through", land: "land", smash: "smash",
  danger: "danger-hit", invalid: "invalid", undo: "undo", win: "stage-win", countdown: "countdown", achievement: "achievement",
} as const;
export type Sfx = keyof typeof SFX;
const clips = new Map<string, AudioClip>();
let suspended = false;

export function play(ev: Sfx): void {
  if (suspended) return;
  const name = SFX[ev];
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { /* the mixer is full this frame: skip it */ }
}

// -- the music bands and the ambience ------------------------------------------------------------
const RATE = 22050;
const CHORDS = [[220.0, 277.18, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [196.0, 233.08, 311.13]];
interface Band { bar: number; octave: number; gain: number; blip: boolean; clip: AudioClip | null; voice: Sound | null }
const band = (bar: number, octave: number, intensity: number, blip: boolean): Band => ({
  bar, octave, gain: 0.05 + intensity * 0.04, blip, clip: null, voice: null,
});
/** Intensity 0 (calm), 0.5 (octave up), 1 (fast bars and the blip): audio.js's thresholds 0.3, 0.5, 0.6. */
const BANDS: Band[] = [band(2.4, 1, 0, false), band(2.4, 2, 0.5, false), band(1.6, 2, 1, true)];
/** One band: four bars, a linear ramp up to 30 % of each and down to its end, and the optional mid-bar blip. */
async function renderBand(b: Band): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round(b.bar * 4 * RATE), RATE);
  CHORDS.forEach((chord, k) => {
    const t0 = k * b.bar;
    const g = off.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(b.gain, t0 + b.bar * 0.3);
    g.gain.linearRampToValueAtTime(0, t0 + b.bar);
    g.connect(off.destination);
    for (const f of chord) {
      const osc = off.createOscillator(); osc.frequency.value = f * b.octave;
      osc.connect(g); osc.start(0); osc.stop(t0 + b.bar); // from 0: the old phases, sharp bars aside
    }
    if (b.blip) {
      // triangle at the chord root × 4, 12 ms attack, exponential decay (blip gain 0.05)
      const bt = t0 + b.bar * 0.5;
      const osc = off.createOscillator(); osc.type = "triangle"; osc.frequency.value = chord[0]! * 4;
      const e = off.createGain();
      e.gain.setValueAtTime(0, bt);
      e.gain.linearRampToValueAtTime(0.05, bt + 0.012);
      e.gain.setTargetAtTime(0, bt + 0.012, 1 / 60);
      osc.connect(e).connect(off.destination);
      osc.start(bt); osc.stop(bt + 0.12);
    }
  });
  return createClip(await off.startRendering());
}
const AMB_MAKEUP = 1.486; // make-up to the old bed's rms (.0084)
/** The ambience: white noise low-passed at 240 Hz. Filtered periodic noise is periodic once settled: no crossfade. */
async function renderAmbience(): Promise<AudioClip> {
  const settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + RATE * 4, RATE);
  const noise = off.createNoise({ seed: 0x2f6b, seconds: 4 });
  const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 240;
  const g = off.createGain(); g.gain.value = 0.05 * AMB_MAKEUP;
  noise.connect(lp).connect(g).connect(off.destination); noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}
const AMB_GAIN = 0.5 / 0.6;
let ambClip: AudioClip | null = null;
let ambVoice: Sound | null = null;
let musicWanted = false;
let intensity = 0;
let current = -1;
/** audio.js unlock: the music loop and the ambience start (the old build began them on the first press). */
export function startMusic(): void { musicWanted = true; }
/** audio.js setIntensity: 0 … 1, driven by the drop streak. */
export function setIntensity(v: number): void { intensity = Math.max(0, Math.min(1, v)); }
const bandFor = (v: number): number => (v > 0.6 ? 2 : v > 0.3 ? 1 : 0);
/** A hidden window and the pause panel silence the pads (audio.js suspend). */
export function setSuspended(on: boolean): void {
  if (on === suspended) return;
  suspended = on;
  current = -1; // fade back in on the next update
  try { ambVoice?.fade(on ? 0 : AMB_GAIN, 0.2); } catch { /* gone */ }
  for (const b of BANDS) try { if (on) b.voice?.fade(0, 0.2); } catch { /* gone */ }
}

/** Loads every clip at once and renders the loops (onStart). */
export function loadSfx(): void {
  for (const name of new Set(Object.values(SFX))) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => { console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`); });
  }
  const warn = (e: unknown): void => { console.warn(`audio: ${String(e)}`); };
  renderAmbience().then((c) => { ambClip = c; }, warn);
  for (const b of BANDS) renderBand(b).then((c) => { b.clip = c; }, warn);
}

/** Each frame, once the mixer runs and the music is wanted: the ambience and the music bands, one start a frame. */
export function update(): void {
  if (context.state !== "running" || !musicWanted || !ambClip) return;
  if (!ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: suspended ? 0 : AMB_GAIN, loop: true }); } catch { ambVoice = null; }
    return;
  }
  for (const b of BANDS) {
    if (b.voice || !b.clip) continue;
    try { b.voice = playClip(b.clip, { bus: "music", gain: 0, loop: true }); } catch { b.voice = null; }
    return;
  }
  const want = suspended ? -1 : bandFor(intensity);
  if (want === current) return;
  current = want;
  BANDS.forEach((b, i) => { try { b.voice?.fade(i === want ? 1 : 0, 0.4); } catch { /* gone */ } });
}
