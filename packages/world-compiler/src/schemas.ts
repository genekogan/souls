// entity/1 — the world's state model and edit grammar (spec <eden4>/28 §3, §5).
// Everything a god or the server exchanges is one of these shapes. Keep them
// compact; the compiler (compile.ts) is the only thing that interprets them.
import { z } from 'zod';
import { landformBodySchema } from '@sim/ground';
import { ID, NAME, fieldSchema, fieldsSchema, materialEnum, num, slotSchema, v2, v3, value } from '@sim/generators';
import { ACCESS, layersStateSchema, ownerRef, priceSchema, relRef, RELATIONS, scheduleSchema } from './layers.ts';
import { CREATION_LIMITS as L } from '@sim/generators';

export const ENTITY_SCHEMA = 'entity/1';
export const DEF_SCHEMA = 'def/1';
export const EDIT_SCHEMA = 'edit/1';

export { ID, NAME, value, fieldSchema, fieldsSchema, slotKind, slotSchema, materialEnum } from '@sim/generators';
export type { Value, Field, FieldInput, Slot, Material } from '@sim/generators';
export const DEF_REF = /^((?:core|eden|lm|mars)\/[a-z0-9][a-z0-9._-]*@\d+|sha:[0-9a-f]{16,64}|[a-z0-9][a-z0-9._-]*@\d+)$/;

// ---------- defs ----------

/** W7 sound kinds (viewer, procedural WebAudio). */
export const SOUND_KINDS = ['water', 'stream', 'fire', 'wind', 'creak', 'birds', 'bell', 'hum', 'engine', 'chime', 'frogs', 'music', 'waves', 'crickets', 'chatter', 'footsteps', 'leaves', 'flag', 'waterfowl', 'bees', 'kettle'] as const;
const soundSpec = z.object({ kind: z.enum(SOUND_KINDS), radius: num.positive().max(200).default(14), volume: num.min(0).max(1).default(0.5), when: z.string().regex(/^!?[a-z][a-zA-Z0-9]*$/).optional(), mode: z.enum(['loop', 'change']).default('loop'), variant: z.number().int().min(0).max(15).optional() });
/** More sounds on the same thing: `also` lists up to 3 further specs (a fountain splashes and hums). */
const soundSchema = soundSpec.extend({ also: z.array(soundSpec).min(1).max(3).optional() });

