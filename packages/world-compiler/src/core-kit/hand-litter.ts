// #1088 (W065, #434): litter, and bins a Soul puts it in by hand. Entry 42's container faculty with data only: new
// revisions of the street bins, open at the top with places down inside at the level of the rubbish already in them,
// reached over the rim as the hollow stump is (#435). Their frozen predecessors keep their bytes. The places stand 0.6 m
// clear of the footprint, as every storage def does since the turns test (tools/soul-actions/container-turns.test.mjs).
import props from './props.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

const shelf = (id: string, p: number[], label: string) => ({ id, kind: 'shelf', p, yaw: 0, accepts: {}, capacity: 1, label });
const box = (at: number[], size: number[], tint: string) => ({ kind: 'box', at, size, round: 0, tint });
const v1 = (name: string) => structuredClone(props.find((d) => d.name === name)!) as unknown as DefInput;

// The round bin: 0.78 m tall, 0.21 m at the foot to 0.24 m at the top. The rubbish already in it fills it to 0.55 m.
const BIN_TOP = 0.78, BIN_R = 0.24, BIN_FILL = 0.55;
const round = v1('core-bin');
const bin: DefInput = {
  ...round, version: 2,
  description: 'A green litter bin with a brass band, open at the top. A Soul drops litter in over the rim, up to three small things (each up to 0.14 m across); nearby you see what is in it.',
  tags: [...(round.tags ?? []), 'hand-operated', 'storage-inside'], synonyms: ['bin', 'litter bin', 'rubbish bin', 'trash can', 'waste bin'],
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.015, shapes: [
    { kind: 'lathe', at: [0, 0, 0], profile: [[0, 0], [0.21, 0], [BIN_R, BIN_TOP], [BIN_R + 0.015, BIN_TOP + 0.02], [BIN_R - 0.01, BIN_TOP + 0.03], [BIN_R - 0.02, BIN_TOP], [BIN_R - 0.035, BIN_FILL], [0, BIN_FILL]], segments: 12, tint: 'body', collide: true },
    { kind: 'lathe', at: [0, 0, 0], profile: [[BIN_R - 0.036, BIN_FILL + 0.002], [0, BIN_FILL + 0.004]], segments: 12, tint: 'rubbish' },
    { kind: 'lathe', at: [0, 0, 0], profile: [[0.231, 0.58], [0.238, 0.6], [0.233, 0.62]], segments: 12, tint: 'band' },
  ] } } as unknown as DefInput['make'],
  params: { ...round.params, rubbish: { type: 'color', default: '#3a3328', doc: 'colour of the rubbish inside' } } as DefInput['params'],
  palette: { ...round.palette, rubbish: '#3a3328' },
  slots: [shelf('in-1', [-0.07, BIN_FILL, 0.06], 'bin'), shelf('in-2', [0.07, BIN_FILL, 0.06], 'bin'), shelf('in-3', [0, BIN_FILL, -0.08], 'bin')] as DefInput['slots'],
  components: { container: { capacity: 3, inside: { lip: BIN_TOP + 0.03, face: BIN_R + 0.015, stand: [0, BIN_R + 0.015 + 0.6], fit: [0.14, 0.12, 0.14], word: 'bin' } } } as DefInput['components'],
  size: { box: [(BIN_R + 0.015) * 2, BIN_TOP + 0.03, (BIN_R + 0.015) * 2] },
} as DefInput;

