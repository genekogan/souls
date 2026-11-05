// #1031: a crew that lifts facing the other way along a load (the planner's reversed pickup frame) turned it half a
// turn in their hands, because the lift interpolated the load from its lying yaw to the formation's. With `keepYawV1`
// the load keeps its own frame (the carriers stand at the other ends); without it the carry is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { entityFrame, formationFor, laidPose } from '../carry/formation.ts';
import { angleDelta } from '../core/math.ts';
import type { ActionDef } from '../actions/types.ts';
import type { SpatialScene } from '../spatial/types.ts';

const REG = new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry]]);
const open: SpatialScene = { bounds: [-20, -20, 20, 20], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'g', level: 0, y: 0, obb: { c: [0, 0], half: [20, 20], yaw: 0 } }], links: [], obstacles: [] };

/** A load lying along +x at the origin, its crew standing west of it, carried to a spot behind them (east → west). */
function run(def: string, crew: number, keepYawV1: boolean, opts: { cancel?: 'lift' | 'move'; poke?: (rt: Runtime, id: string) => void } = {}) {
  const pose = laidPose(formationFor(def, crew), { x: 0, z: 0, th: 0 }, 0);
  const people = Array.from({ length: crew }, (_, i) => human(`p${i + 1}`, 3, -1.5 + 3 * i / Math.max(1, crew - 1), { yaw: 0 }));
  const w = addAll(emptyWorld('keep-yaw', open), component('L', def, pose.p, pose.yaw, { pose }), ...people);
  const rt = new Runtime(w, REG, { spatial: new Spatial(open) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
  const a = rt.submit('carry', { crew: people.map((p) => p.id), item: 'L', to: { x: -9, z: 0.5, yaw: 0 }, ...(keepYawV1 ? { keepYawV1: true } : {}) });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  const seen = { liftTurn: 0, setDownTurn: 0, maxStep: 0, carried: 0, reversed: false, phases: new Set<string>() };
  let prev = rt.world.entities.L.pose.yaw, from = { phase: '', yaw: 0 };
  const lying = entityFrame(rt.world.entities.L).q.th;
  rt.observers.push({
    onTick() {
      const e = rt.world.entities.L, phase = a.phase ?? '';
      seen.phases.add(phase);
      seen.maxStep = Math.max(seen.maxStep, Math.abs(angleDelta(prev, e.pose.yaw)));
      prev = e.pose.yaw;
      if ((phase === 'lift' || phase === 'set-down') && from.phase !== phase) from = { phase, yaw: e.pose.yaw };
      if (phase === 'lift') seen.liftTurn = Math.max(seen.liftTurn, Math.abs(angleDelta(from.yaw, e.pose.yaw)));
      if (phase === 'set-down') seen.setDownTurn = Math.max(seen.setDownTurn, Math.abs(angleDelta(from.yaw, e.pose.yaw)));
      if (phase === 'move') {
        seen.carried++;
        // each carrier faces along the formation: its heading against the load's lying frame says which way round it lifted
        const h = rt.world.entities.p1.pose.yaw;
        if (seen.carried === 1) seen.reversed = Math.abs(angleDelta(h, lying)) > Math.PI / 2;
        opts.poke?.(rt, a.id);
      }
      if (opts.cancel && phase === opts.cancel && (opts.cancel === 'lift' ? rt.world.entities.L.pose.p[1] > pose.p[1] + 0.1 : seen.carried === 30)) { opts.cancel = undefined; rt.cancel(a.id); }
    },
  });
  rt.runUntilIdle(20 * 120);
  return { rt, a, seen, lying, end: rt.world.entities.L };
}

for (const [def, crew] of [['beam-9ft', 1], ['upright-12ft', 2]] as const) {
  test(`#1031 ${def} × ${crew}: the reversed pickup frame turns the load half a turn without keepYawV1, never with it`, () => {
    const legacy = run(def, crew, false);
    assert.equal(legacy.a.status, 'completed', legacy.a.diagnostic?.message);
    assert.ok(legacy.seen.liftTurn > 3, `legacy: the planner lifted the other way round and the lift turned it (${legacy.seen.liftTurn.toFixed(2)} rad)`);
    const kept = run(def, crew, true);
    assert.equal(kept.a.status, 'completed', kept.a.diagnostic?.message);
    assert.deepEqual(kept.rt.violations.map((v) => v.message), []);
    assert.ok(kept.seen.carried > 40, `carried ${kept.seen.carried} ticks`);
    assert.ok(kept.seen.liftTurn < 0.05, `lift turn ${kept.seen.liftTurn.toFixed(3)} rad`);
    assert.ok(kept.seen.setDownTurn < 0.05, `set-down turn ${kept.seen.setDownTurn.toFixed(3)} rad`);
    assert.ok(kept.seen.maxStep < 0.2, `largest one-tick yaw step ${kept.seen.maxStep.toFixed(3)} rad`);
    // same route, same crew stations, same footprint at the destination; only the load's own encoding differs
    assert.deepEqual(kept.a.outputs && { x: kept.a.outputs.x, z: kept.a.outputs.z, length: kept.a.outputs.length }, legacy.a.outputs && { x: legacy.a.outputs.x, z: legacy.a.outputs.z, length: legacy.a.outputs.length });
    for (let i = 1; i <= crew; i++) assert.deepEqual(kept.rt.world.entities[`p${i}`].pose.p, legacy.rt.world.entities[`p${i}`].pose.p);
    const a = entityFrame(kept.end), b = entityFrame(legacy.end);
    assert.ok(Math.hypot(a.q.x - b.q.x, a.q.z - b.q.z) < 1e-9 && Math.abs(Math.sin(a.q.th - b.q.th)) < 1e-9, 'laid in the same place along the same axis');
    assert.ok(Math.abs(angleDelta(a.q.th, kept.lying)) < 0.05, 'and still the way round it lay');
    assert.deepEqual(kept.end.support, { kind: 'ground' });
  });
}

test('#1031 cancels: lowered back unturned during the lift, set down along its own axis during the move', () => {
  for (const cancel of ['lift', 'move'] as const) {
    const r = run('beam-9ft', 1, true, { cancel });
    assert.equal(r.a.status, 'cancelled', `${cancel}: ${r.a.diagnostic?.message}`);
    assert.deepEqual(r.rt.violations.map((v) => v.message), [], cancel);
    assert.ok(r.seen.liftTurn < 0.05 && r.seen.setDownTurn < 0.05 && r.seen.maxStep < 0.2, `${cancel}: turns ${r.seen.liftTurn.toFixed(3)}/${r.seen.setDownTurn.toFixed(3)}, step ${r.seen.maxStep.toFixed(3)}`);
    assert.ok(Math.abs(angleDelta(entityFrame(r.end).q.th, r.lying)) < 0.05, `${cancel}: the way round it lay`);
    assert.deepEqual(r.end.support, { kind: 'ground' });
  }
});

test('#1031 grip drift: a carrier off its station in a keepYawV1 reversed carry is still a violation', () => {
  let poked = false;
  const r = run('upright-12ft', 2, true, {
    poke(rt) {
      if (poked) return;
      const inv = CARRY_INVARIANTS[0];
      assert.deepEqual(inv(rt), [], 'on station in the other frame');
      const p1 = rt.world.entities.p1;
      p1.pose.p[0] += 0.2;
      assert.deepEqual(inv(rt).map((d) => d.code), ['carry.grip-drift']);
      p1.pose.p[0] -= 0.2;
      poked = true;
    },
  });
  assert.ok(poked, 'checked mid-carry');
  assert.equal(r.a.status, 'completed', r.a.diagnostic?.message);
});

test('#1031 both runs lift in the reversed frame; only the keepYawV1 program carries the flag', () => {
  const programs: { keepYaw?: true }[] = [];
  const spy: ActionDef = { ...carry, start: (rt, p, prog, id) => (programs.push(prog as { keepYaw?: true }), carry.start(rt, p, prog, id)) } as ActionDef;
  REG.set('carry', spy);
  try {
    const legacy = run('beam-9ft', 1, false), kept = run('beam-9ft', 1, true);
    assert.equal(legacy.seen.reversed, true, 'the crew lifted facing the other way along the load');
    assert.equal(kept.seen.reversed, true);
  } finally { REG.set('carry', carry); }
  assert.deepEqual(programs.map((p) => p.keepYaw), [undefined, true]);
});
