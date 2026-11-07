import {createHash} from 'node:crypto';
import test from 'node:test';import assert from 'node:assert/strict';import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1,marsFactory} from '@souls/engine-mars';import {kernelHash} from '@souls/kernel';
import {Hono} from 'hono';import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';import {hashToken} from './auth.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';import type {EngineFactory} from '@souls/engine-contract';
const common=await retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
async function setup(t:{after(fn:()=>void):void},factory:EngineFactory=common,count=1){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));const rows=[];
 for(let i=0;i<count;i++){await invite(f,'actor'+i);rows.push(await accept(f.host,f.souls.create('dev:actor'+i,{name:'Actor '+i,description:'synthetic admission fixture'})));}
 const spec={id:'eden-balloon',def:'hot-air-balloon',label:'Balloon',at:[-20,-9] as [number,number],yaw:Math.PI,route:'commons-hop',waitSeconds:15};
 if(factory!==common){const engine=f.host.engine as unknown as {previewCarrierV1(s:typeof spec):unknown};const at=([[19,-19],[-19,19],[19,19],[-19,-19],[12,18],[-12,18]] as [number,number][]).find(at=>!engine.previewCarrierV1({...spec,at}));assert.ok(at,'fixture carrier home passes actual native support clearance');spec.at=at;}
 await accept<unknown>(f.host,f.host.installCarrierV1(spec));
 const token='sim_ATOMIC_TEST_TOKEN',ledger=new EdgeLedger(f.host,f.db),app=new Hono();f.db.setSoulToken(rows[0].id,hashToken(token),'synthetic');
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'')),ledger});t.after(()=>{comms.close();f.host.stop();f.db.close();});
 comms.objects.create({id:'ride-test',kind:'ride',name:'Balloon',placeId:'world',params:{carrier:'eden-balloon'}});
 const call=async(body:unknown,direct=false)=>{const r=await accept(f.host,Promise.resolve(app.request(direct?'/v1/edge/objects/ride-test/act':'/v1/edge/act',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})));return await r.json() as {accepted:boolean;code?:string;receipt?:{id:string;phase:string};[key:string]:unknown};};
 const fingerprint=(table:string,order:string)=>{const rows=f.db.db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();return {count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};};
 const snapshot=()=>({object:f.db.db.prepare('SELECT version,body FROM edge_comms_objects WHERE id=?').get('ride-test'),log:f.db.db.prepare('SELECT COUNT(*) n FROM edge_comms_object_log WHERE object_id=?').get('ride-test'),native:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel),receipts:fingerprint('edge_receipts_v1','receipt_id'),events:fingerprint('events','seq'),stream:fingerprint('edge_comms_stream','soul_id,seq'),items:fingerprint('edge_items_v1','item_id'),outcomes:fingerprint('edge_outcomes_v1','receipt_id'),invites:fingerprint('edge_invites_v1','invite_id'),nativeViolations:JSON.stringify(f.host.engine.runtime.violations)});
 return {f,rows,ledger,comms,call,snapshot};
}
test('production ride object remains unchanged when companion admission refuses',{timeout:60000},async t=>{
 const q=await setup(t);for(const action of ['join','leave','start'])assert.equal(q.comms.objects.kindOf('ride')!.actions[action].movesBody,true,'typed ride definition selects atomic admission');const before=q.snapshot(),response=await q.call({capability:'object:ride-test:join',params:{with:[]},clientRef:'refused-companion'});assert.equal(response.accepted,false);assert.equal(response.code,'capability.params');console.log('COMPANION',JSON.stringify({response,before,after:q.snapshot()}));assert.deepEqual(q.snapshot(),before,'refused invitation cannot increment object version/log or affect native/receipts');
});
test('real accepted decision fold failure rolls back native/kernel/log/object and never recovers or publishes',{timeout:60000},async t=>{
 const q=await setup(t),before=q.snapshot(),apply=q.f.host.apply.bind(q.f.host);let physicallyApplied=false,notifications=0;q.comms.streams.onEvent(()=>notifications++);q.comms.onSpectator(()=>notifications++);
 q.f.host.apply=(event,replay,defer)=>{const result=apply(event,replay,defer);if(event.kind==='decision'&&!replay){physicallyApplied=q.f.host.engine.stateHash()!==before.native;throw Error('injected fault AFTER actual native decision fold');}return result;};
 const out=await q.call({action:'join',clientRef:'fold-fault'},true);assert.equal(out.accepted,false);assert.equal(out.code,'object.admission-failed');assert.equal(physicallyApplied,true,'actual production native perform happened before failure');assert.deepEqual(q.snapshot(),before);assert.equal(notifications,0);assert.equal(q.f.host.engine.programOf(q.rows[0].entity_id),null);assert.deepEqual(q.f.host.engine.runtime.violations,[]);
});
test('object SQL/outbox fault after native perform discards subscribers/spectators and exactly restores native head',{timeout:60000},async t=>{
 let webhookCalls=0;t.mock.method(globalThis,'fetch',async()=>{webhookCalls++;return new Response('{}',{status:200});});
 const q=await setup(t),before=q.snapshot(),act=q.comms.objects.act.bind(q.comms.objects);const m=q.f.host.minds.get(q.rows[0].id)!;q.comms.webhooks.subscribe({soulId:m.soulId,entityId:m.entityId,name:m.name,owner:m.owner},{url:'https://receiver.example/atomic',secret:'x'.repeat(16)});let physicallyApplied=false,notifications=0;q.comms.streams.onEvent(()=>notifications++);q.comms.onSpectator(()=>notifications++);
 q.comms.objects.act=(id,soul,input)=>{const out=act(id,soul,input);physicallyApplied=q.f.host.engine.stateHash()!==before.native;q.comms.streams.deliver(soul.soulId,'object',q.f.host.engine.world.tick,{object:id,text:'injected transaction fault event'});q.comms.core.spectate({kind:'object',tick:q.f.host.engine.world.tick,object:id});throw Error('injected fault AFTER actual object SQL and queued outbox');};
 const out=await q.call({capability:'object:ride-test:join',clientRef:'sql-fault'});assert.equal(out.accepted,false);assert.equal(out.code,'object.admission-failed');assert.equal(physicallyApplied,true);assert.deepEqual(q.snapshot(),before);assert.equal(notifications,0);assert.equal(webhookCalls,0,'fake webhook never sees rolled-back object/outbox');
});
test('successful production join commits once; both endpoint retries preserve receipt/object/native and callbacks',{timeout:60000},async t=>{
 const q=await setup(t),before=q.snapshot();let notices=0;q.comms.streams.onEvent(()=>{notices++;assert.ok(q.f.host.engine.programOf(q.rows[0].entity_id),'committed receipt callback sees folded programme');});
 const out=await q.call({action:'join',clientRef:'once'},true);assert.equal(out.accepted,true,JSON.stringify(out));assert.equal(out.receipt?.phase,'started');const accepted=q.snapshot();assert.notDeepEqual(accepted.native,before.native);assert.equal((accepted.object as {version:number}).version,(before.object as {version:number}).version+1);
 const retry=await q.call({action:'join',clientRef:'once'},true);assert.equal(retry.receipt?.id,out.receipt?.id);assert.deepEqual(q.snapshot(),accepted);assert.ok(notices>=2);const priorNotices=notices;
 const edged=await q.call({capability:'object:ride-test:join',clientRef:'edge-once'});assert.equal(edged.accepted,true,JSON.stringify(edged));const after=q.snapshot(),again=await q.call({capability:'object:ride-test:join',clientRef:'edge-once'});assert.equal(again.receipt?.id,edged.receipt?.id);assert.deepEqual(q.snapshot(),after);assert.ok(notices>=priorNotices);
});
test('object version moved while sequencer queued refuses without overwriting the newer object',{timeout:60000},async t=>{
 const q=await setup(t),mind=q.f.host.minds.get(q.rows[0].id)!,soul={soulId:mind.soulId,entityId:mind.entityId,name:mind.name,owner:mind.owner};
 const pending=q.ledger.act(soul,{capability:'object:ride-test:join',clientRef:'stale'});await setImmediate();const changed=q.comms.objects.act('ride-test',soul,{action:'join',params:{}});assert.equal(changed.accepted,true);const baseline=q.snapshot();const out=await accept(q.f.host,pending);assert.equal(out.accepted,false);if(!out.accepted)assert.equal(out.code,'object.changed');assert.deepEqual(q.snapshot(),baseline);
});

