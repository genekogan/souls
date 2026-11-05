// #437 W078: a coffee mug's words. A word that names the drink ("make a cup of coffee", "drink the tea") takes only a mug
// whose offer names it, nearest first; words that name neither ("drink it", "wash the mug") take the nearest mug. A world with
// only tea mugs resolves as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability, type VocabContext} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';

const at = new Map<string, [number, number]>([['e_tea', [1, 0]], ['e_coffee', [3, 0]], ['e_tea2', [5, 0]]]);
const mug = (id: string, drink: 'tea' | 'coffee', available = true): EdgeCapability[] => [
  ['brew', `Make a cup of ${drink}`], ['drink', `Drink the ${drink}`], ['sip', `Take a sip of the ${drink}`], ['wash', drink === 'tea' ? 'Wash the cup' : 'Wash the coffee mug'],
].map(([a, l]) => ({id: `object:${id}:${a}`, verb: 'object', object: id, action: a, label: `${l} (counter/${id === 'e_tea' ? 'tea mug' : id})`, available, target: {id, kind: 'object'}}));
const to = (input: string, caps: EdgeCapability[]) => {
  const ctx: VocabContext = {caps, places: [], root: ['w'], me: [0, 0], target: (c) => ({names: [], around: [], at: c.target ? at.get(c.target.id) ?? null : null})};
  const r = resolveCapability(input, ctx); return r.kind === 'unknown' ? 'unknown' : r.cap.id;
};

test('#437 words name the drink: coffee words take a coffee mug, tea words a tea mug, whichever is nearer', () => {
  const both = [...mug('e_tea', 'tea'), ...mug('e_coffee', 'coffee')];
  for (const w of ['make a cup of coffee', 'make coffee', 'brew a coffee', 'make me a coffee']) assert.equal(to(w, both), 'object:e_coffee:brew', w);
  for (const w of ['make a cup of tea', 'make tea']) assert.equal(to(w, both), 'object:e_tea:brew', w);
  assert.equal(to('drink the coffee', both), 'object:e_coffee:drink');
  assert.equal(to('drink the cup of coffee', both), 'object:e_coffee:drink');
  assert.equal(to('drink the tea', both), 'object:e_tea:drink', 'a mug named "tea mug" is still read by its label, not its name');
  assert.equal(to('have a sip of the coffee', both), 'object:e_coffee:sip');
  assert.equal(to('sip the tea', both), 'object:e_tea:sip');
  assert.equal(to('drink it', both), 'object:e_tea:drink', 'no drink named: the nearest mug');
  assert.equal(to('wash the coffee mug', both), 'object:e_coffee:wash', 'the coffee mug, though the tea mug is nearer');
  assert.equal(to('rinse the tea cup', [...mug('e_coffee', 'coffee'), ...mug('e_tea2', 'tea')]), 'object:e_tea2:wash', 'the tea mug, though the coffee mug is nearer');
  assert.equal(to('wash the mug', both), 'object:e_tea:wash', 'no drink named: the nearest mug');
  // a coffee word with only tea mugs on offer is not a tea act
  assert.notEqual(to('make a cup of coffee', mug('e_tea', 'tea')), 'object:e_tea:brew');
});

test('#437 tea words in a tea-only world resolve as before (nearest available first)', () => {
  const tea = [...mug('e_tea', 'tea', false), ...mug('e_tea2', 'tea')];
  assert.equal(to('make a cup of tea', tea), 'object:e_tea2:brew', 'an available mug first');
  assert.equal(to('drink the tea', tea), 'object:e_tea2:drink');
  assert.equal(to('wash the cup', tea), 'object:e_tea2:wash');
});
