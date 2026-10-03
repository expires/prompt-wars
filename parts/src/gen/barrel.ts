/** BARREL parts: attach to 'barrel', extend from origin toward -Z. Expose 'muzzle' + 'under'. */
import type { PartDef } from '../types';
import { part, S } from '../lib/define';
import type { Kit } from '../lib/kit';

type Profile =
  | 'round'
  | 'hex'
  | 'octagon'
  | 'fluted'
  | 'shroud'
  | 'ribbed'
  | 'heatsink'
  | 'ventrib'
  | 'sbs'
  | 'ou'
  | 'triple'
  | 'rotary'
  | 'bull'
  | 'taper'
  | 'bell'
  | 'coil'
  | 'handguard'
  | 'steampunk'
  | 'toy'
  | 'forend'
  | 'jacket'
  | 'quad';

const META: Record<Profile, { tags: string[]; desc: string }> = {
  round: { tags: ['military', 'standard'], desc: 'plain round barrel with crown' },
  hex: { tags: ['military', 'retro'], desc: 'hexagonal barrel' },
  octagon: { tags: ['retro', 'western'], desc: 'octagonal western-style barrel' },
  fluted: { tags: ['sleek', 'precision'], desc: 'fluted lightweight barrel' },
  shroud: { tags: ['military', 'retro'], desc: 'barrel in perforated cooling shroud' },
  ribbed: { tags: ['military', 'heavy'], desc: 'barrel with raised ring ribs' },
  heatsink: { tags: ['heavy', 'military'], desc: 'barrel with stacked heatsink fins' },
  ventrib: { tags: ['sport', 'sleek'], desc: 'barrel with ventilated top rib' },
  sbs: { tags: ['retro', 'western'], desc: 'double side-by-side barrels' },
  ou: { tags: ['sport', 'retro'], desc: 'double over-under barrels' },
  triple: { tags: ['silly', 'heavy'], desc: 'triple clustered barrels' },
  rotary: { tags: ['heavy', 'military'], desc: 'six-barrel rotary minigun cluster' },
  bull: { tags: ['heavy', 'precision'], desc: 'thick heavy bull barrel' },
  taper: { tags: ['sleek', 'standard'], desc: 'tapered sporter barrel' },
  bell: { tags: ['retro', 'pirate', 'silly'], desc: 'flared blunderbuss bell barrel' },
  coil: { tags: ['scifi', 'energy'], desc: 'barrel wrapped with glowing coils' },
  handguard: { tags: ['military', 'tactical', 'modern'], desc: 'barrel in railed square handguard' },
  steampunk: { tags: ['steampunk', 'ornate'], desc: 'brass banded barrel with side pipe' },
  toy: { tags: ['toy', 'chunky'], desc: 'chunky striped toy barrel' },
  forend: { tags: ['wood', 'retro'], desc: 'barrel over wooden forend' },
  jacket: { tags: ['military', 'retro', 'heavy'], desc: 'water-cooled jacket barrel' },
  quad: { tags: ['silly', 'heavy'], desc: 'four barrels in a square' },
};

function classesFor(len: number, r: number, prof: Profile): string[] {
  const c = new Set<string>();
  if (len <= 0.14) ['pistol', 'smg'].forEach((x) => c.add(x));
  if (len > 0.1 && len <= 0.3) ['smg', 'rifle', 'shotgun'].forEach((x) => c.add(x));
  if (len > 0.25 && len <= 0.5) ['rifle', 'shotgun', 'lmg'].forEach((x) => c.add(x));
  if (len > 0.4) ['sniper', 'lmg'].forEach((x) => c.add(x));
  if (r >= 0.018) ['shotgun', 'grenade_launcher'].forEach((x) => c.add(x));
  if (prof === 'heatsink' || prof === 'rotary' || prof === 'jacket') c.add('lmg');
  if (prof === 'sbs' || prof === 'ou' || prof === 'bell') c.add('shotgun');
  if (prof === 'fluted' || prof === 'bull') c.add('sniper');
  if (prof === 'coil' || prof === 'toy' || prof === 'triple' || prof === 'quad' || prof === 'bell' || prof === 'steampunk')
    c.add('weird');
  if (prof === 'toy' || prof === 'rotary') c.add('bubble_gun');
  if (prof === 'round' || prof === 'shroud' || prof === 'steampunk') c.add('flamethrower');
  if (prof === 'round' && r <= 0.012) c.add('blowgun');
  return [...c];
}

