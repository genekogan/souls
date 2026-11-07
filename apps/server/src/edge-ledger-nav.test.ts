// nav/1 (Gene 2026-10-07: "souls walk straight through buildings"): every enclosed building, water and World's
// scenery solids are solid to the walk planner; the library is enterable only through its door; new ground reaches
// the park. Many sampled walks across the map never cross a footprint; walks to every native place still arrive.
import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldHost} from './world.ts';
import {kernelHash} from '@souls/kernel';
import {HUMAN_PROFILE} from '../../../mars/viewer/engine/spatial/types.ts';
import {HUMAN_RADIUS} from '../../../mars/viewer/engine/world/catalog.ts';
import {edenNavWorld, inSolid} from '../test/eden-nav-fixture.ts';

const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

test('nav/1: sampled routes across the whole map never cross a building, water or scenery footprint', {timeout: 600000}, async t => {
  const w = await edenNavWorld(1); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const solids = w.spec!.solids, sp = w.engine.rt.services.spatial, world = w.engine.world;
  assert.ok(solids.length > 40, `solids ${solids.length}`);
  assert.ok(solids.some(s => s.id.startsWith('eden-house-1')) && solids.some(s => s.id === 'int-cafe') && solids.some(s => s.id.startsWith('eden-library-1#w')) && solids.some(s => s.id.startsWith('region-park.pond#')), 'houses, new shells, the library walls and the park pond');
  assert.ok(!solids.some(s => s.id === 'eden-classroom-1'), 'the native classroom keeps its own geometry');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
  const [x0, z0, x1, z1] = w.engine.groundBoundsV1(), r = rng(7), pts: [number, number][] = [];
  while (pts.length < 240) {const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0); if (w.engine.clearanceAtV1(x, z) >= HUMAN_RADIUS + 0.1) pts.push([x, z]);}
  let routed = 0, failed = 0, crossings: string[] = [], metres = 0;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const res = sp.route(world, HUMAN_PROFILE, {level: 0, p: pts[i]}, {level: 0, p: pts[i + 1]});
    if (!res.ok) {failed++; continue;}
    routed++;
    for (const leg of res.route.legs) if (leg.kind === 'walk') for (let k = 0; k + 1 < leg.points.length; k++) {
      const [a, b] = [leg.points[k], leg.points[k + 1]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1)); metres += Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let j = 0; j <= n; j++) {const x = a[0] + (b[0] - a[0]) * j / n, z = a[1] + (b[1] - a[1]) * j / n; for (const s of solids) if (inSolid(x, z, s, 0.02)) crossings.push(`${s.id} @${x.toFixed(1)},${z.toFixed(1)}`);}
    }
  }
  t.diagnostic(JSON.stringify({routes: routed, unreachable: failed, metres: Math.round(metres), solids: solids.length}));
  assert.deepEqual(crossings.slice(0, 5), [], 'no route crosses a footprint');
  assert.ok(routed >= 100, `most sampled pairs are mutually reachable (${routed} routed, ${failed} not)`);
  // The library is a shell: its reading corner is reachable from the commons only through the south door.
  const lib = sp.route(world, HUMAN_PROFILE, {level: 0, p: [14, 4]}, {level: 0, p: [77, -5]});
  assert.ok(lib.ok, 'into the library');
  const pts2 = lib.ok ? lib.route.legs.flatMap((l: any) => l.kind === 'walk' ? l.points : []) : [];
  assert.ok(pts2.some((p: number[]) => p[0] > 72.8 && p[0] < 75.2 && Math.abs(p[1] + 3) < 0.6) || pts2.some((p: number[], i: number) => i > 0 && (pts2[i - 1][1] > -2.8) !== (p[1] > -2.8) && Math.min(pts2[i - 1][0], p[0]) > 72.8 && Math.max(pts2[i - 1][0], p[0]) < 75.2), 'through the door gap');
});

