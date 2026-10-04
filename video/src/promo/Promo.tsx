// Narrated promo (~2 min, 1920x1080 30 fps, H.264 + AAC): one section per voiceover clip
// (public/vo/<id>.wav from scripts/voiceover.ts), each as long as its clip plus a little air,
// short fades between sections. Media: public/promo/ (scripts/promoPrep.ts).
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AbsoluteFill, Audio, Easing, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, F, clipCut } from '../brand';
import { PROMO_SECTIONS, type SectionId } from './script';

export const PROMO_FPS = 30;
/** VO starts this far into its section; the section runs this long after it ends */
const LEAD = 0.35;
const TAIL = 0.6;
const T_FADE = 10;

export type Durations = Partial<Record<SectionId, number>>;

export interface PromoProps {
  [key: string]: unknown;
  durations: Durations | null;
}

const EXTRA: Partial<Record<SectionId, number>> = { s1: 0.8, s8: 1.4 };
export const sectionSec = (d: Durations, id: SectionId) => LEAD + (d[id] ?? 4) + TAIL + (EXTRA[id] ?? 0);
export const promoFrames = (d: Durations) =>
  PROMO_SECTIONS.reduce((a, s) => a + Math.round(sectionSec(d, s.id) * PROMO_FPS), 0) - (PROMO_SECTIONS.length - 1) * T_FADE;

/** when (s, within the section) the VO reaches `fragment`, estimated from its character offset */
function cue(d: Durations, id: SectionId, fragment: string): number {
  const text: string = PROMO_SECTIONS.find((s) => s.id === id)!.text;
  const i = Math.max(0, text.indexOf(fragment));
  return LEAD + (i / text.length) * (d[id] ?? 4);
}

const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
const src = (f: string) => staticFile(`promo/${f}`);

// ------------------------------------------------------------------ pieces