test('actual borrowed construction crew body refusal preserves the protected programme and object/custody',{timeout:120000},async t=>{
 const factory=await marsFactory({scene:'eden-camp',safeCrewRemoval:true,arrival:[-3,18],arrivalPlace:'yard',reference:[-1,18],grounds:{id:'grounds',name:'Camp'}});
 const q=await setup(t,factory,4),leader=q.rows[0].entity_id;
 const choose=async(phase:string)=>{const event=await accept(q.f.host,q.f.host.enqueue('decision','synthetic:construction',{soulId:q.rows[0].id,entityId:leader,option:'build_'+phase,label:'build '+phase,steps:[{verb:'build_lookout',params:{phase}}],reevalTicks:1e9,fallback:false,trigger:'synthetic-construction-proof'}));assert.equal(event.kind,'decision');return q.f.host.engine.programOf(leader);};
 const stage=await choose('stage');assert.ok(stage);for(let i=0;i<90000&&q.f.host.engine.programOf(leader);i++)q.f.host.tickOnce();assert.equal(q.f.host.engine.programOf(leader),null,'stage finishes within bound');
 const frame=await choose('frame');assert.ok(frame);for(let i=0;i<90000&&!['upright-a','upright-b'].every(id=>(q.f.host.engine.world.entities[id] as unknown as {support?:{kind:string}})?.support?.kind==='held');i++)q.f.host.tickOnce();assert.ok(['upright-a','upright-b'].every(id=>(q.f.host.engine.world.entities[id] as unknown as {support?:{kind:string}})?.support?.kind==='held'),'actual held frame phase');
 const row=q.rows.find(r=>r.entity_id!==leader&&q.f.host.engine.actorBorrowed?.(r.entity_id));assert.ok(row,'a genuinely borrowed independently owned actor');
 const mind=q.f.host.minds.get(row.id)!,soul={soulId:mind.soulId,entityId:mind.entityId,name:mind.name,owner:mind.owner},before=q.snapshot(),nativeProgram=q.f.host.engine.programOf(leader);
 const out=await q.ledger.act(soul,{capability:'object:ride-test:join',clientRef:'protected-native-body'});assert.equal(out.accepted,false);if(!out.accepted)assert.equal(out.code,'construction.committed');assert.deepEqual(q.snapshot(),before);assert.equal(q.f.host.engine.programOf(leader),nativeProgram);assert.equal(q.f.host.engine.actorBorrowed?.(row.entity_id),true);assert.deepEqual(q.f.host.engine.runtime.violations,[]);assert.equal(q.f.db.paidCost(),0);
});