/** Closed component set; each is a config object the engine understands. New components are level-3 code work. */
export const lightSchema = z.object({
  color: z.string().regex(/^#[0-9a-f]{6}$/).default('#ffe9c4'), range: num.positive().default(8), on: z.boolean().default(true),
  /** Local offset, rotated/scaled with the entity. Only x/z move the ground pool; y locates the bulb's halo. */
  at: z.union([v2, v3]).optional(),
  /** Fixed, gentle rates below 3 Hz; reduced-motion viewers hold these steady. */
  pattern: z.enum(['steady', 'blink', 'twinkle', 'chase', 'pulse']).optional(),
});
export const componentsSchema = z.object({
  seat: z.object({ height: num.default(0.45) }).optional(),
  bed: z.object({ height: num.default(0.5) }).optional(),
  surface: z.object({ height: num }).optional(),
  /** Soul Actions entry 42: `inside` makes a hand-operated container's `shelf` slots real storage places (contact.ts
   *  containerInside): its mouth in the def frame at scale 1 (the lip a stored thing passes over, the front face, where a
   *  body stands to reach in), what fits (`fit`, m) and the word for its inside ("drawer"). #435 (W072): `claim: "owner"`
   *  gives a thing kept in it that has an owner of its own back only to that owner (a lost-and-found). #435 (W068):
   *  `hidden` keeps what is in it out of everyone's sight; it is found only by searching (a hiding place). */
  container: z.object({ capacity: num.positive(), of: z.array(z.string()).optional(), claim: z.literal('owner').optional(), hidden: z.literal(true).optional(), inside: z.object({ lip: num, face: num, stand: v2, fit: v3, word: z.string().max(24) }).strict().optional() }).optional(),
  /** PC03 (#682): `handling` is a loose material's native carry data (the engine catalog's `handling`, in the def frame:
   *  +x the long axis, y up from the base, z across): the crew range, grips for each crew size, carry pose and hand
   *  height. Absent, a carryable keeps the one-hand item path (or `upright-carry`). */
  carryable: z.object({ mass: num.positive(), grips: z.number().int().min(1).max(4).default(1),
    handling: z.object({ crew: z.tuple([z.number().int().min(1).max(8), z.number().int().min(1).max(8)]), pose: z.enum(['edge', 'flat']), height: num.positive().max(2),
      grips: z.record(z.string().regex(/^[1-8]$/), z.array(v3).min(1).max(8)) }).strict().optional() }).optional(),
  opening: z.object({ width: num.positive(), height: num.positive(), state: z.enum(['open', 'closed', 'always']).default('always') }).optional(),
  floor: z.object({ level: z.number().int().default(0), y: num.default(0) }).optional(),
  stairs: z.object({ rise: num.positive(), run: num.positive(), treads: z.number().int().min(1) }).optional(),
  ramp: z.object({ grade: num.positive().max(1) }).optional(),
  water: z.object({ level: num }).optional(),
  landform: landformBodySchema.optional(),
  scatter: z.object({ of: z.array(z.object({ def: z.string().regex(DEF_REF), weight: num.positive().default(1) })).min(1).max(16), density: num.positive().max(10), minSpacing: num.positive().default(1.5), except: z.array(v2).max(256).default([]) }).optional(),
  light: lightSchema.optional(),
  /** A list replaces the singular light when supplied. */
  lights: z.array(lightSchema).min(1).max(8).optional(),
  bell: z.object({ gripAt: z.tuple([num, num, num]), pullAngle: num.positive().max(0.6) }).optional(),
  display: z.object({ w: num.positive(), h: num.positive(), controlAt: z.tuple([num, num, num]).optional(), slots: z.number().int().min(1).max(8).optional() }).optional(),
  paint: z.object({ faces: z.array(z.enum(['front', 'back', 'all'])).default(['all']) }).optional(),
  plant: z.object({ stages: z.number().int().min(1).max(8).default(3), daysPerStage: num.positive().default(1) }).optional(),
  instrument: z.object({ kind: z.string() }).optional(),
  readable: z.object({ pages: z.number().int().min(1) }).optional(),
  workstation: z.object({ kind: z.string() }).optional(),
  boardGame: z.object({ game: z.string() }).optional(),
  venue: z.object({ presenter: z.string().optional(), audience: z.string().optional(), capacity: z.number().int().positive().optional() }).optional(),
  carrier: z.object({ seats: z.number().int().min(1), route: z.string().optional() }).optional(),
  foundation: z.object({ kind: z.enum(['pad', 'skirt', 'none']).default('pad') }).optional(),
  /** This def is (or contains) a place Souls can be in: rooms of buildings, plazas, gardens, pitches. Stage B derives the place tree from it. */
  place: z.object({ kind: z.string().max(40), enclosed: z.boolean().default(false), capacity: z.number().int().positive().optional() }).optional(),
  /** Decorative motion, client-side and deterministic from world tick: rotate parts with role `blade|wheel` or the whole thing. */
  spin: z.object({ axis: z.enum(['x', 'y', 'z']).default('y'), rpm: num.default(2), role: z.string().optional() }).optional(),
  sway: z.object({ amount: num.min(0).max(1).default(0.15), period: num.positive().default(6) }).optional(),
  /** E2 #4: articulated parts that work back and forth (an excavator's arm, a forklift's forks): each role pivot rotates
   *  (radians) or slides (metres) along `axis` between 0 and `amount` over `period` seconds, offset by `phase` (0…1),
   *  only while `when` (a state field, `!field` negated) holds; without `when`, always. */
  swing: z.object({ parts: z.array(z.object({ role: z.string(), kind: z.enum(['rotate', 'slide']).default('rotate'), axis: z.enum(['x', 'y', 'z']).default('x'), amount: num.min(-3.2).max(3.2), period: num.positive().max(600).default(6), phase: num.min(0).max(1).default(0), when: z.string().regex(/^!?[a-z][a-zA-Z0-9]*$/).optional() })).min(1).max(4) }).optional(),
  hover: z.object({ height: num.default(0), bob: num.min(0).max(2).default(0.15), period: num.positive().default(4) }).optional(),
  /** Follow the entity's own path shape (or a ref's) at `speed` m/s; loop or ping-pong. Balloons, boats, carts, trains. */
  route: z.object({ ref: z.string().optional(), speed: num.positive().default(2), loop: z.boolean().default(true), altitude: num.default(0) }).optional(),
  /** Creature behaviour, client-side deterministic: needs a gait in kit args (or a pack animal). */
  behavior: z.object({ kind: z.enum(['wander', 'graze', 'swim', 'perch', 'sleep', 'fly', 'follow', 'idle']), speed: num.positive().default(1), radius: num.positive().default(8), ref: z.string().optional(),
    /** E2 #3: shy animals run from people who come closer than this (m) and wander back once they have gone. */
    flee: num.min(0).max(40).optional() }).optional(),
  /** VOCAB-W2 sound layer (viewer, procedural WebAudio, new worlds): a loop while state `when` holds ('on', '!open', 'lit'),
   *  or a one-shot each time that field changes (mode 'change'); heard within `radius` m of the thing (path/area: its outline). */
  //  W7: `variant` pins one voicing of the kind; `also` adds up to 3 more sounds to the same thing.
  sound: soundSchema.optional(),
  /** Text on a sign or board (state `text` overrides). */
  sign: z.object({ lines: z.array(z.string().max(80)).max(6).default([]) }).optional(),
  body: z.object({
    media: z.array(z.enum(['walk', 'swim', 'fly', 'float'])).min(1),
    radius: num.positive(), height: num.positive(),
    landmarks: z.record(z.string(), v3).default({}),
    carry: z.object({ slot: z.enum(['hands', 'top', 'mouth', 'back']), maxMass: num.nonnegative(), maxSize: v3 }),
    settle: z.enum(['sit', 'lie', 'rest', 'hover']).default('rest'),
    rig: z.enum(['humanoid', 'quadruped']).nullable().default(null),
  }).optional(),
});
export type Components = z.infer<typeof componentsSchema>;

/** Declarative action on a def's own subtree. `when` compares own state; `then` changes own state or attachments. */
export const actionSchema = z.object({
  name: z.string().regex(NAME),
  label: z.string().max(80),
  roles: z.union([z.literal('anyone'), z.array(z.string())]).default('anyone'),
  reach: z.enum(['touch', 'place', 'anywhere']).default('touch'),
  params: z.record(z.string().regex(ID), fieldSchema).default({}),
  when: z.array(z.object({ field: z.string(), is: value.optional(), not: value.optional() })).max(8).default([]),
  then: z.array(z.discriminatedUnion('op', [
    z.object({ op: z.literal('set'), field: z.string(), value: z.union([value, z.object({ param: z.string() })]) }),
    z.object({ op: z.literal('toggle'), field: z.string() }),
    /** Soul Actions entry 37: step a field to the next of `values` (wrapping), e.g. a radio's station. */
    z.object({ op: z.literal('cycle'), field: z.string(), values: z.array(z.string().max(80)).min(2).max(16) }),
    z.object({ op: z.literal('increment'), field: z.string(), by: z.number().int().min(1).max(10).default(1) }),
    z.object({ op: z.literal('attach'), what: z.enum(['actor', 'held']), slot: z.string() }),
    z.object({ op: z.literal('detach'), what: z.enum(['actor', 'held']) }),
  ])).min(1).max(8),
});
export type Action = z.infer<typeof actionSchema>;

/** `$param` substitution and simple arithmetic only; no loops. Evaluated at expansion time. */
export const expr = z.union([num, z.string().max(200), z.boolean()]);

export const partSchema = z.object({
  id: z.string().regex(NAME),
  def: z.string().regex(DEF_REF),
  slot: z.string().optional(),      // slot on the parent part (or on the prefab root when `in` is absent)
  in: z.string().optional(),        // parent part id; default: the prefab root
  p: z.union([v2, v3]).optional(), r: z.union([num, v3]).optional(), s: num.optional(),
  params: z.record(z.string(), expr).optional(),
  state: z.record(z.string(), expr).optional(),
  /** Include only when the expression is truthy: "$porch", "$floors > 1" (one comparison). */
  when: z.string().max(80).optional(),
  /** Repeat the part `count` times, stepping by [dx, dz] (and yaw) each time; ids get -1, -2, … */
  repeat: z.object({ count: z.union([z.number().int().min(1).max(L.partRepeats), z.string().max(40)]), step: v2.default([1, 0]), yaw: num.default(0) }).optional(),
  /** VOCAB-W3: LAYERS defaults the part's entity starts with (a café counter's price, a hall's opening hours). */
  owner: ownerRef.optional(), access: z.enum(ACCESS).optional(), schedule: scheduleSchema.optional(), price: priceSchema.optional(),
});
export type Part = z.infer<typeof partSchema>;

export const makeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mesh'), asset: z.string().regex(/^[0-9a-f]{64}$/), lod1: z.string().regex(/^[0-9a-f]{64}$/).optional(), collide: z.enum(['box', 'hull', 'mesh', 'none']).default('box'), /** sha of an lm-building-footprint/1 sidecar in the asset store (rooms, walls, openings, links) */ footprint: z.string().regex(/^[0-9a-f]{64}$/).optional() }),
  z.object({ kind: z.literal('gen'), gen: z.string().regex(/^[a-z][a-z0-9-]*\/\d+$/), args: z.record(z.string(), z.unknown()).optional() }),
  z.object({ kind: z.literal('parts'), parts: z.array(partSchema).min(1).max(L.prefabParts) }),
  /** Nothing to draw or collide with: a place marker, a region, a landform-only def. */
  z.object({ kind: z.literal('none') }),
]);

