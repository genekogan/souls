// E-life (overnight 2026-10-17): the old worlds' activity spots (activities/1), derived from what a god built.
// Old Eden authored 95 spots by hand (read at library chairs, write at desks, paint at easels, post letters, eat at picnic
// tables, play the piano, sing on the stage, listen from the audience, gym apparatus, park games). On a god's world the
// same affordances come from the things themselves: a bookcase is a shelf to take a book from, a chair near it is a place
// to read, a desk with a chair is a place to write, a computer desk is a computer, an easel is a place to paint, a postbox
// takes letters, a stove is a place to cook, a café chair at a table is a place to eat and drink, a piano's bench is where
// to play it, a stage has a microphone and room for a band, the benches facing it are an audience. The ledger's own
// activities code (edge/ledger/activities.ts) turns these spots into capabilities with ordinary body plans and receipts,
// exactly as on the old worlds. Pure read of the entity world and the engine; cached until the god edits something.
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';
import type { SpotsData, Spot, Shelf } from '../edge/ledger/activities.ts';
import { CATALOG } from '../../../../mars/viewer/engine/world/catalog.ts';
import { canvasFace, flatCanvas, paintingEasel } from '../art/art.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type V2 = [number, number];
export type SpotsHost = {
  model: WorldModel;
  engine: { world: { entities: Record<string, any> }; standableNearV1?(at: V2, level?: number, except?: string, minClear?: number, maxRing?: number): V2 | null };
  /** Bumped by every god edit (not by a Soul carrying a cup about). */
  version(): string | number;
  /** How many of the model's entities are Souls' bodies (derive never reads them): a birth or retire keeps the spots. */
  bodies?(): number;
  levelAt(x: number, z: number, y: number): number;
  /** Innermost place holding a point (a room, a building, an area), and its name. */
  placeAt(at: V2, level: number): string | null;
  /** placeAt for many points while nothing changes (one derive): same answers, built once (places.ts locator). */
  placeLocator?(): (at: V2, level: number) => string | null;
  placeName(id: string): string | null;
  /** Called before a derive (the god's places into the ledger's index). */
  prepare?(): void;
  /** S2: true while the host catches up with god edits off the request path (G1: places re-derive in slices). Spots
   *  read the places, so while it runs a read keeps the spots it has (≤ ~2 s old, as the places themselves) instead of
   *  forcing the whole places derive into the request; the first read after the catch-up derives them. */
  catchingUp?(): boolean;
  /** L4 item 6: a served world derives in tick slices (warm(budgetMs)); a world stepped by hand derives at once. */
  sliced?(): boolean;
};
type SpotsDerive = { locate: ((at: V2, level: number) => string | null) | null; memo: WeakMap<V2, { level: number; v: string | undefined }> | null };

/** How many seats per place offer the same seated activity (old Eden: 24 reading spots over the whole town). */
const PER_PLACE = { read: 4, eat: 3, write: 2, 'use-computer': 3, listen: 8 } as const;
/** Free spots offered per activity (nearest first) and places to read in. */
const NEAREST = 4;
const SHELF_READ_RADIUS = 8, TABLE_SEAT_GAP = 1.0, AUDIENCE_RADIUS = 30;
const r2 = (n: number) => Math.round(n * 100) / 100;
const d2 = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const inPolygon = (p: V2, poly: V2[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c; } return c; };
const centroidOf = (p: V2[]): V2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];

type Thing = { on?: string; id: string; e: Entity; def: StoredDef; name: string; tags: Set<string>; c: Record<string, any>; at: V2; y: number; yaw: number; level: number; size: [number, number, number]; slots: { id: string; kind: string; local: V2; yaw: number }[] };

/** Words that say what a def is (its name without `core-`, its tags). */
const kinds = new WeakMap<StoredDef, string>();
const kindOf = (t: Thing) => { let k = kinds.get(t.def); if (k === undefined) kinds.set(t.def, (k = t.def.name.replace(/^core-/, ''))); return k; };
const is = (t: Thing, ...words: string[]) => words.some(w => t.tags.has(w) || kindOf(t) === w);
const SEAT_KINDS = ['chair', 'armchair', 'sofa', 'stool', 'bench-seat', 'bench', 'pew', 'office-chair', 'dining-chair', 'bar-stool', 'loveseat'];

/** A two-person spot (see-saw, book club, cooking together) waits this long for the other end: a partner is offered the
 *  waiting seat from anywhere within SPOT_REACH (200 m), about 150 s on foot, so a shorter wait (the see-saw had 60 s) let
 *  the first rider give up while the second was still walking over (both failed partner-absent). */
export const TOGETHER_WAIT = 150;
/** Standing work positions that ordinary room visitors should leave usable.
 * These are geometric hints, not claims: explicit activity plans still use them. */
export type ActivityServicePoint = {id: string; at: V2; level: number};
/** #430: a paint spot at a flat (ground) canvas: its own title, a stick of chalk in hand and the stooping chalk pose. */
const CHALK_SPOT = { title: 'Draw in chalk', prop: 'pen', pose: 'chalk' } as const;
const SERVICE_ACTIVITIES = new Set(['read', 'write', 'paint', 'use-computer', 'craft', 'cook', 'post-letter', 'play-music', 'play-piano']);

export class GodActivitySpots {
  private h: SpotsHost;
  private cache: { key: string; value: SpotsData } | null = null;
  /** Last derive time (ms) and counts, for the perf table and diagnostics. */
  stats = { ms: 0, spots: 0, shelves: 0, derives: 0, kept: 0 };
  constructor(h: SpotsHost) { this.h = h; }

