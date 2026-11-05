// #374 (F3): joining the eden-district ferris wheel from the Commons failed `route.goal-blocked` at the boarding point.
// The join walks to the ride carrier with a 2.2 m standoff; on paged ground a long walk's plan checks only its first fine
// hop, so the first standoff point, inside the wheel's own collider, passed the plan and failed at the last hop. A ride
// join's walk is `stand: 'clear/1'` (engine goalNear): only a standoff point with standing room for the walker's body is
// taken, else the nearest standable point within 4 m. An unmarked step keeps the goal it always chose (exact replay).
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import fs from 'node:fs';
import {fixture, factory, invite, accept} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {GodMode} from './god/god.ts';
import {installEngineBridge} from './god/engine-bridge.ts';
import {GroundHost} from './god/ground-host.ts';
import {Hono} from 'hono';
import {mountEdgeRoutes} from './edge/routes.ts';

/** The engine's goal check: the body's radius (0.28 m) plus the route's planning margin (0.06 m). */
const ROOM = 0.34;
const JOIN = 'object:ride-region-seaside-resort.ferris-wheel:join';
async function district(t: TestContext, names: string[]) {
  const w = fixture(':memory:', factory, {durableClockV1: true}); w.brain.quiesce();
  const genesis = JSON.parse(fs.readFileSync(new URL('../../../worlds/templates/eden-district.json', import.meta.url), 'utf8'));
  const god = new GodMode(w.db, {worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {}, genesis});
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db, undefined, {ambient: false});
  const comms = mountEdgeRoutes(new Hono(), {host: w.host, db: w.db, souls: w.souls, ledger: edge, soul: () => null as never});
  installEngineBridge({host: w.host, god, edge, log() {}, worldClock: false, worldLore: false});
  t.after(() => {w.brain.quiesce(); comms.close(); w.host.stop(); w.db.close();});
  const tick = async (n = 1, until?: () => boolean) => {for (let i = 0; i < n && !until?.(); i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  await tick(60);
  const souls = [];
  for (const name of names) {
    await invite(w, name.toLowerCase());
    const row = await accept(w.host, w.souls.create(`dev:${name.toLowerCase()}`, {name, description: 'F3 rider'}));
    souls.push({soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner});
  }
  await tick(20);
  return {w, god, edge, tick, souls, engine: w.host.engine as unknown as {
    programs: Map<string, {steps: {verb: string; params: Record<string, unknown>}[]}>; programOf(id: string): string | null;
    clearanceAtV1(x: number, z: number): number; world: {entities: Record<string, {pose: {p: number[]}; human?: {activity?: string}}>}}};
}

test('F3 (#374): a ride join from the Commons walks to a boarding point with standing room and boards the ferris wheel', {timeout: 900000}, async t => {
  const {w, edge, tick, souls: [pip], engine} = await district(t, ['Pip']);
  const at0 = engine.world.entities[pip.entityId].pose.p;
  assert.ok(Math.hypot(at0[0], at0[2]) < 3, `Pip starts at the Commons (${at0})`);
  const r = await accept<{receipt?: {id: string}; accepted?: boolean}>(w.host, edge.act(pip, {capability: JOIN}));
  assert.notEqual(r.accepted, false, JSON.stringify(r));
  const id = r.receipt!.id, prog = engine.programs.get(engine.programOf(pip.entityId)!)!;
  const walk = prog.steps.find(s => s.verb === 'walk_to')!;
  assert.equal(walk.params.stand, 'clear/1', 'the join walk asks for a standing point with room');
  // the historical choice (no marker) is the first standoff point, inside the wheel's collider; the marked one has room
  const goalNear = (w.host.engine as unknown as {goalNear(a: string, to: unknown, off: number, stand?: unknown): {x: number; z: number} | 'here' | {code: string}}).goalNear.bind(w.host.engine);
  const old = goalNear(pip.entityId, walk.params.to, 2.2), now = goalNear(pip.entityId, walk.params.to, 2.2, 'clear/1');
  assert.ok(typeof old === 'object' && 'x' in old && typeof now === 'object' && 'x' in now, JSON.stringify({old, now}));
  const radius = ROOM;
  t.diagnostic(`unmarked goal (${old.x}, ${old.z}) clearance ${engine.clearanceAtV1(old.x, old.z).toFixed(2)}; marked goal (${now.x}, ${now.z}) clearance ${engine.clearanceAtV1(now.x, now.z).toFixed(2)}`);
  assert.ok(engine.clearanceAtV1(old.x, old.z) < radius, 'unmarked: the same goal as before, without room (exact replay keeps it)');
  assert.ok(engine.clearanceAtV1(now.x, now.z) >= radius, 'marked: a goal with standing room');
  let seated = false;
  await tick(3000, () => {seated ||= (edge as unknown as {aboard(id: string): {riderPhase?: string} | null}).aboard(pip.entityId)?.riderPhase === 'seated'; return edge.receipt(pip.soulId, id)?.phase !== 'started' && edge.receipt(pip.soulId, id)?.phase !== 'waiting';});
  const rc = edge.receipt(pip.soulId, id)!;
  assert.equal(rc.phase, 'completed', JSON.stringify({phase: rc.phase, code: rc.code, reason: rc.reason}));
  assert.notEqual(rc.code, 'route.goal-blocked');
  assert.ok(seated, 'Pip was seated in the wheel');
});

/** A patch of walls 0.6 m apart (no standing room between them), `half` metres around (cx, cz). */
const thicket = (name: string, cx: number, cz: number, half: number) => Array.from({length: Math.round(half / 0.3) + 1}, (_, i) => ({op: 'place', def: 'core/garden-wall@1', name: `${name}-${i}`,
  shape: {path: [[cx - half, cz - half + i * 0.6], [cx + half, cz - half + i * 0.6]]}}));

test('F3 (#374) stand/1: every turn around the target without room falls back to a point at most 1 m further out, and the walk ends there; none is refused, named', {timeout: 900000}, async t => {
  const {w, god, tick, souls: [pip], engine} = await district(t, ['Pip']);
  const goalNear = (w.host.engine as unknown as {goalNear(a: string, to: unknown, off: number, stand?: unknown): {x: number; z: number} | 'here' | {code: string; message: string}}).goalNear.bind(w.host.engine);
  // each patch on the first open ground near the Commons that the god may build on (the template's trees are solid)
  const at = engine.world.entities[pip.entityId].pose.p, spots = [[-10, 2], [-14, -16], [16, -6], [-18, 14], [10, 14], [-24, -2], [22, 8], [0, -24]].map(([dx, dz]) => [at[0] + dx, at[2] + dz] as [number, number]);
  const build = (name: string, half: number, not?: [number, number]): [number, number] => {
    for (const c of spots) {
      if (not && Math.hypot(c[0] - not[0], c[1] - not[1]) < 25) continue;
      if (engine.clearanceAtV1(c[0], c[1]) < 1) continue;
      const r = god.act({ops: thicket(name, c[0], c[1], half)}) as {accepted?: boolean}; if (r.accepted !== false) return c;
    }
    throw new Error(`no open ground for ${name}`);
  };
  const A = build('small', 2), B = build('large', 10, A); await tick(40);
  const radius = ROOM;
  // the small patch: no turn at 2.2 m from its centre has room; a point on a wider ring (at most 1 m further) is taken
  const small = goalNear(pip.entityId, A, 2.2, 'clear/1');
  assert.ok(typeof small === 'object' && 'x' in small, JSON.stringify(small));
  assert.ok(engine.clearanceAtV1(small.x, small.z) >= radius, `room at the fallback point ${small.x},${small.z}`);
  const d = Math.hypot(small.x - A[0], small.z - A[1]);
  assert.ok(d > 2.2 && d <= 2.2 + 1 + 1e-6, `beside the patch, no further than 1 m past the standoff (${d.toFixed(2)} m from its centre)`);
  // and the walk itself ends there
  await accept(w.host, w.host.enqueue('decision', `soul:${pip.soulId}`, {soulId: pip.soulId, entityId: pip.entityId, option: 'walk', label: 'walk',
    steps: [{verb: 'walk_to', params: {to: A, standoff: 2.2, stand: 'clear/1'}}], reevalTicks: 10000, trigger: 'fixture', fallback: false}));
  await tick(2000, () => !engine.programOf(pip.entityId));
  const end = engine.world.entities[pip.entityId].pose.p;
  assert.ok(Math.hypot(end[0] - small.x, end[2] - small.z) < 0.5, `the walk arrived at the chosen point: ${end} vs ${small.x},${small.z}`);
  // the large patch: no standable point within 4 m of the first turn; refused as the walk's own goal refusal, named
  const large = goalNear(pip.entityId, B, 2.2, 'clear/1');
  assert.ok(typeof large === 'object' && 'code' in large, JSON.stringify(large));
  assert.equal(large.code, 'route.goal-blocked'); assert.match(large.message, /no standing room for a 0\.3\d m-radius body 2\.2 m from the target .* or up to 1 m beyond it around the target \(blocked by e_[0-9a-f]+/, large.message);
  t.diagnostic(`fallback (${small.x}, ${small.z}); refusal: ${large.message}`);
});
