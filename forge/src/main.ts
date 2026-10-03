// Entry: node dist/server.mjs (or tsx src/main.ts). Listens on FORGE_HOST:FORGE_PORT (127.0.0.1:8787).
import { configFromEnv, createForgeServer } from './server';
import { searchTemplates } from '@ai-gaem/parts';

const cfg = configFromEnv();
const host = process.env.FORGE_HOST ?? '127.0.0.1';
const port = Number(process.env.FORGE_PORT ?? 8787);

// warm the template index (first search builds 20k templates)
searchTemplates('warmup', { limit: 1 });

const server = createForgeServer(cfg);
server.listen(port, host, () => {
  console.log(`[forge] listening on http://${host}:${port} (${cfg.apiKey ? `live, ${cfg.model}` : 'MOCK mode: no ANTHROPIC_API_KEY'})`);
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
