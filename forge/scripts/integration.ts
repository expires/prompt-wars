// End-to-end: forge service (mock, in-process unless FORGE_URL is set) -> local SpacetimeDB
// register_design, exercising the forging / respawn / redeploy rules over the HTTP API.
//
//   STDB_URL=http://127.0.0.1:3000 STDB_DB=forge-mig-test tsx scripts/integration.ts
// Never point this at Maincloud.
import type { AddressInfo } from 'node:net';
import { configFromEnv, createForgeServer } from '../src/server';
import { NdjsonParser } from '../src/assembler';
import type { ForgeDesign, ForgeEvent } from '@ai-gaem/shared/forge';

const STDB = process.env.STDB_URL ?? 'http://127.0.0.1:3000';
const DB = process.env.STDB_DB ?? 'forge-mig-test';
if (/maincloud/i.test(STDB)) throw new Error('refusing to run against maincloud');

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
  console.log(`  ok - ${msg}`);
}

async function stdbIdentity(): Promise<{ identity: string; token: string }> {
  const r = await fetch(`${STDB}/v1/identity`, { method: 'POST' });
  if (!r.ok) throw new Error(`identity: ${r.status}`);
  return (await r.json()) as { identity: string; token: string };
}

async function call(token: string, reducer: string, args: unknown[]): Promise<{ ok: boolean; status: number; text: string }> {
  const r = await fetch(`${STDB}/v1/database/${DB}/call/${reducer}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { ok: r.ok, status: r.status, text: await r.text() };
}

async function sql(token: string, q: string): Promise<Record<string, unknown>[]> {
  const r = await fetch(`${STDB}/v1/database/${DB}/sql`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
    body: q,
  });
  if (!r.ok) throw new Error(`sql ${r.status}: ${await r.text()}`);
  const res = (await r.json()) as { schema: { elements: { name: { some?: string } | string }[] }; rows: unknown[][] }[];
  const { schema, rows } = res[0];
  const names = schema.elements.map(e => (typeof e.name === 'string' ? e.name : (e.name.some ?? '')));
  // SELECT * reports canonical snake_case column names; expose camelCase like the TS module
  const camel = (n: string) => n.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return rows.map(row => Object.fromEntries(row.map((v, i) => [camel(names[i]), v])));
}

async function generate(base: string, body: unknown): Promise<{ design: ForgeDesign; events: ForgeEvent[] }> {
  const res = await fetch(`${base}/api/forge/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`generate ${res.status}: ${await res.text()}`);
  const events: ForgeEvent[] = [];
  const p = new NdjsonParser(o => events.push(o as unknown as ForgeEvent));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    p.push(dec.decode(value, { stream: true }));
  }
  p.end();
  const done = events.find(e => e.type === 'done') as Extract<ForgeEvent, { type: 'done' }> | undefined;
  if (!done) throw new Error(`no done event: ${JSON.stringify(events.filter(e => e.type === 'error'))}`);
  return { design: done.design, events };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  let base = process.env.FORGE_URL ?? '';
  let server: ReturnType<typeof createForgeServer> | undefined;
  if (!base) {
    server = createForgeServer({ ...configFromEnv({}), apiKey: '', mockDelayMs: 20 });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  console.log(`forge: ${base}  spacetimedb: ${STDB}/${DB}`);
  try {
    console.log('1. generate a design');
    const { design, events } = await generate(base, { prompt: 'a crocodile rocket launcher', seed: 42 });
    assert(events.filter(e => e.type === 'component').length > 0, `streamed ${events.filter(e => e.type === 'component').length} components`);

    console.log('2. new player is forging (dead, no weapon)');
    const { identity, token } = await stdbIdentity();
    const named = await call(token, 'set_name', ['Forger']);
    assert(named.ok, `set_name (${named.status} ${named.text})`);
    const who = `0x${identity}`;
    let me = (await sql(token, `SELECT * FROM player WHERE identity = ${who}`))[0];
    assert(me && me.alive === false && me.needsLoadout === true && String(me.weaponId) === '0', 'new player: alive=false, needsLoadout=true, weaponId=0');
    const early = await call(token, 'respawn', [true]);
    assert(!early.ok, `respawn refused without a weapon (${early.text.trim()})`);

    console.log('3. register_design equips it');
    const reg = await call(token, 'register_design', [JSON.stringify(design), 'a crocodile rocket launcher']);
    assert(reg.ok, `register_design (${reg.status} ${reg.text})`);
    me = (await sql(token, `SELECT * FROM player WHERE identity = ${who}`))[0];
    assert(me.needsLoadout === false && String(me.weaponId) !== '0', `equipped weapon ${me.weaponId}`);
    const w = (await sql(token, `SELECT * FROM weapon WHERE id = ${me.weaponId}`))[0];
    const stored = JSON.parse(String(w.design)) as ForgeDesign;
    assert(stored.components.length === design.components.length, `design stored (${stored.components.length} components, ${String(w.design).length} bytes)`);
    const weaponJson = JSON.parse(String(w.json));
    assert(weaponJson.damage === stored.stats.damage && weaponJson.class === stored.class, 'weapon.json stats == design stats');
    const bad = await call(token, 'register_design', ['{"components":[]}', 'empty']);
    assert(!bad.ok, 'empty design rejected');

    console.log('4. respawn, redeploy, respawn');
    const sp = await call(token, 'respawn', [true]);
    assert(sp.ok, 'respawn with the forged weapon');
    me = (await sql(token, `SELECT * FROM player WHERE identity = ${who}`))[0];
    assert(me.alive === true, 'alive');
    const rd = await call(token, 'request_redeploy', []);
    assert(rd.ok, 'request_redeploy');
    me = (await sql(token, `SELECT * FROM player WHERE identity = ${who}`))[0];
    assert(me.alive === false && Number(me.deaths) === 0, 'dead after redeploy, no death counted at full HP');
    const tooSoon = await call(token, 'respawn', [true]);
    assert(!tooSoon.ok, 'respawn waits for the 3 s delay');
    // a second design registered while dead is equipped
    const { design: d2 } = await generate(base, { prompt: 'a frying pan', seed: 7 });
    const reg2 = await call(token, 'register_design', [JSON.stringify(d2), 'a frying pan']);
    assert(reg2.ok, 'register a new loadout while redeploying');
    const me2 = (await sql(token, `SELECT * FROM player WHERE identity = ${who}`))[0];
    assert(String(me2.weaponId) !== String(me.weaponId), `switched loadout to ${me2.weaponId}`);
    await sleep(3200);
    const sp2 = await call(token, 'respawn', [true]);
    assert(sp2.ok, 'respawn after delay');
    me = (await sql(token, `SELECT * FROM player WHERE identity = ${who}`))[0];
    assert(me.alive === true && String(me.weaponId) === String(me2.weaponId), 'alive with the new loadout');
    console.log('INTEGRATION OK');
  } finally {
    server?.close();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
