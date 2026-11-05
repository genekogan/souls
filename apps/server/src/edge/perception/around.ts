// knowledge/1 — `GET /v1/edge/around` (look around / explore): more of what is near than `here` carries, on request.
// Same privacy as `here` (same enclosure, sightline; never conversation content or owner data), a wider radius, the
// places close by with what they are, and the secret places close enough to find (finding one is remembered).
// Read on demand only: an agent asks for it when it wants to explore; `here` stays short.
import type {EdgeLedger} from '../ledger/ledger.ts';
import type {EdgeSoul} from '../contract.ts';
import {centroid, inPoly} from '../ledger/places.ts';
import {Perception, floorLines} from './here.ts';
import {compassOf, compassPoint, dist2, durationWord, walkSeconds} from './geometry.ts';

/** People and things are listed within this many metres (sightline and enclosure as `here`). */
export const AROUND_RADIUS = 60;
/** Places within this many metres (centre) are described. */
export const PLACES_RADIUS = 160;
/** At most `n` characters, cut at the last word boundary (F8 #958: never `… the separ…`); one word longer than that is cut. */
export const clip = (s: string, n: number) => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1), at = /\w/.test(s[n - 1] ?? '') ? cut.search(/\W\w*$/) : cut.length;
  return (at > 0 ? cut.slice(0, at) : cut).replace(/[\s,;:'’–—-]+$/, '') + '…';
};

export function aroundFrame(ledger: EdgeLedger, soul: EdgeSoul) {
  const P = new Perception(ledger, soul), K = ledger.knowledge, tick = P.tick, pos = P.pos;
  if (!pos) return {tick, found: [], people: [], things: [], places: [], untrusted: true};
  const level = ledger.placeLevel(P.w.entities[soul.entityId]?.human?.level as number | undefined);
  // finding: secret places close by become known to this Soul (before the listings, so they show)
  const found = P.enclosure ? [] : K.findable(soul.soulId, pos, level);
  for (const p of found) K.find(soul.soulId, p.id, tick);
  if (found.length) ledger.invalidateBodies();
  const mem = K.memory(soul.soulId), path = ledger.placePathOf(soul.soulId).filter(p => p.kind !== 'occupier').map(p => p.id);
  const people = P.souls(AROUND_RADIUS).slice(0, 12).map(o => `${o.name} · ${o.distance}m ${P.bearing(o.at)} · ${o.activity && o.activity !== 'idle' ? o.activity.replace(/[-_]/g, ' ') : o.state}`);
  const things = P.things(AROUND_RADIUS).slice(0, 16).map(t => `${t.name}${t.kind === 'seat' ? (t.free ? ' (free seat)' : ' (taken seat)') : t.kind === 'spot' ? ` (${t.capability?.split(':')[0] ?? 'spot'})` : ` (${t.kind})`} · ${t.distance}m ${P.bearing(t.at)}`);
  const inside = new Set(path);
  // the walk to a place, only when one is offered now (a place in view is not always one you can walk into)
  const walks = new Map(ledger.capabilities(soul).filter(c => c.verb === 'walk' && c.available && c.target?.kind === 'place').map(c => [c.target!.id, c.id]));
  const places = [...ledger.places.byId.values()]
    .filter(p => p.parent !== null && !p.carrier && Math.abs((p.level ?? 0) - level) <= 1 && p.kind !== 'sleeping-mat' && !/(^|-)mat-\d+$/.test(p.id) && K.knows(soul.soulId, p.id))
    .map(p => {const at = centroid(p.polygon); return {p, at, d: inPoly(pos[0], pos[1], p.polygon) ? 0 : dist2(pos, at)};})
    .filter(x => x.d <= PLACES_RADIUS && !inside.has(x.p.id)).sort((a, b) => a.d - b.d || a.p.id.localeCompare(b.p.id)).slice(0, 10)
    .map(({p, at, d}) => {const k = mem.get(p.id);
      return {id: p.id, name: p.name, ...(walks.has(p.id) ? {walk: walks.get(p.id)} : {}), dir: compassPoint(compassOf(at[0] - pos[0], at[1] - pos[1])), m: Math.round(d), eta: '~' + durationWord(walkSeconds(d * 1.25)),
        ...(p.description ? {what: clip(p.description, 160)} : {}), ...(p.semanticKind?{kind:p.semanticKind}:{}), ...(p.parts?.length?{parts:p.parts.map(part=>({id:part.id,name:part.title,...(part.walk?{walk:part.walk}:{}),...(part.sit?{sit:part.sit}:{})}))}:{}), ...(k ? {been: k.how === 'visited' ? k.visits : 'found'} : {}), ...(K.isSecret(p.id) ? {secret: true} : {})};});
  const unvisited = places.filter(p => !mem.has(p.id) && p.walk).slice(0, 3).map(p => p.walk!);
  return {tick, ...(found.length ? {found: found.map(p => ({id: p.id, name: p.name, ...(walks.has(p.id) ? {walk: walks.get(p.id)} : {}), ...(p.description ? {what: clip(p.description, 110)} : {})}))} : {}),
    people, things, places, ...(() => {const f = floorLines(ledger, P, 60); return f.length ? {floors: f} : {};})(), ...(unvisited.length ? {unvisited} : {}), untrusted: true};
}
