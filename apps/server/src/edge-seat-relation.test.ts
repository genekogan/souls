// #848: a seat named with a relation word between it and its place ("the bench outside the cottage", "the audience bench
// inside the presentation hall") is found like "by"/"in" phrasings; `outside` stays a constraint (read as `outdoor`).
import test from 'node:test';
import assert from 'node:assert/strict';
import {accept} from '../test/native-owner-fixture.ts';
import {bootEden} from '../test/eden-capabilities-timing.ts';

test('#848: "outside"/"inside" name the right seat on hello-hamlet, and "outside" is still a constraint', {timeout: 300000}, async t => {
  const w = await bootEden(() => {}, new URL('../../../worlds/templates/hello-hamlet.json', import.meta.url)); t.after(w.close);
  const act = async (words: string) => await accept(w.host, w.edge.act(w.soul, {capability: words})) as any;
  const named = (r: any) => (r.did_you_mean ?? []).map((d: any) => d.id);
  // A1: the S3 demonstration 3 request names the cottage's outdoor bench; it is the only seat so named, so (#849) it is taken
  // and the answer says which seat was chosen
  const taken = (r: any) => r.accepted ? r.receipt?.capability : named(r);
  const outside = await act('sit on the bench outside the cottage');
  assert.equal(taken(outside), 'sit:cottage/part-outdoor-bench', JSON.stringify(outside));
  assert.equal(outside.resolved?.to, 'sit:cottage/part-outdoor-bench'); assert.match(outside.resolved?.note ?? '', /^The only seat these words name is Outdoor Bench .*; it is the seat chosen\.$/);
  // #849 A1: "by the cottage" names the same one seat
  assert.equal(taken(await act('sit on the bench by the cottage')), 'sit:cottage/part-outdoor-bench');
  // A2: `inside` reads as `in`
  const inside = await act('sit on the audience bench inside the presentation hall'), inHall = await act('sit on the audience bench in the presentation hall');
  assert.equal(taken(inside), 'sit:lab-presentation-hall/part-audience', JSON.stringify(inside)); assert.equal(taken(inside), taken(inHall));
  // A3: the hall has no outdoor seat, so "outside the presentation hall" names none; an unknown seat names none
  for (const words of ['sit on the bench outside the presentation hall', 'sit on the hammock outside the cottage']) {
    const r = await act(words); assert.equal(r.accepted, false, words); assert.deepEqual(named(r), [], `${words}: ${JSON.stringify(r)}`);
  }
});

// Review of 98ccb03e and d00ed59b: a relation word that does not lead to a named seat keeps its old handling (A6), on
// hello-hamlet and eden-2026.
test('#848: "outside" that names no seat (bare, trailing, "with Bo", "now") answers as before', {timeout: 300000}, async t => {
  const hamlet = await bootEden(() => {}, new URL('../../../worlds/templates/hello-hamlet.json', import.meta.url)); t.after(hamlet.close);
  const outdoors = await accept(hamlet.host, hamlet.edge.act(hamlet.soul, {capability: 'sit outdoors'})) as any;
  assert.equal(outdoors.accepted, true, JSON.stringify(outdoors)); assert.equal(outdoors.receipt?.capability ?? outdoors.resolved, 'sit:cottage/part-outdoor-bench');
  // a relation word followed by words that name no seat ("with Bo", "now"): as before, unknown with suggestions
  for (const words of ['sit outside', 'sit outside with Bo', 'sit outside now', 'sit down outside for a minute', 'sit outside here']) {
    const r = await accept(hamlet.host, hamlet.edge.act(hamlet.soul, {capability: words})) as any;
    assert.equal(r.code, 'capability.unknown', `${words}: ${JSON.stringify(r).slice(0, 300)}`); assert.ok(r.did_you_mean?.length, `${words}: suggestions kept`);
  }
  const eden = await bootEden(); t.after(eden.close);
  for (const words of ['sit outside', 'sit outdoors', 'sit outside with Bo', 'sit outside now', 'sit down outside for a minute']) {
    const r = await accept(eden.host, eden.edge.act(eden.soul, {capability: words})) as any;
    assert.equal(r.code, 'capability.unknown', `${words}: ${JSON.stringify(r).slice(0, 300)}`); assert.ok(r.did_you_mean?.length, `${words}: suggestions kept`);
  }
});
