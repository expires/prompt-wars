// Weapon side effects (local SpacetimeDB): elemental hits and carry weight.
//   q. fire: a hit sets the victim burning (HP keeps dropping from the burn DoT, orange glow +
//      flames on the remote model, BURNING chip + vignette locally); the kill feed shows the flame
//   r. ice: a hit chills the victim (their real movement speed drops, blue glow / frost vignette)
//   s. carry weight: a heavy-weapon player walks slower than a pistol player
import { test, expect } from '@playwright/test';
import { RESPAWN_DELAY_SECONDS, clampWeapon, designToWeapon, sanitizeDesign } from '@ai-gaem/shared';
import { EXAMPLE_REVOLVER } from '@ai-gaem/shared/forge/examples';
import { SERVER, aimAt, fireOnce, hook, joinGame, shot, state, teleport, waitForState, waitSeenAt, type Player } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(SERVER !== 'local', 'local only');

const tag = Math.random().toString(36).slice(2, 6);
let A: Player;
let B: Player;

// clear lane of the test map (x = 4, no crates between z = -4 and z = 6)
const POS_A: [number, number, number] = [4, 0.1, 6];
const POS_B: [number, number, number] = [4, 0.1, -4];

const variant = (name: string, stats: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  ...EXAMPLE_REVOLVER,
  ...extra,
  name,
  stats: { ...EXAMPLE_REVOLVER.stats, ...stats },
});
const EMBER = variant('Ember Revolver', { element: 'fire' });
const FROST = variant('Frost Revolver', { element: 'ice', damage: 10 });
const SIEGE = variant('Siege Cannon', { damage: 80, fireRate: 0.5, magSize: 1, projectileSpeed: 30, splashRadius: 3 }, { class: 'rocket_launcher', fireMode: 'projectile' });

test.beforeAll(async ({ browser }) => {
  [A, B] = await Promise.all([joinGame(browser, `Pyro-${tag}`), joinGame(browser, `Yeti-${tag}`)]);
});

test.afterAll(async () => {
  await A?.context.close();
  await B?.context.close();
});

async function lineUp() {
  await teleport(A, POS_A, 0);
  await teleport(B, POS_B, Math.PI);
  await waitSeenAt(A, B.id, POS_B);
  await waitSeenAt(B, A.id, POS_A);
  // the remote hitboxes follow the rendered model on the next physics step
  await A.page.waitForTimeout(250);
}

