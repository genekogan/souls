// Server-side plans (EVENTS-v1 §plans, tranche M2): an ordered list of steps the server carries out for a Soul while its
// agent is away. Each step is resolved when it starts (an act request: capability id, plain words or an intent), lasts
// `for` a duration, `until` an event in the Soul's own stream, or until its act ends. Refusals pause-and-notify, skip or
// cancel. Plans are durable (SQLite) and replay-safe: every act a plan makes carries clientRef `pl:<plan>:<step>:<attempt>`,
// so re-running a step after a restart returns the receipt the first try created instead of acting twice.
import {randomBytes} from 'node:crypto';
import {EdgeError, type EdgeReceipt, type EdgeSoul} from '../contract.ts';
import type {EventStreams, StreamEvent} from '../comms/stream.ts';
import {EVENT_KINDS, kindMatches, oneLine, type Envelope} from '../events/envelope.ts';

export type OnRefusal = 'pause-and-notify' | 'skip' | 'cancel';
export const ON_REFUSAL: OnRefusal[] = ['pause-and-notify', 'skip', 'cancel'];
export const PLAN_MAX_STEPS = 20, STEP_MAX_MS = 6 * 3600_000, PLAN_TICK_MS = 1000;
/** A `for` step whose act the world ended early for one of these reasons (someone bumped a lying body, a restart) acts again. */
const RESUMABLE = /^(pose\.moved|action\.interrupted|receipt\.lost-on-restart|state\.safe-stop-timeout|nav\.warm-timeout)$/;
const TRANSIENT_RETRY_MS = 5000, TRANSIENT_MAX = 12, REISSUE_MAX = 60, REISSUE_GAP_MS = 5000, REISSUE_MIN_LEFT_MS = 15_000;
/** Verbs whose posture or activity a `for` step keeps up by acting again when the body's own activity ends early. */
const REHOLD = new Set(['sit', 'sit-ground', 'lie', 'nap', 'read', 'rest', 'warm-by-fire', 'gather', 'swim', 'dance', 'jump', 'stretch', 'jumping-jacks', 'yoga', 'pushups', 'situps', 'play-piano', 'paint', 'play-music', 'write', 'play-game', 'craft', 'cook', 'wander', 'hang-out']);

/** The `wait` (raw) kinds an `until` may also name. */
const RAW_KINDS = ['receipt', 'arrival', 'departure', 'speech', 'conversation.invite', 'conversation.turn', 'conversation.member', 'conversation.closed', 'object', 'schedule', 'fade', 'world', 'invite', 'invite.accepted', 'invite.declined', 'invite.expired', 'invite.closed', 'follow', 'follow.stop', 'approach', 'world.notice', 'world.join', 'world.leave', 'light.changed'];
/** An `until` step with no `within` gives up waiting after this long (and moves on). */
export const UNTIL_DEFAULT_MS = 3 * 3600_000;
export type Until = {event: string; about?: string; object?: string; place?: string; text?: string; within?: string | number};
export type StepSpec = {do?: string | Record<string, unknown>; say?: string; params?: Record<string, unknown>; for?: string | number; until?: Until; onRefusal?: OnRefusal; label?: string};
type StepState = {status: 'pending' | 'starting' | 'running' | 'done' | 'failed' | 'skipped'; attempt: number; startedAt?: number; endedAt?: number; deadline?: number; untilBy?: number;
  receipt?: string; capability?: string; resolved?: string; code?: string; reason?: string; didYouMean?: unknown; why?: string;
  reissues: number; lastIssueAt?: number; completedOnce?: boolean; secMax?: number; noSeconds?: boolean; noReissue?: boolean; retryAt?: number; transient: number; plain?: boolean};
type Step = StepSpec & {state: StepState};
export type PlanState = 'running' | 'paused' | 'done' | 'cancelled' | 'replaced' | 'failed';
export type Plan = {id: string; soulId: string; state: PlanState; onRefusal: OnRefusal; steps: Step[]; current: number; createdAt: number; updatedAt: number; reason?: string};

