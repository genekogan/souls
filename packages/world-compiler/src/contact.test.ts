import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, containerClaims, containerHidden, containerOpen, keptBehindDoor } from './index.ts';

// #435: a container with no `open` state has no door; its contents are never hidden and have no lid to follow
test('containers with and without a door: open state, and what the viewer keeps behind a door', () => {
  const def = (name: string, version: number) => CORE_KIT.find((d) => d.name === name && d.version === version)!;
  const shelf = def('core-swap-shelf', 1), chest = def('core-drawer-chest', 2), lockers = def('core-lockers', 3);
  assert.equal(containerOpen(shelf, {}), true); assert.equal(containerOpen(shelf, { open: false }), true);
  assert.equal(containerOpen(chest, {}), false); assert.equal(containerOpen(chest, { open: true }), true);
  assert.equal(containerOpen(lockers, { open: false }), false);
  assert.equal(keptBehindDoor(shelf, 'in-1'), false, 'a swap shelf hides nothing');
  assert.equal(keptBehindDoor(chest, 'in-1'), true); assert.equal(keptBehindDoor(lockers, 'in-1'), true);
  assert.equal(keptBehindDoor(chest, 'top'), false, 'a thing on top of the chest is not inside it');
});

// #435 (W072): a lost-and-found is the swap shelf's form with a declared owner claim; no other container claims
test('the owner claim is declared data: only the lost-and-found has it', () => {
  const def = (name: string, version: number) => CORE_KIT.find((d) => d.name === name && d.version === version)!;
  const lf = def('core-lost-and-found', 1);
  assert.equal(containerClaims(lf), true); assert.equal(containerOpen(lf, {}), true); assert.equal(keptBehindDoor(lf, 'in-1'), false);
  for (const [n, v] of [['core-swap-shelf', 1], ['core-drawer-chest', 2], ['core-lockers', 3]] as const) assert.equal(containerClaims(def(n, v)), false, n);
});

// #435 (W068): a hiding place is a doorless container with one declared field: no door to open, and what is in it is kept out
// of sight (the viewer's lid-follow set, where a thing with no open box is not drawn); nothing else is hidden
test('hidden is declared data: only the hiding places have it', () => {
  const def = (name: string, version: number) => CORE_KIT.find((d) => d.name === name && d.version === version)!;
  for (const n of ['core-hollow-stump', 'core-wall-niche']) { const d = def(n, 1); assert.equal(containerHidden(d), true, n); assert.equal(containerOpen(d, {}), true, n); assert.equal(keptBehindDoor(d, 'in-1'), true, n); assert.equal(keptBehindDoor(d, 'top'), false, n); }
  for (const [n, v] of [['core-swap-shelf', 1], ['core-lost-and-found', 1], ['core-drawer-chest', 2], ['core-lockers', 3]] as const) assert.equal(containerHidden(def(n, v)), false, n);
});
