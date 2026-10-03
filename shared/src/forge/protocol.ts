// Wire protocol of the forge service (POST /api/forge/generate -> NDJSON event stream).

import type { FireMode, WeaponClass } from '../weapon';
import type { Component, DesignFx, DesignPalette, DesignStats, ForgeDesign } from './types';

export const FORGE_API_PATH = '/api/forge';

export interface ForgeGenerateRequest {
  prompt: string;
  /** weapon class to aim for ('' / omitted = model decides) */
  class?: string;
  /** components to keep verbatim (usually the locked components of `previous`) */
  locked?: Component[];
  /** labels / ids the model must not produce again */
  rejected?: string[];
  /** current design being edited (reprompt) */
  previous?: ForgeDesign;
  /** 1 - 3 parallel variants */
  variants?: number;
  /** SpacetimeDB identity hex (rate limiting / logging) */
  playerIdentity?: string;
  /** reserved (SpacetimeDB token); not validated yet */
  token?: string;
  /** mock only: deterministic output for tests */
  seed?: number;
}

/** Every event carries the variant index it belongs to (0 for single-variant requests, -1 = request-level). */
export type ForgeEvent =
  | { type: 'start'; variant: -1; variants: number; model: string; mock: boolean }
  | { type: 'meta'; variant: number; name: string; class: WeaponClass; fireMode: FireMode; palette: DesignPalette; fx: DesignFx }
  | { type: 'component'; variant: number; component: Component }
  | { type: 'stats'; variant: number; stats: DesignStats }
  | { type: 'done'; variant: number; design: ForgeDesign; warnings: string[] }
  | { type: 'error'; variant: number; message: string }
  | { type: 'end'; variant: -1 };
