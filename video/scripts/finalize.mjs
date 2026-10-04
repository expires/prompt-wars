#!/usr/bin/env node
// PowerPoint / YouTube-friendly MP4s: Remotion's JPEG frames come out full-range (yuvj420p);
// re-encode to standard yuv420p H.264 (TV range) with the moov atom up front (faststart).
// Audio is dropped unless --keep-audio (then copied as is: Remotion's AAC).
// Usage: finalize.mjs [--keep-audio] <mp4>...
import { spawnSync } from 'node:child_process';
import { renameSync } from 'node:fs';

const args = process.argv.slice(2);
const keepAudio = args.includes('--keep-audio');
for (const f of args.filter((a) => !a.startsWith('--'))) {
  const tmp = f.replace(/\.mp4$/, '.tmp.mp4');
  const audio = keepAudio ? ['-c:a', 'copy'] : ['-an'];
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', f, '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '16', '-color_range', 'tv', ...audio, '-movflags', '+faststart', tmp],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
  renameSync(tmp, f);
  console.log(`finalized ${f}`);
}
