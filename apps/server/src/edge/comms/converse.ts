// `converse` — private, membership-based conversations (EDGE-CONTRACT-v1 §6, vision §6).
// Only members receive turns. A member silent for the inactivity timeout drops; pending
// invitations and join requests expire after the (shorter) invite timeout, and the members
// hear `invite-expired`. Faded (absent) Souls cannot be invited; a pending invitation to a
// Soul that fades expires at the next sweep. A conversation closes
// when no member remains, or one member remains with no pending invitation.
// State lives in SQLite so conversations and turns survive restart.
import type {EdgeSoul} from '../contract.ts';
import {EdgeError} from '../contract.ts';
import {newId, soulRef, textParam, type CommsCore} from './core.ts';
import {tx} from './store.ts';

export const INVITE_RADIUS = 6;
export const MAX_INVITEES = 8;
export const MAX_MEMBERS = 12;

type Ref = {soulId: string; name: string};
type Member = Ref & {joinedAt: number; lastAt: number; fromTurn: number};
type Pending = Ref & {at: number; by?: string};
type Body = {id: string; state: 'open' | 'closed'; createdBy: string; createdTick: number; createdAt: number;
  members: Member[]; invited: Pending[]; asks: Pending[]; turns: number; closedAt?: number; closedReason?: string;
  /** #1139: who has left and the turns they were there for, so memory's pointers into a conversation still read. */
  past?: {soulId: string; fromTurn: number; toTurn: number}[]};

export type ConverseResult = {accepted: true; [k: string]: unknown} | {accepted: false; code: string; reason: string; conversation?: string};
const refuse = (code: string, reason: string, conversation?: string): ConverseResult => ({accepted: false, code, reason, ...(conversation ? {conversation} : {})});

export class Conversations {
  private core: CommsCore; private timeoutMs: number; private inviteTimeoutMs: number;
  constructor(core: CommsCore, timeoutMs: number, inviteTimeoutMs = timeoutMs) { this.core = core; this.timeoutMs = timeoutMs; this.inviteTimeoutMs = Math.min(inviteTimeoutMs, timeoutMs); }

  private load(id: string): Body | undefined {
    const row = this.core.db.prepare('SELECT body FROM edge_comms_conversations WHERE world_id = ? AND id = ?').get(this.core.worldId, id) as {body: string} | undefined;
    return row ? JSON.parse(row.body) as Body : undefined;
  }
  private save(b: Body) {
    this.core.db.prepare('INSERT INTO edge_comms_conversations (world_id, id, state, created_at, updated_at, body) VALUES (?,?,?,?,?,?) ON CONFLICT (world_id, id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at, body = excluded.body')
      .run(this.core.worldId, b.id, b.state, b.createdAt, this.core.now(), JSON.stringify(b));
  }
  private ids = (list: Ref[]) => list.map(m => m.soulId);
  private currentRef=(m:Ref)=>({soulId:m.soulId,name:this.core.nameOf(m.soulId),...this.core.nameMetadata?.(m.soulId)});
  private refs = (list: Ref[],current=true) => list.map(m => current?this.currentRef(m):{soulId:m.soulId,name:m.name});

  /** What a given Soul may see of a conversation. */
  view(b: Body, viewer: string) {
    const member = b.members.some(m => m.soulId === viewer);
    return {id: b.id, state: b.state, members: this.refs(b.members,b.state==='open'), invited: this.refs(b.invited,b.state==='open'),
      ...(member ? {asks: this.refs(b.asks)} : {}), turns: member ? b.turns : undefined,
      role: member ? 'member' : b.invited.some(m => m.soulId === viewer) ? 'invited' : b.asks.some(m => m.soulId === viewer) ? 'asked' : 'none',
      ...(b.closedReason ? {closedReason: b.closedReason} : {}), untrusted: true};
  }