/** What the executor needs from the world (the Ledger in production; a fake in unit tests). */
export type PlanActor = {
  soul(soulId: string): EdgeSoul | null;
  act(soul: EdgeSoul, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  receipt(soulId: string, id: string): EdgeReceipt | null;
  say?(soul: EdgeSoul, text: string): unknown;
  /** Non-null while the body keeps a chosen posture/activity (Ledger postureHold). */
  posture?(soulId: string): string | null;
  onReceipt(l: (r: EdgeReceipt) => void): void;
};
export type PlanCore = {db: import('node:sqlite').DatabaseSync; worldId: string; now(): number; tick(): number; streams: EventStreams};

/** "90s", "5m", "1.5 h", 300 (seconds) → ms. */
export function parseDuration(v: unknown, field: string): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v * 1000);
  const m = typeof v === 'string' ? /^\s*(\d+(?:\.\d+)?)\s*(ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)?\s*$/i.exec(v) : null;
  if (!m) throw new EdgeError(400, 'invalid', `${field} must be a duration like "90s", "5m" or "1h" (or seconds)`);
  const n = Number(m[1]), u = (m[2] ?? 's').toLowerCase();
  return Math.round(n * (u === 'ms' ? 1 : u.startsWith('h') ? 3600_000 : u.startsWith('m') && u !== 'ms' ? 60_000 : 1000));
}

const newPlanId = () => 'pl_' + randomBytes(9).toString('base64url');
const labelOf = (s: StepSpec) => s.label ? oneLine(s.label, 80) : s.say !== undefined ? `say "${oneLine(s.say, 60)}"` : typeof s.do === 'string' ? oneLine(s.do, 80) : s.do ? oneLine((s.do.capability as string | undefined) ?? `${s.do.verb ?? 'do'} ${typeof s.do.target === 'string' ? s.do.target : JSON.stringify(s.do.target ?? '')}`, 80) : s.until ? `wait until ${s.until.event}` : 'wait';

export function validateSteps(raw: unknown): StepSpec[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > PLAN_MAX_STEPS) throw new EdgeError(400, 'invalid', `steps must be a list of 1..${PLAN_MAX_STEPS} steps`);
  return raw.map((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new EdgeError(400, 'invalid', `step ${i}: must be an object {do|say, for?|until?, onRefusal?}`);
    const x = s as Record<string, unknown>, out: StepSpec = {};
    if (x.do !== undefined) {
      if (typeof x.do === 'string') { if (!x.do.trim() || x.do.length > 200) throw new EdgeError(400, 'invalid', `step ${i}: do must be 1..200 characters`); out.do = x.do.trim(); }
      else if (x.do && typeof x.do === 'object' && !Array.isArray(x.do) && (typeof (x.do as Record<string, unknown>).capability === 'string' || typeof (x.do as Record<string, unknown>).verb === 'string')) {
        if (JSON.stringify(x.do).length > 1000) throw new EdgeError(400, 'invalid', `step ${i}: do is too large`);
        out.do = structuredClone(x.do as Record<string, unknown>);
      } else throw new EdgeError(400, 'invalid', `step ${i}: do must be a capability id, plain words, {capability, params?} or an intent {verb, target}`);
    }
    if (x.say !== undefined) { if (typeof x.say !== 'string' || !x.say.trim() || x.say.length > 500) throw new EdgeError(400, 'invalid', `step ${i}: say must be 1..500 characters`); if (out.do) throw new EdgeError(400, 'invalid', `step ${i}: a step has do or say, not both`); out.say = x.say.trim(); }
    if (x.params !== undefined) { if (!x.params || typeof x.params !== 'object' || Array.isArray(x.params)) throw new EdgeError(400, 'invalid', `step ${i}: params must be an object`); out.params = structuredClone(x.params as Record<string, unknown>); }
    if (x.for !== undefined) { const ms = parseDuration(x.for, `step ${i}: for`); if (ms > STEP_MAX_MS) throw new EdgeError(400, 'invalid', `step ${i}: for is at most 6 h`); out.for = x.for as string | number; }
    if (x.until !== undefined) {
      const u = typeof x.until === 'string' ? {event: x.until} : x.until as Record<string, unknown>;
      const ev = u && typeof u === 'object' ? (u.event ?? u.kind) : undefined;
      if (typeof ev !== 'string' || !/^[a-z*][a-z0-9.*-]{0,60}$/.test(ev)) throw new EdgeError(400, 'invalid', `step ${i}: until must be an event kind (e.g. "presentation.started") or {event, about?, object?, place?, text?, within?}`);
      // a kind that never happens would hold the step for hours: refuse names the stream does not have
      const known = [...Object.keys(EVENT_KINDS), ...RAW_KINDS];
      if (!known.some(k => kindMatches(ev, k))) throw new EdgeError(400, 'invalid', `step ${i}: until "${ev}" is not an event kind; use one of ${['presentation.started', 'schedule.starting', 'speech.to-me', 'conversation.turn', 'approach', 'arrive.here', 'invite', 'receipt.terminal'].join(', ')} … (GET /v1/edge/schema lists all)`);
      const until: Until = {event: ev};
      for (const k of ['about', 'object', 'place', 'text'] as const) if (u[k] !== undefined) { if (typeof u[k] !== 'string' || (u[k] as string).length > 120) throw new EdgeError(400, 'invalid', `step ${i}: until.${k} must be a string`); until[k] = u[k] as string; }
      if (u.within !== undefined) { const ms = parseDuration(u.within, `step ${i}: until.within`); if (ms > 12 * 3600_000) throw new EdgeError(400, 'invalid', `step ${i}: until.within is at most 12 h`); until.within = u.within as string | number; }
      out.until = until;
    }
    if (x.onRefusal !== undefined) { if (!ON_REFUSAL.includes(x.onRefusal as OnRefusal)) throw new EdgeError(400, 'invalid', `step ${i}: onRefusal is pause-and-notify, skip or cancel`); out.onRefusal = x.onRefusal as OnRefusal; }
    if (typeof x.label === 'string') out.label = x.label.slice(0, 80);
    if (out.do === undefined && out.say === undefined && out.for === undefined && out.until === undefined) throw new EdgeError(400, 'invalid', `step ${i}: needs do, say, for or until`);
    return out;
  });
}

