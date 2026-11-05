// PC12 (#691): structural joints between parts. A def declares typed connectors (components.connectors); `connect` joins
// two that mate and meet, and each part keeps its half (Entity.joins), so the graph is reciprocal and never rides on
// scene parenting. A part with bearing connectors is held up through them: once any is joined, all must be, to parts
// that are themselves supported; with none joined it must lie on the ground. Nothing here names a kind or a def.
import type { WorldModel } from './model.ts';
import { jointId, type Entity, type Failure, type StoredDef } from './schemas.ts';

export type Connector = NonNullable<StoredDef['components']['connectors']>[number];
/** How far apart two connector points may be and still join (m). */
export const JOIN_TOL_M = 0.05;
/** A bearing part with no joint is supported only lying on the ground: its base at most this far above it (m). */
export const GROUND_TOL_M = 0.05;

const fail = (op: number, code: string, detail: string, extra: Partial<Failure> = {}): Failure => ({ op, code, detail, ...extra });
export const connectorsOf = (def: StoredDef | undefined): Connector[] => def?.components.connectors ?? [];
const bearing = (def: StoredDef | undefined) => connectorsOf(def).filter((c) => c.bears);

/** A connector's point in the world: the part's world pose with its tilt (r = [yaw, x, z], three.js XYZ order, the
 *  order the client draws it in), at its scale. */
