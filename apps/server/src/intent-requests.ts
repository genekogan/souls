// Private persistence and named canonical publication seam. No route/automatic
// worker or G-004 behavioral activation; pending rows alone are not receipts.
import { randomUUID } from 'node:crypto';
import { hashOf, stableStringify } from '@souls/engine-contract';
import { INTENT_V2, intentReceivedPayloadV2Schema, intentHistoryFactV2,
  intentRequestV2Schema, intentReceiptV2Schema, intentSourceV2Schema, intentRevisionV2Schema,
  type IntentRequestV2, type IntentReceiptV2, type IntentRevisionV2 } from '@souls/protocol';
import type { Db, SoulRow } from './db.ts';
import { checkAcceptanceGuard, type AcceptanceGuard, type AcceptanceJournal } from './world.ts';

type Source = IntentRevisionV2['source'];
export type IntentRequestScope = { worldId: string; soulId: string; source: Source; currentAuthority: (row: SoulRow) => boolean };
type Key = { worldId: string; soulId: string; principalId: string; requestId: string };
type Row = { owner_id: string; body_hash: string; body: string; source: string; lease: string; receipt: string | null; received: string | null };
export type RequestEventReference = { seq: number; tick: number; kind: string; eventHash: string };
type View = { key: Key; request: IntentRequestV2; source: Source; receipt: IntentReceiptV2 | null; received: Extract<IntentReceiptV2, { phase: 'received' }> | null };
export type RequestReservation = ({ created: true; lease: string } | { created: false }) & View;
export class IntentRequestConflict extends Error { constructor() { super('that request ID already names different words or settings'); } }
export class IntentRequestUnavailable extends Error { constructor() { super('request unavailable'); } }
export class IntentRequestLeaseLost extends Error { constructor() { super('request reservation no longer writable'); } }