export class Plans {
  private byId = new Map<string, Plan>();
  private active = new Map<string, string>();          // soulId → plan id (running or paused)
  private busy = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private core: PlanCore; private actor: PlanActor; private envelope: (soulId: string, e: StreamEvent) => Envelope;
  constructor(core: PlanCore, actor: PlanActor, envelope: (soulId: string, e: StreamEvent) => Envelope, options: {tickMs?: number} = {}) {
    this.core = core; this.actor = actor; this.envelope = envelope;
    core.db.exec(`CREATE TABLE IF NOT EXISTS edge_plans_v1 (world_id TEXT NOT NULL, plan_id TEXT NOT NULL, soul_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (world_id, plan_id)) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS edge_plans_v1_soul ON edge_plans_v1 (world_id, soul_id, state);`);
    for (const r of core.db.prepare("SELECT body FROM edge_plans_v1 WHERE world_id = ? AND state IN ('running','paused') ORDER BY created_at").all(core.worldId) as {body: string}[]) {
      const p = JSON.parse(r.body) as Plan;
      const prior = this.active.get(p.soulId);
      if (prior) { const old = this.byId.get(prior)!; old.state = 'replaced'; old.reason = 'a newer plan'; this.save(old); this.byId.delete(prior); }
      this.byId.set(p.id, p); this.active.set(p.soulId, p.id);
    }
    actor.onReceipt(r => { if (this.closed) return; const p = this.planOf(r.soulId); if (p && p.state === 'running' && p.steps[p.current]?.state.receipt === r.id) void this.evaluate(p); });
    core.streams.onEvent((soulId, e) => { if (!this.closed) this.onEvent(soulId, e); });
    const ms = options.tickMs ?? PLAN_TICK_MS;
    if (ms > 0) { this.timer = setInterval(() => this.tick(), ms); this.timer.unref?.(); }
  }
  close() { this.closed = true; if (this.timer) clearInterval(this.timer); this.timer = null; }

