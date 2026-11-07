import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { planFiles } from './scripts/optimize-glb.mjs';

function setup() {
  const d = mkdtempSync(join(tmpdir(), 'plan-'));
  mkdirSync(join(d, 'in')); mkdirSync(join(d, 'out'));
  writeFileSync(join(d, 'in', 'a.glb'), 'x'); writeFileSync(join(d, 'in', 'b.glb'), 'x');
  writeFileSync(join(d, 'out', 'a.glb'), 'old');
  return d;
}

test('planFiles without force skips an existing output', () => {
  const d = setup();
  const p = planFiles([join(d, 'in')], join(d, 'out'));
  assert.deepEqual(p.skip.map((f) => f.split('/').pop()), ['a.glb']);
  assert.equal(p.files.length, 2);
});

test('planFiles with force skips nothing', () => {
  const d = setup();
  assert.deepEqual(planFiles([join(d, 'in')], join(d, 'out'), true).skip, []);
});
