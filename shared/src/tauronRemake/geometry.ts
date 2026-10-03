/**
 * Geometry for the `tauron-remake` map (see layout.ts for the design + sources).
 *
 * Pure TypeScript (no three.js / Rapier) so the client builds meshes + colliders from it and the
 * shared unit tests can raycast against exactly the same triangles.
 *
 * Every (column, band) cell holds a stack of solid y-intervals. The mesher emits a top face per
 * interval top, a bottom face per overhang, and for each of the four cell sides only the parts
 * of an interval NOT covered by the neighbour's intervals. Neighbouring cells share their corner
 * points exactly, so the result is closed by construction (no cracks you can fall/see through).
 */
import {
  A_D0,
  A_END,
  A_FRONT_D1,
  A_GLASS_H,
  A_ROWS,
  A_ROW_D,
  A_WALK_Y,
  BACK_WALL_D1,
  BOX_CEIL,
  BOX_GLASS_D1,
  BOX_REAR_D0,
  C_D0,
  C_END,
  C_GLASS_H,
  C_ROWS,
  C_ROW_D,
  C_TOP,
  C_WALK_Y,
  CONC_CEIL,
  CONC_D1,
  CROSS_END,
  CST_D0,
  CST_D1,
  CST_HEADROOM,
  FLOOR_STAIR_D0,
  FLOOR_STAIR_RISE,
  FLOOR_STAIR_TREAD,
  GROUND,
  LEVEL_B,
  OUTER_WALL_D1,
  ROOF_APEX_Y,
  ROOF_BASE_Y,
  CORNER_R,
  RING_B_END,
  TOP_WALK_D1,
  TUN_STAIR_D0,
  TUN_STAIR_D1,
  WALL_TOP,
  aSeatTop,
  aTop,
  cSeatTop,
  cStairTop,
  cTop,
  columnPoint,
  columnWidth,
  layout,
  loopLength,
  stationPoint,
  tunnelCeil,
  tunnelStairTop,
  type Column,
} from './layout';

export type SurfaceMat =
  | 'floor'
  | 'tier'
  | 'aisle'
  | 'walk'
  | 'concrete'
  | 'wall'
  | 'glass'
  | 'led'
  | 'carpet'
  | 'ceiling'
  /** roof dome (visual only, above reach: not in the collision mesh) */
  | 'roof';

export type PropMat = 'stage' | 'case' | 'barrier' | 'screen' | 'truss' | 'speaker' | 'pillar' | 'kiosk' | 'sign' | 'furniture' | 'metal';

interface Iv {
  y0: number;
  y1: number;
  top: SurfaceMat;
  side: SurfaceMat;
  /** material of the side facing the floor (−d), e.g. LED boards */
  sideIn?: SurfaceMat;
  bot?: SurfaceMat;
}

const EPS = 1e-4;

// ------------------------------------------------------------------ cell contents

function walkwayOrRows(col: Column, dm: number, bottom: number): Iv[] {
  if (dm < C_D0) {
    const out: Iv[] = [{ y0: bottom, y1: C_WALK_Y, top: 'walk', side: 'concrete', sideIn: dm < BOX_GLASS_D1 ? 'led' : undefined }];
    if (dm < BOX_GLASS_D1) out.push({ y0: C_WALK_Y, y1: C_WALK_Y + C_GLASS_H, top: 'glass', side: 'glass' });
    return out;
  }
  const aisle = col.c === 'aisle';
  const top = cTop(dm, aisle);
  return top - bottom >= 0.3 ? [{ y0: bottom, y1: top, top: aisle ? 'aisle' : 'tier', side: aisle ? 'aisle' : 'tier' }] : [];
}

function stairCell(dm: number, ceilMin: number, col: Column): Iv[] {
  const top = cStairTop(dm);
  const out: Iv[] = [{ y0: GROUND, y1: top, top: 'aisle', side: 'aisle' }];
  out.push(...walkwayOrRows(col, dm, Math.max(ceilMin, top + CST_HEADROOM)));
  return out;
}

