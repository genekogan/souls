// upper-floors/1 (lane L4b): old Eden's office upper floors as one logged rules fact — install, no-op, refused while someone
// is upstairs, remove (the operator rollback), snapshot restore and genesis replay agree on every hash.
import test from 'node:test';import assert from 'node:assert/strict';
import {kernelHash} from '@souls/kernel';
import {fixture,accept,factory,invite} from '../test/native-owner-fixture.ts';import {WorldHost} from './world.ts';
// @ts-expect-error plain .mjs operator spec (pure)
import {officeFact} from '../../../tools/upper-floors/old-eden-office.mjs';
// @ts-expect-error plain .mjs operator spec (pure)
import {HOTELS,hotelsFacts,hotelsRemoveFacts,hotelOpenings} from '../../../tools/upper-floors/old-eden-hotels.mjs';
// @ts-expect-error plain .mjs operator tool
import {upperFloorsState,planVerdict} from '../../../tools/upper-floors/upper-floors.mjs';
import {authoredBoundaryDeclarationV1} from '@souls/engine-contract';

const ROOMS=['eden-office-1-floor-1','eden-office-1-floor-2','int-office-studio','int-office-upper-lounge'];
const levelsOf=(e:unknown)=>((e as {rt:{services:{spatial:{base:{levels:{id:number}[]}}}}}).rt.services.spatial.base.levels.map(l=>l.id));

