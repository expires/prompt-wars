// Forge flows (local SpacetimeDB + a local MOCK forge on :8788, started by `pnpm e2e`):
//   n. first login: landing -> PLAY -> Forge streams components -> lock one -> reprompt (locked
//      survives) -> EQUIP -> deployed with that design
//   o. Esc -> REDEPLOY -> death screen -> OPEN FORGE -> new weapon; Esc -> WEAPON FORGE while alive
//   p. death screen: killer card + KEEP LOADOUT, then "remix this" seeds the Forge with the killer's design
//   q. prompt cache: A forges a new prompt ("First forged"), B types it again -> cached instantly
//      ("Forged by A · 2 uses"), A kills B -> death screen quotes A's prompt
import { test, expect } from '@playwright/test';
import { RESPAWN_DELAY_SECONDS } from '@ai-gaem/shared';
import { EXAMPLE_REVOLVER } from '@ai-gaem/shared/forge/examples';
import { SERVER, aimAt, hook, fireOnce, joinGame, shot, state, teleport, waitForState, waitSeenAt, type Player } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(SERVER !== 'local', 'local only (needs the mock forge)');

const tag = Math.random().toString(36).slice(2, 6);
let A: Player;
let B: Player;

test.afterAll(async () => {
  await A?.context.close();
  await B?.context.close();
});

/** forge: type a prompt, press FORGE / REFORGE and wait until done; returns the component counts seen while streaming */
async function forge(p: Player, prompt: string) {
  await p.page.getByTestId('forge-prompt').fill(prompt);
  await p.page.getByTestId('forge-reforge').click();
  const counts = new Set<number>();
  const t0 = Date.now();
  for (;;) {
    const s = await state(p.page);
    const f = s.forge;
    if (f?.drafts[0]) counts.add(f.drafts[0].components);
    if (f && !f.busy && f.design && Date.now() - t0 > 300) return { counts: [...counts].sort((a, b) => a - b), design: f.design };
    if (f?.error) throw new Error(`forge error: ${f.error}`);
    if (Date.now() - t0 > 40_000) throw new Error('forge timeout');
    await p.page.waitForTimeout(40);
  }
}

test('n. first login: forge flow (stream, lock, reprompt, equip, deploy)', async ({ browser }) => {
  A = await joinGame(browser, `Fred-${tag}`, { loadout: 'none' });
  let s = await state(A.page);
  expect(s.needsLoadout).toBe(true);
  expect(s.alive).toBe(false);
  await expect(A.page.getByTestId('landing')).toBeVisible();
  await expect(A.page.getByTestId('death-screen')).toBeHidden();
  await shot(A, 'n1-landing-first-login.png');

  // PLAY sends a new player to the Forge (can't deploy without a weapon)
  await A.page.getByTestId('landing-play').click();
  await expect(A.page.getByTestId('forge-editor')).toBeVisible();
  await expect(A.page.getByTestId('forge-equip')).toBeDisabled();

  // unique per run: the prompt cache (forged_prompt / forge LRU) would replay it instantly
  const first = await forge(A, `a steampunk crocodile revolver ${tag}`);
  // components streamed in one by one (several intermediate counts were rendered)
  console.log(`[e2e] streamed component counts: ${first.counts.join(',')} -> ${first.design.components.length}`);
  expect(first.counts.filter((n) => n > 0 && n < first.design.components.length).length).toBeGreaterThanOrEqual(1);
  await expect(A.page.getByTestId('forge-comp')).toHaveCount(first.design.components.length);
  await shot(A, 'n2-forge-done.png');

  // lock the second component, reject the last one
  const cards = A.page.getByTestId('forge-comp');
  const lockedId = (await cards.nth(1).getAttribute('data-id'))!;
  const lockedLabel = first.design.components.find((c) => c.id === lockedId)!.label;
  await cards.nth(1).getByTestId('comp-lock').click();
  await waitForState(A.page, (x) => !!x.forge?.design?.components.find((c) => c.id === lockedId)?.locked, 3_000, 'component locked');
  await expect(A.page.getByTestId('forge-reforge')).toContainText('locked 1');

  // reprompt: the locked component survives verbatim
  const second = await forge(A, 'make it chrome with a longer barrel');
  const kept = second.design.components.find((c) => c.id === lockedId);
  expect(kept, `locked "${lockedLabel}" survives the reprompt`).toBeTruthy();
  expect(kept!.label).toBe(lockedLabel);
  expect(kept!.locked).toBe(true);
  await shot(A, 'n3-forge-reprompt-locked.png');

  // EQUIP: register_design + respawn
  await A.page.getByTestId('forge-equip').click();
  s = await waitForState(A.page, (x) => x.alive && !x.needsLoadout && !!x.weaponDesign && x.screen === 'none', 20_000, 'A deployed with the forged weapon');
  expect(s.serverWeaponId).toBe(s.weaponId);
  expect(s.weaponName).toBe(second.design.name);
  expect(s.weaponDesign!.components.map((c) => c.id)).toContain(lockedId);
  expect(s.viewmodelMeshes).toBeGreaterThan(1);
  await expect(A.page.getByTestId('weapon-name')).toHaveText(s.weaponName);
  await A.page.waitForTimeout(400);
  await shot(A, 'n4-deployed-forged-weapon.png');
});

