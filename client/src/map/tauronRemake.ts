import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d';
import {
  A_D0,
  A_END,
  A_ROW_D,
  A_ROW_R,
  A_TOP,
  A_WALK_Y,
  BACK_WALL_D1,
  BOUNDS_TOP,
  CLOSED_D,
  CONC_CEIL,
  CONC_D1,
  CROSS_END,
  C_D0,
  C_END,
  C_ROW_D,
  C_ROW_R,
  C_WALK_Y,
  LEVEL_B,
  RECESS_D1,
  RECESS_H,
  STAGE_FRAME,
  TABLE_DEPTH,
  TABLE_H,
  TAURON_REMAKE_SPAWNS,
  TUN_CEIL,
  buildArenaGeometry,
  columnPoint,
  columnWidth,
  floorEdgeOffset,
  isRecessColumn,
  layout,
  loopLength,
  roofYAt,
  stationPoint,
  type MeshGroup,
  type Prop,
  type Seat,
  type SurfaceMat,
} from '@ai-gaem/shared/tauron-remake';
import type { PhysicsContext } from '../engine/physics';
import type { GameMap, Vec3 } from './types';

/**
 * `tauron-remake`: procedural TAURON Arena Kraków in its HackYeah 2026 hackathon configuration
 * (see shared/src/tauronRemake/layout.ts for the bowl design). The look follows reference photos
 * taken at the venue (colours / materials / layout only — no photo pixels are used): radial roof
 * truss with rings of spotlights + silver ductwork, acoustic upper bowl wall with a projected
 * cracked pattern, magenta TAURON fascia, telescopic lower tier (steel shelves, folded blue seats,
 * purple under-lighting, steel stair units), fixed upper tier with red aisles, drapes + folded
 * stands closing the west end (service tunnels dressed as the mentors village / chill-out rooms,
 * INFO neon, lounge clutter), desk rows with chairs + laptops, central stage under the oval
 * centre-hung screen, green-epoxy concourse with lane lines, lifts, AC cassettes.
 * All textures are drawn on canvases at load time.
 *
 * Draw-call budget: one merged mesh per bowl surface material; every prop (signs, doors, banners,
 * clutter…) is merged into three meshes sharing ONE canvas atlas (lit + shadow casting, lit
 * without shadows, unlit decals); InstancedMeshes for seats / chairs / laptops / desk clutter /
 * truss / rails / ducts / tubes; Points for the spotlights. Small desk clutter is compacted to
 * the instances within NEAR_R of the camera (no extra draw calls, fewer triangles).
 */

// ------------------------------------------------------------------ canvas helpers

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeat: [number, number] = [1, 1], srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** deterministic noise so every load looks the same */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function speckle(base: string, dots: string[], n: number, size = 256, seed = 1, dot = 2) {
  const [c, g] = canvas(size, size);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = dots[Math.floor(r() * dots.length)]!;
    g.globalAlpha = 0.2 + r() * 0.45;
    const s = 1 + r() * dot;
    g.fillRect(r() * size, r() * size, s, s);
  }
  g.globalAlpha = 1;
  return c;
}

const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';
const MAGENTA = '#e2127c';

/** "TAURON | ARENA KRAKÓW" wordmark as plain text */
function drawTauron(g: CanvasRenderingContext2D, x: number, cy: number, h: number, fg = '#ffffff'): number {
  g.fillStyle = fg;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = `900 ${Math.round(h)}px ${FONT}`;
  g.fillText('TAURON', x, cy);
  let w = g.measureText('TAURON').width;
  g.fillRect(x + w + h * 0.35, cy - h * 0.45, Math.max(1, h * 0.06), h * 0.9);
  g.font = `700 ${Math.round(h * 0.55)}px Arial, sans-serif`;
  g.fillText('ARENA KRAKÓW', x + w + h * 0.6, cy + h * 0.04);
  w += h * 0.6 + g.measureText('ARENA KRAKÓW').width;
  return w;
}

/** stacked "TAURON / rule / ARENA KRAKÓW" (corridor walls, fence banners) */
function drawTauronStacked(g: CanvasRenderingContext2D, cx: number, cy: number, h: number, fg = '#ffffff') {
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(h)}px Arial, sans-serif`;
  g.fillText('TAURON', cx, cy - h * 0.42);
  const w = g.measureText('TAURON').width;
  g.fillRect(cx - w / 2, cy + h * 0.12, w, Math.max(1, h * 0.05));
  g.font = `400 ${Math.round(h * 0.5)}px Arial, sans-serif`;
  g.fillText('ARENA KRAKÓW', cx, cy + h * 0.52);
}

function arrow(g: CanvasRenderingContext2D, x: number, y: number, s: number, dir: 'down' | 'left' | 'right') {
  g.save();
  g.translate(x, y);
  g.rotate(dir === 'down' ? 0 : dir === 'left' ? Math.PI / 2 : -Math.PI / 2);
  g.beginPath();
  g.moveTo(-s * 0.18, -s * 0.5);
  g.lineTo(s * 0.18, -s * 0.5);
  g.lineTo(s * 0.18, 0);
  g.lineTo(s * 0.45, 0);
  g.lineTo(0, s * 0.5);
  g.lineTo(-s * 0.45, 0);
  g.lineTo(-s * 0.18, 0);
  g.closePath();
  g.fill();
  g.restore();
}

// ------------------------------------------------------------------ atlas (all prop / sign art)

interface Rect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** shelf-packed 2048² canvas atlas: every sign, door, banner and label shares one texture */
class Atlas {
  readonly S = 2048;
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private x = 0;
  private y = 0;
  private rowH = 0;
  private rects = new Map<string, Rect>();

  constructor() {
    [this.canvas, this.g] = canvas(this.S, this.S);
    this.g.fillStyle = '#808080';
    this.g.fillRect(0, 0, this.S, this.S);
  }

  add(name: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): Rect {
    const P = 4;
    if (this.x + w + 2 * P > this.S) {
      this.x = 0;
      this.y += this.rowH;
      this.rowH = 0;
    }
    if (this.y + h + 2 * P > this.S) throw new Error(`tauron atlas full at ${name}`);
    const [c, cg] = canvas(w, h);
    draw(cg, w, h);
    const X = this.x + P, Y = this.y + P;
    this.g.drawImage(c, X - P, Y - P, w + 2 * P, h + 2 * P); // edge bleed for mip levels
    this.g.drawImage(c, X, Y);
    this.x += w + 2 * P;
    this.rowH = Math.max(this.rowH, h + 2 * P);
    const S = this.S;
    const r = { u0: (X + 0.5) / S, u1: (X + w - 0.5) / S, v1: 1 - (Y + 0.5) / S, v0: 1 - (Y + h - 0.5) / S };
    this.rects.set(name, r);
    return r;
  }

  get(name: string): Rect {
    const r = this.rects.get(name);
    if (!r) throw new Error(`tauron atlas: no cell ${name}`);
    return r;
  }
}

function fillAtlas(): Atlas {
  const A = new Atlas();
  const r = rng(31);

  // ---- purple HackYeah fabric banners (hung from the balcony rails)
  const BANNERS: { lines: string[]; arrows: 'down' | 'left' | 'right' | null; n: number }[] = [
    { lines: ['MENTORS VILLAGE,', 'SMALL ARENA'], arrows: 'down', n: 3 },
    { lines: ['CHILLOUT ZONE'], arrows: 'down', n: 3 },
    { lines: ['REST', 'ROOMS'], arrows: 'down', n: 3 },
    { lines: ['PITCHING'], arrows: 'left', n: 2 },
    { lines: ['LECTURES'], arrows: 'right', n: 2 },
    { lines: ['CONFERENCE', 'TRACKS'], arrows: 'right', n: 2 },
  ];
  BANNERS.forEach((b, i) =>
    A.add(`banner${i}`, 448, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h);
      gr.addColorStop(0, '#3b2c78');
      gr.addColorStop(1, '#1f1747');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      // fabric folds
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`;
        g.fillRect(r() * w, 0, 8 + r() * 30, h);
      }
      // glitch dashes (pink / cyan) like the event identity
      for (let k = 0; k < 10; k++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,70,170,0.6)' : 'rgba(80,230,255,0.55)';
        g.fillRect(r() * w, r() * h, 10 + r() * 50, 2);
      }
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `900 20px ${FONT}`;
      g.fillText('HACK', w / 2, 22);
      g.fillText('YEAH', w / 2, 42);
      const big = b.lines.length > 1 ? 50 : 58;
      const y0 = b.arrows === 'down' ? (b.lines.length > 1 ? 104 : 128) : b.lines.length > 1 ? 118 : 140;
      b.lines.forEach((t, k) => {
        g.font = `900 ${big}px ${FONT}`;
        const fit = Math.min(big, Math.floor((big * (w - 36)) / g.measureText(t).width));
        g.font = `900 ${fit}px ${FONT}`;
        g.fillStyle = 'rgba(255,60,170,0.85)';
        g.fillText(t, w / 2 - 2, y0 + k * (big + 4));
        g.fillStyle = 'rgba(70,230,255,0.85)';
        g.fillText(t, w / 2 + 2, y0 + k * (big + 4));
        g.fillStyle = '#f4f4ff';
        g.fillText(t, w / 2, y0 + k * (big + 4));
      });
      g.fillStyle = '#f4f4ff';
      if (b.arrows === 'down') for (let k = 0; k < b.n; k++) arrow(g, w * (0.3 + 0.2 * k), h - 34, 34, 'down');
      else if (b.arrows) {
        const yy = y0 + (b.lines.length - 1) * (big + 4);
        for (let k = 0; k < b.n; k++) arrow(g, b.arrows === 'left' ? 34 + k * 30 : w - 34 - k * 30, yy, 32, b.arrows);
      }
    }),
  );

  // ---- hanging red sector signs (concourse): two variants
  const sign = (range: string, arrowLeft: boolean) => (g: CanvasRenderingContext2D, W: number) => {
    g.fillStyle = '#d42a35';
    g.fillRect(0, 0, W, 128);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 76, W, 52);
    drawTauron(g, 16, 24, 26);
    g.font = `900 46px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.fillText(range, 380, 40);
    g.fillStyle = '#d42a35';
    const ax = arrowLeft ? 40 : 470, dir = arrowLeft ? 1 : -1;
    g.beginPath(); g.moveTo(ax, 102); g.lineTo(ax + dir * 26, 86); g.lineTo(ax + dir * 26, 118); g.closePath(); g.fill();
    g.fillRect(ax + dir * 22 - (dir < 0 ? 30 : 0), 97, 30, 10);
    for (let i = 0; i < 4; i++) {
      const px = 130 + i * 70;
      g.beginPath(); g.arc(px, 90, 7, 0, Math.PI * 2); g.fill();
      g.fillRect(px - 8, 99, 16, 22);
    }
  };
  A.add('sign0', 512, 128, sign('20–11', true));
  A.add('sign1', 512, 128, sign('01–10', false));

  // ---- pillar wraps (cylinder u runs round the pillar)
  A.add('wrap0', 1024, 128, (g, w, h) => {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d42a35';
    g.fillRect(0, 0, w, 30);
    g.fillRect(0, h - 30, w, 30);
    g.font = `900 46px ${FONT}`;
    g.textBaseline = 'middle';
    for (const x of [100, 612]) g.fillText('TAURON', x, h / 2);
  });
  A.add('wrap1', 1024, 128, (g, w, h) => {
    g.fillStyle = MAGENTA;
    g.fillRect(0, 0, w, h);
    g.font = `900 46px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    for (const x of [100, 612]) g.fillText('TAURON', x, h / 2);
  });
  A.add('accent', 512, 128, (g, w, h) => {
    g.fillStyle = MAGENTA;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = `900 64px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('TAURON', w / 2, h / 2);
  });
  // corridor / concourse wall band: magenta with stacked wordmark (period 4.5 m × 1.3 m)
  A.add('band', 512, 148, (g, w, h) => {
    g.fillStyle = '#d4146f';
    g.fillRect(0, 0, w, h);
    drawTauronStacked(g, w * 0.3, h / 2, 46);
  });
  A.add('fence', 512, 176, (g, w, h) => {
    g.fillStyle = '#e0287f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 2, h);
    drawTauronStacked(g, w / 2, h / 2, 52);
  });
  A.add('glassdoor', 512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#5c6a78');
    gr.addColorStop(1, '#a8b4bf');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a2d31';
    for (let x = 0; x <= w; x += 128) g.fillRect(x - 5, 0, 10, h);
    g.fillRect(0, 0, w, 14);
    g.fillRect(0, 60, w, 6);
    g.fillStyle = '#c9cfd6';
    for (let x = 0; x < w; x += 128) g.fillRect(x + 54, 140, 20, 4);
  });
  // red quad emergency doors (facade) / single leaf (vomitories) with push bars
  const doorLeaf = (g: CanvasRenderingContext2D, x: number, w: number, h: number, sign: boolean) => {
    g.fillStyle = '#d3202b';
    g.fillRect(x, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(x + w * 0.06, h * 0.04, w * 0.1, h * 0.9);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(x, 0, 3, h);
    g.fillRect(x + w - 3, 0, 3, h);
    g.fillRect(x, h * 0.48, w, 2);
    g.fillStyle = '#c2c6cc';
    g.fillRect(x + w * 0.12, h * 0.56, w * 0.76, h * 0.03);
    g.fillRect(x + w * 0.12, h * 0.54, w * 0.04, h * 0.07);
    g.fillRect(x + w * 0.84, h * 0.54, w * 0.04, h * 0.07);
    g.fillStyle = '#9a9ea4';
    g.fillRect(x + w * 0.3, h * 0.025, w * 0.4, h * 0.02);
    if (sign) {
      g.fillStyle = '#ffffff';
      g.fillRect(x + w * 0.4, h * 0.3, w * 0.2, h * 0.08);
      g.fillStyle = '#1f9c55';
      g.fillRect(x + w * 0.42, h * 0.31, w * 0.16, h * 0.06);
    }
  };
  A.add('door4', 512, 320, (g, w, h) => {
    g.fillStyle = '#2b2b30';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) doorLeaf(g, 6 + i * ((w - 12) / 4), (w - 12) / 4, h, i % 2 === 0);
  });
  A.add('door1', 128, 256, (g, w, h) => doorLeaf(g, 0, w, h, false));
  // grey steel service double door / lift doors
  A.add('greydoor0', 256, 256, (g, w, h) => {
    g.fillStyle = '#cfd2d6';
    g.fillRect(0, 0, w, h);
    for (const x of [8, w / 2 + 2]) {
      g.fillStyle = '#e4e6e9';
      g.fillRect(x, 8, w / 2 - 10, h - 8);
      g.fillStyle = '#9aa0a8';
      g.fillRect(x + 12, h * 0.52, w / 2 - 34, 6);
    }
    g.fillStyle = '#7d828a';
    g.fillRect(w / 2 - 2, 8, 4, h);
    g.fillStyle = '#1f9c55';
    g.fillRect(w * 0.15, h * 0.3, 26, 18);
    g.fillRect(w * 0.72, h * 0.3, 26, 18);
  });
  A.add('greydoor1', 192, 256, (g, w, h) => {
    g.fillStyle = '#d8dadc';
    g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#8e949c');
    gr.addColorStop(0.5, '#c4c9cf');
    gr.addColorStop(1, '#8e949c');
    g.fillStyle = gr;
    g.fillRect(18, 22, w - 36, h - 22);
    g.fillStyle = '#5b6068';
    g.fillRect(w / 2 - 1, 22, 2, h);
    g.fillStyle = '#d62e86';
    g.fillRect(w - 16, h * 0.45, 10, 18);
    g.fillStyle = '#1a1c20';
    g.fillRect(w / 2 - 22, 4, 44, 14);
    g.fillStyle = '#ff5050';
    g.font = 'bold 12px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('0', w / 2, 11);
  });
  // pink neon INFO sign (#HACKYEAH underneath)
  A.add('neon', 512, 176, (g, w, h) => {
    g.fillStyle = '#140a16';
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 118px ${FONT}`;
    g.lineJoin = 'round';
    g.shadowColor = '#ff2fa8';
    g.shadowBlur = 26;
    g.strokeStyle = '#ff3fb0';
    g.lineWidth = 14;
    g.strokeText('INFO', w / 2, 74);
    g.shadowBlur = 8;
    g.strokeStyle = '#ffd6f0';
    g.lineWidth = 5;
    g.strokeText('INFO', w / 2, 74);
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.font = `900 26px ${FONT}`;
    g.fillText('#HACKYEAH', w / 2, 152);
  });
  // roll-up banners
  const rollups: [string, string, string][] = [
    ['CTF', 'VILLAGE', '#141a2e'],
    ['HACK', 'YEAH', '#1b1036'],
    ['MENTORS', 'VILLAGE', '#3a2a7a'],
  ];
  rollups.forEach(([a, b, bg], i) =>
    A.add(`rollup${i}`, 128, 300, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(w / 2, 70, 30, 0, Math.PI * 2); g.fill();
      g.fillStyle = bg;
      g.beginPath(); g.arc(w / 2, 70, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `900 24px ${FONT}`;
      g.fillText(a, w / 2, 140);
      g.fillText(b, w / 2, 168);
      g.fillStyle = '#ff3fb0';
      g.fillRect(16, 196, w - 32, 4);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      for (let k = 0; k < 5; k++) g.fillRect(20, 216 + k * 12, 40 + r() * 50, 4);
    }),
  );
  A.add('standee', 128, 272, (g, w, h) => {
    g.fillStyle = '#f1ecff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#6a3fc8';
    g.beginPath(); g.ellipse(w / 2, 70, 40, 46, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f1ecff';
    g.beginPath(); g.arc(w / 2 - 16, 64, 11, 0, Math.PI * 2); g.arc(w / 2 + 16, 64, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6a3fc8';
    g.fillRect(w / 2 - 26, 118, 52, 120);
    g.fillStyle = '#ffffff';
    g.fillRect(10, 128, w - 20, 50);
    g.fillStyle = '#4b2a9a';
    g.font = `900 17px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('MENTORS', w / 2, 143);
    g.fillText('VILLAGE', w / 2, 164);
  });
  A.add('vending', 128, 256, (g) => {
    g.fillStyle = '#1b1c20';
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#e8eef6';
    g.fillRect(10, 20, 74, 170);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = ['#d42a35', '#2f6fb3', '#f0b400', '#3cb371'][Math.floor(r() * 4)]!;
      g.fillRect(14 + x * 18, 26 + y * 27, 12, 18);
    }
    g.fillStyle = MAGENTA;
    g.fillRect(92, 20, 26, 60);
    g.fillStyle = '#0d0d10';
    g.fillRect(14, 206, 70, 28);
  });
  // stage letter cubes: YEAH / HACK + blank
  const L = 'YEAHHACK ';
  for (let i = 0; i < 9; i++) {
    A.add(`letter${i}`, 128, 128, (g) => {
      g.fillStyle = '#ff1f93';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(4, 4, 120, 120);
      g.fillStyle = '#ff1f93';
      g.fillRect(10, 10, 108, 108);
      g.fillStyle = '#ffffff';
      g.font = `900 92px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(L[i]!, 64, 70);
    });
  }
  // sector labels A01..A24: white panel, blue letters
  for (let i = 0; i < 24; i++) {
    A.add(`label${i}`, 176, 88, (g, w, h) => {
      g.fillStyle = '#ececea';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2b6cb3';
      g.font = `900 62px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`A${String(i + 1).padStart(2, '0')}`, w / 2, h / 2 + 3);
    });
  }
  A.add('tv', 256, 144, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#16205a');
    gr.addColorStop(1, '#3a1660');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = `900 16px ${FONT}`;
    g.fillText('HACKYEAH 2026 · SCHEDULE', 14, 26);
    g.fillStyle = 'rgba(255,255,255,0.65)';
    for (let k = 0; k < 6; k++) g.fillRect(14, 44 + k * 15, 60 + r() * 150, 6);
    g.fillStyle = '#ff3fb0';
    g.fillRect(14, 132, 90, 4);
  });
  A.add('exit', 192, 72, (g, w, h) => {
    g.fillStyle = '#11a05a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.font = `bold 21px Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('WYJŚCIE', 118, 24);
    g.font = `bold 13px Arial, sans-serif`;
    g.fillText('EWAKUACYJNE', 118, 48);
    g.fillRect(14, 12, 40, 48);
    g.fillStyle = '#11a05a';
    g.beginPath(); g.arc(36, 22, 5, 0, Math.PI * 2); g.fill();
    g.fillRect(26, 30, 9, 20);
  });
  A.add('cabinet', 96, 128, (g, w, h) => {
    g.fillStyle = '#c8202a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(4, 4, w - 8, 2);
    g.fillRect(w - 12, h * 0.4, 6, 20);
    g.fillStyle = '#ffffff';
    g.fillRect(20, 26, 40, 40);
    g.fillStyle = '#c8202a';
    g.beginPath(); g.arc(40, 46, 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(40, 46, 6, 0, Math.PI * 2); g.fill();
    g.fillRect(20, 80, 40, 26);
  });
  A.add('ebox', 96, 80, (g, w, h) => {
    g.fillStyle = '#e9eaec';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b9bcc0';
    g.fillRect(w / 2 - 1, 4, 2, h - 8);
    g.fillStyle = '#f2c200';
    g.beginPath(); g.moveTo(24, 18); g.lineTo(36, 40); g.lineTo(12, 40); g.closePath(); g.fill();
    g.fillStyle = '#222';
    g.fillRect(23, 26, 2, 8);
  });
  A.add('ramp', 256, 32, (g, w, h) => {
    g.fillStyle = '#16161a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e6c21e';
    g.fillRect(0, 6, w, h - 12);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < w; x += 8) g.fillRect(x, 6, 2, h - 12);
  });
  A.add('cassette', 64, 64, (g, w, h) => {
    g.fillStyle = '#e8e9ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#9ea2a8';
    g.fillRect(18, 18, 28, 28);
    g.fillStyle = '#c4c7cb';
    for (let i = 0; i < 4; i++) g.fillRect(6, 4 + i * 2, w - 12, 1);
    for (const [x, y, ww, hh] of [[6, 6, w - 12, 6], [6, h - 12, w - 12, 6], [6, 14, 6, h - 28], [w - 12, 14, 6, h - 28]] as const) {
      g.fillStyle = '#6f747a';
      g.fillRect(x, y, ww, hh);
    }
  });
  A.add('white', 8, 8, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
  });
  return A;
}

