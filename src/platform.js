/*
 * Spiral Drop — platform adapter (StarHermit host integration).
 *
 * Every platform call goes through window.StarHermit (starhermit-sdk.js,
 * loaded before the game), which reads the launch token from the URL
 * fragment (#game_token / #access_token), strips it, and renews it. Hosted
 * (SDK signed in):
 *  - identity: profile nickname ("Player "+id prefix fallback)
 *  - cloud save: slot game:<slug> via the SDK; localStorage stays the
 *    offline cache, the cloud slot is a mirror
 *  - settings KV + keyboard bindings (control.* in starhermit.txt)
 *  - leaderboards: platform board read (userIds resolved to nicknames) and
 *    a finished run's total posted via submitScores (score-script.js)
 *  - invite link / sign-in button support
 *
 * The game never calls its own server routes (no time sync, score
 * submission, boards or activity/presence). Without a token it is pure
 * offline/local play with no network requests.
 */

import { T } from './i18n.js';

const SH = () => globalThis.StarHermit || null;
const authed = () => { const sh = SH(); return !!(sh && sh.signedIn); };

// Keyboard actions; mirrors the control.* lines in starhermit.txt.
export const DEFAULT_CONTROLS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  pause: ['Escape', 'Space'],
  undo: ['KeyU'],
  hint: ['KeyH'],
};

let playerName = null;       // resolved nickname when hosted
let cloudDoc = null;
let syncState = 'offline';   // offline | saving | synced | error
let controls = cloneControls(DEFAULT_CONTROLS);
let signedOutHook = null;
let conflictHook = null;

function cloneControls(c) {
  const out = {};
  for (const k of Object.keys(c)) out[k] = c[k].slice();
  return out;
}

async function resolveNickname(id) {
  const p = await SH().profile(id).catch(() => null);
  return p ? p.displayName : T('Player {id}', { id: String(id).slice(0, 6) });
}

async function platformLeaderboard(friendsOnly) {
  const r = await SH().leaderboard(null, { pageSize: 50, scope: friendsOnly ? 'friends' : undefined });
  const entries = [];
  for (const row of (r.items || []).slice(0, 50)) {
    const name = row.userId != null ? await resolveNickname(String(row.userId)) : T('Player');
    entries.push({ name, score: Number(row.score != null ? row.score : 0) });
  }
  return { entries };
}

let wired = false;
function wire() {
  const sh = SH();
  if (wired || !sh) return;
  wired = true;
  if (!sh.token) sh.init();
  sh.on('saved', (ok) => { syncState = ok ? 'synced' : 'error'; });
  // Another device saved since our last load: the SDK refused the write and
  // blocks further ones until a reload. Reload and hand the doc to the game to merge.
  sh.on('saveconflict', async () => {
    const doc = await sh.loadJSON().catch(() => null);
    if (sh.saveConflicted() || sh.saveLoadFailed()) { syncState = 'error'; return; }
    cloudDoc = doc;
    if (conflictHook) conflictHook(doc);
  });
  sh.on('auth', (a) => {
    if (a.signedIn) return;
    playerName = null;
    syncState = 'offline';
    if (signedOutHook) { try { signedOutHook(); } catch { /* UI hook */ } }
  });
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('pagehide', () => { if (authed()) sh.flushSave(true); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && authed()) sh.flushSave(true); });
  }
}

/**
 * Merge two progress docs without dropping either side: stages keep the more
 * stars and the higher score, best scores the higher value, lessons and
 * achievements are unioned (earliest unlock kept), lifetime layers and the
 * next stage take the larger value, and the daily streak with the later day
 * (then the longer run) wins.
 */
