import {ownRequestDiagnosticsV1,type OwnRequestDiagnosticsV1} from './own-request-diagnostics.ts';
import {setImmediate as nextEventLoopTurn} from 'node:timers/promises';
import {HumanGoalStateChanged} from './human-compiler.ts';
import {readHumanCapabilitiesV1} from './human-capabilities.ts';
import type {HumanSteeringOutcomeV1} from '@souls/engine-contract';
import {readIntentArrivalsV1} from './intent-arrivals.ts';
import {intentArrivalQueryV1Schema,INTENT_ARRIVAL_V1} from '@souls/protocol';
// Explicitly injected candidate transport service. Production bootstrap does
// not construct this service or advertise the behavioral version.
import { IntentHistoryReaderV1,IntentHistoryCursorUnavailable } from './intent-history-reader.ts';
import { INTENT_HISTORY_V1,intentHistoryQueryV1Schema,type IntentHistoryPageV1 } from '@souls/protocol';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { INTENT_V2, intentRequestV2Schema, intentSourceV2Schema, intentOwnerControlV2Schema, type IntentOwnerControlV2, type IntentReceiptV2 } from '@souls/protocol';
import { hashToken } from './auth.ts';
import type { Brain } from './brain.ts';
import type { SoulRow } from './db.ts';
import { IntentPublisher, IntentPurposeConflict } from './intent-publisher.ts';
import { IntentRequests, IntentRequestConflict, IntentRequestUnavailable, type IntentRequestScope,
  type RequestReservation } from './intent-requests.ts';
import { ApiError, type Souls } from './souls.ts';
import { checkAcceptanceGuard, type WorldHost } from './world.ts';

