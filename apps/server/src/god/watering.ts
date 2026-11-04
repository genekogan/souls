// Soul Actions entry 34: "water the planter" with a watering can. One act, ordinary native steps: take the can from its
// hook by the handle (take_item), fill it under the garden tap if it is empty (watering_can_v1 fill: the left hand turns
// the valve), carry it to the planter and pour through the rose (watering_can_v1 pour), hang it back (put_item).
// The world changes at the native timeline's own moments (`wateringEvents`), read only for bodies that were given this
// act (no per-tick scan of the world): the tap at the valve contacts, the soil in three steps while the stream runs.
import { opSchema, biologyEnabled, anchorBiology, waterBiology, CAN_GRIP, CAN_LITRES, CAN_OPENING, CAN_ROSE, POUR_LITRES, type Op, type StoredDef, type WorldModel } from '@sim/world-compiler';
import { canPoint, TILT, wateringEvents, type WateringMotion } from '../../../../mars/viewer/engine/items/watering.ts';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';
import { litresOf } from './water.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number]; type Vec3 = [number, number, number];
type Step = { verb: string; params: Record<string, unknown> };
export type WateringPlan = { steps: Step[]; summary: string; can: string; litres: number; fill: boolean };
type Refusal = { code: string; reason: string };
/** How far (m) from the Soul a can on a hook, and from the can a tap, may be for the act to be offered. */
export const WATERING_REACH = 30;
/** Seconds the tap runs into the can; seconds of stream per litre poured. */
export const FILL_SECONDS = 3.2, POUR_SECONDS_PER_L = 0.8;
/** A can holding less than this is empty (it is filled first). */
const EMPTY_L = 0.25, GRACE_TICKS = 1200;
/** At the hook the body stands this far behind the handle (m). */
const HOOK_STAND = 0.5;
/** Pour: the hand holds the can out at the side over the bed (body frame, m), the stream lands this far past the rose. */
const POUR_HAND = { fwd: 0.42, side: 0.3, rose: 0.22 }, STREAM_RUN = 0.2, SWEEP = 0.16;
/** The can's opening sits this far under the tap's nozzle while it fills (m). */
const CATCH_BELOW = 0.05;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const shapesOf = (def: StoredDef) => (def.make.kind === 'gen' ? (def.make.args as { shapes?: { tint?: string; at?: number[] }[] })?.shapes ?? [] : []);
export const isCanDef = (def: StoredDef | undefined) => !!def && def.tags.includes('watering-can') && !!(def as any).slots?.some((s: { kind: string }) => s.kind === 'carry');
export const isTapDef = (def: StoredDef | undefined) => !!def && def.tags.includes('tap') && def.tags.includes('hand-operated') && shapesOf(def).some((s) => s.tint === 'valve') && shapesOf(def).some((s) => s.tint === 'nozzle');
const isPlant = (def: StoredDef | undefined) => (def?.state as Record<string, { type?: string }> | undefined)?.moisture?.type === 'number';
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** The tap's stream (fx/water-jets.ts `stream`): it leaves the nozzle forward at 0.32 m/s, 0.25 m/s down, under gravity. */
export const streamRun = (drop: number) => 0.32 * (-0.25 + Math.sqrt(0.0625 + 2 * 9.8 * Math.max(0, drop))) / 9.8;

export type WateringHost = {
  model: WorldModel;
  /** Bumped on every world commit: the index of cans, hooks and taps is rebuilt only when it changes. */
  version(): number;
  hour?(): number;
  engine: { world: { entities: Record<string, any>; tick: number }; dt?: number; clearanceAtV1?(x: number, z: number, level?: number): number };
  commit(ops: Op[], note: string): { accepted: boolean };
  log(m: string): void;
};

