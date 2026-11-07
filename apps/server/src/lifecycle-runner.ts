// Internal opt-in native producer. Production bootstrap/HTTP do not install it.
import { TERMINAL } from '@souls/engine-contract';
import { probeNativeHumanBirth } from '@souls/engine-mars';
import { planNativeBirth } from './arrival-placement.ts';
import { soulLifecycleSchema, ownerLifecycleListSchema, type SoulLifecycle } from '@souls/protocol';
import { LifecycleJournal, type LifecycleOperation, type LifecycleScope } from './lifecycle-journal.ts';
import type { WorldHost } from './world.ts';

class LifecycleDeferred extends Error {}
const removalCheckpoint={checkpoint:'lifecycle-removal-confirmed'};
function refers(value:unknown,id:string):boolean {
  if(value===id)return true;
  if(Array.isArray(value))return value.some(v=>refers(v,id));
  return !!value&&typeof value==='object'&&Object.values(value).some(v=>refers(v,id));
}

/** Admission readiness is correspondence, not inactivity or an old revision.
 * Character text can change canonically; the immutable birth description is
 * evidence of admission, not the current row/Mind/kernel character value.
 * The caller still checks current user/invitation/control authority separately. */
export function lifecycleBodyReady(host:WorldHost,op:LifecycleOperation):boolean {
  return ownedBodyCorresponds(host,op.scope,host.currentProfileName(op.scope.soulId,op.name));
}
/** Shared correspondence for an admitted operation or a verified legacy birth.
 * A legacy identity does not need a fabricated lifecycle operation. */
export function ownedBodyCorresponds(host:WorldHost,s:LifecycleScope,name:string):boolean {
  const row=host.db.soul(s.soulId),body=host.engine.world.entities[s.entityId],mind=host.minds.get(s.soulId),thing=host.kernel.things[s.soulId];
  return !!row&&row.retired_at===null&&row.world_id===host.worldId&&s.worldId===host.worldId
    &&row.owner===s.owner&&row.entity_id===s.entityId&&row.name===name
    &&body?.kind==='human'&&body.human?.soul===s.soulId&&body.label===name
    &&!!mind&&mind.entityId===s.entityId&&mind.owner===s.owner&&mind.name===name&&mind.description===row.description
    &&host.mindByEntity.get(s.entityId)===mind&&thing?.kind==='soul'&&thing.name===name
    &&thing.traits.body===s.entityId&&thing.traits.about===row.description&&!!host.kernel.decks[s.soulId];
}
export function lifecycleRemovalSettled(host:WorldHost,op:LifecycleOperation):boolean {
  const s=op.scope,row=host.db.soul(s.soulId);
  return !!row&&row.retired_at!==null&&row.world_id===host.worldId&&s.worldId===host.worldId&&row.owner===s.owner&&row.entity_id===s.entityId
    &&!host.engine.world.entities[s.entityId]&&host.engine.programOf(s.entityId)===null&&!host.engine.actorBorrowed?.(s.entityId)
    &&!host.minds.has(s.soulId)&&!host.mindByEntity.has(s.entityId)&&!host.kernel.things[s.soulId]&&!host.kernel.decks[s.soulId]
    &&!Object.values(host.kernel.things).some(t=>t.by===s.soulId)
    &&!Object.values(host.kernel.links).some(l=>l.from===s.soulId||l.to===s.soulId)
    &&![...host.engine.runtime.records.values()].some(r=>!TERMINAL.has(r.status)&&refers(r.params,s.entityId));
}

export function projectLifecycle(host:WorldHost,op:LifecycleOperation):SoulLifecycle {
  const fresh=new LifecycleJournal(host.db).get(op.scope,op.requestId);
  if(!fresh)throw new Error('Lifecycle projection lost its current private identity');op=fresh;
  const birth=op.operation==='create',complete=op.state==='complete',historical=birth&&complete&&op.retirementAccepted;
  const ready=birth&&complete&&!historical&&lifecycleBodyReady(host,op);
  const state=birth?(op.state==='refused'?'refused':complete?'admitted':'pending'):complete?'retired':'retiring';
  const held=birth&&op.state!=='refused'&&!historical;
  return soulLifecycleSchema.parse({contract:'soul-lifecycle/1',worldId:op.scope.worldId,requestId:op.requestId,
    soulId:op.scope.soulId,entityId:op.scope.entityId,name:op.name,operation:op.operation,state,
    revision:op.revision,requestedAt:op.requestedAt,fact:complete?{seq:op.terminal!.seq,tick:op.terminal!.tick}:null,ready,
    reason:historical?'retirement-accepted':op.state==='refused'?'arrival-unavailable':birth?(ready?null:'reconciling'):complete?null:'removal-pending',
    allocation:{countsTowardLimit:held,reservesName:held}});
}

