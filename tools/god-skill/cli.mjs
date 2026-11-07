#!/usr/bin/env node
// eden-god — god mode for one Eden world, from any folder (spec <eden4>/28 §7, 29 WP5, 33 §3.4).
// SOURCE of the downloadable single file eden-god.mjs (built by build.mjs: `node build.mjs`).
// State: ./.eden-god.json (world URL + god token + current group; private), ./.eden-god.cache.json
// (the world mirror). Commands print short human text; add --json for machine output.
import { acquireLock } from './lib/locks.mjs';
import { doctor } from './lib/doctor.mjs';
import { enterGodSeat, godFile } from './lib/seat.mjs';
import { catalog, line as catalogLine, recommend, taxonomy } from './lib/catalog.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { activeClaim, atomicWrite, attention, buildHeader, call, claimFile, decorate, helperFile, load, num, ok, OUTPUT_SUFFIX, r2, save, sleep, withBuildOptions, withDeadline, withStateLock, withoutBuild } from './lib/state.mjs';
import { mirror, view, normDef, resolveDef, follow, invalidate, mirrorState, adoptMirror, heldMirror, speaksMirror, wasTrusted } from './lib/mirror.mjs';
import { normalizeArgv } from './lib/args.mjs';
import { exportGenesis } from './lib/export.mjs';
import { solve, refPoint, centreOf, compassOfYaw, rectArea, circleArea, compassKey, COMPASS, setOf, relocate, frameOf, slotTarget, isFlagDef } from './lib/solver.mjs';
import { camera, shoot, keeper, stopKeeper, drawableCount, LOOK_DEFAULT_MS, LOOK_MAX_MS } from './lib/look.mjs';
import { autoWarm, listenerBeat, lookRoute } from './lib/warm.mjs';
import { remoteLook } from './lib/remote-look.mjs';
import { kitDefinition, kitIgnoredKeys } from './lib/kit.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SELF = (() => { try { return fileURLToPath(import.meta.url); } catch { return process.argv[1]; } })();
import { selectRows } from './lib/select.mjs';
import { PALETTE_LIST } from './lib/sky.mjs';
import { schemaMarkdown } from './lib/schema-md.mjs';
import { listen, ack } from './lib/inbox.mjs';
export { listen, ack };
import { time as envTime, weather as envWeather, strike as envStrike, land as envLand, ENV_FLAGS, ENV_BOOLS, LAND_HELP } from './lib/env.mjs';
import { secret, SECRET_HELP } from './lib/secret.mjs';
import { hours, event, own, access, price, currency, give, pay, zone, zoneSuggest, relate, layers, LAYERS_FLAGS, LAYERS_BOOLS, LAYERS_POS, LAYERS_HELP } from './lib/layers.mjs';
import { amendments, decide, governance, GOV_FLAGS, GOV_POS, GOV_HELP } from './lib/governance.mjs';
export { schemaMarkdown };

import { aboutValue, missingAbout, exactAboutTarget } from './lib/about.mjs';
import { SKILL_VERSION } from './lib/version.mjs';
import { upload } from './lib/upload.mjs';
import { thumbnail, THUMBNAIL_HELP } from './lib/thumbnail.mjs';
import { godFeature } from './lib/features.mjs';
export { SKILL_VERSION };

// ---------------------------------------------------------------- pairing
export async function register(url, identity) {
  if (!url) throw new Error('usage: register <world-url> [dev:identity]');
  const base = url.replace(/[?#].*$/, '').replace(/\/$/, '');
  save({ world: base, ...(identity ? { identity } : {}) });
  const cfg = ok(await call('/v1/config', { as: 'none' }), 'register');
  return { world: base, worldId: cfg.worldId, devAuth: !!cfg.devAuth, next: cfg.devAuth && identity ? 'Run: mint' : 'Run: pair (your human approves in the browser)' };
}
export async function pair(agent = 'eden-god ' + SKILL_VERSION) {
  const start = ok(await call('/v1/god/pair/start', { as: 'none', body: { agent } }), 'pair');
  console.error(start.tell_your_human);
  autoWarm(SELF, { force: true, pairing: true }); // G1: Playwright + a headless Chrome on the world, while the owner approves
  for (let i = 0; i < 300; i++) {
    const p = ok(await call('/v1/god/pair/poll', { as: 'none', body: { poll_token: start.poll_token } }), 'pair');
    if (p.status === 'approved') { save({ token: p.token }); return { paired: true, world: p.world }; }
    await sleep((start.interval_s ?? 3) * 1000);
  }
  throw new Error('pairing timed out; run pair again');
}
export async function mint(label = 'eden-god') { const r = ok(await call('/v1/god/mint', { as: 'owner', body: { label } }), 'mint'); save({ token: r.token }); return { paired: true, world: r.world }; }

// ---------------------------------------------------------------- reading
export async function snapshot() { return ok(await call('/v1/god/snapshot'), 'snapshot'); }
const fmtP = (p) => (p ? `(${p.map((v) => r2(v)).join(', ')})` : '');
const dxdz = (x, what) => { const a = String(x).split(',').map(Number); if (a.length !== 2 || !a.every(Number.isFinite)) throw new Error(`${what} takes dx,dz (two numbers), got ${x}`); return a; };
const yawWord = (y) => (typeof y === 'number' ? `facing ${compassOfYaw(y)}` : '');

// Reuse wire shapes live here: parts rows have `from`; search rows have `usedIn` (also aliased `used`).
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const doneDate = (at) => {
  if (at === undefined || at === null) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const usedIn = (d) => d.usedIn ?? d.used ?? [];
const useText = (u) => {
  const b = typeof u.build === 'object' ? u.build : { id: u.build, title: u.title, doneAt: u.doneAt };
  const date = doneDate(b.doneAt);
  return `${oneLine(b.title || b.id)} (done${date ? ' ' + date : ''}${u.placedNow !== undefined ? `; ${u.placedNow} standing` : ''})`;
};
const usedBadge = (d) => usedIn(d).length ? ` · used in: ${usedIn(d).map(useText).join('; ')}` : '';
const placePart = (p) => `place sha:${p.sha} --at …`;
function partChecks(c) {
  if (!c) return 'checks: none recorded';
  const checks = [...(c.buildDone === true ? ['build done'] : []), ...(c.kept !== undefined ? [`${c.kept} kept at done`] : [])];
  for (const [label, receipts] of [['build-use', c.buildUse], ['part-use', c.partUse]]) {
    checks.push(`${label}: ${Array.isArray(receipts) && receipts.length ? receipts.map(r => `${oneLine(r.uses)} at ${oneLine(r.target)} ${r.ok === true ? 'passed' : 'FAILED'}`).join(', ') : receipts === 'n/a' ? 'n/a' : 'none recorded'}`);
  }
  return 'checks: ' + checks.join('; ');
}
function partLine(p) {
  // The server's compact parts rows omit a description; their ref still names the kind of part.
  const what = p.description || p.doc || p.ref.replace(/@\d+$/, '').replace(/[-_]/g, ' ');
  return `${oneLine(p.ref)} · sha:${p.sha} — ${oneLine(what)} · used in: ${(p.from ?? []).map(useText).join('; ')} · ${p.placedNow === 0 ? 'no copies standing' : `${p.placedNow} standing`} · ${partChecks(p.checks)} · ${placePart(p)}`;
}
const searchDefs = async (q, flags = {}) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ q, ...flags })) for (const x of [].concat(v ?? [])) if (x !== '' && x !== undefined) qs.append(k, x);
  return ok(await call(`/v1/god/defs?${qs}`), 'defs');
};
export async function parts(words = '', flags = {}) {
  const d = ok(await call(`/v1/god/parts?${new URLSearchParams({ q: words })}`), 'parts');
  return flags.json ? d : d.parts.length ? d.parts.map(partLine).join('\n') : `no parts from finished builds${words ? ` matching "${words}"` : ''}`;
}
// r2.1: a catalogue (registry) world may predate the built-in motion/light kits (core/twinkle-lights@1 is not in
// registry stable@3), so `find twinkle` finds nothing there. Every world serves a ready def for each motion word.
const MOTION_EXAMPLES = ['spin', 'sway', 'hover', 'route', 'sound', 'twinkle'];
function servedMotionExample(words = '') {
  const name = MOTION_EXAMPLES.find(k => String(words).toLowerCase().split(/[^a-z]+/).includes(k)); if (!name) return '';
  return `\nready def for "${name}" in every world: curl -s ${load().world}/god/examples/light-motion.mjs -o light-motion.mjs && node light-motion.mjs ${name} > ${name}.def.json && node eden-god.mjs define ${name}.def.json`;
}
// Keep the shared catalogue module unchanged: this CLI adds the reuse badge to its normal manifest lines.
export async function find(words, flags = {}) {
  if (!words && !flags.category && !flags.has) throw new Error('find <words> [--category c] [--has slot:sit|action:open|actuator:door|comp:light]');
  const d = await searchDefs(words, { category: flags.category, has: flags.has, tag: flags.tag, compact: 1, limit: flags.all ? 500 : 25 });
  if (flags.json) return d.defs;
  if (!d.defs.length) return `nothing matches${words ? ` "${words}"` : ''}${flags.category ? ` in ${flags.category}` : ''}${flags.has ? ` with ${[].concat(flags.has).join(', ')}` : ''}${d.hint ? `. ${d.hint}` : ''}. Try \`recommend <what you want>\` or \`taxonomy\`.${servedMotionExample(words)}`;
  return [`${d.defs.length} match${words ? ` "${words}"` : ''}:`, ...d.defs.map(r => `${catalogLine(r)}${usedBadge(r)}${r.why?.length ? `  ‹${r.why.join(' ')}›` : ''}`)].join('\n');
}

/** map: the whole world as structure — extent, terrain, water, every root thing with pose and children, flags, prayers. */
export async function map(opts = {}) {
  const m = await mirror(); const v = view(m); const s = m.snapshot;
  const lines = [];
  lines.push(`# ${s.worldId} — ${s.constants.extent} m square (±${s.constants.extent / 2}), ground ${s.constants.ground}, seq ${s.seq}${m.offline ? ' (OFFLINE: cached)' : ''}`);
  lines.push(`sky ${s.state.sky.palette}, ${s.entities.length} entities, ${s.library.length} defs, ${s.prayers.length} prayers waiting, undo ${s.undoable ?? '-'} / redo ${s.redoable ?? '-'}${load().group ? `, group "${load().group}"` : ''}`);
  if (load().build) lines.push(buildHeader(load().build, s.builds?.find((b) => b.id === load().build.id)));
  const land = s.ground.landforms.filter((l) => !l.id.endsWith(':pad'));
  const nameOf = (id) => v.byId.get(id)?.path ?? id;
  if (land.length) { lines.push('## terrain'); for (const l of land) lines.push(`- ${nameOf(l.id)}: ${l.kind}${l.kind === 'bump' ? ` at (${r2(l.c[0])}, ${r2(l.c[1])}) r ${r2(l.r)} h ${r2(l.h)}` : l.kind === 'ridge' ? ` along ${l.path.length} pts w ${l.w} h ${l.h}` : l.h !== undefined ? ` h ${l.h}` : ''}`); }
  if (s.ground.waters.length) { lines.push('## water'); for (const w of s.ground.waters) lines.push(`- ${nameOf(w.id)}: level ${w.level}`); }
  const roots = v.rows.filter((r) => r.parent === 'world' && !isFlagDef(v.def(r.def)?.ref ?? r.def));
  const limit = opts.all ? Infinity : 120;
  if (roots.length) {
    lines.push(`## things (${roots.length} at the root${roots.length > limit ? `; first ${limit}, --all for every one` : ''})`);
    for (const r of roots.slice(0, limit)) {
      const kids = v.children(r.id);
      const shape = r.shape ? (r.shape.area ? ` area ~${r2(r.aabb[2] - r.aabb[0])}×${r2(r.aabb[3] - r.aabb[1])} m around ${fmtP([centreOf(r).x, centreOf(r).z])}` : ` path ${r.shape.path.length} pts ${fmtP(r.shape.path[0])}→${fmtP(r.shape.path.at(-1))}`) : ` at ${fmtP([r.pose[0], r.pose[1], r.pose[2]])} ${yawWord(r.pose[3])}`;
      lines.push(`- ${r.path} [${r.def.replace(/^core-/, 'core/')}]${shape}${r.form === 'point' && !r.shape ? ` ${r2(r.box[0])}×${r2(r.box[2])} m` : ''}${kids.length ? ` — ${kids.length} inside: ${kids.slice(0, 8).map((k) => k.name ?? k.id).join(', ')}${kids.length > 8 ? '…' : ''}` : ''}`);
    }
  }
  const fl = v.rows.filter((r) => isFlagDef(v.def(r.def)?.ref ?? r.def));
  if (fl.length && godFeature('flags')) { lines.push('## flags (refer to them as flag:<name>)'); for (const r of fl) lines.push(`- flag:${r.name} "${v.entity(r.id)?.state?.label ?? ''}" at (${r.pose[0]}, ${r.pose[2]})`); }
  if (s.prayers.length) { lines.push('## prayers'); for (const p of s.prayers) lines.push(`- ${p.id} from ${p.soul_name}: ${p.text}`); }
  return opts.json ? { text: lines.join('\n'), snapshot: s } : lines.join('\n');
}

/** defs <query>: search the library (always search before you define). */
/** Builder words the server's catalog search (L5, ranked, with its own synonyms) does not map yet: their
 *  matches are appended after the server's own ranking. */
const SYNONYMS = { house: ['townhouse'], home: ['townhouse'], street: ['road'], lane: ['road', 'track'], trail: ['footpath'], path: ['footpath'],
  walkway: ['footpath'], square: ['plaza'], forest: ['woodland'], woods: ['woodland'], wood: ['woodland'], meadow: ['wildflowers'], field: ['lawn', 'wildflowers'],
  grass: ['lawn'], water: ['lake', 'pond', 'river'], creek: ['stream'], wall: ['garden-wall', 'fence'], animal: ['creature'], animals: ['animals'],
  herd: ['animals'], flock: ['animals'], pet: ['dog', 'cat'], stall: ['parasol-table', 'crate'], market: ['parasol-table', 'crate', 'barrel'], church: ['chapel'] };
