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

export const HAND_STORAGE: DefInput[] = [drawerChest, lockers, { ...drawerChest3, version: 3 } as DefInput];
