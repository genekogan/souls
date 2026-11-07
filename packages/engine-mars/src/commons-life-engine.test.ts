import test from 'node:test';
import assert from 'node:assert/strict';
import {hashOf} from '@souls/engine-contract';
import {commonsLifeReaderFactory} from './commons-life-engine.ts';
import {marsCrewRemovalTransitionFactory} from './crew-removal-engine.ts';
import {marsFactory,EDEN_SAFE_COMMONS_WORLD} from './engine.ts';
for(const legacy of [true,false])test('life reader keeps '+(legacy?'actual legacy':'existing commons')+' genesis through resource adoption and exact restoration',async()=>{
 const origin=legacy?await marsCrewRemovalTransitionFactory():await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true}),f=commonsLifeReaderFactory(origin),e=f.create(f.genesis('portable-life'));e.spawnHuman({id:'h',label:'Hypothetical original resident',soul:'fixture'});
 const initial=e.stateHash();assert.equal(hashOf(f.genesis('portable-life')),hashOf(origin.genesis('portable-life')));assert.equal(origin.restore(e.snapshot()).stateHash(),initial);
 if(legacy){const crew=e.previewCrewRemovalTransitionV1!();assert.ok(crew.ok);if(!crew.ok)return;e.adoptCrewRemovalTransitionV1!(crew.transition);const p=e.previewCommonsTransition!();assert.ok(p.ok);if(!p.ok)return;e.adoptCommons!(p.transition);}
 const old=structuredClone(e.world.entities);
 const provisions=e.previewCommonsProvisionsV1!();assert.ok(provisions.ok);if(!provisions.ok)return;e.adoptCommonsProvisionsV1!(provisions.transition);
 const kitchen=e.previewCommonsKitchenV1!();assert.ok(kitchen.ok);if(!kitchen.ok)return;e.adoptCommonsKitchenV1!(kitchen.transition);
 const p=e.previewCommonsFoodDeliveryV1!('portable-finite-A');assert.ok(p.ok);if(!p.ok)return;e.adoptCommonsFoodDeliveryV1!(p.transition);for(const [id,v] of Object.entries(old))assert.deepEqual(e.world.entities[id],v);
 assert.ok(f.canReplayHistory!(e.rulesVersion));assert.equal(origin.canReplayHistory!(e.rulesVersion),false);const copy=f.restore(e.snapshot());assert.equal(copy.stateHash(),e.stateHash());for(let i=0;i<25;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());}
 const privatePolicy=e.snapshot() as any;privatePolicy.cfg.nativeArrivalWitnessV1=true;assert.throws(()=>f.restore(privatePolicy),/additional-reader-required/);
 const bad=e.snapshot() as any;bad.commonsProvisionsV1=false;assert.throws(()=>f.restore(bad),/snapshot-policy/);bad.commonsProvisionsV1=true;bad.stateHash='0'.repeat(64);assert.throws(()=>f.restore(bad),/snapshot-state/);e.configureRuntimePolicy?.({sleepBlockTicks:1200,nativeArrivalWitnessV1:true});assert.throws(()=>f.validateHistoryHead!(e,e.rulesVersion),/additional-reader-required/);
});
