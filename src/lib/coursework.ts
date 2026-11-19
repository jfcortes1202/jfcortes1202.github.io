/**
 * Builds carousel slides for the CAD coursework page from src/data/coursework.json.
 * A piece shows its processed export when it exists in the media manifest and a
 * labeled placeholder otherwise, so new exports appear after one pipeline run.
 * Keep `slug`/paths in sync with the `coursework` job in tools/process-media.mjs.
 */
import data from '../data/coursework.json';
import { hasMedia, type Slide } from './media';

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const isoPath = (folder: string, name: string) => `/media/coursework/${slug(folder)}/${slug(name)}.webp`;
export const drawingPath = (folder: string, name: string) => `/media/coursework/${slug(folder)}/${slug(name)}-drawing.webp`;
export const feaPath = (folder: string, name: string) => `/media/coursework/fea/${slug(folder)}-${slug(name)}.webp`;
export const animationPath = (folder: string, name: string) => `/media/coursework/${slug(folder)}/${slug(name)}.mp4`;

type Piece = { folder: string; name: string; kind: string; drawing: boolean };
type Group = { id: string; title: string; blurb: string; pieces: Piece[]; extraDrawings?: { folder: string; name: string }[]; animation?: { folder: string; name: string } };

const label = (folder: string) => folder.replace(/^HW(\d+)/, 'Homework $1').replace(' - ', ' · ');

const slideFor = (src: string, caption: string, alt: string, placeholderKind: string): Slide =>
  hasMedia(src) ? { src, caption, alt } : { src, caption, placeholder: { kind: placeholderKind, label: `${caption} — export pending` } };

export const groups = (data.groups as Group[]).map((g) => {
  const parts = g.pieces.map((p) => {
    const cap = `${p.name}${p.kind === 'assembly' ? ' (assembly)' : ''} · ${label(p.folder)}`;
    return slideFor(isoPath(p.folder, p.name), cap, `Isometric view of the ${p.name.toLowerCase()} ${p.kind}`, 'Isometric view');
  });
  const drawings = [
    ...g.pieces.filter((p) => p.drawing).map((p) => ({ folder: p.folder, name: p.name })),
    ...(g.extraDrawings ?? []),
  ].map((d) => slideFor(drawingPath(d.folder, d.name), `${d.name} · ${label(d.folder)}`, `Engineering drawing: ${d.name.toLowerCase()}`, 'Drawing'));
  const anim = g.animation && hasMedia(animationPath(g.animation.folder, g.animation.name)) ? animationPath(g.animation.folder, g.animation.name) : null;
  return { ...g, parts, drawings, animation: anim };
});

export const fea = (data.fea as { folder: string; name: string; caption: string }[]).map((f) =>
  slideFor(feaPath(f.folder, f.name), f.caption, `SolidWorks Simulation result plot: ${f.caption.toLowerCase()}`, 'FEA result'),
);

export const counts = {
  pieces: groups.reduce((n, g) => n + g.parts.length, 0),
  drawings: groups.reduce((n, g) => n + g.drawings.length, 0),
  pending: [...groups.flatMap((g) => [...g.parts, ...g.drawings]), ...fea].filter((s) => s.placeholder).length,
};
