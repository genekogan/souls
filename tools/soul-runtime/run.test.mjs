import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,statSync,symlinkSync,linkSync,chmodSync,fsyncSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openJournal} from './journal.mjs';
import {main,claimStartupLease,openEvidenceRecorder} from './run.mjs';
test('different task-state directories cannot start two controllers for the same paired folder',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'sim-run-'));
 writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:1/w/test',soul:'test-soul',token:'synthetic-test-only'}),{mode:0o600});
 const lock=openJournal(join(folder,'.soul-runtime-owner'),{worldId:'test-world',soulId:'test-soul'}),owner=lock.control.claim();t.after(()=>{lock.control.release(owner);lock.close();rmSync(folder,{recursive:true,force:true});});
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({worldId:'test-world'});t.after(()=>{globalThis.fetch=original;});
 await assert.rejects(main(['--folder',folder,'--state',join(folder,'different-state'),'--seconds','1'],{leaseWaitMs:20}),{code:'CONTROLLER_BUSY_TIMEOUT'});
 lock.control.assertOwner(owner);assert.equal(existsSync(join(folder,'different-state','host')),false);
 assert.equal(JSON.parse(readFileSync(join(folder,'different-state','status.json'),'utf8')).state,'blocked');
});
test('startup waits for an abandoned lease to expire before acquiring the next generation',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-startup-'));let time=1000;
 const journal=openJournal(directory,{worldId:'w',soulId:'s',now:()=>time});t.after(()=>{journal.close();rmSync(directory,{recursive:true,force:true});});
 const old=journal.control.claim('dead',1000),waits=[];
 const owner=await claimStartupLease(journal.control,{now:()=>time,maxWaitMs:2000,sleep:async ms=>{time+=ms;},onWait:s=>waits.push(s)});
 assert.equal(time,old.expiresAt);assert.equal(owner.generation,old.generation+1);journal.control.assertOwner(owner);assert.equal(waits.length,1);
});
test('startup retry is bounded while an existing controller continues renewing',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-startup-'));let time=1000;
 const journal=openJournal(directory,{worldId:'w',soulId:'s',now:()=>time});t.after(()=>{journal.close();rmSync(directory,{recursive:true,force:true});});
 let owner=journal.control.claim('live',1000);
 await assert.rejects(claimStartupLease(journal.control,{now:()=>time,maxWaitMs:2000,sleep:async ms=>{time+=ms;owner=journal.control.renew(owner,1000);}}),{code:'CONTROLLER_BUSY_TIMEOUT'});
 assert.equal(time,3000);journal.control.assertOwner(owner);assert.equal(owner.generation,1);
});
test('abort during startup lease waiting closes setup and leaves the live owner untouched',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'sim-run-')),state=join(folder,'different-state');
 writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:1/w/test',soul:'test-soul',token:'synthetic-test-only'}),{mode:0o600});
 const lock=openJournal(join(folder,'.soul-runtime-owner'),{worldId:'test-world',soulId:'test-soul'}),owner=lock.control.claim();t.after(()=>{lock.control.release(owner);lock.close();rmSync(folder,{recursive:true,force:true});});
 const stop=new AbortController(),original=globalThis.fetch;let timer;
 globalThis.fetch=async()=>{timer=setTimeout(()=>stop.abort(),10);return Response.json({worldId:'test-world'});};t.after(()=>{clearTimeout(timer);globalThis.fetch=original;});
 const listeners=['SIGINT','SIGTERM'].map(s=>process.listenerCount(s));
 await main(['--folder',folder,'--state',state],{signal:stop.signal});
 assert.equal(stop.signal.aborted,true);lock.control.assertOwner(owner);assert.equal(existsSync(join(state,'host')),false);
 assert.equal(JSON.parse(readFileSync(join(state,'status.json'),'utf8')).state,'stopped');
 assert.deepEqual(['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)),listeners);
 const reopened=openJournal(state,{worldId:'test-world',soulId:'test-soul'});reopened.close();
});
test('startup setup failure removes signal handlers and releases an acquired ownership lease',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'sim-run-')),state=join(folder,'state');
 writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:1/w/test',soul:'test-soul',token:'synthetic-test-only'}),{mode:0o600});
 const journal=openJournal(state,{worldId:'test-world',soulId:'test-soul'});journal.close();writeFileSync(join(state,'host'),'not a directory');
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({worldId:'test-world'});t.after(()=>{globalThis.fetch=original;rmSync(folder,{recursive:true,force:true});});
 const listeners=['SIGINT','SIGTERM'].map(s=>process.listenerCount(s));
 await assert.rejects(main(['--folder',folder,'--state',state]),{code:'EEXIST'});
 assert.deepEqual(['SIGINT','SIGTERM'].map(s=>process.listenerCount(s)),listeners);
 const ownership=openJournal(join(folder,'.soul-runtime-owner'),{worldId:'test-world',soulId:'test-soul'}),owner=ownership.control.claim('after-failure');ownership.control.release(owner);ownership.close();
});
test('initial instruction limit counts JSON encoding and rejects escape expansion before starting a host',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'sim-run-instruction-')),instruction=join(folder,'instruction.txt');
 writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:1/w/test',soul:'test-soul',token:'synthetic-test-only'}),{mode:0o600});
 const lock=openJournal(join(folder,'.soul-runtime-owner'),{worldId:'test-world',soulId:'test-soul'}),owner=lock.control.claim();
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({worldId:'test-world'});t.after(()=>{globalThis.fetch=original;lock.control.release(owner);lock.close();rmSync(folder,{recursive:true,force:true});});
 writeFileSync(instruction,'i'.repeat(15998));await assert.rejects(main(['--folder',folder,'--instruction',instruction],{leaseWaitMs:0}),{code:'CONTROLLER_BUSY_TIMEOUT'});
 writeFileSync(instruction,'\n'.repeat(8000));await assert.rejects(main(['--folder',folder,'--instruction',instruction],{leaseWaitMs:0}),/Initial instruction exceeds16000 JSON-encoded bytes/);
 writeFileSync(instruction,'界'.repeat(5333));await assert.rejects(main(['--folder',folder,'--instruction',instruction],{leaseWaitMs:0}),/Initial instruction exceeds16000 JSON-encoded bytes/);
 assert.equal(existsSync(join(folder,'.soul-runtime','host')),false);lock.control.assertOwner(owner);
});
test('opt-in evidence preserves read returns/errors and receivers without recording credentials or arguments',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-evidence-')),file=join(directory,'agent-evidence.jsonl');t.after(()=>rmSync(directory,{recursive:true,force:true}));let clock=100,calls=0,syncs=0;
 const recorder=openEvidenceRecorder(file,{scope:{worldId:'world-native',soulId:'soul-native'},now:()=>++clock,syncFile:fd=>{syncs++;fsyncSync(fd);}}),native={body:'LOCAL_RESPONSE_ONLY'},refusal=Object.assign(Error('CREDENTIAL_CANARY in error message'),{code:'not-found',status:404,config:'CREDENTIAL_CANARY'}),args={token:'CREDENTIAL_CANARY'},signal=new AbortController().signal;
 const world={async read(command,receivedArgs,receivedSignal){assert.equal(this,world);assert.equal(receivedArgs,args);assert.equal(receivedSignal,signal);calls++;if(command==='object')throw refusal;return native;},ownerPage:async()=>({events:[]}),worldPage:async()=>({events:[]}),write:async()=>({accepted:true})};
 const wrapped=recorder.wrapWorld(world);assert.equal(wrapped.ownerPage,world.ownerPage);assert.equal(wrapped.worldPage,world.worldPage);assert.equal(wrapped.write,world.write);assert.equal(await wrapped.read('observe',args,signal),native);await assert.rejects(wrapped.read('object',args,signal),error=>error===refusal);await wrapped.ownerPage();await wrapped.worldPage();assert.equal(calls,2);assert.equal(syncs,0,'no per-row fsync in measured path');recorder.close();assert.equal(syncs,1);
 const raw=readFileSync(file,'utf8'),rows=raw.trim().split('\n').map(JSON.parse),reads=rows.filter(r=>r.kind==='world-read');assert.equal(reads.length,2);assert.deepEqual(reads[0].response,native);assert.deepEqual(reads[1].error,{code:'not-found',status:404});assert.equal(reads[1].response,undefined);assert.ok(reads.every(r=>r.origin==='agent'&&r.requestedAt<r.receivedAt));assert.ok(rows.every(r=>r.worldId==='world-native'&&r.soulId==='soul-native'));assert.ok(!raw.includes('CREDENTIAL_CANARY'));assert.equal(statSync(file).mode&0o777,0o600);
 chmodSync(file,0o644);const before=raw,second=openEvidenceRecorder(file,{scope:{worldId:'world-native',soulId:'soul-native'}});second.close();assert.ok(readFileSync(file,'utf8').startsWith(before));assert.equal(statSync(file).mode&0o777,0o600);const sessions=readFileSync(file,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.kind==='evidence-session'&&r.state==='started');assert.equal(sessions.length,2);assert.notEqual(sessions[0].sessionId,sessions[1].sessionId);
});
test('evidence records every selected host event with observed model/thread and no turn output or config',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-evidence-host-')),file=join(directory,'agent-evidence.jsonl');t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const recorder=openEvidenceRecorder(file,{scope:{worldId:'w',soulId:'s'}}),host=new EventEmitter(),connected={threadId:'thread-actual',model:'model-actual'},options={config:{secret:'CONFIG_CANARY'}};host.pid=4242;host.model='requested-alias';host.connect=async function(received){assert.equal(received,options);this.threadId='thread-actual';return connected;};const original=host.connect;
 recorder.bindHost(host);assert.equal(await host.connect(options),connected);
 host.emit('event',{method:'turn/started',params:{threadId:'thread-actual',turn:{id:'turn-1',status:'inProgress',items:[{text:'OUTPUT_CANARY'}]}},receivedAt:123});
 const usage={total:{inputTokens:12,outputTokens:4,cachedInputTokens:3},last:{inputTokens:8,outputTokens:4}};host.emit('event',{method:'thread/tokenUsage/updated',params:{threadId:'thread-actual',turnId:'turn-1',tokenUsage:usage},receivedAt:124});
 host.emit('event',{method:'item/completed',params:{item:{text:'OUTPUT_CANARY'}}});host.emit('event',{method:'turn/completed',params:{threadId:'thread-actual',turn:{id:'turn-1',status:'completed',error:{code:'native-error',message:'CONFIG_CANARY'},items:[{text:'OUTPUT_CANARY'}]}},receivedAt:125});recorder.close();assert.equal(host.connect,original);assert.equal(host.listenerCount('event'),0);
 const raw=readFileSync(file,'utf8'),events=raw.trim().split('\n').map(JSON.parse).filter(r=>r.kind==='host-event');assert.deepEqual(events.map(r=>r.method),['turn/started','thread/tokenUsage/updated','turn/completed']);assert.deepEqual(events.map(r=>r.at),[123,124,125]);assert.ok(events.every(r=>r.model==='model-actual'&&r.threadId==='thread-actual'&&r.turnId==='turn-1'));assert.deepEqual(events[1].tokenUsage,usage);assert.deepEqual(events[2].error,{code:'native-error',status:null});assert.ok(!raw.includes('OUTPUT_CANARY'));assert.ok(!raw.includes('CONFIG_CANARY'));assert.ok(!raw.includes('requested-alias'));
});
test('host item and unsupported-request evidence is bounded metadata without content or unknown labels',t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-evidence-items-')),file=join(directory,'evidence.jsonl');t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const recorder=openEvidenceRecorder(file,{now:()=>300}),host=new EventEmitter();host.pid=42;host.threadId='thread-1';host.activeTurnId='turn-1';host.connect=async()=>({});recorder.bindHost(host);
 const secret='PRIVATE_ITEM_CANARY',item={id:'item-1',type:'reasoning',text:secret,summary:[secret],content:[secret],command:secret,output:secret,arguments:secret,config:secret};
 for(const method of ['item/started','item/completed'])host.emit('event',{method,receivedAt:100,params:{threadId:'thread-1',turnId:'turn-1',item,model:secret}});
 host.emit('event',{method:'item/completed',receivedAt:101,params:{threadId:'x'.repeat(201),turnId:secret+'\n',item:{id:'x'.repeat(201),type:secret,text:secret}}});
 host.emit('unsupportedRequest',{method:'item/tool/call',arguments:secret});host.emit('unsupportedRequest',{method:secret});host.emit('unsupportedRequest',{method:'x'.repeat(100000)});recorder.close();
 assert.equal(host.listenerCount('event'),0);assert.equal(host.listenerCount('unsupportedRequest'),0);
 const raw=readFileSync(file,'utf8'),rows=raw.trim().split('\n').map(JSON.parse),items=rows.filter(r=>r.kind==='host-item'),requests=rows.filter(r=>r.kind==='host-unsupported-request');
 assert.equal(items.length,3);assert.deepEqual(items.slice(0,2).map(r=>[r.method,r.at,r.itemId,r.itemType,r.threadId,r.turnId]),[['item/started',100,'item-1','reasoning','thread-1','turn-1'],['item/completed',100,'item-1','reasoning','thread-1','turn-1']]);
 assert.equal(items[2].itemId,null);assert.equal(items[2].itemType,'unknown');assert.equal(items[2].threadId,null);assert.equal(items[2].turnId,null);
 assert.deepEqual(requests.map(r=>r.method),['item/tool/call','unknown','unknown']);assert.ok([...items,...requests].every(r=>Buffer.byteLength(JSON.stringify(r))<1024));assert.ok(!raw.includes(secret));assert.ok(!raw.includes('x'.repeat(201)));
});
test('host RPC evidence times ACK without waiting for completion or changing arguments, results or errors',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-evidence-rpc-')),file=join(directory,'evidence.jsonl');t.after(()=>rmSync(directory,{recursive:true,force:true}));let clock=100,ack,beginCalls=0,steerCalls=0;
 const recorder=openEvidenceRecorder(file,{now:()=>clock}),host=new EventEmitter(),prompt='PROMPT_PRIVATE_CANARY 界',options={outputSchema:{private:'SCHEMA_PRIVATE_CANARY'}},completed=new Promise(()=>{}),result={turnId:'turn-1',completed},refusal=Object.assign(Error('ERROR_PRIVATE_CANARY'),{code:'ERROR_PRIVATE_CANARY'}),steered={accepted:true,private:'RESULT_PRIVATE_CANARY'};
 host.threadId='thread-1';host.activeTurnId='turn-1';host.connect=async()=>({});
 host.begin=async function(text,args){assert.equal(this,host);assert.equal(text,prompt);assert.equal(args,options);beginCalls++;return new Promise(resolve=>{ack=()=>resolve(result);});};
 host.steer=async function(text,id){assert.equal(this,host);assert.equal(text,prompt);assert.equal(id,'turn-1');if(++steerCalls===2)throw refusal;return steered;};const originals={begin:host.begin,steer:host.steer};recorder.bindHost(host);
 const starting=host.begin(prompt,options);assert.equal(ack instanceof Function,true);assert.equal(readFileSync(file,'utf8').includes('host-rpc'),false,'no premature ACK or input payload record');clock=250;ack();assert.equal(await starting,result);assert.equal(result.completed,completed);
 clock=300;assert.equal(await host.steer(prompt,'turn-1'),steered);clock=400;await assert.rejects(host.steer(prompt,'turn-1'),error=>error===refusal);recorder.close();assert.equal(host.begin,originals.begin);assert.equal(host.steer,originals.steer);assert.equal(beginCalls,1);assert.equal(steerCalls,2);
 const raw=readFileSync(file,'utf8'),rows=raw.trim().split('\n').map(JSON.parse).filter(r=>r.kind==='host-rpc');assert.deepEqual(rows.map(r=>[r.operation,r.status]),[['begin','acknowledged'],['steer','acknowledged'],['steer','rejected']]);assert.equal(rows[0].requestedAt,100);assert.equal(rows[0].acknowledgedAt,250);assert.equal(rows[2].failedAt,400);assert.ok(rows.every(r=>r.turnId==='turn-1'&&r.promptBytes===Buffer.byteLength(prompt)&&r.durationMs>=0));assert.ok(!raw.includes('PRIVATE_CANARY'));
});
test('host error notifications retain only verified retry/category/HTTP metadata, never error text',t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-evidence-error-')),file=join(directory,'evidence.jsonl');t.after(()=>rmSync(directory,{recursive:true,force:true}));const secret='ERROR_TEXT_CANARY';
 const recorder=openEvidenceRecorder(file),host=new EventEmitter();host.threadId='thread-1';host.connect=async()=>({});recorder.bindHost(host);
 const notify=(info,willRetry=true)=>host.emit('event',{method:'error',receivedAt:123,params:{threadId:'thread-1',turnId:'turn-1',willRetry,model:secret,error:{message:secret,additionalDetails:secret,code:secret,codexErrorInfo:info}}});
 for(const category of ['contextWindowExceeded','sessionBudgetExceeded','usageLimitExceeded','rateLimitExceeded','flexUnavailable','serverOverloaded','cyberPolicy','misalignmentPolicyViolation','tooManyDenials','internalServerError','unauthorized','badRequest','threadRollbackFailed','sandboxError','other'])notify(category);
 for(const category of ['httpConnectionFailed','responseStreamConnectionFailed','responseStreamDisconnected','responseTooManyFailedAttempts'])notify({[category]:{httpStatusCode:429,message:secret,additionalDetails:secret}});
 notify({responseTooManyFailedAttempts:{httpStatusCode:secret}});notify({activeTurnNotSteerable:{turnKind:'review',message:secret}},false);notify({activeTurnNotSteerable:{turnKind:'compact'}});notify({activeTurnNotSteerable:{turnKind:secret}});notify(secret);notify({[secret]:{httpStatusCode:500}});notify({httpConnectionFailed:{httpStatusCode:500},[secret]:1},secret);notify(null);recorder.close();
 const raw=readFileSync(file,'utf8'),rows=raw.trim().split('\n').map(JSON.parse).filter(r=>r.kind==='host-error');assert.equal(rows.length,27);assert.ok(rows.every(r=>r.method==='error'&&r.threadId==='thread-1'&&r.turnId==='turn-1'&&r.at===123));assert.deepEqual(rows.slice(15,19).map(r=>r.error.httpStatusCode),[429,429,429,429]);assert.equal(rows[19].error.httpStatusCode,null);assert.deepEqual(rows[20].error,{category:'activeTurnNotSteerable',turnKind:'review'});assert.equal(rows[20].willRetry,false);assert.equal(rows[21].error.turnKind,'compact');assert.equal(rows[22].error.turnKind,null);assert.ok(rows.slice(23).every(r=>r.error.category==='unknown'));assert.equal(rows[25].willRetry,null);assert.ok(!raw.includes(secret));assert.ok(!raw.includes('additionalDetails'));assert.ok(!raw.includes('message'));
});
test('required evidence: RPC write failure is sticky but preserves an already acknowledged result and original rejection',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-evidence-rpc-fail-')),file=join(directory,'evidence.jsonl');t.after(()=>rmSync(directory,{recursive:true,force:true}));let failures=0;
 const recorder=openEvidenceRecorder(file,{required:true,onFailure:()=>failures++,writeRecord:(fd,data)=>{if(data.includes('host-rpc'))throw Error('disk failure');writeFileSync(fd,data);}}),host=new EventEmitter(),result={turnId:'turn-1',completed:new Promise(()=>{})},error=Error('original refusal');host.connect=async()=>({});host.begin=async()=>result;host.steer=async()=>{throw error;};recorder.bindHost(host);
 assert.equal(await host.begin('private'),result);await assert.rejects(host.steer('private','turn-1'),actual=>actual===error);assert.equal(failures,1);assert.equal(recorder.failure.code,'EVIDENCE_IO');assert.throws(()=>recorder.close(),{code:'EVIDENCE_IO'});
});
test('evidence refuses linked/nonregular targets; required evidence reports write/sync failures by throwing',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-evidence-fail-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const target=join(directory,'target'),link=join(directory,'link'),hard=join(directory,'hard');writeFileSync(target,'UNTOUCHED');symlinkSync(target,link);linkSync(target,hard);
 for(const path of [link,hard,directory])assert.throws(()=>openEvidenceRecorder(path),{code:'EVIDENCE_IO'});assert.equal(readFileSync(target,'utf8'),'UNTOUCHED');
 let failWrites=false,failures=0,reads=0;const file=join(directory,'write-failure.jsonl'),recorder=openEvidenceRecorder(file,{required:true,onFailure:()=>failures++,writeRecord:(fd,data)=>{if(failWrites)throw Object.assign(Error('disk full'),{code:'ENOSPC'});writeFileSync(fd,data);}}),wrapped=recorder.wrapWorld({read:async()=>{reads++;return {native:true}}});failWrites=true;
 await assert.rejects(wrapped.read('observe',{}),{code:'EVIDENCE_IO'});await assert.rejects(wrapped.read('observe',{}),{code:'EVIDENCE_IO'});assert.equal(reads,1);assert.equal(failures,1);assert.throws(()=>recorder.close(),{code:'EVIDENCE_IO'});assert.ok(!readFileSync(file,'utf8').includes('"state":"closed"'));
 const hostFile=join(directory,'host-failure.jsonl');let hostFailure;const hostRecorder=openEvidenceRecorder(hostFile,{required:true,onFailure:e=>{hostFailure=e;},writeRecord:(fd,data)=>{if(data.includes('host-event'))throw Error('write failed');writeFileSync(fd,data);}}),host=new EventEmitter();host.connect=async()=>({model:'actual'});hostRecorder.bindHost(host);host.emit('event',{method:'turn/started',params:{turn:{id:'turn-1'}}});assert.equal(hostFailure.code,'EVIDENCE_IO');assert.throws(()=>hostRecorder.close(),{code:'EVIDENCE_IO'});
 const syncRecorder=openEvidenceRecorder(join(directory,'sync-failure.jsonl'),{required:true,syncFile:()=>{throw Error('flush failed')}});assert.throws(()=>syncRecorder.close(),{code:'EVIDENCE_IO'});
});
test('--evidence appends scoped lifecycle records across failed startups without stdout payloads or extra world calls',async t=>{
 const folder=mkdtempSync(join(tmpdir(),'sim-run-evidence-')),file=join(folder,'agent-evidence.jsonl');writeFileSync(join(folder,'.eden-agent.json'),JSON.stringify({world:'http://127.0.0.1:1/w/test',soul:'test-soul',token:'CREDENTIAL_CANARY'}),{mode:0o600});
 const lock=openJournal(join(folder,'.soul-runtime-owner'),{worldId:'test-world',soulId:'test-soul'}),owner=lock.control.claim();let calls=0;const fetch=globalThis.fetch,log=console.log,stdout=[];globalThis.fetch=async url=>{calls++;assert.ok(url.endsWith('/v1/config'));return Response.json({worldId:'test-world',privateConfig:'CONFIG_CANARY'});};console.log=text=>stdout.push(text);t.after(()=>{globalThis.fetch=fetch;console.log=log;lock.control.release(owner);lock.close();rmSync(folder,{recursive:true,force:true});});
 for(let attempt=0;attempt<2;attempt++)await assert.rejects(main(['--folder',folder,'--evidence',file],{leaseWaitMs:0}),{code:'CONTROLLER_BUSY_TIMEOUT'});
 assert.equal(calls,2);const raw=readFileSync(file,'utf8'),rows=raw.trim().split('\n').map(JSON.parse);assert.deepEqual(rows.map(r=>r.state),['started','closed','started','closed']);assert.ok(rows.every(r=>r.worldId==='test-world'&&r.soulId==='test-soul'));assert.ok(rows.filter(r=>r.state==='closed').every(r=>r.failed));assert.ok(!raw.includes('CREDENTIAL_CANARY')&&!raw.includes('CONFIG_CANARY'));assert.ok(!stdout.join('').includes('CREDENTIAL_CANARY')&&!stdout.join('').includes('CONFIG_CANARY'));assert.equal(existsSync(join(folder,'.soul-runtime','host')),false);lock.control.assertOwner(owner);
 const closedLines=stdout.filter(l=>String(l).includes('controller-closed'));assert.equal(closedLines.length,2);assert.ok(closedLines.every(l=>JSON.parse(l).evidence?.complete===true),'controller-closed reports the evidence outcome');
 await assert.rejects(main(['--folder',folder,'--evidence-required'],{leaseWaitMs:0}),/--evidence-required needs --evidence/);
});
test('default evidence (#733 A4): a failed sink disables recording and never changes world reads, host calls or the run',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'sim-evidence-open-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 let failWrites=false,failures=0,reads=0;const file=join(directory,'evidence.jsonl');
 const recorder=openEvidenceRecorder(file,{onFailure:()=>failures++,writeRecord:(fd,data)=>{if(failWrites)throw Object.assign(Error('disk full'),{code:'ENOSPC'});writeFileSync(fd,data);}});
 const worldError=Object.assign(Error('world refused'),{code:'soul.busy'});
 const wrapped=recorder.wrapWorld({read:async cmd=>{reads++;if(cmd==='fail')throw worldError;return {native:reads}}});
 failWrites=true;
 assert.deepEqual(await wrapped.read('observe',{}),{native:1},'the world response survives the failed write');
 assert.deepEqual(await wrapped.read('observe',{}),{native:2},'later reads still reach the world');
 await assert.rejects(wrapped.read('fail',{}),e=>e===worldError,'the world error is passed through unchanged');
 assert.equal(reads,3);assert.equal(failures,1,'one notice, sticky');assert.equal(recorder.failure.code,'EVIDENCE_IO');
 const host=new EventEmitter(),result={turnId:'turn-1'};host.connect=async()=>({model:'m'});host.begin=async()=>result;host.steer=async()=>({ok:true});recorder.bindHost(host);
 assert.deepEqual(await host.connect(),{model:'m'});assert.equal(await host.begin('private'),result);assert.deepEqual(await host.steer('private','turn-1'),{ok:true});
 host.emit('event',{method:'turn/started',params:{turn:{id:'turn-1'}}});
 const summary=recorder.close();
 assert.equal(summary.complete,false);assert.equal(summary.code,'EVIDENCE_IO');assert.ok(summary.dropped>=5,String(summary.dropped));
 assert.deepEqual(recorder.close(),summary,'closing twice is quiet');
 assert.ok(!readFileSync(file,'utf8').includes('"state":"closed"'),'an incomplete file has no closed row');
 const ok=openEvidenceRecorder(join(directory,'ok.jsonl'));assert.deepEqual(ok.close(),{complete:true});
 const syncFail=openEvidenceRecorder(join(directory,'sync.jsonl'),{syncFile:()=>{throw Error('flush failed')}});assert.equal(syncFail.close().complete,false);
});
