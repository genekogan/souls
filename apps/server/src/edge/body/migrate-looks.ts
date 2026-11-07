// Opt-in legacy migration. Ordinary BODY-v1 events remain the replay truth; an atomic
// operator receipt makes each assignment reversible without rewriting accepted history.
import type {Entity} from '@souls/engine-contract';
import type {Db, SoulRow} from '../../db.ts';
import type {WorldHost} from '../../world.ts';
import type {EdgeLedger} from '../ledger/ledger.ts';
import {lookBody, describeLook} from '../../../../web/src/humanoid/look.ts';
import {legacyLook} from '../../../../web/src/humanoid/legacy.ts';

type Body = NonNullable<Entity['body']>;
type Ledger = Pick<EdgeLedger, 'bodyAssignmentReady' | 'invalidateBodies'>;
export type LookMigrationRow = {soulId:string; entityId:string; owner:string; name:string; look:string; body:Body};
type Refusal = {soulId:string; reason:string};
export type LookMigrationResult = {planned:LookMigrationRow[]; migrated:string[]; deferred:Refusal[]; skipped:Refusal[]};
type Receipt = {seq:number; soul_id:string; entity_id:string; owner:string; body:string};
const fail = (code:string):never => {throw Object.assign(new Error(code), {code});};
const same = (a:unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b);

