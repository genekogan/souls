// LINK BODY (2026-10-24, Gene: "Soul = body, one state"; spec team/SPEC-SOUL-LINK-20261024.md §2, contract
// team/scratch/link/COMMON-LINK.md §2). The body never leaves the world any more; its posture follows the agent's presence:
//
//   awake   connected (a listen open, or one within SLEEP_GRACE; an accepted action counts too) and directed
//   idle    connected but no accepted action, owner message or addressed turn for IDLE_START: every IDLE_STEP the body
//           sits (a free seat within 15 m, else the ground), stands, dozes or drifts; dozing dominates after IDLE_DOZE
//   zombie  disconnected (no listen for SLEEP_GRACE): a body without a soul. Every 20-60 s a short slow shuffle (2-6 m,
//           half walking speed) to a random point within REFLEX_RADIUS of where it was left, on dry ground, in the same
//           place (never through a door), along a clear straight line
//   asleep  ZOMBIE_WANDER later: still where it stands (lying down; seated stays seated; a ride basket keeps it; in water
//           it floats at the surface)
//
// A listen opening wakes the body (stands up in place); an accepted action wakes it too (the action itself moves it).
// An owner message or a conversation turn addressed to the Soul ends the idle reflex at once (a doze stands up first).
// Gene's standing-rule exception (lanes/GENE-DECISIONS.md): these are body rules, never goals, speech or model calls. Every
// move is an ordinary logged decision (trigger `edge-body`), so replay stays exact; the rule's own clock and state are not
// part of the world's replayed state (like the fading clock was).
import type {Program} from '@souls/engine-contract';

export type BodyState = 'awake' | 'idle' | 'zombie' | 'asleep';
export type BodyDoing = 'standing' | 'sitting' | 'dozing' | 'drifting' | 'floating' | null;
export type BodyView = {state: BodyState; doing: BodyDoing; since: number};
export type BodyKnobs = {
  sleepGraceMs: number; zombieWanderMs: number; idleStartMs: number; idleStepMinMs: number; idleStepMaxMs: number; idleDozeMs: number;
  reflexRadiusM: number; zombieStepMinMs: number; zombieStepMaxMs: number; seatRadiusM: number;
};
/** COMMON-LINK §2 defaults. Real worlds never change them; a test world (or a TEST Soul, op-souls.ts) may shorten them. */
export const BODY_KNOBS: Readonly<BodyKnobs> = Object.freeze({
  sleepGraceMs: 120_000, zombieWanderMs: 1_800_000, idleStartMs: 600_000, idleStepMinMs: 180_000, idleStepMaxMs: 360_000, idleDozeMs: 1_800_000,
  reflexRadiusM: 20, zombieStepMinMs: 20_000, zombieStepMaxMs: 60_000, seatRadiusM: 15,
});
/** Zombie shuffle and idle drift lengths (m). */
export const SHUFFLE_M = [2, 6] as const, DRIFT_M = [5, 15] as const;
export const BODY_PATH_SAMPLE_M = 0.25;
/** How the body is held right now (read from the engine by the ledger). */
/** `standby`: a rolling body already in its upright rest (the sleep/doze it would be asked for; never re-issued). */
export type Posture = 'standing' | 'moving' | 'seated' | 'lying' | 'standby' | 'water' | 'basket' | 'other';
export type BodySoul = {soulId: string; entityId: string; name: string; owner: string};

