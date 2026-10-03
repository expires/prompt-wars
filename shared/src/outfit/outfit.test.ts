import { describe, expect, it } from 'vitest';
import {
  BODY_HP_MAX,
  BODY_HP_MIN,
  BODY_LIMITS,
  DEFAULT_DIMS,
  OUTFIT_LIMITS,
  SOCKETS,
  SOCKET_INFO,
  applyOutfitEdit,
  bodyMaxHp,
  bodyRadiusCheck,
  bodySpeedMult,
  bodyStats,
  bodyStatsLine,
  clampBody,
  combinedMoveMult,
  eyeHeight,
  headCenter,
  headRadius,
  hitboxArea,
  outfitForStorage,
  outfitTris,
  parseSocket,
  pieceBox,
  sanitizeOutfit,
  socketFrame,
} from './index';
import { EXAMPLE_FIT_WARNINGS, OUTFIT_EXAMPLES, OUTFIT_PRESETS, OUTFIT_SCOUT, OUTFIT_SOLDIER, OUTFIT_TANK } from './examples';
import { HEAD_CENTER_STANDING, HEAD_RADIUS, STAND_EYE_OFFSET, HIT_ZONE_BODY, HIT_ZONE_HEAD } from '../weapon';
import { classifyHit, isPlausibleHeadHit } from '../hitcheck';
import { MOVE_MULT_MAX, MOVE_MULT_MIN } from '../elements';

const ALL = [...OUTFIT_PRESETS, ...OUTFIT_EXAMPLES.map(([, o]) => o)];

describe('body balance', () => {
  it('default body reproduces the classic hitbox exactly', () => {
    expect(headCenter(DEFAULT_DIMS)).toBeCloseTo(HEAD_CENTER_STANDING, 6);
    expect(headRadius(DEFAULT_DIMS)).toBeCloseTo(HEAD_RADIUS, 6);
    expect(eyeHeight(DEFAULT_DIMS)).toBeCloseTo(STAND_EYE_OFFSET, 6);
    expect(bodyRadiusCheck(DEFAULT_DIMS)).toBeCloseTo(0.35, 6);
    const s = bodyStats({});
    expect(s).toMatchObject({ maxHp: 100, speedMult: 1, sizeClass: 'M', scale: 1 });
  });

  it('clamps proportions to the caps (and is idempotent)', () => {
    const b = clampBody({ size: 9, build: -3, head: 'x', limbs: 1.12345 });
    expect(b).toEqual({ size: BODY_LIMITS.size[1], build: BODY_LIMITS.build[0], head: 1, limbs: 1.123 });
    expect(clampBody(b)).toEqual(b);
    expect(clampBody(null)).toEqual({ size: 1, build: 1, head: 1, limbs: 1 });
  });

  it('small < normal < big HP, within caps; extremes hit the caps', () => {
    const small = bodyStats(OUTFIT_SCOUT.body);
    const normal = bodyStats(OUTFIT_SOLDIER.body);
    const big = bodyStats(OUTFIT_TANK.body);
    expect(small.maxHp).toBeLessThan(normal.maxHp);
    expect(big.maxHp).toBeGreaterThan(normal.maxHp);
    expect(small.maxHp).toBeGreaterThanOrEqual(BODY_HP_MIN);
    expect(big.maxHp).toBeLessThanOrEqual(BODY_HP_MAX);
    expect(bodyMaxHp({ size: 0.8, build: 0.85, head: 0.85 })).toBe(BODY_HP_MIN);
    expect(bodyMaxHp({ size: 1.08, build: 1.3, head: 1.2 })).toBe(BODY_HP_MAX);
    expect(bodyMaxHp({ size: 9, build: 9, head: 9 })).toBe(BODY_HP_MAX);
    expect(bodyMaxHp({ size: 1.05, build: 1.1, head: 1 })).toBe(115);
    expect(bodyStats(OUTFIT_SCOUT.body).maxHp % 5).toBe(0);
  });

  it('HP tracks the hitbox area: HP per unit of hitbox area varies < 1.5x across the range (flat HP: 3.2x)', () => {
    const samples = [0.8, 0.9, 1, 1.04, 1.08].flatMap(size => [0.85, 1, 1.3].map(build => ({ size, build, head: 1 })));
    const ratios = samples.map(b => bodyMaxHp(b) / 100 / hitboxArea(b));
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeLessThan(1.5);
    // monotonic in size
    for (const build of [0.85, 1, 1.3]) {
      const hps = [0.8, 0.9, 1, 1.04, 1.08].map(size => bodyMaxHp({ size, build, head: 1 }));
      for (let i = 1; i < hps.length; i++) expect(hps[i]).toBeGreaterThanOrEqual(hps[i - 1]);
    }
  });

  it('small is faster, big is slower, and it stacks with carry weight inside the global window', () => {
    expect(bodySpeedMult({ size: 0.8, build: 0.85 })).toBeGreaterThan(1);
    expect(bodySpeedMult({ size: 1.08, build: 1.3 })).toBeLessThan(1);
    expect(bodySpeedMult({ size: 0.8, build: 0.85 })).toBeLessThanOrEqual(1.07);
    expect(bodySpeedMult({ size: 1.08, build: 1.3 })).toBeGreaterThanOrEqual(0.92);
    expect(combinedMoveMult(MOVE_MULT_MAX, 1.07)).toBe(MOVE_MULT_MAX);
    expect(combinedMoveMult(MOVE_MULT_MIN, 0.92)).toBe(MOVE_MULT_MIN);
    expect(combinedMoveMult(1, 0.95)).toBe(0.95);
  });

  it('stats line is terse', () => {
    expect(bodyStatsLine({ maxHp: 120, speedMult: 0.95, sizeClass: 'L' })).toBe('HP 120 · Speed −5% · Size L');
    expect(bodyStatsLine({ maxHp: 100, speedMult: 1, sizeClass: 'M' })).toBe('HP 100 · Speed ±0% · Size M');
  });
});

