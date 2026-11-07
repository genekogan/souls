// Work and building site (L4): pallet rack uprights with beam sockets every 15 cm (6 in), rack
// beams, timber and plywood stock piles, solar panel, forklift, ladder, sawhorse, toolbox, anvil.
// From the Mars camp vocabulary (29 §3: racks, piles, solar, forklift). Front +z.
import { box, cbox, cone, cyl, kitDef, limb, rbox, shelf, socket, surface, tor, withRole } from './dsl.mjs';
import { actuators } from '../../vocab/index.ts';

const ORANGE = '#e0782f', BLUE = '#2f5d8b', STEEL = '#8c9196', YEL = '#f1c84b', PLY = '#d9bf8f', TIMBER = '#c49a63';
const work = (name, description, tags, shapes, palette, extra = {}) => kitDef({ name, description, tags: ['work', ...tags], shapes, palette, round: 0.012, ...extra });

const H = 3.0, W = 2.7, D = 1.1, STEP = 0.1524;
const sockets = [];
for (const [side, x] of [['l', -W / 2], ['r', W / 2]]) for (let i = 1; i * STEP < H - 0.1; i++) sockets.push(socket(`beam-${side}-${i}`, [x, +(i * STEP).toFixed(3), D / 2], 0, ['beam']));

// PC03 (#682): loose construction materials carrying the native engine materials' handling as data
// (mars/viewer/engine/world/catalog.ts: beam-9ft, upright-12ft, plywood-4x8), each laid with its long axis on +x.
// New revisions only: core-rack-beam@1 stays the one-hand 2.7 m item it always was.
const FT = 0.3048, IN = 0.0254;
// size.box is the native material's exact size (the kit's own box rounds and floors thin parts at 5 cm)
const loose = (def, version, handling, box) => Object.assign(def, { version, size: { ...def.size, box: box.map((x) => +x.toFixed(5)) }, components: { ...def.components, carryable: { ...def.components.carryable, handling } } });
const BEAM_L = 9 * FT, BEAM_H = 4 * IN, BEAM_D = 2 * IN;
const UP_L = 12 * FT, UP_W = 4 * FT, UP_T = 3 * IN, COL = 3 * IN;
const PLY_L = 8 * FT, PLY_W = 4 * FT, PLY_T = 0.75 * IN;
const TBL_L = 8 * FT, TBL_W = 3 * FT, TBL_H = 30 * IN, TBL_TOP = 1.5 * IN, TBL_LX = 1.1, TBL_LZ = 0.38;
const LOOSE = [
  loose(work('rack-beam', 'A loose orange 9 ft rack beam (2.74 m, 19 kg) with hook clips at each end; one person carries it with both hands, or two.', ['beam', 'rack', 'construction', 'material', 'loose-material', 'shared-carry'],
    [cbox([0, BEAM_H / 2, 0], [BEAM_L - 0.06, BEAM_H, BEAM_D], 'beam'), box([-(BEAM_L / 2 - 0.03), BEAM_H / 2, 0], [0.06, BEAM_H, BEAM_D], 'clip'), box([BEAM_L / 2 - 0.03, BEAM_H / 2, 0], [0.06, BEAM_H, BEAM_D], 'clip')],
    { beam: ORANGE, clip: '#3b3d40' }, { components: { carryable: { mass: 19, grips: 4 } } }), 2,
    { crew: [1, 2], pose: 'edge', height: 0.85, grips: { 1: [[0, 0, 0]], 2: [[-1.09728, 0, 0], [1.09728, 0, 0]] } }, [BEAM_L, BEAM_H, BEAM_D]),
  loose(work('rack-upright', 'A loose 12 ft pallet-rack upright frame (3.66 m, 38 kg) lying flat: two blue columns joined by bracing. It needs two to four carriers.', ['rack', 'upright', 'frame', 'construction', 'material', 'loose-material', 'shared-carry'],
    [...[-1, 1].map((s) => cbox([0, UP_T / 2, s * (UP_W / 2 - COL / 2)], [UP_L, UP_T, COL], 'upright')),
      ...[0.15, 0.85].map((f) => box([UP_L * (f - 0.5), UP_T / 2, 0], [0.04, 0.04, UP_W - 2 * COL], 'brace')),
      ...[0.15, 0.5].map((f) => box([UP_L * (f - 0.5) + UP_L * 0.175, UP_T / 2, 0], [0.04, 0.04, Math.hypot(UP_L * 0.35, UP_W - 2 * COL)], 'brace', { yaw: Math.atan2(UP_L * 0.35, UP_W - 2 * COL) }))],
    { upright: BLUE, brace: '#4a6f9a' }, { components: { carryable: { mass: 38, grips: 4 } } }), 1,
    // upright-12ft's grips (local y along the height from its base, x across) mapped to this frame: x = y - L/2, z = -x
    // (the native frame is carried pitched and rolled onto its face, which sends its +x across to -z; formationFor agrees)
    { crew: [2, 4], pose: 'flat', height: 0.8, grips: { 2: [[-1.170432, 0, 0], [1.170432, 0, 0]], 3: [[-1.389888, 0, 0], [0, 0, 0], [1.389888, 0, 0]], 4: [[-1.09728, 0, 0.6096], [-1.09728, 0, -0.6096], [1.09728, 0, 0.6096], [1.09728, 0, -0.6096]] } }, [UP_L, UP_T, UP_W]),
  loose(work('plywood-sheet', 'One loose 4×8 ft plywood sheet (2.44 × 1.22 m, 19 mm, 27 kg); one person carries it on edge with both hands, or two.', ['plywood', 'sheet', 'construction', 'material', 'loose-material', 'shared-carry'],
    [cbox([0, PLY_T / 2, 0], [PLY_L, PLY_T, PLY_W], 'ply')], { ply: PLY }, { components: { carryable: { mass: 27, grips: 4 } } }), 1,
    { crew: [1, 2], pose: 'edge', height: 0.75, grips: { 1: [[0, 0, 0]], 2: [[-1, 0, 0], [1, 0, 0]] } }, [PLY_L, PLY_T, PLY_W]),
  // PC11 (#690): a table-shaped load. A heavy 8 ft work table (75 kg) needs three carriers by mass (30 kg each) and has
  // room for four, one at each leg; it is carried level on its legs (the 'flat' pose keeps its height vertical) with
  // hands at its leg corners. Grips for three: the two legs at one end, and one at the middle of the other end's
  // width, which the native carry takes from a long side near that end (formation.ts: a centreline grip is a side slot).
  loose(work('work-table', 'A heavy 8 ft work table (2.44 × 0.91 m top, 0.76 m tall, 75 kg) on four steel legs; it needs three or four carriers.', ['table', 'workbench', 'furniture', 'construction', 'loose-material', 'shared-carry'],
    [cbox([0, TBL_H - TBL_TOP / 2, 0], [TBL_L, TBL_TOP, TBL_W], 'top'),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box([sx * TBL_LX, (TBL_H - TBL_TOP) / 2, sz * TBL_LZ], [0.05, TBL_H - TBL_TOP, 0.05], 'leg'))),
      ...[-1, 1].map((sz) => box([0, TBL_H - TBL_TOP - 0.04, sz * TBL_LZ], [2 * TBL_LX, 0.08, 0.03], 'leg')), box([0, 0.15, 0], [2 * TBL_LX, 0.03, 0.03], 'leg')],
    { top: TIMBER, leg: STEEL }, { components: { carryable: { mass: 75, grips: 4 } } }), 1,
    { crew: [3, 4], pose: 'flat', height: 0.75, grips: { 3: [[-TBL_LX, 0, TBL_LZ], [-TBL_LX, 0, -TBL_LZ], [TBL_LX, 0, 0]], 4: [[-TBL_LX, 0, TBL_LZ], [-TBL_LX, 0, -TBL_LZ], [TBL_LX, 0, TBL_LZ], [TBL_LX, 0, -TBL_LZ]] } }, [TBL_L, TBL_H, TBL_W]),
];

