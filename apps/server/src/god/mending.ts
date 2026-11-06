// Soul Actions #442: things break and a Soul repairs them with a tool in her hand. All of it is def data
// (`components.repairable`, state `broken`): no code here names a def. "repair <thing>" is an act of ordinary native steps,
// a walk to a clear stand point and `repair_v1`. The action changes nothing itself: `broken` clears when the receipt
// completes, so an interrupted repair leaves it broken. No tick work; the receipt is what's durable across a restart.
import { opSchema, type Op, type StoredDef, type WorldModel } from '@sim/world-compiler';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';
import type { EdgeReceipt } from '../edge/contract.ts';
import { keptShut } from './actuators.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec3 = [number, number, number];
type Refusal = { code: string; reason: string };
/** How far off a tool may be for the refusal to name it (m). */
const TOOL_NEAR = 30;
type Repairable = NonNullable<StoredDef['components']['repairable']>;
const repairableOf = (def: StoredDef | undefined): Repairable | undefined => def?.components.repairable;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The offer a repairable def gets. `then` is empty: the result comes with the completed receipt, never at the offer. */
export function repairActions(def: StoredDef) {
  const rep = repairableOf(def); if (!rep) return [];
  return [{ name: 'repair', label: rep.label, roles: 'anyone', reach: 'anywhere', params: {}, when: [{ field: 'broken', is: true }], then: [] }] as unknown as StoredDef['actions'];
}
export type MendingHost = {
  model: WorldModel;
  engine: { world: { entities: Record<string, any> }; clearanceAtV1?(x: number, z: number, level?: number): number };
  levelAt(x: number, z: number, y: number): number;
  /** Is someone sitting on or lying on it? */
  occupied(id: string): boolean;
  commit(ops: Op[], note: string): { accepted: boolean };
  log(m: string): void;
};
export function createMending(h: MendingHost) {
  const M = () => h.model, ents = () => h.engine.world.entities;
  const defOf = (id: string) => { const e = M().entities.get(id); return e ? M().resolvedDef(e.def) : undefined; };
  const isBroken = (id: string) => M().entities.get(id)?.state?.broken === true;
  const toolTag = (rep: Repairable) => `tool-${rep.tool}`;
  /** god local → world (the contact actuator's convention) */
  const toWorld = (wp: { x: number; y: number; z: number; yaw: number; s: number }, l: Vec3): Vec3 => { const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw); return [wp.x + (l[0] * c + l[2] * s) * wp.s, wp.y + l[1] * wp.s, wp.z + (-l[0] * s + l[2] * c) * wp.s]; };
  function plan(soul: { entityId: string }, id: string): { steps: { verb: string; params: Record<string, unknown> }[]; summary: string } | Refusal | null {
    const m = M(), e = m.entities.get(id), def = e && m.resolvedDef(e.def), rep = repairableOf(def); if (!e || !def || !rep) return null;
    const name = e.name ? m.pathOf(id) : `the ${def.name.replace(/^core-/, '').replace(/-/g, ' ')}`;
    if (!isBroken(id)) return { code: 'repair.not-broken', reason: `${name} is not broken.` };
    const body = ents()[soul.entityId]; if (!body?.human) return null;
    const held = Object.values(ents()).filter((x: any) => x?.support?.kind === 'in-hand' && x.support.by === soul.entityId) as any[];
    const tag = toolTag(rep), tools = held.filter((x) => defOf(x.id)?.tags.includes(tag));
    if (!tools.length) {
      if (held.length) return { code: 'repair.wrong-tool', reason: `${name} needs a ${rep.tool} in your hand; put down what you are holding first.` };
      let best = TOOL_NEAR, near: string | null = null;
      // only a tool she could go and pick up: not in someone's hand, not kept in something shut
      for (const o of m.entities.values()) { if (!m.resolvedDef(o.def)?.tags.includes(tag) || keptShut(m, o) || ents()[o.id]?.support?.kind === 'in-hand') continue; const q = m.worldPose(o), d = Math.hypot(q.x - body.pose.p[0], q.z - body.pose.p[2]); if (d < best) { best = d; near = o.id; } }
      return { code: 'repair.no-tool', reason: `${name} needs a ${rep.tool} in your hand. ${near ? `Pick up ${m.pathOf(near)} first.` : `There is no ${rep.tool} within reach here.`}` };
    }
    if (held.length > 1) return { code: 'repair.hand-full', reason: `Repairing ${name} needs your other hand free; put down what else you are holding first.` };
    if (h.occupied(id)) return { code: 'repair.occupied', reason: `Someone is sitting on ${name}; it can't be repaired under them.` };
    const wp = m.worldPose(e), level = h.levelAt(wp.x, wp.z, wp.y), hand = toWorld(wp, rep.hand);
    const clear = (p: Vec3) => (h.engine.clearanceAtV1 ? h.engine.clearanceAtV1(p[0], p[2], level) : Infinity) >= HUMAN_RADIUS + 0.02;
    const stand = rep.stands.map((s) => toWorld(wp, [s[0], 0, s[1]])).find(clear);
    if (!stand) return { code: 'repair.no-room', reason: `There is no room to stand and work at ${name}.` };
    // engine heading: forward is (cos, sin) in (x, z)
    const face = r3(Math.atan2(hand[2] - stand[2], hand[0] - stand[0]));
    return {
      summary: `Repaired ${name} with the ${rep.tool}.`,
      steps: [{ verb: 'stand', params: {} }, { verb: 'mars:walk_to', params: { x: r3(stand[0]), z: r3(stand[2]), level, face } },
        { verb: 'mars:repair_v1', params: { item: tools[0].id, target: id, face, hand: hand.map(r3), strokes: rep.strokes, lift: rep.lift, motion: rep.motion } }],
    };
  }
  /** A receipt ended: a completed repair clears `broken`. Receipts can be announced again after a restart, and the creator
   *  may have broken it again since, so the state keeps the receipt that last repaired it. */
  function onReceipt(r: EdgeReceipt) {
    if (r.phase !== 'completed') return;
    const m = /^object:(.+):repair$/.exec(r.capability); if (!m) return;
    const e = M().entities.get(m[1]), def = e && M().resolvedDef(e.def);
    if (!e || !repairableOf(def) || e.state?.repairedBy === r.id) return;
    // already whole: still noted, so this receipt can't clear a later break if it is announced again after a restart
    if (e.state?.broken !== true) { if (h.commit([opSchema.parse({ op: 'set', id: e.id, state: { repairedBy: r.id } })], `${r.soulId} found ${e.id} whole`).accepted === false) h.log(`repair: the world refused the note on ${e.id}`); return; }
    const done = h.commit([opSchema.parse({ op: 'set', id: e.id, state: { broken: false, repairedBy: r.id } })], `${r.soulId} repaired ${e.id}`);
    if (!done.accepted) h.log(`repair: the world refused the result on ${e.id}`);
  }
  /** What a completed repair did, for its receipt. Read as the receipt ends, before `onReceipt` clears `broken`: a second
   *  Soul who finishes after the first, or after the creator mended it, is told it was already whole. */
  function effects(r: EdgeReceipt): { summary: string } | Record<string, never> {
    if (r.phase !== 'completed') return {};
    const m = /^object:(.+):repair$/.exec(r.capability); if (!m) return {};
    const e = M().entities.get(m[1]), def = e && M().resolvedDef(e.def), rep = repairableOf(def);
    if (!e || !rep) return rep === undefined && !e ? { summary: 'It was gone by the time you finished, so nothing was repaired.' } : {};
    const name = e.name ? M().pathOf(e.id) : `the ${def!.name.replace(/^core-/, '').replace(/-/g, ' ')}`;
    return e.state?.broken === true ? { summary: `Repaired ${name} with the ${rep.tool}; the ${rep.tool} is still in your hand.` } : { summary: `${name} was already whole by the time you finished, so you repaired nothing.` };
  }
  return {
    plan, onReceipt, effects,
    /** Compact facts for a Soul nearby: only while broken. */
    facts(id: string) { const rep = repairableOf(defOf(id)); return rep && isBroken(id) ? { broken: rep.says } : null; },
    /** A repairable thing that is whole: nothing to offer, so it reads as it would without the faculty. */
    whole(id: string) { return !!repairableOf(defOf(id)) && !isBroken(id); },
    /** One gate for every plan: a step that would sit on a broken thing (a reading or listening spot's seat, a named seat part). */
    stepsRefusal(steps: { verb: string; params?: Record<string, unknown> }[]): Refusal | null {
      for (const s of steps) {
        if (s.verb !== 'sit' && s.verb !== 'mars:sit' && s.verb !== 'take_slot' && s.verb !== 'mars:take_slot') continue;
        const on = typeof s.params?.on === 'string' ? s.params.on : typeof s.params?.slot === 'string' ? s.params.slot.split('#')[0] : null;
        const no = on ? this.seatRefusal(on) : null; if (no) return no;
      }
      return null;
    },
    /** Why this seat can't take anyone now, or null. */
    seatRefusal(id: string): Refusal | null { const rep = repairableOf(defOf(id)); return rep && isBroken(id) ? { code: 'seat.broken', reason: `It is broken (${rep.says}); nobody can sit on it until it is repaired.` } : null; },
  };
}
export type Mending = ReturnType<typeof createMending>;
