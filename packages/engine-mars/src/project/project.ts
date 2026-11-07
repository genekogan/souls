// PC17 (#696): a blueprint, a procedure and a project are three things (docs/design/physical-coordination.md).
// - A blueprint is the target graph: parts by key, the defs each may be, where each goes in the site's own frame, what it
//   rests on. A procedure is finite maneuvers over those keys: template, crew size, dependencies, grouped into sections
//   that end at safe checkpoints. Neither can name a Soul, an entity or a world: both are data.
// - A binding is one site: where it is and which real entity is each part.
// - Progress is computed here from real parts, connections and support on every read. Nothing stores it, so nothing can
//   fabricate it. A maneuver is done when the world says so, whoever did it and however.
import { z } from 'zod';
import type { Entity, WorldState } from '../../../../mars/viewer/engine/world/types.ts';
import { def } from '../../../../mars/viewer/engine/world/catalog.ts';
import { angleDelta, hypot, rot2, wrapAngle, type Vec2 } from '../../../../mars/viewer/engine/core/math.ts';
import { beamBays, frameSupported, frameStability, heldUp, standing, worldPoint } from '../beam-connect.ts';
import { joistBays, JOIST_SEAT, ofKind, sheetBays, socketsOf } from '../deck-install.ts';
import { flightBays, treadTarget } from '../stair-install.ts';
import blueprintData from './rack-bay.blueprint.json' with { type: 'json' };
import procedureData from './rack-bay-build.procedure.json' with { type: 'json' };

const key = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/), defRef = z.string().regex(/^[a-z]+\/[a-z0-9-]+@\d+$/), xz = z.tuple([z.number(), z.number()]);
export const blueprintSchema = z.strictObject({
  schema: z.literal('souls-blueprint/1'), id: key, revision: z.number().int().min(1), label: z.string().max(120),
  parts: z.record(key, z.strictObject({
    /** The def revisions this part may be, the first preferred. */
    def: z.array(defRef).min(1).max(8),
    /** Where its centre stands (`stand`: a frame stood on end) or goes (`at`), in the site's own frame; a part with neither
     *  only has to be joined to its hosts (a tread, in whichever seat of its flight). */
    stand: xz.optional(), at: xz.optional(),
    /** The seat height it goes in above the ground (m). */
    height: z.number().min(0).max(4).optional(),
    /** The parts it rests on: a joint with each. */
    hosts: z.array(key).max(8),
    /** Its top is a floor; it is a stairs link. Both are read from the world's physics. */
    floor: z.literal(true).optional(), stairs: z.literal(true).optional(),
  })),
});
const maneuverSchema = z.strictObject({
  key, template: z.enum(['carry', 'raise-hold', 'connect-beam', 'release', 'install-joist', 'lay-sheet', 'install-flight', 'install-tread']), part: key,
  crew: z.number().int().min(1).max(4), after: z.array(key).max(16),
  /** A carry's spot in the site's frame: x, z, yaw. */
  spot: z.tuple([z.number(), z.number(), z.number()]).optional(),
});
export const procedureSchema = z.strictObject({
  schema: z.literal('souls-procedure/1'), id: key, revision: z.number().int().min(1), blueprint: z.string().regex(/^[a-z][a-z0-9-]*@\d+$/), label: z.string().max(120),
  /** Parts delivered beside the site, where they must lie to be used. */
  delivered: z.record(key, z.strictObject({ spot: z.tuple([z.number(), z.number(), z.number()]), within: z.number().positive().max(8) })),
  /** The half extents of the ground the site needs clear, in its own frame. */
  siteClear: xz,
  sections: z.array(z.strictObject({ key, label: z.string().max(120), checkpoint: z.string().max(160), maneuvers: z.array(maneuverSchema).min(1).max(64) })).min(1).max(12),
});
export type Blueprint = z.infer<typeof blueprintSchema>;
export type Procedure = z.infer<typeof procedureSchema>;
export type Maneuver = Procedure['sections'][number]['maneuvers'][number] & { section: string };

