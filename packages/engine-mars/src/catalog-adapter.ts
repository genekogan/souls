// CATALOG adapter (spec eden4/31 B3, lane L9): the Mars engine's `AssetDef` derived from an entity-world def's
// components and slots, so god-placed chairs are sittable, tables carry items and bowls are carryable — with the
// same entity ids in the engine as in the entity world. Pure data in, pure data out: the server derives the asset
// once per (def, params), the `world-edit` event carries it, and the engine registers it into CATALOG on fold, so
// replay never needs the compiler.
//
// Frames. The entity world uses the three.js convention (yaw about +Y: x' = x cos + z sin, z' = −x sin + z cos);
// the Mars engine rotates the other way (x' = x cos − z sin). A pose with entity yaw θ is Mars yaw −θ, and local
// (x, z) offsets map unchanged. A seat's occupant faces the def's front (+z local), turned by the slot's own yaw.
import { CATALOG, fireRingRadius, type AssetDef, type SlotDef } from '../../../mars/viewer/engine/world/catalog.ts';
import type { SurfaceSlotDef } from '../../../mars/viewer/engine/world/catalog-items.ts';
import { createHash } from 'node:crypto';
/** Soul Actions 34: a handle-held item (a watering can) is carried with the arm down at the side, clear of the leg. */
export const HANG_CARRY = { fwd: 0.05, side: 0.3, up: 0.8, reachSeconds: 0.8 };

/** What the adapter reads of a resolved def (a subset of world-compiler's StoredDef + the baked box/slots). */
export type DefFacts = {
  ref: string;
  hash: string;
  name: string;
  description?: string;
  tags: string[];
  layer: 'solid' | 'surface' | 'volume' | 'decor';
  // L1: presentation components may be lists (lights); fixture detection only reads their presence.
  components: Record<string, unknown>;
  /** Baked slots in the def frame: p [x, y, z], yaw (entity convention). */
  slots: { id: string; kind: string; p: [number, number, number]; yaw: number; height?: number; capacity?: number }[];
  /** Baked local box at the entity's scale (x width, y height, z depth). */
  box: [number, number, number];
  palette?: Record<string, string>;
};

/** Components that make a def an engine fixture or item (everything else becomes plain solids/floors/links). */
export const FIXTURE_COMPONENTS = ['seat', 'bed', 'surface', 'container', 'carryable', 'readable', 'workstation', 'instrument', 'boardGame', 'display'] as const;
// Soul Actions 34: a def with a `hang` slot (a can hook) is a fixture things hang on
export const isFixtureDef = (d: Pick<DefFacts, 'components'> & Partial<Pick<DefFacts, 'tags' | 'name' | 'ref' | 'slots'>>) => FIXTURE_COMPONENTS.some((k) => !!d.components[k]) || isFireCircleDef(d) || !!d.slots?.some((s) => s.kind === 'hang');
/** A small one-hand item the engine's items verbs (take_item / put_item) can carry. */
export const isCarryableDef = (d: Pick<DefFacts, 'components'>) => !!d.components.carryable;
/** PC03 (#682): an adapted loose material (an item whose handling is the native crew carry's, not a small one-hand item). */
export const isLooseCarryAsset = (a: Pick<AssetDef, 'category' | 'handling'> | undefined) => a?.category === 'item' && !!a.handling && !a.handling.small;

const SURFACE_PITCH = 0.3, SURFACE_MARGIN = 0.12;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const short = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 10);

