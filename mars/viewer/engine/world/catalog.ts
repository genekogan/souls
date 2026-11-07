import { DRAWING_ASSETS } from './catalog-drawing.ts';
import { GARDEN_ASSETS } from './catalog-garden.ts';
// Mars construction vocabulary (spec §6). Dimensions are data with their own
// confidence: Gene confirmed rack sizes 8/9/12/19 ft and that an "upright" is
// the tall blue two-column braced frame; beams are the orange horizontals.
// Other values are industry-typical and marked provisional until checked
// against photos or the 2026 component catalog.
import { dcos, dsin, FT, IN, type Vec2, type Vec3, hypot } from '../core/math.ts';
import type { Confidence } from './types.ts';
import type { Color, Kind } from '../games/chess-rules.ts';
import { CHESS_ASSETS } from './catalog-chess.ts';
import { ITEM_ASSETS, type SurfaceSlotDef } from './catalog-items.ts';
import { stockAssets } from './catalog-stock.ts';
import { SOLAR_ASSETS, type EquipmentKind } from './catalog-solar.ts';
import { framingAssets } from './catalog-framing.ts';
import { ACTIVITY_ASSETS } from './catalog-activities.ts';
import { COMMONS_ASSETS } from './catalog-commons.ts';
import { SHORE_ASSETS } from './catalog-shore.ts';

export type GripSlot = { id: string; local: Vec3; /** Optional centered handle segment, full end-to-end local vector; midpoint drives formation. */ span?: Vec3 };
export type Socket = { id: string; kind: 'beam-seat' | 'beam-end' | 'joist-seat' | 'deck-seat' | 'stair-top' | 'stair-bottom'; local: Vec3; face?: 'front' | 'back';
  /** PC16 (#695): the connector kinds this socket takes, when its def says (a library part's `mates`); absent, any of its own rule's kinds. */
  mates?: string[] };

/**
 * Interaction slot on a fixture (spec §5 affordances, RESEARCH §8 Smart Objects): where a person's
 * body stands/sits, in the fixture's local ground frame (x, z), and the local yaw they face.
 * Runtime claims live in engine/social/slots.ts (`slot:<entity>#<id>` reservations).
 */
export type SlotDef = { id: string; kind: 'seat' | 'stand' | 'audience' | 'fire-circle' | 'berth'; local: [x: number, z: number]; yaw: number;
  /** berth only (beds/1): the mattress top (m above the fixture's base) a lying body rests on; `yaw` points head → feet. */
  height?: number;
  /** Logged entity-world seat policy; absent retains the original approach selection for historical assets. */
  approachPolicy?: 'reachable/1' };

export type Handling = {
  /** Crew sizes allowed to carry (spec §11). */
  carryCrew: [min: number, max: number];
  /** Orientation carried in: 'flat' = long axis horizontal, broad face horizontal. */
  carryPose: 'flat' | 'edge';
  /** Grip slots in local coordinates; carriers are assigned in slot order for a given crew size. */
  grips: Record<number, GripSlot[]>;
  /** Minimum crew to raise from horizontal to standing, if raisable. */
  raiseCrew?: number;
  /** Minimum humans holding while standing unsupported by connections. */
  holdCrew?: number;
  /** Hand height while carrying (m). */
  carryHeight: number;
  /** Small hand-held items (catalog-items.ts, engine/items): carried in this many hands (1). */
  hands?: 1 | 2;
  /** A small hand-held item (bowl, spoon, cup…): taken / put / eaten with by engine/items. */
  small?: true;
  /** Soul Actions 34: an item held by a handle (a watering can) hangs from the hand: carried with the arm down at the
   *  side at this hand point (body frame, m) instead of the small-item carry point, and reached for in `reachSeconds`. */
  hangCarry?: { fwd: number; side: number; up: number; reachSeconds: number };
  /**
   * Small enough (≤ SMALL_LOAD_KG) to carry in one hand while climbing a frame or walking a beam
   * (construction/frame.ts). Absent = not small.
   */
  smallLoad?: true;
  /** Fragile (solar panels, catalog-solar.ts): never tilted past maxTilt (rad) from level while carried or held, never dropped. */
  fragile?: { maxTilt: number };
};

/** A face that can be painted (engine/work/paint.ts): 'front' = the local +y broad face, 'back' = −y. */
export type PaintFace = 'front' | 'back';

