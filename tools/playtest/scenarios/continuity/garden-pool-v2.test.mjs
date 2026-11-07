// eden-walk-three fixtureVersion 2 (garden-pool-v2). The live dispatcher and
// the oracle are driven from the same synthetic current bodies, so the trigger
// proof each case scores is the one the frozen dispatcher would have produced.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {scoreContinuity,scoreDisturbance} from './oracle.mjs';
import {poolGardenAt,GARDEN_POOL_RULE} from './garden-pool.mjs';
import {createContinuityDisturbances} from '../../arena/continuity-disturbances.mjs';

const fixturesUrl=new URL('./fixtures.json',import.meta.url),fixtures=JSON.parse(readFileSync(fixturesUrl)),oracles=JSON.parse(readFileSync(new URL('./oracles.json',import.meta.url)));
const matrix=JSON.parse(readFileSync(new URL('./matrix.json',import.meta.url)));
const walk=fixtures.scenarios.find(s=>s.id==='eden-walk-three');
const V2_KEYS=['fixtureVersion','gardenRule','fixtureVersionNote','gardenCandidates','gardenPoolSource','gardenMembership','gardenAgreementRule','gardenTemplateNote'];
const V1_ERRAND_WHEN='first observed 10-second all-three garden overlap';
/** Version 1 of this scenario: v2 keys removed and the one description restored. */
function v1Fixtures(){
 const f=structuredClone(fixtures),s=f.scenarios.find(s=>s.id==='eden-walk-three');
 for(const k of V2_KEYS)delete s[k];s.disturbances.find(d=>d.id==='independent-errand').when=V1_ERRAND_WHEN;
 // #479's own declared change to another scenario: undone here, so this still proves the rest of the file is byte for byte v1
 const band=f.scenarios.find(s=>s.id==='eden-bandstand-five');delete band.fixtureVersion;delete band.fixtureVersionNote;band.venue.audienceRegion.excludePolygon=band.venue.audienceRegion.excludePolygon.map(([x,z])=>[x,z===-26.2?-26.4:z]);return f;
}
const T0=1793400000000,ms=sec=>T0+sec*1000;
const POOL=walk.gardenCandidates,garden=ref=>POOL.find(g=>g.ref===ref);
const PLOT5={ref:'land-garden-plot-5',pos:[37.7,53.2],walkCapability:'walk:land-garden-plot-5'};

test('v2 declares a sealed five-garden pool and leaves every other frozen value unchanged',()=>{
 assert.equal(walk.fixtureVersion,2);assert.equal(walk.gardenRule,GARDEN_POOL_RULE);
 assert.deepEqual(POOL.map(g=>g.ref),['land-garden-plot-1','place-eden-stone-garden','land-garden-plot-2','land-garden-plot-4','land-garden-plot-3'],'exactly the native explore candidates, in explore order');
 assert.deepEqual(POOL.map(g=>g.placeId),POOL.map(g=>'g-'+g.ref));
 assert.ok(POOL.every(g=>g.region.radiusM===walk.venue.gardenRegion.radiusM),'v1 garden radius reused unchanged');
 const stone=garden('place-eden-stone-garden');
 assert.deepEqual(stone.region,walk.venue.gardenRegion);assert.equal(stone.walkCapability,walk.venue.gardenWalkCapability);
 // Frozen v1 values the decision keeps byte-for-byte.
 assert.equal(walk.venue.gardenRef,'place-eden-stone-garden');
 assert.deepEqual(walk.venue.gardenRegion,{pos:[57,-10],radiusM:4});
 assert.deepEqual(walk.timing,{meetingOffsetSec:240,arrivalToleranceSec:30,lateActorArrivalToleranceSec:90,endOffsetSec:960,minimumGroupOverlapSec:10,resumeWithinSecAfterClosure:180});
 const errand=walk.disturbances.find(d=>d.id==='independent-errand');
 assert.equal(errand.trigger.minimumOverlapSec,10);assert.equal(errand.trigger.maximumDelaySec,2);
 assert.equal(errand.text,'Please briefly inspect Commons Pavilion, then rejoin your walking companions using what you can learn from the world. Keep your original errand for afterward.');
 assert.deepEqual(walk.endpointCandidates.map(e=>e.ref),['eden-library-1','eden-bandstand']);
 assert.equal(oracles.numeric.separationDistanceM,12);
 assert.equal(matrix.scenarios.find(s=>s.id==='eden-walk-three').instructions[0],'Meet the other two walkers at Commons Field at {meetingUTC}. Agree together on a garden walk and a second landmark to finish at. Stay aware of one another, regroup if separated, and finish together before returning to your own errand.');
 const visit=walk.journeyTemplates.find(p=>p.name==='garden visit');
 assert.deepEqual(visit,{name:'garden visit',region:{pos:[57,-10],radiusM:4},holdSec:10,receipt:{verb:'walk',targetRefs:['place-eden-stone-garden'],completed:true}});
});

