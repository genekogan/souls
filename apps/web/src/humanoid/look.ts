// core/humanoid@2 looks: the def's params are the truth; this module resolves, canonicalises, keys,
// randomises (seeded) and turns a look into palette colours. Pure (no three.js, no DOM) and node
// strip-types safe, so the server, the CLI tooling and the viewer share it.
import {checkFields, sha256Hex, stableStringify, type Field, type Value} from '@souls/world-compiler';
// lane PERF2: only this def, not CORE_KIT (which put the whole core kit into the web bundle)
import {HUMANOID2_DEF as DEF} from '@souls/world-compiler/humanoid2';
/** The def's params (typed fields). Every look key is one of these. */
export const HUMANOID_PARAMS = DEF.params as Readonly<Record<string, Field>>;
export const HUMANOID_REF = 'core/humanoid@2';
/** Template keys double as the body record's `model` (BODY-v1 model regex: [a-z0-9-]{1,64}). */
export const LOOK_KEY_PREFIX = 'humanoid2-';

type EnumField = Extract<Field, {type: 'enum'}>;
const values = (k: string) => (HUMANOID_PARAMS[k] as EnumField).values;
/** Kit faces whose head part carries its own headgear (hat, crown, helmet, hood: kit landmark top above 1.84 m). They take
 *  no extra hat or glasses and hide hair as a hat does; seeded looks never pick them. */
export const HEADGEAR_FACES: ReadonlySet<string> = new Set(['farmer', 'king', 'spacesuit', 'swat', 'worker', 'woman-medieval', 'woman-witch', 'woman-worker']);
const CLASSIC = {face: ['open', 'pierced', 'soft'], hair: ['short', 'mohawk', 'bob', 'bald']};
export const PART_SLOTS = ['face', 'hair', 'top', 'bottom', 'shoes'] as const;
export const PROP_SLOTS = ['hat', 'glasses', 'bag'] as const;
/** Looks v2 accessories (facial hair, scarf, gloves, mask, jewellery), drawn by props.ts. */
export const ACCESSORY_SLOTS = ['facialHair', 'scarf', 'gloves', 'mask', 'jewellery'] as const;
export const COLOR_KEYS = ['skin', 'hair1', 'brows', 'eyes', 'top1', 'top2', 'bottom1', 'shoes1', 'soles', 'accent', 'gear', 'accessory'] as const;
/** Params added after looks v1: a look with all of them at their defaults keeps its v1 template key (lookKey). */
/** Looks v2 body shape: shoulder width, chest and hip girth, weight (belly and limbs); 1 = today's body. */
export const SHAPE_KEYS = ['shoulders', 'chest', 'hips', 'weight'] as const;
export const V2_KEYS = [...ACCESSORY_SLOTS, 'accessory', ...SHAPE_KEYS] as const;
export type Look = {
  preset: 'none' | 'casual' | 'punk' | 'woman'; frame: 'masc' | 'fem';
  face: string; hair: string; top: string; bottom: string; shoes: string;
  hat: string; glasses: string; bag: string; pattern: 'plain' | 'stripes' | 'checks' | 'knit';
  shoulders: number; chest: number; hips: number; weight: number;
  facialHair: 'none' | 'mustache' | 'goatee' | 'beard'; scarf: 'none' | 'scarf'; gloves: 'none' | 'gloves'; mask: 'none' | 'cloth'; jewellery: 'none' | 'earrings' | 'necklace' | 'both'; accessory: string;
  /** Physical/size params (engine bodies/humanoid.ts): head size (drawn only), height m, build (girth), walking speed m/s. */
  headSize: number; height: number; build: number; walkSpeed: number;
  skin: string; hair1: string; brows: string; eyes: string; top1: string; top2: string; bottom1: string; shoes1: string; soles: string; accent: string; gear: string;
};
export const PRESETS = ['casual', 'punk', 'woman'] as const;
/** The size params: they combine with a preset (a classic look can be taller, broader or walk slower). */
export const SIZE_KEYS = ['headSize', 'height', 'build', 'walkSpeed'] as const;
type SizeKey = typeof SIZE_KEYS[number];
const SIZE_STEP: Record<SizeKey, number> = {headSize: 0.005, height: 0.01, build: 0.01, walkSpeed: 0.01};
const round = (v: number, step: number) => +(Math.round(v / step) * step).toFixed(4);
export type Preset = typeof PRESETS[number];

