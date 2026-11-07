import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {openJournal,DEFAULT_JOURNAL_RETENTION} from './journal.mjs';
const identity={worldId:'test-world',soulId:'test-soul'};
const event={id:'c_1',kind:'conversation.turn',text:'Are you coming?'};
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'souls-journal-'));const handles=[];t.after(()=>{for(const h of handles)try{h.close()}catch{}rmSync(directory,{recursive:true,force:true})});return {directory,open(options={}){const h=openJournal(directory,{...identity,...options});handles.push(h);return h;}};}
const stored=f=>{const db=new DatabaseSync(join(f.directory,'continuity.sqlite'),{readOnly:true});try{return db.prepare('SELECT * FROM events ORDER BY seq').all();}finally{db.close();}};

test('process death after ingest retains an unhandled message and matching cursor',t=>{
 const f=fixture(t);const moduleUrl=new URL('./journal.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {openJournal} from ${JSON.stringify(moduleUrl)};const j=openJournal(process.argv[1],${JSON.stringify(identity)});j.ingest({source:'world',after:null,cursor:'c_1',events:[${JSON.stringify(event)}]});process.kill(process.pid,'SIGKILL');`,f.directory],{encoding:'utf8',timeout:10000});
 assert.equal(child.signal,'SIGKILL');const j=f.open();assert.equal(j.cursor('world'),'c_1');assert.deepEqual(j.pending().map(x=>x.event),[event]);
 j.handled('world','c_1','conversation response reconciled');j.close();const reopened=f.open();assert.equal(reopened.pending().length,0);assert.equal(reopened.cursor('world'),'c_1');
});
test('duplicate page is deduplicated; a changed event rolls the whole batch and cursor back',t=>{
 const j=fixture(t).open();j.ingest({source:'world',after:null,cursor:'c_1',events:[event]});
 assert.equal(j.ingest({source:'world',after:'c_1',cursor:'c_1',events:[{text:event.text,kind:event.kind,id:event.id}]}).inserted,0);
 assert.throws(()=>j.ingest({source:'world',after:'c_1',cursor:'c_3',events:[{id:'c_2',kind:'speech'}, {...event,text:'Changed'}]}),/different content/);
 assert.equal(j.cursor('world'),'c_1');assert.equal(j.pending().length,1);
});
test('two receiver connections cannot advance from the same stale cursor',t=>{
 const f=fixture(t),a=f.open(),b=f.open();a.ingest({source:'world',after:null,cursor:'c_1',events:[event]});
 assert.throws(()=>b.ingest({source:'world',after:null,cursor:'c_2',events:[{id:'c_2'}]}),/Stale/);assert.equal(b.cursor('world'),'c_1');
});
test('world identity is scoped, owner source separate, gaps require explicit reconciliation',t=>{
 const f=fixture(t),j=f.open();assert.throws(()=>openJournal(f.directory,{...identity,soulId:'other'}),/another world/);
 j.ingest({source:'owner',after:null,cursor:'message-1',events:[{id:'c_1',text:'Owner instruction'}]});
 const r=j.ingest({source:'world',after:null,cursor:'c_20',events:[],gap:true});assert.equal(j.gaps().length,1);assert.equal(j.pending().length,1);
 j.reconcileGap(r.gapId,'Fresh observation and receipt checked; missing conversation history remains unknown');assert.equal(j.gaps().length,0);assert.equal(j.cursor('owner'),'message-1');
});
test('handling requires a known event and cannot silently revise its outcome',t=>{
 const j=fixture(t).open();assert.throws(()=>j.handled('world','c_1','done'),/unknown/);j.ingest({source:'world',after:null,cursor:'c_1',events:[event]});
 assert.deepEqual(j.handled('world','c_1','responded'),{alreadyHandled:false});assert.deepEqual(j.handled('world','c_1','responded'),{alreadyHandled:true});assert.throws(()=>j.handled('world','c_1','ignored'),/already recorded/);
});
test('urgent addressed speech is not buried behind an old ambient backlog',t=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-priority-'));const j=openJournal(dir,{worldId:'w',soulId:'s'});t.after(()=>{j.close();rmSync(dir,{recursive:true,force:true});});
 j.ingest({source:'world',after:null,cursor:'c_1000',events:Array.from({length:1000},(_,i)=>({id:'c_'+(i+1),salience:1,text:'ambient'}))});
 j.ingest({source:'world',after:'c_1000',cursor:'c_1001',events:[{id:'c_1001',salience:3,text:'Hello reader'}]});
 assert.equal(j.attention(1)[0].event.id,'c_1001');assert.equal(j.pending(1)[0].event.id,'c_1');
});
test('compaction preserves handled identity/outcome, rejects conflicting replay and retains all unhandled payloads across restart',t=>{
 const f=fixture(t),options={retention:{handledEvents:0,handledBytes:0}},j=f.open(options);
 j.ingest({source:'world',after:null,cursor:'c_3',events:[event,{id:'c_2',text:'Never handled'},{id:'c_3',text:'Already incorporated'}]});
 j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Cancel the old goal'}]});
 const pendingBefore=j.pending();j.handled('world','c_1','responded');j.handled('world','c_3','incorporated');
 const before=stored(f),result=j.maintenance();assert.equal(result.compactedEvents,2);assert.equal(result.moreWork,false);assert.equal(result.storage.compactedEvents,2);assert.equal(result.storage.identityEvents,4);
 const after=stored(f);for(const i of [0,2]){assert.equal(after[i].payload,'null');assert.equal(after[i].digest,before[i].digest);assert.equal(after[i].outcome,before[i].outcome);assert.equal(after[i].seq,before[i].seq);assert.notEqual(after[i].compacted_at,null);}
 assert.deepEqual(j.pending(),pendingBefore.filter(p=>!['c_1','c_3'].includes(p.event.id)));
 assert.equal(j.ingest({source:'world',after:'c_3',cursor:'c_3',events:[event]}).inserted,0);assert.deepEqual(j.handled('world','c_1','responded'),{alreadyHandled:true});
 assert.throws(()=>j.ingest({source:'world',after:'c_3',cursor:'c_5',events:[{id:'c_4'}, {...event,text:'Different history'}]}),/different content/);assert.equal(j.cursor('world'),'c_3');assert.equal(j.storageStats().identityEvents,4);
 j.close();const reopened=f.open(options);assert.equal(reopened.ingest({source:'world',after:'c_3',cursor:'c_4',events:[event,{id:'c_4',text:'New'}]}).inserted,1);
 assert.deepEqual(reopened.pending().map(p=>[p.sequence,p.event.id]),[[2,'c_2'],[4,'m1'],[5,'c_4']]);assert.deepEqual(reopened.handled('world','c_1','responded'),{alreadyHandled:true});assert.throws(()=>reopened.handled('world','c_1','execute again'),/already recorded/);
});
test('hard pending ceilings roll the entire page/cursor/gap back and reserve independent owner capacity',t=>{
 const j=fixture(t).open({retention:{worldPendingEvents:2,worldPendingBytes:1000,ownerPendingEvents:1,ownerPendingBytes:1000}});
 j.ingest({source:'world',after:null,cursor:'c_1',events:[event]});
 assert.throws(()=>j.ingest({source:'world',after:'c_1',cursor:'c_3',events:[{id:'c_2'},{id:'c_3'}],gap:true}),e=>e.code==='JOURNAL_BACKLOG_FULL'&&e.transient===true&&e.bucket==='world');
 assert.equal(j.cursor('world'),'c_1');assert.equal(j.pending().length,1);assert.equal(j.gaps().length,0);assert.equal(j.storageStats().identityEvents,1);
 j.ingest({source:'world',after:'c_1',cursor:'c_2',events:[{id:'c_2'}]});
 assert.throws(()=>j.ingest({source:'other-world-stream',after:null,cursor:'x',events:[{id:'x'}]}),e=>e.code==='JOURNAL_BACKLOG_FULL');
 j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Stop now'}]});assert.equal(j.attention(1)[0].event.id,'m1');
 assert.throws(()=>j.ingest({source:'owner',after:'m1',cursor:'m2',events:[{id:'m2'}]}),e=>e.code==='JOURNAL_BACKLOG_FULL'&&e.bucket==='owner');assert.equal(j.cursor('owner'),'m1');
 j.handled('world','c_1','incorporated');j.ingest({source:'world',after:'c_2',cursor:'c_3',events:[{id:'c_3'}]});assert.equal(j.storageStats().pending.world.events,2);assert.equal(j.storageStats().pending.owner.events,1);
 assert.equal(j.ingest({source:'owner',after:'m1',cursor:'m1',events:[{id:'m1',text:'Stop now'}]}).inserted,0,'exact replay consumes no capacity');
});
test('pending byte ceilings count UTF-8 payloads and handling frees capacity before compaction',t=>{
 const f=fixture(t),message={id:'m1',text:'é'.repeat(50)},bytes=Buffer.byteLength(JSON.stringify(message)),j=f.open({retention:{ownerPendingBytes:bytes}});
 j.ingest({source:'owner',after:null,cursor:'m1',events:[message]});assert.equal(j.storageStats().pending.owner.bytes,bytes);
 assert.throws(()=>j.ingest({source:'owner',after:'m1',cursor:'m2',events:[{id:'m2'}]}),e=>e.code==='JOURNAL_BACKLOG_FULL');assert.equal(j.cursor('owner'),'m1');
 j.handled('owner','m1','incorporated');assert.equal(j.storageStats().pending.owner.bytes,0);assert.equal(j.storageStats().handled.bytes,bytes);
 j.ingest({source:'owner',after:'m1',cursor:'m2',events:[{id:'m2'}]});assert.equal(j.pending()[0].event.id,'m2');
});
test('pending decisions protect already-handled payloads through restart until final checkpoint',t=>{
 const f=fixture(t),options={now:()=>1000,retention:{handledEvents:0,handledBytes:0,handledAgeMs:0,maintenanceEvery:1}},j=f.open(options),fence=j.control.claim('controller');
 j.ingest({source:'world',after:null,cursor:'c_1',events:[event]});
 j.control.save(fence,0,{pendingDecision:{id:'decision-1',eventIds:[{source:'world',id:'c_1'}]}});
 j.handled('world','c_1','incorporated:decision-1');assert.equal(j.maintenance().protectedEvents,1);assert.equal(stored(f)[0].payload.includes('Are you coming'),true);assert.equal(j.storageStats().compactedEvents,0);
 j.close();const reopened=f.open(options);assert.equal(reopened.maintenance().compactedEvents,0);assert.equal(reopened.storageStats().handled.protectedEvents,1);assert.deepEqual(reopened.handled('world','c_1','incorporated:decision-1'),{alreadyHandled:true});
 reopened.control.save(fence,1,{pendingDecision:null,lastDecisionId:'decision-1'});const compacted=reopened.maintenance();assert.equal(compacted.compactedEvents,1);assert.equal(compacted.storage.handled.bytes,0);assert.equal(reopened.cursor('world'),'c_1');
});
test('periodic compaction bounds handled payload targets and maintenance batches preserve newest rows and stable sequences',t=>{
 const f=fixture(t);let time=1000;const j=f.open({now:()=>time,retention:{handledEvents:2,handledBytes:100000,handledAgeMs:50,maintenanceEvery:2}});
 j.ingest({source:'world',after:null,cursor:'c_6',events:Array.from({length:6},(_,i)=>({id:'c_'+(i+1),text:'x'.repeat(100)}))});
 for(let n=1;n<=5;n++){j.handled('world','c_'+n,'incorporated');time++;}
 assert.equal(j.storageStats().handled.events,2);assert.equal(j.storageStats().compactedEvents,3);assert.equal(j.pending()[0].sequence,6);
 time+=100;const first=j.maintenance({maxCompactions:1});assert.equal(first.compactedEvents,1);assert.equal(first.moreWork,true);const last=j.maintenance({maxCompactions:1,vacuum:true});assert.equal(last.compactedEvents,1);assert.equal(last.moreWork,false);
 assert.equal(last.storage.handled.events,0);assert.equal(last.storage.identityEvents,6);assert.deepEqual(j.pending().map(p=>p.sequence),[6]);
 j.close();const reopened=f.open();reopened.ingest({source:'world',after:'c_6',cursor:'c_7',events:[{id:'c_7'}]});assert.deepEqual(reopened.pending().map(p=>p.sequence),[6,7]);
});
test('handled byte budget compacts oldest payloads, while legacy migration preserves digest and sequence',t=>{
 const f=fixture(t),db=new DatabaseSync(join(f.directory,'continuity.sqlite'));
 db.exec('CREATE TABLE events(seq INTEGER PRIMARY KEY,source TEXT NOT NULL,event_id TEXT NOT NULL,payload TEXT NOT NULL,digest TEXT NOT NULL,received_at INTEGER NOT NULL,handled_at INTEGER,outcome TEXT,UNIQUE(source,event_id))');
 db.prepare('INSERT INTO events VALUES(41,?,?,?,?,?,?,?)').run('world','legacy','{"id":"legacy","text":"old"}','original-digest',100,200,'original outcome');db.close();
 const j=f.open({now:()=>1000,retention:{handledBytes:0,handledEvents:10}});assert.equal(j.storageStats().handled.bytes,28);assert.equal(j.maintenance().compactedEvents,1);const row=stored(f)[0];assert.equal(row.seq,41);assert.equal(row.digest,'original-digest');assert.equal(row.outcome,'original outcome');
 j.ingest({source:'world',after:null,cursor:'next',events:[{id:'next'}]});assert.equal(j.pending()[0].sequence,42);assert.equal(j.storageStats().identityEvents,2);
});
test('automatic maintenance cadence is durable across restarts and shared by connections',t=>{
 const f=fixture(t),options={retention:{handledEvents:0,maintenanceEvery:3}},j=f.open(options);
 j.ingest({source:'world',after:null,cursor:'c_1',events:[event]});j.handled('world','c_1','incorporated');assert.equal(j.storageStats().writesSinceMaintenance,2);j.close();
 const reopened=f.open(options),other=f.open(options);assert.equal(reopened.storageStats().writesSinceMaintenance,2);other.ingest({source:'world',after:'c_1',cursor:'c_2',events:[{id:'c_2'}]});
 assert.equal(reopened.storageStats().compactedEvents,1);assert.equal(reopened.storageStats().writesSinceMaintenance,0);assert.deepEqual(reopened.pending().map(p=>p.sequence),[2]);
});
test('retention defaults are explicit and invalid policies/maintenance options are refused',t=>{
 const f=fixture(t);assert.equal(DEFAULT_JOURNAL_RETENTION.worldPendingEvents,20000);assert.equal(DEFAULT_JOURNAL_RETENTION.ownerPendingBytes,8*1024*1024);
 for(const retention of [{handledEvents:-1},{maintenanceEvery:0},{maintenanceEvery:1001},{worldPendingBytes:1.5},{unknownLimit:1},null])assert.throws(()=>f.open({retention}),/retention|maintenanceEvery/);
 const j=f.open();for(const options of [{maxCompactions:0},{maxCompactions:10001},{vacuum:'yes'}])assert.throws(()=>j.maintenance(options),/maintenance/);
});

