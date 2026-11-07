// Local event handoff for one Soul. No tokens, model calls or world writes.
// Receipt into this journal and handling by the decision owner are distinct facts.
import {DatabaseSync} from 'node:sqlite';
import {attachControl} from './control.mjs';
import {attachOwnerTasks} from './owner-tasks.mjs';
import {mkdirSync, lstatSync, chmodSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const text = (value, max, name) => {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f]/.test(value)) throw Error(`Invalid ${name}`);
  return value;
};
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
};
const encode = value => {
  const raw = JSON.stringify(canonical(value));
  if (raw === undefined || Buffer.byteLength(raw) > 65536) throw Error('Event must be JSON <=64KiB');
  return raw;
};
const hash = value => createHash('sha256').update(value).digest('hex');
// Pending limits are hard intake ceilings, with owner capacity reserved from
// world traffic (other non-owner sources share the world ceiling). Handled
// limits are payload-retention targets, enforced by periodic bounded work.
export const DEFAULT_JOURNAL_RETENTION=Object.freeze({worldPendingEvents:20000,worldPendingBytes:64*1024*1024,ownerPendingEvents:1000,ownerPendingBytes:8*1024*1024,handledAgeMs:24*3600000,handledEvents:2000,handledBytes:16*1024*1024,maintenanceEvery:128});
const retentionPolicy=input=>{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!(k in DEFAULT_JOURNAL_RETENTION)))throw Error('Invalid journal retention policy');
 const policy={...DEFAULT_JOURNAL_RETENTION,...input};
 for(const [key,value] of Object.entries(policy))if(!Number.isSafeInteger(value)||value<(key==='maintenanceEvery'?1:0))throw Error('Invalid journal retention '+key);
 if(policy.maintenanceEvery>1000)throw Error('Journal maintenanceEvery must be 1..1000');
 return Object.freeze(policy);
};
function refuseLink(path) {
  try { if (lstatSync(path).isSymbolicLink()) throw Error('Linked journal path refused'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}

/** directory is private, owned runtime storage, separate from CLI credentials.
 * SQLite commits event payloads and the source cursor together; a cursor never
 * claims delivery of an event whose payload wasn't retained in the same commit.
 * Source cursor equality is an optimistic guard, not an ordering comparison.
 */
export function openJournal(directory, {worldId, soulId, now = Date.now,retention={},ownerTaskLimits={},lease={}}) {
  text(worldId, 200, 'world'); text(soulId, 200, 'Soul');
  const policy=retentionPolicy(retention);
  refuseLink(directory); mkdirSync(directory, {recursive:true, mode:0o700});
  const file = join(directory, 'continuity.sqlite'); refuseLink(file);
  for (const suffix of ['-wal', '-shm', '-journal']) refuseLink(file + suffix);
  const db = new DatabaseSync(file); chmodSync(file, 0o600);
  db.exec(`PRAGMA busy_timeout=2000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), world TEXT NOT NULL, soul TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (source TEXT PRIMARY KEY, cursor TEXT);
    CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, source TEXT NOT NULL, event_id TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, received_at INTEGER NOT NULL, handled_at INTEGER, outcome TEXT, UNIQUE(source,event_id));
    CREATE TABLE IF NOT EXISTS gaps (seq INTEGER PRIMARY KEY, source TEXT NOT NULL, before_cursor TEXT, after_cursor TEXT NOT NULL, noticed_at INTEGER NOT NULL, reconciled_at INTEGER, evidence TEXT);`);
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const r=fn();db.exec('COMMIT');return r; }
    catch(e) {db.exec('ROLLBACK');throw e;}
  };
  try {
    transaction(() => {
      const old=db.prepare('SELECT world,soul FROM identity WHERE singleton=1').get();
      if(old && (old.world!==worldId || old.soul!==soulId)) throw Error('Journal belongs to another world/Soul');
      if(!old)db.prepare('INSERT INTO identity VALUES (1,?,?)').run(worldId,soulId);
    });
  } catch(e) {db.close();throw e;}
  // One-time migration counts existing rows; subsequent writes use trigger
  // counters rather than rescanning the growing identity ledger per event.
  try{transaction(()=>{
    const columns=new Set(db.prepare('PRAGMA table_info(events)').all().map(r=>r.name));
    if(!columns.has('compacted_at'))db.exec('ALTER TABLE events ADD COLUMN compacted_at INTEGER');
    if(!columns.has('payload_bytes')){
      db.exec('ALTER TABLE events ADD COLUMN payload_bytes INTEGER NOT NULL DEFAULT 0');
      db.exec('UPDATE events SET payload_bytes=length(CAST(payload AS BLOB))');
    }
    db.exec(`CREATE INDEX IF NOT EXISTS journal_pending_seq ON events(seq) WHERE handled_at IS NULL;
      CREATE INDEX IF NOT EXISTS journal_handled_payload ON events(handled_at,seq) WHERE handled_at IS NOT NULL AND compacted_at IS NULL;
      CREATE TABLE IF NOT EXISTS journal_storage_v1(singleton INTEGER PRIMARY KEY CHECK(singleton=1),identity_events INTEGER NOT NULL,compacted_events INTEGER NOT NULL,world_pending_events INTEGER NOT NULL,world_pending_bytes INTEGER NOT NULL,owner_pending_events INTEGER NOT NULL,owner_pending_bytes INTEGER NOT NULL,handled_events INTEGER NOT NULL,handled_bytes INTEGER NOT NULL,maintenance_writes INTEGER NOT NULL DEFAULT 0);`);
    const contributions=prefix=>({
      identity_events:'1',compacted_events:`(${prefix}.compacted_at IS NOT NULL)`,
      world_pending_events:`(${prefix}.handled_at IS NULL AND ${prefix}.source<>'owner')`,world_pending_bytes:`CASE WHEN ${prefix}.handled_at IS NULL AND ${prefix}.source<>'owner' THEN ${prefix}.payload_bytes ELSE 0 END`,
      owner_pending_events:`(${prefix}.handled_at IS NULL AND ${prefix}.source='owner')`,owner_pending_bytes:`CASE WHEN ${prefix}.handled_at IS NULL AND ${prefix}.source='owner' THEN ${prefix}.payload_bytes ELSE 0 END`,
      handled_events:`(${prefix}.handled_at IS NOT NULL AND ${prefix}.compacted_at IS NULL)`,handled_bytes:`CASE WHEN ${prefix}.handled_at IS NOT NULL AND ${prefix}.compacted_at IS NULL THEN ${prefix}.payload_bytes ELSE 0 END`,
    });
    const fields=Object.keys(contributions('events'));
    if(!db.prepare('PRAGMA table_info(journal_storage_v1)').all().some(r=>r.name==='maintenance_writes'))db.exec('ALTER TABLE journal_storage_v1 ADD COLUMN maintenance_writes INTEGER NOT NULL DEFAULT 0');
    if(!db.prepare('SELECT 1 FROM journal_storage_v1 WHERE singleton=1').get())db.exec(`INSERT INTO journal_storage_v1(singleton,${fields.join(',')}) SELECT 1,${Object.values(contributions('events')).map(v=>`COALESCE(SUM(${v}),0)`).join(',')} FROM events`);
    for(const [kind,prefix] of [['INSERT','NEW'],['DELETE','OLD'],['UPDATE OF handled_at,payload_bytes,compacted_at','NEW']]){
      const old=contributions('OLD'),fresh=contributions(prefix),name=kind.split(' ')[0].toLowerCase();
      const changes=fields.map(k=>`${k}=${k}${name==='delete'?'-':'+'}(${fresh[k]})${name==='update'?`-(${old[k]})`:''}`).join(',');
      db.exec(`CREATE TRIGGER IF NOT EXISTS journal_storage_${name}_v1 AFTER ${kind} ON events BEGIN UPDATE journal_storage_v1 SET ${changes} WHERE singleton=1; END;`);
    }
  });}catch(e){db.close();throw e;}
  const sourceName = source => text(source,100,'source');
  const cursorValue = cursor => cursor===null ? null : text(cursor,200,'cursor');
  const getCursor = source => db.prepare('SELECT cursor FROM sources WHERE source=?').get(source)?.cursor ?? null;
  const control=attachControl(db,{now,transaction,...lease});
  let ownerTasks;
  try{ownerTasks=attachOwnerTasks(db,{now,transaction,control,limits:ownerTaskLimits});}catch(e){db.close();throw e;}
  const counts=()=>db.prepare('SELECT * FROM journal_storage_v1 WHERE singleton=1').get();
  const identityKey=(source,id)=>JSON.stringify([source,id]);
  const protection=()=>{
    const pending=control.checkpoint().value?.pendingDecision,refs=pending?.eventIds??[];
    if(pending&&!Array.isArray(pending.eventIds))throw Error('Cannot compact invalid pending decision event references');
    const keys=new Set();let events=0,bytes=0;
    for(const ref of refs){
      if(typeof ref?.source!=='string'||typeof ref?.id!=='string')throw Error('Cannot compact invalid pending decision event references');
      const key=identityKey(ref.source,ref.id);if(keys.has(key))continue;keys.add(key);
      const row=db.prepare('SELECT payload_bytes FROM events WHERE source=? AND event_id=? AND handled_at IS NOT NULL AND compacted_at IS NULL').get(ref.source,ref.id);
      if(row){events++;bytes+=row.payload_bytes;}
    }
    return {keys,events,bytes};
  };
  const compact=(maxCompactions=1000)=>{
    const protectedRows=protection(),at=now(),cutoff=at-policy.handledAgeMs;
    let state=counts(),events=state.handled_events-protectedRows.events,bytes=state.handled_bytes-protectedRows.bytes,compactedEvents=0,compactedBytes=0;
    const rows=db.prepare('SELECT seq,source,event_id,payload_bytes,handled_at FROM events WHERE handled_at IS NOT NULL AND compacted_at IS NULL ORDER BY handled_at,seq LIMIT ?').all(maxCompactions+protectedRows.keys.size);
    for(const row of rows){
      if(protectedRows.keys.has(identityKey(row.source,row.event_id)))continue;
      if(row.handled_at>cutoff&&events<=policy.handledEvents&&bytes<=policy.handledBytes)break;
      db.prepare("UPDATE events SET payload='null',payload_bytes=0,compacted_at=? WHERE seq=?").run(at,row.seq);
      events--;bytes-=row.payload_bytes;compactedEvents++;compactedBytes+=row.payload_bytes;
      if(compactedEvents===maxCompactions)break;
    }
    const oldest=db.prepare('SELECT source,event_id,handled_at FROM events WHERE handled_at IS NOT NULL AND compacted_at IS NULL ORDER BY handled_at,seq LIMIT ?').all(protectedRows.keys.size+1).find(r=>!protectedRows.keys.has(identityKey(r.source,r.event_id)));
    return {compactedEvents,compactedBytes,protectedEvents:protectedRows.events,protectedBytes:protectedRows.bytes,moreWork:events>policy.handledEvents||bytes>policy.handledBytes||!!oldest&&oldest.handled_at<=cutoff};
  };
  const automaticMaintenance=()=>{
    // Persist the cadence so frequent reconnects cannot postpone compaction.
    db.prepare('UPDATE journal_storage_v1 SET maintenance_writes=maintenance_writes+1 WHERE singleton=1').run();
    if(counts().maintenance_writes>=policy.maintenanceEvery){compact();db.prepare('UPDATE journal_storage_v1 SET maintenance_writes=0 WHERE singleton=1').run();}
  };
  const storageStats=()=>{
    const c=counts(),protectedRows=protection(),pageSize=db.prepare('PRAGMA page_size').get().page_size;
    return {policy,pending:{world:{events:c.world_pending_events,bytes:c.world_pending_bytes},owner:{events:c.owner_pending_events,bytes:c.owner_pending_bytes}},handled:{events:c.handled_events,bytes:c.handled_bytes,protectedEvents:protectedRows.events,protectedBytes:protectedRows.bytes},identityEvents:c.identity_events,compactedEvents:c.compacted_events,writesSinceMaintenance:c.maintenance_writes,databaseBytes:db.prepare('PRAGMA page_count').get().page_count*pageSize,reusableBytes:db.prepare('PRAGMA freelist_count').get().freelist_count*pageSize};
  };
  return {
    control,
    // These are private local task records, never world artifacts. Handling an
    // event (or acking receipt) does not remove its original owner intent.
    openOwnerTasks(options){return transaction(()=>ownerTasks.page(options));},
    ownerTask(options){return ownerTasks.task(options);},
    ownerTaskStats(){return ownerTasks.stats();},
    ownerTaskTexts(){return ownerTasks.openTexts();},
    closeOwnerTaskFromOperation(fence,id){return ownerTasks.closeFromOperation(fence,id);},
    storageStats(){return transaction(storageStats);},
    /** Compacts only handled payloads; identity/digest/outcome/sequence remain.
     * Targets exclude pendingDecision references and may be exceeded by up to
     * maintenanceEvery-1 newly handled payloads between automatic passes. A
     * migrated backlog can need repeated passes (moreWork). Open owner intent
     * is separately bounded and survives payload compaction. Identity, outcome,
     * closed-task proof, gap and control history remain unbounded. Freed SQLite pages are reused;
     * vacuum is explicit, never part of automatic maintenance. */
    maintenance({maxCompactions=1000,vacuum=false}={}){
      if(!Number.isSafeInteger(maxCompactions)||maxCompactions<1||maxCompactions>10000||typeof vacuum!=='boolean')throw Error('Invalid journal maintenance options');
      const result=transaction(()=>{const result=compact(maxCompactions);db.prepare('UPDATE journal_storage_v1 SET maintenance_writes=0 WHERE singleton=1').run();return result;});
      if(vacuum)db.exec('VACUUM');
      return {...result,storage:transaction(storageStats)};
    },
    cursor(source) {return getCursor(sourceName(source));},
    ingest({source, after, cursor, events, gap=false}) {
      sourceName(source); cursorValue(after);cursorValue(cursor);
      if(!Array.isArray(events)||events.length>1000)throw Error('Expected <=1000 events');
      if(typeof gap!=='boolean')throw Error('gap must be boolean');
      if(gap && cursor===null)throw Error('Gap needs a recovery cursor');
      // Validate the entire batch before opening a write transaction.
      const batch=events.map(event=>{text(event?.id,200,'event id');const payload=encode(event);return {id:event.id,payload,digest:hash(payload)};});
      return transaction(()=>{
        if(getCursor(source)!==after)throw Error('Stale receiver cursor; reload before polling');
        let inserted=0;
        for(const event of batch){
          const old=db.prepare('SELECT digest FROM events WHERE source=? AND event_id=?').get(source,event.id);
          if(old){if(old.digest!==event.digest)throw Error('Event identity reused with different content');continue;}
          const insertedRow=db.prepare('INSERT INTO events(source,event_id,payload,digest,received_at,payload_bytes) VALUES (?,?,?,?,?,?)').run(source,event.id,event.payload,event.digest,now(),Buffer.byteLength(event.payload));inserted++;
          if(source==='owner')ownerTasks.capture({seq:Number(insertedRow.lastInsertRowid),event_id:event.id,payload:event.payload,compacted_at:null});
        }
        const bucket=source==='owner'?'owner':'world',state=counts();
        if(state[bucket+'_pending_events']>policy[bucket+'PendingEvents']||state[bucket+'_pending_bytes']>policy[bucket+'PendingBytes'])throw Object.assign(Error(`Journal ${bucket} backlog full; retain cursor and retry after pending events are handled`),{code:'JOURNAL_BACKLOG_FULL',transient:true,source,bucket});
        if(source==='owner')ownerTasks.assertCapacity();
        let gapId=null;
        if(gap)gapId=Number(db.prepare('INSERT INTO gaps(source,before_cursor,after_cursor,noticed_at) VALUES (?,?,?,?)').run(source,after,cursor,now()).lastInsertRowid);
        db.prepare('INSERT INTO sources(source,cursor) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET cursor=excluded.cursor').run(source,cursor);
        automaticMaintenance();
        return {inserted,cursor,gapId};
      });
    },
    pending(limit=100, afterSequence=0) {
      if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid pending limit');
      if(!Number.isSafeInteger(afterSequence)||afterSequence<0)throw Error('Invalid pending sequence');
      return db.prepare('SELECT seq,source,event_id,payload,received_at FROM events WHERE handled_at IS NULL AND seq>? ORDER BY seq LIMIT ?').all(afterSequence,limit).map(r=>({sequence:r.seq,source:r.source,event:JSON.parse(r.payload),receivedAt:r.received_at}));
    },
    pendingOwner(limit=100) {
      if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid pending owner limit');
      return db.prepare(`SELECT seq,source,event_id,payload,received_at FROM events WHERE handled_at IS NULL AND source='owner' ORDER BY seq DESC LIMIT ?`).all(limit)
        .map(r=>({sequence:r.seq,source:r.source,event:JSON.parse(r.payload),receivedAt:r.received_at}));
    },
    attention(limit=100) {
      if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid attention limit');
      return db.prepare(`SELECT seq,source,event_id,payload,received_at FROM events WHERE handled_at IS NULL
        ORDER BY CASE WHEN source='owner' THEN 4 ELSE COALESCE(json_extract(payload,'$.salience'),2) END DESC,seq LIMIT ?`).all(limit)
        .map(r=>({sequence:r.seq,source:r.source,event:JSON.parse(r.payload),receivedAt:r.received_at}));
    },
    handled(source,id,outcome) {
      sourceName(source);text(id,200,'event id');text(outcome,2000,'handling outcome');
      return transaction(()=>{
        const row=db.prepare('SELECT handled_at,outcome FROM events WHERE source=? AND event_id=?').get(source,id);
        if(!row)throw Error('Cannot handle an unknown event');
        if(row.handled_at!==null){if(row.outcome!==outcome)throw Error('Handling outcome already recorded');return {alreadyHandled:true};}
        db.prepare('UPDATE events SET handled_at=?,outcome=? WHERE source=? AND event_id=?').run(now(),outcome,source,id);
        automaticMaintenance();
        return {alreadyHandled:false};
      });
    },
    gaps() {return db.prepare('SELECT seq,source,before_cursor,after_cursor,noticed_at FROM gaps WHERE reconciled_at IS NULL ORDER BY seq').all();},
    reconcileGap(id,evidence) {
      if(!Number.isSafeInteger(id)||id<1)throw Error('Invalid gap id');text(evidence,2000,'reconciliation evidence');
      const result=db.prepare('UPDATE gaps SET reconciled_at=?,evidence=? WHERE seq=? AND reconciled_at IS NULL').run(now(),evidence,id);
      if(result.changes!==1)throw Error('Gap absent or already reconciled');
    },
    close(){db.close();},
  };
}
