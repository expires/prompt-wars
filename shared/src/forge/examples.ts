// Hand-written Forge designs: few-shot examples for the LLM prompt, test fixtures and mock seeds.
// Not exported from the package root; import '@ai-gaem/shared/forge/examples'.

const M = (color: string, extra: Record<string, unknown> = {}) => ({ color, ...extra });
const metal = (color: string, extra: Record<string, unknown> = {}) => ({ color, metalness: 0.7, roughness: 0.35, ...extra });

/** Steampunk revolver: lathe barrel, hex drum, extruded grip, copper steam pipe. */
export const EXAMPLE_REVOLVER = {
  name: 'Brassjaw Regulator',
  class: 'pistol',
  fireMode: 'hitscan',
  palette: { primary: '#b8863b', secondary: '#4a2f1d', accent: '#c46a3a', glow: '#ffb347' },
  fx: { muzzleFlashColor: '#ffcc66', trail: 'smoke' },
  stats: { damage: 34, fireRate: 2, magSize: 6, reloadTime: 1.9, range: 40, spread: 1.2, headshotMultiplier: 2.2 },
  components: [
    {
      id: 'frame', label: 'riveted brass frame', role: 'core',
      transform: { pos: [0, 0.08, 0.01], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'box', size: [0.032, 0.085, 0.15], material: metal('primary') },
        { type: 'sphere', r: 0.006, wseg: 6, hseg: 4, pos: [0.017, 0.03, -0.06], material: metal('accent') },
        { type: 'sphere', r: 0.006, wseg: 6, hseg: 4, pos: [0.017, 0.03, 0.06], material: metal('accent') },
      ],
    },
    {
      id: 'drum', label: 'fluted six-shot drum', role: 'mag', parent: 'frame', attach: 'center',
      transform: { pos: [0, 0.005, -0.015], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'cylinder', rTop: 0.03, rBottom: 0.03, h: 0.065, seg: 6, rot: [90, 0, 0], scale: [1.5, 1, 1], material: metal('#8c6a32') },
        { type: 'torus', r: 0.03, tube: 0.004, seg: 12, pos: [0, 0, -0.03], scale: [1.5, 1, 1], material: metal('accent') },
      ],
    },
    {
      id: 'barrel', label: 'flared lathe-turned barrel', role: 'barrel', parent: 'frame', attach: 'front',
      transform: { pos: [0, 0.018, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        {
          type: 'lathe', seg: 10, rot: [-90, 0, 0], material: metal('primary'),
          points: [[0.011, 0], [0.019, 0], [0.019, 0.02], [0.013, 0.035], [0.013, 0.17], [0.021, 0.185], [0.021, 0.205], [0.009, 0.205]],
        },
        { type: 'box', size: [0.004, 0.012, 0.01], pos: [0, 0.02, -0.195], material: metal('accent') },
      ],
    },
    {
      id: 'grip', label: 'curved walnut grip', role: 'grip', parent: 'frame', attach: 'bottom',
      transform: { pos: [0, 0, 0.035], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        {
          type: 'extrude', depth: 0.038, bevel: 0.004, rot: [0, 90, 0], material: M('secondary', { roughness: 0.9 }),
          outline: [[0.025, 0], [-0.03, 0], [-0.05, -0.06], [-0.045, -0.115], [-0.02, -0.125], [0.0, -0.105], [0.012, -0.045]],
        },
      ],
    },
    {
      id: 'guard', label: 'brass trigger guard', role: 'guard', parent: 'frame', attach: 'bottom',
      transform: { pos: [0, 0, -0.025], rot: [0, 90, 180], scale: [1, 1, 1] },
      shapes: [
        { type: 'torus', r: 0.024, tube: 0.004, seg: 10, arc: 180, material: metal('primary') },
        { type: 'box', size: [0.004, 0.02, 0.006], pos: [0.005, 0.012, 0], material: metal('#3b3b3b') },
      ],
    },
    {
      id: 'hammer', label: 'spur hammer', role: 'deco', parent: 'frame', attach: 'back',
      transform: { pos: [0, 0.035, 0.005], rot: [-30, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'box', size: [0.012, 0.035, 0.012], material: metal('#3b3b3b') },
        { type: 'cylinder', rTop: 0.008, rBottom: 0.008, h: 0.014, seg: 8, pos: [0, 0.02, 0.006], rot: [0, 0, 90], material: metal('#3b3b3b') },
      ],
    },
    {
      id: 'pipe', label: 'copper steam pipe with gauge', role: 'deco', parent: 'frame', attach: 'right',
      transform: { pos: [0.008, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'tube', r: 0.005, path: [[0, -0.02, 0.06], [0.012, 0.02, 0.02], [0.01, 0.035, -0.06], [0, 0.04, -0.14]], material: metal('accent') },
        { type: 'cylinder', rTop: 0.016, rBottom: 0.016, h: 0.008, seg: 12, pos: [0.014, 0.02, 0.02], rot: [0, 0, 90], material: metal('primary') },
        { type: 'cylinder', rTop: 0.013, rBottom: 0.013, h: 0.002, seg: 12, pos: [0.019, 0.02, 0.02], rot: [0, 0, 90], material: M('#f2e6c9', { emissive: 'glow', emissiveIntensity: 0.4 }) },
      ],
    },
  ],
};