const forms = (w) => [...new Set([w, ...(w.length > 3 ? [w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y')] : [])])];
const synonymsOf = (w) => [...new Set(forms(w).flatMap((f) => SYNONYMS[f] ?? []))];
/** A def's --scale range in words: "--scale 0.4–2.5" or "fixed size". */
const scaleText = (d) => { const sc = d?.size?.scale; return !sc ? '' : sc[0] === sc[1] ? (sc[0] === 1 ? 'fixed size (no --scale)' : `--scale ${sc[0]} only`) : `--scale ${sc[0]}–${sc[1]}`; };
const fieldText = (k, f) => `${k}: ${f.type}${f.values ? ` ${f.values.join('|')}` : ''}${f.min !== undefined || f.max !== undefined ? ` ${f.min ?? ''}…${f.max ?? ''}` : ''}${f.default !== undefined ? ` = ${typeof f.default === 'object' ? JSON.stringify(f.default) : f.default}` : ''}${f.doc ? ` — ${f.doc}` : ''}`;
/** defs <one def's name or full ref>: that def in full (params with ranges and defaults, size, slots, rooms). */
async function defDetail(d, others) {
  const ref = d.ref.replace(/^core-/, 'core/');
  const L = [`${ref} — ${d.form}, ${d.layer}, ${d.size.box.map(r2).join('×')} m${d.form === 'point' ? `, ${scaleText(d)}` : ''}${d.make?.gen ? `, made by ${d.make.gen}` : ''}${d.tags.length ? ` [${d.tags.join(' ')}]` : ''}${usedBadge(d)}`];
  if (d.description) L.push(`  ${d.description}`);
  const ps = Object.entries(d.params ?? {});
  if (ps.length) { L.push(`  params (--param k=v):`); for (const [k, f] of ps) L.push(`  - ${fieldText(k, f).slice(0, 240)}`); }
  if (d.state && Object.keys(d.state).length) L.push(`  state (--state '{…}'): ${Object.entries(d.state).map(([k, f]) => fieldText(k, f)).join('; ').slice(0, 300)}`);
  // VOCAB-MECH: where it sits in the catalogue, the words for it, and what Souls can do with it
  if (d.category || d.synonyms?.length) L.push(`  catalogue: ${d.category ?? '(inferred)'}${d.synonyms?.length ? ` · aka ${d.synonyms.join(', ')}` : ''}`);
  if (d.actions?.length) L.push(`  Souls can: ${d.actions.map((a) => `${a.name}${a.when?.length ? ` (when ${a.when.map((w) => `${w.field}${w.is !== undefined ? '=' + JSON.stringify(w.is) : '≠' + JSON.stringify(w.not)}`).join(', ')})` : ''}`).join('; ')} — offered to Souls near it as object:<id>:<action>`);
  try {
    const b = await bakeInfo(ref.includes('@') ? ref : `${ref}@1`, {});
    if (b.rooms?.length) L.push(`  rooms at the defaults: ${b.rooms.map((r) => `${r.id} (floor ${r.floor})`).join(', ')}`);
    const sl = (b.slots ?? []).filter((x) => !['room', 'wall'].includes(x.kind));
    if (sl.length) L.push(`  slots: ${sl.map((x) => `${x.id} (${x.kind}, holds ${x.capacity})`).join(', ')}`);
  } catch { /* bake is a nicety */ }
  if (others.length) L.push(`  other defs matching: ${others.slice(0, 12).join(', ')}${others.length > 12 ? ' …' : ''}`);
  return L.join('\n');
}
export async function defs(q, flags = {}) {
  if (flags.remove && !flags.unused) throw Error('defs --remove requires --unused');
  if (flags.unused) {
    if (q || flags.tag) throw Error('defs --unused does not take a search or tag filter');
    const r = ok(await call(`/v1/god/defs/unused${flags.remove ? '/remove' : ''}`, flags.remove ? { body: {} } : {}), 'defs --unused');
    if (flags.remove) { invalidate(); return flags.json ? r : `removed ${r.removed.length} never-placed trial defs (seq ${r.seq})${r.remaining ? `; ${r.remaining} remain` : ''}; undo restores them`; }
    return flags.json ? r.defs : `${r.defs.length} never-placed trial defs${r.defs.length ? ':\n' + r.defs.map(d => '- ' + d.ref).join('\n') : ''}`;
  }
  if (q && !/\s/.test(q.trim())) {
    const name = q.trim().toLowerCase().replace(/^core[/-]/, '').replace(/@\d+$/, '');
    const qs = new URLSearchParams({ q: name.replace(/-/g, ' ') });
    const list = ok(await call(`/v1/god/defs?${qs}`), 'defs').defs;
    const want = /@\d+$/.test(q) ? q.trim().replace(/^core\//, 'core-') : null;
    const hit = list.find((d) => (want ? d.ref === want || d.ref === want.replace(/^core-/, '') : d.name === `core-${name}` || d.name === name));
    if (hit && !flags.json) return defDetail(hit, list.filter((d) => d !== hit).map((d) => d.ref.replace(/^core-/, 'core/')));
    if (hit && flags.json) return hit;
    if (want) return `no def ${q}. \`defs ${name.replace(/-/g, ' ')}\` searches the library.`;
  }
  const get = async (words) => { const qs = new URLSearchParams(); if (words) qs.set('q', words); if (flags.tag) qs.set('tag', flags.tag); return ok(await call(`/v1/god/defs?${qs}`), 'defs').defs; };
  const r = { defs: await get(q) };
  if (q) {
    const seen = new Set(r.defs.map((d) => d.ref));
    for (const syn of [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean).flatMap(synonymsOf))]) for (const d of (await get(syn)).slice(0, 3)) if (!seen.has(d.ref)) { seen.add(d.ref); r.defs.push(d); }
  }
  const rows = r.defs.map((d) => ({ ref: d.ref.replace(/^core-/, 'core/'), form: d.form, layer: d.layer, box: d.size.box, scale: d.size.scale, tags: d.tags, params: Object.fromEntries(Object.entries(d.params).map(([k, f]) => [k, f.default ?? f.type])), slots: d.slots.map((x) => `${x.id}:${x.kind}`), description: d.description, ...(usedIn(d).length ? { usedIn: usedIn(d) } : {}) }));
  if (flags.json) return rows;
  if (!rows.length) return `no defs match "${q ?? ''}". Try a broader word, or define one: define-kit (see SKILL.md).`;
  return [`${rows.length} defs${q ? ` matching "${q}"` : ''}:`, ...rows.slice(0, flags.all ? 999 : 40).map((d) => `- ${d.ref} (${d.form}, ${d.layer}, ${d.box.map(r2).join('×')} m${d.form === 'point' && d.scale ? `, ${d.scale[0] === d.scale[1] ? 'fixed size' : `scale ${d.scale[0]}–${d.scale[1]}`}` : ''})${d.tags.length ? ` [${d.tags.slice(0, 6).join(' ')}]` : ''}${Object.keys(d.params).length ? ` params: ${Object.entries(d.params).slice(0, 10).map(([k, v]) => `${k}=${typeof v === 'object' ? 'json' : v}`).join(' ')}` : ''}${d.slots.length ? ` slots: ${d.slots.slice(0, 6).join(' ')}` : ''}${d.description ? ` — ${d.description.slice(0, 110)}` : ''}${usedBadge(d)}`), rows.length > 40 && !flags.all ? `… ${rows.length - 40} more (--all)` : ''].filter(Boolean).join('\n');
}

export async function schema(flags = {}) { const s = ok(await call('/v1/god/schema', { as: 'none' }), 'schema'); return flags.md ? schemaMarkdown(s) : s; }

export async function query(q) { return ok(await call('/v1/god/query', { body: typeof q === 'string' ? JSON.parse(q) : q }), 'query'); }
/** verify-use: a temporary server-side resident proves actual entry and seating. */
export async function verifyUse(target, flags = {}) {
  if (!target) throw new Error('usage: verify-use <target> [--seat <ref>] [--from <ref|x,z>] [--uses enter,sit] [--json]');
  const body = { target };
  if (flags.seat) body.seat = flags.seat;
  if (flags.from !== undefined) {
    const text = String(flags.from), parts = text.split(',').map(Number);
    if (text.includes(',')) {
      if (parts.length !== 2 || text.split(',').some(x => !x.trim()) || !parts.every(Number.isFinite)) throw new Error('--from takes a reference or x,z');
      body.from = parts;
    } else body.from = text;
  }
  if (flags.uses !== undefined) {
    const uses = String(flags.uses).split(',');
    if (!uses.length || uses.some(x => !['enter', 'sit'].includes(x)) || new Set(uses).size !== uses.length) throw new Error('--uses takes enter, sit, or enter,sit');
    body.uses = uses;
  }
  const receipt = ok(await call('/v1/god/verify-use', { body, timeoutMs: 190_000 }), 'verify-use');
  if (flags.json) return receipt;
  const lines = (receipt.uses ?? []).map(r => `${r.use}: ${r.ok ? 'OK' : 'FAILED'}${r.ok ? (r.use === 'sit' ? ` — ${r.seat}; ${r.occupant}; ${r.distanceToSlot} m from slot` : ` — ${r.room ?? target}${r.door ? ` via ${r.door}` : ''}`) : ` — ${r.reason?.code ?? 'verify.refused'}${r.reason?.engineCode ? ` (${r.reason.engineCode})` : ''}: ${r.reason?.message ?? 'unconfirmed'}`}`);
  if (!lines.length && receipt.reason) lines.push(`FAILED: ${receipt.reason.code}: ${receipt.reason.message}`);
  lines.push(`probe ${receipt.probe?.created === false ? 'not created' : receipt.probe?.removed ? 'removed' : receipt.probe?.removal === 'pending' ? 'removal pending (native retirement accepted)' : 'REMOVAL UNCONFIRMED'}; ${Math.round(receipt.ms ?? 0)} ms`);
  if (receipt.timings) lines.push(`timings (ms): ${['birth', 'start', 'enter', 'sit', 'retire'].map(phase => `${phase} ${Math.round(receipt.timings[phase] ?? 0)}`).join('; ')}`);
  for (const result of receipt.uses ?? []) {
    if (result.proof) lines.push(`  ${result.use} proof: ${result.proof.kind} at ${result.proof.at.join(',')}; tick ${result.proof.tick}; ${Math.round(result.proof.ms)} ms`);
    if (result.interiorRoute) { const route = result.interiorRoute; lines.push(`  interior route: engine planner ${route.reach.ok ? `OK (${route.reach.length} m)` : `FAILED (${route.reach.code})`}${route.relocatedTo ? `; relocated to ${route.relocatedTo.join(',')}` : ''}; final approach physical`); }
  }
  for (const note of receipt.notes ?? []) if (/full physical walk/.test(note)) lines.push(note);
  return lines.join('\n');
}

/** The engine's own route check of a building (server `describe.walk`): can a resident walk into each room from the front door, and out again? */
export function walkLine(walk) {
  if (!walk) return '';
  if (walk.state === 'pending' || walk.state === 'unchecked') return `  walk: not checked — ${walk.note}`;
  if (walk.state === 'ok') return `  walk: all ${walk.rooms.length} room${walk.rooms.length === 1 ? '' : 's'} can be walked into from the front door and out again (the engine's own route check: it overrides "reachable from outside" in the notes, which only reads the design's doors and stairs)`;
  // R2F: an end the engine cannot stand at is said plainly. The server marks it: a room end with no standing room carries
  // why.<side>.endpoint (into a room the room is the `to` end, out of it the `from` end), or room.no-standing-room when the
  // engine's nearest spot is outside the room. Any other failure (a route, a missing room or entity) keeps its code, with
  // the detail for reach.bad-*. The front-door stand is a point, which the engine never refuses as an end.
  const floorIn = (r) => r.in === 'room.no-standing-room' || r.why?.in?.endpoint?.side === 'to';
  const floorOut = (r) => r.out === 'room.no-standing-room' || r.why?.out?.endpoint?.side === 'from';
  const bad = walk.rooms.filter((r) => r.in !== true || r.out !== true), floorless = bad.filter((r) => floorIn(r) || floorOut(r));
  const failure = (code, w) => (/^reach\.bad-/.test(code) && w?.detail ? `${code}: ${w.detail}` : code);
  const why = (r) => [r.in !== true && !floorIn(r) && `no way in (${failure(r.in, r.why?.in)})`, r.out !== true && !floorOut(r) && `no way out (${failure(r.out, r.why?.out)})`].filter(Boolean).join(', ');
  const routes = bad.filter((r) => why(r));
  const parts = [
    floorless.length && `the engine has no floor to stand on in room${floorless.length > 1 ? 's' : ''} ${floorless.map((r) => `${r.id} (floor ${r.floor})`).join(', ')}`,
    ...routes.map((r) => `${r.id} (floor ${r.floor}): ${why(r)}`),
  ].filter(Boolean);
  const fix = [floorless.length && `give ${floorless.length > 1 ? 'those rooms' : 'that room'} a floor the engine can stand on (the floor may be missing for the engine, or the room filled wall to wall; describe --json shows where it looked)`, routes.length && 'fix the stairs, doors or whatever stands in the way'].filter(Boolean).join('; ');
  return `  walk: NOT WALKABLE — ${parts.join('; ')}. This is the engine's own route check, so a resident cannot use these rooms whatever "reachable from outside" in the notes says; ${fix}, then describe again.`;
}

/** describe <ref>: rooms, doors, stairs, slots, occupants, constraints (satisfied or not), behaviours, ground, neighbours. */
export async function describe(ref, flags = {}) {
  if (!ref) throw new Error('usage: describe <path|flag:name>');
  { const v = view(await mirror()); const set = !v.get(ref) && setOf(v, ref); if (set) { const parts = []; for (const r of set.members) parts.push((await describe(r.path, flags)).split('\n').slice(0, 3).join('\n')); return flags.json ? parts : [`${ref} is a set of ${set.members.length}: ${set.members.map((r) => r.name).join(', ')} — refer to all of them as ${ref} (--near, --facing, look --at, move --by, remove, recolor) or one by its own name`, ...parts].join('\n'); } }
  let d = (await query({ describe: ref.replace(/^flag:/, '') })).describe;
  if (d.error && ref.includes('/')) {
    // a room of a building: house/<room> (rooms are slots, not entities)
    const cut = ref.lastIndexOf('/'), h = (await query({ describe: ref.slice(0, cut) })).describe, word = ref.slice(cut + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
    const room = h.error ? null : (h.rooms ?? []).find((r) => r.id === ref.slice(cut + 1)) ?? (h.rooms ?? []).find((r) => r.id.replace(/[^a-z0-9]/g, '').startsWith(word));
    if (room) { if (flags.json) { const walked = h.walk?.rooms?.find((r) => r.id === room.id); return walked ? { ...room, walk: { state: h.walk.state, from: h.walk.from, ...walked } } : room; } return [`${h.path}/${room.id} — room "${room.name}" of ${h.path}, floor ${room.floor} (y ${room.y}), ${room.size.join('×')} m, headroom ${room.height} m`, `  doors: ${room.doors.join(', ') || 'none'}`, `  holds: ${room.occupants.map((o) => o.name).join(', ') || 'nothing'}`, ...(h.walk?.rooms.find((r) => r.id === room.id) ? [walkLine({ ...h.walk, rooms: h.walk.rooms.filter((r) => r.id === room.id) })] : []), `  place into it: --inside ${h.path}/${room.id} [--wall back|front|left|right] [--corner back-left|…]; furnish ${h.path}/${room.id}`].join('\n'); }
  }
  if (d.error) throw new Error(d.error);
  if (flags.json) return d;
  const L = [];
  L.push(`${d.path} [${d.def.replace(/^core-/, 'core/')}] ${d.layer} ${d.form}${d.anchor !== 'base' ? `, anchor ${d.anchor}` : ''} — ${d.in === 'world' ? 'at the root' : `in ${d.in.parent}${d.in.slot ? ` (slot ${d.in.slot})` : ''}`}`);
  if (d.description) L.push(`  ${d.description.slice(0, 200)}`);
  const sc = d.form === 'point' ? scaleText(view(await mirror()).def(d.def)) : '';
  L.push(`  pose (${d.pose.x}, ${d.pose.y}, ${d.pose.z}) facing ${d.pose.faces} (yaw ${d.pose.yaw})${d.pose.s !== 1 ? ` scale ${d.pose.s}` : ''}${sc ? `, ${sc}` : ''}; size ${d.box.join('×')} m; bounds x ${d.aabb[0]}…${d.aabb[2]}, z ${d.aabb[1]}…${d.aabb[3]}, y ${d.y[0]}…${d.y[1]}; ${d.colliders} colliders, ~${d.tris} tris`);
  if (d.shape?.path) L.push(`  path: ${d.shape.points} points, ${d.shape.length} m${d.shape.width ? `, ${d.shape.width} m wide` : ''}: ${d.shape.path.map((p) => `${r2(p[0])},${r2(p[1])}`).join(' → ')}${d.shape.points > d.shape.path.length ? ' (ends)' : ''}; middle ${d.shape.middle.join(',')}`);
  if (d.shape?.points && !d.shape.path) L.push(`  area: ${d.shape.points} corners, ${d.shape.size.join('×')} m around ${d.shape.centre.join(',')}`);
  if (Object.keys(d.params).length) L.push(`  params ${JSON.stringify(d.params).slice(0, 300)}`);
  if (Object.keys(d.state).length) L.push(`  state ${JSON.stringify(d.state).slice(0, 300)}`);
  if (d.rooms.length) { L.push(`  rooms (${d.rooms.length}):`); for (const r of d.rooms) L.push(`  - ${r.id} "${r.name}" floor ${r.floor} (y ${r.y}), ${r.size.join('×')} m, headroom ${r.height} m${r.doors.length ? `, ${r.doors.join(', ')}` : ''}; ${r.occupants.length ? `holds ${r.occupants.map((o) => o.name).join(', ')}` : 'empty'} — place into it with --inside ${d.path}/${r.id}`); }
  if (d.openings.length) L.push(`  openings: ${d.openings.map((o) => `${o.kind} ${o.id} (floor ${o.level}, ${o.width}×${o.height} m, faces ${o.faces}, ${o.state}) at (${o.at.join(', ')})`).join('; ')}`);
  if (d.links.length) L.push(`  links: ${d.links.map((l) => `${l.kind} ${l.id} floor ${l.from}→${l.to}, ${l.width} m wide`).join('; ')}`);
  if (d.slots.length) L.push(`  slots: ${d.slots.map((s) => `${s.id} (${s.kind}, ${s.used}/${s.capacity}${s.occupants.length ? ': ' + s.occupants.join(', ') : ''})`).join('; ')}`);
  if (d.children.length) L.push(`  children: ${d.children.map((c) => c.name).join(', ')}`);
  if (d.constraints.length) L.push(`  constraints: ${d.constraints.map((c) => `${c.ok ? 'ok' : 'VIOLATED'} ${c.kind}${c.ref ? ' ' + c.ref : ''}${c.why ? ` (${c.why})` : ''}`).join('; ')}`);
  const b = d.behaviours; if (b.supported.length || Object.keys(b.missing).length) L.push(`  behaviours: ${b.supported.join(', ') || 'none'}${Object.keys(b.missing).length && (b.supported.length || d.tags.some((t) => /creature|animal/.test(t))) ? `; cannot: ${Object.entries(b.missing).map(([k, why]) => `${k} (${why})`).join('; ')}` : ''}`);
  L.push(`  ground: y ${d.ground.y}, slope ${d.ground.slopeDeg}°, ${d.ground.medium}${d.ground.water ? `, water ${d.ground.water} m deep` : ''}`);
  if (d.near.length) L.push(`  near: ${d.near.map((n) => `${n.path} ${n.dist} m ${n.dir}`).join(', ')}`);
  if (d.notes.length) L.push(`  notes: ${d.notes.join(' | ')}`);
  if (d.walk) L.push(walkLine(d.walk));
  return L.join('\n');
}

/** where <x,z|ref>: terrain, water, what contains the point, the room it is in, the nearest things. */
export async function where(spec, flags = {}) {
  const m = await mirror(); const v = view(m);
  const p = refPoint(v, spec, flags.offset);
  // Ask the existing clearance query for a point's standing-height column in the
  // same request. Bounds alone cannot tell whether an open gate's passage is blocked.
  const result = await query({ where: [p.x, p.z], clearance: { at: [p.x, p.z], size: [0, 0] } });
  const d = result.where, colliders = new Set(result.clearance?.blockedBy ?? []);
  void attention([d.x, d.y, d.z]); // CE8 fire-and-forget
  if (flags.json) return d;
  return [`(${d.x}, ${d.z}): ground y ${d.y}, slope ${d.slopeDeg}°, ${d.medium}${d.water ? `, water level ${d.water.level} (${d.water.depth} m deep)` : ''}`,
    d.room ? `  inside ${d.room.building}, room ${d.room.room} (floor ${d.room.floor})` : '',
    d.inside.length ? `  within: ${d.inside.map((x) => `${x.path} [${colliders.has(x.path) ? 'collider' : 'bounds'}] (${x.layer})`).join(', ')}` : '  nothing built here',
    d.near.length ? `  nearest: ${d.near.map((n) => `${n.path} ${n.dist} m ${n.dir}`).join(', ')}` : ''].filter(Boolean).join('\n');
}

/** reach <from> <to>: the server's engine route check; refs (including path:room) stay server-side. */
export async function reach(from, to, flags = {}) {
  const end = (s) => {
    if (typeof s !== 'string' || !s.trim()) throw new Error('reach needs <from> <to> (refs or x,z / x,y,z)');
    if (!s.includes(',')) return s;
    const parts = s.split(',');
    if (![2, 3].includes(parts.length) || parts.some(x => !x.trim() || !Number.isFinite(Number(x)))) throw new Error('reach coordinates need x,z or x,y,z');
    return parts.map(Number);
  };
  const d = (await query({ reach: { from: end(from), to: end(to) } })).reach;
  if (flags.json) return d;
  if (d.supported === false) return `reach: not checked — ${d.note}`;
  return `reach: ${d.reachable ? 'OK' : 'FAILED'}${d.length !== undefined ? ` (${d.length} m)` : ''}${d.code ? ` — ${d.code}` : ''}${d.detail ? ` — ${d.detail}` : ''}${d.note ? ` — ${d.note}` : ''}`;
}

/** clear <x,z|ref> --size WxD: the existing footprint-clearance query, without editing. */
export async function clear(spec, flags = {}) {
  if (typeof spec !== 'string' || !spec.trim()) throw new Error('clear needs <x,z|ref> --size WxD');
  if (typeof flags.size !== 'string') throw new Error('clear needs --size WxD');
  const size = buildPair(flags.size.replace(/[x×]/i, ','), '--size');
  if (size.some(x => x <= 0)) throw new Error('--size must be positive');
  let point;
  if (spec.includes(',')) point = buildPair(spec, 'clear position');
  else { const p = refPoint(view(await mirror()), spec); point = [p.x, p.z]; }
  const d = (await query({ clearance: { at: point, size } })).clearance;
  return flags.json ? d : d.clear ? `clear: ${size.join('×')} m at ${point.join(',')}` : `blocked: ${d.blockedBy.join(', ')}`;
}

/** free WxD [--near ref] [--radius r] [--count n]: flat dry plots nobody occupies. */
export async function freePlots(size, flags = {}) {
  const [w, d] = String(size ?? '8x8').split(/[x×,]/).map(Number);
  const m = await mirror(); const v = view(m);
  const near = flags.near ? refPoint(v, flags.near) : { x: 0, z: 0 };
  const r = (await query({ free: { size: [w, d], near: [near.x, near.z], radius: flags.radius ? num(flags.radius) : 150, count: flags.count ? num(flags.count) : 4, maxSlope: flags.slope ? num(flags.slope) : 0.25 } })).free;
  if (r[0]) void attention([r[0].at[0], r[0].y, r[0].at[1]]); // CE8: the best plot
  return flags.json ? r : r.length ? r.map((f) => `- (${f.at.join(', ')}) y ${f.y}, slope ${f.slope}, ${f.dist} m from (${near.x}, ${near.z})`).join('\n') : 'no free plot of that size within the radius';
}

// ---------------------------------------------------------------- writing
export async function act(batch, note, requestRef) {
  const want = mirrorState(), held = want ? heldMirror() : null; // G2: the answer carries the mirror delta, so the read after an edit costs nothing
  const r = ok(await call('/v1/god/act', { requestRef, body: { ...batch, ...(note ? { note } : {}), ...(want ? { mirror: want } : {}) } }), 'act');
  invalidate();
  if (r.mirror) { adoptMirror(r.mirror, held); delete r.mirror; }
  return r;
}
export async function dryrun(batch) { return ok(await call('/v1/god/dryrun', { body: batch }), 'dryrun'); }
export async function preview(batch) {
  const r = ok(await call('/v1/god/preview', { body: typeof batch === 'string' ? JSON.parse(batch) : batch }), 'preview');
  if (!r.accepted) return r;
  const commit = `node eden-god.mjs commit ${r.id}`;
  // G5: the page's ghost of a preview is switched off (lib/features.mjs): no link to it, only the commit
  if (!godFeature('previews')) { const { url: _url, viewKey: _key, ...rest } = r; return { ...rest, commit, tell: `Preview ${r.id}: run \`${commit}\` to build it.` }; }
  return { ...r, url: `${load().world}${r.url ?? `?preview=${r.id}`}`, commit, tell: `Preview ${r.id}: open ${load().world}${r.url ?? `?preview=${r.id}`} to see the ghost; run \`${commit}\` to build it.` };
}
export async function commit(id) { if (!id) throw new Error('usage: commit <preview-id>'); const r = ok(await call('/v1/god/act', { body: { preview: id } }), 'commit'); invalidate(); return r; }
export async function request(clientRef) { if (!clientRef) throw new Error('usage: request <clientRef>'); return ok(await call(`/v1/god/requests/${encodeURIComponent(clientRef)}`), 'request'); }
/** plan '<batch>': a dry run, summarised in words. */
export async function planBatch(batch) {
  const b = typeof batch === 'string' ? JSON.parse(batch) : batch;
  const r = await dryrun(b);
  if (!r.accepted) return `would be REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
  return `would be accepted: ${r.diff.upserts} things placed/changed, ${r.diff.removes} removed${r.diff.defs.length ? `, defines ${r.diff.defs.join(', ')}` : ''}${r.diff.tiles ? `, ${r.diff.tiles} terrain tiles` : ''}${r.warnings.length ? `; warnings: ${r.warnings.join('; ')}` : ''}${r.wouldMove?.length ? `; residents it would walk out (never refused): ${r.wouldMove.map((m) => `${m.name} (${m.how})`).join(', ')}` : ''}`;
}
const HINTS = {
  'build.unknown': '`build` lists sites; start a new build or check its id',
  'build.closed': 'start a new build with a new id',
  'build.exists': 'pick a new id or `build resume <id>`',
  'build.limit': 'finish or abandon a build, or release a claim',
  'build.site': 'move or shrink the site or mass',
  'build.group': 'drop the subgroup or carry the build',
  'build.lease': 'the lease changed; run `build resume <id>` before editing',
  'build.leased': 'the lead is live; wait or ask it to stop; --take only when it has stopped',
  'build.claim': 'edit only under the claim root / inside its region',
  'build.claimed': 'another live claim owns this part; wait or ask for release',
  'build.claim-unknown': '`build show` lists claims; the claim was released or taken',
  'build.claims-open': 'release live claims, or use --force',
  'build.undo-incomplete': 'the build stays open; inspect notReverted before trying again',
  'site.under-construction': 'finish the build before residents use it',
  'architecture.sealed': 'preserve another entrance or clear the named approach',
  'budget.world': 'use field/measured/limit/fix to reduce or spread construction',
  'budget.region': 'use field/measured/limit/fix to reduce or spread construction',
  'overlap.solid': 'something solid is there; the server suggests a spot (suggest.p) — the solver already tried it; try --near with --dist, --free, or remove the blocker',
  'support.none': 'nothing to rest on; give a parent or a 2-D p so it settles on the ground',
  'extent.outside': 'outside the world; `expand <metres>` grows it, or place nearer the centre',
  'slot.unknown': 'that slot does not exist; `describe <parent>` lists slots and rooms',
  'slot.full': 'the slot is full; pick another slot or room',
  'slot.incompatible': 'the slot does not accept this kind/size',
  'slot.outside': 'the point is not inside that room; use --inside <house>/<room> or a world point inside it',
  'size.furnished': 'its furniture would poke through the walls at that size; the refusal names the smallest w/d it fits',
  'size.range': 'that scale or size is outside what the def allows: `defs <name>` shows its --scale range (fixed size = no --scale); use params (w, d, height, radius) or a bigger def instead',
  'float.no-water': 'there is no water there; use --float --at <lake|pond|river>',
  'def.in-use': 'cleanup only removes never-placed trials without dependent definitions; keep this def',
  'def.unknown': 'no such def; `defs <word>` searches the library',
  'params.invalid': '`defs <name>` shows params with ranges',
  'state.invalid': 'unknown or bad state field; `describe` shows the state',
  'name.taken': 'names are unique per parent; choose another --name',
  'body.protected': 'a resident\'s body moves itself; edit the things around it (residents in the way are walked out); people as scenery: place figure',
  'entity.unknown': 'no such thing; `map` lists paths',
  'architecture.unreachable': 'a room has no way in; add a door (plan) or stairs',
  'architecture.headroom': 'a floor is too low; raise floorHeight',
  'constraint.unsatisfied': 'the constraint cannot hold (its ref is gone or impossible)',
  'undo.conflict': 'the world changed since; undo the later edit first or fix by hand',
};
export const explainFailure = (f) => `${f.code} (op ${f.op}): ${f.detail}${f.field ? ` — field ${f.field}` : ''}${f.fix ? ` — fix: ${f.fix}` : ''}${f.suggest?.p ? ` — suggest p ${JSON.stringify(f.suggest.p)}` : ''}${HINTS[f.code] ? ` [${HINTS[f.code]}]` : ''}${f.code === 'build.lease' && load().build ? `; run \`build resume ${load().build.id}\` before editing` : ''}`;

const parseKV = (list) => Object.fromEntries([].concat(list ?? []).map((kv) => { const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); return [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : /^[[{]/.test(v) ? JSON.parse(v) : v]; }));
const bakeCache = new Map();
// G2: bakes of shapeless defs kept in the folder per library state (a def's bake depends only on its content), so a
// place of a def used before needs no bake request. Only a commit whose ifSeq held may save them (place: ctx.bakes).
const BAKES = '.eden-god.bakes.json';
const readBakes = (lib) => { try { const b = JSON.parse(readFileSync(godFile(BAKES), 'utf8')); return b.lib === lib ? b.bakes : {}; } catch { return {}; } };
export function saveBakes(lib, fresh) {
  if (!lib || !Object.keys(fresh).length) return;
  try { const all = Object.entries({ ...readBakes(lib), ...fresh }).slice(-300); atomicWrite(godFile(BAKES), JSON.stringify({ lib, bakes: Object.fromEntries(all) })); } catch { /* best effort */ }
}
/** The physical facts of a def at given params (box, rooms, slots), from the server's own generators. `kept`: { lib,
 *  fresh } — read the folder's bakes for that library state and collect the ones fetched now (place saves them). */
export async function bakeInfo(def, params, shape, kept) {
  const key = JSON.stringify([def, params ?? {}, shape ?? null]);
  if (kept?.lib && !shape && !bakeCache.has(key)) { const b = readBakes(kept.lib)[key]; if (b) return b; }
  if (!bakeCache.has(key)) { const b = (await query({ bake: { def: normDef(def), params: params ?? {}, ...(shape ? { shape } : {}) } })).bake; if (b.error) { const word = String(def).replace(/^core[/-]/, '').replace(/@\d+$/, '').replace(/-/g, ' '); let near = []; if (/def\.unknown/.test(b.error)) try { near = (await defs(word, { json: true })).slice(0, 4).map((d) => d.ref); } catch { /* offline */ } throw new Error(`${b.error}${near.length ? ` — the library has: ${near.join(', ')}` : ''}. \`defs ${word}\` searches the library; define only what it lacks.`); } bakeCache.set(key, b); }
  if (kept?.lib && !shape) kept.fresh[key] = bakeCache.get(key);
  return bakeCache.get(key);
}
const uniqueName = (v, parentId, stem, taken) => { const has = (n) => taken.has(`${parentId}/${n}`) || v.rows.some((r) => r.parent === parentId && r.name === n); if (!has(stem)) return stem; for (let k = 2; k < 9999; k++) if (!has(`${stem}-${k}`)) return `${stem}-${k}`; return `${stem}-${Date.now() % 1e5}`; };
const relFrom = (f) => ({
  at: f.at, offset: f.offset, near: f.near, around: f.around, dist: f.dist, dir: f.dir, count: f.count, facing: f.facing, yaw: f.yaw,
  against: f.against, between: f.between ? [].concat(f.between).flatMap((x) => String(x).split(/\s+|;/)).filter(Boolean).slice(0, 2) : undefined,
  along: f.along, t: f.t, side: f.side === 'centre' ? 'center' : f.side, setback: f.setback ?? (f.along ? f.offset : undefined), inside: f.inside, corner: f.corner, wall: f.wall, on: f.on,
  row: f.row, grid: f.grid, gap: f.gap, spacing: f.spacing, float: !!f.float, from: f.from, to: f.to, via: f.via, width: f.width, across: f.across, span: f.span,
});
const hasRelation = (f) => ['at', 'near', 'around', 'against', 'between', 'along', 'across', 'inside', 'on', 'free', 'from', 'row', 'grid'].some((k) => f[k] !== undefined);

/**
 * place <def> [relations] — the solver turns relations into a pose, dry-runs, walks to the next candidate
 * (or the server's suggestion, or a nudge) on overlap, then commits and says what it did.
 */
const STALE = Symbol('the world changed since the cached mirror');
export async function place(defIn, flags = {}) {
  // G2: solve on the cached mirror; the commit's ifSeq says whether the world moved on, and only then do it again fresh
  // (any failure before the edit was sent, on a mirror read without a request, also tries again fresh: it may be stale)
  const ctx = { trusted: true, sent: false, read: false };
  try { return await placeOnce(defIn, flags, ctx); } catch (e) { if (e !== STALE && (ctx.sent || !ctx.read)) throw e; }
  return placeOnce(defIn, flags, { trusted: false, sent: false });
}
async function placeOnce(defIn, flags, ctx) {
  if (!defIn) throw new Error('usage: place <def> [--at …|--near …|--inside …|--on …|--along …|--against …|--between a b] [--facing …] [--name n] [--param k=v]');
  let def = normDef(defIn), readAs = null;
  if (flags.side !== undefined && flags.along === undefined) throw new Error('--side picks a side of a path: use it with --along <road|river|wall> (left|right|both); elsewhere use --dir or --facing');
  const params = flags.param ? parseKV(flags.param) : undefined;
  let shape;
  if (flags.path) shape = { path: JSON.parse(flags.path), ...(flags.width ? { width: num(flags.width) } : {}) };
  if (flags.area) shape = { area: JSON.parse(flags.area) };
  if (flags.rect) shape = { area: rectArea(flags.rect) };
  if (flags.circle) shape = { area: circleArea(flags.circle) };
  let info;
  if (ctx.trusted) ctx.bakes = { lib: mirrorState()?.lib, fresh: {} };
  try { info = await bakeInfo(def, params, shape, ctx.bakes); } catch (e) {
    // def.unknown although the library has exactly one def of that name (core/<local>, a name without @v, <core name>@v)
    const alt = /def\.unknown/.test(String(e?.message)) ? resolveDef(view(await mirror({ fresh: true })), defIn) : null;
    if (!alt) throw e;
    def = alt; readAs = `read "${defIn}" as ${alt} (the only def of that name)`; info = await bakeInfo(def, params, shape);
  }
  const tell = (r) => (!readAs ? r : typeof r === 'string' ? `${r}\n  note: ${readAs}` : { ...r, readAs });
  if (info.form !== 'point' && !shape && !(info.form === 'path' && (flags.from || flags.between || flags.across))) throw new Error(`${def} is a ${info.form} def: give ${info.form === 'path' ? '--path \'[[x,z],…]\' [--width w] or --from <ref> --to <ref> [--via x,z]' : '--area \'[[x,z],…]\', --rect cx,cz,w,d or --circle cx,cz,r'}`);
  const m = await mirror({ trust: ctx.trusted }); ctx.read = wasTrusted(); const v = view(m);
  if (flags.free) {
    const near = flags.near ? refPoint(v, flags.near) : flags.at ? refPoint(v, flags.at) : { x: 0, z: 0 };
    const spots = (await query({ free: { size: [info.box[0] + 1, info.box[2] + 1], near: [near.x, near.z], radius: flags.radius ? num(flags.radius) : 200, count: Number(flags.count ?? 1) } })).free;
    if (!spots.length) throw new Error('no free flat dry plot found; try --radius or a smaller thing');
    flags = { ...flags, at: undefined, near: undefined };
    return tell(await commitItems(v, def, info, flags, params, spots.map((s) => ({ candidates: [{ p: s.at, ...(flags.facing ? {} : {}), note: `on a free plot ${s.dist} m from (${near.x}, ${near.z})` }] })), [], { ctx }));
  }
  if (shape) return tell(await commitItems(v, def, info, flags, params, [{ candidates: [{ shape, note: shape.path ? `path of ${shape.path.length} points` : `area of ${shape.area.length} corners` }] }], [], { ctx }));
  if (!hasRelation(flags) && flags.yaw === undefined && flags.facing === undefined) throw new Error('where? give --at x,z|ref, --near ref, --inside house/room, --on table, --along road, --against ref, --between a b, or --free');
  const sol = solve(v, { def, form: info.form, layer: info.layer, box: info.box, s: flags.scale ? num(flags.scale) : 1 }, relFrom(flags));
  return tell(await commitItems(v, def, info, flags, params, sol.items, sol.notes, { ctx }));
}
const PREPARED = new Set(['road/1', 'path/1', 'river/1', 'bridge/1', 'pier/1', 'deck/1']);
/** Roads, rivers, bridges, piers, decks freeze ground facts (grade, bridge spans, flow, deck height) into params
 *  before placement (L3's prepareFor, run on the server where the ground is). Returns { params, shape }. */
export async function prepareShape(def, info, shape, params) {
  if (!shape || !PREPARED.has(info.gen)) return { params, shape };
  const p = (await query({ prepare: { def: normDef(def), shape, params: params ?? {} } })).prepare;
  if (!p || p.error) return { params, shape };
  return { params: { ...(params ?? {}), ...(p.params ?? {}) }, shape: p.path ? { ...shape, path: p.path } : shape };
}
/** Build ops from solver items, dry-run, repair, commit. */
async function commitItems(v, def, info, flags, params, items, notes, { op = 'place', id, rowId, ctx = null } = {}) {
  if (!items.length) throw new Error('the solver found no placement');
  for (const it of items) for (const c of it.candidates) if (c.shape && PREPARED.has(info.gen)) { const pr = await prepareShape(def, info, c.shape, params); c.shape = pr.shape; c.params = pr.params; }
  const taken = new Set();
  if (op === 'place' && flags.name && items.length === 1) {
    const parentId = items[0].candidates[0]?.in ? v.get(items[0].candidates[0].in.parent)?.id ?? items[0].candidates[0].in.parent : 'world';
    const clash = v.rows.find((r) => r.parent === parentId && r.name === flags.name);
    if (clash) throw new Error(`REFUSED: name.taken: "${flags.name}" is already ${clash.path} [${clash.def.replace(/^core-/, 'core/')}]. Pick another --name, or move/remove that one.`);
  }
  const stem = flags.name ?? def.replace(/^core\//, '').replace(/@\d+$/, '').replace(/^core-/, '');
  const state = flags.state ? JSON.parse(flags.state) : undefined;
  const choice = items.map(() => 0), fixes = items.map(() => []);
  const mk = (k) => {
    const c = items[k].candidates[Math.min(choice[k], items[k].candidates.length - 1)];
    const o = { op, ...(op === 'place' ? { def } : { id }), mode: flags.nudge ? 'nudge' : 'strict' };
    if (c.p) o.p = c.p; if (c.r !== undefined) o.r = c.r; if (c.shape) o.shape = c.shape; if (c.in) o.in = c.in; if (c.anchor && op === 'place') o.anchor = c.anchor;
    if (flags.yaw !== undefined && c.r === undefined) o.r = num(flags.yaw);
    if (c.constraints?.length) o.constraints = c.constraints;
    if (op === 'place') {
      if (flags.about !== undefined) o.about = aboutValue(flags.about);
      if (c.params ?? params) o.params = c.params ?? params; if (state) o.state = state; if (flags.scale) o.s = num(flags.scale);
      const parentId = c.in ? v.get(c.in.parent)?.id ?? c.in.parent : 'world';
      o.name = items.length > 1 || !flags.name ? uniqueName(v, parentId, items.length > 1 && flags.name ? `${stem}-${k + 1}` : stem, taken) : flags.name;
      taken.add(`${parentId}/${o.name}`);
    }
    return o;
  };
  let ops = items.map((_, k) => mk(k));
  let r, committed = null;
  // G2: one round trip. The server walks the candidates this loop would try (same rules, same notes) and commits.
  if (items.length === 1 && !flags.dry && !flags.plan && speaksMirror()) {
    const keep = [...taken], world = () => [...taken].filter((t) => t.startsWith('world/'));
    const cands = [ops[0]], seen = [world()];
    for (let c = 1; c < items[0].candidates.length && c < 64; c++) { choice[0] = c; cands.push(mk(0)); seen.push(world()); }
    choice[0] = 0; taken.clear(); for (const t of keep) taken.add(t);
    const { ops: _o, ...dry } = decorate(load(), '/v1/god/dryrun', 'POST', { ops: [] });
    if (ctx) ctx.sent = true;
    const res = await act({ ops: [cands[0]], ...(flags.group ? { group: flags.group } : {}), repair: { candidates: cands, taken: seen, kind: op, dry, ifSeq: v.m.seq, ...(v.m.libraryHash ? { ifLib: v.m.libraryHash } : {}) } }, flags.note);
    const rep = res.repair; delete res.repair;
    if (rep?.stage === 'stale' && ctx?.read) { ctx.sent = false; throw STALE; }
    if (rep?.stage === 'act' && ctx?.read && ctx.bakes) saveBakes(ctx.bakes.lib, ctx.bakes.fresh); // the library was as cached
    if (rep?.stage !== 'stale') {
      if (rep) { choice[0] = rep.choice; fixes[0] = rep.fixes; ops = [rep.op]; }
      if (rep?.stage === 'dryrun') r = { accepted: false, failures: res.failures };
      else { r = { accepted: true }; committed = res; }
    }
  }
  const walked = !!r;
  if (!walked && ctx?.read) throw STALE; // the client-side loop needs a checked mirror: solve again on one
  for (let attempt = 0; attempt < 12 && !walked; attempt++) {
    r = await dryrun({ ops });
    if (r.accepted) break;
    const f = r.failures[0]; const k = f.op;
    if (k < 0 || k >= ops.length) break;
    if (f.code === 'overlap.solid') {
      if (choice[k] + 1 < items[k].candidates.length) { choice[k]++; ops[k] = mk(k); fixes[k].push(`blocked (${f.detail}) → next candidate`); continue; }
      if (f.suggest?.p && !ops[k]._suggested && !ops[k].in) { ops[k] = { ...ops[k], p: f.suggest.p, _suggested: true }; fixes[k].push(`blocked (${f.detail}) → the server's suggestion ${JSON.stringify(f.suggest.p)}`); continue; }
      if (ops[k].mode !== 'nudge') { ops[k] = { ...ops[k], mode: 'nudge' }; fixes[k].push(`blocked (${f.detail}) → nudge`); continue; }
    }
    if (f.code === 'name.taken' && op === 'place') { ops[k] = { ...ops[k], name: uniqueName(v, 'world', ops[k].name, new Set([...taken, `world/${ops[k].name}`])) }; continue; }
    break;
  }
  ops = ops.map(({ _suggested, ...o }) => o);
  if (!r.accepted) {
    const msg = `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
    if (flags.json) return { accepted: false, failures: r.failures, ops };
    return msg + (fixes.some((x) => x.length) ? `\n  tried: ${fixes.flat().join('; ')}` : '');
  }
  if (flags.dry || flags.plan) {
    const tells = flags.against ? [...notes, ...items.map((it, k) => it.candidates[choice[k]].note)] : notes;
    return flags.json ? { dry: true, ops, notes: tells } : [`dry run OK (nothing built): ${ops.length} op(s)`, ...ops.map((o) => '  ' + JSON.stringify(o)), ...tells.map((note) => `  note: ${note}`)].join('\n');
  }
  if (ctx) ctx.sent = true;
  const res = committed ?? await act({ ops, ...(flags.group ? { group: flags.group } : {}) }, flags.note);
  if (!res.accepted) return `REFUSED at commit: ${res.failures.map(explainFailure).join('; ')}`;
  if (flags.json) return { ...res, ops };
  const m2 = await mirror(); const v2 = view(m2);
  const lines = [];
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k]; const c = items[k].candidates[Math.min(choice[k], items[k].candidates.length - 1)];
    const placedIds = Object.keys(res.ids).filter((key) => res.ids[key] === key);
    const row = op === 'place' ? v2.byId.get(placedIds[k]) : v2.byId.get(rowId) ?? v2.get(id);
    const where = row ? (row.shape ? '' : ` at (${row.pose[0]}, ${row.pose[1]}, ${row.pose[2]}) ${yawWord(row.pose[3])}`) : '';
    lines.push(`${op === 'place' ? 'placed' : 'moved'} ${row?.path ?? o.name ?? id}${op === 'place' ? ` [${def}]` : ''}${where} — ${c?.note ?? ''}${fixes[k].length ? ` (${fixes[k].join('; ')})` : ''}${o.constraints?.length ? `; keeps: ${o.constraints.map((x) => x.kind + (x.ref ? ' ' + x.ref : '')).join(', ')}` : ''}`);
  }
  if (notes?.length) lines.push(...notes.map((n) => `  note: ${n}`));
  if (res.warnings?.length) lines.push(`  warnings: ${res.warnings.join('; ')}`);
  lines.push(`  seq ${res.seq}${load().group || flags.group ? `, group "${flags.group ?? load().group}"` : ''} — undo with: undo`);
  return lines.join('\n');
}
export const terrain = place;

/** move <ref> [relations] (or --by dx,dz, --yaw, --in parent[/slot]). Children ride along. A thing inside a house or
 *  on a table moves in the world frame like everything else; where it lands decides its parent (still on the
 *  table, the room the point is in, else the world root), and the answer says so. A set (a row's name) moves --by. */
export async function move(ref, flags = {}) {
  const m = await mirror(); const v = view(m);
  if (!ref) throw new Error('usage: move <ref> --at …|--near …|--by dx,dz|--yaw r|--facing …|--in parent[/slot]');
  const row = v.get(ref);
  if (!row) {
    const set = setOf(v, ref); if (!set) throw new Error(`no such thing: ${ref} (see: map)`);
    if (!flags.by && flags.yaw === undefined) throw new Error(`${ref} is a set of ${set.members.length} (${set.members.map((r) => r.name).join(', ')}): move it with --by dx,dz, or move one member by its own name`);
    const out = []; for (const r of set.members) out.push(await move(r.path, flags)); return out.join('\n');
  }
  const sub = new Set([row.id]); for (let grew = true; grew;) { grew = false; for (const r of v.rows) if (sub.has(r.parent) && !sub.has(r.id)) { sub.add(r.id); grew = true; } }
  const e = v.entity(row.id);
  // the op that puts a contained thing at a world point: same parent if it still fits there, else a new one
  const relocated = (wx, wz, wy, extra = []) => {
    const L = relocate(v, row, wx, wz, wy);
    const o = {}; let note = '';
    if (row.parent === 'world') { o.p = L.p; return { o, note }; }
    const parentPath = v.byId.get(row.parent)?.path;
    const changed = L.in && (L.in.parent !== parentPath || (L.in.slot ?? null) !== (row.slot ?? null));
    o.p = e.p?.length === 3 && !changed ? [L.p[0], e.p[1], L.p[1]] : L.p;
    if (changed) { o.in = L.in; o.r = L.r; note = L.note; }
    const kept = (e.constraints ?? []).filter((c) => c.kind !== 'inside' && !extra.some((x) => x.kind === c.kind));
    if (changed || extra.length) o.constraints = [...kept, ...extra.filter((c) => c.kind !== 'inside'), ...(L.room ? [{ kind: 'inside', ref: L.room }] : [])];
    return { o, note };
  };
  if (flags.by) {
    const [dx, dz] = dxdz(flags.by, '--by');
    const o = { op: 'move', id: row.path, mode: flags.nudge ? 'nudge' : 'strict' };
    let note = '';
    if (e.shape) o.shape = e.shape.area ? { area: e.shape.area.map(([x, z]) => [x + dx, z + dz]) } : { ...e.shape, path: e.shape.path.map(([x, z]) => [x + dx, z + dz]) };
    else { const R = relocated(row.pose[0] + dx, row.pose[2] + dz, row.pose[3]); Object.assign(o, R.o); note = R.note; }
    if (flags.yaw !== undefined) o.r = num(flags.yaw);
    const r = await act({ ops: [o] }, flags.note);
    if (!r.accepted) return `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
    const after = view(await mirror()).byId.get(row.id);
    return `moved ${row.path} by (${dx}, ${dz})${after && !after.shape ? ` to (${after.pose[0]}, ${after.pose[1]}, ${after.pose[2]})` : ''}${note ? ` — ${note}${after ? `; now ${after.path}` : ''}` : ''}`;
  }
  if (!hasRelation(flags) && flags.yaw === undefined && flags.facing === undefined && !flags.in) throw new Error('usage: move <ref> --at …|--near …|--by dx,dz|--yaw r|--facing …|--in parent[/slot]');
  if (flags.in && !hasRelation(flags)) {
    // --in world: out to the root where it stands; --in <host>[/slot] --local x,z: exactly there in the slot's frame
    if (flags.in === 'world' || flags.local) {
      const [parent, slot] = String(flags.in).split(/\/(?=[^/]+$)/); const host = flags.in === 'world' || v.get(flags.in) ? flags.in : parent;
      const o = { op: 'move', id: row.path, in: host === flags.in ? { parent: host } : { parent, ...(slot ? { slot } : {}) }, p: flags.local ? String(flags.local).split(',').map(Number) : [row.pose[0], row.pose[2]] };
      const r = await act({ ops: [o] }); if (!r.accepted) return `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
      const after = view(await mirror()).byId.get(row.id);
      return `moved ${row.path} into ${flags.in}${after ? ` — now ${after.path} at (${after.pose[0]}, ${after.pose[1]}, ${after.pose[2]})` : ''}`;
    }
    // otherwise the solver picks the spot: a room (--inside) or a slot to stand on (--on: a table top, a pier's end, a balcony)
    const T = slotTarget(v, flags.in); if (!T) throw new Error(`no such thing: ${flags.in}`);
    const rooms = (T.host.slots ?? []).some((x) => x.kind === 'room'), tops = (T.host.slots ?? []).some((x) => ['surface', 'shelf'].includes(x.kind));
    const intoRoom = T.slot ? T.slot.kind === 'room' : rooms && !tops;
    flags = { ...flags, in: undefined, [intoRoom ? 'inside' : 'on']: flags.in };
  }
  const info = { form: row.form, layer: row.layer, box: row.box };
  const rel = relFrom(flags);
  if (!hasRelation(flags)) rel.at = `${row.pose[0]},${row.pose[2]}`;
  const sol = solve(v, { def: row.def, ...info, s: row.pose[4] }, { ...rel, skip: [...sub] });
  // world-frame answers (near, at, along…) for a thing that lives inside something: into its parent's frame
  const items = sol.items.slice(0, 1).map((it) => ({ candidates: it.candidates.map((c) => {
    // into a slot: keep the thing's world heading unless the solver turned it
    if (c.in && c.r === undefined) { const h = v.get(c.in.parent); return h ? { ...c, r: r2(row.pose[3] - frameOf(h, c.in.slot).RY) } : c; }
    if (c.in || c.shape || row.parent === 'world') return c;
    const R = relocated(c.p[0], c.p[1], c.r ?? row.pose[3], c.constraints ?? []);
    return { ...c, ...R.o, ...(R.o.r === undefined && c.r !== undefined ? { r: r2(c.r - (frameOf(v.byId.get(row.parent), row.slot).RY)) } : {}), note: `${c.note}${R.note ? `; ${R.note}` : ''}` };
  }) }));
  return commitItems(v, row.def, info, { ...flags, name: undefined }, undefined, items, sol.notes, { op: 'move', id: row.path, rowId: row.id });
}
/** Meaning is an exact block replacement, independent of geometry and physical parenting. */
export async function about(ref, flags = {}) {
  if (flags.missing) {
    if (ref || flags.set !== undefined || flags.clear) throw Error('about --missing cannot be combined with a target or edits');
    const result = missingAbout(await mirror(), flags);
    return flags.json ? result : `${result.total} entities missing title or purpose${result.remaining ? ` (${result.remaining} more; use --limit)` : ''}\n${result.rows.map(r => `${r.path} [${r.kind}] missing ${r.missing.join(', ')}`).join('\n')}`;
  }
  if (!ref) throw Error('usage: about <ref|world> [--set JSON | --clear], or about --missing [--kind building|zone|water|landmark]');
  if (flags.kind !== undefined || flags.limit !== undefined) throw Error('--kind and --limit apply only to about --missing');
  if (flags.set !== undefined && flags.clear) throw Error('choose --set or --clear');
  const value = flags.clear ? null : flags.set !== undefined ? aboutValue(flags.set) : undefined;
  // Writes resolve on the server, which rejects ambiguous refs; reads also refuse ambiguity.
  if (value !== undefined) {
    const op = ref === 'world' ? { op: 'world', state: { about: value } } : { op: 'set', id: ref, about: value };
    const r = await act({ ops: [op] }, flags.note);
    return flags.json ? r : r.accepted ? `about ${ref}: ${value === null ? 'cleared' : 'replaced'}` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
  }
  const m = await mirror();
  const valueNow = ref === 'world' ? m.snapshot.state?.about : exactAboutTarget(m, ref).about;
  return flags.json ? { ref, about: valueNow ?? null } : `${ref}: ${valueNow ? JSON.stringify(valueNow, null, 2) : 'no about block'}`;
}
export async function set(id, flags) { const op = { op: 'set', id }; if (flags.about !== undefined) op.about = aboutValue(flags.about, { clear: true }); if (flags.state) op.state = JSON.parse(flags.state); if (flags.param) op.params = parseKV(flags.param); if (flags.name) op.name = flags.name; if (flags.constraints) op.constraints = JSON.parse(flags.constraints); const r = await act({ ops: [op] }, flags.note); return r.accepted ? `set ${id}: ${Object.keys(op).filter((k) => !['op', 'id'].includes(k)).map((k) => `${k} ${JSON.stringify(op[k])}`).join(', ')}` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`; }
/** The op that recolours one thing: its `paint` state, else its `color` param, else its main colour param (the first
 *  colour-typed param: a dog's fur, a lamp's iron) or the one named with --part. */
function recolorOp(d, id, color, part) {
  const colorParams = Object.entries(d?.params ?? {}).filter(([, f]) => f?.type === 'color').map(([k]) => k);
  if (part) { if (!colorParams.includes(part)) throw new Error(`${id} has no colour part ${part}; parts: ${colorParams.join(', ') || 'none'}`); return { op: 'set', id, params: { [part]: color } }; }
  if (d?.state?.paint) return { op: 'set', id, state: { paint: color } };
  const k = colorParams.includes('color') ? 'color' : colorParams[0];
  return k ? { op: 'set', id, params: { [k]: color } } : null;
}
export async function recolor(id, color, flags = {}) {
  if (!id || !color) throw new Error('usage: recolor <ref> <#hex> [--part fur]');
  const v = view(await mirror()), row = v.get(id);
  if (!row && setOf(v, id)) { const out = []; for (const r of setOf(v, id).members) out.push(await recolor(r.path, color, flags)); return out.join('\n'); }
  if (!row) throw new Error(`no such thing: ${id}`);
  const op = recolorOp(v.def(row.def), row.path, color, flags.part);
  if (!op) return `${id} has no colour to change (no paint state, no colour params)`;
  const r = await act({ ops: [op] });
  return r.accepted ? `recoloured ${id} ${color}${op.params ? ` (${Object.keys(op.params)[0]})` : ''}` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
}
export async function remove(ids) { const v0 = view(await mirror()); const list = [].concat(ids).filter(Boolean).flatMap((id) => (v0.get(id) ? [id] : setOf(v0, id)?.members.map((r) => r.path) ?? [id])); if (!list.length) throw new Error('usage: remove <ref> [<ref>…]'); const r = await act({ ops: list.map((id) => ({ op: 'remove', id })) }); return r.accepted ? `removed ${list.join(', ')} (and what was inside)` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`; }
export async function clone(id, flags) { const o = { op: 'clone', id, ...(flags.name ? { name: flags.name } : {}), ...(flags.count ? { count: num(flags.count) } : {}), ...(flags.step ? { step: String(flags.step).split(',').map(Number) } : {}), ...(flags.yaw !== undefined ? { r: num(flags.yaw) } : {}), mode: flags.nudge ? 'nudge' : 'strict' }; let from = '';
  if (flags.at) { const v = view(await mirror()); const p = refPoint(v, flags.at, flags.offset); o.p = [p.x, p.z]; }
  else if (o.count > 1 || o.step) {
    // without --at the server starts a row ON the original (always overlap.solid): start one step away instead
    const v = view(await mirror()), row = v.get(id), e = row ? v.entity(row.id) : null;
    if (e) {
      const step = o.step ?? [r2(Math.max(2, (row.box?.[0] ?? 1) * 1.5)), 0], b = e.p ?? [0, 0];
      o.step = step; o.p = b.length === 3 ? [r2(b[0] + step[0]), b[1], r2(b[2] + step[1])] : [r2(b[0] + step[0]), r2(b[1] + step[1])];
      from = `, starting one step (${step.join(',')}) from ${row.path}`;
    }
  }
  const r = await act({ ops: [o] }, flags.note); return r.accepted ? `cloned ${id}${o.count > 1 ? ` ×${o.count}` : ''}${from} (seq ${r.seq})` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`; }
/** The sky palettes the viewer draws (apps/web; the server refuses others once L7 patch S2 lands). */
export const SKY_PALETTES = PALETTE_LIST;
async function worldState() { return (await snapshot()).state ?? {}; }
const skyText = (st) => `sky ${st.sky?.palette ?? 'clear-day'}, sun ${st.sky?.sun ?? 0.6}; weather clouds ${st.weather?.clouds ?? 0}, wind ${st.weather?.wind ?? 0}, rain ${st.weather?.rain ?? 0}`;
/** sky [--palette p] [--sun 0…1]: no flags = show the sky and the palettes. Weather is kept. */
export async function sky(flags = {}) {
  const st = await worldState();
  if (flags.palette === undefined && flags.sun === undefined) return `${skyText(st)}\npalettes: ${SKY_PALETTES.map((p) => p.id).join(', ')}\n${SKY_PALETTES.map((p) => `  ${p.id}: ${p.doc}`).join('\n')}\nset with: sky --palette <name> [--sun 0…1]`;
  const palette = flags.palette ?? st.sky?.palette ?? 'clear-day';
  if (!SKY_PALETTES.some((p) => p.id === palette)) throw new Error(`unknown sky palette "${palette}"; palettes: ${SKY_PALETTES.map((p) => p.id).join(', ')}`);
  const sun = flags.sun !== undefined ? num(flags.sun) : st.sky?.sun ?? 0.6;
  if (!(sun >= 0 && sun <= 1)) throw new Error('--sun is 0…1 (0 = night, 1 = noon)');
  // WEATHER-RULES: the sky alone (the world op merges per key; re-sending the weather would restart an ended shower)
  const r = await act({ ops: [{ op: 'world', state: { sky: { ...(st.sky ?? {}), palette, sun } } }] });
  return r.accepted ? `${skyText({ ...st, sky: { palette, sun } })} (seq ${r.seq})` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
}
export async function constitution(text) { return act({ ops: [{ op: 'world', state: { constitution: text } }] }); }
export async function expand(extent) { return act({ ops: [{ op: 'expand', extent: num(extent) }] }); }

// ---------------------------------------------------------------- groups, undo, history
// Wire assumptions for construction live here (DESIGN-CONSTRUCTION §2). The
// batch field/echo are handled centrally in state.mjs, including direct acts.
export const BUILD_API = {
  path: (id, action) => `/v1/god/builds${id ? '/' + encodeURIComponent(id) : ''}${action ? '/' + action : ''}`,
  unknown: (r) => r.status === 404 || r.data?.failures?.some((f) => f.code === 'build.unknown'),
  resumable: (b) => b.status === 'paused' || (b.status === 'active' && b.lead?.live === false),
  local: (r) => {
    const b = r.build, step = r.current ?? b.current ?? b.step;
    return { id: b.id, lease: r.lease, n: step?.n || 1, label: step?.label || b.plan.steps[0], steps: b.plan.steps, status: b.status };
  },
  claim: (b, c) => ({ id: b.id, claim: c.id, part: c.part, n: c.step?.n || 1, label: c.step?.label || b.plan.steps[0], steps: b.plan.steps, status: b.status }),
  stepBody: (b, n, label, say, masses) => ({ ...(b.claim ? { claim: b.claim } : { lease: b.lease }), n, label, say, ...(masses ? { masses } : {}) }),
  stepEcho: (b, local) => local.claim ? b.claims.find(c => c.id === local.claim)?.step : b.step,
  say: (b) => typeof b.say === 'string' ? b.say : b.say?.text,
};
const buildPair = (s, what) => {
  if (typeof s !== 'string' || s.split(',').some((v) => !v.trim())) throw new Error(`${what} needs two numbers`);
  return dxdz(s, what);
};
export function parseMassing(text) {
  if (text === undefined) return [];
  if (typeof text !== 'string' || !text.trim()) throw new Error('--mass needs volumes: nave 0,0 22x10 h12 gable');
  const masses = text.split(';').map((s) => {
    const fields = s.trim().split(/\s+/), name = fields[0]?.includes(',') ? undefined : fields.shift();
    if (name && !/^[a-z0-9][a-z0-9-]{0,18}$/.test(name)) throw new Error('mass names must be slugs of at most 19 characters');
    const [at, size, height, roof, ...extra] = fields;
    if (!size || !/^h.+/.test(height ?? '') || extra.length || (roof && !['flat', 'gable', 'pyramid'].includes(roof))) throw new Error('mass: use name x,z wxd h12 [flat|gable|pyramid]');
    const box = buildPair(size.replace(/[x×]/, ','), 'mass size'), h = num(height.slice(1));
    if (box.some((v) => v <= 0) || h < 0.5 || h > 120) throw new Error('mass size must be positive; wall/eave height h is 0.5..120 m');
    return { ...(name ? { name } : {}), at: buildPair(at, 'mass at'), size: box, h, ...(roof ? { roof } : {}) };
  });
  if (masses.length > 8) throw new Error('at most 8 massing volumes');
  return masses;
}
async function buildSite(f) {
  if (f.at === undefined || f.size === undefined) throw new Error('build needs --at <ref|x,z> --size w,d');
  const size = buildPair(f.size, '--size');
  if (size.some((n) => n < 1 || n > 200)) throw new Error('site size is 1..200 m on each side');
  if (f.offset !== undefined) buildPair(f.offset, '--offset');
  // Numeric sites need no mirror reads: start is exactly one HTTP request.
  const numeric = typeof f.at === 'string' && f.at.includes(',');
  const [x, z] = numeric ? buildPair(f.at, '--at') : [];
  const [dx, dz] = f.offset ? buildPair(f.offset, '--offset') : [0, 0];
  const p = numeric ? { x: x + dx, z: z + dz } : refPoint(view(await mirror()), f.at, f.offset);
  return { at: [p.x, p.z], size, yaw: f.yaw === undefined ? 0 : num(f.yaw) };
}
const buildOutline = (b) => [`${b.id}: ${b.title} (${b.status}); site ${fmtP(b.site.at)} ${b.site.size.join('×')} m, yaw ${b.site.yaw ?? 0}`, `steps: ${b.plan.steps.map((s, i) => `${i + 1} ${s}`).join('; ')}`];
const buildListLine = (b) => `${b.id}: ${b.title} (${b.status}); step ${b.step?.n ?? 1}/${b.plan?.steps.length ?? '?'} ${b.step?.label ?? ''}${b.district ? ` [district ${b.district.id}: ${b.district.plots.join(',')}]` : ''}`;
async function buildChoices(sub, reason, f, list) {
  const r = list ?? ok(await call(BUILD_API.path()), 'build list');
  const message = [reason, ...(r.open.length ? ['open builds:', ...r.open.map(buildListLine), `choose an id: build ${sub} <id>${sub === 'resume' ? ' [--take]' : ''}`] : ['no open builds; build start <id> to start one'])].join('\n');
  return f.json ? { ...r, ok: false, message } : message;
}
function buildStartReport(b, suggestions = [], report) {
  const masses = b.massing.map((m, i) => {
    const roof = m.roof ?? 'flat', total = m.h + (roof === 'flat' ? 0 : Math.min(...m.size) / 2);
    return `${m.name ?? i + 1} ${m.size.map(r2).join('×')} m, walls ${r2(m.h)} m + ${roof} roof ≈ ${r2(total)} m total`;
  });
  return [...buildWords(b), ...buildOutline(b), ...(report ? [siteReportText(report)] : []), `massing: ${masses.join('; ') || 'none'}`, ...(suggestions.length ? ['parts from earlier builds you can reuse:', ...suggestions.slice(0, 8).map(partLine)] : []), `every edit now carries build ${b.id}, step 1/${b.plan.steps.length} ${b.plan.steps[0]}`].join('\n');
}
const buildWords = b => [...(b.chapters ?? []).flatMap(c => [`chapter ${c.id}:`, ...(c.brief !== undefined ? [`brief: ${c.brief}`] : []), ...(c.asks ?? []).map(a => `ask: ${a}`)]), ...(b.plan.brief !== undefined ? [`brief: ${b.plan.brief}`] : []), ...(b.plan.asks ?? []).map(a => `ask: ${a}`)];
// Y3 districts: plan-wide view (full for `build district`, compact beside one chapter) and the chapter's site-report section.
const districtNext = v => !v.next ? 'next: every plot is built' : v.next.action === 'resume' ? `next: build resume ${v.next.id} (plots ${v.next.plots.join(',')})` : `next: build start ${v.next.id} --district ${v.id} --plots ${v.next.plots.join(',')} --brief "<the owner's words for this chapter>"`;
const plotLine = (p, chapter) => `plot ${p.id}${p.title ? ` ${p.title}` : ''}${p.use ? ` [${p.use}]` : ''} ${p.size.join('×')} m at ${fmtP(p.at)}: ${p.status}${p.chapter ? ` (${p.chapter}${p.parts !== undefined ? `, ${p.parts} parts` : ''})` : ''}${chapter && p.chapter === chapter ? ' <- this chapter' : ''}`;
export function districtLines(v, chapter) {
  const mine = chapter ? v.chapters.find(c => c.id === chapter) : undefined;
  return [`district ${v.id}: ${v.title}; ${v.counts.built}/${v.counts.plots} plots built, ${v.counts.building} building, ${v.counts.planned} planned`, ...(v.brief !== undefined ? [`district brief: ${v.brief}`] : []), ...(v.terrain ? [`terrain: ${v.terrain}`] : []), ...(v.water ? [`water: ${v.water}`] : []),
    ...(chapter ? v.plots.filter(p => mine?.plots.includes(p.id)).map(p => plotLine(p, chapter)) : [...(v.roads.length ? [`roads: ${v.roads.map(r => `${r.id}${r.name ? ` (${r.name})` : ''} ${r.width} m wide, ${r.path.map(fmtP).join(' -> ')}`).join('; ')}`] : []), ...v.plots.map(p => plotLine(p)),
      ...v.chapters.map(c => `chapter ${c.id} [${c.plots.join(',')}]: ${c.status}, step ${c.step.n}/${c.step.of} ${c.step.label}, ${c.parts} parts${c.closed ? ', closed to residents' : ''}${c.followUpOf ? `, follow-up of ${c.followUpOf}` : ''}${c.brief !== undefined ? `; brief: ${c.brief}` : ''}`)]),
    ...(!chapter || !mine || ['done', 'abandoned'].includes(mine.status) ? [districtNext(v)] : [])];
}
const districtReportText = d => [`district ${d.id}: chapter ${d.chapter} builds ${d.plots.map(p => `${p.id}${p.title ? ` ${p.title}` : ''}${p.use ? ` [${p.use}]` : ''}`).join(', ')}; ${d.counts.built}/${d.counts.plots} plots built, ${d.counts.building} building`, ...d.frontage.map(f => `frontage ${f.plot}: road ${f.road} to the ${f.side}, ${f.gap} m from the plot edge (front yaw ${f.frontYaw})`), ...(d.warnings ?? []).map(w => `WARNING: ${w}`), ...(d.neighbours.length ? [`neighbour plots: ${d.neighbours.map(n => `${n.plot} ${n.status}${n.chapter ? ` (${n.chapter})` : ''}`).join(', ')} — finished plots stay open to residents; edit only this chapter's plots`] : []), ...(d.terrain ? [`terrain: ${d.terrain}`] : []), ...(d.water ? [`water: ${d.water}`] : [])];
const siteReportText = r => [...(r.district ? districtReportText(r.district) : []), `site report: ground ${r.ground.min}..${r.ground.max} m${r.ground.sampled ? ' (sampled)' : ''}; neighbour eaves median ${r.eaves.median ?? 'n/a'}, max ${r.eaves.max ?? 'n/a'} m`, ...r.neighbours.map(n => `near ${n.path}: ${n.footprint.map(f => f.size.join('×')).join(', ')} m; eave ${n.eave} m (${n.eaveSource})`), ...r.masses.map(m => `${m.name}: ${m.fits ? 'fits' : 'outside site'}; height/neighbours median ${m.medianRatio ?? 'n/a'}, max ${m.maxRatio ?? 'n/a'}`), `closure: ${Object.entries(r.closure.counts ?? {}).map(([k,v]) => `${v} ${k}`).join(', ')}; ${(r.closure.things ?? []).map(x => x.path).join(', ')}`, ...(r.approach ? [`approach: ${r.approach.from ?? r.approach.note}${r.approach.checked ? '' : ' (not checked)'}`] : []), ...(r.library ?? []).map(x => `library: ${x.ref} (${x.category})`), ...(r.truncated ? ['site report shortened; inspect closure inventory for all returned rows'] : [])].join('\n');
const checkedReceipt = r => r ? [`checked receipt at seq ${r.seq}: ${r.exists.count} parts exist; ${r.undoability.ok ? 'undo preflight OK' : 'undo CONFLICT'} (${r.undoability.edits} edits)`, `exists: ${r.exists.paths.join(', ') || 'none'}`, ...r.preservation.outside.map(x => `changed outside: ${x.path}${x.included ? ' (included)' : ''}`), ...r.undoability.conflicts.map(explainFailure), ...r.massing.map(m => `mass ${m.name}: ${m.parts} parts; ${m.height}/${m.plannedHeight} m; ${m.fits ? 'fits' : 'warning'}`), ...r.uses.map(u => `uses ${u.path}: ${JSON.stringify(u.walk ?? u.behaviours ?? u.error ?? 'no compiled uses')}`), `viewer cost: ${JSON.stringify(r.viewerCost)}`, `refused: ${r.refused.count}; ${r.refused.recent.map(x => `${x.code}${x.entity ? ' on ' + x.entity : ''}: ${x.detail}`).join('; ')}`, ...r.warnings.map(w => `WARNING: ${w}`)].join('\n') : '';
const buildValues = (value, separator, flag, max, size) => { if (value === undefined) return undefined; if (typeof value !== 'string') throw new Error(`--${flag} needs text`); const values = value.split(separator).map(x => x.trim()); if (values.length > max || values.some(x => !x || x.length > size)) throw new Error(`--${flag} needs 1..${max} values, each at most ${size} characters`); return values; };
/** Y5: "removes 18 parts (…)", what else moves back, and which edits and steps go. */
const rewindReport = (id, r, dry) => {
  const w = r.rewind, names = x => `${x.names.join(', ')}${x.more ? ` +${x.more} more` : ''}`, verb = (now, would) => dry ? would : now;
  const steps = [...new Set(w.steps.map(s => `${s.n} ${s.label}${s.part ? ` (${s.part})` : ''}`))];
  return [`${id}: ${dry ? `rewind to step ${w.to} — dry run, nothing changed` : r.replayed ? `already at step ${w.to}; nothing to rewind` : `rewound to step ${w.to}; now at step ${r.build.step.n}/${r.build.plan.steps.length} ${r.build.step.label}, still open, closure re-armed`}`,
    [`${verb('removes', 'would remove')} ${w.removes.count} part${w.removes.count === 1 ? '' : 's'}${w.removes.count ? ` (${names(w.removes)})` : ''}`, ...(w.restores.count ? [`${verb('restores', 'would restore')} ${w.restores.count} (${names(w.restores)})`] : []), ...(w.changes.count ? [`${verb('reverts', 'would revert')} ${w.changes.count} change${w.changes.count === 1 ? '' : 's'} (${names(w.changes)})`] : []), ...(w.world?.length ? [`world: ${w.world.join(', ')}`] : [])].join('; '),
    `${w.edits.length} edit${w.edits.length === 1 ? '' : 's'} ${verb('undone', 'to undo')}${w.edits.length ? ` (${[...w.edits].sort((a, b) => a - b).join(', ')})` : ''}${steps.length ? `; steps: ${steps.join(', ')}` : ''}`,
    ...(r.warnings ?? []).map(x => `WARNING: ${x}`), ...(dry ? [`apply: build rewind ${id} --to ${w.to}${w.to ? '' : ' (the start)'}`] : [])].join('\n');
};
const reuseReport = (r) => r ? `reuse: ${r.newDefs} new defs, ${r.placedFromParts} placed from parts; kept as parts: ${r.kept.join(', ') || 'none'}${r.recorded === false ? `; not fully recorded${r.code ? ' (' + r.code + ')' : ''}` : ''}` : '';
// RL7: a refusal the server saw 3+ times in 2 min (same code + field), from build show and trace.
export const loopLine = (l) => `LOOP ×${l.count} in ${Math.max(1, Math.round((l.lastAt - l.firstAt) / 1000))} s: ${l.code}${l.field ? ` (field ${l.field})` : ''} via ${l.routes.join(', ')}${l.builds?.length ? ` [build ${l.builds.join(', ')}]` : ''} — the same refusal keeps coming back; change the request${HINTS[l.code] ? ` (${HINTS[l.code]})` : ''} instead of resending it`;
function buildReport(r) {
  if (r.open) return [...(r.loops ?? []).map(loopLine), ...r.open.flatMap(b => [...buildWords(b), buildListLine(b)]), ...r.recent.map((b) => `${b.id}: ${b.status}`), buildHeader()].filter(Boolean).join('\n') || 'no builds';
  const b = r.build, steps = b.plan.steps, current = r.current ?? b.current, open = ['active', 'paused'].includes(b.status);
  const lines = [...(r.district ? districtLines(r.district, b.id) : []), ...buildWords(b), ...buildOutline(b)];
  if (current) {
    lines.push(`step ${current.n}/${steps.length} ${current.label}${open ? ' IN PROGRESS' : ''}: ${current.batches} batches, last seq ${current.lastSeq ?? 'none'}${open ? ' — finish it first' : ''}`);
    for (const e of current.recent ?? []) lines.push(`  seq ${e.seq}: ${e.note ?? ''}`);
  } else lines.push(`step ${b.step?.n ?? 1}/${steps.length} ${b.step?.label ?? steps[0]}: no committed batches reported${open ? '; inspect and finish it first' : ''}`);
  lines.push(`roots: ${b.roots.map((x) => x.path ?? x.id ?? x).join(', ') || 'none yet'}`);
  lines.push(`massing: ${(r.massing ?? b.massing).map((m, i) => `${m.name ?? i + 1} ${m.parts ?? 0} parts`).join(', ') || 'none'}`);
  lines.push(`claims: ${b.claims.map((c) => `${c.id} ${c.part} (${c.status}${c.holder?.label ? ', ' + c.holder.label : ''})`).join('; ') || 'none'}`);
  const next = r.next ?? b.next;
  if (next && open) lines.push(`next: ${next.n}/${steps.length} ${next.label}`);
  const root = b.roots[0]; if (root) lines.push(`first: describe ${root.path ?? root.id ?? root}`);
  if (load().build?.id === b.id) lines.push(`local: ${buildHeader()}`);
  const reuse = reuseReport(r.reuse ?? b.reuse); if (reuse) lines.push(reuse);
  const receipt = checkedReceipt(r.receipt ?? b.done?.receipt); if (receipt) lines.push(receipt);
  for (const l of r.loops ?? []) lines.push(loopLine(l));
  return lines.join('\n');
}
const ago = (now, at) => { const s = Math.max(0, Math.round((now - at) / 1000)); return s < 120 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; };
/** trace [--build id] [--limit n]: this world's recent god requests — route, outcome code, field, ms; never payloads. */
export async function trace(flags = {}) {
  const q = new URLSearchParams();
  if (flags.build !== undefined) { if (typeof flags.build !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(flags.build)) throw new Error('trace --build takes a build id'); q.set('build', flags.build); }
  if (flags.limit !== undefined) { const n = Number(flags.limit); if (!Number.isInteger(n) || n < 1 || n > 1024) throw new Error('trace --limit takes 1..1024'); q.set('limit', String(n)); }
  const r = ok(await call(`/v1/god/trace${q.size ? `?${q}` : ''}`), 'trace');
  if (flags.json) return r;
  const s = r.stats;
  if (!r.enabled) return 'trace: off on this server (GOD_TRACE=0)';
  return [`trace: ${s.kept} of ${s.traced} god requests kept (newest first, max ${s.rowsMax}); ${s.refused} refused, ${s.repeated} of them repeats inside a loop`, ...r.loops.map(loopLine),
    ...r.rows.map(x => `  ${ago(r.now, x.at)} ${x.method} ${x.route} → ${x.code}${x.field ? ` (${x.field})` : ''} ${x.ms} ms${x.build ? ` [${x.build}${x.step !== undefined ? ` ${x.step}` : ''}]` : ''} ${x.tok ?? '-'}${x.tok === r.you ? ' (you)' : ''}`)].join('\n');
}
const waitTimeout = (value = '15m') => {
  const m = typeof value === 'string' && /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  const ms = m && Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2]];
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error('build wait --timeout needs a positive duration, e.g. 15m or 30s');
  return ms;
};
/** Read only; injected time/sleep let stub-server tests exercise the full backoff without waiting minutes. */
export async function buildWait(id, flags = {}, runtime = {}) {
  const timeout = waitTimeout(flags.timeout), now = runtime.now ?? Date.now, wait = runtime.sleep ?? sleep;
  const print = runtime.print ?? (line => console.error(line)), start = now(), deadline = start + timeout;
  let previous, last, delay = 2000;
  const summary = (b) => b ? `${b.status}; claims: ${b.claims.map(c => `${c.part} ${c.status}${c.step ? ` ${c.step.n} ${c.step.label}` : ''}`).join('; ') || 'none'}` : 'claim state not received';
  const finish = (reason) => {
    const result = { ok: reason !== 'timeout', reason, build: last, waitedMs: now() - start };
    return flags.json ? result : `${id}: ${reason === 'timeout' ? 'timed out' : reason === 'abandoned' ? 'claim abandoned' : reason === 'closed' ? 'build ended' : 'all claims released'}; ${summary(last)}`;
  };
  for (;;) {
    const response = await call(BUILD_API.path(id), { timeoutMs: Math.max(1, Math.min(180_000, deadline - now())) });
    if (response.status === 0 && response.data?.code === 'slow') return finish('timeout');
    const r = ok(response, 'build wait');
    if (r.ok === false) return flags.json ? r : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
    last = r.build;
    const line = summary(last), changed = line !== previous;
    if (changed && !flags.json) print(`${id}: ${line}`);
    previous = line;
    if (['done', 'abandoned'].includes(last.status)) return finish('closed');
    if (last.claims.some(c => c.status === 'abandoned')) return finish('abandoned');
    if (last.claims.every(c => ['released', 'done', 'taken'].includes(c.status))) return finish('released');
    const remaining = deadline - now();
    if (remaining <= 0) return finish('timeout');
    if (changed) delay = 2000;
    await wait(Math.min(delay, remaining));
    if (now() >= deadline) return finish('timeout');
    delay = Math.min(15_000, delay * 1.5);
  }
}
export async function build(sub = 'show', args = [], f = {}, inheritedMassing) {
  const s = load(), b = s.build, arg = args[0];
  const options = { start: 'title steps at offset size yaw mass brief root asks include district plots', district: 'file delete', continue: 'brief asks include title steps', check: '', step: 'say mass asks include', show: '', wait: 'timeout', resume: 'take', claim: 'root at offset size yaw take helper ttl', release: 'done', pause: '', done: 'force', abandon: 'undo force', rewind: 'to dry force' };
  if (!Object.hasOwn(options, sub)) throw new Error('build: start|district|continue|step|check|show|wait|resume|claim|release|pause|done|abandon|rewind');
  if (args.length > (['release', 'abandon', 'wait'].includes(sub) ? 0 : 1)) throw new Error(`build ${sub}: too many arguments`);
  for (const [k, v] of Object.entries(f)) {
    if (!['json', 'no-build', ...options[sub].split(' ')].includes(k)) throw new Error(`build ${sub} has no option --${k}`);
    if (Array.isArray(v)) throw new Error(`build ${sub} --${k} takes one value`);
  }
  if (sub === 'resume' && f.take !== undefined && f.take !== true) throw new Error('build resume --take takes no value');
  if ((activeClaim() || b?.claim) && (['start', 'continue', 'resume', 'claim', 'done', 'abandon', 'rewind'].includes(sub) || (sub === 'district' && (f.file !== undefined || f.delete !== undefined)))) throw new Error(`claim holders cannot build ${sub}${sub === 'resume' ? ': it would take the lead lease' : '; edit your claim, then build release --done'}`);
  if (sub === 'step') {
    if (!b) throw new Error('no current build; build start or build resume first');
    const n = !arg && f.say === undefined && (f.include !== undefined || f.asks !== undefined) ? b.n : b.n + 1;
    if (n > 999) throw new Error('build step cannot exceed 999');
    const label = arg ?? b.steps[n - 1] ?? `step ${n}`;
    if (typeof label !== 'string' || !label.trim() || label.length > 60) throw new Error('step label is 1..60 characters');
    if (f.mass !== undefined && f.say === undefined) throw new Error('build step --mass needs --say');
    if (f.say !== undefined || f.include !== undefined || f.asks !== undefined) {
      if (f.say !== undefined && typeof f.say !== 'string') throw new Error('--say needs 1..140 characters');
      const say = f.say?.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
      if (say !== undefined && (!say.trim() || say.length > 140)) throw new Error('--say needs 1..140 characters');
      const masses = f.mass === undefined ? undefined : typeof f.mass === 'string' ? f.mass.split(',').map(x => x.trim()) : [];
      if (masses && (!masses.length || masses.length > 8 || masses.some(x => !/^[a-z0-9][a-z0-9-]{0,18}$/.test(x)))) throw new Error('--mass needs at most 8 mass names, e.g. nave,tower');
      if (!b.claim && !b.lease) throw new Error('no build lease; build resume first');
      const r = ok(await call(BUILD_API.path(b.id, 'step'), { body: { ...BUILD_API.stepBody(b, n, label, say, masses), ...(f.include !== undefined ? { include: buildValues(f.include, ',', 'include', 512, 300) } : {}), ...(f.asks !== undefined ? { asks: buildValues(f.asks, ';', 'asks', 64, 500) } : {}) } }), 'build step');
      if (!r.ok) return f.json ? r : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
      const step = BUILD_API.stepEcho(r.build, b);
      if (!step) throw new Error('build step response is missing the server step; build show before continuing');
      save({ build: { ...b, n: step.n, label: step.label, status: r.build.status } });
      invalidate();
      return f.json ? r : `step ${step.n}/${b.steps.length}: ${step.label}${BUILD_API.say(r.build) ? ` — designing: ${BUILD_API.say(r.build)}` : ''}`;
    }
    save({ build: { ...b, n, label } });
    return `step ${n}/${b.steps.length}: ${label} (rides on your next edit)`;
  }
  if (sub === 'wait') {
    if (!b) throw new Error('no current build; build resume <id> first');
    return buildWait(b.id, f);
  }
  if (sub === 'show') {
    const response = await call(BUILD_API.path(arg));
    if (arg && BUILD_API.unknown(response)) return buildChoices(sub, `unknown build: ${arg}`, f);
    const r = ok(response, 'build show');
    if (r.ok === false) return `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
    return f.json ? r : buildReport(r);
  }
  if (sub === 'check') {
    const id = arg ?? b?.id; if (!id) throw new Error('build check needs an id or current build');
    const r = ok(await call(BUILD_API.path(id, 'check'), { body: {} }), 'build check');
    if (r.ok === false) return f.json ? r : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
    return f.json ? r : checkedReceipt(r.receipt);
  }
  if (sub === 'district') {
    // Y3: record a plan once (--file plan.json or inline JSON), delete one (--delete), show one district, or list them.
    if (arg !== undefined && !/^[a-z0-9][a-z0-9-]{0,29}$/.test(arg)) throw new Error('build district needs a district id (slug, at most 30 characters)');
    const unknown = () => f.json ? { ok: false, code: 'district.unknown' } : `unknown district: ${arg}; \`build district\` lists them`;
    if (f.delete !== undefined) {
      if (!arg) throw new Error('build district <id> --delete');
      if (f.delete !== true) throw new Error('--delete takes no value');
      if (f.file !== undefined) throw new Error('--delete and --file are separate commands');
      const response = await call(`/v1/god/districts/${encodeURIComponent(arg)}`, { method: 'DELETE' });
      if (response.status === 404) return unknown();
      const r = ok(response, 'build district --delete');
      if (!r.ok) return f.json ? r : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
      return f.json ? r : `district ${arg} deleted: its buildings and ${r.chapters.length} chapter build(s) stay; undo --group <chapter> still works`;
    }
    if (f.file !== undefined) {
      if (!arg) throw new Error('build district <id> --file plan.json');
      if (typeof f.file !== 'string') throw new Error('--file needs a plan file or inline JSON');
      let plan; try { plan = JSON.parse(f.file.trim().startsWith('{') ? f.file : readFileSync(f.file, 'utf8')); } catch (e) { throw new Error(`--file: cannot read the plan (${e.message})`); }
      if (plan.id !== undefined && plan.id !== arg) throw new Error(`the plan's id ${plan.id} differs from ${arg}`);
      const r = ok(await call('/v1/god/districts', { body: { ...plan, id: arg } }), 'build district');
      if (!r.ok) return f.json ? r : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
      return f.json ? r : [...(r.replayed ? [`district ${arg}: already recorded with this plan`] : []), ...districtLines(r.district), ...r.warnings.map(w => `WARNING: ${w}`)].join('\n');
    }
    if (!arg) { const r = ok(await call('/v1/god/districts'), 'build district'); return f.json ? r : r.districts.map(x => `${x.id}: ${x.title}; ${x.counts.built}/${x.counts.plots} built; ${districtNext(x)}`).join('\n') || 'no districts; build district <id> --file plan.json records one'; }
    const response = await call(`/v1/god/districts/${encodeURIComponent(arg)}`);
    if (response.status === 404) return unknown();
    const r = ok(response, 'build district'); return f.json ? r : districtLines(r.district).join('\n');
  }
  if (sub === 'rewind') {
    const id = arg ?? b?.id; if (!id) throw new Error('build rewind needs an id or a current build');
    if (typeof f.to !== 'string' || !/^\d{1,3}$/.test(f.to)) throw new Error('build rewind needs --to <step>: 0 (the start) up to the current step');
    const response = await call(BUILD_API.path(id, 'rewind'), { body: { to: Number(f.to), ...(f.dry ? { dry: true } : {}), ...(f.force ? { force: true } : {}) } });
    if (BUILD_API.unknown(response)) return buildChoices(sub, `unknown build: ${id}`, f);
    const r = ok(response, 'build rewind');
    if (r.ok === false) return f.json ? r : `REFUSED: ${r.failures.map(explainFailure).join('; ')}${r.edits?.length ? `; nothing was undone (${r.edits.length} edit(s) checked)` : ''}`;
    if (!f.dry) { if (b?.id === id) save({ build: { ...b, n: r.build.step.n, label: r.build.step.label, status: r.build.status }, buildPreviews: undefined }); invalidate(); }
    return f.json ? r : rewindReport(id, r, !!f.dry);
  }
  if (sub === 'continue') {
    if (!arg) throw new Error('build continue needs a previous build id');
    if (f.brief === undefined) throw new Error('build continue needs --brief with the follow-up words');
    const response = await call(BUILD_API.path(arg)); if (BUILD_API.unknown(response)) return buildChoices(sub, `unknown build: ${arg}`, f);
    let previous = ok(response, 'build continue').build;
    if (!['done', 'abandoned'].includes(previous.status)) throw new Error('finish the previous chapter before continuing it');
    const base = previous.chapters?.[0]?.id ?? previous.chapterOf ?? previous.id;
    let chapter = 2, id;
    for (;;) {
      id = `${base}-${chapter++}`; if (id.length > 40) throw new Error('chapter id exceeds 40 characters; use build start with a shorter id and --root');
      const found = await call(BUILD_API.path(id)); if (BUILD_API.unknown(found)) break; const chapterBuild = ok(found, 'find chapter').build; if (!['done', 'abandoned'].includes(chapterBuild.status)) throw new Error(`chapter ${id} is still open; build resume ${id}`); previous = chapterBuild;
    }
    const mass = previous.massing.map((m, i) => `${m.name ?? 'mass-' + i} ${m.at.join(',')} ${m.size.join('x')} h${m.h} ${m.roof ?? 'flat'}`).join('; ');
    return build('start', [id], { ...f, root: previous.id, title: f.title ?? previous.title, steps: f.steps ?? previous.plan.steps.join(','), at: previous.site.at.join(','), size: previous.site.size.join(','), yaw: previous.site.yaw ?? 0, ...(mass ? { mass } : {}) }, previous.massing.map(({ parts: _p, ...m }) => m));
  }
  let id, action, body;
  if (sub === 'start' && f.district !== undefined) {
    // Y3: a district chapter; the server fills site, massing, title and steps from the plan's plots.
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(arg ?? '')) throw new Error('build start needs an id (slug, at most 40 characters)');
    if (typeof f.district !== 'string' || !/^[a-z0-9][a-z0-9-]{0,29}$/.test(f.district)) throw new Error('--district needs a district id');
    for (const k of ['at', 'offset', 'size', 'yaw', 'mass', 'root']) if (f[k] !== undefined) throw new Error(`--${k} does not apply to a district chapter: the plan holds each plot's rectangle and massing`);
    const plots = buildValues(f.plots, ',', 'plots', 8, 8), steps = f.steps === undefined ? undefined : buildValues(f.steps, ',', 'steps', 24, 60);
    if (f.title !== undefined && (typeof f.title !== 'string' || !f.title.trim() || f.title.length > 80)) throw new Error('--title is 1..80 characters');
    const brief = f.brief === undefined ? undefined : existsSync(f.brief) ? readFileSync(f.brief, 'utf8') : f.brief;
    if (brief !== undefined && (typeof brief !== 'string' || brief.length > 4000)) throw new Error('--brief is at most 4000 characters');
    const asks = buildValues(f.asks, ';', 'asks', 64, 500), include = buildValues(f.include, ',', 'include', 512, 300);
    body = { id: arg, district: { id: f.district, ...(plots ? { plots } : {}) }, ...(f.title ? { title: f.title } : {}), ...(steps ? { steps } : {}), ...(asks ? { asks } : {}), ...(include ? { include } : {}), ...(brief !== undefined ? { brief } : {}) };
  } else if (sub === 'start') {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(arg ?? '')) throw new Error('build start needs an id (slug, at most 40 characters)');
    if (typeof f.title !== 'string' || !f.title.trim() || f.title.length > 80) throw new Error('build start needs --title (1..80 characters)');
    if (typeof f.steps !== 'string') throw new Error('build start needs --steps shell,roof,interior');
    const steps = f.steps.split(',').map((x) => x.trim());
    if (steps.length > 24 || steps.some((x) => !x || x.length > 60)) throw new Error('--steps needs 1..24 labels, each 1..60 characters');
    const massing = inheritedMassing ?? parseMassing(f.mass), site = await buildSite(f);
    const brief = f.brief === undefined ? undefined : existsSync(f.brief) ? readFileSync(f.brief, 'utf8') : f.brief;
    if (brief !== undefined && (typeof brief !== 'string' || brief.length > 4000)) throw new Error('--brief is at most 4000 characters');
    const asks = buildValues(f.asks, ';', 'asks', 64, 500), include = buildValues(f.include, ',', 'include', 512, 300);
    body = { id: arg, title: f.title, steps, site, massing, ...(asks ? { asks } : {}), ...(include ? { include } : {}), ...(brief !== undefined ? { brief } : {}), ...(f.root ? { root: f.root } : {}) };
  } else if (sub === 'resume') {
    id = arg;
    if (!id) {
      const list = ok(await call(BUILD_API.path()), 'build list');
      if (list.open.length !== 1 || !BUILD_API.resumable(list.open[0])) return buildChoices(sub, list.open.length > 1 ? 'several open builds; specify one to resume' : list.open.length ? 'the only open build has a live or unknown lead; specify its id to resume' : 'no build to resume', f, list);
      id = list.open[0].id;
    }
    action = 'resume'; body = { ...(b?.id === id && b.lease ? { lease: b.lease } : {}), ...(f.take ? { take: true } : {}) };
  } else {
    id = b?.id;
    if (!id) throw new Error('no current build; build resume <id> first');
    if (sub === 'claim') {
      if (!/^[a-z0-9][a-z0-9-]{0,18}$/.test(arg ?? '')) throw new Error('build claim needs a part slug (at most 19 characters)');
      if (f.take !== undefined && (typeof f.take !== 'string' || !/^c_[0-9a-f]{8}$/.test(f.take))) throw new Error('build claim --take needs a claim id');
      const region = f.at !== undefined || f.size !== undefined ? await buildSite(f) : undefined;
      if (!f.root && !region) throw new Error('build claim needs --root <path> or --at <ref> --size w,d');
      if (f.helper !== undefined && f.helper !== true) throw new Error('build claim --helper takes no value');
      if (f.ttl !== undefined && (!f.helper || !/^\d+(\.\d+)?$/.test(String(f.ttl)) || Number(f.ttl) < 1 || Number(f.ttl) > 720)) throw new Error('build claim --ttl <minutes> (1..720) needs --helper');
      action = 'claims'; body = { part: arg, ...(f.root ? { root: f.root } : {}), ...(region ? { region } : {}), ...(f.take ? { take: f.take } : {}) };
    } else if (sub === 'release') {
      if (!b.claim) throw new Error('build release needs EDEN_GOD_CLAIM or a local claim');
      action = `claims/${encodeURIComponent(b.claim)}/release`; body = f.done ? { done: true } : {};
    } else if (sub === 'pause') { action = sub; body = { ...(b.lease ? { lease: b.lease } : {}), ...(arg ? { note: arg } : {}) }; }
    else if (sub === 'done') { action = sub; body = { ...(arg ? { summary: arg } : {}), ...(f.force ? { force: true } : {}) }; }
    else if (sub === 'abandon') { action = sub; body = { ...(f.undo ? { undo: true } : {}), ...(f.force ? { force: true } : {}) }; }
    else throw new Error('build: start|step|show|resume|claim|release|pause|done|abandon');
  }
  const response = await call(BUILD_API.path(id, action), { body });
  if (sub === 'resume' && BUILD_API.unknown(response)) return buildChoices(sub, `unknown build: ${id}`, f);
  const r = ok(response, `build ${sub}`);
  if (!r.ok) return f.json ? r : `REFUSED: ${r.failures.map(explainFailure).join('; ')}${r.notReverted ? `; undone edits: ${r.reverted?.join(', ') || 'none'}; not undone edits: ${r.notReverted.join(', ')}` : ''}`;
  if (sub === 'start' && !body.brief?.trim() && !s.buildBriefWarned) { console.error('WARNING: build started without --brief; preserve the owner’s words for resume.'); save({ buildBriefWarned: true }); }
  if (sub === 'start' || sub === 'resume') save({ build: BUILD_API.local(r), group: undefined, buildEchoWarned: undefined, buildPreviews: undefined });
  if (sub === 'claim') {
    const file = claimFile(r.claim.id), release = acquireLock(`${file}.lock`, { label: 'claim state creation' });
    try {
      const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
      // A replay never resets an active helper's local step.
      if (previous?.build?.id !== r.build.id || previous.build.claim !== r.claim.id) atomicWrite(file, JSON.stringify({ build: BUILD_API.claim(r.build, r.claim) }, null, 2) + '\n');
    } finally { release(); }
    if (f.helper) return helperEnv(s, r, f);
    return f.json ? r : `${r.claim.id}: ${r.claim.part}; sub-agent: export EDEN_GOD_CLAIM=${r.claim.id}; edit only your scope, then build release --done`;
  }
  if (['release', 'done', 'abandon'].includes(sub)) save({ build: undefined, group: undefined, buildPreviews: undefined });
  invalidate();
  if (f.json) return r;
  if (sub === 'start') return buildStartReport(r.build, r.parts, r.report);
  if (sub === 'resume') return buildReport(r);
  return `${id}: ${sub === 'release' ? 'claim released' : r.build.status}${r.build.abandoned?.undo ? `; undone edits: ${r.build.abandoned.undo.reverted.join(', ') || 'none'}; not undone edits: ${r.build.abandoned.undo.notReverted.join(', ') || 'none'}` : ''}${sub === 'done' && (r.receipt ?? r.build.done?.receipt) ? '\n' + checkedReceipt(r.receipt ?? r.build.done?.receipt) : ''}${sub === 'done' && (r.reuse ?? r.build.reuse) ? '\n' + reuseReport(r.reuse ?? r.build.reuse) : ''}${sub === 'done' && r.district ? '\n' + districtLines(r.district, id).join('\n') : ''}`;
}
/** WD7 slice 3: mint a scoped helper token for a claim just taken, write it to a 0600 helper file, print only the env line. */
async function helperEnv(s, r, f) {
  const m = ok(await call(BUILD_API.path(r.build.id, `claims/${encodeURIComponent(r.claim.id)}/helper`), { body: { ...(f.ttl !== undefined ? { ttlMs: Math.round(Number(f.ttl) * 60_000) } : {}) } }), 'build claim --helper');
  if (!m.ok) return f.json ? m : `${r.claim.id}: ${r.claim.part} claimed, but no helper token: ${m.failures.map(explainFailure).join('; ')}`;
  const file = resolve(helperFile(r.claim.id));
  atomicWrite(file, JSON.stringify({ world: s.world, token: m.token, helper: m.helper, build: BUILD_API.claim(r.build, r.claim) }, null, 2) + '\n');
  if (f.json) return { ...r, helper: m.helper, helperFile: file };
  return [`${r.claim.id}: ${r.claim.part}; helper ${m.helper.label} (#${m.helper.hash8}) may edit only this claim; its own token is in the file (never printed, never the lead's).`,
    `sub-agent: export EDEN_GOD_HELPER=${file}`,
    `ends ${new Date(m.helper.expiresAt).toISOString()} or when the claim is released, done or taken, or the build closes; then build release --done`].join('\n');
}
/** group <name>: label every following edit (until `group --off`); `undo --group <name>` reverts them all. */
export async function group(name, flags = {}) {
  const b = load().build;
  if (flags.off || name === 'off' || name === '-') { save({ group: undefined }); return b ? `no subgroup; edits still carry build ${b.id}` : 'no current group'; }
  if (!name) return load().group ? `current group: ${load().group}` : 'no current group';
  const g = (b ? (String(name) === b.id || String(name).startsWith(b.id + '/') ? name : `${b.id}/${name}`) : String(name)).slice(0, 60);
  save({ group: g }); return `current group: ${g} (every edit until \`group --off\`; undo it all with \`undo --group ${g}\`)`;
}
/** G1: residents an edit, undo or redo walked out of the way (the server's `moved`), one line each. */
const movedHow = (m) => m.how === 'walked' ? 'walked out of the way' : m.how === 'stopped' ? 'stopped where they were (on the way to what changed)' : 'was moved (no walking route)';
export const movedNote = (r) => (r?.moved ?? []).map((m) => `\n  ${m.name} ${movedHow(m)} ${m.how === 'stopped' ? 'at' : 'to'} (${m.to.join(', ')}${m.level ? `, floor level ${m.level}` : ''}): "${m.reason}"`).join('');
export async function undo(flags = {}) {
  const g = flags.group === true ? load().group : flags.group;
  if ((activeClaim() || load().build?.claim) && !g) { const b = load().build; throw new Error(`a plain undo reverts anyone's newest edit; use \`undo --group ${b?.id ?? '<build>'}/${b?.part ?? '<part>'}\``); }
  const r = ok(await call(`/v1/god/undo${g ? `?group=${encodeURIComponent(g)}` : ''}`, { method: 'POST' }), 'undo'); invalidate();
  if (g) {
    // Y5: a whole open build's group rewinds it to the start; keep the local step in line with the server.
    if (r.rewound?.step && load().build?.id === g) save({ build: { ...load().build, n: r.rewound.step.n, label: r.rewound.step.label }, buildPreviews: undefined });
    if (r.accepted && !r.failures?.length && !r.notReverted?.length) return `undid group "${g}": edits ${r.reverted.join(', ') || 'none'}${r.rewound ? `; build ${g} stays open at step ${r.rewound.step?.n ?? 1} (rewound to the start; closure re-armed)` : ''}${movedNote(r)}`;
    return `group "${g}" undo incomplete; undone edits: ${r.reverted?.join(', ') || 'none'}; not undone edits: ${r.notReverted?.join(', ') || (r.failed !== undefined ? r.failed : 'unknown (server did not list them)')}\n${r.failures?.map(explainFailure).join('; ') || 'Undo did not complete.'}`;
  }
  return r.accepted ? `undid edit ${r.reverted}${movedNote(r)}` : `nothing undone: ${r.failures?.map(explainFailure).join('; ')}`;
}
export async function redo() { const r = ok(await call('/v1/god/redo', { method: 'POST' }), 'redo'); invalidate(); return r.accepted ? `redid edit ${r.reverted}${movedNote(r)}` : `nothing to redo: ${r.failures?.map(explainFailure).join('; ')}`; }
export async function history(n = 20, flags = {}) {
  const r = ok(await call(`/v1/god/edits?limit=${n}`), 'history');
  if (flags.json) return r.edits;
  return r.edits.map((e) => `${e.seq}. ${e.kind}${e.undone ? ' (undone)' : ''}${e.grp ? ` [${e.grp}]` : ''} ${e.note ?? ''} — ${summarizeOps(e.ops)}`).join('\n') || 'no edits yet';
}
const summarizeOps = (ops = []) => { const c = {}; for (const o of ops) { const k = o.op === 'place' ? `place ${String(o.def).replace(/^core\//, '').replace(/@\d+$/, '')}` : o.op; c[k] = (c[k] ?? 0) + 1; } return Object.entries(c).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', '); };
export async function resolveCmd(refs, flags = {}) {
  const r = (await query({ resolve: refs.length ? refs : true })).resolve;
  if (flags.json) return r;
  return r.violated.length ? [`${r.violated.length} constraint(s) violated of ${r.checked} constrained things:`, ...r.violated.map((x) => `- ${x.path}: ${x.kind} — ${x.why}`), 'Fix: move the thing (the solver re-solves), or `set <ref> --constraints []` to drop a relation.'].join('\n') : `all constraints hold (${r.checked} constrained things)`;
}