describe('scaled hit validation', () => {
  const at = (x: number, y: number, z: number) => ({ prev: null, cur: { x, y, z, crouching: false }, speed: 0 });
  it('a big player’s head is where the scaled hitbox says (and a small one’s is lower)', () => {
    const big = bodyStats(OUTFIT_TANK.body);
    const small = bodyStats(OUTFIT_SCOUT.body);
    const bigHead: [number, number, number] = [0, headCenter(big), 0];
    expect(bigHead[1]).toBeGreaterThan(1.8);
    expect(classifyHit(at(0, 0, 0), bigHead, HIT_ZONE_HEAD, big)).toBe(HIT_ZONE_HEAD);
    // the default-size check would reject a shot at that height as a headshot
    expect(isPlausibleHeadHit(at(0, 0, 0), [0, headCenter(big) + 0.32, 0])).toBe(false);
    expect(isPlausibleHeadHit(at(0, 0, 0), [0, headCenter(big) + 0.32, 0], big)).toBe(true);
    // above a small player's head: not a hit at all
    expect(classifyHit(at(0, 0, 0), [0, 1.85, 0], HIT_ZONE_HEAD, small)).toBe(-1);
    expect(classifyHit(at(0, 0, 0), [0, 0.6, 0], HIT_ZONE_HEAD, small)).toBe(HIT_ZONE_BODY);
    // wide body: a shot 0.55 m off-centre hits a tank, misses a scout
    expect(classifyHit(at(0, 0, 0), [0.75, 1.0, 0], HIT_ZONE_BODY, big)).toBe(HIT_ZONE_BODY);
    expect(classifyHit(at(0, 0, 0), [0.75, 1.0, 0], HIT_ZONE_BODY, small)).toBe(-1);
  });
});

