import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

/** body-library/1 (#717): cross-world collection membership and attribution for admitted body definitions.
 *  A sibling of the identity-only account registry: every world process opens the same file and writes it
 *  (WAL, busy_timeout, BEGIN IMMEDIATE), like the registry. It holds references and attribution only; the admitted
 *  bytes stay in the admitting world's edge_body_assets_v1. Collection membership controls discovery, not secrecy:
 *  any holder of a reference can look it up. */
export type Definition={ref:string;descriptor:Record<string,unknown>;creatorSoul:string;owner:string;sourceWorld:string;license:string;rightsConfirmed:boolean;status:'active'|'withdrawn';createdAt:number};
export type LibraryItem={ref:string;name:string;description?:string;type:string;actionProfile?:string;saved?:boolean};
export const LIBRARY_PAGE={defaultLimit:10,maxLimit:20,maxQuery:60} as const;

/** Where the shared collection store lives: BODY_COLLECTION_PATH, else beside the account registry. Null: a standalone
 *  world keeps a local-only store in its own database (no other world shares it). */
export function collectionPath(cfg:{bodyCollectionPath?:string;accountRegistryPath?:string}):string|null{
 if(cfg.bodyCollectionPath)return cfg.bodyCollectionPath;
 if(cfg.accountRegistryPath)return join(dirname(resolve(cfg.accountRegistryPath)),'body-collections.sqlite');
 return null;
}

export class BodyCollections {
 readonly db:DatabaseSync;readonly shared:boolean;
 /** A path opens (or creates) the shared store; a DatabaseSync keeps a local-only store in that world database. */
 constructor(store:string|DatabaseSync){
  this.shared=typeof store==='string';
  if(typeof store==='string'){if(store!==':memory:')mkdirSync(dirname(resolve(store)),{recursive:true});this.db=new DatabaseSync(store);this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');}
  else this.db=store;
  this.db.exec(`CREATE TABLE IF NOT EXISTS body_definitions_v1(asset_id TEXT PRIMARY KEY,descriptor TEXT NOT NULL,creator_soul TEXT NOT NULL,owner TEXT NOT NULL,source_world TEXT NOT NULL,license TEXT NOT NULL,rights_confirmed INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at INTEGER NOT NULL) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS body_collection_v1(owner TEXT NOT NULL,asset_id TEXT NOT NULL,saved_by_soul TEXT NOT NULL,saved_at INTEGER NOT NULL,PRIMARY KEY(owner,asset_id)) WITHOUT ROWID;`);
 }
 private tx<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 /** Record an admitted definition and put it in its owner's collection. Idempotent: an existing definition keeps its
  *  first attribution, descriptor and rights record (immutable content address). */
 record(d:{ref:string;descriptor:Record<string,unknown>;creatorSoul:string;owner:string;sourceWorld:string;license:string;rightsConfirmed:boolean},at:number){
  return this.tx(()=>{
   this.db.prepare('INSERT OR IGNORE INTO body_definitions_v1(asset_id,descriptor,creator_soul,owner,source_world,license,rights_confirmed,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(d.ref,JSON.stringify(d.descriptor),d.creatorSoul,d.owner,d.sourceWorld,d.license,d.rightsConfirmed?1:0,'active',at);
   this.db.prepare('INSERT OR IGNORE INTO body_collection_v1 VALUES(?,?,?,?)').run(d.owner,d.ref,d.creatorSoul,at);
  });
 }
 definition(ref:string):Definition|null{
  const r=this.db.prepare('SELECT * FROM body_definitions_v1 WHERE asset_id=?').get(ref) as Record<string,string|number>|undefined;if(!r)return null;
  return {ref:String(r.asset_id),descriptor:JSON.parse(String(r.descriptor)),creatorSoul:String(r.creator_soul),owner:String(r.owner),sourceWorld:String(r.source_world),license:String(r.license),rightsConfirmed:r.rights_confirmed===1,status:r.status==='withdrawn'?'withdrawn':'active',createdAt:Number(r.created_at)};
 }
 /** Withdrawal is written through by the definition's source world; a withdrawn definition cannot be newly selected. */
 setStatus(ref:string,status:'active'|'withdrawn'){this.db.prepare('UPDATE body_definitions_v1 SET status=? WHERE asset_id=?').run(status,ref);}
 saved(owner:string,ref:string){return !!this.db.prepare('SELECT 1 FROM body_collection_v1 WHERE owner=? AND asset_id=?').get(owner,ref);}
 save(owner:string,ref:string,soul:string,at:number){this.db.prepare('INSERT OR IGNORE INTO body_collection_v1 VALUES(?,?,?,?)').run(owner,ref,soul,at);}
 forget(owner:string,ref:string){this.db.prepare('DELETE FROM body_collection_v1 WHERE owner=? AND asset_id=?').run(owner,ref);}
 count(owner:string){return (this.db.prepare('SELECT COUNT(*) n FROM body_collection_v1 WHERE owner=?').get(owner) as {n:number}).n;}
 /** One bounded page of the owner's collection, ordered by reference; `q` matches name/description (case-insensitive). */
 mine(owner:string,{q,after,limit}:{q?:string;after?:string;limit:number}){
  const like=q?'%'+q.toLowerCase().replace(/[\\%_]/g,m=>'\\'+m)+'%':null;
  const rows=this.db.prepare(`SELECT d.asset_id ref,d.descriptor FROM body_collection_v1 c JOIN body_definitions_v1 d USING(asset_id)
   WHERE c.owner=? AND c.asset_id>? ${like?"AND (lower(json_extract(d.descriptor,'$.name')) LIKE ? ESCAPE '\\' OR lower(coalesce(json_extract(d.descriptor,'$.description'),'')) LIKE ? ESCAPE '\\')":''}
   ORDER BY c.asset_id LIMIT ?`).all(...[owner,after??'',...(like?[like,like]:[]),limit+1]) as {ref:string;descriptor:string}[];
  return {items:rows.slice(0,limit).map(r=>({ref:r.ref,...itemOf(JSON.parse(r.descriptor)),saved:true})),next:rows.length>limit?rows[limit-1]!.ref:null};
 }
 close(){if(this.shared)this.db.close();}
}
export function itemOf(d:Record<string,unknown>):Omit<LibraryItem,'ref'|'saved'>{
 return {name:String(d.name??'Unnamed body'),...(typeof d.description==='string'?{description:d.description}:{}),type:String(d.type??'humanoid'),...(typeof d.actionProfile==='string'?{actionProfile:d.actionProfile}:{})};
}
