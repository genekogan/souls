// Soul Actions entry 43: making tea. An electric kettle held by its handle (entry 34's handle-held vessel: filled under a
// tap with the free hand on the valve, tilted to pour), a mug with a tea bag that holds tea, and a camp sink whose tap is
// high enough to fill a kettle standing. Opt-in revisions: kettle@1 and cup@1 keep their bytes.
//
// The kettle's heat is a pure function of world time: switching it on records only the engine tick of the switch
// contact (`heatTick`); cold / heating / boiling / hot follow from that tick and the tick now (`kettleHeat`). Nothing is
// scheduled or committed at the boil, and no tick visits a kettle. Server perception and the viewer read the same function.
import vocab from './vocab.json' with { type: 'json' };
import type { DefInput } from '../schemas.ts';

/** Kettle-local points (x forward along the spout, y up, z right of the spout; origin at the base centre). */
export const KETTLE_GRIP: [number, number, number] = [-0.135, 0.15, 0];
/** The lid opening the tap's water goes in, the spout tip the tea water leaves, the switch the thumb presses. */
export const KETTLE_OPENING: [number, number, number] = [0.0, 0.232, 0];
export const KETTLE_SPOUT: [number, number, number] = [0.268, 0.196, 0];
/** The spout's own direction above the kettle's base line (rad): the stream leaves along it, tipped by the pour. */
export const KETTLE_SPOUT_ANGLE = 38 * Math.PI / 180;
export const KETTLE_SWITCH: [number, number, number] = [-0.118, 0.236, 0];
/** Litres a full kettle holds; one cup takes CUP_LITRES of it. */
export const KETTLE_LITRES = 1.2, CUP_LITRES = 0.25;
/** The mug's rim (radius, height above its base) and the height the tea reaches in a full cup. */
export const CUP_RIM = { r: 0.04, h: 0.1, full: 0.088, floor: 0.014 } as const;
/** Entry 44: the drawn tea levels [shown while tea > x, drawn at the height of tea t]: thirds as it is poured, fifths as
 *  it is drunk (a full cup, 0.8, 2/3, 0.6, 0.4, 1/3, 0.2). */
export const TEA_STEPS: [number, number][] = [[0.9, 1], [0.75, 0.8], [0.62, 2 / 3], [0.5, 0.6], [0.36, 0.4], [0.25, 1 / 3], [0.05, 0.2]];

/** Heating clock (s): it heats for HEAT, boils for BOIL, then switches itself off and stays hot for HOT. */
export const KETTLE_CLOCK = { heat: 24, boil: 5, hot: 300 } as const;
export type KettlePhase = 'empty' | 'cold' | 'heating' | 'boiling' | 'hot';
/** The kettle's heat at engine tick `tick` (dt s per tick): a pure function of its state and world time.
 *  `temp` 0 (cold) .. 1 (boiling); `steam` 0..1 (the visible plume); `on` while the switch is down (heating, boiling). */
export function kettleHeat(state: Record<string, unknown> | undefined, tick: number, dt = 0.05): { phase: KettlePhase; temp: number; steam: number; on: boolean; seconds: number; boilsIn: number } {
  const level = typeof state?.level === 'number' ? state.level : 0, at = typeof state?.heatTick === 'number' ? state.heatTick : -1;
  const s = at >= 0 && Number.isFinite(tick) ? Math.max(0, (tick - at) * dt) : -1, C = KETTLE_CLOCK;
  if (level <= 0.02) return { phase: 'empty', temp: 0, steam: 0, on: false, seconds: s, boilsIn: Infinity };
  if (s < 0) return { phase: 'cold', temp: 0, steam: 0, on: false, seconds: s, boilsIn: Infinity };
  if (s < C.heat) { const k = s / C.heat; return { phase: 'heating', temp: k, steam: k < 0.35 ? 0 : 0.45 * ((k - 0.35) / 0.65) ** 1.6, on: true, seconds: s, boilsIn: C.heat - s }; }
  if (s < C.heat + C.boil) return { phase: 'boiling', temp: 1, steam: Math.min(1, 0.45 + (s - C.heat) / 1.2), on: true, seconds: s, boilsIn: 0 };
  const after = s - C.heat - C.boil;
  if (after < C.hot) { const k = after / C.hot; return { phase: 'hot', temp: 1 - 0.3 * k, steam: 0.9 * Math.exp(-after / 6) + 0.08 * (1 - k), on: false, seconds: s, boilsIn: 0 }; }
  return { phase: 'cold', temp: 0, steam: 0, on: false, seconds: s, boilsIn: Infinity };
}
/** A kettle's stream leaves the spout tip along the spout at this speed (m/s): the server plans the pour with it and the
 *  viewer draws the stream with it, so the planned and the drawn landing agree. */
