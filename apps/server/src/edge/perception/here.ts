// perception/1 — `GET /v1/edge/here` (EDGE-CONTRACT-v1 §8.1): a compact first-person frame of what one Soul can
// perceive from where it stands. Strictly local: Souls and things in the same enclosed place (or, outdoors, not
// inside one) within sight radius and with a clear sightline (nav/1 solids); never other places, never conversation
// content, never owner data. Read-only; deterministic for a given world state. No model calls.
import {compactParams, paramsByVerb} from '../intents/offer-schema.ts';
import {menuWorldOf} from '../../split/menu-world.ts';
import {entityPhysicsContribution} from '../../../../../mars/viewer/engine/spatial/edits.ts';
import {whereLine} from './semantic-location.ts';
import {isCampfire} from '../ledger/fire.ts';
import {clockAt} from '@sim/brain';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {EdgeLedger} from '../ledger/ledger.ts';
import {stateOf} from '../ledger/ledger.ts';
import type {EdgeCapability,EdgeSoul, PlaceRef} from '../contract.ts';
import {centroid} from '../ledger/places.ts';
import {hereFocus} from '../ledger/focus.ts';
import {EARSHOT_RADIUS} from '../comms/speech.ts';
import {CATALOG} from '../../../../../mars/viewer/engine/world/catalog.ts';
import {bearingOf, clearSight, compassOf, compassPoint, dist2, durationWord, facingPoint, headingOfYaw, round1, walkSeconds, type Solid} from './geometry.ts';

type V2 = [number, number];
/** Sight radius (m): beyond this nothing is listed, indoors or out. */
export const SIGHT_RADIUS = 30;
/** Things (seats, spots, fires, items) are listed within this many metres. */
export const OBJECT_RADIUS = 15;
const LIMITS = {near: 6, objects: 6, seats: 3, exits: 5, conversations: 3};

export type Located = {kind: 'soul' | 'seat' | 'fire' | 'spot' | 'object' | 'item' | 'fixture' | 'place'; id: string; name: string; at: V2; entityId?: string; free?: boolean; capability?: string; distance: number;level?:number; what?: string};

/** One read of the world for one Soul (built per request). */
export class Perception {
  /** Kinds of the objects the last things() read (L3/audit #2: `here` asked the object table once per nearby object). */
  readonly objectKinds = new Map<string, string>();
  readonly L: EdgeLedger; readonly soul: EdgeSoul; readonly w: NativeWorld; readonly tick: number;
  readonly pos: V2 | null; readonly heading: number; readonly enclosure: string | null; private solidsCache?: readonly Solid[]; private actuatorSolidsCache?:readonly Solid[];
  constructor(ledger: EdgeLedger, soul: EdgeSoul) {
    this.L = ledger; this.soul = soul; this.w = ledger.mw.world as NativeWorld; this.tick = ledger.mw.world.tick;
    const b = this.w.entities[soul.entityId];
    this.pos = b ? [b.pose.p[0], b.pose.p[2]] : null; this.heading = b ? headingOfYaw(b.pose.yaw) : 0;
    this.enclosure = ledger.enclosureOf(soul.soulId);
  }
  /** nav/1 solids as installed in the world ({id, obb:{c, half, yaw}, y0, y1}); height = top above the ground. */
  solids(): readonly Solid[] {
    return this.solidsCache ??= (((this.w as {navV1?: {solids?: unknown[]}}).navV1?.solids ?? []) as {id: string; label?: string; obb?: {c: V2; half: V2; yaw: number}; c?: V2; half?: V2; yaw?: number; y1?: number; height?: number}[])
      .flatMap(x => {const o = x.obb ?? (x.c && x.half ? {c: x.c, half: x.half, yaw: x.yaw ?? 0} : null); return o ? [{id: x.id, ...(x.label ? {label: x.label} : {}), c: o.c, half: o.half, yaw: o.yaw, height: x.y1 ?? x.height}] : [];});
  }
  /** Sightline from me to a point (enclosure is checked by the caller). */
  sees(at: V2, target?:string): boolean {
    // Existing general perception stays unchanged. Actuator facts also honour the
    // entity-world walls (the native nav/1 map alone omits those contributions).
    const solids=target?(this.actuatorSolidsCache??=[...this.solids(),...(entityPhysicsContribution(this.w).obstacles??[]).map(o=>({id:o.id,c:o.obb.c,half:o.obb.half,yaw:o.obb.yaw,height:o.y1}))]):this.solids();
    return !!this.pos && clearSight(this.pos,at,target?solids.filter(s=>s.id!==target&&!s.id.startsWith(target+'#')):solids).clear;
  }
  /** Is a point in my enclosure (or, when I am outdoors, not inside any enclosed place)? */
  sameEnclosure(at: V2, level = 0): boolean {
    const enc = this.L.enclosureAtPoint(at[0],at[1],level);
    return enc === this.enclosure;
  }
  bearing(at: V2) {return this.pos ? bearingOf(this.heading, this.pos, at) : 'ahead';}
  dist(at: V2) {return this.pos ? round1(dist2(this.pos, at)) : Infinity;}