/** Melee: hand at the origin, the pan forward (-Z). */
export const EXAMPLE_FRYING_PAN = {
  name: 'Le Crepe Crusher',
  class: 'melee',
  fireMode: 'melee',
  palette: { primary: '#2b2b30', secondary: '#7a4a24', accent: '#c0c4cc', glow: '#ffd23f' },
  fx: {},
  stats: { damage: 48, fireRate: 1.1, knockback: 7, spread: 80, melee: { swing: 'overhead', weight: 'medium' } },
  components: [
    {
      id: 'handle', label: 'wooden pan handle', role: 'handle',
      transform: { pos: [0, 0, -0.03], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'cylinder', rTop: 0.014, rBottom: 0.017, h: 0.3, seg: 8, rot: [90, 0, 0], material: M('secondary', { roughness: 0.9 }) },
        { type: 'cylinder', rTop: 0.012, rBottom: 0.012, h: 0.08, seg: 8, pos: [0, 0, -0.17], rot: [90, 0, 0], material: metal('accent') },
      ],
    },
    {
      id: 'loop', label: 'hanging loop', role: 'pommel', parent: 'handle', attach: 'back',
      transform: { pos: [0, 0, 0.008], rot: [0, 90, 0], scale: [1, 1, 1] },
      shapes: [{ type: 'torus', r: 0.012, tube: 0.003, seg: 10, material: metal('accent') }],
    },
    {
      id: 'pan', label: 'cast-iron pan', role: 'head', parent: 'handle', attach: 'front',
      transform: { pos: [0, -0.02, -0.14], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        {
          type: 'lathe', seg: 16, material: metal('primary', { metalness: 0.5, roughness: 0.6 }),
          points: [[0, 0], [0.13, 0], [0.152, 0.045], [0.144, 0.047], [0.124, 0.008], [0, 0.008]],
        },
        { type: 'torus', r: 0.148, tube: 0.004, seg: 20, pos: [0, 0.046, 0], rot: [90, 0, 0], material: metal('accent') },
      ],
    },
    {
      id: 'egg', label: 'sizzling fried egg', role: 'deco', parent: 'pan', attach: 'center',
      transform: { pos: [0.02, -0.012, 0.01], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'sphere', r: 0.06, wseg: 10, hseg: 5, scale: [1.2, 0.12, 1], material: M('#fbfbf2') },
        { type: 'sphere', r: 0.022, wseg: 8, hseg: 6, pos: [0.01, 0.008, 0], scale: [1, 0.6, 1], material: M('glow', { emissive: 'glow', emissiveIntensity: 0.2 }) },
      ],
    },
  ],
};

