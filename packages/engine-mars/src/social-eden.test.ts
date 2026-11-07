import {nativeEntity} from './native-test-state.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory} from './retained-shore-engine.ts';
import {socialEdenV1} from './social-eden.ts';
import {commonsFoodDeliveryItemsV1} from './food-delivery.ts';
import {COMMONS_PERSONAL_RESOURCES} from './commons-provisions.ts';
import type {Engine} from '@souls/engine-contract';
const f=await retainedCommonsShoreFactory({socialEdenV1:true,foodDeliveryV1:true});
function adopt(e:Engine,method:'previewCommonsProvisionsV1'|'previewCommonsKitchenV1'|'previewRetainedCommonsShoreV1'|'previewSocialEdenV1'){
 const p=e[method]!();assert.ok(p.ok,JSON.stringify(p));if(!p.ok)throw Error('refused');(e as any)[method.replace('preview','adopt')](p.transition);return p.transition;
}
function finish(e:Engine,actor:string,steps:any[],limit=4500){const p=e.perform({actor,label:'native social fixture',steps});assert.ok(p.ok,JSON.stringify(p));if(!p.ok)throw Error('refused');const activities=new Set<string>();for(let i=0;i<limit;i++){const out=e.step();activities.add(e.world.entities[actor].human!.activity);assert.deepEqual(e.runtime.violations,[]);const t=out.programs.find(v=>v.id===p.id&&['completed','failed'].includes(v.kind));if(t){assert.equal(t.kind,'completed',JSON.stringify(t));return activities;}}throw Error('native journey did not finish');}
test('additive social checkpoint preserves old worlds; carried finite food is actually eaten seated and reader restores exact continuation',()=>{
 const e=f.create(f.genesis('social-carried-meal'));e.spawnHuman({id:'h_A',label:'Synthetic social actor',soul:'fixture'});adopt(e,'previewCommonsProvisionsV1');adopt(e,'previewCommonsKitchenV1');adopt(e,'previewRetainedCommonsShoreV1');
 assert.equal(socialEdenV1().nativeGeometry.flatMap(f=>f.seats).length,14);
 const before=structuredClone(e.world.entities),regions=structuredClone(e.world.regions),hash=e.stateHash();const p=e.previewSocialEdenV1!();assert.ok(p.ok);assert.equal(e.stateHash(),hash);if(!p.ok)return;
 assert.throws(()=>e.adoptSocialEdenV1!({...p.transition,layoutHash:'0'.repeat(64)}),/stale-or-forged/);e.adoptSocialEdenV1!(p.transition);
 for(const [id,v] of Object.entries(before))assert.deepEqual(e.world.entities[id],v);for(const [id,v] of Object.entries(regions))assert.deepEqual(e.world.regions[id],v);
 const delivery=e.previewCommonsFoodDeliveryV1!('social-finite-A');assert.ok(delivery.ok);if(!delivery.ok)return;e.adoptCommonsFoodDeliveryV1!(delivery.transition);assert.equal(e.rulesVersion,delivery.transition.toRulesVersion);assert.ok(e.rulesVersion.length<=200);assert.ok(f.canReplayHistory!(e.rulesVersion));
 const r=commonsFoodDeliveryItemsV1(1).resources[0],chair='social-eden-dining-chair-west';
 const phases=finish(e,'h_A',[{verb:'mars:take_item',params:{item:r.bowl,hand:'left'}},{verb:'mars:take_item',params:{item:r.spoon,hand:'right'}},{verb:'sit',params:{on:chair,seconds:1}},{verb:'mars:eat',params:{bowl:r.bowl,spoon:r.spoon}},{verb:'stand',params:{}},{verb:'walk_to',params:{to:'commons'}},{verb:'mars:put_item',params:{item:r.spoon,surfaceSlot:'ground'}},{verb:'mars:put_item',params:{item:r.bowl,surfaceSlot:'ground'}}]);
 assert.ok(phases.has('sit'));assert.equal(nativeEntity(e,r.bowl).contents?.fraction,0);assert.equal(nativeEntity(e,COMMONS_PERSONAL_RESOURCES[0].bowl).contents?.fraction,1);
 const copy=f.restore(e.snapshot());assert.equal(copy.stateHash(),e.stateHash());for(let i=0;i<30;i++){e.step();copy.step();assert.equal(copy.stateHash(),e.stateHash());}
 const empty=e.canPerform({actor:'h_A',label:'empty social meal',steps:[{verb:'sit',params:{on:chair,seconds:1}},{verb:'mars:eat',params:{bowl:r.bowl,spoon:r.spoon}}]});assert.equal(empty?.code,'eat.bowl-empty');
 assert.equal((e.renderScene!().scene as any).social.layoutHash,socialEdenV1().layoutHash);assert.equal((e.renderScene!().scene as any).foodDeliveries.batches.length,1);
});
test('social before shore composes; occupied IDs and busy boundary refuse without mutation; legacy reader cannot adopt new header',async()=>{
 const e=f.create(f.genesis('social-before-shore'));adopt(e,'previewSocialEdenV1');adopt(e,'previewRetainedCommonsShoreV1');assert.equal(f.restore(e.snapshot()).stateHash(),e.stateHash());const legacy=await retainedCommonsShoreFactory();assert.equal(legacy.canReplayHistory!(e.rulesVersion),false);assert.throws(()=>legacy.restore(e.snapshot()),/social-eden.reader-required/);
 const w=f.genesis('social-collision');w.entities['social-eden-fire']={...socialEdenV1().entities['social-eden-fire']};const collision=f.create(w),hash=collision.stateHash(),p=collision.previewSocialEdenV1!();assert.equal(p.ok,false);assert.equal(collision.stateHash(),hash);
 const busy=f.create(f.genesis('social-busy'));busy.spawnHuman({id:'h_A',label:'Synthetic busy actor',soul:'fixture'});adopt(busy,'previewCommonsProvisionsV1');assert.ok(busy.perform({actor:'h_A',label:'finite rest',steps:[{verb:'mars:sleep',params:{mat:COMMONS_PERSONAL_RESOURCES[0].mat,duration:2}}]}).ok);busy.step();assert.equal(busy.previewSocialEdenV1!().ok,false);
});

test('an actual standing actor under a new table defers installation without moving that actor',()=>{const e=f.create(f.genesis('social-actor-conflict'));e.spawnHuman({id:'h_A',label:'Synthetic retained actor',soul:'fixture'});finish(e,'h_A',[{verb:'walk_to',params:{to:[23,6]}}]);const before=e.stateHash(),pose=structuredClone(e.world.entities.h_A.pose),p=e.previewSocialEdenV1!();assert.equal(p.ok,false);if(!p.ok)assert.equal(p.diagnostic.code,'social-eden.physical-conflict');assert.equal(e.stateHash(),before);assert.deepEqual(e.world.entities.h_A.pose,pose);});
