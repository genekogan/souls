// The universal catalogue (VOCAB-MECH): taxonomy, parameter conventions, interaction interfaces, lint, manifest,
// facets and recommend. Pure data + functions: the server (search, catalog, Soul actuators), the god CLI, the
// authoring DSL and the viewer's look all read the same rules. Guide for inducting types: docs/god/VOCAB.md.
//
// Nothing here changes how an existing def hashes: `category` and `synonyms` are optional def fields; a def without
// them gets an inferred category (inferCategory) so the 391 defs that predate the catalogue are findable by facet.
import taxonomyJson from './taxonomy.json' with { type: 'json' };
import type { DefInput, Action } from '../schemas.ts';
import type { Baked, FieldInput } from '@souls/generators';

// ------------------------------------------------------------------ taxonomy

export type TaxNode = { id: string; label: string; syn?: string[]; want?: string[]; via?: string };
export const TAXONOMY: TaxNode[] = (taxonomyJson as { nodes: TaxNode[] }).nodes;
export const CATEGORIES = new Map(TAXONOMY.map((n) => [n.id, n]));
export const CATEGORY_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$/;
/** True when `cat` is `id` or below it ("building" holds "building.commercial"). */
export const within = (cat: string, id: string) => cat === id || cat.startsWith(id + '.');

/** A def as the catalogue sees it (stored defs, public defs and inputs all fit). */
export type VocabDef = {
  name: string; ref?: string; description?: string; tags?: string[]; category?: string; synonyms?: string[];
  form?: 'point' | 'path' | 'area'; layer?: string;
  make: { kind: string; gen?: string; asset?: string; args?: unknown; parts?: { def: string }[] };
  params?: Record<string, FieldInput>; state?: Record<string, FieldInput>;
  slots?: { id: string; kind: string; capacity?: number }[]; components?: Record<string, unknown>; actions?: Pick<Action, 'name' | 'label'>[] | { name: string; label: string; when?: unknown[]; then?: unknown[] }[];
  size?: { box: [number, number, number]; scale?: [number, number] }; budget?: { tris: number; bytes: number }; hash?: string;
};

