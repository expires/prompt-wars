#!/usr/bin/env node
// PowerPoint-friendly MP4s: Remotion's JPEG frames come out full-range (yuvj420p); re-encode to
// standard yuv420p H.264 (TV range) with the moov atom up front (faststart). Usage: finalize.mjs <mp4>...
import { spawnSync } from 'node:child_process';
import { renameSync } from 'node:fs';

for (const f of process.argv.slice(2)) {
  const tmp = f.replace(/\.mp4$/, '.tmp.mp4');
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', f, '-vf', 'scale=in_range=full:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '16', '-color_range', 'tv', '-an', '-movflags', '+faststart', tmp],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
  renameSync(tmp, f);
  console.log(`finalized ${f}`);
}