  /** A reader asked for the spots since the last warm(): worth deriving them ahead of the next read. */
  private wanted = false;
  private services: {from: SpotsData; points: readonly ActivityServicePoint[]} | null = null;
  /** Same authored/derived positions as activities, before per-Soul distance or
   * occupancy filtering. Seated, social and roaming activities are not stations. */
  serviceStandingPoints(): readonly ActivityServicePoint[] {
    const data = this.data();
    if (this.services?.from !== data) {
      const points = data.spots
        .filter(s => s.base === 'idle' && SERVICE_ACTIVITIES.has(s.activity))
        .map(s => ({id: s.id, at: [...s.at] as V2, level: s.level ?? 0}));
      // A re-derive that moved no station (a sign rewritten) keeps the array identity, so GodNav does not drop its
      // per-epoch room goals for it (busy-costs S2: no room re-routed)
      const same = !!this.services && JSON.stringify(this.services.points) === JSON.stringify(points);
      this.services = {from: data, points: same ? this.services!.points : points};
    }
    return this.services.points;
  }
  data(): SpotsData { this.wanted = true; return this.get(); }
  /** Continuity (warm after listen): derive the spots now (unless current) in slices of about `budgetMs`, one per step,
   *  whether or not a listing has asked for them yet. Same derive and cache as `warm`/`get`. */
  *servingWarmGen(budgetMs: number): Generator<void, void, void> {
    for (;;) {
      if (this.cache?.key === this.key()) return;
      if (!this.pass) this.begin();
      if (this.continue(budgetMs)) return;
      yield;
    }
  }
  /** Derive now, off a Soul's listing, if the spots are stale and someone reads them (the host calls it once a god
   *  edit has been caught up with). Same derive and cache as data(): the next read finds them. True when it derived.
   *  L4 item 6: a served world (SpotsHost.sliced) derives in slices of `budgetMs` (one per tick while deriving()), and a
   *  read meanwhile keeps the spots it has; the first spots of a boot are warmed the same way, unasked. */
  warm(budgetMs = Infinity): boolean {
    if (this.pass) return this.continue(budgetMs);
    const sliced = !!this.h.sliced?.();
    if (!(this.wanted || (sliced && !this.cache)) || this.cache?.key === this.key() || this.h.catchingUp?.()) return false;
    this.wanted = false;
    if (!sliced) { this.get(); return true; }
    this.begin();
    return this.continue(budgetMs);
  }
  /** Open a sliced derive of the current key (continue() steps it). */
  private begin() {
    const key = this.key(), gen = this.start();
    this.pass = { key, gen, locate: this.locate, memo: this.placeMemo, ms: 0 };
    this.locate = null; this.placeMemo = null;
  }
  /** L4 item 6: a served world before its first spots: none yet (the host offers its base spots), a warm is asked for. */
  pendingFirst(): boolean { if (this.cache || !this.h.sliced?.()) return false; this.wanted = true; return true; }
  /** A sliced derive is under way. */
  deriving(): boolean { return this.pass !== null; }
  /** The sliced derive: what it is a derive of (key), where it is, the place lookups it began with, CPU ms so far. */
  private pass: { key: string; gen: Generator<void, SpotsData>; locate: SpotsDerive['locate']; memo: SpotsDerive['memo']; ms: number } | null = null;
  /** What the spots are a function of: the god's edits (and entity physics) and how many non-body entities the model
   *  holds. L4: bodies are left out — a Soul arriving or leaving re-derived all ~1,000 spots (~130 ms on eden2). */
  private key() { return `${this.h.version()}:${this.h.model.entities.size - (this.h.bodies?.() ?? 0)}`; }
  /** Begin a derive: the god's places into the index, the place locator as it is now. */
  private start(): Generator<void, SpotsData> {
    this.h.prepare?.();
    this.locate = this.h.placeLocator?.() ?? null;
    this.placeMemo = new WeakMap();
    return this.deriveGen();
  }
  /** Run the sliced derive for up to budgetMs; true when it finished (cache and stats set). A derive whose inputs moved
   *  (the key) is dropped and begun again at the next warm. */
  private continue(budgetMs: number): boolean {
    const p = this.pass!;
    if (p.key !== this.key()) { this.pass = null; this.wanted = true; return false; }
    const t0 = performance.now();
    this.locate = p.locate; this.placeMemo = p.memo;
    let r: IteratorResult<void, SpotsData>;
    try { do r = p.gen.next(); while (!r.done && performance.now() - t0 < budgetMs); }
    catch (e) { this.pass = null; throw e; }
    finally { this.locate = null; this.placeMemo = null; p.ms += performance.now() - t0; }
    if (!r.done) return false;
    this.pass = null; this.finish(p.key, r.value, p.ms); return true;
  }
  private finish(key: string, value: SpotsData, ms: number) {
    this.stats = { ms: Math.round(ms), spots: value.spots.length, shelves: value.shelves.length, derives: this.stats.derives + 1, kept: this.stats.kept };
    this.cache = { key, value };
  }
  private get(): SpotsData {
    const key = this.key();
    if (this.cache?.key === key) return this.cache.value;
    if (this.cache && (this.h.catchingUp?.() || this.h.sliced?.())) { this.stats.kept++; this.wanted = true; return this.cache.value; }
    if (this.pass?.key === key) { this.continue(Infinity); if (this.cache?.key === key) return this.cache.value; }
    this.pass = null;
    const t0 = performance.now(), gen = this.start();
    let r: IteratorResult<void, SpotsData>;
    try { do r = gen.next(); while (!r.done); } finally { this.locate = null; this.placeMemo = null; }
    this.finish(key, r.value, performance.now() - t0);
    return r.value;
  }

