// Items on surfaces and in hands (owner feedback §12, ITEMS.md). An item entity (catalog-items.ts,
// `handling.small`) is supported by exactly one of:
//   resting-on { on: <table>, slot: <surfaceSlot id> }  — on a table top, pose at the slot point
//   ground                                               — on the floor, phase 'staged' (a static
//                                                          obstacle when taller than the 0.22 m step)
//   in-hand { by: <person>, hand: 'left' | 'right' }     — pose = hand point − rot(grip, yaw)
// Items on tables or in hands have no phase, so spatial/service.ts never rasterises them.
import { add2, clamp, datan2, dcos, dsin, heading, rot2, sub2, type Vec2, type Vec3 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Provenance, WorldState } from '../world/types.ts';
import { CATALOG, type AssetDef } from '../world/catalog.ts';
import { CONTAINERS, isHandItem } from '../world/catalog-items.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { APPROACH_CLEARANCE, APPROACH_GAPS, blockerNear } from '../social/slots.ts';
import { HANDS, at, carryHand, sideOf, type BodyFrame, type Hand } from './body.ts';
import { BODY_MODEL } from '../body/model.ts';

/** Farthest an item may be from the table edge in front of the person (m). */
export const ITEM_REACH = BODY_MODEL.tableReach;
/** Farthest an item may be from a standing person's body axis, horizontally (m): edge gap + ITEM_REACH. */
export const BODY_REACH = APPROACH_GAPS[APPROACH_GAPS.length - 1] + ITEM_REACH;
/** Ground items: standing points this far from the item (m), 8 directions. */
export const GROUND_STANDOFF = 0.45;

const hyp = (x: number, z: number) => Math.sqrt(x * x + z * z);
const p2 = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
const fmt = (q: Vec2 | Vec3) => (q.length === 3 ? `(${q[0].toFixed(2)}, ${q[2].toFixed(2)})` : `(${q[0].toFixed(2)}, ${q[1].toFixed(2)})`);

export const itemDef = (e: Entity): AssetDef | undefined => CATALOG[e.def];
export const isItem = (e: Entity | undefined): boolean => !!e && isHandItem(itemDef(e));
/** Soul Actions 34: where a hand carries this item. A handle-held item (a watering can) hangs at the side with the arm
 *  down, a little lower when it is full (`carryDropV1`, set by the watering verb); everything else at the carry point. */
export function carryPoint(item: Entity | undefined, b: BodyFrame, h: Hand): Vec3 {
  const hc = item && itemDef(item)?.handling?.hangCarry;
  return hc ? at(b, hc.fwd, sideOf(h) * hc.side, hc.up - (item.carryDropV1 ?? 0)) : carryHand(b, h);
}
/** Reach time for an item (s): handle-held items are reached for slowly and deliberately; undefined = the verb's own. */
export const itemReachSeconds = (item: Entity | undefined): number | undefined => (item ? itemDef(item)?.handling?.hangCarry?.reachSeconds : undefined);

export function itemEntity(id: string, defId: string, p: Vec3, yaw = 0, opts: { provenance?: Provenance; contents?: { food: string; fraction: number }; label?: string } = {}): Entity {
  if (!isHandItem(CATALOG[defId])) throw new Error(`${defId} is not a small hand-held item`);
  if (opts.contents && !CONTAINERS.has(defId)) throw new Error(`${defId} cannot hold food`);
  return {
    id,
    def: defId,
    kind: 'component',
    ...(opts.label ? { label: opts.label } : {}),
    pose: { p: [p[0], p[1], p[2]], yaw },
    provenance: opts.provenance ?? { origin: 'test-fixture', confidence: 'hypothetical' },
    phase: 'staged',
    support: { kind: 'ground' },
    ...(opts.contents ? { contents: { ...opts.contents } } : {}),
  };
}

/** Where the hand holds the item, item-local (catalog grip slot). */
export const gripLocal = (d: AssetDef): Vec3 => d.handling?.grips[1]?.[0]?.local ?? [0, 0, 0];

