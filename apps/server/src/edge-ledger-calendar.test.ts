// Steward calendar: post an open gathering; public listing; interest; reminder at start.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Hono} from 'hono';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {registerEdgeComms} from './edge/comms/index.ts';
import {hashToken} from './auth.ts';
import {edgeSoulResolver} from './edge/routes.ts';
test('steward posts a calendar item; Souls see it, mark interest and are reminded when it starts',{timeout:120000},async t=>{
 const f=fixture(':memory:',nativeSleepSnapshotFactoryV1(await retainedCommonsShoreFactory()),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await invite(f,'ana');const row=await accept(f.host,f.souls.create('dev:ana',{name:'Ana',description:'cal'}));f.db.setSoulToken(row.id,hashToken('sim_CAL_ANA'),'t');
 const ledger=new EdgeLedger(f.host,f.db),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 const comms=registerEdgeComms(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger},{stewardToken:'steward-secret',sweepMs:0});ledger.attachComms(comms as any);t.after(()=>comms.close());
 const j=async(path:string,init:any={})=>{const r=await app.request(path,init);return {status:r.status,body:await r.json() as any};};
 const H={authorization:'Bearer sim_CAL_ANA','content-type':'application/json'},cursor=(await j('/v1/edge/wait?timeout=1',{headers:H})).body.cursor;
 assert.equal((await j('/v1/edge/steward/calendar',{method:'POST',headers:{authorization:'Bearer wrong','content-type':'application/json'},body:'{}'})).status,401);
 const posted=await j('/v1/edge/steward/calendar',{method:'POST',headers:{authorization:'Bearer steward-secret','content-type':'application/json'},body:JSON.stringify({title:"Tinker's Circle",placeId:'commons',startsInMinutes:0.05,durationMinutes:30,description:'Bring something to mend.',proposedBy:'Ana'})});
 assert.equal(posted.status,200,JSON.stringify(posted.body));const id=posted.body.calendarItem.id;
 const bare=await j('/v1/edge/steward/calendar',{method:'POST',headers:{authorization:'Bearer steward-secret','content-type':'application/json'},body:JSON.stringify({title:'Test',placeId:'field',startsInMinutes:20,durationMinutes:30})});assert.equal(bare.status,200,'no proposedBy: '+JSON.stringify(bare.body));
 const cal=await j('/v1/edge/calendar');assert.equal(cal.body.contract,'eden-edge/1');assert.ok(cal.body.items.some((x:any)=>x.id===id&&x.title==="Tinker's Circle"));
 const r=await j('/v1/edge/objects/'+id+'/act',{method:'POST',headers:H,body:JSON.stringify({action:'interest'})});assert.equal(r.body.accepted,true,JSON.stringify(r.body));
 // L8: the cached listing follows every object write; one visitor address may read it 60 times a minute
 const after=await j('/v1/edge/calendar');assert.notDeepEqual(after.body.items.find((x:any)=>x.id===id),cal.body.items.find((x:any)=>x.id===id),'interest shows at once');
 const from=(ip:string)=>j('/v1/edge/calendar',{headers:{'x-forwarded-for':`${ip}, 10.0.0.1`}});
 for(let i=0;i<60;i++)assert.equal((await from('203.0.113.7')).status,200);
 const over=await app.request('/v1/edge/calendar',{headers:{'x-forwarded-for':'203.0.113.7'}});assert.equal(over.status,429);assert.ok(Number(over.headers.get('retry-after'))>=1);
 assert.equal((await from('203.0.113.8')).status,200,'another address has its own allowance');
 assert.equal((await j('/v1/edge/calendar')).status,200,'no x-forwarded-for (this machine) is not address-limited');
 for(let i=0;i<120;i++)f.host.tickOnce();comms.sweep();
 const w=await j(`/v1/edge/wait?after=${encodeURIComponent(cursor)}&timeout=1`,{headers:H});
 assert.ok(w.body.events.some((e:any)=>e.kind==='world'&&/Tinker/.test(e.text)),'announced');assert.ok(w.body.events.some((e:any)=>e.kind==='schedule'&&/starting now/.test(JSON.stringify(e))),JSON.stringify(w.body.events.map((e:any)=>e.kind)));
});
