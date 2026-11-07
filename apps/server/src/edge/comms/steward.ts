// C10: steward work queue and Tier 2 digest (vision §9). The backend owns the schedule;
// a Claude Code steward session (Gene's subscription, no API spend) polls, claims and
// completes work items. Kinds: `digest` (due at in-world morning and evening),
// `render` (eyes/map requests from Ledger/World), `narration` (lifecycle events the
// ledger decided). The steward reads public speech and object actions, never private
// conversations.
import {createHash, timingSafeEqual} from 'node:crypto';
import {clockAt, DAY_TICKS} from '@souls/brain';
import {EdgeError} from '../contract.ts';
import {newId, type CommsCore} from './core.ts';
import {speechLog} from './speech.ts';
import {tx} from './store.ts';

export type WorkKind = 'digest' | 'render' | 'narration';
export type WorkItem = {id: string; kind: WorkKind | string; state: 'open' | 'claimed' | 'done'; createdAt: number; claimedAt: number | null; claimedBy: string | null; completedAt: number | null; body: Record<string, unknown>; result: Record<string, unknown> | null};
export const CLAIM_TTL_MS = 10 * 60_000;
export const MORNING_HOUR = 7, EVENING_HOUR = 18;

type Row = {id: string; kind: string; state: string; created_at: number; claimed_at: number | null; claimed_by: string | null; completed_at: number | null; body: string; result: string | null};
const toItem = (r: Row): WorkItem => ({id: r.id, kind: r.kind, state: r.state as WorkItem['state'], createdAt: r.created_at, claimedAt: r.claimed_at, claimedBy: r.claimed_by, completedAt: r.completed_at, body: JSON.parse(r.body), result: r.result ? JSON.parse(r.result) : null});
const digestOf = (h: string) => createHash('sha256').update(h).digest();

export class Steward {
  private core: CommsCore; private token: string | undefined;
  constructor(core: CommsCore, token: string | undefined) { this.core = core; this.token = token; }

  /** Throws EdgeError unless the request carries the configured steward token. */
  authorize(header: string | undefined) {
    if (!this.token) throw new EdgeError(503, 'unavailable', 'no steward is configured for this world');
    const given = header?.replace(/^Bearer\s+/i, '') ?? '';
    if (!timingSafeEqual(digestOf(given), digestOf(this.token))) throw new EdgeError(401, 'unauthorized', 'steward token required');
  }

  private seq = 0;
  enqueue(kind: WorkKind | string, body: Record<string, unknown>, dedupe?: string): string | null {
    // Sortable within one millisecond: created_at, then this per-process sequence.
    const id = `${newId('wk')}`.replace(/^wk_/, `wk_${(++this.seq).toString(36).padStart(6, '0')}_`);
    const r = this.core.db.prepare('INSERT OR IGNORE INTO edge_comms_work (world_id, id, kind, state, dedupe, created_at, body) VALUES (?,?,?,?,?,?,?)')
      .run(this.core.worldId, id, kind, 'open', dedupe ?? null, this.core.now(), JSON.stringify(body));
    return Number(r.changes) > 0 ? id : null;
  }
  narrate(event: {soulId?: string; what: string; data?: Record<string, unknown>}) { return this.enqueue('narration', event); }
  requestRender(req: {target: 'eyes' | 'map'; soulId?: string; data?: Record<string, unknown>}) { return this.enqueue('render', req); }

  clock() {
    const living = this.core.deps.host.living;
    return clockAt(this.core.tick(), living?.origin ?? 0, living?.dayTicks ?? DAY_TICKS);
  }
  /** Queue the digest for the current in-world slot (idempotent per day+slot). */
  schedule(): string | null {
    const c = this.clock();
    if (c.hour < MORNING_HOUR) return null;                 // night belongs to yesterday's evening digest
    const phase = c.hour >= EVENING_HOUR ? 'evening' : 'morning';
    const last = this.latestDigest();
    return this.enqueue('digest', {day: c.day, phase, dueTick: this.core.tick(), since: last?.writtenAt ?? 0,
      instructions: 'Write the Tier 2 digest from the public log and your memory. Summarise overheard public scenes without quoting; never private conversations.'}, `digest:${c.day}:${phase}`);
  }

  list(includeDone = false, limit = 50): WorkItem[] {
    const stale = this.core.now() - CLAIM_TTL_MS;
    const rows = this.core.db.prepare(`SELECT * FROM edge_comms_work WHERE world_id = ? AND (state = 'open' OR (state = 'claimed' AND claimed_at < ?)${includeDone ? " OR state = 'done'" : ''}) ORDER BY created_at, id LIMIT ?`).all(this.core.worldId, stale, limit) as Row[];
    return rows.map(toItem);
  }
  private row(id: string) { return this.core.db.prepare('SELECT * FROM edge_comms_work WHERE world_id = ? AND id = ?').get(this.core.worldId, id) as Row | undefined; }

