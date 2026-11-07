import {afterCommit} from './edge/comms/store.ts';
import type {WorldAccounts} from './accounts/service.ts';
// Soul operations shared by the web API, the agent API and MCP.
import { randomBytes } from 'node:crypto';
import {PROBE_PREFIX, PROBE_OWNER, isVerificationProbe} from './verification-probe.ts';
import { createSoulSchema, describeIntent, intentSchema, proposeCardsSchema, steerSchema, type EventKind, type MandateRule, type AgendaStep, type BirthPayload, type DeckPayload, type IntentPayload, type LogEvent, type WireIntent } from '@souls/protocol';
import { blockedArrivalNear } from './arrival-placement.ts';
import {mandateOf,explicitTrigger} from './mandate.ts';
import {clockAt} from '@souls/brain';
import { deckView } from './deck.ts';
import { hashToken, newId, newSoulToken, RateLimit } from './auth.ts';
import type { Brain } from './brain.ts';
import { tickerText } from './brain.ts';
import type { Config } from './config.ts';
import type { Db, SoulRow, UserRow } from './db.ts';
import { checkAcceptanceGuard, energyWord, type AcceptanceGuard,type AcceptanceJournal, type WorldHost } from './world.ts';
import { LifecycleJournal, type LifecycleOperation } from './lifecycle-journal.ts';
import { LifecycleRunner,ownedBodyCorresponds,projectLifecycle } from './lifecycle-runner.ts';
import type { SoulLifecycle } from '@souls/protocol';
import {privatePurposeContextV1Schema} from '@souls/protocol';

export class ApiError extends Error {
  status: number; code: string; extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

type Pairing =
  | { kind: 'owner'; code: string; soulId: string; owner: string; issuer: string; expires: number }
  | { kind: 'agent'; code: string; poll: string; agent: string; expires: number; token?: string; soulId?: string; owner?: string; issuer?: string };
const PAIR_TTL = 15 * 60_000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const humanCode = () => { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length]; return `${s.slice(0, 4)}-${s.slice(4)}`; };
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
// The existing host journal hook holds BEGIN IMMEDIATE across the authority
// guard and canonical append. These controls need that lock, but no private
// operation row or new replay event of their own.
const controlTransaction:AcceptanceJournal=()=>true;

export class Souls {
  limits = new RateLimit();
  private pairings = new Map<string, Pairing>();
  private waiters = new Map<string, Set<(reason: string) => void>>();
  private lastTouch = new Map<string, number>();
  host: WorldHost; db: Db; brain: Brain; cfg: Config;
  lifecycle?:LifecycleRunner;
  accounts?:WorldAccounts;
  owns(principal:string,soul:SoulRow){return this.accounts?this.accounts.owns(principal,soul):soul.owner===principal;}
  ownedRows(principal:string){return this.accounts?this.accounts.rows(principal):this.db.soulsOf(principal).filter(row=>row.world_id===this.host.worldId);}
  agentStatus(soul:SoulRow){return soul.token_hash?{attached:true,label:soul.token_label,since:soul.token_created_at,last_used:soul.token_last_used}:this.accounts?.store.agentStatus(soul.id)??{attached:false,label:null,since:null,last_used:null};}
  readonly services?:{controlReady?:(soul:SoulRow)=>boolean};
  constructor(host: WorldHost, db: Db, brain: Brain, cfg: Config, services?:{controlReady?:(soul:SoulRow)=>boolean}) {
    this.services = services;
    this.host = host; this.db = db; this.brain = brain; this.cfg = cfg;
    host.listeners.push({
      onApplied: (e) => { const id = (e.payload as { soulId?: string })?.soulId; if (id) this.wake(id, e.kind === 'decision' ? `started: ${(e.payload as { label: string }).label}` : e.kind === 'intent' ? 'a new intent was accepted' : e.kind); },
      onProgram: (ev, m) => {
        if (ev.kind === 'completed') this.wake(m.soulId, `finished: ${m.doing}`);
        else if (ev.kind === 'failed') this.wake(m.soulId, `could not complete: ${m.doing} (${ev.code ?? 'failed'})`);
      },
    });
    this.carryOverDirections();
    setInterval(() => { const now = Date.now(); for (const [k, p] of this.pairings) if (p.expires < now) this.pairings.delete(k); }, 60_000).unref();
  }

