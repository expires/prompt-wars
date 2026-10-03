import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PARTS, getPart } from '../src/registry';
import { RECIPES } from '../src/recipes';
import { assembleWeapon, DEFAULT_AXIS } from '../src/assemble';
import { countTris } from '../src/lib/kit';
import { CATEGORIES, WEAPON_CLASSES, type PartDef, type Recipe } from '../src/types';

/* ---------------- shared offscreen renderer ---------------- */
const THUMB_W = 320;
const THUMB_H = 240;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.setPixelRatio(1);
renderer.setSize(THUMB_W, THUMB_H);
renderer.outputColorSpace = THREE.SRGBColorSpace;

function makeScene(): THREE.Scene {
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 2.2);
  d.position.set(2, 3, 1.5);
  s.add(d);
  const d2 = new THREE.DirectionalLight(0xbfd8ff, 0.8);
  d2.position.set(-2, 1, -2);
  s.add(d2);
  return s;
}
const scene = makeScene();
const camera = new THREE.PerspectiveCamera(30, THUMB_W / THUMB_H, 0.001, 100);

/** Frame an object from a 3/4 side view (weapon points -Z, so look from +X, slightly front/up). */
function frame(cam: THREE.PerspectiveCamera, obj: THREE.Object3D, yaw = 0, dirOverride?: THREE.Vector3) {
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.length() / 2, 0.02);
  const dist = r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 0.95;
  const dir = dirOverride ?? new THREE.Vector3(1, 0.45, -0.55);
  dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).normalize();
  cam.position.copy(c).addScaledVector(dir, dist);
  cam.near = dist / 100;
  cam.far = dist * 10;
  cam.updateProjectionMatrix();
  cam.lookAt(c);
}

function socketGizmos(def: PartDef): THREE.Group {
  const g = new THREE.Group();
  for (const [name, s] of Object.entries(def.sockets)) {
    const p = new THREE.Vector3(...s.pos);
    const dir = new THREE.Vector3(...(s.dir ?? DEFAULT_AXIS[name] ?? [0, 1, 0])).normalize();
    const color = new THREE.Color().setHSL((name.charCodeAt(0) * 37 + name.length * 11) % 360 / 360, 0.8, 0.5);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.position.copy(p);
    m.renderOrder = 10;
    g.add(m);
    const arrow = new THREE.ArrowHelper(dir, p, 0.04, color.getHex(), 0.012, 0.008);
    (arrow.line.material as THREE.Material).depthTest = false;
    (arrow.cone.material as THREE.Material).depthTest = false;
    arrow.renderOrder = 10;
    g.add(arrow);
  }
  return g;
}

function drawThumb(obj: THREE.Object3D, target: HTMLCanvasElement, yaw = 0) {
  scene.add(obj);
  frame(camera, obj, yaw);
  renderer.render(scene, camera);
  scene.remove(obj);
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(renderer.domElement, 0, 0, target.width, target.height);
}

/* ---------------- state / filters ---------------- */
const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const catSel = $<HTMLSelectElement>('cat');
const clsSel = $<HTMLSelectElement>('cls');
const q = $<HTMLInputElement>('q');
const showSockets = $<HTMLInputElement>('sockets');
for (const c of CATEGORIES) catSel.add(new Option(`${c} (${PARTS.filter((p) => p.category === c).length})`, c));
for (const c of WEAPON_CLASSES) clsSel.add(new Option(c, c));
catSel.value = params.get('cat') ?? '';
clsSel.value = params.get('cls') ?? '';
q.value = params.get('q') ?? '';
showSockets.checked = params.get('sockets') === '1';

let tab = params.get('tab') === 'recipes' ? 'recipes' : 'parts';
const partsEl = $('parts');
const recipesEl = $('recipes');
const countEl = $('count');

function filtered(): PartDef[] {
  const qs = q.value.trim().toLowerCase();
  return PARTS.filter(
    (p) =>
      (!catSel.value || p.category === catSel.value) &&
      (!clsSel.value || p.classes.includes(clsSel.value)) &&
      (!qs || p.id.includes(qs) || p.desc.toLowerCase().includes(qs) || p.tags.some((t) => t.includes(qs))),
  );
}

/* ---------------- parts grid (lazy thumbnails) ---------------- */
const pending = new Set<HTMLCanvasElement>();
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const c = e.target as HTMLCanvasElement;
      if (e.isIntersecting && !c.dataset.done) pending.add(c);
      if (!e.isIntersecting && tab === 'recipes' && !params.get('eager')) visibleRecipes.delete(c);
      if (e.isIntersecting && c.dataset.recipe) visibleRecipes.add(c);
    }
  },
  { rootMargin: '200px' },
);

