import {hashOf} from '@souls/engine-contract';
import {realpathSync} from 'node:fs';
import {hasFreshAttributionProof,type AttributionAccountIdentity} from '../auth.ts';
import {AccountStore,AccountStoreError,type AccountIdentity,type ApprovalDTO} from './store.ts';
import {tx,afterCommit} from '../edge/comms/store.ts';
import {ApiError,type Souls} from '../souls.ts';
import type {WorldHost} from '../world.ts';
import type {SoulRow} from '../db.ts';
/** Shared account associations; canonical birth ownership is never rewritten. */
export class WorldAccounts {
 readonly host:WorldHost;readonly souls:Souls;readonly store:AccountStore;
 private approving=new Set<string>();
 constructor(host:WorldHost,souls:Souls){
  if(host.db!==souls.db||host!==souls.host)throw Error('Account authority requires the same world and database');
  this.host=host;this.souls=souls;this.store=new AccountStore({db:host.db.db,tx:fn=>tx(host.db.db,fn,{immediate:!host.db.db.isTransaction})},host.worldId,{nameTaken:name=>!!host.db.soulByName(host.worldId,name)});
  for(const row of host.db.liveSouls(host.worldId))if(row.token_hash)this.store.captureLegacyAuthority(row.id,row.owner);
 }
 owns(accountId:string,row:SoulRow){if(row.world_id!==this.host.worldId)return false;const member=this.host.db.db.prepare('SELECT account_id FROM account_soul_memberships_v1 WHERE world_id=? AND soul_id=?').get(this.host.worldId,row.id) as {account_id:string}|undefined;const validLegacyOwner=row.owner===accountId&&row.token_hash!==null&&this.store.legacyAuthority(row.id,accountId);return member?member.account_id===accountId||validLegacyOwner:row.owner===accountId&&(!accountId.startsWith('dev:')||validLegacyOwner);}
 rows(accountId:string){return this.host.db.liveSouls(this.host.worldId).filter(row=>this.owns(accountId,row));}
 associationIds(accountId:string){return (this.host.db.db.prepare('SELECT soul_id FROM account_soul_memberships_v1 WHERE world_id=? AND account_id=?').all(this.host.worldId,accountId) as {soul_id:string}[]).map(row=>row.soul_id);}
 verifySession(identity:AccountIdentity){this.store.registerIdentity(identity);this.syncCanonical(identity);}
 pairingEligible(row:SoulRow,issuer:string){const user=this.host.db.user(issuer);return this.store.recordedAccount(issuer)&&!!user&&(this.owns(issuer,row)||user.role==='admin');}
 rotateLegacy(row:SoulRow,tokenHash:string,label:string|null,keepPairCode?:string){this.store.db.tx(()=>{this.store.invalidateSoul(row.id,row.owner,'legacy-pair-rotation');this.host.db.setSoulToken(row.id,tokenHash,label);afterCommit(this.host.db.db,()=>this.souls.invalidatePairings(row.id,keepPairCode));});}
 revoke(identity:AccountIdentity,soulId:string){const row=this.host.db.soul(soulId);if(!row||!this.owns(identity.id,row))throw new ApiError(403,'forbidden','Not your Soul.');this.store.db.tx(()=>{this.store.revoke(identity,soulId);this.store.invalidateSoul(soulId,row.owner,'account-revoke');this.host.db.setSoulToken(soulId,null);afterCommit(this.host.db.db,()=>this.souls.invalidatePairings(soulId));});}
 releaseAgent(token:string){const credential=this.souls.agentCredential(token);if(!credential)throw new ApiError(401,'unauthorized','Invalid Soul credential.');this.store.db.tx(()=>{this.store.invalidateSoul(credential.row.id,credential.row.owner,'agent-release');this.host.db.setSoulToken(credential.row.id,null,null,'released');afterCommit(this.host.db.db,()=>this.souls.invalidatePairings(credential.row.id));});}
 canCreate(accountId:string){return this.approving.has(accountId);}
 /** Existing recorded provider ownership is exact identity evidence, unlike a
  * matching display name/email or a dev identity from the same computer. */
 syncCanonical(identity:AccountIdentity){const associated=new Set(this.associationIds(identity.id));for(const row of this.host.db.soulsOf(identity.id)){if(row.world_id!==this.host.worldId||associated.has(row.id)||!this.souls.controlReady(row))continue;
  const first=this.host.db.db.prepare("SELECT seq FROM events WHERE world_id=? AND kind='birth' AND json_extract(payload,'$.soulId')=? ORDER BY seq LIMIT 1").get(this.host.worldId,row.id) as {seq:number}|undefined,birth=first?this.host.db.events(this.host.worldId,first.seq-1,1)[0]:undefined;
  if(!birth||birth.payload.owner!==identity.id||birth.payload.entityId!==row.entity_id)continue;
  this.store.associate(identity,row.id,{attribution:'recorded-provider-owner',evidenceHash:hashOf(birth)});
 }}
 reconcile(id:string){const allocation=this.store.allocation(id);if(!allocation)return;
  const row=this.host.db.soul(allocation.soulId);if(!row||row.world_id!==this.host.worldId||!this.owns(allocation.accountId,row))throw new AccountStoreError('projection-conflict','Soul association unavailable');
  const op=allocation.requestId.startsWith('lc_')?this.souls.lifecycle?.journal.operationInWorld(this.host.worldId,allocation.requestId):undefined;
  if(op){if(op.scope.owner!==row.owner||op.scope.entityId!==row.entity_id)throw new AccountStoreError('projection-conflict','Creation identity changed');this.store.reconcile(id,{...allocation,lifecycleState:op.state,ready:op.state==='complete'&&this.souls.controlReady(row)});}
  else if(allocation.requestId.startsWith('ar_'))this.store.reconcile(id,{...allocation,lifecycleState:'legacy-ready',ready:this.souls.controlReady(row)});
  else throw new AccountStoreError('projection-conflict','Actual creation receipt unavailable');
 }
 view(identity:AccountIdentity,id:string){this.store.view(id,identity);this.reconcile(id);return this.store.view(id,identity);}
 approve(identity:AccountIdentity,id:string){
  this.verifySession(identity);
  const user=this.host.db.user(identity.id);if(!user)throw new ApiError(401,'unauthorized','Sign in first.');this.souls.requireInvited(user);
  const dto=this.store.db.tx(()=>{const wasPending=this.store.view(id,identity).status==='pending';const dto=this.store.approve(identity,id,input=>{
   if(input.mode==='repair'){const row=input.soulId?this.host.db.soul(input.soulId):undefined;if(!row||!this.owns(identity.id,row)||row.retired_at!==null)throw new ApiError(403,'forbidden','Not your Soul.');/* lane PAIR-INWINDOW: the request carries the Soul's name read at request time; identity is the ID, so a rename since then never fails a pressed Approve */return {worldId:this.host.worldId,accountId:identity.id,requestId:input.requestId,soulId:row.id};}
   if(!this.souls.lifecycle)throw new ApiError(503,'arrival-unavailable','Account arrivals are unavailable in this world.');
   this.approving.add(identity.id);let op;try{op=this.souls.acceptLifecycleCreate(identity.id,{name:input.name,...(input.description?{description:input.description}:{})},input.requestId);}finally{this.approving.delete(identity.id);}
   return {worldId:this.host.worldId,accountId:identity.id,requestId:op.requestId,soulId:op.scope.soulId};
  });if(wasPending&&dto.mode==='repair'&&dto.soulId&&['creating','ready'].includes(dto.status)){const row=this.host.db.soul(dto.soulId)!;this.host.db.setSoulToken(dto.soulId,null,null,'replaced');this.host.db.db.prepare('UPDATE account_legacy_authority_v1 SET revoked_at=COALESCE(revoked_at,?),revoked_reason=COALESCE(revoked_reason,?) WHERE world_id=? AND soul_id=?').run(Date.now(),'account-repair',this.host.worldId,row.id);afterCommit(this.host.db.db,()=>this.souls.invalidatePairings(row.id));}return dto;});this.reconcile(dto.id);return this.store.view(dto.id,identity);
 }
 /** LINK (birth on approve): the owner never waits on `creating`. The accepted lifecycle birth is settled inside the approve
  * request (inputs drained, the runner pumped) so the answer is `ready` with the body standing at the arrival point. A world
  * that cannot settle within `maxMs` (a deferred admission) still answers `creating`; old clients keep polling as before. */
 async approveSettled(identity:AccountIdentity,id:string,maxMs=5000){
  let dto=this.approve(identity,id);if(dto.status!=='creating')return dto;
  const deadline=Date.now()+maxMs;
  for(let i=0;dto.status==='creating'&&Date.now()<deadline;i++){
   try{this.host.drainInputs();}catch{/* a clock not ready yet: the served loop settles it */}
   this.souls.lifecycle?.pump();
   await new Promise<void>(r=>i<40?setImmediate(r):setTimeout(r,20));
   this.reconcile(id);dto=this.store.view(id,identity);
  }
  return dto;
 }
 poll(id:string,secret:string){
  // Validate the secret before reading private allocation/lifecycle scope.
  this.store.poll(id,secret);this.reconcile(id);const out=this.store.poll(id,secret);
  if(out.token){const row=this.host.db.soul(out.soulId!);if(!row||!this.souls.controlReady(row))throw new AccountStoreError('not-ready','The Soul is not ready.');}
  return out;
 }
 /** Only a source-reviewed attribution manifest and verified provider identity
  * may call this helper. Name/bio or caller-supplied email is never attribution. */
 associateAttributed(identity:AttributionAccountIdentity,input:{worldId:string;dbPath:string;soulId:string;entityId:string;birthSeq:number;birthHash:string;evidenceHash:string;verifiedSubject:string;verifiedEmail:string}){
  if(!hasFreshAttributionProof(identity)||identity.subject!==input.verifiedSubject||identity.verifiedEmail!==input.verifiedEmail.toLowerCase()||input.worldId!==this.host.worldId||realpathSync(this.host.db.path)!==realpathSync(input.dbPath))throw new ApiError(403,'forbidden','Verified attribution identity or public lineage differs.');
  const row=this.host.db.soul(input.soulId),event=this.host.db.events(this.host.worldId,input.birthSeq-1,1)[0];
  if(!row||row.entity_id!==input.entityId||row.native||!event||event.kind!=='birth'||event.payload.soulId!==row.id||event.payload.entityId!==row.entity_id||event.payload.owner!==row.owner||event.payload.owner==='system'||hashOf(event)!==input.birthHash)throw new ApiError(409,'attribution-unconfirmed','Historical creation attribution differs.');
  return this.store.associate(identity,row.id,{attribution:'reviewed-historical-creator',evidenceHash:input.evidenceHash});
 }
}
