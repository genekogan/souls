// CTRL-1 (#1093, A1, A4): an offer's parameters as data. An offer's own `params` win; a verb's shared parameters come
// from this one table (the ones `/v1/edge/schema` used to describe in prose). A response carries the table once per
// verb (`paramsByVerb`), so 100 walks don't repeat it.
import type {EdgeCapability} from '../contract.ts';

export type ParamSpec = {type: string; optional?: boolean; required?: boolean; enum?: readonly unknown[]; min?: number; max?: number; maxLength?: number; maxItems?: number; pattern?: string; default?: unknown; items?: unknown; description?: string};
export type ParamSchema = Record<string, ParamSpec>;

const seconds = (min: number, max: number, dflt?: number): ParamSpec => ({type: 'integer', optional: true, min, max, ...(dflt !== undefined ? {default: dflt} : {})});
const WITH: ParamSpec = {type: 'array', optional: true, items: 'Soul id or name', maxItems: 6, description: 'invite them; each chooses'};
const VIA: ParamSpec = {type: 'array', optional: true, items: 'place id', maxItems: 4, description: 'walked first, in order'};
const WALK: ParamSchema = {via: VIA, with: WITH};
const SITTING: ParamSchema = {seconds: seconds(1, 600, 60), with: WITH};
const ACTIVITY: ParamSchema = {seconds: seconds(1, 1800)};
const AT: ParamSpec = {type: 'any', optional: true, description: 'a Soul, place or thing to face'};

const VERB_PARAMS: Record<string, ParamSchema> = {
  walk: WALK, jog: WALK, run: WALK, 'go-near': WALK,
  stroll: {...WALK, pause: {type: 'integer', optional: true, min: 0, max: 60, default: 4}},
  'hang-out': {...WALK, seconds: seconds(1, 1800)}, gather: {...WALK, seconds: seconds(1, 1800)}, 'warm-by-fire': {...WALK, seconds: seconds(5, 600, 120)},
  wander: {seconds: seconds(5, 300, 60)},
  sit: SITTING, rest: SITTING, 'sit-ground': SITTING, lie: SITTING, nap: SITTING,
  follow: {seconds: seconds(1, 3600, 600)},
  wave: {to: AT, at: AT, seconds: seconds(1, 60)},
  read: {...ACTIVITY, book: {type: 'string', optional: true, maxLength: 100, description: 'a catalogue book id'}},
  write: {...ACTIVITY, title: {type: 'string', optional: true, maxLength: 100}, text: {type: 'string', optional: true, maxLength: 2000}},
  'use-computer': {...ACTIVITY, query: {type: 'string', optional: true, maxLength: 200}},
  'post-letter': {to: {type: 'string', optional: true, description: 'Soul id or name'}, text: {type: 'string', optional: true, maxLength: 2000}},
  make: {title: {type: 'string', optional: true, maxLength: 60}, text: {type: 'string', optional: true, maxLength: 500}, form: {type: 'string', optional: true, enum: ['note', 'sign', 'offering', 'proposal']}},
};
/** Verbs whose whole parameter list is known: another name is a mistake worth saying. Everywhere else an undeclared name
 *  is left to the plan that reads it, so a gap in this table can't refuse an act that works. */
const CLOSED = new Set(['walk', 'jog', 'run', 'go-near', 'stroll', 'wander', 'stand', 'face']);

/** The shared parameters of the verbs asked for, for a response's `paramsByVerb`. */
export function paramsByVerb(verbs: Iterable<string>): Record<string, ParamSchema> {
  const out: Record<string, ParamSchema> = {};
  for (const v of new Set(verbs)) if (VERB_PARAMS[v]) out[v] = VERB_PARAMS[v]!;
  return out;
}
/** The schema without its prose, for the budgeted `here`: name, type, bounds, enum. */
export function compactParams(by: Record<string, ParamSchema>): Record<string, ParamSchema> {
  return Object.fromEntries(Object.entries(by).map(([v, sch]) => [v, Object.fromEntries(Object.entries(sch).map(([n, {description: _d, items: _i, ...spec}]) => [n, spec]))]));
}
/** One offer's whole schema: its verb's parameters, then its own. */
export function offerParams(cap: Pick<EdgeCapability, 'verb' | 'params'>): ParamSchema {
  return {...VERB_PARAMS[cap.verb], ...(cap.params as ParamSchema | undefined)};
}

const typeOk = (name: string, spec: ParamSpec, v: unknown): boolean => {
  switch (spec.type) {
    case 'string': return typeof v === 'string';
    case 'integer': return Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    // PC11 (#690): `with` also takes one string of names ("Bo and Cy")
    case 'array': return Array.isArray(v) || (name === 'with' && typeof v === 'string');
    case 'object': return !!v && typeof v === 'object' && !Array.isArray(v);
    default: return true;
  }
};
const shown = (spec: ParamSpec) => [spec.type, spec.enum ? `one of ${spec.enum.join(', ')}` : null, spec.min !== undefined || spec.max !== undefined ? `${spec.min ?? ''}..${spec.max ?? ''}` : null, spec.maxLength ? `at most ${spec.maxLength} characters` : null].filter(Boolean).join(', ');

/** Why these params don't fit this offer, or null. Only what the schema states refuses. */
export function paramsProblem(cap: Pick<EdgeCapability, 'id' | 'verb' | 'params'>, params: unknown): string | null {
  if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params))) return 'params must be a JSON object.';
  const p = (params ?? {}) as Record<string, unknown>, schema = offerParams(cap);
  for (const [name, v] of Object.entries(p)) {
    const spec = schema[name];
    if (!spec) {
      if (!cap.params && CLOSED.has(cap.verb)) {const names = Object.keys(schema); return `${cap.id} takes ${names.length ? names.join(', ') : 'no params'}, not "${name}".`;}
      continue;
    }
    if (v === undefined || v === null) continue;
    if (!typeOk(name, spec, v)) return `${name} must be ${shown(spec)}.`;
    if (spec.enum && !spec.enum.includes(v)) return `${name} must be ${shown(spec)}.`;
    if (typeof v === 'number' && ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max))) return `${name} must be ${shown(spec)}.`;
    if (typeof v === 'string' && spec.maxLength !== undefined && v.length > spec.maxLength) return `${name} must be ${shown(spec)}.`;
    if (Array.isArray(v) && spec.maxItems !== undefined && v.length > spec.maxItems) return `${name} takes at most ${spec.maxItems}.`;
  }
  for (const [name, spec] of Object.entries(schema)) if (spec.required && (p[name] === undefined || p[name] === null)) return `${cap.id} needs ${name} (${shown(spec)}).`;
  return null;
}