test('v1 is reproducible: removing the v2 keys restores the exact prior fixture bytes',t=>{
 const base='94d5d6edad66944491db5fb1ffce8fdbc6fb512c';let prior;
 try{prior=execFileSync('git',['show',base+':tools/playtest/scenarios/continuity/fixtures.json'],{cwd:new URL('.',import.meta.url),encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{t.skip('v1 commit not in this clone');return;}
 // Provenance strings only: the history rewrite at the public cutover scrubbed the `sliceEvidence` paths and remapped the
 // commit id in `git`, so those two fields are compared with the same neutral value on both sides. Every other byte is exact.
 const provenanceFree=f=>JSON.parse(JSON.stringify(f,(k,v)=>k==='sliceEvidence'||k==='git'?'<provenance>':v));
 assert.deepEqual(provenanceFree(v1Fixtures()),provenanceFree(JSON.parse(prior)));
 const old=JSON.parse(prior);for(const [i,s]of old.scenarios.entries())if(s.id!=='eden-walk-three'&&s.id!=='eden-bandstand-five')assert.deepEqual(fixtures.scenarios[i],s,'other scenarios unchanged: '+s.id);
});

test('pool centres are the authored template areas and membership is exclusive',()=>{
 const bytes=readFileSync(new URL('../../../../'+fixtures.sources['eden-2026'].template,import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),fixtures.sources['eden-2026'].sha256,'pinned eden-2026 template');
 const areas=new Map(JSON.parse(bytes).batches.flatMap(b=>b.ops??[]).filter(o=>o.op==='place'&&o.shape?.area).map(o=>[o.name,o.shape.area]));
 for(const g of POOL){
  const a=areas.get(g.ref);assert.ok(a,'template place '+g.ref);
  const xs=a.map(p=>p[0]),zs=a.map(p=>p[1]),centre=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...zs)+Math.max(...zs))/2];
  assert.ok(Math.abs(centre[0]-g.region.pos[0])<1e-9&&Math.abs(centre[1]-g.region.pos[1])<1e-9,g.ref+' centre '+centre);
 }
 // Stone-garden membership is exactly the v1 [57,-10] r4 circle.
 for(let x=50;x<=64;x+=0.25)for(let z=-17;z<=-3;z+=0.25){const v1=Math.hypot(x-57,z+10)<=4;assert.equal(poolGardenAt([x,z],POOL)?.ref==='place-eden-stone-garden',v1,`${x},${z}`);}
 // Adjacent beds overlap as circles; the nearer centre owns the point.
 assert.equal(poolGardenAt([35.0,46.6],POOL)?.ref,'land-garden-plot-1');assert.equal(poolGardenAt([35.5,46.6],POOL)?.ref,'land-garden-plot-2');
 assert.equal(poolGardenAt([35.25,46.6],POOL)?.ref,'land-garden-plot-1','exact tie goes to the earlier pool entry');
 assert.equal(poolGardenAt(PLOT5.pos,POOL),null,'a non-pool bed centre is in no pool garden');
});

