import { test, expect } from '@playwright/test';
import { TAURON_REMAKE_PICKUPS } from '@ai-gaem/shared';
import type { GameTestHook } from '../src/testHook';

/** Offline / practice mode: the stage health pack works without a server (local simulation). */

type Win = Window & {
  __game: GameTestHook;
  __gameError?: string;
  game: { damageLocal(n: number): void; hp: number };
};
type St = ReturnType<GameTestHook['getState']>;

test('offline: walking over the stage pack heals and hides it', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?offline=1&e2e=1&map=tauron-remake');
  await page.waitForFunction(
    () => {
      const w = window as unknown as Win;
      if (w.__gameError) throw new Error(w.__gameError);
      const s = w.__game?.getState?.();
      return !!s && s.ready && s.pickups.length > 0;
    },
    null,
    { timeout: 120_000, polling: 200 },
  );
  const st = () => page.evaluate(() => (window as unknown as Win).__game.getState()) as Promise<St>;
  const P = TAURON_REMAKE_PICKUPS[0]!;
  // full HP: standing on it does nothing
  await page.evaluate(([x, y, z]) => (window as unknown as Win).__game.teleport(x, y, z), [P.x, P.y + 0.05, P.z]);
  await page.waitForTimeout(800);
  expect((await st()).pickups[0]!.available).toBe(true);
  // hurt: step off, take damage, step back on
  await page.evaluate(([x, y, z]) => (window as unknown as Win).__game.teleport(x, y, z), [P.x + 2.5, P.y + 0.05, P.z]);
  await page.evaluate(() => (window as unknown as Win).game.damageLocal(70));
  expect((await st()).hp).toBe(30);
  await page.evaluate(([x, y, z]) => (window as unknown as Win).__game.teleport(x, y, z), [P.x, P.y + 0.05, P.z]);
  await expect.poll(async () => (await st()).hp, { timeout: 5_000 }).toBe(80);
  const s = await st();
  expect(s.pickups[0]!.available).toBe(false);
  expect(s.pickups[0]!.visible).toBe(false);
  expect(s.pickupEvents).toBe(1);
});
