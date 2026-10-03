// Shape macros: higher-level, low-poly shapes the forge LLM may write ("blade", "pistolgrip",
// "bevelbox", "wedge"), expanded into plain DSL primitives (extrudes) BEFORE sanitizing. The stored
// DSL never contains macros, so clients / the SpacetimeDB module only ever see primitives.
//
//   blade      {length, width, thickness?, curve? -1..1, tip?: point|hook|clip|tanto|spear|round|square|kissaki,
//               edge?: single|double|none, edgeColor?}   base at the origin, grows toward -Z, spine up (+Y).
//               curve > 0 sweeps the tip up (katana / scimitar), < 0 down into a claw (karambit).
//   pistolgrip {h, w?, d?, angle?}  top at the origin, hangs down (-Y), raked back (+Z) by `angle` degrees.
//   bevelbox   {size:[x,y,z], bevel?}  a box with chamfered edges (reads far better than a plain box).
//   wedge      {size:[x,y,z], front?}  side-profile trapezoid: full height y at the back (+Z), y*front at
//               the front (-Z); front 0 = sharp edge, > 1 = flared (axe bit).
//   rail       {length, width?, height?}  picatinny-style toothed rail along Z (centred, sits on y = 0).
// blade also takes fuller?: true (a darker groove along the flat) and fullerColor.
// Each also takes the usual pos / rot / scale / material.

import { FORGE_LIMITS as L, type V2, type V3 } from './types';
import { eulerMatrix } from './math';

export const SHAPE_MACROS = ['blade', 'pistolgrip', 'bevelbox', 'wedge', 'rail'] as const;
export type ShapeMacro = (typeof SHAPE_MACROS)[number];

type Raw = Record<string, unknown>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r4 = (v: number) => {
  const r = Number(v.toFixed(4));
  return r === 0 ? 0 : r;
};
function n(v: unknown, dflt: number, lo: number, hi: number): number {
  const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return clamp(Number.isFinite(x) ? x : dflt, lo, hi);
}
function vec3(v: unknown, dflt: V3): V3 {
  if (typeof v === 'number' && Number.isFinite(v)) return [v, v, v];
  if (!Array.isArray(v)) return [...dflt] as V3;
  return [0, 1, 2].map(i => (typeof v[i] === 'number' && Number.isFinite(v[i]) ? (v[i] as number) : dflt[i])) as V3;
}

const DEG = 180 / Math.PI;

function mul3(a: number[], b: number[]): number[] {
  const m = new Array<number>(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return m;
}

/** Euler XYZ degrees from a row-major rotation matrix (THREE.Euler.setFromRotationMatrix). */
export function matrixToEuler(m: number[]): V3 {
  const m13 = clamp(m[2], -1, 1);
  const y = Math.asin(m13);
  let x: number, z: number;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m[5], m[8]);
    z = Math.atan2(-m[1], m[0]);
  } else {
    x = Math.atan2(m[7], m[4]);
    z = 0;
  }
  return [r4(x * DEG), r4(y * DEG), r4(z * DEG)];
}

/** Side-profile placement: the macro's rot composed with [0,90,0] (outline x -> -Z, y -> +Y, depth -> X). */
function profileTransform(r: Raw): { rot: V3; scale?: V3 } {
  const user = vec3(r.rot, [0, 0, 0]);
  const rot = matrixToEuler(mul3(eulerMatrix(user), eulerMatrix([0, 90, 0])));
  const su = vec3(r.scale, [1, 1, 1]);
  // Su * Ry90 == Ry90 * diag(su.z, su.y, su.x)
  const scale: V3 = [su[2], su[1], su[0]];
  return scale.every(x => x === 1) ? { rot } : { rot, scale };
}

function base(r: Raw): Raw {
  const o: Raw = { material: r.material ?? r.color ?? { color: 'primary' } };
  if (r.pos !== undefined) o.pos = r.pos;
  return o;
}

type Tip = 'point' | 'hook' | 'clip' | 'tanto' | 'spear' | 'round' | 'square' | 'kissaki';
const TIPS: readonly Tip[] = ['point', 'hook', 'clip', 'tanto', 'spear', 'round', 'square', 'kissaki'];
const STATIONS = [0, 0.15, 0.3, 0.45, 0.6, 0.72, 0.82, 0.9, 0.96, 1];

