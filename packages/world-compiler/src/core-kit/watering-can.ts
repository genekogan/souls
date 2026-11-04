// Soul Actions entry 34: a watering can carried by its handle, the hook it hangs on, and a planter whose plants grow.
// Opt-in revisions: v1 cans keep their own fill/empty actions; v1 planters keep moisture only (entries 16 and 18).
import type { DefInput } from '../schemas.ts';

/** Litres a full can holds; one pour gives at most POUR_LITRES (three pours empty a full can). */
export const CAN_LITRES = 10, POUR_LITRES = 4;
/** The can's handle grip (where the palm closes, the crown of the arched handle) and the rose (where the water leaves).
 *  The def's origin is right under the grip (the drum's centre is 6 cm ahead), so the can hangs the same whatever its yaw. */
export const CAN_GRIP: [number, number, number] = [0, 0.39, 0], CAN_ROSE: [number, number, number] = [0.465, 0.352, 0];
/** The filler opening on top of the can (the tap's water goes in here). */
export const CAN_OPENING: [number, number, number] = [0.115, 0.27, 0];
/** The hook (local): where the can's handle grip rests on its arm when it hangs, clear of the post. */
export const HOOK_PEG: [number, number, number] = [0, 1.226, 0.22];

const canPalette = { metal: '#c3cbce', dark: '#6b7376', water: '#5b8fb8' };
const wateringCan: DefInput = {
  schema: 'def/1', name: 'core-watering-can', version: 2,
  description: `A galvanised garden watering can (${CAN_LITRES} L) with an arched top handle, a long spout and a rose. It is carried by the handle; tilted, it waters the soil through the rose.`,
  tags: ['object', 'tool', 'watering-can', 'garden'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.006, shapes: [
    // body: a slightly tapered drum with a domed shoulder
    { kind: 'lathe', at: [0.06, 0, 0], profile: [[0, 0], [0.11, 0], [0.114, 0.012], [0.109, 0.215], [0.095, 0.248], [0.064, 0.266], [0, 0.27]], segments: 18, tint: 'metal' },
    { kind: 'cyl', at: [0.06, 0.012, 0], r: 0.115, h: 0.016, segments: 18, tint: 'dark' },
    
    // filler opening ahead of the handle, with a rolled collar; water shows in it when there is some
    { kind: 'cyl', at: [CAN_OPENING[0], 0.266, 0], r: 0.05, h: 0.022, segments: 14, tint: 'metal' },
    { kind: 'cyl', at: [CAN_OPENING[0], 0.276, 0], r: 0.04, h: 0.004, segments: 14, tint: 'dark' },
    { kind: 'cyl', at: [CAN_OPENING[0], 0.2785, 0], r: 0.037, h: 0.003, segments: 14, tint: 'water', material: 'water', when: '@level>0.05' },
    // the arched carrying handle over the rear half of the top (the hand closes at its crown)
    { kind: 'sweep', at: [0, 0, 0], path: [[-0.055, 0.235, 0], [-0.05, 0.32, 0], [-0.025, 0.372, 0], [0.0, 0.39, 0], [0.025, 0.378, 0], [0.048, 0.335, 0], [0.056, 0.266, 0]], r: 0.011, segments: 6, tint: 'metal' },
    // the rear pouring handle
    { kind: 'sweep', at: [0, 0, 0], path: [[-0.058, 0.2, 0], [-0.11, 0.17, 0], [-0.118, 0.11, 0], [-0.09, 0.06, 0], [-0.06, 0.05, 0]], r: 0.01, segments: 6, tint: 'metal' },
    // the spout from low on the front, up to the rose
    { kind: 'sweep', at: [0, 0, 0], path: [[0.155, 0.05, 0], [0.26, 0.15, 0], [0.36, 0.255, 0], [0.44, 0.33, 0]], r: 0.014, segments: 7, tint: 'metal' },
    { kind: 'cone', at: [0.452, 0.341, 0], r: 0.036, h: 0.04, segments: 12, tint: 'metal', roll: Math.PI - 0.82 },
    { kind: 'cyl', at: [CAN_ROSE[0], CAN_ROSE[1], 0], r: 0.037, h: 0.006, segments: 12, tint: 'dark', roll: -0.82 }] } } as unknown as DefInput['make'],
  params: { ...Object.fromEntries(Object.entries(canPalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])), litres: { type: 'number', min: 1, max: 30, default: CAN_LITRES, doc: 'litres it holds' } } as DefInput['params'], palette: canPalette,
  state: { level: { type: 'number', min: 0, max: 1, default: 0 } } as DefInput['state'],
  components: { carryable: { mass: 1.2, grips: 1 }, container: { capacity: 1 } } as DefInput['components'],
  slots: [{ id: 'handle', kind: 'carry', p: CAN_GRIP, yaw: 0 }] as DefInput['slots'],
  size: { box: [0.66, 0.42, 0.26] },
} as unknown as DefInput;

