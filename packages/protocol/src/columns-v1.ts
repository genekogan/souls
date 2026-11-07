// columns/1 (lane JOINSET, 2026-10-22): a lossless, column-wise JSON shape for the join set's big entity tables (the
// socket's join snapshot, Eden 2026: ~4,500 entities, 1.5 MB of row JSON; the wire world snapshot's ~5,000 entities,
// 1 MB). Rows of the same kind repeat their keys, ids and many values; stored a column at a time (each key's values in
// row order, a value table where few distinct values repeat, number tuples flattened, nested records packed the same
// way) the JSON is ~4x smaller and compresses ~40% smaller. unpackColumnsV1 gives back the exact table: the same keys in
// the same order and the same values (JSON.stringify identical), so nothing after the decoder sees a difference.
// Only peers that announce it get it (the hello's `snapshotColumns`, the HTTP snapshot's `cols=1`).
export const COLUMNS_V1 = 'columns/1' as const;
export const COLUMNS_KEY = '$columnsV1' as const;
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v));
/** Encoder row orders (any order decodes; these group like rows): the socket's join table by def then label, the world
 *  snapshot's entities by parent then name (siblings together). */
export const joinTableOrderV1 = (r: Record<string, unknown>) => `${str(r.def)}|${str(r.label)}`;
export const worldEntityOrderV1 = (r: Record<string, unknown>) => `${str((r.in as { parent?: unknown } | undefined)?.parent)}|${str(r.name)}`;

type Json = unknown;
type Rec = Record<string, Json>;
/** A column: raw values | a value table + indices | packed nested records | flattened number tuples | the row's own key. */
export type ColumnV1 = { r: Json[] } | { d: Json[]; i: number[] } | { o: PackedV1 } | { f: number; v: number[] } | { k: 1 };
export type PackedV1 = { keys?: string[]; sorted?: string; n: number; shapes: string[][]; shape: number[]; cols: Record<string, ColumnV1> };

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const BAD_KEY = '__proto__';

function column(vals: Json[], rowKeys: string[] | undefined, depth: number): ColumnV1 {
  if (rowKeys && vals.length === rowKeys.length && vals.every((v, j) => v === rowKeys[j])) return { k: 1 };
  if (depth < 3 && vals.length > 1 && vals.every(isRec)) { const o = packRows(vals as Rec[], undefined, depth + 1); if (o) return { o }; }
  const a0 = vals[0];
  if (Array.isArray(a0) && a0.length > 0 && a0.length <= 8 && vals.every((v) => Array.isArray(v) && v.length === a0.length && v.every((x) => typeof x === 'number' && Number.isFinite(x))))
    return { f: a0.length, v: (vals as number[][]).flat() };
  const seen = new Map<string, number>(), idx: number[] = [];
  for (const v of vals) { const s = JSON.stringify(v); let j = seen.get(s); if (j === undefined) { j = seen.size; seen.set(s, j); } idx.push(j); }
  if (seen.size * 4 <= vals.length) return { d: [...seen.keys()].map((s) => JSON.parse(s) as Json), i: idx };
  return { r: vals };
}

function packRows(rows: Rec[], keys: string[] | undefined, depth: number): PackedV1 | null {
  const shapeOf = new Map<string, number>(), shapes: string[][] = [], shape: number[] = [], cols = new Map<string, Json[]>(), owners = new Map<string, string[]>();
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j]; if (!isRec(row)) return null;
    const ks = Object.keys(row).filter((k) => row[k] !== undefined); // as JSON.stringify writes it
    for (const k of ks) { if (k === BAD_KEY) return null; const v = row[k]; if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return null; }
    const sk = JSON.stringify(ks); let s = shapeOf.get(sk); if (s === undefined) { s = shapes.length; shapeOf.set(sk, s); shapes.push(ks); } shape.push(s);
    for (const k of ks) { let c = cols.get(k); if (!c) { c = []; cols.set(k, c); owners.set(k, []); } c.push(row[k]); if (keys) owners.get(k)!.push(keys[j]); }
  }
  const out: Record<string, ColumnV1> = {};
  for (const [k, vals] of cols) out[k] = column(vals, keys ? owners.get(k) : undefined, depth);
  return { ...(keys ? { keys } : {}), n: rows.length, shapes, shape, cols: out };
}

const ascending = (a: string[]) => a.every((x, j) => j === 0 || a[j - 1] < x);
const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
/** Rows grouped by `order` (similar rows side by side compress far better: Eden 2026's join snapshot -16%), recorded
 *  as `sorted` so the decoder sorts them back. Only for a table already in strictly ascending id order (the record's keys,
 *  or the array's `by` field), the one order a sort restores exactly. */
function regroup(ids: string[], order?: (row: Rec) => string, rows?: Rec[]): number[] | null {
  if (!order || !rows || ids.length < 2 || !ascending(ids)) return null;
  const k = rows.map((r) => order(r)); return ids.map((_, j) => j).sort((a, b) => cmp(k[a], k[b]) || a - b);
}

/** The columns/1 form of a table (an array of records, or a record of records keyed by id); null when it is not one.
 *  `order` (optional) groups rows for compression; `by` names an array table's id field (default 'id'). */