// PC12 (#691): the same loose upright and beam as new revisions with typed structural connectors (components.connectors),
// so a god can join them into an assembly whose graph the entities hold reciprocally and the engine mirrors. Older
// revisions keep their bytes. The upright's seats: both columns, both faces, every 6 in from 12 in up its length (the
// native upright-12ft's seat pitch); it stands with r = [yaw, 0, pi/2] (its +x up), its top face (y = UP_T) then facing
// -x. The beam's two ends bear: once one is joined both must be, or it would hang.
const r5 = (v) => +v.toFixed(5);
const UP_SEATS = [];
for (const [face, y] of [['front', UP_T], ['back', 0]]) for (const [side, z] of [['l', -(UP_W / 2 - COL / 2)], ['r', UP_W / 2 - COL / 2]])
  for (let i = 0; 12 * IN + 6 * IN * i < UP_L - 3 * IN; i++) UP_SEATS.push({ id: `${face}-${side}-${i}`, kind: 'beam-seat', at: [r5(-UP_L / 2 + 12 * IN + 6 * IN * i), r5(y), r5(z)], mates: ['beam-end'] });
const withConnectors = (def, version, description, connectors) => ({ ...structuredClone(def), version, description, tags: [...def.tags, 'connectors'], components: { ...structuredClone(def.components), connectors } });
const JOINED = [
  withConnectors(LOOSE[1], 2, 'A loose 12 ft pallet-rack upright frame (3.66 m, 38 kg): two blue columns joined by bracing, with beam seats on both columns of both faces every 6 in from 12 in. It needs two to four carriers lying flat; standing, rack beams join its seats.', UP_SEATS),
  withConnectors(LOOSE[0], 3, 'A loose orange 9 ft rack beam (2.74 m, 19 kg) with hook clips at each end that join an upright\'s beam seats; one person carries it with both hands, or two.',
    [-1, 1].map((sx) => ({ id: sx < 0 ? 'end-l' : 'end-r', kind: 'beam-end', at: [r5(sx * BEAM_L / 2), r5(BEAM_H / 2), 0], mates: ['beam-seat'], bears: true }))),
];

