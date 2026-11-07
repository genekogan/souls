import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { toyFactory } from '@souls/engine-toy';
import { kernelHash } from '@souls/kernel';
import { type CompileOut, type callTool } from '@souls/brain';
import { Db } from './db.ts';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { WorldHost, replayKernel, type AcceptanceGuard } from './world.ts';
import { captureCompilationFence, StaleCompilation } from './compile-fence.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function fixture(t: TestContext, out?: Promise<CompileOut>) {
  const db = new Db(':memory:'); t.after(() => db.close());
  for (const [id, role] of [['owner', 'user'], ['operator', 'admin']] as const)
    db.upsertUser({ id, role, email: null, wallet: null });
  db.setInvited('owner', 'fixture');
  const host = new WorldHost(db, toyFactory, 'fence-fixture', 1e9); host.boot();
  const genesis = structuredClone(host.kernel);
  db.createSoul({ id: 's_A', entityId: 'h_A', worldId: host.worldId, owner: 'owner', name: 'Alice', description: 'curious', native: false });
  void host.enqueue('birth', 'fixture', { soulId: 's_A', entityId: 'h_A', owner: 'owner', name: 'Alice', description: 'curious' });
  host.drainInputs();
  const mind = host.minds.get('s_A')!;
  let calls = 0;
  const compilerCall: typeof callTool = async <T>() => {
    calls++;
    return { out: await out as T, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, request: null, raw: { fixture: true } };
  };
  // Only the compiler transport is synthetic. The real compile, validation,
  // mint, sequencer, SQLite, fold and replay execute. No provider is called.
  const brain = new Brain(host, db, { ...config, brainMode: 'fake', typesafeKey: undefined,
    anthropicKey: 'synthetic-compiler-fixture', compilerModel: 'synthetic-compiler-fixture', budgetUsdPerDay: 0.5 },
    { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {} }, { compilerCall });
  brain.mode = 'live'; // Jev remains fake; no timer-driven model work runs.
  const ownerFence = () => captureCompilationFence(host, db, mind, row => {
    const u = db.user('owner'); return !!u && row.owner === u.id && !!u.invited_by;
  });
  return { db, host, mind, brain, ownerFence, genesis, get calls() { return calls; } };
}
function output(names = ['guarded rest']): CompileOut {
  return { understood: true, agenda: names.map(card => ({ card, target: null })),
    new_cards: names.map(name => ({ name, summary: 'Rest for a short while', target: null, when: [],
      then: [{ set: ['$actor', 'doing', 'resting'] }], approach: [], during: [{ verb: 'rest', params: { seconds: 1 } }], takes: 'seconds' })) };
}
async function finish<T>(host: WorldHost, promise: Promise<T>) {
  let settled = false; promise.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 20 && !settled; i++) { await setImmediate(); host.drainInputs(); }
  assert.ok(settled, 'operation settled through the actual sequencer'); return promise;
}
function staleResult(result: Awaited<ReturnType<Brain['compile']>>) {
  assert.deepEqual(result, { ok: false, reason: 'Request became stale; earlier accepted effects may remain' });
}

test('ordinary immediate compiler alignment is versioned; legacy alignment still requires explicit NOW',async t=>{
  const out:CompileOut={understood:true,agenda:[{card:'rest',target:null}],alignment:{understanding:'Rest here.',trigger:{kind:'now'}}};
  const legacy=fixture(t,Promise.resolve(structuredClone(out)));
  const old=await finish(legacy.host,legacy.brain.compile(legacy.mind,'rest here',true,legacy.ownerFence()));
  assert.ok(old && !old.ok);assert.match(old.reason,/explicit immediate/);
  const versioned=fixture(t,Promise.resolve(structuredClone(out)));
  const next=await finish(versioned.host,versioned.brain.compile(versioned.mind,'rest here','intent-v2',versioned.ownerFence()));
  assert.ok(next?.ok);assert.equal(next.alignment?.trigger.kind,'now');
  assert.equal(legacy.db.paidCost()+versioned.db.paidCost(),0);
});

