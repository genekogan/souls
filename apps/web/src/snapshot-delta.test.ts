// Offline: node --import=./tools/test-harness/web-loader.mjs --test apps/web/src/snapshot-delta.test.ts
// Lane PERF-SNAPSHOT: a resync's snapshot as a delta against the last one (diffSnapshots), and the decoder's main-thread
// fallback when there is no worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSnapshot } from '../../server/src/god/snapshot-wire.ts';
import { diffSnapshots, fullDelta, SnapshotDecoder, type PlainSnapshot } from './snapshot-delta.ts';
import { packColumnsV1, worldEntityOrderV1 } from '@sim/protocol';

const E = (id: string, x: Record<string, unknown> = {}) => ({ id, def: 'core-barrel@1', in: { parent: 'world' }, p: [1, 0, 2], params: { wood: '#8c5f3a' }, ...x });
const snap = (x: Partial<PlainSnapshot> = {}): PlainSnapshot => ({
  contract: 'world/1', worldId: 'w', seq: 7, counter: 3, seed: 's', constants: { extent: 100 }, state: { about: { title: 'a' } },
  ground: { kind: 'hills', h: [1, 2] },
  defs: [{ ref: 'core-barrel@1', hash: 'h-barrel', name: 'core-barrel', version: 1 }, { ref: 'core-rock@2', hash: 'h-rock', name: 'core-rock', version: 2 }],
  entities: [E('e_1'), E('e_2', { p: [3, 0, 2] }), E('e_3', { def: 'core-rock@2', in: { parent: 'e_1', slot: 'top' } })],
  assetBytes: {}, builds: [], buildsRev: 0, now: 1_792_414_016_708, ...x,
});

test('no baseline: the whole snapshot (full), every ref named', () => {
  const d = diffSnapshots(null, snap());
  assert.equal(d.full, true); assert.equal(d.upserts.length, 3); assert.deepEqual(d.removes, []); assert.equal(d.defs.length, 2);
  assert.deepEqual(d.refs, [['core-barrel@1', 'h-barrel'], ['core-rock@2', 'h-rock']]);
  assert.deepEqual(d.ground, snap().ground); assert.equal(d.seq, 7); assert.equal(d.counter, 3); assert.equal(d.total, 3);
  assert.deepEqual(fullDelta(snap()), d);
});

test('the same snapshot again: nothing to apply (no upserts, removes, defs or ground), the counts say so', () => {
  const d = diffSnapshots(snap(), snap({ seq: 9, now: 1 }));
  assert.equal(d.full, false); assert.deepEqual(d.upserts, []); assert.deepEqual(d.removes, []); assert.deepEqual(d.defs, []); assert.equal(d.ground, null);
  assert.equal(d.unchanged, 3); assert.equal(d.total, 3); assert.equal(d.seq, 9); assert.equal(d.now, 1);
});

test('changed, added and removed entities, in snapshot order; a new def revision by hash; the ground only when it differs', () => {
  const prev = snap();
  const next = snap({
    entities: [E('e_1', { p: [5, 0, 2] }), E('e_3', { def: 'core-rock@2', in: { parent: 'e_1', slot: 'top' } }), E('e_4')],
    defs: [...prev.defs, { ref: 'core-barrel@1', hash: 'h-barrel-2', name: 'core-barrel', version: 1 }],
    ground: { kind: 'hills', h: [1, 3] },
  });
  const d = diffSnapshots(prev, next);
  assert.deepEqual(d.upserts.map((e) => e.id), ['e_1', 'e_4']);
  assert.deepEqual(d.removes, ['e_2']);
  assert.deepEqual(d.defs.map((x) => x.hash), ['h-barrel-2']);
  assert.deepEqual(d.refs, [['core-barrel@1', 'h-barrel'], ['core-rock@2', 'h-rock'], ['core-barrel@1', 'h-barrel-2']], 'the active revision last, as fromSnapshot reads them');
  assert.deepEqual(d.ground, next.ground);
  assert.equal(d.unchanged, 1);
});

test('touched ids (changed by a socket diff since the baseline) come back whatever the baseline says; asked-for ground too', () => {
  const d = diffSnapshots(snap(), snap(), ['e_2', 'e_9'], true);
  assert.deepEqual(d.upserts.map((e) => e.id), ['e_2'], 'the snapshot has it: its record, even though the baseline agrees');
  assert.deepEqual(d.removes, ['e_9'], 'neither snapshot has it: gone');
  assert.deepEqual(d.ground, snap().ground);
  assert.equal(d.unchanged, 2);
});

