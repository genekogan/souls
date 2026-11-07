import test from 'node:test';
import assert from 'node:assert/strict';
import {hashOf,type Engine} from '@souls/engine-contract';
import {retainedCommonsShoreFactory} from './retained-shore-engine.ts';
import {commonsKitchenFactory} from './commons-kitchen-engine.ts';
import {COMMONS_KITCHENS} from './commons-kitchen.ts';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
const factory=await retainedCommonsShoreFactory();
function walk(e:Engine,to:string,limit=2600){const p=e.perform({actor:'h_A',label:'native retained journey',steps:[{verb:'walk_to',params:{to}}]});assert.ok(p.ok,JSON.stringify(p));const phases=new Set<string>();let terminal:any;for(let i=0;i<limit&&!terminal;i++){const out=e.step();phases.add(e.world.entities.h_A.human!.activity);assert.deepEqual(e.runtime.violations,[]);terminal=out.programs.find(v=>v.id===p.id&&['completed','failed'].includes(v.kind));}assert.equal(terminal?.kind,'completed',JSON.stringify(terminal));return phases;}
test('retained kitchen/commons becomes connected shore without replacing bodies, stock or old captures; native swim/return and snapshot recover exactly',async()=>{
  const e=factory.create(factory.genesis('retained-shore'));e.spawnHuman({id:'h_A',label:'Hypothetical native retained actor',soul:'fixture'});
  const p=e.previewCommonsProvisionsV1!();assert.ok(p.ok);if(!p.ok)return;e.adoptCommonsProvisionsV1!(p.transition);
  const k=e.previewCommonsKitchenV1!();assert.ok(k.ok);if(!k.ok)return;e.adoptCommonsKitchenV1!(k.transition);
  const station=COMMONS_KITCHENS[0],prepared=e.perform({actor:'h_A',label:'retain actual preparation progress',steps:[{verb:'mars:prepare_food',params:{pot:station.pot,spoon:station.spoon,ingredients:[station.beans,station.greens],groundRoutePolicy:'supported-ground/1'}},{verb:'mars:put_item',params:{item:station.spoon,surfaceSlot:station.table+'#r1c4'}}]});assert.ok(prepared.ok);let finished=false;
  for(let i=0;i<3500&&!finished;i++){const out=e.step();assert.deepEqual(e.runtime.violations,[]);const t=out.programs.find(v=>v.id===prepared.id&&['completed','failed'].includes(v.kind));if(t){assert.equal(t.kind,'completed');finished=true;}}assert.ok(finished);
  for(let i=0;i<20;i++)e.step();
  const entities=structuredClone(e.world.entities),regions=structuredClone(e.world.regions),before=e.stateHash();
  const q=e.previewRetainedCommonsShoreV1!();assert.ok(q.ok,JSON.stringify(q));assert.equal(e.stateHash(),before);if(!q.ok)return;
  assert.throws(()=>e.adoptRetainedCommonsShoreV1!({...q.transition,geometrySourceHash:'0'.repeat(64)}),/stale-or-forged/);assert.equal(e.stateHash(),before);
  e.adoptRetainedCommonsShoreV1!(q.transition);
  const archivedOld=e.takeChunks!(0).filter(c=>(c.take as any).rulesVersion===q.transition.fromRulesVersion).map(c=>({chunk:structuredClone(c),capture:e.takeScene!((c.take as any).renderSceneRef.hash)!}));assert.ok(archivedOld.length);
  for(const [id,v] of Object.entries(entities))assert.deepEqual(e.world.entities[id],v);
  for(const [id,v] of Object.entries(regions))assert.deepEqual(e.world.regions[id],v);
  const render=e.renderScene!();assert.ok((render.scene as any).provisions);assert.ok((render.scene as any).kitchen);assert.equal(render.shore!.rulesVersion,e.rulesVersion);
  let copy:Engine|undefined;const admitted=e.perform({actor:'h_A',label:'reach shore water',steps:[{verb:'walk_to',params:{to:'shore-water'}}]});assert.ok(admitted.ok);const phases=new Set<string>();let terminal:any;
  for(let i=0;i<2600&&!terminal;i++){const out=e.step();phases.add(e.world.entities.h_A.human!.activity);assert.deepEqual(e.runtime.violations,[]);if(copy){copy.step();assert.equal(copy.stateHash(),e.stateHash());}if(!copy&&e.world.entities.h_A.human!.activity==='swim'){copy=factory.restore(e.snapshot());assert.equal(copy.stateHash(),e.stateHash());}terminal=out.programs.find(v=>v.id===admitted.id&&['completed','failed'].includes(v.kind));}
  assert.equal(terminal?.kind,'completed',JSON.stringify(terminal));assert.ok(copy);assert.ok(phases.has('walk')&&phases.has('wade')&&phases.has('swim'));assert.equal(e.world.entities.h_A.human!.activity,'tread');
  // The engine hot window is bounded. The emitted old pair is archived at
  // its actual boundary, rather than assuming indefinite in-memory retention.
  for(const p of archivedOld){assert.equal(p.capture.ref.rulesVersion,q.transition.fromRulesVersion);assert.equal(p.capture.ref.hash,(p.chunk.take as any).renderSceneRef.hash);assert.equal(p.capture.body.shore,undefined);}
  const chunks=e.takeChunks!(0);assert.ok(chunks.some(c=>(c.take as any).rulesVersion===q.transition.toRulesVersion));
  for(const c of chunks){const t=c.take as any,cap=e.takeScene!(t.renderSceneRef.hash)!;assert.ok(cap);assert.equal(cap.ref.rulesVersion,t.rulesVersion);if(t.rulesVersion===q.transition.toRulesVersion){assert.ok((cap.body.scene as any).provisions);assert.ok((cap.body.scene as any).kitchen);}}
  walk(e,'commons');assert.equal((e.world as NativeWorld).entities.h_A.human!.shore,undefined);const at=e.world.entities.h_A.pose.p;assert.ok(Math.hypot(at[0]-9,at[1],at[2]-5)<1e-9);
  const w=(e.world as NativeWorld).entities;assert.equal(w[station.pot].contents?.fraction,.5);assert.ok(w[station.pot].foodPreparation?.complete);assert.equal(w[station.beans].contents?.fraction,0);for(const other of COMMONS_KITCHENS.slice(1))assert.equal(w[other.beans].contents?.fraction,1);
  assert.equal(factory.restore(e.snapshot()).stateHash(),e.stateHash());const old=await commonsKitchenFactory();assert.equal(old.canReplayHistory?.(e.rulesVersion),false);assert.throws(()=>old.restore(e.snapshot()),/physical binding/);
  const tamper=e.snapshot() as any;tamper.cfg.walkBlockV1=false;assert.throws(()=>factory.restore(tamper),/snapshot-binding/);
});

test('busy programmes and occupied region identities refuse read-only without creating a new physical interpretation',()=>{
  const e=factory.create(factory.genesis('retained-refusals'));e.spawnHuman({id:'h_A',label:'Hypothetical native boundary actor',soul:'fixture'});
  assert.ok(e.perform({actor:'h_A',label:'ordinary finite rest',steps:[{verb:'rest',params:{seconds:2}}]}).ok);
  const before=e.stateHash(),busy=e.previewRetainedCommonsShoreV1!();assert.equal(busy.ok,false);if(!busy.ok)assert.equal(busy.diagnostic.code,'retained-shore.not-quiet-commons');assert.equal(e.stateHash(),before);
  const w=factory.genesis('region-collision') as NativeWorld;w.regions['shore-water']={id:'shore-water',label:'Existing hypothetical custom region',kind:'place',level:0,polygon:[[0,0],[1,0],[1,1],[0,1]],provenance:{origin:'test-fixture',confidence:'hypothetical'}};
  const other=factory.create(w),hash=other.stateHash(),no=other.previewRetainedCommonsShoreV1!();assert.equal(no.ok,false);if(!no.ok)assert.equal(no.diagnostic.code,'retained-shore.region-collision');assert.equal(other.stateHash(),hash);
});