  /** Other Souls I can perceive: enclosure rule + sight radius + sightline. */
  souls(radius = SIGHT_RADIUS) {
    return this.L.perceivedBodies(this.soul.soulId, radius).flatMap(o => {
      const b = this.w.entities[o.entityId]; if (!b) return [];
      const at: V2 = [b.pose.p[0], b.pose.p[2]];
      return this.sees(at) ? [{...o, at, body: b}] : [];
    });
  }
  /** Seats (native sit capabilities) with position and whether they are free. */
  /** How many places of each seat fixture are held by someone else's live sit action or claimed by another Soul's open
   *  act (walking there); a seat is free while that is below its seat slots (a 6 ft bench has 3). */
  private takenSeats(): Map<string, number> {
    const out = new Map<string, number>(), rt = this.L.mw.runtime, live = new Set(rt.liveIds()), add = (id: string) => out.set(id, (out.get(id) ?? 0) + 1);
    for (const r of rt.records.values()) {const p = r.params as {actor?: string; fixture?: unknown; on?: unknown}; if (live.has(r.id) && r.verb === 'sit' && p.actor !== this.soul.entityId) {const v = typeof p.fixture === 'string' ? p.fixture : typeof p.on === 'string' ? p.on : null; if (v) add(v);}}
    for (const m of this.L.host.minds.values()) if (m.soulId !== this.soul.soulId) for (const r of this.L.openReceipts(m.soulId)) if (r.capability.startsWith('sit:')) add(r.capability.slice(4));
    return out;
  }
  private seatSlots(entity: string): number {const def = this.w.entities[entity]?.def; return Math.max(1, (CATALOG[def as string]?.slots ?? []).filter(x => x.kind === 'seat').length);}
  seats(radius = OBJECT_RADIUS): Located[] {
    const out: Located[] = [], {caps} = this.menu(), taken = this.takenSeats();
    for (const c of caps) {
      if (c.verb !== 'sit' || !c.target || c.id === 'sit:here') continue;
      const ent = (this.L.host.kernel.things[c.target.id]?.traits.entity as string | undefined) ?? c.target.id, e = this.w.entities[ent]; if (!e) continue;
      const levels=(this.L.mw).nativeSeatLevelsV1?.(ent)??(e.support?.kind==='ground'&&e.pose.p[1]===0?[0]:[]);if(levels.length!==1)continue;
      const at: V2 = [e.pose.p[0], e.pose.p[2]], d = this.dist(at); if (d > radius) continue;
      out.push({kind: 'seat', id: c.target.id, name: c.label, at, entityId: ent, free: c.available && (taken.get(c.target.id) ?? taken.get(ent) ?? 0) < this.seatSlots(ent), capability: c.id, distance: d,level:levels[0]});
    }
    return out.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  }
  /** Everything nearby with a position: seats, fires, activity spots, lasting objects, items lying around. */
  things(radius = OBJECT_RADIUS): Located[] {return [...this.seats(radius), ...this.unseated(radius)].filter(t => this.sameEnclosure(t.at) && this.sees(t.at)).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));}
  /** L3 item 4: the offers this frame reads, built once and only for what is around (EdgeLedger.bindFocus, never the
   *  whole menu): every `…:here` offer, seats, invitations, and offers aimed at the places this Soul is in, the places
   *  its exits lead to, the things within reach and the Souls within 8 m. */
  private menuMemo: {caps: EdgeCapability[]; plans: ReturnType<EdgeLedger['bindFocus']>['plans']} | null = null;
  menu(): {caps: EdgeCapability[]; plans: ReturnType<EdgeLedger['bindFocus']>['plans']} {
    if (this.menuMemo) return this.menuMemo;
    const targets = new Set(this.L.placePathOf(this.soul.soulId).map(p => p.id));
    for (const id of exitCandidates(this.L, targets, this.pos)) targets.add(id);
    // (an object near is a target: its offers are built for that object alone, L3 c)
    for (const t of this.unseated(OBJECT_RADIUS)) targets.add(t.id);
    for (const o of this.souls(8)) targets.add(o.soulId);
    const b = this.L.bindFocus(this.soul, hereFocus(targets));
    return this.menuMemo = {caps: this.L.listed(b.caps), plans: b.plans};
  }
  private unseatedMemo = new Map<number, Located[]>();
  private unseated(radius: number): Located[] {
    const hit = this.unseatedMemo.get(radius); if (hit) return hit;
    const out: Located[] = []; this.unseatedMemo.set(radius, out);
    for (const e of Object.values(this.w.entities)) {
      if (!isCampfire(e)) continue; const at: V2 = [e.pose.p[0], e.pose.p[2]], d = this.dist(at);
      if (d <= Math.max(radius, SIGHT_RADIUS)) out.push({kind: 'fire', id: e.id, name: e.label ?? 'campfire', at, entityId: e.id, distance: d});
    }
    for (const s of this.L.spots.spots) {
      const d = this.dist(s.at); if (d > radius) continue;
      out.push({kind: 'spot', id: s.id, name: s.label ?? s.activity, at: s.at, distance: d, capability: `${s.activity}:${s.id}`});
    }
    let mine: Set<string> | undefined;   // the places I am in: the same for every object, so read once
    for (const o of this.L.comms?.objects.all() ?? []) {
      const st = o.state as {at?: V2; removed?: boolean; carrier?: string; def?: string; what?: unknown; painting?: unknown}; if (st?.removed) continue;
      // RIDE-LABELS: a ride is where its carrier is now (the boat or basket), never its place's centroid
      const body = this.w.entities[o.id] ?? (o.kind === 'ride' && typeof st?.carrier === 'string' ? this.w.entities[st.carrier] : undefined);
      const at = Array.isArray(st?.at) ? st.at : body ? [body.pose.p[0], body.pose.p[2]] as V2 : null;
      const place = this.L.places.byId.get(o.placeId), here = mine ??= new Set(this.L.placePathOf(this.soul.soulId).map(p => p.id));
      const point = at ?? (place && here.has(o.placeId) ? centroid(place.polygon) : null); if (!point) continue;
      const d = this.dist(point); if (d > radius && !(here.has(o.placeId) && !at)) continue;
      // GodPerceive advances this public built state after completion/overwrite. Carry only its
      // painting line, never the immutable definition description or private drawing recipe.
      // #430: GodPerceive marks a line that leads with a painting's or drawing's credit (`painting`), whatever the def
      const what = typeof st?.what === 'string' && (st.def === 'core-easel@2' && st.what.startsWith('an easel with ') || (st as {painting?: unknown}).painting === true)
        ? st.what.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ').slice(0, 230) : undefined;
      this.objectKinds.set(o.id, o.kind);
      out.push({kind: 'object', id: o.id, name: (o as {name?: string}).name ?? o.kind, at: point, distance: d, ...(what ? {what} : {})});
    }
    for (const i of this.L.together.publicItems()) {
      if (i.state !== 'placed' || !Array.isArray(i.at)) continue; const at = i.at as V2, d = this.dist(at);
      if (d <= radius) out.push({kind: 'item', id: i.id, name: i.name, at, distance: d});
    }
    return out;   // (unfiltered: things() filters and sorts with the seats; the menu's targets may be a superset)
  }
  /** A thing, Soul or place named by id or plain words, as this Soul can perceive it (places: anywhere). */
  locate(ref: string, opts: {places?: boolean; souls?: boolean; things?: boolean} = {}): Located | null {
    const q = ref.trim(), lq = q.toLowerCase(); if (!q) return null;
    const words = lq.split(/[^a-z0-9]+/).filter(w => w && !['the', 'a', 'an', 'at', 'to', 'by', 'on', 'my'].includes(w));
    const named = (name: string) => {const n = name.toLowerCase(); return n === lq || (words.length > 0 && words.every(w => n.split(/[^a-z0-9]+/).includes(w)));};
    if (opts.souls !== false) {
      if(this.L.host.soulNameRefusal(q))return null;
      const seen = this.souls(60);
      const s = seen.find(o => o.soulId === q) ?? seen.find(o => named(o.name));
      if (s) return {kind: 'soul', id: s.soulId, name: s.name, at: s.at, entityId: s.entityId, distance: s.distance};
    }
    if (opts.things !== false) {
      const all = this.things(60), ALIAS: Record<string, string[]> = {fire: ['fire', 'campfire', 'bonfire', 'firepit'], seat: ['seat', 'chair', 'bench'], item: ['item']};
      const def = (x: Located) => x.entityId ? String(this.w.entities[x.entityId]?.def ?? '') : '';
      const kindWords = (x: Located) => [...(ALIAS[x.kind] ?? [x.kind]), ...def(x).split('-'), ...(x.capability?.split(':')[0].split('-') ?? [])];
      // the id, then the exact name, then what kind of thing it is ("the fire", "a bench"), then words of its name
      const t = all.find(x => x.id === q) ?? all.find(x => x.name.toLowerCase() === lq) ?? all.find(x => words.length > 0 && words.every(w => kindWords(x).includes(w))) ?? all.find(x => named(x.name));
      if (t) return t;
      const e = this.w.entities[q];
      if (e && e.kind !== 'human') {const at: V2 = [e.pose.p[0], e.pose.p[2]]; if (this.dist(at) <= 60 && this.sameEnclosure(at) && this.sees(at)) return {kind: 'fixture', id: e.id, name: e.label ?? e.def ?? e.id, at, entityId: e.id, distance: this.dist(at)};}
    }
    if (opts.places !== false) {
      const known = (x: {id: string} | undefined) => !!x && (this.L.knowledge?.knows(this.soul.soulId, x.id) ?? true);   // knowledge/1: secret places stay unnamed until known
      const byId = this.L.places.byId.get(q), p = known(byId) ? byId : [...this.L.places.byId.values()].find(x => x.parent !== null && (named(x.name)||(x.aliases??[]).some(named)) && known(x));
      if (p) {const at = p.carrier ? (() => {const e = this.w.entities[p.carrier!.entity]; return e ? [e.pose.p[0], e.pose.p[2]] as V2 : centroid(p.polygon);})() : centroid(p.polygon); return {kind: 'place', id: p.id, name: p.name, at, distance: this.dist(at)};}
    }
    return null;
  }
  /** The actor-owned native seat slot; legacy engines fall back to the live request's fixture. */
  seat(): string | null {
    const held = this.L.mw.nativeSeatHoldsV1?.(this.soul.entityId);
    if (held?.length) return held[0]!.slot;
    const rt = this.L.mw.runtime, live = new Set(rt.liveIds());
    for (const r of rt.records.values()) {const p = r.params as {actor?: string; fixture?: unknown; slot?: unknown; on?: unknown}; if (live.has(r.id) && r.verb === 'sit' && p.actor === this.soul.entityId) return typeof p.slot === 'string' ? p.slot : typeof p.fixture === 'string' ? p.fixture : typeof p.on === 'string' ? p.on : null;}
    return null;
  }
  /** Where the Soul is and how it is (also used for receipts' endedAt). */
  me() {
    const m = this.L.host.minds.get(this.soul.soulId), b = this.w.entities[this.soul.entityId];
    const path: PlaceRef[] = this.L.placePathOf(this.soul.soulId), seat = path[0]?.kind === 'occupier' ? path[0].id : this.seat(), places = path.filter(p => p.kind !== 'occupier');
    const posture = this.L.faded.has(this.soul.soulId) ? 'faded' : m ? stateOf(this.L.host, m.entityId) : 'absent';
    // floors (2026-10-26): the floor plate the body stands on (a building's raised floor), with its height
    const plate = this.pos && (b?.human?.level ?? 0) === 0 ? this.L.floorsNear?.(this.pos, 0).find(f => f.on) : undefined;
    return {place: places[0]?.id ?? null, placePath: places.map(p => p.name), pos: this.pos ? [round1(this.pos[0]), round1(this.pos[1])] as V2 : null, heading: this.heading, posture, ...(seat ? {seat} : {}), ...(plate && b ? {floor: plate.id, y: Math.round(b.pose.p[1] * 100) / 100} : {}), body: b};
  }
}

