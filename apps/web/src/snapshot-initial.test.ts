import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotDecoder, INITIAL_ENTITY_BATCH, INITIAL_WORKER_BYTES, type DecoderRequest, type DecoderReply, type PlainSnapshot } from './snapshot-delta.ts';
import { SnapshotWorkerSession } from './snapshot-worker-session.ts';
import { splitSnapshot } from '../../server/src/god/snapshot-wire.ts';
import { packColumnsV1, worldEntityOrderV1 } from '@souls/protocol';
import type { SnapshotPieces } from './snapshot-wire.ts';

const bytes = (value: unknown, large = false) => [new TextEncoder().encode(JSON.stringify(value) + (large ? ' '.repeat(INITIAL_WORKER_BYTES) : ''))];
const snapshot = (n = 2): PlainSnapshot => ({ contract: 'world/1', seq: 9, counter: 17, seed: 'initial', constants: { extent: 100 }, state: {}, ground: { tiles: {} },
  defs: [{ ref: 'core-barrel@1', hash: 'h', name: 'core-barrel', version: 1, params: { wood: { default: '#123456' } } }],
  entities: Array.from({ length: n }, (_, i) => ({ id: `e_${String(i).padStart(5, '0')}`, name: `barrel-${i}`, def: 'core-barrel@1', in: { parent: i % 2 ? 'e_00000' : 'world' }, params: { wood: '#123456' }, p: [i, 0, 2] })),
  worldId: 'fixture', now: 100, assetBytes: { a: 32 }, builds: [], buildsRev: 2,
});
/** Match a browser's clone/transfer semantics in both directions, and its separate message tasks. */
function worker(fail?: (request: DecoderRequest) => boolean) {
  const state = new SnapshotWorkerSession(), sent: DecoderRequest[] = [], received: DecoderReply[] = [];
  let terminated = false;
  const w = {
    onmessage: null as null | ((event: { data: DecoderReply }) => void), onerror: null as null | (() => void),
    postMessage(message: DecoderRequest, transfer: Transferable[] = []) {
      const request = structuredClone(message, { transfer }); sent.push(request);
      setTimeout(() => {
        if (terminated) return;
        if (fail?.(request)) { w.onerror?.(); return; }
        const reply = structuredClone(state.handle(request)); received.push(structuredClone(reply)); w.onmessage?.({ data: reply });
      }, 0);
    },
    terminate() { terminated = true; },
  };
  return { make: () => w as unknown as Worker, sent, received, get terminated() { return terminated; } };
}

test('a large column snapshot returns exact ordered records in bounded message batches, and is the next delta baseline', async () => {
  const plain = snapshot(INITIAL_ENTITY_BATCH * 2 + 7), split = splitSnapshot(structuredClone(plain));
  const pieces: SnapshotPieces = { kind: 'wire', body: bytes({ ...split.body, entities: packColumnsV1(split.body.entities, worldEntityOrderV1) }, true), defs: bytes(split.parts.defs), ground: bytes(split.parts.ground), defsRef: split.refs.defs, groundRef: split.refs.ground };
  const w = worker(), decoder = new SnapshotDecoder(w.make);
  try {
    const got = await decoder.initial(pieces);
    assert.deepEqual(got, plain, 'column order, default params and all header fields survive');
    assert.equal(decoder.hasBaseline, true);
    assert.deepEqual(w.sent.map(r => r.kind), ['initial', 'pull', 'pull']);
    assert.deepEqual(w.received.map(r => (r.snapshot?.entities ?? r.entities)!.length), [INITIAL_ENTITY_BATCH, INITIAL_ENTITY_BATCH, 7]);
    assert.ok(pieces.body[0].byteLength >= INITIAL_WORKER_BYTES, 'fallback bytes still belong to the caller');
    const delta = await decoder.delta({ kind: 'plain', body: bytes(plain) }, [plain.entities[2].id], false);
    assert.equal(delta.full, false); assert.equal(delta.unchanged, plain.entities.length - 1);
    assert.deepEqual(delta.upserts, [plain.entities[2]], 'touched socket records still force an upsert');
  } finally { decoder.dispose(); }
});

