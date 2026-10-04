import navUrl from './krakow-oldtown.nav.gz?url';
import { NAV, type XZ } from './data';

/** cell value for "not walkable / not reachable" (scripts/map/bake-navgrid.ts) */
const BLOCKED = -32768;
/** largest height difference between neighbours a path may take (Rapier autostep is 0.4 m) */
const MAX_STEP = 0.45;
/** clearance (cells) below which a path pays extra: keeps the walk off walls */
const COMFORT = 4;

/**
 * Walkable grid baked from the collision mesh: floor height per 0.5 m cell for everything
 * reachable from the Market Square. Used to snap guide targets onto the ground and to find
 * walking routes (A* on 8 neighbours, weighted away from walls, then string-pulled).
 */
export class NavGrid {
  readonly w = NAV.width;
  readonly h = NAV.height;
  /** distance to the nearest blocked cell, in cells (capped) */
  private readonly clearance: Uint8Array;

  private constructor(private readonly heights: Int16Array) {
    this.clearance = computeClearance(heights, this.w, this.h);
  }

  static async load(): Promise<NavGrid> {
    const res = await fetch(navUrl);
    if (!res.ok) throw new Error(`nav grid: HTTP ${res.status}`);
    let buf = await res.arrayBuffer();
    // normally served as a plain file: inflate it here (unless a server already did)
    const b = new Uint8Array(buf, 0, 2);
    if (b[0] === 0x1f && b[1] === 0x8b) {
      buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    if (buf.byteLength !== NAV.width * NAV.height * 2) throw new Error(`nav grid: unexpected size ${buf.byteLength}`);
    return new NavGrid(new Int16Array(buf));
  }

  private idx(x: number, z: number): number {
    const i = Math.floor((x - NAV.minX) / NAV.cell);
    const j = Math.floor((z - NAV.minZ) / NAV.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  private center(c: number): XZ {
    const i = c % this.w;
    const j = (c - i) / this.w;
    return [NAV.minX + (i + 0.5) * NAV.cell, NAV.minZ + (j + 0.5) * NAV.cell];
  }

  /** floor height at a point, or null off the walkable area */
  heightAt(x: number, z: number): number | null {
    const c = this.idx(x, z);
    if (c < 0 || this.heights[c] === BLOCKED) return null;
    return this.heights[c] / 100;
  }

  /**
   * nearest walkable cell centre (prefers roomy cells), or null if nothing within maxDist.
   * `accept` can veto candidates (e.g. hidden ground under a hill shell).
   */
  nearest(x: number, z: number, maxDist = 40, accept?: (x: number, y: number, z: number) => boolean): { x: number; z: number; y: number } | null {
    const i0 = Math.floor((x - NAV.minX) / NAV.cell);
    const j0 = Math.floor((z - NAV.minZ) / NAV.cell);
    const R = Math.ceil(maxDist / NAV.cell);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= R; r++) {
      if (best >= 0 && r * NAV.cell > Math.sqrt(bestD) + 1) break;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const c = j * this.w + i;
          if (this.heights[c] === BLOCKED) continue;
          // a cell hugging a wall counts as a little further away
          const d = (di * di + dj * dj) * NAV.cell * NAV.cell + (this.clearance[c] < 2 ? 1 : 0);
          if (d < bestD && accept) {
            const [ax, az] = this.center(c);
            if (!accept(ax, this.heights[c] / 100, az)) continue;
          }
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    }
    if (best < 0) return null;
    const [cx, cz] = this.center(best);
    return { x: cx, z: cz, y: this.heights[best] / 100 };
  }

  /**
   * Walking route from `a` to `b` as smoothed waypoints [x, y, z] (both ends snapped onto the
   * grid), or null when there is none.
   */
  findPath(a: XZ, b: XZ): [number, number, number][] | null {
    const sa = this.nearest(a[0], a[1], 8);
    const sb = this.nearest(b[0], b[1], 40);
    if (!sa || !sb) return null;
    const start = this.idx(sa.x, sa.z);
    const goal = this.idx(sb.x, sb.z);
    const cells = this.astar(start, goal);
    if (!cells) return null;
    const pulled = this.stringPull(cells);
    return pulled.map((c) => {
      const [x, z] = this.center(c);
      return [x, this.heights[c] / 100, z];
    });
  }

  private canStep(a: number, b: number): boolean {
    return this.heights[b] !== BLOCKED && Math.abs(this.heights[a] - this.heights[b]) <= MAX_STEP * 100;
  }

  private astar(start: number, goal: number): number[] | null {
    const W = this.w;
    const n = W * this.h;
    const g = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const gi = goal % W;
    const gj = (goal - gi) / W;
    // octile distance, slightly inflated (weighted A*: far fewer expansions, near-optimal routes)
    const hcost = (c: number) => {
      const i = c % W;
      const dx = Math.abs(i - gi);
      const dz = Math.abs((c - i) / W - gj);
      return 1.15 * (Math.max(dx, dz) + 0.4142 * Math.min(dx, dz));
    };
    g[start] = 0;
    heap.push(start, hcost(start));
    const DIRS = [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1];
    let expanded = 0;
    while (heap.size) {
      const c = heap.pop();
      if (c === goal) break;
      if (closed[c]) continue;
      closed[c] = 1;
      if (++expanded > 900_000) return null;
      const ci = c % W;
      for (let k = 0; k < 8; k++) {
        const d = DIRS[k];
        const nc = c + d;
        const ni = ci + (k === 0 || k === 4 || k === 6 ? 1 : k === 1 || k === 5 || k === 7 ? -1 : 0);
        if (nc < 0 || nc >= n || ni < 0 || ni >= W || closed[nc]) continue;
        if (!this.canStep(c, nc)) continue;
        // diagonals may not cut a blocked corner
        if (k >= 4 && (!this.canStep(c, c + (d > 0 ? W : -W)) || !this.canStep(c, c + (ni > ci ? 1 : -1)))) continue;
        const cl = this.clearance[nc];
        const step = (k >= 4 ? 1.4142 : 1) * (1 + (cl < COMFORT ? (COMFORT - cl) * 0.6 : 0));
        const ng = g[c] + step;
        if (ng < g[nc]) {
          g[nc] = ng;
          from[nc] = c;
          heap.push(nc, ng + hcost(nc));
        }
      }
    }
    if (from[goal] < 0 && goal !== start) return null;
    const out: number[] = [];
    for (let c = goal; c >= 0; c = from[c]) {
      out.push(c);
      if (c === start) break;
    }
    return out.reverse();
  }

  /** drop waypoints that a straight, roomy, step-safe line can skip */
  private stringPull(cells: number[]): number[] {
    if (cells.length <= 2) return cells;
    const out = [cells[0]];
    let anchor = 0;
    for (let k = 2; k < cells.length; k++) {
      if (!this.lineClear(cells[anchor], cells[k])) {
        out.push(cells[k - 1]);
        anchor = k - 1;
      }
    }
    out.push(cells[cells.length - 1]);
    return out;
  }

  private lineClear(a: number, b: number): boolean {
    const W = this.w;
    const ai = a % W;
    const aj = (a - ai) / W;
    const bi = b % W;
    const bj = (b - bi) / W;
    const steps = Math.max(Math.abs(bi - ai), Math.abs(bj - aj)) * 2;
    let prev = a;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const c = Math.round(aj + (bj - aj) * t) * W + Math.round(ai + (bi - ai) * t);
      if (c === prev) continue;
      if (this.heights[c] === BLOCKED || this.clearance[c] < 2 || !this.canStep(prev, c)) return false;
      prev = c;
    }
    return true;
  }
}

/** two-pass chamfer distance (in cells, capped at 255) from every cell to the nearest blocked one */
function computeClearance(h: Int16Array, W: number, H: number): Uint8Array {
  const d = new Uint8Array(W * H);
  for (let k = 0; k < d.length; k++) d[k] = h[k] === BLOCKED ? 0 : 255;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (!d[k]) continue;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) v = Math.min(v, d[k - W] + 1);
      d[k] = v;
    }
  }
  for (let j = H - 1; j >= 0; j--) {
    for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i;
      if (!d[k]) continue;
      let v = d[k];
      if (i < W - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < H - 1) v = Math.min(v, d[k + W] + 1);
      d[k] = v;
    }
  }
  return d;
}

/** binary heap of (id, priority); duplicates allowed (stale entries are skipped by `closed`) */
class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, p: number) {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= p) break;
      ids[i] = ids[parent];
      pri[i] = pri[parent];
      i = parent;
    }
    ids[i] = id;
    pri[i] = p;
  }
  pop(): number {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && pri[r] < pri[l] ? r : l;
        if (pri[m] >= lastP) break;
        ids[i] = ids[m];
        pri[i] = pri[m];
        i = m;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }
}