const T = (d: VocabDef) => new Set([...(d.tags ?? []), ...d.name.replace(/^core-/, '').split(/[-._]+/)]);
/** Ordered inference rules for defs without `category` (first match wins). Tags and name tokens both count. */
const RULES: [string, (t: Set<string>, d: VocabDef) => boolean][] = [
  ['layer.marker', (t, d) => t.has('marker') && d.make.kind === 'none'],
  ['furniture.kitchen', (t) => t.has('stove') || t.has('fridge') || t.has('sink') || t.has('hearth') || t.has('counter')],
  ['furniture.work', (t) => t.has('easel') || t.has('anvil') || t.has('workbench')],
  ['furniture.decor', (t) => t.has('rug') || t.has('carpet') || t.has('picture')],
  ['furniture.lighting', (t, d) => (t.has('lamp') || t.has('lantern')) && !!d.size && d.size.box[1] <= 2.5],
  ['object.container', (t) => t.has('crate') || t.has('barrel') || t.has('sack') || t.has('pallet')],
  ['object.tableware', (t) => t.has('cutting-board') || t.has('board') && t.has('kitchen')],
  ['living.group', (t) => t.has('herd') || t.has('flock') || t.has('creature-group') || t.has('animals')],
  ['living.character', (t) => t.has('character') || t.has('kin') || t.has('floater')],
  ['object.art', (t) => t.has('scan') || t.has('exhibit') || t.has('ceramic') || t.has('painting')],
  ['living.fish', (t) => t.has('fish') || t.has('koi')],
  ['living.bird', (t) => t.has('bird') || t.has('duck') || t.has('goose')],
  ['living.farm', (t) => t.has('livestock') || ['cow', 'sheep', 'pig', 'goat', 'horse', 'chicken', 'llama'].some((x) => t.has(x))],
  ['living.pet', (t) => t.has('pet') || t.has('dog') || t.has('cat')],
  ['living.wild', (t) => t.has('creature') || t.has('animal') || t.has('wild')],
  ['vehicle.air', (t) => t.has('balloon') || t.has('air')],
  ['vehicle.water', (t) => t.has('boat') || t.has('canoe')],
  ['vehicle.rail', (t) => t.has('train') || t.has('tram')],
  ['transport.stop', (t) => t.has('rack') && (t.has('bike') || t.has('bicycle'))],
  ['vehicle.cycle', (t) => t.has('bike') || t.has('bicycle') || t.has('cart')],
  ['vehicle.road', (t) => t.has('vehicle') || t.has('car') || t.has('forklift')],
  ['transport.bridge', (t) => t.has('bridge')],
  ['transport.rail', (t) => t.has('rail')],
  ['transport.stop', (t) => t.has('parking') || t.has('pier') || t.has('rack') && t.has('bike')],
  ['transport.sign', (t) => t.has('signpost') || t.has('wayfinding')],
  ['transport.road', (t) => t.has('road')],
  ['water.feature', (t) => t.has('fountain') || t.has('well') || t.has('trough')],
  ['public.square', (t) => t.has('plaza') || t.has('square')],
  ['transport.path', (t) => t.has('path') || t.has('path-network') || t.has('paving')],
  ['vegetation.tree', (t) => t.has('tree') || t.has('stump') || t.has('log') || t.has('palm') || t.has('pine') && t.has('plant')],
  ['water.feature', (t) => t.has('fountain') || t.has('well') || t.has('trough')],
  ['water.flow', (t) => t.has('river') || t.has('stream')],
  ['water.shore', (t) => t.has('shore') || t.has('beach') || t.has('reeds')],
  ['water.body', (t) => t.has('water') || t.has('lake') || t.has('pond') || t.has('sea')],
  ['terrain.cave', (t) => t.has('cave') || t.has('grotto')],
  ['terrain.landform', (t) => t.has('landform') || t.has('hill') || t.has('mountain')],
  ['terrain.rock', (t) => t.has('rock') || t.has('boulder') || t.has('stone') && !t.has('wall')],
  ['vegetation.cover', (t, d) => t.has('cover') || d.form === 'area' && (t.has('plant') || t.has('forest') || t.has('meadow') || t.has('orchard') || t.has('woodland') || t.has('garden'))],
  ['vegetation.crop', (t) => t.has('crop') || t.has('vegetable')],
  ['vegetation.potted', (t) => t.has('planter') || t.has('pot') && t.has('plant')],
  ['vegetation.fungus', (t) => t.has('mushroom') || t.has('fungus') || t.has('cactus') || t.has('moss')],
  ['vegetation.tree', (t) => t.has('tree') || t.has('stump') || t.has('log') || t.has('palm') || t.has('pine')],
  ['vegetation.shrub', (t) => t.has('bush') || t.has('shrub') || t.has('hedge')],
  ['vegetation.flower', (t) => t.has('flower') || t.has('flowers') || t.has('fern') || t.has('grass') || t.has('plant') || t.has('nature')],
  ['public.play', (t) => t.has('playground') || t.has('swings') || t.has('slide') || t.has('fair') || t.has('ride')],
  ['furniture.table', (t) => (t.has('table') || t.has('desk')) && !t.has('bird')],
  ['furniture.seat', (t) => t.has('seat') || t.has('bench') || t.has('sofa') || t.has('chair')],
  ['public.play', (t) => t.has('playground') || t.has('swings') || t.has('slide') || t.has('fair') || t.has('ride')],
  ['public.sport', (t) => t.has('sport') || t.has('pitch') || t.has('goal')],
  ['public.venue', (t) => t.has('venue') || t.has('stage') || t.has('podium')],
  ['public.monument', (t) => t.has('monument') || t.has('sculpture') || t.has('statue') || t.has('obelisk') || t.has('totem') || t.has('arch') || t.has('art')],
  ['public.park', (t) => t.has('park') || t.has('lawn')],
  ['building.shelter', (t) => t.has('gazebo') || t.has('pavilion') || t.has('pergola') || t.has('bandstand') || t.has('dome') || t.has('lighthouse') || t.has('tower')],
  ['building.agricultural', (t) => t.has('barn') || t.has('greenhouse') || t.has('shed') || t.has('farm') && t.has('building')],
  ['building.civic', (t) => t.has('chapel') || t.has('temple') || t.has('shrine') || t.has('hall') || t.has('school') || t.has('library') && t.has('building')],
  ['building.commercial', (t) => t.has('shop') || t.has('cafe') && t.has('building') || t.has('market') && t.has('building')],
  ['building.industrial', (t) => t.has('warehouse') || t.has('smithy') || t.has('factory')],
  ['building.residential', (t) => t.has('house') || t.has('cottage') || t.has('home') || t.has('hut') || t.has('roundhouse') || t.has('townhouse') || t.has('building')],
  ['utility.power', (t) => t.has('power') || t.has('solar') || t.has('energy')],
  ['utility.waste', (t) => t.has('bin') || t.has('litter')],
  ['utility.water', (t) => t.has('hydrant')],
  ['utility.lighting', (t, d) => (t.has('lamp') || t.has('light') || t.has('lantern')) && !!d.size && d.size.box[1] > 2],
  ['utility.comms', (t) => t.has('mailbox')],
  ['component.access', (t) => t.has('stairs') || t.has('ladder') || t.has('ramp')],
  ['component.opening', (t) => t.has('door') || t.has('window')],
  ['component.roof', (t) => t.has('roof')],
  ['component.wall', (t) => t.has('wall') || t.has('fence') || t.has('gate') || t.has('boundary')],
  ['component.structure', (t) => t.has('platform') || t.has('deck') || t.has('beam') || t.has('construction') && !t.has('item')],
  ['furniture.bed', (t) => t.has('bed') || t.has('sleep')],
  ['furniture.seat', (t) => t.has('seat') || t.has('bench') || t.has('sofa') || t.has('chair')],
  ['furniture.kitchen', (t) => t.has('stove') || t.has('fridge') || t.has('sink') || t.has('hearth') || t.has('counter')],
  ['furniture.music', (t) => t.has('music') || t.has('instrument') || t.has('piano')],
  ['furniture.game', (t) => t.has('board-game') || t.has('chess')],
  ['furniture.work', (t) => t.has('work') && !t.has('item') || t.has('easel') || t.has('anvil') || t.has('workbench')],
  ['furniture.storage', (t) => t.has('storage') || t.has('wardrobe') || t.has('bookshelf') || t.has('dresser') || t.has('cupboard')],
  ['furniture.table', (t) => t.has('table') || t.has('desk')],
  ['furniture.lighting', (t) => t.has('lamp') || t.has('light') || t.has('lantern') || t.has('fire')],
  ['furniture.decor', (t) => t.has('rug') || t.has('carpet') || t.has('decor')],
  ['object.sign', (t) => t.has('flagpole') || t.has('sign') || t.has('signage') || t.has('sign-text') || t.has('flag') || t.has('board') || t.has('banner')],
  ['object.street', (t) => t.has('street') || t.has('bollard') || t.has('feeder')],
  ['object.food', (t) => t.has('food') || t.has('bread') || t.has('meal') || t.has('fruit')],
  ['object.tableware', (t) => t.has('cup') || t.has('mug') || t.has('plate') || t.has('bowl') || t.has('glass') || t.has('kettle') || t.has('drink')],
  ['object.tool', (t) => t.has('tools') || t.has('tool')],
  ['object.container', (t) => t.has('container') || t.has('crate') || t.has('barrel') || t.has('sack') || t.has('pallet') || t.has('pile')],
  ['object.media', (t) => t.has('books') || t.has('book') || t.has('media')],
  ['furniture.seat', (t) => t.has('furniture')],
  ['component.structure', (t) => t.has('structure')],
  ['object.decor', () => true],
];