/** Items `actor` holds, left hand first. */
export function heldBy(w: WorldState, actor: string): { item: Entity; hand: Hand }[] {
  const out: { item: Entity; hand: Hand }[] = [];
  for (const h of HANDS) {
    const e = inHand(w, actor, h);
    if (e) out.push({ item: e, hand: h });
  }
  return out;
}
/** Publish presented-item metadata from the holder lookup; support remains the custody authority. */
export function publishHeldItems(actor: Entity, held: { item: Entity; hand: Hand }[]) {
  const presented = held.filter(x => x.item.tags?.includes('entity-world-item-pose'));
  if (presented.length) actor.human!.heldItemsV1 = Object.fromEntries(presented.map(x => [x.hand, x.item.id]));
  else delete actor.human!.heldItemsV1;
}
export function inHand(w: WorldState, actor: string, hand: Hand): Entity | undefined {
  for (const e of Object.values(w.entities)) if (e.support?.kind === 'in-hand' && e.support.by === actor && e.support.hand === hand) return e;
  return undefined;
}

/** Human-readable whereabouts for diagnostics. */
export function whereIs(w: WorldState, e: Entity): string {
  const s = e.support;
  if (s?.kind === 'in-hand') return `in ${s.by}'s ${s.hand} hand`;
  if (s?.kind === 'resting-on') return `on ${s.on}${s.slot ? `#${s.slot}` : ''}`;
  if (s?.kind === 'ground') return `on the ground at ${fmt(e.pose.p)}`;
  return `support ${s?.kind ?? 'none'}`;
}

// ---- surfaces ----

export type SurfaceSlot = { id: string; owner: string; slot: string; p: Vec3; hang?: true; inside?: NonNullable<import('../world/catalog-items.ts').SurfaceSlotDef['inside']>; local?: Vec3 };

export function surfaceSlotsOf(w: WorldState, owner: string): SurfaceSlot[] {
  const t = w.entities[owner];
  const d = t && CATALOG[t.def];
  if (!t || !d?.surfaceSlots) return [];
  return d.surfaceSlots.map((s) => {
    const q = rot2([s.local[0], s.local[2]], t.pose.yaw);
    return { id: `${owner}#${s.id}`, owner, slot: s.id, p: [t.pose.p[0] + q[0], t.pose.p[1] + s.local[1], t.pose.p[2] + q[1]] as Vec3, ...(s.hang ? { hang: true as const } : {}), ...(s.inside ? { inside: s.inside, local: [...s.local] as Vec3 } : {}) };
  });
}

export function surfaceSlot(w: WorldState, id: string): SurfaceSlot | Diagnostic {
  const k = id.lastIndexOf('#');
  const owner = k > 0 ? id.slice(0, k) : id;
  const t = w.entities[owner];
  if (!t) return { code: 'entity.unknown', message: `no surface "${owner}" (from surface slot "${id}")`, subjects: [owner] };
  const all = surfaceSlotsOf(w, owner);
  if (!all.length) return { code: 'item.no-surface', message: `${owner} (${t.def}) has no surface slots to put things on`, subjects: [owner] };
  const s = all.find((x) => x.id === id);
  if (!s) return { code: 'item.unknown-slot', message: `${owner} has no surface slot "${id.slice(k + 1)}" (slots ${all[0].slot}…${all[all.length - 1].slot})`, subjects: [owner] };
  return s;
}

export function slotOccupant(w: WorldState, owner: string, slot: string): Entity | undefined {
  for (const e of Object.values(w.entities)) if (e.support?.kind === 'resting-on' && e.support.on === owner && e.support.slot === slot) return e;
  return undefined;
}

// ---- placing (pose + support + phase together) ----