/** Engine asset id for a def at given params/scale: stable, namespaced, ≤ 80 chars. */
export function assetIdFor(d: Pick<DefFacts, 'ref' | 'hash' | 'box'> & Partial<Pick<DefFacts, 'slots' | 'components'>>, paramsKey: string): string {
  // A policy change gets a new asset identity. Old logged assets/active slots keep their original approach semantics.
  const policy = (d.slots?.some((s) => s.kind === 'seat') ? '|seat-approach:reachable/1' : '') + (isFireCircleDef(d) ? '|fire-circle/1' : '') + (d.slots && crossSeated(d as Pick<DefFacts, 'slots' | 'box'>) ? '|seat-approach:slot' : '')
    + (d.slots && berthSlots(d as Pick<DefFacts, 'slots' | 'box'> & Partial<Pick<DefFacts, 'components'>>).length ? '|berth/1' : '');
  return `ew:${d.ref.replace(/[^a-z0-9/@._-]/gi, '').slice(0, 48)}:${short(`${d.hash}|${paramsKey}|${d.box.map(r4).join(',')}${policy}`)}`;
}

/** Surface-slot lattice over a top of size (w, d) at height y (pitch 0.3 m, ids `<slot>-r<i>c<j>`), centred on (cx, cz). */
export function surfaceLattice(slot: string, w: number, d: number, y: number, cx = 0, cz = 0): SurfaceSlotDef[] {
  const nx = Math.max(1, Math.floor((w - 2 * SURFACE_MARGIN) / SURFACE_PITCH) + 1), nz = Math.max(1, Math.floor((d - 2 * SURFACE_MARGIN) / SURFACE_PITCH) + 1);
  const out: SurfaceSlotDef[] = [];
  for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) out.push({ id: `${slot}-r${i}c${j}`, local: [r4(cx + (j - (nx - 1) / 2) * SURFACE_PITCH), r4(y), r4(cz + (i - (nz - 1) / 2) * SURFACE_PITCH)] });
  return out;
}

/** E-life: a def whose seats face across it (a see-saw's two ends face each other over the plank): the approach in front of
 *  a seat would be past the far end, behind whoever sits there (two on a see-saw faulted: bodies 0.46 m apart). Such a
 *  def's seats are approached from the seat itself (engine `seatApproach: 'slot'`: in front of it, else behind it). */
export function crossSeated(d: Pick<DefFacts, 'slots' | 'box'>): boolean {
  const hx = d.box[0] / 2, hz = d.box[2] / 2;
  return d.slots.some((s) => {
    if (s.kind !== 'seat') return false;
    const yaw = Math.PI / 2 - s.yaw, u = [Math.cos(yaw), Math.sin(yaw)], p = [s.p[0], s.p[2]], half = [hx, hz];
    let t = Infinity; for (const k of [0, 1]) if (Math.abs(u[k]) > 1e-9) t = Math.min(t, ((u[k] > 0 ? half[k] : -half[k]) - p[k]) / u[k]);
    return t > 1.0;
  });
}

/** B6: an open fire people gather round (a campfire, a bonfire, a fire pit): its asset gets fire-circle places, so the
 *  engine's campfire_circle (warm-by-fire) works on a god-built fire exactly as on the old worlds' native campfire. */
export const isFireCircleDef = (d: Partial<Pick<DefFacts, 'tags' | 'name' | 'ref'>>) => !!d.tags?.includes('fire') && (d.tags.includes('camp') || /campfire|bonfire|fire-?pit/i.test(`${d.name ?? ''} ${d.ref ?? ''}`));
/** Fire-circle places round a fire whose stone ring is `ring` m across: 8 on the engine's fire-ring radius, each facing the
 *  fire, leaving out any within 0.7 m of one of the def's own seats (a campfire's logs). Local frame, Mars yaw. */
export function fireCircleSlots(ring: number, seats: { p: [number, number, number] }[]): SlotDef[] {
  const R = fireRingRadius(ring, ring), out: SlotDef[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, x = r4(R * Math.cos(a)), z = r4(R * Math.sin(a));
    if (seats.some((s) => Math.hypot(s.p[0] - x, s.p[2] - z) < 0.7)) continue;
    out.push({ id: `ring${k}`, kind: 'fire-circle', local: [x, z], yaw: r4(a + Math.PI) });
  }
  return out;
}