// PC15 (#694): a deck on a rack bay, from library parts joined by connectors (PC12). Mars decks are plywood on 2x4
// framing on rack beams (native construction/deck.ts); here the framing sits in the beams as on real step beams: each
// beam face has a step ledge 1 5/8 in under its top, and a joist cut to the bay rests on the ledges of the two beams
// that face each other across it, so the deck's top stays a step above the ground on the lowest beams (12 in). Joist
// seats every 24 in along the beam, the native 3/4 in plywood span; a 4×8 sheet across five of them bears on all five.
// Older revisions keep their bytes: the beam's `@3` stays the beam PC14 seats, and `@4` adds only the ledge seats.
const LEDGE = 1.625 * IN, JOIST_H = 3.5 * IN, JOIST_T = 1.5 * IN, SPAN = 24 * IN;
// the bay's beams sit on the upright's columns, (UP_W - COL) apart centre to centre; a joist spans face to face
const JOIST_L = UP_W - COL - BEAM_D;
const JOIST_SEATS = [];
for (const [face, z] of [['a', -BEAM_D / 2], ['b', BEAM_D / 2]]) for (let i = 0; i < 5; i++)
  JOIST_SEATS.push({ id: `joist-${face}-${i}`, kind: 'joist-seat', at: [r5((i - 2) * SPAN), r5(BEAM_H - LEDGE), r5(z)], mates: ['joist-end'] });