  private planOf(soulId: string) { const id = this.active.get(soulId); return id ? this.byId.get(id) ?? null : null; }
  private load(id: string): Plan | null {
    const hit = this.byId.get(id); if (hit) return hit;
    const r = this.core.db.prepare('SELECT body FROM edge_plans_v1 WHERE world_id = ? AND plan_id = ?').get(this.core.worldId, id) as {body: string} | undefined;
    return r ? JSON.parse(r.body) as Plan : null;
  }
  private save(p: Plan) {
    p.updatedAt = this.core.now();
    this.core.db.prepare('INSERT INTO edge_plans_v1 (world_id, plan_id, soul_id, state, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (world_id, plan_id) DO UPDATE SET state = excluded.state, body = excluded.body, updated_at = excluded.updated_at')
      .run(this.core.worldId, p.id, p.soulId, p.state, JSON.stringify(p), p.createdAt, p.updatedAt);
    if (p.state !== 'running' && p.state !== 'paused') { if (this.active.get(p.soulId) === p.id) this.active.delete(p.soulId); this.byId.delete(p.id); }
  }
  private emit(p: Plan, kind: string, text: string, extra: Record<string, unknown> = {}) {
    try { this.core.streams.deliver(p.soulId, kind, this.core.tick(), {plan: {id: p.id, step: p.current, of: p.steps.length, state: p.state}, text: oneLine(text, 220), ...extra}); } catch { /* events are best effort */ }
  }

  // ------------------------------------------------------------------ API
  view(p: Plan) {
    return {id: p.id, state: p.state, current: p.current, onRefusal: p.onRefusal, createdAt: p.createdAt, updatedAt: p.updatedAt, ...(p.reason ? {reason: p.reason} : {}),
      steps: p.steps.map((s, i) => ({i, ...(s.do !== undefined ? {do: s.do} : {}), ...(s.say !== undefined ? {say: s.say} : {}), ...(s.params ? {params: s.params} : {}), ...(s.for !== undefined ? {for: s.for} : {}), ...(s.until ? {until: s.until} : {}), ...(s.onRefusal ? {onRefusal: s.onRefusal} : {}),
        label: labelOf(s), status: s.state.status, ...(s.state.capability ? {capability: s.state.capability} : {}), ...(s.state.resolved && s.state.resolved !== s.state.capability ? {resolved: s.state.resolved} : {}), ...(s.state.receipt ? {receipt: s.state.receipt} : {}),
        ...(s.state.startedAt ? {startedAt: s.state.startedAt} : {}), ...(s.state.endedAt ? {endedAt: s.state.endedAt} : {}), ...(s.state.deadline ? {endsAt: s.state.deadline} : {}), ...(s.state.code ? {code: s.state.code, reason: s.state.reason} : {}), ...(s.state.why ? {ended: s.state.why} : {})}))};
  }
  summary(soulId: string) {
    const p = this.planOf(soulId); if (!p) return null;
    const s = p.steps[p.current];
    return {id: p.id, state: p.state, step: `${p.current + 1}/${p.steps.length}`, doing: s ? labelOf(s) : null, ...(p.reason ? {reason: p.reason} : {})};
  }
  current(soul: EdgeSoul) { const p = this.planOf(soul.soulId); return {plan: p ? this.view(p) : null}; }
  get(soul: EdgeSoul, id: string) { const p = this.load(id); if (!p || p.soulId !== soul.soulId) throw new EdgeError(404, 'not-found', 'no such plan for this Soul'); return {plan: this.view(p)}; }
  /** Fade by abandonment: an executing step holds the Soul at green. */
  holding(soulId: string): string | null {
    const p = this.planOf(soulId); if (!p || p.state !== 'running') return null;
    const s = p.steps[p.current]; return s && (s.state.status === 'running' || s.state.status === 'starting') ? `plan ${p.id} step ${p.current + 1}/${p.steps.length}` : null;
  }

  async create(soul: EdgeSoul, body: Record<string, unknown>) {
    const steps = validateSteps(body.steps);
    const onRefusal = body.onRefusal === undefined ? 'pause-and-notify' : body.onRefusal as OnRefusal;
    if (!ON_REFUSAL.includes(onRefusal)) throw new EdgeError(400, 'invalid', 'onRefusal is pause-and-notify, skip or cancel');
    const old = this.planOf(soul.soulId);
    if (old) { old.state = 'replaced'; old.reason = 'a new plan replaced it'; this.emit(old, 'plan.done', `Plan replaced by a new one (it was at step ${old.current + 1}/${old.steps.length}).`, {status: 'replaced'}); this.save(old); }
    const now = this.core.now();
    const p: Plan = {id: newPlanId(), soulId: soul.soulId, state: 'running', onRefusal, current: 0, createdAt: now, updatedAt: now, steps: steps.map(s => ({...s, state: {status: 'pending', attempt: 0, reissues: 0, transient: 0}}))};
    this.byId.set(p.id, p); this.active.set(soul.soulId, p.id); this.save(p);
    await this.startStep(p);
    return {plan: this.view(p), ...(old ? {replaced: old.id} : {})};
  }

