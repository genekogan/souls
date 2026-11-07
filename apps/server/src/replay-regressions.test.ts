import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toyFactory } from '@souls/engine-toy';
import { marsFactory } from '@souls/engine-mars';
import { BASE_DECK, BASE_MANNERS, cardHash, kernelHash } from '@souls/kernel';
import { Db } from './db.ts';
import { WorldHost, replayFromGenesis } from './world.ts';
import { optionsFor, frontier } from './deck.ts';
import { Brain } from './brain.ts';
import { config } from './config.ts';

function start(seed: string, factory = toyFactory) {
  const db = new Db(join(mkdtempSync(join(tmpdir(), 'souls-regression-')), 'test.db'));
  const host = new WorldHost(db, factory, seed, 1e9); host.boot();
  for (const name of ['A', 'B', 'C']) void host.enqueue('birth', 'test', { soulId: `s_${name}`, entityId: `h_${name}`, name, description: 'test', owner: 'test-owner' });
  host.tickOnce();
  return { db, host };
}
const tickTo = (host: WorldHost, tick: number) => { while (host.engine.world.tick < tick) host.tickOnce(); };
function play(host: WorldHost, soulId: string, card: string, target: string | null) { void host.enqueue('play', 'test', { soulId, card, hash: host.kernel.vocab.cards[card].hash, target }); }
function mint(host: WorldHost, card: any, soulId: string) { void host.enqueue('mint', 'test', { card: { ...card, hash: cardHash(card), by: soulId, mintedAt: host.engine.world.tick, origin: 'agent' }, forSoul: soulId }); }

test('expired derived-role links bind identically in live and replay (F1)', () => {
  const { db, host } = start('expired');
  mint(host, { name: 'answer', summary: 'answer whoever spoke', target: null, derive: { who: { link: 'said', to: '$actor' } }, when: [], then: [{ link: ['knows', '$actor', '$who'] }], approach: [], during: [], takes: 'seconds' }, 's_C');
  tickTo(host, 100); play(host, 's_A', 'greet', 's_C');
  tickTo(host, 2000); play(host, 's_B', 'greet', 's_C');
  tickTo(host, 2900); play(host, 's_A', 'greet', 's_C');
  tickTo(host, 3000); play(host, 's_C', 'answer', null); tickTo(host, 3010);
  const replay = replayFromGenesis(toyFactory, 'expired', db.events(host.worldId), host.engine.world.tick);
  assert.equal(kernelHash(replay.kernel), kernelHash(host.kernel)); db.close();
});

test('birth uses pinned vocabulary despite a changed code deck and manners (F2)', () => {
  const { db, host } = start('pinned');
  const deck = [...BASE_DECK], manners = { ...BASE_MANNERS };
  try {
    BASE_DECK.splice(BASE_DECK.indexOf('perform'), 1); BASE_MANNERS.zestfully = { summary: 'new' };
    const replay = replayFromGenesis(toyFactory, 'pinned', db.events(host.worldId), host.engine.world.tick);
    assert.equal(kernelHash(replay.kernel), kernelHash(host.kernel));
  } finally { BASE_DECK.splice(0, BASE_DECK.length, ...deck); delete BASE_MANNERS.zestfully; Object.assign(BASE_MANNERS, manners); db.close(); }
});

test('checkpoint logs queued completed effects before capturing minds (F3)', () => {
  const { db, host } = start('shutdown');
  void host.enqueue('decision', 'test', { soulId: 's_A', entityId: 'h_A', option: 'rest', label: 'rest', steps: [{ verb: 'rest', params: { seconds: 90 } }], reevalTicks: 1e9, fallback: false, trigger: 'test', card: 'rest', target: null, approachLen: 0 });
  host.tickOnce(); host.saveSnapshot();
  assert.equal(db.events(host.worldId).filter(e => e.kind === 'play').length, 1);
  const next = new WorldHost(db, toyFactory, 'shutdown', 1e9); assert.equal(next.boot().from, 'snapshot');
  tickTo(next, 2400); assert.equal(next.counts.rest, 1); assert.equal(next.kernel.things.s_A.states.doing, 'resting'); db.close();
});

