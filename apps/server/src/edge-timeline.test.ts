// CTX-8 (#1141): a Soul's public biography: only canonical, public facts, bounded, stamped when they happened, rebuilt the same.
import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {SoulTimeline,TIMELINE_MAX,entryOf,timelineView,type TimelineEntry} from './edge/ledger/timeline.ts';
import type {EdgeReceipt} from './edge/contract.ts';

const receipt=(id:string,capability:string,outcome:object={},phase='completed',tick=10)=>({id,soulId:'s_a',capability,phase,acceptedTick:tick,endedTick:tick+5,endedAt:{place:'hall'},outcome} as unknown as EdgeReceipt);
const clock=(tick:number)=>({worldDay:1+Math.floor(tick/100),time:'09:00'});
const view=(t:SoulTimeline,limit=TIMELINE_MAX,extra:TimelineEntry[]=[],secret=false)=>timelineView(t.rows('s_a',limit),extra,{limit,placeName:(id)=>id==='hall'&&!secret?'Main Hall':null});
const made=(visibility:string,title='Dawn')=>({produced:[{id:'o_1',kind:'page',title,where:'hall',visibility}]});

test('A1: public things made, performances and gatherings are kept; a private record, a walk, a hug and a failure are not', () => {
 assert.deepEqual(entryOf(receipt('r','paint:easel'),made('public') as never),{kind:'produced',title:'Dawn'});
 for(const cap of ['write:desk','craft:bench','post-letter:box'])assert.equal(entryOf(receipt('r',cap),made('private','My secret diary') as never),null,cap);
 assert.equal(entryOf(receipt('r','paint:easel'),made('participants') as never),null);
 for(const [cap,title] of [['play-piano:hall','Play the piano'],['play-music:drums','Play music'],['lecture:podium','Give a talk or a lesson'],['tell-story:circle','Tell a story to the circle']] as const)assert.deepEqual(entryOf(receipt('r',cap),undefined),{kind:'performance',title},cap);
 assert.deepEqual(entryOf(receipt('r','social-dance:band'),undefined),{kind:'gathering',title:'Dance on the bandstand'});
 for(const cap of ['walk:hall','read:sign','hug:s_b','accept:inv_1','gather:field','dance:here','play:piano'])assert.equal(entryOf(receipt('r',cap),{met:[{soulId:'s_b',name:'B'}]} as never),null,cap);
 assert.equal(entryOf(receipt('r','play-piano:hall',{},'failed'),undefined),null,'only what happened');
});

test('A1: newest first, the clock of that moment, a place by name, at most N, under the stated budget', () => {
 const t=new SoulTimeline(new DatabaseSync(':memory:'),'w');
 for(let i=0;i<30;i++)t.note(receipt(`r_${String(i).padStart(2,'0')}`,'play-piano:x',{},'completed',i*50),Date.parse('2026-11-07T10:00:00.000Z')+i*1000,clock);
 const v=view(t);
 assert.equal(v.length,TIMELINE_MAX); assert.equal(v[0]!.when.tick,29*50);
 assert.deepEqual(v[0],{kind:'performance',when:{real:'2026-11-07T10:00:29.000Z',tick:1450,worldDay:15,time:'09:00'},place:{id:'hall',name:'Main Hall'},title:'Play the piano'});
 const long=new SoulTimeline(new DatabaseSync(':memory:'),'w');
 for(let i=0;i<30;i++)long.note(receipt(`r_${i}`,'paint:x',made('public','t'.repeat(200))),1000+i,clock);
 assert.ok(Buffer.byteLength(JSON.stringify(timelineView(long.rows('s_a',20),[],{placeName:()=>'p'.repeat(200)})))<8192,'the profile\'s budget');
});

test('A1: a clock is the one of its moment: a later change of the world\'s origin rewrites nothing', () => {
 const t=new SoulTimeline(new DatabaseSync(':memory:'),'w');
 t.note(receipt('r_1','sing:mic'),1000,()=>({worldDay:3,time:'07:30'}));
 assert.deepEqual([view(t)[0]!.when.worldDay,view(t)[0]!.when.time],[3,'07:30']);
});

test('A1: a secret place loses its id as well as its name; arrival and travel have clocks and places', () => {
 const t=new SoulTimeline(new DatabaseSync(':memory:'),'w');
 t.note(receipt('r_1','sing:mic'),2000,clock);
 assert.deepEqual(view(t,20,[],true)[0]!.place,{id:null,name:null});
 t.arrived('s_a',5,1000,clock(5),'hall'); t.travelled('s_a',50,3000,clock(50),'hall','Mars');
 const v=view(t); assert.deepEqual(v.map((e)=>e.kind),['travel','performance','arrival']);
 assert.equal(v[0]!.world,'Mars'); for(const e of v){assert.equal(e.when.worldDay,1);assert.equal(e.place.name,'Main Hall');}
 const extra=[{kind:'arrival',when:{real:new Date(1000).toISOString(),tick:null,worldDay:null,time:null},place:{id:null,name:null}}] as TimelineEntry[];
 assert.equal(view(t,20,extra).filter((e)=>e.kind==='arrival').length,1,'a kept arrival isn\'t shown twice');
});

