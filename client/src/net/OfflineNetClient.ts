import { zoneDamage } from '@ai-gaem/shared';
import type { Weapon } from '../weapons/types';
import type { HitInfo, KillEvent, LocalPose, NetClient, NetPlayer, PoseSnapshot, Vec3 } from './NetClient';

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
  private bots: (NetPlayer & { cx: number; cz: number; r: number; speed: number; phase: number })[] = [];
  private timer?: number;
  private t = 0;

  constructor(private readonly opts: { bots?: number; botCenter?: Vec3 } = {}) {}

  async connect() {
    const n = this.opts.bots ?? 0;
    const [bx, by, bz] = this.opts.botCenter ?? [0, 0, 0];
    for (let i = 0; i < n; i++) {
      this.bots.push({
        id: `bot-${i}`,
        name: `Bot ${i + 1}`,
        pos: [bx, by, bz],
        yaw: 0,
        pitch: 0,
        hp: 100,
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
      // simulate a 20Hz server tick
      this.timer = window.setInterval(() => this.tick(0.05), 50);
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
      b.crouching = (this.t + b.phase) % 5 < 1.5;
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
    bot.hp -= w ? zoneDamage(w, body, info?.zone ?? 0) : body;
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
        bot.hp = 100;
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

  onPlayersChanged(cb: Listener<NetPlayer[]>) {
    this.playersCbs.push(cb);
    return () => (this.playersCbs = this.playersCbs.filter((c) => c !== cb));
  }

  onKill(cb: Listener<KillEvent>) {
    this.killCbs.push(cb);
    return () => (this.killCbs = this.killCbs.filter((c) => c !== cb));
  }
}