export class LifecycleRunner {
  host:WorldHost;journal:LifecycleJournal;
  /** Invariant/persistence failures remain visible and require explicit review.
   * They are never ordinary refusal or an implicit logical release. */
  faults=new Map<string,unknown>();
  /** An opt-in installer may reconcile after a committed input settles. Failed
   * or deferred guards never trigger an immediate retry loop. */
  onCommitted?:()=>void;
  private inflight=new Set<string>();
  /** Births queued and not yet settled (lane srv-join-stall). Each birth costs a full detached-world probe when
   * planned and again under the host writer lock; with every pending birth queued at once, one drainInputs ran
   * every guard back to back (4 joins ~ 8 s of one tick on eden2) and /healthz missed its 5 s answer. */
  private births=new Set<string>();
  /** A detached probe already ran in this macrotask. pump plans no further birth while it is set; the host's guard itself
   * always runs. Cleared by whichever of setImmediate / setTimeout(0) fires first: either is a later macrotask, after
   * this one's microtasks (the commit's onCommitted pump) have drained. setImmediate alone was coarser than "this
   * macrotask": a probe made in the check phase stayed set through the next timers phase, so a create accepted in a
   * setTimeout continuation planned no birth until some later pump (srv-r5 gate, lifecycle-ws tests). */
  private probed=false;
  /** A birth was held back by `probed` or by the onApplied hook (`planBirths:false`) while none is in flight: one
   * later pump is owed, run when `probed` clears (else from a setImmediate) (lane srv-r5fix-births). Without it the queue only moved
   * on the next tick or request, so a world driven by drainInputs alone (the commit's own pump lands in the probed
   * macrotask) left every later birth pending. The owed pump never owes another, so a deferred guard cannot spin. */
  private owed=false;private owing=false;private probeGen=0;
  private recoveryAfter:{requestedAt:number;requestId:string}|undefined;
  private authority:(op:LifecycleOperation)=>boolean;
  constructor(host:WorldHost,journal:LifecycleJournal,authority:(op:LifecycleOperation)=>boolean){
    const rules=host.engine.rulesVersion,removal=rules.match(/\+crew-removal\/[^+]+/g)??[];
    if(host.db!==journal.db||!rules.startsWith('sim-mars/1+')||removal.length!==1||removal[0]!=='+crew-removal/1'
      ||host.factory.canReplayHistory?.(rules)!==true||host.factory.canRestoreSnapshot?.(rules)!==true)
      throw new Error('Lifecycle runner needs its native host journal and qualified crew-removal policy');
    this.host=host;this.journal=journal;this.authority=authority;
  }
  private current(op:LifecycleOperation){const current=this.journal.get(op.scope,op.requestId);if(!current||current.state!==op.state)throw new LifecycleDeferred('Lifecycle state changed');return current;}
  private spendProbe(){
    if(this.probed)return;this.probed=true;
    // Cleared by whichever of setImmediate / setTimeout(0) fires first (lane srv-r5fix-ws); the generation keeps the
    // later of the pair from clearing a newer probe's flag.
    const gen=++this.probeGen,clear=()=>{if(gen!==this.probeGen||!this.probed)return;this.probed=false;this.settleOwed();};
    setImmediate(clear).unref?.();setTimeout(clear,0).unref?.();
  }
  private owe(){
    if(this.owed||this.owing)return;this.owed=true;
    if(!this.probed)setImmediate(()=>this.settleOwed()).unref?.();
  }
  private settleOwed(){
    if(!this.owed)return;this.owed=false;this.owing=true;
    // Opportunistic: a host stopped or a db closed before this check phase is not a lifecycle fault.
    try{this.pump();}catch{}finally{this.owing=false;}
  }
  private queue(op:LifecycleOperation,promise:Promise<unknown>,birth=false){
    this.inflight.add(op.requestId);if(birth)this.births.add(op.requestId);
    void promise.then(()=>{
      this.inflight.delete(op.requestId);this.births.delete(op.requestId);this.onCommitted?.();
    },error=>{
      this.inflight.delete(op.requestId);this.births.delete(op.requestId);
      if(!(error instanceof LifecycleDeferred))this.faults.set(op.requestId,error);
    }).catch(error=>this.faults.set(op.requestId,error));
  }
  /** Explicit bounded reconciliation, invoked after boot and on owned ticks by
   * a future opt-in installer. It creates no timers, paid work or default hooks. */
  /** `planBirths:false` (the host's onApplied hook): an event applied inside drainInputs plans no birth there, since
   * the same tick's durable second drain would then run that birth's guard probe too (two probes in one tick, seen in
   * the profiled join); afterTick, the create's commit and committed promises plan births instead. */
  pump(planBirths=true){
    const page=this.journal.recover(this.host.worldId,20,this.recoveryAfter),last=page.at(-1);
    // Round-robin keyset scanning prevents twenty deferred requests from
    // starving later work. This is a bounded scan, not a capacity claim.
    this.recoveryAfter=page.length===20&&last?{requestedAt:last.requestedAt,requestId:last.requestId}:undefined;
    for(const op of page){
      if(this.inflight.has(op.requestId)||this.faults.has(op.requestId))continue;
      // At most one lifecycle birth in flight, and none planned in a macrotask that already probed: later births stay
      // pending in request order and are planned by a later pump (next tick, request or commit), so no single tick or
      // handler runs more than one detached probe. The create's HTTP wait still answers lifecycle-pending at 2 s.
      if(op.operation==='create'&&op.state!=='recorded'&&(!planBirths||this.births.size>0||this.probed)){
        // With a birth in flight its commit pumps again; otherwise one check-phase pump is owed.
        if(this.births.size===0)this.owe();continue;
      }
      try{this.advance(op);}catch(error){if(!(error instanceof LifecycleDeferred))this.faults.set(op.requestId,error);}
    }
  }
  private advance(op:LifecycleOperation){
    const s=op.scope;
    if(op.state==='recorded'){
      if(op.operation==='create'){
        if(!lifecycleBodyReady(this.host,op))throw new Error('Accepted lifecycle birth lacks its canonical body/kernel/Mind');
        this.journal.complete(s,op.requestId,()=>lifecycleBodyReady(this.host,this.current(op)));return;
      }
      if(!lifecycleRemovalSettled(this.host,op))return;
      const guard=()=>{this.current(op);if(!lifecycleRemovalSettled(this.host,op))throw new LifecycleDeferred('Removal still owns native obligations');return true as const;};
      this.queue(op,this.host.enqueueChecked('rules','world',removalCheckpoint,guard,e=>this.journal.linkRemovalComplete(s,op.requestId,e,guard)));return;
    }
    if(op.operation==='retire'){
      const guard=()=>{this.current(op);const row=this.host.db.soul(s.soulId);if(!row||row.retired_at===null)throw new Error('Durable retirement lost its revocation');return true as const;};
      this.queue(op,this.host.enqueueChecked('retire',`soul:${s.soulId}`,{soulId:s.soulId,entityId:s.entityId},guard,e=>this.journal.linkAccepted(s,op.requestId,e,guard)));return;
    }
    // arrival-search/1 (lane ARR): when the arrival point cannot take the Soul (built over, walled in, under water,
    // crowded) the birth lands on the nearest open standing ground instead, recorded in the birth as birth-near/1
    // {at, first:true}, so replay is exact. Planned once; the guards re-probe that same placement.
    const who={id:s.entityId,label:op.name,soul:s.soulId};
    const checks=()=>{
      this.current(op);if(!this.authority(op))throw new LifecycleDeferred('Current admission authority is unavailable');
      const row=this.host.db.soul(s.soulId);
      if(!row||row.retired_at!==null)throw new Error('Pending lifecycle birth lost its owned reservation');
      if(this.host.minds.has(s.soulId)||this.host.mindByEntity.has(s.entityId)||this.host.kernel.things[s.soulId]||this.host.kernel.decks[s.soulId])throw new Error('Pending lifecycle birth already owns canonical Mind/kernel identity');
    };
    checks();
    this.spendProbe();
    const {probe:preview,near}=planNativeBirth(this.host,who);
    const probe=()=>{checks();this.spendProbe();return probeNativeHumanBirth(this.host.engine,this.host.factory,{...who,...(near?{near}:{})});};
    if(preview.outcome==='deferred')return;
    if(preview.outcome==='unavailable'&&preview.diagnostic.code==='birth.arrival-unavailable'){
      this.journal.refuseArrival(s,op.requestId,()=>{
        checks();const current=planNativeBirth(this.host,who).probe;return current.outcome==='unavailable'&&current.diagnostic.code==='birth.arrival-unavailable'
          &&!this.host.engine.world.entities[s.entityId]&&!this.host.minds.has(s.soulId)&&!this.host.kernel.things[s.soulId];
      });return;
    }
    if(preview.outcome!=='ready')throw new Error('Pending lifecycle birth has an unexpected existing/conflicting identity');
    // Probe again under the host writer lock, after any preceding queued event.
    // A changed placement remains pending; it is reclassified only by pump's
    // exact ordinary-unavailable path, never an arbitrary exception handler.
    const guard=()=>{const p=probe();if(p.outcome!=='ready')throw new LifecycleDeferred('Native admission changed');return true as const;};
    // The journal link runs inside the same host write transaction, synchronously after `guard` above (drainInputs:
    // BEGIN IMMEDIATE, guard, append, link), with no engine change in between, so it re-checks the identity/authority
    // (checks) but not the native placement: that second detached-engine probe was a full snapshot+restore of the world
    // (~0.7 s laptop, ~2 s eden2 per Soul) answering the same question on the same state (lane srv-join-stall).
    const linkGuard=()=>{checks();return true as const;};
    const payload={soulId:s.soulId,entityId:s.entityId,owner:s.owner,name:op.name,description:op.description,...(near?{near}:{})};
    this.queue(op,this.host.enqueueChecked('birth',op.native?'world':`soul:${s.soulId}`,payload,guard,e=>this.journal.linkAccepted(s,op.requestId,e,linkGuard,near)),true);
  }
  ownerPage(owner:string,cursor:string|null=null,associated:readonly string[]=[]){
    const page=this.journal.ownerPage(this.host.worldId,owner,cursor,associated);
    return ownerLifecycleListSchema.parse({contract:'owner-lifecycle-list/1',worldId:this.host.worldId,
      requests:page.operations.map(op=>projectLifecycle(this.host,op)),nextCursor:page.nextCursor});
  }
}