void test('upper-floors/1: install, no-op, occupied refusal, remove; snapshot and genesis replay agree',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
  await invite(f,'ada');const ada=await accept(f.host,f.souls.create('dev:ada',{name:'Ada',description:'walker'}));
  for(let i=0;i<10;i++)f.host.tickOnce();
  const e=f.host.engine as any,before=e.snapshot(),initialHash=e.stateHash(),fact=officeFact();
  assert.equal(e.world.upperFloorsV1,undefined);assert.ok(!levelsOf(e).includes(11));
  // malformed and remove-before-install are refused before admission, nothing logged
  const seq0=f.host.seq;
  assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1'} as any),/upper-floors\.bad-fact/);
  assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-office-1'}),/upper-floors\.not-installed/);
  const clash=structuredClone(fact);clash.building.levels[0].id=0;
  assert.throws(()=>f.host.installUpperFloorsV1(clash),/upper-floors\.bad-level/);
  assert.equal(f.host.seq,seq0);

  // install
  assert.deepEqual(await accept(f.host,f.host.installUpperFloorsV1(fact)),{installed:true});
  assert.equal(f.host.seq,seq0+1);
  assert.deepEqual(Object.keys(e.world.upperFloorsV1.buildings),['eden-office-1']);
  for(const id of ROOMS){assert.equal(e.world.regions[id]?.kind,'place',id);assert.ok(f.host.kernel.things[id],`kernel place ${id}`);}
  assert.ok(levelsOf(e).includes(11)&&levelsOf(e).includes(12),'office levels join the planner');
  assert.equal(e.placeLevelV1(11),1);assert.equal(e.placeLevelV1(12),2);assert.equal(e.placeLevelV1(1),1);

  // the same building again is a no-op (nothing logged, nothing changes); a different one under the same id is refused
  const seq1=f.host.seq,hash1=e.stateHash(),phys1=e.physicalHash(),kern1=kernelHash(f.host.kernel);
  assert.deepEqual(await f.host.installUpperFloorsV1(structuredClone(fact)),{installed:false});
  assert.equal(f.host.seq,seq1);assert.equal(e.stateHash(),hash1);assert.equal(e.physicalHash(),phys1);assert.equal(kernelHash(f.host.kernel),kern1);
  const other=structuredClone(fact);other.building.label='Another office';
  assert.throws(()=>f.host.installUpperFloorsV1(other),/upper-floors\.exists/);

  // remove is refused while a body is on one of the building's floors
  const body=e.ents[ada.entity_id],was=body.human.level;body.human.level=11;
  try{assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-office-1'}),/upper-floors\.occupied: .*h_/);}
  finally{if(was===undefined)delete body.human.level;else body.human.level=was;}
  assert.equal(e.stateHash(),hash1);assert.equal(f.host.seq,seq1);

  for(let i=0;i<5;i++)f.host.tickOnce();
  f.host.saveSnapshot(true);
  const reboot=(label:string)=>{const seq=f.host.seq,hash=e.stateHash(),phys=e.physicalHash(),kern=kernelHash(f.host.kernel),levels=levelsOf(e).sort();
    for(const mode of ['snapshot','genesis']){
      if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
      const h=new WorldHost(f.db,f.host.factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});
      try{assert.equal(h.boot().from,mode,`${label} ${mode}`);assert.equal(h.seq,seq);assert.equal(h.engine.stateHash(),hash,`${label} ${mode} state`);
        assert.equal(h.engine.physicalHash(),phys,`${label} ${mode} physical`);assert.equal(kernelHash(h.kernel),kern,`${label} ${mode} kernel`);
        assert.deepEqual(levelsOf(h.engine).sort(),levels,`${label} ${mode} planner levels`);}
      finally{h.stop();}
    }
    f.host.saveSnapshot(true);};
  reboot('installed');

  // remove (operator rollback): rooms leave the map and the kernel, the levels leave the planner
  assert.deepEqual(await accept(f.host,f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-office-1'})),{installed:true});
  assert.equal(e.world.upperFloorsV1,undefined);
  for(const id of ROOMS){assert.equal(e.world.regions[id],undefined,id);assert.equal(f.host.kernel.things[id],undefined,id);}
  assert.ok(!levelsOf(e).includes(11)&&!levelsOf(e).includes(12));
  assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-office-1'}),/upper-floors\.not-installed/);
  for(let i=0;i<5;i++)f.host.tickOnce();
  f.host.saveSnapshot(true);
  reboot('removed');

  // a pre-fact snapshot keeps its original hash (absent field)
  assert.equal(factory.restore(before).stateHash(),initialHash);
  assert.equal(f.db.paidCost(),0);
});

// Seafront hotels 1-3: ground-floor lobbies and walkway surfaces (level 0, y 0) plus the front-door openings in authored walls.
const obstaclesOf=(e:unknown)=>((e as {rt:{services:{spatial:{base:{obstacles:{id:string}[];surfaces:{id:string;level?:number}[]}}}}}).rt.services.spatial.base);
void test('upper-floors/1 hotels: lobby floors, door openings and stairs install, refuse while anyone is inside, remove; snapshot and replay agree',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
  await invite(f,'ada');const ada=await accept(f.host,f.souls.create('dev:ada',{name:'Ada',description:'walker'}));
  for(let i=0;i<6;i++)f.host.tickOnce();
  const e=f.host.engine as any,facts=hotelsFacts() as any[];
  // the door bands as the world's authored walls (ids and extents as the resort's builder registers them)
  const bands=HOTELS.flatMap((h:any)=>hotelOpenings(h).bands) as {id:string;x0:number;x1:number}[];
  assert.equal(bands.length,6);
  const decl=authoredBoundaryDeclarationV1('synthetic-supported-ground-prism/1',bands.map(b=>({id:b.id,buildingId:b.id.split(':front')[0],c:[(b.x0+b.x1)/2,1.735,125.91] as [number,number,number],half:[(b.x1-b.x0)/2,1.385,.09] as [number,number,number],yaw:0})));
  assert.deepEqual(await accept(f.host,f.host.installAuthoredBoundariesV1(decl)),{installed:true});
  const before=e.snapshot(),initialHash=e.stateHash(),seq0=f.host.seq;
  for(const b of bands)assert.ok(obstaclesOf(e).obstacles.some(o=>o.id==='authored-boundary:'+b.id),b.id);
  // an opening that is no authored wall, or one another building already opens, is refused before admission
  const bad=structuredClone(facts[0]);bad.building.openings=['nope'];
  assert.throws(()=>f.host.installUpperFloorsV1(bad),/upper-floors\.bad-opening/);
  const lifted=structuredClone(facts[0]);lifted.building.surfaces[0].y=.1;
  assert.throws(()=>f.host.installUpperFloorsV1(lifted),/upper-floors\.bad-surface/);
  assert.equal(f.host.seq,seq0);
  for(const fact of facts)assert.deepEqual(await accept(f.host,f.host.installUpperFloorsV1(fact)),{installed:true});
  assert.equal(f.host.seq,seq0+3);
  assert.deepEqual(Object.keys(e.world.upperFloorsV1.buildings),['eden-hotel-1','eden-hotel-2','eden-hotel-3']);
  const twin=structuredClone(facts[1]);twin.building.id='eden-hotel-9';twin.building.levels=twin.building.levels.map((l:any)=>({...l,id:l.id-16}));
  twin.building.regions=twin.building.regions.map((r:any)=>({...r,id:r.id.replace('hotel-2','hotel-9'),level:r.level&&r.level-16}));
  twin.building.surfaces=twin.building.surfaces.map((s:any)=>({...s,level:s.level&&s.level-16}));twin.building.links=twin.building.links.map((l:any)=>({...l,from:{...l.from,level:l.from.level&&l.from.level-16},to:{...l.to,level:l.to.level-16}}));
  assert.throws(()=>f.host.installUpperFloorsV1(twin),/already opened by another building/);
  for(const fact of facts)for(const r of fact.building.regions){assert.equal(e.world.regions[r.id]?.kind,'place',r.id);assert.ok(f.host.kernel.things[r.id],r.id);}
  assert.equal(e.world.regions['eden-hotel-1-lobby'].level,0);assert.equal(e.world.regions['eden-hotel-1-room-101'].placeLevel,1);
  assert.deepEqual(levelsOf(e).filter((l:number)=>l>=2).sort((a:number,b:number)=>a-b),[8,9,10,13,14,15,16,17,18,19,20]);
  const base=obstaclesOf(e);
  for(const b of bands)assert.ok(!base.obstacles.some(o=>o.id==='authored-boundary:'+b.id),`door band ${b.id} opened`);
  assert.ok(base.obstacles.some(o=>o.id==='upper:eden-hotel-1:door-jamb-1'));
  for(const id of ['lobby','threshold','walkway'])assert.ok(base.surfaces.some(s=>s.id===`upper:eden-hotel-2:${id}`&&(s.level??0)===0),id);
  assert.equal(e.placeLevelV1(15),3);

  // the same facts again: no-op
  const seq1=f.host.seq,hash1=e.stateHash(),phys1=e.physicalHash(),kern1=kernelHash(f.host.kernel);
  for(const fact of facts)assert.deepEqual(await f.host.installUpperFloorsV1(structuredClone(fact)),{installed:false});
  assert.equal(f.host.seq,seq1);assert.equal(e.stateHash(),hash1);assert.equal(e.physicalHash(),phys1);assert.equal(kernelHash(f.host.kernel),kern1);

  // remove is refused while anyone is upstairs, or on the ground floor inside the hotel (its lobby or walkway)
  const body=e.ents[ada.entity_id],was=body.human.level,p=[...body.pose.p];
  try{body.human.level=14;assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-hotel-1'}),/upper-floors\.occupied/);
    body.human.level=0;body.pose.p=[121.2,0,120];assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-hotel-1'}),/upper-floors\.occupied/);
    body.pose.p=[110,0,127];assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-hotel-1'}),/upper-floors\.occupied/);
    assert.equal(e.previewUpperFloorsV1({version:'upper-floors/1',remove:'eden-hotel-2'}),null,'the next hotel is empty');}
  finally{body.pose.p=p;if(was===undefined)delete body.human.level;else body.human.level=was;}
  assert.equal(e.stateHash(),hash1);assert.equal(f.host.seq,seq1);

  for(let i=0;i<5;i++)f.host.tickOnce();
  f.host.saveSnapshot(true);
  const reboot=(label:string)=>{const seq=f.host.seq,hash=e.stateHash(),phys=e.physicalHash(),kern=kernelHash(f.host.kernel),levels=levelsOf(e).sort(),obs=obstaclesOf(e).obstacles.length;
    for(const mode of ['snapshot','genesis']){
      if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
      const h=new WorldHost(f.db,f.host.factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});
      try{assert.equal(h.boot().from,mode,`${label} ${mode}`);assert.equal(h.seq,seq);assert.equal(h.engine.stateHash(),hash,`${label} ${mode} state`);
        assert.equal(h.engine.physicalHash(),phys,`${label} ${mode} physical`);assert.equal(kernelHash(h.kernel),kern,`${label} ${mode} kernel`);
        assert.deepEqual(levelsOf(h.engine).sort(),levels,`${label} ${mode} planner levels`);assert.equal(obstaclesOf(h.engine).obstacles.length,obs,`${label} ${mode} solids`);}
      finally{h.stop();}
    }
    f.host.saveSnapshot(true);};
  reboot('installed');

  // remove one hotel: its rooms, levels and solids go, its door bands close again; the other two stay
  assert.deepEqual(await accept(f.host,f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-hotel-2'})),{installed:true});
  assert.deepEqual(Object.keys(e.world.upperFloorsV1.buildings),['eden-hotel-1','eden-hotel-3']);
  for(const r of facts[1].building.regions){assert.equal(e.world.regions[r.id],undefined,r.id);assert.equal(f.host.kernel.things[r.id],undefined,r.id);}
  assert.ok(!levelsOf(e).includes(18)&&levelsOf(e).includes(13));
  for(const b of hotelOpenings(HOTELS[1]).bands)assert.ok(obstaclesOf(e).obstacles.some(o=>o.id==='authored-boundary:'+b.id),'closed again');
  for(const id of ['eden-hotel-1','eden-hotel-3'])assert.deepEqual(await accept(f.host,f.host.installUpperFloorsV1({version:'upper-floors/1',remove:id})),{installed:true});
  assert.equal(e.world.upperFloorsV1,undefined);
  for(const b of bands)assert.ok(obstaclesOf(e).obstacles.some(o=>o.id==='authored-boundary:'+b.id));
  for(let i=0;i<3;i++)f.host.tickOnce();
  f.host.saveSnapshot(true);
  reboot('removed');
  assert.equal(factory.restore(before).stateHash(),initialHash);
  assert.equal(f.db.paidCost(),0);
});

void test('upper-floors/1 hotels after the office: removing the hotels leaves the office record exactly as before (the plan check compares with it)',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
  await invite(f,'ada');await accept(f.host,f.souls.create('dev:ada',{name:'Ada',description:'walker'}));
  for(let i=0;i<6;i++)f.host.tickOnce();
  const e=f.host.engine as any,facts=hotelsFacts() as any[];
  const bands=HOTELS.flatMap((h:any)=>hotelOpenings(h).bands) as {id:string;x0:number;x1:number}[];
  const decl=authoredBoundaryDeclarationV1('synthetic-supported-ground-prism/1',bands.map(b=>({id:b.id,buildingId:b.id.split(':front')[0],c:[(b.x0+b.x1)/2,1.735,125.91] as [number,number,number],half:[(b.x1-b.x0)/2,1.385,.09] as [number,number,number],yaw:0})));
  assert.deepEqual(await accept(f.host,f.host.installAuthoredBoundariesV1(decl)),{installed:true});
  assert.deepEqual(await accept(f.host,f.host.installUpperFloorsV1(officeFact())),{installed:true});
  const office=structuredClone(e.world.upperFloorsV1),before=upperFloorsState(office),levels=levelsOf(e).sort(),phys=e.physicalHash();
  assert.deepEqual(before.buildings,['eden-office-1']);assert.ok(before.sha);
  for(const fact of facts)assert.deepEqual(await accept(f.host,f.host.installUpperFloorsV1(fact)),{installed:true});
  assert.deepEqual(upperFloorsState(e.world.upperFloorsV1).buildings,['eden-hotel-1','eden-hotel-2','eden-hotel-3','eden-office-1']);
  for(const fact of hotelsRemoveFacts() as any[])assert.deepEqual(await accept(f.host,f.host.installUpperFloorsV1(fact)),{installed:true});
  assert.deepEqual(e.world.upperFloorsV1,office,'the office record is untouched by the hotels install and removal');
  const after=upperFloorsState(e.world.upperFloorsV1);assert.deepEqual(after,before);
  assert.deepEqual(levelsOf(e).sort(),levels);assert.equal(e.physicalHash(),phys,'door bands closed again, office solids unchanged');
  for(const id of ROOMS)assert.equal(e.world.regions[id]?.kind,'place',id);
  // the plan verdict: same record before and after = ok; the old "no record after removal" rule would have refused this
  const r={install:{installed:true},rooms:[{region:true,place:true}],reach:[{ok:true}],outsideOffice:{same:true},remove:{installed:true},upperFloorsBefore:before,afterRemove:{same:true,rooms:[],upperFloorsV1:after}};
  assert.equal(planVerdict(r),true);
  assert.equal(planVerdict({...r,afterRemove:{...r.afterRemove,upperFloorsV1:upperFloorsState(undefined)}}),false,'removal that also dropped the office is refused');
});
