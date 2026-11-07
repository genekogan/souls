// Garden family (#438) W085 and W086: picking from a growing planter (core-garden-planter@2) into a vessel held in one
// hand. A harvest basket takes the ripe tomatoes from a fruiting planter (it goes back to flowering); a vase takes a bunch
// of flowers from a flowering one (it goes back to leafy). The planter grows again through the daily pass (entry 34).
// Both use one faculty (apps/server/src/god/harvest.ts); what differs is data: the row of HARVEST below and the def.
import type { DefInput } from '../schemas.ts';
import { GROWTH_STAGES } from './watering-can.ts';

/** A vessel's harvest: the planter stage it picks from and the stage it leaves, its state field, how many one pick takes,
 *  how many it holds, the plain word for what it holds, and where on the planter (def-local, x across the bed, y up) the
 *  free hand closes. Planter@2 draws a tomato in the middle of the bed and a cosmos at each end (fx/plant-growth.ts). */
export type Harvest = { from: (typeof GROWTH_STAGES)[number]; leaves: (typeof GROWTH_STAGES)[number]; field: string; take: number; holds: number; word: string; reach: { x: number; y: number }[] };
export const HARVEST: Record<string, Harvest> = {
  'core-harvest-basket': { from: 'fruiting', leaves: 'flowering', field: 'fruit', take: 3, holds: 6, word: 'tomatoes', reach: [{ x: 0.01, y: 0.56 }] },
  'core-flower-vase': { from: 'flowering', leaves: 'leafy', field: 'flowers', take: 3, holds: 3, word: 'flowers', reach: [{ x: -0.26, y: 0.66 }, { x: 0.27, y: 0.66 }] },
};
export const harvestOf = (def: { name?: string; tags?: readonly string[] } | undefined): Harvest | null => (def?.name && def.tags?.includes('harvest') ? HARVEST[def.name] ?? null : null);
/** The basket's handle grip (the crown of its arched handle); the def's origin is right under it. */
export const BASKET_GRIP: [number, number, number] = [0, 0.305, 0];

const basketPalette = { wicker: '#b98a4e', band: '#8a6235', fruit: '#d8452f' };
// six tomatoes: four on the bottom, two on top; tomato k shows once the basket holds k
const TOMATOES: [number, number, number][] = [[0.065, 0.046, 0.035], [-0.065, 0.046, -0.035], [0.02, 0.046, -0.07], [-0.02, 0.046, 0.07], [0.03, 0.1, 0.0], [-0.035, 0.1, 0.01]];
const basket: DefInput = {
  schema: 'def/1', name: 'core-harvest-basket', version: 1,
  description: 'A round wicker harvest basket with an arched handle. Carried by the handle, it holds the tomatoes picked from a fruiting garden planter, up to six, until they are taken out.',
  tags: ['garden', 'kitchen', 'item', 'basket', 'harvest', 'container', 'recorded-item'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.006, shapes: [
    // the woven bowl, open at the top, and a band at its rim
    { kind: 'lathe', at: [0, 0, 0], profile: [[0, 0], [0.13, 0], [0.155, 0.04], [0.16, 0.15], [0.148, 0.15], [0.12, 0.012]], segments: 10, tint: 'wicker' },
    { kind: 'cyl', at: [0, 0.147, 0], r: 0.163, h: 0.014, segments: 10, tint: 'band' },
    // the arched handle across the top: its crown is the grip
    { kind: 'torus', at: [0, 0.15, 0], r: 0.155, r2: 0.009, segments: 6, arc: Math.PI, tint: 'band' },
    ...TOMATOES.map((at, i) => ({ kind: 'sphere', at, r: 0.032, segments: 5, tint: 'fruit', when: `@fruit>=${i + 1}` }))] } } as unknown as DefInput['make'],
  params: Object.fromEntries(Object.entries(basketPalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])) as DefInput['params'], palette: basketPalette,
  // fruit: the tomatoes in it (a whole number)
  state: { fruit: { type: 'number', min: 0, max: 6, default: 0 } } as DefInput['state'],
  components: { carryable: { mass: 0.6, grips: 1 }, container: { capacity: 1 } } as DefInput['components'],
  slots: [{ id: 'handle', kind: 'carry', p: BASKET_GRIP, yaw: 0 }] as DefInput['slots'],
  size: { box: [0.33, 0.31, 0.33] },
  actions: [{ name: 'harvest', label: 'Pick the ripe tomatoes into the basket', params: { from: { type: 'string', max: 48, default: '', doc: 'the planter to pick from, by its name; the nearest ripe one when empty' } }, then: [{ op: 'increment', field: 'fruit', by: 3 }] }] as DefInput['actions'],
} as unknown as DefInput;

