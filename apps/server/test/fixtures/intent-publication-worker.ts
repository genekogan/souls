import { parentPort, workerData } from 'node:worker_threads';
import { setImmediate } from 'node:timers/promises';
import { toyFactory } from '@souls/engine-toy';
import { INTENT_V2 } from '@souls/protocol';
import { Db } from '../../src/db.ts';
import { IntentPublisher } from '../../src/intent-publisher.ts';
import { IntentRequests, type IntentRequestScope } from '../../src/intent-requests.ts';
import { WorldHost } from '../../src/world.ts';

const db = new Db(workerData.path), host = new WorldHost(db, toyFactory, 'publication-fixture', 1e9, 'eden-fixture'); host.boot();
const store = new IntentRequests(db), publisher = new IntentPublisher(host, store);
const scope: IntentRequestScope = { worldId: host.worldId, soulId: 's_A', source: { kind: 'owner', ownerId: 'dev:owner', principalId: 'PRIVATE_PRINCIPAL', channel: 'web' },
  currentAuthority: row => row.owner === 'dev:owner' && !!db.user('dev:owner')?.invited_by };
const pending = publisher.receive(scope, { contract: INTENT_V2, requestId: 'worker-publication', op: 'upsert', words: 'Remember the unfinished project' });
host.drainInputs(); const reservation = (await pending).reservation;
if (!reservation.created) throw new Error('worker needs its original lease');
const apply = host.apply.bind(host);
host.apply = (event, replay) => {
  if (event.kind === 'intent-v2' && workerData.phase === 'before-apply') process.exit(19);
  const result = apply(event, replay);
  if (event.kind === 'intent-v2' && workerData.phase === 'after-apply') process.exit(19);
  return result;
};
const published = publisher.publish(scope, reservation, { summary: 'Rest and remember', agenda: [{ card: 'rest', target: null }], trigger: { kind: 'none' } });
host.drainInputs(); await published; await setImmediate();
parentPort?.postMessage('unexpected publication completion'); db.close();
