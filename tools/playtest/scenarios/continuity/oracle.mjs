#!/usr/bin/env node
// Read-only deterministic scoring of the declared continuity evidence contract.
// Unknown never passes; narration and receipt start never establish body duration.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {auditPublicEffects} from './effect-audit.mjs';
import {seatIdentity,insidePolygon} from '../../review/journey-oracles.mjs';
import {gardenPoolOf,poolGardenAt,poolGardenRegion} from './garden-pool.mjs';
const at=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'?Date.parse(v):NaN;
const row=(id,status,detail,evidence=[])=>({id,status,detail,evidence});
const xz=p=>Array.isArray(p)?p.length===3?[p[0],p[2]]:p.length===2?p:null:p&&[p.x,p.z];
const current=s=>s?.pos?.src!=='lastReceipt'&&(s?.currentBody===true||['here','owner','world'].includes(s?.pos?.src));
const inside=(s,r)=>{const p=xz(s.pos),circle=Array.isArray(r.pos)&&Number.isFinite(r.radiusM);return p?.every(Number.isFinite)&&(circle||r.includePolygon)&&(!circle||Math.hypot(p[0]-r.pos[0],p[1]-r.pos[1])<=r.radiusM)&&(!r.includePolygon||insidePolygon(p,r.includePolygon))&&(!r.excludePolygon||!insidePolygon(p,r.excludePolygon))&&(!r.poolRef||poolGardenAt(p,r.pool)?.ref===r.poolRef);};
const locationMissing=(s,p)=>p.placeIds&&(!xz(s.pos)?.every(Number.isFinite)||typeof s.place!=='string'||s.placeProvenance!=='explicit-native-most-specific-place');
export const locationMatches=(s,p)=>inside(s,p.region)&&(!p.placeIds||!locationMissing(s,p)&&p.placeIds.includes(s.place)&&(Number.isFinite(s.level)?s.level===p.level:p.placeLevels?.[s.place]===p.level));
const activity=s=>typeof s.activity==='string'?s.activity:s.activity?.kind;
const accepted=r=>at(r.acceptedAtUtc??r.observedAcceptedAt??r.acceptedAt??r.startedAt);
const ended=r=>at(r.endedAtUtc??r.observedEndedAt??(typeof r.endedAt==='string'?r.endedAt:null));
const held=s=>{const h=seatIdentity(s.seat);return h?`${h.entity}#${h.slot??'seat'}`:null;};
const refOfSeat=(s,bindings,refs=Object.keys(bindings))=>{
 const h=seatIdentity(s.seat);if(!h)return null;
 const matching=refs.filter(k=>bindings[k]?.entityId===h.entity);
 return matching.find(k=>bindings[k].slot===(h.slot??'seat'))??matching.find(k=>!bindings[k].slot);
};
// Prospective correction of the native compound-read false negative. This is
// an implementation version, not a change to frozen durations or criteria.
export const READING_MATCH_VERSION='native-reading-lifecycle/2';
const nativeReads=r=>(Array.isArray(r.nativeReadLifecycles)?r.nativeReadLifecycles:[]).filter(p=>{
 const e=p?.event;
 return p?.schema==='native-read-lifecycle/1'&&cited(p.evidence)&&cited(p.receiptEvidence)&&e?.kind==='activity.observed'&&/^c_[0-9]+$/.test(e.id)&&Number.isFinite(e.at)&&Number.isFinite(e.observedAt)&&e.observedAt<=e.at
  &&e.observation==='native-current-body'&&e.untrusted===false&&typeof r.worldId==='string'&&e.worldId===r.worldId&&typeof r.soulId==='string'&&e.soulId===r.soulId&&typeof e.bodyId==='string'&&!!e.bodyId
  &&e.receipt?.id===r.id&&e.receipt?.capability===r.capability&&e.receipt?.phase==='started'&&typeof r.programId==='string'&&!!r.programId&&e.programId===r.programId
  &&e.body?.activity==='read'&&['seated','sitting'].includes(e.body?.posture)&&Array.isArray(e.body?.occupiedSeats)&&e.body.occupiedSeats.length===1&&typeof e.body.occupiedSeats[0]==='string'&&/^([^#\s]+)#([^#\s]+)$/.test(e.body.occupiedSeats[0])
  &&typeof e.action?.id==='string'&&!!e.action.id&&e.action.verb==='pose_v1'&&e.action.status==='executing';
});
const nativeReadMatches=(r,rule,bindings,time=Infinity)=>rule.verb==='read'&&nativeReads(r).some(p=>p.event.at<=time&&(rule.targetRefs??[]).some(ref=>{
 const b=bindings[ref];return b&&p.event.body.occupiedSeats[0]===`${b.entityId}#${b.slot??'seat'}`;
}));
function receiptMatches(r,rule,bindings){
 if(nativeReadMatches(r,rule,bindings))return true;
 if(rule.verb&&!r.capability?.startsWith(rule.verb+':'))return false;
 if(rule.navigation){const ids=[r.chosen?.target,r.chosen?.place].filter(id=>typeof id==='string');return ids.length>0&&rule.navigation.some(n=>r.capability===n.capability&&ids.every(id=>id===n.targetPlaceId));}
 if(r.capability==='read:here')return false; // local receipt, never a seat target
 if(rule.capabilities?.includes(r.capability))return true;
 return (rule.targetRefs??[]).some(ref=>{const b=bindings[ref];if(!b)return false;
  if(b.capabilities?.[rule.verb]?.includes(r.capability))return true;
  const chosen=[r.chosen?.target,r.chosen?.seat,r.target?.id,r.target?.entity,r.target?.place].map(x=>seatIdentity(x)?.entity).filter(Boolean);
  return chosen.includes(b.entityId);
 });
}
// Maximal consecutive body-observed runs. Different/unknown body states and
// sampling gaps break the run; we never fill them using a receipt's end pose.
export function observedHolds({samples=[],receipts=[],phase,bindings={},from=-Infinity,to=Infinity,maxGapSec=2,coverageComplete=false}){
 const refs=phase.receipt?.targetRefs??[];
 if(phase.receipt&&refs.some(ref=>!bindings[ref]))return {status:'unknown',detail:'missing native target binding',windows:[]};
 const all=samples.filter(s=>at(s.t)>=from&&at(s.t)<=to).sort((a,b)=>at(a.t)-at(b.t));
 if(!all.some(current))return {status:'unknown',detail:'no current body samples',windows:[]};
 const missingSeat=s=>{
  if(!phase.requireSeatRefs||s.seat===null)return false;
  const h=seatIdentity(s.seat);if(!h)return true;
  return !h.slot&&phase.requireSeatRefs.some(ref=>bindings[ref]?.entityId===h.entity&&bindings[ref].slot&&bindings[ref].slot!=='seat');
 };
 const incomplete=all.some((s,i)=>!current(s)||locationMissing(s,phase)||missingSeat(s)||phase.activities&&!activity(s)||phase.instruments&&(!phase.activities||phase.activities.includes(activity(s)))&&!s.instrument||i>0&&at(s.t)-at(all[i-1].t)>maxGapSec*1000),miss=coverageComplete&&!incomplete?'fail':'unknown';
 // Local and compound reads need a bounded audited lifecycle. A local
 // receipt has no target; a compound read additionally requires its exact
 // native program/body transition and occupied slot. Neither name is an alias.
 const local=r=>phase.receipt?.verb==='read'&&phase.receipt.localCapabilities?.includes(r.capability);
 const lifecycle=r=>local(r)||phase.receipt?.verb==='read'&&nativeReads(r).length>0;
 const unboundedLifecycle=r=>{
  if(!lifecycle(r))return false;
  return !coverageComplete||!Number.isFinite(from)||!Number.isFinite(to)||!Number.isFinite(accepted(r))||typeof r.id!=='string'||!r.id
   ||!['accepted','waiting','started','running','completed','failed','replaced','cancelled','canceled'].includes(r.phase)
   ||['completed','failed','replaced','cancelled','canceled'].includes(r.phase)&&!Number.isFinite(ended(r))
   ||receipts.some(other=>other.id!==r.id&&accepted(other)===accepted(r));
 };
 const lifecycleUnknown=receipts.some(unboundedLifecycle);
 const navigationUnknown=phase.receipt?.navigation&&receipts.some(r=>phase.receipt.navigation.some(n=>n.capability===r.capability)&&(!Number.isFinite(accepted(r))||!r.chosen||![r.chosen.target,r.chosen.place].some(id=>typeof id==='string')||r.phase==='completed'&&!Number.isFinite(ended(r))));
 const eligible=r=>(local(r)?!unboundedLifecycle(r):!unboundedLifecycle(r)&&receiptMatches(r,phase.receipt,bindings))&&Number.isFinite(accepted(r))&&accepted(r)<=to;
 const candidates=phase.receipt?receipts.filter(eligible):[null];
 if(phase.receipt&&!candidates.length)return {status:lifecycleUnknown||navigationUnknown?'unknown':miss,detail:'no timestamped native receipt matching bound target or audited local read lifecycle',windows:[]};
 const windows=[];
 for(const r of candidates){
  const nextAction=r&&lifecycle(r)?Math.min(...receipts.filter(other=>other.id!==r.id&&Number.isFinite(accepted(other))&&accepted(other)>=accepted(r)).map(accepted)):Infinity;
  let run=[];
  const finish=()=>{const requiredMs=(phase.holdSec??0)*1000;if(run.length&&at(run.at(-1).t)-at(run[0].t)>=requiredMs)windows.push({from:at(run[0].t),to:at(run.at(-1).t),completedAt:at(run.find(s=>at(s.t)-at(run[0].t)>=requiredMs).t),receiptId:r?.id??null,seat:held(run[0]),seatRef:refOfSeat(run[0],bindings,phase.requireSeatRefs)});run=[];};
  for(const s of all){
   const time=at(s.t),seat=held(s),ref=refOfSeat(s,bindings,phase.requireSeatRefs);
   let good=current(s)&&locationMatches(s,phase)&&(!phase.postures||phase.postures.includes(s.posture))&&(!phase.activities||phase.activities.includes(activity(s)))&&(!phase.instruments||phase.instruments.includes(s.instrument));
   if(phase.requireSeatRefs)good=good&&phase.requireSeatRefs.includes(ref);
   if(r){
    good=good&&accepted(r)<=time;
    if(lifecycle(r))good=good&&time<nextAction;
    if(!local(r)){
     if(phase.receipt.verb==='read'&&nativeReads(r).length)good=good&&!!ref&&nativeReadMatches(r,{...phase.receipt,targetRefs:[ref]},bindings,time);
     else if(phase.requireSeatRefs)good=good&&!!ref&&receiptMatches(r,{...phase.receipt,targetRefs:[ref]},bindings);
    }
    const chosenSlot=seatIdentity(r.chosen?.slot);
    if(phase.requireSeatRefs&&chosenSlot?.slot)good=good&&seat===`${chosenSlot.entity}#${chosenSlot.slot}`;
    if(phase.receipt.completed)good=good&&r.phase==='completed'&&Number.isFinite(ended(r))&&ended(r)>=from&&ended(r)<=time;
    if(phase.activities)good=good&&(!Number.isFinite(ended(r))||ended(r)>=time)&&(!['completed','failed','cancelled','canceled','replaced'].includes(r.phase)||Number.isFinite(ended(r)));
   }
   if(run.length&&(time-at(run.at(-1).t)>maxGapSec*1000||(phase.requireSeatRefs&&seat!==held(run.at(-1)))))finish();
   if(good)run.push(s);else finish();
  }
  finish();
 }
 windows.sort((a,b)=>a.completedAt-b.completedAt||a.from-b.from);
 return {status:windows.length?'pass':lifecycleUnknown||navigationUnknown?'unknown':miss,detail:windows.length?'current body samples and native receipt agree':'no uninterrupted sampled hold; missing/contrary samples are retained',windows};
}
function errandInspection(r,{samples,phase,returned,cutoff,maxGapSec}){
 const request=at(r.requestedAt),response=at(r.at),gap=maxGapSec*1000;
 if(!['here','observe','explore'].includes(r.command)||r.origin!=='agent'||!cited(r.evidence)||!Number.isFinite(request)||!Number.isFinite(response)||request<returned||request>response||response>cutoff)return false;
 // Explore's route query is not an inspection. Require a source-cited native
 // local around payload. All inspection commands also need current destination
 // coverage across the complete request/response, retaining contrary samples.
 if(r.command==='explore'&&(r.inspection?.kind!=='native-local-around'||!cited(r.inspection.evidence)||!Array.isArray(r.inspection.facts)||!r.inspection.facts.length))return false;
 const all=(samples??[]).filter(s=>Number.isFinite(at(s.t))).sort((a,b)=>at(a.t)-at(b.t));
 const before=all.filter(s=>at(s.t)<=request).at(-1),after=all.find(s=>at(s.t)>=response&&at(s.t)<=cutoff);
 if(!before||!after||request-at(before.t)>gap||at(after.t)-response>gap)return false;
 const proof=all.filter(s=>at(s.t)>=at(before.t)&&at(s.t)<=at(after.t));
 return proof.every((s,i)=>current(s)&&locationMatches(s,phase)&&(!i||at(s.t)-at(proof[i-1].t)<=gap));
}
const bodyCoverageComplete=(ev,from,to,maxGapSec)=>{
 if(ev?.coverageComplete!==true)return false;
 const samples=(ev.samples??[]).filter(s=>at(s.t)>=from&&at(s.t)<=to).sort((a,b)=>at(a.t)-at(b.t)),gap=maxGapSec*1000;
 return !!samples.length&&at(samples[0].t)<=from+gap&&at(samples.at(-1).t)>=to-gap&&samples.every((s,i)=>current(s)&&xz(s.pos)?.every(Number.isFinite)&&(!i||at(s.t)-at(samples[i-1].t)<=gap));
};
// Fixture occupancy is an interval obligation, not a minimum-duration action.
// A verification sample just after cutoff may bracket that endpoint, but it
// never extends the trial or credits participant behavior after cutoff.
function occupiedSeatInterval({fixture,receipt,seatRef,bindings,region,from,to,maxGapSec}){
 const binding=bindings[seatRef],expected=`${binding.entityId}#${binding.slot??'seat'}`,gap=maxGapSec*1000;
 const samples=(fixture.samples??[]).filter(s=>Number.isFinite(at(s.t))&&at(s.t)>=from).sort((a,b)=>at(a.t)-at(b.t));
 const body=s=>current(s)&&xz(s.pos)?.every(Number.isFinite);
 const good=s=>body(s)&&inside(s,region)&&['seated','sitting'].includes(s.posture)&&held(s)===expected;
 const interval=samples.filter(s=>at(s.t)<=to);
 // A native contrary observation within the obligation disproves continuous
 // occupancy even if other samples are absent. Missing state is not contrary.
 if(interval.some(s=>body(s)&&(!inside(s,region)||typeof s.posture==='string'&&!['seated','sitting'].includes(s.posture)||(s.seat===null||held(s)!==null&&held(s)!==expected))))return {status:'fail',detail:'native fixture body left the required seat during the trial'};
 if(!receiptMatches(receipt,{verb:'sit',targetRefs:[seatRef]},bindings)||!Number.isFinite(accepted(receipt))||accepted(receipt)>from)return {status:'unknown',detail:'native setup seat receipt not established'};
 const end=samples.find(s=>at(s.t)>=to);
 if(!end||!interval.length||at(interval[0].t)!==from)return {status:'unknown',detail:'missing exact observed setup or cutoff bracket'};
 const proof=at(end.t)===to?interval:[...interval,end];
 if(!proof.every((s,i)=>good(s)&&(!i||at(s.t)-at(proof[i-1].t)<=gap)))return {status:'unknown',detail:'cutoff bracket or continuous current seat coverage missing'};
 return {status:'pass',detail:'same native seat observed continuously from setup through a cutoff bracket',from,to,verifiedThrough:at(end.t)};
}
function overlap(groups,seconds,{distinctSeats=false}={}){
 for(const start of [...new Set(groups.flat().map(w=>w.from))].sort((a,b)=>a-b)){
  const selected=groups.map(ws=>ws.find(w=>w.from<=start&&w.to>=start+seconds*1000));
  if(selected.every(Boolean)&&(!distinctSeats||selected.every(w=>w.seat)&&new Set(selected.map(w=>w.seat)).size===selected.length))return {from:start,to:Math.min(...selected.map(w=>w.to)),windows:selected};
 }
 return null;
}
const cited=v=>Array.isArray(v)&&v.length>0&&v.every(s=>typeof s==='string'&&s.trim());
const sameActors=(a,b)=>Array.isArray(a)&&a.every(x=>typeof x==='string')&&new Set(a).size===a.length&&[...a].sort().join('\0')===[...b].sort().join('\0');
function samePolygon(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||a.length<3||a.length!==b.length||[...a,...b].some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))return false;
 return [b,[...b].reverse()].some(points=>points.some((_,shift)=>a.every((p,i)=>p.every((v,k)=>v===points[(i+shift)%points.length][k]))));
}
// The preflight binding is data frozen before inference, never an equivalence
// guessed from whichever ancestor/position a successful-looking run supplies.
export function fieldReturnLocation({scenario,evidence,t0}){
 const spec=scenario.fieldReturn,b=evidence.fieldReturnBinding,missing=[],bad=[];
 if(!spec||!b)return {status:'unknown',detail:'Frozen source-cited native field binding missing'};
 const required=(value,condition,label)=>{if(value===undefined||value===null)missing.push(label);else if(!condition)bad.push(label);};
 required(b.ref,b.ref===spec.ref,'field ref mismatch');
 required(evidence.worldId,typeof evidence.worldId==='string'&&!!evidence.worldId,'current world identity');
 if(typeof evidence.worldId==='string'&&evidence.worldId)required(b.worldId,b.worldId===evidence.worldId,'field binding world mismatch');
 else if(b.worldId===undefined)missing.push('field binding world identity');
 required(b.boundAt,Number.isFinite(at(b.boundAt))&&at(b.boundAt)<=t0,'field binding was not frozen by T0');
 required(b.polygon,samePolygon(b.polygon,spec.polygon),'field polygon mismatch');required(b.level,b.level===spec.level,'field level mismatch');
 if(!cited(b.evidence))missing.push('field binding sources');
 if(!Array.isArray(b.places)||!b.places.length)missing.push('native field place equivalence');
 const places=Array.isArray(b.places)?b.places.filter(p=>p&&typeof p==='object'):[];
 if(places.length!==b.places?.length)missing.push('native field place records');
 for(const p of places){
  required(p.ref,spec.equivalentPlaceRefs.includes(p.ref),'unfrozen field equivalent ref');required(p.placeId,typeof p.placeId==='string'&&!!p.placeId,'native field place ID');
  required(p.polygon,samePolygon(p.polygon,spec.polygon),'equivalent field polygon mismatch');required(p.level,p.level===spec.level,'equivalent field level mismatch');
  required(p.enclosed,p.enclosed===false,'field equivalent is enclosed');
  if(['building','room','water'].includes(p.kind))bad.push('field equivalent is a non-field venue');
  if(!cited(p.evidence??b.evidence))missing.push('native place source');
 }
 // #473, fixture version 3: open places the world puts inside a bound field place. The containment is the world's, cited in the binding; the polygon still applies.
 const children=spec.openChildren===true&&Array.isArray(b.children)?b.children.filter(p=>p&&typeof p==='object'):[];
 if(b.children!==undefined&&spec.openChildren!==true)bad.push('field child places are not part of this fixture version');
 for(const p of children){
  required(p.placeId,typeof p.placeId==='string'&&!!p.placeId,'native field child place ID');
  required(p.containedBy,places.some(f=>f.placeId===p.containedBy),'field child is not inside a bound field place');
  required(p.level,p.level===spec.level,'field child level mismatch');required(p.enclosed,p.enclosed===false,'field child is enclosed');
  if(['building','room','water'].includes(p.kind))bad.push('field child is a non-field venue');
  if(!cited(p.evidence??b.evidence))missing.push('native child place source');
 }
 if(new Set([...places,...children].map(p=>p.placeId)).size!==places.length+children.length)bad.push('duplicate native field place identity');
 const navigation=Array.isArray(b.navigation)?b.navigation.filter(n=>n&&typeof n==='object'):[];
 if(!navigation.length||navigation.length!==b.navigation?.length)missing.push('native field walk binding');
 for(const n of navigation){
  required(n.capability,typeof n.capability==='string'&&n.capability.startsWith('walk:'),'field navigation is not a walk');
  if(places.length&&places.every(p=>typeof p.placeId==='string'&&p.placeId))required(n.targetPlaceId,places.some(p=>p.placeId===n.targetPlaceId),'walk target is not a bound open field');
  else missing.push('field walk target binding');
  if(!cited(n.evidence??b.evidence))missing.push('native walk source');
 }
 const status=bad.length?'fail':missing.length?'unknown':'pass';
 return {status,detail:bad.length?bad.join('; '):missing.length?'Missing '+missing.join(', '):'Native field polygon, level, equivalence and walk targets frozen before T0',evidence:b.evidence,
  ...(status==='pass'?{region:{includePolygon:spec.polygon},level:spec.level,placeIds:[...places,...children].map(p=>p.placeId),placeLevels:Object.fromEntries([...places,...children].map(p=>[p.placeId,p.level])),navigation}:{} )};
}
function errandReport(actor,reads,evidence,cutoff){
 const reports=(evidence.errandReports??[]).filter(r=>r?.actor===actor),failures=[];
 for(const r of reports){
  if(!cited(r.evidence))continue;
  const read=reads.find(read=>read.evidence?.includes(r.readSource)),effect=(evidence.effects??[]).find(e=>e.id===r.effectId);
  if(r.grounded===false||effect&&(effect.actor!==actor||!['speech','conversation-turn'].includes(effect.type)||Number.isFinite(at(effect.at))&&(at(effect.at)>cutoff||read&&at(effect.at)<at(read.at)))){failures.push(r);continue;}
  if(!read||!effect||!cited(effect.evidence)||!Number.isFinite(at(effect.at))||r.grounded!==true)continue;
  return row(actor+':errand-report','pass','Exact native report follows the source-cited fresh destination inspection; grounding separately reviewed',[...r.evidence,...effect.evidence]);
 }
 return row(actor+':errand-report',failures.length?'fail':'unknown',failures.length?'Native report actor/timing or source-cited grounding contradicts the errand':'Source-cited grounded report linked to an exact inspection and native effect required',failures);
}
/** Frozen disturbances are delivered facts, not an authorization to direct
 * dialogue. Native per-recipient event records, not a successful speech POST,
 * establish that the required Soul actually heard the disturbance. */
