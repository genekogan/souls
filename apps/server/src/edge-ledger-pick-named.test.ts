// #437: "pick up the coffee mug" by a tea room took a prop cup of tea from the room's source instead of the god-built
// coffee-mug lying there. A world thing named by the words comes before a prop source of its kind only when it is on offer
// and the words name it more closely than the kind does (its exact name, or more than one word); a space in the words
// matches a name's hyphen. A bare kind word in a café ("a cup") still takes the café's cup, not a furnished cafe-cup-1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import type {EdgeCapability} from './edge/contract.ts';

test('#437 pick-up words: a named world thing before a prop source, a bare kind word still the source', async () => {
  const w = await edenNavWorld(1); const soul = w.souls[0] as never;
  const together = (w.ledger as unknown as {together: {resolve(s: unknown, t: string, c: EdgeCapability[]): {capability?: string; code?: string} | null}}).together;
  const item = (id: string, path: string, d: number, available = true): EdgeCapability => ({id: `pick-up:${id}`, verb: 'pick-up', label: `Pick up ${path} (${d} m)`, available, target: {id, kind: 'item'}});
  const source: EdgeCapability = {id: 'pick-up:cup', verb: 'pick-up', label: 'Pick up a cup of tea (tea room, 3 m)', available: true, target: {id: 'src-tea', kind: 'source'}};
  const to = (t: string, caps: EdgeCapability[]) => { const r = together.resolve(soul, t, caps); return r?.capability ?? r?.code ?? null; };
  const mug = item('e_mug', 'counter/coffee-mug', 2), cafe = item('e_cafe', 'int-cafe/cafe-table-1/cafe-cup-1', 2);
  try {
    assert.equal(to('pick up the coffee mug', [source, mug]), 'pick-up:e_mug', 'two words name the coffee-mug (space = hyphen)');
    assert.equal(to('pick up the coffee-mug', [source, mug]), 'pick-up:e_mug', 'its exact name');
    assert.equal(to('pick up a cup', [source, cafe]), 'pick-up:cup', 'a bare kind word keeps the source');
    assert.equal(to('pick up the mug', [source, mug]), 'pick-up:cup', 'one word that is only part of the name keeps the source');
    assert.equal(to('pick up the coffee mug', [source, item('e_mug', 'counter/coffee-mug', 2, false)]), 'pick-up:cup', 'a named thing not on offer does not block the source');
    assert.equal(to('pick up the mug', [mug]), 'pick-up:e_mug', 'no source: the named thing, as before');
    assert.equal(to('pick up the coffee mug', [mug]), 'pick-up:e_mug');
  } finally { w.close?.(); }
});
