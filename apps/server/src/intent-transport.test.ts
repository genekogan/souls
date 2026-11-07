// Actual local dev authentication / Hono / native engine / SQLite / TCP+WS.
// Compiler responses are synthetic; Jev is fake; no provider or paid call.
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate,setTimeout as delay} from 'node:timers/promises';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {getRequestListener} from '@hono/node-server';
import WebSocket from 'ws';
import {INTENT_V2,PROTO,intentReceiptV2Schema,publicEvent} from '@souls/protocol';
import {hashToken} from './auth.ts';
import {buildApp} from './http.ts';
import {Hub} from './hub.ts';
import {IntentControlV2} from './intent-control.ts';
import {migrate} from './migrations.ts';
import {replayFromGenesis} from './world.ts';
import {intentNativeFixture as fixture,seed,worldId} from '../test/intent-native-fixture.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

const request=(requestId:string,words='go to the campfire')=>({contract:INTENT_V2,requestId,op:'upsert',words});
async function accept<T>(f:ReturnType<typeof fixture>,promise:Promise<T>) {
  let done=false;promise.then(()=>done=true,()=>done=true);
  for(let i=0;i<100&&!done;i++){await setImmediate();f.host.drainInputs();}
  assert.ok(done,'actual sequencer settled request');return promise;
}
// Over a real socket the bytes travel outside the event loop (Modal's gVisor loopback delivers them from its own netstack),
// so no count of turns bounds a TCP round trip. Drain on every turn, as a running host's frame loop would, until the
// response actually arrives; a request that needs a tick or never settles still fails, at the deadline.
async function acceptOverTcp<T>(f:ReturnType<typeof fixture>,promise:Promise<T>,ms=10_000) {
  let done=false;promise.then(()=>done=true,()=>done=true);
  for(const until=Date.now()+ms;!done&&Date.now()<until;){await setImmediate();f.host.drainInputs();}
  assert.ok(done,'actual sequencer settled request over TCP');return promise;
}
/** Resolves once a message of type `type` has arrived on the actual socket (or already has). */
function arrived(socket:WebSocket,messages:string[],type:string,ms=10_000) {
  const has=()=>messages.some(m=>JSON.parse(m).t===type);
  return new Promise<void>((resolve,reject)=>{
    if(has())return resolve();
    const check=()=>{if(has()){clearTimeout(timer);socket.off('message',check);resolve();}};
    const timer=setTimeout(()=>{socket.off('message',check);reject(new assert.AssertionError({message:'no '+type+' message arrived over the actual socket'}));},ms);
    socket.on('message',check);
  });
}
async function settled(f:ReturnType<typeof fixture>) {await accept(f,f.service.settled());}
async function ticks(f:ReturnType<typeof fixture>,n:number,stop=()=>false) {
  for(let i=0;i<n&&!stop();i++){f.host.tickOnce();if(i%10===0)await setImmediate();}
}
async function receipt(response:Response,phase?:string) {
  assert.equal(response.headers.get('cache-control'),'no-store');const parsed=intentReceiptV2Schema.parse(await response.json());
  assert.equal(response.status,parsed.phase==='received'?202:200);if(phase)assert.equal(parsed.phase,phase);return parsed;
}
function token(f:ReturnType<typeof fixture>,value='sim_s_A_LOCAL_FAKE_GENERATION') {f.db.setSoulToken('s_A',hashToken(value),'local');return value;}

test('migration14 preserves preexisting owner/token/history and lazily assigns no authority-derived generation',async t=>{
  const f=fixture(t),credential=token(f),events=JSON.stringify(f.db.events(worldId));
  const {token_generation:ignored,...old}=f.db.soul('s_A')!;
  f.db.db.exec('ALTER TABLE souls DROP COLUMN token_generation; DELETE FROM schema_migrations WHERE id=14');
  assert.deepEqual(migrate(f.db.db),[14]);assert.deepEqual(migrate(f.db.db),[]);
  assert.deepEqual({...f.db.soul('s_A')},{...old,token_generation:null});assert.equal(JSON.stringify(f.db.events(worldId)),events);
  assert.ok(f.souls.soulFromToken(credential));assert.equal(f.db.soul('s_A')!.token_generation,null,'legacy lookup does not assign candidate identity');
  const scope=f.service.agentScope(credential);assert.match(scope.source.principalId,/^g_/);
  assert.equal(f.service.agentScope(credential).source.principalId,scope.source.principalId);
  assert.equal(JSON.stringify(f.db.events(worldId)),events,'generation is private adapter identity, not an action or canonical intent');
});

