import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {CodexHost,SOUL_PROVIDER_ID,SOUL_STREAM_IDLE_TIMEOUT_MS} from './codex-host.mjs';
async function fixture(t,options={}){
 const host=new CodexHost({command:process.execPath,args:[fileURLToPath(new URL('./fixtures/fake-codex.mjs',import.meta.url))],requestTimeoutMs:1000,...options});
 t.after(()=>host.close());await host.connect();return host;
}
test('completion before request acknowledgement does not leave a phantom active turn',async t=>{
 const host=await fixture(t);const first=await host.begin('complete-before-ack');assert.equal((await first.completed).text,'finished');assert.equal(host.activeTurnId,null);
 const next=await host.begin('wait');assert.equal(host.activeTurnId,next.turnId);await assert.rejects(host.begin('overlap'),{code:'HOST_BUSY'});
 assert.equal((await host.interrupt()).status,'interrupted');assert.equal((await next.completed).status,'interrupted');
});
test('steer binds exact turn and does not retry a rejected stale turn',async t=>{
 const host=await fixture(t);const turn=await host.begin('wait');await assert.rejects(host.steer('alert','old-turn'),/mismatch/);
 assert.equal((await host.steer('alert',turn.turnId)).turnId,turn.turnId);await host.interrupt();await assert.rejects(host.steer('too late'),{code:'HOST_IDLE'});
});
test('host death rejects pending begin instead of silently starting another session',async t=>{
 const host=await fixture(t);await assert.rejects(host.begin('exit'),{code:'HOST_EXITED'});assert.equal(host.closed,true);
});
test('ambiguous request timeout invalidates connection and never replays start',async t=>{
 const host=await fixture(t,{requestTimeoutMs:150});await assert.rejects(host.begin('timeout'),{code:'HOST_REQUEST_TIMEOUT'});assert.equal(host.closed,true);await assert.rejects(host.request('turn/start',{}),{code:'HOST_REQUEST_TIMEOUT'});
});
test('missing executable fails connection and cleanup terminates without waiting for an exit event',async()=>{
 const host=new CodexHost({command:'/nonexistent-sim-codex-executable',requestTimeoutMs:200});
 await assert.rejects(host.connect(),{code:'HOST_START_FAILED'});
 const status=await host.close();assert.equal(status.startFailed,true);assert.equal(status.groupProbeCount,0);assert.equal(status.groupProbeFirstErrorCode,null);assert.equal(status.groupProbeLastErrorCode,null);
});
// Lifecycle tests use an in-memory protocol peer, never Codex or inference.
function protocol(t,options={},reply=()=>false){
 const requests=[],child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();let turn=0,ended=false;
 if(options.childPid!==undefined)child.pid=options.childPid;
 const deliver=message=>child.stdout.emit('data',Buffer.from(JSON.stringify(message)+'\n'));
 child.stdin.write=line=>{const message=JSON.parse(line);requests.push(message);if(message.id!==undefined)queueMicrotask(()=>{
  const respond=result=>deliver({id:message.id,result}),refuse=(code,messageText)=>deliver({id:message.id,error:{code,message:messageText}});
  if(reply(message,respond,refuse))return;
  if(message.method==='thread/start'||message.method==='thread/resume')respond({thread:{id:message.params.threadId??'owned-thread'}});
  else if(message.method==='turn/start')respond({turn:{id:'turn-'+(++turn),status:'inProgress'}});
  else respond({});
 });return true;};
 child.stdin.end=()=>{if(!ended){ended=true;queueMicrotask(()=>child.emit('exit',0,null));}};
 const host=new CodexHost({model:'synthetic-model',spawnProcess:()=>child,requestTimeoutMs:1000,...options});t.after(()=>host.close());
 return {host,requests,deliver};
}
async function until(predicate){for(let n=0;n<30;n++){if(predicate())return;await new Promise(setImmediate);}throw Error('Synthetic protocol condition not reached');}
test('interrupt rejects a different exact turn without emitting a cancellation request',async t=>{
 const p=protocol(t);await p.host.connect();const active=await p.host.begin('synthetic');
 await assert.rejects(p.host.interrupt('unrelated-turn'),{code:'HOST_TURN_MISMATCH'});assert.equal(p.host.activeTurnId,active.turnId);assert.equal(p.requests.some(r=>r.method==='turn/interrupt'),false);
});
test('interrupt ACK is not terminal proof and late ACK remains bound to its original turn',async t=>{
 let ack;const p=protocol(t,{},(m,respond)=>{if(m.method==='turn/interrupt'){ack=()=>respond({});return true;}return false;});await p.host.connect();const old=await p.host.begin('synthetic');let done=false;
 const interrupted=p.host.interrupt(old.turnId);interrupted.then(()=>{done=true;});await until(()=>ack);assert.equal(done,false);assert.equal(p.host.activeTurnId,old.turnId);
 p.deliver({method:'turn/completed',params:{threadId:p.host.threadId,turn:{id:old.turnId,status:'completed'}}});await old.completed;assert.equal(done,false,'terminal arriving first does not fabricate the RPC ACK');
 const fresh=await p.host.begin('fresh synthetic');ack();assert.equal((await interrupted).turnId,old.turnId);assert.equal(p.host.activeTurnId,fresh.turnId);assert.equal(p.requests.filter(r=>r.method==='turn/interrupt').length,1);
 p.deliver({method:'turn/completed',params:{threadId:p.host.threadId,turn:{id:fresh.turnId,status:'completed'}}});await fresh.completed;
});
test('durable start remains default and routine close never archives its thread',async t=>{
 const p=protocol(t);const connected=await p.host.connect();
 assert.equal(p.requests.find(r=>r.method==='thread/start').params.ephemeral,false);assert.equal(connected.ephemeral,false);assert.equal(connected.name,null);
 await p.host.close();assert.equal(p.requests.some(r=>r.method==='thread/archive'),false);
});
test('readable name is acknowledged before a first turn can start',async t=>{
 let finishName;const p=protocol(t,{name:' Sim · Eden · Reader '},(m,respond)=>{if(m.method==='thread/name/set'){finishName=()=>respond({});return true;}return false;});
 const connecting=p.host.connect();await until(()=>finishName);
 await assert.rejects(p.host.begin('synthetic'),{code:'HOST_NOT_CONNECTED'});assert.equal(p.requests.some(r=>r.method==='turn/start'),false);
 finishName();assert.equal((await connecting).name,'Sim · Eden · Reader');await p.host.begin('synthetic');
 const name=p.requests.find(r=>r.method==='thread/name/set');assert.deepEqual(name.params,{threadId:'owned-thread',name:'Sim · Eden · Reader'});
 assert.ok(p.requests.indexOf(name)<p.requests.findIndex(r=>r.method==='turn/start'));
});
test('ephemeral mode starts explicitly and cannot silently resume a retained thread',async t=>{
 const p=protocol(t,{ephemeral:true,name:'Sim probe',internalProbe:true});
 await assert.rejects(p.host.connect({threadId:'retained-durable-thread'}),{code:'HOST_EPHEMERAL_RESUME'});assert.equal(p.requests.length,0);
 const connected=await p.host.connect();assert.equal(connected.ephemeral,true);assert.equal(p.requests.find(r=>r.method==='thread/start').params.ephemeral,true);
 assert.deepEqual(await p.host.archiveCompleted(),{threadId:'owned-thread',archived:false,ephemeral:true});assert.equal(p.requests.some(r=>r.method==='thread/archive'),false);
});
test('ephemeral readable names stay local when installed host rejects metadata updates',async t=>{
 const p=protocol(t,{ephemeral:true,name:'Sim ephemeral probe'},(m,_respond,refuse)=>{if(m.method==='thread/name/set'){refuse(-32600,'ephemeral thread does not support metadata updates');return true;}return false;});
 const connected=await p.host.connect();assert.equal(connected.ephemeral,true);assert.equal(connected.name,'Sim ephemeral probe');assert.equal(p.host.name,'Sim ephemeral probe');
 assert.equal(p.requests.some(r=>r.method==='thread/name/set'||r.method==='thread/resume'),false);assert.equal(p.requests.filter(r=>r.method==='thread/start').length,1);
 await p.host.begin('synthetic');assert.equal(p.requests.filter(r=>r.method==='turn/start').length,1);
});
test('explicit durable override resumes the exact ID and names it without automatic archival',async t=>{
 const p=protocol(t,{ephemeral:true});await p.host.connect({threadId:'retained-thread',ephemeral:false,name:'Sim resumed Reader'});
 const resume=p.requests.find(r=>r.method==='thread/resume');assert.equal(resume.params.threadId,'retained-thread');assert.equal('ephemeral' in resume.params,false);
 assert.equal(p.requests.find(r=>r.method==='thread/name/set').params.threadId,'retained-thread');assert.equal(p.requests.some(r=>r.method==='thread/start'||r.method==='thread/archive'),false);
});
test('archive requires explicit internal probe ownership and cannot target another thread',async t=>{
 const normal=protocol(t);await normal.host.connect({threadId:'normal-user-thread'});
 await assert.rejects(normal.host.archiveCompleted(),{code:'HOST_ARCHIVE_NOT_OWNED'});assert.equal(normal.requests.some(r=>r.method==='thread/archive'),false);
 const owned=protocol(t,{internalProbe:true});await owned.host.connect();
 await assert.rejects(owned.host.archiveCompleted({expectedThreadId:'another-thread'}),{code:'HOST_THREAD_MISMATCH'});assert.equal(owned.requests.some(r=>r.method==='thread/archive'),false);
});
test('archive rejects starting and active turns, then archives only after explicit idle invocation',async t=>{
 let finishStart;const p=protocol(t,{internalProbe:true},(m,respond)=>{if(m.method==='turn/start'){finishStart=()=>respond({turn:{id:'active-turn'}});return true;}return false;});await p.host.connect();
 const starting=p.host.begin('synthetic');await until(()=>finishStart);
 await assert.rejects(p.host.archiveCompleted(),{code:'HOST_BUSY'});finishStart();const turn=await starting;
 await assert.rejects(p.host.archiveCompleted(),{code:'HOST_BUSY'});assert.equal(p.requests.some(r=>r.method==='thread/archive'),false);
 p.deliver({method:'turn/completed',params:{threadId:'owned-thread',turn:{id:'active-turn',status:'completed'}}});await turn.completed;
 assert.equal(p.requests.some(r=>r.method==='thread/archive'),false,'turn completion is not run completion or permission to archive');
 assert.deepEqual(await p.host.archiveCompleted({expectedThreadId:'owned-thread'}),{threadId:'owned-thread',archived:true});
 await assert.rejects(p.host.begin('do not reactivate'),{code:'HOST_ARCHIVED'});assert.equal((await p.host.archiveCompleted()).alreadyArchived,true);
 assert.equal(p.requests.filter(r=>r.method==='thread/archive').length,1);await p.host.close();assert.equal(p.requests.filter(r=>r.method==='thread/archive').length,1);
});
test('archive acknowledgement serializes against new turns and coalesces concurrent explicit requests',async t=>{
 let finishArchive;const p=protocol(t,{internalProbe:true},(m,respond)=>{if(m.method==='thread/archive'){finishArchive=()=>respond({});return true;}return false;});await p.host.connect();
 const first=p.host.archiveCompleted();await until(()=>finishArchive);
 await assert.rejects(p.host.begin('race'),{code:'HOST_ARCHIVED'});const second=p.host.archiveCompleted();assert.equal(p.host.archived,false);
 finishArchive();assert.deepEqual(await first,{threadId:'owned-thread',archived:true});assert.deepEqual(await second,await first);assert.equal(p.requests.filter(r=>r.method==='thread/archive').length,1);
});
test('failed naming or archival never reports lifecycle success or silently starts a turn',async t=>{
 const naming=protocol(t,{name:'Sim refused'},(m,_respond,refuse)=>{if(m.method==='thread/name/set'){refuse(-32600,'name refused');return true;}return false;});
 await assert.rejects(naming.host.connect(),/name refused/);await assert.rejects(naming.host.begin('synthetic'),{code:'HOST_NOT_CONNECTED'});assert.equal(naming.requests.some(r=>r.method==='turn/start'),false);
 const archive=protocol(t,{internalProbe:true},(m,_respond,refuse)=>{if(m.method==='thread/archive'){refuse(-32600,'archive refused');return true;}return false;});await archive.host.connect();
 await assert.rejects(archive.host.archiveCompleted(),/archive refused/);assert.equal(archive.host.archived,false);assert.equal(archive.host.archiving,null);assert.equal(archive.requests.filter(r=>r.method==='thread/archive').length,1);
});
test('invalid lifecycle options fail before a subprocess could be spawned',()=>{
 let spawned=0;const spawnProcess=()=>{spawned++;throw Error('must not spawn');};
 for(const options of [{ephemeral:'true'},{internalProbe:'yes'},{name:'\nsecret'},{name:'   '}])assert.throws(()=>new CodexHost({spawnProcess,...options}),e=>['HOST_INVALID_NAME','HOST_INVALID_OPTION'].includes(e.code));
 assert.equal(spawned,0);
});
test('owned session identity is emitted before naming can fail, without starting inference',async t=>{
 const p=protocol(t,{name:'Sim naming refusal'},(m,_respond,refuse)=>{if(m.method==='thread/name/set'){refuse(-32600,'synthetic name refusal');return true;}return false;}),events=[];
 p.host.on('lifecycle',event=>{events.push(event);if(event.state==='session-created')assert.equal(p.requests.some(r=>r.method==='thread/name/set'),false);});
 await assert.rejects(p.host.connect(),/synthetic name refusal/);
 assert.deepEqual(events.map(e=>e.state),['host-started','session-created']);assert.equal(events[1].threadId,'owned-thread');assert.equal(events[1].resumed,false);
 assert.equal(p.requests.some(r=>r.method==='turn/start'),false);
});
test('close verifies the entire owned group after leader exit',async t=>{
 let alive=true;const calls=[],p=protocol(t,{childPid:900001,killProcess:(pid,signal)=>{calls.push([pid,signal]);if(signal==='SIGKILL')alive=false;if(signal===0&&!alive)throw Object.assign(Error('gone'),{code:'ESRCH'});}}),events=[];
 p.host.on('lifecycle',e=>events.push(e));await p.host.connect();
 const proof=await p.host.close();assert.equal(proof.groupClosed,true);assert.equal(proof.hostPid,900001);assert.equal(proof.threadId,'owned-thread');assert.equal(proof.groupVerification,'absent');
 assert.deepEqual(calls,[[-900001,'SIGTERM'],[-900001,'SIGKILL'],[-900001,0]]);assert.equal(events.at(-1).state,'host-closed');assert.equal(events.at(-1).groupClosed,true);assert.equal(proof.groupProbeCount,1);assert.equal(proof.groupProbeFirstErrorCode,'ESRCH');assert.equal(proof.groupProbeLastErrorCode,'ESRCH');
});
test('close tolerates group reaping beyond the former one-second grace without resending signals',async t=>{
 let probes=0;const calls=[],p=protocol(t,{childPid:900003,killProcess:(pid,signal)=>{
  calls.push([pid,signal]);if(signal===0&&++probes===51)throw Object.assign(Error('finally reaped'),{code:'ESRCH'});
 }});await p.host.connect();
 const proof=await p.host.close();
 assert.equal(proof.code,0);assert.equal(probes,51,'absence becomes observable after 50 polling delays (1.25 seconds)');
 assert.equal(proof.groupClosed,true);assert.equal(proof.groupVerification,'absent');
 assert.deepEqual(calls.filter(([,signal])=>signal!==0),[[-900003,'SIGTERM'],[-900003,'SIGKILL']]);
 assert.ok(calls.every(([pid])=>pid===-900003));
});
test('close keeps a live group unverified after the bounded five-second grace despite leader exit zero',async t=>{
 let probes=0;const p=protocol(t,{childPid:900004,killProcess:(_pid,signal)=>{if(signal===0)probes++;}});await p.host.connect();
 t.mock.timers.enable({apis:['setTimeout']});
 const closing=p.host.close();await until(()=>probes>0);
 for(let n=0;n<200;n++){t.mock.timers.tick(25);await new Promise(setImmediate);}
 const proof=await closing;
 assert.equal(probes,200);assert.equal(proof.code,0);assert.equal(proof.groupClosed,false);assert.equal(proof.groupVerification,'unverified');assert.equal(proof.groupProbeCount,200);assert.equal(proof.groupProbeFirstErrorCode,null);assert.equal(proof.groupProbeLastErrorCode,null);
});

