import { test, expect } from '@playwright/test';
import {
  BLOCK_DAMAGE_MULT,
  CHARGED_BODY_CAP,
  MELEE_PHASES,
  RESPAWN_DELAY_SECONDS,
  effectiveFireRate,
  meleeHitDamage,
  meleeReach,
  type MeleeSwing,
} from '@ai-gaem/shared';
import { SERVER, aimAt, fireOnce, hook, joinGame, shot, state, teleport, waitForState, waitSeenAt, type GameState, type Player } from './helpers';

// Melee round: A and B on the TEST MAP lane (x = 4, clear between z = -4 and z = 6).
test.describe.configure({ mode: 'serial' });

let A: Player;
let B: Player;
const tag = Math.random().toString(36).slice(2, 6);

test.beforeAll(async ({ browser }) => {
  test.skip(SERVER !== 'local', 'local only');
  [A, B] = await Promise.all([joinGame(browser, `Mel-${tag}`), joinGame(browser, `Lee-${tag}`)]);
});

test.afterAll(async () => {
  await A?.context.close();
  await B?.context.close();
});

/** A at `dist` metres in front of B on the lane, facing each other; both render the other there */
async function face(dist: number, bYaw = Math.PI) {
  const pa: [number, number, number] = [4, 0.1, 0 + dist];
  const pb: [number, number, number] = [4, 0.1, 0];
  await teleport(A, pa, 0);
  await teleport(B, pb, bYaw);
  await waitSeenAt(A, B.id, pb, 0.2);
  await waitSeenAt(B, A.id, pa, 0.2);
  await aimAt(A, B.id);
  await A.page.waitForTimeout(150);
}

const swingGapMs = (s: GameState) => Math.ceil(1000 / effectiveFireRate(s.weapon)) + 200;

/** `killer` kills `victim` with whatever it holds (guns: spaced shots, melee: swings at 1.5 m) */
async function kill(killer: Player, victim: Player) {
  const k = await state(killer.page);
  const melee = k.weapon.fireMode === 'melee';
  if (melee) {
    const pv: [number, number, number] = [4, 0.1, -2];
    await teleport(victim, pv, Math.PI);
    await teleport(killer, [4, 0.1, -0.5], 0);
    await waitSeenAt(killer, victim.id, pv, 0.2);
  } else {
    await teleport(killer, [4, 0.1, 6], 0);
    await teleport(victim, [4, 0.1, -4], Math.PI);
    await waitSeenAt(killer, victim.id, [4, 0.1, -4], 0.3);
  }
  await hook(killer, (g) => g.setPerfectAim(true));
  const gap = melee ? swingGapMs(k) : Math.ceil(1000 / k.weapon.fireRate) + 150;
  for (let i = 0; i < 40; i++) {
    const v = await state(victim.page);
    if (!v.alive) return;
    await aimAt(killer, victim.id);
    if (melee) await hook(killer, (g) => g.meleeSwing(0));
    else await fireOnce(killer);
    await killer.page.waitForTimeout(gap);
    if (!melee && k.weapon.magSize > 0 && i % k.weapon.magSize === k.weapon.magSize - 1) await killer.page.waitForTimeout(k.weapon.reloadTime * 1000 + 300);
  }
  await waitForState(victim.page, (s) => !s.alive, 5_000, 'victim dead');
}

async function respawnKeep(p: Player) {
  await waitForState(p.page, (s) => !s.alive && s.deathVisible, 5_000, `${p.name} dead`);
  await p.page.getByTestId('keep-loadout').click();
  return waitForState(p.page, (s) => s.alive && s.hp === 100, RESPAWN_DELAY_SECONDS * 1000 + 8_000, `${p.name} respawned`);
}

async function equipMeleePreset(p: Player) {
  const id = (await hook(p, (g) => g.equipPreset('melee'))) as unknown as string;
  await waitForState(p.page, (s) => s.serverWeaponId === id, 5_000, 'equipped melee');
  return respawnKeep(p);
}

