import { test, expect } from '@playwright/test';
import { HEAD_CENTER_CROUCHED, HEAD_CENTER_STANDING, MAX_HEADSHOT_DAMAGE, RESPAWN_DELAY_SECONDS, clampWeapon } from '@ai-gaem/shared';
import {
  SERVER,
  aimAt,
  aimAtHead,
  hook,
  fireOnce,
  joinGame,
  shot,
  state,
  teleport,
  waitForState,
  waitSeenAt,
  type Player,
} from './helpers';

// Two players on a clear lane of the TEST MAP (x = 4, no crates between z = -4 and z = 6).
const POS_A: [number, number, number] = [4, 0.1, 6];
const POS_B: [number, number, number] = [4, 0.1, -4];

test.describe.configure({ mode: 'serial' });

let A: Player;
let B: Player;
const tag = Math.random().toString(36).slice(2, 6);

test.beforeAll(async ({ browser }) => {
  [A, B] = await Promise.all([joinGame(browser, `Alice-${tag}`), joinGame(browser, `Bob-${tag}`)]);
  console.log(`[e2e] server=${SERVER} A=${A.id.slice(0, 10)} B=${B.id.slice(0, 10)}`);
});

test.afterAll(async () => {
  await A?.context.close();
  await B?.context.close();
});

/** put both players on the lane, facing each other, and wait until each renders the other there */
async function lineUp() {
  await teleport(A, POS_A, 0);
  await teleport(B, POS_B, Math.PI);
  await waitSeenAt(A, B.id, POS_B);
  await waitSeenAt(B, A.id, POS_A);
}

/** A shoots B with spaced shots (slower than the weapon's fire rate) until B dies */
async function killB(maxShots = 30) {
  const a = await state(A.page);
  const dmg = a.weapon.damage * a.weapon.pellets;
  const gapMs = Math.ceil(1000 / a.weapon.fireRate) + 120;
  const drops: number[] = [];
  let hp = (await state(B.page)).hp;
  for (let i = 0; i < maxShots && hp > 0; i++) {
    await aimAt(A, B.id);
    await fireOnce(A);
    await A.page.waitForTimeout(gapMs);
    const b = await state(B.page);
    drops.push(+(hp - b.hp).toFixed(2));
    hp = b.hp;
    if (!b.alive) break;
    if (a.weapon.magSize > 0 && i % a.weapon.magSize === a.weapon.magSize - 1) await A.page.waitForTimeout(a.weapon.reloadTime * 1000 + 300);
  }
  return { dmg, drops };
}

test('a. two players see each other and movement replicates @smoke', async () => {
  // each sees the other in their scene
  await waitForState(A.page, (s) => s.playersSeen.some((p) => p.id === B.id && p.visible), 15_000, 'A sees B');
  await waitForState(B.page, (s) => s.playersSeen.some((p) => p.id === A.id && p.visible), 15_000, 'B sees A');

  // spawned at a server spawn point (a TEST MAP spawn), on the ground
  const a0 = await state(A.page);
  expect(a0.pos[1]).toBeGreaterThan(-0.5);
  expect(a0.pos[1]).toBeLessThan(4);

  await lineUp();
  await aimAt(B, A.id);
  await B.page.waitForTimeout(300);
  await shot(B, 'a1-bob-sees-alice.png');
  await aimAt(A, B.id);
  await A.page.waitForTimeout(300);
  await shot(A, 'a2-alice-sees-bob.png');

  // movement of A is reflected on B
  const moved: [number, number, number] = [POS_A[0] - 3, POS_A[1], POS_A[2] + 2];
  await teleport(A, moved, 0);
  const seen = await waitSeenAt(B, A.id, moved, 0.3);
  const ra = seen.playersSeen.find((p) => p.id === A.id)!;
  expect(Math.hypot(ra.netPos[0] - moved[0], ra.netPos[2] - moved[2])).toBeLessThan(0.1);
  await aimAt(B, A.id);
  await B.page.waitForTimeout(300);
  await shot(B, 'a3-bob-sees-alice-moved.png');
});