/** beds/1: the smallest berth an adult lies on (along the body, m) and the mattress tops a body can get onto from its feet. */
export const BERTH_MIN_LENGTH = 1.8, BERTH_MIN_HEIGHT = 0.1, BERTH_MAX_HEIGHT = 1.0;
/** beds/1: the farthest a berth lies from a long side of its piece (m): a body gets on from beside the mattress. A bed
 *  inside a shell (a caravan's, a tent's: 1.2 m and 1.0 m in) would be got onto through the wall, so it is no berth. */
export const BERTH_MAX_EDGE = 0.6;
/** beds/1: a def's bed slots that an adult can lie on, as engine berths (local frame, Mars yaw: head → feet, like a seat's
 *  facing). A berth qualifies only when the def's box runs at least BERTH_MIN_LENGTH along it, its mattress top is
 *  BERTH_MIN_HEIGHT–BERTH_MAX_HEIGHT up and it lies within BERTH_MAX_EDGE of a long side; a crib, a pram, a bathtub,
 *  a bunk's upper berth or the bed inside a caravan stay unusable (and unoffered). */
export function berthSlots(d: Pick<DefFacts, 'slots' | 'box'> & Partial<Pick<DefFacts, 'components'>>): SlotDef[] {
  if (d.components?.carryable || d.components?.hover) return [];
  return d.slots.filter((s) => s.kind === 'bed').flatMap((s) => {
    const yaw = Math.PI / 2 - s.yaw, height = s.height ?? s.p[1];
    const length = Math.abs(Math.cos(yaw)) * d.box[0] + Math.abs(Math.sin(yaw)) * d.box[2];
    if (!(length >= BERTH_MIN_LENGTH - 1e-6) || !(height >= BERTH_MIN_HEIGHT && height <= BERTH_MAX_HEIGHT)) return [];
    // the across-axis offset of the berth from the nearer long side of the box (bed-l of a double bed: 0.375 m)
    const across = Math.abs(Math.sin(yaw)) * (d.box[0] / 2 - Math.abs(s.p[0])) + Math.abs(Math.cos(yaw)) * (d.box[2] / 2 - Math.abs(s.p[2]));
    if (!(across <= BERTH_MAX_EDGE + 1e-6)) return [];
    return [{ id: s.id, kind: 'berth' as const, local: [r4(s.p[0]), r4(s.p[2])] as [number, number], yaw: r4(yaw), height: r4(height), approachPolicy: 'reachable/1' as const }];
  });
}

/** A thing that floats or hovers (a canoe, a rowing boat): it lies in the water beside a jetty or a bank, so its box is
 *  no walking obstacle there (party F1: a moored canoe's box closed the jetty); it is boarded from its side. */
export const isFloatingDef = (d: Pick<DefFacts, 'components'>) => !!d.components.hover;

/** The engine AssetDef of an entity-world def (for an id from assetIdFor). `seen`: a decoration that is only perceived
 *  (a fountain, a lamp, a sign): a fixture Souls can see, look at and name, with no slots and no obstacle of its own
 *  (its walls and rims are the entity's solids, as before). */
