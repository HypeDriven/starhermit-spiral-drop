// The glossy kinetic tower above an endless gradient on starhermit:scene, as
// the browser build's src/render.js drew it with three.js r160: the authored
// perspective camera on a critically damped follow spring (snapped with
// reduced motion, pulled back on narrow windows so the active ring fits), one
// dominant key light following the camera down the tower, the hemisphere
// fill and the ball's point light, the gradient sky dome with its drifting
// bands and twinkling stars (animated tiers), the fog, the fluted pillar, the
// base, the ball (bouncing at rest, stretched while falling, glowing and
// pulsing as the smash charges), the grounded marker under it, the pooled
// ring views (ExtrudeGeometry annulus sectors, safe and striped danger arcs,
// bevelled on the detailed tiers, the rest ring's glowing rim), the pooled
// landing dust and smash shards, the ball's trail and the drifting motes.
// Graphics follow the runtime's quality tier (native/quality.ts: gfx.js's
// presets and budgets); the colour-vision palette is the game's option, high
// contrast and reduced motion the runtime's. Rendering reads the rules state
// it is given (with the fixed step's interpolation) and never changes it.
//
// From three.js r160 (physically based lights): colours as written, the
// punctual and hemisphere lights' intensities ÷ π (the engine takes three's
// legacy units). render.js built `new RoomEnvironment(renderer)` (kept
// exactly, engine spec "Porting environments"); r160 scaled scene.environment
// by each material's envMapIntensity, so every lit material carries it as its
// own envMap at its old intensity. The sky's GLSL ShaderMaterial is WGSL
// (toneMapped false: it skips tone mapping without post effects and is
// pre-darkened by half under them, as render.js did). The danger stripes'
// canvas was read as linear values by r160 (no colorSpace): the engine reads
// colour maps as sRGB, so the stripe canvas is painted with those values
// sRGB-encoded. The old composer (RenderPass in half floats → GTAO →
// UnrealBloom 0.42 / 0.35 / 0.9 → the grade + vignette → OutputPass with ACES
// at exposure 1.05, 0.95 for Paper Dawn → SMAA / FXAA) is the runtime's
// renderer.ao / bloom / grade / antialias.
import {
  ACESFilmicToneMapping, AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry,
  DirectionalLight, DoubleSide, ExtrudeGeometry, Fog, Group, HemisphereLight, Line, LineBasicMaterial, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NormalBlending, PMREMGenerator, PerspectiveCamera, PointLight,
  Points, PointsMaterial, RepeatWrapping, RingGeometry, RoomEnvironment, SRGBColorSpace, ShaderMaterial, Shape, SphereGeometry, Vector3,
  renderer, scene, type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import type { Layer, SimEvent, Theme } from "./game.ts";
import type { Look } from "./quality.ts";

/** render.js CAM / TOWER: framing constants (authored, not magic offsets). */
export const CAM = { fov: 42, dist: 7.4, height: 3.1, lookBelow: 0.9, springK: 42, springDamp: 13 };
export const TOWER = {
  ringInner: 0.85, ringOuter: 2.05, ringThick: 0.16, pillarRadius: 0.55, ballRadius: 0.17, ballOrbit: 1.45,
  ringSpacing: 1.0, visibleAbove: 4, visibleBelow: 14,
};
export interface View { towerAngle: number; ballY: number; phase: string; streak: number; smashReady: boolean; restRing: number; tick: number }
const PI = Math.PI;

// ---------------------------------------------------------------- procedural textures (render.js, unchanged drawing)
type Ctx = OffscreenCanvasRenderingContext2D;
function canvas(w: number, h: number): { c: OffscreenCanvas; g: Ctx } {
  const c = new OffscreenCanvas(w, h);
  return { c, g: c.getContext("2d")! as Ctx };
}
function grainTexture(n: number): CanvasTexture {
  const { c, g } = canvas(n, n);
  const img = g.createImageData(n, n);
  let seed = 1337;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n * n; i++) {
    const v = 232 + Math.floor(rnd() * 23);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // faint concentric brushed streaks
  g.globalAlpha = 0.08; g.strokeStyle = "#000";
  for (let y = 0; y < n; y += (3 * n) / 128) { g.beginPath(); g.moveTo(0, y + rnd()); g.lineTo(n, y + rnd()); g.stroke(); }
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
function fluteTexture(w: number): CanvasTexture {
  const { c, g } = canvas(w, 8);
  const grd = g.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 16; i++) grd.addColorStop(Math.min(1, i / 16), i % 2 ? "#cfcfd8" : "#ffffff");
  g.fillStyle = grd; g.fillRect(0, 0, w, 8);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(1, 40);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
function dotTexture(): CanvasTexture {
  const { c, g } = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.4, "rgba(255,255,255,0.75)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
/** A byte as r160 read it (linear) written for an sRGB-read map. */
function enc(byte: number): number {
  const l = Math.max(0, Math.min(1, byte / 255));
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}
function rgbOf(hex: string): [number, number, number] {
  const c = new Color(hex);
  const h = c.getHex();
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}
function stripeTexture(base: string, stripeDark: boolean): CanvasTexture {
  const { c, g } = canvas(64, 64);
  const [r, gr, b] = rgbOf(base);
  // render.js stroked rgba(0,0,0,0.35) (or opaque black in high contrast) over the base
  const k = stripeDark ? 0 : 0.65;
  g.fillStyle = `rgb(${enc(r)},${enc(gr)},${enc(b)})`; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = `rgb(${enc(r * k)},${enc(gr * k)},${enc(b * k)})`; g.lineWidth = 7;
  for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 70); g.lineTo(i + 70, -6); g.stroke(); }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(6, 1);
  return tex;
}

/** annulus sector → flat extruded ring segment (render.js ringSectorGeometry: the bevel keeps the footprint). */
function ringSectorGeometry(rIn: number, rOut: number, thick: number, start: number, width: number, bevel: boolean, curve = 24, bevelSegs = 2): ExtrudeGeometry {
  const b = bevel ? Math.min(0.035, thick * 0.25) : 0;
  const full = width >= PI * 2 - 1e-6;
  const da = full ? 0 : b / ((rIn + rOut) / 2);
  const shape = new Shape();
  shape.absarc(0, 0, rOut - b, start + da, start + width - da, false);
  shape.absarc(0, 0, rIn + b, start + width - da, start + da, true);
  const geo = new ExtrudeGeometry(shape, b
    ? { depth: thick - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: bevelSegs, curveSegments: curve }
    : { depth: thick, bevelEnabled: false, curveSegments: curve });
  if (b) geo.translate(0, 0, b);
  geo.rotateX(PI / 2); // lay flat, top at y=0
  return geo;
}

// ---------------------------------------------------------------- the scene
const camera = new PerspectiveCamera(CAM.fov, 1, 0.1, 120);
const KEY_OFFSET = new Vector3(3.2, 7, 4.2);
const key = new DirectionalLight(0xfff1dc, 2.4 / PI);
key.position.copy(KEY_OFFSET);
key.shadow.bias = -0.0006;
key.shadow.normalBias = 1; // three's 0.02 world units; the engine's normal bias is in texels
scene.add(key.target);
const fill = new HemisphereLight(0xbfd4ff, 0x30231f, 0.85 / PI);
const ballLight = new PointLight(0xffffff, 0.9 / PI, 6);
scene.add(key, fill, ballLight);

let envTex: Texture | null = null;
function environment(): Texture | null {
  if (!envTex) {
    try {
      const pmrem = new PMREMGenerator(renderer);
      const room = new RoomEnvironment(renderer);
      envTex = pmrem.fromScene(room, 0.04).texture;
    } catch (e) { console.warn(`environment: ${String(e)}`); }
  }
  return envTex;
}

// the gradient sky dome ("endless gradient"): slow luminous bands and faint stars when animated
const SKY_FRAGMENT = `
fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn fragment(f: Fragment) -> vec4f {
  let d = normalize(f.world);
  let h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  var c = mix(uniforms.bottom, uniforms.top, pow(h, 0.8));
  if (uniforms.uAnim > 0.0) {
    let az = atan2(d.z, d.x);
    var band = sin(d.y * 9.0 + sin(az * 2.0 + uniforms.uTime * 0.07) * 1.6 - uniforms.uTime * 0.11);
    band = smoothstep(0.55, 1.0, band) * (1.0 - abs(d.y)) * 0.16;
    c = c + uniforms.accent * band * uniforms.uAnim;
    let g = vec2f(az * 40.0, d.y * 40.0);
    let cell = floor(g);
    let r = hash2(cell);
    // smoothstep(0.35, 0.05, x) reversed: 1 - smoothstep(0.05, 0.35, x)
    var star = step(0.985, r) * (1.0 - smoothstep(0.05, 0.35, length(fract(g) - vec2f(0.5))));
    star = star * smoothstep(0.55, 0.85, h) * (0.55 + 0.45 * sin(uniforms.uTime * (1.0 + r * 3.0) + r * 60.0));
    c = c + vec3f(star) * 0.5 * uniforms.uAnim;
  }
  return vec4f(c * uniforms.uGain, 1.0);
}`;
const skyUniforms = {
  top: { value: new Color("#0b1030") }, bottom: { value: new Color("#ff7e5f") }, accent: { value: new Color("#ffd66e") },
  uTime: { value: 0 }, uAnim: { value: 0 }, uGain: { value: 1 },
};
const skyMat = new ShaderMaterial({ uniforms: skyUniforms, fragmentShader: SKY_FRAGMENT, side: BackSide, depthWrite: false, fog: false, toneMapped: false });
const sky = new Mesh(new SphereGeometry(90, 24, 16), skyMat);
sky.frustumCulled = false;
sky.noAO = true;
scene.add(sky);
scene.fog = new Fog(0x3a1c5f, 18, 70);

// pillar, base, ball, marker
type Lit = MeshLambertMaterial | MeshStandardMaterial | MeshPhysicalMaterial;
let look: Look | null = null;
let matKind: Look["budget"]["material"] | "" = "";
interface LitParams { color: string | number; roughness?: number; metalness?: number; emissive?: string | number; emissiveIntensity?: number; map?: Texture | null }
/** render.js litMaterial: Lambert on Low, Standard on Balanced, Physical (clearcoat) on High/Ultra. */
function litMaterial(kind: string, p: LitParams): Lit {
  const base: Record<string, unknown> = { color: p.color };
  if (p.emissive !== undefined) { base.emissive = p.emissive; base.emissiveIntensity = p.emissiveIntensity ?? 1; }
  if (p.map) base.map = p.map;
  if (kind === "lambert") return new MeshLambertMaterial(base);
  const std = { ...base, roughness: p.roughness ?? 1, metalness: p.metalness ?? 0 };
  return kind === "standard" ? new MeshStandardMaterial(std) : new MeshPhysicalMaterial(std);
}
const PILLAR = { color: 0x4a2a6a, roughness: 0.55, metalness: 0.15 };
const BASE = { color: 0x8be09a, roughness: 0.4, emissive: 0x2a7a3a, emissiveIntensity: 0.5 };
const BALL = { color: 0xfff3d6, roughness: 0.25, metalness: 0.1, emissive: 0x000000 };
let pillarMat: Lit = litMaterial("lambert", PILLAR);
let baseMat: Lit = litMaterial("lambert", BASE);
let ballMat: Lit = litMaterial("lambert", BALL);
const pillar = new Mesh(new CylinderGeometry(TOWER.pillarRadius, TOWER.pillarRadius, 200, 16), pillarMat);
pillar.position.y = -100;
pillar.receiveShadow = true;
const base = new Mesh(new CylinderGeometry(TOWER.ringOuter + 0.5, TOWER.ringOuter + 0.7, 0.3, 22), baseMat);
base.receiveShadow = true;
const ball = new Mesh(new SphereGeometry(TOWER.ballRadius, 16, 11), ballMat);
ball.castShadow = true;
scene.add(pillar, base, ball);
const markerMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: DoubleSide });
const marker = new Mesh(new RingGeometry(0.24, 0.3, 32), markerMat);
marker.rotation.x = -PI / 2;
marker.noAO = true;
scene.add(marker);

