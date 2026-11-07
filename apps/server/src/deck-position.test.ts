// Actual native anchor/perception boundary; no compiler/provider or forced motion.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory, EDEN_SAFE_COMMONS_WORLD} from '@souls/engine-mars';
import {kernelHash, whyNot} from '@souls/kernel';
import {Db} from './db.ts';
import {WorldHost} from './world.ts';
import {distance, distanceWord, engineRef, optionsFor, positionOf, resolveParams} from './deck.ts';

const factory = await marsFactory(EDEN_SAFE_COMMONS_WORLD);
function fixture(t: TestContext) {
  const db = new Db(':memory:'); t.after(() => db.close());
  db.upsertUser({id: 'dev:anchor-owner', role: 'user', email: null, wallet: null});
  const host = new WorldHost(db, factory, 'region-positions', 1e9, 'region-positions'); host.boot();
  db.createSoul({id: 's_A', entityId: 'h_A', worldId: host.worldId, owner: 'dev:anchor-owner', name: 'Alice', description: 'local fixture', native: false});
  void host.enqueue('birth', 'fixture', {soulId: 's_A', entityId: 'h_A', owner: 'dev:anchor-owner', name: 'Alice', description: 'local fixture'}); host.drainInputs();
  return {db, host, mind: host.minds.get('s_A')!};
}

test('native region positions use current adapter anchors while traversal retains region identity', t => {
  const {host, db, mind} = fixture(t), before = {engine: host.engine.stateHash(), kernel: kernelHash(host.kernel), seq: host.seq};
  const regionAnchors = host.engine.anchors().filter(a => host.engine.world.regions[a.id] && !host.engine.world.entities[a.id]);
  assert.ok(regionAnchors.length > 0);
  for (const a of regionAnchors) {
    assert.equal(engineRef(host, a.id), a.id); assert.deepEqual(positionOf(host, a.id), a.point);
    const p = positionOf(host, a.id)!; p[0] += 100; assert.deepEqual(positionOf(host, a.id), a.point, 'detached coordinates');
    assert.deepEqual(resolveParams(host, {to: '$target', x: '$target.x', z: '$target.z'}, {target: a.id}), {to: a.id, x: a.point![0], z: a.point![1]});
  }
  for (const a of host.engine.anchors().filter(a => a.entity)) {
    const e = host.engine.world.entities[a.entity!]!;
    assert.deepEqual(positionOf(host, a.id), [e.pose.p[0], e.pose.p[2]], 'fixtures retain live entity pose');
  }
  const body = host.engine.world.entities.h_A;
  assert.deepEqual(positionOf(host, 's_A'), [body.pose.p[0], body.pose.p[2]]);
  mind.agenda = [{card: 'go to', target: 'commons-deck'}]; mind.agendaPos = 0;
  const option = optionsFor(host, mind).find(o => o.card === 'go to' && o.cardTarget === 'commons-deck');
  assert.ok(option, 'actual regional destination remains a serving candidate');
  assert.ok(option.servesIntent);
  assert.ok(option.label.includes(`(${distanceWord(distance(host, 's_A', 'commons-deck'))}`), 'native option label uses physical distance');
  assert.equal(option.steps[0].params.to, 'commons-deck', 'native lowering still receives the region ID');
  assert.deepEqual({engine: host.engine.stateHash(), kernel: kernelHash(host.kernel), seq: host.seq}, before);
  assert.equal(db.paidCost(), 0);
});

test('commons membership does not imply arrival at its anchor or fulfil an owner direction', t => {
  const {host, mind, db} = fixture(t), anchor = host.engine.anchors().find(a => a.id === 'commons')!;
  assert.equal(host.kernel.things.s_A.at, 'commons');
  const actor = positionOf(host, 's_A')!;
  const expected = Math.hypot(actor[0] - anchor.point![0], actor[1] - anchor.point![1]);
  assert.ok(expected > 1.2, 'actual birth lies outside go-to standoff');
  assert.equal(distance(host, 's_A', 'commons'), expected); assert.notEqual(distanceWord(expected), 'far');
  assert.ok(whyNot(host.kernel, host.kernel.vocab.cards['go to'], 's_A', 'commons'), 'existing membership guard remains');
  const before = host.engine.stateHash(); mind.agenda = [{card: 'go to', target: 'commons'}]; mind.agendaPos = 0;
  const options = optionsFor(host, mind);
  assert.ok(!options.some(o => o.card === 'go to' && o.cardTarget === 'commons'), 'no bypass of pinned card rules');
  assert.equal(host.engine.stateHash(), before); assert.deepEqual(host.intentHistoryOf('s_A').attempts, {});
  assert.equal(db.events(host.worldId).filter(e => e.kind === 'intent-controller-v2').length, 0); assert.equal(db.paidCost(), 0);
});

test('missing or invalid physical anchors do not fabricate a region position', t => {
  const {host} = fixture(t);
  t.mock.method(host.engine, 'anchors', () => []);
  assert.equal(positionOf(host, 'commons'), null); assert.equal(distance(host, 's_A', 'commons'), 1e6);
  t.mock.method(host.engine, 'anchors', () => [{id: 'commons', kind: 'place', name: 'commons', point: [NaN, 1]}]);
  assert.equal(positionOf(host, 'commons'), null); assert.equal(positionOf(host, 'unrecognized'), null);
});