/** What the rule needs from the world (the Ledger implements it; tests may fake it). */
export type BodyPort = {
  /** Live owned Souls whose body is in this world now (not away by travel). */
  souls(): BodySoul[];
  /** The agent's listen presence (inbox). Undefined port = the rule is off. */
  presence(soulId: string): {listening: boolean; at: number | null};
  createdAt(soulId: string): number | null;
  pose(entityId: string): {x: number; z: number; level: number} | null;
  posture(entityId: string): Posture;
  /** The agent's own work is in progress (an open receipt, a waiting act, an invitation it awaits). */
  agentBusy(soulId: string): boolean;
  running(entityId: string): boolean;
  /** False until the initial enclosed-place index is published; presence and wake remain immediate. */
  spatialReady?(): boolean;
  /** Dry standing ground here (no water, no wading). */
  dry(x: number, z: number): boolean;
  /** Free room for a body here; lying reserves room between path samples too. */
  clear(x: number, z: number, level: number, lying?: boolean): boolean;
  /** The enclosed places (rooms, buildings) containing this point, as one key. Equal keys = the same room, or both outdoors:
   *  a way between two points with the same key at every step never passes a door. */
  places(x: number, z: number, level: number): string;
  /** A free seat within `radius` m: the plan steps to sit there (seconds filled), or null. */
  seat(soul: BodySoul, radius: number, seconds: number): Program['steps'] | null;
  /** An upright rest adapter for bodies that cannot sit or lie. */
  standby?(soul:BodySoul,seconds:number):Program['steps']|null;
  /** Milliseconds left in the upright rest this body is running now, or null when none runs. */
  standbyLeftMs?(entityId:string):number|null;
  decide(soul: BodySoul, option: string, label: string, steps: Program['steps']): void;
  stop(soul: BodySoul): void;
  publish(soulId: string, view: BodyView): void;
};

type Row = {soul_id: string; state: BodyState; doing: BodyDoing; since: number; anchor_x: number | null; anchor_z: number | null;
  last_act: number; poke_at: number; woke_at: number; busy_at: number; idle_from: number; next_at: number; n: number; knobs: string | null};
type SqlDb = {exec(sql: string): void; prepare(sql: string): {get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[]; run(...a: unknown[]): unknown}};

const mix = (s: string, n: number) => {let h = 2166136261 ^ n; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296;};

export class BodyRule {
  private readonly db: SqlDb; private readonly worldId: string; private readonly now: () => number; private readonly port: BodyPort;
  private readonly base: BodyKnobs;
  constructor(db: SqlDb, worldId: string, port: BodyPort, options: {now?: () => number; knobs?: Partial<BodyKnobs>} = {}) {
    this.db = db; this.worldId = worldId; this.port = port; this.now = options.now ?? Date.now; this.base = {...BODY_KNOBS, ...(options.knobs ?? {})};
    db.exec(`CREATE TABLE IF NOT EXISTS edge_body_v1 (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, state TEXT NOT NULL, doing TEXT, since INTEGER NOT NULL,
      anchor_x REAL, anchor_z REAL, last_act INTEGER NOT NULL, poke_at INTEGER NOT NULL, woke_at INTEGER NOT NULL, busy_at INTEGER NOT NULL,
      idle_from INTEGER NOT NULL, next_at INTEGER NOT NULL, n INTEGER NOT NULL, knobs TEXT, PRIMARY KEY (world_id, soul_id)) WITHOUT ROWID`);
  }
  private row(soulId: string) {return this.db.prepare('SELECT * FROM edge_body_v1 WHERE world_id=? AND soul_id=?').get(this.worldId, soulId) as Row | undefined;}
  private save(r: Row) {
    this.db.prepare(`INSERT INTO edge_body_v1 (world_id,soul_id,state,doing,since,anchor_x,anchor_z,last_act,poke_at,woke_at,busy_at,idle_from,next_at,n,knobs) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (world_id,soul_id) DO UPDATE SET state=excluded.state,doing=excluded.doing,since=excluded.since,anchor_x=excluded.anchor_x,anchor_z=excluded.anchor_z,last_act=excluded.last_act,
      poke_at=excluded.poke_at,woke_at=excluded.woke_at,busy_at=excluded.busy_at,idle_from=excluded.idle_from,next_at=excluded.next_at,n=excluded.n,knobs=excluded.knobs`)
      .run(this.worldId, r.soul_id, r.state, r.doing, r.since, r.anchor_x, r.anchor_z, r.last_act, r.poke_at, r.woke_at, r.busy_at, r.idle_from, r.next_at, r.n, r.knobs);
  }
  knobs(soulId: string, r = this.row(soulId)): BodyKnobs {
    if (!r?.knobs) return this.base;
    try {return {...this.base, ...(JSON.parse(r.knobs) as Partial<BodyKnobs>)};} catch {return this.base;}
  }
  /** TEST Souls only (op-souls.ts) or test worlds: shorten this Soul's clocks. `null` restores the defaults. */
  setKnobs(soulId: string, knobs: Partial<BodyKnobs> | null) {
    const r = this.row(soulId) ?? this.fresh(soulId, this.now());
    const clean: Partial<BodyKnobs> = {};
    for (const [k, v] of Object.entries(knobs ?? {})) if (k in BODY_KNOBS && typeof v === 'number' && Number.isFinite(v) && v >= 0) (clean as Record<string, number>)[k] = v;
    r.knobs = knobs && Object.keys(clean).length ? JSON.stringify(clean) : null; this.save(r);
    return this.knobs(soulId, r);
  }
  /** The public body (contract `body`), or null for a Soul the rule has not seen. */
  view(soulId: string): BodyView | null {const r = this.row(soulId); return r ? {state: r.state, doing: r.doing, since: r.since} : null;}
  /** Off-world bodies (ambient life must leave them alone): anything but awake. */
  reflexOwns(soulId: string) {const r = this.row(soulId); return !!r && r.state !== 'awake';}

