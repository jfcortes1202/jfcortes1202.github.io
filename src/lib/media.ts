/**
 * Lookup for processed media (see tools/process-media.mjs → src/data/media.json).
 * Gives every <img>/<video> its intrinsic width/height so the browser can
 * reserve space before the file loads.
 */
import manifest from '../data/media.json';

export interface MediaInfo { w?: number; h?: number; poster?: string; duration?: number }

const data = manifest as unknown as Record<string, MediaInfo>;

export function media(src: string): MediaInfo {
  const info = data[src];
  if (!info) throw new Error(`[media] ${src} is not in src/data/media.json — run tools/process-media.mjs`);
  return info;
}

export const hasMedia = (src: string) => src in data;

/** A carousel slide. With `placeholder`, the slide renders a labeled frame instead of `src`. */
export interface Slide { src: string; caption: string; alt?: string; thumb?: string; placeholder?: { kind: string; label: string } }

/** Page-by-page slides for a report or deck processed by the `reports` job. */
export function reportSlides(id: string, title: string): Slide[] {
  const list = (manifest as unknown as Record<string, { key: string; thumb: string; page: number }[]>)[`@report-${id}`] ?? [];
  return list.map((p) => ({ src: p.key, thumb: p.thumb, caption: `${title} · page ${p.page} of ${list.length}`, alt: `Page ${p.page} of the ${title.toLowerCase()}` }));
}

/** Lists the processor builds for multi-item CAD sets (e.g. '@arm-parts'). */
export function mediaList(key: string): { key: string; name: string }[] {
  return (manifest as unknown as Record<string, { key: string; name: string }[]>)[key] ?? [];
}