/** dead `p` generates a weapon from `prompt` on the death screen and respawns with it */
async function generate(p: Player, prompt: string) {
  const before = (await state(p.page)).weaponId;
  await p.page.getByTestId('weapon-prompt').fill(prompt);
  await p.page.getByTestId('generate-weapon').click();
  return waitForState(p.page, (s) => s.alive && s.weaponId !== before && !!s.weapon, 30_000, `${p.name} respawned with "${prompt}"`);
}

async function hpDrop(p: Player, before: number, ms = 700) {
  await p.page.waitForTimeout(ms);
  const s = await state(p.page);
  return { drop: +(before - s.hp).toFixed(2), s };
}

test('i. melee: swing hits within reach (server damage), misses beyond reach, replicates to the other client', async () => {
  // A dies to B's pistol, picks the melee preset (Machete: slash) and respawns with it.
  // Third person: A rendered B's gun shots as a recoil pose.
  await kill(B, A);
  const recoils = (await state(A.page)).playersSeen.find((r) => r.id === B.id)?.anim.recoils ?? 0;
  console.log(`[e2e] A saw ${recoils} recoil poses on B`);
  expect(recoils).toBeGreaterThan(0);
  const a = await equipMeleePreset(A);
  expect(a.weapon.fireMode).toBe('melee');
  expect(a.melee?.meta.swing).toBe('slash');
  const w = a.weapon;
  const reach = meleeReach(w);
  console.log(`[e2e] melee weapon ${w.name}: dmg ${w.damage} reach ${reach.toFixed(2)} m meta ${JSON.stringify(a.melee?.meta)} rate ${effectiveFireRate(w).toFixed(2)}/s`);

  await face(1.5);
  const b0 = await state(B.page);
  const seen0 = (await state(B.page)).playersSeen.find((r) => r.id === A.id)!.anim.melees;
  expect(await hook(A, (g) => g.meleeSwing(0))).toBe(true);
  // the other client plays the swing on A's humanoid
  const seen = await waitForState(B.page, (s) => (s.playersSeen.find((r) => r.id === A.id)?.anim.melees ?? 0) > seen0, 3_000, 'B sees A swing');
  const anim = seen.playersSeen.find((r) => r.id === A.id)!.anim;
  console.log(`[e2e] B renders A's swing: ${JSON.stringify(anim)}`);
  expect(anim.swing).toBe('slash');
  let { drop, s: b } = await hpDrop(B, b0.hp);
  const last = (await state(A.page)).melee?.last;
  console.log(`[e2e] in-reach swing: contacts=${last?.contacts} drop=${drop}`);
  expect(last?.contacts).toBe(1);
  expect(drop).toBeCloseTo(meleeHitDamage(w, 0, 0), 2);

  // beyond reach: the local sweep finds nothing, and a forged hit at that distance is rejected
  await face(reach + 1.6);
  await A.page.waitForTimeout(swingGapMs(a));
  await hook(A, (g) => g.meleeSwing(0));
  ({ drop, s: b } = await hpDrop(B, b.hp));
  expect((await state(A.page)).melee?.last?.contacts).toBe(0);
  expect(drop).toBe(0);
  await A.page.waitForTimeout(swingGapMs(a));
  const bp = b.pos;
  await hook(A, (g, args) => g.reportHitRaw(args.id, 0, args.p), { id: B.id, p: [bp[0], bp[1] + 1, bp[2] + 0.3] as [number, number, number] });
  ({ drop, s: b } = await hpDrop(B, b.hp));
  console.log(`[e2e] forged melee hit from ${(reach + 1.6).toFixed(1)} m: drop=${drop}`);
  expect(drop, 'server rejects melee hits beyond reach').toBe(0);
  // the same forged hit from inside the reach is accepted
  await face(1.2);
  await A.page.waitForTimeout(swingGapMs(a));
  const bp2 = (await state(B.page)).pos;
  await hook(A, (g, args) => g.reportHitRaw(args.id, 0, args.p), { id: B.id, p: [bp2[0], bp2[1] + 1, bp2[2] + 0.3] as [number, number, number] });
  ({ drop, s: b } = await hpDrop(B, b.hp));
  expect(drop).toBeCloseTo(w.damage, 2);
});

