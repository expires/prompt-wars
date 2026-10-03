import * as THREE from 'three';
import {
  ACTIVE_MAP_ID,
  BLOCK_MOVE_MULT,
  mapPickups,
  PRESET_WEAPONS,
  findMapDef,
  computeWeaponStats,
  elementFromCode,
  meleeMetaOf,
  moveSpeedLabel,
  weaponMoveMultiplier,
  combinedMoveMult,
  hitboxArea,
  sizeClassOf,
  DEFAULT_DIMS,
  MOVE_MULT_MAX,
  MOVE_MULT_MIN,
  type MapDef,
} from '@ai-gaem/shared';
import type { NetOutfit } from '../net/NetClient';
import { setOutfitEnvRenderer } from '../player/outfitModelCache';
import { playerStatus } from '../weapons/elementFx';
import { reducedMotionActive } from '../ui/hud/applyUiSettings';
import { createRenderer, type RenderContext } from './renderer';
import { initPhysics, FIXED_DT, type PhysicsContext } from './physics';
import { Input } from './input';
import { createTestMap } from '../map/testMap';
import { addBoundsColliders, expandBox, type BoundsBox } from '../map/bounds';
import { findGroundSpawns, loadMap } from '../map/loadMap';
import { bakeSpawns } from '../map/bakeSpawns';
import { PropSystem } from '../props/PropSystem';
import { PickupSystem } from '../props/Pickups';
import { TEST_MAP_PROPS, type PropSpawn } from '../props/propDefs';
import type { GameMap, Vec3 } from '../map/types';
import { getSpawnPoints, pickRandomSpawn, type SpawnPoint } from '../map/spawns';
import { PlayerController } from '../player/PlayerController';
import { CameraRig } from '../player/CameraRig';
import { Sfx } from '../audio/Sfx';
import { Music } from '../audio/Music';
import { settings } from '../settings';
import { TargetDummies } from '../player/TargetDummies';
import { TargetRegistry } from '../weapons/targets';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { getDefaultWeapons, loadMeleeSamples } from '../weapons/defaultWeapons';
import { meleeMaterial } from '../weapons/MeleeSystem';
import type { Weapon } from '../weapons/types';
import { loadPartsLibrary } from '../weapons/partsLibrary';
import { loadTemplates, warmTemplates } from '../weapons/templatesLibrary';
import { Hud } from '../ui/Hud';
import { GameFlow } from './Flow';
import { rarityOf } from '../ui/rarity';
import { SpawnEditor } from '../ui/SpawnEditor';
import { OfflineNetClient, PoseSender, RemotePlayers, type NetClient, type NetPlayer } from '../net';
import { DamageNumbers } from '../ui/DamageNumbers';
import { TouchControls, touchDevice } from '../ui/TouchControls';
import { setDesignEnvRenderer } from '../weapons/designModelCache';
import { weaponPrompt } from '../ui/forgeCredit';
import { isWasmPanic, report, reportError, setTelemetryContext, watchCanvas, currentGpu } from '../telemetry';
import { QualityController } from './quality';
import { hideBanner, showBanner } from '../ui/StatusBanner';
import { checkVersion, startVersionCheck } from '../versionCheck';