/** Heaviest load that counts as "small" on the rack structure (climb / beam-walk): kg. */
export const SMALL_LOAD_KG = 10;

export type AssetDef = {
  id: string;
  /** XP5 hook: integral seats in a walkable structure approach their slot, rather than the structure's outer box. */
  seatApproach?: 'slot' | 'front-arc';
  label: string;
  category: 'rack-upright' | 'rack-beam' | 'timber' | 'plywood' | 'stair' | 'human' | 'vehicle' | 'fixture' | 'item' | 'test-block' | 'solar' | 'equipment';
  /** Local axis-aligned box: x = width/length, y = height, z = depth/thickness (m). */
  size: Vec3;
  massKg: number;
  color?: string;
  handling?: Handling;
  sockets?: Socket[];
  /** Stair flight modules: number of treads (risers = treads + 1; the landing is the top step). */
  stair?: { treads: number };
  /** Interaction slots (seats, fire-circle places); see SlotDef. */
  slots?: SlotDef[];
  /** Places on the fixture's top where items rest (tables; catalog-items.ts). */
  surfaceSlots?: SurfaceSlotDef[];
  /**
   * Fixture that stands where it is placed: a static walking obstacle at its catalog box even
   * without a construction `phase` (spatial/service.ts). A moving phase (`carried`) still lifts it out.
   */
  obstacle?: true;
  /** Rack beams: width of the top step flange a person can stand on (m); frame.ts beam walkways. */
  walkway?: { flange: number };
  /** Faces that can be painted (engine/work/paint.ts). */
  paintable?: { faces: PaintFace[] };
  /** Placed electrical equipment (catalog-solar.ts, spec §19): its kind and default configuration. */
  equipment?: { kind: EquipmentKind; defaults: Record<string, number | string> };
  /** Usable activity affordances, independent of mesh appearance and per-entity state. */
  capabilities?: {
    /** Opt-in small world items whose poses share the recorded hand clock. */
    recordedItemPoseV1?: true;
    /** Upright ground fixture transport; handling geometry is defined only here. */
    /** Chess token semantics are independent of its appearance. */
    gameToken?: { game: 'chess'; color: Color; kind: Kind };
    boardGame?: 'chess'; carrier?: import('../vehicles/carrier.ts').CarrierDef; readable?: { pages: number; maxSeatDistance: number }; fixtureCarry?: { handling: Handling; upright: true }; display?: { accepts: 'text'; maxChars: number }; presenterStation?: true; workstation?: { seatPoint: Vec2; seatTolerance: number; facingYaw: number; facingTolerance: number } };
  dims: { confidence: Confidence; note: string };
};

const provisional = (note: string) => ({ confidence: 'provisional' as const, note });

/** Beam-seat holes every 2 in are typical; we expose seats every 6 in for planning. */
function uprightSockets(height: number, depth: number): Socket[] {
  const out: Socket[] = [];
  for (let y = 12 * IN, i = 0; y < height - 3 * IN; y += 6 * IN, i++)
    for (const face of ['front', 'back'] as const)
      for (const side of [-1, 1])
        out.push({ id: `${face}-${side < 0 ? 'l' : 'r'}-${i}`, kind: 'beam-seat', local: [(side * depth) / 2, y, 0], face });
  return out;
}

// Library frames in the stock GLBs: upright_frame_{8ft_4ft,12ft_4ft,16ft_3ft,19ft_3ft} (AUDIT.md §2).
const UPRIGHT_DEPTH_FT: Record<number, number> = { 8: 4, 9: 4, 12: 4, 16: 3, 19: 3 };