test('j. charged heavy attack: more damage, within the caps', async () => {
  // B: fresh (kill + respawn with the melee preset so it can block in k)
  await kill(A, B);
  await equipMeleePreset(B);
  const a = await state(A.page);
  const w = a.weapon;
  await face(1.5);
  await A.page.waitForTimeout(1300); // the charge must have been "held": time since the last swing
  const b0 = await state(B.page);
  expect(await hook(A, (g) => g.meleeSwing(1))).toBe(true);
  const { drop } = await hpDrop(B, b0.hp, 1200);
  const expected = meleeHitDamage(w, 1, 0);
  console.log(`[e2e] charged swing: plain=${w.damage} charged expected=${expected} drop=${drop}`);
  expect(drop).toBeGreaterThan(w.damage);
  expect(drop).toBeLessThanOrEqual(Math.max(w.damage, CHARGED_BODY_CAP) + 0.01);
  expect(drop).toBeCloseTo(expected, 1);
  expect((await state(A.page)).melee?.last?.charge).toBe(1);
});

test('k. block: front hits do 40%, hits from behind full damage; block replicates', async () => {
  let b = await state(B.page);
  if (b.hp < 100) {
    await kill(A, B);
    b = await respawnKeep(B);
  }
  expect(b.weapon.fireMode).toBe('melee');
  const a = await state(A.page);
  const w = a.weapon;
  await face(1.5);
  await hook(B, (g) => g.setBlock(true));
  await waitForState(B.page, (s) => !!s.melee?.blocking && s.serverBlocking, 3_000, 'B blocking (local + server)');
  await waitForState(A.page, (s) => !!s.playersSeen.find((r) => r.id === B.id)?.anim.blocking, 3_000, 'A sees B blocking');
  await aimAt(A, B.id);
  await A.page.waitForTimeout(400);
  await shot(A, 'k1-alice-sees-bob-blocking.png');
  await shot(B, 'k2-bob-block-first-person.png');
  await A.page.waitForTimeout(swingGapMs(a));
  b = await state(B.page);
  await hook(A, (g) => g.meleeSwing(0));
  let drop: number;
  ({ drop, s: b } = await hpDrop(B, b.hp));
  console.log(`[e2e] blocked from the front: drop=${drop} (full ${w.damage})`);
  expect(drop).toBeCloseTo(w.damage * BLOCK_DAMAGE_MULT, 2);

  // B turns its back (still blocking): full damage
  await teleport(B, [4, 0.1, 0], 0);
  await waitSeenAt(A, B.id, [4, 0.1, 0], 0.2);
  await A.page.waitForTimeout(300);
  await aimAt(A, B.id);
  await A.page.waitForTimeout(swingGapMs(a));
  await hook(A, (g) => g.meleeSwing(0));
  ({ drop, s: b } = await hpDrop(B, b.hp));
  console.log(`[e2e] blocking but hit from behind: drop=${drop}`);
  expect(drop).toBeCloseTo(w.damage, 2);
  await hook(B, (g) => g.setBlock(null));
});

/**
 * Screenshot one swing mid-strike: A's first-person view and B's third-person view of A (both
 * frozen at the same progress).
 */
