#!/usr/bin/env node
// `pnpm e2e`: start a local SpacetimeDB (if one isn't already running on :3000), publish the
// module to it, then run Playwright (which starts Vite itself). Extra args go to Playwright,
// e.g. `pnpm e2e --grep "cooldown"`. Stops the SpacetimeDB server afterwards if it started it.
import { spawn, spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(here, '..');
const serverDir = resolve(clientDir, '../server');
const env = { ...process.env, PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH}` };
const LOCAL = 'http://127.0.0.1:3000';

async function ping() {
  try {
    const r = await fetch(`${LOCAL}/v1/ping`);
    return r.ok;
  } catch {
    return false;
  }
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit' });
  return r.status ?? 1;
}

let started;
async function main() {
  if (!(await ping())) {
    console.log('[e2e] starting local SpacetimeDB (spacetime start) ...');
    const log = openSync(join(here, '.spacetime.log'), 'a');
    started = spawn('spacetime', ['start'], { env, detached: true, stdio: ['ignore', log, log] });
    started.on('error', (e) => console.error('[e2e] failed to start spacetime:', e.message));
    for (let i = 0; i < 60 && !(await ping()); i++) await new Promise((r) => setTimeout(r, 500));
    if (!(await ping())) throw new Error('local SpacetimeDB did not come up on :3000 (see e2e/.spacetime.log)');
  } else {
    console.log('[e2e] using the SpacetimeDB already running on :3000');
  }

  console.log('[e2e] publishing module to local ...');
  if (run('pnpm', ['run', 'publish:local'], serverDir) !== 0) throw new Error('publish:local failed');

  console.log('[e2e] running playwright ...');
  return run('npx', ['playwright', 'test', ...process.argv.slice(2)], clientDir);
}

function stop() {
  if (started?.pid) {
    console.log('[e2e] stopping local SpacetimeDB');
    try {
      process.kill(-started.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

main()
  .then((code) => {
    stop();
    process.exit(code);
  })
  .catch((err) => {
    console.error(`[e2e] ${err.message ?? err}`);
    stop();
    process.exit(1);
  });
