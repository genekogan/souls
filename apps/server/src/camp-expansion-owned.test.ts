import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hashOf} from '@souls/engine-contract';
import {kernelHash} from '@souls/kernel';
import {marsCampExpansionFactory,CAMP_EXPANSION_CAMPUS,CAMP_EIGHT_RESOURCES,type MarsWorldConfig} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {CampCards} from './camp.ts';
import {campResourceBindings} from './camp-resources.ts';
import {optionsFor,type CardOption} from './deck.ts';
import {WorldHost,type Mind} from './world.ts';
import {LivingWorld} from './living.ts';
import {Db} from './db.ts';
import {sampleTake} from '../../../mars/viewer/engine/take/replay.ts';
import {CandidateStationV1} from './station.ts';
const cfg:MarsWorldConfig={scene:'eden-camp',safeArrivalV1:true,safeCrewRemoval:true,arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Camp grounds'}};
const factory=await marsCampExpansionFactory(cfg);
function local(t:TestContext,path:string){
  const timers:ReturnType<typeof setInterval>[]=[],original=setInterval;
  t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=original(...args);timers.push(timer);return timer;});
  t.after(()=>timers.forEach(clearInterval));return fixture(path,factory,{durableClockV1:true});
}
async function drain(f:ReturnType<typeof fixture>){for(let i=0;i<4;i++){f.host.drainInputs();await setImmediate();}}
async function birth(f:ReturnType<typeof fixture>,i:number,name:string){const owner='resident'+i;await invite(f,owner);const op=f.souls.acceptLifecycleCreate('dev:'+owner,{name,description:'Local invited human-owned Mars ground-upgrade fixture'});await drain(f);const mind=f.host.minds.get(op.scope.soulId)!;assert.ok(mind);assert.equal(f.souls.controlReady(f.db.soul(mind.soulId)!),true);mind.nextEvalTick=1e9;return mind;}
async function select(f:ReturnType<typeof fixture>,m:Mind,opt:CardOption,steps=opt.steps){
  void f.host.enqueue('decision','fixture',{soulId:m.soulId,entityId:m.entityId,option:opt.id,card:opt.card,hash:opt.hash,target:opt.cardTarget,label:opt.label,
    steps,approachLen:opt.approachLen,mood:'content',reevalTicks:1e9,continue:false,fallback:true,trigger:'fixture'});await drain(f);
}
async function finish(f:ReturnType<typeof fixture>,m:Mind,seen?:(body:any)=>void){
  for(let i=0;i<7000&&f.host.engine.programOf(m.entityId);i++){for(const other of f.host.minds.values())other.nextEvalTick=1e9;f.host.tickOnce();seen?.(f.host.engine.world.entities[m.entityId]);if(i%20===0)await setImmediate();}
  await drain(f);assert.equal(f.host.engine.programOf(m.entityId),null);assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.souls.lifecycle!.faults.size,0);
}
test('actual old four-owner camp upgrades once, admits four more, serves finite food and supports all eight distinct sleeping areas with exact WAL/genesis',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'core-camp-eight-')),path=join(dir,'world.sqlite'),f=local(t,path);f.souls.enableLifecycle();
  const programEvents:any[]=[],step=f.host.engine.step.bind(f.host.engine);
  t.mock.method(f.host.engine,'step',()=>{const result=step();programEvents.push(...result.programs);return result;});
  try{
    const living=new LivingWorld(f.host);await accept<unknown>(f.host,living.install(['People may share supper and rest when tired.']));living.camp=true;
    const pack=new CampCards(f.host),minds:Mind[]=[];
    for(const [i,name] of ['Alice','Bob','Carol','David'].entries())minds.push(await birth(f,i,name));pack.install();await drain(f);
    const direction=await accept(f.host,f.request('/v1/souls/'+minds[0].soulId+'/intent',{intent:{goal:'rest',text:'PRIVATE_GROUND_UPGRADE_OWNER_CONTEXT'}},'resident0'));assert.equal(direction.status,200);
    for(let i=0;i<17;i++)f.host.tickOnce();await drain(f);
    // The real fake/reflex mind may already enact the accepted rest. Complete
    // that finite work normally; never bypass the upgrade's quiet guard.
    for(const m of minds)await finish(f,m);
    const oldEntities=structuredClone(f.host.engine.world.entities),oldRegions=structuredClone(f.host.engine.world.regions),oldCards=new Map(Object.entries(f.host.kernel.vocab.cards).map(([name,c])=>[name,c.hash]));
    const oldLives=minds.map(m=>({id:m.soulId,owner:m.owner,intent:structuredClone(m.intent),life:structuredClone(m.life)}));
    const upgrade=await accept(f.host,f.host.adoptCampExpansion('world'));
    assert.equal(f.host.engine.world.base.campus,CAMP_EXPANSION_CAMPUS);assert.equal(f.db.world(f.host.worldId)!.rules_version,f.host.engine.rulesVersion);
    for(const [id,e] of Object.entries(oldEntities))assert.deepEqual(f.host.engine.world.entities[id],e);
    for(const [id,r] of Object.entries(oldRegions))assert.deepEqual(f.host.engine.world.regions[id],r);
    assert.deepEqual(minds.map(m=>({id:m.soulId,owner:m.owner,intent:m.intent,life:m.life})),oldLives);
    const repeated=await f.host.adoptCampExpansion('world');assert.equal(repeated.seq,upgrade.seq);
    for(const [i,name] of ['Eve','Frank','Grace','Hank'].entries())minds.push(await birth(f,i+4,name));pack.install();await drain(f);
    assert.equal(pack.resourceIssues.size,0);const bindings=campResourceBindings(f.host,minds,CAMP_EIGHT_RESOURCES);assert.equal(bindings.issues.size,0);assert.equal(new Set([...bindings.bySoul.values()].map(r=>r.mat)).size,8);
    for(const [name,hash] of oldCards)assert.equal(f.host.kernel.vocab.cards[name].hash,hash);
    const publicPairs:any[]=[];const capture=(tick?:number)=>{
      const chunks=f.host.engine.takeChunks!(-1),c=tick===undefined?chunks.at(-1):chunks.find(c=>c.fromTick<=tick&&c.toTick>tick);if(!c)return null;
      const take=c.take as any;let pair=publicPairs.find(p=>p.take.id===take.id);if(!pair){pair={take:structuredClone(take),capture:f.host.engine.takeScene!(take.renderSceneRef.hash)};publicPairs.push(pair);}return pair;
    };capture();
    const trace:any[]=[];
    for(const [i,m] of minds.entries()){
      const response=await accept(f.host,f.request('/v1/souls/'+m.soulId+'/intent',{intent:{agenda:[{card:'eat a bowl of stew '+m.name.toLowerCase(),target:null}]}},'resident'+i));assert.equal(response.status,200);
      const option=optionsFor(f.host,m).find(o=>o.card==='eat a bowl of stew '+m.name.toLowerCase());assert.ok(option,'actual owned meal option '+m.name);await select(f,m,option);
      const program=f.host.engine.programOf(m.entityId);await finish(f,m);capture();assert.ok(programEvents.some(e=>e.id===program&&e.kind==='completed'),'actual meal program completed '+m.name);
      const r=bindings.bySoul.get(m.soulId)!;
      assert.equal((f.host.engine.world.entities[r.bowl] as any).support.on,i<4?'dining-table':'camp-eight-table');
      assert.equal((f.host.engine.world.entities[r.spoon] as any).support.on,i<4?'dining-table':'camp-eight-table');
      assert.equal(f.host.minds.get(m.soulId)!.life!.needs.hunger<55,true);
      trace.push({soulId:m.soulId,entityId:m.entityId,phase:'meal',tick:f.host.engine.world.tick,resource:r,potFraction:(f.host.engine.world.entities[r.stewPot??'stew-pot'] as any).contents.fraction,root:[...f.host.engine.world.entities[m.entityId].pose.p]});
    }
    assert.equal((f.host.engine.world.entities['stew-pot'] as any).contents.fraction,0);assert.equal((f.host.engine.world.entities['camp-eight-stew'] as any).contents.fraction,0);
    for(const [i,m] of minds.entries()){
      const r=bindings.bySoul.get(m.soulId)!;const card=f.host.kernel.decks[m.soulId].cards.find(name=>f.host.kernel.vocab.cards[name].during.some(s=>s.verb==='mars:sleep'&&s.params.mat===r.mat));assert.ok(card);
      const response=await accept(f.host,f.request('/v1/souls/'+m.soulId+'/intent',{intent:{agenda:[{card,target:null}]}},'resident'+i));assert.equal(response.status,200);
      const option=optionsFor(f.host,m).find(o=>o.card===card);assert.ok(option,'actual owned sleep option '+m.name);
      const steps=option.steps.map(s=>s.verb==='mars:sleep'?{...s,params:{...s.params,duration:.2}}:s);await select(f,m,option,steps);
      const program=f.host.engine.programOf(m.entityId);let lyingTick:number|undefined,pair:any;
      await finish(f,m,body=>{if(body.human.sleepPose){assert.equal(body.human.sleepPose.mat,r.mat);assert.equal(body.pose.p[1],0);if(body.human.sleepPose.standingFraction===0&&lyingTick===undefined)lyingTick=f.host.engine.world.tick;}if(lyingTick!==undefined&&!pair)pair=capture(lyingTick);});
      assert.ok(programEvents.some(e=>e.id===program&&e.kind==='completed'),'actual sleep program completed '+m.name);assert.ok(lyingTick!==undefined);assert.ok(pair,'actual public lying interval retained');
      const sampled=sampleTake(pair.take,(lyingTick-pair.take.startTick)*pair.take.dt).entities[m.entityId] as any;
      assert.equal(sampled.state.sleepPose.mat,r.mat);assert.equal(sampled.state.sleepPose.standingFraction,0);assert.equal(sampled.p[1],0);capture();
      const location=f.host.engine.observeBodyLocation!(m.entityId);assert.ok(location);assert.deepEqual(location.root,f.host.engine.world.entities[m.entityId].pose.p);
      trace.push({soulId:m.soulId,entityId:m.entityId,phase:'sleep',tick:f.host.engine.world.tick,lyingTick,lyingTakeId:pair.take.id,mat:r.mat,root:[...location.root]});
    }
    assert.equal((f.host.engine.world.entities['camp-eight-stew'] as any).contents.fraction,0);const repeat=await f.host.adoptCampExpansion('world');assert.equal(repeat.seq,upgrade.seq);assert.equal((f.host.engine.world.entities['camp-eight-stew'] as any).contents.fraction,0,'idempotent upgrade does not replenish spent supplies');
    f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)},life=hashOf([...f.host.minds.values()].map(m=>m.life));
    const reopened=new Db(path);try{
      const boot=new WorldHost(reopened,factory,'native-owner-lifecycle',1e9,f.host.worldId,{durableClockV1:true});assert.equal(boot.boot().from,'snapshot');new CampCards(boot);await drain({...f,host:boot});assert.deepEqual({engine:boot.engine.stateHash(),kernel:kernelHash(boot.kernel)},head);assert.equal(hashOf([...boot.minds.values()].map(m=>m.life)),life);boot.stop();
      reopened.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
      const genesis=new WorldHost(reopened,factory,'native-owner-lifecycle',1e9,f.host.worldId,{durableClockV1:true});assert.equal(genesis.boot().from,'genesis');new CampCards(genesis);await drain({...f,host:genesis});assert.deepEqual({engine:genesis.engine.stateHash(),kernel:kernelHash(genesis.kernel)},head);assert.equal(hashOf([...genesis.minds.values()].map(m=>m.life)),life);genesis.stop();
    }finally{reopened.close();}
    assert.equal(f.db.events(f.host.worldId).filter(e=>e.payload?.campExpansion).length,1);assert.equal(f.db.paidCost(),0);
    assert.equal(JSON.stringify(publicPairs).includes('PRIVATE_GROUND_UPGRADE_OWNER_CONTEXT'),false);assert.equal(publicPairs.every(p=>p.capture),true);
    const proof={contract:'core-owned-eight-camp-ground/1',stage:'installed-in-isolated-native-WorldHost',worldId:f.host.worldId,upgrade,trace,head,life,headTick:f.host.engine.world.tick,physicalBase:f.host.engine.world.base,
      actors:minds.map(m=>({soulId:m.soulId,entityId:m.entityId,owner:m.owner,ready:f.souls.controlReady(f.db.soul(m.soulId)!)})),programEvents,publicPairs,paidUSD:0,nativeViolations:f.host.engine.runtime.violations,
      source:{testHash:hashOf(readFileSync(new URL(import.meta.url),'utf8'))},limits:['Synthetic dev owners/fake minds; structured legacy owner requests/selected fixture decisions','sleep recipe uses explicit short .2s fixture duration, same admitted mat/controller/envelope','Ground support0/3.2x1.4m areas, no4cm mattress/upper floor/stair/material bill/pool qualification','No station-era carry, realAuth/currentcommonscohort/default/release/World draw proof']};
    const out=new URL('../../../.e2e/camp-expansion/',import.meta.url);mkdirSync(out,{recursive:true});const file=new URL(new Date().toISOString().replaceAll(':','-')+'.json',out);writeFileSync(file,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log('Synthetic private camp upgrade proof '+file.pathname);
  }finally{f.host.stop();f.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('transactional header failure and concurrent source movement never install an unlogged physical upgrade',async t=>{
  const f=local(t,':memory:');try{
    const before={engine:f.host.engine.stateHash(),seq:f.host.seq,header:f.db.world(f.host.worldId)!.rules_version};
    f.db.db.exec("CREATE TRIGGER refuse_camp_upgrade BEFORE UPDATE OF rules_version ON worlds BEGIN SELECT RAISE(ABORT,'synthetic header refusal'); END");
    await assert.rejects(accept(f.host,f.host.adoptCampExpansion('world')),/synthetic header refusal/);assert.deepEqual({engine:f.host.engine.stateHash(),seq:f.host.seq,header:f.db.world(f.host.worldId)!.rules_version},before);
    f.db.db.exec('DROP TRIGGER refuse_camp_upgrade');const pending=f.host.adoptCampExpansion('world');f.host.engine.step();await assert.rejects(accept(f.host,pending),/source-moved/);assert.equal(f.host.engine.world.base.campus,'eden-camp');assert.equal(f.db.events(f.host.worldId).filter(e=>e.payload?.campExpansion).length,0);
  }finally{f.host.stop();f.db.close();}
});
test('existing station history explicitly refuses a ground upgrade without its qualified atomic rules-era carry',async t=>{
  const f=local(t,':memory:');try{
    await accept(f.host,new CandidateStationV1(f.host).record());const before={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel),seq:f.host.seq};
    await assert.rejects(f.host.adoptCampExpansion('world'),/station-era-reader-required/);
    assert.deepEqual({engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel),seq:f.host.seq},before);
  }finally{f.host.stop();f.db.close();}
});
