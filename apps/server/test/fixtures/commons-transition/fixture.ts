// Real isolated SQLite + native WorldHost. No provider, socket or renderer.
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marsFactory,marsCommonsTransitionFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { kernelHash } from '@souls/kernel';
import { hashOf,type Engine,type RenderSceneCaptureV1 } from '@souls/engine-contract';
import { Db } from '../../../src/db.ts';
import { WorldHost,replayFromGenesis } from '../../../src/world.ts';
type TakeChunk=ReturnType<NonNullable<Engine['takeChunks']>>[number];

export async function existingCommonsFixture(){
  const dir=mkdtempSync(join(tmpdir(),'core-existing-commons-')),path=join(dir,'world.sqlite');
  let db=new Db(path);
  try{
    const legacy=await marsFactory(GREEN_FIELD_WORLD),factory=await marsCommonsTransitionFactory();
    let host=new WorldHost(db,legacy,'existing-commons-public',1e9,'existing-commons-public');host.boot();
    db.upsertUser({id:'PRIVATE_OWNER_FIXTURE',email:null,wallet:null,role:'user'});
    db.createSoul({id:'s_A',entityId:'h_A',worldId:host.worldId,owner:'PRIVATE_OWNER_FIXTURE',name:'Alice',description:'An existing resident',native:false});
    void host.enqueue('birth','fixture',{soulId:'s_A',entityId:'h_A',owner:'PRIVATE_OWNER_FIXTURE',name:'Alice',description:'An existing resident'});host.tickOnce();
    const intent={agenda:[{card:'rest'}],text:'PRIVATE_RETAINED_PURPOSE'};
    const direction=host.enqueue('intent','fixture',{soulId:'s_A',intent,source:'system'});host.drainInputs();await direction;
    host.saveSnapshot();db.close();db=new Db(path);
    host=new WorldHost(db,factory,'existing-commons-public',1e9,'existing-commons-public');assert.equal(host.boot().from,'snapshot');
    const chunks=new Map<number,TakeChunk>(),scenes=new Map<string,RenderSceneCaptureV1>();
    const collect=()=>{for(const c of host.engine.takeChunks!(-1)){
      if(chunks.has(c.fromTick))continue;
      const ref=(c.take as {renderSceneRef:{hash:string}}).renderSceneRef,scene=host.engine.takeScene!(ref.hash)!;
      assert.ok(scene);db.saveTake(host.worldId,c,scene);chunks.set(c.fromTick,structuredClone(c));scenes.set(ref.hash,scene);
    }};
    while(host.engine.world.tick<37){host.tickOnce();collect();}
    const bodyBefore=structuredClone(host.engine.world.entities.h_A),oldRules=host.engine.rulesVersion;
    const request=host.adoptCommons('world:checkpoint');host.drainInputs();const event=await request;collect();
    const bodyAfter=structuredClone(host.engine.world.entities.h_A);assert.deepEqual(bodyAfter,bodyBefore);
    assert.deepEqual(host.minds.get('s_A')!.intent,intent);
    const decision=host.enqueue('decision','soul:s_A',{soulId:'s_A',entityId:'h_A',card:'go to',target:'commons',option:'go to@commons',label:'walk to commons',
      steps:[{verb:'walk_to',params:{to:'commons',standoff:0}}],approachLen:1,reevalTicks:10000,trigger:'fixture',fallback:false});
    host.drainInputs();await decision;
    while(host.engine.world.tick<297){host.tickOnce();collect();}
    assert.deepEqual(host.engine.world.entities.h_A.pose.p,[9,0,5]);assert.equal(host.kernel.things.s_A.at,'commons');assert.equal(host.counts['go to'],1);
    // Explicit existing checkpoint fact records this fixture's real head tick.
    // This does not fix the general unlogged idle-tail restart fault.
    const frontier=host.enqueue('rules','world:checkpoint',{checkpoint:'fixture-observed-head'});host.drainInputs();await frontier;
    const events=db.events(host.worldId),hash=host.engine.stateHash(),kernel=kernelHash(host.kernel);
    const replay=replayFromGenesis(factory,'existing-commons-public',events,297,{includeHeadEvents:true});
    assert.equal(replay.engine.stateHash(),hash);assert.equal(kernelHash(replay.kernel),kernel);
    host.saveSnapshot();db.close();db=new Db(path);
    host=new WorldHost(db,factory,'existing-commons-public',1e9,'existing-commons-public');assert.equal(host.boot().from,'snapshot');
    assert.equal(host.engine.stateHash(),hash);assert.equal(kernelHash(host.kernel),kernel);
    assert.deepEqual(host.minds.get('s_A')!.intent,intent);assert.equal(db.soul('s_A')!.owner,'PRIVATE_OWNER_FIXTURE');
    db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(host.worldId);
    const genesis=new WorldHost(db,factory,'existing-commons-public',1e9,'existing-commons-public');assert.equal(genesis.boot().from,'genesis');
    assert.equal(genesis.engine.stateHash(),hash);assert.equal(kernelHash(genesis.kernel),kernel);assert.deepEqual(genesis.minds.get('s_A')!.intent,intent);
    assert.equal(db.paidCost(),0);assert.deepEqual(genesis.engine.runtime.violations,[]);
    const output={contract:'existing-commons-fixture/1',worldId:host.worldId,actorId:'h_A',soulId:'s_A',
      transition:event.payload.commonsTransition,oldRulesVersion:oldRules,rulesVersion:host.engine.rulesVersion,
      bodyBefore,bodyAfter,finalRoot:host.engine.world.entities.h_A.pose.p,finalTick:297,finalStateHash:hash,
      scenes:[...scenes.values()],chunks:[...chunks.values()],
      evidence:{snapshotRestart:true,genesisRestart:true,modelFreeReplay:true,ordinaryOwnerRetained:true,privateIntentRetained:true,
        actualCard:'go to',actualTarget:'commons',actualPlayCount:1,recordedHeadCheckpoint:true,paidSpendUSD:0}};
    assert.equal(JSON.stringify(output).includes('PRIVATE_'),false);
    assert.equal(output.chunks.some(c=>c.fromTick<37&&c.toTick>37),false);
    assert.equal(output.scenes.length,2);assert.equal(output.chunks.at(-1)!.toTick,297);
    // Exactly the same public bytes can be regenerated; private events stay local.
    hashOf(output);return JSON.parse(JSON.stringify(output)) as typeof output;
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
}
