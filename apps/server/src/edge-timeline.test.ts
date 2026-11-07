// CTX-8 (#1141): a Soul's public biography: only canonical facts, bounded, the same from a rebuilt world.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SoulTimeline,TIMELINE_MAX,entryOf,timelineView,type TimelineEntry} from './edge/ledger/timeline.ts';
import type {EdgeReceipt} from './edge/contract.ts';

const receipt=(id:string,capability:string,outcome:object={},phase='completed',tick=10)=>({id,soulId:'s_a',capability,phase,acceptedTick:tick-1,endedTick:tick,endedAt:{place:'hall'},outcome} as unknown as EdgeReceipt);
const view=(t:SoulTimeline,limit=TIMELINE_MAX,extra:TimelineEntry[]=[])=>timelineView(t.rows('s_a',limit),extra,{limit,clock:(tick)=>({worldDay:1+Math.floor(tick/100),time:'09:00'}),placeName:(id)=>id==='hall'?'Main Hall':null});

test('A1: made things, performances and gatherings are kept; a walk, a read and a refusal are not', () => {
 assert.deepEqual(entryOf(receipt('r','paint:easel',{produced:[{id:'o_1',title:'Dawn'}]}),{produced:[{id:'o_1',title:'Dawn'}]} as never),{kind:'produced',title:'Dawn',n:null});
 assert.deepEqual(entryOf(receipt('r','play:piano'),{} as never),{kind:'performance',title:'play',n:null});
 assert.deepEqual(entryOf(receipt('r','dance:here'),{met:[{soulId:'s_b',name:'B'}]} as never),{kind:'gathering',title:'dance',n:1});
 assert.equal(entryOf(receipt('r','walk:hall'),{} as never),null);
 assert.equal(entryOf(receipt('r','read:sign'),{} as never),null);
 assert.equal(entryOf(receipt('r','play:piano',{},'failed'),{} as never),null,'only what happened');
});

test('A1: newest first, both clocks, a place by name, and at most N', () => {
 const t=new SoulTimeline(new DatabaseSync(':memory:'),'w');
 for(let i=0;i<30;i++)t.note(receipt(`r_${String(i).padStart(2,'0')}`,'play:piano',{},'completed',i*50),Date.parse('2026-11-07T10:00:00.000Z')+i*1000);
 const v=view(t);
 assert.equal(v.length,TIMELINE_MAX); assert.equal(v[0]!.when.tick,29*50);
 assert.deepEqual(v[0],{kind:'performance',when:{real:'2026-11-07T10:00:29.000Z',tick:1450,worldDay:15,time:'09:00'},place:{id:'hall',name:'Main Hall'},title:'play'});
 assert.ok(Buffer.byteLength(JSON.stringify(v))<=TIMELINE_MAX*240,'the profile\'s budget');
});

test('A1: arrival and travel sit in the same order; a place a Soul may not name is left out', () => {
 const t=new SoulTimeline(new DatabaseSync(':memory:'),'w');
 t.note(receipt('r_1','play:piano'),Date.parse('2026-11-07T10:00:00.000Z'));
 const at=(real:string)=>({real,tick:null,worldDay:null,time:null});
 const v=view(t,20,[{kind:'arrival',when:at('2026-11-06T10:00:00.000Z'),place:{id:null,name:null}},{kind:'travel',when:at('2026-11-08T10:00:00.000Z'),place:{id:null,name:null},world:'Mars'}]);
 assert.deepEqual(v.map((e)=>e.kind),['travel','performance','arrival']);
});

test('A3: a second look and a rebuilt world give the same timeline', () => {
 const fill=(t:SoulTimeline,order:number[])=>{for(const i of order)t.note(receipt(`r_${i}`,'sing:here',{},'completed',i),1000+i);};
 const a=new SoulTimeline(new DatabaseSync(':memory:'),'w'),b=new SoulTimeline(new DatabaseSync(':memory:'),'w');
 fill(a,[1,2,3]);fill(a,[1,2,3]);fill(b,[3,1,2]);
 assert.deepEqual(view(a),view(b)); assert.equal(view(a).length,3);
});

test('A5: a read is one bounded index lookup, however long the log', () => {
 const db=new DatabaseSync(':memory:'),t=new SoulTimeline(db,'w');
 const plan=db.prepare("EXPLAIN QUERY PLAN SELECT receipt_id,kind,tick,at,place_id,title,n FROM edge_timeline_v1 WHERE world_id=? AND soul_id=? ORDER BY tick DESC, receipt_id DESC LIMIT ?").all('w','s_a',20) as {detail:string}[];
 assert.match(plan.map((p)=>p.detail).join(' '),/USING (COVERING )?INDEX edge_timeline_v1_soul/); assert.doesNotMatch(plan.map((p)=>p.detail).join(' '),/TEMP B-TREE/);
 assert.deepEqual(view(t),[]);
});