// ---------------------------------------------------------------- select + bulk
/** select [--def d] [--tag t] [--name glob] [--in ref] [--area x0,z0,x1,z1] [--near ref --radius r] [--all] then optionally --remove | --by dx,dz | --set-state json | --set-param k=v | --recolor #hex | --yaw r */
export async function select(flags = {}) {
  const v = view(await mirror());
  const rows = selectRows(v, flags);
  const bulk = flags.remove || flags.by || flags['set-state'] || flags['set-param'] || flags.recolor || flags.yaw !== undefined;
  if (!bulk) return flags.json ? rows : rows.length ? [`${rows.length} selected:`, ...rows.slice(0, 200).map((r) => `- ${r.path} [${r.def.replace(/^core-/, 'core/')}] at (${r.pose[0]}, ${r.pose[2]})`)].join('\n') : 'nothing matches';
  if (!rows.length) return 'nothing matches; nothing changed';
  const ops = [];
  for (const r of rows) {
    if (flags.remove) { if (!rows.some((o) => o.id === r.parent)) ops.push({ op: 'remove', id: r.path }); continue; }
    const e = v.entity(r.id);
    if (flags.by || flags.yaw !== undefined) {
      const o = { op: 'move', id: r.path, mode: 'nudge' };
      if (flags.by) { const [dx, dz] = String(flags.by).split(',').map(Number); if (e.shape) o.shape = e.shape.area ? { area: e.shape.area.map(([x, z]) => [x + dx, z + dz]) } : { ...e.shape, path: e.shape.path.map(([x, z]) => [x + dx, z + dz]) }; else o.p = r.parent === 'world' ? [e.p[0] + dx, e.p[e.p.length - 1] + dz] : e.p.length === 3 ? [e.p[0] + dx, e.p[1], e.p[2] + dz] : [e.p[0] + dx, e.p[1] + dz]; }
      if (flags.yaw !== undefined) o.r = num(flags.yaw);
      if (rows.some((x) => x.id === r.parent)) continue;   // children ride with a selected parent
      ops.push(o);
    }
    if (flags['set-state']) ops.push({ op: 'set', id: r.path, state: JSON.parse(flags['set-state']) });
    if (flags.recolor) { const o = recolorOp(v.def(r.def), r.path, flags.recolor, flags.part); if (o) ops.push(o); }
    if (flags['set-param']) ops.push({ op: 'set', id: r.path, params: parseKV(flags['set-param']) });
  }
  if (!ops.length) return `${rows.length} selected, but none of them has that to change (recolor needs a paint state or a colour param)`;
  const res = await act({ ops: ops.slice(0, 256) }, flags.note ?? `bulk ${flags.remove ? 'remove' : 'edit'} of ${rows.length}`);
  return res.accepted ? `${flags.remove ? 'removed' : 'changed'} ${ops.length} thing(s) in one batch (seq ${res.seq})${ops.length > 256 ? ' — first 256 only; run again' : ''}` : `REFUSED: ${res.failures.map(explainFailure).join('; ')}`;
}