/** Floors (2026-10-26): the raised floors near the body in plain words — the one it stands on, or how far one is, the
 *  step up and which sides are open — so an agent knows the true floors and openings of the buildings around it. */
const SIDE_WORDS: Record<string, string> = {N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south', SW: 'southwest', W: 'west', NW: 'northwest'};
export function floorLines(ledger: EdgeLedger, P: {pos: V2 | null; bearing(at: V2): string}, radius = 30): string[] {
  const fl = P.pos ? ledger.floorsNear?.(P.pos, radius) ?? [] : [];
  return fl.slice(0, 3).map(f => {
    const sides = [...new Set(f.openings.map(n => SIDE_WORDS[compassPoint(compassOf(n[0], n[1]))] ?? compassPoint(compassOf(n[0], n[1]))))], high = `${f.rise.toFixed(2)} m above the ground`;
    const open = sides.length === 4 ? 'open on all four sides' : sides.length ? `open on its ${sides.length > 1 ? `${sides.slice(0, -1).join(', ')} and ${sides[sides.length - 1]}` : sides[0]} side${sides.length > 1 ? 's' : ''}` : 'no open side found';
    return f.on ? `You are standing on ${f.name}, ${high}; ${open}.` : `${f.name[0].toUpperCase()}${f.name.slice(1)}: ${f.d} m ${P.bearing(f.at)}, ${f.rise <= 0.45 ? `a ${f.rise.toFixed(2)} m step up` : `${high}, reached by stairs`}; ${open}.`;
  });
}

/** endedAt for a terminal receipt: where the body is and how (EDGE-CONTRACT-v1 §8.4). */
export function bodyEnd(ledger: EdgeLedger, soulId: string): {place: string | null; placePath: string[]; pos: V2 | null; heading: number | null; posture: string; seat?: string} | null {
  const m = ledger.host.minds.get(soulId); if (!m) return null;
  try {
    const me = new Perception(ledger, {soulId, entityId: m.entityId, name: m.name, owner: m.owner}).me();
    const {body, ...rest} = me; return {...rest, heading: body ? rest.heading : null};
  } catch {return null;}
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The world's time and date in one line, first in `here` (lane AWARE): "Wed 21 Oct 2026 · 03:33 · night · world day 19". */
export function worldNow(c: {day: number; hour: number; minute: number; datetime: string}): string {
  const d = new Date(c.datetime);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')} · ${lightOf(c.hour, c.minute)} · world day ${c.day + 1}`;
}
function lightOf(hour: number, minute: number) {const t = hour * 60 + minute; return t < 330 ? 'night' : t < 420 ? 'dawn' : t < 1110 ? 'day' : t < 1200 ? 'dusk' : 'night';}
function skyOf(w: {clouds?: number; rain?: number; wind?: number; fog?: number; kind?: string} | undefined) {
  if (!w) return null;
  // `kind`/`fog` come only from a god world's weather (EdgeLedger.weatherNow, R4-LIVE); the live worlds' words are unchanged
  const sky = w.kind === 'storm' ? 'thunderstorm' : (w.fog ?? 0) > 0.5 ? 'fog' : (w.rain ?? 0) > 0.3 ? 'rain' : (w.clouds ?? 0) > 0.6 ? 'overcast' : (w.clouds ?? 0) > 0.25 ? 'some cloud' : 'clear';
  const wind = (w.wind ?? 0) > 0.6 ? 'windy' : (w.wind ?? 0) > 0.3 ? 'breezy' : (w.wind ?? 0) > 0.1 ? 'light' : 'calm';
  return {sky, wind};
}
const POSE_WORDS: Record<string, string> = {walk: 'walking', wait: 'waiting', sit: 'seated', idle: 'standing', swim: 'swimming', tread: 'swimming', wade: 'wading', lie: 'lying down', nap: 'napping', read: 'reading', browse: 'at a shelf', write: 'writing', dance: 'dancing',
  'play-piano': 'playing the piano', 'play-music': 'playing music', sing: 'singing at the microphone', paint: 'painting', chalk: 'drawing in chalk', cook: 'cooking', eat: 'eating', drink: 'drinking', 'sit-ground': 'sitting on the ground', wave: 'waving', hug: 'hugging', yoga: 'doing yoga', stretch: 'stretching',
  'jumping-jacks': 'doing jumping jacks', pushups: 'doing push-ups', situps: 'doing sit-ups', jump: 'jumping', ride: 'riding', board: 'boarding', alight: 'stepping out'};
const doingWord = (state: string, activity: string) => POSE_WORDS[activity] ?? (state === 'busy' ? activity.replace(/[-_]/g, ' ') : state);

/** Public current offers only, in a bounded local frame. Parameter descriptors
 * stay exact; an oversized offer is omitted rather than changing its schema. */
/** CTRL-2 (#1094): what can be done here, by verb, at most `budget` bytes: solo acts on the spot by verb name (`<verb>:here`),
 *  the rest as a count and the nearest few ids (the menu is nearest first). An agent drills down with `inspect`. A far
 *  offer adds nothing: only local targets and this Soul's exits count. */
export function groupedOffers(caps: readonly EdgeCapability[], localTargets: ReadonlySet<string>, exits: number, budget = 500, nearest = 3) {
 const solo: string[] = [], by = new Map<string, {count: number; nearest: string[]}>();
 for (const c of caps) {
  if (!c.available || c.verb === 'walk' || c.verb === 'stroll') continue;
  if (c.id === c.verb + ':here') {solo.push(c.verb); continue;}
  if (!(c.id.endsWith(':here') || c.verb === 'accept' || c.verb === 'decline' || (!!c.target && localTargets.has(c.target.id)))) continue;
  const g = by.get(c.verb) ?? {count: 0, nearest: []}; g.count++; if (g.nearest.length < nearest) g.nearest.push(c.id); by.set(c.verb, g);
 }
 const out = {...(exits ? {walk: exits} : {}), ...(solo.length ? {here: solo} : {}), ...Object.fromEntries(by)};
 // over budget: the nearest ids go first, farthest verb first, then the solo list; every count stays
 const size = () => Buffer.byteLength(JSON.stringify(out));
 for (const g of [...by.values()].reverse()) {while (size() > budget && g.nearest.length) g.nearest.pop();}
 while (size() > budget && solo.length > 3) solo.pop();
 return out;
}

export function compactDoHere(caps:readonly EdgeCapability[],localTargets:ReadonlySet<string>,byteBudget=1800){
 const eligible=caps.filter(c=>c.available&&c.verb!=='walk'&&c.verb!=='stroll'&&(c.id.endsWith(':here')||c.verb==='accept'||c.verb==='decline'||!!c.target&&localTargets.has(c.target.id)));
 const selected:{id:string;verb:string;label:string;available:true;params?:Record<string,unknown>}[]=[];
 // CTRL-1 (#1093): the verbs' shared parameters once, counted in the budget; an offer's own stay on it
 const verbs=new Set<string>(),shared=()=>compactParams(paramsByVerb(verbs));
 for(const c of eligible){
  const offer={id:c.id,verb:c.verb,label:c.label,available:true as const,...(c.params?{params:structuredClone(c.params)}:{})},had=verbs.has(c.verb);
  verbs.add(c.verb);
  if(selected.length<12&&Buffer.byteLength(JSON.stringify([selected,offer,shared()]))<=byteBudget)selected.push(offer);
  else if(!had)verbs.delete(c.verb);
 }
 return {doHere:selected,doHereParams:shared(),doHereCoverage:{localOffers:eligible.length,listed:selected.length,omitted:eligible.length-selected.length,byteBudget,complete:eligible.length===selected.length,fullCapabilities:'/v1/edge/capabilities'}};
}

/** L3 item 4: the places an exit may lead to (as the exits below choose them: a place's centroid within 150 m, not one
 *  this Soul is in, not a sleeping mat): the targets of the walks `here` reads. */
function exitCandidates(ledger: EdgeLedger, inside: ReadonlySet<string>, pos: V2 | null): string[] {
  if (!pos) return [];
  const out: string[] = [];
  for (const p of ledger.places.byId.values()) if (!inside.has(p.id) && !/(^|-)mat-\d+$/.test(p.id) && p.polygon.length && dist2(pos, centroid(p.polygon)) <= 150) out.push(p.id);
  return out;
}

/** Own-body fields shared by rich perception and the explicit physical projection.
 * Do not derive nearby context, capability offers or route plans here. */
function hereMe(ledger:EdgeLedger,soul:EdgeSoul,P:Perception,me:ReturnType<Perception['me']>) {
  const tick=P.tick,b=me.body,host=ledger.host;
  // my current body act and how long its timed step has left
  const open = ledger.openReceipts(soul.soulId).filter(r => (r as {channel?: string}).channel !== 'attention');
  const program = menuWorldOf(host).programOf(soul.entityId), action = program ? menuWorldOf(host).programAction?.(program) : null;
  let endsIn: string | undefined;
  if (action) {
    const rec = menuWorldOf(host).runtime.records.get(action.action.id) as {params?: {seconds?: unknown}; history?: {tick: number; status: string}[]; requestedTick?: number} | undefined;
    const secs = typeof rec?.params?.seconds === 'number' ? rec.params.seconds : null, started = rec?.history?.find(h => h.status === 'running')?.tick ?? rec?.requestedTick;
    if (secs !== null && started !== undefined) endsIn = durationWord(Math.max(0, secs - (tick - started) / 20));
  }
  const activityKind = open[0]?.capability.split(':')[0] ?? String(b?.human?.activity ?? 'idle');
  // an unanswered invitation is `inviting`, not the shared activity it asks for (quality case 32)
  const inviting = open[0] ? (open[0] as {awaitingAnswer?: {what: string; waitingFor: {name: string}[]; expiresInSeconds: number}}).awaitingAnswer : undefined;
  const fade = ledger.comms?.fading.status(soul.soulId) as {colour?: string} | null | undefined;
  const gaze = b?.human?.gaze as {kind: string; target?: string; at?: V2} | undefined;
  const nameOfEntity = (id: string) => host.mindByEntity?.get(id)?.name ?? (P.w.entities[id]?.label as string | undefined) ?? id;
  const holding = (() => {try {return ledger.together.observe(soul).holding as {name?: string} | null;} catch {return null;}})();
  return {soulId:soul.soulId,name:host.minds.get(soul.soulId)?.name??soul.name,profileRevision:host.profileFact(soul.soulId)?.revision??0,place: me.place, placePath: me.placePath, pos: me.pos, heading: me.heading, facing: compassPoint(me.heading), posture: me.posture, body:P.w.entities[soul.entityId]?.body??{family:'humanoid'}, ...(me.seat ? {seat: me.seat} : {}),
      activity: inviting ? {kind: 'inviting', what: inviting.what, with: inviting.waitingFor.map(g => g.name), answerWithin: durationWord(inviting.expiresInSeconds)} : {kind: activityKind, ...(endsIn ? {endsIn} : {})},
      // An open compound receipt describes intent, including its approach.
      // Expose the current native pose separately so observers cannot mistake
      // walking toward a book or instrument for already reading or playing.
      actualActivity: typeof b?.human?.activity === 'string' ? {kind:b.human.activity, ...(b.human.instrument ? {instrument:b.human.instrument} : {})} : null,
      ...(gaze ? {gaze: {kind: gaze.kind, ...(gaze.target ? {at: nameOfEntity(gaze.target)} : gaze.at && P.pos ? {bearing: P.bearing(gaze.at)} : {})}} : {}),
      ...(holding?.name ? {holding: holding.name} : {}), ...(fade?.colour ? {fade: fade.colour} : {}), ...(() => {try {return ledger.together.handLines(soul);} catch {return {};}})()};
}

/** Explicit own-body projection; default rich perception remains unchanged. */
export function hereBodyFrame(ledger:EdgeLedger,soul:EdgeSoul) {
  const P=new Perception(ledger,soul);return {tick:P.tick,view:'body' as const,me:hereMe(ledger,soul,P,P.me())};
}

/** The `here` frame (EDGE-CONTRACT-v1 §8.1). Target ≤ ~600 tokens. */
export function hereFrame(ledger: EdgeLedger, soul: EdgeSoul,options:{doHere?:boolean}={}) {
  const P = new Perception(ledger, soul), tick = P.tick, me = P.me(), host = ledger.host;
  const day = host.living, c = day ? clockAt(tick, day.origin, day.dayTicks) : null;
  const weather = skyOf(ledger.weatherNow?.() ?? (P.w as {env?: {weather?: {clouds: number; rain: number; wind: number}}}).env?.weather);
  const ownMe=hereMe(ledger,soul,P,me);
  // conversations: who is talking with whom (members only; never what is said)
  const talks = ledger.coreA.conversations();
  const seen = P.souls(SIGHT_RADIUS), seenIds = new Set(seen.map(s => s.soulId));
  const earshot = (d: number) => P.enclosure !== null || d <= EARSHOT_RADIUS;
  const near = seen.slice(0, LIMITS.near).map(o => {
    const ob = o.body, facing = ob.human?.attention ? compassOf(ob.human.attention[0] - o.at[0], ob.human.attention[1] - o.at[1]) : headingOfYaw(ob.pose.yaw);
    const with_ = talks.filter(t => t.members.includes(o.soulId)).flatMap(t => t.members).filter(id => id !== o.soulId);
    const partners = [...new Set(with_)].map(id => id === soul.soulId ? 'you' : seenIds.has(id) ? host.minds.get(id)?.name ?? 'someone' : 'someone');
    return {id: o.soulId, name: o.name, ...host.publicNameMetadata(o.soulId), dist: o.distance, bearing: P.bearing(o.at), doing: doingWord(o.state, o.activity) + (partners.length ? ` · talking with ${partners.slice(0, 3).join(', ')}` : ''),
      earshot: earshot(o.distance), facingMe: !!P.pos && facingPoint(o.at, facing, P.pos)};
  });
  // things: a few of each kind, nearest first (≤ 3 seats, ≤ 2 of any other kind); the rest are counted in `more`
  const all = P.things(), kindOf = (t: Located) => t.kind === 'spot' ? (t.capability?.split(':')[0] ?? 'spot') : t.kind === 'object' ? (P.objectKinds.get(t.id) ?? 'object') : t.kind;
  const taken = new Map<string, number>(), picked: Located[] = [], more: Record<string, number> = {};
  for (const t of all) {
    // #442: a broken bench is a seat with a repair offer on it: its one row says so, not a second object row with the same fact
    if (t.kind === 'object' && picked.some(p => p.kind === 'seat' && p.id === t.id) && ledger.contactActuator?.facts(t.id)?.broken) continue;
    const k = kindOf(t), n = taken.get(k) ?? 0; if (n < (k === 'seat' ? LIMITS.seats : 2) && picked.length < LIMITS.objects) {picked.push(t); taken.set(k, n + 1);} else more[k] = (more[k] ?? 0) + 1;
  }
  // Only six selected objects, at most 4 m away and in sight. No stored-state dump.
  const objects = picked.map(t => {
    // M01: the few facts first; enclosure and sightline (entity-world walls) only for a thing that has some.
    // entry 43: a kettle or a cup (items) has a fact or two as well: "boiling", a cup of tea
    const facts=(t.kind==='object'||t.kind==='item'||t.kind==='seat')&&t.distance<=4?ledger.contactActuator?.facts(t.id,soul):null;
    const state=facts&&Object.keys(facts).length&&P.sameEnclosure(t.at)&&P.sees(t.at,t.id)?facts:null;
    // entry 33: a neon sign's words, only for a Soul this near it; attributed and untrusted (never in offers)
    const said=state?ledger.contactActuator?.words?.(t.id):null;
    const words=said?{text:said.text,by:said.owner==='god'?"the world's maker":said.owner.startsWith('soul:')?(host.minds.get(said.owner.slice(5))?.name??said.owner.slice(5)):said.owner.replace(/^group:/,'group '),untrusted:true as const}:null;
    return ({
    id: t.id, kind: kindOf(t),
    ...(t.kind === 'seat' || t.kind === 'object' || t.kind === 'spot' || t.kind === 'item' ? {name: t.name} : {}),
    ...(t.what ? {what: t.what} : {}),
    ...(state&&Object.keys(state).length ? {state} : {}), ...(words ? {words} : {}),
    ...(t.kind === 'seat' ? {free: !!t.free} : {}), ...(t.kind === 'object' ? {readable: true} : {}),
    dist: t.distance, bearing: P.bearing(t.at)});});
  const conversations = talks.filter(t => t.members.some(id => id === soul.soulId || (seenIds.has(id) && earshot(seen.find(s => s.soulId === id)!.distance))))
    .slice(0, LIMITS.conversations).map(t => {const mine = t.members.includes(soul.soulId), heard = t.members.filter(id => id === soul.soulId || seenIds.has(id));
      return {...(mine ? {id: t.id} : {}), members: heard.map(id => id === soul.soulId ? 'you' : host.minds.get(id)?.name ?? 'someone'), ...(t.members.length > heard.length ? {others: t.members.length - heard.length} : {}), public: false};});
  // exits: walks to nearby places (not the ones I am in), nearest first
  const inside = new Set(ledger.placePathOf(soul.soulId).map(p => p.id));
  const exits = P.pos ? P.menu().caps.filter(c => c.verb === 'walk' && c.available && c.target?.kind === 'place' && !inside.has(c.target.id) && !/(^|-)mat-\d+$/.test(c.target.id))
    .map(c => {const p = ledger.places.byId.get(c.target!.id), at = p ? centroid(p.polygon) : null; return at ? {c, p: p!, at, d: dist2(P.pos!, at)} : null;})
    .filter((x): x is NonNullable<typeof x> => !!x && x.d <= 150).sort((a, b) => a.d - b.d || a.c.id.localeCompare(b.c.id)).slice(0, LIMITS.exits)
    .map(x => {const base = {to: x.p.id, name: x.p.name, dir: compassPoint(compassOf(x.at[0] - P.pos![0], x.at[1] - P.pos![1])), walk: x.c.id};
      // RT: an exit the body cannot walk from here says so (no eta), instead of an eta for a walk that is refused
      const problem = ledger.routeProblem(soul, x.c.id, P.menu().plans);   // (the exit's plan from this frame's menu)
      return problem ? {...base, reachable: false, why: problem.code} : {...base, eta: '~' + durationWord(walkSeconds(x.d * 1.25))};}) : [];
  const where=whereLine([...ledger.places.byId.values()].filter(p=>ledger.knowledge.knows(soul.soulId,p.id)),ledger.placePathOf(soul.soulId).map(p=>p.id),P.pos);
  const frame = {
    ...(c ? {now: worldNow(c)} : {}), tick, ...(c ? {clock: `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`, day: WEEKDAYS[new Date(c.datetime).getUTCDay()], light: lightOf(c.hour, c.minute)} : {}),
    ...(weather ? {weather: (() => {const l = P.pos ? ledger.lightningNear?.(P.pos[0], P.pos[1]) : null; return l ? {...weather, lightning: l} : weather;})()} : {}),
    ...(where?{where}:{}),
    me: ownMe,
    near, objects, ...(Object.keys(more).length ? {more} : {}), conversations_in_earshot: conversations, exits, ...(() => {const f = floorLines(ledger, P); return f.length ? {floors: f} : {};})(),
    // knowledge/1: the district summarised, far districts as names and directions (more once visited)
    ...(ledger.knowledge?.scales(soul.soulId, ledger.placePathOf(soul.soulId).filter(p => p.kind !== 'occupier').map(p => p.id), P.pos, c ? c.hour * 60 + c.minute : null) ?? {}),
    untrusted: true,
  };
  if(!options.doHere)return frame;
  const local=new Set([...ledger.placePathOf(soul.soulId).map(p=>p.id),...objects.map(o=>o.id),...near.filter(n=>n.dist<=8).map(n=>n.id)]);
  // CTRL-2 (#1094): the grouped view comes first, so a big room with no budget left for doHere still says what can be done
  const offers=groupedOffers(P.menu().caps,local,exits.length);
  const baseBytes=Buffer.byteLength(JSON.stringify({...frame,offers})),budget=Math.max(0,Math.min(1800,2600-baseBytes-240));
  return {...frame,offers,...compactDoHere(P.menu().caps,local,budget)};
}