/** Bubble gun: capsule body, translucent sphere tank, wand ring muzzle, rubber duck. */
export const EXAMPLE_BUBBLE_GUN = {
  name: 'Fizzwhistle Bubbler',
  class: 'bubble_gun',
  fireMode: 'stream',
  palette: { primary: '#ff8ac6', secondary: '#7fd8ff', accent: '#ffe066', glow: '#bdf3ff' },
  fx: { projectileShape: 'bubble', projectileColor: '#bdf3ff', trail: 'bubble' },
  stats: { damage: 3, fireRate: 10, magSize: 90, reloadTime: 2, range: 9, spread: 14, slowPercent: 35, knockback: 3 },
  components: [
    {
      id: 'body', label: 'bubblegum body', role: 'core',
      transform: { pos: [0, 0.08, -0.02], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'capsule', r: 0.045, h: 0.2, seg: 10, rot: [90, 0, 0], material: M('primary') },
        { type: 'torus', r: 0.046, tube: 0.008, seg: 12, pos: [0, 0, 0.06], material: M('secondary') },
      ],
    },
    {
      id: 'tank', label: 'soap bubble tank', role: 'tank', parent: 'body', attach: 'top',
      transform: { pos: [0, 0.05, 0.03], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'sphere', r: 0.07, wseg: 14, hseg: 10, material: M('glow', { opacity: 0.45, roughness: 0.1, emissive: 'glow', emissiveIntensity: 0.3 }) },
        { type: 'sphere', r: 0.025, wseg: 8, hseg: 6, pos: [0.02, -0.02, 0.01], material: M('#ffffff', { opacity: 0.6 }) },
        { type: 'cylinder', rTop: 0.03, rBottom: 0.04, h: 0.03, seg: 10, pos: [0, -0.07, 0], material: M('accent') },
      ],
    },
    {
      id: 'nozzle', label: 'funnel nozzle', role: 'muzzle', parent: 'body', attach: 'front',
      transform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [{ type: 'cone', r: 0.04, h: 0.08, seg: 10, pos: [0, 0, -0.03], rot: [-90, 0, 0], material: M('secondary') }],
    },
    {
      id: 'wand', label: 'bubble wand ring', role: 'muzzle', parent: 'nozzle', attach: 'front',
      transform: { pos: [0, 0, -0.02], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'torus', r: 0.055, tube: 0.008, seg: 16, material: M('accent') },
        { type: 'cylinder', rTop: 0.004, rBottom: 0.004, h: 0.05, seg: 6, pos: [0, -0.04, 0.02], rot: [30, 0, 0], material: M('accent') },
      ],
    },
    {
      id: 'grip', label: 'chunky toy grip', role: 'grip', parent: 'body', attach: 'bottom',
      transform: { pos: [0, -0.02, 0.06], rot: [15, 0, 0], scale: [1, 1, 1] },
      shapes: [{ type: 'capsule', r: 0.022, h: 0.08, seg: 8, material: M('secondary') }],
    },
    {
      id: 'duck', label: 'rubber duck mascot', role: 'deco', parent: 'body', attach: 'top',
      transform: { pos: [0, 0.01, 0.12], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'sphere', r: 0.025, wseg: 8, hseg: 6, scale: [1, 0.8, 1.3], material: M('accent') },
        { type: 'sphere', r: 0.016, wseg: 8, hseg: 6, pos: [0, 0.025, -0.018], material: M('accent') },
        { type: 'cone', r: 0.007, h: 0.014, seg: 6, pos: [0, 0.023, -0.036], rot: [-90, 0, 0], material: M('#ff8c1a') },
      ],
    },
  ],
};