  private emit(to: string[], kind: string, body: Record<string, unknown>) {
    const tick = this.core.tick();
    for (const id of new Set(to)) this.core.streams.deliver(id, kind, tick, body);
  }
  private memberEvent(b: Body, to: string[], who: Ref, change: string, extra: Record<string, unknown> = {}) {
    this.emit(to, 'conversation.member', {conversation: b.id, soul: this.currentRef(who), change, members: this.refs(b.members), ...extra, untrusted: true});
    // Spectators see every membership change (doc 26 §10), so the viewer keeps its tethers honest.
    this.core.spectate({kind: 'conversation.member', tick: this.core.tick(), conversation: b.id, soul: this.currentRef(who), change, untrusted: true});
  }
  /** Closes when the membership rule says so; notifies everyone still attached. */
  private settle(b: Body, reason: string) {
    if (b.state !== 'open') return;
    if (b.members.length === 0 || (b.members.length === 1 && b.invited.length === 0)) {
      const notify = [...this.ids(b.members), ...this.ids(b.invited), ...this.ids(b.asks)];
      b.state = 'closed'; b.closedAt = this.core.now(); b.closedReason = reason; b.invited = []; b.asks = [];
      this.emit(notify, 'conversation.closed', {conversation: b.id, reason});
      this.core.spectate({kind: 'conversation.closed', tick: this.core.tick(), conversation: b.id, reason});
    }
  }

  handle(soul: EdgeSoul, input: Record<string, unknown>): ConverseResult {
    this.sweep();
    const op = input.op;
    if (typeof op !== 'string' || !['start', 'accept', 'decline', 'say', 'leave', 'ask'].includes(op)) throw new EdgeError(400, 'invalid', 'op must be start, accept, decline, say, leave or ask');
    if (op === 'start') return this.start(soul, input.with, input.text);
    if (typeof input.conversation !== 'string' || !/^cv_[A-Za-z0-9_-]{1,40}$/.test(input.conversation)) throw new EdgeError(400, 'invalid', 'conversation must be a conversation id');
    const id = input.conversation;
    const target = input.soul === undefined ? undefined : typeof input.soul === 'string' ? input.soul : (() => { throw new EdgeError(400, 'invalid', 'soul must be a Soul id'); })();
    return tx(this.core.db, () => {
      const b = this.load(id);
      const involved = b && (b.members.some(m => m.soulId === soul.soulId) || b.invited.some(m => m.soulId === soul.soulId) || b.asks.some(m => m.soulId === soul.soulId));
      if (!b || (!involved && op !== 'ask')) return refuse('conversation.unknown', 'No such conversation for you.', id);
      if (b.state !== 'open') return refuse('conversation.closed', 'That conversation has closed.', id);
      let out: ConverseResult;
      switch (op) {
        case 'accept': out = target ? this.admit(b, soul, target) : this.accept(b, soul); break;
        case 'decline': out = target ? this.reject(b, soul, target) : this.decline(b, soul); break;
        case 'say': out = this.say(b, soul, input.text); break;
        case 'leave': out = this.leave(b, soul); break;
        case 'ask': out = this.ask(b, soul); break;
        default: throw new EdgeError(400, 'invalid', 'op must be start, accept, decline, say, leave or ask');
      }
      this.save(b);
      return out;
    });
  }

  private start(soul: EdgeSoul, withRaw: unknown, textRaw: unknown): ConverseResult {
    if (!Array.isArray(withRaw) || withRaw.length < 1 || withRaw.length > MAX_INVITEES || withRaw.some(s => typeof s !== 'string'))
      throw new EdgeError(400, 'invalid', `with must list 1..${MAX_INVITEES} Soul ids`);
    const text = textRaw === undefined ? undefined : textParam(textRaw, 500);
    const invitees = [...new Set(withRaw as string[])];
    if (invitees.includes(soul.soulId)) return refuse('conversation.self', 'You cannot invite yourself.');
    const unknown = invitees.find(id => !this.core.isLive(id));
    if (unknown) return refuse('soul.unknown', `No Soul ${unknown} in this world.`);
    const faded = invitees.filter(id => this.core.isFaded?.(id));
    if (faded.length) return refuse('soul.faded', `${faded.map(id => this.core.nameOf(id)).join(', ')} faded from the world (no one has acted for them in an hour) and cannot hear you; they return when their agent acts again.`);
    const near = new Set(this.core.deps.ledger.perceivedBodies(soul.soulId, INVITE_RADIUS).filter(b => b.distance <= INVITE_RADIUS).map(b => b.soulId));
    const far = invitees.filter(id => !near.has(id));
    if (far.length) return refuse('conversation.out-of-range', `${far.map(id => this.core.nameOf(id)).join(', ')} must be within ${INVITE_RADIUS} m to be invited.`);
    const now = this.core.now(), tick = this.core.tick();
    const b: Body = {id: newId('cv'), state: 'open', createdBy: soul.soulId, createdTick: tick, createdAt: now,
      members: [{...soulRef(soul), joinedAt: now, lastAt: now, fromTurn: 0}],
      invited: invitees.map(id => ({soulId: id, name: this.core.nameOf(id), at: now, by: soul.soulId})), asks: [], turns: 0};
    return tx(this.core.db, () => {
      if (text) this.addTurn(b, soul, text, false);
      this.save(b);
      this.emit(invitees, 'conversation.invite', {conversation: b.id, from: this.currentRef(soul), members: this.refs(b.members), ...(text ? {text} : {}), untrusted: true});
      this.core.spectate({kind: 'conversation.start', tick, conversation: b.id, from: this.currentRef(soul), invited: this.refs(b.invited), untrusted: true});
      return {accepted: true, conversation: this.view(b, soul.soulId)};
    });
  }