test('A3: a second look gives the same, and rows come back from the receipts', () => {
 const db=new DatabaseSync(':memory:'),t=new SoulTimeline(db,'w'),list=[1,2,3].map((i)=>({receipt:receipt(`r_${i}`,'sing:mic',{},'completed',i),at:1000+i}));
 for(const r of [...list,...list])t.note(r.receipt,r.at,clock);
 const before=view(t); assert.equal(before.length,3);
 db.exec('DELETE FROM edge_timeline_v1');
 t.ensure('s_a',()=>list,clock); assert.deepEqual(view(t),before);
 db.exec('DELETE FROM edge_timeline_v1');
 t.ensure('s_a',()=>list,clock); assert.deepEqual(view(t),[],'once per Soul');
});

test('A5: a read is one bounded index lookup, however long the log', () => {
 const db=new DatabaseSync(':memory:');new SoulTimeline(db,'w');
 const plan=db.prepare("EXPLAIN QUERY PLAN SELECT receipt_id,kind,tick,at,world_day,time,place_id,title,world FROM edge_timeline_v1 WHERE world_id=? AND soul_id=? ORDER BY at DESC, receipt_id DESC LIMIT ?").all('w','s_a',20) as {detail:string}[];
 assert.match(plan.map((p)=>p.detail).join(' '),/USING (COVERING )?INDEX edge_timeline_v1_soul/); assert.doesNotMatch(plan.map((p)=>p.detail).join(' '),/TEMP B-TREE/);
});

const factory=nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory());
async function world(t:TestContext){
 const f=fixture(':memory:',factory,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await invite(f,'alice');const row=await accept<{id:string}>(f.host,f.souls.create('dev:alice',{name:'Alice',description:'Synthetic'}) as never);
 f.db.setSoulToken(row.id,hashToken('sim_T'),'synthetic');
 const ledger=new EdgeLedger(f.host,f.db),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});
 t.after(()=>{f.host.stop();f.db.close();});
 const get=(path:string,headers:Record<string,string>={})=>accept<Response>(f.host,app.request(path,{headers:{authorization:'Bearer sim_T',...headers}}) as never);
 return {...f,row,ledger,get};
}
const seed=(f:Awaited<ReturnType<typeof world>>,id:string,capability:string,outcome:object)=>{
 f.db.db.prepare("INSERT INTO edge_receipts_v1(world_id,receipt_id,soul_id,capability,phase,accepted_tick,created_at) VALUES(?,?,?,?,'completed',?,?)").run(f.host.worldId,id,f.row.id,capability,20,Date.now());
 f.db.db.prepare('INSERT INTO edge_outcomes_v1(world_id,receipt_id,soul_id,body) VALUES(?,?,?,?)').run(f.host.worldId,id,f.row.id,JSON.stringify({contract:'eden-edge/1.1',kind:capability.split(':')[0],summary:'x',learned:[],changed:[],met:[],detail:{},untrusted:false,produced:[],...outcome}));
};

test('A1 A3 A4: the route: a private title never shows, a rebuild finds the rest, an ETag revalidates', async t => {
 const f=await world(t),path=`/v1/edge/public/souls/${f.row.id}`;
 seed(f,'r_p','write:desk',made('private','My secret diary'));seed(f,'r_o','paint:easel',made('public','Dawn'));seed(f,'r_m','play-piano:hall',{});
 const r=await f.get(path),text=await r.clone().text(),body=await r.json() as {timeline:TimelineEntry[]};
 assert.equal(r.status,200);assert.doesNotMatch(text,/My secret diary/);
 assert.deepEqual(body.timeline.map((e)=>e.kind).sort(),['arrival','performance','produced']);
 assert.ok(body.timeline.some((e)=>e.kind==='produced'&&e.title==='Dawn'));assert.ok(body.timeline.some((e)=>e.title==='Play the piano'));
 const etag=r.headers.get('etag')!;assert.match(etag,/^"/);assert.equal(r.headers.get('cache-control'),'no-cache');
 assert.equal((await f.get(path,{'if-none-match':etag})).status,304);
 assert.equal((await f.get(path,{'if-none-match':'"other"'})).status,200);
 assert.equal((await f.get('/v1/edge/public/souls/s_none')).headers.get('etag'),null,'an error is not cached');
});

test('a travel log with a bad time costs that entry, not the record', async t => {
 const f=await world(t);f.ledger.travelLogOf=()=>[{at:Number.NaN,to:'Mars'},{at:Date.now(),to:'Venus'}];
 const r=await f.get(`/v1/edge/public/souls/${f.row.id}`),body=await r.json() as {timeline:TimelineEntry[]};
 assert.equal(r.status,200);assert.deepEqual(body.timeline.filter((e)=>e.kind==='travel').map((e)=>e.world),['Venus']);
});
