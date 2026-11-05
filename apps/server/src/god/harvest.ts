// Garden family (#438) W085 and W086: "pick the tomatoes" and "pick flowers for the vase" are one act of ordinary native
// steps, like the tea acts (tea.ts): take the vessel by the right hand if it is not held (take_item), walk to the planter
// that is ripe for it, and reach into the plants with the free left hand (hand_actuator_v1, entry 42's free hand). At the
// hand's contact, and only then, the planter goes back a stage and the vessel holds what was picked; an act interrupted
// before the contact changes nothing. What a vessel picks is data (core-kit/harvest.ts HARVEST): the basket takes tomatoes
// from a fruiting planter, the vase a bunch of flowers from a flowering one. The planter grows again in the daily pass
// (garden.ts). Only bodies given a picking act are read per tick (usually none): no scan of the world.
import { opSchema, GROWTH_STAGES, harvestOf, type Harvest, type Op, type StoredDef, type WorldModel } from '@sim/world-compiler';
import { handActuatorFrame, type HandActuatorMotion } from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number]; type Vec3 = [number, number, number];
type Step = { verb: string; params: Record<string, unknown> };
type Refusal = { code: string; reason: string };
export type HarvestPlan = { steps: Step[]; summary: string };
/** How far (m) from the Soul a planter may be to pick from, and a vessel to fetch. */
export const HARVEST_REACH = 20;
/** Seconds the picking hand stays in the plants after its contact (it closes on the fruit or the stems). */
export const PICK_HOLD_SECONDS = 0.7;
const GRACE_TICKS = 1200, EDGE_GAP = HUMAN_RADIUS + 0.04, STAND_GAP = HUMAN_RADIUS + 0.08;
/** The picking hand reaches this far into the bed from its near edge (m), and the body stands this far to the right of the
 *  plant so the left hand reaches it straight ahead. */
const INTO_BED = 0.13, HAND_LEFT = 0.17;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isGrowing = (def: StoredDef | undefined) => (def?.state as Record<string, { type?: string }> | undefined)?.growth?.type === 'number';
const stageOf = (growth: unknown) => GROWTH_STAGES[Math.max(0, Math.min(GROWTH_STAGES.length - 1, Math.round(num(growth))))];

export type HarvestHost = {
  model: WorldModel;
  version(): number;
  engine: { world: { entities: Record<string, any>; tick: number }; dt?: number; clearanceAtV1?(x: number, z: number, level?: number): number };
  commit(ops: Op[], note: string): { accepted: boolean };
  log(m: string): void;
};

