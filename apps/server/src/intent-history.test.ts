import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '@souls/engine-contract';
import { INTENT_V2, intentRequestV2Schema, intentReceiptV2Schema, intentOutcomeV2Schema, publicIntentHistoryEventV2, type IntentHistoryEventV2 } from '@souls/protocol';
import { emptyIntentHistoryV2, foldIntentHistoryV2, replayIntentHistoryV2 } from './intent-history.ts';

const scope = { contract: INTENT_V2, worldId: 'eden-fixture', soulId: 's_Alice' };
const source = { kind: 'owner' as const, ownerId: 'human-alice', principalId: 'human-alice', channel: 'web' as const };
function upsert(seq: number, intentId: string, version = 1, words = 'Make newcomers welcome'): IntentHistoryEventV2 {
  return { ...scope, op: 'upsert', seq, tick: seq * 10, revision: {
    worldId: scope.worldId, soulId: scope.soulId, intentId, version, requestId: `request-${seq}`, source, submitted: { seq, tick: seq * 10 },
    words, strict: intentId === 'quiet', importance: 0.8,
    interpretation: { summary: words, agenda: [], trigger: { kind: 'none' } },
  } } as IntentHistoryEventV2;
}
function outcome(seq: number, intentId: string, phase: 'accepted' | 'started' | 'completed' | 'interrupted' | 'blocked', version = 1): IntentHistoryEventV2 {
  const out = { ...scope, seq, tick: seq * 10, intent: { intentId, version }, attemptId: `attempt-${intentId}`,
    phase, activityId: `activity-${intentId}`, evidence: { seq: seq - 1, tick: seq * 10 - 1, kind: phase === 'accepted' ? 'admission' : 'controller' },
    ...(['interrupted', 'blocked'].includes(phase) ? { reason: 'The supported activity stopped.' } : {}),
  };
  return { ...scope, op: 'outcome', seq, tick: seq * 10, outcome: out } as IntentHistoryEventV2;
}

test('candidate v2 client grammar carries one general edit/withdraw mechanism and refuses forged authority or progress', () => {
  const request = { contract: INTENT_V2, requestId: 'request-1', op: 'upsert', words: 'Please go to the campfire' };
  const parsed = intentRequestV2Schema.parse(request); assert.equal(parsed.op, 'upsert');
  if (parsed.op === 'upsert') { assert.equal(parsed.strict, false); assert.equal(parsed.importance, 0.5); }
  for (const extra of [{ source }, { worldId: 'other' }, { understanding: 'done' }, { phase: 'completed' }, { activityId: 'a' }]) {
    assert.equal(intentRequestV2Schema.safeParse({ ...request, ...extra }).success, false);
  }
  assert.equal(intentRequestV2Schema.safeParse({ ...request, words: '   ' }).success, false);
  assert.equal(intentRequestV2Schema.safeParse({ ...request, edit: { intentId: 'x' } }).success, false);
  assert.equal(intentRequestV2Schema.safeParse({ contract: INTENT_V2, requestId: 'w', op: 'withdraw', edit: { intentId: 'x', expectedVersion: 2 } }).success, true);
  const event = upsert(1, 'x') as Extract<IntentHistoryEventV2, { op: 'upsert' }>;
  assert.equal(intentReceiptV2Schema.safeParse({ contract: INTENT_V2, requestId: 'different', phase: 'understood', revision: event.revision }).success, false);
});

test('accumulated purposes survive interruption, preserve strict context and replay from accepted JSON without models', () => {
  const events = [upsert(1, 'quiet', 1, 'PRIVATE_INTENT_QUIET'), upsert(2, 'welcome'), outcome(3, 'welcome', 'accepted'),
    outcome(4, 'welcome', 'started'), outcome(5, 'welcome', 'interrupted')];
  let state = emptyIntentHistoryV2(scope.worldId, scope.soulId);
  for (const e of events) state = foldIntentHistoryV2(state, e);
  assert.equal(state.intents.quiet.revision.strict, true); assert.equal(state.intents.quiet.status, 'active');
  assert.equal(state.intents.welcome.status, 'active'); assert.equal(state.attempts['attempt-welcome'].phase, 'interrupted');
  const recovered = replayIntentHistoryV2(scope.worldId, scope.soulId, JSON.parse(JSON.stringify(events)));
  assert.equal(hashOf(recovered), hashOf(state));
  assert.equal(JSON.stringify(recovered).includes('PRIVATE_INTENT_QUIET'), true, 'this projection is private');
  const publicEvents = events.map(publicIntentHistoryEventV2);
  for (const marker of ['PRIVATE_INTENT_QUIET', 'human-alice', 'Make newcomers welcome', 'activity-welcome', 'request-1']) {
    assert.equal(JSON.stringify(publicEvents).includes(marker), false);
  }
  const before = hashOf(state); foldIntentHistoryV2(state, upsert(6, 'explore')); assert.equal(hashOf(state), before, 'immutable projection');
});

