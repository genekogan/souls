// D1 (playtest 2026-10-25, 104004 pip-002..005): on the ferris wheel the card read "Ride the ferris wheel" only while the
// join ran, then "Standing around" for the whole ride. The card's doing line, the Soul status and the open receipt now read
// the body: walking to the wheel (with metres left), boarding, riding for the whole turn, then standing again. Also the
// stale "Lie down" after a stand (071922/111032): a stopped program with nothing after it no longer names the old plan.
import test from 'node:test';import assert from 'node:assert/strict';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {Hono} from 'hono';import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';import {hashToken} from './auth.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {attractionRoute} from './god/rides.ts';
const common=await retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
async function setup(t:{after(fn:()=>void):void}){
 const f=fixture(':memory:',common,{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();
 const token='sim_BODY_STATE_RIDE_TOKEN';
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));await invite(f,'rider');
 const row=await accept<{id:string;entity_id:string}>(f.host,f.souls.create('dev:rider',{name:'Rider',description:'body-state fixture'}));
 // a god ferris wheel is installed as a balloon carrier on the wheel's attraction route (god/rides.ts), home at [-20, -9]
 const r=attractionRoute('ferris-wheel',{x:-20,z:-13.6,yaw:0,s:1},0,[12,14,3]);
 await accept<unknown>(f.host,f.host.installCarrierV1({id:'resort-ferris-wheel',def:'hot-air-balloon',label:'ferris wheel',at:[r.home[0],r.home[2]],y:r.home[1],yaw:Math.PI,route:r.route,routeKeys:r.keys,waitSeconds:15}));
 f.db.setSoulToken(row.id,hashToken(token),'synthetic');
 const ledger=new EdgeLedger(f.host,f.db),app=new Hono();
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'')),ledger});
 t.after(()=>{comms.close();f.host.stop();f.db.close();});
 comms.objects.create({id:'ride-test',kind:'ride',name:'Ferris wheel',placeId:'world',params:{carrier:'resort-ferris-wheel',vehicle:'ferris-wheel'}});
 const post=async(path:string,body:unknown)=>{const res=await accept(f.host,Promise.resolve(app.request(path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})));return await res.json() as {accepted:boolean;code?:string;reason?:string;receipt?:{id:string}};};
 const ent=()=>(f.host.engine.world.entities as Record<string,any>),wheel=()=>ent()['resort-ferris-wheel'].carrier,tick=(n:number,until?:()=>boolean)=>{for(let i=0;i<n&&!until?.();i++)f.host.tickOnce();};
 const mind=()=>f.host.minds.get(row.id)!,card=()=>f.host.publicSoul(mind()).doing,status=()=>f.souls.status(f.db.soul(row.id) as never) as {doing:string;body:{on:string|null;posture:string}|null};
 return {f,row,ledger,post,ent,wheel,tick,card,status,actor:row.entity_id};
}

test('D1: the card reads the walk, the boarding and "riding the ferris wheel" for the whole ride, never "standing around" aboard',{timeout:600000},async t=>{
 const q=await setup(t);
 const joined=await q.post('/v1/edge/act',{capability:'object:ride-test:join',clientRef:'join'});assert.equal(joined.accepted,true,JSON.stringify(joined));
 // the approach: the receipt's body names the step, the card says walking, not the plan's label
 type Seen={now?:string;body?:{step?:string}};let walk=null as Seen|null,walkCard='';
 q.tick(3000,()=>{if(!walk&&q.ent()[q.actor].human.activity==='walk'){walk=q.ledger.receipt(q.row.id,joined.receipt!.id) as Seen;walkCard=q.card();}return !!q.ledger.aboard(q.actor);});
 assert.ok(walk,'the body walked to the wheel');
 assert.match(walk!.body?.step??'',/^walking to ferris wheel, \d+ m left$/,JSON.stringify(walk));
 assert.match(walk!.now??'',/^walking to ferris wheel, \d+ m left; not aboard yet$/);
 assert.equal(walkCard,'walking to ferris wheel');
 q.tick(3000,()=>q.ledger.aboard(q.actor)?.riderPhase==='seated');assert.equal(q.ledger.aboard(q.actor)?.riderPhase,'seated');
 assert.match(q.card(),/^seated in the ferris wheel, waiting for it to start$/);
 q.wheel().departAtTick=q.f.host.engine.world.tick;q.tick(200,()=>q.wheel().phase==='aloft');assert.equal(q.wheel().phase,'aloft');
 const seen=new Map<string,number>();let aloft=0;
 for(let i=0;i<4000&&q.ledger.aboard(q.actor);i++){
  q.f.host.tickOnce();const d=q.card();seen.set(d,(seen.get(d)??0)+1);
  if(q.ledger.aboard(q.actor))assert.notEqual(d,'standing around','aboard at tick '+q.f.host.engine.world.tick);
  if(q.wheel().phase==='aloft'&&q.ledger.aboard(q.actor)?.riderPhase==='seated'){aloft++;assert.equal(d,'riding the ferris wheel');
   if(aloft===100){const s=q.status();assert.equal(s.doing,'riding the ferris wheel');assert.equal(s.body?.on,'ferris wheel');assert.equal(s.body?.posture,'riding');}}
 }
 t.diagnostic('card lines during the ride: '+JSON.stringify([...seen]));
 assert.ok(aloft>=1000,`rode ${aloft} ticks aloft`);
 assert.equal(q.ledger.aboard(q.actor),null,'off the wheel');assert.equal(q.card(),'standing around');
});

test('D1: a stand after a lie-down clears the card\'s "Lie down"',{timeout:600000},async t=>{
 const q=await setup(t);
 const lie=await q.post('/v1/edge/act',{capability:'lie:here',clientRef:'lie'});assert.equal(lie.accepted,true,JSON.stringify(lie));
 q.tick(1200,()=>q.ent()[q.actor].human.activity==='lie');assert.equal(q.ent()[q.actor].human.activity,'lie');
 assert.match(q.card(),/^Lie down/);
 const stand=await q.post('/v1/edge/act',{capability:'stand:here',clientRef:'stand'});assert.equal(stand.accepted,true,JSON.stringify(stand));
 q.tick(600,()=>!q.f.host.engine.programOf(q.actor)&&q.ent()[q.actor].human.activity==='idle');q.tick(2); // the stopped program's end reaches the world on the next tick
 assert.equal(q.f.host.engine.programOf(q.actor),null);assert.equal(q.card(),'standing around');
});
