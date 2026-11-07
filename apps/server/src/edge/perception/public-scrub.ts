// #1234: what a secret place goes by, kept out of anything public. It works on the finished answer, not on its fields, so a field
// added later can't bring a secret place back: a string that names one goes, and a list loses the whole entry that holds it.
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ids, refs and names as whole words: `hut` doesn't match `hut-2` or `chutney`. */
export function secretMatcher(terms: readonly string[]): RegExp | null {
  const words = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  return words.length ? new RegExp(`(?<![\\p{L}\\p{N}_-])(?:${words.map(escape).join('|')})(?![\\p{L}\\p{N}_-])`, 'iu') : null;
}

const holds = (v: unknown, re: RegExp): boolean => (typeof v === 'string' ? re.test(v) : Array.isArray(v) ? v.some((x) => holds(x, re)) : !!v && typeof v === 'object' && Object.entries(v).some(([k, x]) => re.test(k) || holds(x, re)));

/** `value` with every mention gone: an entry of a list whole, otherwise the field. */
export function withoutSecrets<T>(value: T, re: RegExp | null): T {
  if (!re) return value;
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.filter((x) => !holds(x, re)).map(clean);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.entries(v).filter(([k, x]) => !re.test(k) && !(typeof x === 'string' && re.test(x))).map(([k, x]) => [k, clean(x)]));
  };
  return clean(value) as T;
}
