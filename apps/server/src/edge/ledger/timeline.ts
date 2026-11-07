// A Soul's public biography (CTX-8, #1141): what it has done here, as the world's own record shows it. Only canonical facts: a
// completed receipt, an outcome marked public, the Soul's first arrival and its journeys. Never speech, owner messages or
// anything private. One row per fact, written when it happens with the world clock of that moment, so a read is a bounded
// index lookup. A world that lost the table builds it again from its receipts, a bounded number at a time.
import type {DatabaseSync} from 'node:sqlite';
import type {EdgeOutcomeV1} from '@souls/protocol';
import type {EdgeReceipt} from '../contract.ts';
import {SPOT_ACTIVITIES} from './activities.ts';

/** The most entries a public record carries, newest first. Every text is cut to 80 bytes, so the timeline stays under 8 KB. */
export const TIMELINE_MAX = 20;
/** What `inspect <soul>` shows of it. */
export const TIMELINE_PAGE = 5;
/** Receipts one rebuild reads per Soul, newest first. */
export const REBUILD_MAX = 500;
const TEXT_MAX = 80;
/** Acts a Soul does in front of others (activities.ts). */
const PERFORMING = new Set(['play-piano', 'play-music', 'sing', 'lecture', 'tell-story', 'social-dance']);
/** Acts that can only complete with others there: every spot of theirs has `together` with `alone: 'fail'`. */
const GATHERING = new Set(['book-club', 'cook-together', 'yoga-class', 'hear-story']);
export type TimelineKind = 'arrival' | 'produced' | 'performance' | 'gathering' | 'travel';
export type WorldClock = {worldDay: number; time: string} | null;
export type TimelineEntry = {kind: TimelineKind; when: {real: string; tick: number | null; worldDay: number | null; time: string | null}; place: {id: string | null; name: string | null}; title?: string; world?: string};
type Row = {receipt_id: string; kind: TimelineKind; tick: number; at: number; world_day: number | null; time: string | null; place_id: string | null; title: string | null; world: string | null; object_id: string | null};
/** By bytes: a budget in characters is no budget in another script. */
const clip = (v: unknown) => Buffer.from(String(v ?? '')).subarray(0, TEXT_MAX).toString().replace(/\uFFFD+$/, '');

/** The entry a finished receipt makes, if any. Pure: the same receipt and outcome always give the same answer. */
export function entryOf(r: Pick<EdgeReceipt, 'capability' | 'phase'>, outcome: Pick<EdgeOutcomeV1, 'produced'> | undefined): {kind: TimelineKind; title: string; object?: string} | null {
  if (r.phase !== 'completed') return null;
  const made = outcome?.produced?.find((p) => p.visibility === 'public'), verb = r.capability.split(':')[0]!, label = SPOT_ACTIVITIES[verb]?.label ?? verb;
  if (made) return {kind: 'produced', title: clip(made.title), object: made.id};
  if (GATHERING.has(verb)) return {kind: 'gathering', title: clip(label)};
  if (PERFORMING.has(verb)) return {kind: 'performance', title: clip(label)};
  return null;
}

