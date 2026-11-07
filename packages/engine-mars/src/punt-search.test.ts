import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {RenderScene} from '@souls/engine-contract';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
import type {GroundField} from '../../../mars/viewer/engine/spatial/ground.ts';
import type {Spatial} from '../../../mars/viewer/engine/spatial/service.ts';
import type {Entity} from '../../../mars/viewer/engine/world/types.ts';
import {CATALOG} from '../../../mars/viewer/engine/world/catalog.ts';
import type {CarrierInstallSpec} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import {deckedField} from '../../../mars/viewer/engine/spatial/tiled.ts';
import type {Ground} from '../../ground/src/index.ts';
import {groundFact,groundField,groundRecipe} from './ground-bridge.ts';
import {previewPunt,puntCandidates,PuntSearch,type PuntSearchPhase} from './punt.ts';
import {previewPunt as legacyPreview,puntCandidates as legacyCandidates} from './punt-search-reference.fixture.ts';

type V2=[number,number];
const pond:V2[]=[[-15,-15],[15,-15],[15,15],[-15,15]];
const ground=(area:V2[]=pond,edge=1):Ground=>({schema:'ground/1',base:0,extent:[-60,-60,60,60],
  waters:[{id:'pond',area,level:-.2}],landforms:[{id:'bed',kind:'carve',area,bed:-1.4,edge}]});
const obstacle=(id:string,x:number,z:number):Entity=>({id,kind:'fixture',def:'eden-commons-table',pose:{p:[x,0,z],yaw:0}} as Entity);

/** Only the read-only search's dependencies: real ground geometry, without constructing navigation grids or a world host. */
function fixture(g:Ground,entities:Record<string,Entity>={},overlay?:(field:GroundField)=>GroundField){
  const fact=groundFact(g,0),base=groundField(fact.recipeHash),counts={water:0,height:0,medium:0,fields:0,entityScans:0};
  const counted=(source:GroundField):GroundField=>({...source,
    waterLevel:(x,z)=>{counts.water++;return source.waterLevel(x,z);},
    height:(x,z)=>{counts.height++;return source.height(x,z);},
    medium:(x,z)=>{counts.medium++;return source.medium(x,z);},
  });
  let field=counted(overlay?overlay(base):base);
  const spatial={ground:{get field(){counts.fields++;return field;}},epoch:0,sync(){return false;}};
  const world={groundV1:fact,entities:new Proxy(entities,{ownKeys(target){counts.entityScans++;return Reflect.ownKeys(target);}})};
  const rt={world,services:{spatial}} as unknown as Runtime;
  return {rt,counts,spatial,entities,setField(next:GroundField){field=counted(next);spatial.epoch++;},base};
}
function compare(g:Ground,entities:Record<string,Entity>={},overlay?:(field:GroundField)=>GroundField){
  const old=fixture(g,structuredClone(entities),overlay),now=fixture(g,structuredClone(entities),overlay);
  const expected=legacyCandidates(old.rt),actual=puntCandidates(now.rt);
  assert.deepEqual(actual,expected,'same ordered candidates, including every route key, bank coordinate and heading');
  for(const spec of actual){assert.equal(legacyPreview(old.rt,spec),null);assert.equal(previewPunt(now.rt,spec),null);}
  return {old,now,actual};
}

test('punt search matches frozen selection and order on absent, tiny, ordinary and multiple waters',()=>{
  assert.deepEqual(compare({...ground(),waters:[]}).actual,[]);
  assert.deepEqual(compare(ground([[0,0],[3,0],[3,3],[0,3]])).actual,[]);
  assert.equal(compare(ground()).actual.length,1);
  assert.equal(compare(ground([...pond].reverse())).actual.length,1);
  const second=pond.map(([x,z])=>[x+36,z] as V2),g=ground();
  g.waters.unshift({id:'second',area:second,level:-.2});
  g.landforms.push({id:'second-bed',kind:'carve',area:second,bed:-1.4,edge:1});
  const {actual}=compare(g);
  assert.equal(actual.length,2);assert.match(actual[0].id,/^punt-second-/);assert.match(actual[1].id,/^punt-pond-/);
});

