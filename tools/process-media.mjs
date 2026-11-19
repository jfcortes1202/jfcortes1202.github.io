/**
 * Turn Juan's raw `media/` folder into web-ready files under `public/`.
 *
 *   node tools/process-media.mjs            # process everything
 *   node tools/process-media.mjs research   # only jobs whose name starts with "research"
 *
 * - Images → WebP (q82), resized for their slot, metadata stripped (sharp drops
 *   EXIF/GPS by default).
 * - Videos → H.264 MP4 (yuv420p, +faststart), audio removed, plus a WebP poster.
 * - PDFs   → copied, or rebuilt lean when the source embeds video.
 * - CAD    → isometric renders / drawings pulled from the team's PDFs, and the
 *            preview bitmap SolidWorks stores inside .SLDDRW files.
 *
 * Writes src/data/media.json: every output's path, width and height, so pages
 * can set width/height attributes and avoid layout shift.
 * `media/` is gitignored; only the outputs in public/ are committed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync, constants as zc } from 'node:zlib';
import sharp from 'sharp';
import * as mupdf from 'mupdf';
import ffmpeg from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const M = 'media';
const PUB = 'public';
const MANIFEST = 'src/data/media.json';
const only = process.argv[2] || '';
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const log = (...a) => console.log(...a);

const ensure = (p) => mkdirSync(dirname(p), { recursive: true });
const kb = (p) => `${Math.round(statSync(p).size / 1024)} KB`;
const record = async (out, extra = {}) => {
  const key = '/' + out.slice(PUB.length + 1).replace(/\\/g, '/');
  if (/\.(webp|png|jpe?g)$/.test(out)) {
    const m = await sharp(out).metadata();
    manifest[key] = { w: m.width, h: m.height, ...extra };
  } else manifest[key] = { ...extra };
  return key;
};

// ---------- Images --------------------------------------------------------
/**
 * @param input  path or Buffer
 * @param out    public/... .webp
 * @param o.width  max width
 * @param o.trim   trim uniform border (white) first
 * @param o.canvas [w,h] pad onto a white canvas of this aspect after trimming
 */
async function image(input, out, o = {}) {
  ensure(out);
  let img = sharp(input, { animated: false }).rotate(); // apply EXIF orientation, then drop EXIF
  if (o.crop) { // fractional [x0, y0, x1, y1], e.g. to drop a stray axis triad
    const m = await sharp(await img.toBuffer()).metadata();
    const [x0, y0, x1, y1] = o.crop;
    img = sharp(await img.extract({ left: Math.round(x0 * m.width), top: Math.round(y0 * m.height), width: Math.round((x1 - x0) * m.width), height: Math.round((y1 - y0) * m.height) }).toBuffer());
  }
  if (o.trim) {
    img = sharp(await img.flatten({ background: '#ffffff' }).trim({ background: '#ffffff', threshold: 12 }).toBuffer());
  }
  if (o.canvas) {
    const [cw, ch] = o.canvas;
    const pad = o.pad ?? 0.08;
    const inner = await img.resize({ width: Math.round(cw * (1 - 2 * pad)), height: Math.round(ch * (1 - 2 * pad)), fit: 'inside', withoutEnlargement: false }).toBuffer();
    img = sharp({ create: { width: cw, height: ch, channels: 3, background: o.bg || '#ffffff' } }).composite([{ input: inner, gravity: 'centre' }]);
    img = sharp(await img.png().toBuffer());
  } else if (o.width) {
    img = img.resize({ width: o.width, withoutEnlargement: true });
  }
  await img.webp({ quality: o.quality ?? 82, effort: 5 }).toFile(out);
  const key = await record(out, o.alt ? { alt: o.alt } : {});
  log('  img', key, kb(out));
  return key;
}

