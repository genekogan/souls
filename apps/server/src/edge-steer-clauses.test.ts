// A rider's chained words split into clauses before the steer words read them: "fly to the lighthouse then fly north" is
// two steers (the first now, the second when it completes), never one steer toward a place called "lighthouse then fly
// north". A single clause, including a steer's own land tail ("…, then land"), reads as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability, type VocabContext, type VocabPlace} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';

const places: VocabPlace[] = [{id: 'commons', name: 'Commons gathering lawn', center: [9, 5]}, {id: 'lighthouse', name: 'Lighthouse', center: [60, 40]}];
const steer: EdgeCapability = {id: 'object:ride-eden-balloon:steer', verb: 'object', action: 'steer', object: 'ride-eden-balloon', label: 'Steer the Red balloon', available: true} as EdgeCapability;
const caps: EdgeCapability[] = [steer,
  {id: 'walk:commons', verb: 'walk', label: 'Commons gathering lawn', available: true, target: {id: 'commons', kind: 'place'}},
  {id: 'wave:here', verb: 'wave', label: 'Wave', available: true}];
const ctx: VocabContext = {caps, places, root: ['eden'], me: [10, 5], target: c => ({names: c.target ? [places.find(p => p.id === c.target!.id)?.name ?? c.target.id] : [], around: [], at: null})};
const read = (input: string) => { const r = resolveCapability(input, ctx); assert.notEqual(r.kind, 'unknown', `${input}: ${JSON.stringify(r)}`); return r as Extract<ReturnType<typeof resolveCapability>, {kind: 'alias'}>; };

test('single-clause steer words read as before, the land tail included', () => {
  for (const [input, params] of [
    ['fly to the lighthouse', {to: 'lighthouse'}],
    ['fly the balloon to the lighthouse and land there', {to: 'lighthouse', land: true}],
    ['fly to the lighthouse then land', {to: 'lighthouse', land: true}],
    ['fly to the lighthouse, then land there', {to: 'lighthouse', land: true}],
    ['fly to the lighthouse and then land', {to: 'lighthouse', land: true}],
    ['fly to the lighthouse then then land', {to: 'lighthouse', land: true}],
    ['fly north', {direction: 'north', distance: 100}],
    ['fly north 50 m then land', {direction: 'north', distance: 50, land: true}],
    ['land', {land: true}],
    ['stop the balloon', {stop: true}],
  ] as const) { const r = read(input); assert.equal(r.cap.id, steer.id, input); assert.deepEqual(r.params, params, input); }
});

test('a chained steer is two clauses: the first steer now, the second named for later', () => {
  const r = read('fly to the lighthouse then fly north');
  assert.equal(r.cap.id, steer.id); assert.deepEqual(r.params, {to: 'lighthouse'}, 'the first clause alone is the steer');
  assert.match(r.note, /act again for "fly north"/);
  const s = read('fly north then fly to the lighthouse, then land');
  assert.deepEqual(s.params, {direction: 'north', distance: 100}); assert.match(s.note, /act again for "fly to the lighthouse, then land"/);
});

test('a chained mixed act: a steer then another act, and another act then a steer', () => {
  const r = read('fly to the lighthouse then wave');
  assert.equal(r.cap.id, steer.id); assert.deepEqual(r.params, {to: 'lighthouse'}); assert.match(r.note, /act again for "wave"/);
  const w = read('wave, then fly north');
  assert.equal(w.cap.id, 'wave:here'); assert.match(w.note, /act again for "fly north"/);
});
