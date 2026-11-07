// Actual local dev authentication, HTTP, SQLite, native engine and fake Brain.
// Never imports a live DB, provider credential, service or production bootstrap.
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { marsFactory, GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { Auth } from '../src/auth.ts';
import { Brain } from '../src/brain.ts';
import { config } from '../src/config.ts';
import { Db } from '../src/db.ts';
import { buildApp } from '../src/http.ts';
import type { Hub } from '../src/hub.ts';
import { Souls } from '../src/souls.ts';
import { WorldHost } from '../src/world.ts';

export const seed = 'native-owner-lifecycle';
export const worldId = 'eden-local-lifecycle';
export const factory = await marsFactory(GREEN_FIELD_WORLD);
export async function accept<T>(host: WorldHost, promise: Promise<T>): Promise<T> {
  let done = false; promise.then(() => done = true, () => done = true);
  // At least 50 turns, then on until a 2.5 s bound (just past the create's 2 s HTTP wait): a request that polls on a
  // 20 ms timer (waitLifecycle) can settle a millisecond after 50 fast turns end (lane srv-r5fix-births).
  const bound = performance.now() + 2500;
  for (let i = 0; !done && (i < 50 || performance.now() < bound); i++) { await setImmediate(); host.drainInputs(); }
  assert.ok(done, 'request settled through the actual sequencer'); return promise;
}
export function fixture(path: string, engineFactory = factory, options?:{durableClockV1?:boolean;worldId?:string}) {
  const {worldId:id=worldId,...hostOptions}=options??{};
  const db = new Db(path), host = new WorldHost(db, engineFactory, seed, 1e9, id,hostOptions);
  host.boot(); host.drainInputs();
  const cfg = { ...config, worldId:id, worldKey:'eden', worldPath:'/w/eden', brainMode:'fake' as const,
    budgetUsdPerDay:0, typesafeKey:undefined, anthropicKey:undefined, privyAppId:'', privyAppSecret:'', inviteRequired:true };
  const auth = new Auth(cfg, db); auth.devAuth = true;
  const brain = new Brain(host, db, cfg, { clients:()=>0, onCall(){}, onCamera(){}, onTicker(){}, onNarrative(){}, onTalk(){} });
  const souls = new Souls(host, db, brain, cfg);
  const app = buildApp({ cfg, db, host, auth, brain, souls, hub:{refreshMe(){}, clients:new Map()} as unknown as Hub });
  const request = async (path: string, data?: unknown, owner = 'alice', method = data === undefined ? 'GET' : 'POST') => app.request(path, {
    method, headers:{host:'127.0.0.1:4956',authorization:`Bearer dev:${owner}`,
      ...(data === undefined ? {} : {'content-type':'application/json'})},
    ...(data === undefined ? {} : {body:JSON.stringify(data)}),
  });
  return { db, host, brain, souls, request, app, auth };
}
export async function invite(f: ReturnType<typeof fixture>, owner: string) {
  const issued = await f.request('/v1/admin', { action:'invite', uses:1 }, 'admin');
  assert.equal(issued.status,200); const { code } = await issued.json() as {code:string};
  assert.equal((await f.request('/v1/invite',{code},owner)).status,200);
  assert.equal(f.db.user(`dev:${owner}`)!.role,'user');
}
