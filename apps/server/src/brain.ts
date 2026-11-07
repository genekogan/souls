import {nativeActivityContextV1} from './native-activity-context.ts';
import {isVerificationProbe} from './verification-probe.ts';
import {latestPurposeDirectionV1} from './latest-purpose-direction.ts';
import {purposeEpisodesV1,episodeJournalV1,purposeExperienceContextV1} from './purpose-episodes.ts';
import {compileHumanGoalV1,type ClosedHumanResultV1} from './human-compiler.ts';
import {withHumanSleepStopReadV1} from './human-sleep-transition.ts';
import {purposeContextEvidenceV1,indexPurposeAttemptsV1} from './purpose-context-evidence.ts';
import {recallPurposesV1} from './purpose-recall.ts';
import {retainedPurposeChoicesV1,retainedChoiceKeyV1} from './retained-purpose-choice.ts';
// The three-tier brain, server side. Schedules calls, records every request
// and response for the debug shell, and turns answers into logged events.
import type { Entity } from '@souls/engine-contract';
import {describeBodyLocation} from '@souls/engine-contract';
import {
  JEV_MODEL, JevClient, buildDirectorRequest, buildMidRequest, buildShotRequest, buildTranslateRequest, callNarrator, buildNarratorRequest, fallbackMid, fingerprint,
  haikuTranslate, interpretDirector, interpretMid, interpretTranslate, sanitize,
  buildAttuneRequest, interpretAttune, callTool, cardGrammar, cleanLines, compileUser, plainLine, talkUser, COMPILER_PREAMBLE, COMPILE_TOOL, TALK_SYSTEM, TALK_TOOL,
  type CompileOut, type SpokenLine, type TalkInput, type PaidGate, clockAt, reflectInCode,
  type DirectorContext, type MidContext, type RegionDigest, type ShotCandidate, type Target, type Translation, type ChoiceA,
} from '@souls/brain';
import { GOALS, describeIntent, publicIntent, mandateTriggerSchema, type Alignment, type Beat, type BrainCall, type CameraLine, type DecisionPayload, type EventKind, type LogEvent, type NarrativeView, type ScenePayload, type TalkLine, type TickerLine, type WireIntent } from '@souls/protocol';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { checkAcceptanceGuard, energyWord, hash32, IntentAdmissionDeferred, StaleIntentAttempt, PersistedIntentAdmissionFault, type AcceptanceGuard, type AcceptanceJournal, type Mind, type WorldHost } from './world.ts';
import { StaleCompilation } from './compile-fence.ts';
import { Governor, SHARES, tierOf, type Tier } from './governor.ts';
import { awaiting, belongsTo, candidatesFor, optionsFor, situationOf, matchesStep, type CardOption } from './deck.ts';
import {mandateOf,triggerDue} from './mandate.ts';
import {blockedDirectionForRetry} from './intent-retry.ts';
import { SPEECH_LINKS, cardHash, validateCard, type Card, type LinkKind, type MintedCard } from '@souls/kernel';

const TPS = 20;
const MAX_INFLIGHT = 8;
const DIRECTOR_EVERY = TPS * 6;
const SHOT_COMMIT_TICKS = TPS * 10;
const NARRATE_EVERY = TPS * 60 * 5;

export type BrainSink = { onCall(c: BrainCall): void; onCamera(l: CameraLine): void; onTicker(l: TickerLine[]): void; onNarrative(v: NarrativeView): void; onTalk?(l: TalkLine[]): void; clients(): number };
export type MintVerdict = { name: string; ok: boolean; problems?: string[]; hash?: string };
type NarratorState = { nextRun: Record<string, number>; lastSummary: Record<string, string | null> };

