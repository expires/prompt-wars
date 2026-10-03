import * as THREE from 'three';
import { clampWeapon, sanitizeDesign, sanitizeOutfit } from '@ai-gaem/shared';
import { outfitCacheStats } from './player/outfitModelCache';
import type { Game } from './engine/Game';
import { Humanoid } from './player/humanoid';
import { playerStatus } from './weapons/elementFx';
import { BASE_MOUSE_SENS, settings } from './settings';
import { getDefaultWeapons } from './weapons/defaultWeapons';
import { designModelCacheStats } from './weapons/designModelCache';

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
  /** force crouch on/off (null = back to keyboard control) */
  setCrouch(on: boolean | null): void;
  /** force aim-down-sights on/off (null = back to right mouse) */
  setAds(on: boolean | null): void;
  /** point the camera at a remote player's head hitbox centre; false if not in the scene */
  aimAtHead(playerId: string): boolean;
  /** disable spread / bloom / recoil so test shots land exactly where aimed */
  setPerfectAim(on: boolean): void;
  /**
   * Fire a network shot (no local raycast) and report a hit on `playerId` with an arbitrary zone
   * and impact point: exercises the server's headshot validation. Returns the shot seq.
   */
  reportHitRaw(playerId: string, zone: number, point: [number, number, number]): number;
  /** keep the hitmarker visible (screenshots) */
  holdHitmarker(on: boolean): void;
  /** move in a circle at constant speed (null = stop); the network sends like real movement */
  setAutoMove(m: { cx: number; cz: number; r: number; speed: number; y: number } | null): void;
  /** record the rendered position of a remote player every frame for `ms` */
  traceRemote(playerId: string, ms: number): Promise<{ t: number; x: number; y: number; z: number; d?: unknown }[]>;
  /** while dead: equip the preset weapon of a class (resolves when the server accepted it) */
  equipPreset(weaponClass: string): Promise<string>;
  /** melee: start a swing now (charge 0..1; bypasses the local cooldown, the server still checks) */
  meleeSwing(charge?: number): boolean;
  /** melee: force the block on / off (null = keyboard / gamepad) */
  setBlock(on: boolean | null): void;
  /** hold local swings and remote third-person actions at progress u (screenshots); null = run */
  freezeAnims(u: number | null): void;
  /** offline: equip a sample weapon by index (debug keys 1-0) */
  equipSample(i: number): string;
  /** show the trackpad-mode hint toast (tests / screenshots) */
  showTrackpadHint(): void;
  /** play with the gamepad / keyboard without pointer lock (as after pressing Start) */
  setPadPlaying(on: boolean): void;
  /**
   * Treat the pointer as locked without a real lock (headless browsers can't grant one), so
   * synthetic `mousemove` events with movementX/Y drive mouse look through the real listener.
   */
  emulatePointerLock(on: boolean): void;
  /** F3 perf window (fps / mouse events per second / worst frame ms over the last second) + raw counters */
  perfStats(): { fps: number; mouseHz: number; maxFrameMs: number; mouseEvents: number; sens: number };
  /** trackpad mode preset on / off */
  setTrackpadMode(on: boolean): void;
  /** reducer call counters / network stats */
  netStats(): { rtt: number; sendHz: number; calls: Record<string, number>; interp?: unknown } | null;
  /** legacy server-side template generation (generate_weapon procedure) while dead, then respawn */
  generateLegacy(prompt: string): Promise<void>;
  /** open the Esc pause menu (no pointer lock in tests) */
  openPause(): void;
  /** show the Tab scoreboard without holding Tab (screenshots) */
  forceScoreboard(on: boolean): void;
  /** register a Forge design and deploy with it (same path as the editor's EQUIP) */
  equipDesign(design: unknown, prompt?: string): Promise<void>;
  /** walk forward with real input-driven movement (autorun + pad play, no pointer lock); false stops */
  setAutoRun(on: boolean): void;
  /** median horizontal speed of the local player over `ms` (real input-driven movement, m/s) */
  measureSpeed(ms: number): Promise<number>;
  /** soak / leak checks: GPU resource counters, scene sizes, caches and transient-object counts */
  memStats(): MemStats;
  /** offline: number of sample weapons equippable with equipSample() */
  sampleCount(): number;
  /** offline: kill the local player (as the K debug key) */
  killSelf(): void;
  /** respawn with the current loadout through the normal deploy path (offline: immediate) */
  respawnNow(): Promise<boolean>;
  /**
   * offline bots: give every bot a different sample weapon (exercises remote weapon-model swaps);
   * `churn` also drops one bot for ~0.2 s so it leaves and rejoins (remote player teardown / rebuild);
   * `index`: give every bot that sample weapon instead (deterministic state for measurements)
   */
  botsCycle(churn?: boolean, index?: number): boolean;
  /** Closet: wear an outfit (raw OutfitDesign JSON; presetId = equip a stored row by id) via the editor's path */
  equipOutfit(outfit: unknown, prompt?: string, presetId?: string): Promise<void>;
  /** Closet: open the editor ('pause' | 'death' | 'first') */
  openCloset(mode?: 'pause' | 'death' | 'first'): Promise<void>;
  /** preset outfit rows (id, name, maxHp) */
  outfitPresets(): { id: string; name: string; maxHp: number }[];
  /** offline bots: wear these outfit ids (round robin) */
  botsOutfits(ids: string[]): boolean;
}

