/**
 * Dev-only: pull the embedded preview bitmap out of SolidWorks files
 * (.SLDPRT/.SLDASM/.SLDDRW store a PNG preview of the last-saved view).
 *   node qa/sw-preview.mjs <outDir> <file ...>
 * Writes the largest embedded PNG per file; prints size or "none".
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { inflateRawSync, constants } from 'node:zlib';
import sharp from 'sharp';

const [, , outDir, ...files] = process.argv;
mkdirSync(outDir, { recursive: true });
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from('IEND');

// SolidWorks 2015+ stores streams raw-deflated; the preview is a PNG inside one.
function* candidatePngs(buf) {
  for (let i = buf.indexOf(SIG); i !== -1; i = buf.indexOf(SIG, i + 1)) {
    const end = buf.indexOf(IEND, i);
    if (end !== -1) yield buf.subarray(i, end + 8);
  }
  for (let i = 0; i < buf.length - 2; i++) {
    let out;
    try { out = inflateRawSync(buf.subarray(i, i + 4_000_000), { finishFlush: constants.Z_SYNC_FLUSH }); } catch { continue; }
    if (out.length > 1000 && out.subarray(0, 8).equals(SIG)) {
      const end = out.indexOf(IEND);
      if (end !== -1) yield out.subarray(0, end + 8);
    }
  }
}

for (const f of files) {
  const buf = readFileSync(f);
  let best = null;
  for (const png of candidatePngs(buf)) {
    try {
      const m = await sharp(png).metadata();
      if (!best || m.width * m.height > best.w * best.h) best = { png, w: m.width, h: m.height };
    } catch { /* not a valid PNG */ }
  }
  const name = basename(f).replace(/\.[^.]+$/, '');
  if (best) {
    writeFileSync(join(outDir, `${name}.png`), best.png);
    console.log(`${best.w}x${best.h}  ${name}`);
  } else console.log(`none  ${name}`);
}
