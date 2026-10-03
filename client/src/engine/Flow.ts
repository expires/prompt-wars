// Screen flow: landing (first login) -> forge / quick pick -> deploy; Esc pause menu; death screen;
// the Weapon Forge editor (lazy chunk). Owns the menus; Game owns the simulation.
import { type ForgeDesign } from '@ai-gaem/shared';
import type { Game } from './Game';
import { Landing } from '../ui/menus/Landing';
import { PauseMenu } from '../ui/menus/PauseMenu';
import { DeathScreen, type DeathInfo } from '../ui/menus/DeathScreen';
import { confirmDialog } from '../ui/menus/Confirm';
import { SettingsPanel } from '../ui/SettingsPanel';
import { esc } from '../ui/dom';
import type { Weapon } from '../weapons/types';
import type { NetPlayer } from '../net';
import type { ForgeEditorHandle, ForgeEditorOptions } from '../forge/ForgeEditor';
import { generateWeaponStub, getDefaultWeapons } from '../weapons/defaultWeapons';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CALLSIGN_KEY = 'ai-gaem.callsign';

type Screen = 'none' | 'landing' | 'pause' | 'death' | 'forge';

export class GameFlow {
  readonly settingsPanel = new SettingsPanel();
  readonly landing = new Landing();
  readonly pause = new PauseMenu(this.settingsPanel);
  readonly death = new DeathScreen();
  forge: ForgeEditorHandle | null = null;
  /** screen to go back to when the forge closes */
  private forgeReturn: Screen = 'none';
  private deathInfo: DeathInfo = {};
  private busy = false;
  private callsign = '';
  private redeploying = false;
  private forgeLoading = false;
  private readonly params = new URLSearchParams(location.search);