const DECK = [
  withConnectors(LOOSE[0], 4, 'A loose orange 9 ft step beam (2.74 m, 19 kg) with hook clips at each end that join an upright\'s beam seats, and a step ledge along each face that takes deck joists every 24 in; one person carries it with both hands, or two.',
    [...JOINED[1].components.connectors, ...JOIST_SEATS]),
  { ...loose(work('deck-joist', 'A loose 2x4 deck joist cut to a 4 ft rack bay (1.09 m, 1.6 kg), lying on edge. Its ends rest on the step ledges of the two beams across a bay; a plywood sheet rests on its top.', ['joist', 'timber', '2x4', 'deck', 'construction', 'material', 'loose-material', 'shared-carry', 'connectors'],
    [cbox([0, JOIST_H / 2, 0], [JOIST_L, JOIST_H, JOIST_T], 'timber')], { timber: TIMBER }, { components: { carryable: { mass: 1.6, grips: 2 } } }), 1,
    { crew: [1, 2], pose: 'edge', height: 0.8, grips: { 1: [[0, 0, 0]], 2: [[-0.45, 0, 0], [0.45, 0, 0]] } }, [JOIST_L, JOIST_H, JOIST_T]) },
];
DECK[1].components.connectors = [
  ...[-1, 1].map((sx) => ({ id: sx < 0 ? 'end-l' : 'end-r', kind: 'joist-end', at: [r5(sx * JOIST_L / 2), 0, 0], mates: ['joist-seat'], bears: true })),
  { id: 'top', kind: 'sheet-seat', at: [0, r5(JOIST_H), 0], mates: ['sheet-bearing'] },
];
DECK.push(withConnectors(LOOSE[2], 2, 'One loose 4×8 ft plywood sheet (2.44 × 1.22 m, 19 mm, 27 kg); one person carries it on edge with both hands, or two. Laid across five deck joists 24 in apart it bears on all five, and its top is a floor once it does.',
  Array.from({ length: 5 }, (_, i) => ({ id: `on-${i}`, kind: 'sheet-bearing', at: [r5((i - 2) * SPAN), 0, 0], mates: ['sheet-seat'], bears: true }))));
DECK[2].components.floor = { level: 0, y: r5(PLY_T) };

// PC16 (#695): stairs up to a rack deck, from library parts joined by connectors. A deck on step beams at seat 4 (36 in)
// has its top 40 5/8 in (1.03 m) above the ground, out of a step's reach; a site-built flight goes up to it (native
// construction/stairs.ts): two 2x12 stringers and a header that hangs on the ledge of the bay's outer beam face (the
// ledge the joists use on the inside), five 2x10 treads set one by one into it, six equal risers. The flight stands on
// its stringers, ascending along +x, its foot at x = -RUN/2 on the ground and its header's face at x = +RUN/2. A step
// beam's ledge seats take a joist end or a stair hook: `@5`; older revisions keep their bytes.
const STAIR_N = 5, STAIR_GO = 0.27, STAIR_RUN = STAIR_N * STAIR_GO, STAIR_W = 3 * FT, STRINGER_T = 1.5 * IN, TREAD_T = 1.5 * IN, TREAD_D = 9.25 * IN;
// the deck's top over the ground on beams at seat 4: the seat, half a beam down to its bottom, up to the ledge, a joist, the ply
const STAIR_HOOK = 12 * IN + 6 * IN * 4 - BEAM_H / 2 + (BEAM_H - LEDGE), STAIR_RISE = STAIR_HOOK + JOIST_H + PLY_T, RISER = STAIR_RISE / (STAIR_N + 1);
// a stringer: a 2x12 cut to stay inside the flight's run, its lower edge on the ground at the foot
const SLOPE = Math.atan2(STAIR_HOOK, STAIR_RUN), STR_D = 0.2, STR_L = (STAIR_RUN - STR_D * Math.sin(SLOPE)) / Math.cos(SLOPE);
const STR_Y = (STR_L / 2) * Math.sin(SLOPE) + (STR_D / 2) * Math.cos(SLOPE);
const STAIRS = [
  { ...loose(work('deck-stair', `A loose site-built stair flight (${STAIR_N} treads, ${STAIR_RISE.toFixed(2)} m rise over ${STAIR_RUN.toFixed(2)} m, 0.91 m wide, 16 kg): two 2x12 stringers and a header that hangs on a rack beam's step ledge. It stands on its stringers; two people carry it. Its treads go in one by one.`,
    ['stair', 'stairs', 'flight', 'timber', '2x12', 'construction', 'material', 'loose-material', 'shared-carry', 'connectors'],
    [...[-1, 1].map((s) => box([0, STR_Y, s * (STAIR_W / 2 - STRINGER_T / 2)], [STR_L, STR_D, STRINGER_T], 'timber', { roll: r5(SLOPE) })),
      box([STAIR_RUN / 2 - STRINGER_T / 2, STAIR_HOOK - 0.09, 0], [STRINGER_T, 0.18, STAIR_W - 2 * STRINGER_T], 'timber')],
    { timber: TIMBER }, { components: { carryable: { mass: 16, grips: 2 } } }), 1,
    { crew: [2, 2], pose: 'flat', height: 0.8, grips: { 2: [[-0.5, 0, 0], [0.5, 0, 0]] } }, [STAIR_RUN, STR_Y * 2, STAIR_W]) },
  { ...loose(work('deck-stair-tread', `A loose 2x10 stair tread cut to fit between a flight's stringers (${(STAIR_W - 2 * STRINGER_T).toFixed(2)} m, 2.3 kg). It rests on the stringers' cleats; one person sets it, or two.`,
    ['tread', 'stair', 'timber', '2x10', 'construction', 'material', 'loose-material', 'connectors'],
    [box([0, TREAD_T / 2, 0], [STAIR_W - 2 * STRINGER_T, TREAD_T, TREAD_D], 'timber')], { timber: TIMBER }, { components: { carryable: { mass: 2.3, grips: 2 } } }), 1,
    { crew: [1, 2], pose: 'flat', height: 0.8, grips: { 1: [[0, 0, 0]], 2: [[-0.3, 0, 0], [0.3, 0, 0]] } }, [STAIR_W - 2 * STRINGER_T, TREAD_T, TREAD_D]) },
  withConnectors(LOOSE[0], 5, 'A loose orange 9 ft step beam (2.74 m, 19 kg) with hook clips at each end that join an upright\'s beam seats, and a step ledge along each face that takes deck joists, or a stair flight\'s header, every 24 in; one person carries it with both hands, or two.',
    [...JOINED[1].components.connectors, ...JOIST_SEATS.map((s) => ({ ...s, mates: ['joist-end', 'stair-hook'] }))]),
];
STAIRS[0].components.connectors = [
  { id: 'hook', kind: 'stair-hook', at: [r5(STAIR_RUN / 2), r5(STAIR_HOOK), 0], mates: ['joist-seat'], bears: true },
  ...Array.from({ length: STAIR_N }, (_, i) => ({ id: `tread-${i + 1}`, kind: 'tread-seat', at: [r5(-STAIR_RUN / 2 + (i + 0.5) * STAIR_GO), r5((i + 1) * RISER - TREAD_T), 0], mates: ['tread-bearing'] })),
];
STAIRS[1].components.connectors = [{ id: 'seat', kind: 'tread-bearing', at: [0, 0, 0], mates: ['tread-seat'], bears: true }];

