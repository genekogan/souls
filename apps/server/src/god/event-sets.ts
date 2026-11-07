// EVENTS (2026-10-15, backlog R6): events that physically appear. A scheduled event may carry a `set` (the schedule
// schema in @souls/world-compiler layers.ts): market stalls for a Saturday market, a stage with floodlights for a dusk
// concert. While the event is on, the clock step places the set inside the scheduled thing (engine edits, so viewers see
// it arrive and Souls perceive it as ordinary things); when it ends, the set is packed away (removed).
//
// Identity without new storage: each piece is a named child of the scheduled thing (`<event>-<def>-<n>`, so Souls read
// "market-stall-2" in the square) and carries a seed in a reserved band, so pieces left behind by an event the god has
// since removed (or an earlier server run) are still recognised and packed away. Nothing else carries such a seed.
import { eventsOn, type Entity, type Op, type Result, type WorldModel } from '@souls/world-compiler';
import type { layers } from '@souls/world-compiler';

type SetPiece = layers.SetPiece;
type Clock = { minute: number; weekday: number };
/** Pieces carry a seed in [SET_SEED, SET_SEED + SET_SEEDS). */
export const SET_SEED = 1_947_000_000;
const SET_SEEDS = 1_000_000;
export const isSetPiece = (e: Entity) => typeof e.seed === 'number' && e.seed >= SET_SEED && e.seed < SET_SEED + SET_SEEDS;
/** A refused piece is retried after this long (a Soul standing where the stall goes): real milliseconds. */
const RETRY_MS = 30_000;