const NO_ACCESSORIES = {facialHair: 'none', scarf: 'none', gloves: 'none', mask: 'none', jewellery: 'none', accessory: '#a03a3a', shoulders: 1, chest: 1, hips: 1, weight: 1} as const;
/** Legacy looks as explicit params (sRGB hex of the shipped GLBs' baseColorFactor). The viewer uses the kit's
 *  exact linear factors while `preset` is set; these hex values are what an owner edits from. */
export const PRESET_LOOKS: Readonly<Record<Preset, Omit<Look, 'preset'>>> = Object.freeze({
  casual: {frame: 'masc', face: 'open', hair: 'short', top: 'shirt', bottom: 'jeans', shoes: 'sneakers', hat: 'none', glasses: 'none', bag: 'none', pattern: 'plain', headSize: 1, height: 1.75, build: 1, walkSpeed: 1.35,
    skin: '#cead86', hair1: '#492e18', brows: '#3e3429', eyes: '#31251c', top1: '#969083', top2: '#b4b4b4', bottom1: '#333f47', shoes1: '#7d2734', soles: '#b4b4b4', accent: '#af8749', gear: '#3c5a6e', ...NO_ACCESSORIES},
  punk: {frame: 'masc', face: 'pierced', hair: 'mohawk', top: 'jacket', bottom: 'ripped', shoes: 'boots', hat: 'none', glasses: 'none', bag: 'none', pattern: 'plain', headSize: 1, height: 1.75, build: 1, walkSpeed: 1.35,
    skin: '#cead86', hair1: '#7c0f1f', brows: '#3e3429', eyes: '#31251c', top1: '#242424', top2: '#b4b4b4', bottom1: '#333f47', shoes1: '#242424', soles: '#242424', accent: '#af8749', gear: '#3c5a6e', ...NO_ACCESSORIES},
  woman: {frame: 'fem', face: 'soft', hair: 'bob', top: 'tank', bottom: 'slacks', shoes: 'flats', hat: 'none', glasses: 'none', bag: 'none', pattern: 'plain', headSize: 1, height: 1.75, build: 1, walkSpeed: 1.35,
    skin: '#cead86', hair1: '#8b7547', brows: '#3e3429', eyes: '#31251c', top1: '#b4b4b4', top2: '#b4b4b4', bottom1: '#9e6238', shoes1: '#3f3f3f', soles: '#3f3f3f', accent: '#af8749', gear: '#3c5a6e', ...NO_ACCESSORIES},
});

export class LookError extends Error {}
/** Validate a (partial) params object against the def; unknown keys and bad values are refused. */
export function checkLook(params: unknown): Partial<Look> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new LookError('look must be an object');
  if (Object.keys(params).length > 48) throw new LookError('look has at most 48 keys');
  const r = checkFields(HUMANOID_PARAMS as Record<string, Field>, params as Record<string, Value>, false);
  if (!r.ok) throw new LookError(r.detail);
  return r.values as Partial<Look>;
}
/** Full look: defaults filled, a preset expanded to its exact parts and colours (preset kept as the marker that
 *  the kit's exact legacy palette applies; the size params still apply), sizes rounded so keys are stable. */
