// LAYERS (2026-10-11): the invisible systems of a world, as god-authored, validated, invertible world data.
//
//  - schedules: opening hours and recurring events on things and places, read against the world clock; states can
//    follow them (a shop door unlocked while it is open, lamps on while it is dark);
//  - ownership: an entity's `owner` (a Soul, the god, a group) and `access` (public | private); the nearest owned
//    ancestor gives it to what stands inside (a chair in Ana's private house is Ana's, private);
//  - land use: zones are named area things of `core/zone@1` (a `use` param) — places like any other area;
//  - relationships: a small graph of {a, rel, b} in the world state (`layers.relations`);
//  - economy: a currency name, prices on things (`price`), wallets per owner ref (`layers.wallets`).
//
// Everything here is absent until the god uses it: a world that never does keeps its exact state and entities.
import { z } from 'zod';
import { ID, NAME, value } from '@souls/generators';

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;   // index = JS getUTCDay()
export type Day = (typeof DAYS)[number];
const HHMM = z.string().regex(/^([01]?\d|2[0-4]):[0-5]\d$/, 'time must be HH:MM');
const day = z.enum(DAYS);

/** Who owns something / whose wallet: the god, a Soul (by id; a name is accepted and matched at read time), a group. */
export const OWNER_REF = /^(god|soul:[A-Za-z0-9_.-]{1,64}|group:[a-z0-9][a-z0-9-]{0,39})$/;
export const ownerRef = z.string().regex(OWNER_REF, 'owner must be god, soul:<id or name> or group:<name>');
/** A relationship end: an owner ref, or a thing/place (`thing:<id or path>`; stored by entity id). */
export const relRef = z.string().regex(/^(god|soul:[A-Za-z0-9_.-]{1,64}|group:[a-z0-9][a-z0-9-]{0,39}|thing:[A-Za-z0-9_./-]{1,200})$/, 'a relation end is soul:<id>, group:<name>, thing:<id or path> or god');
export const RELATIONS = ['friend', 'neighbour', 'family', 'works-at', 'lives-at', 'member-of'] as const;
export const ACCESS = ['public', 'private'] as const;
export const ZONE_USES = ['residential', 'commercial', 'park', 'farm', 'civic', 'industrial', 'wild'] as const;

/** EVENTS: one thing of an event's set. `def` is a def ref (core/market-stall@1). */
export const setPieceSchema = z.object({
  def: z.string().regex(/^((?:core|eden|lm|mars)\/[a-z0-9][a-z0-9._-]*@\d+|sha:[0-9a-f]{16,64}|[a-z0-9][a-z0-9._-]*@\d+)$/, 'def must be a def ref (core/market-stall@1)'),
  p: z.tuple([z.number().finite().min(-200).max(200), z.number().finite().min(-200).max(200)]),
  r: z.number().finite().optional(),
  state: z.record(z.string(), value).optional(),
  params: z.record(z.string(), value).optional(),
});
export type SetPiece = z.infer<typeof setPieceSchema>;
export const scheduleSchema = z.object({
  /** Opening hours: from–to (to may pass midnight), on `days` (default every day). */
  open: z.array(z.object({ from: HHMM, to: HHMM, days: z.array(day).min(1).max(7).optional() })).max(8).optional(),
  /** Recurring events: a concert at 20:00 for 90 minutes on fridays. `set` (EVENTS, 2026-10-15): the things that appear
   *  for it (market stalls, a stage and its lights) at the event's start and are packed away at its end, placed in the
   *  scheduled thing at `p` (metres from its centre, its own frame), yaw `r` (radians), with `state` (lights on). */
  events: z.array(z.object({ name: z.string().regex(NAME), label: z.string().max(80).optional(), at: HHMM, minutes: z.number().int().min(5).max(1440).default(60), days: z.array(day).min(1).max(7).optional(), set: z.array(setPieceSchema).min(1).max(24).optional() })).max(16).optional(),
  /** States that follow the schedule: `field` is `is` while `when` holds, `else` (when given) otherwise. */
  follow: z.array(z.object({ field: z.string().regex(ID), when: z.enum(['open', 'event', 'dark']), is: value, else: value.optional() })).max(8).optional(),
});
export type Schedule = z.infer<typeof scheduleSchema>;
export const priceSchema = z.object({ amount: z.number().min(0).max(1_000_000), /** a service sold here ("a coffee"): paying keeps the thing where it is */ service: z.string().min(1).max(60).optional() });
export type Price = z.infer<typeof priceSchema>;
export const relationSchema = z.object({ a: z.string(), rel: z.enum(RELATIONS), b: z.string() });
export type Relation = z.infer<typeof relationSchema>;
/** `state.layers` (absent until used). Wallets are private: viewers' snapshots never carry them. */
export const layersStateSchema = z.object({
  currency: z.string().min(1).max(24).optional(),
  wallets: z.record(z.string(), z.number()).default({}),
  relations: z.array(relationSchema).max(4000).default([]),
});
export type LayersState = z.infer<typeof layersStateSchema>;

