/*
 * Spiral Drop — platform adapter (StarHermit host integration).
 * Everything degrades gracefully to local/offline play:
 *  - server time sync via GET /api/v1/time with round-trip adjustment
 *  - score submission + leaderboards via /api/v1/scores
 *  - activity start/end heartbeats
 * Tokens come from the host shell (launch token in the URL), are never
 * persisted, and are only attached same-origin.
 */

const LAUNCH_TOKEN = (() => {
  try { return new URLSearchParams(location.search).get('launch') || null; }
  catch { return null; }
})();

let timeOffsetMs = 0; // serverTime - clientTime
let timeSynced = false;
let hosted = false;
let activityId = null;
let presenceTimer = null;

async function api(path, opts) {
  const headers = { 'Content-Type': 'application/json' };
  if (LAUNCH_TOKEN) headers['Authorization'] = 'Bearer ' + LAUNCH_TOKEN;
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

export function createPlatform() {
  return {
    get hosted() { return hosted; },
    get scope() {
      // game scope comes from the launch token payload, never hard-coded
      if (!LAUNCH_TOKEN) return null;
      try {
        const part = LAUNCH_TOKEN.split('.')[1];
        return JSON.parse(atob(part)).scope || null;
      } catch { return null; }
    },

    async init() {
      try {
        await this.syncTime();
        hosted = true;
      } catch {
        hosted = false; // offline / file:// — local play only
      }
      return hosted;
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

    async submitScore(envelope) {
      return api('/scores', { method: 'POST', body: JSON.stringify(envelope) });
    },

    async leaderboard(contentId, friendsOnly) {
      const q = '?content=' + encodeURIComponent(contentId) + (friendsOnly ? '&friends=1' : '');
      return api('/scores' + q);
    },

    async startActivity(mode, contentId) {
      if (!hosted) return null;
      try {
        const body = await api('/activity', { method: 'POST', body: JSON.stringify({ mode, contentId }) });
        activityId = body.activityId || null;
        this.startPresence();
        return activityId;
      } catch { return null; }
    },

    async endActivity() {
      this.stopPresence();
      if (!hosted || !activityId) return;
      const id = activityId;
      activityId = null;
      try { await api('/activity/' + encodeURIComponent(id) + '/end', { method: 'POST', body: '{}' }); }
      catch { /* best effort */ }
    },

    startPresence() {
      if (!hosted || presenceTimer) return;
      presenceTimer = setInterval(() => {
        api('/presence', { method: 'POST', body: JSON.stringify({ activityId }) }).catch(() => {});
      }, 30000);
    },
    stopPresence() { if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; } }
  };
}
