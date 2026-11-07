// Fences local decision owners and journals uncertain world effects. A lease
// cannot recall an already-sent HTTP request; a successor must reconcile it.
import {randomUUID} from 'node:crypto';
import {encodeResponse,responseReference,responseChunk,validateResponseArguments} from './responses.mjs';
import {inspectOwnedProcess} from './controller-ownership.mjs';
const json = value => {const s=JSON.stringify(value);if(s===undefined||Buffer.byteLength(s)>65536)throw Error('Control record must be JSON <=64KiB');return s;};
const key = v => {if(typeof v!=='string'||!v.length||v.length>200)throw Error('Invalid control key');return v;};
/** Is this exact process gone? Only a clean answer counts: no such pid, or that pid started at another time. Anything else is alive. */
export function processGone({pid,startToken},inspect=inspectOwnedProcess){try{const p=inspect(pid);return p===null||p.startToken!==startToken;}catch{return false;}}
const selfIdentity=()=>{try{const p=inspectOwnedProcess(process.pid);return p?{pid:p.pid,startToken:p.startToken}:null;}catch{return null;}};
export function attachControl(db,{now,transaction,self=selfIdentity,holderGone=processGone}){
 db.exec(`CREATE TABLE IF NOT EXISTS controller(singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL, generation INTEGER NOT NULL, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS checkpoint(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, request TEXT NOT NULL, status TEXT NOT NULL, response TEXT, at INTEGER NOT NULL, generation INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS read_response_v1(singleton INTEGER PRIMARY KEY CHECK(singleton=1),decision_id TEXT NOT NULL,response TEXT NOT NULL,resync_through INTEGER);
 CREATE TABLE IF NOT EXISTS startup_response_v1(singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL,response TEXT NOT NULL);`);
 // #471: who holds the lease, so a successor needn't wait out a dead holder's TTL. Rows from before this have none, and wait.
 if(!db.prepare('PRAGMA table_info(controller)').all().some(r=>r.name==='holder_pid'))db.exec('ALTER TABLE controller ADD COLUMN holder_pid INTEGER; ALTER TABLE controller ADD COLUMN holder_start TEXT');
 if(!db.prepare('PRAGMA table_info(read_response_v1)').all().some(r=>r.name==='resync_through'))db.exec('ALTER TABLE read_response_v1 ADD COLUMN resync_through INTEGER');
 let mine;
 const ttl=v=>{if(!Number.isSafeInteger(v)||v<1000||v>60000)throw Error('Lease TTL must be1..60seconds');return v;};
 const current=()=>db.prepare('SELECT owner,generation,expires_at,holder_pid,holder_start FROM controller WHERE singleton=1').get();
 const guard=fence=>{const c=current();if(!c||c.owner!==fence?.owner||c.generation!==fence?.generation||c.expires_at<=now())throw Error('Controller lease lost');return c;};
 const op=id=>{const r=db.prepare('SELECT * FROM operations WHERE id=?').get(key(id));if(!r)throw Error('Unknown operation');return r;};
 const unpack=r=>r?{id:r.id,request:JSON.parse(r.request),status:r.status,response:r.response?JSON.parse(r.response):null,at:r.at,generation:r.generation}:null;
 return {
  claim(owner=randomUUID(),leaseMs=15000){key(owner);ttl(leaseMs);
   // ps runs outside the transaction, and the row must be the one it judged: a new holder in between is never displaced.
   const seen=current(),vacated=seen&&seen.expires_at>now()&&seen.holder_pid!==null&&seen.holder_start!==null&&holderGone({pid:seen.holder_pid,startToken:seen.holder_start}),me=(mine??=self());
   return transaction(()=>{const c=current();if(c&&c.expires_at>now()&&!(vacated&&c.owner===seen.owner&&c.generation===seen.generation))throw Object.assign(Error('Controller already active'),{code:'CONTROLLER_BUSY',expiresAt:c.expires_at,transient:true});const generation=(c?.generation??0)+1;const expiresAt=now()+leaseMs;db.prepare('INSERT INTO controller(singleton,owner,generation,expires_at,holder_pid,holder_start) VALUES(1,?,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET owner=excluded.owner,generation=excluded.generation,expires_at=excluded.expires_at,holder_pid=excluded.holder_pid,holder_start=excluded.holder_start').run(owner,generation,expiresAt,me?.pid??null,me?.startToken??null);return {owner,generation,expiresAt};});},
  renew(fence,leaseMs=15000){ttl(leaseMs);return transaction(()=>{guard(fence);const expiresAt=now()+leaseMs;db.prepare('UPDATE controller SET expires_at=? WHERE singleton=1').run(expiresAt);return {...fence,expiresAt};});},
  release(fence){return transaction(()=>{guard(fence);db.prepare('UPDATE controller SET expires_at=0 WHERE singleton=1').run();});},
  assertOwner(fence){guard(fence);},
  checkpoint(){const r=db.prepare('SELECT revision,payload,at FROM checkpoint WHERE singleton=1').get();return r?{revision:r.revision,value:JSON.parse(r.payload),at:r.at}:{revision:0,value:null,at:null};},
  save(fence,expectedRevision,value){const payload=json(value);return transaction(()=>{guard(fence);const r=db.prepare('SELECT revision FROM checkpoint WHERE singleton=1').get();if((r?.revision??0)!==expectedRevision)throw Error('Checkpoint revision conflict');const revision=expectedRevision+1;db.prepare('INSERT INTO checkpoint VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,at=excluded.at').run(revision,payload,now());return revision;});},
  prepare(fence,id,request){key(id);const payload=json(request);return transaction(()=>{guard(fence);const old=db.prepare('SELECT * FROM operations WHERE id=?').get(id);if(old){if(old.request!==payload)throw Error('Operation key reused');return unpack(old);}if(db.prepare("SELECT id FROM operations WHERE status IN ('dispatching','uncertain') LIMIT 1").get())throw Error('Uncertain operation requires reconciliation before another write');db.prepare('INSERT INTO operations VALUES(?,?,?,NULL,?,?)').run(id,payload,'prepared',now(),fence.generation);return unpack(op(id));});},
  dispatch(fence,id){return transaction(()=>{guard(fence);const r=op(id);if(r.status!=='prepared')throw Error('Operation is not safely dispatchable');if(db.prepare("SELECT id FROM operations WHERE status IN ('dispatching','uncertain') AND id<>? LIMIT 1").get(id))throw Error('Another operation requires reconciliation');db.prepare("UPDATE operations SET status='dispatching',at=?,generation=? WHERE id=?").run(now(),fence.generation,id);return unpack(op(id));});},
  uncertain(fence,id){return transaction(()=>{guard(fence);if(op(id).status!=='dispatching')throw Error('Only dispatched operations can be uncertain');db.prepare("UPDATE operations SET status='uncertain',at=? WHERE id=?").run(now(),id);});},
  settle(fence,id,response){const payload=encodeResponse(response);return transaction(()=>{guard(fence);const r=op(id);if(!['dispatching','uncertain'].includes(r.status))throw Error('Operation is not awaiting a result');db.prepare("UPDATE operations SET status='settled',response=?,at=? WHERE id=?").run(payload,now(),id);});},
  readResult(id){const r=db.prepare('SELECT response,resync_through FROM read_response_v1 WHERE singleton=1 AND decision_id=?').get(key(id));return r?{response:JSON.parse(r.response),reference:responseReference('read',id,r.response),resyncThrough:r.resync_through}:null;},
  retainReadResult(fence,id,response,{resyncThrough=null}={}){const payload=encodeResponse(response);if(resyncThrough!==null&&(!Number.isSafeInteger(resyncThrough)||resyncThrough<0))throw Error('Invalid read resync gap boundary');return transaction(()=>{
   guard(fence);key(id);const checkpoint=db.prepare('SELECT payload FROM checkpoint WHERE singleton=1').get(),pending=checkpoint?JSON.parse(checkpoint.payload).pendingDecision:null;
   if(pending?.id!==id||pending.decision?.call?.type!=='read'||pending.decision.call.command==='response')throw Error('Read response needs its current pending read decision');
   const old=db.prepare('SELECT decision_id,response,resync_through FROM read_response_v1 WHERE singleton=1').get();
   if(old?.decision_id===id&&(old.response!==payload||old.resync_through!==resyncThrough))throw Error('Read response identity reused');
   db.prepare('INSERT INTO read_response_v1(singleton,decision_id,response,resync_through) VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET decision_id=excluded.decision_id,response=excluded.response,resync_through=excluded.resync_through').run(id,payload,resyncThrough);
   return responseReference('read',id,payload);
  });},
  retainStartupResult(fence,id,response){const payload=encodeResponse(response);return transaction(()=>{guard(fence);key(id);db.prepare('INSERT INTO startup_response_v1 VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id,response=excluded.response').run(id,payload);return responseReference('startup',id,payload);});},
  response(args){validateResponseArguments(args);const {kind,id,offset=0}=args;
   const row=kind==='read'?db.prepare('SELECT response FROM read_response_v1 WHERE singleton=1 AND decision_id=?').get(id):kind==='startup'?db.prepare('SELECT response FROM startup_response_v1 WHERE singleton=1 AND id=?').get(id):db.prepare("SELECT response FROM operations WHERE id=? AND status='settled'").get(id);
   if(!row?.response)return {responseUnavailable:true,responseRef:{kind,id},reason:kind==='operation'?'unknown-or-unsettled-operation':'expired-or-unknown-'+kind+'-response'};
   return responseChunk(row.response,responseReference(kind,id,row.response),offset);
  },
  operations(){return db.prepare("SELECT * FROM operations WHERE status<>'settled' ORDER BY at,id").all().map(unpack);},
  operation(id){return unpack(op(id));},
  hasOperation(id){return !!db.prepare('SELECT id FROM operations WHERE id=?').get(key(id));},
 };
}
