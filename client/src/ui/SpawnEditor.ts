import * as THREE from 'three';
import type { Input } from '../engine/input';
import { loadSavedSpawns, saveSpawns, type SpawnPoint } from '../map/spawns';
import type { Hud } from './Hud';

/**
 * Debug spawn editor. F2 toggles. While active:
 *  P          save current position as a spawn (localStorage + console JSON)
 *  Backspace  remove the last spawn
 *  C          clear all saved spawns for this map
 */
export class SpawnEditor {
  active = false;
  private spawns: SpawnPoint[];
  private readonly markers = new THREE.Group();
  private readonly markerGeo = new THREE.ConeGeometry(0.3, 0.8, 8);
  private readonly markerMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, wireframe: true });
  private readonly arrowMat = new THREE.MeshBasicMaterial({ color: 0xffcf40 });

  constructor(
    private readonly mapId: string,
    scene: THREE.Scene,
    private readonly input: Input,
    private readonly hud: Hud,
    private readonly getPose: () => { feet: THREE.Vector3; yaw: number },
  ) {
    this.spawns = loadSavedSpawns(mapId);
    this.markers.visible = false;
    scene.add(this.markers);
    this.rebuild();
  }

  get saved(): SpawnPoint[] {
    return this.spawns;
  }

  update() {
    if (this.input.wasPressed('F2')) {
      this.active = !this.active;
      this.markers.visible = this.active;
      this.refreshHud();
    }
    if (!this.active) return;
    if (this.input.wasPressed('KeyP')) {
      const { feet, yaw } = this.getPose();
      const sp: SpawnPoint = { pos: [round(feet.x), round(feet.y + 0.05), round(feet.z)], yaw: round(yaw) };
      this.spawns.push(sp);
      this.persist(`added spawn #${this.spawns.length}`);
    }
    if (this.input.wasPressed('Backspace') && this.spawns.length) {
      this.spawns.pop();
      this.persist('removed last spawn');
    }
    if (this.input.wasPressed('Delete')) {
      this.spawns = [];
      this.persist('cleared spawns');
    }
  }

  private persist(what: string) {
    saveSpawns(this.mapId, this.spawns);
    this.rebuild();
    this.refreshHud();
    console.info(`[spawn-editor] ${what}. spawns for "${this.mapId}":\n${JSON.stringify(this.spawns)}`);
  }

  private refreshHud() {
    this.hud.setSpawnEditor(
      this.active ? `SPAWN EDITOR (${this.mapId}) — ${this.spawns.length} saved · P save · Backspace undo · Delete clear · F2 close` : null,
    );
  }

  private rebuild() {
    this.markers.clear();
    for (const s of this.spawns) {
      const g = new THREE.Group();
      const cone = new THREE.Mesh(this.markerGeo, this.markerMat);
      cone.rotation.x = Math.PI; // point down
      cone.position.y = 0.4;
      const arrow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.6), this.arrowMat);
      arrow.position.set(0, 0.05, -0.3);
      g.add(cone, arrow);
      g.position.set(...s.pos);
      g.rotation.y = s.yaw;
      this.markers.add(g);
    }
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