test('nav/1: walks to every native place arrive; no body is ever inside a footprint; stroll through the park and back to the fire; replay exact', {timeout: 900000}, async t => {
  const w = await edenNavWorld(4); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const solids = w.spec!.solids, inside: string[] = [];
  const watch = () => {for (const s of w.souls) {const b = w.engine.world.entities[s.entityId]; if (!b?.human || b.human.level !== 0) continue; for (const q of solids) if (inSolid(b.pose.p[0], b.pose.p[2], q, HUMAN_RADIUS * 0.5)) inside.push(`${s.name} in ${q.id} @${b.pose.p[0].toFixed(1)},${b.pose.p[2].toFixed(1)}`);}};
  const caps = w.ledger.capabilities(w.souls[0]), walks = caps.filter(c => c.verb === 'walk' && c.target?.kind === 'place' && !/mat-\d+$/.test(c.id)).map(c => c.id);
  assert.ok(walks.includes('walk:region-park') && walks.includes('walk:eden-library-1'), 'the park and the library are walk targets: ' + walks.join(','));
  const outcome: Record<string, string> = {};
  for (let i = 0; i < walks.length; i += w.souls.length) {
    const batch = walks.slice(i, i + w.souls.length), rs: {soulId: string; id: string}[] = [];
    for (const [k, cap] of batch.entries()) {const out: any = await w.act(w.souls[k], cap); assert.equal(out.accepted, true, cap + ' ' + JSON.stringify(out)); rs.push({soulId: w.souls[k].soulId, id: out.receipt.id});}
    await w.run(rs, 6000, watch);
    for (const [k, r] of rs.entries()) {const rc = w.ledger.receipt(r.soulId, r.id)!; outcome[batch[k]] = rc.phase + (rc.code ? ':' + rc.code : '');}
  }
  t.diagnostic(JSON.stringify(outcome));
  assert.deepEqual(Object.entries(outcome).filter(([, v]) => v !== 'completed'), [], 'every native place is reached');
  // "take a walk through the park, and then come back to the fire": one act with a via leg, or two acts in turn.
  const s0 = w.souls[0], stroll: any = await w.act(s0, 'take a walk through the park');
  assert.equal(stroll.accepted, true, JSON.stringify(stroll)); assert.equal(stroll.resolved?.to, 'stroll:region-park');
  const seen: [number, number][] = [];
  await w.run([{soulId: s0.soulId, id: stroll.receipt.id}], 9000, () => {watch(); const b = w.engine.world.entities[s0.entityId]; seen.push([b.pose.p[0], b.pose.p[2]]);});
  assert.equal(w.ledger.receipt(s0.soulId, stroll.receipt.id)!.phase, 'completed');
  const inPark = seen.filter(([x, z]) => x > -30 && x < 33 && z > 95 && z < 134);
  assert.ok(inPark.length > 100 && Math.max(...inPark.map(p => p[0])) - Math.min(...inPark.map(p => p[0])) > 20, 'a real path through the park, not one point');
  const back: any = await w.act(s0, 'come back to the fire');
  assert.equal(back.accepted, true, JSON.stringify(back)); assert.match(back.resolved?.to, /^walk:social-eden-fire/);
  await w.run([{soulId: s0.soulId, id: back.receipt.id}], 6000, watch);
  assert.equal(w.ledger.receipt(s0.soulId, back.receipt.id)!.phase, 'completed');
  const via: any = await w.act(w.souls[1], 'walk:social-eden-fire-circle', {via: ['the park']});
  assert.equal(via.accepted, true, JSON.stringify(via));
  await w.run([{soulId: w.souls[1].soulId, id: via.receipt.id}], 12000, watch);
  assert.equal(w.ledger.receipt(w.souls[1].soulId, via.receipt.id)!.phase, 'completed');
  assert.deepEqual(inside.slice(0, 5), [], 'no body inside a footprint');
  assert.deepEqual(w.f.host.engine.runtime.violations.filter((v: any) => v.code === 'collision.human-static'), []);
  // genesis replay reproduces the nav fact and everything after it
  w.f.host.drainInputs(); w.f.host.saveSnapshot(true); const head = {engine: w.f.host.engine.stateHash(), kernel: kernelHash(w.f.host.kernel)};
  w.f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.f.host.worldId);
  const h = new WorldHost(w.f.db, w.fac, w.f.host.seed, 1e9, w.f.host.worldId, {durableClockV1: true}); assert.equal(h.boot().from, 'genesis');
  assert.deepEqual({engine: h.engine.stateHash(), kernel: kernelHash(h.kernel)}, head, 'replay exact'); h.stop();
});
