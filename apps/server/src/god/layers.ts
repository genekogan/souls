// LAYERS (2026-10-11): what Souls perceive and do with a god world's invisible systems (the data and its validation
// live in @sim/world-compiler: layers.ts, the set/economy/mint/pay/relate ops). This module reads them for Souls and
// drives them with the world clock:
//
//  - schedules: each scheduled thing's place carries today's slots (the ledger's place schedule: `whatson`, observe's
//    happenings), its events go on the calendar (`/v1/edge/calendar`, reminders to the interested), and states that
//    follow the schedule change as engine edits when the clock crosses a boundary (a door unlocks at opening time);
//  - ownership: "yours / Ana's / public" on things Souls see; private things refuse other Souls' actuators, seats and
//    hands (the owner, the owner group's members and those who work at it may);
//  - land use: zones are places (places.ts names their kind "commercial zone"); `zoneSuggest` recommends catalogue
//    categories for a use;
//  - relationships: a Soul reads its own (`GET /v1/world/layers/me`), places say who works or lives there;
//  - economy: `buy:<id>` (pay the owner its price; a thing becomes the buyer's, a service stays), `pay:<soul>` and
//    `sell:<id>` capabilities, validated by the compiler (never below zero), journaled as engine edits.
//
// Nothing here acts on a world whose god never used a layer: no schedules → the clock step returns at once; no prices
// → no buy capability; no owners → no refusals.
import { clockAt } from '@sim/brain';
import { describeSchedule, followPatch, minutesOf, scheduleSlots, isOpen, eventsOn, type Entity, type Op, type Result, type Schedule, type WorldModel } from '@sim/world-compiler';
import type { EdgeCapability, EdgeSoul } from '../edge/contract.ts';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import { hashOf } from '@sim/world-compiler';
import { ApiError } from '../souls.ts';
import type { Objects } from '../edge/comms/objects/framework.ts';
import { isVerificationProbe } from '../verification-probe.ts';
import { inClosure, type ClosingSite } from './builds.ts';
import { EventSets } from './event-sets.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Refusal = { code: string; reason: string };
type Plans = Map<string, { label: string; steps: { verb: string; params: Record<string, unknown> }[]; seconds?: boolean }>;

/** DEFER (2026-10-11, PM brief 37 item 4): the default experience has no economy and no god-set relationships. The
 *  code stays; its Soul-facing verbs (buy/sell/pay), perception (prices, wallets, who works or lives where) and the god's
 *  economy/mint/pay/relate ops and prices only exist in a world that opts in: env LAYERS=1 for that world's process.
 *  Schedules, ownership and zones are always on. */
export const economyOn = (): boolean => process.env.LAYERS === '1';
/** The god ops (and fields) only an opted-in world accepts; null when the batch is fine. */
export function deferredOp(batch: unknown): { op: number; code: string; detail: string } | null {
  if (economyOn()) return null;
  const ops = (batch as { ops?: unknown[] })?.ops; if (!Array.isArray(ops)) return null;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i] as Record<string, any> | null; if (!o || typeof o !== 'object') continue;
    if (['economy', 'mint', 'pay', 'relate'].includes(o.op)) return { op: i, code: 'layers.deferred', detail: `\`${o.op}\`: this world has no economy or god-set relationships (deferred; a world opts in with LAYERS=1). Schedules, ownership and zones work.` };
    if ((o.price != null) || (o.layers?.price != null)) return { op: i, code: 'layers.deferred', detail: 'prices: this world has no economy (deferred; a world opts in with LAYERS=1). Schedules, ownership and zones work.' };
  }
  return null;
}

/** Souls trade with things within this distance (m). */
export const TRADE_REACH = 30;
/** Calendar items are posted this many world minutes ahead. */
const CAL_HORIZON = 24 * 60;
// Reserved schedule-projection namespace plus its author marker: never prune steward/native calendar objects.
const godCalendar = (o: { id: string; kind: string; state: unknown }) => o.kind === 'calendar-item' && /^cal-g[0-9a-f]{12}$/.test(o.id) && (o.state as { proposedBy?: string } | null)?.proposedBy === 'the god of this world';
const calendarId = (entity: string, event: string, date: string) => `cal-g${hashOf([entity, event, date]).slice(0, 12)}`;
const CAL_ID = /^cal-g[0-9a-f]{12}$/;
/** Tick-thread budget for classifying calendar ids seen for the first time (a restart of a live world has 8,000+). */
const CAL_LEARN_MS = 15;
/** A god calendar item: the schedule source it projects ([entity, event] JSON), or the start tick of a pre-provenance item. */
type CalEntry = { src: string } | { startsAtTick: number } | null;
function calEntry(o: { id: string; kind: string; state: unknown }, params: Record<string, unknown> | undefined): CalEntry {
  if (!godCalendar(o)) return null;
  const source = params?.godSchedule as { entity?: string; event?: string; date?: string } | undefined;
  if (source && typeof source.entity === 'string' && typeof source.event === 'string' && typeof source.date === 'string' && calendarId(source.entity, source.event, source.date) === o.id) return { src: JSON.stringify([source.entity, source.event]) };
  return { startsAtTick: (o.state as { startsAtTick: number }).startsAtTick };
}