function drawBarrel(k: Kit, prof: Profile, len: number, r: number) {
  const z1 = -len;
  switch (prof) {
    case 'round':
      k.zrod('main', z1 + 0.012, 0, r, r, 8);
      k.zrod('metal', z1, z1 + 0.012, r * 1.15, r * 1.15, 8);
      k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.55, r * 0.55, 8);
      break;
    case 'hex':
      k.zrod('main', z1, 0, r * 1.1, r * 1.1, 6);
      k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.55, r * 0.55, 6);
      k.zrod('metal', -0.02, 0, r * 1.25, r * 1.25, 6);
      break;
    case 'octagon':
      k.zrod('main', z1, 0, r * 1.05, r * 1.2, 8);
      k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.55, r * 0.55, 8);
      k.box('metal', [0.006, 0.01, 0.01], { p: [0, r * 1.1, z1 + 0.02] });
      break;
    case 'fluted': {
      k.zrod('main', z1, 0, r * 0.8, r * 0.8, 6);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        k.zrod('main', z1 + 0.03, -0.03, r * 0.3, r * 0.3, 4, Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75);
      }
      k.zrod('metal', z1, z1 + 0.03, r * 1.05, r * 1.05, 8);
      k.zrod('metal', -0.03, 0, r * 1.1, r * 1.1, 8);
      k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.5, r * 0.5, 8);
      break;
    }
    case 'shroud': {
      const R = r * 1.9;
      k.zrod('dark', z1, 0, r * 0.7, r * 0.7, 6);
      k.zrod('main', z1 + 0.02, -0.01, R, R, 10, 0, 0);
      const rows = Math.min(6, Math.max(2, Math.round(len / 0.07)));
      for (let i = 0; i < rows; i++) {
        const z = z1 + 0.05 + i * ((len - 0.09) / Math.max(1, rows - 1));
        for (let j = 0; j < 4; j++) {
          const a = (j / 4) * Math.PI * 2 + Math.PI / 4;
          k.box('dark', [R * 0.45, R * 0.45, 0.018], {
            p: [Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97, z],
            r: [0, 0, a],
            s: [0.15, 1, 1],
          });
        }
      }
      k.zrod('metal', z1, z1 + 0.02, R * 0.6, R * 1.02, 10);
      break;
    }
    case 'ribbed': {
      k.zrod('main', z1, 0, r, r, 8);
      const n = Math.max(3, Math.round(len / 0.04));
      for (let i = 0; i < n; i++) {
        const z = z1 + 0.02 + i * ((len - 0.04) / (n - 1));
        k.rod('accent', [0, 0, z - 0.006], [0, 0, z + 0.006], r * 1.45, r * 1.45, 8, true);
      }
      break;
    }
    case 'heatsink': {
      k.zrod('dark', z1, 0, r * 0.8, r * 0.8, 6);
      const n = Math.min(14, Math.max(5, Math.round(len / 0.022)));
      for (let i = 0; i < n; i++) {
        const z = -0.02 - i * ((len - 0.05) / (n - 1));
        k.zrod('main', z - 0.003, z + 0.003, r * 2.1, r * 2.1, 7);
      }
      k.zrod('metal', z1, z1 + 0.025, r * 1.2, r * 1.2, 8);
      break;
    }
    case 'ventrib': {
      k.zrod('main', z1, 0, r, r * 1.05, 8);
      k.box('dark', [r * 0.7, 0.004, len], { p: [0, r * 1.9, z1 / 2] });
      const n = Math.max(3, Math.round(len / 0.05));
      for (let i = 0; i < n; i++) {
        const z = z1 + 0.02 + i * ((len - 0.04) / (n - 1));
        k.box('dark', [r * 0.5, r * 0.8, 0.008], { p: [0, r * 1.4, z] });
      }
      k.ball('brass', r * 0.35, [0, r * 2.1, z1 + 0.01], 0);
      break;
    }
    case 'sbs':
      for (const x of [-r, r]) {
        k.zrod('main', z1, 0, r, r, 8, x, 0);
        k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.7, r * 0.7, 8, x, 0);
      }
      k.box('main', [r * 0.8, r * 0.6, len], { p: [0, r * 0.75, z1 / 2] });
      k.box('main', [r * 0.8, r * 0.6, len * 0.95], { p: [0, -r * 0.75, z1 / 2] });
      break;
    case 'ou':
      for (const y of [r, -r]) {
        k.zrod('main', z1, 0, r, r, 8, 0, y);
        k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.7, r * 0.7, 8, 0, y);
      }
      k.box('dark', [r * 0.4, r * 0.8, len * 0.98], { p: [r * 0.9, 0, z1 / 2] });
      k.box('dark', [r * 0.4, r * 0.8, len * 0.98], { p: [-r * 0.9, 0, z1 / 2] });
      k.box('dark', [r * 0.6, 0.004, len], { p: [0, r * 2.05, z1 / 2] });
      break;
    case 'triple':
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
        const x = Math.cos(a) * r * 1.2;
        const y = Math.sin(a) * r * 1.2;
        k.zrod('main', z1, 0, r, r, 8, x, y);
        k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.65, r * 0.65, 8, x, y);
      }
      k.zrod('accent', z1 + 0.01, z1 + 0.03, r * 2.4, r * 2.4, 6);
      k.zrod('accent', -0.03, -0.01, r * 2.4, r * 2.4, 6);
      break;
    case 'quad':
      for (const [x, y] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        k.zrod('main', z1, 0, r, r, 8, x * r * 1.05, y * r * 1.05);
        k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.65, r * 0.65, 8, x * r * 1.05, y * r * 1.05);
      }
      k.box('accent', [r * 4.6, r * 4.6, 0.02], { p: [0, 0, z1 + 0.03] });
      break;
    case 'rotary': {
      const R = r * 2.2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * R;
        const y = Math.sin(a) * R;
        k.zrod('main', z1, 0, r, r, 6, x, y);
        k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.6, r * 0.6, 6, x, y);
      }
      k.zrod('dark', z1 + 0.02, 0, r * 1.4, r * 1.4, 6);
      for (const f of [0.08, 0.5, 0.92]) {
        const z = -len * f;
        k.zrod('accent', z - 0.012, z + 0.012, R + r * 1.3, R + r * 1.3, 10);
      }
      break;
    }
    case 'bull':
      k.zrod('main', z1, 0, r * 1.1, r * 1.5, 10);
      k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.5, r * 0.5, 8);
      k.zrod('metal', -0.015, 0, r * 1.6, r * 1.6, 10);
      break;
    case 'taper':
      k.zrod('main', z1, 0, r * 0.65, r * 1.15, 8);
      k.zrod('dark', z1 - 0.001, z1 + 0.002, r * 0.4, r * 0.4, 8);
      k.box('metal', [0.005, r * 0.9, 0.012], { p: [0, r * 0.95, z1 + 0.02] });
      break;
    case 'bell':
      k.zlathe(
        'main',
        [
          [r * 0.9, 0],
          [r * 0.8, z1 * 0.5],
          [r * 1.0, z1 * 0.8],
          [r * 1.7, z1 * 0.95],
          [r * 2.4, z1],
          [r * 1.9, z1 + 0.004],
          [r * 0.8, z1 * 0.9],
        ],
        10,
      );
      k.zrod('brass', z1 * 0.3 - 0.008, z1 * 0.3 + 0.008, r * 1.05, r * 1.05, 10);
      k.zrod('brass', z1 * 0.65 - 0.008, z1 * 0.65 + 0.008, r * 1.0, r * 1.0, 10);
      break;
    case 'coil': {
      k.zrod('main', z1, 0, r * 0.9, r * 0.9, 8);
      const n = Math.min(9, Math.max(3, Math.round(len / 0.05)));
      for (let i = 0; i < n; i++) {
        const z = z1 + 0.025 + i * ((len - 0.05) / (n - 1));
        k.torus('glow', r * 1.6, r * 0.32, { p: [0, 0, z] }, 3, 8);
      }
      k.zrod('dark', z1 + 0.01, -0.01, r * 0.35, r * 0.35, 4, r * 1.6, 0);
      k.zrod('dark', z1 + 0.01, -0.01, r * 0.35, r * 0.35, 4, -r * 1.6, 0);
      break;
    }
    case 'handguard': {
      const s = r * 3.2;
      k.zrod('dark', z1, 0, r * 0.8, r * 0.8, 6);
      const hl = len * 0.78;
      k.extrude(
        'main',
        [
          [0, -s / 2 + s * 0.15],
          [-hl, -s / 2 + s * 0.15],
          [-hl, s / 2 - s * 0.15],
          [0, s / 2 - s * 0.15],
        ],
        s,
        'zy',
        undefined,
        s * 0.12,
      );
      const slots = Math.max(2, Math.round(hl / 0.05));
      for (let i = 0; i < slots; i++) {
        const z = -0.03 - i * ((hl - 0.06) / Math.max(1, slots - 1));
        k.box('dark', [0.004, s * 0.25, 0.022], { p: [s / 2 + s * 0.1, 0, z] });
        k.box('dark', [0.004, s * 0.25, 0.022], { p: [-s / 2 - s * 0.1, 0, z] });
      }
      k.box('dark', [s * 0.5, 0.006, hl], { p: [0, s / 2 + s * 0.12, -hl / 2] });
      k.zrod('metal', z1, z1 + 0.015, r * 1.1, r * 1.1, 8);
      break;
    }
    case 'steampunk':
      k.zrod('brass', z1, 0, r, r * 1.1, 10);
      for (const f of [0.1, 0.4, 0.7, 0.95]) {
        const z = -len * f;
        k.zrod('main', z - 0.008, z + 0.008, r * 1.4, r * 1.4, 10);
      }
      k.zrod('metal', z1 + 0.04, -0.04, r * 0.35, r * 0.35, 6, 0, r * 1.7);
      k.rod('metal', [0, r * 0.9, z1 + 0.04], [0, r * 1.7, z1 + 0.04], r * 0.3, r * 0.3, 5);
      k.rod('metal', [0, r * 0.9, -0.04], [0, r * 1.7, -0.04], r * 0.3, r * 0.3, 5);
      break;
    case 'toy': {
      k.zrod('main', z1, 0, r * 1.5, r * 1.5, 8);
      const n = Math.max(2, Math.round(len / 0.06));
      for (let i = 0; i < n; i++) {
        const z = z1 + 0.03 + i * ((len - 0.06) / Math.max(1, n - 1));
        k.zrod('white', z - 0.01, z + 0.01, r * 1.55, r * 1.55, 8);
      }
      k.zrod('accent', z1 - 0.01, z1 + 0.02, r * 2, r * 2, 8);
      k.zrod('dark', z1 - 0.012, z1 - 0.008, r * 1.2, r * 1.2, 8);
      break;
    }
    case 'forend':
      k.zrod('main', z1, 0, r, r, 8);
      k.extrude(
        'wood',
        [
          [0, -r * 2.5],
          [-len * 0.75, -r * 1.8],
          [-len * 0.75, r * 0.3],
          [0, r * 0.3],
        ],
        r * 2.6,
        'zy',
        undefined,
        0.003,
      );
      k.zrod('metal', -len * 0.72, -len * 0.68, r * 1.4, r * 1.4, 8, 0, -r * 0.4);
      k.box('metal', [0.005, r * 1.1, 0.01], { p: [0, r * 1.2, z1 + 0.015] });
      break;
    case 'jacket': {
      const R = r * 2.6;
      k.zrod('main', z1 + 0.04, -0.01, R, R, 10);
      k.zlathe('main', [[R, z1 + 0.04], [r * 1.2, z1 + 0.01]], 10);
      k.zrod('dark', z1 - 0.01, z1 + 0.02, r * 0.9, r * 0.9, 8);
      const n = Math.max(2, Math.round(len / 0.08));
      for (let i = 0; i < n; i++) {
        const z = z1 + 0.06 + i * ((len - 0.09) / Math.max(1, n - 1));
        k.zrod('dark', z - 0.004, z + 0.004, R * 1.03, R * 1.03, 10);
      }
      k.rod('metal', [0, -R, -len * 0.3], [0, -R - 0.015, -len * 0.3], 0.006, 0.006, 6);
      break;
    }
  }
}

