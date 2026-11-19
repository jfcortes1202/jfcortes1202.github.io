// Dev-only: render public/images/og.png (1200×630) from the built hero.  node qa/og.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
const DIST = resolve('dist'), PORT = 4396, BASE = `http://localhost:${PORT}`;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  let f = join(DIST, decodeURIComponent(new URL(req.url, BASE).pathname));
  if ((await stat(f).catch(() => null))?.isDirectory()) f = join(f, 'index.html');
  try { const d = await readFile(f); res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); res.end(d); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(PORT, r));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'dark' });
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.addStyleTag({ content: '.nav,.hero__actions,.hero__social,.hero__figcaption{display:none!important}.hero{min-height:630px!important;padding-top:0!important}.hero__inner{padding:48px 64px!important;gap:40px!important}' });
await p.waitForTimeout(300);
await p.screenshot({ path: 'public/images/og.png' });
await b.close(); server.close();
console.log('wrote public/images/og.png');