/** Three walkers; every one sampled once a second from T0 to cutoff. They are
 * at the field until 300 s, then (walker-3 from its 270 s release) at `at`
 * from 320 to 345 s, then back on the field. Each owns a completed walk receipt. */
function bodies({at=null,capability=null,offsets=[[0,0],[0.6,0.3],[-0.5,0.4]]}={}){
 return walk.actors.map((a,i)=>{const samples=[];for(let s=0;s<=walk.timing.endOffsetSec;s++){const there=at&&s>=320&&s<=345;samples.push({t:ms(s),pos:{x:there?at[0]+offsets[i][0]:offsets[i][0],z:there?at[1]+offsets[i][1]:offsets[i][1],src:'here'},posture:'standing'});}
  return [a.id,{coverageComplete:true,samples,receipts:capability?[{id:a.id+'-garden',capability,acceptedAtUtc:ms(300),endedAtUtc:ms(320),phase:'completed'}]:[]}];});
}
/** Drive the frozen dispatcher over the same bodies; deliver to walker-2 500 ms after dispatch. */
async function dispatch(scenario,participants,{undeclared=false}={}){
 const fixtureVersion=undeclared?undefined:scenario.fixtureVersion;
 let now=T0;const actors=scenario.actors.map(a=>({actorId:a.id,soulId:'s_'+a.id}));
 const api=createContinuityDisturbances({scenario,fixtureVersion,t0:T0,cutoffAt:ms(scenario.timing.endOffsetSec),worldId:'world_test',actors,evidence:['fixtures.json#eden-walk-three']},{now:()=>now,send:async r=>({status:'accepted',effectId:'native_'+r.id,evidence:['send.json#'+r.id]})});
 const delivered=[];
 for(let s=0;s<=scenario.timing.endOffsetSec;s++){
  for(const [actorId,p]of participants){const b=p.samples[s];now=b.t;api.observeBody({worldId:'world_test',actorId,soulId:'s_'+actorId,evidence:['native.json#'+actorId+'-'+s],at:b.t,receivedAt:b.t,pos:[b.pos.x,b.pos.z],source:'here',currentBody:true});}
  const snap=await api.tick(),row=snap.disturbances['independent-errand'];
  if(row.dispatch&&!delivered.length){now+=500;const event={worldId:'world_test',actorId:'walker-2',soulId:'s_walker-2',evidence:['native-inbox.json#walker-2'],disturbanceId:'independent-errand',dispatchId:row.dispatch.id,source:'owner',eventId:'evt-errand',createdAt:now,effectId:'native_independent-errand',linkageEvidence:['effect link']};api.observeDelivery(event);delivered.push(event);}
 }
 return {disturbances:api.finish().disturbances,notifications:delivered.map(e=>({actor:e.actorId,eventId:e.eventId,source:'owner',createdAt:e.createdAt}))};
}
function evidence({participants,disturbances,notifications,agreedGardenRef,version=2}){
 const bindings=Object.fromEntries([...POOL.map(g=>[g.ref,g.walkCapability]),[PLOT5.ref,PLOT5.walkCapability]].map(([ref,cap])=>[ref,{ref,entityId:'e_'+ref,capabilities:{walk:[cap]}}]));
 return {scenarioId:'eden-walk-three',t0:T0,fixtureVerified:true,...(version===null?{}:{fixtureVersion:version}),bindings,participants:Object.fromEntries(participants),disturbances,notifications,semantic:{closureAt:ms(400),...(agreedGardenRef===undefined?{}:{agreedGardenRef})}};
}
const GARDEN_ROWS=['walker-1:garden visit','walker-2:garden visit','walker-3:garden visit','garden-three-way-overlap','disturbance:independent-errand'];
const pick=(result,ids=GARDEN_ROWS)=>Object.fromEntries(ids.map(id=>{const r=result.rows.find(r=>r.id===id);assert.ok(r,'missing row '+id);return [id,r.status];}));
async function both({at,capability,agreedGardenRef,participants=bodies({at,capability})}){
 const v2=await dispatch(walk,participants),v1f=v1Fixtures(),v1=await dispatch(v1f.scenarios.find(s=>s.id==='eden-walk-three'),participants);
 return {
  v2:{dispatch:v2,score:scoreContinuity({fixtures,oracles,evidence:{...evidence({participants,...v2,agreedGardenRef})}})},
  v1:{dispatch:v1,score:scoreContinuity({fixtures:v1f,oracles,evidence:evidence({participants,...v1,version:null,agreedGardenRef})})}
 };
}