// ------------------------------------------------------------------ bowl surface textures

/** world-space floor rectangle covered by the floor texture */
const FLOOR_UV = { x0: -48.5, x1: 38.5, z0: -35.5, z1: 35.5 };

/** grey polished concrete, magenta wash, line markings, drain grates, tape lanes */
function floorTexture() {
  const W = 2048;
  const H = Math.round((W * (FLOOR_UV.z1 - FLOOR_UV.z0)) / (FLOOR_UV.x1 - FLOOR_UV.x0));
  const [c, g] = canvas(W, H);
  const sx = W / (FLOOR_UV.x1 - FLOOR_UV.x0);
  const X = (x: number) => (x - FLOOR_UV.x0) * sx;
  const Z = (z: number) => (z - FLOOR_UV.z0) * sx;
  g.fillStyle = '#b3afb1';
  g.fillRect(0, 0, W, H);
  const r = rng(7);
  // big soft blotches (trowel marks / wear) + fine speckle
  for (let i = 0; i < 300; i++) {
    const x = r() * W, y = r() * H, rad = 20 + r() * 110;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.55;
    gr.addColorStop(0, dark ? 'rgba(112,100,106,0.24)' : 'rgba(232,226,228,0.22)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 26000; i++) {
    g.fillStyle = r() < 0.5 ? '#9b9094' : '#d3cacd';
    g.globalAlpha = 0.3;
    g.fillRect(r() * W, r() * H, 2, 2);
  }
  // scuffs (tyre / trolley marks)
  g.strokeStyle = 'rgba(60,54,58,0.12)';
  for (let i = 0; i < 70; i++) {
    g.lineWidth = 2 + r() * 5;
    const x = r() * W, y = r() * H, a = r() * Math.PI;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * 60, y + Math.sin(a) * 60, x + Math.cos(a + 0.4) * 140, y + Math.sin(a + 0.4) * 140);
    g.stroke();
  }
  g.globalAlpha = 1;
  // magenta stage wash (the LED truss + stage lights tint the floor)
  const gr = g.createRadialGradient(X(0), Z(0), 0, X(0), Z(0), 30 * sx);
  gr.addColorStop(0, 'rgba(255,60,170,0.55)');
  gr.addColorStop(0.45, 'rgba(255,70,170,0.22)');
  gr.addColorStop(1, 'rgba(255,90,180,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // expansion joints every 6 m
  g.strokeStyle = 'rgba(70,60,66,0.35)';
  g.lineWidth = 2;
  for (let x = -48; x <= 38; x += 6) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), H); g.stroke(); }
  for (let z = -36; z <= 36; z += 6) { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(W, Z(z)); g.stroke(); }
  // white / grey line markings following the floor edge (ice-rink / court remnants)
  const ring = (off: number, style: string, lw: number) => {
    g.strokeStyle = style;
    g.lineWidth = lw * sx;
    g.beginPath();
    const hx = 36 + off, hz = 23 + off, rr = Math.max(0.5, 10 + off);
    g.roundRect(X(-hx), Z(-hz), 2 * hx * sx, 2 * hz * sx, rr * sx);
    g.stroke();
  };
  ring(-1.5, 'rgba(240,240,240,0.75)', 0.1);
  ring(-1.9, 'rgba(240,240,240,0.55)', 0.06);
  ring(-6.5, 'rgba(120,118,122,0.5)', 0.08);
  // trench drain grates: across the west lounge + along the north / south tier fronts
  const grate = (x0: number, z0: number, x1: number, z1: number) => {
    g.fillStyle = '#4a4648';
    g.fillRect(X(x0), Z(z0), (x1 - x0) * sx, (z1 - z0) * sx);
    g.fillStyle = '#2a2729';
    const horiz = x1 - x0 > z1 - z0;
    if (horiz) for (let x = x0; x < x1; x += 0.06) g.fillRect(X(x), Z(z0) + 1, 1.2, (z1 - z0) * sx - 2);
    else for (let z = z0; z < z1; z += 0.06) g.fillRect(X(x0) + 1, Z(z), (x1 - x0) * sx - 2, 1.2);
  };
  grate(-40.35, -14, -40.05, 14);
  grate(-26, 20.3, 26, 20.55);
  grate(-26, -20.55, 26, -20.3);
  // yellow tape along the centre lane edges
  g.fillStyle = 'rgba(230,190,40,0.8)';
  for (const z of [-3.1, 3.1]) g.fillRect(X(8.5), Z(z) - 2, X(31) - X(8.5), 4);
  for (const z of [-3.1, 3.1]) g.fillRect(X(-44), Z(z) - 2, X(-8.5) - X(-44), 4);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/**
 * Bowl fascia boards. Upper half (v 0.5..1): the magenta "TAURON | ARENA KRAKÓW" band on the
 * upper-ring front. Lower half: the charcoal floor-level boards in front of tier A.
 */
function fasciaTexture() {
  const W = 4096, H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = MAGENTA;
  g.fillRect(0, 0, W, 128);
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.fillRect(0, 0, W, 10);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let x = 0; x < W; x += 512) g.fillRect(x, 0, 3, 128); // LED panel joints
  let x = 30;
  while (x < W - 600) x += drawTauron(g, x, 66, 58) + 260;
  g.fillStyle = '#26272b';
  g.fillRect(0, 128, W, 128);
  g.fillStyle = MAGENTA;
  g.fillRect(0, 128, W, 10);
  for (let x2 = 80; x2 < W - 500; x2 += 1360) drawTauron(g, x2, 196, 40, '#d9dbe0');
  return tex(c, [1 / 40, 1]);
}