/** Why this procedure cannot run on this blueprint ([] = it can): every part and dependency it names exists, no cycle. */
export function procedureProblems(b: Blueprint, p: Procedure): string[] {
  const out: string[] = [], keys = new Set<string>();
  if (p.blueprint !== `${b.id}@${b.revision}`) out.push(`procedure ${p.id} is for ${p.blueprint}, not ${b.id}@${b.revision}`);
  const all = p.sections.flatMap((s) => s.maneuvers);
  for (const m of all) { if (keys.has(m.key)) out.push(`maneuver ${m.key} is listed twice`); keys.add(m.key); if (!b.parts[m.part]) out.push(`maneuver ${m.key} names no part of the blueprint (${m.part})`); }
  for (const m of all) for (const a of m.after) if (!keys.has(a)) out.push(`maneuver ${m.key} waits for ${a}, which is not in the procedure`);
  for (const [k, part] of Object.entries(b.parts)) for (const h of part.hosts) if (!b.parts[h]) out.push(`part ${k} rests on ${h}, which is not in the blueprint`);
  for (const k of Object.keys(p.delivered)) if (!b.parts[k]) out.push(`delivered ${k} is not in the blueprint`);
  const seen = new Set<string>(), left = new Map(all.map((m) => [m.key, m]));
  for (let moved = true; moved && left.size;) { moved = false; for (const [k, m] of left) if (m.after.every((a) => seen.has(a))) { seen.add(k); left.delete(k); moved = true; } }
  if (left.size) out.push(`maneuvers ${[...left.keys()].join(', ')} wait for each other`);
  return out;
}
const parsed = (() => {
  const b = blueprintSchema.parse(blueprintData), p = procedureSchema.parse(procedureData), bad = procedureProblems(b, p);
  if (bad.length) throw new Error(`rack bay data: ${bad.join('; ')}`);
  return { b, p };
})();
/** The procedures this build ships, by `id@revision`. */
export const PROCEDURES: Record<string, { procedure: Procedure; blueprint: Blueprint }> = { [`${parsed.p.id}@${parsed.p.revision}`]: { procedure: parsed.p, blueprint: parsed.b } };
export const maneuversOf = (p: Procedure): Maneuver[] => p.sections.flatMap((s) => s.maneuvers.map((m) => ({ ...m, section: s.key })));

export type Site = { origin: Vec2; yaw: number };
/** A point of the site's own frame in the world. */
export function atSite(site: Site, at: Vec2): Vec2 { const o = rot2(at, site.yaw); return [site.origin[0] + o[0], site.origin[1] + o[1]]; }
/** A carry's spot in the world: where its load lies and at what yaw. */
export function spotAt(site: Site, spot: readonly [number, number, number]): { x: number; z: number; yaw: number } {
  const p = atSite(site, [spot[0], spot[1]]); return { x: p[0], z: p[1], yaw: wrapAngle(spot[2] + site.yaw) };
}
/** Where a frame's base must end up, as `raise_hold_v1` needs it: the blueprint's stand point. */
export function standAt(b: Blueprint, site: Site, part: string): Vec2 | null { const s = b.parts[part]?.stand; return s ? atSite(site, s) : null; }

/** A lying or held part this close to its spot is on it (a carry lays a load within a few centimetres; its own pose
 *  origin can sit off its box). */
const ON_SPOT = 0.14, ON_SPOT_YAW = 0.06;
/** A part this close to where the blueprint puts it is there, in plan (the seats it goes into decide exactly). */
const IN_PLACE = 0.15;
/** A beam within this of the height the blueprint says is in that seat (the native snapSeat's hole tolerance). */
const SEAT_TOLERANCE = 0.08;

