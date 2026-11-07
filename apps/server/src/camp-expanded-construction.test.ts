import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {hashOf} from '@souls/engine-contract';
import {kernelHash} from '@souls/kernel';
import {marsCampExpansionFactory,type MarsWorldConfig} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {CampCards} from './camp.ts';
import {optionsFor} from './deck.ts';
import {WorldHost} from './world.ts';
import {LOOKOUT_BEAMS} from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import type {Entity as NativeEntity} from '../../../mars/viewer/engine/world/types.ts';
const cfg:MarsWorldConfig={scene:'eden-camp',safeArrivalV1:true,safeCrewRemoval:true,arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Camp grounds'}};
const factory=await marsCampExpansionFactory(cfg);
async function drain(f:ReturnType<typeof fixture>){for(let i=0;i<4;i++){f.host.drainInputs();await setImmediate();}}
test('expanded eight-owned camp builds the original finite supported lookout and preserves real mid-carry replay',async t=>{
  const timers:ReturnType<typeof setInterval>[]=[],interval=setInterval;t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=interval(...args);timers.push(timer);return timer;});t.after(()=>timers.forEach(clearInterval));
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
  try{
    for(const [i,name] of ['Alice','Bob','Carol','David','Eve','Frank','Grace','Hank'].entries()){
      await invite(f,'builder'+i);const op=f.souls.acceptLifecycleCreate('dev:builder'+i,{name,description:'Synthetic human-owned expanded-camp builder'});await drain(f);assert.equal(f.souls.controlReady(f.db.soul(op.scope.soulId)!),true);
      f.host.minds.get(op.scope.soulId)!.nextEvalTick=1e9;
    }
    const sourceParts=Object.fromEntries(Object.entries(f.host.engine.world.entities).filter(([,e])=>e.kind==='component').map(([id,e])=>[id,structuredClone(e)]));
    await accept(f.host,f.host.adoptCampExpansion('world'));new CampCards(f.host);await drain(f);
    const actor=[...f.host.minds.values()].find(m=>m.name==='Alice')!,events:any[]=[],step=f.host.engine.step.bind(f.host.engine);
    t.mock.method(f.host.engine,'step',()=>{const out=step();events.push(...out.programs);return out;});
    const pairs:any[]=[],capture=()=>{const c=f.host.engine.takeChunks!(-1).at(-1);if(c){const take=c.take as any;if(!pairs.some(p=>p.take.id===take.id))pairs.push({take:structuredClone(take),capture:f.host.engine.takeScene!(take.renderSceneRef.hash)});}};
    assert.equal(optionsFor(f.host,actor).some(o=>o.card==='build climb lookout alice'),false,'unbuilt deck/stair grants no traversal');
    const trace:any[]=[];let replayedCarry=false;
    for(const phase of ['stage','frame','deck','stairs']){
      const card='build lookout '+phase+' alice';const response=await accept(f.host,f.request('/v1/souls/'+actor.soulId+'/intent',{intent:{agenda:[{card,target:null}]}},'builder0'));assert.equal(response.status,200);
      const option=optionsFor(f.host,actor).find(o=>o.card===card);assert.ok(option,'native construction option on expanded registered base');
      void f.host.enqueue('decision','fixture',{soulId:actor.soulId,entityId:actor.entityId,option:option.id,card:option.card,target:null,label:option.label,steps:option.steps,approachLen:option.approachLen,reevalTicks:1e9,fallback:true,trigger:'fixture'});await drain(f);
      const program=f.host.engine.programOf(actor.entityId);assert.ok(program);let ticks=0;
      for(;ticks<30000&&f.host.engine.programOf(actor.entityId);ticks++){
        for(const m of f.host.minds.values())m.nextEvalTick=1e9;f.host.tickOnce();if(ticks%20===0)await setImmediate();
        if(!replayedCarry&&(f.host.engine.world.entities['upright-a'] as any).phase==='carried'){
          assert.equal(f.host.engine.canSnapshot!(),false);const saved=f.host.saveSnapshot(true);assert.equal(saved.pending,true);
          const boot=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId,{durableClockV1:true});boot.boot();
          assert.equal(boot.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(boot.kernel),kernelHash(f.host.kernel));boot.stop();replayedCarry=true;
          capture();
        }
      }
      await drain(f);assert.equal(f.host.engine.programOf(actor.entityId),null);assert.ok(events.some(e=>e.id===program&&e.kind==='completed'),'actual finite '+phase+' completed');
      assert.deepEqual(f.host.engine.runtime.violations,[]);trace.push({phase,tick:f.host.engine.world.tick,ticks,program,
        parts:Object.fromEntries(Object.keys(sourceParts).map(id=>[id,{def:f.host.engine.world.entities[id].def,phase:(f.host.engine.world.entities[id] as NativeEntity).phase,support:(f.host.engine.world.entities[id] as NativeEntity).support}]))});
      capture();
    }
    assert.equal(replayedCarry,true);for(const [id,e] of Object.entries(sourceParts))assert.equal(f.host.engine.world.entities[id].def,e.def,'same actual material definition');
    for(const id of ['upright-a','upright-b'])assert.equal((f.host.engine.world.entities[id] as NativeEntity).support?.kind,'connected');
    for(const {id} of LOOKOUT_BEAMS)assert.equal((f.host.engine.world.entities[id] as any).phase,'installed');
    assert.equal(f.host.engine.canPerform({actor:actor.entityId,label:'stage again',steps:[{verb:'build_lookout',params:{phase:'stage'}}]})?.code,'construction.done');
    const visitCard='build climb lookout alice';assert.ok(f.host.kernel.decks[actor.soulId].cards.includes(visitCard));
    const visitRequest=await accept(f.host,f.request('/v1/souls/'+actor.soulId+'/intent',{intent:{agenda:[{card:visitCard,target:null}]}},'builder0'));assert.equal(visitRequest.status,200);
    const visit=optionsFor(f.host,actor).find(o=>o.card===visitCard);assert.ok(visit,'actual supported stair now enables the original deck route');
    void f.host.enqueue('decision','fixture',{soulId:actor.soulId,entityId:actor.entityId,option:visit.id,card:visit.card,target:null,label:visit.label,steps:visit.steps,approachLen:visit.approachLen,reevalTicks:1e9,fallback:true,trigger:'fixture'});await drain(f);
    const visitProgram=f.host.engine.programOf(actor.entityId);assert.ok(visitProgram);let climbed=false;
    for(let i=0;i<5000&&f.host.engine.programOf(actor.entityId);i++){for(const m of f.host.minds.values())m.nextEvalTick=1e9;f.host.tickOnce();if((f.host.engine.world.entities[actor.entityId] as any).human.activity==='climb-up')climbed=true;if(i%20===0)await setImmediate();}
    await drain(f);assert.equal(f.host.engine.programOf(actor.entityId),null);assert.ok(events.some(e=>e.id===visitProgram&&e.kind==='completed'));assert.equal(climbed,true);assert.equal((f.host.engine.world.entities[actor.entityId] as any).human.level,4);assert.ok(f.host.engine.world.entities[actor.entityId].pose.p[1]>1.8);assert.deepEqual(f.host.engine.runtime.violations,[]);
    trace.push({phase:'visit-built-lookout',tick:f.host.engine.world.tick,program:visitProgram,root:[...f.host.engine.world.entities[actor.entityId].pose.p],level:4});capture();assert.ok(pairs.every(p=>p.capture));
    f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)},boot=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId,{durableClockV1:true});boot.boot();assert.deepEqual({engine:boot.engine.stateHash(),kernel:kernelHash(boot.kernel)},head);boot.stop();
    f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const genesis=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId,{durableClockV1:true});assert.equal(genesis.boot().from,'genesis');assert.deepEqual({engine:genesis.engine.stateHash(),kernel:kernelHash(genesis.kernel)},head);genesis.stop();assert.equal(f.db.paidCost(),0);
    const proof={contract:'core-expanded-camp-stock-frame/1',worldId:f.host.worldId,base:f.host.engine.world.base,head,headTick:f.host.engine.world.tick,trace,events,replayedCarry,pairs,
      owners:8,parts:Object.keys(sourceParts),paidUSD:0,sourceHash:hashOf(readFileSync(new URL(import.meta.url),'utf8')),limits:['Synthetic invited owned humans; explicit legacy owner agendas/selected decisions','Original finite lookout four build phases and native stair visit; not expanded12x8deck18treads/deconstruction/material recovery','Inherited finite free-crew borrowing, not new independent multi-owner consent/composition','No Worlddraw/ordinarylanguage/autonomous/cohort/default/release qualification']};
    const dir=new URL('../../../.e2e/camp-expanded-construction/',import.meta.url);mkdirSync(dir,{recursive:true});const file=new URL(new Date().toISOString().replaceAll(':','-')+'.json',dir);writeFileSync(file,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log('Synthetic private expanded construction proof '+file.pathname);
  }finally{f.host.stop();f.db.close();}
});
