// Spiral Drop — graphics quality model + Graphics panel strings (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { PRESETS, CATEGORIES, BUDGETS, budgetFor, detectLevel, presetForLevel, detectPreset, resolve, presetTier, choosePreset, describe } from '../src/gfx.js';
import { GFX_LOCALES, gfxStrings, pickLocale } from '../src/gfx-i18n.js';

// The page loads src/gpu-level.js as a classic script (window.StarHermitGpu); here it is a CommonJS module.
globalThis.StarHermitGpu = createRequire(import.meta.url)('../src/gpu-level.js');

test('hardware level → preset: Low 0, Balanced 4, High 10, Ultra 17', () => {
  const desk = { cores: 16, memoryGb: 8 };
  assert.equal(detectLevel('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', desk), 0);
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', desk), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)', desk), 'low');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', desk), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', desk), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', desk), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0, D3D11)', desk), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', desk), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)', desk), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0, D3D11)', desk), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0, D3D11)', desk), 'ultra');
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(9), 'balanced');
  assert.equal(presetForLevel(16), 'high');
});

test('hardware level: phones and tablets never auto-select above Balanced', () => {
  assert.ok(detectLevel('Adreno (TM) 740', { mobile: true }) <= 9);
  assert.ok(['low', 'balanced'].includes(detectPreset('Adreno (TM) 740', { mobile: true })));
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11)', { mobile: true }), 'balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
});

test('per-preset budgets: cheaper materials, tessellation and effects on lower presets', () => {
  const kinds = PRESETS.map((p) => BUDGETS[p].material);
  assert.deepEqual(kinds, ['lambert', 'standard', 'physical', 'physical']);
  for (let i = 1; i < PRESETS.length; i++) {
    const lo = BUDGETS[PRESETS[i - 1]], hi = BUDGETS[PRESETS[i]];
    for (const k of ['curve', 'bevel', 'round', 'texture', 'puffs', 'motes', 'bloomRes', 'aoRes']) assert.ok(hi[k] >= lo[k], `${PRESETS[i]}.${k}`);
  }
  assert.equal(BUDGETS.low.panelBlur, false);
  assert.equal(BUDGETS.balanced.panelBlur, false);
  assert.equal(BUDGETS.high.panelBlur, true);
  assert.equal(BUDGETS.balanced.bloomRes, 0.5);
  assert.equal(BUDGETS.ultra.bloomRes, 1);
  // counts scale with the level inside a preset, at most 2×, and Particles "low" trims them
  assert.equal(budgetFor('high', 10).puffs, BUDGETS.high.puffs);
  assert.ok(budgetFor('high', 16).puffs > BUDGETS.high.puffs);
  assert.ok(budgetFor('high', 20).puffs <= 2 * BUDGETS.high.puffs);
  assert.equal(budgetFor('balanced', 4, 'low').motes, 0);
  assert.ok(budgetFor('balanced', 4, 'low').puffs < BUDGETS.balanced.puffs);
  const r = resolve({ preset: 'ultra' }, 'low', 20);
  assert.equal(r.level, 20);
  assert.equal(r.budget.material, 'physical');
  assert.equal(resolve({}, 'low', 0).budget.material, 'lambert');
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