test('stone garden agreed: v2 behaves exactly as v1, row for row',async()=>{
 const stone=garden('place-eden-stone-garden'),{v1,v2}=await both({at:stone.region.pos,capability:stone.walkCapability,agreedGardenRef:stone.ref});
 assert.deepEqual(v2.score.rows,v1.score.rows,'every row, status, detail and evidence identical');assert.equal(v2.score.status,v1.score.status);
 assert.deepEqual(pick(v2.score),Object.fromEntries(GARDEN_ROWS.map(id=>[id,'pass'])));
 const p2=v2.dispatch.disturbances['independent-errand'].triggerProof,p1=v1.dispatch.disturbances['independent-errand'].triggerProof;
 assert.equal(p2.gardenRef,stone.ref);const {gardenRef,...rest}=p2;assert.deepEqual(rest,p1,'trigger proof is v1 plus the named pool garden');
 assert.equal(p2.overlapFrom,ms(320));assert.equal(p2.overlapTo,ms(330));
 assert.deepEqual({fixtureVersion:v2.score.fixtureVersion,gardenRule:v2.score.gardenRule,garden:v2.score.garden},{fixtureVersion:2,gardenRule:'garden-pool-v2',garden:{ref:stone.ref,basis:'agreed-pool-garden'}});
});

test('Garden plot 1 agreed: visit, receipt, overlap and the errand trigger are evaluated at plot 1',async()=>{
 const plot=garden('land-garden-plot-1'),{v1,v2}=await both({at:plot.region.pos,capability:plot.walkCapability,agreedGardenRef:plot.ref});
 assert.deepEqual(pick(v2.score),Object.fromEntries(GARDEN_ROWS.map(id=>[id,'pass'])));
 const d=v2.dispatch.disturbances['independent-errand'];
 assert.equal(d.triggerProof.gardenRef,plot.ref);assert.equal(d.triggerProof.overlapFrom,ms(320));assert.equal(d.triggerProof.overlapTo,ms(330));assert.equal(d.scheduledAt,ms(330));
 // The same bodies under v1 never reach the frozen stone garden.
 assert.deepEqual(pick(v1.score,GARDEN_ROWS.slice(0,4)),Object.fromEntries(GARDEN_ROWS.slice(0,4).map(id=>[id,'fail'])));
 assert.equal(v1.dispatch.disturbances['independent-errand'].status,'unmet');
 // A plot-1 visit is not a plot-2 visit: the receipt and membership still bind.
 const plot2=scoreContinuity({fixtures,oracles,evidence:evidence({participants:bodies({at:plot.region.pos,capability:plot.walkCapability}),...v2.dispatch,agreedGardenRef:'land-garden-plot-2'})});
 assert.deepEqual(pick(plot2,GARDEN_ROWS.slice(0,4)),Object.fromEntries(GARDEN_ROWS.slice(0,4).map(id=>[id,'fail'])));
 const off=plot2.rows.filter(r=>['disturbance:independent-errand','independent-errand-then-regroup','twelve-metre-separation-ten-seconds'].includes(r.id));
 assert.equal(off.length,3);for(const r of off){assert.equal(r.status,'unknown',r.id);assert.match(r.detail,/^trigger in non-agreed garden, out-of-fixture: trigger proof garden "land-garden-plot-1", agreed garden "land-garden-plot-2"/);}
});

