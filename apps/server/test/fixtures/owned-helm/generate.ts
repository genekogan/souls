// Local actual HTTP human ownership/compiler/private control/native physical
// world/WAL reconstruction. Synthetic transport, fake mind; no socket/provider.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {connectedCommonsHelmFactory,connectedCommonsLocationFactory} from '@souls/engine-mars';
import {connectedCommonsBoatFixture} from '../../../../../packages/engine-mars/src/connected-boat.ts';
import {kernelHash} from '@souls/kernel';
import {hashOf,nativeBoatControlsV1Schema,bodyLocationV1Schema,describeBodyLocation,type ProgramEvent} from '@souls/engine-contract';
import type {Mind} from '../../../src/world.ts';
import {INTENT_V2,intentReceiptV2Schema,intentHistoryPageV1Schema,publicEvent} from '@souls/protocol';
import {fingerprint,type CompileOut,type callTool} from '@souls/brain';
import {Db} from '../../../src/db.ts';
import {WorldHost} from '../../../src/world.ts';
import {Brain} from '../../../src/brain.ts';
import {Souls} from '../../../src/souls.ts';
import {Auth} from '../../../src/auth.ts';
import {config} from '../../../src/config.ts';
import {buildApp} from '../../../src/http.ts';
import {IntentControlV2} from '../../../src/intent-control.ts';
import type {Hub} from '../../../src/hub.ts';
export async function generateOwnedHelm(options?:{bodyLocationV1?:true}){
  const dir=mkdtempSync(join(tmpdir(),'eden-owned-helm-')),path=join(dir,'native.db'),db=new Db(path),factory=await (options?.bodyLocationV1?connectedCommonsLocationFactory():connectedCommonsHelmFactory()),native=await connectedCommonsBoatFixture({helmV1:true,...options});
  const seed='owned-voluntary-helm',worldId='owned-voluntary-helm',host=new WorldHost(db,factory,seed,1e9,worldId,{durableClockV1:true});host.boot();host.drainInputs();
  const cfg={...config,worldId,worldKey:'eden',worldPath:'/w/eden',brainMode:'fake' as const,budgetUsdPerDay:.5,
    publicUrl:'http://127.0.0.1:4958',typesafeKey:undefined,anthropicKey:'synthetic-only',compilerModel:'synthetic-only',privyAppId:'',privyAppSecret:'',inviteRequired:true};
  type Step={verb:string;params:Record<string,unknown>};
  type Direction={owner:string;requestId:string;words:string;card:string;steps:Step[]};
  let current:Direction|undefined,compilerCalls=0,groundedCompilerCalls=0,groundedBodyCompilerCalls=0,unavailableCompilerCalls=0;
  const compilerCall:typeof callTool=async<T>(input:Parameters<typeof callTool>[0])=>{
    compilerCalls++;assert.ok(current);assert.match(input.system,/ordinary actionable present direction/);
    assert.ok(JSON.stringify(input.messages).includes(current.words),'actual submitted ordinary words reach compiler');
    const m=owned[current.owner].mind,physical=host.engine.observeBoatControls!(m.entityId);
    if(physical){groundedCompilerCalls++;assert.ok(JSON.stringify(input.messages).includes(JSON.stringify(physical).replaceAll('"','\\"')),'compiler receives current physical view');}
    const placement=host.engine.observeBodyLocation?.(m.entityId);
    if(options?.bodyLocationV1&&placement===null){
      unavailableCompilerCalls++;assert.ok(JSON.stringify(input.messages).includes('physically physical location unavailable'));assert.ok(JSON.stringify(input.messages).includes('Do not infer it from the kernel place relation'));
      assert.ok(!JSON.stringify(input.messages).includes('(currently at '));
      return {out:{understood:false,reason:'Physical self-location is unavailable.',agenda:[]} as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true,controlledUnavailableProbe:true}};
    }
    if(options?.bodyLocationV1){assert.ok(placement);groundedBodyCompilerCalls++;assert.ok(JSON.stringify(input.messages).includes(JSON.stringify(placement).replaceAll('"','\\"')));assert.ok(JSON.stringify(input.messages).includes('physically '+describeBodyLocation(placement)));assert.ok(JSON.stringify(input.messages).includes('recorded kernel place:'));
      assert.ok(!JSON.stringify(input.messages).includes('(currently at '),'compiler cannot present a stale kernel relation as actual current physical placement');}
    const out:CompileOut={understood:true,agenda:[{card:current.card,target:null}],alignment:{understanding:current.words,trigger:{kind:'now'}},
      ...(!host.kernel.vocab.cards[current.card]?{new_cards:[{name:current.card,summary:'A voluntary native boat activity',target:null,when:[],then:[{set:['$actor','doing',current.card]}],approach:[],during:current.steps,takes:'minutes'}]}:{})};
    return {out:out as T,ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,request:null,raw:{synthetic:true}};
  };
  const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){}},{compilerCall,intentV2Choices:true});
  const compile=brain.compile.bind(brain);brain.compile=async(...args:Parameters<typeof compile>)=>{brain.mode='live';try{return await compile(...args);}finally{brain.mode='fake';}};
  const souls=new Souls(host,db,brain,cfg);souls.enableLifecycle();const auth=new Auth(cfg,db);auth.devAuth=true;
  const service=new IntentControlV2(host,brain,souls,{historyV1:true}),app=buildApp({cfg,db,host,auth,brain,souls,intentV2:service,hub:{refreshMe(){},clients:new Map()} as unknown as Hub});
  const request=async(route:string,owner:string,data?:unknown,extra?:Record<string,string>)=>app.request(route,{method:data?'POST':'GET',headers:{authorization:'Bearer dev:'+owner,...(data?{'content-type':'application/json'}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});
  async function drive<T>(p:Promise<T>){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}assert.ok(done,'canonical request settled');return p;}
  const owned:Record<string,{soulId:string;entityId:string;mind:Mind;token:string}>={},creators=new Map<string,string>(),accepted:{owner:string;intentId:string;card:string}[]=[],terminals:any[]=[],programEvents:ProgramEvent[]=[],cueSamples:unknown[]=[];
  host.listeners.push({onProgram:event=>programEvents.push(structuredClone(event))});
  const boat=()=>host.engine.world.entities[native.policy.boatId] as any;
  const locationSamples:unknown[]=[],seenLocationPhases=new Set<string>();let locationFingerprintProbe:unknown;
  const quiet=()=>{for(const {mind} of Object.values(owned))mind.nextEvalTick=1e9;};
  async function tick(){quiet();host.tickOnce();await setImmediate();quiet();}
  async function location(owner:string,stage:string){
    if(!options?.bodyLocationV1)return;
    const {soulId,entityId,mind,token}=owned[owner],before=hashOf(host.engine.snapshot()),kernelBefore=kernelHash(host.kernel);
    const response=await request('/v1/souls/'+soulId+'/perceive',owner);assert.equal(response.status,200);assert.match(response.headers.get('cache-control')??'',/no-store/);const view=await response.json() as any,placement=bodyLocationV1Schema.parse(view.physical_location);
    const agent=await app.request('/v1/agent/perceive',{headers:{authorization:'Bearer '+token}});assert.equal(agent.status,200);assert.match(agent.headers.get('cache-control')??'',/no-store/);assert.deepEqual((await agent.json() as any).physical_location,placement);
    const status=souls.status(db.soul(soulId)!);assert.ok('physical_location' in status);assert.deepEqual(status.physical_location,placement);assert.deepEqual(placement,host.engine.observeBodyLocation!(entityId));
    if(placement.region)assert.equal(status.position.region,placement.region.id);
    assert.deepEqual(placement.root,host.engine.world.entities[entityId].pose.p);assert.equal(view.soul.where,describeBodyLocation(placement));assert.equal(brain.midContext(mind,'agent').soul.where,view.soul.where);
    assert.equal(hashOf(host.engine.snapshot()),before);assert.equal(kernelHash(host.kernel),kernelBefore,'observing physical placement cannot invent a semantic move');
    locationSamples.push({owner,stage,location:placement,where:view.soul.where,semanticAt:host.kernel.things[soulId].at});
  }
  async function controls(owner:string){
    const {soulId,entityId,mind,token}=owned[owner],before=host.engine.stateHash();
    const response=await request('/v1/souls/'+soulId+'/perceive',owner);assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control')??'',/no-store/);
    const view=await response.json() as any,cue=nativeBoatControlsV1Schema.parse(view.physical_boat_controls);
    const agent=await app.request('/v1/agent/perceive',{headers:{authorization:'Bearer '+token}});assert.equal(agent.status,200);
    assert.match(agent.headers.get('cache-control')??'',/no-store/);
    const av=await agent.json() as any;assert.deepEqual(av.physical_boat_controls,cue);
    const status=souls.status(db.soul(soulId)!);assert.ok('physical_boat_controls' in status);
    assert.deepEqual(status.physical_boat_controls,cue);assert.deepEqual(cue,host.engine.observeBoatControls!(entityId));
    assert.equal(cue.tick,host.engine.world.tick);assert.deepEqual(cue.physicalBase,host.engine.world.base);
    assert.deepEqual(view.situation,brain.midContext(mind,'agent').situation);assert.deepEqual(av.situation,view.situation);
    assert.equal(host.engine.stateHash(),before,'perception and status cannot grant helm or change canonical physics');
    assert.equal((await request('/v1/souls/'+soulId+'/perceive',owner==='alice'?'bob':'alice')).status,403);
    cueSamples.push({owner,cue,situation:view.situation});return cue;
  }
  async function direction(d:Direction){
    current=d;const {soulId,mind}=owned[d.owner];
    const response=await drive(request('/v1/souls/'+soulId+'/intent-v2',d.owner,{contract:INTENT_V2,requestId:d.requestId,op:'upsert',words:'PRIVATE_HELM '+d.words}));assert.equal(response.status,202,await response.clone().text());await drive(service.settled());
    const receipt=intentReceiptV2Schema.parse(await (await request('/v1/souls/'+soulId+'/intent-v2/requests/'+d.requestId,d.owner)).json());assert.equal(receipt.phase,'understood',JSON.stringify(receipt));if(receipt.phase!=='understood')throw Error('not understood');
    assert.deepEqual(receipt.revision.interpretation.agenda,[{card:d.card,target:null}]);
    assert.equal(host.kernel.vocab.cards[d.card].origin,'compiled');
    if(!creators.has(d.card))creators.set(d.card,soulId);
    assert.equal(host.kernel.vocab.cards[d.card].by,creators.get(d.card),'reusing a shared card preserves its original mint provenance');
    accepted.push({owner:d.owner,intentId:receipt.revision.intentId,card:d.card});
    await drive(brain.evaluate(mind,'new-intent-v2'));host.drainInputs();quiet();current=undefined;
    assert.ok(host.engine.programOf(mind.entityId),'real needs-aware chooser selected a feasible native activity');
    return receipt.revision.intentId;
  }
  async function until(owner:string,intentId:string,underway=false){
    for(let i=0;i<3500;i++){
      await tick();const attempts=Object.values(host.intentHistoryOf(owned[owner].soulId).attempts).filter(a=>a.intent.intentId===intentId),a=attempts.at(-1);
      const phase=(host.engine.world.entities[owned[owner].entityId].human as any).boatPassenger?.phase,phaseKey=owner+':'+phase;
      if(options?.bodyLocationV1&&phase&&!seenLocationPhases.has(phaseKey)){seenLocationPhases.add(phaseKey);await location(owner,phase);}
      if(underway&&boat().boat.phase==='underway'){assert.equal(a?.phase,'started');return a!;}
      if(a?.phase==='completed'){assert.equal(underway,false);assert.ok(programEvents.some(e=>e.id===a.activityId&&e.kind==='completed'&&e.tick===a.tick));terminals.push(a);return a;}
      if(a?.phase==='blocked'||a?.phase==='interrupted')throw Error('native activity did not complete: '+JSON.stringify(a));
    }throw Error('ordinary boat direction bound expired: '+JSON.stringify(host.intentHistoryOf(owned[owner].soulId)));
  }
  const nativeStep=(verb:string,params:Record<string,unknown>={}):Step=>({verb:'mars:'+verb,params});
  const walkBank:Step={verb:'walk_to',params:{to:[native.layout.bank[0],native.layout.bank[2]]}};
  const submit=async(owner:string,requestId:string,words:string,card:string,steps:Step[])=>direction({owner,requestId,words,card,steps});
  const graph=(h:WorldHost)=>{const s=h.engine.snapshot() as any;const {eventCursor,...mars}=s.mars;return {...s,mars};};
  const headOf=(h:WorldHost)=>({tick:h.engine.world.tick,seq:h.seq,engine:h.engine.stateHash(),physicalGraph:hashOf(graph(h)),kernel:kernelHash(h.kernel),lives:Object.fromEntries(Object.entries(owned).map(([o,v])=>[o,hashOf(h.minds.get(v.soulId)!.life)])),histories:Object.fromEntries(Object.entries(owned).map(([o,v])=>[o,hashOf(h.intentHistoryOf(v.soulId))])),station:hashOf(h.stationHistoryV1())});
  const captureTail=()=>host.engine.takeChunks!(Math.max(0,host.engine.world.tick-240)).map(c=>({take:c.take,capture:host.engine.takeScene!((c.take as any).renderSceneRef.hash)}));
  try{
    for(const owner of ['alice','bob']){
      const issued=await request('/v1/admin','admin',{action:'invite',uses:1});assert.equal(issued.status,200);const {code}=await issued.json() as any;assert.equal((await request('/v1/invite',owner,{code})).status,200);
    }
    await drive(host.enqueue('rules','fixture',{dayConfig:{origin:0,dayTicks:72000,customs:[]}}));
    for(const owner of ['alice','bob']){
      const response=await drive(request('/v1/souls',owner,{name:owner==='alice'?'Alice Resident':'Bob Resident',description:'Local human-owned boat explorer'},{'X-Sim-Lifecycle':'1'}));assert.equal(response.status,202);
      const {lifecycle}=await response.json() as any;await setImmediate();host.drainInputs();await setImmediate();host.drainInputs();
      const ready=await (await request('/v1/lifecycle/'+lifecycle.requestId,owner)).json() as any;assert.equal(ready.lifecycle.ready,true);
      const {soulId,entityId}=lifecycle,mind=host.minds.get(soulId)!;assert.equal(db.soul(soulId)!.owner,'dev:'+owner);assert.equal(mind.owner,'dev:'+owner);assert.equal(host.kernel.things[soulId].traits.body,entityId);assert.equal(host.engine.world.entities[entityId].human!.soul,soulId);
      const pair=await (await request('/v1/souls/'+soulId+'/pair',owner,{})).json() as any;
      const paired=await app.request('/v1/agent/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pair.code,agent:'Local synthetic probe'})});assert.equal(paired.status,200);const {token}=await paired.json() as any;
      owned[owner]={soulId,entityId,mind,token};quiet();
      await location(owner,'arrival');
    }
    for(const [owner,slot,card] of [['alice','seat0','board left'],['bob','seat1','board right']]){
      const id=await submit(owner,'board-'+owner,'Walk to the dock and sit in the '+(slot==='seat0'?'left':'right')+' boat seat',card,[walkBank,nativeStep('boat_board',{slot})]);await until(owner,id);
    }
    assert.deepEqual(boat().boat.pilotIds,[]);assert.equal((await controls('alice')).take.available,true);assert.equal((await controls('bob')).take.available,true);
    await location('alice','both-boarded');await location('bob','both-boarded');
    if(options?.bodyLocationV1){
      // Controlled read-only metadata probe, not a rename feature or a logged
      // historical edit. Physics/options stay unchanged; the actual container
      // description alone must change call relevance. Restore before any input.
      const beforeGraph=hashOf(host.engine.snapshot()),v=boat(),label=v.label,base=brain.midContext(owned.alice.mind,'agent');
      try{v.label='the lake boat';const changed=brain.midContext(owned.alice.mind,'agent');assert.notEqual(base.soul.where,changed.soul.where);assert.deepEqual(base.nearby,changed.nearby);assert.deepEqual(base.options.map(o=>o.id),changed.options.map(o=>o.id));assert.deepEqual(base.situation,changed.situation);
        const {physicalWhere:_a,...legacyBase}=base,{physicalWhere:_b,...legacyChanged}=changed;
        assert.equal(fingerprint(legacyBase),fingerprint(legacyChanged),'legacy fingerprint ignored only the changed where wording');assert.notEqual(fingerprint(base),fingerprint(changed),'tagged physical placement is meaningful context');
        locationFingerprintProbe={physicalWordingChanged:true,legacyFingerprintSame:true,taggedFingerprintChanged:true};
      }finally{if(label===undefined)delete v.label;else v.label=label;}assert.equal(hashOf(host.engine.snapshot()),beforeGraph);
    }
    const take=await submit('alice','take-alice','Take the helm so we can go boating','take helm',[nativeStep('boat_take_helm')]);await until('alice',take);
    assert.deepEqual(boat().boat.pilotIds,[owned.alice.entityId]);assert.equal((await controls('alice')).release.available,true);assert.equal((await controls('bob')).take.reason!.code,'boat.helm-held');
    const beforeForeign=host.engine.stateHash(),beforeForeignGraph=hashOf(host.engine.snapshot());
    const impersonated=host.engine.previewAdmission!({actor:owned.bob.entityId,label:'Hypothetical authority-negative probe',steps:[nativeStep('boat_travel',{actor:owned.alice.entityId,x:-56,z:8})]});
    assert.equal(impersonated.ok,false);assert.equal(impersonated.diagnostic!.code,'boat.self-only');assert.equal(host.engine.stateHash(),beforeForeign);
    const ungranted=host.engine.previewAdmission!({actor:owned.bob.entityId,label:'Hypothetical ungranted-pilot probe',steps:[nativeStep('boat_travel',{x:-56,z:8})]});assert.equal(ungranted.ok,false);assert.equal(ungranted.diagnostic!.code,'boat.pilot-not-authorized');assert.equal(host.engine.stateHash(),beforeForeign);assert.equal(hashOf(host.engine.snapshot()),beforeForeignGraph);
    const trip=await submit('alice','outward-alice','Take us out onto the quiet water','sail outward',[nativeStep('boat_travel',{x:-56,z:8})]);const started=await until('alice',trip,true);
    for(let i=0;i<40;i++)await tick();assert.ok(boat().boat.speed>0);assert.notDeepEqual(boat().pose.p,native.layout.boatDockPosition);
    await location('alice','underway');await location('bob','underway');
    assert.equal((await controls('alice')).release.reason!.code,'boat.helm-underway');assert.equal((await controls('bob')).take.reason!.code,'boat.helm-underway');
    const movingHead=headOf(host),movingCaptures=captureTail();assert.ok(host.saveSnapshot(true));
    // Actual same-process second WAL connection plus model-free replay while
    // both owned passengers are aboard a moving boat. Original connection is
    // quiescent; never mutate a live/user DB or involve an external provider.
    const reopened=new Db(path);let snapshotFrom:string;
    try{const snap=new WorldHost(reopened,factory,seed,1e9,worldId,{durableClockV1:true});snapshotFrom=snap.boot().from;assert.equal(snapshotFrom,'snapshot');assert.deepEqual(headOf(snap),movingHead);
      reopened.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(worldId);const genesis=new WorldHost(reopened,factory,seed,1e9,worldId,{durableClockV1:true});assert.equal(genesis.boot().from,'genesis');assert.deepEqual(headOf(genesis),movingHead);assert.equal(genesis.engine.observeBoatControls!(owned.alice.entityId)!.holder,owned.alice.entityId);snap.stop();genesis.stop();
    }finally{reopened.close();}
    await until('alice',trip);assert.equal(boat().boat.phase,'stopped');
    const back=await submit('alice','dock-alice','Bring us back to the dock','dock boat',[nativeStep('boat_travel',{x:native.layout.boatDockPosition[0],z:native.layout.boatDockPosition[2]})]);await until('alice',back);assert.equal(boat().boat.phase,'docked');
    const release=await submit('alice','release-alice','Release the helm for the other passenger','release helm',[nativeStep('boat_release_helm')]);await until('alice',release);assert.equal((await controls('bob')).take.available,true);
    const takeover=await submit('bob','take-bob','Take the helm now it is free','take helm',[nativeStep('boat_take_helm')]);await until('bob',takeover);assert.equal((await controls('bob')).holder,owned.bob.entityId);
    const leaveBob=await submit('bob','leave-bob','Leave the boat and come back to the commons','leave right',[nativeStep('boat_leave',{slot:'seat1'}),{verb:'walk_to',params:{to:[14,4]}}]);await until('bob',leaveBob);assert.deepEqual(boat().boat.pilotIds,[]);
    const leaveAlice=await submit('alice','leave-alice','Leave the boat and return to the commons','leave left',[nativeStep('boat_leave',{slot:'seat0'}),{verb:'walk_to',params:{to:[15,4]}}]);await until('alice',leaveAlice);assert.deepEqual(boat().boat.passengers,{});
    await location('alice','returned');await location('bob','returned');
    assert.deepEqual(host.engine.runtime.violations,[]);assert.equal(db.paidCost(),0);
    const pages:unknown[]=[];for(const [owner,v] of Object.entries(owned)){
      for(const a of accepted.filter(a=>a.owner===owner))assert.equal(host.intentHistoryOf(v.soulId).intents[a.intentId].status,'active','a completed action does not fulfil the retained purpose');
      const r=await request('/v1/souls/'+v.soulId+'/intent-v2/history',owner);assert.equal(r.status,200);assert.match(r.headers.get('cache-control')??'',/no-store/);const page=intentHistoryPageV1Schema.parse(await r.json());assert.equal(page.state,'page');pages.push(page);
      assert.equal((await request('/v1/souls/'+v.soulId+'/intent-v2/history',owner==='alice'?'bob':'alice')).status,404);
    }
    let unavailableProbe:unknown;
    if(options?.bodyLocationV1){
      // Deliberate local read-only fault: a contact copied from the admitted
      // bank is stale for a returned commons body. Never tick/drain/log world
      // inputs while corrupted; restore the exact graph before persistence.
      const {soulId,entityId,mind,token}=owned.alice,h=host.engine.world.entities[entityId].human as any,before=hashOf(host.engine.snapshot()),kernelBefore=kernelHash(host.kernel),seqBefore=host.seq,tickBefore=host.engine.world.tick,original=h.shore;
      const g=native.geometry.shore,p=g.point([native.layout.bank[0],native.layout.bank[2]])!;
      try{
        h.shore={contract:'shore-contact/1',terrainId:g.terrainId,waterId:g.waterId,mode:'bed',bedY:p.point[1],datumY:g.datumY,depthMetres:p.depth,submergedHeightMetres:0,normal:p.normal};
        assert.equal(host.engine.observeBodyLocation!(entityId),null);
        const r=await request('/v1/souls/'+soulId+'/perceive','alice');assert.equal(r.status,200);const view=await r.json() as any;assert.equal(view.physical_location,null);assert.equal(view.soul.where,'physical location unavailable');
        const ar=await app.request('/v1/agent/perceive',{headers:{authorization:'Bearer '+token}});assert.equal(ar.status,200);const av=await ar.json() as any;assert.equal(av.physical_location,null);assert.equal(av.soul.where,view.soul.where);assert.equal(brain.midContext(mind,'agent').soul.where,view.soul.where);
        current={owner:'alice',requestId:'controlled-unavailable-probe',words:'Describe the current physical location without inventing it',card:'no action',steps:[]};
        const result=await brain.compile(mind,current.words,'intent-v2');assert.deepEqual(result,{ok:false,reason:'Physical self-location is unavailable.'});
        assert.equal(host.seq,seqBefore);assert.equal(host.engine.world.tick,tickBefore);assert.equal(kernelHash(host.kernel),kernelBefore);unavailableProbe={state:'unavailable',where:view.soul.where,compilerResult:result,noWorldInputsOrTicks:true};
      }finally{current=undefined;if(original===undefined)delete h.shore;else h.shore=original;}
      assert.equal(hashOf(host.engine.snapshot()),before);assert.equal(kernelHash(host.kernel),kernelBefore);
    }
    const publicEvents=db.events(worldId).map(publicEvent),view=host.snapshotView();assert.ok(!JSON.stringify(publicEvents).includes('PRIVATE_HELM'));assert.ok(!JSON.stringify(view).includes('PRIVATE_HELM'));assert.ok(!JSON.stringify(view).includes('physical_boat_controls'));
    assert.ok(!JSON.stringify(view).includes('physical_location'));assert.ok(!JSON.stringify(publicEvents).includes('physical_location'));
    for(const a of accepted)assert.ok(!JSON.stringify(publicEvents).includes(a.intentId));
    const captures=[...movingCaptures,...captureTail()];assert.ok(captures.length);assert.ok(captures.every(c=>c.capture?.body.shore?.physicalBase.staticHash===host.engine.world.base.staticHash));
    const finalHead=headOf(host);assert.ok(host.saveSnapshot(true));host.stop();db.close();
    const finalDb=new Db(path);try{
      const restored=new WorldHost(finalDb,factory,seed,1e9,worldId,{durableClockV1:true});assert.equal(restored.boot().from,'snapshot');assert.deepEqual(headOf(restored),finalHead);
      finalDb.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(worldId);const genesis=new WorldHost(finalDb,factory,seed,1e9,worldId,{durableClockV1:true});assert.equal(genesis.boot().from,'genesis');assert.deepEqual(headOf(genesis),finalHead);assert.equal(finalDb.paidCost(),0);restored.stop();genesis.stop();
    }finally{finalDb.close();}
    return {contract:options?.bodyLocationV1?'core-owned-body-location-probe/1':'core-owned-voluntary-helm-probe/1',rulesVersion:factory.rulesVersion,worldId,localHumanOwners:2,ownedSouls:2,owners:Object.fromEntries(Object.entries(owned).map(([o,v])=>[o,{soulId:v.soulId,entityId:v.entityId}])),compilerCalls,groundedCompilerCalls,...(options?.bodyLocationV1?{groundedBodyCompilerCalls,unavailableCompilerCalls,unavailableProbe,locationFingerprintProbe,locationSamples}:{}),accepted,terminals,started,movingHead,finalHead,cueSamples,pages,programEvents,captures,snapshotFrom,movingWALNewConnectionRead:'exact',movingGenesisReplay:'exact',finalWALConnectionReopen:'exact',finalGenesisReplay:'exact',nativeViolations:host.engine.runtime.violations,paidUsd:0,
      limits:['Synthetic compiler maps each submitted ordinary direction to a native card, not model-quality proof','Two local invited dev-auth humans and explicit real needs-aware fake evaluations, not autonomous population or real Auth','Moving new-connection read keeps original writer quiescent/open; final check closes original DB before reopening; neither is OS crash/old binary rollback','Physical graph excludes only the native subscriber eventCursor which resets on restore','World combined rendering/UI/default/cohort/installed agent remain separate']};
  }finally{host.stop();if(db.db.isOpen)db.close();rmSync(dir,{recursive:true,force:true});}
}
