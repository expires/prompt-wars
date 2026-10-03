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
  CLOSED_D,
  CLOSED_RAIL_D1,
  DRAPE_D,
  RECESS_D1,
  RECESS_H,
  isRecessColumn,
  DRAPE_Y0,
  FLOOR_HALF_X,
  FLOOR_HALF_Z,
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
  /** aisle stair risers (concrete, painted row numbers) */
  | 'riser'
  /** telescopic tier A risers: steel nosing over purple under-lighting */
  | 'shelf'
  /** folded retractable stands + service doors on the closed end */
  | 'stands'
  /** upper bowl wall: cracked mosaic pattern (visual only where above reach) */
  | 'mosaic'
  /** roof dome (visual only, above reach: not in the collision mesh) */
  | 'roof';

export type PropMat =
  | 'stage'
  | 'table'
  | 'truss'
  | 'speaker'
  /** magenta LED (stage edge strips, LED truss frame) */
  | 'led'
  /** "YEAH HACK" letter cubes (tag = letter index) */
  | 'letters'
  | 'pillar'
  /** pillar wraps (tag 0 = red/white, 1 = magenta) */
  | 'wrap'
  | 'counter'
  | 'accent'
  /** hanging concourse signs (tag = variant) */
  | 'sign'
  | 'exit'
  | 'door'
  | 'bin'
  | 'vending'
  | 'glassdoor'
  | 'drape'
  | 'metal'
  /** purple HackYeah fabric banners hung from balcony rails (tag = text variant) */
  | 'banner'
  /** pink neon "INFO" sign on the folded stands */
  | 'neon'
  /** roll-up banner on a foot (tag = variant) */
  | 'rollup'
  /** bean bag (tag = colour) */
  | 'beanbag'
  /** black flight case with aluminium edges */
  | 'case'
  /** white electrical distribution box */
  | 'ebox'
  /** red fire-hose cabinet */
  | 'cabinet'
  /** yellow / black cable ramp protector (flat on the floor) */
  | 'ramp'
  /** pink TAURON | ARENA KRAKÓW fence banner */
  | 'fence'
  /** TV screen on a stand */
  | 'screen'
  /** wooden table (mentors village) */
  | 'wood'
  /** blue plastic chair (mentors village) */
  | 'chairblue'
  /** purple cardboard stand-up sign */
  | 'standee'
  /** grey steel service doors (tag 0) / lift doors (tag 1) */
  | 'greydoor';

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
  return top - bottom >= 0.3 ? [{ y0: bottom, y1: top, top: aisle ? 'aisle' : 'tier', side: aisle ? 'riser' : 'tier' }] : [];
}

