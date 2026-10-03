// Built-in projectile models for fx.projectileShape (the fallback when a design has no generated
// `projectile`), written in the projectile DSL so one renderer covers both. Pure data.

import type { ProjectileDesign, ProjectileShape } from './types';
import { sanitizeProjectile } from './sanitize';

type Raw = Record<string, unknown>;
const M = (color: string, extra: Raw = {}): Raw => ({ color, ...extra });
const glow = (color: string, k = 1, extra: Raw = {}): Raw => ({ color, emissive: color, emissiveIntensity: k, ...extra });

function raw(shape: ProjectileShape, c: string): Raw {
  switch (shape) {
    case 'pellet':
      return { label: 'pellet', shapes: [{ type: 'sphere', r: 0.04, wseg: 6, hseg: 4, material: glow(c, 0.6) }] };
    case 'bolt':
      return { label: 'energy bolt', shapes: [{ type: 'capsule', r: 0.02, h: 0.22, seg: 6, rot: [90, 0, 0], material: glow(c, 2) }], trail: 'glow', impact: 'spark' };
    case 'rocket':
      return {
        label: 'finned rocket',
        shapes: [
          { type: 'cylinder', rTop: 0.045, rBottom: 0.045, h: 0.28, seg: 8, rot: [90, 0, 0], material: M('#d8d8d8', { metalness: 0.5 }) },
          { type: 'cone', r: 0.045, h: 0.1, seg: 8, pos: [0, 0, -0.19], rot: [-90, 0, 0], material: M(c) },
          { type: 'box', size: [0.16, 0.006, 0.07], pos: [0, 0, 0.11], material: M(c) },
          { type: 'box', size: [0.006, 0.16, 0.07], pos: [0, 0, 0.11], material: M(c) },
          { type: 'cone', r: 0.035, h: 0.12, seg: 6, pos: [0, 0, 0.2], rot: [90, 0, 0], material: glow('#ffb040', 2, { opacity: 0.8 }) },
        ],
        spin: { axis: 'z', rate: 2 },
        trail: 'smoke',
        impact: 'burst',
      };
    case 'sphere':
      return { label: 'orb', shapes: [{ type: 'sphere', r: 0.08, wseg: 10, hseg: 8, material: glow(c, 0.5) }] };
    case 'bubble':
      return {
        label: 'bubble',
        shapes: [
          { type: 'sphere', r: 0.1, wseg: 12, hseg: 8, material: glow(c, 0.3, { opacity: 0.35, roughness: 0.1, flatShading: false }) },
          { type: 'sphere', r: 0.022, wseg: 6, hseg: 4, pos: [0.04, 0.045, -0.04], material: M('#ffffff', { opacity: 0.8, emissive: '#ffffff', emissiveIntensity: 0.6 }) },
        ],
        wobble: 0.6,
        trail: 'bubble',
        impact: 'splash',
      };
    case 'arrow':
      return {
        label: 'arrow',
        shapes: [
          { type: 'cylinder', rTop: 0.008, rBottom: 0.008, h: 0.5, seg: 5, rot: [90, 0, 0], material: M('#8a6a3a') },
          { type: 'cone', r: 0.02, h: 0.07, seg: 4, pos: [0, 0, -0.28], rot: [-90, 0, 0], material: M('#c0c0c0', { metalness: 0.8 }) },
          { type: 'box', size: [0.06, 0.003, 0.08], pos: [0, 0, 0.21], material: M(c) },
          { type: 'box', size: [0.003, 0.06, 0.08], pos: [0, 0, 0.21], material: M(c) },
        ],
        impact: 'spark',
      };
    case 'blob':
      return { label: 'goo blob', shapes: [{ type: 'sphere', r: 0.08, wseg: 8, hseg: 6, scale: [1, 0.8, 1.25], material: glow(c, 0.4, { roughness: 0.2 }) }], wobble: 0.8, impact: 'splat' };
    case 'disc':
      return {
        label: 'disc',
        shapes: [
          { type: 'cylinder', rTop: 0.1, rBottom: 0.1, h: 0.02, seg: 12, material: M(c, { metalness: 0.6 }) },
          { type: 'torus', r: 0.1, tube: 0.01, seg: 12, rot: [90, 0, 0], material: glow(c, 1) },
        ],
        spin: { axis: 'y', rate: 3 },
        impact: 'spark',
      };
    case 'shard':
      return {
        label: 'crystal shard',
        shapes: [
          { type: 'cone', r: 0.03, h: 0.2, seg: 4, pos: [0, 0, -0.03], rot: [-90, 0, 0], material: glow(c, 0.8) },
          { type: 'cone', r: 0.03, h: 0.06, seg: 4, pos: [0, 0, 0.1], rot: [90, 0, 0], material: glow(c, 0.8) },
        ],
        spin: { axis: 'z', rate: 3 },
        impact: 'shatter',
      };
  }
}

const CACHE = new Map<string, ProjectileDesign>();

/** The built-in projectile for a fx.projectileShape (sanitized, cached). */
export function presetProjectile(shape: ProjectileShape, color: string): ProjectileDesign {
  const key = `${shape}|${color}`;
  let p = CACHE.get(key);
  if (!p) {
    p = sanitizeProjectile(raw(shape, color)) ?? { label: shape, shapes: [{ type: 'sphere', r: 0.06, material: { color } }] };
    if (CACHE.size > 64) CACHE.clear();
    CACHE.set(key, p);
  }
  return p;
}
