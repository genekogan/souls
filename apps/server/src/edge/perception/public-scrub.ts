// #1234: what a secret place goes by, kept out of what the world says of a Soul in public. It works on the finished answer, not on
// named fields, so a field added later can't bring a secret place back: a list loses the whole entry that names one, an object the
// field. Keys are never read, a word like `plaza` in an enum field means nothing, and a place in a path is judged by its id, so a
// public "Open Square" outlives a secret "Square". A Soul's own words aren't passed through this: see `publicSoul`.
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Fields that hold one of a fixed set of words, never a place. */
const ENUMS = new Set(['kind', 'phase', 'state', 'code', 'posture', 'activity', 'contract', 'colour', 'heading', 'verb', 'mode']);
/** `sit:here` is about wherever the Soul is, whatever a place's ref says. */
const NOT_A_PLACE = new Set(['here']);
export type Secrets = {ids: Set<string>; text: RegExp};

/** Ids and refs, exact in a place entry; names and ids as whole words in anything else. `hut` doesn't match `hut-2`. */
export function secretMatcher(ids: readonly unknown[], names: readonly unknown[] = []): Secrets | null {
  const usable = (v: readonly unknown[]) => v.filter((t): t is string => typeof t === 'string' && !!t.trim() && !NOT_A_PLACE.has(t.trim().toLowerCase())).map((t) => t.trim());
  const exact = usable(ids), words = [...new Set([...exact, ...usable(names)])].sort((a, b) => b.length - a.length);
  return words.length ? {ids: new Set(exact), text: new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${words.map(escape).join('|')})(?![\\p{L}\\p{N}_-])`, 'iu')} : null;
}

const isPlace = (v: object): v is {id: string} => typeof (v as {id?: unknown}).id === 'string' && typeof (v as {name?: unknown}).name === 'string';
export const holdsSecret = (v: unknown, s: Secrets): boolean => {
  if (typeof v === 'string') return s.text.test(v);
  if (Array.isArray(v)) return v.some((x) => holdsSecret(x, s));
  if (!v || typeof v !== 'object') return false;
  return isPlace(v) ? s.ids.has(v.id) : Object.entries(v).some(([k, x]) => !ENUMS.has(k) && holdsSecret(x, s));
};

/** `value` with every mention gone: an entry of a list whole, otherwise the field. */
export function withoutSecrets<T>(value: T, s: Secrets | null): T {
  if (!s) return value;
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.filter((x) => !holdsSecret(x, s)).map(clean);
    if (!v || typeof v !== 'object' || isPlace(v)) return v;
    return Object.fromEntries(Object.entries(v).filter(([k, x]) => ENUMS.has(k) || typeof x !== 'string' || !s.text.test(x)).map(([k, x]) => [k, ENUMS.has(k) ? x : clean(x)]));
  };
  return clean(value) as T;
}
