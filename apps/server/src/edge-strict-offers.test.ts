// CTRL-1 (#1093): a strict act executes offered ids only, with params that fit the offer's schema; words resolve to
// candidates and never execute; a client that doesn't ask for strict keeps the legacy path; a server flag rolls it back.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {Hono} from 'hono';
import {getRequestListener} from '@hono/node-server';
import {fixture, invite, accept, factory} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes} from './edge/routes.ts';
import {paramsProblem, offerParams} from './edge/intents/offer-schema.ts';
import {compactDoHere} from './edge/perception/here.ts';
import {bootEden} from '../test/eden-capabilities-timing.ts';

async function world(t: {after(fn: () => void): void}) {
  const dir = mkdtempSync(join(tmpdir(), 'strict-offers-'));
  const f = fixture(join(dir, 'world.db'), factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}), app = new Hono();
  let soul: any;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul} as never);
  const tick = async (k = 5) => {for (let i = 0; i < k; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
  await tick(); await invite(f, 'ana');
  const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'Strict offers test'})) as {id: string; entityId?: string; entity_id?: string};
  soul = {soulId: row.id, entityId: row.entityId ?? row.entity_id, name: 'Ana', owner: 'dev:ana'};
  await tick();
  t.after(() => {comms.close(); f.host.stop(); f.db.close(); rmSync(dir, {recursive: true, force: true});});
  const post = async (path: string, body: unknown) => {
    const pending = Promise.resolve(app.request(path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}));
    for (let i = 0; i < 200; i++) {await tick(1); if (await Promise.race([pending.then(() => true), setImmediate(false)])) break;}
    return (await pending).json() as Promise<any>;
  };
  const get = async (path: string) => (await app.request(path)).json() as Promise<any>;
  const receipts = () => (f.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1 WHERE soul_id=?').get(soul.soulId) as {n: number}).n;
  return {f, edge, app, post, get, tick, soul, receipts};
}

test('strict act: an offered id acts; words, names and intents are refused with candidates and nothing happens', async t => {
  const w = await world(t);
  const {capabilities, paramsByVerb} = await w.get('/v1/edge/capabilities');
  const walk = capabilities.find((c: any) => c.verb === 'walk' && c.available);
  assert.ok(walk, 'a walk is on offer');
  assert.ok(paramsByVerb.walk.via, 'the walk schema travels with the page');
  const before = w.receipts();

  const words = await w.post('/v1/edge/act', {capability: `walk to ${walk.label}`, strict: true});
  assert.equal(words.accepted, false); assert.equal(words.code, 'capability.unknown');
  assert.ok(words.candidates?.length, JSON.stringify(words));
  for (const c of words.candidates) assert.equal(typeof c.id, 'string');

  const sitDown = await w.post('/v1/edge/act', {capability: 'sit down', strict: true});
  assert.equal(sitDown.accepted, false); assert.equal(sitDown.code, 'capability.unknown');

  const intent = await w.post('/v1/edge/act', {verb: 'go', target: {place: walk.target?.id}, strict: true});
  assert.equal(intent.accepted, false); assert.equal(intent.code, 'capability.unknown');
  assert.equal(w.receipts(), before, 'no receipt from any of them');

  const ok = await w.post('/v1/edge/act', {capability: walk.id, strict: true});
  assert.equal(ok.accepted, true, JSON.stringify(ok));
  assert.equal(ok.receipt.capability, walk.id);
});

test('strict act: a place by name is not an id; params are checked against the offer', async t => {
  const w = await world(t);
  const {capabilities} = await w.get('/v1/edge/capabilities');
  const walk = capabilities.find((c: any) => c.verb === 'walk' && c.available);
  const byName = await w.post('/v1/edge/act', {capability: `walk:${String(walk.label).split(' ').at(-1)!.toLowerCase().replace(/\W/g, '')}zz`, strict: true});
  assert.equal(byName.accepted, false); assert.equal(byName.code, 'capability.unknown');

  const wrong = await w.post('/v1/edge/act', {capability: walk.id, params: {seconds: 5}, strict: true});
  assert.equal(wrong.accepted, false); assert.equal(wrong.code, 'capability.params'); assert.match(wrong.reason, /via, with/); assert.ok(wrong.params.via);
  const shape = await w.post('/v1/edge/act', {capability: walk.id, params: {via: 'not-a-list'}, strict: true});
  assert.equal(shape.code, 'capability.params');
});

