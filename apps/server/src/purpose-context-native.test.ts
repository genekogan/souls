import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {commonsProvisionsFactory} from '@souls/engine-mars';
import {buildMidRequest} from '@souls/brain';
import {publicEvent} from '@souls/protocol';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {Brain} from './brain.ts';
import {IntentControlV2} from './intent-control.ts';
import {WorldHost} from './world.ts';
import {installEdenSteeringModeV1} from './eden-steering-mode.ts';
const factory=await commonsProvisionsFactory();
test('actual native rest completion enriches only owner mind context; default/older progress remains unknown and replay preserves origins',async t=>{
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();await accept<unknown>(f.host,new LivingWorld(f.host).install(['Residents follow their purposes and rest.']));for(let i=0;i<4;i++)f.host.tickOnce();await invite(f,'alice');await invite(f,'bob');
 const alice=await accept(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic private purpose evidence owner'})),bob=await accept(f.host,f.souls.create('dev:bob',{name:'Bob',description:'Separate synthetic owner'}));f.brain.quiesce();
 const brain=new Brain(f.host,f.db,{...f.brain.cfg,budgetUsdPerDay:0},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true});t.after(()=>{brain.quiesce();f.host.stop();f.db.close();});
 const service=new IntentControlV2(f.host,brain,f.souls,{closedGoalsV1:true,registeredActivitiesV1:true}),scope=service.ownerScope({userId:alice.owner,expiresAt:Number.MAX_SAFE_INTEGER},alice.id);
 // Older accepted direction predates sequence bookkeeping; never infer progress.
 await accept(f.host,service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'older-rest',words:'rest'}));await accept(f.host,service.settled());const old=service.lookup(scope,'older-rest');assert.equal(old.phase,'understood');if(old.phase!=='understood')throw Error('old not planned');
 assert.equal(brain.midContext(f.host.minds.get(alice.id)!,'timer').purposes?.[0].source,undefined);
 await accept<unknown>(f.host,f.host.enableIntentSequencesV1());await installEdenSteeringModeV1(f.host,{closedGoalsV1:true,registeredActivitiesV1:true});await accept<unknown>(f.host,f.host.enableIntentPurposeEvidenceV1());
 await accept(f.host,service.submit(scope,{contract:'soul-intent/2',op:'upsert',requestId:'new-rest',words:'rest'}));await accept(f.host,service.settled());const receipt=service.lookup(scope,'new-rest');assert.equal(receipt.phase,'understood');if(receipt.phase!=='understood')throw Error('not planned');
 for(let i=0;i<30&&!f.host.engine.bodyResting?.(alice.entity_id);i++){f.host.tickOnce();await setImmediate();}assert.equal(f.host.engine.bodyResting?.(alice.entity_id),true);
 const read=()=>brain.midContext(f.host.minds.get(alice.id)!,'timer').purposes!,before=read(),current=before.find(p=>p.source?.intentId===receipt.revision.intentId)!;
 assert.equal(current.source?.seq,receipt.revision.submitted.seq);assert.equal(current.contribution?.kind,'native_program_sequence');assert.equal(current.contribution?.completedSteps,0);assert.equal(current.lastAttempt?.phase,'accepted');assert.equal(before.find(p=>p.source?.intentId===old.revision.intentId)?.contribution,undefined);
 assert.ok(!JSON.stringify(brain.midContext(f.host.minds.get(bob.id)!,'timer')).includes(receipt.revision.intentId));brain.quiesce();
 for(let i=0;i<1300&&f.host.engine.bodyResting?.(alice.entity_id);i++)f.host.tickOnce();assert.equal(f.host.engine.bodyResting?.(alice.entity_id),false);
 const after=read(),finished=after.find(p=>p.source?.intentId===receipt.revision.intentId)!;assert.deepEqual(finished.contribution,{kind:'native_program_sequence',completedSteps:1,totalSteps:1});assert.equal(finished.status,'active');assert.equal(finished.lastAttempt?.phase,'accepted','wait-only completion must not invent a controller start/outcome');
 const request=buildMidRequest(brain.midContext(f.host.minds.get(alice.id)!,'timer')).request;assert.ok(JSON.stringify(request).includes('native_program_sequence'));assert.ok(JSON.stringify(request.questions.next).includes('does not fulfil'));
 assert.ok(!JSON.stringify(f.db.events(f.host.worldId).map(publicEvent)).includes(receipt.revision.intentId));f.host.saveSnapshot(true);
 for(const mode of ['snapshot','genesis']){if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);const h=new WorldHost(f.db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,mode);const reader=new Brain(h,f.db,{...f.brain.cfg,budgetUsdPerDay:0},{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){}},{intentV2Choices:true});assert.deepEqual(reader.midContext(h.minds.get(alice.id)!,'timer').purposes,after);reader.quiesce();h.stop();}
 assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
});