test('attempt completion needs an observed start and never automatically fulfils a broader purpose', () => {
  let state = replayIntentHistoryV2(scope.worldId, scope.soulId, [upsert(1, 'welcome'), outcome(2, 'welcome', 'accepted')]);
  assert.throws(() => foldIntentHistoryV2(state, outcome(3, 'welcome', 'completed')), /observed start/);
  state = foldIntentHistoryV2(state, outcome(3, 'welcome', 'started'));
  state = foldIntentHistoryV2(state, outcome(4, 'welcome', 'completed'));
  assert.equal(state.intents.welcome.status, 'active'); assert.equal(state.attempts['attempt-welcome'].phase, 'completed');
  assert.throws(() => foldIntentHistoryV2(state, outcome(5, 'welcome', 'started')), /already terminal/);
  const invalid = { ...(outcome(5, 'welcome', 'completed') as Extract<IntentHistoryEventV2, { op: 'outcome' }>).outcome, evidence: { seq: 4, tick: 49, kind: 'admission' } };
  assert.equal(intentOutcomeV2Schema.safeParse(invalid).success, false);
});

test('edits retain other purposes and permit truthful terminal observations of already-started older work', () => {
  let state = replayIntentHistoryV2(scope.worldId, scope.soulId, [upsert(1, 'quiet'), upsert(2, 'welcome'),
    outcome(3, 'welcome', 'accepted'), outcome(4, 'welcome', 'started'), upsert(5, 'welcome', 2, 'Welcome quietly')]);
  assert.equal(state.intents.quiet.revision.version, 1); assert.equal(state.intents.welcome.revision.words, 'Welcome quietly');
  state = foldIntentHistoryV2(state, outcome(6, 'welcome', 'interrupted', 1));
  assert.equal(state.intents.welcome.revision.version, 2); assert.equal(state.intents.welcome.status, 'active');
  assert.throws(() => foldIntentHistoryV2(state, { ...outcome(7, 'welcome', 'accepted', 1), outcome: {
    ...(outcome(7, 'welcome', 'accepted', 1) as Extract<IntentHistoryEventV2, { op: 'outcome' }>).outcome, attemptId: 'different-attempt' } }), /stale intention version/);
  assert.throws(() => foldIntentHistoryV2(state, upsert(7, 'welcome', 4)), /advance exactly once/);
});

test('withdrawal preserves history, prevents new work and still records a real controller cancellation', () => {
  let state = replayIntentHistoryV2(scope.worldId, scope.soulId, [upsert(1, 'welcome'), outcome(2, 'welcome', 'accepted')]);
  state = foldIntentHistoryV2(state, { ...scope, seq: 3, tick: 30, op: 'withdraw', intent: { intentId: 'welcome', version: 1 }, requestId: 'withdraw-1', source });
  assert.throws(() => foldIntentHistoryV2(state, outcome(4, 'welcome', 'started')), /inactive purpose/);
  state = foldIntentHistoryV2(state, outcome(4, 'welcome', 'interrupted'));
  assert.equal(state.intents.welcome.status, 'withdrawn'); assert.equal(state.intents.welcome.revision.words, 'Make newcomers welcome');
});

test('wrong scope, out-of-order, invented activity identity and admission-only fulfilment fail before mutation', () => {
  const state = replayIntentHistoryV2(scope.worldId, scope.soulId, [upsert(1, 'welcome'), outcome(2, 'welcome', 'accepted')]);
  const before = hashOf(state);
  assert.throws(() => foldIntentHistoryV2(state, { ...upsert(3, 'quiet'), worldId: 'mars-fixture' }), /wrong world/);
  assert.throws(() => foldIntentHistoryV2(state, upsert(1, 'quiet')), /canonical sequence/);
  assert.throws(() => foldIntentHistoryV2(state, { ...upsert(3, 'quiet'), tick: 0 }), /tick cannot go backwards/);
  const changed = outcome(3, 'welcome', 'started') as Extract<IntentHistoryEventV2, { op: 'outcome' }>;
  assert.throws(() => foldIntentHistoryV2(state, { ...changed, outcome: { ...changed.outcome, activityId: 'unrelated' } }), /activity identity changed/);
  assert.throws(() => foldIntentHistoryV2(state, { ...scope, seq: 3, tick: 30, op: 'resolve', intent: { intentId: 'welcome', version: 1 },
    status: 'fulfilled', reason: 'I accepted it', evidence: { seq: 2, tick: 20, kind: 'admission' } }), /admission alone/);
  assert.equal(hashOf(state), before);
});

test('admission refusal and controller failure have distinct evidence, and failure retains purpose', () => {
  let state = replayIntentHistoryV2(scope.worldId, scope.soulId, [upsert(1, 'welcome')]);
  const block = outcome(2, 'welcome', 'blocked') as Extract<IntentHistoryEventV2, { op: 'outcome' }>;
  assert.throws(() => foldIntentHistoryV2(state, block), /requires an admitted attempt/);
  const refusal = { ...block, outcome: { ...block.outcome, evidence: { seq: 1, tick: 10, kind: 'admission' } } };
  const refused = foldIntentHistoryV2(state, refusal); assert.equal(refused.intents.welcome.status, 'active');
  state = foldIntentHistoryV2(state, outcome(2, 'welcome', 'accepted'));
  state = foldIntentHistoryV2(state, outcome(3, 'welcome', 'blocked'));
  assert.equal(state.intents.welcome.status, 'active'); assert.equal(state.attempts['attempt-welcome'].phase, 'blocked');
});
