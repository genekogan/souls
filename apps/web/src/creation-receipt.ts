// Read projection only. This neither advertises admission nor grants control.
import {soulLifecycleSchema,ownerLifecycleListSchema,type SoulLifecycle} from '@souls/protocol';
export type CreationReceipt={kind:'pending'|'recorded'|'refused'|'unconfirmed';detail:string;lifecycle?:SoulLifecycle;soulId?:string};
const unknown:CreationReceipt={kind:'unconfirmed',detail:'We could not confirm the arrival request. Check your account before trying again.'};
export function creationReceipt(status:number,body:unknown,worldId:string,name:string):CreationReceipt{
 if(!body||typeof body!=='object'||Array.isArray(body))return unknown;
 const data=body as Record<string,unknown>;
 if('lifecycle' in data){
  const parsed=soulLifecycleSchema.safeParse(data.lifecycle);
  if(!parsed.success)return unknown;
  const row=parsed.data;
  if(row.worldId!==worldId||row.name!==name.trim()||row.operation!=='create'||row.reason==='retirement-accepted')return unknown;
  if(row.state==='refused'&&status===409&&data.ok===false&&data.code==='arrival-unavailable')return {kind:'refused',detail:'They could not find a safe place to arrive.',lifecycle:row};
  if(row.state==='pending'&&(status===202||status===503&&data.ok===false&&data.code==='lifecycle-pending'))return {kind:'pending',detail:'Their arrival request is recorded. We’re waiting for the world to confirm it.',lifecycle:row};
  if(row.state==='admitted'&&(status===200||status===202))return {kind:'recorded',detail:row.ready?'Their arrival is recorded. Check current account access before opening their tools.':'Their arrival is recorded. We’re checking whether they are available now.',lifecycle:row,soulId:row.soulId};
  return unknown;
 }
 const soul=data.soul as Record<string,unknown>|undefined;
 if(status===200&&data.ok===true&&soul&&typeof soul==='object'&&!Array.isArray(soul)&&typeof soul.id==='string'&&/^s_[a-zA-Z0-9_-]{1,126}$/.test(soul.id)&&soul.name===name.trim()&&typeof soul.description==='string'&&typeof soul.entityId==='string'&&soul.entityId==='h_'+soul.id.slice(2))return {kind:'recorded',detail:'Their arrival response was received. Check current account access before opening their tools.',soulId:soul.id};
 return unknown;
}
// Call only with a fresh, successfully authenticated /v1/me page for this account
// and world. Absence/malformed/older revision never permits a second birth.
export function readyCreatedSoul(receipt:CreationReceipt,page:unknown,ownedIds:readonly string[],worldId:string):string|null{
 const initial=receipt.lifecycle;if(!initial||receipt.kind==='refused')return null;
 const parsed=ownerLifecycleListSchema.safeParse(page);if(!parsed.success||parsed.data.worldId!==worldId)return null;
 const current=parsed.data.requests.find(r=>r.requestId===initial.requestId);if(!current)return null;
 return current.worldId===worldId&&current.operation==='create'&&current.soulId===initial.soulId&&current.entityId===initial.entityId&&current.name===initial.name&&current.requestedAt===initial.requestedAt&&current.revision>=initial.revision&&current.state==='admitted'&&current.ready&&current.reason===null&&ownedIds.includes(current.soulId)?current.soulId:null;
}