/** fade + rise in at `at` (s), optional fade out at `out` */
const useIn = (at: number, out?: number) => {
  const t = useCurrentFrame() / useVideoConfig().fps;
  const a = interpolate(t, [at, at + 0.45], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  const b = out === undefined ? 1 : interpolate(t, [out, out + 0.35], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return { opacity: a * b, transform: `translateY(${(1 - a) * 18}px)` };
};

/** dark, blurred footage behind cards */
const Backdrop: React.FC<{ video: string; from: number; rate?: number; dim?: number; blur?: number }> = ({ video, from, rate = 1, dim = 0.72, blur = 14 }) => (
  <AbsoluteFill style={{ background: C.ink900 }}>
    <AbsoluteFill style={{ filter: `blur(${blur}px)`, transform: 'scale(1.06)' }}>
      <OffthreadVideo src={src(video)} trimBefore={Math.round(from * PROMO_FPS)} playbackRate={rate} muted style={{ width: '100%', height: '100%' }} />
    </AbsoluteFill>
    <AbsoluteFill style={{ backgroundImage: `${C.hatch}, linear-gradient(90deg, rgba(11,13,18,${dim + 0.15}) 0%, rgba(11,13,18,${dim}) 60%, rgba(11,13,18,${dim - 0.1}) 100%)` }} />
  </AbsoluteFill>
);

const Card: React.FC<{ at: number; out?: number; big?: string; label: string; accent?: string; size?: number }> = ({ at, out, big, label, accent = C.accent, size = 150 }) => {
  const st = useIn(at, out);
  return (
    <div style={{ ...st, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, textAlign: 'left', alignSelf: 'flex-start' }}>
      {big && <div style={{ font: `600 ${size}px / 0.9 ${F.display}`, color: accent, letterSpacing: '0.01em' }}>{big}</div>}
      <div style={{ font: `600 ${big ? 34 : 54}px / 1.15 ${F.label}`, color: C.fg, letterSpacing: '0.04em', textTransform: 'uppercase', maxWidth: 1400 }}>{label}</div>
    </div>
  );
};

/** small chip, bottom right (empty in the editors and the game HUD there sits lower) */
const Chip: React.FC<{ text: string; at?: number; out?: number }> = ({ text, at = 0.3, out }) => {
  const st = useIn(at, out);
  return (
    <div style={{ position: 'absolute', right: 40, bottom: 26, ...st }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 22px 12px 18px', background: 'rgba(11,13,18,0.9)', border: `1px solid ${C.lineStrong}`, clipPath: clipCut(10), font: `600 22px / 1 ${F.label}`, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.fg }}>
        <span style={{ width: 6, height: 22, background: C.forgeGrad, transform: 'skewX(-18deg)' }} />
        <span>{text}</span>
      </div>
    </div>
  );
};

const Vo: React.FC<{ id: SectionId }> = ({ id }) => (
  <Sequence from={Math.round(LEAD * PROMO_FPS)}>
    <Audio src={staticFile(`vo/${id}.wav`)} />
  </Sequence>
);

/** a clip played to fill `sec` exactly (slowed a touch when the VO runs longer than the clip) */
const Fill: React.FC<{ video: string; clipSec: number; sec: number; from?: number }> = ({ video, clipSec, sec, from = 0 }) => (
  <OffthreadVideo src={src(video)} trimBefore={Math.round(from * PROMO_FPS)} playbackRate={Math.min(1, (clipSec - from - 0.05) / sec)} muted style={{ width: '100%', height: '100%' }} />
);

/** consecutive pieces of footage, [file, from (s), length (s)] */
const Cuts: React.FC<{ cuts: [string, number, number][] }> = ({ cuts }) => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: C.ink900 }}>
      {cuts.map(([file, from, len], i) => {
        const el = (
          <Sequence key={i} from={Math.round(at * PROMO_FPS)} durationInFrames={Math.round(len * PROMO_FPS)}>
            <OffthreadVideo src={src(file)} trimBefore={Math.round(from * PROMO_FPS)} muted style={{ width: '100%', height: '100%' }} />
          </Sequence>
        );
        at += len;
        return el;
      })}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ sections

const S1: React.FC<{ sec: number }> = ({ sec }) => {
  const t = useCurrentFrame() / PROMO_FPS;
  const s = interpolate(t, [0, sec], [1, 1.07], { easing: Easing.inOut(Easing.quad) });
  return (
    <AbsoluteFill style={{ background: C.ink900 }}>
      <Img src={src('cover.png')} style={{ width: '100%', height: '100%', transform: `scale(${s})`, transformOrigin: '30% 50%' }} />
    </AbsoluteFill>
  );
};

const S2: React.FC<{ d: Durations }> = ({ d }) => {
  const a = cue(d, 's2', 'A single weapon');
  const b = cue(d, 's2', 'Meanwhile');
  return (
    <AbsoluteFill>
      <Backdrop video="rec-cover.mp4" from={1} rate={0.5} />
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 160, gap: 56 }}>
        <Card at={0.4} out={a - 0.4} label="The guns and skins the studio made. That's it." />
        <div style={{ position: 'absolute', left: 160, top: 300, display: 'flex', flexDirection: 'column', gap: 56 }}>
          <Card at={a} out={b - 0.3} big="$1,500–3,000" label="per weapon model" />
          <Card at={a + 1.6} out={b - 0.3} big="~2 weeks" label="each" accent={C.forge} size={110} />
        </div>
        <div style={{ position: 'absolute', left: 160, top: 340 }}>
          <Card at={b + 0.2} big="$6B" label="Counter-Strike 2 skin market (Oct 2025)" size={240} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const S2b: React.FC<{ d: Durations; sec: number }> = ({ d, sec }) => {
  const c1 = cue(d, 's2b', 'Prompt Wars');
  const c2 = cue(d, 's2b', 'so the game never');
  const c3 = cue(d, 's2b', 'It turns players');
  const seg = sec / 4;
  return (
    <AbsoluteFill>
      {/* montage of generated items: the finished knight and rifle from the clips */}
      <AbsoluteFill style={{ filter: 'blur(6px)', transform: 'scale(1.04)' }}>
        <Cuts cuts={[['armour-clip.mp4', 9.4, seg], ['sniper-clip.mp4', 9.2, seg], ['armour-clip.mp4', 11, seg], ['sniper-clip.mp4', 10.6, seg]]} />
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundImage: `${C.hatch}, linear-gradient(90deg, rgba(11,13,18,0.92) 0%, rgba(11,13,18,0.75) 50%, rgba(11,13,18,0.35) 100%)` }} />
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 160, gap: 44 }}>
        <Card at={c1} label="Less dev load: players make the content" />
        <Card at={c2} label="No fixed arsenal" />
        <Card at={c3} label="Every player is a creator" />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const S5: React.FC<{ sec: number }> = ({ sec }) => {
  // the arena overview, the drone flyover over bot fights, a live fight, the death screen
  const death = 2;
  const fly = 3;
  const wide = 2;
  return <Cuts cuts={[['rec-cover.mp4', 0.3, wide], ['arena-flyover.mp4', 8.6, fly], ['rec-cover.mp4', 25.4, sec - wide - fly - death], ['rec-fit.mp4', 33.8, death]]} />;
};

const S6: React.FC<{ d: Durations }> = ({ d }) => {
  const b = cue(d, 's6', 'and we');
  return (
    <AbsoluteFill>
      <Backdrop video="rec-cover.mp4" from={10} dim={0.6} blur={6} />
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 160, flexDirection: 'row', alignItems: 'center', gap: 160 }}>
        <Card at={0.5} big="320" label="bots in the load test" size={260} />
        <Card at={b} big="20" label="real players at once" accent={C.forge} size={260} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const PROMPTS = [
  'fire sniper rifle with a long scorched barrel',
  'medieval knight in battered plate armour',
  'jellyfish plasma rifle',
  'cactus shotgun',
  'noodle sword',
  'toaster cannon',
];