function ringB(col: Column, dm: number): Iv[] {
  if (col.b === 'cstair') {
    if (dm < CST_D0) {
      const out: Iv[] = [{ y0: GROUND, y1: C_WALK_Y, top: 'walk', side: 'wall' }];
      if (dm < BOX_GLASS_D1) out.push({ y0: C_WALK_Y, y1: C_WALK_Y + C_GLASS_H, top: 'glass', side: 'glass' });
      return out;
    }
    return stairCell(dm, BOX_CEIL, col);
  }
  const room = col.b === 'box' || col.b === 'door';
  const out: Iv[] = [{ y0: GROUND, y1: LEVEL_B, top: room ? 'carpet' : 'walk', side: 'concrete' }];
  const front = dm < BOX_GLASS_D1;
  const rear = dm >= BOX_REAR_D0;
  if (col.b === 'wall') out.push({ y0: LEVEL_B, y1: BOX_CEIL, top: 'wall', side: 'wall' });
  else if (col.b === 'box' && front) out.push({ y0: LEVEL_B, y1: BOX_CEIL, top: 'glass', side: 'glass' });
  else if (room && rear) out.push({ y0: LEVEL_B, y1: BOX_CEIL, top: 'wall', side: 'wall' });
  out.push(...walkwayOrRows(col, dm, BOX_CEIL));
  return out;
}

function concourse(col: Column, dm: number): Iv[] {
  if (col.b === 'cstair' && dm < CST_D1) return stairCell(dm, CONC_CEIL, col);
  const out: Iv[] = [{ y0: GROUND, y1: LEVEL_B, top: 'carpet', side: 'concrete' }];
  if (col.rail && dm < TUN_STAIR_D1) out.push({ y0: LEVEL_B, y1: LEVEL_B + 1.05, top: 'wall', side: 'wall' });
  out.push(...walkwayOrRows(col, dm, CONC_CEIL));
  return out;
}

function baseCell(col: Column, dm: number): Iv[] {
  if (dm < 0) {
    if (col.a === 'aisle') {
      const k = Math.floor((dm - FLOOR_STAIR_D0) / FLOOR_STAIR_TREAD);
      return [{ y0: GROUND, y1: FLOOR_STAIR_RISE * (k + 1), top: 'aisle', side: 'aisle' }];
    }
    return [{ y0: GROUND, y1: 0, top: 'floor', side: 'concrete' }];
  }
  if (dm < A_FRONT_D1) {
    if (col.a === 'aisle') return [{ y0: GROUND, y1: A_WALK_Y, top: 'aisle', side: 'concrete', sideIn: 'led' }];
    return [
      { y0: GROUND, y1: A_WALK_Y, top: 'concrete', side: 'concrete', sideIn: 'led' },
      { y0: A_WALK_Y, y1: A_WALK_Y + A_GLASS_H, top: 'glass', side: 'glass' },
    ];
  }
  if (dm < A_D0) return [{ y0: GROUND, y1: A_WALK_Y, top: 'walk', side: 'concrete' }];
  if (dm < A_END) {
    const aisle = col.a === 'aisle';
    return [{ y0: GROUND, y1: aTop(dm, aisle), top: aisle ? 'aisle' : 'tier', side: aisle ? 'aisle' : 'tier' }];
  }
  if (dm < CROSS_END) return [{ y0: GROUND, y1: LEVEL_B, top: 'walk', side: 'concrete' }];
  if (dm < RING_B_END) return ringB(col, dm);
  if (dm < CONC_D1) return concourse(col, dm);
  if (dm < OUTER_WALL_D1) {
    const aisle = col.c === 'aisle';
    const top = dm < C_END ? cTop(dm, aisle) : C_TOP;
    return [{ y0: GROUND, y1: top, top: dm < C_END ? (aisle ? 'aisle' : 'tier') : 'walk', side: 'wall' }];
  }
  if (dm < TOP_WALK_D1) return [{ y0: GROUND, y1: C_TOP, top: 'walk', side: 'wall' }];
  return [{ y0: GROUND, y1: WALL_TOP, top: 'concrete', side: 'wall' }];
}