export function placeOnSlot(item: Entity, s: SurfaceSlot, yaw: number) {
  item.pose = { p: [s.p[0], s.p[1], s.p[2]], yaw };
  item.support = { kind: 'resting-on', on: s.owner, slot: s.slot };
  item.phase = undefined;
}
export function placeOnGround(item: Entity, p: Vec3, yaw: number) {
  item.pose = { p: [p[0], p[1], p[2]], yaw };
  item.support = { kind: 'ground' };
  item.phase = 'staged';
}
/** Item pose for a hand at `hand` (world), item yaw `yaw`. */
export function poseAtHand(item: Entity, hand: Vec3, yaw: number): Vec3 {
  const g = gripLocal(itemDef(item)!);
  const q = rot2([g[0], g[2]], yaw);
  return [hand[0] - q[0], hand[1] - g[1], hand[2] - q[1]];
}
/** World point the hand goes to when grasping the item where it lies. */
export function graspPoint(item: Entity): Vec3 {
  const g = gripLocal(itemDef(item)!);
  const q = rot2([g[0], g[2]], item.pose.yaw);
  return [item.pose.p[0] + q[0], item.pose.p[1] + g[1], item.pose.p[2] + q[1]];
}
/** Item yaw while held: the holder's yaw plus the turn it was handed over with (entry 41; 0 for anything picked up), so a
 *  handed-over item keeps the way it faced instead of spinning half round to its new holder's heading. */
export const heldYaw = (item: Entity, holder: Entity) => { const t = (item.support as { turn?: number } | undefined)?.turn; return t ? datan2(dsin(holder.pose.yaw + t), dcos(holder.pose.yaw + t)) : holder.pose.yaw; };
export function followHand(item: Entity, hand: Vec3, yaw: number) {
  item.pose = { p: poseAtHand(item, hand, yaw), yaw };
}
export function putInHand(item: Entity, actor: string, hand: Hand) {
  item.support = { kind: 'in-hand', by: actor, hand };
  item.phase = undefined;
}

// ---- standing points ("stations") within reach ----

export type Station = { p: Vec2; yaw: number };

/**
 * Deterministic standing point from which `actor` can reach world point `target` — the same
 * approach-point pattern as social/slots.ts seatApproach. On a table (`owner` with surface slots): for
 * each side of the top whose edge is ≤ ITEM_REACH from the target, the point APPROACH_GAPS beyond
 * that edge straight opposite the target (clamped to the edge), first with ≥ APPROACH_CLEARANCE;
 * sides ordered by distance from the actor. On the ground: 8 points GROUND_STANDOFF around it, the
 * one facing the actor first. `item.unreachable` names what blocks every candidate.
 * `comfortDepth` (m, opted-in presented items only): a side whose edge is farther than this from the target ranks after
 * every shallower side, so the body stands where the reach is short (a bowl 0.44 m in from the end the actor walked up
 * to is 0.23 m in from the side); sides within it keep the actor-distance order.
 */