const S7: React.FC<{ d: Durations }> = ({ d }) => {
  const c2 = cue(d, 's7', 'On a cheaper');
  const c3 = cue(d, 's7', "We'd charge");
  const c4 = cue(d, 's7', 'But the bigger');
  const t = useCurrentFrame() / PROMO_FPS;
  const costOut = interpolate(t, [c4 - 0.4, c4], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <Backdrop video="arena-flyover.mp4" from={2} rate={0.6} dim={0.75} />
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 160, gap: 48, opacity: costOut }}>
        <Card at={0.5} big="~$0.02" label="per weapon (Claude Haiku)" />
        <Card at={c2} big="<$0.003" label="on cheaper models" accent={C.forge} size={110} />
        <Card at={c3} label="Monthly sub for more generations" />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: 1 - costOut, flexDirection: 'row', alignItems: 'center', paddingLeft: 160, gap: 70 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ ...useIn(c4), font: `600 22px / 1 ${F.label}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.fgDim, marginBottom: 8 }}>Prompts players typed</div>
          {PROMPTS.map((p, i) => (
            <PromptRow key={p} text={p} at={c4 + 0.3 + i * 0.35} />
          ))}
        </div>
        <Arrow at={c4 + 2.6} />
        <div style={{ ...useIn(c4 + 3), display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ font: `600 150px / 0.9 ${F.display}`, color: C.accent }}>Trends</div>
          <div style={{ font: `600 34px / 1.15 ${F.label}`, color: C.fg, letterSpacing: '0.04em', textTransform: 'uppercase' }}>What players want in skin lines</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const PromptRow: React.FC<{ text: string; at: number }> = ({ text, at }) => (
  <div style={{ ...useIn(at), padding: '12px 20px', background: 'rgba(20,24,33,0.92)', border: `1px solid ${C.line}`, clipPath: clipCut(8), font: `500 28px / 1.2 ${F.body}`, color: C.fg }}>“{text}”</div>
);

const Arrow: React.FC<{ at: number }> = ({ at }) => {
  const st = useIn(at);
  return (
    <div style={{ ...st, display: 'flex', alignItems: 'center' }}>
      <div style={{ width: 120, height: 6, background: C.forgeGrad }} />
      <div style={{ width: 0, height: 0, borderTop: '18px solid transparent', borderBottom: '18px solid transparent', borderLeft: `26px solid ${C.forge2}` }} />
    </div>
  );
};

const S8: React.FC = () => {
  const url = useIn(0.6);
  return (
    <AbsoluteFill style={{ background: C.ink900 }}>
      <Img src={src('cover.png')} style={{ width: '100%', height: '100%' }} />
      <div style={{ position: 'absolute', right: 70, bottom: 50, ...url }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '18px 30px', background: 'rgba(11,13,18,0.92)', border: `1px solid ${C.lineStrong}`, clipPath: clipCut(12) }}>
          <span style={{ font: `600 22px / 1 ${F.label}`, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.hpHi }}>● Live</span>
          <span style={{ font: `600 44px / 1 ${F.label}`, letterSpacing: '0.03em', color: C.fg }}>http://187.7.27.171</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ composition

export const Promo: React.FC<PromoProps> = ({ durations }) => {
  if (!durations) return <AbsoluteFill style={{ background: C.ink900 }} />;
  const d = durations;
  const sec = (id: SectionId) => sectionSec(d, id);
  const body: Record<SectionId, React.ReactNode> = {
    s1: <S1 sec={sec('s1')} />,
    s2: <S2 d={d} />,
    s2b: <S2b d={d} sec={sec('s2b')} />,
    s3: (
      <AbsoluteFill>
        <Fill video="armour-clip.mp4" clipSec={12.77} sec={sec('s3')} />
        <Chip text="Closet · step 1" />
      </AbsoluteFill>
    ),
    s4: (
      <AbsoluteFill>
        <Fill video="sniper-clip.mp4" clipSec={12.7} sec={sec('s4')} />
        <Chip text="Forge · step 2" />
      </AbsoluteFill>
    ),
    s5: <S5 sec={sec('s5')} />,
    s6: <S6 d={d} />,
    s7: <S7 d={d} />,
    s8: <S8 />,
  };
  const items: React.ReactNode[] = [];
  PROMO_SECTIONS.forEach((s, i) => {
    if (i > 0) items.push(<TransitionSeries.Transition key={`t-${s.id}`} presentation={fade()} timing={linearTiming({ durationInFrames: T_FADE })} />);
    items.push(
      <TransitionSeries.Sequence key={s.id} durationInFrames={Math.round(sec(s.id) * PROMO_FPS)}>
        {body[s.id]}
        <Vo id={s.id} />
      </TransitionSeries.Sequence>,
    );
  });
  return (
    <AbsoluteFill style={{ background: C.ink900 }}>
      <TransitionSeries>{items}</TransitionSeries>
    </AbsoluteFill>
  );
};