function stairCell(dm: number, ceilMin: number, col: Column): Iv[] {
  const top = cStairTop(dm);
  const out: Iv[] = [{ y0: GROUND, y1: top, top: 'aisle', side: 'riser' }];
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
  if (col.closed && dm < CROSS_END) {
    // closed end: event floor up to the folded-stand facade, balcony (+ railing) on top of it
    if (dm < CLOSED_D) return [{ y0: GROUND, y1: 0, top: 'floor', side: 'concrete' }];
    const out: Iv[] = [{ y0: GROUND, y1: LEVEL_B, top: 'walk', side: 'concrete', sideIn: 'stands' }];
    if (dm < CLOSED_RAIL_D1) out.push({ y0: LEVEL_B, y1: LEVEL_B + 1.0, top: 'glass', side: 'glass' });
    return out;
  }
  if (dm < 0) {
    if (col.a === 'aisle') {
      const k = Math.floor((dm - FLOOR_STAIR_D0) / FLOOR_STAIR_TREAD);
      return [{ y0: GROUND, y1: FLOOR_STAIR_RISE * (k + 1), top: 'aisle', side: 'riser' }];
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
    return [{ y0: GROUND, y1: aTop(dm, aisle), top: aisle ? 'aisle' : 'tier', side: aisle ? 'riser' : 'shelf' }];
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
  return [{ y0: GROUND, y1: WALL_TOP, top: 'concrete', side: 'wall', sideIn: 'mosaic' }];
}

function cellIntervals(col: Column, d0: number, d1: number): Iv[] {
  const dm = (d0 + d1) / 2;
  if (col.closed) {
    // closed end: everything under the balcony is painted white (recess walls, facade returns)
    const base = baseCell(col, dm).map((iv) => (iv.side === 'concrete' && iv.y1 <= LEVEL_B + EPS ? { ...iv, side: 'wall' as SurfaceMat } : iv));
    if (!isRecessColumn(col) || dm < CLOSED_D || dm >= RECESS_D1) return base;
    // service tunnel through the folded stands: concrete floor, solid above RECESS_H
    const out: Iv[] = [{ y0: GROUND, y1: 0, top: 'walk', side: 'wall' }];
    for (const iv of base) {
      const y0 = Math.max(iv.y0, RECESS_H);
      if (iv.y1 - y0 < 0.3) continue;
      out.push({ ...iv, y0 });
    }
    return out;
  }
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
  /** render as an upright cylinder (diameter sx) */
  cyl?: boolean;
  /** material-specific variant (letter index, sign variant, …) */
  tag?: number;
}

export interface Seat {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** A lower ring, C upper ring, B glass boxes (red VIP seats) */
  tier: 'A' | 'B' | 'C';
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

/** signed offset of (x, z) from the floor edge (rounded rectangle): < 0 inside the floor */
export function floorEdgeOffset(x: number, z: number): number {
  const qx = Math.abs(x) - (FLOOR_HALF_X - CORNER_R);
  const qz = Math.abs(z) - (FLOOR_HALF_Z - CORNER_R);
  if (qx <= 0 && qz <= 0) return Math.max(qx, qz) - CORNER_R;
  if (qx <= 0) return qz - CORNER_R;
  if (qz <= 0) return qx - CORNER_R;
  return Math.hypot(qx, qz) - CORNER_R;
}

/** the closed (west) end: floor reaches the folded-stand facade at CLOSED_D */
const isClosedSide = (x: number) => x < -(FLOOR_HALF_X - CORNER_R);

/** is (x, z) on the event floor with at least `margin` m to the stands / facade? */
export function floorClear(x: number, z: number, margin: number): boolean {
  return floorEdgeOffset(x, z) <= (isClosedSide(x) ? CLOSED_D : 0) - margin;
}

export const TABLE_DEPTH = 0.8;
export const TABLE_H = 0.75;
/** hackathon desk rows run along z; x of each row (E block, W block) */
export const TABLE_ROWS_X = [11, 14.4, 17.8, 21.2, 24.6, 28, -11, -14.4, -17.8, -21.2, -24.6, -28, -31.4, -34.8, -38.2];
/** facade plane of the folded stands on the closed (west) end */
export const FACADE_X = -(FLOOR_HALF_X + CLOSED_D);
/** centre lane |z| < TABLE_LANE stays open (E tunnel, stage sightline); cross lane gap around |z| ≈ 11.5 */
const TABLE_LANE = 3.5;
const CROSS_GAP: [number, number] = [10.6, 12.6];
export const STAGE = { x0: -6, x1: 6, z0: -4, z1: 4, h: 1.2 };
export const STAGE_FRAME = { x: 8, z: 6.6, y: 10.5 };

function floorProps(): Prop[] {
  const P: Prop[] = [];
  const box = (x: number, z: number, sx: number, sy: number, sz: number, mat: PropMat, y = 0, yaw = 0, collide = true, extra: Partial<Prop> = {}) =>
    P.push({ x, y: y + sy / 2, z, sx, sy, sz, yaw, mat, collide, ...extra });

  // ---- central stage under the scoreboard (front faces +x / east), black deck with LED edges
  const S = STAGE;
  const sxm = (S.x0 + S.x1) / 2;
  box(sxm, 0, S.x1 - S.x0, S.h, S.z1 - S.z0, 'stage');
  // side stairs (4 × 0.3 m) at both ends, toward the back of the deck
  for (const s of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const depth = 0.3 * (4 - i);
      box(-3.5, s * (S.z1 + depth / 2), 2.4, 0.3 * (i + 1), depth, 'stage');
    }
  }
  // magenta LED strips round the deck edge (top lip + skirt line)
  const L = 0.06;
  for (const y of [S.h - 0.07, 0.05]) {
    box(sxm, S.z1 + L / 2, S.x1 - S.x0 + 2 * L, 0.07, L, 'led', y, 0, false);
    box(sxm, S.z0 - L / 2, S.x1 - S.x0 + 2 * L, 0.07, L, 'led', y, 0, false);
    box(S.x1 + L / 2, 0, L, 0.07, S.z1 - S.z0, 'led', y, 0, false);
    box(S.x0 - L / 2, 0, L, 0.07, S.z1 - S.z0, 'led', y, 0, false);
  }
  // "YEAH" over "HACK" letter cubes at the front of the deck (cover on the stage)
  const C = 0.9;
  for (let i = 0; i < 8; i++) {
    const row = i < 4 ? 1 : 0;
    const k = i % 4;
    box(S.x1 - 1.0, (1.5 - k) * (C + 0.04), C, C, C, 'letters', S.h + row * C, Math.PI / 2, true, { tag: i });
  }
  // DJ / host desk at the back of the deck
  box(-3.2, 0, 0.9, 1.0, 3.2, 'speaker', S.h);
  // black truss towers at the frame corners (collide), line arrays hanging beside them,
  // magenta LED truss frame overhead (visual): silver box truss with LED dashes along it
  const F = STAGE_FRAME;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      box(sx * F.x, sz * F.z, 0.4, F.y, 0.4, 'speaker');
      box(sx * F.x, sz * F.z, 1.4, 0.08, 1.4, 'speaker', 0, 0, false); // base plate
      box(sx * (F.x - 0.75), sz * (F.z - 0.2), 0.8, 3.6, 0.9, 'speaker', F.y - 4.6, 0, false); // line array
    }
    // subs on the floor beside the deck
    box(sx * 7.3, S.z1 + 1.4, 1.2, 1.1, 1.2, 'speaker');
    box(sx * 7.3, S.z0 - 1.4, 1.2, 1.1, 1.2, 'speaker');
  }
  for (const sz of [1, -1]) box(0, sz * F.z, 2 * F.x + 0.4, 0.4, 0.4, 'truss', F.y, 0, false);
  for (const sx of [1, -1]) box(sx * F.x, 0, 0.4, 0.4, 2 * F.z + 0.4, 'truss', F.y, 0, false);
  for (let i = 0; i < 8; i++) {
    const t = -F.x + 0.6 + (i + 0.5) * ((2 * F.x - 1.2) / 8);
    for (const sz of [1, -1]) box(t, sz * (F.z + 0.22), 1.1, 0.12, 0.06, 'led', F.y + 0.14, 0, false);
  }
  for (let i = 0; i < 6; i++) {
    const t = -F.z + 0.6 + (i + 0.5) * ((2 * F.z - 1.2) / 6);
    for (const sx of [1, -1]) box(sx * (F.x + 0.22), t, 0.06, 0.12, 1.1, 'led', F.y + 0.14, 0, false);
  }
  // inner light bar across the frame
  box(0, 0, 2 * F.x, 0.3, 0.3, 'truss', F.y + 0.05, 0, false);

  // ---- hackathon desk rows (black skirted tables, cover height), clear lanes for play
  for (const x of TABLE_ROWS_X) {
    for (const sgn of [1, -1]) {
      const ok = (zz: number) => floorClear(x - 1.0, zz, isClosedSide(x - 1.0) ? 2.6 : 4.2) && floorClear(x + 1.0, zz, isClosedSide(x + 1.0) ? 2.6 : 4.2) && (zz < CROSS_GAP[0] || zz > CROSS_GAP[1]);
      let run0 = -1;
      for (let z = TABLE_LANE; z <= 30.001; z += 0.25) {
        const good = z < 30 && ok(z);
        if (good && run0 < 0) run0 = z;
        if (!good && run0 >= 0) {
          const z1 = z - 0.25;
          if (z1 - run0 >= 1.75) box(x, (sgn * (run0 + z1)) / 2, z1 - run0, TABLE_H, TABLE_DEPTH, 'table', 0, Math.PI / 2);
          run0 = -1;
        }
      }
    }
  }
  // short rows along x beside the stage (north / south of the frame)
  for (const sgn of [1, -1]) for (const z of [11.6, 15.0, 18.4]) box(0, sgn * z, 12, TABLE_H, TABLE_DEPTH, 'table');

  // ---- closed-end lounge between the folded stands (x = FACADE_X) and the last desk row:
  // pink neon INFO sign + info desk, bean bags, flight cases, red emergency doors, power box
  const FX = FACADE_X;
  const IN = -Math.PI / 2; // faces +x (into the arena)
  box(FX + 0.06, 5.2, 3.4, 1.15, 0.1, 'neon', 2.05, IN, false);
  box(-45.3, 5.2, 3.6, 0.9, 0.8, 'table', 0, Math.PI / 2);
  for (const [x, z, t] of [[-43.0, 3.4, 0], [-42.7, 6.9, 1], [-43.4, 8.5, 2], [-41.6, -1.6, 1], [-42.4, -3.2, 0]] as const) {
    box(x, z, 0.95, 0.55, 0.95, 'beanbag', 0, x * 1.7 + z, true, { tag: t });
  }
  box(-46.8, -5.6, 1.2, 0.85, 0.8, 'case', 0, IN);
  box(-46.8, -5.6, 1.0, 0.7, 0.7, 'case', 0.85, IN + 0.2);
  box(-46.7, -6.75, 0.8, 1.15, 0.8, 'case', 0, IN);
  // red quad emergency doors with push bars on the facade, exit sign + fire-hose cabinet beside
  box(FX + 0.05, -8.4, 3.6, 2.45, 0.08, 'door', 0, IN, false);
  box(FX + 0.06, -8.4, 0.62, 0.22, 0.05, 'exit', 2.7, IN, false);
  box(FX + 0.07, -10.6, 0.7, 0.9, 0.12, 'cabinet', 0.55, IN, false);
  // power distribution box on a blue stand, red bins with black bags
  box(-46.4, -11.7, 0.9, 0.7, 0.35, 'ebox', 0.45, IN, false);
  box(-46.4, -11.7, 0.8, 0.45, 0.3, 'metal', 0, IN, false);
  for (const [x, z] of [[-46.9, -10.0], [-46.3, -9.9], [-44.6, 10.4]] as const) box(x, z, 0.55, 0.85, 0.55, 'bin', 0, 0, false, { cyl: true });
  // roll-up banners + a TV on a stand
  for (const [x, z, t] of [[-45.2, 9.3, 0], [-44.6, -4.5, 1], [-41.0, 12.8, 2]] as const) {
    box(x, z, 0.85, 2.0, 0.04, 'rollup', 0.08, IN + (z > 0 ? 0.35 : -0.25), false, { tag: t });
    box(x, z, 0.9, 0.08, 0.28, 'metal', 0, IN + (z > 0 ? 0.35 : -0.25), false);
  }
  box(-44.0, 1.4, 1.4, 0.82, 0.06, 'screen', 1.15, IN + 0.3, false);
  box(-44.0, 1.4, 0.06, 1.2, 0.06, 'metal', 0, IN + 0.3, false);
  box(-44.0, 1.4, 0.7, 0.04, 0.5, 'metal', 0, IN + 0.3, false);
  // pink TAURON fence banner on the east floor + bins along the tier fronts
  box(32.4, -16.2, 3.2, 1.1, 0.06, 'fence', 0.1, Math.atan2(32.4, -16.2), false);
  box(32.4, -16.2, 3.3, 0.06, 0.4, 'metal', 0, Math.atan2(32.4, -16.2), false);
  for (const [x, z] of [[22.3, 20.9], [-22.3, -20.9], [6.8, 21.0], [-6.8, -21.0], [33.6, 6.6], [24.2, -20.9]] as const) box(x, z, 0.55, 0.85, 0.55, 'bin', 0, 0, false, { cyl: true });
  // cable ramp protectors across the walking lanes (flat, no collision)
  const ramp = (x: number, z: number, len: number, alongZ: boolean) => box(x, z, len, 0.05, 0.5, 'ramp', 0, alongZ ? Math.PI / 2 : 0, false);
  ramp(19.5, 0, 7.2, true);
  ramp(-24.6 + 1.7, 0, 7.2, true);
  ramp(-36.5, 0, 7.2, true);
  ramp(-42.0, -2.0, 9.0, true);
  ramp(12.7, 11.6, 2.4, true);
  ramp(-19.5, -11.6, 2.4, true);
  ramp(-30.0, 11.6, 2.4, true);
  ramp(4.0, -9.6, 6.0, false);
  ramp(-4.0, 9.6, 6.0, false);
  return P;
}