export interface MemStats {
  geometries: number;
  textures: number;
  programs: number;
  /** objects in the world scene / first-person overlay scene (recursive) */
  sceneObjects: number;
  viewObjects: number;
  /** meshes / lines / points / sprites in the world scene */
  sceneMeshes: number;
  designCache: ReturnType<typeof designModelCacheStats>;
  outfitCache?: ReturnType<typeof outfitCacheStats>;
  projectiles: number;
  effects: number;
  particles: number;
  remotes: number;
  damageNumbers: number;
  killLog: number;
  domNodes: number;
  rapierBodies: number;
  rapierColliders: number;
  jsHeap: number | null;
}

function getState(game: Game) {
  const ready = game.ready;
  const f = ready ? game.player.feet : new THREE.Vector3();
  const w = ready ? game.weapons.weapon : undefined;
  const net = game.net as (typeof game.net & { connected?: boolean }) | undefined;
  const p = ready ? game.player : undefined;
  const ws = ready ? game.weapons : undefined;
  const mv = ws?.meleeView();
  return {
    melee: ws && ws.fireMode === 'melee'
      ? {
          meta: ws.melee.meta,
          view: mv?.kind ?? 'idle',
          u: mv && mv.kind === 'swing' ? mv.u : -1,
          combo: mv && mv.kind === 'swing' ? mv.combo : -1,
          charge: mv && (mv.kind === 'swing' || mv.kind === 'charge') ? mv.charge : 0,
          blocking: ws.melee.blocking,
          swings: ws.melee.swings,
          last: ws.melee.last,
          offset: ws.viewmodel.meleeOffset,
        }
      : null,
    autoRun: p?.autoRun ?? false,
    trackpadMode: settings.current.trackpadMode,
    settings: { ...settings.current },
    pad: ready ? { connected: game.input.pad.connected, move: game.input.pad.move, look: game.input.pad.look, playing: game.input.padPlaying } : null,
    touch: game.touch ? { visible: game.touch.visible, playing: game.input?.touchPlaying ?? false } : null,
    toastVisible: ready ? game.hud.toastVisible : false,
    serverBlocking: (ready && game.net.getPose?.(game.net.localId)?.blocking) || false,
    crouching: p?.crouched ?? false,
    eyeHeight: p?.eyeHeight ?? 0,
    ceilingBlocked: p?.ceilingBlocked() ?? false,
    sprinting: p?.sprinting ?? false,
    /** carry-weight x block multiplier and server slow scale applied to movement */
    moveMult: p?.moveMult ?? 1,
    speedScale: p?.speedScale ?? 1,
    hSpeed: p?.horizontalSpeed() ?? 0,
    /** elemental status on the local player (burning / chilled / ...) */
    status: playerStatus(game.me),
    hudStatus: ready ? [...document.querySelectorAll('[data-testid=status-effects] [data-testid^=status-]')].map((e) => (e as HTMLElement).dataset.testid ?? '') : [],
    ads: ready ? game.ads : 0,
    fov: ready ? game.rc.camera.fov : 0,
    spread: ready ? game.weapons.currentSpread() : 0,
    hitmarker: ready ? (document.querySelector('[data-testid=hitmarker]')?.className ?? '') : '',
    killConfirm: ready ? game.hud.killConfirmVisible : false,
    damageNumbers: ready ? game.damageNumbers.snapshot() : [],
    /** map pickups (health packs) as this client sees them, and how many take events it handled */
    pickups: ready && game.pickups ? game.pickups.snapshot() : [],
    pickupEvents: ready && game.pickups ? game.pickups.taken : 0,
    /** crouch flag of our own pose row as the server has it */
    serverCrouching: (ready && game.net.getPose?.(game.net.localId)?.crouching) || false,
    ready,
    connected: net?.connected ?? ready,
    authoritative: net?.authoritative ?? false,
    localId: net?.localId ?? '',
    name: game.me?.name ?? '',
    hp: game.hp,
    serverHp: game.me?.hp,
    /** server-side position of the player row (spawn / resume point) */
    serverPos: game.me?.pos ?? null,
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
    deathVisible: ready ? game.flow.death.visible : false,
    screen: game.flow?.screen ?? 'none',
    needsLoadout: !!game.me?.needsLoadout,
    maxHp: ready ? game.maxHp : 100,
    serverMaxHp: game.me?.maxHp,
    outfitId: game.me?.outfitId ?? (game.net as { localOutfitId?: string } | undefined)?.localOutfitId ?? '0',
    outfit: ready && game.outfit ? { id: game.outfit.id, name: game.outfit.name, maxHp: game.outfit.maxHp, speedMult: game.outfit.speedMult, dims: game.outfit.dims, pieces: game.outfit.outfit.pieces.length } : null,
    bodySpeedMult: ready ? game.bodySpeedMult : 1,
    playerDims: p?.dims ?? null,
    closet: game.flow?.closet
      ? {
          busy: game.flow.closet.session.state.busy,
          error: game.flow.closet.session.state.error,
          outfit: game.flow.closet.session.state.outfit
            ? { name: game.flow.closet.session.state.outfit.name, body: game.flow.closet.session.state.outfit.body, pieces: game.flow.closet.session.state.outfit.pieces.map((x) => ({ id: x.id, label: x.label, socket: x.socket, locked: !!x.locked })) }
            : null,
        }
      : null,
    weaponDesign: w?.design ? { name: w.design.name, components: w.design.components.map((c) => ({ id: c.id, label: c.label })) } : null,
    forge: game.flow?.forge
      ? {
          busy: game.flow.forge.session.state.busy,
          error: game.flow.forge.session.state.error,
          origin: game.flow.forge.session.state.origin
            ? { norm: game.flow.forge.session.state.origin.norm, fresh: game.flow.forge.session.state.origin.fresh, cached: game.flow.forge.session.state.origin.cached ?? null }
            : null,
          drafts: game.flow.forge.session.state.drafts.map((d) => ({ name: d.name, components: d.components.length, done: !!d.design })),
          design: game.flow.forge.session.state.design
            ? {
                name: game.flow.forge.session.state.design.name,
                components: game.flow.forge.session.state.design.components.map((c) => ({ id: c.id, label: c.label, locked: !!c.locked })),
              }
            : null,
        }
      : null,
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
            /** server crouch state + rendered crouch blend (0..1) */
            crouching: !!r.state.crouching,
            crouchT: r.crouchT,
            /** rendered head hitbox centre */
            head: [r.head.x, r.head.y, r.head.z] as [number, number, number],
            /** third-person animation (melee swing / recoil / block) */
            anim: r.anim,
            /** elemental status + rendered body glow */
            status: r.status,
            tint: r.tint,
            /** worn outfit + hitbox body + attached outfit part groups */
            outfit: r.outfit,
            maxHp: r.state.maxHp ?? 100,
          };
        })
      : [],
  };
}