  async patch(soul: EdgeSoul, id: string, body: Record<string, unknown>) {
    const p = this.load(id);
    if (!p || p.soulId !== soul.soulId) throw new EdgeError(404, 'not-found', 'no such plan for this Soul');
    if (p.state !== 'running' && p.state !== 'paused') throw new EdgeError(409, 'conflict', `this plan is ${p.state}; POST a new plan instead`);
    const op = String(body.op ?? '');
    const abandon = (i: number, why: string) => { const s = p.steps[i]; if (s && ['pending', 'starting', 'running', 'failed'].includes(s.state.status)) { s.state.status = 'skipped'; s.state.endedAt = this.core.now(); s.state.why = why; } };
    if (op === 'cancel') { this.finish(p, 'cancelled', 'cancelled by the Soul'); return {plan: this.view(p)}; }
    if (op === 'pause') { p.state = 'paused'; p.reason = 'paused by the Soul'; this.save(p); this.emit(p, 'plan.paused', `Plan paused at step ${p.current + 1}/${p.steps.length}.`, {status: 'paused', reason: p.reason}); return {plan: this.view(p)}; }
    if (op === 'insert') {
      const steps = validateSteps(body.steps); if (p.steps.length + steps.length > PLAN_MAX_STEPS * 2) throw new EdgeError(400, 'invalid', 'the plan would be too long');
      const at = body.at === undefined ? p.current + 1 : Number(body.at);
      if (!Number.isInteger(at) || at <= p.current || at > p.steps.length) throw new EdgeError(400, 'invalid', `at must be ${p.current + 1}..${p.steps.length} (after the current step); use replace to change the current step`);
      p.steps.splice(at, 0, ...steps.map(s => ({...s, state: {status: 'pending' as const, attempt: 0, reissues: 0, transient: 0}})));
      this.save(p); return {plan: this.view(p)};
    }
    if (op === 'replace') {
      const steps = validateSteps(body.steps), from = body.from === undefined ? p.current : Number(body.from);
      if (!Number.isInteger(from) || from < p.current || from > p.steps.length) throw new EdgeError(400, 'invalid', `from must be ${p.current}..${p.steps.length}`);
      // replacing the current step keeps it in the record (skipped) and starts the first new step at once
      const now = from === p.current, kept = p.steps.slice(0, now ? from + 1 : from);
      if (now) abandon(p.current, 'replaced');
      p.steps = [...kept, ...steps.map(s => ({...s, state: {status: 'pending' as const, attempt: 0, reissues: 0, transient: 0}}))];
      if (now) { p.current = from + 1; p.state = 'running'; delete p.reason; this.save(p); await this.startStep(p); }
      else this.save(p);
      return {plan: this.view(p)};
    }
    if (op === 'skip') {
      abandon(p.current, 'skipped by the Soul'); p.state = 'running'; delete p.reason;
      this.emit(p, 'plan.step.done', `Step ${p.current + 1}/${p.steps.length} skipped: ${labelOf(p.steps[p.current]!)}.`, {status: 'skipped'});
      await this.advance(p); return {plan: this.view(p)};
    }
    if (op === 'resume') {
      if (p.state !== 'paused') return {plan: this.view(p)};
      p.state = 'running'; delete p.reason;
      const s = p.steps[p.current]!;
      if (s.state.status === 'failed' || s.state.status === 'pending') { s.state.status = 'pending'; delete s.state.code; delete s.state.reason; delete s.state.receipt; delete s.state.deadline; delete s.state.startedAt; this.save(p); await this.startStep(p); }
      else { this.save(p); await this.evaluate(p); }
      return {plan: this.view(p)};
    }
    throw new EdgeError(400, 'invalid', 'op is insert, replace, skip, pause, resume or cancel');
  }
  cancel(soul: EdgeSoul, id: string) { return this.patch(soul, id, {op: 'cancel'}); }

  // ------------------------------------------------------------------ execution
  /** Every second: deadlines, transient retries, receipts the listener may have missed, postures that ended early. */
  tick() { if (this.closed) return; for (const id of [...this.active.values()]) { const p = this.byId.get(id); if (p?.state === 'running') void this.evaluate(p); } }

