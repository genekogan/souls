// #437: "pick up the coffee mug" by a tea room took a prop cup of tea from the room's source instead of the god-built
// coffee-mug lying there. A world thing named by the words comes before a prop source of its kind only when it is on offer
// and the words name it more closely than the kind does: more than one word, wherever it is, or (#435) one word that is its
// whole name, a copy's number aside, within 8 m. A space in the words matches a name's hyphen. A bare kind word in a café
// ("a cup") still takes the café's cup, not a furnished cafe-cup-1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {edenNavWorld} from '../test/eden-nav-fixture.ts';
import type {EdgeCapability} from './edge/contract.ts';

test('#437 pick-up words: a named world thing before a prop source, a bare kind word still the source', async (t) => {
  const w = await edenNavWorld(1); t.after(() => { w.f.host.stop(); w.f.db.close(); }); const soul = w.souls[0] as never;
  const together = (w.ledger as unknown as {together: {resolve(s: unknown, t: string, c: EdgeCapability[]): {capability?: string; code?: string} | null}}).together;
  const item = (id: string, path: string, d: number, available = true): EdgeCapability => ({id: `pick-up:${id}`, verb: 'pick-up', label: `Pick up ${path} (${d} m)`, available, target: {id, kind: 'item'}});
  const source: EdgeCapability = {id: 'pick-up:cup', verb: 'pick-up', label: 'Pick up a cup of tea (tea room, 3 m)', available: true, target: {id: 'src-tea', kind: 'source'}};
  const to = (t: string, caps: EdgeCapability[]) => { const r = together.resolve(soul, t, caps); return r?.capability ?? r?.code ?? null; };
  const mug = item('e_mug', 'counter/coffee-mug', 2), cafe = item('e_cafe', 'int-cafe/cafe-table-1/cafe-cup-1', 2);
    assert.equal(to('pick up the coffee mug', [source, mug]), 'pick-up:e_mug', 'two words name the coffee-mug (space = hyphen)');
    assert.equal(to('pick up the coffee-mug', [source, mug]), 'pick-up:e_mug', 'its exact name');
    assert.equal(to('pick up a cup', [source, cafe]), 'pick-up:cup', 'a bare kind word keeps the source');
    assert.equal(to('pick up the mug', [source, mug]), 'pick-up:cup', 'one word that is only part of the name keeps the source');
    assert.equal(to('pick up the coffee mug', [source, item('e_mug', 'counter/coffee-mug', 2, false)]), 'pick-up:cup', 'a named thing not on offer does not block the source');
    assert.equal(to('pick up the mug', [mug]), 'pick-up:e_mug', 'no source: the named thing, as before');
    assert.equal(to('pick up the coffee mug', [mug]), 'pick-up:e_mug');
    // #435 and #437 together: one exact word wins only near; more words win anywhere; part of a name is the prop
    const food: EdgeCapability = {id: 'pick-up:food', verb: 'pick-up', label: 'Pick up something to eat (café, 3 m)', available: true, target: {id: 'src-food', kind: 'source'}};
    assert.equal(to('pick up the apple', [food, item('e_apple', 'table/apple', 2)]), 'pick-up:e_apple', 'the apple on the table');
    assert.equal(to('pick up the apple', [food, item('e_apple', 'table/apple', 55)]), 'pick-up:food', 'not 55 m past the prop');
    assert.equal(to('pick up the apple', [food, item('e_red', 'table/red-apple', 2)]), 'pick-up:food', 'one word that is part of a name keeps the prop');
    assert.equal(to('pick up the coffee mug', [source, item('e_mug', 'far-counter/coffee-mug', 55)]), 'pick-up:e_mug', 'two words name it wherever it is');
    assert.equal(to('pick up the blue coffee-mug', [source, item('e_blue', 'counter/blue-coffee-mug-2', 2)]), 'pick-up:e_blue', 'a hyphen in the words is a separator');
    // second review: a numbered copy is its name, near; a hyphen is a space on both branches; a number in the words counts
    assert.equal(to('pick up the apple', [food, item('e_a', 'table/apple-1', 2)]), 'pick-up:e_a', 'the first of a count of apples');
    assert.equal(to('pick up the apple', [food, item('e_a', 'table/apple-2', 55)]), 'pick-up:food', 'a copy keeps the 8 m limit');
    assert.equal(to('pick up the mug', [source, item('e_m', 'counter/mug-2', 2)]), 'pick-up:e_m');
    assert.equal(to('pick up a cup', [source, cafe]), 'pick-up:cup', 'cafe-cup-1 is not a copy of "cup"');
    assert.equal(to('pick up the coffee-mug', [source, item('e_m', 'counter/coffee-mug-2', 2)]), 'pick-up:e_m', 'the spelling a label shows');
    assert.equal(to('pick up the coffee mug', [source, item('e_m', 'counter/coffee-mug-2', 2)]), 'pick-up:e_m');
    assert.equal(to('pick up the coffee-mug', [source, item('e_m', 'far-counter/coffee-mug', 55)]), 'pick-up:e_m', 'a hyphenated name wherever it is');
    assert.equal(to('pick up the coffee', [source, item('e_m', 'counter/coffee-mug', 2)]), 'pick-up:e_m', 'the prop is a cup of tea, not coffee');
    assert.equal(to('pick up the mug 2', [source, item('e_1', 'counter/mug-1', 55)]), 'pick-up:cup', 'a number in the words names that copy, not another');
});
