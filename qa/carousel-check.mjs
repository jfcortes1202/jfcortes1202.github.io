// Dev-only: does a carousel keep its position after a thumbnail jump?
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
const DIST = resolve('dist'), PORT = 4394, BASE = `http://localhost:${PORT}`;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  let f = join(DIST, decodeURIComponent(new URL(req.url, BASE).pathname));
  if ((await stat(f).catch(() => null))?.isDirectory()) f = join(f, 'index.html');
  try { const d = await readFile(f); res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); res.end(d); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(PORT, r));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: process.argv[2] === 'reduce' ? 'reduce' : 'no-preference' });
await p.goto(BASE + '/projects/robotic-arm/', { waitUntil: 'networkidle' });
const c = p.locator('#arm-parts');
await c.scrollIntoViewIfNeeded();
const state = () => c.evaluate((el) => ({ idx: el.querySelector('[data-index]').textContent, left: Math.round(el.querySelector('.carousel__track').scrollLeft), cap: el.querySelector('[data-caption-out]').textContent }));
await c.locator('[data-goto="20"]').click(); await p.waitForTimeout(1200);
console.log('after thumb   ', JSON.stringify(await state()));
await p.waitForTimeout(1500);
console.log('1.5 s later   ', JSON.stringify(await state()));
await c.screenshot({ path: 'qa/out/carousel-check.png' });
console.log('after shot    ', JSON.stringify(await state()));
await p.setViewportSize({ width: 1000, height: 900 }); await p.waitForTimeout(800);
console.log('after resize  ', JSON.stringify(await state()));
await b.close(); server.close();
