// Trace the section view (left drawing) of the SolidWorks screenshot into stroke polylines.
// threshold → Zhang-Suen thinning → walk skeleton into polylines → Douglas-Peucker simplify.
const { PNG } = require('pngjs');
const fs = require('fs');

const SRC = process.argv[2];
const OUT = process.argv[3];
const XMAX = Number(process.argv[4] || 590); // only the left view
const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: IW, height: IH, data } = png;

// 1. binary ink mask
const ink = new Uint8Array(IW * IH);
let minx = IW, miny = IH, maxx = 0, maxy = 0;
for (let y = 0; y < IH; y++) for (let x = 0; x < XMAX; x++) {
  const i = (y * IW + x) * 4;
  const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
  if (lum < Number(process.argv[6] || 165)) { ink[y * IW + x] = 1; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
}
console.error('bbox', minx, miny, maxx, maxy);
const pad = 2;
const W = maxx - minx + 1 + pad * 2, H = maxy - miny + 1 + pad * 2;
const img = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const sx = x - pad + minx, sy = y - pad + miny;
  if (sx >= 0 && sy >= 0 && sx < IW && sy < IH) img[y * W + x] = ink[sy * IW + sx];
}
const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : img[y * W + x];

// 1b. close 1px gaps: dilate (4-neighbourhood) then thin back
const DILATE = Number(process.argv[7] || 1);
for (let d = 0; d < DILATE; d++) {
  const src = img.slice();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (src[y * W + x]) continue;
    if (src[y * W + x - 1] || src[y * W + x + 1] || src[(y - 1) * W + x] || src[(y + 1) * W + x]) img[y * W + x] = 1;
  }
}

// 2. Zhang-Suen thinning
let changed = true;
while (changed) {
  changed = false;
  for (let pass = 0; pass < 2; pass++) {
    const del = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (!at(x, y)) continue;
      const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1), p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
      const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
      if (B < 2 || B > 6) continue;
      const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
      let A = 0; for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++;
      if (A !== 1) continue;
      const c1 = pass === 0 ? (p2 * p4 * p6 === 0) : (p2 * p4 * p8 === 0);
      const c2 = pass === 0 ? (p4 * p6 * p8 === 0) : (p2 * p6 * p8 === 0);
      if (c1 && c2) del.push(y * W + x);
    }
    for (const i of del) img[i] = 0;
    if (del.length) changed = true;
  }
}

// 3. walk skeleton into polylines
const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const nbrs = (x, y) => N8.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => at(a, b));
const deg = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y)) deg[y * W + x] = nbrs(x, y).length;
const usedEdge = new Set();
const ek = (x1, y1, x2, y2) => `${Math.min(y1 * W + x1, y2 * W + x2)}-${Math.max(y1 * W + x1, y2 * W + x2)}`;
const lines = [];
function walk(x, y, nx, ny) {
  const pts = [[x, y]];
  let px = x, py = y, cx = nx, cy = ny;
  usedEdge.add(ek(px, py, cx, cy));
  for (let guard = 0; guard < 100000; guard++) {
    pts.push([cx, cy]);
    if (deg[cy * W + cx] !== 2) break;
    const nn = nbrs(cx, cy).filter(([a, b]) => !(a === px && b === py));
    if (!nn.length) break;
    const [qx, qy] = nn[0];
    const key = ek(cx, cy, qx, qy);
    if (usedEdge.has(key)) break;
    usedEdge.add(key);
    px = cx; py = cy; cx = qx; cy = qy;
  }
  return pts;
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!at(x, y) || deg[y * W + x] === 2) continue;
  for (const [nx, ny] of nbrs(x, y)) if (!usedEdge.has(ek(x, y, nx, ny))) lines.push(walk(x, y, nx, ny));
}
// remaining closed loops
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!at(x, y) || deg[y * W + x] !== 2) continue;
  for (const [nx, ny] of nbrs(x, y)) if (!usedEdge.has(ek(x, y, nx, ny))) lines.push(walk(x, y, nx, ny));
}

// 4. simplify
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  let imax = 0, dmax = 0;
  const L = Math.hypot(bx - ax, by - ay) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L;
    if (d > dmax) { dmax = d; imax = i; }
  }
  if (dmax > eps) return [...dp(pts.slice(0, imax + 1), eps).slice(0, -1), ...dp(pts.slice(imax), eps)];
  return [pts[0], pts[pts.length - 1]];
}
const EPS = Number(process.argv[5] || 0.9);
const MINLEN = 4;
const out = lines
  .map((l) => dp(l, EPS))
  .filter((l) => { let len = 0; for (let i = 1; i < l.length; i++) len += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return len >= MINLEN; });
console.error('skeleton lines', lines.length, '→ kept', out.length, 'points', out.reduce((a, l) => a + l.length, 0), 'size', W, H);
fs.writeFileSync(OUT, JSON.stringify({ width: W, height: H, lines: out }));