  private fresh(soulId: string, now: number): Row {
    return {soul_id: soulId, state: 'awake', doing: null, since: now, anchor_x: null, anchor_z: null, last_act: now, poke_at: 0, woke_at: now, busy_at: 0, idle_from: now, next_at: now, n: 0, knobs: null};
  }
  /** First sight of a Soul (a new Soul, or every Soul on the first boot with the rule): its state as if the rule had always run. */
  private first(s: BodySoul, now: number): Row {
    const r = this.fresh(s.soulId, now), k = this.knobs(s.soulId), p = this.port.presence(s.soulId);
    const sign = Math.max(p.at ?? -Infinity, this.port.createdAt(s.soulId) ?? -Infinity);
    r.last_act = r.woke_at = Number.isFinite(sign) ? Math.min(sign, now) : 0;
    if (p.listening || now - r.woke_at < k.sleepGraceMs) {r.since = r.woke_at || now; return r;}
    const zombieAt = r.woke_at + k.sleepGraceMs;
    if (r.woke_at && now - zombieAt < k.zombieWanderMs) {
      const at = this.port.pose(s.entityId);
      Object.assign(r, {state: 'zombie', doing: this.inWater(s) ? 'floating' : 'drifting', since: zombieAt, anchor_x: at?.x ?? null, anchor_z: at?.z ?? null, next_at: now + this.jitter(s.soulId, r, k.zombieStepMinMs, k.zombieStepMaxMs)});
    } else Object.assign(r, {state: 'asleep', doing: this.sleepDoing(s), since: r.woke_at ? zombieAt + k.zombieWanderMs : now, next_at: now});
    return r;
  }
  private jitter(soulId: string, r: Row, lo: number, hi: number) {r.n++; return Math.round(lo + (hi - lo) * mix(soulId, r.n));}
  private inWater(s: BodySoul) {return this.port.posture(s.entityId) === 'water';}
  private sleepDoing(s: BodySoul): BodyDoing {
    const p = this.port.posture(s.entityId);
    return p === 'water' ? 'floating' : p === 'seated' || p === 'basket' ? 'sitting' : p === 'lying' || p === 'standby' ? 'dozing' : p === 'moving' ? 'drifting' : 'standing';
  }
  private set(s: BodySoul, r: Row, state: BodyState, doing: BodyDoing, now: number) {
    const changed = r.state !== state || r.doing !== doing;
    if (r.state !== state) r.since = now;
    r.state = state; r.doing = doing; this.save(r);
    if (changed) this.port.publish(s.soulId, {state, doing, since: r.since});
  }