test('resolve advises: ranked candidates with schemas and availability, and it never executes', async t => {
  const w = await world(t);
  const {capabilities} = await w.get('/v1/edge/capabilities');
  const walk = capabilities.find((c: any) => c.verb === 'walk' && c.available);
  const before = w.receipts();
  const {resolve} = await w.post('/v1/edge/resolve', {capability: `walk to ${walk.label}`});
  assert.ok(resolve.candidates.length >= 1, JSON.stringify(resolve));
  const first = resolve.candidates[0];
  assert.equal(first.verb, 'walk'); assert.equal(typeof first.available, 'boolean'); assert.ok(first.params.with);
  assert.equal(w.receipts(), before);
});

test('legacy: without strict the words still execute; the server flag lets a strict client through for one release', async t => {
  const w = await world(t);
  const {capabilities} = await w.get('/v1/edge/capabilities');
  const walk = capabilities.find((c: any) => c.verb === 'walk' && c.available);
  const legacy = await w.post('/v1/edge/act', {capability: `walk to ${walk.label}`});
  assert.equal(legacy.accepted, true, JSON.stringify(legacy));
  process.env.EDGE_FREE_TEXT_ACT = '1';
  try {
    const flagged = await w.post('/v1/edge/act', {capability: `walk to ${walk.label}`, strict: true});
    assert.equal(flagged.accepted, true, JSON.stringify(flagged));
  } finally {delete process.env.EDGE_FREE_TEXT_ACT;}
});

test('here carries the shared parameters of the verbs it lists, inside its budget', async t => {
  const w = await world(t);
  const {here} = await w.get('/v1/edge/here?include=doHere');
  for (const o of here.doHere) if (here.doHereParams[o.verb]) assert.ok(Object.keys(here.doHereParams[o.verb]).length);
  assert.ok(Object.keys(here.doHereParams).every((v: string) => here.doHere.some((o: any) => o.verb === v)));
  // the map must not push the offers out: seen on a real world, where the budget left after the frame is about 650 bytes
  const tight = compactDoHere(Array.from({length: 29}, (_, i) => ({id: `dance:here${i}`, verb: i % 2 ? 'dance' : 'sit', label: 'Do a thing here', available: true})).map(c => ({...c, id: c.id.replace(/\d+$/, '') + (c.id.endsWith('here0') ? '' : '')})) as never, new Set(), 652);
  assert.ok(tight.doHere.length >= 5, JSON.stringify(tight));
  assert.ok(Buffer.byteLength(JSON.stringify([tight.doHere, tight.doHereParams])) <= 652);
  assert.ok(Buffer.byteLength(JSON.stringify(here)) <= 2600 + 400, 'the frame stays small');
});

test('offer schema: only what it states refuses', () => {
  const sit = {id: 'sit:b', verb: 'sit'}, carry = {id: 'carry:x', verb: 'carry', params: {to: {type: 'string', maxLength: 100}}};
  assert.equal(paramsProblem(sit, {seconds: 30}), null);
  assert.match(paramsProblem(sit, {seconds: 'long'})!, /seconds must be integer/);
  assert.match(paramsProblem(sit, {seconds: 6000})!, /1\.\.600/);
  assert.equal(paramsProblem(sit, {somethingNew: 1}), null, 'an open verb leaves an undeclared name to its plan');
  assert.equal(paramsProblem({id: 'walk:a', verb: 'walk'}, {with: 'Bo and Cy'}), null, 'with takes one string of names');
  assert.match(paramsProblem({id: 'walk:a', verb: 'walk'}, {nope: 1})!, /takes via, with/);
  assert.equal(paramsProblem(carry, {to: 'shed'}), null);
  assert.match(paramsProblem({id: 'x:y', verb: 'x', params: {side: {type: 'string', enum: ['l', 'r'], required: true}}}, {})!, /needs side/);
  assert.deepEqual(Object.keys(offerParams(carry)), ['to']);
});

