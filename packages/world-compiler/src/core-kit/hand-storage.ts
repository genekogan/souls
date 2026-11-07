// Soul Actions entry 42: storage a Soul puts small things into by hand and takes them out of again. New revisions of
// entry 24's chest of drawers and entry 6's lockers; their frozen predecessors keep their bytes. The inside is a set of
// `shelf` slots (one stored thing each) plus the container's mouth (contact.ts containerInside): the slots are in the
// def frame with the drawer pulled OUT (where the hand puts and takes); the viewer slides what is inside with the drawer.
import type { DefInput } from '../schemas.ts';
import { HAND_DRAWERS } from './hand-drawers.ts';
import { HAND_CABINETS } from './hand-cabinets.ts';
import { DRAWER_TRAVEL } from '../contact.ts';

const box = (at: number[], size: number[], tint: string) => ({ kind: 'box', at, size, round: 0, tint });
const shelf = (id: string, p: number[], label: string) => ({ id, kind: 'shelf', p, yaw: 0, accepts: {}, capacity: 1, label });

// The top drawer (hand-drawers.ts): its floor's top at 1.016 m, the front's top edge (the lip) at 1.205 m, the front's
// outer face at z 0.25 closed (+ DRAWER_TRAVEL open), inside 0.80 × 0.15 × 0.42 m. Two places side by side, 0.17 m
// behind the front; the body stands where the pull leaves it (the knob + 0.5 m), so nothing steps between open and put.
const drawerFront = Math.round((0.25 + DRAWER_TRAVEL) * 1000) / 1000, drawerZ = 0.40;
const chest = structuredClone(HAND_DRAWERS[0]) as DefInput & { slots?: unknown[] };
const drawerChest: DefInput = {
  ...chest, version: 2,
  description: 'A tall wooden chest of drawers (1.25 m). A Soul slides the top drawer open and shut by hand and keeps up to two small things inside it (each up to 0.36 m across and 0.14 m tall); the lower drawers are fixed.',
  tags: [...(chest.tags ?? []), 'storage-inside'],
  slots: [shelf('in-1', [-0.2, 1.016, drawerZ], 'drawer'), shelf('in-2', [0.2, 1.016, drawerZ], 'drawer')] as DefInput['slots'],
  components: { container: { capacity: 2, inside: { lip: 1.205, face: drawerFront, stand: [0, 0.265 + DRAWER_TRAVEL + 0.5], fit: [0.36, 0.14, 0.36], word: 'drawer' } } } as DefInput['components'],
} as DefInput;

// The first locker (hand-cabinets.ts): compartment x −0.435…−0.165, depth 0.42 m, door hinged at x −0.455 (it swings out
// along +z). A shelf at 1.05 m (a standing reach, no bend to the floor); the body stands to the right of the open door.
const lockerV2 = structuredClone(HAND_CABINETS.find((d) => d.name === 'core-lockers')!) as DefInput;
const lmake = lockerV2.make as { kind: 'gen'; gen: string; args: { shapes: Record<string, unknown>[] } };
lmake.args.shapes.push(box([-0.3, 1.04, -0.005], [0.27, 0.02, 0.41], 'paint'));
const lockers: DefInput = {
  ...lockerV2, version: 3,
  description: 'Three steel lockers with a physically operated first door and a shelf at 1.05 m inside it, where a Soul keeps one small thing (up to 0.26 m across and 0.62 m tall). The other two doors remain fixed.',
  tags: [...(lockerV2.tags ?? []), 'storage-inside'],
  slots: [...((lockerV2 as { slots?: unknown[] }).slots ?? []), shelf('in-1', [-0.3, 1.05, 0.1], 'locker')] as DefInput['slots'],
  components: { ...lockerV2.components, container: { capacity: 1, inside: { lip: 1.055, face: 0.236, stand: [-0.12, 0.76], fit: [0.26, 0.62, 0.36], word: 'locker' } } } as DefInput['components'],
} as DefInput;

// #494 / #416: drawer-chest@1 and @2 are immutable (worlds keep their geometry); @3 is @2 (the drawer, its two places
// inside and every other field) within the 400-triangle kit budget. Its seven brass knobs were 8-sided spheres (64
// triangles each); the fixed drawers' knobs now have 5 sides and the moving drawer's knob, where the hand goes, 6.
const drawerChest3 = structuredClone(drawerChest) as DefInput & { make: { args: { shapes: Record<string, unknown>[] } } };
for (const sh of drawerChest3.make.args.shapes) if (sh.tint === 'brass') sh.segments = sh.role === 'drawer' ? 6 : 5;

