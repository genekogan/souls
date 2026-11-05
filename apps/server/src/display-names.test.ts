// F8 (#958): what a Soul reads names things and places by their display names. On the eden-2026 and mars-two templates,
// no Soul-facing display string (labels, names, `what` and descriptions, schedule labels, refusal reasons) carries a
// place/region/int/g- id, an entity id (`e_xxxxxxxx`), an `a/b` path or a dotted path, and a clipped description ends at a
// word boundary. Capability ids (`verb:target`) and bracketed exact ids (`[ref]`) are ids on purpose and stay as they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {Hono} from 'hono';
import {bootEden} from '../test/eden-capabilities-timing.ts';
import {registerEdgeComms} from './edge/comms/index.ts';
import {edgeSoulResolver} from './edge/routes.ts';
import {aroundFrame, clip} from './edge/perception/around.ts';
import {hereFrame} from './edge/perception/here.ts';
import {humanTitle, kindWords} from './god/meaning.ts';
import type {Thing} from './god/nav.ts';
import {puntName} from './punt-install.ts';

const RAW: [string, RegExp][] = [['a place id', /\b(place|int|g|region)-[a-z]/], ['an entity id', /\be_[0-9a-f]{8}\b/],
  ['an a/b path', /\b[a-z0-9]+-[a-z0-9-]*\/[a-z0-9]|\b[a-z0-9]+\/[a-z0-9]+-[a-z0-9-]*/]];
/** Ids on purpose: bracketed exact ids and capability ids (`walk:chiba/kitchen`, `object:e_1234abcd:light`); and file
 *  paths an author wrote into a def's description (`god/examples/light-motion.mjs`) are prose, not ids. */
const strip = (s: string) => s.replace(/\[[^\]]*\]/g, '[]').replace(/\b[a-z][a-z0-9-]*:[^\s,;)\]]+/g, 'CAP').replace(/\b[\w./-]+\.(mjs|js|ts|json|md)\b/g, 'FILE');
/** Fields that are ids or machine values, not display text. */
const ID_KEYS = new Set(['id', 'placeId', 'capability', 'walk', 'sit', 'to', 'unvisited', 'fullCapabilities', 'ref', 'entity', 'entityId', 'soulId', 'target', 'carrier', 'parent', 'place', 'places', 'placePath', 'kind', 'owner', 'slot', 'cursor', 'since', 'programId', 'receipt', 'itemId', 'for', 'verb', 'role', 'def', 'cron', 'key', 'apiContract', 'semanticKind', 'semanticParent', 'semanticRole', 'aliases', 'genericAliases', 'code', 'at']);
const NO = ['eden-2026', 'mars-two', 'eden-district'].filter(t => !existsSync(new URL(`../../../worlds/templates/${t}.json`, import.meta.url)));

/** Every problem in one string: [why, text]. Known refs with a slash are found by name too (`chiba/kitchen` has no hyphen). */
function problems(text: string, refs: Set<string>, name = false): string[] {
  const t = strip(text), out: string[] = [];
  for (const [why, re] of RAW) if (re.test(t)) out.push(why);
  for (const m of t.matchAll(/[a-z0-9-]+(?:\/[a-z0-9-]+)+/g)) if (refs.has(m[0])) out.push('a known path ' + m[0]);
  if (name && /[a-z]\.[a-z]/i.test(t)) out.push('a dotted path');
  return out;
}
function scan(where: string, v: unknown, refs: Set<string>, found: string[], key = '') {
  if (ID_KEYS.has(key)) return;
  if (typeof v === 'string') { for (const why of problems(v, refs, key === 'name')) found.push(`${where}.${key}: ${why}: ${v.slice(0, 160)}`); return; }
  if (Array.isArray(v)) { for (const x of v) scan(where, x, refs, found, key); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) scan(where, x, refs, found, k);
}