test('close retries a transient group probe error and verifies only subsequent ESRCH',async t=>{
 let probes=0,settled=false;const calls=[],events=[],p=protocol(t,{childPid:900005,killProcess:(pid,signal)=>{
  calls.push([pid,signal]);if(signal!==0)return;
  probes++;if(probes===1)throw Object.assign(Error('synthetic transient permission error'),{code:'EPERM'});
  if(probes===3)throw Object.assign(Error('gone'),{code:'ESRCH'});
 }});await p.host.connect();p.host.on('lifecycle',e=>events.push(e));
 t.mock.timers.enable({apis:['setTimeout']});
 const closing=p.host.close();void closing.then(()=>settled=true);await until(()=>probes>0);await new Promise(setImmediate);
 assert.equal(settled,false,'a probe error does not establish either absence or exhausted verification');
 t.mock.timers.tick(25);await until(()=>probes===2);assert.equal(settled,false,'a live group still cannot qualify');
 t.mock.timers.tick(25);const proof=await closing;
 assert.equal(probes,3);assert.equal(proof.groupClosed,true);assert.equal(proof.groupVerification,'absent');
 assert.equal(proof.groupProbeCount,3);assert.equal(proof.groupProbeFirstErrorCode,'EPERM');assert.equal(proof.groupProbeLastErrorCode,'ESRCH');
 assert.ok(Number.isSafeInteger(proof.groupProbeElapsedMs)&&proof.groupProbeElapsedMs>=0);
 assert.deepEqual(calls.filter(([,signal])=>signal!==0),[[-900005,'SIGTERM'],[-900005,'SIGKILL']]);assert.ok(calls.every(([pid])=>pid===-900005));
 assert.deepEqual(events.at(-1),{state:'host-closed',...proof});
 assert.deepEqual(await p.host.close(),proof,'repeated close returns the same certificate without more signals/probes');assert.equal(probes,3);
});
test('close exhausts bounded probes on persistent errors and retains unknown despite exit zero',async t=>{
 let probes=0;const calls=[],p=protocol(t,{childPid:900006,killProcess:(pid,signal)=>{
  calls.push([pid,signal]);if(signal===0){probes++;throw Object.assign(Error('synthetic denied'),{code:'EPERM'});}
 }});await p.host.connect();t.mock.timers.enable({apis:['setTimeout']});
 const closing=p.host.close();await until(()=>probes>0);
 for(let n=0;n<200;n++){t.mock.timers.tick(25);await new Promise(setImmediate);}
 const proof=await closing;assert.equal(probes,200);assert.equal(proof.code,0);assert.equal(proof.groupClosed,false);assert.equal(proof.groupVerification,'unverified');
 assert.equal(proof.groupProbeCount,200);assert.equal(proof.groupProbeFirstErrorCode,'EPERM');assert.equal(proof.groupProbeLastErrorCode,'EPERM');assert.ok(Number.isSafeInteger(proof.groupProbeElapsedMs)&&proof.groupProbeElapsedMs>=0);
 assert.deepEqual(calls.filter(([,signal])=>signal!==0),[[-900006,'SIGTERM'],[-900006,'SIGKILL']]);assert.ok(calls.every(([pid])=>pid===-900006));
});
test('close retains bounded error codes without arbitrary probe error messages or invalid code text',async t=>{
 let probes=0;const privateText='synthetic/private/probe-details',p=protocol(t,{childPid:900007,killProcess:(_pid,signal)=>{
  if(signal!==0)return;if(++probes===1)throw Object.assign(Error(privateText),{code:privateText});throw Object.assign(Error(privateText),{code:'ESRCH'});
 }});await p.host.connect();t.mock.timers.enable({apis:['setTimeout']});
 const closing=p.host.close();await until(()=>probes>0);t.mock.timers.tick(25);const proof=await closing;
 assert.equal(proof.groupClosed,true);assert.equal(proof.groupProbeCount,2);assert.equal(proof.groupProbeFirstErrorCode,'UNKNOWN');assert.equal(proof.groupProbeLastErrorCode,'ESRCH');assert.equal(JSON.stringify(proof).includes(privateText),false);
});

