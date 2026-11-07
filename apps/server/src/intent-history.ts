// Pure G-002 private projection used by WorldHost's named opt-in log handler.
// Caller must authenticate/revalidate producers and retain the canonical events.
// Evidence references are checked structurally here; this does not prove physics.
import { intentHistoryEventV2Schema, type IntentHistoryEventV2, type IntentRevisionV2, type IntentOutcomeV2 } from '@souls/protocol';

type Entry = { revision: IntentRevisionV2; status: 'active' | 'blocked' | 'fulfilled' | 'withdrawn'; statusSeq: number; report: string | null };
export type IntentHistoryV2 = {
  worldId: string; soulId: string; lastSeq: number; lastTick: number;
  intents: Record<string, Entry>; attempts: Record<string, IntentOutcomeV2>;
};
export function emptyIntentHistoryV2(worldId: string, soulId: string): IntentHistoryV2 {
  return { worldId, soulId, lastSeq: 0, lastTick: 0, intents: {}, attempts: {} };
}
function fail(message: string): never { throw new Error(`intent-history: ${message}`); }
const terminal = new Set(['blocked', 'completed', 'interrupted']);
export function foldIntentHistoryV2(state: IntentHistoryV2, raw: unknown): IntentHistoryV2 {
  const event = intentHistoryEventV2Schema.parse(raw);
  if (event.worldId !== state.worldId || event.soulId !== state.soulId) fail('wrong world or Soul');
  if (event.seq <= state.lastSeq) fail('events must be applied once in canonical sequence order');
  if (event.tick < state.lastTick) fail('canonical world tick cannot go backwards');
  const next = structuredClone(state);
  const entry = (ref: { intentId: string; version: number }) => {
    const found = Object.hasOwn(next.intents, ref.intentId) ? next.intents[ref.intentId] : undefined;
    if (!found || found.revision.version !== ref.version) fail('unknown or stale intention version');
    return found;
  };
  if (event.op === 'upsert') {
    const r = event.revision, old = Object.hasOwn(next.intents, r.intentId) ? next.intents[r.intentId] : undefined;
    if (r.worldId !== event.worldId || r.soulId !== event.soulId || r.submitted.seq !== event.seq || r.submitted.tick !== event.tick) fail('revision scope/origin mismatch');
    if (r.version !== (old?.revision.version ?? 0) + 1) fail('revision must advance exactly once');
    next.intents[r.intentId] = { revision: r, status: 'active', statusSeq: event.seq, report: null };
    // Other purposes and all earlier attempt references remain. The accepted
    // event log retains earlier revisions, rather than a daily FIFO of work.
  } else if (event.op === 'withdraw') {
    const current = entry(event.intent);
    current.status = 'withdrawn'; current.statusSeq = event.seq; current.report = 'Withdrawn by an authorized owner instruction.';
  } else if (event.op === 'resolve') {
    const current = entry(event.intent);
    if (current.status === 'withdrawn') fail('a withdrawn purpose needs an explicit new revision');
    if (event.evidence.seq > event.seq || event.evidence.tick > event.tick) fail('resolution evidence is in the future');
    if (event.status === 'fulfilled' && event.evidence.kind === 'admission') fail('admission alone cannot fulfil a purpose');
    current.status = event.status; current.statusSeq = event.seq; current.report = event.reason;
  } else {
    const out = event.outcome;
    const previous = Object.hasOwn(next.attempts, out.attemptId) ? next.attempts[out.attemptId] : undefined;
    const current = Object.hasOwn(next.intents, out.intent.intentId) ? next.intents[out.intent.intentId] : undefined;
    if (!current) fail('unknown intention');
    if (current.revision.version !== out.intent.version && !(previous && terminal.has(out.phase)
      && previous.intent.intentId === out.intent.intentId && previous.intent.version === out.intent.version)) fail('unknown or stale intention version');
    if (out.worldId !== event.worldId || out.soulId !== event.soulId || out.seq !== event.seq || out.tick !== event.tick) fail('outcome scope/origin mismatch');
    // A physical terminal observation may arrive after withdrawal. It remains
    // evidence of the actual activity, without reactivating the withdrawn will.
    if (current.status !== 'active' && !terminal.has(out.phase)) fail('inactive purpose cannot start new work');
    if (previous && (previous.intent.intentId !== out.intent.intentId || previous.intent.version !== out.intent.version)) fail('attempt belongs to a different purpose version');
    if (previous && terminal.has(previous.phase)) fail('attempt is already terminal');
    if (out.phase === 'accepted' && previous) fail('attempt was already admitted');
    if (out.phase === 'blocked' && previous && out.evidence.kind !== 'controller') fail('admitted activity block needs controller evidence');
    if (out.phase === 'blocked' && !previous && out.evidence.kind !== 'admission') fail('controller block requires an admitted attempt');
    if (out.phase === 'started' && previous?.phase !== 'accepted') fail('start requires an admitted attempt');
    if (out.phase === 'completed' && previous?.phase !== 'started') fail('completion requires an observed start');
    if (out.phase === 'interrupted' && previous?.phase !== 'accepted' && previous?.phase !== 'started') fail('interruption requires an admitted attempt');
    if (previous && 'activityId' in previous && 'activityId' in out && previous.activityId !== out.activityId) fail('activity identity changed');
    next.attempts[out.attemptId] = out;
    // Completion/interruption of an attempt never automatically fulfils or
    // destroys the broader purpose. Resolution is a separate evidenced event.
  }
  next.lastSeq = event.seq; next.lastTick = event.tick;
  return next;
}
export function replayIntentHistoryV2(worldId: string, soulId: string, events: readonly IntentHistoryEventV2[]) {
  return events.reduce<IntentHistoryV2>(foldIntentHistoryV2, emptyIntentHistoryV2(worldId, soulId));
}
