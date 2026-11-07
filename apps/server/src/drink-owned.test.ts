import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {hashOf} from '@souls/engine-contract';
import {cardHash,kernelHash,type Card} from '@souls/kernel';
import {nativeCampDrinkFactory} from '../../../packages/engine-mars/src/drink-engine.ts';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {WorldHost} from './world.ts';
import {optionsFor} from './deck.ts';
const factory=await nativeCampDrinkFactory();
test('one invited owned Soul chooses finite water drinking through its actual owner/card/native pipeline and exact restart/genesis',async t=>{
  const timers:ReturnType<typeof setInterval>[]=[],interval=setInterval;t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=interval(...args);timers.push(timer);return timer;});t.after(()=>timers.forEach(clearInterval));
  const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();
  try{
    await invite(f,'alice');const op=f.souls.acceptLifecycleCreate('dev:alice',{name:'Cedar',description:'Synthetic invited owner drink fixture'});for(let i=0;i<4;i++){f.host.drainInputs();await setImmediate();}
    const m=f.host.minds.get(op.scope.soulId)!;assert.equal(f.souls.controlReady(f.db.soul(m.soulId)!),true);m.nextEvalTick=1e9;
    const card:Card={name:'drink two water sips',summary:'Take finite water, drink two sips and return the bowl.',good_when:'Wanting a drink; actual water, free hand and still support are required.',target:null,when:[],then:[{set:['$actor','doing','drinking water']}],
      approach:[{verb:'mars:take_item',params:{item:'water-bowl',hand:'left'}}],during:[{verb:'mars:drink_water',params:{container:'water-bowl',sips:2}},{verb:'mars:put_item',params:{item:'water-bowl',surfaceSlot:'garden-table#r0c1'}}],takes:'minute'};
    await accept(f.host,f.host.enqueue('mint','world',{forSoul:m.soulId,card:{...card,hash:cardHash(card),by:'world',mintedAt:f.host.engine.world.tick,origin:'agent'}}));
    const response=await accept(f.host,f.request('/v1/souls/'+m.soulId+'/intent',{intent:{agenda:[{card:card.name,target:null}]}},'alice'));assert.equal(response.status,200);
    const option=optionsFor(f.host,m).find(o=>o.card===card.name);assert.ok(option);void f.host.enqueue('decision','fixture',{soulId:m.soulId,entityId:m.entityId,option:option.id,card:option.card,target:null,label:option.label,steps:option.steps,approachLen:option.approachLen,reevalTicks:1e9,fallback:true,trigger:'fixture'});f.host.drainInputs();
    const program=f.host.engine.programOf(m.entityId);assert.ok(program);const events:any[]=[],pairs:any[]=[],step=f.host.engine.step.bind(f.host.engine);t.mock.method(f.host.engine,'step',()=>{const out=step();events.push(...out.programs);return out;});
    let drank=false,restored=false;
    for(let i=0;i<4000&&f.host.engine.programOf(m.entityId);i++){
      m.nextEvalTick=1e9;f.host.tickOnce();if(i%20===0)await setImmediate();const body=f.host.engine.world.entities[m.entityId] as any;
      if(body.human.activity==='drink'){
        drank=true;assert.ok(body.human.hands.left);
        if(!restored){f.host.saveSnapshot(true);const boot=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId,{durableClockV1:true});boot.boot();assert.equal(boot.engine.stateHash(),f.host.engine.stateHash());assert.equal(kernelHash(boot.kernel),kernelHash(f.host.kernel));boot.stop();restored=true;}
      }
      if(drank)for(const c of f.host.engine.takeChunks!(-1)){const take=c.take as any;if(!pairs.some(p=>p.take.id===take.id))pairs.push({take:structuredClone(take),capture:f.host.engine.takeScene!(take.renderSceneRef.hash)});}
    }
    for(let i=0;i<4;i++){f.host.drainInputs();await setImmediate();}assert.equal(drank,true);assert.equal(restored,true);assert.equal(f.host.engine.programOf(m.entityId),null);assert.ok(events.some(e=>e.id===program&&e.kind==='completed'));
    const bowl=f.host.engine.world.entities['water-bowl'] as any;assert.equal(bowl.contents.fraction,.75);assert.equal(bowl.support.kind,'resting-on');assert.equal(bowl.support.on,'garden-table');assert.equal(bowl.support.slot,'r0c1');assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);
    f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const genesis=new WorldHost(f.db,factory,'native-owner-lifecycle',1e9,f.host.worldId,{durableClockV1:true});assert.equal(genesis.boot().from,'genesis');assert.deepEqual({engine:genesis.engine.stateHash(),kernel:kernelHash(genesis.kernel)},head);genesis.stop();
    const proof={contract:'core-owned-drink-water/1',worldId:f.host.worldId,rulesVersion:f.host.engine.rulesVersion,physicalBase:f.host.engine.world.base,head,headTick:f.host.engine.world.tick,program,events,pairs,initialWater:1,remainingWater:bowl.contents.fraction,owner:'synthetic invited local human',paidUSD:0,sourceHash:hashOf(readFileSync(new URL(import.meta.url),'utf8')),
      limits:['Fresh explicit drink/1 base, no old-world transition/default/C194/expandedcamp adoption','Legacy structured owner agenda and selected fixture choice, not ordinary-language/compiler/autonomous hydration','No thirst/hunger benefit invented; sitting overlay separately native-tested','No loaded-rig World depiction/realAuth/cohort/release claim']};
    const dir=new URL('../../../.e2e/drink-water/',import.meta.url);mkdirSync(dir,{recursive:true});const file=new URL(new Date().toISOString().replaceAll(':','-')+'.json',dir);writeFileSync(file,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log('Synthetic private owned drinking proof '+file.pathname);
  }finally{f.host.stop();f.db.close();}
});
