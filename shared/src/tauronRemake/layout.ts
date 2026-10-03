/**
 * TAURON Arena Kraków — ORIGINAL procedural remake (`tauron-remake`).
 *
 * Nothing here is traced from scans or photos. The layout is an original game-first design that
 * follows published, textual facts about the venue plus general arena architecture:
 *
 *  - tauronarenakrakow.pl "plan areny": main arena floor 3,900 m²; seating levels 0 (floor),
 *    A (lower ring: mobile + fixed stands), B (boxes), C (upper ring); ~15,000 seated, up to
 *    ~22,000 with a standing floor; small hall 1,750 m².
 *  - Venue fact sheets (tauronarenakrakow.pl offer PDF / en.wikipedia "Tauron Arena Kraków"):
 *    mobile stands 3,766 seats, permanent stands 2,872 + fixed stands 6,744 seats; LED façade
 *    ribbon of 500+ m around the main hall.
 *  - OpenStreetMap way 292867512 (© OpenStreetMap contributors, ODbL): building=stadium,
 *    height=27 m. Only that height tag is used (outer wall top ≈ 26 m); no footprint geometry.
 *  - General arena architecture: oval bowl around a rectangular event floor, raked tiers
 *    (~30–35°), cross aisle + vomitories into the bowl, a concourse ring behind the seats,
 *    glass-fronted boxes between the rings, centre-hung scoreboard, lighting truss, roof dome.
 *
 * Coordinates: +Y up, metres, arena centre at the origin, long axis along X, floor top at y=0.
 *
 * The bowl is described on a curvilinear grid: a closed loop of *columns* around a rounded
 * rectangle (the floor edge), and *bands* of distance `d` measured outward from that edge.
 * World position of (column boundary j, offset d) = station_j.p + station_j.n * d, which is
 * exact for both the straight sides and the circular corners (offset curves of a rounded
 * rectangle are rounded rectangles). geometry.ts fills every (column, band) cell with stacked
 * solid y-intervals and meshes them watertight.
 */

// ------------------------------------------------------------------ dimensions

/** floor edge (d = 0): rounded rectangle 72 × 46 m, corner radius 10 m */
export const FLOOR_HALF_X = 36;
export const FLOOR_HALF_Z = 23;
export const CORNER_R = 10;

/** solid ground under everything; floor top is y = 0 */
export const GROUND = -1;

// floor-side aisle stairs (in front of tier A) — 4 risers of 0.3 m onto the A walkway
export const FLOOR_STAIR_D0 = -1.2;
export const FLOOR_STAIR_TREAD = 0.3;
export const FLOOR_STAIR_RISE = 0.3;

// tier A (lower ring): front wall (LED boards), walkway, 15 rows
export const A_FRONT_D1 = 0.25;
export const A_WALK_Y = 1.2;
export const A_GLASS_H = 1.0;
export const A_D0 = 1.6;
export const A_ROW_D = 0.85;
export const A_ROW_R = 0.55; // 33° rake; aisle half-steps 0.275 m (autostep 0.4)
export const A_ROWS = 15;
export const A_END = A_D0 + A_ROWS * A_ROW_D; // 14.35
export const A_TOP = A_WALK_Y + A_ROWS * A_ROW_R; // 9.45

// cross aisle on top of tier A (the "B" level): boxes ring behind it
export const CROSS_END = A_END + 1.5; // 15.85
export const LEVEL_B = A_TOP; // 9.45 cross aisle / box floor / concourse floor
export const BOX_GLASS_D1 = CROSS_END + 0.15; // 16.0
export const BOX_REAR_D0 = 19.6;
export const RING_B_END = 19.85;
export const BOX_CEIL = 12.2;

// tier C (upper ring): walkway over the boxes, 15 rows
export const C_WALK_Y = 12.95;
export const C_GLASS_H = 1.0;
export const C_D0 = 17.35;
export const C_ROW_D = 0.85;
export const C_ROW_R = 0.6; // 35° rake; aisle half-steps 0.3 m
export const C_ROWS = 15;
export const C_END = C_D0 + C_ROWS * C_ROW_D; // 30.1
export const C_TOP = C_WALK_Y + C_ROWS * C_ROW_R; // 21.95

// concourse ring behind the boxes (same level as the cross aisle)
export const CONC_D0 = RING_B_END; // 19.85
export const CONC_D1 = 29.85;
export const CONC_CEIL = 13.45;
export const OUTER_WALL_D1 = 30.6;
export const TOP_WALK_D1 = 32.1;
export const BACK_WALL_D1 = 32.6;
export const WALL_TOP = 26.0;