function cellIntervals(col: Column, d0: number, d1: number): Iv[] {
  const dm = (d0 + d1) / 2;
  if (col.a === 'tunnel' && dm < TUN_STAIR_D1) {
    const base = baseCell({ ...col, a: 'seat', b: 'vom' }, dm);
    const ceil = tunnelCeil(dm);
    const out: Iv[] = [];
    for (const iv of base) {
      if (iv.y1 <= 0.01) continue;
      const y0 = Math.max(iv.y0, ceil);
      if (iv.y1 - y0 < 0.3) continue;
      out.push({ ...iv, y0 });
    }
    const stair = dm >= TUN_STAIR_D0;
    out.unshift({ y0: GROUND, y1: stair ? tunnelStairTop(dm) : 0, top: stair ? 'aisle' : 'concrete', side: stair ? 'aisle' : 'concrete' });
    return out;
  }
  return baseCell(col, dm);
}

// ------------------------------------------------------------------ mesh output

export interface MeshGroup {
  /** non-indexed triangles: xyz per vertex */
  positions: number[];
  normals: number[];
  uvs: number[];
  /** per-vertex brightness (baked "interior" shading), 0..1 */
  shade: number[];
}

export interface Prop {
  /** centre */
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  mat: PropMat;
  collide: boolean;
}

export interface Seat {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tier: 'A' | 'C';
  row: number;
}

export interface ArenaGeometry {
  groups: Partial<Record<SurfaceMat, MeshGroup>>;
  /** welded collision trimesh of the whole bowl + floor */
  collision: { vertices: Float32Array; indices: Uint32Array };
  props: Prop[];
  seats: Seat[];
  stats: { columns: number; bands: number; triangles: number; collisionTriangles: number };
}

type V3 = [number, number, number];

class Builder {
  groups: Partial<Record<SurfaceMat, MeshGroup>> = {};
  col: number[] = [];

  private group(mat: SurfaceMat): MeshGroup {
    let g = this.groups[mat];
    if (!g) {
      g = { positions: [], normals: [], uvs: [], shade: [] };
      this.groups[mat] = g;
    }
    return g;
  }

  /** quad a-b-c-d (any winding); oriented so its normal points along `want` */
  quad(mat: SurfaceMat, a: V3, b: V3, c: V3, d: V3, want: V3, shade: number, collide = true, uOf?: Map<V3, number>) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) {
      [b, d] = [d, b];
      nx = -nx; ny = -ny; nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return;
    nx /= len; ny /= len; nz /= len;
    const g = this.group(mat);
    const horizontal = Math.abs(ny) > 0.5;
    // side faces: u runs along the face's horizontal tangent so collinear faces line up
    let tx = 0, tz = 0;
    if (!horizontal) {
      const tl = Math.hypot(nz, nx) || 1;
      // viewer's right-hand direction when facing the face (texture text reads left → right)
      tx = nz / tl;
      tz = -nx / tl;
    }
    const tri = (p: V3, q: V3, r: V3) => {
      for (const v of [p, q, r]) {
        g.positions.push(v[0], v[1], v[2]);
        g.normals.push(nx, ny, nz);
        if (horizontal) g.uvs.push(v[0], v[2]);
        else g.uvs.push(uOf?.get(v) ?? v[0] * tx + v[2] * tz, v[1]);
        g.shade.push(shade);
        if (collide) this.col.push(v[0], v[1], v[2]);
      }
    };
    tri(a, b, c);
    if (d !== c) tri(a, c, d);
  }
}

