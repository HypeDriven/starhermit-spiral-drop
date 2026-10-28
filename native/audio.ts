// Sound, as the browser build's src/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, the adaptive music
// pad and the quiet ambience. audio.js synthesized the music bar by bar (four
// chords of three sines, 2.4 s bars; an octave up above intensity 0.3; 1.6 s
// bars and a high triangle blip above 0.6 / 0.5) and looped low-passed noise
// on its ambience bus; here each intensity band is rendered once into a loop
// clip (a slice a frame, from a sine table: per-sample Math.sin is slow in the
// native interpreter) and the bands cross-fade as the drop streak changes the
// intensity. The ambience noise (low-passed at 240 Hz, gain 0.05) is a 4 s
// seamless loop on the music bus — the runtime has no ambience bus — at the
// old ambience-to-music ratio (0.5 / 0.6). The synthesized transients
// audio.js played while a clip was still decoding are not ported (a live
// synthesis graph makes clip loads fail on the web runtime): a clip still
// loading is silent (so are its seeded pitch variants, which only the synth
// used). The runtime's Options own the volumes and the mute.
// Clips load once the mixer runs (natively at once, in a browser after the
// first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";

/** audio.js SFX. */
const SFX = {
  uiTap: "ui-tap", rotateStart: "rotate-start", fallStart: "fall-start", passThrough: "pass-through", land: "land", smash: "smash",
  danger: "danger-hit", invalid: "invalid", undo: "undo", win: "stage-win", countdown: "countdown", achievement: "achievement",
} as const;
export type Sfx = keyof typeof SFX;
const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;

export function loadSfx(): void { wantClips = true; }
export function play(ev: Sfx): void {
  if (suspended) return;
  const name = SFX[ev];
  const clip = clips.get(name);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); } catch { clips.delete(name); if (!queue.includes(name)) queue.push(name); }
}

// -- the music bands and the ambience ------------------------------------------------------------
const RATE = 22050;
const TABLE_N = 4096;
const SINE = new Float32Array(TABLE_N);
for (let i = 0; i < TABLE_N; i++) SINE[i] = Math.sin((2 * Math.PI * i) / TABLE_N);
const CHORDS = [[220.0, 277.18, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [196.0, 233.08, 311.13]];
interface Band { bar: number; octave: number; gain: number; blip: boolean; data: Float32Array; pos: number; clip: AudioClip | null; voice: Sound | null }
const band = (bar: number, octave: number, intensity: number, blip: boolean): Band => ({
  bar, octave, gain: 0.05 + intensity * 0.04, blip, data: new Float32Array(Math.round(bar * 4 * RATE)), pos: 0, clip: null, voice: null,
});
/** Intensity 0 (calm), 0.5 (octave up), 1 (fast bars and the blip): audio.js's thresholds 0.3, 0.5, 0.6. */
const BANDS: Band[] = [band(2.4, 1, 0, false), band(2.4, 2, 0.5, false), band(1.6, 2, 1, true)];
function renderBand(b: Band, count: number): boolean {
  const n = b.data.length, barN = Math.round(b.bar * RATE);
  const end = Math.min(n, b.pos + count);
  for (let i = b.pos; i < end; i++) {
    const k = Math.floor(i / barN), t = (i - k * barN) / RATE;
    const chord = CHORDS[k % 4]!;
    // linear ramp up to 30 % of the bar, then down to its end
    const up = b.bar * 0.3;
    const env = t < up ? t / up : Math.max(0, 1 - (t - up) / (b.bar - up));
    let v = 0;
    for (const f of chord) {
      const ph = ((f * b.octave * i) / RATE) % 1;
      v += SINE[Math.floor(ph * TABLE_N)]!;
    }
    v *= env * b.gain;
    if (b.blip) {
      const bt = t - b.bar * 0.5;
      if (bt >= 0 && bt < 0.12) {
        // triangle at the chord root × 4, 12 ms attack, exponential decay (blip gain 0.05)
        const ph = ((chord[0]! * 4 * bt) % 1);
        const tri = 1 - 4 * Math.abs(ph - 0.5);
        const e = bt < 0.012 ? bt / 0.012 : Math.exp(-(bt - 0.012) * 60);
        v += tri * e * 0.05;
      }
    }
    b.data[i] = v;
  }
  b.pos = end;
  return end >= n;
}
const AMB_N = RATE * 4;
const amb = new Float32Array(AMB_N);
let ambPos = 0, ambA = 0, ambB = 0, ambSeed = 0x2f6b;
function renderAmbience(count: number): boolean {
  const end = Math.min(AMB_N, ambPos + count);
  const a = 1 - Math.exp((-2 * Math.PI * 240) / RATE);
  for (; ambPos < end; ambPos++) {
    ambSeed = (ambSeed * 1664525 + 1013904223) >>> 0;
    const w = (ambSeed / 4294967296) * 2 - 1;
    ambA += a * (w - ambA);
    ambB += a * (ambA - ambB);
    amb[ambPos] = ambB * 0.05 * 2.2; // two poles lose ~half the noise's level; the old biquad kept it
  }
  if (ambPos < AMB_N) return false;
  // seamless loop: cross-fade the last 0.25 s into the start
  const x = Math.round(RATE * 0.25);
  for (let i = 0; i < x; i++) {
    const k = i / x;
    amb[i] = amb[i]! * k + amb[AMB_N - x + i]! * (1 - k);
  }
  return true;
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

/** Each frame: the clips once the mixer runs (one at a time), then the ambience and the music bands. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const n of Object.values(SFX)) if (!queue.includes(n)) queue.push(n);
  }
  if (!loading && queue.length) {
    const name = queue.shift()!;
    if (!clips.has(name)) {
      loading = true;
      loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => {
        console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
        loading = false;
      });
    }
    return;
  }
  if (loading || !musicWanted) return;
  if (!ambClip) {
    if (!renderAmbience(12000)) return;
    try { ambClip = createClip([amb], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); ambPos = 0; }
    return;
  }
  if (!ambVoice) {
    try { ambVoice = playClip(ambClip, { bus: "music", gain: suspended ? 0 : AMB_GAIN, loop: true }); } catch { ambVoice = null; }
    return;
  }
  for (const b of BANDS) {
    if (b.clip) continue;
    if (!renderBand(b, 8000)) return;
    try { b.clip = createClip([b.data], RATE); } catch (e) { console.warn(`audio: ${String(e)}`); b.pos = 0; }
    return; // one band a frame (looping starts in separate frames)
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