export function reachStation(rt: Runtime, actor: Entity, target: Vec3, owner: Entity | undefined, what: string, comfortDepth?: number): Station | Diagnostic {
  const sp = rt.services.spatial as Spatial | undefined;
  sp?.sync(rt.world);
  const g = sp?.level(actor.human!.level);
  const clear = (q: Vec2) => (g ? clearanceAt(g, q) : Infinity);
  const me = p2(actor);
  const tried: { p: Vec2; cl: number; side: string }[] = [];
  let cands: { p: Vec2; yaw: number; side: string; far: boolean }[] = [];
  if (owner) {
    const d = CATALOG[owner.def];
    const half: Vec2 = [d.size[0] / 2, d.size[2] / 2];
    const c = p2(owner);
    const l = rot2(sub2([target[0], target[2]], c), -owner.pose.yaw);
    const sides: { n: Vec2; name: string }[] = [
      { n: [0, 1], name: '+z side' },
      { n: [0, -1], name: '−z side' },
      { n: [1, 0], name: '+x end' },
      { n: [-1, 0], name: '−x end' },
    ];
    const rows: { n: Vec2; name: string; edge: Vec2; depth: number; order: number }[] = [];
    for (const s of sides) {
      const k = s.n[0] !== 0 ? 0 : 1; // axis the side is normal to
      const depth = half[k] - s.n[k] * l[k];
      const edge: Vec2 = k === 0 ? [s.n[0] * half[0], clamp(l[1], -half[1], half[1])] : [clamp(l[0], -half[0], half[0]), s.n[1] * half[1]];
      const probe = add2(c, rot2([edge[0] + s.n[0] * APPROACH_GAPS[0], edge[1] + s.n[1] * APPROACH_GAPS[0]], owner.pose.yaw));
      rows.push({ ...s, edge, depth, order: hyp(probe[0] - me[0], probe[1] - me[1]) });
    }
    const deep = (r: { depth: number }) => (comfortDepth === undefined ? 0 : Math.max(r.depth, comfortDepth));
    rows.sort((a, b) => deep(a) - deep(b) || a.order - b.order || sides.indexOf(a) - sides.indexOf(b));
    for (const s of rows)
      for (const gap of APPROACH_GAPS) {
        const p = add2(c, rot2([s.edge[0] + s.n[0] * gap, s.edge[1] + s.n[1] * gap], owner.pose.yaw));
        cands.push({ p, yaw: heading(sub2([target[0], target[2]], p)), side: `${owner.id} ${s.name}`, far: s.depth > ITEM_REACH + 1e-9 });
      }
  } else {
    const t: Vec2 = [target[0], target[2]];
    const a0 = hyp(me[0] - t[0], me[1] - t[1]) > 1e-6 ? heading(sub2(me, t)) : 0;
    for (let k = 0; k < 8; k++) {
      const dk = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2); // 0, +1, −1, +2, −2 … eighths
      const p = add2(t, rot2([GROUND_STANDOFF, 0], a0 + (dk * Math.PI) / 4));
      cands.push({ p, yaw: heading(sub2(t, p)), side: `ground ${k}`, far: false });
    }
  }
  const near = cands.filter((q) => !q.far);
  for (const q of near) {
    const cl = clear(q.p);
    if (cl >= APPROACH_CLEARANCE) return { p: q.p, yaw: q.yaw };
    tried.push({ p: q.p, cl, side: q.side });
  }
  cands = [];
  const blockers = new Set<string>();
  const parts: string[] = [];
  for (const t of tried) {
    if (parts.some((x) => x.startsWith(t.side))) continue;
    const b = g ? blockerNear(g, t.p, owner?.id ?? '') : undefined;
    if (b) blockers.add(b);
    const label = b ? sp!.scene.obstacles.find((o) => o.id === b)?.label : undefined;
    parts.push(`${t.side} ${fmt(t.p)} ${t.cl.toFixed(2)} m clear, blocked by ${b ? (label && label !== b ? `${b} (${label})` : b) : 'the edge of walkable ground'}`);
  }
  return {
    code: 'item.unreachable',
    message: `${actor.id} cannot reach ${what}: ${near.length ? `no standing room within ${ITEM_REACH} m reach (${parts.join('; ')}); a person needs ${APPROACH_CLEARANCE.toFixed(2)} m` : `it is more than ${ITEM_REACH} m from every edge of ${owner?.id}`}`,
    subjects: [actor.id, ...(owner ? [owner.id] : []), ...blockers],
    at: target,
  };
}

/** Horizontal distance from a person's body axis to a world point. */
export const reachOf = (actor: Entity, p: Vec3) => hyp(p[0] - actor.pose.p[0], p[2] - actor.pose.p[2]);

// ---- inside a container (Soul Actions entry 42) ----

/** A fixture-frame point (x, y, z) in the world. */
export function fixturePoint(t: Entity, l: Vec3): Vec3 {
  const q = rot2([l[0], l[2]], t.pose.yaw);
  return [t.pose.p[0] + q[0], t.pose.p[1] + l[1], t.pose.p[2] + q[1]];
}
/** A world point in the fixture frame. */
export function fixtureLocal(t: Entity, p: Vec3): Vec3 {
  const q = rot2([p[0] - t.pose.p[0], p[2] - t.pose.p[2]], -t.pose.yaw);
  return [q[0], p[1] - t.pose.p[1], q[1]];
}
/** The place inside a container an item rests in, or null (a table top, the ground, a hand). */
export function storedIn(w: WorldState, item: Entity): SurfaceSlot | null {
  const s = item.support;
  if (s?.kind !== 'resting-on' || !s.slot) return null;
  return surfaceSlotsOf(w, s.on).find((x) => x.slot === s.slot && x.inside) ?? null;
}
/** Whether an item of catalog size (w, h, d) fits a place inside (either way round on the floor). */
export function fitsInside(size: readonly number[], fit: readonly number[]): boolean {
  const [w, h, d] = size, e = 1e-6;
  return h <= fit[1] + e && ((w <= fit[0] + e && d <= fit[2] + e) || (d <= fit[0] + e && w <= fit[2] + e));
}
