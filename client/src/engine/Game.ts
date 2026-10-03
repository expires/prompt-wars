import * as THREE from 'three';
import { BLOCK_MOVE_MULT, MAPS, PRESET_WEAPONS, computeWeaponStats, meleeMetaOf, type MapDef } from '@ai-gaem/shared';
import { createRenderer, type RenderContext } from './renderer';
import { initPhysics, FIXED_DT, type PhysicsContext } from './physics';
import { Input } from './input';
import { createTestMap } from '../map/testMap';
import { addBoundsColliders, expandBox, type BoundsBox } from '../map/bounds';
import { findGroundSpawns, loadMap } from '../map/loadMap';
import { bakeSpawns } from '../map/bakeSpawns';
import type { GameMap, Vec3 } from '../map/types';
import { getSpawnPoints, pickRandomSpawn, type SpawnPoint } from '../map/spawns';
import { PlayerController } from '../player/PlayerController';
import { CameraRig } from '../player/CameraRig';
import { Sfx } from '../audio/Sfx';
import { settings } from '../settings';
import { TargetDummies } from '../player/TargetDummies';
import { TargetRegistry } from '../weapons/targets';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { getDefaultWeapons, generateWeaponStub, loadMeleeSamples } from '../weapons/defaultWeapons';
import { meleeMaterial } from '../weapons/MeleeSystem';
import type { Weapon } from '../weapons/types';
import { loadPartsLibrary } from '../weapons/partsLibrary';
import { loadTemplates, warmTemplates } from '../weapons/templatesLibrary';
import { Hud, esc } from '../ui/Hud';
import { SpawnEditor } from '../ui/SpawnEditor';
import { OfflineNetClient, PoseSender, RemotePlayers, type NetClient, type NetPlayer } from '../net';
import { DamageNumbers } from '../ui/DamageNumbers';

