# Prompt Wars

### ▶ [Play the live game: http://187.7.27.171/](http://187.7.27.171/)

Prompt Wars is a browser multiplayer arena shooter where you design your own gear in words. You
describe an outfit in the Closet and a weapon in the Forge, an LLM builds both piece by piece, a
shared balance layer keeps them fair, and you take them into a 3D arena against other players.
It runs on Three.js and Rapier in the browser, SpacetimeDB for the game server and a small Node
service that streams designs from Claude.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick start (local, no API key)](#quick-start-local-no-api-key)
- [Using the real forge](#using-the-real-forge)
- [Deploying](#deploying)
- [Testing](#testing)
- [Video pipeline](#video-pipeline)
- [Configuration reference](#configuration-reference)
- [Controls](#controls)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [Further reading](#further-reading)

## Features

- **Closet, then Forge.** New players start in the Closet (outfit), then the Forge (weapon), then
  deploy. Both editors stream the design in as it is generated, and support keep / lock / reject /
  reprompt. You can reopen them from the landing screen, the Esc menu and the death screen.
- **Generated weapons.** The LLM writes a JSON design in the Forge DSL (`shared/src/forge/`):
  name, class, fire mode, stats, palette, effects and up to 24 components built from primitive
  shapes or catalog parts. `sanitizeDesign()` makes any input legal (sizes, triangle budget,
  floating parts) and `clampWeapon()` balances it.
- **Balance.** Per-class stat bounds, max 95 damage per body shot (direct plus damage over time,
  so nothing one-shots from 100 HP), a sustained DPS budget of 55 (melee 80 at close range,
  streams up to 70 at short range), headshot multipliers of 1 to 3, range falloff, and splash,
  slow and knockback all costing budget. What you carry sets your move speed (carry weight).
- **Generated outfits with fair hitboxes.** Armour pieces are cosmetic. Body size drives the
  hitbox and max HP (`100 x area^0.75`, clamped to 70..140), so a big body is easier to hit but
  takes more damage. Details in [docs/characters.md](docs/characters.md).
- **Elements.** Weapons can carry fire, ice, poison or shock effects (`shared/src/elements.ts`),
  applied by the server on hit.
- **TAURON Arena map.** The active map is `tauron-remake`, a procedural model of TAURON Arena
  Krakow built entirely in code: an oval bowl around a 72 x 46 m event floor, two seating tiers,
  a concourse ring, tunnels, stage and roof, with about 13,000 instanced seats. All textures are
  drawn on canvases at load time; the map ships as a small JS chunk.
- **Health pack.** One pack in the middle of the stage heals +50 HP (capped at your max HP) and
  respawns after 60 s. The server validates the pickup against your position.
- **Multiplayer at 60 Hz.** Movement is client-authoritative and sent at 60 Hz while moving near
  others (30 Hz when nobody is near or the server is crowded, 10 Hz when only looking, nothing
  when idle). Shots are validated server-side against fire rate, ammo, range and the victim's
  recent poses (lag compensation, capped).
- **Players online.** The landing screen shows how many players are online.
- **Touch and gamepad.** On-screen controls on touch devices (or with `?touch=1`) and full
  gamepad support (sticks, triggers, aim slowdown, configurable deadzone and curve).
- **Prompt cache.** The first design forged from a given prompt is stored; typing the same
  prompt later shows it instantly and counts a use ("First forged by X" / "Forged by X, N uses").
  The forge service also keeps an in-memory cache that replays repeat prompts without a model call.
- **Profanity filter.** Names, prompts and part names are filtered (English and basic Polish,
  leetspeak folded, whole words only) in the module and in the forge before a prompt reaches the
  model.
- **Telemetry and reconnect.** Production clients report crashes, WebGL context loss and similar
  events to the forge service. The client shows a status banner and reconnects when the
  connection drops, and checks `/version.json` to detect a stale build.

## Architecture

```
                  WebSocket (subscriptions + reducer calls)
  Browser client  <------------------------------------------->  SpacetimeDB module
  (client/)                                                       (server/, Maincloud db
    |                                                              prompt-wars-63xhe)
    | POST /api/forge/generate, /api/forge/outfit (NDJSON stream)
    v
  Forge service (forge/)  ----------->  Anthropic Messages API (claude-haiku-4-5)
  127.0.0.1:8787                        (mock mode when no API key is set)
```

The client asks the forge for a design, renders it as it streams in, then registers the final
design with the SpacetimeDB module (`register_design`, `register_outfit`). The module re-sanitizes
and re-balances it with the same `shared` code before storing it, so the client and the forge are
never trusted for stats.

In production, Caddy serves the static client and proxies `/api/forge/*` to the forge on
127.0.0.1:8787 (systemd unit `ai-gaem-forge`). In development, Vite proxies `/api/forge/*`
(see `FORGE_PROXY` below).

| Package | Path | What it is |
| --- | --- | --- |
| `client` | `client/` | Vite + TypeScript + Three.js + Rapier game client, menus, Closet / Forge editors, Playwright e2e tests, load test |
| `@ai-gaem/shared` | `shared/` | Code shared by all packages: Forge DSL and sanitizer, balance (`clampWeapon`), elements, outfits, pickups, maps, hit validation, profanity filter |
| `@ai-gaem/server` | `server/` | SpacetimeDB 2.10 TypeScript module: tables, reducers, hit validation, world seeding |
| `@ai-gaem/forge` | `forge/` | Node 22 service (plain `node:http`) that streams weapon and outfit designs as NDJSON from Claude, with a template-based mock |
| `@ai-gaem/parts` | `parts/` | Weapon part library (`catalog.json`), templates, assembly, and a part gallery |
| `@ai-gaem/video` | `video/` | Promo video pipeline: Playwright capture of the real client plus Remotion compositions |

## Quick start (local, no API key)

This runs everything on your machine: a local SpacetimeDB, the forge in mock mode and the client.
No API key is needed and nothing touches the live game.

### Prerequisites

- **Node.js 22 or newer** (the forge requires `>=22`; the map scripts under `client/scripts/map`
  run `.ts` files directly, which needs a Node version with type stripping on by default, 22.18+).
- **pnpm** (the workspace uses `pnpm-workspace.yaml`; developed with pnpm 11).
- **SpacetimeDB CLI 2.10**:

  ```bash
  curl -sSf https://install.spacetimedb.com | sh -s -- -y   # installs ~/.local/bin/spacetime
  export PATH="$HOME/.local/bin:$PATH"
  spacetime --version
  ```

### Steps

```bash
# 1. install dependencies
pnpm install

# 2. terminal 1: start a local SpacetimeDB on :3000
spacetime start

# 3. terminal 2: build and publish the module to the local server
pnpm --filter @ai-gaem/server publish:local

# 4. terminal 3: run the forge in mock mode on 127.0.0.1:8787 (no ANTHROPIC_API_KEY set)
pnpm --filter @ai-gaem/forge dev
curl http://127.0.0.1:8787/api/forge/health      # reports mock mode

# 5. terminal 4: run the client, with /api/forge pointed at the local forge
FORGE_PROXY=http://127.0.0.1:8787 pnpm dev
```

Then open **http://localhost:5173/?server=local**.

Notes:

- Without `FORGE_PROXY`, the dev server proxies `/api/forge/*` to the **live** forge, and real
  generations there cost API credits. Set it for local work.
- Without `?server=local`, the client connects to the Maincloud database (the live game).
- `pnpm --filter @ai-gaem/server publish:local` runs `sync-catalog` first, which bundles the part
  catalog and recipes into the module. Republish after changing the catalog or the module.
- After changing tables or reducers, regenerate the client bindings:
  `pnpm --filter @ai-gaem/server generate` (writes `client/src/module_bindings/`, which is committed).
- For a quick look with no server at all: `http://localhost:5173/?offline=1` (single player,
  optional `&bots=3`).

Useful local commands:

```bash
spacetime logs --server local prompt-wars-63xhe -f
spacetime sql  --server local prompt-wars-63xhe "SELECT * FROM player"
pnpm --filter client build          # tsc --noEmit + vite build -> client/dist/
pnpm --filter client typecheck
```

## Using the real forge

The forge switches from mock to live mode when `ANTHROPIC_API_KEY` is set in its environment.
Never commit the key or paste it into files in the repo.

```bash
export ANTHROPIC_API_KEY=<your-anthropic-api-key>
export FORGE_MODEL=claude-haiku-4-5-20251001     # optional, this is the default
export FORGE_RATE_LIMIT=100                       # optional, generations per window per IP and per identity
export FORGE_RATE_WINDOW_MS=600000                # optional, window length (10 min)
pnpm --filter @ai-gaem/forge dev
```

`curl http://127.0.0.1:8787/api/forge/health` should now report live mode. Point the client at it
with `FORGE_PROXY=http://127.0.0.1:8787 pnpm dev` as above.

Repeat prompts are served from the forge's in-memory cache (`FORGE_CACHE_MAX`, default 500
entries, `0` turns it off) without a model call or rate-limit cost. Set `FORGE_DEBUG_RAW=1` to log
the raw model output. See the [configuration reference](#configuration-reference) for the rest.

Forge scripts:

```bash
pnpm --filter @ai-gaem/forge test          # vitest
pnpm --filter @ai-gaem/forge integration   # end-to-end against a running forge (FORGE_URL) and SpacetimeDB (STDB_URL, STDB_DB)
pnpm --filter @ai-gaem/forge samples       # generate sample designs (FORGE_URL)
pnpm --filter @ai-gaem/forge build         # bundle dist/server.mjs (used by the deploy)
```

## Deploying

The live game has three parts: the SpacetimeDB module on Maincloud, the static client on a VPS
behind Caddy, and the forge service on the same VPS. The deploy scripts SSH to the game VPS; set
`DEPLOY_HOST=user@host` to target a different machine.

### Server module (Maincloud)

```bash
spacetime login                                     # once, browser login
pnpm --filter @ai-gaem/server publish:maincloud     # sync-catalog + publish to prompt-wars-63xhe
pnpm --filter @ai-gaem/server generate              # only if tables or reducers changed
```

> **Warning:** never pass `-c` / `--delete-data` (or any other clear flag) when publishing to
> Maincloud. It destroys all player, weapon, outfit and prompt-cache data in the live database.
> The publish scripts use `--yes`, which only skips confirmation prompts; it does not delete data.

Schema changes are applied as automatic migrations (new tables, new columns with defaults). The
CLI disconnects connected clients, and old client builds are incompatible with changed reducers,
so deploy the client at the same time.

If the database pre-dates the module (init never ran), claim admin once from your logged-in
identity: `spacetime call --server maincloud prompt-wars-63xhe claim_admin`.

Dashboard: https://spacetimedb.com/prompt-wars-63xhe

### Client

```bash
./scripts/deploy.sh        # also available as: pnpm deploy
```

Builds the client and rsyncs `client/dist/` to the VPS (Caddy serves it with precompressed
brotli / gzip). Hashed assets go up first and old ones are kept for 14 days, so players on an older
`index.html` can still load their chunks; `index.html` goes last. The build writes
`version.json`, which running clients poll to detect that a newer build is live.

### Forge

```bash
./scripts/deploy-forge.sh
```

Bundles `forge/dist/server.mjs`, uploads it, installs Node 22 on the VPS if missing, and (re)writes
the systemd unit `ai-gaem-forge` listening on 127.0.0.1:8787. It also makes sure Caddy has a
`/api/forge/*` reverse-proxy block first in the Caddyfile (validated before reload, restored on
failure), then checks `/api/forge/health`.

Configuration lives in `/etc/ai-gaem-forge.env` on the VPS. The script **never overwrites** that
file: it creates it if missing (with an empty `ANTHROPIC_API_KEY`, which means mock mode) and
only appends keys that are absent. To go live or change settings, edit that file on the VPS and
run `systemctl restart ai-gaem-forge`. The script prints only key names, never values.

### Crash logs

Production clients send crash telemetry to the forge (`POST /api/forge/telemetry`), which appends
it to a size-capped log on the VPS. Read it with:

```bash
./scripts/client-errors.sh               # last 50 reports
./scripts/client-errors.sh -n 200        # last 200
./scripts/client-errors.sh -f            # follow live
./scripts/client-errors.sh -g <pattern>  # filter by name, message, GPU, ...
./scripts/client-errors.sh -k contextlost   # one report kind (error, rejection, contextlost, wasm, ws, mem, fps, ...)
./scripts/client-errors.sh --summary     # counts per kind, player and GPU
./scripts/client-errors.sh --raw         # raw JSONL
```

## Testing

### Unit tests

```bash
pnpm --filter @ai-gaem/shared test    # balance, forge DSL, outfits, pickups, maps (TAURON spawns, closed shell, climbable routes)
pnpm --filter @ai-gaem/forge test
pnpm --filter @ai-gaem/parts test
pnpm --filter client test:scripts     # map processing scripts (node --test)
```

Typecheck any package with `pnpm --filter <package> typecheck`.

### End-to-end (Playwright)

```bash
pnpm e2e                    # full local run
pnpm e2e --grep cooldown    # extra args go to Playwright
pnpm e2e:maincloud          # @smoke tests against Maincloud (publish there first if the module changed)
```

`pnpm e2e` (`client/e2e/run.mjs`) starts a local SpacetimeDB if nothing is listening on :3000,
publishes the module, starts a mock forge on :8788 (it refuses to run against a forge that has an
API key), runs Playwright (which starts Vite), and stops whatever it started. Tests drive the game
through `window.__game` instead of mouse input, with two or more browser contexts on headless
Chromium.

Specs in `client/e2e/`:

| Spec | Covers |
| --- | --- |
| `multiplayer.spec.ts` | seeing each other, kills, death screen, fire-rate limit, headshots, crouch, netcode smoothness, damage over time |
| `melee.spec.ts` | swings, reach, charged attacks, block, template melee weapons, gamepad |
| `forge.spec.ts` | Forge flow against the mock forge |
| `closet.spec.ts` | Closet outfits, body size to HP |
| `elements.spec.ts` | fire / ice / poison / shock effects |
| `pickups.spec.ts`, `pickups-offline.spec.ts` | health pack heal, respawn, server validation |
| `tauron-remake.spec.ts` | walkthroughs of the arena routes, viewpoint screenshots |
| `mouse-input.spec.ts` | high-rate mouse input in Chromium and Firefox (offline) |

Screenshots go to `client/e2e/screenshots/`. Playwright uses its own Chromium if installed
(`npx playwright install chromium`), otherwise a cached Chrome for Testing, or `PW_CHROMIUM_PATH`.

### Load test

A headless netcode load test spreads N bot clients over worker processes, all sending poses at a
given rate, and measures SpacetimeDB CPU, delivery rate, gaps and latency. It only runs against a
**local** server (it refuses Maincloud):

```bash
spacetime start --listen-addr 127.0.0.1:3100                                       # separate local server
spacetime publish --server http://127.0.0.1:3100 --module-path server pw-load --yes
cd client && node scripts/loadtest/run.mjs --port 3100 --db pw-load --n 8,16,32,64 --rate 30,60 --duration 20
```

## Video pipeline

`video/` produces the promo material from the real client. Outputs land in `video/out/` and
`video/public/` (gitignored).

| Command | What it does |
| --- | --- |
| `pnpm video:record` | Drives the client through landing, Closet, Forge and a few seconds in game; forge calls go to the real forge and the streams are saved as fixtures (costs two generations) |
| `pnpm video:capture` | Same capture, but replays the saved fixtures with their original timing (identical takes, no API cost) -> `video/public/capture.mp4` |
| `pnpm video:studio` | Opens Remotion Studio |
| `pnpm video:render` | Renders the main composition -> `video/out/prompt-wars-forge.mp4` |
| `pnpm video:render:clips` | Renders the armour and weapon clips |
| `pnpm video:flyover` | Arena flyover over live bot fights on a local SpacetimeDB -> `video/out/arena-flyover.mp4` |
| `pnpm video:voiceover` | Generates the promo voiceover with ElevenLabs (needs `ELEVENLABS_API_KEY` in the environment) |
| `pnpm video:promo:prep` | Stages the promo media (crops a gameplay recording, collects clips and the flyover) |
| `pnpm video:render:promo` | Renders the narrated promo -> `video/out/prompt-wars-promo.mp4` |

```bash
ELEVENLABS_API_KEY=<your-elevenlabs-key> pnpm video:voiceover [--voice george|daniel] [--only s3]
```

The capture scripts accept flags such as `--headless`, `--dpr 2`, `--armour "<prompt>"` and
`--weapon "<prompt>"`; see the header of `video/scripts/capture.ts`. Rendering needs `ffmpeg`.

## Configuration reference

### Forge service (environment)

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | empty | Anthropic key. Empty means mock mode |
| `FORGE_MODEL` | `claude-haiku-4-5-20251001` | Model used for generations |
| `FORGE_RATE_LIMIT` | `100` | Generations per window, per IP and per identity |
| `FORGE_RATE_WINDOW_MS` | `600000` | Rate-limit window (10 min) |
| `FORGE_CACHE_MAX` | `500` | Prompt cache entries (`0` = off) |
| `FORGE_HOST` / `FORGE_PORT` | `127.0.0.1` / `8787` | Listen address |
| `FORGE_TIMEOUT_MS` | `45000` | Model request timeout |
| `FORGE_MAX_BODY` | `240000` | Max request body (bytes) |
| `FORGE_ALLOWED_ORIGINS` | empty | Extra allowed browser origins, comma-separated |
| `FORGE_TRUST_PROXY` | on | Trust `X-Forwarded-For` from loopback (Caddy); `0` turns it off |
| `FORGE_MOCK_DELAY_MS` | `90` | Delay between streamed events in mock mode |
| `FORGE_DEBUG_RAW` | off | `1` logs raw model output |
| `FORGE_TELEMETRY_LOG` | `/var/log/ai-gaem/client-errors.jsonl` | Crash telemetry log path |
| `FORGE_TELEMETRY_MAX_BYTES` | 20 MB | Telemetry log size before rotation |

### Client build and dev (environment)

| Variable | Purpose |
| --- | --- |
| `FORGE_PROXY` | Where the Vite dev / preview server proxies `/api/forge/*`. Defaults to the live forge; use `http://127.0.0.1:8787` locally |
| `VITE_SPACETIMEDB_HOST` | SpacetimeDB URI baked into the build (default Maincloud) |
| `VITE_SPACETIMEDB_DB_NAME` | Database name baked into the build (default `prompt-wars-63xhe`) |
| `VITE_MAP_BASE_URL` | Base URL for GLB maps loaded with `?map=/maps/...` (default: the client origin) |
| `APP_VERSION` | Overrides the build id written to `version.json` |

### Other scripts (environment)

| Variable | Used by |
| --- | --- |
| `DEPLOY_HOST` | `scripts/*.sh`: SSH target (`user@host`), defaults to the game VPS |
| `ELEVENLABS_API_KEY` | `pnpm video:voiceover` |
| `E2E_SERVER`, `E2E_DB`, `E2E_PORT`, `E2E_BASE_URL` | Playwright e2e configuration |
| `PW_CHROMIUM_PATH` | Chromium binary for Playwright / video capture |

### Client URL parameters

| Parameter | Effect |
| --- | --- |
| *(none)* | Connect to Maincloud, database `prompt-wars-63xhe` |
| `?server=local` | Connect to `ws://localhost:3000` (local `spacetime start`) |
| `?server=wss://host` | Connect to any SpacetimeDB host |
| `?db=<name>` | Override the database name |
| `?offline=1` | Single player, no server (optionally `&bots=3`) |
| `?map=<id or url>` | Load a map: `tauron-remake`, `testmap`, or a GLB path such as `/maps/venue.glb` |
| `?quality=low\|medium\|high` | Force graphics quality (otherwise the setting, default Auto) |
| `?touch=1` / `?touch=0` | Force touch controls on / off |
| `?closet=1` / `?closet=0` | Force the Closet step on / off in the onboarding flow |
| `?name=<callsign>` | Set the display name |
| `?fresh=1` | Ignore the stored token and join as a new identity |
| `?nocache=1` | Skip the client-side prompt cache lookup |
| `?forge=https://host` | Use a different forge base URL |
| `?music=0` | Mute the procedural menu music |
| `?telemetry=0` / `?telemetry=1` | Force crash telemetry off / on (off by default in dev and automation) |
| `?shell=1` | Draw the collision shell of scanned GLB maps as a backdrop |
| `?bakeSpawns=1` | Spawn editor in bake mode (offline, GLB maps) |

## Controls

| Input | Action |
| --- | --- |
| Click | Lock the mouse and play |
| WASD | Move |
| Shift | Sprint (forward only) |
| C / Ctrl | Crouch |
| X | Slide |
| Space | Jump |
| T | Autorun |
| LMB | Fire / swing (hold for automatic weapons) |
| RMB | Aim down sights; with melee, hold to charge a heavy attack |
| F | Block (melee) |
| R | Reload |
| Arrows / Q E | Keyboard turning (trackpad fallback) |
| Tab | Scoreboard |
| F3 | Debug overlay (fps, position, RTT, interpolation, reducer calls) |
| Esc | Release the mouse; pause menu with Settings, Closet, Forge, redeploy |
| Gamepad | Left stick move, right stick look, RT fire, LT aim / heavy, A jump, B crouch, X reload, L3 sprint, RB block, Start menu |

Settings (sensitivity, FOV, toggles, Trackpad mode, gamepad tuning, graphics quality) are stored in
`localStorage`. Each browser tab is a separate player; a reload keeps your identity.

## Troubleshooting

**The game looks out of date after a deploy.** The client compares its build id with
`/version.json` every 60 s (and after a reconnect) and shows a "New version, Reload" banner
when a newer build is live. If you don't see it, hard refresh
(Cmd+Shift+R / Ctrl+Shift+R). The check is disabled on the dev server.

**Reducer errors or a broken schema locally.** Reset the local database (local only, never on
Maincloud):

```bash
spacetime publish --server local --module-path server prompt-wars-63xhe --delete-data --yes
```

Or stop `spacetime start` and start it again with a fresh `--data-dir`.

**Client errors about missing tables or reducers.** The bindings are out of date:
`pnpm --filter @ai-gaem/server generate`, then restart `pnpm dev`.

**Forge requests cost credits during local dev.** You forgot `FORGE_PROXY`; without it the dev
server proxies to the live forge.

**`pnpm e2e` fails with "the forge on :8788 is LIVE".** Something with an API key is running on
:8788. Stop it; e2e needs the mock.

**pnpm refuses to run a script because dependencies need verifying.** Run `pnpm install`, or prefix
the command with `pnpm_config_verify_deps_before_run=false`.

**Firefox on Linux: mouse look drops or lags fast movement.** On X11, Firefox emulates pointer lock
by warping the cursor. Use a Wayland session or a Chromium-based browser.

**Firefox stuck at 60 FPS on a high-refresh monitor.** That is Firefox's vsync: check
`about:support` (Refresh Rate), set `layout.frame_rate` in `about:config`, and note that
`privacy.resistFingerprinting` pins animation to 60 FPS.

**Laptop touchpad stops working while keys are held.** Enable Trackpad mode in Settings (toggle
crouch / sprint / aim, autorun on T, arrow / Q E turning).

## Project structure

```
.
├── client/                  game client (Vite + Three.js + Rapier)
│   ├── src/
│   │   ├── engine/          renderer, physics step, game loop, onboarding flow, quality
│   │   ├── forge/           Forge and Closet editors, forge client
│   │   ├── map/             map loading, procedural maps (tauronRemake.ts)
│   │   ├── net/             NetClient, SpacetimeDB and offline clients, interpolation, pose sender
│   │   ├── player/          character controller, camera, humanoids, outfit models
│   │   ├── weapons/         weapon models, fire modes, melee animation, effects
│   │   ├── ui/              HUD, menus, touch controls, status banner
│   │   ├── audio/           procedural sound effects and menu music
│   │   └── module_bindings/ generated SpacetimeDB bindings
│   ├── e2e/                 Playwright specs and runner
│   └── scripts/             loadtest/, map/ (scan processing, spawn baking)
├── shared/src/              forge DSL, balance, elements, outfit/, pickups, maps, tauronRemake/
├── server/                  SpacetimeDB module (src/, scripts/sync-catalog.mjs, spacetime.json)
├── forge/                   forge service (src/server.ts, llm.ts, mock.ts, outfit.ts, cache.ts, ratelimit.ts)
├── parts/                   part catalog, templates, gallery
├── video/                   capture scripts and Remotion compositions
├── scripts/                 deploy.sh, deploy-forge.sh, client-errors.sh
└── docs/                    characters.md, ui-spec.md
```

## Further reading

- [docs/characters.md](docs/characters.md): Closet outfits, body sizes and the HP / hitbox balance.
- [docs/ui-spec.md](docs/ui-spec.md): UI design tokens and component spec.
- Code comments at the top of `shared/src/balance.ts`, `shared/src/hitcheck.ts`,
  `shared/src/melee.ts` and `client/src/net/interp.ts` cover balance, hit validation, melee timing
  and interpolation in detail.
