// Soul Actions #442: things that break and the tools that repair them. Opt-in revisions: `core-bench@1` and `core-cart@1` keep
// their bytes and never break. All of the repair is data here (`components.repairable`, a `tool-<name>` tag on the tool).
import type { DefInput } from '../schemas.ts';
import props from './props.json' with { type: 'json' };
import transport from './transport.json' with { type: 'json' };

type Shape = Record<string, unknown> & { kind: string; at: number[]; tint?: string };
type Kit = { shapes: Shape[]; [k: string]: unknown };
const from = (defs: unknown[], name: string) => structuredClone(defs.find((d) => (d as { name?: string }).name === name)) as DefInput & { make: { args: Kit } };
const brokenState = { broken: { type: 'bool', default: false }, repairedBy: { type: 'string', max: 80, default: '' } };

/** The bench's front slat: whole, or cracked in two with its right half sagging to the rail. The hammer falls on the crack. */
const bench = from(props, 'core-bench');
{
  const shapes = bench.make.args.shapes, i = shapes.findIndex((s) => s.kind === 'extrude' && s.at[2] === 0.16 && s.tint === 'wood');
  const slat = shapes[i];
  shapes.splice(i, 1, { ...slat, when: '!@broken' },
    { kind: 'box', at: [-0.4, 0.44, 0.16], size: [0.77, 0.015, 0.1], round: 0, tint: 'wood', when: '@broken' },
    { kind: 'box', at: [0.38, 0.385, 0.16], size: [0.8, 0.015, 0.1], round: 0, tint: 'wood', roll: -0.14, when: '@broken' });
}
const BENCH: DefInput = {
  ...bench, version: 2,
  description: 'A park bench for two: wooden slats on cast-iron ends with a curved back. It can break (a cracked slat) and be repaired with a hammer.',
  state: { ...(bench.state ?? {}), ...brokenState } as DefInput['state'],
  components: { ...bench.components, repairable: { tool: 'hammer', label: 'Repair the cracked slat on the bench with a hammer', says: 'a cracked slat', hand: [0.12, 0.5, 0.42], stands: [[0, 0.8], [-0.3, 0.8], [0.3, 0.8]], strokes: 6, lift: 0.16, motion: 'strike' } } as DefInput['components'],
};

/** The cart's left wheel: whole, or flat, sunk on its rim. The pump works beside it. */
const cart = from(transport, 'core-cart');
{
  const shapes = cart.make.args.shapes, i = shapes.findIndex((s) => s.kind === 'cyl' && s.at[0] === -0.64);
  const wheel = shapes[i];
  shapes.splice(i, 1, { ...wheel, when: '!@broken' }, { ...wheel, at: [-0.64, 0.36, 0.1], scale: [1, 1, 0.86], when: '@broken' });
}
const CART: DefInput = {
  ...cart, version: 2,
  description: 'A two-wheeled wooden hand cart for hauling goods (a container). Its tyre can go flat and be pumped up.',
  state: { ...(cart.state ?? {}), ...brokenState } as DefInput['state'],
  components: { ...cart.components, repairable: { tool: 'pump', label: 'Pump up the flat tyre on the cart', says: 'a flat tyre', hand: [-0.95, 0.6, 0.02], stands: [[-1.3, 0.1], [-1.3, -0.3], [-1.3, 0.5]], strokes: 5, lift: 0.2, motion: 'pump' } } as DefInput['components'],
};

/** Carried by the end of the handle, the head out in front: local +x runs along the holder's facing. */
const HAMMER: DefInput = {
  schema: 'def/1', name: 'core-hammer', version: 1, description: 'A claw hammer (carryable; a Soul holding it can repair what a hammer repairs).',
  tags: ['tool', 'item', 'hammer', 'tool-hammer', 'recorded-item'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.004, shapes: [
    { kind: 'box', at: [0.13, 0.07, 0], size: [0.28, 0.024, 0.018], round: 0.004, tint: 'wood' },
    { kind: 'box', at: [0.27, 0.05, 0], size: [0.03, 0.1, 0.03], round: 0.004, tint: 'iron' }] } },
  params: { wood: { type: 'color', default: '#a47a4c', doc: 'handle colour' }, iron: { type: 'color', default: '#4a4f52', doc: 'head colour' } },
  palette: { wood: '#a47a4c', iron: '#4a4f52' },
  components: { carryable: { mass: 0.6, grips: 1 } }, layer: 'decor', size: { box: [0.3, 0.1, 0.03] },
} as unknown as DefInput;
const PUMP: DefInput = {
  schema: 'def/1', name: 'core-tyre-pump', version: 1, description: 'A hand tyre pump (carryable; a Soul holding it can pump up a flat tyre).',
  tags: ['tool', 'item', 'pump', 'tool-pump', 'recorded-item'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.004, shapes: [
    { kind: 'box', at: [0.17, 0.045, 0], size: [0.3, 0.035, 0.035], round: 0.006, tint: 'body' },
    { kind: 'box', at: [0.01, 0.045, 0], size: [0.03, 0.09, 0.02], round: 0.004, tint: 'grip' }] } },
  params: { body: { type: 'color', default: '#b23a32', doc: 'barrel colour' }, grip: { type: 'color', default: '#2b2b2b', doc: 'handle colour' } },
  palette: { body: '#b23a32', grip: '#2b2b2b' },
  components: { carryable: { mass: 0.5, grips: 1 } }, layer: 'decor', size: { box: [0.33, 0.09, 0.035] },
} as unknown as DefInput;

export const REPAIR_DEFS: DefInput[] = [BENCH, CART, HAMMER, PUMP];
