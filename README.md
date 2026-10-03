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
keeps your identity). Multiplayer plays the active map — `ACTIVE_MAP_ID` in `shared/src/maps.ts`,
which defaults to the procedural TEST MAP — and you spawn at one of the server's `spawn_point` rows
for that map (see [Venue map](#venue-map)).

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

- `?map=/maps/venue.glb` load a GLB map (put files in `client/public/maps/`, or on the bucket/CDN
  set by `VITE_MAP_BASE_URL`). Colliders come from `venue_collision.glb` next to it if present,
  otherwise from the visual mesh (trimesh). Falls back to the procedural test map if the file is
  missing.
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

## Venue map

The multiplayer map is a GLB derived from a scan of the real venue. This is the whole path from a
raw capture to spawning players inside the arena.

### Get a scan

- **Phone scan** with Polycam, Scaniverse or Luma, exported as **GLB** or **OBJ**. Capture the
  whole space in one pass; when it is an OBJ, keep the exported textures next to the `.obj`.
- **MatterPak** — if the venue has a Matterport tour, the tour owner can export an official
  **MatterPak OBJ** from that space. Prefer it when it exists: it is already aligned and scaled.
- **Scrape a public Matterport tour** — when you only have the tour link and need the map for a
  hackathon, `client/scripts/map/scrape-matterport.mjs` pulls the 50k mesh and its textures straight
  from the tour page and writes an OBJ:

  ```bash
  node client/scripts/map/scrape-matterport.mjs eECbFJAzMzz --name tauron-arena
  # -> scans/tauron-arena/tauron-arena.obj + textures/
  ```

  It reads the signed asset manifest the `show/` page embeds (valid ~24 h) and decodes the tiled
  `.dam` mesh (f32 positions/UVs + LEB128 indices). **This downloads someone else's model — only do
  it for a model you are allowed to use, and do not redistribute the result without permission.**

Put the raw files in `scans/` (repo root). That directory is only a staging area for captures — the
game never loads anything from it directly.

### Process the scan

`client/scripts/map/process-scan.ts` turns a raw capture into the runtime GLB plus a
`_collision.glb` sibling that `loadMap()` uses for the Rapier trimesh colliders (the visual mesh is
far too heavy to collide against). Run it straight with Node — it is erasable TypeScript, which
Node 26 strips natively.

```bash
# the usual case: a Z-up OBJ (phone scan or Matterport .dam export)
node client/scripts/map/process-scan.ts scans/tauron-arena/tauron-arena.obj --name tauron-arena --up z

# scanned venues: keep the collision 1:1 with what you can see (defaults decimate to 80k tris and
# drop islands < 50 tris, which turns walls into swiss cheese)
node client/scripts/map/process-scan.ts scans/tauron-arena/tauron-arena.obj \
  --name tauron-arena --up z --collision-tris 400000 --min-island-tris 1
# -> client/public/maps/tauron-arena.glb + tauron-arena_collision.glb + tauron-arena.meta.json
```

| Flag | Meaning |
| --- | --- |
| `<in.obj\|.glb>` | raw scan to read (positional); OBJ needs its `.mtl` + textures alongside |
| `--name <id>` | map id; writes `<id>.glb`, `<id>_collision.glb`, `<id>.meta.json` |
| `--up <y\|z>` | `z` rotates Z-up sources into Y-up (default `y`) |
| `--out <dir>` | output directory (default `client/public/maps`) |
| `--visual-tris` / `--collision-tris` | triangle budgets (default 400000 / 80000) |
| `--min-island-tris <n>` | drop collision islands smaller than n tris (default 50; use 1 to keep everything) |
| `--no-meshopt` | skip EXT_meshopt_compression on the visual GLB |

A Y-up source goes through the same command without `--up z`. If the processed map comes out lying
on its side or floating, re-run with the other up axis before digging any deeper. The pipeline logs
the resulting bbox, triangle counts and file sizes (`tauron-arena`: 265k visual tris / 8.2 MB,
265k collision tris / 4.9 MB with the 1:1 flags, 193 textures).

### Seal holes (solid collision)

Photogrammetry scans have holes, and a 1:1 collision faithfully keeps them — you can walk through
walls and fall through the floor. `client/scripts/map/solidify.ts` rebuilds the collision as a
**watertight voxel shell**: it rasterizes the surface, morphologically closes it (bridging gaps up
to ~2·close·pitch metres) and emits only the exposed cell faces, then simplifies.

```bash
# keep the raw collision so this is re-runnable
cp client/public/maps/tauron-arena_collision.glb scans/tauron-arena_collision_raw.glb
node client/scripts/map/solidify.ts \
  scans/tauron-arena_collision_raw.glb \
  client/public/maps/tauron-arena_collision.glb \
  --pitch 0.6 --close 1 --tris 300000
```

The visual map is untouched, so texture holes stay cosmetic. Re-run `bake-spawns.ts` afterwards (the
walkable surface moved slightly) and rebuild the client. Verified for `tauron-arena`: 0/255 drop
points fell out and all spawns have ground beneath them.

The collision shell is also drawn as a **neutral backdrop** (`loadMap()`): the same geometry is
added to the scene with an unlit `BackSide` material and `polygonOffset`, so where the photo scan
has a hole you see a solid grey wall behind it instead of a void, while the texture still wins
wherever the scan exists. It costs one extra draw of the collision mesh (~300k tris for the arena)
and can be turned off with `?shell=0`.

If you still see through a wall in-game, bump `--close` (2 closes bigger gaps) — at the cost of
sealing very narrow doorways; drop `--pitch` for a finer shell.

### Check it offline

```bash
pnpm dev
open "http://localhost:5173/?offline=1&map=/maps/tauron-arena.glb"
```

`?offline=1` selects `OfflineNetClient`, so no server is needed, and `?map=` loads the GLB. Walk the
space (F3 shows fps, position, grounded) and test the collision mesh by moving around: doorways,
stairs and edges are where a scan's collider usually hurts. Without `VITE_MAP_BASE_URL` the path is
resolved against the client origin, i.e. `client/public/maps/`; a missing file falls back to the
procedural test map. Serving the map from the CDN instead is covered under
[Deploying](#deploying).

Scanned maps always get an **invisible safety box** (`client/src/map/bounds.ts`): four walls, a
ceiling and a **floor slab at `bounds.min[1]`**, pushed as colliders so gaps in the scan can't drop
a player out of the world. The box comes from `MAPS[id].bounds` (else the scan's `meta.bbox`),
expanded by 0.5 m; for `tauron-arena` its floor sits at y = 0. Raise `bounds.min[1]` in
`shared/src/maps.ts` if you want the catch plane higher (e.g. at concourse level).

### Bake spawn points

```bash
open "http://localhost:5173/?offline=1&map=/maps/tauron-arena.glb&bakeSpawns=1"
```

`?bakeSpawns=1` puts the spawn editor in bake mode: the positions you save are logged ready to
paste into `shared/src/maps.ts`.

- **F2** toggles the editor
- **P** saves the current position as a spawn
- **Backspace** undoes the last one
- **C** clears them all

Spawns are also kept in `localStorage` (`ai-gaem.spawns.<mapId>`), so a reload does not lose them.
When you are happy with the set, paste the logged list into the spawn entry for that map in
`shared/src/maps.ts`.

To bake them headlessly (no browser), run the same logic straight from Node:

```bash
node client/scripts/map/bake-spawns.ts \
  client/public/maps/tauron-arena_collision.glb \
  client/public/maps/tauron-arena.meta.json --spacing 6 \
  --ts shared/src/tauron-arena.spawns.ts --export TAURON_ARENA_SPAWNS
```

It casts down every column so multi-floor arenas (bowl tiers, concourses) all get spawn points.
Without `--ts` it prints a `MapSpawn[]` JSON array to paste into `MAPS[id].spawns`; with `--ts` it
writes a module (as `shared/src/tauron-arena.spawns.ts` is), which `shared/src/maps.ts` imports —
re-run it after re-processing the map's collision GLB.

### Make it the active map

Both the server and the client read the active map from `shared/src/maps.ts` (`ACTIVE_MAP_ID`) via
`@ai-gaem/shared`.

**1. Add the map and point at it.** Add or update the map's entry in `shared/src/maps.ts` — id,
GLB path and the baked spawns — then set `ACTIVE_MAP_ID` to that id.

**2. Republish the module** so `seedWorld` reseeds `spawn_point` for the new map:

```bash
pnpm --filter @ai-gaem/server publish:maincloud
```

**3. Confirm the reseed:**

```bash
spacetime sql --server maincloud prompt-wars-63xhe "SELECT * FROM spawn_point"
```

**4. Restart the client** (`pnpm dev`; the client bundles `@ai-gaem/shared`, so `ACTIVE_MAP_ID` is
read at build time) and join a multiplayer game: you should spawn on the venue map.

### Deploying

- **Server** — SpacetimeDB **Maincloud**, database `prompt-wars-63xhe`:
  `pnpm --filter @ai-gaem/server publish:maincloud` (run `pnpm --filter @ai-gaem/server generate`
  too if tables or reducers changed).
- **Client** — `pnpm --filter client build` produces a static bundle in `client/dist/`; upload that
  directory to any static host (S3 / Cloudflare Pages / Netlify / Vercel / nginx). Nothing
  server-side is needed.
- **Map files** — put the visual GLB and its `_collision.glb` on a bucket/CDN. Configure CORS so the
  client origin can `GET` them (`Access-Control-Allow-Origin: https://<client-origin>`,
  `Access-Control-Allow-Methods: GET`); the browser fetches GLBs with `fetch`, so a missing CORS
  header shows up as a failed load and the game falls back to the test map.
- **`VITE_MAP_BASE_URL`** — set it at build time to the bucket root, e.g.
  `VITE_MAP_BASE_URL=https://cdn.example.com pnpm --filter client build`; `?map=/maps/tauron-arena.glb`
  then loads `https://cdn.example.com/maps/tauron-arena.glb`. Leave it unset to serve maps from the
  client origin (`client/public/maps/`).
