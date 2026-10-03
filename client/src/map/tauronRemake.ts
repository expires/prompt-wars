import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d';
import {
  BOUNDS_TOP,
  BACK_WALL_D1,
  CONC_CEIL,
  C_WALK_Y,
  FLOOR_HALF_X,
  FLOOR_HALF_Z,
  FLOOR_STAIR_D0,
  ROOF_APEX_Y,
  ROOF_BASE_Y,
  TAURON_REMAKE_SPAWNS,
  TUN_CEIL,
  buildArenaGeometry,
  columnPoint,
  layout,
  stationPoint,
  type MeshGroup,
  type Prop,
  type PropMat,
  type Seat,
  type SurfaceMat,
} from '@ai-gaem/shared/tauron-remake';
import type { PhysicsContext } from '../engine/physics';
import type { GameMap, Vec3 } from './types';

/**
 * `tauron-remake`: an ORIGINAL procedural model of TAURON Arena Kraków (see
 * shared/src/tauronRemake/layout.ts for the design and the published facts it is based on).
 * No scan data, no photos: all textures below are drawn on canvases at load time.
 *
 * Draw-call budget: one merged mesh per surface material (~11), one per prop material (~11),
 * one InstancedMesh for ~13k seats, a handful of instanced decor meshes (truss, lights,
 * girders, catwalk) and the scoreboard. Colliders: one trimesh for the bowl + cuboids for props.
 */

// ------------------------------------------------------------------ canvas textures

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
    g.globalAlpha = 0.25 + r() * 0.5;
    const s = 1 + r() * dot;
    g.fillRect(r() * size, r() * size, s, s);
  }
  g.globalAlpha = 1;
  return c;
}

