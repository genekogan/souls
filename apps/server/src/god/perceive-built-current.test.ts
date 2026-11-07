// L8 (server reliability 2026-10-31): built objects' advance is refresh-only (listings never run it; perceive brings each
// object in line when its wanted state changes). Oracle: after EVERY slice of a catch-up, each built object's stored state
// (what `here`, `observe` and /v1/edge/objects read) equals what perceive wants for it, so a nearby Soul's next read shows
// a god edit's effect (a sign's new words) with no refresh or sweep call. Distant objects are not advanced by listings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@souls/world-compiler';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { canonicalJson } from '../edge/comms/objects/table.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('built objects are current after every catch-up slice; a nearby Soul sees a sign edit with no refresh call', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const { Hono } = await import('hono');
  const { mountEdgeRoutes, edgeSoulResolver } = await import('../edge/routes.ts');
  const comms = mountEdgeRoutes(new Hono(), { host: f.host, db: f.db, souls: f.souls, soul: edgeSoulResolver(f.host, f.souls, () => undefined), ledger: edge } as never);
  t.after(() => comms.close());
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const me = (f.host.engine.world.entities as any)[soul.entityId].pose.p as number[];
  const P = bridge.perceive as any;
  const act = (ops: unknown[]) => { const r = god.act({ ops } as never) as any; assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600)); };
  act([
    { op: 'place', def: 'core-sign@1', name: 'notice', p: [me[0] + 2, me[2] + 1], state: { text: 'Welcome' } },
    { op: 'place', def: coreRef('fountain'), name: 'fountain', p: [me[0] - 3, me[2]] },
    ...Array.from({ length: 12 }, (_, i) => ({ op: 'place', def: coreRef('lamp-post'), name: `lamp-${i}`, p: [me[0] - 6 + i, me[2] + 4] })),
    { op: 'place', def: 'core-sign@1', name: 'far-notice', p: [me[0] + 400, me[2] + 400], state: { text: 'Far away' } },
  ]);
  await settle(4);
  P.sync(true);
  const objs = P.objects();
  const id = (name: string) => god.model.get(name)!.id;
  /** Every built object's stored state equals perceive's wanted state for it. */
  const inLine = (label: string) => {
    for (const [key, want] of P.desired as Map<string, unknown>) {
      const o = objs.all().find((x: any) => x.id === key); if (!o) continue;
      assert.equal(canonicalJson(o.state), canonicalJson(want), `${label}: ${key} stored = wanted`);
    }
  };
  inLine('after the whole pass');
  const text = () => (objs.visibleTo(soul) as any[]).find((o) => o.id === id('notice'))?.public?.text;
  assert.equal(text(), 'Welcome', 'the sign is in the Soul\'s listing');
  // a sign's words and a moved fountain (its `near` changes for the lamps): drive the catch-up one smallest slice at a time
  act([{ op: 'set', id: id('notice'), state: { text: 'Closed today' } }, { op: 'move', id: id('fountain'), p: [me[0] + 1, me[2] + 9] }]);
  assert.equal(P.pending(), true, 'noted');
  let slices = 0;
  while (P.pending() && slices < 10_000) { P.step(0); slices++; inLine(`slice ${slices}`); }
  assert.equal(P.pending(), false, 'caught up');
  assert.ok(slices > 2, `the catch-up took several slices (${slices})`);
  // the Soul's next reads: no refresh, no sweep
  assert.equal(text(), 'Closed today', 'observe/objects listing shows the new words');
  assert.equal((objs.all().find((o: any) => o.id === id('notice'))!.state as any).text, 'Closed today', 'here.ts reads this stored state (objects.all())');
});