/** roof dome height at offset d (same curve as the mesher) */
export function roofYAt(d: number): number {
  const t = clamp((BACK_WALL_D1 - d) / (BACK_WALL_D1 + CORNER_R - 0.5), 0, 1);
  return ROOF_BASE_Y + (ROOF_APEX_Y - ROOF_BASE_Y) * Math.sin((t * Math.PI) / 2);
}
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function bowlProps(): Prop[] {
  const P: Prop[] = [];
  const { columns } = layout();
  const n = columns.length;
  const H = CONC_CEIL - LEVEL_B;
  let pillar = 0;
  for (const col of columns) {
    const j = col.index;
    const next = columns[(j + 1) % n]!;
    // ---- concourse: round pillars with TAURON wraps (alternating red/white and magenta), bins
    if (col.b === 'wall' && next.b === 'box') {
      P.push({ ...propAt(j, 0.5, 26.0, LEVEL_B, 1.1, H, 1.1, 'pillar'), cyl: true });
      P.push({ ...propAt(j, 0.5, 26.0, LEVEL_B + 0.35, 1.18, 1.7, 1.18, 'wrap', false), cyl: true, tag: pillar % 2 });
      if (pillar % 3 === 0) P.push({ ...propAt(j, 0.5, 26.95, LEVEL_B, 0.5, 0.8, 0.5, 'bin', false), cyl: true });
      pillar++;
    }
    // ---- kiosks against the outer wall: counter + black top + magenta accent wall
    if (col.b === 'door' && col.c === 'aisle') {
      const w = Math.min(2.8, columnWidth(j, 28.5) + 1.2);
      P.push(propAt(j, 0.5, 28.35, LEVEL_B, w, 1.05, 0.8, 'counter'));
      P.push(propAt(j, 0.5, 28.3, LEVEL_B + 1.05, w + 0.1, 0.06, 0.95, 'metal', false));
      P.push(propAt(j, 0.5, 29.6, LEVEL_B, w + 2.4, 3.6, 0.4, 'accent'));
    }
    // ---- vomitory (aisle + vom column pair = one sector)
    if (col.sector && col.a === 'aisle') {
      const v = next; // the vom column right of the aisle column
      const span = columnWidth(j, 19.6) + (v.sector === col.sector ? columnWidth(v.index, 19.6) : 0);
      const fEnd = v.sector === col.sector ? 1 : 0.5;
      // red double doors standing open against the side walls, frame header, exit sign
      P.push(propAt(j, 0.03, 19.0, LEVEL_B, 0.06, 1.95, 1.1, 'door', false));
      if (v.sector === col.sector) P.push(propAt(v.index, 0.97, 19.0, LEVEL_B, 0.06, 1.95, 1.1, 'door', false));
      P.push(propAt(j, fEnd, 19.62, LEVEL_B + 1.95, span, 0.1, 0.12, 'door', false));
      P.push(propAt(j, fEnd, 19.55, LEVEL_B + 2.07, 0.5, 0.17, 0.05, 'exit', false));
      // fire-hose cabinet on the left wall
      P.push(propAt(j, 0.035, 17.3, LEVEL_B + 0.55, 0.1, 0.95, 0.7, 'cabinet', false));
      // hanging red sector sign in the concourse in front of the vomitory
      P.push({ ...propAt(j, fEnd, 22.4, LEVEL_B + 2.7, 2.8, 0.7, 0.08, 'sign', false), tag: col.sector % 2 });
      // glass entrance doors + turnstiles on the outer wall behind every other sector
      if (col.sector % 2 === 1) {
        P.push(propAt(j, fEnd, 29.82, LEVEL_B, 3.8, 3.0, 0.05, 'glassdoor', false));
        for (const f of [-1.25, -0.42, 0.42, 1.25]) {
          const p = columnPoint(j, fEnd, 28.2);
          // tangent = (cos yaw, −sin yaw) for the inward-facing yaw
          P.push({ x: p.x + Math.cos(p.yawIn) * f, y: LEVEL_B + 0.5, z: p.z - Math.sin(p.yawIn) * f, sx: 0.22, sy: 1.0, sz: 0.9, yaw: p.yawIn, mat: 'metal', collide: true });
        }
      }
      // stanchion posts + rope on some sectors
      if (col.sector % 4 === 2) {
        for (let k = 0; k < 4; k++) P.push({ ...propAt(j, fEnd, 24.0 + k * 1.2, LEVEL_B, 0.08, 1.0, 0.08, 'metal', false), cyl: true });
        P.push(propAt(j, fEnd, 25.8, LEVEL_B + 0.8, 0.03, 0.03, 3.6, 'speaker', false));
      }
    }
    // ---- vending machine against the outer wall, every few sectors
    if (col.b === 'box' && columns[(j - 1 + n) % n]!.b === 'door' && columns[(j - 1 + n) % n]!.a === 'aisle') {
      P.push(propAt(j, 0.5, 29.35, LEVEL_B, 0.95, 1.9, 0.8, 'vending'));
      // steel lift doors next to it on every other kiosk
      if (j % 2 === 0) P.push({ ...propAt(j, 0.5, CONC_D1 - 0.03, LEVEL_B, 1.6, 2.3, 0.06, 'greydoor', false), tag: 1 });
    }
    // ---- service tunnels through the folded stands (mentors village / chill-out rooms)
    if (isRecessColumn(col) && col.a === 'aisle') {
      const mentors = col.sector % 2 === 1;
      // grey double doors + exit signs on the back wall, purple banner over the opening
      P.push({ ...propAt(j, 1, RECESS_D1 - 0.05, 0, 2.4, 2.4, 0.08, 'greydoor', false), tag: 0 });
      P.push(propAt(j, 1, RECESS_D1 - 0.08, 2.6, 0.62, 0.22, 0.05, 'exit', false));
      P.push({ ...propAt(j, 1, CLOSED_D - 0.04, LEVEL_B - 1.85, 3.2, 1.8, 0.03, 'banner', false), tag: mentors ? 0 : 1 });
      P.push(propAt(j, 1, CLOSED_D - 0.05, RECESS_H + 0.15, 0.62, 0.22, 0.05, 'exit', false));
      if (mentors) {
        // wooden tables + blue chairs along one wall
        for (const d of [14.2, 17.4]) {
          P.push(propAt(j, 0.33, d, 0, 0.8, 0.75, 2.4, 'wood'));
          for (const dd of [-0.7, 0, 0.7]) P.push(propAt(j, 0.83, d + dd, 0, 0.45, 0.85, 0.45, 'chairblue', false));
        }
        P.push(propAt(j, 1.7, CLOSED_D - 1.2, 0, 0.8, 1.7, 0.05, 'standee', false));
      } else {
        P.push({ ...propAt(j, 0.6, 14.8, 0, 0.95, 0.55, 0.95, 'beanbag'), tag: 0 });
        P.push({ ...propAt(j + 1, 0.4, 16.6, 0, 0.95, 0.55, 0.95, 'beanbag'), tag: 1 });
      }
    }
    // ---- closed end: black drapes in front of the upper ring, box-ring ceiling → roof
    if (col.closed) {
      const top = roofYAt(DRAPE_D) + 0.3;
      P.push(propAt(j, 0.5, DRAPE_D, DRAPE_Y0, columnWidth(j, DRAPE_D) + 0.03, top - DRAPE_Y0, 0.15, 'drape'));
    }
  }
  // ---- purple HackYeah banners hung from the C walkway rail over the LED fascia
  const byPart = (part: string, n: number) => columns.filter((c) => c.part === part && c.b === 'box')[n]!;
  for (const [part, n, tag] of [['N', 7, 2], ['S', 3, 3], ['E', 1, 4], ['N', 2, 5]] as const) {
    const c = byPart(part, n);
    P.push({ ...propAt(c.index, 0.5, CROSS_END - 0.06, C_WALK_Y + 0.95 - 2.3, 3.0, 2.3, 0.03, 'banner', false), tag });
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
  const rowRuns = (has: (c: Column) => boolean, d: number, y: number, tier: 'A' | 'B' | 'C', row: number) => {
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
    const has = (c: Column) => !c.closed && (c.a === 'seat' || (c.a === 'tunnel' && i >= 4));
    rowRuns(has, A_D0 + (i + 1) * A_ROW_D - 0.34, aSeatTop(i), 'A', i);
  }
  for (let i = 0; i < C_ROWS; i++) {
    const has = (c: Column) => !c.closed && (c.c === 'seat' || (c.c === 'stair' && i >= 6));
    rowRuns(has, C_D0 + (i + 1) * C_ROW_D - 0.34, cSeatTop(i), 'C', i);
  }
  // glass boxes: two rows of red VIP seats each (separate runs: box partitions stop them)
  for (const [row, d] of [[0, 16.9], [1, 17.9]] as const) {
    for (const col of columns) {
      if (col.b !== 'box' || col.closed) continue;
      const w = columnWidth(col.index, d);
      const count = Math.floor((w - 0.2) / 0.55);
      for (let s = 0; s < count; s++) {
        const p = columnPoint(col.index, (s + 0.5) / count, d);
        out.push({ x: p.x, y: LEVEL_B, z: p.z, yaw: p.yawIn, tier: 'B', row });
      }
    }
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
        // lower dome = the cracked-mosaic upper bowl wall, upper dome = dark roof deck
        B.quad(r < 6 ? 'mosaic' : 'roof', [ax, yAt(t0), az], [bx, yAt(t0), bz], [cx, yAt(t1), cz], [dx, yAt(t1), dz], [0, -1, 0], 1, false);
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