export default [
  work('pallet-rack', 'A pallet-rack bay (2.7 m wide, 3 m tall): two upright frames with beam sockets every 15 cm on the front face (slots beam-l-N / beam-r-N); two beam levels fitted with shelf slots.', ['rack', 'storage', 'pallet', 'warehouse', 'construction'],
    [...[-W / 2, W / 2].flatMap((x) => [cbox([x, H / 2, D / 2], [0.08, H, 0.06], 'upright'), cbox([x, H / 2, -D / 2], [0.08, H, 0.06], 'upright'), ...[0.3, 1.2, 2.1, 2.9].map((y) => box([x, y, 0], [0.04, 0.04, D], 'brace'))]),
      ...[1.0, 2.0].flatMap((y) => [cbox([0, y, D / 2], [W, 0.12, 0.05], 'beam'), cbox([0, y, -D / 2], [W, 0.12, 0.05], 'beam')]), ...[1.0, 2.0].map((y) => box([0, y + 0.07, 0], [W - 0.1, 0.02, D], 'deck'))],
    { upright: BLUE, brace: '#4a6f9a', beam: ORANGE, deck: '#b9a27a' }, { slots: [...sockets, shelf('level-1', [0, 1.08, 0], 4), shelf('level-2', [0, 2.08, 0], 4)], components: { surface: { height: 1.08 } } }),
  work('rack-beam', 'A loose orange rack beam (2.7 m) that clicks into a pallet-rack socket.', ['beam', 'rack', 'construction', 'item'],
    [cbox([0, 0.06, 0], [2.7, 0.12, 0.05], 'beam'), box([-1.33, 0.06, 0], [0.04, 0.16, 0.07], 'clip'), box([1.33, 0.06, 0], [0.04, 0.16, 0.07], 'clip')],
    { beam: ORANGE, clip: '#3b3d40' }, { components: { carryable: { mass: 12, grips: 2 } } }),
  work('timber-pile', 'A stack of sawn timber planks on bearers, strapped.', ['timber', 'wood', 'pile', 'stock', 'construction'],
    [...[-0.9, 0.9].map((z) => box([0, 0.05, z], [1.2, 0.1, 0.1], 'bearer')), ...[0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3, 4].map((i) => box([-0.48 + i * 0.24, 0.16 + r * 0.11, 0], [0.22, 0.1, 2.4], (r + i) % 2 ? 'plank' : 'plank2'))), ...[-0.6, 0.6].map((z) => box([0, 0.33, z], [1.22, 0.46, 0.02], 'strap'))],
    { bearer: '#6b4a2f', plank: TIMBER, plank2: '#b88c58', strap: '#2f5d8b' }, { components: { container: { capacity: 20, of: ['timber'] } } }),
  work('plywood-stack', 'A stack of plywood sheets (2.4 × 1.2 m) on a pallet.', ['plywood', 'sheet', 'pile', 'stock', 'construction'],
    [cbox([0, 0.07, 0], [1.25, 0.14, 2.45], 'pallet'), ...[0, 1, 2, 3, 4, 5].map((i) => box([0.004 * (i % 2), 0.16 + i * 0.036, 0.006 * (i % 3)], [1.2, 0.034, 2.4], i % 2 ? 'ply' : 'ply2'))],
    { pallet: '#8a6a48', ply: PLY, ply2: '#cdb07c' }),
  work('solar-panel', 'A tilted solar panel array (2 × 1 m panels ×2) on a steel frame.', ['solar', 'energy', 'power', 'roof'],
    [...[-1.05, 1.05].map((x) => box([x, 1.0, 0], [2.0, 0.04, 1.2], 'cell', { pitch: -0.5 })), ...[-1.05, 1.05].map((x) => box([x, 1.02, 0], [2.06, 0.02, 1.26], 'frame', { pitch: -0.5 })), ...[-2.0, 0, 2.0].flatMap((x) => [cyl([x, 0.55, 0.45], 0.04, 1.1, 'leg', { seg: 5 }), cyl([x, 0.85, -0.45], 0.04, 1.7, 'leg', { seg: 5 })])],
    { cell: '#24395a', frame: '#c9ced3', leg: STEEL }, { components: { workstation: { kind: 'power' } } }),
  work('forklift', 'A yellow forklift with forks, a mast, an overhead guard and a driver seat. Start it and the forks lift up the mast and lower again.', ['forklift', 'vehicle', 'warehouse', 'construction', 'transport'],
    [rbox([0, 0.55, -0.15], [1.1, 0.7, 1.8], 'body', { round: 0.08 }), rbox([0, 0.7, -0.95], [1.05, 0.55, 0.4], 'counter', { round: 0.1 }), cbox([0, 1.0, -0.3], [0.55, 0.12, 0.5], 'seat'), cbox([0, 1.25, -0.52], [0.55, 0.45, 0.1], 'seat'),
      ...[[-0.5, 0.35], [0.5, 0.35], [-0.5, -0.6], [0.5, -0.6]].flatMap(([x, z]) => [cyl([x, 1.4, z], 0.04, 1.7, 'guard', { seg: 5 })]), box([0, 2.25, -0.12], [1.06, 0.06, 1.0], 'guard'),
      ...[-0.3, 0.3].map((x) => cbox([x, 1.4, 0.82], [0.08, 2.6, 0.1], 'mast')), ...withRole('forks', [0, 0.08, 0.9], [box([0, 0.35, 0.9], [0.8, 0.5, 0.06], 'mast'), ...[-0.25, 0.25].map((x) => box([x, 0.08, 1.45], [0.12, 0.05, 1.1], 'fork'))]),
      ...[[-0.55, 0.45, 0.32], [0.55, 0.45, 0.32], [-0.52, -0.7, 0.26], [0.52, -0.7, 0.26]].map(([x, z, r]) => cyl([x, r, z], r, 0.2, 'tyre', { roll: Math.PI / 2, seg: 10 }))],
    { body: YEL, counter: '#3b3d40', seat: '#2b2b2b', guard: '#3b3d40', mast: '#5a5f66', fork: '#3b3d40', tyre: '#1f1f1f' }, { slots: [{ id: 'driver', kind: 'seat', p: [0, 1.06, -0.3], yaw: 0, height: 1.06, accepts: { tags: ['body'] }, capacity: 1 }], ...actuators([['power', { default: false }]], { label: 'the forklift' }),
      components: { carrier: { seats: 1 }, swing: { parts: [{ role: 'forks', kind: 'slide', axis: 'y', amount: 1.3, period: 12, phase: 0, when: 'on' }] } } }),
  work('ladder', 'A wooden step ladder (2 m), leaning open.', ['ladder', 'tools', 'construction'],
    [limb([-0.25, 0, 0.35], [-0.2, 1.95, 0], 0.03, 'wood', { kind: 'cyl', seg: 5 }), limb([0.25, 0, 0.35], [0.2, 1.95, 0], 0.03, 'wood', { kind: 'cyl', seg: 5 }), limb([-0.22, 0, -0.45], [-0.2, 1.9, -0.02], 0.025, 'wood', { kind: 'cyl', seg: 5 }), limb([0.22, 0, -0.45], [0.2, 1.9, -0.02], 0.025, 'wood', { kind: 'cyl', seg: 5 }),
      ...[0.35, 0.75, 1.15, 1.55].map((y) => box([0, y, 0.35 - (y / 1.95) * 0.35], [0.44, 0.04, 0.1], 'step')), cbox([0, 1.97, 0], [0.5, 0.06, 0.2], 'step')],
    { wood: '#c49a63', step: '#a47a4c' }, { components: { carryable: { mass: 8, grips: 2 } } }),
  work('sawhorse', 'A pair of sawhorses with a plank across: a quick work table.', ['sawhorse', 'tools', 'construction', 'table', 'surface'],
    [...[-0.7, 0.7].flatMap((x) => [cbox([x, 0.78, 0], [0.1, 0.08, 0.9], 'wood'), limb([x - 0.2, 0, 0.35], [x, 0.76, 0.3], 0.03, 'wood', { kind: 'cyl', seg: 5 }), limb([x + 0.2, 0, 0.35], [x, 0.76, 0.3], 0.03, 'wood', { kind: 'cyl', seg: 5 }), limb([x - 0.2, 0, -0.35], [x, 0.76, -0.3], 0.03, 'wood', { kind: 'cyl', seg: 5 }), limb([x + 0.2, 0, -0.35], [x, 0.76, -0.3], 0.03, 'wood', { kind: 'cyl', seg: 5 })]), cbox([0, 0.85, 0], [2.0, 0.05, 0.6], 'plank')],
    { wood: '#a47a4c', plank: PLY }, { slots: [surface('top', [0, 0.875, 0], 6)], components: { surface: { height: 0.875 }, workstation: { kind: 'carpentry' } } }),
  work('toolbox', 'A red metal toolbox with a handle (carryable).', ['toolbox', 'tools', 'item'],
    [cbox([0, 0.12, 0], [0.5, 0.24, 0.22], 'box'), box([0, 0.245, 0], [0.5, 0.02, 0.22], 'lid'), tor([0, 0.27, 0], 0.08, 0.012, 'lid', { arc: Math.PI, seg: 6 })],
    { box: '#c8382c', lid: '#3b3d40' }, { components: { carryable: { mass: 6, grips: 1 }, container: { capacity: 8, of: ['tool'] } } }),
  work('anvil', 'A blacksmith\'s anvil on an oak stump.', ['anvil', 'smithy', 'metal', 'tools'],
    [cyl([0, 0.3, 0], 0.28, 0.6, 'stump', { r2: 0.26, seg: 8 }), cbox([0, 0.68, 0], [0.22, 0.16, 0.42], 'iron'), cbox([0, 0.8, 0], [0.3, 0.1, 0.56], 'iron'), cone([0, 0.8, 0.42], 0.06, 0.3, 'iron', { pitch: Math.PI / 2, seg: 5 })],
    { stump: '#6b4a2f', iron: '#3b3d40' }, { components: { workstation: { kind: 'smithing' } } }),
  ...LOOSE,
  ...JOINED,
  ...DECK,
  ...STAIRS,
];
