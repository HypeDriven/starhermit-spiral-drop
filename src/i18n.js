/**
 * Spiral Drop — localization.
 *
 * Nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.
 * English source strings are the keys; strings.js holds the tables (en-GB,
 * es-ES and fr-CA list only their differences from en-US, es-419 and fr-FR).
 * The locale comes from the game's Language setting through sh-language.js
 * (explicit choice → StarHermit account preferredLanguage → navigator.languages
 * → en-US); ?lang= forces one for the page load (QA links) and hides the
 * selector. A change sets <html lang>, notifies onLanguage() listeners and
 * fires `sd-language` on document so every renderer redraws in place.
 */
import { ROWS, OVERRIDES } from './strings.js';

export const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const COLUMNS = ['es-419', 'de-DE', 'fr-FR', 'pt-BR', 'it-IT'];
const PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };

export const TABLES = { 'en-US': {} };
for (const row of ROWS) {
  TABLES['en-US'][row[0]] = row[0];
  COLUMNS.forEach((l, i) => { (TABLES[l] || (TABLES[l] = {}))[row[0]] = row[i + 1]; });
}
for (const [l, table] of Object.entries(OVERRIDES)) TABLES[l] = { ...table };

let lang = 'en-US';
const listeners = new Set();

function lookup(key) {
  for (let l = lang; l; l = PARENT[l]) {
    const t = TABLES[l];
    if (t && Object.prototype.hasOwnProperty.call(t, key)) return t[key];
  }
  return key;
}

/** Translate an English source string; {name} placeholders are filled from vars. */
export function T(key, vars) {
  let s = lookup(String(key));
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  return s;
}

export function currentLang() { return lang; }

/** Call fn(locale) after every language change; returns an unsubscribe function. */
export function onLanguage(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function setLocale(next) {
  const changed = next !== lang;
  lang = LOCALES.includes(next) ? next : 'en-US';
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  if (!changed) return;
  for (const fn of [...listeners]) { try { fn(lang); } catch (e) { console.error(e); } }
  if (typeof document !== 'undefined' && typeof CustomEvent === 'function') document.dispatchEvent(new CustomEvent('sd-language', { detail: { lang } }));
}

const SL = typeof window !== 'undefined' ? window.StarHermitLanguage : null;
let forced = null;
try { forced = new URLSearchParams(window.location.search).get('lang'); } catch { /* no window / opaque origin */ }
const forcedLocale = forced && SL ? SL.match(forced, LOCALES) : null;

/** The sh-language.js instance (also window.GameLanguage); null outside the browser. */
export const language = SL ? SL.create({
  game: 'spiral-drop', supported: LOCALES, panel: !forcedLocale,
  apply: (locale) => setLocale(forcedLocale || locale),
}) : null;
if (!language) setLocale('en-US');
