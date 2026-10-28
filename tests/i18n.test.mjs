// Localization coverage for the engine client: every English key native/*.ts
// shows (T('…'), N('…')), plus the content it translates (themes, stages,
// practice presets, challenges, lessons, achievements), is translated in
// every full locale (en-GB → en-US, es-ES → es-419, fr-CA → fr-FR inherit);
// placeholders survive; no table row is unused; src/lang.js picks locales and
// falls back like the browser build; the account strings exist in all nine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { codeKeys, audit, LOCALES } from './i18n-common.mjs';
import { TABLES, T, setLang, pickLocale } from '../src/lang.js';
import { shStrings, SH_STRINGS } from '../src/sh-strings.js';
import { ACHIEVEMENTS } from '../src/progress.js';

const ROOT = new URL('../', import.meta.url);
const C = createRequire(import.meta.url)('../src/content.js');

function usedKeys() {
  const keys = new Set();
  for (const f of readdirSync(new URL('native/', ROOT)).filter((n) => n.endsWith('.ts'))) {
    codeKeys(readFileSync(new URL(`native/${f}`, ROOT), 'utf8')).forEach((k) => keys.add(k));
  }
  C.THEMES.forEach((t) => keys.add(t.name));
  C.journeyStages().forEach((s) => keys.add(s.name));
  C.PRACTICE.forEach((p) => keys.add(p.name));
  C.CHALLENGES.forEach((c) => { keys.add(c.name); keys.add(c.description); });
  C.LESSONS.forEach((l) => { keys.add(l.name); keys.add(l.brief); });
  for (const a of ACHIEVEMENTS) { keys.add(a.name); keys.add(a.desc); }
  keys.delete('Spiral Drop');
  return [...keys].sort();
}

test('every used key is translated in every locale; placeholders intact; no unused rows', () => {
  const used = usedKeys();
  assert.ok(used.length > 200, 'keys found: ' + used.length);
  const tables = { ...TABLES };
  delete tables['en-US'];
  const problems = audit(tables, used);
  const unusedEn = Object.keys(TABLES['en-US']).filter((k) => !used.includes(k)).map((k) => `en-US unused: ${k}`);
  assert.deepEqual([...problems, ...unusedEn], []);
});

test('the language follows the runtime tag with the regional fallbacks', () => {
  assert.equal(pickLocale('de'), 'de-DE');
  assert.equal(pickLocale('en-AU'), 'en-GB');
  assert.equal(pickLocale('es-MX'), 'es-419');
  assert.equal(pickLocale('fr-CA'), 'fr-CA');
  assert.equal(pickLocale('ja-JP'), 'en-US');
  for (const l of LOCALES) assert.equal(pickLocale(l), l);
  setLang('de-DE');
  assert.equal(T('Layer {n} / {total}', { n: 3, total: 9 }), 'Ebene 3 / 9');
  setLang('fr-CA');
  assert.equal(T('Score'), 'Pointage');
  setLang('en-GB');
  assert.equal(T('Color-vision-safe palette'), 'Colour-vision-safe palette');
  setLang('en-US');
  assert.equal(T('No such key'), 'No such key');
});

test('the account strings exist in all nine locales', () => {
  const keys = Object.keys(shStrings('en-US'));
  for (const l of LOCALES) {
    assert.ok(SH_STRINGS[l], l);
    for (const k of keys) assert.ok(SH_STRINGS[l][k], `${l} ${k}`);
  }
});
