// Manual exact-C194 producer input. Completed full-controller work and a
// received-only canonical publisher phase are distinct qualifications.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setImmediate,setTimeout as delay} from 'node:timers/promises';
import {testPort} from '../test-port.ts';
const TEST_PORT=await testPort();

const input=resolve(new URL('../../../../.e2e/exports/core-native-c190-live-me-45b9c986/sim',import.meta.url).pathname);
const manifest=JSON.parse(readFileSync(join(input,'../CONTENT-MANIFEST.json'),'utf8'));
const paths=['apps/server/src/db.ts','apps/server/src/world.ts','apps/server/src/auth.ts','apps/server/src/brain.ts',
  'apps/server/src/souls.ts','apps/server/src/http.ts','apps/server/src/hub.ts','apps/server/src/intent-control.ts',
  'apps/server/src/intent-publisher.ts','apps/server/src/intent-requests.ts','apps/server/src/intent-history-reader.ts',
  'packages/engine-mars/src/index.ts','packages/client/src/index.ts'];
const pins=paths.map(path=>{const sha256=createHash('sha256').update(readFileSync(join(input,path))).digest('hex');assert.equal(sha256,manifest[path].sha256);return {path,sha256};});
const load=(path:string)=>import(pathToFileURL(join(input,path)).href);
const {Db}=await load('apps/server/src/db.ts'),{WorldHost}=await load('apps/server/src/world.ts');
const {Auth,hashToken}=await load('apps/server/src/auth.ts'),{Brain}=await load('apps/server/src/brain.ts'),{Souls}=await load('apps/server/src/souls.ts');
const {config}=await load('apps/server/src/config.ts'),{buildApp}=await load('apps/server/src/http.ts'),{Hub}=await load('apps/server/src/hub.ts');
const {IntentControlV2}=await load('apps/server/src/intent-control.ts'),{Connection}=await load('packages/client/src/index.ts');
const {marsFactory,EDEN_SAFE_COMMONS_WORLD}=await load('packages/engine-mars/src/index.ts');
const {kernelHash}=await load('packages/kernel/src/index.ts');
const {INTENT_V2,intentReceiptV2Schema,intentHistoryPageV1Schema,publicEvent}=await load('packages/protocol/src/index.ts');
const requireInput=createRequire(join(input,'apps/server/src/hub.ts')),WebSocket=requireInput('ws');
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
const worldId='c194-v2-return-local',seed='c194-v2-return/1';
async function until(predicate:()=>boolean){const end=performance.now()+3000;while(!predicate()&&performance.now()<end)await delay(2);assert.ok(predicate(),'actual current transport ready');}

