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

Without a key, `generate_weapon` rolls a random (still balanced) weapon and gives it the parts of
a random `@ai-gaem/parts` recipe for its class, so it still renders a real model. Parts are drawn
from `parts/catalog.json`; `server/scripts/sync-catalog.mjs` bundles a compact copy of the catalog
plus the recipes (`parts/src/recipes.ts`) into the module on every build/publish, so **republish
after the catalog changes**.

### World seeding

On init / every connect (`seedWorld`, idempotent): 14 preset weapons (one per class; presets with no
parts get their class's first recipe), the 8 TEST MAP spawn points (`TEST_MAP_SPAWN_POINTS` in
`@ai-gaem/shared`, also used by the client's test map; the old placeholder ring is migrated
automatically), and the 4 Hz tick timer. New players spawn with the preset pistol; respawning
without "keep loadout" rolls a random preset.

### Balance

`clampWeapon()` in `shared/src/balance.ts` runs on every stored weapon: per-class templates and
bounds, max 95 damage per shot (direct + DoT, so no one-shots from 100 HP), shots over 60 damage
limited to 0.8/s, sustained DPS budget 55 (melee 80 at <= 3 m, streams up to 70 at short range),
with splash / slow / knockback costing budget. Tests: `pnpm --filter @ai-gaem/shared test`.

Headshots: every weapon has a `headshotMultiplier` in [1, 3] (class bounds: default 2, sniper 2.5
(2-3), SMG/LMG 1.75, blowgun 1.5, shotgun 1 (max 1.25); forced to 1 for streams and anything with
splash). Head damage per shot = min(body * multiplier, 150) (`zoneDamage`), so body shots stay
<= 95 while a sniper headshot one-taps. The server only honours `zone = head` if the impact point is
within the target's head height (stored feet position + `crouching`, +-0.35 m vertical / 1.5 m
horizontal slack for interpolation delay, `isPlausibleHeadHit`); otherwise it's a body hit.

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

How it plays: movement is client-authoritative (`update_transform` at 15 Hz); every shot calls
`fire(seq, origin, dir)` and every local raycast hit on a remote player's hitboxes (head sphere +
body capsule, lowered while crouched) calls `report_hit(seq, target, pellets, impact, zone)` — the
server validates cooldown / ammo / range (and head plausibility) against the stored weapon and
applies damage. `update_transform` also carries `crouching` (sent immediately on change), stored on
the `player` row; `hit_event.headshot` drives the kill-feed headshot icon. HP, death, kills/deaths, slow and knockback come from the
`player` row and `hit_event`; other players' shots are drawn from `shot_event`; the kill feed comes
from `hit_event.killed`. Remote players are interpolated humanoids (100 ms delay) with name tags
and HP bars, hidden while dead. On death: **Keep loadout** waits for `respawnAt` and calls
`respawn(true)`; **Generate new weapon** calls the `generate_weapon` procedure with your prompt
(auto-equipped while dead), shows the result's name and stats, then respawns with it.

### E2E tests (Playwright)

```bash
pnpm e2e                 # starts a local SpacetimeDB if :3000 is free, publishes, runs Vite + Playwright,
                         # stops the server it started. Extra args go to Playwright: pnpm e2e --grep cooldown
pnpm e2e:maincloud       # smoke test (a) against Maincloud (publish there first if the server changed)
```

Tests live in `client/e2e/` (two browser contexts, headless Chromium with SwiftShader WebGL) and
drive the game through `window.__game` (`getState()`, `teleport`, `aimAt(id)`, `aimAtHead(id)`,
`lookAt`, `fireOnce`, `reload`, `setCrouch`, `setAds`, `setPerfectAim`, `reportHitRaw`,
`holdHitmarker`) instead of mouse look:

- **a** both players see each other; moving A is reflected on B (`@smoke`)
- **b** A kills B with the pistol: HP drops by exactly the server's per-shot damage, kill feed on
  both, kills/deaths updated, dead player hidden
- **c** death screen: Keep loadout respawns after the delay with the same weapon; Generate new weapon
  (`"a bubble gun that traps people"`) returns a new bubble gun whose stats are clampWeapon-stable,
  with a multi-mesh viewmodel built from library parts, also visible in B's hand on A's screen
- **d** firing 10 shots in 450 ms (local cooldown bypassed) only lands what the server's fire-rate
  check allows
- **e** headshots: a client-raycast head hit does `damage * headshotMultiplier`, a body hit plain
  damage, a forged head hit at the feet (`reportHitRaw`) is downgraded to body damage; the headshot
  kill shows the kill-feed headshot icon on both screens (gold hitmarker screenshot)
- **f** crouch: B's crouch replicates (server row + A renders B crouched, head hitbox lowered);
  forged standing-height head hit on a crouched B = body damage, a real crouched headshot counts;
  standing up replicates; ADS zooms the FOV and tightens spread (screenshot)

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
| Shift | sprint, forward only (6.5 m/s, +6° FOV; firing cancels it) |
| C / Ctrl | crouch (hold, or toggle in settings): 2.2 m/s, 1.2 m tall, tighter spread; crouch in the air to tuck your legs (crouch-jump) |
| Space | jump (1.1 m, 100 ms coyote time + 100 ms buffer) |
| Mouse / LMB | look / fire (hold for auto) |
| RMB | aim down sights (hold or toggle): ~0.75x FOV (sniper 0.4x scope), centred viewmodel, less spread, 62% move speed |
| Arrows / Q E | keyboard turning (trackpad / palm-rejection fallback; speed in settings) |
| R | reload |
| 1-6 | debug (offline only): swap sample weapon (rifle, shotgun, rocket, grenade arc, flamethrower stream, sword) |
| K | debug (offline only): kill yourself (death screen) |
| F2 | spawn editor: **P** save current position as spawn, **Backspace** undo, **Delete** clear |
| F3 | debug overlay (fps, position, grounded) |
| Esc | release mouse; the pause screen has a **Settings** panel (sensitivity, ADS sensitivity, FOV, key-turn speed, volume, toggle crouch / aim, invert Y, head bob; saved in `localStorage` `ai-gaem.settings`) |

Feel: spread per weapon class (`src/weapons/handling.ts`): base spread x ADS / crouch / movement /
airborne multipliers + per-shot bloom that recovers over time; recoil is a CS-style aim punch with
spring recovery (`src/player/CameraRig.ts`, which also does speed-scaled head bob, landing dip and
FOV). Procedural WebAudio sounds (`src/audio/Sfx.ts`): gunshots by class (remote ones panned and
attenuated), hit tick, headshot ding, kill chime, footsteps, jump / land, reload.

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
