import test from 'node:test';
import assert from 'node:assert/strict';
import { isPackedColumnsV1, packColumnsV1, worldEntityOrderV1 } from '@souls/protocol';
import { splitSnapshot } from '../../server/src/god/snapshot-wire.ts';
import { ENTRY_HEDGE_MS, expandSnapshot, loadSnapshot } from './snapshot-wire.ts';
import { entryWireUrl } from './snapshot-prefetch.ts';

const sample = {
  contract: 'world/1', worldId: 'w', seq: 7, counter: 3, seed: 's', tick: 42, constants: {}, state: {},
  ground: { kind: 'hills', h: [1, 2] },
  defs: [{ name: 'core-barrel', version: 1, params: { wood: { default: '#8c5f3a' }, iron: { default: '#3b3a36' } } }, { name: 'core-rock', version: 2 }],
  entities: [
    { id: 'e_1', def: 'core-barrel@1', in: { parent: 'world' }, p: [1, 0, 2], params: { wood: '#8c5f3a', iron: '#000000' } },
    { id: 'e_2', def: 'core-barrel@1', in: { parent: 'world' }, p: [3, 0, 2] },
    { id: 'e_3', def: 'core-rock@2', in: { parent: 'e_1', slot: 'top' }, params: { size: 2 } },
  ],
  assetBytes: {}, builds: [], buildsRev: 0, now: 1792414016708,
};
const roundTrip = (snap: Record<string, unknown>) => { const s = splitSnapshot(structuredClone(snap)); return expandSnapshot(JSON.parse(JSON.stringify(s.body)), s.parts.defs as never, s.parts.ground); };

test('split on the server then expand on the client gives the plain snapshot back', () => {
  assert.deepEqual(roundTrip(sample), sample);
});

test('JOINSET cols=1: the entities in the column form expand to the same plain snapshot (JSON.stringify identical)', () => {
  const s = splitSnapshot(structuredClone(sample)), body = { ...s.body, entities: packColumnsV1(s.body.entities, worldEntityOrderV1) };
  assert.ok(isPackedColumnsV1(body.entities));
  const back = expandSnapshot(JSON.parse(JSON.stringify(body)), s.parts.defs as never, s.parts.ground);
  assert.equal(JSON.stringify(back), JSON.stringify(roundTrip(sample)));
  assert.equal(JSON.stringify(back), JSON.stringify(expandSnapshot(JSON.parse(JSON.stringify(s.body)), s.parts.defs as never, s.parts.ground)));
});

test('PF2: a stalled page-entry snapshot or part is asked for again after ENTRY_HEDGE_MS instead of holding the arrival', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const g = globalThis as unknown as Record<string, unknown>, saved = { window: g.window, fetch: g.fetch };
  t.after(() => { g.window = saved.window; g.fetch = saved.fetch; });
  const s = splitSnapshot(structuredClone(sample)), plain = '/worlds/w/x/v1/world/snapshot', never = new Promise<Response>(() => {});
  g.window = {}; const url = entryWireUrl(plain);
  // the page-entry prefetches of the snapshot and of the defs part never answer (a stalled request)
  g.window = { __soulsSnapshotPrefetch: { url, response: never, parts: { [s.refs.defs]: never } } };
  const asked: string[] = [], json = (x: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(x), { headers });
  g.fetch = async (u: string) => { asked.push(u);
    if (u === url) return json(s.body, { 'x-defs-ref': s.refs.defs, 'x-ground-ref': s.refs.ground });
    if (u.endsWith(`/part/${s.refs.defs}`)) return json(s.parts.defs);
    if (u.endsWith(`/part/${s.refs.ground}`)) return json(s.parts.ground);
    throw Error(`unexpected ${u}`); };
  let got: Awaited<ReturnType<typeof loadSnapshot>> | undefined;
  void loadSnapshot(plain, new AbortController().signal, true).then((x) => { got = x; });
  const settle = () => new Promise((r) => setImmediate(r));
  await settle(); assert.equal(got, undefined, 'waits for the prefetch first');
  t.mock.timers.tick(ENTRY_HEDGE_MS - 1); await settle(); assert.equal(got, undefined);
  for (let i = 0; i < 4 && got === undefined; i++) { t.mock.timers.tick(ENTRY_HEDGE_MS); await settle(); await settle(); }
  assert.ok(got, 'arrives once the stalled requests are asked for again');
  assert.deepEqual(got.snap, sample);
  assert.deepEqual(asked.map((u) => u.replace(/.*\/v1\/world\//, '')), ['snapshot?defs=ref&cols=1', `part/${s.refs.ground}`, `part/${s.refs.defs}`]);
});