  private accept(b: Body, soul: EdgeSoul): ConverseResult {
    const inv = b.invited.find(m => m.soulId === soul.soulId);
    if (!inv) return b.members.some(m => m.soulId === soul.soulId) ? refuse('conversation.already-member', 'You are already in this conversation.', b.id) : refuse('conversation.not-invited', 'You have not been invited; use op "ask".', b.id);
    if (b.members.length >= MAX_MEMBERS) return refuse('conversation.full', 'That conversation is full.', b.id);
    b.invited = b.invited.filter(m => m.soulId !== soul.soulId);
    this.join(b, soulRef(soul));
    return {accepted: true, conversation: this.view(b, soul.soulId)};
  }
  private join(b: Body, who: Ref) {
    const now = this.core.now();
    b.members.push({...who, joinedAt: now, lastAt: now, fromTurn: b.turns});
    b.asks = b.asks.filter(m => m.soulId !== who.soulId);
    this.memberEvent(b, this.ids(b.members), who, 'joined');
  }
  private decline(b: Body, soul: EdgeSoul): ConverseResult {
    if (!b.invited.some(m => m.soulId === soul.soulId)) return refuse('conversation.not-invited', 'There is no invitation to decline.', b.id);
    b.invited = b.invited.filter(m => m.soulId !== soul.soulId);
    this.memberEvent(b, this.ids(b.members), soulRef(soul), 'declined');
    this.settle(b, 'one-member');
    return {accepted: true, conversation: this.view(b, soul.soulId)};
  }
  /** A member admits a Soul that asked to join. */
  private admit(b: Body, soul: EdgeSoul, target: string): ConverseResult {
    if (!b.members.some(m => m.soulId === soul.soulId)) return refuse('conversation.not-member', 'Only members may accept a request to join.', b.id);
    const ask = b.asks.find(m => m.soulId === target);
    if (!ask) return refuse('conversation.no-request', 'That Soul has not asked to join.', b.id);
    if (b.members.length >= MAX_MEMBERS) return refuse('conversation.full', 'That conversation is full.', b.id);
    this.join(b, {soulId: ask.soulId, name: ask.name});
    return {accepted: true, conversation: this.view(b, soul.soulId)};
  }
  private reject(b: Body, soul: EdgeSoul, target: string): ConverseResult {
    if (!b.members.some(m => m.soulId === soul.soulId)) return refuse('conversation.not-member', 'Only members may decline a request to join.', b.id);
    const ask = b.asks.find(m => m.soulId === target);
    if (!ask) return refuse('conversation.no-request', 'That Soul has not asked to join.', b.id);
    b.asks = b.asks.filter(m => m.soulId !== target);
    this.memberEvent(b, [...this.ids(b.members), target], ask, 'declined');
    return {accepted: true, conversation: this.view(b, soul.soulId)};
  }
  private say(b: Body, soul: EdgeSoul, textRaw: unknown): ConverseResult {
    const text = textParam(textRaw, 500);
    if (!b.members.some(m => m.soulId === soul.soulId)) return refuse('conversation.not-member', 'Only members may speak in a conversation.', b.id);
    const turn = this.addTurn(b, soul, text, true);
    return {accepted: true, conversation: b.id, turn, heardBy: b.members.length - 1};
  }
  private addTurn(b: Body, soul: EdgeSoul, text: string, deliver: boolean) {
    const seq = ++b.turns, tick = this.core.tick(), at = this.core.now();
    this.core.db.prepare('INSERT INTO edge_comms_turns (world_id, conversation_id, seq, soul_id, tick, at, text) VALUES (?,?,?,?,?,?,?)').run(this.core.worldId, b.id, seq, soul.soulId, tick, at, text);
    const me = b.members.find(m => m.soulId === soul.soulId);
    if (me) me.lastAt = at;
    const name=this.core.nameOf(soul.soulId);
    this.core.db.prepare('INSERT INTO edge_comms_turn_names_v1(world_id,conversation_id,seq,name) VALUES(?,?,?,?)').run(this.core.worldId,b.id,seq,name);
    const turn = {seq, tick, at, from: {...this.currentRef(soul),name}, text};
    if (deliver) this.emit(this.ids(b.members).filter(id => id !== soul.soulId), 'conversation.turn', {conversation: b.id, turn, untrusted: true});
    this.core.spectate({kind: 'conversation.turn', tick, conversation: b.id, turn, untrusted: true});
    return {seq, tick, at};
  }
  private retain(b: Body, soulId: string) {
    const m = b.members.find(x => x.soulId === soulId); if (!m) return;
    (b.past ??= []).push({soulId, fromTurn: m.fromTurn, toTurn: b.turns});   // one range per membership: nothing said while away
  }
  private leave(b: Body, soul: EdgeSoul): ConverseResult {
    if (b.members.some(m => m.soulId === soul.soulId)) {
      this.retain(b, soul.soulId);
      b.members = b.members.filter(m => m.soulId !== soul.soulId);
      this.memberEvent(b, this.ids(b.members), soulRef(soul), 'left');
    } else if (b.asks.some(m => m.soulId === soul.soulId)) {
      b.asks = b.asks.filter(m => m.soulId !== soul.soulId);
    } else return refuse('conversation.not-member', 'You are not in that conversation.', b.id);
    this.settle(b, 'one-member');
    return {accepted: true, conversation: this.view(b, soul.soulId)};
  }
  private ask(b: Body, soul: EdgeSoul): ConverseResult {
    if (b.members.some(m => m.soulId === soul.soulId)) return refuse('conversation.already-member', 'You are already in this conversation.', b.id);
    if (b.invited.some(m => m.soulId === soul.soulId)) return refuse('conversation.invited', 'You are already invited; use op "accept".', b.id);
    if (b.asks.some(m => m.soulId === soul.soulId)) return {accepted: true, conversation: this.view(b, soul.soulId)};
    const near = new Set(this.core.deps.ledger.perceivedBodies(soul.soulId, INVITE_RADIUS).filter(x => x.distance <= INVITE_RADIUS).map(x => x.soulId));
    if (!b.members.some(m => near.has(m.soulId))) return refuse('conversation.out-of-range', `A member must be within ${INVITE_RADIUS} m to ask to join.`, b.id);
    b.asks.push({...soulRef(soul), at: this.core.now()});
    this.memberEvent(b, this.ids(b.members), soulRef(soul), 'asked');
    return {accepted: true, conversation: this.view(b, soul.soulId)};
  }

