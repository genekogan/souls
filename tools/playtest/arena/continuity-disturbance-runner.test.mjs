import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,appendFileSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import * as sourceFs from 'node:fs';
import {createContinuityDisturbanceRunner,readDisturbanceJson} from './continuity-disturbance-runner.mjs';
const fixtures=JSON.parse(readFileSync(new URL('../scenarios/continuity/fixtures.json',import.meta.url)));
const T0=1793400000000,sha=x=>createHash('sha256').update(x).digest('hex');
const json=(p,v)=>writeFileSync(p,JSON.stringify(v)+'\n',{mode:0o600});
function fixture(t,name='mars-presentation-four',{worldTransport,ownerTransport,pollMs=250,schedule,cancel,manifestWaitMs,undeclared=false}={}){
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'continuity-disturbance-files-')));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const trial=join(parent,'trial'),capture=join(parent,'capture'),out=join(parent,'disturbances');mkdirSync(capture);
 const scenario=structuredClone(fixtures.scenarios.find(s=>s.id===name)),actors=scenario.actors.map(a=>({actorId:a.id,soulId:'s_'+a.id})),fixtureActors=[{actorId:'greeter',soulId:'s_greeter'}],soulIds=[...actors,...fixtureActors].map(a=>a.soulId),seqs=new Map(soulIds.map(s=>[s,0])),sent=[],failures=[];
 let now=T0-1000,index=0,lastHash='',generation=0,exportBytes=0,exportRows=0;
 const status={schema:'continuity-native-capture/1',runId:'run_test',worldId:'world_test',epoch:'capture_epoch',soulIds,bindings:soulIds.map(soulId=>({soulId,owner:'owner_'+soulId,bodyId:'h_'+soulId})),startHeads:soulIds.map(soulId=>({soulId,head:0,floor:0})),startedAt:now,heartbeatAt:now,healthy:true,failure:null,closed:false,index:0,lastHash:'',generation:0,limits:{maxHeartbeatGapMs:5000}};
 const statusWrite=()=>{Object.assign(status,{index,lastHash,generation:++generation,heartbeatAt:now});json(join(capture,'capture-status.json'),status);};
 const native=(kind,data={},{commit=true}={})=>{const body={schema:'continuity-native-record/1',runId:'run_test',worldId:'world_test',epoch:'capture_epoch',index:++index,observedAt:now,kind,...data,previousHash:lastHash},record={...body,hash:sha(JSON.stringify(body))};lastHash=record.hash;appendFileSync(join(capture,'native-capture.jsonl'),JSON.stringify(record)+'\n');if(commit)statusWrite();return record;};
 native('capture-start',{scope:{soulIds},startHeads:status.startHeads});
 const runner=createContinuityDisturbanceRunner({trialDirectory:trial,outputDirectory:out,captureDirectory:capture,runId:'run_test',worldId:'world_test',scenario,actors,fixtureActors,worldSenders:Object.fromEntries(scenario.disturbances.filter(d=>d.trigger?.deliveryKind==='world').map(d=>[d.id,'greeter'])),evidence:['fixtures.json#'+name],pollMs,...(manifestWaitMs?{manifestWaitMs}:{}),...(name==='eden-walk-three'&&!undeclared?{fixtureVersion:3}:{})}, {now:()=>now,onFailure:e=>failures.push(e),...(schedule?{schedule}:{}),...(cancel?{cancel}:{}),sendWorld:async request=>{sent.push(request);return worldTransport?worldTransport(request):{status:'accepted',worldId:'world_test',senderSoulId:'s_greeter',speechId:'said_'+request.id,evidence:['native-send.json#'+request.id]};},sendOwner:async request=>{sent.push(request);return ownerTransport?ownerTransport(request):{status:'accepted',worldId:'world_test',recipientSoulId:request.recipients[0].soulId,messageId:'message_'+request.id,evidence:['owner-send.json#'+request.id]};}});
 assert.equal(existsSync(trial),false,'wrapper never precreates common trial output');
 const run={schema:'sim-continuity-trial/1',runId:'run_test',worldId:'world_test',startedAt:T0,cutoffAt:T0+scenario.timing.endOffsetSec*1000,meetingAt:T0+scenario.timing.meetingOffsetSec*1000,actors:scenario.actors.map(a=>({id:a.id,soulId:'s_'+a.id,releaseOffsetSec:a.releaseOffsetSec??0,instructionSha256:sha(a.id)})),fixtureActors:[{id:'greeter',soulId:'s_greeter'}],nativeEvidence:{runId:'run_test',exportDirectory:'native-export'}};
 const launch=()=>{mkdirSync(trial);json(join(trial,'run.json'),run);writeFileSync(join(trial,'timeline.jsonl'),'');now=T0;statusWrite();};
 const timeline=r=>appendFileSync(join(trial,'timeline.jsonl'),JSON.stringify({at:now,...r})+'\n');
 const body=(actor,xz,at=now)=>timeline({kind:'body',actor,soulId:'s_'+actor,source:'here',requestedAt:at,receivedAt:at,me:{pos:xz,posture:'standing'}});
 const recipient=(actor,event,{commit=true}={})=>{const soulId='s_'+actor,seq=seqs.get(soulId)+1;seqs.set(soulId,seq);return native('recipient-event',{soulId,seq,event:{id:'c_'+seq,at:now,tick:seq,...event}},{commit});};
 const poll=async()=>{statusWrite();runner.poll();await runner.settle();return runner.snapshot();};
 const exported=row=>{const dir=join(trial,'native-export');if(!existsSync(dir))mkdirSync(dir);const nativeRow={schema:'continuity-native-row/1',snapshotId:'snapshot',requestedAt:now,observedAt:now,table:'soul_inbox_queue_v1',key:JSON.stringify(['world_test',row.scope,row.owner,row.n]),row,sha256:sha(JSON.stringify(row))},line=JSON.stringify(nativeRow)+'\n';appendFileSync(join(dir,'native-snapshots.jsonl'),line);exportBytes+=Buffer.byteLength(line);exportRows++;json(join(dir,'export-status.json'),{schema:'continuity-native-export/1',runId:'run_test',worldId:'world_test',epoch:'capture_epoch',bytes:exportBytes,rows:exportRows,failure:null});};
 const exportEmpty=()=>{const dir=join(trial,'native-export');mkdirSync(dir);writeFileSync(join(dir,'native-snapshots.jsonl'),'');json(join(dir,'export-status.json'),{schema:'continuity-native-export/1',runId:'run_test',worldId:'world_test',epoch:'capture_epoch',bytes:0,rows:0,failure:null});};
 const finalSources=(sourceStatus='pass')=>{const value={schema:'continuity-native-lifecycle/1',status:sourceStatus,failure:null,coverage:{schema:'continuity-native-coverage/1',status:'pass',runId:'run_test',worldId:'world_test',from:T0,to:run.cutoffAt}};json(join(trial,'native-evidence.json'),value);json(join(trial,'summary.json'),{schema:'sim-continuity-trial-result/1',coverage:{nativeSources:sourceStatus},nativeEvidence:value});};
 return {runner,parent,trial,capture,out,scenario,run,status,sent,failures,native,statusWrite,launch,timeline,body,recipient,poll,exported,exportEmpty,finalSources,setNow:v=>{now=v;},get now(){return now;},row:id=>runner.snapshot().dispatcher?.disturbances[id]};
}