function underY(prof: Profile, r: number): number {
  switch (prof) {
    case 'shroud':
      return -r * 1.9;
    case 'heatsink':
      return -r * 2.1;
    case 'rotary':
      return -r * 3.5;
    case 'handguard':
      return -r * 1.95;
    case 'forend':
      return -r * 2.4;
    case 'jacket':
      return -r * 2.6;
    case 'triple':
    case 'quad':
      return -r * 2.1;
    case 'ou':
      return -r * 2;
    case 'toy':
      return -r * 1.5;
    default:
      return -r;
  }
}

function barrel(prof: Profile, len: number, r: number, idx: number): PartDef {
  const sizeWord = len <= 0.14 ? 'short' : len <= 0.3 ? 'medium' : len <= 0.5 ? 'long' : 'extra-long';
  const thick = r >= 0.016 ? 'thick' : r <= 0.009 ? 'thin' : '';
  const id = `barrel-${prof}-${sizeWord}${thick ? '-' + thick : ''}-${idx}`;
  const mz = prof === 'rotary' ? 0 : 0;
  return part({
    id,
    category: 'barrel',
    classes: classesFor(len, r, prof),
    tags: [...META[prof].tags, sizeWord.replace('extra-', 'x')],
    desc: `${sizeWord}${thick ? ' ' + thick : ''} ${META[prof].desc}`,
    attach: 'barrel',
    sockets: {
      muzzle: S([0, mz, -len]),
      under: S([0, underY(prof, r), -len * (prof === 'handguard' ? 0.45 : 0.55)]),
    },
    draw: (k) => drawBarrel(k, prof, len, r),
  });
}