let grainTex: CanvasTexture | null = null, fluteTex: CanvasTexture | null = null, texSize = 0;
const dotTex = dotTexture();
let roundSegs = 0;

// ring views
const ringGroup = new Group();
scene.add(ringGroup);
interface RingView { group: Group; index: number; meshes: Mesh[] }
const ringPool: RingView[] = [];
const ringByIndex = new Map<number, RingView>();
let safeMat: Lit | null = null, dangerMat: Lit | null = null, ghostMat: MeshBasicMaterial | null = null;
let stripeTex: CanvasTexture | null = null;

function makeRingView(): RingView {
  const g = new Group();
  ringGroup.add(g);
  return { group: g, index: -1, meshes: [] };
}
function clearRingView(v: RingView): void {
  for (const m of v.meshes) { v.group.remove(m); m.geometry.dispose(); }
  v.meshes = [];
}
/** render.js buildRingView: safe arcs and danger arcs around the gap, the rest ring's rim. */
function buildRingView(v: RingView, layer: Layer, isRestRing: boolean): void {
  clearRingView(v);
  if (!look || !safeMat || !dangerMat || !ghostMat) return;
  const gapStart = layer.gapCenter - layer.gapWidth / 2;
  const gapEnd = layer.gapCenter + layer.gapWidth / 2;
  const segs: { start: number; width: number; danger: boolean }[] = [];
  const events = layer.danger.slice().sort((a, b) => a[0] - b[0]).map((d) => [d[0], d[1]] as [number, number]);
  let cursor = gapEnd;
  let guard = 0;
  while (cursor < gapStart + PI * 2 - 0.0001 && guard++ < 32) {
    const relStart = cursor;
    let segEnd = gapStart + PI * 2;
    let isDanger = false;
    for (const [ds, dw] of events) {
      const de = ds + dw;
      if (ds <= relStart && relStart < de) { isDanger = true; cursor = de; segEnd = Math.min(de, segEnd); break; }
      if (ds > relStart && ds < segEnd) segEnd = ds;
    }
    if (segEnd - relStart > 0.02) segs.push({ start: relStart, width: segEnd - relStart, danger: isDanger });
    if (!isDanger) cursor = segEnd;
    if (cursor >= gapStart + PI * 2 - 0.0001) break;
  }
  const b = look.budget;
  for (const s of segs) {
    const geo = ringSectorGeometry(TOWER.ringInner, TOWER.ringOuter, TOWER.ringThick, s.start, s.width, look.detailed, b.curve, b.bevel);
    const mesh = new Mesh(geo, s.danger ? dangerMat : safeMat);
    mesh.castShadow = look.shadows > 0;
    mesh.receiveShadow = true;
    v.group.add(mesh);
    v.meshes.push(mesh);
  }
  if (isRestRing) {
    const rim = new Mesh(ringSectorGeometry(TOWER.ringInner - 0.06, TOWER.ringInner, TOWER.ringThick + 0.06, 0, PI * 2, false, b.curve * 2), ghostMat);
    rim.noAO = true;
    v.group.add(rim);
    v.meshes.push(rim);
  }
}