// player tunnels: floor level under tier A, then a straight stair up into the concourse
export const TUN_CEIL = 3.0;
export const TUN_STAIR_D0 = 13.2;
export const TUN_STAIR_TREAD = 0.3;
export const TUN_STAIR_STEPS = 38;
export const TUN_STAIR_RISE = LEVEL_B / TUN_STAIR_STEPS; // ≈0.249
export const TUN_STAIR_D1 = TUN_STAIR_D0 + TUN_STAIR_STEPS * TUN_STAIR_TREAD; // 24.6
export const TUN_HEADROOM = 3.0; // the capsule spans ~2 treads: autostep lift needs room over the lower ones

// C stairs: from the concourse up to the C walkway, rising inward through the box ring
export const CST_D0 = C_D0; // top end (inner)
export const CST_TREAD = 0.35;
export const CST_STEPS = 14;
export const CST_RISE = (C_WALK_Y - LEVEL_B) / CST_STEPS; // 0.25
export const CST_D1 = CST_D0 + CST_STEPS * CST_TREAD; // 22.25 bottom end (outer)
export const CST_HEADROOM = 2.9;

/** invisible ceiling / playable bounds (outer wall + margin) */
export const BOUNDS_TOP = 30;
export const ROOF_BASE_Y = WALL_TOP;
export const ROOF_APEX_Y = 36;

// ------------------------------------------------------------------ outline stations

export interface Station {
  /** base point on the floor edge (d = 0) */
  px: number;
  pz: number;
  /** outward unit normal */
  nx: number;
  nz: number;
}

export type AKind = 'seat' | 'aisle' | 'tunnel';
export type BKind = 'wall' | 'vom' | 'box' | 'door' | 'cstair';
export type CKind = 'seat' | 'aisle' | 'stair';

export interface Column {
  index: number;
  a: AKind;
  b: BKind;
  c: CKind;
  /** railing along the tunnel stairwell in the concourse (columns flanking a tunnel) */
  rail: boolean;
  /** which side/arc the column is on, for placement */
  part: string;
  /**
   * closed (west) end in the hackathon/concert configuration: tier A is retracted behind a
   * folded-stand facade (event floor extends to CLOSED_D, balcony on top), black drapes hang in
   * front of the upper ring
   */
  closed: boolean;
  /** sector number (1..24) of the vomitory this column belongs to, 0 if none */
  sector: number;
}

interface ColSpec {
  w: number;
  a: AKind;
  b: BKind;
  c: CKind;
  rail?: boolean;
  /** angular minimum at the front of tier A (aisles in the corners) */
  aisleCorner?: boolean;
}

const W = (): ColSpec => ({ w: 0.3, a: 'seat', b: 'wall', c: 'seat' });
const VA = (): ColSpec => ({ w: 1.5, a: 'aisle', b: 'vom', c: 'aisle', aisleCorner: true });
const V = (): ColSpec => ({ w: 1.5, a: 'seat', b: 'vom', c: 'seat' });
const BX = (): ColSpec => ({ w: 1.6, a: 'seat', b: 'box', c: 'seat' });
const BD = (): ColSpec => ({ w: 1.6, a: 'aisle', b: 'door', c: 'seat', aisleCorner: true });
const BC = (): ColSpec => ({ w: 1.6, a: 'seat', b: 'door', c: 'aisle' });
const S = (): ColSpec => ({ w: 1.6, a: 'seat', b: 'cstair', c: 'stair' });
const T = (): ColSpec => ({ w: 1.6, a: 'tunnel', b: 'vom', c: 'seat' });
const WR = (): ColSpec => ({ ...W(), rail: true });

/** one seating sector: vomitory + 2 boxes, A aisles at the vom and the first box door */
function unit(cstairs = false): ColSpec[] {
  return [W(), VA(), V(), W(), BX(), BD(), BX(), W(), ...(cstairs ? [S(), S(), S()] : [BX(), BC(), BX()])];
}
/** player tunnel module (closed by the next unit's leading wall) */
function tunnel(): ColSpec[] {
  return [WR(), T(), T(), WR()];
}

/** widths are nominal: each side / arc is scaled to fit exactly */
function longSide(): ColSpec[] {
  return [...unit(true), ...unit(), ...tunnel(), ...unit(), ...unit(true)];
}
function shortSide(): ColSpec[] {
  return [...unit(), ...tunnel(), ...unit()];
}
function arc(): ColSpec[] {
  return [...unit(), ...unit(true), ...unit()];
}
/** closed short side: no player tunnel (the facade covers it) */
function closedShortSide(): ColSpec[] {
  return [...unit(), ...unit()];
}

