// Stage the promo's media in video/public/promo/ (gitignored):
//   - the user's live-gameplay screen recording, cropped to the game viewport only (no menu bar,
//     browser tabs / toolbar or dock) at 1920x1080 30 fps: rec-cover.mp4 fills the frame (trims
//     ~4 % off each side), rec-fit.mp4 keeps the whole viewport width (letterboxed; for the death
//     screen, whose panels span the full width)
//   - the slide clips, the arena flyover and the cover image
//
//   pnpm video:promo:prep [--rec "<path to .mov>"] [--crop x,y,w,h]
//
// --crop is the game viewport inside the recording, in recording pixels (default: the 3024x1964
// recording of 2026-10-04: viewport at 66..2927 x 310..1796, inset by a few px off the border).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { outDir, publicDir } from './lib';

const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : d;
};
const desk = join(homedir(), 'Desktop');
const REC = opt('rec', join(desk, 'Screen Recording 2026-10-04 at 10.13.11.mov'));
const [vx, vy, vw, vh] = opt('crop', '70,314,2852,1478').split(',').map(Number) as [number, number, number, number];
const dir = join(publicDir, 'promo');

function ff(args: string[], what: string) {
  console.log(`[promo-prep] ${what}`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${what}`);
}

mkdirSync(dir, { recursive: true });
if (!existsSync(REC)) throw new Error(`missing screen recording: ${REC}`);
// cover: a 16:9 window centred in the viewport, full viewport height
const cw = Math.round((vh * 16) / 9 / 2) * 2;
const cx = Math.round(vx + (vw - cw) / 2);
const enc = ['-an', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium'];
ff(['-i', REC, '-vf', `crop=${cw}:${vh}:${cx}:${vy},scale=1920:1080:flags=lanczos,fps=30,format=yuv420p`, ...enc, join(dir, 'rec-cover.mp4')], 'rec-cover.mp4 (viewport, 16:9 fill)');
ff(['-i', REC, '-vf', `crop=${vw}:${vh}:${vx}:${vy},scale=1920:-2:flags=lanczos,pad=1920:1080:0:(oh-ih)/2:color=0x0b0d12,fps=30,format=yuv420p`, ...enc, join(dir, 'rec-fit.mp4')], 'rec-fit.mp4 (whole viewport, letterboxed)');

const copies: [string, string][] = [
  [join(desk, 'armour-clip.mp4'), 'armour-clip.mp4'],
  [join(desk, 'sniper-clip.mp4'), 'sniper-clip.mp4'],
  [join(desk, 'prompt-wars-cover.png'), 'cover.png'],
  [join(outDir, 'arena-flyover.mp4'), 'arena-flyover.mp4'],
];
for (const [from, to] of copies) {
  const alt = join(outDir, to);
  const src = existsSync(from) ? from : alt;
  if (!existsSync(src)) throw new Error(`missing ${from}`);
  copyFileSync(src, join(dir, to));
  console.log(`[promo-prep] ${to}`);
}