function weld(flat: number[]): { vertices: Float32Array; indices: Uint32Array } {
  const map = new Map<string, number>();
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < flat.length; i += 3) {
    const x = flat[i]!, y = flat[i + 1]!, z = flat[i + 2]!;
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      verts.push(x, y, z);
      map.set(key, id);
    }
    idx.push(id);
  }
  // drop degenerate triangles (welding can collapse slivers)
  const out: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]!, b = idx[i + 1]!, c = idx[i + 2]!;
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(out) };
}

/** interval list minus the union of `cover` */
function subtract(y0: number, y1: number, cover: Iv[]): [number, number][] {
  let pieces: [number, number][] = [[y0, y1]];
  for (const c of cover) {
    const next: [number, number][] = [];
    for (const [a, b] of pieces) {
      if (c.y1 <= a + EPS || c.y0 >= b - EPS) {
        next.push([a, b]);
        continue;
      }
      if (c.y0 > a + EPS) next.push([a, c.y0]);
      if (c.y1 < b - EPS) next.push([c.y1, b]);
    }
    pieces = next;
  }
  return pieces.filter(([a, b]) => b - a > EPS);
}

const INTERIOR_SHADE = 0.5;

function hasAbove(cell: Iv[], y: number): boolean {
  return cell.some((iv) => iv.y0 >= y - EPS);
}

// ------------------------------------------------------------------ props

function propAt(j: number, f: number, d: number, y: number, sx: number, sy: number, sz: number, mat: PropMat, collide = true): Prop {
  const p = columnPoint(j, f, d);
  return { x: p.x, y: y + sy / 2, z: p.z, sx, sy, sz, yaw: p.yawIn, mat, collide };
}

function floorProps(): Prop[] {
  const P: Prop[] = [];
  const box = (x: number, z: number, sx: number, sy: number, sz: number, mat: PropMat, y = 0, yaw = 0, collide = true) =>
    P.push({ x, y: y + sy / 2, z, sx, sy, sz, yaw, mat, collide });

  // ---- stage at the west end (front faces +x), 1.5 m deck
  const SX0 = -33.5, SX1 = -23.5, SZ = 9, SH = 1.5;
  box((SX0 + SX1) / 2, 0, SX1 - SX0, SH, SZ * 2, 'stage');
  // side stairs (4 × 0.375 m) on both ends of the deck
  for (const s of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const depth = 0.3 * (4 - i);
      box(-25.75, s * (SZ + depth / 2), 2.5, 0.375 * (i + 1), depth, 'stage');
    }
  }
  // LED wall + truss towers + speaker stacks
  box(-33.2, 0, 0.4, 6, 16, 'screen', SH);
  for (const s of [1, -1]) {
    box(-33.1, s * 8.6, 0.5, 8.5, 0.5, 'truss', SH);
    box(-24.0, s * 8.6, 0.5, 8.5, 0.5, 'truss', SH);
    box(-22.4, s * 10.1, 1.5, 3.8, 1.5, 'speaker');
  }
  // stage roof truss (visual, above jump reach from the deck)
  box(-28.6, 0, 9.6, 0.5, 0.5, 'truss', SH + 8.5, 0, false);
  for (const s of [1, -1]) box(-28.6, s * 8.6, 9.6, 0.5, 0.5, 'truss', SH + 8.5, 0, false);
  box(-24.0, 0, 0.5, 0.5, 17.7, 'truss', SH + 8.5, 0, false);
  box(-33.1, 0, 0.5, 0.5, 17.7, 'truss', SH + 8.5, 0, false);

  // ---- crowd barricade in front of the stage, with gaps
  for (let i = -4; i <= 4; i++) {
    if (i === 0) continue;
    box(-21.2, i * 2.9, 0.55, 1.15, 2.3, 'barrier');
  }
  box(-21.2, 0, 0.55, 1.15, 1.4, 'barrier');

  // ---- front-of-house mixing tower (climbable: 0.4 m step then the 0.8 m deck... via a crate)
  box(13, 0, 4.4, 0.8, 4, 'stage');
  box(15.6, 0, 0.8, 0.4, 2.2, 'case');
  box(12.4, 0, 1.0, 1.0, 3.0, 'case', 0.8);
  box(14.9, 0, 0.12, 1.0, 4, 'barrier', 0.8);
  box(11.1, 0, 0.12, 2.6, 4, 'barrier', 0.8);
  box(13, 0, 4.4, 0.15, 4.2, 'metal', 3.4, 0, false);

  // ---- road cases (1.2 × 1.0 × 0.8) in small stacks + pallets / risers
  const cases: [number, number, number, number][] = [
    // x, z, yaw, stack height (1 or 2)
    [-14, 13, 0.2, 2], [-14, -13, -0.2, 2], [-12.6, 14.2, 0, 1], [-12.6, -14.2, 0, 1],
    [0, 15.5, 0, 1], [1.3, 15.5, 0, 2], [0, -15.5, 0, 2], [1.3, -15.5, 0, 1],
    [15, 14, 0.5, 2], [15, -14, -0.5, 2], [24, 7, 0, 1], [24, -7, 0, 1], [24.8, 8.2, 0.3, 2], [24.8, -8.2, -0.3, 2],
    [-5, 6.5, 0.8, 1], [-5, -6.5, -0.8, 1], [5, 7.5, 0, 2], [5, -7.5, 0, 2],
    [29, 0, 1.57, 2], [29, 1.3, 1.57, 1],
  ];
  for (const [x, z, yaw, h] of cases) {
    box(x, z, 1.2, 1.0, 0.8, 'case', 0, yaw);
    if (h > 1) box(x, z, 1.2, 1.0, 0.8, 'case', 1.0, yaw + 0.05);
  }
  box(-8, 0, 2.2, 0.4, 4, 'stage'); // low riser
  box(-10.2, 0, 2.2, 0.8, 4, 'stage'); // step up from the riser
  box(21, 16, 2.4, 2.2, 2.4, 'speaker');
  box(21, -16, 2.4, 2.2, 2.4, 'speaker');
  box(-16, 0, 1.6, 1.6, 3.2, 'case');
  return P;
}