test('b. pistol kills: server-computed damage, kill feed, kills/deaths', async () => {
  test.skip(SERVER !== 'local', 'local only');
  await lineUp();
  const a0 = await state(A.page);
  const b0 = await state(B.page);
  expect(a0.weapon.class).toBe('pistol');
  expect(b0.hp).toBe(100);

  const { dmg, drops } = await killB();
  console.log(`[e2e] pistol dmg/shot=${dmg} hp drops=${drops.join(',')}`);
  // every observed drop is a whole number of server-computed hits (spread can miss)
  for (const d of drops.slice(0, -1)) expect(Math.abs(d) < 0.01 || Math.abs(d - dmg) < 0.01, `drop ${d} is 0 or ${dmg}`).toBe(true);
  expect(drops.at(-1)!).toBeLessThanOrEqual(dmg + 0.01);
  expect(drops.filter((d) => d > 0).length).toBe(Math.ceil(100 / dmg));

  const b1 = await waitForState(B.page, (s) => !s.alive && s.deathVisible, 5_000, 'B dead');
  expect(b1.hp).toBe(0);
  await expect(B.page.getByTestId('death-screen')).toBeVisible();
  await shot(B, 'b1-bob-death-screen.png');

  // kill feed on both, kills / deaths updated
  const a1 = await waitForState(A.page, (s) => s.kills === a0.kills + 1 && s.killLog.length > 0, 5_000, 'A kill credited');
  const b2 = await waitForState(B.page, (s) => s.deaths === b0.deaths + 1, 5_000, 'B death counted');
  expect(a1.killLog.at(-1)).toContain(`You [${a0.weaponName}] Bob-${tag}`);
  expect(b2.killLog.at(-1)).toContain(`Alice-${tag} [${a0.weaponName}] You`);
  await expect(A.page.getByTestId('killfeed')).toContainText(`Bob-${tag}`);
  await expect(B.page.getByTestId('killfeed')).toContainText(`Alice-${tag}`);
  // A no longer renders the dead player
  await waitForState(A.page, (s) => s.playersSeen.some((p) => p.id === B.id && !p.visible), 5_000, 'B hidden on A');
  await shot(A, 'b2-alice-killfeed.png');
});

test('c. death screen: keep loadout, then generate a new weapon', async () => {
  test.skip(SERVER !== 'local', 'local only');
  const dead = await waitForState(B.page, (s) => !s.alive, 5_000, 'B dead');
  const w0 = dead.weaponId;

  // --- Keep loadout: respawns after the server delay with the same weapon ---
  await B.page.getByTestId('keep-loadout').click();
  const b1 = await waitForState(B.page, (s) => s.alive && !s.deathVisible, RESPAWN_DELAY_SECONDS * 1000 + 8_000, 'B respawned');
  expect(Date.now()).toBeGreaterThanOrEqual(dead.respawnAt - 500);
  expect(b1.weaponId).toBe(w0);
  expect(b1.hp).toBe(100);
  await shot(B, 'c1-bob-respawned-keep-loadout.png');

  // --- die again, then Generate new weapon ---
  await lineUp();
  await killB();
  await waitForState(B.page, (s) => !s.alive && s.deathVisible, 5_000, 'B dead again');
  await B.page.getByTestId('weapon-prompt').fill('a bubble gun that traps people');
  await B.page.getByTestId('generate-weapon').click();
  await expect(B.page.getByTestId('gen-status')).toContainText(/bubble|·/i, { timeout: 30_000 });
  await shot(B, 'c2-bob-generated-weapon.png');

  const b2 = await waitForState(B.page, (s) => s.alive && s.weaponId !== w0, 20_000, 'B respawned with new weapon');
  expect(b2.serverWeaponId).toBe(b2.weaponId);
  expect(b2.weapon.class).toBe('bubble_gun');
  // stats are within clampWeapon bounds: clamping again is a no-op
  const { id: _id, ...w } = b2.weapon;
  expect(clampWeapon(w)).toEqual(w);
  // the viewmodel was rebuilt from library parts
  expect(b2.viewmodelMeshes).toBeGreaterThan(1);
  expect(w.parts.length).toBeGreaterThan(1);
  await expect(B.page.getByTestId('weapon-name')).toHaveText(b2.weaponName);
  console.log(`[e2e] generated weapon #${b2.weaponId} "${b2.weaponName}" parts=${w.parts.length} meshes=${b2.viewmodelMeshes}`);
  await B.page.waitForTimeout(300);
  await shot(B, 'c3-bob-new-weapon-viewmodel.png');

  // the other player sees the new weapon model in Bob's hand
  await lineUp();
  await waitForState(A.page, (s) => s.playersSeen.some((p) => p.id === B.id && p.weaponId === b2.weaponId && p.hasWeaponModel), 5_000, 'A sees new weapon');
  await aimAt(A, B.id);
  await A.page.waitForTimeout(300);
  await shot(A, 'c4-alice-sees-bob-new-weapon.png');
});

