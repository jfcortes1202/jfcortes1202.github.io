/**
 * Visual + link + a11y QA for the built site (dist/). Dev-only.
 *
 *   npm run build && node qa/run.mjs
 *
 * Produces qa/out/*.png screenshots and prints a report.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const DIST = resolve('dist');
const OUT = resolve('qa/out');
const PORT = 4399;
const BASE = `http://localhost:${PORT}`;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain' };

// ---- Tiny static server for dist/ -------------------------------------
async function serve() {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    let file = join(DIST, p);
    try {
      const s = await stat(file).catch(() => null);
      if (s?.isDirectory()) file = join(file, 'index.html');
      else if (!s && !extname(file)) file = join(DIST, p + '.html');
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(await readFile(join(DIST, '404.html')).catch(() => 'not found'));
    }
  });
  await new Promise((r) => server.listen(PORT, r));
  return server;
}

// ---- Link crawl ---------------------------------------------------------
async function crawlLinks(page) {
  const pages = [];
  async function walk(dir, prefix = '') {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(join(dir, e.name), `${prefix}/${e.name}`);
      else if (e.name.endsWith('.html')) pages.push(`${prefix}/${e.name}`.replace(/\/index\.html$/, '/').replace(/^\/$/, '/'));
    }
  }
  await walk(DIST);
  const broken = [];
  const seen = new Set();
  for (const p of pages) {
    await page.goto(BASE + p, { waitUntil: 'load' });
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    for (const href of hrefs) {
      if (/^(mailto:|https?:|#)/.test(href)) continue;
      const [path, hash] = href.split('#');
      const target = path || p;
      const key = target + (hash ? '#' + hash : '');
      if (seen.has(key)) continue;
      seen.add(key);
      const res = await page.request.get(BASE + target);
      if (res.status() !== 200) { broken.push({ from: p, href, status: res.status() }); continue; }
      if (hash && !extname(target)) {
        await page.goto(BASE + target, { waitUntil: 'load' });
        const exists = await page.evaluate((h) => !!document.getElementById(h), hash);
        if (!exists) broken.push({ from: p, href, status: 'missing #' + hash });
      }
    }
  }
  return { pages, broken };
}

// ---- Contrast (WCAG) ----------------------------------------------------
function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); }
const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

async function contrastCheck(page) {
  // Sample representative text elements and resolve effective background by walking up.
  return page.evaluate(() => {
    const sel = ['p', 'h1', 'h2', 'h3', 'h4', 'a', 'li', 'span', 'button', 'figcaption', 'small', 'strong'];
    const out = [];
    const bgOf = (el) => {
      let e = el;
      while (e) {
        const bg = getComputedStyle(e).backgroundColor;
        if (bg && !bg.startsWith('rgba(0, 0, 0, 0)') && bg !== 'transparent') return bg;
        e = e.parentElement;
      }
      return 'rgb(255,255,255)';
    };
    for (const el of document.querySelectorAll(sel.join(','))) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || !el.textContent.trim()) continue;
      if (el.closest('svg')) continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      out.push({
        text: el.textContent.trim().slice(0, 40),
        color: cs.color, bg: bgOf(el), size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10),
        sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).join('.') : ''),
      });
    }
    return out;
  });
}

// ---- Main ---------------------------------------------------------------
const server = await serve();
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const report = { screenshots: [], broken: [], contrast: [], tab: [] };

try {
  // Screenshots: 1280 + 1920, dark + light, plus 768 and 360 dark for sanity
  for (const [w, h] of [[1280, 800], [1920, 1080], [768, 1024], [360, 780]]) {
    for (const theme of w >= 1280 ? ['dark', 'light'] : ['dark']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, reducedMotion: 'no-preference' });
      const page = await ctx.newPage();
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await page.waitForTimeout(3200); // let the hero sequence finish
      await page.screenshot({ path: join(OUT, `home-${w}-${theme}-hero.png`) });
      // Scroll through like a reader (wheel events) so every reveal fires, then full page
      const total = await page.evaluate(() => document.body.scrollHeight);
      await page.mouse.move(w / 2, h / 2);
      for (let y = 0; y < total; y += 300) { await page.mouse.wheel(0, 300); await page.waitForTimeout(120); }
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(OUT, `home-${w}-${theme}-full.png`), fullPage: true });
      report.screenshots.push(`home-${w}-${theme}`);
      if (w === 1280) {
        for (const [slug, name] of [['bat-wing-fsi', 'research'], ['robotic-arm', 'arm'], ['otv', 'otv'], ['truss', 'truss'], ['phone-stand', 'stand'], ['i-beam', 'ibeam'], ['geothermal', 'geo']]) {
          await page.goto(BASE + `/projects/${slug}/`, { waitUntil: 'networkidle' });
          const t2 = await page.evaluate(() => document.body.scrollHeight);
          await page.mouse.move(w / 2, h / 2);
          for (let y = 0; y < t2; y += 300) { await page.mouse.wheel(0, 300); await page.waitForTimeout(100); }
          await page.waitForTimeout(1500);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(1200);
          await page.screenshot({ path: join(OUT, `${name}-${w}-${theme}-full.png`), fullPage: true });
        }
        await page.goto(BASE + '/cv/', { waitUntil: 'networkidle' });
        await page.screenshot({ path: join(OUT, `cv-${w}-${theme}.png`) });
        await page.goto(BASE + '/404', { waitUntil: 'networkidle' });
        await page.screenshot({ path: join(OUT, `404-${w}-${theme}.png`) });
      }
      await ctx.close();
    }
  }

  // Every page: no failed requests (images, videos, posters, scripts) and every <img> decodes.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    report.failedRequests = [];
    report.brokenImages = [];
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/404')) report.failedRequests.push(`${r.status()} ${r.url().replace(BASE, '')} (on ${page.url().replace(BASE, '')})`); });
    for (const path of ['/', '/cv/', '/projects/bat-wing-fsi/', '/projects/robotic-arm/', '/projects/phone-stand/', '/projects/truss/', '/projects/otv/', '/projects/i-beam/', '/projects/geothermal/']) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      // Force every lazy image and every video poster/metadata to load
      await page.evaluate(async () => {
        document.querySelectorAll('img[loading="lazy"]').forEach((i) => (i.loading = 'eager'));
        await new Promise((r) => setTimeout(r, 1500));
      });
      await page.waitForLoadState('networkidle');
      const bad = await page.$$eval('img', (imgs) => imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')));
      bad.forEach((s) => report.brokenImages.push(`${s} (on ${path})`));
      const missingAlt = await page.$$eval('img', (imgs) => imgs.filter((i) => !i.hasAttribute('alt')).map((i) => i.getAttribute('src')));
      missingAlt.forEach((s) => report.brokenImages.push(`NO ALT ${s} (on ${path})`));
      const missingDims = await page.$$eval('main img, main video', (els) => els.filter((e) => !e.getAttribute('width') || !e.getAttribute('height')).map((e) => e.getAttribute('src')));
      missingDims.forEach((s) => report.brokenImages.push(`NO WIDTH/HEIGHT ${s} (on ${path})`));
      const videos = await page.$$eval('video', (vs) => vs.map((v) => ({ src: v.getAttribute('src'), poster: !!v.getAttribute('poster'), controls: v.controls, autoplay: v.autoplay, preload: v.preload })));
      videos.filter((v) => !v.poster || !v.controls || v.autoplay || v.preload !== 'metadata').forEach((v) => report.brokenImages.push(`VIDEO ATTRS ${JSON.stringify(v)} (on ${path})`));
    }
    // A video actually plays: seek and read a frame
    await page.goto(BASE + '/projects/bat-wing-fsi/', { waitUntil: 'networkidle' });
    report.videoPlays = await page.evaluate(async () => {
      const v = document.querySelector('video');
      v.preload = 'auto';
      await v.play().catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      return { t: v.currentTime.toFixed(2), w: v.videoWidth, h: v.videoHeight, err: v.error?.code ?? null };
    });
    // Carousel: next button + keyboard advance the counter
    await page.goto(BASE + '/projects/robotic-arm/', { waitUntil: 'networkidle' });
    const c = page.locator('#arm-parts');
    await c.scrollIntoViewIfNeeded();
    await c.locator('[data-next]').click();
    await page.waitForTimeout(700);
    const afterClick = await c.locator('[data-index]').textContent();
    await c.locator('.carousel__track').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(700);
    const afterKey = await c.locator('[data-index]').textContent();
    await c.locator('[data-goto="20"]').click();
    await page.waitForTimeout(900);
    const afterThumb = await c.locator('[data-index]').textContent();
    report.carousel = { afterClick, afterKey, afterThumb, caption: await c.locator('[data-caption-out]').textContent() };
    await c.screenshot({ path: join(OUT, 'carousel-arm-parts.png') });
    await ctx.close();
  }

  // Reduced motion: page must be complete at rest without waiting
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    const hidden = await page.$$eval('[data-reveal], .hero-ill, .hero__copy > *', (els) => els.filter((e) => getComputedStyle(e).opacity === '0').length);
    report.reducedMotionHidden = hidden;
    await page.screenshot({ path: join(OUT, 'home-1280-reduced-motion.png') });
    await ctx.close();
  }

  // Links, tab order, contrast (both themes)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const { pages, broken } = await crawlLinks(page);
  report.pages = pages;
  report.broken = broken;

  await page.goto(BASE + '/', { waitUntil: 'load' });
  const tab = [];
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    tab.push(await page.evaluate(() => {
      const a = document.activeElement;
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      return `${a.tagName.toLowerCase()}${a.className ? '.' + String(a.className).split(' ')[0] : ''} "${(a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 24)}" outline=${cs.outlineStyle}/${cs.outlineWidth} visible=${r.width > 0}`;
    }));
  }
  report.tab = tab;

  for (const theme of ['dark', 'light']) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme, reducedMotion: 'reduce' });
    const p = await c.newPage();
    for (const path of ['/', '/projects/bat-wing-fsi/']) {
      await p.goto(BASE + path, { waitUntil: 'load' });
      const samples = await contrastCheck(p);
      for (const s of samples) {
        const fg = parse(s.color), bg = parse(s.bg);
        if (fg.length < 3 || bg.length < 3) continue;
        const rr = ratio(fg, bg);
        const large = s.size >= 24 || (s.size >= 18.66 && s.weight >= 700);
        const need = large ? 3 : 4.5;
        if (rr < need) report.contrast.push({ theme, path, ...s, ratio: rr.toFixed(2), need });
      }
    }
    await c.close();
  }
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

// Dedupe contrast failures by selector+colors
const seen = new Set();
report.contrast = report.contrast.filter((c) => { const k = `${c.theme}|${c.sel}|${c.color}|${c.bg}`; if (seen.has(k)) return false; seen.add(k); return true; });

console.log('PAGES:', report.pages.join(' '));
console.log('SCREENSHOTS:', report.screenshots.join(' '));
console.log('BROKEN LINKS:', report.broken.length ? JSON.stringify(report.broken, null, 1) : 'none');
console.log('FAILED REQUESTS:', report.failedRequests.length ? '\n  ' + [...new Set(report.failedRequests)].join('\n  ') : 'none');
console.log('IMAGE/VIDEO ISSUES:', report.brokenImages.length ? '\n  ' + report.brokenImages.join('\n  ') : 'none');
console.log('VIDEO PLAYBACK:', JSON.stringify(report.videoPlays));
console.log('CAROUSEL (expect 2, 3, 21):', JSON.stringify(report.carousel));
console.log('REDUCED-MOTION HIDDEN ELEMENTS:', report.reducedMotionHidden);
console.log('TAB ORDER:'); report.tab.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
console.log('CONTRAST FAILURES:', report.contrast.length ? '' : 'none');
report.contrast.forEach((c) => console.log(`  [${c.theme} ${c.path}] ${c.sel} "${c.text}" ${c.color} on ${c.bg} = ${c.ratio} (need ${c.need})`));
