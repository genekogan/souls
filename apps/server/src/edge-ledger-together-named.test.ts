// #435: a real thing called the word comes before a place's prop of the kind only when it is free to take and near. With no
// prop on offer the real thing is still the answer, however far: there is nothing else to take.
import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';

const prop = {id: 'pick-up:cup', verb: 'pick-up', label: 'Pick up a cup of tea', target: {id: 'place:kitchen', kind: 'source'}, available: true};
const real = (id: string, metres: number, extra: object = {}) => ({id: `pick-up:${id}`, verb: 'pick-up', label: `Pick up mug (${metres} m)`, target: {id, kind: 'item'}, available: true, ...extra});

test('pick up the mug: a real mug comes before a prop only when it is free to take and within 8 m', {timeout: 300000}, async t => {
  const w = await edenNavWorld(1), [soul] = w.souls; t.after(() => {w.f.host.stop(); w.f.db.close();});
  const resolve = (caps: object[]) => (w.ledger.together.resolve(soul as never, 'pick up the mug', caps as never) as {capability?: string}).capability;
  assert.equal(resolve([prop, real('e_near', 2)]), 'pick-up:e_near', 'a free mug beside her');
  assert.equal(resolve([prop, real('e_edge', 8)]), 'pick-up:e_edge', 'at the limit');
  assert.equal(resolve([prop, real('e_far', 55)]), 'pick-up:cup', 'she does not walk 55 m past the prop');
  assert.equal(resolve([prop, real('e_past', 9)]), 'pick-up:cup', 'just past the limit');
  assert.equal(resolve([prop, real('e_hers', 2, {available: false, blocked: {code: 'item.not-yours', reason: 'not yours'}})]), 'pick-up:cup', 'someone else\'s mug does not beat a free prop');
  assert.equal(resolve([prop, real('e_hers', 2, {available: false}), real('e_mine', 6)]), 'pick-up:e_mine', 'the free one of two');
  assert.equal(resolve([prop]), 'pick-up:cup', 'the prop alone');
  assert.equal(resolve([real('e_far', 55)]), 'pick-up:e_far', 'no prop on offer: the real mug, as before');
});