export const SPOUT_SPEED = 0.55;
/** The stream's speed at flow `flow` (0..1): a dribble as the water first reaches the spout, the full stream once tipped. */
export const spoutSpeed = (flow: number) => SPOUT_SPEED * (0.35 + 0.65 * Math.max(0, Math.min(1, flow)));
/** Where a spout stream leaving at elevation `el` (rad, above the horizontal) lands `drop` m lower: its horizontal run (m). */
export function spoutRun(el: number, drop: number, v = SPOUT_SPEED) { const vy = v * Math.sin(el), t = (vy + Math.sqrt(vy * vy + 2 * 9.8 * Math.max(0, drop))) / 9.8; return v * Math.cos(el) * t; }
/** A cup of tea steams for this long after it was poured (s). */
export const CUP_STEAM_SECONDS = 240;
/** The cup's visible steam at `tick` (0..1): strongest just poured, gone after CUP_STEAM_SECONDS. */
export function cupSteam(state: Record<string, unknown> | undefined, tick: number, dt = 0.05): number {
  const tea = typeof state?.tea === 'number' ? state.tea : 0, at = typeof state?.brewedTick === 'number' ? state.brewedTick : -1;
  if (tea <= 0.05 || at < 0 || !Number.isFinite(tick)) return 0;
  const s = (tick - at) * dt; return s < 0 || s > CUP_STEAM_SECONDS ? 0 : 0.6 * (1 - s / CUP_STEAM_SECONDS) ** 1.5;
}
/** Plain-word state of a kettle for nearby perception ("the kettle is boiling"). */
export const kettleWord = (p: KettlePhase) => p;

/** A vessel held by its handle and poured: where it is gripped, filled and poured from (def-local), and how it pours. */
export type Vessel = { grip: [number, number, number]; opening: [number, number, number]; outlet: [number, number, number]; outletAngle: number; pour: 'rose' | 'spout' };
export const isKettleDef = (def: { name?: string; version?: number; tags?: readonly string[]; slots?: readonly { kind: string }[] } | undefined) => !!def && !!def.tags?.includes('kettle') && !!def.slots?.some((s) => s.kind === 'carry');
export const isTeaCupDef = (def: { tags?: readonly string[]; state?: Record<string, unknown> } | undefined) => !!def && !!def.tags?.includes('tea-cup') && !!def.state?.tea;
/** #437 W078: what a `tea-cup` mug makes and holds, by its tags: 'coffee' for a coffee mug, otherwise 'tea'. Its words, refusals
 *  and nearby fact say this; its state fields stay the tea faculty's (`tea` is how full it is, `bag` the unused brew in it). */
export const cupDrink = (def: { tags?: readonly string[] } | undefined): 'tea' | 'coffee' => def?.tags?.includes('coffee') ? 'coffee' : 'tea';