export function resolveLook(params: unknown): Look {
  const p = checkLook(params ?? {});
  const filled = checkFields(HUMANOID_PARAMS as Record<string, Field>, p as Record<string, Value>, true);
  if (!filled.ok) throw new LookError(filled.detail);
  const v = filled.values as unknown as Look;
  const size = {...Object.fromEntries(SIZE_KEYS.map(k => [k, round(v[k], SIZE_STEP[k])])), ...Object.fromEntries(SHAPE_KEYS.map(k => [k, round(v[k], 0.01)]))} as Record<SizeKey | typeof SHAPE_KEYS[number], number>;
  // a preset keeps its exact parts and colours; sizes and the v2 accessories still apply
  if (v.preset !== 'none') return {preset: v.preset, ...PRESET_LOOKS[v.preset], ...Object.fromEntries(V2_KEYS.map(k => [k, v[k]])), ...size};
  return {...v, ...size};
}
/** The minimal stored form: only keys that differ from the def defaults (a preset look stores just `preset`). */
export function compactLook(look: Look): Partial<Look> {
  const out: Record<string, Value> = {};
  if (look.preset !== 'none') { out.preset = look.preset; for (const k of [...SIZE_KEYS, ...V2_KEYS]) if (look[k] !== HUMANOID_PARAMS[k].default) out[k] = look[k]; return out as Partial<Look>; }
  for (const [k, f] of Object.entries(HUMANOID_PARAMS)) if ((look as Record<string, unknown>)[k] !== f.default) out[k] = (look as Record<string, Value>)[k];
  return out as Partial<Look>;
}
/** Template key: equal looks share one composed template. */
export function lookKey(params: unknown): string {
  const look: Record<string, unknown> = {...resolveLook(params)};
  for (const k of V2_KEYS) if (look[k] === HUMANOID_PARAMS[k].default) delete look[k]; // v1 looks keep their keys
  return LOOK_KEY_PREFIX + sha256Hex(stableStringify(look)).slice(0, 16);
}
/** Apply owner edits on top of a current look: a preset is expanded first, so editing one part keeps the rest.
 *  Size edits (head size, height, build, walking speed) keep a preset; choosing a preset is that classic look exactly
 *  (today's sizes) unless the same edit names sizes too. */
export function editLook(current: unknown, edits: unknown): Look {
  const base = resolveLook(current ?? {}), e = checkLook(expandOutfit(edits));
  const sizes = Object.fromEntries(SIZE_KEYS.map(k => [k, base[k]]));
  const keepsPreset = (k: string) => (SIZE_KEYS as readonly string[]).includes(k) || (V2_KEYS as readonly string[]).includes(k);
  if (e.preset && e.preset !== 'none') return resolveLook({...pickSizes(e), preset: e.preset});
  if (base.preset !== 'none' && Object.keys(e).every(keepsPreset)) return resolveLook({...pickV2(base), preset: base.preset, ...sizes, ...e});
  return resolveLook({...base, preset: 'none', ...e});
}
// ---------- outfits ----------

/** Outfit presets: `outfit=<id>` in a look edit sets top, bottom and shoes (and their colours and pattern) in one go;
 *  other keys of the same edit apply after it (`outfit=suit top1=#222222`). Not a stored param: the parts are. */