/** neutral steel / concrete treads, tinted per tier by vertex colour (A light steel, C concrete) */
function tierTexture() {
  const [c, g] = canvas(256, 256);
  g.drawImage(speckle('#c4c4c2', ['#b4b4b2', '#d2d2d0', '#a4a4a2'], 2600, 256, 5), 0, 0);
  g.fillStyle = 'rgba(70,72,78,0.25)';
  for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 2, 256); // deck plate joints
  return tex(c, [1 / 3, 1 / 3]);
}

/** neutral aisle treads with a nosing line + anti-slip dots; tinted steel (A) or red (C) */
function aisleTexture() {
  const [c, g] = canvas(256, 256);
  g.drawImage(speckle('#d6d2d0', ['#c2bebc', '#e2dedc', '#b0acaa'], 2400, 256, 9), 0, 0);
  g.fillStyle = 'rgba(40,40,44,0.18)';
  for (let y = 4; y < 256; y += 10) for (let x = (y % 20) / 2; x < 256; x += 10) g.fillRect(x, y, 3, 3);
  return tex(c, [1 / 1.2, 1 / 1.2]);
}

function riserTexture() {
  // concrete risers with blue painted row numbers (tile 2 m × 1.1 m)
  const [c, g] = canvas(256, 256);
  g.drawImage(speckle('#a9a8a3', ['#9a9994', '#bab9b4'], 1800, 256, 13), 0, 0);
  g.fillStyle = '#2f6fb3';
  g.font = `bold 34px Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const r = rng(4);
  for (let i = 0; i < 4; i++) g.fillText(String(1 + Math.floor(r() * 24)), 40 + i * 60, 64 + (i % 2) * 128);
  g.fillStyle = '#a3262e';
  g.fillRect(0, 250, 256, 6);
  g.fillRect(0, 122, 256, 6);
  return tex(c, [1 / 2, 1 / 1.1]);
}

/**
 * telescopic tier riser (one row rise per texture height): steel nosing at the top, then the
 * purple / pink under-light washing down the dark riser. Returns [colour, emissive].
 */
function shelfTextures(): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const W = 256, H = 128;
  const make = (emissive: boolean) => {
    const [c, g] = canvas(W, H);
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, emissive ? '#000000' : '#c3c6ca');
    gr.addColorStop(0.2, emissive ? '#000000' : '#b3b6ba');
    gr.addColorStop(0.21, emissive ? '#b03cc0' : '#4a2a62');
    gr.addColorStop(0.42, emissive ? '#3a1450' : '#2a1d3a');
    gr.addColorStop(1, emissive ? '#000000' : '#18161e');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    if (!emissive) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, 25, W, 2);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(0, 0, W, 2);
      g.fillStyle = 'rgba(40,40,46,0.6)';
      for (let x = 0; x < W; x += 128) g.fillRect(x, 0, 3, H); // frame posts
    }
    return c;
  };
  const off = -(A_WALK_Y / A_ROW_R - Math.floor(A_WALK_Y / A_ROW_R));
  const col = tex(make(false), [1 / 2, 1 / A_ROW_R]);
  const em = tex(make(true), [1 / 2, 1 / A_ROW_R]);
  col.offset.y = em.offset.y = off;
  return [col, em];
}

function wallTexture() {
  // white/light-grey painted block walls (vomitories, partitions, concourse)
  const [c, g] = canvas(256, 256);
  g.drawImage(speckle('#dcdcd8', ['#cfcfcb', '#e6e6e2'], 1400, 256, 3), 0, 0);
  g.fillStyle = 'rgba(80,84,90,0.18)';
  g.fillRect(0, 0, 2, 256);
  g.fillStyle = 'rgba(70,72,76,0.5)';
  g.fillRect(0, 248, 256, 8); // skirting
  return tex(c, [1 / 2.4, 1 / 3]);
}

/**
 * acoustic upper bowl wall: dark quilted panels with a projected light-grey cracked (voronoi)
 * pattern. 24 m tile; jittered-grid voronoi keeps the build fast.
 */
function mosaicTexture() {
  const S = 1024;
  const [c, g] = canvas(S, S);
  const r = rng(99);
  // panels 1.2 × 2.4 m (≈ 51 × 102 px), staggered, slightly varying shade + curved highlight
  g.fillStyle = '#16171b';
  g.fillRect(0, 0, S, S);
  const pw = S / 20, ph = S / 10;
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 20; col++) {
      const x = col * pw + (row % 2 ? pw / 2 : 0), y = row * ph;
      const v = 26 + r() * 16;
      const gr = g.createLinearGradient(x, y, x + pw, y);
      gr.addColorStop(0, `rgb(${v - 8},${v - 8},${v - 5})`);
      gr.addColorStop(0.5, `rgb(${v + 6},${v + 6},${v + 9})`);
      gr.addColorStop(1, `rgb(${v - 10},${v - 10},${v - 7})`);
      g.fillStyle = gr;
      for (const dx of [0, -S]) g.fillRect(x + dx + 2, y + 2, pw - 4, ph - 4);
    }
  }
  // projected cracked pattern
  const N = 8, cell = S / N;
  const pts: [number, number][] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push([(i + 0.15 + r() * 0.7) * cell, (j + 0.15 + r() * 0.7) * cell]);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const cj = Math.floor(y / cell);
    for (let x = 0; x < S; x++) {
      const ci = Math.floor(x / cell);
      let d1 = 1e9, d2 = 1e9;
      for (let oj = -1; oj <= 1; oj++) {
        for (let oi = -1; oi <= 1; oi++) {
          const jj = (cj + oj + N) % N, ii = (ci + oi + N) % N;
          const p = pts[jj * N + ii]!;
          const px = p[0] + (ci + oi - ii) * cell, py = p[1] + (cj + oj - jj) * cell;
          const dd = (x - px) ** 2 + (y - py) ** 2;
          if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      if (edge < 9) {
        const a = edge < 3 ? 0.5 : 0.5 * (1 - (edge - 3) / 6) ** 2;
        const o = (y * S + x) * 4;
        d[o] = d[o]! + (150 - d[o]!) * a;
        d[o + 1] = d[o + 1]! + (160 - d[o + 1]!) * a;
        d[o + 2] = d[o + 2]! + (178 - d[o + 2]!) * a;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, [1 / 24, 1 / 24]);
}

function roofTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#121418';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#1c1f25';
  g.lineWidth = 3;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
  }
  return tex(c, [1 / 8, 1 / 8]);
}

/**
 * folded (retracted) telescopic stands on the closed end, 24 m × 9.45 m tile: stacked steel
 * shelves with folded blue seats and purple light, dark purple wall panels between the blocks,
 * warm downlights under the balcony.
 */
function standsTexture() {
  const W = 2048, H = 806;
  const [c, g] = canvas(W, H);
  const m = W / 24;
  const Y = (y: number) => H - y * m;
  const r = rng(17);
  g.fillStyle = '#2a2433';
  g.fillRect(0, 0, W, H);
  // upper wall under the balcony slab
  g.fillStyle = '#1d1a24';
  g.fillRect(0, Y(9.45), W, 2.2 * m);
  g.fillStyle = '#ffe9c0';
  for (let x = 0.8; x < 24; x += 2) g.fillRect(x * m, Y(7.55), 0.45 * m, 0.08 * m);
  const block = (x0: number, w: number) => {
    const top = 6.9;
    g.fillStyle = '#120c1c';
    g.fillRect(x0 * m, Y(top), w * m, top * m);
    for (let y = 0.35; y < top; y += 0.42) {
      // purple glow under each shelf
      const gr = g.createLinearGradient(0, Y(y + 0.36), 0, Y(y));
      gr.addColorStop(0, 'rgba(150,60,180,0.55)');
      gr.addColorStop(0.5, 'rgba(50,24,70,0.4)');
      gr.addColorStop(1, 'rgba(20,14,28,0.2)');
      g.fillStyle = gr;
      g.fillRect(x0 * m, Y(y + 0.36), w * m, 0.36 * m);
      // folded blue seats
      for (let x = x0 + 0.12; x < x0 + w - 0.4; x += 0.5) {
        g.fillStyle = r() < 0.5 ? '#4387c4' : '#5294cf';
        g.beginPath();
        g.ellipse((x + 0.22) * m, Y(y + 0.17), 0.2 * m, 0.085 * m, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.2)';
        g.fillRect((x + 0.08) * m, Y(y + 0.22), 0.28 * m, 1.5);
      }
      // steel shelf nosing (thick, light grey)
      g.fillStyle = '#c9ccd1';
      g.fillRect(x0 * m, Y(y + 0.42), w * m, 0.1 * m);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x0 * m, Y(y + 0.32), w * m, 2);
    }
    // frame posts
    g.fillStyle = '#8f949b';
    for (let x = x0; x <= x0 + w + 0.01; x += w / 5) g.fillRect(x * m - 3, Y(top), 6, top * m);
    g.fillStyle = '#5c6067';
    g.fillRect(x0 * m, Y(0.3), w * m, 0.3 * m);
  };
  block(0.3, 10.8);
  block(13.0, 10.7);
  // dark purple wall panel between the blocks
  g.fillStyle = '#3a2c4a';
  g.fillRect(11.25 * m, Y(6.9), 1.6 * m, 6.9 * m);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(11.25 * m, Y(6.9), 1.6 * m, 4);
  return tex(c, [1 / 24, 1 / 9.45]);
}

/** pale green glossy epoxy (concourse + box floors) */
function epoxyTexture() {
  const [c, g] = canvas(256, 256);
  g.drawImage(speckle('#b8c6a4', ['#adbb99', '#c4d2b0'], 900, 256, 11, 6), 0, 0);
  return tex(c, [1 / 6, 1 / 6]);
}

function dashes(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, r: () => number, n: number) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? '#2fe0d0' : '#ff3c9a';
    g.fillRect(x0 + r() * w, y0 + r() * h, 10 + r() * 50, 4);
  }
}

/** scoreboard screens: four HACK / YEAH panels round the oval drum, glitch dashes */
function screenTexture() {
  const W = 2048, H = 320;
  const [c, g] = canvas(W, H);
  const r = rng(21);
  const n = 4, w = W / n;
  for (let i = 0; i < n; i++) {
    const x = i * w;
    const gr = g.createLinearGradient(x, 0, x + w, H);
    gr.addColorStop(0, '#1f4f9a');
    gr.addColorStop(0.55, '#3f7fd0');
    gr.addColorStop(1, '#2a5fb0');
    g.fillStyle = gr;
    g.fillRect(x, 0, w, H);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath(); g.moveTo(x + w * 0.2, 0); g.lineTo(x + w * 0.45, 0); g.lineTo(x + w * 0.25, H); g.lineTo(x, H); g.closePath(); g.fill();
    const cx = x + w / 2, s = Math.min(w / 4.6, H / 3.6);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${Math.round(s * 1.15)}px ${FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText('HACK', cx, H * 0.34);
    const tw = g.measureText('YEAH').width;
    g.fillRect(cx - tw / 2 - s * 0.15, H * 0.5, tw + s * 0.3, s * 1.2);
    g.fillStyle = '#1d3f7a';
    g.fillText('YEAH', cx, H * 0.5 + s * 0.62);
    dashes(g, x + w * 0.05, H * 0.1, w * 0.9, H * 0.8, r, 9);
    g.font = `700 ${Math.round(s * 0.28)}px Arial, sans-serif`;
    g.fillStyle = '#ffffff';
    g.fillText('3–4 OCTOBER 2026', cx, H * 0.9);
  }
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let px = 0; px < W; px += 3) g.fillRect(px, 0, 1, H);
  return tex(c);
}

function bandTexture(kind: 'top' | 'ticker') {
  const W = 4096, H = 128;
  const [c, g] = canvas(W, H);
  if (kind === 'top') {
    g.fillStyle = MAGENTA;
    g.fillRect(0, 0, W, H);
    let x = 40;
    for (let i = 0; i < 4; i++) {
      drawTauron(g, x, 66, 62);
      x += W / 4;
    }
  } else {
    g.fillStyle = '#1b2a8f';
    g.fillRect(0, 0, W, H);
    g.fillStyle = MAGENTA;
    g.fillRect(0, 0, W, 14);
    g.fillRect(0, H - 14, W, 14);
    g.fillStyle = '#ff5ab0';
    g.font = `900 56px ${FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    for (let x = 0; x < W; x += 2048) g.fillText('THE BIGGEST STATIONARY HACKATHON IN EUROPE  ·  HACKYEAH 2026  ·', x + 20, 66);
  }
  return tex(c);
}

function glowTexture() {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,246,225,0.95)');
  gr.addColorStop(0.45, 'rgba(255,230,190,0.25)');
  gr.addColorStop(1, 'rgba(255,220,180,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return tex(c);
}

// ------------------------------------------------------------------ materials

interface Mats {
  surface: Record<SurfaceMat, THREE.Material>;
  /** lit atlas material for all props (per-vertex `glow` adds emission) */
  prop: THREE.MeshStandardMaterial;
  /** unlit atlas material (signs, LEDs, screens, neon) */
  decal: THREE.MeshBasicMaterial;
  metal: THREE.MeshStandardMaterial;
  truss: THREE.MeshStandardMaterial;
  atlas: Atlas;
  textures: THREE.Texture[];
  keep<T extends THREE.Texture>(t: T): T;
}