export const defSchema = z.object({
  schema: z.literal(DEF_SCHEMA),
  name: z.string().regex(NAME),
  version: z.number().int().min(1).default(1),
  extends: z.string().regex(DEF_REF).optional(),
  description: z.string().max(4000).default(''),
  tags: z.array(z.string().regex(NAME)).max(32).default([]),
  /** VOCAB-MECH: the catalogue category (a node of vocab/taxonomy.json, e.g. "building.commercial") and the words people
   *  use for it ("bodega", "corner shop"). Optional (no default) so defs without them hash as before; search infers one. */
  category: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$/).optional(),
  synonyms: z.array(z.string().min(2).max(40)).max(24).optional(),
  form: z.enum(['point', 'path', 'area']).default('point'),
  make: makeSchema,
  params: fieldsSchema.default({}),
  state: fieldsSchema.default({}),
  slots: z.array(slotSchema).max(512).default([]),
  components: componentsSchema.default({}),
  actions: z.array(actionSchema).max(32).default([]),
  anchor: z.enum(['base', 'center', 'conform', 'drape', 'float']).default('base'),
  /** Default material and palette (colour per tint key) for the mesh half. */
  material: materialEnum.optional(),
  palette: z.record(z.string().max(32), z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
  tilt: z.object({ maxDeg: num.min(0).max(90) }).optional(),
  layer: z.enum(['solid', 'surface', 'volume', 'decor']).default('solid'),
  /** Local box in metres (x width, y height, z depth) at scale 1, and the allowed uniform-scale range. */
  size: z.object({ box: v3, scale: z.tuple([num.positive(), num.positive()]).default([1, 1]) }),
  overlaps: z.array(z.string()).max(32).default([]),
  /** VOCAB-W3: things placed with it, each its own entity afterwards (a furnished building: the beds, tables and
   *  counters in its rooms, `slot` = the room id). Same shape as prefab parts. Optional, so other defs hash as before. */
  contents: z.array(partSchema).max(L.prefabParts).optional(),
  /** VOCAB-W3: LAYERS defaults a placed entity starts with unless the place op says otherwise (the god overrides with `set`). */
  layers: z.object({ owner: ownerRef.optional(), access: z.enum(ACCESS).optional(), schedule: scheduleSchema.optional(), price: priceSchema.optional() }).optional(),
  /** Filled by the compiler at define time; never trusted from input. */
  budget: z.object({ tris: z.number().int(), bytes: z.number().int(), textures: z.number().int() }).optional(),
});
export type Def = z.infer<typeof defSchema>;
export type DefInput = z.input<typeof defSchema>;