  private async startStep(p: Plan) {
    const s = p.steps[p.current]; if (!s || p.state !== 'running') return;
    const now = this.core.now();
    s.state = {...s.state, status: 'starting', startedAt: now, attempt: s.state.attempt + 1};
    if (s.for !== undefined) s.state.deadline = now + parseDuration(s.for, 'for');
    if (s.until) s.state.untilBy = now + (s.until.within !== undefined ? parseDuration(s.until.within, 'within') : UNTIL_DEFAULT_MS);
    this.save(p);
    if (s.do === undefined) this.emit(p, 'plan.step.started', `Step ${p.current + 1}/${p.steps.length}: ${labelOf(s)}${s.for !== undefined ? ` for ${s.for}` : ''}${s.until ? ` until ${s.until.event}` : ''}.`);
    if (s.do === undefined && s.say === undefined) { s.state.status = 'running'; this.save(p); return; }
    await this.issue(p);
  }

  /** Make the step's act (or say). Idempotent per attempt through clientRef. */
  private async issue(p: Plan, reissue = false): Promise<void> {
    const s = p.steps[p.current]; if (!s || this.busy.has(p.id)) return;
    const soul = this.actor.soul(p.soulId);
    if (!soul) return this.stepFailed(p, 'soul.gone', 'This Soul has no body in the world.');
    this.busy.add(p.id);
    try {
      if (s.say !== undefined) {
        let said = true;
        try { this.actor.say?.(soul, s.say); } catch (e) { said = false; this.busy.delete(p.id); await this.stepFailed(p, e instanceof EdgeError ? e.code : 'say.failed', e instanceof Error ? e.message : 'could not say that'); }
        if (!said) return;
        s.state.status = 'running'; s.state.completedOnce = true; this.save(p);
        if (s.for === undefined && !s.until) { this.busy.delete(p.id); return this.stepDone(p, 'said'); }
        return;
      }
      const base: Record<string, unknown> = typeof s.do === 'string' ? {capability: s.do} : {...(s.do as Record<string, unknown>)};
      if (reissue && s.state.capability) { base.capability = s.state.capability; delete base.verb; delete base.target; }
      const params: Record<string, unknown> = {...((base.params as Record<string, unknown> | undefined) ?? {}), ...(s.params ?? {})};
      let autoSeconds = false;
      if (s.state.deadline && params.seconds === undefined && !s.state.noSeconds) {
        const left = Math.ceil((s.state.deadline - this.core.now()) / 1000);
        if (left >= 1) { params.seconds = Math.min(left, s.state.secMax ?? 1800); autoSeconds = true; }
      }
      const input = {...base, ...(Object.keys(params).length ? {params} : {}), clientRef: `pl:${p.id}:${p.current}:${s.state.attempt}`};
      delete (input as Record<string, unknown>).idempotencyKey;
      let out: Record<string, unknown>;
      try { out = await this.actor.act(soul, input); }
      catch (e) {
        if (e instanceof EdgeError && e.status < 500 && e.status !== 429) { this.busy.delete(p.id); return this.stepFailed(p, e.code, e.message); }
        s.state.transient++; s.state.status = 'starting'; s.state.retryAt = this.core.now() + TRANSIENT_RETRY_MS; this.save(p);
        if (s.state.transient > TRANSIENT_MAX) { this.busy.delete(p.id); return this.stepFailed(p, 'plan.unavailable', 'The world could not take this step after repeated tries.'); }
        return;
      }
      if (p.state !== 'running' || p.steps[p.current] !== s) return;          // the plan changed while acting
      if (out.accepted !== true) {
        const code = String(out.code ?? 'refused'), reason = String(out.reason ?? '');
        if (autoSeconds && code === 'capability.params') {
          const max = Number(/1\.\.(\d+)/.exec(reason)?.[1]);
          if (Number.isFinite(max) && max > 0 && (s.state.secMax === undefined || max < s.state.secMax) && Number(params.seconds) > max) s.state.secMax = max; else s.state.noSeconds = true;
          this.busy.delete(p.id); return this.issue(p, reissue);
        }
        if (reissue) { s.state.noReissue = true; this.save(p); return; }           // the main act already happened; keep waiting
        this.busy.delete(p.id); return this.stepFailed(p, code, reason, out.did_you_mean);
      }
      const r = out.receipt as EdgeReceipt | undefined;
      s.state.status = 'running'; s.state.transient = 0; delete s.state.retryAt;
      if (r) { s.state.receipt = r.id; s.state.capability = r.capability; }
      const resolved = (out.resolved as {to?: string} | undefined)?.to;
      if (!reissue) { s.state.resolved = resolved ?? r?.capability; }
      else { s.state.reissues++; s.state.lastIssueAt = this.core.now(); }
      this.save(p);
      if (!reissue) this.emit(p, 'plan.step.started', `Step ${p.current + 1}/${p.steps.length}: ${labelOf(s)} → ${r?.capability ?? resolved ?? 'accepted'}${s.for !== undefined ? ` for ${s.for}` : ''}${s.until ? ` until ${s.until.event}` : ''}.`, {chosen: r?.capability ?? resolved ?? null, ...(r ? {receipt: r.id} : {})});
    } finally { this.busy.delete(p.id); }
    await this.evaluate(p);
  }

