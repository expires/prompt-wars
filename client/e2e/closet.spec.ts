import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HEALTH_PACK_HEAL, MAX_HP, PICKUP_RESPAWN_SECONDS, TAURON_REMAKE_PICKUPS, bodyStats, headCenter, zoneDamage } from '@ai-gaem/shared';
import { OUTFIT_KNIGHT, OUTFIT_TANK } from '@ai-gaem/shared/outfit/examples';
import { LEVEL_B, TUN_STAIR_D1, columnPoint, layout } from '@ai-gaem/shared/tauron-remake';
import { SERVER, hook, joinGame, shot, state, teleport, waitForState, type Player } from './helpers';

/**
 * Closet (outfits) against a local SpacetimeDB:
 *   E2E_DB=pw-closet-e2e pnpm e2e closet     (publish the module to that db first)
 * A small (Scout preset) and a big (custom, registered) player: server-derived max HP differs,
 * spawn HP = max HP, the health pack caps at the body's max HP (> 100 for the big one), a
 * headshot at the big player's *scaled* head height counts as a headshot, and the big player
 * walks up the player-tunnel stairs into the concourse. First login with `?closet=1`: the Closet
 * (step 1, character) comes before the Forge (step 2, weapon); Esc on step 1 returns to the landing.
 */

const MAP = 'tauron-remake';
const DB = process.env.E2E_DB ?? 'prompt-wars-63xhe';
const PACK = TAURON_REMAKE_PICKUPS[0]!;
const A_POS: [number, number, number] = [3, 1.25, 3];
const B_POS: [number, number, number] = [2.5, 1.25, -2.8];

test.skip(SERVER !== 'local', 'needs the admin reducer on a local database');
test.describe.configure({ mode: 'serial' });

