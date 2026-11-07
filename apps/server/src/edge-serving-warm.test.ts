// Boot warm (EdgeLedger.prepareForServing): listing live Souls' capabilities before HTTP opens is a read. It changes no
// world state or log, lists the first Soul with a body (then more within the budget), and a warmed ledger answers the
// same capabilities as a cold one for the same state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {readFileSync} from 'node:fs';
import {Hono} from 'hono';
import {Admission,admissionMiddleware} from './load/admission.ts';
import {servingRead,servingWait} from './http.ts';

test('prepareForServing warms within its budget, changes nothing, and lists what a cold ledger lists',{timeout:300000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 const rows:any[]=[];for(const n of ['ana','ben']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'walker'})));}
 for(let i=0;i<4;i++)f.host.tickOnce();
 const before={seq:f.host.seq,hash:f.host.engine.stateHash(),tick:f.host.engine.world.tick};
 const warm=new EdgeLedger(f.host,f.db);
 assert.deepEqual({...warm.prepareForServing(),ms:0},{souls:1,failed:0,ms:0},'the first Soul with a body, even with no budget');
 assert.deepEqual({...warm.prepareForServing(60_000),ms:0},{souls:2,failed:0,ms:0},'then more while within the budget');
 assert.deepEqual({seq:f.host.seq,hash:f.host.engine.stateHash(),tick:f.host.engine.world.tick},before,'a read: no event, no state change');
 const cold=new EdgeLedger(f.host,f.db);
 for(const r of rows){const soul={soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner};
  assert.deepEqual(JSON.stringify(warm.capabilities(soul)),JSON.stringify(cold.capabilities(soul)),r.name);}
});

// Continuity (warm after listen, 2026-10-31): main.ts opens the port first and then warms in slices (warmForServing);
// rich edge reads wait for it in a middleware placed before admission (servingWait).
async function world(t:{after:(f:()=>void)=>void}){
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 const rows:any[]=[];for(const n of ['ana','ben']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'walker'})));}
 for(let i=0;i<4;i++)f.host.tickOnce();
 return {f,rows};
}
/** A turn of the event loop the test hands out one at a time. */
function turns(){const waiting:(()=>void)[]=[];let given=0;
 return {turn:()=>new Promise<void>(r=>{waiting.push(r);}),async step(n=1){for(let i=0;i<n;i++){while(!waiting.length)await new Promise(r=>setImmediate(r));waiting.shift()!();given++;}},get pending(){return waiting.length;},get given(){return given;}};}
const settled=async(p:Promise<unknown>)=>{let s=false;void p.then(()=>{s=true;});for(let i=0;i<3;i++)await new Promise(r=>setImmediate(r));return s;};

test('warmForServing: slices with a turn between, ends with the listing, changes nothing, and lists what a cold ledger lists',{timeout:300000},async t=>{
 const {f,rows}=await world(t);
 const before={seq:f.host.seq,hash:f.host.engine.stateHash(),tick:f.host.engine.world.tick};
 const warm=new EdgeLedger(f.host,f.db),seen:string[]=[];let turnsTaken=0;
 assert.equal(warm.whenServing(),null,'no warm: nothing to wait for');
 const pre=function*(soul:{soulId:string}){for(let i=0;i<5;i++){seen.push(soul.soulId);yield;}};
 const run=warm.warmForServing({sliceMs:0,pre,turn:()=>{turnsTaken++;return new Promise(r=>setImmediate(r));}});
 assert.ok(warm.whenServing(),'while it runs, reads have something to wait for');
 const w=await run;
 assert.equal(warm.whenServing(),null,'after it ends: nothing to wait for');
 assert.deepEqual(seen,Array(5).fill(rows[0].id),'pre runs for the first Soul with a body, one step per slice at sliceMs 0');
 assert.ok(w.slices>=6,`pre's steps and the item sources are sliced (${w.slices})`);assert.ok(turnsTaken>w.slices,'a turn after each slice, and one first');
 assert.deepEqual({souls:w.souls,failed:w.failed,stopped:w.stopped},{souls:1,failed:0,stopped:false},'then the listing, once');
 assert.ok(w.wallMs>=w.listingMs&&w.ms>=w.listingMs);
 assert.deepEqual({seq:f.host.seq,hash:f.host.engine.stateHash(),tick:f.host.engine.world.tick},before,'a read: no event, no state change');
 const cold=new EdgeLedger(f.host,f.db);
 for(const r of rows){const soul={soulId:r.id,entityId:r.entity_id,name:r.name,owner:r.owner};
  assert.deepEqual(JSON.stringify(warm.capabilities(soul)),JSON.stringify(cold.capabilities(soul)),r.name);}
});

