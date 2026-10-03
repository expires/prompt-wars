// Client-side look of elemental effects: colours, status of a player (burning / chilled / ...)
// from its replicated row, and the particles a burning / chilled body emits.
import * as THREE from 'three';
import { elementFromCode, type Element } from '@ai-gaem/shared';
import type { NetPlayer } from '../net/NetClient';

export interface ElementLook {
  /** tracers / projectiles / stream particles */
  tracer: number;
  /** body tint (emissive) on an affected player */
  tint: number;
  /** particle colours */
  particles: number[];
  label: string;
}

export const ELEMENT_LOOK: Record<Element, ElementLook> = {
  fire: { tracer: 0xff7a1a, tint: 0xff6000, particles: [0xff3c00, 0xff7010, 0xffa030], label: 'Fire' },
  ice: { tracer: 0x9ee4ff, tint: 0x4fb4ff, particles: [0xe8f8ff, 0x9ee4ff, 0x5cc0ff], label: 'Ice' },
  poison: { tracer: 0x8dff3a, tint: 0x4cd420, particles: [0x8dff3a, 0x3fae1a, 0xc8ff6a], label: 'Poison' },
  shock: { tracer: 0xfff36b, tint: 0xc8b8ff, particles: [0xffffff, 0xfff36b, 0xb6a6ff], label: 'Shock' },
};

/** colour for a weapon's tracers / projectiles: its element, else its own accent */
export function shotColor(w: { element?: Element | null; colors?: { accent: string } }, fallback: THREE.ColorRepresentation): THREE.ColorRepresentation {
  if (w.element) return ELEMENT_LOOK[w.element].tracer;
  return w.colors?.accent ?? fallback;
}

/** random particle colour of an element */
export function elementParticle(e: Element): number {
  const p = ELEMENT_LOOK[e].particles;
  return p[Math.floor(Math.random() * p.length)];
}

export interface PlayerStatus {
  /** active DoT element (fire = burning, poison = poisoned) */
  dot: Element | null;
  /** active slow element (ice = chilled, shock = shocked) */
  slow: Element | null;
  /** active slow percent (any slow, incl. plain ones) */
  slowPercent: number;
  burning: boolean;
  chilled: boolean;
  poisoned: boolean;
  shocked: boolean;
}

/** status effects active on a player right now (server timestamps vs the local clock) */
export function playerStatus(p: Pick<NetPlayer, 'alive' | 'dotUntil' | 'dotElement' | 'slowUntil' | 'slowElement' | 'slowPercent'> | undefined, now = Date.now()): PlayerStatus {
  const alive = !!p?.alive;
  const dot = alive && (p?.dotUntil ?? 0) > now ? elementFromCode(p?.dotElement) : null;
  const slowOn = alive && (p?.slowUntil ?? 0) > now && (p?.slowPercent ?? 0) > 0;
  const slow = slowOn ? elementFromCode(p?.slowElement) : null;
  return {
    dot,
    slow,
    slowPercent: slowOn ? (p?.slowPercent ?? 0) : 0,
    burning: dot === 'fire',
    poisoned: dot === 'poison',
    chilled: slow === 'ice',
    shocked: slow === 'shock',
  };
}

/** the element tint to show on a body (DoT wins over slow; null = none) */
export function statusTint(s: PlayerStatus): Element | null {
  return s.dot ?? s.slow;
}

const tmpPos = new THREE.Vector3();
const tmpVel = new THREE.Vector3();

export interface ParticleSink {
  /** big particle with its own gravity (m/s², negative = rises) */
  emitBig(pos: THREE.Vector3, vel: THREE.Vector3, life: number, color: THREE.ColorRepresentation, gravity?: number): void;
}

/**
 * Status particles around a body (feet at `feet`, `height` tall) for `dt` seconds: flames licking
 * up for fire, slowly falling frost flakes for ice, rising bubbles for poison, sparks for shock.
 */
export function emitStatusParticles(sink: ParticleSink, s: PlayerStatus, feet: THREE.Vector3, height: number, dt: number) {
  const spawn = (rate: number, fn: () => void) => {
    // fractional spawn count: rate per second * dt, carried stochastically
    let n = rate * dt;
    while (n > 0) {
      if (n >= 1 || Math.random() < n) fn();
      n -= 1;
    }
  };
  const ring = (rMin: number, rMax: number, yMin: number, yMax: number) => {
    const a = Math.random() * Math.PI * 2;
    const r = rMin + Math.random() * (rMax - rMin);
    return tmpPos.set(feet.x + Math.cos(a) * r, feet.y + yMin + Math.random() * (yMax - yMin), feet.z + Math.sin(a) * r);
  };
  if (s.burning) {
    spawn(70, () => {
      // dense at the feet / body, tapering up: flames lick past the head
      ring(0.05, 0.32, 0.05, height * 0.9);
      tmpVel.set((Math.random() - 0.5) * 0.6, 1.0 + Math.random() * 1.4, (Math.random() - 0.5) * 0.6);
      sink.emitBig(tmpPos, tmpVel, 0.3 + Math.random() * 0.35, elementParticle('fire'), -1.5);
    });
  }
  if (s.poisoned) {
    spawn(18, () => {
      ring(0.15, 0.3, 0.3, height * 0.8);
      tmpVel.set((Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3);
      sink.emitBig(tmpPos, tmpVel, 0.7, elementParticle('poison'), -0.4);
    });
  }
  if (s.chilled) {
    spawn(30, () => {
      ring(0.15, 0.45, 0.2, height + 0.15);
      tmpVel.set((Math.random() - 0.5) * 0.4, -0.2 - Math.random() * 0.3, (Math.random() - 0.5) * 0.4);
      sink.emitBig(tmpPos, tmpVel, 0.8 + Math.random() * 0.4, elementParticle('ice'), 0.5);
    });
  }
  if (s.shocked) {
    spawn(50, () => {
      ring(0, 0.35, 0, height);
      tmpVel.set((Math.random() - 0.5) * 6, (Math.random() - 0.2) * 5, (Math.random() - 0.5) * 6);
      sink.emitBig(tmpPos, tmpVel, 0.1, elementParticle('shock'), 0);
    });
  }
}
