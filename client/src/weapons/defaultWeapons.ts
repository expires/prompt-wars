import { clampWeapon, templateToRawWeapon } from '@ai-gaem/shared';
import { toTemplateSummary } from './templates';
import { loadTemplates } from './templatesLibrary';
import type { Weapon } from './types';

/** Hand-made sample weapons covering every fire mode (debug keys 1-6 cycle). */
const RAW_DEFAULT_WEAPONS: (Partial<Weapon> & { id: string })[] = [
  {
    id: 'local-rifle',
    name: 'Duck Hunter AR',
    class: 'rifle',
    fireMode: 'hitscan',
    damage: 22,
    pellets: 1,
    fireRate: 9,
    magSize: 30,
    reloadTime: 1.8,
    range: 120,
    spread: 0.8,
    projectileSpeed: 0,
    splashRadius: 0,
    parts: [
      { partId: 'receiver_rifle' },
      { partId: 'barrel_long' },
      { partId: 'stock_rifle' },
      { partId: 'grip_pistol' },
      { partId: 'mag_banana' },
      { partId: 'scope_small' },
      { partId: 'rubber_duck' },
    ],
    colors: { primary: '#3b4250', secondary: '#1d1f24', accent: '#e8b040' },
  },
  {
    id: 'local-shotgun',
    name: 'Grandpa\'s Boomstick',
    class: 'shotgun',
    fireMode: 'hitscan',
    damage: 11,
    pellets: 9,
    fireRate: 1.4,
    magSize: 2,
    reloadTime: 2.2,
    range: 40,
    spread: 6,
    projectileSpeed: 0,
    splashRadius: 0,
    parts: [
      { partId: 'receiver_rifle', scale: [1, 0.9, 0.8] },
      { partId: 'barrel_double' },
      { partId: 'stock_rifle' },
      { partId: 'grip_pistol' },
      { partId: 'bayonet' },
    ],
    colors: { primary: '#6b4226', secondary: '#2a2a2c', accent: '#c0a050' },
  },
  {
    id: 'local-rocket',
    name: 'Party Popper RPG',
    class: 'rocket_launcher',
    fireMode: 'projectile',
    damage: 90,
    pellets: 1,
    fireRate: 0.8,
    magSize: 1,
    reloadTime: 2.5,
    range: 200,
    spread: 0.3,
    projectileSpeed: 35,
    splashRadius: 4,
    parts: [{ partId: 'receiver_bulky' }, { partId: 'rocket_tube' }, { partId: 'grip_pistol' }, { partId: 'scope_small' }],
    colors: { primary: '#4a5a3a', secondary: '#4a5a3a', accent: '#ff5aa0' },
  },
  {
    id: 'local-grenade',
    name: 'Lob-o-Matic',
    class: 'grenade_launcher',
    fireMode: 'arc',
    damage: 70,
    pellets: 1,
    fireRate: 1.2,
    magSize: 4,
    reloadTime: 2.4,
    range: 80,
    spread: 0.5,
    projectileSpeed: 22,
    splashRadius: 3.5,
    parts: [
      { partId: 'receiver_bulky', scale: 0.8 },
      { partId: 'barrel_thick' },
      { partId: 'grip_pistol' },
      { partId: 'mag_drum' },
      { partId: 'stock_skeleton' },
    ],
    colors: { primary: '#6a6f2a', secondary: '#2a2a2a', accent: '#d0d0d0' },
  },
  {
    id: 'local-flamer',
    name: 'Birthday Candle Flamer',
    class: 'flamethrower',
    fireMode: 'stream',
    damage: 4,
    pellets: 1,
    fireRate: 20,
    magSize: 100,
    reloadTime: 2.5,
    range: 8,
    spread: 10,
    projectileSpeed: 0,
    splashRadius: 0,
    parts: [
      { partId: 'receiver_bulky', scale: 0.8 },
      { partId: 'barrel_short', scale: [1.6, 1.6, 1.4] },
      { partId: 'fuel_tank' },
      { partId: 'grip_pistol' },
      { partId: 'candle' },
    ],
    colors: { primary: '#8a2a1a', secondary: '#303030', accent: '#ffb020' },
  },
  {
    id: 'local-sword',
    name: 'Zweihander of Mild Peril',
    class: 'melee',
    fireMode: 'melee',
    damage: 55,
    pellets: 1,
    fireRate: 1.6,
    magSize: 0,
    reloadTime: 0,
    range: 2.4,
    spread: 0,
    projectileSpeed: 0,
    splashRadius: 0,
    parts: [{ partId: 'handle_melee' }, { partId: 'blade_sword' }],
    colors: { primary: '#5a3a22', secondary: '#d8dde2', accent: '#c0a050' },
  },
];

/** Offline melee samples: the best @ai-gaem/parts template for each query (one per swing type). */
const MELEE_SAMPLE_QUERIES: [string, string][] = [
  ['local-katana', 'katana'],
  ['local-sledgehammer', 'sledgehammer'],
  ['local-spear', 'spear'],
  ['local-frying-pan', 'frying pan'],
];

let cached: Weapon[] | null = null;
let meleeLoading: Promise<Weapon[]> | null = null;

/**
 * Offline sample weapons (debug keys 1-0), run through the shared balance clamp like everything
 * the server stores. The melee samples come from the template library (a lazy chunk): they're
 * appended to this list once loadMeleeSamples() has resolved.
 */
export function getDefaultWeapons(): Weapon[] {
  cached ??= RAW_DEFAULT_WEAPONS.map((w) => ({ ...clampWeapon(w), id: w.id }));
  return cached;
}

/** Load the template library and build the offline melee samples (resolves to just those). */
export function loadMeleeSamples(): Promise<Weapon[]> {
  meleeLoading ??= loadTemplates().then(({ searchTemplates }) => {
    const melee: Weapon[] = [];
    for (const [id, q] of MELEE_SAMPLE_QUERIES) {
      try {
        const t = searchTemplates(q, { melee: true, limit: 1 })[0];
        if (t) melee.push({ ...clampWeapon(templateToRawWeapon(toTemplateSummary(t))), id });
      } catch (err) {
        console.warn('[weapons] template lookup failed', q, err);
      }
    }
    return melee;
  });
  return meleeLoading;
}

/**
 * STUB for the LLM weapon generator. Returns a randomized variant of a
 * default weapon. Replace with a call to the server/LLM endpoint.
 */
export async function generateWeaponStub(prompt: string): Promise<Weapon> {
  const all = getDefaultWeapons();
  const base = all[Math.floor(Math.random() * all.length)];
  const hue = Math.floor(Math.random() * 360);
  return {
    ...structuredClone(base),
    id: `local-${Date.now().toString(36)}`,
    // hsl() colours are fine for the renderer; the server would replace them with hex
    name: prompt.trim() ? prompt.trim().slice(0, 32) : `${base.name} Mk.${Math.ceil(Math.random() * 9)}`,
    colors: { primary: `hsl(${hue},45%,40%)`, secondary: `hsl(${(hue + 180) % 360},20%,20%)`, accent: `hsl(${(hue + 60) % 360},80%,60%)` },
  };
}