function upright(ft: number): AssetDef {
  const h = ft * FT, depth = (UPRIGHT_DEPTH_FT[ft] ?? 4) * FT, t = 3 * IN;
  const tall = ft >= 12;
  return {
    id: `upright-${ft}ft`,
    label: `${ft} ft pallet-rack upright (blue two-column frame)`,
    category: 'rack-upright',
    // local x = depth between the two columns, y = height, z = column face thickness
    size: [depth, h, t],
    massKg: Math.round(ft * 3.2), // ~3.2 kg/ft for a light-duty frame: provisional
    color: '#1f5fbf',
    handling: {
      carryCrew: tall ? [2, 4] : [1, 3],
      carryPose: 'flat',
      // grips along the height axis (lying flat, height becomes the long axis)
      grips: {
        1: [{ id: 'mid', local: [0, h / 2, 0] }],
        2: [{ id: 'g0', local: [0, h * 0.18, 0] }, { id: 'g1', local: [0, h * 0.82, 0] }],
        3: [{ id: 'g0', local: [0, h * 0.12, 0] }, { id: 'g1', local: [0, h * 0.5, 0] }, { id: 'g2', local: [0, h * 0.88, 0] }],
        4: [
          { id: 'g0', local: [-depth / 2, h * 0.2, 0] }, { id: 'g1', local: [depth / 2, h * 0.2, 0] },
          { id: 'g2', local: [-depth / 2, h * 0.8, 0] }, { id: 'g3', local: [depth / 2, h * 0.8, 0] },
        ],
      },
      raiseCrew: ft >= 19 ? 3 : tall ? 2 : 1,
      holdCrew: ft >= 19 ? 2 : 1,
      carryHeight: 0.8,
    },
    sockets: uprightSockets(h, depth),
    dims: {
      confidence: ft === 9 ? 'provisional' : 'participant',
      note: ft === 9
        ? '9 ft named by Gene but no 9 ft frame exists in the model library; depth assumed 4 ft'
        : `height ${ft} ft; depth ${UPRIGHT_DEPTH_FT[ft]} ft from the stock library frame; 3 in columns provisional`,
    },
  };
}

function beam(ft: number): AssetDef {
  const l = ft * FT;
  return {
    id: `beam-${ft}ft`,
    label: `${ft} ft pallet-rack beam (orange)`,
    category: 'rack-beam',
    size: [l, 4 * IN, 2 * IN],
    massKg: Math.round(ft * 2.1),
    color: '#e86a1a',
    handling: {
      carryCrew: ft >= 12 ? [2, 2] : [1, 2],
      carryPose: 'edge',
      grips: {
        1: [{ id: 'mid', local: [0, 0, 0] }],
        2: [{ id: 'g0', local: [-l * 0.4, 0, 0] }, { id: 'g1', local: [l * 0.4, 0, 0] }],
      },
      holdCrew: 2,
      carryHeight: 0.85,
    },
    sockets: [
      { id: 'end-l', kind: 'beam-end', local: [-l / 2, 0, 0] },
      { id: 'end-r', kind: 'beam-end', local: [l / 2, 0, 0] },
    ],
    walkway: { flange: 0.1 }, // ≈ 4 in top step you can stand on: provisional
    dims: { confidence: 'participant', note: `length ${ft} ft from Gene's size list; 4x2 in section provisional` },
  };
}

function timber(ft: number): AssetDef {
  const l = ft * FT;
  return {
    id: `2x4-${ft}ft`,
    label: `${ft} ft 2x4`,
    category: 'timber',
    size: [l, 3.5 * IN, 1.5 * IN],
    massKg: Math.round(l * 1.9 * 10) / 10,
    color: '#c9a36b',
    handling: {
      carryCrew: [1, 2],
      carryPose: 'edge',
      grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-l * 0.4, 0, 0] }, { id: 'g1', local: [l * 0.4, 0, 0] }] },
      carryHeight: 0.9,
      ...(l * 1.9 <= SMALL_LOAD_KG ? { smallLoad: true as const } : {}),
    },
    dims: { confidence: 'documented', note: 'nominal 2x4 = 1.5 x 3.5 in' },
  };
}

/**
 * Site-built stair flight module (progressive construction, PROGRESSIVE.md):
 * two stringers + `treads` separately installed treads. Local x = run
 * (ascending toward +x), y = rise, z = width. Sized for the low Mars platform
 * deck (beam seat 6 ft + 2x4 joist + 3/4 in ply ≈ 1.99 m). Provisional.
 */
function stairFlight(treads: number, rise: number): AssetDef {
  const going = 0.25, width = 0.9, run = treads * going;
  return {
    id: `stair-flight-${treads}`,
    label: `${treads}-tread stair flight (2x12 stringers, ${rise.toFixed(2)} m rise)`,
    category: 'stair',
    size: [run, rise, width],
    massKg: Math.round(run * 2 * 8),
    color: '#b8905a',
    stair: { treads },
    handling: {
      carryCrew: [2, 4],
      carryPose: 'flat',
      grips: { 2: [{ id: 'g0', local: [-run * 0.4, 0, 0] }, { id: 'g1', local: [run * 0.4, 0, 0] }] },
      carryHeight: 0.8,
    },
    sockets: [
      { id: 'bottom', kind: 'stair-bottom', local: [-run / 2, 0, 0] },
      { id: 'top', kind: 'stair-top', local: [run / 2, rise, 0] },
    ],
    dims: { confidence: 'provisional', note: `going ${going} m, ${treads + 1} risers of ${(rise / (treads + 1)).toFixed(3)} m, 0.9 m clear width; Mars stairs are site-built — dimensions not yet checked against photos` },
  };
}