  // ------------------------------------------------------------ access
  invited(u: UserRow): boolean { return !this.cfg.inviteRequired || u.role === 'admin' || !!u.invited_by; }
  requireInvited(u: UserRow) { if (!this.invited(u)) throw new ApiError(403, 'invite-required', 'an invite code is needed during the alpha'); }
  redeemInvite(u: UserRow, code: string) {
    if (this.invited(this.db.user(u.id) ?? u)) return;
    const lim = this.limits.allow(`invite:${u.id}`, 10, 3600_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many attempts', { retry_after: lim.retryAfter });
    if (!this.db.useInvite(code.trim())) throw new ApiError(404, 'invite-invalid', 'that invite code is not valid or is used up');
    this.db.setInvited(u.id, code.trim());
  }

  // ------------------------------------------------------------ lifecycle
  /** Internal candidate installer only; main/bootstrap do not call it. Its
   * private response capability does not qualify default/cohort/release use. */
  enableLifecycle(){
    if(this.lifecycle)throw new Error('Lifecycle candidate already installed');
    const journal=new LifecycleJournal(this.db),runner=new LifecycleRunner(this.host,journal,op=>{
      const user=this.db.user(op.scope.owner);return !!user&&this.invited(user);
    });
    runner.onCommitted=()=>runner.pump();
    this.lifecycle=runner;this.host.listeners.push({onApplied:()=>runner.pump(false),afterTick:()=>runner.pump()});runner.pump();
    return runner;
  }
  controlReady(soul:SoulRow):boolean{
    if(isVerificationProbe(soul.id))return false;
    if(this.services?.controlReady && !this.services.controlReady(soul))return false;
    if(!this.lifecycle)return true;
    const current=this.db.soul(soul.id);
    if(!current||current.owner!==soul.owner||current.world_id!==this.host.worldId||current.entity_id!==soul.entity_id||current.retired_at!==null)return false;
    const creation=this.lifecycle.journal.creationOfSoul(this.host.worldId,soul.id);
    if(creation)return creation.state==='complete'&&!creation.retirementAccepted&&projectLifecycle(this.host,creation).ready;
    // Legacy access requires an exact canonical birth and current correspondence;
    // never synthesize a request or repair a row simply because it exists.
    const row=this.db.db.prepare("SELECT seq FROM events WHERE world_id=? AND kind='birth' AND json_extract(payload,'$.soulId')=? ORDER BY seq LIMIT 1").get(this.host.worldId,soul.id) as {seq:number}|undefined;
    const birth=row?this.db.events(this.host.worldId,row.seq-1,1)[0]:undefined;
    return !!birth&&birth.kind==='birth'&&birth.payload.owner===current.owner&&birth.payload.entityId===current.entity_id
      &&this.host.currentProfileName(soul.id,birth.payload.name)===current.name&&ownedBodyCorresponds(this.host,{worldId:this.host.worldId,soulId:soul.id,entityId:current.entity_id,owner:current.owner},current.name);
  }
  requireControlReady(soul:SoulRow){if(!this.controlReady(soul))throw new ApiError(409,'not-in-world','this Soul is not currently admitted and ready');}
  /** A live request carries its authority to each sequenced write and final
   * response. These predicates only read; accepted facts replay without them. */
  ownerControlGuard(soul:SoulRow,issuer:string):AcceptanceGuard|undefined{
    if(!this.lifecycle&&!this.accounts)return undefined;
    return ()=>{
      const user=this.db.user(issuer),current=this.db.soul(soul.id);
      if(!user)throw new ApiError(401,'unauthorized','sign in first');
      this.requireInvited(user);
      if(!current||current.retired_at!==null||current.world_id!==this.host.worldId||current.owner!==soul.owner||current.entity_id!==soul.entity_id)throw new ApiError(404,'not-found','no such soul');
      if(!this.owns(user.id,current)&&user.role!=='admin')throw new ApiError(403,'forbidden','not your soul');
      this.requireControlReady(current);return true;
    };
  }
  agentControlGuard(soul:SoulRow,token:string|undefined):AcceptanceGuard|undefined{
    if(!this.lifecycle&&!this.accounts)return undefined;
    const captured=token?this.agentCredential(token):undefined;
    return ()=>{
      const credential=token?this.agentCredential(token):undefined,current=credential?.row,user=current?this.db.user(current.owner):undefined;
      if(!captured||credential?.kind!==captured.kind||(captured.kind==='grant'||captured.generation!==null)&&credential.generation!==captured.generation||!current||current.id!==soul.id||current.owner!==soul.owner||current.entity_id!==soul.entity_id||current.world_id!==this.host.worldId||current.retired_at!==null||!user||!this.invited(user)||!this.controlReady(current))throw new ApiError(401,'unauthorized','missing or invalid soul token; pair again (see /skill.md)');
      return true;
    };
  }
  private controlGuard(soul:SoulRow,authority?:AcceptanceGuard){
    const guard=authority??this.ownerControlGuard(soul,soul.owner);
    if(guard)checkAcceptanceGuard(guard);return guard;
  }
  private enqueueControl(kind:EventKind,author:string,payload:unknown,guard?:AcceptanceGuard){
    return guard?this.host.enqueueChecked(kind,author,payload,guard,controlTransaction):this.host.enqueue(kind,author,payload);
  }
  private lifecycleUser(userId:string,privateRead=false){
    const user=this.db.user(userId);
    if(!user||!this.invited(user))throw new ApiError(privateRead?404:403,privateRead?'not-found':'invite-required',privateRead?'no such lifecycle':'an invite code is needed during the alpha');
    return user;
  }
  lifecycleReceipt(userId:string,requestId:string):SoulLifecycle{
    const user=this.lifecycleUser(userId,true);if(!this.lifecycle)throw new ApiError(404,'not-found','no such lifecycle');
    let op:LifecycleOperation|undefined;
    // Invalid IDs use the same unknown response; invariant failures propagate.
    const associated=(soulId:string)=>{const row=this.db.soul(soulId);return !!row&&this.accounts?.owns(user.id,row)===true;};
    if(/^lc_[0-9a-f]{32}$/.test(requestId))op=this.lifecycle.journal.operationForReader(this.host.worldId,requestId,user.id,user.role==='admin',associated);
    if(!op||(op.scope.owner!==user.id&&user.role!=='admin'&&!associated(op.scope.soulId)))throw new ApiError(404,'not-found','no such lifecycle');
    return projectLifecycle(this.host,op);
  }
  lifecycleHistory(userId:string,cursor:string|null=null,owner=userId){
    const user=this.lifecycleUser(userId,true);if(!this.lifecycle||(owner!==user.id&&user.role!=='admin')||!owner||owner.length>128)throw new ApiError(404,'not-found','no such lifecycle');
    if(cursor!==null&&!/^lc1_lc_[0-9a-f]{32}$/.test(cursor))throw new ApiError(404,'not-found','no such lifecycle');
    try{return this.lifecycle.ownerPage(owner,cursor,owner===user.id&&this.accounts?this.accounts.associationIds(user.id):[]);}catch(error){if(error instanceof Error&&error.message==='Lifecycle cursor not found')throw new ApiError(404,'not-found','no such lifecycle');throw error;}
  }
  /** `travel`: an arrival from another world of this site (travel/travel.ts), whose owner the site already verified. */
  acceptLifecycleCreate(userId:string,input:unknown,request?:string,travel=false){
    if(!travel&&this.cfg.accountAuthRequired&&!this.accounts?.canCreate(userId))throw new ApiError(403,'approval-required','Sign in and approve this agent creation request.');
    if(!this.lifecycle)throw new ApiError(400,'lifecycle-unavailable','lifecycle candidate is not installed');
    const p=createSoulSchema.safeParse(input);if(!p.success)throw new ApiError(400,'invalid',p.error.issues.map(i=>i.message).join('; '));
    const id=newId('s'),entityId=`h_${id.slice(2)}`,requestId=request??'lc_'+randomBytes(16).toString('hex');
    const accepted=this.lifecycle.journal.acceptCreate({worldId:this.host.worldId,soulId:id,entityId,owner:userId},requestId,{...p.data,native:false},()=>{
      this.lifecycleUser(userId);
      if(this.ownedRows(userId).length>=this.cfg.maxSoulsPerUser)throw new ApiError(409,'too-many',`at most ${this.cfg.maxSoulsPerUser} souls per account`);
      if(this.db.soulByName(this.host.worldId,p.data.name))throw new ApiError(409,'name-taken',`a soul named ${p.data.name} already exists`);
      return true;
    });afterCommit(this.db.db,()=>this.lifecycle!.pump());return accepted;
  }
  acceptLifecycleRetire(userId:string,soul:SoulRow){
    if(!this.lifecycle)throw new ApiError(400,'lifecycle-unavailable','lifecycle candidate is not installed');
    const requestId='lc_'+randomBytes(16).toString('hex'),scope={worldId:this.host.worldId,soulId:soul.id,entityId:soul.entity_id,owner:soul.owner};
    const accepted=this.lifecycle.journal.acceptRetire(scope,requestId,()=>{
      const user=this.lifecycleUser(userId),current=this.db.soul(soul.id);
      if(!current||current.retired_at!==null||current.world_id!==this.host.worldId)throw new ApiError(404,'not-found','no such soul');
      if(!this.owns(user.id,current)&&user.role!=='admin')throw new ApiError(403,'forbidden','not your soul');
      this.requireControlReady(current);return true;
    });
    // Durable revocation is already committed. Remove any pending credential
    // deliveries; physical occupancy remains native until its safe cleanup.
    for(const [key,pair] of this.pairings)if(pair.soulId===soul.id)this.pairings.delete(key);
    this.lifecycle.pump();return accepted;
  }
  /** Operator retirement (retire-residents.ts, release 3.1.1): the same retire an owner's DELETE performs, with the site
   * operator's authority instead of the owner's (it runs only from a one-shot maintenance file on the world's own box).
   * Lifecycle worlds journal it exactly like acceptLifecycleRetire, including its control-ready check. */
  async operatorRetire(soulId:string){
    const current=this.db.soul(soulId);
    if(!current||current.retired_at!==null||current.world_id!==this.host.worldId)throw new ApiError(404,'not-found','no such soul');
    if(!this.lifecycle){await this.retire(current);return;}
    const scope={worldId:this.host.worldId,soulId:current.id,entityId:current.entity_id,owner:current.owner};
    this.lifecycle.journal.acceptRetire(scope,'lc_'+randomBytes(16).toString('hex'),()=>{
      const now=this.db.soul(soulId);
      if(!now||now.retired_at!==null||now.world_id!==this.host.worldId||now.owner!==current.owner)throw new ApiError(404,'not-found','no such soul');
      this.requireControlReady(now);return true;
    });
    for(const [key,pair] of this.pairings)if(pair.soulId===soulId)this.pairings.delete(key);
    this.lifecycle.pump();
  }
  async waitLifecycle(userId:string,requestId:string):Promise<SoulLifecycle>{
    const deadline=performance.now()+2000;
    for(;;){
      const receipt=this.lifecycleReceipt(userId,requestId);
      if((receipt.state==='admitted'&&receipt.ready)||receipt.state==='retired'||receipt.state==='refused'||performance.now()>=deadline)return receipt;
      await new Promise<void>(resolve=>setTimeout(resolve,Math.min(20,Math.max(1,deadline-performance.now()))));
    }
  }
  async create(owner: string, input: unknown, native = false): Promise<SoulRow> {
    if(!native&&this.cfg.accountAuthRequired)throw new ApiError(403,'approval-required','Sign in and approve this agent creation request.');
    const p = createSoulSchema.safeParse(input);
    if (!p.success) throw new ApiError(400, 'invalid', p.error.issues.map((i) => i.message).join('; '));
    if (!native && this.db.soulsOf(owner).length >= this.cfg.maxSoulsPerUser) throw new ApiError(409, 'too-many', `at most ${this.cfg.maxSoulsPerUser} souls per account`);
    if (this.db.soulByName(this.host.worldId, p.data.name)) throw new ApiError(409, 'name-taken', `a soul named ${p.data.name} already exists`);
    const id = newId('s'); const entityId = `h_${id.slice(2)}`;
    this.db.createSoul({ id, worldId: this.host.worldId, owner, entityId, name: p.data.name, description: p.data.description, native });
    // arrival-search/1: a direct (non-lifecycle) birth also moves off an arrival point the world blocks (cheap check
    // only, no birth probe); otherwise the default stays as it was.
    let near: { at: [number, number]; first: true } | undefined;
    if (!native) try { near = blockedArrivalNear(this.host); } catch { near = undefined; }
    await this.host.enqueue('birth', native ? 'world' : `soul:${id}`, { soulId: id, entityId, name: p.data.name, description: p.data.description, owner, ...(near ? { near } : {}) } satisfies BirthPayload);
    return this.db.soul(id)!;
  }
  async retire(soul: SoulRow) {
    this.db.retireSoul(soul.id);
    await this.host.enqueue('retire', `soul:${soul.id}`, { soulId: soul.id, entityId: soul.entity_id });
  }

  /** Internal, unpaired, nonhuman verifier; ordinary journaled birth/retire.
   * Return the row before awaiting admission so even a failed birth can retire. */
  /** `near` (birth-near/1): where the probe's walk will start; a built-over arrival point then never refuses the birth. */
  createVerificationProbe(near?: BirthPayload['near']) {
    const id = PROBE_PREFIX + randomBytes(5).toString('hex'), entityId = `h_${id.slice(2)}`;
    const name = `verifier probe ${id.slice(-8)}`, description = 'Temporary explicit-action use verifier; never thinks or pairs.';
    this.db.createSoul({ id, worldId: this.host.worldId, owner: PROBE_OWNER, entityId, name, description, native: false });
    try { return { soul: this.db.soul(id)!, ready: this.host.enqueue('birth', `verify-use:${id}`, { soulId: id, entityId, name, description, owner: PROBE_OWNER, ...(near ? { near } : {}) } satisfies BirthPayload) }; }
    catch (error) { this.db.retireSoul(id); throw error; }
  }

  // ------------------------------------------------------------ steering
  /** Find a kernel thing by id, by a body's entity id, or by name ("the kiosk", "kiosk", "Oda"). */
  resolveThing(ref: string): string | null {
    const k = this.host.kernel; if (k.things[ref]) return ref;
    if(this.host.soulNameRefusal(ref))return null;
    const low = ref.toLowerCase().replace(/^the /, '');
    const hit = Object.values(k.things).find((t) => t.traits.body === ref || t.traits.entity === ref) ?? Object.values(k.things).find((t) => t.name.toLowerCase().replace(/^the /, '') === low);
    return hit?.id ?? null;
  }

  /** Souls directed before plans existed (a goal and a target, no agenda) keep their direction: the goal becomes a plan of base cards. */
  carryOverDirections(): number {
    let n = 0;
    for (const m of this.host.minds.values()) {
      if (m.agenda.length || !m.intent?.goal) continue;
      const target = m.intent.target ? this.resolveThing(m.intent.target) : null;
      if (m.intent.target && !target) continue;                                  // what it pointed at is gone
      m.agenda = this.agendaFromGoal(m.intent.goal, target); m.agendaPos = 0; n++;
    }
    return n;
  }

  /** A legacy goal as a one- or two-step agenda of base cards. Deterministic. */
  private agendaFromGoal(goal: NonNullable<WireIntent['goal']>, target: string | null): AgendaStep[] {
    const kind = target ? this.host.kernel.things[target]?.kind : null;
    switch (goal) {
      case 'wander': return [{ card: 'wander', target: null }];
      case 'go': return kind === 'gathering' ? [{ card: 'join', target }] : kind === 'soul' ? [{ card: 'talk with', target }] : [{ card: 'go to', target }];
      case 'follow': case 'converse': return kind === 'soul' || !target ? [{ card: 'talk with', target }] : [{ card: 'go to', target }];
      case 'attend': return kind === 'place' ? [{ card: 'go to', target }] : [{ card: 'join', target: kind === 'gathering' ? target : null }];
      case 'gather': return kind === 'gathering' ? [{ card: 'join', target }] : [{ card: 'host a gathering', target: kind === 'place' ? target : null }];
      case 'rest': return kind === 'place' ? [{ card: 'go to', target }, { card: 'rest', target: null }] : [{ card: 'rest', target: null }];
      case 'perform': return [{ card: 'perform', target: null }];
    }
  }

  /** Set the standing intent. Resolves once the tick has accepted it (blocking mutation). */
  async setIntent(soul: SoulRow, input: unknown, source: IntentPayload['source'],authority?:AcceptanceGuard): Promise<{ event: LogEvent; intent: WireIntent; text: string }> {
    const guard=this.controlGuard(soul,authority);
    const lim = this.limits.allow(`intent:${soul.owner}`, 20, 60_000);
    if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many intents; slow down', { retry_after: lim.retryAfter });
    const p = intentSchema.safeParse(input);
    if (!p.success) throw new ApiError(400, 'invalid-intent', p.error.issues.map((i) => `${i.path.join('.') || 'intent'}: ${i.message}`).join('; '));
    if(this.host.living&&mandateOf(this.host.kernel,soul.id).length>=24)throw new ApiError(409,'mandate-full','at most 24 rules per Soul; edit or remove an existing rule');
    const k = this.host.kernel; const intent: WireIntent = { ...p.data };
    const need = (ref: string) => { const id = this.resolveThing(ref); if (!id) throw new ApiError(400, 'unknown-target', `no such target: ${ref}. Look at the world or perceive endpoints for valid names and ids.`); return id; };
    if (intent.target) intent.target = need(intent.target);
    if (intent.agenda) {
      intent.agenda = intent.agenda.map((a) => {
        if (!k.vocab.cards[a.card]) throw new ApiError(400, 'unknown-card', `no such card: "${a.card}". See your deck, or propose the card first.`);
        return { card: a.card, target: a.target ? need(a.target) : null, ...(a.of ? { of: need(a.of) } : {}) };
      });
      // cards on the agenda that the Soul does not hold yet are dealt to it
      const deal = [...new Set(intent.agenda.map((a) => a.card))].filter((c) => !k.decks[soul.id]?.cards.includes(c));
      if (deal.length) await this.enqueueControl('deck', `soul:${soul.id}`, { soulId: soul.id, add: deal, why: 'on the agenda' } satisfies DeckPayload,guard);
    } else intent.agenda = this.agendaFromGoal(intent.goal!, intent.target ?? null);
    if(this.host.living){
      const words=intent.text??intent.note??JSON.stringify(p.data);
      const aligned=await this.brain.compile(this.host.minds.get(soul.id)!,`Perform this explicit agenda now: ${JSON.stringify(intent.agenda)}. Owner context: ${words}`,true,guard,guard?controlTransaction:undefined);
      if(guard)checkAcceptanceGuard(guard);
      if(aligned&&!aligned.ok)throw new ApiError(400,'rule-not-aligned',aligned.reason);
      const rule:MandateRule={id:newId('r'),words,strict:false,understanding:aligned?.ok?aligned.alignment?.understanding??describeIntent(intent,id=>this.host.nameOf(id)):describeIntent(intent,id=>this.host.nameOf(id)),agenda:intent.agenda,trigger:{kind:'now'},status:'active',report:null};
      await this.replaceNow(soul,rule,guard);
      const event=await this.enqueueControl('mandate',`soul:${soul.id}`,{soulId:soul.id,op:'upsert',rule,source},guard);
      if(guard)checkAcceptanceGuard(guard);
      return {event,intent,text:rule.understanding};
    }
    const event = await this.enqueueControl('intent', `soul:${soul.id}`, { soulId: soul.id, intent, source } satisfies IntentPayload,guard);
    if(guard)checkAcceptanceGuard(guard);
    return { event, intent, text: describeIntent(intent, (id) => this.host.nameOf(id)) };
  }

  /** A wish in plain words. The compiler turns it into an agenda (minting cards if needed); without a compiler, the small translator picks a goal. */
  async command(soul: SoulRow, text: string, source: IntentPayload['source'] = 'web',authority?:AcceptanceGuard) {
    const guard=this.controlGuard(soul,authority);
    if(this.host.living)return this.steer(soul,{words:text},source,guard);
    const lim = this.limits.allow(`cmd:${soul.owner}`, 20, 60_000);
    if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many commands; slow down', { retry_after: lim.retryAfter });
    const mind = this.host.minds.get(soul.id);
    if (!mind) throw new ApiError(409, 'not-in-world', 'this soul is not in the world yet');
    // The compiler is the expensive tier and its budget is shared, so each owner gets a fair hourly share of it;
    // past that, the small translator still understands plain goals.
    const fair = this.limits.allow(`compile:${soul.owner}`, 12, 3600_000).ok;
    const c = fair ? await this.brain.compile(mind, text,false,guard,guard?controlTransaction:undefined) : null;
    if(guard)checkAcceptanceGuard(guard);
    if (c) {
      if (!c.ok) return { ok: false as const, reason: c.reason, via: 'compiler' };
      const r = await this.setIntent(soul, { agenda: c.agenda, text: text.slice(0, 280) }, source,guard);
      if(guard)checkAcceptanceGuard(guard);
      return { ok: true as const, intent: r.intent, text: r.text, tick: r.event.tick, seq: r.event.seq, via: 'compiler', confidence: 1, minted: c.minted.filter((v) => v.ok).map((v) => v.name) };
    }
    const tr = await this.brain.translate(mind, text);
    if(guard)checkAcceptanceGuard(guard);
    if (!tr.ok) return { ok: false as const, reason: tr.reason, via: tr.via };
    const r = await this.setIntent(soul, tr.intent, source,guard);
    if(guard)checkAcceptanceGuard(guard);
    return { ok: true as const, intent: r.intent, text: r.text, tick: r.event.tick, seq: r.event.seq, via: tr.via, confidence: tr.confidence, minted: [] as string[] };
  }

  async steer(soul:SoulRow,input:unknown,source:IntentPayload['source']='web',authority?:AcceptanceGuard){
    const guard=this.controlGuard(soul,authority);
    const parsed=steerSchema.safeParse(input);if(!parsed.success)throw new ApiError(400,'invalid-rule','a rule needs words (1–2000 characters), optional strict and an existing id to edit');
    const p=parsed.data,m=this.host.minds.get(soul.id);if(!m)throw new ApiError(409,'not-in-world','this Soul is not in the world yet');
    const limit=this.limits.allow(`steer:${soul.owner}`,20,60000);if(!limit.ok)throw new ApiError(429,'rate-limited','too many rule changes; slow down');
    const existing=mandateOf(this.host.kernel,soul.id);
    if(p.id&&!existing.some(r=>r.id===p.id))throw new ApiError(404,'unknown-rule','that rule is not in this Soul’s mandate');
    if(!p.id&&existing.length>=24)throw new ApiError(409,'mandate-full','at most 24 rules per Soul; edit or remove an existing rule');
    const compiled=await this.brain.compile(m,p.words,true,guard,guard?controlTransaction:undefined);
    if(guard)checkAcceptanceGuard(guard);
    if(compiled&&!compiled.ok)return {ok:false as const,reason:compiled.reason,via:'align'};
    let agenda:AgendaStep[],understanding:string,trigger:MandateRule['trigger'],minted:string[]=[];
    if(compiled?.ok){if(!compiled.alignment)throw new ApiError(400,'invalid-alignment','alignment did not return an understanding');agenda=compiled.agenda;({understanding,trigger}=compiled.alignment);minted=compiled.minted.filter(v=>v.ok).map(v=>v.name);}
    else {
      try{trigger=explicitTrigger(p.words,name=>Object.values(this.host.kernel.things).find(t=>t.kind==='soul'&&t.name.toLowerCase()===name.toLowerCase())?.id??null);}catch(e){return {ok:false as const,reason:(e as Error).message,via:'align'};}
      const action=p.words.toLowerCase().replace(/\s+(?:at\s+\d[^]*?every day|every time\s+[^]*|if you feel like it|now|immediately|right away)\s*$/i,'').replace(/^please\s+/,'').trim();
      const card=Object.values(this.host.kernel.vocab.cards).filter(c=>action===c.name||action.startsWith(c.name+' ')).sort((a,b)=>b.name.length-a.name.length)[0];
      if(!card)return {ok:false as const,reason:'Without model alignment, name an existing card such as rest or join. No rule was added.',via:'align'};
      const rest=action.slice(card.name.length).replace(/^(?:on|with|at|the)\s+/,'').trim(),target=rest?this.resolveThing(rest):null;
      if(card.target&&rest&&!target)return {ok:false as const,reason:`No known target named ${rest}`,via:'align'};
      agenda=[{card:card.name,target,...(trigger.kind==='gathering'&&card.target?.kind==='gathering'?{of:trigger.host}:{})}];
      if(!this.host.kernel.decks[m.soulId]?.cards.includes(card.name))await this.enqueueControl('deck',`soul:${soul.id}`,{soulId:soul.id,add:[card.name],why:'needed for the owner rule'},guard);
      understanding=describeIntent({agenda},id=>this.host.nameOf(id));
    }
    const rule:MandateRule={id:p.id??newId('r'),words:p.words,strict:p.strict,understanding,agenda,trigger,status:'active',report:null};
    const living=this.host.living,c=living?clockAt(this.host.engine.world.tick,living.origin,living.dayTicks):null;
    if(c&&trigger.kind==='time'&&(c.hour+18)%24+c.minute/60>=(trigger.hour+18)%24+trigger.minute/60)rule.lastFiredDay=c.day;
    await this.replaceNow(soul,rule,guard);
    const event=await this.enqueueControl('mandate',`soul:${soul.id}`,{soulId:soul.id,op:'upsert',rule,source},guard);
    if(guard)checkAcceptanceGuard(guard);
    return {ok:true as const,rule,text:understanding,tick:event.tick,seq:event.seq,via:'align',minted};
  }
  private async replaceNow(soul:SoulRow,rule:MandateRule,guard?:AcceptanceGuard){
    const old=this.host.minds.get(soul.id)?.activeRule;
    if(rule.trigger.kind==='now'&&old&&old!==rule.id)await this.enqueueControl('mandate',`soul:${soul.id}`,{soulId:soul.id,ruleId:old,op:'status',patch:{status:'blocked',report:'Replaced by a newer NOW request from the owner.'}},guard);
  }
  rules(soul:SoulRow){return mandateOf(this.host.kernel,soul.id);}
  async removeRule(soul:SoulRow,id:string,authority?:AcceptanceGuard){const guard=this.controlGuard(soul,authority);if(!mandateOf(this.host.kernel,soul.id).some(r=>r.id===id))throw new ApiError(404,'unknown-rule','that rule is not in this Soul’s mandate');const event=await this.enqueueControl('mandate',`soul:${soul.id}`,{soulId:soul.id,op:'remove',ruleId:id},guard);if(guard)checkAcceptanceGuard(guard);return {ok:true,tick:event.tick};}

  /** An owner's agent proposes cards for its Soul's deck. Validated like any other card; no model involved. */
  async proposeCards(soul: SoulRow, input: unknown,authority?:AcceptanceGuard) {
    const guard=this.controlGuard(soul,authority);
    const lim = this.limits.allow(`cards:${soul.owner}`, 12, 3600_000);
    if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many card proposals this hour', { retry_after: lim.retryAfter });
    const p = proposeCardsSchema.safeParse(input);
    if (!p.success) throw new ApiError(400, 'invalid', 'body must be { cards: [card, …], links?: {name: {summary, control?}}, kinds?: {name: {summary}} }; see /cards.md');
    const mind = this.host.minds.get(soul.id); if (!mind) throw new ApiError(409, 'not-in-world', 'this soul is not in the world yet');
    const verdicts = await this.brain.mint(mind, p.data.cards, p.data.links, p.data.kinds, 'agent',guard,guard?controlTransaction:undefined);
    if(guard)checkAcceptanceGuard(guard);
    return { ok: verdicts.every((v) => v.ok), cards: verdicts };
  }

  deck(soul: SoulRow) {
    const m = this.host.minds.get(soul.id); if (!m) throw new ApiError(409, 'not-in-world', 'this soul is not in the world yet');
    return deckView(this.host, m);
  }

  // ------------------------------------------------------------ views
  /** What the Soul itself perceives: the same word-bucketed context its own mind is given, plus ids an agent can target. */
  perceive(soul: SoulRow) {
    const m = this.host.minds.get(soul.id), e = this.host.engine;
    if (!m || !e.world.entities[m.entityId]) throw new ApiError(409, 'not-in-world', 'this soul is not in the world');
    const privateContext=this.host.extra.intentPurposeRecallV1===true&&this.brain.intentV2Enabled;
    const verify=()=>{
      const current=this.db.soul(soul.id);
      if(!current||current.retired_at!==null||current.world_id!==this.host.worldId||current.owner!==soul.owner||current.entity_id!==soul.entity_id)throw new ApiError(404,'not-found','no such soul');
      if(this.host.minds.get(soul.id)!==m||m.owner!==current.owner||m.entityId!==current.entity_id
        ||!ownedBodyCorresponds(this.host,{worldId:this.host.worldId,soulId:current.id,entityId:current.entity_id,owner:current.owner},current.name))throw new ApiError(409,'not-in-world','this Soul is not currently admitted and ready');
    };
    if(privateContext)verify();
    const c = this.brain.midContext(m, 'agent'); const s = e.describeSurroundings(m.entityId);
    const boatControls=e.observeBoatControls?.(m.entityId);
    const location=e.observeBodyLocation?.(m.entityId);
    const purposeContext=privateContext&&c.purposeRecall?privatePurposeContextV1Schema.parse({contract:'private-purpose-context/1',visibility:'current-owner',worldId:this.host.worldId,soulId:soul.id,entityId:m.entityId,observedTick:e.world.tick,purposes:c.purposes??[],recall:c.purposeRecall}):undefined;
    if(privateContext)verify();
    return {
      tick: e.world.tick, world: c.world,
      soul: { name: c.soul.name, about: c.soul.about, where: c.soul.where, energy: c.soul.energy, mood: m.mood, doing_now: c.soul.doing, recently: c.soul.recent, intent: m.intent, intent_text: c.soul.intent },
      nearby: s.nearby.map((n) => ({ id: n.id, name: n.who, kind: n.what, distance: n.distance, doing: n.doing })),
      storyteller_suggests: c.nudge,
      situation: c.situation ?? [],
      said_to_you: c.heard ?? [],
      agenda: m.agenda.map((a, i) => ({ card: a.card, target: a.target ?? null, ...(a.of ? { of: a.of } : {}), done: i < m.agendaPos })),
      could_do_now: c.options.map((o) => ({ id: o.id, card: o.card, target: o.cardTarget, what: o.label, good_when: o.goodWhen, not_for: o.notFor, ...(o.servesIntent ? { serves_current_intent: true } : {}) })),
      ...(boatControls?{physical_boat_controls:boatControls}:{}),
      ...(location!==undefined?{physical_location:location}:{}),
      ...(purposeContext?{private_purpose_context:purposeContext}:{}),
    };
  }

  status(soul: SoulRow) {
    const m = this.host.minds.get(soul.id); const e = this.host.engine;
    if (!m || !e.world.entities[m.entityId]) return { id: soul.id, name: soul.name, description: soul.description, in_world: false };
    const ent = e.world.entities[m.entityId]; const s = e.describeSurroundings(m.entityId);
    const nameOf = (id: string) => this.host.nameOf(id);
    const boatControls=e.observeBoatControls?.(m.entityId);
    const location=e.observeBodyLocation?.(m.entityId);
    return {
      id: soul.id, name: soul.name, description: soul.description, in_world: true, tick: e.world.tick, time: e.world.env.datetime,
      position: { x: ent.pose.p[0], z: ent.pose.p[2], region: location?.region?.id??s.region }, activity: ent.human!.activity, doing: this.host.doingOfV1(m), body: this.host.bodyOfV1(m),
      mood: m.mood, energy: energyWord(m.energy), wants_company: m.wantsCompany,
      ...(m.life ? { needs: m.life.needs, journal: m.life.journal, reflected_day: m.life.reflectedDay, customs: this.host.living?.customs } : {}),
      mandate:mandateOf(this.host.kernel,soul.id),
      intent: m.intent, intent_text: describeIntent(m.intent, nameOf), agenda: m.agenda.map((a, i) => ({ card: a.card, target: a.target ? this.host.nameOf(a.target) : null, done: i < m.agendaPos })), recent: m.recent, nearby: s.nearby, happening: s.happening,
      storyteller_suggests: m.nudge?.text ?? null,
      next_think_in_s: Math.max(0, Math.round((m.nextEvalTick - e.world.tick) / 20)),
      available_now: this.brain.midContext(m, 'status').options.map((o) => ({ id: o.id, label: o.label })),
      ...(boatControls?{physical_boat_controls:boatControls}:{}),
      ...(location!==undefined?{physical_location:location}:{}),
    };
  }

  /** Everything the owner's dashboard shows for one Soul. */
  dashboard(soul: SoulRow) {
    return {
      status: this.status(soul),
      agent: this.agentStatus(soul),
      spend: this.db.soulSpend(soul.id),
      created_at: soul.created_at,
    };
  }

  /** The Soul's story so far, for its owner: its own events plus storyteller beats that named it. */
  timeline(soul: SoulRow, limit = 80) {
    const w = this.host.engine.world;
    const label = (id: string) => this.host.nameOf(id);
    // things that have since vanished keep the name they had when they were played on
    const past = new Map<string, string>(); for (const pl of this.host.recentPlays) if (pl.target && pl.targetName) past.set(pl.target, pl.targetName);
    const own = this.db.soulEvents(this.host.worldId, soul.id, limit);
    const since = own[0]?.seq ?? 0;
    const beats = this.db.recentKind(this.host.worldId, 'scene', 300).filter((e) => e.seq >= since && Array.isArray(e.payload?.beat?.targets) && e.payload.beat.kind !== 'scene' && e.payload.beat.targets.includes(soul.name));
    return [...own, ...beats].sort((a, b) => a.seq - b.seq).slice(-limit).map((e) => {
      const p = e.payload;
      const text = e.kind === 'birth' ? 'arrived in the world'
        : e.kind === 'intent' ? `intent set via ${p.source === 'web' ? 'this page' : p.source === 'system' ? 'the world' : `your agent (${p.source})`}: ${describeIntent(p.intent, label)}`
        : e.kind === 'decision' ? `set out to ${lower(p.label)}${p.manner ? `, ${p.manner}` : ''}`
        : e.kind === 'play' ? `${p.card}${p.target ? ` → ${past.get(p.target) ?? label(p.target)}` : ''}${p.manner ? `, ${p.manner}` : ''}`
        : e.kind === 'deck' ? `deck changed: ${[...(p.add ?? []).map((c: string) => `+${c}`), ...(p.remove ?? []).map((c: string) => `−${c}`), ...(p.manners ? [`manners: ${p.manners.join(', ')}`] : [])].join(' ')} (${p.why})`
        : e.kind === 'scene' ? `the storyteller suggested: ${p.beat.directive} — ${p.beat.flavor}`
        : e.kind === 'retire' ? 'left the world' : e.kind;
      const why = e.kind === 'decision' ? ({ 'new-intent': 'because you gave a new intent', 'activity-ended': 'after finishing the last thing', 'activity-failed': 'after the last thing did not work out', 'narrator-beat': 'after a storyteller suggestion', 'plan-advanced': 'the plan moved on', 'spoken-to': 'someone spoke to it', birth: 'first choice after arriving', timer: 'on reflection' } as Record<string, string>)[p.trigger] ?? p.trigger : null;
      return { seq: e.seq, tick: e.tick, at: e.at, kind: e.kind, text, why, mood: e.kind === 'decision' ? p.mood : null, fallback: e.kind === 'decision' ? !!p.fallback : false, call: e.kind === 'decision' ? p.call ?? null : null };
    });
  }

  worldSummary() {
    const e = this.host.engine, w = e.world;
    return {
      world: this.host.worldId, tick: w.tick, time: w.env.datetime, rules_version: e.rulesVersion, size_m: 100,
      goals: ['wander', 'go', 'follow', 'attend', 'gather', 'converse', 'rest', 'perform'],
      regions: Object.values(w.regions).map((r) => ({ id: r.id, label: r.label })),
      places: Object.values(w.entities).filter((x) => x.kind === 'fixture').map((x) => ({ id: x.id, label: x.label, x: x.pose.p[0], z: x.pose.p[2] })),
      gatherings: Object.values(this.host.kernel.things).filter((t) => t.kind === 'gathering').map((t) => ({ id: t.id, name: t.name, at: t.at ? this.host.nameOf(t.at) : null, states: t.states, host: Object.values(this.host.kernel.links).filter((l) => l.kind === 'hosts' && l.to === t.id).map((l) => this.host.nameOf(l.from))[0] ?? null, taking_part: Object.values(this.host.kernel.links).filter((l) => l.kind === 'attends' && l.to === t.id).length })),
      souls: [...this.host.minds.values()].map((m) => { const p = this.host.publicSoul(m); const ent = w.entities[m.entityId]; return { id: m.entityId, name: p.name, about: p.description, doing: p.doing, mood: p.mood, region: ent ? e.regionAt(ent.pose.p) : null }; }),
    };
  }

  soulLog(soul: SoulRow, limit = 30) {
    return this.db.soulEvents(this.host.worldId, soul.id, limit).map((e) => ({ seq: e.seq, tick: e.tick, kind: e.kind, text: tickerText(e, this.host) }));
  }

  // ------------------------------------------------------------ waiting (long-poll for agents)
  private wake(soulId: string, reason: string) { const s = this.waiters.get(soulId); if (!s) return; this.waiters.delete(soulId); for (const r of s) r(reason); }
  /** Resolve when something happens to the Soul (activity ends, a new one starts, an intent lands) or after `seconds`. */
  async wait(soul: SoulRow, seconds: number): Promise<{ reason: string; status: ReturnType<Souls['status']> }> {
    const secs = Math.max(1, Math.min(55, Math.round(seconds || 30)));
    const set = this.waiters.get(soul.id) ?? new Set(); this.waiters.set(soul.id, set);
    if (set.size >= 4) throw new ApiError(429, 'too-many-waits', 'too many concurrent waits for this soul', { retry_after: 5 });
    const reason = await new Promise<string>((resolve) => {
      const t = setTimeout(() => { set.delete(done); resolve('timeout'); }, secs * 1000);
      const done = (r: string) => { clearTimeout(t); resolve(r); };
      set.add(done);
    });
    return { reason, status: this.status(this.db.soul(soul.id) ?? soul) };
  }

  // ------------------------------------------------------------ pairing an agent
  invalidatePairings(soulId:string,keepCode?:string){for(const [code,pair]of this.pairings)if(pair.soulId===soulId&&code!==keepCode)this.pairings.delete(code);}
  private mint(soulId: string, label: string | null,keepPairCode?:string) { const token = newSoulToken(soulId);if(this.accounts){const row=this.db.soul(soulId);if(!row)throw new ApiError(404,'not-found','No such Soul.');this.accounts.rotateLegacy(row,hashToken(token),label,keepPairCode);}else this.db.setSoulToken(soulId, hashToken(token), label); return token; }
  /** Travel (M3): a fresh token for a Soul that just arrived from another world of this site, handed to its agent. */
  travelToken(soulId:string){this.requireControlReady(this.db.soul(soulId)!);return this.mint(soulId,'travel');}
  /** Owner-initiated: a short code the owner pastes to their agent along with the skill link. */
  pairCode(soul: SoulRow, base: string, issuer?: UserRow) {
    this.requireControlReady(soul);
    if(this.accounts&&!this.accounts.pairingEligible(soul,issuer?.id??soul.owner))throw new ApiError(403,'account-signin-required','Verified account approval is required to pair this Soul.');
    for (const [k, p] of this.pairings) if (p.kind === 'owner' && p.soulId === soul.id) this.pairings.delete(k);
    const code = humanCode();
    this.pairings.set(code, { kind: 'owner', code, soulId: soul.id, owner: soul.owner, issuer: issuer?.id ?? soul.owner, expires: Date.now() + PAIR_TTL });
    return { code, expires_in: PAIR_TTL / 1000, prompt: `Read ${base}/skill.md and follow it to steer my Soul "${soul.name}" in Sim. Pairing code: ${code}` };
  }
  /** Agent side of the owner-initiated flow: exchange the code for a token. One use. */
  pairExchange(codeRaw: string, agent: string | undefined) {
    const code = normCode(codeRaw); const p = this.pairings.get(code);
    if (!p || p.kind !== 'owner' || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'that pairing code is invalid, already used, or expired; ask your human for a new one');
    this.pairings.delete(code);
    const soul = this.db.soul(p.soulId);
    if (!this.pairAuthority(soul, p.owner, p.issuer)) throw new ApiError(404, 'pair-invalid', 'that pairing is no longer valid');
    return { token: this.mint(soul.id, agent?.slice(0, 60) || 'agent'), soul: { id: soul.id, name: soul.name, description: soul.description } };
  }
  /** Agent-initiated (no code yet): the agent gets a link for its human to approve, then polls. */
  pairStart(agent: string | undefined, base: string) {
    const code = humanCode(), poll = randomBytes(24).toString('base64url');
    this.pairings.set(code, { kind: 'agent', code, poll, agent: agent?.slice(0, 60) || 'an agent', expires: Date.now() + PAIR_TTL });
    return { user_code: code, approve_url: `${base}/#pair/${code}`, poll_token: poll, interval_s: 3, expires_in: PAIR_TTL / 1000, tell_your_human: `Open ${base}/#pair/${code} , sign in, and approve me to steer one of your Souls.` };
  }
  pairInfo(codeRaw: string) {
    const p = this.pairings.get(normCode(codeRaw));
    if (!p || p.kind !== 'agent' || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'that request is invalid or has expired');
    return { code: p.code, agent: p.agent, approved: !!p.token };
  }
  pairApprove(user: UserRow, codeRaw: string, soul: SoulRow) {
    const p = this.pairings.get(normCode(codeRaw));
    if (!p || p.kind !== 'agent' || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'that request is invalid or has expired');
    if (p.token) throw new ApiError(409, 'pair-done', 'already approved');
    const current = this.db.soul(soul.id);
    if (!this.pairAuthority(current, soul.owner, user.id)) throw new ApiError(403, 'forbidden', 'pairing authority changed');
    p.token = this.mint(soul.id, p.agent,p.code); p.soulId = soul.id; p.owner = soul.owner; p.issuer = user.id;
  }
  pairPoll(poll: string) {
    const p = [...this.pairings.values()].find((x) => x.kind === 'agent' && x.poll === poll);
    if (!p || p.kind !== 'agent' || p.expires < Date.now()) throw new ApiError(404, 'pair-invalid', 'unknown or expired pairing; start again');
    if (!p.token) return { status: 'pending' as const };
    this.pairings.delete(p.code);
    const soul = this.db.soul(p.soulId!);
    if (!this.pairAuthority(soul, p.owner!, p.issuer!) || soul.token_hash !== hashToken(p.token))
      throw new ApiError(404, 'pair-invalid', 'that pairing is no longer valid');
    return { status: 'approved' as const, token: p.token, soul: { id: soul.id, name: soul.name, description: soul.description } };
  }

  /** Recheck the approving identity and original ownership before releasing a credential. */
  private pairAuthority(soul: SoulRow | undefined, owner: string, issuer: string): soul is SoulRow {
    const user = this.db.user(issuer),currentOwner=this.lifecycle?this.db.user(owner):undefined;
    return !!soul && !soul.retired_at && soul.world_id === this.host.worldId && soul.owner === owner
      && !!user && this.invited(user) && (this.owns(user.id,soul) || user.role === 'admin')
      && (!this.accounts||this.accounts.pairingEligible(soul,issuer))
      && (!this.lifecycle||!!currentOwner&&this.invited(currentOwner)) && this.controlReady(soul);
  }

  agentCredential(token:string|undefined){
    if(!token?.startsWith('sim_'))return null;
    const legacy=this.db.soulByTokenHash(hashToken(token)),grant=this.accounts?.store.resolveGrant(token);
    const row=legacy??(grant?this.db.soul(grant.soulId):undefined);
    if(!row||row.world_id!==this.host.worldId||row.retired_at!==null)return null;
    return {row,kind:legacy?'legacy' as const:'grant' as const,generation:legacy?row.token_generation:grant!.id,grant};
  }
  /** SOUL3: who issued the token this agent holds and when (the delegated grant or the legacy token), for GET /v1/agent/me. */
  agentPairing(token:string|undefined){
    const credential=this.agentCredential(token);if(!credential)return null;
    if(credential.kind==='legacy')return {label:credential.row.token_label,since:credential.row.token_created_at};
    const label=(this.db.db.prepare('SELECT agent_label FROM account_approvals_v1 WHERE world_id=? AND id=?').get(this.host.worldId,credential.grant!.approvalId) as {agent_label:string}|undefined)?.agent_label??null;
    return {label,since:credential.grant!.issuedAt};
  }
  /** SOUL3: why a Soul bearer is refused. No bearer: `unauthorized`. A token this world issued and then ended is
   * `control.revoked`, naming the Soul, when and why (a newer approved pairing, the owner's revoke, the agent's own release,
   * refusal, retirement) and how to pair again; any other bearer (garbage, oversized, foreign) is `control.unknown`. A
   * current token whose Soul is momentarily not admitted and ready keeps its pairing but gets no authority (`unauthorized`).
   * Only hashes are consulted; nothing about a replacement controller or its account is disclosed. */
  controlRefusal(token:string|undefined):{code:string;message:string;extra?:Record<string,unknown>}{
    if(!token)return {code:'unauthorized',message:'missing Soul token; pair your Soul (see /skill.md)'};
    const unknown={code:'control.unknown',message:'This world never issued this Soul token. Pair your Soul again (see /skill.md).'};
    if(!token.startsWith('sim_')||token.length>1024)return unknown;
    const notReady={code:'unauthorized',message:'This Soul is not admitted and ready right now; its pairing is kept. Retry shortly.'};
    const hash=hashToken(token),tomb=this.db.tokenTombstone(hash),legacy=tomb?.world_id===this.host.worldId?tomb:undefined,grant=legacy?null:this.accounts?.store.grantOf(token)??null;
    const soul=legacy||grant?this.db.soul(legacy?.soul_id??grant!.soulId):undefined;
    if(!soul||soul.world_id!==this.host.worldId)return this.db.soulByTokenHash(hash)?notReady:unknown;
    if(grant&&grant.revokedAt===null&&soul.retired_at===null)return notReady;
    const iso=(ms:number|null|undefined)=>typeof ms==='number'&&Number.isFinite(ms)?new Date(ms).toISOString():null;
    const raw=soul.retired_at!==null?'retired':legacy?.reason??grant?.reason??null;
    const reason=raw==='legacy-pair-rotation'?'replaced':raw==='account-revoke'?'revoked':raw==='agent-release'?'released':raw==='account-repair'?'replaced':raw;
    const revokedAt=iso(reason==='retired'?soul.retired_at:legacy?.revoked_at??grant?.revokedAt??soul.retired_at)!;
    const hint=reason==='retired'?null:`Run: node eden.mjs pair ${soul.id} --for CODE`;
    const message=reason==='replaced'?`${soul.name}'s control moved to a newer pairing at ${revokedAt}.`
      :reason==='revoked'?`${soul.name}'s control was revoked by its owner at ${revokedAt}.`
      :reason==='released'?`${soul.name}'s control was released by its agent at ${revokedAt}.`
      :reason==='refused'?`${soul.name}'s approval was refused at ${revokedAt}.`
      :reason==='retired'?`${soul.name} was retired at ${revokedAt}.`
      :`${soul.name}'s control ended at ${revokedAt}.`;
    return {code:'control.revoked',message,extra:{soul:{id:soul.id,name:soul.name},reason:reason??'ended',revokedAt,replacedAt:reason==='replaced'?revokedAt:null,hint}};
  }
  soulFromToken(token: string | undefined): SoulRow | null {
    if (!token?.startsWith('sim_')) return null;
    const soul = this.agentCredential(token)?.row??null;
    if (soul && (isVerificationProbe(soul.id) || soul.world_id !== this.host.worldId)) return null;
    if(soul&&this.lifecycle){const owner=this.db.user(soul.owner);if(!owner||!this.invited(owner)||!this.controlReady(soul))return null;}
    if (soul) { const now = Date.now(); if (now - (this.lastTouch.get(soul.id) ?? 0) > 30_000) { this.lastTouch.set(soul.id, now); this.db.touchSoulToken(soul.id); } }
    return soul;
  }
}
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
