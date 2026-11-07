import {decodeSceneCapturePublication} from '@souls/protocol/scene-capture';
import {detachedData} from './owned-live-chunks.ts';
import {CURRENT_UNDERSTORY_CAPTURE_HASHES,LIVE_NATIVE_SOCIAL_CAPTURE_HASHES} from '../../../mars/viewer/app/engine-view/content/environment/current-provisions-understory/current.mjs';
const understoryHashes=new Set(CURRENT_UNDERSTORY_CAPTURE_HASHES);
const socialHashes=new Set(LIVE_NATIVE_SOCIAL_CAPTURE_HASHES);
import {ALL_OPTIONAL_APPEARANCE_PROFILES,type OptionalAppearanceProfiles} from './optional-appearance-profiles-all.ts';
export {ALL_OPTIONAL_APPEARANCE_PROFILES,type OptionalAppearanceProfiles};
/** Only call after WorldSceneHistory's content-hash/world/ref verification.
 * Unknown or hostile reference shapes keep the complete original guard path.
 * An incompatible verified capture cannot qualify these pinned old profiles.
 * This selects cosmetic checks; it grants no authority and bypasses no eligible checks. */
function profilesForVerifiedRef(reference:unknown):OptionalAppearanceProfiles{
 try{
  if(!reference||typeof reference!=='object'||Object.getPrototypeOf(reference)!==Object.prototype)return ALL_OPTIONAL_APPEARANCE_PROFILES;
  const fields=['contract','hash','rulesVersion'].map(key=>Object.getOwnPropertyDescriptor(reference,key));
  if(fields.some(f=>!f||!Object.hasOwn(f,'value')))return ALL_OPTIONAL_APPEARANCE_PROFILES;
  const [contract,hash,rulesVersion]=fields.map(f=>f!.value as unknown);
  if(contract!=='render-scene-ref/1'||typeof hash!=='string'||!/^([a-f0-9]{64})$/.test(hash)||typeof rulesVersion!=='string'||!rulesVersion)return ALL_OPTIONAL_APPEARANCE_PROFILES;
  return {understory:understoryHashes.has(hash),nativeSocial:socialHashes.has(hash)};
 }catch{return ALL_OPTIONAL_APPEARANCE_PROFILES;}
}

/** One-time installation check, not per frame/chunk. A caller-supplied hash is
 * insufficient: canonical full capture decoding and selected-world/ref equality
 * establish the witness before any impossible-profile fast rejection. */
export function optionalAppearanceProfilesForVerifiedCapture(publication:unknown,worldId:string,reference:unknown):OptionalAppearanceProfiles{
 try{
  const wanted=detachedData(reference) as {contract?:unknown;hash?:unknown;rulesVersion?:unknown};
  const verified=decodeSceneCapturePublication(detachedData(publication));
  if(verified.worldId!==worldId||verified.ref.contract!==wanted.contract||verified.ref.hash!==wanted.hash||verified.ref.rulesVersion!==wanted.rulesVersion)return ALL_OPTIONAL_APPEARANCE_PROFILES;
  return profilesForVerifiedRef(verified.ref);
 }catch{return ALL_OPTIONAL_APPEARANCE_PROFILES;}
}
