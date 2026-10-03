import * as THREE from 'three';
import { MAPS, PRESET_WEAPONS, computeWeaponStats, type MapDef } from '@ai-gaem/shared';
import { createRenderer, type RenderContext } from './renderer';
import { initPhysics, FIXED_DT, type PhysicsContext } from './physics';
import { Input } from './input';
import { createTestMap } from '../map/testMap';
import { addBoundsColliders, expandBox, type BoundsBox } from '../map/bounds';
import { findGroundSpawns, loadMap } from '../map/loadMap';
import { bakeSpawns } from '../map/bakeSpawns';
import type { GameMap, Vec3 } from '../map/types';
import { getSpawnPoints, pickRandomSpawn, type SpawnPoint } from '../map/spawns';
import { PlayerController, EYE_HEIGHT } from '../player/PlayerController';
import { TargetDummies } from '../player/TargetDummies';
import { TargetRegistry } from '../weapons/targets';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { DEFAULT_WEAPONS, generateWeaponStub } from '../weapons/defaultWeapons';
import type { Weapon } from '../weapons/types';
import { Hud, esc } from '../ui/Hud';
import { SpawnEditor } from '../ui/SpawnEditor';
import { OfflineNetClient, RemotePlayers, type NetClient, type NetPlayer } from '../net';

export const MAX_HP = 100;
const NET_SEND_HZ = 15;
/** room between the scan's own bounds and the invisible wall net */
const BOUNDS_MARGIN = 0.5;

export interface GameOptions {
  /** GLB url; omitted => procedural test map */
  mapUrl?: string;
  /** offline simulated remote players */
  bots?: number;
  /** inject a network client (defaults to OfflineNetClient) */
  net?: NetClient;
  /** label shown in the scoreboard (e.g. server URI) */
  serverLabel?: string;
  /** e2e mode: never show the click-to-play overlay */
  e2e?: boolean;
  /** render the collision shell as a neutral backdrop to hide holes in a scan (default true) */
  shell?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One-line stat summary for the death screen. */
export function describeWeapon(w: Weapon): string {
  const s = computeWeaponStats(w);
  const parts = [
    `${w.class.replace(/_/g, ' ')} · ${w.fireMode}`,
    `${+w.damage.toFixed(1)}${w.pellets > 1 ? `×${w.pellets}` : ''} dmg`,
    `${+w.fireRate.toFixed(2)}/s`,
    `mag ${w.magSize}`,
    `range ${w.range}m`,
    `${s.effectiveDps.toFixed(0)} dps`,
  ];
  if (w.splashRadius > 0) parts.push(`splash ${w.splashRadius}m`);
  if (w.slowPercent > 0) parts.push(`slow ${w.slowPercent}%`);
  if (w.dotDamage > 0) parts.push(`dot ${w.dotDamage}`);
  if (w.knockback > 0) parts.push(`knockback ${w.knockback}`);
  return parts.join(' · ');
}

export class Game {
  rc!: RenderContext;
  physics!: PhysicsContext;
  input!: Input;
  map!: GameMap;
  player!: PlayerController;
  weapons!: WeaponSystem;
  hud!: Hud;
  net!: NetClient;
  remotes!: RemotePlayers;
  dummies?: TargetDummies;
  spawnEditor!: SpawnEditor;
  readonly targets = new TargetRegistry();

  hp = MAX_HP;
  alive = true;
  ready = false;
  /** last authoritative state of the local player (networked mode) */
  me?: NetPlayer;
  readonly killLog: string[] = [];
  private acc = 0;
  private last = performance.now();
  private netAcc = 0;
  private scoreAcc = 0;
  private showDebug = false;
  private fps = 0;
  private lastSpawn = new THREE.Vector3();
  private respawning = false;
  private opts: GameOptions = {};

