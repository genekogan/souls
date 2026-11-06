// intents/1 (EDGE-CONTRACT-v1 §8.2–8.3): affordance-level acts resolved by the server when the step starts, and the
// independent attention channel. `act {verb, target}` picks the concrete seat / place / path itself and reports what
// it chose; `resolve` is the same choice as a dry run with no side effects. Attention acts (look, turn, face) move the
// head (or turn a free standing body) through a logged `edge-attention` event and never cancel the body's act; speech
// and conversation never touch the body. No model calls; deterministic for a given world state.
import type {Program} from '@sim/engine-contract';
import type {EdgeLedger} from '../ledger/ledger.ts';
import type {EdgeCapability, EdgeReceipt, EdgeSoul} from '../contract.ts';
import {Perception, type Located} from '../perception/here.ts';
import {centroid, inPoly} from '../ledger/places.ts';
import {dist2, durationWord, headingOfYaw, round1, walkSeconds, yawOfHeading, yawTowards} from '../perception/geometry.ts';
import {resolvedParts} from './resolved-parts.ts';
import {strictCheck} from './strict.ts';
import {resolvePlaceForVerb,lookupPlaceIdentity,explicitPlaceCapability,knownBootPlaces,offeredWalkObject} from '../boot/world-places.ts';

type V2 = [number, number];
type Steps = Program['steps'];
export type Chosen = Record<string, unknown>;
export type Gaze = {target?: string; at?: V2; until?: number; kind: string} | null;
export type Resolution =
  | {ok: true; kind: 'capability'; capability: string; params?: Record<string, unknown>; chosen: Chosen}
  | {ok: true; kind: 'plan'; capability: string; label: string; steps: Steps; chosen: Chosen}
  | {ok: true; kind: 'attention'; capability: string; gaze: Gaze; yaw?: number; chosen: Chosen}
  | {ok: true; kind: 'setting'; capability: string; apply: () => void; chosen: Chosen}
  | {ok: false; code: string; reason: string; did_you_mean?: {id: string; label: string}[];resolvedIfName?:{input:string;placeId:string;name:string};ambiguous?:string[]};
import {classWords} from './class-words.ts';
export type IntentInput = {verb?: unknown; target?: unknown; params?: unknown; clientRef?: unknown; [k: string]: unknown};
type Refused = {accepted: false; code: string; reason: string; capability: string; did_you_mean?: {id: string; label: string}[];resolvedIfName?:{input:string;placeId:string;name:string};ambiguous?:string[]};

/** Intent verbs this module resolves (anything else is passed on as `<verb>:<target>` to ordinary capabilities). */
export const INTENT_VERBS = ['sit', 'go', 'walk', 'swim', 'approach', 'follow', 'walk-with', 'turn', 'face', 'look', 'auto-face'];
const SPEC_KEYS = ['near', 'nearest', 'free', 'in', 'row', 'place', 'seconds', 'distance', 'heading', 'face', 'direction', 'via', 'with', 'on', 'conversation'];
/** How long (s) a look holds the head by default, and at most; a turn's or face's gaze lasts this long. */
export const LOOK_SECONDS = 10, LOOK_SECONDS_MAX = 300, FACE_SECONDS = 30, AUTO_FACE_SECONDS = 8;
const SEAT_REACH = 30, NEAR_SEAT_REACH = 20, APPROACH_MIN = 0.5, APPROACH_MAX = 10;
const FOCUS = /lectern|display|screen|stage|podium|board|projector|easel-wall|pulpit/;
const PRESENTER_SEAT = /presenter|speaker|host|reserved|lectern/;

const no = (code: string, reason: string, did_you_mean?: {id: string; label: string}[]): Resolution => ({ok: false, code, reason, ...(did_you_mean?.length ? {did_you_mean} : {})});
const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null;

/** {verb, target:{…}} or {verb, target:"id", distance, heading…}: one flat spec. */
export function specOf(input: IntentInput): Record<string, unknown> {
  const t = input.target, base: Record<string, unknown> = t && typeof t === 'object' && !Array.isArray(t) ? {...t as Record<string, unknown>} : t !== undefined ? {target: t} : {};
  const params = input.params && typeof input.params === 'object' && !Array.isArray(input.params) ? input.params as Record<string, unknown> : {};
  for (const k of SPEC_KEYS) if (input[k] !== undefined && base[k] === undefined) base[k] = input[k];
  for (const k of SPEC_KEYS) if (params[k] !== undefined && base[k] === undefined) base[k] = params[k];
  return base;
}

export class Intents {
  readonly L: EdgeLedger;
  /** Optional world closure for raw approach plans, which do not pass through offered capabilities. */
  planRefusal?: (soul: EdgeSoul, steps: Steps, target?: string) => {code: string; reason: string} | null;
  /** auto-face per Soul ('*') or per conversation; default on. Memory only (a restart turns it back on). */
  private autoFace = new Map<string, boolean>();
  /** A Soul's own look/turn holds its head until this tick; auto-face does not override it meanwhile. */
  private explicitUntil = new Map<string, number>();
  constructor(ledger: EdgeLedger) {this.L = ledger; ledger.onReceipt(r => {try {this.onTerminal(r);} catch {/* events are best effort */}});}

  /** EVENTS-v1 §3b (Core-A): raw `arrive` when a body act that goes somewhere completes; on a route/seat failure the
   *  receipt gains `alternatives` (a fresh dry run of the same intent) for Core-B's derived `blocked`. */
  private onTerminal(r: EdgeReceipt) {
    if (r.phase !== 'completed' && r.phase !== 'failed') return;
    const verb = r.capability.split(':')[0], deliver = (kind: string, body: Record<string, unknown>) => (this.L.comms as unknown as {streams?: {deliver?(s: string, k: string, t: number, b: object): void}} | undefined)?.streams?.deliver?.(r.soulId, kind, this.L.mw.world.tick, body);
    if (!['walk', 'stroll', 'hang-out', 'approach', 'go-near', 'sit', 'swim', 'gather', 'warm-by-fire'].includes(verb) || (r.channel && r.channel !== 'body')) return;
    const end = r.endedAt as {place?: string | null; placePath?: string[]} | undefined;
    if (r.phase === 'completed' && ['walk', 'stroll', 'hang-out', 'approach', 'go-near'].includes(verb)) {deliver('arrive', {receipt: {id: r.id, capability: r.capability, phase: r.phase}, placeId: end?.place ?? null, placePath: end?.placePath ?? [], ...(r.chosen ? {chosen: r.chosen} : {}), endedAt: r.endedAt ?? null}); return;}
    if (r.phase === 'failed' && r.code && /^(?:route\.|slot\.|seat\.|walk\.goal|reservation\.|pose\.occupied|pose\.no-room)/.test(r.code)) {
      // blocked: Core-B's envelope derives `blocked` from this receipt; Core-A adds `alternatives` = a fresh dry run of the
      // same intent, on the receipt itself (this listener runs before Comms delivers the receipt event)
      const m = this.L.host.minds.get(r.soulId), intent = (this.L.coreA.detail(r.id) as {intent?: IntentInput} | null)?.intent;
      if (!m || !intent) return;
      const d = this.dryRun({soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner}, intent);
      if (!d.ok) return;
      const alternatives = [d.would]; this.L.coreA.setDetail(r.id, {alternatives}); Object.assign(r, {alternatives});
    }
  }

