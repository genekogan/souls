import {createHash} from 'node:crypto';
import {soulProfileFactV1Schema,soulProfileUpdateSchema,type SoulProfileFactV1} from '@souls/protocol';
import {checkAcceptanceGuard,type AcceptanceGuard,type WorldHost} from './world.ts';
import {ApiError,type Souls} from './souls.ts';
import {validateProfilePNG} from './profile-png.ts';

/** Local content-addressed portrait bytes; no filesystem URL or remote fetch. */
export function ensureSoulProfileSchema(host:WorldHost){host.db.db.exec(`
 CREATE TABLE IF NOT EXISTS soul_profile_photos_v1(world_id TEXT NOT NULL,soul_id TEXT NOT NULL,hash TEXT NOT NULL,image BLOB NOT NULL,PRIMARY KEY(world_id,soul_id,hash)) WITHOUT ROWID;
`);}
export class SoulProfiles {
 readonly host:WorldHost;
 readonly souls:Souls;
 constructor(host:WorldHost,souls:Souls){this.host=host;this.souls=souls;ensureSoulProfileSchema(host);}
 private owned(owner:string,id:string){const row=this.host.db.soul(id),user=this.host.db.user(owner);
  if(!user)throw new ApiError(401,'unauthorized','sign in first');this.souls.requireInvited(user);
  if(!row||row.retired_at!==null||row.world_id!==this.host.worldId)throw new ApiError(404,'not-found','no such soul');
  if(!this.souls.owns(owner,row))throw new ApiError(403,'forbidden','not your soul');this.souls.requireControlReady(row);return row;
 }
 view(id:string){const row=this.host.db.soul(id);if(!row||row.retired_at!==null||row.world_id!==this.host.worldId)throw new ApiError(404,'not-found','no such soul');
  return {contract:'soul-profile/1',soulId:id,name:row.name,description:row.description,revision:this.host.profileFact(id)?.revision??0,photo:this.host.profilePhoto(id),photoSource:this.host.profilePhotoSource(id)};
 }
 async update(owner:string,id:string,input:unknown,authority?:AcceptanceGuard){if(authority)checkAcceptanceGuard(authority);const parsed=soulProfileUpdateSchema.safeParse(input);if(!parsed.success)throw new ApiError(400,'invalid','name or description and optional expectedRevision required');
  const row=this.owned(owner,id),old=this.host.profileFact(id),revision=old?.revision??0,p=parsed.data;
  if(p.expectedRevision!==undefined&&p.expectedRevision!==revision)throw new ApiError(409,'profile-conflict','profile changed; refresh it first');
  const limit=this.souls.limits.allow(`profile:${owner}`,30,3600000);if(!limit.ok)throw new ApiError(429,'rate-limited','too many profile edits',{retry_after:limit.retryAfter});
  const name=p.name??row.name,description=p.description??row.description;
  if(name===row.name&&description===row.description)return this.view(id);
  const fact=soulProfileFactV1Schema.parse({contract:'soul-profile/1',worldId:this.host.worldId,soulId:id,entityId:row.entity_id,owner:row.owner,
   fromRevision:revision,revision:revision+1,fromName:row.name,birthName:old?.birthName??row.name,name,description,photo:old?.photo??null});
  await this.commit(owner,fact,undefined,authority);if(authority)checkAcceptanceGuard(authority);return this.view(id);
 }
 async photo(owner:string,id:string,input:unknown,authority?:AcceptanceGuard){if(authority)checkAcceptanceGuard(authority);if(!input||typeof input!=='object'||Object.keys(input).some(k=>k!=='dataUrl'||!Object.hasOwn(input,k)))throw new ApiError(400,'invalid','body must be {dataUrl}');
  this.owned(owner,id);const limit=this.souls.limits.allow(`profile-photo:${owner}`,12,3600000);if(!limit.ok)throw new ApiError(429,'rate-limited','too many portrait uploads',{retry_after:limit.retryAfter});let png:ReturnType<typeof validateProfilePNG>;try{png=validateProfilePNG((input as {dataUrl?:unknown}).dataUrl);}catch{throw new ApiError(400,'invalid-photo','Use an 8-bit RGB/RGBA PNG, at most 512px and 256KiB.');}
  const row=this.owned(owner,id),old=this.host.profileFact(id),revision=old?.revision??0;
  if(old?.photo?.hash===png.photo.hash)return this.view(id);
  const fact=soulProfileFactV1Schema.parse({contract:'soul-profile/1',worldId:this.host.worldId,soulId:id,entityId:row.entity_id,owner:row.owner,
   fromRevision:revision,revision:revision+1,fromName:row.name,birthName:old?.birthName??row.name,name:row.name,description:row.description,photo:png.photo});
  await this.commit(owner,fact,png.image,authority);if(authority)checkAcceptanceGuard(authority);return this.view(id);
 }
 /** Back to the automatic portrait: the owner's uploaded photo is withdrawn (a new profile revision with no photo). */
 async clearPhoto(owner:string,id:string,authority?:AcceptanceGuard){if(authority)checkAcceptanceGuard(authority);
  const row=this.owned(owner,id),old=this.host.profileFact(id),revision=old?.revision??0;if(!old?.photo)return this.view(id);
  const limit=this.souls.limits.allow(`profile-photo:${owner}`,12,3600000);if(!limit.ok)throw new ApiError(429,'rate-limited','too many portrait changes',{retry_after:limit.retryAfter});
  const fact=soulProfileFactV1Schema.parse({contract:'soul-profile/1',worldId:this.host.worldId,soulId:id,entityId:row.entity_id,owner:row.owner,
   fromRevision:revision,revision:revision+1,fromName:row.name,birthName:old.birthName??row.name,name:row.name,description:row.description,photo:null});
  await this.commit(owner,fact,undefined,authority);if(authority)checkAcceptanceGuard(authority);return this.view(id);
 }
 private async commit(owner:string,fact:SoulProfileFactV1,image?:Buffer,authority?:AcceptanceGuard){
  const guard=()=>{if(authority)checkAcceptanceGuard(authority);const row=this.owned(owner,fact.soulId),m=this.host.minds.get(row.id),body=this.host.engine.world.entities[row.entity_id],thing=this.host.kernel.things[row.id];
   if(row.entity_id!==fact.entityId||row.name!==fact.fromName||(this.host.profileFact(row.id)?.revision??0)!==fact.fromRevision)
    throw new ApiError(409,'profile-conflict','profile changed; refresh it first');
   if(m?.owner!==row.owner||m.name!==row.name||m.description!==row.description||body?.human?.soul!==row.id||body.label!==row.name||thing?.name!==row.name||thing.traits.body!==row.entity_id||thing.traits.about!==row.description
    ||Number(thing.traits.soulProfileRevisionV1??0)!==fact.fromRevision)throw new ApiError(409,'not-in-world','profile correspondence unavailable');
   const collision=this.host.db.soulByName(this.host.worldId,fact.name);if(collision&&collision.id!==fact.soulId)throw new ApiError(409,'name-taken','that name is already used in this world');
   return true as const;
  };
  guard();await this.host.enqueueChecked('rules',`soul:${fact.soulId}`,{soulProfileV1:fact},guard,()=>{
   const changed=this.host.db.db.prepare('UPDATE souls SET name=?,description=? WHERE id=? AND world_id=? AND owner=? AND retired_at IS NULL').run(fact.name,fact.description,fact.soulId,fact.worldId,fact.owner);if(Number(changed.changes)!==1)throw Error('soul-profile.journal-no-update');
   if(image&&fact.photo)this.host.db.db.prepare('INSERT OR IGNORE INTO soul_profile_photos_v1(world_id,soul_id,hash,image) VALUES(?,?,?,?)').run(fact.worldId,fact.soulId,fact.photo.hash,image);
   return true;
  });
 }
 /** Set by AutoPortraits: an automatic portrait's bytes by hash. */
 autoBytes?:(id:string,hash:string)=>Uint8Array|null;
 photoBytes(id:string,hash:string){const row=this.host.db.soul(id);if(!row||row.world_id!==this.host.worldId||row.retired_at!==null||!/^[a-f0-9]{64}$/.test(hash))return null;
  const bytes=(this.host.db.db.prepare('SELECT image FROM soul_profile_photos_v1 WHERE world_id=? AND soul_id=? AND hash=?').get(this.host.worldId,id,hash) as {image:Uint8Array}|undefined)?.image??this.autoBytes?.(id,hash)??undefined;return bytes&&createHash('sha256').update(bytes).digest('hex')===hash?bytes:null;
 }
}
