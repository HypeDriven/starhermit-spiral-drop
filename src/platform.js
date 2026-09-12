/*
 * Spiral Drop — platform adapter (StarHermit host integration).
 *
 * The launch token arrives in the URL fragment (#game_token=<jwt>), is read
 * once, then stripped from the URL. The (unverified) JWT payload carries
 * `sub` (user id) and `game_scope` (this game's slug). The token lives in
 * memory only, is attached as `Authorization: Bearer` on every REST call,
 * and is re-minted every 45 min via POST /api/v1/games/{slug}/launch-token.
 *
 * Hosted (token read):
 *  - identity: GET /api/v1/users/{sub}/profile → nickname (NEVER /api/v1/me,
 *    never usernames; "Player "+id8 fallback)
 *  - cloud save: GET/PUT /api/v1/me/cloud-saves/{game_scope} as zip+base64;
 *    localStorage stays the offline cache, the cloud slot is a mirror
 *  - leaderboards: read-only platform board (GET /api/v1/games/{slug} →
 *    leaderboardId, then /api/v1/leaderboards/{id}/entries; userIds resolve
 *    to nicknames via the profile helper)
 *  - validated daily replays still go to the game's own backend
 *    (POST /api/v1/scores); when it is unreachable the score stays local
 *
 * Local dev (no token): query-param fallbacks (?launch= / ?token=) exist for
 * the bundled dev server (npm start), which may answer time sync, validated
 * score submission, boards, and activity heartbeats. Without it — or on
 * file:// — everything degrades to offline/local play, identical to hosted
 * play minus the server-backed extras.
 */

// ---- stored-zip helpers (single stored entry, CRC32, no compression) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const local = out.length;
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

// ---- launch token: fragment first (read once + stripped), query for dev ----
function readLaunchToken() {
  try {
    const frag = new URLSearchParams(location.hash.slice(1));
    const t = frag.get('game_token');
    if (t) {
      // the fragment is read once and stripped so it is never persisted,
      // bookmarked, or leaked through a referrer
      try { history.replaceState(null, '', location.pathname + location.search); }
      catch { /* history unavailable (file://) — token still usable */ }
      return t;
    }
  } catch { /* no location (non-browser) */ }
  // query fallbacks are for local dev only — the platform never puts a
  // token in the query string
  try {
    const q = new URLSearchParams(location.search);
    return q.get('launch') || q.get('token') || null;
  } catch { return null; }
}

function decodePayload(jwt) {
  try {
    const part = String(jwt).split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - b64.length % 4) : '';
    const json = JSON.parse(atob(b64 + pad));
    return json && typeof json === 'object' ? json : null;
  } catch { return null; }
}

const LAUNCH_TOKEN = readLaunchToken();
let token = LAUNCH_TOKEN;
const claims = LAUNCH_TOKEN ? decodePayload(LAUNCH_TOKEN) : null;
const userId = claims && claims.sub ? String(claims.sub) : null;
const gameScope = claims && claims.game_scope ? String(claims.game_scope) : null;

let playerName = null;       // resolved nickname (or "Player "+id8) when hosted
let localBackend = false;    // bundled dev server (npm start) answered /time
let timeOffsetMs = 0;        // serverTime - clientTime (local backend only)
let timeSynced = false;
let activityId = null;
let presenceTimer = null;
let refreshTimer = null;
let leaderboardId = undefined; // undefined = unknown, null = none on-platform
const profileCache = new Map();

function authHeaders() { return token ? { Authorization: 'Bearer ' + token } : {}; }

async function api(path, opts) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, authHeaders());
  const res = await fetch('/api/v1' + path, Object.assign({ headers }, opts));
  if (res.status === 429) {
    const err = new Error('rate-limited');
    err.rateLimited = true;
    err.retryAfter = Number(res.headers.get('Retry-After') || 5);
    throw err;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const err = new Error(body.error || ('http-' + res.status));
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---- identity: nickname via /users/{id}/profile (never /api/v1/me) ----
async function fetchProfile(id) {
  if (!id) return null;
  if (profileCache.has(id)) return profileCache.get(id);
  const p = api('/users/' + encodeURIComponent(id) + '/profile').catch(() => null);
  profileCache.set(id, p);
  return p;
}

async function resolveNickname(id) {
  const prof = await fetchProfile(id);
  const nick = prof && typeof prof.nickname === 'string' && prof.nickname.trim()
    ? prof.nickname.trim() : null;
  return nick || ('Player ' + String(id).slice(0, 8));
}

// ---- token refresh: re-mint every 45 min, retry failures ~60 s ----
function scheduleRefresh(delayMs) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshToken, delayMs);
}
async function refreshToken() {
  if (!token || !gameScope) return;
  try {
    const body = await api('/games/' + encodeURIComponent(gameScope) + '/launch-token', { method: 'POST', body: '{}' });
    if (body && typeof body.token === 'string' && body.token) token = body.token;
    scheduleRefresh(45 * 60000);
  } catch {
    scheduleRefresh(60000);
  }
}

// ---- cloud save: ONE slot (the game slug), zip+base64, remote-preferred ----
let cloudDoc = null;
let cloudTimer = null;
let syncState = 'offline'; // offline | saving | synced | error

function cloudPath() { return '/me/cloud-saves/' + encodeURIComponent(gameScope); }

async function cloudLoad() {
  if (!token || !gameScope) return;
  try {
    const res = await fetch('/api/v1' + cloudPath(), { headers: authHeaders() });
    if (res.status === 404) { syncState = 'synced'; return; } // no save yet
    if (!res.ok) throw new Error('http-' + res.status);
    const bytes = new Uint8Array(await res.arrayBuffer());
    cloudDoc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
    syncState = 'synced';
  } catch {
    syncState = 'error'; // localStorage remains the source of truth
  }
}

