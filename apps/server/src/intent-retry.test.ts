// Pure selection over validated durable history; native crowd proof is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {INTENT_V2, type IntentHistoryEventV2} from '@souls/protocol';
import {replayIntentHistoryV2} from './intent-history.ts';
import {blockedDirectionForRetry} from './intent-retry.ts';
const scope = {contract: INTENT_V2, worldId: 'retry-world', soulId: 's_A'};
function upsert(seq = 1, intentId = 'go', version = 1, now = true): IntentHistoryEventV2 {
  return {...scope, op: 'upsert', seq, tick: seq, revision: {worldId: scope.worldId, soulId: scope.soulId,
    intentId, version, requestId: 'request-'+seq,
    source: {kind: 'owner', ownerId: 'owner', principalId: 'owner', channel: 'web'}, submitted: {seq, tick: seq},
    words: 'PRIVATE_RETRY go to the fire', strict: true, importance: 0.8,
    interpretation: {summary: 'Walk to the fire.', agenda: [{card: 'go to', target: 'campfire'}], trigger: {kind: now ? 'now' : 'none'}}
  }} as IntentHistoryEventV2;
}
function outcome(seq: number, phase: 'accepted'|'started'|'blocked'|'completed'|'interrupted', attemptId = 'a_1'): IntentHistoryEventV2 {
  return {...scope, op: 'outcome', seq, tick: seq, outcome: {...scope, seq, tick: seq, intent: {intentId: 'go', version: 1},
    attemptId, activityId: 'program_'+attemptId, phase, evidence: {seq: seq-1, tick: seq-1, kind: phase === 'accepted' ? 'admission' : 'controller'},
    ...(['blocked','interrupted'].includes(phase) ? {reason: 'Actual recorded terminal.'} : {})}} as IntentHistoryEventV2;
}
function history(events: IntentHistoryEventV2[]) {return replayIntentHistoryV2(scope.worldId, scope.soulId, events);}
const blocked = () => [upsert(), outcome(2, 'accepted'), outcome(3, 'started'), outcome(4, 'blocked')];

test('recorded block becomes reconsiderable after cooldown; JSON reconstruction needs no retry state', () => {
  const h = history(blocked()), before = JSON.stringify(h);
  assert.equal(blockedDirectionForRetry(h, 'owner', 1203), undefined);
  assert.equal(blockedDirectionForRetry(h, 'owner', 1204)?.intentId, 'go');
  assert.deepEqual(blockedDirectionForRetry(JSON.parse(before), 'owner', 1204), h.intents.go.revision);
  assert.equal(JSON.stringify(h), before); assert.equal(blockedDirectionForRetry(h, 'new-owner', 1204), undefined);
});

test('newer optional work, withdrawal and edit never resurrect an old blocked direction', () => {
  const withdrawn = {...scope, op: 'withdraw', seq: 5, tick: 5, requestId: 'withdraw-5',
    source: {kind: 'owner', ownerId: 'owner', principalId: 'owner', channel: 'web'}, intent: {intentId: 'go', version: 1}} as IntentHistoryEventV2;
  for (const event of [upsert(5, 'preference', 1, false), upsert(5, 'go', 2), withdrawn]) {
    const h = history([...blocked(), event]); assert.equal(blockedDirectionForRetry(h, 'owner', 5000), undefined);
  }
});

test('latest accepted/started/completed/interrupted attempt excludes retries despite an older block', () => {
  const suffix = [outcome(5, 'accepted', 'a_2'), outcome(6, 'started', 'a_2'), outcome(7, 'completed', 'a_2')];
  for (let n = 1; n <= suffix.length; n++) assert.equal(blockedDirectionForRetry(history([...blocked(), ...suffix.slice(0,n)]), 'owner', 5000), undefined);
  const h = history([...blocked(), outcome(5, 'accepted', 'a_2'), outcome(6, 'interrupted', 'a_2')]);
  assert.equal(blockedDirectionForRetry(h, 'owner', 5000), undefined); assert.equal(h.intents.go.status, 'active');
});

test('understanding without a block and multi-step work remain context, not a retry', () => {
  assert.equal(blockedDirectionForRetry(history([upsert()]), 'owner', 5000), undefined);
  const event = upsert() as Extract<IntentHistoryEventV2,{op:'upsert'}>;
  event.revision.interpretation.agenda.push({card: 'rest', target: null});
  assert.equal(blockedDirectionForRetry(history([event, ...blocked().slice(1)]), 'owner', 5000), undefined);
});