// ---------- the clock ----------

export const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h * 60 + m) % 1440 || (h === 24 ? 1440 : 0); };
const onDay = (days: readonly Day[] | undefined, d: number) => !days?.length || days.includes(DAYS[((d % 7) + 7) % 7]);
/** Open at `minute` of a day whose weekday is `weekday` (0 = sun)? A span past midnight counts for the day it began. */
export function isOpen(s: Schedule | undefined, minute: number, weekday: number): boolean {
  for (const o of s?.open ?? []) {
    const a = minutesOf(o.from), b = o.to === '24:00' ? 1440 : minutesOf(o.to);
    if (a === b) { if (onDay(o.days, weekday)) return true; continue; }
    if (a < b) { if (minute >= a && minute < b && onDay(o.days, weekday)) return true; }
    else if ((minute >= a && onDay(o.days, weekday)) || (minute < b && onDay(o.days, weekday - 1))) return true;
  }
  return false;
}
/** The events on now (and how long they have left). */
export function eventsOn(s: Schedule | undefined, minute: number, weekday: number): { name: string; label: string; left: number }[] {
  const out: { name: string; label: string; left: number }[] = [];
  for (const e of s?.events ?? []) {
    const a = minutesOf(e.at), since = (minute - a + 1440) % 1440, started = minute >= a ? weekday : weekday - 1;
    if (since < e.minutes && onDay(e.days, started)) out.push({ name: e.name, label: e.label ?? e.name, left: e.minutes - since });
  }
  return out;
}
/** Dark: 19:30–06:30 (the hours the viewers' lamps burn). */
export const isDark = (minute: number) => minute >= 19 * 60 + 30 || minute < 6 * 60 + 30;
/** The state patch the schedule wants now (only the fields it follows). */
export function followPatch(s: Schedule | undefined, minute: number, weekday: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of s?.follow ?? []) {
    const on = f.when === 'open' ? isOpen(s, minute, weekday) : f.when === 'event' ? eventsOn(s, minute, weekday).length > 0 : isDark(minute);
    if (on) out[f.field] = f.is; else if (f.else !== undefined) out[f.field] = f.else;
  }
  return out;
}
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dayList = (days?: readonly string[]) => !days?.length || days.length === 7 ? '' : ` ${days.length === 1 ? `${days[0]}s` : days.join('/')}`;
/** "open 07:00–15:00; market 09:00–13:00 sats" (for descriptions). */
export function describeSchedule(s: Schedule | undefined): string {
  if (!s) return '';
  const parts = [...(s.open ?? []).map((o) => `open ${o.from}–${o.to}${dayList(o.days)}`), ...(s.events ?? []).map((e) => `${e.label ?? e.name} ${e.at}–${hm(minutesOf(e.at) + e.minutes)}${dayList(e.days)}`)];
  return parts.join('; ');
}
/** Daily cron slots for a weekday (the ledger's place schedule: `M H * * *`, durationMinutes), today's only. */
export function scheduleSlots(s: Schedule | undefined, weekday: number, label: string): { id: string; cron: string; durationMinutes: number; label: string }[] {
  const out: { id: string; cron: string; durationMinutes: number; label: string }[] = [];
  (s?.open ?? []).forEach((o, i) => {
    if (!onDay(o.days, weekday)) return;
    const a = minutesOf(o.from), b = o.to === '24:00' ? 1440 : minutesOf(o.to), dur = a === b ? 1440 : (b - a + 1440) % 1440;
    out.push({ id: `open-${i + 1}`, cron: `${a % 60} ${Math.floor(a / 60)} * * *`, durationMinutes: dur, label: `${label} open` });
  });
  for (const e of s?.events ?? []) {
    if (!onDay(e.days, weekday)) continue;
    const a = minutesOf(e.at);
    out.push({ id: e.name, cron: `${a % 60} ${Math.floor(a / 60)} * * *`, durationMinutes: e.minutes, label: e.label ?? e.name });
  }
  return out;
}