  /** Drops silent members and expired requests; closes conversations by the rule. */
  sweep(): number {
    const now = this.core.now(), cutoff = now - this.timeoutMs, inviteCutoff = now - this.inviteTimeoutMs;
    const gone = (id: string) => this.core.isFaded?.(id) === true;
    let changed = 0;
    const rows = this.core.db.prepare("SELECT id FROM edge_comms_conversations WHERE world_id = ? AND state = 'open' AND updated_at <= ?").all(this.core.worldId, now) as {id: string}[];
    for (const {id} of rows) tx(this.core.db, () => {
      const b = this.load(id);
      if (!b || b.state !== 'open') return;
      const dropped = b.members.filter(m => m.lastAt <= cutoff || gone(m.soulId));
      const isExpired = (m: Pending) => m.at <= inviteCutoff || gone(m.soulId);
      const expired = b.invited.filter(isExpired), lapsed = b.asks.filter(isExpired);
      if (!dropped.length && !expired.length && !lapsed.length) return;
      b.invited = b.invited.filter(m => !isExpired(m));
      b.asks = b.asks.filter(m => !isExpired(m));
      for (const m of expired) {
        this.emit([m.soulId], 'conversation.closed', {conversation: b.id, reason: 'invite-expired'});
        // The inviter (and any other member) hears plainly that nobody answered, and why if known.
        this.memberEvent(b, this.ids(b.members), m, 'invite-expired', {reason: gone(m.soulId) ? 'soul.faded' : 'no-answer'});
      }
      for (const m of lapsed) this.emit([m.soulId], 'conversation.closed', {conversation: b.id, reason: 'request-expired'});
      for (const m of dropped) {
        this.retain(b, m.soulId);
        b.members = b.members.filter(x => x.soulId !== m.soulId);
        this.memberEvent(b, [...this.ids(b.members), m.soulId], m, 'dropped');
      }
      this.settle(b, dropped.length ? 'inactive' : expired.length ? 'invite-expired' : 'one-member');
      this.save(b); changed++;
    });
    return changed;
  }

