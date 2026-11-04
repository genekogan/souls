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
  // A1: the S3 demonstration 3 request names the cottage's outdoor bench (a choice under the named-seat contract)
  const outside = await act('sit on the bench outside the cottage');
  assert.equal(outside.code, 'capability.choose', JSON.stringify(outside)); assert.deepEqual(named(outside), ['sit:cottage/part-outdoor-bench']);
  // A2: `inside` reads as `in`
  const inside = await act('sit on the audience bench inside the presentation hall'), inHall = await act('sit on the audience bench in the presentation hall');
  assert.deepEqual(named(inside), ['sit:lab-presentation-hall/part-audience'], JSON.stringify(inside)); assert.deepEqual(named(inside), named(inHall));
  // A3: the hall has no outdoor seat, so "outside the presentation hall" names none; an unknown seat names none
  for (const words of ['sit on the bench outside the presentation hall', 'sit on the hammock outside the cottage']) {
    const r = await act(words); assert.equal(r.accepted, false, words); assert.deepEqual(named(r), [], `${words}: ${JSON.stringify(r)}`);
  }
});
