// Authoritative, temporary resident probes. No HTTP, model, clock acceleration,
// invitation or owner credential is involved in verification.
import { holder, lockStatus } from '../../../../tools/god-skill/lib/locks.mjs';
import {z} from 'zod';
import type {Entity} from '@souls/world-compiler';
import type {WorldHost, HostListener} from '../world.ts';
import type {Souls} from '../souls.ts';
import type {SoulRow} from '../db.ts';
import type {EdgeSoul} from '../edge/contract.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import {inPoly} from '../edge/ledger/places.ts';
import {engineBridges, type EngineBridge} from './engine-bridge.ts';
import type {GodMode} from './god.ts';
import {runQuery} from './query.ts';
import {isVerificationProbe, PROBE_OWNER} from '../verification-probe.ts';

type V2 = [number, number];
type Use = 'enter' | 'sit';
export const verifyCodes = ['verify.no-target', 'verify.no-seat', 'verify.timeout', 'verify.busy', 'verify.refused'] as const;
export const verifyUseSchema = z.object({
  target: z.string().min(1).max(200),
  uses: z.array(z.enum(['enter', 'sit'])).min(1).max(2).refine(a => new Set(a).size === a.length, 'uses must be unique').default(['enter', 'sit']),
  from: z.union([z.string().min(1).max(200), z.tuple([z.number().finite(), z.number().finite()])]).optional(),
  seat: z.string().min(1).max(200).optional(),
  timeoutMs: z.number().int().min(1).max(180_000).default(90_000),
}).strict();
type Input = z.infer<typeof verifyUseSchema>;
type Reason = {code: typeof verifyCodes[number]; message: string; engineCode?: string};
type Point = {p: V2; level: number};
type Reach = {ok: true; length: number; legs: number; levels: number[]} | {ok: false; code: string; message: string};
type Proof = {kind: 'room' | 'footprint' | 'seat'; at: V2; tick: number; ms: number; room?: string; seat?: string};
type UseResult = {use: Use; ok: boolean; door?: string; crossing?: {at: V2; distToDoor?: number}; proof?: Proof; room?: string; seat?: string; occupant?: string; distanceToSlot?: number; interiorRoute?: {from: Point; to: Point; reach: Reach; relocatedTo?: V2; finalApproach: 'physical'}; reason?: Reason};
type Timings = Record<'birth' | 'start' | 'enter' | 'sit' | 'retire', number>;
type Stamp = {ms: number; tick: number};
type ActionTiming = {capability: string; slot: string; requested: Stamp; accepted?: Stamp; programStarted?: Stamp; arrived?: Stamp; seated?: Stamp; phases: {phase: string; at: Stamp; position: V2}[]; predicateTrue?: Stamp};
export type VerifyReceipt = {ok: boolean; target: string; uses: UseResult[]; probe: {created: boolean; removed: boolean; removal: 'done' | 'pending'; entityId?: string}; timings: Timings; actions?: ActionTiming[]; previousRemovalWaitMs?: number; ms: number; notes: string[]; reason?: Reason};
type Description = {id: string; path: string; aabb: [number, number, number, number]; rooms: {id: string; floor: number; polygon: V2[]}[]; slots: {id: string; kind: string; p: [number, number, number]; capacity: number; used: number; occupants: string[]}[]};
type Door = {id: string; at: V2; outward: V2; level: number};
type Body = {pose: {p: [number, number, number]}; human?: {activity?: string; level?: number}};
type Engine = {world: {entities: Record<string, Body>}; standableNearV1(at: V2, level?: number, except?: string, minClear?: number, maxRing?: number): V2 | null; reachV1(from: Point, to: Point): Reach; freeSeatSlotsV1(id: string, except?: string): {id: string; p: V2; level: number; approach?: V2}[]};
const active = new WeakSet<WorldHost>();
const lockAt = new WeakMap<WorldHost, number>();
const pendingRemoval = new WeakMap<WorldHost, Promise<void>>();
const bootSwept = new WeakSet<WorldHost>();
const round = (n: number) => Math.round(n * 1000) / 1000;
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
class Failure extends Error {
  reason: Reason;
  constructor(code: Reason['code'], message: string, engineCode?: string) { super(message); this.reason = {code, message, ...(engineCode ? {engineCode} : {})}; }
}
const reasonOf = (e: unknown): Reason => e instanceof Failure ? e.reason : {code: 'verify.refused', message: e instanceof Error ? e.message : String(e), ...((e as {code?: string})?.code ? {engineCode: (e as {code: string}).code} : {})};