export function barrelParts(): PartDef[] {
  const out: PartDef[] = [];
  const LENS = [0.1, 0.22, 0.36, 0.55];
  const full: Profile[] = ['round', 'fluted', 'shroud', 'heatsink', 'ribbed', 'handguard'];
  for (const p of full) {
    LENS.forEach((len, i) => {
      out.push(barrel(p, len, 0.011, i + 1));
      out.push(barrel(p, len * 1.1, p === 'heatsink' ? 0.016 : 0.017, i + 1));
    });
  }
  const four: Profile[] = ['hex', 'octagon', 'ventrib', 'bull', 'taper', 'coil', 'steampunk', 'toy', 'forend', 'jacket'];
  for (const p of four) LENS.forEach((len, i) => out.push(barrel(p, len, p === 'bull' ? 0.013 : 0.012, i + 1)));
  // shotgun-ish multi barrels
  for (const p of ['sbs', 'ou'] as Profile[]) {
    [0.18, 0.32, 0.46].forEach((len, i) => out.push(barrel(p, len, 0.014, i + 1)));
    out.push(barrel(p, 0.12, 0.016, 9));
  }
  [0.2, 0.35, 0.5].forEach((len, i) => out.push(barrel('triple', len, 0.012, i + 1)));
  [0.2, 0.38].forEach((len, i) => out.push(barrel('quad', len, 0.011, i + 1)));
  [0.3, 0.5, 0.7].forEach((len, i) => out.push(barrel('rotary', len, 0.008, i + 1)));
  out.push(barrel('rotary', 0.45, 0.012, 4));
  [0.14, 0.26, 0.38].forEach((len, i) => out.push(barrel('bell', len, 0.014, i + 1)));
  out.push(barrel('bell', 0.3, 0.02, 4));
  // pencil-thin barrels (blowgun extensions, pistols)
  [0.3, 0.6].forEach((len, i) => out.push(barrel('round', len, 0.008, 10 + i)));
  out.push(barrel('round', 0.8, 0.007, 12));
  out.push(barrel('taper', 0.8, 0.012, 9));
  out.push(barrel('fluted', 0.75, 0.012, 9));
  out.push(barrel('bull', 0.75, 0.015, 9));
  return out;
}
