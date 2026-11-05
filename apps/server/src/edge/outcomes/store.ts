import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {EDGE_OUTCOME_CONTRACT,edgeOutcomeV1Schema,type EdgeOutcomeV1} from '@sim/protocol';
import type {EdgeReceipt} from '../contract.ts';
import {EDEN_LIBRARY_CATALOGUE,EDEN_CONTENT_VERSION} from '../content/eden-library-catalogue.ts';
import {EDEN_PLACE_LORE} from '../content/eden-place-lore.ts';
import {tx} from '../comms/store.ts';
import type {PaintingPublished} from '../../art/painting-completion.ts';
export type HoldingFact={id:string;kind:string;name:string;state:string;holder:string|null;placeId:string|null};
export type ConfirmedEffects={changed?:EdgeOutcomeV1['changed'];met?:EdgeOutcomeV1['met'];learned?:EdgeOutcomeV1['learned'];detail?:Record<string,unknown>;summary?:string;untrusted?:boolean};
export type OutcomeContext={soulId:string;capability:string;params:Record<string,string>;acceptedTick:number;readSpot?:`read.${string}`;confirmedProduced?:EdgeOutcomeV1['produced'];confirmedChanges?:EdgeOutcomeV1['changed'];holdingBefore?:HoldingFact|null;confirmedEffects?:ConfirmedEffects};
export type TerminalSection={section:string;rows:Record<string,unknown>[];learned:EdgeOutcomeV1['learned']};
export type OutcomeSnapshot={worldId:string;tick:number;place:string|null;placePath:string[];pos:readonly number[]|null;walkable:string[];sections:TerminalSection[];materials:{id:string;version:number;title:string;text:string;source:string}[]};
const clip=(value:unknown,max:number)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):'';
export function outcomeParams(raw:unknown):Record<string,string>{
 const p=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};return Object.fromEntries([['book',100],['query',200],['title',100],['text',2000],['to',100],['recipientName',100]].flatMap(([key,max])=>{const value=p[String(key)];if(value===undefined)return[];if(typeof value!=='string'||value.length>Number(max))throw Error(`outcome.params:${key}`);return[[String(key),value]];}));
}
/** Prospective semantic projection. No native state/physics input or old receipt rewrite. */
export class ActionOutcomes{
 private db:DatabaseSync;private worldId:string;
 constructor(db:DatabaseSync,worldId:string){this.db=db;this.worldId=worldId;db.exec(`
 CREATE TABLE IF NOT EXISTS edge_outcome_contexts_v1(world_id TEXT NOT NULL,receipt_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(world_id,receipt_id)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS edge_outcomes_v1(world_id TEXT NOT NULL,receipt_id TEXT NOT NULL,soul_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(world_id,receipt_id)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS edge_reading_progress_v1(world_id TEXT NOT NULL,soul_id TEXT NOT NULL,book_id TEXT NOT NULL,content_version TEXT NOT NULL,next_passage INTEGER NOT NULL,PRIMARY KEY(world_id,soul_id,book_id,content_version)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS edge_lore_visits_v1(world_id TEXT NOT NULL,soul_id TEXT NOT NULL,place_id TEXT NOT NULL,source TEXT NOT NULL,receipt_id TEXT NOT NULL,tick INTEGER NOT NULL,PRIMARY KEY(world_id,soul_id,place_id,source)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS edge_written_objects_v1(world_id TEXT NOT NULL,id TEXT NOT NULL,soul_id TEXT NOT NULL,receipt_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(world_id,id),UNIQUE(world_id,receipt_id)) WITHOUT ROWID;
 CREATE TABLE IF NOT EXISTS edge_mail_v1(world_id TEXT NOT NULL,id TEXT NOT NULL,receipt_id TEXT NOT NULL,sender TEXT NOT NULL,recipient TEXT NOT NULL,created_tick INTEGER NOT NULL,notified INTEGER NOT NULL DEFAULT 0,body TEXT NOT NULL,PRIMARY KEY(world_id,id),UNIQUE(world_id,receipt_id)) WITHOUT ROWID;`);}
 capture(receiptId:string,context:OutcomeContext){this.db.prepare('INSERT INTO edge_outcome_contexts_v1(world_id,receipt_id,body) VALUES(?,?,?)').run(this.worldId,receiptId,JSON.stringify(context));}
 read(receiptId:string):EdgeOutcomeV1|undefined{const r=this.db.prepare('SELECT body FROM edge_outcomes_v1 WHERE world_id=? AND receipt_id=?').get(this.worldId,receiptId) as {body:string}|undefined;return r?edgeOutcomeV1Schema.parse(JSON.parse(r.body)):undefined;}
 context(receiptId:string):OutcomeContext|null{const r=this.db.prepare('SELECT body FROM edge_outcome_contexts_v1 WHERE world_id=? AND receipt_id=?').get(this.worldId,receiptId) as {body:string}|undefined;return r?JSON.parse(r.body) as OutcomeContext:null;}
 /** Called only by the painting's atomic world/receipt completion participant. */
 confirmPainting(receiptId:string,p:PaintingPublished){const context=this.context(receiptId);if(!context||context.capability.split(':')[0]!=='paint')throw Error('painting.outcome-missing');context.confirmedProduced=[{id:p.target,kind:'painting',title:p.title,where:p.target,visibility:'public'}];context.confirmedEffects={summary:clip(`Painted ${p.title}; it is on the easel, credited to your Soul.`,160),detail:{painting:p},untrusted:true};this.db.prepare('UPDATE edge_outcome_contexts_v1 SET body=? WHERE world_id=? AND receipt_id=?').run(JSON.stringify(context),this.worldId,receiptId);}
 artifact(soulId:string,id:string):Record<string,unknown>|null{const mail=this.mail(soulId,id);if(mail)return mail;const r=this.db.prepare('SELECT body FROM edge_written_objects_v1 WHERE world_id=? AND soul_id=? AND id=?').get(this.worldId,soulId,id) as {body:string}|undefined;return r?JSON.parse(r.body) as Record<string,unknown>:null;}
 mail(soulId:string,id:string):Record<string,unknown>|null{const r=this.db.prepare('SELECT body FROM edge_mail_v1 WHERE world_id=? AND id=? AND (sender=? OR recipient=?)').get(this.worldId,id,soulId,soulId) as {body:string}|undefined;return r?JSON.parse(r.body) as Record<string,unknown>:null;}
 mailbox(soulId:string){return(this.db.prepare('SELECT body FROM edge_mail_v1 WHERE world_id=? AND (sender=? OR recipient=?) ORDER BY created_tick DESC,id LIMIT 100').all(this.worldId,soulId,soulId) as {body:string}[]).map(r=>JSON.parse(r.body) as Record<string,unknown>);}
 deliverMail(send:(recipient:string,tick:number,body:Record<string,unknown>)=>unknown){
  const pending=this.db.prepare('SELECT id,recipient,created_tick,body FROM edge_mail_v1 WHERE world_id=? AND notified=0 ORDER BY created_tick,id LIMIT 200').all(this.worldId) as {id:string;recipient:string;created_tick:number;body:string}[];
  for(const row of pending)tx(this.db,()=>{const letter=JSON.parse(row.body) as Record<string,unknown>;send(row.recipient,row.created_tick,{letter:{id:row.id,sender:letter.sender,recipient:letter.recipient,title:letter.title},text:`A private letter was deposited in your postbox (${row.id}).`,where:{},untrusted:true});this.db.prepare('UPDATE edge_mail_v1 SET notified=1 WHERE world_id=? AND id=?').run(this.worldId,row.id);});return pending.length;
 }
 terminal(receipt:EdgeReceipt,snapshot:OutcomeSnapshot,effects:ConfirmedEffects={}):EdgeOutcomeV1|undefined{
  const existing=this.read(receipt.id);if(existing)return existing;if(['waiting','started'].includes(receipt.phase))return;
  const row=this.db.prepare('SELECT body FROM edge_outcome_contexts_v1 WHERE world_id=? AND receipt_id=?').get(this.worldId,receipt.id) as {body:string}|undefined;if(!row)return; // pre-feature receipts stay untouched
  const context=JSON.parse(row.body) as OutcomeContext;
  return tx(this.db,()=>{
   // F4 (#375): a walk that reached a flag says so ("at the orchard flag"), not the open ground it stands on ("at world")
   const kind=context.capability.split(':')[0],completed=receipt.phase==='completed',flag=completed?/^walk:flag-(.+)$/.exec(context.capability)?.[1]:undefined,at=flag?`the ${flag.replace(/-/g,' ')} flag`:snapshot.place,out:EdgeOutcomeV1={contract:EDGE_OUTCOME_CONTRACT,kind,summary:clip(`${kind} ${receipt.phase}${at?` at ${at}`:''}${receipt.code?` (${receipt.code})`:''}.`,160),learned:[],produced:[],changed:[],met:[],detail:{phase:receipt.phase,sourceTick:snapshot.tick},untrusted:false};
   if(completed&&kind==='read'&&!effects.detail?.sign)this.readPassage(context,out);
   if(completed&&kind==='use-computer'){
    const query=context.params.query??'',terms=query.toLowerCase(),wanted=terms.includes('letter')?['letters']:terms.includes('project')||terms.includes('help')?['projects']:terms.includes('who')||terms.includes('people')||terms.includes('directory')?['directory']:terms.includes('schedule')||terms.includes('today')||terms.includes("what's on")?['schedule']:terms.includes('lost')||terms.includes('found')?['lost-found']:terms.includes('notice')?['notices']:terms.includes('digest')?['digest']:snapshot.sections.map(s=>s.section);
    const sections=snapshot.sections.filter(s=>wanted.includes(s.section));out.learned=sections.flatMap(s=>s.learned).slice(0,5);out.detail={...out.detail,terminal:context.capability.slice('use-computer:'.length),query,sections:sections.map(s=>s.section),results:sections.map(s=>({section:s.section,rows:s.rows}))};out.summary=clip(`Checked the town terminal: ${sections.map(s=>s.section).join(', ')}.`,160);out.untrusted=!!query||out.learned.some(f=>f.untrusted)||sections.some(s=>s.rows.some(r=>r.untrusted===true));
   }
   if(completed&&['write','post-letter','paint','craft'].includes(kind)&&!(kind==='paint'&&context.confirmedProduced?.some(p=>p.kind==='painting')))this.writeRecord(context,receipt,snapshot,out);
   if(completed&&kind==='listen'){
    const material=snapshot.materials[0];if(material){out.learned=[{fact:clip(`Presentation material states: ${material.text}`,1000),about:material.id,source:material.source,provenance:'soul-text',untrusted:true}];out.detail={...out.detail,talk:{id:material.id,title:material.title},material:material.text};out.untrusted=true;out.summary=clip(`Listened to accessible material from ${material.title}.`,160);}else out.learned=[{fact:'No presentation material was available to this Soul at this recorded moment.',about:snapshot.place??snapshot.worldId,source:`town:listen:${snapshot.worldId}:${snapshot.tick}`,provenance:'world-fact',untrusted:false}];
   }
   if(['walk','stroll','go','go-near','hang-out','wander','swim'].includes(kind)&&snapshot.pos){
    for(const place of snapshot.placePath){if(out.learned.length>=5)break;if(!snapshot.walkable.includes(place))continue;const lore=EDEN_PLACE_LORE.find(l=>l.about===place);if(!lore)continue;
     const fresh=Number(this.db.prepare('INSERT OR IGNORE INTO edge_lore_visits_v1(world_id,soul_id,place_id,source,receipt_id,tick) VALUES(?,?,?,?,?,?)').run(this.worldId,context.soulId,place,lore.source,receipt.id,snapshot.tick).changes)>0;if(!fresh)continue;
     out.learned.push(...lore.learned.map(f=>({fact:f.fact,about:f.about,source:f.source,provenance:'authored-content' as const,untrusted:false})));out.detail.firstVisit={placeId:place,tick:snapshot.tick,pos:[...snapshot.pos],source:lore.source,lore:lore.text,contentVersion:EDEN_CONTENT_VERSION};
    }
   }
   if(context.confirmedProduced?.length){out.produced=context.confirmedProduced;out.untrusted=true;}
   if(context.confirmedChanges?.length)out.changed=context.confirmedChanges;
   for(const e of [context.confirmedEffects,effects])if(e){out.changed.push(...(e.changed??[]));out.met.push(...(e.met??[]));out.learned.push(...(e.learned??[]));Object.assign(out.detail,e.detail);if(e.summary)out.summary=clip(e.summary,160);out.untrusted||=e.untrusted===true;}
   if(!completed)out.detail.completedContent=false;
   const validated=edgeOutcomeV1Schema.parse(out);this.db.prepare('INSERT INTO edge_outcomes_v1(world_id,receipt_id,soul_id,body) VALUES(?,?,?,?)').run(this.worldId,receipt.id,context.soulId,JSON.stringify(validated));return validated;
  });
 }
 private readPassage(context:OutcomeContext,out:EdgeOutcomeV1){
  const requested=context.params.book,progress=this.db.prepare('SELECT book_id,next_passage FROM edge_reading_progress_v1 WHERE world_id=? AND soul_id=? AND content_version=?').all(this.worldId,context.soulId,EDEN_CONTENT_VERSION) as {book_id:string;next_passage:number}[],next=new Map(progress.map(r=>[r.book_id,r.next_passage])),book=requested?EDEN_LIBRARY_CATALOGUE.find(b=>b.id===requested):EDEN_LIBRARY_CATALOGUE.find(b=>(next.get(b.id)??0)<b.passages.length)??EDEN_LIBRARY_CATALOGUE[0];if(!book)throw Error('outcome.book-unavailable');
  const row=this.db.prepare('SELECT next_passage FROM edge_reading_progress_v1 WHERE world_id=? AND soul_id=? AND book_id=? AND content_version=?').get(this.worldId,context.soulId,book.id,book.version) as {next_passage:number}|undefined;
  const index=row?.next_passage??0,passage=book.passages[index];if(!passage){out.summary=clip(`Finished ${book.title}; no unread passages remain.`,160);out.detail={...out.detail,book:{id:book.id,title:book.title},progress:1,contentVersion:book.version};out.learned=[{fact:'This Soul has completed every passage of this book version.',about:book.id,source:book.id+'@1:completed',provenance:'world-fact',untrusted:false}];return;}
  this.db.prepare('INSERT INTO edge_reading_progress_v1(world_id,soul_id,book_id,content_version,next_passage) VALUES(?,?,?,?,?) ON CONFLICT(world_id,soul_id,book_id,content_version) DO UPDATE SET next_passage=excluded.next_passage').run(this.worldId,context.soulId,book.id,book.version,index+1);
  out.summary=clip(`Read ${book.title}, passage ${index+1} of ${book.passages.length}.`,160);out.learned=passage.learned.map(f=>({fact:f.fact,about:f.about,source:f.source,provenance:'authored-content',untrusted:false}));out.detail={...out.detail,book:{id:book.id,title:book.title,author:book.author,chapter:index+1,of:book.passages.length},passage:passage.text,progress:(index+1)/book.passages.length,contentVersion:book.version,provenance:book.provenance};
 }
 private writeRecord(context:OutcomeContext,receipt:EdgeReceipt,snapshot:OutcomeSnapshot,out:EdgeOutcomeV1){
  const addressed=out.kind==='post-letter'&&!!context.params.to,kind=out.kind==='write'?'written-page':out.kind==='post-letter'?(addressed?'letter':'letter-draft'):`${out.kind}-record`,title=clip(context.params.title,100)||`A ${kind}`,text=clip(context.params.text,2000),id=`record_${createHash('sha256').update(this.worldId+'\n'+receipt.id).digest('hex').slice(0,32)}`;
  const body={id,kind,title,text,author:context.soulId,placeId:snapshot.place,createdTick:snapshot.tick,visibility:'private',provenance:'soul-text',untrusted:true,physicalBody:false};this.db.prepare('INSERT INTO edge_written_objects_v1(world_id,id,soul_id,receipt_id,body) VALUES(?,?,?,?,?)').run(this.worldId,id,context.soulId,receipt.id,JSON.stringify(body));
  out.produced=[{id,kind,title,where:snapshot.place,visibility:'private'}];out.learned=[{fact:`A private ${kind} record ${id} was created.`,about:id,source:id,provenance:'world-fact',untrusted:false},...(text?[{fact:clip(`The author's text reads: ${text}`,1000),about:id,source:id+':text',provenance:'soul-text' as const,untrusted:true}]:[])];out.untrusted=true;out.detail={...out.detail,artifact:{id,kind,physicalBody:false},words:text?text.split(/\s+/).length:0,textEcho:text.slice(0,200)};out.summary=clip(`Created private ${kind}: ${title}.`,160);
  if(addressed){const letter={id,kind:'letter',title,text,sender:context.soulId,recipient:context.params.to,createdTick:snapshot.tick,status:'delivered',transport:'private-postbox',courierPhysics:false,untrusted:true};this.db.prepare('INSERT INTO edge_mail_v1(world_id,id,receipt_id,sender,recipient,created_tick,body) VALUES(?,?,?,?,?,?,?)').run(this.worldId,id,receipt.id,context.soulId,context.params.to,snapshot.tick,JSON.stringify(letter));out.produced=[{id,kind:'letter',title,where:null,visibility:'participants'}];out.changed.push({id,kind:'mail-deposited',summary:'A letter was deposited in the addressed private postbox.',source:id});out.detail.mail={id,recipient:context.params.to,status:'delivered',transport:'private-postbox',courierPhysics:false};out.summary=clip(`Deposited private letter for ${context.params.recipientName??context.params.to}: ${title}.`,160);}
 }
}
