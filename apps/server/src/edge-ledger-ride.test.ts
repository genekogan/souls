// carrier/1 + kind `ride` (OBJECT-CONTRACT-v1 §7): two Souls board a balloon, lift off, talk privately in the basket,
// converse, cannot leave mid-air, land and step out by themselves; capacity is enforced; genesis replay is exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {kernelHash} from '@souls/kernel';
import {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';
import {CARRIER_ROUTES,routePosition} from '../../../mars/viewer/engine/vehicles/carrier.ts';

const factory=()=>retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
test('balloon ride: board, lift off, private speech + converse, no leaving aloft, land, alight, replay exact',{timeout:600000},async t=>{
 const f=fixture(':memory:',await factory(),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1(),f.host.enableEdgeMotionV1()])await accept<unknown>(f.host,p);
 const rows:any[]=[];for(const n of ['ana','ben','cy']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'rider'})));}
 const tokens=rows.map((r,i)=>{const tok='sim_RIDE_TEST_TOKEN_'+i;f.db.setSoulToken(r.id,hashToken(tok),'synthetic');return tok;});
 await accept<unknown>(f.host,f.host.installCarrierV1({id:'eden-balloon',def:'hot-air-balloon',label:'Red balloon',at:[-20,-9],yaw:Math.PI,route:'commons-hop',waitSeconds:60}));
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:true}),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});t.after(()=>comms.close());
 comms.objects.create({id:'ride-eden-balloon',kind:'ride',name:'Red balloon',placeId:'world',params:{carrier:'eden-balloon'}});
 const pump=async<T>(p:Promise<T>)=>{let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<400&&!done;i++){await setImmediate();f.host.drainInputs();}assert.ok(done,'request settled');return p;};
 const call=async(i:number,method:string,path:string,body?:unknown)=>{const res=await pump(app.request(path,{method,headers:{authorization:'Bearer '+tokens[i],'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) as Promise<Response>);return await res.json() as any;};
 const dump=()=>rows.map((r,i)=>`${i}:${r.entity_id} ${ent(i).pose.p.map((v:number)=>v.toFixed(2))} ${ent(i).human.activity} ${JSON.stringify(ent(i).human.carrier??null)} task=${ent(i).human.task} rec=${ent(i).human.task?JSON.stringify((f.host.engine.runtime.records.get(ent(i).human.task) as any)):''}`).join('\n');
 const run=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){try{f.host.tickOnce();}catch(e){console.error(dump());throw e;}if(i%20===0){await setImmediate();f.host.drainInputs();}}return until();};
 const W=f.host.engine.world as any,balloon=()=>W.entities['eden-balloon'],ent=(i:number)=>W.entities[rows[i].entity_id];
 const phase=(i:number,id:string)=>ledger.receipt(rows[i].id,id)!;
 // BALLOON-BODY (Gene 2026-10-23: "they walk through the walls"): a body (radius ~0.2 m) near the back wall is in its door gap
 // (0.56 m wide, so the centre within 0.08 m of the door line), and never near the other three walls while on the ground.
 const walls:string[]=[],watch=()=>{const b=balloon();if(b.pose.p[1]>.05)return;const c=Math.cos(b.pose.yaw),s=Math.sin(b.pose.yaw);
  for(const i of [0,1]){const p=ent(i).pose.p,dx=p[0]-b.pose.p[0],dz=p[2]-b.pose.p[2],lx=dx*c+dz*s,lz=-dx*s+dz*c,R=.2;
   const nearBack=Math.abs(lx+.75)<R&&Math.abs(lz)<.6+R,nearOther=(Math.abs(lx-.75)<R&&Math.abs(lz)<.6+R)||(Math.abs(Math.abs(lz)-.6)<R&&Math.abs(lx)<.75+R);
   if((nearBack&&Math.abs(lz)>.28-R)||nearOther)walls.push(`${i}@tick ${f.host.engine.world.tick} local ${lx.toFixed(2)},${lz.toFixed(2)}`);}};

 // the derived basket place, the public ride view, the capability
 assert.ok(ledger.places.byId.get('eden-balloon-basket')?.enclosed,'derived enclosed basket place');
 const caps=(await call(0,'GET','/v1/edge/capabilities')).capabilities;assert.ok(caps.some((c:any)=>c.id==='object:ride-eden-balloon:join'&&c.available),'join offered');
 const rides=await (await app.request('/v1/edge/rides')).json() as any;assert.equal(rides.rides[0].phase,'parked');assert.equal(rides.rides[0].capacity,2);

 // cy walks up beside the parked basket (a plain logged decision), to stand within earshot below
 await pump(f.host.enqueue('decision','edge:'+rows[2].id,{soulId:rows[2].id,entityId:rows[2].entity_id,option:'test',label:'walk to the balloon',steps:[{verb:'walk_to',params:{to:'eden-balloon',standoff:5}}],reevalTicks:1e9,fallback:false,trigger:'test'}));
 assert.ok(await run(2000,()=>!f.host.engine.programOf(rows[2].entity_id)),'cy arrived');
 // two Souls join: each walks to the step and climbs in; the receipt completes when seated
 const ja=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.equal(ja.accepted,true,JSON.stringify(ja));
 const jb=await call(1,'POST','/v1/edge/objects/ride-eden-balloon/act',{action:'join'});assert.equal(jb.accepted,true,JSON.stringify(jb));assert.ok(jb.receipt?.id,'object route returns a receipt');
 assert.ok(await run(3000,()=>(watch(),phase(0,ja.receipt.id).phase==='completed'&&phase(1,jb.receipt.id).phase==='completed')),`both seated: ${JSON.stringify([phase(0,ja.receipt.id),phase(1,jb.receipt.id)])}`);
 assert.match(String(phase(0,ja.receipt.id).outcome?.summary),/Boarded.*not left the ground yet and is not finished/,'a boarding receipt never reads as a finished ride: '+JSON.stringify(phase(0,ja.receipt.id).outcome));
 assert.equal(balloon().carrier.phase,'boarding');assert.equal(ent(0).human.carrier.phase,'seated');
 const path=ledger.placePathOf(rows[0].id).map(p=>p.id);assert.deepEqual(path.slice(0,2),['eden-balloon-'+ent(0).human.carrier.slot,'eden-balloon-basket'],JSON.stringify(path));
 // capacity: a third Soul is refused
 const jc=await call(2,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.equal(jc.accepted,false);assert.equal(jc.code,'ride.full');
 // ana: lift off now
 const st=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:start'});assert.equal(st.accepted,true,JSON.stringify(st));
 assert.ok(await run(400,()=>balloon().carrier.phase==='aloft'&&balloon().pose.p[1]>3),'lifted off');
 assert.equal((await call(0,'GET','/v1/edge/observe')).self.state,'riding');
 // speech in the basket: heard by ben only; cy on the ground hears nothing and is not heard
 const said=await call(0,'POST','/v1/edge/say',{text:'look, the pond'});assert.equal(said.said.channel.kind,'enclosure');assert.equal(said.said.heardBy,1);
 const near=Math.hypot(ent(2).pose.p[0]-balloon().pose.p[0],ent(2).pose.p[2]-balloon().pose.p[2]);assert.ok(near<12,`cy stands within earshot below (${near.toFixed(1)} m)`);
 assert.ok(!(await call(2,'GET','/v1/edge/observe')).here.souls.length,'riders are not perceived from the ground');
 const ground=await call(2,'POST','/v1/edge/say',{text:'hello up there'});assert.equal(ground.said.heardBy,0);
 const cv=await call(0,'POST','/v1/edge/converse',{op:'start',with:[rows[1].id],text:'shall we talk?'});assert.equal(cv.accepted,true,JSON.stringify(cv));
 // nobody steps out mid-air; capabilities say why
 const walk=(await call(1,'GET','/v1/edge/capabilities')).capabilities.find((c:any)=>c.verb==='walk');assert.equal(walk?.available,false);assert.equal(walk?.blocked?.code,'ride.aboard');
 const w=await call(1,'POST','/v1/edge/act',{capability:'wander:here'});assert.equal(w.accepted,false);
 const lv=await call(1,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:leave'});assert.equal(lv.accepted,false);assert.equal(lv.code,'ride.aloft');
 // spectator frames carry the ride; the object tells riders it lifted off
 const top=Math.max(...CARRIER_ROUTES['commons-hop'].keys.map(k=>k.p[1]));let peak=0;
 assert.ok(await run(4000,()=>{peak=Math.max(peak,balloon().pose.p[1]);return balloon().carrier.phase!=='aloft';}),'landed');
 assert.ok(peak>top-1,'flew its route');
 assert.ok(await run(600,()=>(watch(),!ent(0).human.carrier&&!ent(1).human.carrier)),'both stepped out');
 assert.deepEqual(walls.slice(0,6),[],'boarding and stepping out go through the basket door, never through a wall');
 for(const i of [0,1]){const p=ent(i).pose.p;assert.ok(Math.abs(p[1])<1e-6&&Math.hypot(p[0]+20,p[2]+9)<3,`rider ${i} on the ground beside it: ${p}`);}
 assert.ok(await run(40,()=>balloon().carrier.phase==='parked'),'parked again');
 const stream=f.db.db.prepare("SELECT body FROM edge_comms_stream WHERE soul_id=? AND kind='object'").all(rows[0].id).map((r:any)=>JSON.parse(r.body).text);
 assert.ok(stream.some((x:string)=>/lifts off/.test(x))&&stream.some((x:string)=>/landed/.test(x)),JSON.stringify(stream));
 assert.equal(f.db.paidCost(),0);assert.deepEqual(f.host.engine.runtime.violations,[]);
 // a fresh replay of the log from genesis reaches the same world
 f.host.drainInputs();f.host.saveSnapshot(true);const head={engine:f.host.engine.stateHash(),kernel:kernelHash(f.host.kernel)};
 f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
 const h=new WorldHost(f.db,await factory(),f.host.seed,1e9,f.host.worldId,{durableClockV1:true});assert.equal(h.boot().from,'genesis');assert.deepEqual({engine:h.engine.stateHash(),kernel:kernelHash(h.kernel)},head,'replay exact');h.stop();
});

test('balloon route: smooth, starts and ends at home, never faster than a carried body may move (motion.teleport allows 0.6 m/tick for carried bodies; balloons stay under 6 m/s)',()=>{
 for(const r of Object.values(CARRIER_ROUTES)){let last=routePosition(r,0),max=0,end=r.keys[r.keys.length-1].t*20;
  for(let k=1;k<=end;k++){const p=routePosition(r,k);max=Math.max(max,Math.hypot(p[0]-last[0],p[1]-last[1],p[2]-last[2]));last=p;}
  assert.ok(max<0.3,`${r.id} max step ${max.toFixed(3)} m/tick`);}
});
