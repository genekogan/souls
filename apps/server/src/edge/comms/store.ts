// Core-Comms persistence. Comms keeps its own world-scoped SQLite tables instead of
// appending to the world event log: the log's EventKind union is closed and folded by
// the engine, so new kinds there would change replay. These tables are created
// idempotently and never read by the world fold.
import type {DatabaseSync} from 'node:sqlite';

export type Sql = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS edge_comms_stream (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, seq INTEGER NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (world_id, soul_id, seq)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edge_comms_stream_at ON edge_comms_stream (world_id, soul_id, at);
CREATE TABLE IF NOT EXISTS edge_comms_heads (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, head INTEGER NOT NULL, floor INTEGER NOT NULL, PRIMARY KEY (world_id, soul_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_receipts_seen (world_id TEXT NOT NULL, receipt_id TEXT NOT NULL, phase TEXT NOT NULL, PRIMARY KEY (world_id, receipt_id, phase)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_speech (world_id TEXT NOT NULL, id TEXT NOT NULL, soul_id TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, channel TEXT NOT NULL, text TEXT NOT NULL, heard_by TEXT NOT NULL, PRIMARY KEY (world_id, id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edge_comms_speech_at ON edge_comms_speech (world_id, at);
CREATE TABLE IF NOT EXISTS edge_comms_conversations (world_id TEXT NOT NULL, id TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (world_id, id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edge_comms_conversations_open ON edge_comms_conversations (world_id, state);
CREATE TABLE IF NOT EXISTS edge_comms_turn_names_v1(world_id TEXT NOT NULL,conversation_id TEXT NOT NULL,seq INTEGER NOT NULL,name TEXT NOT NULL,PRIMARY KEY(world_id,conversation_id,seq)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_turns (world_id TEXT NOT NULL, conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, soul_id TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (world_id, conversation_id, seq)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_subscriptions (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL, cursor INTEGER NOT NULL, created_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (world_id, soul_id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_objects (world_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (world_id, id)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_object_log (world_id TEXT NOT NULL, object_id TEXT NOT NULL, version INTEGER NOT NULL, soul_id TEXT, action TEXT NOT NULL, params TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, object_id, version)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_object_tombstones_v1 (world_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, listed INTEGER NOT NULL, state TEXT NOT NULL, gone_at INTEGER NOT NULL, gone_tick INTEGER NOT NULL, PRIMARY KEY (world_id, id));
CREATE TABLE IF NOT EXISTS edge_comms_object_refs (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, client_ref TEXT NOT NULL, response TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, soul_id, client_ref)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS edge_comms_work (world_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, dedupe TEXT, created_at INTEGER NOT NULL, claimed_at INTEGER, claimed_by TEXT, completed_at INTEGER, body TEXT NOT NULL, result TEXT, PRIMARY KEY (world_id, id)) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS edge_comms_work_dedupe ON edge_comms_work (world_id, dedupe) WHERE dedupe IS NOT NULL;
CREATE TABLE IF NOT EXISTS edge_comms_digests (world_id TEXT NOT NULL, written_at INTEGER NOT NULL, day INTEGER NOT NULL, phase TEXT NOT NULL, text TEXT NOT NULL, work_id TEXT, PRIMARY KEY (world_id, written_at)) WITHOUT ROWID;
`;

export function ensureCommsSchema(db: Sql): void { db.exec(SCHEMA); }

let savepoints = 0;
type CommitFrame={callbacks:(()=>void)[];untrackedParent:boolean};
type CommitContext={frames:CommitFrame[];ready:(()=>void)[];draining:boolean};
const contexts=new WeakMap<Sql,CommitContext>();
function context(db:Sql){let c=contexts.get(db);if(!c){c={frames:[],ready:[],draining:false};contexts.set(db,c);}return c;}
function notifyCommitted(c:CommitContext,callbacks:(()=>void)[]){
 c.ready.push(...callbacks);if(c.draining)return;
 c.draining=true;
 try{while(c.ready.length){const callback=c.ready.shift()!;try{callback();}catch{/* committed observer faults cannot undo data or skip later observers */}}}
 finally{c.draining=false;}
}
/** Advisory notifications run synchronously after the outer tracked commit.
 * Nested success merges in order; rollback discards the matching callbacks.
 * Raw untracked SQL transactions cannot safely publish and refuse before an
 * inner savepoint releases. Callers that publish must use tx for the outer scope. */
export function afterCommit(db:Sql,callback:()=>void){
 const c=context(db),frame=c.frames.at(-1);
 if(frame){if(c.frames[0].untrackedParent)throw Error('edge-comms.untracked-outer-transaction');frame.callbacks.push(callback);}
 else{if(db.isTransaction)throw Error('edge-comms.untracked-outer-transaction');notifyCommitted(c,[callback]);}
}
/** L8: counts tracked rollbacks per connection (savepoint or outer), so an in-memory mirror of rows written inside a
 *  transaction knows when to re-read them before the transaction ends. Raw untracked ROLLBACKs always end the
 *  transaction, which a mirror sees as `db.isTransaction === false`. */
const rollbacks=new WeakMap<Sql,number>();
export function rollbackGeneration(db:Sql):number{return rollbacks.get(db)??0;}
/** Atomic block that nests safely; publishing additionally tracks commit scope. */
export function tx<T>(db: Sql, fn: () => T,options?:{immediate?:boolean;deferNotifications?:(notify:()=>void)=>void}): T {
 const c=context(db),name=`edge_comms_${++savepoints}`,frame:CommitFrame={callbacks:[],untrackedParent:c.frames.length?c.frames[0].untrackedParent:db.isTransaction};
 const immediate=options?.immediate===true;if(immediate&&(c.frames.length||db.isTransaction))throw Error('edge-comms.immediate-must-be-outer');
 db.exec(immediate?'BEGIN IMMEDIATE':`SAVEPOINT ${name}`);c.frames.push(frame);let out:T;
 try{out=fn();db.exec(immediate?'COMMIT':`RELEASE ${name}`);}
 catch(error){rollbacks.set(db,(rollbacks.get(db)??0)+1);try{db.exec(immediate?'ROLLBACK':`ROLLBACK TO ${name}`);}finally{try{if(!immediate)db.exec(`RELEASE ${name}`);}finally{c.frames.pop();}}throw error;}
 c.frames.pop();const parent=c.frames.at(-1);
 if(parent)parent.callbacks.push(...frame.callbacks);else if(options?.deferNotifications)options.deferNotifications(()=>notifyCommitted(c,frame.callbacks));else notifyCommitted(c,frame.callbacks);
 return out;
}
