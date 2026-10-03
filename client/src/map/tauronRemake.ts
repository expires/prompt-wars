import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d';
import {
  A_D0,
  A_END,
  A_ROW_D,
  A_ROW_R,
  A_WALK_Y,
  BACK_WALL_D1,
  BOUNDS_TOP,
  CLOSED_D,
  CONC_CEIL,
  CROSS_END,
  C_D0,
  C_END,
  C_ROW_D,
  C_ROW_R,
  C_WALK_Y,
  LEVEL_B,
  STAGE_FRAME,
  TABLE_DEPTH,
  TABLE_H,
  TAURON_REMAKE_SPAWNS,
  TUN_CEIL,
  buildArenaGeometry,
  columnPoint,
  columnWidth,
  floorEdgeOffset,
  layout,
  roofYAt,
  type MeshGroup,
  type Prop,
  type PropMat,
  type Seat,
  type SurfaceMat,
} from '@ai-gaem/shared/tauron-remake';
import type { PhysicsContext } from '../engine/physics';
import type { GameMap, Vec3 } from './types';

/**
 * `tauron-remake`: procedural TAURON Arena Kraków in its HackYeah 2026 hackathon configuration
 * (see shared/src/tauronRemake/layout.ts for the bowl design). The look follows reference photos
 * taken at the venue (colours / materials / layout only — no photo pixels are used): radial roof
 * truss with rings of spotlights, cracked-mosaic upper bowl wall, magenta TAURON fascia, blue
 * seats with red aisles, drapes + folded stands closing the west end, desk rows and a central
 * stage with a magenta LED truss under the octagonal centre-hung screen, green-epoxy concourse.
 * All textures are drawn on canvases at load time.
 *
 * Draw-call budget (~100 incl. the shadow pass): one merged mesh per surface material, one per
 * prop material, InstancedMeshes for seats / chairs / laptops / truss / rails / beams, Points for
 * the spotlights, a few meshes for the scoreboard.
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

// ------------------------------------------------------------------ textures

/** world-space floor rectangle covered by the floor texture */
const FLOOR_UV = { x0: -48.5, x1: 38.5, z0: -35.5, z1: 35.5 };