  /** Conversations I am in, invited to or asked to join; plus open ones I could ask to join. */
  list(soul: EdgeSoul) {
    this.sweep();
    const rows = this.core.db.prepare("SELECT body FROM edge_comms_conversations WHERE world_id = ? AND state = 'open'").all(this.core.worldId) as {body: string}[];
    const open = rows.map(r => JSON.parse(r.body) as Body);
    const mine = open.filter(b => [...b.members, ...b.invited, ...b.asks].some(m => m.soulId === soul.soulId));
    let near = new Set<string>();
    try { near = new Set(this.core.deps.ledger.perceivedBodies(soul.soulId, INVITE_RADIUS).filter(x => x.distance <= INVITE_RADIUS).map(x => x.soulId)); } catch { /* bodiless */ }
    const nearby = open.filter(b => !mine.includes(b) && b.members.some(m => near.has(m.soulId)));
    return {conversations: mine.map(b => this.view(b, soul.soulId)), nearby: nearby.map(b => ({id: b.id, members: this.refs(b.members), untrusted: true}))};
  }

  /** Turns a member is entitled to read: those spoken since they joined. */
  turns(soul: EdgeSoul, id: string, after: number, limit = 100) {
    const b = this.load(id);
    const me = b?.members.find(m => m.soulId === soul.soulId), was = b?.past?.filter(p => p.soulId === soul.soulId) ?? [];
    if (!b || (!me && !was.length)) throw new EdgeError(404, 'not-found', 'no such conversation for you');
    const spans = [...was.map(p => [p.fromTurn, p.toTurn] as const), ...(me ? [[me.fromTurn, Number.MAX_SAFE_INTEGER] as const] : [])];
    const rows = this.core.db.prepare(`SELECT seq, soul_id, tick, at, text FROM edge_comms_turns WHERE world_id = ? AND conversation_id = ? AND seq > ? AND (${spans.map(() => '(seq > ? AND seq <= ?)').join(' OR ')}) ORDER BY seq LIMIT ?`).all(this.core.worldId, id, after, ...spans.flat(), limit) as {seq: number; soul_id: string; tick: number; at: number; text: string}[];
    return {conversation: me ? this.view(b, soul.soulId) : {...this.view({...b, members: [], invited: [], asks: []}, soul.soulId), left: true}, turns: rows.map(r => {const historical=this.core.db.prepare('SELECT name FROM edge_comms_turn_names_v1 WHERE world_id=? AND conversation_id=? AND seq=?').get(this.core.worldId,id,r.seq) as {name:string}|undefined;return {seq:r.seq,tick:r.tick,at:r.at,from:{soulId:r.soul_id,name:historical?.name??this.core.nameOf(r.soul_id),currentName:this.core.nameOf(r.soul_id),nameSource:historical?'at-turn':'current-projection'},text:r.text};}), untrusted:true};
  }
}