/** The def's category: its own, else inferred from tags and name. */
export function categoryOf(d: VocabDef): string { return d.category && CATEGORIES.has(d.category) ? d.category : inferCategory(d); }
export function inferCategory(d: VocabDef): string { const t = T(d); for (const [id, f] of RULES) if (f(t, d)) return id; return 'object.decor'; }

// ------------------------------------------------------------------ parameter conventions

/** Reserved instance parameter names with one meaning across the catalogue. The physics half (model.bake) honours
 *  `sx/sy/sz`; the viewer's look (apps/web/src/gen-mesh/vocab-look.ts) honours all of them for any def. A def opts in by
 *  declaring them (with its own ranges) — use `conventions()` below. Generator-native sizes stay `w/d/h` in metres. */
export const CONVENTIONS = {
  sx: { type: 'number', min: 0.5, max: 2, default: 1, doc: 'stretch: width factor (x)' },
  sy: { type: 'number', min: 0.5, max: 2, default: 1, doc: 'stretch: height factor (y)' },
  sz: { type: 'number', min: 0.5, max: 2, default: 1, doc: 'stretch: depth factor (z)' },
  taper: { type: 'number', min: -0.5, max: 0.6, default: 0, doc: 'warp: narrow the top (+) or the bottom (−)' },
  bend: { type: 'number', min: -0.5, max: 0.5, default: 0, doc: 'warp: lean forward/back over the height (fraction of height)' },
  skew: { type: 'number', min: -0.4, max: 0.4, default: 0, doc: 'warp: shear sideways over the height' },
  tint: { type: 'color', doc: 'paint: multiply every surface by this colour (any def, incl. imported meshes)' },
  vary: { type: 'number', min: 0, max: 1, default: 0, doc: 'paint: per-instance colour variation from the seed' },
  condition: { type: 'enum', values: ['new', 'worn', 'damaged', 'construction'], default: 'new', doc: 'wear: new, worn, damaged or under construction (scaffold)' },
} as const satisfies Record<string, FieldInput>;
export type ConventionName = keyof typeof CONVENTIONS;
export const STRETCH = ['sx', 'sy', 'sz'] as const;
export const WARP = ['taper', 'bend', 'skew'] as const;
export const CONVENTION_GROUPS: Record<string, ConventionName[]> = { stretch: ['sx', 'sy', 'sz'], warp: ['taper', 'bend', 'skew'], paint: ['tint', 'vary'], wear: ['condition'] };