export type LayersHost = {
  model: WorldModel;
  edge?: EdgeLedger;
  engine: { world: { tick: number; entities: Record<string, any> } };
  /** The world clock (the host's dayConfig), or null before it runs. */
  living(): { origin: number; dayTicks: number } | null | undefined;
  engineAct(ops: Op[], note: string): Result;
  /** The place a thing is (its own, else the innermost holding it). */
  placeOf?(e: Entity): { id: string; name: string } | null;
  /** Exact currently installed authored identity for place-ID travel offers.
   * Native IDs and unknown/overridden mappings return undefined. */
  authoredPlaceRef?(id: string): string | undefined;
  /** Optional calendar-only lookup, prepared lazily when a new occurrence needs a place. */
  calendarPlaces?(sources: readonly Entity[]): (e: Entity) => { id: string; name: string } | null;
  building?: (id: string) => { id: string; title: string; step: string } | null;
  buildingActive?: () => boolean;
  closingSites?: () => ClosingSite[];
  /** Tests: the per-step budget for classifying new calendar ids (default CAL_LEARN_MS; 0 = 32 ids a step). */
  calendarLearnMs?: number;
  log(m: string): void;
};

export type WorldClock = { minute: number; weekday: number; day: string; tick: number; ticksPerMinute: number };

export class GodLayers {
  private h: LayersHost;
  private lastDay = '';
  private followed = new Map<string, string>();
  /** EVENTS: the things an event sets up while it is on (event-sets.ts). */
  readonly sets: EventSets;
  constructor(h: LayersHost) { this.h = h; this.sets = new EventSets(h); }

  private get m() { return this.h.model; }
  /** Is this world using any layer at all? (cheap) */
  active(): boolean {
    if (this.h.buildingActive?.() || this.m.state.layers) return true;
    if (this.entitiesActive()) return true;
    for (const k of this.calKnown.values()) if (k) return true; // remembered god calendar items still need their cleanup steps
    const objs = this.calendarObjects();
    return (objs?.ofKind ? objs.ofKind('calendar-item') : objs?.all())?.some(godCalendar) ?? false;
  }
  /** S1 V7d: whether an event set is in play or any entity carries a layer field, cached on the model's safety key (world-compiler model.ts: a new
   *  key whenever its entity or def maps change; untracked maps give a fresh key every call, so no caching), so an idle
   *  Eden 2026 does not walk its 4,900 entities every 2 s. With no buildingActive host the answer reads live build
   *  state, so it is never cached. */
  private entitiesSeen: { key: object; on: boolean } | null = null;
  private entitiesActive(): boolean {
    const key = this.h.buildingActive ? this.m.safetyCacheKey() : null;
    if (key && this.entitiesSeen?.key === key) return this.entitiesSeen.on;
    let on = this.sets.active();
    if (!on) for (const e of this.m.entities.values()) if (e.owner || e.schedule || e.price || e.access || (!this.h.buildingActive && this.h.building?.(e.id))) { on = true; break; }
    this.entitiesSeen = key ? { key, on } : null;
    return on;
  }
  private calendarObjects(): (Pick<Objects, 'create' | 'kindOf' | 'all' | 'remove' | 'creationParams'> & Partial<Pick<Objects, 'ofKind' | 'ids'>>) | undefined { return (this.h.edge as any)?.comms?.objects; }

  // ---------- the clock ----------

  clock(): WorldClock | null {
    const l = this.h.living(); if (!l || !(l.dayTicks > 0)) return null;
    const tick = this.h.engine.world.tick, t = clockAt(tick, l.origin, l.dayTicks);
    return { minute: t.hour * 60 + t.minute, weekday: new Date(t.datetime).getUTCDay(), day: t.datetime.slice(0, 10), tick, ticksPerMinute: l.dayTicks / 1440 };
  }
  /** Today's date changed since the last call (places carry today's slots: re-derive them). */
  dayKey(): string { return this.clock()?.day ?? ''; }

