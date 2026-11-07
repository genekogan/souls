// Water a Soul turns on and off by hand (Soul Actions entry 15): the hand goes to the part tinted `valve` and the
// water starts or stops at contact: the viewer's moving water (fx/water-jets.ts) leaves the part tinted `nozzle`. Frozen v1 showers and fountains keep the generic actuator.
import vocab from './vocab.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

const desk = (vocab.find(d => d.name === 'core-desk-lamp')! as unknown as DefInput).actions!;
const switches = (on: string, off: string) => desk.map(a => ({ ...structuredClone(a), label: a.name === 'switch-on' ? on : off }));
const water = (kind: 'water', radius: number, volume: number) => ({ sound: { kind, radius, volume, when: 'on', mode: 'loop' } });
const palette = { metal: '#8d9499', valve: '#b8322a', nozzle: '#6f767b', stone: '#9b978d', water: '#bfe3f2' };
const params = { metal: { type: 'color', default: palette.metal, doc: 'pipe colour' }, valve: { type: 'color', default: palette.valve, doc: 'valve handle colour (the hand goes here)' }, nozzle: { type: 'color', default: palette.nozzle, doc: 'nozzle colour (the water leaves here)' }, stone: { type: 'color', default: palette.stone, doc: 'basin colour' }, water: { type: 'color', default: palette.water, doc: 'water colour' } };

const gardenTap: DefInput = {
  schema: 'def/1', name: 'core-garden-tap', version: 1,
  description: 'A garden standpipe with a tap over a small stone basin. A Soul turns it on and off by hand; water runs into the basin while it is on.',
  tags: ['water', 'garden', 'tap', 'hand-operated'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    // M03: the valve sits on top of a 1.12 m standpipe (at 0.93 m the reach knelt, like entry 20's 0.9 m knob)
    { kind: 'box', at: [0, 0.56, 0], size: [0.08, 1.12, 0.08], round: 0.01, tint: 'metal' },
    { kind: 'cyl', at: [0, 0.8, 0.09], r: 0.022, h: 0.16, segments: 8, tint: 'metal', pitch: Math.PI / 2 },
    { kind: 'cyl', at: [0, 1.14, 0.02], r: 0.045, h: 0.02, segments: 6, tint: 'valve' },
    { kind: 'cyl', at: [0, 0.05, 0.2], r: 0.22, h: 0.1, segments: 12, r2: 0.18, tint: 'stone' },
    { kind: 'cyl', at: [0, 0.795, 0.17], r: 0.016, h: 0.02, segments: 6, tint: 'nozzle' },
    { kind: 'cyl', at: [0, 0.1, 0.2], r: 0.15, h: 0.012, segments: 12, tint: 'water', material: 'water', when: '@on' }] } } as unknown as DefInput['make'],
  params: params as DefInput['params'], palette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: water('water', 8, 0.35) as DefInput['components'],
  size: { box: [0.44, 1.16, 0.88] },   // covers the basin in front of the spout, so nobody stands in it
  actions: switches('Turn on the tap', 'Turn off the tap') as DefInput['actions'],
} as DefInput;

const beachShower: DefInput = {
  schema: 'def/1', name: 'core-beach-shower', version: 1,
  description: 'An outdoor shower on a pole over a slatted tray. A Soul turns it on and off by hand at the valve on the pole; water falls from the head while it is on.',
  tags: ['water', 'bath', 'shower', 'beach', 'hand-operated'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'cyl', at: [0, 1.15, 0], r: 0.04, h: 2.3, segments: 8, tint: 'metal' },
    { kind: 'box', at: [0, 2.26, 0.13], size: [0.04, 0.04, 0.26], round: 0.01, tint: 'metal' },
    { kind: 'cyl', at: [0, 2.22, 0.27], r: 0.1, h: 0.04, segments: 10, tint: 'metal' },
    { kind: 'cyl', at: [0, 1.15, 0.05], r: 0.05, h: 0.03, segments: 6, tint: 'valve', pitch: Math.PI / 2 },
    { kind: 'box', at: [0, 0.02, 0.3], size: [0.7, 0.04, 0.7], round: 0, tint: 'stone' },
    { kind: 'cyl', at: [0, 2.19, 0.27], r: 0.08, h: 0.01, segments: 10, tint: 'nozzle' }] } } as unknown as DefInput['make'],
  params: params as DefInput['params'], palette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: water('water', 10, 0.4) as DefInput['components'],
  size: { box: [0.7, 2.3, 0.7] },
  actions: switches('Turn on the shower', 'Turn off the shower') as DefInput['actions'],
} as DefInput;