export type Bound = Record<string, string>;
const entityOf = (w: WorldState, bound: Bound, part: string): Entity | undefined => { const id = bound[part]; return id ? w.entities[id] : undefined; };
const planDistance = (e: Entity, q: Vec2) => hypot(e.pose.p[0] - q[0], e.pose.p[2] - q[1]);
/** Both halves of a joint between `e` and `h`. */
const joinedTo = (e: Entity, h: Entity) => (e.connections ?? []).some((c) => c.to === h.id && (h.connections ?? []).some((x) => x.to === e.id && x.socket === c.toSocket && x.toSocket === c.socket));
export function jointsMade(b: Blueprint, w: WorldState, bound: Bound): { made: number; total: number } {
  let made = 0, total = 0;
  for (const [k, part] of Object.entries(b.parts)) {
    const e = entityOf(w, bound, k);
    for (const h of part.hosts) { total++; const he = entityOf(w, bound, h); if (e && he && e.phase === 'installed' && joinedTo(e, he)) made++; }
  }
  return { made, total };
}
/** The height above the frame's foot of the seat `e` is joined to on `h`. */
function seatHeight(w: WorldState, e: Entity, h: Entity): number | null {
  const c = (e.connections ?? []).find((x) => x.to === h.id), s = c && socketsOf(h).find((x) => x.id === c.toSocket);
  return s ? worldPoint(h, s.local)[1] - (h.pose.p[1] - def(h.def).size[0] / 2) : null;   // a frame stands on its end: its length is its height
}
/** A part is in its place: installed, joined both ways to every host, where the blueprint puts it, at the height it says. */
function inPlace(b: Blueprint, w: WorldState, site: Site, bound: Bound, part: string): boolean {
  const e = entityOf(w, bound, part), bp = b.parts[part]!;
  if (!e || e.phase !== 'installed') return false;
  if (bp.at && planDistance(e, atSite(site, bp.at)) > IN_PLACE) return false;
  return bp.hosts.every((h) => {
    const he = entityOf(w, bound, h); if (!he || !joinedTo(e, he)) return false;
    if (bp.height === undefined) return true;
    const y = seatHeight(w, e, he); return y !== null && Math.abs(y - bp.height) <= SEAT_TOLERANCE;
  });
}
/** A frame stands where the blueprint says, held or on its own. */
function stands(b: Blueprint, w: WorldState, site: Site, bound: Bound, part: string): boolean {
  const e = entityOf(w, bound, part), at = standAt(b, site, part);
  return !!e && !!at && standing(e) && planDistance(e, at) <= IN_PLACE;
}
function onSpot(e: Entity, s: { x: number; z: number; yaw: number }): boolean {
  if (e.support?.kind !== 'ground' || planDistance(e, [s.x, s.z]) > ON_SPOT) return false;
  const d = Math.abs(angleDelta(e.pose.yaw ?? 0, s.yaw));
  return Math.min(d, Math.abs(Math.PI - d)) <= ON_SPOT_YAW;
}
/** The world says this maneuver has been done, by whoever and however: its effect is there, or something later built on it. */
export function maneuverDone(b: Blueprint, w: WorldState, site: Site, bound: Bound, m: Maneuver, carrying: ReadonlySet<string> = new Set()): boolean {
  const e = entityOf(w, bound, m.part);
  if (!e) return false;
  switch (m.template) {
    // a load under way is not there yet; held by anything later (a raise, a seating) it has been
    case 'carry': return !carrying.has(e.id) && (e.phase === 'installed' || e.support?.kind === 'held' || standing(e) || (!!m.spot && onSpot(e, spotAt(site, m.spot))));
    case 'raise-hold': return stands(b, w, site, bound, m.part);
    case 'release': return stands(b, w, site, bound, m.part) && e.phase === 'installed' && e.support?.kind === 'connected' && !e.reservedBy;
    default: return inPlace(b, w, site, bound, m.part);
  }
}