/** event floor: hardwood surround + volleyball court (the arena's signature sport) on concrete */
function courtTexture() {
  const W = 2048, H = 1332; // 74.4 × 48.4 m
  const [c, g] = canvas(W, H);
  const sx = W / 74.4, sy = H / 48.4;
  const X = (x: number) => (x + 37.2) * sx;
  const Z = (z: number) => (z + 24.2) * sy;
  // sealed concrete event floor
  g.fillStyle = '#4a4e55';
  g.fillRect(0, 0, W, H);
  const r = rng(7);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() < 0.5 ? '#40444b' : '#555a62';
    g.globalAlpha = 0.35;
    g.fillRect(r() * W, r() * H, 3, 3);
  }
  g.globalAlpha = 1;
  // expansion joints every 6 m
  g.strokeStyle = 'rgba(30,32,36,0.55)';
  g.lineWidth = 2;
  for (let x = -36; x <= 36; x += 6) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), H); g.stroke(); }
  for (let z = -24; z <= 24; z += 6) { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(W, Z(z)); g.stroke(); }
  // hardwood sport floor 40 × 24 m
  const hx0 = X(-20), hx1 = X(20), hz0 = Z(-12), hz1 = Z(12);
  for (let i = 0; hx0 + i * 18 < hx1; i++) {
    const shade = 150 + Math.floor(r() * 30);
    g.fillStyle = `rgb(${shade + 40},${shade}, ${shade - 60})`;
    g.fillRect(hx0 + i * 18, hz0, 18, hz1 - hz0);
  }
  g.strokeStyle = 'rgba(80,50,20,0.25)';
  for (let z = hz0; z < hz1; z += 70 + r() * 60) { g.beginPath(); g.moveTo(hx0, z); g.lineTo(hx1, z); g.stroke(); }
  // free zone (blue) + playing court (orange) 18 × 9 m
  g.fillStyle = '#2459b0';
  g.fillRect(X(-15.5), Z(-8.5), 31 * sx, 17 * sy);
  g.fillStyle = '#e06a26';
  g.fillRect(X(-9), Z(-4.5), 18 * sx, 9 * sy);
  g.strokeStyle = '#f4f4f4';
  g.lineWidth = 0.05 * sx * 1.2;
  g.strokeRect(X(-9), Z(-4.5), 18 * sx, 9 * sy);
  for (const x of [-3, 0, 3]) { g.beginPath(); g.moveTo(X(x), Z(-4.5)); g.lineTo(X(x), Z(4.5)); g.stroke(); }
  // centre logo ring + wordmark (generic, no venue branding)
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(255,255,255,0.8)';
  g.font = `bold ${Math.round(1.6 * sy)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText('KRAKÓW', X(-12.3), Z(0));
  g.fillText('ARENA', X(12.3), Z(0));
  // floor stencil "A1 … A12" sector hints along the edges
  g.font = `bold ${Math.round(1.1 * sy)}px sans-serif`;
  g.fillStyle = 'rgba(240,200,40,0.55)';
  for (let i = 0; i < 6; i++) {
    g.fillText(`A${i + 1}`, X(-30 + i * 12), Z(-21.5));
    g.fillText(`A${12 - i}`, X(-30 + i * 12), Z(21.5));
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** LED ribbon boards: scrolling, colourful, generic text */
function ledTexture() {
  const [c, g] = canvas(2048, 64);
  const blocks = [
    ['#0a1a4a', '#3ad1ff', 'KRAKÓW ARENA'],
    ['#ff2d55', '#ffffff', 'MAKE SOME NOISE'],
    ['#101010', '#ffd60a', 'SECTOR A · B · C'],
    ['#2b2bff', '#ffffff', 'WELCOME'],
    ['#00a86b', '#ffffff', 'GOOD GAME'],
    ['#ff7a00', '#101010', 'ROUND 1'],
  ] as const;
  const w = 2048 / blocks.length;
  blocks.forEach(([bg, fg, text], i) => {
    g.fillStyle = bg;
    g.fillRect(i * w, 0, w, 64);
    g.fillStyle = fg;
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, i * w + w / 2, 34);
  });
  // LED pixel grid
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = 0; x < 2048; x += 4) g.fillRect(x, 0, 1, 64);
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 2048, 1);
  return tex(c, [1 / 40, 1]);
}

function wallTexture() {
  const [c, g] = canvas(256, 256);
  g.drawImage(speckle('#b9bcc2', ['#a9acb2', '#c9ccd2'], 1500, 256, 3), 0, 0);
  g.fillStyle = 'rgba(60,64,72,0.55)';
  g.fillRect(0, 0, 3, 256); // panel seam
  g.fillRect(0, 0, 256, 2);
  return tex(c, [1 / 1.6, 1 / 3]);
}

function roofTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#1b1f27';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#2a303b';
  g.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  return tex(c, [1 / 12, 1 / 12]);
}

function screenTexture(kind: 'main' | 'side') {
  const [c, g] = canvas(512, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#081a3a');
  grad.addColorStop(1, '#02060f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (kind === 'main') {
    g.fillStyle = '#3ad1ff';
    g.font = 'bold 30px sans-serif';
    g.fillText('HOME', 120, 50);
    g.fillStyle = '#ff2d55';
    g.fillText('AWAY', 392, 50);
    g.fillStyle = '#ffffff';
    g.font = 'bold 110px monospace';
    g.fillText('2', 120, 150);
    g.fillText('1', 392, 150);
    g.fillStyle = '#ffd60a';
    g.font = 'bold 44px monospace';
    g.fillText('12:00', 256, 140);
    g.font = 'bold 22px sans-serif';
    g.fillStyle = '#9fb3d9';
    g.fillText('SET 3', 256, 200);
  } else {
    g.fillStyle = '#ffffff';
    g.font = 'bold 54px sans-serif';
    g.fillText('KRAKÓW', 256, 100);
    g.fillStyle = '#3ad1ff';
    g.font = 'bold 34px sans-serif';
    g.fillText('ARENA', 256, 170);
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let x = 0; x < 512; x += 3) g.fillRect(x, 0, 1, 256);
  return tex(c);
}

function signTexture() {
  const [c, g] = canvas(512, 64);
  const items = ['FOOD', 'DRINKS', 'MERCH', 'COFFEE'];
  g.fillStyle = '#121212';
  g.fillRect(0, 0, 512, 64);
  items.forEach((t, i) => {
    g.fillStyle = ['#ffb000', '#3ad1ff', '#ff2d55', '#7ed957'][i]!;
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, i * 128 + 64, 34);
  });
  return tex(c, [0.25, 1]);
}

function caseTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#1d1f22';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#9aa0a8'; // aluminium edges + corners
  g.fillRect(0, 0, 128, 8);
  g.fillRect(0, 120, 128, 8);
  g.fillRect(0, 0, 8, 128);
  g.fillRect(120, 0, 8, 128);
  g.fillStyle = '#c9ced6';
  for (const [x, y] of [[0, 0], [108, 0], [0, 108], [108, 108]]) g.fillRect(x!, y!, 20, 20);
  g.fillStyle = '#e8c547';
  g.fillRect(44, 54, 40, 20); // stencil label
  return tex(c);
}

// ------------------------------------------------------------------ materials

interface Mats {
  surface: Record<SurfaceMat, THREE.Material>;
  props: Record<PropMat, THREE.Material>;
  textures: THREE.Texture[];
}

function makeMaterials(): Mats {
  const textures: THREE.Texture[] = [];
  const keep = <T extends THREE.Texture>(t: T) => (textures.push(t), t);
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...p });

  const court = keep(courtTexture());
  const concrete = keep(tex(speckle('#8d9096', ['#7d8086', '#a0a3a9', '#6f7278'], 2600, 256, 2), [1 / 4, 1 / 4]));
  const tier = keep(tex(speckle('#4a4d55', ['#3e4148', '#565a62'], 2200, 256, 5), [1 / 3, 1 / 3]));
  const aisle = keep(tex(speckle('#8a8a84', ['#7a7a74', '#9a9a92'], 2200, 256, 9), [1 / 3, 1 / 3]));
  const terrazzo = keep(tex(speckle('#a7a9ad', ['#6f7a8a', '#c7c9cd', '#8d6f5a', '#5a6270'], 5000, 256, 11, 3), [1 / 3, 1 / 3]));
  const led = keep(ledTexture());
  const wall = keep(wallTexture());
  const roof = keep(roofTexture());
  const cases = keep(caseTexture());
  const sign = keep(signTexture());
  const screen = keep(screenTexture('side'));

  const ledMat = new THREE.MeshBasicMaterial({ map: led, vertexColors: false });
  const surface: Record<SurfaceMat, THREE.Material> = {
    floor: std({ map: court, roughness: 0.55, vertexColors: true, emissive: 0xffffff, emissiveMap: court, emissiveIntensity: 0.12 }),
    tier: std({ map: tier, vertexColors: true }),
    aisle: std({ map: aisle, vertexColors: true, color: 0xe9e3cf }),
    walk: std({ map: concrete, vertexColors: true }),
    concrete: std({ map: concrete, vertexColors: true, color: 0xb8bcc4 }),
    wall: std({ map: wall, vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x9fc6e6,
      transparent: true,
      opacity: 0.22,
      roughness: 0.05,
      metalness: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    led: ledMat,
    carpet: std({ map: terrazzo, vertexColors: true, roughness: 0.6 }),
    ceiling: std({ color: 0x5d636e, vertexColors: true, map: concrete }),
    roof: std({ map: roof, side: THREE.DoubleSide, roughness: 0.95 }),
  };
  // "baked" interior light: faces the mesher marked as covered (vertex shade < 1) glow a little,
  // standing in for the concourse / tunnel / box fluorescent lighting without real lights
  for (const k of ['tier', 'aisle', 'walk', 'concrete', 'wall', 'carpet', 'ceiling'] as const) interiorGlow(surface[k] as THREE.MeshStandardMaterial);
  const props: Record<PropMat, THREE.Material> = {
    stage: std({ color: 0x1c1d21, roughness: 0.7 }),
    case: std({ map: cases, roughness: 0.6, metalness: 0.2 }),
    barrier: std({ color: 0x9aa1aa, roughness: 0.4, metalness: 0.6 }),
    screen: new THREE.MeshBasicMaterial({ map: screen }),
    truss: std({ color: 0x8d939b, roughness: 0.35, metalness: 0.7 }),
    speaker: std({ color: 0x141518, roughness: 0.8 }),
    pillar: std({ map: concrete, color: 0xc9ccd2 }),
    kiosk: std({ color: 0xc0392b, roughness: 0.6 }),
    sign: new THREE.MeshBasicMaterial({ map: sign }),
    furniture: std({ color: 0x6b4f3a, roughness: 0.7 }),
    metal: std({ color: 0x5d636c, roughness: 0.4, metalness: 0.6 }),
  };
  return { surface, props, textures };
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
    // court texture spans the inner outline (74.4 × 48.4 m)
    const hx = FLOOR_HALF_X - FLOOR_STAIR_D0, hz = FLOOR_HALF_Z - FLOOR_STAIR_D0;
    for (let i = 0; i < pos.length / 3; i++) {
      uv[i * 2] = (pos[i * 3]! + hx) / (2 * hx);
      uv[i * 2 + 1] = 1 - (pos[i * 3 + 2]! + hz) / (2 * hz);
    }
  } else if (mat === 'led') {
    // boards: front wall 0..1.2 m, C fascia 12.2..12.95 m
    for (let i = 0; i < pos.length / 3; i++) {
      const y = pos[i * 3 + 1]!;
      uv[i * 2 + 1] = y < 6 ? THREE.MathUtils.clamp(y / 1.2, 0, 1) : THREE.MathUtils.clamp((y - 12.2) / 0.75, 0, 1);
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const col = new Float32Array(g.shade.length * 3);
  for (let i = 0; i < g.shade.length; i++) col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = g.shade[i]!;
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

function propGeometry(props: Prop[]): THREE.BufferGeometry | null {
  if (!props.length) return null;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const parts = props.map((p) => {
    const g = new THREE.BoxGeometry(p.sx, p.sy, p.sz);
    // world-ish UVs so textures don't stretch across big boxes (cases keep 0..1 per face)
    if (p.mat !== 'case' && p.mat !== 'screen' && p.mat !== 'sign') {
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const n = g.getAttribute('normal') as THREE.BufferAttribute;
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
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
    return g;
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
  // pan: top + front edge
  quad([-w, 0.44, -0.2], [w, 0.44, -0.2], [w, 0.44, 0.16], [-w, 0.44, 0.16]);
  quad([-w, 0.36, -0.2], [w, 0.36, -0.2], [w, 0.44, -0.2], [-w, 0.44, -0.2]);
  // back: front, top, rear, sides (slightly reclined)
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
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, seats.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();
  const r = rng(42);
  const A = new THREE.Color(0x1f4fb0); // lower ring
  const MOBILE = new THREE.Color(0x5f6b7d); // front mobile stands
  const C = new THREE.Color(0x24357a); // upper ring
  seats.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, one);
    mesh.setMatrixAt(i, m);
    c.copy(s.tier === 'C' ? C : s.row < 4 ? MOBILE : A).multiplyScalar(0.85 + r() * 0.3);
    mesh.setColorAt(i, c);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** instanced boxes from (start, end) segments (beams, girders, catwalk) */
function beams(segs: [THREE.Vector3, THREE.Vector3][], thick: number, mat: THREE.Material, height = thick): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, segs.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  segs.forEach(([a, b], i) => {
    const d = b.clone().sub(a);
    const len = d.length();
    q.setFromUnitVectors(zAxis, d.normalize());
    m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(thick, height, len + thick));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function v3(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z);
}

// ------------------------------------------------------------------ decor (visual only)

function buildDecor(root: THREE.Group, mats: Mats) {
  const { columns } = layout();
  const n = columns.length;
  const metal = mats.props.truss;
  const warm = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
  const cool = new THREE.MeshBasicMaterial({ color: 0xdfeaff });

  // ---- lighting truss: rectangular grid over the floor + fixtures
  const TY = 27.5;
  const segs: [THREE.Vector3, THREE.Vector3][] = [];
  for (const z of [-18, -9, 9, 18]) segs.push([v3(-30, TY, z), v3(30, TY, z)]);
  for (const x of [-30, -15, 0, 15, 30]) segs.push([v3(x, TY, -18), v3(x, TY, 18)]);
  for (const x of [-30, -15, 0, 15, 30]) for (const z of [-18, 18]) segs.push([v3(x, TY, z), v3(x * 1.05, ROOF_APEX_Y - 0.5, z * 1.05)]);
  const truss = beams(segs, 0.6, metal);
  root.add(truss);
  const fixtures: [THREE.Vector3, THREE.Vector3][] = [];
  for (const z of [-18, -9, 9, 18]) for (let x = -28; x <= 28; x += 4) fixtures.push([v3(x, TY - 0.55, z - 0.2), v3(x, TY - 0.55, z + 0.2)]);
  const lights = beams(fixtures, 0.5, warm, 0.25);
  root.add(lights);

  // ---- centre-hung scoreboard
  const sb = new THREE.Group();
  sb.position.set(0, 20.5, 0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(9.4, 5.2, 6.4), mats.props.speaker);
  sb.add(frame);
  const main = new THREE.MeshBasicMaterial({ map: screenTexture('main') });
  const side = new THREE.MeshBasicMaterial({ map: screenTexture('side') });
  mats.textures.push(main.map!, side.map!);
  for (const s of [1, -1]) {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.6), main);
    pm.position.set(0, 0, s * 3.22);
    pm.rotation.y = s > 0 ? 0 : Math.PI;
    sb.add(pm);
    const ps = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.6), side);
    ps.position.set(s * 4.72, 0, 0);
    ps.rotation.y = s * (Math.PI / 2);
    sb.add(ps);
  }
  const ringTex = (mats.surface.led as THREE.MeshBasicMaterial).map!.clone();
  ringTex.repeat.set(1.5, 1);
  ringTex.needsUpdate = true;
  mats.textures.push(ringTex);
  const ringMat = new THREE.MeshBasicMaterial({ map: ringTex });
  // LED rings: texture on the four sides only (BoxGeometry groups: +x −x +y −y +z −z)
  const ringMats = [ringMat, ringMat, mats.props.speaker, mats.props.speaker, ringMat, ringMat];
  for (const y of [-3.0, 3.0]) {
    const ring = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.7, 7.2), ringMats);
    ring.position.y = y;
    sb.add(ring);
  }
  root.add(sb);
  const cables: [THREE.Vector3, THREE.Vector3][] = [];
  for (const [x, z] of [[-4, -2.8], [4, -2.8], [-4, 2.8], [4, 2.8]]) cables.push([v3(x!, 23.9, z!), v3(x! * 1.6, ROOF_APEX_Y - 0.2, z! * 1.6)]);
  root.add(beams(cables, 0.08, metal));

  // ---- roof girders (radial, following the dome) + catwalk ring
  const RINGS = 14;
  const dAt = (t: number) => BACK_WALL_D1 - t * (BACK_WALL_D1 + 10 - 0.5);
  const yAt = (t: number) => ROOF_BASE_Y + (ROOF_APEX_Y - ROOF_BASE_Y) * Math.sin((t * Math.PI) / 2) - 0.45;
  const girders: [THREE.Vector3, THREE.Vector3][] = [];
  for (let j = 0; j < n; j += 7) {
    for (let r = 0; r < RINGS; r++) {
      const [ax, az] = stationPoint(j, dAt(r / RINGS));
      const [bx, bz] = stationPoint(j, dAt((r + 1) / RINGS));
      girders.push([v3(ax, yAt(r / RINGS), az), v3(bx, yAt((r + 1) / RINGS), bz)]);
    }
  }
  for (const t of [0.25, 0.5, 0.75]) {
    for (let j = 0; j < n; j += 2) {
      const [ax, az] = stationPoint(j, dAt(t));
      const [bx, bz] = stationPoint(j + 2, dAt(t));
      girders.push([v3(ax, yAt(t), az), v3(bx, yAt(t), bz)]);
    }
  }
  root.add(beams(girders, 0.45, mats.props.metal, 0.9));
  const walk: [THREE.Vector3, THREE.Vector3][] = [];
  for (let j = 0; j < n; j += 2) {
    const [ax, az] = stationPoint(j, 6);
    const [bx, bz] = stationPoint(j + 2, 6);
    walk.push([v3(ax, 29.5, az), v3(bx, 29.5, bz)]);
  }
  root.add(beams(walk, 1.0, mats.props.metal, 0.12));

  // ---- concourse ceiling light strips + tunnel lights
  const strips: [THREE.Vector3, THREE.Vector3][] = [];
  for (const col of columns) {
    for (const d of [22.6, 27.0]) {
      if (col.b === 'cstair' && d < 23) continue;
      const a = columnPoint(col.index, 0.15, d);
      const b = columnPoint(col.index, 0.85, d);
      strips.push([v3(a.x, CONC_CEIL - 0.04, a.z), v3(b.x, CONC_CEIL - 0.04, b.z)]);
    }
    if (col.b === 'box') {
      const a = columnPoint(col.index, 0.3, 17.8);
      const b = columnPoint(col.index, 0.7, 17.8);
      strips.push([v3(a.x, 12.16, a.z), v3(b.x, 12.16, b.z)]);
    }
    if (col.a === 'tunnel') {
      for (let d = 2; d < 12; d += 2.5) {
        const a = columnPoint(col.index, 0.9, d);
        const b = columnPoint(col.index, 0.9, d + 1.2);
        strips.push([v3(a.x, TUN_CEIL - 0.04, a.z), v3(b.x, TUN_CEIL - 0.04, b.z)]);
      }
    }
  }
  root.add(beams(strips, 0.35, cool, 0.05));

  // ---- hanging banners from the catwalk (colour accents high in the bowl)
  const bannerColors = [0x1f4fb0, 0xffffff, 0xd4213d, 0xffd60a];
  const bannerGeo = new THREE.PlaneGeometry(2.4, 6);
  const bannerMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
  const banners = new THREE.InstancedMesh(bannerGeo, bannerMat, 16);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 16; i++) {
    const j = Math.floor((i / 16) * n);
    const p = columnPoint(j, 0.5, 8);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yawIn);
    m.compose(v3(p.x, 25.5, p.z), q, new THREE.Vector3(1, 1, 1));
    banners.setMatrixAt(i, m);
    banners.setColorAt(i, new THREE.Color(bannerColors[i % bannerColors.length]!));
  }
  root.add(banners);
}

// ------------------------------------------------------------------ scene look

interface SceneState {
  background: THREE.Scene['background'];
  fog: THREE.Scene['fog'];
  lights: { light: THREE.Light; intensity: number; color: THREE.Color; pos?: THREE.Vector3; shadow?: { l: number; r: number; t: number; b: number; far: number; size: number } }[];
}

function applyArenaLook(scene: THREE.Scene, added: THREE.Object3D[]): SceneState {
  const state: SceneState = { background: scene.background, fog: scene.fog, lights: [] };
  scene.background = new THREE.Color(0x0c0e13);
  scene.fog = new THREE.Fog(0x0c0e13, 110, 320);
  scene.traverse((o) => {
    const l = o as THREE.Light;
    if (!l.isLight) return;
    const entry: SceneState['lights'][number] = { light: l, intensity: l.intensity, color: l.color.clone() };
    if ((l as THREE.HemisphereLight).isHemisphereLight) {
      l.intensity = 0.55;
      l.color.set(0xc9d8ff);
      (l as THREE.HemisphereLight).groundColor.set(0x3a3630);
    } else if ((l as THREE.DirectionalLight).isDirectionalLight) {
      const d = l as THREE.DirectionalLight;
      entry.pos = d.position.clone();
      const sc = d.shadow.camera;
      entry.shadow = { l: sc.left, r: sc.right, t: sc.top, b: sc.bottom, far: sc.far, size: d.shadow.mapSize.x };
      // the "rig": steep key light from the roof truss; shadows cover the whole bowl
      d.position.set(14, 90, 9);
      d.target.position.set(0, 0, 0);
      d.target.updateMatrixWorld();
      d.intensity = 2.3;
      d.color.set(0xfff6ea);
      sc.left = -72;
      sc.right = 72;
      sc.top = 60;
      sc.bottom = -60;
      sc.far = 140;
      sc.updateProjectionMatrix();
    }
    state.lights.push(entry);
  });
  // two soft fill lights from the long sides so the stands aren't flat
  for (const z of [-1, 1]) {
    const fill = new THREE.DirectionalLight(0xbfd2ff, 0.35);
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
    mesh.castShadow = mat !== 'roof' && mat !== 'glass' && mat !== 'led';
    mesh.receiveShadow = mat !== 'roof' && mat !== 'led';
    if (mat === 'glass') mesh.renderOrder = 2;
    if (mat === 'led') {
      const map = (mats.surface.led as THREE.MeshBasicMaterial).map!;
      mesh.onBeforeRender = () => {
        map.offset.x = (performance.now() / 1000) * 0.012;
      };
    }
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
    mesh.castShadow = mat !== 'sign' && mat !== 'screen';
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  // ---- seats + decor
  root.add(seatMesh(geo.seats));
  buildDecor(root, mats);
  scene.add(root);

  // ---- colliders: bowl trimesh + ground slab + prop cuboids
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
    colliders.push(
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(p.sx / 2, p.sy / 2, p.sz / 2)
          .setTranslation(p.x, p.y, p.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      ),
    );
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