/** parts of the loop that are closed off by the drapes / folded stands (the west end) */
export const CLOSED_PARTS = new Set(['NW', 'W', 'SW']);
/** folded-stand facade line on the closed end (event floor reaches this offset) */
export const CLOSED_D = A_D0 + 24 * (A_ROW_D / 2); // 11.8 (an existing band boundary)
/**
 * stored (retracted) telescopic stands: a vertical wall of steel shelves with folded blue seats
 * round the whole floor at offset STORED_D, STORED_H tall, with a walkway (cable railing on its
 * floor-side edge) on top; the fixed raked rows of tier A rise from the back of that walkway.
 * On the closed end the same wall stands at CLOSED_D with a narrow ledge, the folded upper
 * stands rise behind it to the balcony at the cross-aisle level.
 */
export const STORED_D = A_D0 + 4 * A_ROW_D; // 5.0 (an existing band boundary)
export const STORED_H = A_WALK_Y + 6 * A_ROW_R; // 4.5 (= top of A row 5)
/** walkway on top of the wall: rows 4 + 5 flattened */
export const STORED_WALK_D1 = A_D0 + 6 * A_ROW_D; // 6.7
/** railing band (collides) along the walkway edge */
export const STORED_RAIL_D1 = STORED_D + 0.1;
/** first tier A row with seats (behind the walkway) */
export const A_FIXED_ROW0 = 6;
/** closed end: ledge walkway on top of the stored wall, then the folded upper stands */
export const CLOSED_LEDGE_D1 = CLOSED_D + 2 * (A_ROW_D / 2); // 12.65
export const CLOSED_LEDGE_RAIL_D1 = CLOSED_D + 0.1;
/** balcony railing band on top of the folded upper stands */
export const CLOSED_RAIL_D1 = CLOSED_LEDGE_D1 + A_ROW_D / 2; // 13.075

/** steel access staircases from the floor up to the stored-wall walkway (at these A aisles) */
export const STAIR_SECTORS = new Set([1, 2, 4, 6, 8, 9, 18, 20, 21, 24]);
export const ACCESS_STEPS = 18;
export const ACCESS_RISE = STORED_H / ACCESS_STEPS; // 0.25
export const ACCESS_TREAD = 0.3;
export const ACCESS_W = 1.1;
/** stair foot (d of the first riser) */
export const ACCESS_D0 = STORED_D - ACCESS_STEPS * ACCESS_TREAD; // -0.4
export const isStairColumn = (c: Pick<Column, 'a' | 'sector' | 'closed'>) => c.a === 'aisle' && !c.closed && STAIR_SECTORS.has(c.sector);

/**
 * floor-level rooms behind the stored-seat wall (aisle + vom column pair of one sector):
 * the chill-out zone through the folded stands on the closed west end, the mentors village
 * under the fixed seating in the diagonally opposite (south-east) corner. White walls, dark
 * ceiling at RECESS_H, fluorescent tubes; open from the wall face back to the box-ring rear.
 */
export const RECESS_H = 3.6;
export const RECESS_D1 = RING_B_END;
export const CHILLOUT_SECTOR = 14;
export const MENTORS_SECTOR = 23;
export const isRecessColumn = (c: Pick<Column, 'b' | 'sector'>) => c.b === 'vom' && (c.sector === CHILLOUT_SECTOR || c.sector === MENTORS_SECTOR);
/** offset of the wall face a recess opens in */
export const recessD0 = (c: Pick<Column, 'closed'>) => (c.closed ? CLOSED_D : STORED_D);
/** drapes hang just in front of the upper ring, from the box-ring ceiling up to the roof */
export const DRAPE_D = CROSS_END - 0.12;
export const DRAPE_Y0 = BOX_CEIL;

/** reference radius offset for sizing corner columns (middle of the box ring) */
const ARC_REF_D = 17.85;
/** corner aisles must be ≥ this wide at the front of tier A */
const ARC_AISLE_MIN = 1.05;

export interface Layout {
  stations: Station[]; // stations.length === columns.length (closed loop: column j spans j → j+1 mod n)
  columns: Column[];
  bands: number[]; // sorted d boundaries
}

