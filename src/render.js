/*
 * Spiral Drop — render module (Three.js).
 * Semantic entity views (rings, ball, pillar, base), pooled particles,
 * authored camera with critically damped spring, quality tiers, and explicit
 * disposal. Rendering consumes immutable snapshots + interpolation alpha;
 * it never mutates rules state.
 */
import * as THREE from '../lib/three.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { detectPreset, describe, resolve, SHADOW_MAP } from './gfx.js';

// ---- Framing constants (authored, not magic offsets)
export const CAM = {
  fov: 42,
  dist: 7.4,          // camera distance from tower axis
  height: 3.1,        // camera height above ball
  lookBelow: 0.9,     // look-at point below camera height
  springK: 42,        // critically damped follow spring
  springDamp: 13
};
export const TOWER = {
  ringInner: 0.85,
  ringOuter: 2.05,
  ringThick: 0.16,
  pillarRadius: 0.55,
  ballRadius: 0.17,
  ballOrbit: 1.45,
  ringSpacing: 1.0,   // one sim unit
  visibleAbove: 4,    // rings rendered above the ball
  visibleBelow: 14    // ring window below the ball
};

const MAX_PARTICLES = { low: 300, high: 2000 };
const MOTES = { low: 0, high: 160 };

// Colour grade + vignette (linear HDR in, before OutputPass tone mapping).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.28 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // a touch more saturation, cool shadows / warm highlights, gentle contrast
      vec3 s = mix(vec3(l), c, 1.12);
      s *= mix(vec3(0.95, 0.98, 1.06), vec3(1.05, 1.0, 0.95), smoothstep(0.05, 0.6, l));
      s = pow(max(s, 0.0), vec3(1.06)) * 1.04;
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.0, 0.85));
      c *= 1.0 - uVignette * smoothstep(0.3, 0.85, d);
      gl_FragColor = vec4(c, src.a);
    }`
};

// Subtle procedural grain for flat ring tops (luminance noise around white).
function makeGrainTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 232 + Math.floor(rnd() * 23);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // faint concentric brushed streaks
  g.globalAlpha = 0.08; g.strokeStyle = '#000';
  for (let y = 0; y < 128; y += 3) { g.beginPath(); g.moveTo(0, y + rnd()); g.lineTo(128, y + rnd()); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Vertical fluting for the central pillar.
function makeFluteTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 8;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 256, 0);
  for (let i = 0; i <= 16; i++) {
    grd.addColorStop(Math.min(1, i / 16), i % 2 ? '#cfcfd8' : '#ffffff');
  }
  g.fillStyle = grd; g.fillRect(0, 0, 256, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 40);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft round sprite for particles (replaces square points on detailed).
function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeStripeTexture(base, stripe) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = stripe; g.lineWidth = 7;
  for (let i = -64; i < 128; i += 16) {
    g.beginPath(); g.moveTo(i, 70); g.lineTo(i + 70, -6); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  return tex;
}

// annulus sector shape → flat extruded ring segment
// `bevel` rounds the edges; the outline is inset by the bevel size so the
// bevelled mesh keeps the same footprint as the logical sector.
function ringSectorGeometry(rIn, rOut, thick, start, width, bevel) {
  const b = bevel ? Math.min(0.035, thick * 0.25) : 0;
  const full = width >= Math.PI * 2 - 1e-6;
  const da = full ? 0 : b / ((rIn + rOut) / 2);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOut - b, start + da, start + width - da, false);
  shape.absarc(0, 0, rIn + b, start + width - da, start + da, true);
  const geo = new THREE.ExtrudeGeometry(shape, b
    ? { depth: thick - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 28 }
    : { depth: thick, bevelEnabled: false, curveSegments: 24 });
  if (b) geo.translate(0, 0, b);
  geo.rotateX(Math.PI / 2); // lay flat, top at y=0
  return geo;
}

export function createRenderer(canvas, hooks) {
  hooks = hooks || {};
  let renderer;
  try {
    // preserveDrawingBuffer only for headless visual validation captures (?canvasdump)
    const preserve = typeof location !== 'undefined' && location.search.includes('canvasdump');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: preserve });
  } catch (e) {
    if (hooks.onContextLost) hooks.onContextLost('unavailable');
    throw e;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.1, 120);

  // ---- quality state (see gfx.js)
  const gpu = gpuName(renderer);
  const mobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const detected = detectPreset(gpu, mobile);
  let q = resolve({}, detected);
  let gfxJson = null;
  let adaptiveScale = 1;
  let frameTimes = [];
  let fpsAvg = 60;
  let pixelRatio = 1;
  let size = [1, 1];
  let composer = null, postKey = null, postFailed = false;
  let reducedMotion = false;
  let highContrast = false;
  let animTime = 0;

  // ---- lights: one dominant key, soft environment fill, contact grounding.
  // The key follows the camera down the tower so its tight shadow frustum
  // always covers the rings on screen.
  const KEY_OFFSET = new THREE.Vector3(3.2, 7, 4.2);
  const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
  key.position.copy(KEY_OFFSET);
  key.castShadow = false;
  key.shadow.camera.near = 1; key.shadow.camera.far = 30;
  key.shadow.camera.left = -3.4; key.shadow.camera.right = 3.4;
  key.shadow.camera.top = 5.5; key.shadow.camera.bottom = -5.5;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
  scene.add(key.target);
  const fill = new THREE.HemisphereLight(0xbfd4ff, 0x30231f, 0.85);
  const ballLight = new THREE.PointLight(0xffffff, 0.9, 6);
  scene.add(key, fill, ballLight);

  // ---- image-based lighting (reflections): prefiltered RoomEnvironment
  let envTex = null;
  function buildEnv() {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment(renderer);
      if (envTex) envTex.dispose();
      envTex = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
    } catch (e) { envTex = null; }
  }
  buildEnv();

  // ---- gradient sky dome + fog ("endless gradient")
  // Background: vertical gradient; when animated, slow luminous bands drift
  // across it and faint stars twinkle near the top (never near the tower's
  // silhouette brightness, so pieces keep their contrast).
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color('#0b1030') }, bottom: { value: new THREE.Color('#ff7e5f') },
      accent: { value: new THREE.Color('#ffd66e') },
      uTime: { value: 0 }, uAnim: { value: 0 }, uGain: { value: 1 }
    },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; uniform vec3 accent; uniform float uTime; uniform float uAnim; uniform float uGain;
      varying vec3 vP;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vP);
        float h = clamp(d.y*0.5+0.5, 0.0, 1.0);
        vec3 c = mix(bottom, top, pow(h, 0.8));
        if (uAnim > 0.0) {
          float az = atan(d.z, d.x);
          float band = sin(d.y * 9.0 + sin(az * 2.0 + uTime * 0.07) * 1.6 - uTime * 0.11);
          band = smoothstep(0.55, 1.0, band) * (1.0 - abs(d.y)) * 0.16;
          c += accent * band * uAnim;
          vec2 g = vec2(az * 40.0, d.y * 40.0);
          vec2 cell = floor(g);
          float r = hash(cell);
          float star = step(0.985, r) * smoothstep(0.35, 0.05, length(fract(g) - 0.5));
          star *= smoothstep(0.55, 0.85, h) * (0.55 + 0.45 * sin(uTime * (1.0 + r * 3.0) + r * 60.0));
          c += vec3(star) * 0.5 * uAnim;
        }
        gl_FragColor = vec4(c * uGain, 1.0);
        #include <colorspace_fragment>
      }`
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 24, 16), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(0x3a1c5f, 18, 70);

  // ---- pillar, base
  const grainTex = makeGrainTexture();
  const fluteTex = makeFluteTexture();
  const dotTex = makeDotTexture();
  const pillarMat = new THREE.MeshPhysicalMaterial({ color: 0x4a2a6a, roughness: 0.55, metalness: 0.15 });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(TOWER.pillarRadius, TOWER.pillarRadius, 200, 28), pillarMat);
  pillar.position.y = -100;
  pillar.receiveShadow = true;
  scene.add(pillar);

  const baseMat = new THREE.MeshPhysicalMaterial({ color: 0x8be09a, roughness: 0.4, emissive: 0x2a7a3a, emissiveIntensity: 0.5 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(TOWER.ringOuter + 0.5, TOWER.ringOuter + 0.7, 0.3, 40), baseMat);
  base.receiveShadow = true;
  scene.add(base);

  // ---- ball (state signaled by emissive + scale pulse, not color alone)
  const ballMat = new THREE.MeshPhysicalMaterial({ color: 0xfff3d6, roughness: 0.25, metalness: 0.1, emissive: 0x000000 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(TOWER.ballRadius, 28, 20), ballMat);
  ball.castShadow = true;
  scene.add(ball);

  // grounded selection marker under the ball (shape-coded ring, always visible)
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.3, 32), markerMat);
  marker.rotation.x = -Math.PI / 2;
  scene.add(marker);

  // ---- ring view pool
  const ringGroup = new THREE.Group(); // rotates with towerAngle
  scene.add(ringGroup);
  const ringPool = [];
  const ringByIndex = new Map(); // ringIndex -> view
  let safeMat, dangerMat, ghostMat;

  function makeRingView() {
    const g = new THREE.Group();
    ringGroup.add(g);
    return { group: g, index: -1, meshes: [] };
  }
  function clearRingView(v) {
    for (const m of v.meshes) {
      v.group.remove(m);
      m.geometry.dispose();
    }
    v.meshes = [];
  }
  // Build segment list: safe arcs and danger arcs around the gap.
  function buildRingView(v, layer, isRestRing, isNextRing) {
    clearRingView(v);
    const gapStart = layer.gapCenter - layer.gapWidth / 2;
    const gapEnd = layer.gapCenter + layer.gapWidth / 2;
    // collect danger arcs (clamped, non-overlapping by construction)
    const segs = []; // {start, width, danger}
    const danger = layer.danger.slice().sort((a, b) => a[0] - b[0]);
    // walk the circle outside the gap; split by danger arcs
    let cursor = gapEnd;
    const total = Math.PI * 2 - layer.gapWidth;
    const events = danger.map(d => [d[0], d[1]]);
    let guard = 0;
    while (cursor < gapStart + Math.PI * 2 - 0.0001 && guard++ < 32) {
      const relStart = cursor;
      let segEnd = gapStart + Math.PI * 2;
      let isDanger = false;
      for (const [ds, dw] of events) {
        const de = ds + dw;
        if (ds <= relStart && relStart < de) { isDanger = true; cursor = de; segEnd = Math.min(de, segEnd); break; }
        if (ds > relStart && ds < segEnd) segEnd = ds;
      }
      if (isDanger && segEnd <= relStart) { /* moved cursor */ }
      if (segEnd - relStart > 0.02) {
        segs.push({ start: relStart, width: segEnd - relStart, danger: isDanger });
      }
      if (!isDanger) cursor = segEnd;
      if (cursor >= gapStart + Math.PI * 2 - 0.0001) break;
    }
    for (const s of segs) {
      const geo = ringSectorGeometry(TOWER.ringInner, TOWER.ringOuter, TOWER.ringThick, s.start, s.width, q.detail === 'detailed');
      const mesh = new THREE.Mesh(geo, s.danger ? dangerMat : safeMat);
      mesh.castShadow = q.shadows !== 'off';
      mesh.receiveShadow = true;
      v.group.add(mesh);
      v.meshes.push(mesh);
    }
    // rest-ring identification: rim highlight (selection = marker + rim, not bloom)
    if (isRestRing) {
      const rim = new THREE.Mesh(
        ringSectorGeometry(TOWER.ringInner - 0.06, TOWER.ringInner, TOWER.ringThick + 0.06, 0, Math.PI * 2),
        ghostMat
      );
      v.group.add(rim);
      v.meshes.push(rim);
    }
  }

  // ---- pooled particles (two event tiers)
  function makeParticlePool(cap, size, color, additive) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(cap * 3);
    // park every unused particle far offscreen: at (0,0,0) they would all render
    // as a dot cluster on the tower axis before anything has been spawned
    for (let i = 0; i < cap; i++) pos[i * 3 + 1] = 1e6;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const soft = q.detail === 'detailed';
    const mat = new THREE.PointsMaterial({
      size: soft ? size * 1.8 : size, color, transparent: true, opacity: 0.9, depthWrite: false,
      map: soft ? dotTex : null, blending: soft && additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    return { points, pos, vel: new Float32Array(cap * 3), life: new Float32Array(cap), cap, head: 0 };
  }
  let puffPool, shardPool;
  function spawn(pool, x, y, z, count, spread, up) {
    const n = Math.min(count, pool.cap);
    for (let i = 0; i < n; i++) {
      const k = pool.head = (pool.head + 1) % pool.cap;
      pool.pos[k * 3] = x; pool.pos[k * 3 + 1] = y; pool.pos[k * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      pool.vel[k * 3] = Math.cos(a) * r;
      pool.vel[k * 3 + 1] = up * (0.5 + Math.random());
      pool.vel[k * 3 + 2] = Math.sin(a) * r;
      pool.life[k] = 0.5 + Math.random() * 0.4;
    }
  }
  function stepParticles(pool, dt) {
    let any = false;
    for (let k = 0; k < pool.cap; k++) {
      if (pool.life[k] > 0) {
        any = true;
        pool.life[k] -= dt;
        pool.pos[k * 3] += pool.vel[k * 3] * dt;
        pool.pos[k * 3 + 1] += pool.vel[k * 3 + 1] * dt;
        pool.pos[k * 3 + 2] += pool.vel[k * 3 + 2] * dt;
        pool.vel[k * 3 + 1] -= 2.2 * dt;
        if (pool.life[k] <= 0) pool.pos[k * 3 + 1] = 1e6;
      }
    }
    if (any) pool.points.geometry.attributes.position.needsUpdate = true;
  }

  // ---- ball trail (short ribbon of past positions; cosmetic only)
  const TRAIL_N = 22;
  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(TRAIL_N * 3);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
  trail.frustumCulled = false;
  scene.add(trail);
  let trailHead = 0, trailCount = 0;
  const trailOrdered = new Float32Array(TRAIL_N * 3); // reused; no per-frame allocation

  // ---- camera spring state
  let camY = 3, camVY = 0, shake = 0;
  let bounceT = 0;

  let theme = null;
  let cvdPalette = false;   // remembered so a high-contrast toggle cannot clear it
  let layerData = [];
  let layerCount = 0;

  function applyTheme(t, cvd) {
    theme = t;
    cvdPalette = !!cvd;
    const patch = cvd ? (hooks.cvdPatch || {}) : {};
    const pick = (k) => (cvd && patch[k]) || t[k];
    // The sky has always shown its authored colours as linear values (a deep,
    // saturated gradient); linearize once more so the shader's colour-space
    // output keeps that look on both the direct and the post-processed path.
    skyMat.uniforms.top.value.set(t.skyTop).convertSRGBToLinear();
    skyMat.uniforms.bottom.value.set(t.skyBottom).convertSRGBToLinear();
    scene.fog.color.set(t.fog);
    pillarMat.color.set(t.pillar);
    baseMat.color.set(pick('base'));
    ballMat.color.set(pick('ball'));
    ballLight.color.set(pick('accent'));
    const safeColor = highContrast ? '#ffffff' : pick('safe');
    const dangerColor = highContrast ? '#ff2020' : pick('danger');
    skyMat.uniforms.accent.value.set(pick('accent')).convertSRGBToLinear();
    if (safeMat) { safeMat.dispose(); dangerMat.map.dispose(); dangerMat.dispose(); ghostMat.dispose(); }
    safeMat = new THREE.MeshPhysicalMaterial({
      color: safeColor, roughness: 0.35, metalness: 0.2,
      emissive: t.safeEmissive || '#000000', emissiveIntensity: 1
    });
    dangerMat = new THREE.MeshPhysicalMaterial({
      color: dangerColor, roughness: 0.5, metalness: 0.05,
      map: makeStripeTexture(dangerColor, highContrast ? '#000000' : 'rgba(0,0,0,0.35)')
    });
    ghostMat = new THREE.MeshBasicMaterial({ color: pick('accent'), transparent: true, opacity: 0.8 });
    ghostMat.color.multiplyScalar(1.5); // HDR rim: the only ring element bright enough to bloom
    applyMaterialDetail();
    markerMat.color.set(pick('accent'));
    trail.material.color.set(pick('accent'));
    renderer.toneMappingExposure = t.id === 'dawn' ? 0.95 : 1.05;
    // force rebuild of visible rings
    for (const v of ringByIndex.values()) v.index = -2;
    lastRestRing = -99;
  }

  // Glossy clearcoat, grain and fluting on 'detailed'; IBL strength on 'reflections'.
  function applyMaterialDetail() {
    const det = q.detail === 'detailed';
    const env = q.reflections === 'on' ? 1 : 0;
    const set = (m, o) => { if (!m) return; Object.assign(m, o); m.needsUpdate = true; };
    set(safeMat, { clearcoat: det ? 0.5 : 0, clearcoatRoughness: 0.28, roughness: det ? 0.34 : 0.35, map: det ? grainTex : null, envMapIntensity: 0.22 * env });
    set(dangerMat, { clearcoat: det ? 0.4 : 0, clearcoatRoughness: 0.35, envMapIntensity: 0.18 * env });
    set(ballMat, { clearcoat: det ? 1 : 0, clearcoatRoughness: 0.08, roughness: det ? 0.2 : 0.25, envMapIntensity: 0.6 * env });
    set(pillarMat, { map: det ? fluteTex : null, clearcoat: det ? 0.3 : 0, clearcoatRoughness: 0.4, envMapIntensity: 0.25 * env });
    set(baseMat, { clearcoat: det ? 0.5 : 0, clearcoatRoughness: 0.25, envMapIntensity: 0.25 * env });
    // Reflections replace part of the hemisphere fill so overall exposure holds.
    fill.intensity = env ? 0.62 : 0.85;
  }

  function setLayers(layers) {
    layerData = layers;
    layerCount = layers.length;
    base.position.y = -(layerCount) - 0.15;
    for (const v of ringByIndex.values()) { v.index = -2; }
  }

  let lastRestRing = -99;

  // Maintain the visible ring window around the ball.
  function syncRings(ballSimY, restRing, towerAngle, tick) {
    const lo = Math.max(0, Math.floor(ballSimY) - TOWER.visibleAbove);
    const hi = Math.min(layerCount - 1, Math.floor(ballSimY) + TOWER.visibleBelow);
    // drop out-of-window views
    for (const [idx, v] of ringByIndex) {
      if (idx < lo || idx > hi) { clearRingView(v); v.index = -1; ringByIndex.delete(idx); ringPool.push(v); }
    }
    for (let i = lo; i <= hi; i++) {
      let v = ringByIndex.get(i);
      const layer = layerData[i];
      const worldOff = towerAngle + layer.offset + layer.drift * tick;
      if (!v) {
        v = ringPool.pop() || makeRingView();
        v.index = -2;
        ringByIndex.set(i, v);
      }
      if (v.index !== i || lastRestRing !== restRing) {
        buildRingView(v, layer, i === restRing, i === restRing + 1);
        v.index = i;
      }
      v.group.position.y = -i;
      v.group.rotation.y = -worldOff; // three.js Y rotation is counterclockwise seen from +Y
    }
    lastRestRing = restRing;
  }

  function handleEvent(ev) {
    if (!ev) return;
    const bx = 0, bz = TOWER.ballOrbit;
    if (ev.type === 'land') {
      spawn(puffPool, bx, ball.position.y, bz, q.particles === 'low' ? 8 : 22, 1.6, 1.2);
      if (!reducedMotion && ev.falls > 1) shake = Math.min(0.5, 0.12 * ev.falls);
    } else if (ev.type === 'smash') {
      spawn(shardPool, bx, ball.position.y, bz, q.particles === 'low' ? 16 : 60, 3.2, 2.2);
      if (!reducedMotion) shake = 0.45;
    } else if (ev.type === 'terminal') {
      if (ev.reason === 'danger-sector') { spawn(shardPool, bx, ball.position.y, bz, 80, 3.5, 2.5); if (!reducedMotion) shake = 0.6; }
      if (ev.reason === 'completed') { spawn(puffPool, bx, ball.position.y, bz, 90, 2.5, 3.0); }
    } else if (ev.type === 'passThrough' && ev.streak >= 2) {
      spawn(puffPool, bx, ball.position.y, bz, 6, 1.2, 0.6);
    }
  }

  // view = { towerAngle, ballY, phase, streak, smashReady, restRing, tick, dt }
  function update(view, dt) {
    if (!theme) return;
    const worldBallY = -view.ballY;
    // camera spring (critically damped; interruptible; reduced motion snaps)
    const targetY = worldBallY + CAM.height;
    if (reducedMotion) { camY = targetY; camVY = 0; }
    else {
      const a = CAM.springK * (targetY - camY) - CAM.springDamp * camVY;
      camVY += a * dt;
      camY += camVY * dt;
    }
    shake = Math.max(0, shake - dt * 1.8);
    const sh = reducedMotion ? 0 : shake * 0.12;
    camera.position.set(Math.sin(performance.now() * 0.03) * sh, camY + Math.cos(performance.now() * 0.041) * sh, camDist);
    camera.lookAt(0, camY - CAM.height - CAM.lookBelow, 0);
    // key light + tight shadow frustum track the visible stretch of tower
    const focusY = camY - CAM.height - 1.2;
    key.target.position.set(0, focusY, 0);
    key.position.set(KEY_OFFSET.x, focusY + KEY_OFFSET.y, KEY_OFFSET.z);

    // ambient motion: sky bands/stars and drifting motes (frozen when reduced)
    if (!reducedMotion) animTime += dt;
    skyMat.uniforms.uTime.value = animTime;
    skyMat.uniforms.uAnim.value = q.background === 'animated' ? 1 : 0;
    stepMotes(dt, camY);

    // ball visuals: bounce while resting (cosmetic), stretch while falling
    let visY = worldBallY;
    let squashY = 1, squashXZ = 1;
    if (view.phase === 'rest' || view.phase === 'resolving') {
      bounceT += dt;
      const hop = Math.abs(Math.sin(bounceT * 5.2));
      if (!reducedMotion) visY += hop * 0.14;
      squashY = 1 - (1 - hop) * 0.18; squashXZ = 1 + (1 - hop) * 0.12;
    } else if (view.phase === 'falling') {
      squashY = 1.18; squashXZ = 0.9;
    }
    ball.position.set(0, visY + TOWER.ballRadius + TOWER.ringThick, TOWER.ballOrbit);
    ball.scale.set(squashXZ, squashY, squashXZ);
    // streak charge: emissive + pulse (shape + brightness, not color alone)
    const charge = view.smashReady ? 1 : Math.min(1, view.streak / 3);
    ballMat.emissive.set(theme.accent);
    ballMat.emissiveIntensity = charge * (view.smashReady && !reducedMotion ? 0.9 + Math.sin(performance.now() * 0.012) * 0.35 : 0.45);
    ballLight.position.copy(ball.position);
    ballLight.intensity = 0.6 + charge * 1.2;

    // grounded marker sits on the rest ring surface
    marker.position.set(0, -(view.restRing) + 0.011, TOWER.ballOrbit);
    marker.visible = view.phase !== 'terminal';
    if (!reducedMotion) {
      const s = 1 + Math.sin(performance.now() * 0.006) * 0.08;
      marker.scale.set(s, s, 1);
    }

    syncRings(view.ballY, view.restRing, view.towerAngle, view.tick);

    // trail
    if (view.phase === 'falling' && !reducedMotion) {
      trailPos[trailHead * 3] = ball.position.x;
      trailPos[trailHead * 3 + 1] = ball.position.y;
      trailPos[trailHead * 3 + 2] = ball.position.z;
      trailHead = (trailHead + 1) % TRAIL_N;
      trailCount = Math.min(TRAIL_N, trailCount + 1);
    } else if (trailCount > 0) {
      trailCount--; // fade by shrinking
    }
    // rewrite trail ordered oldest→newest
    for (let i = 0; i < trailCount; i++) {
      const k = (trailHead - trailCount + i + TRAIL_N * 2) % TRAIL_N;
      trailOrdered[i * 3] = trailPos[k * 3]; trailOrdered[i * 3 + 1] = trailPos[k * 3 + 1]; trailOrdered[i * 3 + 2] = trailPos[k * 3 + 2];
    }
    trailGeo.attributes.position.array.set(trailOrdered);
    trailGeo.setDrawRange(0, trailCount);
    trailGeo.attributes.position.needsUpdate = true;

    stepParticles(puffPool, dt);
    stepParticles(shardPool, dt);

    renderFrame();
  }

  // ---- ambient motes: slow luminous dust around the tower (particles: high)
  let motes = null;
  function makeMotes() {
    if (motes) { scene.remove(motes.points); motes.points.geometry.dispose(); motes.points.material.dispose(); motes = null; }
    const n = MOTES[q.particles] || 0;
    if (!n) return;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = (Math.random() - 0.5) * 16; pos[i * 3 + 2] = Math.sin(a) * r - 2;
      seed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ size: 0.09, map: dotTex, color: 0xfff4dd, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scene.add(points);
    motes = { points, pos, seed, n, baseY: camY };
  }
  function stepMotes(dt, cy) {
    if (!motes) return;
    const { pos, seed, n } = motes;
    const lo = cy - 12, hi = cy + 4;
    const drift = reducedMotion ? 0 : dt;
    for (let i = 0; i < n; i++) {
      let y = pos[i * 3 + 1] + drift * (0.18 + (seed[i] % 1) * 0.2);
      pos[i * 3] += drift * Math.sin(animTime * 0.5 + seed[i]) * 0.06;
      if (y > hi) y = lo + (y - hi);
      else if (y < lo) y = hi - (lo - y);
      pos[i * 3 + 1] = y;
    }
    motes.points.geometry.attributes.position.needsUpdate = true;
  }

  // ---- render path: direct render, or the post chain when a pass is enabled
  function postKeyFor(w, h) {
    return q.post ? [q.ao, q.bloom, q.grade, q.antialias, w, h, pixelRatio].join('|') : 'none';
  }
  function buildPost(w, h) {
    if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; }
    if (!q.post || postFailed) return;
    try {
      const pw = Math.max(1, Math.round(w * pixelRatio)), ph = Math.max(1, Math.round(h * pixelRatio));
      const target = new THREE.WebGLRenderTarget(pw, ph, {
        type: THREE.HalfFloatType, samples: q.antialias === 'msaa' ? 4 : 0
      });
      const c = new EffectComposer(renderer, target);
      c.setPixelRatio(pixelRatio);
      c.setSize(w, h);
      c.addPass(new RenderPass(scene, camera));
      if (q.ao !== 'off') {
        const ao = new GTAOPass(scene, camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.7;
        ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: q.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: q.ao === 'high' ? 6 : 4, rings: 2, samples: q.ao === 'high' ? 16 : 8 });
        c.addPass(ao);
      }
      if (q.bloom === 'on') {
        // high threshold: only the charged ball, rest-ring rim and sparks bloom
        c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.35, 0.9));
      }
      if (q.grade === 'on') c.addPass(new ShaderPass(GradeShader));
      c.addPass(new OutputPass());
      if (q.antialias === 'smaa') c.addPass(new SMAAPass(pw, ph));
      if (q.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        c.addPass(fxaa);
      }
      composer = c;
    } catch (e) {
      // post-processing is an enhancement: fall back to direct rendering
      postFailed = true;
      composer = null;
    }
  }
  function renderFrame() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, q.dprCap) * q.scale * adaptiveScale;
    if (w !== size[0] || h !== size[1] || ratio !== pixelRatio) applySize();
    const k = postKeyFor(size[0], size[1]);
    if (k !== postKey) { postKey = k; buildPost(size[0], size[1]); }
    // The sky skips tone mapping on the direct path; the post chain's
    // OutputPass tone-maps everything, so pre-darken it there to match.
    skyMat.uniforms.uGain.value = composer ? 0.5 : 1;
    if (composer) {
      try { composer.render(); return; }
      catch (e) { postFailed = true; composer = null; }
    }
    renderer.render(scene, camera);
  }

  // ---- adaptive resolution: average ~90 frames, step the render scale down
  // when slow and back up when fast (before ever touching simulation rate)
  function adaptQuality(dt) {
    frameTimes.push(dt * 1000);
    if (frameTimes.length < 90) return;
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    frameTimes.length = 0;
    fpsAvg = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = Math.round(fpsAvg) + ' fps · ' + (Math.round(pixelRatio * 100) / 100) + '×';
    if (!q.adaptive) return;
    const before = adaptiveScale;
    if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
    else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
    if (before !== adaptiveScale) applySize();
  }

  // Camera distance: the authored value on wide screens, pulled back on
  // narrow/portrait ones so the whole active ring (outer radius plus padding)
  // fits inside the horizontal field of view.
  let camDist = CAM.dist;
  function fitDistance(aspect) {
    const halfW = TOWER.ringOuter + 0.35;
    const hTan = Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) * aspect;
    return Math.max(CAM.dist, halfW / hTan + TOWER.ringOuter * 0.35);
  }

  function applySize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, q.dprCap) * q.scale * adaptiveScale;
    pixelRatio = dpr;
    size = [w, h];
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    camDist = fitDistance(camera.aspect);
  }

  // Apply saved graphics settings live (object from the settings panel; {} = Auto).
  function setGraphics(saved) {
    const json = JSON.stringify(saved || {});
    if (json === gfxJson) return;
    const prev = gfxJson === null ? null : q;
    gfxJson = json;
    q = resolve(saved || {}, detected);
    const sm = SHADOW_MAP[q.shadows];
    renderer.shadowMap.enabled = sm > 0;
    key.castShadow = sm > 0;
    if (sm > 0 && key.shadow.mapSize.x !== sm) {
      key.shadow.mapSize.set(sm, sm);
      if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    }
    scene.environment = q.reflections === 'on' ? envTex : null;
    applyMaterialDetail();
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    // ring geometry (bevel, shadow casting) and particle pools depend on tiers
    if (!prev || prev.detail !== q.detail || prev.shadows !== q.shadows) {
      for (const v of ringByIndex.values()) v.index = -2;
      lastRestRing = -99;
    }
    if (!prev || prev.particles !== q.particles || prev.detail !== q.detail) { makePools(); makeMotes(); }
    adaptiveScale = 1;
    frameTimes = [];
    postKey = null;
    postFailed = false;
    fpsVisible(q.showFps);
    canvas.setAttribute('data-gfx-preset', q.preset);
    document.body.setAttribute('data-gfx-preset', q.preset);
    applySize();
  }

  function fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '— fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  // What the settings panel shows: GPU, auto choice, resolved tiers, cost.
  function graphicsInfo() {
    const px = [Math.round(size[0] * pixelRatio), Math.round(size[1] * pixelRatio)];
    return {
      gpu: gpu || 'unknown GPU', detected, resolved: q, pixels: px,
      summary: describe(q, px), fps: Math.round(fpsAvg), adaptiveScale,
      postFailed: postFailed && q.post
    };
  }

  // pools sized per tier (recreated)
  function makePools() {
    if (puffPool) { scene.remove(puffPool.points); puffPool.points.geometry.dispose(); puffPool.points.material.dispose(); }
    if (shardPool) { scene.remove(shardPool.points); shardPool.points.geometry.dispose(); shardPool.points.material.dispose(); }
    const cap = MAX_PARTICLES[q.particles] || 300;
    puffPool = makeParticlePool(cap, 0.07, 0xffffff, true);
    shardPool = makeParticlePool(Math.floor(cap / 2), 0.1, 0xff5030, false);
  }

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (hooks.onContextLost) hooks.onContextLost('lost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    buildEnv();
    scene.environment = q.reflections === 'on' ? envTex : null;
    postKey = null;
    makePools();
    if (theme) applyTheme(theme, cvdPalette);
    if (hooks.onContextRestored) hooks.onContextRestored();
  });

  const ro = new ResizeObserver(applySize);
  ro.observe(canvas.parentElement || canvas);
  setGraphics({});

  return {
    update, handleEvent, applyTheme, setLayers, setGraphics, graphicsInfo,
    setReducedMotion(v) { reducedMotion = v; },
    setHighContrast(v) { highContrast = v; if (theme) applyTheme(theme, cvdPalette); },
    adaptQuality,
    resize: applySize,
    projectBall() {
      const v = ball.position.clone().project(camera);
      return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * canvas.clientHeight };
    },
    get fps() { return fpsAvg; },
    get drawCalls() { return renderer.info.render.calls; },
    get triangles() { return renderer.info.render.triangles; },
    dispose() {
      ro.disconnect();
      for (const v of ringByIndex.values()) clearRingView(v);
      for (const v of ringPool) clearRingView(v);
      [safeMat, dangerMat, ghostMat, ballMat, pillarMat, baseMat, markerMat, skyMat].forEach(m => m && m.dispose());
      [grainTex, fluteTex, dotTex, envTex].forEach(t => t && t.dispose());
      if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      renderer.dispose();
    }
  };
}

function gpuName(r) {
  try {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch (e) { return ''; }
}
