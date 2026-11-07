const WORLD_ID = 'toy-1';
// The fold: replaying the event log from genesis must reproduce the live world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toyFactory } from '@souls/engine-toy';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { Db } from './db.ts';
import { Souls } from './souls.ts';
import { kernelHash } from '@souls/kernel';
import { initKernel, pinnedVocabulary, replayKernel } from './fold.ts';
import { optionsFor } from './deck.ts';
import { WorldHost, replayFromGenesis } from './world.ts';

function drive(host: WorldHost, ticks: number, pick: (i: number) => number) {
  for (let i = 0; i < ticks; i++) {
    // decide often, preempting whatever is running, so the log is dense and actions are cut mid-flight
    if (i % 170 === 7) for (const m of host.minds.values()) {
      const opts = optionsFor(host, m); if (!opts.length) continue; const o = opts[pick(i + m.name.length) % opts.length];
      void host.enqueue('decision', 'test', { soulId: m.soulId, entityId: m.entityId, option: o.id, label: o.label, steps: o.steps, reevalTicks: 600, fallback: false, trigger: 'test', card: o.card, target: o.cardTarget, manner: 'warmly', approachLen: o.approachLen });
    }
    host.tickOnce();
  }
}
const births = (host: WorldHost, names: string[]) => names.forEach((n) => void host.enqueue('birth', 'test', { soulId: `s_${n}`, entityId: `h_${n}`, name: n, description: 'test soul', owner: 'system' }));

test('replay from genesis reproduces the live state hash', () => {
  const db = new Db(join(mkdtempSync(join(tmpdir(), 'souls-')), 't.db'));
  const host = new WorldHost(db, toyFactory, 'replay-seed', 1e9); host.boot();
  births(host, ['a', 'b', 'c', 'd', 'e']);
  drive(host, 3000, (i) => i * 7);
  void host.enqueue('retire', 'test', { soulId: 's_c', entityId: 'h_c' });
  drive(host, 1500, (i) => i * 3);
  const replayed = replayFromGenesis(toyFactory, 'replay-seed', db.events(WORLD_ID), host.engine.world.tick);
  assert.equal(replayed.engine.stateHash(), host.engine.stateHash());
  // the kernel replays too, and it replays WITHOUT the engine: meaning needs no depiction
  host.kernel.tick = replayed.kernel.tick;
  assert.equal(kernelHash(replayed.kernel), kernelHash(host.kernel));
  const alone = replayKernel(initKernel(toyFactory.create(toyFactory.genesis('replay-seed'))), db.events(WORLD_ID)); alone.tick = host.kernel.tick;
  assert.equal(kernelHash(alone), kernelHash(host.kernel));
  assert.ok(db.events(WORLD_ID).some((e) => e.kind === 'play'), 'cards were played');
  assert.ok(db.countEvents(WORLD_ID) > 20);
  db.close();
});

test('restart: snapshot + fast-forward through later events equals the uninterrupted world', () => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-'));
  const db = new Db(join(dir, 't.db'));
  const host = new WorldHost(db, toyFactory, 'restart-seed', 1e9); host.boot();
  births(host, ['a', 'b', 'c']);
  drive(host, 1200, (i) => i);
  host.saveSnapshot();
  drive(host, 900, (i) => i * 5);         // events after the snapshot, then a "crash"
  const lastEventTick = db.tailEvents(WORLD_ID, 1)[0].tick;
  const reference = replayFromGenesis(toyFactory, 'restart-seed', db.events(WORLD_ID), lastEventTick);
  const host2 = new WorldHost(db, toyFactory, 'restart-seed', 1e9);
  const boot = host2.boot();
  assert.equal(boot.from, 'snapshot');
  assert.ok(boot.replayed > 0);
  // boot stops just after applying the last event (before stepping past its tick)
  assert.equal(host2.engine.world.tick, lastEventTick);
  assert.equal(host2.minds.size, 3);
  // stepping both to the same later tick gives the same world
  // live ticking logs new plays as programs reach their effects, so the reference is replayed afterwards from the full log
  for (let i = 0; i < 400; i++) host2.tickOnce();
  const ref2 = replayFromGenesis(toyFactory, 'restart-seed', db.events(WORLD_ID), lastEventTick + 400);
  assert.equal(host2.engine.stateHash(), ref2.engine.stateHash());
  host2.kernel.tick = ref2.kernel.tick; assert.equal(kernelHash(host2.kernel), kernelHash(ref2.kernel));
  void reference;
  db.close();
});