export const MAX_HP = 100;
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
  readonly rig = new CameraRig();
  readonly sfx = new Sfx();
  /** 0..1 ADS blend */
  ads = 0;
  /** test hook: force the melee block on / off (null = F / RB) */
  forceBlock: boolean | null = null;
  /** test hook / scripted override for ADS (null = right mouse) */
  forceAds: boolean | null = null;
  private adsToggled = false;
  poseSender!: PoseSender;
  damageNumbers!: DamageNumbers;
  /** test hook: scripted circular movement (smoothness test) */
  autoMove: { cx: number; cz: number; r: number; speed: number; y: number; a: number } | null = null;

  hp = MAX_HP;
  alive = true;
  ready = false;
  /** last authoritative state of the local player (networked mode) */
  me?: NetPlayer;
  readonly killLog: string[] = [];
  private acc = 0;
  /** simulation clock (ms) for pose timestamps: advances exactly FIXED_DT per step */
  private simT: number | null = null;
  private last = performance.now();
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
    this.poseSender = new PoseSender(this.net);
    this.damageNumbers = new DamageNumbers(this.hud.numbersLayer);

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
    this.player.onJump = () => this.sfx.jump();
    this.player.onLand = (v) => {
      this.rig.land(v);
      this.sfx.land(v);
    };
    this.rig.onStep = (speed) => this.sfx.footstep(speed, this.player.crouched);
    this.sfx.setListener(this.rc.camera);
    this.lastSpawn.set(...spawn.pos);

    // ---- dummies (offline only: the server doesn't know about them) ----
    if (!online) {
      const dummyPos: Vec3[] =
        this.map.id === 'testmap'
          ? [[0, 0, -8], [4, 0, -10], [-6, 0, -12], [16, 3, -22], [-20, 2, 12], [10, 0, 18]]
          : this.map.spawns.slice(0, 3).map((s) => [s[0] + 2, s[1], s[2] + 2] as Vec3);
      this.dummies = new TargetDummies(this.physics, this.rc.scene, this.targets, dummyPos);
      this.dummies.onKilled = (d) => this.hud.addKill('You', this.weapons.weapon.name, d.id, this.lastHitHead);
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
        onHit: (_t, _dmg, killed, zone) => {
          const head = zone === 1;
          this.lastHitHead = head;
          this.hud.hitMarker(killed, head);
          if (head) this.sfx.headshotDing();
          else this.sfx.hitTick();
          if (killed) this.sfx.killChime();
        },
        onAmmoChanged: (a, m, r) => this.hud.setAmmo(a, m, r),
        onShot: (o, d, melee) => this.net.fire([o.x, o.y, o.z], [d.x, d.y, d.z], melee),
        onMeleeSwing: (meta, charge) => {
          this.sfx.meleeSwing(meta.weight, charge > 0);
          this.rig.shake((meta.weight === 'heavy' ? 0.7 : meta.weight === 'medium' ? 0.35 : 0.18) * (charge > 0 ? 1.6 : 1));
        },
        onMeleeContact: (meta, charge, dir, _point, head) => {
          const w = this.weapons.weapon;
          this.sfx.meleeImpact(meleeMaterial(w), meta.weight, head);
          // camera punch along the swing
          const k = (meta.weight === 'heavy' ? 1.6 : meta.weight === 'medium' ? 1.1 : 0.7) * (charge > 0 ? 1.4 : 1);
          if (meta.swing === 'overhead') this.rig.kick(-k, 0);
          else if (meta.swing === 'thrust' || meta.swing === 'bash') this.rig.kick(-0.5 * k, 0);
          else {
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.rc.camera.quaternion);
            this.rig.kick(-0.25 * k, (dir.dot(right) > 0 ? -1 : 1) * k);
          }
          this.rig.shake(0.5 * k);
          // heavy hits carry you forward a little
          if (meta.weight === 'heavy' || charge > 0) {
            const f = new THREE.Vector3(-Math.sin(this.player.yaw), 0, -Math.cos(this.player.yaw));
            this.player.applyImpulse(f.multiplyScalar(meta.weight === 'heavy' ? 2.5 : 1.6));
          }
        },
        onMeleeWorld: (meta) => {
          this.sfx.meleeImpact('blunt', meta.weight);
          this.rig.shake(0.3);
        },
        onShotEnd: () => this.net.flushShot?.(),
        onFire: (w) => this.sfx.gunshot(w.class),
        onRecoil: (p, y) => this.rig.kick(p, y),
        onExplosion: (pos) => this.sfx.explosion(pos),
        onReload: () => {
          this.sfx.reload();
          this.net.reload?.();
        },
      },
    );

    // ---- net ----
    this.hud.setScoreboard(online ? 'Connecting…' : null);
    await this.net.connect();
    if (!online) {
      for (const w of getDefaultWeapons()) w.id = await this.net.registerWeapon(w);
      // the melee samples come from the (lazily loaded) template library: append them when ready
      void loadPartsLibrary()
        .then(() => loadMeleeSamples())
        .then(async (melee) => {
          for (const w of melee) {
            w.id = await this.net.registerWeapon(w);
            getDefaultWeapons().push(w);
          }
        })
        .catch((err) => console.warn('[weapons] melee samples unavailable', err));
    }
    this.remotes = new RemotePlayers(this.net, this.physics, this.rc.scene, this.targets);
    this.net.onKill?.((e) => {
      const killer = e.killerId === this.net.localId ? 'You' : e.killerName;
      const victim = e.victimId === this.net.localId ? 'You' : e.victimName;
      this.killLog.push(`${killer} [${e.weaponName}] ${victim}`);
      if (e.victimId === this.net.localId) this.hud.setDeathMessage(`Killed by ${e.killerName} [${e.weaponName}]`);
      this.hud.addKill(killer, e.weaponName, victim, !!e.headshot);
    });
    // server-confirmed damage by us: aggregated damage numbers; kills get the kill X + chime
    // (the optimistic hitmarker shows on the local raycast and never knows about kills online)
    this.net.onHitConfirmed?.((e) => {
      const at = e.point ? new THREE.Vector3(...e.point) : (this.remotes.headOf(e.targetId) ?? new THREE.Vector3());
      this.damageNumbers.add(e.targetId, e.damage, at, { headshot: e.headshot, killed: e.killed });
      if (e.blocked) this.sfx.blockClang(at);
      if (e.killed) {
        this.hud.hitMarker(true, e.headshot);
        this.hud.killConfirm(e.headshot);
        this.sfx.killChime();
      }
    });

    if (online) {
      this.net.onLocalChanged?.((me) => this.applyLocalState(me));
      this.net.onWeaponsChanged?.(() => this.syncWeapon());
      this.net.onLocalHit?.((e) => {
        if (e.knock.some((k) => k !== 0)) this.player.applyImpulse(new THREE.Vector3(...e.knock));
        if (e.blocked) this.sfx.blockClang();
        if (!e.dot) this.hud.damageFlash();
      });
      this.net.onShot?.((e) => {
        const w = this.net.getWeapon?.(e.weaponId) ?? PRESET_WEAPONS.pistol;
        const origin = new THREE.Vector3(...e.origin);
        // third person: swing animation (melee) / recoil pose (guns)
        this.remotes.playShot(e.shooterId, w, e.charge ?? 0, e.combo ?? 0);
        if (w.fireMode === 'melee') {
          this.sfx.meleeSwing(meleeMetaOf(w).weight, (e.charge ?? 0) > 0, origin);
          return;
        }
        this.weapons.playRemoteShot(w, origin, new THREE.Vector3(...e.dir), this.remotes.collidersOf(e.shooterId));
        this.sfx.gunshot(w.class, origin);
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
      this.equip(getDefaultWeapons()[0]);
    }

    // ---- UI wiring ----
    this.spawnEditor = new SpawnEditor(this.map.id, this.rc.scene, this.input, this.hud, () => ({
      feet: this.player.feet,
      yaw: this.player.yaw,
    }));
    this.hud.setHealth(this.hp);
    this.hud.onClickToPlay(() => this.input.requestLock());
    this.input.onLockChange((locked) => {
      if (this.alive && !this.opts.e2e) this.hud.showClickToPlay(!locked && !this.input.padPlaying);
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

    // Playable now. Fetch the part library (real weapon models replace the placeholders), then
    // prefetch the template generator chunk at idle priority (needed when generating a weapon).
    void loadPartsLibrary()
      .then(() => idle(() => void loadTemplates().catch(() => {})))
      .catch((err) => console.warn('[parts] library failed to load', err));
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
      this.respawn(false);
      this.teleportTo(me.pos, me.yaw);
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
    this.poseSender.markTeleport();
    this.sendTransformNow();
  }

  /** current pose for the network */
  private poseInput() {
    const p = this.player;
    const f = p.feet;
    const blocking = this.weapons.fireMode === 'melee' && this.weapons.melee.blocking;
    return { pos: [f.x, f.y, f.z] as Vec3, yaw: p.yaw, pitch: p.pitch, crouching: p.crouched, grounded: p.grounded, blocking };
  }

  /** send the pose right away (teleports, test hooks); regular sends happen in the fixed step */
  sendTransformNow() {
    if (!this.alive) return;
    this.poseSender.forceNext();
    this.poseSender.step(this.poseInput(), this.simT ?? performance.now(), FIXED_DT);
  }

  /** test hook teleport: a discontinuity remotes should snap to */
  teleportLocal(pos: Vec3, yaw?: number) {
    this.autoMove = null;
    this.teleportTo(pos, yaw);
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
    this.poseSender.reset();
    this.hp = 0;
    this.hud.setHealth(0);
    this.player.inputEnabled = false;
    this.player.frozen = true;
    this.input.exitLock();
    this.hud.showClickToPlay(false);
    this.hud.showDeath(true, message);
    // the death screen offers weapon generation: get the template library ready
    void warmTemplates().catch((err) => console.warn('[templates] failed to load', err));
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

  /** point the camera from the eye toward a world position (clears recoil punch / head bob offsets) */
  lookAt(target: THREE.Vector3) {
    const eye = this.player.eye();
    const d = target.clone().sub(eye);
    if (d.lengthSq() < 1e-6) return;
    d.normalize();
    this.player.yaw = Math.atan2(-d.x, -d.z);
    this.player.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    this.rig.resetPunch();
    this.player.updateCamera(this.rc.camera, 1);
    this.rc.camera.updateMatrixWorld();
  }

  private lastHitHead = false;

  /** gamepad aim slowdown: look speed x0.55 while the crosshair is over a remote player */
  private aimSlowdown(pad: { connected: boolean; look: [number, number] }): number {
    if (!pad.connected || !settings.current.gamepadAimSlowdown || (pad.look[0] === 0 && pad.look[1] === 0) || !this.ready) return 1;
    const cam = this.rc.camera;
    const o = cam.getWorldPosition(new THREE.Vector3());
    const d = cam.getWorldDirection(new THREE.Vector3());
    const hit = this.weapons.raycast(o, d, 80);
    const t = hit ? this.targets.fromCollider(hit.collider) : undefined;
    return t && t.alive() ? 0.55 : 1;
  }

  // ---- trackpad detection: the OS disables the touchpad while keys are held ----
  private tpHoldStart = 0;
  private tpMouseAtStart = 0;
  private tpRelease = 0;
  private tpCount = 0;
  private tpShown = false;

  /**
   * Heuristic: movement keys held > 400 ms with no mouse movement while locked, and the mouse
   * moves again right after the keys are released. After 3 such occurrences, suggest trackpad
   * mode once (remembered in localStorage).
   */
  private updateTrackpadHint(now: number) {
    const input = this.input;
    if (this.tpShown || settings.current.trackpadMode || !input.locked) return;
    const held = input.movementKeysHeld();
    if (held && !this.tpHoldStart) {
      this.tpHoldStart = now;
      this.tpMouseAtStart = input.lastMouseMoveAt;
    } else if (!held && this.tpHoldStart) {
      const noMouse = input.lastMouseMoveAt <= this.tpMouseAtStart;
      if (now - this.tpHoldStart > 400 && noMouse) this.tpRelease = now;
      this.tpHoldStart = 0;
    }
    if (this.tpRelease) {
      if (input.lastMouseMoveAt > this.tpRelease) {
        this.tpCount++;
        this.tpRelease = 0;
      } else if (now - this.tpRelease > 700) this.tpRelease = 0;
    }
    if (this.tpCount >= 3) this.showTrackpadHint();
  }

  /** one-time toast suggesting trackpad mode */
  showTrackpadHint() {
    this.tpShown = true;
    try {
      if (localStorage.getItem('ai-gaem.trackpadHint') === '1') return;
      localStorage.setItem('ai-gaem.trackpadHint', '1');
    } catch {
      /* storage unavailable */
    }
    this.hud.toast('Looks like your touchpad stops while keys are held. <b>Trackpad mode</b>: T autorun, toggle crouch / sprint / aim, arrow / Q E turning.', {
      ms: 12000,
      action: { label: 'Enable trackpad mode', onClick: () => {
        settings.setTrackpadMode(true);
        this.hud.settingsPanel.sync();
      } },
    });
  }

  /** F3: network section (RTT, interpolation delay / jitter, send rate, buffered snapshots) */
  private netDebugText(): string {
    const st = this.net.stats?.();
    if (!st) return '';
    const ip = this.remotes.netStats();
    const calls = Object.entries(st.calls)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    return (
      `\n— net —\nrtt ${st.rtt.toFixed(0)} ms   send ${st.sendHz} Hz` +
      (ip
        ? `\ninterp ${ip.delay.toFixed(0)} ms (target ${ip.targetDelay.toFixed(0)})  jitter ${ip.jitter.toFixed(0)} ms\n` +
          `snapshots buffered ${ip.buffered.toFixed(1)}  remote send interval ${ip.interval.toFixed(0)} ms  (${ip.remotes} remote)`
        : '\nno remote players') +
      `\ncalls ${calls}`
    );
  }

  /** crosshair gap from the current spread; ADS hides the lines (scoped weapons show the scope) */
  private updateCrosshair() {
    const cam = this.rc.camera;
    const spread = this.weapons.currentSpread();
    const half = (cam.fov * Math.PI) / 360;
    const px = (Math.tan((spread * Math.PI) / 180) / Math.tan(half)) * (window.innerHeight / 2);
    this.hud.setCrosshairGap(3 + px);
    const mode = this.weapons.fireMode;
    const scoped = this.weapons.viewmodel.hideWhenAimed && this.ads > 0.95;
    this.hud.showScope(scoped && this.alive);
    this.hud.setCrosshairVisible(this.ads < 0.5 && mode !== 'melee', !scoped);
  }

  /** ADS state for this frame: hold / toggle right mouse, cancelled by sprint, reload, melee, death */
  private updateAds(dt: number, canAct: boolean) {
    const input = this.input;
    const h = this.weapons.handling;
    if (settings.current.adsToggle) {
      if (input.wasRightClicked()) this.adsToggled = !this.adsToggled;
    } else this.adsToggled = false;
    const wanted = this.forceAds ?? ((settings.current.adsToggle ? this.adsToggled : input.rightDown) || input.pad.ads);
    const allowed = h.canAds && (canAct || this.forceAds !== null) && !this.weapons.reloading;
    const target = wanted && allowed && !(this.player.sprinting && this.forceAds === null);
    if (!allowed) this.adsToggled = false;
    this.player.aiming = target;
    // ADS in ~0.15 s (scoped weapons a little slower), out a bit faster
    const inTime = this.weapons.weapon.class === 'sniper' ? 0.22 : 0.15;
    const rate = target ? 1 / inTime : 1 / 0.12;
    this.ads = target ? Math.min(1, this.ads + dt * rate) : Math.max(0, this.ads - dt * rate);
  }

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
    const { input, player } = this;
    const online = this.net.authoritative;

    // gamepad: Start toggles pad play (no pointer lock needed) / the pause menu
    const pad = input.pollGamepad(settings.current.gamepadDeadzone);
    if (pad.connected && this.alive) {
      if (input.padPlaying && pad.startPressed) {
        input.padPlaying = false;
        if (!this.opts.e2e) this.hud.showClickToPlay(!input.locked);
      } else if (!input.padPlaying && !input.locked && (pad.startPressed || pad.jumpPressed)) {
        input.padPlaying = true;
        this.hud.showClickToPlay(false);
      }
    }
    this.updateTrackpadHint(now);

    // debug keys (offline only: the server owns weapons and hp online)
    if (input.active && !online) {
      const dw = getDefaultWeapons();
      for (let i = 0; i < dw.length && i < 10; i++) if (input.wasPressed(`Digit${(i + 1) % 10}`)) this.equip(dw[i]);
      if (input.wasPressed('KeyK')) this.damageLocal(MAX_HP, 'You pressed K');
    }
    if (input.wasPressed('F3')) this.showDebug = !this.showDebug;
    this.spawnEditor.update();

    // server slow effect
    const me = this.me;
    player.speedScale = me && (me.slowPercent ?? 0) > 0 && Date.now() < (me.slowUntil ?? 0) ? 1 - (me.slowPercent ?? 0) / 100 : 1;

    // look every frame, simulate at a fixed rate
    const canAct = this.alive && input.active;
    player.inputEnabled = canAct;
    this.updateAds(dt, canAct);
    const melee = this.weapons.fireMode === 'melee';
    const actions = {
      fire: input.mouseDown || pad.fire,
      reload: input.wasPressed('KeyR') || pad.reloadPressed,
      heavy: melee && (input.rightDown || pad.ads),
      block: melee && (this.forceBlock ?? (input.isDown('KeyF') || pad.block)),
      blockForced: this.forceBlock !== null,
    };
    // shooting cancels sprint (you can't fire mid-sprint; the shot goes out as the sprint ends)
    if (canAct && actions.fire && player.sprinting) player.blockSprint();
    // blocking slows you down
    player.moveMult = melee && this.weapons.melee.blocking ? BLOCK_MOVE_MULT : 1;
    player.aimSlow = this.aimSlowdown(pad);
    const md = input.active ? player.frameInput(dt, this.rig.fovScale) : (input.consumeMouse(), { dx: 0, dy: 0 });
    this.acc += dt;
    while (this.acc >= FIXED_DT) {
      const am = this.autoMove;
      if (am && this.alive) {
        // scripted constant-speed circle (smoothness test), instead of input-driven movement
        am.a += (am.speed / am.r) * FIXED_DT;
        const w = am.speed;
        player.scriptedStep(
          new THREE.Vector3(am.cx + Math.cos(am.a) * am.r, am.y, am.cz + Math.sin(am.a) * am.r),
          new THREE.Vector3(-Math.sin(am.a) * w, 0, Math.cos(am.a) * w),
        );
        player.yaw = Math.atan2(Math.sin(am.a), -Math.cos(am.a));
      } else player.fixedUpdate(FIXED_DT);
      this.physics.world.step();
      this.acc -= FIXED_DT;
      // network: decided per fixed step, stamped with simulation time (uniform spacing that matches
      // the positions), re-anchored when it drifts from real time (frames > 100 ms are clamped, so
      // the simulation then runs slower than real time; receivers estimate our clock offset)
      const real = now - this.acc * 1000;
      this.simT = this.simT === null ? real : this.simT + FIXED_DT * 1000;
      if (Math.abs(this.simT - real) > 60) this.simT = real;
      if (this.alive) this.poseSender.step(this.poseInput(), this.simT, FIXED_DT);
    }
    const cam = this.rc.camera;
    player.updateCamera(cam, this.acc / FIXED_DT, dt);
    const speed = player.horizontalSpeed();
    const adsZoom = this.weapons.handling.adsZoom;
    const feel = { speed, grounded: player.grounded, sprinting: player.sprinting, crouched: player.crouched, ads: this.ads, adsZoom };
    this.rig.update(dt, feel);
    this.rig.apply(cam, feel);
    cam.updateMatrixWorld();

    if (this.alive && player.feet.y < this.map.killY) {
      if (online) {
        this.player.teleport(this.lastSpawn.clone());
        this.poseSender.markTeleport();
      } else this.damageLocal(MAX_HP, 'Fell out of the world');
    }

    // camera-space strafe velocity (viewmodel inertia)
    const strafe = player.velocity.x * Math.cos(player.yaw) - player.velocity.z * Math.sin(player.yaw);
    this.weapons.viewmodel.addSway(md.dx, md.dy);
    this.weapons.viewmodel.update(dt, {
      speed,
      grounded: player.grounded,
      ads: this.ads,
      sprinting: player.sprinting,
      crouched: player.crouched,
      strafe,
      dip: this.rig.dipOffset,
      melee: this.weapons.meleeView(),
      shield: this.weapons.melee.shield,
    });
    this.weapons.moveState = { speed, grounded: player.grounded, crouched: player.crouched, ads: this.ads };
    this.weapons.update(dt, input, canAct, actions);
    this.hud.setCharge(melee ? this.weapons.melee.chargeFraction : 0);
    this.hud.setStatus(
      melee && this.weapons.melee.blocking
        ? 'BLOCKING'
        : player.autoRun
          ? 'AUTORUN · W / S to stop'
          : settings.current.trackpadMode && this.alive
            ? 'T = autorun'
            : '',
    );
    this.updateCrosshair();
    this.dummies?.update(dt, this.rc.camera);
    this.remotes.update(dt, now);
    this.damageNumbers.update(dt, cam, (id) => this.remotes.headOf(id));
    this.hud.update(dt);

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
          `vel ${player.horizontalSpeed().toFixed(2)} vy ${player.velocity.y.toFixed(2)}\ngrounded ${player.grounded}` +
          `  crouch ${player.crouched}  sprint ${player.sprinting}\n` +
          `spread ${this.weapons.currentSpread().toFixed(2)}°  bloom ${this.weapons.bloom.toFixed(2)}  ads ${this.ads.toFixed(2)}  fov ${cam.fov.toFixed(1)}\n` +
          `map ${this.map.id}  weapon ${this.weapons.weapon.name} (${this.weapons.fireMode})` +
          this.netDebugText(),
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

/** run when the browser is idle (falls back to a timeout) */
function idle(cb: () => void) {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(cb, { timeout: 5000 });
  else setTimeout(cb, 1000);
}
