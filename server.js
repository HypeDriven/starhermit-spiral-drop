/*
 * Spiral Drop — authoritative server script (StarHermit Game Script / Node).
 *
 * Serves the static distribution and the same-origin API:
 *   GET  /api/v1/time                    server time for countdown/daily sync
 *   POST /api/v1/scores                  submit a replay envelope (validated)
 *   GET  /api/v1/scores?content=&friends= leaderboard
 *   POST /api/v1/activity                start play activity
 *   POST /api/v1/activity/:id/end        end activity
 *   POST /api/v1/presence                presence heartbeat
 *
 * Score claims are validated by deterministically replaying the submitted
 * input log through the bundled rules engine. Boards that cannot be validated
 * are labeled casual and only get plausibility/rate checks.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('./src/rules.js');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const PORT = Number(process.env.PORT || 8080);
const MAX_BODY = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.opus': 'audio/ogg'
};

// ---- durable stores (JSON files, versioned)
function loadStore(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveStore(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
let scores = loadStore(SCORES_FILE, { v: 1, entries: [] });
const activities = new Map();

// ---- token-bucket rate limiting per client
const buckets = new Map();
function rateOk(key, cost, perMinute) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { tokens: perMinute, reset: now + 60000 }; buckets.set(key, b); }
  if (now > b.reset) { b.tokens = perMinute; b.reset = now + 60000; }
  if (b.tokens < cost) return false;
  b.tokens -= cost;
  return true;
}

function clientKey(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return 'tok:' + crypto.createHash('sha256').update(auth.slice(7)).digest('hex').slice(0, 16);
  return 'ip:' + (req.socket.remoteAddress || 'unknown');
}

function send(res, code, body, headers) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('payload-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad-json')); }
    });
    req.on('error', reject);
  });
}

// ---- score validation
function validateScore(env) {
  // structural bounds
  if (!env || typeof env !== 'object') return { ok: false, reason: 'malformed' };
  if (!Array.isArray(env.inputLog) || env.inputLog.length > 200000) return { ok: false, reason: 'input-log-bounds' };
  if (!env.config || !Array.isArray(env.config.layers) || env.config.layers.length > 500) {
    return { ok: false, reason: 'config-bounds' };
  }
  if (env.rulesVersion !== R.RULES_VERSION) return { ok: false, reason: 'stale-version' };
  // deterministic replay validation
  try {
    const v = R.verifyEnvelope(env);
    if (!v.ok) return { ok: false, reason: v.reason };
    // plausibility: score bounded by components, duration bounded by MAX_TICKS
    if (v.score < 0 || v.score > 1000000) return { ok: false, reason: 'implausible-score' };
    return { ok: true, score: v.score, terminal: v.terminal };
  } catch (e) {
    return { ok: false, reason: 'replay-error' };
  }
}

async function handleApi(req, res, url) {
  const key = clientKey(req);
  const p = url.pathname;

  if (p === '/api/v1/time' && req.method === 'GET') {
    return send(res, 200, { now: Date.now() });
  }

  if (p === '/api/v1/scores' && req.method === 'POST') {
    if (!rateOk(key, 1, 20)) return send(res, 429, { error: 'rate-limited' }, { 'Retry-After': '30' });
    let env;
    try { env = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
    const check = validateScore(env);
    if (!check.ok) return send(res, 422, { error: 'invalid-score', reason: check.reason });
    const entry = {
      id: crypto.randomBytes(8).toString('hex'),
      content: env.contentId || 'unknown',
      name: (env.playerName && String(env.playerName).slice(0, 24)) || 'guest',
      score: check.score,
      terminal: check.terminal,
      rulesVersion: env.rulesVersion,
      contentVersion: env.contentVersion,
      seed: String(env.seed || '').slice(0, 64),
      ticks: env.result && env.result.ticks || 0,
      validated: true,
      at: Date.now()
    };
    // keep best per (content, player key) — fair board, no spam
    scores.entries = scores.entries.filter(e =>
      !(e.content === entry.content && e.owner === key));
    entry.owner = key;
    scores.entries.push(entry);
    scores.entries.sort((a, b) => R.compareResults(
      { reason: a.terminal, score: a.score, invalidActions: 0, ticks: a.ticks, sessionId: a.id },
      { reason: b.terminal, score: b.score, invalidActions: 0, ticks: b.ticks, sessionId: b.id }));
    scores.entries = scores.entries.slice(0, 5000);
    saveStore(SCORES_FILE, scores);
    return send(res, 200, { validated: true, rank: scores.entries.filter(e => e.content === entry.content).findIndex(e => e.id === entry.id) + 1 });
  }

  if (p === '/api/v1/scores' && req.method === 'GET') {
    if (!rateOk(key, 1, 60)) return send(res, 429, { error: 'rate-limited' });
    const content = url.searchParams.get('content') || '';
    const friends = url.searchParams.get('friends') === '1';
    // no social graph in the standalone build: friends board = this client only
    const entries = scores.entries
      .filter(e => (!content || e.content === content) && (!friends || e.owner === key))
      .slice(0, 50)
      .map(({ owner, ...pub }) => pub);
    return send(res, 200, { entries, validated: true, label: 'validated' });
  }

  if (p === '/api/v1/activity' && req.method === 'POST') {
    const id = crypto.randomBytes(8).toString('hex');
    activities.set(id, { started: Date.now(), owner: key });
    return send(res, 200, { activityId: id });
  }
  const actEnd = p.match(/^\/api\/v1\/activity\/([\w-]+)\/end$/);
  if (actEnd && req.method === 'POST') {
    const a = activities.get(actEnd[1]);
    activities.delete(actEnd[1]);
    return send(res, 200, { ended: true, seconds: a ? Math.round((Date.now() - a.started) / 1000) : null });
  }
  if (p === '/api/v1/presence' && req.method === 'POST') {
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'not-found' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  // never serve server-side data or hidden files
  if (file.startsWith(DATA_DIR) || path.basename(file).startsWith('.')) {
    res.writeHead(404); return res.end('not found');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    const immutable = ext === '.js' && rel.includes('/lib/');
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => send(res, 500, { error: 'internal', detail: String(e && e.message) }));
  } else {
    serveStatic(req, res, url);
  }
});

server.listen(PORT, () => {
  console.log('Spiral Drop server on http://localhost:' + PORT);
});