test('failed object replacement preserves existing follow cache and pending native programme',{timeout:60000},async t=>{
 const q=await setup(t,common,2),follow=await q.call({capability:'follow:'+q.rows[1].id,clientRef:'original-follow'});assert.equal(follow.accepted,true,JSON.stringify(follow));assert.ok(q.ledger.together.followingOf(q.rows[0].id));
 const before=q.snapshot(),following=structuredClone(q.ledger.together.followingOf(q.rows[0].id)),internal=q.ledger as unknown as {insert:(...args:unknown[])=>unknown},insert=internal.insert.bind(q.ledger);
 internal.insert=(...args)=>{insert(...args);throw Error('injected fault AFTER actual replacement receipt insert');};
 const out=await q.call({capability:'object:ride-test:join',clientRef:'replacement-fault'});assert.equal(out.accepted,false);assert.deepEqual(q.snapshot(),before);assert.deepEqual(q.ledger.together.followingOf(q.rows[0].id),following,'rollback cannot lose an in-memory follow owned by the original receipt');
});

test('accepted body output forces atomic admission even if a future definition omitted the advisory marker',{timeout:60000},async t=>{
 const q=await setup(t),ride=q.comms.objects.kindOf('ride')!;q.comms.objects.register({...ride,kind:'future-ride-fixture',actions:{join:{...ride.actions.join,movesBody:undefined}}});q.comms.objects.create({id:'future-ride',kind:'future-ride-fixture',name:'Future ride',placeId:'world',params:{carrier:'eden-balloon'}});
 const before=q.snapshot(),object=q.f.db.db.prepare('SELECT version,body FROM edge_comms_objects WHERE id=?').get('future-ride'),apply=q.f.host.apply.bind(q.f.host);let folded=false;
 q.f.host.apply=(event,replay,defer)=>{const result=apply(event,replay,defer);if(event.kind==='decision'&&!replay){folded=true;throw Error('after real future-definition body fold');}return result;};
 const out=await q.call({capability:'object:future-ride:join',clientRef:'future-marker'});assert.equal(out.accepted,false);assert.equal(out.code,'object.admission-failed');assert.equal(folded,true);assert.deepEqual(q.snapshot(),before);assert.deepEqual(q.f.db.db.prepare('SELECT version,body FROM edge_comms_objects WHERE id=?').get('future-ride'),object);
});