for (const template of ['eden-2026', 'mars-two', 'eden-district']) test(`${template}: Soul-facing display strings name things and places, never by id`, {timeout: 900_000, skip: NO.includes(template) ? 'template missing' : false}, async t => {
  const w = await bootEden(() => {}, template); t.after(() => w.close());
  const comms = registerEdgeComms(new Hono(), {host: w.host, db: w.db, souls: w.souls, soul: edgeSoulResolver(w.host, w.souls, () => undefined), ledger: w.edge} as never, {fetch: null} as never);
  w.edge.attachComms(comms as never); t.after(() => comms.close());
  await w.settle(8);
  const nav = w.bridge.nav, things = nav.things() as Thing[], places = [...w.edge.places.byId.values()];
  const refs = new Set<string>([...things.map(x => x.ref), ...places.map(p => p.id)].filter(r => r.includes('/')));
  const found: string[] = [];
  // template-wide: every thing a walk can name, every place, every built object
  for (const x of things) {
    scan(`thing ${x.ref}`, {name: x.name, what: x.what}, refs, found);
    scan(`thing ${x.ref}`, {label: (nav as unknown as {label(t: Thing, d: number): string}).label(x, 10)}, refs, found);
  }
  for (const p of w.edge.map()) scan(`place ${p.id}`, {name: p.name, description: p.description, schedule: p.schedule.map(s => s.label)}, refs, found);
  for (const o of comms.objects.all()) scan(`object ${o.id}`, {name: o.name, what: (o.state as {what?: unknown} | undefined)?.what, description: o.description}, refs, found);
  // what the Soul reads where it stands
  const s = w.soul, around = aroundFrame(w.edge, s);
  scan('observe', w.edge.observe(s, new Set()), refs, found);
  scan('here', hereFrame(w.edge, s, {doHere: true}), refs, found);
  scan('around', around, refs, found);
  scan('capabilities', w.edge.capabilitiesPage(s, {all: true}).capabilities.map(c => ({label: c.label, reason: c.blocked?.reason})), refs, found);
  t.diagnostic(`${things.length} things, ${places.length} places, ${comms.objects.all().length} objects; ${found.length} problems`);
  assert.deepEqual(found.slice(0, 40), [], `${found.length} display strings carry an id`);
  // A3: a clipped description ends at a word boundary of the description it was cut from
  let clipped = 0;
  for (const p of around.places) {
    const full = w.edge.places.byId.get(p.id)?.description; if (!p.what?.endsWith('…') || !full) continue;
    const head = p.what.slice(0, -1); clipped++;
    assert.ok(full.startsWith(head), `${p.id}: the clip is a prefix`);
    assert.ok(!/\w/.test(full[head.length] ?? ' ') || !/\w$/.test(head), `${p.id}: cut mid-word: …${head.slice(-20)}|${full.slice(head.length, head.length + 10)}`);
  }
  t.diagnostic(`${clipped} clipped place descriptions checked`);
});

test('clip ends at a word boundary; display helpers never keep an id or a dotted path', () => {
  assert.equal(clip('Tea, cake and cards at the long table', 30), 'Tea, cake and cards at the…');
  assert.equal(clip('the adjoining classroom', 18), 'the adjoining…');
  assert.equal(clip('short', 30), 'short');
  assert.equal(clip('Supercalifragilisticexpialidocious', 10), 'Supercali…', 'one long word is cut, as before');
  assert.equal(humanTitle('region-seaside-resort.ferris-wheel'), 'Seaside resort ferris wheel');
  assert.equal(humanTitle('place-commons-deck'), 'Commons deck');
  assert.equal(kindWords('long-table'), 'long table');
  assert.equal(kindWords('mars-presenter-timber-box'), 'presenter timber box');
  assert.equal(kindWords('mars-tier-2'), 'tier');
  assert.equal(kindWords('eden-sleeping-mat'), 'sleeping mat');
  assert.equal(puntName('e_00caa734 rowing punt'), 'Rowing punt');
  assert.equal(puntName('Pond rowing punt'), 'Pond rowing punt');
});