function keyArgs(k: Key) { return [k.worldId, k.soulId, k.principalId, k.requestId]; }
function received(raw: string | null): View['received'] {
  if (raw === null) return null;
  const receipt = intentReceiptV2Schema.parse(JSON.parse(raw));
  if (receipt.phase !== 'received') throw new Error('invalid received origin');
  return receipt;
}
function view(k: Key, row: Row): View {
  return { key: k, request: intentRequestV2Schema.parse(JSON.parse(row.body)),
    source: intentSourceV2Schema.parse(JSON.parse(row.source)),
    receipt: row.receipt === null ? null : intentReceiptV2Schema.parse(JSON.parse(row.receipt)),
    received: received(row.received) };
}
export class IntentRequests {
  readonly db: Db;
  constructor(db: Db) { this.db = db; }
  private transaction<T>(work: () => T): T {
    this.db.db.exec('BEGIN IMMEDIATE');
    try { const value = work(); this.db.db.exec('COMMIT'); return value; }
    catch (error) { this.db.db.exec('ROLLBACK'); throw error; }
  }
  private row(k: Key): Row | undefined {
    return this.db.db.prepare('SELECT owner_id, body_hash, body, source, lease, receipt, received FROM intent_requests_v2 WHERE world_id=? AND soul_id=? AND principal_id=? AND request_id=?')
      .get(...keyArgs(k)) as Row | undefined;
  }
  private verifyReceived(key: Key, row: Row) {
    const origin = received(row.received);
    if (!origin) throw new Error('publication requires its own canonical received origin');
    const fact = this.db.events(key.worldId, origin.seq - 1, 1)[0];
    const ref = this.db.db.prepare('SELECT event_hash FROM intent_request_events_v2 WHERE world_id=? AND soul_id=? AND principal_id=? AND request_id=? AND seq=?')
      .get(...keyArgs(key), origin.seq);
    if (!fact || fact.kind !== 'intent-request-v2' || fact.tick !== origin.tick || fact.author !== `soul:${key.soulId}`
      || origin.worldId !== key.worldId || origin.soulId !== key.soulId || origin.requestId !== key.requestId
      || !ref || ref.event_hash !== hashOf(fact)) throw new Error('canonical received origin failed verification');
    const payload = intentReceivedPayloadV2Schema.parse(fact.payload);
    if (payload.worldId !== key.worldId || payload.soulId !== key.soulId || hashOf(payload.request) !== row.body_hash
      || stableStringify(payload.source) !== row.source) throw new IntentRequestConflict();
    return origin;
  }
  private verifiedView(key: Key, row: Row): View {
    const stored = view(key, row);
    if (stored.received) this.verifyReceived(key, row);
    if (stored.receipt?.phase === 'understood' || stored.receipt?.phase === 'withdrawn') {
      this.verifyReceived(key, row);
      const seq = stored.receipt.phase === 'understood' ? stored.receipt.revision.submitted.seq : stored.receipt.seq;
      const fact = this.db.events(key.worldId, seq - 1, 1)[0];
      const ref = this.db.db.prepare('SELECT event_hash FROM intent_request_events_v2 WHERE world_id=? AND soul_id=? AND principal_id=? AND request_id=? AND seq=?')
        .get(...keyArgs(key), seq);
      if (!fact || fact.kind !== 'intent-v2' || fact.author !== `soul:${key.soulId}` || !ref || ref.event_hash !== hashOf(fact))
        throw new Error('canonical terminal receipt failed verification');
      const history = intentHistoryFactV2(fact);
      const actual = history.op === 'upsert' ? { contract: INTENT_V2, phase: 'understood', requestId: history.revision.requestId, revision: history.revision }
        : { contract: INTENT_V2, phase: 'withdrawn', requestId: history.requestId, worldId: history.worldId, soulId: history.soulId,
          intent: history.intent, seq: history.seq, tick: history.tick };
      if (stableStringify(actual) !== row.receipt) throw new Error('canonical terminal receipt failed verification');
    }
    return stored;
  }
  private check(scope: IntentRequestScope): Source {
    const source = intentSourceV2Schema.parse(scope.source);
    intentRevisionV2Schema.shape.worldId.parse(scope.worldId);intentRevisionV2Schema.shape.soulId.parse(scope.soulId);
    const soul = this.db.soul(scope.soulId);
    // The trusted handler binds principal/generation to its callback. This
    // storage class cannot authenticate a claimed principal from a client.
    if (!soul || soul.retired_at !== null || soul.world_id !== scope.worldId
      || soul.owner !== source.ownerId || scope.currentAuthority(soul) !== true) throw new IntentRequestUnavailable();
    return source;
  }
  /** Atomically choose one worker. Semantic defaults/key order hash identically.
   * Duplicate submissions never receive its lease and never authorize rerun.
   * Pending rows survive crashes; there is deliberately no automatic resume. */
  reserve(scope: IntentRequestScope, raw: unknown): RequestReservation {
    const request = intentRequestV2Schema.parse(raw), hash = hashOf(request), body = stableStringify(request);
    return this.transaction(() => {
      const source = this.check(scope), key = { worldId: scope.worldId, soulId: scope.soulId, principalId: source.principalId, requestId: request.requestId };
      const old = this.row(key);
      if (old) {
        if (old.owner_id !== source.ownerId) throw new IntentRequestUnavailable();
        if (old.body_hash !== hash) throw new IntentRequestConflict();
        return { created: false, ...this.verifiedView(key, old) };
      }
      const lease = randomUUID(), now = Date.now();
      this.db.db.prepare('INSERT INTO intent_requests_v2(world_id,soul_id,principal_id,request_id,owner_id,body_hash,body,source,lease,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(...keyArgs(key), source.ownerId, hash, body, stableStringify(source), lease, now, now);
      return { created: true, lease, ...view(key, this.row(key)!) };
    });
  }
  /** Current private lookup; unknown/inaccessible is the same null. No-store and
   * HTTP/MCP error mapping belong to the eventual authenticated adapter. */
  lookup(scope: IntentRequestScope, requestId: string): View | null {
    return this.transaction(() => {
      let source: Source;
      try { source = this.check(scope); } catch (error) { if (error instanceof IntentRequestUnavailable) return null; throw error; }
      const key = { worldId: scope.worldId, soulId: scope.soulId, principalId: source.principalId, requestId };
      const row = this.row(key);
      return row && row.owner_id === source.ownerId ? this.verifiedView(key, row) : null;
    });
  }
  /** Same authorized lookup plus the private row timestamps for own diagnostics. */
  lookupTimedV1(scope: IntentRequestScope, requestId: string): (View & { createdAt: number; updatedAt: number }) | null {
    return this.transaction(() => {
      let source: Source;
      try { source = this.check(scope); } catch (error) { if (error instanceof IntentRequestUnavailable) return null; throw error; }
      const key = { worldId: scope.worldId, soulId: scope.soulId, principalId: source.principalId, requestId };
      const row = this.row(key);
      if (!row || row.owner_id !== source.ownerId) return null;
      const times = this.db.db.prepare('SELECT created_at, updated_at FROM intent_requests_v2 WHERE world_id=? AND soul_id=? AND principal_id=? AND request_id=?').get(...keyArgs(key)) as { created_at: number; updated_at: number };
      return { ...this.verifiedView(key, row), createdAt: times.created_at, updatedAt: times.updated_at };
    });
  }
  /** Private worker journal for WorldHost.enqueueChecked on THIS Db. It only
   * references the actual canonical event; it claims no physical success. */
  journal(reservation: Extract<RequestReservation, { created: true }>): AcceptanceJournal {
    return event => {
      const row = this.row(reservation.key);
      if (!row || row.lease !== reservation.lease || row.receipt !== null) throw new IntentRequestLeaseLost();
      const fact = this.db.events(reservation.key.worldId, event.seq - 1, 1)[0];
      const subject = event.kind === 'mint' ? event.payload?.forSoul : event.payload?.soulId;
      if (!fact || hashOf(fact) !== hashOf(event)
        || subject !== reservation.key.soulId || event.author !== `soul:${reservation.key.soulId}`)
        throw new Error('request journal must reference its own accepted canonical fact');
      this.db.db.prepare('INSERT INTO intent_request_events_v2(world_id,soul_id,principal_id,request_id,seq,tick,kind,event_hash) VALUES (?,?,?,?,?,?,?,?)')
        .run(...keyArgs(reservation.key), event.seq, event.tick, event.kind, hashOf(event));
      return true;
    };
  }
  /** A real received fact and its private receipt commit inside host acceptance.
   * No new transaction here; journal verifies the just-appended durable fact. */
  receivedJournal(reservation: Extract<RequestReservation, { created: true }>): AcceptanceJournal {
    const reference = this.journal(reservation);
    return event => {
      reference(event);
      if (event.kind !== 'intent-request-v2') throw new Error('received receipt requires its canonical request fact');
      const p = intentReceivedPayloadV2Schema.parse(event.payload), row = this.row(reservation.key)!;
      if (row.received !== null || p.worldId !== reservation.key.worldId || p.soulId !== reservation.key.soulId
        || hashOf(p.request) !== row.body_hash || stableStringify(p.source) !== row.source) throw new IntentRequestConflict();
      const receipt = intentReceiptV2Schema.parse({ contract: INTENT_V2, phase: 'received', requestId: p.request.requestId,
        worldId: p.worldId, soulId: p.soulId, seq: event.seq, tick: event.tick });
      this.db.db.prepare('UPDATE intent_requests_v2 SET received=?,updated_at=? WHERE world_id=? AND soul_id=? AND principal_id=? AND request_id=?')
        .run(stableStringify(receipt), Date.now(), ...keyArgs(reservation.key));
      return true;
    };
  }
  /** Named terminal publication writes in the existing acceptance transaction.
   * It does not call finish(), which owns a separate transaction. */
  publicationJournal(reservation: Extract<RequestReservation, { created: true }>): AcceptanceJournal {
    const reference = this.journal(reservation);
    return event => {
      reference(event);
      const fact = intentHistoryFactV2(event), row = this.row(reservation.key)!;
      if (row.received === null || fact.worldId !== reservation.key.worldId || fact.soulId !== reservation.key.soulId)
        throw new Error('publication requires its own canonical received origin');
      this.verifyReceived(reservation.key, row);
      const source = fact.op === 'upsert' ? fact.revision.source : fact.source;
      if (stableStringify(source) !== row.source) throw new IntentRequestConflict();
      const receipt = fact.op === 'upsert'
        ? { contract: INTENT_V2, phase: 'understood', requestId: fact.revision.requestId, revision: fact.revision }
        : { contract: INTENT_V2, phase: 'withdrawn', requestId: fact.requestId, worldId: fact.worldId, soulId: fact.soulId,
          intent: fact.intent, seq: fact.seq, tick: fact.tick };
      this.writeReceipt(reservation, intentReceiptV2Schema.parse(receipt), () => true);
      return true;
    };
  }
  /** Current private lookup of verified log references, without exposing a
   * worker lease. Recovery/filtered events still require reconciliation. */
  events(scope: IntentRequestScope, requestId: string): RequestEventReference[] | null {
    return this.transaction(() => {
      let source: Source;
      try { source = this.check(scope); } catch (error) { if (error instanceof IntentRequestUnavailable) return null; throw error; }
      const key = { worldId: scope.worldId, soulId: scope.soulId, principalId: source.principalId, requestId }, row = this.row(key);
      if (!row || row.owner_id !== source.ownerId) return null;
      const refs = this.db.db.prepare('SELECT seq,tick,kind,event_hash FROM intent_request_events_v2 WHERE world_id=? AND soul_id=? AND principal_id=? AND request_id=? ORDER BY seq')
        .all(...keyArgs(key)) as { seq: number; tick: number; kind: string; event_hash: string }[];
      return refs.map(ref => {
        const fact = this.db.events(scope.worldId, ref.seq - 1, 1)[0];
        if (!fact || fact.tick !== ref.tick || fact.kind !== ref.kind || hashOf(fact) !== ref.event_hash) throw new Error('request event reference failed verification');
        return { seq: ref.seq, tick: ref.tick, kind: ref.kind, eventHash: ref.event_hash };
      });
    });
  }
  /** Trusted worker finalization, never callable with a client-supplied lease.
   * Refusal can be recorded after authority loss as a private historical fact.
   * Understood/withdrawn additionally require a synchronous check against REAL
   * canonical acceptance in the SAME Db transaction, not current live auth.
   * Later revocation affects access, not whether earlier acceptance happened. */
  finish(reservation: Extract<RequestReservation, { created: true }>, raw: unknown, canonicalAcceptance?: AcceptanceGuard): IntentReceiptV2 {
    const receipt = intentReceiptV2Schema.parse(raw);
    if (receipt.phase === 'received') throw new Error('a reservation is not a canonical received receipt');
    return this.transaction(() => this.writeReceipt(reservation, receipt, canonicalAcceptance));
  }
  private writeReceipt(reservation: Extract<RequestReservation, { created: true }>, receipt: IntentReceiptV2, canonicalAcceptance?: AcceptanceGuard): IntentReceiptV2 {
      const row = this.row(reservation.key);
      if (!row || row.lease !== reservation.lease) throw new IntentRequestLeaseLost();
      const stored = view(reservation.key, row), req = stored.request;
      if (receipt.requestId !== req.requestId) throw new IntentRequestConflict();
      if (receipt.phase === 'understood') {
        const r = receipt.revision;
        if (req.op !== 'upsert' || r.worldId !== reservation.key.worldId || r.soulId !== reservation.key.soulId
          || stableStringify(r.source) !== stableStringify(stored.source) || r.words !== req.words
          || r.strict !== req.strict || r.importance !== req.importance || (!req.edit && r.version !== 1)
          || (req.edit && (r.intentId !== req.edit.intentId || r.version !== req.edit.expectedVersion + 1))) throw new IntentRequestConflict();
      } else if (receipt.phase === 'withdrawn') {
        if (req.op !== 'withdraw' || receipt.worldId !== reservation.key.worldId || receipt.soulId !== reservation.key.soulId
          || receipt.intent.intentId !== req.edit.intentId || receipt.intent.version !== req.edit.expectedVersion) throw new IntentRequestConflict();
      }
      if(receipt.phase==='refused'&&receipt.scope&&(receipt.scope.worldId!==reservation.key.worldId||receipt.scope.soulId!==reservation.key.soulId||stableStringify(receipt.scope.source)!==stableStringify(reservation.source)))throw new IntentRequestConflict();
      const encoded = stableStringify(receipt);
      if (row.receipt !== null) {
        if (row.receipt !== encoded) throw new IntentRequestConflict();
        return stored.receipt!;
      }
      if (receipt.phase !== 'refused') {
        if (!canonicalAcceptance) throw new Error('canonical acceptance proof is required before a terminal intent receipt');
        checkAcceptanceGuard(canonicalAcceptance);
      }
      this.db.db.prepare('UPDATE intent_requests_v2 SET receipt=?,updated_at=? WHERE world_id=? AND soul_id=? AND principal_id=? AND request_id=?')
        .run(encoded, Date.now(), ...keyArgs(reservation.key));
      return receipt;
  }
}