  private async evaluate(p: Plan) {
    if (p.state !== 'running' || this.busy.has(p.id)) return;
    const s = p.steps[p.current]; if (!s) return;
    const now = this.core.now();
    if (s.state.status === 'pending') return this.startStep(p);
    if (s.state.status === 'starting') { if (!this.busy.has(p.id) && (s.state.retryAt ?? 0) <= now) await this.issue(p); return; }
    if (s.state.status !== 'running') return;
    if (s.state.deadline && now >= s.state.deadline) return this.stepDone(p, 'time');
    if (s.state.untilBy && now >= s.state.untilBy) return this.stepDone(p, 'timeout');
    if (!s.state.receipt) { if ((s.do === undefined && s.say === undefined || s.state.completedOnce) && s.for === undefined && !s.until) return this.stepDone(p, 'done'); return; }
    const r = this.actor.receipt(p.soulId, s.state.receipt); if (!r) return;
    const holdsOn = s.for !== undefined || !!s.until;
    if (r.phase === 'completed') {
      s.state.completedOnce = true;
      if (!holdsOn) return this.stepDone(p, 'completed');
      // `for`: keep a posture or activity up when the body's own activity ended early (a 30-min lie in a 90-min step)
      const verb = (s.state.capability ?? '').split(':')[0]!;
      if (s.state.deadline && REHOLD.has(verb) && !s.state.noReissue && s.state.deadline - now > REISSUE_MIN_LEFT_MS && s.state.reissues < REISSUE_MAX && now - (s.state.lastIssueAt ?? s.state.startedAt ?? 0) > REISSUE_GAP_MS && !this.actor.posture?.(p.soulId)) {
        s.state.attempt++; this.save(p); await this.issue(p, true);
      }
      return;
    }
    if (r.phase === 'failed') {
      if (r.code === 'receipt.lost-on-restart') { s.state.attempt++; this.save(p); return this.issue(p, s.state.completedOnce === true); }
      // a timed step keeps its activity up through world interruptions (bumped while lying, interrupted mid-pose)
      if (s.state.deadline && RESUMABLE.test(r.code ?? '') && s.state.deadline - now > REISSUE_MIN_LEFT_MS && s.state.reissues < REISSUE_MAX) {
        if (now - (s.state.lastIssueAt ?? s.state.startedAt ?? 0) <= REISSUE_GAP_MS) return;     // the next tick retries
        s.state.attempt++; s.state.completedOnce = true; this.save(p); return this.issue(p, true);
      }
      if (s.state.completedOnce) { s.state.noReissue = true; this.save(p); return; }   // the step's own act happened; a later keep-up failed
      return this.stepFailed(p, r.code ?? 'action.failed', r.reason ?? 'The act failed.');
    }
    if (r.phase === 'replaced') {
      // The Soul's own direct act took the body: pause and say so (PATCH resume / skip / replace, or let it be).
      p.state = 'paused'; p.reason = 'interrupted: your own act replaced this step'; this.save(p);
      this.emit(p, 'plan.paused', `Plan paused at step ${p.current + 1}/${p.steps.length} (${labelOf(s)}): your own act replaced it. PATCH op resume, skip, replace or cancel.`, {status: 'paused', reason: p.reason});
    }
  }