describe('outfit sanitize', () => {
  it('hand-built outfits are legal, idempotent and within budget', () => {
    for (const o of ALL) {
      const once = sanitizeOutfit(o).outfit;
      expect(once).toEqual(o);
      expect(sanitizeOutfit(once).outfit).toEqual(once);
      expect(outfitTris(o.pieces)).toBeLessThanOrEqual(OUTFIT_LIMITS.maxTris);
      expect(o.pieces.length).toBeGreaterThan(4);
    }
    // authored as intended: nothing was moved / scaled / dropped by the socket fit
    expect(EXAMPLE_FIT_WARNINGS).toEqual(Object.fromEntries(ALL.map(o => [o.name, []])));
  });

  it('garbage in -> a legal default outfit', () => {
    for (const g of [null, 42, 'x', [], { pieces: 'no' }, { body: { size: 'huge' }, pieces: [{ socket: 'nope', shapes: [{ type: 'box' }] }] }]) {
      const { outfit } = sanitizeOutfit(g);
      expect(outfit.v).toBe(1);
      expect(outfit.pieces).toEqual([]);
      expect(outfit.body.size).toBeGreaterThanOrEqual(BODY_LIMITS.size[0]);
      expect(sanitizeOutfit(outfit).outfit).toEqual(outfit);
    }
  });

  it('parses socket aliases', () => {
    expect(parseSocket('Helmet')).toBe('head');
    expect(parseSocket('left_shoulder')).toBe('shoulderL');
    expect(parseSocket('shoulder-right')).toBe('shoulderR');
    expect(parseSocket('cape')).toBe('back');
    expect(parseSocket('RIGHT FOOT')).toBe('footR');
    expect(parseSocket('handR')).toBe('handR');
    expect(parseSocket('banana')).toBeUndefined();
  });

  it('fits pieces to their socket: oversized scaled down, floating snapped on, ids unique', () => {
    const { outfit, warnings } = sanitizeOutfit({
      name: 'Test',
      body: { size: 1 },
      pieces: [
        { id: 'hat', label: 'giant hat', socket: 'head', shapes: [{ type: 'box', size: [3, 3, 3], material: { color: '#ff0000' } }] },
        { id: 'hat', label: 'floating halo', socket: 'head', transform: { pos: [0, 0.3, 0] }, shapes: [{ type: 'torus', r: 0.1, tube: 0.01, pos: [0, 1.5, 0], material: { color: '#ffff00' } }] },
        { id: 'pad', label: 'pad', socket: 'shoulderL', mirror: true, shapes: [{ type: 'sphere', r: 0.1, material: { color: 'primary' } }] },
        { id: 'mm', label: 'no mirror on head', socket: 'head', mirror: true, shapes: [{ type: 'box', size: [0.1, 0.1, 0.1], material: { color: 'accent' } }] },
      ],
    });
    expect(outfit.pieces.map(p => p.id)).toEqual(['hat', 'hat-2', 'pad', 'mm']);
    const big = pieceBox(outfit.pieces[0]);
    expect(Math.max(big.max[0] - big.min[0], big.max[1] - big.min[1])).toBeLessThanOrEqual(SOCKET_INFO.head.maxSize + 1e-6);
    const halo = pieceBox(outfit.pieces[1]);
    expect(halo.min[1]).toBeLessThanOrEqual(SOCKET_INFO.head.half[1] + 0.031);
    expect(outfit.pieces[2].mirror).toBe(true);
    expect(outfit.pieces[3].mirror).toBeUndefined();
    expect(warnings.some(w => w.includes('scaled'))).toBe(true);
    expect(warnings.some(w => w.includes('snapped'))).toBe(true);
    expect(sanitizeOutfit(outfit).outfit).toEqual(outfit);
  });

  it('enforces piece / shape / triangle caps', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, label: `p${i}`, socket: SOCKETS[i % SOCKETS.length], shapes: Array.from({ length: 20 }, () => ({ type: 'sphere', r: 0.05, wseg: 24, hseg: 16, material: { color: '#888888' } })) }));
    const { outfit } = sanitizeOutfit({ pieces: many });
    expect(outfit.pieces.length).toBeLessThanOrEqual(OUTFIT_LIMITS.maxPieces);
    for (const p of outfit.pieces) expect(p.shapes.length).toBeLessThanOrEqual(OUTFIT_LIMITS.maxShapesPerPiece);
    expect(outfitTris(outfit.pieces)).toBeLessThanOrEqual(OUTFIT_LIMITS.maxTris);
  });

  it('edits: lock / reject / body sliders; storage strips editor state', () => {
    const a = applyOutfitEdit(OUTFIT_KNIGHT_COPY(), { lock: ['helm'], reject: ['cape'], body: { size: 2 } });
    expect(a.outfit.pieces.find(p => p.id === 'helm')?.locked).toBe(true);
    expect(a.outfit.pieces.some(p => p.id === 'cape')).toBe(false);
    expect(a.removed.map(p => p.id)).toEqual(['cape']);
    expect(a.outfit.body.size).toBe(BODY_LIMITS.size[1]);
    expect(outfitForStorage(a.outfit).pieces.some(p => p.locked)).toBe(false);
  });

  it('socket frames follow the body', () => {
    const wide = { size: 1, build: 1.2, head: 1.2, limbs: 1.1 };
    expect(socketFrame('shoulderR', wide).pos[0]).toBeCloseTo(0.36, 4);
    expect(socketFrame('shoulderL', wide).pos[0]).toBeCloseTo(-0.36, 4);
    expect(socketFrame('head', wide).scale).toEqual([1.2, 1.2, 1.2]);
    expect(socketFrame('handR', wide).pos[2]).toBeCloseTo(-0.55, 4);
    for (const s of SOCKETS) expect(socketFrame(s, wide).bone).toBe(SOCKET_INFO[s].bone);
  });
});

function OUTFIT_KNIGHT_COPY() {
  return JSON.parse(JSON.stringify(OUTFIT_EXAMPLES[0][1]));
}