async function swingShots(swing: MeleeSwing, label: string) {
  const ph = MELEE_PHASES[swing];
  const u = ph.strikeStart + (ph.strikeEnd - ph.strikeStart) * 0.55;
  // B looks at A from the side so the swing reads in profile
  await teleport(A, [4, 0.1, 3], 0);
  await teleport(B, [6.6, 0.1, 1.2], 0);
  await waitSeenAt(B, A.id, [4, 0.1, 3], 0.2);
  await waitSeenAt(A, B.id, [6.6, 0.1, 1.2], 0.2);
  await hook(B, (g, id) => g.aimAt(id), A.id);
  await hook(A, (g) => g.lookAt(4, 1.4, -4));
  await A.page.waitForTimeout(1400);
  const seen0 = (await state(B.page)).playersSeen.find((r) => r.id === A.id)!.anim.melees;
  await hook(B, (g, uu) => g.freezeAnims(uu), u);
  await hook(A, (g, uu) => g.freezeAnims(uu), u);
  await hook(A, (g) => g.meleeSwing(0));
  await waitForState(B.page, (s) => (s.playersSeen.find((r) => r.id === A.id)?.anim.melees ?? 0) > seen0, 3_000, `B sees A ${swing}`);
  await A.page.waitForTimeout(300);
  const a = await state(A.page);
  const rb = (await state(B.page)).playersSeen.find((r) => r.id === A.id)!.anim;
  console.log(`[e2e] ${label}: fp view=${a.melee?.view} u=${a.melee?.u.toFixed(2)} offset=${JSON.stringify(a.melee?.offset)} tp=${JSON.stringify(rb)}`);
  expect(a.melee?.view).toBe('swing');
  expect(rb.action).toBe('melee');
  expect(rb.swing).toBe(swing);
  await shot(A, `l-${label}-first-person.png`);
  await shot(B, `l-${label}-third-person.png`);
  await hook(A, (g) => g.freezeAnims(null));
  await hook(B, (g) => g.freezeAnims(null));
  await A.page.waitForTimeout(1200);
}