export type ManeuverState = { key: string; section: string; template: Maneuver['template']; part: string; crew: number; state: 'done' | 'ready' | 'running' | 'waiting'; waitsFor?: string[] };
export type Progress = {
  /** Every maneuver in order, with what the world says. */
  maneuvers: ManeuverState[]; done: number; total: number;
  parts: { inPlace: number; total: number }; joints: { made: number; total: number };
  /** The first section with work left; null when all of it is done. */
  section: string | null;
  /** The last section whose every maneuver is done, in order: its checkpoint has been reached. */
  checkpoint: string | null;
  /** Nobody holds a part of it. */
  nobodyHolds: boolean;
  floor: boolean; stairs: boolean; complete: boolean;
  /** Parts whose entity is gone, or that stand where the blueprint does not put them. */
  problems: string[];
};
const physicsOf = (w: WorldState, id: string) => (w as unknown as { entityPhysicsV1?: { byEntity?: Record<string, { surfaces?: unknown[]; links?: { kind: string; usable: boolean }[] }> } }).entityPhysicsV1?.byEntity?.[id];
/** `running`: the entities an open invitation or a running operation has claimed (the ledger's), besides what the world
 *  shows; `carrying`: those a crew is carrying somewhere now. */
export function progressOf(b: Blueprint, p: Procedure, w: WorldState, site: Site, bound: Bound, running: ReadonlySet<string> = new Set(), carrying: ReadonlySet<string> = new Set()): Progress {
  const all = maneuversOf(p), done = new Map(all.map((m) => [m.key, maneuverDone(b, w, site, bound, m, carrying)]));
  const problems: string[] = [];
  for (const k of Object.keys(b.parts)) {
    const e = entityOf(w, bound, k), part = b.parts[k]!;
    if (!e) { problems.push(`${k} is gone`); continue; }
    if (e.phase === 'installed' && part.at && planDistance(e, atSite(site, part.at)) > IN_PLACE) problems.push(`${k} is built in somewhere the blueprint does not put it`);
    if (part.stand && standing(e) && !stands(b, w, site, bound, k)) problems.push(`${k} stands somewhere the blueprint does not put it`);
  }
  const maneuvers: ManeuverState[] = all.map((m) => {
    const base = { key: m.key, section: m.section, template: m.template, part: m.part, crew: m.crew };
    if (done.get(m.key)) return { ...base, state: 'done' as const };
    const e = entityOf(w, bound, m.part);
    const waitsFor = m.after.filter((a) => !done.get(a));
    // a part in someone's hands: the operation on it runs (a release is the end of the hold, so that is its own question)
    if (m.template !== 'release' && e && (running.has(e.id) || e.reservedBy || e.support?.kind === 'held')) return { ...base, state: 'running' as const };
    if (m.template === 'release' && e && !heldUp(w, e)) return { ...base, state: 'waiting' as const, waitsFor: [...waitsFor, 'the frame to be raised'] };
    if (m.template === 'release' && e && !frameStability(w, e).stable) return { ...base, state: 'waiting' as const, waitsFor: waitsFor.length ? waitsFor : frameStability(w, e).missing };
    return waitsFor.length || !e ? { ...base, state: 'waiting' as const, waitsFor: e ? waitsFor : [`${m.part} (gone)`] } : { ...base, state: 'ready' as const };
  });
  // a section is open until every maneuver of it is done; its dependencies keep the next one waiting only where it matters
  let section: string | null = null, checkpoint: string | null = null;
  for (const s of p.sections) { const left = s.maneuvers.some((m) => !done.get(m.key)); if (left) { section = s.key; break; } checkpoint = s.key; }
  // work of a later section does not start before its section is open
  for (const m of maneuvers) if (m.state === 'ready' && m.section !== section) { m.state = 'waiting'; m.waitsFor = [`the ${section} section`]; }
  const inPlaceCount = Object.keys(b.parts).filter((k) => { const part = b.parts[k]!; return part.hosts.length ? inPlace(b, w, site, bound, k) : stands(b, w, site, bound, k) && entityOf(w, bound, k)?.phase === 'installed'; }).length;
  const floorOf = Object.keys(b.parts).find((k) => b.parts[k]!.floor), stairsOf = Object.keys(b.parts).find((k) => b.parts[k]!.stairs);
  const floorE = floorOf ? entityOf(w, bound, floorOf) : undefined, stairsE = stairsOf ? entityOf(w, bound, stairsOf) : undefined;
  const floor = !floorOf || (!!floorE && (physicsOf(w, floorE.id)?.surfaces?.length ?? 0) > 0);
  const stairs = !stairsOf || (!!stairsE && (physicsOf(w, stairsE.id)?.links ?? []).some((l) => l.kind === 'stairs' && l.usable));
  const joints = jointsMade(b, w, bound), frames = Object.keys(b.parts).filter((k) => b.parts[k]!.stand);
  const framesStand = frames.every((k) => { const e = entityOf(w, bound, k); return !!e && e.phase === 'installed' && e.support?.kind === 'connected' && frameSupported(w, e); });
  const nobodyHolds = Object.values(bound).every((id) => { const e = w.entities[id]; return !e || (e.support?.kind !== 'held' && !e.reservedBy); });
  const doneCount = maneuvers.filter((m) => m.state === 'done').length;
  return {
    maneuvers, done: doneCount, total: maneuvers.length, parts: { inPlace: inPlaceCount, total: Object.keys(b.parts).length }, joints, section, checkpoint, nobodyHolds, floor, stairs,
    complete: joints.made === joints.total && framesStand && floor && stairs && doneCount === maneuvers.length && !problems.length, problems,
  };
}