function makeMaterials(): Mats {
  const textures: THREE.Texture[] = [];
  const keep = <T extends THREE.Texture>(t: T) => (textures.push(t), t);
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...p });

  const floor = keep(floorTexture());
  const concrete = keep(tex(speckle('#8f9095', ['#7f8085', '#a2a3a8', '#717277'], 2600, 256, 2), [1 / 4, 1 / 4]));
  const tier = keep(tierTexture());
  const aisle = keep(aisleTexture());
  const riser = keep(riserTexture());
  const [shelf, shelfEm] = shelfTextures();
  keep(shelf);
  keep(shelfEm);
  const fascia = keep(fasciaTexture());
  const wall = keep(wallTexture());
  const roof = keep(roofTexture());
  const mosaic = keep(mosaicTexture());
  const stands = keep(standsTexture());
  const epoxy = keep(epoxyTexture());

  const surface: Record<SurfaceMat, THREE.Material> = {
    floor: std({ map: floor, roughness: 0.55, vertexColors: true, emissive: 0xffffff, emissiveMap: floor, emissiveIntensity: 0.32 }),
    tier: std({ map: tier, vertexColors: true, roughness: 0.6, metalness: 0.15 }),
    aisle: std({ map: aisle, vertexColors: true, roughness: 0.6 }),
    riser: std({ map: riser, vertexColors: true }),
    shelf: std({ map: shelf, vertexColors: true, emissive: 0xffffff, emissiveMap: shelfEm, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.2 }),
    walk: std({ map: concrete, vertexColors: true, color: 0xf0f0ea }),
    concrete: std({ map: concrete, vertexColors: true, color: 0xb8bcc4 }),
    wall: std({ map: wall, vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xc8dcea,
      transparent: true,
      opacity: 0.12,
      roughness: 0.05,
      metalness: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    led: new THREE.MeshBasicMaterial({ map: fascia }),
    carpet: std({ map: epoxy, vertexColors: true, roughness: 0.3 }),
    ceiling: std({ color: 0x3a3c41, vertexColors: true, map: concrete }),
    stands: std({ map: stands, vertexColors: true, emissive: 0xffffff, emissiveMap: stands, emissiveIntensity: 0.3 }),
    mosaic: std({ map: mosaic, side: THREE.DoubleSide, roughness: 0.95, vertexColors: true, emissive: 0xffffff, emissiveMap: mosaic, emissiveIntensity: 0.3 }),
    roof: std({ map: roof, side: THREE.DoubleSide, roughness: 0.95 }),
  };
  // "baked" interior light: faces the mesher marked as covered (vertex shade < 1) glow a little,
  // standing in for the concourse / tunnel / box fluorescent lighting without real lights
  for (const k of ['tier', 'aisle', 'riser', 'walk', 'concrete', 'wall', 'ceiling'] as const) interiorGlow(surface[k] as THREE.MeshStandardMaterial);
  interiorGlow(surface.carpet as THREE.MeshStandardMaterial, 2.2);

  const atlas = fillAtlas();
  const atlasTex = keep(tex(atlas.canvas));
  atlasTex.wrapS = atlasTex.wrapT = THREE.ClampToEdgeWrapping;
  const prop = new THREE.MeshStandardMaterial({ map: atlasTex, vertexColors: true, roughness: 0.7, metalness: 0 });
  vertexGlow(prop);
  const decal = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true });
  const metal = std({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.6, emissive: 0x15171a });
  const truss = std({ color: 0xb4b8be, roughness: 0.35, metalness: 0.7 });
  return { surface, prop, decal, metal, truss, atlas, textures, keep };
}

