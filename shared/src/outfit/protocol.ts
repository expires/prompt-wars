// Wire protocol of the Closet (POST /api/forge/outfit -> NDJSON event stream). Same transport,
// rate limit and prompt cache as the weapon forge.

import type { DesignPalette } from '../forge/types';
import type { OutfitBody, OutfitDesign, OutfitPiece } from './types';

export const OUTFIT_API_PATH = '/api/forge/outfit';

export interface OutfitGenerateRequest {
  prompt: string;
  /** pieces to keep verbatim (locked pieces of `previous`) */
  locked?: OutfitPiece[];
  /** labels / ids the model must not produce again */
  rejected?: string[];
  /** outfit being edited (reprompt) */
  previous?: OutfitDesign;
  /** 1 - 3 parallel variants */
  variants?: number;
  /** SpacetimeDB identity hex (rate limiting) */
  playerIdentity?: string;
  /** mock only: deterministic output for tests */
  seed?: number;
}

export type OutfitEvent =
  | { type: 'start'; variant: -1; variants: number; model: string; mock: boolean; cached?: boolean }
  | { type: 'meta'; variant: number; name: string; theme: string; body: OutfitBody; skin: string; palette: DesignPalette }
  | { type: 'piece'; variant: number; piece: OutfitPiece }
  | { type: 'done'; variant: number; outfit: OutfitDesign; warnings: string[] }
  | { type: 'error'; variant: number; message: string }
  | { type: 'end'; variant: -1 };
