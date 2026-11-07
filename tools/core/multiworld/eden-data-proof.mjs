// Qualify the exact Eden activity-data/descriptor pair on a compact read-only
// copy. Every movement is an ordinary Edge act; never mutate the source DB.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {setImmediate} from 'node:timers/promises';import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {copySqliteReadOnly} from './copy-sqlite.mjs';
import {DatabaseSync} from 'node:sqlite';
export async function proveEdenData({input,descriptor,sourceDb,dataFile,port=4954,output,restartOnly=false}){
 const dir=mkdtempSync(join(tmpdir(),'souls-eden-data-'));let app;
 try{
  const d=JSON.parse(readFileSync(resolve(descriptor),'utf8')),flags=d.flags??{};
  const target=join(dir,'sim.db');
  copySqliteReadOnly(resolve(sourceDb),target);
  const sourceReader=new DatabaseSync(target,{readOnly:true});let sourceRecoveries;
  try{sourceRecoveries=sourceReader.prepare("SELECT seq,tick,author FROM events WHERE world_id=? AND kind='rules' AND json_extract(payload,'$.recovery') IS NOT NULL ORDER BY seq").all(d.worldId);}finally{sourceReader.close();}
  const {openEdgeServerV1}=await import(pathToFileURL(join(resolve(input),'tools/core/edge-server.mjs')).href);
  const nav=structuredClone(d.nav);delete nav.extraSolids;
  const options={input:resolve(input),dataDir:dir,worldId:d.worldId,port,build:'local-eden-data/1',placeData:d.placeData,seedObjects:d.objects,inviteRequired:false,ambient:false,localSoulLimit:50,activitySpots:resolve(dataFile),nativePlaces:d.nativePlaces,nav};
  for(const name of ['humanRest','provisions','sequences','floorGoals','kitchen','shore','quietLandingCourtesy','social','approachRetention','closedGoals','activateExpansion'])options[name]=flags[name]??true;
  options.foodDeliveryId=flags.foodDeliveryId;
  app=await openEdgeServerV1(options);app.host.stop();
  const host=app.host,records=[],paidBefore=app.db.db.prepare('SELECT COUNT(*) count,COALESCE(SUM(cost),0) cost FROM paid_costs').get();
  assert.deepEqual(app.edge.spotsRefused,[],'all activity data admitted');
  if(!restartOnly){
  const user='dev:world-runtime-data-fixture';app.db.upsertUser({id:user,email:null,wallet:null,role:'admin'});
  const op=app.souls.acceptLifecycleCreate(user,{name:'Data fixture '+Date.now(),description:'Synthetic local data route qualification.'});
  let row;
  for(let i=0;i<100;i++){row=app.db.soul(op.scope.soulId);if(row&&app.souls.controlReady(row))break;host.drainInputs();host.tickOnce();await setImmediate();}
  assert.ok(row&&app.souls.controlReady(row),'test Soul admitted through lifecycle');const soul=host.minds.get(row.id);
  async function act(capability,limit=12000){
   const cap=app.edge.capabilities(soul).find(c=>c.id===capability);assert.ok(cap,'offer '+capability);assert.ok(cap.available,JSON.stringify(cap.blocked));
   const params=cap.params?.seconds?{seconds:cap.params.seconds.min}:undefined;
   let done=false;const pending=app.edge.act(soul,{capability,...(params?{params}:{})});pending.finally(()=>done=true);
   for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}
   const out=await pending;assert.ok(out.accepted,JSON.stringify(out));
   for(let i=0;i<limit;i++){
    host.tickOnce();if(i%20===0)await setImmediate();const receipt=app.edge.receipt(soul.soulId,out.receipt.id);
    if(!['started','waiting'].includes(receipt.phase)){assert.equal(receipt.phase,'completed',JSON.stringify(receipt));const e=host.engine.world.entities[soul.entityId];const record={capability,receipt,position:e.pose.p,level:e.human.level};records.push(record);console.log(JSON.stringify({completedDataRoute:record}));return;}
   }assert.fail('No completion for '+capability);
  }
  await act('walk:eden-library-1');await act('use-computer:lib-desk-2');await act('post-letter:mailbox-2');
  for(const id of ['picnic-1-south-w','picnic-1-north-w'])await act('eat:'+id);
  for(const id of ['region-harbour.west-pier','region-harbour.east-pier','region-artists-village.green'])await act('walk:'+id,24000);
  }
  assert.deepEqual(host.engine.runtime.violations,[]);
  assert.deepEqual(app.db.db.prepare("SELECT seq,tick,author FROM events WHERE world_id=? AND kind='rules' AND json_extract(payload,'$.recovery') IS NOT NULL ORDER BY seq").all(host.worldId),sourceRecoveries,'historical recoveries preserved; no new physical recovery');
  assert.deepEqual(app.db.db.prepare('SELECT COUNT(*) count,COALESCE(SUM(cost),0) cost FROM paid_costs').get(),paidBefore,'copied paid rows preserved; no new model spend');
  const beforeClose={tick:host.engine.world.tick,head:host.seq,stateHash:host.engine.stateHash()},navBefore=createHash('sha256').update(JSON.stringify(host.engine.world.navV1)).digest('hex');
  const paidCost=app.db.paidCost();await app.close();app=null;
  const sealedReader=new DatabaseSync(target,{readOnly:true});let sealed,closeAccepted;
  try{sealed=JSON.parse(sealedReader.prepare('SELECT body FROM clock_frontiers_v1 WHERE world_id=?').get(options.worldId).body);closeAccepted=sealedReader.prepare('SELECT seq,tick,kind,author FROM events WHERE world_id=? AND seq>? ORDER BY seq').all(options.worldId,beforeClose.head);}finally{sealedReader.close();}
  const restartExpected={tick:sealed.tick,head:sealed.throughSeq,stateHash:sealed.engineHash};assert.equal(restartExpected.tick,beforeClose.tick,'close drains accepted work without stepping time');
  app=await openEdgeServerV1(options);app.host.stop();
  const restarted={tick:app.host.engine.world.tick,head:app.host.seq,stateHash:app.host.engine.stateHash()};if(restarted.head!==restartExpected.head)console.log(JSON.stringify({unexpectedBootEventMetadata:app.db.events(options.worldId,restartExpected.head).map(e=>({seq:e.seq,tick:e.tick,kind:e.kind,author:e.author,payloadKeys:Object.keys(e.payload??{})}))}));for(const field of Object.keys(restartExpected))assert.equal(restarted[field],restartExpected[field],field);
  assert.equal(createHash('sha256').update(JSON.stringify(app.host.engine.world.navV1)).digest('hex'),navBefore,'same accepted nav after ordinary restart');
  const proof={contract:'eden-data-descriptor-pair-proof/1',qualifiedAtUTC:new Date().toISOString(),input:resolve(input),restartOnly,activitySha256:createHash('sha256').update(readFileSync(dataFile)).digest('hex'),descriptorOperation:{op:'delete',path:'nav.extraSolids'},records,newRecoveries:0,preservedSourceRecoveries:sourceRecoveries,violations:0,paidCost,beforeClose,closeAccepted,exactRestart:restartExpected,navHash:navBefore,scope:'Copied local history and ordinary lifecycle/Edge actions only; source database untouched. Visual gaps/deck depiction require separate browser proof.'};
  if(output){mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(proof,null,2)+'\n');}return proof;
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const [input,descriptor,sourceDb,dataFile,output,mode]=process.argv.slice(2);console.log(JSON.stringify(await proveEdenData({input,descriptor,sourceDb,dataFile,output,restartOnly:mode==='restart-only'})));}
