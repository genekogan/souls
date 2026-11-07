// Garden family (#438) W085 and W086: "pick the tomatoes" and "pick flowers for the vase" are one act of ordinary native
// steps, like the tea acts (tea.ts): take the vessel by the right hand if it is not held (take_item), walk to the planter
// that is ripe for it, and reach into the plants with the free left hand (hand_actuator_v1, entry 42's free hand). At the
// hand's contact, and only then, the planter goes back a stage and the vessel holds what was picked; an act interrupted
// before the contact changes nothing, and the receipt says what the hand did, never only that the steps ran (`outcome`). What a vessel picks is data (core-kit/harvest.ts HARVEST): the basket takes tomatoes
// from a fruiting planter, the vase a bunch of flowers from a flowering one. The planter grows again in the daily pass
// (garden.ts). Only bodies given a picking act are read per tick (usually none): no scan of the world.
import { opSchema, GROWTH_STAGES, harvestOf, type Harvest, type Op, type StoredDef, type WorldModel } from '@souls/world-compiler';
import { handActuatorFrame, type HandActuatorMotion } from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';
import { PLAN_MARGIN } from '../../../../mars/viewer/engine/spatial/path.ts';

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
/** A vessel this near (m) is taken from where the Soul stands, under `take_item`'s own HERE_REACH (0.85 m). */
const TAKE_REACH = 0.82;
/** Two Souls fetching at once keep their stands this far apart (m): two bodies and a margin. */
const STANDS_APART = 2 * HUMAN_RADIUS + 0.04;
/** A fetch stand has room for the walk to end on it: with less, the planner stops on a cell centre up to 0.14 m off, out of
 *  reach of the vessel. */
const STAND_ROOM = HUMAN_RADIUS + PLAN_MARGIN;
/** A fetch held up this long is given up by name (ticks; two minutes). A blocked walk step ends sooner by itself, but
 *  `take_item`'s own approach, its last resort and where a Soul pushed off its stand goes, has no limit (#1216). */
const FETCH_TICKS = 2400;
/** Stands tried out from a table's edge (m), and along the side from straight out from the vessel. */
const EDGE_GAPS = [EDGE_GAP, EDGE_GAP + 0.06, EDGE_GAP + 0.12, EDGE_GAP + 0.18], ALONG = [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45];
/** The picking hand reaches this far into the bed from its near edge (m), and the body stands this far to the right of the
 *  plant so the left hand reaches it straight ahead. */
const INTO_BED = 0.13, HAND_LEFT = 0.17;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const isGrowing = (def: StoredDef | undefined) => (def?.state as Record<string, { type?: string }> | undefined)?.growth?.type === 'number';
const words = (s: string) => s.toLowerCase().replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:the|my|our|a|this|that) /, '');
const stageOf = (growth: unknown) => GROWTH_STAGES[Math.max(0, Math.min(GROWTH_STAGES.length - 1, Math.round(num(growth))))];

