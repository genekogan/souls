// #439 W093: a checkers move named by its two squares is the nearest offered checkers board's move with those squares;
// other words, and worlds without a checkers board, resolve as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability, type VocabContext} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';

const at = new Map<string, [number, number]>([['e_near', [1, 0]], ['e_far', [4, 0]], ['e_ttt', [0.5, 0]]]);
const board = (id: string, available = true): EdgeCapability[] => [
  {id: `object:${id}:move`, verb: 'object', object: id, action: 'move', label: `Move a piece on the checkers board (${id})`, available, target: {id, kind: 'object'}},
  {id: `object:${id}:erase`, verb: 'object', object: id, action: 'erase', label: `Wipe the checkers board for a new game (${id})`, available, target: {id, kind: 'object'}},
];
const ttt: EdgeCapability[] = [{id: 'object:e_ttt:mark', verb: 'object', object: 'e_ttt', action: 'mark', label: 'Mark a square on the game board (game)', available: true, target: {id: 'e_ttt', kind: 'object'}}];
const to = (input: string, caps: EdgeCapability[]) => {
  const ctx: VocabContext = {caps, places: [], root: ['w'], me: [0, 0], target: (c) => ({names: [], around: [], at: c.target ? at.get(c.target.id) ?? null : null})};
  const r = resolveCapability(input, ctx); return r.kind === 'unknown' ? 'unknown' : {id: r.cap.id, params: r.kind === 'alias' ? r.params : undefined};
};

test('#439 checkers words: two squares are the nearest board\'s move', () => {
  const caps = [...board('e_far'), ...board('e_near'), ...ttt];
  for (const w of ['move c3 to d4', 'move from c3 to d4', 'c3 to d4', 'c3-d4', 'move c3 d4', 'Move the piece on c3 to d4.', 'please move c3 to d4 on the checkers board'])
    assert.deepEqual(to(w, caps), {id: 'object:e_near:move', params: {from: 'c3', to: 'd4'}}, w);
  assert.deepEqual(to('jump d4 to f6', caps), {id: 'object:e_near:move', params: {from: 'd4', to: 'f6'}});
  assert.deepEqual(to('c3xe5', caps), {id: 'object:e_near:move', params: {from: 'c3', to: 'e5'}});
  assert.deepEqual(to('move c3 to d4', [...board('e_near', false), ...board('e_far')]), {id: 'object:e_far:move', params: {from: 'c3', to: 'd4'}}, 'an available board first');
});

test('#439 other words and worlds without checkers resolve as before', () => {
  const caps = [...board('e_near'), ...ttt];
  assert.notEqual((to('mark a square on the game board', caps) as {id: string}).id, 'object:e_near:move');
  const id = (w: string, c: EdgeCapability[]) => { const r = to(w, c); return r === 'unknown' ? r : r.id; };
  assert.ok(!/:move$/.test(id('move c3 to d4', ttt)), 'no checkers board: no checkers move');
  for (const w of ['move to the bench', 'move closer', 'move the chair', 'read the board', 'mark the centre']) assert.ok(!/:move$/.test(id(w, caps)), w);
});

test('#439 a chained multi-jump does its first jump now, with its squares', () => {
  const r = to('jump c3 to e5, then e5 to g7', board('e_near'));
  assert.deepEqual(r, {id: 'object:e_near:move', params: {from: 'c3', to: 'e5'}});
});