test('exact C194 full interpreted/completed request and canonical received-only reference survive safe reopen without resubmission',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'core-c194-v2-return-')),dbPath=join(dir,'world.sqlite');
  const intervals:Set<ReturnType<typeof setInterval>>=new Set(),original=setInterval;
  t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=original(...args);intervals.add(timer);return timer;});
  let active:any,brief:any;const compilation:any[]=[];
  async function drive<T>(f:any,promise:Promise<T>):Promise<T>{let done=false;promise.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){await setImmediate();f.host.drainInputs();}assert.ok(done,'actual sequencer settled');return promise;}
  async function close(){
    if(!active)return;const f=active;
    // Mandatory ordering: drain all existing interpreter workers while the DB
    // and sequencer remain alive. No cancellation/recovery pump exists here.
    await drive(f,f.service.settled());
    for(const peer of f.peers){peer.c.close();assert.equal(peer.c.me,null);}
    for(const timer of intervals)clearInterval(timer);intervals.clear();
    for(const ws of f.hub.wss.clients)ws.terminate();await new Promise<void>(r=>f.hub.wss.close(()=>r()));await new Promise<void>(r=>f.server.close(()=>r()));
    f.host.stop();f.db.close();active=null;
  }
  t.after(async()=>{await close();rmSync(dir,{recursive:true,force:true});});
  async function open(){
    const db=new Db(dbPath),host=new WorldHost(db,factory,seed,1e9,worldId);host.boot();host.drainInputs();
    const cfg={...config,worldId,worldKey:'eden',worldPath:'/w/eden',publicUrl:`http://127.0.0.1:${TEST_PORT}/w/eden`,
      brainMode:'fake',budgetUsdPerDay:1,typesafeKey:undefined,anthropicKey:'synthetic-only',compilerModel:'synthetic-only',privyAppId:'',privyAppSecret:'',inviteRequired:true};
    const compilerCall=async(input:any)=>{
      assert.match(input.system,/ordinary actionable present direction/);
      compilation.push({systemContract:true,synthetic:true});
      const optional=JSON.stringify(input.messages).includes('if you feel like it');
      if(!brief){
        const m=[...host.minds.values()][0] as any,p=host.engine.world.entities[m.entityId].pose.p;
        const point=[[p[0]+2,p[2]],[p[0],p[2]+2],[p[0]-2,p[2]]].find(([x,z])=>!host.engine.canPerform({actor:m.entityId,label:'native small walk probe',steps:[{verb:'mars:walk_to',params:{x,z}}]}));assert.ok(point);
        brief={name:'walk a little',summary:'Walk a short supported distance.',good_when:'Wanting to move a little.',target:null,when:[],then:[{set:['$actor','doing','walking a little']}],approach:[],during:[{verb:'mars:walk_to',params:{x:point[0],z:point[1]}}],takes:'seconds'};
      }
      return {out:{understood:true,new_cards:[brief],agenda:[{card:brief.name,target:null}],alignment:{understanding:'Walk a short supported distance.',trigger:{kind:optional?'none':'now'}}},
        ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};
    };
    const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){}},{compilerCall,intentV2Choices:true});
    // Only the actual compiler is exercised through injected zero-cost transport;
    // no Jev/provider key or network transport is available.
    const compile=brain.compile.bind(brain);t.mock.method(brain,'compile',async(...args:any[])=>{brain.mode='live';try{return await compile(...args);}finally{brain.mode='fake';}});
    const souls=new Souls(host,db,brain,cfg);souls.enableLifecycle();const auth=new Auth(cfg,db);auth.devAuth=true;
    const service=new IntentControlV2(host,brain,souls,{historyV1:true}),server=createServer(),hub=new Hub(server,host,auth,db,souls);hub.brain=brain;
    const app=buildApp({cfg,db,host,auth,brain,souls,hub,intentV2:service});active={db,host,brain,souls,auth,service,server,hub,app,peers:[]};
    await new Promise<void>((r,reject)=>{server.once('error',reject);server.listen(TEST_PORT,'127.0.0.1',r);});
    const request=(path:string,owner:string|null='alice',body?:unknown)=>app.request(path,{method:body?'POST':'GET',headers:{...(owner?{authorization:'Bearer dev:'+owner}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const connect=async(owner:string|null)=>{
      const frames:any[]=[];const c=new Connection(`ws://127.0.0.1:${TEST_PORT}/ws`,async()=>owner?'dev:'+owner:null,{},(url:string)=>{const ws=new WebSocket(url);ws.on('message',(bytes:Buffer)=>frames.push(JSON.parse(String(bytes))));return ws;});
      active.peers.push({c,frames});c.connect();await until(()=>c.replica.ready);return {c,frames};
    };
    return Object.assign(active,{request,connect});
  }
  const first=await open();
  for(const owner of ['alice','bob']){const issued=await first.request('/v1/admin','admin',{action:'invite',uses:1});assert.equal(issued.status,200);const {code}=await issued.json();assert.equal((await first.request('/v1/invite',owner,{code})).status,200);}
  const created=await first.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:alice','content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:'Cedar',description:'Synthetic invited owner restart fixture'})});assert.equal(created.status,202);
  const admission=(await created.json()).lifecycle;for(let i=0;i<4;i++){first.host.drainInputs();await setImmediate();}const soulId=admission.soulId;assert.equal(first.souls.controlReady(first.db.soul(soulId)),true);
  const completedBody={contract:INTENT_V2,requestId:'c194-owner-completed',op:'upsert',words:'Move a little way.'};
  const route='/v1/souls/'+soulId+'/intent-v2',receivedResponse=await drive<Response>(first,first.request(route,'alice',completedBody));assert.ok([200,202].includes(receivedResponse.status));
  await drive(first,first.service.settled());const completeScope=first.service.ownerScope({userId:'dev:alice',expiresAt:Number.MAX_SAFE_INTEGER},soulId);
  const completedReceipt=first.service.lookup(completeScope,completedBody.requestId);assert.equal(completedReceipt.phase,'understood');
  const ref={intentId:completedReceipt.revision.intentId,version:completedReceipt.revision.version};const mind=first.host.minds.get(soulId);
  await drive(first,first.brain.evaluate(mind,'new-intent-v2'));
  for(let i=0;i<300&&!Object.values(first.host.intentHistoryOf(soulId).attempts).some((a:any)=>a.intent.intentId===ref.intentId&&a.phase==='completed');i++){first.host.tickOnce();if(i%10===0)await setImmediate();}
  assert.ok(Object.values(first.host.intentHistoryOf(soulId).attempts).some((a:any)=>a.intent.intentId===ref.intentId&&a.phase==='completed'));
  const pendingBody={contract:INTENT_V2,requestId:'c194-canonical-received-only',op:'upsert',words:'PRIVATE_PENDING_RETURN_DIRECTION'};
  // Explicit lower-level acceptance phase, not a stopped in-flight compiler.
  // This gives App an honest received-only read fixture with no live worker.
  const pending=await drive<any>(first,first.service.publisher.receive(completeScope,pendingBody));assert.equal(pending.request.received.phase,'received');
  await drive(first,first.service.settled());const beforePending=first.service.lookup(completeScope,pendingBody.requestId);
  const beforeHistory=first.service.historyPage(completeScope,{}),beforeCalls=compilation.length;
  const token='sim_SYNTHETIC_C194_RETURN';first.db.setSoulToken(soulId,hashToken(token),'synthetic fixture');
  const generation=first.db.soul(soulId).token_generation,agentScope=first.service.agentScope(token);
  const agentBody={contract:INTENT_V2,requestId:'c194-agent-optional',op:'upsert',words:'Move a little way if you feel like it.'};
  await drive(first,first.service.submit(agentScope,agentBody));await drive(first,first.service.settled());const agentReceipt=first.service.lookup(agentScope,agentBody.requestId);assert.equal(agentReceipt.phase,'understood');
  const canonicalHistory=first.service.historyPage(completeScope,{}).events;
  const requests=first.db.db.prepare('SELECT principal_id,request_id,body,body_hash,received,receipt FROM intent_requests_v2 WHERE world_id=? ORDER BY principal_id,request_id').all(worldId);
  first.host.saveSnapshot(true);const head={engine:first.host.engine.stateHash(),kernel:kernelHash(first.host.kernel),tick:first.host.engine.world.tick};
  const peers=await Promise.all(['alice','bob',null].map(owner=>first.connect(owner))),oldScope=peers[0].c.meSession;
  await close();const second=await open();
  assert.deepEqual({engine:second.host.engine.stateHash(),kernel:kernelHash(second.host.kernel),tick:second.host.engine.world.tick},head);
  const scope=second.service.ownerScope({userId:'dev:alice',expiresAt:Number.MAX_SAFE_INTEGER},soulId);
  assert.deepEqual(second.service.lookup(scope,completedBody.requestId),completedReceipt);assert.deepEqual(second.service.lookup(scope,pendingBody.requestId),beforePending);
  assert.equal(compilation.length,beforeCalls+1,'only pre-reopen optional agent compilation occurred; reopen/read-only recovery invokes no interpreter');
  const recoveredAgent=second.service.agentScope(token);assert.equal(recoveredAgent.source.principalId,generation);assert.deepEqual(second.service.lookup(recoveredAgent,agentBody.requestId),agentReceipt);
  const returns=await Promise.all(['alice','bob',null].map(owner=>second.connect(owner)));assert.notEqual(returns[0].c.meSession.connectionId,oldScope.connectionId);assert.deepEqual(returns[0].c.me.souls,[soulId]);assert.equal(returns[2].c.me,null);
  const reads:any[]=[];for(const requestId of [completedBody.requestId,pendingBody.requestId])for(const owner of ['alice','bob',null]){
    const response=await second.request(route+'/requests/'+requestId,owner);const body=await response.text();assert.equal(response.status,owner==='alice'?(requestId===pendingBody.requestId?202:200):owner?404:401);assert.equal(response.headers.get('cache-control'),'no-store');reads.push({owner,requestId,status:response.status,body});
    if(owner==='alice')assert.deepEqual(intentReceiptV2Schema.parse(JSON.parse(body)),requestId===pendingBody.requestId?beforePending:completedReceipt);
    else {assert.equal(body.includes(pendingBody.words),false);assert.equal(body.includes(completedReceipt.revision.words),false);}
  }
  const history=intentHistoryPageV1Schema.parse(await (await second.request(route+'/history')).json());assert.ok(history.events.some((e:any)=>e.op==='outcome'&&e.outcome.phase==='completed'));
  assert.deepEqual(history.events,canonicalHistory);
  assert.ok(!history.events.some((e:any)=>e.op==='upsert'&&e.revision.requestId===pendingBody.requestId));
  const recoveredRows=second.db.db.prepare('SELECT principal_id,request_id,body,body_hash,received,receipt FROM intent_requests_v2 WHERE world_id=? ORDER BY principal_id,request_id').all(worldId);assert.deepEqual(recoveredRows,requests);
  assert.equal(JSON.stringify(second.host.snapshotView()).includes(pendingBody.words),false);assert.equal(JSON.stringify(second.db.events(worldId).map(publicEvent)).includes(pendingBody.words),false);
  second.db.setSoulToken(soulId,hashToken(token),'synthetic generation rotation');const rotated=second.service.agentScope(token);assert.notEqual(rotated.source.principalId,generation);assert.throws(()=>second.service.lookup(rotated,agentBody.requestId),/no such request/);assert.throws(()=>second.service.lookup(recoveredAgent,agentBody.requestId));
  assert.equal(second.db.paidCost(),0);await drive(second,second.service.settled());assert.equal(compilation.length,beforeCalls+1);
  const proof={contract:'core-c194-v2-safe-reopen/1',input,pins,completedBody,pendingBody,completedReceipt,beforePending,beforeHistory,history,agentReceipt,credentialGeneration:{before:generation,after:rotated.source.principalId},head,reads,
    scope:{completed:'Actual IntentControlV2/Brain synthetic compiler/fake choice/native completed attempt',pending:'Actual canonical publisher.receive phase, deliberately no interpreter lease started; NOT interrupted live submit worker'},
    initialFrames:peers.map(p=>p.frames),returnFrames:returns.map(p=>p.frames),compilerCalls:compilation.length,paidUSD:0,
    limits:['Local synthetic owners/native/real WS+SDK/in-process HTTP, no App browser/realAuth/installed host/process/OS/cohort qualification','Safe shutdown drains service.settled with sequencer and DB open; no stop/abort/recovery API exists for a held interpreter','Received-only survives and is readable; reopening never reinterprets it, no automatic resubmit or fabricated completion','Owner source is current user principal; agent source is token_generation, rotation hides old-generation lookup','Private synthetic trace, not a public recording or bearer-token export']};
  await close();for(const pin of pins)assert.equal(createHash('sha256').update(readFileSync(join(input,pin.path))).digest('hex'),pin.sha256);
  const out=new URL('../../../../.e2e/v2-restart/',import.meta.url);mkdirSync(out,{recursive:true});const file=new URL(new Date().toISOString().replaceAll(':','-')+'.json',out);writeFileSync(file,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});t.diagnostic('Synthetic private V2 restart input '+file.pathname);
});