export function packColumnsV1(table: unknown, order?: (row: Rec) => string, by = 'id'): { [COLUMNS_KEY]: PackedV1 } | null {
  if (Array.isArray(table)) {
    if (!table.length || !table.every(isRec)) return null;
    const rows = table as Rec[], ids = rows.map((r) => r[by]), perm = ids.every((x) => typeof x === 'string') ? regroup(ids as string[], order, rows) : null;
    const p = packRows(perm ? perm.map((j) => rows[j]) : rows, undefined, 0); return p ? { [COLUMNS_KEY]: perm ? { ...p, sorted: by } : p } : null;
  }
  if (!isRec(table)) return null;
  const keys = Object.keys(table); if (!keys.length || keys.includes(BAD_KEY) || keys.some((k) => !isRec(table[k]))) return null;
  const rows = keys.map((k) => table[k] as Rec), perm = regroup(keys, order, rows);
  const ks = perm ? perm.map((j) => keys[j]) : keys, p = packRows(perm ? perm.map((j) => rows[j]) : rows, ks, 0);
  return p ? { [COLUMNS_KEY]: perm ? { ...p, sorted: '' } : p } : null;
}

export const isPackedColumnsV1 = (v: unknown): v is { [COLUMNS_KEY]: PackedV1 } => isRec(v) && isRec(v[COLUMNS_KEY]);
function fail(why: string): never { throw new Error('columns-v1.invalid: ' + why); }

// #619: the wire is untrusted. Every index is an own, in-range integer and every key a string, checked before use, so a
// malformed envelope fails here instead of returning inherited properties or a row with a borrowed prototype.
const isIndex = (x: unknown, size: number): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < size;
const isStrings = (a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === 'string');
function unpackRows(p: PackedV1, depth = 0): Rec[] {
  if (!isRec(p) || !Number.isInteger(p.n) || p.n < 0 || !Array.isArray(p.shapes) || !Array.isArray(p.shape) || !isRec(p.cols) || p.shape.length !== p.n) fail('envelope');
  if (p.sorted !== undefined && typeof p.sorted !== 'string') fail('sorted');
  if (p.keys !== undefined && (!isStrings(p.keys) || p.keys.length !== p.n || p.keys.includes(BAD_KEY) || new Set(p.keys).size !== p.keys.length)) fail('keys');
  if (!p.shapes.every((s) => isStrings(s) && new Set(s).size === s.length)) fail('shapes');
  if (!p.shape.every((s) => isIndex(s, p.shapes.length))) fail('shape');
  const readers = new Map<string, (j: number) => Json>();
  for (const [k, c] of Object.entries(p.cols)) {
    let at = 0;
    if (!isRec(c)) fail('column ' + k);
    if ('k' in c) { const keys = p.keys ?? fail('k without keys'); readers.set(k, (j) => keys[j]); continue; }
    if ('r' in c) { const v = c.r; if (!Array.isArray(v)) fail('r'); readers.set(k, () => (at < v.length ? v[at++] : fail('r short'))); continue; }
    if ('d' in c) { const d = c.d, i = c.i; if (!Array.isArray(d) || !Array.isArray(i) || !i.every((x) => isIndex(x, d.length))) fail('d index'); readers.set(k, () => { if (at >= i.length) fail('i short'); const x = d[i[at++]]; if (x === undefined) fail('d index'); return x !== null && typeof x === 'object' ? structuredClone(x) : x; }); continue; }
    if ('f' in c) { const f = c.f, v = c.v; if (!Number.isInteger(f) || f < 1 || !Array.isArray(v) || !v.every((x) => Number.isFinite(x))) fail('f'); readers.set(k, () => { if ((at + 1) * f > v.length) fail('f short'); const x = v.slice(at * f, (at + 1) * f); at++; return x; }); continue; }
    if ('o' in c) { if (depth >= 3) fail('depth'); const rows = unpackRows(c.o, depth + 1); readers.set(k, () => (at < rows.length ? rows[at++] : fail('o short'))); continue; }
    fail('column ' + k);
  }
  const out: Rec[] = new Array(p.n);
  for (let j = 0; j < p.n; j++) {
    const ks = p.shapes[p.shape[j]], row: Rec = {};
    for (const k of ks) { if (k === BAD_KEY) fail('key'); const r = readers.get(k) ?? fail('no column ' + k); row[k] = r(j); }
    out[j] = row;
  }
  return out;
}

/** The exact table back from its columns/1 form (an array, or a record keyed as it was). */
export function unpackColumnsV1(v: { [COLUMNS_KEY]: PackedV1 }): Rec[] | Record<string, Rec> {
  const p = v[COLUMNS_KEY], rows = unpackRows(p), sorted = p.sorted;
  if (!p.keys) {
    if (sorted === undefined) return rows;
    const id = (r: Rec) => { const x = r[sorted]; return typeof x === 'string' ? x : fail('sort id'); };
    return rows.sort((a, b) => cmp(id(a), id(b)));
  }
  if (p.keys.length !== rows.length) fail('keys');
  let order = p.keys.map((_, j) => j); if (sorted !== undefined) order = order.sort((a, b) => cmp(p.keys![a], p.keys![b]));
  const out: Record<string, Rec> = {}; for (const j of order) { if (p.keys[j] === BAD_KEY) fail('key'); out[p.keys[j]] = rows[j]; } return out;
}
