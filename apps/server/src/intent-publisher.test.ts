import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import WebSocket from 'ws';
import { toyFactory } from '@souls/engine-toy';
import type { Engine, EngineFactory } from '@souls/engine-contract';
import { kernelHash } from '@souls/kernel';
import { INTENT_V2, intentHistoryFactV2, publicEvent } from '@souls/protocol';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { Db } from './db.ts';
import { buildApp } from './http.ts';
import { Hub } from './hub.ts';
import { replayIntentHistoryV2 } from './intent-history.ts';
import { IntentPublisher, IntentPurposeConflict } from './intent-publisher.ts';
import { IntentRequests, IntentRequestUnavailable, type RequestReservation, type IntentRequestScope } from './intent-requests.ts';
import { Souls } from './souls.ts';
import { WorldHost, replayKernel } from './world.ts';
import { waitForSocketCondition } from '../test/socket-condition.ts';

const words = 'PRIVATE_OWNER_WORDS drink tea later';
const interpretation = { summary: 'PRIVATE_INTERPRETATION rest here', agenda: [{ card: 'rest', target: null }], trigger: { kind: 'none' as const } };
type Owned = Extract<RequestReservation, { created: true }>;
function fixture(t: TestContext, disk = false, factory: EngineFactory = toyFactory) {
  const dir = disk ? mkdtempSync(join(tmpdir(), 'core-intent-publication-')) : null;
  const path = dir ? join(dir, 'fixture.db') : ':memory:';
  let db = new Db(path); t.after(() => { db.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });
  db.upsertUser({ id: 'dev:owner', role: 'user', email: null, wallet: null }); db.setInvited('dev:owner', 'fixture');
  let host = new WorldHost(db, factory, 'publication-fixture', 1e9, 'eden-fixture'); host.boot();
  const genesis = structuredClone(host.kernel);
  db.createSoul({ id: 's_A', worldId: host.worldId, owner: 'dev:owner', entityId: 'h_A', name: 'Alice', description: 'fixture', native: false });
  void host.enqueue('birth', 'fixture', { soulId: 's_A', entityId: 'h_A', owner: 'dev:owner', name: 'Alice', description: 'fixture' }); host.drainInputs();
  const scope: IntentRequestScope = { worldId: host.worldId, soulId: 's_A', source: { kind: 'owner', ownerId: 'dev:owner', principalId: 'PRIVATE_PRINCIPAL', channel: 'web' },
    currentAuthority: row => row.owner === 'dev:owner' && !!db.user('dev:owner')?.invited_by };
  return { path, scope, genesis, get db() { return db; }, get host() { return host; }, get store() { return new IntentRequests(db); },
    get publisher() { return new IntentPublisher(host, new IntentRequests(db)); },
    restart(snapshot: boolean) { if (snapshot) host.saveSnapshot(true); db.close(); db = new Db(path);
      host = new WorldHost(db, factory, 'publication-fixture', 1e9, scope.worldId); return host.boot(); },
  };
}
async function drive<T>(host: WorldHost, promise: Promise<T>): Promise<T> {
  let done = false; promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 25 && !done; i++) { await setImmediate(); host.drainInputs(); }
  assert.ok(done, 'actual sequencer settled the producer'); return promise;
}
async function receive(f: ReturnType<typeof fixture>, requestId: string, fields: Record<string, unknown> = {}) {
  const result = await drive(f.host, f.publisher.receive(f.scope, { contract: INTENT_V2, requestId, op: 'upsert', words, ...fields }));
  assert.ok(result.reservation.created); assert.equal(result.request?.received?.phase, 'received');
  return result.reservation as Owned;
}
async function publish(f: ReturnType<typeof fixture>, r: Owned) { return await drive(f.host, f.publisher.publish(f.scope, r, interpretation)); }

test('pre-interpretation fence rejects replacement Mind even when the current binding is valid', async t => {
  const f = fixture(t), r = await receive(f, 'async-binding');
  const seq = f.host.seq, original = f.host.minds.get('s_A')!;
  await assert.rejects(f.publisher.interpretAndPublish(f.scope, r, async guard => {
    assert.equal(guard(), true);
    // Rehydrating a replacement at the same Soul/body must not authorize a
    // response prepared from the old Mind. A fresh post-call fence would pass.
    f.host.minds.set('s_A', structuredClone(original));
    return interpretation;
  }), IntentRequestUnavailable);
  assert.equal(f.host.seq, seq); assert.equal(f.store.lookup(f.scope, r.request.requestId)!.receipt, null);
});