function bowlProps(): Prop[] {
  const P: Prop[] = [];
  const { columns } = layout();
  const n = columns.length;
  for (const col of columns) {
    const j = col.index;
    const next = columns[(j + 1) % n]!;
    // concourse pillars at box partitions
    if (col.b === 'wall' && next.b === 'box') P.push(propAt(j, 0.5, 26.0, LEVEL_B, 0.9, CONC_CEIL - LEVEL_B, 0.9, 'pillar'));
    // kiosks against the outer concourse wall
    if (col.b === 'door' && col.c === 'aisle') {
      const w = Math.min(2.8, columnWidth(j, 28.5) + 1.2);
      P.push(propAt(j, 0.5, 28.35, LEVEL_B, w, 1.1, 0.8, 'kiosk'));
      P.push(propAt(j, 0.5, 29.5, LEVEL_B, w + 0.6, 3.2, 0.7, 'kiosk'));
      P.push(propAt(j, 0.5, 29.1, LEVEL_B + 2.4, w + 0.4, 0.6, 0.12, 'sign', false));
    }
    // box furniture: a counter in every glass box
    if (col.b === 'box') P.push(propAt(j, 0.5, 18.9, LEVEL_B, Math.min(1.1, columnWidth(j, 18.9) - 0.3), 1.0, 0.7, 'furniture'));
  }
  return P;
}

// ------------------------------------------------------------------ seats

const SEAT_PITCH = 0.5;

/**
 * Seats along every row: consecutive seat columns form one run (narrow partition columns
 * included), seats are spaced evenly along the run's polyline at the back of the tread.
 */