export class Brain {
  jev: JevClient;
  mode: 'live' | 'fake';
  gov: Governor;
  /** The hard cap counts durable cost reservations in the rolling real 24 hours. */
  capSince = 0;
  get budget() { return this.gov.budget; }
  private budgetLimit:1|3=1;
  get thinkingBudgetCeiling(){return this.budgetLimit;}
  set budget(b: number) { this.gov.setBudget(Number.isFinite(b) ? Math.max(0, Math.min(this.budgetLimit, b)) : 0); }
  /** Gene-authorized localhost preview override; normal releases use the separately pinned configuration. */
  enableLocalBudgetV1(){
    const url=new URL(this.cfg.publicUrl);
    if(this.cfg.worldKey!=='eden'||url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('local-budget.loopback-required');
    this.budgetLimit=3;this.budget=this.cfg.budgetUsdPerDay;
  }
  readonly paidGate: PaidGate;
  inflight = new Set<string>();
  /** The latest rendered words from one Soul to another (colour for the listener's mind). */
  private lastWords = new Map<string, string>();
  private nextTalkId = 1;
  private lastServed = new Map<string, number>(); // soulId → tick of the last paid model call
  spentToday = 0; callsToday = 0; jevMsAvg = 0;
  camera: CameraLine | null = null;
  private shotId = ''; private shotSinceTick = 0;
  ticker: TickerLine[] = [];
  narratives = new Map<string, NarrativeView>();       // latest per region
  private pendingBeats: { fireTick: number; region: string; narrative: number; beat: Beat; index: number }[] = [];
  private narrating = new Set<string>();
  private directing = false;
  private reflecting = new Set<string>();
  private ruleUpdates=new Set<string>();
  private tickerCandidates: { id: string; text: string; tick: number }[] = [];
  host: WorldHost; db: Db; cfg: Config; sink: BrainSink;
  private readonly compilerCall: typeof callTool;
  private readonly injectedCompiler:boolean;
  /** Optional native-cast boundary. Rechecked before durable decisions so pairing takes effect immediately. */
  private readonly skipMind?: (mind: Mind) => boolean;
  private readonly nativeProgramAllowed?: (mind: Mind, steps: DecisionPayload['steps']) => boolean;
  /** Isolated backend qualification switch. No environment/route activation. */
  private readonly intentV2Choices: boolean;
  private readonly intentV2Retries: boolean;
  private readonly nativeActivityContext: boolean;
  get intentV2Enabled() { return this.intentV2Choices; }
  private purposeWakes = new Map<string, { intentId: string; version: number }>();
  private edenAutonomyV1=false;
  /** Explicit local/operator selection; uses the existing Mars mid-brain,
   * never a direct movement or replacement of the owner's intentions. */
  enableEdenAutonomyV1(){
    if(this.cfg.worldKey!=='eden')throw Error('eden-autonomy.world-differs');
    this.edenAutonomyV1=true;
    return this.host.enqueue('rules','operator:eden-autonomy',{worldEvent:{id:'eden-autonomy-enabled',text:'The residents may choose what to do in the world.'},why:'enable ordinary autonomous thought while retaining owner intentions and model budget'});
  }
  private quiescing=false;
  private work=new Set<Promise<unknown>>();
  private maintenance:ReturnType<typeof setInterval>;
  /** Stop new thought/IO; already accepted work drains with DB/clock open. */
  quiesce(){this.quiescing=true;clearInterval(this.maintenance);}
  async settled(){while(this.work.size)await Promise.allSettled([...this.work]);}
  private async track<T>(run:()=>Promise<T>):Promise<T>{
    const work=run();this.work.add(work);try{return await work;}finally{this.work.delete(work);}
  }


  constructor(host: WorldHost, db: Db, cfg: Config, sink: BrainSink, services?: { compilerCall?: typeof callTool; intentV2Choices?: boolean; intentV2Retries?: boolean; nativeActivityContextV1?:boolean; skipMind?: (mind: Mind) => boolean; nativeProgramAllowed?: (mind: Mind, steps: DecisionPayload['steps']) => boolean }) {
    this.host = host; this.db = db; this.cfg = cfg; this.sink = sink;
    this.skipMind = m => isVerificationProbe(m.soulId) || !!services?.skipMind?.(m);
    this.nativeProgramAllowed = services?.nativeProgramAllowed;
    this.compilerCall = services?.compilerCall ?? callTool;this.injectedCompiler=!!services?.compilerCall;
    this.nativeActivityContext = services?.nativeActivityContextV1 === true;
    this.intentV2Choices = services?.intentV2Choices === true;
    this.intentV2Retries = this.intentV2Choices && services?.intentV2Retries === true;
    if(cfg.thinkingBudgetCeiling===3){if(cfg.worldKey!=='eden'||cfg.engine!=='mars'||cfg.worldId!==host.worldId||db!==host.db||!cfg.authorizedThinkingWorldId||cfg.authorizedThinkingWorldId!==cfg.worldId)throw Error('thinking-budget.explicit-Eden-world-authorization-required');this.budgetLimit=3;}
    this.mode = cfg.brainMode; this.gov = new Governor(Number.isFinite(cfg.budgetUsdPerDay)?Math.max(0,Math.min(this.budgetLimit,cfg.budgetUsdPerDay)):0);
    this.paidGate = (bound, model) => db.reserveCost(bound, model, this.budget,Date.now(),this.budgetLimit);
    db.backfillSpend();
    this.jev = new JevClient(cfg.typesafeKey, this.mode);
    this.jev.gate = this.paidGate;
    const t = db.brainToday(this.capSince); this.spentToday = t.cost; this.callsToday = t.calls; this.jevMsAvg = t.jevMs;
    host.listeners.push({ afterTick: (tick) => this.afterTick(tick), onApplied: (e) => this.onApplied(e), onPlay: (v) => { for (const c of v.changes) if (c.op === 'say' && host.kernel.things[c.to]?.kind === 'soul') void this.speak(c.from, c.to, c.act, typeof c.about === 'string' ? c.about : undefined, c.manner); } });
    this.maintenance=setInterval(() => { const t = this.db.brainToday(this.capSince); this.spentToday = t.cost; this.callsToday = t.calls; this.db.pruneBrainCalls(); }, 60_000);this.maintenance.unref();
  }

  setMode(m: 'live' | 'fake') { this.mode = m; this.jev.mode = this.cfg.typesafeKey ? m : 'fake'; }
  get overBudget() { return this.db.paidCost() >= this.budget; }
  private get narratorState(): NarratorState {
    const x = this.host.extra as { narrator?: NarratorState };
    if (!x.narrator) x.narrator = { nextRun: Object.fromEntries(this.regions().map((r, i) => [r, this.host.engine.world.tick + TPS * (40 + 150 * i)])), lastSummary: {} };
    return x.narrator;
  }

  private record(c: Omit<BrainCall, 'id' | 'at'>): number {
    const full = { ...c, at: Date.now() };
    // long system prompts are stored once and referenced by hash
    const sys = (full.request as any)?.system?.[0];
    if (sys?.text && sys.text.length > 2000) full.request = { ...(full.request as object), system: [{ ...sys, text: this.db.internPrompt(sys.text) }] };
    const id = this.db.saveBrainCall(this.host.worldId, full);
    this.spentToday += c.costUsd; this.callsToday++;
    if (c.mode === 'live') this.gov.charge(tierOf(c.tier), c.costUsd);
    if (c.tier === 'mid' && c.mode === 'live') this.jevMsAvg = this.jevMsAvg ? this.jevMsAvg * 0.9 + c.ms * 0.1 : c.ms;
    this.sink.onCall({ ...full, id });
    return id;
  }

  // ------------------------------------------------------------ spend
  spendReport() {
    const now = Date.now(), H = 3600_000;
    const sum = (rows: { tier: string; calls: number; cost: number }[]) => {
      const byTier: Record<string, { calls: number; cost: number }> = {};
      for (const r of rows) { const t = tierOf(r.tier); byTier[t] = { calls: (byTier[t]?.calls ?? 0) + Number(r.calls), cost: (byTier[t]?.cost ?? 0) + Number(r.cost ?? 0) }; }
      return { total: Object.values(byTier).reduce((a, b) => a + b.cost, 0), calls: Object.values(byTier).reduce((a, b) => a + b.calls, 0), byTier };
    };
    const dayStart = new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
    const monthStart = new Date(new Date(now).toISOString().slice(0, 7) + '-01T00:00:00Z').getTime();
    const actual = {
      last15m: sum(this.db.spendRecent(now - 15 * 60_000)),
      last1h: sum(this.db.spendRecent(now - H)),
      last24h: sum(this.db.spendSince(now - 23 * H)),
      today: sum(this.db.spendSince(dayStart)),
      last7d: sum(this.db.spendSince(now - 7 * 24 * H)),
      thisMonth: sum(this.db.spendSince(monthStart)),
      allTime: sum(this.db.spendSince(0)),
    };
    // Projections: the recent trend, and what the governor will actually allow (it caps each tier at its share).
    const perDayTrend = actual.last1h.total * 24;
    const perDayGoverned = Math.min(perDayTrend, this.budget);
    const hoursLeftToday = (dayStart + 24 * H - now) / H;
    const daysInMonth = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 0)).getUTCDate();
    const daysLeftMonth = (monthStart + daysInMonth * 24 * H - now) / (24 * H);
    const projected = {
      basis: 'rate over the last hour',
      perHour: actual.last1h.total, perDayTrend, perDayGoverned,
      perWeek: perDayGoverned * 7, perMonth: perDayGoverned * 30, perYear: perDayGoverned * 365,
      endOfToday: actual.today.total + (perDayGoverned / 24) * hoursLeftToday,
      endOfMonth: actual.thisMonth.total + perDayGoverned * daysLeftMonth,
      byTierPerDay: Object.fromEntries((Object.keys(SHARES) as Tier[]).map((t) => [t, Math.min((actual.last1h.byTier[t]?.cost ?? 0) * 24, this.gov.perDay(t))])),
    };
    return {
      at: now, budgetPerDay: this.budget, ceilingPerDay:this.thinkingBudgetCeiling, mode: this.mode, hardCapHit: this.overBudget, capSpent: this.db.paidCost(), capSince: this.capSince,
      actual, projected, governor: this.gov.view(),
      hourly: this.db.spendHourly(24).map((r) => ({ ...r, tier: tierOf(r.tier) })),
      byModel: this.db.spendByModel(),
      since: this.db.spendFirstHour() ? this.db.spendFirstHour()! * H : null,
      pricing: { jev: '$0.042 per million input tokens; output free', haiku: '$1 / $5 per million input / output tokens; cache write $1.25, cache read $0.10' },
    };
  }

  // ------------------------------------------------------------ per tick
  private afterTick(tick: number) {
    // Edge worlds: owners' agents choose; the world runs no Soul decisions, talk, reflection or director (zero world-side model spend).
    if (this.cfg.mindDriver === 'edge') return;
    if(this.quiescing)return;
    const w = this.host.engine.world;
    const day=this.host.living;
    if(day&&tick%20===0){const c=clockAt(tick,day.origin,day.dayTicks);for(const m of this.host.minds.values())for(const r of this.skipMind?.(m)?[]:mandateOf(this.host.kernel,m.soulId)){
      if(this.ruleUpdates.has(r.id))continue;
      const matched=r.trigger.kind==='gathering'?Object.values(this.host.kernel.links).some(l=>l.kind==='hosts'&&l.from===(r.trigger as {host:string}).host&&this.host.kernel.things[l.to]?.kind==='gathering'):false;
      if(triggerDue(r,this.host.kernel,c.day,c.hour+c.minute/60)){
        this.ruleUpdates.add(r.id);void this.enqueueNative(m,'mandate','world',{soulId:m.soulId,ruleId:r.id,op:'wake',patch:{lastFiredDay:c.day,...(r.trigger.kind==='gathering'?{conditionMatched:true}:{})}}).finally(()=>this.ruleUpdates.delete(r.id));
      }else if(r.trigger.kind==='gathering'&&r.conditionMatched&&!matched){this.ruleUpdates.add(r.id);void this.enqueueNative(m,'mandate','world',{soulId:m.soulId,ruleId:r.id,op:'condition',patch:{conditionMatched:false}}).finally(()=>this.ruleUpdates.delete(r.id));}
    }}
    // Tier 2: mid-brain, per Soul, when due. Fair order: owner intents first, then whoever has waited longest,
    // so a fixed iteration order can never let a few Souls take the whole mid-brain share.
    if (this.inflight.size < MAX_INFLIGHT) {
      const due: Mind[] = [];
      for (const m of this.host.minds.values()) {
        if (this.skipMind?.(m) || this.host.quietBarrier || m.nextEvalTick > tick || this.inflight.has(m.soulId) || !w.entities[m.entityId]) continue;
        const hasWork = this.cfg.worldKey !== 'eden' || this.edenAutonomyV1 || m.agendaPos < m.agenda.length
          || mandateOf(this.host.kernel,m.soulId).some(r=>r.status==='active')
          || this.intentV2Choices && Object.values(this.host.intentHistoryOf(m.soulId).intents)
            .some(e=>e.status==='active' && e.revision.source.ownerId===m.owner);
        if (hasWork && !(m.life && this.host.engine.actorBorrowed?.(m.entityId) && !URGENT.has(m.evalTrigger))) due.push(m);
      }
      if (due.length) {
        due.sort((a, b) => prio(a.evalTrigger) - prio(b.evalTrigger) || (this.lastServed.get(a.soulId) ?? 0) - (this.lastServed.get(b.soulId) ?? 0) || (a.soulId < b.soulId ? -1 : 1));
        for (const m of due) { if (this.inflight.size >= MAX_INFLIGHT) break; void this.evaluate(m, m.evalTrigger || 'timer'); }
      }
    }
    // expire nudges
    if (tick % TPS === 0) for (const m of this.host.minds.values()) if (!this.skipMind?.(m) && m.nudge && m.nudge.untilTick < tick) m.nudge = null;
    // Tier 3 beats firing
    while (this.pendingBeats.length && this.pendingBeats[0].fireTick <= tick) {
      const b = this.pendingBeats.shift()!;
      void this.host.enqueue('scene', `narrator:${b.region}`, { region: b.region, narrative: b.narrative, beat: b.beat } satisfies ScenePayload);
      const v = this.narratives.get(b.region);
      if (v && v.id === b.narrative && v.beats[b.index]) { v.beats[b.index].fired = true; this.db.updateNarrative(v.id, v); this.sink.onNarrative(v); }
    }
    // Tier 3: narrator per region, staggered
    if (!this.host.living) { const ns = this.narratorState;
      for (const region of this.regions()) if ((ns.nextRun[region] ?? 0) <= tick && !this.narrating.has(region)) void this.narrate(region, 'schedule');
    }
    if (this.host.living) {
      const c = clockAt(tick, this.host.living.origin, this.host.living.dayTicks);
      if (c.phase >= 0.55) for (const m of this.host.minds.values()) if (m.life && m.life.reflectedDay < c.day && !this.reflecting.has(m.soulId)) void this.reflect(m, c.day);
    }
    // Tier 2b: director + ticker, only while someone is watching
    if (tick % DIRECTOR_EVERY === 0 && !this.directing && this.sink.clients() > 0) void this.direct();
  }

  private onApplied(e: LogEvent) {
    if (typeof e.payload?.soulId === 'string' && isVerificationProbe(e.payload.soulId)) return;
    if (this.intentV2Choices && e.kind === 'intent-v2') {
      const m = this.host.minds.get(e.payload.soulId);
      if (m) {
        if (e.payload.op === 'upsert') this.purposeWakes.set(m.soulId, { intentId: e.payload.revision.intentId, version: e.payload.revision.version });
        else this.purposeWakes.delete(m.soulId);
        m.nextEvalTick = e.tick + 1; m.evalTrigger = 'new-intent-v2'; m.lastFingerprint = '';
      }
    }
    if (e.kind === 'birth') { const m = this.host.minds.get(e.payload.soulId); if (m) void this.attune(m); }
    const line = tickerText(e, this.host);
    if (line) { this.tickerCandidates.push({ id: String(e.seq), text: line, tick: e.tick }); if (this.tickerCandidates.length > 30) this.tickerCandidates.shift(); }
  }

  // ------------------------------------------------------------ tier 2: mid-brain
  midContext(m: Mind, trigger: string, deferUnusedOptions=false): Omit<MidContext, 'options'> & { options: CardOption[]; actingPurpose?: { intentId:string; version:number } } {
    const eng = this.host.engine, w = eng.world, ent = w.entities[m.entityId], k = this.host.kernel;
    const nameOf = (id: string) => this.host.nameOf(id);
    const s = eng.describeSurroundings(m.entityId);
    const intentText = m.intent ? describeIntent({ ...m.intent, note: undefined, text: undefined } as WireIntent, nameOf) : 'none';
    const sit = situationOf(this.host, m);
    const boatControls=eng.observeBoatControls?.(m.entityId);
    const bodyLocation=eng.observeBodyLocation?.(m.entityId);
    const nativeActivities=this.nativeActivityContext?nativeActivityContextV1(this.host,m):undefined;
    const physicalWhere=bodyLocation===undefined?undefined:bodyLocation===null?'physical location unavailable':describeBodyLocation(bodyLocation);
    const physicalSituation=boatControls?[
      `The nearby boat is ${boatControls.phase}. ${boatControls.holder===m.entityId?'You hold its helm.':boatControls.holder?'Another passenger holds its helm.':'No passenger holds its helm.'}`,
      `Taking the helm is ${boatControls.take.available?'physically available':`unavailable: ${boatControls.take.reason!.message}`}.`,
      `Releasing the helm is ${boatControls.release.available?'physically available':`unavailable: ${boatControls.release.reason!.message}`}.`,
    ]:[];
    const deck = k.decks[m.soulId];
    const rules=mandateOf(k,m.soulId).filter(r=>r.status==='active').sort((a,b)=>Number(b.strict)-Number(a.strict));
    const history = this.intentV2Choices ? this.host.intentHistoryOf(m.soulId) : undefined;
    const purposeAttempts=this.host.extra.intentPurposeEvidenceV1&&history?indexPurposeAttemptsV1(history):undefined;
    const retained = history ? Object.values(history.intents)
      .filter(e => e.status !== 'withdrawn' && e.status !== 'fulfilled' && e.revision.source.ownerId === m.owner)
      .sort((a,b) => Number(b.revision.strict)-Number(a.revision.strict) || b.revision.importance-a.revision.importance || b.revision.submitted.seq-a.revision.submitted.seq) : [];
    // First native bridge: a newly published, single-step ordinary direction.
    // Standing/time/group and multi-step purposes remain private context until
    // their trigger/progress adapters are qualified. Never mutate legacy plans.
    const immediate = trigger === 'new-intent-v2' && !m.activeRule && m.agendaPos >= m.agenda.length
      ? retained.find(e => e.revision.intentId === this.purposeWakes.get(m.soulId)?.intentId && e.revision.version === this.purposeWakes.get(m.soulId)?.version
        && e.status === 'active' && e.revision.interpretation.trigger.kind === 'now' && e.revision.interpretation.agenda.length === 1) : undefined;
    const retry = this.intentV2Retries && history && !m.activeRule && m.agendaPos >= m.agenda.length
      && ['timer', 'activity-failed', 'activity-ended'].includes(trigger)
      ? blockedDirectionForRetry(history, m.owner, w.tick) : undefined;

    const latestNow=history?latestPurposeDirectionV1(history,m.owner,this.host.extra.intentRetainedChoiceV1===true):undefined;
    const sequence=this.host.extra.intentSequencesV1&&!m.activeRule&&m.agendaPos>=m.agenda.length&&latestNow?.status==='active'
      &&latestNow.revision.submitted.seq>=Number(this.host.extra.intentSequencesSinceV1??0)
      &&this.host.intentSequenceStepV1(m.soulId,{intentId:latestNow.revision.intentId,version:latestNow.revision.version})<latestNow.revision.interpretation.agenda.length?latestNow:undefined;
    const acting = sequence?.revision ?? immediate?.revision ?? retry;
    const sequenceIndex=sequence?this.host.intentSequenceStepV1(m.soulId,{intentId:sequence.revision.intentId,version:sequence.revision.version}):0;
    const planningMind = acting ? { ...m, agenda: sequence?[acting.interpretation.agenda[sequenceIndex]]:acting.interpretation.agenda, agendaPos: 0 } : m;
    const allPurposes=retained.map(e => this.host.extra.intentPurposeEvidenceV1
      ?purposeContextEvidenceV1(history!,e,m.owner,this.host.extra.intentSequencesV1&&e.revision.submitted.seq>=Number(this.host.extra.intentSequencesSinceV1??0)
        ?{kind:this.host.extra.intentNativeSequenceCompletionV1&&e.revision.interpretation.humanGoalPlan?.kind==='planned'?'native_program_sequence':'semantic_card_sequence',completedSteps:this.host.intentSequenceStepV1(m.soulId,{intentId:e.revision.intentId,version:e.revision.version})}:undefined,purposeAttempts)
      :({ words:e.revision.words,strict:e.revision.strict,importance:e.revision.importance,understanding:e.revision.interpretation.summary,status:e.status }));
    const newest=allPurposes.filter(p=>'source' in p&&p.source).sort((a,b)=>('source' in b?b.source!.seq:0)-('source' in a?a.source!.seq:0))[0];
    const pin=acting?{intentId:acting.intentId,version:acting.version}:newest&&'source' in newest?{intentId:newest.source!.intentId,version:newest.source!.version}:undefined;
    const recall=this.host.extra.intentPurposeRecallV1?recallPurposesV1(allPurposes,pin,[nameOf(s.region),m.doing,...s.nearby.map(n=>n.who)].join(' ')):undefined;
    const retainedChoices=!acting&&recall?.recall.state==='ready'?retainedPurposeChoicesV1(this.host,m,recall.purposes):new Map();
    const options=deferUnusedOptions?[]:optionsFor(this.host,planningMind,12,new Set([...retainedChoices.values()].map(v=>v.card)));
    if(!m.activeRule)for(const o of options)if(rules.some(r=>r.agenda.some(s=>matchesStep(this.host,s,o.card,o.cardTarget))))o.servesIntent=true;
    return {
      ...(physicalWhere===undefined?{}:{physicalWhere}),
      ...(nativeActivities===undefined?{}:{nativeActivities}),
      ...(acting ? { actingPurpose:{ intentId:acting.intentId, version:acting.version } } : {}),
      world: { time: timeWord(w.env.datetime), weather: weatherWord(w.env.weather), happening: this.host.living?.event ?? s.happening },
      ...(this.host.living ? { customs: this.host.living.customs } : {}),
      soul: {
        name: m.name, about: m.description, intent: intentText, ownerNote: m.intent?.text ?? m.intent?.note ?? null, hasIntent: retained.length>0||rules.length>0||!!m.intent && m.agendaPos < Math.max(1, m.agenda.length),
        intentIsNew: m.life ? ['new-intent','new-intent-v2','plan-advanced'].includes(trigger) : URGENT.has(trigger), energy: energyWord(m.energy), where: physicalWhere??nameOf(k.things[m.soulId]?.at ?? s.region),
        doing: eng.programOf(m.entityId) ? m.doing : ent?.human?.activity ?? 'standing around', recent: m.recent.slice(-3),
        ...(m.life ? { needs: m.life.needs, journal: m.life.journal } : {}),
        ...(rules.length?{mandate:rules.map(r=>({id:r.id,words:r.words,strict:r.strict,understanding:r.understanding}))}:{}),
      },
      nearby: s.nearby.map((n) => ({ who: n.who, what: n.what, distance: n.distance, doing: n.doing })),
      nudge: m.nudge?.text ?? null,
      situation: [...sit.situation,...physicalSituation],
      heard: sit.heard.map((h) => ({ who: h.who, act: h.act, ...(h.about ? { about: h.about } : {}), ...(this.lastWords.get(`${h.from}>${m.soulId}`) ? { words: this.lastWords.get(`${h.from}>${m.soulId}`)! } : {}) })),
      manners: Object.fromEntries((deck?.manners ?? []).map((n) => [n, k.vocab.manners[n]?.summary ?? n])),
      options,
      ...(recall?{purposes:recall.purposes,purposeRecall:recall.recall}:allPurposes.length?{purposes:allPurposes}:{}),
      ...(this.intentV2Choices&&this.host.extra.intentEpisodeMemoryV1?{purposeExperiences:purposeExperienceContextV1(this.host,m,recall?.purposes??allPurposes)}:{}),
      running: !!eng.programOf(m.entityId),
      trigger,
    };
  }

  private updateEnergy(m: Mind, ent: Entity, tick: number) {
    if (m.life) { m.energy = m.life.needs.energy; return; }
    const dt = (tick - m.lastEnergyTick) / TPS; m.lastEnergyTick = tick;
    const a = ent.human!.activity;
    // activity names differ by engine: the toy says rest/gather, Mars says sit/warm/watch/listen/talk/eat
    const rate = a === 'walk' ? -0.25 : a === 'perform' ? -0.4 : a === 'rest' || a === 'sit' || a === 'eat' ? 0.6 : a === 'gather' || a === 'warm' || a === 'watch' || a === 'listen' ? 0.15 : -0.03; // per second
    m.energy = Math.max(0, Math.min(100, m.energy + rate * dt));
  }

  async evaluate(m: Mind, trigger: string) {
    if(this.quiescing||this.skipMind?.(m))return;
    return this.track(()=>this.evaluateWork(m, trigger));
  }
  private async evaluateWork(m: Mind, trigger: string) {
    const host = this.host, tick = host.engine.world.tick;
    const purposeSeq = this.intentV2Choices ? host.intentWillSeqOf(m.soulId) : undefined;
    let experienceCurrent=()=>true;
    const choiceGuard: AcceptanceGuard | undefined = purposeSeq === undefined ? undefined : () => {
      const row = this.db.soul(m.soulId);
      if (host.minds.get(m.soulId) !== m || !row || row.retired_at !== null || row.world_id !== host.worldId
        || row.owner !== m.owner || row.entity_id !== m.entityId || host.kernel.things[m.soulId]?.traits.body !== m.entityId
        || !host.engine.world.entities[m.entityId] || host.intentWillSeqOf(m.soulId) !== purposeSeq || host.quietBarrier || !experienceCurrent())
        throw new StaleCompilation();
      return true;
    };
    const ent = host.engine.world.entities[m.entityId];
    this.updateEnergy(m, ent, tick);
    if(this.intentV2Choices&&(host.unfinishedHumanGoalExecutionV1(m.soulId)||host.unfinishedIntentApproachV1(m.soulId))){m.nextEvalTick=tick+TPS;m.evalTrigger='timer';m.lastFingerprint='';return;}
    // Safe-wake and pending-rise returns make no choice. Read private context first,
    // then build the full option registry if neither native safety branch returns.
    const deferOptions=this.intentV2Choices&&host.extra.intentHumanSleepTransitionV1===true;
    let ctx = this.midContext(m, trigger,deferOptions);
    if(ctx.purposeExperiences){const captured=JSON.stringify(ctx.purposeExperiences.episodes);experienceCurrent=()=>JSON.stringify(purposeExperienceContextV1(host,m,ctx.purposes??[])?.episodes)===captured;}
    if(ctx.purposeRecall?.state==='overflow'){
      const fp='purpose-recall-overflow:'+purposeSeq;
      if(m.lastFingerprint!==fp)this.record({tick,tier:'mid',subject:m.name,soulId:m.soulId,model:'private-recall/1',request:{recall:ctx.purposeRecall},response:null,applied:{dropped:'private-purpose-context-overflow'},ms:0,inputTokens:0,outputTokens:0,cachedTokens:0,costUsd:0,mode:'fake',error:'Strict/current owner commitments exceed the private context limit; no new choice was made. Full history remains available.'});
      m.lastFingerprint=fp;m.nextEvalTick=tick+TPS*20;m.evalTrigger='timer';return;
    }
    if(this.intentV2Choices&&host.extra.intentHumanSleepTransitionV1){
      if(host.pendingHumanSleepTransitionV1(m.soulId)){m.nextEvalTick=tick+1;m.evalTrigger='new-intent-v2';return;}
      const latest=latestPurposeDirectionV1(host.intentHistoryOf(m.soulId),m.owner,host.extra.intentRetainedChoiceV1===true);
      if(host.extra.intentSequencesV1&&!m.activeRule&&m.agendaPos>=m.agenda.length&&latest?.status==='active'&&latest.revision.interpretation.humanGoalPlan?.kind==='planned'){
        const ref={intentId:latest.revision.intentId,version:latest.revision.version},step=latest.revision.interpretation.agenda[host.intentSequenceStepV1(m.soulId,ref)],card=step?host.kernel.vocab.cards[step.card]:undefined;
        if(card&&step.target===null){const program={actor:m.entityId,label:card.name,steps:[...card.approach,...card.during]};if(withHumanSleepStopReadV1(host,m,preview=>{
          if(!preview(program))return false;
          void host.enqueueHumanSleepStopV1(m.soulId,ref,program,choiceGuard!).catch(()=>{m.nextEvalTick=host.engine.world.tick+1;m.evalTrigger='new-intent-v2';m.lastFingerprint='';});return true;
        })){m.nextEvalTick=tick+1;m.evalTrigger='new-intent-v2';return;}}
      }
    }
    if(deferOptions)ctx=this.midContext(m,trigger);
    if(this.nativeProgramAllowed)ctx.options=ctx.options.filter(o=>this.nativeProgramAllowed!(m,o.steps));
    const purposeFor = (option: CardOption) => {
      const ref = ctx.actingPurpose;
      const entry = ref ? host.intentHistoryOf(m.soulId).intents[ref.intentId] : undefined;
      if(ref&&entry?.revision.version===ref.version&&entry.revision.interpretation.agenda.some(step=>matchesStep(host,step,option.card,option.cardTarget)))return ref;
      const choice=!ref&&ctx.purposeRecall?.state==='ready'?retainedPurposeChoicesV1(host,m,ctx.purposes??[]).get(retainedChoiceKeyV1(option.card,option.cardTarget)):undefined;
      return choice?{intentId:choice.intentId,version:choice.version}:undefined;
    };
    if (m.avoid && m.avoid.untilTick > tick) ctx.options = ctx.options.filter((o) => o.id !== m.avoid!.id); else m.avoid = undefined;
    // A plan that has been impossible for ten minutes is given up, so a Soul is never stuck waiting for ever.
    if (m.agendaPos < m.agenda.length) {
      if (!ctx.options.some((o) => o.servesIntent && o.card !== 'wait') && m.planBlockedSince === undefined) m.planBlockedSince = tick;
      if (m.planBlockedSince !== undefined && tick - m.planBlockedSince > TPS * 600) {
        if(m.activeRule){void this.enqueueNative(m,'mandate','world',{soulId:m.soulId,ruleId:m.activeRule,op:'status',patch:{status:'blocked',report:`The next card, ${m.agenda[m.agendaPos].card}, stayed impossible for ten minutes.`}});m.nextEvalTick=tick+20;return;}
        m.recent = [...m.recent.slice(-3), `gave up on the plan at "${m.agenda[m.agendaPos].card}" (not possible for a long while)`]; m.agendaPos = m.agenda.length; m.planBlockedSince = undefined; host.markDirty(m.soulId);
      }
    }
    if (ctx.options.length === 0) { m.nextEvalTick = tick + TPS * 20; return; }
    const noBudgetNow = this.mode !== 'fake' && (this.overBudget || this.gov.waitSeconds('mid') > 0);
    // Tier 1, reflex: what code already knows needs no model.
    //  · Someone asked a question: the only options are to answer it (and if the owner's plan says to agree, agree).
    //  · Options that serve the owner's plan exist: choose only among those (and if there is one, take it).
    //  · This Soul asked something and the other has not answered: stay and wait.
    const answers = ctx.options.filter((o) => o.card === 'say yes' || o.card === 'say no');
    const serving = ctx.options.filter((o) => o.servesIntent && o.card !== 'wait');
    let reflex: CardOption | undefined, why = '';
    if(m.activeRule){
      if(m.agendaPos>=m.agenda.length){void this.enqueueNative(m,'mandate','world',{soulId:m.soulId,op:'status',ruleId:m.activeRule,patch:{status:'done',report:'The cards played and their objective changes are logged.'}});m.nextEvalTick=tick+20;return;}
      reflex=serving.sort((a,b)=>a.id.localeCompare(b.id))[0];why='the owner explicitly asked for this now';
      if(!reflex){m.nextEvalTick=tick+20;return;}
    }else if (answers.length) {
      ctx.options = answers; reflex = answers.find((o) => o.card === 'say yes' && o.servesIntent); why = 'someone asked, and the plan says to agree';
      // a question is never left hanging for want of budget: without a model, yes two times in three
      if (!reflex && noBudgetNow) { const yes = hash32(`${m.soulId}:${tick}:answer`) % 3 !== 0; reflex = answers.find((o) => o.card === (yes ? 'say yes' : 'say no')) ?? answers[0]; why = 'someone asked (no model budget just now)'; }
    }
    else if (serving.length && (!m.life || trigger === 'new-intent-v2' || !!ctx.actingPurpose)) { ctx.options = serving; if (serving.length === 1) { reflex = serving[0]; why = 'the one thing that serves the plan'; } }
    else if (awaiting(host, m.soulId).length) { reflex = ctx.options.find((o) => o.card === 'wait'); why = 'waiting for an answer'; }
    if (reflex) {
      const same = ctx.running && m.pending?.card === reflex.card && m.pending.target === reflex.cardTarget;
      if (same) { m.nextEvalTick = tick + TPS * 10; m.evalTrigger = 'timer'; return; }          // already doing exactly that
      const manners = Object.keys(ctx.manners ?? {}), manner = manners.length ? manners[hash32(`${m.soulId}:${tick}`) % manners.length] : undefined;
      const callId = this.record({ tick, tier: 'mid', subject: m.name, soulId: m.soulId, model: 'reflex', request: { reflex: why, options: ctx.options.map((o) => o.id) }, response: null, applied: { trigger, option: reflex.id, label: reflex.label, card: reflex.card, target: reflex.cardTarget, manner, how: 'reflex', why }, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, mode: 'fake' });
      m.nextEvalTick = tick + TPS * 30; m.lastFingerprint = '';
      this.enqueueDecision(m, 'brain:reflex', {
        soulId: m.soulId, entityId: m.entityId, option: reflex.id, label: reflex.label, steps: reflex.steps, mood: m.mood,
        reevalTicks: (reflex.card === 'wait' ? 10 : durationFloor(reflex.durationHint)) * TPS, fallback: false, call: callId, trigger,
        card: reflex.card, target: reflex.cardTarget, ...(manner ? { manner } : {}), approachLen: reflex.approachLen,
      } satisfies DecisionPayload, choiceGuard, purposeFor(reflex),!ctx.actingPurpose);
      return;
    }
    const fp = fingerprint(ctx);
    if (ctx.running && trigger === 'timer' && fp === m.lastFingerprint) { m.nextEvalTick = tick + TPS * 60; return; } // nothing changed: skip the call
    m.lastFingerprint = fp;
    // Governor: if the mid-brain share is spent for now, a busy soul simply waits; an idle soul takes a free default.
    const budgetOk = !this.overBudget && (this.mode === 'fake' || this.gov.allow('mid'));
    if (!budgetOk && ctx.running && !URGENT.has(trigger)) { m.nextEvalTick = tick + Math.max(20, this.gov.waitSeconds('mid')) * TPS; m.lastFingerprint = ''; return; }
    this.inflight.add(m.soulId);
    const version = m.intentVersion;
    const seed = `${m.soulId}:${tick}`;
    const { request, keys } = buildMidRequest(ctx);
    let decision, response: unknown = null, ms = 0, cost = 0, tokens = 0, mode: 'live' | 'fake' = 'fake', error: string | undefined, usedFallback = false;
    try {
      if (!budgetOk || (this.mode === 'fake' && m.life)) { decision = fallbackMid(ctx, seed); usedFallback = true; error = !budgetOk ? 'model budget unavailable: seeded needs and journal choice' : undefined; }
      else {
        this.lastServed.set(m.soulId, tick);
        const r = await this.jev.ask(request);
        response = r.response; ms = r.ms; cost = r.costUsd; tokens = r.response.usage.input_tokens; mode = r.mode;
        decision = interpretMid(r.response, ctx, keys, seed);
      }
    } catch (e) { decision = fallbackMid(ctx, seed); usedFallback = true; error = String((e as Error).message ?? e); }
    this.inflight.delete(m.soulId);
    if (host.minds.get(m.soulId) !== m || this.skipMind?.(m)) return;
    const now = host.engine.world.tick;
    const stale = m.intentVersion !== version || host.quietBarrier || purposeSeq !== undefined && host.intentWillSeqOf(m.soulId) !== purposeSeq || !experienceCurrent();
    const opt = ctx.options.find((o) => o.id === decision.option);
    if(!stale&&host.living){const c=clockAt(now,host.living.origin,host.living.dayTicks);for(const r of mandateOf(host.kernel,m.soulId).filter(r=>r.strict&&r.status==='active'&&r.lastReportDay!==c.day)){
      const chosen=opt?{card:opt.card,target:opt.cardTarget}:m.pending?{card:m.pending.card,target:m.pending.target}:null;
      if(!chosen||!r.agenda.some(a=>matchesStep(host,a,chosen.card,chosen.target)))void this.enqueueNative(m,'mandate','world',{soulId:m.soulId,ruleId:r.id,op:'report',patch:{lastReportDay:c.day,report:`This decision did not follow the strict rule: ${opt?.label??'continued the current activity'}. Needs, circumstances and the logged choice are available for review.`}});
    }}
    const policy = { how: decision.how, pool: decision.pool, topP: decision.topP, keepGoing: decision.keepGoing, sociable: decision.sociable, optionKeys: Object.fromEntries(keys) };
    const applied = stale ? { dropped: experienceCurrent()?'intent changed during the call; re-evaluating':'recorded experience changed during the call; re-evaluating' } : opt
      ? { option: opt.id, label: opt.label, card: opt.card, target: opt.cardTarget, manner: decision.manner, steps: opt.steps, mood: decision.mood, reevalSeconds: decision.reevalSeconds, probabilities: decision.probabilities, ...policy, seed }
      : { option: 'continue', mood: decision.mood, reevalSeconds: decision.reevalSeconds, ...policy };
    const callId = this.record({ tick, tier: 'mid', subject: m.name, soulId: m.soulId, model: mode === 'live' ? JEV_MODEL : 'fake', request, response, applied: { trigger, ...applied }, ms, inputTokens: tokens, outputTokens: 0, cachedTokens: 0, costUsd: cost, mode, error });
    if (stale) {
      m.nextEvalTick = now + 1;
      // The later publication already installed its wake. An old response
      // cannot turn it back into the legacy trigger and lose the fresh
      // purpose's temporary planning view. Legacy changes retain their most
      // recent urgent wake (including NOW); ordinary body news cannot erase
      // an unhandled fresh purpose while the old model call was in flight.
      if (purposeSeq !== undefined && host.intentWillSeqOf(m.soulId) !== purposeSeq && m.intentVersion === version)
        m.evalTrigger = 'new-intent-v2';
      else if (purposeSeq === undefined || !URGENT.has(m.evalTrigger)) m.evalTrigger = 'new-intent';
      m.lastFingerprint = '';
      return;
    }
    m.wantsCompany = decision.sociable;
    if (!opt) {
      m.nextEvalTick = now + decision.reevalSeconds * TPS;
      this.enqueueDecision(m,'brain:mid',{soulId:m.soulId,entityId:m.entityId,option:'continue',label:m.doing,steps:[],continue:true,mood:decision.mood,reevalTicks:decision.reevalSeconds*TPS,fallback:usedFallback,call:callId,trigger},choiceGuard);
      return;
    }
    m.nextEvalTick = now + TPS * 30; // provisional; the decision event sets the real one when applied
    if (m.nudge) m.nudge = null;    // a nudge is offered once
    this.enqueueDecision(m, 'brain:mid', {
      soulId: m.soulId, entityId: m.entityId, option: opt.id, label: opt.label, steps: opt.steps, mood: decision.mood,
      reevalTicks: Math.max(decision.reevalSeconds, durationFloor(opt.durationHint)) * TPS, fallback: usedFallback, call: callId, trigger,
      card: opt.card, target: opt.cardTarget, ...(decision.manner ? { manner: decision.manner } : {}), approachLen: opt.approachLen,
    } satisfies DecisionPayload, choiceGuard, purposeFor(opt),!ctx.actingPurpose);
  }

  private enqueueNative(m: Mind, kind: EventKind, author: string, payload: unknown) {
    if(!this.skipMind)return this.host.enqueue(kind,author,payload);
    if(this.skipMind(m))return Promise.resolve(undefined);
    return this.host.enqueueChecked(kind,author,payload,()=>{if(this.skipMind?.(m))throw new StaleCompilation();return true;}).catch(error=>{if(!(error instanceof StaleCompilation))throw error;return undefined;});
  }

  private enqueueDecision(m: Mind, author: string, payload: DecisionPayload, guard?: AcceptanceGuard, purpose?: { intentId:string; version:number },voluntaryRetained=false) {
    if (this.skipMind?.(m) || this.nativeProgramAllowed && !this.nativeProgramAllowed(m,payload.steps)) return;
    this.host.provisionalEval?.set(m.soulId, m.nextEvalTick); // a wake before this applies is kept (world.ts 'decision')
    const priorGuard=guard;
    if(this.skipMind||this.nativeProgramAllowed)guard=()=>{if(this.skipMind?.(m)||this.nativeProgramAllowed&&!this.nativeProgramAllowed(m,payload.steps))throw new StaleCompilation();return priorGuard?priorGuard():true;};
    if (!guard) { void this.host.enqueue('decision', author, payload); return; }
    if(purpose&&voluntaryRetained&&this.host.extra.intentRetainedChoiceV1)payload={...payload,trigger:'retained-choice/1'};
    const legacyVersion = m.intentVersion, willSeq = this.host.intentWillSeqOf(m.soulId);
    const queued = purpose ? this.host.enqueueIntentDecision(author,payload,purpose,guard)
      : this.host.enqueueChecked('decision', author, payload, guard);
    void queued.catch(error => {
      this.host.provisionalEval?.delete(m.soulId); // this decision will not apply: nothing is waiting to keep a wake for
      if (error instanceof PersistedIntentAdmissionFault) {
        console.error('[brain] decision and admission persisted; physical application requires reconciliation');
        return; // The pair is already durable; never issue duplicate work.
      }
      if (error instanceof IntentAdmissionDeferred) {
        if (!this.skipMind?.(m) && this.host.minds.get(m.soulId) === m && m.intentVersion === legacyVersion && this.host.intentWillSeqOf(m.soulId) === willSeq) {
          m.nextEvalTick = Math.min(m.nextEvalTick, this.host.engine.world.tick + 40);
          m.evalTrigger = 'new-intent-v2';
          m.lastFingerprint = '';
        }
        return; // Checkpoint eligibility is temporary; no durable or body effect.
      }
      if (!(error instanceof StaleCompilation) && !(error instanceof StaleIntentAttempt)) console.error('[brain] checked decision persistence failed');
      if (!this.skipMind?.(m) && this.host.minds.get(m.soulId) === m) { m.nextEvalTick = this.host.engine.world.tick + 1; m.evalTrigger = 'new-intent-v2'; m.lastFingerprint = ''; }
    });
  }

  async reflect(m: Mind, day: number) {
    if(this.quiescing||this.skipMind?.(m))return;
    return this.track(()=>this.reflectWork(m, day));
  }
  private async reflectWork(m: Mind, day: number) {
    if (!m.life) return;
    this.reflecting.add(m.soulId);
    try{
    const episodePolicy=this.host.extra.intentEpisodeMemoryV1===true,willSeq=this.host.intentWillSeqOf(m.soulId),throughSeq=this.host.seq,historySeq=this.host.intentHistoryOf(m.soulId).lastSeq;
    const current=()=>{const row=this.db.soul(m.soulId);if(this.skipMind?.(m)||this.host.minds.get(m.soulId)!==m||!row||row.owner!==m.owner||row.entity_id!==m.entityId||row.world_id!==this.host.worldId||row.retired_at!==null||this.host.intentWillSeqOf(m.soulId)!==willSeq||this.host.intentHistoryOf(m.soulId).lastSeq!==historySeq)throw new StaleCompilation();return true as const;};
    if(episodePolicy){try{current();}catch(error){if(error instanceof StaleCompilation)return;throw error;}}
    const episodes=episodePolicy?purposeEpisodesV1(this.host,m,throughSeq):undefined;
    let journal = episodes?episodeJournalV1(episodes):reflectInCode(m.name, m.life, m.agenda.slice(m.agendaPos).map(a => a.card));
    if (this.mode === 'live' && this.cfg.anthropicKey && !this.overBudget && this.gov.allow('narrator')) {
      try {
        const r = await callTool<{ journal: string }>({ gate: this.paidGate, apiKey: this.cfg.anthropicKey, model: this.cfg.narratorModel,
          system: 'Write a short first-person journal for this Soul: what happened, what remains unfinished, tendencies noticed, and what it wants tomorrow. Keep habits in prose. No timetable, schedule, executable plan or invented events. Never quote private owner instructions.',
          messages: [{ role: 'user', content: JSON.stringify({ name: m.name, character: m.description, journal: m.life.journal, needs: m.life.needs, acts: m.life.acts,...(episodes?{recordedPurposeEpisodes:episodes,episodeMeaning:'Accepted is admission, not start. Semantic card play is not native completion. These are own recorded outcomes; prose is interpretation, not a new fact.'}:{}), unfinishedCards: m.agenda.slice(m.agendaPos).map(a => a.card) }) }],
          tool: { name: 'reflect', description: 'Write the journal', input_schema: { type: 'object', properties: { journal: { type: 'string', maxLength: 1200 } }, required: ['journal'] } }, maxTokens: 350 });
        if (typeof r.out.journal === 'string' && r.out.journal.trim()) journal = r.out.journal.slice(0, 1200);
        this.record({ tick: this.host.engine.world.tick, tier: 'reflection', subject: m.name, soulId: m.soulId, model: this.cfg.narratorModel, request: r.request, response: r.raw, applied: { day }, ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens, costUsd: r.costUsd, mode: 'live' });
      } catch { /* code reflection keeps the day moving */ }
    }
    if(this.host.minds.get(m.soulId)===m&&!this.skipMind?.(m)){
      const payload={soulId:m.soulId,reflection:{day,journal,...(episodes?{episodeMemory:{contract:'private-purpose-episodes/1',throughSeq,episodes,proseKind:'interpretation'}}:{})}};
      if(episodePolicy){try{await this.host.enqueueChecked('rules',`soul:${m.soulId}`,payload,current);}catch(error){if(!(error instanceof StaleCompilation))throw error;}}
      else if(this.skipMind)await this.enqueueNative(m,'rules',`soul:${m.soulId}`,payload);
      else await this.host.enqueue('rules',`soul:${m.soulId}`,payload);
    }
    }finally{this.reflecting.delete(m.soulId);}
  }

  // ------------------------------------------------------------ web console: text → intent
  async translate(m: Mind, text: string): Promise<Translation & { via: string }> {
    if(isVerificationProbe(m.soulId))return {ok:false,confidence:0,reason:'Verifier probes accept explicit engine actions only.',via:'unavailable'};
    if(this.quiescing)return {ok:false,confidence:0,reason:'Direction unavailable while the server is restarting.',via:'unavailable'};
    return this.track(()=>this.translateWork(m, text));
  }
  private async translateWork(m: Mind, text: string): Promise<Translation & { via: string }> {
    const eng = this.host.engine, tick = eng.world.tick;
    const s = eng.describeSurroundings(m.entityId);
    const targets: Target[] = [
      ...s.nearby.map((n) => ({ id: n.id, name: n.who, kind: n.what, distance: n.distance })),
      ...Object.values(eng.world.entities).filter((e) => e.kind === 'fixture' && !s.nearby.some((n) => n.id === e.id)).map((e) => ({ id: e.id, name: e.label ?? e.id, kind: e.def, distance: 'far' })),
      ...Object.values(eng.world.regions).map((r) => ({ id: r.id, name: r.label, kind: 'region', distance: 'n/a' })),
    ].slice(0, 24);
    const { request, targetKeys } = buildTranslateRequest(text, m.name, targets);
    let out: Translation;
    if (this.mode === 'live' && (this.overBudget || !this.gov.allow('user'))) return { ok: false, confidence: 0, reason: 'the brain budget is spent for now; try again in a few minutes', via: 'governor' };
    try {
      const r = await this.jev.ask(request);
      out = interpretTranslate(r.response, text, targetKeys);
      this.record({ tick, tier: 'translate', subject: m.name, soulId: m.soulId, model: r.mode === 'live' ? JEV_MODEL : 'fake', request, response: r.response, applied: out, ms: r.ms, inputTokens: r.response.usage.input_tokens, outputTokens: 0, cachedTokens: 0, costUsd: r.costUsd, mode: r.mode });
      if (out.ok || !this.cfg.anthropicKey || this.mode === 'fake' || this.overBudget || !this.gov.allow('user')) return { ...out, via: 'jev' };
    } catch (e) {
      out = { ok: false, confidence: 0, reason: String((e as Error).message) };
      this.record({ tick, tier: 'translate', subject: m.name, soulId: m.soulId, model: JEV_MODEL, request, response: null, applied: out, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, mode: 'live', error: out.reason });
      if (!this.cfg.anthropicKey) return { ...out, via: 'jev' };
    }
    // second pass: a small LLM with a tool schema
    try {
      const h = await haikuTranslate(this.cfg.anthropicKey!, this.cfg.narratorModel, text, m.name, targets.map((t) => ({ id: t.id, name: t.name })), GOALS, this.paidGate);
      const valid = h.out && (GOALS as readonly string[]).includes(h.out.goal) && (h.out.target === null || targets.some((t) => t.id === h.out.target));
      const res: Translation = valid ? { ok: true, confidence: 0.7, intent: { goal: h.out.goal as WireIntent['goal'], target: h.out.target, note: sanitize(text) } } : { ok: false, confidence: 0, reason: 'not understood as something to do' };
      this.record({ tick, tier: 'translate', subject: m.name, soulId: m.soulId, model: this.cfg.narratorModel, request: h.request, response: h.raw, applied: res, ms: h.ms, inputTokens: h.inputTokens, outputTokens: h.outputTokens, cachedTokens: 0, costUsd: h.costUsd, mode: 'live' });
      return { ...res, via: 'haiku' };
    } catch (e) { return { ok: false, confidence: 0, reason: String((e as Error).message), via: 'haiku' }; }
  }

  // ------------------------------------------------------------ vocabulary: minting, compiling, attuning
  private engineVerbs() { return new Set(this.host.engine.describeVerbs().map((v) => v.verb).filter((v) => v !== 'do_activity')); }

  /** Validate proposed cards and mint the valid ones into the vocabulary and this Soul's deck. No model involved. */
  async mint(m: Mind, cards: unknown[], links: Record<string, LinkKind> | undefined, kinds: Record<string, { summary: string }> | undefined, origin: MintedCard['origin'], guard?: AcceptanceGuard, journal?: AcceptanceJournal): Promise<MintVerdict[]> {
    return this.track(()=>this.mintWork(m,cards,links,kinds,origin,guard,journal));
  }
  private async mintWork(m: Mind, cards: unknown[], links: Record<string, LinkKind> | undefined, kinds: Record<string, { summary: string }> | undefined, origin: MintedCard['origin'], guard?: AcceptanceGuard, journal?: AcceptanceJournal): Promise<MintVerdict[]> {
    if (journal && !guard) throw new Error('request journaling requires a current acceptance guard');
    if (guard) checkAcceptanceGuard(guard);
    const enqueue = (kind: 'deck' | 'mint', payload: unknown) => guard
      ? this.host.enqueueChecked(kind, `soul:${m.soulId}`, payload, guard, journal)
      : this.host.enqueue(kind, `soul:${m.soulId}`, payload);
    const k = this.host.kernel, verbs = this.engineVerbs(), tick = this.host.engine.world.tick;
    const newLinks: Record<string, LinkKind> = {}; for (const [n, d] of Object.entries(links ?? {})) if (!k.vocab.links[n] && /^[a-z][a-z ]{1,39}$/.test(n) && !SPEECH_LINKS.has(n)) newLinks[n] = { summary: String(d.summary).slice(0, 120), ...(d.control ? { control: true } : {}) };
    const newKinds: Record<string, { summary: string }> = {}; for (const [n, d] of Object.entries(kinds ?? {})) if (!k.vocab.kinds[n] && /^[a-z][a-z ]{1,39}$/.test(n)) newKinds[n] = { summary: String(d.summary).slice(0, 120) };
    // cards are checked against the vocabulary as it will be once the link kinds proposed alongside them exist
    const staged = { ...k, vocab: { ...k.vocab, links: { ...k.vocab.links, ...newLinks } } };
    const verdicts: MintVerdict[] = []; let first = true;
    // Declarations ride along with the first minted card. Only the ones a valid card really uses are kept, a few per call,
    // and the vocabulary as a whole is bounded: otherwise one request could add thousands of permanent words.
    const used = new Set<string>(), usedKinds = new Set<string>();
    for (const raw of cards.slice(0, 4)) { const v = validateCard(raw, staged, verbs); if (!v.ok) continue;
      for (const c of v.card.when) { if ('linked' in c) used.add(c.linked[0]); if ('notLinked' in c) used.add(c.notLinked[0]); if ('noneLinkedTo' in c) used.add(c.noneLinkedTo[0]); }
      for (const st of v.card.then) { if ('link' in st) used.add(st.link[0]); if ('unlink' in st) used.add(st.unlink[0]); if ('appear' in st) { usedKinds.add(st.appear.kind); if (st.linkFromActor) used.add(st.linkFromActor); } }
      for (const dv of Object.values(v.card.derive ?? {})) used.add(dv.link);
      if (v.card.target) usedKinds.add(v.card.target.kind);
    }
    const room = (have: number) => Math.max(0, Math.min(8, MAX_VOCAB_WORDS - have));
    for (const n of Object.keys(newLinks)) if (!used.has(n) || !newLinks[n].summary.trim()) delete newLinks[n];
    for (const n of Object.keys(newLinks).slice(room(Object.keys(k.vocab.links).length))) delete newLinks[n];
    for (const n of Object.keys(newKinds)) if (!usedKinds.has(n) || !newKinds[n].summary.trim()) delete newKinds[n];
    for (const n of Object.keys(newKinds).slice(room(Object.keys(k.vocab.kinds).length))) delete newKinds[n];
    for (const raw of cards.slice(0, 4)) {
      const v = validateCard(raw, staged, verbs); const name = String((raw as { name?: unknown })?.name ?? '?');
      if (!v.ok) { verdicts.push({ name, ok: false, problems: v.problems }); continue; }
      const card: Card = v.card; const hash = cardHash(card);
      if (k.vocab.cards[card.name]) { // the same card already exists: just deal it
        if (!k.decks[m.soulId]?.cards.includes(card.name)) await enqueue('deck', { soulId: m.soulId, add: [card.name], why: 'dealt an existing card' });
        verdicts.push({ name: card.name, ok: true, hash }); continue;
      }
      await enqueue('mint', { card: { ...card, hash, by: m.soulId, mintedAt: tick, origin }, forSoul: m.soulId, ...(first && Object.keys(newLinks).length ? { links: newLinks } : {}), ...(first && Object.keys(newKinds).length ? { kinds: newKinds } : {}) });
      first = false;
      // the mint has been applied by now: if another Soul's card took the name in the same instant, say so
      const won = k.vocab.cards[card.name]?.hash === hash;
      verdicts.push(won ? { name: card.name, ok: true, hash } : { name: card.name, ok: false, problems: [`a different card named "${card.name}" was minted first; choose another name`] });
    }
    return verdicts;
  }

  compileHumanGoalV1(m:Mind,words:string,strict:boolean,guard:AcceptanceGuard,journal:AcceptanceJournal,registeredActivitiesV1=false):Promise<ClosedHumanResultV1>{if(this.quiescing)return Promise.resolve({kind:'terminal',outcome:{kind:'system_unavailable',code:'closed',explanation:'The interpreter is stopping; keep this request reference.'}});return this.track(()=>compileHumanGoalV1(this,m,words,strict,guard,journal,{call:this.compilerCall,injected:this.injectedCompiler,record:c=>this.record(c),registeredActivitiesV1}));}

  /** A wish in plain words → an agenda of cards, minting what the vocabulary lacks. Returns null when no compiler is available. */
  async compile(m: Mind, wish: string, align: boolean | 'intent-v2'=false, guard?: AcceptanceGuard, journal?: AcceptanceJournal): Promise<{ ok: true; agenda: { card: string; target: string | null; of?: string }[]; minted: MintVerdict[]; alignment?:Alignment } | { ok: false; reason: string } | null> {
    if(this.quiescing||isVerificationProbe(m.soulId))return null;
    return this.track(()=>this.compileWork(m, wish, align, guard, journal));
  }
  private async compileWork(m: Mind, wish: string, align: boolean | 'intent-v2'=false, guard?: AcceptanceGuard, journal?: AcceptanceJournal): Promise<{ ok: true; agenda: { card: string; target: string | null; of?: string }[]; minted: MintVerdict[]; alignment?:Alignment } | { ok: false; reason: string } | null> {
    if (journal && !guard) throw new Error('request journaling requires a current acceptance guard');
    if (this.mode === 'fake' || !this.cfg.anthropicKey) return null;
    if (this.overBudget || !this.gov.allow('user')) return { ok: false, reason: 'the thinking budget is spent for now; try again in a few minutes' };
    const k = this.host.kernel, tick = this.host.engine.world.tick;
    const verbs = this.host.engine.describeVerbs().filter((v) => v.verb !== 'do_activity');
    const system = (align?`Align ONE new owner mandate rule in ONE call. Return alignment with a short understanding of the objective effects and one trigger. Time is the world's 24-hour clock: at 5pm every day means {kind:"time",hour:17,minute:0}. Every time Bill hosts a party means {kind:"gathering",host:Bill's known Soul id}. If you feel like it means {kind:"none"}. ${align === 'intent-v2'
      ? 'This is soul-intent/2: an ordinary actionable present direction such as "go to the campfire" means {kind:"now"} without requiring the word NOW. Future, conditional, recurring, optional or negated directions must keep the matching time/gathering/none trigger; never invent immediacy for them.'
      : 'Only an explicit instruction to act now/immediately means {kind:"now"}. Otherwise use none: do not invent an immediate instruction.'} Triggers only wake the mind; the agenda describes possible objective steps, and non-now rules do not execute it automatically. The owner's words remain verbatim private context. Explain impossible or unclear rules by understood:false.\n`:'')+COMPILER_PREAMBLE + cardGrammar(verbs);
    const physical=this.host.engine.observeBoatControls?.(m.entityId);
    const placement=this.host.engine.observeBodyLocation?.(m.entityId);
    const user = compileUser(k, m.soulId, wish, candidatesFor(this.host, m.soulId),placement===undefined?undefined:placement===null?'physical location unavailable':describeBodyLocation(placement))
      +(placement?'\nActual current self-location; the kernel place relation is separate and cannot establish physical success or permission. Native entity/container IDs below are physical references, not additional kernel Thing IDs:\n'+JSON.stringify(placement):'')
      +(placement===null?'\nActual physical location is unavailable. Do not infer it from the kernel place relation or claim physical success/permission.':'')
      +(physical?'\nCurrent local physical observation (availability is not a grant):\n'+JSON.stringify(physical):'');
    const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: user }];
    let cost = 0, ms = 0, inTok = 0, outTok = 0, cached = 0; const attempts: unknown[] = [];
    try {
      for (let attempt = 0; attempt < (align?1:2); attempt++) {
        if (guard) checkAcceptanceGuard(guard);
        const r = await this.compilerCall<CompileOut>({ gate: this.paidGate, apiKey: this.cfg.anthropicKey, model: this.cfg.compilerModel, system, cacheSystem: true, messages, tool: COMPILE_TOOL, maxTokens: 1800 });
        cost += r.costUsd; ms += r.ms; inTok += r.inputTokens; outTok += r.outputTokens; cached += r.cachedTokens;
        if (guard) checkAcceptanceGuard(guard);
        const out = r.out;
        if (!out.understood) {
          attempts.push({ out });
          this.record({ tick, tier: 'compile', subject: m.name, soulId: m.soulId, model: this.cfg.compilerModel, request: { system: [{ text: system }], messages }, response: r.raw, applied: { wish, understood: false, reason: out.reason, attempts }, ms, inputTokens: inTok, outputTokens: outTok, cachedTokens: cached, costUsd: cost, mode: 'live' });
          return { ok: false, reason: out.reason || 'not understood as something a Soul could do here' };
        }
        // check everything before minting anything
        const problems: string[] = []; const verbSet = this.engineVerbs();
        if(align){const trigger=mandateTriggerSchema.safeParse(out.alignment?.trigger);if(!trigger.success||!out.alignment?.understanding?.trim())problems.push('alignment must explain the effect and provide a valid trigger');else if(trigger.data.kind==='gathering'&&k.things[trigger.data.host]?.kind!=='soul')problems.push('the trigger host must be a known Soul');else if(align===true&&trigger.data.kind==='now'&&(!/\b(?:now|immediately|right away)\b/i.test(wish)||/\bnot\s+(?:now|immediately)\b/i.test(wish)))problems.push('only an explicit immediate instruction may run directly');}
        const staged = structuredClone(k); for (const [n, d] of Object.entries(out.new_links ?? {})) staged.vocab.links[n] ??= d;
        const owners = Object.values(k.things).filter((x) => x.kind === 'soul' && x.id !== m.soulId && new RegExp(`\\b${x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(’s|'s)`, 'i').test(wish));
        const validNew = new Map<string, Card>();
        for (const raw of out.new_cards ?? []) { const v = validateCard(raw, staged, verbSet); if (v.ok) validNew.set(v.card.name, v.card); else problems.push(`card "${String((raw as { name?: unknown })?.name)}": ${v.problems.join('; ')}`); }
        // Repair what can be repaired without asking again. Models keep inventing an id for a thing that does not exist yet
        // ("Rob's party" before it starts), or bind it to someone else's: both mean "whatever is his", which is what `of` says.
        const mine = (t: { id: string; kind: string }) => t.kind !== 'soul' && t.kind !== 'place' && t.kind !== 'region' && Object.values(k.links).some((l) => l.to === t.id && k.things[l.from]?.kind === 'soul');
        const repairs: string[] = [];
        for (const a of Array.isArray(out.agenda) ? out.agenda : []) {
          const t = a.target ? k.things[a.target] : undefined;
          // A retained owner direction must never broaden a named destination
          // to arbitrary travel. Only the established, unambiguous named-owner
          // future-thing association can be repaired without changing scope.
          const ownedRepair=align!=='intent-v2'||owners.length===1&&(!a.of||a.of===owners[0].id);
          if (a.target && !t && ownedRepair) { repairs.push(`${a.card}: unknown id ${a.target} → ${owners[0] ? `whatever is ${owners[0].name}’s` : 'any'}`); a.target = null; if (!a.of && owners[0]) a.of = owners[0].id; }
          else if (t && owners.length && mine(t) && !owners.some((o) => belongsTo(this.host, t.id, o.id)) && ownedRepair) { repairs.push(`${a.card}: ${t.name} is not ${owners[0].name}’s → whatever is ${owners[0].name}’s`); a.target = null; a.of = owners[0].id; }
        }
        if (repairs.length) attempts.push({ repaired: repairs });
        if (!Array.isArray(out.agenda) || out.agenda.length === 0) problems.push('the agenda is empty');
        for (const a of out.agenda ?? []) {
          const card = validNew.get(a.card) ?? k.vocab.cards[a.card];
          if (!card) { problems.push(`agenda step uses a card that does not exist: "${a.card}"`); continue; }
          if (a.target !== null && !k.things[a.target]) problems.push(`agenda step "${a.card}" targets "${a.target}", which is not an id in the list of known things. Ids are never invented. If the thing does not exist yet (a party that has not started), set "target" to null and "of" to the id of the Soul or thing it will belong to`);
          else if (a.target && card.target && card.target.kind !== 'any' && k.things[a.target].kind !== card.target.kind) problems.push(`agenda step "${a.card}" needs a ${card.target.kind} but "${a.target}" is a ${k.things[a.target].kind}`);
          if (a.of && !k.things[a.of]) problems.push(`agenda step "${a.card}" has an unknown "of" id "${a.of}"`);
          // "Rob's party" must be Rob's: a wish that names whose thing it is cannot be bound to someone else's.
          const t = a.target ? k.things[a.target] : undefined;
          if (t && t.kind !== 'soul' && t.kind !== 'place' && t.kind !== 'region' && owners.length && !owners.some((o) => belongsTo(this.host, t.id, o.id)) && Object.values(k.links).some((l) => l.to === t.id && k.things[l.from]?.kind === 'soul'))
            problems.push(`agenda step "${a.card}" targets ${t.name} (${t.id}), but the wish says ${owners.map((o) => `${o.name}’s`).join(' or ')} and that thing is not theirs. If ${owners[0].name} has no such thing yet, set "target" to null and "of" to "${owners[0].id}"`);
        }
        attempts.push({ out, problems });
        if (problems.length && attempt === 0 && !align) { messages.push({ role: 'assistant', content: `I proposed: ${JSON.stringify(out)}` }, { role: 'user', content: `That cannot run. Problems:\n- ${problems.join('\n- ')}\nFix them and call compile again.` }); continue; }
        if (problems.length) {
          this.record({ tick, tier: 'compile', subject: m.name, soulId: m.soulId, model: this.cfg.compilerModel, request: { system: [{ text: system }], messages }, response: r.raw, applied: { wish, understood: true, rejected: problems, attempts }, ms, inputTokens: inTok, outputTokens: outTok, cachedTokens: cached, costUsd: cost, mode: 'live', error: 'the compiled plan did not validate' });
          return { ok: false, reason: `could not turn that into something the world can run (${problems[0]})` };
        }
        const minted = await this.mint(m, [...validNew.values()], out.new_links, out.new_kinds, 'compiled', guard, journal);
        const deal = [...new Set(out.agenda.map((a) => a.card))].filter((c) => this.host.kernel.vocab.cards[c] && !this.host.kernel.decks[m.soulId]?.cards.includes(c));
        if (deal.length) {
          const payload = { soulId: m.soulId, add: deal, why: 'needed for the owner’s wish' };
          if (guard) await this.host.enqueueChecked('deck', `soul:${m.soulId}`, payload, guard, journal);
          else await this.host.enqueue('deck', `soul:${m.soulId}`, payload);
        }
        if (guard) checkAcceptanceGuard(guard);
        this.record({ tick, tier: 'compile', subject: m.name, soulId: m.soulId, model: this.cfg.compilerModel, request: { system: [{ text: system }], messages }, response: r.raw, applied: { wish, understood: true, agenda: out.agenda, minted, dealt: deal, attempts }, ms, inputTokens: inTok, outputTokens: outTok, cachedTokens: cached, costUsd: cost, mode: 'live' });
        return { ok: true, agenda: out.agenda.map((a) => ({ card: a.card, target: a.target, ...(a.of ? { of: a.of } : {}) })), minted, ...(align?{alignment:out.alignment}:{}) };
      }
    } catch (e) {
      this.record({ tick, tier: 'compile', subject: m.name, soulId: m.soulId, model: this.cfg.compilerModel, request: { messages }, response: null, applied: { wish, attempts }, ms, inputTokens: inTok, outputTokens: outTok, cachedTokens: cached, costUsd: cost, mode: 'live', error: String((e as Error).message) });
      return { ok: false, reason: e instanceof StaleCompilation ? e.message : 'the compiler failed; try again' };
    }
    return { ok: false, reason: 'the compiler failed; try again' };
  }

  /** Pick the three manners that suit a Soul's description (one cheap Jev call), and record them in its deck. */
  async attune(m: Mind) {
    if(this.quiescing||this.skipMind?.(m))return;
    return this.track(()=>this.attuneWork(m));
  }
  private async attuneWork(m: Mind) {
    const k = this.host.kernel, tick = this.host.engine.world.tick;
    if (this.mode === 'fake' || this.overBudget || !this.gov.allow('mid')) return;
    const request = buildAttuneRequest({ name: m.name, about: m.description }, k.vocab.manners);
    try {
      const r = await this.jev.ask(request);
      const manners = interpretAttune(r.response);
      this.record({ tick, tier: 'attune', subject: m.name, soulId: m.soulId, model: r.mode === 'live' ? JEV_MODEL : 'fake', request, response: r.response, applied: { manners }, ms: r.ms, inputTokens: r.response.usage.input_tokens, outputTokens: 0, cachedTokens: 0, costUsd: r.costUsd, mode: r.mode });
      if (this.host.minds.has(m.soulId)&&!this.skipMind?.(m)) {
        const payload={ soulId: m.soulId, manners, why: 'manners attuned to the description' };
        if(this.skipMind)void this.host.enqueueChecked('deck','brain:attune',payload,()=>{if(this.skipMind?.(m))throw new StaleCompilation();return true;}).catch(()=>{/* pairing revoked native control */});
        else void this.host.enqueue('deck','brain:attune',payload);
      }
    } catch { /* the default manners stay */ }
  }

  // ------------------------------------------------------------ speech: the act is state, the words are rendered here
  async speak(from: string, to: string, act: string, about: string | undefined, manner: string | undefined) {
    const speaker=this.host.minds.get(from);
    if(this.quiescing||(this.skipMind&&(!speaker||this.skipMind(speaker))))return;
    return this.track(()=>this.speakWork(from, to, act, about, manner));
  }
  private async speakWork(from: string, to: string, act: string, about: string | undefined, manner: string | undefined) {
    const k = this.host.kernel, tick = this.host.engine.world.tick;
    const a = k.things[from], b = k.things[to]; if (!a || !b) return;
    const input: TalkInput = {
      speaker: { name: a.name, about: String(a.traits.about ?? ''), ...(manner ? { manner: `${manner}: ${k.vocab.manners[manner]?.summary ?? ''}` } : {}) },
      listener: { name: b.name, about: String(b.traits.about ?? '') }, act, ...(about ? { about } : {}),
      where: a.at ? this.host.nameOf(a.at) : 'somewhere',
      earlier: this.db.talkBetween(from, to, 4).map((l) => ({ who: l.fromName, text: l.text })),
    };
    let lines: SpokenLine[] = [];
    // Words cost money, so they go first to what people steer and to what matters: a question or an answer, or a Soul with an owner.
    // Small talk between natives is rendered only while someone is watching and the speech budget is more than half full.
    const matters = act === 'ask' || act === 'agree' || act === 'decline' || [from, to].some((id) => { const mm = this.host.minds.get(id); return !!mm && !mm.native; });
    const spare = (() => { const b = this.gov.view().find((x) => x.tier === 'talk')!; return b.level > b.capacity / 2; })();
    const live = this.mode === 'live' && !!this.cfg.anthropicKey && !this.overBudget && (matters || (this.sink.clients() > 0 && spare)) && this.gov.allow('talk');
    if (live) {
      try {
        const r = await callTool<{ lines: SpokenLine[] }>({ gate: this.paidGate, apiKey: this.cfg.anthropicKey!, model: this.cfg.talkModel, system: TALK_SYSTEM, messages: [{ role: 'user', content: talkUser(input) }], tool: TALK_TOOL, maxTokens: 300, timeoutMs: 20000 });
        lines = cleanLines(r.out.lines, act);
        this.record({ tick, tier: 'talk', subject: a.name, soulId: from, model: this.cfg.talkModel, request: r.request, response: r.raw, applied: { to: b.name, act, lines }, ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens, costUsd: r.costUsd, mode: 'live' });
      } catch (e) {
        this.record({ tick, tier: 'talk', subject: a.name, soulId: from, model: this.cfg.talkModel, request: input, response: null, applied: null, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, mode: 'live', error: String((e as Error).message) });
      }
    }
    if (!lines.length) lines = plainLine(input);
    const out: TalkLine[] = lines.filter(l=>{const m=this.host.minds.get(l.who==='speaker'?from:to);return this.skipMind?!!m&&!this.skipMind(m):true;}).map((l) => {
      const speaker = l.who === 'speaker';
      const line = { tick, at: Date.now(), from: speaker ? from : to, to: speaker ? to : from, fromName: speaker ? a.name : b.name, toName: speaker ? b.name : a.name, act, ...(manner && speaker ? { manner } : {}), text: l.text, place: a.at };
      return { ...line, id: this.db.saveTalk(this.host.worldId, line) };
    });
    for (const l of out) this.lastWords.set(`${l.from}>${l.to}`, l.text);
    this.sink.onTalk?.(out);
  }

  // ------------------------------------------------------------ tier 2b: director + ticker
  private shotCandidates(): ShotCandidate[] {
    const eng = this.host.engine, w = eng.world;
    const c: ShotCandidate[] = [];
    const humans = Object.values(w.entities).filter((e) => e.kind === 'human' && !isVerificationProbe(this.host.mindByEntity.get(e.id)?.soulId ?? ''));
    const atFire = humans.filter((e) => e.human!.on === 'campfire');
    if (atFire.length >= 2) c.push({ id: 'group:campfire', text: `Frame the ${atFire.length} souls gathered at the campfire`, why: 'A gathering is the liveliest thing to watch', notFor: 'when it has been on screen a long time', spec: { kind: 'frameGroup', subjects: atFire.map((e) => e.id), azimuth: 0.6, elevation: 0.35, padding: 1.4 } });
    const interesting = humans.map((e) => ({ e, m: this.host.mindByEntity.get(e.id) })).filter((x) => x.m).sort((a, b) => score(b.e) - score(a.e) || a.e.id.localeCompare(b.e.id)).slice(0, 5);
    for (const { e, m } of interesting) c.push({ id: `follow:${e.id}`, text: `Follow ${m!.name}, who is ${m!.doing.toLowerCase()}`, why: e.human!.activity === 'walk' ? 'They are on the move' : 'A closer look at one soul', notFor: 'when they are just standing still with nothing going on', spec: { kind: 'follow', subject: e.id, offset: [0, 2.2, -4.5], lookHeight: 1.4 } });
    const talkers = humans.filter((e) => e.human!.activity === 'converse').slice(0, 2);
    if (talkers.length) c.push({ id: `two:${talkers[0].id}`, text: `A two-shot of ${this.host.mindByEntity.get(talkers[0].id)?.name ?? 'a soul'} in conversation`, why: 'Two souls are talking', spec: { kind: 'orbit', subject: talkers[0].id, radius: 4, height: 1.8, period: 40 } });
    c.push({ id: 'wide:center', text: 'A wide establishing shot of the center', why: 'Shows the campfire, the near benches and who is around', notFor: 'when it was the previous shot', spec: { kind: 'establishing', region: { min: [-18, -18], max: [18, 18] }, elevation: 0.7 } });
    c.push({ id: 'wide:world', text: 'A very wide shot of the whole ground', why: 'Shows everyone at once', notFor: 'when something specific deserves attention', spec: { kind: 'establishing', region: { min: [-50, -50], max: [50, 50] }, elevation: 1.0 } });
    return c;
  }

  async direct() {
    if(this.quiescing)return;
    return this.track(()=>this.directWork());
  }
  private async directWork() {
    const tick = this.host.engine.world.tick;
    if (this.camera && tick - this.shotSinceTick < SHOT_COMMIT_TICKS && this.tickerCandidates.length === 0) return; // commit window: no chatter
    this.directing = true;
    const candidates = this.shotCandidates();
    const events = this.tickerCandidates.splice(0);
    const held = this.camera ? heldWord((tick - this.shotSinceTick) / TPS) : '';
    const ctx: DirectorContext = {
      current: this.camera ? { id: this.shotId, text: this.camera.text, held } : null,
      happening: [...this.host.minds.values()].filter(m => !isVerificationProbe(m.soulId)).slice(0, 12).map((m) => `${m.name}: ${m.doing}`),
      candidates: tick - this.shotSinceTick < SHOT_COMMIT_TICKS ? [] : candidates, events,
    };
    try {
      if (ctx.candidates.length === 0 && !ctx.current) ctx.candidates = candidates;
      const request = buildDirectorRequest(ctx);
      const r = this.overBudget || (this.mode === 'live' && !this.gov.allow('director')) ? null : await this.jev.ask(request);
      if (r) {
        const d = interpretDirector(r.response, ctx);
        const lines: TickerLine[] = d.announce.map((e) => ({ tick, text: e.text }));
        if (d.chosen && d.chosen.id !== this.shotId) { this.shotId = d.chosen.id; this.shotSinceTick = tick; this.camera = { tick, shot: d.chosen.spec, text: d.chosen.text, heldSec: 0 }; }
        else if (this.camera) this.camera = { ...this.camera, heldSec: Math.round((tick - this.shotSinceTick) / TPS) };
        this.record({ tick, tier: 'director', subject: 'broadcast', model: r.mode === 'live' ? JEV_MODEL : 'fake', request, response: r.response, applied: { shot: d.hold ? 'hold' : d.chosen?.id, spec: d.chosen?.spec, confidence: (r.response.answers.shot as ChoiceA).confidence, ticker: lines.map((l) => l.text) }, ms: r.ms, inputTokens: r.response.usage.input_tokens, outputTokens: 0, cachedTokens: 0, costUsd: r.costUsd, mode: r.mode });
        if (this.camera) this.sink.onCamera(this.camera);
        if (lines.length) { this.ticker.push(...lines); if (this.ticker.length > 50) this.ticker.splice(0, this.ticker.length - 50); this.sink.onTicker(lines); }
      }
    } catch (e) {
      this.record({ tick, tier: 'director', subject: 'broadcast', model: JEV_MODEL, request: null, response: null, applied: null, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, mode: 'live', error: String((e as Error).message) });
    }
    this.directing = false;
  }

  /** On-demand cinematic shot for one Soul (owner view). */
  async shotFor(m: Mind) {
    if(this.quiescing||isVerificationProbe(m.soulId))return null;
    return this.track(()=>this.shotForWork(m));
  }
  private async shotForWork(m: Mind) {
    const tick = this.host.engine.world.tick, id = m.entityId;
    const near = this.host.engine.describeSurroundings(id).nearby.find((n) => n.what === 'a soul' && (n.distance === 'here' || n.distance === 'close'));
    const cands: ShotCandidate[] = [
      { id: 'over-shoulder', text: 'Close over-the-shoulder follow', why: 'Intimate, shows where they are heading', notFor: 'when they are sitting still', spec: { kind: 'follow', subject: id, offset: [0.6, 1.9, -2.6], lookHeight: 1.5 } },
      { id: 'wide-follow', text: 'Wide follow from behind and above', why: 'Shows the soul in its surroundings', spec: { kind: 'follow', subject: id, offset: [0, 5, -9], lookHeight: 1.2 } },
      { id: 'slow-orbit', text: 'Slow orbit around the soul', why: 'Good for a soul who is resting, sitting or performing', notFor: 'when they are walking fast', spec: { kind: 'orbit', subject: id, radius: 5, height: 2, period: 45 } },
      ...(near ? [{ id: 'two-shot', text: `Two-shot with ${near.who}`, why: 'Someone is right next to them', spec: { kind: 'frameGroup', subjects: [id, near.id], azimuth: 0.8, elevation: 0.25, padding: 1.6 } } as ShotCandidate] : []),
    ];
    const request = buildShotRequest({ name: m.name, doing: m.doing }, cands);
    if (this.mode === 'live' && (this.overBudget || !this.gov.allow('director'))) return { id: 'wide-follow', text: cands[1].text + ' (default: brain budget spent for now)', spec: cands[1].spec };
    const r = await this.jev.ask(request);
    const pick = cands.find((c) => c.id === (r.response.answers.shot as ChoiceA).choice) ?? cands[1];
    this.record({ tick, tier: 'shot', subject: m.name, soulId: m.soulId, model: r.mode === 'live' ? JEV_MODEL : 'fake', request, response: r.response, applied: { shot: pick.id, spec: pick.spec }, ms: r.ms, inputTokens: r.response.usage.input_tokens, outputTokens: 0, cachedTokens: 0, costUsd: r.costUsd, mode: r.mode });
    return { id: pick.id, text: pick.text, spec: pick.spec };
  }

  // ------------------------------------------------------------ tier 3: narrator
  /** The regions the narrator plans for: the engine's own (whatever `regionAt` can answer), not the raw world file's. */
  regions(): string[] { return this.host.engine.anchors().filter((a) => a.kind === 'region').map((a) => a.id); }
  digest(region: string): RegionDigest {
    const eng = this.host.engine, w = eng.world;
    const here = [...this.host.minds.values()].filter((m) => !this.skipMind?.(m) && w.entities[m.entityId] && eng.regionAt(w.entities[m.entityId].pose.p) === region);
    const nameOf = (id: string) => this.host.nameOf(id);
    const places = Object.values(w.entities).filter((e) => e.kind === 'fixture' && e.id !== 'gate' && eng.regionAt(e.pose.p) === region)
      .map((e) => { const n = Object.values(w.entities).filter((x) => x.human?.on === e.id).length; return { id: e.id, name: e.label ?? e.id, state: n ? `${n} souls here` : 'empty' }; });
    const names = new Set(here.map((m) => m.name));
    const recent = this.db.tailEvents(this.host.worldId, 120, true).filter((e) => e.kind === 'decision' || e.kind === 'birth' || e.kind === 'intent').map((e) => tickerText(e, this.host)).filter((t): t is string => !!t && [...names].some((n) => t.startsWith(n))).slice(-25);
    const others = this.regions().filter((r) => r !== region).map((r) => { const n = [...this.host.minds.values()].filter((m) => w.entities[m.entityId] && eng.regionAt(w.entities[m.entityId].pose.p) === r).length; return `${nameOf(r)}: ${n} souls`; });
    return {
      region, label: nameOf(region), time: timeWord(w.env.datetime), weather: weatherWord(w.env.weather), places,
      souls: here.slice(0, 20).map((m) => ({ name: m.name, about: m.description, intent: describeIntent(publicIntent(m.intent), nameOf), mood: m.mood, energy: energyWord(m.energy), doing: m.doing, wants_company: m.wantsCompany > 0.6 ? 'yes' : m.wantsCompany < 0.35 ? 'no' : 'maybe' })),
      recent, neighbours: others, previous_summary: this.narratorState.lastSummary[region] ?? null,
    };
  }

  async narrate(region: string, why: string) {
    if(this.quiescing)return;
    return this.track(()=>this.narrateWork(region, why));
  }
  private async narrateWork(region: string, why: string) {
    const tick = this.host.engine.world.tick, ns = this.narratorState;
    ns.nextRun[region] = tick + NARRATE_EVERY + (hash32(`${region}:${tick}`) % (TPS * 60)) - TPS * 30; // ~5 min ± 30 s, so regions drift apart
    const d = this.digest(region);
    if (d.souls.length === 0) return; // nobody here: no call
    if (this.overBudget) return;
    if (this.mode === 'live' && !this.gov.allow('narrator')) {
      // the narrator's share cannot afford a plan yet: try again when it can (plus jitter so regions stay apart)
      ns.nextRun[region] = tick + (Math.max(60, this.gov.waitSeconds('narrator')) + (hash32(`${region}:${tick}:w`) % 120)) * TPS;
      return;
    }
    this.narrating.add(region);
    const request = buildNarratorRequest(d, this.cfg.narratorModel);
    try {
      const r = await callNarrator(this.cfg.anthropicKey, this.mode, d, this.cfg.narratorModel, this.paidGate);
      const now = this.host.engine.world.tick;
      const beats = r.plan.beats.map((b) => ({ ...b, fired: false, fireTick: now + Math.round(Math.min(5, Math.max(0, b.at_min)) * 60 * TPS) }));
      const view: Omit<NarrativeView, 'id'> = { region, tick: now, summary: r.plan.summary, beats, nextRunTick: ns.nextRun[region] };
      const id = this.db.saveNarrative(this.host.worldId, region, now, view);
      const full = { ...view, id };
      this.narratives.set(region, full);
      ns.lastSummary[region] = r.plan.summary;
      this.pendingBeats = this.pendingBeats.filter((b) => b.region !== region); // a new plan supersedes the old one's unfired beats
      beats.forEach((b, index) => this.pendingBeats.push({ fireTick: b.fireTick, region, narrative: id, index, beat: { at_min: b.at_min, kind: b.kind, directive: b.directive, targets: b.targets, flavor: b.flavor } }));
      this.pendingBeats.sort((a, b) => a.fireTick - b.fireTick);
      this.record({ tick, tier: 'narrator', subject: region, model: r.mode === 'live' ? this.cfg.narratorModel : 'fake', request, response: r.raw, applied: { why, plan: r.plan }, ms: r.ms, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cachedTokens: r.cachedTokens, costUsd: r.costUsd, mode: r.mode });
      this.sink.onNarrative(full);
    } catch (e) {
      this.record({ tick, tier: 'narrator', subject: region, model: this.cfg.narratorModel, request, response: null, applied: null, ms: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, mode: 'live', error: String((e as Error).message) });
    }
    this.narrating.delete(region);
  }
}

