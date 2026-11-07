import type {PublicSoul} from '@souls/protocol';
import {soulProfilePhotoSchema} from '@souls/protocol';

export type SoulAvatarImage={src:string;kind:'profile-photo'|'generated';key:string;hash?:string};
/** A published owner photo belongs to this Soul and world; it is not a body capture. */
export function soulAvatarImage(soul:Pick<PublicSoul,'id'|'profilePhoto'>,worldPath:string,generated:string|undefined,failedPhoto:string|null):SoulAvatarImage|undefined{
 const p=soul.profilePhoto;
 if(p){
  const {url,...metadata}=p;
  const valid=soulProfilePhotoSchema.safeParse(metadata).success;
  const suffix=`/v1/souls/${encodeURIComponent(soul.id)}/profile-photo/${p.hash}`;
  const key=`${p.hash}:${url}`;
  if(valid&&(url===worldPath+suffix||url===suffix)&&key!==failedPhoto)return {src:url,kind:'profile-photo',key,hash:p.hash};
 }
 return generated?{src:generated,kind:'generated',key:generated}:undefined;
}
