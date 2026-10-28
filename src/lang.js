// Spiral Drop — localization for the game modules and the engine client.
// The tables live in src/strings.js (English source strings as keys; en-GB,
// es-ES and fr-CA list only their differences from en-US, es-419 and fr-FR).
// The engine client sets the language from the runtime's interface language
// (native/i18n.ts → setLang); node tests get English unless they set one.
import { ROWS, OVERRIDES } from './strings.js';

export const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const COLUMNS = ['es-419', 'de-DE', 'fr-FR', 'pt-BR', 'it-IT'];
const PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
const FALLBACK_BY_LANG = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };
const hasOwn = Object.prototype.hasOwnProperty;

export const TABLES = { 'en-US': {} };
for (const row of ROWS) {
  TABLES['en-US'][row[0]] = row[0];
  COLUMNS.forEach((l, i) => { (TABLES[l] || (TABLES[l] = {}))[row[0]] = row[i + 1]; });
}
for (const [l, table] of Object.entries(OVERRIDES)) TABLES[l] = { ...table };

let current = 'en-US';

/** The closest supported locale for a BCP-47 tag (defaults to en-US). */
export function pickLocale(tag) {
  const t = String(tag || '').trim().replace('_', '-');
  const exact = LOCALES.find((k) => k.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const base = t.split('-')[0].toLowerCase();
  if (base === 'en' && /-(gb|uk|ie|au|nz)$/i.test(t)) return 'en-GB';
  if (base === 'es' && /-es$/i.test(t)) return 'es-ES';
  if (base === 'fr' && /-ca$/i.test(t)) return 'fr-CA';
  return FALLBACK_BY_LANG[base] || 'en-US';
}

/** Sets the game language (any tag; the closest supported locale is used). Returns it. */
export function setLang(tag) { current = pickLocale(tag); return current; }
export function lang() { return current; }

function lookup(key) {
  for (let l = current; l; l = PARENT[l]) {
    const t = TABLES[l];
    if (t && hasOwn.call(t, key)) return t[key];
  }
  return key;
}

/** Translate an English source string; {name} placeholders are filled from vars. */
export function T(key, vars) {
  let s = lookup(String(key));
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (hasOwn.call(vars, k) ? String(vars[k]) : m));
  return s;
}
