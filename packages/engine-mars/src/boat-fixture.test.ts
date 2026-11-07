import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nativeBoatTake } from './boat-fixture.ts';
import { nativeBoatFixture } from './boat-runtime.ts';
import { boatStateV1Schema, boatPassengerV1Schema, boatTransitV1Schema, hashOf } from '@souls/engine-contract';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';

test('published actual two-person native journey replays without models and seated take roots follow the recorded boat',async()=>{
  const out=await nativeBoatTake(),f=await nativeBoatFixture(),rt=f.create(structuredClone(out.genesis));
  const published=JSON.parse(readFileSync(new URL('../../../apps/server/test/fixtures/native-boat/journey.v1.json',import.meta.url),'utf8'));
  assert.deepEqual(out,published);
  for(const input of out.inputs){
    assert.equal(rt.tick,input.tick);const a=rt.submit(input.verb,input.params,{id:input.id});
    for(let i=0;i<1800&&rt.isActive(a.id);i++)rt.step();assert.equal(a.status,'completed');
  }
  assert.equal(rt.stateHash(),out.finalStateHash);assert.equal(rt.tick,out.take.ticks);assert.deepEqual(rt.violations,[]);
  const before=hashOf(out),seen=new Set<string>();
  for(let tick=0;tick<=out.take.ticks;tick++){
    const sample=sampleTake(out.take,tick*out.take.dt),v=sample.entities[out.layout.boatId];
    const state=boatStateV1Schema.parse(v.state.boat);seen.add(state.phase);
    for(const id of ['pilot','guest']){
      const e=sample.entities[id];if(e.state.boatTransit)boatTransitV1Schema.parse(e.state.boatTransit);
      if(!e.state.boatPassenger)continue;
      const p=boatPassengerV1Schema.parse(e.state.boatPassenger);seen.add(p.phase);
      assert.equal(state.passengers[p.slotId],id);
      if(p.phase==='seated')for(let k=0;k<3;k++)assert.ok(Math.abs(e.p[k]-v.p[k]-p.localRoot[k])<.00101);
    }
  }
  assert.deepEqual([...seen].sort(),['boarding','docked','leaving','seated','stopped','underway']);
  assert.equal(hashOf(out),before);assert.deepEqual(out.trace.at(-1)!.passengers,{});
  assert.equal(out.paidSpendUSD,0);
});

test('strict optional boat codecs reject invented fields, nonfinite frames and contradictory occupancy/connector states',()=>{
  const s={contract:'boat-state/1',waterId:'water',frameOffsetY:.4,dockId:'dock',connectorOpen:true,phase:'docked',speed:0,passengers:{},pilotIds:['pilot']};
  assert.equal(boatStateV1Schema.safeParse(s).success,true);
  for(const bad of [{...s,speed:NaN},{...s,dockId:null},{...s,phase:'underway'},{...s,speed:.1},
    {...s,passengers:{seat0:'pilot',seat1:'pilot'}},{...s,pilotIds:['pilot','pilot']},{...s,owner:'private'}])
    assert.equal(boatStateV1Schema.safeParse(bad).success,false);
  assert.equal(boatPassengerV1Schema.safeParse({boatId:'boat',slotId:'seat0',phase:'seated',localRoot:[0,Infinity,0],relativeYaw:0}).success,false);
  assert.equal(boatTransitV1Schema.safeParse({from:[0,0,0],to:[1,0,0],t:1.01,supportId:'gangway'}).success,false);
});