/** [spine, edge] half-width factors at t (0 = base, 1 = tip). */
function profile(tip: Tip, t: number): [number, number] {
  const lerp = (a: number, b: number, k: number) => a + (b - a) * clamp(k, 0, 1);
  switch (tip) {
    case 'hook':
      return [Math.pow(1 - t, 0.6), Math.pow(1 - t, 0.9)];
    case 'clip':
      return [t < 0.55 ? 1 : lerp(1, -0.3, (t - 0.55) / 0.45), t < 0.7 ? 1 : lerp(1, 0.3, (t - 0.7) / 0.3)];
    case 'tanto':
      return [1, t < 0.82 ? 1 : lerp(1, -1, (t - 0.82) / 0.18)];
    case 'spear': {
      const k = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      return [k, k];
    }
    case 'round': {
      const k = t < 0.8 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 2));
      return [k, k];
    }
    case 'square':
      return [1, 1];
    case 'kissaki': {
      // katana tip: the spine runs on, the edge sweeps up to meet it in the last ~14%
      const k = clamp((t - 0.86) / 0.14, 0, 1);
      return [1 - 0.5 * k * k, 1 - 1.5 * Math.pow(k, 1.4)];
    }
    default:
      return [t < 0.7 ? 1 : 1 - ((t - 0.7) / 0.3) ** 2, t < 0.55 ? 1 : 1 - Math.pow((t - 0.55) / 0.45, 1.3)];
  }
}

export interface BladeProfile {
  body: V2[];
  edges: V2[][];
}

/** Outline of a blade in profile space (x = distance forward, y = up). */
export function bladeProfile(length: number, width: number, curve: number, tip: Tip, edge: 'single' | 'double' | 'none'): BladeProfile {
  const theta = clamp(curve, -1, 1) * 1.4; // up to ~80 degrees of sweep
  const sign = theta < 0 ? -1 : 1;
  const a = Math.abs(theta);
  const R = a > 1e-3 ? length / a : 0;
  const spine: V2[] = [];
  const edgeP: V2[] = [];
  const normals: V2[] = [];
  const centre: V2[] = [];
  const factors: [number, number][] = [];
  for (const t of STATIONS) {
    let cx: number, cy: number, phi: number;
    if (a <= 1e-3) {
      cx = t * length;
      cy = 0;
      phi = 0;
    } else {
      const ang = t * a;
      cx = R * Math.sin(ang);
      cy = sign * R * (1 - Math.cos(ang));
      phi = sign * ang;
    }
    const nx = -Math.sin(phi);
    const ny = Math.cos(phi);
    const [u, d] = profile(tip, t);
    const hw = width / 2;
    spine.push([cx + nx * hw * u, cy + ny * hw * u]);
    edgeP.push([cx - nx * hw * d, cy - ny * hw * d]);
    normals.push([nx, ny]);
    centre.push([cx, cy]);
    factors.push([u, d]);
  }
  const same = (p: V2, q: V2) => Math.abs(p[0] - q[0]) < 1e-5 && Math.abs(p[1] - q[1]) < 1e-5;
  const body: V2[] = [...spine];
  const rev = [...edgeP].reverse();
  if (same(rev[0], body[body.length - 1])) rev.shift();
  body.push(...rev);
  const edges: V2[][] = [];
  const strip = (side: 1 | -1) => {
    const outer: V2[] = [];
    const inner: V2[] = [];
    STATIONS.forEach((_, i) => {
      const f = side === -1 ? factors[i][1] : factors[i][0];
      const p = side === -1 ? edgeP[i] : spine[i];
      if (f <= 0.04) return;
      const w = (width / 2) * 0.32 * Math.min(1, f);
      outer.push(p);
      inner.push([p[0] - side * normals[i][0] * w, p[1] - side * normals[i][1] * w]);
    });
    if (outer.length < 2) return;
    const last = STATIONS.length - 1;
    const tipP = side === -1 ? edgeP[last] : spine[last];
    const poly: V2[] = [...outer];
    if (!same(poly[poly.length - 1], tipP) && tip !== 'square') poly.push(tipP);
    poly.push(...inner.reverse());
    edges.push(poly);
  };
  if (edge !== 'none') strip(-1);
  if (edge === 'double') strip(1);
  void centre;
  return { body, edges };
}

const fixPts = (pts: V2[]): V2[] => pts.map(([x, y]) => [r4(x), r4(y)] as V2);

