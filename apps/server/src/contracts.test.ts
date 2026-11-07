import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '@souls/engine-contract';
import { recordedTakeStreamSchema, recordedTakeChunkSchema, scenePublicationSchema, ownerSoulDashboardSchema, steerReceiptSchema } from '@souls/protocol';
import { worldPresentationFixtures } from '../test/fixtures/w.ts';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';
import { TakeRecorder, type TakeSource } from '../../../mars/viewer/engine/take/recorder.ts';
import { addAll, emptyWorld, human } from '../../../mars/viewer/engine/world/factory.ts';
import type { SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';

test('W/G real four-world producer fixtures cross JSON with private state only in owner projection', async () => {
  const fixtures = await worldPresentationFixtures(); assert.equal(fixtures.length, 4);
  for (const f of fixtures) {
    const stream = recordedTakeStreamSchema.parse(f.stream); scenePublicationSchema.parse(f.scene);
    const owner = ownerSoulDashboardSchema.parse(f.owner);
    assert.equal(owner.status.id, f.soulId); assert.ok(JSON.stringify(owner).includes(f.marker));
    assert.equal('journal' in owner.status, f.key !== 'toy');
    assert.ok(!JSON.stringify({ stream, scene: f.scene, projection: f.projection }).includes(f.marker), f.key);
    const lifecycle = stream.chunks.find(c => c.take.removed?.some(r => r.id === f.entityId));
    assert.ok(lifecycle, `${f.key} real recorder removal`);
    assert.ok(lifecycle.fromTick > 0, 'test a nonzero absolute origin');
    const take = lifecycle.take as unknown as Take;
    const removal = take.removed!.find(r => r.id === f.entityId)!;
    assert.ok(take.entities0?.[f.entityId]);
    assert.equal(take.entities0![f.entityId].body?.family ?? 'humanoid', f.key === 'littlemartians' ? 'floater' : 'humanoid');
    const hash = hashOf(take);
    assert.ok(sampleTake(take, (removal.t - 1) * take.dt).entities[f.entityId], 'historical actor before removal');
    assert.equal(sampleTake(take, removal.t * take.dt).entities[f.entityId], undefined, 'actor absent at removal tick');
    assert.equal(hashOf(take), hash, 'sampling never mutates recorded data');
    assert.equal(recordedTakeChunkSchema.safeParse({ ...lifecycle, fromTick: lifecycle.fromTick + 1 }).success, false, 'wrong origin is refused');
  }
});

test('W field codec preserves hand/speed quanta and exact null clears at nonzero tick origin', () => {
  const scene: SpatialScene = { bounds: [-10, -10, 10, 10], levels: [{ id: 0, y: 0, label: 'Fixture ground' }], surfaces: [], obstacles: [], links: [] };
  const world = emptyWorld('codec-fixture', scene); world.tick = 100; addAll(world, human('a', 1, 2));
  const source: TakeSource = { world, get tick() { return world.tick; }, stateHash: () => hashOf(world), events: [], observers: [] };
  const recorder = new TakeRecorder(source, { rulesVersion: 'field-fixture/1', fieldTol: { hands: 0, speed: 0 } });
  world.entities.a.human!.hands = { left: [1, 1.25, 2] }; world.entities.a.human!.speed = 0.8;
  world.tick++; recorder.onTick();
  delete world.entities.a.human!.hands; delete world.entities.a.human!.speed;
  world.tick++; recorder.onTick();
  const take = recorder.finish();
  const decoded = recordedTakeChunkSchema.parse(JSON.parse(JSON.stringify({ fromTick: 100, toTick: 102, take }))).take as unknown as Take;
  assert.deepEqual(decoded.changes.find(c => c[2] === 'hands' && c[0] === 1)?.[3], { left: [1000, 1250, 2000] });
  assert.equal(decoded.changes.find(c => c[2] === 'speed' && c[0] === 1)?.[3], 80);
  assert.ok(decoded.changes.some(c => c[0] === 2 && c[2] === 'hands' && c[3] === null));
  assert.ok(decoded.changes.some(c => c[0] === 2 && c[2] === 'speed' && c[3] === null));
  assert.deepEqual(sampleTake(decoded, decoded.dt).entities.a.hands?.left, [1, 1.25, 2]);
  assert.equal(sampleTake(decoded, 2 * decoded.dt).entities.a.hands, undefined);
});

test('W older optional shapes decode, unknown schemas and malformed poses fail explicitly', () => {
  const scene: SpatialScene = { bounds: [-1, -1, 1, 1], levels: [], surfaces: [], obstacles: [], links: [] };
  const world = emptyWorld('old-fixture', scene); addAll(world, human('a', 0, 0));
  const source: TakeSource = { world, get tick() { return world.tick; }, stateHash: () => hashOf(world), events: [], observers: [] };
  const take = new TakeRecorder(source, { rulesVersion: 'legacy-fixture/1' }).finish();
  for (const schema of ['mars-take/1', 'mars-take/2', 'mars-take/3', 'mars-take/4']) {
    const legacy: Record<string, unknown> = { ...take, schema }; delete legacy.entities0; delete legacy.removed;
    assert.equal(recordedTakeChunkSchema.safeParse({ fromTick: 0, toTick: 0, take: legacy }).success, true);
  }
  assert.equal(recordedTakeChunkSchema.safeParse({ fromTick: 0, toTick: 0, take: { ...take, schema: 'unqualified/9' } }).success, false);
  assert.equal(recordedTakeChunkSchema.safeParse({ fromTick: 0, toTick: 0, take: { ...take, tracks: { a: [[0, null, 0, 0, 0]] } } }).success, false);
  assert.deepEqual(scenePublicationSchema.parse({ scene: null }), { scene: null });
});

test('G accepted and rejected align receipts decode distinctly without claiming physical completion', () => {
  const rule = { id: 'r', words: 'rest', strict: false, understanding: 'Rest', agenda: [{ card: 'rest', target: null }], trigger: { kind: 'none' }, status: 'active', report: null };
  const accepted = steerReceiptSchema.parse({ ok: true, rule, text: 'Rest', tick: 7, seq: 8, via: 'align', minted: [] });
  assert.ok(accepted.ok); assert.equal(accepted.rule.status, 'active');
  assert.equal(steerReceiptSchema.parse({ ok: false, reason: 'No known target', via: 'align' }).ok, false);
  assert.equal(steerReceiptSchema.safeParse({ ok: true, text: 'done' }).success, false);
});
