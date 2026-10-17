// Spiral Drop — collects the English i18n keys the code and content show to players.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = new URL('../', import.meta.url);
export const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const unq = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
const STR = String.raw`'((?:[^'\\]|\\.)*)'`;

/** Keys passed to T(), captions, and the English tables kept in code. */
export function codeKeys() {
  const keys = new Set();
  for (const f of ['src/ui.js', 'src/main.js', 'src/platform.js', 'src/audio.js']) {
    const src = read(f);
    for (const re of [new RegExp(String.raw`\bT\(` + STR, 'g'), new RegExp(String.raw`\bcaption\(` + STR, 'g'),
      new RegExp(String.raw`\bT\([^;\n]*?\?\s*` + STR + String.raw`\s*:\s*` + STR, 'g'),
      new RegExp(String.raw`backButton\([^,)]+,\s*` + STR, 'g'), new RegExp(String.raw`globalLabel: ` + STR, 'g'),
      new RegExp(String.raw`\[` + STR + String.raw`, s\.score\.`, 'g'), new RegExp(String.raw`\bT\([^;\n]*?\|\| ` + STR, 'g')]) {
      for (const m of src.matchAll(re)) for (const g of m.slice(1)) if (g !== undefined) keys.add(unq(g));
    }
    for (const name of ['reasonText', 'ACHIEVEMENTS']) {
      const block = src.match(new RegExp('const ' + name + ' = [\\[{]([\\s\\S]*?)[\\]}];'));
      if (block) for (const m of block[1].matchAll(new RegExp(String.raw`(?:'[\w-]+'|name|desc):\s*` + STR, 'g'))) keys.add(unq(m[1]));
    }
    const sync = src.match(/get syncLabel\(\) \{\s*return (\{[^}]*\})\[syncState\] \|\| '([^']+)'/);
    if (sync) { for (const m of sync[1].matchAll(new RegExp(':\\s*' + STR, 'g'))) keys.add(unq(m[1])); keys.add(sync[2]); }
  }
  return keys;
}

export function contentKeys() {
  const C = createRequire(import.meta.url)('../src/content.js');
  const keys = new Set();
  C.THEMES.forEach((t) => keys.add(t.name));
  C.journeyStages().forEach((s) => keys.add(s.name));
  C.PRACTICE.forEach((p) => keys.add(p.name));
  C.CHALLENGES.forEach((c) => { keys.add(c.name); keys.add(c.description); });
  C.LESSONS.forEach((l) => { keys.add(l.name); keys.add(l.brief); });
  return keys;
}

export function usedKeys() { return new Set([...codeKeys(), ...contentKeys()]); }