test('a garden outside the pool is reported out-of-fixture, never scored',async()=>{
 const participants=bodies({at:PLOT5.pos,capability:PLOT5.walkCapability}),v2=await dispatch(walk,participants);
 assert.equal(v2.disturbances['independent-errand'].status,'unmet','no pool-garden overlap, so the errand is not triggered');assert.equal(v2.disturbances['independent-errand'].triggerProof,null);
 const result=scoreContinuity({fixtures,oracles,evidence:evidence({participants,...v2,agreedGardenRef:PLOT5.ref})});
 for(const id of GARDEN_ROWS.slice(0,4)){const r=result.rows.find(r=>r.id===id);assert.equal(r.status,'unknown',id);assert.match(r.detail,/^out-of-fixture: agreed garden "land-garden-plot-5"/);}
 assert.deepEqual(result.garden,{ref:PLOT5.ref,basis:'out-of-fixture'});
});

test('no garden agreement follows the v1 failure path, row for row',async()=>{
 for(const agreedGardenRef of [undefined,null]){
  const {v1,v2}=await both({agreedGardenRef});
  assert.deepEqual(v2.score.rows,v1.score.rows);assert.equal(v2.score.garden.basis,'no-agreement-v1-default');assert.equal(v2.score.garden.ref,'place-eden-stone-garden');
  assert.deepEqual(pick(v2.score,GARDEN_ROWS.slice(0,4)),Object.fromEntries(GARDEN_ROWS.slice(0,4).map(id=>[id,'fail'])));
  const [a,b]=[v1,v2].map(r=>r.dispatch.disturbances['independent-errand']);assert.equal(b.status,'unmet');assert.equal(b.triggerProof,null);assert.deepEqual([b.status,b.reason],[a.status,a.reason]);
 }
});

test('callers must declare fixtureVersion 2',async()=>{
 const participants=bodies();
 assert.throws(()=>scoreContinuity({fixtures,oracles,evidence:evidence({participants,disturbances:{},notifications:[],version:null})}),/declare fixtureVersion 2/);
 assert.throws(()=>scoreContinuity({fixtures,oracles,evidence:evidence({participants,disturbances:{},notifications:[],version:1})}),/declare fixtureVersion 2/);
 await assert.rejects(dispatch(walk,participants,{undeclared:true}),{code:'FIXTURE_VERSION_UNDECLARED'});
 // Unversioned scenarios need no declaration.
 assert.doesNotThrow(()=>scoreContinuity({fixtures,oracles,evidence:{scenarioId:'eden-reading-duo',t0:T0}}));
});

test('trigger proof must name the earliest co-visited pool garden',async()=>{
 const plot=garden('land-garden-plot-1'),participants=bodies({at:plot.region.pos,capability:plot.walkCapability}),v2=await dispatch(walk,participants);
 const base=evidence({participants,...v2,agreedGardenRef:plot.ref}),errand=walk.disturbances.find(d=>d.id==='independent-errand');
 const run=e=>scoreDisturbance({scenario:walk,disturbance:errand,evidence:e,t0:T0,cutoff:ms(960),maxGapSec:2,bindings:e.bindings});
 assert.equal(run(base).status,'pass');
 const wrong=structuredClone(base);wrong.disturbances['independent-errand'].triggerProof.gardenRef='land-garden-plot-2';assert.equal(run(wrong).status,'fail','overlap is not in the named garden');
 const missing=structuredClone(base);delete missing.disturbances['independent-errand'].triggerProof.gardenRef;assert.equal(run(missing).status,'unknown');
 const outside=structuredClone(base);outside.disturbances['independent-errand'].triggerProof.gardenRef=PLOT5.ref;assert.equal(run(outside).status,'unknown','a non-pool garden is never a v2 trigger');
 // An earlier ten-second all-three overlap in another pool garden is the first trigger.
 const earlier=structuredClone(base),stone=garden('place-eden-stone-garden');
 for(const p of Object.values(earlier.participants))for(const s of p.samples){const sec=(s.t-T0)/1000;if(sec>=280&&sec<=295)Object.assign(s.pos,{x:stone.region.pos[0],z:stone.region.pos[1]});}
 assert.equal(run(earlier).status,'fail','plot-1 proof postponed past the first stone-garden overlap');
 const replay=await dispatch(walk,Object.entries(earlier.participants));
 assert.equal(replay.disturbances['independent-errand'].triggerProof.gardenRef,stone.ref,'the live dispatcher latches the earliest pool garden');
});