export class SoulTimeline {
  private db: DatabaseSync; private world: string;
  constructor(db: DatabaseSync, world: string) {
    this.db = db; this.world = world;
    db.exec(`CREATE TABLE IF NOT EXISTS edge_timeline_v1(world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, soul_id TEXT NOT NULL, kind TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, world_day INTEGER, time TEXT, place_id TEXT, title TEXT, world TEXT, object_id TEXT, PRIMARY KEY(world_id, receipt_id)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS edge_timeline_v1_soul ON edge_timeline_v1(world_id, soul_id, at DESC, receipt_id DESC);
      CREATE TABLE IF NOT EXISTS edge_timeline_built_v1(world_id TEXT NOT NULL, soul_id TEXT NOT NULL, PRIMARY KEY(world_id, soul_id)) WITHOUT ROWID;`);
  }
  private put(id: string, soulId: string, kind: TimelineKind, tick: number, at: number, clock: WorldClock, place: string | null, title: string | null, world: string | null, object: string | null = null) {
    this.db.prepare('INSERT OR IGNORE INTO edge_timeline_v1(world_id,receipt_id,soul_id,kind,tick,at,world_day,time,place_id,title,world,object_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(this.world, id, soulId, kind, tick, at, clock?.worldDay ?? null, clock?.time ?? null, place, title, world, object);
  }
  /** A receipt that has ended, stamped when it began. Replays and second looks change nothing. */
  note(r: EdgeReceipt, at: number, clock: (tick: number) => WorldClock) {
    const e = entryOf(r, r.outcome);
    if (e) this.put(r.id, r.soulId, e.kind, r.acceptedTick, at, clock(r.acceptedTick), (r.endedAt as {place?: string} | null)?.place ?? null, e.title, null, e.object ?? null);
  }
  /** Where a new Soul first stood. */
  arrived(soulId: string, tick: number, at: number, clock: WorldClock, place: string) { this.put(`arrival:${soulId}`, soulId, 'arrival', tick, at, clock, place, null, null); }
  /** A Soul leaving for another world. */
  travelled(soulId: string, tick: number, at: number, clock: WorldClock, place: string | null, world: string) { this.put(`travel:${soulId}:${at}`, soulId, 'travel', tick, at, clock, place, null, clip(world)); }
  /** Build a Soul's rows once from its receipts, for a world that doesn't have them. The world clock of that moment is gone, and the
   *  origin may have moved since, so those rows show the real clock alone. */
  ensure(soulId: string, receipts: () => {receipt: EdgeReceipt; at: number}[]) {
    if (this.db.prepare('SELECT 1 FROM edge_timeline_built_v1 WHERE world_id=? AND soul_id=?').get(this.world, soulId)) return;
    for (const {receipt, at} of receipts()) this.note(receipt, at, () => null);
    this.db.prepare('INSERT OR IGNORE INTO edge_timeline_built_v1(world_id,soul_id) VALUES(?,?)').run(this.world, soulId);
  }
  rows(soulId: string, limit: number): Row[] {
    return this.db.prepare('SELECT receipt_id,kind,tick,at,world_day,time,place_id,title,world,object_id FROM edge_timeline_v1 WHERE world_id=? AND soul_id=? ORDER BY at DESC, receipt_id DESC LIMIT ?').all(this.world, soulId, limit) as Row[];
  }
}

/** Rows, and what only the Soul's record still holds, merged newest first and cut to `limit`. A place the public may not know is
 *  no place at all here: neither its name nor its id. */
export function timelineView(rows: Row[], extra: TimelineEntry[], {limit = TIMELINE_MAX, placeName, gone = () => false}: {limit?: number; placeName: (id: string) => string | null; gone?: (objectId: string) => boolean}): TimelineEntry[] {
  // A thing its maker took down leaves the record.
  const entries = rows.filter((r) => !(r.object_id && gone(r.object_id))).map((r): TimelineEntry => {
    const name = r.place_id ? placeName(r.place_id) : null;
    return {kind: r.kind, when: {real: new Date(r.at).toISOString(), tick: r.tick, worldDay: r.world_day, time: r.time}, place: name ? {id: r.place_id, name: clip(name)} : {id: null, name: null}, ...(r.title ? {title: r.title} : {}), ...(r.world ? {world: r.world} : {}), ...(r.kind === 'produced' ? {untrusted: true} : {})};
  }), have = new Set(entries.map((e) => `${e.kind}:${e.when.real}`));
  return [...entries, ...extra.filter((e) => !have.has(`${e.kind}:${e.when.real}`) && !(e.kind === 'arrival' && entries.some((x) => x.kind === 'arrival')))].sort((a, b) => (a.when.real < b.when.real ? 1 : a.when.real > b.when.real ? -1 : 0)).slice(0, limit);
}
