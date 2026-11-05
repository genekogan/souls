import {PIP_PRESET} from './pip.ts';
import {MONSTER_PRESET,GHOST_PRESET,CENTAUR_PRESET,SHARED_BODY_BYTES} from './shared-bodies.ts';
import {mountBodyAuthoring} from './authoring.ts';
import {coreRevision,versionOf} from './core-revisions.ts';
import {BodyCollections,collectionPath,itemOf,LIBRARY_PAGE} from './collections.ts';
import type {Context,Hono} from 'hono';
import type {Entity} from '@sim/engine-contract';
import {EDGE_CONTRACT,EdgeError,edgeBody,type EdgeDeps, edgeErrorOf} from '../contract.ts';
import type {EdgeLedger} from '../ledger/ledger.ts';
import {admitBodyGLB,bindBodyDefinition,BodyAdmissionError,BODY_LIMITS} from './admission.ts';
import {LITTLE_MARTIANS_MOTION,MOTION_LIMITS} from '../../../../../mars/viewer/engine/bodies/motion.ts';
import {FLOATER_MODELS} from '../../../../../mars/viewer/engine/bodies/models.ts';
import {CREATURES,CREATURE_IDS,creatureBody} from '../../../../../mars/viewer/engine/bodies/creatures.ts';
import {addSchemaPart} from '../events/schema.ts';
import {intakeUpload,recordIntake} from '../../moderation/intake.ts';
import {moderationFor} from '../../moderation/store.ts';
import {BODY_UPLOAD_POLICY,UploadRejected} from '../../moderation/validate.ts';
import {randomInt,createHash} from 'node:crypto';
import {siteRequestOk} from '../../travel/travel.ts';
import {lookRequest,resolveLook,legacyPreset,LookError,HUMANOID_PARAMS,HUMANOID_REF,OUTFITS} from '../../../../web/src/humanoid/look.ts';

export const BODY_PRESETS=[{id:'humanoid',name:'Humanoid',body:null},PIP_PRESET,...FLOATER_MODELS.map(m=>{
  // Trusted flat aliases retain the same shipped bytes; placement roles stay in the world catalog.
  const modelUrl=`/world-assets/littlemartians/characters/${m.file.replace(/^kin\//,'')}`;
  return {id:m.id,name:m.name,body:{family:'floater',type:'ceramic',model:m.id,modelUrl,avatar:{kind:'body',modelUrl,bodyType:'ceramic'},radius:.35,hoverHeight:1.45,motion:structuredClone(LITTLE_MARTIANS_MOTION)} as Entity['body']};
}),
// Creatures (R11a): procedurally drawn animals with their own gait, speed and abilities (bodies/creatures.ts).
...CREATURE_IDS.map(id=>{const c=CREATURES[id];return {id,name:c.name,body:creatureBody(id) as Entity['body'],creature:{moves:c.moves,speed:c.speed,swims:c.swimSpeed!==null,swimSpeed:c.swimSpeed,settles:c.settles,cannot:c.cannot}};}),
// Shared authored examples (#722): appended so existing preset ids and order are unchanged.
MONSTER_PRESET,GHOST_PRESET,
// The compact centaur (#723): appended after them.
CENTAUR_PRESET];
const ASSET=/^body_[a-f0-9]{64}$/;
/** #795 A1: a core preset by id (`pip`) or by released version (`pip@1`). Versions name the authored, content-addressed
 *  presets only; the engine-native presets (humanoid, Martians, creatures) are selected by id. */
export function corePreset(ref:string){const r=coreRevision(ref);return r?BODY_PRESETS.find(p=>p.id===r.id):ref.includes('@')?undefined:BODY_PRESETS.find(p=>p.id===ref);}
/** The released version and content address of a core preset, when it has one: `{version:'pip@1', asset:'body_…'}`. */
export function coreVersion(id:string){const r=coreRevision(id);return r&&!id.includes('@')?{version:versionOf(r),asset:r.asset}:{};}
const MAX_UPLOAD_REQUEST=BODY_LIMITS.bytes+64*1024;