test('committed native decision resolves despite throwing advisory listeners',{timeout:60000},async t=>{
 const q=await setup(t);let laterDecision=0,laterApplied=0;
 q.f.host.listeners.push({onDecision(){throw Error('injected advisory decision fault');},onApplied(){throw Error('injected advisory applied fault');}});
 q.f.host.listeners.push({onDecision(){laterDecision++;},onApplied(){laterApplied++;}});
 const out=await q.call({action:'join',clientRef:'advisory-fault'},true);assert.equal(out.accepted,true);assert.equal(out.receipt?.phase,'started');assert.equal(laterDecision,1);assert.equal(laterApplied,1);
});

test('real native safe-stop wait is accepted intent, not boarding; late start failure retains truthful failed receipt',{timeout:60000},async t=>{
 const q=await setup(t),actor=q.rows[0].entity_id;
 await accept<unknown>(q.f.host,q.f.host.installCommonsProvisionsV1());await accept<unknown>(q.f.host,q.f.host.installRetainedCommonsShoreV1());
 // Reuse the existing connected-shore unsafe between-level fixture geometry:
 // a real occupied native landing, not a mocked canPerform/refusal flag.
 const {loadMars}=await import('../../../packages/engine-mars/src/load.ts'),{regionSlots}=await import('../../../mars/viewer/engine/social/slots.ts'),m=await loadMars();
 const native=q.f.host.engine as unknown as {rt:InstanceType<typeof m.Runtime>},w=native.rt.world;
 const region={id:'hold',label:'Hypothetical landing hold',provenance:{origin:'test-fixture' as const,confidence:'hypothetical' as const},kind:'place' as const,level:1,polygon:[[8.9,-2.71],[9.1,-2.71],[9.1,-.7],[8.9,-.7]] as [number,number][],layout:{focus:[9,1] as [number,number],kind:'stand' as const}};w.regions.hold=region;
 const slot=regionSlots(native.rt,region).find(s=>Math.abs(s.p[1]+1.7)<1e-8)!;assert.ok(slot);w.entities.blocker=m.human('blocker',slot.p[0],slot.p[1],{level:1,y:.24,yaw:slot.yaw});assert.notEqual(q.f.host.engine.submit!('take_slot',{actor:'blocker',slot:slot.id}).status,'failed');
 await accept(q.f.host,q.f.host.enqueue('edge-relocate','synthetic:fixture-position',{soulId:q.rows[0].id,entityId:actor,to:[9,.8],why:'hypothetical blocked-landing native fixture'}));
 await accept(q.f.host,q.f.host.enqueue('decision','synthetic:climb',{soulId:q.rows[0].id,entityId:actor,option:'climb-fixture',label:'Real native climb before ride',steps:[{verb:'mars:commons_shore_travel',params:{x:9,z:-1.8,level:1}}],reevalTicks:1e9,fallback:false,trigger:'synthetic-climb'}));
 for(let i=0;i<250;i++)q.f.host.tickOnce();assert.equal(w.entities[actor].human?.activity,'climb-wait');
 const board=[{verb:'stand',params:{}},{verb:'walk_to',params:{to:'eden-balloon',standoff:2.2}},{verb:'mars:carrier_ride',params:{carrier:'eden-balloon'}}],issue=q.f.host.engine.canPerform({actor,label:'Board',steps:board});
 assert.match(issue?.code??'',/^program.safe-stop/,'actual blocked native climb requires safe-stop');
 const before=q.comms.objects.all().find(o=>o.id==='ride-test')!,out=await q.call({action:'join',clientRef:'wait-failure'},true);assert.equal(out.accepted,true,JSON.stringify(out));assert.equal(out.receipt?.phase,'waiting');let receipt=out.receipt!.id;
 const waiting=q.ledger.receipt(q.rows[0].id,receipt)!;assert.equal(waiting.programId,null);assert.equal(waiting.startedTick,null);assert.equal(waiting.outcome,undefined);assert.deepEqual(q.comms.objects.all().find(o=>o.id==='ride-test')!.state,before.state,'ride bookkeeping adds no physical member');assert.equal(q.ledger.aboard(actor),null);
 const cancelledReceipt=receipt,stop=await q.call({capability:'stand:here',clientRef:'replace-waiting-ride'});assert.equal(stop.accepted,true);assert.equal(q.ledger.receipt(q.rows[0].id,cancelledReceipt)!.phase,'replaced');assert.equal(q.ledger.aboard(actor),null);
 const retried=await q.call({action:'join',clientRef:'new-wait-failure'},true);assert.equal(retried.accepted,true);assert.equal(retried.receipt?.phase,'waiting');receipt=retried.receipt!.id;
 await accept(q.f.host,q.f.host.enqueue('decision','synthetic:clear-landing',{entityId:'blocker',option:'clear-fixture',label:'Clear hypothetical landing',steps:[{verb:'walk_to',params:{to:[9.9,-1.7]}}],reevalTicks:1e9,fallback:false,trigger:'synthetic-clear'}));
 const enqueue=q.f.host.enqueue.bind(q.f.host);let failedStart=false;q.f.host.enqueue=(kind,author,payload)=>{if(kind==='decision'&&(payload as {trigger?:string}).trigger===`edge-act:${receipt}`){failedStart=true;return Promise.reject(Error('injected failure of later queued native start'));}return enqueue(kind,author,payload);};
 for(let i=0;i<2000&&q.ledger.receipt(q.rows[0].id,receipt)?.phase==='waiting';i++){q.f.host.tickOnce();if(i%20===0)await setImmediate();}
 const final=q.ledger.receipt(q.rows[0].id,receipt)!;assert.equal(failedStart,true);assert.equal(final.phase,'failed');assert.equal(final.code,'ledger.unavailable');assert.equal(final.startedTick,null);assert.equal(q.ledger.aboard(actor),null);assert.deepEqual((q.comms.objects.all().find(o=>o.id==='ride-test')!.state as {riders:unknown[]}).riders,[]);assert.deepEqual(q.f.host.engine.runtime.violations,[]);console.log('WAIT_TRUTH',JSON.stringify({accepted:out.receipt,final:final.phase,code:final.code,physicalRiders:0,actionVersionRetained:true}));
});