const hookPalette = { wood: '#7d6143', metal: '#5d6366' };
const canHook: DefInput = {
  schema: 'def/1', name: 'core-can-hook', version: 1,
  description: 'A garden post with an iron peg. A watering can hangs on it by its handle.',
  tags: ['garden', 'hook', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'box', at: [0, 0.75, 0], size: [0.09, 1.5, 0.09], tint: 'wood' },
    { kind: 'box', at: [0, 1.52, 0], size: [0.11, 0.04, 0.11], tint: 'wood' },
    // an iron arm out from the post; the can's handle rests on it, kept on by the upturned tip
    { kind: 'box', at: [0, HOOK_PEG[1] - 0.026, 0.15], size: [0.03, 0.03, 0.21], tint: 'metal' },
    { kind: 'cyl', at: [0, HOOK_PEG[1] + 0.01, 0.255], r: 0.01, h: 0.07, segments: 6, tint: 'metal' },
    { kind: 'sphere', at: [0, HOOK_PEG[1] + 0.046, 0.255], r: 0.013, segments: 6, tint: 'metal' }] } } as unknown as DefInput['make'],
  params: Object.fromEntries(Object.entries(hookPalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])) as DefInput['params'], palette: hookPalette,
  // the can's base hangs here (its handle grip then rests on the peg)
  slots: [{ id: 'peg', kind: 'hang', p: [HOOK_PEG[0] - CAN_GRIP[0], HOOK_PEG[1] - CAN_GRIP[1], HOOK_PEG[2] - CAN_GRIP[2]], yaw: 0 }] as DefInput['slots'],
  size: { box: [0.12, 1.55, 0.14] },
} as unknown as DefInput;

/** Growth stages of a planter@2 (state `growth`, a whole number); a word each for nearby perception. */
export const GROWTH_STAGES = ['seed', 'sprout', 'leafy', 'flowering', 'fruiting'] as const;
const plantPalette = { wood: '#7a5a3c', soil: '#5b4632', fill: '#2a1f15', leaf: '#4f8f3a', bloom: '#f2b8cc', fruit: '#d8452f' };
const growingPlanter: DefInput = {
  schema: 'def/1', name: 'core-garden-planter', version: 2,
  description: 'A wooden garden planter sown with tomatoes and flowers. Watered, it grows a stage a day: seed, sprout, leafy, flowering, fruiting. Left dry it stops growing and wilts, but it does not die.',
  tags: ['garden', 'planter', 'plant', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'box', at: [0, 0.18, 0], size: [0.9, 0.36, 0.5], round: 0.02, tint: 'wood' },
    { kind: 'box', at: [0, 0.362, 0], size: [0.82, 0.016, 0.42], round: 0, tint: 'soil' },
    // the damp patch: it spreads over the soil as it is watered (viewer: eased)
    { kind: 'box', at: [0, 0.3715, 0], size: [0.8, 0.004, 0.4], round: 0, tint: 'fill', role: 'fill' }] } } as unknown as DefInput['make'],
  params: { ...Object.fromEntries(Object.entries(plantPalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])), litres: { type: 'number', min: 1, max: 40, default: POUR_LITRES, doc: 'litres of water that soak it from dry to wet' } } as DefInput['params'], palette: plantPalette,
  state: { moisture: { type: 'number', min: 0, max: 1, default: 0.1 }, growth: { type: 'number', min: 0, max: 4, default: 0 }, thirst: { type: 'number', min: 0, max: 3, default: 0 }, pouring: { type: 'bool', default: false } } as DefInput['state'],
  // the patter of water from a can's rose on the soil, while it is poured
  components: { sound: { kind: 'water', radius: 8, volume: 0.6, when: 'pouring', mode: 'loop', variant: 3 } } as DefInput['components'],
  size: { box: [0.9, 0.9, 0.5] },
} as DefInput;

const optedPlanter: DefInput = {
  ...growingPlanter, version: 3,
  description: 'A growing garden planter. Biology is disabled until biologyEnabled is explicitly set. Enabled plants dry and recover over mirrored 72-world-hour curves; watering accumulates recovery before drying resumes.',
  state: { ...growingPlanter.state,
    biologyEnabled: { type: 'bool', default: false },
    biologyHour: { type: 'number', min: -1, max: 1e12, default: -1 },
    biologyWilt: { type: 'number', min: 0, max: 1, default: 0 },
    biologyTarget: { type: 'number', min: 0, max: 1, default: 1 },
    biologyMoisture: { type: 'number', min: 0, max: 1, default: .1 },
    biologyGrowth: { type: 'number', min: 0, max: 4, default: 0 },
  } as DefInput['state'],
};
export const WATERING_CAN: DefInput[] = [wateringCan, canHook, growingPlanter, optedPlanter];