export function scoreDisturbance({scenario,disturbance,evidence,t0,cutoff,maxGapSec,bindings}){
 const spec=disturbance.trigger,d=evidence.disturbances?.[disturbance.id],p=d?.triggerProof,failures=[],missing=[];let offAgreed=null;
 const need=(ok,why)=>{if(!ok)missing.push(why);},check=(ok,why)=>{if(!ok)failures.push(why);};
 if(!spec||!d)return row('disturbance:'+disturbance.id,'unknown','Frozen typed trigger and source-backed delivery evidence required');
 need(d.delivered===true,'delivery not proven');need(cited(d.evidence),'delivery sources');need(cited(p?.evidence),'trigger sources');
 if(d.recipients!==undefined)check(sameActors(d.recipients,spec.recipients),'recipient mismatch');else need(false,'recipients');
 if(p?.kind!==undefined)check(p.kind===spec.kind,'trigger kind mismatch');else need(false,'trigger kind');
 const scheduled=at(d.scheduledAt),delivered=at(d.deliveredAt),observed=at(p?.observedAt),delay=spec.maximumDelaySec*1000;
 need([scheduled,delivered,observed].every(Number.isFinite),'scheduled/delivered/trigger timestamps');
 if(spec.kind!=='occupied-seat'){
  if(Number.isFinite(scheduled))check(scheduled>=t0,'disturbance scheduled before trial');
  if(Number.isFinite(delivered))check(delivered<=cutoff,'disturbance delivered after trial cutoff');
 }
 if(Number.isFinite(scheduled)&&Number.isFinite(delivered)&&spec.kind!=='staggered-releases')check(delivered>=scheduled&&delivered-scheduled<=delay,'delivery outside frozen maximum delay');
 if(Number.isFinite(observed)&&Number.isFinite(delivered))check(observed<=delivered,'delivery precedes trigger proof');
 const exact=(value,expected,why)=>{if(Number.isFinite(value)&&Number.isFinite(expected))check(value===expected,why);else need(false,why);};
 const actor=id=>evidence.participants?.[id]??{};
 const sample=(id,time)=>(actor(id).samples??[]).find(s=>at(s.t)===time);
 if(['scheduled-event','scheduled-release','initial-supplement'].includes(spec.kind)){
  exact(scheduled,t0+spec.offsetSec*1000,'frozen schedule mismatch');
  if(Number.isFinite(observed)&&Number.isFinite(scheduled))check(observed>=scheduled,'fixed trigger observed before schedule');
  if(spec.deliveryKind==='controller-release'){
   need(typeof p?.initialInstructionId==='string'&&p.initialInstructionId.length>0,'initial instruction source ID');
   exact(at(p?.releasedAt),delivered,'controller release timestamp mismatch');
  }
 }else if(spec.kind==='staggered-releases'){
  const releases=p?.releases;need(Array.isArray(releases)&&releases.length>0,'per-actor releases');
  if(Array.isArray(releases)){
   check(sameActors(releases.map(r=>r.actor),spec.recipients),'release recipients mismatch');
   for(const r of releases){
    const a=scenario.actors.find(a=>a.id===r.actor);if(!a)continue;
    const wanted=t0+a.releaseOffsetSec*1000,rs=at(r.scheduledAt),rd=at(r.deliveredAt);
    exact(rs,wanted,'per-actor frozen schedule mismatch');need(Number.isFinite(rd)&&cited(r.evidence)&&typeof r.initialInstructionId==='string'&&r.initialInstructionId.length>0,'per-actor release evidence');
    if(Number.isFinite(rd))check(rd>=wanted&&rd-wanted<=delay,'per-actor release outside frozen delay');
   }
   exact(scheduled,Math.min(...scenario.actors.map(a=>t0+a.releaseOffsetSec*1000)),'first release schedule mismatch');
   exact(delivered,Math.max(...releases.map(r=>at(r.deliveredAt))),'last release timestamp mismatch');exact(observed,delivered,'release proof timestamp mismatch');
  }
 }else if(spec.kind==='moving-body-journey'){
  const id=spec.recipients[0],r=(actor(id).receipts??[]).find(r=>r.id===p?.receiptId);
  need(r&&Number.isFinite(accepted(r)),'native journey receipt');
  if(r){check(spec.capabilityVerbs.some(v=>r.capability?.startsWith(v+':')),'receipt is not a declared native journey');
   check(accepted(r)>=t0,'journey belongs to pretrial setup');
   const samples=(actor(id).samples??[]).filter(s=>current(s)&&xz(s.pos)?.every(Number.isFinite)).sort((a,b)=>at(a.t)-at(b.t));
   const motionFor=receipt=>samples.slice(1).map((s,i)=>({one:samples[i],two:s})).find(({one,two})=>at(one.t)>=accepted(receipt)&&(!Number.isFinite(ended(receipt))||at(two.t)<=ended(receipt))&&at(two.t)>at(one.t)&&at(two.t)-at(one.t)<=maxGapSec*1000&&Math.hypot(xz(one.pos)[0]-xz(two.pos)[0],xz(one.pos)[1]-xz(two.pos)[1])>0);
   const first=(actor(id).receipts??[]).filter(r=>spec.capabilityVerbs.some(v=>r.capability?.startsWith(v+':'))&&accepted(r)>=t0).map(r=>({r,motion:motionFor(r)})).filter(x=>x.motion).sort((a,b)=>at(a.motion.two.t)-at(b.motion.two.t)||accepted(a.r)-accepted(b.r))[0];
   if(first){check(first.r.id===r.id,'not the first observed native moving journey');exact(at(p?.motionOnsetFromAt),at(first.motion.one.t),'first motion sample mismatch');exact(at(p?.motionOnsetAt),at(first.motion.two.t),'first motion onset mismatch');}else need(false,'first native moving journey evidence');
  }
  const onset=at(p?.motionOnsetAt),onsetFrom=at(p?.motionOnsetFromAt),motionFrom=at(p?.motionFromAt),motionTo=at(p?.motionToAt);
  for(const [a,b]of [[onsetFrom,onset],[motionFrom,motionTo]]){
   const one=sample(id,a),two=sample(id,b),onePos=one&&xz(one.pos),twoPos=two&&xz(two.pos);
   need(one&&two&&current(one)&&current(two)&&onePos?.every(Number.isFinite)&&twoPos?.every(Number.isFinite),'current native moving-body samples');
   if(onePos?.every(Number.isFinite)&&twoPos?.every(Number.isFinite))check(b>a&&b-a<=maxGapSec*1000&&Math.hypot(twoPos[0]-onePos[0],twoPos[1]-onePos[1])>0,'body samples do not prove motion');
   if(r&&Number.isFinite(accepted(r))&&Number.isFinite(a))check(accepted(r)<=a&&(!Number.isFinite(ended(r))||ended(r)>=b),'motion outside native receipt interval');
  }
  exact(scheduled,onset+spec.minimumOnsetSec*1000,'motion-onset schedule mismatch');exact(observed,motionTo,'moving trigger sample timestamp mismatch');
  if(Number.isFinite(observed)&&Number.isFinite(scheduled))check(observed>=scheduled&&observed-scheduled<=delay,'motion trigger too early or late');
  if(Number.isFinite(scheduled))check(scheduled>=t0&&scheduled-t0<=spec.maximumTriggerWaitSec*1000,'motion trigger outside frozen wait');
 }else if(spec.kind==='garden-group-overlap'){
  const from=at(p?.overlapFrom),to=at(p?.overlapTo);need(Number.isFinite(from)&&Number.isFinite(to),'garden overlap timestamps');
  // garden-pool-v2: the proof names the pool garden; the first overlap is the
  // earliest across the sealed pool (exact ties to the earlier pool entry).
  const pool=gardenPoolOf(scenario),named=pool?.find(g=>g.ref===p?.gardenRef),gardenRegion=pool?named&&poolGardenRegion(named,pool):scenario.venue.gardenRegion;
  if(pool&&!named)need(false,'sealed pool garden named by trigger proof');
  // The trigger applies to the agreed pool garden (or the v1 default when no
  // garden was agreed). A valid trigger elsewhere is out-of-fixture, not scored.
  const agreed=pool?agreedGarden(scenario,evidence):null;if(named&&agreed&&named.ref!==agreed.ref)offAgreed=nonAgreedTrigger(named.ref,agreed);
  const holdsIn=region=>scenario.actors.map(a=>observedHolds({samples:actor(a.id).samples,phase:{region,holdSec:spec.minimumOverlapSec},from:Math.max(t0+scenario.timing.meetingOffsetSec*1000,t0+a.releaseOffsetSec*1000),to:cutoff,maxGapSec}).windows);
  if(Number.isFinite(from)&&Number.isFinite(to)&&gardenRegion){
   check(from>=t0+scenario.timing.meetingOffsetSec*1000&&to-from>=spec.minimumOverlapSec*1000,'garden overlap duration/order');
   // Retain each independently sampled run's bracketing endpoints. Slicing
   // every actor to a common timestamp drops valid boundary observations and
   // falsely shortens an asynchronous intersection. Gaps still break runs.
   const groups=holdsIn(gardenRegion),together=groups.every(windows=>windows.some(w=>w.from<=from&&w.to>=to));
   if(!together){if(scenario.actors.every(a=>bodyCoverageComplete(actor(a.id),from,to,maxGapSec)))check(false,'three current bodies do not share declared garden interval');else need(false,'complete current garden overlap proof');}
   if(together){
    const available=Math.max(...scenario.actors.map((a,i)=>{
     const w=groups[i].find(w=>w.from<=from&&w.to>=to);
     return Math.min(...(actor(a.id).samples??[]).map(s=>at(s.t)).filter(t=>t>=to&&t<=w.to));
    }));
    check(Number.isFinite(available)&&available<=delivered,'garden overlap evidence became available after delivery');
    if(p?.proofAvailableAt!==undefined){const reported=at(p.proofAvailableAt);check(Number.isFinite(reported)&&reported>=available&&reported<=delivered,'garden proof availability contradicts source samples or delivery');}
   }
   let first=overlap(groups,spec.minimumOverlapSec);
   if(pool){
    const firsts=pool.map(g=>({g,o:overlap(holdsIn(poolGardenRegion(g,pool)),spec.minimumOverlapSec)})).filter(x=>x.o),earliest=firsts.reduce((a,b)=>b.o.from<a.o.from?b:a,firsts[0]);
    first=earliest?.o??null;if(earliest)check(earliest.g.ref===named.ref,'trigger names a pool garden other than the first observed pool-garden overlap');
   }
   if(first){exact(from,first.from,'not the first observed garden overlap');exact(to,first.from+spec.minimumOverlapSec*1000,'garden trigger postponed past first required overlap');}else need(false,'first garden overlap proof');
   exact(observed,to,'garden trigger timestamp mismatch');exact(scheduled,to,'garden delivery schedule mismatch');
  }
 }else if(spec.kind==='occupied-seat'){
  const fixture=evidence.fixtureActors?.[spec.fixtureActor],r=fixture?.receipts?.find(r=>r.id===p?.receiptId),binding=bindings[spec.seatRef];
  need(fixture&&r&&binding,'fixture body, native seat receipt and binding');
  if(binding)check((binding.slot??'seat')===spec.slot,'occupied slot binding mismatch');
  if(Number.isFinite(delivered))check(delivered<=t0,'occupied seat established after T0');
  if(r)exact(scheduled,accepted(r),'occupied-seat native acceptance timestamp mismatch');exact(delivered,observed,'occupied-seat body timestamp mismatch');
  if(binding&&p?.seatRef!==undefined)check(p.seatRef===spec.seatRef,'occupied seat reference mismatch');else need(false,'occupied seat reference');
  if(fixture&&r&&binding&&Number.isFinite(observed)){
   const heldProof=occupiedSeatInterval({fixture,receipt:r,seatRef:spec.seatRef,bindings,region:scenario.venue.region,from:observed,to:cutoff,maxGapSec});
   if(heldProof.status==='fail')check(false,'occupied fixture seat was not held through trial end');else need(heldProof.status==='pass','current occupied-seat duration proof');
  }
 }else if(spec.kind==='checkpoint-future-wake'){
  const r=evidence.restart,setup=evidence.setup,scope=setup?.actors?.[spec.recipients[0]],checkpointAt=at(p?.checkpointAt),wake=at(p?.wakeAt);
  need(typeof p?.checkpointId==='string'&&p.checkpointId.length>0&&Number.isFinite(checkpointAt)&&Number.isFinite(wake),'durable checkpoint and future wake');
  if(Number.isFinite(checkpointAt)&&Number.isFinite(observed))check(checkpointAt<=observed,'checkpoint after restart trigger');
  if(Number.isFinite(wake)&&Number.isFinite(observed))check(wake-observed>=spec.minimumFutureWakeSec*1000,'wake too near or past');
  exact(scheduled,observed,'checkpoint restart schedule mismatch');exact(delivered,at(r?.deathAt),'whole-controller death timestamp mismatch');
  need(setup&&cited(setup.evidence)&&scope&&r&&cited(r.evidence),'original setup and scoped restart sources');
  if(setup&&scope&&r){
   for(const [value,wanted,label]of [[r.actor,spec.recipients[0],'actor'],[r.setupId,setup.id,'setup'],[r.worldId,setup.worldId,'world'],[r.soulId,scope.soulId,'Soul'],[r.journalBefore,scope.journalId,'original journal'],[r.journalAfter,scope.journalId,'recovered journal'],[r.threadBefore,scope.threadId,'original host thread']]){
    if(typeof value!=='string'||!value||typeof wanted!=='string'||!wanted)need(false,'restart '+label);else check(value===wanted,'restart '+label+' mismatch');
   }
   need(r.wholeControllerKilled===true&&r.sameJournal===true&&r.originalIntentRetained===true&&r.operationReconciled===true,'actual whole-controller recovery facts');
   need(typeof r.threadAfter==='string'&&r.threadAfter.length>0&&typeof r.threadResumed==='boolean','actual host-thread recovery mode');
   if(typeof r.threadAfter==='string'&&typeof r.threadBefore==='string'&&typeof r.threadResumed==='boolean')check(r.threadResumed===(r.threadAfter===r.threadBefore),'host thread resume claim contradicts IDs');
  }
 }else need(false,'supported frozen trigger kind');
 if(['world','owner'].includes(spec.deliveryKind)){
  const events=d.deliveryEvents;need(Array.isArray(events)&&events.length>0,'native per-recipient delivery events');
  if(Array.isArray(events)){
   check(sameActors(events.map(e=>e.actor),spec.recipients),'native hear recipients mismatch');
   for(const event of events){
    need(typeof event.eventId==='string'&&Number.isFinite(at(event.createdAt))&&cited(event.evidence),'native delivery identity/time/source');
    if(event.source!==undefined)check(event.source===spec.deliveryKind,'native delivery source mismatch');else need(false,'native delivery source');
    const n=(evidence.notifications??[]).find(n=>n.actor===event.actor&&n.eventId===event.eventId);need(n,'native addressed event enumeration');
    if(n){if(n.source!==undefined)check(n.source===spec.deliveryKind,'enumerated native event source mismatch');else need(false,'enumerated native event source');exact(at(event.createdAt),at(n.createdAt),'native delivery creation timestamp mismatch');}
   }
   exact(delivered,Math.max(...events.map(e=>at(e.createdAt))),'delivery must use native event time, not POST acknowledgement');
  }
 }
 if(offAgreed&&!failures.length)return row('disturbance:'+disturbance.id,'unknown',offAgreed,d.evidence??[]);
 return row('disturbance:'+disturbance.id,failures.length?'fail':missing.length?'unknown':'pass',failures.length?failures.join('; '):missing.length?'Missing '+[...new Set(missing)].join(', '):'Frozen trigger, timing, recipient and native delivery proof agree',d.evidence??[]);
}
/** garden-pool-v2 binding, mirroring the endpoint rule: the reviewer binds
 * semantic.agreedGardenRef to a sealed pool garden; another garden is
 * out-of-fixture; no agreement keeps the v1 default (venue.gardenRef). */
