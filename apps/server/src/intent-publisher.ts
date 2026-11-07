// Isolated trusted backend producer. No REST/MCP route or capability activation.
import { randomUUID } from 'node:crypto';
import { INTENT_V2, intentPublicationPayloadV2Schema, intentHistoryFactV2, intentRevisionV2Schema,
  type IntentRevisionV2, type IntentPublicationPayloadV2 } from '@souls/protocol';
import { foldIntentHistoryV2 } from './intent-history.ts';
import { IntentRequests, IntentRequestUnavailable, type IntentRequestScope, type RequestReservation } from './intent-requests.ts';
import { checkAcceptanceGuard, type AcceptanceGuard, type WorldHost } from './world.ts';

type OwnedReservation = Extract<RequestReservation, { created: true }>;
export class IntentPurposeConflict extends Error { constructor() { super('purpose version changed or is unavailable'); } }
export class IntentPublisher {
  readonly host: WorldHost; readonly store: IntentRequests;
  constructor(host: WorldHost, store: IntentRequests) { this.host = host; this.store = store;
    if (host.db !== store.db) throw new Error('intent publisher requires the sequencer database');
  }
  /** Bind stable body/mind/ownership and current authorization, independently of
   * unrelated purpose revisions and ordinary actor motion. Trusted scope only. */
  private fence(scope: IntentRequestScope): AcceptanceGuard {
    const host = this.host, row = host.db.soul(scope.soulId), mind = host.minds.get(scope.soulId);
    if (scope.worldId !== host.worldId || !row || !mind) throw new IntentRequestUnavailable();
    const entityId = row.entity_id, owner = row.owner;
    return () => {
      const current = host.db.soul(scope.soulId);
      if (!current || current.retired_at !== null || current.world_id !== host.worldId || current.owner !== owner
        || current.owner !== scope.source.ownerId || current.entity_id !== entityId || host.minds.get(scope.soulId) !== mind
        || !host.engine.world.entities[entityId] || host.kernel.things[scope.soulId]?.traits.body !== entityId
        || scope.currentAuthority(current) !== true) throw new IntentRequestUnavailable();
      return true;
    };
  }
  async receive(scope: IntentRequestScope, raw: unknown) {
    const guard = this.fence(scope), reservation = this.store.reserve(scope, raw);
    if (reservation.created) {
      await this.host.enqueueChecked('intent-request-v2', `soul:${scope.soulId}`, {
        contract: INTENT_V2, worldId: scope.worldId, soulId: scope.soulId, request: reservation.request, source: reservation.source,
      }, guard, this.store.receivedJournal(reservation));
    }
    // A crash-pending reservation still has no received receipt; no new worker
    // lease or interpretation is issued to a duplicate.
    return { reservation, request: this.store.lookup(scope, reservation.request.requestId) };
  }
  /** Capture before interpretation, and carry the same body/principal/purpose
   * fence through compiler mint/deal admission and final publication. The
   * compiler callback must use guard for every effect it may publish. */
  async interpretAndPublish(scope: IntentRequestScope, reservation: OwnedReservation,
    interpret: (guard: AcceptanceGuard) => Promise<IntentRevisionV2['interpretation']>,extraGuard?:AcceptanceGuard) {
    if (reservation.request.op !== 'upsert') throw new Error('withdrawal does not require interpretation');
    const guard = this.preparationFence(scope, reservation);
    const interpretation = await interpret(guard);
    checkAcceptanceGuard(guard);
    const combined=()=>{checkAcceptanceGuard(guard);if(extraGuard)checkAcceptanceGuard(extraGuard);return true as const;};return this.publish(scope, reservation, interpretation, combined);
  }
  private preparationFence(scope: IntentRequestScope, reservation: OwnedReservation): AcceptanceGuard {
    if (reservation.key.worldId !== scope.worldId || reservation.key.soulId !== scope.soulId
      || reservation.key.principalId !== scope.source.principalId) throw new IntentRequestUnavailable();
    const authority = this.fence(scope), req = reservation.request;
    const received = this.store.lookup(scope, req.requestId)?.received;
    if (!received) throw new Error('publication requires canonical receipt before interpretation');
    const guard = () => {
      authority();
      if (req.edit) {
        const history = this.host.intentHistoryOf(scope.soulId);
        const entry = Object.hasOwn(history.intents, req.edit.intentId) ? history.intents[req.edit.intentId] : undefined;
        if (!entry || entry.revision.version !== req.edit.expectedVersion
          || (entry.status === 'withdrawn' && (req.op === 'withdraw' || received.seq <= entry.statusSeq)))
          throw new IntentPurposeConflict();
      }
      return true as const;
    };
    checkAcceptanceGuard(guard);
    return guard;
  }
  /** Publish trusted interpretation/withdrawal after real compiler work. Exact
   * purpose admission happens under the writer lock; this method does no model
   * work, direct physical action, fulfilment or automatic crash reconciliation. */
  async publish(scope: IntentRequestScope, reservation: OwnedReservation, interpretation?: IntentRevisionV2['interpretation'], prepared?: AcceptanceGuard) {
    const authority = this.preparationFence(scope, reservation), req = reservation.request;
    if (prepared) checkAcceptanceGuard(prepared);
    const p: IntentPublicationPayloadV2 = req.op === 'upsert'
      ? { contract: INTENT_V2, worldId: scope.worldId, soulId: scope.soulId, op: 'upsert', revision: {
        intentId: req.edit?.intentId ?? `i_${randomUUID()}`, version: (req.edit?.expectedVersion ?? 0) + 1,
        worldId: scope.worldId, soulId: scope.soulId, requestId: req.requestId, source: reservation.source,
        words: req.words, strict: req.strict, importance: req.importance,
        interpretation: intentRevisionV2Schema.shape.interpretation.parse(interpretation),
      } }
      : { contract: INTENT_V2, worldId: scope.worldId, soulId: scope.soulId, op: 'withdraw',
        requestId: req.requestId, source: reservation.source, intent: { intentId: req.edit.intentId, version: req.edit.expectedVersion } };
    const payload = intentPublicationPayloadV2Schema.parse(p);
    const guard = () => {
      authority();
      if (prepared) checkAcceptanceGuard(prepared);
      const history = this.host.intentHistoryOf(scope.soulId);
      // Preview the exact envelope at the acceptance point before persistence.
      foldIntentHistoryV2(history, intentHistoryFactV2({ kind: 'intent-v2', payload, seq: this.host.seq + 1, tick: this.host.engine.world.tick }));
      return true as const;
    };
    const event = await this.host.enqueueChecked('intent-v2', `soul:${scope.soulId}`, payload, guard, this.store.publicationJournal(reservation));
    return { event, receipt: this.store.lookup(scope, req.requestId)?.receipt ?? null };
  }
}