// ---------- Video ---------------------------------------------------------
const probe = (f) => {
  const j = JSON.parse(execFileSync(ffprobeStatic.path, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', f]).toString());
  return { dur: Number(j.format.duration), v: j.streams.find((s) => s.codec_type === 'video') };
};
/**
 * @param o.width  output width (height auto, even)
 * @param o.crop   ffmpeg crop expression, applied before scaling
 * @param o.crf    quality (lower = better)
 * @param o.poster fraction of duration to grab the poster frame from
 */
async function video(src, out, o = {}) {
  ensure(out);
  const { dur } = probe(src);
  // Normalise to square pixels first (screen recordings can carry a non-1:1 SAR), then size.
  const vf = [o.crop && `crop=${o.crop}`, 'scale=trunc(iw*sar/2)*2:ih,setsar=1', `scale=${o.width || 1280}:-2:flags=lanczos`, 'format=yuv420p'].filter(Boolean).join(',');
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', src, '-an', '-vf', vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf ?? 26),
    '-profile:v', 'high', '-movflags', '+faststart', '-r', '30', out]);
  const posterPng = out.replace(/\.mp4$/, '.poster.png');
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-ss', String(dur * (o.poster ?? 0.4)), '-i', out, '-frames:v', '1', posterPng]);
  const poster = await image(posterPng, out.replace(/\.mp4$/, '.webp'), {});
  execFileSync(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'del', posterPng.replace(/\//g, '\\')] : [posterPng]);
  const m = await sharp(join(PUB, poster)).metadata();
  const key = await record(out, { w: m.width, h: m.height, poster, duration: Math.round(dur * 10) / 10 });
  log('  vid', key, kb(out), `${dur.toFixed(1)}s`);
  return key;
}

// ---------- PDF -----------------------------------------------------------
const openPdf = (f) => mupdf.Document.openDocument(readFileSync(f), 'application/pdf');

/** Largest (or n-th largest) raster image placed on a page, as PNG buffer. */
function pdfImage(doc, pageNo, rank = 0) {
  const imgs = [];
  doc.loadPage(pageNo - 1).run(new mupdf.Device({
    fillImage(img) { imgs.push(img); },
  }), mupdf.Matrix.identity);
  imgs.sort((a, b) => b.getWidth() * b.getHeight() - a.getWidth() * a.getHeight());
  if (!imgs[rank]) throw new Error(`no image #${rank} on page ${pageNo}`);
  return Buffer.from(imgs[rank].toPixmap().asPNG());
}

/** Render a page (optionally a fractional crop [x0,y0,x1,y1]) as PNG buffer. */
async function pdfRender(doc, pageNo, scale = 2.5, crop) {
  const pix = doc.loadPage(pageNo - 1).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  let buf = Buffer.from(pix.asPNG());
  if (crop) {
    const m = await sharp(buf).metadata();
    const [x0, y0, x1, y1] = crop;
    buf = await sharp(buf).extract({ left: Math.round(x0 * m.width), top: Math.round(y0 * m.height), width: Math.round((x1 - x0) * m.width), height: Math.round((y1 - y0) * m.height) }).png().toBuffer();
  }
  return buf;
}

function copyPdf(src, out) {
  ensure(out);
  copyFileSync(src, out);
  log('  pdf', out, kb(out));
  return record(out);
}

/** Rebuild a PDF from page renders (used when the source embeds video). */
async function rasterPdf(src, out, scale = 4, quality = 80) {
  ensure(out);
  const doc = openPdf(src);
  const pdf = new mupdf.PDFDocument();
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const png = Buffer.from(page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
    const jpg = await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
    const ref = pdf.addImage(new mupdf.Image(jpg));
    const res = pdf.addObject({ XObject: { I0: ref } });
    const w = x1 - x0, h = y1 - y0;
    pdf.insertPage(-1, pdf.addPage([0, 0, w, h], 0, res, `q ${w} 0 0 ${h} 0 0 cm /I0 Do Q`));
  }
  writeFileSync(out, pdf.saveToBuffer('compress,garbage').asUint8Array());
  log('  pdf', out, kb(out), `(rebuilt from ${doc.countPages()} page renders)`);
  return record(out);
}

// ---------- SolidWorks embedded preview ----------------------------------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function swPreview(file) {
  const buf = readFileSync(file);
  let best = null;
  for (let i = 0; i < buf.length - 2; i++) {
    let out;
    try { out = inflateRawSync(buf.subarray(i, i + 4_000_000), { finishFlush: zc.Z_SYNC_FLUSH }); } catch { continue; }
    if (out.length > 1000 && out.subarray(0, 8).equals(PNG_SIG)) {
      const end = out.indexOf('IEND');
      const png = out.subarray(0, end + 8);
      if (!best || png.length > best.length) best = png;
    }
  }
  if (!best) throw new Error('no preview in ' + file);
  return best;
}

// ---------- Office (zip) entry -------------------------------------------
function zipEntry(file, name) {
  const b = readFileSync(file);
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = b.readUInt32LE(eocd + 16);
  for (let i = 0; i < b.readUInt16LE(eocd + 10); i++) {
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20);
    const nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    if (b.subarray(p + 46, p + 46 + nl).toString() === name) {
      const lnl = b.readUInt16LE(off + 26), lxl = b.readUInt16LE(off + 28);
      const data = b.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
      return method ? inflateRawSync(data) : data;
    }
    p += 46 + nl + xl + cl;
  }
  throw new Error(`${name} not in ${file}`);
}