export type HarvestHost = {
  model: WorldModel;
  version(): number;
  engine: { world: { entities: Record<string, any>; tick: number }; dt?: number; clearanceAtV1?(x: number, z: number, level?: number): number };
  commit(ops: Op[], note: string): { accepted: boolean };
  log(m: string): void;
  /** Why this Soul may not use a thing (a private planter of someone else's), or null (layers.ts `refusal`). */
  access?(id: string, soul: { soulId: string; name: string }): Refusal | null;
  /** The vessel fetched on the way: the answer a pick-up offer gets (for sale, or a lost-and-found claim). */
  denied?(id: string, soul: { soulId: string; name: string }): Refusal | null;
  /** Is this body's act still open (its receipt not ended)? A walk held up by other people can outlast any fixed grace. */
  actOpen?(body: string, capability: string): boolean;
  /** End this body's open act now, failed by name. */
  actFail?(body: string, capability: string, why: Refusal): void;
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

  /** Stands another Soul's open fetch is walking to: a vessel already in hand has left its stand. */
  const taken = (body: string) => [...acting].filter(([b, a]) => b !== body && a.stand && ents()[a.vessel]?.support?.kind !== 'in-hand' && (h.actOpen?.(b, `object:${a.vessel}:harvest`) ?? true)).map(([, a]) => a.stand as Vec3);
  /** The best of these stands: with room, then away from another fetch's stand, then the lowest `rank`. */
  function bestStand(body: string, stands: Vec3[], rank: (st: Vec3) => number): Vec3 | null {
    const roomy = (p: Vec3) => (h.engine.clearanceAtV1 ? h.engine.clearanceAtV1(p[0], p[2], 0) : Infinity) >= STAND_ROOM;
    const others = taken(body), free = stands.filter(roomy), apart = free.filter((st) => others.every((o) => Math.hypot(o[0] - st[0], o[2] - st[2]) >= STANDS_APART));
    return (apart.length ? apart : free).sort((a, b) => rank(a) - rank(b))[0] ?? null;
  }
  /** The stand to take a vessel from and the steps to it. The walk is a step of the act, with the engine's limits on a
   *  blocked walk, and it ends with the vessel in reach, so `take_item` needs no walk of its own: that one has no limit, and
   *  it went on round the table through the next Soul (#1214). On a table or a counter, along any side, kept clear of
   *  another Soul's stand; on the ground, a step from it, the Soul's side first. */
  function fetchSteps(id: string, body: string, me: Vec2): { steps: Step[]; stand: Vec3 } | Refusal {
    const x = ents()[id], s = x?.support, it = x?.pose?.p as Vec3 | undefined, name = M().pathOf(id);
    if (!it) return { code: 'harvest.vessel-gone', reason: `${name} is not there any more.` };
    const go = (st: Vec3) => ({ stand: st, steps: [walk(st, Math.atan2(it[2] - st[2], it[0] - st[0])), LET_GO, { verb: 'mars:take_item', params: { item: id, hand: 'right' } }] });
    const away = (st: Vec3) => Math.hypot(st[0] - it[0], st[2] - it[2]);
    if (s?.kind === 'resting-on') {
      const owner = M().entities.get(s.on), odef = owner && M().resolvedDef(owner.def);
      if (owner && odef) {
        const wp = M().worldPose(owner), hx = odef.size.box[0] / 2 * wp.s, hz = odef.size.box[2] / 2 * wp.s, c = Math.cos(wp.yaw), sn = Math.sin(wp.yaw);
        const lx = (it[0] - wp.x) * c - (it[2] - wp.z) * sn, lz = (it[0] - wp.x) * sn + (it[2] - wp.z) * c;
        const sides: [Vec2, Vec2][] = [[[lx, hz], [0, 1]], [[lx, -hz], [0, -1]], [[hx, lz], [1, 0]], [[-hx, lz], [-1, 0]]];
        const all = sides.flatMap(([e, n]) => EDGE_GAPS.flatMap((g) => ALONG.map((a) => toWorld(wp, [(e[0] + n[0] * g + n[1] * a) / wp.s, 0, (e[1] + n[1] * g + n[0] * a) / wp.s]))));
        // deep on a wide table no stand reaches it: the nearest clear one, where `take_item` has the least left to do
        const st = bestStand(body, all.filter((q) => away(q) <= TAKE_REACH), (q) => Math.hypot(q[0] - me[0], q[2] - me[1])) ?? bestStand(body, all, away);
        return st ? go(st) : { code: 'harvest.vessel-blocked', reason: `There is no room to stand at ${M().pathOf(s.on)} to pick up ${name}.` };
      }
    }
    if (s?.kind === 'in-hand') return { code: 'harvest.vessel-held', reason: `Someone else is holding ${name}.` };
    if (s?.kind !== 'ground') return { code: 'harvest.vessel-not-down', reason: `${name} is not on a table, a counter or the ground; take it out first.` };
    const from = Math.atan2(me[1] - it[2], me[0] - it[0]);
    for (const g of [0.45, 0.55, 0.65]) for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const st: Vec3 = [it[0] + Math.cos(from + k * Math.PI / 4) * g, 0, it[2] + Math.sin(from + k * Math.PI / 4) * g];
      if (clear(st)) return go(st);
    }
    return { code: 'harvest.vessel-blocked', reason: `There is no room to stand by ${name} to pick it up.` };
  }

  /** The act for a vessel's `harvest`: a refusal with its reason, the steps, or null (not a harvest vessel). */
  function plan(soul: { entityId: string; soulId?: string; name?: string }, id: string, action: string, params: Record<string, unknown> = {}): HarvestPlan | Refusal | null {
    const m = M(), def = defOf(id), hv = harvestOf(def as never);
    if (!hv || action !== 'harvest') return null;
    const body = ents()[soul.entityId]; if (!body?.human) return { code: 'body.unavailable', reason: 'Your body is unavailable.' };
    const name = m.pathOf(id), have = Math.round(num(stateOf(id)[hv.field])), me: Vec2 = [body.pose.p[0], body.pose.p[2]];
    if (have + hv.take > hv.holds) return { code: 'harvest.vessel-full', reason: have >= hv.holds ? `${name} is full: it already holds ${have} ${hv.word} and has no room for more.` : `${name} has no room for ${hv.take} more ${hv.word} (it holds ${have} of ${hv.holds}).` };
    const support = ents()[id]?.support, held = support?.kind === 'in-hand' && support.by === soul.entityId;
    if (support?.kind === 'in-hand' && !held) return { code: 'harvest.vessel-held', reason: `Someone else is holding ${name}.` };
    if (held && support.hand !== 'right') return { code: 'harvest.wrong-hand', reason: `Hold ${name} in your right hand to pick with the left.` };
    const other = Object.values(ents()).find((x: any) => x?.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === soul.entityId && x.id !== id);
    if (other) return { code: 'harvest.hands-full', reason: `You are holding ${m.pathOf(other.id)}; put it down first.` };
    if (body.human.carrier) return { code: 'harvest.riding', reason: 'You are aboard something; get off first, then pick.' };
    if (body.human.holding || body.human.grip) return { code: 'harvest.hands-full', reason: 'Your hands are busy carrying something; set it down first.' };
    if (!held) { const q = ents()[id]?.pose?.p as Vec3 | undefined; if (!q || Math.hypot(q[0] - me[0], q[2] - me[1]) > HARVEST_REACH) return { code: 'harvest.vessel-far', reason: `${name} is too far away; walk closer first.` }; }
    // the nearest planter ripe for this vessel; else the nearest planter, to say what it is doing
    const from = GROWTH_STAGES.indexOf(hv.from);
    let ripe: string | null = null, rd = HARVEST_REACH, any: string | null = null, ad = HARVEST_REACH, denied: Refusal | null = null;
    // "pick the tomatoes from the rose bed": only the planter so named (its name, hyphens as spaces); never the nearest instead
    const named = typeof params.from === 'string' && words(params.from) ? words(params.from) : null;
    // an exact name first ("bed" beside "bed-two"); else every named word in the planter's name
    const nameOf = (p: string) => words(m.entities.get(p)?.name ?? ''), exact = named ? planters().filter((p) => nameOf(p) === named) : [];
    const pool = !named ? planters() : exact.length ? exact : planters().filter((p) => named.split(' ').every((w) => nameOf(p).split(' ').includes(w)));
    if (named && !pool.some((p) => { const q = pose(p); return q && Math.hypot(q.x - me[0], q.z - me[1]) <= HARVEST_REACH; })) return { code: 'harvest.no-such-planter', reason: `There is no garden planter called "${params.from}" near enough to pick ${hv.word} from.` };
    for (const p of pool) {
      const q = pose(p); if (!q) continue; const d = Math.hypot(q.x - me[0], q.z - me[1]); if (d > HARVEST_REACH) continue;
      // someone else's private planter is not picked from (ownership, layers.ts): it is skipped, and named if nothing else is ripe
      const no = soul.soulId ? h.access?.(p, { soulId: soul.soulId, name: soul.name ?? '' }) ?? null : null;
      if (Math.round(num(stateOf(p).growth)) === from && d < rd) { if (no) { denied ??= no; continue; } rd = d; ripe = p; }
      if (d < ad && !no) { ad = d; any = p; }
    }
    if (!ripe && denied) return denied;
    // a named planter that is someone else's private one, and not ripe: say so, not that no planter is near
    if (!ripe && !any && named) { const p = pool.find((x) => pose(x)); const no = p && soul.soulId ? h.access?.(p, { soulId: soul.soulId, name: soul.name ?? '' }) ?? null : null; if (no) return no; }
    if (!ripe) return any ? { code: 'harvest.not-ripe', reason: `Nothing in ${m.pathOf(any)} is ready to pick into ${name}: it is ${stageOf(stateOf(any).growth)}, and ${hv.word} are picked when it is ${hv.from}.` } : { code: 'harvest.no-planter', reason: `There is no garden planter near enough to pick ${hv.word} from.` };
    const wp = pose(ripe)!, pdef = defOf(ripe)!, half = pdef.size.box[2] / 2;
    // stand at the long side nearer the Soul, facing into the bed; the left hand goes to the plant on the body's left
    const lz = (me[0] - wp.x) * Math.sin(wp.yaw) + (me[1] - wp.z) * Math.cos(wp.yaw), side = lz >= 0 ? 1 : -1;
    const face = heading(wp, [0, -side]), right: Vec2 = [-Math.sin(face), Math.cos(face)];
    const points = hv.reach.map((r) => toWorld(wp, [r.x, r.y, side * (half - INTO_BED)]));
    const at = points.sort((a, b) => (a[0] * right[0] + a[2] * right[1]) - (b[0] * right[0] + b[2] * right[1]))[0];
    let st: Vec3 | null = null;
    for (const g of [STAND_GAP, STAND_GAP + 0.05, STAND_GAP + 0.1]) {
      const edge = toWorld(wp, [0, 0, side * (half + g / wp.s)]), lat = (at[0] - edge[0]) * right[0] + (at[2] - edge[2]) * right[1];
      const s: Vec3 = [edge[0] + right[0] * (lat + HAND_LEFT), 0, edge[2] + right[1] * (lat + HAND_LEFT)];
      if (clear(s)) { st = s; break; }
    }
    if (!st) return { code: 'harvest.planter-blocked', reason: `There is no room to stand at ${m.pathOf(ripe)} to pick from it.` };
    const steps: Step[] = []; let stand: Vec3 | undefined;
    if (!held) { const no = soul.soulId ? h.denied?.(id, { soulId: soul.soulId, name: soul.name ?? '' }) ?? null : null; if (no) return no; const f = fetchSteps(id, soul.entityId, me); if ('code' in f) return f; steps.push(LET_GO, ...f.steps); stand = f.stand; }
    steps.push(walk(st, face), LET_GO, { verb: 'mars:hand_actuator_v1', params: { target: ripe, at: at.map(r3), hand: 'left', hold: PICK_HOLD_SECONDS } });
    planned.set(soul.entityId, { vessel: id, planter: ripe, stand });
    // the pick happens at the hand's contact (and is checked again there): the summary says what the act does
    return { steps, summary: `Picks ${hv.take} ${hv.word} from ${m.pathOf(ripe)} into ${name} at the hand's touch.` };
  }

  /** Compact nearby facts (here.ts, ≤ 4 m): what a vessel holds, once it holds some. Never the stored state. */
  function facts(id: string): Record<string, unknown> | null {
    const hv = harvestOf(defOf(id) as never); if (!hv) return null;
    const n = Math.round(num(stateOf(id)[hv.field])); return n > 0 ? { [hv.field]: n } : null;
  }

  // ---- the world changes at the hand's contact ----
  const watching = new Map<string, number>(), fired = new Set<string>(), planned = new Map<string, { vessel: string; planter: string; stand?: Vec3 }>(), acting = new Map<string, { vessel: string; planter: string; stand?: Vec3; since?: number; reached?: true }>();
  /** What the hand's contact came to, kept for the receipt when the act's steps end (`outcome`). */
  const touched = new Map<string, { vessel: string; failure: Refusal | null }>();
  let visits = 0;
  /** A body was given a picking act: watch its motions until they are done (with a minute's grace before them). */
  function expect(body: string) { const p = planned.get(body); if (!p) return; acting.set(body, { ...p, since: h.engine.world.tick }); touched.delete(body); watching.set(body, h.engine.world.tick + GRACE_TICKS); }
  /** The pick itself: the planter back a stage and the vessel holding what was picked, in one commit, if the planter is
   *  still ripe for it and the vessel is in this body's hand. Otherwise why nothing was picked. */
  function pick(body: string, vessel: string, planter: string): Refusal | null {
    const hv = harvestOf(defOf(vessel) as never) as Harvest | null, s = ents()[vessel]?.support;
    if (!hv) return { code: 'harvest.vessel-gone', reason: 'What you were picking into is not there any more; nothing was picked.' };
    const name = M().pathOf(vessel), bed = M().pathOf(planter), growth = stateOf(planter).growth;
    if (s?.kind !== 'in-hand' || s.by !== body) return { code: 'harvest.vessel-lost', reason: `${name} was not in your hand when you reached ${bed}; nothing was picked.` };
    // two Souls at one bed: the first hand to touch it picks; the other is told so
    if (Math.round(num(growth)) !== GROWTH_STAGES.indexOf(hv.from)) return { code: 'harvest.not-ripe', reason: `${bed} was ${stageOf(growth)} when your hand reached it, not ${hv.from}; nothing was picked into ${name}.` };
    const have = Math.round(num(stateOf(vessel)[hv.field]));
    if (have + hv.take > hv.holds) return { code: 'harvest.vessel-full', reason: `${name} had no room for ${hv.take} more ${hv.word}; nothing was picked.` };
    const ops: Op[] = [opSchema.parse({ op: 'set', id: planter, state: { growth: GROWTH_STAGES.indexOf(hv.leaves) } }), opSchema.parse({ op: 'set', id: vessel, state: { [hv.field]: have + hv.take } })];
    const r = h.commit(ops, `${body} harvest ${planter} into ${vessel}`); if (r.accepted) return null;
    h.log(`harvest ${planter}: the world refused ${JSON.stringify(ops)}`);
    return { code: 'harvest.refused', reason: `The world refused the pick from ${bed}; nothing was picked.` };
  }
  /** What a `harvest` act came to when its steps ended, for its receipt; null when this is not a picking act, or the steps
   *  stopped before the hand touched anything (the programme's own reason stands). The steps ending says only that the body
   *  moved: the receipt says what the contact did. A hold cut short after the pick is still a pick (#1214). */
  function outcome(capability: string, body: string, finished: boolean): 'done' | Refusal | null {
    const vessel = /^object:(.+):harvest$/.exec(capability)?.[1]; if (!vessel) return null;
    const def = defOf(vessel); if (def && !harvestOf(def as never)) return null;
    const t = touched.get(body); touched.delete(body);
    if (t?.vessel === vessel) return t.failure ?? 'done';
    if (!finished) return null;
    return def ? { code: 'harvest.not-picked', reason: `Your hand did not pick anything into ${M().pathOf(vessel)}.` } : { code: 'harvest.vessel-gone', reason: 'What you were picking into is not there any more; nothing was picked.' };
  }
  /** Per tick, only for bodies given a picking act (usually none). */
  function tick() {
    if (!watching.size) return;
    const now = h.engine.world.tick, d = dt();
    for (const [body, until] of watching) {
      visits++;
      const p = acting.get(body), motion = ents()[body]?.human?.handActuator as HandActuatorMotion | undefined;
      // this act's own hand motion on the planter, not an earlier one still easing back
      const am = p && motion?.target === p.planter && motion.startTick >= (p.since ?? 0) ? motion : undefined;
      // the act's hand motion on the planter has ended (picked, or interrupted before the contact): nothing more to watch
      if (p?.reached && !am) { acting.delete(body); watching.delete(body); continue; }
      if (p && am) {
        p.reached = true; watching.set(body, now + GRACE_TICKS);
        const key = am.actionId ?? `${body}:${am.startTick}`;
        if (!fired.has(key) && handActuatorFrame(am, (now - am.startTick) * d).contact) {
          fired.add(key); let failure: Refusal | null;
          try { failure = pick(body, p.vessel, p.planter); } catch (e) { h.log(`harvest: ${(e as Error).message}`); failure = { code: 'harvest.refused', reason: 'The world could not apply the pick; nothing was picked.' }; }
          if (failure) h.log(`harvest ${p.planter}: ${failure.code}`);
          touched.set(body, { vessel: p.vessel, failure });
        }
      } else if (now > until) {
        // the grace is only for an act that never began; one still open may be waiting its turn at a crowded table
        const act = p ? `object:${p.vessel}:harvest` : '', v = p ? ents()[p.vessel]?.support : undefined;
        if (p && h.actOpen?.(body, act)) {
          if ((v?.kind !== 'in-hand' || v.by !== body) && now - (p.since ?? now) >= FETCH_TICKS) { h.actFail?.(body, act, { code: 'harvest.fetch-blocked', reason: `You did not get to ${M().pathOf(p.vessel)} within two minutes. Nothing was picked.` }); watching.delete(body); acting.delete(body); }
          else watching.set(body, now + GRACE_TICKS);
        } else { watching.delete(body); acting.delete(body); }
      }
      if (fired.size > 64) for (const x of [...fired].slice(0, 32)) fired.delete(x);
    }
  }
  return { plan, facts, expect, outcome, tick, watchingCount: () => watching.size, visits: () => visits };
}
export type HarvestFaculty = ReturnType<typeof createHarvest>;