test('pre-interpretation exact-purpose fence ignores other purposes but rejects edits and withdrawal', async t => {
  const f = fixture(t); await publish(f, await receive(f, 'original'));
  const original = Object.values(f.host.intentHistoryOf('s_A').intents)[0].revision;
  const unchanged = await receive(f, 'edit-with-unrelated', { edit: { intentId: original.intentId, expectedVersion: 1 } });
  const result = await drive(f.host, f.publisher.interpretAndPublish(f.scope, unchanged, async guard => {
    await publish(f, await receive(f, 'independent'));
    assert.equal(guard(), true); return interpretation;
  }));
  assert.equal(result.receipt?.phase, 'understood');
  const stale = await receive(f, 'slow-edit', { edit: { intentId: original.intentId, expectedVersion: 2 } });
  await assert.rejects(drive(f.host, f.publisher.interpretAndPublish(f.scope, stale, async guard => {
    const later = await receive(f, 'later-edit', { edit: { intentId: original.intentId, expectedVersion: 2 } });
    await publish(f, later); assert.throws(guard, IntentPurposeConflict); return interpretation;
  })), IntentPurposeConflict);
  assert.equal(f.store.lookup(f.scope, 'slow-edit')!.receipt, null);
  const withdrawn = await receive(f, 'slow-before-withdraw', { edit: { intentId: original.intentId, expectedVersion: 3 } });
  await assert.rejects(drive(f.host, f.publisher.interpretAndPublish(f.scope, withdrawn, async () => {
    const w = await drive(f.host, f.publisher.receive(f.scope, { contract: INTENT_V2, requestId: 'withdraw-during-interpretation',
      op: 'withdraw', edit: { intentId: original.intentId, expectedVersion: 3 } }));
    assert.ok(w.reservation.created); await drive(f.host, f.publisher.publish(f.scope, w.reservation)); return interpretation;
  })), IntentPurposeConflict);
});

test('pre-interpretation authority rejection prevents final publication and queued effects', async t => {
  const f = fixture(t), r = await receive(f, 'async-authority'); let authorized = true;
  const scope = { ...f.scope, currentAuthority: () => authorized };
  await assert.rejects(drive(f.host, f.publisher.interpretAndPublish(scope, r, async guard => {
    authorized = false;
    await assert.rejects(drive(f.host, f.host.enqueueChecked('deck', 'compiler-fixture', { soulId: 's_A', add: ['rest'] }, guard)), IntentRequestUnavailable);
    return interpretation;
  })), IntentRequestUnavailable);
  assert.equal(f.host.intentHistoryOf('s_A').lastSeq, 0); assert.equal(f.store.lookup(f.scope, r.request.requestId)!.receipt, null);
});

test('received origin and understood receipt use actual canonical queue envelopes and survive file restart without models', async t => {
  const f = fixture(t, true), seq = f.host.seq;
  const pending = f.publisher.receive(f.scope, { contract: INTENT_V2, requestId: 'request-A', op: 'upsert', words });
  const unrelated = f.host.enqueue('rules', 'fixture', { why: 'another accepted input' });
  const r = await drive(f.host, pending); assert.ok(r.reservation.created); await unrelated;
  assert.equal(r.request!.received!.seq, seq + 1); assert.equal(r.request!.receipt, null);
  assert.equal(f.host.intentHistoryOf('s_A').lastSeq, 0, 'received alone is not understanding');
  const result = await publish(f, r.reservation), receipt = result.receipt; assert.equal(receipt?.phase, 'understood');
  assert.equal(result.event.seq, seq + 3); if (receipt?.phase !== 'understood') assert.fail('missing understood receipt');
  assert.deepEqual(receipt.revision.submitted, { seq: result.event.seq, tick: result.event.tick });
  assert.equal(f.store.events(f.scope, 'request-A')!.length, 2);
  const history = f.host.intentHistoryOf('s_A'), physical = f.host.engine.physicalHash(), hash = kernelHash(f.host.kernel);
  assert.deepEqual(history.intents[receipt.revision.intentId].revision, receipt.revision);
  const events = f.db.events(f.scope.worldId).filter(e => e.kind === 'intent-v2').map(intentHistoryFactV2);
  assert.deepEqual(replayIntentHistoryV2(f.scope.worldId, 's_A', events), history);
  assert.equal(kernelHash(replayKernel(f.genesis, f.db.events(f.scope.worldId))), hash);
  assert.equal(f.restart(false).from, 'genesis'); assert.deepEqual(f.host.intentHistoryOf('s_A'), history);
  assert.equal(f.host.engine.physicalHash(), physical); assert.deepEqual(f.store.lookup(f.scope, 'request-A')!.receipt, receipt);
  assert.equal(f.restart(true).from, 'snapshot'); assert.deepEqual(f.host.intentHistoryOf('s_A'), history);
  assert.equal(f.db.paidCost(), 0);
});

