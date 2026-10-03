import * as THREE from 'three';
import { clampWeapon } from '@ai-gaem/shared';
import type { Game } from './engine/Game';

/**
 * `window.__game`: a small deterministic control surface for e2e tests (and console
 * debugging) so tests don't depend on pointer lock / mouse look.
 */
export interface GameTestHook {
  getState(): ReturnType<typeof getState>;
  /** move the local player (feet position) and push the transform to the server immediately */
  teleport(x: number, y: number, z: number, yaw?: number): void;
  /** point the camera at a remote player's body centre; false if not in the scene */
  aimAt(playerId: string): boolean;
  /** point the camera at a world position */
  lookAt(x: number, y: number, z: number): void;
  /** fire one shot now (bypasses the *local* fire-rate cooldown; the server still enforces it) */
  fireOnce(): boolean;
  /** start a reload (client + server) */
  reload(): void;
  /** what clampWeapon() makes of the current weapon (test: stats already within bounds) */
  clampCurrentWeapon(): unknown;
}

function getState(game: Game) {
  const ready = game.ready;
  const f = ready ? game.player.feet : new THREE.Vector3();
  const w = ready ? game.weapons.weapon : undefined;
  const net = game.net as (typeof game.net & { connected?: boolean }) | undefined;
  return {
    ready,
    connected: net?.connected ?? ready,
    authoritative: net?.authoritative ?? false,
    localId: net?.localId ?? '',
    name: game.me?.name ?? '',
    hp: game.hp,
    serverHp: game.me?.hp,
    alive: game.alive,
    kills: game.me?.kills ?? 0,
    deaths: game.me?.deaths ?? 0,
    respawnAt: game.me?.respawnAt ?? 0,
    weaponId: w?.id ?? '',
    serverWeaponId: game.me?.weaponId ?? '',
    weaponName: w?.name ?? '',
    weapon: w ? JSON.parse(JSON.stringify(w)) : null,
    ammo: ready ? game.weapons.ammo : 0,
    viewmodelMeshes: ready ? game.weapons.viewmodel.meshCount() : 0,
    pos: [f.x, f.y, f.z] as [number, number, number],
    yaw: ready ? game.player.yaw : 0,
    pitch: ready ? game.player.pitch : 0,
    deathVisible: ready ? game.hud.deathVisible : false,
    killLog: [...game.killLog],
    playersSeen: ready
      ? game.remotes.ids().map((id) => {
          const r = game.remotes.get(id)!;
          return {
            id,
            name: r.state.name,
            hp: r.state.hp,
            alive: r.state.alive,
            visible: r.visible,
            hasWeaponModel: r.hasWeaponModel,
            weaponId: r.state.weaponId ?? '',
            /** interpolated (rendered) feet position */
            pos: [r.position.x, r.position.y, r.position.z] as [number, number, number],
            /** latest server position */
            netPos: r.state.pos,
          };
        })
      : [],
  };
}

export function installTestHook(game: Game) {
  const hook: GameTestHook = {
    getState: () => getState(game),
    teleport(x, y, z, yaw) {
      game.player.teleport(new THREE.Vector3(x, y, z), yaw);
      game.player.updateCamera(game.rc.camera, 1);
      game.rc.camera.updateMatrixWorld();
      game.sendTransformNow();
    },
    aimAt(playerId) {
      const c = game.remotes.centerOf(playerId);
      if (!c) return false;
      game.lookAt(c);
      game.sendTransformNow();
      return true;
    },
    lookAt(x, y, z) {
      game.lookAt(new THREE.Vector3(x, y, z));
    },
    fireOnce() {
      if (!game.alive) return false;
      game.rc.camera.updateMatrixWorld();
      return game.weapons.fireOnce();
    },
    reload() {
      game.weapons.startReload();
    },
    clampCurrentWeapon() {
      const { id: _id, ...w } = game.weapons.weapon;
      return clampWeapon(w);
    },
  };
  (window as unknown as { __game: GameTestHook }).__game = hook;
  return hook;
}