export function createWatering(h: WateringHost) {
  const M = () => h.model, ents = () => h.engine.world.entities;
  const pose = (id: string) => { const e = M().entities.get(id); return e ? M().worldPose(e) : null; };
  /** god local → world (the contact actuator's convention), and a local direction → engine heading */
  const toWorld = (wp: { x: number; y: number; z: number; yaw: number; s: number }, l: Vec3): Vec3 => { const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw); return [wp.x + (l[0] * c + l[2] * s) * wp.s, wp.y + l[1] * wp.s, wp.z + (-l[0] * s + l[2] * c) * wp.s]; };
  const heading = (wp: { yaw: number }, d: Vec2) => { const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw); return Math.atan2(-d[0] * s + d[1] * c, d[0] * c + d[1] * s); };
  const clear = (p: Vec3) => (h.engine.clearanceAtV1 ? h.engine.clearanceAtV1(p[0], p[2], 0) : Infinity) >= HUMAN_RADIUS + 0.02;
  const defOf = (id: string) => { const e = M().entities.get(id); return e ? M().resolvedDef(e.def) : undefined; };
  const levelOf = (id: string) => { const e = M().entities.get(id), def = e && M().resolvedDef(e.def); return num(e?.state?.level, num((def?.state as any)?.level?.default)); };
  // the few things this act uses, found once per world version (never a scan per offer)
  let index: { v: number; cans: string[]; hooks: { id: string; slot: string }[]; taps: string[] } | null = null;
  const things = () => {
    const v = h.version(); if (index?.v === v) return index;
    const out = { v, cans: [] as string[], hooks: [] as { id: string; slot: string }[], taps: [] as string[] };
    for (const e of M().entities.values()) {
      const d = M().resolvedDef(e.def); if (!d) continue;
      if (isCanDef(d)) out.cans.push(e.id);
      else if (isTapDef(d)) out.taps.push(e.id);
      else { const slot = (d as any).slots?.find((s: { kind: string }) => s.kind === 'hang'); if (slot) out.hooks.push({ id: e.id, slot: slot.id }); }
    }
    return (index = out);
  };

  /** The compound act for "water <plant>", a refusal, or null (no can of this kind here: the W5 path answers). */
  function plan(soul: { entityId: string }, plantId: string): WateringPlan | Refusal | null {
    const m = M(), plant = m.entities.get(plantId), pdef = plant && m.resolvedDef(plant.def);
    if (!plant || !pdef || !isPlant(pdef)) return null;
    if (!biologyEnabled(plant.state, pdef)) return { code: 'water.biology-disabled', reason: 'Watering is disabled for this planter; its owner may opt it in with biologyEnabled.' };
    const ix = things(); if (!ix.cans.length) return null;
    const body = ents()[soul.entityId]; if (!body?.human) return null;
    const me: Vec2 = [body.pose.p[0], body.pose.p[2]];
    // the can: in this Soul's hand, else the nearest one resting on a hook
    const heldNow = (ix.cans.map((id) => ents()[id]).find((x: any) => x?.support?.kind === 'in-hand' && x.support.by === soul.entityId)
      ?? (body.human.holding || Object.keys(body.human.hands ?? {}).length ? Object.values(ents()).find((x: any) => x?.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === soul.entityId) : undefined)) as any;
    let can: string | null = null, hook: { owner: string; slot: string } | null = null;
    if (heldNow) { if (!isCanDef(defOf(heldNow.id))) return { code: 'water.hands-full', reason: `You are holding ${m.pathOf(heldNow.id)}; put it down first, then water ${m.pathOf(plantId)} with the watering can.` }; can = heldNow.id; }
    else {
      let best = WATERING_REACH;
      for (const x of ix.cans.map((id) => ents()[id]) as any[]) {
        if (x?.support?.kind !== 'resting-on') continue;
        const d = Math.hypot(x.pose.p[0] - me[0], x.pose.p[2] - me[1]); if (d < best) { best = d; can = x.id; hook = { owner: x.support.on, slot: x.support.slot }; }
      }
      if (!can) return null;
    }
    if (!can) return null;
    const canId: string = can;
    // a hook to hang it back on: where it came from, else the nearest free one
    if (!hook) {
      let best = WATERING_REACH;
      for (const k of ix.hooks) {
        const e = m.entities.get(k.id); if (!e) continue;
        if (ix.cans.some((c) => ents()[c]?.support?.kind === 'resting-on' && ents()[c].support.on === k.id && ents()[c].support.slot === k.slot)) continue;
        const q = m.worldPose(e), d = Math.hypot(q.x - me[0], q.z - me[1]); if (d < best) { best = d; hook = { owner: k.id, slot: k.slot }; }
      }
    }
    const cdef = defOf(canId)!, canL = litresOf(cdef, (m.entities.get(canId)?.params ?? {}) as Record<string, unknown>) || CAN_LITRES, have = levelOf(canId) * canL;
    const plantL = litresOf(pdef, (plant.params ?? {}) as Record<string, unknown>), moist = anchorBiology(plant.state, pdef, h.hour?.() ?? 0)!.biologyMoisture;
    const want = (1 - moist) * plantL;
    if (want <= 0.05) return { code: 'water.plant-wet', reason: `${m.pathOf(plantId)} is already well watered.` };
    const fill = have < EMPTY_L, litres = Math.min(POUR_LITRES, plantL, fill ? canL : have);
    const steps: Step[] = [];
    // at the hook: stand behind the can's handle, facing the way its spout points, so the hand closes on the handle and
    // lifts it off without turning it (and hangs it back the same way)
    const hookStation = (grip: Vec3, yaw: number): Step | null => {
      const f: Vec2 = [Math.cos(yaw), Math.sin(yaw)], st: Vec3 = [grip[0] - f[0] * HOOK_STAND, 0, grip[2] - f[1] * HOOK_STAND];
      return clear(st) ? { verb: 'mars:walk_to', params: { x: r3(st[0]), z: r3(st[2]), level: 0, face: r3(yaw) } } : null;
    };
    const hungYaw = heldNow ? null : num(ents()[canId]?.pose?.yaw);
    if (!heldNow) { const c = ents()[canId], at = hookStation([c.pose.p[0], c.pose.p[1] + CAN_GRIP[1], c.pose.p[2]], hungYaw!); if (at) steps.push(at); steps.push({ verb: 'mars:take_item', params: { item: canId, hand: 'right' } }); }
    if (fill) {
      const canAt = pose(canId)!; let tap: string | null = null, best = WATERING_REACH;
      for (const t of ix.taps) { const e = m.entities.get(t); if (!e) continue; const q = m.worldPose(e), d = Math.hypot(q.x - canAt.x, q.z - canAt.z); if (d < best) { best = d; tap = t; } }
      if (!tap) return { code: 'water.no-tap', reason: `The watering can is empty and there is no garden tap within ${WATERING_REACH} m of it to fill it at.` };
      const tdef = defOf(tap)!, twp = pose(tap)!, sh = shapesOf(tdef), valve = sh.find((s) => s.tint === 'valve')!.at!, nozzle = sh.find((s) => s.tint === 'nozzle')!.at!;
      // the can's filler opening goes where the tap's stream lands, just under the nozzle (held high, the arm reaches it
      // standing: no crouch); the body stands beside the basin on the tap's −x side, clear of its footprint, facing +x
      // (the can in the right hand on the stream's side)
      const openTop = nozzle[1] - CATCH_BELOW, landZ = nozzle[2] + streamRun(CATCH_BELOW), half = tdef.size.box[0] / 2;
      const grip: Vec3 = [nozzle[0] - (CAN_OPENING[0] - CAN_GRIP[0]), openTop - (CAN_OPENING[1] + 0.008) + CAN_GRIP[1], landZ];
      let stand = toWorld(twp, [-(half + HUMAN_RADIUS + 0.01), 0, landZ - 0.155]);
      if (!clear(stand)) stand = toWorld(twp, [-(half + HUMAN_RADIUS + 0.04), 0, landZ - 0.155]);
      if (!clear(stand)) return { code: 'water.tap-blocked', reason: `There is no room to stand beside ${m.pathOf(tap)} to fill the watering can.` };
      const face = heading(twp, [1, 0]);
      steps.push({ verb: 'mars:walk_to', params: { x: r3(stand[0]), z: r3(stand[2]), level: 0, face: r3(face) } },
        { verb: 'mars:watering_can_v1', params: { item: can, target: tap, stage: 'fill', face: r3(face), hold: toWorld(twp, grip).map(r3), valve: toWorld(twp, [valve[0], valve[1] + 0.02, valve[2]]).map(r3), seconds: FILL_SECONDS, levelAfter: 1, litres: r3(canL - have) } });
    }
    // pour: stand off the bed's long side nearer the Soul, facing it; the stream lands mid-bed and sweeps along it
    const pwp = pose(plantId)!, [bw, , bd] = pdef.size.box, soilY = 0.37;
    const roseRel = canPoint([0, 0, 0], CAN_GRIP, 0, TILT, CAN_ROSE), D = POUR_HAND.fwd + roseRel[0] + STREAM_RUN;
    const handUp = soilY + POUR_HAND.rose - roseRel[1];
    const from = fill ? (steps.at(-1)!.params.hold as Vec3) : [body.pose.p[0], 0, body.pose.p[2]];
    const sides = [1, -1].map((side) => { const st = toWorld(pwp, [-side * POUR_HAND.side, 0, side * (D / pwp.s)]); return { side, st, d: Math.hypot(st[0] - from[0], st[2] - from[2]) }; }).sort((a, b) => a.d - b.d);
    const pick = sides.find((x) => clear(x.st)); if (!pick) return { code: 'water.plant-blocked', reason: `There is no room to stand beside ${m.pathOf(plantId)} to water it.` };
    void bw; void bd;
    const face = heading(pwp, [0, -pick.side]), f: Vec2 = [Math.cos(face), Math.sin(face)], r: Vec2 = [-f[1], f[0]];
    const hold: Vec3 = [pick.st[0] + f[0] * POUR_HAND.fwd + r[0] * POUR_HAND.side, pwp.y + handUp * pwp.s, pick.st[2] + f[1] * POUR_HAND.fwd + r[1] * POUR_HAND.side];
    const along = toWorld({ ...pwp, x: 0, y: 0, z: 0 }, [SWEEP, 0, 0]);
    const after = Math.max(0, ((fill ? canL : have) - litres) / canL);
    steps.push({ verb: 'mars:walk_to', params: { x: r3(pick.st[0]), z: r3(pick.st[2]), level: 0, face: r3(face) } },
      { verb: 'mars:watering_can_v1', params: { item: can, target: plantId, stage: 'pour', face: r3(face), hold: hold.map(r3), sweep: [r3(along[0]), r3(along[2])], seconds: r3(Math.max(1, litres * POUR_SECONDS_PER_L)), levelAfter: r3(after), litres: r3(litres) } });
    if (hook) {
      const hk = m.entities.get(hook.owner)!, hwp = m.worldPose(hk), slot = (m.resolvedDef(hk.def) as any).slots.find((x: { id: string }) => x.id === hook!.slot);
      const grip = toWorld(hwp, [slot.p[0] + CAN_GRIP[0], slot.p[1] + CAN_GRIP[1], slot.p[2] + CAN_GRIP[2]]), at = hookStation(grip, hungYaw ?? heading(hwp, [1, 0]));
      if (at) steps.push(at);
      steps.push({ verb: 'mars:put_item', params: { item: canId, surfaceSlot: `${hook.owner}#${hook.slot}` } });
    }
    const fmt = (l: number) => String(Math.round(l * 10) / 10);
    planned.set(soul.entityId, canId);
    return { steps, can: canId, litres, fill, summary: `Watered ${m.pathOf(plantId)} with ${fmt(litres)} L from the watering can${fill ? ' (filled it at the tap first)' : ''}${hook ? ', and hung the can back on its hook' : ''}; the can has ${fmt(Math.max(0, (fill ? canL : have) - litres))} L left.` };
  }

  // ---- the world changes at the motion's moments ----
  const watching = new Map<string, number>(), fired = new Map<string, Set<string>>(), poured = new Map<string, number>();
  /** A body was given the act: watch its watering motions until they are done (with a minute's grace before them). */
  function expect(body: string) { watching.set(body, h.engine.world.tick + GRACE_TICKS); const c = planned.get(body); if (c) canOf.set(body, c); }
  /** The can each watched body's act uses, and how it was last supported (a grasp or a release reaches the world at once). */
  const planned = new Map<string, string>(), canOf = new Map<string, string>(), lastSupport = new Map<string, string>();
  function commitEvent(m: WateringMotion & { actor?: string }, actor: string, key: string, data: Record<string, unknown>) {
    const model = M(), target = model.entities.get(m.target), tdef = target && model.resolvedDef(target.def), can = model.entities.get(m.item);
    // entry 43: a kettle's fill and pour are tea.ts's moments, even for a body that watered a planter a minute ago
    if (!isCanDef(can ? model.resolvedDef(can.def) : undefined)) return;
    if(!target||!tdef){
      if(m.stage!=='pour')return;
      const id=m.actionId??`${actor}:${m.startTick}`;
      if(/^pour-[123]$/.test(key)||key==='pour-abort')poured.set(id,(poured.get(id)??0)+(m.litres??0)*num(data.fraction));
      if(key==='pour-end'&&can){const cdef=model.resolvedDef(can.def)!,capacity=litresOf(cdef,(can.params??{}) as Record<string,unknown>)||CAN_LITRES;
        const level=typeof data.level==='number'?data.level:Math.max(0,Math.round((levelOf(m.item)-(poured.get(id)??0)/capacity)*1000)/1000);
        h.commit([opSchema.parse({op:'set',id:m.item,state:{level}})],`${actor} watering: target removed, delivered water spent`);poured.delete(id);}
      return;
    }
    const ops: Op[] = [], set = (id: string, state: Record<string, unknown>) => ops.push(opSchema.parse({ op: 'set', id, state }));
    const plantL = litresOf(tdef, (target.params ?? {}) as Record<string, unknown>), id = m.actionId ?? `${actor}:${m.startTick}`;
    const moisten = (fraction: number) => { const l = (m.litres ?? 0) * fraction; poured.set(id, (poured.get(id) ?? 0) + l); const patch = waterBiology(target.state, tdef, h.hour?.() ?? 0, l / plantL); if (patch) set(m.target, patch); };
    if (key === 'valve-on') set(m.target, { on: true });
    else if (key === 'valve-off') { set(m.target, { on: false }); if (can) set(m.item, { level: num(data.level, 1) }); }
    else if (key === 'pour-start') { if (biologyEnabled(target.state, tdef) && (tdef.state as any).pouring) set(m.target, { pouring: true }); }
    else if (/^pour-[123]$/.test(key) || key === 'pour-abort') moisten(num(data.fraction));
    else if (key === 'pour-end') {
      if (biologyEnabled(target.state, tdef) && (tdef.state as any).pouring) set(m.target, { pouring: false });
      if (can) { const cdef = model.resolvedDef(can.def)!, canL = litresOf(cdef, (can.params ?? {}) as Record<string, unknown>) || CAN_LITRES; set(m.item, { level: typeof data.level === 'number' ? data.level : Math.max(0, Math.round((levelOf(m.item) - (poured.get(id) ?? 0) / canL) * 1000) / 1000) }); }
      poured.delete(id);
    }
    if (!ops.length) return;
    const r = h.commit(ops, `${actor} watering ${key} ${m.target}`);
    if (!r.accepted) h.log(`watering ${key}: the world refused ${JSON.stringify(ops)}`);
  }
  /** Per tick, only for bodies given the act (usually none): commit the motion's moments that have now passed. Returns the
   *  cans whose grasp or release happened this tick, for the bridge to write back on this same tick. */
  function tick(): string[] {
    if (!watching.size) return [];
    const moved: string[] = [];
    for (const [body, can] of canOf) {
      const s = ents()[can]?.support, key = s ? `${s.kind}:${s.by ?? s.on ?? ''}:${s.slot ?? ''}` : '';
      if (lastSupport.has(can) && lastSupport.get(can) !== key) moved.push(can);
      lastSupport.set(can, key);
      if (!watching.has(body)) { canOf.delete(body); lastSupport.delete(can); }
    }
    const dt = h.engine.dt ?? 0.05, tickNow = h.engine.world.tick;
    for (const [body, until] of watching) {
      const b = ents()[body], m = b?.human?.wateringV1 as WateringMotion | undefined;
      // watched from the act until a minute after it last held a can or moved one (the walk to the hook comes first)
      const holding = !!b?.human && things().cans.some((c) => ents()[c]?.support?.kind === 'in-hand' && ents()[c].support.by === body);
      if (m || holding) watching.set(body, tickNow + GRACE_TICKS);
      if (!m) { if (!b?.human || tickNow > until) watching.delete(body); continue; }
      const id = m.actionId ?? `${body}:${m.startTick}`, done = fired.get(id) ?? new Set<string>(); fired.set(id, done);
      const s = (tickNow - m.startTick) * dt;
      for (const e of wateringEvents(m)) if (s >= e.at && !done.has(e.key)) { done.add(e.key); try { commitEvent(m, body, e.key, e.data); } catch (err) { h.log(`watering ${e.key}: ${(err as Error).message}`); } }
      if (fired.size > 64) for (const k of [...fired.keys()].slice(0, 32)) fired.delete(k);
    }
    return moved;
  }
  return { plan, expect, tick, watchingCount: () => watching.size };
}
export type Watering = ReturnType<typeof createWatering>;