/** light grey sealed concrete, magenta wash around the stage, tape lanes between the desk rows */
function floorTexture() {
  const W = 2048;
  const H = Math.round((W * (FLOOR_UV.z1 - FLOOR_UV.z0)) / (FLOOR_UV.x1 - FLOOR_UV.x0));
  const [c, g] = canvas(W, H);
  const sx = W / (FLOOR_UV.x1 - FLOOR_UV.x0);
  const X = (x: number) => (x - FLOOR_UV.x0) * sx;
  const Z = (z: number) => (z - FLOOR_UV.z0) * sx;
  g.fillStyle = '#b6b1b3';
  g.fillRect(0, 0, W, H);
  const r = rng(7);
  // big soft blotches (trowel marks / wear) + fine speckle
  for (let i = 0; i < 260; i++) {
    const x = r() * W, y = r() * H, rad = 20 + r() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.5;
    gr.addColorStop(0, dark ? 'rgba(120,108,112,0.22)' : 'rgba(230,222,226,0.22)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 26000; i++) {
    g.fillStyle = r() < 0.5 ? '#9f9498' : '#d3cacd';
    g.globalAlpha = 0.3;
    g.fillRect(r() * W, r() * H, 2, 2);
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
  // upper: magenta band (rows 0..127)
  g.fillStyle = MAGENTA;
  g.fillRect(0, 0, W, 128);
  g.fillStyle = 'rgba(255,255,255,0.10)';
  g.fillRect(0, 0, W, 10);
  let x = 30;
  while (x < W - 600) x += drawTauron(g, x, 66, 58) + 260;
  // lower: charcoal boards with a magenta pin line and small white wordmarks
  g.fillStyle = '#26272b';
  g.fillRect(0, 128, W, 128);
  g.fillStyle = MAGENTA;
  g.fillRect(0, 128, W, 10);
  for (let x2 = 80; x2 < W - 500; x2 += 1360) drawTauron(g, x2, 196, 40, '#d9dbe0');
  return tex(c, [1 / 40, 1]);
}

function tierTexture() {
  // light concrete treads, worn darker toward the front edge
  const [c, g] = canvas(256, 256);
  g.drawImage(speckle('#8f8e8b', ['#7f7e7b', '#a2a19d', '#6f6e6b'], 2600, 256, 5), 0, 0);
  return tex(c, [1 / 3, 1 / 3]);
}

function aisleTexture() {
  // red-painted aisle steps with a pale nosing stripe
  const [c, g] = canvas(256, 256);
  g.drawImage(speckle('#a3262e', ['#8f1f27', '#b8343c', '#7d1b22'], 2400, 256, 9), 0, 0);
  return tex(c, [1 / 3, 1 / 3]);
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

function wallTexture() {
  // white/light-grey painted block walls (vomitories, partitions, concourse)
  const [c, g] = canvas(256, 256);
  g.drawImage(speckle('#d6d6d2', ['#c9c9c5', '#e2e2de'], 1400, 256, 3), 0, 0);
  g.fillStyle = 'rgba(80,84,90,0.25)';
  g.fillRect(0, 0, 2, 256);
  g.fillStyle = 'rgba(70,72,76,0.5)';
  g.fillRect(0, 248, 256, 8); // skirting
  return tex(c, [1 / 2.4, 1 / 3]);
}

/** cracked mosaic: charcoal plates with light grey joints (tileable voronoi) */
function mosaicTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(99);
  const pts: [number, number][] = [];
  for (let i = 0; i < 34; i++) pts.push([r() * S, r() * S]);
  const img = g.createImageData(S, S);
  const shade = pts.map(() => 30 + r() * 14);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, k1 = 0;
      for (let i = 0; i < pts.length; i++) {
        let dx = Math.abs(x - pts[i]![0]), dy = Math.abs(y - pts[i]![1]);
        if (dx > S / 2) dx = S - dx;
        if (dy > S / 2) dy = S - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; k1 = i; } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const o = (y * S + x) * 4;
      let v = shade[k1]!;
      if (edge < 5) v = 165 + (5 - edge) * 14;
      else if (edge < 8) v = v + (8 - edge) * 10;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v + 3;
      img.data[o + 3] = 255;
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

/** folded retractable stands, service doors, lights strip: 24 m × 9.45 m tile */
function standsTexture() {
  const W = 1024, H = 404; // 42.7 px / m
  const [c, g] = canvas(W, H);
  const m = W / 24;
  const Y = (y: number) => H - y * m; // world height → canvas row
  g.fillStyle = '#5a5d62';
  g.fillRect(0, 0, W, H);
  // upper wall: dark with a row of small warm lights and a darker band under the balcony
  g.fillStyle = '#2a2b2f';
  g.fillRect(0, Y(9.45), W, 1.2 * m);
  g.fillStyle = '#ffe9c0';
  for (let x = 0.8; x < 24; x += 3) g.fillRect(x * m, Y(7.9), 0.5 * m, 0.12 * m);
  // two service doors (light grey roller doors, ribbed) + folded stands between them
  const door = (x0: number) => {
    g.fillStyle = '#c9ccd0';
    g.fillRect(x0 * m, Y(4.6), 4.4 * m, 4.6 * m);
    g.fillStyle = 'rgba(60,64,70,0.35)';
    for (let y = 0.25; y < 4.6; y += 0.22) g.fillRect(x0 * m, Y(y), 4.4 * m, 2);
    g.fillStyle = '#6f747a';
    g.fillRect(x0 * m - 4, Y(4.75), 4.4 * m + 8, 0.16 * m);
    // exit light above
    g.fillStyle = '#d8f0ff';
    g.fillRect((x0 + 1.2) * m, Y(5.3), 2 * m, 0.12 * m);
  };
  const stands = (x0: number, w: number) => {
    g.fillStyle = '#3c3f45';
    g.fillRect(x0 * m, Y(6.4), w * m, 6.4 * m);
    g.fillStyle = '#7a7f87';
    for (let y = 0.3; y < 6.3; y += 0.42) g.fillRect(x0 * m, Y(y), w * m, 0.12 * m);
    g.fillStyle = '#1d1e22';
    for (let x = x0; x <= x0 + w + 0.01; x += w / 4) g.fillRect(x * m - 2, Y(6.4), 4, 6.4 * m);
  };
  stands(0.4, 6.2);
  door(7.4);
  stands(12.6, 5.6);
  door(18.8);
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

/** scoreboard screens: HACK / YEAH block text on blue, glitch dashes */
function screenTexture(fracs: number[]) {
  const W = 2048, H = 384;
  const [c, g] = canvas(W, H);
  const r = rng(21);
  let x = 0;
  fracs.forEach((f, i) => {
    const w = f * W;
    const gr = g.createLinearGradient(x, 0, x + w, H);
    gr.addColorStop(0, '#1f4f9a');
    gr.addColorStop(0.55, '#3f7fd0');
    gr.addColorStop(1, '#2a5fb0');
    g.fillStyle = gr;
    g.fillRect(x, 0, w, H);
    // diagonal light sweep
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath(); g.moveTo(x + w * 0.2, 0); g.lineTo(x + w * 0.45, 0); g.lineTo(x + w * 0.25, H); g.lineTo(x, H); g.closePath(); g.fill();
    if (i % 2 === 0) {
      const cx = x + w / 2, s = Math.min(w / 4.2, H / 3.6);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `900 ${Math.round(s * 1.15)}px ${FONT}`;
      g.fillStyle = '#ffffff';
      g.fillText('HACK', cx, H * 0.36);
      const tw = g.measureText('YEAH').width;
      g.fillRect(cx - tw / 2 - s * 0.15, H * 0.52, tw + s * 0.3, s * 1.2);
      g.fillStyle = '#1d3f7a';
      g.fillText('YEAH', cx, H * 0.52 + s * 0.62);
      dashes(g, x + w * 0.05, H * 0.1, w * 0.9, H * 0.8, r, 9);
      g.font = `700 ${Math.round(s * 0.28)}px Arial, sans-serif`;
      g.fillStyle = '#ffffff';
      g.fillText('1–4 OCTOBER 2026', cx, H * 0.9);
    } else {
      dashes(g, x, H * 0.2, w, H * 0.6, r, 3);
    }
    x += w;
  });
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

/** hanging red sector signs: 2 variants stacked (v 0..0.5, 0.5..1) */
function signTexture() {
  const W = 512, H = 256;
  const [c, g] = canvas(W, H);
  const one = (y0: number, range: string, arrowLeft: boolean) => {
    g.fillStyle = '#d42a35';
    g.fillRect(0, y0, W, 128);
    g.fillStyle = '#ffffff';
    g.fillRect(0, y0 + 76, W, 52);
    drawTauron(g, 16, y0 + 24, 26);
    g.font = `900 46px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.fillText(range, 380, y0 + 40);
    // arrow + pictograms on the white strip
    g.fillStyle = '#d42a35';
    const ax = arrowLeft ? 40 : 470, dir = arrowLeft ? 1 : -1;
    g.beginPath(); g.moveTo(ax, y0 + 102); g.lineTo(ax + dir * 26, y0 + 86); g.lineTo(ax + dir * 26, y0 + 118); g.closePath(); g.fill();
    g.fillRect(ax + dir * 22 - (dir < 0 ? 30 : 0), y0 + 97, 30, 10);
    for (let i = 0; i < 4; i++) {
      const px = 130 + i * 70;
      g.beginPath(); g.arc(px, y0 + 90, 7, 0, Math.PI * 2); g.fill();
      g.fillRect(px - 8, y0 + 99, 16, 22);
    }
  };
  one(0, '20–11', true);
  one(128, '01–10', false);
  return tex(c);
}

function letterTexture() {
  const [c, g] = canvas(128 * 9, 128);
  const L = 'YEAHHACK ';
  for (let i = 0; i < 9; i++) {
    g.fillStyle = '#ff1f93';
    g.fillRect(i * 128, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(i * 128 + 4, 4, 120, 120);
    g.fillStyle = '#ff1f93';
    g.fillRect(i * 128 + 10, 10, 108, 108);
    g.fillStyle = '#ffffff';
    g.font = `900 92px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(L[i]!, i * 128 + 64, 70);
  }
  return tex(c);
}

function wrapTexture() {
  // v 0..0.5: red/white wrap; v 0.5..1: magenta wrap (two TAURON wordmarks round the pillar)
  const [c, g] = canvas(1024, 256);
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 128, 1024, 128);
  g.fillStyle = '#d42a35';
  g.fillRect(0, 128, 1024, 30);
  g.fillRect(0, 226, 1024, 30);
  g.fillStyle = MAGENTA;
  g.fillRect(0, 0, 1024, 128);
  for (const x of [40, 552]) {
    g.font = `900 46px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillStyle = '#d42a35';
    g.fillText('TAURON', x + 60, 192);
    g.fillStyle = '#ffffff';
    g.fillText('TAURON', x + 60, 64);
  }
  return tex(c);
}

function accentTexture() {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = MAGENTA;
  g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#ffffff';
  g.font = `900 120px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TAURON', 512, 120);
  return tex(c);
}

function exitTexture() {
  const [c, g] = canvas(256, 96);
  g.fillStyle = '#11a05a';
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = '#ffffff';
  g.font = `bold 26px Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('WYJŚCIE', 150, 32);
  g.font = `bold 18px Arial, sans-serif`;
  g.fillText('EWAKUACYJNE', 150, 64);
  // running figure (simple)
  g.fillRect(28, 20, 40, 56);
  g.fillStyle = '#11a05a';
  g.beginPath(); g.arc(52, 30, 6, 0, Math.PI * 2); g.fill();
  g.fillRect(40, 40, 10, 24);
  return tex(c);
}

function vendingTexture() {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#1b1c20';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#e8eef6';
  g.fillRect(10, 20, 74, 170);
  const r = rng(5);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = ['#d42a35', '#2f6fb3', '#f0b400', '#3cb371'][Math.floor(r() * 4)]!;
    g.fillRect(14 + x * 18, 26 + y * 27, 12, 18);
  }
  g.fillStyle = MAGENTA;
  g.fillRect(92, 20, 26, 60);
  return tex(c);
}

function glassDoorTexture() {
  const [c, g] = canvas(512, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#5c6a78');
  gr.addColorStop(1, '#a8b4bf');
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#2a2d31';
  for (let x = 0; x <= 512; x += 128) g.fillRect(x - 5, 0, 10, 256);
  g.fillRect(0, 0, 512, 14);
  g.fillRect(0, 60, 512, 6);
  return tex(c);
}

function drapeTexture() {
  const [c, g] = canvas(64, 4);
  const gr = g.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, '#0c0c0f');
  gr.addColorStop(0.5, '#34343c');
  gr.addColorStop(1, '#0c0c0f');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 4);
  return tex(c, [1 / 0.7, 1]);
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

/** sector labels A1..A24: white panel, blue letters; 8 × 3 atlas */
function labelTexture() {
  const [c, g] = canvas(2048, 384);
  for (let i = 0; i < 24; i++) {
    const x = (i % 8) * 256, y = Math.floor(i / 8) * 128;
    g.fillStyle = '#ececea';
    g.fillRect(x, y, 256, 128);
    g.fillStyle = '#2b6cb3';
    g.font = `900 84px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`A${i + 1}`, x + 128, y + 66);
  }
  return tex(c);
}

// ------------------------------------------------------------------ materials

interface Mats {
  surface: Record<SurfaceMat, THREE.Material>;
  props: Record<PropMat, THREE.Material>;
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
  const fascia = keep(fasciaTexture());
  const wall = keep(wallTexture());
  const roof = keep(roofTexture());
  const mosaic = keep(mosaicTexture());
  const stands = keep(standsTexture());
  const epoxy = keep(epoxyTexture());

  const surface: Record<SurfaceMat, THREE.Material> = {
    floor: std({ map: floor, roughness: 0.6, vertexColors: true, emissive: 0xffffff, emissiveMap: floor, emissiveIntensity: 0.32 }),
    tier: std({ map: tier, vertexColors: true }),
    aisle: std({ map: aisle, vertexColors: true }),
    riser: std({ map: riser, vertexColors: true }),
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
    ceiling: std({ color: 0x45474c, vertexColors: true, map: concrete }),
    stands: std({ map: stands, vertexColors: true }),
    mosaic: std({ map: mosaic, side: THREE.DoubleSide, roughness: 0.95, vertexColors: true, emissive: 0xffffff, emissiveMap: mosaic, emissiveIntensity: 0.28 }),
    roof: std({ map: roof, side: THREE.DoubleSide, roughness: 0.95 }),
  };
  // "baked" interior light: faces the mesher marked as covered (vertex shade < 1) glow a little,
  // standing in for the concourse / tunnel / box fluorescent lighting without real lights
  for (const k of ['tier', 'aisle', 'riser', 'walk', 'concrete', 'wall', 'carpet', 'ceiling'] as const) interiorGlow(surface[k] as THREE.MeshStandardMaterial);
  interiorGlow(surface.carpet as THREE.MeshStandardMaterial, 2.2);

  const props: Record<PropMat, THREE.Material> = {
    stage: std({ color: 0x141416, roughness: 0.7 }),
    table: std({ color: 0x111114, roughness: 0.75 }),
    truss: std({ color: 0xb4b8be, roughness: 0.35, metalness: 0.7 }),
    speaker: std({ color: 0x111215, roughness: 0.8 }),
    led: new THREE.MeshBasicMaterial({ color: 0xff2ea0 }),
    letters: new THREE.MeshBasicMaterial({ map: keep(letterTexture()) }),
    pillar: std({ color: 0x55585e, roughness: 0.7 }),
    wrap: std({ map: keep(wrapTexture()), roughness: 0.5, emissive: 0xffffff, emissiveMap: textures[textures.length - 1], emissiveIntensity: 0.25 }),
    counter: std({ color: 0xc9cbcf, roughness: 0.6 }),
    accent: std({ map: keep(accentTexture()), emissive: 0xffffff, emissiveMap: textures[textures.length - 1], emissiveIntensity: 0.3 }),
    sign: new THREE.MeshBasicMaterial({ map: keep(signTexture()) }),
    exit: new THREE.MeshBasicMaterial({ map: keep(exitTexture()) }),
    door: std({ color: 0xd0202a, roughness: 0.35, emissive: 0x7a0a10, emissiveIntensity: 0.6 }),
    bin: std({ color: 0xc8262e, roughness: 0.5 }),
    vending: std({ map: keep(vendingTexture()), emissive: 0xffffff, emissiveMap: textures[textures.length - 1], emissiveIntensity: 0.45 }),
    glassdoor: new THREE.MeshBasicMaterial({ map: keep(glassDoorTexture()) }),
    drape: std({ map: keep(drapeTexture()), roughness: 0.9, emissive: 0xffffff, emissiveMap: textures[textures.length - 1], emissiveIntensity: 0.35 }),
    metal: std({ color: 0x8a9098, roughness: 0.4, metalness: 0.6 }),
  };
  return { surface, props, textures, keep };
}

function interiorGlow(m: THREE.MeshStandardMaterial, k = 1.5) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * (1.0 - vColor.r) * ${k.toFixed(2)};`,
    );
  };
  m.customProgramCacheKey = () => `interiorGlow${k}`;
}

// ------------------------------------------------------------------ meshes

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
  const col = new Float32Array(g.shade.length * 3);
  for (let i = 0; i < g.shade.length; i++) col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = g.shade[i]!;
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** prop materials whose textures map 0..1 per face (no world-space UVs) */
const FACE_UV = new Set<PropMat>(['letters', 'sign', 'exit', 'vending', 'glassdoor', 'accent', 'wrap']);

function propGeometry(props: Prop[]): THREE.BufferGeometry | null {
  if (!props.length) return null;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const parts = props.map((p) => {
    let g: THREE.BufferGeometry = p.cyl ? new THREE.CylinderGeometry(p.sx / 2, p.sx / 2, p.sy, 18) : new THREE.BoxGeometry(p.sx, p.sy, p.sz);
    if (p.cyl) g = g.toNonIndexed();
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    if (p.mat === 'letters') {
      // letter on the ±z faces (front / back), blank magenta elsewhere
      for (let i = 0; i < uv.count; i++) {
        const cell = Math.abs(n.getZ(i)) > 0.5 ? p.tag ?? 8 : 8;
        uv.setX(i, (cell + uv.getX(i)) / 9);
      }
    } else if (p.mat === 'sign' || p.mat === 'wrap') {
      const half = (p.tag ?? 0) % 2;
      for (let i = 0; i < uv.count; i++) uv.setY(i, (uv.getY(i) + (p.mat === 'sign' ? 1 - half : half)) / 2);
    } else if (!FACE_UV.has(p.mat) && !p.cyl) {
      // world-ish UVs so textures don't stretch across big boxes
      for (let i = 0; i < uv.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
        const u = ax > 0.5 ? pos.getZ(i) : pos.getX(i);
        const v = ay > 0.5 ? pos.getZ(i) : pos.getY(i);
        uv.setXY(i, u, v);
      }
    }
    q.setFromAxisAngle(up, p.yaw);
    m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    return g.index ? g.toNonIndexed() : g;
  });
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}

/** low-poly stadium seat facing −z (pan + back), ~14 triangles */
function seatGeometry(): THREE.BufferGeometry {
  const w = 0.23; // half width
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

function seatMesh(seats: Seat[]): THREE.InstancedMesh {
  const geo = seatGeometry();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, seats.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();
  const r = rng(42);
  const BLUE = new THREE.Color(0x2d5f8f); // steel/teal blue, slightly faded
  const BLUE2 = new THREE.Color(0x3a6f9e);
  const RED = new THREE.Color(0xc4452c); // VIP boxes
  seats.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, one);
    mesh.setMatrixAt(i, m);
    if (s.tier === 'B') c.copy(RED);
    else c.copy(r() < 0.5 ? BLUE : BLUE2);
    c.multiplyScalar(0.85 + r() * 0.25);
    mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** merge several boxes (local coords) into one geometry with an optional per-box vertex colour */
function boxesGeometry(boxes: { p: Vec3; s: Vec3; c?: number }[]): THREE.BufferGeometry {
  const parts = boxes.map(({ p, s, c }) => {
    const g = new THREE.BoxGeometry(...s).toNonIndexed();
    g.translate(...p);
    const col = new THREE.Color(c ?? 0xffffff);
    const arr = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < arr.length; i += 3) col.toArray(arr, i);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  return merged;
}

/** instanced boxes from (start, end) segments (beams, girders, rails) */
function beams(segs: [THREE.Vector3, THREE.Vector3][], thick: number, mat: THREE.Material, height = thick): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, segs.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const d = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const sc = new THREE.Vector3();
  segs.forEach(([a, b], i) => {
    d.copy(b).sub(a);
    const len = d.length();
    q.setFromUnitVectors(zAxis, d.normalize());
    mid.copy(a).add(b).multiplyScalar(0.5);
    m.compose(mid, q, sc.set(thick, height, len + thick));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  return mesh;
}

function v3(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z);
}

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

function buildRoof(root: THREE.Group, mats: Mats) {
  const segs: [THREE.Vector3, THREE.Vector3][] = [];
  const lights: number[] = [];
  const beamsAt: THREE.Vector3[] = [];
  const NR = 56;
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
    // spotlights in rings along the bottom chord + drop pipes with fixtures on some radials
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
  // circumferential purlins (top) + light rings (bottom) between neighbouring radials
  for (let k = 0; k < NR; k++) {
    const a = radials[k]!, b = radials[(k + 1) % NR]!;
    const pa = a.top.length - 1, pb = b.top.length - 1;
    for (const f of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]) {
      segs.push([a.top[Math.round(f * pa)]!, b.top[Math.round(f * pb)]!]);
    }
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
  const box = (a: THREE.Vector3, b: THREE.Vector3) => {
    // 0.5 m box truss: 2 top + 2 bottom chords, zig-zag every metre
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
  for (let x = gx0; x <= gx1 + 0.01; x += 4) box(v3(x, GY, gz0), v3(x, GY, gz1));
  for (let z = gz0; z <= gz1 + 0.01; z += 4) box(v3(gx0, GY, z), v3(gx1, GY, z));
  for (let x = gx0; x <= gx1 + 0.01; x += 8) for (const z of [gz0, gz1, 0]) {
    segs.push([v3(x, GY, z), v3(x * 1.02, domeY(x, z) - 0.5, z * 1.02)]); // hoist chains
    lights.push(x, GY - 0.8, z);
  }
  for (let x = gx0 + 2; x <= gx1; x += 4) for (let z = gz0 + 4; z < gz1; z += 8) lights.push(x, GY - 0.8, z);

  const truss = beams(segs, 0.09, mats.props.truss);
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
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const r = rng(77);
  const down = v3(0, -1, 0);
  beamsAt.forEach((p, i) => {
    const target = v3(p.x * 0.55 + (r() - 0.5) * 14, 0, p.z * 0.55 + (r() - 0.5) * 10);
    const dir = target.sub(p);
    const len = dir.length() * 0.8;
    q.setFromUnitVectors(down, dir.normalize());
    m.compose(p, q, v3(1 + r() * 0.6, len, 1 + r() * 0.6));
    bm.setMatrixAt(i, m);
  });
  bm.instanceMatrix.needsUpdate = true;
  bm.computeBoundingSphere();
  bm.renderOrder = 3;
  bm.name = 'roof-beams';
  root.add(bm);
}

/** octagonal (chamfered rectangle) prism side wall with u running round the perimeter */
function prism(w: number, d: number, ch: number, y0: number, y1: number): { geo: THREE.BufferGeometry; fracs: number[] } {
  const hw = w / 2, hd = d / 2;
  // start at the middle-left of the +z face so the big faces land on whole texture panels
  const pts: [number, number][] = [
    [-hw + ch, hd], [hw - ch, hd], [hw, hd - ch], [hw, -hd + ch], [hw - ch, -hd], [-hw + ch, -hd], [-hw, -hd + ch], [-hw, hd - ch],
  ];
  const lens = pts.map((p, i) => Math.hypot(pts[(i + 1) % 8]![0] - p[0], pts[(i + 1) % 8]![1] - p[1]));
  const total = lens.reduce((a, b) => a + b, 0);
  const pos: number[] = [], uv: number[] = [];
  let u = 0;
  for (let i = 0; i < 8; i++) {
    const a = pts[i]!, b = pts[(i + 1) % 8]!;
    const u1 = u + lens[i]! / total;
    // outward-facing quad (counter-clockwise seen from outside)
    pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]);
    uv.push(u, 0, u1, 0, u1, 1, u, 0, u1, 1, u, 1);
    u = u1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return { geo, fracs: lens.map((l) => l / total) };
}

function buildScoreboard(root: THREE.Group, mats: Mats): THREE.Texture {
  const sb = new THREE.Group();
  sb.name = 'scoreboard';
  sb.position.set(0, 16.6, 0);
  const W = 9.6, D = 8.2, CH = 1.3;
  const screens = prism(W, D, CH, -1.8, 2.0);
  // the big faces alternate with the chamfers: fracs order = face, chamfer, face, chamfer, ...
  const screenTex = mats.keep(screenTexture(screens.fracs));
  const sMesh = new THREE.Mesh(screens.geo, new THREE.MeshBasicMaterial({ map: screenTex, side: THREE.DoubleSide }));
  sb.add(sMesh);
  const top = prism(W + 0.25, D + 0.25, CH, 2.0, 2.95);
  const topTex = mats.keep(bandTexture('top'));
  sb.add(new THREE.Mesh(top.geo, new THREE.MeshBasicMaterial({ map: topTex, side: THREE.DoubleSide })));
  const tick = prism(W + 0.15, D + 0.15, CH, -2.4, -1.8);
  const tickTex = mats.keep(bandTexture('ticker'));
  sb.add(new THREE.Mesh(tick.geo, new THREE.MeshBasicMaterial({ map: tickTex, side: THREE.DoubleSide })));
  // caps (dark) + a magenta glow ring under the bottom
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 0.3, 8), mats.props.speaker);
  cap.rotation.y = Math.PI / 8;
  cap.scale.set(W / 7.2, 1, D / 7.2);
  cap.position.y = 3.1;
  sb.add(cap);
  const bot = cap.clone();
  bot.material = new THREE.MeshBasicMaterial({ color: 0x0d1024 });
  bot.position.y = -2.55;
  bot.scale.multiplyScalar(0.97);
  sb.add(bot);
  root.add(sb);
  // hanging cables + rigging frame to the central ring
  const cables: [THREE.Vector3, THREE.Vector3][] = [];
  for (const [x, z] of [[-3.5, -3], [3.5, -3], [-3.5, 3], [3.5, 3]] as const) cables.push([v3(x, 19.8, z), v3(x * 1.4, 32.6, z * 1.4)]);
  root.add(beams(cables, 0.06, mats.props.metal));
  return tickTex;
}

function buildDecor(root: THREE.Group, mats: Mats, props: Prop[]) {
  const { columns } = layout();
  const n = columns.length;

  // ---- railings: gray tube rails on tier fronts, balcony, aisle handrails (one instanced mesh)
  const rails: [THREE.Vector3, THREE.Vector3][] = [];
  const ringRail = (pred: (c: (typeof columns)[number]) => boolean, d: number, y: number, bars: number[]) => {
    for (const col of columns) {
      if (!pred(col)) continue;
      const a = columnPoint(col.index, 0, d), b = columnPoint(col.index, 1, d);
      for (const dy of [0, ...bars]) rails.push([v3(a.x, y - dy, a.z), v3(b.x, y - dy, b.z)]);
      rails.push([v3(a.x, y - 1.0, a.z), v3(a.x, y, a.z)]);
    }
  };
  ringRail((c) => !c.closed && c.a === 'seat', 0.14, A_WALK_Y + 1.0, [0.33, 0.66]);
  ringRail((c) => !c.closed, CROSS_END + 0.08, C_WALK_Y + 1.0, [0.33, 0.66]);
  ringRail((c) => c.closed, CLOSED_D + 0.2, LEVEL_B + 1.0, [0.25, 0.5, 0.75]);
  // aisle handrails down the middle of every A / C aisle
  for (const col of columns) {
    if (col.closed) continue;
    if (col.a === 'aisle') {
      const p0 = columnPoint(col.index, 0.5, A_D0 + 0.3), p1 = columnPoint(col.index, 0.5, A_END - 0.3);
      const y0 = A_WALK_Y + 0.95 + (0.3 / A_ROW_D) * A_ROW_R, y1 = A_WALK_Y + 0.95 + ((A_END - A_D0 - 0.3) / A_ROW_D) * A_ROW_R;
      rails.push([v3(p0.x, y0, p0.z), v3(p1.x, y1, p1.z)]);
      for (let i = 0; i <= 3; i++) {
        const f = i / 3;
        rails.push([v3(p0.x + (p1.x - p0.x) * f, y0 + (y1 - y0) * f - 0.95, p0.z + (p1.z - p0.z) * f), v3(p0.x + (p1.x - p0.x) * f, y0 + (y1 - y0) * f, p0.z + (p1.z - p0.z) * f)]);
      }
    }
    if (col.c === 'aisle') {
      const p0 = columnPoint(col.index, 0.5, C_D0 + 0.3), p1 = columnPoint(col.index, 0.5, C_END - 0.3);
      const y0 = C_WALK_Y + 0.95 + (0.3 / C_ROW_D) * C_ROW_R, y1 = C_WALK_Y + 0.95 + ((C_END - C_D0 - 0.3) / C_ROW_D) * C_ROW_R;
      rails.push([v3(p0.x, y0, p0.z), v3(p1.x, y1, p1.z)]);
    }
  }
  const railMesh = beams(rails, 0.05, mats.props.metal);
  railMesh.name = 'rails';
  root.add(railMesh);

  // ---- concourse ceiling: long LED tubes, ducts + cable trays; tunnel + box lights
  const tubes: [THREE.Vector3, THREE.Vector3][] = [];
  const services: [THREE.Vector3, THREE.Vector3][] = [];
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
  }
  const tubeMesh = beams(tubes, 0.07, new THREE.MeshBasicMaterial({ color: 0xf4f7ff }), 0.07);
  tubeMesh.name = 'light-tubes';
  root.add(tubeMesh);
  const serv = beams(services, 0.55, new THREE.MeshStandardMaterial({ color: 0x6a6e74, roughness: 0.6, metalness: 0.3, emissive: 0x2a2c30 }), 0.4);
  serv.name = 'ducts';
  root.add(serv);

  // ---- sector labels "A1".."A24" on the panel above each vomitory (atlas, one mesh)
  const labelTex = mats.keep(labelTexture());
  const lpos: number[] = [], luv: number[] = [];
  for (const col of columns) {
    if (!col.sector || col.a !== 'aisle') continue;
    const nx = columns[(col.index + 1) % n]!;
    const fEnd = nx.sector === col.sector ? 1 : 0.5;
    const span = Math.min(2.6, columnWidth(col.index, CROSS_END) + (fEnd === 1 ? columnWidth(nx.index, CROSS_END) : 0));
    const p = columnPoint(col.index, fEnd, CROSS_END - 0.03);
    // viewer faces +n (looking outward); their right = (−cos yaw, +sin yaw)
    const rx = -Math.cos(p.yawIn), rz = Math.sin(p.yawIn);
    const hw = span / 2, y0 = 12.24, y1 = 12.92;
    const L = [p.x - rx * hw, p.z - rz * hw], R = [p.x + rx * hw, p.z + rz * hw];
    lpos.push(L[0]!, y0, L[1]!, R[0]!, y0, R[1]!, R[0]!, y1, R[1]!, L[0]!, y0, L[1]!, R[0]!, y1, R[1]!, L[0]!, y1, L[1]!);
    const i = (col.sector - 1) % 24;
    const u0 = (i % 8) / 8, u1 = u0 + 1 / 8, v1 = 1 - Math.floor(i / 8) / 3, v0 = v1 - 1 / 3;
    luv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
  const labels = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ map: labelTex, side: THREE.DoubleSide }));
  labels.name = 'sector-labels';
  root.add(labels);

  // second label set: above the red doors at the concourse end of every vomitory
  {
    const lpos2: number[] = [], luv2: number[] = [];
    for (const col of columns) {
      if (!col.sector || col.a !== 'aisle') continue;
      const nx = columns[(col.index + 1) % n]!;
      const fEnd = nx.sector === col.sector ? 1 : 0.5;
      const p = columnPoint(col.index, fEnd, 19.52);
      const rx = -Math.cos(p.yawIn), rz = Math.sin(p.yawIn);
      const hw = 0.55, y0 = LEVEL_B + 2.27, y1 = LEVEL_B + 2.7;
      lpos2.push(p.x - rx * hw, y0, p.z - rz * hw, p.x + rx * hw, y0, p.z + rz * hw, p.x + rx * hw, y1, p.z + rz * hw, p.x - rx * hw, y0, p.z - rz * hw, p.x + rx * hw, y1, p.z + rz * hw, p.x - rx * hw, y1, p.z - rz * hw);
      const i = (col.sector - 1) % 24;
      const u0 = (i % 8) / 8, u1 = u0 + 1 / 8, v1 = 1 - Math.floor(i / 8) / 3, v0 = v1 - 1 / 3;
      luv2.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    }
    lpos.push(...lpos2);
    luv.push(...luv2);
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lpos, 3));
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
  }

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
    const mm = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    const zAxis = v3(0, 0, 1);
    refl.forEach(([a, b], i) => {
      const dir = b.clone().sub(a).setY(0);
      const len = dir.length();
      qq.setFromUnitVectors(zAxis, dir.normalize());
      mm.compose(v3((a.x + b.x) / 2, LEVEL_B + 0.012, (a.z + b.z) / 2), qq, v3(1.4, 1, len * 1.15));
      rm.setMatrixAt(i, mm);
    });
    rm.instanceMatrix.needsUpdate = true;
    rm.computeBoundingSphere();
    rm.name = 'floor-reflections';
    root.add(rm);
  }

  // ---- desks: folding chairs + laptops at every table (instanced)
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
  const chairGeo = boxesGeometry([
    { p: [0, 0.45, 0], s: [0.42, 0.04, 0.4] },
    { p: [0, 0.68, 0.19], s: [0.42, 0.42, 0.03] },
    { p: [-0.19, 0.22, 0.05], s: [0.03, 0.45, 0.4] },
    { p: [0.19, 0.22, 0.05], s: [0.03, 0.45, 0.4] },
  ]);
  const chairs = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6, vertexColors: true }), chairSpots.length);
  const lapGeo = boxesGeometry([
    { p: [0, 0.01, 0], s: [0.34, 0.02, 0.24], c: 0x3a3c42 },
    { p: [0, 0.13, 0.12], s: [0.34, 0.23, 0.012], c: 0xffffff },
  ]);
  const lapMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const laptops = new THREE.InstancedMesh(lapGeo, lapMat, chairSpots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = v3(0, 1, 0);
  const one = v3(1, 1, 1);
  const r = rng(11);
  const screenCols = [0xbfd3ff, 0xd8c4ff, 0xffffff, 0x9fd8ff, 0xffc2e4, 0x8fb0ff];
  const c = new THREE.Color();
  let nl = 0;
  chairSpots.forEach((s, i) => {
    const jitter = (r() - 0.5) * 0.5;
    q.setFromAxisAngle(up, s.yaw + jitter);
    // chairs pushed back a little at random
    const back = r() * 0.25;
    m.compose(v3(s.x + Math.sin(s.yaw) * back, 0, s.z + Math.cos(s.yaw) * back), q, one);
    chairs.setMatrixAt(i, m);
    if (r() < 0.78) {
      // laptop on the table in front of the chair, screen facing the chair (lid on the far side)
      const inward = TABLE_DEPTH / 2 + 0.38 - 0.18;
      q.setFromAxisAngle(up, s.yaw + Math.PI + (r() - 0.5) * 0.3);
      m.compose(v3(s.x - Math.sin(s.yaw) * inward, TABLE_H, s.z - Math.cos(s.yaw) * inward), q, one);
      laptops.setMatrixAt(nl, m);
      laptops.setColorAt(nl, c.set(screenCols[Math.floor(r() * screenCols.length)]!).multiplyScalar(0.75 + r() * 0.25));
      nl++;
    }
  });
  laptops.count = nl;
  chairs.instanceMatrix.needsUpdate = true;
  laptops.instanceMatrix.needsUpdate = true;
  if (laptops.instanceColor) laptops.instanceColor.needsUpdate = true;
  chairs.computeBoundingSphere();
  laptops.computeBoundingSphere();
  chairs.name = 'chairs';
  laptops.name = 'laptops';
  chairs.receiveShadow = true;
  root.add(chairs, laptops);

  // ---- stage: spot fixtures hanging under the LED frame
  const F = STAGE_FRAME;
  const fix: number[] = [];
  for (let x = -F.x + 1; x <= F.x - 1; x += 2) for (const z of [-F.z, F.z]) fix.push(x, F.y - 0.4, z);
  for (let z = -F.z + 1.6; z <= F.z - 1.6; z += 2.2) for (const x of [-F.x, F.x]) fix.push(x, F.y - 0.4, z);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fix, 3));
  const stagePts = new THREE.Points(
    fg,
    new THREE.PointsMaterial({ map: mats.keep(glowTexture()), size: 1.1, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }),
  );
  stagePts.name = 'stage-spots';
  root.add(stagePts);
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
      // the rig: steep warm-white key light from the roof truss; shadows cover the whole bowl
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

/** props that never cast shadows (emissive / thin / overhead) */
const NO_SHADOW = new Set<PropMat>(['led', 'sign', 'exit', 'glassdoor', 'wrap', 'drape', 'accent', 'door', 'metal', 'bin', 'truss']);

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
    mesh.castShadow = !overhead && mat !== 'glass' && mat !== 'led' && mat !== 'floor';
    mesh.receiveShadow = !overhead && mat !== 'led';
    if (mat === 'glass') mesh.renderOrder = 2;
    root.add(mesh);
  }

  // ---- props
  const byMat = new Map<PropMat, Prop[]>();
  for (const p of geo.props) {
    const list = byMat.get(p.mat) ?? [];
    list.push(p);
    byMat.set(p.mat, list);
  }
  for (const [mat, list] of byMat) {
    const pg = propGeometry(list);
    if (!pg) continue;
    geometries.push(pg);
    const mesh = new THREE.Mesh(pg, mats.props[mat]);
    mesh.name = `props-${mat}`;
    mesh.castShadow = !NO_SHADOW.has(mat);
    mesh.receiveShadow = mat !== 'led' && mat !== 'sign' && mat !== 'exit';
    root.add(mesh);
  }

  // ---- seats + decor
  root.add(seatMesh(geo.seats));
  buildRoof(root, mats);
  const ticker = buildScoreboard(root, mats);
  buildDecor(root, mats, geo.props);
  const sbMesh = root.getObjectByName('scoreboard')!.children[0]!;
  sbMesh.onBeforeRender = () => {
    ticker.offset.x = (performance.now() / 1000) * 0.03;
  };
  scene.add(root);

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
  const up = new THREE.Vector3(0, 1, 0);
  for (const p of geo.props) {
    if (!p.collide) continue;
    q.setFromAxisAngle(up, p.yaw);
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
      added.forEach((o) => scene.remove(o));
      restoreLook(scene, look);
      colliders.forEach((c) => world.removeCollider(c, false));
      geometries.forEach((g) => g.dispose());
      mats.textures.forEach((t) => t.dispose());
    },
  };
}