// ---------------------------------------------------------------- helpers
/** Triggers after which the question is "what now?", not "should I keep going?". */
/** The most kinds of link, and kinds of thing, a world's vocabulary may hold. */
const MAX_VOCAB_WORDS = 400;
const URGENT = new Set(['new-intent', 'new-intent-v2', 'mandate-now', 'plan-advanced', 'spoken-to']);
const prio = (trigger: string) => ({ 'new-intent': 0, 'new-intent-v2': 0, 'mandate-now': 0, 'spoken-to': 0, 'plan-advanced': 0, 'activity-failed': 1, 'activity-ended': 1, birth: 1, 'narrator-beat': 2 } as Record<string, number>)[trigger] ?? 3;
const durationFloor = (h: string) => (h === 'seconds' ? 8 : h === 'minute' ? 20 : 30);
const score = (e: Entity) => ({ perform: 5, converse: 4, walk: 3, gather: 2, wave: 2 } as Record<string, number>)[e.human!.activity] ?? 0;
const heldWord = (s: number) => (s < 8 ? 'just started' : s < 25 ? 'a little while' : s < 60 ? 'quite a while' : 'a long time');
export function timeWord(datetime: string): string {
  const h = Number(datetime.slice(11, 13));
  return h < 5 ? 'deep night' : h < 8 ? 'early morning' : h < 11 ? 'morning' : h < 14 ? 'midday' : h < 17 ? 'afternoon' : h < 19 ? 'late afternoon' : h < 22 ? 'evening' : 'night';
}
export const weatherWord = (w: { clouds: number; rain: number; wind: number }) => (w.rain > 0.3 ? 'raining' : w.clouds > 0.6 ? 'overcast' : w.wind > 0.6 ? 'windy' : 'clear');
export function tickerText(e: LogEvent, host: WorldHost): string | null {
  const name = (soulId: string) => host.minds.get(soulId)?.name ?? 'a soul';
  switch (e.kind) {
    case 'birth': return `${e.payload.name} arrived`;
    case 'decision': return `${name(e.payload.soulId)}: ${lowerFirst(e.payload.label)}`;
    case 'intent': return `${name(e.payload.soulId)} has a new intent: ${describeIntent(publicIntent(e.payload.intent), (id) => host.nameOf(id))}`;
    case 'play': return null;
    case 'mint': return `A new card was coined: “${e.payload.card.name}”`;
    case 'scene': return `In ${host.engine.world.regions[e.payload.region]?.label ?? e.payload.region}: ${e.payload.beat.flavor}`;
    case 'retire': return `A soul departed`;
    default: return null;
  }
}
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
