import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LOGO_FILE = path.join(DATA_DIR, 'logo');
const PORT = Number(process.env.PORT) || 3000;

const DEFAULT_STATE = {
  visible: true,
  liveLabel: 'LIVE',
  title: 'MAGNOLIA DISTRICT ASSEMBLY',
  showClock: true,
  timeZone: 'Asia/Manila',
  showSocial: true,
  social: {
    website: 'livelopez.gov.ph',
    youtube: 'Municipality of Lopez, Quezon',
    facebook: 'municipalityoflopez.quezon',
    instagram: 'municipalityoflopezquezon',
  },
  tickerVisible: true,
  tickerItems: [
    '#LIVELopez #MunicipalityofLopez #DistrictAssembly #DistrictMagnolia',
  ],
  tickerSeparator: '•',
  tickerSpeed: 110,
  colors: {
    bar: '#d7141a',
    ticker: '#0c2d6b',
    clock: '#1d5fc4',
  },
  logoVersion: 0,
};

let state = structuredClone(DEFAULT_STATE);

async function loadState() {
  try {
    const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    state = deepMerge(structuredClone(DEFAULT_STATE), saved);
  } catch {
    state = structuredClone(DEFAULT_STATE);
  }
}

let saveTimer;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  }, 200);
}

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

function applyPatch(patch) {
  const allowed = Object.fromEntries(
    Object.entries(patch ?? {}).filter(([k]) => k in DEFAULT_STATE),
  );
  deepMerge(state, allowed);
  saveState();
  broadcast({ type: 'state', state });
}

// ---------- Facebook ----------
async function fetchFacebookPosts(limit = 10) {
  const pageId = process.env.FB_PAGE_ID;
  const token = process.env.FB_PAGE_TOKEN;
  const version = process.env.FB_API_VERSION || 'v23.0';
  if (!pageId || !token) {
    const err = new Error('Facebook is not configured. Set FB_PAGE_ID and FB_PAGE_TOKEN in .env, then restart.');
    err.status = 400;
    throw err;
  }
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/posts`);
  url.searchParams.set('fields', 'message,created_time,permalink_url');
  url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 50)));
  url.searchParams.set('access_token', token);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Facebook API error ${res.status}`);
    err.status = 502;
    throw err;
  }
  return (body.data || [])
    .filter((p) => p.message)
    .map((p) => ({
      id: p.id,
      created: p.created_time,
      url: p.permalink_url,
      message: p.message,
    }));
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const ROUTES = { '/': '/control.html', '/overlay': '/overlay.html', '/control': '/control.html' };

function sendJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function readBody(req, max = 5 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const LOGO_TYPES = { 'image/png': true, 'image/jpeg': true, 'image/webp': true, 'image/svg+xml': true };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/api/state' && req.method === 'GET') return sendJson(res, 200, state);
    if (p === '/api/state' && req.method === 'POST') {
      applyPatch(JSON.parse((await readBody(req)).toString('utf8') || '{}'));
      return sendJson(res, 200, state);
    }
    if (p === '/api/reset' && req.method === 'POST') {
      const logoVersion = state.logoVersion;
      state = structuredClone(DEFAULT_STATE);
      state.logoVersion = logoVersion;
      saveState();
      broadcast({ type: 'state', state });
      return sendJson(res, 200, state);
    }
    if (p === '/api/facebook/posts' && req.method === 'GET') {
      const posts = await fetchFacebookPosts(Number(url.searchParams.get('limit')) || 10);
      return sendJson(res, 200, { posts });
    }
    if (p === '/api/facebook/status' && req.method === 'GET') {
      return sendJson(res, 200, { configured: Boolean(process.env.FB_PAGE_ID && process.env.FB_PAGE_TOKEN) });
    }
    if (p === '/api/logo' && req.method === 'POST') {
      const type = (req.headers['content-type'] || '').split(';')[0];
      if (!LOGO_TYPES[type]) return sendJson(res, 415, { error: 'Use PNG, JPG, WEBP or SVG' });
      const buf = await readBody(req);
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(LOGO_FILE, buf);
      await fs.writeFile(LOGO_FILE + '.type', type);
      applyPatch({ logoVersion: Date.now() });
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/logo' && req.method === 'GET') {
      if (existsSync(LOGO_FILE)) {
        const type = await fs.readFile(LOGO_FILE + '.type', 'utf8').catch(() => 'image/png');
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
        return res.end(await fs.readFile(LOGO_FILE));
      }
      res.writeHead(302, { location: '/assets/logo-placeholder.svg' });
      return res.end();
    }

    // static files
    const rel = ROUTES[p] || p;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
    const data = await fs.readFile(file).catch(() => null);
    if (!data) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  } catch (err) {
    sendJson(res, err.status || 500, { error: err.message });
  }
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1) c.send(data);
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', state }));
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'patch') applyPatch(msg.patch);
    } catch {
      /* ignore malformed */
    }
  });
});

await loadState();
server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`\n  Lower third server running`);
  console.log(`  Overlay (OBS Browser Source, 1920x1080):  http://localhost:${PORT}/overlay`);
  console.log(`  Control panel:                            http://localhost:${PORT}/control`);
  for (const ip of lan) console.log(`  Control from another device:              http://${ip}:${PORT}/control`);
  console.log('');
});