// Social fixtures (spec §17, SOCIAL.md). Seats face local +z (yaw π/2). All three are `obstacle`s:
// their box blocks walking at ground level (every one is taller than the 0.22 m step), so people
// reach a seat through its approach point (engine/social/slots.ts `seatApproach`), never across it.
const FACE_Z = Math.PI / 2;
/** Body radius (m) the fire-circle rule keeps clear; equals HUMAN_RADIUS (declared below). */
const BODY_R = 0.28;
/**
 * Fire-circle rule: a place stands at least FIRE_RING_GAP (a body radius + 0.3 m heat / step margin)
 * beyond the fire ring's farthest corner, and never closer than 1.6 m to the centre. For the 1 m
 * ring that is 1.6 m (0.89 m clear of the corner, so ≥ 0.28 m body clearance with grid slack).
 */
export const FIRE_RING_GAP = BODY_R + 0.3;
export const fireRingRadius = (sx: number, sz: number) => Math.max(1.6, hypot(sx, sz) / 2 + FIRE_RING_GAP);
const FIRE_SIZE: Vec3 = [1.0, 0.35, 1.0];
const FIRE_RING = fireRingRadius(FIRE_SIZE[0], FIRE_SIZE[2]); // m from the fire centre to where people stand
const SOCIAL_FIXTURES: AssetDef[] = [
  {
    id: 'bench-6ft',
    label: '6 ft bench (3 seats)',
    category: 'fixture',
    size: [6 * FT, 0.45, 0.4],
    massKg: 25,
    color: '#8a6a45',
    obstacle: true,
    slots: [-1, 0, 1].map((k, i) => ({ id: `seat${i}`, kind: 'seat' as const, local: [k * 2 * FT, 0] as [number, number], yaw: FACE_Z })),
    dims: provisional('generic site-built bench; seats every 2 ft'),
  },
  {
    id: 'camp-chair',
    label: 'folding camp chair',
    category: 'fixture',
    size: [0.55, 0.85, 0.55],
    massKg: 4,
    color: '#2f6f5f',
    obstacle: true,
    slots: [{ id: 'seat', kind: 'seat', local: [0, 0], yaw: FACE_Z }],
    dims: provisional('generic folding camp chair'),
    capabilities: { fixtureCarry: { upright: true, handling: { carryCrew: [1, 1], carryPose: 'edge', carryHeight: 1, grips: { 1: [{ id: 'chair-back', local: [0, 0.6, -0.258], span: [0.3, 0, 0] }] } } } },
  },
  {
    id: 'campfire',
    label: 'campfire (stone ring)',
    category: 'fixture',
    size: FIRE_SIZE,
    massKg: 80,
    color: '#7a3b1e',
    obstacle: true,
    // 8 places on the FIRE_RING circle (1.6 m), each facing the fire
    slots: Array.from({ length: 8 }, (_, k) => {
      const a = (k * Math.PI) / 4;
      return { id: `ring${k}`, kind: 'fire-circle' as const, local: [FIRE_RING * dcos(a), FIRE_RING * dsin(a)] as [number, number], yaw: a + Math.PI };
    }),
    dims: provisional('generic 1 m fire ring; people stand/sit 1.6 m from its centre'),
  },
];