export function assetFromDef(id: string, d: DefFacts, o: { seen?: boolean } = {}): AssetDef {
  const c = d.components as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [w, h, dd] = d.box;
  const label = (d.description?.replace(/\.$/, '') || d.name.replace(/^core-/, '')).slice(0, 80);
  const color = d.palette ? Object.values(d.palette)[0] : undefined;
  const upright=!!c.carryable&&d.tags.includes('upright-carry')&&(c.carryable.grips??1)>=2;
  const out: AssetDef = {
    id, label, category: c.carryable && !upright && !o.seen ? 'item' : 'fixture', size: [r4(w), r4(h), r4(dd)],
    massKg: typeof c.carryable?.mass === 'number' ? c.carryable.mass : Math.max(1, Math.round(w * h * dd * 40)),
    ...(color ? { color } : {}),
    dims: { confidence: 'hypothetical', note: `derived from entity-world def ${d.ref} (${d.hash.slice(0, 12)}) by the L9 catalog adapter` },
  };
  if (o.seen) return out;
  // PC12 (#691): a def's typed connectors are the asset's sockets (same frame: x along it, y up from its base, z across),
  // so the engine's connections on its instances name real sockets. Library kinds are data; the native rack rules read
  // only their own kinds, and only for their own categories.
  if (Array.isArray(c.connectors)) out.sockets = (c.connectors as { id: string; kind: string; at: [number, number, number] }[]).map((x) => ({ id: x.id, kind: x.kind as NonNullable<AssetDef['sockets']>[number]['kind'], local: [r4(x.at[0]), r4(x.at[1]), r4(x.at[2])] as [number, number, number] }));
  if (upright) {
    const crew=Math.ceil(c.carryable.grips/2),span=Math.min(.6,w*.8);
    out.obstacle=true;
    out.capabilities={fixtureCarry:{upright:true,handling:{carryCrew:[crew,crew],carryPose:'edge',carryHeight:.95,hands:2,grips:{[crew]:Array.from({length:crew},(_,i)=>({id:`grip-${i}`,local:[crew===1?0:(i===0?-w*.25:w*.25),h*.5,i%2===0?dd/2:-dd/2] as [number,number,number],span:[span,0,0] as [number,number,number]}))}}}};
  } else if (c.carryable?.handling) {
    // PC03 (#682): a loose material carries the native material's handling as data (crew range, grips for each crew
    // size, pose, hand height), so the native crew `carry` moves it exactly as it moves the engine's own beam or sheet
    const h = c.carryable.handling as { crew: [number, number]; pose: 'edge' | 'flat'; height: number; grips: Record<string, [number, number, number][]> };
    out.handling = { carryCrew: [h.crew[0], h.crew[1]], carryPose: h.pose, carryHeight: h.height,
      grips: Object.fromEntries(Object.entries(h.grips).map(([n, gs]) => [Number(n), gs.map((local, i) => ({ id: gs.length === 1 ? 'mid' : `g${i}`, local: [r4(local[0]), r4(local[1]), r4(local[2])] as [number, number, number] }))])) };
  } else if (c.carryable) {
    // one hand, palm under the base (catalog-items.ts hand1): the engine's take_item / put_item / serve verbs
    out.handling = { carryCrew: [1, 1], carryPose: 'flat', grips: { 1: [{ id: 'hand', local: [0, 0, 0] }] }, carryHeight: 0.95, hands: 1, small: true };
    // Soul Actions 34: a def with a `carry` slot (a watering can's handle) is held there and hangs from the hand at the side
    const handle = d.slots.find((s) => s.kind === 'carry');
    if (handle) out.handling = { ...out.handling, grips: { 1: [{ id: 'handle', local: [r4(handle.p[0]), r4(handle.p[1]), r4(handle.p[2])] }] }, carryHeight: HANG_CARRY.up, hangCarry: HANG_CARRY };
  // B6: a fire's box spans its logs; its stone ring and logs are the entity's own solids, so the box is no obstacle
  // (people stand inside it, round the fire)
  } else if (!isFloatingDef(d) && !isFireCircleDef(d)) out.obstacle = true;
  const seats: SlotDef[] = d.slots.filter((s) => s.kind === 'seat').map((s) => ({ id: s.id, kind: 'seat' as const, local: [r4(s.p[0]), r4(s.p[2])], yaw: r4(Math.PI / 2 - s.yaw), approachPolicy: 'reachable/1', ...(d.tags.includes('front-seat') ? {height:r4(s.height ?? s.p[1])} : {}) }));
  const stands: SlotDef[] = d.slots.filter((s) => s.kind === 'stand').map((s) => ({ id: s.id, kind: 'stand' as const, local: [r4(s.p[0]), r4(s.p[2])], yaw: r4(Math.PI / 2 - s.yaw) }));
  // B6: the stone ring is the def's description's size when it says so ("a ring of stones (1.6 m)"), else 1 m
  const ring = Number(/ring of stones \((\d+(?:\.\d+)?) m\)/.exec(d.description ?? '')?.[1] ?? 1);
  const fire = isFireCircleDef(d) ? fireCircleSlots(Math.min(ring, Math.min(w, dd)), d.slots.filter((s) => s.kind === 'seat')) : [];
  const berths = berthSlots(d);
  if (seats.length || stands.length || fire.length || berths.length) out.slots = [...seats, ...stands, ...fire, ...berths];
  if (seats.length && crossSeated(d)) out.seatApproach = 'slot';
  if (seats.length && d.tags.includes('front-seat')) out.seatApproach = 'front-arc';
  // Soul Actions entry 42: a hand-operated container's shelf slots are places inside it, one thing each at the slot itself
  const inside = (c.container as { inside?: { lip: number; face: number; stand: [number, number]; fit: [number, number, number] } } | undefined)?.inside && d.tags.includes('hand-operated') ? (c.container as { inside: { lip: number; face: number; stand: [number, number]; fit: [number, number, number] } }).inside : undefined;
  const tops = d.slots.filter((s) => s.kind === 'surface' || (s.kind === 'shelf' && !inside));
  // Soul Actions 34: a hook's `hang` slots are single places, exactly where the def puts them (a can's base when it hangs)
  const hangs: SurfaceSlotDef[] = d.slots.filter((s) => s.kind === 'hang').map((s) => ({ id: s.id, local: [r4(s.p[0]), r4(s.p[1]), r4(s.p[2])], hang: true }));
  if (tops.length) out.surfaceSlots = tops.flatMap((s) => surfaceLattice(s.id, tops.length === 1 ? w : Math.min(w, 1.2), tops.length === 1 ? dd : Math.min(dd, 0.8), s.height ?? s.p[1] ?? c.surface?.height ?? h, tops.length === 1 ? 0 : s.p[0], tops.length === 1 ? 0 : s.p[2]));
  else if (c.surface) out.surfaceSlots = surfaceLattice('top', w, dd, c.surface.height ?? h);
  if (hangs.length) out.surfaceSlots = [...(out.surfaceSlots ?? []), ...hangs];
  const stored = inside ? d.slots.filter((s) => s.kind === 'shelf') : [];
  if (stored.length) out.surfaceSlots = [...(out.surfaceSlots ?? []), ...stored.map((s) => ({ id: s.id, local: [r4(s.p[0]), r4(s.p[1]), r4(s.p[2])] as [number, number, number], inside: { lip: r4(inside!.lip), face: r4(inside!.face), stand: [r4(inside!.stand[0]), r4(inside!.stand[1])] as [number, number], fit: inside!.fit.map(r4) as [number, number, number] } }))];
  const caps: NonNullable<AssetDef['capabilities']> = {};
  if (c.carryable && d.tags.includes('recorded-item')) caps.recordedItemPoseV1 = true;
  if (c.readable) caps.readable = { pages: Math.max(1, Math.round(c.readable.pages ?? 4)), maxSeatDistance: 0.65 };
  if (c.display) caps.display = { accepts: 'text', maxChars: 280 };
  if (c.boardGame?.game === 'chess') caps.boardGame = 'chess';
  if (Object.keys(caps).length) out.capabilities = {...out.capabilities,...caps};
  return out;
}

/** The surface-slot id of a lattice nearest a local point on a table (for items resting on it). */
export function nearestSurfaceSlot(a: AssetDef, local: [number, number, number]): string | null {
  let best: string | null = null, bd = Infinity;
  for (const s of a.surfaceSlots ?? []) { const dd = (s.local[0] - local[0]) ** 2 + (s.local[2] - local[2]) ** 2; if (dd < bd - 1e-12) { bd = dd; best = s.id; } }
  return best;
}

/** Make derived assets known to the engine (idempotent; an id never changes meaning: same def hash + params). */
export function registerAssets(assets: Record<string, unknown> | undefined): number {
  let n = 0;
  for (const id of Object.keys(assets ?? {}).sort()) if (!CATALOG[id]) { CATALOG[id] = structuredClone(assets![id]) as AssetDef; n++; }
  return n;
}
