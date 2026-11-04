// #824: a refusal for "nothing matches" names what this Soul can do here and now instead (`alternatives`): at most 3
// available offers, the walk to a place its own words name first, never a repeat of did_you_mean; other refusals and
// accepted acts carry no such field.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';

test('#824: refusals name bounded, available alternatives; other answers carry none', {timeout: 300000}, async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Refusal fixture'}));
  const edge = new EdgeLedger(f.host, f.db), m = f.host.minds.get(a.id)!;
  const soul = {soulId: a.id, entityId: m.entityId, name: m.name, owner: 'dev:alice'};
  const caps = edge.capabilitiesPage(soul, {all: true}).capabilities as {id: string; available: boolean}[];
  const available = new Set(caps.filter(c => c.available).map(c => c.id));
  const check = (out: any, what: string) => {
    assert.equal(out.accepted, false, what);
    assert.ok(Array.isArray(out.alternatives) && out.alternatives.length >= 1 && out.alternatives.length <= 3, `${what}: 1-3 alternatives ${JSON.stringify(out.alternatives)}`);
    for (const x of out.alternatives) {assert.ok(available.has(x.id), `${what}: ${x.id} is available now`); assert.equal(typeof x.label, 'string'); assert.deepEqual(Object.keys(x).sort(), ['id', 'label']);}
    assert.equal(new Set(out.alternatives.map((x: any) => x.id)).size, out.alternatives.length, 'no repeats');
    for (const d of out.did_you_mean ?? []) assert.ok(!out.alternatives.some((x: any) => x.id === d.id), `${what}: ${d.id} is already in did_you_mean`);
  };
  // A1/A2: "fly up to the field" (S2 recovery case): nothing matches, and the walk its own words name comes first
  const fly = await edge.act(soul, {capability: 'fly up to the field'}) as any;
  assert.equal(fly.code, 'ride.unavailable'); assert.deepEqual(fly.did_you_mean, []); check(fly, 'fly');
  assert.equal(fly.alternatives[0].id, 'walk:field');
  // A2: a materially different case (an unknown verb, no place named): the nearest available offers, one per verb
  const unknown = await edge.act(soul, {capability: 'teleport somewhere nice'}) as any;
  assert.equal(unknown.code, 'capability.unknown'); check(unknown, 'unknown verb');
  const verbs = unknown.alternatives.map((x: any) => x.id.split(':')[0]); assert.equal(new Set(verbs).size, verbs.length, 'one per verb');
  assert.ok(!unknown.alternatives[0].id.startsWith('walk:'), 'no place named: the first alternative is not a walk');
  assert.ok(unknown.alternatives.some((x: any) => x.id.endsWith(':here')), `offers here rank nearest: ${JSON.stringify(unknown.alternatives)}`);
  // A1 (review): an unknown place id (the explicit place path) and an unknown Soul name (together/1) are covered too
  for (const asked of ['walk:atlantis', 'gather:no-such-place', 'hug Nobody', 'dance with Zed']) {
    const out = await edge.act(soul, {capability: asked}) as any; assert.equal(out.code, 'capability.unknown', `${asked}: ${JSON.stringify(out)}`); check(out, asked);
  }
  // A3 (review): a description-only word never names the place ("teleport somewhere nice" names no walk)
  // A3: a refusal that is not "nothing matches" and an accepted act carry no alternatives
  const params = await accept(f.host, edge.act(soul, {capability: 'walk:field', params: {via: 'nowhere-at-all'}})) as any;
  assert.equal(params.accepted, false, JSON.stringify(params)); assert.equal(params.alternatives, undefined, JSON.stringify(params));
  const ok = await accept(f.host, edge.act(soul, {capability: 'wave'})) as any;
  assert.equal(ok.accepted, true, JSON.stringify(ok)); assert.equal(ok.alternatives, undefined);
  // A6: the field's size is bounded (3 entries, labels as offered)
  for (const out of [fly, unknown]) assert.ok(JSON.stringify({alternatives: out.alternatives}).length <= 600, 'bounded bytes');
});