  // ------------------------------------------------------------------ resolution (pure: no side effects)
  resolve(soul: EdgeSoul, input: IntentInput): Resolution {
    const verb = str(input.verb)?.toLowerCase(); if (!verb) return no('capability.params', 'verb must be a word such as sit, go, swim, approach, turn or look.');
    const bodyIssue=this.L.bodyVerbProblem(soul,verb);if(bodyIssue)return no(bodyIssue.code,bodyIssue.reason);
    const s = specOf(input), P = new Perception(this.L, soul);
    if (!P.pos) return no('not-found', 'This Soul has no body in the world.');
    switch (verb) {
      case 'sit': return this.sit(P, s);
      case 'go': case 'walk': case 'glide': return this.go(P, s, verb);
      case 'swim': return this.swim(P, s);
      case 'approach': return this.approach(P, s);
      case 'follow': case 'walk-with': return this.follow(P, s);
      case 'turn': case 'face': return this.turn(P, verb === 'face' && s.face === undefined && s.target !== undefined ? {...s, face: s.target, target: undefined} : s);
      case 'look': return this.look(P, s);
      case 'auto-face': return this.autoFaceSetting(soul, s);
      default: {
        let target = str(s.target) ?? str(s.place);
        // Activity companions must reach Together.prepare unchanged: it owns identity, availability and consent checks.
        // Preserve invalid values too, so an invalid invitation is refused instead of silently becoming a solo action.
        const params = {...(typeof s.seconds === 'number' ? {seconds: s.seconds} : {}), ...(s.with !== undefined ? {with: s.with} : {})};
        if(str(s.place)){const place=resolvePlaceForVerb(this.L,soul,str(s.place),verb);if(!place.ok)return place;target=place.chosen.place;return {ok:true,kind:'capability',capability:place.chosen.capability,...(Object.keys(params).length?{params}:{}),chosen:place.chosen};}
        const {caps} = this.L.coreA.binds(soul), here = caps.find(c => c.id === `${verb}:here`);
        const capability = target ? `${verb}:${target}` : here ? here.id : verb;
        return {ok: true, kind: 'capability', capability, ...(Object.keys(params).length ? {params} : {}), chosen: {capability}};
      }
    }
  }
  private eta(P: Perception, at: V2): {distance: number; eta: string; route: 'planned' | 'estimate'} {
    const engine = this.L.mw as unknown as {routeEstimateV1?: (a: string, to: V2) => {ok: true; metres: number} | {ok: false}};
    let r = engine.routeEstimateV1?.(P.soul.entityId, at);
    // a seat or a pond is not standing ground: plan to the nearest standing spot beside it instead
    if (r && !r.ok) {const near = this.L.mw.nearestStandableV1?.(at, P.soul.entityId); if (near) r = engine.routeEstimateV1?.(P.soul.entityId, near);}
    if (r && r.ok) return {distance: round1(r.metres), eta: durationWord(walkSeconds(r.metres)), route: 'planned'};
    const d = dist2(P.pos!, at) * 1.25; return {distance: round1(d), eta: '~' + durationWord(walkSeconds(d)), route: 'estimate'};
  }
  private seconds(s: Record<string, unknown>, max = 600): {seconds?: number} | Resolution {
    if (s.seconds === undefined) return {};
    if (!Number.isInteger(s.seconds) || (s.seconds as number) < 1 || (s.seconds as number) > max) return no('capability.params', `seconds must be an integer 1..${max}.`);
    return {seconds: s.seconds as number};
  }