/** The exact offer and params that do a ready maneuver in this world now (`with` is the proposer's own choice), or null
 *  when the world offers no such thing here yet: a seat's column and height, a joist's place along the bay and a flight's
 *  depend on which way round the parts came to lie, so they are read from what is offered, by where it goes. */
export function offerFor(b: Blueprint, w: WorldState, site: Site, bound: Bound, m: Pick<Maneuver, 'template' | 'part'>, projectId: string): { offer: string; params: Record<string, unknown>; seats?: unknown; hosts?: string[] } | null {
  const e = entityOf(w, bound, m.part), part = b.parts[m.part]; if (!e || !part) return null;
  switch (m.template) {
    case 'carry': return { offer: `carry-with:${e.id}`, params: { to: `project:${projectId}` } };
    case 'raise-hold': return { offer: `raise-with:${e.id}`, params: { project: projectId } };
    case 'connect-beam': {
      if (!part.at) return null;
      const q = atSite(site, part.at), bays = beamBays(w, e.id, 3.5).map((x) => { const a = w.entities[x.a]!, sa = socketsOf(a).find((s) => s.id === x.seats[0])!, bb = w.entities[x.b]!, sb = socketsOf(bb).find((s) => s.id === x.seats[1])!, pa = worldPoint(a, sa.local), pb = worldPoint(bb, sb.local); return { x, d: hypot((pa[0] + pb[0]) / 2 - q[0], (pa[2] + pb[2]) / 2 - q[1]) }; }).filter((c) => c.d < IN_PLACE);
      const best = bays.sort((x, y) => Math.abs(x.x.height - (part.height ?? 0)) - Math.abs(y.x.height - (part.height ?? 0)))[0];
      return best && Math.abs(best.x.height - (part.height ?? 0)) <= 0.08 ? { offer: `connect-beam-with:${e.id}`, params: { column: best.x.column, height: best.x.height }, seats: best.x.seats, hosts: [best.x.a, best.x.b] } : null;
    }
    case 'install-joist': {
      if (!part.at) return null;
      const q = atSite(site, part.at), bay = joistBays(w, e.id).find((x) => { const a = w.entities[x.beams[0]]!, sa = ofKind(a, JOIST_SEAT).find((s) => s.id === x.seats[0])!, bb = w.entities[x.beams[1]]!, sb = ofKind(bb, JOIST_SEAT).find((s) => s.id === x.seats[1])!, pa = worldPoint(a, sa.local), pb = worldPoint(bb, sb.local); return hypot((pa[0] + pb[0]) / 2 - q[0], (pa[2] + pb[2]) / 2 - q[1]) < IN_PLACE; });
      return bay ? { offer: `install-joist-with:${e.id}`, params: { at: bay.at }, seats: bay.seats, hosts: [...bay.beams] } : null;
    }
    case 'lay-sheet': {
      const want = part.hosts.map((h) => bound[h]!), row = sheetBays(w, e.id).find((r) => want.every((id) => r.includes(id)));
      return row ? { offer: `lay-sheet-with:${e.id}`, params: {}, hosts: [...row] } : null;
    }
    case 'install-flight': {
      if (!part.at) return null;
      const q = atSite(site, part.at), host = entityOf(w, bound, part.hosts[0]!);
      const bay = flightBays(w, e.id).filter((x) => x.beam === host?.id).map((x) => { const s = socketsOf(w.entities[x.beam]!).find((c) => c.id === x.seat)!, pt = worldPoint(w.entities[x.beam]!, s.local); return { x, d: hypot(pt[0] - q[0], pt[2] - q[1]) }; }).sort((x, y) => x.d - y.d)[0];
      return bay ? { offer: `install-flight-with:${e.id}`, params: { at: bay.x.at }, seats: bay.x.seat, hosts: [bay.x.beam] } : null;
    }
    case 'install-tread': return treadTarget(w, e.id) ? { offer: `install-tread:${e.id}`, params: {} } : null;
    case 'release': return null;   // `stop-carry:<op>`: the ledger knows the operation
  }
}