// ---------------------------------------------------------------- look
/** Resolve ordinary look framing without HTTP or folder state. */
export function lookFrame(v, extent, flags = {}) {
  for (const key of ['dist', 'span']) if (flags[key] !== undefined &&
    (Array.isArray(flags[key]) || typeof flags[key] === 'boolean' || String(flags[key]).trim() === '' || !Number.isFinite(Number(flags[key])) || Number(flags[key]) <= 0)) {
    throw Error(`look --${key} takes one finite positive number`);
  }
  const dist = flags.dist !== undefined ? num(flags.dist) : undefined, explicitSpan = flags.span !== undefined;
  let target, span, coordinate = false;
  if (flags.at) {
    const p = refPoint(v, flags.at);
    if (p.kind === 'entity') { const [x0, z0, x1, z1] = p.row.aabb; target = [p.x, p.row.y?.[0] ?? p.row.pose[1], p.z]; span = Math.max(x1 - x0, z1 - z0, 4); }
    else { target = [p.x, 0, p.z]; span = 40; coordinate = true; }
  } else {
    const roots = v.rows.filter((r) => r.parent === 'world' && !isFlagDef(v.def(r.def)?.ref ?? r.def) && !(r.shape && r.aabb[2] - r.aabb[0] > extent * 0.6));
    if (!roots.length) { target = [0, 0, 0]; span = 160; }
    else { const x0 = Math.min(...roots.map((r) => r.aabb[0])), z0 = Math.min(...roots.map((r) => r.aabb[1])), x1 = Math.max(...roots.map((r) => r.aabb[2])), z1 = Math.max(...roots.map((r) => r.aabb[3])); target = [(x0 + x1) / 2, 0, (z0 + z1) / 2]; span = Math.max(30, x1 - x0, z1 - z0); }
  }
  if (explicitSpan) span = num(flags.span);
  // A coordinate has no object to fit. Only an explicit span can override its requested distance.
  // Named entities/sets retain auto-fit; an explicit span is always a minimum fit outside rooms.
  return { target, span, dist, fitSpan: flags.inside || (coordinate && dist !== undefined && !explicitSpan) ? 0 : span,
    tight: explicitSpan && dist === undefined && !flags.inside };
}
/** look [--at ref|x,z] [--from n|e|s|w|ne…|above] [--dist m] [--span m] [--inside] [--out file]: a screenshot to read. */
export function lookOverrides(flags = {}) {
  const out = {};
  if (flags.hour !== undefined) {
    if (typeof flags.hour !== 'string' || !/^(?:[01]?\d|2[0-3])(?::[0-5]\d)?$/.test(flags.hour)) throw new Error('look --hour takes HH[:MM], from 00:00 to 23:59');
    const [hour, minute = '00'] = flags.hour.split(':');
    out.hour = `${hour.padStart(2, '0')}:${minute}`;
  }
  if (flags.weather !== undefined) {
    if (typeof flags.weather !== 'string' || !/^[a-z][a-z-]{0,31}$/.test(flags.weather)) throw new Error('look --weather takes one weather name, e.g. rain or clear');
    out.weather = flags.weather;
  }
  return out;
}
/** Semicolon-separated camera specs; options stay local to each view. */
export function lookViews(spec, base = {}) {
  if (typeof spec !== 'string' || !spec.trim()) throw Error('look --views takes semicolon-separated views');
  const rows = spec.split(';').map(s => s.trim());
  if (rows.some(s => !s) || rows.length > 8) throw Error('look --views takes 1..8 nonempty views');
  return rows.map(label => {
    const tokens = label.split(/\s+/), first = tokens[0].startsWith('--') ? undefined : tokens.shift();
    const { flags, rest } = parseFlags(tokens, boolsFor('look'));
    checkArgs('look', flags, rest);
    if (Object.keys(flags).some(k => !['at', 'from', 'dist', 'span', 'height', 'inside', 'floor', 'hide-roofs'].includes(k))) throw Error('view specs take only camera options');
    if (first && first !== 'inside' && !['above', 'top'].includes(first) && !compassKey(first)) throw Error(`unknown look view ${first}`);
    return { ...base, ...flags, ...(first === 'inside' ? { inside: true } : first ? { from: first } : {}), label };
  });
}
export async function kitLook(json, flags = {}, runtime = {}) {
  return withLookDeadline(runtime, signal => kitLookInner(json, flags, runtime, signal));
}
async function kitLookInner(json, flags, runtime, signal) {
  const kit = typeof json === 'string' ? JSON.parse(json) : json, overrides = lookOverrides(flags), def = kitDefinition(kit);
  const admitted = ok(await call('/v1/god/kit/render', { body: { def, ...(flags.beside ? { beside: normDef(flags.beside) } : {}) } }), 'kit look');
  signal.throwIfAborted();
  if (!admitted.accepted) throw Error(`kit look refused: ${admitted.failures.map(explainFailure).join('; ')}`);
  const fixed = correctedLine(admitted.warnings, kitIgnoredKeys(kit)); // kitlenient
  const shot = await (runtime.shoot ?? (args => shoot(args, runtime)))({ timeoutMs: Math.max(1, runtime.deadlineAt - Date.now()), worldUrl: load().world, studio: admitted, out: resolve(flags.out ?? 'looks/kit-workbench.png'), ...overrides,
    ...(flags.width ? { width: num(flags.width) } : {}), ...(flags.h ? { height: num(flags.h) } : {}) });
  const rest = (shot.warnings ?? []).filter(w => !String(w).startsWith('kit.corrected: ')); // already in the one corrected line
  return flags.json ? { ...shot, ...(fixed ? { corrected: fixed } : {}) } : `kit look: ${shot.file} · front, side, top, ¾ · ${Math.round(shot.ms) / 1000} s\n${fixed ? `  ${fixed}\n` : ''}${rest.join('\n')}${rest.length ? '\n' : ''}  No world edit. Read the sheet before define-kit.`;
}
export async function look(flags = {}, runtime = {}) {
  return withLookDeadline(runtime, signal => lookInner(flags, runtime, signal));
}
async function withLookDeadline(runtime, run) {
  const requested = runtime.timeoutMs ?? Number(process.env.EDEN_GOD_LOOK_TIMEOUT_MS ?? LOOK_DEFAULT_MS);
  const ms = Number.isFinite(requested) ? Math.min(LOOK_MAX_MS, Math.max(1, requested)) : LOOK_DEFAULT_MS, abort = new AbortController();
  runtime.deadlineAt = Date.now() + ms;
  const timeout = Object.assign(new Error(`look.timeout: exceeded ${ms} ms; run doctor --fix`), { code: 'look.timeout' });
  let timer;
  const expired = new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(timeout); runtime.cleanup?.(); reject(timeout); }, ms); });
  try { return await withDeadline(runtime.deadlineAt, abort.signal, () => Promise.race([expired, run(abort.signal)])); }
  finally { clearTimeout(timer); }
}
async function lookInner(flags = {}, runtime = {}, signal) {
  if (flags.stop) return stopKeeper();
  const overrides = lookOverrides(flags), count = flags.frames === undefined ? 1 : num(flags.frames), every = flags.every === undefined ? 250 : num(flags.every);
  if (!Number.isInteger(count) || count < 1 || count > 16 || every < 16 || every > 60000) throw Error('look --frames takes 1..16; --every takes 16..60000 ms');
  if (flags.every !== undefined && flags.frames === undefined) throw Error('look --every requires --frames');
  if (flags.frames !== undefined && (flags.views || flags.site)) throw Error('choose --frames or --views/--site');
  const m = await (runtime.mirror ?? mirror)(); const v = view(m);
  let base = { ...flags };
  if (flags.site) {
    const current = load().build;
    if (!current?.id) throw Error('look --site needs a current build; use build resume <id>');
    const b = ok(await call(`/v1/god/builds/${encodeURIComponent(current.id)}`), 'look --site').build;
    base = { ...base, at: b.site.at.join(','), span: flags.span ?? String(Math.max(...b.site.size) * 1.15) };
  }
  const specs = flags.views || flags.site ? lookViews(flags.views ?? 'sw;w;above;inside', base) : [base];
  const views = [], ground = new Map();
  for (const spec of specs) {
    const { target, span, dist, fitSpan, tight } = lookFrame(v, m.extent, spec);
    if (target[1] === 0 || spec.at === undefined || !Number.isFinite(target[1])) {
      const key = `${target[0]},${target[2]}`;
      if (!ground.has(key)) ground.set(key, (await query({ points: [[target[0], target[2]]] })).points[0]);
      const g = ground.get(key); target[1] = Math.max(g.y, g.y + (g.water > 0 ? g.water : 0));
    }
    const cam = camera({ target, span, from: spec.from ?? 's', dist, tight, inside: !!spec.inside, height: spec.height ? num(spec.height) : undefined });
    views.push({ ...cam, hideRoofs: !!(spec.inside || spec['hide-roofs'] || spec.floor !== undefined), cut: spec.floor !== undefined ? num(spec.floor) : null, span: fitSpan, label: spec.label ?? cam.from });
  }
  const cam = views[0];
  signal.throwIfAborted();
  void attention(cam.at, cam.eye); // CE8: in flight during the shot; never awaited
  const out = resolve(flags.out ?? `looks/look-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`);
  const args = { timeoutMs: Math.max(1, runtime.deadlineAt - Date.now()), remote: !!flags.remote, worldUrl: load().world, ...cam, out, expect: drawableCount(m.snapshot) /* r2.1: bodies are never in layer.drawn */, cliPath: SELF, keep: !!flags.keep, ...overrides,
    ...(flags.views || flags.site ? { views } : {}), frames: count, every,
    ...(flags.width ? { width: num(flags.width) } : {}), ...(flags.h ? { height: num(flags.h) } : {}) };
  let shot, keep = !!flags.keep;
  if (!keep && !flags.remote && !runtime.shoot) {
    // G1: a warm keeper takes the look; while it is still starting, a single view goes to the world's own renderer
    // (when it has one) or waits for it. Folders that do not warm up keep the one-shot Chrome.
    const route = await lookRoute({ world: args.worldUrl, cliPath: SELF, single: !args.views && count === 1, deadlineAt: runtime.deadlineAt, signal, remote: () => remoteLook({ ...args, timeoutMs: Math.max(1, runtime.deadlineAt - Date.now() - 15_000) }, { deadlineAt: runtime.deadlineAt, signal }) });
    if (route?.shot) shot = route.shot;
    else if (route === 'keeper') { keep = true; args.keep = true; args.timeoutMs = Math.max(1, runtime.deadlineAt - Date.now()); }
  }
  if (shot) { /* rendered by the world */ }
  else if (!keep) shot = await (runtime.shoot ?? ((a) => shoot(a, runtime)))(args);
  else {
    // a kept browser: the shot runs in a child process so its browser connection does not keep this one alive
    const child = spawnSync(process.execPath, [SELF, 'look-shot', JSON.stringify(args)], { encoding: 'utf8', cwd: process.cwd(), env: process.env, timeout: Math.max(1, runtime.deadlineAt - Date.now()), killSignal: 'SIGKILL', maxBuffer: 1 << 24 });
    if (child.status !== 0) throw new Error(`look failed: ${(child.stderr || child.stdout || '').trim().slice(0, 500)}`);
    shot = JSON.parse(child.stdout.trim().split('\n').pop());
  }
  if (flags.json) return { ...shot, eye: cam.eye, at: cam.at };
  return `look: ${shot.file}\n  from the ${cam.from} at (${(shot.frames?.eye ?? cam.eye).join(', ')}) toward (${cam.at.join(', ')})${shot.frames?.closer || shot.frames?.raised || shot.frames?.lifted ? ` (the requested eye was under the ground: ${[shot.frames.closer ? `moved ${shot.frames.closer} m closer along the view` : '', shot.frames.raised ? `raised ${shot.frames.raised}° on its side` : '', shot.frames.lifted ? `lifted ${shot.frames.lifted} m` : ''].filter(Boolean).join(', ')} to see the target)` : ''}, ${Math.round(shot.ms / 100) / 10} s${shot.size ? `, ${shot.size} px` : '' /* W2b actual remote PNG size */}${shot.state && !shot.state.ready ? ` (not fully settled: ${JSON.stringify(shot.state)})` : ''}\n  Read the image file; then fix what looks wrong.`;
}