export class VerifyUse {
  readonly host: WorldHost; readonly souls: Souls; readonly god: GodMode; readonly edge?: EdgeLedger;
  constructor(host: WorldHost, souls: Souls, god: GodMode, edge?: EdgeLedger) {
    this.host = host; this.souls = souls; this.god = god; this.edge = edge;
    // Once per host boot, never when another facade is constructed during a live verification.
    if (bootSwept.has(host)) return;
    bootSwept.add(host);
    const rows = new Map(souls.db.liveSouls(host.worldId).map(s => [s.id, s]));
    // A crash can follow the SQL retirement but precede native body removal.
    for (const id of host.minds.keys()) { const s = souls.db.soul(id); if (s?.world_id === host.worldId) rows.set(id, s); }
    for (const id of new Set([...Object.keys(host.engine.world.entities), ...god.model.entities.keys()])) {
      if (!id.startsWith('h_vp')) continue;
      const s = souls.db.soul('s_' + id.slice(2)); if (s?.world_id === host.worldId) rows.set(s.id, s);
    }
    const probes = [...rows.values()].filter(s => s.owner === PROBE_OWNER && isVerificationProbe(s.id));
    if (!probes.length) return;
    active.add(host); lockAt.set(host, Date.now());
    let done!: () => void, accepted = false;
    pendingRemoval.set(host, new Promise<void>(resolve => {done = resolve;}));
    const check = () => {
      if (!accepted) return;
      for (const s of probes) {
        if (host.minds.has(s.id) || host.engine.world.entities[s.entity_id]) return;
        engineBridges.get(god.model)?.bodyRetired({entityId: s.entity_id});
        if (god.model.entities.has(s.entity_id)) return;
      }
      active.delete(host); pendingRemoval.delete(host); done();
      const i = host.listeners.indexOf(cleanup); if (i >= 0) host.listeners.splice(i, 1);
    };
    const cleanup: HostListener = {afterTick: check};
    host.listeners.push(cleanup);
    // Normal journaled retirement owns SQL revocation and engine/controller cleanup.
    const retirements = probes.map(s => souls.retire(s)); host.drainInputs();
    void Promise.all(retirements).then(() => {accepted = true; check();}, () => {
      // Keep admission busy on a failed retirement; never admit a second probe over it.
      const i = host.listeners.indexOf(cleanup); if (i >= 0) host.listeners.splice(i, 1);
    });
  }

