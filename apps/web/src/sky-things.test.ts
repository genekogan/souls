// W2b: a god world gets drifting balloons when it has balloons of its own (or sky.balloons: true; false = none), and
// sea fog banks over its largest water (~120 m across or more).
//   node --test apps/web/src/sky-things.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type DefInput } from '@souls/world-compiler';
import terrainKit from '../../../packages/world-compiler/src/core-kit/terrain.json' with { type: 'json' };
import transportKit from '../../../packages/world-compiler/src/core-kit/transport.json' with { type: 'json' };
import { skyThingsOf } from './world-env.ts';

function world(ops: unknown[]) {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'sky' });
  const have = new Set(CORE_KIT.map((d) => d.name));
  for (const d of [...CORE_KIT, ...([...terrainKit, ...transportKit] as unknown as DefInput[]).filter((d) => !have.has(d.name) && (have.add(d.name), true))]) w.defineDef(d, 'core', 0);
  const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } };
  assert.equal(r.result.accepted, true, JSON.stringify(r.result).slice(0, 400));
  return w as never;
}
test('balloons follow the world; fog banks lie over its big water', () => {
  const bay = { op: 'place', def: 'core/lake@1', name: 'bay', shape: { area: [[-300, 100], [300, 100], [300, 400], [-300, 400]] }, params: { level: -0.5 } };
  const pond = { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[-20, -20], [20, -20], [20, 20], [-20, 20]] } };
  const bench = { op: 'place', def: 'core/bench@1', name: 'bench', p: [50, -50] };
  const balloon = { op: 'place', def: 'core/balloon@1', name: 'balloon', p: [-50, 0] };
  const a = skyThingsOf(world([bay, pond, bench, balloon]), undefined);
  assert.equal(a.tracks?.length, 4); assert.deepEqual(a.band, [-300, 100, 300, 400, -0.5]);
  assert.equal(skyThingsOf(world([bay, pond, bench, balloon]), false).tracks, null, 'sky.balloons false: none');
  const b = skyThingsOf(world([pond, bench]), undefined);
  assert.equal(b.tracks, null, 'no balloons of its own: none'); assert.equal(b.band, null, 'a pond is too small for fog banks');
  assert.equal(skyThingsOf(world([pond, bench]), true).tracks?.length, 4, 'sky.balloons true');
});
