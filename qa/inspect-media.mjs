/**
 * Dev-only: render contact sheets of media/ so files can be reviewed visually.
 *   node qa/inspect-media.mjs video <file> [cols]   → frames at 5 points in time
 *   node qa/inspect-media.mjs pdf <file> [maxPages] → page grid + text of page 1
 *   node qa/inspect-media.mjs image <file>
 * Output: qa/out/inspect/<slug>.png (gitignored)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const OUT = 'qa/out/inspect';
mkdirSync(OUT, { recursive: true });
const [, , kind, file, arg] = process.argv;
const slug = basename(file).replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60);

async function grid(buffers, cols, tileW) {
  const tiles = await Promise.all(buffers.map((b) => sharp(b).resize({ width: tileW }).png().toBuffer()));
  const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
  const tileH = Math.max(...metas.map((m) => m.height));
  const rows = Math.ceil(tiles.length / cols);
  const gap = 6;
  const canvas = sharp({ create: { width: cols * tileW + (cols + 1) * gap, height: rows * tileH + (rows + 1) * gap, channels: 3, background: '#444' } });
  return canvas.composite(tiles.map((t, i) => ({ input: t, left: gap + (i % cols) * (tileW + gap), top: gap + Math.floor(i / cols) * (tileH + gap) }))).png().toBuffer();
}

if (kind === 'video') {
  const dur = Number(execFileSync(ffprobeStatic.path, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  const tmp = join(OUT, '_frames'); rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp);
  const pts = [0.03, 0.25, 0.5, 0.75, 0.97];
  const frames = pts.map((p, i) => {
    const o = join(tmp, `${i}.png`);
    execFileSync(ffmpeg, ['-v', 'error', '-ss', String(dur * p), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', o]);
    return readFileSync(o);
  });
  writeFileSync(join(OUT, `${slug}.png`), await grid(frames, Number(arg || 3), 420));
  console.log(`${dur.toFixed(1)}s →`, join(OUT, `${slug}.png`));
} else if (kind === 'pdf') {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(readFileSync(file), 'application/pdf');
  const n = doc.countPages();
  const max = Math.min(n, Number(arg || 6));
  const pages = [];
  for (let i = 0; i < max; i++) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(mupdf.Matrix.scale(0.8, 0.8), mupdf.ColorSpace.DeviceRGB, false, true);
    pages.push(Buffer.from(pix.asPNG()));
  }
  writeFileSync(join(OUT, `${slug}.png`), await grid(pages, Math.min(max, 3), 420));
  const text = doc.loadPage(0).toStructuredText('preserve-whitespace').asText().replace(/\s+/g, ' ').slice(0, 600);
  console.log(`${n} pages →`, join(OUT, `${slug}.png`), '\nP1 TEXT:', text);
} else if (kind === 'image') {
  const m = await sharp(file).metadata();
  await sharp(file).resize({ width: 900, withoutEnlargement: true }).png().toFile(join(OUT, `${slug}.png`));
  console.log(`${m.width}x${m.height} ${m.format} exif=${!!m.exif} →`, join(OUT, `${slug}.png`));
}