test('o. Esc -> redeploy -> forge -> new weapon; Esc -> weapon forge while alive', async () => {
  const s0 = await state(A.page);
  expect(s0.alive).toBe(true);
  // Esc opens the pause menu (tests have no pointer lock: the key handler opens it)
  await A.page.keyboard.press('Escape');
  await expect(A.page.getByTestId('pause-menu')).toBeVisible();
  await shot(A, 'o1-pause-menu.png');
  // full HP: redeploy needs no confirmation and doesn't count a death
  await A.page.getByTestId('pause-redeploy').click();
  await waitForState(A.page, (x) => !x.alive && x.deathVisible, 5_000, 'A redeploying');
  await expect(A.page.getByTestId('death-killer')).toContainText(/change loadout/i);
  expect((await state(A.page)).deaths).toBe(s0.deaths);
  await A.page.getByTestId('death-open-forge').click();
  await expect(A.page.getByTestId('forge-editor')).toBeVisible();
  const d1 = await forge(A, 'a medieval flail');
  await A.page.getByTestId('forge-equip').click();
  const s1 = await waitForState(A.page, (x) => x.alive && x.weaponId !== s0.weaponId && x.screen === 'none', RESPAWN_DELAY_SECONDS * 1000 + 15_000, 'A redeployed with a new weapon');
  expect(s1.weaponName).toBe(d1.design.name);

  // alive: Esc -> WEAPON FORGE -> EQUIP & REDEPLOY (register, redeploy, equip, respawn)
  await A.page.keyboard.press('Escape');
  await A.page.getByTestId('pause-forge').click();
  await expect(A.page.getByTestId('forge-editor')).toBeVisible();
  const d2 = await forge(A, 'a pirate blunderbuss');
  await expect(A.page.getByTestId('forge-equip')).toContainText(/redeploy/i);
  await A.page.getByTestId('forge-equip').click();
  const s2 = await waitForState(A.page, (x) => x.alive && x.weaponId !== s1.weaponId && x.screen === 'none', RESPAWN_DELAY_SECONDS * 1000 + 15_000, 'A has the second new weapon');
  expect(s2.weaponName).toBe(d2.design.name);
  expect(s2.serverWeaponId).toBe(s2.weaponId);
});

test('p. death screen: killer card, keep loadout, remix the killer weapon', async ({ browser }) => {
  B = await joinGame(browser, `Gus-${tag}`);
  // A gets a known hitscan design (the example revolver) so the kill is deterministic
  await hook(A, (g, d) => g.equipDesign(d, 'example revolver'), EXAMPLE_REVOLVER as unknown);
  const a = await waitForState(A.page, (x) => x.alive && x.weaponName === EXAMPLE_REVOLVER.name, RESPAWN_DELAY_SECONDS * 1000 + 15_000, 'A holds the revolver');
  await hook(A, (g) => g.setPerfectAim(true));

  const killB = async () => {
    await teleport(A, [4, 0.1, 6], 0);
    await teleport(B, [4, 0.1, -4], Math.PI);
    await waitSeenAt(A, B.id, [4, 0.1, -4]);
    const gap = Math.ceil(1000 / a.weapon.fireRate) + 150;
    for (let i = 0; i < 20; i++) {
      const b = await state(B.page);
      if (!b.alive) return;
      if (i > 0 && i % a.weapon.magSize === 0) await A.page.waitForTimeout(a.weapon.reloadTime * 1000 + 300);
      await aimAt(A, B.id);
      await fireOnce(A);
      await A.page.waitForTimeout(gap);
    }
  };
  const b0 = await state(B.page);
  await killB();
  await waitForState(B.page, (x) => !x.alive && x.deathVisible, 8_000, 'B dead');
  // killer card with A's weapon + remix
  await expect(B.page.getByTestId('death-killer')).toContainText(`Fred-${tag}`);
  await expect(B.page.getByTestId('killer-card')).toContainText(EXAMPLE_REVOLVER.name, { ignoreCase: true });
  await expect(B.page.getByTestId('remix-killer')).toBeVisible();
  // the killer's prompt, quoted
  await expect(B.page.getByTestId('death-prompt')).toHaveText('“example revolver”');
  await expect(B.page.getByTestId('killer-card').getByTestId('card-prompt')).toContainText('example revolver');
  await B.page.waitForTimeout(300);
  await shot(B, 'p1-death-screen-killer-card.png');

  // KEEP LOADOUT (countdown, then the same weapon)
  await B.page.getByTestId('keep-loadout').click();
  const b1 = await waitForState(B.page, (x) => x.alive && !x.deathVisible, RESPAWN_DELAY_SECONDS * 1000 + 8_000, 'B respawned');
  expect(b1.weaponId).toBe(b0.weaponId);

  // die again -> remix this: the Forge opens with A's design
  await killB();
  await waitForState(B.page, (x) => !x.alive && x.deathVisible, 8_000, 'B dead again');
  await B.page.getByTestId('remix-killer').click();
  await expect(B.page.getByTestId('forge-editor')).toBeVisible();
  const seeded = await waitForState(B.page, (x) => !!x.forge?.design, 5_000, 'forge seeded');
  expect(seeded.forge!.design!.name).toBe(EXAMPLE_REVOLVER.name);
  expect(seeded.forge!.design!.components.length).toBe(a.weaponDesign!.components.length);
  await shot(B, 'p2-remix-seeded.png');
  const r = await forge(B, 'make it neon green with a bayonet');
  await B.page.getByTestId('forge-equip').click();
  const b2 = await waitForState(B.page, (x) => x.alive && x.weaponName === r.design.name && x.screen === 'none', RESPAWN_DELAY_SECONDS * 1000 + 15_000, 'B respawned with the remix');
  expect(b2.weaponDesign).toBeTruthy();
});

