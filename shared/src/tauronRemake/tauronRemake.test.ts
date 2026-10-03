import { beforeAll, describe, expect, it } from 'vitest';
import { MAPS, findMapDef, mapSource } from '../maps';
import { buildArenaGeometry, type ArenaGeometry, type Prop } from './geometry';
import {
  A_D0,
  A_END,
  A_TOP,
  BACK_WALL_D1,
  CORNER_R,
  FLOOR_HALF_X,
  FLOOR_HALF_Z,
  CONC_D1,
  CLOSED_D,
  CST_D0,
  CST_D1,
  C_D0,
  C_END,
  C_TOP,
  C_WALK_Y,
  FLOOR_STAIR_D0,
  LEVEL_B,
  TUN_STAIR_D0,
  TUN_STAIR_D1,
  columnPoint,
  layout,
} from './layout';
import { TAURON_REMAKE_SPAWNS } from './spawns';

// ------------------------------------------------------------------ tiny BVH raycaster

interface Hit {
  t: number;
  ny: number;
}

class Bvh {
  private tris: Float32Array;
  private order: Uint32Array;
  private nodes: { min: number[]; max: number[]; left: number; right: number; start: number; count: number }[] = [];

  constructor(tris: Float32Array) {
    this.tris = tris;
    const n = tris.length / 9;
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    const cent = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 3; a++) cent[i * 3 + a] = (tris[i * 9 + a]! + tris[i * 9 + 3 + a]! + tris[i * 9 + 6 + a]!) / 3;
    }
    this.build(0, n, cent);
  }

  private build(start: number, end: number, cent: Float32Array): number {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      const t = this.order[i]!;
      for (let v = 0; v < 3; v++) {
        for (let a = 0; a < 3; a++) {
          const c = this.tris[t * 9 + v * 3 + a]!;
          if (c < min[a]!) min[a] = c;
          if (c > max[a]!) max[a] = c;
        }
      }
    }
    const id = this.nodes.length;
    this.nodes.push({ min, max, left: -1, right: -1, start, count: end - start });
    if (end - start <= 8) return id;
    const ext = [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
    const axis = ext[0]! > ext[1]! ? (ext[0]! > ext[2]! ? 0 : 2) : ext[1]! > ext[2]! ? 1 : 2;
    const sub = Array.from(this.order.subarray(start, end)).sort((p, q) => cent[p * 3 + axis]! - cent[q * 3 + axis]!);
    this.order.set(sub, start);
    const mid = (start + end) >> 1;
    const left = this.build(start, mid, cent);
    const right = this.build(mid, end, cent);
    const node = this.nodes[id]!;
    node.left = left;
    node.right = right;
    node.count = 0;
    return id;
  }

  ray(o: number[], d: number[], maxT: number): Hit | null {
    let best: Hit | null = null;
    let bestT = maxT;
    const inv = d.map((v) => (Math.abs(v) < 1e-12 ? 1e12 : 1 / v));
    const stack = [0];
    while (stack.length) {
      const node = this.nodes[stack.pop()!]!;
      let t0 = 0, t1 = bestT;
      let miss = false;
      for (let a = 0; a < 3; a++) {
        let ta = (node.min[a]! - o[a]!) * inv[a]!;
        let tb = (node.max[a]! - o[a]!) * inv[a]!;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1 + 1e-9) { miss = true; break; }
      }
      if (miss) continue;
      if (node.count === 0) {
        stack.push(node.left, node.right);
        continue;
      }
      for (let i = node.start; i < node.start + node.count; i++) {
        const h = this.tri(this.order[i]!, o, d);
        if (h && h.t < bestT) {
          bestT = h.t;
          best = h;
        }
      }
    }
    return best;
  }

  private tri(i: number, o: number[], d: number[]): Hit | null {
    const T = this.tris, b = i * 9;
    const e1 = [T[b + 3]! - T[b]!, T[b + 4]! - T[b + 1]!, T[b + 5]! - T[b + 2]!];
    const e2 = [T[b + 6]! - T[b]!, T[b + 7]! - T[b + 1]!, T[b + 8]! - T[b + 2]!];
    const p = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
    const det = e1[0]! * p[0]! + e1[1]! * p[1]! + e1[2]! * p[2]!;
    if (Math.abs(det) < 1e-12) return null;
    const id = 1 / det;
    const s = [o[0]! - T[b]!, o[1]! - T[b + 1]!, o[2]! - T[b + 2]!];
    const u = (s[0]! * p[0]! + s[1]! * p[1]! + s[2]! * p[2]!) * id;
    if (u < -1e-7 || u > 1 + 1e-7) return null;
    const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
    const v = (d[0]! * q[0]! + d[1]! * q[1]! + d[2]! * q[2]!) * id;
    if (v < -1e-7 || u + v > 1 + 1e-7) return null;
    const t = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) * id;
    if (t < 1e-6) return null;
    const nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
    const ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
    const nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    return { t, ny: Math.abs(ny) / Math.hypot(nx, ny, nz) };
  }
}