test('HTTP ordinary direction wakes native sleep, retains a standing purpose, and replays without models',async t=>{
  const f=fixture(t);
  await receipt(await accept(f,f.post(request('standing','PRIVATE_OWNER_WORDS make friends if you feel like it'))));await settled(f);
  f.mind.nextEvalTick=1e9;
  await accept(f,f.host.enqueue('decision','fixture',{soulId:'s_A',entityId:'h_A',option:'sleep',label:'sleep on mat',
    steps:[{verb:'mars:sleep',params:{mat:'mat-1',duration:600}}],reevalTicks:1e9,fallback:false,trigger:'fixture'}));
  await ticks(f,1800,()=>f.host.engine.world.entities.h_A.human!.activity==='sleep');
  assert.equal(f.host.engine.world.entities.h_A.human!.activity,'sleep');const sleeping=f.host.engine.programOf('h_A');
  let release!:()=>void;f.hold=new Promise<void>(resolve=>release=resolve);
  const received=await receipt(await accept(f,f.post(request('ordinary'))),'received');
  assert.equal(f.host.engine.programOf('h_A'),sleeping);
  for(let i=0;i<20&&f.calls<2;i++)await setImmediate();assert.equal(f.calls,2,'one interpreter starts asynchronously after the durable receipt');
  await receipt(await f.lookup('ordinary'),'received');release();await settled(f);
  const understood=await receipt(await f.lookup('ordinary'),'understood');assert.equal(understood.phase,'understood');
  const published=f.db.events(worldId).filter(e=>e.kind==='intent-v2').at(-1)!;
  await ticks(f,100,()=>f.host.engine.world.entities.h_A.human!.activity==='walk');const walking=f.host.engine.world.tick;
  assert.equal(f.host.engine.world.entities.h_A.human!.activity,'walk');assert.ok(walking-published.tick<=100);
  await ticks(f,1800,()=>f.host.kernel.things.s_A.at==='campfire');assert.equal(f.host.kernel.things.s_A.at,'campfire');
  assert.equal(Object.keys(f.host.intentHistoryOf('s_A').intents).length,2);
  assert.ok(JSON.stringify(f.brain.midContext(f.mind,'timer').purposes).includes('PRIVATE_OWNER_WORDS'));
  assert.ok(!JSON.stringify(f.db.events(worldId).map(publicEvent)).includes('PRIVATE_OWNER_WORDS'));
  assert.equal(replayFromGenesis(f.host.factory,seed,f.db.events(worldId),f.host.engine.world.tick).engine.stateHash(),f.host.engine.stateHash());
  assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
  t.diagnostic(`canonical received=${received.phase==='received'?received.tick:-1}; publication=${published.tick}; walking=${walking}; arrival=${f.host.engine.world.tick}; compiler calls=${f.calls}; paid=$0`);
});

test('durable retries use semantic defaults, terminal lookup, and never repeat interpretation or accepted effects',async t=>{
  const f=fixture(t);let release!:()=>void;f.hold=new Promise<void>(resolve=>release=resolve);
  await receipt(await accept(f,f.post(request('retry'))),'received');const before=f.db.events(worldId).length;
  await receipt(await accept(f,f.post({...request('retry'),strict:false,importance:.5})),'received');
  assert.equal(f.calls,1);assert.equal(f.db.events(worldId).length,before);
  const conflict=await f.post(request('retry','different words'));assert.equal(conflict.status,409);assert.equal(conflict.headers.get('cache-control'),'no-store');
  release();await settled(f);const terminal=await receipt(await f.lookup('retry'),'understood');
  assert.deepEqual(await receipt(await accept(f,f.post(request('retry'))),'understood'),terminal);assert.equal(f.calls,1);
  assert.equal(f.db.events(worldId).filter(e=>e.kind==='intent-v2').length,1);
});

test('failed received transaction and unrecorded reservation never fabricate receipt or issue a second worker',async t=>{
  const f=fixture(t),append=f.db.appendEvent.bind(f.db);
  t.mock.method(f.db,'appendEvent',(...args:Parameters<typeof append>)=>{if(args[1].kind==='intent-request-v2')throw new Error('PRIVATE_SQL_FAILURE');return append(...args);});
  const failure=await accept(f,f.post(request('unrecorded')));assert.equal(failure.status,503);assert.equal(failure.headers.get('cache-control'),'no-store');
  assert.ok(!(await failure.text()).includes('PRIVATE_SQL_FAILURE'));assert.equal((await f.lookup('unrecorded')).status,404);
  t.mock.method(f.db,'appendEvent',append);
  const duplicate=await accept(f,f.post(request('unrecorded')));assert.equal(duplicate.status,503);assert.equal(f.calls,0);
  assert.equal(f.db.events(worldId).filter(e=>e.kind.startsWith('intent-')).length,0);
});