let botCycleN = 0;

export function installTestHook(game: Game) {
  const hook: GameTestHook = {
    getState: () => getState(game),
    teleport(x, y, z, yaw) {
      game.teleportLocal([x, y, z], yaw);
      game.player.updateCamera(game.rc.camera, 1);
      game.rc.camera.updateMatrixWorld();
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
    setCrouch(on) {
      game.player.forceCrouch = on;
    },
    setAds(on) {
      game.forceAds = on;
    },
    aimAtHead(playerId) {
      const c = game.remotes.headOf(playerId);
      if (!c) return false;
      game.lookAt(c);
      game.sendTransformNow();
      return true;
    },
    setPerfectAim(on) {
      game.weapons.perfectAim = on;
    },
    reportHitRaw(playerId, zone, point) {
      const eye = game.player.eye();
      const dir = new THREE.Vector3(...point).sub(eye).normalize();
      const seq = game.net.fire([eye.x, eye.y, eye.z], [dir.x, dir.y, dir.z]);
      game.net.reportHit(playerId, game.weapons.weaponId, { seq, pellets: 1, point, zone });
      game.net.flushShot?.();
      return seq;
    },
    holdHitmarker(on) {
      game.hud.holdHitmarker = on;
    },
    setAutoMove(m) {
      if (!m) {
        game.autoMove = null;
        return;
      }
      const f = game.player.feet;
      game.autoMove = { ...m, a: Math.atan2(f.z - m.cz, f.x - m.cx) };
    },
    traceRemote(playerId, ms) {
      return new Promise((resolve) => {
        const out: { t: number; x: number; y: number; z: number; d?: unknown }[] = [];
        const t0 = performance.now();
        const prev = game.remotes.onFrame;
        game.remotes.onFrame = (now) => {
          prev?.(now);
          const r = game.remotes.get(playerId);
          if (r) out.push({ t: now, x: r.position.x, y: r.position.y, z: r.position.z, d: game.remotes.debugOf(playerId) });
          if (now - t0 >= ms) {
            game.remotes.onFrame = prev;
            resolve(out);
          }
        };
      });
    },
    async equipPreset(cls) {
      const id = game.net.presetId?.(cls);
      if (!id || !game.net.equipWeapon) throw new Error(`no preset ${cls}`);
      await game.net.equipWeapon(id);
      return id;
    },
    meleeSwing(charge = 0) {
      if (!game.alive || game.weapons.fireMode !== 'melee') return false;
      game.rc.camera.updateMatrixWorld();
      return game.weapons.melee.startSwing(charge, true);
    },
    setBlock(on) {
      game.forceBlock = on;
      game.sendTransformNow();
    },
    freezeAnims(u) {
      game.weapons.melee.freezeU = u;
      Humanoid.freezeU = u;
    },
    equipSample(i) {
      const w = getDefaultWeapons()[i];
      game.equip(w);
      return w.name;
    },
    showTrackpadHint() {
      try {
        localStorage.removeItem('ai-gaem.trackpadHint');
      } catch {
        /* ignore */
      }
      game.showTrackpadHint();
    },
    setPadPlaying(on) {
      game.input.padPlaying = on;
    },
    emulatePointerLock(on) {
      game.input.locked = on;
    },
    perfStats() {
      const p = game.perf;
      const s = settings.current;
      return { fps: p.fps, mouseHz: p.mouseHz, maxFrameMs: p.maxFrameMs, mouseEvents: game.input.mouseEvents, sens: BASE_MOUSE_SENS * s.sensitivity };
    },
    setTrackpadMode(on) {
      settings.setTrackpadMode(on);
      game.flow.settingsPanel.sync();
    },
    netStats() {
      const st = game.net.stats?.();
      return st ? { ...st, interp: game.remotes.netStats() } : null;
    },
    generateLegacy(prompt) {
      return game.flow.legacyGenerate(prompt);
    },
    openPause() {
      game.flow.openPause();
    },
    forceScoreboard(on) {
      game.hud.forceScoreboard = on;
    },
    setAutoRun(on) {
      game.input.padPlaying = on;
      game.player.autoRun = on;
    },
    measureSpeed(ms) {
      // median of the per-frame horizontal speed (robust to a teleport / a single slow frame)
      return new Promise((resolve) => {
        const samples: number[] = [];
        const t0 = performance.now();
        const tick = () => {
          samples.push(game.player.horizontalSpeed());
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else {
            samples.sort((a, b) => a - b);
            resolve(samples[Math.floor(samples.length / 2)] ?? 0);
          }
        };
        requestAnimationFrame(tick);
      });
    },
    memStats() {
      const info = game.rc.renderer.info;
      const count = (root: THREE.Object3D) => {
        let n = 0;
        let draw = 0;
        root.traverse((o) => {
          n++;
          const d = o as THREE.Mesh & { isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
          if (d.isMesh || d.isLine || d.isPoints || d.isSprite) draw++;
        });
        return { n, draw };
      };
      const world = count(game.rc.scene);
      const view = count(game.rc.viewScene);
      // private internals, read-only (element access keeps it typed without widening visibility)
      const ws = game.weapons;
      const fx = ws.effects;
      const layers = [fx['small'], fx['big']];
      const phys = game.physics.world;
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return {
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs?.length ?? 0,
        sceneObjects: world.n,
        viewObjects: view.n,
        sceneMeshes: world.draw,
        designCache: designModelCacheStats(),
        outfitCache: outfitCacheStats(),
        projectiles: ws['projectiles'].length,
        effects: fx['items'].length,
        particles: layers.reduce((a, l) => a + l.particles.length, 0),
        remotes: game.remotes.ids().length,
        damageNumbers: game.damageNumbers.snapshot().length,
        killLog: game.killLog.length,
        domNodes: document.getElementsByTagName('*').length,
        rapierBodies: phys.bodies.len(),
        rapierColliders: phys.colliders.len(),
        jsHeap: mem ? mem.usedJSHeapSize : null,
      };
    },
    sampleCount() {
      return getDefaultWeapons().length;
    },
    killSelf() {
      game.damageLocal(1e6, 'soak test');
    },
    botsCycle(churn = false, index) {
      const bots = (game.net as unknown as { bots?: { id: string; weaponId?: string }[] }).bots;
      if (!Array.isArray(bots) || !bots.length) return false;
      const dw = getDefaultWeapons().filter((w) => w.id);
      if (dw.length) {
        botCycleN++;
        bots.forEach((b, i) => (b.weaponId = dw[(index ?? botCycleN + i * 3) % dw.length].id));
      }
      if (churn) {
        const b = bots.pop()!;
        setTimeout(() => bots.push(b), 200);
      }
      return true;
    },
    async respawnNow() {
      if (game.alive) return true;
      await game.flow['deploy'](true);
      return game.alive;
    },
    equipDesign(design, prompt = 'test design') {
      const { design: d } = sanitizeDesign(design);
      return game.flow.equipDesign(d, prompt);
    },
    equipOutfit(outfit, prompt = 'test outfit', presetId) {
      const o = outfit ? sanitizeOutfit(outfit).outfit : null;
      return game.flow.equipOutfit(o, prompt, presetId);
    },
    openCloset(mode = 'pause') {
      return game.flow.openCloset(mode, game.alive ? 'pause' : 'death');
    },
    outfitPresets() {
      return (game.net.outfitPresets?.() ?? []).map((o) => ({ id: o.id, name: o.name, maxHp: o.maxHp }));
    },
    botsOutfits(ids) {
      const bots = (game.net as unknown as { bots?: { id: string; outfitId?: string; maxHp?: number; hp: number }[] }).bots;
      if (!Array.isArray(bots) || !bots.length) return false;
      bots.forEach((b, i) => {
        b.outfitId = ids[i % ids.length];
        const o = game.net.getOutfit?.(b.outfitId);
        b.maxHp = o?.maxHp ?? 100;
        b.hp = b.maxHp;
      });
      return true;
    },
  };
  (window as unknown as { __game: GameTestHook }).__game = hook;
  return hook;
}
