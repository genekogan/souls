import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, coreRef } from '@souls/world-compiler';
import { resolveBootPlace } from '../edge/boot/place-resolution.ts';
import { decorateMeaning, meaningParts } from './meaning.ts';
import type { GodPlace } from './places.ts';
const area = [[-20,-20],[20,-20],[20,20],[-20,20]] as [number,number][];
const place = (entity:string, ref:string, of:GodPlace['of'], polygon=area):GodPlace => ({entity,ref,of,id:'g-'+ref,name:ref,kind:of,parent:'tree-clump',polygon,level:0,enclosed:false,capacity:null,starting:false});
function setup() {
 const m=new WorldModel({constants:{extent:200,ground:'land'},seed:'semantic-places'}); for(const d of CORE_KIT)m.defineDef(d,'core',0);
 const act=(ops:unknown[])=>{const r=applyBatch(m,{ops},'god',1);assert.equal(r.result.accepted,true,JSON.stringify(r.result));};
 act([{op:'place',def:coreRef('plaza'),name:'land-campus',shape:{area},about:{title:'Campus',what:'A meeting place beside the lecture hall.',role:'district',salience:3}},
 {op:'place',def:coreRef('bench'),name:'speaker',p:[0,0],about:{title:'Speaker bench',what:'A bench for the speaker.',in:'land-campus',aliases:['podium bench']}},
 {op:'place',def:coreRef('pond'),name:'land-west-lake',shape:{area:[[30,-10],[50,-10],[50,10],[30,10]]},about:{title:'West Lake',kind:'lake',aliases:['swimming lake']}}]);
 return {m,act};
}
test('meaning changes display and semantic hierarchy without changing physical membership',()=>{
 const {m}=setup(), ps=[place(m.get('land-campus')!.id,'land-campus','area'),place(m.get('speaker')!.id,'speaker','thing',[[-1,-1],[1,-1],[1,1],[-1,1]]),place(m.get('land-west-lake')!.id,'land-west-lake','water'),place(m.get('land-west-lake')!.id,'land-west-lake','shore')];
 ps[3].id+='-shore'; const before=ps.map(p=>({parent:p.parent,polygon:structuredClone(p.polygon),kind:p.kind})); decorateMeaning(m,ps,'world');
 assert.equal(ps[0].name,'Campus');assert.equal(ps[1].description,'A bench for the speaker.');assert.equal(ps[1].semanticParent,'g-land-campus');assert.equal(ps[3].semanticParent,'g-land-west-lake');
 assert.equal(ps[2].semanticKind,'lake'); assert.equal(ps[3].name,'West Lake bank');assert.ok(ps[2].aliases!.includes('swimming lake'));assert.ok(ps[2].aliases!.includes('pond'));assert.ok(ps[2].genericAliases!.includes('pond'));assert.ok(!ps[2].genericAliases!.includes('swimming lake'),'authored names stay stronger than generic definition vocabulary');
 const waterPlaces=ps.slice(2).map(p=>({id:p.id,name:p.name,aliases:p.aliases!,level:0,nativeRegion:p.id,access:'admitted' as const}));
 const offers=waterPlaces.map(p=>({placeId:p.id,id:`walk:${p.id}`,available:true}));
 for(const ref of ['land-west-lake','swimming lake']){const r=resolveBootPlace(ref,waterPlaces,offers);assert.ok(r.ok);assert.equal(r.chosen.place,ps[2].id);}
 const bank=resolveBootPlace('swimming lake bank',waterPlaces,offers);assert.ok(bank.ok);assert.equal(bank.chosen.place,ps[3].id);
 assert.deepEqual(ps.map(p=>({parent:p.parent,polygon:p.polygon,kind:p.kind})),before);
});
test('parts preserve real targets; descriptive parts have no target; local points transform with owner',()=>{
 const {m,act}=setup(); act([{op:'set',id:'speaker',about:{title:'Speaker',parts:[{id:'view',title:'Distant view'},{id:'actual',title:'Campus',anchor:{kind:'entity',ref:'land-campus'}},{id:'spot',title:'Presenter spot',anchor:{kind:'local',point:[1,0,2],stand:[1,0,1],level:0,region:[[0,0],[2,0],[2,2],[0,2]]}}]}},{op:'move',id:'speaker',p:[10,10],r:90}]);
 const parts=meaningParts(m,m.get('speaker')!.id);assert.equal(parts[0].target,undefined);assert.equal(parts[1].target!.ref,'land-campus');
 const wp=m.worldPose(m.get('speaker')!);const q=parts[2].target!.point!;assert.ok(Math.abs(q[0]-(wp.x+(Math.cos(wp.yaw)+2*Math.sin(wp.yaw))*wp.s))<1e-8);assert.equal(parts[2].target!.level,0);assert.equal(parts[2].target!.region!.length,4);
});