  /** One clock step (the bridge calls it every couple of seconds): states that follow schedules, calendar items. */
  step(): { changed: number; posted: number; set?: number; packed?: number } {
    const scheduled = [...this.m.entities.values()].filter((e) => e.schedule);
    const c = this.clock(); if (!c) return { changed: 0, posted: 0 };
    const sets = this.sets.active() ? this.sets.step(c) : null;
    const ops: Op[] = [], notes: string[] = [];
    for (const e of scheduled) {
      if (!e.schedule?.follow?.length) continue;
      const def = this.m.resolvedDef(e.def); if (!def) continue;
      const want = followPatch(e.schedule, c.minute, c.weekday), patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(want)) { const cur = e.state?.[k] ?? (def.state as any)[k]?.default; if (cur !== v) patch[k] = v; }
      if (!Object.keys(patch).length) continue;
      // a value the clock already set once and a Soul then changed (Ana locks up early) is left until the next boundary
      const sig = `${e.id}:${JSON.stringify(want)}`; if (this.followed.get(e.id) === sig) continue;
      this.followed.set(e.id, sig);
      ops.push({ op: 'set', id: e.id, state: patch as never } as Op);
      notes.push(`${e.name ? this.m.pathOf(e.id) : e.id} ${Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    }
    let changed = 0;
    if (ops.length) {
      const r = this.h.engineAct(ops, `schedule: ${notes.join(', ')}`.slice(0, 400));
      if (r.accepted) changed = ops.length; else this.h.log(`schedule: refused ${JSON.stringify((r as any).failures).slice(0, 300)}`);
    }
    const posted = this.postCalendar(scheduled, c);
    return { changed, posted, ...(sets && (sets.set || sets.packed) ? sets : {}) };
  }

  /** Each scheduled event within the next day goes on the calendar once (ids from the thing, the event and the date). */
  private postCalendar(scheduled: Entity[], c: WorldClock): number {
    const objs = this.calendarObjects();
    if (!objs?.kindOf('calendar-item')) return 0;
    // L4 item 0: incremental. A live Eden 2026 keeps every past occurrence (8,000+ god items, 5.6 MB of bodies); re-parsing
    // them and reading each one's creation log every 2 s cost 140-560 ms a step on the tick thread. Now only the object ids
    // are listed per step; an id seen for the first time is classified once (its body + creation provenance, a few per step
    // under CAL_LEARN_MS) and remembered. A god id's provenance is fixed by its hash (calendarId), and bodies change only
    // through remove + create, so the remembered classification stays exact while the id lives.
    const ids = (objs.ids ? objs.ids() : objs.all().map((o) => o.id)).filter((id) => CAL_ID.test(id));
    const have = new Set(ids), known = this.calKnown;
    for (const id of known.keys()) if (!have.has(id)) known.delete(id);
    const learned = this.learnCalendar(objs, ids);
    // Keep surviving sources, including their interest/reminder state. New entries carry private provenance
    // in the existing creation log, so changing the clock does not change their identity. Pre-fix entries
    // have only startsAtTick; retain the old deterministic date fallback for those records.
    const liveEvents = new Set(scheduled.flatMap(e => (e.schedule?.events ?? []).map(ev => JSON.stringify([e.id, ev.name]))));
    const living = this.h.living()!, legacyDates = new Set<string>(), keep = new Set<string>();
    for (const [id, k] of known) {
      if (!k) continue;
      if ('src' in k) { if (liveEvents.has(k.src)) keep.add(id); } else legacyDates.add(clockAt(k.startsAtTick, living.origin, living.dayTicks).datetime.slice(0, 10));
    }
    for (const e of scheduled) for (const ev of e.schedule?.events ?? []) for (const date of legacyDates) keep.add(calendarId(e.id, ev.name, date));
    let posted = 0, placeOf: LayersHost['placeOf'];
    for (const e of scheduled) for (const ev of e.schedule?.events ?? []) {
      const at = minutesOf(ev.at);
      for (const dayAhead of [0, 1]) {
        const until = at - c.minute + dayAhead * 1440; if (until < -ev.minutes || until > CAL_HORIZON) continue;
        const weekday = (c.weekday + dayAhead) % 7; if (ev.days?.length && !ev.days.includes((['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[weekday])) continue;
        const date = new Date(Date.parse(c.day + 'T00:00:00Z') + dayAhead * 86400_000).toISOString().slice(0, 10);
        const id = calendarId(e.id, ev.name, date); keep.add(id); if (have.has(id)) continue;
        placeOf ??= this.h.calendarPlaces?.(scheduled) ?? this.h.placeOf?.bind(this.h);
        const place = placeOf?.(e), title = (ev.label ?? ev.name).slice(0, 80);
        try {
          const params = { godSchedule: { entity: e.id, event: ev.name, date }, title, description: `${title} at ${place?.name ?? this.m.pathOf(e.id)}, ${ev.at} for ${ev.minutes} minutes (the god's schedule)`, placeId: place?.id ?? '', placeName: place?.name ?? this.m.pathOf(e.id), proposedBy: 'the god of this world', startsAtTick: Math.round(c.tick + until * c.ticksPerMinute), durationTicks: Math.max(1, Math.round(ev.minutes * c.ticksPerMinute)) };
          const o = objs.create({ id, kind: 'calendar-item', name: title, placeId: place?.id ?? 'world', params });
          posted++; have.add(id); ids.push(id); known.set(id, calEntry(o, params));
        } catch (err) { this.h.log(`calendar ${id}: ${(err as Error).message}`); }
      }
    }
    // Until every listed id is classified, nothing is pruned (an unclassified id might be one to keep).
    if (learned) for (const id of ids) if (known.get(id) && !keep.has(id)) { objs.remove(id); known.delete(id); }
    return posted;
  }
  /** Classified god calendar ids (see postCalendar); null = an id in the namespace that is not a god projection. */
  private calKnown = new Map<string, CalEntry>();
  /** Bodies read for ids still being classified (one kind read, dropped when all are known). */
  private calBodies: Map<string, { id: string; kind: string; state: unknown }> | null = null;
  /** Classify ids not seen before, within CAL_LEARN_MS; true when every id in `ids` is known. */
  private learnCalendar(objs: NonNullable<ReturnType<GodLayers['calendarObjects']>>, ids: string[]): boolean {
    const known = this.calKnown, t0 = performance.now();
    const read = () => new Map((objs.ofKind ? objs.ofKind('calendar-item') : objs.all()).map((o) => [o.id, o] as const));
    let n = 0, reread = false;
    for (const id of ids) {
      if (known.has(id)) continue;
      if (n++ % 32 === 31 && performance.now() - t0 >= (this.h.calendarLearnMs ?? CAL_LEARN_MS)) return false;
      this.calBodies ??= (reread = true, read());
      let o = this.calBodies.get(id);
      // an id created after the bodies were read (while a restart's backlog is classified over several steps)
      if (!o && !reread) { this.calBodies = read(); reread = true; o = this.calBodies.get(id); }
      known.set(id, o && godCalendar(o) ? calEntry(o, objs.creationParams(id)) : null);
    }
    this.calBodies = null;
    return true;
  }

  /** EVENTS: "Saturday market is on here now (3 market stalls and a banner set up, until 13:00)" (places.ts leads with it). */
  onNow(e: Entity): string { return this.sets.onNow(e, this.clock()); }
  /** L4 item 5: the things whose layer tag a build event may have changed: layered things under a closing site now, or at
   *  the last call (a closure that ended). Everything else's perceived object cannot move with a build event. */
  buildRetag(): string[] {
    const now = new Set<string>();
    if (this.h.building) for (const e of this.m.entities.values()) if ((e.owner || e.access || e.price || e.schedule) && this.h.building(e.id)) now.add(e.id);
    const out = new Set([...now, ...this.underBuild]); this.underBuild = now; return [...out];
  }
  private underBuild = new Set<string>();
  /** Today's place schedule slots for a thing (places.ts adds them to its place). */
  slotsFor(e: Entity, label: string) { const c = this.clock(); return e.schedule ? scheduleSlots(e.schedule, c?.weekday ?? 6, label) : []; }
  /** "open 07:00–15:00 (open now)". */
  hoursOf(s: Schedule | undefined): string {
    if (!s) return ''; const c = this.clock(), d = describeSchedule(s); if (!c || !s.open?.length) return d;
    const on = eventsOn(s, c.minute, c.weekday).map((x) => x.label);
    return `${d} (${isOpen(s, c.minute, c.weekday) ? 'open now' : 'closed now'}${on.length ? `; ${on.join(', ')} on now` : ''})`;
  }

  // ---------- who ----------

  private minds(): Map<string, { soulId: string; entityId: string; name: string }> { return ((this.h.edge as any)?.host?.minds ?? new Map()) as never; }
  /** A display name: "the god", "Ana", "the bakers". */
  nameOf(ref: string | undefined): string {
    if (!ref || ref === 'god') return 'the god';
    if (ref.startsWith('group:')) return `the ${ref.slice(6)}`;
    if (ref.startsWith('thing:')) { const e = this.m.entities.get(ref.slice(6)); return e ? this.m.pathOf(e.id) : ref.slice(6); }
    const k = ref.slice(5), m = this.minds().get(k); if (m) return m.name;
    for (const x of this.minds().values()) if (x.name.toLowerCase() === k.toLowerCase()) return x.name;
    return k;
  }
  /** Does this owner ref name this Soul (by id, or by name), or a group it is a member of? */
  isOf(ref: string | undefined, soul: { soulId: string; name: string }): boolean {
    if (!ref) return false;
    if (ref === `soul:${soul.soulId}` || ref.toLowerCase() === `soul:${soul.name.toLowerCase()}`) return true;
    if (ref.startsWith('group:')) return this.relations().some((r) => r.rel === 'member-of' && r.b === ref && this.isOf(r.a, soul));
    return false;
  }
  /** The wallet key of a Soul: its id (a name-keyed wallet the god minted before the Soul existed is merged on use). */
  walletOf(soul: { soulId: string; name: string }): { key: string; amount: number; alias?: string } {
    const w = this.m.state.layers?.wallets ?? {}, key = `soul:${soul.soulId}`;
    const alias = Object.keys(w).find((k) => k !== key && k.toLowerCase() === `soul:${soul.name.toLowerCase()}`);
    return { key, amount: (w[key] ?? 0) + (alias ? w[alias] : 0), ...(alias ? { alias } : {}) };
  }
  relations() { return this.m.state.layers?.relations ?? []; }
  /** The Souls of this world (id, name): the god's CLI names them. */
  souls() { return [...this.minds().values()].map((x) => ({ id: x.soulId, name: x.name })); }
  currency() { return this.m.state.layers?.currency ?? 'coins'; }
  money(n: number) { return `${n} ${this.currency()}`; }

  /** Owner and access of a thing: its own, else its nearest owned ancestor's. */
  ownership(id: string): { owner?: string; access: 'public' | 'private'; from: string } | null {
    for (let e = this.m.entities.get(id); e; e = e.in.parent === 'world' ? undefined : this.m.entities.get(e.in.parent)) {
      if (e.owner || e.access) return { ...(e.owner ? { owner: e.owner } : {}), access: e.access ?? 'public', from: e.id };
    }
    return null;
  }
  /** Can this Soul use (open, sit on, take) this thing? Owners, owner-group members and those who work at it may. */
  refusal(id: string, soul: { soulId: string; name: string }): Refusal | null {
    const building = this.buildingRefusal(id, soul); if (building) return building;
    const o = this.ownership(id); if (!o || o.access !== 'private') return null;
    if (this.isOf(o.owner, soul)) return null;
    if (this.relations().some((r) => r.rel === 'works-at' && this.isOf(r.a, soul) && (r.b === `thing:${o.from}` || r.b === `thing:${id}`))) return null;
    const what = this.m.entities.get(id)?.name ? this.m.pathOf(id) : 'That';
    return { code: 'object.private', reason: `${what} is ${o.owner ? `${this.nameOf(o.owner)}'s` : 'not yours'} and private.` };
  }
  private buildingRefusal(id: string, soul: { soulId: string }): Refusal | null {
    if (isVerificationProbe(soul.soulId)) return null;
    const b = this.h.building?.(id);
    return b ? { code: 'site.under-construction', reason: `${this.m.pathOf(id)} is under construction (${b.title}: ${b.step}); come back when it is finished.` } : null;
  }
  /** Raw intents and offered plans share the same construction boundary, including coordinate destinations. */
  constructionRefusal(soul: EdgeSoul, steps: { verb: string; params: Record<string, unknown> }[], target?: string, sites = this.h.closingSites?.() ?? []): Refusal | null {
    if (isVerificationProbe(soul.soulId)) return null;
    const member = target ? this.buildingRefusal(target, soul) : null; if (member) return member;
    for (const step of steps) {
      if (step.verb !== 'walk_to' && step.verb !== 'mars:walk_to') continue;
      const p = step.params, to = p.to;
      const entity = typeof to === 'string' ? this.m.get(to)?.id ?? to : undefined;
      const blocked = entity ? this.buildingRefusal(entity, soul) : null; if (blocked) return blocked;
      const pose = entity ? this.h.engine.world.entities[entity]?.pose.p : undefined;
      const at: Vec2 | undefined = Array.isArray(to) ? [Number(to[0]), Number(to[1])] : pose ? [pose[0], pose[2]] : typeof p.x === 'number' && typeof p.z === 'number' ? [p.x, p.z] : undefined;
      const site = at && sites.find(s => inClosure(s, at));
      if (site) return { code: 'site.under-construction', reason: `${site.id} is under construction; come back when it is finished.` };
    }
    return null;
  }
  /** "yours" / "Ana's" / "the bakers'" / "public" for a viewer. */
  ownerWord(id: string, soul?: { soulId: string; name: string }): string | null {
    const o = this.ownership(id); if (!o) return null;
    if (!o.owner) return o.access === 'private' ? 'private' : 'public';
    if (soul && this.isOf(o.owner, soul) && !o.owner.startsWith('group:')) return 'yours';
    const n = this.nameOf(o.owner); return `${n}${n.endsWith('s') ? "'" : "'s"}${o.access === 'private' ? ', private' : ''}`;
  }
  /** What a thing's public description adds: "Ana's; 3 coins; open 07:00–15:00". */
  tag(e: Entity): string {
    const parts: string[] = [];
    const b = this.h.building?.(e.id); if (b) parts.push(`under construction (${b.step})`);
    if (e.owner || e.access) { const w = this.ownerWord(e.id); if (w) parts.push(w); }
    if (e.price && economyOn()) parts.push(e.price.service ? `${e.price.service} for ${this.money(e.price.amount)}` : `for sale: ${this.money(e.price.amount)}`);
    if (e.schedule) { const d = describeSchedule(e.schedule); if (d) parts.push(d); }
    return parts.join('; ');
  }

  // ---------- Soul capabilities and acts ----------

  /** `offers` false (a focused build that names no buy/pay): the refusals on `caps` only, no economy offers listed. */
  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Plans, here: Vec2 | null, offers = true) {
    const sites = this.h.closingSites?.() ?? [];
    // ownership on the bridge's own caps: seats, hands and surfaces of private things
    for (const c of caps) {
      const target = c.target && this.m.entities.has(c.target.id) ? c.target.id : undefined;
      const construction = this.constructionRefusal(soul, plans.get(c.id)?.steps ?? [], target, sites);
      if (construction) { c.available = false; c.blocked = construction; plans.delete(c.id); continue; }
      // a walk into a private building or room of someone else's (walk:ana-house, walk:ana-house/living)
      if (['walk', 'hang-out', 'stroll', 'run', 'jog'].includes(c.verb) && /^(walk|hang-out|stroll|run|jog):/.test(c.id)) {
        // Gaits use place IDs (run:g-house.room), not model refs. Resolve only
        // the bridge's verified authored identity; never decode IDs or aliases.
        const gait=c.verb==='run'||c.verb==='jog';
        const ref=gait?(c.target?.kind==='place'?this.h.authoredPlaceRef?.(c.target.id):undefined):c.id.slice(c.id.indexOf(':')+1);
        const e = ref ? this.m.get(ref) ?? (ref.includes('/') ? this.m.get(ref.slice(0, ref.lastIndexOf('/'))) : undefined) : undefined;
        const r = e ? this.buildingRefusal(e.id, soul) ?? (this.enclosed(e) ? this.refusal(e.id, soul) : null) : null;
        if (r) { c.available = false; (c as any).blocked = r; plans.delete(c.id); }   // private says more than any other block
        continue;
      }
      if (!c.target || !this.m.entities.has(c.target.id) || !['sit', 'lie', 'sleep', 'pick-up', 'put-on'].includes(c.verb)) continue;
      const r = c.verb === 'pick-up' ? this.takeRefusal(c.target.id, soul) : this.refusal(c.target.id, soul);
      if (r) { c.available = false; (c as any).blocked = r; plans.delete(c.id); }
    }
    if (!offers || !here || !economyOn()) return;
    const mine = this.walletOf(soul);
    for (const e of this.m.entities.values()) {
      if (!e.price) continue;
      const wp = this.m.worldPose(e), d = Math.hypot(wp.x - here[0], wp.z - here[1]); if (d > TRADE_REACH) continue;
      const own = this.ownership(e.id), seller = own?.owner ?? 'god';
      if (this.isOf(seller, soul)) continue;
      const what = e.price.service ?? (e.name ? this.m.pathOf(e.id) : this.m.resolvedDef(e.def)?.name.replace(/^core-/, '') ?? 'it');
      const id = `buy:${e.id}`, short = mine.amount < e.price.amount;
      const label = `Buy ${what} from ${this.nameOf(seller)} for ${this.money(e.price.amount)} (you have ${this.money(mine.amount)}; ${Math.round(d)} m)`;
      caps.push({ id, verb: 'buy', label, target: { id: e.id, kind: 'object' }, available: !short, ...(short ? { blocked: { code: 'wallet.insufficient', reason: `It costs ${this.money(e.price.amount)}; you have ${this.money(mine.amount)}.` } } : {}) } as EdgeCapability);
    }
    for (const b of this.h.edge?.perceivedBodies(soul.soulId, 12) ?? []) {
      caps.push({ id: `pay:${b.soulId}`, verb: 'pay', label: `Pay ${b.name} (params: {"amount": n}; you have ${this.money(mine.amount)})`, target: { id: b.soulId, kind: 'soul' }, available: mine.amount > 0, ...(mine.amount > 0 ? {} : { blocked: { code: 'wallet.insufficient', reason: `You have no ${this.currency()}.` } }), params: { amount: { type: 'number', min: 0.01, max: mine.amount || 1 } } } as EdgeCapability);
    }
  }
  /** A building (it has rooms): walking into a private one is refused; open ground (a private garden) is not fenced by words. */
  private enclosed(e: Entity): boolean { const d = this.m.resolvedDef(e.def); if (!d) return false; try { return (this.m.bake(d, e.params ?? {}, e.seed ?? 0, e.shape).rooms?.length ?? 0) > 0; } catch { return false; } }
  /** Why this Soul may not take this thing: whose it is, or that it is for sale. */
  takeRefusal(id: string, soul: { soulId: string; name: string }): Refusal | null { return this.refusal(id, soul) ?? (economyOn() ? this.forSale(id, soul) : null); }
  private forSale(id: string, soul: { soulId: string; name: string }): Refusal | null {
    const e = this.m.entities.get(id); if (!e?.price || e.price.service) return null;
    if (this.isOf(this.ownership(id)?.owner ?? 'god', soul)) return null;
    return { code: 'object.for-sale', reason: `It is for sale (${this.money(e.price.amount)}): buy:${id} first.` };
  }

  /** `buy:<id>`, `pay:<soul>` (params.amount), `sell:<id>` (params.price; 0 or none takes it off sale). */
  act(soul: EdgeSoul, capability: string, params: Record<string, unknown>, here: Vec2 | null = null): { accepted: true; result: Record<string, unknown> } | { accepted: false; code: string; reason: string } {
    const no = (code: string, reason: string) => ({ accepted: false as const, code, reason });
    if (!economyOn()) return no('capability.unknown', `${capability.split(':')[0]}: this world has no economy.`);
    const [verb, ...rest] = capability.split(':'), arg = rest.join(':');
    const me = this.walletOf(soul), merge: Op[] = me.alias ? [{ op: 'pay', from: me.alias, to: me.key, amount: this.m.state.layers!.wallets[me.alias] } as Op] : [];
    if (verb === 'buy') {
      const e = this.m.entities.get(arg); if (!e?.price) return no('capability.unknown', 'That is not for sale.');
      if (here) { const wp = this.m.worldPose(e), d = Math.hypot(wp.x - here[0], wp.z - here[1]); if (d > TRADE_REACH) return no('object.out-of-reach', `It is ${Math.round(d)} m away; walk closer first.`); }
      const seller = this.ownership(e.id)?.owner ?? 'god'; if (this.isOf(seller, soul)) return no('object.yours', 'It is yours already.');
      if (me.amount < e.price.amount) return no('wallet.insufficient', `It costs ${this.money(e.price.amount)}; you have ${this.money(me.amount)}.`);
      const what = e.price.service ?? (e.name ? this.m.pathOf(e.id) : this.m.resolvedDef(e.def)?.name.replace(/^core-/, '') ?? 'it');
      const ops: Op[] = [...merge, ...(e.price.amount > 0 ? [{ op: 'pay', from: me.key, to: seller, amount: e.price.amount, for: what } as Op] : []), ...(e.price.service ? [] : [{ op: 'set', id: e.id, owner: me.key, price: null } as Op])];
      if (!ops.length) return { accepted: true, result: { bought: what } };
      const r = this.h.engineAct(ops, `${soul.name} bought ${what} from ${this.nameOf(seller)} for ${this.money(e.price.amount)}`);
      if (!r.accepted) return no((r as any).failures?.[0]?.code ?? 'buy.refused', (r as any).failures?.[0]?.detail ?? 'the world refused');
      return { accepted: true, result: { bought: what, from: this.nameOf(seller), paid: e.price.amount, currency: this.currency(), wallet: this.walletOf(soul).amount, ...(e.price.service ? {} : { owner: 'yours' }) } };
    }
    if (verb === 'pay') {
      const amount = Number(params.amount); if (!(amount > 0)) return no('capability.params', 'pay needs {"amount": n} (more than 0)');
      const to = this.minds().get(arg) ?? [...this.minds().values()].find((x) => x.name.toLowerCase() === arg.toLowerCase());
      if (!to || to.soulId === soul.soulId) return no('capability.unknown', 'Pay whom? Use pay:<soulId> of someone near you.');
      if (me.amount < amount) return no('wallet.insufficient', `You have ${this.money(me.amount)}.`);
      const r = this.h.engineAct([...merge, { op: 'pay', from: me.key, to: `soul:${to.soulId}`, amount, ...(typeof params.for === 'string' ? { for: params.for.slice(0, 120) } : {}) } as Op], `${soul.name} paid ${to.name} ${this.money(amount)}`);
      if (!r.accepted) return no((r as any).failures?.[0]?.code ?? 'pay.refused', (r as any).failures?.[0]?.detail ?? 'the world refused');
      return { accepted: true, result: { paid: amount, to: to.name, currency: this.currency(), wallet: this.walletOf(soul).amount } };
    }
    if (verb === 'sell') {
      const e = this.m.entities.get(arg); if (!e) return no('capability.unknown', 'No such thing.');
      if (!this.isOf(this.ownership(e.id)?.owner, soul)) return no('object.not-yours', 'You can only sell what is yours.');
      const price = Number(params.price ?? 0);
      if (!(price >= 0) || price > 1_000_000) return no('capability.params', 'sell needs {"price": n} (0 takes it off sale)');
      const r = this.h.engineAct([{ op: 'set', id: e.id, price: price > 0 ? { amount: price, ...(e.price?.service ? { service: e.price.service } : {}) } : null } as Op], `${soul.name} ${price > 0 ? `priced ${this.m.pathOf(e.id)} at ${this.money(price)}` : `took ${this.m.pathOf(e.id)} off sale`}`);
      if (!r.accepted) return no((r as any).failures?.[0]?.code ?? 'sell.refused', (r as any).failures?.[0]?.detail ?? 'the world refused');
      return { accepted: true, result: { thing: this.m.pathOf(e.id), price, currency: this.currency() } };
    }
    return no('capability.unknown', capability);
  }

  // ---------- reads ----------

  /** A Soul's own view: wallet, what it owns, its relationships. */
  me(soul: { soulId: string; name: string }) {
    const owns = [...this.m.entities.values()].filter((e) => e.owner && this.isOf(e.owner, soul)).map((e) => ({ id: e.id, name: e.name ? this.m.pathOf(e.id) : this.m.resolvedDef(e.def)?.name.replace(/^core-/, ''), ...(e.access ? { access: e.access } : {}), ...(e.price ? { price: e.price } : {}), ...(e.owner!.startsWith('group:') ? { via: this.nameOf(e.owner) } : {}) }));
    const rel = this.relations().filter((r) => this.isOf(r.a, soul) || this.isOf(r.b, soul)).map((r) => this.isOf(r.a, soul) ? { you: r.rel, with: this.nameOf(r.b) } : { [r.rel]: 'you', from: this.nameOf(r.a) });
    if (!economyOn()) return { owns: owns.map(({ price: _p, ...o }) => o) };
    return { currency: this.currency(), wallet: this.walletOf(soul).amount, owns, relationships: rel };
  }
  /** The public layer view (no wallets): currency, zones, schedules, prices, owners, relationships. */
  publicView() {
    const econ = economyOn(), things = [...this.m.entities.values()].filter((e) => e.owner || e.access || e.schedule || (econ && e.price));
    const zones = [...this.m.entities.values()].filter((e) => /^core[-/]zone@/.test(this.m.def(e.def)?.ref ?? e.def)).map((e) => ({ id: e.id, name: e.name ? this.m.pathOf(e.id) : e.id, use: e.params?.use ?? 'residential' }));
    return {
      contract: 'layers/1', ...(econ ? { currency: this.currency() } : {}), clock: this.clock(),
      zones,
      things: things.map((e) => ({ id: e.id, name: e.name ? this.m.pathOf(e.id) : e.id, ...(e.owner ? { owner: this.nameOf(e.owner), ownerRef: e.owner } : {}), ...(e.access ? { access: e.access } : {}), ...(econ && e.price ? { price: e.price } : {}), ...(e.schedule ? { schedule: e.schedule, hours: this.hoursOf(e.schedule) } : {}) })),
      ...(econ ? { relations: this.relations().map((r) => ({ a: this.nameOf(r.a), rel: r.rel, b: this.nameOf(r.b), refs: r })) } : {}),
      ...(this.sets.active() ? { sets: this.sets.status(this.clock()) } : {}),
    };
  }
  /** Who works and lives at a thing: "Ana works here". */
  peopleAt(entityId: string): string {
    if (!economyOn()) return '';
    const at = this.relations().filter((r) => r.b === `thing:${entityId}` && (r.rel === 'works-at' || r.rel === 'lives-at'));
    const w = at.filter((r) => r.rel === 'works-at').map((r) => this.nameOf(r.a)), l = at.filter((r) => r.rel === 'lives-at').map((r) => this.nameOf(r.a));
    return [...(w.length ? [`${w.join(' and ')} work${w.length === 1 ? 's' : ''} here`] : []), ...(l.length ? [`${l.join(' and ')} live${l.length === 1 ? 's' : ''} here`] : [])].join('; ');
  }
}