function adminCall(reducer: string, ...args: string[]) {
  const env = { ...process.env, PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH}` };
  const r = spawnSync('spacetime', ['call', '--server', 'local', DB, reducer, ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`spacetime call ${reducer} failed: ${r.stderr || r.stdout}`);
}

let A: Player; // small (Scout), shooter
let C: Player | undefined; // first-login flow
let B: Player; // big (custom tank)
const tag = Math.random().toString(36).slice(2, 6);
const BIG = { ...OUTFIT_TANK, name: `Big ${tag}`, pieces: [...OUTFIT_TANK.pieces, OUTFIT_KNIGHT.pieces.find((p) => p.id === 'cape')!], body: { size: 1.08, build: 1.3, head: 1.2, limbs: 1 } };
const bigStats = bodyStats(BIG.body);

test.beforeAll(async ({ browser }) => {
  adminCall('set_pickup_respawn', '5');
  [A, B] = await Promise.all([joinGame(browser, `Small-${tag}`, { map: MAP }), joinGame(browser, `Big-${tag}`, { map: MAP })]);
});

test.afterAll(async () => {
  try {
    adminCall('set_pickup_respawn', String(PICKUP_RESPAWN_SECONDS));
  } finally {
    await A?.context.close();
    await B?.context.close();
    await C?.context.close();
  }
});

test('small and big outfits: server-derived max HP, spawn HP, remote hitbox', async () => {
  test.setTimeout(120_000);
  const presets = await hook(A, (g) => g.outfitPresets());
  const scout = presets.find((p) => p.name === 'Scout')!;
  expect(scout, 'Scout preset seeded').toBeTruthy();
  // alive: the editor path redeploys (free at full HP), equips, respawns
  await hook(A, (g, id) => g.equipOutfit(null, 'preset', id), scout.id);
  await hook(B, (g, o) => g.equipOutfit(o, 'a giant knight tank'), BIG);
  const a = await waitForState(A.page, (s) => s.alive && s.serverMaxHp === scout.maxHp && s.outfitId === scout.id, 20_000, 'A wears Scout');
  const b = await waitForState(B.page, (s) => s.alive && s.serverMaxHp === bigStats.maxHp && !!s.outfit, 20_000, 'B wears the big outfit');
  expect(a.serverMaxHp).toBe(70);
  expect(b.serverMaxHp).toBeGreaterThan(MAX_HP);
  expect(a.serverHp).toBe(a.serverMaxHp);
  expect(b.serverHp).toBe(b.serverMaxHp);
  expect(b.maxHp).toBe(bigStats.maxHp);
  // local body: capsule / eye scale, speed
  expect(a.playerDims?.scale).toBeCloseTo(0.85, 3);
  expect(b.playerDims?.scale).toBeCloseTo(1.08, 3);
  expect(a.bodySpeedMult).toBeGreaterThan(1);
  expect(b.bodySpeedMult).toBeLessThan(1);
  // each sees the other's outfit + scaled hitbox
  const seenB = await waitForState(A.page, (s) => s.playersSeen.some((p) => p.id === B.id && p.outfit.id === b.outfitId && p.outfit.parts > 0), 15_000, 'A sees B dressed');
  const rb = seenB.playersSeen.find((p) => p.id === B.id)!;
  expect(rb.outfit.dims.scale).toBeCloseTo(1.08, 3);
  expect(rb.maxHp).toBe(bigStats.maxHp);
  const seenA = await waitForState(B.page, (s) => s.playersSeen.some((p) => p.id === A.id && p.outfit.id === scout.id), 15_000, 'B sees A dressed');
  expect(seenA.playersSeen.find((p) => p.id === A.id)!.outfit.dims.scale).toBeCloseTo(0.85, 3);

  // screenshots: each looks at the other on the stage
  await teleport(A, [0, 1.25, 2.4], 0);
  await teleport(B, [0, 1.25, -1.2], Math.PI);
  await A.page.waitForTimeout(1500);
  await hook(A, (g) => g.lookAt(0, 2.0, -1.2));
  await A.page.waitForTimeout(800);
  await shot(A, 'closet-small-sees-big.png');
  await teleport(A, [0, 1.25, -1.2], Math.PI);
  await teleport(B, [0, 1.25, 2.4], 0);
  await B.page.waitForTimeout(1500);
  await hook(B, (g) => g.lookAt(0, 1.6, -1.2));
  await B.page.waitForTimeout(800);
  await shot(B, 'closet-big-sees-small.png');
});

test('health pack heals up to the body max HP (above 100 for a big body)', async () => {
  test.setTimeout(120_000);
  await teleport(A, A_POS);
  await teleport(B, B_POS, 0);
  await A.page.waitForTimeout(500);
  // hurt B to ~<= 100 with server-validated body hits
  for (let i = 0; i < 20; i++) {
    const s = await state(B.page);
    if ((s.serverHp ?? 999) <= 100) break;
    await hook(A, (g, args) => g.reportHitRaw(args.id, 0, args.at), { id: B.id, at: [B_POS[0], B_POS[1] + 1.0, B_POS[2]] as [number, number, number] });
    await A.page.waitForTimeout(450);
  }
  const hurt = await waitForState(B.page, (s) => s.alive && (s.serverHp ?? 999) <= 100, 10_000, 'B hurt');
  const hp0 = hurt.serverHp!;
  await waitForState(B.page, (s) => s.pickups.some((p) => p.id === 1 && p.available), 20_000, 'pack available');
  await teleport(B, [PACK.x, 1.25, PACK.z + 2.4], 0);
  await B.page.waitForTimeout(300);
  await hook(B, (g) => g.setAutoRun(true));
  const healed = await waitForState(B.page, (s) => (s.serverHp ?? 0) > hp0, 10_000, 'B healed');
  await hook(B, (g) => g.setAutoRun(false));
  const expected = Math.min(bigStats.maxHp, hp0 + HEALTH_PACK_HEAL);
  expect(healed.serverHp).toBeCloseTo(expected, 3);
  expect(expected).toBeGreaterThan(MAX_HP);
});

test('a headshot at the big player’s scaled head height counts as a headshot', async () => {
  test.setTimeout(90_000);
  await teleport(A, A_POS);
  await teleport(B, B_POS, 0);
  await B.page.waitForTimeout(1500);
  const before = await state(B.page);
  const hp0 = before.serverHp!;
  const w = (await state(A.page)).weapon!;
  // above where a standard head could be (headCenter(default) = 1.66 + 0.46 tolerance), inside the scaled one
  const y = B_POS[1] + headCenter(bigStats) + 0.32;
  await hook(A, (g, args) => g.reportHitRaw(args.id, 1, args.at), { id: B.id, at: [B_POS[0], y, B_POS[2]] as [number, number, number] });
  const after = await waitForState(B.page, (s) => (s.serverHp ?? hp0) < hp0 || !s.alive, 8_000, 'B hit');
  const dmg = hp0 - (after.alive ? after.serverHp! : 0);
  const head = zoneDamage(w, w.damage * w.pellets, 1);
  expect(head).toBeGreaterThan(w.damage * w.pellets);
  expect(dmg).toBeCloseTo(Math.min(hp0, head), 0);
});

test('the big player walks up the player-tunnel stairs into the concourse', async () => {
  test.setTimeout(180_000);
  // runnable on its own: wear the big body first
  if (!(await state(B.page)).outfit) {
    await hook(B, (g, o) => g.equipOutfit(o, 'a giant knight tank'), BIG);
    await waitForState(B.page, (s) => s.alive && s.serverMaxHp === bigStats.maxHp, 20_000, 'B wears the big outfit');
  }
  const col = layout().columns.find((c) => c.a === 'tunnel' && c.part === 'E')!;
  const p0 = columnPoint(col.index, 0.5, -1.5);
  const p1 = columnPoint(col.index, 0.5, TUN_STAIR_D1 + 0.5);
  const yaw = Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
  await hook(B, (g) => g.setCrouch(false));
  await teleport(B, [p0.x, 0.05, p0.z], yaw);
  await B.page.waitForTimeout(500);
  await hook(B, (g) => g.setAutoRun(true));
  // ~26 m of corridor + stairs (slow under SwiftShader with two clients)
  const top = await waitForState(B.page, (s) => s.pos[1] > LEVEL_B - 0.3, 120_000, 'B reaches the concourse');
  await hook(B, (g) => g.setAutoRun(false));
  expect(top.crouching).toBe(false);
  expect(top.playerDims?.scale).toBeCloseTo(1.08, 3);
});

test('first login (?closet=1): Closet (character) comes before the Forge (weapon)', async ({ browser }) => {
  test.setTimeout(240_000);
  // last test: the two dressed players are done (three SwiftShader clients starve the lazy chunks)
  await A?.context.close();
  await B?.context.close();
  C = await joinGame(browser, `New-${tag}`, { loadout: 'none', query: { closet: '1' } });
  const p = C.page;
  expect((await state(p)).needsLoadout).toBe(true);
  await expect(p.getByTestId('landing')).toContainText('Create a character to start.');

  // Esc on step 1 goes back to the landing (no deploy)
  await p.getByTestId('landing-play').click();
  await expect(p.getByTestId('closet-editor')).toBeVisible({ timeout: 45_000 });
  await expect(p.getByTestId('forge-editor')).toHaveCount(0);
  await p.keyboard.press('Escape');
  await expect(p.getByTestId('landing')).toBeVisible();
  await expect(p.getByTestId('closet-editor')).toHaveCount(0);
  await p.waitForTimeout(500);
  let s = await state(p);
  expect(s.alive).toBe(false);
  expect(s.needsLoadout).toBe(true);

  // step 1: the Closet first, no Skip; a quick pick + "Next: weapon"
  await p.getByTestId('landing-play').click();
  const closet = p.getByTestId('closet-editor');
  await expect(closet).toBeVisible({ timeout: 45_000 });
  await expect(p.getByTestId('forge-editor')).toHaveCount(0);
  await expect(closet.getByTestId('flow-step')).toHaveText(/Step 1\/2/);
  await expect(p.getByTestId('closet-skip')).toHaveCount(0);
  await expect(p.getByTestId('closet-equip')).toContainText('Next: weapon');
  const scout = (await hook(C, (g) => g.outfitPresets())).find((o) => o.name === 'Scout')!;
  await p.getByTestId('closet-preset').filter({ hasText: 'Scout' }).click();
  await expect(p.getByTestId('closet-equip')).toBeEnabled();
  await p.waitForTimeout(600);
  await shot(C, 'closet-first-step1.png');
  await p.getByTestId('closet-equip').click();

  // step 2: the Forge, outfit already on, still not deployed
  const forge = p.getByTestId('forge-editor');
  await expect(forge).toBeVisible({ timeout: 45_000 });
  await expect(p.getByTestId('closet-editor')).toHaveCount(0);
  await expect(forge.getByTestId('flow-step')).toHaveText(/Step 2\/2/);
  await expect(p.getByTestId('forge-equip')).toContainText('Equip & deploy');
  s = await state(p);
  expect(s.outfitId).toBe(scout.id);
  expect(s.alive).toBe(false);
  await shot(C, 'closet-first-step2.png');

  await p.getByTestId('forge-prompt').fill(`a tiny scout blaster ${tag}`);
  await p.getByTestId('forge-reforge').click();
  await waitForState(p, (x) => !!x.forge && !x.forge.busy && !!x.forge.design, 40_000, 'forged');
  await p.getByTestId('forge-equip').click();
  s = await waitForState(p, (x) => x.alive && !x.needsLoadout && x.screen === 'none', 20_000, 'deployed after step 2');
  expect(s.outfitId).toBe(scout.id);
  expect(s.serverMaxHp).toBe(scout.maxHp);
  expect(s.serverHp).toBe(scout.maxHp);
});