/** Read a bounded multipart request before invoking the platform's form parser. */
async function uploadForm(c:Context){
  const length=c.req.header('content-length');if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_UPLOAD_REQUEST))throw new EdgeError(413,'body.too-large','Body upload exceeds 4 MiB plus form metadata');
  if(!/^multipart\/form-data\s*;/i.test(c.req.header('content-type')??''))throw new EdgeError(400,'body.multipart','Use multipart model and manifest fields');
  const reader=c.req.raw.body?.getReader();if(!reader)throw new EdgeError(400,'body.multipart','Missing upload');
  const parts:Uint8Array[]=[];let size=0;
  try {for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>MAX_UPLOAD_REQUEST){await reader.cancel();throw new EdgeError(413,'body.too-large','Body upload exceeds 4 MiB plus form metadata');}parts.push(r.value);}}
  finally{reader.releaseLock();}
  const bytes=Buffer.concat(parts,size);
  try{return await new Request(c.req.url,{method:'POST',headers:{'content-type':c.req.header('content-type')!},body:bytes}).formData();}
  catch{throw new EdgeError(400,'body.multipart','Malformed multipart form');}
}

/** #717: another world's admitted bytes, read once through the launcher's allowlisted site path (4 MiB cap). */
/** `source` is the definition's source world: its stable world id (the launcher resolves it to the world's current slug). */
export type BodySite={key?:string;pull?:(source:string,ref:string)=>Promise<Uint8Array|null>};
export const BODY_PULL_LIMIT=BODY_LIMITS.bytes;
export function launcherBodySite(url:string|undefined,key:string|undefined):BodySite{
  return {key,pull:url&&key?async(source,ref)=>{
    const r=await fetch(`${url}/__sim/site/body/${source}/${ref}.glb`,{headers:{'x-sim-site-key':key},signal:AbortSignal.timeout(30_000)});
    if(!r.ok||r.headers.get('content-type')!=='model/gltf-binary')return null;
    const reader=r.body?.getReader();if(!reader)return null;const parts:Uint8Array[]=[];let n=0;
    for(;;){const c=await reader.read();if(c.done)break;n+=c.value.length;if(n>BODY_PULL_LIMIT){await reader.cancel();return null;}parts.push(c.value);}
    return Buffer.concat(parts,n);
  }:undefined};
}
/** A carried body reference resolved at a destination world (#795): the body to wear, and, when its bytes are not here
 *  yet, the pull to run once the arriving Soul is ready to change bodies. A refusal names its code. */
