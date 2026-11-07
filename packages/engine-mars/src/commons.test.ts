import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, EDEN_COMMONS_WORLD, GREEN_FIELD_WORLD } from './engine.ts';
import { probeNativeHumanBirth } from './birth.ts';
import { hashOf } from '@souls/engine-contract';
import { fixtureSlots, seatApproach } from '../../../mars/viewer/engine/social/slots.ts';
import { CATALOG } from '../../../mars/viewer/engine/world/catalog.ts';
import { loadMars } from './load.ts';
import type { Entity as NativeEntity } from '../../../mars/viewer/engine/world/types.ts';
import { HUMAN_PROFILE } from '../../../mars/viewer/engine/spatial/types.ts';
import { clearanceAt } from '../../../mars/viewer/engine/spatial/grid.ts';

test('installed commons preserves both corridors, open pavilion and physical furniture/post exclusion', async () => {
  const m = await loadMars(), w = m.edenCommonsWorld('clearance');
  const sp = m.servicesFor(m.scenes)(w).spatial; sp.sync(w);
  for (const [a, b] of [[[14, 4], [9, 5]], [[9, 5], [4, 5]]]) {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      // Full 1.4m corridor centre must have >=.7m geometry clearance.
      assert.ok(clearanceAt(sp.level(0), [x, z]) >= .7, `${x},${z}`);
    }
    assert.equal(sp.route(w, HUMAN_PROFILE, {p:a,level:0}, {p:b,level:0}).ok, true);
  }
  assert.ok(clearanceAt(sp.level(0), [9, -5]) > .7, 'roof is overhead');
  for (const p of [[6,3], [12,3], [12,-5], [6.25,-6.75], [9,-1.8]])
    assert.equal(clearanceAt(sp.level(0), p as [number,number]), 0, `blocked ground ${p}`);
  const f = await marsFactory(EDEN_COMMONS_WORLD), e = f.create(f.genesis('birth'));
  const before=e.stateHash(),probe=probeNativeHumanBirth(e,f,{id:'h',label:'Walker',soul:'s'});
  assert.equal(probe.outcome,'ready');assert.equal(e.stateHash(),before);
  e.spawnHuman({id:'h',label:'Walker',soul:'s'});assert.deepEqual(e.world.entities.h.pose.p,probe.outcome==='ready'?probe.position:[]);
  const walk=e.perform({actor:'h',label:'arrival',steps:[{verb:'walk_to',params:{to:[9,5],standoff:0}}]});assert.equal(walk.ok,true);
  for(let i=0;i<220;i++)e.step();assert.deepEqual(e.world.entities.h.pose.p,[9,0,5]);assert.deepEqual(e.runtime.violations,[]);
});

test('commons seats use actual two-metre geometry, front approach, reservation and release', async () => {
  const m=await loadMars(),w=m.edenCommonsWorld(),rt=new m.Runtime(w,m.createRegistry(),m.servicesFor(m.scenes)(w),m.invariants);
  const slots=fixtureSlots(rt,w.entities['commons-bench-west']);assert.equal(slots.length,3);
  assert.deepEqual(CATALOG['eden-commons-bench'].size,[2,.9,.65]);
  for(const slot of slots){assert.ok(Math.abs(slot.yaw+Math.PI/2)<1e-8);const approach=seatApproach(rt,slot);assert.ok(Array.isArray(approach));if(Array.isArray(approach))assert.ok(approach[1]<3-.325);}
  const f=await marsFactory(EDEN_COMMONS_WORLD),e=f.create(f.genesis('seats'));
  for(let i=0;i<4;i++)e.spawnHuman({id:`h${i}`,label:`Person${i}`,soul:`s${i}`});
  for(let i=0;i<3;i++){const s=e.submit('sit',{actor:`h${i}`,slot:`commons-bench-west#seat${i}`});assert.notEqual(s.status,'failed',JSON.stringify(s));for(let j=0;j<500;j++)e.step();assert.equal(e.world.entities[`h${i}`].human!.activity,'sit');}
  const full=e.submit('sit',{actor:'h3',fixture:'commons-bench-west'});assert.equal(full.status,'failed');assert.equal(full.diagnostic?.code,'slot.none-free');
  const occupied=e.submit('sit',{actor:'h3',slot:'commons-bench-west#seat1'});assert.equal(occupied.status,'failed');assert.match(occupied.diagnostic!.code,/reservation.conflict|slot.occupied/);
  const copy=f.restore(JSON.parse(JSON.stringify(e.snapshot())));assert.equal(copy.stateHash(),e.stateHash());
  assert.notEqual(e.submit('stand',{actor:'h1'}).status,'failed');for(let i=0;i<20;i++)e.step();
  assert.equal(e.world.entities.h1.human!.activity,'idle');assert.ok(e.world.entities.h1.pose.p[2]<3-.325);assert.deepEqual(e.runtime.violations,[]);
});