test('small first loads parse here and transfer their bytes once for the baseline', async () => {
  const plain = snapshot(), pieces = { kind: 'plain' as const, body: bytes(plain) }, w = worker(), decoder = new SnapshotDecoder(w.make);
  try {
    assert.deepEqual(await decoder.initial(pieces), plain);
    assert.deepEqual(w.sent.map(r => r.kind), ['baseline']);
    assert.equal(pieces.body[0].byteLength, 0, 'only baseline-only calls relinquish bytes');
    await new Promise(r => setTimeout(r, 10)); assert.equal(decoder.hasBaseline, true);
  } finally { decoder.dispose(); }
});

test('a worker dying after accepting initial bytes or a partial batch falls back with complete records', async () => {
  for (const failKind of ['initial', 'pull']) {
    const plain = snapshot(INITIAL_ENTITY_BATCH + 7), pieces = { kind: 'plain' as const, body: bytes(plain, true) }, w = worker(r => r.kind === failKind), decoder = new SnapshotDecoder(w.make);
    assert.deepEqual(await decoder.initial(pieces), plain);
    assert.equal(decoder.hasBaseline, false); assert.equal(w.terminated, true);
    assert.ok(pieces.body[0].byteLength >= INITIAL_WORKER_BYTES);
  }
});

test('a failed delta still owns its input bytes and returns the full snapshot', async () => {
  const plain = snapshot(), pieces = { kind: 'plain' as const, body: bytes(plain) }, w = worker(() => true), decoder = new SnapshotDecoder(w.make);
  const delta = await decoder.delta(pieces, [], false);
  assert.equal(delta.full, true); assert.deepEqual(delta.upserts, plain.entities);
  assert.ok(pieces.body[0].byteLength > 0); assert.equal(w.terminated, true);
});

test('a stalled worker times out with intact fallback bytes', async () => {
  const plain = snapshot(), pieces = { kind: 'plain' as const, body: bytes(plain, true) };
  const decoder = new SnapshotDecoder(() => ({ postMessage(message: DecoderRequest, transfer: Transferable[]) { structuredClone(message, { transfer }); }, terminate() {} }) as unknown as Worker, 5);
  assert.deepEqual(await decoder.initial(pieces), plain); assert.equal(decoder.hasBaseline, false);
});

test('aborting during initial decoding terminates the worker and never returns partial or fallback data', async () => {
  const plain = snapshot(INITIAL_ENTITY_BATCH + 7), signal = new AbortController();
  const w = worker(request => { if (request.kind === 'pull') signal.abort(); return false; }), decoder = new SnapshotDecoder(w.make);
  await assert.rejects(decoder.initial({ kind: 'plain', body: bytes(plain, true) }, signal.signal), { name: 'AbortError' });
  assert.equal(w.terminated, true); assert.equal(decoder.hasBaseline, false);
});


test('empty and exact-boundary first replies finish without an extra pull', () => {
  for (const n of [0, INITIAL_ENTITY_BATCH, INITIAL_ENTITY_BATCH + 1]) {
    const session = new SnapshotWorkerSession();
    const first = session.handle({ id: 1, kind: 'initial', pieces: { kind: 'plain', body: bytes(snapshot(n)) } });
    assert.equal(first.snapshot?.entities.length, Math.min(n, INITIAL_ENTITY_BATCH));
    assert.equal(first.done, n <= INITIAL_ENTITY_BATCH);
    if (!first.done) {
      const last = session.handle({ id: 2, kind: 'pull', initial: 1 });
      assert.equal(last.entities?.length, 1); assert.equal(last.done, true);
      assert.match(session.handle({ id: 3, kind: 'pull', initial: 1 }).error ?? '', /expired/, 'completed streams release their retained snapshot');
    }
  }
});

test('disposing a layer during decode terminates work without fallback or publication', async () => {
  const w = worker(), decoder = new SnapshotDecoder(w.make);
  const pending = decoder.initial({ kind: 'plain', body: bytes(snapshot(), true) });
  decoder.dispose();
  await assert.rejects(pending, /disposed/); assert.equal(w.terminated, true); assert.equal(decoder.hasBaseline, false);
  await assert.rejects(decoder.initial({ kind: 'plain', body: bytes(snapshot()) }), /disposed/);
});