  private sit(P: Perception, s: Record<string, unknown>): Resolution {
    const sec = this.seconds(s, 1800); if ('ok' in sec) return sec;
    const params = sec.seconds !== undefined ? {seconds: sec.seconds} : undefined;
    const free = s.free !== false, all = P.seats(1e9), here = (seat: Located) => ({seat: seat.id, label: seat.name, free: !!seat.free, distFromYou: seat.distance, ...this.eta(P, seat.at)});
    const room = str(s.in);
    if (room) {
      const identity=lookupPlaceIdentity(this.L,room,P.soul.soulId);if(!identity.ok)return {...identity,code:identity.code==='capability.unknown'?'place.unknown':identity.code};
      const place=this.L.places.byId.get(identity.chosen.place);
      if (!place) return no('place.unknown', `No place called "${room}" in the map.`);
      const admission=knownBootPlaces(this.L).find(p=>p.id===place.id)!;
      if(admission.access==='unsupported-floor')return no('place.unsupported-floor','This room has no admitted native floor; no downstairs substitute was chosen.');
      if(admission.access==='dynamic-carrier')return no('place.dynamic','This room moves with a carrier; use its current ride capabilities.');
      const inRoom = all.filter(x => x.level===place.level && inPoly(x.at[0], x.at[1], place.polygon) && !PRESENTER_SEAT.test(x.id + ' ' + x.name));
      if (!inRoom.length) return no('seat.none-in-place', `${place.name} has no seats you can sit on.`, all.filter(x => x.free).slice(0, 3).map(x => ({id: x.capability!, label: x.name})));
      // the room's focus: a lectern/screen/stage inside it, else the way its seats face
      const w = P.w, mid: V2 = [inRoom.reduce((a, x) => a + x.at[0], 0) / inRoom.length, inRoom.reduce((a, x) => a + x.at[1], 0) / inRoom.length];
      const focus = Object.values(w.entities).filter(e => e.kind === 'fixture' && FOCUS.test(String(e.def ?? '') + ' ' + e.id) && inPoly(e.pose.p[0], e.pose.p[2], place.polygon))
        .map(e => [e.pose.p[0], e.pose.p[2]] as V2).sort((a, b) => dist2(a, mid) - dist2(b, mid))[0];
      let axis: V2;   // unit vector from the front of the room into the audience
      if (focus) {const d = dist2(mid, focus) || 1; axis = [(mid[0] - focus[0]) / d, (mid[1] - focus[1]) / d];}
      else {const f = inRoom.map(x => w.entities[x.entityId!]?.pose.yaw ?? 0).reduce((a, y) => [a[0] - Math.sin(y), a[1] + Math.cos(y)] as V2, [0, 0] as V2), n = Math.hypot(f[0], f[1]) || 1; axis = [-f[0] / n, -f[1] / n];}
      const origin = focus ?? mid, depth = (x: Located) => (x.at[0] - origin[0]) * axis[0] + (x.at[1] - origin[1]) * axis[1], lateral = (x: Located) => Math.abs((x.at[0] - origin[0]) * axis[1] - (x.at[1] - origin[1]) * axis[0]);
      const ordered = inRoom.filter(x => !focus || depth(x) >= 0.5).sort((a, b) => depth(a) - depth(b));
      const rows: Located[][] = []; for (const x of ordered) {const last = rows[rows.length - 1]; if (last && depth(x) - depth(last[0]) <= 0.8) last.push(x); else rows.push([x]);}
      if (!rows.length) return no('seat.none-in-place', `${place.name} has no audience seats.`);
      const want = s.row === undefined || s.row === 'any' ? null : s.row === 'front' ? 1 : s.row === 'back' ? rows.length : Number.isInteger(s.row) && (s.row as number) >= 1 ? Math.min(rows.length, s.row as number) : NaN;
      if (Number.isNaN(want)) return no('capability.params', 'row must be "front", "back", "any" or a row number (1 = front).');
      const rowOf = (x: Located) => rows.findIndex(r => r.includes(x));
      if (want === null) {
        const pick = rows.flat().filter(x => !free || x.free).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0];
        if (pick) return {ok: true, kind: 'capability', capability: pick.capability!, ...(params ? {params} : {}), chosen: {...here(pick), place: place.id, row: rowOf(pick) + 1, rows: rows.length}};
      } else for (const i of [...rows.keys()].sort((a, b) => Math.abs(a - (want - 1)) - Math.abs(b - (want - 1)) || a - b)) {
        const cand = rows[i].filter(x => !free || x.free).sort((a, b) => lateral(a) - lateral(b) || a.distance - b.distance || a.id.localeCompare(b.id));
        if (!cand.length) continue;
        const pick = cand[0];
        return {ok: true, kind: 'capability', capability: pick.capability!, ...(params ? {params} : {}), chosen: {...here(pick), place: place.id, row: i + 1, rows: rows.length,
          ...(i + 1 !== want ? {note: `row ${want} is full; row ${i + 1} is the closest with a free seat`} : {}), freeInRow: rows[i].filter(x => x.free).length}};
      }
      return no('seat.none-free', `Every seat in ${place.name} is taken.`);
    }
    const named = str(s.target);
    if (named && s.nearest === undefined && s.near === undefined) {
      const seat = all.find(x => x.id === named || x.capability === named) ?? all.find(x => x.name.toLowerCase() === named.toLowerCase());
      if (seat) {const cap = this.L.coreA.binds(P.soul).caps.find(c => c.id === seat.capability); if (cap?.blocked?.code === 'site.under-construction' && !cap.available) return no(cap.blocked.code, cap.blocked.reason); if (free && !seat.free) return no('slot.none-free', `${seat.name} is taken.`, all.filter(x => x.free).slice(0, 3).map(x => ({id: x.capability!, label: x.name}))); return {ok: true, kind: 'capability', capability: seat.capability!, ...(params ? {params} : {}), chosen: here(seat)};}
      return {ok: true, kind: 'capability', capability: `sit:${named}`, ...(params ? {params} : {}), chosen: {asked: named}};
    }
    if (s.nearest !== undefined && s.nearest !== 'seat' && s.nearest !== 'chair' && s.nearest !== 'bench') return no('capability.params', 'nearest must be "seat" (or chair/bench).');
    const nearRef = str(s.near);
    let ref: V2 = P.pos!, refName: string | null = null, refDist: number | null = null;
    if (nearRef) {
      const t = P.locate(nearRef, {places: false}) ?? P.locate(nearRef);
      if (!t) return no('target.not-in-sight', `Nothing called "${nearRef}" is in sight from here; look at here.near / here.objects.`);
      ref = t.at; refName = t.name; refDist = t.distance;
    }
    const reach = nearRef ? NEAR_SEAT_REACH : SEAT_REACH;
    const cand = all.filter(x => (!free || x.free) && dist2(x.at, ref) <= reach && (!nearRef || x.distance <= 60)).sort((a, b) => dist2(a.at, ref) - dist2(b.at, ref) || a.distance - b.distance || a.id.localeCompare(b.id));
    if (!cand.length) return no('seat.none-near', `No ${free ? 'free ' : ''}seat within ${reach} m of ${refName ?? 'you'}.`, all.filter(x => x.free).sort((a, b) => a.distance - b.distance).slice(0, 3).map(x => ({id: x.capability!, label: x.name})));
    const pick = cand[0];
    return {ok: true, kind: 'capability', capability: pick.capability!, ...(params ? {params} : {}), chosen: {...here(pick), ...(refName ? {near: {name: refName, dist: round1(dist2(pick.at, ref)), ...(refDist !== null ? {theirDistFromYou: refDist} : {})}} : {})}};
  }

  private go(P: Perception, s: Record<string, unknown>, verb: string): Resolution {
    const asked = str(s.place) ?? str(s.target); if (!asked) return no('capability.params', `${verb} needs a place: {"verb":"go","target":{"place":"<id or name>"}}.`);
    const {caps, plans} = this.L.coreA.binds(P.soul), via = s.via !== undefined ? {via: s.via} : {}, withP = s.with !== undefined ? {with: s.with} : {};
    const walkTo = (c: EdgeCapability) => {const p = this.L.places.byId.get(c.target!.id); return {ok: true as const, kind: 'capability' as const, capability: c.id, ...(Object.keys({...via, ...withP}).length ? {params: {...via, ...withP}} : {}), chosen: {...(c.target!.kind==='place'?{place:c.target!.id}:{target:c.target!.id,kind:c.target!.kind}), name: p?.name ?? c.label, ...(p ? this.eta(P, centroid(p.polygon)) : {})}};};
    // Preserve exact non-place destinations such as a carrier boarding object.
    const exact = caps.find(c => c.verb==='walk'&&(c.id===asked||c.id === `walk:${asked}`));
    // RT: a walk the body cannot make from here is refused with the engine's route code, not resolved and then refused at act
    const dead = (c: EdgeCapability, p?: typeof plans) => {const d = this.L.routeProblem(P.soul, c.id, p); return d ? no(d.code, d.reason) : null;};
    if (exact?.target?.kind === 'object') {if (!exact.available && exact.blocked) return no(exact.blocked.code, exact.blocked.reason);return dead(exact) ?? walkTo(exact);}
    const object=offeredWalkObject(this.L,P.soul,asked);if(object){if(!object.ok)return object;const d=dead(object.cap);if(d)return d;const out=walkTo(object.cap);return {...out,chosen:{...out.chosen,matchedBy:object.matchedBy}};}
    const r=resolvePlaceForVerb(this.L,P.soul,exact?.target?.kind==='place'?exact.target.id:asked);
    if(!r.ok)return r;
    // GO-FAR (2026-10-23): a far place's walk the listing leaves out is built on demand, as act "walk to <place>" does
    // (it was caps.find(...)!, a TypeError the edge answered as 503 "the ledger could not answer")
    let cap=caps.find(c=>c.id===r.chosen.capability),capPlans:typeof plans|undefined;
    if(!cap){const od=this.L.resolveOnDemand(P.soul,r.chosen.capability,caps,plans);if(od.v.kind==='unknown'||od.v.cap.id!==r.chosen.capability)return no('place.unwalkable',`No walk reaches ${r.chosen.name??asked} from where you are.`);cap=od.v.cap;capPlans=od.plans;}
    const d=dead(cap,capPlans);if(d)return d;
    const out=walkTo(cap);return {...out,chosen:{...out.chosen,...r.chosen}};
  }

  private swim(P: Perception, s: Record<string, unknown>): Resolution {
    const {caps, plans} = this.L.coreA.binds(P.soul), swims = caps.filter(c => c.verb === 'swim');
    if (!swims.length) return no('swim.unavailable', 'There is no water you can swim in here yet.');
    const asked = str(s.place) ?? str(s.target);
    let cap = swims[0];
    if (asked) {
      const named = swims.find(c => c.id === asked || c.id === `swim:${asked}` || c.target?.id === asked);
      const identity=named?null:lookupPlaceIdentity(this.L,asked,P.soul.soulId);if(identity&&!identity.ok)return identity;
      const loc=identity?.ok?P.locate(identity.chosen.place,{souls:false,things:false}):null;
      const hit = named ?? (loc ? swims.find(c => {const p = c.target ? this.L.places.byId.get(c.target.id) : undefined; return !!p && (p.id === loc.id || inPoly(loc.at[0], loc.at[1], p.polygon) || this.L.coreA.isAncestor(loc.id, p.id));}) : undefined);
      if (!hit) return no('swim.not-swimmable', `${loc?.name ?? asked} is not water you can swim in; you can swim in ${swims.map(c => this.L.places.byId.get(c.target?.id ?? '')?.name ?? c.label).join(', ')}.`, swims.map(c => ({id: c.id, label: c.label})));
      cap = hit;
    }
    if (!cap.available && cap.blocked) return no(cap.blocked.code, cap.blocked.reason);
    const place = cap.target ? this.L.places.byId.get(cap.target.id) : undefined, base = {place: cap.target?.id ?? null, name: place?.name ?? cap.label, ...(place ? this.eta(P, centroid(place.polygon)) : {})};
    if (s.seconds === undefined) return {ok: true, kind: 'capability', capability: cap.id, chosen: {...base, laps: 5}};
    if (!Number.isInteger(s.seconds) || (s.seconds as number) < 30 || (s.seconds as number) > 1800) return no('capability.params', 'seconds must be an integer 30..1800 for a swim.');
    // a swim is laps between deep spots; seconds sets how many (about 20 s each) and the tread at the end
    const plan = plans.get(cap.id); if (!plan) return no('capability.unknown', 'The swim is not offered right now.');
    const laps = Math.max(1, Math.min(60, Math.round(((s.seconds as number) - 20) / 20)));
    const steps = structuredClone(plan.steps), lapAt = steps.findIndex((x, i) => i > 0 && x.verb === 'walk_to' && (x.params as {spread?: string}).spread === 'pond-lap/1');
    const lap = lapAt >= 0 ? steps[lapAt] : null; if (!lap) return {ok: true, kind: 'capability', capability: cap.id, chosen: {...base, laps: 5, note: 'this swim has a fixed length'}};
    const head = steps.slice(0, lapAt), tail = steps.slice(lapAt).filter(x => !(x.verb === 'walk_to' && (x.params as {spread?: string}).spread === 'pond-lap/1'));
    return {ok: true, kind: 'plan', capability: cap.id, label: plan.label, steps: [...head, ...Array.from({length: laps}, () => structuredClone(lap)), ...tail], chosen: {...base, laps, approxSeconds: laps * 20 + 20}};
  }

  private approach(P: Perception, s: Record<string, unknown>): Resolution {
    const asked = str(s.target) ?? str(s.near) ?? str(s.place); if (!asked) return no('capability.params', 'approach needs a target (a Soul, a thing or a place).');
    const distance = s.distance === undefined ? 1.5 : Number(s.distance);
    if (!Number.isFinite(distance) || distance < APPROACH_MIN || distance > APPROACH_MAX) return no('capability.params', `distance must be ${APPROACH_MIN}..${APPROACH_MAX} m.`);
    const t = P.locate(asked); if (!t) return no('target.not-in-sight', `Nothing called "${asked}" is in sight from here; look at here.near / here.objects.`);
    if (t.kind === 'place') return this.go(P, {place: t.id}, 'go');
    const h = P.w.entities[P.soul.entityId]?.human, seated = !!h && (h.activity === 'sit' || h.baseActivity === 'sit');
    const steps: Steps = [...(seated ? [{verb: 'stand', params: {}}] : []), {verb: 'walk_to', params: {to: t.entityId ?? [t.at[0], t.at[1]], standoff: distance}}];
    const blocked = this.planRefusal?.(P.soul, steps, t.entityId ?? t.id); if (blocked) return no(blocked.code, blocked.reason);
    return {ok: true, kind: 'plan', capability: `approach:${t.id}`, label: `Approach ${t.name}`, steps, chosen: {target: t.id, name: t.name, kind: t.kind, standoff: distance, distFromYou: t.distance, ...this.eta(P, t.at)}};
  }

  private follow(P: Perception, s: Record<string, unknown>): Resolution {
    const asked = str(s.target); if (!asked) return no('capability.params', 'follow needs a Soul.');
    if(s.place!==undefined)return this.go(P,{place:s.place,with:[asked],...(s.via!==undefined?{via:s.via}:{})},'go');
    if(s.via!==undefined)return no('follow.destination','Follow cannot promise a destination or route; use go to the named place with a companion invitation.');
    const t = P.locate(asked, {things: false, places: false}); if (!t) return no('soul.not-in-sight', `${asked} is not in sight from here.`);
    const sec = this.seconds(s, 3600); if ('ok' in sec) return sec;
    return {ok: true, kind: 'capability', capability: `follow:${t.id}`, ...(sec.seconds !== undefined ? {params: {seconds: sec.seconds}} : {}), chosen: {target: t.id, name: t.name, distFromYou: t.distance}};
  }

  /** turn {heading} | {face: soul} | {target: thing/soul/place}: the body turns when it is free and standing, else the head. */
  private turn(P: Perception, s: Record<string, unknown>): Resolution {
    const until = this.L.mw.world.tick + FACE_SECONDS * 20;
    if (s.heading !== undefined) {
      const h = Number(s.heading); if (!Number.isFinite(h)) return no('capability.params', 'heading must be compass degrees (0 = north, 90 = east).');
      const deg = ((Math.round(h) % 360) + 360) % 360, yaw = yawOfHeading(deg), ahead: V2 = [P.pos![0] + 6 * Math.sin(deg * Math.PI / 180), P.pos![1] - 6 * Math.cos(deg * Math.PI / 180)];
      return {ok: true, kind: 'attention', capability: `turn:${deg}`, yaw, gaze: {at: ahead, until: this.L.mw.world.tick + LOOK_SECONDS * 20, kind: 'turn'}, chosen: {heading: deg}};
    }
    const asked = str(s.face) ?? str(s.target); if (!asked) return no('capability.params', 'turn needs a heading (degrees), face (a Soul) or target (a thing, Soul or place).');
    if (/^(?:around|back|behind)$/.test(asked.toLowerCase())) return this.turn(P, {heading: (P.heading + 180) % 360});
    const t = s.face !== undefined ? P.locate(asked, {things: false, places: false}) : P.locate(asked);
    if (!t) return no('target.not-in-sight', `Nothing called "${asked}" is in sight from here.`);
    const yaw = yawTowards(P.pos!, t.at);
    return {ok: true, kind: 'attention', capability: `turn:${t.id}`, yaw, gaze: t.entityId ? {target: t.entityId, until, kind: s.face !== undefined ? 'face' : 'turn'} : {at: t.at, until, kind: 'turn'}, chosen: {toward: t.name, id: t.id, kind: t.kind, heading: headingOfYaw(yaw)}};
  }
  /** look {target | direction}: the head only; posture and the body's act are untouched. */
  private look(P: Perception, s: Record<string, unknown>): Resolution {
    const sec = s.seconds === undefined ? LOOK_SECONDS : Number(s.seconds);
    if (!Number.isInteger(sec) || sec < 1 || sec > LOOK_SECONDS_MAX) return no('capability.params', `seconds must be an integer 1..${LOOK_SECONDS_MAX}.`);
    const until = this.L.mw.world.tick + sec * 20, asked = (str(s.direction) ?? str(s.target) ?? '').toLowerCase();
    if (!asked) return no('capability.params', 'look needs a target (a thing, Soul or place) or a direction (left, right, behind, ahead).');
    const dirs: Record<string, number> = {ahead: 0, forward: 0, right: 90, behind: 180, back: 180, around: 180, left: 270};
    if (asked in dirs) {
      if (dirs[asked] === 0) return {ok: true, kind: 'attention', capability: 'look:ahead', gaze: null, chosen: {direction: 'ahead'}};
      const deg = (P.heading + dirs[asked]) % 360, at: V2 = [P.pos![0] + 6 * Math.sin(deg * Math.PI / 180), P.pos![1] - 6 * Math.cos(deg * Math.PI / 180)];
      return {ok: true, kind: 'attention', capability: `look:${asked}`, gaze: {at, until, kind: 'look'}, chosen: {direction: asked, heading: deg, seconds: sec}};
    }
    const t = P.locate(str(s.direction) ?? str(s.target)!); if (!t) return no('target.not-in-sight', `Nothing called "${asked}" is in sight from here.`);
    return {ok: true, kind: 'attention', capability: `look:${t.id}`, gaze: t.entityId ? {target: t.entityId, until, kind: 'look'} : {at: t.at, until, kind: 'look'}, chosen: {at: t.name, id: t.id, kind: t.kind, seconds: sec}};
  }
  private autoFaceSetting(soul: EdgeSoul, s: Record<string, unknown>): Resolution {
    const on = s.on === undefined ? !(str(s.target) ?? '').match(/^off$/i) : s.on !== false && s.on !== 'off';
    const conv = str(s.conversation), key = `${soul.soulId}|${conv ?? '*'}`;
    return {ok: true, kind: 'setting', capability: `auto-face:${on ? 'on' : 'off'}`, apply: () => this.autoFace.set(key, on), chosen: {autoFace: on, conversation: conv ?? 'all'}};
  }

  // ------------------------------------------------------------------ acting
  /** act {verb, target}: resolve now (the step starts now) and act on the concrete choice; the receipt says what it chose. */
  async act(soul: EdgeSoul, input: IntentInput): Promise<{accepted: true; receipt: EdgeReceipt; chosen: Chosen; resolved?: {from: string; to: string; note: string}; channel: string} | Refused> {
    const clientRef = typeof input.clientRef === 'string' && input.clientRef.length <= 100 ? input.clientRef : undefined;
    if (clientRef) {const old = this.L.coreA.byClientRef(soul.soulId, clientRef); if (old) return {accepted: true, receipt: old, chosen: (old as {chosen?: Chosen}).chosen ?? {}, channel: (old as {channel?: string}).channel ?? 'body'};}
    await this.L.coreA.reclaim(soul);
    const r = this.resolve(soul, input), verb = String(input.verb ?? '');
    if (!r.ok) {this.L.recordRefusal(soul.soulId, 'intent', verb, r.code, r.reason); const {ok:_ok,...refusal}=r;return {accepted:false,...refusal,capability:verb};}
    const extra = input.params && typeof input.params === 'object' && !Array.isArray(input.params) ? input.params as Record<string, unknown> : {};
    if (r.kind === 'capability') {
      const out = await this.L.act(soul, {capability: r.capability, params: {...extra, ...(r.params ?? {})}, ...(clientRef ? {clientRef} : {})});
      if (!out.accepted) return {...out, ...(r.chosen.seat ? {} : {})} as Refused;
      const chosen={...r.chosen,...(out.receipt.chosen as Chosen??{})};
      const receipt = this.L.coreA.setDetail(out.receipt.id, {chosen, intent: intentOf(input)}) ?? out.receipt;
      return {accepted: true, receipt, chosen, channel: (receipt as {channel?: string}).channel ?? 'body', ...(out.resolved ? {resolved: out.resolved} : {})};
    }
    if (r.kind === 'plan') {
      const out = await this.L.coreA.launchPlan(soul, r.capability, r.label, r.steps, clientRef,input.params&&typeof input.params==='object'&&!Array.isArray(input.params)?input.params as Record<string,unknown>:{});
      if (!out.accepted) return out as Refused;
      const receipt = this.L.coreA.setDetail(out.receipt.id, {chosen: r.chosen, intent: intentOf(input)}) ?? out.receipt;
      this.L.comms?.fading.touch?.(soul.soulId);
      return {accepted: true, receipt, chosen: r.chosen, channel: 'body'};
    }
    if (r.kind === 'setting') {r.apply(); const receipt = this.L.coreA.insertDone(soul, r.capability, clientRef, {channel: 'none', chosen: r.chosen}); return {accepted: true, receipt, chosen: r.chosen, channel: 'none'};}
    return this.attend(soul, r.capability, r.gaze, r.yaw, r.chosen, clientRef);
  }
  /** The attention channel: one logged edge-attention event, then a completed receipt (channel attention). */
  async attend(soul: EdgeSoul, capability: string, gaze: Gaze, yaw: number | undefined, chosen: Chosen, clientRef?: string) {
    const tick = this.L.mw.world.tick;
    if (gaze?.until) this.explicitUntil.set(soul.soulId, gaze.until); else this.explicitUntil.delete(soul.soulId);
    await this.L.host.enqueue('edge-attention' as never, `edge:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, gaze, ...(yaw !== undefined ? {yaw} : {})});
    const b = (this.L.mw.world as {entities: Record<string, {pose: {yaw: number}}>}).entities[soul.entityId];
    const turned = yaw !== undefined && b && Math.abs(((b.pose.yaw - yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < 0.01 ? 'body' : gaze ? 'head' : 'none';
    const done = {...chosen, turned, ...(gaze?.until ? {holdsFor: durationWord((gaze.until - tick) / 20)} : {})};
    this.L.comms?.fading.touch?.(soul.soulId);
    const receipt = this.L.coreA.insertDone(soul, capability, clientRef, {channel: 'attention', chosen: done});
    return {accepted: true as const, receipt, chosen: done, channel: 'attention'};
  }
  /** Auto-face (default on): when someone speaks in a conversation, the other members within 12 m turn their heads to
   *  them for a few seconds, unless their own look or turn still holds, or they turned auto-face off. Logged events.
   *  CONV-UI (Gene 10-08 "frames them facing"): a free standing body (no act, not seated) also turns to the group's
   *  centre, the speaker included, so a talking group stands facing each other (a pair faces each other). */
  onTurn(conversation: string, speaker: string, members: string[]) {
    type Ents = {entities: Record<string, {pose: {p: number[]}}>};
    const ents = (this.L.mw.world as Ents).entities, bodyOf = (id: string) => {const m = this.L.host.minds.get(id); return m ? {m, b: ents[m.entityId]} : null;};
    const sm = this.L.host.minds.get(speaker); if (!sm) return;
    const sb = ents[sm.entityId]; if (!sb) return;
    const tick = this.L.mw.world.tick;
    const auto = (id: string) => !(this.autoFace.get(`${id}|${conversation}`) === false || (this.autoFace.get(`${id}|${conversation}`) === undefined && this.autoFace.get(`${id}|*`) === false)) && (this.explicitUntil.get(id) ?? -1) <= tick;
    const group = [...new Set([speaker, ...members])].flatMap(id => {const x = bodyOf(id); return x?.b && !this.L.faded.has(id) && Math.hypot(x.b.pose.p[0] - sb.pose.p[0], x.b.pose.p[2] - sb.pose.p[2]) <= 12 ? [{id, ...x, b: x.b}] : [];});
    const centre: V2 | null = group.length >= 2 ? [group.reduce((a, g) => a + g.b.pose.p[0], 0) / group.length, group.reduce((a, g) => a + g.b.pose.p[2], 0) / group.length] : null;
    const yawOf = (p: number[]) => centre && Math.hypot(centre[0] - p[0], centre[1] - p[2]) > 0.05 ? {yaw: yawTowards([p[0], p[2]], centre)} : {};
    for (const {id, m, b} of group) {
      if (!auto(id)) continue;
      const gaze = id === speaker ? (centre ? {at: centre, until: tick + AUTO_FACE_SECONDS * 20, kind: 'auto'} : null) : {target: sm.entityId, until: tick + AUTO_FACE_SECONDS * 20, kind: 'auto'};
      if (!gaze) continue;
      try {void this.L.host.enqueue('edge-attention' as never, `edge:${id}`, {soulId: id, entityId: m.entityId, gaze, ...yawOf(b.pose.p)}).catch(() => {/* best effort */});} catch {/* clock not ready */}
    }
  }

  /** A dry run's answer for one resolved capability (the full path below and the exact-walk fast path share it). */
  private capabilityWould(soul: EdgeSoul, cap: EdgeCapability, asked: string, params: Record<string, unknown>, note: string, extra?: Record<string, unknown>): Record<string, unknown> {
    const P = new Perception(this.L, soul), at = this.L.coreA.targetPoint(soul, cap);
    return {ok: true, would: {capability: cap.id, label: cap.label, available: cap.available, ...(cap.blocked ? {blocked: cap.blocked} : {}), ...(Object.keys(params).length ? {params} : {}), channel: cap.verb === 'face' ? 'attention' : 'body',
      ...resolvedParts(this.L,soul,cap,asked), ...(note ? {resolved: note + (extra?.with ? `. Act it with these params (act ${cap.id} '${JSON.stringify(extra)}'), or act the same words; an act without "with" is solo.` : '')} : {}), ...(at && P.pos ? this.eta(P, at) : {})}};
  }
  /** Latency only (continuity r3, 2026-10-30: two concurrent `resolve walk:<ref>` each built the whole-world menu and
   *  stalled Eden 2026 ~1.9 s). A listed exact walk act would take its fast path for resolves over act's narrow bindings
   *  (exactWalkBindings, then explicitPlaceCapability over them), never the whole menu. For such an offer the full path
   *  below has a fixed course (no place, attention, class, strict or social rewrite: the listing holds the exact id) and
   *  ends in capabilityWould with the same capability, so the answer is identical. Null means: take the full path. */
  private exactWalkDryRun(soul: EdgeSoul, capability: string, params: unknown): Record<string, unknown> | null {
    if (this.L.bodyVerbProblem(soul, capability.split(/[:\s]/)[0]!)) return null;   // as act: body refusals first
    const exact = this.L.coreA.exactListedWalk(soul, {capability, params}); if (!exact) return null;
    const asked = capability.trim();
    if (explicitPlaceCapability(this.L, soul, asked, exact.caps)) return null;
    const v = this.L.resolveOnDemand(soul, asked, exact.caps, exact.plans).v;
    if (v.kind !== 'exact' || v.cap.id !== asked) return null;
    return this.capabilityWould(soul, v.cap, asked, {}, '');
  }

  /** POST /v1/edge/resolve: what act would do, without doing anything. */
  dryRun(soul: EdgeSoul, input: IntentInput & {capability?: unknown}): Record<string, unknown> {
    if (typeof input.capability === 'string' && input.verb === undefined) {
      const walk=walkWithDestinationWords(input.capability,[...this.L.host.minds.values()].map(m=>m.name));if(walk){const out=this.dryRun(soul,{...walk,...(input.params?{params:input.params}:{})});if(out.ok!==false)return out;
        // quality case 27: an ambiguous destination name ("the library") falls back to the walk the plain words resolve to, still inviting the companions
        const alt=walkWithFallback(this.L,soul,walk);return alt?{ok:true,would:{capability:alt.cap.id,label:alt.cap.label,available:alt.cap.available,params:{with:walk.with},channel:'body',resolved:`${input.capability} is ${alt.cap.id} with ${(walk.with as string[]).join(', ')} invited ({"with": ${JSON.stringify(walk.with)}}); they join if they accept.`}}:out;}
      const exact = this.exactWalkDryRun(soul, input.capability, input.params); if (exact) return exact;
      // Social approaches may add an on-demand plan. Keep the dry run's additions local, just as act does.
      // L3 (b): words resolve on the words menu; resolveText / exactWords rebuild the chosen offer exactly
      const bound = this.L.coreA.wordsMenu(soul), caps = [...bound.caps], plans = new Map(bound.plans), asked = input.capability.trim();
      // SOULSIM-E: a far place's id the listing leaves out resolves on demand below, as act walks it (resolveText)
      const place=explicitPlaceCapability(this.L,soul,asked),onDemand=!!place&&!place.ok&&place.code==='place.unwalkable'&&this.L.onDemandId(soul,asked);if(place&&!onDemand){if(!place.ok)return place;return {ok:true,would:{capability:place.chosen.capability,channel:'body',chosen:place.chosen,...resolvedParts(this.L,soul,place.chosen.capability,asked)}};}
      const bodyIssue=asked.startsWith('object:')?null:this.L.bodyVerbProblem(soul,asked.split(/[:\s]/)[0]!);if(bodyIssue)return {ok:false,...bodyIssue};
      if (!asked || asked.length > 200) return {ok: false, code: 'capability.params', reason: 'capability must be 1..200 characters.'};
      const plain = offeredAttention(caps, asked) ? null : attentionWords(asked); if (plain) return this.dryRun(soul, plain);
      const cls = classWords(asked, this.L.places.byId.values()); if (cls) return this.dryRun(soul, cls);
      const strict = strictCheck(this.L, soul, asked, caps); if (strict && !this.L.onDemandId(soul, asked)) return {ok: false, ...strict};
      // quality cases 21/28: resolve reads social phrasing exactly as act does ("ride the balloon with X" invites X; "hug X")
      const social = caps.some(c => c.id === asked) ? null : this.L.together.resolve(soul, asked, caps, plans);
      if (social && 'code' in social) return {ok: false, code: social.code, reason: social.reason, did_you_mean: social.did_you_mean};
      const text = social ? social.capability || social.rest || asked : asked, extra = social?.params;
      const r = text === asked ? this.L.coreA.resolveText(soul, asked, caps) : caps.some(c => c.id === text) ? this.L.coreA.exactWords(soul, bound, text, {kind: 'exact' as const, cap: caps.find(c => c.id === text)!}) : this.L.coreA.resolveText(soul, text, caps);
      if (r.kind === 'unknown') return {ok: false, code: (r as {code?: string}).code ?? 'capability.unknown', reason: r.reason, did_you_mean: r.didYouMean,...(r.discovery?{discovery:r.discovery}:{})};
      const params = {...(r.kind === 'alias' && r.params ? r.params : {}), ...(extra ?? {})};
      return this.capabilityWould(soul, r.cap, asked, params, [social?.note, r.kind === 'alias' ? r.note : null].filter(Boolean).join('; '), extra);
    }
    const r = this.resolve(soul, input);
    if (!r.ok) return {...r};
    if (r.kind === 'capability') {
      // the concrete capability must itself be offered (or resolve) right now
      const {caps} = this.L.coreA.wordsMenu(soul), strict = strictCheck(this.L, soul, r.capability, caps); if (strict && !this.L.onDemandId(soul, r.capability, caps)) return {ok: false, ...strict};
      const v = this.L.coreA.resolveText(soul, r.capability, caps);
      if (v.kind === 'unknown') return {ok: false, code: (v as {code?: string}).code ?? 'capability.unknown', reason: v.reason, did_you_mean: v.didYouMean,...(v.discovery?{discovery:v.discovery}:{})};
      if (!v.cap.available && v.cap.blocked) return {ok: false, code: v.cap.blocked.code, reason: v.cap.blocked.reason};
      return {ok: true, would: {capability: v.cap.id, ...(r.params ? {params: r.params} : {}), channel: 'body', chosen: r.chosen,...resolvedParts(this.L,soul,v.cap)}};
    }
    if (r.kind === 'plan') {
      const issue = this.L.mw.feasibility.canPerform({actor: soul.entityId, label: r.label, steps: r.steps});
      if (issue && !['program.safe-stop-required', 'program.safe-stop-pending'].includes(issue.code)) return {ok: false, code: issue.code, reason: issue.message};
      return {ok: true, would: {capability: r.capability, channel: 'body', chosen: r.chosen, ...(issue ? {waitsFor: 'a safe stop of what the body is doing'} : {})}};
    }
    if (r.kind === 'setting') return {ok: true, would: {capability: r.capability, channel: 'none', chosen: r.chosen}};
    const h = (this.L.mw.world as {entities: Record<string, {human?: {activity?: string; baseActivity?: string}}>}).entities[soul.entityId]?.human;
    const free = !this.L.mw.programOf(soul.entityId) && (h?.activity === 'idle' || h?.activity === 'wait');
    return {ok: true, would: {capability: r.capability, channel: 'attention', chosen: {...r.chosen, turns: r.yaw !== undefined && free ? 'body' : r.gaze ? 'head' : 'none'}}};
  }
}

/** The intent as asked (verb, target, spec keys), kept on its receipt so a blocked step can be re-resolved. */
const intentOf = (input: IntentInput): IntentInput => {const out: IntentInput = {verb: input.verb, ...(input.target !== undefined ? {target: input.target} : {})}; for (const k of SPEC_KEYS) if (input[k] !== undefined) out[k] = input[k]; return out;};

// a second verb is "face", or "look/glance at", "turn to(wards)": a name that only starts with a verb ("Look Out Point") is kept
const SECOND_VERB = /^(?:a?round\s+)?(?:(?:and|to)\s+)?(?:face(?:\s+(?:to|towards|toward))?|(?:look|glance)\s+(?:at|over at|towards|toward)|turn\s+(?:to|towards|toward))\s+(?=\S)/i;
const SECOND_VERB_ID = /^(?:face(?:[-\s](?:to|towards|toward))?|(?:look|glance)[-\s](?:at|towards|toward)|turn[-\s](?:to|towards|toward))[-\s](?=\S)/i;
/** An offered attention id answers for itself: the id as asked, or its alias form (turn-to:<soul> / look-at:<soul> are face:<soul>). */
export const offeredAttention = (caps: readonly {id: string}[], asked: string): boolean => {const alias = asked.trim().replace(/^(?:turn-to|look-at)\s*:\s*/i, 'face:'); return caps.some(c => c.id === asked || c.id === alias);};
/** Plain words for the attention channel: "look at the fire", "turn to Bill", "face the campfire", "look left", "turn around". */
export function attentionWords(text: string): IntentInput | null {
  // RESOLVE: "look for X" / "look around for X" is finding X (a walk to the nearest), not a look
  if (/^\s*(?:look|glance)\s+(?:around\s+|round\s+)?for\b/i.test(text)) return null;
  // "turn on the tap" / "turn off the lamp" switch a thing; they are never "turn toward 'on the tap'"
  if (/^\s*turn\s+(?:on|off)\b/i.test(text)) return null;
  // F1 (#372): an id-shaped turn ("turn:eden-bandstand", the capability a dry run names; "turn-to:bandstand", "look-at:pond")
  // is the same attention intent; `turn:<degrees>` is a heading. Callers skip offered ids first (offeredAttention).
  const id = /^\s*(look-at|look|glance|turn-to|turn|face)\s*:\s*(.+?)\s*$/i.exec(text);
  if (id) {const what = id[2].replace(SECOND_VERB_ID, ''); if (/^(?:on|off)\b/i.test(what)) return null; if (/^\d{1,3}$/.test(what)) return {verb: 'turn', heading: Number(what)}; return what ? {verb: /^(?:look|glance)/i.test(id[1]) ? 'look' : 'turn', target: what} : null;}
  const m = /^\s*(look|glance|turn|face)(?:\s+(?:at|to|towards|toward|round|over at))?\s+(.+?)\s*$/i.exec(text); if (!m || text.includes(':')) return null;
  // F1 (#372): a second attention verb names no target: "turn to face X", "turn and face X", "turn around to look at X"
  const verb = m[1].toLowerCase(), rest = m[2].replace(SECOND_VERB, '').replace(/^(?:the|a|an)\s+/i, '').trim(); if (!rest) return null;
  if (verb === 'look' || verb === 'glance') return {verb: 'look', target: rest};
  if (/^(?:around|back|behind)$/i.test(rest)) return {verb: 'turn', target: rest};
  return {verb: 'turn', target: rest};
}

/** An explicit companion AND destination becomes a destination walk with a consent invitation. */
/** "walk with X to <place>" whose place name is ambiguous for strict place resolution: the walk its plain words resolve to. */
export function walkWithFallback(L:EdgeLedger,soul:EdgeSoul,walk:IntentInput):{cap:EdgeCapability}|null{
 const place=(walk.target as {place?:unknown}|undefined)?.place;const companions=walk.with as string[]|undefined;if(typeof place!=='string'||!companions?.length)return null;
 const {caps}=L.coreA.wordsMenu(soul),r=L.coreA.resolveText(soul,'walk to '+place,caps);return r.kind!=='unknown'&&r.cap.verb==='walk'?{cap:r.cap}:null;
}
export function walkWithDestinationWords(text:string,knownNames:readonly string[]=[]):IntentInput|null {
 if(text.includes(':'))return null;
 const whole=/^\s*(?:please\s+)?(?:walk|go)\s+with\s+(.+?)\s*$/i.exec(text)?.[1].replace(/[.!?]+$/,'').trim().toLowerCase();
 if(whole&&knownNames.some(name=>name.trim().toLowerCase()===whole))return null;
 const match=/^\s*(?:please\s+)?(?:walk|go)\s+with\s+(.+?)\s+to\s+(.+?)\s*[.!?]?\s*$/i.exec(text);
 return match?{verb:'go',target:{place:match[2].replace(/[.!?]+$/,'').trim()},with:[match[1].trim()]}:null;
}
