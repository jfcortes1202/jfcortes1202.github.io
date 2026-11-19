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

export interface Slide { src: string; caption: string; alt?: string }

/** Lists the processor builds for multi-item CAD sets (e.g. '@arm-parts'). */
export function mediaList(key: string): { key: string; name: string }[] {
  return (manifest as unknown as Record<string, { key: string; name: string }[]>)[key] ?? [];
}
