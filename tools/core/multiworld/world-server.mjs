import {worldAuthMode,validateWorldOrigin,worldAccountAuthRequired} from './world-auth-mode.mjs';
// Local edge-era Mars/LM launcher. One process and durable DB per world; fake
// world cast only, while paired Souls remain exclusively agent controlled.
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {readAuthoredSidecars} from './authored-sidecars.mjs';

export async function installWalkSettleWaitV1(host,enabled,drive){
 if(enabled!==undefined&&typeof enabled!=='boolean')throw Error('world.walk-settle-wait-flag');
 if(enabled!==true)return;
 const alreadyAccepted=host.extra.runtimePolicy?.walkSettleWaitV1===true;
 const fact=await drive(host.enableWalkSettleWaitV1());
 return{policy:'walk-settle-wait/1',worldId:host.worldId,seq:fact.seq,tick:fact.tick,alreadyAccepted};
}

export function nativeLifecycleFlagV1(value){if(value!==undefined&&typeof value!=='boolean')throw Error('world.native-lifecycle-flag');return value===true;}

export async function openWorldServer({input,dataDir,worldKey,worldId,port,build='local-multiworld/1',webDir,marsWebDir,publicOrigin,ownerId='dev:admin',seedCast=true,nativeCast=true,runtimePolicies=true,walkSettleWaitV1,nativeLifecycleV1,prepareNativeLifecycle,installLiving=true,cards=true,skillFile,cliFile,instructionsFile,authMode='local-dev',accountAuth,checkOnly=false,worldVariant='legacy',sceneSha256,nativeCastIds,experiencesFile,experiencesSha256,placeData,placeDataSha256,activityData,activityDataSha256,nativeAliases,nativeAliasesSha256,basePath='',launcherChild=false}){
 // basePath (world launcher fork, e.g. '/worlds'): served at <basePath>/w/<key> on a launcher child port with the launcher's build id.
 // launcherChild: the same on a launcher that serves the original worlds at the root (basePath '', --old-worlds-root).
 const child=!!basePath||launcherChild===true;
 if(basePath!==''&&!/^\/[a-z][a-z0-9-]{0,31}$/.test(basePath))throw Error('basePath must be one path segment like /worlds');
 const lifecycleEnabled=nativeLifecycleFlagV1(nativeLifecycleV1);if(prepareNativeLifecycle!==undefined&&(!lifecycleEnabled||typeof prepareNativeLifecycle!=='function'))throw Error('world.native-lifecycle-bootstrap-callback');
 if(walkSettleWaitV1!==undefined&&typeof walkSettleWaitV1!=='boolean')throw Error('world.walk-settle-wait-flag');
 if(!['mars','littlemartians'].includes(worldKey)||!input||!dataDir||!worldId||!Number.isInteger(port)||(child?port<1024||port>65535:port<4963||port>4969))throw Error('explicit local Mars/LM input/data/world and port4963..4969 required');
 if(!child&&!build.startsWith('local-')||!ownerId)throw Error('local build and explicit cast owner required');
 const exposure=worldAuthMode(authMode,{edgePublic:process.env.EDGE_PUBLIC,devAuth:process.env.DEV_AUTH,seedCast,nativeCast});
 // Validate explicit activation before a data directory/lock/database is touched.
 worldAccountAuthRequired(exposure,accountAuth);
 input=resolve(input);dataDir=resolve(dataDir);
 if(worldKey==='littlemartians'){
  const actual=createHash('sha256').update(readFileSync(join(input,'worlds/littlemartians/scene.json'))).digest('hex');
  const legacy='fc2f8c0e44edea2b60af066572da59e3407ceecf1bf33afc8469791a79f4cd44';
  if(worldVariant==='legacy'){if(actual!==legacy)throw Error('LM legacy scene differs; an authored map requires its own explicit world identity and scene hash');}
  else if(worldVariant==='authored'){if(worldId==='littlemartians-1'||sceneSha256!==actual)throw Error('LM authored map requires a separate worldId and exact sceneSha256');}
  else throw Error('unknown Little Martians worldVariant');
 }
 let experiencesData;
 if(experiencesFile){
  if(worldKey!=='littlemartians'||worldVariant!=='authored'||resolve(experiencesFile)!==join(input,'worlds/littlemartians/experiences.json'))throw Error('experiences require the explicit authored world source file');
  const bytes=readFileSync(resolve(experiencesFile));if(createHash('sha256').update(bytes).digest('hex')!==experiencesSha256)throw Error('authored experiences source hash differs');
  experiencesData=JSON.parse(bytes.toString('utf8'));
 }
 const authoredData=readAuthoredSidecars({input,worldKey,worldVariant,worldId,placeData,placeDataSha256,activityData,activityDataSha256,nativeAliases,nativeAliasesSha256});
 mkdirSync(dataDir,{recursive:true});
 const lockPath=join(dataDir,'edge-server.lock');
 const releaseLock=()=>{try{if(JSON.parse(readFileSync(lockPath,'utf8')).pid===process.pid)unlinkSync(lockPath);}catch{/* already released */}};
 try{writeFileSync(lockPath,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx'});}catch(error){
  if(error.code!=='EEXIST')throw error;
  const held=JSON.parse(readFileSync(lockPath,'utf8'));let alive=false;try{process.kill(held.pid,0);alive=true;}catch(e){if(e.code!=='ESRCH')throw e;}
  if(alive)throw Error('another process owns this world data directory');
  unlinkSync(lockPath);writeFileSync(lockPath,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx'});
 }
 const load=p=>import(pathToFileURL(join(input,p)).href),require=createRequire(join(input,'apps/server/package.json'));
 let db,host,server,hub,auth,brain,edge,closing=false;
 async function drive(p){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}if(!done)throw Error('world bootstrap sequencer did not settle');return p;}
 try{
  const prior=process.env.DATA_DIR;process.env.DATA_DIR=dataDir;
  let defaults;try{defaults=(await load('apps/server/src/config.ts')).config;}finally{if(prior===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=prior;}
  const origin=validateWorldOrigin(publicOrigin??`http://127.0.0.1:${port}`,authMode);
  const cfg={...defaults,accountAuthRequired:worldAccountAuthRequired(exposure,accountAuth,defaults.accountAuthRequired),worldKey,worldId,worldPath:`${basePath}/w/${worldKey}`,worldSeed:'sim-genesis-1',host:'127.0.0.1',port,dataDir,
   webDir:resolve(webDir??join(input,'apps/web/dist')),marsWebDir:resolve(marsWebDir??join(input,'mars/viewer/dist/client')),
   publicUrl:`${origin.replace(/\/$/,'')}${basePath}/w/${worldKey}`,engine:'mars',livingWorld:true,seedNatives:false,ownerId,
   brainMode:'fake',budgetUsdPerDay:0,thinkingBudgetCeiling:1,authorizedThinkingWorldId:undefined,typesafeKey:undefined,anthropicKey:undefined,
   ...(exposure.configured?{}:{authProvider:'none',privyAppId:'',privyAppSecret:''}),r2:{prefix:'sim'},archiveTakes:false,inviteRequired:exposure.configured?defaults.inviteRequired:false,maxSoulsPerUser:exposure.configured?defaults.maxSoulsPerUser:50,build,mindDriver:'edge',
   skillFile:undefined,cliFile:cliFile?resolve(cliFile):undefined,instructionsFile:resolve(instructionsFile||join(input,'tools/world-launcher/soul/instructions.md'))};
  const {Db}=await load('apps/server/src/db.ts'),{WorldHost}=await load('apps/server/src/world.ts'),native=await load('packages/engine-mars/src/index.ts');
  const {worldDefinition}=await load('apps/server/src/world-config.ts'),definition=worldDefinition(worldKey);
  db=new Db(join(dataDir,'sim.db'));
  const selected=worldKey==='littlemartians'?native.LITTLE_MARTIANS_WORLD:{scene:'eden-camp',arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Mars camp'},map:native.MARS_2026_MAP,disassemblyV1:true};
  const factory=lifecycleEnabled?await (await load('packages/engine-native/src/selected-crew-removal.ts')).selectedNativeCrewRemovalFactoryV1(selected):await native.marsFactory(selected);
  host=new WorldHost(db,factory,db.world(worldId)?.seed??cfg.worldSeed,cfg.snapshotEveryTicks,worldId,{durableClockV1:true});const boot=host.boot();
  if(worldKey==='littlemartians'&&host.engine.world.base.staticHash!==factory.genesis(host.seed).base.staticHash)throw Error('LM persisted physical base differs from selected map; preserve the old reader and database');
  const authored=authoredData?(await load('apps/server/src/worlds/authored-lm-edge.ts')).validateAuthoredLmSidecars(host,authoredData):undefined;
  if(checkOnly){const result={checkOnly:true,boot,worldKey,worldId,tick:host.engine.world.tick,head:host.seq,stateHash:host.engine.stateHash(),rulesVersion:host.engine.rulesVersion};host.stop();db.close();releaseLock();return result;}
  // #1008: no skillFile → the pinned launcher skill, adapted below like the one local-worlds.mjs passes; the instructions
  // default above is the pinned guide too, so neither names the legacy eden-agent.mjs.
  skillFile||=join(input,'tools/world-launcher/soul/skill.md');
  if(skillFile){
   // The shared CLI stays identical. Only selected-world prose is adapted.
   const text=readFileSync(resolve(skillFile),'utf8').replace(/\bEden\b/g,definition.name);
   cfg.skillFile=join(dataDir,'world-skill.md');writeFileSync(cfg.skillFile,text+`\n\n## This world\n\n${definition.name}: ${worldKey==='mars'?'The camp sits on the 2026 campus. Pallet-rack lookout construction and take-down, meals, garden work and bunks use native physical programs. Food is finite until quiet first light.':'Ceramic sculptures glide and hover. They have no hands or limbs; read current body capabilities before acting. Human arrivals keep their own body abilities.'}\n`);
  }
  const {Auth}=await load('apps/server/src/auth.ts'),{Brain}=await load('apps/server/src/brain.ts'),{Souls,ApiError}=await load('apps/server/src/souls.ts');
  const {LivingWorld}=await load('apps/server/src/living.ts'),{Hub}=await load('apps/server/src/hub.ts'),{buildApp}=await load('apps/server/src/http.ts');
  const {stripWorldRequestPath}=await load('apps/server/src/world-request-path.ts'),{handleMcp}=await load('apps/server/src/mcp.ts'),{EdgeLedger}=await load('apps/server/src/edge/ledger/ledger.ts');
  auth=new Auth(cfg,db);auth.devAuth=exposure.devAuth;if(exposure.configured)await auth.init();if(cfg.accountAuthRequired&&!auth.ready)throw Error('Account authentication verifier unavailable');
  // The application exposes edge control; a separate fake-only config enables
  // the existing needs-driven native cast. A token or non-cast identity excludes
  // the Soul from every native thought/speech/reflection route immediately.
  const castNames=new Set(definition.cast.map(n=>n.name));
  // Authority comes from durable original birth identities, never today's
  // names. Retiring/recreating a name must not grant native control on restart.
  const rosterFacts=db.rulesEvents(worldId).filter(e=>e.payload?.nativeCastRosterV1);
  if(rosterFacts.some(e=>e.author!=='operator:local-native-cast-roster'))throw Error('native cast roster lacks its explicit operator origin');
  if(rosterFacts.length>1)throw Error('native cast has conflicting roster facts');
  const recorded=rosterFacts[0]?.payload.nativeCastRosterV1;
  if(recorded&&(recorded.contract!=='native-cast-roster/1'||recorded.ownerId!==ownerId||recorded.worldKey!==worldKey||!Array.isArray(recorded.cast)))throw Error('native cast roster differs from selected owner/world');
  const births=db.events(worldId).filter(e=>e.kind==='birth');
  const originalPrefix=births.slice(0,definition.cast.length);
  const validPrefix=originalPrefix.length===definition.cast.length&&new Set(originalPrefix.map(e=>e.payload.name)).size===definition.cast.length&&originalPrefix.every(e=>e.payload.owner===ownerId&&castNames.has(e.payload.name));
  let roster=recorded?.cast??(nativeCastIds?nativeCastIds.map(id=>{const birth=births.find(e=>e.payload.soulId===id);if(!birth||birth.payload.owner!==ownerId)throw Error('explicit native cast identity lacks its accepted owned birth');return{soulId:id,entityId:birth.payload.entityId,name:birth.payload.name};}):validPrefix?originalPrefix.map(e=>({soulId:e.payload.soulId,entityId:e.payload.entityId,name:e.payload.name})):[]);
  if(new Set(roster.map(e=>e.soulId)).size!==roster.length||roster.some(e=>typeof e.soulId!=='string'||typeof e.entityId!=='string'||!castNames.has(e.name)))throw Error('invalid native cast roster');
  if(nativeCast&&births.length&&!roster.length)throw Error('legacy history requires explicit original nativeCastIds; current names cannot grant authority');
  const castIds=new Set(roster.map(e=>e.soulId)),castEntities=new Map(roster.map(e=>[e.soulId,e.entityId]));
  const skipMind=m=>{const row=db.soul(m.soulId);return !nativeCast||!castIds.has(m.soulId)||castEntities.get(m.soulId)!==m.entityId||m.owner!==ownerId||!row||row.owner!==ownerId||row.entity_id!==m.entityId||row.world_id!==worldId||row.retired_at!==null||!!row.token_hash;};
  if(nativeCast&&!host.engine.nativeProgramParticipantsV1)throw Error('native cast requires the qualified native participant reader');
  const nativeProgramAllowed=(m,steps)=>{
   if(skipMind(m))return false;
   const participants=host.engine.nativeProgramParticipantsV1({actor:m.entityId,label:'native cast admission',steps});
   if(participants===null)return false;
   // LM cast cards use generic glide/rest. Unqualified raw camp limb/work or
   // classroom programs may not recruit a rigid secondary after a body swap.
   if(participants.some(id=>host.engine.world.entities[id]?.body?.family==='floater')&&steps.some(s=>s.verb.startsWith('mars:')||['build_lookout','unbuild_lookout','control_classroom_v1'].includes(s.verb)))return false;
   return participants.every(id=>{const peer=host.mindByEntity.get(id);return !!peer&&!skipMind(peer);});
  };
  brain=new Brain(host,db,{...cfg,mindDriver:'central'},{clients:()=>hub?.clients.size??0,onCall:c=>hub?.brainCall(c),onCamera:line=>hub?.broadcast({t:'camera',line}),onTicker:lines=>hub?.broadcast({t:'ticker',lines}),onNarrative:view=>hub?.broadcast({t:'narrative',view}),onTalk:lines=>hub?.broadcast({t:'talk',lines})},{skipMind,nativeProgramAllowed:nativeCast?nativeProgramAllowed:undefined});
  if(!nativeCast)brain.quiesce();
  const souls=new Souls(host,db,brain,cfg,{controlReady:row=>{
   if(castIds.has(row.id)&&!row.token_hash&&(host.engine.programOf(row.entity_id)||host.engine.actorBorrowed?.(row.entity_id)))throw new ApiError(409,'native-cast.busy','The current native activity must reach a safe boundary before pairing. Retry after it finishes.');
   return true;
  }});
  if(walkSettleWaitV1===true)console.log(JSON.stringify(await installWalkSettleWaitV1(host,walkSettleWaitV1,drive)));
  if(installLiving){const living=new LivingWorld(host);living.camp=worldKey==='mars';await drive(living.install(definition.customs));}
  if(runtimePolicies){
   if(host.engine.configureRuntimePolicy&&!host.extra.runtimePolicy?.quietSeatCourtesy)await drive(host.enqueue('rules','world',{runtimePolicy:{sleepBlockTicks:1200,...host.extra.runtimePolicy,quietSeatCourtesy:true},why:'enable native quiet-seat courtesy prospectively'}));
   for(const name of ['enableQuietStallReleaseV1','enableYieldTimeoutV1','enableSpreadV2','enableStairMakeWayV1','enableReflexTimeoutV1','enableEdgeMotionV1'])if(host[name])await drive(host[name]());
   // continuousDay deliberately omitted: Mars food replenishes at quiet first light.
  }
  let lifecycleFact;
  const bootstrapNativeLifecycle=async()=>{
   if(!lifecycleEnabled)throw Error('world.native-lifecycle-not-enabled');
   return lifecycleFact=await (await load('packages/engine-native/src/selected-lifecycle-bootstrap.ts')).installSelectedNativeLifecycleV1(host,souls,drive);
  };
  if(lifecycleEnabled){
   // Trusted private operator may await actual existing programme completion.
   // No listener/public approval route starts before the accepted policy and
   // lifecycle producer are ready. The callback cannot come from JSON config.
   if(prepareNativeLifecycle)await prepareNativeLifecycle({host,souls,drive});
   console.log(JSON.stringify(await bootstrapNativeLifecycle()));
  }
  if(seedCast&&births.length===0&&db.liveSouls(worldId).length===0){db.upsertUser({id:ownerId,email:null,wallet:null,role:'admin'});for(const entry of definition.cast){const row=await drive(souls.create(ownerId,entry,true));castIds.add(row.id);castEntities.set(row.id,row.entity_id);roster.push({soulId:row.id,entityId:row.entity_id,name:row.name});}}
  if(nativeCast&&!recorded)await drive(host.enqueue('rules','operator:local-native-cast-roster',{nativeCastRosterV1:{contract:'native-cast-roster/1',worldKey,ownerId,cast:roster},why:'authorize only original cast birth identities; later name reuse never grants control'}));
  if(nativeCast&&!recorded)for(const entry of roster){const mind=host.minds.get(entry.soulId);if(mind&&!skipMind(mind))await drive(brain.attune(mind));}
  if(cards){if(worldKey==='mars'){const {CampCards}=await load('apps/server/src/camp.ts');new CampCards(host);}else{const {FloaterCards}=await load('apps/server/src/floaters.ts');new FloaterCards(host);}host.drainInputs();await setImmediate();}
  // Fake native needs already animate the cast. A second ambient decision
  // driver could commandeer a crew member borrowed by a construction program.
  edge=new EdgeLedger(host,db,authored?.places,{ambient:false,...(authored?{spots:authored.activities}:{})});
  const {marsEdgeProfile}=await load('apps/server/src/worlds/mars-edge.ts'),{floaterEdgeProfile}=await load('apps/server/src/worlds/floater-edge.ts');
  const profile=worldKey==='mars'?marsEdgeProfile(host):null,rigid=floaterEdgeProfile(host);
  const experienceProfile=experiencesData?(await load('apps/server/src/worlds/experiences-edge.ts')).lmExperienceEdgeProfile(host,experiencesData):undefined;
  const aliasesProfile=authored?(await load('apps/server/src/worlds/authored-lm-edge.ts')).authoredLmAliasProfile(host,authored.aliases):undefined;
  edge.worldProfile=Object.assign((soul,caps,plans)=>{profile?.(soul,caps,plans);aliasesProfile?.(soul,caps,plans);experienceProfile?.(soul,caps,plans);rigid(soul,caps,plans);},{nativePlaceAliases:aliasesProfile?.nativePlaceAliases??[]});
  server=createServer();const strip=url=>stripWorldRequestPath(url,cfg.worldPath);server.on('upgrade',req=>{req.url=strip(req.url);});
  hub=new Hub(server,host,auth,db);hub.brain=brain;hub.build=build;
  const previousFading=process.env.EDGE_FADING;delete process.env.EDGE_FADING;
  let app;try{app=buildApp({cfg,db,host,auth,brain,souls,hub,edge});}finally{if(previousFading!==undefined)process.env.EDGE_FADING=previousFading;}
  const listener=require('@hono/node-server').getRequestListener(app.fetch);
  server.on('request',(req,res)=>{
   if(closing){res.writeHead(503,{'Cache-Control':'no-store'}).end('World is draining.');return;}
   req.url=strip(req.url);
   if(req.url?.startsWith('/mcp')){void handleMcp(req,res,souls,undefined,(method,path,token,body)=>Promise.resolve(app.request(path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})})).then(r=>r.json())).catch(()=>{if(!res.headersSent)res.writeHead(503).end();});return;}
   void listener(req,res);
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});host.start();void (async()=>{try{const {legacyLookBootHook}=await load('apps/server/src/edge/body/migrate-looks.ts');await legacyLookBootHook(host,db,edge,dataDir,process.env,m=>console.error(m));}catch(e){console.error('[legacy-looks] failed:',e?.message??e);}try{const {retireResidentsBootHook}=await load('apps/server/src/retire-residents.ts');await retireResidentsBootHook(souls,db,host.worldId,dataDir,process.env,m=>console.error(m));}catch(e){console.error('[retire-residents] failed:',e?.message??e);}})(); // one-shot <dataDir>/legacy-looks.env (looks v2), <dataDir>/retire-residents.env (3.1.1)
  async function close(){
   if(closing)return;closing=true;brain.quiesce();host.stop();edge.comms?.close();void hub.closeClients('local world stopping');
   const closed=new Promise(r=>server.close(r));server.closeAllConnections?.();const pump=setInterval(()=>host.drainInputs(),10);
   try{await closed;await brain.settled();host.drainInputs();if(host.engine.canSnapshot?.())host.saveSnapshot(true);else host.persistClockFrontier();}
   finally{clearInterval(pump);await new Promise(r=>hub.wss.close(r));auth.close();db.close();releaseLock();}
  }
  return{cfg,boot,db,host,auth,brain,souls,hub,server,edge,close,...(lifecycleEnabled?{lifecycleFact,bootstrapNativeLifecycle}:{})};
 }catch(error){brain?.quiesce();host?.stop();server?.close();auth?.close();if(db?.db.isOpen)db.close();releaseLock();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [path,mode]=process.argv.slice(2);if(!path)throw Error('usage: node tools/core/multiworld/world-server.mjs <descriptor.json> [check]');
  const server=await openWorldServer({...JSON.parse(readFileSync(resolve(path),'utf8')),checkOnly:mode==='check'});
  if(server.checkOnly)console.log(JSON.stringify(server));else{console.log(JSON.stringify({url:server.cfg.publicUrl,worldId:server.host.worldId,boot:server.boot,mindDriver:'edge',nativeCast:'fake',budgetUsd:0}));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void server.close().then(()=>process.exit(0)).catch(()=>process.exit(1)));}
 }catch(error){console.error('World server refused:',error.message);process.exitCode=1;}
}
