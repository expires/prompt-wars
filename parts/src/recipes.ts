/**
 * Example weapon recipes. They double as presets and as LLM few-shot examples.
 * Order matters: core first, then parts attach to the most recently placed free socket
 * whose name matches the part's `attach` (e.g. place a guard before the blade).
 */
import type { Recipe } from './types';

const RAW: Recipe[] = [
  // ---------------- pistols ----------------
  {
    name: 'Service Pistol',
    class: 'pistol',
    parts: [
      { partId: 'core-pistol-block', color: '#2f3238' },
      { partId: 'barrel-round-short-1', color: '#3a3d44' },
      { partId: 'grip-polymer-raked-slim', color: '#1f2125' },
      { partId: 'mag-pistol-flush', color: '#1f2125' },
      { partId: 'sight-pistol-lowprofile' },
      { partId: 'under-flashlight-mini', color: '#2b2b2b' },
    ],
  },
  {
    name: 'Desert Hand Cannon',
    class: 'pistol',
    parts: [
      { partId: 'core-pistol-bevel', color: '#c9b27c', accent: '#2b2b2b' },
      { partId: 'barrel-hex-short-1', color: '#b5a06d', scale: 1.15 },
      { partId: 'muzzle-compensator-3port', color: '#b5a06d' },
      { partId: 'grip-rubber-wrap-2', color: '#2b2b2b' },
      { partId: 'mag-pistol-plus', color: '#2b2b2b', accent: '#c9b27c' },
      { partId: 'sight-reflex-open-mini', color: '#2b2b2b' },
    ],
  },
  {
    name: 'Cowboy Six-Shooter',
    class: 'pistol',
    parts: [
      { partId: 'core-pistol-round', color: '#7d848e', accent: '#c99a2e' },
      { partId: 'barrel-octagon-short-1', color: '#7d848e', scale: 1.2 },
      { partId: 'grip-wood-revolver-2' },
      { partId: 'sight-rib-bead' },
      { partId: 'deco-sticker-star', socket: 'side' },
    ],
  },
  // ---------------- smgs ----------------
  {
    name: 'Compact Room Sweeper',
    class: 'smg',
    parts: [
      { partId: 'core-smg-tactical', color: '#2d3036', accent: '#ff7a1a' },
      { partId: 'barrel-handguard-short-1', color: '#2d3036' },
      { partId: 'muzzle-suppressor-mid-std', color: '#1d1f23' },
      { partId: 'stock-adjustable-2', color: '#2d3036' },
      { partId: 'grip-polymer-upright-slim', color: '#1d1f23' },
      { partId: 'mag-box-extended-narrow', color: '#1d1f23' },
      { partId: 'sight-holo-1', color: '#1d1f23' },
      { partId: 'under-foregrip-angled-1', color: '#1d1f23' },
    ],
  },
  {
    name: 'Gangster Drum Typewriter',
    class: 'smg',
    parts: [
      { partId: 'core-smg-round', color: '#3b3f46' },
      { partId: 'barrel-ribbed-short-thick-1', color: '#3b3f46', accent: '#2b2d31' },
      { partId: 'muzzle-compensator-2port', color: '#3b3f46' },
      { partId: 'stock-wood-classic-4' },
      { partId: 'grip-wood-revolver-1' },
      { partId: 'mag-drum-mid-thin', color: '#2b2d31', accent: '#55595f' },
      { partId: 'under-foregrip-vertical-std', color: '#8a5a32' },
    ],
  },
  {
    name: 'Neon Bullpup Buzzer',
    class: 'smg',
    parts: [
      { partId: 'core-smg-bullpup', color: '#1b1d2a', accent: '#ff2bd6' },
      { partId: 'barrel-coil-short-1', color: '#24263a', accent: '#ff2bd6' },
      { partId: 'stock-buttpad-1', color: '#24263a' },
      { partId: 'grip-scifi-2', color: '#24263a', accent: '#ff2bd6' },
      { partId: 'mag-energy-cell-2', color: '#24263a', accent: '#ff2bd6' },
      { partId: 'sight-holo-projector-2', accent: '#ff2bd6' },
    ],
  },
  // ---------------- rifles ----------------
  {
    name: 'Standard Issue Carbine',
    class: 'rifle',
    parts: [
      { partId: 'core-rifle-block', color: '#3a3d33' },
      { partId: 'barrel-handguard-medium-2', color: '#3a3d33' },
      { partId: 'muzzle-flashhider-3prong-short', color: '#25272b' },
      { partId: 'stock-adjustable-3', color: '#3a3d33' },
      { partId: 'grip-polymer-raked-fat', color: '#25272b' },
      { partId: 'mag-curved-slight-std', color: '#25272b' },
      { partId: 'sight-reddot-tube-short-wide', color: '#25272b' },
      { partId: 'under-foregrip-vertical-std', color: '#25272b' },
      { partId: 'side-laser-1', color: '#25272b' },
    ],
  },
  {
    name: 'Kalash Classic',
    class: 'rifle',
    parts: [
      { partId: 'core-rifle-bevel', color: '#3d4046' },
      { partId: 'barrel-forend-medium-2', color: '#2c2e33' },
      { partId: 'muzzle-brake-2slot-small', color: '#2c2e33' },
      { partId: 'stock-wood-classic-1' },
      { partId: 'grip-wood-revolver-2' },
      { partId: 'mag-curved-banana-std', color: '#b0602a' },
      { partId: 'sight-iron-notch' },
      { partId: 'under-bayonet-knife-short' },
    ],
  },
  {
    name: 'Starfleet Pulse Rifle',
    class: 'rifle',
    parts: [
      { partId: 'core-rifle-scifi', color: '#e8ebf0', accent: '#19d3ff' },
      { partId: 'barrel-coil-medium-2', color: '#c8ccd4', accent: '#19d3ff' },
      { partId: 'muzzle-emitter-3prong', color: '#c8ccd4', accent: '#19d3ff' },
      { partId: 'stock-scifi-2', color: '#e8ebf0', accent: '#19d3ff' },
      { partId: 'grip-scifi-1', color: '#c8ccd4', accent: '#19d3ff' },
      { partId: 'mag-energy-cell-3', color: '#c8ccd4', accent: '#19d3ff' },
      { partId: 'sight-holo-projector-3', accent: '#19d3ff' },
      { partId: 'under-plasma-emitter', color: '#c8ccd4', accent: '#19d3ff' },
    ],
  },
  {
    name: 'Clockwork Long Rifle',
    class: 'rifle',
    parts: [
      { partId: 'core-rifle-steampunk', color: '#5a3820', accent: '#c99a2e' },
      { partId: 'barrel-steampunk-long-3', color: '#5a3820' },
      { partId: 'muzzle-trumpet-bell-small' },
      { partId: 'stock-steampunk-2' },
      { partId: 'grip-steampunk-2' },
      { partId: 'mag-stripper-clip-5' },
      { partId: 'sight-steampunk-clockwork', color: '#3a2a1a' },
      { partId: 'deco-gear-big' },
    ],
  },
  // ---------------- shotguns ----------------
  {
    name: 'Pump Breacher',
    class: 'shotgun',
    parts: [
      { partId: 'core-shotgun-block', color: '#2a2c30' },
      { partId: 'barrel-ventrib-medium-2', color: '#2a2c30' },
      { partId: 'muzzle-choke-2', color: '#2a2c30', accent: '#55595f' },
      { partId: 'mag-shelltube-std', color: '#2a2c30' },
      { partId: 'under-pump-ribbed-1', color: '#1c1d20' },
      { partId: 'stock-fixed-std', color: '#1c1d20' },
      { partId: 'grip-polymer-upright-fat', color: '#1c1d20' },
      { partId: 'mag-sidesaddle-6', socket: 'side' },
      { partId: 'sight-iron-ghostring' },
    ],
  },
  {
    name: 'Grandpa Double Barrel',
    class: 'shotgun',
    parts: [
      { partId: 'core-shotgun-round', color: '#6d737c' },
      { partId: 'barrel-sbs-long-2', color: '#4b5058' },
      { partId: 'stock-wood-classic-2' },
      { partId: 'grip-wood-revolver-3' },
      { partId: 'sight-rib-bead' },
    ],
  },
  {
    name: 'Pirate Blunderbuss',
    class: 'shotgun',
    parts: [
      { partId: 'core-shotgun-steampunk', color: '#4a2e18', accent: '#c99a2e' },
      { partId: 'barrel-bell-medium-thick-4', color: '#c99a2e' },
      { partId: 'stock-wood-classic-3' },
      { partId: 'grip-birdshead-2', color: '#6e4424' },
      { partId: 'mag-cannonball-rack' },
      { partId: 'deco-flag-banner', accent: '#111111' },
    ],
  },
  {
    name: 'Drum Sawn-Off',
    class: 'shotgun',
    parts: [
      { partId: 'core-shotgun-tactical', color: '#363a40', accent: '#d62828' },
      { partId: 'barrel-ou-short-thick-9', color: '#363a40' },
      { partId: 'muzzle-duckbill', color: '#363a40' },
      { partId: 'stock-sawnoff-2' },
      { partId: 'grip-knuckleduster-1', color: '#24262a' },
      { partId: 'mag-drum-big-thin', color: '#24262a', accent: '#d62828' },
    ],
  },
  // ---------------- snipers ----------------
  {
    name: 'Long Range Precision',
    class: 'sniper',
    parts: [
      { partId: 'core-sniper-tactical', color: '#4d4a3c' },
      { partId: 'barrel-fluted-extra-long-4', color: '#2d2f33' },
      { partId: 'muzzle-brake-3slot-large', color: '#2d2f33' },
      { partId: 'stock-precision-3', color: '#4d4a3c', accent: '#2d2f33' },
      { partId: 'grip-target-2', color: '#3a382e' },
      { partId: 'mag-box-std-wide', color: '#2d2f33' },
      { partId: 'sight-scope-tactical-3', color: '#2d2f33', accent: '#4d4a3c' },
      { partId: 'under-bipod-deployed-std', color: '#2d2f33' },
    ],
  },
  {
    name: 'WW2 Marksman',
    class: 'sniper',
    parts: [
      { partId: 'core-sniper-round', color: '#4c5057' },
      { partId: 'barrel-forend-long-3', color: '#3b3e44' },
      { partId: 'stock-wood-classic-3' },
      { partId: 'grip-wood-revolver-2' },
      { partId: 'mag-stripper-clip-5' },
      { partId: 'sight-tube-classic-2', color: '#2b2d31' },
    ],
  },
  {
    name: 'Railgun Lance',
    class: 'sniper',
    parts: [
      { partId: 'core-sniper-scifi', color: '#20232b', accent: '#7cff4f' },
      { partId: 'barrel-coil-extra-long-4', color: '#2b2f38', accent: '#7cff4f' },
      { partId: 'muzzle-emitter-4prong', color: '#2b2f38', accent: '#7cff4f' },
      { partId: 'stock-scifi-4', color: '#20232b', accent: '#7cff4f' },
      { partId: 'grip-scifi-3', color: '#2b2f38', accent: '#7cff4f' },
      { partId: 'mag-energy-cell-4', color: '#2b2f38', accent: '#7cff4f' },
      { partId: 'sight-thermal-2', color: '#2b2f38', accent: '#7cff4f' },
    ],
  },
  // ---------------- lmgs ----------------
  {
    name: 'Squad Support Saw',
    class: 'lmg',
    parts: [
      { partId: 'core-lmg-block', color: '#3a3b33' },
      { partId: 'barrel-heatsink-long-3', color: '#2a2b26' },
      { partId: 'muzzle-flashhider-5prong-long', color: '#2a2b26' },
      { partId: 'under-bipod-folded-std', color: '#2a2b26' },
      { partId: 'stock-lmg-monopod-1', color: '#3a3b33' },
      { partId: 'grip-polymer-raked-fat', color: '#2a2b26' },
      { partId: 'mag-beltbox-2', color: '#4a4c3a' },
      { partId: 'sight-carryhandle-2', color: '#2a2b26' },
    ],
  },
  {
    name: 'Rambo Belt Fed',
    class: 'lmg',
    parts: [
      { partId: 'core-lmg-round', color: '#2c2e33' },
      { partId: 'barrel-jacket-long-3', color: '#2c2e33' },
      { partId: 'grip-spade-2' },
      { partId: 'mag-belt-loop-10', socket: 'side' },
      { partId: 'mag-pan-top-2', color: '#3d4a2a' },
      { partId: 'deco-bandana-wrap', accent: '#c0392b', socket: 'deco' },
    ],
  },
  {
    name: 'Shredder Minigun',
    class: 'lmg',
    parts: [
      { partId: 'core-lmg-tactical', color: '#2b2d31', accent: '#e8a33d' },
      { partId: 'barrel-rotary-long-4', color: '#3c3f45', accent: '#2b2d31' },
      { partId: 'grip-dhandle-2', color: '#2b2d31', accent: '#e8a33d' },
      { partId: 'mag-beltbox-3', color: '#4a4c3a' },
      { partId: 'stock-buttpad-2', color: '#2b2d31' },
    ],
  },
  // ---------------- rocket launchers ----------------
  {
    name: 'Classic Bazooka',
    class: 'rocket_launcher',
    parts: [
      { partId: 'core-rocket-bazooka-90', color: '#4b5320', accent: '#c8a24a' },
      { partId: 'launcher-warhead-pointed-std', color: '#3a3f22', accent: '#c8a24a' },
      { partId: 'grip-tube-vertical-2', color: '#2b2d24' },
      { partId: 'under-foregrip-vertical-long', color: '#2b2d24' },
      { partId: 'sight-launcher-frame-1', color: '#2b2d24' },
      { partId: 'stock-shoulder-rest-2', color: '#2b2d24' },
    ],
  },
  {
    name: 'RPG Seven-ish',
    class: 'rocket_launcher',
    parts: [
      { partId: 'core-rocket-rpg-85', color: '#3a3d42' },
      { partId: 'launcher-warhead-rpg-2', color: '#4b5320', accent: '#c8a24a' },
      { partId: 'grip-polymer-upright-slim', color: '#6e4424' },
      { partId: 'sight-prism-1', color: '#2b2d31' },
    ],
  },
  {
    name: 'Duck Rocket Launcher',
    class: 'rocket_launcher',
    parts: [
      { partId: 'core-rocket-cartoon-80', color: '#ffd23f', accent: '#ff8c1a' },
      { partId: 'launcher-warhead-cartoon-bomb' },
      { partId: 'grip-toy-2', color: '#ff8c1a', accent: '#3bc9db' },
      { partId: 'launcher-tailfins-4-std', color: '#ffd23f', accent: '#ff8c1a' },
      { partId: 'deco-rubber-duck-big', socket: 'top' },
      { partId: 'deco-googly-eyes-big', socket: 'deco' },
    ],
  },
  {
    name: 'Quad Firework Pod',
    class: 'rocket_launcher',
    parts: [
      { partId: 'core-rocket-quad-80', color: '#c0392b', accent: '#ffd23f' },
      { partId: 'launcher-warhead-firework', color: '#c0392b', accent: '#ffd23f' },
      { partId: 'grip-tube-vertical-1', color: '#2b2b2b' },
      { partId: 'sight-launcher-frame-2', color: '#2b2b2b' },
      { partId: 'deco-flag-pennant', accent: '#ffd23f' },
    ],
  },
  // ---------------- grenade launchers ----------------
  {
    name: 'Revolver Grenade Launcher',
    class: 'grenade_launcher',
    parts: [
      { partId: 'core-grenade-revolver', color: '#3b3e36' },
      { partId: 'launcher-cylinder-6shot-3', color: '#2c2e29', accent: '#3b3e36' },
      { partId: 'barrel-round-short-thick-1', color: '#3b3e36', scale: 1.8 },
      { partId: 'stock-adjustable-2', color: '#2c2e29' },
      { partId: 'grip-polymer-raked-fat', color: '#2c2e29' },
      { partId: 'sight-holo-2', color: '#2c2e29' },
      { partId: 'under-foregrip-vertical-std', color: '#2c2e29' },
    ],
  },
  {
    name: 'Thumper',
    class: 'grenade_launcher',
    parts: [
      { partId: 'core-grenade-break' },
      { partId: 'barrel-bull-short-1', color: '#3a3d33', scale: 2 },
      { partId: 'stock-wood-classic-4' },
      { partId: 'grip-wood-revolver-1' },
      { partId: 'sight-launcher-frame-1', color: '#2b2d31' },
    ],
  },
  // ---------------- flamethrowers ----------------
  {
    name: 'Trench Flamer',
    class: 'flamethrower',
    parts: [
      { partId: 'core-flame-wand', color: '#4b5320' },
      { partId: 'barrel-round-medium-thick-2', color: '#3a3d33' },
      { partId: 'muzzle-flame-cone-2', color: '#3a3d33', accent: '#ff7a1a' },
      { partId: 'tank-twin-2', color: '#4b5320' },
      { partId: 'grip-tube-vertical-2', color: '#2b2b2b' },
      { partId: 'under-pilot-light-2', accent: '#ff7a1a' },
    ],
  },
  {
    name: 'Dragon Breath',
    class: 'flamethrower',
    parts: [
      { partId: 'core-flame-dragon', color: '#2f6b3a', accent: '#d9a62e' },
      { partId: 'muzzle-flame-dragonhead', color: '#2f6b3a', accent: '#d9a62e' },
      { partId: 'tank-boiler-2', color: '#5a3820' },
      { partId: 'grip-organic-1', color: '#2f6b3a', accent: '#d9a62e' },
      { partId: 'deco-spikes-mohawk', accent: '#d9a62e' },
    ],
  },
  {
    name: 'Steam Torch',
    class: 'flamethrower',
    parts: [
      { partId: 'core-flame-steampunk', color: '#4a2e18', accent: '#c99a2e' },
      { partId: 'barrel-steampunk-medium-2', color: '#4a2e18' },
      { partId: 'muzzle-flame-multijet-5', accent: '#ff7a1a' },
      { partId: 'tank-glass-chamber-2', accent: '#ff7a1a' },
      { partId: 'grip-steampunk-1' },
      { partId: 'stock-steampunk-1' },
    ],
  },
  // ---------------- bubble guns ----------------
  {
    name: 'Bubble Minigun',
    class: 'bubble_gun',
    parts: [
      { partId: 'core-bubble-minigun', color: '#ff7ac8', accent: '#7cf2ff' },
      { partId: 'barrel-rotary-medium-thin-1', color: '#7cf2ff', accent: '#ff7ac8' },
      { partId: 'muzzle-bubble-multiring-7', color: '#ff7ac8', accent: '#7cf2ff' },
      { partId: 'tank-soap-bubble-dome', accent: '#7cf2ff' },
      { partId: 'grip-toy-3', color: '#ff7ac8', accent: '#ffd23f' },
      { partId: 'mag-soap-bottle-big', color: '#7cf2ff' },
    ],
  },
  {
    name: 'Rubber Ducky Bubbler',
    class: 'bubble_gun',
    parts: [
      { partId: 'core-bubble-duck', color: '#ffd23f', accent: '#ff8c1a' },
      { partId: 'barrel-toy-short-1', color: '#3bc9db', accent: '#ff8c1a' },
      { partId: 'muzzle-bubble-heart', color: '#3bc9db', accent: '#ff4f9a' },
      { partId: 'tank-soap-duck-tank' },
      { partId: 'grip-toy-1', color: '#3bc9db', accent: '#ff8c1a' },
    ],
  },
  {
    name: 'Retro Ray Bubbler',
    class: 'bubble_gun',
    parts: [
      { partId: 'core-bubble-raygun', color: '#c0392b', accent: '#e8ebf0' },
      { partId: 'muzzle-bubble-ring-big', color: '#e8ebf0', accent: '#7cf2ff' },
      { partId: 'grip-toy-2', color: '#e8ebf0', accent: '#c0392b' },
      { partId: 'tank-fishbowl-1', accent: '#7cf2ff' },
      { partId: 'deco-antenna-ball', accent: '#ffd23f' },
    ],
  },
  // ---------------- blowguns ----------------
  {
    name: 'Jungle Blowpipe',
    class: 'blowgun',
    parts: [
      { partId: 'core-blowgun-bamboo-110', color: '#9c8a4a', accent: '#5a4a24' },
      { partId: 'muzzle-blowgun-feather', accent: '#3a6b2a' },
      { partId: 'stock-mouthpiece-flared' },
      { partId: 'mag-dart-quiver-8', color: '#6e4424' },
    ],
  },
  {
    name: 'Steampunk Blowgun',
    class: 'blowgun',
    parts: [
      { partId: 'core-blowgun-steampunk-85', color: '#5a3820', accent: '#c99a2e' },
      { partId: 'muzzle-trumpet-bell-small' },
      { partId: 'stock-mouthpiece-brass', color: '#5a3820' },
      { partId: 'sight-steampunk-swing-lenses' },
      { partId: 'mag-dart-quiver-12', color: '#5a3820' },
      { partId: 'deco-gear-small' },
    ],
  },
  // ---------------- crossbows ----------------
  {
    name: 'Hunter Crossbow',
    class: 'crossbow',
    parts: [
      { partId: 'core-crossbow-tactical', color: '#3d4a2a' },
      { partId: 'crossbow-limbs-compound-2', color: '#2b2d31', accent: '#3d4a2a' },
      { partId: 'crossbow-bolt-broadhead-1' },
      { partId: 'stock-adjustable-3', color: '#3d4a2a' },
      { partId: 'grip-polymer-raked-slim', color: '#2b2d31' },
      { partId: 'sight-scope-compact-std', color: '#2b2d31' },
      { partId: 'crossbow-stirrup-1' },
    ],
  },
  {
    name: 'Castle Arbalest',
    class: 'crossbow',
    parts: [
      { partId: 'core-crossbow-arbalest' },
      { partId: 'crossbow-limbs-leaf-2' },
      { partId: 'crossbow-bolt-flaming', accent: '#ff7a1a' },
      { partId: 'crossbow-crank-2' },
      { partId: 'crossbow-stirrup-2' },
    ],
  },
  // ---------------- melee ----------------
  {
    name: 'Knightly Longsword',
    class: 'melee',
    parts: [
      { partId: 'core-handle-bastard', color: '#3a2a1a', accent: '#6e4424' },
      { partId: 'guard-cross-std', color: '#9aa1ab' },
      { partId: 'blade-longsword-fullered-2' },
      { partId: 'pommel-scentstopper', color: '#9aa1ab' },
    ],
  },
  {
    name: 'Ronin Katana',
    class: 'melee',
    parts: [
      { partId: 'core-handle-tsuka-long', color: '#1b1b1b', accent: '#e8e2d0' },
      { partId: 'guard-tsuba-flower', color: '#2b2b2b' },
      { partId: 'blade-katana', color: '#d8dce2' },
      { partId: 'pommel-ring-1', color: '#c99a2e' },
    ],
  },
  {
    name: 'Flaming Baguette Sword',
    class: 'melee',
    parts: [
      { partId: 'core-handle-sword', color: '#f2efe8', accent: '#1f3a8a' },
      { partId: 'guard-cross-curved-forward', color: '#c0392b' },
      { partId: 'blade-baguette-2' },
      { partId: 'pommel-ball-small', color: '#1f3a8a' },
      { partId: 'deco-candle-1', socket: 'muzzle' },
    ],
  },
  {
    name: 'Viking Bearded Axe',
    class: 'melee',
    parts: [
      { partId: 'core-handle-haft-long', accent: '#5a3d1e' },
      { partId: 'head-axe-bearded-2' },
      { partId: 'pommel-cap-1', color: '#6e7680' },
    ],
  },
  {
    name: 'Thunder Hammer',
    class: 'melee',
    parts: [
      { partId: 'core-handle-mace', color: '#6e4424' },
      { partId: 'head-thunder-hammer', color: '#8e959e', accent: '#7cc8ff' },
      { partId: 'pommel-gem-1', accent: '#7cc8ff' },
    ],
  },
  {
    name: 'Frying Pan of Justice',
    class: 'melee',
    parts: [
      { partId: 'core-handle-pan', color: '#2b2b2b' },
      { partId: 'head-frying-pan-2' },
      { partId: 'deco-sticker-heart', socket: 'side' },
    ],
  },
  {
    name: 'Reaper Scythe',
    class: 'melee',
    parts: [
      { partId: 'core-handle-snath', accent: '#3a2a1a' },
      { partId: 'head-scythe-2', color: '#c9ced6' },
      { partId: 'deco-skull' },
    ],
  },
  {
    name: 'Nail Bat',
    class: 'melee',
    parts: [
      { partId: 'core-handle-bat', color: '#a8692e' },
      { partId: 'head-bat-nails' },
      { partId: 'pommel-cap-1', color: '#a8692e' },
    ],
  },
  {
    name: 'Laser Saber',
    class: 'melee',
    parts: [
      { partId: 'core-handle-hilt', accent: '#ff2a2a' },
      { partId: 'guard-emitter-2', accent: '#ff2a2a' },
      { partId: 'blade-energy-long', accent: '#ff2a2a' },
      { partId: 'pommel-cap-2', color: '#9aa1ab' },
    ],
  },
  {
    name: 'Trident of the Deep',
    class: 'melee',
    parts: [
      { partId: 'core-handle-shaft', color: '#2b5f6b', accent: '#c99a2e' },
      { partId: 'head-trident', color: '#c99a2e' },
      { partId: 'pommel-spike-1', color: '#c99a2e' },
      { partId: 'deco-fish' },
    ],
  },
  // ---------------- weird ----------------
  {
    name: 'Trumpet Blaster',
    class: 'weird',
    parts: [
      { partId: 'core-pistol-steampunk', color: '#c99a2e', accent: '#f2efe8' },
      { partId: 'barrel-round-short-1', color: '#c99a2e' },
      { partId: 'muzzle-trumpet-bell-big' },
      { partId: 'grip-steampunk-1' },
      { partId: 'deco-bow-ribbon', accent: '#c0392b' },
    ],
  },
  {
    name: 'Boxing Glove Popper',
    class: 'weird',
    parts: [
      { partId: 'core-rifle-toy', color: '#3bc9db', accent: '#ffd23f' },
      { partId: 'barrel-toy-medium-2', color: '#ff4f9a', accent: '#ffd23f' },
      { partId: 'muzzle-boxing-glove' },
      { partId: 'stock-toy-2', color: '#3bc9db', accent: '#ffd23f' },
      { partId: 'grip-joystick', color: '#2b2b2b', accent: '#ffd23f' },
      { partId: 'mag-juice-box', color: '#ff8c1a', accent: '#3a9a3a' },
      { partId: 'deco-propeller', accent: '#ff4f9a' },
    ],
  },
  {
    name: 'Alien Bio Spitter',
    class: 'weird',
    parts: [
      { partId: 'core-rifle-organic', color: '#6b3fa0', accent: '#b6ff3b' },
      { partId: 'barrel-ribbed-medium-thick-2', color: '#6b3fa0', accent: '#b6ff3b' },
      { partId: 'muzzle-flame-ring-1', color: '#6b3fa0', accent: '#b6ff3b' },
      { partId: 'grip-organic-2', color: '#6b3fa0', accent: '#b6ff3b' },
      { partId: 'sight-eyeball' },
      { partId: 'deco-tentacle' },
    ],
  },
  {
    name: 'Plunger Launcher',
    class: 'weird',
    parts: [
      { partId: 'core-grenade-toy', color: '#3bc9db', accent: '#ff4f9a' },
      { partId: 'barrel-toy-medium-2', color: '#ffd23f', accent: '#ff4f9a' },
      { partId: 'muzzle-plunger-cup' },
      { partId: 'grip-bike-handle', color: '#ff4f9a', accent: '#ffffff' },
      { partId: 'mag-coffee-can', color: '#7a4a28', accent: '#f2efe8' },
      { partId: 'deco-traffic-cone' },
    ],
  },
];

/** All hand-made recipes are curated. */
export const RECIPES: Recipe[] = RAW.map((r) => ({ ...r, curated: true }));

export function getRecipe(name: string): Recipe | undefined {
  return RECIPES.find((r) => r.name === name);
}