test('preT0 startup observes real common manifest and exact native speech recipient identity',async t=>{
 const f=fixture(t);f.runner.poll();assert.equal(f.runner.snapshot().status,'awaiting-trial-manifest');f.launch();await f.poll();f.setNow(T0+280000);await f.poll();assert.equal(f.sent.length,1);assert.equal(f.row('prestart-interruption').delivered,false);
 f.recipient('presenter',{kind:'speech',saidId:'different',from:{soulId:'s_greeter'},text:f.sent[0].text});await f.poll();assert.equal(f.row('prestart-interruption').delivered,false,'same text/time does not link');
 f.recipient('presenter',{kind:'speech',saidId:'said_prestart-interruption',from:{soulId:'s_greeter'}});await f.poll();assert.equal(f.row('prestart-interruption').delivered,true);assert.equal(f.row('prestart-interruption').deliveryEvents[0].eventId,'c_2');await f.poll();assert.equal(f.sent.length,1);
 f.setNow(f.run.cutoffAt);f.finalSources();f.statusWrite();const done=await f.runner.finish();assert.equal(done.status,'closed');assert.equal(done.nativeSourceStatus,'pass');assert.equal(done.dispatcher.disturbances['prestart-interruption'].delivered,true);
});

test('common releases use instruction hash evidence without a resend or prompt',async t=>{
 const f=fixture(t);f.launch();f.setNow(T0+330000);f.timeline({kind:'actor-release',actor:'attendee-3',scheduledAt:T0+330000,releasedAt:f.now});await f.poll();const row=f.row('late-attendee');assert.equal(row.delivered,true);assert.equal(row.triggerProof.initialInstructionId,'sha256:'+sha('attendee-3'));assert.equal(f.sent.length,0);
});

