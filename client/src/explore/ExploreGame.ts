import * as THREE from 'three';
import { createRenderer, SKY_COLOR, type RenderContext } from '../engine/renderer';
import { initPhysics, FIXED_DT, type PhysicsContext } from '../engine/physics';
import { Input } from '../engine/input';
import { loadMap } from '../map/loadMap';
import { addBoundsColliders, expandBox } from '../map/bounds';
import { resolveMapUrl } from '../map/assetUrl';
import type { GameMap } from '../map/types';
import { PlayerController } from '../player/PlayerController';
import { CameraRig } from '../player/CameraRig';
import { TouchControls, touchDevice } from '../ui/TouchControls';
import { settings } from '../settings';
import { ExploreAudio } from './audio';
import { LANDMARKS, MAP_URL, MOON_DIR, NORTH_OFFSET_DEG, SECRETS, SPAWN, STREET_Y, type Landmark, type Secret } from './data';
import { NavGrid } from './navGrid';
import { Narrator } from './narrator';
import { clearProgress, loadProgress, prefs, saveProgress, WALK_MULT, type Progress } from './prefs';
import { Beacon, Dragon, Pigeons, Trail, makeArmillary, makeBell, makeBones, makeCart, makeGlow, makeKnife, makeLajkonik, makeMoon, makeSheep, makeWindow } from './props';
import { compassWord, legend, metres, place, relativeWords, tx } from './i18n';
import { ExploreUi, type JournalEntry, type Kind, type LabelInfo, type UiHost } from './ui';

type V3 = [number, number, number];

interface Target {
  kind: Kind;
  id: string;
  name: string;
  /** where the route ends (on the nav grid) */
  stand: THREE.Vector3;
  /** what to point at */
  look: THREE.Vector3;
}

interface Interactable {
  label: string;
  run(): void;
  /** the landmark story (always available inside a landmark; not announced as "something here") */
  info?: boolean;
}

const HEJNAL_FIRST = 45;
const HEJNAL_EVERY = 150;
const DRAGON_RANGE = 75;
const LABEL_RANGE = 160;
/** the guide's carrot sits this far ahead along the route */
const LOOKAHEAD = 2.4;
const ARRIVE = 3;
const RYNEK_CENTER = new THREE.Vector3(111, STREET_Y, -48);

const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** compass bearing (0 = north, clockwise) of a world-space direction */
export function bearingOf(dx: number, dz: number): number {
  return (((Math.atan2(dz, dx) * 180) / Math.PI + NORTH_OFFSET_DEG) % 360 + 360) % 360;
}

const roundDist = (m: number) => (m < 20 ? Math.max(1, Math.round(m)) : m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10);
/** "40 metres" / "40 metrów", rounded for speech */
const dist = (m: number) => metres(roundDist(m));

/**
 * CityScape: walk the stylised medieval city, discover landmarks, find legends.
 * Single-player, no combat. Reuses the engine (renderer, Rapier, Input, PlayerController,
 * CameraRig) and adds guidance for players who cannot (or would rather not) navigate freely:
 * a guide with a route, a sound beacon, footprints, auto-walk and instant travel.
 */
export class ExploreGame implements UiHost {
  rc!: RenderContext;
  physics!: PhysicsContext;
  input!: Input;
  player!: PlayerController;
  nav!: NavGrid;
  map!: GameMap;
  ui!: ExploreUi;
  narrator!: Narrator;
  readonly audio = new ExploreAudio();
  readonly rig = new CameraRig();
  touch?: TouchControls;
  state: 'loading' | 'title' | 'playing' = 'loading';
  progress: Progress = loadProgress();

  private sun?: THREE.DirectionalLight;
  /** the invisible box around the map (ignored when looking for open sky) */
  private boundsColliders = new Set<number>();
  private acc = 0;
  private last = performance.now();
  private time = 0;

  // ---- guide
  target: Target | null = null;
  private path: V3[] | null = null;
  private pathSeg = 0;
  private pathAt = -10;
  autoWalk = false;
  private stuckCheck = { t: 0, x: 0, z: 0, count: 0 };
  private lastLookInput = -10;

  // ---- blind mode
  /** snap turn in progress: the yaw the camera is easing to */
  private turnGoal: number | null = null;
  private sonarAt = 0;
  private blockedFor = 0;
  private bumpAt = -10;
  /** route coach: path waypoint whose turn was last announced, and when we last nudged */
  private coachedTurn = -1;
  private coachNudgeAt = -10;
  private offRouteFor = 0;
  private lastPlace: string | null = null;
  private lastPrompt: string | null = null;
  private pingAt = 0;
  private trailAt = 0;

  // ---- world
  private readonly beacons = new Map<string, Beacon>();
  private readonly trail = new Trail();
  private dragon!: Dragon;
  private dragonNext = 8;
  private dragonGone = 0;
  private pigeons!: Pigeons;
  private pigeonCenter = new THREE.Vector3();
  private cooAt = 0;
  private lajkonik!: THREE.Group;
  private bell!: THREE.Group;
  private bellSwing = 0;
  private sphere!: THREE.Group;
  private sphereSpin = 0;
  private sheep!: THREE.Group;
  private sheepHome = new THREE.Vector3();
  private sheepBack = 0;
  carrying = false;
  private moon!: ReturnType<typeof makeMoon>;
  private moonGaze = 0;
  private hejnalNext = HEJNAL_FIRST;
  private hejnalEnds = 0;
  private hejnalLastAt = -999;
  private orbit = 0;
  private dragging: number | null = null;
  private doneShown = false;
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();

