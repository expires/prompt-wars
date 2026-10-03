import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HEALTH_PACK_HEAL, MAX_HP, PICKUP_RESPAWN_SECONDS, TAURON_REMAKE_PICKUPS } from '@ai-gaem/shared';
import { SERVER, hook, joinGame, shot, state, teleport, waitForState, type GameState, type Player } from './helpers';

/**
 * Health pack on the tauron-remake stage (local SpacetimeDB only):
 *   E2E_DB=pw-pickups-e2e pnpm e2e pickups     (publish the module to that db first)
 * A damaged player walks over the pack: HP rises by +50 (capped), the pack disappears for both
 * players, and comes back after the respawn delay. The test shortens the delay to a few seconds
 * with the admin reducer set_pickup_respawn (needs the CLI identity = the db's publisher) and
 * restores the production 60 s afterwards.
 */

const MAP = 'tauron-remake';
const DB = process.env.E2E_DB ?? 'prompt-wars-63xhe';
const TEST_RESPAWN_S = 15;
const PACK = TAURON_REMAKE_PICKUPS[0]!;
// on the stage deck (top 1.2 m), clear of the pack (touch radius 0.9 m), the DJ desk and the letters
const SHOOTER_POS: [number, number, number] = [3, 1.25, 3];
const VICTIM_POS: [number, number, number] = [2.5, 1.25, -2.8];

test.skip(SERVER !== 'local', 'needs the admin reducer on a local database');
test.describe.configure({ mode: 'serial' });

function adminCall(reducer: string, ...args: string[]) {
  const env = { ...process.env, PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH}` };
  const r = spawnSync('spacetime', ['call', '--server', 'local', DB, reducer, ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`spacetime call ${reducer} failed: ${r.stderr || r.stdout}`);
}

let A: Player; // shooter / observer
let B: Player; // gets hurt, takes the pack

const tag = Math.random().toString(36).slice(2, 6);
const pack = (s: GameState) => s.pickups.find((p) => p.id === 1);

test.beforeAll(async ({ browser }) => {
  adminCall('set_pickup_respawn', String(TEST_RESPAWN_S));
  [A, B] = await Promise.all([joinGame(browser, `Medic-${tag}`, { map: MAP }), joinGame(browser, `Hurt-${tag}`, { map: MAP })]);
});

test.afterAll(async () => {
  try {
    adminCall('set_pickup_respawn', String(PICKUP_RESPAWN_SECONDS));
  } finally {
    await A?.context.close();
    await B?.context.close();
  }
});

test('a damaged player picks up the stage health pack; it respawns', async () => {
  test.setTimeout(240_000);
  // both clients render the pack (it may still be respawning from an earlier run)
  for (const p of [A, B]) {
    const s = await waitForState(p.page, (x) => !!pack(x)?.available && !!pack(x)?.visible, 30_000, `${p.name} sees the pack`);
    expect(pack(s)!.pos[1]).toBeCloseTo(PACK.y, 2);
  }

  // screenshot: the pack on the stage
  await teleport(A, [4.2, 1.25, 3.4]);
  await hook(A, (g) => g.lookAt(0, 1.6, 0));
  await A.page.waitForTimeout(600);
  await shot(A, 'pickup-pack-on-stage.png');

  // B gets hurt (server-validated body hits from A)
  await teleport(A, SHOOTER_POS);
  await teleport(B, VICTIM_POS, 0);
  await A.page.waitForTimeout(500);
  for (let i = 0; i < 12; i++) {
    const s = await state(B.page);
    if (s.serverHp !== undefined && s.serverHp <= 70) break;
    await hook(A, (g, args) => g.reportHitRaw(args.id, 0, args.at), { id: B.id, at: [VICTIM_POS[0], VICTIM_POS[1] + 1.0, VICTIM_POS[2]] as [number, number, number] });
    await A.page.waitForTimeout(450);
  }
  const hurt = await waitForState(B.page, (x) => x.alive && (x.serverHp ?? MAX_HP) < MAX_HP && x.hp < MAX_HP, 10_000, 'B damaged');
  const hp0 = hurt.serverHp!;
  const events0 = hurt.pickupEvents;
  console.log(`[e2e] B hp before the pack: ${hp0}`);

  // full HP players leave it alone: A stands on it first, nothing happens
  await teleport(A, [PACK.x + 0.2, PACK.y + 0.05, PACK.z + 0.2]);
  await A.page.waitForTimeout(1200);
  expect(pack(await state(A.page))!.available).toBe(true);
  await teleport(A, SHOOTER_POS);

  // B walks onto the pack (real input-driven movement, facing -z)
  await teleport(B, [PACK.x, 1.25, PACK.z + 2.4], 0);
  await B.page.waitForTimeout(300);
  await hook(B, (g) => g.setAutoRun(true));
  const healed = await waitForState(B.page, (x) => (x.serverHp ?? 0) > hp0, 10_000, 'B healed by the pack');
  await hook(B, (g) => g.setAutoRun(false));
  // feedback on B: the pickup event and the "+N" heal number (lives < 1 s)
  await waitForState(B.page, (x) => x.pickupEvents > events0 && x.damageNumbers.some((d) => d.targetId === 'heal:local'), 2_000, 'B pickup feedback');
  await shot(B, 'pickup-taken-heal-flash.png');
  const expected = Math.min(MAX_HP, hp0 + HEALTH_PACK_HEAL);
  expect(healed.serverHp).toBeCloseTo(expected, 3);
  await waitForState(B.page, (x) => Math.abs(x.hp - expected) < 1e-3, 3_000, 'B HUD hp updated');

  // the pack is gone for everyone
  for (const p of [A, B]) {
    await waitForState(p.page, (x) => pack(x)?.available === false && pack(x)?.visible === false, 5_000, `${p.name} sees the pack taken`);
  }
  await teleport(B, VICTIM_POS, 0);
  await teleport(A, [4.2, 1.25, 3.4]);
  await hook(A, (g) => g.lookAt(0, 1.6, 0));
  await A.page.waitForTimeout(300);
  await shot(A, 'pickup-respawning.png');

  // ... and back after the respawn delay
  for (const p of [A, B]) {
    await waitForState(p.page, (x) => !!pack(x)?.available && !!pack(x)?.visible, TEST_RESPAWN_S * 1000 + 6_000, `${p.name} sees the pack respawn`);
  }
  await A.page.waitForTimeout(500);
  await shot(A, 'pickup-respawned.png');
});