/** Catalogue categories that suit a zone's use (the god's suggestion hook; the catalogue's taxonomy ids). */
export const ZONE_SUGGEST: Record<string, string[]> = {
  residential: ['building.residential', 'furniture.seat', 'vegetation.shrub', 'vegetation.flower', 'utility.lighting', 'object.street'],
  commercial: ['building.commercial', 'public.square', 'object.street', 'object.sign', 'furniture.seat', 'utility.lighting', 'object.food'],
  park: ['public.park', 'vegetation.tree', 'vegetation.flower', 'water.feature', 'public.play', 'furniture.seat', 'utility.lighting'],
  farm: ['building.agricultural', 'vegetation.crop', 'living.farm', 'object.tool', 'object.container'],
  civic: ['building.civic', 'public.square', 'public.monument', 'public.venue', 'object.sign', 'water.feature'],
  industrial: ['building.industrial', 'utility.power', 'utility.waste', 'vehicle.road', 'layer.construction', 'object.container'],
  wild: ['vegetation.tree', 'terrain.landform', 'terrain.rock', 'water.body', 'living.wild', 'living.bird'],
};

/** GET /v1/world/layers (public: no wallets), GET /v1/world/layers/me (a Soul's own: wallet, owns, relationships),
 *  GET /v1/god/layers (the god's: everything, wallets too), GET /v1/god/layers/zone-suggest?use=… (catalogue picks). */
