// Dev-only: confirm every published MP4 decodes and plays in a codec-complete browser (Edge).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import manifest from '../src/data/media.json' with { type: 'json' };
const DIST = resolve('dist'), PORT = 4395, BASE = `http://localhost:${PORT}`;
const MIME = { '.html': 'text/html', '.mp4': 'video/mp4', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  let f = join(DIST, decodeURIComponent(new URL(req.url, BASE).pathname));
  if ((await stat(f).catch(() => null))?.isDirectory()) f = join(f, 'index.html');
  try { const d = await readFile(f); res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'accept-ranges': 'bytes' }); res.end(d); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(PORT, r));
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage();
await p.goto(BASE + '/404.html');
const vids = Object.keys(manifest).filter((k) => k.endsWith('.mp4'));
for (const src of vids) {
  const r = await p.evaluate(async (src) => {
    const v = document.createElement('video'); v.muted = true; v.src = src; document.body.append(v);
    await v.play().catch((e) => {});
    await new Promise((r) => setTimeout(r, 1200));
    const out = { t: +v.currentTime.toFixed(2), size: `${v.videoWidth}x${v.videoHeight}`, err: v.error?.code ?? null };
    v.remove(); return out;
  }, src);
  console.log(r.err === null && r.t > 0.3 ? 'PLAYS' : 'FAIL ', src, JSON.stringify(r));
}
await b.close(); server.close();