// Entry 16: a sprinkler that soaks the garden planters within its reach when a Soul turns it on by hand.
export const SPRINKLER_REACH = 3.5;
const gardenSprinkler: DefInput = {
  schema: 'def/1', name: 'core-garden-sprinkler', version: 1,
  description: `A garden sprinkler on a short standpipe. A Soul turns it on and off by hand at the valve on its back; while it is on it sprays forward over the planters within ${SPRINKLER_REACH} m.`,
  tags: ['water', 'garden', 'sprinkler', 'hand-operated', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'box', at: [0, 0.3, 0], size: [0.06, 0.6, 0.06], round: 0.01, tint: 'metal' },
    { kind: 'cyl', at: [0, 0.64, 0], r: 0.05, h: 0.05, segments: 10, tint: 'metal' },
    { kind: 'cyl', at: [0, 0.42, -0.05], r: 0.04, h: 0.03, segments: 6, tint: 'valve', pitch: -Math.PI / 2 },
    // an oscillating sprinkler: the viewer's droplets (fx/water-jets.ts) sweep forward from the nozzle; the valve is on the back
    { kind: 'cyl', at: [0, 0.69, 0.04], r: 0.02, h: 0.03, segments: 6, tint: 'nozzle', pitch: Math.PI / 3 }] } } as unknown as DefInput['make'],
  params: { ...params, reach: { type: 'number', min: 1, max: 8, default: SPRINKLER_REACH, doc: 'metres of garden it waters' } } as DefInput['params'], palette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: water('water', 9, 0.3) as DefInput['components'],
  size: { box: [0.2, 0.65, 0.2] },
  actions: switches('Turn on the sprinkler', 'Turn off the sprinkler') as DefInput['actions'],
} as DefInput;
const plantPalette = { wood: '#7a5a3c', soil: '#5b4632', fill: '#2f2418', leaf: '#4f8f3a', bloom: '#e8b6c8' };
const gardenPlanter: DefInput = {
  schema: 'def/1', name: 'core-garden-planter', version: 1,
  description: 'A wooden garden planter with soil and a flowering plant. It droops and browns when dry and stands up green and flowering when watered (moisture 0..1).',
  tags: ['garden', 'planter', 'plant', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'box', at: [0, 0.18, 0], size: [0.9, 0.36, 0.5], round: 0.02, tint: 'wood' },
    { kind: 'box', at: [0, 0.36, 0], size: [0.82, 0.02, 0.42], round: 0, tint: 'soil' },
    { kind: 'cyl', at: [0, 0.372, 0], r: 0.38, h: 0.006, segments: 12, tint: 'fill', role: 'fill' },
    { kind: 'sphere', at: [-0.2, 0.62, 0], r: 0.2, segments: 8, tint: 'leaf', role: 'head', pivot: [0, -0.25, 0] },
    { kind: 'sphere', at: [0.2, 0.6, 0.02], r: 0.18, segments: 8, tint: 'leaf', role: 'head', pivot: [0, -0.23, 0] },
    { kind: 'sphere', at: [0, 0.72, -0.03], r: 0.17, segments: 8, tint: 'leaf', role: 'head', pivot: [0, -0.35, 0] },
    { kind: 'sphere', at: [-0.12, 0.84, 0.08], r: 0.06, segments: 6, tint: 'bloom', role: 'head', pivot: [0, -0.47, 0] },
    { kind: 'sphere', at: [0.15, 0.78, 0.1], r: 0.055, segments: 6, tint: 'bloom', role: 'head', pivot: [0, -0.41, 0] }] } } as unknown as DefInput['make'],
  params: Object.fromEntries(Object.entries(plantPalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])) as DefInput['params'], palette: plantPalette,
  state: { moisture: { type: 'number', min: 0, max: 1, default: 0.1 } } as DefInput['state'],
  size: { box: [0.9, 0.9, 0.5] },
} as DefInput;

