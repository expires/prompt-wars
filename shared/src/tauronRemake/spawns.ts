/**
 * Spawn points for `tauron-remake`, computed from the layout (cheap: no geometry build), so the
 * server can seed them from MAPS without pulling in the mesher. Validated against the real
 * triangles by tauronRemake.test.ts (each spawn stands on a walkable surface with headroom).
 */
import { A_D0, A_ROW_D, C_D0, C_ROW_D, LEVEL_B, aSeatTop, cSeatTop, columnPoint, layout, type Column } from './layout';

export interface RemakeSpawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** feet sit this far above the surface so the capsule never starts in contact */
const LIFT = 0.05;

/** yaw facing the arena centre (same convention as shared/src/net.ts) */
const faceCentre = (x: number, z: number) => Math.atan2(x, z);

function nthColumn(part: string, pred: (c: Column) => boolean, n: number): Column {
  const cols = layout().columns.filter((c) => c.part === part && pred(c));
  const c = cols[Math.min(n, cols.length - 1)];
  if (!c) throw new Error(`tauron-remake: no column in ${part}`);
  return c;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function at(col: Column, d: number, y: number): RemakeSpawn {
  const p = columnPoint(col.index, 0.5, d);
  return { x: r3(p.x), y: r3(y + LIFT), z: r3(p.z), yaw: r3(faceCentre(p.x, p.z)) };
}

function buildSpawns(): RemakeSpawn[] {
  const out: RemakeSpawn[] = [];
  // ---- event floor (8): around the cover, incl. one on the stage deck
  const floor: [number, number, number][] = [
    [31, 0, -12], [31, 0, 12], [19, 0, 0], [8, 0, 12], [8, 0, -12], [-17, 0, -9], [-17, 0, 9], [-27, 1.5, -4],
  ];
  for (const [x, y, z] of floor) out.push({ x, y: r3(y + LIFT), z, yaw: r3(faceCentre(x, z)) });

  const box = (c: Column) => c.b === 'box';
  // ---- tier A (6): on seat rows (seats are visual only), mid-row
  const aRow = (i: number) => A_D0 + i * A_ROW_D + A_ROW_D * 0.45;
  for (const [part, n, row] of [['N', 3, 4], ['S', 5, 9], ['E', 1, 6], ['W', 2, 11], ['NE', 2, 7], ['SW', 3, 5]] as const) {
    out.push(at(nthColumn(part, box, n), aRow(row), aSeatTop(row)));
  }
  // ---- tier C (4)
  const cRow = (i: number) => C_D0 + i * C_ROW_D + C_ROW_D * 0.45;
  for (const [part, n, row] of [['N', 4, 7], ['S', 2, 10], ['NW', 1, 6], ['SE', 4, 9]] as const) {
    out.push(at(nthColumn(part, box, n), cRow(row), cSeatTop(row)));
  }
  // ---- concourse (6): in front of the box rear walls, clear of pillars / kiosks / stairs
  for (const [part, n] of [['N', 2], ['S', 6], ['E', 2], ['W', 1], ['NE', 4], ['SW', 1]] as const) {
    out.push(at(nthColumn(part, box, n), 23.0, LEVEL_B));
  }
  return out;
}

export const TAURON_REMAKE_SPAWNS: readonly RemakeSpawn[] = buildSpawns();