/** Declare convention params (groups or names), optionally narrowing ranges: conventions('stretch', 'paint', { sy: [0.8, 3] }). */
export function conventions(...want: (string | Partial<Record<ConventionName, [number, number]>>)[]): Record<string, FieldInput> {
  const out: Record<string, FieldInput> = {};
  for (const w of want) {
    if (typeof w === 'string') for (const n of CONVENTION_GROUPS[w] ?? [w as ConventionName]) { if (!(n in CONVENTIONS)) throw new Error(`unknown convention ${n}`); out[n] = { ...CONVENTIONS[n] } as FieldInput; }
    else for (const [n, r] of Object.entries(w)) { const f = { ...(out[n] ?? CONVENTIONS[n as ConventionName]) } as FieldInput & { min?: number; max?: number }; f.min = r![0]; f.max = r![1]; out[n] = f; }
  }
  return out;
}
/** Paint slots: one colour param per tint key of the def's palette (the kit mesh reads params[<key>]). */
export function paintSlots(palette: Record<string, string>, keys = Object.keys(palette)): Record<string, FieldInput> {
  return Object.fromEntries(keys.map((k) => [k, { type: 'color', default: palette[k], doc: `paint: ${k}` } as FieldInput]));
}
/** A style enum (`variant`): kit shapes may carry `when: "variant=tall"` to appear only in that variant. */
export const variant = (values: string[], doc = 'style variant'): Record<string, FieldInput> => ({ variant: { type: 'enum', values, default: values[0], doc } });

// ------------------------------------------------------------------ interaction interfaces

/** Gene's interaction words → the engine's slot kinds. A slot kind is how a body uses a thing. */
export const SLOT_VERBS: Record<string, string> = {
  seat: 'sit', bed: 'lie', stand: 'stand-at', carry: 'hold', surface: 'put-on', shelf: 'contain', socket: 'mount', hang: 'attach',
  door: 'enter', room: 'inside', floor: 'stand-on', roof: 'stand-on', post: 'mount', perch: 'perch', wall: 'attach',
};
/** Components that are affordances by themselves. */
export const COMPONENT_VERBS: Record<string, string> = {
  seat: 'sit', bed: 'lie', surface: 'put-on', container: 'contain', carryable: 'pick-up', light: 'light', readable: 'read', sign: 'read',
  instrument: 'play', workstation: 'work', boardGame: 'play-game', venue: 'perform', carrier: 'ride', place: 'be-in', water: 'swim', stairs: 'climb', ramp: 'climb',
};

/** Actuators: declarative state + actions (def/1 `state` and `actions`), the same for every def that has one. The server
 *  turns each action into a Soul capability `object:<entity>:<action>` (god/actuators.ts) and commits the state to the
 *  world; the viewer draws the state (vocab-look.ts: open → role door/lid swings, lit → role flame shows, on → glow,
 *  level → role fill rises). */