  claim(id: string, by: string): WorkItem {
    return tx(this.core.db, () => {
      const r = this.row(id);
      if (!r) throw new EdgeError(404, 'not-found', 'no such work item');
      const now = this.core.now();
      if (r.state === 'done' || (r.state === 'claimed' && (r.claimed_at ?? 0) >= now - CLAIM_TTL_MS && r.claimed_by !== by)) throw new EdgeError(409, 'conflict', 'already claimed or done');
      this.core.db.prepare("UPDATE edge_comms_work SET state = 'claimed', claimed_at = ?, claimed_by = ? WHERE world_id = ? AND id = ?").run(now, by, this.core.worldId, id);
      return toItem(this.row(id)!);
    });
  }
  release(id: string) {
    this.core.db.prepare("UPDATE edge_comms_work SET state = 'open', claimed_at = NULL, claimed_by = NULL WHERE world_id = ? AND id = ? AND state = 'claimed'").run(this.core.worldId, id);
    return {released: true};
  }

  complete(id: string, result: Record<string, unknown>): WorkItem {
    return tx(this.core.db, () => {
      const r = this.row(id);
      if (!r) throw new EdgeError(404, 'not-found', 'no such work item');
      if (r.state === 'done') throw new EdgeError(409, 'conflict', 'already done');
      const item = toItem(r), now = this.core.now();
      const text = result.text;
      if (item.kind === 'digest' || item.kind === 'narration') {
        const max = item.kind === 'digest' ? 8000 : 2000;
        if (typeof text !== 'string' || !text.trim() || text.length > max) throw new EdgeError(400, 'invalid', `result.text must be 1..${max} characters`);
      }
      if (item.kind === 'digest') {
        this.core.db.prepare('INSERT OR REPLACE INTO edge_comms_digests (world_id, written_at, day, phase, text, work_id) VALUES (?,?,?,?,?,?)').run(this.core.worldId, now, Number(item.body.day ?? 0), String(item.body.phase ?? ''), String(text).trim(), id);
      }
      this.core.db.prepare("UPDATE edge_comms_work SET state = 'done', completed_at = ?, result = ? WHERE world_id = ? AND id = ?").run(now, JSON.stringify(result), this.core.worldId, id);
      const tick = this.core.tick();
      const deliverTo = (to: string[], body: Record<string, unknown>) => { for (const s of to) if (this.core.isLive(s)) this.core.streams.deliver(s, 'world', tick, body); };
      if (item.kind === 'digest') deliverTo(this.core.liveSoulIds(), {text: `The ${item.body.phase} digest is ready (GET /v1/edge/digest).`, digest: {day: item.body.day, phase: item.body.phase}});
      else if (item.kind === 'narration') deliverTo(typeof item.body.soulId === 'string' ? [item.body.soulId] : this.core.liveSoulIds(), {text: String(text).trim(), narration: true});
      else if (typeof item.body.soulId === 'string') deliverTo([item.body.soulId], {text: typeof text === 'string' ? text.slice(0, 2000) : `Your ${String(item.body.target ?? 'render')} is ready.`, render: result});
      this.core.spectate({kind: `steward.${item.kind}`, tick, work: id, ...(typeof text === 'string' ? {text} : {})});
      return toItem(this.row(id)!);
    });
  }

  latestDigest(): {text: string; writtenAt: number; day: number; phase: string} | null {
    const r = this.core.db.prepare('SELECT written_at, day, phase, text FROM edge_comms_digests WHERE world_id = ? ORDER BY written_at DESC LIMIT 1').get(this.core.worldId) as {written_at: number; day: number; phase: string; text: string} | undefined;
    return r ? {text: r.text, writtenAt: r.written_at, day: r.day, phase: r.phase} : null;
  }

  /** The public record since `sinceAt`: speech (public channels only) and object actions. */
  log(sinceAt: number) {
    const objects = (this.core.db.prepare('SELECT object_id, version, soul_id, action, params, tick, at FROM edge_comms_object_log WHERE world_id = ? AND at >= ? ORDER BY at, object_id, version LIMIT 1000').all(this.core.worldId, sinceAt) as {object_id: string; version: number; soul_id: string | null; action: string; params: string; tick: number; at: number}[])
      .map(r => ({object: r.object_id, version: r.version, soul: r.soul_id ? {soulId: r.soul_id, name: this.core.nameOf(r.soul_id)} : null, action: r.action, params: JSON.parse(r.params), tick: r.tick, at: r.at}));
    const speech = speechLog(this.core, sinceAt, 1000).map(s => ({...s, from: {soulId: s.soulId, name: this.core.nameOf(s.soulId)}, heardBy: s.heardBy.length}));
    return {clock: this.clock(), speech, objects, untrusted: true};
  }
}