/** A shoots B until the server applies a hit (a fresh lineUp can still miss once) */
async function hitB(pred: (hp: number) => boolean, what: string) {
  const w = (await state(A.page)).weapon;
  for (let i = 0; i < 3; i++) {
    await aimAt(A, B.id);
    expect(await fireOnce(A)).toBe(true);
    try {
      return await waitForState(B.page, (s) => pred(s.hp), Math.ceil(1000 / w.fireRate) + 1200, what);
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  throw new Error(what);
}

async function equip(p: Player, design: typeof EMBER) {
  await hook(p, (g, d) => g.equipDesign(d, 'element test'), design as unknown);
  return waitForState(p.page, (x) => x.alive && x.weaponName === design.name && x.screen === 'none', RESPAWN_DELAY_SECONDS * 1000 + 15_000, `${p.name} holds ${design.name}`);
}

test('q. fire weapon: burn DoT keeps draining HP, burning visuals, flame in the kill feed', async () => {
  // what the server will make of the design: fire element with the default burn (12 over 3 s)
  const w = designToWeapon(sanitizeDesign(EMBER).design);
  expect(w.element).toBe('fire');
  expect(w.dotDamage).toBeGreaterThan(0);

  const a = await equip(A, EMBER);
  expect(a.weapon.element).toBe('fire');
  await hook(A, (g) => g.setPerfectAim(true));
  await lineUp();
  const b0 = await waitForState(B.page, (s) => s.alive && s.hp === 100, 5_000, 'B full hp');

  const direct = a.weapon.damage * a.weapon.pellets;
  const hit = await hitB((hp) => hp <= b0.hp - direct + 0.01, 'B hit');
  // status from the replicated row; the HUD chip follows on the next frame
  await waitForState(B.page, (s) => s.status.burning && s.hudStatus.includes('status-fire'), 2_000, 'B burning (HUD chip)');
  await expect(B.page.getByTestId('fx-burning')).toHaveClass(/is-on/);
  // A renders B burning: status from the replicated row, orange glow on the model
  const seen = await waitForState(A.page, (s) => s.playersSeen.some((p) => p.id === B.id && p.status.burning && p.tint > 0), 3_000, 'A sees B burning');
  expect(seen.playersSeen.find((p) => p.id === B.id)!.status.dot).toBe('fire');
  await B.page.waitForTimeout(250);
  await shot(B, 'q1-burning-victim-view.png');
  await aimAt(A, B.id);
  await A.page.waitForTimeout(350);
  await shot(A, 'q2-attacker-sees-burning.png');

  // no more shots: HP keeps dropping from the burn
  await B.page.waitForTimeout(1500);
  const later = await state(B.page);
  console.log(`[e2e] fire: direct=${direct} dot=${a.weapon.dotDamage}/${a.weapon.dotDuration}s hp ${b0.hp} -> ${hit.hp} -> ${later.hp}`);
  expect(later.hp).toBeLessThan(hit.hp - 2);
  // burn ends with its duration; the total DoT matches the weapon
  const done = await waitForState(B.page, (s) => !s.status.burning, (a.weapon.dotDuration + 2) * 1000, 'burn over');
  const dot = b0.hp - direct - done.hp;
  expect(dot).toBeGreaterThanOrEqual(a.weapon.dotDamage - 0.6);
  expect(dot).toBeLessThanOrEqual(a.weapon.dotDamage + 0.6);
  await expect(B.page.getByTestId('fx-burning')).not.toHaveClass(/is-on/);

  // finish B: the kill feed carries the fire icon
  const gap = Math.ceil(1000 / a.weapon.fireRate) + 150;
  for (let i = 0; i < 12; i++) {
    const b = await state(B.page);
    if (!b.alive) break;
    if (i > 0 && i % a.weapon.magSize === 0) await A.page.waitForTimeout(a.weapon.reloadTime * 1000 + 300);
    await aimAt(A, B.id);
    await fireOnce(A);
    await A.page.waitForTimeout(gap);
  }
  await waitForState(B.page, (s) => !s.alive, 6_000, 'B dead');
  await expect(A.page.getByTestId('kf-element-fire').first()).toBeVisible();
  await shot(A, 'q3-killfeed-fire.png');
  await B.page.getByTestId('keep-loadout').click();
  await waitForState(B.page, (s) => s.alive && s.hp === 100, RESPAWN_DELAY_SECONDS * 1000 + 8_000, 'B respawned');
});

test('r. ice weapon: a hit chills the victim and slows their real movement', async () => {
  const a = await equip(A, FROST);
  expect(a.weapon.element).toBe('ice');
  expect(a.weapon.slowPercent).toBeGreaterThan(0);
  await hook(A, (g) => g.setPerfectAim(true));
  await lineUp();

  // B walks toward A with real input (autorun); baseline speed first
  await hook(B, (g) => g.setAutoRun(true));
  await B.page.waitForTimeout(400);
  const base = (await hook(B, (g) => g.measureSpeed(400))) as unknown as number;
  await hitB((hp) => hp < 100, 'B hit by the frost revolver');
  // (speedScale is applied on the next rendered frame)
  const chilled = await waitForState(B.page, (s) => s.status.chilled && s.speedScale < 1, 2_000, 'B chilled');
  expect(chilled.speedScale).toBeCloseTo(1 - a.weapon.slowPercent / 100, 2);
  const slow = (await hook(B, (g) => g.measureSpeed(350))) as unknown as number;
  // A renders B chilled (blue glow) while it lasts
  await waitForState(A.page, (s) => s.playersSeen.some((p) => p.id === B.id && p.status.chilled && p.tint > 0), 1_000, 'A sees B chilled');
  const b = await state(B.page);
  await shot(B, 'r1-chilled-victim-view.png');
  await aimAt(A, B.id);
  await shot(A, 'r2-attacker-sees-chilled.png');
  await hook(B, (g) => g.setAutoRun(false));
  console.log(`[e2e] ice: slow ${a.weapon.slowPercent}% speed ${base.toFixed(2)} -> ${slow.toFixed(2)} m/s (scale ${chilled.speedScale})`);
  expect(b.hudStatus).toContain('status-ice');
  expect(base).toBeGreaterThan(3.5);
  expect(slow).toBeLessThan(base * 0.8);
  expect(slow).toBeGreaterThan(base * 0.4);
  // the chill wears off (1.5 s)
  await waitForState(B.page, (s) => !s.status.chilled && s.speedScale === 1, 3_000, 'chill over');
});

test('s. carry weight: heavy launcher walks slower than a pistol', async () => {
  // A switches to a heavy launcher design, B keeps the pistol
  const a = await equip(A, SIEGE);
  const b = await state(B.page);
  expect(a.weapon.class).toBe('rocket_launcher');
  expect(b.weapon.class).toBe('pistol');
  const heavy = clampWeapon(a.weapon).moveSpeedMult!;
  const light = clampWeapon(b.weapon).moveSpeedMult!;
  expect(heavy).toBeLessThan(0.95);
  expect(light).toBeGreaterThan(1.02);
  expect(a.moveMult).toBeCloseTo(heavy, 3);
  expect(b.moveMult).toBeCloseTo(light, 3);
  await expect(A.page.getByTestId('hud-move')).toContainText('−');
  await expect(B.page.getByTestId('hud-move')).toContainText('+');

  const walk = async (p: Player) => {
    await teleport(p, POS_B, Math.PI);
    await hook(p, (g) => g.setAutoRun(true));
    await p.page.waitForTimeout(400);
    const v = (await hook(p, (g) => g.measureSpeed(600))) as unknown as number;
    await hook(p, (g) => g.setAutoRun(false));
    return v;
  };
  // one at a time on the same lane (they'd bump into each other)
  await teleport(B, [8, 0.1, 6], 0);
  const vHeavy = await walk(A);
  await teleport(A, [8, 0.1, 6], 0);
  const vLight = await walk(B);
  await shot(A, 's1-heavy-weapon-hud.png');
  console.log(`[e2e] carry: heavy ${heavy} -> ${vHeavy.toFixed(2)} m/s, pistol ${light} -> ${vLight.toFixed(2)} m/s`);
  expect(vHeavy).toBeLessThan(vLight * 0.9);
  expect(vHeavy / vLight).toBeCloseTo(heavy / light, 1);
});
