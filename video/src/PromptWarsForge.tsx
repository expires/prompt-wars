// "Prompt Wars: forge" promo: title card -> Closet (character) -> Forge (weapon) -> in game -> end
// card. The middle is the real captured take (scripts/capture.ts) as one continuous shot at 1:1;
// the edit only adds a slow push-in on the 3D stage while a build streams in, and a few captions.
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F, clipCut } from './brand';
import {
  END_SEC,
  TITLE_SEC,
  T_END,
  T_TITLE,
  WIDTH,
  cutFrames,
  sec,
  takeCut,
  type CaptureMeta,
  type Cut,
  type Rect,
} from './timeline';

export interface PromptWarsForgeProps {
  [key: string]: unknown;
  capture: CaptureMeta | null;
}

const ease = Easing.bezier(0.2, 0.8, 0.2, 1); // --ease-out
const easeInOut = Easing.inOut(Easing.cubic);

// ------------------------------------------------------------------ brand pieces

const Logo: React.FC<{ size: number; t: number }> = ({ size, t }) => {
  // the landing logo (menus.css .landing-logo): Teko 600, PROMPT / WARS (accent), skewed underline
  const up = interpolate(t, [0, 0.5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const bar = interpolate(t, [0.25, 0.7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return (
    <div style={{ opacity: up, transform: `translateY(${(1 - up) * size * 0.18}px)` }}>
      <h1
        style={{
          margin: 0,
          font: `600 ${size}px / 0.82 ${F.display}`,
          letterSpacing: '0.01em',
          textTransform: 'uppercase',
          color: C.fg,
          textShadow: `0 ${size / 30}px 0 rgba(0, 0, 0, 0.35)`,
        }}
      >
        Prompt
        <br />
        <span style={{ color: C.accent }}>Wars</span>
      </h1>
      <div
        style={{
          width: size * 1.5,
          height: size / 15,
          marginTop: size * 0.12,
          background: C.accent,
          transform: `skewX(-24deg) scaleX(${bar})`,
          transformOrigin: 'left',
        }}
      />
    </div>
  );
};

const Tagline: React.FC<{ children: React.ReactNode; size: number; opacity: number }> = ({ children, size, opacity }) => (
  <p style={{ margin: 0, opacity, font: `600 ${size}px / 1.3 ${F.label}`, letterSpacing: '0.06em', textTransform: 'lowercase', color: C.fgDim }}>{children}</p>
);

/** the landing screen's own backdrop: the take's first frame (real game pixels), blurred and darkened */
const Backdrop: React.FC<{ src: string; at: number }> = ({ src, at }) => (
  <AbsoluteFill style={{ background: C.ink900 }}>
    <AbsoluteFill style={{ filter: 'blur(18px) saturate(1.05)', transform: 'scale(1.08)' }}>
      <OffthreadVideo src={src} trimBefore={sec(at)} muted style={{ width: '100%', height: '100%' }} />
    </AbsoluteFill>
    <AbsoluteFill style={{ backgroundImage: `${C.hatch}, linear-gradient(90deg, rgba(11,13,18,0.92) 0%, rgba(11,13,18,0.6) 55%, rgba(11,13,18,0.85) 100%)` }} />
  </AbsoluteFill>
);

// ------------------------------------------------------------------ cards

const TitleCard: React.FC<{ src: string; at: number }> = ({ src, at }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  const tag = interpolate(t, [0.55, 1.0], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return (
    <AbsoluteFill>
      <Backdrop src={src} at={at} />
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 180, gap: 40 }}>
        <Logo size={250} t={t} />
        <Tagline size={34} opacity={tag}>
          prompt a weapon. <b style={{ color: C.forge, fontWeight: 700 }}>win the arena.</b>
        </Tagline>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ capture: CaptureMeta; src: string; at: number }> = ({ capture, src, at }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  const a = interpolate(t, [0.5, 0.95], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const b = interpolate(t, [0.8, 1.25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const made = [capture.outfit?.name, capture.weapon?.name].filter(Boolean) as string[];
  return (
    <AbsoluteFill>
      <Backdrop src={src} at={at} />
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 180, gap: 40 }}>
        <Logo size={200} t={t + 0.1} />
        <Tagline size={34} opacity={a}>
          describe it. forge it. <b style={{ color: C.forge, fontWeight: 700 }}>fight with it.</b>
        </Tagline>
        {made.length === 2 && (
          <div style={{ opacity: b, display: 'flex', alignItems: 'center', gap: 18, font: `600 22px / 1 ${F.label}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.fgDim }}>
            <span>Two prompts</span>
            <span style={{ width: 28, height: 2, background: C.forgeGrad }} />
            <span style={{ color: C.fg }}>{made[0]}</span>
            <span style={{ color: C.fgMute }}>+</span>
            <span style={{ color: C.fg }}>{made[1]}</span>
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ captured segments

interface Caption {
  text: string;
  /** seconds within the segment */
  from: number;
  to: number;
}

const CaptionChip: React.FC<{ caption: Caption }> = ({ caption }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  const a = interpolate(t, [caption.from, caption.from + 0.35, caption.to - 0.3, caption.to], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  if (a <= 0) return null;
  const [step, ...rest] = caption.text.split(' · ');
  return (
    // bottom right: empty in both editors (under the action buttons, right of the prompt chips)
    <div style={{ position: 'absolute', right: 40, bottom: 26, opacity: a, transform: `translateY(${(1 - a) * 14}px)` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '12px 22px 12px 18px',
          background: 'rgba(11, 13, 18, 0.9)',
          border: `1px solid ${C.lineStrong}`,
          clipPath: clipCut(10),
          font: `600 22px / 1 ${F.label}`,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: C.fg,
        }}
      >
        <span style={{ width: 6, height: 22, background: C.forgeGrad, transform: 'skewX(-18deg)' }} />
        {rest.length ? (
          <>
            <span style={{ color: C.accent }}>{step}</span>
            <span style={{ color: C.fgMute }}>·</span>
            <span>{rest.join(' · ')}</span>
          </>
        ) : (
          <span>{step}</span>
        )}
      </div>
    </div>
  );
};

interface Push {
  /** seconds within the take */
  from: number;
  to: number;
  rect: Rect | null;
}

/** push-in scale + origin at take time `t`: eases in over a build, back out to 1:1 once it's done */
function pushAt(t: number, pushes: Push[]): { scale: number; origin: string } {
  const PEAK = 1.07;
  for (const p of pushes) {
    if (!p.rect || t < p.from || t > p.to + 1.2) continue;
    const up = interpolate(t, [p.from, p.from + 1.6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut });
    const down = interpolate(t, [p.to, p.to + 1.2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeInOut });
    return { scale: 1 + (PEAK - 1) * up * (1 - down), origin: `${p.rect.x + p.rect.w / 2}px ${p.rect.y + p.rect.h / 2}px` };
  }
  return { scale: 1, origin: '50% 50%' };
}

/** The take at 1:1 (one continuous shot), with the build push-ins and the captions on top. */
const Take: React.FC<{ src: string; cut: Cut; pushes: Push[]; captions: Caption[] }> = ({ src, cut, pushes, captions }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { scale, origin } = pushAt(f / fps, pushes);
  return (
    <AbsoluteFill style={{ background: C.ink900 }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: origin }}>
        <OffthreadVideo src={src} trimBefore={sec(cut.from)} muted style={{ width: WIDTH, height: '100%' }} />
      </AbsoluteFill>
      {captions.map((c) => (
        <CaptionChip key={c.text} caption={c} />
      ))}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ composition

export const PromptWarsForge: React.FC<PromptWarsForgeProps> = ({ capture }) => {
  if (!capture) return <AbsoluteFill style={{ background: C.ink900 }} />;
  const src = staticFile(capture.video);
  const m = capture.markers;
  const take = takeCut(capture);
  const rel = (s: number) => s - take.from;
  const landingAt = Math.max(0, (m.play ?? m.closetOpen) - 1.5);

  const captions: Caption[] = [
    { text: 'Step 1 · Describe your character', from: rel(m.closetType ?? m.closetOpen + 1), to: rel(m.closetGenerate + 0.4) },
    { text: 'Built live, piece by piece', from: rel(m.closetGenerate + 1.2), to: rel(Math.min(m.closetDone, m.closetGenerate + 5.5)) },
    { text: 'Step 2 · Forge your weapon', from: rel(m.forgeType ?? m.forgeOpen + 1), to: rel(m.forgeGenerate + 0.4) },
    ...(m.deploy !== undefined ? [{ text: 'Equip & deploy', from: rel(m.forgeDone + 1.5), to: rel(m.deploy + 0.3) }] : []),
  ];
  const pushes: Push[] = [
    { from: rel(m.closetGenerate + 0.2), to: rel(m.closetDone + 0.8), rect: capture.rects.closetStage },
    { from: rel(m.forgeGenerate + 0.2), to: rel(m.forgeDone + 0.8), rect: capture.rects.forgeStage },
  ];

  return (
    <AbsoluteFill style={{ background: C.ink900 }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={sec(TITLE_SEC)}>
          <TitleCard src={src} at={landingAt} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T_TITLE })} />
        <TransitionSeries.Sequence durationInFrames={cutFrames(take)}>
          <Take src={src} cut={take} pushes={pushes} captions={captions} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T_END })} />
        <TransitionSeries.Sequence durationInFrames={sec(END_SEC)}>
          <EndCard capture={capture} src={src} at={m.inGame !== undefined ? m.inGame + 1.5 : landingAt} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