  async start(container: HTMLElement, opts: GameOptions = {}) {
    this.opts = opts;
    this.rc = createRenderer(container);
    this.physics = await initPhysics();
    this.input = new Input(this.rc.renderer.domElement);
    this.hud = new Hud();
    if (opts.e2e) this.hud.showClickToPlay(false);

    this.net = opts.net ?? new OfflineNetClient({ bots: opts.bots ?? 0, botCenter: [0, 0, 0] });
    const online = this.net.authoritative;

    // ---- map ----
    const url = opts.mapUrl;
    const loaded = url ? await this.tryLoadMap(url) : null;
    const mapFailed = Boolean(url) && loaded === null;
    this.map = createTestMapOr(this, loaded);
    this.physics.world.step(); // build the query pipeline before the first raycast
    if (this.map.id !== 'testmap') {
      const def: MapDef | undefined = url ? Object.values(MAPS).find((m) => m.url === url) : undefined;
      if (def && def.spawns.length > 0) {
        this.map.spawns = def.spawns.map((s) => [s.x, s.y, s.z] as Vec3);
      } else {
        const guessed = findGroundSpawns(this.map, this.physics);
        if (guessed.length) this.map.spawns = guessed;
      }
    } else if (mapFailed && online) {
      this.hud.showWarning('Venue map failed to load — playing test map; spawns may be wrong');
    }

    // ---- invisible bounds walls: safety net over the holes in a scan ----
    if (this.map.id !== 'testmap') {
      const box = this.boundsBox(url);
      if (box) {
        this.map.colliders.push(...addBoundsColliders(this.physics, box));
        this.map.killY = box.min[1] - 20;
      }
    }

    // ---- dev tool: bake multi-floor spawns for a scanned map ----
    if (!online && this.map.id !== 'testmap' && new URLSearchParams(location.search).get('bakeSpawns') === '1') {
      this.debugBakeSpawns();
    }

    // ---- spawn + player (networked: moved to the server's spawn once connected) ----
    const spawn = pickRandomSpawn(this.spawnPoints());
    this.player = new PlayerController(this.physics, this.input, new THREE.Vector3(...spawn.pos));
    this.player.yaw = spawn.yaw;
    this.lastSpawn.set(...spawn.pos);

    // ---- dummies (offline only: the server doesn't know about them) ----
    if (!online) {
      const dummyPos: Vec3[] =
        this.map.id === 'testmap'
          ? [[0, 0, -8], [4, 0, -10], [-6, 0, -12], [16, 3, -22], [-20, 2, 12], [10, 0, 18]]
          : this.map.spawns.slice(0, 3).map((s) => [s[0] + 2, s[1], s[2] + 2] as Vec3);
      this.dummies = new TargetDummies(this.physics, this.rc.scene, this.targets, dummyPos);
      this.dummies.onKilled = (d) => this.hud.addKill('You', this.weapons.weapon.name, d.id);
    }

    // ---- weapons ----
    this.weapons = new WeaponSystem(
      this.physics,
      this.rc.scene,
      this.rc.camera,
      this.rc.viewScene,
      this.rc.viewCamera,
      this.targets,
      this.player.collider,
      {
        onHit: (_t, _dmg, killed) => this.hud.hitMarker(killed),
        onAmmoChanged: (a, m, r) => this.hud.setAmmo(a, m, r),
        onShot: (o, d) => this.net.fire([o.x, o.y, o.z], [d.x, d.y, d.z]),
        onReload: () => this.net.reload?.(),
      },
    );

    // ---- net ----
    this.hud.setScoreboard(online ? 'Connecting…' : null);
    await this.net.connect();
    if (!online) for (const w of DEFAULT_WEAPONS) w.id = await this.net.registerWeapon(w);
    this.remotes = new RemotePlayers(this.net, this.physics, this.rc.scene, this.targets);
    this.net.onKill?.((e) => {
      const killer = e.killerId === this.net.localId ? 'You' : e.killerName;
      const victim = e.victimId === this.net.localId ? 'You' : e.victimName;
      this.killLog.push(`${killer} [${e.weaponName}] ${victim}`);
      if (e.victimId === this.net.localId) this.hud.setDeathMessage(`Killed by ${e.killerName} [${e.weaponName}]`);
      this.hud.addKill(killer, e.weaponName, victim);
    });

    if (online) {
      this.net.onLocalChanged?.((me) => this.applyLocalState(me));
      this.net.onWeaponsChanged?.(() => this.syncWeapon());
      this.net.onLocalHit?.((e) => {
        if (e.knock.some((k) => k !== 0)) this.player.applyImpulse(new THREE.Vector3(...e.knock));
        if (!e.dot) this.hud.damageFlash();
      });
      this.net.onShot?.((e) => {
        const w = this.net.getWeapon?.(e.weaponId) ?? PRESET_WEAPONS.pistol;
        this.weapons.playRemoteShot(
          w,
          new THREE.Vector3(...e.origin),
          new THREE.Vector3(...e.dir),
          this.remotes.colliderOf(e.shooterId),
        );
      });
      const me = this.net.getLocal?.();
      if (me) {
        this.teleportTo(me.pos, me.yaw);
        this.applyLocalState(me);
      }
      this.syncWeapon(true);
    } else {
      this.net.onLocalChanged?.((me) => {
        if (me.hp < this.hp) this.hud.damageFlash();
        this.hp = me.hp;
        this.hud.setHealth(this.hp);
        if (!me.alive && this.alive) this.die('Killed');
      });
      this.equip(DEFAULT_WEAPONS[0]);
    }

    // ---- UI wiring ----
    this.spawnEditor = new SpawnEditor(this.map.id, this.rc.scene, this.input, this.hud, () => ({
      feet: this.player.feet,
      yaw: this.player.yaw,
    }));
    this.hud.setHealth(this.hp);
    this.hud.onClickToPlay(() => this.input.requestLock());
    this.input.onLockChange((locked) => {
      if (this.alive && !this.opts.e2e) this.hud.showClickToPlay(!locked);
    });
    this.hud.deathHandlers = {
      onKeepLoadout: () => {
        if (online) {
          void this.requestRespawn(true);
          return;
        }
        this.net.respawn(true);
        this.respawn();
      },
      onGenerateWeapon: async (prompt) => {
        if (online && this.net.generateWeapon) {
          await this.generateAndRespawn(prompt);
          return;
        }
        // offline: local stub
        const w = await generateWeaponStub(prompt);
        w.id = await this.net.registerWeapon(w);
        this.net.respawn(false);
        this.equip(w);
        this.respawn();
      },
    };

    this.ready = true;
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ networked state

  private applyLocalState(me: NetPlayer) {
    const prev = this.me;
    this.me = me;
    if (me.hp < this.hp && me.alive) this.hud.damageFlash();
    this.hp = me.hp;
    this.hud.setHealth(this.hp);
    if (!me.alive && this.alive) {
      this.die('Killed');
    } else if (me.alive && !this.alive) {
      // server respawned us: move to the server-chosen spawn point
      this.teleportTo(me.pos, me.yaw);
      this.respawn(false);
    }
    if (!prev || prev.weaponId !== me.weaponId) this.syncWeapon(true);
  }

  /** equip the weapon the server says we hold (when its row is known) */
  private syncWeapon(force = false) {
    const id = this.me?.weaponId;
    if (!id) return;
    if (!force && this.weapons.weapon?.id === id) return;
    const w = this.net.getWeapon?.(id);
    if (w && this.weapons.weapon?.id !== id) this.equip(w);
  }

  private teleportTo(pos: Vec3, yaw?: number) {
    const v = new THREE.Vector3(...pos);
    this.player.teleport(v, yaw);
    this.lastSpawn.copy(v);
    this.sendTransformNow();
  }

  sendTransformNow() {
    const f = this.player.feet;
    this.net.sendTransform([f.x, f.y, f.z], this.player.yaw, this.player.pitch, true);
  }

  /** wait for the server's respawn timer, then call respawn (retrying on clock skew) */
  async requestRespawn(keepLoadout: boolean) {
    if (this.respawning || this.alive) return;
    this.respawning = true;
    this.hud.setGenerating(true, 'Respawning…');
    try {
      const wait = (this.me?.respawnAt ?? 0) - Date.now();
      if (wait > 0) await sleep(wait + 50);
      const net = this.net as NetClient & { respawnAsync?(k: boolean): Promise<void> };
      for (let i = 0; i < 40 && !this.alive; i++) {
        try {
          if (net.respawnAsync) await net.respawnAsync(keepLoadout);
          else net.respawn(keepLoadout);
          break;
        } catch (err) {
          if (!String((err as Error)?.message ?? err).includes('not ready')) {
            console.warn('[game] respawn failed', err);
          }
          await sleep(250);
        }
      }
      // the player row update (alive = true) triggers the local respawn
      for (let i = 0; i < 100 && !this.alive; i++) await sleep(50);
    } finally {
      this.respawning = false;
      this.hud.setGenerating(false);
    }
  }

  private async generateAndRespawn(prompt: string) {
    const text = prompt.trim() || 'surprise me';
    this.hud.setGenerating(true);
    this.hud.setGenStatus(`Generating “${esc(text)}”…`);
    try {
      const res = await this.net.generateWeapon!(text, '');
      if (!res.ok) {
        this.hud.setGenStatus(esc(res.message || 'generation failed'), true);
        return;
      }
      const w = res.weapon;
      this.hud.setGenStatus(
        w
          ? `<span class="gen-name">${esc(w.name)}</span><span class="gen-stats">${esc(describeWeapon(w))}</span><span class="gen-msg">${esc(res.message)}</span>`
          : `weapon #${esc(res.weaponId)} (${esc(res.message)})`,
      );
      // generate_weapon already equipped it server-side (we're dead): respawn keeping it
      await this.requestRespawn(true);
    } catch (err) {
      console.error('[game] generate failed', err);
      this.hud.setGenStatus(esc(`Generation failed: ${String((err as Error)?.message ?? err)}`), true);
    } finally {
      this.hud.setGenerating(false);
    }
  }

  // ------------------------------------------------------------------ helpers

  /** Box the invisible wall net wraps for a scanned map: venue MapDef → scan bbox (T-004) → drawn geometry. */
  private boundsBox(url?: string): BoundsBox | null {
    const def: MapDef | undefined = url ? Object.values(MAPS).find((m) => m.url === url) : undefined;
    const meta = (this.map as GameMap & { meta?: { bbox?: unknown } }).meta;
    const box = toBoundsBox(def?.bounds) ?? toBoundsBox(meta?.bbox) ?? this.visualBox();
    return box ? expandBox(box, BOUNDS_MARGIN) : null;
  }

  /** bbox of the rendered scan: its own root object when it exposes one, else everything in the scene */
  private visualBox(): BoundsBox | null {
    const map = this.map as GameMap & { root?: THREE.Object3D };
    const bbox = new THREE.Box3().setFromObject(map.root ?? this.rc.scene);
    if (bbox.isEmpty()) return null;
    return { min: [bbox.min.x, bbox.min.y, bbox.min.z], max: [bbox.max.x, bbox.max.y, bbox.max.z] };
  }

  private async tryLoadMap(url: string): Promise<GameMap | null> {
    try {
      return await loadMap(url, this.physics, this.rc.scene, { shell: this.opts.shell });
    } catch (err) {
      console.warn('[game] map load failed, using test map', err);
      return null;
    }
  }

  /** dev tool (`?bakeSpawns=1`): bake spawn candidates for this map and mark them in the scene */
  private debugBakeSpawns() {
    const baked = bakeSpawns(this.map, this.physics);
    console.log(`[bakeSpawns] ${baked.length} candidate${baked.length === 1 ? '' : 's'} for "${this.map.id}"`);
    console.log(`[bakeSpawns] paste into MAPS.${this.map.id}.spawns:`);
    console.log(JSON.stringify(baked, null, 2));

    const geo = new THREE.SphereGeometry(0.2, 10, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x37ff9b, depthTest: false, transparent: true, opacity: 0.9 });
    for (const s of baked) {
      const marker = new THREE.Mesh(geo, mat);
      marker.position.set(s.x, s.y + 0.9, s.z);
      marker.renderOrder = 999;
      this.rc.scene.add(marker);
    }
  }