const short = (def: string) => def.replace(/^sha:/, '').replace(/^(core|eden|lm|mars)[-/]/, '').replace(/@\d+$/, '').replace(/[^a-z0-9-]+/g, '-').slice(0, 24) || 'thing';
/** The names of an event's pieces, in order: concert-floodlight-1, concert-floodlight-2, concert-stage-1. */
export function pieceNames(event: string, set: readonly SetPiece[]): string[] {
  const n = new Map<string, number>();
  return set.map((p) => { const k = short(p.def), i = (n.get(k) ?? 0) + 1; n.set(k, i); return `${event}-${k}-${i}`.slice(0, 48).replace(/[-.]+$/, ''); });
}
/** A stable seed per piece (the same piece looks the same every time it is set up). */
function seedOf(host: string, event: string, i: number): number {
  let h = 2166136261; for (const c of `${host}|${event}|${i}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return SET_SEED + ((h >>> 0) % SET_SEEDS);
}
/** The centre of a thing in its own frame: an area's centroid (a zone, a square), else its origin. */
function centreOf(e: Entity): [number, number] {
  const a = (e.shape as { area?: [number, number][] } | undefined)?.area;
  if (!a?.length) return [0, 0];
  const p = e.p ?? [0, 0, 0], px = p[0], pz = p.length === 3 ? p[2] : p[1];
  let x = 0, z = 0; for (const [ax, az] of a) { x += ax; z += az; }
  return [x / a.length - px, z / a.length - pz];   // an area is in world coordinates; its children are placed from its pose
}

export type EventSetHost = {
  model: WorldModel;
  engineAct(ops: Op[], note: string): Result;
  log(m: string): void;
};

/** Where each event set stands now: what is out and what the world refused. The god reads it in `layers`. */
export type SetStatus = { thing: string; event: string; label: string; pieces: number; out: number; on: boolean; refused?: string[] };

export class EventSets {
  private h: EventSetHost;
  /** `${hostId}|${event}|${i}` → world minute before which a refused piece is not retried; and why it was refused. */
  private refused = new Map<string, { until: number; why: string }>();
  private now: () => number;
  constructor(h: EventSetHost, now: () => number = Date.now) { this.h = h; this.now = now; }
  private get m() { return this.h.model; }
  /** Pieces standing now, by `${parentId}/${name}`. */
  private standing(): Map<string, Entity> {
    const out = new Map<string, Entity>();
    for (const e of this.m.entities.values()) if (isSetPiece(e) && e.name) out.set(`${e.in.parent}/${e.name}`, e);
    return out;
  }

  /** Does a standing piece still match its set entry (the same def, place, turn and state)? */
  private matches(e: Entity, host: Entity, piece: SetPiece): boolean {
    const [cx, cz] = centreOf(host), p = e.p ?? [0, 0], ez = p.length === 3 ? p[2] : p[1];
    if (Math.abs(p[0] - (cx + piece.p[0])) > 0.01 || Math.abs((ez ?? 0) - (cz + piece.p[1])) > 0.01) return false;
    if ((typeof e.r === 'number' ? e.r : 0) !== (piece.r ?? 0)) return false;
    if (this.m.resolvedDef(e.def)?.hash !== this.m.resolvedDef(piece.def)?.hash) return false;
    for (const [k, v] of Object.entries(piece.state ?? {})) if (JSON.stringify(e.state?.[k]) !== JSON.stringify(v)) return false;
    return true;
  }
  /** Is any event set in play (scheduled, or still standing)? Cheap enough to gate the step. */
  active(): boolean {
    for (const e of this.m.entities.values()) if (isSetPiece(e) || e.schedule?.events?.some((ev) => ev.set?.length)) return true;
    return false;
  }

  /** One clock step: set up the sets of events that are on, pack away pieces whose event is not. Returns the counts. */
  step(c: Clock): { set: number; packed: number } {
    const want = new Map<string, { host: Entity; event: string; label: string; i: number; piece: SetPiece; name: string }>();
    for (const host of this.m.entities.values()) {
      const events = host.schedule?.events?.filter((ev) => ev.set?.length); if (!events?.length) continue;
      const on = new Set(eventsOn({ events }, c.minute, c.weekday).map((x) => x.name));
      for (const ev of events) {
        if (!on.has(ev.name)) continue;
        const names = pieceNames(ev.name, ev.set!);
        ev.set!.forEach((piece, i) => want.set(`${host.id}/${names[i]}`, { host, event: ev.name, label: ev.label ?? ev.name, i, piece, name: names[i] }));
      }
    }
    // pack away: a piece whose event is not on (ended, removed, or its thing's schedule changed)
    const packOps: Op[] = [], packed: string[] = [];
    for (const e of this.m.entities.values()) {
      if (!isSetPiece(e)) continue;
      const parent = this.m.entities.get(e.in.parent);
      if (parent && isSetPiece(parent)) continue;                 // goes with its piece
      const w = want.get(`${e.in.parent}/${e.name ?? ''}`);
      if (w && this.matches(e, w.host, w.piece)) continue;          // a set the god changed while it is out is set up again
      packOps.push({ op: 'remove', id: e.id, cascade: true } as Op); packed.push(e.name ?? e.id);
    }
    const stand = this.standing();
    let nPacked = 0;
    for (const op of packOps) {          // one at a time: a piece in use (a Soul sitting on it) waits, the rest go
      const r = this.h.engineAct([op], `event over: packed away ${this.m.pathOf((op as { id: string }).id)}`);
      if (r.accepted) nPacked++;
    }
    // set up: pieces of events that are on and not standing yet
    let nSet = 0;
    const byEvent = new Map<string, Op[]>(), keys = new Map<string, string[]>();
    for (const [path, w] of want) {
      const k = `${w.host.id}|${w.event}|${w.i}`;
      if (stand.has(path)) { this.refused.delete(k); continue; }
      if ((this.refused.get(k)?.until ?? 0) > this.now()) continue;
      const [cx, cz] = centreOf(w.host);
      const op = { op: 'place', def: w.piece.def, name: w.name, in: { parent: w.host.id }, p: [cx + w.piece.p[0], cz + w.piece.p[1]], ...(w.piece.r !== undefined ? { r: w.piece.r } : {}), ...(w.piece.state ? { state: w.piece.state } : {}), ...(w.piece.params ? { params: w.piece.params } : {}), seed: seedOf(w.host.id, w.event, w.i), mode: 'nudge' } as unknown as Op;
      const ek = `${w.host.id}|${w.event}`; byEvent.set(ek, [...(byEvent.get(ek) ?? []), op]); keys.set(ek, [...(keys.get(ek) ?? []), k]);
    }
    for (const [ek, ops] of byEvent) {
      const [hostId, event] = ek.split('|'), where = this.m.pathOf(hostId), label = [...want.values()].find((w) => w.host.id === hostId && w.event === event)?.label ?? event;
      const r = this.h.engineAct(ops, `${label}: set up ${ops.length} thing${ops.length === 1 ? '' : 's'} at ${where}`);
      if (r.accepted) { nSet += ops.length; continue; }
      // one refused piece must not keep the whole set away: place them one by one, remember the refusals
      ops.forEach((op, j) => {
        const one = this.h.engineAct([op], `${label}: set up ${(op as { name: string }).name} at ${where}`);
        if (one.accepted) { nSet++; return; }
        const f = (one as { failures?: { code: string; detail?: string }[] }).failures?.[0], why = `${(op as { name: string }).name}: ${f?.code ?? 'refused'}${f?.detail ? ` (${f.detail})` : ''}`.slice(0, 200);
        this.refused.set(keys.get(ek)![j], { until: this.now() + RETRY_MS, why });
        this.h.log(`event set refused ${why}`);
      });
    }
    if (packed.length) this.h.log(`event sets: packed away ${packed.length} (${packed.slice(0, 6).join(', ')})`);
    return { set: nSet, packed: nPacked };
  }

  /** "the Saturday market is on: 4 market stalls and a banner set up, until 13:00" for a thing's description. */
  onNow(e: Entity, c: Clock | null): string {
    const events = e.schedule?.events?.filter((ev) => ev.set?.length); if (!c || !events?.length) return '';
    const out: string[] = [];
    for (const on of eventsOn({ events }, c.minute, c.weekday)) {
      const ev = events.find((x) => x.name === on.name)!, names = pieceNames(ev.name, ev.set!);
      const stand = this.standing(), standing = names.filter((n) => stand.has(`${e.id}/${n}`));
      if (!standing.length) continue;
      const end = (c.minute + on.left) % 1440, hhmm = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
      out.push(`${on.label} is on here now (${describeSet(ev.set!.filter((_, i) => standing.includes(names[i])))} set up, until ${hhmm})`);
    }
    return out.join('; ');
  }

  /** Each event set with what stands now (the god's `layers` view). */
  status(c: Clock | null): SetStatus[] {
    const out: SetStatus[] = [], stand = this.standing();
    for (const e of this.m.entities.values()) for (const ev of e.schedule?.events ?? []) {
      if (!ev.set?.length) continue;
      const names = pieceNames(ev.name, ev.set), path = this.m.pathOf(e.id), on = !!c && eventsOn({ events: [ev] }, c.minute, c.weekday).length > 0;
      const refused = ev.set.map((_, i) => this.refused.get(`${e.id}|${ev.name}|${i}`)?.why).filter((x): x is string => !!x);
      out.push({ thing: path, event: ev.name, label: ev.label ?? ev.name, pieces: ev.set.length, out: names.filter((n) => stand.has(`${e.id}/${n}`)).length, on, ...(refused.length && on ? { refused } : {}) });
    }
    return out;
  }
}

/** "4 market stalls and a banner". */
export function describeSet(set: readonly SetPiece[]): string {
  const n = new Map<string, number>(); for (const p of set) { const k = short(p.def).replace(/-/g, ' '); n.set(k, (n.get(k) ?? 0) + 1); }
  const parts = [...n].map(([k, c]) => c === 1 ? (k.endsWith('s') ? k : `${/^[aeiou]/.test(k) ? 'an' : 'a'} ${k}`) : `${c} ${k.endsWith('s') ? k : k.replace(/(ch|sh|x)$/, '$1e') + 's'}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? 'nothing';
}