export type ActuatorKind = 'power' | 'door' | 'lock' | 'fill' | 'ignite' | 'play';
export const ACTUATORS: Record<ActuatorKind, { field: string; doc: string; build(o: { default?: boolean | number; label?: string }): { state: Record<string, FieldInput>; actions: DefInput['actions'] } }> = {
  power: { field: 'on', doc: 'switch on / switch off (lamps, screens, machines)', build: ({ default: d = false, label = 'it' }) => ({
    state: { on: { type: 'bool', default: !!d } },
    actions: [act('switch-on', `Switch on ${label}`, [{ field: 'on', is: false }], [{ op: 'set', field: 'on', value: true }]), act('switch-off', `Switch off ${label}`, [{ field: 'on', is: true }], [{ op: 'set', field: 'on', value: false }])] }) },
  door: { field: 'open', doc: 'open / close (doors, gates, lids, cupboards); refuses while locked', build: ({ default: d = false, label = 'it' }) => ({
    state: { open: { type: 'bool', default: !!d } },
    actions: [act('open', `Open ${label}`, [{ field: 'open', is: false }, { field: 'locked', not: true }], [{ op: 'set', field: 'open', value: true }]), act('close', `Close ${label}`, [{ field: 'open', is: true }], [{ op: 'set', field: 'open', value: false }])] }) },
  lock: { field: 'locked', doc: 'lock / unlock (only while closed)', build: ({ default: d = false, label = 'it' }) => ({
    state: { locked: { type: 'bool', default: !!d } },
    actions: [act('lock', `Lock ${label}`, [{ field: 'locked', is: false }, { field: 'open', not: true }], [{ op: 'set', field: 'locked', value: true }]), act('unlock', `Unlock ${label}`, [{ field: 'locked', is: true }], [{ op: 'set', field: 'locked', value: false }])] }) },
  fill: { field: 'level', doc: 'fill / empty (troughs, tanks, cups, baths): level 0..1', build: ({ default: d = 0, label = 'it' }) => ({
    state: { level: { type: 'number', min: 0, max: 1, default: Number(d) } },
    actions: [act('fill', `Fill ${label}`, [{ field: 'level', not: 1 }], [{ op: 'set', field: 'level', value: 1 }]), act('empty', `Empty ${label}`, [{ field: 'level', not: 0 }], [{ op: 'set', field: 'level', value: 0 }])] }) },
  ignite: { field: 'lit', doc: 'light / put out (fires, candles, braziers, stoves)', build: ({ default: d = false, label = 'it' }) => ({
    state: { lit: { type: 'bool', default: !!d } },
    actions: [act('light', `Light ${label}`, [{ field: 'lit', is: false }], [{ op: 'set', field: 'lit', value: true }]), act('put-out', `Put out ${label}`, [{ field: 'lit', is: true }], [{ op: 'set', field: 'lit', value: false }])] }) },
  play: { field: 'playing', doc: 'play / stop (instruments, radios, jukeboxes, fountains)', build: ({ default: d = false, label = 'it' }) => ({
    state: { playing: { type: 'bool', default: !!d } },
    actions: [act('play', `Play ${label}`, [{ field: 'playing', is: false }], [{ op: 'set', field: 'playing', value: true }]), act('stop', `Stop ${label}`, [{ field: 'playing', is: true }], [{ op: 'set', field: 'playing', value: false }])] }) },
};
function act(name: string, label: string, when: { field: string; is?: unknown; not?: unknown }[], then: { op: 'set'; field: string; value: unknown }[]) {
  return { name, label, roles: 'anyone', reach: 'touch', params: {}, when, then } as unknown as NonNullable<DefInput['actions']>[number];
}
/** Merge actuators into a def's state and actions: { ...def, ...actuators(['door', 'lock'], { label: 'the door' }) }. */
export function actuators(kinds: (ActuatorKind | [ActuatorKind, { default?: boolean | number; label?: string }])[], common: { label?: string } = {}) {
  const state: Record<string, FieldInput> = {}; const actions: NonNullable<DefInput['actions']> = [];
  for (const k of kinds) { const [kind, o] = Array.isArray(k) ? k : [k, {}]; const b = ACTUATORS[kind].build({ ...common, ...o }); Object.assign(state, b.state); actions.push(...(b.actions ?? [])); }
  return { state, actions };
}