export const OUTFITS: Readonly<Record<string, Partial<Look>>> = Object.freeze({
  casual: {top: 'shirt', bottom: 'jeans', shoes: 'sneakers', pattern: 'plain', top1: '#969083', top2: '#b4b4b4', bottom1: '#333f47', shoes1: '#7d2734', soles: '#b4b4b4'},
  hoodie: {top: 'casual-hoodie', bottom: 'casual-hoodie', shoes: 'casual-hoodie', pattern: 'plain', top1: '#4e8664', top2: '#e0d8c8', bottom1: '#2a2a2e', shoes1: '#f0eee6', soles: '#e8e4dc'},
  suit: {top: 'suit', bottom: 'suit', shoes: 'suit', pattern: 'plain', top1: '#2d3a52', top2: '#f0eee6', bottom1: '#2d3a52', shoes1: '#242424', soles: '#242424'},
  formal: {top: 'woman-formal', bottom: 'woman-formal', shoes: 'woman-formal', pattern: 'plain', top1: '#784f75', top2: '#e0d8c8', bottom1: '#2a2a2e', shoes1: '#242424', soles: '#242424'},
  punk: {top: 'jacket', bottom: 'ripped', shoes: 'boots', pattern: 'plain', top1: '#242424', top2: '#b4b4b4', bottom1: '#333f47', shoes1: '#242424', soles: '#242424'},
  beach: {top: 'beach', bottom: 'beach', shoes: 'beach', pattern: 'stripes', top1: '#307589', top2: '#f0eee6', bottom1: '#c0a554', shoes1: '#8c6b4a', soles: '#e8e4dc'},
  adventurer: {top: 'adventurer', bottom: 'adventurer', shoes: 'adventurer', pattern: 'plain', top1: '#6e7b4c', top2: '#d0c6a8', bottom1: '#6b5a48', shoes1: '#4c352d', soles: '#242424'},
  farmer: {top: 'farmer', bottom: 'farmer', shoes: 'farmer', pattern: 'checks', top1: '#a03a3a', top2: '#e0d8c8', bottom1: '#26384a', shoes1: '#4c352d', soles: '#242424'},
  worker: {top: 'worker', bottom: 'worker', shoes: 'worker', pattern: 'plain', top1: '#d07a2a', top2: '#3a3a3a', bottom1: '#26384a', shoes1: '#4c352d', soles: '#242424'},
  medieval: {top: 'woman-medieval', bottom: 'woman-medieval', shoes: 'woman-medieval', pattern: 'plain', top1: '#2f6b4f', top2: '#d0c6a8', bottom1: '#4b433b', shoes1: '#4c352d', soles: '#242424'},
  scifi: {top: 'woman-scifi', bottom: 'woman-scifi', shoes: 'woman-scifi', pattern: 'plain', top1: '#e0d8c8', top2: '#5f8fb0', bottom1: '#8a8f96', shoes1: '#3a3a3a', soles: '#242424'},
  soldier: {top: 'woman-soldier', bottom: 'woman-soldier', shoes: 'woman-soldier', pattern: 'plain', top1: '#596353', top2: '#3d4d3c', bottom1: '#596353', shoes1: '#2c3538', soles: '#242424'},
  king: {top: 'king', bottom: 'king', shoes: 'king', pattern: 'plain', top1: '#7c0f1f', top2: '#c5a154', bottom1: '#45415e', shoes1: '#4c352d', soles: '#242424'},
  witch: {top: 'woman-witch', bottom: 'woman-witch', shoes: 'woman-witch', pattern: 'plain', top1: '#2a2a2e', top2: '#5b3c8c', bottom1: '#2a2a2e', shoes1: '#242424', soles: '#242424'},
});
/** An edit's `outfit` key expanded into its parts and colours (explicit keys of the same edit win). */
export function expandOutfit(edits: unknown): unknown {
  if (!edits || typeof edits !== 'object' || Array.isArray(edits) || !('outfit' in edits)) return edits;
  const {outfit, ...rest} = edits as Record<string, unknown>;
  if (typeof outfit !== 'string' || !Object.hasOwn(OUTFITS, outfit)) throw new LookError(`outfit must be one of: ${Object.keys(OUTFITS).join(', ')}`);
  return {...OUTFITS[outfit], ...rest};
}
const pickV2 = (l: Look) => Object.fromEntries(V2_KEYS.map(k => [k, l[k]]));
const pickSizes = (e: Partial<Look>) => Object.fromEntries(SIZE_KEYS.filter(k => e[k] !== undefined).map(k => [k, e[k]]));

// ---------- seeded looks ----------