test('motion comes from native receipt acceptance UTC and current body pairs, never ticks',async t=>{
 const f=fixture(t,'eden-reading-duo');f.launch();f.recipient('reader-a',{kind:'receipt',receipt:{id:'r_journey',capability:'read:here',phase:'waiting',acceptedTick:987654}});f.body('reader-a',[0,0]);await f.poll();
 for(let i=1;i<=6;i++){f.setNow(T0+i*1000);f.body('reader-a',[i,0]);await f.poll();}
 const row=f.row('travel-greeting');assert.equal(f.sent.length,1);assert.equal(row.triggerProof.receiptAcceptedAt,T0);assert.equal(row.triggerProof.motionOnsetAt,T0+1000);assert.equal(row.scheduledAt,T0+6000);
});

test('late native terminal proof invalidates a dispatched motion trigger without resending',async t=>{
 const f=fixture(t,'eden-reading-duo');f.launch();f.recipient('reader-a',{kind:'receipt',receipt:{id:'r_journey',capability:'walk:library',phase:'waiting'}});f.body('reader-a',[0,0]);await f.poll();for(let i=1;i<=6;i++){f.setNow(T0+i*1000);f.body('reader-a',[i,0]);await f.poll();}
 f.setNow(T0+7000);f.recipient('reader-a',{kind:'receipt',at:T0+4000,receipt:{id:'r_journey',capability:'walk:library',phase:'completed'}});await f.poll();assert.equal(f.row('travel-greeting').status,'invalid');assert.ok(f.row('travel-greeting').firstMotionContradiction);assert.equal(f.sent.length,1);
});

test('uncommitted capture suffix is not trusted until status commits its full chain',async t=>{
 const f=fixture(t);f.launch();f.setNow(T0+280000);await f.poll();f.recipient('presenter',{kind:'speech',saidId:'said_prestart-interruption',from:{soulId:'s_greeter'}},{commit:false});f.runner.poll();await f.runner.settle();assert.equal(f.row('prestart-interruption').delivered,false);await f.poll();assert.equal(f.row('prestart-interruption').delivered,true);
});

test('corrupt capture hash or recipient scope suppresses future dispatch with unknown evidence',async t=>{
 const f=fixture(t);f.launch();await f.poll();const line=JSON.parse(readFileSync(join(f.capture,'native-capture.jsonl'),'utf8').trim());line.kind='changed';writeFileSync(join(f.capture,'native-capture.jsonl'),JSON.stringify(line)+'\n');f.setNow(T0+280000);await f.poll();assert.equal(f.runner.snapshot().status,'unknown');assert.equal(f.sent.length,0);
});

test('owner dispatch ACK needs an independent exact scoped native queue row',async t=>{
 const f=fixture(t,'eden-walk-three');f.launch();f.exportEmpty();await f.poll();
 for(let i=0;i<=10;i++){f.setNow(T0+270000+i*1000);for(const actor of ['walker-1','walker-2','walker-3'])f.body(actor,[57,-10]);await f.poll();}
 assert.equal(f.sent.length,1);assert.equal(f.row('independent-errand').delivered,false);
 f.exported({world_id:'world_test',scope:'soul:s_walker-2',owner:'owner_s_walker-2',n:1,id:'message_independent-errand',sent_at:f.now,text:'not used for linkage',acknowledged_at:null});await f.poll();assert.equal(f.row('independent-errand').delivered,true);
 f.exported({world_id:'world_test',scope:'soul:s_walker-2',owner:'owner_s_walker-2',n:1,id:'message_independent-errand',sent_at:f.now,text:'not used for linkage',acknowledged_at:f.now});await f.poll();assert.equal(f.runner.snapshot().status,'observing');assert.equal(f.sent.length,1);
});