  /** Any accepted action by the Soul: awake at once (the action moves the body; nothing is stopped here). */
  touch(soulId: string) {
    const s = this.port.souls().find(x => x.soulId === soulId), now = this.now();
    const r = this.row(soulId) ?? this.fresh(soulId, now);
    r.last_act = now; r.woke_at = Math.max(r.woke_at, now);
    if (s && r.state !== 'awake') this.set(s, r, 'awake', null, now); else this.save(r);
  }
  /** Waking limit (load/waking.ts, SIM_WAKING_LIMIT=1 only): false = this connected Soul waits its turn, body asleep. */
  mayWake?: (soulId: string) => boolean;
  /** A listen opened: wake a zombie or sleeper (stand up in place). */
  listen(soulId: string) {
    const s = this.port.souls().find(x => x.soulId === soulId), r = this.row(soulId); if (!s || !r) return;
    if ((r.state === 'zombie' || r.state === 'asleep') && this.mayWake?.(soulId) !== false) this.wake(s, r, this.now());
  }
  /** An owner message delivered or a conversation turn addressed to the Soul: ends the idle reflex (a doze stands up). */
  poke(soulId: string) {
    const s = this.port.souls().find(x => x.soulId === soulId), r = this.row(soulId), now = this.now(); if (!s || !r) return;
    r.poke_at = now;
    if (r.state !== 'idle') {this.save(r); return;}
    if (!this.port.agentBusy(soulId) && (r.doing === 'dozing' || r.doing === 'drifting' || this.port.posture(s.entityId) === 'lying')) this.standUp(s);
    this.set(s, r, 'awake', null, now);
  }
  private wake(s: BodySoul, r: Row, now: number) {
    r.woke_at = now; r.anchor_x = r.anchor_z = null;
    const p = this.port.posture(s.entityId);
    if (!this.port.agentBusy(s.soulId) && (p === 'lying' || p === 'moving' || this.port.running(s.entityId)) && p !== 'seated' && p !== 'basket') this.standUp(s);
    this.set(s, r, 'awake', null, now);
  }
  /** Stand up in place: a logged stand that replaces a doze, a sleep or a shuffle (and says so on the Soul's public line). */
  private standUp(s: BodySoul) {this.port.posture(s.entityId) === 'water' ? this.port.stop(s) : this.port.decide(s, 'body:wake', 'Standing up', [{verb: 'stand', params: {}}]);}