test('schema error notification is forwarded for the owned thread without ending or retrying its active turn',async t=>{
 const p=protocol(t),events=[];await p.host.connect();p.host.on('event',event=>events.push(event));
 const active=await p.host.begin('synthetic');let completed=false;void active.completed.then(()=>completed=true);
 const params={threadId:'owned-thread',turnId:active.turnId,willRetry:true,error:{message:'synthetic provider message',codexErrorInfo:{httpConnectionFailed:{httpStatusCode:503}},additionalDetails:'synthetic diagnostic details'}};
 p.deliver({method:'error',params});await new Promise(setImmediate);
 assert.equal(events.length,1);assert.equal(events[0].method,'error');assert.deepEqual(events[0].params,params);assert.ok(Number.isSafeInteger(events[0].receivedAt));
 assert.equal(p.host.closed,false);assert.equal(p.host.failure,undefined);assert.equal(p.host.activeTurnId,active.turnId);assert.equal(completed,false);
 p.deliver({method:'error',params:{...params,threadId:'foreign-thread'}});assert.equal(events.length,1,'foreign thread error is not forwarded');
 assert.equal(p.requests.filter(r=>r.method==='turn/start').length,1);assert.equal(p.requests.some(r=>r.method==='turn/interrupt'),false);
 // Only the actual terminal host notification resolves the turn.
 p.deliver({method:'turn/completed',params:{threadId:'owned-thread',turn:{id:active.turnId,status:'completed'}}});
 assert.equal((await active.completed).status,'completed');assert.equal(p.host.activeTurnId,null);
});

