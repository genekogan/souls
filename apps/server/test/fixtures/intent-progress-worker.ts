// A synthetic compiler worker deliberately terminates between durable event
// acceptance and its receipt. Never opens a socket or contacts a model provider.
import { workerData } from 'node:worker_threads';
import { setImmediate } from 'node:timers/promises';
import { toyFactory } from '@souls/engine-toy';
import { type callTool } from '@souls/brain';
import { INTENT_V2 } from '@souls/protocol';
import { Db } from '../../src/db.ts';
import { config } from '../../src/config.ts';
import { Brain } from '../../src/brain.ts';
import { WorldHost } from '../../src/world.ts';
import { captureCompilationFence } from '../../src/compile-fence.ts';
import { IntentRequests } from '../../src/intent-requests.ts';

const db = new Db(workerData.path), host = new WorldHost(db, toyFactory, 'fixture', 1e9, 'eden-fixture'); host.boot();
void host.enqueue('birth', 'fixture', { soulId: 's_A', entityId: 'h_s_A', owner: 'owner', name: 's_A', description: 'fixture' }); host.drainInputs();
const store = new IntentRequests(db), scope = { worldId: host.worldId, soulId: 's_A',
  source: { kind: 'owner' as const, ownerId: 'owner', principalId: 'owner', channel: 'web' as const },
  currentAuthority: (row: import('../../src/db.ts').SoulRow) => row.owner === 'owner' && !!db.user('owner')?.invited_by };
const reservation = store.reserve(scope, { contract: INTENT_V2, requestId: 'crash-one', op: 'upsert', words: 'Rest for a moment' });
if (!reservation.created) throw new Error('fixture must start with no request');
const compilerCall: typeof callTool = async <T>(options: Parameters<typeof callTool>[0]) => {
  options.gate!(0, options.model).settle(0); // durable count of this SYNTHETIC call, cost zero
  const names = ['journal rest', 'journal wait'];
  return { out: { understood: true, agenda: names.map(card => ({ card, target: null })), new_cards: names.map(name => ({
    name, summary: 'Rest a moment', target: null, when: [], then: [{ set: ['$actor', 'doing', 'resting'] }],
    approach: [], during: [{ verb: 'rest', params: { seconds: 1 } }], takes: 'seconds',
  })) } as T, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, request: null, raw: { fixture: true } };
};
const brain = new Brain(host, db, { ...config, brainMode: 'fake', typesafeKey: undefined,
  anthropicKey: 'synthetic-compiler-fixture', compilerModel: 'synthetic-compiler-fixture', budgetUsdPerDay: 0.5 },
  { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {} }, { compilerCall });
brain.mode = 'live';
const apply = host.apply.bind(host);
host.apply = (event, replay) => {
  if (event.kind === 'mint' && workerData.crashPhase === 'before-apply') process.exit(17);
  apply(event, replay);
  if (event.kind === 'mint') process.exit(17);
};
const mind = host.minds.get('s_A')!;
void brain.compile(mind, 'Rest for a moment', false, captureCompilationFence(host, db, mind, scope.currentAuthority), store.journal(reservation));
for (let i = 0; i < 20; i++) { await setImmediate(); host.drainInputs(); }
throw new Error('fixture failed to reach the deliberate termination point');
