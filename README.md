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
`fire(seq, origin, dir)` and every local raycast hit on a remote player's capsule calls
`report_hit(seq, target, pellets, impact)` — the server validates cooldown / ammo / range against
the stored weapon and applies damage. HP, death, kills/deaths, slow and knockback come from the
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
drive the game through `window.__game` (`getState()`, `teleport`, `aimAt(id)`, `lookAt`,
`fireOnce`, `reload`) instead of mouse look:

- **a** both players see each other; moving A is reflected on B (`@smoke`)
- **b** A kills B with the pistol: HP drops by exactly the server's per-shot damage, kill feed on
  both, kills/deaths updated, dead player hidden
- **c** death screen: Keep loadout respawns after the delay with the same weapon; Generate new weapon
  (`"a bubble gun that traps people"`) returns a new bubble gun whose stats are clampWeapon-stable,
  with a multi-mesh viewmodel built from library parts, also visible in B's hand on A's screen
- **d** firing 10 shots in 450 ms (local cooldown bypassed) only lands what the server's fire-rate
  check allows

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
| WASD | move |
| Shift | sprint |
| Space | jump |
| Mouse / LMB | look / fire (hold for auto) |
| R | reload |
| 1-6 | debug (offline only): swap sample weapon (rifle, shotgun, rocket, grenade arc, flamethrower stream, sword) |
| K | debug (offline only): kill yourself (death screen) |
| F2 | spawn editor: **P** save current position as spawn, **Backspace** undo, **C** clear |
| F3 | debug overlay (fps, position, grounded) |
| Esc | release mouse |

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