test('shelf fallback, quay, furniture and deck geometry retain the same selected route or refusal',()=>{
  const shelf=ground(pond,8);
  assert.deepEqual(compare(shelf).actual,[]);
  const quay:Ground={...shelf,landforms:[...shelf.landforms,{id:'quay',kind:'carve',area:[[10,5],[15,5],[15,11],[10,11]],bed:-1.4,edge:.5}]};
  const {actual}=compare(quay);assert.equal(actual.length,1);assert.ok(actual[0].at[0]>9);
  const plain=compare(ground()).actual[0],door=plain.bank!.door;
  const blocked=compare(ground(),{table:obstacle('table',door[0],door[2])}).actual;
  assert.equal(blocked.length,1);assert.notDeepEqual(blocked[0].bank!.door,door,'blocked first side tries later sides in the original order');
  const ignored={marker:{...obstacle('marker',door[0],door[2]),kind:'marker'} as Entity,
    person:{...obstacle('person',door[0],door[2]),human:{}} as Entity};
  assert.deepEqual(compare(ground(),ignored).actual,[plain],'people and markers do not become bank furniture');
  compare(shelf,{},base=>deckedField(base,[{id:'quay-deck',level:0,y:0,obb:{c:[13,7],half:[3,2],yaw:Math.PI/16}}],'punt-test-deck'));
});

test('native shore probe reuse retains the selected route and public refusal precedence',()=>{
  const source=JSON.parse(readFileSync(new URL('./fixtures/shore-bed.v1.json',import.meta.url),'utf8'));
  const render={shore:{terrain:source.terrain,water:source.water}} as unknown as RenderScene;
  const old=fixture({...ground(),waters:[]}),now=fixture({...ground(),waters:[]});
  const expected=legacyCandidates(old.rt,render),actual=puntCandidates(now.rt,render);
  assert.deepEqual(actual,expected);assert.equal(actual.length,1);
  const spec=actual[0];assert.equal(previewPunt(now.rt,spec,render),null);
  const variants:CarrierInstallSpec[]=[];
  const missing=structuredClone(spec);delete missing.bank;variants.push(missing);
  const noHome=structuredClone(spec);noHome.routeKeys![0].p[1]+=1;variants.push(noHome);
  const short=structuredClone(spec);short.routeKeys=short.routeKeys!.map(k=>({...k,t:k.t/100}));variants.push(short);
  const fast=structuredClone(spec);fast.routeKeys![1].p[0]+=10;variants.push(fast);
  const dry=structuredClone(spec);dry.routeKeys![8].p[2]=13;variants.push(dry);
  const bank=structuredClone(spec);bank.bank!.door[1]+=1;variants.push(bank);
  const far=structuredClone(spec);far.bank!.door[0]+=10;variants.push(far);
  for(const changed of variants){
    // Also break the bank: water/speed/period failures must retain their original diagnostic priority.
    if(changed.bank)changed.bank.door[1]+=1;
    const expectedIssue=legacyPreview(old.rt,changed,render);
    assert.ok(expectedIssue);assert.deepEqual(previewPunt(now.rt,changed,render),expectedIssue);
  }
});

test('a synchronous search shares geometry and obstacle enumeration, and failed hull probes short-circuit',()=>{
  const plain=compare(ground()).actual[0],door=plain.bank!.door;
  const {old,now,actual}=compare(ground(),{table:obstacle('table',door[0],door[2])});
  assert.equal(actual.length,1);
  assert.ok(now.counts.fields<old.counts.fields,`water contexts ${now.counts.fields} < ${old.counts.fields}`);
  assert.ok(now.counts.entityScans<old.counts.entityScans,`obstacle scans ${now.counts.entityScans} < ${old.counts.entityScans}`);
  const oldDry=fixture(ground()),nowDry=fixture(ground());
  // Every probe is inside the polygon, but the water is too shallow at the first point of every hull.
  const shallow={...oldDry.base,height:()=>-.25};oldDry.setField(shallow);nowDry.setField(shallow);
  const expected=legacyPreview(oldDry.rt,plain),issue=previewPunt(nowDry.rt,plain);
  assert.ok(issue);assert.deepEqual(issue,expected);
  assert.equal(oldDry.counts.water,16);assert.equal(nowDry.counts.water,1);
});