test('platform has an actual supported native level and resumable bidirectional low climb',async()=>{
  const f=await marsFactory(EDEN_COMMONS_WORLD);let e=f.create(f.genesis('deck'));e.spawnHuman({id:'h',label:'Presenter',soul:'s'});
  const start=e.perform({actor:'h',label:'deck',steps:[{verb:'walk_to',params:{to:'commons-deck',standoff:0}}]});assert.equal(start.ok,true,JSON.stringify(start));
  let climbed=false,copy:ReturnType<typeof f.create>|undefined,arrived=false;
  for(let i=0;i<600;i++){
    e.step();if(copy){copy.step();assert.equal(copy.stateHash(),e.stateHash());}
    if(/climb-up/.test(e.world.entities.h.human!.activity)&&!copy){climbed=true;copy=f.restore(JSON.parse(JSON.stringify(e.snapshot())));assert.equal(copy.stateHash(),e.stateHash());}
    if(e.world.entities.h.human!.level===1&&e.world.entities.h.human!.activity==='idle'){arrived=true;break;}
  }
  assert.equal(climbed,true);assert.equal(arrived,true);assert.deepEqual(e.world.entities.h.pose.p,[9,.24,-1.8]);
  assert.equal(e.perform({actor:'h',label:'return',steps:[{verb:'walk_to',params:{to:'commons',standoff:0}}]}).ok,true);
  let descended=false;for(let i=0;i<600;i++){e.step();descended ||= e.world.entities.h.human!.activity==='climb-down';}
  assert.equal(descended,true);assert.deepEqual(e.world.entities.h.pose.p,[9,0,5]);assert.equal(e.world.entities.h.human!.level,0);assert.deepEqual(e.runtime.violations,[]);
});

test('table support is usable by native take/put, finite occupancy and occupied-hand refusal',async()=>{
  const f=await marsFactory(EDEN_COMMONS_WORLD),w=f.genesis('table');
  const cup:NativeEntity={id:'cup',def:'cup',kind:'component',pose:{p:[11.6,.75,-5.2],yaw:0},support:{kind:'resting-on',on:'commons-table',slot:'r0c0'},provenance:{origin:'design-edit',confidence:'hypothetical'}};
  w.entities.cup=cup;
  const other:NativeEntity={...structuredClone(cup),id:'other',pose:{p:[12.4,.75,-4.8],yaw:0},support:{kind:'resting-on',on:'commons-table',slot:'r1c2'}};
  w.entities.other=other;
  const e=f.create(w);e.spawnHuman({id:'h',label:'Helper',soul:'s'});
  assert.notEqual(e.submit('take_item',{actor:'h',item:'cup',hand:'left'}).status,'failed');for(let i=0;i<600;i++)e.step();
  assert.deepEqual((e.world.entities.cup as NativeEntity).support,{kind:'in-hand',by:'h',hand:'left'});
  const no=e.submit('take_item',{actor:'h',item:'other',hand:'left'});assert.equal(no.status,'failed');assert.equal(no.diagnostic?.code,'item.hand-full');
  const blocked=e.submit('put_item',{actor:'h',item:'cup',surfaceSlot:'commons-table#r1c2'});assert.equal(blocked.status,'failed');assert.equal(blocked.diagnostic?.code,'item.slot-occupied');
  assert.notEqual(e.submit('put_item',{actor:'h',item:'cup',surfaceSlot:'commons-table#r0c1'}).status,'failed');for(let i=0;i<500;i++)e.step();
  assert.deepEqual((e.world.entities.cup as NativeEntity).support,{kind:'resting-on',on:'commons-table',slot:'r0c1'});assert.deepEqual(e.world.entities.cup.pose.p,[12,.75,-5.2]);assert.deepEqual(e.runtime.violations,[]);
});

test('commons rules refuse old-history reinterpretation and incompatible checkpoint layouts in both directions',async()=>{
  const old=await marsFactory(GREEN_FIELD_WORLD),next=await marsFactory(EDEN_COMMONS_WORLD);
  assert.equal(next.rulesVersion,old.rulesVersion+'+commons/1');
  assert.equal(next.canReplayHistory!(old.rulesVersion),false);assert.equal(old.canReplayHistory!(next.rulesVersion),false);
  assert.equal(next.canRestoreSnapshot!(old.rulesVersion),false);assert.equal(next.canReplayHistory!(next.rulesVersion),true);
  assert.equal(next.canReplayHistory!(next.rulesVersion+'+commons/1'),false);assert.equal(next.canReplayHistory!(next.rulesVersion.replace('commons/1','commons/2')),false);
  assert.throws(()=>next.create(old.genesis('foreign-base')),/world commons physical base differs/);
  const changed=next.genesis('changed');changed.base.staticHash='0'.repeat(64);assert.throws(()=>next.create(changed),/world commons physical base differs/);
  const a=old.create(old.genesis('same')),b=next.create(next.genesis('same'));
  assert.throws(()=>next.restore(a.snapshot()),/commons layout differs/);assert.throws(()=>old.restore(b.snapshot()),/commons layout differs/);
  const snap=b.snapshot() as ReturnType<typeof b.snapshot>&{commonsVersion:string;mars:{world:{base:{staticHash:string}}}};
  snap.commonsVersion='commons/0';assert.throws(()=>next.restore(snap),/commons rules differ/);
  assert.equal(next.restore(b.snapshot()).stateHash(),b.stateHash());assert.notEqual(hashOf(a.renderScene!()),hashOf(b.renderScene!()));
});