function boxTris(p: Prop): number[] {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const corner = (ix: number, iy: number, iz: number) => {
    const lx = (ix - 0.5) * p.sx, ly = (iy - 0.5) * p.sy, lz = (iz - 0.5) * p.sz;
    // three.js Y rotation: x' = x cos + z sin, z' = −x sin + z cos
    return [p.x + lx * c + lz * s, p.y + ly, p.z - lx * s + lz * c];
  };
  const faces = [
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
  ];
  const out: number[] = [];
  for (const f of faces) {
    const q = f.map(([a, b, cc]) => corner(a!, b!, cc!));
    out.push(...q[0]!, ...q[1]!, ...q[2]!, ...q[0]!, ...q[2]!, ...q[3]!);
  }
  return out;
}

let geo: ArenaGeometry;
let solid: Bvh; // collision mesh + colliding props
let closed: Bvh; // + roof + all props (what you can see)

beforeAll(() => {
  geo = buildArenaGeometry();
  const { vertices: V, indices: I } = geo.collision;
  const flat: number[] = [];
  for (let i = 0; i < I.length; i++) flat.push(V[I[i]! * 3]!, V[I[i]! * 3 + 1]!, V[I[i]! * 3 + 2]!);
  for (const p of geo.props) if (p.collide) flat.push(...boxTris(p));
  solid = new Bvh(new Float32Array(flat));
  const vis = [...flat];
  vis.push(...(geo.groups.roof?.positions ?? []), ...(geo.groups.mosaic?.positions ?? []));
  for (const p of geo.props) if (!p.collide) vis.push(...boxTris(p));
  closed = new Bvh(new Float32Array(vis));
});

/** height of the walkable surface under (x, z), probing down from `fromY` */
function groundAt(x: number, z: number, fromY: number): { y: number; ny: number } | null {
  const h = solid.ray([x, fromY, z], [0, -1, 0], 60);
  return h ? { y: fromY - h.t, ny: h.ny } : null;
}

describe('tauron-remake registry', () => {
  it('is registered as a procedural map selectable by id', () => {
    const def = MAPS['tauron-remake']!;
    expect(def.procedural).toBe(true);
    expect(def.url).toBeNull();
    expect(mapSource(def)).toBe('tauron-remake');
    expect(findMapDef('tauron-remake')).toBe(def);
    expect(def.spawns).toBe(TAURON_REMAKE_SPAWNS);
  });
});

describe('tauron-remake geometry', () => {
  it('stays within the performance budget', () => {
    console.info('[tauron-remake] stats', geo.stats, 'seats', geo.seats.length, 'props', geo.props.length);
    expect(geo.stats.triangles).toBeLessThan(250_000);
    // ~15,000 seated in full bowl config; the hackathon config retracts tier A + drapes the west end
    expect(geo.seats.length).toBeGreaterThan(8_000);
    expect(geo.seats.length).toBeLessThan(22_000);
  });

  it('has a closed shell: rays from every spawn hit something in every direction', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const misses: string[] = [];
    for (const s of TAURON_REMAKE_SPAWNS) {
      for (let i = 0; i < 400; i++) {
        const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        const d = [r * Math.cos(th), u, r * Math.sin(th)];
        if (!closed.ray([s.x, s.y + 1.6, s.z], d, 500)) misses.push(`${s.x},${s.y},${s.z} dir ${d.map((v) => v.toFixed(2))}`);
      }
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });

  it('has no holes in the footprint: every column of the building has solid ground', () => {
    const holes: string[] = [];
    // inside the outer wall: rounded rectangle offset of the floor edge
    const inside = (x: number, z: number, d: number) => {
      const qx = Math.abs(x) - (FLOOR_HALF_X - CORNER_R), qz = Math.abs(z) - (FLOOR_HALF_Z - CORNER_R);
      if (qx <= 0 || qz <= 0) return Math.abs(x) <= FLOOR_HALF_X + d && Math.abs(z) <= FLOOR_HALF_Z + d;
      return Math.hypot(qx, qz) <= CORNER_R + d;
    };
    for (let x = -68; x <= 68; x += 0.85) {
      for (let z = -55; z <= 55; z += 0.85) {
        if (!inside(x, z, BACK_WALL_D1 - 0.05)) continue;
        const g = groundAt(x, z, 40);
        if (!g || g.y < -1e-3) holes.push(`${x},${z}`);
      }
    }
    expect(holes).toEqual([]);
  });
});

