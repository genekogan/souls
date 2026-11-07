// Actual isolated SQLite/native station carry fixture; no transport or audio.
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { marsFactory,marsCommonsTransitionFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { hashOf,type Engine,type RenderSceneCaptureV1 } from '@souls/engine-contract';
import { kernelHash } from '@souls/kernel';
import { publicEvent,stationEndTick,stationPhaseAtTickV2,stationLivePhaseV1,stationLivePhaseV2 } from '@souls/protocol';
import { WorldHost } from '../../../src/world.ts';
import { Db } from '../../../src/db.ts';
import { CandidateStationV1 } from '../../../src/station.ts';
import { CandidateStationV2 } from '../../../src/station-v2.ts';
type Chunk=ReturnType<NonNullable<Engine['takeChunks']>>[number];
async function accept<T>(host:WorldHost,promise:Promise<T>){
  let done=false;promise.then(()=>done=true,()=>done=true);
  for(let n=0;n<40&&!done;n++){host.drainInputs();await setImmediate();}assert.ok(done);return promise;
}
async function journey(mode:'inside-cue'|'silence'){
  const dir=mkdtempSync(join(tmpdir(),'core-station-era-public-')),path=join(dir,'world.sqlite');let db=new Db(path);
  try{
    const legacy=await marsFactory(GREEN_FIELD_WORLD),factory=await marsCommonsTransitionFactory(),worldId='station-era-'+mode,seed=worldId;
    let host=new WorldHost(db,legacy,seed,1e9,worldId);host.boot();
    const owner='PRIVATE_STATION_ERA_OWNER',intent={goal:'rest' as const,text:'PRIVATE_STATION_ERA_RETAINED_WORDS'};
    db.upsertUser({id:owner,email:null,wallet:null,role:'user'});
    db.createSoul({id:'s_A',entityId:'h_A',worldId,owner,name:'Alice',description:'Existing resident',native:false});
    await accept(host,host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner,name:'Alice',description:'Existing resident'}));host.tickOnce();
    await accept(host,host.enqueue('intent','fixture',{soulId:'s_A',intent,source:'web'}));
    const oldProducer=new CandidateStationV1(host),initial=await accept(host,oldProducer.record()),original=host.stationHistoryV1()!,originalHash=hashOf(original);
    const originalRows=db.events(worldId).filter(e=>['station-epoch-v1','station-cue-v1','station-anchor-v1'].includes(e.kind)).map(publicEvent);
    host.saveSnapshot();db.close();db=new Db(path);host=new WorldHost(db,factory,seed,1e9,worldId);assert.equal(host.boot().from,'snapshot');
    const checkpointTick=mode==='inside-cue'?37:Math.ceil(stationEndTick(initial.cue!))+2;
    let nextCueTick=Number.MAX_SAFE_INTEGER;
    const chunks=new Map<number,Chunk>(),scenes=new Map<string,RenderSceneCaptureV1>();
    const collect=()=>{for(const c of host.engine.takeChunks!(-1)){
      if(chunks.has(c.fromTick)||!(c.fromTick<60||c.fromTick>=checkpointTick&&c.fromTick<checkpointTick+40||c.fromTick>=nextCueTick-20))continue;
      const ref=(c.take as {renderSceneRef:{hash:string}}).renderSceneRef,scene=host.engine.takeScene!(ref.hash)!;assert.ok(scene);
      chunks.set(c.fromTick,structuredClone(c));scenes.set(ref.hash,scene);db.saveTake(worldId,c,scene);
    }};
    while(host.engine.world.tick<checkpointTick){host.tickOnce();collect();}
    const bodyBefore=structuredClone(host.engine.world.entities.h_A),oldRulesVersion=host.engine.rulesVersion;
    const physical=await accept(host,host.adoptCommons('world:checkpoint',{stationEraV1:true}));collect();
    const bodyAfter=structuredClone(host.engine.world.entities.h_A);
    assert.deepEqual(bodyAfter,bodyBefore);assert.equal(hashOf(host.stationHistoryV1()),originalHash);
    const oldView=new CandidateStationV1(host).view(),v2=new CandidateStationV2(host),pending=v2.view();
    assert.equal(oldView.fresh,false);assert.equal(stationLivePhaseV1(oldView,Date.now()),null);assert.equal(pending.anchor,null);
    const carried=await accept(host,v2.record());
    if(mode==='inside-cue'){
      assert.equal(carried.cue!.cueId,initial.cue!.cueId);
      assert.deepEqual(stationLivePhaseV2(carried,carried.anchor!.serverTimeMs),stationPhaseAtTickV2(initial.cue!,checkpointTick));
      // Two actual independent native gathering programs, not a music-derived
      // body state. New human has a distinct local ordinary owner.
      const secondOwner='PRIVATE_STATION_ERA_SECOND_OWNER';db.upsertUser({id:secondOwner,email:null,wallet:null,role:'user'});
      db.createSoul({id:'s_B',entityId:'h_B',worldId,owner:secondOwner,name:'Bob',description:'Second resident',native:false});
      await accept(host,host.enqueue('birth','fixture',{soulId:'s_B',entityId:'h_B',owner:secondOwner,name:'Bob',description:'Second resident'}));
      for(const actor of ['A','B']){
        await accept(host,host.enqueue('decision','fixture',{soulId:'s_'+actor,entityId:'h_'+actor,label:'Gather at the commons bench',option:'fixture-gather',
          steps:[{verb:'gather',params:{at:'commons-bench-west',seconds:3600}}],reevalTicks:1e9,trigger:'fixture',fallback:false}));
        for(let n=0;n<1000&&host.engine.world.entities['h_'+actor].human!.activity!=='sit';n++){host.tickOnce();collect();}
        assert.equal(host.engine.world.entities['h_'+actor].human!.activity,'sit');
      }
      assert.equal(host.engine.gatheringObservation!().situation,'gathering');
    }
    while(host.engine.world.tick<Math.max(checkpointTick+43,Math.ceil(stationEndTick(initial.cue!))+3)){host.tickOnce();collect();}
    nextCueTick=host.engine.world.tick;
    const next=await accept(host,v2.record());collect();
    assert.equal(next.cue!.contract,'station-cue/2');assert.equal(next.cue!.observation.rulesVersion,host.engine.rulesVersion);
    assert.equal(next.cue!.pieceId,mode==='inside-cue'?'zoning-board':'starfield');
    const sameTickCut=v2.history({...original.station,rulesVersion:host.engine.rulesVersion},checkpointTick,physical.seq+1);
    assert.equal(sameTickCut.anchor,null);
    const history=[v2.history(original.station,checkpointTick-1),v2.history({...original.station,rulesVersion:host.engine.rulesVersion},checkpointTick),
      v2.history({...original.station,rulesVersion:host.engine.rulesVersion},nextCueTick),sameTickCut];
    if(mode==='inside-cue')history.push(v2.history({...original.station,rulesVersion:host.engine.rulesVersion},Math.ceil(stationEndTick(initial.cue!))+1));
    const head=host.stationPhysicalHeadV1()!,stationState=hashOf(host.stationHistoryV2()),bodyHash=host.engine.stateHash(),kh=kernelHash(host.kernel);
    assert.deepEqual(host.engine.runtime.violations,[]);assert.equal(hashOf(host.stationHistoryV1()),originalHash);
    assert.deepEqual(db.events(worldId).filter(e=>['station-epoch-v1','station-cue-v1','station-anchor-v1'].includes(e.kind)).map(publicEvent),originalRows);
    const finalFacts=db.events(worldId).filter(e=>e.kind.startsWith('station-')).map(publicEvent);
    const saved=host.saveSnapshot();assert.equal('pending' in saved,false);assert.equal(db.latestSnapshot(worldId)!.tick,nextCueTick);
    db.close();db=new Db(path);host=new WorldHost(db,factory,seed,1e9,worldId);assert.equal(host.boot().from,'snapshot');
    assert.equal(host.engine.stateHash(),bodyHash);assert.equal(hashOf(host.stationHistoryV2()),stationState);assert.equal(new CandidateStationV2(host).view().fresh,false);
    db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(worldId);host=new WorldHost(db,factory,seed,1e9,worldId);assert.equal(host.boot().from,'genesis');
    assert.equal(host.engine.stateHash(),bodyHash);assert.equal(kernelHash(host.kernel),kh);assert.equal(hashOf(host.stationHistoryV2()),stationState);
    assert.deepEqual(host.minds.get('s_A')!.intent,intent);assert.equal(db.soul('s_A')!.owner,owner);assert.equal(db.paidCost(),0);
    const output={mode,worldId,actorId:'h_A',checkpointTick,oldRulesVersion,rulesVersion:host.engine.rulesVersion,
      initial,oldView,pending,carried,next,history,physical:head,originalRows,finalFacts,bodyBefore,bodyAfter,
      pairedTakes:[...chunks.values()].sort((a,b)=>a.fromTick-b.fromTick),scenes:[...scenes.values()],
      reconstruction:{bodyHash,kernelHash:kh,stationStateHash:stationState,originalStationHash:originalHash,snapshot:'exact',genesis:'exact',privateDirectionRetained:true,ordinaryOwnerRetained:true},
      paidSpendUSD:0};
    assert.equal(JSON.stringify(output).includes('PRIVATE_STATION_ERA'),false);return output;
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
}
export async function generateStationEraFixture(){
  const journeys=[];for(const mode of ['inside-cue','silence'] as const)journeys.push(await journey(mode));
  const root=new URL('../../../../../',import.meta.url),paths=['packages/protocol/src/station-v1.ts','packages/protocol/src/station-era-v1.ts',
    'packages/protocol/src/station-v2.ts','packages/protocol/src/index.ts','apps/server/src/world.ts','apps/server/src/station.ts',
    'apps/server/src/station-v2.ts','apps/server/src/station-history-v2.ts','apps/server/test/fixtures/station-era/generate.ts'];
  const producer=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(new URL(p,root))).digest('hex')]));
  return {contract:'core-native-station-era-fixture/1',producer,
    scope:'actual isolated SQLite/native sequencer, same-dt physical/header/era, real Date.now anchors; no transport/audio/listener/device/consumer/default proof',journeys};
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(await generateStationEraFixture(),null,2)+'\n');