// Entry 21: a garden fountain whose valve stands on a post outside the rim at 1.2 m (at 1.05 m the reach solver knelt, visual-01). Still water
// fills the basin and the upper bowl either way; while it is on, a jet rises from the top into the bowl and the bowl spills
// into the basin (fx/water-jets.ts reads the two water surfaces for where the drops land).
const gardenFountain: DefInput = {
  schema: 'def/1', name: 'core-garden-fountain', version: 1,
  description: 'A stone garden fountain: a round basin, a pedestal and an upper bowl. A Soul turns it on and off by hand at the valve on the post beside it; while it is on a jet rises from the top and the bowl spills into the basin.',
  tags: ['water', 'garden', 'fountain', 'hand-operated', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.02, shapes: [
    { kind: 'lathe', at: [0, 0, 0], profile: [[1.1, 0], [1.15, 0.08], [1.15, 0.48], [1.0, 0.52], [1.0, 0.15], [0, 0.15]], segments: 24, tint: 'stone', collide: true },
    { kind: 'cyl', at: [0, 0.42, 0], r: 1.0, h: 0.03, segments: 24, tint: 'water', material: 'water' },
    { kind: 'cyl', at: [0, 0.75, 0], r: 0.14, h: 0.7, segments: 12, r2: 0.1, tint: 'stone' },
    { kind: 'lathe', at: [0, 1.0, 0], profile: [[0, 0], [0.5, 0.2], [0.47, 0.24], [0, 0.1]], segments: 20, tint: 'stone' },
    { kind: 'cyl', at: [0, 1.18, 0], r: 0.45, h: 0.02, segments: 20, tint: 'water', material: 'water' },
    { kind: 'cyl', at: [0, 1.3, 0], r: 0.04, h: 0.2, segments: 8, tint: 'stone' },
    { kind: 'cyl', at: [0, 1.405, 0], r: 0.022, h: 0.012, segments: 8, tint: 'nozzle' },
    { kind: 'box', at: [1.27, 0.1, 0], size: [0.24, 0.04, 0.04], round: 0.01, tint: 'metal' },
    { kind: 'box', at: [1.37, 0.585, 0], size: [0.07, 1.17, 0.07], round: 0.01, tint: 'metal' },
    { kind: 'cyl', at: [1.37, 1.2, 0], r: 0.05, h: 0.025, segments: 6, tint: 'valve' }] } } as unknown as DefInput['make'],
  params: params as DefInput['params'], palette: { ...palette, stone: '#b6afa2' },
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: water('water', 12, 0.45) as DefInput['components'],
  size: { box: [2.9, 1.45, 2.3] },   // the basin and the valve post, so the stand point is beside the post, off the rim
  actions: switches('Turn on the fountain', 'Turn off the fountain') as DefInput['actions'],
} as DefInput;

// #494 / #416: v1 above is immutable (worlds keep its geometry); v2 fits the 400-triangle kit budget with v1's state,
// sound, actions and size, and the same valve, nozzle and water surfaces (fx/water-jets.ts reads where the jet starts and
// where the drops land, so neither moves). The basin and bowl turn with 12 sides instead of 20-24, the basin's foot
// bevel is dropped, the upper bowl is a stone cup under its water, and the pipe and valve post are square-edged.
const gardenFountain2: DefInput = { ...structuredClone(gardenFountain), version: 2,
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.02, shapes: [
    { kind: 'lathe', at: [0, 0, 0], profile: [[1.15, 0], [1.15, 0.48], [1.0, 0.52], [1.0, 0.15], [0, 0.15]], segments: 12, tint: 'stone', collide: true },
    { kind: 'cyl', at: [0, 0.42, 0], r: 1.0, h: 0.03, segments: 12, tint: 'water', material: 'water' },
    { kind: 'cyl', at: [0, 0.75, 0], r: 0.14, h: 0.7, segments: 8, r2: 0.1, tint: 'stone' },
    { kind: 'cyl', at: [0, 1.085, 0], r: 0.1, r2: 0.5, h: 0.17, segments: 12, tint: 'stone' },
    { kind: 'cyl', at: [0, 1.18, 0], r: 0.45, h: 0.02, segments: 12, tint: 'water', material: 'water' },
    { kind: 'cyl', at: [0, 1.3, 0], r: 0.04, h: 0.2, segments: 6, tint: 'stone' },
    { kind: 'cyl', at: [0, 1.405, 0], r: 0.022, h: 0.012, segments: 6, tint: 'nozzle' },
    { kind: 'box', at: [1.27, 0.1, 0], size: [0.24, 0.04, 0.04], round: 0, tint: 'metal' },
    { kind: 'box', at: [1.37, 0.585, 0], size: [0.07, 1.17, 0.07], round: 0, tint: 'metal' },
    { kind: 'cyl', at: [1.37, 1.2, 0], r: 0.05, h: 0.025, segments: 6, tint: 'valve' }] } } as unknown as DefInput['make'],
} as DefInput;

export const HAND_WATER: DefInput[] = [gardenTap, beachShower, gardenSprinkler, gardenPlanter, gardenFountain, gardenFountain2];