/** mulberry32: small, fast, deterministic across engines. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function seedOf(id: string) { let h = 2166136261; for (const b of new TextEncoder().encode(id)) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return h; }
const SKIN = ['#f3d4bc', '#ebc29f', '#dcae86', '#cead86', '#c99a6e', '#b97750', '#a8683f', '#8f5b3f', '#7a4a30', '#64391f', '#4e2c1a', '#3b2216'];
const HAIR = ['#1d1714', '#2b1d14', '#3d2617', '#4f3320', '#6b4428', '#8a5a33', '#a8743f', '#c49a5f', '#ddc28e', '#8e8a85', '#cfccc6', '#7c2a14'];
const DYED = ['#7c0f1f', '#2c4f8c', '#2f6b4f', '#b04a8a', '#5b3c8c', '#d07a2a'];
const EYES = ['#31251c', '#4a3020', '#5e4a2a', '#3e5a3a', '#3f5f7a', '#5a6670'];
const CLOTH = ['#969083', '#356477', '#bd623c', '#c58a2e', '#7855a8', '#26382e', '#4e8664', '#784f75', '#307589', '#c0a554', '#a03a3a', '#e0d8c8',
  '#2d3a52', '#6e7b4c', '#d9a6a0', '#3a3a3a', '#f0eee6', '#8c6b4a', '#5f8fb0', '#b5654a', '#4b6b8a', '#9a9a52', '#c9b8d8', '#1f4f4f'];
const BOTTOMS = ['#333f47', '#26384a', '#303b43', '#45415e', '#3d4d3c', '#4b433b', '#596353', '#9e6238', '#2a2a2e', '#6b5a48', '#8a8f96', '#1f2f45'];
const SHOES = ['#7d2734', '#242424', '#3f3f3f', '#4c352d', '#2c3538', '#e0d8c8', '#8c6b4a', '#2d3a52', '#a03a3a', '#f0eee6'];
const SOLES = ['#b4b4b4', '#e8e4dc', '#242424', '#6b5a48'];
const GEAR = ['#3c5a6e', '#7d5a3a', '#4e6b3c', '#a8743f', '#3a3a3a', '#8c3a3a', '#d0c6a8', '#2d3a52', '#c58a2e', '#5b3c8c'];
const ACCENT = ['#af8749', '#c5a154', '#adb7bc', '#2a2a2a', '#8c3a3a'];
const pickW = <T,>(r: () => number, items: readonly (readonly [T, number])[]) => { let x = r() * items.reduce((a, [, w]) => a + w, 0); for (const [v, w] of items) { if ((x -= w) < 0) return v; } return items[items.length - 1][0]; };
const pick = <T,>(r: () => number, items: readonly T[]) => items[Math.floor(r() * items.length) % items.length];
const darken = (hex: string, k: number) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
/** A complete, varied, plausible look from a seed (births and `body look --random`). Owner choices override;
 *  the stored params are the truth, never the seed. */
