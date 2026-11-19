// Serves static/ locally the way Vercel will, to check the hosted build before deploying.
// Usage: npm run preview:static  ->  http://localhost:3001
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'static');
const PORT = Number(process.env.PREVIEW_PORT) || 3001;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://localhost').pathname;
  const file = path.normalize(path.join(DIR, p === '/' ? 'index.html' : p));
  const data = file.startsWith(DIR + path.sep) ? await fs.readFile(file).catch(() => null) : null;
  if (!data) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(data);
}).listen(PORT, () => console.log(`Static overlay preview: http://localhost:${PORT}/`));