function bound(host:WorldHost, db:Db, soulId:string, entityId:string, owner:string) {
  const row=db.soul(soulId), mind=host.minds.get(soulId);
  if (!row || row.retired_at!==null || row.world_id!==host.worldId || row.entity_id!==entityId || row.owner!==owner
    || !mind || mind.entityId!==entityId || mind.owner!==owner || host.kernel.things[soulId]?.traits.body!==entityId)
    fail('body.authority-changed');
  return row!;
}
function ready(host:WorldHost, ledger:Ledger, row:SoulRow, body:Body|null) {
  if (!host.engine.assignBodyV1 || !host.engine.bodyAssignmentProblemV1) fail('body.unavailable');
  if (host.quietBarrier || !ledger.bodyAssignmentReady({soulId:row.id,entityId:row.entity_id,owner:row.owner,name:row.name})) fail('body.safe-standing-required');
  const issue=host.engine.bodyAssignmentProblemV1!(row.entity_id,body); if (issue) fail(issue);
}
function receipts(db:Db) {
  db.db.exec(`CREATE TABLE IF NOT EXISTS legacy_looks_v1 (
    world_id TEXT NOT NULL, seq INTEGER NOT NULL, soul_id TEXT NOT NULL, entity_id TEXT NOT NULL,
    owner TEXT NOT NULL, body TEXT NOT NULL, rolled_back_seq INTEGER,
    PRIMARY KEY(world_id,seq), FOREIGN KEY(world_id,seq) REFERENCES events(world_id,seq))`);
}
function activeReceipts(host:WorldHost, db:Db):Receipt[] {
  if (!db.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_looks_v1'").get()) return [];
  return db.db.prepare('SELECT seq,soul_id,entity_id,owner,body FROM legacy_looks_v1 WHERE world_id=? AND rolled_back_seq IS NULL ORDER BY seq').all(host.worldId) as Receipt[];
}
function lastBodySeq(host:WorldHost, db:Db, soulId:string, entityId:string):number {
  return (db.db.prepare("SELECT seq FROM events WHERE world_id=? AND soul_id=? AND kind='body-assignment-v1' AND json_extract(payload,'$.entityId')=? ORDER BY seq DESC LIMIT 1").get(host.worldId,soulId,entityId) as {seq:number}|undefined)?.seq ?? 0;
}

/** No writes, including schema writes. Match socialPresets to the existing viewer,
 * not to a desired new appearance. Explicit bodies (including uploads/looks) stay alone. */
export function planLegacyLooks(host:WorldHost, db:Db, {socialPresets=false}={}):Pick<LookMigrationResult,'planned'|'skipped'> {
  const planned:LookMigrationRow[]=[], skipped:Refusal[]=[];
  for (const row of db.liveSouls(host.worldId)) {
    const e=host.engine.world.entities[row.entity_id] as (Entity & {human?:{soul?:unknown}})|undefined;
    if (!e?.human) {skipped.push({soulId:row.id,reason:'no body in this world'});continue;}
    if (e.body) {skipped.push({soulId:row.id,reason:'already has an explicit body'});continue;}
    const look=legacyLook(row.entity_id,typeof e.human.soul==='string'?e.human.soul:undefined,socialPresets);
    planned.push({soulId:row.id,entityId:row.entity_id,owner:row.owner,name:row.name,look:describeLook(look),body:lookBody(look) as Body});
  }
  return {planned,skipped};
}

/** Safe by default: dry run. Unsafe or stale residents are deferred, never stopped or moved. */
export async function migrateLegacyLooks(host:WorldHost, db:Db, ledger:Ledger, {socialPresets=false,dryRun=true}={}):Promise<LookMigrationResult> {
  const {planned,skipped}=planLegacyLooks(host,db,{socialPresets});
  const result:LookMigrationResult={planned,skipped,migrated:[],deferred:[]};
  if (dryRun) return result;
  receipts(db);
  for (const p of planned) {
    // Also fence an intervening assignment back to null (ABA), not just current bytes.
    const sourceSeq=lastBodySeq(host,db,p.soulId,p.entityId);
    const guard=():true=>{
      const row=bound(host,db,p.soulId,p.entityId,p.owner);
      if (host.engine.world.entities[p.entityId]?.body || lastBodySeq(host,db,p.soulId,p.entityId)!==sourceSeq) fail('body.changed');
      ready(host,ledger,row,p.body);return true;
    };
    try {
      guard();
      await host.enqueueChecked('body-assignment-v1','world:body',{contract:'body-assignment/1',worldId:host.worldId,soulId:p.soulId,entityId:p.entityId,body:structuredClone(p.body)},guard,event=>{
        db.db.prepare('INSERT INTO legacy_looks_v1(world_id,seq,soul_id,entity_id,owner,body) VALUES(?,?,?,?,?,?)').run(host.worldId,event.seq,p.soulId,p.entityId,p.owner,JSON.stringify(p.body));return true;
      });
      ledger.invalidateBodies();result.migrated.push(p.soulId);
    } catch (error) {result.deferred.push({soulId:p.soulId,reason:(error as {code?:string}).code ?? (error as Error).message});}
  }
  return result;
}

/** Compensating assignments to the original absent body; no event/snapshot deletion.
 * Any later owner assignment (even back to identical bytes) prevents rollback. */
export async function rollbackLegacyLooks(host:WorldHost, db:Db, ledger:Ledger, {dryRun=true}={}) {
  const planned=activeReceipts(host,db), restored:string[]=[], deferred:Refusal[]=[];
  for (const p of planned) {
    const guard=():true=>{
      const row=bound(host,db,p.soul_id,p.entity_id,p.owner);
      if (lastBodySeq(host,db,p.soul_id,p.entity_id)!==p.seq || !same(host.engine.world.entities[p.entity_id]?.body,JSON.parse(p.body))) fail('body.changed');
      ready(host,ledger,row,null);return true;
    };
    try {
      guard();if (dryRun) continue;
      await host.enqueueChecked('body-assignment-v1','world:body',{contract:'body-assignment/1',worldId:host.worldId,soulId:p.soul_id,entityId:p.entity_id,body:null},guard,event=>{
        const r=db.db.prepare('UPDATE legacy_looks_v1 SET rolled_back_seq=? WHERE world_id=? AND seq=? AND rolled_back_seq IS NULL').run(event.seq,host.worldId,p.seq);
        if (r.changes!==1) fail('body.receipt-changed');return true;
      });
      ledger.invalidateBodies();restored.push(p.soul_id);
    } catch (error) {deferred.push({soulId:p.soul_id,reason:(error as {code?:string}).code ?? (error as Error).message});}
  }
  return {planned:planned.map(p=>({soulId:p.soul_id,entityId:p.entity_id,seq:p.seq})),restored,deferred};
}

/** Explicit operator boot hook, also callable by the original-world operator with its
 * already-open {host,db,edge}. Never opens another writer or guesses a world's factory. */
export async function runLegacyLookMaintenance(host:WorldHost,db:Db,ledger:Ledger|undefined,env:Record<string,string|undefined>) {
  const mode=env.LEGACY_LOOKS_MODE;if (!mode) return;
  if (!ledger) throw Error('legacy-looks.edge-required');
  if (mode==='rollback' || mode==='rollback-plan') return rollbackLegacyLooks(host,db,ledger,{dryRun:mode==='rollback-plan'});
  if (mode!=='plan' && mode!=='apply') throw Error('legacy-looks.mode: plan, apply, rollback-plan or rollback');
  if (!['0','1'].includes(env.LEGACY_LOOKS_SOCIAL_PRESETS??'')) throw Error('legacy-looks.explicit-viewer-palette-required');
  return migrateLegacyLooks(host,db,ledger,{dryRun:mode==='plan',socialPresets:env.LEGACY_LOOKS_SOCIAL_PRESETS==='1'});
}

/** The per-world one-shot maintenance file `<DATA_DIR>/legacy-looks.env`, for worlds run by the world launcher (whose
 *  children's environment the operator cannot set per world). Only LEGACY_LOOKS_MODE and LEGACY_LOOKS_SOCIAL_PRESETS are
 *  read from it; the process environment wins when it sets LEGACY_LOOKS_MODE. */
export const LEGACY_LOOKS_FILE='legacy-looks.env';
export function legacyLooksOptions(dataDir:string|undefined,env:Record<string,string|undefined>,read:(f:string)=>string|null):{options:Record<string,string|undefined>;file:string|null}{
  if (env.LEGACY_LOOKS_MODE) return {options:{LEGACY_LOOKS_MODE:env.LEGACY_LOOKS_MODE,LEGACY_LOOKS_SOCIAL_PRESETS:env.LEGACY_LOOKS_SOCIAL_PRESETS},file:null};
  if (!dataDir) return {options:{},file:null};
  const file=dataDir.replace(/\/$/,'')+'/'+LEGACY_LOOKS_FILE,text=read(file);if (text===null) return {options:{},file:null};
  const options:Record<string,string>={};
  for (const raw of text.split('\n')) {const line=raw.trim();if (!line||line.startsWith('#')) continue;const m=line.match(/^(LEGACY_LOOKS_MODE|LEGACY_LOOKS_SOCIAL_PRESETS)=([a-z0-9-]+)$/);if (!m) throw Error('legacy-looks.env: only LEGACY_LOOKS_MODE and LEGACY_LOOKS_SOCIAL_PRESETS lines are allowed');options[m[1]]=m[2];}
  return {options,file};
}
/** Boot hook shared by main.ts and the old-world servers: runs the requested mode once, prints `[legacy-looks] <json>`,
 *  writes `<DATA_DIR>/legacy-looks-<mode>-<time>.json`, and renames a maintenance file it ran from to
 *  `legacy-looks.env.done-<mode>-<time>` (an apply that deferred residents keeps the file, so the next boot retries them). */
export async function legacyLookBootHook(host:WorldHost,db:Db,ledger:Ledger|undefined,dataDir:string|undefined,env:Record<string,string|undefined>,log:(line:string)=>void=console.log){
  const fs=await import('node:fs');
  const {options,file}=legacyLooksOptions(dataDir,env,f=>{try{return fs.readFileSync(f,'utf8');}catch{return null;}});
  if (!options.LEGACY_LOOKS_MODE) return null;
  const result=await runLegacyLookMaintenance(host,db,ledger,options) as {deferred?:unknown[]}|undefined;
  log('[legacy-looks] '+JSON.stringify(result));
  const at=new Date().toISOString().replace(/[:.]/g,'-'),mode=options.LEGACY_LOOKS_MODE;
  if (dataDir) {try{fs.writeFileSync(dataDir.replace(/\/$/,'')+`/legacy-looks-${mode}-${at}.json`,JSON.stringify({mode,socialPresets:options.LEGACY_LOOKS_SOCIAL_PRESETS??null,worldId:host.worldId,result},null,1));}catch(e){log('[legacy-looks] result file not written: '+(e as Error).message);}}
  if (file&&!((mode==='apply'||mode==='rollback')&&(result?.deferred?.length??0)>0)) fs.renameSync(file,file+`.done-${mode}-${at}`);
  return result;
}
