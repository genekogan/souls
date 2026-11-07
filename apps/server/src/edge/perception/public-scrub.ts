// #1234: what a secret place goes by, kept out of what the world says of a Soul in public. It works on the finished answer, not on
// named fields, so a field added later can't bring a secret place back: a list loses the whole entry that names one, an object the
// field. Keys are never read, a word like `plaza` in an enum field means nothing, and a place in a path is judged by its id, so a
// public "Open Square" outlives a secret "Square". A Soul's own words aren't passed through this: see `publicSoul`.
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Fields that hold one of a fixed set of words, never a place. */
const ENUMS = new Set(['kind', 'phase', 'state', 'code', 'posture', 'activity', 'contract', 'colour', 'heading', 'verb', 'mode']);
/** Fields that hold a place, or a list of places, whole: compared exactly, so a secret "Square" leaves a public "Open Square" alone. */
const EXACT = new Set(['place', 'placeId', 'placePath', 'where', 'target', 'to', 'from']);
/** `walk:<id>`: the verb is no place's name, whatever a ref says. */
const OFFERS = new Set(['capability', 'capabilityId']);
/** `sit:here` is about wherever the Soul is, whatever a place's ref says. */
const NOT_A_PLACE = new Set(['here']);
export type Secrets = {ids: Set<string>; exact: Set<string>; text: RegExp; offer: RegExp | null};

/** Ids and refs, exact in a place entry; names and ids as whole words in anything else. `hut` doesn't match `hut-2`. */
export function secretMatcher(ids: readonly unknown[], names: readonly unknown[] = []): Secrets | null {
  const usable = (v: readonly unknown[]) => v.filter((t): t is string => typeof t === 'string' && !!t.trim() && !NOT_A_PLACE.has(t.trim().toLowerCase())).map((t) => t.trim());
  const exact = usable(ids), words = [...new Set([...exact, ...usable(names)])].sort((a, b) => b.length - a.length);
  const asWords = (list: string[]) => new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${list.map(escape).join('|')})(?![\\p{L}\\p{N}_-])`, 'iu');
  return words.length ? {ids: new Set(exact), exact: new Set(words.map((w) => w.toLowerCase())), text: asWords(words), offer: exact.length ? asWords([...exact].sort((a, b) => b.length - a.length)) : null} : null;
}

const named = (v: unknown, s: Secrets): boolean => (typeof v === 'string' ? s.exact.has(v.trim().toLowerCase()) : Array.isArray(v) ? v.some((x) => named(x, s) || (!!x && typeof x === 'object' && holdsSecret(x, s))) : !!v && typeof v === 'object' && holdsSecret(v, s));
/** After the verb, ids and refs as whole words: `walk:cove/bench` names `cove`. A name means nothing here: `walk:field` isn't a place called Field. */
const offered = (v: unknown, s: Secrets) => typeof v === 'string' && v.includes(':') && !!s.offer?.test(v.slice(v.indexOf(':') + 1));
/** One field of an object, by what kind of field it is. */
const fieldHolds = (k: string, x: unknown, s: Secrets): boolean => (ENUMS.has(k) ? false : EXACT.has(k) ? named(x, s) : OFFERS.has(k) ? offered(x, s) : holdsSecret(x, s));
const isPlace = (v: object): v is {id: string} => typeof (v as {id?: unknown}).id === 'string' && typeof (v as {name?: unknown}).name === 'string';
export const holdsSecret = (v: unknown, s: Secrets): boolean => {
  if (typeof v === 'string') return s.text.test(v);
  if (Array.isArray(v)) return v.some((x) => holdsSecret(x, s));
  if (!v || typeof v !== 'object') return false;
  return isPlace(v) ? s.ids.has(v.id) : Object.entries(v).some(([k, x]) => fieldHolds(k, x, s));
};

/** `value` with every mention gone: an entry of a list whole, otherwise the field. */
export function withoutSecrets<T>(value: T, s: Secrets | null): T {
  if (!s) return value;
  const clean = (v: unknown, key = ''): unknown => {
    if (Array.isArray(v)) return v.filter((x) => !(EXACT.has(key) ? named(x, s) : holdsSecret(x, s))).map((x) => clean(x));
    if (!v || typeof v !== 'object' || isPlace(v)) return v;
    return Object.fromEntries(Object.entries(v).filter(([k, x]) => typeof x !== 'string' || !fieldHolds(k, x, s)).map(([k, x]) => [k, ENUMS.has(k) ? x : clean(x, k)]));
  };
  return clean(value) as T;
}