test('constant hull/disc offsets preserve exact probe coordinates and shallow-water boundary verdicts',()=>{
  const old=fixture(ground()),now=fixture(ground()),spec=legacyCandidates(old.rt)[0];
  const oldPoints:V2[]=[],newPoints:V2[]=[];
  for(const [f,points] of [[old,oldPoints],[now,newPoints]] as const)
    f.setField({...f.base,waterLevel:(x,z)=>{points.push([x,z]);return f.base.waterLevel(x,z);}});
  assert.equal(legacyPreview(old.rt,spec),null);assert.equal(previewPunt(now.rt,spec),null);
  assert.ok(oldPoints.length>16*300,'the full route hull and standing discs were probed');
  assert.deepEqual(newPoints,oldPoints,'the complete accepted preview queries bit-identical coordinates in the original order');
  const first:V2=[spec.routeKeys![0].p[0]+1.75,spec.routeKeys![0].p[2]];
  for(const depth of [.12-1e-12,.12,.12+1e-12]){
    for(const f of [old,now])f.setField({...f.base,height:(x,z)=>x===first[0]&&z===first[1]?spec.y!-depth:f.base.height(x,z)});
    const expected=legacyPreview(old.rt,spec),actual=previewPunt(now.rt,spec);
    assert.deepEqual(actual,expected,`depth boundary ${depth}`);
    if(depth<.12)assert.match(actual!.message,/deep and wide/);
    if(depth>.12)assert.equal(actual,null);
  }
});

test('search-local geometry and furniture are refreshed after edits and spatial synchronization',()=>{
  const old=fixture(ground()),now=fixture(ground());
  const spec=legacyCandidates(old.rt)[0];assert.deepEqual(puntCandidates(now.rt),[spec]);
  const [x,,z]=spec.bank!.door;
  old.entities.table=obstacle('table',x,z);now.entities.table=obstacle('table',x,z);
  assert.deepEqual(previewPunt(now.rt,spec),legacyPreview(old.rt,spec));
  assert.match(previewPunt(now.rt,spec)!.message,/Furniture/);
  delete old.entities.table;delete now.entities.table;
  assert.equal(previewPunt(now.rt,spec),null);
  const dry={...now.base,waterLevel:()=>null};old.setField(dry);now.setField(dry);
  assert.deepEqual(puntCandidates(now.rt),legacyCandidates(old.rt));
  assert.ok(previewPunt(now.rt,spec));

  // A stale pre-sync field admits home probes but has no supporting bank on the long sides.
  // The fallback still enumerates that original surface, while route preview must see the newly dry field.
  const shelf=ground(pond,8);
  const quay:Ground={...shelf,landforms:[...shelf.landforms,{id:'quay',kind:'carve',area:[[10,5],[15,5],[15,11],[10,11]],bed:-1.4,edge:.5}]};
  const before=fixture(quay),after=fixture(quay);
  for(const f of [before,after])f.spatial.sync=()=>{f.setField({...f.base,waterLevel:()=>null});return true;};
  assert.deepEqual(legacyCandidates(before.rt),[]);assert.deepEqual(puntCandidates(after.rt),[]);
});

function sliced(f:ReturnType<typeof fixture>,render?:RenderScene){
  let clock=0;
  const job=new PuntSearch(f.rt,()=>render,()=>clock++),phases=new Set<PuntSearchPhase>();
  for(let i=0;i<100000;i++){
    const r=job.advance(100);
    if(r.state==='done')return {candidates:r.candidates,phases,slices:i+1};
    assert.equal(r.state,'pending');if(r.state==='pending'&&r.phase)phases.add(r.phase);
  }
  assert.fail('bounded search did not finish');
}

test('sliced punt selection is byte-for-byte legacy selection on ordinary, shelf, quay and ordered multiple waters',()=>{
  const shelf=ground(pond,8),quay:Ground={...shelf,landforms:[...shelf.landforms,{id:'quay',kind:'carve',area:[[10,5],[15,5],[15,11],[10,11]],bed:-1.4,edge:.5}]};
  const multiple=ground(),second=pond.map(([x,z])=>[x+36,z] as V2);
  multiple.waters.unshift({id:'second',area:second,level:-.2});multiple.landforms.push({id:'bed-2',kind:'carve',area:second,bed:-1.4,edge:1});
  for(const g of [{...ground(),waters:[]},ground(),ground([...pond].reverse()),shelf,quay,multiple]){
    const old=fixture(g),now=fixture(g),result=sliced(now);
    assert.deepEqual(result.candidates,legacyCandidates(old.rt));
    assert.deepEqual(puntCandidates(now.rt),result.candidates,'sync drain and completed memo retain the same ordered result');
  }
});