test('corrupt retained receipt is unavailable, never unknown or a reason to repeat the compiler',async t=>{
  const f=fixture(t);await receipt(await accept(f,f.post(request('corrupt'))));await settled(f);const calls=f.calls;
  f.db.db.prepare("UPDATE intent_requests_v2 SET receipt='{}' WHERE request_id='corrupt'").run();
  const response=await f.lookup('corrupt');assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(f.calls,calls);assert.ok(!(await response.text()).includes('ZodError'));
});

for(const changed of ['body','invite','rotation'] as const)test(`queued received acceptance rechecks ${changed} under the real writer lock`,async t=>{
  const f=fixture(t),agent=changed==='rotation',credential=agent?token(f):'dev:alice';
  const pending=f.post(request('queued'),credential,agent);await setImmediate();
  if(changed==='body')f.host.engine.world.entities.h_A.human!.soul='foreign-soul';
  if(changed==='invite')f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();
  if(changed==='rotation')token(f,'sim_s_A_LOCAL_QUEUED_ROTATION');
  f.host.drainInputs();const response=await pending;assert.equal(response.status,changed==='body'?409:changed==='invite'?403:401);
  assert.equal(f.db.events(worldId).filter(e=>e.kind.startsWith('intent-')).length,0);assert.equal(f.calls,0);
});

test('two ordinary owners, explicit operator audit, unknown/inaccessible lookup and forged sources',async t=>{
  const f=fixture(t);
  assert.equal((await f.post(request('bob'),'dev:bob')).status,403);
  await receipt(await accept(f,f.post(request('owner'))));await settled(f);
  const hidden=await f.lookup('owner','dev:bob'),unknown=await f.lookup('missing','dev:bob');
  assert.equal(hidden.status,404);assert.equal(hidden.headers.get('cache-control'),'no-store');assert.equal(await hidden.text(),await unknown.text());
  const forged=await f.post({...request('forged'),source:{principalId:'dev:admin'}});assert.equal(forged.status,400);
  const operated=await receipt(await accept(f,f.post(request('admin'),'dev:admin')));assert.ok(operated);await settled(f);
  const admin=await receipt(await f.lookup('admin','dev:admin'),'understood');assert.equal(admin.phase,'understood');
  if(admin.phase==='understood')assert.deepEqual(admin.revision.source,{kind:'operator',ownerId:'dev:alice',principalId:'dev:admin',channel:'web'});
  assert.equal((await f.lookup('admin')).status,404,'owner lookup cannot assume another principal namespace');
  f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:admin'").run();assert.equal((await f.lookup('admin','dev:admin')).status,404);
});

test('agent generation survives actual SQLite reopen; rotation removes old access and isolates identical request IDs',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'core-intent-wire-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'local.db');
  const f=fixture(t,path),credential=token(f);
  await receipt(await accept(f,f.post(request('agent'),credential,true)));await settled(f);
  const terminal=await receipt(await f.lookup('agent',credential,true),'understood');assert.equal(terminal.phase,'understood');
  const generation=f.db.soul('s_A')!.token_generation;assert.match(generation!,/^g_/);assert.notEqual(generation,hashToken(credential));assert.notEqual(generation,credential);
  f.host.saveSnapshot(true);f.db.close();const reopened=fixture(t,path);
  assert.equal(reopened.db.soul('s_A')!.token_generation,generation);
  assert.deepEqual(await receipt(await reopened.lookup('agent',credential,true),'understood'),terminal);
  assert.deepEqual(await receipt(await accept(reopened,reopened.post(request('agent'),credential,true))),terminal);
  assert.equal(reopened.calls,0);
  const rotated=token(reopened,'sim_s_A_NEW_LOCAL_GENERATION');assert.notEqual(reopened.db.soul('s_A')!.token_generation,generation);
  assert.equal((await reopened.lookup('agent',credential,true)).status,401);
  assert.equal((await reopened.lookup('agent',rotated,true)).status,404);
  await receipt(await accept(reopened,reopened.post(request('agent'),rotated,true)));await settled(reopened);assert.equal(reopened.calls,1);
  assert.equal(reopened.db.events(worldId).filter(e=>e.kind==='intent-request-v2').length,2);
});