export function createHarvest(h: HarvestHost) {
  const M = () => h.model, ents = () => h.engine.world.entities, dt = () => h.engine.dt ?? 0.05;
  const pose = (id: string) => { const e = M().entities.get(id); return e ? M().worldPose(e) : null; };
  const defOf = (id: string) => { const e = M().entities.get(id); return e ? M().resolvedDef(e.def) : undefined; };
  const stateOf = (id: string) => { const e = M().entities.get(id), d = defOf(id); const out: Record<string, unknown> = {}; for (const [k, f] of Object.entries((d?.state ?? {}) as Record<string, { default?: unknown }>)) out[k] = f.default; return { ...out, ...(e?.state ?? {}) }; };
  const toWorld = (wp: { x: number; y: number; z: number; yaw: number; s: number }, l: Vec3): Vec3 => { const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw); return [wp.x + (l[0] * c + l[2] * s) * wp.s, wp.y + l[1] * wp.s, wp.z + (-l[0] * s + l[2] * c) * wp.s]; };
  const heading = (wp: { yaw: number }, d: Vec2) => { const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw); return Math.atan2(-d[0] * s + d[1] * c, d[0] * c + d[1] * s); };
  const clear = (p: Vec3) => (h.engine.clearanceAtV1 ? h.engine.clearanceAtV1(p[0], p[2], 0) : Infinity) >= HUMAN_RADIUS + 0.02;
  // the planters, found once per world version (never a scan per offer)
  let index: { v: number; planters: string[] } | null = null;
  const planters = () => {
    const v = h.version(); if (index?.v === v) return index.planters;
    const out: string[] = []; for (const e of M().entities.values()) if (isGrowing(M().resolvedDef(e.def))) out.push(e.id);
    return (index = { v, planters: out }).planters;
  };
  const walk = (st: Vec3, face: number): Step => ({ verb: 'mars:walk_to', params: { x: r3(st[0]), z: r3(st[2]), level: 0, face: r3(face) } });
  const LET_GO: Step = { verb: 'mars:let_go_v1', params: {} };

  /** Where to stand to take a vessel that rests on a table or a counter (tea.ts `station`, in front of the vessel), or on
   *  the ground (a step from it on the Soul's side). */
  function fetchSteps(id: string, me: Vec2): Step[] | Refusal {
    const x = ents()[id], s = x?.support, it = x?.pose?.p as Vec3 | undefined, name = M().pathOf(id);
    if (!it) return { code: 'harvest.vessel-gone', reason: `${name} is not there any more.` };
    if (s?.kind === 'resting-on') {
      const owner = M().entities.get(s.on), odef = owner && M().resolvedDef(owner.def);
      if (owner && odef) {
        const wp = M().worldPose(owner), half = odef.size.box[2] / 2 * wp.s, c = Math.cos(wp.yaw), sn = Math.sin(wp.yaw);
        const lx = (it[0] - wp.x) * c - (it[2] - wp.z) * sn, mz = (me[0] - wp.x) * sn + (me[1] - wp.z) * c, side = mz >= 0 ? 1 : -1;
        for (const g of [EDGE_GAP, EDGE_GAP + 0.06, EDGE_GAP + 0.12]) {
          const st = toWorld(wp, [lx / wp.s, 0, side * (half + g) / wp.s]);
          if (clear(st)) return [walk(st, heading(wp, [0, -side])), LET_GO, { verb: 'mars:take_item', params: { item: id, hand: 'right' } }];
        }
        return { code: 'harvest.vessel-blocked', reason: `There is no room to stand in front of ${name} to pick it up.` };
      }
    }
    if (s?.kind === 'in-hand') return { code: 'harvest.vessel-held', reason: `Someone else is holding ${name}.` };
    const d = Math.hypot(me[0] - it[0], me[1] - it[2]) || 1, u: Vec2 = [(me[0] - it[0]) / d, (me[1] - it[2]) / d];
    for (const g of [0.45, 0.55, 0.65]) {
      const st: Vec3 = [it[0] + u[0] * g, 0, it[2] + u[1] * g];
      if (clear(st)) return [walk(st, Math.atan2(-u[1], -u[0])), LET_GO, { verb: 'mars:take_item', params: { item: id, hand: 'right' } }];
    }
    return { code: 'harvest.vessel-blocked', reason: `There is no room to stand by ${name} to pick it up.` };
  }

  /** The act for a vessel's `harvest`: a refusal with its reason, the steps, or null (not a harvest vessel). */
  function plan(soul: { entityId: string }, id: string, action: string): HarvestPlan | Refusal | null {
    const m = M(), def = defOf(id), hv = harvestOf(def as never);
    if (!hv || action !== 'harvest') return null;
    const body = ents()[soul.entityId]; if (!body?.human) return { code: 'body.unavailable', reason: 'Your body is unavailable.' };
    const name = m.pathOf(id), have = Math.round(num(stateOf(id)[hv.field])), me: Vec2 = [body.pose.p[0], body.pose.p[2]];
    if (have + hv.take > hv.holds) return { code: 'harvest.vessel-full', reason: have >= hv.holds ? `${name} is full (${have} ${hv.word}); take them out or put it down first.` : `${name} has no room for ${hv.take} more ${hv.word} (it holds ${have} of ${hv.holds}).` };
    const support = ents()[id]?.support, held = support?.kind === 'in-hand' && support.by === soul.entityId;
    if (support?.kind === 'in-hand' && !held) return { code: 'harvest.vessel-held', reason: `Someone else is holding ${name}.` };
    if (held && support.hand !== 'right') return { code: 'harvest.wrong-hand', reason: `Hold ${name} in your right hand to pick with the left.` };
    const other = Object.values(ents()).find((x: any) => x?.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === soul.entityId && x.id !== id);
    if (other) return { code: 'harvest.hands-full', reason: `You are holding ${m.pathOf(other.id)}; put it down first.` };
    if (!held) { const q = ents()[id]?.pose?.p as Vec3 | undefined; if (!q || Math.hypot(q[0] - me[0], q[2] - me[1]) > HARVEST_REACH) return { code: 'harvest.vessel-far', reason: `${name} is too far away; walk closer first.` }; }
    // the nearest planter ripe for this vessel; else the nearest planter, to say what it is doing
    const from = GROWTH_STAGES.indexOf(hv.from);
    let ripe: string | null = null, rd = HARVEST_REACH, any: string | null = null, ad = HARVEST_REACH;
    for (const p of planters()) {
      const q = pose(p); if (!q) continue; const d = Math.hypot(q.x - me[0], q.z - me[1]); if (d > HARVEST_REACH) continue;
      if (Math.round(num(stateOf(p).growth)) === from && d < rd) { rd = d; ripe = p; }
      if (d < ad) { ad = d; any = p; }
    }
    if (!ripe) return any ? { code: 'harvest.not-ripe', reason: `Nothing in ${m.pathOf(any)} is ready to pick into ${name}: it is ${stageOf(stateOf(any).growth)}, and ${hv.word} are picked when it is ${hv.from}.` } : { code: 'harvest.no-planter', reason: `There is no garden planter near enough to pick ${hv.word} from.` };
    const wp = pose(ripe)!, pdef = defOf(ripe)!, half = pdef.size.box[2] / 2;
    // stand at the long side nearer the Soul, facing into the bed; the left hand goes to the plant on the body's left
    const lz = (me[0] - wp.x) * Math.sin(wp.yaw) + (me[1] - wp.z) * Math.cos(wp.yaw), side = lz >= 0 ? 1 : -1;
    const face = heading(wp, [0, -side]), right: Vec2 = [-Math.sin(face), Math.cos(face)];
    const points = hv.reach.map((r) => toWorld(wp, [r.x, r.y, side * (half - INTO_BED)]));
    const at = points.sort((a, b) => (a[0] * right[0] + a[2] * right[1]) - (b[0] * right[0] + b[2] * right[1]))[0];
    let st: Vec3 | null = null;
    for (const g of [STAND_GAP, STAND_GAP + 0.05, STAND_GAP + 0.1]) {
      const edge = toWorld(wp, [0, 0, side * (half + g)]), lat = (at[0] - edge[0]) * right[0] + (at[2] - edge[2]) * right[1];
      const s: Vec3 = [edge[0] + right[0] * (lat + HAND_LEFT), 0, edge[2] + right[1] * (lat + HAND_LEFT)];
      if (clear(s)) { st = s; break; }
    }
    if (!st) return { code: 'harvest.planter-blocked', reason: `There is no room to stand at ${m.pathOf(ripe)} to pick from it.` };
    const steps: Step[] = [];
    if (!held) { const f = fetchSteps(id, me); if ('code' in f) return f; steps.push(LET_GO, ...f); }
    steps.push(walk(st, face), LET_GO, { verb: 'mars:hand_actuator_v1', params: { target: ripe, at: at.map(r3), hand: 'left', hold: PICK_HOLD_SECONDS } });
    planned.set(soul.entityId, { vessel: id, planter: ripe });
    return { steps, summary: `Picked ${hv.take} ${hv.word} from ${m.pathOf(ripe)} into ${name}.` };
  }

  /** Compact nearby facts (here.ts, ≤ 4 m): what a vessel holds, once it holds some. Never the stored state. */
  function facts(id: string): Record<string, unknown> | null {
    const hv = harvestOf(defOf(id) as never); if (!hv) return null;
    const n = Math.round(num(stateOf(id)[hv.field])); return n > 0 ? { [hv.field]: n } : null;
  }

  // ---- the world changes at the hand's contact ----
  const watching = new Map<string, number>(), fired = new Set<string>(), planned = new Map<string, { vessel: string; planter: string }>(), acting = new Map<string, { vessel: string; planter: string }>();
  let visits = 0;
  /** A body was given a picking act: watch its motions until they are done (with a minute's grace before them). */
  function expect(body: string) { const p = planned.get(body); if (!p) return; acting.set(body, p); watching.set(body, h.engine.world.tick + GRACE_TICKS); }
  /** The pick itself: the planter back a stage and the vessel holding what was picked, in one commit, if the planter is
   *  still ripe for it and the vessel is in this body's hand. */
  function pick(body: string, vessel: string, planter: string) {
    const hv = harvestOf(defOf(vessel) as never) as Harvest | null, s = ents()[vessel]?.support;
    if (!hv) return;
    if (s?.kind !== 'in-hand' || s.by !== body) { h.log(`harvest ${planter}: ${vessel} is not in the picking body's hand`); return; }
    if (Math.round(num(stateOf(planter).growth)) !== GROWTH_STAGES.indexOf(hv.from)) { h.log(`harvest ${planter}: no longer ${hv.from}`); return; }
    const have = Math.round(num(stateOf(vessel)[hv.field]));
    if (have + hv.take > hv.holds) { h.log(`harvest ${vessel}: full`); return; }
    const ops: Op[] = [opSchema.parse({ op: 'set', id: planter, state: { growth: GROWTH_STAGES.indexOf(hv.leaves) } }), opSchema.parse({ op: 'set', id: vessel, state: { [hv.field]: have + hv.take } })];
    const r = h.commit(ops, `${body} harvest ${planter} into ${vessel}`); if (!r.accepted) h.log(`harvest ${planter}: the world refused ${JSON.stringify(ops)}`);
  }
  /** Per tick, only for bodies given a picking act (usually none). */
  function tick() {
    if (!watching.size) return;
    const now = h.engine.world.tick, d = dt();
    for (const [body, until] of watching) {
      visits++;
      const p = acting.get(body), am = ents()[body]?.human?.handActuator as HandActuatorMotion | undefined;
      if (p && am && am.target === p.planter) {
        watching.set(body, now + GRACE_TICKS);
        const key = am.actionId ?? `${body}:${am.startTick}`;
        if (!fired.has(key) && handActuatorFrame(am, (now - am.startTick) * d).contact) { fired.add(key); try { pick(body, p.vessel, p.planter); } catch (e) { h.log(`harvest: ${(e as Error).message}`); } }
      } else if (now > until) { watching.delete(body); acting.delete(body); }
      if (fired.size > 64) for (const x of [...fired].slice(0, 32)) fired.delete(x);
    }
  }
  return { plan, facts, expect, tick, watchingCount: () => watching.size, visits: () => visits };
}
export type HarvestFaculty = ReturnType<typeof createHarvest>;