test('a key order or value change inside params or state is a change; a defaulted param written identically is not', () => {
  const a = snap({ entities: [E('e_1', { params: { wood: '#8c5f3a', iron: '#000' } })] });
  assert.equal(diffSnapshots(a, snap({ entities: [E('e_1', { params: { iron: '#000', wood: '#8c5f3a' } })] })).upserts.length, 1);
  assert.equal(diffSnapshots(a, snap({ entities: [E('e_1', { params: { wood: '#8c5f3a', iron: '#000' } })] })).upserts.length, 0);
  assert.equal(diffSnapshots(a, snap({ entities: [E('e_1', { params: { wood: '#8c5f3a', iron: '#000' }, state: { on: true } })] })).upserts.length, 1);
});

const bytes = (v: unknown) => [new TextEncoder().encode(JSON.stringify(v))];
test('without a worker the decoder parses on the main thread: the wire pieces expand to the plain snapshot and the delta is full', async () => {
  const plain = { ...snap(), defs: [{ name: 'core-barrel', version: 1, params: { wood: { default: '#8c5f3a' }, iron: { default: '#3b3a36' } } }, { name: 'core-rock', version: 2 }], entities: [{ id: 'e_1', def: 'core-barrel@1', in: { parent: 'world' }, p: [1, 0, 2], params: { wood: '#8c5f3a', iron: '#000000' } }, { id: 'e_2', def: 'core-barrel@1', in: { parent: 'world' }, p: [3, 0, 2] }] };
  const s = splitSnapshot(structuredClone(plain)), body = { ...s.body, entities: packColumnsV1(s.body.entities, worldEntityOrderV1) };
  const dec = new SnapshotDecoder(null);
  const d = await dec.delta({ kind: 'wire', body: bytes(body), defs: bytes(s.parts.defs), ground: bytes(s.parts.ground), defsRef: s.refs.defs, groundRef: s.refs.ground }, ['e_1'], false);
  assert.equal(d.full, true); assert.equal(dec.hasBaseline, false);
  assert.deepEqual(d.upserts, plain.entities); assert.deepEqual(d.ground, plain.ground);
  const p = await dec.delta({ kind: 'plain', body: bytes(plain) }, [], false);
  assert.deepEqual(p.upserts, plain.entities);
  await assert.rejects(dec.delta({ kind: 'wire', body: bytes(body), defs: bytes(s.parts.defs), ground: bytes(s.parts.ground), defsRef: 'other', groundRef: s.refs.ground }, [], false), /mismatch/, 'pieces that do not fit are refused (the loader then takes the plain snapshot)');
});

test('a worker that answers is used; a broken one is dropped and the main thread takes over for good', async () => {
  const sent: unknown[] = [];
  const fake = { onmessage: null as null | ((ev: { data: unknown }) => void), onerror: null as null | (() => void), postMessage(m: { id: number; kind: string }) { sent.push(m); queueMicrotask(() => fake.onmessage?.({ data: m.kind === 'baseline' ? { id: m.id } : { id: m.id, delta: { ...fullDelta(snap()), full: false, upserts: [], unchanged: 3 } } })); }, terminate() {} };
  const dec = new SnapshotDecoder(() => fake as unknown as Worker);
  dec.baselineFrom({ kind: 'plain', body: bytes(snap()) }); await new Promise((r) => setTimeout(r, 0));
  assert.equal(dec.hasBaseline, true);
  const d = await dec.delta({ kind: 'plain', body: bytes(snap()) }, ['e_1'], true);
  assert.equal(d.full, false); assert.equal(d.unchanged, 3); assert.equal(sent.length, 2);
  assert.deepEqual((sent[1] as { touched: string[]; wantGround: boolean }).touched, ['e_1']); assert.equal((sent[1] as { wantGround: boolean }).wantGround, true);
  const broken = new SnapshotDecoder(() => { throw new Error('no workers'); });
  const f = await broken.delta({ kind: 'plain', body: bytes(snap()) }, [], false);
  assert.equal(f.full, true); assert.equal(f.upserts.length, 3);
});