const kettlePalette = { shell: '#e6dfcf', steel: '#b9bfc3', dark: '#2f2b29', switch: '#d0621f' };
const kettle: DefInput = {
  schema: 'def/1', name: 'core-kettle', version: 2,
  description: `An electric kettle (${KETTLE_LITRES} L) with a lid, a spout and a handle with its switch on top. Filled at a tap and switched on, it heats, boils and switches itself off; tilted by the handle, it pours.`,
  tags: ['kitchen', 'item', 'kettle', 'tea', 'object'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.006, shapes: [
    // the jug: a cream enamel body on a dark foot, narrowing to the lid
    { kind: 'lathe', at: [0, 0, 0], profile: [[0, 0.012], [0.084, 0.012], [0.09, 0.03], [0.092, 0.07], [0.088, 0.16], [0.078, 0.21], [0.062, 0.226], [0, 0.229]], segments: 20, tint: 'shell' },
    { kind: 'cyl', at: [0, 0.007, 0], r: 0.086, h: 0.014, segments: 20, tint: 'dark' },
    // the lid and its knob
    { kind: 'cyl', at: [0, 0.229, 0], r: 0.058, h: 0.006, segments: 16, tint: 'steel' },
    { kind: 'sphere', at: [0, 0.242, 0], r: 0.014, segments: 8, tint: 'dark' },
    // the spout from low on the front, up and out to its tip (38° above the base line)
    { kind: 'sweep', at: [0, 0, 0], path: [[0.082, 0.11, 0], [0.14, 0.13, 0], [0.205, 0.158, 0], [0.262, 0.192, 0]], r: 0.016, segments: 7, tint: 'shell' },
    { kind: 'cyl', at: [KETTLE_SPOUT[0], KETTLE_SPOUT[1], 0], r: 0.013, h: 0.006, segments: 8, tint: 'steel', roll: -(Math.PI / 2 - KETTLE_SPOUT_ANGLE) },
    // the handle: a dark loop at the back, gripped in the middle of its upright
    { kind: 'sweep', at: [0, 0, 0], path: [[-0.07, 0.212, 0], [-0.118, 0.222, 0], [-0.137, 0.19, 0], [-0.137, 0.11, 0], [-0.118, 0.07, 0], [-0.084, 0.06, 0]], r: 0.013, segments: 6, tint: 'dark' },
    // the switch on top of the handle, under the thumb
    { kind: 'box', at: [KETTLE_SWITCH[0], KETTLE_SWITCH[1], 0], size: [0.03, 0.012, 0.02], round: 0.004, tint: 'switch' }] } } as unknown as DefInput['make'],
  params: { ...Object.fromEntries(Object.entries(kettlePalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])), litres: { type: 'number', min: 0.5, max: 3, default: KETTLE_LITRES, doc: 'litres it holds' } } as DefInput['params'], palette: kettlePalette,
  // level: water in it (0..1); heatTick: the engine tick its switch was pressed (−1: not switched on since it was filled)
  state: { level: { type: 'number', min: 0, max: 1, default: 0 }, heatTick: { type: 'number', min: -1, max: 1e12, default: -1 } } as DefInput['state'],
  // the kettle's own voice (viewer): it rises while it heats, rolls at the boil and clicks off (sound.ts `kettle`); `heating`
  // is derived from `heatTick` and the depicted tick by kettleHeat, never stored
  components: { carryable: { mass: 1.1, grips: 1 }, container: { capacity: 1 }, sound: { kind: 'kettle', radius: 10, volume: 0.55, when: 'heating', mode: 'loop', also: [{ kind: 'kettle', radius: 9, volume: 0.6, when: 'kettleSwitch', mode: 'change' }] } } as DefInput['components'],
  slots: [{ id: 'handle', kind: 'carry', p: KETTLE_GRIP, yaw: 0 }] as DefInput['slots'],
  size: { box: [0.56, 0.26, 0.2] },
  actions: [
    { name: 'fill', label: 'Fill the kettle', then: [{ op: 'set', field: 'level', value: 1 }] },
    { name: 'boil', label: 'Put the kettle on', then: [{ op: 'set', field: 'heatTick', value: 0 }] },
    { name: 'pour', label: 'Pour the tea', then: [{ op: 'set', field: 'level', value: 0 }] },
  ] as DefInput['actions'],
} as unknown as DefInput;

