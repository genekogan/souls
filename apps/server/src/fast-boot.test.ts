// Lane P5 (fast cold boot): a cold boot skips derived work it used to repeat (the flat navigation grids a ground world
// replaces unread, a second decode of the engine snapshot) and defers what no visitor waits for. None of it may change
// the world: an Eden 2026 copy with a walking Soul, restarted from its snapshot, must have the same engine, physical
// and kernel state, the same god model, and step on to the same state as the world that kept running.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { kernelHash } from '@souls/kernel';
import { bootEden } from '../test/eden-capabilities-timing.ts';
import { accept, factory } from '../test/native-owner-fixture.ts';
import { WorldHost } from './world.ts';
import { GodMode } from './god/god.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json';

test('cold boot: a restarted Eden 2026 is the world it was, and steps on identically', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const caps = w.edge.capabilities(w.soul) as { verb: string; available?: boolean; id: string; target?: { kind?: string; id?: string } }[];
  const here = new Set(w.edge.places.containing(0, 0, 0).map((p) => p.id));   // the Soul arrives at the origin
  const walk = caps.find((c) => c.verb === 'walk' && c.available && c.target?.kind === 'place' && !here.has(c.target.id!));
  assert.ok(walk, 'the Soul has a place to walk to');
  await accept(w.host, Promise.resolve(w.edge.act(w.soul, { capability: walk.id })));
  await w.settle(20);
  const body = () => w.host.engine.world.entities[w.soul.entityId].pose.p.slice();
  const at = body();

  // a restart here: the snapshot the process saves on SIGTERM, restored as a cold boot restores it
  const snap = w.host.saveSnapshot(true);
  const row = w.db.latestSnapshot(w.host.worldId)!;
  assert.equal(row.tick, snap.tick);
  const restored = factory.restore(structuredClone((row.body as { runtime: never }).runtime));
  assert.equal(restored.stateHash(), w.host.engine.stateHash(), 'restored engine state');
  assert.equal(restored.physicalHash(), w.host.engine.physicalHash(), 'restored physical state');

  // the live world walks on; its inputs are logged, so a boot replays them
  await w.settle(60);
  assert.notDeepEqual(body(), at, 'the Soul walked (the restored navigation is exercised)');
  const live = { tick: w.host.engine.world.tick, engine: w.host.engine.stateHash(), physical: w.host.engine.physicalHash(), kernel: kernelHash(w.host.kernel) };
  const model = JSON.stringify(w.god.model.snapshot());
  w.host.stop();

  // a cold boot of the same data: snapshot, replayed log, then plain steps up to the live world's tick
  const b = new WorldHost(w.db, factory, (w.host as unknown as { seed: string }).seed, 1e9, w.host.worldId);
  const booted = b.boot();
  assert.equal(booted.from, 'snapshot');
  assert.ok(b.engine.world.tick <= live.tick);
  while (b.engine.world.tick < live.tick) b.tickOnce();
  assert.deepEqual({ tick: b.engine.world.tick, engine: b.engine.stateHash(), physical: b.engine.physicalHash(), kernel: kernelHash(b.kernel) }, live);
  b.stop();

  // the god's model, loaded from its store as a boot loads it
  const god = new GodMode(w.db, { worldId: w.host.worldId, ownerId: 'dev:admin', tick: () => live.tick, emit: () => {} });
  assert.equal(JSON.stringify(god.model.snapshot()), model, 'god model');
});