for(const change of ['invite','operator','rotation','retirement','owner','expiry'] as const)test(`delayed real compiler path rechecks ${change} before publication and effects`,async t=>{
  const f=fixture(t),agent=change==='rotation',credential=agent?token(f):change==='operator'?'dev:admin':'dev:alice';
  let release!:()=>void;f.hold=new Promise<void>(resolve=>release=resolve);
  await receipt(await accept(f,f.post(request('delayed'),credential,agent)),'received');const received=f.db.events(worldId).length;
  if(change==='invite')f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();
  if(change==='operator')f.db.db.prepare("UPDATE users SET role='user' WHERE id='dev:admin'").run();
  if(change==='rotation')token(f,'sim_s_A_ROTATED_DURING_LOCAL_ALIGNMENT');
  if(change==='retirement')f.db.retireSoul('s_A');
  if(change==='owner')f.db.db.prepare("UPDATE souls SET owner='dev:bob' WHERE id='s_A'").run();
  if(change==='expiry') {
    // Direct trusted identity expiry fence complements dev HTTP, whose synthetic
    // credential has no JWT lifetime. Not a live Privy-session claim.
    const scope=f.service.ownerScope({userId:'dev:alice',expiresAt:Date.now()+10},'s_A');await delay(15);
    assert.throws(()=>f.service.guard(scope),/sign in first/);
    f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();
  }
  release();await settled(f);
  assert.equal(f.db.events(worldId).length,received,'no late mint/deck/publication');
  assert.equal(Object.keys(f.host.intentHistoryOf('s_A').intents).length,0);
  const record=f.db.db.prepare("SELECT receipt FROM intent_requests_v2 WHERE request_id='delayed'").get()!;
  assert.equal(intentReceiptV2Schema.parse(JSON.parse(String(record.receipt))).phase,'refused');
  assert.equal(f.db.paidCost(),0);
});

test('final HTTP response checks current authority after the earlier valid durable received fact',async t=>{
  const f=fixture(t);let release!:()=>void,entered!:()=>void;const wait=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
  let releaseCompiler!:()=>void;f.hold=new Promise<void>(r=>releaseCompiler=r);const submit=f.service.submit.bind(f.service);
  t.mock.method(f.service,'submit',async(...args:Parameters<typeof submit>)=>{const value=await submit(...args);entered();await wait;return value;});
  const pending=f.post(request('final'));await accept(f,started);
  assert.equal(f.db.events(worldId).filter(e=>e.kind==='intent-request-v2').length,1);
  f.db.db.prepare("UPDATE users SET invited_by=NULL WHERE id='dev:alice'").run();release();
  const response=await pending;assert.equal(response.status,403);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.ok(!await response.text().then(s=>s.includes('revision')));
  releaseCompiler();await settled(f);
});

test('versions, withdrawal and concurrent edit cannot silently overwrite accepted purpose',async t=>{
  const f=fixture(t);await receipt(await accept(f,f.post(request('new'))));await settled(f);
  const initial=await receipt(await f.lookup('new'),'understood');assert.equal(initial.phase,'understood');if(initial.phase!=='understood')return;
  const edit={intentId:initial.revision.intentId,expectedVersion:1};
  assert.equal((await f.post({...request('wrong'),edit:{...edit,expectedVersion:3}})).status,409);
  let release!:()=>void;f.hold=new Promise<void>(r=>release=r);
  await receipt(await accept(f,f.post({...request('edit-a'),edit})));await receipt(await accept(f,f.post({...request('edit-b'),edit})));
  release();await settled(f);
  const outcomes=await Promise.all(['edit-a','edit-b'].map(async id=>receipt(await f.lookup(id))));assert.equal(outcomes.filter(r=>r.phase==='understood').length,1);
  assert.equal(outcomes.filter(r=>r.phase==='refused').length,1);const accepted=outcomes.find(r=>r.phase==='understood')!;
  assert.equal(accepted.phase,'understood');if(accepted.phase!=='understood')return;
  await receipt(await accept(f,f.post({contract:INTENT_V2,requestId:'withdraw',op:'withdraw',edit:{intentId:edit.intentId,expectedVersion:2}})));await settled(f);
  await receipt(await f.lookup('withdraw'),'withdrawn');assert.equal(f.host.intentHistoryOf('s_A').intents[edit.intentId].status,'withdrawn');
});