export type Interfaces = { slots: string[]; verbs: string[]; actions: string[]; states: string[]; components: string[] };
/** What a def offers: slot verbs (with counts), component affordances, actuator actions, its state fields. */
export function interfacesOf(d: VocabDef): Interfaces {
  const count = new Map<string, number>();
  for (const s of d.slots ?? []) { const v = SLOT_VERBS[s.kind] ?? s.kind; count.set(v, (count.get(v) ?? 0) + 1); }
  const slots = [...count].map(([v, n]) => (n > 1 ? `${v}×${n}` : v));
  const comps = Object.keys(d.components ?? {}).filter((k) => (d.components as Record<string, unknown>)[k] !== undefined);
  const verbs = [...new Set([...count.keys(), ...comps.map((c) => COMPONENT_VERBS[c]).filter((v): v is string => !!v)])];
  return { slots, verbs, actions: (d.actions ?? []).map((a) => a.name), states: Object.keys(d.state ?? {}), components: comps };
}
/** `has` facet: slot:<verb|kind>, action:<name>, comp:<component>, state:<field>, param:<name>, verb:<verb>, actuator:<kind>. */
export function hasFacet(d: VocabDef, facet: string): boolean {
  const [k, v] = facet.includes(':') ? facet.split(':', 2) as [string, string] : ['verb', facet];
  const i = interfacesOf(d);
  switch (k) {
    case 'slot': return (d.slots ?? []).some((s) => s.kind === v || SLOT_VERBS[s.kind] === v);
    case 'action': return i.actions.includes(v);
    case 'comp': case 'component': return i.components.includes(v);
    case 'state': return i.states.includes(v);
    case 'param': return Object.hasOwn(d.params ?? {}, v);
    case 'actuator': { const a = ACTUATORS[v as ActuatorKind]; return !!a && i.states.includes(a.field) && i.actions.length > 0; }
    case 'verb': return i.verbs.includes(v) || i.actions.includes(v);
    case 'form': return d.form === v;
    case 'make': return d.make.kind === v || d.make.gen === v;
    default: return false;
  }
}

// ------------------------------------------------------------------ manifest

export type ManifestRow = {
  ref: string; cat: string; name: string; form: string; tags: string[]; syn: string[];
  params: string; ifc: string; size: string; tris: number; bytes: number; make: string; doc: string; hash?: string;
};
const r1 = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
/** One compact row per def: everything an agent needs to choose, nothing it does not. `bytes` = asset bytes to fetch. */
export function manifestRow(d: VocabDef, extra: { bytes?: number; publicRef?: string } = {}): ManifestRow {
  const i = interfacesOf(d);
  const params = Object.entries(d.params ?? {}).map(([k, f]) => {
    const ff = f as { type: string; min?: number; max?: number; values?: string[]; default?: unknown };
    return ff.type === 'enum' ? `${k}=${(ff.values ?? []).slice(0, 6).join('|')}` : ff.type === 'number' || ff.type === 'int' ? `${k}${ff.min !== undefined ? `∈${ff.min}..${ff.max}` : ''}` : ff.type === 'color' ? `${k}:colour` : `${k}:${ff.type}`;
  }).join(' ');
  const ifc = [...i.slots, ...i.verbs.filter((v) => !i.slots.some((s) => s.startsWith(v))), ...(i.actions.length ? [i.actions.join('/')] : [])].join(' ');
  const box = d.size?.box ?? [1, 1, 1];
  return {
    ref: extra.publicRef ?? (d.ref ? (d.ref.startsWith('core-') ? 'core/' + d.ref.slice(5) : d.ref) : `${d.name}@1`), cat: categoryOf(d), name: d.name.replace(/^core-/, ''),
    form: d.form ?? 'point', tags: (d.tags ?? []).slice(0, 8), syn: d.synonyms ?? [], params, ifc,
    size: box.map(r1).join('×'), tris: d.budget?.tris ?? 0, bytes: extra.bytes ?? d.budget?.bytes ?? 0,
    make: d.make.kind === 'gen' ? d.make.gen ?? 'gen' : d.make.kind, doc: (d.description ?? '').split(/(?<=[.;])\s/)[0].slice(0, 100), ...(d.hash ? { hash: d.hash.slice(0, 12) } : {}),
  };
}
/** The row as one line of text (what `eden-god catalog` prints). */
export function manifestLine(r: ManifestRow): string {
  const kb = r.bytes ? ` ${r.bytes >= 1e6 ? (r.bytes / 1e6).toFixed(1) + 'MB' : Math.round(r.bytes / 1024) + 'KB'}` : '';
  return `${r.ref} [${r.cat}] ${r.size}m ${r.make}${r.tris ? ` ${r.tris}t` : ''}${kb}${r.ifc ? ` {${r.ifc}}` : ''}${r.params ? ` (${r.params})` : ''}${r.syn.length ? ` aka ${r.syn.join(',')}` : ''} — ${r.doc}`;
}

