import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, containerOpen, keptBehindDoor } from './index.ts';

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