describe('tauron-remake spawns', () => {
  it('has ~24 spawns over floor, tier A, tier C and the concourse', () => {
    const S = TAURON_REMAKE_SPAWNS;
    expect(S.length).toBe(24);
    expect(S.filter((s) => s.y < 2).length).toBe(8);
    expect(S.filter((s) => s.y > 2 && s.y < A_TOP - 0.2).length).toBe(6);
    expect(S.filter((s) => Math.abs(s.y - LEVEL_B - 0.05) < 0.01).length).toBe(6);
    expect(S.filter((s) => s.y > C_WALK_Y && s.y < C_TOP + 1).length).toBe(4);
  });

  it('every spawn stands on a walkable surface, not inside geometry', () => {
    const bad: string[] = [];
    for (const s of TAURON_REMAKE_SPAWNS) {
      const tag = `(${s.x}, ${s.y}, ${s.z})`;
      const g = groundAt(s.x, s.z, s.y + 1.0);
      if (!g) { bad.push(`${tag}: no ground`); continue; }
      if (s.y - g.y < -1e-3 || s.y - g.y > 0.15) bad.push(`${tag}: ground at ${g.y.toFixed(3)}`);
      if (g.ny < 0.85) bad.push(`${tag}: steep ground`);
      // headroom for a standing 1.8 m capsule
      if (solid.ray([s.x, s.y + 0.1, s.z], [0, 1, 0], 2.0)) bad.push(`${tag}: ceiling`);
      // capsule radius 0.35 m: free at knee / waist / head height
      for (const h of [0.6, 1.0, 1.5]) {
        for (let a = 0; a < 8; a++) {
          const dir = [Math.cos((a * Math.PI) / 4), 0, Math.sin((a * Math.PI) / 4)];
          if (solid.ray([s.x, s.y + h, s.z], dir, 0.36)) bad.push(`${tag}: blocked at ${h} m dir ${a}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('tauron-remake routes are climbable (autostep 0.4 m)', () => {
  /** walk along the centre of column `j` from d0 to d1 and record the surface profile */
  function profile(j: number, d0: number, d1: number, fromY: (d: number) => number) {
    const out: { d: number; y: number }[] = [];
    for (let d = d0; d <= d1 + 1e-6; d += 0.05) {
      const p = columnPoint(j, 0.5, d);
      const g = groundAt(p.x, p.z, fromY(d));
      out.push({ d, y: g ? g.y : -99 });
    }
    return out;
  }
  const maxRiser = (pr: { y: number }[]) => Math.max(...pr.slice(1).map((p, i) => Math.abs(p.y - pr[i]!.y)));
  /**
   * Rapier's autostep lifts the whole 1.8 m capsule (radius 0.35) by up to 0.4 m: every ceiling
   * within the capsule's footprint must clear the highest step under it + 2.25 m.
   */
  const autostepBlocked = (j: number, pr: { d: number; y: number }[]) => {
    const bad: string[] = [];
    for (const p of pr) {
      const near = pr.filter((o) => Math.abs(o.d - p.d) <= 0.36);
      const top = Math.max(...near.map((o) => o.y));
      const q = columnPoint(j, 0.5, p.d);
      const up = solid.ray([q.x, p.y + 0.05, q.z], [0, 1, 0], 10);
      if (up && p.y + 0.05 + up.t < top + 2.25) bad.push(`d=${p.d.toFixed(2)} ceiling ${(p.y + 0.05 + up.t).toFixed(2)} < ${(top + 2.25).toFixed(2)}`);
    }
    return bad.slice(0, 5);
  };

  it('A aisle: floor → cross aisle', () => {
    const col = layout().columns.find((c) => c.a === 'aisle' && c.part === 'N')!;
    const pr = profile(col.index, FLOOR_STAIR_D0 - 0.5, A_END + 1, (d) => (d < A_END ? 12 : 12));
    expect(pr[0]!.y).toBeCloseTo(0, 3);
    expect(pr[pr.length - 1]!.y).toBeCloseTo(LEVEL_B, 3);
    expect(maxRiser(pr)).toBeLessThanOrEqual(0.4);
  });

  it('vomitory: cross aisle → concourse is flat and roofed', () => {
    const col = layout().columns.find((c) => c.b === 'vom' && c.a === 'aisle' && c.part === 'S')!;
    const pr = profile(col.index, A_END + 0.2, CONC_D1 - 1, () => 12);
    for (const p of pr) expect(p.y).toBeCloseTo(LEVEL_B, 3);
  });

  it('C stair: concourse → C walkway, then C aisle → top', () => {
    const col = layout().columns.find((c) => c.b === 'cstair' && c.part === 'N')!;
    const pr = profile(col.index, CST_D0 - 0.6, CST_D1 + 0.5, (d) => (d < CST_D0 ? 13.5 : 12.96));
    expect(pr[0]!.y).toBeCloseTo(C_WALK_Y, 3);
    expect(pr[pr.length - 1]!.y).toBeCloseTo(LEVEL_B, 3);
    expect(maxRiser(pr)).toBeLessThanOrEqual(0.4);
    expect(autostepBlocked(col.index, pr)).toEqual([]);
    const aisle = layout().columns.find((c) => c.c === 'aisle' && c.part === 'N')!;
    const pr2 = profile(aisle.index, C_D0 - 1, C_END - 0.1, () => 26);
    expect(pr2[0]!.y).toBeCloseTo(C_WALK_Y, 3);
    expect(pr2[pr2.length - 1]!.y).toBeCloseTo(C_TOP, 3);
    expect(maxRiser(pr2)).toBeLessThanOrEqual(0.4);
  });

  it('player tunnel: floor → concourse', () => {
    const col = layout().columns.find((c) => c.a === 'tunnel' && c.part === 'E')!;
    const pr = profile(col.index, -2, TUN_STAIR_D1 + 0.5, (d) => (d < TUN_STAIR_D0 ? 2.5 : 0.25 + (d - TUN_STAIR_D0) * 0.85 + 1.5));
    expect(pr[0]!.y).toBeCloseTo(0, 3);
    expect(pr[pr.length - 1]!.y).toBeCloseTo(LEVEL_B, 3);
    expect(maxRiser(pr)).toBeLessThanOrEqual(0.4);
    expect(autostepBlocked(col.index, pr)).toEqual([]);
  });

  it('tier A rows sit where the layout says', () => {
    const col = layout().columns.find((c) => c.b === 'box' && c.part === 'E')!;
    const p = columnPoint(col.index, 0.5, A_D0 + 0.4);
    expect(groundAt(p.x, p.z, 5)!.y).toBeCloseTo(1.75, 3);
  });

  it('closed west end: floor reaches the folded-stand facade, balcony on top at the cross-aisle level', () => {
    const col = layout().columns.find((c) => c.closed && c.part === 'W' && c.b === 'box')!;
    const floor = columnPoint(col.index, 0.5, CLOSED_D - 0.5);
    expect(groundAt(floor.x, floor.z, 5)!.y).toBeCloseTo(0, 3);
    const balcony = columnPoint(col.index, 0.5, CLOSED_D + 2.5);
    expect(groundAt(balcony.x, balcony.z, 20)!.y).toBeCloseTo(LEVEL_B, 3);
    // the balcony connects to the concourse through the vomitories
    const vom = layout().columns.find((c) => c.closed && c.part === 'W' && c.b === 'vom' && c.a === 'aisle')!;
    const pr = profile(vom.index, CLOSED_D + 1, CONC_D1 - 1, () => 12);
    for (const p of pr) expect(p.y).toBeCloseTo(LEVEL_B, 3);
    expect(geo.props.filter((p) => p.mat === 'drape').length).toBeGreaterThan(20);
  });

  it('hackathon desks leave the floor routes open', () => {
    const tables = geo.props.filter((p) => p.mat === 'table');
    expect(tables.length).toBeGreaterThan(40);
    // every A aisle foot and tunnel portal has 3 m of clear floor in front of it
    for (const c of layout().columns) {
      if (c.closed || (c.a !== 'aisle' && c.a !== 'tunnel')) continue;
      for (const d of [-2, -3, -4]) {
        const p = columnPoint(c.index, 0.5, d);
        const g = groundAt(p.x, p.z, 3)!;
        expect(g.y, `col ${c.index} d ${d}`).toBeCloseTo(0, 3);
      }
    }
  });
});
