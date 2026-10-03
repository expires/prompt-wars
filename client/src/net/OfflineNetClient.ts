import { bodyStats, designToWeapon, elementCode, meleeHitDamage, outfitForStorage, slowDurationFor, zoneDamage, type ForgeDesign, type OutfitDesign } from '@ai-gaem/shared';
import { OUTFIT_EXAMPLES, OUTFIT_PRESETS } from '@ai-gaem/shared/outfit/examples';
import type { Weapon } from '../weapons/types';
import type { HitInfo, KillEvent, LocalPose, NetClient, NetOutfit, NetPlayer, PoseSnapshot, Vec3 } from './NetClient';

function netOutfit(id: string, outfit: OutfitDesign, isPreset: boolean, prompt = ''): NetOutfit {
  const st = bodyStats(outfit.body);
  return { id, name: outfit.name, isPreset, outfit, prompt, maxHp: st.maxHp, speedMult: st.speedMult, dims: { scale: st.scale, build: st.build, head: st.head } };
}

type Listener<T> = (v: T) => void;

/**
 * Offline implementation: no server. Optionally simulates `bots` fake remote
 * players walking in circles so RemotePlayers/interpolation can be tested
 * (enable with `?bots=3`).
 */
export class OfflineNetClient implements NetClient {
  readonly localId = 'local';
  readonly authoritative = false;
  private seq = 0;
  private playersCbs: Listener<NetPlayer[]>[] = [];
  private poseCbs: ((id: string, s: PoseSnapshot) => void)[] = [];
  private poses = new Map<string, PoseSnapshot>();
  private killCbs: Listener<KillEvent>[] = [];
  private weapons = new Map<string, Weapon>();
  private outfits = new Map<string, NetOutfit>();
  private outfitCbs: Listener<void>[] = [];
  /** outfit the local player wears (offline the game applies it) */
  localOutfitId = '0';
  private bots: (NetPlayer & { cx: number; cz: number; r: number; speed: number; phase: number })[] = [];
  private timer?: number;
  private t = 0;

  constructor(private readonly opts: { bots?: number; botCenter?: Vec3 } = {}) {}

  async connect() {
    for (const o of OUTFIT_PRESETS) this.outfits.set(`preset-${o.name.toLowerCase()}`, netOutfit(`preset-${o.name.toLowerCase()}`, o, true));
    OUTFIT_EXAMPLES.forEach(([p, o], i) => this.outfits.set(`example-${i}`, netOutfit(`example-${i}`, o, false, p)));
    // bots wear the hand-built outfits (variety for tests / screenshots)
    const looks = [...this.outfits.keys()];
    const n = this.opts.bots ?? 0;
    const [bx, by, bz] = this.opts.botCenter ?? [0, 0, 0];
    for (let i = 0; i < n; i++) {
      this.bots.push({
        id: `bot-${i}`,
        name: `Bot ${i + 1}`,
        pos: [bx, by, bz],
        yaw: 0,
        pitch: 0,
        hp: this.outfits.get(looks[i % looks.length])!.maxHp,
        maxHp: this.outfits.get(looks[i % looks.length])!.maxHp,
        outfitId: looks[i % looks.length],
        alive: true,
        color: `hsl(${(i * 77) % 360},70%,50%)`,
        cx: bx + (Math.random() - 0.5) * 10,
        cz: bz + (Math.random() - 0.5) * 10,
        r: 3 + Math.random() * 4,
        speed: 0.4 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
      });
    }
    if (n > 0) {
      // simulated bots send at the same 30 Hz as real moving players
      this.timer = window.setInterval(() => this.tick(1 / 30), 1000 / 30);
    }
    console.info('[net] offline mode', n ? `with ${n} simulated bots` : '');
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
  }

  private tick(dt: number) {
    this.t += dt;
    for (const b of this.bots) {
      if (!b.alive) continue;
      const a = b.phase + this.t * b.speed;
      b.pos = [b.cx + Math.cos(a) * b.r, b.pos[1], b.cz + Math.sin(a) * b.r];
      // face along the direction of travel (tangent); yaw 0 faces -Z
      b.yaw = Math.atan2(Math.sin(a), -Math.cos(a));
      // crouch for ~1.5 s out of every 5 (exercises remote crouch + hitboxes)
      b.crouching = !(b as { still?: boolean }).still && (this.t + b.phase) % 5 < 1.5;
      const w = b.speed * b.r;
      const snap: PoseSnapshot = {
        pos: [...b.pos],
        vel: [-Math.sin(a) * w, 0, Math.cos(a) * w],
        yaw: b.yaw,
        pitch: 0,
        crouching: !!b.crouching,
        grounded: true,
        teleport: false,
        sendT: Math.round(this.t * 1000),
        arrival: performance.now(),
      };
      this.poses.set(b.id, snap);
      this.poseCbs.forEach((cb) => cb(b.id, snap));
    }
    this.emitPlayers(); // roster (hp / alive); movement goes through onPose
  }

