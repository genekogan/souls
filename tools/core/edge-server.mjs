// Edge server entry (EDGE-CONTRACT-v1). Owners' agents drive Souls; the world runs no Soul mind.
// Usage: node tools/core/edge-server.mjs <descriptor.json> [check]
// Descriptor: {input, dataDir, worldId, port, build, webDir?, marsWebDir?, placeData?, inputManifestSHA256?, localSoulLimit?, flags?{...}, nav?{ground?:[{id,boundsXZ}]}, activitySpots?, upperFloors?}
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,mkdirSync,statSync,writeFileSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';

export async function openEdgeServerV1({input,dataDir,worldId,port=4959,webDir,marsWebDir,build='local-edge/1',checkOnly=false,placeData,seedObjects,inviteRequired=false,skillFile,cliFile,instructionsFile,accountAuth=false,publicOrigin,ambient=true,
  officeStairGuards=false,authoredBoundariesFile=undefined,authoredBoundariesSHA256=undefined,inputManifestSHA256,modelCredentialFile=undefined,localBudget=0,autonomous=false,localSoulLimit=5,humanRest=false,provisions=false,sequences=false,floorGoals=false,kitchen=false,shore=false,foodDeliveryId,quietLandingCourtesy=false,social=false,closedGoals=false,approachRetention=false,activateExpansion=false,humanDirectionBurstUsd=1,quiesceThought=false,nativePlaces=[],nav=null,activitySpots,basePath='',launcherChild=false}) {
  // basePath (world launcher fork, e.g. '/worlds'): served at <basePath>/w/eden on a launcher child port with the launcher's build id.
  // launcherChild: the same on a launcher that serves the original worlds at the root (basePath '', --old-worlds-root).
  const child=!!basePath||launcherChild===true;
  if(basePath!==''&&!/^\/[a-z][a-z0-9-]{0,31}$/.test(basePath))throw Error('basePath must be one path segment like /worlds');
  if(!input||!dataDir||!worldId||!Number.isInteger(port)||!(child?port>=1024&&port<=65535:port>=4950&&port<=4959||port===4970))throw Error('explicit local input/data/world/allowed port required');
  if(!child&&!build.startsWith('local-'))throw Error('local build identity required');
  const origin=new URL(publicOrigin??`http://127.0.0.1:${port}`);if(origin.origin!==origin.href.replace(/\/$/,'')||origin.username||origin.password||!['http:','https:'].includes(origin.protocol)||origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw Error('explicit canonical public origin required');
  input=resolve(input);dataDir=resolve(dataDir);
  let authoredBoundaryDeclaration;
  if(authoredBoundariesFile!==undefined||authoredBoundariesSHA256!==undefined){
    if(typeof authoredBoundariesFile!=='string'||!authoredBoundariesFile||typeof authoredBoundariesSHA256!=='string'||!/^[a-f0-9]{64}$/.test(authoredBoundariesSHA256))throw Error('authored boundaries require explicit source file and exact SHA256 pin');
    const bytes=readFileSync(resolve(authoredBoundariesFile));if(bytes.length>4*1024*1024||createHash('sha256').update(bytes).digest('hex')!==authoredBoundariesSHA256)throw Error('authored boundary source file differs from the selected pin');
    const {authoredBoundariesDeclarationV1Schema}=await import(pathToFileURL(join(input,'packages/engine-contract/src/authored-boundaries-v1.ts')).href);
    authoredBoundaryDeclaration=authoredBoundariesDeclarationV1Schema.parse(JSON.parse(bytes.toString('utf8')));
  }

  // Single writer per data dir: a second server on the same DB would fork the durable clock.
  const lockPath=join(dataDir,'edge-server.lock');mkdirSync(dataDir,{recursive:true});
  if(!checkOnly){
    try{const held=JSON.parse(readFileSync(lockPath,'utf8'));let alive=false;try{process.kill(held.pid,0);alive=held.pid!==process.pid;}catch{alive=false;}
      if(alive)throw Error(`another edge server (pid ${held.pid}) is still running on this data dir; wait for it to exit`);}catch(error){if(error instanceof Error&&error.message.startsWith('another edge server'))throw error;}
    writeFileSync(lockPath,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
  }
  const releaseLock=()=>{try{if(JSON.parse(readFileSync(lockPath,'utf8')).pid===process.pid)unlinkSync(lockPath);}catch{/* already gone */}};
  const manifest=inputManifestSHA256?JSON.parse(readFileSync(join(input,'../CONTENT-MANIFEST.json'),'utf8')):null;
  if(inputManifestSHA256&&(!/^[a-f0-9]{64}$/.test(inputManifestSHA256)||createHash('sha256').update(readFileSync(join(input,'../CONTENT-MANIFEST.json'))).digest('hex')!==inputManifestSHA256))throw Error('not the explicitly selected runtime content manifest');
  const sources=['db','world','auth','account-registry','brain','souls','http','hub','intent-control','mcp','living','config','world-request-path'];
  const pins=sources.map(name=>{
    const path=`apps/server/src/${name}.ts`,sha256=createHash('sha256').update(readFileSync(join(input,path))).digest('hex');
    if(manifest&&sha256!==manifest[path]?.sha256)throw Error('sealed runtime differs: '+path);
    return {path,sha256};
  });
  const load=p=>import(pathToFileURL(join(input,p)).href),require=createRequire(join(input,'apps/server/package.json'));
  // config.ts creates DATA_DIR when imported. Scope that side effect to this
  // explicit local folder; no .env reader or provider/auth credentials.
  mkdirSync(dataDir,{recursive:true});const prior=process.env.DATA_DIR;process.env.DATA_DIR=dataDir;
  let defaults;try{defaults=(await load('apps/server/src/config.ts')).config;}finally{if(prior===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=prior;}
  const cfg={...defaults,worldKey:'eden',worldId,worldPath:`${basePath}/w/eden`,worldSeed:'sim-genesis-1',
    host:'127.0.0.1',port,dataDir,webDir:resolve(webDir??join(input,'apps/web/dist')),marsWebDir:resolve(marsWebDir??join(input,'mars/viewer/dist/client')),
    publicUrl:`${origin.origin}${basePath}/w/eden`,engine:'mars',livingWorld:true,seedNatives:false,
    ownerId:'dev:admin',brainMode:'fake',budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,
    accountAuthRequired:accountAuth===true,privyAppId:accountAuth?defaults.privyAppId:'',privyAppSecret:accountAuth?defaults.privyAppSecret:'',archiveTakes:false,inviteRequired,maxSoulsPerUser:5,build,mindDriver:'edge',skillFile:skillFile?resolve(skillFile):defaults.skillFile,cliFile:cliFile?resolve(cliFile):defaults.cliFile,instructionsFile:instructionsFile?resolve(instructionsFile):join(input,'tools/edge-skill/INSTRUCTIONS.md')};  // Gene 2026-10-07: pairing open
  if(!Number.isInteger(localSoulLimit)||localSoulLimit<1||localSoulLimit>50)throw Error('local Soul allowance must be 1..50');
  cfg.maxSoulsPerUser=localSoulLimit;cfg.thinkingBudgetCeiling=3;cfg.authorizedThinkingWorldId=worldId;cfg.budgetUsdPerDay=localBudget;
  if(modelCredentialFile)throw Error('edge server runs no Soul mind and takes no model credentials');
  const {Db}=await load('apps/server/src/db.ts'),{WorldHost}=await load('apps/server/src/world.ts');
  const native=await load('packages/engine-mars/src/index.ts'),db=new Db(join(dataDir,'sim.db'));
  let host,server,hub,auth,service,provisionBirths,kitchenInstallation,shoreInstallation,foodDelivery,socialInstallation,closing=false;
  async function drive(p){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}if(!done)throw Error('bootstrap sequencer did not settle');return p;}
  try {
    const header=db.world(worldId),beforeRows=db.liveSouls(worldId),beforeEvents=db.events(worldId);
    // A physical transition reader is not a crew-policy migration. Old preview
    // history lacks crew-removal/1 and cannot enable the lifecycle service.
    // Refuse before boot/checkpoint writes; never relabel its old rules header.
    if(header&&!header.rules_version.includes('+crew-removal/1'))throw Error('local-bootstrap.lifecycle-policy-upgrade-unavailable: old history lacks crew-removal/1; preserve this DB and use a distinct fresh local world until a versioned policy migration exists');
    const migrated=beforeEvents.some(e=>e.kind==='rules'&&e.payload.commonsTransition);
    if(shore&&!kitchen)throw Error('local shore requires retained kitchen resources');
    if(kitchen&&!provisions)throw Error('local kitchen requires retained personal provisions');
    const finiteFoodReader=!!foodDeliveryId||header?.rules_version.includes('+fd/1');
    const socialReader=social||!!header?.rules_version.includes('+social-eden/1');
    const {edenHistoryFactory}=await load('apps/server/src/eden-bootstrap.ts');
    const factory=await edenHistoryFactory(db,worldId,{lifeV1:true,newcomerResourcesV1:true,sleepSnapshotV1:true,groundV1:true,lectureV1:true});
    host=new WorldHost(db,factory,header?.seed??cfg.worldSeed,cfg.snapshotEveryTicks,worldId,{durableClockV1:true});
    const boot=host.boot();
    if(authoredBoundaryDeclaration){if(!host.engine.previewAuthoredBoundariesV1)throw Error('selected runtime lacks authored boundary preview');const issue=host.engine.previewAuthoredBoundariesV1(authoredBoundaryDeclaration);if(issue)throw Error(issue.code+': '+issue.message);}
    if(approachRetention){if(!host.enableIntentApproachRetentionV1)throw Error('selected runtime needs native approach retention');await drive(host.enableIntentApproachRetentionV1());}
    if(quietLandingCourtesy){if(!host.enableQuietLandingCourtesyV1)throw Error('selected runtime needs prospective quiet landing courtesy');await drive(host.enableQuietLandingCourtesyV1());}
    if(floorGoals){if(!host.enableGroundFixtureGoalsV1)throw Error('selected runtime needs ground fixture goal levels');await drive(host.enableGroundFixtureGoalsV1());}
    if(sequences){if(!host.enableIntentSequencesV1)throw Error('selected runtime needs purpose-bound sequences');await drive(host.enableIntentSequencesV1());}
    if(humanRest){if(!host.enableHumanRestNeedsV1)throw Error('selected runtime needs versioned human rest recovery');await drive(host.enableHumanRestNeedsV1());}
    if(provisions&&!host.engine.rulesVersion.includes('+commons-provisions/1')&&!host.engine.rulesVersion.includes('+cp/2')){if(!host.installCommonsProvisionsV1)throw Error('selected runtime needs retained commons provisions');await drive(host.installCommonsProvisionsV1());}
    if(header&&host.engine.world.base.campus!=='eden-commons'&&!(shore&&['eden-commons-shore/1','eden-commons-shore-expanded/1'].includes(host.engine.world.base.campus))) {
      // Read-only preflight first. Refusal never substitutes a new world or pose.
      const preview=host.engine.previewCommonsTransition?.();
      if(!preview?.ok)throw Error(preview?`${preview.diagnostic.code}: ${preview.diagnostic.message}`:'commons-transition.reader-unavailable');
      if(checkOnly){host.stop();db.close();return {checkOnly:true,compatible:true,boot,preview:preview.transition,owners:beforeRows.map(r=>({soulId:r.id,owner:r.owner,entityId:r.entity_id})),eventCount:beforeEvents.length,pins};}
      await drive(host.adoptCommons('operator:local-bootstrap'));
      for(const row of beforeRows){const current=db.soul(row.id);if(current.owner!==row.owner||current.entity_id!==row.entity_id)throw Error('old Soul mapping differs');}
      const prefix=db.events(worldId).slice(0,beforeEvents.length);
      if(JSON.stringify(prefix)!==JSON.stringify(beforeEvents))throw Error('old event prefix differs');
    } else if(checkOnly){host.stop();db.close();return {checkOnly:true,compatible:true,boot,owners:beforeRows.length,pins};}
    if(activateExpansion){if(!host.engine.rulesVersion.includes('+cp/2')){const p=JSON.parse(readFileSync(join(input,'packages/engine-mars/src/fixtures/newcomer-layout.world-alternative.v2.json'),'utf8'));await drive(host.installCommonsNewcomerResourcesV1(p.placements));}if(!host.engine.rulesVersion.endsWith('+ss/1'))await drive(host.installNativeSleepSnapshotV1());const {installEdenSteeringModeV1}=await load('apps/server/src/eden-steering-mode.ts');await drive(installEdenSteeringModeV1(host,{closedGoalsV1:true,registeredActivitiesV1:true}));if(!host.engine.rulesVersion.includes('+eg/1'))await drive(host.installEdenGroundV1());if(!host.engine.rulesVersion.includes('+l/1'))await drive(host.installEdenLectureV1({worldEast:'world-v2',id:'eden-classroom-1',origin:[42,-6],yaw:0,audienceSeats:20,lesson:'Eden: observe, ask, give a direction, watch what changes.'}));}
    const {LivingWorld}=await load('apps/server/src/living.ts');await drive(new LivingWorld(host).install(['People may explore the commons, rest, and meet one another.']));
    const {Auth}=await load('apps/server/src/auth.ts'),{Brain}=await load('apps/server/src/brain.ts'),{Souls}=await load('apps/server/src/souls.ts');
    const {Hub}=await load('apps/server/src/hub.ts'),{IntentControlV2}=await load('apps/server/src/intent-control.ts'),{buildApp}=await load('apps/server/src/http.ts');
    const {stripWorldRequestPath}=await load('apps/server/src/world-request-path.ts'),{handleMcp}=await load('apps/server/src/mcp.ts');
    auth=new Auth(cfg,db);auth.devAuth=!accountAuth;
    if(accountAuth&&!checkOnly){await auth.init();if(!auth.ready)throw Error('Account authentication verifier unavailable');}
    const brain=new Brain(host,db,cfg,{clients:()=>hub?.clients.size??0,onCall:c=>hub?.brainCall(c),onCamera:line=>hub?.broadcast({t:'camera',line}),onTicker:lines=>hub?.broadcast({t:'ticker',lines}),onNarrative:view=>hub?.broadcast({t:'narrative',view}),onTalk:lines=>hub?.broadcast({t:'talk',lines})},{intentV2Choices:true,intentV2Retries:false});
    brain.quiesce();
    const souls=new Souls(host,db,brain,cfg);souls.enableLifecycle();
    if(provisions){const {followCommonsProvisionBirths}=await load('apps/server/src/commons-provisions.ts');if(!followCommonsProvisionBirths)throw Error('selected runtime needs prospective provision births');provisionBirths=await followCommonsProvisionBirths(host,brain);}
    if(foodDeliveryId){if(!provisions||!kitchen)throw Error('finite food delivery requires retained personal/kitchen resources');const {scheduleFiniteFoodDeliveryV1}=await load('apps/server/src/food-delivery.ts');foodDelivery=scheduleFiniteFoodDeliveryV1(host,brain,foodDeliveryId);}
    if(kitchen){const {scheduleCommonsKitchenInstallation}=await load('apps/server/src/commons-kitchen-install.ts');kitchenInstallation=scheduleCommonsKitchenInstallation(host,brain);}
    if(social){if(!kitchen)throw Error('social Eden requires retained kitchen resources');const {scheduleSocialEdenInstallationV1}=await load('apps/server/src/social-eden-install.ts');socialInstallation=scheduleSocialEdenInstallationV1(host,brain);}
    if(shore){const {scheduleRetainedCommonsShoreInstallation}=await load('apps/server/src/retained-shore-install.ts');shoreInstallation=scheduleRetainedCommonsShoreInstallation(host);}
    service=new IntentControlV2(host,brain,souls,{historyV1:true,closedGoalsV1:closedGoals,registeredActivitiesV1:closedGoals});server=createServer();
    const strip=url=>stripWorldRequestPath(url,cfg.worldPath);
    server.on('upgrade',req=>{req.url=strip(req.url);});hub=new Hub(server,host,auth,db,souls);hub.brain=brain;hub.build=cfg.build;
    if(host.enableQuietStallReleaseV1)await drive(host.enableQuietStallReleaseV1());
    if(host.enableYieldTimeoutV1)await drive(host.enableYieldTimeoutV1());
    if(host.enableSpreadV2)await drive(host.enableSpreadV2());
    if(host.enableSpreadClearV1)await drive(host.enableSpreadClearV1());
    if(host.enableRouteReachV1)await drive(host.enableRouteReachV1());
    if(host.enableStairMakeWayV1)await drive(host.enableStairMakeWayV1());
    if(host.enableReflexTimeoutV1)await drive(host.enableReflexTimeoutV1());
    if(host.enableContinuousDayV1)await drive(host.enableContinuousDayV1());
    if(host.enableEdgeMotionV1)await drive(host.enableEdgeMotionV1());
    if(shore&&host.enableShoreDepartV1)await drive(host.enableShoreDepartV1());
    // nav/1: enclosed buildings, water and World's scenery solids become solid to walking; admitted interiors get walls with doors;
    // descriptor nav.ground widens walkable ground (e.g. south to the park). One logged rules fact; a no-op when unchanged.
    const spotsRaw=activitySpots?JSON.parse(readFileSync(resolve(activitySpots),'utf8')):undefined;
    if(nav){if(!placeData)throw Error('nav needs placeData');if(!host.installNavV1)throw Error('selected runtime has no nav/1');
      const {navSpecFromPlaces}=await load('apps/server/src/edge/ledger/nav.ts'),{loadSpots}=await load('apps/server/src/edge/ledger/activities.ts');
      const data=JSON.parse(readFileSync(resolve(placeData),'utf8')),spots=loadSpots(spotsRaw).data;
      const native=new Set([...Object.entries(host.engine.world.regions).filter(([,r])=>!String(r.provenance?.note??'').includes('placeRegionsV1')).map(([id])=>id),...data.places.filter(p=>(p.occupiers??[]).length).map(p=>p.id)]);
      // CN5: nav.extraSolids = activity-spots/1 files whose solids join World's (Core's provisional district survey); platforms keep decks walkable
      const extra=(Array.isArray(nav.extraSolids)?nav.extraSolids:[]).flatMap(path=>{const out=loadSpots(JSON.parse(readFileSync(resolve(path),'utf8')));if(out.refused.length)console.error('[edge] nav extra solids refused:',path,out.refused.join(', '));return out.data.solids;});
      const spec=navSpecFromPlaces(data,{native,ground:Array.isArray(nav.ground)?nav.ground:[],area:[host.engine.nativeGroundBoundsV1()],extraSolids:[...spots.solids,...extra],rings:spots.rings,interiors:spots.interiors,platforms:spots.platforms});
      // A refused spec is reported and the world boots without it (never a half-installed nav).
      try{const out=await drive(host.installNavV1(spec));console.error('[edge] nav/1:',JSON.stringify({installed:out.installed,ground:spec.ground.length,solids:spec.solids.length}));}
      catch(error){console.error('[edge] nav/1 refused:',error instanceof Error?error.message:String(error));}}
    // placeRegionsV1: named W1 places (from placeData) on admitted native ground become destination regions (one logged rules fact; idempotent).
    if(nativePlaces.length){if(!placeData)throw Error('nativePlaces needs placeData');if(!host.installPlaceRegionsV1)throw Error('selected runtime has no placeRegionsV1');
      const byId=new Map(JSON.parse(readFileSync(resolve(placeData),'utf8')).places.map(p=>[p.id,p]));
      const out=await drive(host.installPlaceRegionsV1(nativePlaces.filter(id=>byId.has(id)).map(id=>({id,label:byId.get(id).name,polygon:byId.get(id).polygon}))));
      if(out.admitted.length||out.refused.length)console.error('[edge] native places:',JSON.stringify({admitted:out.admitted,refused:out.refused.map(r=>r.id+' '+r.code),unknown:nativePlaces.filter(id=>!byId.has(id))}));}
    // upper-floors/1 (descriptor `upperFloors`: a path, or an array of paths, to upper-floors/1 facts, tools/upper-floors; each
    // file holds one fact or an array of facts, installed in order): a building's upper floors installed once as a logged rules
    // fact, or removed again ({remove}). Already applied: no-op. Refused: reported, the world boots without that building
    // (never half-installed). Read from the options object so the parameter list stays as the launcher's.
    const upperFloorsFiles=[arguments[0]?.upperFloors??[]].flat().filter(Boolean);
    if(upperFloorsFiles.length){if(!host.installUpperFloorsV1)throw Error('selected runtime has no upper-floors/1');
      for(const file of upperFloorsFiles)for(const fact of [JSON.parse(readFileSync(resolve(file),'utf8'))].flat()){
        const done='remove' in fact?!host.engine.world.upperFloorsV1?.buildings?.[fact.remove]:!!host.engine.world.upperFloorsV1?.buildings?.[fact.building?.id];
        try{const out=done?{installed:false}:await drive(host.installUpperFloorsV1(fact));console.error('[edge] upper-floors/1:',JSON.stringify({building:fact.building?.id??fact.remove,remove:'remove' in fact,installed:out.installed,already:done}));}
        catch(error){console.error('[edge] upper-floors/1 refused:',error instanceof Error?error.message:String(error));}}}
    // carrier/1: a seeded ride object with `carrier` installs its native carrier first (logged rules fact, idempotent by id).
    // CN5: a ride whose descriptor route changed flies the new one from its next flight (logged; only while parked and empty)
    for(const o of seedObjects??[])if(o.kind==='ride'&&o.carrier?.route&&host.engine.world.entities[o.params?.carrier]?.carrier&&host.engine.carrierRouteV1?.(o.params.carrier)!==o.carrier.route&&host.setCarrierRouteV1){
      const c=host.engine.world.entities[o.params.carrier].carrier;if(c.phase==='parked'&&!Object.values(c.seats).some(Boolean)){await drive(host.setCarrierRouteV1({id:o.params.carrier,route:o.carrier.route}));console.error('[edge] ride route:',o.params.carrier,'→',host.engine.carrierRouteV1(o.params.carrier));}
      else console.error('[edge] ride route change waits for the ride to be parked and empty (next boot):',o.params.carrier);}
    for(const o of seedObjects??[])if(o.kind==='ride'&&o.carrier&&!host.engine.world.entities[o.params?.carrier]?.carrier){if(!host.installCarrierV1)throw Error('selected runtime has no carrier/1');await drive(host.installCarrierV1({id:o.params.carrier,label:o.name,...o.carrier}));}
    const {EdgeLedger}=await load('apps/server/src/edge/ledger/ledger.ts');
    // Explicit prospective office guard policy only; never grants upper floors/stairs or installs by default.
    if(officeStairGuards===true){const {officeStairGuardBoxes,OFFICE_STAIR_GUARD_VERSION}=await load('mars/viewer/lib/office-stair-guards.ts');await drive(host.installOfficeStairGuardsV1({version:OFFICE_STAIR_GUARD_VERSION,guards:officeStairGuardBoxes()}));}
    if(authoredBoundaryDeclaration){if(!host.installAuthoredBoundariesV1)throw Error('selected runtime lacks authored boundary reader');const out=await drive(host.installAuthoredBoundariesV1(authoredBoundaryDeclaration));console.error('[edge] authored-boundaries:',JSON.stringify({...out,sourceHash:authoredBoundaryDeclaration.sourceHash,boxes:authoredBoundaryDeclaration.boxes.length}));}
    const edge=new EdgeLedger(host,db,placeData?JSON.parse(readFileSync(resolve(placeData),'utf8')):undefined,{ambient,spots:spotsRaw});if(edge.spotsRefused?.length)console.error('[edge] activity spots refused:',edge.spotsRefused.join(', '));
    const app=buildApp({cfg,db,host,auth,brain,souls,hub,intentV2:service,edge}),listener=require('@hono/node-server').getRequestListener(app.fetch);
    // Seed declared objects (idempotent by id). presentation params may give startsInMinutes.
    for(const o of seedObjects??[]){const params={...(o.params??{})};if(typeof params.startsInMinutes==='number'){params.startsAtTick=host.engine.world.tick+Math.round(params.startsInMinutes*60*20);delete params.startsInMinutes;}const {carrier:_c,...object}=o;edge.comms?.objects.create({...object,params});}
    const {installPuntActivities}=await load('apps/server/src/punt-install.ts');installPuntActivities(host,edge,m=>console.error('[activities]',m));
    server.on('request',(req,res)=>{
      if(closing){res.writeHead(503,{'Cache-Control':'no-store'}).end('Local server is draining.');return;}
      req.url=strip(req.url);
      if(req.url?.startsWith('/mcp')){void handleMcp(req,res,souls,service,(method,path,token,body)=>Promise.resolve(app.request(path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})})).then(r=>r.json())).catch(()=>{if(!res.headersSent)res.writeHead(503).end();});return;}
      void listener(req,res);
    });
    await new Promise((r,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',r);});host.start();void (async()=>{try{const {legacyLookBootHook}=await load('apps/server/src/edge/body/migrate-looks.ts');await legacyLookBootHook(host,db,edge,dataDir,process.env,m=>console.error(m));}catch(e){console.error('[legacy-looks] failed:',e?.message??e);}try{const {retireResidentsBootHook}=await load('apps/server/src/retire-residents.ts');await retireResidentsBootHook(souls,db,host.worldId,dataDir,process.env,m=>console.error(m));}catch(e){console.error('[retire-residents] failed:',e?.message??e);}})(); // one-shot <dataDir>/legacy-looks.env (looks v2), <dataDir>/retire-residents.env (3.1.1)
    async function close(){if(closing)return;closing=true;brain.quiesce?.();
      // Stop the world clock FIRST: once the port is released another process may start on this data dir,
      // so this process must not advance or persist the clock frontier afterwards (two-writer frontier fault).
      host.stop();edge.comms?.close();void hub.closeClients('local server stopping');
      const closed=new Promise(r=>server.close(r));server.closeAllConnections?.();const pump=setInterval(()=>host.drainInputs(),10);
      const failures=[];
      try{await closed;for(const handle of [provisionBirths,socialInstallation,foodDelivery,shoreInstallation,kitchenInstallation])handle?.close();const outcomes=await Promise.allSettled([service.settled(),brain.settled?.(),...[provisionBirths,socialInstallation,foodDelivery,shoreInstallation,kitchenInstallation].map(h=>h?.settled())]);for(const r of outcomes)if(r.status==='rejected')failures.push(r.reason);host.drainInputs();}finally{clearInterval(pump);}
      let snapshotSaved=false;
      try{host.stop();snapshotSaved=host.engine.canSnapshot?.()===true;if(snapshotSaved)host.saveSnapshot(true);else if(!db.db.prepare('SELECT 1 FROM clock_frontiers_v1 WHERE world_id=?').get(worldId))failures.push(Error('active-work-without-durable-frontier'));}
      finally{clearInterval(pump);await new Promise(r=>hub.wss.close(r));auth.close();if(db.db.isOpen)db.close();releaseLock();}
      if(failures.length)throw Error('local-expanded-close.installation-failed-resources-closed');return {snapshotSaved,activeNativeSnapshotRefused:!snapshotSaved};}

    return {cfg,pins,boot,db,host,auth,brain,souls,service,hub,server,edge,kitchenInstallation,shoreInstallation,foodDelivery,socialInstallation,close};
  } catch(error){host?.stop();server?.close();auth?.close();db.close();releaseLock();throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [descriptorPath,mode]=process.argv.slice(2);
  try {
    if(!descriptorPath)throw Error('usage: node tools/core/edge-server.mjs <descriptor.json> [check]');
    const d=JSON.parse(readFileSync(resolve(descriptorPath),'utf8')),flags=d.flags??{};
    const app=await openEdgeServerV1({input:d.input,dataDir:d.dataDir,worldId:d.worldId,port:Number(d.port),webDir:d.webDir,marsWebDir:d.marsWebDir,build:d.build??'local-edge/1',checkOnly:mode==='check',placeData:d.placeData,upperFloors:d.upperFloors,seedObjects:d.objects,inviteRequired:d.inviteRequired===true,skillFile:d.skillFile,cliFile:d.cliFile,instructionsFile:d.instructionsFile,accountAuth:flags.accountAuth===true,publicOrigin:d.publicOrigin,inputManifestSHA256:d.inputManifestSHA256,
      authoredBoundariesFile:d.authoredBoundariesFile,authoredBoundariesSHA256:d.authoredBoundariesSHA256,officeStairGuards:flags.officeStairGuards??false,ambient:d.ambient!==false,localSoulLimit:Number(d.localSoulLimit??9),humanRest:flags.humanRest??true,provisions:flags.provisions??true,sequences:flags.sequences??true,floorGoals:flags.floorGoals??true,kitchen:flags.kitchen??true,shore:flags.shore??true,foodDeliveryId:flags.foodDeliveryId,quietLandingCourtesy:flags.quietLandingCourtesy??true,social:flags.social??true,approachRetention:flags.approachRetention??true,closedGoals:flags.closedGoals??true,activateExpansion:flags.activateExpansion??true,nativePlaces:Array.isArray(d.nativePlaces)?d.nativePlaces:[],nav:d.nav??null,activitySpots:d.activitySpots});
    if(app.checkOnly)console.log(JSON.stringify(app,null,2));
    else {console.log(JSON.stringify({url:app.cfg.publicUrl,worldId:app.host.worldId,boot:app.boot,mindDriver:app.cfg.mindDriver,edge:'/v1/edge',places:app.edge.places.byId.size,build:app.cfg.build}));
      for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)).catch(()=>process.exit(1)));}
  }catch(error){console.error('Edge server refused:',error.message);process.exitCode=1;}
}