// ---------------------------------------------------------------- export / import / define
/** export [file]: the world as a genesis/1 template (defines + places in dependency order). */
export async function exportWorld(file, flags = {}) {
  const s = await snapshot();
  const g = exportGenesis(s, flags);
  const out = resolve(file ?? `${s.worldId}.genesis.json`);
  writeFileSync(out, JSON.stringify(g, null, 1));
  const ops = g.batches.flatMap((b) => b.ops), things = ops.filter((op) => op.op === 'place').length, defs = ops.filter((op) => op.op === 'define').length;
  return `exported ${things} things${defs ? ` and ${defs} defs` : ''} in ${g.batches.length} batches to ${out}`;
}
const pathOf = (byId, e) => { const parts = []; for (let c = e; c; c = byId.get(c.in.parent)) parts.unshift(c.name ?? c.id); return parts.join('/'); };
/** import <genesis.json>: apply a template's batches to this world, each atomic (group "import" unless the batch says). */
export const importWorld = (file, flags = {}) => withoutBuild(async () => {
  const g = JSON.parse(readFileSync(file, 'utf8'));
  if (g.schema !== 'genesis/1') throw new Error('import: file must be genesis/1');
  const out = [];
  const s = await snapshot();
  if (g.constants?.extent && g.constants.extent > s.constants.extent) { await expand(g.constants.extent); out.push(`expanded to ${g.constants.extent} m`); }
  if (g.state) { const r = await act({ ops: [{ op: 'world', state: g.state }] }, 'import: state'); out.push(r.accepted ? 'world state set' : `state refused: ${r.failures.map(explainFailure).join('; ')}`); }
  for (const [i, b] of g.batches.entries()) {
    const r = await act({ ops: b.ops, group: b.group ?? flags.group ?? 'import' }, `import ${i + 1}/${g.batches.length}${b.note ? ': ' + b.note : ''}`);
    out.push(r.accepted ? `batch ${i + 1} (${b.note ?? ''}): ${b.ops.length} ops` : `batch ${i + 1} REFUSED: ${r.failures.map(explainFailure).join('; ')}`);
    if (!r.accepted) break;
  }
  return out.join('\n');
});
export async function define(json, ignored = []) {
  const def = typeof json === 'string' ? JSON.parse(existsSync(json) ? readFileSync(json, 'utf8') : json) : json;
  // a generator-made def exposes the generator's params (ranges, defaults) unless it declares its own
  if (def.make?.kind === 'gen' && !def.params) { const g = (await schema()).generators?.find((x) => x.id === def.make.gen); if (g && Object.keys(g.params).length) def.params = g.params; }
  const r = await act({ ops: [{ op: 'define', def: { schema: 'def/1', ...def } }] }, `define ${def.name}`), fixed = correctedLine(r.warnings, ignored);
  return (r.accepted ? `defined ${def.name}@${def.version ?? 1} — place it with: place ${def.name}@${def.version ?? 1} --at …` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`) + (fixed ? `\n  ${fixed}` : ''); }
/** kitlenient: the server's kit corrections, and kit keys the CLI did not carry, as one short line ('' when none). */
export function correctedLine(warnings = [], ignored = []) {
  const fixes = (warnings ?? []).filter(w => w.startsWith('kit.corrected: ')).map(w => w.slice(15).replace(/ make\.args\./, ' '));
  const refs = [...new Set(fixes.map(f => f.split(' ')[0]))], items = refs.length === 1 ? fixes.map(f => f.slice(refs[0].length + 1)) : fixes;
  const shown = [...items.slice(0, 5), ...(items.length > 5 ? [`+${items.length - 5} more`] : []), ...(ignored.length ? [`ignored kit keys: ${ignored.join(', ')}`] : [])];
  return shown.length ? `corrected${refs.length === 1 ? ` ${refs[0]}` : ''}: ${shown.join('; ')}` : '';
}
/** define-kit <json|file>: a kit/2 prop or creature from rounded primitives. {name, shapes:[{kind, at, size|r|h, color, role…}], tags?, gait?, layer?, slots?, components?, description?} */
export async function defineKit(json, flags = {}) {
  const k = typeof json === 'string' ? JSON.parse(existsSync(json) ? readFileSync(json, 'utf8') : json) : json;
  if (!k.name || !Array.isArray(k.shapes)) throw new Error('define-kit needs {name, shapes:[…]} (see SKILL.md, kit primitives in SCHEMA.md)');
  // K2 hook: authored programs are expanded on the server; never guess their bounds from one seed shape (kitlenient: a missing box is measured there).
  // Search name and tags before the write, and surface kept parts before unused defs.
  const matches = (await searchDefs([k.name.replace(/[-_.]/g, ' '), ...(k.tags ?? [])].join(' '))).defs;
  const picks = [...matches.filter(d => usedIn(d).length), ...matches.filter(d => !usedIn(d).length)].slice(0, 5);
  const similar = picks.map(d => d.ref.replace(/^core-/, 'core/'));
  const def = kitDefinition(k);
  if (flags.dry) return { def, similar, ...(kitIgnoredKeys(k).length ? { ignored: kitIgnoredKeys(k) } : {}) };
  if (picks.length) console.error(`similar defs already in the library: ${picks.map(d => oneLine(d.ref.replace(/^core-/, 'core/')) + usedBadge(d) + (usedIn(d).length && d.hash ? ' · ' + placePart({ sha: d.hash }) : '')).join('; ')} — prefer them when they fit`);
  return define(def, kitIgnoredKeys(k));
}

// ---------------------------------------------------------------- furnish / gallery (other lanes' libs)
/** furnish <house>[/room] [--style townhouse] [--dry]: L2's recipes, run on the server (where the model and the
 *  recipe files are), dry-run, then one batch the audience sees arrive. */
export async function furnish(ref, flags = {}) {
  if (!ref) throw new Error('usage: furnish <house>[/room] [--style cottage|townhouse|shop|…] [--dry]');
  const v = view(await mirror());
  const [houseRef, room] = v.get(ref) ? [ref, undefined] : String(ref).split(/\/(?=[^/]+$)/);
  const host = v.get(houseRef); if (!host) throw new Error(`no such building: ${ref}`);
  const rooms = room ? (host.slots ?? []).filter((x) => x.kind === 'room').map((x) => x.id).filter((id) => id === room || id.replace(/[^a-z]/g, '').startsWith(room.replace(/[^a-z]/g, ''))) : undefined;
  if (room && !rooms.length) throw new Error(`${host.path} has no room ${room}; rooms: ${(host.slots ?? []).filter((x) => x.kind === 'room').map((x) => x.id).join(', ')}`);
  const f = (await query({ furnish: { ref: host.path, ...(flags.style ? { style: flags.style } : {}), ...(rooms ? { rooms } : {}) } })).furnish;
  if (!f || f.error) throw new Error(f?.error ?? 'furnish is not available on this server; place furniture with --inside <house>/<room> [--corner|--wall]');
  const lines = [...(f.notes ?? []).map((n) => `  note: ${n}`), ...(f.dropped ?? []).slice(0, 8).map((d) => `  dropped: ${typeof d === 'string' ? d : `${d.name ?? d.def} (${d.why ?? d.reason ?? ''})`}`)];
  if (!f.ops?.length) return [`nothing to furnish in ${ref}`, ...lines].join('\n');
  if (flags.dry) return [`would furnish ${ref}: ${summarizeOps(f.ops)}`, ...lines].join('\n');
  const r = await act({ ops: f.ops, ...(flags.group ? { group: flags.group } : {}) }, `furnish ${ref}`);
  return r.accepted ? [`furnished ${ref}: ${summarizeOps(f.ops)} (seq ${r.seq})`, ...lines].join('\n') : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
}
export const EXAMPLES = { hamlet: 'a hamlet in 8 commands: knoll, cottage, pond + bench, trees, well + lamps, a dog', 'two-floor-house': 'a townhouse furnished, an upstairs bedroom by hand, look --inside --floor 1', 'river-bridge': 'a lake, a river to the south edge, roads that bridge it', 'market-square': 'a plaza, a row of stalls, benches, lamps, a fountain', 'forest-edge': 'a woodland, a meadow, a track along the edge, deer', 'hillside-village': 'a hill, a road up it, cottages along it, a chapel, door paths' };
/** examples [name]: the worked examples served by the world (the exact commands and their answers). */
export async function examples(name) {
  if (!name) return ['worked examples (each = the exact commands a god agent typed and the answers it got):', ...Object.entries(EXAMPLES).map(([k, d]) => `- ${k}: ${d}`), `read one: examples <name>  (saves examples/<name>.log and .mjs here; also served at ${load().world}/god/examples/<name>.log)`].join('\n');
  if (!EXAMPLES[name]) throw new Error(`no example ${name}; examples: ${Object.keys(EXAMPLES).join(', ')}`);
  mkdirSync('examples', { recursive: true });
  const out = [];
  for (const ext of ['log', 'mjs']) { const r = await fetch(`${load().world}/god/examples/${name}.${ext}`); if (!r.ok) throw new Error(`the world did not serve ${name}.${ext} (${r.status})`); const t = await r.text(); writeFileSync(`examples/${name}.${ext}`, t); if (ext === 'log') out.push(t); }
  return `${out[0].trim()}\n(saved examples/${name}.log and examples/${name}.mjs)`;
}
export async function gallery() { return 'gallery: run `node tools/god-skill/scripts/gallery.mjs <world-url>` from the sim repo (it places every core def in a labelled grid and screenshots it).'; }

// ---------------------------------------------------------------- flags, prayers, stream
export async function flags() { const v = view(await mirror()); return v.rows.filter((r) => isFlagDef(v.def(r.def)?.ref ?? r.def)).map((r) => ({ name: `flag:${r.name}`, label: v.entity(r.id)?.state?.label ?? '', at: [r.pose[0], r.pose[2]] })); }
export async function flag(label, f) { const v = view(await mirror()); const p = refPoint(v, f.at ?? '0,0', f.offset); const name = label.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'flag'; const r = await act({ ops: [{ op: 'place', def: 'core/flag@1', name, p: [p.x, p.z], state: { label } }] }); return r.accepted ? `flag:${name} at (${p.x}, ${p.z})` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`; }
/** prayers [--all]: the prayers waiting for an answer (an answered prayer leaves this list); --all also the answered ones, with their answers. */
export async function prayers(flags = {}) { return ok(await call(`/v1/god/prayers${flags.all ? '?all=1' : ''}`), 'prayers'); }
export async function answer(prayer, text) { return act({ ops: [{ op: 'answer', prayer, text }] }); }
export async function stream(seconds = 60) { return follow(seconds, (e) => console.log(JSON.stringify(e))); }
export async function status() { const s = load(); const st = ok(await call('/v1/god/status'), 'status'); const v = st.versions; return `${s.world} — you are ${st.you}; ${st.entities} entities, seq ${st.seq}${s.group ? `; group "${s.group}"` : ''}${s.build ? `; ${buildHeader(s.build, st.builds?.find((b) => b.id === s.build.id))}` : ''}; skill ${SKILL_VERSION}${v ? `; server protocol ${v.protocol}, schema ${v.schema}, skill ${v.skill}, source ${v.source}` : ''}`; }

// ---------------------------------------------------------------- cli
/** Flags that never take a value (the next word stays a positional argument). */
const BOOL = new Set(['missing', 'clear', 'fix', 'helper', 'local', 'remote' /* W2 remote looks */, 'no-build', 'done', 'force', 'undo', 'float', 'dry', 'plan', 'nudge', 'json', 'all', 'keep', 'hide-roofs', 'stop', 'site', 'unused', 'off', 'md', 'fresh', 'remove', 'free', 'list', ...ENV_BOOLS, ...LAYERS_BOOLS]);
// listen --once/--follow are switches; `hours --follow field@open=…` takes a value, so they are listen-only.
const boolsFor = (cmd) => (cmd === 'look' ? new Set([...BOOL, 'inside']) : cmd === 'listen' ? new Set([...BOOL, 'once', 'follow']) : cmd === 'ack' ? new Set([...BOOL, 'failed']) : cmd === 'upload' ? new Set([...BOOL, 'define']) : BOOL);
export function parseFlags(argv, bools = BOOL) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
      let v;
      if (eq > 0) v = a.slice(eq + 1);
      else if (k === 'between') { v = [argv[++i], argv[++i]]; }
      else if (bools.has(k)) v = true;
      else v = argv[i + 1] !== undefined && !(argv[i + 1].startsWith('--') && argv[i + 1].length > 2) ? argv[++i] : true;
      if (flags[k] !== undefined && k !== 'between') flags[k] = [].concat(flags[k], v); else flags[k] = v;
    } else rest.push(a);
  }
  return { flags, rest };
}
// What each command accepts: anything else is refused, never silently ignored.
const REL = 'at offset near around dist dir count facing yaw against between along t side setback inside corner wall on row grid gap spacing float from to via width across span free radius';
const FLAGS = {
  doctor: 'fix local', trace: 'build limit',
  build: 'title steps at offset size yaw mass brief root take done force undo say timeout asks include district plots file delete to dry helper ttl',
  listen: 'after timeout once follow', ack: 'failed',
  'verify-use': 'seat from uses',
  place: `${REL} path area rect circle name param state about scale dry plan nudge group note`, terrain: `${REL} path area rect circle name param state about scale dry plan nudge group note`,
  move: `${REL} by in local nudge note dry plan`, look: 'at from dist inside floor keep remote out span height width h hide-roofs stop hour weather views site frames every', kit: 'hour weather beside out width h', defs: 'tag all unused remove', where: 'at offset', reach: '', clear: 'size', free: 'near radius count slope',
  select: 'def tag name in area near radius all remove by set-state set-param recolor yaw part note', set: 'state param name constraints about note', about: 'set clear missing kind limit note', recolor: 'part', clone: 'name count step yaw at offset nudge note',
  sky: 'palette sun list', ...ENV_FLAGS, group: 'off', undo: 'group', map: 'all', furnish: 'style dry group', 'define-kit': 'dry', register: 'identity', mirror: 'fresh', export: 'name', import: 'group', flag: 'at offset', schema: 'md', act: 'note request-ref', prayers: 'all',
  upload: 'name height tags license source description layer footprint define dry',
  thumbnail: 'from at dist span hour weather remote out dry file clear',
  catalog: 'category has tag page per', find: 'category has tag all', parts: '', recommend: 'per', taxonomy: '',
  ...LAYERS_FLAGS, ...GOV_FLAGS,
};
// how many positional words each command takes (Infinity: free text or a list)
const POS = { ...GOV_POS, listen: 0, ack: 2, doctor: 0, trace: 0, kit: 2, build: 2, 'verify-use': 1, ...LAYERS_POS, catalog: 0, taxonomy: 0, time: 2, strike: 0, land: 3, place: 1, terrain: 1, move: 1, set: 1, about: 1, recolor: 2, clone: 1, describe: 1, where: 1, reach: 2, clear: 1, free: 1, look: 0, sky: 0, weather: 0, select: 0, group: 1, undo: 0, redo: 0, history: 1, map: 0, furnish: 1, mint: 1, pair: 1, register: 2, status: 0, flags: 0, prayers: 0, schema: 0, snapshot: 0, examples: 1, expand: 1, import: 1, export: 1, define: 1, 'define-kit': 1, upload: 1, thumbnail: 0, act: 1, dryrun: 1, plan: 1, preview: 1, commit: 1, request: 1, query: 1, stream: 1, follow: 1, mirror: 0, gallery: 0, help: 1 };
// `side` is a word for place/terrain/move (--along road --side left|right|both) and a number only for `land cliff --side 1|-1`.
const NUMERIC = new Set(['dist', 'count', 't', 'setback', 'row', 'spacing', 'width', 'span', 'radius', 'sun', 'clouds', 'wind', 'rain', 'fog', 'intensity', 'speed', 'amount', 'level', 'depth', 'metres', 'peak', 'edge', 'face', 'steps', 'scale', 'floor', 'height', 'h', 'frames', 'every', 'slope', 'gap', 'yaw']);
const SIDES = ['left', 'right', 'both', 'center', 'centre'];
/** Refuse what the CLI cannot read: unknown options, missing values, extra words, non-numbers. */
export function checkArgs(cmd, f, rest) {
  const allowed = new Set(['json', 'no-build', ...(FLAGS[cmd] ?? '').split(/\s+/).filter(Boolean)]);
  for (const [k, v] of Object.entries(f)) {
    if (/\s/.test(k)) throw new Error(`cannot read "--${k}…": several options arrived as ONE argument (a quoted string or an unsplit shell variable). Give each option separately, e.g. --param floors=1 --param w=8`);
    if (!allowed.has(k)) throw new Error(`${cmd} has no option --${k}. Its options: ${[...allowed].map((x) => '--' + x).join(' ')}`);
    for (const x of [].concat(v)) {
      if (x === true && !bareOk(cmd, k) /* build --take/--delete: Y3 */) throw new Error(`--${k} needs a value`);
      if ((NUMERIC.has(k) || (k === 'side' && cmd === 'land')) && !(cmd === 'build' && k === 'steps') && x !== true && !Number.isFinite(Number(x))) throw new Error(`--${k} takes a number, got "${x}"`);
      if (k === 'side' && cmd !== 'land' && x !== true && !SIDES.includes(String(x))) throw new Error(`--side is ${SIDES.slice(0, 4).join(', ')} (with --along <path>), got "${x}"`);
      if (cmd === 'look' && ['dist', 'span'].includes(k) && (Array.isArray(v) || x === true || String(x).trim() === '' || Number(x) <= 0)) throw new Error(`look --${k} takes one finite positive number`);
      if (k === 'param' && (typeof x !== 'string' || !/^[A-Za-z][\w-]*=/.test(x))) throw new Error(`--param takes key=value (one per --param), got "${x}"`);
      if ((k === 'by' || k === 'step') && cmd !== 'land' && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(String(x))) throw new Error(`--${k} takes dx,dz (e.g. --${k} 1.5,-2), got "${x}"`);
      if (k === 'grid' && !/^\d+[x×]\d+$/.test(String(x))) throw new Error(`--grid takes WxH (e.g. 3x2), got "${x}"`);
    }
  }
  const max = POS[cmd] ?? Infinity;
  if (rest.length > max) throw new Error(`${cmd} takes ${max === 0 ? 'no words' : max === 1 ? 'one word' : `${max} words`} before its options; cannot read: ${rest.slice(max).map((x) => JSON.stringify(x)).join(' ')}${rest.slice(max).some((x) => /^-\w/.test(x)) ? ' (options start with two dashes)' : ''}`);
}
/** Values a command may take bare (checkArgs' exceptions to "--k needs a value"). */
const bareOk = (cmd, k) => boolsFor(cmd).has(k) || (cmd === 'build' && (k === 'take' || k === 'delete')) || (cmd === 'look' && k === 'inside') || (cmd === 'undo' && k === 'group') || k === 'free';
/** How the CLI reads one command line: shell-shape repairs (lib/args.mjs), then flags. `notes` say what was repaired;
 *  `hint` explains an unsplit shell variable when a refusal follows. */