test('source polling continues while transport is pending and delivery links after ACK',async t=>{
 let resolveSend;const f=fixture(t,'mars-presentation-four',{worldTransport:request=>new Promise(resolve=>{resolveSend=()=>resolve({status:'accepted',worldId:'world_test',senderSoulId:request.senderSoulId,speechId:'said_pending',evidence:['send#pending']});})});f.launch();f.setNow(T0+280000);f.statusWrite();f.runner.poll();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.sent.length,1);
 f.recipient('presenter',{kind:'speech',saidId:'said_pending',from:{soulId:'s_greeter'}});f.body('presenter',[0,0]);f.statusWrite();f.runner.poll();assert.ok(f.runner.snapshot().sourceCounts.timeline>0);assert.equal(f.row('prestart-interruption').delivered,false);resolveSend();await f.runner.settle();assert.equal(f.row('prestart-interruption').delivered,true);
});

test('partial UTF8 source tails wait safely, while truncated final tails stay unknown',async t=>{
 const f=fixture(t);f.launch();await f.poll();const line=Buffer.from(JSON.stringify({kind:'unrelated',text:'cat 🐈'})+'\n'),at=line.indexOf(Buffer.from('🐈'))+2;
 appendFileSync(join(f.trial,'timeline.jsonl'),line.subarray(0,at));await f.poll();assert.equal(f.runner.snapshot().status,'observing');appendFileSync(join(f.trial,'timeline.jsonl'),line.subarray(at));await f.poll();assert.equal(f.runner.snapshot().status,'observing');appendFileSync(join(f.trial,'timeline.jsonl'),'{');f.setNow(f.run.cutoffAt);f.finalSources();f.statusWrite();assert.equal((await f.runner.finish()).status,'unknown');assert.equal(f.sent.length,0);
});

test('wrong common manifest identity and mutation never start a transport',async t=>{
 const wrong=fixture(t);wrong.launch();wrong.run.worldId='another';json(join(wrong.trial,'run.json'),wrong.run);wrong.setNow(T0+280000);await wrong.poll();assert.equal(wrong.runner.snapshot().failure.code,'TRIAL_MANIFEST_SCOPE_MISMATCH');assert.equal(wrong.sent.length,0);
 const changed=fixture(t);changed.launch();await changed.poll();changed.run.cutoffAt++;json(join(changed.trial,'run.json'),changed.run);changed.setNow(T0+280000);await changed.poll();assert.equal(changed.runner.snapshot().failure.code,'TRIAL_MANIFEST_CHANGED');assert.equal(changed.sent.length,0);
});

test('finish requires authoritative common native lifecycle/summary, not stale export coverage',async t=>{
 const f=fixture(t);f.launch();await f.poll();f.setNow(f.run.cutoffAt);f.finalSources('unknown');f.statusWrite();const result=await f.runner.finish();assert.equal(result.status,'unknown');assert.equal(result.failure.code,'COMMON_NATIVE_SOURCE_COVERAGE_UNKNOWN');assert.equal(f.sent.length,0);
});

test('automatic poll is bounded to500ms, and finish cancels without dispatching a due late event',async t=>{
 const scheduled=[],cancelled=[];const f=fixture(t,'mars-presentation-four',{pollMs:500,schedule:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;},cancel:id=>cancelled.push(id)});f.runner.start();assert.equal(scheduled[0].ms,500);f.launch();f.setNow(T0+280000);const result=await f.runner.finish();assert.equal(f.sent.length,0);assert.equal(result.status,'unknown');assert.ok(cancelled.length>0);scheduled[0].fn();assert.equal(f.sent.length,0);
});


test('atomic status replacement retries an unlinked descriptor and reads only a bounded coherent snapshot',t=>{
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'continuity-json-replace-')));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const path=join(parent,'capture-status.json');json(path,{generation:1});let replaced=false,opened=0,closed=0;
 const replace=()=>{if(replaced)return;replaced=true;json(path+'.tmp',{generation:2});sourceFs.renameSync(path+'.tmp',path);};
 const io={...sourceFs,
  lstatSync:p=>{const stat=sourceFs.lstatSync(p);replace();return {...stat,nlink:0,isFile:()=>true,isSymbolicLink:()=>false};},
  openSync:(p,flags)=>{const fd=sourceFs.openSync(p,flags);opened++;replace();return fd;},
  closeSync:fd=>{closed++;sourceFs.closeSync(fd);},
 };
 assert.deepEqual(readDisturbanceJson(path,{},io),{generation:2});
 assert.equal(opened,2,'one bounded retry after actual atomic replacement');assert.equal(closed,opened,'all source descriptors close');
});