  async boot(container: HTMLElement) {
    const boot = (window as Window & { __boot?: { stage(t: string): void } }).__boot;
    this.rc = createRenderer(container);
    const cam = this.rc.camera;
    cam.far = 2600;
    cam.updateProjectionMatrix();
    this.rc.scene.fog = new THREE.Fog(SKY_COLOR, 220, 1400);
    this.rc.scene.traverse((o) => {
      if ((o as THREE.DirectionalLight).isDirectionalLight) this.sun = o as THREE.DirectionalLight;
    });
    if (this.sun) this.rc.scene.add(this.sun.target);

    this.physics = await initPhysics();
    const canvas = this.rc.renderer.domElement;
    this.input = new Input(canvas);
    this.narrator = new Narrator(document.body);
    this.ui = new ExploreUi(this);
    settings.set('headBob', !prefs.current.calmMotion);

    boot?.stage(prefs.current.lang === 'pl' ? 'Wczytywanie średniowiecznego Krakowa…' : 'Loading medieval Kraków…');
    const url = resolveMapUrl(MAP_URL)!;
    const [map, nav] = await Promise.all([loadMap(url, this.physics, this.rc.scene, { shell: false }), NavGrid.load()]);
    this.map = map;
    this.nav = nav;
    this.physics.world.step();
    const bb = map.meta?.bbox ?? { min: [-447, 0, -447], max: [447, 60, 447] };
    const bounds = addBoundsColliders(this.physics, expandBox(bb as { min: V3; max: V3 }, 0.5));
    this.boundsColliders = new Set(bounds.map((c) => c.handle));
    this.map.colliders.push(...bounds);

    this.player = new PlayerController(this.physics, this.input, new THREE.Vector3(...SPAWN.pos));
    this.player.yaw = SPAWN.yaw;
    this.player.arrowKeysWalk = true;
    this.player.turnKeys = { left: [], right: [] };
    this.player.onLand = (v) => {
      this.rig.land(v);
      this.audio.land(v);
    };
    this.rig.onStep = (speed) => this.audio.footstep(speed);

    this.buildWorld();
    this.setupPointer(canvas);
    if (touchDevice()) {
      document.documentElement.classList.add('is-touch');
      const touch = new TouchControls();
      touch.onLook = (dx, dy) => {
        this.input.addLook(dx, dy);
        this.lastLookInput = this.time;
      };
      touch.onMenu = () => this.ui.open('menu');
      this.touch = touch;
      this.input.touch = touch;
    }
    this.audio.setAmbience(prefs.current.ambience);
    prefs.onChange((p) => {
      this.audio.setAmbience(p.ambience);
      this.refreshBeacons();
      if (!p.pathTrail) this.trail.set(null);
    });

    // compile every material now, not on the first frames of play (a long hitch on start)
    await this.rc.renderer.compileAsync(this.rc.scene, this.rc.camera).catch(() => {});
    this.state = 'title';
    this.ui.open('title');
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ world

  private ground(x: number, z: number): number {
    return this.nav.heightAt(x, z) ?? this.nav.nearest(x, z, 10)?.y ?? STREET_Y;
  }

  /**
   * Open sky (or a real ceiling) above a floor point. Hills are single-sided shells over a base
   * plane; standing under one puts the camera inside the hill. Rapier reports featureId 1 for a
   * ray that hits a triangle's back face.
   */
  private openAbove = (x: number, y: number, z: number): boolean => {
    const { RAPIER, world } = this.physics;
    const hit = world.castRayAndGetNormal(
      new RAPIER.Ray({ x, y: y + 0.05, z }, { x: 0, y: 1, z: 0 }),
      200,
      false,
      undefined,
      undefined,
      this.player?.collider,
      undefined,
      (c) => !this.boundsColliders.has(c.handle),
    );
    return !hit || hit.featureId !== 1;
  };

  private snapped(x: number, z: number): THREE.Vector3 {
    const n = this.nav.nearest(x, z, 40, this.openAbove);
    return n ? new THREE.Vector3(n.x, n.y, n.z) : new THREE.Vector3(x, this.ground(x, z), z);
  }

  /** first wall hit from `from` along horizontal directions, or null (for wall-mounted props) */
  private nearestWall(from: THREE.Vector3, max = 12): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    const { RAPIER, world } = this.physics;
    let best: { point: THREE.Vector3; normal: THREE.Vector3; d: number } | null = null;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const dir = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      const hit = world.castRayAndGetNormal(new RAPIER.Ray(from, dir), max, true, undefined, undefined, this.player?.collider);
      if (hit && Math.abs(hit.normal.y) < 0.4 && (!best || hit.timeOfImpact < best.d)) {
        best = {
          d: hit.timeOfImpact,
          point: new THREE.Vector3(from.x + dir.x * hit.timeOfImpact, from.y, from.z + dir.z * hit.timeOfImpact),
          normal: new THREE.Vector3(hit.normal.x, 0, hit.normal.z).normalize(),
        };
      }
    }
    return best;
  }

  private ceilingAbove(at: THREE.Vector3, max = 20): number {
    const { RAPIER, world } = this.physics;
    const hit = world.castRay(new RAPIER.Ray({ x: at.x, y: at.y + 0.5, z: at.z }, { x: 0, y: 1, z: 0 }), max, true);
    return hit ? at.y + 0.5 + hit.timeOfImpact : at.y + 6;
  }

  private place(obj: THREE.Object3D, x: number, z: number, faceX?: number, faceZ?: number): THREE.Vector3 {
    const p = this.snapped(x, z);
    obj.position.copy(p);
    if (faceX !== undefined && faceZ !== undefined) obj.rotation.y = Math.atan2(-(faceZ - p.z), faceX - p.x);
    this.rc.scene.add(obj);
    return p;
  }

  private buildWorld() {
    const scene = this.rc.scene;
    for (const l of LANDMARKS) {
      const b = new Beacon(new THREE.Vector3(...l.look), this.ground(l.stand[0], l.stand[1]));
      this.beacons.set(l.id, b);
      scene.add(b.root);
    }
    scene.add(this.trail.mesh);
    this.refreshBeacons();

    // the dragon at the cave mouth (the south foot of Wawel Hill), facing out over open ground
    this.dragon = new Dragon();
    const den = this.place(this.dragon.root, -395, 141, -395, 152);
    this.dragon.root.position.copy(den);
    scene.add(...this.dragon.effects);

    // pigeons in the square
    this.pigeonCenter.copy(this.snapped(100, -10));
    this.pigeons = new Pigeons(this.pigeonCenter);
    scene.add(this.pigeons.mesh);

    // the knife under the Cloth Hall passage ceiling
    const passage = this.snapped(112, -46);
    const ceiling = this.ceilingAbove(passage);
    const knife = makeKnife(Math.max(0.5, ceiling - passage.y - 3.6));
    knife.position.set(passage.x, ceiling, passage.z);
    scene.add(knife);

    this.place(makeCart(), 153, -40, 149, -40);
    this.lajkonik = makeLajkonik();
    this.place(this.lajkonik, 151, -81, 147, -78);
    this.sphere = makeArmillary();
    this.place(this.sphere, 42, -166);
    this.place(makeBones(), -312, 71, -315, 75);
    this.bell = makeBell();
    this.place(this.bell, -306, 63, -308, 66);
    this.sheep = makeSheep();
    this.sheepHome.copy(this.place(this.sheep, -227, 108, -224, 106));

    // the chakra glow and the Pope's window go on the nearest wall
    const chakra = this.snapped(-298, 114);
    const wall = this.nearestWall(new THREE.Vector3(chakra.x, chakra.y + 1.2, chakra.z));
    const glow = makeGlow(0xb48cff, 1.6);
    glow.position.copy(wall ? wall.point.addScaledVector(wall.normal, 0.1) : chakra.clone().setY(chakra.y + 1.2));
    scene.add(glow);
    const papal = this.snapped(-36, -24);
    const pw = this.nearestWall(new THREE.Vector3(papal.x, papal.y + 4.5, papal.z), 16);
    const win = makeWindow();
    if (pw) {
      win.position.copy(pw.point).addScaledVector(pw.normal, 0.08);
      win.rotation.y = Math.atan2(pw.normal.x, pw.normal.z);
    } else win.position.set(papal.x, papal.y + 4.5, papal.z);
    scene.add(win);

    this.moon = makeMoon();
    this.moon.showTwardowski(this.found('twardowski'));
    scene.add(this.moon.sprite);
  }

  private refreshBeacons() {
    for (const l of LANDMARKS) {
      const b = this.beacons.get(l.id)!;
      const isTarget = this.target?.kind === 'landmark' && this.target.id === l.id;
      b.root.visible = prefs.current.beacons && (!this.visited(l.id) || isTarget);
    }
  }

  // ------------------------------------------------------------------ pointer: drag-to-look / lock

  private setupPointer(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || this.state !== 'playing' || this.ui.blocking || this.input.locked) return;
      // default: one click locks the pointer and the mouse then just looks (no button held)
      if (!prefs.current.dragLook) void this.input.requestLock();
      // drag-look: the opt-in mode, and a fallback while the lock is pending or refused
      this.dragging = e.pointerId;
      if (prefs.current.dragLook) {
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.dragging || this.input.locked) return;
      this.input.addLook(e.movementX, e.movementY);
      this.lastLookInput = this.time;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.dragging) return;
      this.dragging = null;
      canvas.style.cursor = '';
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------------ progress

  visited(id: string) {
    return this.progress.landmarks.includes(id);
  }

  found(id: string) {
    return this.progress.secrets.includes(id);
  }

  private discover(l: Landmark) {
    if (this.visited(l.id)) return;
    this.progress.landmarks.push(l.id);
    saveProgress(this.progress);
    this.audio.discover();
    const pl = place(l);
    this.ui.toast(tx().discovered, pl.name, pl.polish);
    this.narrator.say(`${pl.short} ${tx().g.pressEStory}`);
    this.refreshBeacons();
    // the guide moves on once its target is found (after the walk there finishes)
    if (this.target?.kind === 'landmark' && this.target.id === l.id && !this.autoWalk) this.moveOnSoon();
    this.checkComplete();
  }

  /** a few seconds after reaching / finding the guide's target, point the guide at the next place */
  private moveOnSoon() {
    const was = this.target;
    setTimeout(() => {
      if (this.state !== 'playing' || this.target !== was) return;
      this.pickNextTarget(true);
      this.narrator.say(tx().g.walkOn);
    }, 5000);
  }

  private findSecret(id: string, openCard: boolean) {
    const s = SECRETS.find((x) => x.id === id)!;
    const first = !this.found(id);
    if (first) {
      this.progress.secrets.push(id);
      saveProgress(this.progress);
      this.audio.secret();
      this.ui.toast(tx().legendFound, legend(s).name);
      if (id === 'twardowski') this.moon.showTwardowski(true);
    }
    if (openCard) {
      this.ui.showCard({ kicker: first ? tx().legendFound : tx().legendKicker, title: legend(s).name, paragraphs: legend(s).found });
      this.narrator.say(legend(s).found.join(' '));
    } else this.narrator.say(legend(s).found.join(' '));
    if (this.target?.kind === 'secret' && this.target.id === id) this.setTarget(null);
    this.checkComplete();
  }

  private checkComplete() {
    if (this.doneShown) return;
    if (this.progress.landmarks.length >= LANDMARKS.length && this.progress.secrets.length >= SECRETS.length) {
      this.doneShown = true;
      setTimeout(() => {
        if (!this.ui.blocking) this.ui.open('done');
        this.narrator.say(tx().g.allDone);
      }, 6000);
    }
  }

  // ------------------------------------------------------------------ UiHost

  start() {
    this.state = 'playing';
    this.ui.setHudVisible(true);
    this.player.teleport(new THREE.Vector3(...SPAWN.pos), SPAWN.yaw);
    const returning = this.progress.landmarks.length > 0;
    const rynek = LANDMARKS[0];
    if (!this.visited(rynek.id)) {
      this.progress.landmarks.push(rynek.id);
      saveProgress(this.progress);
      this.refreshBeacons();
    }
    this.audio.discover();
    const g = tx().g;
    this.ui.toast(returning ? g.welcomeBack : g.welcome, place(rynek).name, place(rynek).polish);
    this.narrator.say(returning ? g.welcomeBackLine(this.progress.landmarks.length, LANDMARKS.length) : g.welcomeLine(place(rynek).short));
    this.pickNextTarget(false);
    this.grabMouse();
  }

  resume() {
    this.grabMouse();
  }

  /** "automatic" mouse look: lock the pointer so moving the mouse turns the view, no button held */
  private grabMouse() {
    const p = prefs.current;
    if (this.state === 'playing' && !p.dragLook && !this.touch && !this.input.locked) void this.input.requestLock();
  }

  click() {
    this.audio.click();
  }

  readAloud(text: string) {
    this.narrator.speakNow(text);
  }

  voices() {
    return { options: this.narrator.voiceOptions(), basic: this.narrator.voiceIsBasic, polish: this.narrator.hasPolishVoice };
  }

  toggleBlindMode() {
    const on = !prefs.current.blindMode;
    prefs.setBlindMode(on);
    this.narrator.speakNow(on ? tx().g.blindOn : tx().g.blindOff);
  }

  /** the UI opened a screen: free the mouse so its buttons can be clicked */
  screenOpened() {
    this.input.exitLock();
  }

  /** display name in the current language ("a hidden legend" until a legend is found) */
  private entryName(kind: Kind, id: string): string {
    if (kind === 'landmark') return place(LANDMARKS.find((l) => l.id === id)!).name;
    return this.found(id) ? legend(SECRETS.find((s) => s.id === id)!).name : tx().hiddenLegendLower;
  }

  private entry(kind: Kind, id: string): Landmark | Secret | undefined {
    return kind === 'landmark' ? LANDMARKS.find((l) => l.id === id) : SECRETS.find((s) => s.id === id);
  }

  guide(kind: Kind, id: string) {
    const e = this.entry(kind, id);
    if (!e) return;
    const stand = this.snapped(e.stand[0], e.stand[1]);
    const look = 'look' in e ? new THREE.Vector3(...e.look) : stand.clone().setY(stand.y + 1.5);
    const name = this.entryName(kind, id);
    this.setTarget({ kind, id, name, stand, look });
    const d = this.describeRoute();
    this.narrator.say(tx().g.guiding(name, d), { interrupt: true });
  }

  walk(kind: Kind, id: string) {
    this.guide(kind, id);
    this.startWalk();
  }

  travel(kind: Kind, id: string) {
    const e = this.entry(kind, id);
    if (!e) return;
    const stand = this.snapped(e.stand[0], e.stand[1]);
    const look = 'look' in e ? new THREE.Vector3(...e.look) : null;
    this.stopWalk(false);
    void this.ui.fade(() => {
      const yaw = look ? Math.atan2(-(look.x - stand.x), -(look.z - stand.z)) : this.player.yaw;
      this.player.teleport(stand, yaw);
      if (look) this.lookAt(look);
      this.path = null;
    });
    this.narrator.say(tx().g.nowAt(this.entryName(kind, id)), { interrupt: true });
  }

  toggleWalk() {
    if (this.autoWalk) this.stopWalk(true);
    else this.startWalk();
  }

  nextTarget() {
    this.pickNextTarget(true, true);
  }

  stopGuide() {
    this.setTarget(null);
    this.narrator.say(tx().g.guideOff, { interrupt: true });
  }

  interact() {
    const it = this.interactable();
    if (it) {
      it.run();
      return;
    }
    this.narrator.say(tx().g.nothingHere, { interrupt: true });
  }

  describe() {
    const f = this.player.feet;
    const parts: string[] = [];
    const here = this.currentLandmark();
    const g = tx().g;
    parts.push(here ? g.youAreAt(place(here).name) : g.youAreIn(tx().areaIn[this.area()]));
    const heading = this.heading();
    parts.push(g.facing(compassWord(heading)));
    const near = LANDMARKS.filter((l) => l !== here)
      .map((l) => ({ l, d: dist2(f.x, f.z, l.at[0], l.at[1]) }))
      .filter((x) => x.d < 220)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    if (near.length) {
      parts.push(
        g.nearby +
          near.map(({ l, d }) => g.nearItem(place(l).name, this.visited(l.id) ? '' : g.notVisitedYet, dist(d), this.relTo(l.at[0], l.at[1]))).join('; ') +
          '.',
      );
    }
    const it = this.interactable();
    if (it) parts.push(g.pressETo(it.label));
    if (this.target) parts.push(g.guideTaking(this.target.name, this.describeRoute()));
    else parts.push(g.pressG);
    this.narrator.say(parts.join(' '), { interrupt: true, ms: 16000 });
  }

  resetProgress() {
    clearProgress();
    this.progress = loadProgress();
    this.doneShown = false;
    this.moon.showTwardowski(false);
    this.carrying = false;
    this.sheep.visible = true;
    this.ui.setCarrying(false);
    this.setTarget(null);
    this.ui.closeScreen();
    this.start();
  }

  journal() {
    const f = this.player.feet;
    const landmarks: JournalEntry[] = LANDMARKS.map((l, i) => ({
      kind: 'landmark',
      id: l.id,
      num: i + 1,
      name: place(l).name,
      sub: place(l).polish ? tx().sayIt(place(l).polish, place(l).say) : undefined,
      done: this.visited(l.id),
      text: this.visited(l.id) ? place(l).short : tx().notVisited,
      x: l.at[0],
      z: l.at[1],
      target: this.target?.kind === 'landmark' && this.target.id === l.id,
    }));
    const secrets: JournalEntry[] = SECRETS.map((s, i) => ({
      kind: 'secret',
      id: s.id,
      num: i + 1,
      name: legend(s).name,
      done: this.found(s.id),
      text: this.found(s.id) ? legend(s).found.join(' ') : legend(s).hint,
      x: s.at[0],
      z: s.at[1],
      target: this.target?.kind === 'secret' && this.target.id === s.id,
    }));
    return { landmarks, secrets, me: { x: f.x, z: f.z, heading: this.heading() } };
  }

  // ------------------------------------------------------------------ guide

  private setTarget(t: Target | null) {
    this.target = t;
    this.path = null;
    this.pathAt = -10;
    if (!t) {
      this.stopWalk(false);
      this.trail.set(null);
    }
    this.refreshBeacons();
  }

  /** nearest unvisited landmark (or, with `cycle`, the next one after the current target) */
  private pickNextTarget(announce: boolean, cycle = false) {
    const f = this.player.feet;
    const open = LANDMARKS.filter((l) => !this.visited(l.id)).sort((a, b) => dist2(f.x, f.z, a.at[0], a.at[1]) - dist2(f.x, f.z, b.at[0], b.at[1]));
    let pick: Landmark | undefined = open[0];
    if (cycle && this.target?.kind === 'landmark') {
      const pool = open.length ? open : LANDMARKS;
      const i = pool.findIndex((l) => l.id === this.target!.id);
      pick = pool[(i + 1) % pool.length];
    }
    if (!pick) {
      const s = SECRETS.find((x) => !this.found(x.id) && x.id !== 'twardowski');
      if (s) {
        if (announce) this.guide('secret', s.id);
        else this.setTarget({ kind: 'secret', id: s.id, name: tx().hiddenLegendLower, stand: this.snapped(s.stand[0], s.stand[1]), look: this.snapped(s.stand[0], s.stand[1]) });
      } else this.setTarget(null);
      return;
    }
    if (announce) this.guide('landmark', pick.id);
    else this.setTarget({ kind: 'landmark', id: pick.id, name: place(pick).name, stand: this.snapped(pick.stand[0], pick.stand[1]), look: new THREE.Vector3(...pick.look) });
  }

  private startWalk() {
    if (!this.target) this.pickNextTarget(false);
    if (!this.target) return;
    this.autoWalk = true;
    this.player.autoRun = false;
    this.stuckCheck = { t: this.time, x: this.player.feet.x, z: this.player.feet.z, count: 0 };
    this.ensurePath(true);
    this.narrator.say(tx().g.walking(this.target.name), { interrupt: true });
  }

  private stopWalk(announce: boolean) {
    if (!this.autoWalk) return;
    this.autoWalk = false;
    this.player.steer = null;
    if (announce) this.narrator.say(tx().g.stopped, { interrupt: true });
  }

  private ensurePath(force = false) {
    if (!this.target) return;
    const f = this.player.feet;
    const stale = !this.path || force || (this.offPath() > 6 && this.time - this.pathAt > 1);
    if (!stale) return;
    this.path = this.nav.findPath([f.x, f.z], [this.target.stand.x, this.target.stand.z]);
    this.pathSeg = 0;
    this.pathAt = this.time;
    if (!this.path) this.trail.set(null);
  }

  /** horizontal distance from the player to the current path */
  private offPath(): number {
    if (!this.path) return Infinity;
    const f = this.player.feet;
    let best = Infinity;
    const end = Math.min(this.path.length - 1, this.pathSeg + 4);
    for (let i = this.pathSeg; i < end; i++) best = Math.min(best, segDist(f.x, f.z, this.path[i], this.path[i + 1]).d);
    return best;
  }

  /** move pathSeg forward to the segment nearest the player; returns the projected point */
  private trackPath(): { x: number; z: number; seg: number; t: number } | null {
    const p = this.path;
    if (!p || p.length < 2) return null;
    const f = this.player.feet;
    let best = { d: Infinity, seg: this.pathSeg, t: 0 };
    const end = Math.min(p.length - 1, this.pathSeg + 4);
    for (let i = this.pathSeg; i < end; i++) {
      const r = segDist(f.x, f.z, p[i], p[i + 1]);
      if (r.d < best.d) best = { d: r.d, seg: i, t: r.t };
    }
    this.pathSeg = best.seg;
    const a = p[best.seg];
    const b = p[best.seg + 1];
    return { x: a[0] + (b[0] - a[0]) * best.t, z: a[2] + (b[2] - a[2]) * best.t, seg: best.seg, t: best.t };
  }

  /** the route ahead of the player as floor points, starting at the projection */
  private routeAhead(proj: { x: number; z: number; seg: number }): V3[] {
    const p = this.path!;
    const y = this.ground(proj.x, proj.z);
    return [[proj.x, y, proj.z], ...p.slice(proj.seg + 1)];
  }

  /** point LOOKAHEAD metres along the route */
  private carrot(route: V3[]): V3 {
    let left = LOOKAHEAD;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (len >= left) {
        const k = left / len;
        return [a[0] + (b[0] - a[0]) * k, a[1], a[2] + (b[2] - a[2]) * k];
      }
      left -= len;
    }
    return route[route.length - 1];
  }

  private routeLength(route: V3[]): number {
    let s = 0;
    for (let i = 0; i < route.length - 1; i++) s += Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][2] - route[i][2]);
    return s;
  }

  /** "Head ahead to your left for 40 metres, then turn right. 120 metres in all." */
  private describeRoute(): string {
    if (!this.target) return '';
    this.ensurePath();
    const proj = this.trackPath();
    if (!this.path || !proj) {
      const t = this.target.stand;
      return tx().g.itIs(dist(dist2(this.player.feet.x, this.player.feet.z, t.x, t.z)), this.relTo(t.x, t.z));
    }
    const route = this.routeAhead(proj);
    const total = this.routeLength(route);
    const g = tx().g;
    if (total < ARRIVE + 1) return g.there;
    const first = this.carrot(route);
    let out = g.head(this.relTo(first[0], first[2]));
    // first real turn along the route
    let run = 0;
    for (let i = 1; i < route.length - 1; i++) {
      const a = route[i - 1];
      const b = route[i];
      const c = route[i + 1];
      run += Math.hypot(b[0] - a[0], b[2] - a[2]);
      const h1 = Math.atan2(b[2] - a[2], b[0] - a[0]);
      const h2 = Math.atan2(c[2] - b[2], c[0] - b[0]);
      const turn = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
      if (Math.abs(turn) > 0.6 && run > 4) {
        // +x north / +z east: a positive turn (x towards z) is a right turn, seen from above
        out += g.thenTurn(dist(run), turn > 0);
        break;
      }
    }
    return `${out}.${g.inAll(dist(total))}`;
  }

  private updateGuide(dt: number, playing: boolean) {
    this.player.steer = null;
    const t = this.target;
    if (!t || this.state !== 'playing') return;
    this.ensurePath();
    const proj = this.trackPath();
    const f = this.player.feet;
    const left = proj ? this.routeLength(this.routeAhead(proj)) : dist2(f.x, f.z, t.stand.x, t.stand.z);

    // footprints (refreshed a few times a second so they start at your feet)
    if (prefs.current.pathTrail && proj && this.time - this.trailAt > 0.25) {
      this.trailAt = this.time;
      this.trail.set(this.routeAhead(proj));
    }

    // sound beacon: faster pings as you get closer
    if (playing && prefs.current.soundBeacon && this.time >= this.pingAt) {
      const d = dist2(f.x, f.z, t.stand.x, t.stand.z);
      const near = 1 - Math.min(1, d / 200);
      this.pingAt = this.time + 0.8 + 1.8 * (1 - near);
      this.audio.ping({ x: t.stand.x, y: t.stand.y + 2, z: t.stand.z }, near);
    }

    if (!this.autoWalk) return;
    if (!playing) return;
    if (left < ARRIVE || !proj) {
      this.stopWalk(false);
      if (left < ARRIVE) {
        this.lookAt(t.look);
        this.narrator.say(tx().g.arrived(t.name), { interrupt: true });
        if (t.kind === 'landmark' && this.visited(t.id)) this.moveOnSoon();
      } else this.narrator.say(tx().g.noWay, { interrupt: true });
      return;
    }
    const c = this.carrot(this.routeAhead(proj));
    const dir = this.tmp.set(c[0] - f.x, 0, c[2] - f.z);
    if (dir.lengthSq() > 1e-4) {
      dir.normalize();
      this.player.steer = dir.clone();
      if (prefs.current.autoTurn && this.time - this.lastLookInput > 2) {
        const want = Math.atan2(-dir.x, -dir.z);
        const diff = Math.atan2(Math.sin(want - this.player.yaw), Math.cos(want - this.player.yaw));
        const rate = prefs.current.calmMotion ? 1.8 : 3;
        this.player.yaw += diff * (1 - Math.exp(-rate * dt));
        this.player.pitch *= 1 - Math.min(1, dt * 2);
      }
    }
    // stuck? hop, re-route, and in the end lift the player past the obstacle
    const sc = this.stuckCheck;
    if (this.time - sc.t > 1.5) {
      const moved = dist2(f.x, f.z, sc.x, sc.z);
      sc.count = moved < 0.5 ? sc.count + 1 : 0;
      sc.t = this.time;
      sc.x = f.x;
      sc.z = f.z;
      if (sc.count === 1) this.player.queueJump();
      else if (sc.count === 2) this.ensurePath(true);
      else if (sc.count >= 3 && this.path) {
        const next = this.path[Math.min(this.path.length - 1, this.pathSeg + 1)];
        this.player.teleport(new THREE.Vector3(next[0], next[1] + 0.05, next[2]));
        sc.count = 0;
      }
    }
  }

  // ------------------------------------------------------------------ helpers

  private heading(): number {
    return bearingOf(-Math.sin(this.player.yaw), -Math.cos(this.player.yaw));
  }

  /** direction words from the player's facing to a point */
  private relTo(x: number, z: number): string {
    const f = this.player.feet;
    const dx = x - f.x;
    const dz = z - f.z;
    const yaw = this.player.yaw;
    const fwd = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
    const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
    return relativeWords(Math.atan2(right, fwd));
  }

  private currentLandmark(): Landmark | null {
    const f = this.player.feet;
    // inside several (St Mary's sits inside the Market Square): the smallest, most specific wins
    let best: Landmark | null = null;
    for (const l of LANDMARKS) {
      if (dist2(f.x, f.z, l.at[0], l.at[1]) < l.radius && (!best || l.radius < best.radius)) best = l;
    }
    return best;
  }

  private area(): 'hill' | 'belowHill' | 'outside' | 'streets' {
    const f = this.player.feet;
    if (f.y > 15) return 'hill';
    if (f.x < -230) return 'belowHill';
    if (f.x > 360) return 'outside';
    return 'streets';
  }

  private lookAt(target: THREE.Vector3) {
    const eye = this.player.eye(this.tmp);
    const d = target.clone().sub(eye);
    if (d.lengthSq() < 1e-6) return;
    d.normalize();
    this.player.yaw = Math.atan2(-d.x, -d.z);
    this.player.pitch = Math.max(-0.6, Math.min(0.6, Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))));
  }

  private secretInRange(id: string): Secret | null {
    const s = SECRETS.find((x) => x.id === id)!;
    const f = this.player.feet;
    return dist2(f.x, f.z, s.at[0], s.at[1]) <= s.radius ? s : null;
  }

  private interactable(): Interactable | null {
    const f = this.player.feet;
    const den = this.dragon.root.position;
    if (this.carrying && dist2(f.x, f.z, den.x, den.z) < 12 && this.dragon.presence > 0.9) {
      return { label: tx().g.feedDragon, run: () => this.feedDragon() };
    }
    for (const s of SECRETS) {
      if (!s.verb || !this.secretInRange(s.id)) continue;
      if (s.id === 'owca') {
        if (this.carrying || !this.sheep.visible) continue;
        return { label: legend(s).verb ?? s.verb, run: () => this.pickUpSheep() };
      }
      return { label: legend(s).verb ?? s.verb, run: () => this.useSecret(s) };
    }
    const here = this.currentLandmark();
    if (here) {
      return {
        label: tx().g.learnAbout(place(here).name),
        info: true,
        run: () => {
          const pv = place(here);
          this.ui.showCard({ kicker: tx().landmark, title: pv.name, polish: pv.polish, say: pv.say, paragraphs: pv.story, fact: pv.fact });
          this.narrator.say(`${pv.name}. ${pv.story.join(' ')} ${pv.fact}`);
        },
      };
    }
    return null;
  }

  private useSecret(s: Secret) {
    switch (s.id) {
      case 'dzwon':
        this.audio.bell({ x: this.bell.position.x, y: this.bell.position.y + 3, z: this.bell.position.z });
        this.narrator.say(tx().g.bellSound, { soundOnly: true });
        this.bellSwing = 1;
        break;
      case 'kopernik':
        this.audio.shimmer(this.sphere.position);
        this.sphereSpin = 4;
        break;
      case 'lajkonik':
        this.audio.bonk(this.lajkonik.position);
        this.narrator.say(tx().g.bonkSound, { soundOnly: true });
        this.lajkonik.userData.tap = 1;
        break;
      case 'obwarzanek':
        this.progress.obwarzanki++;
        saveProgress(this.progress);
        if (this.found('obwarzanek')) {
          const n = this.progress.obwarzanki;
          this.narrator.say(tx().g.anotherBagel(n), { interrupt: true });
          this.audio.click();
          return;
        }
        break;
    }
    this.findSecret(s.id, true);
  }

  private pickUpSheep() {
    this.carrying = true;
    this.sheep.visible = false;
    this.ui.setCarrying(true);
    this.audio.click();
    this.narrator.say(tx().g.pickSheep, { interrupt: true });
    this.guide('landmark', 'smok');
  }

  private feedDragon() {
    this.carrying = false;
    this.ui.setCarrying(false);
    const p = this.dragon.root.position;
    this.audio.dragonBurst({ x: p.x, y: p.y + 3, z: p.z });
    this.narrator.say(tx().g.gulp, { soundOnly: true, ms: 3000 });
    setTimeout(() => {
      this.dragon.puff();
      this.dragonGone = 30;
      this.narrator.say(tx().g.bang, { soundOnly: true, ms: 3000 });
      this.findSecret('owca', true);
    }, 2400);
    this.sheepBack = 35;
  }

  private playHejnal() {
    const l = LANDMARKS.find((x) => x.id === 'mariacki')!;
    const tower = { x: l.look[0], y: l.look[1] - 6, z: l.look[2] };
    const len = this.audio.hejnal(tower) || 11;
    this.hejnalLastAt = this.time;
    this.hejnalEnds = this.time + len;
    const f = this.player.feet;
    if (dist2(f.x, f.z, tower.x, tower.z) < 260) {
      this.narrator.say(tx().g.hejnalStart, { soundOnly: true, ms: Math.min(9000, len * 1000) });
    }
  }

  // ------------------------------------------------------------------ frame

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const { input, player, ui } = this;
    const pad = input.pollGamepad(settings.current.gamepadDeadzone);
    const playing = this.state === 'playing' && !ui.blocking;
    input.freePlay = playing;
    if (this.touch) {
      input.touchPlaying = playing;
      this.touch.setVisible(playing);
    }
    if (playing) this.handleKeys(pad);
    else if (this.state === 'playing' && pad.startPressed && ui.current !== 'title') ui.closeScreen();

    player.inputEnabled = playing;
    player.moveMult = WALK_MULT[prefs.current.walkSpeed];
    this.updateGuide(dt, playing);
    if (playing) {
      const d = player.frameInput(dt, this.rig.fovScale);
      if (d.dx || d.dy) this.lastLookInput = this.time;
    } else input.consumeMouse();

    this.acc += dt;
    while (this.acc >= FIXED_DT) {
      player.fixedUpdate(FIXED_DT);
      this.physics.world.step();
      this.acc -= FIXED_DT;
    }

    const cam = this.rc.camera;
    if (this.state === 'playing') {
      player.updateCamera(cam, this.acc / FIXED_DT, dt);
      const feel = { speed: player.horizontalSpeed(), grounded: player.grounded, sprinting: player.sprinting, crouched: player.crouched, ads: 0, adsZoom: 1 };
      this.rig.update(dt, feel);
      this.rig.apply(cam, feel);
    } else {
      // title: a slow drift around the Market Square
      this.orbit += dt * (prefs.current.calmMotion ? 0.012 : 0.035);
      cam.position.set(RYNEK_CENTER.x + Math.cos(this.orbit) * 120, 62, RYNEK_CENTER.z + Math.sin(this.orbit) * 120);
      cam.lookAt(RYNEK_CENTER.x, 14, RYNEK_CENTER.z);
    }
    cam.updateMatrixWorld();

    // sun + shadows follow the player
    if (this.sun) {
      const f = this.state === 'playing' ? player.feet : RYNEK_CENTER;
      this.sun.position.set(f.x + 30, f.y + 50, f.z + 20);
      this.sun.target.position.copy(f);
      this.sun.target.updateMatrixWorld();
    }

    if (this.state === 'playing') {
      if (player.feet.y < -30) player.teleport(new THREE.Vector3(...SPAWN.pos), SPAWN.yaw);
      this.updateWorld(dt);
      this.updateHud();
    }
    this.animateProps(dt);
    this.moon.sprite.position.copy(cam.position).addScaledVector(this.tmp.set(...MOON_DIR), 1100);

    this.audio.updateListener(cam);
    this.audio.updateAmbience(dt, cam.position);
    this.rc.render();
    input.endFrame();
  };

  private handleKeys(pad: ReturnType<Input['pollGamepad']>) {
    const i = this.input;
    if (performance.now() - this.ui.closedAt < 250) return; // the key that closed a screen
    if (i.wasPressed('KeyE') || i.wasPressed('Enter') || i.wasPressed('NumpadEnter') || pad.reloadPressed) this.interact();
    if (i.wasPressed('KeyF') || pad.crouchPressed) this.toggleWalk();
    if (i.wasPressed('KeyG')) this.nextTarget();
    if (i.wasPressed('KeyV')) this.describe();
    if (i.wasPressed('KeyR')) this.narrator.repeat();
    if (i.wasPressed('KeyL') && this.target) this.lookAt(this.target.look);
    if (i.wasPressed('Home')) this.player.pitch = 0;
    if (i.wasPressed('KeyM') || i.wasPressed('KeyJ')) this.ui.open('map');
    if (i.wasPressed('KeyH') || i.wasPressed('F1')) this.ui.open('help');
    if (i.wasPressed('KeyB')) this.toggleBlindMode();
    if (i.wasPressed('KeyQ')) this.sayHeading(true);
    if (pad.startPressed) this.ui.open('menu');
    // snap turns: 45° per press, then say which way you face (and what is ahead)
    if (prefs.current.snapTurn) {
      const step = (i.wasPressed('ArrowLeft') ? 1 : 0) - (i.wasPressed('ArrowRight') ? 1 : 0);
      if (step) {
        const from = this.turnGoal ?? this.player.yaw;
        // land on the compass points so "north-east" really is north-east
        const offset = (NORTH_OFFSET_DEG * Math.PI) / 180;
        const k = Math.round((from - offset) / (Math.PI / 4)) + step;
        this.turnGoal = k * (Math.PI / 4) + offset;
        this.audio.click();
        this.sayHeading(false, this.turnGoal);
      }
    }
    // any movement input takes control back from the guide
    if (this.autoWalk) {
      const moveKey = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'KeyT'].some((k) => i.wasPressed(k));
      if (moveKey || Math.hypot(pad.move[0], pad.move[1]) > 0.4) this.stopWalk(true);
    }
  }

  /** "Facing north-east. Ahead: St Mary's Basilica, 40 metres." */
  private sayHeading(full: boolean, yaw = this.player.yaw) {
    const f = this.player.feet;
    const heading = bearingOf(-Math.sin(yaw), -Math.cos(yaw));
    const g = tx().g;
    let text = g.facingShort(compassWord(heading));
    let best: { l: Landmark; d: number } | null = null;
    for (const l of LANDMARKS) {
      const dx = l.at[0] - f.x;
      const dz = l.at[1] - f.z;
      const d = Math.hypot(dx, dz);
      if (d < 3 || d > 260) continue;
      const rel = Math.atan2(Math.cos(yaw) * dx - Math.sin(yaw) * dz, -Math.sin(yaw) * dx - Math.cos(yaw) * dz);
      if (Math.abs(rel) < (25 * Math.PI) / 180 && (!best || d < best.d)) best = { l, d };
    }
    if (best) text += g.ahead(place(best.l).name, dist(best.d));
    else if (full) text += g.noneAhead;
    const wall = this.wallAhead(yaw, 12);
    if (wall !== null && wall < 4) text += g.wallAhead(dist(wall));
    this.narrator.say(text, { interrupt: true, ms: 2500 });
  }

  /** distance to a wall straight ahead at waist height, or null */
  private wallAhead(yaw: number, max: number): number | null {
    const { RAPIER, world } = this.physics;
    const f = this.player.feet;
    const hit = world.castRay(
      new RAPIER.Ray({ x: f.x, y: f.y + 1, z: f.z }, { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) }),
      max,
      true,
      undefined,
      undefined,
      this.player.collider,
    );
    return hit ? hit.timeOfImpact : null;
  }

  /**
   * Blind mode helpers, every frame: easing snap turns, a sonar click for walls ahead while
   * walking, a thud when walking into something, spoken turn-by-turn directions, and
   * announcements for the place you are in and things you can use.
   */
  private updateBlindAids(dt: number) {
    const p = prefs.current;
    const player = this.player;
    player.keyTurn = !p.snapTurn;
    if (this.turnGoal !== null) {
      const diff = Math.atan2(Math.sin(this.turnGoal - player.yaw), Math.cos(this.turnGoal - player.yaw));
      if (Math.abs(diff) < 0.01 || p.calmMotion) {
        player.yaw = this.turnGoal;
        this.turnGoal = null;
      } else player.yaw += diff * (1 - Math.exp(-dt * 18));
    }

    if (this.ui.blocking) return;
    const i = this.input;
    const pushing = i.isDown('KeyW') || i.isDown('ArrowUp') || player.autoRun || !!player.steer || i.pad.move[1] > 0.5;
    if (p.obstacleCues && pushing) {
      // sonar: faster, higher clicks as a wall gets closer
      const d = this.wallAhead(player.yaw, 5);
      if (d !== null && this.time >= this.sonarAt) {
        this.sonarAt = this.time + 0.12 + d * 0.12;
        const f = player.feet;
        this.audio.sonar({ x: f.x - Math.sin(player.yaw) * d, y: f.y + 1, z: f.z - Math.cos(player.yaw) * d }, 1 - d / 5);
      }
      // bump: pushing forward but not moving
      this.blockedFor = player.horizontalSpeed() < 0.4 ? this.blockedFor + dt : 0;
      if (this.blockedFor > 0.25 && this.time - this.bumpAt > 1.2) {
        this.bumpAt = this.time;
        this.audio.bump();
        this.narrator.say(tx().g.bump, { soundOnly: true, ms: 1000 });
      }
    } else this.blockedFor = 0;

    if (p.routeCoach) this.coachRoute(dt);

    if (p.announceNearby) {
      const here = this.currentLandmark()?.id ?? null;
      if (here !== this.lastPlace) {
        // a first visit is announced by the discovery itself
        if (here && this.visited(here) && this.lastPlace !== null) this.narrator.say(tx().g.nowAtPlace(place(LANDMARKS.find((l) => l.id === here)!).name));
        this.lastPlace = here;
      }
      const it = this.interactable();
      const label = it && !it.info ? it.label : null;
      if (label !== this.lastPrompt) {
        if (label) this.narrator.say(tx().g.somethingHere(label));
        this.lastPrompt = label;
      }
    }
  }

  /** spoken turn-by-turn directions while the guide is on and you walk yourself */
  private coachRoute(dt: number) {
    const t = this.target;
    if (!t || this.autoWalk || !this.path) return;
    const proj = this.trackPath();
    if (!proj) return;
    const route = this.routeAhead(proj);
    const f = this.player.feet;
    // the next real turn within 8 m
    let run = 0;
    for (let k = 1; k < route.length - 1; k++) {
      const a = route[k - 1];
      const b = route[k];
      const c = route[k + 1];
      run += Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (run > 8) break;
      const turn = Math.atan2(Math.sin(Math.atan2(c[2] - b[2], c[0] - b[0]) - Math.atan2(b[2] - a[2], b[0] - a[0])), Math.cos(Math.atan2(c[2] - b[2], c[0] - b[0]) - Math.atan2(b[2] - a[2], b[0] - a[0])));
      const wp = proj.seg + k;
      if (Math.abs(turn) > 0.6 && wp !== this.coachedTurn) {
        this.coachedTurn = wp;
        this.narrator.say(run < 3 ? tx().g.turnNow(turn > 0) : tx().g.turnIn(dist(run), turn > 0), { interrupt: true, ms: 2500 });
        return;
      }
    }
    // facing well away from the route for a while: say which way it goes
    const c = this.carrot(route);
    const dx = c[0] - f.x;
    const dz = c[2] - f.z;
    const yaw = this.player.yaw;
    const rel = Math.atan2(Math.cos(yaw) * dx - Math.sin(yaw) * dz, -Math.sin(yaw) * dx - Math.cos(yaw) * dz);
    this.offRouteFor = Math.abs(rel) > Math.PI / 3 && Math.hypot(dx, dz) > 0.5 ? this.offRouteFor + dt : 0;
    if (this.offRouteFor > 1.5 && this.time - this.coachNudgeAt > 6) {
      this.coachNudgeAt = this.time;
      this.offRouteFor = 0;
      this.narrator.say(tx().g.wayIs(t.name, relativeWords(rel, false)), { interrupt: true, ms: 2500 });
    }
  }

  private updateWorld(dt: number) {
    const f = this.player.feet;
    this.updateBlindAids(dt);
    // landmarks
    for (const l of LANDMARKS) if (!this.visited(l.id) && dist2(f.x, f.z, l.at[0], l.at[1]) < l.radius) this.discover(l);

    // pigeons
    if (!this.pigeons.airborne && dist2(f.x, f.z, this.pigeonCenter.x, this.pigeonCenter.z) < 3.4) {
      this.pigeons.scatter(f);
      this.audio.flutter(this.pigeonCenter);
      this.narrator.say(tx().g.pigeons, { soundOnly: true, ms: 2500 });
      if (!this.found('golebie')) this.findSecret('golebie', false);
    }
    if (this.time > this.cooAt) {
      this.cooAt = this.time + 3 + Math.random() * 6;
      if (!this.pigeons.airborne && dist2(f.x, f.z, this.pigeonCenter.x, this.pigeonCenter.z) < 30) this.audio.coo(this.pigeonCenter);
    }

    // the hejnał: every few minutes, and soon after you first reach St Mary's
    const mar = SECRETS.find((s) => s.id === 'hejnal')!;
    const nearMariacki = dist2(f.x, f.z, mar.at[0], mar.at[1]) < 40;
    if (nearMariacki && this.time - this.hejnalLastAt > 60 && this.hejnalNext - this.time > 4 && !this.found('hejnal')) this.hejnalNext = this.time + 4;
    if (this.time >= this.hejnalNext && this.hejnalEnds === 0) {
      this.playHejnal();
      this.hejnalNext = this.time + HEJNAL_EVERY;
    }
    if (this.hejnalEnds && this.time >= this.hejnalEnds) {
      this.hejnalEnds = 0;
      const close = dist2(f.x, f.z, mar.at[0], mar.at[1]) < mar.radius;
      if (dist2(f.x, f.z, mar.at[0], mar.at[1]) < 260) this.narrator.say(tx().g.hejnalEnd, { soundOnly: true, ms: 4000 });
      if (close && !this.found('hejnal')) this.findSecret('hejnal', false);
    }

    // the dragon breathes fire when you are around (and is not busy being a legend)
    const den = this.dragon.root.position;
    const dd = dist2(f.x, f.z, den.x, den.z);
    if (this.dragonGone > 0) {
      this.dragonGone -= dt;
      this.dragon.presence = this.dragonGone > 3 ? 0 : 1 - this.dragonGone / 3;
      if (this.dragonGone <= 0) this.dragon.presence = 1;
    } else if (dd < DRAGON_RANGE && this.time > this.dragonNext) {
      this.dragonNext = this.time + 12 + Math.random() * 8;
      this.dragon.breathe();
      this.audio.dragonFire({ x: den.x + 4, y: den.y + 5, z: den.z });
      if (dd < 45) this.narrator.say(tx().g.dragonFire, { soundOnly: true, ms: 2500 });
    }
    if (this.sheepBack > 0) {
      this.sheepBack -= dt;
      if (this.sheepBack <= 0 && !this.carrying) {
        this.sheep.visible = true;
        this.sheep.position.copy(this.sheepHome);
      }
    }

    // Master Twardowski: look at the moon for a couple of seconds
    this.rc.camera.getWorldDirection(this.fwd);
    if (this.fwd.dot(this.tmp.set(...MOON_DIR)) > Math.cos((4 * Math.PI) / 180)) {
      this.moonGaze += dt;
      if (this.moonGaze > 2 && !this.found('twardowski')) this.findSecret('twardowski', false);
    } else this.moonGaze = 0;
  }

  private animateProps(dt: number) {
    const calm = prefs.current.calmMotion;
    for (const l of LANDMARKS) {
      const b = this.beacons.get(l.id)!;
      if (b.root.visible) b.update(dt, this.target?.kind === 'landmark' && this.target.id === l.id, calm);
    }
    this.trail.mesh.visible = prefs.current.pathTrail && !!this.target;
    this.trail.update(dt, calm);
    this.dragon.update(dt);
    this.pigeons.update(dt);
    // Lajkonik dances on the spot, and bonks when greeted
    const lj = this.lajkonik;
    lj.position.y = this.ground(lj.position.x, lj.position.z) + Math.abs(Math.sin(this.time * 3)) * 0.12;
    const mace = lj.getObjectByName('mace');
    if (mace) {
      const tap = (lj.userData.tap as number | undefined) ?? 0;
      mace.rotation.z = -0.9 + Math.sin(this.time * 2) * 0.15 - Math.sin(tap * Math.PI) * 1.2;
      lj.userData.tap = Math.max(0, tap - dt * 2);
    }
    // the bell swings out and settles
    const bell = this.bell.getObjectByName('bell');
    if (bell) {
      this.bellSwing = Math.max(0, this.bellSwing - dt * 0.25);
      bell.rotation.x = Math.sin(this.time * 2.6) * 0.5 * this.bellSwing;
    }
    const rings = this.sphere.getObjectByName('rings');
    if (rings) {
      this.sphereSpin = Math.max(0, this.sphereSpin - dt);
      rings.rotation.y += dt * (0.15 + this.sphereSpin * 1.5);
    }
  }

  private updateHud() {
    const ui = this.ui;
    const f = this.player.feet;
    const here = this.currentLandmark();
    ui.setWhere(here ? place(here).name : tx().area[this.area()]);
    ui.setProgress(this.progress.landmarks.length, LANDMARKS.length, this.progress.secrets.length, SECRETS.length);
    const it = this.interactable();
    ui.setPrompt(it ? it.label : null);
    const p = prefs.current;
    ui.setHint(!p.dragLook && !this.touch && !this.input.locked ? tx().mouseHint : null);

    const t = this.target;
    if (t) {
      const proj = this.path ? this.trackPath() : null;
      const route = proj ? this.routeAhead(proj) : null;
      const left = route ? this.routeLength(route) : dist2(f.x, f.z, t.stand.x, t.stand.z);
      const c = route ? this.carrot(route) : [t.stand.x, 0, t.stand.z];
      const words = left < ARRIVE + 1 ? tx().youAreHere : `${roundDist(left)} m · ${this.relTo(c[0], c[2]).split(',')[0]}`;
      ui.setGuide({ name: t.name, direction: words, walking: this.autoWalk });
    } else ui.setGuide(null);

    // compass: heading, the target, unvisited places within 500 m
    const places = LANDMARKS.filter((l) => !this.visited(l.id) && dist2(f.x, f.z, l.at[0], l.at[1]) < 500).map((l) => bearingOf(l.at[0] - f.x, l.at[1] - f.z));
    ui.setCompass(this.heading(), t ? bearingOf(t.stand.x - f.x, t.stand.z - f.z) : null, places);

    // name tags over nearby places
    const labels: LabelInfo[] = [];
    if (prefs.current.beacons) {
      const cam = this.rc.camera;
      const w = window.innerWidth;
      const hgt = window.innerHeight;
      const near = LANDMARKS.map((l) => ({ l, d: dist2(f.x, f.z, l.at[0], l.at[1]) }))
        .filter((x) => x.d < LABEL_RANGE)
        .sort((a, b) => a.d - b.d)
        .slice(0, 6);
      const here = this.currentLandmark();
      for (const { l, d } of near) {
        if (l === here) continue;
        const p = this.tmp.set(l.look[0], Math.min(l.look[1] + 7, this.ground(l.stand[0], l.stand[1]) + 40), l.look[2]).project(cam);
        if (p.z > 1 || p.x < -1.1 || p.x > 1.1 || p.y < -1.1 || p.y > 1.1) continue;
        labels.push({
          x: (p.x * 0.5 + 0.5) * w,
          y: (-p.y * 0.5 + 0.5) * hgt,
          name: place(l).name,
          dist: `${roundDist(d)} m`,
          target: t?.kind === 'landmark' && t.id === l.id,
          done: this.visited(l.id),
        });
      }
    }
    ui.setLabels(labels);
  }
}

/** distance from (x, z) to segment a-b (xz), with the projection parameter */
function segDist(x: number, z: number, a: V3, b: V3): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / len2)) : 0;
  return { d: Math.hypot(a[0] + dx * t - x, a[2] + dz * t - z), t };
}