export function appearanceFromSeed(seed: number): Look {
  const r = rng(seed);
  const frame = r() < 0.5 ? 'masc' : 'fem';
  // faces and hair follow the frame (the women's pack's on fem, the men's on masc; the classic three keep their weight);
  // faces with built-in headgear (HEADGEAR_FACES) are chosen, never seeded; clothes mix across every character
  const fems = (k: 'face' | 'hair') => values(k).filter(v => v.startsWith('woman-') && !HEADGEAR_FACES.has(v)), mascs = (k: 'face' | 'hair') => values(k).filter(v => !v.startsWith('woman-') && !CLASSIC[k].includes(v) && v !== 'bald' && !HEADGEAR_FACES.has(v));
  const hair = pickW(r, frame === 'fem' ? [['bob', 4], ['short', 1.5], ['mohawk', 0.7], ['bald', 0.4], ...fems('hair').map(v => [v, 0.8] as const)] : [['short', 4], ['bob', 0.8], ['mohawk', 1.2], ['bald', 1.2], ...mascs('hair').map(v => [v, 0.8] as const)]);
  const top = pick(r, values('top')), bottom = pick(r, values('bottom')), shoes = pick(r, values('shoes'));
  const face = pickW(r, frame === 'fem' ? [['soft', 3], ['open', 0.6], ...fems('face').map(v => [v, 0.8] as const)] : [['open', 3], ['pierced', 1.2], ...mascs('face').map(v => [v, 0.8] as const)]);
  const hair1 = r() < 0.14 ? pick(r, DYED) : pick(r, HAIR);
  const top1 = pick(r, CLOTH); let top2 = pick(r, CLOTH); if (top2 === top1) top2 = CLOTH[(CLOTH.indexOf(top1) + 7) % CLOTH.length];
  const look: Look = {preset: 'none', frame, face, hair, top, bottom, shoes,
    hat: pickW(r, [['none', 6], ['cap', 1.4], ['beanie', 1.2], ['sunhat', 1]] as const),
    glasses: pickW(r, [['none', 6.5], ['round', 1.2], ['square', 1.2], ['shades', 1]] as const),
    bag: pickW(r, [['none', 6], ['backpack', 2], ['satchel', 1.5]] as const),
    pattern: pickW(r, [['plain', 5.5], ['stripes', 2], ['checks', 1.5], ['knit', 1]] as const),
    headSize: Math.round((0.98 + r() * 0.04) * 200) / 200,
    skin: pick(r, SKIN), hair1, brows: darken(hair1, 0.8), eyes: pick(r, EYES), top1, top2, bottom1: pick(r, BOTTOMS), shoes1: pick(r, SHOES), soles: pick(r, SOLES), accent: pick(r, ACCENT), gear: pick(r, GEAR),
    height: 1.75, build: 1, walkSpeed: 1.35, ...NO_ACCESSORIES};
  // sizes are drawn last so the seeded parts and colours above stay what they were: a subtle spread of heights
  // (fem frame a little shorter; 1.65–1.81 m) and builds (0.97–1.03); the walking speed stays today's
  look.height = round((frame === 'fem' ? 1.70 : 1.76) + (r() + r() - 1) * 0.05, 0.01);
  look.build = round(0.97 + r() * 0.06, 0.01);
  // looks v2 accessories are drawn after everything else, so every earlier seeded value is unchanged
  look.facialHair = frame === 'masc' ? pickW(r, [['none', 7], ['mustache', 0.6], ['goatee', 0.8], ['beard', 1.2]] as const) : 'none';
  look.scarf = r() < 0.06 ? 'scarf' : 'none'; look.gloves = 'none'; look.mask = 'none';
  look.jewellery = pickW(r, [['none', 8], ['earrings', frame === 'fem' ? 1.5 : 0.5], ['necklace', 0.6]] as const);
  if (look.scarf !== 'none') look.accessory = pick(r, CLOTH);
  return resolveLook(look);
}

// ---------- body records ----------

export const LOOK_MODEL = /^humanoid2-[0-9a-f]{16}$/;
/** The BODY-v1 record of a composed look: family humanoid, model = template key, params = compact look. */
export function lookBody(params: unknown): {family: 'humanoid'; model: string; params: Partial<Look>} {
  const look = resolveLook(params);
  return {family: 'humanoid', model: lookKey(look), params: compactLook(look)};
}
/** An owner's look request applied to a current body (PUT /v1/edge/body {look}): edits, a preset, or random.
 *  `{random: true, seed?}` draws a seeded look; any other keys are params edits over the current look. */
export function lookRequest(current: unknown, request: unknown, fallbackLook: unknown, randomSeed: () => number): {family: 'humanoid'; model: string; params: Partial<Look>} {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new LookError('look must be an object');
  const r = request as Record<string, unknown>;
  if (r.random === true) {
    const keys = Object.keys(r).filter(k => k !== 'random' && k !== 'seed'); if (keys.length) throw new LookError('random takes only an optional seed');
    if (r.seed !== undefined && (typeof r.seed !== 'number' || !Number.isInteger(r.seed) || r.seed < 0 || r.seed > 0xffffffff)) throw new LookError('seed must be an integer 0..4294967295');
    return lookBody(appearanceFromSeed(r.seed === undefined ? randomSeed() : r.seed as number));
  }
  const cur = current && typeof current === 'object' && (current as {params?: unknown}).params ? (current as {params: unknown}).params : fallbackLook;
  return lookBody(editLook(cur, r));
}

// ---------- legacy migration ----------