/** A def as stored: input + hash + provenance. */
export type StoredDef = Def & { hash: string; ref: string; by: string; born: number };

// ---------- entities ----------

/** Persistent relationships. Server-maintained: float, ground, facing, along (re-solved when refs or terrain change).
 *  Advisory: near, inside, clear (checked by `resolve`, reported by `describe`). Spec 33 §3.3. */
export const constraintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('float'), sink: num.default(0) }),
  z.object({ kind: z.literal('ground') }),
  z.object({ kind: z.literal('facing'), ref: z.string(), offset: num.default(0) }),
  z.object({ kind: z.literal('along'), ref: z.string(), t: num.min(0).max(1), side: z.enum(['center', 'left', 'right']).default('center'), offset: num.default(0) }),
  z.object({ kind: z.literal('near'), ref: z.string(), dist: num.positive() }),
  z.object({ kind: z.literal('inside'), ref: z.string() }),
  z.object({ kind: z.literal('clear'), area: z.array(v2).min(3).max(64) }),
]);
export type Constraint = z.infer<typeof constraintSchema>;
const constraintsSchema = z.array(constraintSchema).max(8);

/** Public world meaning. It describes existing affordances; it never creates them. */
const publicText = (max: number) => z.string().trim().min(1).max(max).refine(s => !/[\u0000-\u001f\u007f]/.test(s), 'public text must be one line');
const aliasesSchema = z.array(publicText(80)).max(12);
export const partAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity'), ref: publicText(200), slot: publicText(100).optional() }),
  z.object({ kind: z.literal('local'), point: v3, stand: v3, level: z.number().int(), region: z.array(v2).min(3).max(64).optional() }),
]);
/** Camera coordinates belong to the owning entity's local frame; inherited movement carries the view. */
export const contextViewpointSchema = z.object({eye:v3,at:v3}).strict().refine(v=>Math.hypot(...v.eye.map((n,i)=>n-v.at[i]))>.01,'eye and at must differ');
export const contextFrontSchema = v2.refine(v=>Math.hypot(...v)>.000001,'front must have a nonzero direction').transform(v=>{const n=Math.hypot(...v);return [v[0]/n,v[1]/n] as [number,number];});
export const aboutPartSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/), title: publicText(60), what: publicText(400).optional(),
  aliases: aliasesSchema.optional(), anchor: partAnchorSchema.optional(), viewpoint: contextViewpointSchema.optional(), front: contextFrontSchema.optional(),
});
export const aboutSchema = z.object({
  title: publicText(60).optional(), what: publicText(400).optional(), aliases: aliasesSchema.optional(),
  kind: publicText(40).optional(), role: z.enum(['district', 'quarter', 'landmark', 'part', 'minor']).optional(),
  viewpoint: contextViewpointSchema.optional(), front: contextFrontSchema.optional(),
  in: publicText(200).optional(), salience: z.number().int().min(0).max(3).optional(),
  parts: z.array(aboutPartSchema).max(16).refine(parts => new Set(parts.map(p => p.id)).size === parts.length, 'part ids must be unique').optional(),
});
export const worldAboutSchema = z.object({
  title: publicText(60).optional(), what: publicText(400).optional(), tour: publicText(1200).optional(),
  districts: z.array(publicText(200)).max(64).optional(),
});
export type About = z.infer<typeof aboutSchema>;
export type AboutPart = z.infer<typeof aboutPartSchema>;
export type WorldAbout = z.infer<typeof worldAboutSchema>;