const ERRAND_ROWS=['disturbance:independent-errand','independent-errand-then-regroup','twelve-metre-separation-ten-seconds'];
const nonAgreed=(result,ids=ERRAND_ROWS)=>{for(const id of ids){const r=result.rows.find(r=>r.id===id);assert.equal(r.status,'unknown',id);assert.match(r.detail,/^trigger in non-agreed garden, out-of-fixture: /,id);}};
test('no agreement + plot co-visit: the plot trigger is out-of-fixture and every other row equals v1',async()=>{
 const plot=garden('land-garden-plot-1'),{v1,v2}=await both({at:plot.region.pos,capability:plot.walkCapability});
 assert.equal(v2.dispatch.disturbances['independent-errand'].triggerProof.gardenRef,plot.ref,'the live dispatcher still latches the co-visited pool garden');
 assert.equal(v1.dispatch.disturbances['independent-errand'].status,'unmet');
 nonAgreed(v2.score);assert.match(v2.score.rows.find(r=>r.id==='disturbance:independent-errand').detail,/agreed garden "place-eden-stone-garden" \(no-agreement-v1-default\)/);
 // v2 actually delivered the errand, so only its delivery-latency rows are extra;
 // every other row is identical and no row passes that v1 did not pass.
 const keep=r=>!ERRAND_ROWS.includes(r.id)&&!r.id.startsWith('notification');
 assert.deepEqual(v2.score.rows.filter(keep),v1.score.rows.filter(keep));
 for(const r of v2.score.rows.filter(r=>r.status==='pass'))assert.equal(v1.score.rows.find(x=>x.id===r.id)?.status,'pass',r.id);
 assert.equal(v2.score.status,v1.score.status);
 // Scored on the v1 run's own dispatcher evidence (trigger never fired), v2 equals v1 row for row.
 const same=scoreContinuity({fixtures,oracles,evidence:evidence({participants:bodies({at:plot.region.pos,capability:plot.walkCapability}),...v1.dispatch})});
 assert.deepEqual(same.rows,v1.score.rows);
});
test('stone garden agreed after an earlier plot linger: the consumed trigger is out-of-fixture, not pass',async()=>{
 const plot=garden('land-garden-plot-1'),stone=garden('place-eden-stone-garden'),participants=bodies({at:stone.region.pos,capability:stone.walkCapability});
 for(const [,p]of participants)for(const s of p.samples){const sec=(s.t-T0)/1000;if(sec>=280&&sec<=295)Object.assign(s.pos,{x:plot.region.pos[0],z:plot.region.pos[1]});}
 const v2=await dispatch(walk,participants),d=v2.disturbances['independent-errand'];
 assert.equal(d.triggerProof.gardenRef,plot.ref);assert.equal(d.triggerProof.overlapFrom,ms(280));assert.equal(d.status,'delivered');
 const result=scoreContinuity({fixtures,oracles,evidence:evidence({participants,...v2,agreedGardenRef:stone.ref})});
 nonAgreed(result);
 assert.deepEqual(pick(result,GARDEN_ROWS.slice(0,4)),Object.fromEntries(GARDEN_ROWS.slice(0,4).map(id=>[id,'pass'])),'the agreed stone-garden visit itself still passes');
});
