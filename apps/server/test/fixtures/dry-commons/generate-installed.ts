// Native installed commons. Fake human owner, real SQLite/WorldHost inputs,
// take/capture publications and model-free reconstruction. No live bootstrap.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kernelHash } from '@souls/kernel';
import { newLife } from '@souls/brain';
import { marsFactory, EDEN_COMMONS_WORLD, GREEN_FIELD_WORLD } from '@souls/engine-mars';
import type { RenderSceneRefV1 } from '@souls/engine-contract';
import type { Brain } from '../../../src/brain.ts';
import type { Hub } from '../../../src/hub.ts';
import { Auth } from '../../../src/auth.ts';
import { config } from '../../../src/config.ts';
import { Db } from '../../../src/db.ts';
import { buildApp } from '../../../src/http.ts';
import { Souls } from '../../../src/souls.ts';
import { WorldHost, replayFromGenesis } from '../../../src/world.ts';

export const INSTALLED_COMMONS_WORLD='core-installed-commons-fixture';
export const INSTALLED_COMMONS_CFG={...EDEN_COMMONS_WORLD,clock:{origin:0,dayTicks:72000}};
const PRIVATE='PRIVATE_INSTALLED_COMMONS';
const seed='core-native-commons/1',entityId='h_commons',soulId='s_commons';
export async function generateInstalledCommons(){
 const factory=await marsFactory(INSTALLED_COMMONS_CFG),old=await marsFactory(GREEN_FIELD_WORLD);
 const dir=mkdtempSync(join(tmpdir(),'core-installed-commons-')),path=join(dir,'native.sqlite');let db=new Db(path);
 try{
  const host=new WorldHost(db,factory,seed,1e9,INSTALLED_COMMONS_WORLD);host.boot();host.drainInputs();
  db.upsertUser({id:PRIVATE+'_OWNER',email:null,wallet:null,role:'user'});db.setInvited(PRIVATE+'_OWNER','fake-local');
  db.createSoul({id:soulId,entityId,worldId:INSTALLED_COMMONS_WORLD,owner:PRIVATE+'_OWNER',name:'Commons visitor',description:'Fake-local owned visitor',native:false});
  const b=host.enqueue('birth','fixture',{soulId,entityId,owner:PRIVATE+'_OWNER',name:'Commons visitor',description:'Fake-local owned visitor'});host.drainInputs();await b;
  const mandate=host.enqueue('mandate','fixture',{soulId,op:'upsert',rule:{id:'private-fixture',words:PRIVATE+'_WORDS',strict:false,
    understanding:'Spend some time in the commons',agenda:[{card:'rest',target:null}],trigger:{kind:'none'},status:'active',report:null}});host.drainInputs();await mandate;
  host.minds.get(soulId)!.life=newLife(0);host.minds.get(soulId)!.life!.journal=PRIVATE+'_JOURNAL';
  const initialSnapshot=host.snapshotView(),positions:{tick:number;p:number[];yaw:number;activity:string;level:number}[]=[],checkpoints:{tick:number;throughTick:number;activity:string;stateHash:string}[]=[];
  const observe=()=>{const e=host.engine.world.entities[entityId];positions.push({tick:host.engine.world.tick,p:[...e.pose.p],yaw:e.pose.yaw,activity:e.human!.activity,level:e.human!.level});};observe();
  let savedThrough=-1;
  const saveTakes=()=>{for(const c of host.engine.takeChunks!(savedThrough)){const ref=(c.take as {renderSceneRef:RenderSceneRefV1}).renderSceneRef;db.saveTake(INSTALLED_COMMONS_WORLD,c,host.engine.takeScene!(ref.hash)!);savedThrough=Math.max(savedThrough,c.toTick);}};
  async function decide(label:string,steps:{verb:string;params:Record<string,unknown>}[]){
   const p=host.enqueue('decision','fixture',{soulId,entityId,option:label,label,steps,reevalTicks:1e9,fallback:false,trigger:'installed-physical-fixture'});host.drainInputs();await p;
  }
  function advance(to:number,checkpointActivity?:string){
   let restored:ReturnType<typeof factory.create>|undefined,checkpoint:typeof checkpoints[number]|undefined;
   while(host.engine.world.tick<to){host.tickOnce();if(restored){restored.step();assert.equal(restored.stateHash(),host.engine.stateHash(),'moving native checkpoint continuation');}observe();saveTakes();
    const a=host.engine.world.entities[entityId].human!.activity;
    if(checkpointActivity&&a===checkpointActivity&&!restored){assert.equal(host.engine.canSnapshot!(),true);const snap=host.engine.snapshot();restored=factory.restore(JSON.parse(JSON.stringify(snap)));assert.equal(restored.stateHash(),host.engine.stateHash());checkpoint={tick:host.engine.world.tick,throughTick:to,activity:a,stateHash:snap.stateHash};checkpoints.push(checkpoint);}
   }
   if(checkpointActivity)assert.ok(checkpoint,`observed ${checkpointActivity}`);
  }
  await decide('Enter the commons',[{verb:'walk_to',params:{to:'commons',standoff:0}}]);advance(220,'walk');
  assert.deepEqual(host.engine.world.entities[entityId].pose.p,[9,0,5]);
  await decide('Sit on the west bench',[{verb:'sit',params:{on:'commons-bench-west',seconds:1}}]);advance(720,'sit');
  assert.equal(host.engine.world.entities[entityId].human!.activity,'sit');
  await decide('Leave the bench',[{verb:'stand',params:{}}]);advance(760);
  assert.equal(host.engine.world.entities[entityId].human!.activity,'idle');
  await decide('Step onto the presentation deck',[{verb:'walk_to',params:{to:'commons-deck',standoff:0}}]);advance(1100,'climb-up');
  assert.deepEqual(host.engine.world.entities[entityId].pose.p,[9,.24,-1.8]);assert.equal(host.engine.world.entities[entityId].human!.level,1);
  await decide('Return to the commons ground',[{verb:'walk_to',params:{to:'commons',standoff:0}}]);advance(1460,'climb-down');
  assert.deepEqual(host.engine.world.entities[entityId].pose.p,[9,0,5]);assert.equal(host.engine.world.entities[entityId].human!.level,0);
  assert.deepEqual(host.engine.runtime.violations,[]);assert.equal(db.soul(soulId)!.owner,PRIVATE+'_OWNER');
  // Explicit ordinary clock-rate publication fixes the recorded observation
  // boundary at1460. Without a final event, genesis boot ends at the last
  // logged event rather than recovering the unlogged idle tail.
  host.setClockRate(1,'fixture','Recorded commons observation boundary at rate1');host.drainInputs();
  const events=db.events(INSTALLED_COMMONS_WORLD);assert.equal(events.filter(e=>e.kind==='rules'&&e.payload?.recovery).length,0);
  const bodyHash=host.engine.stateHash(),meaningHash=kernelHash(host.kernel);assert.equal('pending' in host.saveSnapshot(true),false);
  db.close();db=new Db(path);const reopened=new WorldHost(db,factory,seed,1e9,INSTALLED_COMMONS_WORLD);assert.equal(reopened.boot().from,'snapshot');
  assert.equal(reopened.engine.stateHash(),bodyHash);assert.equal(kernelHash(reopened.kernel),meaningHash);
  const replay=replayFromGenesis(factory,seed,db.events(INSTALLED_COMMONS_WORLD),1460,{includeHeadEvents:true});assert.equal(replay.engine.stateHash(),bodyHash);assert.equal(kernelHash(replay.kernel),meaningHash);
  // Actual incompatible legacy factory boot refuses before fallback and leaves
  // this DB's snapshot, log and take rows unchanged. Reopening source is not a
  // topology migration or old-binary rollback demonstration.
  const before=db.events(INSTALLED_COMMONS_WORLD),beforeSnapshot=db.latestSnapshot(INSTALLED_COMMONS_WORLD);
  assert.throws(()=>new WorldHost(db,old,seed,1e9,INSTALLED_COMMONS_WORLD).boot(),/history rules are incompatible/);
  assert.deepEqual(db.events(INSTALLED_COMMONS_WORLD),before);assert.deepEqual(db.latestSnapshot(INSTALLED_COMMONS_WORLD),beforeSnapshot);
  // Exercise actual host genesis path by deleting only this ephemeral fixture's
  // checkpoint. Durable takes/captures remain immutable and addressable.
  db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(INSTALLED_COMMONS_WORLD);
  const genesis=new WorldHost(db,factory,seed,1e9,INSTALLED_COMMONS_WORLD);assert.equal(genesis.boot().from,'genesis');
  assert.equal(genesis.engine.stateHash(),bodyHash);assert.equal(kernelHash(genesis.kernel),meaningHash);
  const cfg={...config,takesPersist:true,worldId:INSTALLED_COMMONS_WORLD,worldKey:'eden',worldPath:'/w/eden',brainMode:'fake' as const,budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,privyAppId:'',privyAppSecret:''};
  const auth=new Auth(cfg,db),brain={midContext:()=>({options:[]})} as unknown as Brain,souls=new Souls(genesis,db,brain,cfg);
  const app=buildApp({cfg,db,host:genesis,auth,brain,souls,hub:{refreshMe(){},clients:new Map()} as unknown as Hub});
  async function anonymous(p:string){const r=await app.request(p,{headers:{host:'127.0.0.1:4956'}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');return r.json();}
  const scene=await anonymous('/v1/scene'),stream=await anonymous('/v1/takes?from=0&to=1460&limit=120');
  const chunks=db.takes(INSTALLED_COMMONS_WORLD,0,1460,120).chunks,refs=[...new Set(chunks.map(c=>(c.take as {renderSceneRef:RenderSceneRefV1}).renderSceneRef.hash))];
  const captures=[];for(const hash of refs)captures.push(await anonymous(`/v1/scenes/${hash}`));
  const publication={scene,stream,captures,initialSnapshot,snapshot:genesis.snapshotView(),kernel:genesis.kernelView()};
  assert.equal(JSON.stringify(publication).includes(PRIVATE),false);assert.equal(db.paidCost(),0);
  const proposalFile=new URL('./commons-physical-proposal.source.v1.json',import.meta.url);
  // Team source is coordination input; hash the exact accepted packet without
  // baking a workstation path into the public fixture.
  const proposalHash=createHash('sha256').update(readFileSync(proposalFile)).digest('hex');
  assert.equal(proposalHash,'8a20d529865951d4d5cb140bd78de8a753b8eacde2f5e76464fdee48b896343a','exact original public physical proposal');
  return JSON.parse(JSON.stringify({contract:'core-installed-commons-fixture/1',worldId:INSTALLED_COMMONS_WORLD,
   producer:{semanticsParent:'13d87b2c5736ad23f71bc09755fcd94428887138',seed,config:INSTALLED_COMMONS_CFG,worldSource:'9b6db72fc2dcf45a762d7ce8e4db0b71d0418ea8',physicalProposalHash:proposalHash},
   scope:'Canonical isolated dry commons/1 installation; no existing-world migration, default/live rollout, natural-language compiler, generic slope/climb/water/boat or dance grant',
   playback:'Birth at0 in initialSnapshot, first recorded body1. Captures/takes are original; never backfill or overlay another layout.',actor:{entityId,soulId,owner:'fake-local human association verified in SQLite'},
   ...publication,positions,checkpoints,reconstruction:{tick:1460,bodyHash,kernelHash:meaningHash,snapshot:'exact',hostGenesis:'exact',inclusiveGenesis:'exact',incompatibleOldFactory:'refused before fallback without DB edits'},faultCount:0,violations:[],paid:0}));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(await generateInstalledCommons(),null,2)+'\n');