export const entitySchema = z.object({
  /** `e_…` for things; `h_…` for Souls' bodies, whose id is the engine's entity id (spec 31 §3 rule 3). */
  id: z.string().regex(/^[eh]_[a-z0-9]{4,12}$/),
  name: z.string().regex(NAME).optional(),
  def: z.string().regex(DEF_REF),
  in: z.object({ parent: z.union([z.literal('world'), z.string()]), slot: z.string().optional() }),
  p: z.union([v2, v3]).optional(),
  r: z.union([num, v3]).optional(),
  s: num.positive().optional(),
  shape: z.union([z.object({ path: z.array(v2).min(2).max(512), width: num.positive().optional() }), z.object({ area: z.array(v2).min(3).max(512) })]).optional(),
  anchor: z.enum(['base', 'center', 'conform', 'drape', 'float']).optional(),
  params: z.record(z.string(), value).optional(),
  state: z.record(z.string(), value).optional(),
  seed: z.number().int().optional(),
  constraints: constraintsSchema.optional(),
  about: aboutSchema.optional(),
  /** LAYERS (absent until the god uses them): owner, access, schedule, price. */
  owner: ownerRef.optional(),
  access: z.enum(ACCESS).optional(),
  schedule: scheduleSchema.optional(),
  price: priceSchema.optional(),
  by: z.string(), born: z.number().int(), v: z.number().int().default(1),
});
export type Entity = z.infer<typeof entitySchema>;

// ---------- world ----------