/** Rocket launcher: a crocodile whose extruded jaws are the muzzle. */
export const EXAMPLE_CROC_LAUNCHER = {
  name: 'Snapjaw Croc-et',
  class: 'rocket_launcher',
  fireMode: 'projectile',
  palette: { primary: '#4f7d3a', secondary: '#2f4a24', accent: '#f4f1de', glow: '#ffd23f' },
  fx: { projectileShape: 'rocket', projectileColor: '#6cbf4a', trail: 'smoke', muzzleFlashColor: '#ffdd55' },
  stats: { damage: 85, fireRate: 0.55, magSize: 1, reloadTime: 2.4, range: 100, spread: 0.5, projectileSpeed: 32, splashRadius: 3.5, knockback: 9 },
  components: [
    {
      id: 'tube', label: 'scaly launch tube', role: 'core',
      transform: { pos: [0, 0.13, 0.05], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'cylinder', rTop: 0.075, rBottom: 0.08, h: 0.85, seg: 10, rot: [90, 0, 0], material: M('primary') },
        { type: 'torus', r: 0.08, tube: 0.01, seg: 10, pos: [0, 0, -0.25], material: M('secondary') },
        { type: 'torus', r: 0.082, tube: 0.01, seg: 10, pos: [0, 0, 0.2], material: M('secondary') },
      ],
    },
    {
      id: 'jaw-top', label: 'upper crocodile jaw', role: 'muzzle', parent: 'tube', attach: 'front',
      transform: { pos: [0, 0.01, 0.02], rot: [12, 0, 0], scale: [1, 1, 1] },
      shapes: [
        {
          type: 'extrude', depth: 0.15, bevel: 0.006, rot: [0, 90, 0], material: M('primary'),
          outline: [[0, 0], [0.05, -0.025], [0.08, 0], [0.12, -0.025], [0.15, 0], [0.19, -0.025], [0.22, 0], [0.26, -0.022], [0.3, 0.005], [0.29, 0.035], [0.24, 0.06], [0.1, 0.08], [0, 0.085]],
        },
      ],
    },
    {
      id: 'jaw-bottom', label: 'lower crocodile jaw', role: 'muzzle', parent: 'tube', attach: 'front',
      transform: { pos: [0, -0.02, 0.02], rot: [-14, 0, 0], scale: [1, 1, 1] },
      shapes: [
        {
          type: 'extrude', depth: 0.14, bevel: 0.006, rot: [0, 90, 0], material: M('secondary'),
          outline: [[0, 0], [0.05, 0.022], [0.08, 0], [0.12, 0.022], [0.15, 0], [0.19, 0.022], [0.22, 0], [0.27, 0.005], [0.26, -0.03], [0.1, -0.06], [0, -0.065]],
        },
      ],
    },
    {
      id: 'eyes', label: 'bulging yellow eyes', role: 'deco', parent: 'jaw-top', attach: 'top',
      transform: { pos: [0, 0.005, 0.05], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'sphere', r: 0.025, wseg: 8, hseg: 6, pos: [0.045, 0, 0], material: M('glow', { emissive: 'glow', emissiveIntensity: 0.3 }) },
        { type: 'sphere', r: 0.025, wseg: 8, hseg: 6, pos: [-0.045, 0, 0], material: M('glow', { emissive: 'glow', emissiveIntensity: 0.3 }) },
        { type: 'box', size: [0.006, 0.03, 0.01], pos: [0.045, 0, -0.022], material: M('#111111') },
        { type: 'box', size: [0.006, 0.03, 0.01], pos: [-0.045, 0, -0.022], material: M('#111111') },
      ],
    },
    {
      id: 'ridge', label: 'back ridge scutes', role: 'deco', parent: 'tube', attach: 'top',
      transform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [-0.3, -0.18, -0.06, 0.06, 0.18, 0.3].map(z => ({
        type: 'cone', r: 0.022, h: 0.05, seg: 4, pos: [0, 0.015, z], material: M('secondary'),
      })),
    },
    {
      id: 'grip', label: 'pistol grip', role: 'grip', parent: 'tube', attach: 'bottom',
      transform: { pos: [0, 0, 0.04], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'box', size: [0.035, 0.12, 0.05], pos: [0, -0.06, 0], rot: [-12, 0, 0], material: M('#3a2a1a') },
        { type: 'torus', r: 0.025, tube: 0.004, seg: 8, arc: 180, pos: [0, -0.005, -0.05], rot: [0, 90, 180], material: M('#222222', { metalness: 0.6 }) },
      ],
    },
    {
      id: 'tail', label: 'tapered croc tail', role: 'stock', parent: 'tube', attach: 'back',
      transform: { pos: [0, -0.01, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [{ type: 'cone', r: 0.07, h: 0.22, seg: 8, pos: [0, 0, 0.11], rot: [90, 0, 0], scale: [1, 1, 0.6], material: M('primary') }],
    },
  ],
  projectile: {
    label: 'toothy croc rocket',
    shapes: [
      { type: 'cylinder', rTop: 0.05, rBottom: 0.05, h: 0.3, seg: 8, rot: [90, 0, 0], material: M('primary') },
      { type: 'cone', r: 0.05, h: 0.12, seg: 8, pos: [0, 0, -0.21], rot: [-90, 0, 0], material: M('secondary') },
      { type: 'cone', r: 0.008, h: 0.02, seg: 4, pos: [0.03, -0.03, -0.18], rot: [180, 0, 0], material: M('accent') },
      { type: 'cone', r: 0.008, h: 0.02, seg: 4, pos: [-0.03, -0.03, -0.18], rot: [180, 0, 0], material: M('accent') },
      { type: 'box', size: [0.18, 0.006, 0.08], pos: [0, 0, 0.12], material: M('secondary') },
      { type: 'box', size: [0.006, 0.18, 0.08], pos: [0, 0, 0.12], material: M('secondary') },
      { type: 'cone', r: 0.04, h: 0.12, seg: 6, pos: [0, 0, 0.21], rot: [90, 0, 0], material: M('glow', { emissive: 'glow', emissiveIntensity: 2, opacity: 0.8 }) },
    ],
    spin: { axis: 'z', rate: 1.5 },
    trail: 'smoke',
    impact: 'burst',
  },
};