test('zero-budget poll is inert; route and lattice search expose small probe units before completion',()=>{
  const f=fixture(ground()),before={...f.counts};let clock=0;
  const job=new PuntSearch(f.rt,()=>undefined,()=>clock++);
  assert.deepEqual(job.advance(0),{state:'pending',phase:null});assert.deepEqual(f.counts,before);
  let hulls=0,routes=0;
  for(let i=0;i<700;i++){
    const before={...f.counts},r=job.advance(1);
    assert.equal(r.state,'pending','an accepted full route cannot run in one atomic search unit');
    assert.equal('candidates' in r,false,'no partial candidate list is published');
    // This is an operation bound, not a timing assertion: a hull unit performs one water probe. A shore-side
    // candidate can also collect three bank points before its first hull; no whole route or lattice runs at once.
    assert.ok(f.counts.water-before.water<=4);assert.ok(f.counts.height-before.height<=4);
    if(r.state==='pending'){if(r.phase==='hull')hulls++;if(r.phase==='route')routes++;}
  }
  assert.ok(hulls>100&&routes>10);job.cancel();assert.equal(job.advance(Infinity).state,'cancelled');

  const shelf=fixture(ground(pond,8));clock=0;
  const lattice=new PuntSearch(shelf.rt,()=>undefined,()=>clock++);let points=0;
  for(let i=0;i<20000&&points<40;i++){const r=lattice.advance(1);assert.equal(r.state,'pending');if(r.state==='pending'&&r.phase==='lattice')points++;}
  assert.equal(points,40);lattice.cancel();
});

test('same-epoch furniture edits cancel pending work; cancellation publishes neither candidates nor a shelf miss',()=>{
  const g=ground(pond,8),table=obstacle('moving-table',50,50);table.phase='carried' as Entity['phase'];
  const f=fixture(g,{table});let clock=0;
  const job=new PuntSearch(f.rt,()=>undefined,()=>clock++);
  for(let i=0;i<10000;i++){const r=job.advance(10);assert.equal(r.state,'pending');if(r.state==='pending'&&r.phase==='lattice')break;}
  table.pose.p[0]=49;const epoch=f.spatial.epoch;
  assert.deepEqual(job.advance(10),{state:'cancelled'});assert.equal(f.spatial.epoch,epoch);
  const before=f.counts.water;
  assert.deepEqual(sliced(f).candidates,legacyCandidates(fixture(g,{table:structuredClone(table)}).rt));
  assert.ok(f.counts.water-before>100,'the cancelled shelf traversal did not cache an incomplete negative');
});

test('moving bodies preserve progress, while field replacement and live deck mutation invalidate it',()=>{
  const person={id:'person',kind:'human',def:'human',human:{},pose:{p:[40,0,40],yaw:0}} as Entity;
  const f=fixture(ground(),{person});let clock=0;
  const job=new PuntSearch(f.rt,()=>undefined,()=>clock++);
  let done=false;
  for(let i=0;i<10000;i++){
    person.pose.p[0]+=0.001;
    const r=job.advance(100);assert.notEqual(r.state,'cancelled');
    if(r.state==='done'){assert.deepEqual(r.candidates,legacyCandidates(fixture(ground()).rt));done=true;break;}
  }
  assert.ok(done,'ordinary body motion cannot starve search');
  const changed=new PuntSearch(f.rt,()=>undefined,()=>clock++);changed.advance(1);
  const epoch=f.spatial.epoch;f.setField({...f.base,waterLevel:()=>null});f.spatial.epoch=epoch;
  assert.equal(changed.advance(1).state,'cancelled','same-id field replacement, without an epoch bump');

  const deck={id:'deck',level:0,y:0,obb:{c:[14,7] as V2,half:[3,2] as V2,yaw:0}};
  const d=fixture(ground(),{},base=>deckedField(base,[deck],'deck'));
  Object.assign(d.spatial,{scene:{surfaces:[deck]}});
  const decks=new PuntSearch(d.rt,()=>undefined,()=>clock++);decks.advance(1);deck.obb.yaw=.1;
  assert.equal(decks.advance(1).state,'cancelled','in-place surface mutation is not hidden by field/epoch identity');
});