// #435 (W071): a swap shelf (a free shelf). The same storage with data only: no `open` state, so no door (always open,
// containerOpen), and a declared `leftBy`, so it records who left each thing. One shelf at 1 m behind a low front rail, three
// places on it (each up to 0.3 m across and 0.28 m tall); the body stands 0.6 m clear of the footprint, so the engine's step in during a reach (at most 0.2 m) leaves it 0.4 m clear at every turn (0.35 m tripped a recovered fault at some turns, #1063). The lower shelf is fixed.
const H = 1.55, W = 1.0, D = 0.4, rail = 0.195;
const shelfShapes = () => [
  box([-W / 2 + 0.015, H / 2, 0], [0.03, H, D], 'wood'), box([W / 2 - 0.015, H / 2, 0], [0.03, H, D], 'wood'),
  box([0, H / 2, -D / 2 + 0.01], [W - 0.06, H, 0.02], 'back'), box([0, H - 0.015, 0], [W, 0.03, D], 'wood'),
  box([0, 0.06, 0], [W - 0.06, 0.03, D - 0.02], 'wood'), box([0, 0.52, 0], [W - 0.06, 0.03, D - 0.02], 'wood'),
  box([0, 1.0, 0], [W - 0.06, 0.03, D - 0.02], 'wood'), box([0, 1.04, rail - 0.01], [W - 0.06, 0.05, 0.02], 'wood'),
  box([0, H + 0.1, 0], [0.84, 0.17, 0.03], 'sign'), box([0, H + 0.1, 0.016], [0.6, 0.05, 0.004], 'letters'),
  box([-0.28, 0.66, -0.04], [0.3, 0.25, 0.22], 'b0'), box([0.12, 0.64, -0.04], [0.22, 0.21, 0.22], 'b1'),
];
const shelfSlots = () => [shelf('in-1', [-0.3, 1.015, -0.01], 'shelf'), shelf('in-2', [0, 1.015, -0.01], 'shelf'), shelf('in-3', [0.3, 1.015, -0.01], 'shelf')] as DefInput['slots'];
const swapShelf: DefInput = {
  schema: 'def/1', name: 'core-swap-shelf', version: 1,
  description: 'An open wooden swap shelf (1 × 0.4 m, 1.55 m tall) under a painted header: take something, leave something. One shelf at 1 m behind a low front rail holds up to three small things (each up to 0.3 m across and 0.28 m tall), and it remembers who left each one; nearby you see what is on it and who left it. The lower shelf is fixed.',
  tags: ['furniture', 'storage', 'shelf', 'swap', 'hand-operated', 'storage-inside'],
  synonyms: ['swap shelf', 'free shelf', 'giveaway shelf', 'take one leave one'],
  form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: shelfShapes() } },
  params: { wood: { type: 'color', default: '#8a6240', doc: 'wood colour' }, back: { type: 'color', default: '#6f4d32', doc: 'back panel colour' }, sign: { type: 'color', default: '#2f6b5a', doc: 'header colour' } },
  state: { leftBy: { type: 'string', max: 240, default: '' } },
  slots: shelfSlots(),
  components: { container: { capacity: 3, inside: { lip: 1.065, face: rail, stand: [0, rail + 0.605], fit: [0.3, 0.28, 0.3], word: 'shelf' } } } as DefInput['components'],
  palette: { wood: '#8a6240', back: '#6f4d32', sign: '#2f6b5a', letters: '#f1ead8', b0: '#9a3b32', b1: '#3b5f8a' },
  size: { box: [W, H + 0.19, D] },
} as DefInput;

// #435 (W072): a lost-and-found. The swap shelf's form with data only: no door, a `leftBy` record (here, who found and
// handed in each thing), and `claim: "owner"`, so a thing that has an owner of its own is given back only to that owner.
const lostAndFound: DefInput = {
  schema: 'def/1', name: 'core-lost-and-found', version: 1,
  description: 'An open wooden lost-and-found shelf (1 × 0.4 m, 1.55 m tall) under a blue "lost & found" header. One shelf at 1 m behind a low front rail holds up to three small things that Souls found and handed in (each up to 0.3 m across and 0.28 m tall). It remembers who handed each one in, and a thing that belongs to someone is given back only to its owner; nearby you see whose each thing is and who found it. The lower shelf is fixed.',
  tags: ['furniture', 'storage', 'shelf', 'lost-and-found', 'hand-operated', 'storage-inside'],
  synonyms: ['lost and found', 'lost-and-found', 'lost property', 'lost property shelf'],
  form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: shelfShapes() } },
  params: { wood: { type: 'color', default: '#7a6a55', doc: 'wood colour' }, back: { type: 'color', default: '#5c5042', doc: 'back panel colour' }, sign: { type: 'color', default: '#2f4f7f', doc: 'header colour' } },
  state: { leftBy: { type: 'string', max: 240, default: '' } },
  slots: shelfSlots(),
  components: { container: { capacity: 3, claim: 'owner', inside: { lip: 1.065, face: rail, stand: [0, rail + 0.605], fit: [0.3, 0.28, 0.3], word: 'shelf' } } } as DefInput['components'],
  palette: { wood: '#7a6a55', back: '#5c5042', sign: '#2f4f7f', letters: '#f1ead8', b0: '#c9a227', b1: '#6b3f6f' },
  size: { box: [W, H + 0.19, D] },
} as DefInput;

