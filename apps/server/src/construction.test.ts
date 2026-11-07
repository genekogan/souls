import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marsFactory, type MarsWorldConfig } from '@souls/engine-mars';
import type { WorldState } from '../../../mars/viewer/engine/world/types.ts';
import { CAMP_ARRIVALS } from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
import { kernelHash, cardHash, type Card } from '@souls/kernel';
import { Db } from './db.ts';
import { WorldHost, replayFromGenesis } from './world.ts';
const cfg: MarsWorldConfig={scene:'eden-camp',arrival:CAMP_ARRIVALS[0].p,arrivalPlace:'yard',reference:CAMP_ARRIVALS[1].p,grounds:{id:'grounds',name:'Camp'}};
async function setup(){
 const db=new Db(join(mkdtempSync(join(tmpdir(),'souls-build-')),'sim.db')),factory=await marsFactory(cfg),h=new WorldHost(db,factory,'physical-build',1e9,'build-proof');h.boot();
 for(const [i,name] of ['Alice','Bob','Carol','David'].entries())void h.enqueue('birth','test',{soulId:`s${i}`,entityId:`h${i}`,name,description:'A builder',owner:'proof-owner'});
 h.tickOnce();
 for(const phase of ['stage','frame']){
  const card:Card={name:`build ${phase}`,summary:`Choose finite ${phase} work`,good_when:'Building the camp lookout',target:null,when:[],then:[{set:['$actor','doing',`building ${phase}`]}],approach:[],during:[{verb:'build_lookout',params:{phase}}],takes:'minutes'};
  void h.enqueue('mint','test',{forSoul:'s0',card:{...card,hash:cardHash(card),by:'world',mintedAt:h.engine.world.tick,origin:'agent'}});
 }
 h.drainInputs();h.saveSnapshot();return {db,factory,h};
}
function choose(h:WorldHost,phase:string){void h.enqueue('decision','test',{soulId:'s0',entityId:'h0',option:`build ${phase}`,card:`build ${phase}`,label:`build ${phase}`,steps:[{verb:'build_lookout',params:{phase}}],target:null,approachLen:0,reevalTicks:90000,trigger:'test',fallback:true});h.tickOnce();assert.ok(h.minds.get('s0')!.pending);}
function finish(h:WorldHost){for(let i=0;i<90000&&h.engine.programOf('h0');i++)h.tickOnce();assert.equal(h.engine.programOf('h0'),null);assert.deepEqual(h.engine.runtime.violations,[]);}
test('actual host replays an unsnappable mid-carry from its checkpoint and log; physical progress survives restart',async()=>{
 const {db,factory,h}=await setup();
 try{
  choose(h,'stage');let carried=false;
  for(let i=0;i<10000;i++){h.tickOnce();if((h.engine.world as WorldState).entities['upright-a'].phase==='carried'){carried=true;break;}}
  assert.ok(carried);assert.equal(h.engine.canSnapshot!(),false);
  const seq=h.seq;assert.equal(h.saveSnapshot(false)!.pending,true);assert.equal(h.seq,seq,'periodic retries do not emit head markers');
  assert.equal(h.saveSnapshot(true)!.pending,true);
  assert.equal(db.events(h.worldId).at(-1)!.tick,h.engine.world.tick,'graceful checkpoint retains the actual head');
  assert.equal(db.events(h.worldId).at(-1)!.payload.checkpoint,'unsnappable-head');
  const fresh=new WorldHost(db,factory,'physical-build',1e9,h.worldId);fresh.boot();
  assert.equal(fresh.engine.stateHash(),h.engine.stateHash());assert.equal(kernelHash(fresh.kernel),kernelHash(h.kernel));assert.equal(fresh.engine.actorBorrowed!('h1'),false);
  for(let i=0;i<300;i++){h.tickOnce();fresh.tickOnce();assert.equal(fresh.engine.stateHash(),h.engine.stateHash());}
  finish(h);h.saveSnapshot();const built=new WorldHost(db,factory,'physical-build',1e9,h.worldId);built.boot();assert.equal(built.engine.physicalHash(),h.engine.physicalHash());
  assert.equal(built.engine.canPerform({actor:'h0',label:'again',steps:[{verb:'build_lookout',params:{phase:'stage'}}]})?.code,'construction.done');
  const replay=replayFromGenesis(factory,'physical-build',db.events(h.worldId),h.engine.world.tick);assert.equal(replay.engine.stateHash(),h.engine.stateHash());assert.equal(kernelHash(replay.kernel),kernelHash(h.kernel));
 }finally{db.close();}
});
test('unsafe frame action interruption triggers accepted-baseline recovery and leaves no held loads',async()=>{
 const {db,h}=await setup();
 try{
  choose(h,'stage');finish(h);h.saveSnapshot();choose(h,'frame');let cancelled=false;
  for(let i=0;i<10000;i++){
   h.tickOnce();
   if(['upright-a','upright-b'].every(id=>(h.engine.world as WorldState).entities[id].support?.kind==='held')){
    const r=[...h.engine.runtime.records.values()].find(r=>r.verb==='connect_beam'&&['executing','blocked'].includes(r.status));
    if(r){h.engine.cancel(r.id,{code:'proof.interrupted-beam',message:'Controlled construction failure'});cancelled=true;break;}
   }
  }
  assert.ok(cancelled);for(let i=0;i<200&&!db.events(h.worldId).some(e=>e.payload?.recovery);i++)h.tickOnce();
  assert.ok(db.events(h.worldId).some(e=>e.payload?.recovery));assert.equal((h.extra.cardFaults as Record<string,number>)?.['build frame'],1);
  for(const id of ['upright-a','upright-b'])assert.notEqual((h.engine.world as WorldState).entities[id].support?.kind,'held');
  assert.deepEqual(h.engine.runtime.violations,[]);for(let i=0;i<100;i++)h.tickOnce();
 }finally{db.close();}
});

test('logged runtime policy persists in both checkpoint readers and genesis replay',async()=>{
 const {db,factory,h}=await setup();
 try {
  assert.equal(h.extra.runtimePolicy,undefined);
  assert.equal((h.engine.snapshot() as any).cfg.sleepBlockTicks,undefined);
  void h.enqueue('rules','world',{runtimePolicy:{sleepBlockTicks:1200,quietSeatCourtesy:true},why:'bounded live-card blockage and quiet courtesy from this tick'});h.tickOnce();
  assert.deepEqual(h.extra.runtimePolicy,{sleepBlockTicks:1200,quietSeatCourtesy:true});assert.equal((h.engine.snapshot() as any).cfg.quietSeatCourtesy,true);assert.equal((h.engine.snapshot() as any).cfg.sleepBlockTicks,1200);h.saveSnapshot();
  const fresh=new WorldHost(db,factory,'physical-build',1e9,h.worldId);fresh.boot();
  assert.equal(fresh.engine.stateHash(),h.engine.stateHash());assert.deepEqual(fresh.extra.runtimePolicy,h.extra.runtimePolicy);assert.equal((fresh.engine.snapshot() as any).cfg.sleepBlockTicks,1200);assert.equal((fresh.engine.snapshot() as any).cfg.quietSeatCourtesy,true);
  const replay=replayFromGenesis(factory,'physical-build',db.events(h.worldId),h.engine.world.tick);assert.equal(replay.engine.stateHash(),h.engine.stateHash());assert.equal((replay.engine.snapshot() as any).cfg.sleepBlockTicks,1200);assert.equal((replay.engine.snapshot() as any).cfg.quietSeatCourtesy,true);
 } finally {db.close();}
});