function expandBlade(r: Raw): Raw[] {
  const length = n(r.length ?? r.l ?? r.h, 0.2, 0.02, L.maxDim);
  const width = n(r.width ?? r.w, Math.max(0.02, length * 0.18), 0.005, 1);
  const thick = n(r.thickness ?? r.depth ?? r.t, clamp(width * 0.12, 0.004, 0.02), 0.002, 0.08);
  const curve = n(r.curve, 0, -1, 1);
  const tipRaw = typeof r.tip === 'string' ? r.tip.trim().toLowerCase() : '';
  const tip: Tip = (TIPS as readonly string[]).includes(tipRaw) ? (tipRaw as Tip) : curve < -0.4 ? 'hook' : 'point';
  const edgeRaw = typeof r.edge === 'string' ? r.edge.trim().toLowerCase() : '';
  const edge = edgeRaw === 'double' || edgeRaw === 'none' ? edgeRaw : tip === 'spear' && edgeRaw !== 'single' ? 'double' : 'single';
  const { body, edges } = bladeProfile(length, width, curve, tip, edge);
  const tr = profileTransform(r);
  const out: Raw[] = [
    { type: 'extrude', ...base(r), ...tr, outline: fixPts(body), depth: r4(thick), bevel: r4(Math.min(0.002, thick * 0.25)) },
  ];
  if (r.fuller === true || r.fuller === 'true') {
    // groove along the flat, 8-58% of the length, a bit above the centre line (in profile space)
    const theta = clamp(curve, -1, 1) * 1.4;
    const sign = theta < 0 ? -1 : 1;
    const a = Math.abs(theta);
    const R = a > 1e-3 ? length / a : 0;
    const top: V2[] = [];
    const bot: V2[] = [];
    for (const t of [0.08, 0.2, 0.33, 0.46, 0.58]) {
      let cx = t * length, cy = 0, phi = 0;
      if (a > 1e-3) {
        const ang = t * a;
        cx = R * Math.sin(ang);
        cy = sign * R * (1 - Math.cos(ang));
        phi = sign * ang;
      }
      const nx = -Math.sin(phi), ny = Math.cos(phi);
      const off = width * 0.12, hw = width * 0.09 * (t > 0.5 ? 0.6 : 1);
      top.push([cx + nx * (off + hw), cy + ny * (off + hw)]);
      bot.push([cx + nx * (off - hw), cy + ny * (off - hw)]);
    }
    out.push({
      type: 'extrude',
      ...(r.pos !== undefined ? { pos: r.pos } : {}),
      ...tr,
      outline: fixPts([...top, ...bot.reverse()]),
      depth: r4(thick + 0.0012),
      material: { color: typeof r.fullerColor === 'string' ? r.fullerColor : '#8d949e', metalness: 0.7, roughness: 0.4 },
    });
  }
  const edgeColor = typeof r.edgeColor === 'string' ? r.edgeColor : '#eef2f6';
  for (const e of edges) {
    out.push({
      type: 'extrude',
      ...(r.pos !== undefined ? { pos: r.pos } : {}),
      ...tr,
      outline: fixPts(e),
      depth: r4(thick * 1.25 + 0.002),
      material: { color: edgeColor, metalness: 0.5, roughness: 0.25 },
    });
  }
  return out;
}

function expandPistolGrip(r: Raw): Raw[] {
  const h = n(r.h ?? r.height ?? r.length, 0.11, 0.03, 0.4);
  const w = n(r.w ?? r.width, 0.032, 0.012, 0.12);
  const d = n(r.d ?? r.depth, 0.045, 0.015, 0.15);
  const angle = n(r.angle, 16, -10, 40);
  const k = h * Math.tan((angle * Math.PI) / 180);
  const bev = Math.min(0.003, w * 0.15);
  const outline: V2[] = [
    [d / 2, 0],
    [d / 2 - 0.5 * k + 0.003, -0.5 * h],
    [d / 2 - k, -h],
    [-d / 2 - k, -h],
    [-d / 2 - 0.5 * k - 0.004, -0.5 * h],
    [-d / 2 - 0.006, 0],
  ];
  return [{ type: 'extrude', ...base(r), ...profileTransform(r), outline: fixPts(outline), depth: r4(Math.max(0.004, w - 2 * bev)), bevel: r4(bev) }];
}