export function connectorPoint(w: WorldModel, e: Entity, c: Connector): [number, number, number] { return localToWorld(w, e, c.at); }
function localToWorld(w: WorldModel, e: Entity, at: readonly number[]): [number, number, number] {
  const wp = w.worldPose(e), rx = Array.isArray(e.r) ? e.r[1] : 0, rz = Array.isArray(e.r) ? e.r[2] : 0;
  let [x, y, z] = [at[0] * wp.s, at[1] * wp.s, at[2] * wp.s];
  { const k = Math.cos(rz), s = Math.sin(rz); [x, y] = [x * k - y * s, x * s + y * k]; }
  { const k = Math.cos(wp.yaw), s = Math.sin(wp.yaw); [x, z] = [x * k + z * s, -x * s + z * k]; }
  { const k = Math.cos(rx), s = Math.sin(rx); [y, z] = [y * k - z * s, y * s + z * k]; }
  return [wp.x + x, wp.y + y, wp.z + z];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const at = (p: number[]) => `(${p.map(r2).join(', ')})`;

/** Why `a.ca` cannot join `b.cb` now, or null. */
export function joinProblem(w: WorldModel, a: Entity, ca: string, b: Entity, cb: string, i: number): Failure | null {
  const name = (e: Entity) => w.pathOf(e.id);
  if (a.id === b.id) return fail(i, 'connector.incompatible', `${name(a)} cannot be joined to itself`);
  const da = w.resolvedDef(a.def), db = w.resolvedDef(b.def);
  const xa = connectorsOf(da).find((c) => c.id === ca), xb = connectorsOf(db).find((c) => c.id === cb);
  for (const [e, x, id, d] of [[a, xa, ca, da], [b, xb, cb, db]] as const) if (!x) {
    const have = connectorsOf(d);
    return fail(i, 'connector.unknown', `${name(e)} has no connector ${id}${have.length ? ` (it has ${have.length}: ${have.slice(0, 4).map((c) => c.id).join(', ')}${have.length > 4 ? ', …' : ''})` : ' (its def declares none)'}`, { entity: e.id, field: 'connector' });
  }
  if (!xa!.mates.includes(xb!.kind) || !xb!.mates.includes(xa!.kind))
    return fail(i, 'connector.incompatible', `${name(a)} ${ca} (${xa!.kind}) does not mate with ${name(b)} ${cb} (${xb!.kind})`, { field: 'connector', fix: `Join a ${xa!.kind} to one of: ${xa!.mates.join(', ')}.` });
  for (const [e, id] of [[a, ca], [b, cb]] as const) {
    const j = e.joins?.[id];
    if (j) return fail(i, 'connector.taken', `${name(e)} ${id} is already joined to ${w.pathOf(j.to)} ${j.at} (joint ${jointId(e.id, id, j.to, j.at)})`, { entity: e.id, field: 'connector', fix: 'Disconnect it first, or use a free connector.' });
  }
  // the engine takes a joined part's yaw and its roll about its own z, at scale 1: a part pitched about x or scaled would
  // meet here and not there, so it does not join
  for (const e of [a, b]) {
    const rx = Array.isArray(e.r) ? e.r[1] : 0;
    if (Math.abs(rx) > 1e-6 || (e.s ?? 1) !== 1) return fail(i, 'connector.pose', `${name(e)} is ${Math.abs(rx) > 1e-6 ? `tilted ${r2(rx)} rad about x` : `scaled ${e.s}`}; joined parts stand at scale 1 with r = [yaw, 0, roll]`, { entity: e.id, field: Math.abs(rx) > 1e-6 ? 'r' : 's', fix: 'Place it with r = [yaw, 0, roll] and no scale, then connect.' });
  }
  for (const e of [a, b]) if (e.in.parent !== 'world') return fail(i, 'connector.apart', `${name(e)} is inside ${w.pathOf(e.in.parent)}; joined parts stand in the world itself`, { entity: e.id, field: 'in', fix: 'Move it out to the world first.' });
  const pa = connectorPoint(w, a, xa!), pb = connectorPoint(w, b, xb!), d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
  if (d > JOIN_TOL_M) return fail(i, 'connector.apart', `${name(a)} ${ca} at ${at(pa)} and ${name(b)} ${cb} at ${at(pb)} are ${d.toFixed(2)} m apart (at most ${JOIN_TOL_M} m)`, { field: 'p', measured: +d.toFixed(3), limit: JOIN_TOL_M, fix: 'Place the parts so the two connectors meet, then connect.' });
  return null;
}

export const withHalf = (e: Entity, c: string, to: string, at: string): Entity => ({ ...e, v: e.v + 1, joins: { ...e.joins, [c]: { to, at } } });
export function withoutHalf(e: Entity, c: string): Entity {
  const { [c]: _gone, ...rest } = e.joins ?? {};
  const next: Entity = { ...e, v: e.v + 1 };
  if (Object.keys(rest).length) next.joins = rest; else delete next.joins;
  return next;
}

/** The lowest point of a part's box in the world (its tilt applied). */
function lowest(w: WorldModel, e: Entity): number {
  const box = w.resolvedDef(e.def)?.size.box; if (!box) return w.worldPose(e).y;
  let y = Infinity;
  for (const x of [-box[0] / 2, box[0] / 2]) for (const h of [0, box[1]]) for (const z of [-box[2] / 2, box[2] / 2]) y = Math.min(y, localToWorld(w, e, [x, h, z])[1]);
  return y;
}
/** Why a part is not held up, or null. `memo` holds each part's answer for one check; a part met again while its own
 *  answer is being worked out is in a cycle, and parts that only hold each other up are unsupported. */
function unsupported(w: WorldModel, e: Entity, memo: Map<string, string | null>): string | null {
  if (memo.has(e.id)) return memo.get(e.id) ?? null;
  memo.set(e.id, `${w.pathOf(e.id)} is held up only by parts it holds up`);
  const why = unsupportedNow(w, e, memo);
  memo.set(e.id, why);
  return why;
}
function unsupportedNow(w: WorldModel, e: Entity, memo: Map<string, string | null>): string | null {
  const bears = bearing(w.resolvedDef(e.def));
  if (!bears.length) {
    // a part that holds others up (an upright) stands on the ground itself: its lowest point on it
    if (!e.joins || e.in.parent !== 'world') return null;
    const wp = w.worldPose(e), gap = lowest(w, e) - w.terrain.sample(wp.x, wp.z);
    return Math.abs(gap) <= GROUND_TOL_M ? null : `${w.pathOf(e.id)} holds joined parts up but its foot is ${r2(Math.abs(gap))} m ${gap > 0 ? 'above' : 'below'} the ground`;
  }
  const joined = bears.filter((c) => e.joins?.[c.id]);
  if (!joined.length) {
    if (e.in.parent !== 'world') return null;   // held by what it sits in or on, as any placed thing
    const wp = w.worldPose(e), ground = w.terrain.sample(wp.x, wp.z);
    return wp.y - ground <= GROUND_TOL_M ? null : `${w.pathOf(e.id)} is ${r2(wp.y - ground)} m above the ground with none of its bearing connectors (${bears.map((c) => c.id).join(', ')}) joined`;
  }
  const free = bears.filter((c) => !e.joins?.[c.id]);
  if (free.length) return `${w.pathOf(e.id)} hangs by ${joined.map((c) => c.id).join(', ')} with ${free.map((c) => c.id).join(', ')} joined to nothing`;
  for (const c of joined) {
    const j = e.joins![c.id]!, o = w.entities.get(j.to);
    if (!o) return `${w.pathOf(e.id)} ${c.id} is joined to ${j.to}, which is gone`;
    const why = unsupported(w, o, memo);
    if (why) return `${w.pathOf(e.id)} rests on ${w.pathOf(o.id)}, and ${why}`;
  }
  return null;
}

/** After a batch: every part it joined, released or removed a joint from (and what they hold up) must still be held up.
 *  This is the refusal of an unsafe release: a disconnect, or the removal of an upright, that would leave a beam hanging. */
export function supportProblem(w: WorldModel, ids: Iterable<string>, opOf: (id: string) => number): Failure | null {
  const check = new Set<string>(), queue = [...ids];
  while (queue.length) {
    const id = queue.pop()!; if (check.has(id)) continue;
    const e = w.entities.get(id); if (!e) continue;
    check.add(id);
    for (const j of Object.values(e.joins ?? {})) queue.push(j.to);
  }
  const memo = new Map<string, string | null>();
  for (const id of [...check].sort()) {
    const e = w.entities.get(id)!;
    const why = unsupported(w, e, memo);
    if (why) return fail(opOf(id), 'support.none', why, { entity: id, field: 'joins', fix: 'Join every bearing connector to a supported part, set the part on the ground, or remove what it would hold up first.' });
  }
  return null;
}

/** On `define`: a connector lies on the part's own box (x along it, y up from its base, z across), 5 cm slack. */
export function connectorProblem(def: { size?: { box?: number[] }; components?: { connectors?: Connector[] } }): { code: string; field: string; message: string; fix: string } | null {
  const box = def.size?.box, cs = def.components?.connectors;
  if (!box || !cs) return null;
  const [L, H, W] = box, slack = 0.05;
  for (const c of cs) {
    const [x, y, z] = c.at;
    if (Math.abs(x) > L / 2 + slack || Math.abs(z) > W / 2 + slack || y < -slack || y > H + slack)
      return { code: 'def.invalid', field: `components.connectors.${c.id}`, message: `connector ${c.id} at (${c.at.join(', ')}) is off the part (${L} × ${H} × ${W} m)`, fix: 'Put each connector on the part\'s own box (x along it, y up from its base, z across).' };
  }
  return null;
}