const ownerResult=(id='m1',outcome='done',text='Read and returned')=>({type:'write',command:'result',args:{id,outcome,text}});
const nativeResult=call=>({inbox:{latest:{id:call.args.id,state:'acknowledged',result:call.args.text.trim(),outcome:call.args.outcome,resultAt:100}}});
function settle(j,fence,id,call,response){j.control.prepare(fence,id,call);j.control.dispatch(fence,id);j.control.settle(fence,id,response);}
test('owner identity and original intent survive handling, plan loss, compaction, replay and restart until exact native result',t=>{
 const f=fixture(t),options={retention:{handledEvents:0,handledBytes:0}},j=f.open(options),original={id:'m1',kind:'owner.message',text:'Read then return and report',sentAt:42};
 j.ingest({source:'owner',after:null,cursor:'m1',events:[original]});j.handled('owner','m1','incorporated:forgotten');j.maintenance();
 assert.equal(stored(f)[0].payload,'null');assert.deepEqual(j.openOwnerTasks().tasks,[{id:'m1',sourceEventSequence:1,text:original.text,sentAt:42,intentUnknown:false}]);
 j.close();const reopened=f.open(options),fence=reopened.control.claim('recovery');
 assert.equal(reopened.openOwnerTasks().tasks[0].text,original.text);assert.equal(reopened.ingest({source:'owner',after:'m1',cursor:'m1',events:[original]}).inserted,0);
 const ack={type:'write',command:'ack',args:{id:'m1',reply:'Received'}};settle(reopened,fence,'ack',ack,nativeResult(ownerResult()));assert.equal(reopened.closeOwnerTaskFromOperation(fence,'ack').closed,false);
 const call=ownerResult();settle(reopened,fence,'terminal',call,nativeResult(call));assert.equal(reopened.closeOwnerTaskFromOperation(fence,'terminal').closed,true);assert.equal(reopened.openOwnerTasks().totalOpen,0);assert.equal(reopened.ownerTaskStats().openBytes,0);
 assert.equal(reopened.closeOwnerTaskFromOperation(fence,'terminal').alreadyClosed,true);reopened.close();const again=f.open();assert.equal(again.openOwnerTasks().totalOpen,0);assert.equal(again.ingest({source:'owner',after:'m1',cursor:'m1',events:[original]}).inserted,0);assert.equal(again.openOwnerTasks().totalOpen,0);
});
test('owner task capacity remains reserved after event handling and entire over-cap intake rolls back',t=>{
 const j=fixture(t).open({ownerTaskLimits:{tasks:1},retention:{handledEvents:0,handledBytes:0}}),fence=j.control.claim('test');
 j.ingest({source:'world',after:null,cursor:'c1',events:[{id:'c1'}]});j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Original',sentAt:1}]});j.handled('owner','m1','incorporated');j.maintenance();
 assert.throws(()=>j.ingest({source:'owner',after:'m1',cursor:'m3',events:[{id:'m2',text:'Cancel original'},{id:'m3',text:'Replacement'}],gap:true}),e=>e.code==='OWNER_TASK_BACKLOG_FULL'&&e.transient===true);
 assert.equal(j.cursor('owner'),'m1');assert.equal(j.gaps().length,0);assert.equal(j.storageStats().identityEvents,2);assert.deepEqual(j.openOwnerTasks().tasks.map(x=>x.id),['m1']);
 const call=ownerResult('m1','failed','Cancelled by newer owner instruction');settle(j,fence,'cancelled',call,nativeResult(call));j.closeOwnerTaskFromOperation(fence,'cancelled');
 j.ingest({source:'owner',after:'m1',cursor:'m2',events:[{id:'m2',text:'Replacement',sentAt:2}]});assert.deepEqual(j.openOwnerTasks().tasks.map(x=>[x.id,x.sourceEventSequence]),[['m2',3]]);
});
test('owner task byte ceiling and independently supplied cancellation preserve both old and new intent',t=>{
 const j=fixture(t).open({ownerTaskLimits:{bytes:300}});
 j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read together',sentAt:1}]});j.handled('owner','m1','incorporated');
 j.ingest({source:'owner',after:'m1',cursor:'m2',events:[{id:'m2',text:'Cancel reading',sentAt:2}]});
 assert.deepEqual(j.openOwnerTasks().tasks.map(x=>x.text),['Read together','Cancel reading']);
 assert.throws(()=>j.ingest({source:'owner',after:'m2',cursor:'m3',events:[{id:'m3',text:'é'.repeat(100)}]}),{code:'OWNER_TASK_BACKLOG_FULL'});assert.equal(j.cursor('owner'),'m2');assert.equal(j.ownerTaskStats().totalOpen,2);assert.ok(j.ownerTaskStats().openBytes<=300);
});
test('owner task closure rejects refused, non-native, server-only, mismatched and unsettled outcomes',t=>{
 const j=fixture(t).open(),fence=j.control.claim('test'),call=ownerResult();j.ingest({source:'owner',after:null,cursor:'m1',events:[{id:'m1',text:'Read',sentAt:1}]});
 const valid=nativeResult(call),m=valid.inbox.latest;
 const cases=[{accepted:true},{accepted:false,...valid},{error:{message:'refused'},...valid},{inbox:{latest:{...m,id:'other'}}},{inbox:{latest:{...m,state:'delivered'}}},{inbox:{latest:{...m,resultBy:'server'}}},{inbox:{latest:{...m,outcome:'failed'}}},{inbox:{latest:{...m,result:'Different'}}},{inbox:{latest:{...m,resultAt:undefined}}}];
 for(const [n,response] of cases.entries()){const id='rejected-'+n;settle(j,fence,id,call,response);assert.equal(j.closeOwnerTaskFromOperation(fence,id).closed,false);}
 j.control.prepare(fence,'pending',call);j.control.dispatch(fence,'pending');assert.equal(j.closeOwnerTaskFromOperation(fence,'pending').closed,false);j.control.uncertain(fence,'pending');assert.equal(j.closeOwnerTaskFromOperation(fence,'pending').closed,false);
 assert.equal(j.openOwnerTasks().totalOpen,1);assert.throws(()=>j.closeOwnerTaskFromOperation({...fence,generation:999},'rejected-0'),/lease lost/);
 j.control.settle(fence,'pending',{...valid,reconciliation:{evidence:'observed-native-state',note:'effect satisfaction only'}});assert.equal(j.closeOwnerTaskFromOperation(fence,'pending').evidence,'observed-native-state');assert.equal(j.openOwnerTasks().totalOpen,0);
});
test('legacy owner migration restores handled intent, honors settled completion and exposes compacted unknown intent',t=>{
 const f=fixture(t),j=f.open(),fence=j.control.claim('old');
 j.ingest({source:'owner',after:null,cursor:'m3',events:[{id:'m1',text:'Original task',sentAt:1},{id:'m2',text:'Already complete',sentAt:2},{id:'m3',text:'Compacted original',sentAt:3}]});for(const id of ['m1','m2','m3'])j.handled('owner',id,'incorporated');
 const done=ownerResult('m2'),orphan=ownerResult('later');settle(j,fence,'done',done,nativeResult(done));settle(j,fence,'completed-before-intake',orphan,nativeResult(orphan));settle(j,fence,'refused',ownerResult('m1'),{accepted:false,error:{message:'too long'}});j.close();
 const db=new DatabaseSync(join(f.directory,'continuity.sqlite'));db.exec('DROP TABLE owner_tasks_v1; DROP TABLE owner_task_storage_v1');db.prepare("UPDATE events SET payload='null',payload_bytes=0,compacted_at=100 WHERE event_id='m3'").run();db.close();
 const restored=f.open();assert.deepEqual(restored.openOwnerTasks().tasks,[{id:'m1',sourceEventSequence:1,text:'Original task',sentAt:1,intentUnknown:false},{id:'m3',sourceEventSequence:3,text:null,sentAt:null,intentUnknown:true,unknownReason:'compacted-before-owner-task-ledger'}]);
 assert.equal(restored.openOwnerTasks().unknownIntentCount,1);assert.equal(restored.ownerTaskStats().closedIdentities,2);
 restored.ingest({source:'owner',after:'m3',cursor:'later',events:[{id:'later',text:'Completed before intake',sentAt:4}]});assert.equal(restored.openOwnerTasks().totalOpen,2,'a proven result tombstone cannot reopen on later intake');restored.close();assert.equal(f.open().openOwnerTasks().totalOpen,2);
});
test('over-cap legacy owner migration rolls back instead of silently dropping intent or treating handled as complete',t=>{
 const f=fixture(t),j=f.open();j.ingest({source:'owner',after:null,cursor:'m2',events:[{id:'m1',text:'One'},{id:'m2',text:'Two'}]});j.handled('owner','m1','incorporated');j.close();
 const db=new DatabaseSync(join(f.directory,'continuity.sqlite'));db.exec('DROP TABLE owner_tasks_v1; DROP TABLE owner_task_storage_v1');db.close();
 assert.throws(()=>f.open({ownerTaskLimits:{tasks:1}}),{code:'OWNER_TASK_BACKLOG_FULL'});
 const check=new DatabaseSync(join(f.directory,'continuity.sqlite'));assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name='owner_tasks_v1'").get(),undefined);check.close();assert.equal(f.open().openOwnerTasks().totalOpen,2);
});
test('owner task prompt pages bound bytes, preserve oldest identities and provide exact local text chunk retrieval',t=>{
 const j=fixture(t).open(),events=Array.from({length:25},(_,i)=>({id:'m'+(i+1),text:'🌎'.repeat(1000),sentAt:i}));j.ingest({source:'owner',after:null,cursor:'m25',events});
 const first=j.openOwnerTasks();assert.equal(first.tasks.length,20);assert.equal(first.tasks[0].id,'m1');assert.equal(first.tasks[19].id,'m20');assert.equal(first.omitted,5);assert.equal(first.nextCursor,20);assert.ok(Buffer.byteLength(JSON.stringify(first))<=32768);assert.ok(first.tasks.some(x=>x.textOmitted));
 const omitted=first.tasks.find(x=>x.textOmitted);assert.equal(j.ownerTask({id:omitted.id}).task.text,events[0].text);assert.equal(j.openOwnerTasks({after:first.nextCursor}).tasks[0].id,'m21');
 j.ingest({source:'owner',after:'m25',cursor:'large',events:[{id:'large',text:'🌎'.repeat(16000),sentAt:26}]});const large=j.openOwnerTasks({after:25});assert.equal(large.tasks[0].textOmitted,true);
 let offset=0,text='';do{const chunk=j.ownerTask({id:'large',offset});assert.ok(Buffer.byteLength(JSON.stringify(chunk))<=32768);text+=chunk.task.text;offset=chunk.task.nextOffset;}while(offset!==null);assert.equal(text,'🌎'.repeat(16000));
 assert.throws(()=>j.openOwnerTasks({limit:21}),/page limit/);assert.throws(()=>j.openOwnerTasks({after:-1}),/cursor/);assert.throws(()=>j.ownerTask({id:'large',offset:20000}),/exceeds length/);
});
