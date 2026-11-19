/**
 * Dev-only: extract an Office file (.pptx/.docx/.xlsx are zip archives).
 *   node qa/unzip.mjs <file> <outDir>
 * Prints slide/paragraph text so the content can be reviewed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const [, , file, outDir] = process.argv;
const b = readFileSync(file);
const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const count = b.readUInt16LE(eocd + 10);
let p = b.readUInt32LE(eocd + 16);
const entries = [];
for (let i = 0; i < count; i++) {
  const method = b.readUInt16LE(p + 10);
  const csize = b.readUInt32LE(p + 20);
  const nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32);
  const off = b.readUInt32LE(p + 42);
  entries.push({ name: b.subarray(p + 46, p + 46 + nl).toString(), method, csize, off });
  p += 46 + nl + xl + cl;
}
const read = (e) => {
  const nl = b.readUInt16LE(e.off + 26), xl = b.readUInt16LE(e.off + 28);
  const data = b.subarray(e.off + 30 + nl + xl, e.off + 30 + nl + xl + e.csize);
  return e.method ? inflateRawSync(data) : data;
};
for (const e of entries) {
  if (e.name.endsWith('/')) continue;
  const out = join(outDir, e.name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, read(e));
}
const text = (xml) => [...xml.matchAll(/<(?:a|w):t[^>]*>([^<]*)<\/(?:a|w):t>/g)].map((m) => m[1]).join(' ');
const slides = entries.filter((e) => /ppt\/slides\/slide\d+\.xml$/.test(e.name))
  .sort((x, y) => +x.name.match(/(\d+)\.xml/)[1] - +y.name.match(/(\d+)\.xml/)[1]);
for (const s of slides) {
  const xml = read(s).toString();
  const rels = entries.find((e) => e.name === s.name.replace('slides/', 'slides/_rels/') + '.rels');
  const imgs = rels ? [...read(rels).toString().matchAll(/Target="\.\.\/media\/([^"]+)"/g)].map((m) => m[1]) : [];
  console.log(`${s.name.match(/slide\d+/)[0]}: ${text(xml).slice(0, 200)}  [${imgs.join(', ')}]`);
}
const doc = entries.find((e) => e.name === 'word/document.xml');
if (doc) console.log('DOCX TEXT:', text(read(doc).toString()).slice(0, 1500));