function expandBevelBox(r: Raw): Raw[] {
  const size = vec3(r.size, [0.1, 0.1, 0.1]).map(v => clamp(Math.abs(v), 0.004, L.maxDim)) as V3;
  const b = n(r.bevel, Math.min(0.01, Math.min(...size) * 0.15), 0.001, Math.min(L.maxBevel, Math.min(...size) * 0.4));
  const hx = size[0] / 2 - b;
  const hy = size[1] / 2 - b;
  const o: Raw = {
    type: 'extrude',
    ...base(r),
    outline: fixPts([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]),
    depth: r4(Math.max(0.002, size[2] - 2 * b)),
    bevel: r4(b),
  };
  if (r.rot !== undefined) o.rot = r.rot;
  if (r.scale !== undefined) o.scale = r.scale;
  return [o];
}

function expandWedge(r: Raw): Raw[] {
  const size = vec3(r.size, [0.03, 0.08, 0.12]).map(v => clamp(Math.abs(v), 0.004, L.maxDim)) as V3;
  const front = n(r.front ?? r.taper, 0.15, 0, 3);
  const [x, y, z] = size;
  const outline: V2[] =
    front < 0.02
      ? [[-z / 2, -y / 2], [z / 2, 0], [-z / 2, y / 2]]
      : [[-z / 2, -y / 2], [z / 2, (-y * front) / 2], [z / 2, (y * front) / 2], [-z / 2, y / 2]];
  return [{ type: 'extrude', ...base(r), ...profileTransform(r), outline: fixPts(outline), depth: r4(x), bevel: r4(Math.min(0.002, x * 0.15)) }];
}

function expandRail(r: Raw): Raw[] {
  const length = n(r.length ?? r.l, 0.12, 0.02, 1);
  const width = n(r.width ?? r.w, 0.021, 0.006, 0.08);
  const height = n(r.height ?? r.h, 0.009, 0.003, 0.03);
  const teeth = Math.max(2, Math.min(9, Math.round(length / 0.01))); // 3 outline points per tooth (<= 32 total)
  const pitch = length / teeth;
  const base = height * 0.45;
  // side profile (x = forward): flat bottom, crenellated top
  const pts: V2[] = [[-length / 2, 0], [length / 2, 0]];
  for (let i = teeth - 1; i >= 0; i--) {
    const x0 = -length / 2 + i * pitch;
    pts.push([x0 + pitch, base], [x0 + pitch * 0.8, height], [x0 + pitch * 0.2, height]);
  }
  pts.push([-length / 2, base]);
  const uniq = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]).slice(0, L.maxOutlinePoints);
  return [{ type: 'extrude', ...base_(r), ...profileTransform(r), outline: fixPts(uniq), depth: r4(width) }];
}
const base_ = base;

/** Expand one raw shape: a macro becomes 1+ primitive shapes; anything else passes through. */
export function expandShape(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [raw];
  const r = raw as Raw;
  const t = typeof r.type === 'string' ? r.type.trim().toLowerCase().replace(/[\s_-]/g, '') : '';
  switch (t) {
    case 'blade':
    case 'knifeblade':
    case 'swordblade':
      return expandBlade(r);
    case 'pistolgrip':
    case 'gungrip':
      return expandPistolGrip(r);
    case 'bevelbox':
    case 'chamferbox':
    case 'roundedbox':
      return expandBevelBox(r);
    case 'wedge':
      return expandWedge(r);
    case 'rail':
    case 'picatinny':
    case 'picatinnyrail':
      return expandRail(r);
    default:
      return [raw];
  }
}

export function expandShapes(shapes: unknown): unknown {
  if (!Array.isArray(shapes)) return shapes;
  return shapes.flatMap(s => expandShape(s));
}

/** Copy of a raw component / projectile object with its shape macros expanded. */
export function expandMacros<T>(raw: T): T {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = raw as unknown as Raw;
  if (!Array.isArray(r.shapes)) return raw;
  return { ...r, shapes: expandShapes(r.shapes) } as unknown as T;
}

/** Expand macros in a whole raw design (components + projectile). */
export function expandDesignMacros<T>(raw: T): T {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as unknown as Raw;
  const out: Raw = { ...r };
  if (Array.isArray(r.components)) out.components = r.components.map(c => expandMacros(c));
  if (r.projectile) out.projectile = expandMacros(r.projectile);
  return out as unknown as T;
}