/** Today's look for a body that has no params: PEOPLE[hashId(id) % 3] (humans.ts templateFor). */
export function legacyPreset(entityId: string): Preset {
  let h = 0; for (const c of entityId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PRESETS[h % PRESETS.length];
}

// ---------- palette ----------

/** Palette slot order of the kit (kit.json `slots`; asserted equal in the kit test). */
export const SLOTS = ['skin', 'skinShade', 'hair', 'hairShade', 'brows', 'eyes', 'top1', 'top2', 'bottom', 'shoes', 'soles', 'accent', 'gear', 'gearDark', 'lens', 'spare'] as const;
export type Slot = typeof SLOTS[number];
const lin = (hex: string): [number, number, number] => [1, 3, 5].map(i => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }) as [number, number, number];
const LEGACY_SKIN_SHADE = [0.486888 / 0.617207, 0.33064 / 0.417885, 0.189617 / 0.238398]; // Skin_Darker / Skin (presets.mjs rule)
const PATTERN_ID = {plain: 0, stripes: 1, checks: 2, knit: 3} as const;
/** Linear RGB per palette slot (16 × 3) and the pattern id. `legacy` = the kit's exact factors for a preset. */
export function paletteOf(look: Look, legacy?: Partial<Record<Slot, readonly number[]>>): {palette: Float32Array; pattern: number} {
  const c: Record<Slot, readonly number[]> = {
    skin: lin(look.skin), skinShade: lin(look.skin).map((v, i) => v * LEGACY_SKIN_SHADE[i]), hair: lin(look.hair1), hairShade: lin(look.hair1).map(v => v * 0.62),
    brows: lin(look.brows), eyes: lin(look.eyes), top1: lin(look.top1), top2: lin(look.top2), bottom: lin(look.bottom1), shoes: lin(look.shoes1), soles: lin(look.soles),
    accent: lin(look.accent), gear: lin(look.gear), gearDark: lin(look.gear).map(v => v * 0.35), lens: lin('#16191d'), spare: lin(look.accessory)}; // 'spare' (unused by every kit part) carries the accessory colour
  if (look.preset !== 'none' && legacy) for (const [k, v] of Object.entries(legacy)) if (v) c[k as Slot] = v;
  const palette = new Float32Array(SLOTS.length * 3);
  SLOTS.forEach((s, i) => palette.set(c[s], i * 3));
  return {palette, pattern: PATTERN_ID[look.pattern]};
}
/** Short human summary for CLI/panel output. */
export function describeLook(look: Look): string {
  const size = [look.height !== 1.75 ? `${look.height.toFixed(2)} m` : '', look.build < 0.97 ? 'slim' : look.build > 1.03 ? 'broad' : '', look.headSize !== 1 ? `head ${Math.round(look.headSize * 100)} %` : '', look.walkSpeed !== 1.35 ? `walks ${look.walkSpeed.toFixed(2)} m/s` : '',
    ...SHAPE_KEYS.filter(k => look[k] !== 1).map(k => `${k} ${Math.round(look[k] * 100)} %`)].filter(Boolean);
  if (look.preset !== 'none') return `preset ${look.preset}${size.length ? ', ' + size.join(', ') : ''}`;
  const extras = [look.hat !== 'none' ? look.hat : '', look.glasses !== 'none' ? `${look.glasses} glasses` : '', look.bag !== 'none' ? look.bag : '', look.pattern !== 'plain' ? `${look.pattern} top` : '',
    look.facialHair !== 'none' ? look.facialHair : '', look.scarf !== 'none' ? 'scarf' : '', look.gloves !== 'none' ? 'gloves' : '', look.mask !== 'none' ? `${look.mask} mask` : '', look.jewellery !== 'none' ? (look.jewellery === 'both' ? 'earrings and necklace' : look.jewellery) : ''].filter(Boolean);
  return `${look.frame} frame, ${look.face} face, ${look.hair} hair, ${look.top}, ${look.bottom}, ${look.shoes}${extras.length ? ', ' + extras.join(', ') : ''}${size.length ? ', ' + size.join(', ') : ''}`;
}
