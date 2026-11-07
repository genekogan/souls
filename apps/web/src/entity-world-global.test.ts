import test from 'node:test';
import assert from 'node:assert/strict';
import { publishEntityWorld, retireEntityWorld } from './entity-world-global.ts';

test('the entity world handle is published under its name and the old alias', () => {
  const host: Parameters<typeof publishEntityWorld>[1] = {}, world = { layer: {} };
  publishEntityWorld(world, host);
  assert.equal(host.__soulsEntity, world);
  assert.equal(host.__simEntity, world);
});

test('only the layer that published the handle retires both names', () => {
  const host: Parameters<typeof publishEntityWorld>[1] = {}, world = { layer: {} };
  publishEntityWorld(world, host);
  retireEntityWorld({}, host);
  assert.equal(host.__soulsEntity, world);
  assert.equal(host.__simEntity, world);
  retireEntityWorld(world.layer, host);
  assert.ok(!('__soulsEntity' in host) && !('__simEntity' in host));
});
