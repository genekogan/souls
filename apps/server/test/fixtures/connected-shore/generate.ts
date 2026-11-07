// Local actual HTTP human ownership/compiler/private control/native physical
// world/WAL reconstruction. Synthetic transport, fake mind; no socket/provider.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {connectedCommonsShoreFactory} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';
import {hashOf} from '@souls/engine-contract';
import {INTENT_V2,intentReceiptV2Schema,intentHistoryPageV1Schema,publicEvent} from '@souls/protocol';
import type {CompileOut,callTool} from '@souls/brain';
import {Db} from '../../../src/db.ts';
import {WorldHost} from '../../../src/world.ts';
import {Brain} from '../../../src/brain.ts';
import {Souls} from '../../../src/souls.ts';
import {Auth} from '../../../src/auth.ts';
import {config} from '../../../src/config.ts';
import {buildApp} from '../../../src/http.ts';
import {IntentControlV2} from '../../../src/intent-control.ts';
import type {Hub} from '../../../src/hub.ts';
export async function generateOwnedConnectedShore(){
  const dir=mkdtempSync(join(tmpdir(),'eden-owned-shore-')),path=join(dir,'native.db'),db=new Db(path),factory=await connectedCommonsShoreFactory();
  const seed='owned-connected-shore',worldId='owned-connected-shore',host=new WorldHost(db,factory,seed,1e9,worldId,{durableClockV1:true});host.boot();host.drainInputs();
  const cfg={...config,worldId,worldKey:'eden',worldPath:'/w/eden',brainMode:'fake' as const,budgetUsdPerDay:.5,
    publicUrl:'http://127.0.0.1:4958',typesafeKey:undefined,anthropicKey:'synthetic-only',compilerModel:'synthetic-only',privyAppId:'',privyAppSecret:'',inviteRequired:true};
  let compilerCalls=0;
  const compilerCall:typeof callTool=async<T>(input:Parameters<typeof callTool>[0])=>{
    compilerCalls++;assert.match(input.system,/ordinary actionable present direction/);
    const words=JSON.stringify(input.messages),target=words.includes('return to the commons')?'commons':'shore-water';
    const out:CompileOut={understood:true,agenda:[{card:'go to',target}],alignment:{understanding:'Go to '+target+'.',trigger:{kind:'now'}}};
    return {out:out as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};
  };
  const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){}},{compilerCall,intentV2Choices:true});
  const compile=brain.compile.bind(brain);brain.compile=async(...args:Parameters<typeof compile>)=>{brain.mode='live';try{return await compile(...args);}finally{brain.mode='fake';}};
  const souls=new Souls(host,db,brain,cfg);souls.enableLifecycle();const auth=new Auth(cfg,db);auth.devAuth=true;
  const service=new IntentControlV2(host,brain,souls,{historyV1:true}),app=buildApp({cfg,db,host,auth,brain,souls,intentV2:service,hub:{refreshMe(){},clients:new Map()} as unknown as Hub});
  const request=async(route:string,owner:string,data?:unknown,extra?:Record<string,string>)=>app.request(route,{method:data?'POST':'GET',headers:{authorization:'Bearer dev:'+owner,...(data?{'content-type':'application/json'}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});
  async function drive<T>(p:Promise<T>){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}assert.ok(done,'canonical request settled');return p;}
  const phases=new Set<string>(),programEvents:import('@souls/engine-contract').ProgramEvent[]=[];host.listeners.push({onProgram:event=>programEvents.push(structuredClone(event))});
  try{
    for(const owner of ['alice','bob']){const issued=await request('/v1/admin','admin',{action:'invite',uses:1});assert.equal(issued.status,200);const {code}=await issued.json() as {code:string};assert.equal((await request('/v1/invite',owner,{code})).status,200);}
    await drive(host.enqueue('rules','fixture',{dayConfig:{origin:0,dayTicks:72000,customs:[]}}));
    const created=await drive(request('/v1/souls','alice',{name:'Shore Resident',description:'Local human-owned Soul'},{'X-Sim-Lifecycle':'1'}));assert.equal(created.status,202,await created.clone().text());
    const {lifecycle}=await created.json() as any;await setImmediate();host.drainInputs();await setImmediate();host.drainInputs();
    const status=await request('/v1/lifecycle/'+lifecycle.requestId,'alice'),ready=await status.json() as any;assert.equal(ready.lifecycle.state,'admitted');assert.equal(ready.lifecycle.ready,true);
    const soulId:string=lifecycle.soulId,entityId:string=lifecycle.entityId,mind=host.minds.get(soulId)!;assert.equal(db.soul(soulId)!.owner,'dev:alice');assert.equal(mind.owner,'dev:alice');assert.equal(host.kernel.things[soulId].traits.body,entityId);assert.equal(host.engine.world.entities[entityId].human!.soul,soulId);mind.nextEvalTick=1e9;
    const body=()=>host.engine.world.entities[entityId];
    const accepted:{requestId:string;intentId:string;version:number;target:string}[]=[],terminals:unknown[]=[];
    async function direction(requestId:string,words:string,target:string){
      const response=await drive(request('/v1/souls/'+soulId+'/intent-v2','alice',{contract:INTENT_V2,requestId,op:'upsert',words:'PRIVATE_CONNECTED '+words}));assert.equal(response.status,202,await response.clone().text());await drive(service.settled());
      const receipt=intentReceiptV2Schema.parse(await (await request('/v1/souls/'+soulId+'/intent-v2/requests/'+requestId,'alice')).json());assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('not understood');assert.equal(receipt.revision.interpretation.agenda[0].target,target);
      accepted.push({requestId,intentId:receipt.revision.intentId,version:receipt.revision.version,target});
      // Real needs-aware fake choice against the actual published intention and
      // engine feasibility. Explicit evaluation isolates this route proof from
      // the separately tested autonomous population; no forced decision/result.
      await drive(brain.evaluate(mind,'new-intent-v2'));host.drainInputs();mind.nextEvalTick=1e9;
      return receipt.revision.intentId;
    }
    async function advanceUntil(intentId:string,stopAtSwim=false){
      for(let i=0;i<2400;i++){
        mind.nextEvalTick=1e9;host.tickOnce();await setImmediate();phases.add(body().human!.activity);
        const attempts=Object.values(host.intentHistoryOf(soulId).attempts).filter(a=>a.intent.intentId===intentId);const latest=attempts.at(-1);
        if(stopAtSwim&&body().human!.activity==='swim'){assert.equal(latest?.phase,'started');return latest!;}
        if(latest?.phase==='completed'){assert.equal(stopAtSwim,false);return latest;}
        if(latest?.phase==='blocked'||latest?.phase==='interrupted')throw Error('actual direction did not complete: '+JSON.stringify(latest));
      }
      throw Error('actual direction bound expired: '+JSON.stringify(host.intentHistoryOf(soulId)));
    }
    const outbound=await direction('connected-outbound','go to the calm shore water','shore-water');terminals.push(await advanceUntil(outbound));assert.equal(body().human!.activity,'tread');assert.equal(host.kernel.things[soulId].at,'shore-water');assert.equal(host.engine.regionAt(body().pose.p),'shore-water');
    const restingPose=[...body().pose.p];for(let i=0;i<20;i++){mind.nextEvalTick=1e9;host.tickOnce();await setImmediate();assert.deepEqual(body().pose.p,restingPose);assert.equal(body().human!.activity,'tread');}
    const returning=await direction('connected-return','return to the commons','commons');terminals.push(await advanceUntil(returning));assert.equal(body().human!.activity,'idle');assert.equal(host.kernel.things[soulId].at,'commons');assert.equal(body().pose.p[1],0);
    const moving=await direction('connected-moving','go to the calm shore water again','shore-water');const started=await advanceUntil(moving,true);assert.equal(body().human!.activity,'swim');
    for(const item of terminals as {activityId:string;tick:number}[]){assert.ok(programEvents.some(e=>e.id===item.activityId&&e.kind==='completed'&&e.tick===item.tick),'private completion is a real native program terminal');}
    assert.ok(phases.has('walk')&&phases.has('wade')&&phases.has('swim'));assert.deepEqual(host.engine.runtime.violations,[]);
    const histories=host.intentHistoryOf(soulId);for(const i of accepted)assert.equal(histories.intents[i.intentId].status,'active','activity completion is not broader purpose fulfilment');
    const captures=host.engine.takeChunks!(Math.max(0,host.engine.world.tick-240)).map(c=>({take:c.take,capture:host.engine.takeScene!((c.take as {renderSceneRef:{hash:string}}).renderSceneRef.hash)}));assert.ok(captures.length);assert.ok(captures.every(c=>c.capture?.body.shore?.physicalBase.staticHash===host.engine.world.base.staticHash));
    let cursor:string|undefined,complete=false;const pages:unknown[]=[];do{
      const response=await request('/v1/souls/'+soulId+'/intent-v2/history'+(cursor?'?cursor='+cursor:''),'alice');assert.equal(response.status,200);assert.match(response.headers.get('cache-control')??'',/no-store/);
      const page=intentHistoryPageV1Schema.parse(await response.json());assert.equal(page.state,'page');if(page.state!=='page')throw Error('source gap');pages.push(page);complete=page.complete;cursor=page.nextCursor??undefined;assert.ok(pages.length<20);
    }while(cursor);assert.equal(complete,true);assert.equal((await request('/v1/souls/'+soulId+'/intent-v2/history','bob')).status,404);assert.equal((await request('/v1/souls/'+soulId+'/intent-v2/requests/connected-moving','bob')).status,404);
    assert.ok(!JSON.stringify(db.events(worldId).map(publicEvent)).includes('PRIVATE_CONNECTED'));assert.ok(!JSON.stringify(host.snapshotView()).includes('PRIVATE_CONNECTED'));
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM intent_observations_v2 WHERE world_id=? AND published_seq IS NULL').get(worldId)!.n,0);
    const head={tick:host.engine.world.tick,seq:host.seq,engine:host.engine.stateHash(),kernel:kernelHash(host.kernel),life:hashOf(mind.life),history:hashOf(histories),station:hashOf(host.stationHistoryV1())};
    const saved=host.saveSnapshot(true);assert.ok(saved);host.stop();db.close();const reopened=new Db(path);try{
      const boot=new WorldHost(reopened,factory,seed,1e9,worldId,{durableClockV1:true}),from=boot.boot();assert.equal(from.from,'snapshot');
      const headOf=(h:WorldHost)=>({tick:h.engine.world.tick,seq:h.seq,engine:h.engine.stateHash(),kernel:kernelHash(h.kernel),life:hashOf(h.minds.get(soulId)!.life),history:hashOf(h.intentHistoryOf(soulId)),station:hashOf(h.stationHistoryV1())});assert.deepEqual(headOf(boot),head);assert.equal(boot.engine.world.entities[entityId].human!.activity,'swim');
      reopened.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(worldId);const genesis=new WorldHost(reopened,factory,seed,1e9,worldId,{durableClockV1:true});assert.equal(genesis.boot().from,'genesis');assert.deepEqual(headOf(genesis),head);
      assert.equal(reopened.paidCost(),0);return {contract:'core-owned-connected-shore-probe/1',rulesVersion:factory.rulesVersion,worldId,localHumanOwners:2,ownedSouls:1,soulId,entityId,compilerCalls,accepted,terminals,started,head,phases:[...phases],pose:[...body().pose.p],nativeViolations:host.engine.runtime.violations,pages,programEvents,captures,snapshotFrom:from.from,WALConnectionReopen:'exact',movingGenesisReplay:'exact',paidUsd:0,
        limits:['Synthetic compiler/local dev-auth humans and fake mind, no real accounts/providers','Explicit needs-aware evaluation, not automatic population/capacity proof','Same-process actual WAL connection reopen, no OS crash/old-binary rollback','World combined rendering and transformed scene review pending','No old-world transition/default/boats/passengers/eight-Mars']};
    }finally{reopened.close();}
  }finally{host.stop();if(db.db.isOpen)db.close();rmSync(dir,{recursive:true,force:true});}
}