test('independent purposes remain intact; exact edits race once, withdrawal rejects stale publication without consuming sequence', async t => {
  const f = fixture(t), first = await publish(f, await receive(f, 'first')), second = await publish(f, await receive(f, 'second', { strict: true }));
  if (first.receipt?.phase !== 'understood' || second.receipt?.phase !== 'understood') assert.fail('not published');
  const a = first.receipt.revision, b = second.receipt.revision;
  const editA = await receive(f, 'edit-A', { words: 'Edited private tea purpose', edit: { intentId: a.intentId, expectedVersion: 1 } });
  const editB = await receive(f, 'edit-B', { words: 'Conflicting private edit', edit: { intentId: a.intentId, expectedVersion: 1 } });
  const good = f.publisher.publish(f.scope, editA, interpretation), bad = f.publisher.publish(f.scope, editB, interpretation);
  const rejected = assert.rejects(bad, IntentPurposeConflict), seq = f.host.seq; f.host.drainInputs(); await good; await rejected;
  assert.equal(f.host.seq, seq + 1); assert.deepEqual(f.host.intentHistoryOf('s_A').intents[b.intentId].revision, b);
  const pendingOldEdit = await receive(f, 'edit-old', { edit: { intentId: a.intentId, expectedVersion: 2 } });
  const withdrawal = await drive(f.host, f.publisher.receive(f.scope, { contract: INTENT_V2, requestId: 'withdraw', op: 'withdraw', edit: { intentId: a.intentId, expectedVersion: 2 } }));
  assert.ok(withdrawal.reservation.created); await drive(f.host, f.publisher.publish(f.scope, withdrawal.reservation));
  // An older in-flight edit must not undo a later withdrawal. Only an explicit
  // new request received after withdrawal can restore the purpose as a revision.
  await assert.rejects(publish(f, pendingOldEdit), IntentPurposeConflict);
  await publish(f, await receive(f, 'restore-after-withdraw', { edit: { intentId: a.intentId, expectedVersion: 2 } }));
  assert.equal(f.host.intentHistoryOf('s_A').intents[a.intentId].revision.version, 3);
  const stale = await receive(f, 'stale', { edit: { intentId: a.intentId, expectedVersion: 2 } });
  await assert.rejects(drive(f.host, f.publisher.publish(f.scope, stale, interpretation)), IntentPurposeConflict);
  assert.equal(f.store.lookup(f.scope, 'stale')!.receipt, null);
  assert.equal(f.store.lookup(f.scope, 'withdraw')!.receipt?.phase, 'withdrawn');
  const duplicate = await drive(f.host, f.publisher.receive(f.scope, { contract: INTENT_V2, requestId: 'first', op: 'upsert', words }));
  assert.equal(duplicate.reservation.created, false); assert.equal('lease' in duplicate.reservation, false); assert.equal(duplicate.request!.receipt?.phase, 'understood');
});