export function readArgs(cmd, argv) {
  const numeric = new Set([...NUMERIC, ...(cmd === 'land' ? ['side'] : [])]);
  const n = normalizeArgv(cmd, argv, { bools: boolsFor(cmd), numeric, needsValue: (k) => !bareOk(cmd, k) });
  return { ...parseFlags(n.argv, boolsFor(cmd)), argv: n.argv, notes: n.notes, hint: n.hint };
}
/** `<verb> --help`: the help lines that mention the verb, and its options. */
export function helpFor(cmd) {
  const re = new RegExp(`(^[\\w-]+:\\s+|· |^)${cmd.replace(/[-]/g, '\\-')}(:| |$)`);
  const lines = HELP.split('\n').filter((l) => re.test(l));
  const opts = ['json', 'no-build', ...(FLAGS[cmd] ?? '').split(/\s+/).filter(Boolean)];
  return [...(lines.length ? lines : [`${cmd}: see help`]), `${cmd} options: ${opts.map((x) => '--' + x).join(' ')}`].join('\n');
}
/** RL6 replay/lint: the CLI's own reading tables (read-only). */
export const CLI_SHAPE = { POS, FLAGS, BOOL, NUMERIC, boolsFor };
const readArg = (r) => (r[0] !== undefined ? (existsSync(r[0]) && !r[0].trim().startsWith('{') ? readFileSync(r[0], 'utf8') : r[0]) : readFileSync(0, 'utf8'));
export const COMMANDS = { doctor: (r, f) => doctor(f), trace: (r, f) => trace(f),
  kit: (r, f) => { if (r[0] !== 'look' || !r[1]) throw Error('usage: kit look <kit.json> [--hour 21] [--beside core/church@1] [--out file]'); return kitLook(readArg(r.slice(1)), f); },
  listen: (r, f) => listen(f, { beat: () => { listenerBeat(); autoWarm(SELF); } }), ack: (r, f) => ack(r[0], r[1], !!f.failed),
  build: (r, f) => build(r[0], r.slice(1), f),
  'verify-use': (r, f) => verifyUse(r[0], f),
  register: (r, f) => register(r[0], r[1] ?? f.identity), pair: (r) => pair(r[0]), mint: (r) => mint(r[0]), status,
  map: (r, f) => map({ json: !!f.json, all: !!f.all }), defs: (r, f) => defs(r.join(' ') || undefined, f), schema: (r, f) => schema(f), snapshot,
  about: (r, f) => about(r[0], f), describe: (r, f) => describe(r[0], f), where: (r, f) => where(r[0] ?? f.at, f), reach: (r, f) => reach(r[0], r[1], f), clear: (r, f) => clear(r[0], f), query: (r) => query(readArg(r)), free: (r, f) => freePlots(r[0], f),
  place: (r, f) => place(r[0], f), terrain: (r, f) => place(r[0], f), move: (r, f) => move(r[0], f), set: (r, f) => set(r[0], f), recolor: (r, f) => recolor(r[0], r[1], f), remove: (r) => remove(r), clone: (r, f) => clone(r[0], f),
  act: (r, f) => act(JSON.parse(readArg(r)), f.note, f['request-ref']), dryrun: (r) => dryrun(JSON.parse(readArg(r))), plan: (r) => planBatch(readArg(r)), preview: (r) => preview(readArg(r)), commit: (r) => commit(r[0]), request: (r) => request(r[0]),
  select: (r, f) => select(f), group: (r, f) => group(r[0], f), undo: (r, f) => undo(f), redo, history: (r, f) => history(r[0] ? Number(r[0]) : 20, f), resolve: (r, f) => resolveCmd(r, f),
  look: (r, f) => look(f), 'look-keeper': (r, f) => keeper(r[0], Number(r[1]), { warm: f.warm !== undefined }), 'look-shot': async (r) => { const res = await shoot(JSON.parse(r[0])); console.log(JSON.stringify(res)); process.exit(0); }, export: (r, f) => exportWorld(r[0], f), import: (r, f) => importWorld(r[0], f), define: (r) => define(readArg(r)), 'define-kit': (r, f) => defineKit(readArg(r), f), upload: (r, f) => upload(r[0], f), thumbnail: (r, f) => thumbnail(f, { look }),
  furnish: (r, f) => furnish(r[0], f), gallery, examples: (r) => examples(r[0]),
  catalog: (r, f) => catalog(f), find: (r, f) => find(r.join(' ') || undefined, f), parts: (r, f) => parts(r.join(' '), f), recommend: (r, f) => recommend(r.join(' '), f), taxonomy: (r, f) => taxonomy(f),
  sky: (r, f) => sky(f), weather: (r, f) => envWeather(f), time: (r, f) => envTime(r, f), strike: (r, f) => envStrike(f), land: (r, f) => envLand(r, f), constitution: (r) => constitution(r.join(' ')), expand: (r) => expand(r[0]),
  flags, flag: (r, f) => flag(r.join(' '), f), prayers: (r, f) => prayers(f), answer: (r) => answer(r[0], r.slice(1).join(' ')), stream: (r) => stream(r[0] ? Number(r[0]) : 60),
  follow: (r) => follow(r[0] ? Number(r[0]) : 3600, (e) => console.log(`${e.event} ${e.data?.seq ?? ''}`)), mirror: async (r, f) => { const m = await mirror({ fresh: !!f.fresh }); return `mirror: seq ${m.seq}, ${m.rows.length} entities${m.offline ? ' (offline)' : ''}`; },
  hours: (r, f) => hours(r[0], f), event: (r, f) => event(r[0], r[1], f), own: (r, f) => own(r[0], r[1], f), access: (r) => access(r[0], r[1]), price: (r, f) => price(r[0], r[1], f), currency: (r) => currency(r[0]),
  give: (r) => give(r[0], r[1]), pay: (r) => pay(r[0], r[1], r[2]), zone: (r, f) => zone(r[0], r[1], f), 'zone-suggest': (r) => zoneSuggest(r[0]), relate: (r, f) => relate(r[0], r[1], r[2], f), layers: (r, f) => layers(f),
  secret: (r) => secret(r[0], r[1]),
  amendments: (r, f) => amendments(f), decide: (r, f) => decide(r[0], r[1], f), governance: (r, f) => governance(f),
  help: () => HELP,
};
// G5: a switched-off feature's verbs answer with a clean refusal instead of acting (lib/features.mjs)
const OFF_VERBS = { flags: ['flag', 'flags'], constitution: ['constitution', 'amendments', 'decide', 'governance'] };
const OFF_TEXT = { flags: 'flags are turned off in this world. Name a thing instead (place … --name camp) and use --at camp.', constitution: 'the Constitution is turned off in this world.' };
for (const [feature, verbs] of Object.entries(OFF_VERBS)) for (const verb of verbs) { const run = COMMANDS[verb]; COMMANDS[verb] = (r, f) => (godFeature(feature) ? run(r, f) : `REFUSED: ${OFF_TEXT[feature]}`); }

