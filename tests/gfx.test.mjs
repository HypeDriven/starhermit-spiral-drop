// Spiral Drop — graphics quality model + Graphics panel strings (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, CATEGORIES, detectPreset, resolve, presetTier, choosePreset, describe } from '../src/gfx.js';
import { GFX_LOCALES, gfxStrings, pickLocale } from '../src/gfx-i18n.js';

test('detectPreset: software renderers get low, discrete GPUs high, others balanced', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'high');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11)'), 'high');
  assert.equal(detectPreset('Apple M2 Pro'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 740'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
});

test('detectPreset: touch/mobile devices cap Auto at balanced', () => {
  assert.equal(detectPreset('Apple M1', true), 'balanced');
  assert.equal(detectPreset('SwiftShader', true), 'low');
});

test('resolve: auto follows the detected preset', () => {
  const r = resolve({}, 'low');
  assert.equal(r.preset, 'low');
  assert.equal(r.auto, true);
  assert.equal(r.shadows, 'off');
  assert.equal(r.post, false, 'Low renders without a post chain');
  assert.equal(r.adaptive, true);
  assert.equal(r.showFps, false);
});

test('resolve: explicit preset, per-category override and scale clamp', () => {
  const r = resolve({ preset: 'high', bloom: 'off', render_scale: 5 }, 'low');
  assert.equal(r.preset, 'high');
  assert.equal(r.auto, false);
  assert.equal(r.bloom, 'off');
  assert.equal(r.shadows, presetTier('high', 'shadows'));
  assert.equal(r.scale, 2);
  assert.equal(resolve({ render_scale: 0.1 }, 'high').scale, 0.5);
  assert.equal(resolve({ preset: 'ultra' }).scale, 1.25);
  assert.equal(resolve({ shadows: 'bogus' }, 'balanced').shadows, 'low', 'invalid tiers fall back to the preset');
  assert.equal(resolve({ preset: 'low', grade: 'on' }).post, true, 'an override can enable the post chain');
});

test('choosePreset clears overrides but keeps scale/adaptive/fps', () => {
  const next = choosePreset({ preset: 'low', bloom: 'on', shadows: 'high', render_scale: 1.5, adaptive: false, show_fps: true }, 'ultra');
  assert.deepEqual(next, { preset: 'ultra', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.equal(choosePreset({ ao: 'on' }, 'auto').preset, 'auto');
});

test('every preset defines every category with a legal tier', () => {
  for (const p of PRESETS) for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
  }
});

test('describe summarises cost', () => {
  const s = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(s, /2048² shadows/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×800 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('Graphics strings exist in every required locale', () => {
  for (const l of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) assert.ok(GFX_LOCALES.includes(l), l);
  const ref = gfxStrings('en-US');
  const shape = (o) => Object.entries(o).map(([k, v]) => (v && typeof v === 'object' ? k + ':' + shape(v) : k)).sort().join(',');
  for (const l of GFX_LOCALES) {
    const t = gfxStrings(l);
    assert.equal(shape(t), shape(ref), l + ' has the same keys as en-US');
    for (const cat of Object.keys(CATEGORIES)) assert.ok(t.cats[cat], l + ' ' + cat);
    for (const tiers of Object.values(CATEGORIES)) for (const tier of tiers) assert.ok(t.tiers[tier], l + ' ' + tier);
  }
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('de-AT'), 'de-DE');
  assert.equal(pickLocale('ja-JP'), 'en-US');
});