function buildLayout(): Layout {
  const stations: Station[] = [];
  const columns: Column[] = [];
  const ax = FLOOR_HALF_X - CORNER_R;
  const az = FLOOR_HALF_Z - CORNER_R;

  const pushCols = (specs: ColSpec[], part: string) => {
    for (const s of specs) {
      columns.push({ index: columns.length, a: s.a, b: s.b, c: s.c, rail: !!s.rail, part, closed: CLOSED_PARTS.has(part), sector: 0 });
    }
  };

  // straight side from (x0,z0) to (x1,z1) with constant normal
  const side = (specs: ColSpec[], x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, part: string) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const total = specs.reduce((a, s) => a + s.w, 0);
    const k = len / total;
    let t = 0;
    for (const s of specs) {
      const f = t / len;
      stations.push({ px: x0 + (x1 - x0) * f, pz: z0 + (z1 - z0) * f, nx, nz });
      t += s.w * k;
    }
    pushCols(specs, part);
  };

  // quarter arc around (cx,cz) from angle th0 (counter-clockwise in x/z)
  const corner = (specs: ColSpec[], cx: number, cz: number, th0: number, part: string) => {
    const refR = CORNER_R + ARC_REF_D;
    const frontR = CORNER_R + A_D0;
    const angles = specs.map((s) => {
      const a = s.w / refR;
      return s.aisleCorner ? Math.max(a, ARC_AISLE_MIN / frontR, (s.w * 1.5) / refR) : a;
    });
    const total = angles.reduce((a, b) => a + b, 0);
    const k = Math.PI / 2 / total;
    let th = th0;
    for (let i = 0; i < specs.length; i++) {
      const nx = Math.cos(th);
      const nz = Math.sin(th);
      stations.push({ px: cx + CORNER_R * nx, pz: cz + CORNER_R * nz, nx, nz });
      th += angles[i]! * k;
    }
    pushCols(specs, part);
  };

  // counter-clockwise loop (seen with +z "up" on a map): E side, NE arc, N side, ...
  side(shortSide(), FLOOR_HALF_X, -az, FLOOR_HALF_X, az, 1, 0, 'E');
  corner(arc(), ax, az, 0, 'NE');
  side(longSide(), ax, FLOOR_HALF_Z, -ax, FLOOR_HALF_Z, 0, 1, 'N');
  corner(arc(), -ax, az, Math.PI / 2, 'NW');
  side(closedShortSide(), -FLOOR_HALF_X, az, -FLOOR_HALF_X, -az, -1, 0, 'W');
  corner(arc(), -ax, -az, Math.PI, 'SW');
  side(longSide(), -ax, -FLOOR_HALF_Z, ax, -FLOOR_HALF_Z, 0, -1, 'S');
  corner(arc(), ax, -az, (3 * Math.PI) / 2, 'SE');

  // ---- sector numbers: each vomitory (aisle + vom column pair) is one sector, A1.. counter-clockwise
  let sector = 0;
  for (let j = 0; j < columns.length; j++) {
    const c = columns[j]!;
    if (c.b === 'vom' && c.a === 'aisle') {
      sector++;
      c.sector = sector;
      const nx = columns[j + 1];
      if (nx && nx.b === 'vom' && nx.a !== 'tunnel') nx.sector = sector;
    }
  }

  // ---- radial bands
  const b: number[] = [];
  for (let i = 0; i <= 4; i++) b.push(FLOOR_STAIR_D0 + i * FLOOR_STAIR_TREAD);
  b.push(A_FRONT_D1);
  for (let i = 0; i <= A_ROWS * 2; i++) b.push(A_D0 + (i * A_ROW_D) / 2);
  b.push(STORED_RAIL_D1, CLOSED_LEDGE_RAIL_D1);
  b.push(CROSS_END, BOX_GLASS_D1, BOX_REAR_D0, RING_B_END);
  for (let i = 0; i <= C_ROWS * 2; i++) b.push(C_D0 + (i * C_ROW_D) / 2);
  b.push(CONC_D1, OUTER_WALL_D1, TOP_WALK_D1, BACK_WALL_D1);
  for (let i = 0; i <= TUN_STAIR_STEPS; i++) b.push(TUN_STAIR_D0 + i * TUN_STAIR_TREAD);
  for (let i = 0; i <= CST_STEPS; i++) b.push(CST_D0 + i * CST_TREAD);
  b.sort((p, q) => p - q);
  const bands: number[] = [];
  for (const v of b) if (!bands.length || v - bands[bands.length - 1]! > 1e-4) bands.push(Math.round(v * 1e5) / 1e5);

  return { stations, columns, bands };
}

let cached: Layout | null = null;
export function layout(): Layout {
  cached ??= buildLayout();
  return cached;
}

/** world x/z of column boundary `j` (wraps) at offset `d` */
export function stationPoint(j: number, d: number): [number, number] {
  const st = layout().stations;
  const s = st[((j % st.length) + st.length) % st.length]!;
  return [s.px + s.nx * d, s.pz + s.nz * d];
}