test('authority loss while queued prevents received/publication; unrelated movement and purpose changes do not stale an exact edit', async t => {
  const f = fixture(t), original = await publish(f, await receive(f, 'original'));
  if (original.receipt?.phase !== 'understood') assert.fail('not published');
  const r = await receive(f, 'edit', { edit: { intentId: original.receipt.revision.intentId, expectedVersion: 1 } });
  const queued = f.publisher.publish(f.scope, r, interpretation); f.host.engine.world.entities.h_A.pose.p[0] += 0.1;
  f.host.minds.get('s_A')!.intentVersion++; // unrelated legacy will change, not this purpose.
  await drive(f.host, queued);
  const denied = f.publisher.receive(f.scope, { contract: INTENT_V2, requestId: 'denied', op: 'upsert', words });
  f.db.db.prepare('UPDATE users SET invited_by=NULL WHERE id=?').run('dev:owner');
  await assert.rejects(drive(f.host, denied), IntentRequestUnavailable); f.db.setInvited('dev:owner', 'fixture');
  assert.equal(f.store.lookup(f.scope, 'denied')!.received, null);
  const pending = await receive(f, 'retiring'); const seq = f.host.seq, publishing = f.publisher.publish(f.scope, pending, interpretation);
  f.db.retireSoul('s_A'); await assert.rejects(drive(f.host, publishing), IntentRequestUnavailable); assert.equal(f.host.seq, seq);
  assert.equal(f.store.lookup(f.scope, 'retiring'), null);
});

test('terminal writer failure rolls back its log/reference/receipt and leaves received intact, without application', async t => {
  const f = fixture(t), r = await receive(f, 'rollback'), seq = f.host.seq, before = f.host.intentHistoryOf('s_A');
  const publisher = new IntentPublisher(f.host, f.store); const real = publisher.store.publicationJournal.bind(publisher.store);
  publisher.store.publicationJournal = reservation => { const write = real(reservation); return event => { write(event); throw new Error('injected terminal write failure'); }; };
  const p = publisher.publish(f.scope, r, interpretation), rejection = assert.rejects(p, /terminal write failure/);
  const unrelated = f.host.enqueue('rules', 'fixture', { why: 'not lost' }); f.host.drainInputs(); await rejection; await unrelated;
  assert.equal(f.host.seq, seq + 1); assert.deepEqual(f.host.intentHistoryOf('s_A'), before);
  assert.equal(f.store.lookup(f.scope, 'rollback')!.receipt, null); assert.equal(f.store.lookup(f.scope, 'rollback')!.received?.phase, 'received');
  assert.equal(f.store.events(f.scope, 'rollback')!.length, 1); assert.deepEqual(f.db.events(f.scope.worldId, seq).map(e => e.kind), ['rules']);
});

test('received origin/reference and terminal source must verify; structural receipt forgery cannot commit a publication', async t => {
  const f = fixture(t), r = await receive(f, 'damaged'), original = f.store.lookup(f.scope, 'damaged')!.received!;
  f.db.db.prepare('UPDATE intent_requests_v2 SET received=?').run(JSON.stringify({ ...original, seq: 1 }));
  const seq = f.host.seq; await assert.rejects(drive(f.host, f.publisher.publish(f.scope, r, interpretation)), /origin failed verification/);
  assert.equal(f.host.seq, seq); assert.equal(f.host.intentHistoryOf('s_A').lastSeq, 0);
  assert.throws(() => f.store.lookup(f.scope, 'damaged'), /origin failed verification/);
  f.db.db.prepare('UPDATE intent_requests_v2 SET received=?').run(JSON.stringify(original));
  const forged = f.host.enqueueChecked('intent-v2', 'soul:s_A', { contract: INTENT_V2, worldId: f.scope.worldId, soulId: 's_A', op: 'withdraw',
    intent: { intentId: 'unpublished', version: 1 }, requestId: 'damaged', source: { ...f.scope.source, principalId: 'forged-source' } }, () => true, f.store.publicationJournal(r));
  const refused = assert.rejects(forged, /different words or settings/); f.host.drainInputs(); await refused;
  assert.equal(f.host.seq, seq); assert.equal(f.store.events(f.scope, 'damaged')!.length, 1);
  const good = await publish(f, r); if (good.receipt?.phase !== 'understood') assert.fail('missing terminal');
  f.db.db.prepare('UPDATE intent_requests_v2 SET receipt=?').run(JSON.stringify({ ...good.receipt, revision: { ...good.receipt.revision, words: 'forged private receipt' } }));
  assert.throws(() => f.store.lookup(f.scope, 'damaged'), /terminal receipt failed verification/);
});