test('named part walks use real bindings, exact seats and bounded local stands without new membership',async()=>{
 const {GodNav}=await import('./nav.ts'),{GodPlaces}=await import('./places.ts');const {m,act}=setup();
 const speaker=m.get('speaker')!,slot=m.slotsOf(speaker).find(s=>s.kind==='seat')!;assert.ok(slot);
 act([{op:'set',id:'land-campus',about:{title:'Campus',parts:[{id:'speaker',title:'Presenter desk',aliases:['podium desk'],anchor:{kind:'entity',ref:'speaker',slot:slot.id}},{id:'bay',title:'Centre bay',anchor:{kind:'local',point:[-5,0,-5],stand:[-5,0,-5],level:0,region:[[-7,-7],[-3,-7],[-3,-3],[-7,-3]]}},{id:'view',title:'Great view'},{id:'wrong-floor',title:'Missing gallery',anchor:{kind:'local',point:[1,9,1],stand:[1,9,1],level:9}}]}}]);
 let blocked=false;const engine={world:{tick:1,entities:{soul:{pose:{p:[-6,0,-6]},human:{level:0}}}},standableNearV1:(p:[number,number])=>p,navWarmV1:()=>true,navCheckV1:()=>[{ok:!blocked}]};
 const nav=new GodNav({model:m,engine:engine as never,levelAt:()=>0,engineOwned:()=>false});
 const bay=nav.thing('land-campus/part-bay')!;assert.ok(bay);assert.deepEqual(nav.goal(bay,[-6,-6]),{p:[-5,-5],level:0});assert.equal(nav.thing('land-campus/part-view'),undefined);assert.equal(nav.thing('land-campus/part-wrong-floor'),undefined);
 const caps:any[]=[],plans=new Map();nav.capabilities({entityId:'soul'} as never,caps,plans);
 const walk=caps.find(c=>c.id==='walk:land-campus/part-speaker');assert.equal(walk.target.id,speaker.id);assert.notEqual(nav.thing('land-campus/part-speaker')!.id,speaker.id,'semantic identity remains separate');assert.deepEqual(nav.goal(nav.thing('land-campus/part-speaker')!,[-6,-6]),nav.goal(nav.thing('speaker')!,[-6,-6]),'entity binding keeps original approach geometry');
 const seat=caps.find(c=>c.id==='sit:land-campus/part-speaker');assert.ok(seat?.available);assert.ok(seat.aliases.includes('podium desk'));assert.ok(plans.get(seat.id).steps.some((s:any)=>s.verb==='mars:sit'&&s.params.slot===`${speaker.id}#${slot.id}`));
 const places=new GodPlaces({model:m,nav,engineOwned:()=>false,levelAt:()=>0,log:()=>{}});assert.equal(places.list().some(p=>p.ref.includes('/part-')),false,'semantic targets never add physical membership polygons');
 blocked=true;engine.world.tick++;const blockedCaps:any[]=[];nav.capabilities({entityId:'soul'} as never,blockedCaps,new Map());assert.equal(blockedCaps.find(c=>c.id==='walk:land-campus/part-bay')?.available,false,'reachability refusal does not substitute a nearby floor');
});

test('authored aliases retain priority across generic tag punctuation',()=>{
 const {m,act}=setup();act([{op:'set',id:'speaker',about:{title:'Speaker bench',aliases:['garden seat']}}]);
 const def=m.resolvedDef(m.get('speaker')!.def)!;def.tags.push('garden-seat');
 const ps=[place(m.get('speaker')!.id,'speaker','thing')];decorateMeaning(m,ps,'world');
 assert.ok(ps[0].aliases!.includes('garden-seat'));assert.ok(!ps[0].genericAliases!.includes('garden-seat'));
});