test('rollback through the real CLI: words exit 2 with no act until the flag is on, then they act; off again, they refuse', async t => {
  const w = await world(t), {capabilities} = await w.get('/v1/edge/capabilities');
  const walk = capabilities.find((c: any) => c.verb === 'walk' && c.available), words = `walk to ${walk.label}`;
  const server = createServer(getRequestListener(w.app.fetch)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'strict-cli-'));
  t.after(() => {server.close(); rmSync(dir, {recursive: true, force: true});});
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: `http://127.0.0.1:${(server.address() as {port: number}).port}`, token: 'tok'}));
  const CLI = fileURLToPath(new URL('../../../tools/world-launcher/soul/eden.mjs', import.meta.url));
  // the CLI is its own process; the world keeps ticking so its act can be admitted
  const cli = async (...args: string[]) => {
    let done = false, out = '', exit = 0;
    const p = new Promise<void>(r => execFile(process.execPath, [CLI, ...args], {cwd: dir}, (e, stdout) => {out = stdout; exit = typeof e?.code === 'number' ? e.code : 0; done = true; r();}));
    while (!done) {await w.tick(1); await new Promise(r => setTimeout(r, 5));}
    await p; return {...JSON.parse(out), exit};
  };
  const before = w.receipts();
  const refused = await cli('act', words);
  assert.equal(refused.exit, 2); assert.equal(refused.code, 'act.not-an-id'); assert.equal(refused.accepted, false);
  assert.ok(refused.candidates.some((c: any) => c.id === walk.id), JSON.stringify(refused.candidates));
  assert.equal(w.receipts(), before, 'nothing happened');
  process.env.EDGE_FREE_TEXT_ACT = '1';
  try {
    const flagged = await cli('act', words);
    assert.equal(flagged.accepted, true, JSON.stringify(flagged)); assert.equal(flagged.exit, 0);
    assert.equal(w.receipts(), before + 1, 'the words acted');
  } finally {delete process.env.EDGE_FREE_TEXT_ACT;}
  const after = await cli('act', words);
  assert.equal(after.exit, 2, 'off again'); assert.equal(w.receipts(), before + 1);
});

// Found by the capacity bench on eden-2026: `resolve` named `walk:place-region-vineyard-orchard`, available, and the strict
// act refused that same id, naming it as the closest candidate, because the place was not on the Soul's menu.
test('a candidate resolve names is an id strict act takes, on or off the menu', async t => {
  const w = await bootEden(); t.after(() => w.close());
  const {soul, edge} = w;
  const off: string[] = [];
  for (const words of ['go to the orchard', 'go to the kitchen', 'go to the plaza', 'go to the bandstand']) {
    const id = (edge.intents.dryRun(soul, {capability: words}) as {would?: {capability?: string}}).would?.capability;
    assert.ok(id, words);
    if (!edge.capabilities(soul).some(c => c.id === id)) off.push(id);
    assert.equal(edge.offerGate(soul, {capability: id}), null, `${words} reads as ${id}, so the strict act takes it`);
  }
  assert.ok(off.length, 'at least one of them is off the menu, which is the case this covers');
  const name = edge.offerGate(soul, {capability: 'walk:orchard'});
  assert.equal(name?.code, 'capability.unknown', 'a name that reads as another id stays refused');
  assert.equal(edge.offerGate(soul, {capability: 'fly:eden-bandstand'})?.code, 'capability.unknown', 'and so does an id that is not on offer');
  // params are checked off the menu too
  assert.ok(off.length && off[0]!.startsWith('walk:'), off[0]);
  assert.equal(edge.offerGate(soul, {capability: off[0], params: {seconds: 5}})?.code, 'capability.params', 'a walk takes no seconds, on the menu or off it');
});
