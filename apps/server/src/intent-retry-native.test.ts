// Repeatable actual API/compiler/native admission refusal then correct movement.
// First trusted proposal deliberately binds an absent native target; no mocked
// perform result, moved body, invented outcome or provider. Evaluation is driven
// explicitly to isolate the cooldown; automatic population proof is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {INTENT_V2,intentReceiptV2Schema,publicEvent} from '@souls/protocol';
import {kernelHash} from '@souls/kernel';
import {intentNativeFixture,seed} from '../test/intent-native-fixture.ts';
import {WorldHost} from './world.ts';
import {INTENT_RETRY_COOLDOWN_TICKS} from './intent-retry.ts';
async function drive<T>(f:ReturnType<typeof intentNativeFixture>,p:Promise<T>){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){f.host.drainInputs();await setImmediate();}assert.ok(done);return p;}
test('actual native rejection retries once after cooldown, reaches its understood destination, and survives model-free reconstruction',async t=>{
  const f=intentNativeFixture(t,':memory:',true,true,undefined,true);
  await drive(f,f.post({contract:INTENT_V2,requestId:'retry-native',op:'upsert',words:'PRIVATE_RETRY go to the campfire'})); await drive(f,f.service.settled());
  const receipt=intentReceiptV2Schema.parse(await (await f.lookup('retry-native')).json());assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('not understood');
  const ref={intentId:receipt.revision.intentId,version:receipt.revision.version};
  await drive(f,f.host.enqueueIntentDecision('fixture:invalid-native-binding',{soulId:'s_A',entityId:'h_A',card:'go to',target:'campfire',option:'go to@campfire',label:'invalid native target proposal',steps:[{verb:'walk_to',params:{to:'absent-native-target',standoff:1.2}}],approachLen:1,reevalTicks:1e9,fallback:false,trigger:'new-intent-v2'},ref,()=>true));
  const blocked=Object.values(f.host.intentHistoryOf('s_A').attempts)[0];assert.equal(blocked.phase,'blocked');assert.equal(blocked.evidence.kind,'admission');assert.equal(f.host.engine.programOf('h_A'),null);
  assert.equal(f.brain.midContext(f.mind,'activity-failed').actingPurpose,undefined);
  for(let i=0;i<INTENT_RETRY_COOLDOWN_TICKS;i++){f.mind.nextEvalTick=1e9;f.host.tickOnce();if(i%20===0)await setImmediate();}
  assert.equal(Object.keys(f.host.intentHistoryOf('s_A').attempts).length,1);
  assert.deepEqual(f.brain.midContext(f.mind,'timer').actingPurpose,ref);
  await f.brain.evaluate(f.mind,'timer');f.host.drainInputs();await setImmediate();
  const attempts=Object.values(f.host.intentHistoryOf('s_A').attempts);assert.equal(attempts.length,2);assert.equal(attempts[1].phase,'accepted');assert.deepEqual(attempts[1].intent,ref);
  for(let i=0;i<1600&&Object.values(f.host.intentHistoryOf('s_A').attempts)[1].phase!=='completed';i++){f.mind.nextEvalTick=1e9;f.host.tickOnce();if(i%10===0)await setImmediate();}
  f.host.drainInputs();const complete=Object.values(f.host.intentHistoryOf('s_A').attempts)[1];assert.equal(complete.phase,'completed');assert.equal(f.host.kernel.things.s_A.at,'campfire');
  assert.equal(f.brain.midContext(f.mind,'timer').actingPurpose,undefined,'no third attempt after completion');
  assert.equal(f.host.intentHistoryOf('s_A').intents[ref.intentId].status,'active','broader purpose remains distinct');
  assert.deepEqual(f.host.engine.runtime.violations,[]);assert.equal(f.db.paidCost(),0);assert.ok(!JSON.stringify(f.db.events(f.host.worldId).map(publicEvent)).includes('PRIVATE_RETRY'));
  const snapshot=f.host.saveSnapshot(true), head=f.host.engine.stateHash(), kernel=kernelHash(f.host.kernel), history=f.host.intentHistoryOf('s_A');
  const restored=new WorldHost(f.db,f.host.factory,seed,1e9,f.host.worldId);assert.equal(restored.boot().from,'snapshot');assert.equal(restored.engine.stateHash(),head);assert.equal(kernelHash(restored.kernel),kernel);assert.deepEqual(restored.intentHistoryOf('s_A'),history);
  f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
  const genesis=new WorldHost(f.db,f.host.factory,seed,1e9,f.host.worldId);assert.equal(genesis.boot().from,'genesis');assert.equal(genesis.engine.stateHash(),head);assert.equal(kernelHash(genesis.kernel),kernel);assert.deepEqual(genesis.intentHistoryOf('s_A'),history);
  t.diagnostic(`actual blocked tick=${blocked.tick}; retry terminal=${complete.tick}; snapshot tick=${snapshot.tick}; paid=$0; invalid first proposal is not a crowded route failure`);
});

test('retry switch defaults off even with V2 understanding and a genuine native rejection',async t=>{
  const f=intentNativeFixture(t,':memory:',true,true);
  await drive(f,f.post({contract:INTENT_V2,requestId:'retry-default-off',op:'upsert',words:'go to the campfire'}));await drive(f,f.service.settled());
  const receipt=intentReceiptV2Schema.parse(await (await f.lookup('retry-default-off')).json());assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('not understood');
  await drive(f,f.host.enqueueIntentDecision('fixture:invalid-native-binding',{soulId:'s_A',entityId:'h_A',card:'go to',target:'campfire',option:'go to@campfire',label:'invalid native target proposal',steps:[{verb:'walk_to',params:{to:'absent-native-target'}}],approachLen:1,reevalTicks:1e9,fallback:false,trigger:'new-intent-v2'}, {intentId:receipt.revision.intentId,version:receipt.revision.version},()=>true));
  assert.equal(Object.values(f.host.intentHistoryOf('s_A').attempts)[0].phase,'blocked');
  for(let i=0;i<INTENT_RETRY_COOLDOWN_TICKS;i++){f.mind.nextEvalTick=1e9;f.host.tickOnce();if(i%20===0)await setImmediate();}
  assert.equal(f.brain.midContext(f.mind,'timer').actingPurpose,undefined);
  assert.equal(Object.keys(f.host.intentHistoryOf('s_A').attempts).length,1);assert.equal(f.db.paidCost(),0);
});