test('migration10 preserves older pending/terminal rows and canonical history and reapplies only once', async t => {
  const f = fixture(t, true), r = f.store.reserve(f.scope, { contract: INTENT_V2, requestId: 'old-refused', op: 'upsert', words });
  assert.ok(r.created); const refusal = { contract: INTENT_V2, requestId: 'old-refused', phase: 'refused', code: 'unsupported', reason: 'Private old refusal' };
  f.store.finish(r, refusal);
  const events = f.db.events(f.scope.worldId), row = f.db.db.prepare('SELECT body,source,receipt,lease FROM intent_requests_v2').get();
  f.db.db.exec('ALTER TABLE intent_requests_v2 DROP COLUMN received; DELETE FROM schema_migrations WHERE id=10');
  f.restart(false); assert.deepEqual(f.db.migrated, [10]); assert.deepEqual(f.db.events(f.scope.worldId), events);
  assert.deepEqual(f.db.db.prepare('SELECT body,source,receipt,lease FROM intent_requests_v2').get(), row);
  assert.equal(f.store.lookup(f.scope, 'old-refused')!.received, null); assert.deepEqual(f.store.lookup(f.scope, 'old-refused')!.receipt, refusal);
  f.restart(false); assert.deepEqual(f.db.migrated, []);
});

test('actual filtered physical recovery retains private purposes and canonical receipts through both restart readers', async t => {
  const wrap = (engine: Engine) => {
    let armed = false; const perform = engine.perform.bind(engine), step = engine.step.bind(engine);
    engine.perform = program => { if (program.label === 'publication fault') armed = true; return perform(program); };
    engine.step = () => { if (armed) throw new Error('fixture physical failure'); return step(); }; return engine;
  };
  const factory = { ...toyFactory, create: world => wrap(toyFactory.create(world)), restore: snapshot => wrap(toyFactory.restore(snapshot)) } satisfies EngineFactory;
  const f = fixture(t, true, factory); f.host.saveSnapshot(true);
  const result = await publish(f, await receive(f, 'recovery-purpose')), history = f.host.intentHistoryOf('s_A');
  void f.host.enqueue('decision', 'soul:s_A', { soulId: 's_A', entityId: 'h_A', option: 'rest', card: 'rest', label: 'publication fault',
    steps: [{ verb: 'rest', params: { seconds: 1 } }], target: null, approachLen: 0, reevalTicks: 1200, trigger: 'fixture', fallback: true });
  f.host.tickOnce(); const recovery = f.db.events(f.scope.worldId).reverse().find(e => e.payload?.recovery)!;
  assert.ok(recovery); assert.ok(!recovery.payload.recovery.events.some((e: any) => e.kind === 'decision'));
  assert.ok(recovery.payload.recovery.events.some((e: any) => e.kind === 'intent-v2'));
  assert.deepEqual(f.host.intentHistoryOf('s_A'), history); assert.deepEqual(f.store.lookup(f.scope, 'recovery-purpose')!.receipt, result.receipt);
  assert.equal(f.store.events(f.scope, 'recovery-purpose')!.length, 2);
  assert.ok(!JSON.stringify(publicEvent(recovery)).includes(words));
  f.restart(false); assert.deepEqual(f.host.intentHistoryOf('s_A'), history); assert.deepEqual(f.store.lookup(f.scope, 'recovery-purpose')!.receipt, result.receipt);
  f.restart(true); assert.deepEqual(f.host.intentHistoryOf('s_A'), history);
});