function seats(): Seat[] {
  const out: Seat[] = [];
  const { columns } = layout();
  const n = columns.length;
  const rowRuns = (has: (c: Column) => boolean, d: number, y: number, tier: 'A' | 'C', row: number) => {
    const start = columns.findIndex((c) => !has(c));
    if (start < 0) return;
    let run: number[] = [];
    const flush = () => {
      if (!run.length) return;
      // polyline over the run's station points
      const pts: [number, number][] = [];
      for (const j of run) pts.push(stationPoint(j, d));
      pts.push(stationPoint(run[run.length - 1]! + 1, d));
      const seg: number[] = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        const l = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
        seg.push(l);
        total += l;
      }
      const count = Math.floor((total - 0.15) / SEAT_PITCH);
      for (let s = 0; s < count; s++) {
        let t = ((s + 0.5) / count) * total;
        let i = 0;
        while (i < seg.length - 1 && t > seg[i]!) t -= seg[i++]!;
        const f = seg[i]! > 0 ? t / seg[i]! : 0;
        const p = columnPoint(run[i]!, f, d);
        out.push({ x: p.x, y, z: p.z, yaw: p.yawIn, tier, row });
      }
      run = [];
    };
    for (let k = 1; k <= n; k++) {
      const j = (start + k) % n;
      if (has(columns[j]!)) run.push(j);
      else flush();
    }
    flush();
  };
  for (let i = 0; i < A_ROWS; i++) {
    const has = (c: Column) => c.a === 'seat' || (c.a === 'tunnel' && i >= 4);
    rowRuns(has, A_D0 + (i + 1) * A_ROW_D - 0.34, aSeatTop(i), 'A', i);
  }
  for (let i = 0; i < C_ROWS; i++) {
    const has = (c: Column) => c.c === 'seat' || (c.c === 'stair' && i >= 6);
    rowRuns(has, C_D0 + (i + 1) * C_ROW_D - 0.34, cSeatTop(i), 'C', i);
  }
  return out;
}

// ------------------------------------------------------------------ build