test('a refused checked input consumes no sequence, effect, broadcast or recovery and does not lose other inputs', async t => {
  const f = fixture(t), seq = f.host.seq, before = kernelHash(f.host.kernel), applied: number[] = [];
  f.host.listeners.push({ onApplied: e => applied.push(e.seq) });
  const denied = f.host.enqueueChecked('intent', 'fixture', { soulId: 's_A', intent: { goal: 'rest', target: null } }, () => { throw new StaleCompilation(); });
  const rejection = assert.rejects(denied, StaleCompilation);
  const accepted = f.host.enqueue('rules', 'fixture', { why: 'unrelated accepted request' });
  f.host.drainInputs(); await rejection;
  assert.equal((await accepted).seq, seq + 1); assert.equal(f.host.seq, seq + 1);
  assert.deepEqual(applied, [seq + 1]); assert.equal(kernelHash(f.host.kernel), before);
  assert.equal(f.mind.intentVersion, 0);
  assert.deepEqual(f.db.events(f.host.worldId, seq).map(e => e.kind), ['rules']);
});

test('fence binds current Soul, actor, will and authority without binding ordinary motion', async t => {
  const changes: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ['retired', f => f.db.retireSoul('s_A')],
    ['owner changed', f => f.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('operator', 's_A')],
    ['world changed', f => { f.db.createWorld({ id: 'other', schema: 'fixture', rules_version: toyFactory.rulesVersion, dt: 0.05, seed: 'other' }); f.db.db.prepare('UPDATE souls SET world_id=? WHERE id=?').run('other', 's_A'); }],
    ['entity changed', f => f.db.db.prepare('UPDATE souls SET entity_id=? WHERE id=?').run('h_other', 's_A')],
    ['will changed', f => { f.mind.intentVersion++; }],
    ['mind replaced', f => f.host.minds.set('s_A', structuredClone(f.mind))],
    ['body removed', f => { delete f.host.engine.world.entities.h_A; }],
    ['body binding changed', f => { f.host.kernel.things.s_A.traits.body = 'h_other'; }],
    ['invitation revoked', f => f.db.db.prepare('UPDATE users SET invited_by=NULL WHERE id=?').run('owner')],
    ['principal removed', f => f.db.db.prepare('DELETE FROM users WHERE id=?').run('owner')],
  ];
  for (const [name, change] of changes) await t.test(name, sub => {
    const f = fixture(sub), guard = f.ownerFence();
    f.host.engine.world.entities.h_A.pose.p[0] += 0.1; f.host.tickOnce();
    assert.equal(guard(), true, 'ordinary progress remains allowed');
    change(f); assert.throws(guard, StaleCompilation);
  });
  await t.test('admin policy and exact agent generation are evaluated now', sub => {
    const f = fixture(sub);
    const admin = captureCompilationFence(f.host, f.db, f.mind, () => f.db.user('operator')?.role === 'admin');
    f.db.upsertUser({ id: 'operator', role: 'user', email: null, wallet: null }); assert.throws(admin, StaleCompilation);
    f.db.setSoulToken('s_A', 'synthetic-generation-one');
    const agent = captureCompilationFence(f.host, f.db, f.mind, row => row.token_hash === 'synthetic-generation-one');
    f.db.setSoulToken('s_A', 'synthetic-generation-two'); assert.throws(agent, StaleCompilation);
    assert.equal(captureCompilationFence(f.host, f.db, f.mind, row => row.token_hash === 'synthetic-generation-two')(), true);
  });
});

test('a delayed real compile refuses stale authority/version before any mint; initial stale requests make no compiler call', async t => {
  for (const [name, change] of [
    ['owner transfer', (f: ReturnType<typeof fixture>) => f.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('operator', 's_A')],
    ['newer will', (f: ReturnType<typeof fixture>) => { f.mind.intentVersion++; }],
    ['invitation revoked', (f: ReturnType<typeof fixture>) => f.db.db.prepare('UPDATE users SET invited_by=NULL WHERE id=?').run('owner')],
  ] as const) await t.test(name, async sub => {
    const reply = deferred<CompileOut>(), f = fixture(sub, reply.promise), seq = f.host.seq, before = kernelHash(f.host.kernel);
    const guard = f.ownerFence(), compiled = f.brain.compile(f.mind, 'PRIVATE_GUARDED_REQUEST', false, guard);
    assert.equal(f.calls, 1); change(f); reply.resolve(output()); staleResult(await compiled);
    f.host.drainInputs(); assert.equal(f.host.seq, seq); assert.equal(kernelHash(f.host.kernel), before);
    assert.equal(f.db.paidCost(), 0); assert.equal(f.db.brainToday().cost, 0);
    assert.equal(f.db.events(f.host.worldId, seq).length, 0);
  });
  await t.test('stale at dispatch', async sub => {
    const f = fixture(sub, Promise.resolve(output())), guard = f.ownerFence();
    f.mind.intentVersion++; staleResult(await f.brain.compile(f.mind, 'rest', false, guard)); assert.equal(f.calls, 0);
  });
});

