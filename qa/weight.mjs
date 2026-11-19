// Dev-only: bytes transferred on initial load (no scrolling) per page.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
const DIST = resolve('dist'), PORT = 4393, BASE = `http://localhost:${PORT}`;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  let f = join(DIST, decodeURIComponent(new URL(req.url, BASE).pathname));
  if ((await stat(f).catch(() => null))?.isDirectory()) f = join(f, 'index.html');
  try { const d = await readFile(f); res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'content-length': d.length }); res.end(d); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(PORT, r));
const b = await chromium.launch();
for (const path of ['/', '/projects/bat-wing-fsi/', '/projects/robotic-arm/', '/projects/otv/']) {
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  let local = 0, n = 0;
  let vid = 0; p.on('response', async (r) => { if (r.url().startsWith(BASE)) { const len = Number(r.headers()['content-length'] || 0); if (r.url().endsWith('.mp4')) vid += len; else { local += len; n++; } } });
  await p.goto(BASE + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  console.log(path.padEnd(26), `${(local / 1024).toFixed(0)} KB over ${n} requests, excluding video (+ Google Fonts)`);
  await p.close();
}
await b.close(); server.close();
