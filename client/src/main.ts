import {
  SPACETIME_DB_NAME,
  SPACETIME_LOCAL_URI,
  SPACETIME_MAINCLOUD_URI,
  activeMap,
} from '@ai-gaem/shared';
import './ui/tokens.css';
import { Game } from './engine/Game';
import { loadRapier } from './engine/physics';
import { resolveMapUrl } from './map/assetUrl';
import { OfflineNetClient, SpacetimeNetClient, type NetClient } from './net';
import { installTestHook } from './testHook';

const params = new URLSearchParams(location.search);

/**
 * Network selection:
 *   ?offline=1           single-player OfflineNetClient (optionally ?bots=3)
 *   ?server=local        ws://localhost:3000 (a local `spacetime start`)
 *   ?server=<ws(s)://..> any SpacetimeDB host
 *   (default)            Maincloud, database prompt-wars-63xhe
 * Also: ?db=<name> database override, ?name=<display name>, ?fresh=1 new identity.
 * VITE_SPACETIMEDB_HOST / VITE_SPACETIMEDB_DB_NAME override the defaults at build time.
 */
function createNet(): { net: NetClient; label: string } {
  const bots = Number(params.get('bots') ?? 0) || 0;
  if (params.get('offline') === '1' || params.get('offline') === 'true') {
    return { net: new OfflineNetClient({ bots, botCenter: [0, 0, 0] }), label: 'offline' };
  }
  const server = params.get('server');
  const env = import.meta.env as Record<string, string | undefined>;
  const uri =
    server === 'local'
      ? SPACETIME_LOCAL_URI
      : server && /^wss?:\/\//.test(server)
        ? server
        : (env.VITE_SPACETIMEDB_HOST ?? SPACETIME_MAINCLOUD_URI);
  const dbName = params.get('db') ?? env.VITE_SPACETIMEDB_DB_NAME ?? SPACETIME_DB_NAME;
  const net = new SpacetimeNetClient({
    uri,
    dbName,
    name: params.get('name') ?? undefined,
    fresh: params.get('fresh') === '1',
  });
  return { net, label: `${uri.replace(/^wss?:\/\//, '')} / ${dbName}` };
}

type BootUi = { done(): void; error(t: string): void };
const boot = (window as Window & { __boot?: BootUi }).__boot;
// start the physics chunk + wasm download right away (its wasm is also preloaded from index.html)
void loadRapier().catch(() => {});

const { net, label } = createNet();
const e2e = params.get('e2e') === '1';
const game = new Game();
installTestHook(game);
game
  .start(document.getElementById('app')!, {
    mapUrl: resolveMapUrl(params.get('map') ?? activeMap().url ?? undefined),
    bots: Number(params.get('bots') ?? 0) || 0,
    net,
    serverLabel: label,
    e2e,
    shell: params.get('shell') === '1',
  })
  .then(() => boot?.done())
  .catch((err) => {
    console.error(err);
    boot?.error(String(err));
    (window as unknown as { __gameError: string }).__gameError = String(err);
    document.body.insertAdjacentHTML(
      'beforeend',
      `<pre style="color:#f66;position:fixed;top:0;left:0;padding:16px;z-index:100;background:#000c">${String(err)}</pre>`,
    );
  });

// handy for debugging in the console / headless checks
(window as unknown as { game: Game }).game = game;
