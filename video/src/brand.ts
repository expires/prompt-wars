// Prompt Wars brand, mirrored from client/src/ui/tokens.css (+ the landing logo in
// client/src/ui/menus/menus.css). Fonts: the same Google Fonts the client loads in index.html.
import { loadFont as loadBarlow } from '@remotion/google-fonts/Barlow';
import { loadFont as loadChakra } from '@remotion/google-fonts/ChakraPetch';
import { loadFont as loadTeko } from '@remotion/google-fonts/Teko';

loadTeko('normal', { weights: ['500', '600'], subsets: ['latin'] });
loadChakra('normal', { weights: ['500', '600', '700'], subsets: ['latin'] });
loadBarlow('normal', { weights: ['400', '500', '600'], subsets: ['latin'] });

export const C = {
  ink900: '#0b0d12',
  ink800: '#141821',
  ink700: '#1e2430',
  line: 'rgba(255, 255, 255, 0.1)',
  lineStrong: 'rgba(255, 255, 255, 0.18)',
  fg: '#f5f3ee',
  fgDim: '#a9b0be',
  fgMute: '#6b7383',
  accent: '#ffd23f',
  hpHi: '#4be38a',
  forge: '#ff3da5',
  forge2: '#7b5cff',
  forgeGrad: 'linear-gradient(100deg, #ff3da5 0%, #7b5cff 100%)',
  hatch: 'repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0 2px, transparent 2px 9px)',
} as const;

export const F = {
  display: "'Teko', 'Barlow Condensed', 'Arial Narrow', sans-serif",
  label: "'Chakra Petch', 'Barlow', system-ui, sans-serif",
  body: "'Barlow', system-ui, sans-serif",
} as const;

export const clipCut = (cut: number) =>
  `polygon(0 0, calc(100% - ${cut}px) 0, 100% ${cut}px, 100% 100%, ${cut}px 100%, 0 calc(100% - ${cut}px))`;
