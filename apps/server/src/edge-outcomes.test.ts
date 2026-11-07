import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ActionOutcomes,type OutcomeSnapshot} from './edge/outcomes/store.ts';
import {EDGE_ACT_VERBS} from './edge/events/schema.ts';
import {edgeOutcomeV1Schema} from '@souls/protocol';
import type {EdgeReceipt} from './edge/contract.ts';
const receipt=(id:string,capability:string,phase:EdgeReceipt['phase']='completed'):EdgeReceipt=>({id,soulId:'s_fixture',capability,phase,acceptedTick:1,startedTick:2,endedTick:20,code:null,reason:null,programId:'p_fixture'});
const snapshot=():OutcomeSnapshot=>({worldId:'fixture-world',tick:20,place:'field',placePath:['field','eden'],pos:[1,2],walkable:['field'],sections:[{section:'directory',rows:[{soulId:'s_peer',name:'Peer',untrusted:true}],learned:[{fact:'One profile appears in the public directory.',about:'fixture-world',source:'town:directory:20',provenance:'world-fact',untrusted:false}]}],materials:[]});
function capture(store:ActionOutcomes,r:EdgeReceipt,params:Record<string,string>={}){store.capture(r.id,{soulId:r.soulId,capability:r.capability,params,acceptedTick:1});}
void test('all published verbs have typed factual terminal summaries without fabricated pose effects',()=>{
 const db=new DatabaseSync(':memory:'),store=new ActionOutcomes(db,'fixture-world');try{for(const verb of EDGE_ACT_VERBS){const r=receipt('r_'+verb,verb+':here');capture(store,r);const outcome=store.terminal(r,snapshot())!;assert.equal(outcome.kind,verb);assert.ok(outcome.summary.length>0);assert.equal(edgeOutcomeV1Schema.safeParse(outcome).success,true);if(['eat','drink','cook','play-game'].includes(verb)){assert.deepEqual(outcome.produced,[]);assert.deepEqual(outcome.changed,[]);assert.equal('taste' in outcome.detail,false);}}}finally{db.close();}
});
void test('reading continues the next passage after database restart; retries/polls and replaced acts do not advance progress',t=>{
 const dir=mkdtempSync(join(tmpdir(),'edge-reading-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'projection.db');let db=new DatabaseSync(path),store=new ActionOutcomes(db,'fixture-world');
 try{const first=receipt('read-1','read:here');capture(store,first);const a=store.terminal(first,snapshot())!;assert.equal(a.detail.progress,1/3);assert.equal(a.learned[0].source,'book:gardens-guide@1#p1');assert.deepEqual(store.terminal(first,{...snapshot(),tick:100}),a);
  const interrupted=receipt('read-interrupted','read:here','replaced');capture(store,interrupted);assert.deepEqual(store.terminal(interrupted,snapshot())!.learned,[]);
  db.close();db=new DatabaseSync(path);store=new ActionOutcomes(db,'fixture-world');assert.deepEqual(store.read(first.id),a);
  for(const [index,source]of ['book:gardens-guide@1#p2','book:gardens-guide@1#p3','book:library-window@1#p1'].entries()){const r=receipt(`read-next-${index}`,'read:here');capture(store,r);assert.equal(store.terminal(r,snapshot())!.learned[0].source,source);}
 }finally{db.close();}
});
void test('computer terminal outcome is a persisted snapshot; later views cannot change its world facts or expose arbitrary sections',()=>{
 const db=new DatabaseSync(':memory:'),store=new ActionOutcomes(db,'fixture-world');try{const r=receipt('computer','use-computer:desk');capture(store,r,{query:'who is in town'});const first=store.terminal(r,snapshot())!;assert.ok(first.learned.length);assert.equal(first.untrusted,true);const changed=snapshot();changed.sections[0].rows=[];changed.sections[0].learned=[];assert.deepEqual(store.terminal(r,changed),first);assert.deepEqual(store.read(r.id),first);assert.deepEqual(first.detail.sections,['directory']);}finally{db.close();}
});
void test('written records have durable identities and owner-private content; failed writes never create records',()=>{
 const db=new DatabaseSync(':memory:'),store=new ActionOutcomes(db,'fixture-world');try{const r=receipt('writing','write:desk');capture(store,r,{title:'A Soul’s note',text:'An invented assertion, not a world fact.'});const first=store.terminal(r,snapshot())!,id=first.produced[0].id;assert.equal(first.untrusted,true);assert.equal(first.learned[1].provenance,'soul-text');assert.equal(first.learned[1].untrusted,true);assert.equal(store.artifact('another-soul',id),null);assert.equal(store.artifact(r.soulId,id)?.text,'An invented assertion, not a world fact.');assert.deepEqual(store.terminal(r,snapshot()),first);assert.deepEqual(new ActionOutcomes(db,'fixture-world').artifact(r.soulId,id),store.artifact(r.soulId,id));const failed=receipt('failed-writing','write:desk','failed');capture(store,failed,{text:'No completed effect'});assert.deepEqual(store.terminal(failed,snapshot())!.produced,[]);assert.equal((db.prepare('SELECT COUNT(*) n FROM edge_written_objects_v1').get() as {n:number}).n,1);}finally{db.close();}
});
void test('listen reports only supplied entitled materials, tags quotations untrusted, and never invents a presentation',()=>{
 const db=new DatabaseSync(':memory:'),store=new ActionOutcomes(db,'fixture-world');try{const r=receipt('listen-none','listen:seat');capture(store,r);const none=store.terminal(r,snapshot())!;assert.equal(none.learned[0].provenance,'world-fact');assert.match(none.learned[0].fact,/No presentation material/);const r2=receipt('listen-entitled','listen:seat');capture(store,r2);const entitled=snapshot();entitled.materials=[{id:'talk',title:'A real supplied title',version:2,text:'Soul-authored material.',source:'presentation:talk:v2:material0'}];const out=store.terminal(r2,entitled)!;assert.equal(out.learned[0].source,entitled.materials[0].source);assert.equal(out.untrusted,true);assert.equal(out.learned[0].provenance,'soul-text');assert.deepEqual(out.met,[]);}finally{db.close();}
});
void test('first-visit lore uses actual end position and admitted place only, with stable source dedupe and no old receipt retrofit',()=>{
 const db=new DatabaseSync(':memory:'),store=new ActionOutcomes(db,'fixture-world');try{assert.equal(store.terminal(receipt('old','walk:field'),snapshot()),undefined);const r=receipt('visit','stroll:field');capture(store,r);const first=store.terminal(r,snapshot())!;assert.equal(first.learned[0].source,'place-lore:field@1');assert.equal(first.learned[0].provenance,'authored-content');assert.deepEqual(first.detail.firstVisit,{placeId:'field',tick:20,pos:[1,2],source:'place-lore:field@1',lore:(first.detail.firstVisit as {lore:string}).lore,contentVersion:'eden-authored-content/1'});const again=receipt('visit-again','stroll:field');capture(store,again);assert.deepEqual(store.terminal(again,snapshot())!.learned,[]);const unadmitted=receipt('scenery-only','walk:eden-library-1');capture(store,unadmitted);assert.deepEqual(store.terminal(unadmitted,{...snapshot(),place:'eden-library-1',placePath:['eden-library-1'],walkable:[]})!.learned,[]);}finally{db.close();}
});
