import { Composition, staticFile } from 'remotion';
import { PromptWarsForge, type PromptWarsForgeProps } from './PromptWarsForge';
import { FPS, HEIGHT, WIDTH, totalFrames, type CaptureMeta } from './timeline';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="PromptWarsForge"
    component={PromptWarsForge}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    durationInFrames={FPS * 10}
    defaultProps={{ capture: null } satisfies PromptWarsForgeProps}
    calculateMetadata={async ({ props }) => {
      // the take's markers decide the cut points and the length (run `pnpm video:capture` first)
      const capture = props.capture ?? ((await fetch(staticFile('capture.json')).then((r) => r.json())) as CaptureMeta);
      return { durationInFrames: totalFrames(capture), props: { ...props, capture } };
    }}
  />
);