// Soul transport selection: synthetic account/config answers only. The account
// email and workspace account id are canaries that must never leave the host.
const caller={'features.shell_tool':false,web_search:'disabled'};
const chatgpt={account:{type:'chatgpt',email:'canary@example.invalid',planType:'pro'},requiresOpenaiAuth:true,workspaceRouting:{chatgptAccountId:'acct-canary',backendOrigin:'https://chatgpt.com',accountRoutingOverride:'NO_CONSTRAINT'}};
// Mirrors a developer machine's effective config/read: built-in chatgpt_base_url default, null others.
const effective={model_provider:null,profile:null,openai_base_url:null,chatgpt_base_url:'https://chatgpt.com/backend-api/',profiles:{}};
function selection(t,{account=chatgpt,settings={config:effective},provider,recorded=SOUL_PROVIDER_ID,options={}}={}){
 return protocol(t,options,(m,respond,refuse)=>{
  if(m.method==='thread/read'){if(recorded===null)refuse(-32600,'synthetic read refusal');else respond({thread:{id:m.params.threadId,modelProvider:recorded}});return true;}
  if(m.method==='account/read'){if(account==='silent')return true;if(account===null)refuse(-32600,'synthetic account refusal');else respond(account);return true;}
  if(m.method==='config/read'){respond(settings);return true;}
  if(m.method==='thread/start'||m.method==='thread/resume'){respond({thread:{id:m.params.threadId??'owned-thread'},modelProvider:provider??m.params.config?.model_provider??'openai'});return true;}
  return false;
 });
}
test('a default host sends the exact pre-transport thread/start and thread/resume params and no auth/config queries',async t=>{
 for(const threadId of [null,'retained-thread']){
  const p=protocol(t,{cwd:'/synthetic/cwd'}),events=[];p.host.on('lifecycle',e=>events.push(e));
  const connected=await p.host.connect({threadId,instructions:'synthetic instructions',config:caller});
  const sent=p.requests.find(r=>r.method===(threadId?'thread/resume':'thread/start'));
  const base={cwd:'/synthetic/cwd',model:'synthetic-model',approvalPolicy:'never',sandbox:'read-only',developerInstructions:'synthetic instructions',config:caller};
  assert.deepEqual(sent.params,threadId?{...base,threadId}:{...base,ephemeral:false});
  assert.deepEqual(p.requests.map(r=>r.method),['initialize','initialized',threadId?'thread/resume':'thread/start']);
  assert.deepEqual(connected.transport,{providerId:null,idleTimeoutMs:null,authMode:null,reason:'disabled'});assert.deepEqual(events.find(e=>e.state==='session-created').transport,connected.transport);
 }
});
for(const [label,account,base] of [['chatgpt',chatgpt,'https://chatgpt.com/backend-api/codex'],['apiKey',{account:{type:'apiKey'},requiresOpenaiAuth:true},'https://api.openai.com/v1']])test('opted-in '+label+' auth starts on the Soul provider with only the idle timeout changed',async t=>{
 const p=selection(t,{account}),events=[];p.host.on('lifecycle',e=>events.push(e));
 const connected=await p.host.connect({config:caller,soulTransport:true});
 const config=p.requests.find(r=>r.method==='thread/start').params.config;
 assert.deepEqual(config,{...caller,model_provider:SOUL_PROVIDER_ID,['model_providers.'+SOUL_PROVIDER_ID]:{name:'OpenAI',base_url:base,wire_api:'responses',requires_openai_auth:true,supports_websockets:true,env_http_headers:{'OpenAI-Organization':'OPENAI_ORGANIZATION','OpenAI-Project':'OPENAI_PROJECT'},stream_idle_timeout_ms:10000}});
 assert.equal(SOUL_STREAM_IDLE_TIMEOUT_MS,10000);
 const applied={providerId:SOUL_PROVIDER_ID,idleTimeoutMs:10000,authMode:label,reason:'applied'};
 assert.deepEqual(connected.transport,applied);assert.deepEqual(p.host.transport,applied);assert.deepEqual(events.find(e=>e.state==='session-created').transport,applied);
 assert.equal(JSON.stringify([events,connected,p.host.transport]).match(/canary/),null,'no account identity leaves the host');
});
test('opted-in resume keeps the provider a retained thread was created with',async t=>{
 const soul=selection(t);await soul.host.connect({threadId:'retained-thread',config:caller,soulTransport:true});
 assert.deepEqual(soul.requests.find(r=>r.method==='thread/read').params,{threadId:'retained-thread',includeTurns:false});
 const resume=soul.requests.find(r=>r.method==='thread/resume');assert.equal(resume.params.threadId,'retained-thread');assert.equal(resume.params.config.model_provider,SOUL_PROVIDER_ID);assert.equal(soul.host.transport.reason,'applied');
 for(const [recorded,reason] of [['openai','retained-thread-provider'],[null,'thread-provider-unknown']]){
  const legacy=selection(t,{recorded});const connected=await legacy.host.connect({threadId:'legacy-thread',config:caller,soulTransport:true});
  assert.deepEqual(legacy.requests.find(r=>r.method==='thread/resume').params.config,caller,'a legacy built-in thread is resumed unchanged');assert.deepEqual(connected.transport,{providerId:null,idleTimeoutMs:null,authMode:null,reason});
 }
});
test('#488: an unanswered thread read keeps the provider the checkpoint recorded',async t=>{
 const kept=selection(t,{recorded:null});const connected=await kept.host.connect({threadId:'soul-thread',config:caller,soulTransport:true,threadProvider:SOUL_PROVIDER_ID});
 assert.equal(kept.requests.find(r=>r.method==='thread/resume').params.config.model_provider,SOUL_PROVIDER_ID,'not flipped to the default');assert.equal(connected.transport.reason,'applied');
 const other=selection(t,{recorded:'openai'});await other.host.connect({threadId:'legacy-thread',config:caller,soulTransport:true,threadProvider:SOUL_PROVIDER_ID});
 assert.deepEqual(other.requests.find(r=>r.method==='thread/resume').params.config,caller,'what the host reports wins');
});
for(const [label,options,reason] of [
 ['refused account read',{account:null},'auth-unknown'],
 ['unanswered account read',{account:'silent',options:{requestTimeoutMs:200}},'auth-unknown'],
 ['account without OpenAI auth',{account:{account:null,requiresOpenaiAuth:false}},'auth-unknown'],
 ['unknown account class',{account:{account:{type:'amazonBedrock'},requiresOpenaiAuth:true}},'auth-unknown'],
 ['user custom provider',{settings:{config:{model_provider:'user-provider'}}},'configured-provider'],
 ['unreadable config',{settings:{}},'config-unknown'],
 ['workspace-routed backend',{account:{...chatgpt,workspaceRouting:{...chatgpt.workspaceRouting,backendOrigin:'https://gov.chatgpt.com'}}},'routed-backend'],
 ['base URL environment override',{options:{env:{OPENAI_BASE_URL:'https://proxy.invalid/v1'}}},'base-url-environment'],
 // A profile can select a provider while top-level model_provider stays null.
 ['active profile selecting a gateway',{settings:{config:{model_provider:null,profile:'work',profiles:{work:{model_provider:'corp_gw'}}}}},'configured-profile'],
 ['active profile even when it names openai',{settings:{config:{model_provider:null,profile:'plain',profiles:{plain:{model_provider:'openai'}}}}},'configured-profile'],
 ['non-default chatgpt_base_url',{settings:{config:{...effective,chatgpt_base_url:'https://gw.invalid/backend-api/'}}},'configured-base-url'],
 ['top-level openai_base_url',{settings:{config:{model_provider:null,openai_base_url:'https://gw.invalid/v1'}}},'configured-base-url'],
 ['base URL only inside the active profile',{settings:{config:{model_provider:null,profile:'work',profiles:{work:{openai_base_url:'https://gw.invalid/v1'}}}}},'configured-profile'],
])test('opted-in selection leaves config untouched for '+label,async t=>{
 const p=selection(t,options);const connected=await p.host.connect({config:caller,soulTransport:true});
 assert.deepEqual(p.requests.find(r=>r.method==='thread/start').params.config,caller);assert.deepEqual(connected.transport,{providerId:null,idleTimeoutMs:null,authMode:null,reason});
 assert.equal(p.host.closed,false,'a metadata query never fails the host');await p.host.begin('synthetic');
});
test('a caller-selected provider, profile or base URL is never replaced and needs no auth query',async t=>{
 for(const extra of [{model_provider:'caller-provider'},{'model_providers.caller':{name:'x'}},{profile:'work'},{'profiles.work.model_provider':'corp_gw'},{chatgpt_base_url:'https://gw.invalid/'},{openai_base_url:'https://gw.invalid/v1'}]){
  const p=selection(t),config={...caller,...extra};await p.host.connect({config,soulTransport:true});
  assert.deepEqual(p.requests.find(r=>r.method==='thread/start').params.config,config);assert.equal(p.requests.some(r=>['account/read','config/read','thread/read'].includes(r.method)),false);assert.equal(p.host.transport.reason,'caller-provider');
 }
});
test('resume metadata queries run in one parallel budget',async t=>{
 const held=[];let released=false;
 const p=protocol(t,{requestTimeoutMs:400},(m,respond)=>{
  const answers={'config/read':{config:{model_provider:null}},'account/read':chatgpt,'thread/read':{thread:{id:'retained-thread',modelProvider:SOUL_PROVIDER_ID}}};
  if(!(m.method in answers))return false;held.push(()=>respond(answers[m.method]));
  // Answer only once all three are outstanding: a sequential read would time out.
  if(held.length===3&&!released){released=true;held.forEach(f=>f());}return true;
 });
 await p.host.connect({threadId:'retained-thread',config:caller,soulTransport:true});
 assert.deepEqual(p.requests.filter(r=>['config/read','account/read','thread/read'].includes(r.method)).map(r=>r.method).sort(),['account/read','config/read','thread/read']);assert.equal(p.host.transport.reason,'applied');
});
test('a Soul-provider thread that cannot keep its provider is disclosed with the cause',async t=>{
 for(const [options,cause] of [[{account:null},'auth-unknown'],[{settings:{}},'config-unknown'],[{settings:{config:{profile:'work'}}},'configured-profile']]){
  const p=selection(t,options);const connected=await p.host.connect({threadId:'soul-thread',config:caller,soulTransport:true});
  assert.deepEqual(connected.transport,{providerId:null,idleTimeoutMs:null,authMode:null,reason:'retained-soul-thread-fallback',cause});
 }
});
test('a host-reported provider other than the requested one is disclosed',async t=>{
 const p=selection(t,{provider:'openai'});await p.host.connect({config:caller,soulTransport:true});assert.equal(p.host.transport.reason,'host-provider-mismatch');assert.equal(p.host.transport.providerId,SOUL_PROVIDER_ID);
});
// Item accounting mirrors the presenter turns …4f94 (one message after the
// steer item) and …9a4c (a draft before the steer item, then a final message).
const item=(p,method,turnId,type,id,text)=>p.deliver({method,params:{threadId:'owned-thread',turnId,item:{type,id,...(text===undefined?{}:{text})}}});
const input=(p,turnId,id,text)=>p.deliver({method:'item/completed',params:{threadId:'owned-thread',turnId,item:{type:'userMessage',id,content:[{type:'text',text,text_elements:[]}]}}});
test('turn result reports userMessage items recorded before the final agentMessage started',async t=>{
 const p=protocol(t);await p.host.connect();
 const one=await p.host.begin('synthetic');item(p,'item/started',one.turnId,'userMessage','u1');item(p,'item/completed',one.turnId,'userMessage','u1');
 item(p,'item/started',one.turnId,'userMessage','u2');input(p,one.turnId,'u2',JSON.stringify({notice:'private steer text canary',steerId:'steer00000000001',pending:[{event:{steerId:'nested-is-ignored'}}]}));item(p,'item/started',one.turnId,'reasoning','r1');
 item(p,'item/started',one.turnId,'agentMessage','m1');item(p,'item/completed',one.turnId,'agentMessage','m1','{"choice":1}');
 p.deliver({method:'turn/completed',params:{threadId:'owned-thread',turn:{id:one.turnId,status:'completed'}}});
 assert.deepEqual(await one.completed,{turnId:one.turnId,status:'completed',error:null,text:'{"choice":1}',finalText:'{"choice":1}',inputs:{userMessages:2,agentMessages:1,finalAfter:2,steerIds:[null,'steer00000000001']}});
 assert.equal(JSON.stringify(await one.completed).includes('canary'),false,'item text is never retained');
 const two=await p.host.begin('synthetic');item(p,'item/completed',two.turnId,'userMessage','u1');
 item(p,'item/started',two.turnId,'agentMessage','m1');item(p,'item/completed',two.turnId,'agentMessage','m1','draft');input(p,two.turnId,'u2',JSON.stringify({steerId:'bad id'}));
 item(p,'item/started',two.turnId,'agentMessage','m2');item(p,'item/completed',two.turnId,'agentMessage','m2','final');
 p.deliver({method:'turn/completed',params:{threadId:'owned-thread',turn:{id:two.turnId,status:'completed'}}});
 const r=await two.completed;assert.equal(r.text,'draft\nfinal');assert.equal(r.finalText,'final');assert.deepEqual(r.inputs,{userMessages:2,agentMessages:2,finalAfter:2,steerIds:[null,null]},'an invalid steerId is no identity');
});
test('missing or out-of-order agentMessage starts report an unknown final position',async t=>{
 const p=protocol(t);await p.host.connect();
 const missing=await p.host.begin('synthetic');item(p,'item/completed',missing.turnId,'userMessage','u1');item(p,'item/completed',missing.turnId,'agentMessage','m1','{}');
 p.deliver({method:'turn/completed',params:{threadId:'owned-thread',turn:{id:missing.turnId,status:'completed'}}});assert.equal((await missing.completed).inputs.finalAfter,null);
 const dangling=await p.host.begin('synthetic');item(p,'item/completed',dangling.turnId,'userMessage','u1');item(p,'item/started',dangling.turnId,'agentMessage','m1');item(p,'item/completed',dangling.turnId,'agentMessage','m1','{}');item(p,'item/started',dangling.turnId,'agentMessage','m2');
 p.deliver({method:'turn/completed',params:{threadId:'owned-thread',turn:{id:dangling.turnId,status:'completed'}}});assert.equal((await dangling.completed).inputs.finalAfter,null,'a later started message supersedes the completed one');
});
test('otherwise dropped notifications become bounded per-turn method-only notices',async t=>{
 const p=protocol(t),notices=[],events=[];await p.host.connect();p.host.on('notice',n=>notices.push(n));p.host.on('event',e=>events.push(e));
 p.deliver({method:'warning',params:{threadId:'owned-thread',message:'synthetic private warning body'}});
 p.deliver({method:'account/rateLimits/updated',params:{rateLimits:{primary:{usedPercent:1}}}});
 p.deliver({method:'turn/started',params:{threadId:'owned-thread',turn:{id:'turn-x',status:'inProgress'}}});
 p.deliver({method:'model/rerouted',params:{threadId:'foreign-thread'}});
 assert.deepEqual(notices.map(n=>Object.keys(n).sort().join()),['method,receivedAt','method,receivedAt']);assert.deepEqual(notices.map(n=>n.method),['warning','account/rateLimits/updated']);
 assert.equal(JSON.stringify(notices).includes('synthetic private'),false);assert.deepEqual(events.map(e=>e.method),['turn/started'],'forwarded events are unchanged');
 for(let n=0;n<30;n++)p.deliver({method:'item/agentMessage/delta',params:{threadId:'owned-thread',delta:'x'}});
 p.deliver({method:'item/reasoning/summaryTextDelta',params:{threadId:'owned-thread',delta:'x'}});
 assert.equal(notices.some(n=>/(\/delta|Delta)$/.test(n.method)),false,'streaming deltas never spend the budget');
 for(let n=0;n<30;n++)p.deliver({method:'thread/status/changed',params:{threadId:'owned-thread'}});
 assert.equal(notices.filter(n=>n.method==='thread/status/changed').length,5,'per-turn per-method bound');
 p.host.activeTurnId=null;p.deliver({method:'turn/started',params:{threadId:'owned-thread',turn:{id:'turn-y',status:'inProgress'}}});
 for(let n=0;n<30;n++)p.deliver({method:'thread/status/changed',params:{threadId:'owned-thread'}});
 assert.equal(notices.filter(n=>n.method==='thread/status/changed').length,10,'a later turn records its own stall attribution');
 for(let n=0;n<2500;n++)p.deliver({method:'synthetic/method'+n,params:{}});assert.equal(notices.length,2000,'per-host bound');
 assert.equal(p.host.closed,false);
});