let cumCache: { len: number[]; ang: number[] } | null = null;
/**
 * Arc length along the loop from station 0 to station `j` (0..n, not wrapped) at offset `d`:
 * base length + d × accumulated turning angle (exact for offset rounded rectangles).
 */
export function loopLength(j: number, d: number): number {
  if (!cumCache) {
    const st = layout().stations;
    const n = st.length;
    const len = [0], ang = [0];
    for (let i = 0; i < n; i++) {
      const a = st[i]!, b = st[(i + 1) % n]!;
      let turn = Math.atan2(a.nx * b.nz - a.nz * b.nx, a.nx * b.nx + a.nz * b.nz);
      if (Math.abs(turn) < 1e-9) turn = 0;
      len.push(len[i]! + Math.hypot(b.px - a.px, b.pz - a.pz) * (turn === 0 ? 1 : turn / (2 * Math.sin(turn / 2))));
      ang.push(ang[i]! + turn);
    }
    cumCache = { len, ang };
  }
  return cumCache.len[j]! + d * cumCache.ang[j]!;
}

/** world x/z at fraction `f` (0..1) across column `j`, offset `d`; plus the inward-facing yaw */
export function columnPoint(j: number, f: number, d: number): { x: number; z: number; yawIn: number } {
  const [x0, z0] = stationPoint(j, d);
  const [x1, z1] = stationPoint(j + 1, d);
  const x = x0 + (x1 - x0) * f;
  const z = z0 + (z1 - z0) * f;
  const st = layout().stations;
  const a = st[j % st.length]!;
  const b = st[(j + 1) % st.length]!;
  const nx = a.nx + b.nx;
  const nz = a.nz + b.nz;
  // facing −n (toward the floor). Player yaw convention: forward = (−sin yaw, −cos yaw)
  return { x, z, yawIn: Math.atan2(nx, nz) };
}

/** width of column `j` at offset `d` */
export function columnWidth(j: number, d: number): number {
  const [x0, z0] = stationPoint(j, d);
  const [x1, z1] = stationPoint(j + 1, d);
  return Math.hypot(x1 - x0, z1 - z0);
}

// ------------------------------------------------------------------ heights

export function aRowIndex(d: number): number {
  return Math.min(A_ROWS - 1, Math.max(0, Math.floor((d - A_D0) / A_ROW_D)));
}
export function cRowIndex(d: number): number {
  return Math.min(C_ROWS - 1, Math.max(0, Math.floor((d - C_D0) / C_ROW_D)));
}
export function aSeatTop(i: number): number {
  return A_WALK_Y + A_ROW_R * (i + 1);
}
export function cSeatTop(i: number): number {
  return C_WALK_Y + C_ROW_R * (i + 1);
}
/** walking surface of tier A at offset d (row tops, or aisle half-steps) */
export function aTop(d: number, aisle: boolean): number {
  const i = aRowIndex(d);
  if (!aisle) return aSeatTop(i);
  const back = d - (A_D0 + i * A_ROW_D) >= A_ROW_D / 2 - 1e-6;
  return A_WALK_Y + A_ROW_R * i + (back ? A_ROW_R : A_ROW_R / 2);
}
export function cTop(d: number, aisle: boolean): number {
  const i = cRowIndex(d);
  if (!aisle) return cSeatTop(i);
  const back = d - (C_D0 + i * C_ROW_D) >= C_ROW_D / 2 - 1e-6;
  return C_WALK_Y + C_ROW_R * i + (back ? C_ROW_R : C_ROW_R / 2);
}
/** tunnel stair top for a cell at offset d (d ≥ TUN_STAIR_D0) */
export function tunnelStairTop(d: number): number {
  const k = Math.min(TUN_STAIR_STEPS - 1, Math.floor((d - TUN_STAIR_D0) / TUN_STAIR_TREAD + 1e-6));
  return TUN_STAIR_RISE * (k + 1);
}
/** tunnel ceiling over a cell starting at d0 (stair rises outward) */
export function tunnelCeil(dm: number): number {
  if (dm < TUN_STAIR_D0) return TUN_CEIL;
  return Math.max(TUN_CEIL, tunnelStairTop(dm) + TUN_HEADROOM);
}
/** C stair top at offset d (CST_D0 ≤ d < CST_D1), rising inward */
export function cStairTop(d: number): number {
  const k = Math.min(CST_STEPS - 1, Math.floor((d - CST_D0) / CST_TREAD + 1e-6));
  return C_WALK_Y - CST_RISE * (k + 1);
}
