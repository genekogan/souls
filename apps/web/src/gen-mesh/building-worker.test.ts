// Lane W1: a building's geometry made in building.worker.ts (its job and result cross by structured clone) is the
// geometry the page would make itself, for every library building.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERATORS } from '@souls/generators';
import { CORE_KIT, WorldModel } from '@souls/world-compiler';
import type { BuildingLayout } from '../../../../packages/generators/src/building.ts';
import { buildingBuffers, buildingJob } from './building.mesh.ts';

test('worker round trip: identical soups (keys, order, float bytes), triangles and smoke anchors for all library buildings', () => {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'bw' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const defs = [...new Set(w.allDefs())].filter((d) => d.make.kind === 'gen' && d.make.gen === 'building/1');
  assert.ok(defs.length >= 40, `library buildings: ${defs.length}`);
  const gen = GENERATORS['building/1'] as unknown as { layout(p: Record<string, unknown>, a: Record<string, unknown>): BuildingLayout };
  let soups = 0;
  for (const def of defs) {
    const params = Object.fromEntries(Object.entries({ ...GENERATORS['building/1'].params, ...def.params }).filter(([, f]) => f.default !== undefined).map(([k, f]) => [k, f.default]));
    const args = (def.make.kind === 'gen' ? def.make.args ?? {} : {}) as Record<string, unknown>;
    const job = buildingJob({ def, params: params as never, args }, gen.layout(params, args), '#f1e7d2');
    const here = buildingBuffers(job), there = structuredClone(buildingBuffers(structuredClone(job)));
    assert.deepEqual(there.raw.map((r) => r.k), here.raw.map((r) => r.k), def.ref);
    for (let i = 0; i < here.raw.length; i++) {
      for (const a of ['p', 'n', 'c'] as const) assert.deepEqual(Buffer.from(there.raw[i][a].buffer), Buffer.from(here.raw[i][a].buffer), `${def.ref} ${here.raw[i].k} ${a}`);
      assert.deepEqual(there.raw[i].face, here.raw[i].face, `${def.ref}: outer face ranges`);
      assert.deepEqual(there.raw[i].pane, here.raw[i].pane, `${def.ref}: window pane coordinates`);
    }
    assert.equal(there.tris, here.tris); assert.deepEqual(there.anchors, here.anchors);
    soups += here.raw.length;
  }
  assert.ok(soups > 100);
});