export const worldConstantsSchema = z.object({
  extent: num.positive().max(L.worldExtentM),                 // side length in metres; grows only
  ground: z.enum(['land', 'ocean', 'void']),
  base: num.default(0),
  seaLevel: num.optional(),
  limits: z.object({
    entities: z.number().int().positive().default(L.worldEntities),
    sizeMax: v3.default([...L.defSizeMaxM]),
    sizeMin: num.default(L.defSizeMinM),
    budget: z.object({ tris: z.number().int().positive().default(L.defTris), bytes: z.number().int().positive().default(L.assetBytes), texPx: z.number().int().positive().default(L.texturePx) }).prefault({}),
  }).prefault({}),
});
export type WorldConstants = z.infer<typeof worldConstantsSchema>;

/** Sky palettes the `world` op accepts. The viewer's lamps read night/midnight as night and dawn/dusk/sunset/twilight as half-night; the rest follow `sun`. */
/** Weather kinds of the `world` op (R4-LIVE): 'auto' follows the live worlds' schedule; 'manual' shows the channels as set. */
export const WEATHER_KINDS = ['auto', 'manual', 'clear', 'cloudy', 'rain', 'wind', 'fog', 'storm'] as const;
export const SKY_PALETTES = ['clear-day', 'golden-hour', 'dawn', 'sunset', 'dusk', 'twilight', 'night', 'midnight', 'mars-desert', 'lm-garden', 'eden-summer'] as const;
const strikeSchema = z.object({ x: num, z: num, n: z.number().int().min(1), tick: z.number().int().min(0) });
export const worldStateSchema = z.object({
  about: worldAboutSchema.optional(),
  sky: z.object({ palette: z.string().default('clear-day'), sun: num.min(0).max(1).default(0.6) }).prefault({}),
  time: z.object({ dayTicks: z.number().int().default(72000), startTick: z.number().int().default(0),
    /** R4-LIVE env setter: set the time of day to `hour` (0–24) once; `n` counts sets (the world clock applies each n once, moving forward). */
    set: z.object({ hour: num.min(0).max(24), n: z.number().int().min(1) }).nullable().optional(),
    /** The world clock stands still (the god paused time). */
    paused: z.boolean().default(false),
    /** Presentation season: the sky dates the clock to this month-day ("06-05"); the hour and every schedule stay the clock's. */
    calendar: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional() }).prefault({}),
  /** `kind` 'auto' = the scheduled weather of the live worlds (a kind per 2 h slot, seeded by the day, as on /w/eden); any
   *  other kind shows these channels as set (`setEnv` writes them from kind × intensity). 'storm' adds lightning and thunder. */
  weather: z.object({ clouds: num.min(0).max(1).default(0.1), wind: num.min(0).max(1).default(0.1), rain: num.min(0).max(1).default(0),
    fog: num.min(0).max(1).default(0), kind: z.enum(WEATHER_KINDS).default('auto'), intensity: num.min(0).max(1).default(1),
    /** GOD-ENV: the god's last lightning strike (x, z at `tick`; `n` counts strikes). Viewers draw it, Souls see and hear it. */
    strike: strikeSchema.nullable().optional(),
    /** WEATHER-RULES: a set rain/storm's length in world minutes (5…360) and its end tick (stamped by the `world` op). */
    minutes: num.min(5).max(360).nullable().optional(), until: z.number().int().nullable().optional() }).prefault({}),
  constitution: z.string().max(20000).default(''),
  /** What the bare ground is made of (L3): the terrain colouring reads it. */
  ground: z.object({ palette: z.enum(['grass', 'desert', 'dust', 'sand', 'snow', 'rock', 'garden', 'playa', 'meadow']).default('grass') }).prefault({}),
  /** LAYERS: currency, wallets, relationships. Absent until a layers op (economy, mint, pay, relate) makes it. */
  layers: layersStateSchema.optional(),
});
export type WorldState = z.infer<typeof worldStateSchema>;
/** A `world` op's state is a patch: no defaults (they would reset what it does not name); compile merges it per key and per field. */
export const worldPatchSchema = z.object({
  about: worldAboutSchema.nullable(),
  sky: z.object({ palette: z.string(), sun: num.min(0).max(1) }).partial(),
  time: z.object({ dayTicks: z.number().int(), startTick: z.number().int(), set: z.object({ hour: num.min(0).max(24), n: z.number().int().min(1) }).nullable(), paused: z.boolean(), calendar: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/) }).partial(),
  weather: z.object({ clouds: num.min(0).max(1), wind: num.min(0).max(1), rain: num.min(0).max(1), fog: num.min(0).max(1), kind: z.enum(WEATHER_KINDS), intensity: num.min(0).max(1), strike: strikeSchema.nullable(), minutes: num.min(5).max(360).nullable() }).partial(),
  constitution: z.string().max(20000),
  ground: z.object({ palette: worldStateSchema.shape.ground.unwrap().shape.palette.unwrap() }).partial(),
}).partial();

