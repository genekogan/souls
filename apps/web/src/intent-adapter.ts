import {intentOwnerControlV2Schema,type IntentOwnerControlV2} from '@souls/protocol';
export type IntentAdapter={kind:'loading'}|{kind:'legacy'}|{kind:'unavailable'}|{kind:'candidate';control:IntentOwnerControlV2};
/** An explicitly advertised candidate never falls back to a different mutation
 * when its next read is missing, foreign, malformed or unavailable. */
export function intentAdapter(status:number,dashboard:unknown,scope:{worldId:string;soulId:string;ownerId:string},candidateSeen:boolean):IntentAdapter {
  if(status!==200||!dashboard||typeof dashboard!=='object'||Array.isArray(dashboard))return {kind:'unavailable'};
  const data=dashboard as Record<string,unknown>;
  if(!data.status||typeof data.status!=='object'||Array.isArray(data.status))return {kind:'unavailable'};
  if(!Object.hasOwn(data,'control'))return {kind:candidateSeen?'unavailable':'legacy'};
  const parsed=intentOwnerControlV2Schema.safeParse(data.control);
  if(!parsed.success)return {kind:'unavailable'};
  const control=parsed.data;
  if(control.worldId!==scope.worldId||control.soulId!==scope.soulId||(control.accountOwnerId??control.ownerId)!==scope.ownerId)return {kind:'unavailable'};
  return {kind:'candidate',control};
}
