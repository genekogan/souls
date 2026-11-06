// Soul Actions entry 43: making tea. "fill the kettle", "put the kettle on", "pour the tea" and "make a cup of tea" are
// acts of ordinary native steps, like entry 34's watering can (watering.ts), whose handle-held fill/pour timeline the
// kettle reuses: take the kettle from the counter by its handle (take_item), hold it under a tap while the free hand turns
// the valve (watering_can_v1 fill), put it back (put_item); press the switch on its handle (hand_actuator_v1); take it,
// hold it over a cup with the free hand on the cup, tilt and pour (watering_can_v1 pour), put it back.
// The world changes at the motion's own moments, read only for bodies given a tea act (no per-tick scan of the world):
// the tap at the valve contacts, the kettle's water at the second contact, `heatTick` at the switch contact, the cup's
// tea in thirds while the stream runs, the kettle's level when the pour ends. The heat itself is never committed: it is
// kettleHeat(state, tick), a pure function of world time.
import { opSchema, cupSteam, kettleHeat, spoutRun, KETTLE_CLOCK, containerInside, containerOpen, isFoodDef, isKettleDef, isTeaCupDef, CUP_LITRES, CUP_RIM, KETTLE_GRIP, KETTLE_LITRES, KETTLE_OPENING, KETTLE_SPOUT, KETTLE_SPOUT_ANGLE, KETTLE_SWITCH, type Op, type StoredDef, type WorldModel } from '@sim/world-compiler';
import { canPoint, wateringEvents, type WateringMotion } from '../../../../mars/viewer/engine/items/watering.ts';
import { cupEvents, MUG, type CupMotion } from '../../../../mars/viewer/engine/items/cup.ts';
import { surfaceSlotsOf } from '../../../../mars/viewer/engine/items/model.ts';
import { handActuatorFrame, HAND_REACH_SECONDS, HAND_RELEASE_SECONDS, HAND_IDLE_HANDOFF_SECONDS, type HandActuatorMotion } from '../../../../mars/viewer/engine/social/hand-actuator.ts';
import { HUMAN_RADIUS } from '../../../../mars/viewer/engine/world/catalog.ts';
import { isTapDef, streamRun } from './watering.ts';
import { litresOf } from './water.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number]; type Vec3 = [number, number, number];
type Step = { verb: string; params: Record<string, unknown> };
type Refusal = { code: string; reason: string };
export type TeaPlan = { steps: Step[]; summary: string };
/** #435: where a kept mug will rest on a counter: the pour is planned from here before it has been taken out. */
type CounterPlace = { owner: string; slot: string; at: Vec3 };
export const TEA_ACTIONS = new Set(['fill', 'boil', 'pour', 'brew', 'drink', 'sip', 'wash', 'eat', 'bite']);
/** Entry 44: a full cup is drunk in this many sips; a table this near (m) is where she stands to drink. */
export const SIPS_PER_CUP = 5, SIP_TEA = 1 / SIPS_PER_CUP;
const TABLE_NEAR = 8, SPOT_CLEAR = 0.7;
/** How far (m) a kettle may be from the cup it pours into, and a tap from the kettle. */
const NEAR_CUP = 2.5, TAP_REACH = 20, GRACE_TICKS = 1200;
/** Seconds the tap runs into the kettle; seconds of stream for one cup. */
export const KETTLE_FILL_SECONDS = 3.0, CUP_POUR_SECONDS = 2.6;
/** The body stands this far from the counter's edge (m): a body radius and a little more. */
const EDGE_GAP = HUMAN_RADIUS + 0.04;
/** The kettle's tilt while pouring: 46°, rising 4° as the cup fills; the stream leaves the spout at this speed (m/s). The
 *  viewer's spout stream (fx/water-jets.ts `spout`) uses the same speed, so the planned and drawn landing agree. */
export const KETTLE_TILT = 46 * Math.PI / 180, KETTLE_TILT_MORE = 4 * Math.PI / 180, KETTLE_FLOW_FROM = 39 * Math.PI / 180;
/** Pour: the tea's surface is this far under the spout tip (m); the kettle hand is this far right of the body axis. */
const SPOUT_DROP = 0.07, POUR_HAND_RIGHT = 0.17;
/** The kettle's opening sits this far under the tap's nozzle while it fills (m). */
const CATCH_BELOW = 0.05;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const shapesOf = (def: StoredDef) => (def.make.kind === 'gen' ? (def.make.args as { shapes?: { tint?: string; at?: number[] }[] })?.shapes ?? [] : []);
/** Seconds from a switch press's start to the end of its release (the hand actuator's own timeline, no opening). */
const SWITCH_DONE = HAND_REACH_SECONDS + HAND_RELEASE_SECONDS + HAND_IDLE_HANDOFF_SECONDS;

export type TeaHost = {
  model: WorldModel;
  version(): number;
  engine: { world: { entities: Record<string, any>; tick: number }; dt?: number; clearanceAtV1?(x: number, z: number, level?: number): number };
  commit(ops: Op[], note: string): { accepted: boolean };
  log(m: string): void;
  /** #435: why this Soul may not take this thing or reach into this container (private, for sale), if so. */
  denied?(id: string, soul: never): Refusal | null;
};