function cloudSave(doc) {
  cloudDoc = doc;
  if (!token || !gameScope) return; // offline: localStorage is the only store
  syncState = 'saving';
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(flushCloudSave, 2000); // ~2 s debounce
}

async function flushCloudSave() {
  clearTimeout(cloudTimer);
  cloudTimer = null;
  if (!token || !gameScope || !cloudDoc) return;
  try {
    const bytes = zipStore('save.json', new TextEncoder().encode(JSON.stringify(cloudDoc)));
    const res = await fetch('/api/v1' + cloudPath(), {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
      body: JSON.stringify({ dataBase64: bytesToBase64(bytes) })
    });
    if (!res.ok) throw new Error('http-' + res.status);
    syncState = 'synced';
  } catch {
    syncState = 'error'; // next cloudSave retries
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('pagehide', () => { if (cloudTimer) flushCloudSave(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && cloudTimer) flushCloudSave(); });
}

// ---- leaderboards (read-only on-platform; validated replays on the dev server) ----
async function fetchLeaderboardId() {
  if (!token || !gameScope) return null;
  if (leaderboardId !== undefined) return leaderboardId;
  try {
    const body = await api('/games/' + encodeURIComponent(gameScope));
    leaderboardId = body && body.leaderboardId ? body.leaderboardId : null;
  } catch {
    leaderboardId = null; // no platform board — local records only
  }
  return leaderboardId;
}

async function platformLeaderboard(friendsOnly) {
  const id = await fetchLeaderboardId();
  if (!id) return { entries: [] };
  const q = '?friendsOnly=' + (friendsOnly ? '1' : '0') + '&page=1&pageSize=50';
  const body = await api('/leaderboards/' + encodeURIComponent(id) + '/entries' + q);
  const rows = (body && body.entries) || [];
  const entries = [];
  for (const r of rows.slice(0, 50)) {
    const uid = r.userId != null ? String(r.userId) : (r.user != null ? String(r.user) : null);
    const name = uid ? await resolveNickname(uid)
      : (typeof r.name === 'string' && r.name ? r.name : 'Player');
    entries.push({ name, score: Number(r.score != null ? r.score : 0) });
  }
  return { entries };
}

export function createPlatform() {
  return {
    get hosted() { return !!token || localBackend; },
    get authenticated() { return !!token; },
    get scope() { return gameScope; },
    get playerName() { return playerName; },
    get cloudDoc() { return cloudDoc; },
    get syncState() { return syncState; },
    get syncLabel() {
      return { synced: 'cloud synced', saving: 'saving…', error: 'cloud sync issue' }[syncState] || 'offline';
    },

    async init() {
      if (token) {
        playerName = await resolveNickname(userId);
        await cloudLoad();
        scheduleRefresh(45 * 60000);
        return true;
      }
      // no launch token: local play. Sync against the bundled dev server if it
      // is serving (npm start); otherwise offline, same play minus server extras.
      try {
        await this.syncTime();
        localBackend = true;
      } catch { localBackend = false; }
      return localBackend;
    },

    async syncTime() {
      const t0 = Date.now();
      const body = await api('/time');
      const t1 = Date.now();
      const serverMs = typeof body.now === 'number' ? body.now : Date.parse(body.now);
      timeOffsetMs = serverMs - (t0 + (t1 - t0) / 2);
      timeSynced = true;
      return timeOffsetMs;
    },

    // authoritative "now" for daily boundaries and countdowns
    now() { return new Date(Date.now() + (timeSynced ? timeOffsetMs : 0)); },
    get timeSynced() { return timeSynced; },

    // validated daily replays go to the game's own backend; on the platform it
    // is absent (404) and the caller keeps the score local — graceful fallback.
    async submitScore(envelope) {
      return api('/scores', { method: 'POST', body: JSON.stringify(envelope) });
    },

    async leaderboard(contentId, friendsOnly) {
      if (token) return platformLeaderboard(friendsOnly);
      if (localBackend) {
        const q = '?content=' + encodeURIComponent(contentId) + (friendsOnly ? '&friends=1' : '');
        return api('/scores' + q);
      }
      return { entries: [] };
    },

    // cloud mirror of the local save doc; debounced 2 s + pagehide flush
    cloudSave(doc) { cloudSave(doc); },
    flushCloudSave() { return flushCloudSave(); },

    // activity + presence heartbeats exist only on the bundled dev server;
    // the platform has no per-game presence endpoints, so hosted mode skips
    // them entirely (no fabricated calls, no on-platform console errors).
    async startActivity(mode, contentId) {
      if (!localBackend) return null;
      try {
        const body = await api('/activity', { method: 'POST', body: JSON.stringify({ mode, contentId }) });
        activityId = body.activityId || null;
        this.startPresence();
        return activityId;
      } catch { return null; }
    },

    async endActivity() {
      this.stopPresence();
      if (!localBackend || !activityId) return;
      const id = activityId;
      activityId = null;
      try { await api('/activity/' + encodeURIComponent(id) + '/end', { method: 'POST', body: '{}' }); }
      catch { /* best effort */ }
    },

    startPresence() {
      if (!localBackend || presenceTimer) return;
      presenceTimer = setInterval(() => {
        api('/presence', { method: 'POST', body: JSON.stringify({ activityId }) }).catch(() => {});
      }, 30000);
    },
    stopPresence() { if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; } }
  };
}