test('JSON reader refuses symlink/hardlink/oversize and preserves typed bounded source facts',t=>{
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'continuity-json-unsafe-')));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const path=join(parent,'capture-status.json'),target=join(parent,'target.json');json(target,{safe:'not a permission to follow'});
 sourceFs.symlinkSync(target,path);
 assert.throws(()=>readDisturbanceJson(path),error=>error.code==='DISTURBANCE_SOURCE_UNSAFE'&&error.sourceFacts.source==='capture-status.json'&&error.sourceFacts.check==='open'&&error.sourceFacts.errno==='ELOOP');
 sourceFs.unlinkSync(path);sourceFs.linkSync(target,path);
 assert.throws(()=>readDisturbanceJson(path),error=>error.code==='DISTURBANCE_SOURCE_UNSAFE'&&error.sourceFacts.nlink===2&&error.sourceFacts.attempt===1);
 sourceFs.unlinkSync(path);json(path,{long:'x'.repeat(100)});
 assert.throws(()=>readDisturbanceJson(path,{maxBytes:16}),error=>error.code==='DISTURBANCE_SOURCE_UNSAFE'&&error.sourceFacts.bytes>16);
 assert.equal(readDisturbanceJson(join(parent,'absent.json'),{optional:true}),null);
 writeFileSync(path,'{"partial":');assert.equal(readDisturbanceJson(path,{partial:true}),null);
 assert.throws(()=>readDisturbanceJson(path),error=>error.code==='DISTURBANCE_SOURCE_JSON_INVALID'&&error.sourceFacts.check==='json-parse');
});

test('persistent unlinked/changed sources exhaust three attempts, close every FD and remain unsafe',t=>{
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'continuity-json-exhaust-')));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const path=join(parent,'capture-status.json');json(path,{generation:1});let opened=0,closed=0;const retries=[];
 const io={...sourceFs,openSync:(...args)=>{opened++;return sourceFs.openSync(...args);},closeSync:fd=>{closed++;sourceFs.closeSync(fd);},fstatSync:fd=>Object.assign(sourceFs.fstatSync(fd),{nlink:0})};
 assert.throws(()=>readDisturbanceJson(path,{onRetry:e=>retries.push(e)},io),error=>error.code==='DISTURBANCE_SOURCE_UNSAFE'&&error.sourceFacts.check==='unlinked-before-read'&&error.sourceFacts.attempt===3);
 assert.equal(opened,3);assert.equal(closed,3);assert.equal(retries.length,2);
});

test('JSON read remains byte-bounded if a source grows after its initial fstat',t=>{
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'continuity-json-grow-')));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const path=join(parent,'capture-status.json');json(path,{n:1});let grown=false,total=0,closed=0;
 const io={...sourceFs,readSync:(fd,buf,offset,length,position)=>{if(!grown){grown=true;appendFileSync(path,'x'.repeat(1024));}const n=sourceFs.readSync(fd,buf,offset,length,position);total+=n;return n;},closeSync:fd=>{closed++;sourceFs.closeSync(fd);}};
 assert.throws(()=>readDisturbanceJson(path,{maxBytes:32},io),error=>error.code==='DISTURBANCE_SOURCE_UNSAFE'&&error.sourceFacts.check==='read-size');
 assert.equal(total,33);assert.equal(closed,1);
});

test('runner retains exact source failure metadata without raw path/content and suppresses later sends',async t=>{
 const f=fixture(t);f.launch();await f.poll();const path=join(f.capture,'capture-status.json');sourceFs.renameSync(path,path+'.saved');sourceFs.symlinkSync(path+'.saved',path);
 f.setNow(T0+280000);f.runner.poll();await f.runner.settle();const failed=f.runner.snapshot().failure;
 assert.equal(failed.code,'DISTURBANCE_SOURCE_UNSAFE');assert.deepEqual(failed.sourceFacts,{source:'capture-status.json',check:'open',attempt:1,errno:'ELOOP'});assert.equal(failed.at,T0+280000);assert.equal(f.sent.length,0);assert.deepEqual(f.failures,[failed]);
 assert.ok(!JSON.stringify(failed).includes(f.parent));assert.deepEqual(JSON.parse(readFileSync(join(f.out,'disturbances.json'),'utf8')).failure,failed);
});


