import type {EdgeLedger} from '../ledger/ledger.ts';
import type {EdgeReceipt} from '../contract.ts';
import type {Item} from '../ledger/together.ts';
import type {ConfirmedEffects,HoldingFact} from './store.ts';
import {rideName} from '../comms/objects/ride.ts';
type ItemOp={soulId:string;op:string;item?:string;kind?:string;to?:string;invite?:string};
export const holdingFact=(item:Item|null):HoldingFact|null=>item?{id:item.id,kind:item.kind,name:item.name,state:item.state,holder:item.holder,placeId:item.placeId}:null;
/** Read only this receipt's operation before Together consumes it. */
export function receiptItemOp(ledger:EdgeLedger,id:string):ItemOp|null{const r=ledger.db.db.prepare('SELECT body FROM edge_item_ops_v1 WHERE world_id=? AND receipt_id=?').get(ledger.host.worldId,id) as {body:string}|undefined;return r?JSON.parse(r.body) as ItemOp:null;}
/** No invitation success or directory membership is promoted to an encounter. */
export function confirmedTogetherEffects(ledger:EdgeLedger,r:EdgeReceipt,op:ItemOp|null):ConfirmedEffects{
 if(r.phase!=='completed'||!r.programId)return{};const before=ledger.outcomes.context(r.id)?.holdingBefore??null,after=holdingFact(ledger.together.heldBy(r.soulId)),changed:NonNullable<ConfirmedEffects['changed']>=[],met:NonNullable<ConfirmedEffects['met']>=[],detail:Record<string,unknown>={};
 if(op){const id=op.item??after?.id??before?.id,current=id?ledger.together.item(id):null;
  if(id){const acquired=op.op==='pick-up'&&after?.id===id&&after.state==='held',placed=op.op==='put-down'&&current?.state==='placed',returned=op.op==='put-down'&&!current&&before?.id===id,consumed=op.op==='consume'&&!current&&before?.id===id,transferred=op.op==='give'&&!!op.to&&current?.holder===op.to;
   const kind=acquired?'item-acquired':placed?'item-placed':returned?'item-returned':consumed?'item-consumed':transferred?'item-transferred':null;
   if(kind)changed.push({id,kind,summary:`${id}: ${kind}${current?.holder?` to ${current.holder}`:''}.`,source:`ledger-item:${id}:${r.id}`});
   detail.item={id,operation:op.op,before,after:current?holdingFact(current):null,confirmed:!!kind};
  }
 }
 const linked=ledger.together.inviteForReceipt(r.id);
 for(const inv of linked?[linked]:[]){if(!['paired','give'].includes(inv.kind))continue;
  const actorHost=inv.host.soulId===r.soulId&&inv.hostReceipt===r.id,actorGuest=inv.guestReceipts[r.soulId]===r.id&&inv.responses[r.soulId]==='accepted';if(!actorHost&&!actorGuest)continue;
  const counterparts=actorHost?inv.guests.filter(g=>inv.responses[g.soulId]==='accepted'&&inv.guestReceipts[g.soulId]):[inv.host];if(!counterparts.length)continue;
  const place=(r.endedAt as {place?:string}|null)?.place??null;met.push(...counterparts.map(s=>({soulId:s.soulId,name:s.name,placeId:place})));detail.together={inviteId:inv.id,activity:inv.activity,what:inv.what,acceptedParticipants:[inv.host,...inv.guests.filter(g=>inv.responses[g.soulId]==='accepted')],programmeId:r.programId};
 }
 // quality case 33: accepting a ride invitation is a boarding too, never a finished ride (the host's join already says so)
 const boarded=linked&&linked.kind==='ride'&&linked.guestReceipts[r.soulId]===r.id&&linked.responses[r.soulId]==='accepted'?`Accepted ${linked.host.name}'s invitation and boarded ${linked.ride?.object??'the ride'}; the ride has not left the ground yet and is not finished.`:null;
 // entry 35: a finished game of rock-paper-scissors reports the world's verdict (both throws and who won)
 const rps=linked&&met.length?ledger.together.rpsVerdict(linked,r.soulId):null;if(rps)detail.rps={you:rps.mine,them:rps.theirs,result:rps.result};
 const hands=linked?.what==='hold-hands'&&met.length&&ledger.together.handsWith(ledger.host.minds.get(r.soulId)?.entityId??'')?`You are holding hands with ${met.map(s=>s.name).join(', ')}.`:null;
 return{changed,met,detail,untrusted:met.length>0||!!boarded,...(rps?{summary:rps.text}:hands?{summary:hands}:met.length?{summary:`Completed ${String((detail.together as {what?:string}).what??r.capability)} with ${met.map(s=>s.name).join(', ')}.`}:boarded?{summary:boarded}:{})};
}
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
/** Entitled action response/state only; never raw hidden object fields. */
export function confirmedObjectEffects(before:unknown,after:unknown,action:string,version:number):ConfirmedEffects{
 const old=record(record(before).object),next=record(record(after).object),state=record(next.state),id=String(next.id??old.id??''),kind=String(next.kind??old.kind??'object');if(!id||!Number.isSafeInteger(version))return{};
 const detail:Record<string,unknown>={object:{id,kind,action,version}},changed:NonNullable<ConfirmedEffects['changed']>=[{id,kind:'object-updated',summary:`${id} accepted ${action}; version ${version}.`,source:`object:${id}:v${version}`}];
 if(kind==='project'&&typeof state.progress==='number')detail.project={id,progress:state.progress,status:state.status};
 if(kind==='chess'){const game:Record<string,unknown>={id};for(const key of ['status','turn','fullmove','halfmove','check','winner'])if(typeof state[key]==='string'||typeof state[key]==='number'||typeof state[key]==='boolean')game[key]=state[key];detail.game=game;}
 // A joined ride is a boarding, not a finished ride: say so in the world's own verdict so a seated, parked body is never reported as "ride completed".
 if(kind==='ride'&&action==='join')return{changed,detail,untrusted:true,summary:`Boarded ${rideName(state.vehicle)} and seated; the ride has not left the ground yet and is not finished.`};
 return{changed,detail,untrusted:true};
}
