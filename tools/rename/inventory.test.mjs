import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindsOf, areaOf } from './inventory.mjs';

const kinds = (s) => kindsOf(s).map(([k]) => k);
test('the product name is a word; the music work, its API and other games are not', () => {
  assert.deepEqual(kinds('Sim runs persistent worlds'), ['word']);
  assert.deepEqual(kinds("Sim's Mars world"), ['word']);
  assert.deepEqual(kinds('Sim Score is authored music'), ['other']);
  assert.deepEqual(kinds('Sim.register({})'), ['other']);
  assert.deepEqual(kinds('The Sims build mode'), ['other']);
  assert.deepEqual(kinds('a simulation of sim time'), []);
});
test('each code form has its own kind', () => {
  assert.deepEqual(kinds('X-Sim-Load: green'), ['header']);
  assert.deepEqual(kinds('SIM_DEPLOY_HOST'), ['env']);
  assert.deepEqual(kinds("from '@sim/kernel'"), ['package']);
  assert.deepEqual(kinds('/__sim/worlds'), ['route']);
  assert.deepEqual(kinds('https://sim.eden.art/'), ['domain']);
  assert.deepEqual(kinds('Bearer sim_s1_x'), ['token']);
  assert.deepEqual(kinds('/srv/sim-worlds/stage'), ['path-or-id']);
});
test('areas', () => {
  assert.equal(areaOf('apps/web/src/a.ts'), 'apps/web');
  assert.equal(areaOf('README.md'), 'README.md');
  assert.equal(areaOf('docs/testing.md'), 'docs');
});