  constructor(private readonly game: Game) {
    this.callsign = this.params.get('name') ?? this.storedCallsign() ?? '';
    this.landing.handlers = {
      onPlay: (cs) => void this.play(cs),
      onForge: (cs) => {
        this.applyCallsign(cs);
        void this.openForge({ mode: this.needsLoadout ? 'first' : 'pause' }, 'landing');
      },
      onQuickPick: (id, _cls, cs) => void this.quickPick(id, cs),
    };
    this.pause.handlers = {
      onResume: () => this.resume(),
      onRedeploy: () => void this.redeploy(),
      onForge: () => void this.openForge({ mode: 'pause', seedCurrent: true }, 'pause'),
      onLeave: () => void this.leave(),
    };
    this.death.handlers = {
      onKeepLoadout: () => void this.keepLoadout(),
      onQuickForge: (p) => this.quickForge(p),
      onOpenForge: (p) => void this.openForge({ mode: 'death', prompt: p, autostart: !!p.trim() }, 'death'),
      onRemix: (w) => void this.openForge({ mode: 'remix', remix: w }, 'death'),
    };
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  // ------------------------------------------------------------------ state

  get screen(): Screen {
    if (this.forge || this.forgeLoading) return 'forge';
    if (this.death.visible) return 'death';
    if (this.landing.visible) return 'landing';
    if (this.pause.visible) return 'pause';
    return 'none';
  }

  /** any menu open (HUD hidden, no pointer lock wanted) */
  get blocking(): boolean {
    return this.screen !== 'none';
  }

  /** the forge covers the whole screen: the world needn't render */
  get opaque(): boolean {
    return !!this.forge;
  }

  private get online() {
    return this.game.net.authoritative;
  }

  get needsLoadout(): boolean {
    return !!this.game.me?.needsLoadout;
  }

  private storedCallsign(): string | null {
    try {
      return localStorage.getItem(CALLSIGN_KEY);
    } catch {
      return null;
    }
  }

  private applyCallsign(cs: string) {
    const clean = cs.trim().slice(0, 24);
    if (!clean) return;
    if (clean !== this.callsign || (this.game.me && this.game.me.name !== clean)) {
      this.callsign = clean;
      try {
        localStorage.setItem(CALLSIGN_KEY, clean);
      } catch {
        /* storage unavailable */
      }
      if (!this.game.me || this.game.me.name !== clean) this.game.net.setName?.(clean);
    }
  }

  private currentWeapon(): Weapon | null {
    const id = this.game.me?.weaponId;
    if (this.online) {
      if (!id || id === '0') return null;
      return this.game.net.getWeapon?.(id) ?? null;
    }
    return this.game.weapons?.weapon ?? null;
  }

  private landingState() {
    const me = this.game.me;
    const connected = (this.game.net as { connected?: boolean }).connected !== false;
    return {
      callsign: this.callsign || me?.name || '',
      needsLoadout: this.needsLoadout,
      weapon: this.needsLoadout ? null : this.currentWeapon(),
      presets: this.online ? (this.game.net.presetIds?.() ?? []) : offlinePresets(),
      status: this.online ? (connected ? `Online · ${this.game.serverLabel}` : 'Disconnected') : 'Offline practice',
      statusKind: (this.online ? (connected ? 'ok' : 'bad') : 'off') as 'ok' | 'off' | 'bad',
      alive: this.game.alive,
      busy: this.busy,
    };
  }

  private syncHud() {
    this.game.hud.setVisible(!this.blocking);
  }

  // ------------------------------------------------------------------ boot / net

  /** called once the game is ready (connected) */
  start() {
    const e2e = !!this.game.opts.e2e;
    if (!this.callsign && this.game.me?.name && !/^Player-/.test(this.game.me.name)) this.callsign = this.game.me.name;
    if (this.needsLoadout) this.showLanding();
    else if (!this.game.alive) this.syncHud(); // returning dead player: the death screen is up
    else if (!e2e) this.showLanding();
    else this.syncHud();
  }

  showLanding() {
    this.pause.hide();
    this.landing.show(this.landingState());
    this.game.input.exitLock();
    this.syncHud();
  }

  /** local player row changed (needsLoadout / weapon / name) */
  onLocalChanged(_me: NetPlayer) {
    if (this.landing.visible) this.landing.update(this.landingState());
  }

  /** weapon rows arrived (loadout card) */
  onWeaponsChanged() {
    if (this.landing.visible) this.landing.update(this.landingState());
    if (this.death.visible) this.death.update({ yourWeapon: this.currentWeapon() });
  }

  // ------------------------------------------------------------------ landing

  private async play(cs: string) {
    this.applyCallsign(cs);
    if (this.needsLoadout) {
      await this.openForge({ mode: 'first' }, 'landing');
      return;
    }
    if (this.game.alive) {
      this.landing.hide();
      this.lockAndPlay();
      return;
    }
    this.busy = true;
    this.landing.update(this.landingState());
    try {
      await this.deploy(true);
    } finally {
      this.busy = false;
      if (this.landing.visible) this.landing.update(this.landingState());
    }
  }

  private async quickPick(presetId: string, cs: string) {
    this.applyCallsign(cs);
    this.busy = true;
    this.landing.update(this.landingState());
    try {
      if (this.online) {
        if (this.game.alive) {
          await this.game.net.requestRedeploy?.();
          await this.waitFor(() => !this.game.alive, 3000);
        }
        await this.game.net.equipWeapon?.(presetId);
        await this.waitFor(() => this.game.me?.weaponId === presetId && !this.needsLoadout, 4000);
      } else {
        const w = this.game.net.getWeapon?.(presetId);
        if (w) this.game.equip(w);
      }
      await this.deploy(true);
    } catch (err) {
      this.game.hud.toast(esc(`Quick pick failed: ${(err as Error)?.message ?? err}`), { type: 'error' });
    } finally {
      this.busy = false;
      if (this.landing.visible) this.landing.update(this.landingState());
    }
  }

  /** respawn (online: after the server delay) and go to the game */
  private async deploy(keep: boolean) {
    if (this.online) {
      if (!this.game.alive) await this.game.requestRespawn(keep);
    } else if (!this.game.alive) {
      this.game.net.respawn(keep);
      this.game.respawn();
    }
    if (this.game.alive) {
      this.landing.hide();
      this.death.hide();
      this.pause.hide();
      this.lockAndPlay();
    }
  }

  private lockAndPlay() {
    this.syncHud();
    if (this.game.opts.e2e) return;
    void this.tryLock();
  }

  /**
   * Lock the pointer. Chrome refuses a re-lock for ~1s after the user pressed Esc to leave it,
   * so retry once after that cooldown (the Esc/click gesture is still active) before falling
   * back to the pause menu's RESUME button.
   */
  private async tryLock() {
    const input = this.game.input;
    if (await input.requestLock()) return;
    await new Promise((r) => setTimeout(r, 1100));
    if (input.locked || this.pause.visible || this.blocking || !this.game.alive) return;
    if (await input.requestLock()) return;
    if (this.game.alive && !input.locked && !input.padPlaying && !this.blocking) this.openPause();
  }

  // ------------------------------------------------------------------ pause

  private onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.repeat) return;
    if (this.forge || document.querySelector('[data-testid=confirm-dialog]')) return;
    if (this.pause.visible) {
      e.preventDefault();
      this.resume();
    } else if (this.screen === 'none' && this.game.alive && this.game.ready) {
      e.preventDefault();
      this.openPause();
    }
  }

  /** pointer lock changed (Esc in the browser releases it) */
  onLockChange(locked: boolean) {
    if (locked) {
      if (this.pause.visible) this.pause.hide();
      this.syncHud();
      return;
    }
    if (this.game.alive && this.screen === 'none' && !this.game.input.padPlaying) this.openPause();
  }

  openPause() {
    const me = this.game.me;
    this.pause.show({
      weapon: this.currentWeapon(),
      callsign: me?.name ?? this.callsign,
      hp: this.game.hp,
      kills: me?.kills ?? 0,
      deaths: me?.deaths ?? 0,
      online: this.online,
    });
    this.game.input.exitLock();
    this.syncHud();
  }

  resume() {
    this.pause.hide();
    this.lockAndPlay();
  }

  private async redeploy() {
    if (!this.game.alive) return;
    if (this.game.hp < 100) {
      const ok = await confirmDialog({
        title: 'Redeploy?',
        body: `You’re at ${Math.round(this.game.hp)} HP — redeploying now counts as a death.`,
        yes: 'Redeploy',
        danger: true,
      });
      if (!ok) return;
    }
    this.pause.hide();
    this.redeploying = true;
    if (this.online) {
      try {
        await this.game.net.requestRedeploy?.();
      } catch (err) {
        this.redeploying = false;
        this.game.hud.toast(esc(`Redeploy failed: ${(err as Error)?.message ?? err}`), { type: 'error' });
      }
    } else this.game.die('Redeploy');
  }

  private async leave() {
    const ok = await confirmDialog({ title: 'Leave match?', body: 'You’ll disconnect from the server. Your weapons stay in your library.', yes: 'Leave', danger: true });
    if (!ok) return;
    this.game.net.disconnect();
    this.pause.hide();
    this.landing.show({ ...this.landingState(), status: 'Left the match — PLAY to reconnect', statusKind: 'off' });
    this.landing.handlers = {
      onPlay: () => location.reload(),
      onForge: () => location.reload(),
      onQuickPick: () => location.reload(),
    };
    this.syncHud();
  }

  // ------------------------------------------------------------------ death

  /** Game.die(): the local player died (or redeployed / needs a loadout) */
  onDeath(message: string) {
    this.pause.hide();
    this.landing.hide();
    if (this.needsLoadout) {
      // a new player is "dead" until they forge / quick pick: that's the landing, not a death
      this.showLanding();
      return;
    }
    const redeploy = this.redeploying || message === 'Redeploy';
    this.redeploying = false;
    // the kill event may have arrived just before the player row update
    const recent = !redeploy && performance.now() - this.killedAt < 3000 ? this.deathInfo : {};
    this.deathInfo = { ...recent, redeploy, message, yourWeapon: this.currentWeapon() };
    if (!this.forge) this.death.show(this.deathInfo);
    this.syncHud();
  }

  /** kill feed: who killed us (may arrive just before / after the death) */
  private killedAt = -1e9;

  onKilledBy(info: Partial<DeathInfo>) {
    this.killedAt = performance.now();
    this.deathInfo = { ...this.deathInfo, ...info, redeploy: false };
    if (this.death.visible) this.death.update(this.deathInfo);
  }

  onRespawn() {
    this.death.hide();
    this.syncHud();
  }

  /** per frame: countdown ring */
  update() {
    if (!this.death.visible) return;
    const me = this.game.me;
    if (this.online && me?.respawnAt) this.death.setCountdown((me.respawnAt - Date.now()) / 1000, 3);
    else this.death.setCountdown(0, 3);
  }

  private async keepLoadout() {
    this.death.setBusy(true, 'Respawning…');
    try {
      await this.deploy(true);
    } finally {
      this.death.setBusy(false);
    }
  }

  /** death screen QUICK FORGE: one streamed design, registered + respawn (legacy generator as fallback) */
  private async quickForge(prompt: string) {
    const text = prompt.trim() || 'surprise me: something weird and fun';
    this.death.setBusy(true);
    this.death.setStatus(`FORGING · “${esc(text)}”…`);
    try {
      const { ForgeSession, describeForgeError, ForgeError } = await import('../forge/forgeClient');
      const session = new ForgeSession({
        playerIdentity: this.game.net.localId || undefined,
        baseUrl: this.forgeBase(),
        onChange: (s) => {
          const d = s.drafts[0];
          if (d && s.busy) {
            const last = d.components[d.components.length - 1]?.label;
            this.death.setStatus(`FORGING · ${esc(d.name || text)}${last ? ` · ${esc(last)} (${d.components.length})` : ''}…`);
          }
        },
      });
      await session.generate(text, { variants: 1 });
      const design = session.design;
      if (!design) {
        const fe = session.state.errorDetail;
        // forge unreachable: fall back to the server-side template generator
        if (fe && (fe.kind === 'network' || (fe.kind === 'http' && fe.status === 404))) {
          await this.legacyGenerate(text);
          return;
        }
        this.death.setStatus(esc(fe ? describeForgeError(fe) : (session.state.error ?? 'the forge produced nothing')), true);
        void ForgeError;
        return;
      }
      this.death.setStatus(`<span class="gen-name">${esc(design.name)}</span><span class="gen-stats">${design.components.length} parts · equipping…</span>`);
      await this.equipDesign(design, text);
    } catch (err) {
      console.error('[flow] quick forge failed', err);
      this.death.setStatus(esc(`Forge failed: ${(err as Error)?.message ?? err}`), true);
    } finally {
      this.death.setBusy(false);
    }
  }

  /** server-side template generation (generate_weapon procedure) / offline stub */
  async legacyGenerate(text: string) {
    const net = this.game.net;
    if (this.online && net.generateWeapon) {
      this.death.setStatus(`Generating “${esc(text)}”…`);
      const res = await net.generateWeapon(text, '');
      if (!res.ok) {
        this.death.setStatus(esc(res.message || 'generation failed'), true);
        return;
      }
      const w = res.weapon;
      this.death.setStatus(
        w ? `<span class="gen-name">${esc(w.name)}</span><span class="gen-msg">${esc(res.message)}</span>` : `weapon #${esc(res.weaponId)} (${esc(res.message)})`,
      );
      await this.deploy(true);
      return;
    }
    const w = await generateWeaponStub(text);
    w.id = await net.registerWeapon(w);
    net.respawn(false);
    this.game.equip(w);
    this.game.respawn();
    this.death.hide();
  }

  // ------------------------------------------------------------------ forge

  private forgeBase(): string {
    const p = this.params.get('forge');
    return p && /^https?:\/\//.test(p) ? p.replace(/\/+$/, '') : '';
  }

  private async openForge(
    o: { mode: ForgeEditorOptions['mode']; prompt?: string; autostart?: boolean; remix?: Weapon; seedCurrent?: boolean },
    from: Screen,
  ) {
    if (this.forge || this.forgeLoading) return;
    this.forgeLoading = true;
    this.forgeReturn = from;
    this.game.input.exitLock();
    let mod: typeof import('../forge/ForgeEditor');
    try {
      mod = await import('../forge/ForgeEditor');
    } catch (err) {
      this.forgeLoading = false;
      this.game.hud.toast(esc(`Couldn’t load the forge: ${(err as Error)?.message ?? err}`), { type: 'error' });
      return;
    }
    this.forgeLoading = false;
    let seed: ForgeEditorOptions['seed'] = { prompt: o.prompt, autostart: o.autostart };
    if (o.remix) {
      seed = o.remix.design
        ? { design: o.remix.design, title: `Remix: ${o.remix.name}`, prompt: '' }
        : { prompt: `${o.remix.prompt && !o.remix.prompt.startsWith('preset:') ? o.remix.prompt : o.remix.name}, but make it mine`, title: `Remix: ${o.remix.name}` };
    } else if (o.seedCurrent) {
      const w = this.currentWeapon();
      if (w?.design && w.owner === this.game.net.localId) seed = { design: w.design };
    }
    const alive = this.game.alive;
    const equipLabel = this.needsLoadout ? 'Equip & deploy' : alive ? 'Equip & redeploy' : 'Equip & respawn';
    // hide whatever was under it (it comes back on close)
    this.landing.hide();
    this.pause.hide();
    this.death.hide();
    this.forge = mod.openForgeEditor({
      mode: o.mode,
      playerName: this.game.me?.name ?? this.callsign ?? 'you',
      playerIdentity: this.game.net.localId || undefined,
      baseUrl: this.forgeBase(),
      seed,
      equipLabel,
      onEquip: (design, prompt) => this.equipDesign(design, prompt),
      onClose: () => this.onForgeClosed(),
    });
    this.syncHud();
  }

  private equipped = false;

  private onForgeClosed() {
    this.forge = null;
    if (this.equipped) {
      this.equipped = false;
      this.syncHud();
      return;
    }
    // back to where we came from
    const back = this.forgeReturn;
    if (back === 'landing' || this.needsLoadout) this.showLanding();
    else if (back === 'death' && !this.game.alive) this.death.show(this.deathInfo);
    else if (back === 'pause' && this.game.alive) this.openPause();
    else if (!this.game.alive) this.death.show(this.deathInfo);
    this.syncHud();
  }

  /**
   * Register a design and deploy with it. Dead (incl. new players): register_design equips it,
   * then respawn. Alive (Esc menu): register (library), redeploy, equip, respawn.
   */
  async equipDesign(design: ForgeDesign, prompt: string): Promise<void> {
    const net = this.game.net;
    if (!net.registerDesign) throw new Error('this server does not support forged weapons');
    if (!this.online) {
      const id = await net.registerDesign(design, prompt);
      const w = id ? net.getWeapon?.(id) : undefined;
      if (w) this.game.equip(w);
      if (!this.game.alive) {
        net.respawn(true);
        this.game.respawn();
      }
      this.finishEquip();
      return;
    }
    if (this.game.alive) {
      if (this.game.hp < 100) {
        const ok = await confirmDialog({
          title: 'Redeploy with this weapon?',
          body: `You’re at ${Math.round(this.game.hp)} HP — redeploying now counts as a death.`,
          yes: 'Equip & redeploy',
        });
        if (!ok) throw new Error('cancelled');
      }
      const id = await net.registerDesign(design, prompt);
      if (!id) throw new Error('the weapon didn’t arrive from the server');
      this.redeploying = true;
      await net.requestRedeploy?.();
      await this.waitFor(() => !this.game.alive, 4000);
      await net.equipWeapon?.(id);
      await this.waitFor(() => this.game.me?.weaponId === id, 4000);
    } else {
      const id = await net.registerDesign(design, prompt);
      if (!id) throw new Error('the weapon didn’t arrive from the server');
      await this.waitFor(() => this.game.me?.weaponId === id && !this.needsLoadout, 4000);
    }
    this.equipped = true;
    this.death.setBusy(true, 'Respawning…');
    try {
      await this.game.requestRespawn(true);
    } finally {
      this.death.setBusy(false);
    }
    if (!this.game.alive) {
      // still dead (respawn refused): show the death screen with the new loadout
      this.equipped = false;
      throw new Error('respawn failed — try KEEP LOADOUT');
    }
    this.finishEquip();
  }

  private finishEquip() {
    this.equipped = true;
    this.landing.hide();
    this.death.hide();
    this.pause.hide();
    const w = this.currentWeapon();
    if (w) this.game.hud.toast(`Equipped <b>${esc(w.name)}</b>`, { type: 'forge', ms: 3000 });
    // the forge closes itself after onEquip resolves; lock once it's gone
    setTimeout(() => this.lockAndPlay(), 200);
  }

  private async waitFor(pred: () => boolean, ms: number) {
    const t0 = performance.now();
    while (!pred() && performance.now() - t0 < ms) await sleep(40);
  }
}

/** offline: the sample weapons stand in for the presets (one per class) */
function offlinePresets() {
  const seen = new Set<string>();
  const out: { id: string; cls: string; name: string }[] = [];
  for (const w of getDefaultWeapons()) {
    if (!w.id || seen.has(w.class)) continue;
    seen.add(w.class);
    out.push({ id: w.id, cls: w.class, name: w.name });
  }
  return out;
}