const cupPalette = { glaze: '#e8e2d6', inside: '#d9d1c2', tea: '#7a4b26', string: '#f2efe6', tag: '#c9a24a', stain: '#9c7a58', bag: '#a8865e' };
const cup: DefInput = {
  schema: 'def/1', name: 'core-cup', version: 2,
  description: 'A mug with a handle and a tea bag in it. Boiling water poured in makes a cup of tea that stays in it, carried or set down, until it is drunk, sip by sip. Rinsed at a tap it is clean again.',
  tags: ['kitchen', 'item', 'cup', 'mug', 'tea', 'container', 'tea-cup', 'recorded-item'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.006, shapes: [
    { kind: 'lathe', at: [0, 0, 0], profile: [[0, 0], [0.038, 0], [0.042, 0.006], [0.044, 0.1], [0.04, 0.1], [0.038, 0.014], [0, 0.014]], segments: 18, tint: 'glaze' },
    { kind: 'torus', at: [0.05, 0.055, 0], r: 0.024, r2: 0.0065, segments: 10, tint: 'glaze' },
    // the tea's surface at its level: poured in thirds, drunk in fifths (entry 44); each step is drawn at the height of the
    // tea it stands for (a level shows while the tea is above the step under it), a full cup just under the rim
    ...TEA_STEPS.map(([when, tea]) => ({ kind: 'cyl', at: [0, CUP_RIM.floor + (CUP_RIM.full - CUP_RIM.floor) * tea, 0], r: 0.038 + 0.0015 * tea, h: 0.003, segments: 18, tint: 'tea', when: `@tea>${when}` })),
    // entry 44: drunk, the mug keeps a tea stain at the bottom and the spent bag until it is washed
    { kind: 'cyl', at: [0, CUP_RIM.floor + 0.001, 0], r: 0.036, h: 0.002, segments: 18, tint: 'stain', when: '@tea<=0.05&@brewedTick>=0' },
    { kind: 'box', at: [0.006, CUP_RIM.floor + 0.008, -0.01], size: [0.034, 0.012, 0.026], round: 0.004, tint: 'bag', when: '!@bag=false&@brewedTick>=0&@tea<=0.4' },
    // the tea bag's string over the rim and its paper tag outside (gone once the mug is washed)
    { kind: 'sweep', at: [0, 0, 0], path: [[0.008, 0.03, -0.012], [0.02, 0.085, -0.03], [0.012, 0.104, -0.044], [0.006, 0.09, -0.05]], r: 0.0012, segments: 4, tint: 'string', when: '!@bag=false' },
    { kind: 'box', at: [0.006, 0.074, -0.051], size: [0.02, 0.026, 0.003], round: 0, tint: 'tag', when: '!@bag=false' }] } } as unknown as DefInput['make'],
  params: Object.fromEntries(Object.entries(cupPalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])) as DefInput['params'], palette: cupPalette,
  // tea: how full it is (0..1 of a cup); brewedTick: the engine tick it was poured (its steam fades from there; −1 = never,
  // or washed since); bag: a tea bag in it (entry 44: washing takes the spent bag out)
  state: { tea: { type: 'number', min: 0, max: 1, default: 0 }, brewedTick: { type: 'number', min: -1, max: 1e12, default: -1 }, bag: { type: 'bool', default: true } } as DefInput['state'],
  components: { carryable: { mass: 0.35, grips: 1 }, container: { capacity: 1 } } as DefInput['components'],
  size: { box: [0.13, 0.1, 0.09] },
  actions: [{ name: 'brew', label: 'Make a cup of tea', then: [{ op: 'set', field: 'tea', value: 1 }] },
    { name: 'drink', label: 'Drink the tea', then: [{ op: 'set', field: 'tea', value: 0 }] },
    { name: 'sip', label: 'Take a sip of the tea', then: [{ op: 'set', field: 'tea', value: 0 }] },
    { name: 'wash', label: 'Wash the cup', then: [{ op: 'set', field: 'tea', value: 0 }] }] as DefInput['actions'],
} as unknown as DefInput;

// A camp sink: a basin on a stand with a tall standpipe. Its spout is high enough to hold a kettle under it standing (a
// garden tap's 0.8 m spout would put the kettle's lid at the knees). The valve is entry 28's 1.14 m.
const sinkPalette = { metal: '#8d9499', valve: '#b8322a', nozzle: '#6f767b', wood: '#8a6a4a', basin: '#c9ccc8', water: '#bfe3f2' };
const campSink: DefInput = {
  schema: 'def/1', name: 'core-camp-sink', version: 1,
  description: 'A camp sink: an enamel basin on a wooden stand with a standpipe and a tap. A Soul turns it on and off by hand; water runs into the basin, or into a kettle held under it.',
  tags: ['water', 'kitchen', 'tap', 'sink', 'hand-operated', 'local-fixture'], form: 'point',
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'box', at: [0, 0.56, -0.02], size: [0.08, 1.12, 0.08], round: 0.01, tint: 'metal' },
    { kind: 'cyl', at: [0, 1.0, 0.07], r: 0.02, h: 0.14, segments: 8, tint: 'metal', pitch: Math.PI / 2 },
    { kind: 'cyl', at: [0, 1.14, 0.0], r: 0.045, h: 0.02, segments: 6, tint: 'valve' },
    { kind: 'cyl', at: [0, 0.995, 0.15], r: 0.016, h: 0.02, segments: 6, tint: 'nozzle' },
    // the stand and its basin (low enough that a kettle held under the spout clears it), the stream falls 0.34 m into it
    { kind: 'box', at: [0, 0.31, 0.22], size: [0.38, 0.62, 0.36], round: 0.01, tint: 'wood' },
    { kind: 'cyl', at: [0, 0.63, 0.22], r: 0.175, h: 0.03, segments: 16, tint: 'basin' },
    { kind: 'cyl', at: [0, 0.652, 0.22], r: 0.15, h: 0.006, segments: 16, tint: 'water', material: 'water', when: '@on' }] } } as unknown as DefInput['make'],
  params: { ...Object.fromEntries(Object.entries(sinkPalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])), basinHeight: { type: 'number', min: 0, max: 2, default: 0.655, doc: 'where the stream lands when nothing is under it' } } as DefInput['params'], palette: sinkPalette,
  state: { on: { type: 'bool', default: false } } as DefInput['state'],
  components: { sound: { kind: 'water', radius: 8, volume: 0.35, when: 'on', mode: 'loop' } } as DefInput['components'],
  size: { box: [0.4, 1.16, 0.88] },
  actions: (vocab.find((d) => d.name === 'core-desk-lamp')! as unknown as DefInput).actions!.map((a) => ({ ...structuredClone(a), label: a.name === 'switch-on' ? 'Turn on the sink tap' : 'Turn off the sink tap' })) as DefInput['actions'],
} as unknown as DefInput;