test('d. server rejects shots faster than fireRate', async () => {
  test.skip(SERVER !== 'local', 'local only');
  await lineUp();
  const b0 = await waitForState(B.page, (s) => s.alive && s.hp === 100, 5_000, 'B full hp');
  const a0 = await state(A.page);
  const dmg = a0.weapon.damage * a0.weapon.pellets;
  const interval = 1 / a0.weapon.fireRate;
  // full magazine (client + server), then let any previous cooldown expire
  if (a0.ammo < a0.weapon.magSize) {
    await A.page.evaluate(() => (window as unknown as { __game: { reload(): void } }).__game.reload());
    await waitForState(A.page, (s) => s.ammo === s.weapon.magSize, a0.weapon.reloadTime * 1000 + 3000, 'A reloaded');
    await A.page.waitForTimeout(300); // server reload timer
  }
  await A.page.waitForTimeout(interval * 1000 + 200);
  // accuracy isn't under test here: no spread / bloom / recoil
  await hook(A, (g) => g.setPerfectAim(true));
  // spam 10 shots ~50 ms apart (client cooldown bypassed; the server must enforce it)
  const spamMs = await A.page.evaluate((id) => {
    const g = (window as unknown as { __game: { aimAt(id: string): boolean; fireOnce(): boolean } }).__game;
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) {
      // busy-wait instead of setTimeout: background-tab timer throttling would space shots out
      while (performance.now() - t0 < i * 50) {
        /* spin */
      }
      g.aimAt(id);
      g.fireOnce();
    }
    return performance.now() - t0;
  }, B.id);
  await A.page.waitForTimeout(1500);
  const a1 = await state(A.page);
  expect(a0.weapon.magSize - a1.ammo, 'all 10 shots left the client').toBe(10);
  const b1 = await state(B.page);
  const drop = b0.hp - b1.hp;
  // server cooldown = interval * 0.85 tolerance => at most floor(spam / minInterval) + 1 accepted shots
  const maxAccepted = Math.floor(spamMs / 1000 / (interval * 0.85)) + 1;
  console.log(`[e2e] spam: 10 shots in ${spamMs.toFixed(0)}ms, dmg=${dmg}, hp drop=${drop}, max allowed=${maxAccepted * dmg}`);
  // shots spaced >= the server cooldown still land (so the rejections are due to rate, not aim)
  const minAccepted = Math.max(1, Math.floor(spamMs / 1000 / interval) - 1);
  expect(drop).toBeGreaterThanOrEqual(minAccepted * dmg - 0.01);
  expect(drop).toBeLessThanOrEqual(maxAccepted * dmg + 0.01);
  expect(drop).toBeLessThan(10 * dmg);
  expect(b1.alive).toBe(true);
  await shot(B, 'd1-bob-after-spam.png');
});

