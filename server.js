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
  // Other versions of the lower third, picked with ?theme=<name> on the overlay URL.
  // sb = Sangguniang Bayan sessions: red and blue swapped.
  themes: {
    sb: { colors: { bar: '#0c2d6b', ticker: '#d7141a', clock: '#ef4146' } },
  },
  logoVersion: 0,

  // Speaker name plate
  speakerRoster: [
    { id: 's1', name: 'Hon. Danilo A. Villanueva', title: 'Municipal Vice Mayor', committees: [], viceCommittees: [] },
    { id: 's2', name: 'Hon. Ira Beatrice A. Ubana', title: 'Municipal Councilor', committees: ['Education, Arts and Culture', 'Tourism'], viceCommittees: ['Youth and Sports', 'Women, Children and Social Services'] },
    { id: 's3', name: 'Hon. Aristotle R. Yumul', title: 'Municipal Councilor', committees: ['Cooperatives', 'Human Rights'], viceCommittees: [] },
    { id: 's4', name: 'Hon. Rosemarie A. Olanda', title: 'Municipal Councilor', committees: ['Budget and Appropriation', 'Public Market and Slaughterhouse'], viceCommittees: ['Education, Arts and Culture', 'Environment and Land Use'] },
    { id: 's5', name: 'Hon. Adrian Donald L. Segui', title: 'Municipal Councilor', committees: ['Laws, Rules, Ethics, Privileges and Good Government', 'Peace and Order, Natural Calamities and Public Safety'], viceCommittees: ['Barangay Affairs', 'Ways and Means', 'Commerce, Trade and Industry', 'Human Rights', 'Public Utilities, Transportation and Communication'] },
    { id: 's6', name: 'Hon. Rembert A. Masaganda', title: 'Municipal Councilor', committees: ['Agriculture and Fisheries', 'Public Utilities, Transportation and Communication'], viceCommittees: ['Health and Sanitation'] },
    { id: 's7', name: 'Hon. Efren V. Paraiso', title: 'Municipal Councilor', committees: ['Health and Sanitation', 'Environment and Land Use'], viceCommittees: ['Budget and Appropriation', 'Infrastructure and Public Works', 'Agriculture and Fisheries', 'Cooperatives', 'Peace and Order, Natural Calamities and Public Safety', 'Tourism'] },
    { id: 's8', name: 'Hon. Sheree Ann S. Alivio', title: 'Municipal Councilor', committees: ['Commerce, Trade and Industry', 'Women, Children and Social Services'], viceCommittees: [] },
    { id: 's9', name: 'Hon. Castor R. Alano', title: 'Municipal Councilor', committees: ['Infrastructure and Public Works', 'Ways and Means'], viceCommittees: ['Public Market and Slaughterhouse', 'Laws, Rules, Ethics, Privileges and Good Government'] },
    { id: 's10', name: 'Hon. Joel T. Bile', title: 'Ex Officio Member, Pambayang Pederasyon ng mga Liga ng mga Barangay', committees: ['Barangay Affairs'], viceCommittees: [] },
    { id: 's11', name: 'Hon. Irish Kaye E. Argosino', title: 'Ex Officio Member, Pambayang Pederasyon ng Sangguniang Kabataan', committees: ['Youth and Sports'], viceCommittees: [] },
  ],
  speakerLive: { visible: false, name: '', title: '' },
  speakerAutoHide: 0, // seconds; 0 = stay until hidden
};

let state = structuredClone(DEFAULT_STATE);

async function loadState() {
  try {
    const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    state = deepMerge(structuredClone(DEFAULT_STATE), saved);
    delete state.committees; // older versions kept committees as a separate list
    // Older saved rosters lack (vice-)chairmanships: fill them in from the defaults by name.
    for (const p of state.speakerRoster || []) {
      const def = DEFAULT_STATE.speakerRoster.find((d) => d.name === p.name);
      if (!Array.isArray(p.committees)) p.committees = def?.committees ?? [];
      if (!Array.isArray(p.viceCommittees)) p.viceCommittees = def?.viceCommittees ?? [];
    }
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
  if (allowed.speakerLive) scheduleSpeakerAutoHide();
  saveState();
  broadcast({ type: 'state', state });
}

// Auto-hide runs on the server so it still works if the control panel is closed.
let speakerTimer;
function scheduleSpeakerAutoHide() {
  clearTimeout(speakerTimer);
  const secs = Number(state.speakerAutoHide) || 0;
  if (state.speakerLive?.visible && secs > 0) {
    speakerTimer = setTimeout(() => applyPatch({ speakerLive: { visible: false } }), secs * 1000);
  }
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
      const { logoVersion, speakerRoster } = state; // keep logo and edited roster
      state = structuredClone(DEFAULT_STATE);
      Object.assign(state, { logoVersion, speakerRoster });
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
      // No uploaded logo: use the bundled default, else the placeholder.
      const fallback = existsSync(path.join(PUBLIC_DIR, 'assets', 'logo.png')) ? '/assets/logo.png' : '/assets/logo-placeholder.svg';
      res.writeHead(302, { location: fallback });
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
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  [!] Port ${PORT} is already in use. SB Overlays is probably already running in another window.`);
    console.error(`      Close that window first, or set a different PORT in .env.\n`);
    process.exit(1);
  }
  throw err;
});
wss.on('error', () => {}); // listen errors are handled on `server` above
server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`\n  SB Overlays server running`);
  console.log(`  Overlay (OBS Browser Source, 1920x1080):  http://localhost:${PORT}/overlay`);
  console.log(`  Control panel:                            http://localhost:${PORT}/control`);
  for (const ip of lan) console.log(`  Control from another device:              http://${ip}:${PORT}/control`);
  console.log('');
});