// ------------------------------------------------------------------ facets

export type Facets = { category?: string; tag?: string; has?: string[]; form?: string };
export function facetFilter<D extends VocabDef>(defs: D[], f: Facets): D[] {
  return defs.filter((d) => (!f.category || within(categoryOf(d), f.category)) && (!f.tag || (d.tags ?? []).includes(f.tag)) && (!f.form || d.form === f.form) && (f.has ?? []).every((h) => hasFacet(d, h)));
}
/** Category counts (for a taxonomy listing with what exists and what is still empty). */
export function categoryCounts(defs: VocabDef[]) {
  const n = new Map<string, number>();
  for (const d of defs) { const c = categoryOf(d); for (let p = c; p; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '') n.set(p, (n.get(p) ?? 0) + 1); }
  return TAXONOMY.map((t) => ({ id: t.id, label: t.label, count: n.get(t.id) ?? 0, ...(t.via ? { via: t.via } : {}), ...(t.want?.length ? { want: t.want } : {}) }));
}

/** Words → categories (taxonomy syn + labels), for search and recommend: "bodega" → building.commercial. */
export function categoriesForWord(w: string): string[] {
  const out: string[] = [];
  for (const t of TAXONOMY) if (t.syn?.includes(w) || t.id.split('.').pop() === w || t.label.toLowerCase().split(/\W+/).includes(w)) out.push(t.id);
  return out;
}

// ------------------------------------------------------------------ lint (the induction validator)

export type Lint = { name: string; errors: string[]; warnings: string[] };
const BUDGET: [string, number][] = [['living', 600], ['building', 6000], ['vehicle', 1200], ['public', 6000], ['transport', 6000], ['terrain', 6000], ['water', 6000], ['utility', 2000], ['component', 1500], ['vegetation', 1500], ['furniture', 600], ['object', 400], ['layer', 400]];
export const triBudget = (cat: string) => BUDGET.find(([c]) => within(cat, c))?.[1] ?? 400;
/** What an inducted def must satisfy beyond def/1: a known category, a description, convention params declared with
 *  their canonical meaning, ranged numeric params with defaults inside, actuators whose actions use declared state,
 *  interfaces that make sense for the category, a tri budget. `tris` = measured triangles when known. */
export function lintDef(d: VocabDef, o: { tris?: number; requireCategory?: boolean } = {}): Lint {
  const errors: string[] = [], warnings: string[] = [];
  if (d.category && !CATEGORIES.has(d.category)) errors.push(`category ${d.category} is not in the taxonomy (vocab/taxonomy.json)`);
  if (!d.category && o.requireCategory) errors.push('category missing');
  const cat = categoryOf(d);
  if (!d.description || d.description.length < 12) errors.push('description missing or too short (say what it is, its size and its use)');
  for (const [k, f0] of Object.entries(d.params ?? {})) {
    const f = f0 as { type: string; min?: number; max?: number; default?: unknown; values?: string[] };
    const conv = (CONVENTIONS as Record<string, { type: string; values?: readonly string[] }>)[k];
    if (conv && conv.type !== f.type) errors.push(`param ${k} is a convention (${conv.type}); declared as ${f.type}`);
    if (conv?.values && f.values && f.values.some((v) => !conv.values!.includes(v))) errors.push(`param ${k}: values must be from ${conv.values.join('|')}`);
    if (f.type === 'number' || f.type === 'int') {
      if (f.min === undefined || f.max === undefined) errors.push(`param ${k}: numeric params need min and max`);
      if (f.default === undefined) errors.push(`param ${k}: needs a default`);
      else if (typeof f.default === 'number' && ((f.min !== undefined && f.default < f.min) || (f.max !== undefined && f.default > f.max))) errors.push(`param ${k}: default ${f.default} outside ${f.min}..${f.max}`);
    }
    if (f.type === 'enum' && f.default !== undefined && !f.values?.includes(String(f.default))) errors.push(`param ${k}: default ${String(f.default)} not among values`);
  }
  const states = new Set(Object.keys(d.state ?? {}));
  for (const a of (d.actions ?? []) as { name: string; when?: { field: string }[]; then?: { op: string; field?: string }[] }[]) {
    for (const w of a.when ?? []) if (!states.has(w.field) && !Object.values(ACTUATORS).some((x) => x.field === w.field)) errors.push(`action ${a.name}: when-field ${w.field} is not a state field`);
    for (const t of a.then ?? []) if (t.field && !states.has(t.field)) errors.push(`action ${a.name}: sets ${t.field}, not a declared state field`);
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(a.name)) errors.push(`action ${a.name}: name must match ^[a-z][a-z0-9_-]{0,39}$ (Soul object actions)`);
  }
  const i = interfacesOf(d);
  if (within(cat, 'furniture.seat') && !i.slots.some((s) => s.startsWith('sit'))) warnings.push('a seat with no seat slot: Souls cannot sit on it');
  if (within(cat, 'furniture.bed') && !i.slots.some((s) => s.startsWith('lie'))) warnings.push('a bed with no bed slot');
  if (within(cat, 'furniture.table') && !i.verbs.includes('put-on')) warnings.push('a table with no surface slot');
  if (within(cat, 'building') && !(d as { extends?: string }).extends && !i.verbs.includes('inside') && !(d.components ?? {} as Record<string, unknown>).place && d.make.kind !== 'parts') warnings.push('a building with no rooms or place: Souls cannot enter it');
  const tris = o.tris ?? d.budget?.tris ?? 0, budget = triBudget(cat);
  if (tris > budget) errors.push(`${tris} triangles over the ${cat} budget ${budget}`);
  if (!(d.synonyms?.length) && d.category) warnings.push('no synonyms: add the words people use for it (bodega, corner shop …)');
  return { name: d.name, errors, warnings };
}