/** make sure B is alive with full HP (kill + keep-loadout respawn if needed) */
async function freshB() {
  let b = await state(B.page);
  if (b.alive && b.hp === 100) return b;
  if (b.alive) {
    await lineUp();
    await hook(A, (g) => g.setPerfectAim(true));
    await killB();
  }
  await waitForState(B.page, (s) => !s.alive && s.deathVisible, 5_000, 'B dead');
  await B.page.getByTestId('keep-loadout').click();
  b = await waitForState(B.page, (s) => s.alive && s.hp === 100, RESPAWN_DELAY_SECONDS * 1000 + 8_000, 'B respawned');
  return b;
}

/** A: full magazine on client + server, cooldown expired */
async function reloadA() {
  const a = await state(A.page);
  if (a.ammo < a.weapon.magSize) {
    await hook(A, (g) => g.reload());
    await waitForState(A.page, (s) => s.ammo === s.weapon.magSize, a.weapon.reloadTime * 1000 + 3000, 'A reloaded');
  }
  await A.page.waitForTimeout(400 + 1000 / a.weapon.fireRate);
}

/** wait for B's hp to settle after a shot and return the drop */
async function hpDrop(before: number, gapMs: number) {
  await A.page.waitForTimeout(gapMs);
  const b = await state(B.page);
  return { drop: +(before - b.hp).toFixed(2), b };
}

test('e. headshots: server applies the multiplier, rejects implausible head hits, kill feed icon', async () => {
  test.skip(SERVER !== 'local', 'local only');
  await freshB();
  await lineUp();
  await reloadA();
  await hook(A, (g) => g.setPerfectAim(true));
  const a0 = await state(A.page);
  const w = a0.weapon;
  expect(w.class).toBe('pistol');
  const body = w.damage * w.pellets;
  const head = Math.min(body * w.headshotMultiplier, Math.max(body, MAX_HEADSHOT_DAMAGE));
  expect(w.headshotMultiplier).toBe(2);
  const gapMs = Math.ceil(1000 / w.fireRate) + 150;
  const b0 = await state(B.page);
  const rb = (await state(A.page)).playersSeen.find((p) => p.id === B.id)!;
  expect(rb.head[1] - rb.pos[1]).toBeCloseTo(HEAD_CENTER_STANDING, 1);

  // 1) real headshot through the client raycast (head hitbox)
  await aimAtHead(A, B.id);
  await hook(A, (g) => g.holdHitmarker(true));
  expect(await fireOnce(A)).toBe(true);
  const s1 = await waitForState(A.page, (s) => s.hitmarker.includes('headshot'), 2_000, 'A headshot hitmarker');
  expect(s1.hitmarker).toContain('show');
  await shot(A, 'e1-alice-headshot-hitmarker.png');
  await hook(A, (g) => g.holdHitmarker(false));
  let { drop, b } = await hpDrop(b0.hp, gapMs);
  console.log(`[e2e] headshot: body=${body} head=${head} drop=${drop}`);
  expect(drop).toBeCloseTo(head, 2);

  // 2) body shot through the client raycast: plain damage
  await aimAt(A, B.id);
  await fireOnce(A);
  ({ drop, b } = await hpDrop(b.hp, gapMs));
  expect(drop).toBeCloseTo(body, 2);

  // 3) forged "head" hit at B's feet: the server downgrades it to a body hit
  const bFeet = b.pos;
  await hook(A, (g, args) => g.reportHitRaw(args.id, 1, args.p), { id: B.id, p: [bFeet[0], bFeet[1] + 0.3, bFeet[2]] as [number, number, number] });
  ({ drop, b } = await hpDrop(b.hp, gapMs));
  console.log(`[e2e] implausible head zone at the feet: drop=${drop} (body=${body})`);
  expect(drop).toBeCloseTo(body, 2);

  // 4) headshot finishes B: kill feed shows the headshot icon on both screens
  const killer = (await state(A.page)).kills;
  for (let i = 0; i < 6 && b.alive; i++) {
    await aimAtHead(A, B.id);
    await fireOnce(A);
    ({ b } = await hpDrop(b.hp, gapMs));
  }
  expect(b.alive).toBe(false);
  await waitForState(A.page, (s) => s.kills === killer + 1, 5_000, 'A kill credited');
  await expect(A.page.getByTestId('kf-headshot').first()).toBeVisible();
  await expect(B.page.getByTestId('kf-headshot').first()).toBeVisible();
  await shot(A, 'e2-alice-killfeed-headshot.png');
});