// #437 W078: a coffee mug. The tea mug's faculty with data only (the `tea-cup` tag, its state, rim and body): a
// spoonful of ground coffee at the bottom where the tea mug has its bag, made into coffee by the kettle's hot water, drunk
// in sips and rinsed clean the same way. The `coffee` tag names what it holds (cupDrink), so its words and facts say coffee.
const coffeePalette = { glaze: '#33506e', coffee: '#3b2416', grounds: '#4a3020' };
// within the 400-triangle item budget (#416, #494; 376, about a third of the tea mug): the body and the coffee's discs at
// eight sides, the handle at six; the coffee drawn at five levels, one per sip (1, 0.8 .. 0.2; a third poured shows as
// 0.4, two thirds as 0.6), and one disc of grounds on the floor of the mug: the unbrewed spoonful before the pour, the
// dregs once drunk, gone once rinsed (the tea mug's bag, stain and string in one). Rim, floor and levels are CUP_RIM's.
const SEG = { lathe: 8, torus: 6 } as Record<string, number>;
const COFFEE_STEPS: [number, number][] = [[0.9, 1], [0.7, 0.8], [0.5, 0.6], [0.3, 0.4], [0.05, 0.2]];
/** A flat disc facing up (a one-band lathe drawn inward), on the mug body's own sides. */
const disc = (y: number, r: number, tint: string, when: string) => ({ kind: 'lathe', at: [0, 0, 0], profile: [[r, y], [0, y]], segments: SEG.lathe, tint, when });
const cupShapes = (cup.make as unknown as { args: { shapes: { kind: string; tint: string; when?: string }[] } }).args.shapes;
const coffeeMug: DefInput = {
  ...structuredClone(cup), name: 'core-coffee-mug', version: 1,
  description: 'A mug with a spoonful of ground coffee in it. Boiling water poured in makes a cup of coffee that stays in it, carried or set down, until it is drunk, sip by sip. Rinsed at a tap it is clean again.',
  tags: ['kitchen', 'item', 'cup', 'mug', 'coffee', 'container', 'tea-cup', 'recorded-item'],
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.006, shapes: [
    // the tea mug's body and handle; the coffee's levels; the grounds where the tea mug has its bag
    ...cupShapes.filter((sh) => sh.tint === 'glaze').map((sh) => ({ ...structuredClone(sh), segments: SEG[sh.kind] })),
    ...COFFEE_STEPS.map(([when, tea]) => disc(CUP_RIM.floor + (CUP_RIM.full - CUP_RIM.floor) * tea, 0.038 + 0.0015 * tea, 'coffee', `@tea>${when}`)),
    disc(CUP_RIM.floor + 0.001, 0.036, 'grounds', '!@bag=false&@tea<=0.05')] } } as unknown as DefInput['make'],
  params: Object.fromEntries(Object.entries(coffeePalette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])) as DefInput['params'], palette: coffeePalette,
  actions: [{ name: 'brew', label: 'Make a cup of coffee', then: [{ op: 'set', field: 'tea', value: 1 }] },
    { name: 'drink', label: 'Drink the coffee', then: [{ op: 'set', field: 'tea', value: 0 }] },
    { name: 'sip', label: 'Take a sip of the coffee', then: [{ op: 'set', field: 'tea', value: 0 }] },
    { name: 'wash', label: 'Wash the coffee mug', then: [{ op: 'set', field: 'tea', value: 0 }] }] as DefInput['actions'],
} as unknown as DefInput;

export const TEA_DEFS: DefInput[] = [kettle, cup, campSink, coffeeMug];
