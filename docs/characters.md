# Characters: Closet outfits + body balance

## Research (short)

| Option | Fit for us |
|---|---|
| Skinned GLTF base (Mixamo / [Quaternius Universal Base Characters](https://quaternius.itch.io/universal-base-characters), CC0, ~13k tris, shared 65-joint rig) + swappable skinned outfit meshes ([modular outfits](https://quaternius.itch.io/modular-character-outfits-fantasy)) | Best looking, but outfits are authored meshes: an LLM can't generate skinned geometry, sharing a skeleton across skinned meshes is fiddly in three.js ([1](https://discourse.threejs.org/t/three-js-share-skeleton-between-skinnedmeshes-using-same-bones-structure/18536), [2](https://discourse.threejs.org/t/replacing-skinnedmesh-on-fly/45567)), and 13k tris x 30 players is heavy. |
| Rigid parts parented to bones ([bone attachment](https://discourse.threejs.org/t/add-mesh-to-glb-bones/59438)): bones are `Object3D`s, `bone.add(mesh)` | Generative-friendly (parts = primitives in a bone/socket frame), no skinning, animates for free. **Chosen.** |
| Morph targets for proportions | Needs an authored base mesh; per-segment scale on a rigid rig gives the same knobs (height / bulk / head / limbs). |
| LLM avatar generation | Schema-constrained JSON (sockets + primitives), sanitized server-side: exactly the Forge DSL pattern we already run. |

Fair hitboxes with cosmetic variety: competitive shooters keep hitboxes independent of cosmetics; Valorant gives every agent the same hitbox and avoids skins that change silhouettes ([cogconnected](https://cogconnected.com/2020/09/riot-games-valorant-agent-skins/), [dexerto](https://www.dexerto.com/valorant/valorant-devs-exploring-new-cosmetics-like-gloves-but-not-agent-skins-1478667/)). Where body size *does* differ (Overwatch tanks), bigger hitboxes are paid for with more HP ([dotesports health-to-hitbox chart](https://dotesports.com/overwatch/news/chart-of-overwatch-heroes-health-to-hitbox-ratio-shows-how-easy-they-are-to-eliminate)). We do both: armour is cosmetic only, body size drives hitbox and HP.

## Design

- **Outfit DSL** (`shared/src/outfit/`): `body {size, build, head, limbs}` + up to 24 `pieces`, each on a socket (`head, face, torso, back, belt, shoulderL/R, armL/R, handL/R, thighL/R, shinL/R, footL/R`), built from the Forge primitives / macros / PBR materials, `mirror: true` for L/R pairs. `sanitizeOutfit` clamps everything, fits each piece to its socket (scale down / pull in / snap onto the body segment), caps 12 shapes per piece and 5000 tris per outfit. Idempotent, runs in the server module.
- **Rendering**: pieces are baked per humanoid bone (one merged mesh per quantized material, colour in vertex colours), cached per outfit and shared by every player wearing it (`client/src/player/outfitModelCache.ts`, ref-counted like weapon models). The editor builds unmerged pieces for picking.
- **Closet** (`client/src/forge/ClosetEditor.ts`): same layout, streaming, keep / lock / reject, retailor and turntable as the Forge; quick picks Scout / Soldier / Tank / Default; sliders for the body. Service: `POST /api/forge/outfit` (shared rate limiter + prompt cache with weapons; offline mock).
- **Server**: `outfit` table (sanitized JSON + server-derived `scale, build, head, maxHp, speedMult`), `player.outfitId`, `player.maxHp`; reducers `register_outfit`, `equip_outfit` (only while dead). Max HP caps spawn HP and health packs; hit validation (head / body / splash, melee eye) uses the victim's body dims.

## Balance

| | min | default | max | why |
|---|---|---|---|---|
| size (height) | 0.8 (1.44 m) | 1 | 1.08 (1.94 m) | above ~1.08 the standing capsule + 0.4 m autostep no longer clears the C-stair ceiling (2.9 m over a tread; `tauronRemake.test.ts`); below 0.8 the head (12.8 cm) is too small to hit |
| build (bulk) | 0.85 | 1 | 1.3 | hitbox width only; collision radius stays 0.35 m |
| head | 0.85 | 1 | 1.2 | head sphere radius = 0.16 x size x head |
| limbs | 0.85 | 1 | 1.15 | cosmetic |

- Hitbox area `A = size² x (0.85 build + 0.15 head²)`; **max HP = 100 x A^0.75**, rounded to 5, clamped 70..140. Scout 70, Soldier 100, Tank 135, extreme big 140. Strictly proportional HP makes giants unkillable for sloppy aim and tiny players one-tap fodder for good aim; ^0.75 keeps HP-per-hitbox-area within 1.5x across the range (flat 100 HP: 3.2x).
- **Speed** = `1 - 0.3 (size-1) - 0.15 (build-1)`, clamped 0.92..1.07, multiplied with the weapon's carry weight inside the global 0.72..1.22 window.
- Eye height = size x (1.51 + 0.11 head), capsule 1.8 / 1.2 m x size, crouch drop 0.6 x size. Default body reproduces the old constants exactly.
- Armour is cosmetic. Pieces are capped in size per socket so they can't hide the body.
