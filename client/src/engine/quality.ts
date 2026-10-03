/**
 * Graphics quality (Settings → Video): Low / Medium / High, or Auto.
 *
 *   low     pixel ratio <= 1, no shadows, chairs / laptops only within 22 m, no desk clutter /
 *           folded seats / haze beams / floor streaks / stage point light
 *   medium  pixel ratio <= 1.5, 1024² shadow map, chairs / laptops within 45 m
 *   high    pixel ratio <= 2, 2048² shadow map, everything (the original look)
 *
 * Auto starts at Low on integrated / mobile / software GPUs (Intel UHD / HD, Mali, low Adreno,
 * PowerVR, SwiftShader, llvmpipe) or with navigator.deviceMemory <= 4, else High; during a match it
 * steps down (High → Medium → Low) whenever the frame rate stays under 40 fps for 5 s.
 * `?quality=low|medium|high` overrides the setting (tests).
 */
import * as THREE from 'three';
import { settings, type GraphicsQuality } from '../settings';
import type { GameMap } from '../map/types';
import { report } from '../telemetry';

export type QualityLevel = 'low' | 'medium' | 'high';

const LOW_FPS = 40;
const LOW_FOR_MS = 5000;
/** ignore the first seconds after a (re)apply: shader compiles / uploads stall frames */
const SETTLE_MS = 4000;

/** integrated / mobile / software GPUs that struggle with the venue */
export function lowEndGpu(gpu: string): boolean {
  const g = gpu.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) return true;
  if (/intel/.test(g) && /(uhd|hd graphics|hd \d{3,4}|gma)/.test(g)) return true;
  if (/mali|powervr|sgx|videocore/.test(g)) return true;
  const adreno = /adreno[^\d]*(\d{3})/.exec(g);
  if (adreno && Number(adreno[1]) < 640) return true;
  return false;
}

export function autoLevel(gpu: string): QualityLevel {
  const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (lowEndGpu(gpu) || (typeof dm === 'number' && dm <= 4)) return 'low';
  return 'high';
}

export interface QualityHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  map?: GameMap;
  gpu(): string;
  /** true while the world is being played (no menus, tab visible): FPS samples count */
  measuring(): boolean;
  onChange?(level: QualityLevel, reason: string): void;
}

export class QualityController {
  level: QualityLevel = 'high';
  /** Auto's current pick (stepped down by the FPS monitor) */
  private autoPick: QualityLevel | null = null;
  private lowSince = 0;
  private settleUntil = 0;
  private readonly override: QualityLevel | null;

  constructor(private readonly host: QualityHost) {
    const q = new URLSearchParams(location.search).get('quality');
    this.override = q === 'low' || q === 'medium' || q === 'high' ? q : null;
    settings.onChange(() => this.refresh('setting'));
  }

  get setting(): GraphicsQuality {
    return this.override ?? settings.current.graphicsQuality;
  }

  /** resolve the setting (Auto → GPU heuristics / FPS monitor) and apply it if it changed */
  refresh(reason = 'refresh', force = false) {
    const s = this.setting;
    let lvl: QualityLevel;
    if (s === 'auto') {
      this.autoPick ??= autoLevel(this.host.gpu());
      lvl = this.autoPick;
    } else lvl = s;
    if (lvl === this.level && !force) return;
    this.apply(lvl, reason);
  }

  apply(level: QualityLevel, reason: string) {
    const prev = this.level;
    this.level = level;
    const { renderer, scene, map } = this.host;
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(dpr, level === 'low' ? 1 : level === 'medium' ? 1.5 : 2));
    const shadows = level !== 'low';
    const size = level === 'medium' ? 1024 : 2048;
    scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (!l.isDirectionalLight || !l.castShadow) return;
      if (l.shadow.mapSize.x !== size) {
        l.shadow.mapSize.set(size, size);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    });
    if (renderer.shadowMap.enabled !== shadows) {
      renderer.shadowMap.enabled = shadows;
      // programs depend on shadowMap.enabled: recompile the materials in use
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
    }
    map?.setQuality?.(level);
    this.settleUntil = performance.now() + SETTLE_MS;
    this.lowSince = 0;
    if (prev !== level) this.host.onChange?.(level, reason);
  }

  /** per-frame FPS monitor (Auto only): `fps` = the last full second's frame count */
  update(now: number, fps: number) {
    if (this.setting !== 'auto' || this.level === 'low' || fps <= 0) return;
    if (!this.host.measuring() || now < this.settleUntil) {
      this.lowSince = 0;
      return;
    }
    if (fps >= LOW_FPS) {
      this.lowSince = 0;
      return;
    }
    if (!this.lowSince) this.lowSince = now;
    if (now - this.lowSince < LOW_FOR_MS) return;
    const next: QualityLevel = this.level === 'high' ? 'medium' : 'low';
    this.autoPick = next;
    report('quality', { msg: `auto ${this.level} -> ${next}`, fps }, { heavy: true });
    this.apply(next, `fps ${fps} < ${LOW_FPS} for 5 s`);
  }
}
