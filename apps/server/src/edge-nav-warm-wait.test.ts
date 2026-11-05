// nav-warm-wait/1 (#884): a walk acted in the first seconds after boot, while the engine's connectivity labels are still cold,
// was refused route.unreachable: its goal skipped RESOLVE2's roofReach (it needs the labels), so the eden-house-3 roof planter
// walk aimed at the roof strip a ridge parts from the stair's terrace. Such an act now waits (receipt `waiting`, bounded,
// replaced by a newer act) and is planned again from the warm goal once navigation is warm; genuine refusals stay refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { bootEden } from '../test/eden-capabilities-timing.ts';
import { invite, accept } from '../test/native-owner-fixture.ts';

const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';
type NavV1 = { navWarmV1(ms: number): boolean };
type Out = { accepted: boolean; code?: string; reason?: string; receipt?: { id: string; phase: string; reason?: string; code?: string } };

test('Eden 2026: a roof walk acted before navigation is warm waits and walks; genuine refusals still refuse', { timeout: 900_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const E = w.host.engine as unknown as NavV1, L = w.edge;
  const soulOf = async (owner: string, name: string) => {
    await invite(w as never, owner);
    const row = await accept(w.host, w.souls.create(`dev:${owner}`, { name, description: 'curious' })) as { id: string; entity_id: string; name: string; owner: string };
    return { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  };
  const bob = await soulOf('bob', 'Bob'), cy = await soulOf('cy', 'Cy'), di = await soulOf('di', 'Di');
  await w.settle(2);
  const roof = 'walk:eden-house-3/eden-house-3-roof-planter-1', kitchen = 'walk:eden-house-3-kitchen/eden-house-3-kitchen-roof-planter-1';
  const phase = (s: { soulId: string }, id: string) => L.receipt(s.soulId, id)!;
  assert.equal(E.navWarmV1(0), false, 'just after boot, navigation is still cold');

  // A1: acted cold, the roof walk is accepted as waiting (it was refused route.unreachable), and the act drains nothing
  const ana = await L.act(w.soul, { capability: roof }) as Out;
  assert.equal(ana.accepted, true, `the roof walk acted before warm is not refused: ${JSON.stringify(ana)}`);
  assert.equal(ana.receipt!.phase, 'waiting');
  assert.match(phase(w.soul, ana.receipt!.id).reason ?? '', /Navigation is still getting ready/);
  assert.equal(E.navWarmV1(0), false, 'the act did not wait for the first build (it relabels for at most 150 ms)');

  // A3: a newer act replaces a waiting one; A2 (cold): the kitchen roof, which no stair reaches, waits too
  const first = await L.act(bob, { capability: roof }) as Out, second = await L.act(bob, { capability: kitchen }) as Out;
  assert.equal(first.accepted && second.accepted, true, `${JSON.stringify(first)} ${JSON.stringify(second)}`);
  assert.equal(phase(bob, first.receipt!.id).phase, 'replaced');
  assert.equal(phase(bob, second.receipt!.id).phase, 'waiting');
  // A3: the wait is bounded: past its deadline it fails with a named code (the deadline is moved, not waited out)
  const third = await L.act(cy, { capability: roof }) as Out; assert.equal(third.receipt?.phase, 'waiting');
  const pending = (L as unknown as { pending: Map<string, { deadline: number; navWarm?: true }> }).pending;
  assert.equal(pending.get(cy.soulId)?.navWarm, true);
  const stored = w.db.db.prepare('SELECT plan FROM edge_receipts_v1 WHERE receipt_id=?').get(third.receipt!.id) as { plan: string };
  assert.equal(JSON.parse(stored.plan).navWarm, true, 'the re-plan flag is stored with the plan (restored after a restart)');
  pending.get(cy.soulId)!.deadline = w.host.engine.world.tick - 1;
  w.host.tickOnce();
  assert.equal(phase(cy, third.receipt!.id).phase, 'failed'); assert.equal(phase(cy, third.receipt!.id).code, 'nav.warm-timeout');

  // a walk that waited for a safe stop (an ordinary wait) and is then refused while still cold waits on for navigation
  const fourth = await L.act(di, { capability: roof }) as Out; assert.equal(fourth.receipt?.phase, 'waiting');
  pending.get(di.soulId)!.navWarm = undefined;   // as the safe-stop path arms it
  w.host.tickOnce();
  assert.equal(phase(di, fourth.receipt!.id).phase, 'waiting', JSON.stringify(phase(di, fourth.receipt!.id)));
  assert.equal(pending.get(di.soulId)?.navWarm, true, 'the ordinary wait became a navigation wait');
  // still cold: nothing starts
  w.host.tickOnce();
  assert.equal(phase(w.soul, ana.receipt!.id).phase, 'waiting');
  // the tick loop warms navigation in slices; here all at once
  assert.ok(E.navWarmV1(Infinity));
  for (let i = 0; i < 40 && phase(w.soul, ana.receipt!.id).phase === 'waiting'; i++) await w.settle(1);
  // A1: planned again from the warm goal, it starts; A2: the kitchen roof is refused by the planner, as any walk
  assert.notEqual(phase(w.soul, ana.receipt!.id).phase, 'waiting'); assert.notEqual(phase(w.soul, ana.receipt!.id).phase, 'failed', JSON.stringify(phase(w.soul, ana.receipt!.id)));
  assert.notEqual(phase(di, fourth.receipt!.id).phase, 'failed', JSON.stringify(phase(di, fourth.receipt!.id)));
  const k = phase(bob, second.receipt!.id); assert.equal(k.phase, 'failed'); assert.equal(k.code, 'route.unreachable');
  for (let i = 0; i < 4000 && phase(w.soul, ana.receipt!.id).phase !== 'completed'; i++) { w.host.tickOnce(); if (i % 20 === 0) await w.settle(1); }
  const done = phase(w.soul, ana.receipt!.id), body = w.host.engine.world.entities[w.soul.entityId] as { human?: { level?: number } };
  assert.equal(done.phase, 'completed', JSON.stringify(done));
  assert.doesNotMatch(done.reason ?? '', /Navigation is still getting ready/, 'the wait reason is cleared once it is warm');
  assert.ok((body.human?.level ?? 0) > 0, 'Ana is up on the house roof');
  // A2 (warm): the kitchen roof is refused at act time, with the reason it had before
  const warm = await L.act(bob, { capability: kitchen }) as Out;
  assert.equal(warm.accepted, false); assert.equal(warm.code, 'route.unreachable'); assert.equal(warm.reason, k.reason);
  // after the first build, moving rides (balloons, carousel, ferris wheel) invalidate the labels; a roof walk bound while they
  // are invalidated (its goal skipped roofReach) relabels in the request (the rescue's own relabel must not hide it), is
  // planned again and starts at once, without a wait
  for (let i = 0; i < 40 && E.navWarmV1(0); i++) await w.settle(1);
  // (rides move on their own schedule; when none moved, the carousel is moved a hair, as its own step does)
  const ents = w.host.engine.world.entities as Record<string, { def?: string; pose: { p: number[] } }>;
  const ride = ['resort-carousel', 'resort-ferris-wheel', 'eden-balloon'].map((id) => ents[id]).find(Boolean);
  assert.ok(ride, 'Eden runs a ride'); if (E.navWarmV1(0)) ride.pose.p[0] += 0.01;
  assert.equal(E.navWarmV1(0), false, 'a moving ride invalidated the labels');
  const pr = L.act(cy, { capability: roof }) as Promise<Out>; await w.settle(2); const again = await pr;
  assert.equal(again.accepted, true, JSON.stringify(again)); assert.notEqual(phase(cy, again.receipt!.id).phase, 'failed');
  assert.doesNotMatch(phase(cy, again.receipt!.id).reason ?? '', /Navigation is still getting ready/, 'relabelled in the request, not waited');
});