// pooled particles (two event tiers)
interface Pool { points: Points; pos: Float32Array; vel: Float32Array; life: Float32Array; cap: number; head: number }
function makePool(cap: number, size: number, color: number, additive: boolean): Pool {
  const geo = new BufferGeometry();
  const pos = new Float32Array(cap * 3);
  for (let i = 0; i < cap; i++) pos[i * 3 + 1] = 1e6; // parked far offscreen
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  const soft = !!look?.detailed;
  const mat = new PointsMaterial({
    size: soft ? size * 1.8 : size, color, transparent: true, opacity: 0.9, depthWrite: false,
    map: soft ? dotTex : null, blending: soft && additive ? AdditiveBlending : NormalBlending,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return { points, pos, vel: new Float32Array(cap * 3), life: new Float32Array(cap), cap, head: 0 };
}
let puffPool: Pool | null = null, shardPool: Pool | null = null;
function dropPool(p: Pool | null): void { if (!p) return; scene.remove(p.points); p.points.geometry.dispose(); p.points.material.dispose(); }
function spawn(pool: Pool | null, x: number, y: number, z: number, count: number, spread: number, up: number): void {
  if (!pool) return;
  const n = Math.min(count, pool.cap);
  for (let i = 0; i < n; i++) {
    const k = pool.head = (pool.head + 1) % pool.cap;
    pool.pos[k * 3] = x; pool.pos[k * 3 + 1] = y; pool.pos[k * 3 + 2] = z;
    const a = Math.random() * PI * 2;
    const r = Math.random() * spread;
    pool.vel[k * 3] = Math.cos(a) * r;
    pool.vel[k * 3 + 1] = up * (0.5 + Math.random());
    pool.vel[k * 3 + 2] = Math.sin(a) * r;
    pool.life[k] = 0.5 + Math.random() * 0.4;
  }
}
function stepParticles(pool: Pool | null, dt: number): void {
  if (!pool) return;
  let any = false;
  for (let k = 0; k < pool.cap; k++) {
    if (pool.life[k]! > 0) {
      any = true;
      pool.life[k] = pool.life[k]! - dt;
      pool.pos[k * 3] = pool.pos[k * 3]! + pool.vel[k * 3]! * dt;
      pool.pos[k * 3 + 1] = pool.pos[k * 3 + 1]! + pool.vel[k * 3 + 1]! * dt;
      pool.pos[k * 3 + 2] = pool.pos[k * 3 + 2]! + pool.vel[k * 3 + 2]! * dt;
      pool.vel[k * 3 + 1] = pool.vel[k * 3 + 1]! - 2.2 * dt;
      if (pool.life[k]! <= 0) pool.pos[k * 3 + 1] = 1e6;
    }
  }
  if (any) (pool.points.geometry.attributes.position as BufferAttribute).needsUpdate = true;
}
/** Clears the dust and shards (a new run starts clean). */
export function clearParticles(): void {
  for (const p of [puffPool, shardPool]) {
    if (!p) continue;
    p.life.fill(0);
    for (let i = 0; i < p.cap; i++) p.pos[i * 3 + 1] = 1e6;
    (p.points.geometry.attributes.position as BufferAttribute).needsUpdate = true;
  }
  trailCount = 0;
}

// the ball's trail (cosmetic)
const TRAIL_N = 22;
const trailGeo = new BufferGeometry();
const trailPos = new Float32Array(TRAIL_N * 3);
trailGeo.setAttribute("position", new BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trailMat = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
const trail = new Line(trailGeo, trailMat);
trail.frustumCulled = false;
scene.add(trail);
let trailHead = 0, trailCount = 0;

// ambient motes (Particles high)
let motes: { points: Points; pos: Float32Array; seed: Float32Array; n: number } | null = null;
function makeMotes(): void {
  if (motes) { scene.remove(motes.points); motes.points.geometry.dispose(); motes.points.material.dispose(); motes = null; }
  const n = look ? look.budget.motes : 0;
  if (!n) return;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * PI * 2, r = 3 + Math.random() * 6;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = camY + (Math.random() - 0.5) * 16; pos[i * 3 + 2] = Math.sin(a) * r - 2;
    seed[i] = Math.random() * 100;
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(pos, 3));
  const mat = new PointsMaterial({ size: 0.09, map: dotTex, color: 0xfff4dd, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending, fog: false });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  motes = { points, pos, seed, n };
}
function stepMotes(dt: number, cy: number): void {
  if (!motes) return;
  const { pos, seed, n } = motes;
  const lo = cy - 12, hi = cy + 4;
  const drift = reducedMotion ? 0 : dt;
  for (let i = 0; i < n; i++) {
    let y = pos[i * 3 + 1]! + drift * (0.18 + (seed[i]! % 1) * 0.2);
    pos[i * 3] = pos[i * 3]! + drift * Math.sin(animTime * 0.5 + seed[i]!) * 0.06;
    if (y > hi) y = lo + (y - hi);
    else if (y < lo) y = hi - (lo - y);
    pos[i * 3 + 1] = y;
  }
  (motes.points.geometry.attributes.position as BufferAttribute).needsUpdate = true;
}

// camera spring, theme, layers
let camY = 3, camVY = 0, shake = 0, bounceT = 0, animTime = 0, clock = 0;
let theme: Theme | null = null;
let cvdPatch: Partial<Theme> = {};
let cvd = false;
let highContrast = false;
let reducedMotion = false;
let layerData: Layer[] = [];
let layerCount = 0;
let lastRestRing = -99;

function envFor(intensity: number, m: Lit | null): void {
  if (!m || m instanceof MeshLambertMaterial) return;
  const on = !!look?.reflections;
  m.envMap = on ? environment() : null;
  m.envMapIntensity = on ? intensity : 1;
}
function setProps(m: Lit | null, o: Record<string, unknown>): void {
  if (!m) return;
  const t = m as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) if (k in m) t[k] = v;
}
/** render.js applyMaterialDetail: clearcoat, grain and fluting on 'detailed'; the environment's strength on 'reflections'. */
function applyMaterialDetail(): void {
  if (!look) return;
  const det = look.detailed;
  setProps(safeMat, { clearcoat: det ? 0.5 : 0, clearcoatRoughness: 0.28, roughness: det ? 0.34 : 0.35, map: det ? grainTex : null });
  setProps(dangerMat, { clearcoat: det ? 0.4 : 0, clearcoatRoughness: 0.35 });
  setProps(ballMat, { clearcoat: det ? 1 : 0, clearcoatRoughness: 0.08, roughness: det ? 0.2 : 0.25 });
  setProps(pillarMat, { map: det ? fluteTex : null, clearcoat: det ? 0.3 : 0, clearcoatRoughness: 0.4 });
  setProps(baseMat, { clearcoat: det ? 0.5 : 0, clearcoatRoughness: 0.25 });
  envFor(0.22, safeMat); envFor(0.18, dangerMat); envFor(0.6, ballMat); envFor(0.25, pillarMat); envFor(0.25, baseMat);
  // reflections replace part of the hemisphere fill so overall exposure holds
  fill.intensity = (look.reflections ? 0.62 : 0.85) / PI;
}

/** render.js applyTheme: the theme's colours (with the colour-vision patch and high contrast). */
export function applyTheme(t: Theme): void {
  theme = t;
  const pick = (k: keyof Theme): string => ((cvd && cvdPatch[k]) || t[k]) as string;
  // render.js linearized the sky colours once more (a deep, saturated gradient)
  skyUniforms.top.value.set(t.skyTop).convertSRGBToLinear();
  skyUniforms.bottom.value.set(t.skyBottom).convertSRGBToLinear();
  skyUniforms.accent.value.set(pick("accent")).convertSRGBToLinear();
  (scene.fog as Fog).color.set(t.fog);
  pillarMat.color.set(t.pillar);
  baseMat.color.set(pick("base"));
  ballMat.color.set(pick("ball"));
  ballLight.color.set(pick("accent"));
  const safeColor = highContrast ? "#ffffff" : pick("safe");
  const dangerColor = highContrast ? "#ff2020" : pick("danger");
  if (safeMat) { safeMat.dispose(); dangerMat?.dispose(); stripeTex?.dispose(); ghostMat?.dispose(); }
  const kind = matKind || "lambert";
  safeMat = litMaterial(kind, { color: safeColor, roughness: 0.35, metalness: 0.2, emissive: t.safeEmissive || "#000000", emissiveIntensity: 1 });
  stripeTex = stripeTexture(dangerColor, highContrast);
  dangerMat = litMaterial(kind, { color: dangerColor, roughness: 0.5, metalness: 0.05, map: stripeTex });
  ghostMat = new MeshBasicMaterial({ color: pick("accent"), transparent: true, opacity: 0.8 });
  ghostMat.color.multiplyScalar(1.5); // HDR rim: the only ring element bright enough to bloom
  applyMaterialDetail();
  markerMat.color.set(pick("accent"));
  trailMat.color.set(pick("accent"));
  renderer.toneMappingExposure = t.id === "dawn" ? 0.95 : 1.05;
  for (const v of ringByIndex.values()) v.index = -2;
  lastRestRing = -99;
}
export function setPalette(on: boolean, patch: Partial<Theme>): void {
  cvdPatch = patch;
  if (on === cvd) return;
  cvd = on;
  if (theme) applyTheme(theme);
}
export function setHighContrast(on: boolean): void {
  if (on === highContrast) return;
  highContrast = on;
  if (theme) applyTheme(theme);
}
export function setReducedMotion(on: boolean): void { reducedMotion = on; }

export function setLayers(layers: Layer[]): void {
  layerData = layers;
  layerCount = layers.length;
  base.position.y = -layerCount - 0.15;
  for (const v of ringByIndex.values()) v.index = -2;
}

/** render.js syncRings: the visible ring window around the ball. */
function syncRings(ballSimY: number, restRing: number, towerAngle: number, tick: number): void {
  const lo = Math.max(0, Math.floor(ballSimY) - TOWER.visibleAbove);
  const hi = Math.min(layerCount - 1, Math.floor(ballSimY) + TOWER.visibleBelow);
  for (const [idx, v] of ringByIndex) {
    if (idx < lo || idx > hi) { clearRingView(v); v.index = -1; ringByIndex.delete(idx); ringPool.push(v); }
  }
  for (let i = lo; i <= hi; i++) {
    let v = ringByIndex.get(i);
    const layer = layerData[i]!;
    const worldOff = towerAngle + layer.offset + layer.drift * tick;
    if (!v) {
      v = ringPool.pop() || makeRingView();
      v.index = -2;
      ringByIndex.set(i, v);
    }
    if (v.index !== i || (lastRestRing !== restRing && (i === restRing || i === lastRestRing))) {
      buildRingView(v, layer, i === restRing);
      v.index = i;
    }
    v.group.position.y = -i;
    v.group.rotation.y = -worldOff;
  }
  lastRestRing = restRing;
}

/** render.js handleEvent: dust, shards and the shake per rules event. */
export function handleEvent(ev: SimEvent | null): void {
  if (!ev || !look) return;
  const bx = 0, bz = TOWER.ballOrbit, by = ball.position.y;
  const few = look.particles === "low";
  if (ev.type === "land") {
    spawn(puffPool, bx, by, bz, few ? 8 : 22, 1.6, 1.2);
    if (!reducedMotion && (ev.falls ?? 0) > 1) shake = Math.min(0.5, 0.12 * (ev.falls ?? 0));
  } else if (ev.type === "smash") {
    spawn(shardPool, bx, by, bz, few ? 16 : 60, 3.2, 2.2);
    if (!reducedMotion) shake = 0.45;
  } else if (ev.type === "terminal") {
    if (ev.reason === "danger-sector") { spawn(shardPool, bx, by, bz, 80, 3.5, 2.5); if (!reducedMotion) shake = 0.6; }
    if (ev.reason === "completed") spawn(puffPool, bx, by, bz, 90, 2.5, 3.0);
  } else if (ev.type === "passThrough" && (ev.streak ?? 0) >= 2) {
    spawn(puffPool, bx, by, bz, 6, 1.2, 0.6);
  }
}

// -------------------------------------------------------------- quality
/** The runtime's quality tier applied live (render.js setGraphics). */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const prev = look;
  look = next;
  const b = next.budget;
  renderer.toneMapping = ACESFilmicToneMapping;
  // UnrealBloomPass(0.42, 0.35, 0.9): only the charged ball, the rest-ring rim and sparks bloom
  renderer.bloom = next.bloom ? { strength: 0.42, radius: 0.35, threshold: 0.9, resolution: b.bloomRes } : null;
  // GTAO radius 0.45, distance exponent 1.5, thickness 1, 16 / 8 samples and the denoise per tier; blend 0.7
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.7, radius: 0.45, distanceExponent: 1.5, thickness: 1.0, scale: 1, samples: next.ao === "high" ? 16 : 8, resolution: b.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // GradeShader on the linear buffer: saturation 1.12, cool shadows / warm highlights by a smoothstep of
  // luma from 0.05 to 0.6, a 0.28 vignette from 0.3 to 0.85 (its y squeezed by 0.85)
  renderer.grade = next.grade ? {
    space: "linear", saturation: 1.12, split: [0.05, 0.6], shadows: [0.95, 0.98, 1.06], highlights: [1.05, 1.0, 0.95],
    vignette: { amount: 0.28, inner: 0.3, outer: 0.85, scale: [1, 0.85] },
  } : null;
  renderer.antialias = next.antialias;
  renderer.shadowMap.enabled = next.shadows > 0;
  key.castShadow = next.shadows > 0;
  if (next.shadows > 0) key.shadow.mapSize = next.shadows;
  // textures and tessellation (rebuildTextures / rebuildRoundGeometry / rebuildLitMaterials)
  if (b.texture !== texSize) {
    texSize = b.texture;
    grainTex?.dispose(); fluteTex?.dispose();
    grainTex = grainTexture(b.texture);
    fluteTex = fluteTexture(b.texture * 2);
  }
  if (b.round !== roundSegs) {
    roundSegs = b.round;
    const swap = (mesh: Mesh, geo: BufferGeometry): void => { mesh.geometry.dispose(); mesh.geometry = geo; };
    swap(pillar, new CylinderGeometry(TOWER.pillarRadius, TOWER.pillarRadius, 200, b.round));
    swap(base, new CylinderGeometry(TOWER.ringOuter + 0.5, TOWER.ringOuter + 0.7, 0.3, Math.round(b.round * 1.4)));
    swap(ball, new SphereGeometry(TOWER.ballRadius, b.round, Math.round(b.round * 0.7)));
  }
  if (b.material !== matKind) {
    matKind = b.material;
    const old: Material[] = [pillarMat, baseMat, ballMat];
    pillarMat = litMaterial(matKind, PILLAR); pillar.material = pillarMat;
    baseMat = litMaterial(matKind, BASE); base.material = baseMat;
    ballMat = litMaterial(matKind, BALL); ball.material = ballMat;
    for (const m of old) m.dispose();
    if (theme) applyTheme(theme);
  }
  applyMaterialDetail();
  if (!prev || prev.detailed !== next.detailed || prev.shadows !== next.shadows || prev.budget.curve !== b.curve || prev.budget.bevel !== b.bevel) {
    for (const v of ringByIndex.values()) v.index = -2;
    lastRestRing = -99;
  }
  if (!prev || prev.particles !== next.particles || prev.detailed !== next.detailed || prev.budget.puffs !== b.puffs || prev.budget.motes !== b.motes) {
    dropPool(puffPool); dropPool(shardPool);
    puffPool = makePool(b.puffs, 0.07, 0xffffff, true);
    shardPool = makePool(Math.floor(b.puffs / 2), 0.1, 0xff5030, false);
    makeMotes();
  }
}

