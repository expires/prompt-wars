// Browser entry for the PNG renderer: window.renderDesigns(designs) draws each design in a side
// view + a 3/4 view, with name / tri count labels. Bundled by scripts/render.ts.
import * as THREE from 'three';
import { buildDesign } from '@ai-gaem/shared/forge/build';
import { boxSize, type ForgeDesign } from '@ai-gaem/shared/forge';

declare global {
  interface Window {
    renderDesigns: (designs: ForgeDesign[], cell?: number) => void;
    renderDone?: boolean;
  }
}

window.renderDesigns = (designs, cell = 420) => {
  const W = cell * 2;
  const H = cell * designs.length;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);
  renderer.setScissorTest(true);
  document.body.appendChild(renderer.domElement);
  const labels = document.createElement('div');
  labels.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;font:14px system-ui;color:#eee`;
  document.body.appendChild(labels);

  designs.forEach((d, i) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(i % 2 ? '#262a33' : '#2c313b');
    scene.add(new THREE.HemisphereLight('#ffffff', '#445566', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(2, 3, 1.5);
    scene.add(sun);
    const g = buildDesign(d);
    scene.add(g);
    const box = new THREE.Box3().setFromObject(g);
    const c = box.getCenter(new THREE.Vector3());
    const size = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 0.1);
    // origin marker (grip / hand)
    const marker = new THREE.Mesh(new THREE.SphereGeometry(size * 0.012), new THREE.MeshBasicMaterial({ color: '#ff3355' }));
    scene.add(marker);
    const y = H - (i + 1) * cell;
    // side view: camera on +X, muzzle (-Z) points right
    const half = size * 0.62;
    const ortho = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 100);
    ortho.position.set(c.x + 10, c.y, c.z);
    ortho.lookAt(c);
    renderer.setViewport(0, y, cell, cell);
    renderer.setScissor(0, y, cell, cell);
    renderer.render(scene, ortho);
    // 3/4 view from front-left-above
    const persp = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    const dist = size * 1.9;
    persp.position.set(c.x + dist * 0.75, c.y + dist * 0.45, c.z - dist * 0.6);
    persp.lookAt(c);
    renderer.setViewport(cell, y, cell, cell);
    renderer.setScissor(cell, y, cell, cell);
    renderer.render(scene, persp);
    const l = document.createElement('div');
    l.style.cssText = `position:absolute;left:8px;top:${i * cell + 6}px`;
    const s = boxSize({ min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number] });
    l.textContent = `${d.name} (${d.class}) - ${d.components.length} parts, ${(g.userData as { tris: number }).tris} tris, ${Math.max(...s).toFixed(2)} m`;
    labels.appendChild(l);
  });
  window.renderDone = true;
};
