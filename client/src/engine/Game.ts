import * as THREE from 'three';
import { PRESET_WEAPONS, computeWeaponStats } from '@ai-gaem/shared';
import { createRenderer, type RenderContext } from './renderer';
import { initPhysics, FIXED_DT, type PhysicsContext } from './physics';
import { Input } from './input';
import { createTestMap } from '../map/testMap';
import { findGroundSpawns, loadMap } from '../map/loadMap';
import type { GameMap, Vec3 } from '../map/types';
import { getSpawnPoints, pickRandomSpawn, type SpawnPoint } from '../map/spawns';
import { PlayerController } from '../player/PlayerController';
import { CameraRig } from '../player/CameraRig';
import { Sfx } from '../audio/Sfx';
import { settings } from '../settings';
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
  /** test hook / scripted override for ADS (null = right mouse) */
  forceAds: boolean | null = null;
  private adsToggled = false;
  private lastCrouchSent = false;

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

    // ---- map ----
    this.map = createTestMapOr(this, opts.mapUrl ? await this.tryLoadMap(opts.mapUrl) : null);
    this.physics.world.step(); // build the query pipeline before the first raycast
    if (this.map.id !== 'testmap') {
      const guessed = findGroundSpawns(this.map, this.physics);
      if (guessed.length) this.map.spawns = guessed;
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

    this.net = opts.net ?? new OfflineNetClient({ bots: opts.bots ?? 0, botCenter: [0, 0, 0] });
    const online = this.net.authoritative;

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
        onShot: (o, d) => this.net.fire([o.x, o.y, o.z], [d.x, d.y, d.z]),
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
    if (!online) for (const w of DEFAULT_WEAPONS) w.id = await this.net.registerWeapon(w);
    this.remotes = new RemotePlayers(this.net, this.physics, this.rc.scene, this.targets);
    this.net.onKill?.((e) => {
      const killer = e.killerId === this.net.localId ? 'You' : e.killerName;
      const victim = e.victimId === this.net.localId ? 'You' : e.victimName;
      this.killLog.push(`${killer} [${e.weaponName}] ${victim}`);
      if (e.victimId === this.net.localId) this.hud.setDeathMessage(`Killed by ${e.killerName} [${e.weaponName}]`);
      this.hud.addKill(killer, e.weaponName, victim, !!e.headshot);
    });
    // server-confirmed kills by us: kill chime (the optimistic hitmarker never knows about kills online)
    this.net.onHitConfirmed?.((e) => {
      if (e.killed) {
        this.hud.hitMarker(true, e.headshot);
        this.sfx.killChime();
      }
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
        const origin = new THREE.Vector3(...e.origin);
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
    this.lastCrouchSent = this.player.crouched;
    this.net.sendTransform([f.x, f.y, f.z], this.player.yaw, this.player.pitch, this.player.crouched, true);
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

  private async tryLoadMap(url: string): Promise<GameMap | null> {
    try {
      return await loadMap(url, this.physics, this.rc.scene);
    } catch (err) {
      console.warn('[game] map load failed, using test map', err);
      return null;
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
    this.hud.setCrosshairVisible(this.ads < 0.5 && mode !== 'melee', !scoped && mode !== 'melee');
  }

  /** ADS state for this frame: hold / toggle right mouse, cancelled by sprint, reload, melee, death */
  private updateAds(dt: number, canAct: boolean) {
    const input = this.input;
    const h = this.weapons.handling;
    if (settings.current.adsToggle) {
      if (input.wasRightClicked()) this.adsToggled = !this.adsToggled;
    } else this.adsToggled = false;
    const wanted = this.forceAds ?? (settings.current.adsToggle ? this.adsToggled : input.rightDown);
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
    const canAct = this.alive && input.locked;
    player.inputEnabled = canAct;
    this.updateAds(dt, canAct);
    // shooting cancels sprint (you can't fire mid-sprint; the shot goes out as the sprint ends)
    if (canAct && input.mouseDown && player.sprinting) player.blockSprint();
    const md = input.locked ? player.frameInput(dt, this.rig.fovScale) : (input.consumeMouse(), { dx: 0, dy: 0 });
    this.acc += dt;
    while (this.acc >= FIXED_DT) {
      player.fixedUpdate(FIXED_DT);
      this.physics.world.step();
      this.acc -= FIXED_DT;
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
      if (online) this.player.teleport(this.lastSpawn.clone());
      else this.damageLocal(MAX_HP, 'Fell out of the world');
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
    });
    this.weapons.moveState = { speed, grounded: player.grounded, crouched: player.crouched, ads: this.ads };
    this.weapons.update(dt, input, canAct);
    this.updateCrosshair();
    this.dummies?.update(dt, this.rc.camera);
    this.remotes.update(dt);
    this.hud.update(dt);

    this.netAcc += dt;
    if (this.netAcc >= 1 / NET_SEND_HZ) {
      this.netAcc = 0;
      if (this.alive) {
        const f = player.feet;
        this.lastCrouchSent = player.crouched;
        this.net.sendTransform([f.x, f.y, f.z], player.yaw, player.pitch, player.crouched);
      }
    } else if (this.alive && player.crouched !== this.lastCrouchSent) {
      // crouch changes go out immediately (hitboxes)
      this.sendTransformNow();
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
          `vel ${player.horizontalSpeed().toFixed(2)} vy ${player.velocity.y.toFixed(2)}\ngrounded ${player.grounded}` +
          `  crouch ${player.crouched}  sprint ${player.sprinting}\n` +
          `spread ${this.weapons.currentSpread().toFixed(2)}°  bloom ${this.weapons.bloom.toFixed(2)}  ads ${this.ads.toFixed(2)}  fov ${cam.fov.toFixed(1)}\n` +
          `map ${this.map.id}  weapon ${this.weapons.weapon.name} (${this.weapons.fireMode})`,
      );
    } else this.hud.setDebug(null);

    this.rc.render();
    input.endFrame();
  };
}


function createTestMapOr(game: Game, loaded: GameMap | null): GameMap {
  return loaded ?? createTestMap(game.physics, game.rc.scene);
}