function renderParts() {
  io.disconnect();
  pending.clear();
  partsEl.innerHTML = '';
  const list = filtered();
  countEl.textContent = `${list.length} / ${PARTS.length} parts`;
  const frag = document.createDocumentFragment();
  for (const p of list) {
    const card = document.createElement('div');
    card.className = 'card';
    const cv = document.createElement('canvas');
    cv.width = THUMB_W;
    cv.height = THUMB_H;
    cv.dataset.part = p.id;
    card.appendChild(cv);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<span class="tris"></span><div class="id">${p.id}</div><div class="desc">${p.desc}</div><div class="cls">${p.category} · ${p.classes.join(', ')}</div>`;
    card.appendChild(meta);
    card.onclick = () => openViewer({ part: p });
    frag.appendChild(card);
    io.observe(cv);
    if (params.get('eager')) pending.add(cv);
  }
  partsEl.appendChild(frag);
}

function pumpThumbs() {
  const start = performance.now();
  for (const c of pending) {
    if (performance.now() - start > 12) break;
    pending.delete(c);
    const def = getPart(c.dataset.part!);
    if (!def) continue;
    const obj = def.build({});
    const tris = countTris(obj);
    const holder = new THREE.Group();
    holder.add(obj);
    if (showSockets.checked) holder.add(socketGizmos(def));
    drawThumb(holder, c);
    c.dataset.done = '1';
    const t = c.parentElement?.querySelector('.tris');
    if (t) t.textContent = `${tris}△`;
  }
  (window as any).__thumbsPending = pending.size;
}

/* ---------------- recipes grid (rotating) ---------------- */
const visibleRecipes = new Set<HTMLCanvasElement>();
const recipeObjs = new Map<string, THREE.Group>();

function renderRecipes() {
  io.disconnect();
  visibleRecipes.clear();
  recipesEl.innerHTML = '';
  countEl.textContent = `${RECIPES.length} recipes`;
  RECIPES.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    const cv = document.createElement('canvas');
    cv.width = THUMB_W * 1.25;
    cv.height = THUMB_H * 1.25;
    cv.dataset.recipe = String(i);
    card.appendChild(cv);
    const g = assembleWeapon(r);
    recipeObjs.set(String(i), g);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const miss = [...g.userData.missing, ...g.userData.unplaced];
    meta.innerHTML = `<span class="tris">${countTris(g)}△</span><div class="id">${r.name}</div><div class="cls">${r.class}</div><div class="desc">${r.parts.map((p) => p.partId).join(' + ')}${miss.length ? `<br><b style="color:red">missing: ${miss.join(', ')}</b>` : ''}</div>`;
    card.appendChild(meta);
    card.onclick = () => openViewer({ recipe: r });
    recipesEl.appendChild(card);
    io.observe(cv);
    if (params.get('eager')) visibleRecipes.add(cv);
  });
}

function setTab(t: string) {
  tab = t;
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  partsEl.hidden = t !== 'parts';
  recipesEl.hidden = t !== 'recipes';
  $('filters').style.visibility = t === 'parts' ? 'visible' : 'hidden';
  if (t === 'parts') renderParts();
  else renderRecipes();
}
document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => (b.onclick = () => setTab(b.dataset.tab!)));
for (const el of [catSel, clsSel, showSockets]) el.addEventListener('change', renderParts);
q.addEventListener('input', renderParts);

/* ---------------- big viewer ---------------- */
const viewer = $('viewer');
const vCanvas = $<HTMLCanvasElement>('viewer-canvas');
const vRenderer = new THREE.WebGLRenderer({ canvas: vCanvas, antialias: true });
vRenderer.outputColorSpace = THREE.SRGBColorSpace;
const vScene = makeScene();
vScene.background = new THREE.Color('#e9e6df');
const grid = new THREE.GridHelper(2, 40, 0xb0aaa0, 0xd0cbc2);
grid.position.y = -0.3;
vScene.add(grid);
vScene.add(new THREE.AxesHelper(0.1));
const vCam = new THREE.PerspectiveCamera(35, 1, 0.001, 100);
const controls = new OrbitControls(vCam, vCanvas);
let vObj: THREE.Object3D | null = null;

function openViewer(o: { part?: PartDef; recipe?: Recipe }) {
  if (vObj) vScene.remove(vObj);
  const g = new THREE.Group();
  if (o.part) {
    g.add(o.part.build({}));
    g.add(socketGizmos(o.part));
    $('viewer-title').textContent = o.part.id;
    $('viewer-info').textContent = JSON.stringify({ ...o.part, build: undefined, tris: countTris(g.children[0]) }, null, 1);
  } else if (o.recipe) {
    g.add(assembleWeapon(o.recipe));
    $('viewer-title').textContent = o.recipe.name;
    $('viewer-info').textContent = JSON.stringify(o.recipe, null, 1);
  }
  vObj = g;
  vScene.add(g);
  viewer.hidden = false;
  const w = vCanvas.clientWidth;
  const h = vCanvas.clientHeight;
  vRenderer.setSize(w, h, false);
  vCam.aspect = w / h;
  frame(vCam, g);
  const box = new THREE.Box3().setFromObject(g);
  controls.target.copy(box.getCenter(new THREE.Vector3()));
  grid.position.y = box.min.y - 0.01;
  controls.update();
}
$('viewer-close').onclick = () => (viewer.hidden = true);
addEventListener('keydown', (e) => e.key === 'Escape' && (viewer.hidden = true));

/* ---------------- loop ---------------- */
let t0 = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const t = (performance.now() - t0) / 1000;
  if (tab === 'parts') pumpThumbs();
  else {
    for (const c of visibleRecipes) {
      const g = recipeObjs.get(c.dataset.recipe!);
      if (!g) continue;
      renderer.setSize(c.width, c.height);
      camera.aspect = c.width / c.height;
      const yaw = params.get('still') ? 0 : Math.sin(t * 0.6 + Number(c.dataset.recipe)) * 0.9;
      drawThumb(g, c, yaw);
      renderer.setSize(THUMB_W, THUMB_H);
      camera.aspect = THUMB_W / THUMB_H;
    }
    (window as any).__thumbsPending = 0;
  }
  if (!viewer.hidden && vObj) {
    controls.update();
    vRenderer.render(vScene, vCam);
  }
}
setTab(tab);
if (params.get('view')) {
  const p = getPart(params.get('view')!);
  const r = RECIPES.find((x) => x.name === params.get('view'));
  if (p || r) openViewer({ part: p, recipe: r });
}
loop();
(window as any).__ready = true;