test('l. generated melee weapons (templates): umbrella sword + every swing type, screenshots', async () => {
  test.setTimeout(300_000);
  // slash: the Machete preset (A holds it after i-k; equip it when this test runs alone)
  if ((await state(A.page)).weapon.fireMode !== 'melee') {
    await kill(B, A);
    await equipMeleePreset(A);
  }
  if ((await state(B.page)).weapon.fireMode !== 'melee') {
    await kill(A, B);
    await equipMeleePreset(B);
  }
  await swingShots('slash', 'slash-machete');

  const prompts: [string, MeleeSwing, RegExp][] = [
    ["grandma's umbrella sword", 'thrust', /umbrella/i],
    ['sledgehammer', 'overhead', /sledge|hammer|maul/i],
    ['a frying pan', 'bash', /pan/i],
    ['nunchucks', 'spin', /nunchak|nunchuck/i],
  ];
  for (const [prompt, swing, re] of prompts) {
    await kill(B, A);
    const a = await generate(A, prompt);
    const w = a.weapon;
    console.log(`[e2e] "${prompt}" -> ${w.name} (${w.class}) melee=${JSON.stringify(w.melee)} parts=${w.parts.map((p: { partId: string }) => p.partId).join(',')}`);
    expect(w.class).toBe('melee');
    expect(w.fireMode).toBe('melee');
    expect(w.melee).toBeTruthy();
    expect(w.melee.swing).toBe(swing);
    expect(re.test(`${w.name} ${w.parts.map((p: { partId: string }) => p.partId).join(' ')}`)).toBe(true);
    if (swing === 'thrust') expect(w.parts.some((p: { partId: string }) => /umbrella/.test(p.partId))).toBe(true);
    expect(a.viewmodelMeshes).toBeGreaterThan(1);
    await swingShots(swing, `${swing}-${w.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
    // the generated weapon actually hits (swing animation + sweep + server)
    if (swing === 'thrust') {
      await face(1.4);
      await A.page.waitForTimeout(swingGapMs(a));
      const b0 = await state(B.page);
      await hook(A, (g) => g.meleeSwing(0));
      const { drop } = await hpDrop(B, b0.hp);
      console.log(`[e2e] umbrella thrust: drop=${drop} (dmg ${w.damage})`);
      expect(drop).toBeCloseTo(meleeHitDamage(w, 0, 0), 1);
    }
  }
});

test('m. trackpad / gamepad: fake gamepad moves + looks, T autorun, trackpad mode preset + hint', async () => {
  const p = A.page;
  let a = await state(p);
  if (!a.alive) a = await respawnKeep(A);
  await teleport(A, [4, 0.1, 5.5], 0);
  await hook(A, (g) => g.setPadPlaying(true));
  // fake standard-mapping gamepad: left stick fully forward
  await p.evaluate(() => {
    const btn = () => ({ pressed: false, touched: false, value: 0 });
    const pad = { id: 'fake', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, -1, 0, 0], buttons: Array.from({ length: 17 }, btn) };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    navigator.getGamepads = (() => [pad]) as unknown as typeof navigator.getGamepads;
  });
  const p0 = (await state(p)).pos;
  await p.waitForTimeout(800);
  let s = await state(p);
  const moved = p0[2] - s.pos[2];
  console.log(`[e2e] gamepad stick forward 0.8 s: moved ${moved.toFixed(2)} m, pad=${JSON.stringify(s.pad)}`);
  expect(s.pad?.connected).toBe(true);
  expect(moved).toBeGreaterThan(1.5);
  // right stick: turn
  const yaw0 = s.yaw;
  await p.evaluate(() => {
    const pad = (window as unknown as { __pad: { axes: number[] } }).__pad;
    pad.axes = [0, 0, 1, 0];
  });
  await p.waitForTimeout(400);
  s = await state(p);
  console.log(`[e2e] gamepad right stick 0.4 s: yaw ${yaw0.toFixed(2)} -> ${s.yaw.toFixed(2)}`);
  expect(yaw0 - s.yaw).toBeGreaterThan(0.5);
  await p.evaluate(() => {
    (window as unknown as { __pad: { axes: number[] } }).__pad.axes = [0, 0, 0, 0];
  });
  await teleport(A, [4, 0.1, 5.5], 0);

  // keyboard autorun: T starts it, W cancels it
  await p.keyboard.press('KeyT');
  await waitForState(p, (st) => st.autoRun, 2_000, 'autorun on');
  const q0 = (await state(p)).pos;
  await p.waitForTimeout(600);
  s = await state(p);
  expect(q0[2] - s.pos[2]).toBeGreaterThan(1);
  await shot(A, 'm1-autorun-status.png');
  await p.keyboard.press('KeyW');
  await waitForState(p, (st) => !st.autoRun, 2_000, 'autorun off');

  // trackpad mode preset: toggles + higher sensitivity; the hint toast offers it
  const sens0 = s.settings.sensitivity;
  await hook(A, (g) => g.setTrackpadMode(true));
  s = await state(p);
  expect(s.trackpadMode).toBe(true);
  expect(s.settings.crouchToggle && s.settings.sprintToggle && s.settings.adsToggle).toBe(true);
  expect(s.settings.sensitivity).toBeCloseTo(Math.min(4, sens0 * 1.25), 2);
  await hook(A, (g) => g.setTrackpadMode(false));
  s = await state(p);
  expect(s.settings.sensitivity).toBeCloseTo(sens0, 2);
  expect(s.settings.sprintToggle).toBe(false);
  await hook(A, (g) => g.showTrackpadHint());
  await waitForState(p, (st) => st.toastVisible, 2_000, 'trackpad hint toast');
  await shot(A, 'm2-trackpad-hint-toast.png');
  await p.getByTestId('toast-action').click();
  s = await state(p);
  expect(s.trackpadMode).toBe(true);
  await hook(A, (g) => g.setTrackpadMode(false));
  await hook(A, (g) => g.setPadPlaying(false));
});