  spawnPoints(): SpawnPoint[] {
    return getSpawnPoints(this.map.id, this.map.spawns);
  }

  equip(w: Weapon) {
    this.weapons.setWeapon(w);
    this.hud.setWeaponName(w.name);
  }

  die(message = '') {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.hud.setHealth(0);
    this.player.inputEnabled = false;
    this.player.frozen = true;
    this.input.exitLock();
    this.hud.showClickToPlay(false);
    this.hud.showDeath(true, message);
  }

  /** local respawn. `pickSpawn` = choose a local spawn point (offline); networked mode teleports first. */
  respawn(pickSpawn = true) {
    if (pickSpawn) {
      const sp = pickRandomSpawn(this.spawnPoints());
      this.player.teleport(new THREE.Vector3(...sp.pos), sp.yaw);
    }
    this.player.inputEnabled = true;
    this.player.frozen = false;
    this.hp = this.me?.hp ?? MAX_HP;
    this.hud.setHealth(this.hp);
    this.weapons.refill();
    this.alive = true;
    this.hud.showDeath(false);
    if (!this.opts.e2e) this.input.requestLock();
  }

  /** local damage (debug / environmental); server damage comes via onLocalChanged */
  damageLocal(amount: number, reason = '') {
    if (!this.alive) return;
    this.hp -= amount;
    this.hud.damageFlash();
    this.hud.setHealth(this.hp);
    if (this.hp <= 0) this.die(reason);
  }

