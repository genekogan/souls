// Stage B (lane B-spatial): the replica answers every mirrored spatial read exactly as the engine does, from the static
// scene export (structured-cloned, as a worker receives it) plus bodies, windows and the connectivity flag; and after a
// static change it rebuilds in place and agrees again. Flat and paged-ground worlds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { groundFact } from '../../../../packages/engine-mars/src/ground-bridge.ts';
import { emptyGround } from '../../../../packages/ground/src/index.ts';
import { SpatialReplica, type ReplicaBody } from './spatial-replica.ts';
import type { StaticExportV1 } from '../../../../mars/viewer/engine/spatial/service.ts';

const factory = await marsFactory(GREEN_FIELD_WORLD);
type V2 = [number, number];
type Eng = Record<string, (...a: never[]) => unknown> & { world: { entities: Record<string, { kind: string; pose: { p: number[] }; human?: { level?: number } }> };
  exportStaticScene(): StaticExportV1; installGroundV1(f: unknown): unknown; spawnHuman(o: unknown): string; installNavV1(s: unknown): { installed: boolean };
  rt: { services: { spatial: { pageRectsV1(): [number, number, number, number][] | null } } }; conn?: { ready: boolean } };

function world(paged: boolean | null): Eng {
  const e = factory.create(factory.genesis('replica')) as never as Eng;
  if (paged !== null) { const g = emptyGround(600); e.installGroundV1(groundFact(g, 1, { paged })); }
  for (const [i, n] of ['ana', 'bo', 'cy'].entries()) e.spawnHuman({ id: `h_${n}`, label: n, soul: `s_${n}`, ...(i ? {} : {}) });
  return e;
}
const solids = (k: number) => ({ version: 'nav/1', ground: [], solids: Array.from({ length: k }, (_, i) => ({ id: `box${i}`, c: [4 + i * 3, 2 - i] as V2, half: [0.8, 0.5] as V2, yaw: i * 0.4, height: 2 })) });
const bodies = (e: Eng): ReplicaBody[] => Object.entries(e.world.entities).filter(([, o]) => o.kind === 'human').map(([id, o]) => ({ id, x: o.pose.p[0], y: o.pose.p[1], z: o.pose.p[2], level: o.human?.level ?? 0, human: true }));
function sync(e: Eng, r: SpatialReplica) {
  r.applyBodies({ bodies: bodies(e) }); r.applyPages(e.rt.services.spatial.pageRectsV1()); r.applyNavReady(e.conn?.ready);
}
function same(e: Eng, r: SpatialReplica, what: string) {
  const R = r as unknown as Record<string, (...a: unknown[]) => unknown>, E = e as unknown as Record<string, (...a: unknown[]) => unknown>;
  const calls: [string, unknown[]][] = [['staticEpochV1', []], ['navEpochV1', []], ['levelsV1', []], ['clearSpotsV1', [[[-6, -6], [12, -6], [12, 8], [-6, 8]], 5]]];
  for (let x = -4; x <= 14; x += 1.7) for (let z = -3; z <= 5; z += 1.3) {
    calls.push(['clearanceAtV1', [x, z]], ['clearanceUpToV1', [x, z, 1]], ['lyingRoomAtV1', [x, z, 0, 0.1]], ['standYAtV1', [x, z]], ['dryGroundAtV1', [x, z]],
      ['nearestStandableV1', [[x, z], 'h_ana']], ['nearestStandableV1', [[x, z], undefined, 0.6, 24, false]], ['standableNearV1', [[x, z], 0, 'h_bo', 0.4, 6]]);
  }
  calls.push(['navCheckV1', [[{ id: 'a', p: [0, 0] }, { id: 'b', p: [5, 2] }, { id: 'c', p: [7.2, 0.9], tol: 0.5 }]]], ['navNearestMainV1', [[5, 2], 'h_cy']], ['navWarmV1', [0]]);
  for (const [m, a] of calls) {
    const want = E[m](...structuredClone(a)); sync(e, r);
    assert.deepStrictEqual(R[m](...structuredClone(a)), want, `${what}: ${m}(${JSON.stringify(a)})`);
  }
}

for (const [name, paged] of [['flat', null], ['ground', false], ['paged ground', true]] as const) {
  test(`replica equals the engine on a ${name} world, and after a static change`, () => {
    const e = world(paged);
    assert.equal(e.installNavV1(solids(3)).installed, true);
    const E = e as unknown as { clearanceUpToV1(x: number, z: number, c: number): number };
    assert.ok(E.clearanceUpToV1(4, 2, 1) < 0.5 && E.clearanceUpToV1(-4, -3, 1) === 1, 'the solids are in the nav');
    const s0 = structuredClone(e.exportStaticScene()), r = SpatialReplica.fromStaticScene(s0, bodies(e));
    same(e, r, 'built');
    assert.equal(e.installNavV1(solids(5)).installed, true);
    const s1 = structuredClone(e.exportStaticScene());
    assert.ok(r.differs(s1), 'the export moved with the static change');
    r.rebuild(s1);
    same(e, r, 'rebuilt');
  });
}