  /** Once a second (world ticks): advance every Soul's body. */
  sweep() {
    const now = this.now();
    for (const s of this.port.souls()) {
      try {this.step(s, now);} catch (e) {console.error('[body]', s.soulId, e instanceof Error ? e.message : e);}
    }
  }
  private step(s: BodySoul, now: number) {
    const known = this.row(s.soulId), r = known ?? this.first(s, now);
    if (!known) {this.save(r); this.port.publish(s.soulId, {state: r.state, doing: r.doing, since: r.since});}
    const k = this.knobs(s.soulId, r), p = this.port.presence(s.soulId);
    const sign = Math.max(p.at ?? -Infinity, r.last_act, r.woke_at);
    if (p.listening || now - sign < k.sleepGraceMs) {
      if (r.state === 'zombie' || r.state === 'asleep') {
        if (this.mayWake?.(s.soulId) !== false) return this.wake(s, r, now);
        if (r.state === 'asleep') return;   // waiting its turn: the body sleeps where it is
        r.next_at = now; this.set(s, r, 'asleep', this.sleepDoing(s), now); return this.settle(s, r, now);
      }
      if (this.port.agentBusy(s.soulId)) {r.busy_at = now; if (r.state === 'idle') this.set(s, r, 'awake', null, now); else this.save(r); return;}
      const quiet = Math.max(r.last_act, r.poke_at, r.woke_at, r.busy_at);
      if (r.state === 'awake' && now - quiet >= k.idleStartMs) {r.idle_from = now; r.next_at = now; const at = this.port.pose(s.entityId); r.anchor_x = at?.x ?? null; r.anchor_z = at?.z ?? null; this.set(s, r, 'idle', this.restingWord(s), now);}
      if (r.state === 'idle' && now >= r.next_at) this.idleStep(s, r, now, k);
      return;
    }
    // disconnected
    if (r.state === 'awake' || r.state === 'idle') {
      if (!this.port.agentBusy(s.soulId) && this.port.running(s.entityId)) this.port.stop(s);   // a reflex doze/drift ends; the agent's own act runs on
      const at = this.port.pose(s.entityId); r.anchor_x = at?.x ?? null; r.anchor_z = at?.z ?? null;
      r.next_at = now + this.jitter(s.soulId, r, k.zombieStepMinMs, k.zombieStepMaxMs);
      return this.set(s, r, 'zombie', this.inWater(s) ? 'floating' : 'drifting', now);
    }
    if (r.state === 'zombie') {
      if (now - r.since >= k.zombieWanderMs) {r.next_at = now; this.set(s, r, 'asleep', this.sleepDoing(s), now); return this.settle(s, r, now);}
      const doing: BodyDoing = this.inWater(s) ? 'floating' : 'drifting';
      if (doing !== r.doing) this.set(s, r, 'zombie', doing, now);
      if (now < r.next_at) return;
      if (this.port.spatialReady?.() === false) return;
      r.next_at = now + this.jitter(s.soulId, r, k.zombieStepMinMs, k.zombieStepMaxMs); this.save(r);
      if (doing === 'drifting' && !this.port.agentBusy(s.soulId) && !this.port.running(s.entityId)) this.shuffle(s, r, SHUFFLE_M, k.reflexRadiusM, 'zombie', 'Shuffling about');
      return;
    }
    // Report the actual posture even when a nap was refused or a pending shuffle is still stopping.
    const doing = this.sleepDoing(s);
    if (doing !== r.doing) this.set(s, r, 'asleep', doing, now);
    // Keep the posture (a pose ends after an hour; a first lie-down may have been refused).
    if (now >= r.next_at) this.settle(s, r, now);
  }
  /** Asleep: lie down where it stands unless seated, in a basket or in water (floating there, still). */
  private settle(s: BodySoul, r: Row, now: number) {
    r.next_at = now + 60_000;
    const p = this.port.posture(s.entityId), doing = this.sleepDoing(s);
    if (doing !== r.doing) this.set(s, r, 'asleep', doing, now); else this.save(r);
    if (p === 'standby') {const left = this.port.standbyLeftMs?.(s.entityId); if (left != null) {r.next_at = now + Math.min(60_000, left); this.save(r);} return;}   // look again when the standby ends
    if (p === 'seated' || p === 'basket' || p === 'lying') return;
    if (p === 'water') {if (this.port.running(s.entityId) && !this.port.agentBusy(s.soulId)) this.port.stop(s); return;}
    if (this.port.agentBusy(s.soulId) && this.port.running(s.entityId)) return;
    // a shuffle still under way stops first; the body lies down at the next look (a pose refuses a body mid-walk)
    if (p === 'moving' && this.port.running(s.entityId)) {this.port.stop(s); r.next_at = now + 3000; this.save(r); return;}
    const standby=this.port.standby?.(s,3600);if(standby){this.port.decide(s,'body:asleep','Sleeping upright',standby);return;}
    this.port.decide(s, 'body:asleep', 'Sleeping', [{verb: 'mars:pose_v1', params: {activity: 'nap', seconds: 3600}}]);
  }
  private restingWord(s: BodySoul): BodyDoing {const p = this.port.posture(s.entityId); return p === 'water' ? 'floating' : p === 'seated' || p === 'basket' ? 'sitting' : p === 'lying' || p === 'standby' ? 'dozing' : 'standing';}
  /** Idle reflex: one move, weighted by how long the Soul has idled (doze dominates after IDLE_DOZE). */
  private idleStep(s: BodySoul, r: Row, now: number, k: BodyKnobs) {
    if (this.port.posture(s.entityId) === 'moving' && this.port.running(s.entityId)) {this.port.stop(s); r.next_at = now + 3000; this.save(r); return;}   // a drift ends first
    if (this.port.spatialReady?.() === false) return;
    const stepMs = this.jitter(s.soulId, r, k.idleStepMinMs, k.idleStepMaxMs); r.next_at = now + stepMs;
    const posture = this.port.posture(s.entityId), seconds = Math.max(5, Math.min(600, Math.round(stepMs / 1000) + 30));
    if (posture === 'water' || posture === 'basket') return this.set(s, r, 'idle', posture === 'water' ? 'floating' : 'sitting', now);
    const late = now - r.idle_from >= k.idleDozeMs;
    const w: [Exclude<BodyDoing, null | 'floating'>, number][] = late ? [['dozing', 8], ['sitting', 1], ['standing', 1], ['drifting', 0.5]] : [['sitting', 3], ['standing', 2], ['drifting', 2], ['dozing', 1]];
    let x = mix(s.soulId + ':idle', ++r.n) * w.reduce((a, [, n]) => a + n, 0), pick = w[0][0];
    for (const [m, n] of w) {if (x < n) {pick = m; break;} x -= n;}
    const up: Program['steps'] = posture === 'seated' || posture === 'lying' ? [{verb: 'stand', params: {}}] : [];
    const standby=this.port.standby?.(s,seconds);
    if(standby&&(pick==='sitting'||pick==='dozing')&&posture==='standby'){   // already in standby: continue it, never cancel and re-ask; look again when it ends
      const left=this.port.standbyLeftMs?.(s.entityId);if(left!=null)r.next_at=now+Math.min(stepMs,left);this.set(s,r,'idle','dozing',now);return;}
    if(standby&&(pick==='sitting'||pick==='dozing')){this.port.decide(s,'body:doze','Standby (upright)',[...up,...standby]);this.set(s,r,'idle','dozing',now);return;}
    if (pick === 'sitting') {
      if (posture === 'seated') return this.set(s, r, 'idle', 'sitting', now);
      const seat = this.port.seat(s, k.seatRadiusM, seconds);
      this.port.decide(s, 'body:sit', seat ? 'Sitting for a while' : 'Sitting on the ground', seat ?? [...up, {verb: 'mars:pose_v1', params: {activity: 'sit-ground', seconds}}]);
    } else if (pick === 'dozing') this.port.decide(s, 'body:doze', 'Dozing', [...up, {verb: 'mars:pose_v1', params: {activity: 'nap', seconds}}]);
    else if (pick === 'standing') {if (up.length || this.port.running(s.entityId)) this.port.decide(s, 'body:stand', 'Standing, looking around', [...up, {verb: 'rest', params: {seconds}}]);}
    else if (!this.shuffle(s, r, DRIFT_M, k.reflexRadiusM, 'idle', 'Drifting about', up)) pick = 'standing';
    this.set(s, r, 'idle', pick, now);
  }
  /** A short slow walk to a random point within `radius` of the anchor: dry ground, the same place, a clear straight line. */
  private shuffle(s: BodySoul, r: Row, len: readonly [number, number], radius: number, kind: 'zombie' | 'idle', label: string, before: Program['steps'] = []): boolean {
    const at = this.port.pose(s.entityId); if (!at || at.level !== 0) return false;
    const ax = r.anchor_x ?? at.x, az = r.anchor_z ?? at.z, room = this.port.places(at.x, at.z, 0);
    for (let tries = 0; tries < 12; tries++) {
      const ang = mix(s.soulId + ':a', ++r.n) * Math.PI * 2, d = len[0] + (len[1] - len[0]) * mix(s.soulId + ':d', r.n);
      const x = Math.round((at.x + Math.cos(ang) * d) * 100) / 100, z = Math.round((at.z + Math.sin(ang) * d) * 100) / 100;
      if (Math.hypot(x - ax, z - az) > radius) continue;
      if (!this.lineOk(at.x, at.z, x, z, room, kind === 'zombie')) continue;
      this.save(r);
      this.port.decide(s, `body:${kind}-shuffle`, label, [...before, {verb: 'walk_to', params: {to: [x, z], pace: 'shuffle'}}]);
      return true;
    }
    this.save(r); return false;
  }
  /** Every quarter metre of the way (and the end): dry, inside exactly the same places.
   * Zombies reserve lying room along the whole way: sleep may interrupt a shuffle at any point. */
  private lineOk(x0: number, z0: number, x1: number, z1: number, room: string, lying: boolean) {
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / BODY_PATH_SAMPLE_M));
    for (let i = lying ? 0 : 1; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n;
      if (!this.port.dry(x, z) || !this.port.clear(x, z, 0, lying) || this.port.places(x, z, 0) !== room) return false;
    }
    return true;
  }
  /** LINK BODY migration: a Soul the old beam took comes back asleep where it lies (the ledger placed it). */
  restoreAsleep(s: BodySoul) {
    const now = this.now(), r = this.row(s.soulId) ?? this.fresh(s.soulId, now);
    Object.assign(r, {last_act: 0, woke_at: 0, poke_at: 0, busy_at: 0, next_at: now, anchor_x: null, anchor_z: null});
    r.state = 'asleep'; r.doing = this.sleepDoing(s); r.since = now; this.save(r);
    this.port.publish(s.soulId, {state: 'asleep', doing: r.doing, since: now});
  }
}
