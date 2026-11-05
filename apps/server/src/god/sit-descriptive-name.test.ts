// F5 (#376): on mars-two, "sit on the presenter box" names the presenter's timber box (every word is in its own name),
// and the Soul sits on it; a second seat of another name that also holds every word makes it a named choice.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {fixture, invite, accept} from '../../test/native-owner-fixture.ts';
import {GodMode} from './god.ts';
import {GroundHost, installGroundCapabilities, loadGroundRecipes} from './ground-host.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {installWorldEnv} from './world-env.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';

async function marsTwo(t: {after(f: () => void): void}, extra: unknown[] = []) {
  const w = fixture(':memory:'); loadGroundRecipes(w.db, w.host.worldId); const edge = new EdgeLedger(w.host, w.db);
  const genesis = JSON.parse(readFileSync(new URL('../../../../worlds/templates/mars-two.json', import.meta.url), 'utf8'));
  genesis.batches[10].ops.push(...extra);
  const god = new GodMode(w.db, {genesis, worldId: w.host.worldId, ownerId: 'dev:admin', tick: () => w.host.engine.world.tick, emit() {}});
  new GroundHost(w.db, w.host, god); installGroundCapabilities(edge as never, god, w.host);
  const bridge = installEngineBridge({host: w.host, god, edge, log() {}}); installWorldEnv(w.host, god, edge);
  t.after(() => {w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close();});
  const settle = async (n = 3) => {for (let i = 0; i < n; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}}; await settle();
  await invite(w, 'sitter'); const row = await accept(w.host, w.souls.create('dev:sitter', {name: 'Sitter', description: 'F5 proof'})) as {id: string; entity_id: string; name: string; owner: string};
  const soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner}; await settle(); bridge.perceive.sync(true); edge.map();
  const dry = (q: string) => edge.intents.dryRun(soul as never, {capability: q}) as any;
  // the seat's entity id, read from its exact name (an id-shaped capability the vocabulary already resolves)
  const entityNamed = (name: string) => String(dry('sit:' + name).would?.capability ?? '').replace(/^sit:/, '') || undefined;
  return {w, edge, soul, dry, settle, entityNamed};
}

test('F5: "sit on the presenter box" sits on the presenter timber box; other descriptive and exact names keep their answers', {timeout: 300000}, async t => {
  const {w, edge, soul, dry, settle, entityNamed} = await marsTwo(t);
  const box = entityNamed('presenter-timber-box'), teal = entityNamed('field-teal-sofa'); assert.ok(box && teal, 'fixtures exist');
  for (const q of ['sit on the presenter box', 'sit on the presenter timber box', 'sit on the timber box']) {
    const r = dry(q); assert.equal(r.ok, true, q + ' ' + JSON.stringify(r)); assert.equal(r.would.capability, 'sit:' + box, q);
    assert.match(String(r.would.label), /presenter-timber-box/, q);
  }
  assert.equal(dry('sit on the teal sofa').would?.capability, 'sit:' + teal);
  const unknown = dry('sit on the auditorium sofa'); assert.equal(unknown.code, 'capability.unavailable'); assert.equal(unknown.did_you_mean.length, 0);
  assert.equal(dry('sit on the presenter seat').code, 'capability.choose', 'a part choice stays a choice');
  assert.equal(dry('walk to the Chiba auditorium').would?.capability, 'walk:chiba');
  assert.equal(dry('sit on the chair').ok, true, 'a generic seat word keeps the nearest seat');
  // act: the Soul walks to the box and sits on it
  const out = await accept(w.host, Promise.resolve(edge.act(soul as never, {capability: 'sit on the presenter box'}))) as any;
  assert.equal(out.accepted, true, JSON.stringify(out)); assert.equal(out.receipt.capability, 'sit:' + box);
  let receipt: any; const began = w.host.engine.world.tick;
  do {await settle(20); receipt = edge.receipt(soul.soulId, out.receipt.id);} while (receipt.phase !== 'failed' && (w.host.engine.world.tick - began) < 120 * 20 && (w.host.engine.world.entities as any)[soul.entityId].human.activity !== 'sit');
  assert.notEqual(receipt.phase, 'failed', JSON.stringify(receipt));
  const held = (w.host.engine as any).world.entities[soul.entityId].human; assert.equal(held.activity, 'sit', JSON.stringify({phase: receipt.phase, held}));
  assert.ok(JSON.stringify(edge.mw.nativeSeatHoldsV1?.(soul.entityId) ?? []).includes(box), 'the seat held is the presenter timber box');
});

test('F5: two seats of different names that both hold every word are a named choice, never chosen', {timeout: 300000}, async t => {
  const {dry, entityNamed} = await marsTwo(t, [{op: 'place', def: 'core/mars-presenter-timber-box@2', name: 'presenter-spare-box', p: [-12.4, 0.373, -16.2], r: 0}]);
  const box = entityNamed('presenter-timber-box'), spare = entityNamed('presenter-spare-box'); assert.ok(box && spare);
  const r = dry('sit on the presenter box'); assert.equal(r.ok, false); assert.equal(r.code, 'capability.choose', JSON.stringify(r));
  assert.deepEqual(r.did_you_mean.map((c: any) => c.id).sort(), ['sit:' + box, 'sit:' + spare].sort()); assert.match(r.reason, /presenter-spare-box/); assert.match(r.reason, /presenter-timber-box/);
  assert.equal(dry('sit on the spare box').would?.capability, 'sit:' + spare, 'a name only one seat holds is that seat');
});