export function mergeProgress(a, b) {
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  const A = obj(a), B = obj(b);
  const stages = Object.assign({}, obj(A.stages));
  for (const [k, v] of Object.entries(obj(B.stages))) {
    const cur = stages[k];
    stages[k] = !cur ? v : { stars: Math.max(cur.stars || 0, (v && v.stars) || 0), score: Math.max(cur.score || 0, (v && v.score) || 0) };
  }
  const bestScores = Object.assign({}, obj(A.bestScores));
  for (const [k, v] of Object.entries(obj(B.bestScores))) if (!(Number(bestScores[k]) >= Number(v))) bestScores[k] = v;
  const achievements = Object.assign({}, obj(A.achievements));
  for (const [k, v] of Object.entries(obj(B.achievements))) if (!achievements[k] || (v && v < achievements[k])) achievements[k] = v;
  const sa = obj(A.dailyStreak), sb = obj(B.dailyStreak);
  const streak = String(sa.last || '') > String(sb.last || '') ? sa : String(sb.last || '') > String(sa.last || '') ? sb
    : ((sa.count || 0) >= (sb.count || 0) ? sa : sb);
  return {
    stages, bestScores, achievements,
    lessons: Object.assign({}, obj(A.lessons), obj(B.lessons)),
    lifetimeLayers: Math.max(Number(A.lifetimeLayers) || 0, Number(B.lifetimeLayers) || 0),
    nextStage: Math.max(Number(A.nextStage) || 0, Number(B.nextStage) || 0),
    dailyStreak: { last: streak.last || null, count: streak.count || 0 },
  };
}
export function createPlatform() {
  return {
    get hosted() { return authed(); },
    get authenticated() { return authed(); },
    get scope() { const sh = SH(); return sh ? sh.slug : null; },
    get controls() { return controls; },
    get playerName() { return playerName; },
    get cloudDoc() { return cloudDoc; },
    get syncState() { return syncState; },
    // English i18n keys; main.js translates them for display.
    get syncLabel() {
      return { synced: 'cloud synced', saving: 'saving…', error: 'cloud sync issue' }[syncState] || 'offline';
    },

    async init() {
      wire();
      if (authed()) {
        const sh = SH();
        playerName = await resolveNickname(sh.userId);
        cloudDoc = await sh.loadJSON().catch(() => null);
        syncState = 'synced';
        controls = await sh.loadBindings(DEFAULT_CONTROLS).catch(() => controls);
        return true;
      }
      return false; // no launch token: local play, no network
    },

    // daily boundaries and countdowns use the local clock
    now() { return new Date(); },

    async leaderboard(contentId, friendsOnly) {
      return authed() ? platformLeaderboard(friendsOnly) : { entries: [] };
    },

    // post a finished run's total to the `high-score` board (score-script.js);
    // resolves { posted, rank } — the player's rank there, or null. Offline: no request.
    async submitScore(total) {
      const sh = SH();
      if (!authed() || typeof sh.submitScores !== 'function') return { posted: false, rank: null };
      const keys = await sh.submitScores({ 'high-score': Math.max(0, Math.round(total)) }).catch(() => []);
      if (!keys.includes('high-score')) return { posted: false, rank: null };
      try {
        const r = await sh.leaderboard('high-score', { pageSize: 100 });
        const me = (r.items || []).find(i => i.userId === sh.userId);
        return { posted: true, rank: me ? me.rank : null };
      } catch { return { posted: true, rank: null }; }
    },

    // cloud mirror of the local save doc; debounced 2 s + pagehide flush
    cloudSave(doc) {
      cloudDoc = doc;
      if (!authed()) return; // offline: localStorage is the only store
      syncState = 'saving';
      SH().saveJSON(doc);
    },
    flushCloudSave() { return authed() ? SH().flushSave(true) : Promise.resolve(false); },

    // per-player settings KV: platform values win on start, changes mirrored
    async loadSettings() { return authed() ? (await SH().getSettings().catch(() => null)) || {} : {}; },
    pushSettings(obj) { if (authed()) SH().patchSettings(obj); },

    // keyboard: action for a KeyboardEvent.code, and display labels
    actionFor(code) {
      for (const a of Object.keys(controls)) if (controls[a].includes(code)) return a;
      return null;
    },
    keyLabel(action) {
      const NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc' };
      return (controls[action] || []).map((c) => NAMES[c] || c.replace(/^Key|^Digit/, '')).join(' / ');
    },

    canSignIn() { wire(); const sh = SH(); return !!(sh && sh.canSignIn()); },
    signIn() { const sh = SH(); return !!(sh && sh.signIn()); },
    inviteLink() { return authed() ? SH().inviteLink() : null; },
    onSignedOut(fn) { signedOutHook = fn; },
    /** fn(doc): a save conflict reloaded the cloud doc; the game merges and saves. */
    onConflict(fn) { conflictHook = fn; },
  };
}
