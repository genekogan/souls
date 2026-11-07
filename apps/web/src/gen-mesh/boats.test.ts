// W2b: boats on water bob and drift; a boat beside a pier or the bank is moored (sways, no drift); one on land is still.
//   node --test apps/web/src/gen-mesh/boats.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type DefInput } from '@souls/world-compiler';
import terrainKit from '../../../../packages/world-compiler/src/core-kit/terrain.json' with { type: 'json' };
import transportKit from '../../../../packages/world-compiler/src/core-kit/transport.json' with { type: 'json' };
import { boatRest, hasMotion, isBoat } from './motion.ts';

function world() {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'boats' });
  const have = new Set(CORE_KIT.map((d) => d.name));
  for (const d of [...CORE_KIT, ...([...terrainKit, ...transportKit] as unknown as DefInput[]).filter((d) => !have.has(d.name) && (have.add(d.name), true))]) w.defineDef(d, 'core', 0);
  return w;
}
test('open water drifts, a pier moors, land beaches', () => {
  const w = world();
  const r = applyBatch(w, { ops: [
    { op: 'place', def: 'core/lake@1', name: 'lake', shape: { area: [[-60, -60], [60, -60], [60, 60], [-60, 60]] }, params: { level: -0.3 } },
    { op: 'place', def: 'core/pier@1', name: 'jetty', shape: { path: [[-60, 0], [-30, 0]] }, params: { width: 2 } },
    { op: 'place', def: 'core/rowing-boat@1', name: 'middle', p: [10, 10] },
    { op: 'place', def: 'core/rowing-boat@1', name: 'tied', p: [-40, 2.6] },
  ] } as never, 'god', 0) as { result: { accepted: boolean } };
  assert.equal(r.result.accepted, true, JSON.stringify(r.result).slice(0, 600));
  const rest = (name: string) => { const e = w.get(name)!, d = w.resolvedDef(e.def)!; assert.ok(isBoat(d) && hasMotion(d)); const p = w.worldPose(e); return boatRest(w, e, d, p.x, p.z); };
  const mid = rest('middle'), tied = rest('tied'), m = w.get('middle')!, ashore = boatRest(w, m, w.resolvedDef(m.def)!, 100, 100);
  assert.equal(mid.moored, false); assert.ok(mid.drift > 3 && mid.drift <= 6, JSON.stringify(mid));
  assert.equal(tied.moored, true); assert.equal(tied.drift, 0);
  assert.equal(ashore.beached, true);
  assert.equal(boatRest(null, w.get('middle')!, w.resolvedDef(w.get('middle')!.def)!, 10, 10).moored, true, 'no model: sway in place');
});
