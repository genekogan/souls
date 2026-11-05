// Public meaning is decoration over physical places: never alter their membership polygons or parent.
import type { AboutPart, WorldModel } from '@sim/world-compiler';
import type { GodPlace } from './places.ts';
import { centroid, inPoly } from '../edge/ledger/places.ts';

export function humanTitle(ref: string): string {
  // F8 (#958): a dotted name (`region-seaside-resort.ferris-wheel`) reads as words, never `Seaside resort.ferris wheel`
  const text = ref.replace(/^(land|place|region|g)-/, '').replace(/[-_.]+/g, ' ').replace(/\//g, ' / ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
/** F8 (#958): a def's kind in words, for what a Soul reads ("a long table", "a presenter timber box"): no namespace
 *  prefix, no variant number, no hyphens. Words and matching keep the def's own name. */
export function kindWords(name: string): string {
  return name.replace(/^(core|ew|mars|eden)-/, '').replace(/-\d+$/, '').replace(/[-_]+/g, ' ');
}
/** F8 (#958): what a Soul reads for an entity: its authored title, else a readable form of its own name. */
export function displayName(e: {name?: string; about?: {title?: string}} | undefined): string | undefined {
  return e?.about?.title ?? (e?.name ? humanTitle(e.name) : undefined);
}
export type MeaningPart = Omit<AboutPart, 'anchor'> & {
  anchor?: AboutPart['anchor'];
  /** IDs to request; availability remains a live capability/route check. */
  walk?: string; sit?: string;
  /** A real navigation reference, not an invented area around a centroid. */
  target?: { ref?: string; entity?: string; slot?: string; point?: [number, number, number]; stand?: [number, number, number]; level?: number; region?: [number, number][] };
};
export function meaningParts(m: WorldModel, entity: string): MeaningPart[] {
  const e = m.entities.get(entity); if (!e?.about?.parts?.length) return [];
  const wp = m.worldPose(e), c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
  const point = ([x, y, z]: [number, number, number]): [number, number, number] => [wp.x + (x * c + z * s) * wp.s, wp.y + y * wp.s, wp.z + (-x * s + z * c) * wp.s];
  return (e.about?.parts ?? []).map(p => {
    const a = p.anchor, walk=`walk:${m.pathOf(e.id)}/part-${p.id}`;
    if (!a) return { ...p };
    if (a.kind === 'entity') {
      const target = m.entities.get(a.ref); if (!target) return { ...p };
      const slot = a.slot ? m.slotsOf(target).find(s => s.id === a.slot) : undefined;
      return { ...p, walk, ...(slot?.kind==='seat'?{sit:`sit:${m.pathOf(e.id)}/part-${p.id}`} : {}), target: { entity: target.id, ref: m.pathOf(target.id) + (slot?.kind === 'room' ? '/' + slot.id : ''), ...(slot ? { slot: slot.id } : {}) } };
    }
    return { ...p, walk, target: { point: point(a.point), stand: point(a.stand), level: a.level, ...(a.region ? { region: a.region.map(([x, z]) => { const p = point([x, 0, z]); return [p[0], p[2]] as [number, number]; }) } : {}) } };
  });
}
export function decorateMeaning(m: WorldModel, places: GodPlace[], root: string | null) {
  const own = new Map(places.filter(p => p.of !== 'room' && p.of !== 'shore').map(p => [p.entity, p]));
  const districts = new Set(m.state.about?.districts ?? []);
  const areas = new Map(places.map(p => [p.id, polygonArea(p.polygon)]));
  const containers = places.filter(q => {
    if (q.of === 'shore' || q.of === 'room') return false;
    const e = m.entities.get(q.entity), role = e?.about?.role;
    return role === 'district' || role === 'quarter' || districts.has(q.entity) || q.of === 'building' || /^core[-/]zone@/.test(e ? m.resolvedDef(e.def)?.ref ?? '' : '');
  });
  for (const p of places) {
    const e = m.entities.get(p.entity), a = e?.about, d = e ? m.resolvedDef(e.def) : undefined;
    if (!e) continue;
    const main = own.get(e.id), room = p.of === 'room' ? p.ref.slice(m.pathOf(e.id).length + 1) : undefined;
    const part = room ? a?.parts?.find(part => part.anchor?.kind === 'entity' && part.anchor.ref === e.id && part.anchor.slot === room) : undefined;
    p.name = p.of === 'shore' ? `${a?.title ?? humanTitle(p.ref)} bank` : room ? part?.title ?? `${a?.title ?? humanTitle(m.pathOf(e.id))} / ${humanTitle(room)}` : a?.title ?? humanTitle(p.ref);
    // A derived bank is a related destination, not another exact identity for its
    // water. Sharing the bare source ref made even walk:<lake-ref> ambiguous.
    p.aliases = p.of === 'shore'
      ? [...new Set([`${p.ref} shore`, `${p.ref} bank`, ...[a?.title, ...(a?.aliases ?? [])].filter(Boolean).flatMap(name => [`${name} bank`, `${name} shore`])])].slice(0, 64)
      : [...new Set([p.ref, ...(part?.aliases ?? []), ...(room ? [room] : [...(a?.aliases ?? []), ...(a?.kind ? [a.kind] : []), ...(d ? [d.name.replace(/^core[-/]/, '').replace(/^ew-/, '')] : []), ...(d?.tags ?? []), ...(d?.synonyms ?? [])])])].slice(0, 64);
    // Track type vocabulary separately from authored names for resolution priority.
    // Public aliases remain the same; names explicitly authored by the god stay identities.
    p.genericAliases = p.of === 'shore' || room ? [] : [...new Set([...(a?.kind ? [a.kind] : []), ...(d ? [d.name.replace(/^core[-/]/, '').replace(/^ew-/, '')] : []), ...(d?.tags ?? []), ...(d?.synonyms ?? [])])].filter(x => ![p.ref, p.name, ...(a?.aliases ?? [])].some(n => n.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim() === x.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()));
    if (p.of !== 'shore' && !room) {
      if (a?.what) p.description = a.what;
      if (a?.kind) p.semanticKind = a.kind;
      if (a?.role) p.semanticRole = a.role;
      if (districts.has(e.id)) p.semanticRole = 'district';
      if (a?.salience !== undefined) p.salience = a.salience;
      if (a?.parts?.length) p.parts = meaningParts(m, e.id);
    } else if (room && part?.what) p.description = part.what;
    else if (p.of === 'shore') p.description = `The bank of ${main?.name ?? a?.title ?? humanTitle(p.ref)}; a way to approach the water.`;
    if (room || p.of === 'shore') { p.semanticParent = main?.id ?? root; continue; }
    if (a?.in && own.has(a.in)) { p.semanticParent = own.get(a.in)!.id; continue; }
    // Natural semantic containers are districts/zones/buildings, never vegetation clumps or shore bands.
    const at = centroid(p.polygon), candidates = containers.filter(q => q !== p && areas.get(q.id)! > areas.get(p.id)! && inPoly(at[0], at[1], q.polygon));
    candidates.sort((a, b) => areas.get(a.id)! - areas.get(b.id)! || a.id.localeCompare(b.id));
    p.semanticParent = candidates[0]?.id ?? root;
  }
  // An authored parent can oppose geometric containment. Break only inferred links in that cycle.
  const byId = new Map(places.map(p => [p.id, p]));
  for (const start of places) {
    const seen = new Set<string>(); let p: GodPlace | undefined = start, inferred: GodPlace | undefined;
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      if (!m.entities.get(p.entity)?.about?.in && p.of !== 'room' && p.of !== 'shore') inferred = p;
      p = p.semanticParent ? byId.get(p.semanticParent) : undefined;
    }
    if (p && inferred) inferred.semanticParent = root;
  }
}
const polygonArea = (p: [number, number][]) => Math.abs(p.reduce((sum, [x, z], i) => { const next = p[(i + 1) % p.length]; return sum + x * next[1] - next[0] * z; }, 0)) / 2;