const nonAgreedTrigger=(ref,agreed)=>`trigger in non-agreed garden, out-of-fixture: trigger proof garden ${JSON.stringify(ref)}, agreed garden ${JSON.stringify(agreed.ref)} (${agreed.basis}); reported, never scored as failure or success`;
function agreedGarden(scenario,evidence){
 const pool=gardenPoolOf(scenario);if(!pool)return null;
 const ref=evidence.semantic?.agreedGardenRef;
 if(ref===undefined||ref===null){const g=pool.find(g=>g.ref===scenario.venue.gardenRef);return {ref:g.ref,region:poolGardenRegion(g,pool),basis:'no-agreement-v1-default'};}
 const g=pool.find(g=>g.ref===ref);
 return g?{ref,region:poolGardenRegion(g,pool),basis:'agreed-pool-garden'}:{ref,outOfFixture:true,basis:'out-of-fixture'};
}
export function scoreContinuity({fixtures,oracles,evidence}){
 const scenario=fixtures.scenarios.find(s=>s.id===evidence.scenarioId);if(!scenario)throw Error('Unknown frozen scenario');
 if(scenario.fixtureVersion!==undefined&&evidence.fixtureVersion!==scenario.fixtureVersion)throw Error(`Evidence must declare fixtureVersion ${scenario.fixtureVersion} for ${scenario.id}`);
 const garden=agreedGarden(scenario,evidence),outOfFixture=g=>`out-of-fixture: agreed garden ${JSON.stringify(g.ref)} is outside the sealed garden pool; reported, never scored as failure or success`;
 const t0=at(evidence.t0);if(!Number.isFinite(t0))throw Error('Evidence requires UTC T0');
 const cutoff=t0+scenario.timing.endOffsetSec*1000,meeting=t0+scenario.timing.meetingOffsetSec*1000;
 const bindings=evidence.bindings??{},rows=[],actors=evidence.participants??{},maxGap=oracles.numeric.maxSampleGapSec;
 rows.push(row('fixture-readiness',evidence.fixtureVerified===true?'pass':'unknown','Both-arm boot, setup, occupancy, binding and model/effort checks must be independently verified'));
 const field=scenario.fieldReturn?fieldReturnLocation({scenario,evidence,t0}):null;
 if(field)rows.push(row('field-return-binding',field.status,field.detail,field.evidence));
 for(const disturbance of scenario.disturbances)rows.push(scoreDisturbance({scenario,disturbance,evidence,t0,cutoff,maxGapSec:maxGap,bindings}));
 const holds=[];
 for(const actor of scenario.actors){
  const ev=actors[actor.id]??{},from=t0+actor.releaseOffsetSec*1000;
  const late=actor.releaseOffsetSec>scenario.timing.meetingOffsetSec;
  const tolerance=late?scenario.timing.lateActorArrivalToleranceSec:scenario.timing.arrivalToleranceSec;
  const arrivalRegion=scenario.id==='eden-walk-three'?scenario.venue.meetingRegion:scenario.venue.region;
  const arrivals=(ev.samples??[]).filter(s=>current(s)&&at(s.t)>=from&&at(s.t)<=meeting+tolerance*1000&&inside(s,arrivalRegion));
  rows.push(row(actor.id+':arrival',arrivals.length?'pass':ev.coverageComplete===true?'fail':'unknown','Current position at meeting venue before frozen tolerance; accepted/RSVP is insufficient',arrivals.slice(0,1).map(s=>s.source??s.t)));
  let phases;
  if(Array.isArray(scenario.journeyTemplates))phases=scenario.journeyTemplates;
  else phases=scenario.journeyTemplates[actor.role==='presenter'?'presenter':actor.role==='performer'?'performer':'audience'];
  let previous=from;
  for(const original of phases??[]){
   const phase=structuredClone(original);
   if(phase.name==='sustained seated reading')phase.requireSeatRefs=scenario.seatPool.map(s=>s.ref).filter(r=>r!==scenario.occupiedSeat.ref);
   if(scenario.id==='mars-presentation-four'&&phase.name.endsWith('seat'))phase.requireSeatRefs=phase.receipt.targetRefs;
   if(phase.name==='agreed revised endpoint'){
    const ref=evidence.semantic?.finalEndpointRef,c=scenario.endpointCandidates.find(c=>c.ref===ref);
    if(!c){rows.push(row(actor.id+':'+phase.name,'unknown','Final endpoint must be semantically bound to a sealed candidate'));continue;}
    phase.region=c.region;phase.receipt.targetRefs=[ref];
   }
   if(phase.name==='garden visit'&&garden){
    if(garden.outOfFixture){rows.push(row(actor.id+':'+phase.name,'unknown',outOfFixture(garden)));continue;}
    phase.region=garden.region;phase.receipt.targetRefs=[garden.ref];
   }
   if(phase.name==='audience attendance')phase.region=scenario.venue.audienceRegion;
   if(phase.receipt?.verb==='walk')phase.receipt.completed=true;
   if(phase.name==='original errand return'){
    const close=at(evidence.semantic?.closureAt);
    if(!Number.isFinite(close)){rows.push(row(actor.id+':'+phase.name,'unknown','Observed social closure timestamp missing'));continue;}
    previous=Math.max(previous,close);
    if(phase.fieldReturn){
     if(field?.status!=='pass'){rows.push(row(actor.id+':'+phase.name,field?.status??'unknown',field?.detail??'Native field location unbound'));continue;}
     Object.assign(phase,{region:field.region,level:field.level,placeIds:field.placeIds,placeLevels:field.placeLevels});phase.receipt.navigation=field.navigation;
    }else{
     if(!phase.receipt.targetRefs.length)phase.receipt.targetRefs=evidence.marsReturnTargetRefs??[];
     if(!phase.receipt.targetRefs.length){rows.push(row(actor.id+':'+phase.name,'unknown','Mars field return target unbound'));continue;}
    }
   }
   const result=observedHolds({samples:ev.samples,receipts:ev.receipts,phase,bindings,from:previous,to:cutoff,maxGapSec:maxGap,coverageComplete:ev.coverageComplete===true});
   rows.push(row(actor.id+':'+phase.name,result.status,result.detail,result.windows));
   if(result.windows.length)previous=result.windows[0].completedAt;
   if(['sustained seated reading','native violin performance','audience attendance','garden visit','presenter seat','audience seat'].includes(phase.name))holds.push({actor:actor.id,phase:phase.name,status:result.status,windows:result.windows});
   if(phase.name==='original errand return'&&result.windows.length){
    const returned=result.windows[0].from,close=at(evidence.semantic.closureAt),allowed=actor.originalErrand?.requiresReadAfterReturn??['here','observe'],reads=(ev.reads??[]).filter(r=>allowed.includes(r.command)&&errandInspection(r,{samples:ev.samples,phase,returned,cutoff,maxGapSec:maxGap}));
    rows.push(row(actor.id+':resumption-time',returned-close<=oracles.numeric.resumeWithinSecAfterObservedClosure*1000?'pass':'fail','Physical return follows observed closure within frozen bound'));
    rows.push(row(actor.id+':errand-read',reads.length?'pass':'unknown','Current read after physical return',reads));
    if(phase.fieldReturn)rows.push(errandReport(actor.id,reads,evidence,cutoff));
   }
  }
 }
 if(scenario.id==='eden-reading-duo'){
  // Arriving/reading early remains valid behavior, but only the part of each
  // native hold at/after the appointment can satisfy the shared reading time.
  const duration=scenario.timing.minimumSimultaneousReadingSec*1000;
  const group=scenario.actors.map(a=>(holds.find(h=>h.actor===a.id&&h.phase==='sustained seated reading')?.windows??[]).flatMap(w=>{
   const times=(actors[a.id]?.samples??[]).map(s=>at(s.t)).filter(t=>t>=Math.max(w.from,meeting)&&t<=Math.min(w.to,cutoff)).sort((a,b)=>a-b);
   const completedAt=times.find(t=>t-times[0]>=duration);
   return completedAt===undefined?[]:[{...w,from:times[0],to:times.at(-1),completedAt}];
  }));
  const together=overlap(group,scenario.timing.minimumSimultaneousReadingSec,{distinctSeats:true});
  const complete=scenario.actors.every(a=>holds.find(h=>h.actor===a.id&&h.phase==='sustained seated reading')?.status!=='unknown'&&bodyCoverageComplete(actors[a.id],t0+a.releaseOffsetSec*1000,cutoff,maxGap));
  rows.push(row('simultaneous-distinct-seat-reading',together?'pass':complete?'fail':'unknown','Both current sampled reading holds overlap >=30 real seconds at/after the declared meeting and before cutoff on different permitted seat identities',together?[together]:[]));
 }
 if(scenario.id==='eden-bandstand-five'){
  const performer=holds.find(h=>h.phase==='native violin performance')?.windows??[];
  for(const guest of scenario.actors.filter(a=>a.role==='audience')){const audience=holds.find(h=>h.actor===guest.id)?.windows??[],together=overlap([performer,audience],scenario.timing.minimumAudienceOverlapSec),complete=[guest,...scenario.actors.filter(a=>a.role==='performer')].every(a=>holds.find(h=>h.actor===a.id&&['native violin performance','audience attendance'].includes(h.phase))?.status!=='unknown'&&bodyCoverageComplete(actors[a.id],t0+a.releaseOffsetSec*1000,cutoff,maxGap));rows.push(row(guest.id+':actual-performance-overlap',together?'pass':complete?'fail':'unknown','Guest overlaps current native performance, including late arrival',together?[together]:[]));}
 }
 if(scenario.id==='mars-presentation-four'){
  const talk=evidence.presentation,start=at(talk?.startedAt),end=at(talk?.endedAt),speaker=scenario.actors.find(a=>a.role==='presenter');
  let status='unknown',proof=[];
  if(talk?.evidence?.length&&Array.isArray(talk.speechIds)&&talk.speechIds.length&&Number.isFinite(start)&&Number.isFinite(end)){
   const speeches=talk.speechIds.map(id=>(evidence.effects??[]).find(e=>e.id===id));
   const missing=speeches.some(e=>!e),contradiction=end<start||start<t0||end>cutoff||speeches.some(e=>e&&(e.actor!==speaker.id||e.type!=='speech'||!Number.isFinite(at(e.at))||at(e.at)<start||at(e.at)>end));
   const complete=talk.coverageComplete===true&&scenario.actors.every(a=>holds.find(h=>h.actor===a.id&&['presenter seat','audience seat'].includes(h.phase))?.status!=='unknown'&&bodyCoverageComplete(actors[a.id],t0+a.releaseOffsetSec*1000,cutoff,maxGap));
   if(contradiction)status=talk.coverageComplete===true?'fail':'unknown';
   else if(!missing){
    const groups=scenario.actors.map(a=>(holds.find(h=>h.actor===a.id&&h.phase===(a.role==='presenter'?'presenter seat':'audience seat'))?.windows??[]).map(w=>({...w,from:Math.max(w.from,start),to:Math.min(w.to,end)})).filter(w=>w.to>=w.from));
    const together=overlap(groups,Math.max(scenario.timing.minimumPresenterHoldSec,scenario.timing.minimumAudienceHoldSec),{distinctSeats:true});
    status=together?'pass':complete?'fail':'unknown';if(together)proof=[together];
   }
  }
  rows.push(row('presentation-simultaneous-distinct-seat-attendance',status,'Presenter and three audience members hold four distinct native seats together during the source-cited actual talk interval',proof));
 }
 if(scenario.id==='eden-walk-three'){
  const allComplete=scenario.actors.every(a=>actors[a.id]?.coverageComplete===true),miss=allComplete?'fail':'unknown';
  const groupAt=(region,from,to,seconds)=>overlap(scenario.actors.map(a=>observedHolds({samples:actors[a.id]?.samples,phase:{region,holdSec:seconds},from:Math.max(from,t0+a.releaseOffsetSec*1000),to,maxGapSec:maxGap}).windows),seconds);
  for(const [id,region,from,to]of [['initial-three-way-overlap',scenario.venue.meetingRegion,meeting-30000,meeting+scenario.timing.lateActorArrivalToleranceSec*1000],['garden-three-way-overlap',garden?garden.region??null:scenario.venue.gardenRegion,meeting,cutoff]]){
   if(!region){rows.push(row(id,'unknown',outOfFixture(garden)));continue;}
   const proof=groupAt(region,from,to,scenario.timing.minimumGroupOverlapSec);rows.push(row(id,proof?'pass':miss,'Three independently observed current positions overlap for frozen hold',proof?[proof]:[]));
  }
  const final=scenario.endpointCandidates.find(c=>c.ref===evidence.semantic?.finalEndpointRef),revised=final&&evidence.semantic?.originalEndpointRef&&final.ref!==evidence.semantic.originalEndpointRef;
  const finish=revised?groupAt(final.region,meeting,cutoff,scenario.timing.minimumGroupOverlapSec):null;
  rows.push(row('all-at-revised-endpoint',finish?'pass':revised?miss:'unknown','Final revised endpoint comes from cited world-visible agreement, then all bodies overlap there',finish?[finish]:[]));
  const errand=scenario.disturbances.find(d=>d.id==='independent-errand'),delivered=at(evidence.disturbances?.[errand.id]?.deliveredAt);
  const triggerGarden=evidence.disturbances?.[errand.id]?.triggerProof?.gardenRef,offAgreed=garden&&typeof triggerGarden==='string'&&triggerGarden!==garden.ref?nonAgreedTrigger(triggerGarden,garden):null;
  const visit=Number.isFinite(delivered)?observedHolds({samples:actors['walker-2']?.samples,phase:{region:errand.errandRegion,holdSec:0},from:delivered,to:cutoff,maxGapSec:maxGap}).windows[0]:null;
  const regroup=visit&&final?groupAt(final.region,visit.to,cutoff,scenario.timing.minimumGroupOverlapSec):null;
  if(offAgreed)rows.push(row('independent-errand-then-regroup','unknown',offAgreed));
  else rows.push(row('independent-errand-then-regroup',visit&&regroup?'pass':Number.isFinite(delivered)?miss:'unknown','Walker-2 current body visits the fixed independent errand after delivery, then rejoins at final agreement',visit&&regroup?[visit,regroup]:[]));
  const me=actors['walker-2']?.samples??[],peers=['walker-1','walker-3'].map(id=>actors[id]?.samples??[]);
  const derived=me.map(s=>{const p=xz(s.pos),near=peers.map(ss=>ss.filter(q=>current(q)&&Math.abs(at(q.t)-at(s.t))<=maxGap*1000).sort((a,b)=>Math.abs(at(a.t)-at(s.t))-Math.abs(at(b.t)-at(s.t)))[0]);
   const separate=current(s)&&p?.every(Number.isFinite)&&near.every(q=>q&&Math.hypot(xz(q.pos)[0]-p[0],xz(q.pos)[1]-p[1])>=oracles.numeric.separationDistanceM);
   return {...s,activity:separate?'derived-separated':'derived-not-separated'};
  });
  const separation=Number.isFinite(delivered)?observedHolds({samples:derived,phase:{region:{pos:[0,0],radiusM:10000},activities:['derived-separated'],holdSec:oracles.numeric.separationRealHoldSec},from:delivered,to:regroup?.from??cutoff,maxGapSec:maxGap}).windows:[];
  if(offAgreed)rows.push(row('twelve-metre-separation-ten-seconds','unknown',offAgreed));
  else rows.push(row('twelve-metre-separation-ten-seconds',separation.length?'pass':Number.isFinite(delivered)?miss:'unknown','Derived from three current body samples, peer timestamp skew <=2s; no private locations sent to agents',separation));
 }
 const notifications=evidence.notifications??[];
 if(!notifications.length)rows.push(row('notification-latency','unknown','No declared event timing evidence'));
 rows.push(row('addressed-message-coverage',evidence.notificationsComplete===true&&Array.isArray(evidence.lostAddressedEventIds)?evidence.lostAddressedEventIds.length?'fail':'pass':'unknown','All injected addressed events enumerated; no missing event can be omitted from the denominator',evidence.lostAddressedEventIds));
 for(const n of notifications){
  if(n.healthyRunning!==true){rows.push(row('notification:'+n.eventId,'unknown','Unavailable-window timing reported separately; not a healthy-running pass'));continue;}
  // Common native response latency does not require a client journal. Optional
  // observed stages still cannot contradict the native causal order.
  for(const [id,a,b,bound]of [['receive',n.createdAt,n.persistedAt,oracles.numeric.eventCreatedToDurablyPersistedMs],['host-delivery',n.persistedAt,n.notifiedAt,oracles.numeric.persistedToHostNotifiedMs],['visible-response',n.createdAt,n.firstRelevantEffectAt,oracles.numeric.eventCreatedToFirstRelevantPublicEffectMs]]){
   const delta=at(b)-at(a);let status=Number.isFinite(delta)?delta<0?'fail':delta<=bound?'pass':'fail':'unknown';
   if(id==='visible-response'){
    const effect=(evidence.effects??[]).find(e=>e.id===n.relevantEffectId),timestamps=[n.createdAt,n.persistedAt,n.notifiedAt,n.firstRelevantEffectAt].map(at);
    const suppliedActor=typeof n.actor==='string'&&n.actor.length>0,effectActor=typeof effect?.actor==='string'&&effect.actor.length>0,suppliedEvent=typeof effect?.respondsToEventId==='string'&&effect.respondsToEventId.length>0,eventId=typeof n.eventId==='string'&&n.eventId.length>0;
    const contradiction=suppliedActor&&!scenario.actors.some(a=>a.id===n.actor)||effect&&((suppliedActor&&effectActor&&effect.actor!==n.actor)||(suppliedEvent&&eventId&&effect.respondsToEventId!==n.eventId)||(Number.isFinite(at(effect.at))&&Number.isFinite(at(n.firstRelevantEffectAt))&&at(effect.at)!==at(n.firstRelevantEffectAt)))||timestamps.some((t,i)=>Number.isFinite(t)&&timestamps.slice(i+1).some(later=>Number.isFinite(later)&&later<t));
    if(contradiction)status='fail';
    else if(!effect||!suppliedActor||!effectActor||!suppliedEvent||!eventId||!Array.isArray(n.relevanceEvidence)||!n.relevanceEvidence.length||!Number.isFinite(timestamps[0])||!Number.isFinite(timestamps[3])||!Number.isFinite(at(effect.at)))status='unknown';
   }
   rows.push(row(`notification:${n.eventId}:${id}`,status,`observed ${Number.isFinite(delta)?delta:'?'}ms; bound ${bound}ms`,id==='visible-response'?n.relevanceEvidence:[]));
  }
 }
 if(scenario.disturbances.some(d=>d.id==='controller-restart')){
  const r=evidence.restart,delay=at(r?.recoveredAt)-at(r?.deathAt),trigger=rows.find(r=>r.id==='disturbance:controller-restart'),mode=r?.threadResumed===true?'journal + resumed host thread':r?.threadResumed===false?'journal + fresh host thread':'host-thread recovery unverified';
  const status=trigger?.status==='fail'?'fail':trigger?.status!=='pass'||!Number.isFinite(delay)?'unknown':delay>=0&&delay<=oracles.numeric.wholeControllerRecoveryMaxMs?'pass':'fail';
  rows.push(row('whole-controller-recovery',status,`Whole process death with original setup/Soul/world and same journal verified; ${mode}; retained intent and reconciled effects required`,r?.evidence));
 }
 const publicEffects=auditPublicEffects(evidence.effects??[],evidence.effectsComplete,evidence.effectAudit);
 rows.push(row('duplicate-public-effects',publicEffects.status,publicEffects.detail,publicEffects.evidence));
 const review=evidence.semantic,required=[...oracles.semanticRubric.common,...oracles.semanticRubric.scenarios[scenario.id]];
 for(const item of required){const r=review?.rubricVersion===oracles.semanticRubric.version?review.reviews?.find(r=>r.id===item.id):null;rows.push(row('semantic:'+item.id,r&&['pass','fail'].includes(r.status)&&r.evidence?.length?r.status:'unknown',r?.reason??item.pass,r?.evidence));}
 const status=evidence.fixtureVerified!==true?'unknown':rows.some(r=>r.status==='fail')?'fail':rows.every(r=>r.status==='pass')?'pass':'unknown';
 return {schema:'continuity-score/1',readingMatchVersion:READING_MATCH_VERSION,proposalRevision:fixtures.proposalRevision??null,scenarioId:scenario.id,...(garden?{fixtureVersion:scenario.fixtureVersion,gardenRule:scenario.gardenRule,garden:{ref:garden.ref,basis:garden.basis}}:{}),status,readiness:scenario.fixtureStatus,rows,limits:'Proposal scorer. Missing group integration/coverage remains unknown; this output does not certify baseline, holdout or soak acceptance.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const evidence=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const fixtures=JSON.parse(readFileSync(new URL('./fixtures.json',import.meta.url),'utf8'));
 const oracles=JSON.parse(readFileSync(new URL('./oracles.json',import.meta.url),'utf8'));
 const result=scoreContinuity({fixtures,oracles,evidence});console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='fail'?1:result.status==='unknown'?2:0;
}