// ---------- edits ----------

const place = z.object({
  op: z.literal('place'), tmp: z.string().regex(/^\$[a-z0-9_-]{1,24}$/).optional(),
  def: z.string().regex(DEF_REF), name: z.string().regex(NAME).optional(),
  in: z.object({ parent: z.union([z.literal('world'), z.string()]), slot: z.string().optional() }).default({ parent: 'world' }),
  p: z.union([v2, v3]).optional(), r: z.union([num, v3]).optional(), s: num.positive().optional(),
  shape: entitySchema.shape.shape, anchor: entitySchema.shape.anchor,
  params: z.record(z.string(), value).optional(), state: z.record(z.string(), value).optional(), seed: z.number().int().optional(),
  constraints: constraintsSchema.optional(),
  owner: ownerRef.optional(), access: z.enum(ACCESS).optional(), schedule: scheduleSchema.optional(), price: priceSchema.optional(),
  about: aboutSchema.optional(),
  mode: z.enum(['strict', 'nudge']).default('strict'),
});
const remove = z.object({ op: z.literal('remove'), id: z.string(), cascade: z.boolean().default(true) });
const move = z.object({
  op: z.literal('move'), id: z.string(),
  in: z.object({ parent: z.union([z.literal('world'), z.string()]), slot: z.string().optional() }).optional(),
  p: z.union([v2, v3]).optional(), r: z.union([num, v3]).optional(), s: num.positive().optional(), shape: entitySchema.shape.shape,
  constraints: constraintsSchema.optional(),
  mode: z.enum(['strict', 'nudge']).default('strict'),
});
const set = z.object({ op: z.literal('set'), id: z.string(), state: z.record(z.string(), value).optional(), params: z.record(z.string(), value).optional(), name: z.string().regex(NAME).optional(), constraints: constraintsSchema.optional(),
  about: aboutSchema.nullable().optional(),
  /** LAYERS: null clears. */
  owner: ownerRef.nullable().optional(), access: z.enum(ACCESS).nullable().optional(), schedule: scheduleSchema.nullable().optional(), price: priceSchema.nullable().optional() });
/** LAYERS ops. economy: the world's currency name. mint: the god adds (or, negative, takes) money. pay: money moves
 *  between wallets (never below zero). relate: a relationship on (or off). Each inverts exactly. */
const economy = z.object({ op: z.literal('economy'), currency: z.string().min(1).max(24).nullable() });
const mint = z.object({ op: z.literal('mint'), to: ownerRef, amount: z.number().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'amount must not be 0') });
const pay = z.object({ op: z.literal('pay'), from: ownerRef, to: ownerRef, amount: z.number().positive().max(1_000_000), for: z.string().max(120).optional() });
const relate = z.object({ op: z.literal('relate'), a: relRef, rel: z.enum(RELATIONS), b: relRef, on: z.boolean().default(true) });
/** Deep-copy a subtree with fresh ids. `count` copies stepping by `step` [dx, dz] from `p` (or from the source). */
const clone = z.object({
  op: z.literal('clone'), id: z.string(), tmp: z.string().regex(/^\$[a-z0-9_-]{1,24}$/).optional(), name: z.string().regex(NAME).optional(),
  in: z.object({ parent: z.union([z.literal('world'), z.string()]), slot: z.string().optional() }).optional(),
  p: z.union([v2, v3]).optional(), r: z.union([num, v3]).optional(),
  count: z.number().int().min(1).max(64).default(1), step: v2.optional(),
  mode: z.enum(['strict', 'nudge']).default('strict'),
});
const define = z.object({ op: z.literal('define'), def: defSchema });
// W1: retire an unused local ref; hashed content remains available to undo.
const undefine = z.object({ op: z.literal('undefine'), ref: z.string() });
const world = z.object({ op: z.literal('world'), state: worldPatchSchema });
/** Grow the world: `extent` = a centred square of that side (the original form); `bounds` = [x0, z0, x1, z1] metres, any
 *  direction (GOD-ENV: "extend the world east by 300 m"), each side ≤ 16 km. Grows only; its inverse (trusted) shrinks back. */