test('named public HTTP/real WS handlers and takes exclude private publication; private snapshot/replay preserves it', async t => {
  const f = fixture(t), cfg = { ...config, brainMode: 'fake' as const, budgetUsdPerDay: 0, typesafeKey: undefined, anthropicKey: undefined, privyAppId: '', privyAppSecret: '', worldId: f.scope.worldId };
  const auth = new Auth(cfg, f.db); auth.devAuth = true;
  const server = createServer((_, res) => res.end('fixture')); const hub = new Hub(server, f.host, auth, f.db);
  const brain = new Brain(f.host, f.db, cfg, { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {} }); hub.brain = brain;
  const souls = new Souls(f.host, f.db, brain, cfg), app = buildApp({ cfg, db: f.db, host: f.host, auth, hub, brain, souls });
  await new Promise<void>(resolve => server.listen(4952, '127.0.0.1', resolve));
  const ws = new WebSocket('ws://127.0.0.1:4952/ws'); const messages: any[] = [];
  ws.on('message', data => messages.push(JSON.parse(String(data))));
  t.after(async () => { ws.terminate(); hub.wss.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await once(ws, 'open'); ws.send(JSON.stringify({ t: 'hello', proto: 1 }));
  await waitForSocketCondition(ws, () => messages.some(m => m.t === 'welcome'), 'welcome before publication');
  const result = await publish(f, await receive(f, 'PRIVATE_REQUEST'));
  assert.equal(result.receipt?.phase,'understood');
  const revision=result.receipt?.phase==='understood'?result.receipt.revision:null;assert.ok(revision);
  const decision=f.host.enqueueIntentDecision('brain:reflex',{soulId:'s_A',entityId:'h_A',option:'rest',label:'rest',steps:[{verb:'rest',params:{seconds:1}}],reevalTicks:1200,fallback:false,trigger:'new-intent-v2'},
    {intentId:revision.intentId,version:revision.version},()=>true);f.host.drainInputs();await decision;
  for (let i = 0; i < 65; i++) f.host.tickOnce();
  await waitForSocketCondition(ws, () => messages.some(m => m.t === 'batch' && m.log.some((e: any) => e.kind === 'intent-v2')), 'named public publication');
  assert.ok(messages.some(m => m.t === 'batch' && m.log.some((e: any) => e.kind === 'intent-v2')), 'real socket sees named public publication');
  assert.ok(messages.some(m => m.t === 'batch' && m.log.some((e: any) => e.kind === 'intent-admission-v2')), 'real socket sees named redacted admission');
  for (const path of ['/v1/log', '/v1/kernel', '/v1/world', '/v1/debug/world', '/v1/takes', '/v1/take']) {
    const response = await app.request(path); assert.equal(response.status, 200); messages.push(await response.json());
  }
  const serialized = JSON.stringify(messages);
  for (const marker of ['PRIVATE_OWNER_WORDS', 'PRIVATE_INTERPRETATION', 'PRIVATE_PRINCIPAL', 'PRIVATE_REQUEST', 'dev:owner',revision.intentId]) assert.ok(!serialized.includes(marker), `${marker} absent from public HTTP/WS/takes`);
  assert.ok(JSON.stringify(f.host.extra).includes(words)); assert.ok(!JSON.stringify(f.host.kernel).includes(words), 'private history is not card-readable kernel state');
  const detached = f.host.intentHistoryOf('s_A'); Object.values(detached.intents)[0].revision.words = 'mutated consumer';
  assert.ok(JSON.stringify(f.host.intentHistoryOf('s_A')).includes(words));
  assert.deepEqual(publicEvent(result.event).payload.privateUpdate, true);
  assert.equal((await app.request('/v1/souls/s_A/intent-v2', { method: 'POST' })).status, 404, 'V2 route remains inactive');
});

for (const phase of ['before-apply', 'after-apply']) test(`terminated worker ${phase} preserves understood fact/reference/receipt with no reissued lease`, async t => {
  const f = fixture(t, true); const worker = new Worker(new URL('../test/fixtures/intent-publication-worker.ts', import.meta.url), { workerData: { path: f.path, phase }, execArgv: [] });
  t.after(() => worker.terminate());
  const code = await new Promise<number>((resolve, reject) => { worker.once('error', reject); worker.once('exit', resolve); }); assert.equal(code, 19);
  assert.equal(f.restart(false).from, 'genesis');
  const lookup = f.store.lookup(f.scope, 'worker-publication')!; assert.equal(lookup.receipt?.phase, 'understood'); assert.equal(lookup.received?.phase, 'received');
  assert.equal(f.store.events(f.scope, 'worker-publication')!.length, 2); assert.equal(Object.keys(f.host.intentHistoryOf('s_A').intents).length, 1);
  assert.equal(f.store.reserve(f.scope, lookup.request).created, false); assert.equal(f.db.paidCost(), 0);
});
