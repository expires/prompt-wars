// Promo voiceover: one ElevenLabs clip per section of src/promo/script.ts, loudness-normalised
// (EBU R128, -16 LUFS integrated, -1.5 dBTP) to video/public/vo/<id>.wav, plus durations.json.
//
//   ELEVENLABS_API_KEY=... pnpm video:voiceover [--voice george|daniel] [--only s3]
//
// The key is read from the environment only (never written anywhere); the audio is gitignored.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROMO_SECTIONS } from '../src/promo/script';
import { publicDir } from './lib';

const VOICES: Record<string, string> = { george: 'JBFqnCBsd6RMkjVDRZzb', daniel: 'onwK4e9ZLuTAKqWW03F9' };
const argv = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : d;
};
const voice = opt('voice', 'george');
const only = opt('only', '');
const outDir = join(publicDir, 'vo');

async function main() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  const voiceId = VOICES[voice] ?? voice;
  mkdirSync(outDir, { recursive: true });
  const durFile = join(outDir, 'durations.json');
  const durations: Record<string, number> = existsSync(durFile) ? JSON.parse(readFileSync(durFile, 'utf8')) : {};
  for (const s of PROMO_SECTIONS) {
    if (only && s.id !== only) continue;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: s.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true },
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${s.id}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const mp3 = join(outDir, `${s.id}.mp3`);
    writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
    const wav = join(outDir, `${s.id}.wav`);
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '2', wav], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`loudnorm ${s.id} failed`);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' });
    durations[s.id] = +Number(probe.stdout.trim()).toFixed(3);
    console.log(`[voiceover] ${s.id}: ${durations[s.id]}s`);
  }
  writeFileSync(durFile, JSON.stringify({ ...durations, voice }, null, 2) + '\n');
}

main().catch((e) => {
  console.error(`[voiceover] FAILED: ${(e as Error).message}`);
  process.exit(1);
});