  private emitPlayers() {
    const snapshot = this.bots.map(({ cx: _cx, cz: _cz, r: _r, speed: _s, phase: _p, ...p }) => ({ ...p, pos: [...p.pos] as Vec3 }));
    this.playersCbs.forEach((cb) => cb(snapshot));
  }

  sendTransform(_pose: LocalPose) {
    // nothing to send offline
  }

  onPose(cb: (id: string, s: PoseSnapshot) => void) {
    this.poseCbs.push(cb);
    return () => (this.poseCbs = this.poseCbs.filter((c) => c !== cb));
  }

  getPose(id: string) {
    return this.poses.get(id);
  }

  fire(_origin: Vec3, _dir: Vec3) {
    return ++this.seq;
  }

  reportHit(targetId: string, weaponId: string, info?: HitInfo) {
    const bot = this.bots.find((b) => b.id === targetId);
    if (!bot || !bot.alive) return;
    const w = this.weapons.get(weaponId);
    const body = (w?.damage ?? 20) * Math.max(1, info?.pellets ?? 1);
    bot.hp -= w ? (w.fireMode === 'melee' ? meleeHitDamage(w, info?.charge ?? 0, info?.zone ?? 0) : zoneDamage(w, body, info?.zone ?? 0)) : body;
    // elemental status for the visuals (no DoT simulation offline)
    if (w?.element) {
      const now = Date.now();
      if (w.dotDamage > 0) {
        bot.dotUntil = now + w.dotDuration * 1000;
        bot.dotElement = elementCode(w.element);
      }
      if (w.slowPercent > 0 && (w.element === 'ice' || w.element === 'shock')) {
        bot.slowPercent = w.slowPercent;
        bot.slowUntil = now + slowDurationFor(w.element) * 1000;
        bot.slowElement = elementCode(w.element);
      }
    }
    if (bot.hp <= 0) {
      bot.alive = false;
      bot.hp = 0;
      const e: KillEvent = {
        killerId: this.localId,
        killerName: 'You',
        victimId: bot.id,
        victimName: bot.name,
        weaponName: w?.name ?? weaponId,
        at: Date.now(),
        headshot: info?.zone === 1,
      };
      this.killCbs.forEach((cb) => cb(e));
      setTimeout(() => {
        bot.alive = true;
        bot.hp = bot.maxHp ?? 100;
      }, 3000);
    }
    this.emitPlayers();
  }

  respawn(keepLoadout: boolean) {
    console.info('[net] respawn (offline), keepLoadout =', keepLoadout);
  }

  async registerWeapon(json: Weapon) {
    const id = json.id ?? `local-${Math.random().toString(36).slice(2, 9)}`;
    this.weapons.set(id, { ...json, id });
    return id;
  }

  getWeapon(id: string) {
    return this.weapons.get(id);
  }

  /** offline: the design becomes a local weapon (the game equips it) */
  async registerDesign(design: ForgeDesign, prompt: string) {
    const w: Weapon = { ...designToWeapon(design), design, prompt };
    return this.registerWeapon(w);
  }

  async registerOutfit(outfit: OutfitDesign, prompt: string) {
    const id = `local-outfit-${Math.random().toString(36).slice(2, 9)}`;
    this.outfits.set(id, netOutfit(id, outfitForStorage(outfit), false, prompt));
    this.localOutfitId = id;
    this.outfitCbs.forEach((cb) => cb());
    return id;
  }

  async equipOutfit(id: string) {
    this.localOutfitId = id;
  }

  getOutfit(id: string) {
    return this.outfits.get(id);
  }

  outfitPresets() {
    return [...this.outfits.values()].filter((o) => o.isPreset).sort((a, b) => a.maxHp - b.maxHp);
  }

  onOutfitsChanged(cb: Listener<void>) {
    this.outfitCbs.push(cb);
    return () => (this.outfitCbs = this.outfitCbs.filter((c) => c !== cb));
  }

  async requestRedeploy() {
    /* offline: the game handles redeploy locally */
  }

  onPlayersChanged(cb: Listener<NetPlayer[]>) {
    this.playersCbs.push(cb);
    return () => (this.playersCbs = this.playersCbs.filter((c) => c !== cb));
  }

  onKill(cb: Listener<KillEvent>) {
    this.killCbs.push(cb);
    return () => (this.killCbs = this.killCbs.filter((c) => c !== cb));
  }
}