test('f. crouch: replicated, lowers remote hitboxes, crouched headshots validated', async () => {
  test.skip(SERVER !== 'local', 'local only');
  await freshB();
  await lineUp();
  await reloadA();
  await hook(A, (g) => g.setPerfectAim(true));

  // local crouch: eye height eases down, row replicates
  await hook(B, (g) => g.setCrouch(true));
  const bc = await waitForState(B.page, (s) => s.crouching && s.eyeHeight < 1.1 && s.serverCrouching, 5_000, 'B crouched locally + on server');
  expect(bc.eyeHeight).toBeCloseTo(1.02, 1);
  // remote: A renders B crouched with the head hitbox lowered
  const seen = await waitForState(
    A.page,
    (s) => s.playersSeen.some((p) => p.id === B.id && p.crouching && p.crouchT === 1),
    5_000,
    'A sees B crouched',
  );
  const rb = seen.playersSeen.find((p) => p.id === B.id)!;
  expect(rb.head[1] - rb.pos[1]).toBeCloseTo(HEAD_CENTER_CROUCHED, 1);
  await aimAt(A, B.id);
  await A.page.waitForTimeout(300);
  await shot(A, 'f1-alice-sees-bob-crouched.png');
  await shot(B, 'f2-bob-crouched-view.png');

  const a0 = await state(A.page);
  const w = a0.weapon;
  const body = w.damage * w.pellets;
  const head = Math.min(body * w.headshotMultiplier, Math.max(body, MAX_HEADSHOT_DAMAGE));
  const gapMs = Math.ceil(1000 / w.fireRate) + 150;
  let b = await state(B.page);

  // forged head hit at *standing* head height while B is crouched: body damage only
  await hook(A, (g, args) => g.reportHitRaw(args.id, 1, args.p), {
    id: B.id,
    p: [b.pos[0], b.pos[1] + HEAD_CENTER_STANDING + 0.3, b.pos[2]] as [number, number, number],
  });
  let drop: number;
  ({ drop, b } = await hpDrop(b.hp, gapMs));
  expect(drop).toBeCloseTo(body, 2);

  // a real headshot on the crouched head counts as a headshot
  await aimAtHead(A, B.id);
  await fireOnce(A);
  ({ drop, b } = await hpDrop(b.hp, gapMs));
  console.log(`[e2e] crouched headshot drop=${drop} (head=${head})`);
  expect(drop).toBeCloseTo(Math.min(head, b.hp + drop), 2);

  // stand up again: replicated
  await hook(B, (g) => g.setCrouch(false));
  await waitForState(B.page, (s) => !s.crouching && s.eyeHeight > 1.55 && !s.serverCrouching, 5_000, 'B standing');
  await waitForState(A.page, (s) => s.playersSeen.some((p) => p.id === B.id && !p.crouching && p.crouchT === 0), 5_000, 'A sees B standing');
  await hook(B, (g) => g.setCrouch(null));

  // ADS view (screenshot): zoomed FOV, centred viewmodel, tighter spread
  await hook(A, (g) => g.setPerfectAim(false));
  const hip = await state(A.page);
  await hook(A, (g) => g.setAds(true));
  const ads = await waitForState(A.page, (s) => s.ads === 1 && s.fov < hip.fov * 0.85, 3_000, 'A aiming');
  expect(ads.spread).toBeLessThan(hip.spread);
  await aimAt(A, B.id);
  await A.page.waitForTimeout(400);
  await shot(A, 'f3-alice-ads.png');
  await hook(A, (g) => g.setAds(null));
});
