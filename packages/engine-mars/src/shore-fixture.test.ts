import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeShoreTake } from './shore-fixture.ts';
import { shoreContactV1Schema } from '@souls/engine-contract';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import { nativeShoreFixture } from './shore-runtime.ts';
import { readFileSync } from 'node:fs';

test('public native shore fixture is generated deterministically and its precise contact survives pure replay',async()=>{
  const a=await nativeShoreTake(),b=await nativeShoreTake();assert.equal(JSON.stringify(a),JSON.stringify(b));
  assert.equal(JSON.stringify(a)+'\n',readFileSync(new URL('../../../apps/server/test/fixtures/native-shore/journey.v1.json',import.meta.url),'utf8'));
  assert.equal(a.take.finalStateHash,a.finalStateHash);
  assert.deepEqual(a.trace.map(t=>t.activity),['tread','tread','idle']);
  const modes=new Set<string>();
  for(let tick=1;tick<=a.take.ticks;tick++) {
    const e=sampleTake(a.take,tick*a.take.dt).entities['shore-resident'];
    const contact=shoreContactV1Schema.parse(e.state.shore);modes.add(contact.mode);
    if(contact.mode==='buoyant')assert.ok(['swim','tread'].includes(e.activity!));
  }
  assert.deepEqual([...modes].sort(),['bed','buoyant']);
  const s=sampleTake(a.take,a.trace[0].endedTick*a.take.dt).entities['shore-resident'].state.shore;
  assert.equal(shoreContactV1Schema.safeParse({...s as object,prompt:'private'}).success,false);
  assert.equal(shoreContactV1Schema.safeParse({...s as object,normal:[0,0,0]}).success,false);
  assert.equal(a.paidSpendUSD,0);
  // Replay the published input records through the real runtime from genesis.
  // This is a native command journal, distinct from Sim's WorldHost event log.
  const f=await nativeShoreFixture(),w=f.genesis('public-native-shore-1');w.entities['shore-resident']=f.human('shore-resident',2,-6);
  const rt=f.create(w);
  for(const input of a.inputs){while(rt.tick<input.tick)rt.step();rt.submit(input.verb,input.params,{id:input.id});}
  while(rt.tick<a.take.ticks)rt.step();assert.equal(rt.stateHash(),a.finalStateHash);assert.deepEqual(rt.violations,[]);
});
