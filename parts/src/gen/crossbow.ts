/** CROSSBOW parts: limbs/prods (attach 'barrel'), bolts (attach 'top'), stirrups, cranks, bolt boxes. */
import type { PartDef, Vec3 } from '../types';
import { part, S } from '../lib/define';
import type { Kit, Slot } from '../lib/kit';

const CB = ['crossbow'];

type LimbStyle = 'recurve' | 'straight' | 'compound' | 'wood' | 'leaf' | 'toy' | 'energy';

function limbs(style: LimbStyle, span: number, idx: number, desc: string, tags: string[]): PartDef {
  const half = span / 2;
  const draw = (k: Kit) => {
    const slot: Slot = style === 'wood' ? 'wood' : style === 'leaf' ? 'metal' : 'main';
    // riser block
    k.box('dark', [0.06, 0.035, 0.05], { p: [0, 0, -0.01] });
    const tip: Vec3[] = [];
    for (const sx of [-1, 1]) {
      const pts: Vec3[] = [];
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = sx * (0.025 + t * (half - 0.025));
        let z = -0.01 + t * t * span * 0.12;
        if (style === 'recurve' && t > 0.8) z -= (t - 0.8) * span * 0.35;
        if (style === 'straight' || style === 'energy') z = -0.01 + t * span * 0.06;
        pts.push([x, 0, z]);
      }
      tip.push(pts[pts.length - 1]);
      const r = style === 'leaf' ? 0.008 : style === 'toy' ? 0.016 : 0.011;
      if (style === 'energy') {
        k.tube('glow', pts, 0.006, 10, 4);
        k.tube('main', pts.map((p) => [p[0], p[1] + 0.01, p[2]] as Vec3), 0.005, 10, 4);
      } else if (style === 'leaf') {
        for (let j = 0; j < 3; j++) k.tube(slot, pts.slice(0, n + 1 - j * 2).map((p) => [p[0], p[1] + (j - 1) * 0.006, p[2]] as Vec3), r * (1 - j * 0.2), 8, 4);
      } else k.tube(slot, pts, r, 10, 5);
      if (style === 'compound') {
        const t = pts[pts.length - 1];
        k.rod('accent', [t[0], -0.02, t[2]], [t[0], 0.02, t[2]], 0.02, 0.02, 10);
      }
      if (style === 'wood') {
        k.rod('dark', [pts[n][0], -0.01, pts[n][2]], [pts[n][0], 0.01, pts[n][2]], 0.013, 0.013, 6);
      }
    }
    // string from tips back to the nut position
    const nut: Vec3 = [0, 0.012, span * 0.2];
    for (const t of tip) k.rod('white', [t[0], 0.0, t[2]], nut, 0.002, 0.002, 3);
    if (style === 'compound') for (const t of tip) k.rod('white', [t[0], 0.0, t[2]], [-t[0] * 0.3, 0.0, span * 0.05], 0.0015, 0.0015, 3);
  };
  return part({
    id: `crossbow-limbs-${style}-${idx}`,
    category: 'crossbow',
    classes: style === 'toy' ? [...CB, 'weird'] : CB,
    tags,
    desc,
    attach: 'barrel',
    sockets: {
      top: S([0, 0.02, -0.0]),
      muzzle: S([0, 0, -0.035]),
      under: S([0, -0.018, -0.01]),
    },
    draw,
  });
}