test('nonregular FIFO source cannot block open before regular-file safety validation',t=>{
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'continuity-json-fifo-')));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const path=join(parent,'capture-status.json');execFileSync('mkfifo',[path]);let closed=0;
 const io={...sourceFs,openSync:(p,flags)=>{assert.ok(flags&sourceFs.constants.O_NONBLOCK);return sourceFs.openSync(p,flags);},closeSync:fd=>{closed++;sourceFs.closeSync(fd);}};
 assert.throws(()=>readDisturbanceJson(path,{},io),error=>error.code==='DISTURBANCE_SOURCE_UNSAFE'&&error.sourceFacts.check==='initial-file-type-links-or-size');assert.equal(closed,1);
});

test('a slow pre-T0 settle gate can be covered by a longer manifest wait; absence still fails after it',async t=>{
 const slow=fixture(t,'mars-presentation-four',{manifestWaitMs:180000});slow.setNow(slow.now+170000);slow.statusWrite();slow.runner.poll();assert.equal(slow.runner.snapshot().status,'awaiting-trial-manifest');assert.deepEqual(slow.failures,[]);
 const missing=fixture(t,'mars-presentation-four',{manifestWaitMs:180000});missing.setNow(missing.now+180001);missing.statusWrite();missing.runner.poll();assert.equal(missing.runner.snapshot().status,'unknown');assert.match(JSON.stringify(missing.failures),/TRIAL_MANIFEST_MISSING/);
});

test('one stale capture heartbeat reading stays pending; a newer heartbeat on the next poll clears it',async t=>{
 const f=fixture(t);f.launch();await f.poll();
 f.setNow(T0+5100);f.runner.poll();await f.runner.settle();assert.equal(f.failures.length,0,'a single over-bound reading does not cancel the trial');assert.equal(f.runner.snapshot().capture.heartbeatPending,1);
 f.setNow(T0+5350);await f.poll();assert.equal(f.failures.length,0);assert.equal(f.runner.snapshot().status,'observing');
 f.setNow(T0+10450);f.runner.poll();await f.runner.settle();assert.equal(f.failures.length,0,'a later stall gets its own confirmation poll');assert.equal(f.runner.snapshot().capture.heartbeatPending,2);
 const events=readFileSync(join(f.out,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(e=>e.kind==='capture-heartbeat-pending');assert.deepEqual(events.map(e=>[e.heartbeatAt,e.ageMs]),[[T0,5100],[T0+5350,5100]]);
});
test('the next poll still showing no newer heartbeat past maxHeartbeatGapMs+pollMs faults',async t=>{
 const f=fixture(t);f.launch();await f.poll();
 f.setNow(T0+5100);f.runner.poll();await f.runner.settle();assert.equal(f.failures.length,0);
 f.setNow(T0+5200);f.runner.poll();await f.runner.settle();assert.equal(f.failures.length,0,'still within the confirmation bound');
 f.setNow(T0+5251);f.runner.poll();await f.runner.settle();assert.equal(f.failures.length,1);assert.equal(f.failures[0].code,'NATIVE_CAPTURE_SCOPE_OR_HEALTH');
});
test('the writer\'s sticky heartbeat failure still faults on the first reading',async t=>{
 const f=fixture(t);f.launch();await f.poll();
 f.setNow(T0+1000);Object.assign(f.status,{healthy:false,failure:{code:'CAPTURE_HEARTBEAT_GAP'}});f.statusWrite();f.runner.poll();await f.runner.settle();assert.equal(f.failures.length,1);assert.equal(f.failures[0].code,'NATIVE_CAPTURE_SCOPE_OR_HEALTH');
});
test('garden-pool-v2 runner refuses an undeclared fixture version',t=>{
 assert.throws(()=>fixture(t,'eden-walk-three',{undeclared:true}),{code:'FIXTURE_VERSION_UNDECLARED'});
});