test('look-ahead cannot mutate a created Thing or the card constants (F6)', () => {
  const { db, host } = start('lookahead');
  const card = { name: 'make gathering', summary: 'make a gathering', target: null, when: [], then: [{ appear: { kind: 'gathering', name: 'a meeting', at: '$actor.at', states: { music: 'off' } }, linkFromActor: 'made' }, { set: ['$new', 'maker', '$actor.name'] }], approach: [], during: [], takes: 'seconds' };
  mint(host, card, 's_A'); host.tickOnce();
  void host.enqueue('deck', 'test', { soulId: 's_B', add: [card.name] }); play(host, 's_A', card.name, null); host.tickOnce();
  const before = kernelHash(host.kernel), library = JSON.stringify(host.kernel.vocab.cards[card.name]);
  const b = host.minds.get('s_B')!; b.agenda = [{ card: 'dance' }]; optionsFor(host, b);
  assert.equal(kernelHash(host.kernel), before); assert.equal(JSON.stringify(host.kernel.vocab.cards[card.name]), library); db.close();
});

test('a vanished target still advances its of-bound step; later playable steps remain allowed (F8/F9)', () => {
  const { db, host } = start('vanish');
  play(host, 's_A', 'host a gathering', 'campfire'); host.tickOnce();
  const gathering = Object.values(host.kernel.things).find(t => t.kind === 'gathering')!;
  const m = host.minds.get('s_A')!; m.agenda = [{ card: 'end the gathering', of: m.soulId }, { card: 'rest' }];
  play(host, m.soulId, 'end the gathering', gathering.id); host.tickOnce(); assert.equal(m.agendaPos, 1);
  m.agenda = [{ card: 'dance', target: 'absent' }, { card: 'rest' }]; m.agendaPos = 0;
  assert.equal(frontier(host, m), 1); db.close();
});

test('Mars target disappearing during approach gets cooldown; refused replacement stops old motion (F4/F7)', async () => {
  const factory = await marsFactory(), { db, host } = start('approach', factory);
  void host.enqueue('decision', 'test', { soulId: 's_A', entityId: 'h_A', option: 'talk with@s_B', label: 'approach B', steps: [{ verb: 'rest', params: { seconds: 0.5 } }, { verb: 'walk_to', params: { to: 'h_B' } }], reevalTicks: 1e9, card: 'talk with', target: 's_B', approachLen: 2 });
  host.tickOnce(); void host.enqueue('retire', 'test', { soulId: 's_B', entityId: 'h_B' }); tickTo(host, 100);
  assert.equal(host.minds.get('s_A')!.avoid?.id, 'talk with@s_B');
  host.engine.perform({ actor: 'h_A', label: 'walk', steps: [{ verb: 'walk_to', params: { to: [-10, -4] } }] });
  host.tickOnce(); assert.ok(host.engine.programOf('h_A'));
  const refused = host.engine.perform({ actor: 'h_A', label: 'bad replacement', steps: [{ verb: 'walk_to', params: { to: [400, 400] } }] });
  assert.equal(refused.ok, false); assert.equal(host.engine.programOf('h_A'), null); db.close();
});

test('an repeatedly refused step ends after the ordinary blocked timeout (F5)', async () => {
  const { db, host } = start('blocked');
  const m = host.minds.get('s_A')!;
  m.agenda = [{ card: 'perform' }]; m.planBlockedSince = 0; m.avoid = { id: 'perform', untilTick: 1e9 };
  tickTo(host, 12002);
  const brain = new Brain(host, db, { ...config, brainMode: 'fake', typesafeKey: undefined, anthropicKey: undefined }, { onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {}, clients: () => 0 });
  await brain.evaluate(m, 'activity-failed'); assert.equal(m.agendaPos, 1); host.drainInputs(); db.close();
});