/** Grenade launcher that lobs bananas: the projectile is a curved tube banana. */
export const EXAMPLE_BANANA_LAUNCHER = {
  name: 'Peel Lobber',
  class: 'grenade_launcher',
  fireMode: 'arc',
  palette: { primary: '#ffd93b', secondary: '#6b4a2a', accent: '#fff4c2', glow: '#ffe066' },
  fx: { muzzleFlashColor: '#fff4c2', trail: 'none' },
  stats: { damage: 55, fireRate: 0.8, magSize: 4, reloadTime: 2.4, range: 45, spread: 1, projectileSpeed: 22, splashRadius: 3, gravityScale: 1, fuseTime: 1.5, knockback: 6 },
  components: [
    {
      id: 'tube', label: 'giant banana tube', role: 'core',
      transform: { pos: [0, 0.1, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'cylinder', rTop: 0.06, rBottom: 0.065, h: 0.7, seg: 10, rot: [90, 0, 0], material: M('primary') },
        { type: 'torus', r: 0.062, tube: 0.01, seg: 10, pos: [0, 0, -0.33], material: M('secondary') },
      ],
    },
    {
      id: 'grip', label: 'stubby grip', role: 'grip', parent: 'tube', attach: 'bottom',
      transform: { pos: [0, 0, 0.08], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [{ type: 'box', size: [0.035, 0.12, 0.05], pos: [0, -0.06, 0], rot: [-12, 0, 0], material: M('secondary') }],
    },
    {
      id: 'stem', label: 'banana stem stock', role: 'stock', parent: 'tube', attach: 'back',
      transform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [{ type: 'cylinder', rTop: 0.02, rBottom: 0.035, h: 0.12, seg: 6, pos: [0, 0, 0.06], rot: [90, 0, 0], material: M('secondary') }],
    },
  ],
  projectile: {
    label: 'ripe banana',
    shapes: [
      { type: 'tube', r: 0.025, seg: 6, path: [[0, -0.025, 0.12], [0, 0.015, 0.04], [0, 0.025, -0.04], [0, -0.015, -0.12]], material: M('primary') },
      { type: 'sphere', r: 0.012, wseg: 6, hseg: 4, pos: [0, -0.025, 0.125], material: M('secondary') },
      { type: 'sphere', r: 0.012, wseg: 6, hseg: 4, pos: [0, -0.015, -0.125], material: M('secondary') },
    ],
    spin: { axis: 'x', rate: 1.5 },
    impact: 'splat',
  },
};

/** Throwable: the projectile is a simplified copy of the held fish. */
export const EXAMPLE_THROWN_FISH = {
  name: 'Flounder Fling',
  class: 'throwable',
  fireMode: 'arc',
  palette: { primary: '#8fb3c9', secondary: '#4f6f85', accent: '#f2f2f2', glow: '#ffe066' },
  fx: {},
  stats: { damage: 40, fireRate: 1.2, magSize: 1, reloadTime: 1, range: 30, spread: 2, projectileSpeed: 20, gravityScale: 0.8, knockback: 8, headshotMultiplier: 1.8 },
  components: [
    {
      id: 'body', label: 'slippery fish body', role: 'core',
      transform: { pos: [0, 0.05, -0.12], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [
        { type: 'sphere', r: 0.08, wseg: 10, hseg: 6, scale: [0.5, 1, 2.2], material: M('primary', { roughness: 0.3, metalness: 0.3 }) },
        { type: 'sphere', r: 0.012, wseg: 6, hseg: 4, pos: [0.035, 0.03, -0.12], material: M('accent') },
        { type: 'sphere', r: 0.012, wseg: 6, hseg: 4, pos: [-0.035, 0.03, -0.12], material: M('accent') },
      ],
    },
    {
      id: 'tail', label: 'flappy tail fin', role: 'deco', parent: 'body', attach: 'back',
      transform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
      shapes: [{ type: 'extrude', depth: 0.01, rot: [0, 90, 0], outline: [[0, 0], [-0.08, 0.06], [-0.08, -0.06]], material: M('secondary') }],
    },
  ],
  projectile: {
    label: 'flying fish',
    shapes: [
      { type: 'sphere', r: 0.08, wseg: 10, hseg: 6, pos: [0, 0, -0.037], scale: [0.5, 1, 2.2], material: M('primary', { roughness: 0.3, metalness: 0.3 }) },
      { type: 'extrude', depth: 0.01, pos: [0, 0, 0.133], rot: [0, 90, 0], outline: [[0, 0], [-0.08, 0.06], [-0.08, -0.06]], material: M('secondary') },
      { type: 'sphere', r: 0.012, wseg: 6, hseg: 4, pos: [0.035, 0.03, -0.157], material: M('accent') },
      { type: 'sphere', r: 0.012, wseg: 6, hseg: 4, pos: [-0.035, 0.03, -0.157], material: M('accent') },
    ],
    spin: { axis: 'x', rate: 2 },
    impact: 'splat',
  },
};

export const FORGE_EXAMPLES = [EXAMPLE_REVOLVER, EXAMPLE_FRYING_PAN, EXAMPLE_BUBBLE_GUN, EXAMPLE_CROC_LAUNCHER, EXAMPLE_BANANA_LAUNCHER, EXAMPLE_THROWN_FISH];