export const CATALOG: Record<string, AssetDef> = Object.fromEntries(
  [
    ...[8, 9, 12, 16, 19].map(upright),
    ...[8, 9, 12].map(beam),
    ...[4, 6, 8, 12].map(timber),
    {
      id: 'plywood-4x6',
      label: '4x6 ft plywood panel (3/4 in; a 4x8 sheet cut to 6 ft)',
      category: 'plywood',
      paintable: { faces: ['front', 'back'] },
      size: [6 * FT, 0.75 * IN, 4 * FT],
      massKg: 20,
      color: '#d8b98a',
      handling: {
        carryCrew: [1, 2],
        carryPose: 'edge',
        grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-0.7, 0, 0] }, { id: 'g1', local: [0.7, 0, 0] }] },
        carryHeight: 0.75,
      },
      dims: { confidence: 'provisional', note: 'cut panel sized for a 6 ft deck over a 4 ft deep rack bay (1 ft joist cantilever each side); not yet checked against photos' },
    } satisfies AssetDef,
    stairFlight(10, 1.98),
    {
      id: 'stair-tread',
      label: 'stair tread (2x10, 0.9 m)',
      category: 'timber',
      size: [0.9, 1.5 * IN, 9.25 * IN],
      massKg: 4,
      color: '#c9a36b',
      handling: { carryCrew: [1, 1], carryPose: 'flat', grips: { 1: [{ id: 'mid', local: [0, 0, 0] }] }, carryHeight: 0.8, smallLoad: true },
      dims: { confidence: 'documented', note: 'nominal 2x10 = 1.5 x 9.25 in; 0.9 m length matches the stair flight width' },
    } satisfies AssetDef,
    {
      id: 'plywood-4x8',
      label: '4x8 ft plywood sheet (3/4 in)',
      category: 'plywood',
      paintable: { faces: ['front', 'back'] },
      size: [8 * FT, 0.75 * IN, 4 * FT],
      massKg: 27,
      color: '#d8b98a',
      handling: {
        carryCrew: [1, 2],
        carryPose: 'edge',
        grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-1.0, 0, 0] }, { id: 'g1', local: [1.0, 0, 0] }] },
        carryHeight: 0.75,
      },
      dims: { confidence: 'documented', note: 'standard sheet' },
    } satisfies AssetDef,
    {
      id: 'human',
      label: 'person',
      category: 'human',
      size: [0.5, 1.75, 0.35],
      massKg: 70,
      dims: provisional('generic adult; collision radius 0.28 m'),
    } satisfies AssetDef,
    // Rideable vehicles (engine/vehicles): local x = direction of travel. `obstacle`: parked, a vehicle
    // blocks walking at its box; while ridden its phase is `carried`, which lifts it out (spatial/service.ts).
    { id: 'euc', label: 'electric unicycle (EUC)', category: 'vehicle', size: [0.5, 0.55, 0.22], massKg: 25, color: '#222222', obstacle: true, dims: provisional('generic 18 in EUC; riding disc radius 0.35 m (vehicles/profiles.ts)') } satisfies AssetDef,
    { id: 'bicycle', label: 'bicycle', category: 'vehicle', size: [1.75, 1.05, 0.6], massKg: 14, color: '#3a6ea5', obstacle: true, dims: provisional('generic adult bicycle; riding disc radius 0.4 m (vehicles/profiles.ts)') } satisfies AssetDef,
    // Forklift (engine/vehicles/forklift.ts): x = 2.6 m length (forks at +x), y = 2.2 m lowered mast, z = 1.2 m width.
    { id: 'forklift', label: 'forklift (1 t)', category: 'vehicle', size: [2.6, 2.2, 1.2], massKg: 2600, color: '#e0b020', obstacle: true, dims: provisional('generic 1 t counterbalance forklift; lift 0–3.2 m, forks 1.1 m, capacity 1000 kg, disc radius 1.4 m, turn radius 2.5 m (vehicles/forklift.ts)') } satisfies AssetDef,
    ...SOCIAL_FIXTURES,
    ...COMMONS_ASSETS,
    ...SHORE_ASSETS,
    ...GARDEN_ASSETS,
    ...DRAWING_ASSETS,
    ...ACTIVITY_ASSETS,
    ...ITEM_ASSETS,
    ...CHESS_ASSETS,
    ...SOLAR_ASSETS,
    ...stockAssets({ upright }),
    ...framingAssets(), // 2x4 roof framing (catalog-framing.ts, construction/framing.ts)
    {
      id: 'test-wall',
      label: 'proving-ground wall block',
      category: 'test-block',
      size: [1, 2.4, 1],
      massKg: 0,
      dims: { confidence: 'hypothetical', note: 'test fixture, scaled per instance' },
    } satisfies AssetDef,
  ].map((d) => [d.id, d]),
);

export function def(id: string): AssetDef {
  const d = CATALOG[id];
  if (!d) throw new Error(`unknown asset definition "${id}"`);
  return d;
}

export const HUMAN_RADIUS = 0.28;
