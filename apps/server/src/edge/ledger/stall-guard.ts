// stall-guard/1 — no Soul's body stays held by an activity that has stopped making progress (Gene's review 2026-10-23, #19:
// Mickey stayed "riding" after the balloon landed, every request failed actor.busy; "this needs to be prevented").
//
// Every second the guard reads each Soul body's hold (engine stallProbeV1, packages/engine-mars/src/stall.ts). A hold that
// should end by itself (a claim or marker left by an action that is gone, a deferred stop, a transfer phase such as boarding,
// stepping out, standing up) and whose signature (pose, holders, phases) has not changed is a stall:
//   (a) after LIMIT_S (default 30, per-activity override in LIMIT_BY_VERB) the world ends it: a logged 'edge-stop'
//       {stallReleaseV1} (replay is exact) frees the body and stands it at the nearest free spot; the owner gets a
//       `stall:released` receipt (code stall.released, detail.stallV1) in the day timeline;
//   (b) the owner wins: a request waiting for the stalled body releases it after OWNER_S (10 s, inside the engine's 15 s
//       release wait), and stand:here releases at once (a live seat's own safe exit first gets OWNER_S);
//   (c) the guard holds no durable state: after a restore it re-arms from the restored world, so a held body is released
//       LIMIT_S after boot at the latest.
// Never released: a body in a carrier that is aloft, construction work (the engine's own safety owns those), steady holds
// (sitting, lying, riding while flying).
import type {EdgeSoul} from '../contract.ts';

export const LIMIT_S = 30;
/** Per-activity override (seconds without progress) keyed by the holding action's verb. */
export const LIMIT_BY_VERB: Record<string, number> = {};
/** A request from the owner's agent is waiting for this body: the stalled holder does not get the full limit. */
export const OWNER_S = 10;
const SEATS = new Set(['sit', 'take_slot', 'stand']);
const TPS = 20;

type Probe = {held: boolean; candidate: boolean; exempt: string | null; signature: string; verbs: string[]; pending: boolean;
  holders: {verb: string; phase: string; state: string}[]; markers: string[]};
export type StallGuardHost = {
  tick(): number;
  souls(): EdgeSoul[];
  probe(entityId: string): Probe | null;
  /** Logs the release ('edge-stop' {stallReleaseV1}); resolves once the world applied it. */
  release(soul: EdgeSoul, reason: {code: string; message: string}): Promise<unknown>;
  /** The owner's receipt for the release (stall:released, completed, code stall.released). */
  record(soul: EdgeSoul, reason: string, detail: Record<string, unknown>): void;
};

export type StallV1 = {contract: 'stall/1'; what: string; holders: string[]; markers: string[]; seconds: number; trigger: 'limit' | 'owner-request' | 'stand'};

function what(p: Probe): string {
  const v = p.holders.find(h => h.state !== 'steady') ?? p.holders[0];
  if (p.markers.includes('carrier') || v?.verb === 'carrier_ride') return 'stepping out of a ride';
  if (v && ['sit', 'take_slot', 'stand'].includes(v.verb)) return 'getting up from a seat';
  if (v) return `${v.verb.replace(/_/g, ' ')}${v.phase ? ` (${v.phase})` : ''}`;
  return 'a hold left behind by an action that had ended';
}

export class StallGuard {
  private seen = new Map<string, {sig: string; since: number}>();
  private releasing = new Set<string>();
  private h: StallGuardHost;
  private opts: {limitS?: number};
  constructor(h: StallGuardHost, opts: {limitS?: number} = {}) {this.h = h; this.opts = opts;}

  limitTicks(p: Probe): number {
    if (p.pending) return OWNER_S * TPS;
    const own = p.verbs.map(v => LIMIT_BY_VERB[v]).filter((n): n is number => typeof n === 'number');
    return Math.round((own.length ? Math.max(...own) : this.opts.limitS ?? LIMIT_S) * TPS);
  }

  /** Ops kill-switch (and the BEFORE run of the stall tests): SIM_STALL_GUARD=off. */
  readonly off = process.env.SIM_STALL_GUARD === 'off';
  afterTick(tick: number) {
    // not paused by a quiet renewal: a held body is what would keep the world from ever becoming quiet
    if (this.off || tick % TPS !== 0) return;
    const live = new Set<string>();
    for (const soul of this.h.souls()) {
      live.add(soul.soulId);
      const p = this.h.probe(soul.entityId);
      if (!p || !p.held || !p.candidate || p.exempt) {this.seen.delete(soul.soulId); continue;}
      const s = this.seen.get(soul.soulId);
      if (!s || s.sig !== p.signature) {this.seen.set(soul.soulId, {sig: p.signature, since: tick}); continue;}
      // `since` is first sight, up to a sample (1 s) after the hold stopped moving, and the logged release lands a tick or
      // two later: fire 2 s early so the body is free within the limit
      if (tick - s.since + 2 * TPS >= this.limitTicks(p)) void this.fire(soul, p, Math.round((tick - s.since) / TPS), p.pending ? 'owner-request' : 'limit');
    }
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
  }

  /** stand:here from the owner's agent: a stalled hold (of a kind that should end by itself) is released at once. */
  async ownerStand(soul: EdgeSoul): Promise<boolean> {
    const p = this.off ? null : this.h.probe(soul.entityId);
    if (!p || !p.held || !p.candidate || p.exempt) return false;
    const s = this.seen.get(soul.soulId), still = s && s.sig === p.signature ? this.h.tick() - s.since : 0;
    // A live seat runs its own safe exit (it waits for someone standing at the seat's exit to step away): the stand goes
    // there first, and the guard steps in once that exit has made no progress for OWNER_S. Anything else (a ride, a
    // leftover claim) would accept the stand and leave the body held, so it is released now.
    if (p.holders.some(h => SEATS.has(h.verb) && h.state !== 'orphan') && still < OWNER_S * TPS) return false;
    return this.fire(soul, p, s ? Math.round((this.h.tick() - s.since) / TPS) : 0, 'stand');
  }

  private async fire(soul: EdgeSoul, p: Probe, seconds: number, trigger: StallV1['trigger']): Promise<boolean> {
    if (this.releasing.has(soul.soulId)) return false;
    this.releasing.add(soul.soulId);
    const w = what(p), message = `${soul.name} was stuck ${w}${seconds ? ` for ${seconds} s` : ''}; the world ended it and set ${soul.name} down nearby.`;
    try {
      await this.h.release(soul, {code: 'stall.released', message});
      this.seen.delete(soul.soulId);
      // stall-release-support/1 (#447): the landing filled between the probe and the fold, so the world set nothing down:
      // no "released" receipt for a body still held (the guard looks again later)
      if (this.h.probe(soul.entityId)?.exempt === 'release.unsupported') return false;
      const stallV1: StallV1 = {contract: 'stall/1', what: w, holders: p.holders.map(x => `${x.verb}${x.phase ? ':' + x.phase : ''}`), markers: p.markers, seconds, trigger};
      this.h.record(soul, message, {stallV1});
      return true;
    } catch {return false;} finally {this.releasing.delete(soul.soulId);}
  }
}