// -------------------------------------------------------------- framing
let aspect = 1;
let camDist = CAM.dist;
/** render.js fitDistance: the authored distance, pulled back on narrow windows so the active ring fits. */
function fitDistance(a: number): number {
  const halfW = TOWER.ringOuter + 0.35;
  const hTan = Math.tan(((CAM.fov / 2) * PI) / 180) * a;
  return Math.max(CAM.dist, halfW / hTan + TOWER.ringOuter * 0.35);
}
/** Whether the tower draws (hidden only while nothing should, e.g. before the first frame). */
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }

// -------------------------------------------------------------- each frame
const trailOrdered = new Float32Array(TRAIL_N * 3);
/** render.js update(view, dt). */
export function update(view: View, dt: number, w: number, h: number): void {
  dt = Math.min(0.1, dt);
  clock += dt;
  if (w > 0 && h > 0 && w / h !== aspect) {
    aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    camDist = fitDistance(aspect);
  }
  if (!theme || !look) return;
  const worldBallY = -view.ballY;
  const targetY = worldBallY + CAM.height;
  if (reducedMotion) { camY = targetY; camVY = 0; }
  else {
    const a = CAM.springK * (targetY - camY) - CAM.springDamp * camVY;
    camVY += a * dt;
    camY += camVY * dt;
  }
  shake = Math.max(0, shake - dt * 1.8);
  const sh = reducedMotion ? 0 : shake * 0.12;
  const ms = clock * 1000;
  camera.position.set(Math.sin(ms * 0.03) * sh, camY + Math.cos(ms * 0.041) * sh, camDist);
  camera.lookAt(0, camY - CAM.height - CAM.lookBelow, 0);
  const focusY = camY - CAM.height - 1.2;
  key.target.position.set(0, focusY, 0);
  key.position.set(KEY_OFFSET.x, focusY + KEY_OFFSET.y, KEY_OFFSET.z);
  key.shadow.distance = camDist + 12;

  if (!reducedMotion) animTime += dt;
  skyUniforms.uTime.value = animTime;
  skyUniforms.uAnim.value = look.animatedSky ? 1 : 0;
  // the sky skips tone mapping on the direct path; the post effects tone-map everything, so pre-darken it there
  skyUniforms.uGain.value = look.post ? 0.5 : 1;
  stepMotes(dt, camY);

  let visY = worldBallY;
  let squashY = 1, squashXZ = 1;
  if (view.phase === "rest" || view.phase === "resolving") {
    bounceT += dt;
    const hop = Math.abs(Math.sin(bounceT * 5.2));
    if (!reducedMotion) visY += hop * 0.14;
    squashY = 1 - (1 - hop) * 0.18; squashXZ = 1 + (1 - hop) * 0.12;
  } else if (view.phase === "falling") {
    squashY = 1.18; squashXZ = 0.9;
  }
  ball.position.set(0, visY + TOWER.ballRadius + TOWER.ringThick, TOWER.ballOrbit);
  ball.scale.set(squashXZ, squashY, squashXZ);
  const charge = view.smashReady ? 1 : Math.min(1, view.streak / 3);
  ballMat.emissive.set(((cvd && cvdPatch.accent) || theme.accent) as string);
  ballMat.emissiveIntensity = charge * (view.smashReady && !reducedMotion ? 0.9 + Math.sin(ms * 0.012) * 0.35 : 0.45);
  ballLight.position.copy(ball.position);
  ballLight.intensity = (0.6 + charge * 1.2) / PI;

  marker.position.set(0, -view.restRing + 0.011, TOWER.ballOrbit);
  marker.visible = view.phase !== "terminal";
  if (!reducedMotion) {
    const s = 1 + Math.sin(ms * 0.006) * 0.08;
    marker.scale.set(s, s, 1);
  }

  syncRings(view.ballY, view.restRing, view.towerAngle, view.tick);

  if (view.phase === "falling" && !reducedMotion) {
    trailPos[trailHead * 3] = ball.position.x;
    trailPos[trailHead * 3 + 1] = ball.position.y;
    trailPos[trailHead * 3 + 2] = ball.position.z;
    trailHead = (trailHead + 1) % TRAIL_N;
    trailCount = Math.min(TRAIL_N, trailCount + 1);
  } else if (trailCount > 0) trailCount--;
  for (let i = 0; i < trailCount; i++) {
    const k = (trailHead - trailCount + i + TRAIL_N * 2) % TRAIL_N;
    trailOrdered[i * 3] = trailPos[k * 3]!; trailOrdered[i * 3 + 1] = trailPos[k * 3 + 1]!; trailOrdered[i * 3 + 2] = trailPos[k * 3 + 2]!;
  }
  const tp = trailGeo.attributes.position as BufferAttribute;
  (tp.array as Float32Array).set(trailOrdered);
  tp.needsUpdate = true;
  trailGeo.setDrawRange(0, trailCount);
  trail.visible = trailCount > 1;

  stepParticles(puffPool, dt);
  stepParticles(shardPool, dt);
}
