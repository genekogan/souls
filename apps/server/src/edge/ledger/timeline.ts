// A Soul's public biography (CTX-8, #1141): what it has done here, as the world's own record shows it. Only canonical facts: a
// terminal receipt and its confirmed outcome, the Soul's creation and its travel log. Never speech or owner messages.
// One row per receipt, written when the receipt ends, so a read is a bounded index lookup and never a scan of the log.
import type {DatabaseSync} from 'node:sqlite';
import type {EdgeOutcomeV1} from '@souls/protocol';
import type {EdgeReceipt} from '../contract.ts';

/** The most entries a public record carries, newest first. At most about 200 bytes each: the record grows by at most 4 KB. */
export const TIMELINE_MAX = 20;
/** What `inspect <soul>` shows of it. */
export const TIMELINE_PAGE = 5;
const PERFORMING = new Set(['play', 'sing', 'perform', 'present', 'recite', 'dance']);
export type TimelineKind = 'arrival' | 'produced' | 'performance' | 'gathering' | 'travel';
export type TimelineEntry = {kind: TimelineKind; when: {real: string; tick: number | null; worldDay: number | null; time: string | null}; place: {id: string | null; name: string | null}; title?: string; with?: number; world?: string; untrusted?: boolean};
type Row = {receipt_id: string; kind: TimelineKind; tick: number; at: number; place_id: string | null; title: string | null; n: number | null};

/** The entry a finished receipt makes, if any. Pure: the same receipt and outcome always give the same answer. */
export function entryOf(r: Pick<EdgeReceipt, 'capability' | 'phase'>, outcome: Pick<EdgeOutcomeV1, 'produced' | 'met'> | undefined): {kind: TimelineKind; title: string | null; n: number | null} | null {
  if (r.phase !== 'completed') return null;
  const made = outcome?.produced?.[0], verb = r.capability.split(':')[0]!, met = outcome?.met?.length ?? 0;
  if (made) return {kind: 'produced', title: String(made.title ?? made.id).slice(0, 80), n: null};
  if (met) return {kind: 'gathering', title: verb, n: met};
  if (PERFORMING.has(verb)) return {kind: 'performance', title: verb, n: null};
  return null;
}

export class SoulTimeline {
  private db: DatabaseSync; private world: string;
  constructor(db: DatabaseSync, world: string) {
    this.db = db; this.world = world;
    db.exec(`CREATE TABLE IF NOT EXISTS edge_timeline_v1(world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, soul_id TEXT NOT NULL, kind TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, place_id TEXT, title TEXT, n INTEGER, PRIMARY KEY(world_id, receipt_id)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS edge_timeline_v1_soul ON edge_timeline_v1(world_id, soul_id, tick DESC, receipt_id DESC);`);
  }
  /** A receipt that has ended. Replays and second looks change nothing. */
  note(r: EdgeReceipt, at: number) {
    const e = entryOf(r, r.outcome);
    if (!e) return;
    this.db.prepare('INSERT OR IGNORE INTO edge_timeline_v1(world_id,receipt_id,soul_id,kind,tick,at,place_id,title,n) VALUES(?,?,?,?,?,?,?,?,?)').run(this.world, r.id, r.soulId, e.kind, r.endedTick ?? r.acceptedTick, at, (r.endedAt as {place?: string} | null | undefined)?.place ?? null, e.title, e.n);
  }
  rows(soulId: string, limit: number): Row[] {
    return this.db.prepare('SELECT receipt_id,kind,tick,at,place_id,title,n FROM edge_timeline_v1 WHERE world_id=? AND soul_id=? ORDER BY tick DESC, receipt_id DESC LIMIT ?').all(this.world, soulId, limit) as Row[];
  }
}

/** Rows and the Soul's own arrival and travel, merged newest first and cut to `limit`. */
export function timelineView(rows: Row[], extra: TimelineEntry[], {limit = TIMELINE_MAX, clock, placeName}: {limit?: number; clock: (tick: number) => {worldDay: number; time: string} | null; placeName: (id: string) => string | null}): TimelineEntry[] {
  const entries = rows.map((r): TimelineEntry => {
    const c = clock(r.tick);
    return {kind: r.kind, when: {real: new Date(r.at).toISOString(), tick: r.tick, worldDay: c?.worldDay ?? null, time: c?.time ?? null}, place: {id: r.place_id, name: r.place_id ? placeName(r.place_id) : null}, ...(r.title ? {title: r.title} : {}), ...(r.n ? {with: r.n} : {}), ...(r.kind === 'produced' ? {untrusted: true} : {})};
  });
  return [...entries, ...extra].sort((a, b) => (a.when.real < b.when.real ? 1 : a.when.real > b.when.real ? -1 : 0)).slice(0, limit);
}