type Owned = Extract<RequestReservation,{created:true}>;
export type IntentIdentityV2 = { userId:string; expiresAt:number };
export class IntentControlV2 {
  readonly host:WorldHost; readonly brain:Brain; readonly souls:Souls;
  readonly store:IntentRequests; readonly publisher:IntentPublisher;
  readonly historyReader?:IntentHistoryReaderV1;
  get historyEnabled(){return !!this.historyReader;}
  // Runtime work ownership only; durable reservations retain crash uncertainty.
  private workers = new Set<Promise<void>>();
  private readonly registeredActivitiesV1:boolean;
  private readonly closedGoalsV1:boolean;
  get humanGoalsEnabled(){return this.closedGoalsV1;}
  constructor(host:WorldHost,brain:Brain,souls:Souls,options?:{historyV1?:boolean;closedGoalsV1?:boolean;registeredActivitiesV1?:boolean}) {
    if(brain.host!==host||souls.host!==host||brain.db!==host.db||souls.db!==host.db||!brain.intentV2Enabled)
      throw new Error('candidate intent transport requires one opted-in host/brain/database');
    this.host=host;this.brain=brain;this.souls=souls;this.closedGoalsV1=options?.closedGoalsV1===true;
    this.registeredActivitiesV1=options?.registeredActivitiesV1===true;if(this.registeredActivitiesV1&&!this.closedGoalsV1)throw Error('registered activities require closed steering');
    this.store=new IntentRequests(host.db);this.publisher=new IntentPublisher(host,this.store);
    if(options?.historyV1)this.historyReader=new IntentHistoryReaderV1(this);
  }
  private available(row:SoulRow|undefined):SoulRow {
    if(!row||row.world_id!==this.host.worldId||row.retired_at!==null)throw new ApiError(404,'not-found','no such soul');
    this.souls.requireControlReady(row);
    const body=this.host.engine.world.entities[row.entity_id],mind=this.host.minds.get(row.id);
    if(!body||!mind||mind.owner!==row.owner||this.host.kernel.things[row.id]?.traits.body!==row.entity_id
      ||body.human&&body.human.soul!==row.id)throw new ApiError(409,'not-ready','Soul body is not ready');
    return row;
  }
  ownerScope(identity:IntentIdentityV2,soulId:string,channel:'web'|'api'|'mcp'='web'):IntentRequestScope {
    const read=()=>{
      if(Date.now()>=identity.expiresAt)throw new ApiError(401,'unauthorized','sign in first');
      const user=this.host.db.user(identity.userId);if(!user)throw new ApiError(401,'unauthorized','sign in first');
      this.souls.requireInvited(user);
      const row=this.available(this.host.db.soul(soulId));
      if(!this.souls.owns(user.id,row)&&user.role!=='admin')throw new ApiError(403,'forbidden','not your soul');
      const owner=this.host.db.user(row.owner);if(!owner||!this.souls.invited(owner))throw new ApiError(403,'invite-required','Soul owner needs an invite');
      return {row,user};
    };
    const {row,user}=read(),owner=row.owner,entity=row.entity_id,mind=this.host.minds.get(row.id);
    const source=intentSourceV2Schema.parse({kind:this.souls.owns(user.id,row)?'owner':'operator',ownerId:owner,principalId:user.id,channel});
    return {worldId:this.host.worldId,soulId:row.id,source,currentAuthority:current=>{
      const now=read();return current.owner===owner&&current.entity_id===entity&&now.row.owner===owner
        &&now.row.entity_id===entity&&this.host.minds.get(row.id)===mind;
    }};
  }
  agentScope(token:string|undefined,channel:'api'|'mcp'='api'):IntentRequestScope {
    const unauthorized=()=>new ApiError(401,'unauthorized','missing or invalid Soul credential');
    const refuse=()=>{const r=this.souls.controlRefusal(token);return r.code==='unauthorized'?unauthorized():new ApiError(401,r.code,r.message,r.extra);};
    if(!token?.startsWith('sim_'))throw refuse();
    const hash=hashToken(token),first=this.souls.soulFromToken(token);if(!first)throw refuse();
    const read=()=>{
      const credential=this.souls.agentCredential(token),row=credential?.row;if(!row||row.id!==first.id||row.world_id!==this.host.worldId)throw unauthorized();
      const owner=this.host.db.user(row.owner);if(!owner||!this.souls.invited(owner)||row.retired_at!==null)throw unauthorized();
      return {...credential!,row:this.available(row)};
    };
    let credential=read(),row=credential.row;
    if(credential.kind==='legacy'&&row.token_generation===null) {
      // Compare-and-set lazily assigns an opaque identity to pre14 credentials.
      // Never derive it from, or publish, their bearer/hash material.
      this.host.db.db.prepare('UPDATE souls SET token_generation=? WHERE id=? AND token_hash=? AND token_generation IS NULL')
        .run(`g_${randomUUID()}`,row.id,hash);
      credential=read();row=credential.row;
    }
    const generation=credential.generation,owner=row.owner,entity=row.entity_id,mind=this.host.minds.get(row.id);
    if(!generation)throw new ApiError(503,'unavailable','credential generation unavailable');
    const source=intentSourceV2Schema.parse({kind:'owner-agent',ownerId:owner,principalId:generation,channel});
    return {worldId:this.host.worldId,soulId:row.id,source,currentAuthority:current=>{
      const now=read();if(now.generation!==generation||now.kind!==credential.kind)throw unauthorized();
      return current.owner===owner&&current.entity_id===entity&&now.row.owner===owner&&now.row.entity_id===entity
        &&this.host.minds.get(row.id)===mind;
    }};
  }
  guard(scope:IntentRequestScope) {
    const row=this.available(this.host.db.soul(scope.soulId));
    if(scope.worldId!==this.host.worldId||row.owner!==scope.source.ownerId||scope.currentAuthority(row)!==true)
      throw new IntentRequestUnavailable();
    return true as const;
  }
  /** Read-only human adapter signal. Operator/agent authority does not select
   * the genuine owner's web UI. The transport still rechecks every request. */
  ownerControl(scope:IntentRequestScope):IntentOwnerControlV2|undefined {
    this.guard(scope);
    const row=this.host.db.soul(scope.soulId);if(scope.source.kind!=='owner'||scope.source.channel!=='web'||!row||!this.souls.owns(scope.source.principalId,row))return undefined;
    return intentOwnerControlV2Schema.parse({worldId:this.host.worldId,soulId:scope.soulId,
      ownerId:scope.source.ownerId,...(scope.source.principalId!==scope.source.ownerId?{accountOwnerId:scope.source.principalId}:{}),intentContract:INTENT_V2,...(this.historyEnabled?{intentHistoryContract:INTENT_HISTORY_V1}:{}),...(this.host.extra.intentArrivalV1?{intentArrivalContract:INTENT_ARRIVAL_V1}:{}),...(this.closedGoalsV1?{humanGoalContract:this.registeredActivitiesV1?'human-capabilities/2':'human-capabilities/1'}:{})});
  }
  humanCapabilities(scope:IntentRequestScope){if(!this.closedGoalsV1)throw new ApiError(404,'not-found','human goal registry unavailable');this.guard(scope);const allowed=this.souls.limits.allow(`human-capabilities:${scope.worldId}:${scope.soulId}:${scope.source.principalId}`,120,60_000);if(!allowed.ok)throw new ApiError(429,'rate-limited','too many capability reads');const view=readHumanCapabilitiesV1(this.host,this.host.minds.get(scope.soulId)!,{registeredActivitiesV1:this.registeredActivitiesV1}).view;this.guard(scope);return view;}
  historyCapability(scope:IntentRequestScope){return this.historyReader?.capability(scope);}
  historyPage(scope:IntentRequestScope,query:unknown={}):IntentHistoryPageV1 {
    if(!this.historyReader)throw new ApiError(404,'not-found','intention history unavailable');
    this.guard(scope);
    const allowed=this.souls.limits.allow(`intent-history:${scope.worldId}:${scope.soulId}:${scope.source.principalId}`,120,60_000);
    if(!allowed.ok)throw new ApiError(429,'rate-limited','too many history reads');
    const parsed=intentHistoryQueryV1Schema.parse(query);
    try{return this.historyReader.page(scope,parsed);}
    catch(error){if(error instanceof ZodError)throw new Error('history source validation unavailable');throw error;}
  }
  arrivalsPage(scope:IntentRequestScope,query:unknown={}){
    this.guard(scope);if(!this.host.extra.intentArrivalV1)throw new ApiError(404,'not-found','arrival evidence unavailable');
    const allowed=this.souls.limits.allow(`intent-arrivals:${scope.worldId}:${scope.soulId}:${scope.source.principalId}`,120,60_000);if(!allowed.ok)throw new ApiError(429,'rate-limited','too many evidence reads');
    const q=intentArrivalQueryV1Schema.parse(query);if((q.afterSeq??0)>(q.throughSeq??this.host.seq)||(q.throughSeq??this.host.seq)>this.host.seq)throw new ApiError(400,'invalid-arrival-query','invalid arrival query');
    try{return readIntentArrivalsV1(this,scope,q.afterSeq??0,q.throughSeq??this.host.seq);}catch(error){if(error instanceof ZodError)throw new Error('arrival source validation unavailable');throw error;}
  }
  private version(scope:IntentRequestScope,request:ReturnType<typeof intentRequestV2Schema.parse>) {
    if(!request.edit)return;
    const history=this.host.intentHistoryOf(scope.soulId),entry=Object.hasOwn(history.intents,request.edit.intentId)?history.intents[request.edit.intentId]:undefined;
    if(!entry||entry.revision.version!==request.edit.expectedVersion||entry.status==='withdrawn'&&request.op==='withdraw')
      throw new IntentPurposeConflict();
  }
  async submit(scope:IntentRequestScope,raw:unknown):Promise<IntentReceiptV2> {
    const request=intentRequestV2Schema.parse(raw);this.guard(scope);
    const existing=this.store.lookup(scope,request.requestId);
    if(!existing) {
      this.version(scope,request);
      if(this.workers.size>=64)throw new ApiError(429,'rate-limited','too many directions being interpreted');
      const limit=this.souls.limits.allow(`intent-v2:${scope.worldId}:${scope.soulId}:${scope.source.principalId}`,20,60_000);
      if(!limit.ok)throw new ApiError(429,'rate-limited','too many directions',{retry_after:limit.retryAfter});
    }
    const received=await this.publisher.receive(scope,request);
    this.guard(scope);
    if(!received.request?.received)throw new ApiError(503,'unavailable','request has no recorded receipt; keep its request ID');
    if(received.reservation.created)this.start(scope,received.reservation);
    // Even an immediately completed interpreter returns only recorded facts.
    return this.lookup(scope,request.requestId);
  }
  /** G414 strict own diagnostics through the same authorized lookup; scope re-checked after the read. */
  diagnosticsV1(scope:IntentRequestScope,requestId:string,build?:string):OwnRequestDiagnosticsV1 {
    this.guard(scope);
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(requestId))throw new ApiError(404,'not-found','no such request');
    const allowed=this.souls.limits.allow(`intent-diagnostics:${scope.worldId}:${scope.soulId}:${scope.source.principalId}`,120,60_000);if(!allowed.ok)throw new ApiError(429,'rate-limited','too many diagnostics reads');
    const view=this.store.lookupTimedV1(scope,requestId),receipt=view?.receipt??view?.received,m=this.host.minds.get(scope.soulId);
    if(!view||!receipt||!m||view.source.kind!=='owner')throw new ApiError(404,'not-found','no such request');
    const dto=ownRequestDiagnosticsV1(this.host,m,{requestId,words:view.request.op==='upsert'?view.request.words:undefined,source:view.source as {kind:'owner';ownerId:string;principalId:string;channel:string},createdAt:view.createdAt,updatedAt:view.updatedAt,receipt,build,registeredActivitiesV1:this.registeredActivitiesV1});
    this.guard(scope);if(this.host.minds.get(scope.soulId)!==m||dto.entityId!==m.entityId)throw new ApiError(404,'not-found','no such request');
    return dto;
  }
  lookup(scope:IntentRequestScope,requestId:string):IntentReceiptV2 {
    this.guard(scope);
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(requestId))throw new ApiError(404,'not-found','no such request');
    const view=this.store.lookup(scope,requestId),receipt=view?.receipt??view?.received;
    if(!receipt)throw new ApiError(404,'not-found','no such request');
    this.guard(scope);return receipt;
  }
  private start(scope:IntentRequestScope,reservation:Owned) {
    // Keep the durable receipt outside the synchronous interpretation prefix.
    // Track scheduled work immediately so duplicates and shutdown own one lease.
    // Withdrawal keeps its immediate canonical publication path.
    const started=reservation.request.op==='upsert'
      ?nextEventLoopTurn().then(()=>this.run(scope,reservation))
      :this.run(scope,reservation);
    const work=started.catch(()=>{
      // Persistence failure leaves the existing recorded received receipt. No
      // fabricated terminal success, private error logging or automatic retry.
    });
    this.workers.add(work);void work.finally(()=>this.workers.delete(work));
  }
  private async run(scope:IntentRequestScope,reservation:Owned) {
    const bindingEntityId=this.host.minds.get(scope.soulId)?.entityId;
    let goalGuard:import('./world.ts').AcceptanceGuard|undefined;
    try {
      if(reservation.request.op==='withdraw')await this.publisher.publish(scope,reservation);
      else await this.publisher.interpretAndPublish(scope,reservation,async guard=>{
        checkAcceptanceGuard(guard);
        const mind=this.host.minds.get(scope.soulId)!;
        if(this.closedGoalsV1){if(reservation.request.op!=='upsert')throw Error('closed-goals.upsert-required');const compiled=await this.brain.compileHumanGoalV1(mind,reservation.request.words,reservation.request.strict,guard,this.store.journal(reservation),this.registeredActivitiesV1);checkAcceptanceGuard(guard);if(compiled.kind==='terminal')throw new HumanCompilationStopped(compiled.outcome);goalGuard=compiled.revalidate;return compiled.interpretation;}
        const result=await this.brain.compile(mind,reservation.request.op==='upsert'?reservation.request.words:'','intent-v2',guard,this.store.journal(reservation));
        checkAcceptanceGuard(guard);
        if(!result?.ok||!result.alignment)throw new InterpretationUnavailable();
        return {summary:result.alignment.understanding,agenda:result.agenda,trigger:result.alignment.trigger};
      },()=>{if(goalGuard)checkAcceptanceGuard(goalGuard);return true;});
    } catch(error) {
      // This is private worker history, never physics/fulfilment or public log.
      // The trusted lease can record refusal after revocation; access still
      // requires current authority. Internal/provider errors never escape.
      if(error instanceof HumanCompilationStopped||error instanceof HumanGoalStateChanged){const outcome=error.outcome,code=outcome.kind==='no_action'?'no-action.'+outcome.reason:outcome.kind==='state_blocked'?'state-blocked.'+outcome.code:outcome.kind==='system_unavailable'?'system-unavailable.'+outcome.code:'compilation-failure.'+outcome.code;this.store.finish(reservation,{contract:INTENT_V2,requestId:reservation.request.requestId,phase:'refused',code,reason:outcome.explanation,outcome,...(bindingEntityId?{scope:{worldId:scope.worldId,soulId:scope.soulId,entityId:bindingEntityId,source:scope.source}}:{})});return;}
      const code=error instanceof IntentPurposeConflict?'version-conflict':error instanceof InterpretationUnavailable?'not-understood':
        error instanceof ApiError||error instanceof IntentRequestUnavailable?'authority-changed':'interpretation-unavailable';
      this.store.finish(reservation,{contract:INTENT_V2,requestId:reservation.request.requestId,phase:'refused',code,
        reason:code==='version-conflict'?'The purpose version changed.':code==='authority-changed'?'Authority changed before acceptance.':'This direction could not be interpreted in this world.'});
    }
  }
  /** Drain existing work for a controlled local shutdown/test, never resume or
   * reinterpret crash-pending reservations. Caller still advances the host. */
  async settled() { await Promise.all([...this.workers]); }
}
class HumanCompilationStopped extends Error {readonly outcome:Exclude<HumanSteeringOutcomeV1,{kind:'planned'}>;constructor(outcome:Exclude<HumanSteeringOutcomeV1,{kind:'planned'}>){super('closed human compilation has a recorded non-publication outcome');this.outcome=outcome;}}
class InterpretationUnavailable extends Error {}
export function intentTransportError(error:unknown):ApiError {
  if(error instanceof ApiError)return error;
  if(error instanceof ZodError)return new ApiError(400,'invalid','invalid soul-intent/2 request');
  if(error instanceof IntentRequestConflict||error instanceof IntentPurposeConflict)return new ApiError(409,'conflict','request or purpose version conflicts');
  if(error instanceof IntentRequestUnavailable)return new ApiError(404,'not-found','no such soul');
  return new ApiError(503,'unavailable','direction unavailable; keep its request ID');
}
export function intentLookupError(error:unknown):ApiError {
  if(error instanceof IntentRequestUnavailable||error instanceof ApiError&&[401,403,404,409].includes(error.status))
    return new ApiError(404,'not-found','no such request');
  return new ApiError(503,'unavailable','request lookup unavailable; keep its request ID');
}

export function intentHistoryReadError(error:unknown):ApiError {
  if(error instanceof IntentHistoryCursorUnavailable)return new ApiError(error.expired?410:404,error.expired?'cursor-expired':'cursor-unavailable','History cursor unavailable; request a fresh history page.');
  if(error instanceof ZodError)return new ApiError(400,'invalid-history-query','invalid history query');
  if(error instanceof IntentRequestUnavailable||error instanceof ApiError&&[401,403,404,409].includes(error.status))return new ApiError(404,'not-found','intention history unavailable');
  if(error instanceof ApiError&&error.status===429)return error;
  return new ApiError(503,'history-unavailable','Intention history temporarily unavailable.');
}

export function intentArrivalReadError(error:unknown):ApiError {if(error instanceof ZodError||error instanceof ApiError&&error.status===400)return new ApiError(400,'invalid-arrival-query','invalid arrival query');return intentHistoryReadError(error);}
