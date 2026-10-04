import { Composition, staticFile } from 'remotion';
import { CLIP_FPS, Clip, clipFrames, type ClipKind, type ClipProps } from './Clip';
import { PromptWarsForge, type PromptWarsForgeProps } from './PromptWarsForge';
import { PROMO_FPS, Promo, promoFrames, type Durations, type PromoProps } from './promo/Promo';
import { FPS, HEIGHT, WIDTH, totalFrames, type CaptureMeta } from './timeline';

// the take's markers decide the cut points and the length (run `pnpm video:capture` first)
const loadCapture = async () => (await fetch(staticFile('capture.json')).then((r) => r.json())) as CaptureMeta;

const clip = (id: string, kind: ClipKind) => (
  <Composition
    id={id}
    component={Clip}
    width={WIDTH}
    height={HEIGHT}
    fps={CLIP_FPS}
    durationInFrames={CLIP_FPS * 10}
    defaultProps={{ kind, capture: null } satisfies ClipProps}
    calculateMetadata={async ({ props }) => {
      const capture = props.capture ?? (await loadCapture());
      return { durationInFrames: clipFrames(capture, props.kind), props: { ...props, capture } };
    }}
  />
);

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="PromptWarsForge"
      component={PromptWarsForge}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={FPS * 10}
      defaultProps={{ capture: null } satisfies PromptWarsForgeProps}
      calculateMetadata={async ({ props }) => {
        const capture = props.capture ?? (await loadCapture());
        return { durationInFrames: totalFrames(capture), props: { ...props, capture } };
      }}
    />
    {clip('ArmourClip', 'closet')}
    {clip('WeaponClip', 'forge')}
    <Composition
      id="Promo"
      component={Promo}
      width={WIDTH}
      height={HEIGHT}
      fps={PROMO_FPS}
      durationInFrames={PROMO_FPS * 10}
      defaultProps={{ durations: null } satisfies PromoProps}
      calculateMetadata={async ({ props }) => {
        // section lengths follow the voiceover clips (run `pnpm video:voiceover` first)
        const durations = props.durations ?? ((await fetch(staticFile('vo/durations.json')).then((r) => r.json())) as Durations);
        return { durationInFrames: promoFrames(durations), props: { ...props, durations } };
      }}
    />
  </>
);
