// Short standalone clips (slides): one editor of the take, prompt already typed -> the streamed
// build (sped up to fit) -> a hold on the finished result at 1:1 speed. 30 fps, no title cards.
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from './brand';
import type { CaptureMeta, Rect } from './timeline';

export type ClipKind = 'closet' | 'forge';

export interface ClipProps {
  [key: string]: unknown;
  kind: ClipKind;
  capture: CaptureMeta | null;
}

export const CLIP_FPS = 30;
/** before the Tailor / Forge click (prompt fully typed) */
const LEAD_SEC = 1.4;
/** the build plays in at most this long (sped up when the stream took longer) */
const BUILD_MAX_SEC = 8.5;
const HOLD_SEC = 3.5;

export function clipPlan(c: CaptureMeta, kind: ClipKind) {
  const m = c.markers;
  const gen = kind === 'closet' ? m.closetGenerate : m.forgeGenerate;
  const done = kind === 'closet' ? m.closetDone : m.forgeDone;
  const from = Math.max(0, gen - LEAD_SEC);
  const buildSrc = done - from;
  const rate = Math.max(1, (done - gen) / BUILD_MAX_SEC);
  const buildOut = buildSrc / rate;
  const rect = kind === 'closet' ? c.rects.closetStage : c.rects.forgeStage;
  return { from, done, rate, buildOut, rect, total: buildOut + HOLD_SEC };
}

export const clipFrames = (c: CaptureMeta, kind: ClipKind) => Math.round(clipPlan(c, kind).total * CLIP_FPS);

const easeInOut = Easing.inOut(Easing.cubic);

function zoom(t: number, buildOut: number, rect: Rect | null) {
  if (!rect) return { scale: 1, origin: '50% 50%' };
  const up = interpolate(t, [LEAD_SEC * 0.8, LEAD_SEC * 0.8 + 1.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut });
  const down = interpolate(t, [buildOut + 0.4, buildOut + 1.6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut });
  return { scale: 1 + 0.07 * up * (1 - down), origin: `${rect.x + rect.w / 2}px ${rect.y + rect.h / 2}px` };
}

export const Clip: React.FC<ClipProps> = ({ kind, capture }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!capture) return <AbsoluteFill style={{ background: C.ink900 }} />;
  const src = staticFile(capture.video);
  const p = clipPlan(capture, kind);
  const t = f / fps;
  const { scale, origin } = zoom(t, p.buildOut, p.rect);
  const buildFrames = Math.round(p.buildOut * fps);
  const fadeIn = interpolate(f, [0, 8], [1, 0], { extrapolateRight: 'clamp' });
  const video = { muted: true, style: { width: '100%', height: '100%' } } as const;
  return (
    <AbsoluteFill style={{ background: C.ink900 }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: origin }}>
        <Sequence durationInFrames={buildFrames}>
          <OffthreadVideo src={src} trimBefore={Math.round(p.from * fps)} playbackRate={p.rate} {...video} />
        </Sequence>
        <Sequence from={buildFrames}>
          <OffthreadVideo src={src} trimBefore={Math.round(p.done * fps)} {...video} />
        </Sequence>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: C.ink900, opacity: fadeIn }} />
    </AbsoluteFill>
  );
};
