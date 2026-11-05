// F1 (#372): "turn to face X" names X, not "face X". A second attention verb after the first is dropped, the id forms
// (turn:<x>, turn-to:<x>, look-at:<x>) are the same attention intent, and a refusal names the parsed target.
import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAWorld} from '../test/core-a-fixture.ts';
import {headingOfYaw, yawTowards} from './edge/perception/geometry.ts';
import {Perception} from './edge/perception/here.ts';
import {attentionWords} from './edge/intents/intents.ts';

test('attentionWords: a second attention verb names no target; id forms parse; other words are unchanged', () => {
  for (const q of ['turn to face the bandstand', 'turn and face the bandstand', 'turn around and face the bandstand', 'turn round to face the bandstand', 'turn to look at the bandstand', 'face towards the bandstand', 'turn to the bandstand', 'face the bandstand'])
    assert.deepEqual(attentionWords(q), {verb: 'turn', target: 'bandstand'}, q);
  assert.deepEqual(attentionWords('look at the fire'), {verb: 'look', target: 'fire'});
  assert.deepEqual(attentionWords('turn around'), {verb: 'turn', target: 'around'});
  assert.deepEqual(attentionWords('turn:eden-bandstand'), {verb: 'turn', target: 'eden-bandstand'});
  assert.deepEqual(attentionWords('turn-to:face-the-bandstand'), {verb: 'turn', target: 'the-bandstand'});
  assert.deepEqual(attentionWords('look-at:pond'), {verb: 'look', target: 'pond'});
  assert.deepEqual(attentionWords('turn:90'), {verb: 'turn', heading: 90});
  // a name that only starts with an attention word keeps it
  assert.deepEqual(attentionWords('turn to Look Out Point'), {verb: 'turn', target: 'Look Out Point'});
  assert.deepEqual(attentionWords('look:look-out'), {verb: 'look', target: 'look-out'});
  for (const q of ['turn:on the tap', 'turn: off-the-lamp']) assert.equal(attentionWords(q), null, q);
  for (const q of ['turn on the tap', 'turn off the lamp', 'look for the fire', 'look around for Bill', 'walk:pond', 'sit:here']) assert.equal(attentionWords(q), null, q);
});

test('F1: "turn to face the bandstand" turns toward the bandstand, also out of sight; refusals name the parsed target', {timeout: 600000}, async t => {
  const w = await coreAWorld(2); t.after(() => w.close());
  const [a, b] = w.souls;
  const dry = async (q: string) => (await w.http(a, 'POST', '/v1/edge/resolve', {capability: q})).body.resolve;
  const act = async (s: typeof a, q: string) => (await w.http(s, 'POST', '/v1/edge/act', {capability: q})).body;
  const bearing = (id: string) => {const P = new Perception(w.ledger, a), at = P.locate(id)!.at; return {heading: headingOfYaw(yawTowards(w.pos(a), at)), sees: P.sees(at)};};
  for (const q of ['turn to face the bandstand', 'turn and face the bandstand', 'turn around and face the bandstand', 'turn to look at the bandstand', 'turn:eden-bandstand', 'turn-to:bandstand']) {
    const r = await dry(q); assert.equal(r.ok, true, q + ' ' + JSON.stringify(r));
    assert.deepEqual([r.would.capability, r.would.chosen.kind, r.would.chosen.heading], ['turn:eden-bandstand', 'place', bearing('eden-bandstand').heading], q);
  }
  assert.equal((await dry('look-at:bandstand')).would.capability, 'look:eden-bandstand');
  const z = await dry('turn to face the zebra'); assert.equal(z.code, 'target.not-in-sight'); assert.match(z.reason, /"zebra"/); assert.doesNotMatch(z.reason, /face/);
  // act: the free standing body turns to the bearing
  const on = await act(a, 'turn to face the bandstand'); assert.equal(on.accepted, true, JSON.stringify(on)); assert.equal(on.chosen.turned, 'body');
  await w.ticks(60); assert.equal(headingOfYaw(w.body(a).pose.yaw), bearing('eden-bandstand').heading);
  // a place out of sight: the heading is still the bearing to it
  const far = [...w.ledger.places.byId.values()].filter(p => p.parent !== null && p.id !== 'eden-bandstand').find(p => !bearing(p.id).sees);
  assert.ok(far, 'some place is out of sight');
  const fo = await act(a, `turn to face ${far!.id}`); assert.equal(fo.accepted, true, JSON.stringify(fo)); assert.equal(fo.chosen.id, far!.id);
  await w.ticks(60); assert.equal(headingOfYaw(w.body(a).pose.yaw), bearing(far!.id).heading);
  // id forms act too: turn:<degrees>, and an offered face:<soul> still faces that Soul
  const deg = await act(a, 'turn:180'); assert.equal(deg.accepted, true, JSON.stringify(deg)); await w.ticks(60); assert.equal(headingOfYaw(w.body(a).pose.yaw), 180);
  assert.deepEqual((await dry('turn:90')).would?.chosen?.heading, 90);
  await w.put(b, [w.pos(a)[0] + 2, w.pos(a)[1]]);
  // an offered face:<soul>, and its alias forms turn-to:<soul> / look-at:<soul>, still face that Soul (dry run and act)
  for (const q of ['face:', 'turn-to:', 'look-at:'].map(v => v + b.soulId)) {
    const r = await dry(q); assert.equal(r.would?.capability, 'face:' + b.soulId, q + ' ' + JSON.stringify(r));
    const fs = await act(a, q); assert.equal(fs.accepted, true, q + ' ' + JSON.stringify(fs)); await w.ticks(5);
    assert.equal(w.body(a).human.gaze?.kind, 'face', q + ' ' + JSON.stringify(w.body(a).human.gaze)); assert.equal(w.body(a).human.gaze?.target, b.entityId, q);
  }
});