// The wheelie bin: its lid stands open at the back; the rubbish in it comes up to 0.62 m. Reached over the front rim from
// 0.7 m clear of the front (0.6 m tripped a recovered engine fault in the turns test at r = 0).
const W = 0.53, D = 0.61, TOP = 0.935, WFILL = 0.62, T = 0.025;
const wheelie1 = v1('core-wheelie-bin');
const wheelie: DefInput = {
  ...wheelie1, version: 2,
  description: 'A wheeled rubbish bin with its lid standing open at the back. A Soul drops litter in over the front rim, up to three small things (each up to 0.16 m across); nearby you see what is in it.',
  tags: [...(wheelie1.tags ?? []), 'hand-operated', 'storage-inside'], synonyms: ['wheelie bin', 'rubbish bin', 'bin', 'dustbin'],
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    box([-W / 2 + T / 2, 0.065 + (TOP - 0.065) / 2, 0], [T, TOP - 0.065, D], 'body'), box([W / 2 - T / 2, 0.065 + (TOP - 0.065) / 2, 0], [T, TOP - 0.065, D], 'body'),
    box([0, 0.065 + (TOP - 0.065) / 2, D / 2 - T / 2], [W, TOP - 0.065, T], 'body'), box([0, 0.065 + (TOP - 0.065) / 2, -D / 2 + T / 2], [W, TOP - 0.065, T], 'body'),
    box([0, 0.08, 0], [W, 0.03, D], 'body'), box([0, WFILL, 0], [W - 2 * T, 0.01, D - 2 * T], 'rubbish'),
    box([0, TOP + 0.3, -D / 2 - 0.02], [W + 0.04, 0.62, 0.02], 'body'),
    { kind: 'cyl', at: [-0.25, 0.09, -0.3], r: 0.09, h: 0.05, segments: 8, tint: 'wheel', roll: Math.PI / 2 }, { kind: 'cyl', at: [0.25, 0.09, -0.3], r: 0.09, h: 0.05, segments: 8, tint: 'wheel', roll: Math.PI / 2 },
  ] } } as unknown as DefInput['make'],
  params: { ...wheelie1.params, rubbish: { type: 'color', default: '#2f2a22', doc: 'colour of the rubbish inside' } } as DefInput['params'],
  palette: { ...wheelie1.palette, rubbish: '#2f2a22' },
  slots: [shelf('in-1', [-0.12, WFILL + 0.005, 0.12], 'bin'), shelf('in-2', [0.12, WFILL + 0.005, 0.12], 'bin'), shelf('in-3', [0, WFILL + 0.005, 0], 'bin')] as DefInput['slots'],
  components: { container: { capacity: 3, inside: { lip: TOP, face: D / 2, stand: [0, D / 2 + 0.7], fit: [0.16, 0.14, 0.16], word: 'bin' } } } as DefInput['components'],
  size: { box: [W + 0.04, TOP + 0.61, D + 0.05] },
} as DefInput;

// A crumpled paper wrapper: a piece of litter to pick up (vocab-w1's core-litter is a scatter on the ground, not a thing in hand).
const litter: DefInput = {
  schema: 'def/1', name: 'core-wrapper', version: 1,
  description: 'A crumpled paper wrapper someone dropped: litter, small enough to pick up in one hand and put in a bin.',
  tags: ['item', 'litter', 'rubbish', 'recorded-item'], synonyms: ['litter', 'wrapper', 'rubbish', 'paper', 'crumpled wrapper', 'trash'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.004, shapes: [
    { kind: 'sphere', at: [0, 0.026, 0], r: 0.03, segments: 5, tint: 'paper', scale: [1.1, 0.85, 0.95] },
    box([0.012, 0.042, 0.006], [0.03, 0.004, 0.024], 'print'), box([-0.016, 0.03, -0.012], [0.004, 0.022, 0.02], 'paper'),
  ] } } as unknown as DefInput['make'],
  params: { paper: { type: 'color', default: '#e8e1cf', doc: 'paper colour' }, print: { type: 'color', default: '#b5422f', doc: 'printed colour' } } as DefInput['params'],
  palette: { paper: '#e8e1cf', print: '#b5422f' },
  components: { carryable: { mass: 0.01, grips: 1 } } as DefInput['components'],
  size: { box: [0.07, 0.055, 0.06] },
} as unknown as DefInput;

export const HAND_LITTER: DefInput[] = [bin, wheelie, litter];
