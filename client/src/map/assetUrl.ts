/**
 * Optimized map GLBs are tens of MB and live on a bucket/CDN, not in this repo.
 * A root-relative map URL like '/maps/x.glb' is resolved against
 * VITE_MAP_BASE_URL when it is set; everything else passes through unchanged.
 * loadMap derives the _collision.glb and .meta.json siblings from the visual
 * URL, so they follow the resolved base automatically.
 */
export function resolveMapUrl(url: string | undefined): string | undefined {
  if (!url || !url.startsWith('/')) return url;
  const base = import.meta.env.VITE_MAP_BASE_URL;
  if (!base) return url;
  return `${base.replace(/\/+$/, '')}${url}`;
}
