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

// #435 (W071): a swap shelf (a free shelf). The same storage with data only: no `open` state, so no door (always open,
// containerOpen), and a declared `leftBy`, so it records who left each thing. One shelf at 1 m behind a low front rail, three
// places on it (each up to 0.3 m across and 0.28 m tall); the body stands 0.4 m in front of the rail. The lower shelf is fixed.
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
  components: { container: { capacity: 3, inside: { lip: 1.065, face: rail, stand: [0, rail + 0.4], fit: [0.3, 0.28, 0.3], word: 'shelf' } } } as DefInput['components'],
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
  components: { container: { capacity: 3, claim: 'owner', inside: { lip: 1.065, face: rail, stand: [0, rail + 0.4], fit: [0.3, 0.28, 0.3], word: 'shelf' } } } as DefInput['components'],
  palette: { wood: '#7a6a55', back: '#5c5042', sign: '#2f4f7f', letters: '#f1ead8', b0: '#c9a227', b1: '#6b3f6f' },
  size: { box: [W, H + 0.19, D] },
} as DefInput;

export const HAND_STORAGE: DefInput[] = [drawerChest, lockers, swapShelf, lostAndFound];
