// The browser worker adapter in a real Node worker: native message-task and structured-clone semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { on } from 'node:events';
import { Worker } from 'node:worker_threads';
import { INITIAL_ENTITY_BATCH, type DecoderReply, type PlainSnapshot } from './snapshot-delta.ts';

test('the real worker serves bounded initial replies and retains the same snapshot for a no-change resync', { timeout: 10_000 }, async t => {
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage: message => parentPort.postMessage(message) };
    (async () => {
      await import(${JSON.stringify(new URL('./snapshot-delta.worker.ts', import.meta.url).href)});
      parentPort.on('message', data => self.onmessage({ data }));
      parentPort.postMessage({ ready: true });
    })().catch(error => { throw error; });
  `, { eval: true });
  const messages = on(worker, 'message');
  t.after(async () => { await messages.return?.(); await worker.terminate(); });
  const next = async () => (await messages.next()).value![0] as DecoderReply;
  assert.deepEqual(await next(), { ready: true });
  const snapshot: PlainSnapshot = { contract: 'world/1', seq: 7, constants: {}, state: {}, ground: {}, defs: [],
    entities: Array.from({ length: INITIAL_ENTITY_BATCH + 1 }, (_, i) => ({ id: `e_${i}`, def: 'fixture@1', in: { parent: 'world' }, p: [i, 0, 2] })),
  };
  const pieces = () => ({ kind: 'plain', body: [new TextEncoder().encode(JSON.stringify(snapshot))] });
  worker.postMessage({ id: 1, kind: 'initial', pieces: pieces() });
  const first = await next();
  assert.equal(first.snapshot?.entities.length, INITIAL_ENTITY_BATCH); assert.equal(first.done, false);
  worker.postMessage({ id: 2, kind: 'pull', initial: 1 });
  const last = await next();
  assert.deepEqual(last, { id: 2, initial: 1, entities: snapshot.entities.slice(INITIAL_ENTITY_BATCH), done: true });
  assert.deepEqual({ ...first.snapshot, entities: [...first.snapshot!.entities, ...last.entities!] }, snapshot);
  worker.postMessage({ id: 3, kind: 'delta', pieces: pieces() });
  const delta = (await next()).delta!;
  assert.equal(delta.full, false); assert.deepEqual(delta.upserts, []); assert.equal(delta.unchanged, snapshot.entities.length);
  worker.postMessage({ id: 4, kind: 'initial', pieces: { kind: 'plain', body: [new TextEncoder().encode('invalid')] } });
  assert.match((await next()).error ?? '', /JSON|Unexpected/);
  worker.postMessage({ id: 5, kind: 'delta', pieces: pieces() });
  assert.equal((await next()).delta?.unchanged, snapshot.entities.length, 'malformed data does not replace the valid baseline');
});
