import test from 'node:test';
import assert from 'node:assert/strict';
import { tiltedColliderWarning } from './workbench-data.ts';
import type { StoredDef } from '@souls/world-compiler';
const def = (shape: Record<string, unknown>) => ({ make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 1, 0], size: [1, 1, 1], ...shape }] } } } as unknown as StoredDef);
test('tilted collision warning follows collider eligibility, not every decorative rotation', () => {
  for (const s of [{ pitch: .5 }, { roll: .5 }, { pitch: .5, role: 'head', collide: true }]) assert.equal(tiltedColliderWarning(def(s)).length, 1);
  for (const s of [{ yaw: .5 }, { pitch: .5, collide: false }, { pitch: .5, role: 'head' }, { pitch: .5, when: '@lit' }, { pitch: .5, size: [1, .1, 1] }]) assert.equal(tiltedColliderWarning(def(s)).length, 0);
});
test('tilted collision warnings expand kit programs and numeric parameters', () => {
  const program = def({ pitch: '$tilt', size: [1, '$height', 1], repeat: { n: 2, step: [2, 0, 0] } });
  assert.equal(tiltedColliderWarning(program, { tilt: .5, height: 1 }).length, 1);
  assert.equal(tiltedColliderWarning(program, { tilt: 0, height: 1 }).length, 0);
  assert.equal(tiltedColliderWarning(program, { tilt: .5, height: .1 }).length, 0);
});