export function crossbowParts(): PartDef[] {
  const out: PartDef[] = [];
  [0.4, 0.55, 0.7].forEach((s, i) => out.push(limbs('recurve', s, i + 1, `${['compact', 'standard', 'wide'][i]} recurve crossbow limbs with string`, ['modern', 'sport'])));
  [0.4, 0.55, 0.7].forEach((s, i) => out.push(limbs('straight', s, i + 1, `${['compact', 'standard', 'wide'][i]} straight prod with string`, ['medieval'])));
  [0.35, 0.45, 0.55].forEach((s, i) => out.push(limbs('compound', s, i + 1, `${['compact', 'standard', 'wide'][i]} compound limbs with cams`, ['modern', 'precision'])));
  [0.6, 0.8].forEach((s, i) => out.push(limbs('wood', s, i + 1, 'thick wooden medieval bow prod', ['medieval', 'wood'])));
  [0.5, 0.7].forEach((s, i) => out.push(limbs('leaf', s, i + 1, 'layered steel leaf-spring prod', ['medieval', 'heavy'])));
  out.push(limbs('toy', 0.45, 1, 'chunky rubbery toy bow limbs', ['toy', 'silly']));
  out.push(limbs('energy', 0.55, 1, 'glowing energy limb arcs', ['scifi', 'energy']));

  // bolts (attach top: sit on the rail pointing -Z)

  const mkBolt = (id: string, L: number, desc: string, tags: string[], head: (k: Kit, y: number, z: number) => void, fletch: Slot = '#e8483a', classes = [...CB, 'blowgun']) =>
    part({
      id: `crossbow-bolt-${id}`,
      category: 'crossbow',
      classes,
      tags,
      desc,
      attach: 'top',
      sockets: {},
      draw: (k) => {
        const y = 0.006;
        const zf = -L * 0.75;
        const zb = L * 0.25;
        k.zrod('wood', zf, zb, 0.004, 0.004, 5, 0, y);
        for (let j = 0; j < 3; j++) {
          const a = (j / 3) * Math.PI * 2 + Math.PI / 2;
          k.extrude(fletch, [[0, 0], [-0.05, 0], [-0.06, 0.012], [-0.015, 0.012]], 0.0015, 'zy', {
            p: [Math.cos(a) * 0.004, y + Math.sin(a) * 0.004, zb],
            r: [0, 0, a - Math.PI / 2],
          });
        }
        head(k, y, zf);
      },
    });

  for (const [i, L] of [0.25, 0.32, 0.4].entries())
    out.push(
      mkBolt(`field-${i + 1}`, L, `${['short', 'standard', 'long'][i]} field-point bolt`, ['standard'], (k, y, z) => {
        k.zrod('metal', z - 0.02, z, 0.0, 0.006, 6, 0, y);
      }),
    );
  for (const [i, L] of [0.3, 0.38].entries())
    out.push(
      mkBolt(`broadhead-${i + 1}`, L, 'bolt with three-blade broadhead', ['military', 'brutal'], (k, y, z) => {
        k.zrod('metal', z - 0.03, z, 0.0, 0.006, 6, 0, y);
        for (let j = 0; j < 3; j++) {
          const a = (j / 3) * Math.PI * 2;
          k.extrude('metal', [[0, 0], [-0.03, 0], [0, 0.015]], 0.002, 'zy', { p: [0, y, z], r: [0, 0, a] });
        }
      }),
    );
  out.push(
    mkBolt('flaming', 0.32, 'flaming bolt with burning rag head', ['medieval', 'fire'], (k, y, z) => {
      k.zrod('#c9b38a', z - 0.03, z + 0.01, 0.01, 0.01, 6, 0, y);
      k.zlathe('glow', [[0.012, z - 0.03], [0.014, z - 0.05], [0.0, z - 0.075]], 6, [0, y, 0]);
    }),
    mkBolt('plunger', 0.3, 'toy plunger-tipped bolt', ['toy', 'silly'], (k, y, z) => {
      k.zlathe('#e63946', [[0.004, z], [0.016, z - 0.01], [0.02, z - 0.02], [0.018, z - 0.021]], 8, [0, y, 0]);
    }, '#3bc9db', [...CB, 'weird']),
    mkBolt('triple', 0.3, 'triple-shot bolt spread', ['heavy', 'silly'], (k, y, z) => {
      k.zrod('metal', z - 0.02, z, 0.0, 0.006, 6, 0, y);
      for (const x of [-0.02, 0.02]) {
        k.zrod('wood', z, z + 0.3, 0.004, 0.004, 5, x, y);
        k.zrod('metal', z - 0.02, z, 0.0, 0.006, 6, x, y);
      }
    }),
  );

  // stirrups (muzzle on limbs)
  for (const [i, w] of [0.06, 0.08].entries())
    out.push(
      part({
        id: `crossbow-stirrup-${i + 1}`,
        category: 'crossbow',
        classes: CB,
        tags: ['medieval'],
        desc: 'metal foot stirrup at the front',
        attach: 'muzzle',
        sockets: {},
        draw: (k) => {
          k.torus('metal', w / 2, 0.005, { p: [0, -0.01, -w / 2 - 0.01], r: [Math.PI / 2, 0, 0] }, 4, 12, Math.PI);
          k.rod('metal', [-w / 2, -0.01, -w / 2 - 0.01], [-0.012, 0, 0], 0.005, 0.005, 5);
          k.rod('metal', [w / 2, -0.01, -w / 2 - 0.01], [0.012, 0, 0], 0.005, 0.005, 5);
        },
      }),
    );
  // cranks
  for (const [i, s] of [1, 1.3].entries())
    out.push(
      part({
        id: `crossbow-crank-${i + 1}`,
        category: 'crossbow',
        classes: CB,
        tags: ['medieval', 'heavy'],
        desc: 'side windlass crank with handles',
        attach: 'side',
        sockets: {},
        draw: (k) => {
          k.rod('metal', [0, 0, 0], [0.03 * s, 0, 0], 0.012 * s, 0.012 * s, 8);
          k.rod('metal', [0.03 * s, 0, 0], [0.035 * s, 0, 0], 0.025 * s, 0.025 * s, 10);
          k.rod('metal', [0.035 * s, 0, 0], [0.035 * s, 0.05 * s, 0.0], 0.005, 0.005, 5);
          k.rod('wood', [0.035 * s, 0.05 * s, 0], [0.065 * s, 0.05 * s, 0], 0.008, 0.008, 6);
        },
      }),
    );
  // repeating bolt boxes (top)
  for (const [i, n] of [5, 10].entries())
    out.push(
      part({
        id: `crossbow-boltbox-${n}`,
        category: 'crossbow',
        classes: CB,
        tags: ['medieval', 'wood'],
        desc: `top-loading box holding ${n} bolts`,
        attach: 'top',
        sockets: {},
        draw: (k) => {
          const h = 0.03 + n * 0.006;
          k.box('wood', [0.03, h, 0.26], { p: [0, h / 2, 0] });
          for (let j = 0; j < 3; j++) k.box('metal', [0.032, 0.006, 0.01], { p: [0, h * (0.2 + j * 0.3), -0.1 + j * 0.1] });
          k.zrod('metal', -0.15, -0.13, 0, 0.005, 5, 0, h - 0.008);
          void i;
        },
      }),
    );
  // string silencers (deco)
  out.push(
    part({
      id: 'crossbow-string-silencers',
      category: 'crossbow',
      classes: CB,
      tags: ['sport', 'stealth'],
      desc: 'fuzzy string silencer puffs',
      attach: 'deco',
      sockets: {},
      draw: (k) => {
        k.rod('white', [-0.1, 0, 0.03], [0.1, 0, 0.03], 0.002, 0.002, 3);
        for (const x of [-0.08, 0.08]) k.ball('accent', 0.012, [x, 0.0, 0.03], 0);
      },
    }),
  );
  return out;
}
