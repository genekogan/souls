import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {probeSessions,verifyOwnedProbeExit,probeArchivalStatus} from './probe-sessions.mjs';

test('separately opened registries preserve each others registrations',()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probes-'));
 try{const first=probeSessions(root),second=probeSessions(root);
  for(const [registry,id] of [[first,'a'],[second,'b']])registry.register({threadId:id,cwd:join(root,id),name:'Sim probe '+id,recoveryMechanism:'durable'});
  first.complete('a',{outcome:'passed',ownedProcessesExited:true,evidence:'a.json'});
  assert.deepEqual(second.snapshot().sessions.map(x=>[x.threadId,x.terminal]),[['a',true],['b',false]]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('cleanup preserves unfinished/ephemeral sessions and refuses active or mismatched durable threads',async()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probes-')),calls=[];let closed=false;
 const host={send(){},close:async()=>{closed=true},request:async(method,args)=>{
  calls.push({method,args});if(method==='thread/read')return {thread:{id:args.threadId,cwd:args.threadId==='foreign'?'/unrelated':join(root,args.threadId),status:{type:args.threadId==='busy'?'active':'notLoaded'}}};return {};
 }};
 try{
  const registry=probeSessions(root,{createHost:()=>host});
  for(const id of ['done','unfinished','busy','foreign','ephemeral']){
   registry.register({threadId:id,cwd:join(root,id),name:'Sim probe '+id,ephemeral:id==='ephemeral',recoveryMechanism:'same durable host and Soul journal'});
   if(id!=='unfinished')registry.complete(id,{outcome:'failed',ownedProcessesExited:true,evidence:'summary.json'});
  }
  assert.throws(()=>registry.complete('unfinished',{outcome:'passed',ownedProcessesExited:false,evidence:'summary.json'}));
  const rows=await registry.archiveCompleted();
  assert.deepEqual(rows.map(x=>[x.threadId,x.archived]),[['done',true],['busy',false],['foreign',false]]);
  assert.deepEqual(calls.filter(x=>x.method==='thread/archive').map(x=>x.args.threadId),['done']);
  assert.equal(calls.some(x=>['thread/start','thread/resume'].includes(x.method)),false);
  assert.equal(closed,true);
  assert.equal(probeSessions(root).snapshot().sessions.find(x=>x.threadId==='done').outcome,'failed');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('failed archival remains retryable without deleting probe evidence',async()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probes-'));let blocked=true;
 try{
  const registry=probeSessions(root,{sleep:async()=>{},createHost:()=>({send(){},close:async()=>({hostPid:444,groupClosed:true,groupVerification:'absent'}),request:async(method)=>{
   if(method==='thread/read')return {thread:{id:'owned',cwd:join(root,'host'),status:{type:'notLoaded'}}};
   if(method==='thread/archive'&&blocked)throw Error('active writer');return {};
  }})});
  registry.register({threadId:'owned',cwd:join(root,'host'),name:'Sim probe',recoveryMechanism:'same durable host and Soul journal'});
  registry.complete('owned',{outcome:'bounded-end',ownedProcessesExited:true,evidence:'local-summary.json'});
  assert.equal((await registry.archiveCompleted())[0].archived,false);blocked=false;
  assert.equal((await registry.archiveCompleted())[0].archived,true);
  assert.equal(registry.snapshot().sessions[0].evidence,'local-summary.json');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('archive RPC cannot overwrite a concurrent completion audit or another registration',async()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probe-race-'));let finishRead;
 try{
  const first=probeSessions(root,{createHost:()=>({send(){},close:async()=>{},request:async(method)=>{
   if(method==='thread/read')return new Promise(resolve=>{finishRead=()=>resolve({thread:{id:'owned',cwd:join(root,'host'),status:{type:'idle'}}});});return {};
  }})}),second=probeSessions(root);
  first.register({threadId:'owned',cwd:join(root,'host'),name:'Sim owned',recoveryMechanism:'durable'});first.complete('owned',{outcome:'passed',ownedProcessesExited:true,evidence:'old-audit.json'});
  const archiving=first.archiveCompleted();for(let i=0;i<20&&!finishRead;i++)await new Promise(setImmediate);assert.ok(finishRead);
  second.complete('owned',{outcome:'failed',ownedProcessesExited:true,evidence:'new-complete-audit.json'});second.register({threadId:'other',cwd:join(root,'other'),name:'Sim other',recoveryMechanism:'durable'});
  finishRead();assert.equal((await archiving)[0].archived,true);
  const sessions=second.snapshot().sessions,owned=sessions.find(s=>s.threadId==='owned');assert.equal(owned.outcome,'failed');assert.equal(owned.evidence,'new-complete-audit.json');assert.ok(owned.archivedAt);assert.equal(sessions.find(s=>s.threadId==='other').terminal,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('explicit failed exit is archivable only with every controller certificate and absent owned group',()=>{
 const host={hostPid:222,threadId:'owned',groupClosed:true,groupVerification:'absent'},controller={pid:111,started:true,hostPids:new Set([222]),closed:{controllerPid:111,ownedProcessesExited:true,ownedHosts:[host]}},input={exit:{code:1,signal:null},controllers:[controller]},absent=()=>{throw Object.assign(Error('absent'),{code:'ESRCH'});};
 assert.equal(verifyOwnedProbeExit(input,absent),true,'code1 can be terminal after actual cleanup proof');
 assert.equal(verifyOwnedProbeExit({...input,exit:{code:0,signal:null},controllers:[{...controller,closed:null}]},absent),false,'code0 does not substitute for a missing final certificate');
 assert.equal(verifyOwnedProbeExit({...input,controllers:[controller,{pid:333,started:true,hostPids:new Set(),closed:null}]},absent),false,'every controller restart must close');
 assert.equal(verifyOwnedProbeExit(input,()=>{}),false,'a live process group blocks archival');
 assert.equal(verifyOwnedProbeExit(input,()=>{throw Object.assign(Error('unknown'),{code:'EPERM'});}),false);
 assert.equal(verifyOwnedProbeExit({...input,controllers:[{...controller,hostPids:new Set([222,444])}]},absent),false,'a missing owned host cannot disappear from the certificate');
 assert.equal(verifyOwnedProbeExit({...input,exit:{code:null,signal:'SIGKILL'}},absent),false);
});
function restartFixture(){
 const ownership={actorId:'reader-b',setupId:'setup-1',worldId:'world-1',soulId:'s_reader',controller:{pid:111,ppid:100,pgid:100,startToken:'birth-controller'},launcher:{pid:100,ppid:99,pgid:100,startToken:'birth-launcher'},descendantsComplete:true,evidence:['restart.json#ownership'],groups:[{pgid:222,members:[{pid:222,ppid:111,pgid:222,startToken:'birth-host'},{pid:223,ppid:222,pgid:222,startToken:'birth-child'}]}]};
 const controller={pid:111,started:true,hostPids:new Set([222]),closed:null,restartOwnership:structuredClone(ownership)};
 const proof={schema:'sim-continuity-managed-restart/1',actor:'reader-b',setupId:'setup-1',worldId:'world-1',soulId:'s_reader',dispatchAttempted:true,triggerExercised:true,deathAt:100,controllerExitAt:110,oldGroupsAbsentAt:120,signals:[{target:111,role:'controller',signal:'SIGKILL',delivered:true,at:100}],oldOwnership:structuredClone(ownership)};
 return {controller,proof,input:{exit:{code:0,signal:null},controllers:[controller],restartProofs:[proof]}};
}
const absent=()=>{throw Object.assign(Error('absent'),{code:'ESRCH'});};

test('declared controller death uses exact external absence proof without inventing a close event',()=>{
 const {controller,proof,input}=restartFixture(),checked=[];
 const checkAbsent=(pid,signal)=>{checked.push([pid,signal]);return absent();};
 assert.equal(verifyOwnedProbeExit(input,checkAbsent),true);assert.deepEqual(checked,[[111,0],[222,0],[223,0],[-222,0]]);assert.equal(controller.closed,null);
 for(const change of [{oldGroupsAbsentAt:null},{controllerExitAt:99},{dispatchAttempted:false},{signals:[]},{oldOwnership:{...proof.oldOwnership,descendantsComplete:false}}])assert.equal(verifyOwnedProbeExit({...input,restartProofs:[{...proof,...change}]},absent),false);
 assert.equal(verifyOwnedProbeExit({...input,controllers:[{...controller,pid:333}]},absent),false);
 assert.equal(verifyOwnedProbeExit({...input,controllers:[{...controller,hostPids:new Set([222,444])}]},absent),false);
 assert.equal(verifyOwnedProbeExit(input,(pid)=>{if(pid===223)return;return absent();}),false,'a surviving escaped tool child blocks archival');
 assert.equal(verifyOwnedProbeExit(input,(pid)=>{if(pid===-222)return;return absent();}),false,'a reused or live group blocks archival');
 assert.equal(verifyOwnedProbeExit(input,()=>{throw Object.assign(Error('unknown'),{code:'EPERM'});}),false);
 assert.equal(verifyOwnedProbeExit({...input,controllers:[controller,{pid:444,started:true,hostPids:new Set(),closed:null}]},absent),false,'proof for old controller never closes a new one');
 const later={pid:444,started:true,hostPids:new Set(),closed:{controllerPid:444,ownedProcessesExited:true,ownedHosts:[]}};
 assert.equal(verifyOwnedProbeExit({...input,exit:{code:1,signal:null},controllers:[controller,later]},absent),true,'later controllers require their own normal close certificate');
});

test('normal certificates require controller PID absence as well as absent host groups',()=>{
 const controller={pid:111,started:true,hostPids:new Set([222]),closed:{controllerPid:111,ownedProcessesExited:true,ownedHosts:[{hostPid:222,groupClosed:true,groupVerification:'absent'}]}};
 const input={exit:{code:0,signal:null},controllers:[controller]};
 assert.equal(verifyOwnedProbeExit(input,pid=>{if(pid===111)return;return absent();}),false,'still-live controller cannot be archived after emitting closure');
 assert.equal(verifyOwnedProbeExit(input,pid=>{if(pid===111)throw Object.assign(Error('unknown'),{code:'EPERM'});return absent();}),false);
 assert.equal(verifyOwnedProbeExit(input,absent),true);
});

test('duplicate or ambiguous controller births never reuse a death or normal certificate',()=>{
 const {controller,input}=restartFixture();
 assert.equal(verifyOwnedProbeExit({...input,controllers:[controller,{...controller}]},absent),false,'one death proof cannot close two launches with the same numeric PID');
 assert.equal(verifyOwnedProbeExit({...input,controllers:[{...controller,identityAmbiguous:true}]},absent),false);
 const closed={...controller,identityAmbiguous:true,closed:{controllerPid:111,ownedProcessesExited:true,ownedHosts:[]},hostPids:new Set()};
 assert.equal(verifyOwnedProbeExit({...input,controllers:[closed]},absent),false,'a later closure cannot erase a reused-PID marker');
});

test('external certificate binds the trusted complete birth identity, inventory and actor scope',()=>{
 for(const mutate of [
  c=>delete c.restartOwnership,
  c=>c.restartOwnership.controller.startToken='replacement-controller',
  c=>c.restartOwnership.controller.pgid=101,
  c=>c.restartOwnership.launcher.startToken='replacement-launcher',
  c=>c.restartOwnership.actorId='another-actor',
  c=>c.restartOwnership.setupId='another-setup',
  c=>c.restartOwnership.worldId='another-world',
  c=>c.restartOwnership.soulId='another-soul',
  c=>c.restartOwnership.groups[0].members[1].startToken='replacement-child',
  c=>c.restartOwnership.groups[0].members.pop(),
 ]){
  const {controller,input}=restartFixture();mutate(controller);assert.equal(verifyOwnedProbeExit(input,absent),false);
 }
 for(const key of ['actor','setupId','worldId','soulId']){const {input,proof}=restartFixture();proof[key]='other';assert.equal(verifyOwnedProbeExit(input,absent),false);}
});

test('external ownership must be a bounded complete ancestry graph even when expected data agrees',()=>{
 for(const mutate of [
  o=>o.groups[0].members[0].ppid=999,
  o=>o.groups[0].members[0].ppid=223,
  o=>o.groups[0].members.push({...o.groups[0].members[0]}),
  o=>o.groups[0].pgid=o.launcher.pgid,
  o=>delete o.controller.startToken,
  o=>o.controller.startToken='bad\nidentity',
  o=>o.evidence=[],
  o=>o.groups[0].members=Array.from({length:129},(_,i)=>({pid:300+i,ppid:111,pgid:222,startToken:'child-'+i})),
 ]){
  const {controller,proof,input}=restartFixture();mutate(proof.oldOwnership);controller.restartOwnership=structuredClone(proof.oldOwnership);assert.equal(verifyOwnedProbeExit(input,absent),false);
 }
 const {controller,proof,input}=restartFixture();proof.oldOwnership.groups[0].members.reverse();assert.equal(verifyOwnedProbeExit(input,absent),true,'inventory ordering is not process identity');assert.equal(controller.closed,null);
});

test('prior closed hosts need original source certificate, birth binding and fresh PID/group absence',()=>{
 const {controller,input}=restartFixture(),closed={state:'host-closed',controllerPid:111,hostPid:333,threadId:'thread-old',groupClosed:true,groupVerification:'absent',at:90,evidence:['controller.ndjson:4']};
 controller.hostPids.add(333);controller.closedHosts=[closed];controller.restartClosedHosts=[{...closed,identity:{pid:333,ppid:111,pgid:333,startToken:'birth-old-host'}}];
 assert.equal(verifyOwnedProbeExit(input,absent),true);assert.equal(controller.closed,null);
 for(const target of [333,-333])assert.equal(verifyOwnedProbeExit(input,pid=>pid===target?undefined:absent()),false);
 for(const mutate of [c=>c.closedHosts=[],c=>c.restartClosedHosts={},c=>c.closedHosts={},c=>c.restartClosedHosts[0].evidence=[],c=>c.restartClosedHosts[0].identity.ppid=999,c=>c.restartClosedHosts[0].groupClosed=false,c=>c.restartClosedHosts[0].at=101]){
  const copy=structuredClone(input);mutate(copy.controllers[0]);assert.equal(verifyOwnedProbeExit(copy,absent),false);
 }
});


test('archive results retain metadata helper closure independently of archive acknowledgement',async()=>{
 for(const proof of [
  {code:0,signal:null,hostPid:444,threadId:null,groupClosed:true,groupVerification:'absent'},
  {code:0,signal:null,hostPid:444,threadId:null,groupClosed:false,groupVerification:'unverified'},
  undefined,
 ]){
  const root=mkdtempSync(join(tmpdir(),'souls-probe-metadata-close-')),calls=[];
  try{
   const host={pid:444,send(){},close:async()=>proof,request:async(method,args)=>{
    calls.push({method,args});if(method==='thread/read')return {thread:{id:'owned',cwd:join(root,'host'),status:{type:'notLoaded'}}};return {};
   }},registry=probeSessions(root,{createHost:()=>host});
   registry.register({threadId:'owned',cwd:join(root,'host'),name:'Sim completed probe',recoveryMechanism:'durable'});
   registry.complete('owned',{outcome:'failed',ownedProcessesExited:true,evidence:'summary.json'});
   const rows=await registry.archiveCompleted(),serialized=JSON.parse(JSON.stringify(rows));
   assert.equal(rows[0].archived,true,'unknown helper cleanup does not undo an actual native archive acknowledgement');
   assert.deepEqual(serialized[0].metadataHostCloseProof,proof??{hostPid:444,groupClosed:false,groupVerification:'unverified'},'the existing array JSON output retains both verified and unknown cleanup evidence');
   const session=registry.snapshot().sessions[0];assert.ok(session.archivedAt);assert.equal(session.outcome,'failed');assert.equal(session.evidence,'summary.json');
   assert.deepEqual(calls.filter(c=>c.method==='thread/archive').map(c=>c.args.threadId),['owned']);
   assert.equal(calls.some(c=>['thread/start','thread/resume'].includes(c.method)),false);
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});

test('a thrown archival helper close reports incomplete after preserving native acknowledgement',async()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probe-metadata-close-error-')),closeError=Error('synthetic metadata close failure');
 try{
  const registry=probeSessions(root,{createHost:()=>({send(){},close:async()=>{throw closeError;},request:async(method)=>method==='thread/read'?{thread:{id:'owned',cwd:join(root,'host'),status:{type:'idle'}}}:{}})});
  registry.register({threadId:'owned',cwd:join(root,'host'),name:'Sim completed probe',recoveryMechanism:'durable'});
  registry.complete('owned',{outcome:'passed',ownedProcessesExited:true,evidence:'summary.json'});
  const rows=await registry.archiveCompleted();assert.equal(rows[0].archived,true);assert.equal(probeArchivalStatus(rows).status,'incomplete');assert.equal(rows[0].metadataHostCloseProof.closeError,closeError.message);
  assert.ok(registry.snapshot().sessions[0].archivedAt,'the acknowledged native archive remains a fact despite helper-close failure');
 }finally{rmSync(root,{recursive:true,force:true});}
});

const metadataProof=pid=>({hostPid:pid,groupClosed:true,groupVerification:'absent'});
function completedRegistry(root,options){const registry=probeSessions(root,options);registry.register({threadId:'owned',cwd:join(root,'host'),name:'Sim exact completed probe',recoveryMechanism:'durable original thread and journal'});registry.complete('owned',{outcome:'failed',ownedProcessesExited:true,evidence:'original-failed-outcome.json'});return registry;}
test('bounded archive retries use fresh verified-closed helpers and preserve original failure evidence',async()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probe-retry-')),calls=[],sleeps=[];let helpers=0;
 try{
  const registry=completedRegistry(root,{sleep:async ms=>sleeps.push(ms),createHost:options=>{
   const attempt=++helpers;assert.equal(options.requestTimeoutMs,3000);
   return {pid:400+attempt,send(){},close:async()=>{calls.push([attempt,'close']);return metadataProof(400+attempt);},request:async(method,args)=>{
    calls.push([attempt,method,args]);if(method==='thread/read')return {thread:{id:'owned',cwd:join(root,'host'),status:{type:'notLoaded'}}};if(method==='thread/archive'&&attempt===1)throw Error('temporary native metadata failure');return {};
   }};
  }});
  const rows=await registry.archiveCompleted();assert.equal(helpers,2);assert.deepEqual(sleeps,[100]);assert.equal(rows[0].archived,true);assert.equal(rows[0].attempts.length,2);
  assert.ok(calls.findIndex(c=>c[0]===1&&c[1]==='close')<calls.findIndex(c=>c[0]===2&&c[1]==='initialize'));
  assert.deepEqual(probeArchivalStatus(rows),{status:'acknowledged',acknowledgedThreadIds:['owned'],failedThreadIds:[],metadataCleanupVerified:true,sidebarVerification:'not-checked'});
  const saved=registry.snapshot().sessions[0];assert.equal(saved.outcome,'failed');assert.equal(saved.evidence,'original-failed-outcome.json');assert.equal(saved.name,'Sim exact completed probe');assert.ok(saved.archivedAt);assert.equal(saved.archiveError,undefined);
  assert.equal(calls.some(c=>['thread/start','thread/resume','turn/start'].includes(c[1])),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('metadata setup failure exhausts exactly three closed-helper passes and remains retryable',async()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probe-retry-')),sleeps=[];let helpers=0;
 try{
  const registry=completedRegistry(root,{sleep:async ms=>sleeps.push(ms),createHost:()=>{const pid=500+(++helpers);return {pid,send(){},close:async()=>metadataProof(pid),request:async()=>{throw Error('initialize unavailable');}};}});
  const rows=await registry.archiveCompleted();assert.equal(helpers,3);assert.deepEqual(sleeps,[100,100]);assert.equal(rows[0].attempts.length,3);assert.equal(rows[0].archived,false);assert.equal(probeArchivalStatus(rows).status,'incomplete');assert.deepEqual(probeArchivalStatus(rows).failedThreadIds,['owned']);assert.ok(!registry.snapshot().sessions[0].archivedAt);assert.equal(registry.snapshot().sessions[0].evidence,'original-failed-outcome.json');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('unverified helper closure prevents another retry even after a native archive acknowledgement',async()=>{
 for(const acknowledged of [true,false]){
  const root=mkdtempSync(join(tmpdir(),'souls-probe-retry-'));let helpers=0;
  try{
   const registry=completedRegistry(root,{sleep:async()=>assert.fail('no retry gap after unverified cleanup'),createHost:()=>{helpers++;return {pid:600,send(){},close:async()=>({hostPid:600,groupClosed:false,groupVerification:'unverified'}),request:async method=>{if(method==='thread/read')return {thread:{id:'owned',cwd:join(root,'host'),status:{type:'idle'}}};if(method==='thread/archive'&&!acknowledged)throw Error('archive refused');return {};}};}});
   const rows=await registry.archiveCompleted();assert.equal(helpers,1);assert.equal(rows[0].archived,acknowledged);assert.equal(probeArchivalStatus(rows).status,'incomplete');assert.equal(probeArchivalStatus(rows).metadataCleanupVerified,false);assert.equal(!!registry.snapshot().sessions[0].archivedAt,acknowledged);
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});
test('a retry rechecks native status and never archives a now-active or mismatched thread',async()=>{
 for(const blocked of ['active','foreign','foreign-id']){
  const root=mkdtempSync(join(tmpdir(),'souls-probe-retry-'));let helpers=0,archives=0;
  try{
   const registry=completedRegistry(root,{sleep:async()=>{},createHost:()=>{const pass=++helpers;return {send(){},close:async()=>metadataProof(700+pass),request:async method=>{
    if(method==='thread/read'){if(pass===1)throw Error('transient read unavailable');return {thread:{id:blocked==='foreign-id'?'other':'owned',cwd:blocked==='foreign'?'/unrelated':join(root,'host'),status:{type:blocked==='active'?'active':'idle'}}};}
    if(method==='thread/archive')archives++;return {};
   }};}});
   const rows=await registry.archiveCompleted();assert.equal(helpers,2);assert.equal(archives,0);assert.equal(rows[0].attempts.at(-1).blocked,true);assert.equal(probeArchivalStatus(rows).status,'incomplete');
  }finally{rmSync(root,{recursive:true,force:true});}
 }
});

test('missing expected archive rows cannot certify a completed sidebar cleanup',()=>{
 const status=probeArchivalStatus([],{expectedThreadIds:['exact-owned-thread']});assert.equal(status.status,'incomplete');assert.deepEqual(status.failedThreadIds,['exact-owned-thread']);assert.equal(status.sidebarVerification,'not-checked');
});

test('unverified metadata cleanup blocks fresh helpers across registry invocations and restart',async()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probe-cleanup-marker-'));let helpers=0;
 const options={createHost:()=>{helpers++;return {pid:811,send(){},close:async()=>({hostPid:811,groupClosed:false,groupVerification:'unverified'}),request:async method=>{if(method==='thread/read')return {thread:{id:'owned',cwd:join(root,'host'),status:{type:'idle'}}};return {};}};}};
 try{
  const registry=completedRegistry(root,options),first=await registry.archiveCompleted();assert.equal(first[0].archived,true);assert.equal(probeArchivalStatus(first).status,'incomplete');
  const marker=registry.snapshot().metadataCleanupPending;assert.equal(marker.hostPid,811);assert.equal(marker.groupVerification,'unverified');
  for(const reopened of [registry,probeSessions(root,options)]){
   const rows=await reopened.archiveCompleted();assert.equal(helpers,1,'unknown prior group must not accumulate another helper');assert.equal(rows[0].archived,true,'retain original archive ACK');assert.equal(rows[0].blockedReason,'METADATA_CLEANUP_PENDING');assert.equal(probeArchivalStatus(rows).status,'incomplete');assert.deepEqual(reopened.snapshot().metadataCleanupPending,marker);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('an archive ACK and helper proof survive registry persistence failure without another retry',async()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probe-persist-failure-'));let helpers=0;
 try{
  const registry=completedRegistry(root,{sleep:async()=>assert.fail('storage failure must stop retries'),createHost:()=>{helpers++;return {pid:812,send(){},close:async()=>metadataProof(812),request:async method=>{
   if(method==='thread/read')return {thread:{id:'owned',cwd:join(root,'host'),status:{type:'idle'}}};
   if(method==='thread/archive')writeFileSync(join(root,'probe-sessions.json.lock'),'synthetic contention',{flag:'wx'});return {};
  }};}});
  const rows=await registry.archiveCompleted();assert.equal(helpers,1);assert.equal(rows[0].archived,true);assert.equal(rows[0].attempts[0].acknowledged,true);assert.ok(rows[0].persistenceError);assert.equal(rows[0].metadataHostCloseProof.groupClosed,true);assert.equal(probeArchivalStatus(rows).status,'incomplete');assert.ok(!registry.snapshot().sessions[0].archivedAt,'native ACK is not misrepresented as a successful durable registry update');assert.equal(registry.snapshot().sessions[0].evidence,'original-failed-outcome.json');
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('ephemeral archival exemptions are explicit N/A and never native archive acknowledgements',async()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probe-ephemeral-'));let helpers=0;
 try{
  const registry=probeSessions(root,{createHost:()=>{helpers++;assert.fail('no ephemeral metadata/archive');}});
  registry.register({threadId:'temporary',cwd:join(root,'seat'),name:'Local readable label',ephemeral:true,recoveryMechanism:'singleexec ephemeral; no resume'});
  registry.complete('temporary',{outcome:'failed',ownedProcessesExited:true,evidence:'unchanged-summary.json'});
  const rows=await registry.archiveCompleted(),status=probeArchivalStatus(rows,{expectedThreadIds:['temporary'],ephemeralThreadIds:['temporary']});
  assert.deepEqual(rows,[]);assert.equal(helpers,0);assert.equal(status.status,'not-applicable');assert.deepEqual(status.notApplicableThreadIds,['temporary']);assert.deepEqual(status.acknowledgedThreadIds,[]);assert.equal(status.persistenceVerification,'not-checked');assert.equal(status.sidebarVerification,'not-checked');
  const saved=registry.snapshot().sessions[0];assert.equal(saved.ephemeral,true);assert.equal(saved.outcome,'failed');assert.equal(saved.evidence,'unchanged-summary.json');assert.ok(!saved.archivedAt);
  assert.throws(()=>registry.register({threadId:'temporary',cwd:join(root,'seat'),name:'Local readable label',ephemeral:false,recoveryMechanism:'durable'}),/identity changed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('mixed durable/ephemeral archival still requires every durable ACK and helper closure',()=>{
 const options={expectedThreadIds:['durable','temporary'],ephemeralThreadIds:['temporary']};
 assert.deepEqual(probeArchivalStatus([],options).failedThreadIds,['durable']);
 const row={threadId:'durable',archived:true,metadataHostCloseProof:{groupClosed:true,groupVerification:'absent'}};
 assert.equal(probeArchivalStatus([row],options).status,'acknowledged');assert.deepEqual(probeArchivalStatus([row],options).acknowledgedThreadIds,['durable']);
 assert.equal(probeArchivalStatus([{...row,metadataHostCloseProof:{groupClosed:false,groupVerification:'unverified'}}],options).status,'incomplete');
 assert.equal(probeArchivalStatus([{...row,threadId:'temporary'}],{expectedThreadIds:['temporary'],ephemeralThreadIds:['temporary']}).status,'incomplete','a contradictory native archive row is not ephemeral N/A');
 assert.throws(()=>probeArchivalStatus([],{expectedThreadIds:[],ephemeralThreadIds:['unrecorded']}),/recorded expected thread/);
});


test('registry refuses truthy nonboolean ephemeral exemptions before recording ownership',()=>{
 const root=mkdtempSync(join(tmpdir(),'souls-probe-mode-'));
 try{
  const registry=probeSessions(root);
  for(const ephemeral of ['true','false',1,null])assert.throws(()=>registry.register({threadId:'owned',cwd:join(root,'seat'),name:'Sim owned',recoveryMechanism:'single exec',ephemeral}),/boolean ephemeral mode/);
  assert.deepEqual(registry.snapshot().sessions,[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
