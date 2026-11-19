// Copies the shared overlay script and styles into static/ for the hosted (Vercel) build.
// public/ stays the single source of truth; the copies are git-ignored.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['overlay.js', 'overlay.css']) {
  fs.copyFileSync(path.join(ROOT, 'public', f), path.join(ROOT, 'static', f));
  console.log(`copied public/${f} -> static/${f}`);
}
