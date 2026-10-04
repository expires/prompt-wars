// Cuts of the captured take (video/public/capture.json, written by scripts/capture.ts).

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MarkerName =
  | 'start'
  | 'play'
  | 'closetOpen'
  | 'closetType'
  | 'closetGenerate'
  | 'closetDone'
  | 'next'
  | 'forgeOpen'
  | 'forgeType'
  | 'forgeGenerate'
  | 'forgeDone'
  | 'deploy'
  | 'inGame'
  | 'end';

type Required = 'closetOpen' | 'closetGenerate' | 'closetDone' | 'next' | 'forgeOpen' | 'forgeGenerate' | 'forgeDone' | 'end';

export interface CaptureMeta {
  video: string;
  mode: 'record' | 'replay';
  viewport: { width: number; height: number };
  dpr: number;
  durationSec: number;
  prompts: { armour: string; weapon: string };
  outfit: { name: string; pieces: number } | null;
  weapon: { name: string; components: number } | null;
  /** seconds from the first frame of the take */
  markers: Partial<Record<MarkerName, number>> & Record<Required, number>;
  rects: { closetStage: Rect | null; forgeStage: Rect | null };
}

/** a stretch of the take, in seconds of the source video */
export interface Cut {
  from: number;
  to: number;
}

export const TITLE_SEC = 3.2;
export const END_SEC = 4;
/** transition lengths (frames) */
export const T_TITLE = 24;
export const T_END = 24;

/**
 * The take is used as one continuous shot, landing -> Closet -> Forge -> in game: the game's own
 * screen changes are the transitions in between (nothing is cut out of the real flow).
 */
export function takeCut(c: CaptureMeta): Cut {
  const m = c.markers;
  return { from: Math.max(0, (m.play ?? m.closetOpen) - 1.4), to: m.end };
}

export const sec = (s: number) => Math.round(s * FPS);
export const cutFrames = (c: Cut) => sec(c.to - c.from);

export function totalFrames(c: CaptureMeta): number {
  return sec(TITLE_SEC) + cutFrames(takeCut(c)) + sec(END_SEC) - T_TITLE - T_END;
}
