# ai-gaem

## Server

SpacetimeDB **2.10** module written in TypeScript (`server/`), with the balance logic in
`shared/` (`@ai-gaem/shared`, bundled into the module by `spacetime build`).

- Maincloud database: **`prompt-wars-63xhe`** (dashboard: https://spacetimedb.com/prompt-wars-63xhe)
- Client connection: URI `wss://maincloud.spacetimedb.com`, database `prompt-wars-63xhe`
  (constants exported from `@ai-gaem/shared`: `SPACETIME_MAINCLOUD_URI`, `SPACETIME_DB_NAME`)
- `server/spacetime.json` sets the default server (maincloud) and database name.

### One-time setup

```bash
curl -sSf https://install.spacetimedb.com | sh -s -- -y   # installs ~/.local/bin/spacetime
export PATH="$HOME/.local/bin:$PATH"
spacetime login                                          # browser login, needed for maincloud
pnpm install
```

### Local dev

```bash
spacetime start                                          # terminal 1: local server on :3000
cd server
pnpm publish:local                                       # sync part catalog, build, publish to local
pnpm generate                                            # regenerate client/src/module_bindings
spacetime logs --server local prompt-wars-63xhe -f
spacetime sql  --server local prompt-wars-63xhe "SELECT * FROM player"
```

Point the client at local with `?server=local` (or `VITE_SPACETIMEDB_HOST=ws://localhost:3000`).

### Publish to Maincloud

```bash
cd server
pnpm publish:maincloud                                   # = sync-catalog + spacetime publish --server maincloud prompt-wars-63xhe
pnpm generate                                            # after any schema/reducer change
```

Schema changes are automatic migrations (added tables / columns with defaults, no data wipe); the
CLI warns that connected clients will be disconnected, and old client builds are incompatible with
changed reducers, so redeploy the client at the same time.

If the database ever pre-dates the module (init never ran), call `claim_admin` once from your
logged-in identity: `spacetime call --server maincloud prompt-wars-63xhe claim_admin`.

### LLM weapon generation

`generate_weapon` is a SpacetimeDB *procedure* that calls the Anthropic Messages API from inside
the module (`ctx.http.fetch`). The key lives in a private `config` table, set by the admin
(the identity that published / claimed admin):

```bash
spacetime call --server maincloud prompt-wars-63xhe set_api_key '"sk-ant-..."'
spacetime call --server maincloud prompt-wars-63xhe set_llm_model '"claude-haiku-4-5-20251001"'   # default
```

Templates: the 20k-template library (`@ai-gaem/parts` `searchTemplates`) is too big for the module,
so the client searches it with the player's prompt and passes the best <= 5 matches as compact JSON
(`generate_weapon(prompt, weaponClass, templatesJson)`, shape in `shared/src/templates.ts`). The
server re-validates their part ids against the synced catalog, picks the class from the best
template (unless one was requested), and uses them as few-shot examples in the LLM prompt. Melee
results keep the template's `melee` meta (swing / reach / weight) so animations match.

Without a key, `generate_weapon` turns the best template into the weapon (class preset stats
scaled by its `statHints`, its parts and melee meta, then `clampWeapon`); with no templates it
rolls a random (still balanced) weapon with a random class recipe. Parts are drawn
from `parts/catalog.json`; `server/scripts/sync-catalog.mjs` bundles a compact copy of the catalog
plus the recipes (`parts/src/recipes.ts`) into the module on every build/publish, so **republish
after the catalog changes**.

### World seeding

On init / every connect (`seedWorld`, idempotent): 14 preset weapons (one per class; presets with no
parts get their class's first recipe) and the 8 TEST MAP spawn points (`TEST_MAP_SPAWN_POINTS` in
`@ai-gaem/shared`, also used by the client's test map; the old placeholder ring is migrated
automatically). It also deletes any leftover `tick_timer` rows (the old always-on 4 Hz tick).
New players spawn with the preset pistol; respawning without "keep loadout" rolls a random preset.

### Tables and cost

SpacetimeDB bills per reducer call and per byte written / broadcast, so the hot paths are kept small:

| Table | Visibility | What |
| --- | --- | --- |
| `player` | public | rarely-changing state: name, online, hp, alive, kills, deaths, weaponId, respawnAt, slow, `slot`; `x/y/z/yaw` = spawn / resume point. Some columns are legacy (ammo, reload, dot, crouching...): an automatic migration can't drop columns, they are just no longer written |
| `player_pose` | public | hot: one ~45-byte row per online player keyed by a u32 `slot` (assigned on connect): position, yaw/pitch, velocity, flags (crouch / grounded / teleport / melee block), sender clock `sendT` |
| `player_combat` | private | ammo, reload, fire-rate token bucket, previous pose + timestamps (lag compensation), DoT, `lastSwingAt` (melee charge bound). One row per online player |
| `weapon` | public | presets + generated weapons; clients subscribe to presets and fetch other rows on demand by id |
| `shot` | private | recent projectile shots (for `report_hit`); expired rows are cleaned up inside `fire` |
| `dot_timer` | private, scheduled | one row per victim while a damage-over-time effect is active (250 ms ticks, deleted on expiry) |
| `shot_event`, `hit_event` | public events | remote shot visuals (+ melee `charge` / `combo` for the third-person swing), damage / kills (+ `blocked`) |
| `tick_timer` | private | legacy, always empty (kept so the auto-migration doesn't have to drop a table) |

There is no always-on scheduled reducer: an idle server does nothing. Slows expire client-side
from `slowUntil`. Clients subscribe to `player`, `player_pose`, `spawn_point`, the event tables and
preset weapons only (not `subscribeToAllTables`), with `withConfirmedReads(false)`.

### Melee

Melee weapons carry `melee: { swing: 'slash'|'overhead'|'thrust'|'bash'|'spin', reach, weight }`
(`shared/src/melee.ts`; `clampWeapon` always sets it for melee, inferring it from the name / parts /
stats when missing; reach is the template's hand -> tip length, 0.3-3 m). Hit reach (eye ->
impact) = reach + 0.75 m arm, clamped to 1.2-3 m, so tiny objects still connect.

- Timing by weight: light 0.35 s, medium 0.55 s, heavy 0.9 s per swing (charged x1.35, slash
  finisher x1.15); the swing rate is min(fireRate, 1 / swing time) (token bucket, `effectiveFireRate`).
  Phases (`MELEE_PHASES`): anticipation -> strike window (hits swept only here) -> follow-through ->
  recovery.
- Slash: 3-hit combo (right->left, left->right, wide finisher) when the next swing starts within
  0.45 s of the previous one ending.
- Heavy attack (right mouse / LT, hold up to 1 s): damage x(1 + 0.75 charge), +25% reach, slower;
  charged hits are capped at 75 body / 100 head (never below the plain hit). The server grants
  at most (time since the last swing + 0.15 s) / 1 s of charge (`grantedCharge`, `lastSwingAt`).
- Block (F / RB; right mouse with shields): 40% damage from melee hits inside the front 120 deg
  cone, 55% move speed, no knockback; replicated as `POSE_FLAG_BLOCK`; only counts while holding a
  melee weapon.
- Hits: during the strike window the client sweeps the swing arc every frame with 0.1 m sphere
  casts spaced <= 3 deg apart (`sampleMeleeArc`), each target once per swing, head zone counts.
  All hits of a swing go out in one `fire(seq, origin, dir, hits, charge, combo)` (sent when the
  strike window closes). The server checks origin near the attacker's eye (1 m + speed x 0.15 s),
  eye -> impact <= charged reach + 0.4 m, impact on the swept hitbox (round 2), applies
  `meleeHitDamage` (block x0.4) and knockback x(1 + charge) (heavy x1.2, max 15 m/s).
- Feel: procedural keyframed viewmodel (`client/src/weapons/meleeAnim.ts`), 70 ms hit-stop,
  camera punch / shake by weight, blade vs blunt impact sounds, stylized star + spark impacts,
  forward lunge on heavy / charged hits. Remote players play the matching third-person swing
  (arm / torso keys, skipping the wind-up), a gun recoil pose, block pose and crouch.

### Balance

`clampWeapon()` in `shared/src/balance.ts` runs on every stored weapon: per-class templates and
bounds, max 95 damage per shot (direct + DoT, so no one-shots from 100 HP), shots over 60 damage
limited to 0.8/s, sustained DPS budget 55 (melee 80 at <= 3 m, streams up to 70 at short range),
with splash / slow / knockback costing budget. Tests: `pnpm --filter @ai-gaem/shared test`.

Headshots: every weapon has a `headshotMultiplier` in [1, 3] (class bounds: default 2, sniper 2.5
(2-3), SMG/LMG 1.75, blowgun 1.5, shotgun 1 (max 1.25); forced to 1 for streams and anything with
splash). Head damage per shot = min(body * multiplier, 150) (`zoneDamage`), so body shots stay
<= 95 while a sniper headshot one-taps.

Range falloff (`rangeFalloff`, hitscan + streams): full damage to 60% of the weapon's range, then
linear down to 75% at max range. Fire rate is a token bucket (`spendFireCredit`): credits refill at
the weapon's rate, a shot costs 1, the bucket holds `max(1.5, 1 + 0.25 s * rate)` so network
bunching is tolerated while the long-run rate stays exact (1.5, not 2, so heavy weapons can't
double-tap).

Hit validation (`shared/src/hitcheck.ts`, favor-the-shooter with a cap): the server keeps each
victim's previous pose and its timestamp; a direct hit is accepted if the impact point is on the
victim's hitbox anywhere along previous -> current pose within the last 250 ms, with tolerance
0.3 m + victim speed x 0.25 s. A claimed head hit must be within the head sphere (crouch-aware,
+-0.3 m vertical, 0.5 m horizontal + the speed term), otherwise it counts as a body hit; an impact
that isn't on the body at all is rejected.

## Client

Vite + TypeScript + Three.js + Rapier (`@dimforge/rapier3d-compat`) in `client/`.
Multiplayer via SpacetimeDB (`SpacetimeNetClient`, default) or single-player (`OfflineNetClient`,
`?offline=1`), both behind the `NetClient` interface in `src/net/`. Weapons use the shared
`Weapon` schema from `@ai-gaem/shared`; models are assembled from the `@ai-gaem/parts` library.

### Multiplayer

```bash
pnpm dev                                   # http://localhost:5173 -> Maincloud prompt-wars-63xhe
# local server instead:
spacetime start                            # terminal 1
pnpm --filter @ai-gaem/server publish:local
open "http://localhost:5173/?server=local"
```

| URL param | Effect |
| --- | --- |
| *(none)* | Maincloud `wss://maincloud.spacetimedb.com`, db `prompt-wars-63xhe` |
| `?server=local` | `ws://localhost:3000` (local `spacetime start`), same db name |
| `?server=wss://host` | any SpacetimeDB host |
| `?db=name` | database override |
| `?offline=1` | no server (`OfflineNetClient`, optional `?bots=3`, `?map=`) |
| `?name=Alice` | display name (`set_name`) |
| `?fresh=1` | ignore the stored token -> new identity |

The auth token lives in `sessionStorage`, so **each browser tab is a separate player** (a reload
keeps your identity). Multiplayer always uses the procedural TEST MAP; you spawn at the server's
spawn point.

How it plays: movement is client-authoritative. `update_transform(x, y, z, yaw, pitch, vx, vy, vz,
flags, sendT)` goes out from the fixed physics step: 20 Hz while moving, 10 Hz while only looking
around, nothing while idle (no heartbeat), immediately on discrete changes (start / stop, jump /
land, crouch, teleport); 2 Hz (+ the final stop) while nobody else is online (`PoseSender`).
Hitscan, stream and melee shots are one call each: `fire(seq, origin, dir, hits[])` where `hits`
lists each remote player the local raycast hit (head sphere + body capsule, lowered while
crouched): `{slot, zone, ix, iy, iz, pellets}`. Projectile / arc weapons call `fire` and later
`report_hit(seq, slot, pellets, impact, zone)` when the projectile lands. The server validates fire
rate / ammo / range / hit position against the stored weapon and the victim's recent poses and
applies damage. HP, death, kills/deaths, slow and knockback come from the `player` row and
`hit_event` (aggregated floating damage numbers, kill-confirm X + chime); other players' shots are
drawn from `shot_event`; the kill feed comes from `hit_event.killed`. Remote players are
interpolated humanoids with name tags and HP bars, hidden while dead.

Interpolation (`client/src/net/interp.ts`) runs on the *sender's* clock: each pose row is one
snapshot (only rows that changed), the clock offset is min(arrival - sendT) over ~2 s, the delay
target is 2 x send interval + p95 jitter (80-200 ms) and playback converges at 0.95-1.05x speed
instead of jumping; positions use Hermite curves from the sent velocity, extrapolate along it for
<= 150 ms when the buffer runs dry, and snap on teleports / respawns / jumps > 3 m. F3 shows RTT,
interpolation delay / target, jitter, send rate, buffered snapshots and per-reducer call counts.
On death: **Keep loadout** waits for `respawnAt` and calls `respawn(true)`; **Generate new weapon**
calls the `generate_weapon` procedure with your prompt (auto-equipped while dead), shows the
result's name and stats, then respawns with it.

### E2E tests (Playwright)

```bash
pnpm e2e                 # starts a local SpacetimeDB if :3000 is free, publishes, runs Vite + Playwright,
                         # stops the server it started. Extra args go to Playwright: pnpm e2e --grep cooldown
pnpm e2e:maincloud       # smoke test (a) against Maincloud (publish there first if the server changed)
```

Tests live in `client/e2e/` (two browser contexts, headless Chromium with SwiftShader WebGL) and
drive the game through `window.__game` (`getState()`, `teleport`, `aimAt(id)`, `aimAtHead(id)`,
`lookAt`, `fireOnce`, `reload`, `setCrouch`, `setAds`, `setPerfectAim`, `reportHitRaw`,
`holdHitmarker`, `setAutoMove`, `traceRemote`, `equipPreset`, `netStats`) instead of mouse look:

- **a** both players see each other; moving A is reflected on B (`@smoke`)
- **b** A kills B with the pistol: HP drops by exactly the server's per-shot damage, kill feed on
  both, kills/deaths updated, dead player hidden
- **c** death screen: Keep loadout respawns after the delay with the same weapon; Generate new weapon
  (`"a bubble gun that traps people"`) returns a new bubble gun whose stats are clampWeapon-stable,
  with a multi-mesh viewmodel built from library parts, also visible in B's hand on A's screen
- **d** firing 10 shots in 450 ms (local cooldown bypassed) only lands what the server's fire-rate
  token bucket allows
- **e** headshots: a client-raycast head hit does `damage * headshotMultiplier`, a body hit plain
  damage (and a floating damage number), a forged head hit at the feet (`reportHitRaw`) is
  downgraded to body damage; the headshot kill shows the kill-confirm X and the kill-feed headshot
  icon on both screens (gold hitmarker screenshot)
- **f** crouch: B's crouch replicates (pose row + A renders B crouched, head hitbox lowered);
  a forged standing-height head hit on a crouched B is rejected, a forged one at the knees is body
  damage, a real crouched headshot counts; standing up replicates; ADS zooms the FOV and tightens
  spread (screenshot)
- **g** netcode: idle clients send nothing; A walks a circle at 4.5 m/s and B's rendered position is
  sampled every frame for 3 s: no holds, no rushes, per-frame speed within +-30% of the mean
  (measured ~+-4%); 20 `update_transform`/s while moving; reducer call rates are logged; F3
  overlay screenshot
- **h** blowgun (projectile -> `report_hit`) direct hit + damage over time from the per-victim
  `dot_timer` (exact total, timer row gone afterwards, no `tick_timer`)

`client/e2e/melee.spec.ts` (two more players):

- **i** melee preset: a swing at 1.5 m does exactly the server damage and replicates (B sees A's
  slash); beyond reach the sweep finds nothing and a forged hit is rejected; A saw B's gun recoil
- **j** charged swing (after > 1 s) does more damage, within the 75 body cap
- **k** block: 40% from the front, full damage from behind; block flag replicates (screenshots)
- **l** "Generate new weapon" from templates: "grandma's umbrella sword" -> umbrella sword (thrust,
  umbrella parts, melee meta) that hits; sledgehammer (overhead), frying pan (bash), nunchucks (spin);
  first-person + third-person screenshots of every swing type mid-strike (`l-*.png`)
- **m** fake gamepad moves / looks, T autorun, trackpad mode preset + hint toast

Screenshots of every step go to `client/e2e/screenshots/` (`maincloud-*` for the smoke run). The
Playwright config uses Playwright's Chromium if installed (`npx playwright install chromium`),
else the newest cached Chrome for Testing in `~/Library/Caches/ms-playwright`, or `PW_CHROMIUM_PATH`.

### Dev commands

```bash
pnpm install
pnpm dev                          # = pnpm --filter client dev  -> http://localhost:5173
pnpm --filter client build        # tsc --noEmit + vite build
pnpm --filter client typecheck
```

URL params:

- `?map=/maps/venue.glb` load a GLB map (put files in `client/public/maps/`). Colliders come from
  `venue_collision.glb` next to it if present, otherwise from the visual mesh (trimesh). Falls back
  to the procedural test map if the file is missing.
- `?bots=3` simulated remote players (offline) to exercise `RemotePlayers` interpolation.

### Controls

| Key | Action |
| --- | --- |
| Click | lock mouse / play |
| WASD | move (Source-style accel + friction: walk 4.5 m/s) |
| T | autorun (W or S cancels; A / D still strafe) |
| Shift | sprint, forward only (6.5 m/s, +6° FOV; firing cancels it; hold or toggle in settings) |
| C / Ctrl | crouch (hold, or toggle in settings): 2.2 m/s, 1.2 m tall, tighter spread; crouch in the air to tuck your legs (crouch-jump) |
| Space | jump (1.1 m, 100 ms coyote time + 100 ms buffer) |
| Mouse / LMB | look / fire (hold for auto) |
| RMB | aim down sights (hold or toggle): ~0.75x FOV (sniper 0.4x scope), centred viewmodel, less spread, 62% move speed. Melee: hold to charge a heavy attack (shields: block) |
| LMB (melee) | swing (slash weapons: 3-hit combo) |
| F | melee block |
| Gamepad | left stick move, right stick look (deadzone + curve + sensitivity in settings, aim slowdown over enemies), RT fire, LT aim / heavy, A jump, B crouch, X reload, L3 sprint, RB block, Start = play / menu (no pointer lock needed) |
| Arrows / Q E | keyboard turning (trackpad / palm-rejection fallback; speed in settings) |
| R | reload |
| 1-0 | debug (offline only): swap sample weapon (rifle, shotgun, rocket, grenade arc, flamethrower stream, sword; 7-0: template katana, sledgehammer, spear, frying pan) |
| K | debug (offline only): kill yourself (death screen) |
| F2 | spawn editor: **P** save current position as spawn, **Backspace** undo, **Delete** clear |
| F3 | debug overlay (fps, position, grounded; net: RTT, interp delay, jitter, send Hz, buffered snapshots, reducer calls) |
| Esc | release mouse; the pause screen has a **Settings** panel (sensitivity, ADS sensitivity, FOV, key-turn speed, volume, toggle crouch / sprint / aim, invert Y, head bob, gamepad look speed / deadzone / aim slowdown, **Trackpad mode**; saved in `localStorage` `ai-gaem.settings`) |

Feel: spread per weapon class (`src/weapons/handling.ts`): base spread x ADS / crouch / movement /
airborne multipliers + per-shot bloom that recovers over time; recoil is a CS-style aim punch with
spring recovery (`src/player/CameraRig.ts`, which also does speed-scaled head bob, landing dip and
FOV). Procedural WebAudio sounds (`src/audio/Sfx.ts`): gunshots by class (remote ones panned and
attenuated), hit tick, headshot ding, kill chime, footsteps, jump / land, reload.

Trackpad / ThinkPad support (the OS disables the touchpad while keys are held): T autorun,
**Trackpad mode** preset (toggle crouch / sprint / aim, +25% sensitivity, autorun hint, arrow / Q E
turning; turning it off restores the previous values). If movement keys are held > 400 ms with no
mouse movement and the mouse moves right after release, three times, a one-time toast offers it.

Spawn points saved with the editor go to `localStorage` (`ai-gaem.spawns.<mapId>`) and are logged
as JSON in the console so they can be pasted into code / the server.

### Layout

- `src/engine/` renderer (main scene + viewmodel overlay pass), Rapier init (60 Hz fixed step), input, `Game` loop
- `src/map/` `loadMap()` (GLB + trimesh colliders), procedural `testMap`, spawn storage
- `src/player/` kinematic character controller, humanoid placeholder, target dummies
- `src/weapons/` `Weapon` type (shared schema + id), part registry + built-in kit (`PART_IDS`), `buildWeaponModel()`, fire modes, effects
- `src/ui/` DOM HUD, death screen, spawn editor, scoreboard
- `src/net/` `NetClient` interface, `SpacetimeNetClient`, `OfflineNetClient`, `RemotePlayers`
- `src/module_bindings/` generated SpacetimeDB bindings (`pnpm --filter @ai-gaem/server generate`)
- `src/testHook.ts` `window.__game` for e2e tests
- `e2e/` Playwright specs, `run.mjs` orchestrator, screenshots

`buildWeaponModel()`: parts from the `@ai-gaem/parts` library (registered in the part registry)
are assembled with its `assembleWeapon()`; parts from the built-in kit use the legacy socket
builder; weapons with no known parts (presets, old rows) use a library recipe for their class.
Melee weapons (blade toward -Z, handle toward +Z) are tilted blade-up in the viewmodel.
