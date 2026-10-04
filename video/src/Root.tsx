import { Composition, staticFile } from 'remotion';
import { CLIP_FPS, Clip, clipFrames, type ClipKind, type ClipProps } from './Clip';
import { PromptWarsForge, type PromptWarsForgeProps } from './PromptWarsForge';
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
  </>
);