  private things(): Thing[] {
    const m = this.h.model, ents = this.h.engine.world.entities, out: Thing[] = [];
    for (const [id, x] of Object.entries(ents)) {
      if (!x?.tags?.includes('entity-world') || x.kind === 'human' || x.support?.kind === 'in-hand') continue;
      const e = m.entities.get(id); if (!e) continue;
      const def = m.resolvedDef(e.def); if (!def) continue;
      const a = CATALOG[x.def]; if (!a) continue;
      const at: V2 = [x.pose.p[0], x.pose.p[2]], y = x.pose.p[1];
      out.push({ ...(x.support?.kind === 'resting-on' ? { on: String(x.support.on) } : {}), id, e, def, name: (e.name ?? kindOf({ def } as Thing)).replace(/-/g, ' '), tags: new Set(def.tags), c: def.components as Record<string, any>, at, y, yaw: x.pose.yaw ?? 0,
        level: this.h.levelAt(at[0], at[1], y), size: a.size as [number, number, number], slots: (a.slots ?? []).map(s => ({ id: s.id, kind: s.kind, local: s.local as V2, yaw: s.yaw })) });
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** A local (x, z) of a thing in world coordinates (engine poses carry Mars yaw: x' = x cos − z sin). */
  private world(t: Thing, l: V2): V2 { const c = Math.cos(t.yaw), s = Math.sin(t.yaw); return [r2(t.at[0] + l[0] * c - l[1] * s), r2(t.at[1] + l[0] * s + l[1] * c)]; }
  /** Where a body stands to use a thing: its own `stand` slot (a postbox's letter slot, a bookcase's browse point), else
   *  in front of it (+z local, the def's front). */
  private standAt(t: Thing, slot?: string): V2 | null {
    const s = t.slots.find(q => q.kind === 'stand' && (!slot || q.id === slot));
    // No standing-ground probe here (it paged in fine nav tiles across the whole world: 18 s on Eden 2026); the ledger's
    // activities step a spot that lies inside furniture back out at offer time, near the Soul, from warm tiles.
    return s ? this.world(t, s.local) : this.world(t, [0, t.size[2] / 2 + 0.45]);
  }
  /** During a derive: the places as they were when it began (placeLocator), asked many times. */
  private locate: ((at: V2, level: number) => string | null) | null = null;
  /** During a derive: place() answers by point (the same point is asked for one thing by several passes). */
  private placeMemo: WeakMap<V2, { level: number; v: string | undefined }> | null = null;
  private place(at: V2, level: number) {
    const m = this.placeMemo?.get(at); if (m && m.level === level) return m.v;
    const v = (this.locate ? this.locate(at, level) : this.h.placeAt(at, level)) ?? undefined;
    this.placeMemo?.set(at, { level, v });
    return v;
  }
  private label(t: Thing, place?: string) { const p = place ? this.h.placeName(place) : null; return `${t.name}${p && p.toLowerCase() !== t.name.toLowerCase() ? ` in ${p}` : ''}`.slice(0, 80); }

  private *deriveGen(): Generator<void, SpotsData> {
    let slice = 0;
    const all = this.things(), spots: Spot[] = [], shelves: Shelf[] = [], used = new Set<string>();
    // Authored mesh furniture (e.g. mars-study-chair) carries its kind in tags rather than the exact def name.
    // Keep the real seat-slot requirement: a bed or a merely chair-labelled decoration is not an activity seat.
    const seats = all.filter(t => is(t, ...SEAT_KINDS) && t.slots.some(s => s.kind === 'seat'));
    const seatHeight = (t: Thing) => { const h = Number(t.c.seat?.height); return Number.isFinite(h) && h >= 0.2 && h <= 1.2 ? h : undefined; };
    const add = (s: Spot) => { if (!used.has(s.id)) { used.add(s.id); spots.push(s); } };
    const standSpot = (t: Thing, activity: string, extra: Partial<Spot> = {}, slot?: string) => {
      const at = this.standAt(t, slot); if (!at) return;
      const place = this.place(at, t.level);
      add({ id: `${activity}.${t.id}`.toLowerCase(), activity, base: 'idle', at, faceTo: [r2(t.at[0]), r2(t.at[1])], label: this.label(t, place), ...(place ? { place } : {}), ...(t.level ? { level: t.level } : {}), ...extra });
    };
    const seatSpot = (seat: Thing, activity: string, faceTo: V2 | undefined, extra: Partial<Spot> = {}) => {
      const place = this.place(seat.at, seat.level), h = seatHeight(seat);
      // a bench, sofa, picnic table, swing set or see-saw seats several: one spot per seat place (the first keeps the plain id),
      // so a second resident is not refused because the first one's act holds the spot
      const places = seat.slots.filter(q => q.kind === 'seat');
      (places.length > 1 ? places : [null]).forEach((q, k) => add({ id: `${activity}.${seat.id}${k ? `.${k + 1}` : ''}`.toLowerCase(), activity, base: 'sit', at: q ? this.world(seat, q.local) : [r2(seat.at[0]), r2(seat.at[1])], seat: seat.id, ...(faceTo ? { faceTo } : {}), ...(h ? { seatHeight: h } : {}), label: this.label(seat, place), ...(place ? { place } : {}), ...(seat.level ? { level: seat.level } : {}), ...extra }));
    };
    /** Seats beside a table or desk (within a metre of its edge), nearest first. */
    const seatsAt = (t: Thing) => seats.filter(s => s.level === t.level && d2(s.at, t.at) <= Math.hypot(t.size[0], t.size[2]) / 2 + TABLE_SEAT_GAP).sort((a, b) => d2(a.at, t.at) - d2(b.at, t.at) || (a.id < b.id ? -1 : 1));
    const perPlace = new Map<string, number>(), room = (activity: keyof typeof PER_PLACE, place: string | undefined) => { const k = `${activity}|${place ?? ''}`, n = perPlace.get(k) ?? 0; if (n >= PER_PLACE[activity]) return false; perPlace.set(k, n + 1); return true; };

    // B1 read: every bookcase or bookshelf is a shelf (take a book, put it back); a lectern is read standing; the chairs,
    // armchairs and sofas near shelves in the same place are where to sit and read.
    const shelfThings = all.filter(t => is(t, 'bookcase', 'bookshelf', 'books', 'library') && (t.c.container || t.c.readable) && !t.c.carryable);
    for (const t of shelfThings) {
      if ((++slice & 127) === 0) yield;
      const at = this.standAt(t, 'browse'); if (!at) continue;
      const place = this.place(at, t.level);
      shelves.push({ id: `shelf.${t.id}`.toLowerCase(), at, faceTo: [r2(t.at[0]), r2(t.at[1])], ...(place ? { place } : {}), ...(t.level ? { level: t.level } : {}) });
    }
    for (const s of seats) {
      if ((++slice & 127) === 0) yield;
      if (kindOf(s) === 'office-chair') continue;
      const shelf = shelves.filter(q => (q.level ?? 0) === s.level && d2(q.at, s.at) <= SHELF_READ_RADIUS).sort((a, b) => d2(a.at, s.at) - d2(b.at, s.at))[0]; if (!shelf) continue;
      const place = this.place(s.at, s.level); if (shelf.place && place && shelf.place !== place) continue;
      if (room('read', place)) seatSpot(s, 'read', undefined, { prop: 'book' });
    }
    yield;
    for (const t of all) if (is(t, 'lectern') && t.c.readable) standSpot(t, 'read', { prop: 'book' }, 'reader');

    // B1 write / B4 computers: a desk with a chair is a place to write (or to use its computer); without one, standing
    for (const t of all) {
      if ((++slice & 127) === 0) yield;
      const computer = t.c.workstation?.kind === 'computer', desk = computer || t.c.workstation?.kind === 'desk' || is(t, 'school-desk', 'desk', 'office-desk');
      if (!desk) continue;
      const activity = computer ? 'use-computer' : 'write', chair = seatsAt(t).find(s => !used.has(`write.${s.id}`) && !used.has(`use-computer.${s.id}`) && !used.has(`read.${s.id}`));
      const place = this.place(t.at, t.level); if (!room(activity, place)) continue;
      if (chair) seatSpot(chair, activity, [r2(t.at[0]), r2(t.at[1])], { label: this.label(t, place), ...(computer ? { also: ['write'] } : { prop: 'pen' }) });
      else standSpot(t, activity, computer ? { also: ['write'] } : {}, 'user');
    }
    // B4 paint at easels; other workstations by kind
    for (const t of all) {
      if ((++slice & 127) === 0) yield;
      const k = t.c.workstation?.kind;
      // #430: a painting canvas lying flat on the ground is drawn in chalk, stooping over it (the same paint offer and recipe)
      if (k === 'painting' || is(t, 'easel')) standSpot(t, 'paint', paintingEasel(t.def) ? { paintingTarget: t.id, ...(flatCanvas(canvasFace(t.def)) ? { ...CHALK_SPOT, ...(canvasFace(t.def)!.fadeDays ? { fadeDays: canvasFace(t.def)!.fadeDays } : {}) } : {}) } : {});
      else if (k === 'cooking' || is(t, 'stove', 'hearth')) standSpot(t, 'cook');
      else if (is(t, 'arcade-cabinet', 'pool-table', 'dartboard', 'foosball')) standSpot(t, 'play-game', {}, t.slots.find(s => s.kind === 'stand')?.id);
      // a workbench (old Eden's barn and workshop): make something by hand
      else if (is(t, 'workbench', 'sawhorse', 'pottery-wheel') || k === 'workshop' || k === 'tools') standSpot(t, 'craft');
    }
    // B2 a preparation table with a cooking pot on it (old Eden's commons kitchen tables) is a place to cook
    const potsOn = new Set(all.filter(t => t.on && is(t, 'pot', 'cooking', 'kettle')).map(t => t.on!));
    yield;
    for (const t of all) if (potsOn.has(t.id) && t.c.surface && !t.c.workstation) standSpot(t, 'cook', { label: `the cooking pot on ${this.label(t, this.place(t.at, t.level))}` });
    // B8 post letters at postboxes and mailboxes
    yield;
    for (const t of all) if (is(t, 'postbox', 'mailbox', 'post-box', 'letterbox')) standSpot(t, 'post-letter', {}, 'post');

    // B2 eat and drink: a picnic or parasol table seats its own diners; a café or dining table, the chairs round it
    for (const t of all) {
      if ((++slice & 127) === 0) yield;
      if (!t.c.surface || !(is(t, 'table', 'cafe', 'picnic-table', 'parasol-table', 'round-table', 'long-table') || t.tags.has('table'))) continue;
      if (t.c.workstation || is(t, 'school-desk', 'desk', 'office-desk', 'workbench')) continue;
      const place = this.place(t.at, t.level), face: V2 = [r2(t.at[0]), r2(t.at[1])];
      // not in a library, a classroom, an office or a study: their tables are for reading and work (old Eden: book club)
      if (/librar|classroom|school|office|study|reading|lecture/i.test(`${place ?? ''} ${place ? this.h.placeName(place) ?? '' : ''} ${t.name}`)) continue;
      if (t.slots.some(s => s.kind === 'seat')) { if (room('eat', place)) seatSpot(t, 'eat', face, { also: ['drink'], prop: 'plate' }); continue; }
      for (const s of seatsAt(t).slice(0, 2)) { if (used.has(`eat.${s.id}`) || used.has(`read.${s.id}`) || !room('eat', place)) continue; seatSpot(s, 'eat', face, { also: ['drink'], label: `${this.label(t, place)}` }); }
    }

    // B3 the piano from its own bench; a stage: the microphone at its centre and a band behind; audience seats facing it
    for (const t of all) if (t.c.instrument?.kind === 'piano' || is(t, 'piano')) {
      if ((++slice & 127) === 0) yield;
      if (t.slots.some(s => s.kind === 'seat')) seatSpot(t, 'play-piano', undefined, { instrument: 'piano' }); else standSpot(t, 'play-piano', { instrument: 'piano' });
    }
    // entry 26: a drum kit with its own stool is played sitting on it (the stage's drummer sits too)
    for (const t of all) if (t.c.instrument?.kind === 'drums' && t.slots.some(s => s.kind === 'seat')) seatSpot(t, 'play-music', undefined, { instrument: 'drums' });
    for (const t of all) {
      if ((++slice & 127) === 0) yield;
      const inst = INSTRUMENT_TAGS.find(([tag]) => t.tags.has(tag));
      if (inst) standSpot(t, 'play-music', { instrument: inst[1] });
      // entry 36: a mic stand (core/mic-stand) has its singer's place and sings along with the music playing within 12 m
      if (is(t, 'microphone', 'mic-stand')) standSpot(t, 'sing', t.c.instrument?.kind === 'mic' ? { accompany: 12 } : {}, t.c.instrument?.kind === 'mic' ? 'singer' : undefined);
    }
    for (const t of all) {
      if ((++slice & 127) === 0) yield;
      if (!t.c.venue) continue;
      const floorY = Number(t.c.floor?.y ?? 0), level = floorY > 0.3 ? this.h.levelAt(t.at[0], t.at[1], t.y + floorY) : t.level, place = this.place(t.at, t.level);
      const on = (l: V2): V2 => this.world(t, l), stage = is(t, 'stage', 'bandstand');
      if (stage) {
        const hw = t.size[0] / 2, hd = t.size[2] / 2, front: V2 = this.world(t, [0, hd + 6]);
        add({ id: `sing.${t.id}`.toLowerCase(), activity: 'sing', base: 'idle', at: on([0, Math.min(0.5, hd - 0.6)]), faceTo: front, label: `the microphone on ${this.label(t, place)}`, ...(place ? { place } : {}), ...(level ? { level } : {}) });
        for (const [k, inst, x] of [['guitar', 'guitar', -0.45], ['keyboard', 'keyboard', 0], ['drums', 'drums', 0.45]] as const)
          add({ id: `play-music.${t.id}.${k}`.toLowerCase(), activity: 'play-music', base: inst === 'drums' ? 'sit' : 'idle', at: on([r2(x * hw), r2(-hd * 0.45)]), faceTo: front, instrument: inst, label: `the ${inst} on ${this.label(t, place)}`, ...(place ? { place } : {}), ...(level ? { level } : {}) });
      }
      // the audience: free seats in front of it (its +z side), nearest first
      const fp = this.world(t, [0, 1]), fwd: V2 = [fp[0] - t.at[0], fp[1] - t.at[1]];
      const crowd = seats.filter(s => s.level === t.level && d2(s.at, t.at) <= AUDIENCE_RADIUS && ((s.at[0] - t.at[0]) * fwd[0] + (s.at[1] - t.at[1]) * fwd[1]) > 1).sort((a, b) => d2(a.at, t.at) - d2(b.at, t.at) || (a.id < b.id ? -1 : 1));
      let n = 0; for (const s of crowd) { if (n >= PER_PLACE.listen) break; if (used.has(`read.${s.id}`) || used.has(`eat.${s.id}`)) continue; seatSpot(s, 'listen', [r2(t.at[0]), r2(t.at[1])], { label: `a seat facing ${this.label(t, place)}` }); n++; }
    }

    // B9 talks and classes: the classroom's teacher desk, a lectern or a podium is where a resident gives a talk or a
    // lesson; the seats of that room (or facing the podium) attend it, once someone is giving it
    for (const t of all) {
      if ((++slice & 127) === 0) yield;
      const at0 = this.place(t.at, t.level), pname = at0 ? this.h.placeName(at0) ?? '' : '';
      const front = is(t, 'podium', 'lectern') || (/teacher/i.test(t.name) && /classroom|lecture|school/i.test(`${pname} ${at0 ?? ''}`));
      if (!front) continue;
      const at = this.standAt(t, t.slots.find(s => s.kind === 'stand')?.id); if (!at) continue;
      const place = this.place(at, t.level), id = `lecture.${t.id}`.toLowerCase(), face: V2 = this.world(t, [0, t.size[2] / 2 + 6]);
      add({ id, activity: 'lecture', base: 'idle', at, faceTo: is(t, 'podium', 'lectern') ? this.world(t, [0, 6]) : face, label: this.label(t, place), ...(place ? { place } : {}), ...(t.level ? { level: t.level } : {}) });
      // no seats through walls: a podium in a building room seats only that room; one in the open seats only the open
      // (a place id with a dot is a room of a building, e.g. g-cliff-house-15.kitchen; 2026-10-22 chapel lectern found 11 there)
      const sameSide = (p?: string, q?: string) => p === q || (!p?.includes('.') && !q?.includes('.'));
      const room = place && /classroom|lecture|school|hall/i.test(`${place} ${this.h.placeName(place) ?? ''}`) ? place : undefined;
      const fp = this.world(t, [0, 1]), fwd: V2 = [fp[0] - t.at[0], fp[1] - t.at[1]];
      const audience = seats.filter(s => s.level === t.level && (room ? this.place(s.at, s.level) === room : sameSide(this.place(s.at, s.level), place) && d2(s.at, t.at) <= AUDIENCE_RADIUS && ((s.at[0] - t.at[0]) * fwd[0] + (s.at[1] - t.at[1]) * fwd[1]) > 1))
        .sort((a, b) => d2(a.at, t.at) - d2(b.at, t.at) || (a.id < b.id ? -1 : 1)).slice(0, 12);
      for (const s of audience) seatSpot(s, 'attend', [r2(at[0]), r2(at[1])], { requires: id, label: `a seat at ${this.label(t, place)}` });
    }
    // B5 the playground and the gym and courts the god put up (tags say which apparatus)
    for (const t of all) {
      if ((++slice & 127) === 0) yield;
      if (is(t, 'swings') && t.slots.some(s => s.kind === 'seat')) seatSpot(t, 'swing', undefined);
      if (is(t, 'see-saw') && t.slots.some(s => s.kind === 'seat')) seatSpot(t, 'seesaw', undefined, { together: { group: `seesaw-${t.id}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80), need: 1, wait: TOGETHER_WAIT, alone: 'fail' } });
      for (const [tag, activity, base] of APPARATUS) if (t.tags.has(tag)) {
        if (base === 'lie') { const h = Number(t.c.seat?.height ?? t.size[1]); const at = this.standAt(t); if (!at) continue; const place = this.place(t.at, t.level);
          add({ id: `${activity}.${t.id}`.toLowerCase(), activity, base: 'lie', at: [r2(t.at[0]), r2(t.at[1])], seatHeight: Math.min(1.2, Math.max(0.2, h)), ...(activity === 'yoga' ? { also: ['pushups'] } : {}), label: this.label(t, place), ...(place ? { place } : {}) }); }
        else standSpot(t, activity);
      }
      if (t.tags.has('garden-bed') || kindOf(t) === 'garden-bed') standSpot(t, 'garden');
    }
    // B5 courts: a volleyball net gives two places a side; a pétanque piste two throwing places at one end
    for (const t of all) {
      if ((++slice & 127) === 0) yield;
      const place = this.place(t.at, t.level);
      if (t.tags.has('volleyball-net')) for (const [k, l, f] of [['a1', [-1.5, -3], [-1.5, 3]], ['a2', [1.5, -3], [1.5, 3]], ['b1', [-1.5, 3], [-1.5, -3]], ['b2', [1.5, 3], [1.5, -3]]] as const)
        add({ id: `play-volleyball.${t.id}.${k}`.toLowerCase(), activity: 'play-volleyball', base: 'idle', at: this.world(t, l as unknown as V2), faceTo: this.world(t, f as unknown as V2), label: this.label(t, place), ...(place ? { place } : {}) });
      if (t.tags.has('petanque')) for (const [k, x] of [['a', -0.6], ['b', 0.6]] as const)
        add({ id: `play-petanque.${t.id}.${k}`.toLowerCase(), activity: 'play-petanque', base: 'idle', at: this.world(t, [x, -t.size[2] / 2 + 0.6]), faceTo: this.world(t, [x, t.size[2] / 2]), label: this.label(t, place), ...(place ? { place } : {}) });
    }
    yield* this.groupLife(all, seats, add, seatSpot, standSpot);
    yield* this.grounds(add);
    return { contract: 'activity-spots/1', spots, shelves, interiors: [], solids: [], rings: [], platforms: [], nearest: NEAREST };
  }

  /** R5 group life on god things: stories round a campfire, book club at library tables, cooking together at prep
   *  tables, dancing on a bandstand, a yoga class round the lawn mat; and hammocks. Done together (Spot.together). */
  private *groupLife(all: Thing[], seats: Thing[], add: (s: Spot) => void, seatSpot: (seat: Thing, activity: string, faceTo: V2 | undefined, extra?: Partial<Spot>) => void, standSpot: (t: Thing, activity: string, extra?: Partial<Spot>, slot?: string) => void): Generator<void, void> {
    let slice = 0;
    const grp = (k: string) => k.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80);
    const potOn = new Set(all.filter(o => o.on !== undefined && is(o, 'pot', 'cooking')).map(o => o.on!));
    for (const t of all) {
      if ((++slice & 127) === 0) yield;
      const place = this.place(t.at, t.level);
      // a campfire with seats: one storyteller's place by the fire, its seats listen (once the story has started)
      if (t.slots.some(q => q.kind === 'fire-circle') && t.slots.some(q => q.kind === 'seat')) {
        const ring = t.slots.find(q => q.kind === 'fire-circle')!, at = this.world(t, ring.local), id = `tell-story.${t.id}`.toLowerCase(), together = { group: grp(`story-${t.id}`), need: 1, wait: TOGETHER_WAIT, alone: 'fail' as const };
        add({ id, activity: 'tell-story', base: 'idle', at, faceTo: [r2(t.at[0]), r2(t.at[1])], label: `the storyteller's place at ${this.label(t, place)}`, together, ...(place ? { place } : {}) });
        t.slots.filter(q => q.kind === 'seat').slice(0, 3).forEach((q, k) => add({ id: `hear-story.${t.id}.${k}`.toLowerCase(), activity: 'hear-story', base: 'sit', at: this.world(t, q.local), seat: t.id, faceTo: [r2(t.at[0]), r2(t.at[1])], requires: id, together, label: `a log at ${this.label(t, place)}`, ...(place ? { place } : {}) }));
      }
      // a bandstand: four places on its floor for dancing together (starts after 45 s with whoever came)
      if (/bandstand/i.test(t.name) || t.tags.has('bandstand')) {
        const floorY = Number(t.c.floor?.y ?? 0), level = floorY > 0.3 ? this.h.levelAt(t.at[0], t.at[1], t.y + floorY) : 0;
        ([[-1.2, 0], [1.2, 0], [0, -1.2], [0, 1.2]] as V2[]).forEach((l, k) => add({ id: `social-dance.${t.id}.${k}`.toLowerCase(), activity: 'social-dance', base: 'idle', at: this.world(t, l), faceTo: [r2(t.at[0]), r2(t.at[1])], together: { group: grp(`dance-${t.id}`), need: 1, wait: 45, alone: 'start' }, label: `the dance floor of ${this.label(t, place)}`, ...(place ? { place } : {}), ...(level ? { level } : {}) }));
      }
      // a library's reading table: a book club round it (the chairs beside it)
      if (t.c.surface && t.tags.has('table') && place && /librar|reading/i.test(`${place} ${this.h.placeName(place) ?? ''}`)) {
        const round = seats.filter(q => q.level === t.level && d2(q.at, t.at) <= Math.hypot(t.size[0], t.size[2]) / 2 + 1).slice(0, 4);
        for (const q of round) seatSpot(q, 'book-club', [r2(t.at[0]), r2(t.at[1])], { prop: 'book', together: { group: grp(`book-club-${t.id}`), need: 1, wait: TOGETHER_WAIT, alone: 'fail' }, label: `${this.label(t, place)} (book club)` });
      }
      // a preparation table with a pot: two cooks together
      if (t.c.surface && !t.c.workstation && potOn.has(t.id)) {
        ([[-0.5, 1], [0.5, 1]] as V2[]).forEach((l, k) => { const at = this.world(t, [l[0], t.size[2] / 2 + 0.45]); add({ id: `cook-together.${t.id}.${k}`.toLowerCase(), activity: 'cook-together', base: 'idle', at, faceTo: [r2(t.at[0]), r2(t.at[1])], together: { group: grp(`cooks-${t.id}`), need: 1, wait: TOGETHER_WAIT, alone: 'fail' }, label: `${this.label(t, place)} (cooking together)`, ...(place ? { place } : {}) }); });
      }
      // the lawn's yoga mat: the teacher's place and two rows of six for a class
      if (t.tags.has('yoga-mat')) {
        const together = { group: grp(`yoga-${t.id}`), need: 1, wait: TOGETHER_WAIT, alone: 'fail' as const }, face = this.world(t, [0, -3]);
        add({ id: `yoga-class.${t.id}.front`.toLowerCase(), activity: 'yoga-class', base: 'idle', at: this.world(t, [0, 0]), faceTo: this.world(t, [0, 4]), together, label: `the teacher's mat (${this.label(t, place)})`, ...(place ? { place } : {}) });
        for (const [k, l] of ([[-2, 2.6], [0, 2.6], [2, 2.6], [-2, 5], [0, 5], [2, 5]] as V2[]).entries()) add({ id: `yoga-class.${t.id}.${k}`.toLowerCase(), activity: 'yoga-class', base: 'idle', at: this.world(t, l), faceTo: face, together, label: `a mat in the yoga class (${this.label(t, place)})`, ...(place ? { place } : {}) });
      }
      // a picnic blanket: four places round it, sitting on the blanket (old Eden: picnic spots at seat height 0.2)
      if (t.tags.has('picnic-blanket')) ([[0, -0.85], [0.85, 0], [0, 0.85], [-0.85, 0]] as V2[]).forEach((l, k) => add({ id: `picnic.${t.id}.${k}`.toLowerCase(), activity: 'picnic', base: 'sit', at: this.world(t, l), faceTo: [r2(t.at[0]), r2(t.at[1])], seatHeight: 0.2, label: this.label(t, place), ...(place ? { place } : {}) }));
      // a hammock: lie in it (its cloth at the bed slot's height)
      if (is(t, 'hammock')) { const h = 0.62; add({ id: `hammock.${t.id}`.toLowerCase(), activity: 'hammock', base: 'lie', at: [r2(t.at[0]), r2(t.at[1])], seatHeight: h, label: this.label(t, place), ...(place ? { place } : {}) }); }
    }
    void standSpot;
  }

  /** Areas and paths the god laid out: garden beds to tend, a pier to fish and feed the ducks from, a pitch to throw a
   *  frisbee on. Read from the entity world (they are ground, not engine fixtures). */
  private *grounds(add: (s: Spot) => void): Generator<void, void> {
    let slice = 0;
    const m = this.h.model, creatures: V2[] = [];
    const kinds = new Map<string, string>();
    yield;
    for (const e of m.entities.values()) { const d = m.resolvedDef(e.def); const k = d ? ['duck', 'swan', 'koi', 'goose'].find(x => d.tags.includes(x) || d.name.includes(x)) : undefined; if (k) { const wp = m.worldPose(e); creatures.push([wp.x, wp.z]); kinds.set(`${Math.round(wp.x)},${Math.round(wp.z)}`, k); } }
    const kindAt = (q: V2) => kinds.get(`${Math.round(q[0])},${Math.round(q[1])}`) ?? 'fish';
    for (const e of m.entities.values()) {
      if ((++slice & 127) === 0) yield;
      if (e.in.parent !== 'world' || !e.shape) continue;
      const def = m.resolvedDef(e.def); if (!def) continue;
      const sh = e.shape as { area?: V2[]; path?: V2[] }, kind = def.name.replace(/^core-/, ''), name = (e.name ?? kind).replace(/-/g, ' ');
      if ((kind === 'garden-bed' || def.tags.includes('garden') && def.components.plant) && sh.area?.length) {
        const c = centroidOf(sh.area), place = this.place(c, 0);
        add({ id: `garden.${e.id}`.toLowerCase(), activity: 'garden', base: 'idle', at: [r2(c[0]), r2(c[1])], faceTo: [r2(c[0]), r2(c[1] + 1)], label: `${name}${place ? ` in ${this.h.placeName(place) ?? place}` : ''}`, ...(place ? { place } : {}) });
      }
      if (kind === 'pier' && sh.path && sh.path.length >= 2) {
        const a = sh.path[sh.path.length - 2], b = sh.path[sh.path.length - 1], L = d2(a, b) || 1, dir: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        const at: V2 = [r2(b[0] - dir[0] * 0.8), r2(b[1] - dir[1] * 0.8)], face: V2 = [r2(b[0] + dir[0] * 3), r2(b[1] + dir[1] * 3)], place = this.place(at, 0);
        const feed = creatures.some(q => d2(q, at) <= 40);
        add({ id: `fish.${e.id}`.toLowerCase(), activity: 'fish', base: 'idle', at, faceTo: face, ...(feed ? { also: ['feed'] } : {}), label: `the end of ${name}`, ...(place ? { place } : {}) });
      }
      // a pond or lake with ducks, swans or koi in it: feed them (and fish) from the bank nearest them
      if (sh.area?.length && (['pond', 'lake'].includes(kind) || def.tags.includes('pond'))) {
        const poly = sh.area, inside = creatures.filter(q => inPolygon(q, poly) || poly.some(v => d2(v, q) < 4));
        if (inside.length) {
          const cc = centroidOf(inside), pc = centroidOf(poly);
          // perimeter position of the bank point nearest the creatures (arc length from poly[0])
          const seg = poly.map((a, i) => d2(a, poly[(i + 1) % poly.length])), per = seg.reduce((x, y) => x + y, 0);
          let best: V2 = poly[0], bd = Infinity, bs = 0;
          for (let i = 0, s0 = 0; i < poly.length; s0 += seg[i], i++) { const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((cc[0] - a[0]) * dx + (cc[1] - a[1]) * dz) / L)), q: V2 = [a[0] + dx * t, a[1] + dz * t]; if (d2(q, cc) < bd) { bd = d2(q, cc); best = q; bs = s0 + t * seg[i]; } }
          const pointAt = (s: number): V2 => { s = ((s % per) + per) % per; for (let i = 0; i < poly.length; i++) { if (s <= seg[i] || i === poly.length - 1) { const a = poly[i], b = poly[(i + 1) % poly.length], t = seg[i] ? Math.min(1, s / seg[i]) : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; } s -= seg[i]; } return poly[0]; };
          const what = [...new Set(inside.map(kindAt))].map(k => (k === 'goose' ? 'geese' : k === 'koi' || k === 'fish' ? k : `${k}s`)).join(' and ');
          // old Eden fed its ducks from several places on a bank (2 at the shore pond, 3 at the park pond): one spot per creature,
          // up to 3, FEED_GAP metres apart along the bank on either side of the nearest point, so residents can feed together
          const n = Math.min(3, inside.length, Math.max(1, Math.floor(per / (FEED_GAP * 2))));
          [0, FEED_GAP, -FEED_GAP].slice(0, n).forEach((off, k) => {
            const q = off ? pointAt(bs + off) : best, out: V2 = [q[0] - pc[0], q[1] - pc[1]], m = Math.hypot(out[0], out[1]) || 1, at: V2 = [r2(q[0] + out[0] / m * 1.6), r2(q[1] + out[1] / m * 1.6)], place = this.place(at, 0);
            add({ id: `feed.${e.id}${k ? `.${k}` : ''}`.toLowerCase(), activity: 'feed', base: 'idle', at, faceTo: [r2(cc[0]), r2(cc[1])], also: ['fish'], title: `Feed the ${what}`, label: `the bank of ${name}`, ...(place ? { place } : {}) });
          });
        }
      }
      if ((kind === 'football-pitch' || kind === 'pitch') && sh.area?.length) {
        const c = centroidOf(sh.area), xs = sh.area.map(p => p[0]), zs = sh.area.map(p => p[1]), alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
        const off = Math.min(12, (alongX ? Math.max(...xs) - Math.min(...xs) : Math.max(...zs) - Math.min(...zs)) / 4), place = this.place(c, 0);
        const ends: V2[] = alongX ? [[c[0] - off, c[1]], [c[0] + off, c[1]]] : [[c[0], c[1] - off], [c[0], c[1] + off]];
        ends.forEach((at, k) => add({ id: `play-frisbee.${e.id}.${k}`.toLowerCase(), activity: 'play-frisbee', base: 'idle', at: [r2(at[0]), r2(at[1])], faceTo: [r2(ends[1 - k][0]), r2(ends[1 - k][1])], label: `${name} (frisbee)`, ...(place ? { place } : {}) }));
      }
    }
  }
}

/** Metres along a pond bank between the feeding places. */
const FEED_GAP = 4;
/** Def tags that name a playable instrument (the body pose draws it). */
const INSTRUMENT_TAGS: [string, string][] = [['drum-kit', 'drums'], ['drums', 'drums'], ['guitar', 'guitar'], ['bass-guitar', 'bass'], ['violin', 'violin'], ['cello', 'cello'], ['keyboard-stand', 'keyboard'], ['flute', 'flute'], ['ukulele', 'ukulele']];
/** Def tags of gym apparatus and the activity done at it (lying ones on its top). */
const APPARATUS: [string, string, 'idle' | 'lie'][] = [['pull-up-bar', 'pull-ups', 'idle'], ['dip-bars', 'dips', 'idle'], ['weight-bench', 'bench-press', 'lie'], ['dumbbells', 'lift-weights', 'idle'], ['yoga-mat', 'yoga', 'lie'], ['exercise-mat', 'situps', 'lie']];