test('sliced fallback retains the original pre-sync surface and the refreshed preview field',()=>{
  const shelf=ground(pond,8),quay:Ground={...shelf,landforms:[...shelf.landforms,{id:'quay',kind:'carve',area:[[10,5],[15,5],[15,11],[10,11]],bed:-1.4,edge:.5}]};
  const old=fixture(quay),now=fixture(quay);
  for(const f of [old,now])f.spatial.sync=()=>{f.setField({...f.base,waterLevel:()=>null});return true;};
  assert.deepEqual(sliced(now).candidates,legacyCandidates(old.rt));
});

test('freshness is checked again at completion and completed misses cannot cross same-epoch geometry changes',()=>{
  const f=fixture(ground());let reads=0;
  const job=new PuntSearch(f.rt,()=>{if(++reads===2)f.setField({...f.base,waterLevel:()=>null});return undefined;});
  assert.deepEqual(job.advance(Infinity),{state:'cancelled'},'a changed final source cannot publish accepted candidates');

  const shelf=ground(pond,8),now=fixture(shelf);
  assert.deepEqual(puntCandidates(now.rt),[]);
  // A replacement field exposes a steep bank without altering the declared water polygon or epoch.
  const quay:Ground={...shelf,landforms:[...shelf.landforms,{id:'quay',kind:'carve',area:[[10,5],[15,5],[15,11],[10,11]],bed:-1.4,edge:.5}]};
  const edited=fixture(quay),epoch=now.spatial.epoch;now.setField(edited.base);now.spatial.epoch=epoch;
  const old=fixture(shelf);old.setField(edited.base);
  const expected=legacyCandidates(old.rt);assert.equal(expected.length,1);
  assert.deepEqual(puntCandidates(now.rt),expected,'a previously complete negative cache is scoped to actual geometry');
});

/** Frozen callback-reader oracle from the first resumable search. Keep separate from the direct comparator:
 * this checks the complete ordered stamp, not just whether selected geometry changes happen to cancel. */
function referenceGeometryStamp(rt:Runtime,render:RenderScene|undefined):unknown[]{
  const values:unknown[]=[],put=(value:unknown)=>{values.push(value);};
  const sp=rt.services.spatial as Spatial,g=sp.ground,f=g?.field;
  const fact=(rt.world as typeof rt.world&{groundV1?:{recipeHash:string}}).groundV1;
  put(rt.world);put(sp);put(g);put(f);put(f?.id);put(f?.height);put(f?.medium);put(f?.waterLevel);
  for(const value of f?.extent??[])put(value);
  put(fact?.recipeHash);put(fact?groundRecipe(fact.recipeHash):undefined);put(rt.world.base?.staticHash);put(sp.baseId);
  put((rt.world as typeof rt.world&{entityPhysicsV1?:{hash:string}}).entityPhysicsV1?.hash);put(JSON.stringify(render?.shore));
  for(const scene of [sp.base,sp.scene]){
    put(scene?.surfaces.length);
    for(const s of scene?.surfaces??[]){put(s.id);put(s.level);put(s.y);put(s.obb.c[0]);put(s.obb.c[1]);put(s.obb.half[0]);put(s.obb.half[1]);put(s.obb.yaw);}
  }
  const phases=new Set(['stored','reserved','staged','placed','installed','raising']);let count=0;
  for(const id in rt.world.entities){
    if(!Object.hasOwn(rt.world.entities,id))continue;
    const e=rt.world.entities[id];count++;put(id);
    const relevant=e.kind!=='human'&&((e.phase&&phases.has(e.phase))||CATALOG[e.def]?.obstacle===true);
    put(!!relevant);if(!relevant)continue;
    put(e.kind);put(!!e.human);put(e.def);put(e.phase);put(e.pose.p[0]);put(e.pose.p[1]);put(e.pose.p[2]);
    put(e.pose.yaw);put(e.pose.pitch);put(e.pose.roll);put(e.support?.kind);
    const size=CATALOG[e.def]?.size;put(size?.[0]);put(size?.[2]);
    put(e.connections?.length);for(const c of e.connections??[]){put(c.socket);put(c.to);put(c.toSocket);}
  }
  put(count);return values;
}
const sameStamp=(a:unknown[],b:unknown[])=>a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));