test('sequencer rechecks a mint after model validation, including an earlier same-tick intent', async t => {
  const f = fixture(t, Promise.resolve(output())), seq = f.host.seq, guard = f.ownerFence();
  const intent = f.host.enqueue('intent', 'fixture', { soulId: 's_A', intent: { goal: 'rest', target: null } });
  const compiled = f.brain.compile(f.mind, 'rest', false, guard);
  await setImmediate(); // response validated; mint waits behind the earlier intent
  f.host.drainInputs(); await intent; staleResult(await compiled);
  assert.equal(f.host.kernel.vocab.cards['guarded rest'], undefined);
  assert.equal(f.host.seq, seq + 1); assert.equal(f.mind.intentVersion, 1);
  assert.deepEqual(f.db.events(f.host.worldId, seq).map(e => e.kind), ['intent']);
});

test('existing-card deals also refuse authority lost while queued', async t => {
  const f = fixture(t, Promise.resolve({ understood: true, agenda: [{ card: 'rest', target: null }] }));
  void f.host.enqueue('deck', 'fixture', { soulId: 's_A', remove: ['rest'], why: 'fixture' }); f.host.drainInputs();
  const seq = f.host.seq, compiled = f.brain.compile(f.mind, 'rest', false, f.ownerFence());
  await setImmediate(); f.db.retireSoul('s_A'); f.host.drainInputs(); staleResult(await compiled);
  assert.equal(f.host.seq, seq); assert.ok(!f.host.kernel.decks.s_A.cards.includes('rest'));
});

test('multi-card compilation retains accepted facts and refuses later effects after revocation; it is not atomic', async t => {
  const f = fixture(t, Promise.resolve(output(['first rest', 'second rest']))), seq = f.host.seq;
  const compiled = f.brain.compile(f.mind, 'rest', false, f.ownerFence());
  await setImmediate(); f.host.drainInputs(); // first mint accepted under current authority
  await setImmediate(); f.db.retireSoul('s_A'); f.host.drainInputs(); staleResult(await compiled);
  assert.ok(f.host.kernel.vocab.cards['first rest']); assert.equal(f.host.kernel.vocab.cards['second rest'], undefined);
  assert.equal(f.host.seq, seq + 1); assert.deepEqual(f.db.events(f.host.worldId, seq).map(e => e.payload.card.name), ['first rest']);
});

test('accepted guarded events replay and snapshot-restore without consulting later revoked authority or a model', async t => {
  const f = fixture(t, Promise.resolve(output())), compiled = await finish(f.host, f.brain.compile(f.mind, 'rest', false, f.ownerFence()));
  assert.ok(compiled?.ok); assert.equal(f.host.kernel.vocab.cards['guarded rest'].hash, compiled.minted[0].hash);
  f.db.retireSoul('s_A'); // current access gone; historical accepted facts remain
  const seq = f.host.seq, hash = kernelHash(f.host.kernel), physical = f.host.engine.physicalHash();
  assert.equal(kernelHash(replayKernel(f.genesis, f.db.events(f.host.worldId))), hash);
  const fromLog = new WorldHost(f.db, toyFactory, 'fence-fixture', 1e9); assert.equal(fromLog.boot().from, 'genesis');
  assert.equal(kernelHash(fromLog.kernel), hash); assert.equal(fromLog.engine.physicalHash(), physical); assert.equal(fromLog.seq, seq);
  f.host.saveSnapshot(true);
  const fromSnapshot = new WorldHost(f.db, toyFactory, 'fence-fixture', 1e9); assert.equal(fromSnapshot.boot().from, 'snapshot');
  assert.equal(kernelHash(fromSnapshot.kernel), hash); assert.equal(fromSnapshot.engine.physicalHash(), physical); assert.equal(fromSnapshot.seq, seq);
  assert.equal(f.calls, 1); assert.equal(f.db.paidCost(), 0);
});

test('checked inputs refuse an asynchronous guard instead of treating a Promise as authority', async t => {
  const f = fixture(t), seq = f.host.seq;
  const invalid = (() => Promise.resolve(true)) as unknown as AcceptanceGuard;
  const p = f.host.enqueueChecked('rules', 'fixture', {}, invalid), refusal = assert.rejects(p, /synchronously/);
  f.host.drainInputs(); await refusal; assert.equal(f.host.seq, seq);
});
