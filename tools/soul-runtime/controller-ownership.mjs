// Local launcher authority only. No argv, environment, credentials, model text
// or world data is recorded. Unknown ownership never authorizes a signal.
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,lstatSync,fstatSync,realpathSync,readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,unlinkSync,constants} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {abortableSleep} from './receiver.mjs';
const fault=code=>Object.assign(Error(code+'; ownership/state retained'),{code});
const sha=value=>createHash('sha256').update(value).digest('hex');
const validPid=n=>Number.isSafeInteger(n)&&n>1;
const same=(a,b)=>a&&b&&a.pid===b.pid&&a.pgid===b.pgid&&a.startToken===b.startToken;
const MAX_BYTES=262144,MAX_CONTROLLERS=16,MAX_HOSTS=128;
function readPrivate(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>MAX_BYTES||(s.mode&0o077))throw fault('CONTROLLER_INVENTORY_UNSAFE');const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const actual=fstatSync(fd);if(actual.dev!==s.dev||actual.ino!==s.ino||!actual.isFile()||actual.nlink!==1||actual.size>MAX_BYTES||(actual.mode&0o077))throw fault('CONTROLLER_INVENTORY_UNSAFE');return JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}}
function writePrivate(path,value,{exclusive=false}={}){const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>MAX_BYTES)throw fault('CONTROLLER_INVENTORY_CAPACITY');const tmp=exclusive?path:path+'.'+randomUUID()+'.tmp';const fd=openSync(tmp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}if(!exclusive)renameSync(tmp,path);const dir=openSync(dirname(path),constants.O_RDONLY);try{fsyncSync(dir);}finally{closeSync(dir);}}
// lstart prints in the reader's zone, so TZ is pinned: one process has one startToken for every reader (#471).
export function inspectOwnedProcess(pid){
 if(!validPid(pid))throw fault('CONTROLLER_PROCESS_INVALID');let output;
 try{output=execFileSync('ps',['-p',String(pid),'-o','pid=,ppid=,pgid=,lstart='],{encoding:'utf8',timeout:500,maxBuffer:4096,stdio:['ignore','pipe','pipe'],env:{...process.env,LC_ALL:'C',TZ:'UTC'}});}catch(e){if(e.status===1&&!String(e.stdout??'').trim())return null;throw fault('CONTROLLER_PROCESS_UNKNOWN');}
 const m=output.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);if(!m||Number(m[1])!==pid)throw fault('CONTROLLER_PROCESS_UNKNOWN');return {pid,ppid:Number(m[2]),pgid:Number(m[3]),startToken:m[4]};
}
export function inspectOwnedGroup(pgid){
 let output;try{output=execFileSync('pgrep',['-g',String(pgid)],{encoding:'utf8',timeout:500,maxBuffer:4096,stdio:['ignore','pipe','pipe']});}catch(e){if(e.status===1&&!String(e.stdout??'').trim())return [];throw fault('CONTROLLER_GROUP_UNKNOWN');}
 const ids=output.trim().split(/\s+/).map(Number);if(ids.length>128||ids.some(n=>!validPid(n)))throw fault('CONTROLLER_GROUP_UNKNOWN');return ids.map(inspectOwnedProcess).filter(Boolean);
}
export function strictProcessAbsent(target,killProcess=process.kill){try{killProcess(target,0);return false;}catch(e){if(e.code==='ESRCH')return true;throw fault('CONTROLLER_ABSENCE_UNKNOWN');}}
/** Post-death SQLite projection; private payload is only hashed in memory. */
export function readControllerSnapshot(path){
 let db;const before=lstatSync(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw fault('CONTROLLER_JOURNAL_UNSAFE');
 try{db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA busy_timeout=100; BEGIN');const identity=db.prepare('SELECT world,soul FROM identity WHERE singleton=1').get(),c=db.prepare('SELECT revision,payload FROM checkpoint WHERE singleton=1').get(),owner=db.prepare('SELECT owner,generation FROM controller WHERE singleton=1').get();if(!identity||c&&Buffer.byteLength(c.payload)>65536)throw fault('CONTROLLER_SNAPSHOT_INVALID');const value=c?JSON.parse(c.payload):null,ops=db.prepare("SELECT id,status,generation FROM operations WHERE status<>'settled' ORDER BY id LIMIT 65").all();if(ops.length>64)throw fault('CONTROLLER_OPERATION_CAPACITY');db.exec('COMMIT');const after=lstatSync(path);if(before.dev!==after.dev||before.ino!==after.ino)throw fault('CONTROLLER_JOURNAL_CHANGED');return {journalIdentity:sha(`${realpathSync(path)}:${before.dev}:${before.ino}`),worldId:identity.world,soulId:identity.soul,revision:c?.revision??0,valueSha256:sha(JSON.stringify(value)),threadId:value?.threadId??null,instructionSha256:sha(JSON.stringify(value?.initialInstruction??null)),generation:owner?.generation??0,ownerSha256:owner?sha(owner.owner):null,recoveryPending:!!(value?.pendingDecision||value?.decisionProgressV1||value?.urgentRecoveryV1||ops.length),operations:ops.map(o=>({...o}))};}finally{db?.close();}
}
function validateLedger(ledger,path){if(ledger?.version!==1||typeof ledger.id!=='string'||ledger.path!==path||!Array.isArray(ledger.controllers)||ledger.controllers.length>MAX_CONTROLLERS||ledger.controllers.reduce((n,c)=>n+(c.hosts?.length??MAX_HOSTS+1),0)>MAX_HOSTS)throw fault('CONTROLLER_INVENTORY_INVALID');return ledger;}
/** Reserve before spawning; register before any host connect or model turn. */
export function createControllerOwner({state,inspectProcess=inspectOwnedProcess,inspectGroup=inspectOwnedGroup,killProcess=process.kill,sleep=abortableSleep,now=Date.now}={}){
 const directory=resolve(state);mkdirSync(directory,{recursive:true,mode:0o700});if(lstatSync(directory).isSymbolicLink())throw fault('CONTROLLER_INVENTORY_UNSAFE');const path=join(realpathSync(directory),'controller-ownership.json'),lock=path+'.lock',launcher=inspectProcess(process.pid);if(!launcher)throw fault('CONTROLLER_PROCESS_UNKNOWN');
 writePrivate(lock,{launcher,at:now()},{exclusive:true});let ledger,failure=null;
 try{
  let existing;try{existing=readPrivate(path);}catch(e){if(e.code!=='ENOENT')throw e;}
  ledger=existing?validateLedger(existing,path):{version:1,id:randomUUID(),path,controllers:[]};
  if(ledger.controllers.some(c=>c.state!=='closed'))throw fault('CONTROLLER_PRIOR_OWNER_UNCONFIRMED');
  if(ledger.controllers.length){
   let hadJournal=false;
   for(const c of ledger.controllers){
    let proof;try{proof=readPrivate(c.proofPath);}catch{throw fault('CONTROLLER_PRIOR_OWNER_UNCONFIRMED');}
    if(!c.birth||!c.exit||c.proofSha256!==sha(JSON.stringify(proof))||proof.epoch!==c.epoch||proof.inventoryId!==ledger.id||c.hosts.some(h=>h.state!=='closed'||!h.birth||h.closeProof?.hostPid!==h.birth.pid||h.closeProof.groupClosed!==true||h.closeProof.groupVerification!=='absent'))throw fault('CONTROLLER_PRIOR_OWNER_UNCONFIRMED');
    hadJournal||=!!proof.snapshot;
   }
   let snapshot=null;try{snapshot=readControllerSnapshot(join(directory,'continuity.sqlite'));}catch(e){if(e.code!=='ENOENT')throw e;if(hadJournal)throw fault('CONTROLLER_PRIOR_JOURNAL_MISSING');}
   if(snapshot?.recoveryPending)throw fault('CONTROLLER_PRIOR_RECOVERY_PENDING');
   const previous=ledger;writePrivate(path+'.'+previous.id+'.closed.json',previous,{exclusive:true});ledger={version:1,id:randomUUID(),path,controllers:[],previousInventoryId:previous.id};writePrivate(path,ledger);
  }
 }catch(e){unlinkSync(lock);throw e;}

 const save=()=>{if(failure)throw failure;try{writePrivate(path,ledger);}catch(e){failure=e;throw e;}};
 const absent=target=>strictProcessAbsent(target,killProcess);
 // Darwin: kill(-pgid,0) returns EPERM while every member is exiting/zombie (reproduced). That is
 // neither absence nor a signalable owner: wait (never signal) until ESRCH or the cleanup deadline.
 const groupGone=async(pgid,deadline)=>{for(;;){try{killProcess(-pgid,0);return false;}catch(e){if(e.code==='ESRCH')return true;if(e.code!=='EPERM')throw fault('CONTROLLER_ABSENCE_UNKNOWN');}if(now()>=deadline)throw fault('CONTROLLER_HOST_CLEANUP_UNVERIFIED');await sleep(25);}};
 const anchor=(host)=>{
  const leader=inspectProcess(host.birth.pid);if(!leader)throw fault('CONTROLLER_HOST_LEADER_GONE');if(!same(leader,host.birth))throw fault('CONTROLLER_HOST_BIRTH_CHANGED');
  const members=inspectGroup(host.birth.pgid),map=new Map(members.map(p=>[p.pid,p]));if(!map.has(leader.pid))throw fault('CONTROLLER_GROUP_UNKNOWN');
  for(const p of members){if(p.pgid!==host.birth.pgid)throw fault('CONTROLLER_GROUP_UNKNOWN');let current=p,seen=new Set();while(current.pid!==leader.pid){if(seen.has(current.pid)||!map.has(current.ppid))throw fault('CONTROLLER_GROUP_ANCESTRY_UNKNOWN');seen.add(current.pid);current=map.get(current.ppid);}}
  return members;
 };
 const cleanup=async(host,deadline)=>{
  if(host.state==='starting'||!host.birth)throw fault('CONTROLLER_HOST_RESERVATION_INCOMPLETE');
  if(host.state==='closed'){if(host.closeProof?.hostPid!==host.birth.pid||host.closeProof.groupClosed!==true||host.closeProof.groupVerification!=='absent')throw fault('CONTROLLER_HOST_CLOSURE_INVALID');return 'prior-verified';}
  if(await groupGone(host.birth.pgid,deadline)){if(host.state!=='closed'&&!absent(host.birth.pid))throw fault('CONTROLLER_HOST_BIRTH_CHANGED');return;}
  let members;
  for(const [signal,grace] of [['SIGTERM',1000],['SIGKILL',5000]]){
   // Revalidate the exact live birth/ancestry immediately before each signal.
   if(now()>=deadline)throw fault('CONTROLLER_HOST_CLEANUP_UNVERIFIED');
   try{members=anchor(host);}catch(e){if(e.code!=='CONTROLLER_HOST_LEADER_GONE'&&!(await groupGone(host.birth.pgid,deadline)&&absent(host.birth.pid)))throw e;while(now()<deadline){if(await groupGone(host.birth.pgid,deadline)&&absent(host.birth.pid))return;await sleep(25);}if(await groupGone(host.birth.pgid,deadline)&&absent(host.birth.pid))return;throw fault('CONTROLLER_HOST_CLEANUP_UNVERIFIED');}
   try{killProcess(-host.birth.pgid,signal);}catch(e){if(e.code!=='ESRCH'&&e.code!=='EPERM')throw fault('CONTROLLER_CLEANUP_SIGNAL_UNKNOWN');}
   const end=Math.min(deadline,now()+grace);while(now()<end){if(await groupGone(host.birth.pgid,deadline)&&members.every(p=>absent(p.pid)))return;await sleep(25);}
   if(await groupGone(host.birth.pgid,deadline)&&members.every(p=>absent(p.pid)))return;
  }
  throw fault('CONTROLLER_HOST_CLEANUP_UNVERIFIED');
 };
 return {path,
  reserveController(reentryPath=null){if(ledger.controllers.length>=MAX_CONTROLLERS||ledger.controllers.reduce((n,c)=>n+c.hosts.length,0)>=MAX_HOSTS)throw fault('CONTROLLER_INVENTORY_CAPACITY');const epoch=randomUUID();ledger.controllers.push({epoch,launcher,birth:null,state:'starting',hosts:[],reentryPath,at:now()});save();return epoch;},
  registerController(epoch,pid){const c=ledger.controllers.find(c=>c.epoch===epoch);if(c?.state!=='starting')throw fault('CONTROLLER_RESERVATION_INVALID');const birth=inspectProcess(pid);if(!birth||birth.ppid!==launcher.pid||birth.pid===launcher.pid||birth.pgid===pid)throw fault('CONTROLLER_BIRTH_UNPROVEN');c.birth=birth;c.state='running';save();},
  environment(epoch){return {...process.env,SIM_SOUL_CONTROLLER_INVENTORY:path,SIM_SOUL_CONTROLLER_EPOCH:epoch};},
  async controllerExited(epoch,exit){ledger=validateLedger(readPrivate(path),path);const c=ledger.controllers.find(c=>c.epoch===epoch);if(!c?.birth||c.birth.ppid!==c.launcher.pid||!same(c.launcher,launcher)||!['running','exited'].includes(c.state))throw fault('CONTROLLER_BIRTH_UNPROVEN');if(!absent(c.birth.pid))throw fault('CONTROLLER_EXIT_UNVERIFIED');c.state='exited';c.exit={code:exit.code??null,signal:exit.signal??null,at:now()};save();
   const cleanupDeadline=now()+6000;for(const host of c.hosts){if(host.birth&&(!validPid(host.birth.pid)||host.birth.ppid!==c.birth.pid||host.birth.pgid!==host.birth.pid||host.birth.pgid===launcher.pgid||host.birth.pgid===c.birth.pgid))throw fault('CONTROLLER_GROUP_UNSAFE');const prior=await cleanup(host,cleanupDeadline);host.closure=prior??'post-exit';host.state='closed';if(prior!=='prior-verified')host.closeProof={hostPid:host.birth.pid,groupClosed:true,groupVerification:'absent',verifiedAt:now()};save();}
   let snapshot=null;try{snapshot=readControllerSnapshot(join(directory,'continuity.sqlite'));}catch(e){if(e.code!=='ENOENT')throw e;}
   const proof={version:1,id:randomUUID(),inventoryId:ledger.id,epoch,launcher,controller:c.birth,exit:c.exit,hosts:c.hosts.map(h=>({birth:h.birth,closeProof:h.closeProof,closure:h.closure})),snapshot,at:now()};
   const proofPath=path+'.'+epoch+'.reentry.json';writePrivate(proofPath,proof,{exclusive:true});c.state='closed';c.proofPath=proofPath;c.proofSha256=sha(JSON.stringify(proof));save();return proofPath;
  },
  close(){if(ledger.controllers.some(c=>c.state!=='closed'))throw fault('CONTROLLER_INVENTORY_UNCLOSED');unlinkSync(lock);},
 };
}
export async function openControllerInventory({path=process.env.SIM_SOUL_CONTROLLER_INVENTORY,epoch=process.env.SIM_SOUL_CONTROLLER_EPOCH,inspectProcess=inspectOwnedProcess,sleep=abortableSleep,now=Date.now}={}){
 if(!path||!epoch)return null;path=resolve(path);const deadline=now()+2000;let ledger,c;
 while(true){ledger=validateLedger(readPrivate(path),path);c=ledger.controllers.find(c=>c.epoch===epoch);if(!c)throw fault('CONTROLLER_RESERVATION_INVALID');if(c.state==='running')break;if(c.state!=='starting'||now()>=deadline)throw fault('CONTROLLER_BIRTH_UNPROVEN');await sleep(10);}
 const actual=inspectProcess(process.pid);if(!same(c.birth,actual)||actual.ppid!==c.launcher.pid||!same(c.launcher,inspectProcess(c.launcher.pid)))throw fault('CONTROLLER_BIRTH_UNPROVEN');let failure=null;
 const update=fn=>{if(failure)throw failure;try{const next=validateLedger(readPrivate(path),path),row=next.controllers.find(x=>x.epoch===epoch);if(row?.state!=='running'||!same(row.birth,actual))throw fault('CONTROLLER_RESERVATION_INVALID');fn(row,next);writePrivate(path,next);}catch(e){failure=e;throw e;}};
 let reentryProof=null;if(c.reentryPath){const previous=ledger.controllers.find(row=>row.proofPath===c.reentryPath);reentryProof=readPrivate(c.reentryPath);if(previous?.state!=='closed'||previous.proofSha256!==sha(JSON.stringify(reentryProof))||reentryProof.inventoryId!==ledger.id||reentryProof.epoch!==previous.epoch)throw fault('CONTROLLER_REENTRY_PROOF_INVALID');}
 return {reentryProof,
  reserveHost(){const id=randomUUID();update((row,all)=>{if(all.controllers.reduce((n,c)=>n+c.hosts.length,0)>=MAX_HOSTS)throw fault('CONTROLLER_INVENTORY_CAPACITY');row.hosts.push({id,state:'starting',at:now()});});return id;},
  registerHost(id,pid){update(row=>{const host=row.hosts.find(h=>h.id===id),birth=inspectProcess(pid);if(host?.state!=='starting'||!birth||birth.ppid!==actual.pid||birth.pid!==birth.pgid)throw fault('CONTROLLER_HOST_BIRTH_UNPROVEN');host.birth=birth;host.state='registered';});},
  hostClosed(id,proof){update(row=>{const h=row.hosts.find(h=>h.id===id);if(!h?.birth||proof?.hostPid!==h.birth.pid)throw fault('CONTROLLER_HOST_CLOSURE_INVALID');h.closeProof={hostPid:proof.hostPid,threadId:proof.threadId??null,groupClosed:proof.groupClosed===true,groupVerification:proof.groupVerification,at:now()};if(proof.groupClosed===true&&proof.groupVerification==='absent')h.state='closed';});},
 };
}
/** Recheck all absence and exact durable snapshot after acquiring new fence. */
export function verifyControllerReentry(proof,{journalPath,scope,fence,killProcess=process.kill}={}){
 if(proof?.version!==1||typeof proof.id!=='string'||!Array.isArray(proof.hosts)||proof.hosts.length>MAX_HOSTS||!validPid(proof.controller?.pid)||!proof.exit||!proof.snapshot||proof.hosts.some(h=>!validPid(h.birth?.pid)||h.birth.pgid!==h.birth.pid))throw fault('CONTROLLER_REENTRY_PROOF_INVALID');
 const before=proof.snapshot,actual=readControllerSnapshot(journalPath);if(before.worldId!==scope.worldId||before.soulId!==scope.soulId||before.journalIdentity!==actual.journalIdentity||before.revision!==actual.revision||before.valueSha256!==actual.valueSha256||before.threadId!==actual.threadId||before.instructionSha256!==actual.instructionSha256||JSON.stringify(before.operations)!==JSON.stringify(actual.operations)||fence.generation!==before.generation+1||actual.generation!==fence.generation||before.ownerSha256===actual.ownerSha256)throw fault('CONTROLLER_REENTRY_BINDING_CHANGED');
 if(!strictProcessAbsent(proof.controller.pid,killProcess))throw fault('CONTROLLER_REENTRY_WRITER_PRESENT');
 for(const h of proof.hosts){if(!h.birth||h.closeProof?.hostPid!==h.birth.pid||h.closeProof.groupClosed!==true||h.closeProof.groupVerification!=='absent'||!['prior-verified','post-exit'].includes(h.closure)||h.closure==='post-exit'&&!strictProcessAbsent(-h.birth.pgid,killProcess))throw fault('CONTROLLER_REENTRY_GROUP_UNVERIFIED');}
 return proof.id;
}