function freshnessFixture(){
  const table=obstacle('table',45,45),other=obstacle('other',46,46);
  table.phase='carried' as Entity['phase']; // catalogue obstacle relevance without a static-phase shortcut
  table.support={kind:'resting-on',on:'support',slot:'left'};
  table.connections=[{socket:'a',to:'other',toSocket:'b'},{socket:'c',to:'other',toSocket:'d'}];
  table.pose.pitch=0;table.pose.roll=NaN; // unchanged NaN must not spuriously cancel
  const person={id:'person',kind:'human',def:'human',human:{},pose:{p:[40,0,40],yaw:0}} as Entity;
  const f=fixture(ground(),{table,other,person});
  const field=f.spatial.ground.field as {-readonly [K in keyof GroundField]:GroundField[K]};
  field.extent=[...field.extent];
  const deck=(id:string)=>({id,level:0,y:0,obb:{c:[1,2] as V2,half:[3,4] as V2,yaw:0}});
  const spatial=Object.assign(f.spatial,{baseId:'base-id',base:{surfaces:[deck('base-a'),deck('base-b')]},scene:{surfaces:[deck('scene-a'),deck('scene-b')]}});
  const facts={base:{staticHash:'base-hash'},entityPhysicsV1:{hash:'physics-hash'}};
  Object.assign(f.rt.world,facts);
  const catalogue={...CATALOG[table.def],size:[...CATALOG[table.def].size] as [number,number,number]};
  // A private test definition lets the matrix alter catalogue fields without changing a real shared asset.
  table.def='punt-freshness-test';CATALOG[table.def]=catalogue;
  let render:RenderScene|undefined;
  return {...f,field,spatial,table,other,person,facts,catalogue,get render(){return render;},setRender(next:RenderScene|undefined){render=next;}};
}

test('direct freshness comparison matches the frozen ordered stamp across every live geometry field',()=>{
  type F=ReturnType<typeof freshnessFixture>;
  const changes:[string,(f:F)=>void][]=[
    ['world identity',f=>{f.rt.world={...f.rt.world};}],
    ['spatial identity',f=>{f.rt.services.spatial={...f.spatial};}],
    ['ground identity',f=>{f.spatial.ground={...f.spatial.ground};}],
    ['same-id field identity',f=>f.setField({...f.field})],
    ['field id',f=>{f.field.id+='-changed';}],
    ['height function',f=>{const old=f.field.height;f.field.height=(x,z)=>old(x,z);}],
    ['medium function',f=>{const old=f.field.medium;f.field.medium=(x,z)=>old(x,z);}],
    ['water function',f=>{const old=f.field.waterLevel;f.field.waterLevel=(x,z)=>old(x,z);}],
    ['recipe hash',f=>{(f.rt.world as typeof f.rt.world&{groundV1:{recipeHash:string}}).groundV1.recipeHash='missing-test-recipe';}],
    ['base static hash',f=>{f.facts.base.staticHash+='-changed';}],
    ['spatial base id',f=>{f.spatial.baseId+='-changed';}],
    ['entity physics hash',f=>{f.facts.entityPhysicsV1.hash+='-changed';}],
    ['shore presence',f=>f.setRender({shore:{test:'changed'}} as unknown as RenderScene)],
    ['entity kind',f=>{f.table.kind='component';}],
    ['entity human flag',f=>{f.table.human={} as Entity['human'];}],
    ['entity definition',f=>{f.table.def='eden-commons-table';}],
    ['entity phase',f=>{f.table.phase='placed';}],
    ['entity relevance',f=>{delete f.catalogue.obstacle;}],
    ['entity yaw -0',f=>{f.table.pose.yaw=-0;}],
    ['entity pitch',f=>{f.table.pose.pitch=.1;}],
    ['entity roll NaN to zero',f=>{f.table.pose.roll=0;}],
    ['support kind',f=>{f.table.support={kind:'ground'};}],
    ['support removal',f=>{delete f.table.support;}],
    ['connections removal',f=>{delete f.table.connections;}],
    ['connections length',f=>{f.table.connections!.pop();}],
    ['connections order',f=>{f.table.connections!.reverse();}],
    ['entity addition',f=>{f.entities.added=obstacle('added',49,49);}],
    ['entity removal',f=>{delete f.entities.person;}],
    ['entity ordered keys',f=>{delete f.entities.table;f.entities.table=f.table;}],
    ['entity key rename',f=>{delete f.entities.table;f.entities.renamed=f.table;}],
  ];
  for(let i=0;i<4;i++)changes.push([`extent ${i}`,f=>{const a=[...f.field.extent] as [number,number,number,number];a[i]++;f.field.extent=a;}]);
  for(let i=0;i<3;i++)changes.push([`entity position ${i}`,f=>{f.table.pose.p[i]++;}]);
  for(const i of [0,2])changes.push([`catalogue size ${i}`,f=>{f.catalogue.size[i]++;}]);
  for(const key of ['socket','to','toSocket'] as const)for(const i of [0,1])changes.push([`connection ${i}.${key}`,f=>{f.table.connections![i][key]+='-changed';}]);
  for(const scene of ['base','scene'] as const){
    changes.push([`${scene} length`,f=>{f.spatial[scene].surfaces.pop();}],[`${scene} order`,f=>{f.spatial[scene].surfaces.reverse();}]);
    for(const index of [0,1]){
      changes.push([`${scene} ${index} id`,f=>{f.spatial[scene].surfaces[index].id+='-changed';}]);
      for(const key of ['level','y'] as const)changes.push([`${scene} ${index} ${key}`,f=>{f.spatial[scene].surfaces[index][key]++;}]);
      changes.push([`${scene} ${index} yaw`,f=>{f.spatial[scene].surfaces[index].obb.yaw=-0;}]);
      for(const key of ['c','half'] as const)for(const i of [0,1])changes.push([`${scene} ${index} ${key}.${i}`,f=>{f.spatial[scene].surfaces[index].obb[key][i]++;}]);
    }
  }
  for(const [name,mutate] of changes){
    const f=freshnessFixture();let clock=0;
    const job=new PuntSearch(f.rt,()=>f.render,()=>clock++);
    try{
      const before=referenceGeometryStamp(f.rt,f.render);
      assert.equal(job.advance(1).state,'pending',name);
      assert.ok(sameStamp((job as unknown as {stamp:unknown[]}).stamp,before),`${name}: actual capture preserves frozen order/identity`);
      mutate(f);
      assert.equal(sameStamp(before,referenceGeometryStamp(f.rt,f.render)),false,`${name}: reference sees a change`);
      assert.equal(job.advance(1).state,'cancelled',name);
    }finally{job.cancel();delete CATALOG['punt-freshness-test'];}
  }
});

