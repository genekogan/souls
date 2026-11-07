// The catalogue for agents (VOCAB-MECH): a compact manifest of every def (one line each), the taxonomy with counts,
// faceted search, and a free-text "recommend". Mounted from mountAssetRoutes. Guide: docs/god/VOCAB.md.
//
//   GET /v1/god/catalog?category=&tag=&has=&form=&page=&per=&format=lines|json   god: the manifest, paged (ETag)
//   GET /v1/god/catalog/taxonomy                                                 god: the category tree, counts, what is still empty
//   GET /v1/god/recommend?intent=<free text>&per=3                               god: what to place for an intent, per need
//   GET /thumbs/<defhash>.png                                                    public: thumbnail by def hash (immutable)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { compress } from 'hono/compress';
import { vocab, type StoredDef } from '@souls/world-compiler';
import { ApiError } from '../souls.ts';
import type { GodMode } from './god.ts';
import { type AssetStore, exampleOp, publicRef, searchDefs } from './assets.ts';

const noStore = { 'cache-control': 'no-store' };
const SHA = /[0-9a-f]{64}/g;

/** Bytes a viewer downloads to draw a def: its GLB(s) (kit and generator defs draw from code: 0). */
export function assetBytesOf(def: StoredDef, store: Pick<AssetStore, 'info'>): number {
  if (def.make.kind !== 'mesh') return 0;
  let n = 0; for (const sha of new Set(JSON.stringify(def.make).match(SHA) ?? [])) { const m = store.info(sha); if (m?.ext === 'glb') n += m.bytes; }
  return n;
}
export function catalogRows(defs: StoredDef[], store: Pick<AssetStore, 'info'>) {
  return defs.map((d) => vocab.manifestRow(d as never, { bytes: assetBytesOf(d, store), publicRef: publicRef(d) }));
}

const STOP = new Set('a an the and or with of to in on at by for from near next some few many lots little big small large tiny huge my our its this that it is are be place put build make add want need there here very cosy cozy nice old new two three four five six seven eight nine ten one both each other into onto beside outside inside around along across under over'.split(' '));
/** Free text → needs (single nouns and two-word phrases), each with the best few defs and why. */
export function recommend(defs: StoredDef[], intent: string, per = 3) {
  const words = intent.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  const needs: { for: string; picks: { ref: string; cat: string; score: number; why: string[] }[] }[] = [];
  const used = new Set<number>();
  // two-word phrases first ("corner shop", "park bench", "street lamp") when they name something better than either word
  for (let i = 0; i + 1 < words.length; i++) {
    if (STOP.has(words[i]) || STOP.has(words[i + 1])) continue;
    const phrase = `${words[i]} ${words[i + 1]}`, hits = searchDefs(defs, phrase, { limit: per });
    const strong = hits.filter((h) => (h.why.length >= 2 || h.why.some((w) => w.startsWith('aka=') || w === 'name' || w.startsWith('cat='))) && h.score >= 40);
    if (strong.length) { needs.push({ for: phrase, picks: strong.map(pick) }); used.add(i); used.add(i + 1); i++; }
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]; if (used.has(i) || STOP.has(w) || w.length < 3 || /^\d+$/.test(w)) continue;
    const hits = searchDefs(defs, w, { limit: per }).filter((h) => h.score >= 12 || h.why.every((w) => w.startsWith('cat=')));
    if (hits.length) needs.push({ for: w, picks: hits.map(pick) });
  }
  const seen = new Set<string>();
  const ops = needs.flatMap((n) => n.picks.slice(0, 1)).filter((p) => !seen.has(p.ref) && seen.add(p.ref)).map((p) => { const d = defs.find((x) => publicRef(x) === p.ref)!; return exampleOp(d); });
  return { intent, needs, example: { ops }, unmatched: words.filter((w, i) => !used.has(i) && !STOP.has(w) && w.length >= 3 && !needs.some((n) => n.for === w)) };
  function pick(h: { def: StoredDef; score: number; why: string[] }) { return { ref: publicRef(h.def), cat: vocab.categoryOf(h.def as never), score: h.score, why: h.why }; }
}

