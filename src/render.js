/*
 * Spiral Drop — render module (Three.js).
 * Semantic entity views (rings, ball, pillar, base), pooled particles,
 * authored camera with critically damped spring, quality tiers, and explicit
 * disposal. Rendering consumes immutable snapshots + interpolation alpha;
 * it never mutates rules state.
 */
import * as THREE from '../lib/three.module.js';

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

const MAX_PARTICLES = { low: 300, medium: 900, high: 2000 };

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
function ringSectorGeometry(rIn, rOut, thick, start, width) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOut, start, start + width, false);
  shape.absarc(0, 0, rIn, start + width, start, true);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 24 });
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.1, 120);

  // ---- quality state
  let tier = 'high';
  let renderScale = 1;
  let reducedMotion = false;
  let highContrast = false;
  let fpsEma = 60;

  // ---- lights: one dominant key, soft environment fill, contact grounding
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1; key.shadow.camera.far = 40;
  key.shadow.camera.left = -6; key.shadow.camera.right = 6;
  key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
  const fill = new THREE.HemisphereLight(0xbfd4ff, 0x30231f, 0.85);
  const ballLight = new THREE.PointLight(0xffffff, 0.9, 6);
  scene.add(key, fill, ballLight);

  // ---- gradient sky dome + fog ("endless gradient")
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#0b1030') }, bottom: { value: new THREE.Color('#ff7e5f') } },
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP;' +
      'void main(){ float h = clamp(normalize(vP).y*0.5+0.5, 0.0, 1.0);' +
      'gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }'
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 24, 16), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(0x3a1c5f, 18, 70);

  // ---- pillar, base
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x4a2a6a, roughness: 0.55, metalness: 0.15 });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(TOWER.pillarRadius, TOWER.pillarRadius, 200, 28), pillarMat);
  pillar.position.y = -100;
  pillar.receiveShadow = true;
  scene.add(pillar);

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x8be09a, roughness: 0.4, emissive: 0x2a7a3a, emissiveIntensity: 0.5 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(TOWER.ringOuter + 0.5, TOWER.ringOuter + 0.7, 0.3, 40), baseMat);
  base.receiveShadow = true;
  scene.add(base);

  // ---- ball (state signaled by emissive + scale pulse, not color alone)
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, roughness: 0.25, metalness: 0.1, emissive: 0x000000 });
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
      const geo = ringSectorGeometry(TOWER.ringInner, TOWER.ringOuter, TOWER.ringThick, s.start, s.width);
      const mesh = new THREE.Mesh(geo, s.danger ? dangerMat : safeMat);
      mesh.castShadow = tier !== 'low';
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
  function makeParticlePool(cap, size, color) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(cap * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ size, color, transparent: true, opacity: 0.9, depthWrite: false });
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

  // ---- camera spring state
  let camY = 3, camVY = 0, shake = 0;
  let bounceT = 0;

  let theme = null;
  let layerData = [];
  let layerCount = 0;

  function applyTheme(t, cvd) {
    theme = t;
    const patch = cvd ? (hooks.cvdPatch || {}) : {};
    const pick = (k) => (cvd && patch[k]) || t[k];
    skyMat.uniforms.top.value.set(t.skyTop);
    skyMat.uniforms.bottom.value.set(t.skyBottom);
    scene.fog.color.set(t.fog);
    pillarMat.color.set(t.pillar);
    baseMat.color.set(pick('base'));
    ballMat.color.set(pick('ball'));
    ballLight.color.set(pick('accent'));
    const safeColor = highContrast ? '#ffffff' : pick('safe');
    const dangerColor = highContrast ? '#ff2020' : pick('danger');
    if (safeMat) { safeMat.dispose(); dangerMat.map.dispose(); dangerMat.dispose(); ghostMat.dispose(); }
    safeMat = new THREE.MeshStandardMaterial({
      color: safeColor, roughness: 0.35, metalness: 0.2,
      emissive: t.safeEmissive || '#000000', emissiveIntensity: 1
    });
    dangerMat = new THREE.MeshStandardMaterial({
      color: dangerColor, roughness: 0.5, metalness: 0.05,
      map: makeStripeTexture(dangerColor, highContrast ? '#000000' : 'rgba(0,0,0,0.35)')
    });
    ghostMat = new THREE.MeshBasicMaterial({ color: pick('accent'), transparent: true, opacity: 0.8 });
    markerMat.color.set(pick('accent'));
    trail.material.color.set(pick('accent'));
    renderer.toneMappingExposure = t.id === 'dawn' ? 0.95 : 1.05;
    // force rebuild of visible rings
    for (const v of ringByIndex.values()) v.index = -2;
    lastRestRing = -99;
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
      spawn(puffPool, bx, ball.position.y, bz, tier === 'low' ? 8 : 22, 1.6, 1.2);
      if (!reducedMotion && ev.falls > 1) shake = Math.min(0.5, 0.12 * ev.falls);
    } else if (ev.type === 'smash') {
      spawn(shardPool, bx, ball.position.y, bz, tier === 'low' ? 16 : 60, 3.2, 2.2);
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
    camera.position.set(Math.sin(performance.now() * 0.03) * sh, camY + Math.cos(performance.now() * 0.041) * sh, CAM.dist);
    camera.lookAt(0, camY - CAM.height - CAM.lookBelow, 0);

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
    const ordered = new Float32Array(TRAIL_N * 3);
    for (let i = 0; i < trailCount; i++) {
      const k = (trailHead - trailCount + i + TRAIL_N * 2) % TRAIL_N;
      ordered[i * 3] = trailPos[k * 3]; ordered[i * 3 + 1] = trailPos[k * 3 + 1]; ordered[i * 3 + 2] = trailPos[k * 3 + 2];
    }
    trailGeo.attributes.position.array.set(ordered);
    trailGeo.setDrawRange(0, trailCount);
    trailGeo.attributes.position.needsUpdate = true;

    stepParticles(puffPool, dt);
    stepParticles(shardPool, dt);

    renderer.render(scene, camera);
  }

  // ---- auto render-scale: drop scale before ever touching simulation rate
  function adaptQuality(dt) {
    const fps = 1 / Math.max(dt, 1e-4);
    fpsEma = fpsEma * 0.95 + fps * 0.05;
    if (fpsEma < 45 && renderScale > 0.6) { renderScale = Math.max(0.6, renderScale - 0.1); applySize(); }
    else if (fpsEma > 58 && renderScale < 1) { renderScale = Math.min(1, renderScale + 0.05); applySize(); }
  }

  function applySize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const h = canvas.clientHeight || canvas.parentElement.clientHeight;
    const dprCap = tier === 'low' ? 1 : tier === 'medium' ? 1.5 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * renderScale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setTier(t) {
    tier = t;
    key.castShadow = t !== 'low';
    renderer.shadowMap.enabled = t !== 'low';
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    applySize();
  }

  // pools sized per tier (recreated)
  function makePools() {
    if (puffPool) { scene.remove(puffPool.points); puffPool.points.geometry.dispose(); puffPool.points.material.dispose(); }
    if (shardPool) { scene.remove(shardPool.points); shardPool.points.geometry.dispose(); shardPool.points.material.dispose(); }
    const cap = MAX_PARTICLES[tier] || 900;
    puffPool = makeParticlePool(cap, 0.07, 0xffffff);
    shardPool = makeParticlePool(Math.floor(cap / 2), 0.1, 0xff5030);
  }
  makePools();

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (hooks.onContextLost) hooks.onContextLost('lost');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    makePools();
    if (theme) applyTheme(theme, highContrast);
    if (hooks.onContextRestored) hooks.onContextRestored();
  });

  const ro = new ResizeObserver(applySize);
  ro.observe(canvas.parentElement || canvas);
  applySize();

  return {
    update, handleEvent, applyTheme, setLayers, setTier,
    setReducedMotion(v) { reducedMotion = v; },
    setHighContrast(v) { highContrast = v; if (theme) applyTheme(theme, v); },
    adaptQuality,
    resize: applySize,
    projectBall() {
      const v = ball.position.clone().project(camera);
      return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * canvas.clientHeight };
    },
    get fps() { return fpsEma; },
    get drawCalls() { return renderer.info.render.calls; },
    get triangles() { return renderer.info.render.triangles; },
    dispose() {
      ro.disconnect();
      for (const v of ringByIndex.values()) clearRingView(v);
      for (const v of ringPool) clearRingView(v);
      [safeMat, dangerMat, ghostMat, ballMat, pillarMat, baseMat, markerMat, skyMat].forEach(m => m && m.dispose());
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      renderer.dispose();
    }
  };
}