test('warmForServing: reads wait until it ends; the ceiling lets them go; stop skips the listing; a rewarm waits for the running warm',{timeout:300000},async t=>{
 const {f}=await world(t);
 const e=new EdgeLedger(f.host,f.db),k=turns();let steps=0;
 const pre=function*(){for(let i=0;i<3;i++){steps++;yield;}};
 const run=e.warmForServing({sliceMs:0,pre,turn:k.turn});
 const read=e.whenServing()!,capped=e.whenServing(30)!;
 await k.step(2);assert.equal(await settled(read),false,'a read waits while slices remain');
 await new Promise(r=>setTimeout(r,60));assert.equal(await settled(capped),true,'the ceiling: the read goes on (and builds cold) while the warm still runs');
 assert.equal(await settled(read),false);assert.ok(e.whenServing(),'the warm still runs');
 // a rewarm asked for meanwhile (the punt install's) waits for this one; reads now wait for the rewarm
 let rewarmStarted=false;const rewarm=e.warmForServing({sliceMs:0,pre:function*(){rewarmStarted=true;yield;},turn:()=>new Promise(r=>setImmediate(r))});
 const readAfter=e.whenServing()!;
 await k.step(1);assert.equal(rewarmStarted,false,'the rewarm does not interleave with the running warm');
 while(!(await settled(run)))await k.step(1);
 assert.equal(await settled(read),true,'the first warm ended: the read that waited for it goes on');
 const w=await run;assert.equal(steps,3);assert.equal(w.souls,1);
 const w2=await rewarm;assert.equal(rewarmStarted,true);assert.equal(w2.souls,1);assert.equal(await settled(readAfter),true);
 assert.equal(e.whenServing(),null);
 // stop (shutdown): no further slice and no listing
 let stopped=false;const halt=e.warmForServing({sliceMs:0,pre:function*(){for(;;){stopped=true;yield;}},stop:()=>stopped});
 const h=await halt;assert.deepEqual({stopped:h.stopped,souls:h.souls,listingMs:h.listingMs},{stopped:true,souls:0,listingMs:0});
 assert.equal(e.whenServing(),null);
});

test('servingWait: rich reads wait BEFORE admission (not in flight, not billed, no 429); other routes and view=body do not wait',async()=>{
 assert.deepEqual(['GET /v1/edge/here','GET /v1/edge/observe','GET /v1/edge/capabilities','GET /v1/edge/around','POST /v1/edge/resolve','POST /v1/edge/act','POST /v1/edge/converse'].map(s=>{const [m,p]=s.split(' ');return servingRead(m,p);}),[true,true,true,true,true,true,true]);
 assert.equal(servingRead('GET','/v1/edge/here','body'),false,'the body view lists no menu');
 for(const [m,p] of [['GET','/healthz'],['GET','/v1/edge/view'],['GET','/v1/edge/map'],['POST','/v1/edge/say']])assert.equal(servingRead(m,p),false,`${m} ${p}`);
 let now=1000;const adm=new Admission({now:()=>now});
 let release!:()=>void;let gate:Promise<void>|null=new Promise<void>(r=>{release=()=>{gate=null;r();};});
 const app=new Hono();app.use('/v1/edge/*',servingWait(()=>gate));
 app.use('*',admissionMiddleware(adm,()=>'green',c=>c.req.header('authorization')?.slice(7)));
 app.get('/v1/edge/here',c=>{now+=5;return c.json({ok:true,view:c.req.query('view')??null});});app.get('/healthz',c=>c.text('ok'));
 const get=(path:string,token?:string)=>app.request(path,{headers:token?{authorization:'Bearer '+token}:{}});
 const reads=['a','b','c','a2'].map(k=>get('/v1/edge/here?include=doHere',k));
 assert.equal((await get('/healthz')).status,200,'healthz never waits');
 assert.equal((await get('/v1/edge/here?view=body','d')).status,200,'the body view answers during the warm');
 assert.equal(adm.outstanding.size,0,'waiting reads are not in flight: a Soul\'s other request is not soul.busy for them');
 now+=8000;release();   // the warm took 8 s of (fake) time
 const res=await Promise.all(reads);
 assert.deepEqual(res.map(r=>r.status),[200,200,200,200],'no 429/503 from waiting');
 assert.ok(adm.estimate('edge:here')<100,`the wait is not billed as request time (estimate ${adm.estimate('edge:here')} ms)`);
 assert.equal(adm.shed.reads,0);
 // buildApp mounts it before admission (R5/R6 touch admission: keep the order)
 const src=readFileSync(new URL('./http.ts',import.meta.url),'utf8'),build=src.slice(src.indexOf('export function buildApp'));
 assert.ok(build.indexOf('servingWait(')>0&&build.indexOf('servingWait(')<build.indexOf('admissionMiddleware('),'servingWait is mounted before admission in buildApp');
});