export type BodyRefResolution={ok:true;body:Entity['body'];fetch?:()=>Promise<{ok:true}|{ok:false;code:string;reason:string}>}|{ok:false;code:string;reason:string};
/** Per world host: resolve a carried `body_<sha>` reference for its owner, by the same rules as PUT /v1/edge/body {ref}. */
export const bodyRefResolvers=new WeakMap<object,(ref:string,owner:string)=>BodyRefResolution>();
export function mountBodyRoutes(app:Hono,deps:EdgeDeps&{ledger:EdgeLedger;bodySite?:BodySite}){
  const db=deps.db.db,world=deps.host.worldId;
  const moderation=moderationFor(db,world);
  const available=!!deps.host.engine.assignBodyV1&&!!deps.host.engine.bodyAssignmentProblemV1;
  const prefix=deps.souls.cfg.worldPath?.replace(/\/$/,'')??'';
  const types=available?(deps.souls.cfg.bodyTypes??['humanoid','ceramic','floater','creature']):[];
  deps.host.configureBodyTypesV1(types);
  mountBodyAuthoring(app,prefix,types);
  db.exec(`CREATE TABLE IF NOT EXISTS edge_body_assets_v1(world_id TEXT NOT NULL,asset_id TEXT NOT NULL,descriptor TEXT NOT NULL,content BLOB NOT NULL,PRIMARY KEY(world_id,asset_id)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS edge_body_owners_v1(world_id TEXT NOT NULL,owner TEXT NOT NULL,asset_id TEXT NOT NULL,descriptor TEXT NOT NULL,PRIMARY KEY(world_id,owner,asset_id)) WITHOUT ROWID;`);
  if(!(db.prepare('PRAGMA table_info(edge_body_owners_v1)').all() as {name:string}[]).some(c=>c.name==='descriptor')){
    db.exec('ALTER TABLE edge_body_owners_v1 ADD COLUMN descriptor TEXT');
    db.exec('UPDATE edge_body_owners_v1 SET descriptor=(SELECT a.descriptor FROM edge_body_assets_v1 a WHERE a.world_id=edge_body_owners_v1.world_id AND a.asset_id=edge_body_owners_v1.asset_id)');
  }
  // #717: cross-world collection membership and attribution (body-library/1). Import this world's owner uploads once,
  // idempotently; asset ids, descriptors and rights records are never rewritten, and no other world's database is read.
  // The source identity is the stable world id, never the public slug (a reslug keeps withdrawals and pulls working).
  const sharedPath=collectionPath(deps.souls.cfg as {bodyCollectionPath?:string;accountRegistryPath?:string}),here=world;
  const importOwn=(store:BodyCollections)=>{const rows=db.prepare('SELECT owner,asset_id,descriptor FROM edge_body_owners_v1 WHERE world_id=?').all(world) as {owner:string;asset_id:string;descriptor:string}[];
    store.recordAll(rows.map(r=>{const d=JSON.parse(r.descriptor);return {ref:r.asset_id,descriptor:d,creatorSoul:typeof d.creatorSoul==='string'?d.creatorSoul:'unrecorded',owner:r.owner,sourceWorld:here,license:String(d.license??'owned'),rightsConfirmed:d.rightsConfirmed===true};}),0);return store;};
  // A shared store that cannot open (corrupt, locked, unwritable) never stops this world: it keeps a local-only store.
  let library:BodyCollections,opened:BodyCollections|undefined;try{opened=new BodyCollections(sharedPath??db);library=importOwn(opened);}
  catch(e){try{opened?.close();}catch{/* already unusable */}console.error('[body] body.collection-store-unavailable: shared body collections unavailable; this world keeps a local-only store',e instanceof Error?e.message:'');library=importOwn(new BodyCollections(db));}
  /** Moderation, wherever the definition came from: this world's own hide/veto/quarantine and site-wide hides withdraw it
   *  here; the source world's withdrawal is written through to the shared store when it is appended. */
  const withdrawnHere=(ref:string)=>{const m=moderation.state(ref.slice(5));return m.hidden||m.creatorVeto||m.adminVeto||m.quarantined||moderation.isHidden(ref.slice(5));};
  const definition=(ref:string)=>{const d=library.definition(ref);if(!d)return d;const local=withdrawnHere(ref);
    if(d.sourceWorld===here){const status=local?'withdrawn':'active';if(status!==d.status){library.setStatus(ref,status);d.status=status;}}
    else if(local)d.status='withdrawn';
    return d;};
  moderation.appended.push(sha=>{const ref='body_'+sha;if(ASSET.test(ref))definition(ref);});
  /** A definition is visible by reference to its owner, and to everyone else only once the owner published it. Unpublished
   *  references answer exactly like unknown ones. */
  const visible=(d:{owner:string;public:boolean}|null,owner:string)=>!!d&&(d.owner===owner||d.public);
  const localBytes=(ref:string)=>!!SHARED_BODY_BYTES[ref]||!!db.prepare('SELECT 1 FROM edge_body_assets_v1 WHERE world_id=? AND asset_id=?').get(world,ref);
  const site=deps.bodySite??launcherBodySite(process.env.SIM_SITE_URL,process.env.SIM_SITE_KEY);
  /** Pull-through at selection, never on serve or observe: fetch the source world's admitted bytes, check the content
   *  address, re-admit under this world's policy, and cache them once (no owner row: the source owner's quota is unchanged). */
  async function pull(d:{ref:string;sourceWorld:string;descriptor:Record<string,unknown>}){
    const source=sourceKey(d.sourceWorld);if(!source||!site.pull)return false;
    const bytes=await site.pull(source,d.ref).catch(()=>null);if(!bytes||bytes.length>BODY_PULL_LIMIT)return false;
    if('body_'+createHash('sha256').update(bytes).digest('hex')!==d.ref)return false;
    const m=d.descriptor,manifest=Object.fromEntries(Object.entries({type:m.type,license:m.license,rightsConfirmed:true,rig:m.rig??undefined,actionProfile:m.actionProfile,motion:m.motion,name:m.name,description:m.description}).filter(([,v])=>v!==undefined&&v!==null));
    const admitted=admitBodyGLB(Buffer.from(bytes),manifest);if(admitted.assetId!==d.ref||!types.includes(admitted.type))return false;
    const asset={...admitted,rightsConfirmed:true,modelUrl:`${prefix}/v1/edge/body/assets/${d.ref}.glb`};
    db.prepare('INSERT OR IGNORE INTO edge_body_assets_v1 VALUES(?,?,?,?)').run(world,d.ref,JSON.stringify(asset),Buffer.from(bytes));return true;
  }
  // The world side of the launcher's body read path: this machine, the run's site key, never the public proxy; active
  // admitted bytes only.
  app.get('/v1/site/body/:file',c=>{
    if(!siteRequestOk(site.key,c.req.header('x-sim-site-key'),c.req.header('x-forwarded-for')))return c.json({ok:false,code:'not-found'},404);
    const file=c.req.param('file');if(!/^body_[a-f0-9]{64}\.glb$/.test(file))return c.json({ok:false,code:'not-found'},404);const ref=file.slice(0,-4),d=definition(ref);
    if(d?.status==='withdrawn')return c.json({ok:false,code:'body.withdrawn'},410);
    const row=db.prepare('SELECT content FROM edge_body_assets_v1 WHERE world_id=? AND asset_id=?').get(world,ref) as {content:Uint8Array}|undefined;if(!row)return c.json({ok:false,code:'not-found'},404);
    return c.body(new Uint8Array(row.content),200,{'Content-Type':'model/gltf-binary','Cache-Control':'no-store'});
  });
  const sourceKey=(sourceWorld:string)=>/^[a-z][a-z0-9-]{0,63}$/.test(sourceWorld)?sourceWorld:undefined;
  function selectable(d:{status:string;descriptor:Record<string,unknown>;ref:string;sourceWorld:string},pullable=true):{ok:true;pull?:true}|{ok:false;code:string;reason:string}{
    if(d.status==='withdrawn')return {ok:false,code:'body.withdrawn',reason:'This body definition was withdrawn and cannot be newly selected'};
    if(!types.includes(String(d.descriptor.type)))return {ok:false,code:'body.world-policy',reason:'This world does not admit that body type'};
    if(!localBytes(d.ref))return pullable&&site.pull&&sourceKey(d.sourceWorld)&&d.sourceWorld!==here?{ok:true,pull:true}:{ok:false,code:'body.source-unavailable',reason:'This body was admitted in another world and cannot be fetched here'};
    return {ok:true};
  }
  const bodyOfDefinition=(d:{ref:string;descriptor:Record<string,unknown>}):Entity['body']=>{const asset=d.descriptor as {type:string;actionProfile?:string;motion?:unknown},type=asset.type,modelUrl=`${prefix}/v1/edge/body/assets/${d.ref}.glb`;
    return {family:type==='humanoid'?'humanoid':'floater',type,model:d.ref,modelUrl,avatar:{kind:'body',modelUrl,bodyType:type},...(asset.actionProfile?{actionProfile:asset.actionProfile}:{}),...(type==='humanoid'?{}:{radius:.35,hoverHeight:1.45,...(asset.motion?{motion:asset.motion}:{})})} as Entity['body'];};
  // #795: travel carries a body reference; the destination resolves it here. Shared presets need no pull; other
  // definitions follow the ref rules (owner's own or published, active, admitted type) and pull only when asked to.
  bodyRefResolvers.set(deps.host,(ref,owner):BodyRefResolution=>{
    if(!ASSET.test(ref))return {ok:false,code:'body.ref-unknown',reason:'No body definition with that reference'};
    const preset=SHARED_BODY_BYTES[ref]?BODY_PRESETS.find(p=>(p.body as {model?:string}|null)?.model===ref):undefined;
    if(preset)return types.includes(preset.body?.type??preset.body?.family??'humanoid')?{ok:true,body:structuredClone(preset.body) as Entity["body"]}:{ok:false,code:'body.world-policy',reason:'This world does not admit that body type'};
    const d=definition(ref);if(!d||!visible(d,owner))return {ok:false,code:'body.ref-unknown',reason:'No body definition with that reference'};
    const ok=selectable(d);if(!ok.ok)return ok;
    return {ok:true,body:bodyOfDefinition(d),...(ok.pull?{fetch:async()=>{
      if(!deps.souls.limits.allow(`edge-body-pull-owner:${owner}`,2,60000).ok)return {ok:false,code:'rate-limited',reason:'At most two body fetches from other worlds per owner per minute'};
      if(!await pull(d))return {ok:false,code:'body.source-unavailable',reason:'The source world could not supply verified bytes for this body'};
      const again=selectable(definition(ref)??{...d,status:'withdrawn'},false);return again.ok?{ok:true}:again;}}:{})};
  });
  const wrap=(fn:(c:Context)=>unknown|Promise<unknown>)=>async(c:Context)=>{
    c.header('Cache-Control','no-store');try{return c.json(edgeBody(await fn(c) as object));}
    catch(e){if(e instanceof BodyAdmissionError)return c.json({contract:EDGE_CONTRACT,error:{code:e.code,message:e.message,...(e.details?{details:e.details}:{})}},400);
      if(e instanceof EdgeError)return c.json({contract:EDGE_CONTRACT,error:edgeErrorOf(e)},e.status as 400);
      console.error('[body] request failed',e instanceof Error?e.message:'unknown');return c.json({contract:EDGE_CONTRACT,error:{code:'body.unavailable',message:'Body admission is unavailable; retry'}},503);}
  };
  const current=(id:string)=>deps.host.engine.world.entities[id]?.body??null;
  const record=(id:string,owner:string)=>db.prepare('SELECT descriptor FROM edge_body_owners_v1 WHERE world_id=? AND owner=? AND asset_id=?').get(world,owner,id) as {descriptor:string}|undefined;
  /** core/humanoid@2: the look being worn (resolved params) and the choices an owner or Soul may set. */
  const lookOf=(body:Entity['body']|null|undefined)=>(body as {params?:unknown}|null|undefined)?.params?resolveLook((body as {params:unknown}).params):null;
  const lookChoices={...Object.fromEntries(Object.entries(HUMANOID_PARAMS).map(([k,f])=>[k,f.type==='enum'?f.values:f.type==='number'?{min:f.min,max:f.max}:f.type])),outfit:Object.keys(OUTFITS)};
  app.get('/v1/edge/body',wrap(c=>{const s=deps.soul(c);return {available,body:current(s.entityId),look:lookOf(current(s.entityId)),lookDef:HUMANOID_REF,lookChoices,types,presets:BODY_PRESETS.filter(p=>types.includes(p.body?.type??'humanoid')),limits:BODY_LIMITS,
    authoring:{skill:prefix+'/body-authoring/SKILL.md',contract:prefix+'/body-authoring/contract.json'},
    selection:{default:'humanoid',presets:'shared',uploads:'listed for their owner; by explicit ref once its owner publishes it (PUT /v1/edge/body/library/{ref}/public)',rediscover:'GET /v1/edge/body/library; use a preset id, your uploaded assetId, or a ref'},
    uploads:(db.prepare('SELECT descriptor FROM edge_body_owners_v1 WHERE world_id=? AND owner=? ORDER BY asset_id').all(world,s.owner) as {descriptor:string}[]).map(r=>JSON.parse(r.descriptor)),
    library:{mine:(()=>{try{return library.count(s.owner);}catch{return null;}})(),next:'GET /v1/edge/body/library?scope=mine'}};}));
  /** body-library/1: bounded, paginated discovery. core = the shared presets this world admits; mine = the caller owner's
   *  saved references across worlds. Lookup by explicit reference is public; save/forget change only the caller owner's collection. */
  app.get('/v1/edge/body/library',wrap(c=>{const s=deps.soul(c),scope=c.req.query('scope')??'mine',q=(c.req.query('q')??'').trim(),cursor=c.req.query('cursor')??'',limit=Number(c.req.query('limit')??LIBRARY_PAGE.defaultLimit);
    if(!['core','mine'].includes(scope))throw new EdgeError(400,'body.library-scope','scope is core or mine');
    if(q.length>LIBRARY_PAGE.maxQuery)throw new EdgeError(400,'body.library-query',`Search text is at most ${LIBRARY_PAGE.maxQuery} characters`);
    if(!Number.isInteger(limit)||limit<1||limit>LIBRARY_PAGE.maxLimit)throw new EdgeError(400,'body.library-limit',`limit is 1..${LIBRARY_PAGE.maxLimit}`);
    if(cursor.length>80)throw new EdgeError(400,'body.library-cursor','Unknown cursor');
    if(scope==='core'){const all=BODY_PRESETS.filter(p=>types.includes(p.body?.type??'humanoid')).filter(p=>!q||(p.name+' '+p.id).toLowerCase().includes(q.toLowerCase()));
      const start=cursor?all.findIndex(p=>p.id===cursor)+1:0;if(cursor&&start===0)throw new EdgeError(400,'body.library-cursor','Unknown cursor');
      const page=all.slice(start,start+limit);return {contract:'body-library/1',scope,items:page.map(p=>({ref:p.id,...coreVersion(p.id),name:p.name,type:p.body?.type??'humanoid',...((p.body as {actionProfile?:string}|null)?.actionProfile?{actionProfile:(p.body as {actionProfile:string}).actionProfile}:{})})),next:start+limit<all.length?page.at(-1)!.id:null};}
    return {contract:'body-library/1',scope,...library.mine(s.owner,{q:q||undefined,after:cursor||undefined,limit})};}));
  app.get('/v1/edge/body/library/:ref',wrap(c=>{const s=deps.soul(c),ref=c.req.param('ref')??'';
    const preset=corePreset(ref);if(preset)return {contract:'body-library/1',definition:{ref:preset.id,...coreVersion(preset.id),name:preset.name,type:preset.body?.type??'humanoid',core:true},selectable:types.includes(preset.body?.type??'humanoid')?{ok:true}:{ok:false,code:'body.world-policy',reason:'This world does not admit that body type'}};
    if(!ASSET.test(ref))throw new EdgeError(404,'body.ref-unknown','No body definition with that reference');
    const d=definition(ref);if(!d||!visible(d,s.owner))throw new EdgeError(404,'body.ref-unknown','No body definition with that reference');
    return {contract:'body-library/1',definition:{ref,...itemOf(d.descriptor),public:d.public,...(d.descriptor.motion?{motion:d.descriptor.motion}:{}),triangles:d.descriptor.triangles,bytes:d.descriptor.bytes,status:d.status,sourceWorld:d.sourceWorld,attribution:{creatorSoul:d.creatorSoul}},saved:library.saved(s.owner,ref),selectable:selectable(d)};}));
  app.put('/v1/edge/body/library/:ref',wrap(c=>{const s=deps.soul(c),ref=c.req.param('ref')??'';if(!ASSET.test(ref)||!visible(definition(ref),s.owner))throw new EdgeError(404,'body.ref-unknown','No body definition with that reference');
    library.save(s.owner,ref,s.soulId,Date.now());return {contract:'body-library/1',ref,saved:true};}));
  app.delete('/v1/edge/body/library/:ref',wrap(c=>{const s=deps.soul(c),ref=c.req.param('ref')??'';if(!ASSET.test(ref))throw new EdgeError(404,'body.ref-unknown','No body definition with that reference');
    library.forget(s.owner,ref);return {contract:'body-library/1',ref,saved:false};}));
  /** The owner publishes its own definition as a public reference (or stops): others may then look it up, save and wear it
   *  by explicit ref while it is not withdrawn. Unpublishing stops new lookups and selections; bodies already worn stay. */
  const publish=(on:boolean)=>wrap(c=>{const s=deps.soul(c),ref=c.req.param('ref')??'',d=ASSET.test(ref)?definition(ref):null;
    if(!d||!visible(d,s.owner))throw new EdgeError(404,'body.ref-unknown','No body definition with that reference');
    if(d.owner!==s.owner)throw new EdgeError(403,'body.not-owned','Only the owner can publish this body definition');
    library.setPublic(ref,on);return {contract:'body-library/1',ref,public:on,status:d.status};});
  app.put('/v1/edge/body/library/:ref/public',publish(true));app.delete('/v1/edge/body/library/:ref/public',publish(false));
  app.post('/v1/edge/body/uploads',wrap(async c=>{
    const s=deps.soul(c);if(!available)throw new EdgeError(503,'body.unavailable','This world engine cannot assign bodies');if(!deps.souls.limits.allow(`edge-body-upload:${s.soulId}`,2,60000).ok)throw new EdgeError(429,'rate-limited','At most two body uploads per minute');
    const form=await uploadForm(c);if(form.getAll('model').length!==1||form.getAll('manifest').length!==1)throw new EdgeError(400,'body.multipart','One model file and one manifest are required');
    const model=form.get('model'),raw=form.get('manifest');if(!model||typeof model==='string'||typeof raw!=='string'||raw.length>4096)throw new EdgeError(400,'body.multipart','One model file and one short JSON manifest are required');
    if(model.size>BODY_LIMITS.bytes)throw new EdgeError(413,'body.too-large','Body GLB exceeds 4 MiB');
    let manifest:unknown;try{manifest=JSON.parse(raw);}catch{throw new EdgeError(400,'body.manifest','Manifest must be JSON');}
    // G8 moderation: one gate for every upload (format, budgets, malformed files, metadata stripped, classifier)
    const intake=await intakeUpload(moderation,bindBodyDefinition(Buffer.from(await model.arrayBuffer()),manifest),{surface:'body',policy:BODY_UPLOAD_POLICY,words:[model.name],actor:s.owner}).catch(e=>{if(e instanceof UploadRejected)throw new EdgeError(e.status,e.code,e.message);throw e;});
    const bytes=Buffer.from(intake.upload.bytes),admitted=admitBodyGLB(bytes,manifest);
    if(!types.includes(admitted.type))throw new EdgeError(403,'body.world-policy','This world does not admit that body type');
    const asset={...admitted,rightsConfirmed:true,modelUrl:`${prefix}/v1/edge/body/assets/${admitted.assetId}.glb`};
    // Recheck bearer after parsing/admission: revoked tokens cannot publish assets.
    const again=deps.soul(c);if(again.soulId!==s.soulId||again.owner!==s.owner)throw new EdgeError(401,'unauthorized','Body owner changed during upload');
    const existing=db.prepare('SELECT 1 FROM edge_body_owners_v1 WHERE world_id=? AND owner=? AND asset_id=?').get(world,s.owner,asset.assetId);
    const quota=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(length(a.content)),0) bytes FROM edge_body_owners_v1 o JOIN edge_body_assets_v1 a USING(world_id,asset_id) WHERE world_id=? AND owner=?').get(world,s.owner) as {n:number;bytes:number};
    if(!existing&&(quota.n>=8||quota.bytes+bytes.length>64*1024*1024))throw new EdgeError(409,'body.storage-limit','This owner already has the maximum admitted body storage');
    db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT OR IGNORE INTO edge_body_assets_v1 VALUES(?,?,?,?)').run(world,asset.assetId,JSON.stringify(asset),bytes);db.prepare('INSERT INTO edge_body_owners_v1(world_id,owner,asset_id,descriptor) VALUES(?,?,?,?) ON CONFLICT(world_id,owner,asset_id) DO UPDATE SET descriptor=excluded.descriptor').run(world,s.owner,asset.assetId,JSON.stringify(asset));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    recordIntake(moderation,intake,{surface:'body',actor:s.owner});
    try{library.record({ref:asset.assetId,descriptor:asset,creatorSoul:s.soulId,owner:s.owner,sourceWorld:here,license:String(asset.license),rightsConfirmed:true},Date.now());}
    catch(e){console.error('[body] body.collection-record-failed: the upload is stored; its collection entry is imported at the next boot',e instanceof Error?e.message:'');}
    return {asset,moderation:{...moderation.state(intake.upload.sha),classifier:intake.verdict.classifier,labels:intake.verdict.labels,stripped:intake.upload.stripped}};
  }));
  app.put('/v1/edge/body',wrap(async c=>{const s=deps.soul(c);return assign(s,await c.req.json().catch(()=>null),true);}));
  // The owner's look editor (SoulCard): the same look request for one of the signed-in owner's Souls.
  if(deps.ownerSoul)app.put('/v1/souls/:id/look',wrap(async c=>{const s=await deps.ownerSoul!(c,c.req.param('id')??'');return assign(s,{look:await c.req.json().catch(()=>null)},false);}));
  /** Assign a body to Soul `s`: by its own token (`tokenBound`: the token must still be the one that asked) or by its owner. */
  async function assign(s:{soulId:string;entityId:string;owner:string;name:string},raw:any,tokenBound:boolean){
    const source=deps.db.soul(s.soulId);if(!source)throw new EdgeError(401,'unauthorized','Soul owner is unavailable');if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==1)throw new EdgeError(400,'body.assignment','Choose exactly one preset, assetId or look');
    let body:Entity['body']|null,fetchFirst:{ref:string;sourceWorld:string;descriptor:Record<string,unknown>;status:string}|null=null;
    if(typeof raw.preset==='string'){const preset=corePreset(raw.preset);if(!preset)throw new EdgeError(400,'body.preset-unknown','Unknown body preset');body=preset.body;}
    else if(typeof raw.assetId==='string'&&ASSET.test(raw.assetId)){
      if(!db.prepare('SELECT 1 FROM edge_body_owners_v1 WHERE world_id=? AND owner=? AND asset_id=?').get(world,s.owner,raw.assetId))throw new EdgeError(403,'body.not-owned','This upload does not belong to the Soul owner');
      const row=record(raw.assetId,s.owner);if(!row)throw new EdgeError(404,'body.asset-not-found','No admitted body asset');const asset=JSON.parse(row.descriptor);
      const type=asset.type,modelUrl=asset.modelUrl;body={family:type==='humanoid'?'humanoid':'floater',type,model:asset.assetId,modelUrl,avatar:{kind:'body',modelUrl,bodyType:type},...(asset.actionProfile?{actionProfile:asset.actionProfile}:{}),...(type==='humanoid'?{}:{radius:.35,hoverHeight:1.45,...(asset.motion?{motion:asset.motion}:{})})};
    }else if(typeof raw.ref==='string'&&ASSET.test(raw.ref)){ // #717: an explicit public definition reference
      const d=definition(raw.ref);if(!d||!visible(d,s.owner))throw new EdgeError(404,'body.ref-unknown','No body definition with that reference');
      const ok=selectable(d);if(ok.ok&&ok.pull)fetchFirst=d;   // bytes move only after authority, safety and the throttle pass (below)
      if(!ok.ok)throw new EdgeError(ok.code==='body.world-policy'?403:409,ok.code,ok.reason);
      body=bodyOfDefinition(d);
    }else if(raw.look!==undefined){ // core/humanoid@2: edits over the current look (today's look when none), a preset, or {random:true,seed?}
      try{body=lookRequest(current(s.entityId),raw.look,{preset:legacyPreset(s.entityId)},()=>randomInt(0,2**32-1)) as Entity['body'];}
      catch(e){if(e instanceof LookError)throw new EdgeError(400,'body.look',e.message);throw e;}
    }else throw new EdgeError(400,'body.assignment','Choose a preset, admitted assetId, ref or look');
    if(!types.includes(body?.type??body?.family??'humanoid'))throw new EdgeError(403,'body.world-policy','This world does not admit that body type');
    const authority=():true=>{const row=deps.db.soul(s.soulId),mind=deps.host.minds.get(s.soulId);
      if(!row||row.retired_at!==null||row.owner!==source.owner||row.world_id!==world||row.entity_id!==s.entityId||(tokenBound&&row.token_hash!==source.token_hash)||!mind||mind.owner!==row.owner||mind.entityId!==row.entity_id)throw new EdgeError(401,'unauthorized','Soul authority changed before body assignment');
      return true;};
    authority();deps.ledger.ownerControlGrace(s.soulId);
    const guard=():true=>{authority();
      // a faded Soul (an hour without an accepted action) has no commitment to finish: tell its owner the real way back
      if(!deps.host.quietBarrier&&deps.ledger.faded.has(s.soulId))throw new EdgeError(409,'body.safe-standing-required','This Soul has faded from the world; act once (any accepted action) to bring it back, then change its body');
      if(deps.host.quietBarrier||!deps.ledger.bodyAssignmentReady(s))throw new EdgeError(409,'body.safe-standing-required','Finish the current commitment before changing bodies');
      if(!deps.host.engine.bodyAssignmentProblemV1)throw new EdgeError(503,'body.unavailable','This engine cannot assign bodies');
      const issue=deps.host.engine.bodyAssignmentProblemV1(s.entityId,body);if(issue)throw new EdgeError(409,issue,'Finish safely standing with free hands and clear space before changing bodies');return true;
    };
    guard();
    if(fetchFirst){const d=fetchFirst;
      if(!deps.souls.limits.allow(`edge-body-pull:${s.soulId}`,2,60000).ok)throw new EdgeError(429,'rate-limited','At most two body fetches from other worlds per minute');
      if(!await pull(d))throw new EdgeError(409,'body.source-unavailable','The source world could not supply verified bytes for this body');
      const again=selectable(definition(d.ref)??{...d,status:'withdrawn'},false);if(!again.ok)throw new EdgeError(again.code==='body.world-policy'?403:409,again.code,again.reason);
      guard();}
    if(JSON.stringify(current(s.entityId))===JSON.stringify(body))return {body:current(s.entityId),changed:false};
    const event=await deps.host.enqueueChecked('body-assignment-v1','world:body',{contract:'body-assignment/1',worldId:world,soulId:s.soulId,entityId:s.entityId,body:structuredClone(body)},guard,()=>true);
    deps.ledger.invalidateBodies();return {body:current(s.entityId),changed:true,tick:event.tick,seq:event.seq};
  }
  app.get('/v1/edge/body/assets/:file',async c=>{
    const file=c.req.param('file');if(!/^body_[a-f0-9]{64}\.glb$/.test(file))return c.notFound();
    const shared=SHARED_BODY_BYTES[file.slice(0,-4)];if(shared){try{return c.body(new Uint8Array(await shared()),200,{'Content-Type':'model/gltf-binary','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});}catch{return c.body('Shared body is temporarily unavailable',503);}}
    const row=db.prepare('SELECT content FROM edge_body_assets_v1 WHERE world_id=? AND asset_id=?').get(world,file.slice(0,-4)) as {content:Uint8Array}|undefined;if(!row)return c.notFound();
    return c.body(new Uint8Array(row.content),200,{'Content-Type':'model/gltf-binary','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"});
  });
  addSchemaPart('body',{contract:'body/1',types:['humanoid','ceramic','floater','creature'],creatures:CREATURE_IDS,limits:BODY_LIMITS,endpoints:['GET /v1/edge/body','POST /v1/edge/body/uploads (multipart model+manifest)','PUT /v1/edge/body (preset|assetId|ref|look)','GET /v1/edge/body/library?scope=core|mine&q&cursor&limit','GET|PUT|DELETE /v1/edge/body/library/:ref','PUT /v1/souls/:id/look (the owner: a look request)'],rig:'quaternius/1',motion:{contract:'body-motion/1',limits:MOTION_LIMITS,localAuthoring:'/body-authoring/SKILL.md'},look:{def:HUMANOID_REF,choices:lookChoices,random:'{look:{random:true,seed?}}',edit:'{look:{key:value,...}} over the current look',outfit:'{look:{outfit:<id>}} sets top, bottom, shoes and their colours',outfits:Object.keys(OUTFITS)},safeSwap:'Standing, idle, free hands and no carriers/paired/construction commitments'});
}