  private async stepDone(p: Plan, why: string): Promise<void> {
    const s = p.steps[p.current]; if (!s || s.state.status === 'done') return;
    s.state.status = 'done'; s.state.endedAt = this.core.now(); s.state.why = why;
    this.save(p);
    this.emit(p, 'plan.step.done', `Step ${p.current + 1}/${p.steps.length} done: ${labelOf(s)}${s.state.capability ? ` (${s.state.capability})` : ''}${why === 'time' ? ' — time is up' : why === 'until' ? ' — the moment came' : why === 'timeout' ? ' — waited long enough' : ''}.`, {status: 'done', ended: why, ...(s.state.receipt ? {receipt: s.state.receipt} : {})});
    await this.advance(p);
  }
  private async stepFailed(p: Plan, code: string, reason: string, didYouMean?: unknown): Promise<void> {
    const s = p.steps[p.current]; if (!s) return;
    s.state.status = 'failed'; s.state.endedAt = this.core.now(); s.state.code = code; s.state.reason = oneLine(reason, 300);
    if (didYouMean) s.state.didYouMean = didYouMean;
    const policy = s.onRefusal ?? p.onRefusal, alts = Array.isArray(didYouMean) ? (didYouMean as {id?: string}[]).slice(0, 4).map(d => d.id).filter(Boolean) : [];
    this.save(p);
    this.emit(p, 'plan.step.failed', `Step ${p.current + 1}/${p.steps.length} (${labelOf(s)}) ${code}: ${oneLine(reason, 120)}${alts.length ? ` — try ${alts.join(', ')}` : ''}${policy === 'skip' ? ' · skipping it' : policy === 'cancel' ? ' · plan cancelled' : ' · plan paused'}`, {status: 'failed', code, reason: s.state.reason, ...(alts.length ? {alternatives: didYouMean} : {}), onRefusal: policy});
    if (policy === 'skip') return this.advance(p);
    if (policy === 'cancel') { this.finish(p, 'cancelled', `step ${p.current + 1} refused: ${code}`); return; }
    p.state = 'paused'; p.reason = `step ${p.current + 1} refused: ${code}`; this.save(p);
    this.emit(p, 'plan.paused', `Plan paused at step ${p.current + 1}/${p.steps.length}: ${code}. PATCH op resume (retry), skip, replace or cancel.`, {status: 'paused', reason: p.reason});
  }
  private async advance(p: Plan) {
    if (p.state !== 'running') return;
    if (p.current + 1 >= p.steps.length) { p.current = p.steps.length - 1; return this.finish(p, 'done', 'all steps done'); }
    p.current++; this.save(p);
    await this.startStep(p);
  }
  private finish(p: Plan, state: PlanState, reason: string) {
    p.state = state; p.reason = reason;
    const done = p.steps.filter(s => s.state.status === 'done').length, failed = p.steps.filter(s => s.state.status === 'failed').length;
    this.emit(p, 'plan.done', `Plan ${state}: ${done}/${p.steps.length} steps done${failed ? `, ${failed} refused` : ''}${state !== 'done' ? ` (${reason})` : ''}.`, {status: state});
    this.save(p);
  }

  /** `until`: the step ends when a matching event reaches the Soul's own stream (events from before the step never count). */
  private onEvent(soulId: string, e: StreamEvent) {
    const p = this.planOf(soulId); if (!p || p.state !== 'running') return;
    const s = p.steps[p.current], u = s?.until;
    if (!s || !u || (s.state.status !== 'running' && s.state.status !== 'starting')) return;
    if (e.kind.startsWith('plan.') && !u.event.startsWith('plan')) return;
    let env: Envelope; try { env = this.envelope(soulId, e); } catch { return; }
    if (!kindMatches(u.event, env.kind) && !kindMatches(u.event, env.raw)) return;
    const has = (hay: unknown, needle: string) => String(hay ?? '').toLowerCase().includes(needle.toLowerCase());
    if (u.about && !(env.about && (env.about.soulId === u.about || has(env.about.name, u.about)))) return;
    if (u.object && (env.data?.object ?? (env.data?.invite as {id?: string} | undefined)?.id) !== u.object) return;
    if (u.place && !(env.where && (env.where.placeId === u.place || has(env.where.place, u.place)))) return;
    if (u.text && !has(env.text, u.text)) return;
    queueMicrotask(() => { if (!this.closed && p.steps[p.current] === s && (s.state.status === 'running' || s.state.status === 'starting')) void this.stepDone(p, 'until'); });
  }
}
