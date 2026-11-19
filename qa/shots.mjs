/**
 * Quick targeted screenshots of the built site: hero plus any element selectors.
 *   node qa/shots.mjs [theme] [selector ...]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const DIST = resolve('dist'); const OUT = resolve('qa/out'); const PORT = 4397; const BASE = `http://localhost:${PORT}`;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, BASE).pathname); let file = join(DIST, p);
  const s = await stat(file).catch(() => null); if (s?.isDirectory()) file = join(file, 'index.html');
  try { const d = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(d); } catch { res.writeHead(404); res.end(''); }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(OUT, { recursive: true });

const theme = process.argv[2] || 'dark';
const selectors = process.argv.slice(3);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: theme, reducedMotion: 'reduce' });
await page.goto(BASE + '/' + (process.env.PAGE || ''), { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, `shot-hero-${theme}.png`) });
for (const [i, sel] of selectors.entries()) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await el.screenshot({ path: join(OUT, `shot-${i}-${theme}.png`) });
  console.log(`shot-${i}-${theme}.png ← ${sel}`);
}
await browser.close(); server.close();