export function buildArenaGeometry(): ArenaGeometry {
  const { columns, bands } = layout();
  const nc = columns.length;
  const nb = bands.length - 1;
  const cells: Iv[][][] = [];
  for (let j = 0; j < nc; j++) {
    const row: Iv[][] = [];
    for (let k = 0; k < nb; k++) row.push(cellIntervals(columns[j]!, bands[k]!, bands[k + 1]!).sort((a, b) => a.y0 - b.y0));
    cells.push(row);
  }
  const FLOOR_SLAB: Iv[] = [{ y0: GROUND, y1: 0, top: 'floor', side: 'concrete' }];
  const B = new Builder();
  const P = (j: number, d: number, y: number): V3 => {
    const [x, z] = stationPoint(j, d);
    return [x, y, z];
  };

  // ---- top + bottom faces, merged along d inside a column
  for (let j = 0; j < nc; j++) {
    type Run = { k0: number; k1: number; y: number; mat: SurfaceMat; shade: number; up: boolean };
    let active = new Map<string, Run>();
    const flush = (r: Run) => {
      const d0 = bands[r.k0]!, d1 = bands[r.k1 + 1]!;
      B.quad(r.mat, P(j, d0, r.y), P(j + 1, d0, r.y), P(j + 1, d1, r.y), P(j, d1, r.y), [0, r.up ? 1 : -1, 0], r.shade);
    };
    for (let k = 0; k < nb; k++) {
      const cell = cells[j]![k]!;
      const next = new Map<string, Run>();
      const add = (y: number, mat: SurfaceMat, shade: number, up: boolean) => {
        const key = `${up ? 'u' : 'd'}${y.toFixed(4)}${mat}${shade}`;
        const r = active.get(key);
        if (r && r.k1 === k - 1) {
          r.k1 = k;
          next.set(key, r);
          active.delete(key);
        } else next.set(key, { k0: k, k1: k, y, mat, shade, up });
      };
      for (const iv of cell) {
        if (!cell.some((o) => o !== iv && Math.abs(o.y0 - iv.y1) < EPS)) {
          add(iv.y1, iv.top, hasAbove(cell, iv.y1 + EPS) ? INTERIOR_SHADE : 1, true);
        }
        if (iv.y0 > GROUND + EPS && !cell.some((o) => o !== iv && Math.abs(o.y1 - iv.y0) < EPS)) {
          add(iv.y0, iv.bot ?? 'ceiling', INTERIOR_SHADE, false);
        }
      }
      for (const r of active.values()) flush(r);
      active = next;
    }
    for (const r of active.values()) flush(r);
  }

  // ---- radial sides (between bands k-1 | k, and the inner/outer grid edges)
  for (let j = 0; j < nc; j++) {
    for (let k = 0; k <= nb; k++) {
      const inner = k > 0 ? cells[j]![k - 1]! : FLOOR_SLAB;
      const outer = k < nb ? cells[j]![k]! : [];
      const d = bands[k]!;
      const [x0, z0] = stationPoint(j, d);
      const [x1, z1] = stationPoint(j + 1, d);
      // outward (+d) direction ≈ perpendicular to the edge
      const ex = x1 - x0, ez = z1 - z0;
      let ox = ez, oz = -ex;
      const mid = stationPoint(j, d + 1);
      const mid2 = stationPoint(j + 1, d + 1);
      const dirx = (mid[0] + mid2[0]) / 2 - (x0 + x1) / 2, dirz = (mid[1] + mid2[1]) / 2 - (z0 + z1) / 2;
      if (ox * dirx + oz * dirz < 0) { ox = -ox; oz = -oz; }
      // u = arc length along the loop at this offset: LED boards scroll continuously round the bowl
      const s0 = loopLength(j, d), s1 = loopLength(j + 1, d);
      // faces of `inner` cell facing outward (+d) — only for real cells
      if (k > 0) {
        for (const iv of inner) {
          for (const [a, b] of subtract(iv.y0, iv.y1, outer)) {
            const shade = hasAbove(inner, b) || hasAbove(outer, b) ? INTERIOR_SHADE : 1;
            const A: V3 = [x0, a, z0], Bq: V3 = [x1, a, z1], C: V3 = [x1, b, z1], D: V3 = [x0, b, z0];
            B.quad(iv.side, A, Bq, C, D, [ox, 0, oz], shade, true, new Map([[A, -s0], [D, -s0], [Bq, -s1], [C, -s1]]));
          }
        }
      }
      if (k < nb) {
        for (const iv of outer) {
          for (const [a, b] of subtract(iv.y0, iv.y1, inner)) {
            const shade = hasAbove(inner, b) || hasAbove(outer, b) ? INTERIOR_SHADE : 1;
            const A: V3 = [x0, a, z0], Bq: V3 = [x1, a, z1], C: V3 = [x1, b, z1], D: V3 = [x0, b, z0];
            B.quad(iv.sideIn ?? iv.side, A, Bq, C, D, [-ox, 0, -oz], shade, true, new Map([[A, s0], [D, s0], [Bq, s1], [C, s1]]));
          }
        }
      }
    }
  }

  // ---- tangential sides (between column j-1 | j at station j), merged along d
  for (let j = 0; j < nc; j++) {
    const jl = (j - 1 + nc) % nc;
    const st = layout().stations[j]!;
    // direction from column jl into column j ≈ along the loop tangent
    const [ax, az] = stationPoint(j, 5);
    const [bx, bz] = stationPoint(j + 1, 5);
    let tx = bx - ax, tz = bz - az;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    // project out the normal component so the face normal is horizontal + perpendicular to the edge
    const dn = tx * st.nx + tz * st.nz;
    tx -= dn * st.nx; tz -= dn * st.nz;
    type Run = { k0: number; k1: number; a: number; b: number; mat: SurfaceMat; shade: number; dir: 1 | -1 };
    let active = new Map<string, Run>();
    const flush = (r: Run) => {
      const d0 = bands[r.k0]!, d1 = bands[r.k1 + 1]!;
      B.quad(r.mat, P(j, d0, r.a), P(j, d1, r.a), P(j, d1, r.b), P(j, d0, r.b), [tx * r.dir, 0, tz * r.dir], r.shade);
    };
    for (let k = 0; k < nb; k++) {
      const L = cells[jl]![k]!;
      const R = cells[j]![k]!;
      const next = new Map<string, Run>();
      const add = (a: number, b: number, mat: SurfaceMat, shade: number, dir: 1 | -1) => {
        const key = `${dir}${a.toFixed(4)}:${b.toFixed(4)}${mat}${shade}`;
        const r = active.get(key);
        if (r && r.k1 === k - 1) {
          r.k1 = k;
          next.set(key, r);
          active.delete(key);
        } else next.set(key, { k0: k, k1: k, a, b, mat, shade, dir });
      };
      for (const iv of L) {
        for (const [a, b] of subtract(iv.y0, iv.y1, R)) add(a, b, iv.side, hasAbove(L, b) || hasAbove(R, b) ? INTERIOR_SHADE : 1, 1);
      }
      for (const iv of R) {
        for (const [a, b] of subtract(iv.y0, iv.y1, L)) add(a, b, iv.side, hasAbove(L, b) || hasAbove(R, b) ? INTERIOR_SHADE : 1, -1);
      }
      for (const r of active.values()) flush(r);
      active = next;
    }
    for (const r of active.values()) flush(r);
  }

  // ---- event floor: fan over the inner outline (d = FLOOR_STAIR_D0)
  for (let j = 0; j < nc; j++) {
    const a = P(j, FLOOR_STAIR_D0, 0);
    const b = P(j + 1, FLOOR_STAIR_D0, 0);
    const c: V3 = [0, 0, 0];
    // fan triangle as a degenerate quad (c twice) keeps the Builder API simple
    B.quad('floor', a, b, c, c, [0, 1, 0], 1);
  }

  // ---- roof dome: rings from the back-wall top inward, sealed onto the wall's outer edge
  {
    const RINGS = 14;
    const dAt = (t: number) => BACK_WALL_D1 - t * (BACK_WALL_D1 + CORNER_R - 0.5);
    const yAt = (t: number) => ROOF_BASE_Y + (ROOF_APEX_Y - ROOF_BASE_Y) * Math.sin((t * Math.PI) / 2);
    for (let r = 0; r < RINGS; r++) {
      const t0 = r / RINGS, t1 = (r + 1) / RINGS;
      for (let j = 0; j < nc; j++) {
        const [ax, az] = stationPoint(j, dAt(t0));
        const [bx, bz] = stationPoint(j + 1, dAt(t0));
        const [cx, cz] = stationPoint(j + 1, dAt(t1));
        const [dx, dz] = stationPoint(j, dAt(t1));
        B.quad('roof', [ax, yAt(t0), az], [bx, yAt(t0), bz], [cx, yAt(t1), cz], [dx, yAt(t1), dz], [0, -1, 0], 1, false);
      }
    }
    for (let j = 0; j < nc; j++) {
      const a = P(j, dAt(1), ROOF_APEX_Y);
      const b = P(j + 1, dAt(1), ROOF_APEX_Y);
      const c: V3 = [0, ROOF_APEX_Y, 0];
      B.quad('roof', a, b, c, c, [0, -1, 0], 1, false);
    }
  }

  const groups = B.groups;
  let triangles = 0;
  for (const g of Object.values(groups)) triangles += (g?.positions.length ?? 0) / 9;
  const collision = weld(B.col);
  return {
    groups,
    collision,
    props: [...floorProps(), ...bowlProps()],
    seats: seats(),
    stats: { columns: nc, bands: nb, triangles, collisionTriangles: collision.indices.length / 3 },
  };
}