/** interior glow from the per-vertex `shade` attribute (1 = open sky, 0.5 = under a slab) */
function interiorGlow(m: THREE.MeshStandardMaterial, k = 1.5) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float shade;\nvarying float vShade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShade = shade;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vShade;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * (1.0 - vShade) * ${k.toFixed(2)};`,
      );
  };
  m.customProgramCacheKey = () => `interiorGlow${k}`;
}

/** per-vertex emission strength (`glow` attribute) for the shared prop material */
function vertexGlow(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n      totalEmissiveRadiance += diffuseColor.rgb * vGlow;');
  };
  m.customProgramCacheKey = () => 'tauronVertexGlow';
}

// ------------------------------------------------------------------ merged piece builder

type V3 = [number, number, number];

/** accumulates non-indexed triangles (position, normal, atlas uv, colour, glow) for one mesh */
class Pieces {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  glow: number[] = [];
  private c = new THREE.Color();
  private wu: number;
  private wv: number;

  constructor(white: Rect) {
    this.wu = (white.u0 + white.u1) / 2;
    this.wv = (white.v0 + white.v1) / 2;
  }

  /**
   * append a geometry (consumed). `face(i)` may return an atlas cell (+ colour) for the triangle
   * containing vertex i; otherwise the flat `color` is used with the atlas' white cell.
   */
  geo(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, glow = 0, face?: (i: number) => { r: Rect; c?: THREE.ColorRepresentation } | null) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.getAttribute('position'), n = ng.getAttribute('normal'), uv = ng.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      const f = face?.(i) ?? null;
      if (f && uv) {
        this.uv.push(f.r.u0 + uv.getX(i) * (f.r.u1 - f.r.u0), f.r.v0 + uv.getY(i) * (f.r.v1 - f.r.v0));
        this.c.set(f.c ?? 0xffffff);
      } else {
        this.uv.push(this.wu, this.wv);
        this.c.set(color);
      }
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.glow.push(glow);
    }
    if (ng !== g) ng.dispose();
    g.dispose();
  }

  /** quad a-b-c-d facing `want`; uv corners in cell space (default full cell) */
  quad(a: V3, b: V3, c: V3, d: V3, want: V3, color: THREE.ColorRepresentation, glow = 0, r?: Rect, us: [number, number] = [0, 1]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const flip = nx * want[0] + ny * want[1] + nz * want[2] < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    this.c.set(color);
    const U = (t: number) => (r ? r.u0 + t * (r.u1 - r.u0) : this.wu);
    const Vv = (t: number) => (r ? r.v0 + t * (r.v1 - r.v0) : this.wv);
    const verts: [V3, number, number][] = [[a, U(us[0]), Vv(0)], [b, U(us[1]), Vv(0)], [c, U(us[1]), Vv(1)], [d, U(us[0]), Vv(1)]];
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    for (const k of order) {
      const [p, u, v] = verts[k]!;
      this.pos.push(...p);
      this.nor.push(nx, ny, nz);
      this.uv.push(u, v);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.glow.push(glow);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('glow', new THREE.Float32BufferAttribute(this.glow, 1));
    g.computeBoundingSphere();
    return g;
  }
}

interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
function place(g: THREE.BufferGeometry, p: Pose, tilt = 0): THREE.BufferGeometry {
  _q.setFromAxisAngle(UP, p.yaw);
  if (tilt) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
  _m.compose(_v.set(p.x, p.y, p.z), _q, _one);
  return g.applyMatrix4(_m);
}

/** box face order (non-indexed BoxGeometry): +x −x +y −y +z −z, 6 vertices each */
const faceOf = (i: number) => Math.floor(i / 6);
/** faces normal to the box's thinnest axis (where print goes) */
function bigFaces(sx: number, sy: number, sz: number): [number, number] {
  if (sx <= sy && sx <= sz) return [0, 1];
  if (sz <= sx && sz <= sy) return [4, 5];
  return [2, 3];
}

// ------------------------------------------------------------------ props → merged meshes

interface PropBuckets {
  cast: Pieces;
  nocast: Pieces;
  decal: Pieces;
}

const COL = {
  stage: 0x141416,
  table: 0x121215,
  tableTop: 0x2a2b30,
  speaker: 0x111215,
  pillar: 0x55585e,
  pillarRing: 0x5fae6e,
  counter: 0xc9cbcf,
  red: 0xd0202a,
  bag: 0x0e0e10,
  metal: 0x8a9098,
  trussLight: 0xb4b8be,
  drape: 0x17171b,
  banner: 0x241a4a,
  caseBlack: 0x19191c,
  alu: 0xa4aab2,
  wood: 0xc49a62,
  blueChair: 0x24399a,
  white: 0xe9eaec,
  ebStand: 0x2a54b8,
  grey: 0xc4c7cb,
};

function addProp(B: PropBuckets, A: Atlas, p: Prop) {
  const box = () => new THREE.BoxGeometry(p.sx, p.sy, p.sz);
  const cyl = (rTop = p.sx / 2, h = p.sy, segs = 16) => new THREE.CylinderGeometry(rTop, rTop, h, segs);
  const pose: Pose = p;
  const big = bigFaces(p.sx, p.sy, p.sz);
  /** print `rect` on the big faces, flat `c` elsewhere */
  const printed = (bucket: Pieces, rect: Rect, c: number, glow: number, faces: number[] = big) =>
    bucket.geo(place(box(), pose), c, glow, (i) => (faces.includes(faceOf(i)) ? { r: rect } : null));
  switch (p.mat) {
    case 'stage':
      B.cast.geo(place(box(), pose), COL.stage);
      break;
    case 'table':
      B.cast.geo(place(box(), pose), COL.table);
      B.nocast.geo(place(new THREE.BoxGeometry(p.sx + 0.03, 0.025, p.sz + 0.03), { ...pose, y: p.y + p.sy / 2 }), COL.tableTop);
      break;
    case 'speaker':
      B.cast.geo(place(box(), pose), COL.speaker);
      break;
    case 'truss':
      B.nocast.geo(place(box(), pose), COL.trussLight);
      break;
    case 'led':
      B.decal.geo(place(box(), pose), 0xff2ea0);
      break;
    case 'letters':
      B.cast.geo(place(box(), pose), 0xff1f93, 0.9, (i) => ({ r: A.get(`letter${faceOf(i) >= 4 ? p.tag ?? 8 : 8}`) }));
      break;
    case 'pillar': {
      B.cast.geo(place(cyl(), pose), COL.pillar, 0.3);
      B.nocast.geo(place(cyl(p.sx / 2 + 0.025, 0.14), { ...pose, y: p.y - p.sy / 2 + 0.07 }), COL.pillarRing);
      break;
    }
    case 'wrap':
      B.nocast.geo(place(cyl(), pose), 0xffffff, 0.25, () => ({ r: A.get(`wrap${(p.tag ?? 0) % 2}`) }));
      break;
    case 'counter':
      B.cast.geo(place(box(), pose), COL.counter);
      break;
    case 'accent':
      printed(B.nocast, A.get('accent'), 0xd4146f, 0.3);
      break;
    case 'sign':
      B.decal.geo(place(box(), pose), 0xd42a35, 0, (i) => (faceOf(i) >= 4 ? { r: A.get(`sign${1 - ((p.tag ?? 0) % 2)}`) } : null));
      break;
    case 'exit':
      B.decal.geo(place(box(), pose), 0x11a05a, 0, (i) => (faceOf(i) >= 4 ? { r: A.get('exit') } : null));
      break;
    case 'door': {
      const wide = Math.max(p.sx, p.sz) > 2;
      printed(B.nocast, A.get(wide ? 'door4' : 'door1'), COL.red, 0.35);
      break;
    }
    case 'greydoor':
      printed(B.nocast, A.get(`greydoor${p.tag ?? 0}`), COL.grey, 0.25);
      break;
    case 'cabinet':
      printed(B.nocast, A.get('cabinet'), 0xc8202a, 0.3);
      break;
    case 'bin': {
      const r = p.sx / 2;
      B.nocast.geo(place(new THREE.CylinderGeometry(r, r * 0.88, p.sy, 12), pose), COL.red, 0.08);
      B.nocast.geo(place(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.12, 12), { ...pose, y: p.y + p.sy / 2 - 0.02 }), COL.bag);
      break;
    }
    case 'vending':
      B.cast.geo(place(box(), pose), 0x1b1c20, 0.45, (i) => (faceOf(i) === 5 ? { r: A.get('vending') } : null));
      break;
    case 'glassdoor':
      B.decal.geo(place(box(), pose), 0x3a4048, 0, (i) => (faceOf(i) >= 4 ? { r: A.get('glassdoor') } : null));
      break;
    case 'drape':
      drapeGeometry(B.nocast, p);
      break;
    case 'metal':
      B.nocast.geo(place(p.cyl ? cyl(p.sx / 2, p.sy, 8) : box(), pose), COL.metal);
      break;
    case 'banner':
      B.nocast.geo(place(box(), pose), COL.banner, 0.3, (i) => (faceOf(i) === 5 ? { r: A.get(`banner${p.tag ?? 0}`) } : null));
      break;
    case 'neon':
      B.decal.geo(place(box(), pose), 0x140a16, 0, (i) => (faceOf(i) === 5 ? { r: A.get('neon') } : null));
      break;
    case 'rollup':
      B.nocast.geo(place(box(), pose), 0x8a8e94, 0.3, (i) => (faceOf(i) === 5 ? { r: A.get(`rollup${p.tag ?? 0}`) } : null));
      break;
    case 'beanbag': {
      const g0 = new THREE.IcosahedronGeometry(0.5, 1);
      g0.deleteAttribute('normal');
      g0.deleteAttribute('uv');
      const g = mergeVertices(g0);
      g0.dispose();
      g.scale(p.sx, p.sy * 1.15, p.sz);
      g.translate(0, -p.sy * 0.05, 0);
      g.computeVertexNormals();
      B.nocast.geo(place(g, pose), [0x1a1a1e, 0xd6c19c, 0x22305e][(p.tag ?? 0) % 3]!);
      break;
    }
    case 'case': {
      B.cast.geo(place(box(), pose), COL.caseBlack);
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      for (const [lx, lz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const ox = (lx * p.sx) / 2, oz = (lz * p.sz) / 2;
        B.nocast.geo(place(new THREE.BoxGeometry(0.035, p.sy + 0.01, 0.035), { x: p.x + ox * c + oz * s, y: p.y, z: p.z - ox * s + oz * c, yaw: p.yaw }), COL.alu);
      }
      break;
    }
    case 'ebox':
      printed(B.nocast, A.get('ebox'), COL.white, 0.12, [5]);
      break;
    case 'ramp':
      B.nocast.geo(place(box(), pose), 0x16161a, 0.1, (i) => (faceOf(i) === 2 ? { r: A.get('ramp') } : null));
      break;
    case 'fence':
      printed(B.nocast, A.get('fence'), 0xe0287f, 0.3);
      break;
    case 'screen':
      B.decal.geo(place(box(), pose), 0x0b0b0e, 0, (i) => (faceOf(i) === 5 ? { r: A.get('tv') } : null));
      break;
    case 'wood': {
      B.nocast.geo(place(new THREE.BoxGeometry(p.sx, 0.04, p.sz), { ...pose, y: p.y + p.sy / 2 - 0.02 }), COL.wood, 0.45);
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
      for (const [lx, lz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const ox = lx * (p.sx / 2 - 0.05), oz = lz * (p.sz / 2 - 0.05);
        B.nocast.geo(place(new THREE.BoxGeometry(0.04, p.sy - 0.04, 0.04), { x: p.x + ox * c + oz * s, y: p.y - 0.02, z: p.z - ox * s + oz * c, yaw: p.yaw }), COL.metal);
      }
      break;
    }
    case 'chairblue':
      chairPieces(B.nocast, pose, p.sy, COL.blueChair, 0x5a5e66, 0.5);
      break;
    case 'standee':
      printed(B.nocast, A.get('standee'), 0xf1ecff, 0.2);
      break;
  }
}

/** blue plastic chair at `pose` (feet at pose.y - h/2) */
function chairPieces(b: Pieces, pose: Pose, h: number, seat: number, legs: number, glow = 0) {
  const y0 = pose.y - h / 2;
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  const at = (lx: number, ly: number, lz: number): Pose => ({ x: pose.x + lx * c + lz * s, y: y0 + ly, z: pose.z - lx * s + lz * c, yaw: pose.yaw });
  b.geo(place(new THREE.BoxGeometry(0.44, 0.05, 0.42), at(0, 0.46, 0)), seat, glow);
  b.geo(place(new THREE.BoxGeometry(0.44, 0.34, 0.04), at(0, 0.72, 0.2), -0.12), seat, glow);
  for (const [lx, lz] of [[0.19, 0.18], [-0.19, 0.18], [0.19, -0.18], [-0.19, -0.18]] as const) b.geo(place(new THREE.BoxGeometry(0.025, 0.45, 0.025), at(lx, 0.225, lz)), legs, glow);
}

/** heavy black drape with vertical folds (front + back), shading baked into vertex colours */
function drapeGeometry(b: Pieces, p: Prop) {
  const n = Math.max(4, Math.round(p.sx / 0.18));
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const y0 = p.y - p.sy / 2, y1 = p.y + p.sy / 2;
  const phase = (p.x * 0.37 + p.z * 0.53) % 1;
  const W = (lx: number, lz: number, y: number): V3 => [p.x + lx * c + lz * s, y, p.z - lx * s + lz * c];
  const base = new THREE.Color(COL.drape);
  for (let i = 0; i < n; i++) {
    const xa = -p.sx / 2 + (i / n) * p.sx, xb = -p.sx / 2 + ((i + 1) / n) * p.sx;
    const fa = Math.sin(((xa / 0.72) + phase) * Math.PI * 2), fb = Math.sin(((xb / 0.72) + phase) * Math.PI * 2);
    const za = fa * 0.13, zb = fb * 0.13;
    const lite = 0.55 + 0.45 * Math.cos(((xa + xb) / 2 / 0.72 + phase) * Math.PI * 2);
    const col = base.clone().multiplyScalar(0.6 + lite * 1.1);
    // front (faces −z local = into the arena) and back
    for (const side of [-1, 1]) {
      // local −z in world = (−sin yaw, −cos yaw) faces the arena; the back faces the other way
      const off = side * 0.02;
      const want: V3 = [side < 0 ? -s : s, 0, side < 0 ? -c : c];
      b.quad(W(xa, za + off, y0), W(xb, zb + off, y0), W(xb, zb + off, y1), W(xa, za + off, y1), want, col);
    }
  }
}

// ------------------------------------------------------------------ bowl surfaces

/** per-vertex tint so one texture serves the steel lower tier and the concrete upper tier */
const TINT: Partial<Record<SurfaceMat, (y: number) => [number, number, number]>> = {
  tier: (y) => (y <= A_TOP + 0.01 ? [1.0, 1.0, 1.03] : [0.66, 0.65, 0.63]),
  aisle: (y) => (y <= A_TOP + 0.01 ? [0.72, 0.74, 0.78] : [0.74, 0.17, 0.2]),
};

function groupGeometry(mat: SurfaceMat, g: MeshGroup): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(g.positions);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.normals), 3));
  const uv = new Float32Array(g.uvs);
  if (mat === 'floor') {
    for (let i = 0; i < pos.length / 3; i++) {
      uv[i * 2] = (pos[i * 3]! - FLOOR_UV.x0) / (FLOOR_UV.x1 - FLOOR_UV.x0);
      uv[i * 2 + 1] = 1 - (pos[i * 3 + 2]! - FLOOR_UV.z0) / (FLOOR_UV.z1 - FLOOR_UV.z0);
    }
  } else if (mat === 'led') {
    // boards: front wall 0..1.2 m → lower half of the texture; C fascia 12.2..12.95 m → upper half
    for (let i = 0; i < pos.length / 3; i++) {
      const y = pos[i * 3 + 1]!;
      uv[i * 2 + 1] = y < 6 ? THREE.MathUtils.clamp(y / 1.2, 0, 1) * 0.5 : 0.5 + THREE.MathUtils.clamp((y - 12.2) / 0.75, 0, 1) * 0.5;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const tint = TINT[mat];
  const col = new Float32Array(g.shade.length * 3);
  for (let i = 0; i < g.shade.length; i++) {
    const s = g.shade[i]!;
    const t = tint ? tint(pos[i * 3 + 1]!) : [1, 1, 1];
    col[i * 3] = s * t[0]!;
    col[i * 3 + 1] = s * t[1]!;
    col[i * 3 + 2] = s * t[2]!;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('shade', new THREE.BufferAttribute(new Float32Array(g.shade), 1));
  geo.computeBoundingSphere();
  return geo;
}

// ------------------------------------------------------------------ seats

/** low-poly stadium seat facing −z (pan down + back), ~14 triangles */
function seatGeometry(): THREE.BufferGeometry {
  const w = 0.23;
  const pos: number[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  quad([-w, 0.44, -0.2], [w, 0.44, -0.2], [w, 0.44, 0.16], [-w, 0.44, 0.16]);
  quad([-w, 0.36, -0.2], [w, 0.36, -0.2], [w, 0.44, -0.2], [-w, 0.44, -0.2]);
  const b0 = 0.16, b1 = 0.22, t0 = 0.2, t1 = 0.26;
  quad([-w, 0.44, b0], [w, 0.44, b0], [w, 0.86, t0], [-w, 0.86, t0]);
  quad([-w, 0.86, t0], [w, 0.86, t0], [w, 0.86, t1], [-w, 0.86, t1]);
  quad([w, 0.3, b1], [-w, 0.3, b1], [-w, 0.86, t1], [w, 0.86, t1]);
  quad([w, 0.44, b0], [w, 0.3, b1], [w, 0.86, t1], [w, 0.86, t0]);
  quad([-w, 0.3, b1], [-w, 0.44, b0], [-w, 0.86, t0], [-w, 0.86, t1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** telescopic-stand seat with the pan folded up against the back (hackathon config), ~12 tris */
function foldedSeatGeometry(): THREE.BufferGeometry {
  const w = 0.22;
  const pos: number[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  // folded pan: rounded-ish slab standing in front of the back
  quad([-w, 0.34, 0.06], [w, 0.34, 0.06], [w, 0.76, 0.1], [-w, 0.76, 0.1]);
  quad([-w, 0.76, 0.1], [w, 0.76, 0.1], [w, 0.78, 0.17], [-w, 0.78, 0.17]);
  quad([w, 0.34, 0.06], [w, 0.3, 0.16], [w, 0.78, 0.17], [w, 0.76, 0.1]);
  quad([-w, 0.3, 0.16], [-w, 0.34, 0.06], [-w, 0.76, 0.1], [-w, 0.78, 0.17]);
  // back
  quad([-w, 0.6, 0.18], [w, 0.6, 0.18], [w, 0.9, 0.22], [-w, 0.9, 0.22]);
  quad([-w, 0.9, 0.22], [w, 0.9, 0.22], [w, 0.9, 0.27], [-w, 0.9, 0.27]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function seatMeshes(seats: Seat[]): THREE.InstancedMesh[] {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, side: THREE.DoubleSide });
  const folded = seats.filter((s) => s.tier === 'A');
  const down = seats.filter((s) => s.tier !== 'A');
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const r = rng(42);
  const BLUE = new THREE.Color(0x2d5f8f);
  const BLUE2 = new THREE.Color(0x3a6f9e);
  const LIGHT = new THREE.Color(0x3f8ccc); // telescopic seats: brighter, newer blue
  const LIGHT2 = new THREE.Color(0x4f9ad6);
  const RED = new THREE.Color(0xc4452c);
  const RED2 = new THREE.Color(0xb3283a);
  const make = (list: Seat[], geo: THREE.BufferGeometry, name: string) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((s, i) => {
      q.setFromAxisAngle(UP, s.yaw);
      _m.compose(_v.set(s.x, s.y, s.z), q, _one);
      mesh.setMatrixAt(i, _m);
      if (s.tier === 'B') c.copy(RED);
      else if (s.tier === 'A') c.copy(r() < 0.5 ? LIGHT : LIGHT2);
      // upper ring: blue with a red band in the top rows (as in the venue)
      else if (s.row >= 11 && r() < 0.75) c.copy(r() < 0.5 ? RED2 : RED);
      else c.copy(r() < 0.5 ? BLUE : BLUE2);
      c.multiplyScalar(0.85 + r() * 0.25);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    return mesh;
  };
  return [make(folded, foldedSeatGeometry(), 'seats-folded'), make(down, seatGeometry(), 'seats')];
}

// ------------------------------------------------------------------ instanced helpers

/** merge several boxes (local coords) into one geometry with a per-box vertex colour */
function boxesGeometry(boxes: { p: Vec3; s: Vec3; c?: number; open?: boolean }[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const cc = new THREE.Color();
  for (const { p, s, c, open } of boxes) {
    const bx = new THREE.BoxGeometry(...s);
    // open: legs / posts without top + bottom caps (8 triangles)
    if (open) bx.setIndex([...Array.from(bx.index!.array).slice(0, 12), ...Array.from(bx.index!.array).slice(24, 36)]);
    const g = bx.toNonIndexed();
    bx.dispose();
    g.translate(...p);
    cc.set(c ?? 0xffffff);
    const P = g.getAttribute('position'), N = g.getAttribute('normal');
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      col.push(cc.r, cc.g, cc.b);
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

/** unit beam along z without end caps (8 triangles) */
function beamGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.setIndex(Array.from(g.index!.array).slice(0, 24)); // +x −x +y −y faces only
  return g;
}

/** segment [start, end, thickness?, height?] */
type Seg = [THREE.Vector3, THREE.Vector3, number?, number?];

/** instanced beams from segments (girders, rails, tubes, ducts) */
function beams(segs: Seg[], thick: number, mat: THREE.Material, height = thick, geo: THREE.BufferGeometry = beamGeometry()): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, segs.length);
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const d = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const sc = new THREE.Vector3();
  segs.forEach(([a, b, t, h], i) => {
    d.copy(b).sub(a);
    const len = d.length();
    q.setFromUnitVectors(zAxis, d.normalize());
    mid.copy(a).add(b).multiplyScalar(0.5);
    const tt = t ?? thick;
    _m.compose(mid, q, sc.set(tt, h ?? (t ?? height), len + Math.min(tt, 0.1)));
    mesh.setMatrixAt(i, _m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  return mesh;
}

function v3(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z);
}

/**
 * Keeps only the instances within `radius` of the camera in the instance buffer (same draw
 * call, fewer triangles): distant chairs / laptops / desk clutter cost nothing.
 */
class NearInstances {
  private full: Float32Array;
  private fullCol: Float32Array | null;
  private n: number;
  private last = new THREE.Vector3(1e9, 1e9, 1e9);

  constructor(private mesh: THREE.InstancedMesh, private radius: number) {
    this.n = mesh.count;
    this.full = (mesh.instanceMatrix.array as Float32Array).slice(0, this.n * 16);
    this.fullCol = mesh.instanceColor ? (mesh.instanceColor.array as Float32Array).slice(0, this.n * 3) : null;
    mesh.computeBoundingSphere(); // over all instances; kept for frustum culling
  }

  update(cx: number, cy: number, cz: number) {
    const l = this.last;
    if ((l.x - cx) ** 2 + (l.y - cy) ** 2 + (l.z - cz) ** 2 < 1.5 * 1.5) return;
    l.set(cx, cy, cz);
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const col = this.mesh.instanceColor?.array as Float32Array | undefined;
    const r2 = this.radius * this.radius;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 16;
      const dx = this.full[o + 12]! - cx, dy = this.full[o + 13]! - cy, dz = this.full[o + 14]! - cz;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (k !== i) {
        m.set(this.full.subarray(o, o + 16), k * 16);
        if (col && this.fullCol) col.set(this.fullCol.subarray(i * 3, i * 3 + 3), k * 3);
      }
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** desk clutter beyond this distance is not drawn */
const NEAR_R = 32;

// ------------------------------------------------------------------ decor (visual only)

/** point on the closed offset curve at angle th (ray from the arena centre) */
function rimPoint(th: number, d: number): [number, number] {
  const cx = Math.cos(th), cz = Math.sin(th);
  let lo = 0, hi = 120;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (floorEdgeOffset(mid * cx, mid * cz) < d) lo = mid;
    else hi = mid;
  }
  return [lo * cx, lo * cz];
}
const domeY = (x: number, z: number) => roofYAt(floorEdgeOffset(x, z));

function buildRoof(root: THREE.Group, mats: Mats, B: PropBuckets) {
  const segs: Seg[] = [];
  const lights: number[] = [];
  const beamsAt: THREE.Vector3[] = [];
  const NR = 48;
  const RING_R = 7.5;
  const DEPTH = 1.9;
  const radials: { top: THREE.Vector3[]; bot: THREE.Vector3[] }[] = [];
  for (let k = 0; k < NR; k++) {
    const th = (k / NR) * Math.PI * 2;
    const [ox, oz] = rimPoint(th, BACK_WALL_D1 - 0.6);
    const ix = RING_R * Math.cos(th), iz = RING_R * Math.sin(th);
    const len = Math.hypot(ox - ix, oz - iz);
    const panels = Math.max(8, Math.round(len / 2.2));
    const top: THREE.Vector3[] = [];
    const bot: THREE.Vector3[] = [];
    for (let i = 0; i <= panels; i++) {
      const f = i / panels;
      const x = ox + (ix - ox) * f, z = oz + (iz - oz) * f;
      const y = Math.min(domeY(x, z), 35.4) - 0.45;
      const depth = DEPTH * Math.min(1, 0.35 + f * 1.6);
      top.push(v3(x, y, z));
      bot.push(v3(x, y - depth, z));
    }
    for (let i = 0; i < panels; i++) {
      segs.push([top[i]!, top[i + 1]!], [bot[i]!, bot[i + 1]!], [i % 2 ? top[i]! : bot[i]!, i % 2 ? bot[i + 1]! : top[i + 1]!], [top[i]!, bot[i]!]);
    }
    segs.push([top[panels]!, bot[panels]!]);
    radials.push({ top, bot });
    for (const f of [0.18, 0.32, 0.46, 0.6, 0.74, 0.88]) {
      const i = Math.round(f * panels);
      const p = bot[i]!;
      lights.push(p.x, p.y - 0.25, p.z);
      if (k % 3 === 0 && (f === 0.32 || f === 0.6)) {
        const drop = 3.5 + ((k * 7) % 5) * 0.6;
        segs.push([p, v3(p.x, p.y - drop, p.z)]);
        lights.push(p.x, p.y - drop - 0.2, p.z);
        beamsAt.push(v3(p.x, p.y - drop - 0.2, p.z));
      } else if ((k + Math.round(f * 10)) % 13 === 0) beamsAt.push(v3(p.x, p.y - 0.25, p.z));
    }
  }
  for (let k = 0; k < NR; k++) {
    const a = radials[k]!, b = radials[(k + 1) % NR]!;
    const pa = a.top.length - 1, pb = b.top.length - 1;
    for (const f of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]) segs.push([a.top[Math.round(f * pa)]!, b.top[Math.round(f * pb)]!]);
    for (const f of [0.32, 0.6, 0.88]) segs.push([a.bot[Math.round(f * pa)]!, b.bot[Math.round(f * pb)]!]);
  }
  // central ring: drum of two rings + inner cross lattice
  const RY = 35.0;
  const N = 32;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    for (const [r, y] of [[RING_R, RY - 0.4], [RING_R, RY - 2.4], [RING_R - 1.4, RY - 0.4], [RING_R - 1.4, RY - 2.4]] as const) {
      segs.push([v3(r * Math.cos(a0), y, r * Math.sin(a0)), v3(r * Math.cos(a1), y, r * Math.sin(a1))]);
    }
    segs.push([v3(RING_R * Math.cos(a0), RY - 0.4, RING_R * Math.sin(a0)), v3(RING_R * Math.cos(a0), RY - 2.4, RING_R * Math.sin(a0))]);
    if (i % 2 === 0) lights.push(RING_R * Math.cos(a0), RY - 2.7, RING_R * Math.sin(a0));
  }
  for (let x = -5; x <= 5; x += 2.5) segs.push([v3(x, RY - 0.6, -Math.sqrt(36 - x * x)), v3(x, RY - 0.6, Math.sqrt(36 - x * x))]);
  for (let z = -5; z <= 5; z += 2.5) segs.push([v3(-Math.sqrt(36 - z * z), RY - 0.6, z), v3(Math.sqrt(36 - z * z), RY - 0.6, z)]);

  // secondary rectangular rigging grid over the closed (drape) end
  const GY = 23.5;
  const gx0 = -45, gx1 = -17, gz0 = -16, gz1 = 16;
  const boxTruss = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = b.clone().sub(a);
    const len = d.length();
    const side = v3(-d.z, 0, d.x).normalize().multiplyScalar(0.25);
    const n = Math.round(len);
    for (const s of [1, -1]) {
      const o = side.clone().multiplyScalar(s);
      segs.push([a.clone().add(o), b.clone().add(o)], [a.clone().add(o).setY(a.y - 0.5), b.clone().add(o).setY(b.y - 0.5)]);
      for (let i = 0; i < n; i++) {
        const p0 = a.clone().lerp(b, i / n).add(o), p1 = a.clone().lerp(b, (i + 1) / n).add(o);
        segs.push([i % 2 ? p0 : p0.clone().setY(p0.y - 0.5), i % 2 ? p1.clone().setY(p1.y - 0.5) : p1]);
      }
    }
  };
  for (let x = gx0; x <= gx1 + 0.01; x += 4) boxTruss(v3(x, GY, gz0), v3(x, GY, gz1));
  for (let z = gz0; z <= gz1 + 0.01; z += 4) boxTruss(v3(gx0, GY, z), v3(gx1, GY, z));
  for (let x = gx0; x <= gx1 + 0.01; x += 8) for (const z of [gz0, gz1, 0]) {
    segs.push([v3(x, GY, z), v3(x * 1.02, domeY(x, z) - 0.5, z * 1.02)]);
    lights.push(x, GY - 0.8, z);
  }
  for (let x = gx0 + 2; x <= gx1; x += 4) for (let z = gz0 + 4; z < gz1; z += 8) lights.push(x, GY - 0.8, z);

  // ---- silver spiral ductwork hanging under the truss: three loops + radial feeds, with
  // drop nozzles (round diffusers) every few metres
  const ducts: Seg[] = [];
  const loops: [number, number][] = [[-11, 0.85], [3, 0.75], [17, 0.65]];
  for (const [d, dia] of loops) {
    const M = 72;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < M; i++) {
      const [x, z] = rimPoint((i / M) * Math.PI * 2, d);
      pts.push(v3(x, Math.min(domeY(x, z), 35.4) - 3.4, z));
    }
    for (let i = 0; i < M; i++) {
      const a = pts[i]!, b = pts[(i + 1) % M]!;
      ducts.push([a, b, dia, dia]);
      if (i % 3 === 0) {
        const m = a.clone().lerp(b, 0.5);
        ducts.push([m, v3(m.x, m.y - 1.2, m.z), 0.22, 0.22], [v3(m.x, m.y - 1.2, m.z), v3(m.x, m.y - 1.32, m.z), 0.62, 0.62]);
      }
    }
  }
  for (let k = 0; k < 10; k++) {
    const th = (k / 10) * Math.PI * 2 + 0.17;
    let prev: THREE.Vector3 | null = null;
    for (const d of [-11, -4, 3, 10, 17, 24]) {
      const [x, z] = rimPoint(th, d);
      const p = v3(x, Math.min(domeY(x, z), 35.4) - 3.0, z);
      if (prev) ducts.push([prev, p, 0.55, 0.55]);
      prev = p;
    }
  }
  const ductGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, true);
  ductGeo.rotateX(Math.PI / 2);
  const ductMat = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.35, metalness: 0.75, emissive: 0x1a1c20 });
  const ductMesh = beams(ducts, 0.6, ductMat, 0.6, ductGeo);
  ductMesh.name = 'roof-ducts';
  root.add(ductMesh);

  // ---- line-array speaker clusters hanging round the centre ring (merged, black)
  for (let k = 0; k < 8; k++) {
    const th = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const R = 15.5;
    const x = R * Math.cos(th), z = R * Math.sin(th);
    const yaw = Math.atan2(x, z); // faces the centre
    const yTop = 24.5;
    let y = yTop;
    for (let i = 0; i < 9; i++) {
      const tilt = 0.04 + i * 0.045;
      B.nocast.geo(place(new THREE.BoxGeometry(1.25, 0.42, 0.75), { x: x * (1 - i * 0.004), y, z: z * (1 - i * 0.004), yaw }, tilt), COL.speaker);
      y -= 0.43;
    }
    B.nocast.geo(place(new THREE.BoxGeometry(1.5, 0.12, 0.9), { x, y: yTop + 0.3, z, yaw }), 0x2a2b2f);
    segs.push([v3(x - 0.5 * Math.cos(yaw), yTop + 0.36, z + 0.5 * Math.sin(yaw)), v3(x - 0.5 * Math.cos(yaw), domeY(x, z) - 1.5, z + 0.5 * Math.sin(yaw)), 0.03, 0.03]);
    segs.push([v3(x + 0.5 * Math.cos(yaw), yTop + 0.36, z - 0.5 * Math.sin(yaw)), v3(x + 0.5 * Math.cos(yaw), domeY(x, z) - 1.5, z - 0.5 * Math.sin(yaw)), 0.03, 0.03]);
  }

  const truss = beams(segs, 0.09, mats.truss);
  truss.name = 'roof-truss';
  root.add(truss);

  // spotlights: additive glow sprites (one draw call)
  const glow = mats.keep(glowTexture());
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(lights, 3));
  const points = new THREE.Points(
    pg,
    new THREE.PointsMaterial({ map: glow, size: 2.2, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff0d2, fog: false }),
  );
  points.name = 'roof-spots';
  root.add(points);

  // light beams through the haze: open additive cones, bright at the lamp, fading out
  const cone = new THREE.CylinderGeometry(0.1, 1.0, 1, 16, 1, true);
  cone.translate(0, -0.5, 0);
  const cpos = cone.getAttribute('position') as THREE.BufferAttribute;
  const ccol = new Float32Array(cpos.count * 3);
  for (let i = 0; i < cpos.count; i++) {
    const t = cpos.getY(i) > -0.5 ? 1 : 0;
    ccol[i * 3] = ccol[i * 3 + 1] = ccol[i * 3 + 2] = t;
  }
  cone.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffeccc, vertexColors: true, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const bm = new THREE.InstancedMesh(cone, beamMat, beamsAt.length);
  const q = new THREE.Quaternion();
  const r = rng(77);
  const down = v3(0, -1, 0);
  beamsAt.forEach((p, i) => {
    const target = v3(p.x * 0.55 + (r() - 0.5) * 14, 0, p.z * 0.55 + (r() - 0.5) * 10);
    const dir = target.sub(p);
    const len = dir.length() * 0.8;
    q.setFromUnitVectors(down, dir.normalize());
    _m.compose(p, q, v3(1 + r() * 0.6, len, 1 + r() * 0.6));
    bm.setMatrixAt(i, _m);
  });
  bm.instanceMatrix.needsUpdate = true;
  bm.computeBoundingSphere();
  bm.renderOrder = 3;
  bm.name = 'roof-beams';
  root.add(bm);
}

/** rounded-rectangle drum wall with u running round the perimeter (starting on a corner) */
function drum(w: number, d: number, rad: number, y0: number, y1: number, segs = 8): THREE.BufferGeometry {
  const hw = w / 2 - rad, hd = d / 2 - rad;
  const pts: [number, number][] = [];
  const centres: [number, number, number][] = [[hw, hd, 0], [-hw, hd, Math.PI / 2], [-hw, -hd, Math.PI], [hw, -hd, (3 * Math.PI) / 2]];
  for (const [cx, cz, a0] of centres) for (let i = 0; i <= segs; i++) {
    const a = a0 + (i / segs) * (Math.PI / 2);
    pts.push([cx + rad * Math.cos(a), cz + rad * Math.sin(a)]);
  }
  // rotate so u = 0 sits mid-corner (panels land centred on the faces)
  const rot = Math.floor(segs / 2);
  const P = [...pts.slice(rot), ...pts.slice(0, rot)];
  const lens = P.map((p, i) => Math.hypot(P[(i + 1) % P.length]![0] - p[0], P[(i + 1) % P.length]![1] - p[1]));
  const total = lens.reduce((a, b) => a + b, 0);
  const pos: number[] = [], uv: number[] = [];
  let u = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i]!, b = P[(i + 1) % P.length]!;
    const u1 = u + lens[i]! / total;
    // counter-clockwise points: outward faces wind a→b→top
    pos.push(a[0], y0, a[1], b[0], y1, b[1], b[0], y0, b[1], a[0], y0, a[1], a[0], y1, a[1], b[0], y1, b[1]);
    uv.push(1 - u, 0, 1 - u1, 1, 1 - u1, 0, 1 - u, 0, 1 - u, 1, 1 - u1, 1);
    u = u1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

function roundedCap(w: number, d: number, rad: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const hw = w / 2, hd = d / 2;
  s.moveTo(-hw + rad, -hd);
  s.lineTo(hw - rad, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + rad);
  s.lineTo(hw, hd - rad);
  s.quadraticCurveTo(hw, hd, hw - rad, hd);
  s.lineTo(-hw + rad, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - rad);
  s.lineTo(-hw, -hd + rad);
  s.quadraticCurveTo(-hw, -hd, -hw + rad, -hd);
  const g = new THREE.ShapeGeometry(s, 6);
  g.rotateX(Math.PI / 2);
  return g;
}

/** oval centre-hung screen: blue HACK YEAH screens, magenta TAURON rim, ticker underneath */
function buildScoreboard(root: THREE.Group, mats: Mats): THREE.Texture {
  const sb = new THREE.Group();
  sb.name = 'scoreboard';
  sb.position.set(0, 16.6, 0);
  const W = 10.4, D = 8.6, R = 3.2;
  const screenTex = mats.keep(screenTexture());
  const sMesh = new THREE.Mesh(drum(W, D, R, -1.8, 2.0), new THREE.MeshBasicMaterial({ map: screenTex, side: THREE.DoubleSide }));
  sb.add(sMesh);
  const topTex = mats.keep(bandTexture('top'));
  sb.add(new THREE.Mesh(drum(W + 0.3, D + 0.3, R + 0.15, 2.0, 2.95), new THREE.MeshBasicMaterial({ map: topTex, side: THREE.DoubleSide })));
  const tickTex = mats.keep(bandTexture('ticker'));
  sb.add(new THREE.Mesh(drum(W + 0.15, D + 0.15, R + 0.08, -2.4, -1.8), new THREE.MeshBasicMaterial({ map: tickTex, side: THREE.DoubleSide })));
  const cap = new THREE.Mesh(roundedCap(W + 0.3, D + 0.3, R + 0.15), new THREE.MeshBasicMaterial({ color: 0x15161a, side: THREE.DoubleSide }));
  cap.position.y = 2.96;
  sb.add(cap);
  const bot = new THREE.Mesh(roundedCap(W + 0.15, D + 0.15, R + 0.08), new THREE.MeshBasicMaterial({ color: 0x0d1024, side: THREE.DoubleSide }));
  bot.position.y = -2.4;
  sb.add(bot);
  // magenta LED ring under the drum
  const ring = new THREE.Mesh(drum(W - 0.6, D - 0.6, R - 0.3, -2.62, -2.5), new THREE.MeshBasicMaterial({ color: 0xff2ea0, side: THREE.DoubleSide }));
  sb.add(ring);
  root.add(sb);
  const cables: Seg[] = [];
  for (const [x, z] of [[-3.5, -3], [3.5, -3], [-3.5, 3], [3.5, 3]] as const) cables.push([v3(x, 19.6, z), v3(x * 1.4, 32.6, z * 1.4)]);
  root.add(beams(cables, 0.06, mats.metal));
  return tickTex;
}

/** quads along the loop at offset d facing the floor (−n); u repeats every `period` metres */
function ribbon(b: Pieces, d: number, y0: number, y1: number, period: number, rect: Rect, pred: (j: number) => boolean, color = 0xffffff, glow = 0.25) {
  const n = layout().columns.length;
  for (let j = 0; j < n; j++) {
    if (!pred(j)) continue;
    const s0 = loopLength(j, d), s1 = loopLength(j + 1, d);
    const [x0, z0] = stationPoint(j, d), [x1, z1] = stationPoint(j + 1, d);
    const cuts = [s0];
    for (let k = Math.floor(s0 / period) + 1; k * period < s1; k++) cuts.push(k * period);
    cuts.push(s1);
    const nIn = columnPoint(j, 0.5, d);
    const want: V3 = [-Math.sin(nIn.yawIn), 0, -Math.cos(nIn.yawIn)];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const sa = cuts[i]!, sb = cuts[i + 1]!;
      if (sb - sa < 1e-4) continue;
      const fa = (sa - s0) / (s1 - s0), fb = (sb - s0) / (s1 - s0);
      const k = Math.floor((sa + sb) / 2 / period);
      const ua = sa / period - k, ub = sb / period - k;
      const ax = x0 + (x1 - x0) * fa, az = z0 + (z1 - z0) * fa, bx = x0 + (x1 - x0) * fb, bz = z0 + (z1 - z0) * fb;
      b.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], want, color, glow, rect, [ua, ub]);
    }
  }
}

function buildDecor(root: THREE.Group, mats: Mats, props: Prop[], B: PropBuckets): NearInstances[] {
  const { columns } = layout();
  const n = columns.length;
  const A = mats.atlas;

  // ---- railings: tube rails + thin cables, steel stair units on the telescopic tier aisles
  const rails: Seg[] = [];
  const CABLE = 0.014;
  const ringRail = (pred: (c: (typeof columns)[number]) => boolean, d: number, y: number, cables: number, toe = false) => {
    for (const col of columns) {
      if (!pred(col)) continue;
      const a = columnPoint(col.index, 0, d), b = columnPoint(col.index, 1, d);
      rails.push([v3(a.x, y, a.z), v3(b.x, y, b.z), 0.05, 0.05]);
      for (let k = 1; k <= cables; k++) {
        const dy = (k / (cables + 1)) * 0.9;
        rails.push([v3(a.x, y - dy, a.z), v3(b.x, y - dy, b.z), CABLE, CABLE]);
      }
      if (toe) rails.push([v3(a.x, y - 0.93, a.z), v3(b.x, y - 0.93, b.z), 0.012, 0.14]);
      rails.push([v3(a.x, y - 1.0, a.z), v3(a.x, y, a.z), 0.045, 0.045]);
    }
  };
  ringRail((c) => !c.closed && c.a === 'seat', 0.14, A_WALK_Y + 1.0, 2);
  ringRail((c) => !c.closed, CROSS_END + 0.08, C_WALK_Y + 1.0, 4, true);
  ringRail((c) => c.closed, CLOSED_D + 0.2, LEVEL_B + 1.0, 4, true);
  for (const col of columns) {
    if (col.closed) continue;
    if (col.a === 'aisle') {
      // mobile steel stair unit: stringers + side railings with posts, centre handrail
      const slope = (d: number) => (d <= 0 ? Math.max(0, (d + 1.2) * (A_WALK_Y / 1.2)) : d < A_D0 ? A_WALK_Y : A_WALK_Y + ((d - A_D0) / A_ROW_D) * A_ROW_R + A_ROW_R * 0.5);
      for (const f of [0.06, 0.94]) {
        const pts = [-1.2, 0, A_D0, A_END - 0.2].map((d) => {
          const p = columnPoint(col.index, f, d);
          return v3(p.x, slope(d), p.z);
        });
        for (let i = 0; i < 3; i++) {
          rails.push([pts[i]!.clone().setY(pts[i]!.y - 0.12), pts[i + 1]!.clone().setY(pts[i + 1]!.y - 0.12), 0.05, 0.22]);
          rails.push([pts[i]!.clone().setY(pts[i]!.y + 0.95), pts[i + 1]!.clone().setY(pts[i + 1]!.y + 0.95), 0.045, 0.045]);
        }
        for (let d = -1.0; d < A_END - 0.3; d += 1.4) {
          const p = columnPoint(col.index, f, d);
          const y = slope(d);
          rails.push([v3(p.x, y, p.z), v3(p.x, y + 0.95, p.z), 0.035, 0.035]);
        }
      }
      // castor frame at the foot
      const p0 = columnPoint(col.index, 0.06, -1.15), p1 = columnPoint(col.index, 0.94, -1.15);
      rails.push([v3(p0.x, 0.1, p0.z), v3(p1.x, 0.1, p1.z), 0.08, 0.08]);
    }
    if (col.c === 'aisle') {
      const p0 = columnPoint(col.index, 0.5, C_D0 + 0.3), p1 = columnPoint(col.index, 0.5, C_END - 0.3);
      const y0 = C_WALK_Y + 0.95 + (0.3 / C_ROW_D) * C_ROW_R, y1 = C_WALK_Y + 0.95 + ((C_END - C_D0 - 0.3) / C_ROW_D) * C_ROW_R;
      rails.push([v3(p0.x, y0, p0.z), v3(p1.x, y1, p1.z), 0.05, 0.05]);
    }
  }
  // steel portal frames round the service tunnels on the closed end
  for (const col of columns) {
    if (!isRecessColumn(col) || col.a !== 'aisle') continue;
    const L = columnPoint(col.index, -0.05, CLOSED_D - 0.12), R = columnPoint(col.index + 1, 1.05, CLOSED_D - 0.12);
    const top = LEVEL_B - 1.9;
    for (const p of [L, R]) rails.push([v3(p.x, 0, p.z), v3(p.x, top, p.z), 0.2, 0.2]);
    rails.push([v3(L.x, RECESS_H + 0.1, L.z), v3(R.x, RECESS_H + 0.1, R.z), 0.22, 0.22]);
    rails.push([v3(L.x, top, L.z), v3(R.x, top, R.z), 0.18, 0.18]);
    rails.push([v3(L.x, RECESS_H + 0.1, L.z), v3((L.x + R.x) / 2, top, (L.z + R.z) / 2), 0.08, 0.08]);
    rails.push([v3(R.x, RECESS_H + 0.1, R.z), v3((L.x + R.x) / 2, top, (L.z + R.z) / 2), 0.08, 0.08]);
  }
  const railMesh = beams(rails, 0.05, mats.metal);
  railMesh.name = 'rails';
  root.add(railMesh);

  // ---- ceiling lights: concourse LED tubes, box lights, tunnel + recess fluorescents
  const tubes: Seg[] = [];
  const services: Seg[] = [];
  for (const col of columns) {
    for (const d of [22.2, 27.6]) {
      if (col.b === 'cstair' && d < 23) continue;
      const a = columnPoint(col.index, 0.1, d), b = columnPoint(col.index, 0.9, d);
      tubes.push([v3(a.x, CONC_CEIL - 0.45, a.z), v3(b.x, CONC_CEIL - 0.45, b.z)]);
    }
    const a = columnPoint(col.index, 0, 24.6), b = columnPoint(col.index, 1, 24.6);
    services.push([v3(a.x, CONC_CEIL - 0.35, a.z), v3(b.x, CONC_CEIL - 0.35, b.z)]);
    const c0 = columnPoint(col.index, 0, 28.6), c1 = columnPoint(col.index, 1, 28.6);
    services.push([v3(c0.x, CONC_CEIL - 0.25, c0.z), v3(c1.x, CONC_CEIL - 0.25, c1.z)]);
    // cable tray (wide, flat) between the two duct runs
    const t0 = columnPoint(col.index, 0, 26.4), t1 = columnPoint(col.index, 1, 26.4);
    services.push([v3(t0.x, CONC_CEIL - 0.6, t0.z), v3(t1.x, CONC_CEIL - 0.6, t1.z), 0.6, 0.08]);
    if (col.b === 'box' && !col.closed) {
      const p = columnPoint(col.index, 0.3, 17.8), q = columnPoint(col.index, 0.7, 17.8);
      tubes.push([v3(p.x, 12.16, p.z), v3(q.x, 12.16, q.z)]);
    }
    if (col.a === 'tunnel') {
      for (let d = 2; d < 12; d += 2.5) {
        const p = columnPoint(col.index, 0.9, d), q = columnPoint(col.index, 0.9, d + 1.2);
        tubes.push([v3(p.x, TUN_CEIL - 0.04, p.z), v3(q.x, TUN_CEIL - 0.04, q.z)]);
      }
    }
    if (isRecessColumn(col)) {
      for (let d = CLOSED_D + 0.8; d < RECESS_D1 - 1; d += 2.2) {
        const p = columnPoint(col.index, 0.5, d), q = columnPoint(col.index, 0.5, d + 1.3);
        tubes.push([v3(p.x, RECESS_H - 0.05, p.z), v3(q.x, RECESS_H - 0.05, q.z), 0.1, 0.05]);
      }
    }
  }
  const tubeMesh = beams(tubes, 0.07, new THREE.MeshBasicMaterial({ color: 0xf4f7ff }), 0.07);
  tubeMesh.name = 'light-tubes';
  root.add(tubeMesh);
  const serv = beams(services, 0.55, new THREE.MeshStandardMaterial({ color: 0x6a6e74, roughness: 0.6, metalness: 0.3, emissive: 0x2a2c30 }), 0.4);
  serv.name = 'ducts';
  root.add(serv);

  // ---- sector labels "A01".."A24": panel over the vomitory mouth + over the concourse doors
  for (const col of columns) {
    if (!col.sector || col.a !== 'aisle') continue;
    const nx = columns[(col.index + 1) % n]!;
    const fEnd = nx.sector === col.sector ? 1 : 0.5;
    const rect = A.get(`label${(col.sector - 1) % 24}`);
    const panel = (d: number, hw: number, y0: number, y1: number, j = col.index, f = fEnd) => {
      const p = columnPoint(j, f, d);
      const rx = -Math.cos(p.yawIn), rz = Math.sin(p.yawIn);
      const want: V3 = [-Math.sin(p.yawIn), 0, -Math.cos(p.yawIn)];
      B.decal.quad([p.x - rx * hw, y0, p.z - rz * hw], [p.x + rx * hw, y0, p.z + rz * hw], [p.x + rx * hw, y1, p.z + rz * hw], [p.x - rx * hw, y1, p.z - rz * hw], want, 0xffffff, 0, rect);
    };
    if (!col.closed) {
      const span = Math.min(2.2, columnWidth(col.index, CROSS_END) + (fEnd === 1 ? columnWidth(nx.index, CROSS_END) : 0));
      panel(CROSS_END - 0.03, span / 2, 12.26, 12.9);
    } else panel(CLOSED_D - 0.03, 0.5, LEVEL_B - 0.6, LEVEL_B - 0.1, col.index - 1, 0.5);
    panel(19.52, 0.55, LEVEL_B + 2.27, LEVEL_B + 2.7);
  }

  // ---- concourse: red lane lines on the epoxy, magenta TAURON wall band, AC cassettes
  const lineSeg = (col: (typeof columns)[number], d: number, w: number) => {
    const a0 = columnPoint(col.index, 0, d - w / 2), a1 = columnPoint(col.index, 1, d - w / 2);
    const b0 = columnPoint(col.index, 0, d + w / 2), b1 = columnPoint(col.index, 1, d + w / 2);
    const y = LEVEL_B + 0.006;
    B.nocast.quad([a0.x, y, a0.z], [a1.x, y, a1.z], [b1.x, y, b1.z], [b0.x, y, b0.z], [0, 1, 0], 0xc8323a, 0.15);
  };
  for (const col of columns) {
    // the inner line stops at C stairs and tunnel stairwells
    if (col.b !== 'cstair' && col.a !== 'tunnel' && !col.rail) lineSeg(col, 21.2, 0.12);
    lineSeg(col, 28.0, 0.12);
    if (col.index % 3 === 0 && col.b !== 'cstair') {
      const p = columnPoint(col.index, 0.5, 25.2);
      B.nocast.geo(place(new THREE.BoxGeometry(0.85, 0.22, 0.85), { x: p.x, y: CONC_CEIL - 0.11, z: p.z, yaw: p.yawIn }), 0xe8e9ea, 0.2, (i) => (faceOf(i) === 3 ? { r: A.get('cassette') } : null));
    }
  }
  ribbon(B.nocast, CONC_D1 - 0.012, LEVEL_B + 0.95, LEVEL_B + 2.25, 4.6, A.get('band'), () => true, 0xffffff, 0.3);

  // ---- fake reflections of the tube lights in the glossy concourse epoxy (additive streaks)
  {
    const [c2, g2] = canvas(64, 8);
    const grd = g2.createLinearGradient(0, 0, 64, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.5, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = grd;
    g2.fillRect(0, 0, 64, 8);
    const streak = mats.keep(tex(c2));
    const refl = tubes.filter(([a]) => a.y > LEVEL_B + 3);
    const rg = new THREE.PlaneGeometry(1, 1);
    rg.rotateX(-Math.PI / 2);
    const rm = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ map: streak, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xf2f6ff }), refl.length);
    const qq = new THREE.Quaternion();
    const zAxis = v3(0, 0, 1);
    refl.forEach(([a, b], i) => {
      const dir = b.clone().sub(a).setY(0);
      const len = dir.length();
      qq.setFromUnitVectors(zAxis, dir.normalize());
      _m.compose(v3((a.x + b.x) / 2, LEVEL_B + 0.012, (a.z + b.z) / 2), qq, v3(1.4, 1, len * 1.15));
      rm.setMatrixAt(i, _m);
    });
    rm.instanceMatrix.needsUpdate = true;
    rm.computeBoundingSphere();
    rm.name = 'floor-reflections';
    root.add(rm);
  }

  // ---- desks: folding chairs, laptops, desk clutter at every table (instanced, distance-culled)
  const tables = props.filter((p) => p.mat === 'table');
  const chairSpots: { x: number; z: number; yaw: number }[] = [];
  for (const t of tables) {
    const cos = Math.cos(t.yaw), sin = Math.sin(t.yaw);
    const count = Math.floor(t.sx / 0.85);
    for (let i = 0; i < count; i++) {
      const lx = (i + 0.5) * (t.sx / count) - t.sx / 2;
      for (const side of [1, -1]) {
        const lz = side * (TABLE_DEPTH / 2 + 0.38);
        chairSpots.push({ x: t.x + lx * cos + lz * sin, z: t.z - lx * sin + lz * cos, yaw: t.yaw + (side > 0 ? 0 : Math.PI) });
      }
    }
  }
  const CH = 0x1b1c1f, LEG = 0x2c2d31;
  const chairGeo = boxesGeometry([
    { p: [0, 0.45, 0], s: [0.42, 0.035, 0.4], c: CH },
    { p: [0, 0.76, 0.2], s: [0.42, 0.22, 0.025], c: CH },
    { p: [-0.2, 0.44, 0.2], s: [0.022, 0.88, 0.022], c: LEG, open: true },
    { p: [0.2, 0.44, 0.2], s: [0.022, 0.88, 0.022], c: LEG, open: true },
    { p: [-0.2, 0.22, -0.16], s: [0.022, 0.45, 0.022], c: LEG, open: true },
    { p: [0.2, 0.22, -0.16], s: [0.022, 0.45, 0.022], c: LEG, open: true },
  ]);
  const chairs = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ roughness: 0.6, vertexColors: true }), chairSpots.length);
  const lapGeo = boxesGeometry([
    { p: [0, 0.01, 0], s: [0.34, 0.02, 0.24], c: 0x2a2c30 },
    { p: [0, 0.13, 0.122], s: [0.34, 0.23, 0.01], c: 0x303238 },
    { p: [0, 0.135, 0.115], s: [0.31, 0.2, 0.004], c: 0xffffff },
  ]);
  const laptops = new THREE.InstancedMesh(lapGeo, new THREE.MeshBasicMaterial({ vertexColors: true }), chairSpots.length);
  // desk clutter kit: bottles, can, red power strip, cable loop, notebook
  const clutterGeo = boxesGeometry([
    { p: [0.3, 0.11, -0.05], s: [0.055, 0.22, 0.055], c: 0x6f9fd8 },
    { p: [-0.32, 0.06, 0.04], s: [0.05, 0.11, 0.05], c: 0x8fa83a },
    { p: [0.05, 0.018, -0.28], s: [0.26, 0.035, 0.05], c: 0xa82424 },
    { p: [-0.12, 0.008, 0.18], s: [0.21, 0.016, 0.28], c: 0xe8e2d6 },
  ]);
  const clutter = new THREE.InstancedMesh(clutterGeo, chairs.material as THREE.Material, chairSpots.length);
  const q = new THREE.Quaternion();
  const one = v3(1, 1, 1);
  const r = rng(11);
  const screenCols = [0xbfd3ff, 0xd8c4ff, 0xffffff, 0x9fd8ff, 0xffc2e4, 0x8fb0ff];
  const c = new THREE.Color();
  let nl = 0, nc = 0;
  chairSpots.forEach((s, i) => {
    const jitter = (r() - 0.5) * 0.5;
    q.setFromAxisAngle(UP, s.yaw + jitter);
    const back = r() * 0.25;
    _m.compose(v3(s.x + Math.sin(s.yaw) * back, 0, s.z + Math.cos(s.yaw) * back), q, one);
    chairs.setMatrixAt(i, _m);
    const inward = TABLE_DEPTH / 2 + 0.38 - 0.18;
    if (r() < 0.78) {
      q.setFromAxisAngle(UP, s.yaw + Math.PI + (r() - 0.5) * 0.3);
      _m.compose(v3(s.x - Math.sin(s.yaw) * inward, TABLE_H, s.z - Math.cos(s.yaw) * inward), q, one);
      laptops.setMatrixAt(nl, _m);
      laptops.setColorAt(nl, c.set(screenCols[Math.floor(r() * screenCols.length)]!).multiplyScalar(0.75 + r() * 0.25));
      nl++;
    }
    if (r() < 0.55) {
      q.setFromAxisAngle(UP, s.yaw + (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.6);
      _m.compose(v3(s.x - Math.sin(s.yaw) * inward, TABLE_H, s.z - Math.cos(s.yaw) * inward), q, one);
      clutter.setMatrixAt(nc++, _m);
    }
  });
  laptops.count = nl;
  clutter.count = nc;
  for (const [mesh, name] of [[chairs, 'chairs'], [laptops, 'laptops'], [clutter, 'desk-clutter']] as const) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = name;
    mesh.castShadow = false;
    root.add(mesh);
  }
  chairs.receiveShadow = true;

  // ---- stage: spot fixtures hanging under the LED frame
  const F = STAGE_FRAME;
  const fix: number[] = [];
  for (let x = -F.x + 1; x <= F.x - 1; x += 2) for (const z of [-F.z, F.z]) fix.push(x, F.y - 0.4, z);
  for (let z = -F.z + 1.6; z <= F.z - 1.6; z += 2.2) for (const x of [-F.x, F.x]) fix.push(x, F.y - 0.4, z);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fix, 3));
  const stagePts = new THREE.Points(
    fg,
    new THREE.PointsMaterial({ map: mats.keep(glowTexture()), size: 1.1, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd0f0 }),
  );
  stagePts.name = 'stage-spots';
  root.add(stagePts);

  return [new NearInstances(chairs, NEAR_R), new NearInstances(laptops, NEAR_R * 0.8), new NearInstances(clutter, NEAR_R * 0.62)];
}

// ------------------------------------------------------------------ scene look

interface SceneState {
  background: THREE.Scene['background'];
  fog: THREE.Scene['fog'];
  lights: { light: THREE.Light; intensity: number; color: THREE.Color; ground?: THREE.Color; pos?: THREE.Vector3; shadow?: { l: number; r: number; t: number; b: number; far: number; size: number } }[];
}

function applyArenaLook(scene: THREE.Scene, added: THREE.Object3D[]): SceneState {
  const state: SceneState = { background: scene.background, fog: scene.fog, lights: [] };
  scene.background = new THREE.Color(0x07080b);
  scene.fog = new THREE.Fog(0x0b0a10, 70, 260);
  scene.traverse((o) => {
    const l = o as THREE.Light;
    if (!l.isLight) return;
    const entry: SceneState['lights'][number] = { light: l, intensity: l.intensity, color: l.color.clone() };
    if ((l as THREE.HemisphereLight).isHemisphereLight) {
      const h = l as THREE.HemisphereLight;
      entry.ground = h.groundColor.clone();
      l.intensity = 0.5;
      l.color.set(0xd6d9e6);
      h.groundColor.set(0x5a3a4c);
    } else if ((l as THREE.DirectionalLight).isDirectionalLight) {
      const d = l as THREE.DirectionalLight;
      entry.pos = d.position.clone();
      const sc = d.shadow.camera;
      entry.shadow = { l: sc.left, r: sc.right, t: sc.top, b: sc.bottom, far: sc.far, size: d.shadow.mapSize.x };
      d.position.set(10, 90, 6);
      d.target.position.set(0, 0, 0);
      d.target.updateMatrixWorld();
      d.intensity = 2.0;
      d.color.set(0xfff1de);
      sc.left = -72;
      sc.right = 72;
      sc.top = 60;
      sc.bottom = -60;
      sc.far = 140;
      sc.updateProjectionMatrix();
    }
    state.lights.push(entry);
  });
  // magenta stage wash
  const stage = new THREE.PointLight(0xff3caa, 45, 22, 1.2);
  stage.position.set(0, 9, 0);
  scene.add(stage);
  added.push(stage);
  // soft fill from the long sides so the stands aren't flat
  for (const z of [-1, 1]) {
    const fill = new THREE.DirectionalLight(0xc8d2ff, 0.3);
    fill.position.set(0, 20, z * 60);
    scene.add(fill);
    added.push(fill);
  }
  return state;
}

function restoreLook(scene: THREE.Scene, st: SceneState) {
  scene.background = st.background;
  scene.fog = st.fog;
  for (const e of st.lights) {
    e.light.intensity = e.intensity;
    e.light.color.copy(e.color);
    if (e.ground) (e.light as THREE.HemisphereLight).groundColor.copy(e.ground);
    const d = e.light as THREE.DirectionalLight;
    if (e.pos) d.position.copy(e.pos);
    if (e.shadow) {
      const sc = d.shadow.camera;
      sc.left = e.shadow.l;
      sc.right = e.shadow.r;
      sc.top = e.shadow.t;
      sc.bottom = e.shadow.b;
      sc.far = e.shadow.far;
      sc.updateProjectionMatrix();
    }
  }
}

// ------------------------------------------------------------------ entry

export const TAURON_REMAKE_BOUNDS = { min: [-68.6, 0, -55.6] as Vec3, max: [68.6, BOUNDS_TOP, 55.6] as Vec3 };

export function createTauronRemake(physics: PhysicsContext, scene: THREE.Scene): GameMap {
  const t0 = performance.now();
  const { RAPIER, world } = physics;
  const geo = buildArenaGeometry();
  const mats = makeMaterials();
  const root = new THREE.Group();
  root.name = 'tauronRemake';
  const geometries: THREE.BufferGeometry[] = [];

  // ---- bowl surfaces
  for (const [mat, g] of Object.entries(geo.groups) as [SurfaceMat, MeshGroup][]) {
    if (!g.positions.length) continue;
    const bg = groupGeometry(mat, g);
    geometries.push(bg);
    const mesh = new THREE.Mesh(bg, mats.surface[mat]);
    mesh.name = `bowl-${mat}`;
    const overhead = mat === 'roof' || mat === 'mosaic';
    mesh.castShadow = !overhead && mat !== 'glass' && mat !== 'led' && mat !== 'floor' && mat !== 'shelf';
    mesh.receiveShadow = !overhead && mat !== 'led';
    if (mat === 'glass') mesh.renderOrder = 2;
    root.add(mesh);
  }

  // ---- props + decor: three merged meshes on the shared atlas
  const white = mats.atlas.get('white');
  const B: PropBuckets = { cast: new Pieces(white), nocast: new Pieces(white), decal: new Pieces(white) };
  for (const p of geo.props) addProp(B, mats.atlas, p);
  root.add(...seatMeshes(geo.seats));
  buildRoof(root, mats, B);
  const ticker = buildScoreboard(root, mats);
  const near = buildDecor(root, mats, geo.props, B);
  for (const [k, mat, cast] of [['cast', mats.prop, true], ['nocast', mats.prop, false], ['decal', mats.decal, false]] as const) {
    const pg = B[k].build();
    if (!pg) continue;
    geometries.push(pg);
    const mesh = new THREE.Mesh(pg, mat);
    mesh.name = `props-${k}`;
    mesh.castShadow = cast;
    mesh.receiveShadow = k !== 'decal';
    root.add(mesh);
  }
  const sbMesh = root.getObjectByName('scoreboard')!.children[0]!;
  sbMesh.onBeforeRender = () => {
    ticker.offset.x = (performance.now() / 1000) * 0.03;
  };
  scene.add(root);

  // distance culling of small clutter, driven by the render camera
  const prevBeforeRender = scene.onBeforeRender;
  scene.onBeforeRender = function (this: THREE.Scene, ...args: Parameters<THREE.Scene['onBeforeRender']>) {
    prevBeforeRender.apply(this, args);
    const cam = args[2] as THREE.Camera;
    const e = cam.matrixWorld.elements;
    for (const nI of near) nI.update(e[12]!, e[13]!, e[14]!);
  };

  // ---- colliders: bowl trimesh + ground slab + prop cuboids / cylinders
  const colliders: RAPIER.Collider[] = [];
  const { vertices, indices } = geo.collision;
  try {
    colliders.push(world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)));
  } catch {
    colliders.push(world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices)));
  }
  colliders.push(world.createCollider(RAPIER.ColliderDesc.cuboid(70, 0.5, 57).setTranslation(0, -0.5, 0)));
  const q = new THREE.Quaternion();
  for (const p of geo.props) {
    if (!p.collide) continue;
    q.setFromAxisAngle(UP, p.yaw);
    const desc = p.cyl ? RAPIER.ColliderDesc.cylinder(p.sy / 2, p.sx / 2) : RAPIER.ColliderDesc.cuboid(p.sx / 2, p.sy / 2, p.sz / 2);
    colliders.push(world.createCollider(desc.setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })));
  }

  const added: THREE.Object3D[] = [];
  const look = applyArenaLook(scene, added);

  console.info(
    `[map] tauron-remake: ${geo.stats.triangles} bowl tris (${geo.stats.columns}×${geo.stats.bands} cells), ` +
      `${geo.stats.collisionTriangles} collision tris, ${geo.seats.length} seats, ${geo.props.length} props, ` +
      `${colliders.length} colliders, built in ${Math.round(performance.now() - t0)} ms`,
  );

  return {
    id: 'tauron-remake',
    root,
    colliders,
    spawns: TAURON_REMAKE_SPAWNS.map((s) => [s.x, s.y, s.z] as Vec3),
    killY: -20,
    meta: { bbox: { min: TAURON_REMAKE_BOUNDS.min, max: TAURON_REMAKE_BOUNDS.max }, cWalkY: C_WALK_Y },
    dispose() {
      scene.remove(root);
      scene.onBeforeRender = prevBeforeRender;
      added.forEach((o) => scene.remove(o));
      restoreLook(scene, look);
      colliders.forEach((c) => world.removeCollider(c, false));
      geometries.forEach((g) => g.dispose());
      mats.textures.forEach((t) => t.dispose());
    },
  };
}
