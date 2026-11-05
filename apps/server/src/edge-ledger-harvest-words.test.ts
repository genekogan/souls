// #438 W085/W086: picking words. "pick the tomatoes" is the nearest offered basket's harvest, "pick flowers for the vase"
// the nearest offered vase's; "pick up" and worlds without a basket or a vase resolve as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability, type VocabContext} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';

const at = new Map<string, [number, number]>([['e_basket', [1, 0]], ['e_vase', [2, 0]], ['e_basket2', [4, 0]]]);
const vessel = (id: string, label: string, available = true): EdgeCapability[] => [
  {id: `object:${id}:harvest`, verb: 'object', object: id, action: 'harvest', label: `${label} (garden-table/${id})`, available, target: {id, kind: 'object'}},
  {id: `pick-up:${id}`, verb: 'pick-up', label: `Pick up garden-table/${id} (1 m)`, available, target: {id, kind: 'item'}},
];
const basket = (id = 'e_basket', available = true) => vessel(id, 'Pick the ripe tomatoes into the basket', available);
const vase = vessel('e_vase', 'Pick flowers for the vase');
const to = (input: string, caps: EdgeCapability[]) => {
  const ctx: VocabContext = {caps, places: [], root: ['w'], me: [0, 0], target: (c) => ({names: [], around: [], at: c.target ? at.get(c.target.id) ?? null : null})};
  const r = resolveCapability(input, ctx); return r.kind === 'unknown' ? 'unknown' : r.cap.id;
};

test('#438 picking words take the vessel that picks what they name', () => {
  const caps = [...basket(), ...vase];
  for (const w of ['pick the tomatoes', 'harvest the tomatoes', 'pick the fruit', 'pick tomatoes into the basket', 'Pick the ripe tomatoes.', 'pick some tomatoes from the bed', 'please pick the tomatoes'])
    assert.equal(to(w, caps), 'object:e_basket:harvest', w);
  for (const w of ['pick flowers for the vase', 'pick some flowers', 'pick the flowers', 'pick a bunch of flowers for the vase', 'cut some flowers', 'gather flowers'])
    assert.equal(to(w, caps), 'object:e_vase:harvest', w);
  assert.equal(to('pick the tomatoes', [...basket('e_basket', false), ...basket('e_basket2')]), 'object:e_basket2:harvest', 'an available basket first');
});

test('#438 "pick up" and worlds without a vessel resolve as before', () => {
  const caps = [...basket(), ...vase];
  assert.equal(to('pick up the basket', caps), 'pick-up:e_basket');
  assert.equal(to('pick up the vase', caps), 'pick-up:e_vase');
  assert.notEqual(to('pick the flowers', basket()), 'object:e_basket:harvest', 'a basket does not pick flowers');
  assert.notEqual(to('pick the tomatoes', vase), 'object:e_vase:harvest', 'a vase does not pick tomatoes');
  assert.equal(to('pick the tomatoes', []), 'unknown');
  // review: a second clause is never swallowed, flowers are not taken out of the vase, and a vessel that does not pick them
  assert.notEqual(to('pick the tomatoes from the bed and put the basket on the counter', caps), 'object:e_basket:harvest');
  assert.equal(to('pick the tomatoes from the bed, then put the basket on the counter', caps), 'object:e_basket:harvest', 'the first part now');
  for (const w of ['collect the flowers from the vase', 'cut the flowers from the vase', 'pick tomatoes for the vase', 'pick flowers into the basket']) assert.ok(!/:harvest$/.test(to(w, caps)), w);
  assert.equal(to('pick the tomatoes from the garden bed', caps), 'object:e_basket:harvest');
});