export type CatalogDeps = { god: GodMode; requireGod: (c: Context) => void; store: AssetStore; library: () => StoredDef[] };
export function mountCatalogRoutes(app: Hono, d: CatalogDeps) {
  // the viewer's snapshot carries every def in use (kit shape lists): ~1.6 KB per type raw, ~0.3 KB gzipped. Compress it
  // (and the catalogue) when the client asks; registered before mountGodRoutes' own snapshot route, so it wraps it.
  for (const path of ['/v1/world/snapshot', '/v1/god/catalog', '/v1/god/defs']) app.use(path, compress());
  const facetsOf = (c: Context): vocab.Facets => ({ category: c.req.query('category') || undefined, tag: c.req.query('tag') || undefined, form: c.req.query('form') || undefined, has: c.req.queries('has')?.flatMap((h) => h.split(',')).filter(Boolean) });
  // the manifest changes only when the library does: ETag over the def hashes (+ the facets/page asked for)
  const etagOf = (defs: StoredDef[], extra: string) => `"cat-${createHash('sha256').update(defs.map((x) => x.hash).sort().join(',') + '|' + extra).digest('hex').slice(0, 24)}"`;

  app.get('/v1/god/catalog', (c) => {
    d.requireGod(c);
    const f = facetsOf(c), per = Math.min(2000, Math.max(1, Number(c.req.query('per') ?? 500) || 500)), page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
    const all = d.library(), defs = vocab.facetFilter(all as never[], f) as unknown as StoredDef[];
    const tag = etagOf(all, JSON.stringify([f, per, page, c.req.query('format') ?? '']));
    const headers = { etag: tag, 'cache-control': 'private, max-age=0, must-revalidate' };
    if ((c.req.header('if-none-match') ?? '').replace(/^W\//, '') === tag) return c.body(null, 304, headers);   // compress() weakens the tag
    const rows = catalogRows(defs, d.store).sort((a, b) => (a.cat < b.cat ? -1 : a.cat > b.cat ? 1 : a.ref < b.ref ? -1 : 1));
    const slice = rows.slice((page - 1) * per, page * per), pages = Math.max(1, Math.ceil(rows.length / per));
    if (c.req.query('format') === 'lines') return c.text([`# catalog ${rows.length} defs, page ${page}/${pages}${f.category ? `, category ${f.category}` : ''}${f.has?.length ? `, has ${f.has.join(',')}` : ''}. ref [category] size make tris bytes {interfaces} (params) aka synonyms — doc`, ...slice.map(vocab.manifestLine)].join('\n') + '\n', 200, headers);
    return c.json({ count: rows.length, page, pages, per, facets: f, rows: slice }, 200, headers);
  });
  app.get('/v1/god/catalog/taxonomy', (c) => {
    d.requireGod(c);
    return c.json({ categories: vocab.categoryCounts(d.library() as never[]), conventions: vocab.CONVENTIONS, actuators: Object.fromEntries(Object.entries(vocab.ACTUATORS).map(([k, a]) => [k, { field: a.field, doc: a.doc }])), slotVerbs: vocab.SLOT_VERBS }, 200, noStore);
  });
  app.get('/v1/god/recommend', (c) => {
    d.requireGod(c);
    const intent = (c.req.query('intent') ?? c.req.query('q') ?? '').slice(0, 400);
    if (!intent.trim()) throw new ApiError(400, 'invalid', 'intent=<what you want to make>');
    return c.json(recommend(d.library(), intent, Math.min(8, Math.max(1, Number(c.req.query('per') ?? 3) || 3))), 200, noStore);
  });
  // thumbnails by content (the def hash): immutable, so a catalogue page of hundreds of thumbs is fetched once per browser
  app.get('/thumbs/:file{[0-9a-f]{64}\\.png}', (c) => {
    const hash = c.req.param('file').slice(0, 64), f = d.store.thumbFile(hash);
    const etag = `"${hash}"`;
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, { etag, 'cache-control': 'public, max-age=31536000, immutable' });
    if (!f) throw new ApiError(404, 'not-found', 'no thumbnail rendered yet (tools/god-skill/scripts/thumbs.mjs)');
    return c.body(readFileSync(f) as never, 200, { 'content-type': 'image/png', etag, 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*' });
  });
}