// #435 (W068): hiding places. Doorless containers with one place and `hidden: true`: what is in them is never named, offered
// or drawn, and only a search finds it. Two reaches on one rule: down over a stump's rim, and in at the front of a wall's niche.
// Both stand 0.6 m clear of the footprint. The engine's step in during a reach (at most 0.2 m, items/actions.ts) leaves the body
// 0.4 m clear of it at every turn; 0.35 m tripped a recovered engine fault at some turns (tools/soul-actions/container-turns.test.mjs).
const STUMP_R = 0.28, STUMP_RIM = 1.06, STUMP_FLOOR = 0.93;
const hollowStump: DefInput = {
  schema: 'def/1', name: 'core-hollow-stump', version: 1,
  description: 'An old tree stump, chest high, gone hollow at the top. One small thing fits down inside it (up to 0.28 m across and 0.12 m tall), out of everyone\'s sight: a Soul can hide something there, and whoever searches the stump finds it.',
  tags: ['furniture', 'storage', 'hiding-place', 'hand-operated', 'storage-inside'],
  synonyms: ['stump', 'hollow stump', 'tree stump', 'hiding place'],
  form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'lathe', at: [0, 0, 0], profile: [[STUMP_R + 0.04, 0], [STUMP_R + 0.02, 0.12], [STUMP_R, 0.5], [STUMP_R - 0.02, STUMP_RIM - 0.03], [STUMP_R - 0.02, STUMP_RIM], [STUMP_R - 0.04, STUMP_RIM], [STUMP_R - 0.04, STUMP_FLOOR + 0.01], [0, STUMP_FLOOR]], segments: 14, tint: 'bark', collide: true },
    { kind: 'lathe', at: [0, 0, 0], profile: [[STUMP_R - 0.041, STUMP_FLOOR + 0.005], [0, STUMP_FLOOR + 0.002]], segments: 14, tint: 'hollow' },
  ] } },
  params: { bark: { type: 'color', default: '#5b4632', doc: 'bark colour' }, hollow: { type: 'color', default: '#1f1711', doc: 'colour down inside the hollow' } },
  state: {},
  slots: [shelf('in-1', [0, STUMP_FLOOR, 0.04], 'stump')] as DefInput['slots'],
  components: { container: { capacity: 1, hidden: true, inside: { lip: STUMP_RIM, face: STUMP_R, stand: [0, STUMP_R + 0.04 + 0.6], fit: [0.28, 0.12, 0.28], word: 'stump' } } } as DefInput['components'],
  palette: { bark: '#5b4632', hollow: '#1f1711' },
  size: { box: [(STUMP_R + 0.04) * 2, STUMP_RIM, (STUMP_R + 0.04) * 2] },
} as DefInput;
const NW = 1.2, NH = 1.35, ND = 0.42;
const wallNiche: DefInput = {
  schema: 'def/1', name: 'core-wall-niche', version: 1,
  description: 'A short length of old stone wall (1.2 m long, 1.35 m tall) with a dark niche at waist height behind a low lip of stone. One small thing fits at the back of it (up to 0.3 m across and 0.16 m tall), out of everyone\'s sight: a Soul can hide something there, and whoever searches the niche finds it.',
  tags: ['furniture', 'storage', 'hiding-place', 'hand-operated', 'storage-inside'],
  synonyms: ['niche', 'wall niche', 'stone wall', 'hiding place'],
  form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    box([0, 0.49, 0], [NW, 0.98, ND], 'stone'), box([0, 1.285, 0], [NW, 0.13, ND], 'stone'),
    box([-0.42, 1.1, 0], [0.36, 0.25, ND], 'stone'), box([0.42, 1.1, 0], [0.36, 0.25, ND], 'stone'),
    box([0, 1.1, -ND / 2 + 0.02], [0.5, 0.25, 0.04], 'shade'), box([0, 1.005, ND / 2 - 0.02], [0.5, 0.05, 0.04], 'stone'),
  ] } },
  params: { stone: { type: 'color', default: '#8d8577', doc: 'stone colour' } },
  state: {},
  slots: [shelf('in-1', [0, 0.98, -0.03], 'niche')] as DefInput['slots'],
  components: { container: { capacity: 1, hidden: true, inside: { lip: 1.03, face: ND / 2, stand: [0, ND / 2 + 0.6], fit: [0.3, 0.16, 0.3], word: 'niche' } } } as DefInput['components'],
  palette: { stone: '#8d8577', shade: '#26221d' },
  size: { box: [NW, NH, ND] },
} as DefInput;