  /** point the camera from the eye toward a world position */
  lookAt(target: THREE.Vector3) {
    const eye = this.player.feet.clone();
    eye.y += EYE_HEIGHT;
    const d = target.clone().sub(eye);
    if (d.lengthSq() < 1e-6) return;
    d.normalize();
    this.player.yaw = Math.atan2(-d.x, -d.z);
    this.player.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    this.player.updateCamera(this.rc.camera, 1);
    this.rc.camera.updateMatrixWorld();
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
    const { input, player } = this;
    const online = this.net.authoritative;

    // debug keys (offline only: the server owns weapons and hp online)
    if (input.locked && !online) {
      for (let i = 0; i < DEFAULT_WEAPONS.length; i++) if (input.wasPressed(`Digit${i + 1}`)) this.equip(DEFAULT_WEAPONS[i]);
      if (input.wasPressed('KeyK')) this.damageLocal(MAX_HP, 'You pressed K');
    }
    if (input.wasPressed('F3')) this.showDebug = !this.showDebug;
    this.spawnEditor.update();

    // server slow effect
    const me = this.me;
    player.speedScale = me && (me.slowPercent ?? 0) > 0 && Date.now() < (me.slowUntil ?? 0) ? 1 - (me.slowPercent ?? 0) / 100 : 1;

    // look every frame, simulate at a fixed rate
    const md = input.locked ? player.look() : (input.consumeMouse(), { dx: 0, dy: 0 });
    player.inputEnabled = this.alive && input.locked;
    this.acc += dt;
    while (this.acc >= FIXED_DT) {
      player.fixedUpdate(FIXED_DT);
      this.physics.world.step();
      this.acc -= FIXED_DT;
    }
    player.updateCamera(this.rc.camera, this.acc / FIXED_DT);
    this.rc.camera.updateMatrixWorld();

    if (this.alive && player.feet.y < this.map.killY) {
      if (online) this.player.teleport(this.lastSpawn.clone());
      else this.damageLocal(MAX_HP, 'Fell out of the world');
    }

    this.weapons.viewmodel.addSway(md.dx, md.dy);
    this.weapons.viewmodel.update(dt, player.horizontalSpeed(), player.grounded);
    this.weapons.update(dt, input, this.alive && input.locked);
    this.dummies?.update(dt, this.rc.camera);
    this.remotes.update(dt);
    this.hud.update(dt);

    this.netAcc += dt;
    if (this.netAcc >= 1 / NET_SEND_HZ) {
      this.netAcc = 0;
      if (this.alive) {
        const f = player.feet;
        this.net.sendTransform([f.x, f.y, f.z], player.yaw, player.pitch);
      }
    }

    if (online) {
      if (!this.alive && me?.respawnAt) this.hud.setRespawnCountdown((me.respawnAt - Date.now()) / 1000);
      this.scoreAcc += dt;
      if (this.scoreAcc > 0.5) {
        this.scoreAcc = 0;
        const n = this.remotes.ids().length;
        const connected = (this.net as NetClient & { connected?: boolean }).connected !== false;
        this.hud.setScoreboard(
          `${me?.name ?? '?'}   K ${me?.kills ?? 0} / D ${me?.deaths ?? 0}\n` +
            `${n} other player${n === 1 ? '' : 's'} online\n` +
            `${connected ? '●' : '○'} ${this.opts.serverLabel ?? 'server'}`,
          connected,
        );
      }
    }

    if (this.showDebug) {
      const f = player.feet;
      this.hud.setDebug(
        `fps ${this.fps.toFixed(0)}\npos ${f.x.toFixed(2)} ${f.y.toFixed(2)} ${f.z.toFixed(2)}\n` +
          `vel ${player.horizontalSpeed().toFixed(2)} vy ${player.velocity.y.toFixed(2)}\ngrounded ${player.grounded}\n` +
          `map ${this.map.id}  weapon ${this.weapons.weapon.name} (${this.weapons.fireMode})`,
      );
    } else this.hud.setDebug(null);

    this.rc.render();
    input.endFrame();
  };
}

/** glTF extras are untyped JSON: a box only counts when it really is a numeric min/max pair */
function toBoundsBox(raw: unknown): BoundsBox | null {
  if (!raw || typeof raw !== 'object') return null;
  const { min, max } = raw as { min?: unknown; max?: unknown };
  if (!isVec3(min) || !isVec3(max)) return null;
  return { min, max };
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n: unknown) => typeof n === 'number' && Number.isFinite(n));
}

function createTestMapOr(game: Game, loaded: GameMap | null): GameMap {
  return loaded ?? createTestMap(game.physics, game.rc.scene);
}