test('q. prompt cache: first forged badge, cached reuse, death screen quotes the prompt', async () => {
  const prompt = `a baguette revolver that fires angry bees ${tag}`;
  // A: Esc -> redeploy -> open forge (empty) -> a brand-new prompt -> equip: A is its first forger
  await A.page.keyboard.press('Escape');
  await A.page.getByTestId('pause-redeploy').click();
  await waitForState(A.page, (x) => !x.alive && x.deathVisible, 5_000, 'A redeploying');
  await A.page.getByTestId('death-open-forge').click();
  await expect(A.page.getByTestId('forge-editor')).toBeVisible();
  const fa = await forge(A, prompt);
  let sa = await state(A.page);
  expect(sa.forge!.origin).toMatchObject({ fresh: true, cached: null });
  await A.page.getByTestId('forge-equip').click();
  sa = await waitForState(A.page, (x) => x.alive && x.weaponName === fa.design.name && x.screen === 'none', RESPAWN_DELAY_SECONDS * 1000 + 15_000, 'A holds the baguette');
  const aWeapon = sa.weaponId;
  await A.page.keyboard.press('Escape');
  await expect(A.page.getByTestId('pause-menu').getByTestId('card-first-forged')).toBeVisible();
  await A.page.keyboard.press('Escape');

  // B: same prompt, different case / punctuation -> cache hit: instant, same design, credit to A
  await B.page.keyboard.press('Escape');
  await B.page.getByTestId('pause-forge').click();
  await expect(B.page.getByTestId('forge-editor')).toBeVisible();
  const t0 = Date.now();
  const fb = await forge(B, `  A Baguette-Revolver, that fires ANGRY bees ${tag.toUpperCase()}!! `);
  console.log(`[e2e] cached forge took ${Date.now() - t0} ms`);
  const sb = await state(B.page);
  expect(sb.forge!.origin!.cached).toMatchObject({ designId: aWeapon, firstName: `Fred-${tag}`, uses: 1 });
  expect(fb.design.name).toBe(fa.design.name);
  await expect(B.page.getByTestId('forge-status')).toContainText(/cached/i);
  await expect(B.page.getByTestId('forge-card').getByTestId('card-forged-by')).toContainText(`Fred-${tag}`);
  await B.page.waitForTimeout(300);
  await shot(B, 'q1-forge-cached-forged-by.png');
  await B.page.getByTestId('forge-equip').click();
  const b = await waitForState(B.page, (x) => x.alive && x.weaponId === aWeapon && x.screen === 'none', RESPAWN_DELAY_SECONDS * 1000 + 15_000, 'B holds the cached baguette');
  expect(b.weaponName).toBe(fa.design.name);
  // uses: A's forge + B's reuse (B's loadout card credits A)
  await B.page.keyboard.press('Escape');
  await expect(B.page.getByTestId('pause-menu').getByTestId('card-forged-by')).toContainText(`Fred-${tag} · 2 uses`);
  await B.page.keyboard.press('Escape');

  // A kills B with the baguette -> B's death screen quotes A's prompt, A's card shows First forged
  await hook(A, (g) => g.setPerfectAim(true));
  const aw = (await state(A.page)).weapon;
  await teleport(A, [4, 0.1, 6], 0);
  await teleport(B, [4, 0.1, -4], Math.PI);
  await waitSeenAt(A, B.id, [4, 0.1, -4]);
  for (let i = 0; i < 80; i++) {
    if (!(await state(B.page)).alive) break;
    if (i > 0 && aw.magSize && i % aw.magSize === 0) await A.page.waitForTimeout(aw.reloadTime * 1000 + 300);
    await aimAt(A, B.id);
    await fireOnce(A);
    await A.page.waitForTimeout(Math.ceil(1000 / aw.fireRate) + 150);
  }
  await waitForState(B.page, (x) => !x.alive && x.deathVisible, 8_000, 'B killed by the baguette');
  await expect(B.page.getByTestId('death-killer')).toContainText(`Fred-${tag}`);
  await expect(B.page.getByTestId('death-prompt')).toHaveText(`“${prompt}”`);
  await expect(B.page.getByTestId('killer-card').getByTestId('card-first-forged')).toBeVisible();
  await B.page.waitForTimeout(400);
  await shot(B, 'q2-death-screen-prompt-first-forged.png');
});