test('direct freshness comparison preserves unchanged NaN, body motion and equivalent replacement records',()=>{
  const f=freshnessFixture();let clock=0;
  const job=new PuntSearch(f.rt,()=>f.render,()=>clock++);
  try{
    const before=referenceGeometryStamp(f.rt,f.render);
    assert.equal(job.advance(1).state,'pending');
    f.person.pose.p[0]++;f.person.pose.yaw=.5;
    f.table.label='ignored';f.table.tags=['ignored'];f.table.id='ignored-value-id';
    f.table.support={kind:'resting-on',on:'different',slot:'right'};
    f.table.connections=structuredClone(f.table.connections);
    f.catalogue.size[1]++;
    f.field.extent=[...f.field.extent];
    f.spatial.scene=structuredClone(f.spatial.scene);f.spatial.base=structuredClone(f.spatial.base);
    f.rt.world.entities={...f.rt.world.entities}; // same ordered keys, not the same map identity
    Object.setPrototypeOf(f.rt.world.entities,{inherited:obstacle('inherited',0,0)});
    assert.ok(sameStamp(before,referenceGeometryStamp(f.rt,f.render)));
    assert.equal(job.advance(1).state,'pending','no false cancellation from ignored values, NaN or equivalent records');
  }finally{job.cancel();delete CATALOG['punt-freshness-test'];}
});

test('direct freshness comparison checks the terminal entity count and exact flat stamp length',()=>{
  for(const mutate of [(stamp:unknown[])=>{stamp[stamp.length-1]=999;},(stamp:unknown[])=>{stamp.push(undefined);},(stamp:unknown[])=>{stamp.pop();}]){
    const f=freshnessFixture();let clock=0;
    const job=new PuntSearch(f.rt,()=>f.render,()=>clock++);
    try{
      assert.equal(job.advance(1).state,'pending');
      mutate((job as unknown as {stamp:unknown[]}).stamp);
      assert.equal(job.advance(1).state,'cancelled');
    }finally{job.cancel();delete CATALOG['punt-freshness-test'];}
  }
});