export function createTea(h: TeaHost) {
  const M = () => h.model, ents = () => h.engine.world.entities, dt = () => h.engine.dt ?? 0.05;
  const pose = (id: string) => { const e = M().entities.get(id); return e ? M().worldPose(e) : null; };
  const defOf = (id: string) => { const e = M().entities.get(id); return e ? M().resolvedDef(e.def) : undefined; };
  const stateOf = (id: string) => { const e = M().entities.get(id), d = defOf(id); const out: Record<string, unknown> = {}; for (const [k, f] of Object.entries((d?.state ?? {}) as Record<string, { default?: unknown }>)) out[k] = f.default; return { ...out, ...(e?.state ?? {}) }; };
  const toWorld = (wp: { x: number; y: number; z: number; yaw: number; s: number }, l: Vec3): Vec3 => { const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw); return [wp.x + (l[0] * c + l[2] * s) * wp.s, wp.y + l[1] * wp.s, wp.z + (-l[0] * s + l[2] * c) * wp.s]; };
  const heading = (wp: { yaw: number }, d: Vec2) => { const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw); return Math.atan2(-d[0] * s + d[1] * c, d[0] * c + d[1] * s); };
  const clear = (p: Vec3) => (h.engine.clearanceAtV1 ? h.engine.clearanceAtV1(p[0], p[2], 0) : Infinity) >= HUMAN_RADIUS + 0.02;
  const heat = (id: string) => kettleHeat(stateOf(id), h.engine.world.tick, dt());
  // the few things tea uses, found once per world version (never a scan per offer)
  let index: { v: number; kettles: string[]; cups: string[]; foods: string[]; taps: string[]; tables: string[] } | null = null;
  const things = () => {
    const v = h.version(); if (index?.v === v) return index;
    const out = { v, kettles: [] as string[], cups: [] as string[], foods: [] as string[], taps: [] as string[], tables: [] as string[] };
    for (const e of M().entities.values()) { const d = M().resolvedDef(e.def); if (!d) continue; if (isKettleDef(d as never)) out.kettles.push(e.id); else if (isTeaCupDef(d as never)) out.cups.push(e.id); else if (isFoodDef(d as never)) out.foods.push(e.id); else if (isTapDef(d)) out.taps.push(e.id); else if (d.tags?.includes('table') && d.slots?.some((x) => x.kind === 'surface')) out.tables.push(e.id); }
    return (index = out);
  };

  /** A counter-top thing: the counter, its side facing the Soul, and the standing point in front of `at` there with `at`
   *  `right` m to the body's right. `face` is the engine heading into the counter. */
  function station(itemId: string, me: Vec2, right: number, place?: CounterPlace) {
    const s = place ? { kind: 'resting-on', on: place.owner, slot: place.slot } : ents()[itemId]?.support; if (s?.kind !== 'resting-on') return null;
    const owner = M().entities.get(s.on), odef = owner && M().resolvedDef(owner.def); if (!owner || !odef) return null;
    const wp = M().worldPose(owner), it = place ? place.at : ents()[itemId].pose.p as Vec3, half = odef.size.box[2] / 2 * wp.s;
    const c = Math.cos(wp.yaw), sn = Math.sin(wp.yaw), lx = (it[0] - wp.x) * c - (it[2] - wp.z) * sn, lz = (it[0] - wp.x) * sn + (it[2] - wp.z) * c;
    const mz = (me[0] - wp.x) * sn + (me[1] - wp.z) * c, side = mz >= 0 ? 1 : -1;
    const face = heading(wp, [0, -side]), f: Vec2 = [Math.cos(face), Math.sin(face)], r: Vec2 = [-f[1], f[0]];
    // the nearest standing point to the edge that is clear (a counter's obstacle box may be a little larger than its top)
    let st: Vec3 = [0, 0, 0], gap = EDGE_GAP;
    for (const g of [EDGE_GAP, EDGE_GAP + 0.04, EDGE_GAP + 0.08, EDGE_GAP + 0.12]) {
      const edge = toWorld(wp, [lx / wp.s, 0, side * (half + g) / wp.s]); st = [edge[0] - r[0] * right, 0, edge[2] - r[1] * right]; gap = g;
      if (clear(st)) break;
    }
    return { owner: owner.id, slot: s.slot as string, st, face, f, r, gap, depth: half - side * lz, top: it[1] };
  }
  const walk = (st: Vec3, face: number): Step => ({ verb: 'mars:walk_to', params: { x: r3(st[0]), z: r3(st[2]), level: 0, face: r3(face) } });
  // entry 41's M04 finding: an idle gesture is let go before a hand reaches (let-go.ts), never faded over the reach
  const LET_GO: Step = { verb: 'mars:let_go_v1', params: {} };
  // entry 44: an act that starts with a walk lets an idle gesture go first, standing (a hand at the hair after giving a cup
  // dropped 0.10 m per 50 ms as the walk's own gesture fade took it in 0.4 s; the let-go takes 1.1 s)
  const letGoFirst = (steps: Step[]): Step[] => (steps[0]?.verb === 'mars:walk_to' ? [LET_GO, ...steps] : steps);

  /** Fill steps for a kettle on a counter: take it, fill it under the nearest tap, put it back where it was. */
  function fillSteps(kettle: string, me: Vec2): Step[] | Refusal {
    const m = M(), at = station(kettle, me, 0.16);
    if (!at) return { code: 'tea.kettle-not-down', reason: 'Put the kettle down on the counter first.' };
    const kp = ents()[kettle].pose.p as Vec3; let tap: string | null = null, best = TAP_REACH;
    for (const t of things().taps) { const q = pose(t); if (!q) continue; const d = Math.hypot(q.x - kp[0], q.z - kp[2]); if (d < best) { best = d; tap = t; } }
    if (!tap) return { code: 'tea.no-tap', reason: `There is no tap within ${TAP_REACH} m of the kettle to fill it at.` };
    const tdef = defOf(tap)!, twp = pose(tap)!, sh = shapesOf(tdef), valve = sh.find((s) => s.tint === 'valve')!.at!, nozzle = sh.find((s) => s.tint === 'nozzle')!.at!;
    if (!clear(at.st)) return { code: 'tea.counter-blocked', reason: `There is no room to stand at the counter in front of the kettle (${(h.engine.clearanceAtV1?.(at.st[0], at.st[2], 0) ?? 0).toFixed(2)} m clear).` };
    // entry 34's fill geometry with the kettle's points: the lid opening under the nozzle, the body beside the basin
    const openTop = nozzle[1] - CATCH_BELOW, landZ = nozzle[2] + streamRun(CATCH_BELOW), half = tdef.size.box[0] / 2;
    const grip: Vec3 = [nozzle[0] - (KETTLE_OPENING[0] - KETTLE_GRIP[0]), openTop - (KETTLE_OPENING[1] + 0.008) + KETTLE_GRIP[1], landZ];
    let stand = toWorld(twp, [-(half + HUMAN_RADIUS + 0.01), 0, landZ - 0.155]);
    for (const e of [0.04, 0.08]) if (!clear(stand)) stand = toWorld(twp, [-(half + HUMAN_RADIUS + e), 0, landZ - 0.155]);
    if (!clear(stand)) return { code: 'tea.tap-blocked', reason: `There is no room to stand beside ${m.pathOf(tap)} to fill the kettle (${(h.engine.clearanceAtV1?.(stand[0], stand[2], 0) ?? 0).toFixed(2)} m clear at ${stand.map(r3)}).` };
    const face = heading(twp, [1, 0]), kdef = defOf(kettle)!, have = num(stateOf(kettle).level);
    const litres = litresOf(kdef, (m.entities.get(kettle)?.params ?? {}) as Record<string, unknown>) || KETTLE_LITRES;
    return [walk(at.st, at.face), LET_GO, { verb: 'mars:take_item', params: { item: kettle, hand: 'right' } },
      { verb: 'mars:walk_to', params: { x: r3(stand[0]), z: r3(stand[2]), level: 0, face: r3(face) } },
      { verb: 'mars:watering_can_v1', params: { item: kettle, target: tap, stage: 'fill', face: r3(face), hold: toWorld(twp, grip).map(r3), valve: toWorld(twp, [valve[0], valve[1] + 0.02, valve[2]]).map(r3), seconds: KETTLE_FILL_SECONDS, levelAfter: 1, litres: r3((1 - have) * litres) } },
      walk(at.st, at.face), { verb: 'mars:put_item', params: { item: kettle, surfaceSlot: `${at.owner}#${at.slot}` } }];
  }
  /** The switch press: stand in front of the kettle (its handle to the right) and press the switch with the right hand. */
  function boilSteps(kettle: string, me: Vec2, walkFirst = true): Step[] | Refusal {
    const at = station(kettle, me, 0.16);
    if (!at) return { code: 'tea.kettle-not-down', reason: 'Put the kettle down on the counter before switching it on.' };
    if (walkFirst && !clear(at.st)) return { code: 'tea.counter-blocked', reason: 'There is no room to stand at the counter in front of the kettle.' };
    const k = ents()[kettle], q = k.pose.p as Vec3, yaw = k.pose.yaw as number, c = Math.cos(yaw), s = Math.sin(yaw);
    // engine frame: item-local x along (cos yaw, sin yaw), z along (−sin yaw, cos yaw)
    const sw: Vec3 = [q[0] + KETTLE_SWITCH[0] * c - KETTLE_SWITCH[2] * s, q[1] + KETTLE_SWITCH[1] + 0.008, q[2] + KETTLE_SWITCH[0] * s + KETTLE_SWITCH[2] * c];
    return [...(walkFirst ? [walk(at.st, at.face)] : []), LET_GO, { verb: 'mars:hand_actuator_v1', params: { target: kettle, at: sw.map(r3) } }];
  }
  /** The pour into `cup`: take the kettle, stand at the counter in front of the cup, pour, put the kettle back. */
  function pourSteps(kettle: string, cup: string, me: Vec2, levelNow: number, place?: CounterPlace): Step[] | Refusal {
    const kAt = station(kettle, me, 0.16), held = ents()[kettle]?.support?.kind === 'in-hand';
    if (!kAt && !held) return { code: 'tea.kettle-not-down', reason: 'The kettle is not on the counter.' };
    const cAt = station(cup, me, -0.05, place);
    if (!cAt) return { code: 'tea.cup-not-down', reason: 'Put the cup down on the counter first; then pour the tea into it.' };
    if (!clear(cAt.st)) return { code: 'tea.counter-blocked', reason: 'There is no room to stand at the counter in front of the cup.' };
    const C = place ? place.at : ents()[cup].pose.p as Vec3, f = cAt.f, r = cAt.r;
    // where the spout tip is, from the grip, at the middle of the stream's tilt; the stream's run from there to the tea
    const T = KETTLE_TILT + KETTLE_TILT_MORE / 2, tip = canPoint([0, 0, 0], KETTLE_GRIP, 0, T, KETTLE_SPOUT);
    // the tip stands SPOUT_DROP over a full cup; the full stream is aimed at the tea half way up (it rises as she pours)
    const surface = C[1] + CUP_RIM.full, mid = C[1] + 0.014 + (CUP_RIM.full - 0.014) / 2, el = KETTLE_SPOUT_ANGLE - T, L = tip[0] + spoutRun(el, surface + SPOUT_DROP - mid);
    // the cup in the body frame (forward, right), the kettle hand at POUR_HAND_RIGHT; the kettle turns toward the cup
    const S = cAt.st, cf = (C[0] - S[0]) * f[0] + (C[2] - S[2]) * f[1], cr = (C[0] - S[0]) * r[0] + (C[2] - S[2]) * r[1];
    const lat = cr - POUR_HAND_RIGHT; if (Math.abs(lat) >= L) return { code: 'tea.cup-unreachable', reason: 'The cup is too far along the counter to pour into from here.' };
    const gf = cf - Math.sqrt(L * L - lat * lat), turn = Math.atan2(lat, cf - gf);
    const grip: Vec3 = [S[0] + f[0] * gf + r[0] * POUR_HAND_RIGHT, surface + SPOUT_DROP - tip[1], S[2] + f[1] * gf + r[1] * POUR_HAND_RIGHT];
    // the free (left) hand on the cup's near-left side, half way up
    const toHand: Vec2 = [-f[0] * 0.55 - r[0] * 0.835, -f[1] * 0.55 - r[1] * 0.835];
    const steady: Vec3 = [C[0] + toHand[0] * 0.056, C[1] + 0.055, C[2] + toHand[1] * 0.056];
    const kdef = defOf(kettle)!, litres = litresOf(kdef, (M().entities.get(kettle)?.params ?? {}) as Record<string, unknown>) || KETTLE_LITRES;
    const after = Math.max(0, levelNow - CUP_LITRES / litres);
    const steps: Step[] = [];
    if (!held) steps.push(walk(kAt!.st, kAt!.face), LET_GO, { verb: 'mars:take_item', params: { item: kettle, hand: 'right' } });
    steps.push(walk(S, cAt.face), { verb: 'mars:watering_can_v1', params: { item: kettle, target: cup, stage: 'pour', face: r3(cAt.face), hold: grip.map(r3), steady: steady.map(r3), spoutYaw: r3(turn), tilt: r3(KETTLE_TILT), tiltMore: r3(KETTLE_TILT_MORE), flowFrom: r3(KETTLE_FLOW_FROM), flowFull: r3(KETTLE_TILT), seconds: CUP_POUR_SECONDS, levelAfter: r3(after), litres: CUP_LITRES } });
    if (kAt) steps.push(walk(kAt.st, kAt.face), { verb: 'mars:put_item', params: { item: kettle, surfaceSlot: `${kAt.owner}#${kAt.slot}` } });
    return steps;
  }
  const kettleNear = (cup: string) => {
    const c = ents()[cup]?.pose?.p as Vec3 | undefined; if (!c) return null; let best = NEAR_CUP, k: string | null = null;
    for (const id of things().kettles) { const p = ents()[id]?.pose?.p as Vec3 | undefined; if (!p) continue; const d = Math.hypot(p[0] - c[0], p[2] - c[2]); if (d < best) { best = d; k = id; } }
    return k;
  };
  /** #435: the container a thing is kept in (one of its inside places), or null: a mug in a pantry is not a counter cup. */
  const keptIn = (id: string) => { const s = ents()[id]?.support; if (s?.kind !== 'resting-on') return null; const o = M().entities.get(s.on), d = o && M().resolvedDef(o.def), ins = d ? containerInside(d) : null; return ins?.slots.some((x) => x.id === s.slot) ? o!.id : null; };
  const cupNear = (kettle: string) => {
    const k = ents()[kettle]?.pose?.p as Vec3 | undefined; if (!k) return null; let best = NEAR_CUP, c: string | null = null;
    for (const id of things().cups) { const e = ents()[id], p = e?.pose?.p as Vec3 | undefined; if (!p || e.support?.kind !== 'resting-on' || keptIn(id) || num(stateOf(id).tea) > 0.05 || stateOf(id).bag === false) continue; const d = Math.hypot(p[0] - k[0], p[2] - k[2]); if (d < best) { best = d; c = id; } }
    return c;
  };
  /** #435: a fresh mug kept in an open container near the kettle, which she can take out and stand on the counter. */
  const keptCupNear = (kettle: string, soul: { entityId: string }) => {
    const k = ents()[kettle]?.pose?.p as Vec3 | undefined; if (!k) return null; let best = TABLE_NEAR, c: string | null = null;
    for (const id of things().cups) { const box = keptIn(id), p = ents()[id]?.pose?.p as Vec3 | undefined; if (!box || !p || !containerOpen(defOf(box)!, stateOf(box)) || h.denied?.(box, soul as never) || h.denied?.(id, soul as never) || num(stateOf(id).tea) > 0.05 || stateOf(id).bag === false) continue; const d = Math.hypot(p[0] - k[0], p[2] - k[2]); if (d < best) { best = d; c = id; } }
    return c;
  };
  const kettleWithin = (cup: string, range: number) => {
    const c = ents()[cup]?.pose?.p as Vec3 | undefined; if (!c) return null; let best = range, k: string | null = null;
    for (const id of things().kettles) { const p = ents()[id]?.pose?.p as Vec3 | undefined; if (!p) continue; const d = Math.hypot(p[0] - c[0], p[2] - c[2]); if (d < best) { best = d; k = id; } }
    return k;
  };
  /** #435: the free places on a table's top (not its hooks or an inside place). */
  const freeSlots = (owner: string) => {
    const taken = new Set(Object.values(ents()).filter((o: any) => o.support?.kind === 'resting-on' && o.support.on === owner).map((o: any) => o.support.slot));
    return surfaceSlotsOf(h.engine.world as never, owner).filter((x) => !x.inside && !x.hang && !taken.has(x.slot));
  };
  /** #435 (Gene's rule): what is in her hand is set down first rather than refused: on the nearest free table place, else
   *  at her feet. */
  function setDownSteps(item: string, me: Vec2): Step[] {
    let best: { place: CounterPlace; d: number } | null = null;
    for (const t of things().tables) for (const x of freeSlots(t)) { const d = Math.hypot(x.p[0] - me[0], x.p[2] - me[1]); if (d <= TABLE_NEAR && (!best || d < best.d)) best = { place: { owner: t, slot: x.slot, at: x.p }, d }; }
    const at = best ? station(item, me, -0.05, best.place) : null;
    if (best && at && clear(at.st)) return [LET_GO, walk(at.st, at.face), { verb: 'mars:put_item', params: { item, surfaceSlot: `${best.place.owner}#${best.place.slot}` } }];
    return [LET_GO, { verb: 'mars:put_item', params: { item, surfaceSlot: 'ground' } }];
  }
  /** #435: the free place on the kettle's counter, nearest the kettle, that a pour can reach, with that pour. */
  function counterPlace(kettle: string, cup: string, me: Vec2, level: number): { place: CounterPlace; pour: Step[] } | null {
    const s = ents()[kettle]?.support, k = ents()[kettle]?.pose?.p as Vec3 | undefined; if (s?.kind !== 'resting-on' || !k) return null;
    const free = freeSlots(s.on).map((x) => ({ x, d: Math.hypot(x.p[0] - k[0], x.p[2] - k[2]) })).filter((o) => o.d < NEAR_CUP).sort((a, b) => a.d - b.d);
    for (const { x } of free) { const place: CounterPlace = { owner: s.on, slot: x.slot, at: x.p }, pour = pourSteps(kettle, cup, me, level, place); if (!('code' in pour)) return { place, pour }; }
    return null;
  }
  /** #435: a kept thing or one lying somewhere, taken in a hand; the item action plans its own station. */
  const takeSteps = (item: string, hand: 'left' | 'right' = 'right'): Step[] => [LET_GO, { verb: 'mars:take_item', params: { item, hand } }];
  /** Why this Soul cannot take this thing by hand, if so: it stays a refusal only when the act truly can't happen. */
  function cannotTake(soul: { entityId: string }, item: string): Refusal | null {
    const s = ents()[item]?.support, m = M();
    if (s?.kind === 'in-hand' && s.by !== soul.entityId) return { code: 'food.in-use', reason: `${m.pathOf(item)} is in someone else's hand.` };
    const box = keptIn(item);
    if (box && !containerOpen(defOf(box)!, stateOf(box))) return { code: 'container.closed', reason: `${m.pathOf(box)} is closed; open it first (object:${box}:open).` };
    return (box ? h.denied?.(box, soul as never) : null) ?? h.denied?.(item, soul as never) ?? null;
  }

  // ---- entry 44: drinking at a table, washing up at the sink ----
  const heldBy = (cup: string, body: string) => { const s = ents()[cup]?.support; return s?.kind === 'in-hand' && s.by === body ? (s.hand as 'left' | 'right') : null; };
  const drinkers = new Map<string, Vec3>(), drinkSeen = new Set<string>();
  /** Where to stand at the nearest table (≤ TABLE_NEAR): of six edge points (two along each long side, one at each end),
   *  the nearest one that is clear and has nobody standing or about to stand within SPOT_CLEAR; facing into the table. */
  function tableSpot(body: string, me: Vec2): { st: Vec3; face: number; table: string } | null {
    let best: { st: Vec3; face: number; table: string; d: number } | null = null;
    const others = Object.values(ents()).filter((x: any) => x?.human && x.id !== body).map((x: any) => x.pose.p as Vec3);
    for (const [b, p] of drinkers) if (b !== body) others.push(p);
    for (const t of things().tables) {
      const wp = pose(t), d = defOf(t); if (!wp || !d || Math.hypot(wp.x - me[0], wp.z - me[1]) > TABLE_NEAR) continue;
      const hx = d.size.box[0] / 2 * wp.s, hz = d.size.box[2] / 2 * wp.s, g = EDGE_GAP + 0.02;
      for (const [lx, lz] of [[-0.3, hz + g], [0.3, hz + g], [-0.3, -(hz + g)], [0.3, -(hz + g)], [hx + g, 0], [-(hx + g), 0]] as Vec2[]) {
        if (Math.abs(lx) > hx && Math.abs(lz) > 0) continue;
        const st = toWorld(wp, [lx / wp.s, 0, lz / wp.s]); if (!clear(st) || others.some((o) => Math.hypot(o[0] - st[0], o[2] - st[2]) < SPOT_CLEAR)) continue;
        const inward: Vec2 = Math.abs(lz) > 0 ? [0, -Math.sign(lz)] : [-Math.sign(lx), 0], face = heading(wp, inward), dd = Math.hypot(st[0] - me[0], st[2] - me[1]);
        if (!best || dd < best.d) best = { st, face, table: t, d: dd };
      }
    }
    return best;
  }
  function drinkPlan(body: string, cup: string, me: Vec2, one: boolean): TeaPlan | Refusal {
    const m = M(), name = m.pathOf(cup), hand = heldBy(cup, body), tea = num(stateOf(cup).tea);
    if (!hand) return { code: 'tea.not-holding', reason: `Pick up ${name} first; then drink the tea.` };
    if (tea <= 0.05) return { code: 'tea.cup-empty', reason: `${name} is empty.` };
    const sips = one ? 1 : Math.max(1, Math.round(tea / SIP_TEA)), sip = one ? Math.min(tea, SIP_TEA) : tea / sips;
    const spot = tableSpot(body, me), steps: Step[] = [];
    const yaw = ents()[body].pose.yaw as number;
    let face = yaw;
    if (spot) { drinkers.set(body, spot.st); face = spot.face; if (Math.hypot(spot.st[0] - me[0], spot.st[2] - me[1]) > 0.15) steps.push(walk(spot.st, spot.face)); }
    steps.push(LET_GO, { verb: 'mars:cup_v1', params: { item: cup, stage: 'drink', face: r3(face), sips, from: r3(tea), sip: Math.round(sip * 10000) / 10000 } });
    const left = Math.max(0, Math.round((tea - sips * sip) * 1000) / 1000);
    return { steps, summary: `${one ? 'Took a sip of' : 'Drank'} the tea in ${name}${spot ? ` at ${m.pathOf(spot.table)}` : ''} (${sips} sip${sips > 1 ? 's' : ''}); ${left > 0.05 ? `about ${Math.round(left * 10) / 10} of a cup is left` : 'the cup is empty'}.` };
  }
  /** The wash at the nearest tap: the mug's base under the spout (its rim a little under the nozzle, the stream landing in
   *  it), the body beside the sink as for a kettle, the palm on the mug's side to the body's right. */
  function washSteps(cup: string, tap: string, hand: 'left' | 'right'): { walk: Step; wash: Step } | Refusal {
    const tdef = defOf(tap)!, twp = pose(tap)!, sh = shapesOf(tdef), valve = sh.find((x) => x.tint === 'valve')?.at, nozzle = sh.find((x) => x.tint === 'nozzle')?.at;
    if (!valve || !nozzle) return { code: 'tea.no-tap', reason: `${M().pathOf(tap)} has no tap to rinse a cup under.` };
    const rimGap = 0.03, top = nozzle[1] - rimGap, land = nozzle[2] + streamRun(rimGap + MUG.h - MUG.floor), half = tdef.size.box[0] / 2, side = hand === 'right' ? 1 : -1;
    // engine frame facing the sink's +x: its +z is the body's right; the palm 0.19 m to that side, the mug's axis 0.058 inside it
    const bodyZ = land + side * (MUG.wrapOut - 0.19);
    let stand = toWorld(twp, [-(half + HUMAN_RADIUS + 0.01), 0, bodyZ]);
    for (const e of [0.04, 0.08]) if (!clear(stand)) stand = toWorld(twp, [-(half + HUMAN_RADIUS + e), 0, bodyZ]);
    if (!clear(stand)) return { code: 'tea.tap-blocked', reason: `There is no room to stand beside ${M().pathOf(tap)} to rinse the cup.` };
    const face = heading(twp, [1, 0]), hold = toWorld(twp, [nozzle[0], top - MUG.h, land]);
    return { walk: { verb: 'mars:walk_to', params: { x: r3(stand[0]), z: r3(stand[2]), level: 0, face: r3(face) } },
      wash: { verb: 'mars:cup_v1', params: { item: cup, stage: 'wash', face: r3(face), target: tap, hold: hold.map(r3), valve: toWorld(twp, [valve[0], valve[1] + 0.02, valve[2]]).map(r3) } } };
  }
  function washPlan(body: string, cup: string, me: Vec2): TeaPlan | Refusal {
    const m = M(), name = m.pathOf(cup), st = stateOf(cup), held = heldBy(cup, body);
    if (num(st.tea) > 0.05) return { code: 'tea.cup-not-empty', reason: `There is still tea in ${name}; drink it first.` };
    if (num(st.brewedTick, -1) < 0) return { code: 'tea.cup-clean', reason: `${name} is already clean.` };
    const other = Object.values(ents()).find((x: any) => x?.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === body && x.id !== cup);
    if (other) return { code: 'tea.hands-full', reason: `You are holding ${m.pathOf(other.id)}; put it down first.` };
    const cp = ents()[cup].pose.p as Vec3; let tap: string | null = null, best = TAP_REACH;
    for (const t of things().taps) { const q = pose(t); if (!q) continue; const d = Math.hypot(q.x - cp[0], q.z - cp[2]); if (d < best) { best = d; tap = t; } }
    if (!tap) return { code: 'tea.no-tap', reason: `There is no tap within ${TAP_REACH} m of ${name} to rinse it at.` };
    const steps: Step[] = [];
    // from where it stands (a table, a counter) and back there; a mug in hand goes to the nearest table afterwards
    const at = held ? null : station(cup, me, -0.05);
    if (!held && !at) return { code: 'tea.cup-not-down', reason: `${name} is not on a table or counter.` };
    if (at && !clear(at.st)) return { code: 'tea.counter-blocked', reason: `There is no room to stand in front of ${name}.` };
    const hand = held ?? 'right', w = washSteps(cup, tap, hand); if ('code' in w) return w;
    if (at) steps.push(walk(at.st, at.face), LET_GO, { verb: 'mars:take_item', params: { item: cup, hand: 'right' } });
    else steps.push(LET_GO);
    steps.push(w.walk, w.wash);
    let back: string;
    if (at) { steps.push(walk(at.st, at.face), { verb: 'mars:put_item', params: { item: cup, surfaceSlot: `${at.owner}#${at.slot}` } }); back = m.pathOf(at.owner); }
    else { const spot = tableSpot(body, me); if (spot) { steps.push(walk(spot.st, spot.face), { verb: 'mars:put_item', params: { item: cup, surfaceSlot: `${spot.table}#top` } }); back = m.pathOf(spot.table); } else back = 'your hand'; }
    return { steps, summary: `Rinsed ${name} at ${m.pathOf(tap)} and set it down clean on ${back}.` };
  }

  /** #435: bites of a food at the lips on the drink's own timeline; `left` falls at each bite's own moment. A food not in
   *  her hand is taken first, from wherever it is: only a food that cannot be taken stays a refusal. */
  function eatPlan(soul: { entityId: string }, food: string, one: boolean): TeaPlan | Refusal {
    const body = soul.entityId, name = M().pathOf(food), st = stateOf(food), left = num(st.left), hand = heldBy(food, body), b = ents()[body];
    if (left <= 0.05) return { code: 'food.eaten', reason: `There is nothing left of ${name} to eat.` };
    const steps: Step[] = [];
    let face = b.pose.yaw as number;
    if (!hand) {
      const no = cannotTake(soul, food); if (no) return no;
      // Gene's rule: what else is in her hand is set down first, rather than a refusal
      const other = Object.values(ents()).find((x: any) => x?.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === body && x.id !== food) as { id: string } | undefined;
      if (other) { const at = b.pose.p as Vec3; steps.push(...setDownSteps(other.id, [at[0], at[2]])); }
      // she faces it as she takes it, so the motion does not turn her back the way she came
      const it = ents()[food].pose.p as Vec3, me = b.pose.p as Vec3;
      if (Math.hypot(it[0] - me[0], it[2] - me[2]) > 0.3) face = Math.atan2(it[2] - me[2], it[0] - me[0]);
      steps.push(...takeSteps(food));
    } else steps.push(LET_GO);
    const all = Math.max(1, Math.min(8, Math.round(left * num(st.bites, 1)))), sips = one ? 1 : all, sip = Math.round(left / all * 10000) / 10000;
    const after = Math.max(0, Math.round((left - sips * sip) * 1000) / 1000);
    steps.push({ verb: 'mars:cup_v1', params: { item: food, stage: 'drink', face: r3(face), sips, from: r3(left), sip } });
    return { steps, summary: `${one ? 'Took a bite of' : 'Ate'} ${name} (${sips} bite${sips > 1 ? 's' : ''}); ${after > 0.05 ? `${all - sips} bite${all - sips > 1 ? 's are' : ' is'} left` : 'nothing is left of it to eat'}.` };
  }

  /** The act for a tea word on `id` (a kettle or a cup), a refusal, or null (not a tea thing: other paths answer). */
  function plan(soul: { entityId: string }, id: string, action: string): TeaPlan | Refusal | null {
    if (!TEA_ACTIONS.has(action)) return null;
    const m = M(), def = defOf(id); if (!def) return null;
    const body = ents()[soul.entityId]; if (!body?.human) return null;
    if (action === 'eat' || action === 'bite') {
      if (!isFoodDef(def as never)) return null;
      const r = eatPlan(soul, id, action === 'bite'); if ('code' in r) return r;
      planned.delete(soul.entityId); return r;
    }
    const me: Vec2 = [body.pose.p[0], body.pose.p[2]];
    if ((action === 'drink' || action === 'sip' || action === 'wash') && isTeaCupDef(def as never)) {
      const r = action === 'wash' ? washPlan(soul.entityId, id, me) : drinkPlan(soul.entityId, id, me, action === 'sip');
      if ('code' in r) return r;
      planned.delete(soul.entityId);
      return { ...r, steps: letGoFirst(r.steps) };
    }
    const busy = Object.values(ents()).find((x: any) => x?.tags?.includes('entity-world') && x.support?.kind === 'in-hand' && x.support.by === soul.entityId && !things().kettles.includes(x.id));
    if (busy) return { code: 'tea.hands-full', reason: `You are holding ${m.pathOf(busy.id)}; put it down first.` };
    // entry 44: a washed mug has no tea bag in it (said before where the kettle is)
    if (isTeaCupDef(def as never) && stateOf(id).bag === false) return { code: 'tea.no-bag', reason: `${m.pathOf(id)} has been washed and has no tea bag in it.` };
    const kettle = isKettleDef(def as never) ? id : isTeaCupDef(def as never) ? (keptIn(id) ? kettleWithin(id, TABLE_NEAR) : kettleNear(id)) : null;
    if (!kettle) return isTeaCupDef(def as never) ? { code: 'tea.no-kettle', reason: `There is no kettle within ${NEAR_CUP} m of ${m.pathOf(id)}.` } : null;
    const k = heat(kettle), level = num(stateOf(kettle).level), litres = litresOf(defOf(kettle)!, (m.entities.get(kettle)?.params ?? {}) as Record<string, unknown>) || KETTLE_LITRES, cupL = CUP_LITRES / litres;
    const kname = m.pathOf(kettle);
    const ok = (steps: Step[] | Refusal, summary: string): TeaPlan | Refusal => ('code' in steps ? steps : (planned.set(soul.entityId, kettle), { steps: letGoFirst(steps), summary }));
    if (action === 'fill') {
      if (level >= 0.98) return { code: 'tea.kettle-full', reason: `${kname} is already full.` };
      return ok(fillSteps(kettle, me), `Filled ${kname} at the tap and put it back on the counter.`);
    }
    if (action === 'boil') {
      if (k.phase === 'empty') return { code: 'tea.kettle-empty', reason: `${kname} is empty; fill it first.` };
      if (k.on) return { code: 'tea.kettle-on', reason: `${kname} is already on${k.phase === 'boiling' ? ' and boiling' : `; it boils in about ${Math.ceil(k.boilsIn)} s`}.` };
      if (k.phase === 'hot') return { code: 'tea.kettle-hot', reason: `${kname} has just boiled; the water is hot.` };
      return ok(boilSteps(kettle, me), `Switched ${kname} on; it boils in about ${KETTLE_CLOCK.heat} s.`);
    }
    // pour (a kettle) or brew (a cup): a cup on the counter, and boiled water (brew makes it so first)
    // #435: a fresh mug kept in an open pantry nearby is taken out and stood on the counter first
    const cup = isTeaCupDef(def as never) ? id : cupNear(kettle) ?? keptCupNear(kettle, soul);
    if (!cup) return { code: 'tea.no-cup', reason: `There is no empty cup on the counter by ${kname}.` };
    if (num(stateOf(cup).tea) > 0.05) return { code: 'tea.cup-full', reason: `${m.pathOf(cup)} already has tea in it.` };
    if (stateOf(cup).bag === false) return { code: 'tea.no-bag', reason: `${m.pathOf(cup)} has been washed and has no tea bag in it.` };
    const box = keptIn(cup);
    // a kettle already in her right hand: the kept mug comes out in her left
    const kettleHand = ents()[kettle]?.support?.kind === 'in-hand' ? 'left' : 'right';
    if (box) { const no = cannotTake(soul, cup); if (no) return no; }
    const fetched = box ? counterPlace(kettle, cup, me, num(stateOf(kettle).level)) : null;
    if (box && !fetched) return { code: 'surface.full', reason: `There is no free place by ${kname} to stand ${m.pathOf(cup)}.` };
    const fetch: Step[] = [];
    if (fetched) { const at = station(cup, me, -0.05, fetched.place)!; fetch.push(...takeSteps(cup, kettleHand), walk(at.st, at.face), { verb: 'mars:put_item', params: { item: cup, surfaceSlot: `${fetched.place.owner}#${fetched.place.slot}` } }); }
    const out = fetched ? `took ${m.pathOf(cup)} out of ${m.pathOf(box!)} and stood it on the counter` : '';
    if (action === 'pour') {
      if (k.phase === 'empty' || level < cupL * 0.9) return { code: 'tea.kettle-empty', reason: `${kname} has not enough water for a cup; fill it first.` };
      if (k.phase === 'cold') return { code: 'tea.kettle-cold', reason: `${kname} is cold; put it on first.` };
      if (k.phase === 'heating') return { code: 'tea.not-boiled', reason: `${kname} has not boiled yet; it boils in about ${Math.ceil(k.boilsIn)} s.` };
      const pour = fetched ? fetched.pour : pourSteps(kettle, cup, me, level);
      return ok('code' in pour ? pour : [...fetch, ...pour], `${out ? `Took ${m.pathOf(cup)} out of ${m.pathOf(box!)}, and poured` : 'Poured'} a cup of tea into ${m.pathOf(cup)} from ${kname}.`);
    }
    // brew: whatever is still needed, as one act
    const steps: Step[] = [...fetch]; const said: string[] = out ? [out] : [];
    let lv = level, pos = me;
    if (level < cupL * 0.9) { const f = fillSteps(kettle, me); if ('code' in f) return f; steps.push(...f); lv = 1; said.push('filled the kettle'); }
    if (k.phase !== 'boiling' && k.phase !== 'hot' || lv !== level) {
      const wait = k.phase === 'heating' && lv === level ? k.boilsIn + 1 : KETTLE_CLOCK.heat - (SWITCH_DONE - HAND_REACH_SECONDS) + 1;
      if (!(k.phase === 'heating' && lv === level)) { const b = boilSteps(kettle, pos, true); if ('code' in b) return b; steps.push(...b); said.push('put it on'); }
      steps.push({ verb: 'rest', params: { seconds: r3(Math.max(0.5, wait)) } }); said.push('waited for it to boil');
    }
    const p = pourSteps(kettle, cup, pos, lv, fetched?.place); if ('code' in p) return p; steps.push(...p); void pos;
    return ok(steps, `Made a cup of tea in ${m.pathOf(cup)}${said.length ? ` (${said.join(', ')})` : ''}.`);
  }

  /** Compact nearby facts (here.ts, ≤ 4 m): a kettle's phase, a cup holding tea. Never the stored state. */
  function facts(id: string): Record<string, unknown> | null {
    const def = defOf(id); if (!def) return null;
    if (isKettleDef(def as never)) return { kettle: heat(id).phase };
    // #435: a food in the hand or bitten says how many bites are left, then that it is eaten; a whole one put down says nothing
    if (isFoodDef(def as never)) { const st = stateOf(id), left = num(st.left);
      return left <= 0.05 ? { eaten: true } : left < 0.999 || ents()[id]?.support?.kind === 'in-hand' ? { bites: Math.max(1, Math.round(left * num(st.bites, 1))) } : null; }
    if (isTeaCupDef(def as never)) { const st = stateOf(id), tea = num(st.tea);
      // entry 44: how much tea (one decimal), drunk (empty, until washed), or washed (clean); a fresh mug says nothing
      return tea > 0.05 ? { tea: Math.max(0.1, Math.round(tea * 10) / 10) } : num(st.brewedTick, -1) >= 0 ? { empty: true } : st.bag === false ? { clean: true } : null; }
    return null;
  }

  // ---- the world changes at the motion's moments ----
  const watching = new Map<string, number>(), fired = new Map<string, Set<string>>(), planned = new Map<string, string>(), kettleOf = new Map<string, string>(), lastSupport = new Map<string, string>();
  let visits = 0;
  /** A body was given a tea act: watch its motions until they are done (with a minute's grace before them). */
  function expect(body: string) { watching.set(body, h.engine.world.tick + GRACE_TICKS); const k = planned.get(body); if (k) kettleOf.set(body, k); }
  function commit(ops: Op[], note: string) { if (!ops.length) return; const r = h.commit(ops, note); if (!r.accepted) h.log(`tea ${note}: the world refused ${JSON.stringify(ops)}`); }
  const set = (ops: Op[], id: string, state: Record<string, unknown>) => ops.push(opSchema.parse({ op: 'set', id, state }));
  function pourEvent(m: WateringMotion, actor: string, key: string, data: Record<string, unknown>) {
    const ops: Op[] = [], cupNow = num(stateOf(m.target).tea), tick = h.engine.world.tick;
    if (/^pour-[123]$/.test(key)) set(ops, m.target, { tea: Math.min(1, Math.round((cupNow + num(data.fraction)) * 1000) / 1000), ...(key === 'pour-1' ? { brewedTick: tick } : {}) });
    else if (key === 'pour-abort') set(ops, m.target, { tea: Math.min(1, Math.round((cupNow + num(data.fraction)) * 1000) / 1000), ...(cupNow <= 0.05 && num(data.fraction) > 0 ? { brewedTick: tick } : {}) });
    else if (key === 'pour-end') {
      const poured = num(data.poured, 1), litres = litresOf(defOf(m.item)!, (M().entities.get(m.item)?.params ?? {}) as Record<string, unknown>) || KETTLE_LITRES;
      // a whole pour leaves a whole cup (the thirds' rounding never shows as 0.999)
      if (poured >= 0.999) set(ops, m.target, { tea: 1 });
      set(ops, m.item, { level: typeof data.level === 'number' ? data.level : Math.max(0, Math.round((num(stateOf(m.item).level) - poured * CUP_LITRES / litres) * 1000) / 1000) });
    }
    commit(ops, `${actor} tea ${key} ${m.target}`);
  }
  /** Entry 44: a sip leaves the tea the drink's own timeline says (cupEvents: a pure function of the record); a rinse turns
   *  the tap on and off at the valve contacts and leaves the mug clean when its water has run out. */
  function cupEvent(m: CupMotion, actor: string, item: string, key: string, data: Record<string, unknown>) {
    const ops: Op[] = [];
    if (key.startsWith('sip-')) set(ops, item, things().foods.includes(item) ? { left: num(data.tea) } : { tea: num(data.tea) });
    else if (key === 'valve-on' && m.target) set(ops, m.target, { on: true });
    else if (key === 'valve-off' && m.target) set(ops, m.target, { on: false });
    else if (key === 'washed') set(ops, item, { tea: 0, brewedTick: -1, bag: false });
    commit(ops, `${actor} tea ${key} ${item}`);
  }
  function fillEvent(m: WateringMotion, actor: string, key: string, data: Record<string, unknown>) {
    const ops: Op[] = [];
    if (key === 'valve-on') set(ops, m.target, { on: true });
    else if (key === 'valve-off') { set(ops, m.target, { on: false }); set(ops, m.item, { level: num(data.level, 1), heatTick: -1 }); }
    commit(ops, `${actor} tea ${key} ${m.target}`);
  }
  /** Per tick, only for bodies given a tea act (usually none). Returns the kettles grasped or released this tick. */
  function tick(): string[] {
    if (!watching.size) return [];
    const moved: string[] = [], now = h.engine.world.tick, d = dt();
    for (const [body, k] of kettleOf) {
      const s = ents()[k]?.support, key = s ? `${s.kind}:${s.by ?? s.on ?? ''}:${s.slot ?? ''}` : '';
      if (lastSupport.has(k) && lastSupport.get(k) !== key) moved.push(k);
      lastSupport.set(k, key);
      if (!watching.has(body)) { kettleOf.delete(body); lastSupport.delete(k); }
    }
    for (const [body, until] of watching) {
      visits++;
      const b = ents()[body], hm = b?.human, wm = hm?.wateringV1 as WateringMotion | undefined, am = hm?.handActuator as HandActuatorMotion | undefined, cm = hm?.cupV1 as CupMotion | undefined;
      const mine = (item: string | undefined) => !!item && things().kettles.includes(item);
      const holding = !!hm && things().kettles.some((c) => ents()[c]?.support?.kind === 'in-hand' && ents()[c].support.by === body);
      const cupItem = cm && (things().cups.includes(cm.item) || things().foods.includes(cm.item)) ? cm.item : undefined;
      const active = (wm && mine(wm.item)) || (am && mine(am.target)) || holding || !!cupItem;
      // a drinker's place at the table is kept from the plan until its drink has ended
      if (cupItem) drinkSeen.add(body); else if (drinkSeen.delete(body)) drinkers.delete(body);
      if (active) watching.set(body, now + GRACE_TICKS);
      if (cm && cupItem) {
        const id = cm.actionId ?? `${body}:${cm.startTick}`, done = fired.get(id) ?? new Set<string>(); fired.set(id, done);
        const s = (now - cm.startTick) * d;
        for (const e of cupEvents(cm)) if (s >= e.at && !done.has(e.key)) { done.add(e.key); try { cupEvent(cm, body, cupItem, e.key, e.data); } catch (err) { h.log(`tea ${e.key}: ${(err as Error).message}`); } }
      } else if (wm && mine(wm.item)) {
        const id = wm.actionId ?? `${body}:${wm.startTick}`, done = fired.get(id) ?? new Set<string>(); fired.set(id, done);
        const s = (now - wm.startTick) * d;
        for (const e of wateringEvents(wm)) if (s >= e.at && !done.has(e.key)) { done.add(e.key); try { (wm.stage === 'fill' ? fillEvent : pourEvent)(wm, body, e.key, e.data); } catch (err) { h.log(`tea ${e.key}: ${(err as Error).message}`); } }
      } else if (am && mine(am.target)) {
        const id = am.actionId ?? `${body}:${am.startTick}`, done = fired.get(id) ?? new Set<string>(); fired.set(id, done);
        if (!done.has('switch') && handActuatorFrame(am, (now - am.startTick) * d).contact) {
          done.add('switch');
          // the heat starts at the contact itself: its tick is fixed by the press's own timeline
          const at = am.startTick + Math.ceil(HAND_REACH_SECONDS / d - 1e-9), k = kettleHeat(stateOf(am.target), now, d);
          if (k.phase === 'cold') { const ops: Op[] = []; set(ops, am.target, { heatTick: at }); commit(ops, `${body} tea switch-on ${am.target}`); }
          else h.log(`tea switch-on ${am.target}: ${k.phase}, not switched`);
        }
      } else if (!active && now > until) { watching.delete(body); drinkers.delete(body); }
      if (fired.size > 64) for (const x of [...fired.keys()].slice(0, 32)) fired.delete(x);
    }
    return moved;
  }
  return { plan, facts, expect, tick, watchingCount: () => watching.size, visits: () => visits, steam: (id: string) => cupSteam(stateOf(id), h.engine.world.tick, dt()) };
}
export type Tea = ReturnType<typeof createTea>;
