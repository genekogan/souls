import test from 'node:test';
import assert from 'node:assert/strict';
import {bodyLocationV1Schema,describeBodyLocation,hashOf} from '@souls/engine-contract';
import {connectedCommonsBoatFixture} from './connected-boat.ts';
import {connectedCommonsBoatFactory,connectedCommonsHelmFactory,connectedCommonsLocationFactory} from './connected-boat-engine.ts';
import type {Runtime} from '../../../mars/viewer/engine/runtime/runtime.ts';
const finish=(rt:Runtime,id:string)=>{for(let i=0;i<3500&&rt.isActive(id);i++)rt.step();assert.equal(rt.records.get(id)!.status,'completed',JSON.stringify(rt.records.get(id)));};
async function setup(){const f=await connectedCommonsBoatFixture({helmV1:true,bodyLocationV1:true}),w=f.genesis('physical-self-location');w.entities.h=f.human('h',14,4);return {f,rt:f.create(w)};}
test('actual connected walk/wade/swim/tread self-location is pure, root-exact and restored from the native graph',async()=>{
  const {f,rt}=await setup();const before=hashOf(rt.snapshot().data),initial=bodyLocationV1Schema.parse(f.bodyLocation!(rt,'h'));assert.equal(initial.occupancy,null);assert.equal(initial.shore,null);assert.equal(hashOf(rt.snapshot().data),before);assert.equal(f.bodyLocation!(rt,'missing'),null);
  assert.equal(rt.submit('commons_shore_travel',{actor:'h',x:-54,z:10}).diagnostic?.code,'shore.occupied-route','direct route meets the actual boat hull');
  finish(rt,rt.submit('commons_shore_travel',{actor:'h',x:-40,z:10}).id);
  const travel=rt.submit('commons_shore_travel',{actor:'h',x:-54,z:10}),modes=new Set<string>(),copies:Runtime[]=[];
  while(rt.isActive(travel.id)){
    rt.step();for(const copy of copies){copy.step();assert.equal(hashOf(copy.snapshot().data),hashOf(rt.snapshot().data));assert.deepEqual(f.bodyLocation!(copy,'h'),f.bodyLocation!(rt,'h'));}
    const e=rt.world.entities.h,location=bodyLocationV1Schema.parse(f.bodyLocation!(rt,'h'));assert.deepEqual(location.root,e.pose.p);assert.equal(location.tick,rt.tick);assert.deepEqual(location.physicalBase,rt.world.base);assert.equal(location.occupancy,null);
    if(!modes.has(e.human!.activity)&&['walk','wade','swim'].includes(e.human!.activity)){modes.add(e.human!.activity);copies.push(f.restore(rt.snapshot()));}
    if(e.human!.activity==='swim')assert.match(describeBodyLocation(location),/^in the water at /);
    if(e.human!.activity==='wade')assert.match(describeBodyLocation(location),/^wading at /);
  }
  assert.equal(travel.status,'completed');assert.deepEqual([...modes].sort(),['swim','wade','walk']);const location=f.bodyLocation!(rt,'h')!;assert.equal(location.region?.id,'shore-water');assert.equal(location.shore!.mode,'buoyant');assert.equal(rt.world.entities.h.human!.activity,'tread');assert.deepEqual(rt.violations,[]);
});
test('actual boarding/aboard/travel/leaving self-location follows supported occupancy and never claims a shore-body contact',async()=>{
  const {f,rt}=await setup();finish(rt,rt.submit('commons_shore_travel',{actor:'h',x:f.layout.bank[0],z:f.layout.bank[2]}).id);const phases=new Set<string>();
  const board=rt.submit('boat_board',{actor:'h',slot:'seat0'});while(rt.isActive(board.id)){rt.step();const l=f.bodyLocation!(rt,'h')!;assert.ok(l.occupancy);phases.add(l.occupancy.passenger.phase);assert.equal(l.shore,null);assert.equal(l.occupancy.container.id,f.policy.boatId);if(l.occupancy.passenger.phase==='boarding'){assert.ok(l.occupancy.transfer);assert.match(describeBodyLocation(l),/^boarding /);}}
  const aboard=f.bodyLocation!(rt,'h')!;assert.equal(aboard.region?.id,'shore-water');assert.equal(aboard.occupancy!.passenger.phase,'seated');assert.equal(aboard.occupancy!.transfer,null);assert.match(describeBodyLocation(aboard),/^aboard /);assert.equal(aboard.shore,null);
  finish(rt,rt.submit('boat_take_helm',{actor:'h'}).id);const sail=rt.submit('boat_travel',{actor:'h',x:-56,z:8});for(let i=0;i<40;i++)rt.step();const copy=f.restore(rt.snapshot());assert.deepEqual(f.bodyLocation!(copy,'h'),f.bodyLocation!(rt,'h'));assert.equal(f.bodyLocation!(rt,'h')!.shore,null);finish(rt,sail.id);finish(rt,rt.submit('boat_travel',{actor:'h',x:f.layout.boatDockPosition[0],z:f.layout.boatDockPosition[2]}).id);
  const leave=rt.submit('boat_leave',{actor:'h',slot:'seat0'});while(rt.isActive(leave.id)){rt.step();const l=f.bodyLocation!(rt,'h')!;if(l.occupancy){phases.add(l.occupancy.passenger.phase);assert.ok(l.occupancy.transfer);assert.match(describeBodyLocation(l),/^leaving /);}}
  assert.equal(f.bodyLocation!(rt,'h')!.occupancy,null);assert.deepEqual([...phases].sort(),['boarding','leaving','seated']);assert.deepEqual(rt.violations,[]);
});
test('two actual bodies in the same water region distinguish a seated boat passenger from a swimming body',async()=>{
  const {f,rt}=await setup();finish(rt,rt.submit('commons_shore_travel',{actor:'h',x:f.layout.bank[0],z:f.layout.bank[2]}).id);finish(rt,rt.submit('boat_board',{actor:'h',slot:'seat0'}).id);
  rt.world.entities.swimmer=f.human('swimmer',15,4);finish(rt,rt.submit('commons_shore_travel',{actor:'swimmer',x:-40,z:10}).id);finish(rt,rt.submit('commons_shore_travel',{actor:'swimmer',x:-54,z:10}).id);
  const aboard=f.bodyLocation!(rt,'h')!,wet=f.bodyLocation!(rt,'swimmer')!;assert.equal(aboard.region!.id,wet.region!.id);assert.ok(aboard.occupancy);assert.equal(aboard.shore,null);assert.equal(wet.occupancy,null);assert.ok(wet.shore!.submergedHeightMetres>0);assert.match(describeBodyLocation(aboard),/^aboard /);assert.match(describeBodyLocation(wet),/^in the water at /);assert.deepEqual(rt.violations,[]);
});
test('invalid actual passenger frame and stale water contact do not publish a qualified placement',async()=>{
  const malformed=await setup();malformed.rt.world.entities.h.pose.p[1]=Infinity;assert.equal(malformed.f.bodyLocation!(malformed.rt,'h'),null,'hypothetical malformed root, never stepped or persisted');
  const {f,rt}=await setup();finish(rt,rt.submit('commons_shore_travel',{actor:'h',x:f.layout.bank[0],z:f.layout.bank[2]}).id);finish(rt,rt.submit('boat_board',{actor:'h',slot:'seat0'}).id);const broken=f.restore(rt.snapshot());broken.world.entities.h.pose.p[0]+=.01;assert.equal(f.bodyLocation!(broken,'h'),null,'hypothetical invalid frame, never stepped');
  const wet=await setup();finish(wet.rt,wet.rt.submit('commons_shore_travel',{actor:'h',x:-40,z:10}).id);finish(wet.rt,wet.rt.submit('commons_shore_travel',{actor:'h',x:-54,z:10}).id);const bad=wet.f.restore(wet.rt.snapshot());bad.world.entities.h.human!.shore!.datumY+=1;assert.equal(wet.f.bodyLocation!(bad,'h'),null,'hypothetical stale contact, never stepped');assert.deepEqual(rt.violations,[]);assert.deepEqual(wet.rt.violations,[]);
  for(const patch of [{mode:'bed' as const},{bedY:100},{submergedHeightMetres:0},{normal:[.6,.8,0] as [number,number,number]}]){
    const other=wet.f.restore(wet.rt.snapshot());Object.assign(other.world.entities.h.human!.shore!,patch);assert.equal(wet.f.bodyLocation!(other,'h'),null,'syntactically valid but geometrically stale contact must not describe a location');
  }
});
test('region selection uses current level and smallest native footprint, with deterministic overlap and no floor-admission inference',async()=>{
  const {f,rt}=await setup(),w=rt.world;const region=(id:string,level:number,size:number)=>({id,label:id,kind:'place' as const,level,polygon:[[14-size,4-size],[14+size,4-size],[14+size,4+size],[14-size,4+size]] as [number,number][],provenance:{origin:'test-fixture' as const,confidence:'hypothetical' as const}});
  w.regions.upper=region('upper',1,.1);w.regions.z=region('z',0,.2);w.regions.a=region('a',0,.2);assert.equal(f.bodyLocation!(rt,'h')!.region!.id,'a');delete w.regions.a;assert.equal(f.bodyLocation!(rt,'h')!.region!.id,'z');assert.equal(w.entities.h.human!.level,0,'declarative region fixture grants no floor/traversal');
});
test('new location binding fences old helm histories; strict location codec refuses fabricated phase/contact/private fields',async()=>{
  const old=await connectedCommonsHelmFactory(),f=await connectedCommonsLocationFactory(),e=f.create(f.genesis('location-fence')),plain=old.create(old.genesis('location-fence'));assert.equal(plain.observeBodyLocation!('unknown'),undefined);assert.equal(e.observeBodyLocation!('unknown'),null);assert.equal(f.canReplayHistory!(old.rulesVersion),false);assert.throws(()=>f.restore(plain.snapshot()),/binding-differs/);assert.throws(()=>old.restore(e.snapshot()),/binding-differs/);
  const bodyOnly=await connectedCommonsBoatFactory({bodyLocationV1:true}),single=bodyOnly.create(bodyOnly.genesis('observer-only'));single.spawnHuman({id:'h',label:'Hypothetical native actor',soul:'fixture'});
  assert.equal(single.previewAdmission!({actor:'h',label:'foreign physical body refused',steps:[{verb:'mars:boat_board',params:{actor:'other',slot:'seat0'}}]}).diagnostic!.code,'boat.self-only');
  const {f:n,rt}=await setup();finish(rt,rt.submit('commons_shore_travel',{actor:'h',x:n.layout.bank[0],z:n.layout.bank[2]}).id);finish(rt,rt.submit('boat_board',{actor:'h',slot:'seat0'}).id);const l=n.bodyLocation!(rt,'h')!;
  assert.equal(bodyLocationV1Schema.safeParse({...l,root:[Infinity,0,0]}).success,false);assert.equal(bodyLocationV1Schema.safeParse({...l,owner:'hidden'}).success,false);assert.equal(bodyLocationV1Schema.safeParse({...l,occupancy:{...l.occupancy,container:{id:'foreign',name:'foreign'}}}).success,false);assert.equal(bodyLocationV1Schema.safeParse({...l,occupancy:{...l.occupancy,passenger:{...l.occupancy!.passenger,phase:'boarding'}}}).success,false);
});