test('inactive paths, invalid/large bodies, wrong world and unavailable compiler remain honest and no-store',async t=>{
  const off=fixture(t,':memory:',false);
  assert.equal((await off.post(request('off'))).status,404);assert.equal((await off.lookup('off')).headers.get('cache-control'),'no-store');
  assert.throws(()=>new IntentControlV2(off.host,off.brain,off.souls),/opted-in/);
  const f=fixture(t);
  const invalid=await f.app.request('/v1/souls/s_A/intent-v2',{method:'POST',headers:{authorization:'Bearer dev:alice','content-type':'application/json'},body:'{broken'});
  assert.equal(invalid.status,400);assert.equal(invalid.headers.get('cache-control'),'no-store');
  const large=await f.post(request('large','X'.repeat(70_000)));assert.equal(large.status,413);assert.equal(large.headers.get('cache-control'),'no-store');
  t.mock.method(f.brain,'compile',async()=>null);
  await receipt(await accept(f,f.post(request('no-compiler'))));await settled(f);await receipt(await f.lookup('no-compiler'),'refused');
  f.db.createWorld({id:'foreign',schema:f.host.engine.schema,rules_version:f.host.engine.rulesVersion,dt:f.host.engine.dt,seed:'other'});
  f.db.db.prepare("UPDATE souls SET world_id='foreign' WHERE id='s_A'").run();
  assert.equal((await f.post(request('foreign'))).status,404);assert.equal((await f.lookup('no-compiler')).status,404);
});

test('actual TCP owner/agent adapters and anonymous Hub join/batches exclude private intent material',async t=>{
  const f=fixture(t),server=createServer();const hub=new Hub(server,f.host,f.auth,f.db);hub.brain=f.brain;
  const app=buildApp({...f.deps,hub});server.on('request',getRequestListener(app.fetch));
  await new Promise<void>(resolve=>server.listen(TEST_PORT,'127.0.0.1',resolve));
  let socket:WebSocket|undefined;t.after(async()=>{socket?.terminate();for(const client of hub.clients)client.ws.terminate();hub.wss.close();await new Promise<void>(r=>server.close(()=>r()));});
  const credential=token(f),pending=fetch(`http://127.0.0.1:${TEST_PORT}/v1/agent/intent-v2`,{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:JSON.stringify(request('PRIVATE_REQUEST_ID','PRIVATE_OWNER_WORDS make friends if you feel like it'))});
  await receipt(await acceptOverTcp(f,pending));await settled(f);
  const generation=f.db.soul('s_A')!.token_generation!;
  for(const path of ['/v1/log','/v1/kernel','/v1/debug/world','/v1/take','/v1/takes','/v1/world','/v1/scene']) {
    const response=await fetch(`http://127.0.0.1:${TEST_PORT}`+path);assert.equal(response.status,200);
    const text=await response.text();for(const marker of ['PRIVATE_OWNER_WORDS','PRIVATE_REQUEST_ID','PRIVATE_STANDING_SUMMARY',generation,credential,hashToken(credential)])assert.ok(!text.includes(marker),path+' excludes '+marker.slice(0,12));
  }
  socket=new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`);const messages:string[]=[];
  socket.on('message',data=>messages.push(String(data)));
  await new Promise<void>((resolve,reject)=>{socket!.once('open',resolve);socket!.once('error',reject);});socket.send(JSON.stringify({t:'hello',proto:PROTO}));
  await arrived(socket,messages,'takes');
  assert.ok(messages.some(m=>JSON.parse(m).t==='snapshot'));
  await receipt(await acceptOverTcp(f,fetch(`http://127.0.0.1:${TEST_PORT}/v1/souls/s_A/intent-v2`,{method:'POST',headers:{authorization:'Bearer dev:alice','content-type':'application/json'},body:JSON.stringify(request('PRIVATE_LIVE_ID','PRIVATE_OWNER_WORDS make friends if you feel like it'))})));await settled(f);await ticks(f,40);
  await arrived(socket,messages,'batch');
  for(const marker of ['PRIVATE_OWNER_WORDS','PRIVATE_REQUEST_ID','PRIVATE_LIVE_ID','PRIVATE_STANDING_SUMMARY',generation,credential,hashToken(credential)])assert.ok(!messages.join('\n').includes(marker));
  assert.equal(f.db.paidCost(),0);
});