for (const [name, fn] of Object.entries(COMMANDS)) COMMANDS[name] = (r = [], f = {}) => withBuildOptions(f, () => ['build', 'group'].includes(name) ? withStateLock(() => fn(r, f)) : fn(r, f));
const HELP = `eden-god ${SKILL_VERSION} — god mode for one Eden world. Read SKILL.md.
home:   in a Souls home, several seats: <world> <command>; a legacy god folder moves in with: node eden.mjs import
locks:  doctor [--fix] [--local] [--json] (holders, stale locks; --fix breaks only stale ownership)
trace:  trace [--build id] [--limit n] (the world's recent god requests: route, outcome, ms, no payloads; LOOP = the same refusal 3+ times in 2 min, also in build show)
read:   verify-use <target> [--seat ref] [--from ref|x,z] [--uses enter,sit] · map · defs <words> · describe <ref> · where <x,z|ref> ([bounds] containment / [collider] hit) · reach <from> <to> · clear <x,z|ref> --size WxD · free WxD [--near ref] · look [--at ref|x,z] [--from s|n|e|w|above] [--dist m] [--span m] [--inside [--floor k]] · history · resolve · schema [--md]
look:   --views \"sw;w --dist 30;inside\" or --site makes a labelled sheet; --frames n --every ms makes a motion strip. kit look <kit.json> [--beside core/church@1] renders a world-free four-view bench. defs --unused [--remove] lists/retires never-placed trials (undoable).\nlook:   --remote (or EDEN_GOD_LOOK=remote) uses the world host; automatic fallback if local Chrome cannot start. Sheets, frame strips and kit workbench require local Playwright and Google Chrome. --dist controls coordinate views; --span is a minimum fit and may require more distance. Explicit --span alone tightens the view; named things/sets auto-fit by default. Both take one finite positive number; the viewer refuses a camera within its near clipping plane. --hour HH[:MM] [--weather rain|clear|…] changes only the picture, never the world clock.
build:  place <def> --at x,z|ref | --near ref [--dist m] [--dir ne] [--count n] | --inside house/room [--at x,z] [--wall back|front|left|right|n…] [--corner back-left|…] | --on table|pier|house/balcony [--count n] | --along road [--t 0.3] [--side left|right|both] [--offset m] [--row n --gap g] | --against ref[.n] [--offset m|--t 0..1] | --between a b | --free   [--facing ref|n|e|s|w] [--float] [--row n|--grid WxH --gap g] [--name n] [--param k=v] [--scale s (defs <name> shows its range)] [--dry]
place:  --against offset is signed metres from the side centre (positive toward e/s/w/n on n/e/s/w sides; rotated sides follow their face tangent). --t runs from 0 to 1 along the full side. Doorways/obstacles cause a reported slide within the side or a refusal. --inside --at uses a world point, including --offset dx,dz; outside, blocked, or conflicting wall/corner/count requests are refused.
shapes: place <path-def> --from ref --to ref [--via x,z] [--width w] | --path '[[x,z],…]' · place <area-def> --rect cx,cz,w,d | --circle cx,cz,r | --area '[[x,z],…]'
edit:   move <ref> <relations>|--by dx,dz|--in pier/end|house/kitchen · set <ref> --param k=v --state '{…}' · recolor <ref> #hex · remove <ref>… · clone <ref> [--at] [--count n --step dx,dz] · select [filters] [--remove|--by|--recolor|--set-state|--set-param]
meaning: about <ref|world> [--set '{"title":"…","what":"…","aliases":["…"]}' | --clear] (exact replacement; no flags reads) · about --missing [--kind building|zone|water|landmark] [--limit n] · place/set --about '{…}' (set --about null clears)
groups: group <name> · group --off · undo [--group name] · redo
site:   build start <id> --title "…" --steps "shell,roof,interior" --at ref|x,z --size w,d [--offset dx,dz] [--yaw radians] [--mass "nave 0,0 22x10 h12 gable"] [--brief file|text] [--root path|build] [--asks "item; item"] [--include ref,ref] · build district <id> [--file plan.json | --delete] (one plan: roads, plots with massing, terrain/water notes, chapters; no flag = show it; --delete frees the id, buildings stay) · build start <id> --district <d> [--plots p1,p2] [--brief …] (a chapter: site and massing come from the plots) · build continue <id> --brief "follow-up" · build check [id] · build step [label] [--asks "later ask"] [--include ref,ref] [--say "…" [--mass nave,tower]] (announce before designing; without --say stays local) · build [show [id]] · build wait [--timeout 15m] · build resume [id] [--take] · build claim <part> [--root path | --at ref --size w,d] [--take c_…] [--helper [--ttl min]] (--helper: a scoped token for a sub-agent, EDEN_GOD_HELPER=file) · build release [--done] · build pause [note] · build done [summary] [--force] · build abandon [--undo] [--force] · build rewind [id] --to <step> [--dry] [--force] (undo every build edit after that step; stays open; global --no-build skips automatic metadata)
resume: omit id to resume the only paused build or active build with a dead lead; several open builds or an unknown id list the choices.
mass:   site-local metres; h = wall/eave height, not total height. Gable/pyramid roofs add half the shorter side; flat adds none. Example: 26x12 h15 gable = 15 m walls + 6 m roof = 21 m total.
batch:  plan '<batch>' · preview '<batch>' · commit <preview-id> · act '<batch>' · dryrun '<batch>' · request <clientRef>
world:  sky [--palette p --sun s] · time [19:30|7pm] [--speed h/h] [--pause|--resume] · weather [--kind storm|rain|fog|wind|cloudy|clear|auto] [--intensity i] [--clouds --wind --rain --fog] [--minutes m] · strike [--at x,z|thing] ${godFeature('constitution') ? '· constitution <md> ' : ''}· expand <m> · export [file] · import <genesis.json> · define <def.json> · define-kit <kit.json> · furnish <house>[/room]
models: upload <file.glb|png|jpg> --name n [--height m] [--tags a,b] [--license text] [--source text] [--description text] [--layer solid|decor] [--footprint fp.json] [--define] [--dry] · upload <manifest.json> [--dry] (god-upload-manifest/1: one entry per asset with file, name, height, tags, license, source, description, layer, footprint, define; budget 80 000 tris, 3 MB, 2048 px per file — reduce heavy GLBs first with tools/god-skill/scripts/optimize-glb.mjs; SKILL.md "Importing your own models")
thumb:  ${THUMBNAIL_HELP}
inbox:  listen [--after message-id] [--timeout 25] [--once|--follow] · ack <message-id> [reply] [--failed] (a reply of up to 140 characters; --failed when it could not be done)
pair:   register <world-url> · pair · ${godFeature('flags') ? 'flags · flag <label> --at x,z · ' : ''}prayers [--all] (answered too) · answer <id> <text> · status
${LAND_HELP}
find:   catalog [--category c] [--has slot:sit|actuator:door|comp:light] [--page n] (every def, one line each) · find <words> [--category c] [--has …] · recommend <what you want> · taxonomy (categories, counts, param conventions, actuators)
parts:  parts [words] [--json] (parts kept by finished builds, checks and pinned place sha:<hash> --at … hints; also shown at build start)
${LAYERS_HELP}
${SECRET_HELP}
${godFeature('constitution') ? GOV_HELP + '\n' : ''}learn:  examples [name] · defs <name|core/x@1> (one def in full) · sky (palettes) · a row named stall = the set "stall"`;