  lockInfo() {
    return { kind: 'verify-probe', present: active.has(this.host), ...lockStatus(holder('Sim verifier'), lockAt.get(this.host) ?? Date.now(), 180_000), pendingRemoval: pendingRemoval.has(this.host), break: 'native retirement; restart sweeps crashed probes before admitting another' };
  }
  async run(raw: unknown): Promise<VerifyReceipt> {
    const started = performance.now();
    const receipt: VerifyReceipt = {ok: false, target: typeof (raw as Input)?.target === 'string' ? (raw as Input).target : '', uses: [], probe: {created: false, removed: true, removal: 'done'}, timings: {birth: 0, start: 0, enter: 0, sit: 0, retire: 0}, ms: 0, notes: []};
    const parsed = verifyUseSchema.safeParse(raw);
    const fail = (reason: Reason, uses: Use[] = []) => { receipt.reason = reason; receipt.uses = uses.map(use => ({use, ok: false, reason})); receipt.ms = round(performance.now() - started); return receipt; };
    if (!parsed.success) return fail({code: 'verify.refused', message: parsed.error.issues.map(i => i.message).join('; '), engineCode: 'invalid'});
    const input = parsed.data;
    const removal = pendingRemoval.get(this.host);
    if (removal) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const at = performance.now();
      try { await Promise.race([removal, new Promise<void>(resolve => {timer = setTimeout(resolve, Math.min(3000, input.timeoutMs));})]); }
      finally {clearTimeout(timer); receipt.previousRemovalWaitMs = round(performance.now() - at);}
    }
    if (active.has(this.host) || [...this.host.minds.keys()].some(isVerificationProbe)) return fail({code: 'verify.busy', message: `This world already has a verifier probe, held by pid=${process.pid} host=${holder().host} start=${holder().start}; run doctor.`}, input.uses);
    active.add(this.host); lockAt.set(this.host, Date.now());
    let retired = false, probe: SoulRow | undefined, listener: WorldHost['listeners'][number] | undefined;
    const deadline = started + input.timeoutMs;
    const phase = async <T>(name: keyof Timings, work: () => Promise<T>): Promise<T> => {
      const at = performance.now(); try { return await work(); } finally { receipt.timings[name] = round(performance.now() - at); }
    };
    try {
      const target = this.god.model.get(input.target);
      if (!target) throw new Failure('verify.no-target', `No such target: ${input.target}`);
      receipt.target = this.god.model.pathOf(target.id);
      const bridge = engineBridges.get(this.god.model);
      if (!bridge || !this.edge) throw new Failure('verify.refused', 'The resident engine bridge and edge ledger are required.', 'unavailable');
      const engine = this.host.engine as unknown as Engine;
      const desc = this.describe(target.id), footprint = this.footprint(target, desc), doors = this.doors(target);
      const version = target.v;
      const unchanged = () => { if (this.god.model.entities.get(target.id)?.v !== version) throw new Failure('verify.refused', 'The target changed during verification; retry against its current geometry.', 'revision.stale'); };
      const inside = (p: V2, level: number) => desc.rooms.length
        ? desc.rooms.find(r => (bridge.nav.thing(`${receipt.target}/${r.id}`)?.level ?? r.floor) === level && inPoly(p[0], p[1], r.polygon))?.id
        : level === (bridge.nav.thing(receipt.target)?.level ?? 0) && this.within(p, footprint) ? receipt.target : undefined;
      const startAt = performance.now();
      let entry: ReturnType<VerifyUse['entry']>;
      try { entry = this.entry(input, footprint, doors, bridge, engine, inside, !desc.rooms.length, target); }
      finally { receipt.timings.start = round(performance.now() - startAt); }
      const created = await phase('birth', async () => {
        // Born at the arrival point when it has room, else on the nearest clear ground to it or to the walk's start
        // (an explicit --from is tried first). The physical walk below still starts at entry.start.
        const born = this.souls.createVerificationProbe({at: [round(entry.start[0]), round(entry.start[1])], ...(input.from ? {first: true} : {})}); probe = born.soul;
        receipt.probe = {created: true, removed: false, removal: 'pending', entityId: probe.entity_id};
        this.host.drainInputs(); await born.ready; return born;
      });
      probe = created.soul;
      const soul: EdgeSoul = {soulId: probe.id, entityId: probe.entity_id, name: probe.name, owner: probe.owner};
      const relocateAt = performance.now(); await this.relocate(soul, entry.start, 'start use verification');
      receipt.timings.start = round(receipt.timings.start + performance.now() - relocateAt);
      const body = () => engine.world.entities[soul.entityId];
      if (!body()) throw new Failure('verify.refused', 'Probe birth produced no engine body.', 'not-in-world');
      const position = (): V2 => [body().pose.p[0], body().pose.p[2]];
      if (dist(position(), entry.start) > 6.4) throw new Failure('verify.refused', 'The engine could not relocate the probe to the requested start.', 'route.no-start');
      if (dist(position(), entry.start) > 0.05) receipt.notes.push(`The engine chose clear standing ground ${round(dist(position(), entry.start))} m from the requested start.`);
      let previous = position(), previousInside = inside(previous, body().human?.level ?? 0);
      let crossing: UseResult['crossing'], crossingDoor: string | undefined, proof: Proof | undefined;
      listener = {afterTick: () => {
        if (!body()) return;
        const p = position(), room = inside(p, body().human?.level ?? 0);
        if (!proof && !previousInside && room) {
          proof = {kind: desc.rooms.length ? 'room' : 'footprint', at: p.map(round) as V2, tick: this.host.engine.world.tick, ms: round(performance.now() - started), ...(desc.rooms.length ? {room} : {})};
          // Refine the first outside→inside engine step to the polygon boundary.
          let lo = 0, hi = 1;
          for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2, q: V2 = [previous[0] + (p[0] - previous[0]) * mid, previous[1] + (p[1] - previous[1]) * mid]; if (inside(q, body().human?.level ?? 0)) hi = mid; else lo = mid; }
          const at: V2 = [round(previous[0] + (p[0] - previous[0]) * hi), round(previous[1] + (p[1] - previous[1]) * hi)];
          const floor = desc.rooms.find(r => r.id === room)?.floor ?? 0;
          const nearest = doors.filter(d => d.level === floor).sort((a, b) => dist(a.at, at) - dist(b.at, at))[0];
          crossing = {at, ...(nearest ? {distToDoor: round(dist(nearest.at, at))} : {})}; crossingDoor = nearest?.id;
        }
        previous = p; previousInside = room;
      }};
      this.host.listeners.push(listener);
      receipt.notes.push(`Temporary ${probe.name}; birth and retirement are journaled under ${probe.id}.`, 'Entry uses logged native programs; positions and seat occupants are engine reads.');
      if (!desc.rooms.length) receipt.notes.push('Footprint proof uses the authored area or collider AABB, inset by 0.15 m.');
      receipt.notes.push(input.from ? 'Explicit from: full physical walk, including the interior route; this can be slower.' : 'Short physical entry crossing; distant seats may use a reported, engine-planned interior relocation after entry proof.');
      let enteredSeat: Entity | undefined;
      const confirmSeat = (seat: Entity, result: UseResult) => {
        const slots = this.describe(seat.id).slots.filter(s => s.kind === 'seat' && s.occupants.includes(soul.name));
        const distance = slots.length ? Math.min(...slots.map(s => dist(position(), [s.p[0], s.p[2]]))) : Infinity;
        if (Number.isFinite(distance)) result.distanceToSlot = round(distance);
        if (slots.length) result.occupant = soul.name;
        return body().human?.activity === 'sit' && slots.length > 0 && distance <= 0.6;
      };
      const takeSeat = async (seat: Entity, result: UseResult) => {
        if (confirmSeat(seat, result)) return;
        const slot = seat.id === target.id && entry.seatSlot ? entry.seatSlot : this.reachableSeats([seat.id], {p: position(), level: body().human?.level ?? 0}, soul.entityId)[0]?.slot;
        if (!slot) throw new Failure('verify.no-seat', 'No free native seat slot in the selected fixture.');
        await this.action(soul, seat.id, slot, deadline, () => confirmSeat(seat, result), receipt, started);
      };
      const seatedProof = (seat: Entity) => {
        if (proof) return;
        proof = {kind: inside(position(), body().human?.level ?? 0) ? 'footprint' : 'seat', at: position().map(round) as V2, tick: this.host.engine.world.tick, ms: round(performance.now() - started), seat: this.god.model.pathOf(seat.id)};
      };
      for (const use of (['enter', 'sit'] as const).filter(use => input.uses.includes(use))) {
        const result: UseResult = {use, ok: false}; receipt.uses.push(result);
        try {
          this.checkTime(deadline);
          unchanged();
          if (use === 'enter') {
            if (previousInside) throw new Failure('verify.refused', 'The start position is already inside; no entry crossing can be proved.', 'verify.start-inside');
            const at = performance.now();
            try {
              if (entry.goal) await this.walk(soul, entry.goal, deadline);
              else {
                // Large seat-bearing kits can be one native fixture obstacle.
                // The normal sit walks its approach and physically claims a slot.
                const seat = this.seat(input.seat, target, entry.start), seated: UseResult = {use: 'sit', ok: false};
                await takeSeat(seat, seated); seatedProof(seat); enteredSeat = seat;
                result.seat = this.god.model.pathOf(seat.id); result.occupant = seated.occupant; result.distanceToSlot = seated.distanceToSlot;
                if (proof) proof.seat = result.seat;
                receipt.notes.push('Room-less entry proved by physical sitting on a seat in the target subtree.');
              }
            } catch (e) {
              // Entry is proved at the first ENGINE position inside, even when
              // the same walk later leaves the footprint or is interrupted.
              if (!proof) throw e;
              receipt.notes.push(`Entry position was proved before the action ended: ${reasonOf(e).message}`);
            } finally { receipt.timings.enter = round(performance.now() - at); }
            unchanged();
            result.ok = !!proof;
            if (proof) { result.proof = proof; if (proof.room) result.room = proof.room; }
            if (crossing) result.crossing = crossing;
            if (crossingDoor) result.door = crossingDoor;
            if (!result.ok) throw new Failure('verify.refused', 'The walk finished without an engine position proved inside the target.', 'route.outside');
          } else {
            const sitAt = performance.now();
            try {
              const seat = enteredSeat ?? this.seat(input.seat, target, entry.goal?.p ?? entry.start, {p: position(), level: body().human?.level ?? 0}, soul.entityId);
              result.seat = this.god.model.pathOf(seat.id);
              // Only shortcut AFTER physical entry, and never for an explicit from.
              const thing = bridge.nav.thing(result.seat), goal = thing && bridge.nav.goal(thing, position(), soul.entityId);
              if (!input.from && proof && body().human?.activity !== 'sit' && goal && goal.level === 0 && dist(position(), goal.p) > 4) {
                const from: Point = {p: position(), level: body().human?.level ?? 0}, reach = engine.reachV1(from, goal);
                result.interiorRoute = {from, to: goal, reach, finalApproach: 'physical'};
                if (!reach.ok) throw new Failure('verify.refused', reach.message, reach.code);
                const d = dist(position(), goal.p), near: V2 = [goal.p[0] + (position()[0] - goal.p[0]) / d * 1.25, goal.p[1] + (position()[1] - goal.p[1]) / d * 1.25];
                const to = engine.standableNearV1(near, goal.level, soul.entityId, 0.4, 3);
                if (to && inside(to, goal.level)) {
                  const finalReach = engine.reachV1({p: to, level: goal.level}, goal);
                  if (finalReach.ok && finalReach.length <= 3) {
                    await this.relocate(soul, to, 'engine-planned interior route; final metres walked physically');
                    if (dist(position(), to) > 0.1) throw new Failure('verify.refused', 'The engine refused the interior relocation.', 'route.no-start');
                    result.interiorRoute.relocatedTo = position().map(round) as V2;
                  }
                }
              }
              await takeSeat(seat, result);
              unchanged();
              result.ok = true;
              // A room-less fixture may also prove entry while physically seated
              // on a seat in its subtree, never from a floor-pose label alone.
              if (!desc.rooms.length && !proof) {
                seatedProof(seat);
                const enter = receipt.uses.find(r => r.use === 'enter');
                if (enter && enter.reason?.engineCode === 'route.outside') { enter.ok = true; enter.proof = proof; delete enter.reason; }
              }
            } finally { receipt.timings.sit = round(performance.now() - sitAt); }
          }
        } catch (e) { result.ok = false; result.reason = reasonOf(e); }
      }
    } catch (e) { const reason = reasonOf(e); receipt.reason = reason; for (const use of input.uses) if (!receipt.uses.some(r => r.use === use)) receipt.uses.push({use, ok: false, reason}); }
    finally {
      if (listener) { const i = this.host.listeners.indexOf(listener); if (i >= 0) this.host.listeners.splice(i, 1); }
      if (probe) {
        try {
          const retireAt = performance.now();
          const retirement = this.souls.retire(probe); this.host.drainInputs(); await retirement; retired = true;
          // Native retirement safely releases a sit controller over subsequent
          // ticks (standing up takes about a second at 20 Hz). Observe that, then
          // finish asynchronously if still pending (a paused world).
          const cleanupDeadline = performance.now() + 2000;
          while (this.host.engine.world.entities[probe.entity_id] && performance.now() < cleanupDeadline) await this.wait(cleanupDeadline);
          if (!this.host.engine.world.entities[probe.entity_id]) engineBridges.get(this.god.model)?.bodyRetired({entityId: probe.entity_id});
          receipt.probe.removed = !this.host.minds.has(probe.id) && !this.host.engine.world.entities[probe.entity_id] && !this.god.model.entities.has(probe.entity_id);
          receipt.probe.removal = receipt.probe.removed ? 'done' : 'pending';
          receipt.timings.retire = round(performance.now() - retireAt);
          if (!receipt.probe.removed) receipt.notes.push('Native retirement accepted; removal pending normal engine ticks. The next call waits up to 3 s for cleanup.');
        } catch (e) { receipt.probe.removed = false; receipt.probe.removal = 'pending'; receipt.notes.push(`Probe cleanup failed: ${reasonOf(e).message}`); }
      }
      if (receipt.probe.removed) active.delete(this.host);
      else if (probe) {
        // A paused world may still owe native physical cleanup. Keep it busy
        // until the normal engine tick removes the retired probe.
        let removed!: () => void;
        pendingRemoval.set(this.host, new Promise<void>(resolve => {removed = resolve;}));
        const entityId = probe.entity_id, cleanup = {afterTick: () => {
          if (this.host.engine.world.entities[entityId]) return;
          engineBridges.get(this.god.model)?.bodyRetired({entityId});
          if (this.god.model.entities.has(entityId)) return;
          receipt.probe.removed = true; receipt.probe.removal = 'done';
          active.delete(this.host); pendingRemoval.delete(this.host); removed();
          const i = this.host.listeners.indexOf(cleanup); if (i >= 0) this.host.listeners.splice(i, 1);
        }};
        this.host.listeners.push(cleanup);
      }
      receipt.ok = receipt.uses.length > 0 && receipt.uses.every(r => r.ok) && retired;
      receipt.ms = round(performance.now() - started);
    }
    return receipt;
  }

  private describe(ref: string) { return runQuery(this.god.model, {describe: ref}).describe as Description; }
  private footprint(e: Entity, desc: Description): V2[] {
    if (e.shape && 'area' in e.shape) return e.shape.area;
    // The collider bounds may be asymmetric (porches, offset kit parts). The
    // collider description supplies the actual world AABB.
    const [x0, z0, x1, z1] = desc.aabb;
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  }
  private worldPoint(e: Entity, [x, z]: V2): V2 {
    const p = this.god.model.worldPose(e), c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    return [p.x + (x * c + z * s) * p.s, p.z + (-x * s + z * c) * p.s];
  }
  private doors(e: Entity): Door[] {
    const m = this.god.model, def = m.resolvedDef(e.def)!, baked = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), wp = m.worldPose(e);
    return (baked.openings ?? []).filter(o => o.kind === 'door' && !baked.rooms?.some(r => r.floor === o.level && inPoly(o.at[0] + Math.sin(o.yaw), o.at[1] + Math.cos(o.yaw), r.polygon as V2[])))
      .map(o => ({id: o.id, at: this.worldPoint(e, o.at as V2), outward: [Math.sin(wp.yaw + o.yaw), Math.cos(wp.yaw + o.yaw)] as V2, level: o.level ?? 0}));
  }
  /** Conservative footprint interior: at least 15 cm from every boundary.
   * Navigation still supplies the physical collision/door-gap proof. */
  private within(p: V2, poly: V2[]) {
    return inPoly(p[0], p[1], poly) && poly.every((a, i) => {
      const b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
      const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l)) : 0;
      return dist(p, [a[0] + t * dx, a[1] + t * dz]) >= 0.15;
    });
  }
  private nativeSeats(id: string, except?: string) {
    return (this.host.engine as unknown as Engine).freeSeatSlotsV1(id, except);
  }
  private entry(input: Input, footprint: V2[], doors: Door[], bridge: EngineBridge, engine: Engine, inside: (p: V2, level: number) => string | undefined, allowSeat: boolean, target: Entity): {start: V2; goal?: Point; seatSlot?: string} {
    let from: V2 | undefined;
    if (input.from) {
      if (Array.isArray(input.from)) from = input.from;
      else {
        const e = this.god.model.get(input.from), thing = bridge.nav.thing(input.from);
        if (e) { const p = this.god.model.worldPose(e); from = [p.x, p.z]; }
        else if (thing) from = thing.at;
        else throw new Failure('verify.no-target', `No such start reference: ${input.from}`);
      }
    }
    const origin = from ?? [0, 0] as V2;
    // A room-less seat fixture can have no standing ground inside its native
    // obstacle. Start outside beside the exact native approach, then walk and
    // sit through its normal controller. Pin the slot: another slot may be
    // nearer to this start while facing the opposite side of a large gazebo.
    if (allowSeat && !from && !doors.length && (!input.seat || this.god.model.get(input.seat)?.id === target.id)) {
      for (const slot of this.nativeSeats(target.id).sort((a, b) => dist(a.p, origin) - dist(b.p, origin))) {
        if (slot.level !== 0) continue;
        const approach = slot.approach;
        if (!approach) continue;
        const d = dist(approach, slot.p);
        if (d < 0.05) continue;
        const outside: V2 = [approach[0] + (approach[0] - slot.p[0]) / d * 0.8, approach[1] + (approach[1] - slot.p[1]) / d * 0.8];
        const start = engine.standableNearV1(outside, 0, undefined, 0.4, 3);
        if (start && !inPoly(start[0], start[1], footprint)) return {start, seatSlot: slot.id};
      }
    }
    const candidates: {at: V2; outward: V2}[] = doors.filter(d => d.level === 0);
    if (!candidates.length) {
      const centre: V2 = [footprint.reduce((s, p) => s + p[0], 0) / footprint.length, footprint.reduce((s, p) => s + p[1], 0) / footprint.length];
      for (let i = 0; i < footprint.length; i++) {
        const a = footprint[i], b = footprint[(i + 1) % footprint.length], length = dist(a, b);
        if (!length) continue;
        let outward: V2 = [(b[1] - a[1]) / length, -(b[0] - a[0]) / length];
        if ((centre[0] - a[0]) * outward[0] + (centre[1] - a[1]) * outward[1] > 0) outward = [-outward[0], -outward[1]];
        const count = Math.min(64, Math.max(1, Math.ceil(length)));
        for (let n = 0; n < count; n++) candidates.push({at: [a[0] + (b[0] - a[0]) * (n + 0.5) / count, a[1] + (b[1] - a[1]) * (n + 0.5) / count], outward});
      }
    }
    candidates.sort((a, b) => dist(a.at, origin) - dist(b.at, origin));
    let seatStart: V2 | undefined;
    // a room-less target on a raised floor (a deck reached by its stairs): the goal stands on that floor, the start on the ground
    const level = doors.length ? 0 : bridge.nav.thing(this.god.model.pathOf(target.id))?.level ?? 0;
    for (const c of candidates) {
      const outside: V2 = [c.at[0] + c.outward[0] * 0.9, c.at[1] + c.outward[1] * 0.9];
      const inward: V2 = [c.at[0] - c.outward[0] * 0.9, c.at[1] - c.outward[1] * 0.9];
      const start = from ?? engine.standableNearV1(outside, 0, undefined, 0.4, 3);
      const goal = engine.standableNearV1(inward, level, undefined, 0.4, 3);
      if (!start || (!from && (allowSeat ? inPoly(start[0], start[1], footprint) : inside(start, 0)))) continue;
      seatStart ??= start;
      if (goal && inside(goal, level)) return {start, goal: {p: goal, level}};
    }
    if (allowSeat && seatStart) return {start: seatStart};
    throw new Failure('verify.refused', 'No clear exterior approach and interior standing point at the target boundary.', 'route.no-entry');
  }
  private async relocate(soul: EdgeSoul, to: V2, why: string) {
    const moved = this.host.enqueue('edge-relocate', `verify-use:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, to, why: `verifier probe: ${why}`});
    this.host.drainInputs(); await moved;
  }
  /** Same engine verbs as GodNav, admitted through the normal logged decision.
   * No target capability, name, place or edge vocabulary lookup is involved. */
  private async walk(soul: EdgeSoul, goal: Point, deadline: number) {
    this.checkTime(deadline);
    const engine = this.host.engine as unknown as Engine, b = engine.world.entities[soul.entityId];
    const reach = engine.reachV1({p: [b.pose.p[0], b.pose.p[2]], level: b.human?.level ?? 0}, goal);
    if (!reach.ok) throw new Failure('verify.refused', reach.message, reach.code);
    let admitted: {programId?: string; programOk?: boolean; programCode?: string} | undefined;
    let terminal: {kind: string; code?: string} | undefined;
    const listener: HostListener = {
      onDecision: (e, r) => {if (e.payload.soulId === soul.soulId && e.payload.trigger === 'verify-use:enter') admitted = r;},
      onProgram: e => {if (e.id === admitted?.programId && e.kind !== 'step') terminal = e;},
    };
    this.host.listeners.push(listener);
    try {
      const step = goal.level === 0 && (b.human?.level ?? 0) === 0
        ? {verb: 'walk_to', params: {to: goal.p, standoff: 0}}
        : {verb: 'mars:walk_to', params: {x: goal.p[0], z: goal.p[1], level: goal.level}};
      const queued = this.host.enqueue('decision', `verify-use:${soul.soulId}`, {soulId: soul.soulId, entityId: soul.entityId, option: 'verify-use:enter', label: 'verifier probe: cross target boundary', steps: [step], reevalTicks: 1e9, fallback: false, trigger: 'verify-use:enter'});
      this.host.drainInputs(); await queued;
      if (!admitted?.programOk) throw new Failure('verify.refused', 'The engine refused the entry walk.', admitted?.programCode ?? 'program.refused');
      while (!terminal) {this.checkTime(deadline); await this.wait(deadline);}
      if (terminal.kind !== 'completed') throw new Failure('verify.refused', 'The physical entry walk did not complete.', terminal.code ?? terminal.kind);
    } finally { const i = this.host.listeners.indexOf(listener); if (i >= 0) this.host.listeners.splice(i, 1); }
  }
  private seat(ref: string | undefined, target: Entity, at: V2, from?: Point, except?: string): Entity {
    const m = this.god.model, ids = new Set([target.id, ...m.subtree(target.id)]);
    const explicit = ref ? m.get(ref) : undefined;
    if (ref && (!explicit || !ids.has(explicit.id))) throw new Failure('verify.no-seat', `Seat ${ref} is not in the target subtree.`);
    const candidates = (explicit ? [explicit] : [...ids].map(id => m.entities.get(id)!)).flatMap(e => {
      const slots = this.describe(e.id).slots.filter(s => s.kind === 'seat' && s.used < s.capacity);
      return slots.length ? [{e, d: Math.min(...slots.map(s => dist(at, [s.p[0], s.p[2]])))}] : [];
    }).sort((a, b) => a.d - b.d || a.e.id.localeCompare(b.e.id));
    if (!candidates[0]) throw new Failure('verify.no-seat', 'No free seat slot in the target subtree.');
    // Prefer a seat a resident can actually reach from where the probe stands (a pew whose front is the next pew's
    // back has no standing room; another pew, or the aisle end of the row, may). With none, the nearest stays and
    // the engine reports its own refusal.
    if (from && candidates.length > 1) {
      const byId = new Map(candidates.map(c => [c.e.id, c.e])), best = this.reachableSeats(candidates.map(c => c.e.id), from, except)[0];
      if (best?.reachable) return byId.get(best.fixture)!;
    }
    return candidates[0].e;
  }
  /** Free native seat slots of these fixtures, best first: a slot whose standing approach exists and is reachable on
   * foot from `from` (engine route read, at most 12 checked), then one with an approach, then the rest; nearest first
   * within each. A pure read: nothing is claimed or moved. */
  private reachableSeats(fixtures: string[], from: Point, except?: string): {fixture: string; slot: string; reachable: boolean}[] {
    const engine = this.host.engine as unknown as Engine;
    const slots = fixtures.flatMap(fixture => this.nativeSeats(fixture, except).map(s => ({fixture, ...s, d: dist(from.p, s.approach ?? s.p)})))
      .sort((a, b) => Number(!a.approach) - Number(!b.approach) || a.d - b.d || a.id.localeCompare(b.id));
    let checked = 0;
    const ranked = slots.map(s => {
      const reachable = !!s.approach && checked++ < 12 && engine.reachV1(from, {p: s.approach, level: s.level}).ok;
      return {fixture: s.fixture, slot: s.id, reachable};
    });
    return [...ranked.filter(s => s.reachable), ...ranked.filter(s => !s.reachable)];
  }
  private checkTime(deadline: number) { if (performance.now() >= deadline) throw new Failure('verify.timeout', 'Verification reached its real-time deadline.'); }
  private async action(soul: EdgeSoul, fixture: string, slot: string, deadline: number, success: () => boolean, receipt: VerifyReceipt, started: number) {
    this.checkTime(deadline);
    const capability = `sit:${fixture}`;
    const stamp = (): Stamp => ({ms: round(performance.now() - started), tick: this.host.engine.world.tick});
    const timing: ActionTiming = {capability, slot, requested: stamp(), phases: []};
    (receipt.actions ??= []).push(timing);
    const listener: HostListener = {
      onDecision: (e, r) => {if (e.payload.soulId === soul.soulId && e.payload.option === capability && r.programOk) timing.programStarted ??= stamp();},
      afterTick: () => {
        const rec = [...this.host.engine.runtime.records.values()].find(r => r.verb === 'sit' && (r.params as {actor?: string}).actor === soul.entityId);
        if (rec?.phase && timing.phases.at(-1)?.phase !== rec.phase) {
          const b = this.host.engine.world.entities[soul.entityId];
          timing.phases.push({phase: rec.phase, at: stamp(), position: [round(b.pose.p[0]), round(b.pose.p[2])]});
          if (['turn', 'sit-down', 'occupied'].includes(rec.phase)) timing.arrived ??= stamp();
          if (rec.phase === 'occupied') timing.seated ??= stamp();
        }
      },
    };
    this.host.listeners.push(listener);
    try {
      // Wait on acceptance itself, rather than polling or spending idle ticks
      // after an immediate refusal. Paused sequencers remain deadline bounded.
      const pending = this.edge!.actVerificationSit(soul, fixture, slot);
      this.host.drainInputs();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([pending, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Failure('verify.timeout', 'Verification reached its real-time deadline.')), Math.max(1, deadline - performance.now()));
      })]).finally(() => clearTimeout(timer));
      if (!outcome?.accepted) throw new Failure('verify.refused', outcome?.reason ?? 'The edge action was refused.', outcome?.code);
      timing.accepted = stamp();
      for (;;) {
        this.checkTime(deadline);
        const receipt = this.edge!.receipt(soul.soulId, outcome.receipt.id)!;
        if (receipt.phase === 'failed' || receipt.phase === 'replaced') throw new Failure('verify.refused', receipt.reason ?? 'The engine action failed.', receipt.code ?? receipt.phase);
        if (success()) {timing.predicateTrue = stamp(); return;}
        if (receipt.phase === 'completed') {
          throw new Failure('verify.refused', 'Sit finished without engine sit activity, the probe as occupant, and slot distance ≤0.6 m.', 'seat.unconfirmed');
        }
        await this.wait(deadline);
      }
    } finally {const i = this.host.listeners.indexOf(listener); if (i >= 0) this.host.listeners.splice(i, 1);}
  }
  private wait(deadline: number) {
    return new Promise<void>(resolve => {
      const done = () => {clearTimeout(timer); const i = this.host.listeners.indexOf(listener); if (i >= 0) this.host.listeners.splice(i, 1); resolve();};
      const listener = {afterTick: done}, timer = setTimeout(done, Math.max(1, deadline - performance.now()));
      this.host.listeners.push(listener);
    });
  }
}
