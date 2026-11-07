// SOUL3 continuation (ACCEPT3 A7): a newer here-activity supersedes a balloon join that is still walking to the basket;
// the body stops and starts it, and the superseded join never boards it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {retainedCommonsShoreFactory,nativeSleepSnapshotFactoryV1} from '@souls/engine-mars';
import {Hono} from 'hono';
import {fixture,invite,accept} from '../test/native-owner-fixture.ts';
import {LivingWorld} from './living.ts';
import {WorldHost} from './world.ts';
import {hashToken} from './auth.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mountEdgeRoutes,edgeSoulResolver} from './edge/routes.ts';

const factory=()=>retainedCommonsShoreFactory().then(nativeSleepSnapshotFactoryV1);
test('balloon join superseded before boarding: the newer here-activity starts, the old join never boards',{timeout:600000},async t=>{
 const f=fixture(':memory:',await factory(),{durableClockV1:true});f.souls.enableLifecycle();f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
 await accept<unknown>(f.host,new LivingWorld(f.host).install(['Owners drive their Souls.']));for(let i=0;i<4;i++)f.host.tickOnce();
 await accept(f.host,f.host.installCommonsProvisionsV1());await accept(f.host,f.host.installRetainedCommonsShoreV1());
 for(const p of [f.host.enableYieldTimeoutV1(),f.host.enableSpreadV2(),f.host.enableReflexTimeoutV1(),f.host.enableContinuousDayV1(),f.host.enableEdgeMotionV1()])await accept<unknown>(f.host,p);
 const rows:any[]=[];for(const n of ['ana','ben','cy']){await invite(f,n);rows.push(await accept(f.host,f.souls.create('dev:'+n,{name:n,description:'rider'})));}
 const tokens=rows.map((r,i)=>{const tok='sim_RIDE_TEST_TOKEN_'+i;f.db.setSoulToken(r.id,hashToken(tok),'synthetic');return tok;});
 await accept<unknown>(f.host,f.host.installCarrierV1({id:'eden-balloon',def:'hot-air-balloon',label:'Red balloon',at:[-20,-9],yaw:Math.PI,route:'commons-hop',waitSeconds:60}));
 // Isolated from ambient life: idle fixture Souls (ben, cy) at the shared spawn start ambient wander after 400 idle ticks; one walking
 // past within ~0.7 m made ana's courtesy step end her stretch pose.moved (A7 audit, a7-probe.log). The bar is the replacement's physical
 // start and zero boarding; unrelated actors' motion is not.
 const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false}),app=new Hono(),bearer=(c:any)=>c.req.header('authorization')?.replace(/^Bearer\s+/i,'');
 const comms=mountEdgeRoutes(app,{host:f.host,db:f.db,souls:f.souls,soul:edgeSoulResolver(f.host,f.souls,bearer),ledger});t.after(()=>comms.close());
 comms.objects.create({id:'ride-eden-balloon',kind:'ride',name:'Red balloon',placeId:'world',params:{carrier:'eden-balloon'}});
 const pump=async<T>(p:Promise<T>)=>{let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<400&&!done;i++){await setImmediate();f.host.drainInputs();}assert.ok(done,'request settled');return p;};
 const call=async(i:number,method:string,path:string,body?:unknown)=>{const res=await pump(app.request(path,{method,headers:{authorization:'Bearer '+tokens[i],'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}) as Promise<Response>);return await res.json() as any;};
 const dump=()=>rows.map((r,i)=>`${i}:${r.entity_id} ${ent(i).pose.p.map((v:number)=>v.toFixed(2))} ${ent(i).human.activity} ${JSON.stringify(ent(i).human.carrier??null)} task=${ent(i).human.task} rec=${ent(i).human.task?JSON.stringify((f.host.engine.runtime.records.get(ent(i).human.task) as any)):''}`).join('\n');
 const run=async(n:number,until:()=>boolean)=>{for(let i=0;i<n&&!until();i++){try{f.host.tickOnce();}catch(e){console.error(dump());throw e;}if(i%20===0){await setImmediate();f.host.drainInputs();}}return until();};
 const W=f.host.engine.world as any,balloon=()=>W.entities['eden-balloon'],ent=(i:number)=>W.entities[rows[i].entity_id];
 const phase=(i:number,id:string)=>ledger.receipt(rows[i].id,id)!;
 // ACCEPT3 A7 replay: the Soul's join is still a walk to the basket when a newer here-activity arrives
 const ja=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.equal(ja.accepted,true,JSON.stringify(ja));
 await run(15,()=>false);assert.equal(ent(0).human.activity,'walk','still walking to the basket');assert.equal(ledger.aboard(rows[0].entity_id),null);
 const rs=await call(0,'POST','/v1/edge/act',{capability:'stretch:here'});assert.equal(rs.accepted,true,'the replacement is admitted, not refused not-still: '+JSON.stringify(rs));
 assert.equal(phase(0,ja.receipt.id).phase,'replaced','the join is superseded');
 let boarded=0,began=-1;for(let k=0;k<1500;k++){await run(1,()=>false);if(ent(0).human.carrier||ledger.aboard(rows[0].entity_id))boarded++;if(began<0&&ent(0).human.activity==='stretch')began=k;}
 assert.equal(boarded,0,'no boarding from the superseded join');
 assert.ok(began>=0&&began<=40,'the stretch physically begins within 2 s: '+began);
 assert.equal(phase(0,rs.receipt.id).phase,'completed',JSON.stringify(phase(0,rs.receipt.id)));
 assert.ok(!Object.values(balloon().carrier.state?.seats??{}).includes(rows[0].entity_id),'never seated');
});


// RIDE-EXIT (soul3 continuation): a rider seated in a parked balloon steps out through the door before it lifts off; it was refused
// route.start-blocked (a walk cannot start inside the basket) and then carried up for the whole flight.
test('parked balloon: a seated rider leaves before lift-off, on foot through the door, and is not carried up',{timeout:600000},async t=>{
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
  for(const i of [0]){const p=ent(i).pose.p,dx=p[0]-b.pose.p[0],dz=p[2]-b.pose.p[2],lx=dx*c+dz*s,lz=-dx*s+dz*c,R=.2;
   const nearBack=Math.abs(lx+.75)<R&&Math.abs(lz)<.6+R,nearOther=(Math.abs(lx-.75)<R&&Math.abs(lz)<.6+R)||(Math.abs(Math.abs(lz)-.6)<R&&Math.abs(lx)<.75+R);
   if((nearBack&&Math.abs(lz)>.28-R)||nearOther)walls.push(`${i}@tick ${f.host.engine.world.tick} local ${lx.toFixed(2)},${lz.toFixed(2)}`);}};
 const ja=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.equal(ja.accepted,true,JSON.stringify(ja));
 assert.ok(await run(3000,()=>phase(0,ja.receipt.id).phase==='completed'),'seated');assert.equal(balloon().carrier.phase,'boarding');assert.equal(ent(0).human.carrier.phase,'seated');
 const lv=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:leave'});assert.equal(lv.accepted,true,'leave is admitted while parked: '+JSON.stringify(lv));
 let step=0,prev=[...ent(0).pose.p],maxY=0,out=-1,lifted=false;
 for(let k=0;k<1500;k++){await run(1,()=>false);watch();const p=ent(0).pose.p;step=Math.max(step,Math.hypot(p[0]-prev[0],p[1]-prev[1],p[2]-prev[2]));prev=[...p];maxY=Math.max(maxY,p[1]);
  if(out<0&&!ledger.aboard(rows[0].entity_id))out=k;if(balloon().carrier.phase==='aloft'&&ledger.aboard(rows[0].entity_id))lifted=true;}
 assert.ok(out>=0&&out<=12*20,'out of the basket within the 12 s step-out: '+out);assert.equal(lifted,false,'never carried up');
 assert.ok(maxY<.05&&step<.1,`on foot: max height ${maxY}, max step ${step} m/tick`);assert.deepEqual(walls,[],'through the door, never a wall');
 assert.ok(!Object.values(balloon().carrier.seats).includes(rows[0].entity_id),'seat freed');assert.equal(ent(0).human.carrier,undefined);
 assert.equal(phase(0,lv.receipt.id).phase,'completed',JSON.stringify(phase(0,lv.receipt.id)));
 // the freed balloon still boards and lifts; aloft, leaving stays refused (safe-stop) until it lands
 const jb=await call(1,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.ok(await run(3000,()=>phase(1,jb.receipt.id).phase==='completed'),'ben seated');
 assert.equal((await call(1,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:start'})).accepted,true);
 assert.ok(await run(400,()=>balloon().carrier.phase==='aloft'&&balloon().pose.p[1]>3),'lifted off with ben');
 const la=await call(1,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:leave'});assert.equal(la.accepted,false);assert.equal(la.code,'ride.aloft');
});

// RIDE-EXIT race: leave asked as lift-off falls due. d=0: the balloon is already up when the alight is admitted, so it fails truthfully
// (carrier.not-on-ground) and the rider steps out after landing; d>=1: the accepted alight holds lift-off and the rider walks out first.
test('parked balloon exit vs lift-off due d ticks later: never carried after an admitted alight, never out mid-air',{timeout:900000},async t=>{
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
  for(const i of [0]){const p=ent(i).pose.p,dx=p[0]-b.pose.p[0],dz=p[2]-b.pose.p[2],lx=dx*c+dz*s,lz=-dx*s+dz*c,R=.2;
   const nearBack=Math.abs(lx+.75)<R&&Math.abs(lz)<.6+R,nearOther=(Math.abs(lx-.75)<R&&Math.abs(lz)<.6+R)||(Math.abs(Math.abs(lz)-.6)<R&&Math.abs(lx)<.75+R);
   if((nearBack&&Math.abs(lz)>.28-R)||nearOther)walls.push(`${i}@tick ${f.host.engine.world.tick} local ${lx.toFixed(2)},${lz.toFixed(2)}`);}};
 for(const d of [0,1,2]){
  const ja=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});
  assert.ok(await run(3000,()=>phase(0,ja.receipt.id).phase==='completed'&&ent(0).human.carrier?.phase==='seated'),'seated d='+d);
  balloon().carrier.departAtTick=f.host.engine.world.tick+d;
  const lv=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:leave'});assert.equal(lv.accepted,true,JSON.stringify(lv));
  let lifted=false,out=-1,offY=0;
  for(let k=0;k<4000;k++){await run(1,()=>false);watch();const ab=!!ledger.aboard(rows[0].entity_id);if(ab&&balloon().carrier.phase==='aloft')lifted=true;
   if(!ab){offY=Math.max(offY,ent(0).pose.p[1]);if(out<0)out=k;}if(out>=0&&balloon().carrier.phase==='parked'&&k>out+40)break;}
  const rc=phase(0,lv.receipt.id);assert.ok(offY<.05,`never out mid-air d=${d}: ${offY}`);assert.deepEqual(walls,[],'door only');
  if(d===0){assert.equal(lifted,true,'already up at d=0');assert.equal(rc.phase,'failed');assert.equal(rc.code,'carrier.not-on-ground');assert.ok(out>0,'out after landing');}
  else {assert.equal(lifted,false,`an admitted alight holds lift-off d=${d}`);assert.ok(out>=0&&out<=12*20,`out in ${out} ticks d=${d}`);assert.equal(rc.phase,'completed',JSON.stringify(rc));}
 }
});

// SOUL3 stand truthfulness: stand:here while seated in a basket with nothing running answered 'completed' with the body still seated.
// It is now refused truthfully (ride.seated), consistent with capabilities, naming the explicit leave while parked; never turned into leave.
test('stand:here seated in a ride basket: truthful refusal (leave named while parked), never a false completed stand',{timeout:900000},async t=>{
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
  for(const i of [0]){const p=ent(i).pose.p,dx=p[0]-b.pose.p[0],dz=p[2]-b.pose.p[2],lx=dx*c+dz*s,lz=-dx*s+dz*c,R=.2;
   const nearBack=Math.abs(lx+.75)<R&&Math.abs(lz)<.6+R,nearOther=(Math.abs(lx-.75)<R&&Math.abs(lz)<.6+R)||(Math.abs(Math.abs(lz)-.6)<R&&Math.abs(lx)<.75+R);
   if((nearBack&&Math.abs(lz)>.28-R)||nearOther)walls.push(`${i}@tick ${f.host.engine.world.tick} local ${lx.toFixed(2)},${lz.toFixed(2)}`);}};
 const standCap=async(i:number)=>(await call(i,'GET','/v1/edge/capabilities')).capabilities.find((c:any)=>c.id==='stand:here');
 // ground: a standing Soul's stand is accepted as before
 const g=await call(1,'POST','/v1/edge/act',{capability:'stand:here'});assert.equal(g.accepted,true,JSON.stringify(g));
 const ja=await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:join'});assert.ok(await run(3000,()=>phase(0,ja.receipt.id).phase==='completed'&&ent(0).human.carrier?.phase==='seated'),'seated');
 const cp=await standCap(0);assert.equal(cp.available,false);assert.equal(cp.blocked.code,'ride.seated');assert.match(cp.blocked.reason,/object:ride-eden-balloon:leave/);
 const sp=await call(0,'POST','/v1/edge/act',{capability:'stand:here'});assert.equal(sp.accepted,false,'no false completed stand: '+JSON.stringify(sp));
 assert.equal(sp.code,'ride.seated');assert.equal(sp.reason,cp.blocked.reason,'act and capabilities agree');
 await run(200,()=>false);assert.equal(ent(0).human.carrier?.phase,'seated','stand is not turned into leave');assert.ok(ledger.aboard(rows[0].entity_id));
 assert.equal((await call(0,'GET','/v1/edge/capabilities')).capabilities.find((c:any)=>c.id==='object:ride-eden-balloon:leave')?.available,true,'the explicit exit stays offered');
 // aloft: same truthful refusal, no leave offered; a running rest is still stopped by stand; leave stays refused
 assert.equal((await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:start'})).accepted,true);
 assert.ok(await run(400,()=>balloon().carrier.phase==='aloft'&&balloon().pose.p[1]>3),'lifted off');
 const sa=await call(0,'POST','/v1/edge/act',{capability:'stand:here'});assert.equal(sa.accepted,false);assert.equal(sa.code,'ride.seated');assert.doesNotMatch(sa.reason,/leave/);assert.match(sa.reason,/returns to the ground by itself/);
 const rs=await call(0,'POST','/v1/edge/act',{capability:'rest:here'});assert.equal(rs.accepted,true,JSON.stringify(rs));await run(40,()=>false);
 t.diagnostic('aloft rest program running: '+!!f.host.engine.programOf(rows[0].entity_id));
 if(f.host.engine.programOf(rows[0].entity_id)){const sr=await call(0,'POST','/v1/edge/act',{capability:'stand:here'});assert.equal(sr.accepted,true,'a running program aloft can still be stopped: '+JSON.stringify(sr));}
 assert.equal((await call(0,'POST','/v1/edge/act',{capability:'object:ride-eden-balloon:leave'})).code,'ride.aloft');
 assert.ok(ledger.aboard(rows[0].entity_id),'still riding');
});