// ======================================================================
// Jobs
// ======================================================================
const R = `${M}/Research (UTSI)`;
const API = `${M}/Accesible Prosthetic Initiative (API)`;
const OTV = `${M}/ENES100 - Over Terrain Vehicle Project`;
const TRUSS = `${M}/ENES102 Truss Team Project`;
const BEAM = `${M}/ENES220 - I-Beam Project`;
const GEO = `${M}/ENES232 - Geothermal Heat Pump Project`;
const CAD = `${M}/ENME272 - Introduction to Computer Aided Design`;
const TEAM = `${CAD}/Team Project/Section 0301 - Team 5-20251210T035036Z-3-001`;
const P = (s) => join(PUB, 'media', s);

const jobs = {
  async about() {
    await image(`${M}/Headshot/prom picture.jfif`, P('about/headshot.webp'), { width: 600 });
  },

  async research() {
    await image(`${R}/research presentation image.jfif`, P('research/utsi-presentation.webp'), { width: 800 });
    const deck = openPdf(`${R}/Juan_Cortes_Final_Research_Presentation.pdf`);
    await image(pdfImage(deck, 12), P('research/bat-wing-mesh.webp'), { width: 1200, trim: true });
    const clips = [
      ['slide06_2D_flows', 1280], ['slide07_vorticity_Re100_over_Re1000', 1000], ['slide09_flat_sheet', 1280],
      ['slide10_punctured_sheet', 1280], ['slide11_punctured_sheet_vorticity', 1280], ['slide13_bat_wing_overview', 1280],
      ['slide14_punctured_bat_wing', 1280], ['slide17_kinematics_mesh_and_wingtip', 1600], ['slide18_realistic_perforations', 1280],
      ['slide21_injury_severity_2x2', 1920],
    ];
    // Dense vector-glyph clips compress poorly; give them smaller frames and a higher CRF.
    const heavy = { slide11_punctured_sheet_vorticity: { width: 960, crf: 31 }, slide14_punctured_bat_wing: { width: 1100, crf: 30 } };
    for (const [name, width] of clips) {
      if (only.startsWith('research:') && !name.includes(only.split(':')[1])) continue;
      const slug = name.replace(/^slide\d+_/, '').replace(/_/g, '-').toLowerCase();
      await video(`${R}/${name}.mp4`, P(`research/video/${slug}.mp4`), { width, crf: 26, poster: 0.55, ...heavy[name] });
    }
  },

  async researchdeck() {
    await rasterPdf(`${R}/Juan_Cortes_Final_Research_Presentation.pdf`, join(PUB, 'cv/bat-flight-presentation.pdf'), 3.2, 78);
  },

  async prosthetics() {
    await video(`${API}/new_prosthetic_hand_prototype_test_1.MOV`, P('prosthetics/hand-test.mp4'), { width: 720, crf: 28, poster: 0.5 });
  },

  async otv() {
    await image(`${OTV}/ENES102 - Group Photo.png`, P('otv/team.webp'), { width: 1200 });
    await video(`${OTV}/OTV_TEST_2.mov`, P('otv/test-run.mp4'), { width: 720, crf: 28, poster: 0.3 });
    const briefs = openPdf(`${OTV}/Final Design Briefs ENES100.pdf`);
    await image(pdfImage(briefs, 3), P('otv/prototype-cad.webp'), { canvas: [1200, 900], trim: true });
    const ms2 = openPdf(`${OTV}/MS2 - Design Review Presentation-19-21-1-2 ENES100.pdf`);
    for (const n of [1, 2]) await image(await pdfRender(ms2, n, 2.2), P(`otv/magnet-detection-${n}.webp`), { width: 1400 });
    await copyPdf(`${OTV}/Final Design Briefs ENES100.pdf`, join(PUB, 'docs/otv/final-design-briefs.pdf'));
  },

  async ibeam() {
    const doc = openPdf(`${BEAM}/Final Design Report - The Beam Team - Team 6 ENES220.pdf`);
    const figs = [
      ['cross-section', 5, 0], ['drawing', 6, 0], ['shear-force', 7, 0], ['bending-moment', 7, 1],
      ['deflection', 10, 0], ['after-test-section', 11, 0], ['after-test', 12, 1],
    ];
    for (const [name, page, rank] of figs) await image(pdfImage(doc, page, rank), P(`i-beam/${name}.webp`), { canvas: [1200, 900], trim: true });
    await copyPdf(`${BEAM}/Final Design Report - The Beam Team - Team 6 ENES220.pdf`, join(PUB, 'docs/i-beam/final-design-report.pdf'));
  },

  async geothermal() {
    const pptx = `${GEO}/Deliverables/Geothermal Heat Pump Design Presentation.pptx`;
    const figs = [['cycle-summer', 'image5.jpg'], ['cycle-winter', 'image8.jpg'], ['ts-summer', 'image2.png'], ['ts-winter', 'image1.png']];
    for (const [name, file] of figs) await image(zipEntry(pptx, `ppt/media/${file}`), P(`geothermal/${name}.webp`), { canvas: [1200, 900], trim: true });
    await copyPdf(`${GEO}/Deliverables/Final Report - Team 4 ENES232.pdf`, join(PUB, 'docs/geothermal/final-report.pdf'));
  },

  async truss() {
    const pptx = `${TRUSS}/Truss Projects.pptx`;
    for (const [name, file] of [['team', 'image14.jpg'], ['finished', 'image15.jpg'], ['testing', 'image16.jpg']]) {
      await image(zipEntry(pptx, `ppt/media/${file}`), P(`truss/${name}.webp`), { width: 1200 });
    }
    const dwgs = [['assembly', 'Truss Assembly Drawing'], ['horizontal-members', 'Horizontal Members Drawing'], ['vertical-members', 'Vertical Members Drawing'], ['diagonal-members', 'Diagonal Members Drawing'], ['gussets', 'Gussets Drawing']];
    for (const [name, file] of dwgs) await image(swPreview(`${TRUSS}/Truss CAD/${file}.SLDDRW`), P(`truss/drawing-${name}.webp`), {});
    await copyPdf(`${TRUSS}/Truss Analysis Group 9 0104.pdf`, join(PUB, 'docs/truss/truss-analysis.pdf'));
  },

  async arm() {
    const deck = openPdf(`${TEAM}/Project Presentation ENME272.pdf`);
    // Assembly-level views
    // The full-assembly render carries a stray edge line and the SolidWorks axis triad on its left; crop them off.
    for (const [name, page, crop] of [['assembly', 5, [0.14, 0, 1, 1]], ['exploded', 8], ['base-subassembly', 11], ['gripper-subassembly', 12]]) {
      await image(pdfImage(deck, page), P(`robotic-arm/assembly/${name}.webp`), { canvas: [1200, 900], trim: true, pad: 0.06, crop });
    }
    // One isometric render per part: even pages 14–62 (the following odd page is its drawing), plus p64.
    const parts = ['Bolt', 'Clip', 'Cross base motor', 'Cross base', 'Extrusion, horizontal 400 mm', 'Extrusion, horizontal 450 mm', 'Extrusion, vertical',
      'Fasteners', 'Gear', 'Gripper arm', 'Lego hand support', 'Motor', 'Screw for gear', 'Servo pin', 'Servo', 'Arch', 'Arm connector, long',
      'Arm connector, short', 'Cross base motor 2', 'External support, long', 'External support, straight', 'Inner middle bar', 'Middle bar',
      'Fastener and servo holder', 'Motor holder'];
    // From the Arch slide (p44) on, the largest embedded raster on a render slide is a
    // hidden drawing, so those slides are rendered and cropped to the content area instead.
    const renderSlide = async (page) => pdfRender(deck, page, 3.5, [0.2, 0.09, 0.8, 0.885]);
    const list = [];
    parts.push('Gripper mount');
    for (const [i, name] of parts.entries()) {
      const page = 14 + i * 2;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
      const src = page >= 44 ? await renderSlide(page) : pdfImage(deck, page);
      const key = await image(src, P(`robotic-arm/parts/${String(i + 1).padStart(2, '0')}-${slug}.webp`), { canvas: [1200, 900], trim: true, pad: 0.12 });
      list.push({ key, name });
    }
    manifest['@arm-parts'] = list;
    // Drawings (vector PDFs → render)
    const dir = `${TEAM}/Section 0301 - Team 5/Drawing PDFS`;
    const drawings = ['Isometric View', 'BOM', 'Arch', 'Arm Connector Long', 'Arm Connector Short', 'Bolt', 'Clip', 'Cross Base', 'Cross Base Motor', 'Cross Base Motor 2',
      'External Support Long', 'External Support Straight', 'Extrusion Horizontal 400', 'Extrusion Horizontal 450', 'Extrusion Vertical', 'Fastener and Servo Holder',
      'Fasteners', 'Gear', 'Gripper Arm', 'Gripper Mount', 'Inner Middle Bar', 'Lego Hand Support', 'Middle Bar', 'Motor', 'Motor Holder', 'Screw for Gear', 'Servo', 'Servo Pin'];
    const dl = [];
    for (const name of drawings) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const key = await image(await pdfRender(openPdf(`${dir}/${name}.pdf`), 1, 2.6), P(`robotic-arm/drawings/${slug}.webp`), { width: 1600 });
      dl.push({ key, name: name === 'BOM' ? 'Exploded view and bill of materials' : name === 'Isometric View' ? 'Assembly, four views' : name });
    }
    manifest['@arm-drawings'] = dl;
    // Motion study animation: the arm sits in the middle third of a wide, mostly empty frame.
    await video(`${TEAM}/Section 0301 - Team 5.mp4`, P('robotic-arm/animation.mp4'), { crop: '760:712:580:0', width: 760, crf: 24, poster: 0.85 });
  },

  async stand() {
    const doc = openPdf(`${CAD}/Individual Design Project/Individual Design Project .pdf`);
    await image(pdfImage(doc, 1, 0), P('phone-stand/render-iso.webp'), { canvas: [1200, 900], trim: true });
    await image(pdfImage(doc, 1, 1), P('phone-stand/render-front.webp'), { canvas: [1200, 900], trim: true });
    await image(pdfImage(doc, 3, 0), P('phone-stand/drawing.webp'), { width: 1400 });
    await image(pdfImage(doc, 5, 0), P('phone-stand/printed-front.webp'), { width: 900 });
    await image(pdfImage(doc, 5, 1), P('phone-stand/printed-side.webp'), { width: 900 });
    await image(pdfImage(doc, 6, 0), P('phone-stand/printed-hand-1.webp'), { width: 900 });
    await image(pdfImage(doc, 6, 1), P('phone-stand/printed-hand-2.webp'), { width: 900 });
  },

  /** Rebuild width/height/poster entries for everything already in public/ (no re-encoding). */
  async scan() {
    const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])) : []);
    for (const f of [...walk(join(PUB, 'media')), ...walk(join(PUB, 'docs')), ...walk(join(PUB, 'cv'))]) {
      if (f.endsWith('.mp4')) {
        const { dur, v } = probe(f);
        const poster = '/' + f.slice(PUB.length + 1).replace(/\\/g, '/').replace(/\.mp4$/, '.webp');
        await record(f, { w: v.width, h: v.height, poster, duration: Math.round(dur * 10) / 10 });
      } else if (/\.(webp|png|jpe?g|pdf)$/.test(f)) {
        const key = '/' + f.slice(PUB.length + 1).replace(/\\/g, '/');
        await record(f, manifest[key]?.alt ? { alt: manifest[key].alt } : {});
      }
    }
    log('  scanned', Object.keys(manifest).length, 'entries');
  },

  async site() {
    // Apple touch icon from the existing favicon (JC monogram), not from a photo.
    await sharp('public/favicon.svg', { density: 600 }).resize(180, 180).flatten({ background: '#0B1120' }).png().toFile('public/apple-touch-icon.png');
    log('  png /apple-touch-icon.png', kb('public/apple-touch-icon.png'));
  },
};

// Merge into the manifest on disk at write time, so two runs in parallel don't drop each other's entries.
const save = () => {
  ensure(MANIFEST);
  const onDisk = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  const merged = Object.fromEntries(Object.entries({ ...onDisk, ...manifest }).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(MANIFEST, JSON.stringify(merged, null, 1) + '\n');
};
const target = only.split(':')[0];
for (const [name, job] of Object.entries(jobs)) {
  if (target ? !name.startsWith(target) : name === 'scan') continue;
  if (target === 'research' && name === 'researchdeck') continue;
  log(`\n▸ ${name}`);
  await job();
  save();
}
log('\nmanifest →', MANIFEST, Object.keys(manifest).length, 'entries');