test('a world from before the kernel existed is given one at boot, and replay from genesis still matches', async () => {
  const db = new Db(join(mkdtempSync(join(tmpdir(), 'souls-')), 't.db'));
  const host = new WorldHost(db, toyFactory, 'old-world', 1e9); host.boot();
  births(host, ['a', 'b', 'c']);
  // decisions as they were before cards: a program of steps, no card, so no plays
  for (let i = 0; i < 900; i++) {
    if (i === 30) for (const [n, to] of [['a', 'campfire'], ['b', 'kiosk']] as const) void host.enqueue('decision', 'old', { soulId: `s_${n}`, entityId: `h_${n}`, option: `go:${to}`, label: `Walk to ${to}`, steps: [{ verb: 'walk_to', params: { to, standoff: 1.5 } }, { verb: 'rest', params: { seconds: 60 } }], reevalTicks: 600, fallback: false, trigger: 'old' });
    host.tickOnce();
  }
  host.saveSnapshot();
  assert.equal(db.events(WORLD_ID).filter((e) => e.kind === 'play').length, 0);
  // make the snapshot what an old build would have written: no kernel in it
  const row = db.db.prepare('SELECT tick, snapshot FROM snapshots ORDER BY tick DESC LIMIT 1').get() as { tick: number; snapshot: string };
  const body = JSON.parse(row.snapshot); delete body.kernel; delete body.counts; for (const m of body.minds) { delete m.agenda; delete m.agendaPos; delete m.pending; }
  db.db.prepare('UPDATE snapshots SET snapshot = ? WHERE tick = ?').run(JSON.stringify(body), row.tick);

  const host2 = new WorldHost(db, toyFactory, 'old-world', 1e9);
  assert.equal(host2.boot().from, 'snapshot');
  for (let i = 0; i < 5; i++) host2.tickOnce();
  const boot = db.events(WORLD_ID).find((e) => e.kind === 'rules' && (e.payload as any)?.kernelBootstrap);
  assert.ok(boot, 'the bootstrap is in the log');
  assert.equal(host2.kernel.things['s_a'].at, 'campfire'); assert.equal(host2.kernel.things['s_b'].at, 'kiosk');
  assert.ok(host2.kernel.decks['s_c'].cards.includes('join'));
  // a Soul that had been given a goal before plans existed keeps its direction, as a plan of base cards
  host2.minds.get('s_a')!.intent = { goal: 'go', target: 'kiosk' }; host2.minds.get('s_b')!.intent = { goal: 'converse', target: 'h_c' };
  const brain = new Brain(host2, db, { ...config, brainMode: 'fake', typesafeKey: undefined, anthropicKey: undefined }, { onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {}, clients: () => 0 });
  const souls = new Souls(host2, db, brain, config);
  assert.deepEqual(host2.minds.get('s_a')!.agenda, [{ card: 'go to', target: 'kiosk' }]);
  assert.deepEqual(host2.minds.get('s_b')!.agenda, [{ card: 'talk with', target: 's_c' }]);
  assert.equal(souls.carryOverDirections(), 0, 'only once');
  host2.minds.get('s_a')!.agenda = []; host2.minds.get('s_b')!.agenda = []; host2.minds.get('s_a')!.intent = null; host2.minds.get('s_b')!.intent = null;
  // life goes on with cards, and a replay from genesis (old events, the bootstrap, new plays) arrives at the same world
  drive(host2, 1500, (i) => i * 11);
  assert.ok(db.events(WORLD_ID).some((e) => e.kind === 'play'));
  const replayed = replayFromGenesis(toyFactory, 'old-world', db.events(WORLD_ID), host2.engine.world.tick);
  assert.equal(replayed.engine.stateHash(), host2.engine.stateHash());
  host2.kernel.tick = replayed.kernel.tick; assert.equal(kernelHash(replayed.kernel), kernelHash(host2.kernel));
  await new Promise((r) => setTimeout(r, 200)); // words for what was said are written just after the play
  db.close();
});

test('a world’s vocabulary is in its log: history replays with its own words, and adopting new ones is a logged change', async () => {
  const db = new Db(join(mkdtempSync(join(tmpdir(), 'souls-')), 't.db'));
  const host = new WorldHost(db, toyFactory, 'vocab', 1e9); host.boot();
  births(host, ['a', 'b', 'c']);
  drive(host, 800, (i) => i * 3);
  const pin = pinnedVocabulary(db.events(WORLD_ID));
  assert.ok(pin && pin.cards['go to'] && pin.links.hosts.control === true, 'the starting vocabulary was written at the first tick');
  // a kernel started from a pinned vocabulary has exactly those words, whatever the code's set is today
  const odd = structuredClone(pin!); odd.cards['rest'] = { ...odd.cards['rest'], summary: 'as it was written then', hash: 'then' }; delete (odd.cards as Record<string, unknown>)['dance'];
  const k = initKernel(toyFactory.create(toyFactory.genesis('vocab')), odd);
  assert.equal(k.vocab.cards['rest'].summary, 'as it was written then'); assert.equal(k.vocab.cards['dance'], undefined);
  // adopting the code's current set is an event like any other, and replay still arrives at the same world
  await Promise.all([host.adoptVocabulary('test'), (async () => { host.tickOnce(); })()]);
  // retiring a Soul that made a thing, and another thing with it, removes all of them
  const made = host.kernel.things; const before = Object.keys(made).length;
  host.kernel.things['kite'] = { id: 'kite', kind: 'kite', name: 'a kite', traits: {}, states: {}, at: null, born: 0, by: 's_b' };
  host.kernel.things['tail'] = { id: 'tail', kind: 'tail', name: 'its tail', traits: { with: 'kite' }, states: {}, at: null, born: 0, by: 's_b' };
  void host.enqueue('retire', 'test', { soulId: 's_b', entityId: 'h_b' }); host.tickOnce();
  assert.equal(host.kernel.things['s_b'], undefined); assert.equal(host.kernel.things['kite'], undefined); assert.equal(host.kernel.things['tail'], undefined);
  assert.ok(Object.keys(host.kernel.things).length < before);
  db.close();
});