// ------------------------------------------------------------------ physics of the conventions

/** Stretch factors of an instance (1 when the def does not declare them). */
export function stretchOf(defParams: Record<string, { default?: unknown }> | undefined, params: Record<string, unknown>): [number, number, number] {
  return STRETCH.map((k) => { if (!defParams?.[k]) return 1; const v = Number(params[k] ?? defParams[k].default ?? 1); return Number.isFinite(v) && v > 0 ? v : 1; }) as [number, number, number];
}
/** Physics under a per-axis stretch: the box, wall colliders, slots, floors, openings and links scale with the picture. */
export function stretchBaked(b: Baked, [sx, sy, sz]: [number, number, number]): Baked {
  if (sx === 1 && sy === 1 && sz === 1) return b;
  const p2 = (p: [number, number]): [number, number] => [p[0] * sx, p[1] * sz];
  return {
    ...b, box: [b.box[0] * sx, b.box[1] * sy, b.box[2] * sz],
    colliders: b.colliders.map((c) => ({ ...c, c: p2(c.c), half: [c.half[0] * sx, c.half[1] * sz], ...(c.abs ? {} : { y0: c.y0 * sy, y1: c.y1 * sy }) })),
    slots: b.slots.map((s) => ({ ...s, p: [s.p[0] * sx, s.p[1] * sy, s.p[2] * sz], ...(s.height !== undefined ? { height: s.height * sy } : {}), ...(s.polygon ? { polygon: s.polygon.map(p2) } : {}) })),
    ...(b.surfaces ? { surfaces: b.surfaces.map((f) => ({ ...f, y: f.abs ? f.y : f.y * sy, polygon: f.polygon.map(p2) })) } : {}),
    ...(b.openings ? { openings: b.openings.map((o) => ({ ...o, at: p2(o.at), width: o.width * (Math.abs(Math.sin(o.yaw)) > 0.7 ? sz : sx), height: o.height * sy, ...(o.sill !== undefined ? { sill: o.sill * sy } : {}) })) } : {}),
    ...(b.links ? { links: b.links.map((l) => ({ ...l, path: l.path.map(p2), y0: l.y0 * sy, y1: l.y1 * sy })) } : {}),
    ...(b.rooms ? { rooms: b.rooms.map((r) => ({ ...r, polygon: r.polygon.map(p2), origin: p2(r.origin), y: r.y * sy, height: r.height * sy })) } : {}),
    // E2 #5: a def's carve (a pool's basin) stretches with the picture
    ...(b.landform?.kind === 'carve' ? { landform: { ...b.landform, ...(b.landform.area ? { area: b.landform.area.map(p2) } : {}), bed: b.landform.bed * sy } } : {}),
  };
}