const NO_WARM = new Set(['help', 'register', 'mint', 'pair', 'doctor', 'look', 'look-shot', 'look-keeper']);
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('eden-god.mjs')) {
  let line; try { line = enterGodSeat(process.argv.slice(2), COMMANDS); } catch (e) { console.error(e.message); process.exit(2); }
  const [cmd, ...argv] = line; const { flags: f, rest, argv: readAs, notes, hint } = readArgs(cmd, argv);
  const fn = COMMANDS[cmd ?? 'help'];
  if (!fn) { console.error(`unknown command ${cmd}\n${HELP}`); process.exit(2); }

  const t0 = Date.now();
  // optional transcript (blind tests, demos): `"transcript": "<file>"` in .eden-god.json appends every command and answer
  const tr = (() => { try { return load().transcript; } catch { return null; } })();
  // RL6: argv keeps the exact words (a replay cannot recover quoting from the joined cmd).
  const redact = (s) => String(s).replace(/god_[A-Za-z0-9_-]+/g, 'god_…');
  const changed = notes.length > 0;
  const record = (out, error) => { if (!tr || cmd === 'look-shot' || cmd === 'look-keeper') return; try { appendFileSync(tr, JSON.stringify({ at: new Date().toISOString(), cmd: redact([cmd, ...argv].join(' ')), argv: [cmd ?? 'help', ...argv].map(redact), ...(changed ? { readAs: [cmd, ...readAs].map(redact) } : {}), ms: Date.now() - t0, ...(error ? { error } : { out: typeof out === 'string' ? out : JSON.stringify(out).slice(0, 4000) }) }) + '\n'); } catch { /* best effort */ } };
  if (!['look-shot', 'look-keeper'].includes(cmd)) for (const n of notes) console.error(`note: ${n}`);
  if (cmd && f.help !== undefined && !['look-shot', 'look-keeper'].includes(cmd)) { const h = helpFor(cmd); record(h); console.log(h); process.exit(0); }
  if (!['look-shot', 'look-keeper'].includes(cmd)) try { checkArgs(cmd ?? 'help', f, rest); } catch (e) { const msg = `REFUSED by the CLI: ${e.message}${hint && /needs a value|takes a number|cannot read|takes dx,dz|--side is/.test(e.message) ? ` — ${hint}` : ''}`; record(null, msg); console.error(msg); process.exit(2); }
  if (tr && cmd === 'look') try { appendFileSync(tr, JSON.stringify({ at: new Date().toISOString(), cmd: [cmd, ...argv].join(' '), phase: 'start' }) + '\n'); } catch { /* best effort */ }
  // G1: start (or restart) the warm look keeper in the background; status and listen also after a `look --stop`
  if (!NO_WARM.has(cmd ?? 'help')) autoWarm(SELF, { force: ['status', 'listen'].includes(cmd) });
  Promise.resolve(fn(rest, f)).then((out) => { record(out); if (typeof out === 'string') console.log(out); else { console.log(JSON.stringify(out, null, 2)); if (!f.json && out?.[OUTPUT_SUFFIX]) console.error(out[OUTPUT_SUFFIX]); } if (process.env.EDEN_GOD_TIMING) console.error(`(${Date.now() - t0} ms)`); }).catch((e) => { record(null, String(e.message ?? e)); console.error(String(e.message ?? e)); process.exit(1); });
}
export { mirror, view, solve, refPoint, compassKey, COMPASS, mkdirSync };