// #435 (W071): a pantry. The same doorless storage as data only, with no `leftBy`: four places on the shelf at 1 m, each
// for one small thing (a mug, an apple, a bun; a loaf is too wide), and jars and a sack on the fixed shelf below. What is
// in it is what you can see and count: a thing leaves it by hand, and is used through the entry that already handles it.
const pantry: DefInput = {
  schema: 'def/1', name: 'core-pantry', version: 1,
  description: 'An open wooden pantry (1 × 0.4 m, 1.55 m tall). One shelf at 1 m behind a low front rail keeps up to four small things (each up to 0.2 m across and 0.28 m tall), such as a mug, an apple or a bun, taken out by hand; nearby you see what is in it. Jars and a sack stand on the fixed shelf below.',
  tags: ['furniture', 'storage', 'shelf', 'pantry', 'kitchen', 'hand-operated', 'storage-inside'],
  synonyms: ['pantry', 'larder', 'food shelf', 'kitchen shelf'],
  form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    box([-W / 2 + 0.015, H / 2, 0], [0.03, H, D], 'wood'), box([W / 2 - 0.015, H / 2, 0], [0.03, H, D], 'wood'),
    box([0, H / 2, -D / 2 + 0.01], [W - 0.06, H, 0.02], 'back'), box([0, H - 0.015, 0], [W, 0.03, D], 'wood'),
    box([0, 0.06, 0], [W - 0.06, 0.03, D - 0.02], 'wood'), box([0, 0.52, 0], [W - 0.06, 0.03, D - 0.02], 'wood'),
    box([0, 1.0, 0], [W - 0.06, 0.03, D - 0.02], 'wood'), box([0, 1.04, rail - 0.01], [W - 0.06, 0.05, 0.02], 'wood'),
    { kind: 'cyl', at: [-0.3, 0.63, -0.04], r: 0.055, h: 0.19, segments: 10, tint: 'jar' }, { kind: 'cyl', at: [-0.3, 0.735, -0.04], r: 0.058, h: 0.02, segments: 10, tint: 'lid' },
    { kind: 'cyl', at: [-0.14, 0.6, -0.04], r: 0.05, h: 0.13, segments: 10, tint: 'jar2' }, { kind: 'cyl', at: [-0.14, 0.675, -0.04], r: 0.053, h: 0.02, segments: 10, tint: 'lid' },
    box([0.22, 0.66, -0.04], [0.3, 0.25, 0.22], 'sack'),
  ] } },
  params: { wood: { type: 'color', default: '#9a7448', doc: 'wood colour' }, back: { type: 'color', default: '#7c5a38', doc: 'back panel colour' } },
  slots: [shelf('in-1', [-0.33, 1.015, -0.01], 'shelf'), shelf('in-2', [-0.11, 1.015, -0.01], 'shelf'), shelf('in-3', [0.11, 1.015, -0.01], 'shelf'), shelf('in-4', [0.33, 1.015, -0.01], 'shelf')] as DefInput['slots'],
  components: { container: { capacity: 4, inside: { lip: 1.065, face: rail, stand: [0, rail + 0.605], fit: [0.2, 0.28, 0.3], word: 'pantry' } } } as DefInput['components'],
  palette: { wood: '#9a7448', back: '#7c5a38', jar: '#c9a24a', jar2: '#a8493a', lid: '#3a3a3a', sack: '#c8b48a' },
  size: { box: [W, H, D] },
} as DefInput;

export const HAND_STORAGE: DefInput[] = [drawerChest, lockers, { ...drawerChest3, version: 3 } as DefInput, swapShelf, lostAndFound, hollowStump, wallNiche, pantry];