export const MAX_HP = 100;
/** room between the scan's own bounds and the invisible wall net */
const BOUNDS_MARGIN = 0.5;
/** `?music=0` disables the procedural lobby music */
const MUSIC_OFF = new URLSearchParams(location.search).get('music') === '0';

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
  if (w.element) parts.push(w.element);
  const move = moveSpeedLabel(weaponMoveMultiplier(w));
  if (move !== '±0%') parts.push(`move ${move}`);
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
  props!: PropSystem;
  pickups!: PickupSystem;
  spawnEditor!: SpawnEditor;
  readonly targets = new TargetRegistry();
  readonly rig = new CameraRig();
  readonly sfx = new Sfx();
  readonly music = new Music();
  /** 0..1 ADS blend */
  ads = 0;
  /** test hook: force the melee block on / off (null = F / RB) */
  forceBlock: boolean | null = null;
  /** test hook / scripted override for ADS (null = right mouse) */
  forceAds: boolean | null = null;
  private adsToggled = false;
  poseSender!: PoseSender;
  damageNumbers!: DamageNumbers;
  /** on-screen controls (phones / tablets, or `?touch=1`) */
  touch?: TouchControls;
  /** test hook: scripted circular movement (smoothness test) */
  autoMove: { cx: number; cz: number; r: number; speed: number; y: number; a: number } | null = null;

  hp = MAX_HP;
  alive = true;
  ready = false;
  /** last authoritative state of the local player (networked mode) */
  me?: NetPlayer;
  /** menus / screens (landing, pause, death, forge) */
  flow!: GameFlow;
  readonly killLog: string[] = [];
  private acc = 0;
  /** simulation clock (ms) for pose timestamps: advances exactly FIXED_DT per step */
  private simT: number | null = null;
  private last = performance.now();
  private scoreAcc = 0;
  private showDebug = false;
  fps = 0;
  /**
   * Per-second perf window (F3 overlay, bug reports, e2e): frames rendered, mouse events received
   * and the worst frame time over the last full second.
   */
  readonly perf = { fps: 0, mouseHz: 0, maxFrameMs: 0, windowStart: 0, frames: 0, mouseAtStart: 0, worstMs: 0 };
  /** headshot kills per killer id (scoreboard HS%) */
  private readonly hsKills = new Map<string, { k: number; hs: number }>();
  /** last damage the server applied to us (death screen detail) */
  private lastHitOnMe: { shooterId: string; damage: number; headshot: boolean } | null = null;
  private lastSpawn = new THREE.Vector3();
  private respawning = false;
  opts: GameOptions = {};
  /** graphics quality (Settings → Video) */
  quality?: QualityController;
  /** per-frame exception bookkeeping (one bad frame must not kill the loop) */
  private frameErrors: number[] = [];
  private fatalShown = false;
  private contextLosses = 0;
  private contextLostTimer?: ReturnType<typeof setTimeout>;
  /** true while the WebGL context is lost: nothing renders */
  contextLost = false;

  get serverLabel() {
    return this.opts.serverLabel ?? 'server';
  }

  async start(container: HTMLElement, opts: GameOptions = {}) {
    this.opts = opts;
    this.rc = createRenderer(container);
    setDesignEnvRenderer(this.rc.renderer);
    setOutfitEnvRenderer(this.rc.renderer);
    setTelemetryContext({
      renderer: this.rc.renderer,
      name: () => this.me?.name,
      identity: () => this.net?.localId,
      screen: () => (this.flow ? this.flow.screen : 'boot'),
      extra: () => ({
        map: this.map?.id,
        q: this.quality?.level,
        alive: this.alive,
        online: this.net?.authoritative ?? false,
        players: this.remotes ? this.remotes.ids().length + 1 : undefined,
        fps: this.perf.fps,
      }),
    });
    this.watchContext(this.rc.renderer.domElement);
    this.physics = await initPhysics();
    this.input = new Input(this.rc.renderer.domElement);
    this.hud = new Hud();
    if (touchDevice()) {
      document.documentElement.classList.add('is-touch');
      const touch = new TouchControls();
      touch.onLook = (dx, dy) => this.input.addLook(dx, dy);
      touch.onMenu = () => {
        if (this.alive && !this.flow.blocking) this.flow.openPause();
      };
      this.touch = touch;
      this.input.touch = touch;
    }
    this.flow = new GameFlow(this);
    this.hud.setVisible(false);

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
      const def: MapDef | undefined = findMapDef(url);
      if (def && def.spawns.length > 0) {
        this.map.spawns = def.spawns.map((s) => [s.x, s.y, s.z] as Vec3);
      } else {
        const guessed = findGroundSpawns(this.map, this.physics);
        if (guessed.length) this.map.spawns = guessed;
      }
    } else if (mapFailed && online) {
      this.hud.showWarning('Venue map failed to load — playing test map; spawns may be wrong');
    }

    // ---- graphics quality (needs the map for its decor hooks) ----
    this.quality = new QualityController({
      renderer: this.rc.renderer,
      scene: this.rc.scene,
      map: this.map,
      gpu: () => currentGpu(),
      measuring: () => this.ready && this.alive && !this.flow.blocking && document.visibilityState === 'visible' && !this.contextLost,
      onChange: (level, reason) => {
        console.info(`[quality] ${level} (${reason})`);
        if (reason.startsWith('fps')) this.hud.toast(`Graphics quality lowered to <b>${level}</b> for a smoother frame rate`, { ms: 5000 });
      },
    });
    this.quality.refresh('start', true);

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
      this.dummies.onKilled = (d) =>
        this.hud.addKill('You', this.weapons.weapon.name, d.id, this.lastHitHead, {
          tier: rarityOf(this.weapons.weapon).tier,
          melee: this.weapons.fireMode === 'melee',
          mine: true,
          killerIsYou: true,
        });
    }

    // ---- breakable props (dynamic bodies; never the static walls) ----
    this.props = new PropSystem(this.physics, this.rc.scene, this.targets, this.propSpawns());

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
        onHit: (t, dmg, killed, zone) => {
          const head = zone === 1;
          this.lastHitHead = head;
          this.hud.hitMarker(killed, head);
          // offline (dummies / bots) there is no server confirmation: number the local estimate
          if (!this.net.authoritative && t.kind !== 'prop') {
            const at = t.getCenter(new THREE.Vector3());
            at.y += 0.7;
            this.damageNumbers.add(t.id, dmg, at, { headshot: head, killed, element: this.weapons.weapon.element ?? null });
            if (killed) this.hitStop();
          }
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
        onMeleeWorld: (meta, point) => {
          this.sfx.meleeImpact('blunt', meta.weight);
          this.rig.shake(0.3);
          this.props.blast(point, 2.4, meta.weight === 'heavy' ? 5 : 2.5);
        },
        onShotEnd: () => this.net.flushShot?.(),
        onFire: (w) => {
          this.sfx.gunshot(w.class);
          // FOV punch scaled by per-shot damage (an SMG barely breathes, a sniper / launcher thumps)
          if (w.fireMode !== 'melee' && w.fireMode !== 'stream') {
            const perShot = w.damage * Math.max(1, w.pellets) + (w.splashRadius > 0 ? 25 : 0);
            this.rig.punchFov(Math.min(2.6, 0.15 + perShot * 0.022) * (1 - 0.6 * this.ads));
          }
        },
        onRecoil: (p, y) => this.rig.kick(p, y),
        onExplosion: (pos) => {
          this.sfx.explosion(pos);
          // shake falls off with distance (none past ~14 m)
          const d = pos.distanceTo(this.rc.camera.position);
          if (d < 14) this.rig.shake(2.4 * (1 - d / 14) ** 1.5);
          this.props.blast(pos, 4.5, 9);
        },
        onReload: () => {
          this.sfx.reload();
          this.net.reload?.();
        },
      },
    );

    // a stand-in until the server says what we hold (new players have no weapon until they forge)
    this.equip({ ...PRESET_WEAPONS.pistol, id: '' });

    // ---- net ----
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
    this.remotes.fx = this.weapons.effects;

    // ---- pickups (health pack on the stage): server rows online (seeded from the active map),
    // the map's own list offline ----
    const pickupDef = this.map.id !== 'testmap' ? findMapDef(url) : undefined;
    const pickupDefs = mapPickups(pickupDef);
    this.pickups = new PickupSystem(this.rc.scene, this.net, pickupDefs, pickupDefs.length > 0 && (!online || pickupDef?.id === ACTIVE_MAP_ID));
    this.pickups.onLocalHeal = (amount) => {
      this.hp = Math.min(this.maxHp, this.hp + amount);
      this.hud.setHealth(this.hp, this.maxHp);
    };
    this.pickups.onTaken = ({ e, local }) => {
      if (!local) {
        this.sfx.heal(new THREE.Vector3(...e.pos));
        return;
      }
      this.sfx.heal();
      this.hud.healFlash();
      // "+50" floats in front of the camera (the pack itself is below the view)
      const cam = this.rc.camera;
      const at = cam.position.clone().addScaledVector(cam.getWorldDirection(new THREE.Vector3()), 1.8);
      at.y -= 0.45;
      this.damageNumbers.add('heal:local', e.amount, at, { heal: true });
    };
    this.net.onKill?.((e) => {
      const me = this.net.localId;
      const killer = e.killerId === me ? 'You' : e.killerName;
      const victim = e.victimId === me ? 'You' : e.victimName;
      this.killLog.push(`${killer} [${e.weaponName}] ${victim}`);
      if (this.killLog.length > 50) this.killLog.splice(0, this.killLog.length - 50);
      const w = e.weaponId ? this.net.getWeapon?.(e.weaponId) : undefined;
      const hs = this.hsKills.get(e.killerId) ?? { k: 0, hs: 0 };
      hs.k++;
      if (e.headshot) hs.hs++;
      this.hsKills.set(e.killerId, hs);
      if (e.victimId === me) {
        const kpos = this.remotes.get(e.killerId)?.position;
        this.flow.onKilledBy({
          killerName: e.killerId === me ? 'Yourself' : e.killerName,
          killerId: e.killerId,
          killerIsYou: e.killerId === me,
          killerWeapon: e.killerId === me ? null : (w ?? null),
          headshot: !!e.headshot,
          damage: this.lastHitOnMe?.shooterId === e.killerId ? this.lastHitOnMe.damage : undefined,
          distance: kpos ? kpos.distanceTo(this.player.feet) : undefined,
        });
      }
      this.hud.addKill(killer, e.weaponName, victim, !!e.headshot, {
        tier: rarityOf(w).tier,
        melee: w?.fireMode === 'melee',
        mine: e.killerId === me || e.victimId === me,
        killerIsYou: e.killerId === me,
        victimIsYou: e.victimId === me,
        element: elementFromCode(e.element) ?? w?.element ?? null,
        prompt: weaponPrompt(w) || undefined,
      });
    });
    // server-confirmed damage by us: aggregated damage numbers; kills get the kill X + chime
    // (the optimistic hitmarker shows on the local raycast and never knows about kills online)
    this.net.onHitConfirmed?.((e) => {
      const at = e.point ? new THREE.Vector3(...e.point) : (this.remotes.headOf(e.targetId) ?? new THREE.Vector3());
      this.damageNumbers.add(e.targetId, e.damage, at, { headshot: e.headshot, killed: e.killed, dot: e.dot, element: elementFromCode(e.element) });
      if (e.blocked) this.sfx.blockClang(at);
      if (e.killed) {
        this.hud.hitMarker(true, e.headshot);
        this.hud.killConfirm(e.headshot);
        this.sfx.killChime();
        this.hitStop();
      }
    });

    if (online) {
      this.net.onLocalChanged?.((me) => this.applyLocalState(me));
      this.net.onWeaponsChanged?.(() => {
        this.syncWeapon();
        this.flow.onWeaponsChanged();
      });
      this.net.onOutfitsChanged?.(() => {
        this.applyLocalBody();
        this.flow.onWeaponsChanged();
      });
      this.net.onLocalHit?.((e) => {
        if (e.knock.some((k) => k !== 0)) this.player.applyImpulse(new THREE.Vector3(...e.knock));
        if (e.blocked) this.sfx.blockClang();
        if (!e.dot) {
          this.hud.damageFlash();
          // short shake on taking damage, scaled by the hit (DoT ticks don't shake)
          this.rig.shake(Math.min(1.6, 0.25 + e.damage / 30));
        }
        this.lastHitOnMe = { shooterId: e.shooterId, damage: e.damage, headshot: e.headshot };
        const from = this.remotes.get(e.shooterId)?.position;
        if (from && e.shooterId !== this.net.localId) {
          const f = this.player.feet;
          const dx = from.x - f.x;
          const dz = from.z - f.z;
          const yaw = this.player.yaw;
          const fwd = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
          const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
          this.hud.damageFrom(e.shooterId, Math.atan2(right, fwd));
        }
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
        this.hud.setHealth(this.hp, this.maxHp);
        if (!me.alive && this.alive) this.die('Killed');
      });
      this.equip(getDefaultWeapons()[0]);
    }

    // ---- connection loss: reconnect banner instead of dumping to the menu ----
    this.net.onConnectionStatus?.((st) => {
      if (st.state === 'reconnecting') {
        const secs = Math.max(1, Math.round(st.inMs / 1000));
        showBanner('net', st.attempt <= 1 ? 'Connection lost — reconnecting…' : `Reconnecting… (attempt ${st.attempt}, next in ${secs}s)`, {
          tone: 'warn',
          spinner: true,
          action: st.attempt >= 4 ? { label: 'Reload', onClick: () => location.reload() } : undefined,
        });
      } else {
        hideBanner('net');
        if (st.reconnected) {
          this.hud.toast('Reconnected', { ms: 2500 });
          // the server resumes us from our last stored position: re-announce where we really are
          this.poseSender.markTeleport();
          this.sendTransformNow();
          this.syncWeapon(true);
          void checkVersion();
        }
      }
    });
    startVersionCheck((v) => this.onNewVersion(v));

    // ---- UI wiring ----
    this.spawnEditor = new SpawnEditor(this.map.id, this.rc.scene, this.input, this.hud, () => ({
      feet: this.player.feet,
      yaw: this.player.yaw,
    }));
    this.hud.setHealth(this.hp, this.maxHp);
    this.input.onLockChange((locked) => this.flow.onLockChange(locked));

    this.ready = true;
    this.flow.start();
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
    if (prev?.outfitId !== me.outfitId || prev?.maxHp !== me.maxHp) this.applyLocalBody();
    this.flow.onLocalChanged(me);
    if (me.hp < this.hp && me.alive) this.hud.damageFlash();
    this.hp = me.hp;
    this.hud.setHealth(this.hp, this.maxHp);
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
    try {
      const wait = (this.me?.respawnAt ?? 0) - Date.now();
      if (wait > 0) await sleep(wait + 50);
      const net = this.net as NetClient & { respawnAsync?(k: boolean): Promise<void> };
      for (let i = 0; i < 40 && !this.alive; i++) {
        try {
          if (net.respawnAsync) await withTimeout(net.respawnAsync(keepLoadout), 6000, 'respawn timed out');
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
    }
  }

  // ------------------------------------------------------------------ helpers

  /** Box the invisible wall net wraps for a scanned map: venue MapDef → scan bbox (T-004) → drawn geometry. */
  private boundsBox(url?: string): BoundsBox | null {
    const def: MapDef | undefined = findMapDef(url);
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

  /** Breakable props for the current map: a hand-placed set on the test map, else scattered near spawns. */
  private propSpawns(): PropSpawn[] {
    if (this.map.id === 'testmap') return TEST_MAP_PROPS;
    const kinds = ['chair', 'chair', 'crate', 'cone', 'bottle'] as const;
    const half: Record<(typeof kinds)[number], number> = { chair: 0.56, crate: 0.4, cone: 0.37, bottle: 0.25 };
    return this.map.spawns.slice(0, 20).map((s, i) => {
      const kind = kinds[i % kinds.length];
      const a = (i / 5) * Math.PI * 2;
      return { kind, pos: [s[0] + Math.cos(a) * 1.8, s[1] + half[kind], s[2] + Math.sin(a) * 1.8] as Vec3, yaw: a };
    });
  }

  equip(w: Weapon) {
    this.weapons.setWeapon(w);
    const r = rarityOf(w);
    this.hud.setWeapon({
      name: w.name,
      tier: r.tier,
      tierLabel: r.label,
      melee: w.fireMode === 'melee' ? { swing: meleeMetaOf(w).swing } : null,
      move: moveSpeedLabel(weaponMoveMultiplier(w)),
      element: w.element ?? null,
    });
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
    this.flow.onDeath(message);
    // the death screen offers weapon generation: get the template library ready
    if (!this.me?.needsLoadout) void warmTemplates().catch((err) => console.warn('[templates] failed to load', err));
  }

  // ------------------------------------------------------------------ body (Closet outfit)

  /** movement multiplier of the current body (1 = default) */
  bodySpeedMult = 1;

  /** the outfit the local player wears (undefined = default body / not arrived yet) */
  get outfit(): NetOutfit | undefined {
    const id = this.net.authoritative ? this.me?.outfitId : (this.net as { localOutfitId?: string }).localOutfitId;
    return id && id !== '0' ? this.net.getOutfit?.(id) : undefined;
  }

  /** max HP of the local body (server-derived online) */
  get maxHp(): number {
    if (this.net.authoritative) return this.me?.maxHp ?? MAX_HP;
    return this.outfit?.maxHp ?? MAX_HP;
  }

  /** capsule / eye height / speed for the current body */
  applyLocalBody() {
    if (!this.player) return;
    const o = this.outfit;
    this.player.setBody(o?.dims ?? DEFAULT_DIMS);
    this.bodySpeedMult = o?.speedMult ?? 1;
    this.hud?.setHealth(this.hp, this.maxHp);
  }

  /** local respawn. `pickSpawn` = choose a local spawn point (offline); networked mode teleports first. */
  respawn(pickSpawn = true) {
    if (pickSpawn) {
      const sp = pickRandomSpawn(this.spawnPoints());
      this.player.teleport(new THREE.Vector3(...sp.pos), sp.yaw);
    }
    this.player.inputEnabled = true;
    this.player.frozen = false;
    this.applyLocalBody();
    this.hp = this.me?.hp ?? this.maxHp;
    this.hud.setHealth(this.hp, this.maxHp);
    this.weapons.refill();
    this.alive = true;
    this.lastHitOnMe = null;
    this.flow.onRespawn();
  }

  /** local damage (debug / environmental); server damage comes via onLocalChanged */
  damageLocal(amount: number, reason = '') {
    if (!this.alive) return;
    this.hp -= amount;
    this.hud.damageFlash();
    this.hud.setHealth(this.hp, this.maxHp);
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

  /** kill hit-stop: seconds left of the visual slow-down (viewmodel, damage numbers; never the sim) */
  private hitStopT = 0;

  /** ~50 ms "hit-stop" on a kill: visual time dilation + a one-frame contrast pop */
  hitStop(seconds = 0.05) {
    if (reducedMotionActive()) return;
    this.hitStopT = Math.max(this.hitStopT, seconds);
  }

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
    this.hud.toast('Touchpad stops while keys held? Try <b>trackpad mode</b>.', {
      ms: 12000,
      action: { label: 'Enable', onClick: () => {
        settings.setTrackpadMode(true);
        this.flow.settingsPanel.sync();
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
    this.hud.setCrosshairGap(px);
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

  /** rAF entry: always reschedules first, and one throwing frame is logged, never fatal */
  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    try {
      this.tick(now);
    } catch (err) {
      this.onFrameError(err);
    }
  };

  private onFrameError(err: unknown) {
    try {
      this.input?.endFrame();
    } catch {
      /* ignore */
    }
    const now = performance.now();
    this.frameErrors.push(now);
    while (this.frameErrors.length && now - this.frameErrors[0] > 10_000) this.frameErrors.shift();
    if (this.frameErrors.length <= 3) console.error('[game] frame error', err);
    reportError('frame', err, { recent: this.frameErrors.length });
    // a Rapier panic poisons the physics world (every later step throws); a frame that throws
    // every time can't recover either: offer a reload (automatic when no match is in progress)
    if (isWasmPanic(err) || this.frameErrors.length >= 120) this.showFatal(isWasmPanic(err) ? 'The physics engine crashed.' : 'Something went wrong.');
  }

  /** unrecoverable state: reload prompt (auto-reload from the landing / death screens) */
  showFatal(text: string) {
    if (this.fatalShown) return;
    this.fatalShown = true;
    report('fatal', { msg: text }, { flush: true });
    const screen = this.flow?.screen;
    if (screen === 'landing' || screen === 'death') {
      showBanner('fatal', `${text} Reloading…`, { tone: 'error', spinner: true });
      setTimeout(() => location.reload(), 1500);
      return;
    }
    showBanner('fatal', `${text} Reload to keep playing.`, { tone: 'error', action: { label: 'Reload', onClick: () => location.reload() } });
  }

  /** a newer client is deployed (old client vs new schema = trouble) */
  private onNewVersion(v: string) {
    report('version', { msg: 'new version available', to: v }, { heavy: false });
    const screen = this.flow?.screen;
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    if ((screen === 'landing' || screen === 'death') && !typing) {
      showBanner('version', 'New version — reloading…', { spinner: true });
      setTimeout(() => location.reload(), 1200);
      return;
    }
    showBanner('version', 'New version available', { action: { label: 'Reload', onClick: () => location.reload() }, dismissible: true });
  }

  /** WebGL context loss (GPU reset / out of memory): banner, wait for the restore, re-arm GPU state */
  private watchContext(canvas: HTMLCanvasElement) {
    watchCanvas(canvas);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // allow a restore (three.js does this too)
      this.contextLost = true;
      this.contextLosses++;
      showBanner('gfx', 'Graphics reset — restoring…', { tone: 'warn', spinner: true });
      clearTimeout(this.contextLostTimer);
      // no restore within 8 s: the GPU process is gone for good, only a reload helps
      this.contextLostTimer = setTimeout(() => {
        if (!this.contextLost) return;
        report('contextlost', { msg: 'no restore after 8 s' }, { flush: true });
        const screen = this.flow?.screen;
        if (screen === 'landing' || screen === 'death') location.reload();
        else showBanner('gfx', 'Graphics stopped responding.', { tone: 'error', action: { label: 'Reload', onClick: () => location.reload() } });
      }, 8000);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      clearTimeout(this.contextLostTimer);
      hideBanner('gfx');
      // three.js re-uploads geometries / textures / programs lazily; regenerate what was rendered
      // into render targets (the PMREM studio environment of forge designs) and recompile materials
      setDesignEnvRenderer(this.rc.renderer);
      setOutfitEnvRenderer(this.rc.renderer);
      this.rc.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
      // losing the context twice is usually GPU memory pressure: Auto drops to Low
      if (this.contextLosses >= 2 && this.quality && this.quality.setting === 'auto' && this.quality.level !== 'low') this.quality.apply('low', 'context lost twice');
      else this.quality?.refresh('context restored', true);
      this.hud.toast('Graphics restored', { ms: 2500 });
    });
  }

  private tick(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 0) * 0.05;
    const { input, player } = this;
    this.updatePerfWindow(now, dt);
    this.quality?.update(now, this.perf.fps);
    const online = this.net.authoritative;

    // touch: the on-screen controls are live while alive with no menu up
    if (this.touch) {
      const on = this.ready && this.alive && !this.flow.blocking;
      input.touchPlaying = on;
      this.touch.setVisible(on);
    }

    // gamepad: Start toggles pad play (no pointer lock needed) / the pause menu
    const pad = input.pollGamepad(settings.current.gamepadDeadzone);
    if (pad.connected && this.alive) {
      if (input.padPlaying && pad.startPressed) {
        input.padPlaying = false;
        if (!this.flow.blocking) this.flow.openPause();
      } else if (!input.padPlaying && !input.locked && (pad.startPressed || (pad.jumpPressed && this.flow.screen === 'pause'))) {
        input.padPlaying = true;
        if (this.flow.screen === 'pause') this.flow.resume();
      }
    }
    this.updateTrackpadHint(now);

    // debug keys (offline only: the server owns weapons and hp online)
    if (input.active && !online) {
      const dw = getDefaultWeapons();
      for (let i = 0; i < dw.length && i < 10; i++) if (input.wasPressed(`Digit${(i + 1) % 10}`)) this.equip(dw[i]);
      if (input.wasPressed('KeyK')) this.damageLocal(MAX_HP, 'You pressed K');
      if (input.wasPressed('KeyM')) void this.flow.showSlot();
    }
    if (input.wasPressed('F3')) this.showDebug = !this.showDebug;
    this.spawnEditor.update();

    // server slow effect (ice / shock / bubbles) + elemental status on the HUD
    const me = this.me;
    const status = playerStatus(me);
    player.speedScale = 1 - status.slowPercent / 100;
    this.hud.setElementStatus(status);

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
    // carry weight (big guns slower, melee / sidearms faster); blocking slows you down further
    // body size (outfit) stacks with carry weight inside the global window
    const carry = combinedMoveMult(weaponMoveMultiplier(this.weapons.weapon), this.bodySpeedMult, MOVE_MULT_MIN, MOVE_MULT_MAX);
    player.moveMult = carry * (melee && this.weapons.melee.blocking ? BLOCK_MOVE_MULT : 1);
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

    // visual-only time dilation during a kill hit-stop (simulation / network above use real dt)
    const vdt = this.hitStopT > 0 ? dt * 0.12 : dt;
    this.hitStopT = Math.max(0, this.hitStopT - dt);
    // camera-space strafe velocity (viewmodel inertia)
    const strafe = player.velocity.x * Math.cos(player.yaw) - player.velocity.z * Math.sin(player.yaw);
    this.weapons.viewmodel.addSway(md.dx, md.dy);
    this.weapons.viewmodel.update(vdt, {
      speed,
      grounded: player.grounded,
      ads: this.ads,
      sprinting: player.sprinting,
      crouched: player.crouched,
      strafe,
      dip: this.rig.dipOffset,
      melee: this.weapons.meleeView(),
      shield: this.weapons.melee.shield,
      throwing: this.weapons.throwView(),
    });
    this.weapons.moveState = { speed, grounded: player.grounded, crouched: player.crouched, ads: this.ads };
    this.weapons.update(dt, input, canAct, actions);
    this.hud.setCharge(melee ? this.weapons.melee.chargeFraction : 0);
    this.hud.setReloadProgress(this.weapons.reloading ? Math.max(0, this.weapons.viewmodel.reloadProgress) : null);
    this.hud.setStatus(
      !this.alive
        ? ''
        : melee && this.weapons.melee.blocking
          ? 'BLOCKING'
          : player.autoRun
            ? 'AUTORUN · W / S to stop'
            : player.sliding
              ? 'SLIDING'
              : player.sprinting
                ? 'SPRINTING'
                : player.crouched
                  ? 'CROUCHED'
                  : settings.current.trackpadMode
                    ? 'T = autorun'
                    : '',
    );
    this.updateCrosshair();
    this.dummies?.update(dt, this.rc.camera);
    this.props.update(dt);
    this.pickups.update(dt, { feet: player.feet, hp: this.hp, alive: this.alive, maxHp: this.maxHp });
    this.remotes.update(dt, now);
    this.damageNumbers.update(vdt, cam, (id) => this.remotes.headOf(id));
    this.hud.update(dt);

    this.flow.update();
    // lobby music: plays in the menus (landing / pause / death / forge), fades out during a match
    if (!MUSIC_OFF && this.flow.screen !== 'none') this.music.play();
    else this.music.stop();
    this.scoreAcc += dt;
    if (this.scoreAcc > 0.5) {
      this.scoreAcc = 0;
      this.updateScoreboard();
    }

    if (this.showDebug) {
      const f = player.feet;
      this.hud.setDebug(
        `fps ${this.perf.fps}  worst frame ${this.perf.maxFrameMs.toFixed(1)} ms  mouse ${this.perf.mouseHz} ev/s${input.rawMouse ? ' (raw)' : ''}\npos ${f.x.toFixed(2)} ${f.y.toFixed(2)} ${f.z.toFixed(2)}\n` +
          `vel ${player.horizontalSpeed().toFixed(2)} vy ${player.velocity.y.toFixed(2)}\ngrounded ${player.grounded}` +
          `  crouch ${player.crouched}  sprint ${player.sprinting}\n` +
          `spread ${this.weapons.currentSpread().toFixed(2)}°  bloom ${this.weapons.bloom.toFixed(2)}  ads ${this.ads.toFixed(2)}  fov ${cam.fov.toFixed(1)}\n` +
          `map ${this.map.id}  weapon ${this.weapons.weapon.name} (${this.weapons.fireMode})` +
          this.netDebugText(),
      );
    } else this.hud.setDebug(null);

    if (!this.flow.opaque && !this.contextLost) this.rc.render();
    input.endFrame();
  }

  /** roll the one-second perf window (frames, mouse events/s, worst frame time) */
  private updatePerfWindow(now: number, dt: number) {
    const p = this.perf;
    p.frames++;
    p.worstMs = Math.max(p.worstMs, dt * 1000);
    const span = now - p.windowStart;
    if (span < 1000) return;
    if (p.windowStart > 0) {
      p.fps = Math.round((p.frames * 1000) / span);
      p.mouseHz = Math.round(((this.input.mouseEvents - p.mouseAtStart) * 1000) / span);
      p.maxFrameMs = p.worstMs;
    }
    p.windowStart = now;
    p.frames = 0;
    p.worstMs = 0;
    p.mouseAtStart = this.input.mouseEvents;
  }

  /** scoreboard size tag ("L 125"); omitted for the default body */
  private sizeTag(p: NetPlayer, you: boolean): string | undefined {
    const o = you ? this.outfit : p.outfitId && p.outfitId !== '0' ? this.net.getOutfit?.(p.outfitId) : undefined;
    if (!o) return undefined;
    return `${sizeClassOf(hitboxArea(o.outfit.body))} ${o.maxHp}`;
  }

  /** Tab scoreboard rows + ping / FPS micro (twice a second) */
  private updateScoreboard() {
    const online = this.net.authoritative;
    const st = this.net.stats?.();
    const ping = online && st && st.rtt > 0 ? Math.round(st.rtt) : null;
    this.hud.setNetMicro(ping, this.fps);
    const rowFor = (p: NetPlayer, you: boolean) => {
      const w = p.weaponId ? this.net.getWeapon?.(p.weaponId) : undefined;
      const hs = this.hsKills.get(you ? this.net.localId : p.id);
      return {
        id: p.id,
        name: p.name,
        weapon: w?.name ?? (p.needsLoadout ? 'forging…' : '—'),
        tier: rarityOf(w).tier,
        kills: p.kills ?? 0,
        deaths: p.deaths ?? 0,
        hsPct: hs && hs.k ? Math.round((hs.hs / hs.k) * 100) : null,
        ping: you ? ping : null,
        you,
        alive: p.alive,
        prompt: weaponPrompt(w) || undefined,
        size: this.sizeTag(p, you),
      };
    };
    const rows = [];
    const me = this.me;
    if (me) rows.push(rowFor(me, true));
    else rows.push({ id: 'local', name: 'You', weapon: this.weapons.weapon?.name ?? '—', tier: rarityOf(this.weapons.weapon).tier, kills: 0, deaths: 0, hsPct: null, ping: null, you: true, alive: this.alive });
    for (const id of this.remotes.ids()) {
      const r = this.remotes.get(id);
      if (r) rows.push(rowFor(r.state, false));
    }
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const connected = (this.net as NetClient & { connected?: boolean }).connected !== false;
    const n = rows.length;
    this.hud.setScoreboardRows(rows, online ? `${connected ? '●' : '○'} ${this.serverLabel} · ${n} player${n === 1 ? '' : 's'}` : 'Offline');
  }
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

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** run when the browser is idle (falls back to a timeout) */
function idle(cb: () => void) {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(cb, { timeout: 5000 });
  else setTimeout(cb, 1000);
}