const expand = z.object({ op: z.literal('expand'), extent: num.positive().max(16000).optional(), bounds: z.tuple([num, num, num, num]).optional() });
const answer = z.object({ op: z.literal('answer'), prayer: z.string(), text: z.string().max(4000) });
/** Internal: restore a previously removed entity verbatim (inverse of remove). Never accepted from clients. */
const restore = z.object({ op: z.literal('restore'), entity: entitySchema });
/** Internal: restore the active revision of an already stored definition. */
const restoreDef = z.object({ op: z.literal('restore-def'), ref: z.string(), hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Only geometry fields changed by admission/preparation are restored; unrelated later state edits survive. */
  instances: z.array(z.object({ entity: entitySchema, fields: z.array(z.enum(['p', 'r', 'shape', 'params'])) })).optional(),
});
const reviveDef = z.object({ op: z.literal('revive-def'), ref: z.string(), hash: z.string().regex(/^[0-9a-f]{64}$/) });

export const opSchema = z.discriminatedUnion('op', [place, remove, move, set, clone, define, undefine, world, expand, answer, restore, restoreDef, reviveDef, economy, mint, pay, relate]);
export type Op = z.infer<typeof opSchema>;
export const clientOpSchema = z.discriminatedUnion('op', [place, remove, move, set, clone, define, undefine, world, expand, answer, economy, mint, pay, relate]);

export const batchSchema = z.object({
  schema: z.literal(EDIT_SCHEMA).default(EDIT_SCHEMA),
  ops: z.array(clientOpSchema).min(1).max(L.batchOps),
  clientRef: z.string().max(100).optional(),
  note: z.string().max(400).optional(),
  /** A named edit group ("duck family"): reviewable and undoable as a whole. */
  group: z.string().max(60).optional(),
});
export type Batch = z.infer<typeof batchSchema>;
/** Server-internal: stored inverses may restore content or be empty (an accepted no-op revert). */
export const trustedBatchSchema = batchSchema.extend({ ops: z.array(opSchema).max(L.batchOps) });

export type Failure = {
  op: number; code: string; detail: string;
  /** Repair context, additive so existing clients can continue to use code/detail. */
  field?: string; fix?: string; measured?: unknown; limit?: unknown; def?: string; entity?: string;
  suggest?: { p?: [number, number] | [number, number, number]; r?: number };
};
/** G1: a resident a god edit walked out of its way (relocated only with no walking route; `stopped`: it was only on
 *  its way to a seat the edit changes, so its act ended where it stood), the reason it was told, what it let go of
 *  (seat, bed, held things) and, when it held things, where they were set down. `level`: an upstairs exit on the
 *  resident's own floor (absent: the ground). */
export type ResidentMove = { soulId: string; body: string; name: string; how: 'walked' | 'relocated' | 'stopped'; from: [number, number]; to: [number, number]; level?: number; reason: string; released: string[]; dropAt?: [number, number, number]; place?: string };
export type Accepted = { accepted: true; seq: number; undoId: string; ids: Record<string, string>; warnings: string[]; moved?: ResidentMove[]; replayed?: true };
export type Refused = { accepted: false; failures: Failure[] };
export type Result = Accepted | Refused;

export const refusalCodes = [
  'schema', 'def.unknown', 'def.budget', 'def.expansion', 'def.invalid', 'def.in-use',
  'parent.unknown', 'slot.unknown', 'slot.incompatible', 'slot.full', 'slot.outside',
  'size.range', 'size.furnished', 'extent.outside', 'overlap.solid', 'support.none', 'body.protected',
  'constant.immutable', 'float.no-water', 'constraint.unsatisfied', 'architecture', 'architecture.sealed', 'architecture.unreachable', 'architecture.headroom', 'entity.unknown', 'entity.limit', 'name.taken', 'params.invalid', 'state.invalid', 'undo.conflict',
  'wallet.insufficient', 'relation.invalid', 'handling.crew', 'handling.grips', 'handling.mass', 'handling.reach',
  'request.conflict', 'request.budget', 'revision.stale', 'asset.invalid', 'asset.budget', 'budget.world', 'budget.region',
] as const;
export type RefusalCode = (typeof refusalCodes)[number];