/** A loose thing that could be a part: its library def and where it lies. */
export type Stock = { id: string; def: string; at: Vec2 };
/** Where a part is first wanted: the spot it is delivered to or carried to, else the site itself. */
function firstWanted(p: Procedure, site: Site, part: string): Vec2 {
  const spot = p.delivered[part]?.spot ?? maneuversOf(p).find((m) => m.part === part && m.spot)?.spot;
  return spot ? atSite(site, [spot[0], spot[1]]) : site.origin;
}
/** Bind each part to the nearest loose thing of a def it may be, the strictest parts first, or say what is short, per def.
 *  A delivered part counts only where it can be used: within its delivery's reach. */
export function bindStock(b: Blueprint, p: Procedure, site: Site, stock: readonly Stock[], radius: number): { bound: Bound } | { short: { def: string; need: number; have: number }[] } {
  const free = new Map(stock.map((s) => [s.id, s])), bound: Bound = {}, missing: string[] = [];
  const parts = Object.keys(b.parts).sort((x, y) => b.parts[x]!.def.length - b.parts[y]!.def.length);
  for (const k of parts) {
    const part = b.parts[k]!, want = firstWanted(p, site, k), reach = p.delivered[k]?.within ?? radius;
    const hit = [...free.values()].filter((s) => part.def.includes(s.def) && hypot(s.at[0] - want[0], s.at[1] - want[1]) <= reach)
      .sort((x, y) => part.def.indexOf(x.def) - part.def.indexOf(y.def) || hypot(x.at[0] - want[0], x.at[1] - want[1]) - hypot(y.at[0] - want[0], y.at[1] - want[1]) || (x.id < y.id ? -1 : 1))[0];
    if (hit) { bound[k] = hit.id; free.delete(hit.id); } else missing.push(k);
  }
  if (!missing.length) return { bound };
  const defs = [...new Set(missing.map((k) => b.parts[k]!.def[0]!))];
  return { short: defs.map((d) => ({ def: d, need: Object.values(b.parts).filter((x) => x.def[0] === d).length, have: stock.filter((s) => s.def === d && hypot(s.at[0] - site.origin[0], s.at[1] - site.origin[1]) <= radius).length })) };
}
/** A point inside the ground the site needs clear. */
export function inSite(p: Procedure, site: Site, at: Vec2): boolean {
  const l = rot2([at[0] - site.origin[0], at[1] - site.origin[1]], -site.yaw);
  return Math.abs(l[0]) <= p.siteClear[0] && Math.abs(l[1]) <= p.siteClear[1];
}