const vasePalette = { glaze: '#5f86a6', mouth: '#2b2f33', stem: '#5a8636', petal: '#f39ac0', eye: '#e9b52c' };
// three stems fanned out of the mouth (rolled about z, the middle one leaning forward); a cosmos flower at each tip
const STEM_H = 0.3, STEM_BASE = 0.12;
const STEMS = [{ roll: 0.32, pitch: 0 }, { roll: 0, pitch: 0.18 }, { roll: -0.3, pitch: 0 }];
const tip = (s: { roll: number; pitch: number }, l: number): [number, number, number] => [-Math.sin(s.roll) * l, STEM_BASE + Math.cos(s.roll) * Math.cos(s.pitch) * l, Math.sin(s.pitch) * l];
const vase: DefInput = {
  schema: 'def/1', name: 'core-flower-vase', version: 1,
  description: 'A glazed flower vase. Held in one hand, it takes a bunch of flowers picked from a flowering garden planter, and keeps them, set on a table or carried, until they are taken out.',
  tags: ['kitchen', 'item', 'vase', 'flowers', 'harvest', 'container', 'recorded-item'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.006, shapes: [
    { kind: 'lathe', at: [0, 0, 0], profile: [[0, 0], [0.05, 0], [0.06, 0.06], [0.045, 0.17], [0.03, 0.2], [0.036, 0.22], [0, 0.22]], segments: 10, tint: 'glaze' },
    { kind: 'cyl', at: [0, 0.2205, 0], r: 0.029, h: 0.002, segments: 10, tint: 'mouth' },
    ...STEMS.map((s) => ({ kind: 'cyl', at: tip(s, STEM_H / 2), r: 0.0035, h: STEM_H, segments: 4, tint: 'stem', roll: s.roll, pitch: s.pitch, when: '@flowers>=3' })),
    ...STEMS.map((s) => ({ kind: 'cyl', at: tip(s, STEM_H), r: 0.032, h: 0.005, segments: 8, tint: 'petal', roll: s.roll, pitch: s.pitch, when: '@flowers>=3' })),
    ...STEMS.map((s) => ({ kind: 'cyl', at: tip(s, STEM_H + 0.004), r: 0.009, h: 0.008, segments: 6, tint: 'eye', roll: s.roll, pitch: s.pitch, when: '@flowers>=3' }))] } } as unknown as DefInput['make'],
  params: Object.fromEntries(Object.entries(vasePalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])) as DefInput['params'], palette: vasePalette,
  // flowers: the stems in it (a whole number; one bunch is three)
  state: { flowers: { type: 'number', min: 0, max: 3, default: 0 } } as DefInput['state'],
  components: { carryable: { mass: 0.5, grips: 1 }, container: { capacity: 1 } } as DefInput['components'],
  size: { box: [0.12, 0.22, 0.12] },
  actions: [{ name: 'harvest', label: 'Pick flowers for the vase', params: { from: { type: 'string', max: 48, default: '', doc: 'the planter to pick from, by its name; the nearest ripe one when empty' } }, then: [{ op: 'increment', field: 'flowers', by: 3 }] }] as DefInput['actions'],
} as unknown as DefInput;

export const HARVEST_DEFS: DefInput[] = [basket, vase];