export function mountLayerRoutes(app: import('hono').Hono, d: { god: { model: WorldModel }; layers: () => GodLayers | undefined; requireGod: (c: import('hono').Context) => void; soulFromBearer: (c: import('hono').Context) => { id: string; name: string } | null; categoryOf: (def: unknown) => string }) {
  const noStore = { 'cache-control': 'no-store' };
  const need = () => { const l = d.layers(); if (!l) throw new ApiError(404, 'not-found', 'this world has no Souls layer (no engine bridge)'); return l; };
  app.get('/v1/world/layers', (c) => c.json(need().publicView(), 200, noStore));
  app.get('/v1/world/layers/me', (c) => { const s = d.soulFromBearer(c); if (!s) return c.json({ error: { code: 'unauthorized', message: 'a Soul token is required' } }, 401); return c.json(need().me({ soulId: s.id, name: s.name }), 200, noStore); });
  app.get('/v1/god/layers', (c) => { d.requireGod(c); const l = need(); const w = d.god.model.state.layers?.wallets ?? {}; return c.json({ ...l.publicView(), souls: l.souls(), ...(economyOn() ? {} : { deferred: 'economy and relationships are off in this world (LAYERS=1 opts in)' }), wallets: Object.fromEntries(Object.entries(w).map(([k, v]) => [l.nameOf(k), v])), walletRefs: w }, 200, noStore); });
  app.get('/v1/god/layers/zone-suggest', (c) => {
    const use = c.req.query('use') ?? '', cats = ZONE_SUGGEST[use];
    if (!cats) return c.json({ error: { code: 'invalid', message: `use is one of ${Object.keys(ZONE_SUGGEST).join(', ')}` } }, 400);
    const defs = d.god.model.allDefs().filter((x) => x.name.startsWith('core-'));
    return c.json({ use, categories: cats.map((cat) => ({ category: cat, defs: defs.filter((x) => { const k = d.categoryOf(x); return k === cat || k.startsWith(cat + '.'); }).slice(0, 6).map((x) => x.ref.replace(/^core-/, 'core/')) })) }, 200, { 'cache-control': 'public, max-age=60' });
  });
}
