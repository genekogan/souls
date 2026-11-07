// Y3 / NT10 slice 1: district plans recorded once, built as chapter builds that close only their own plots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { coreRef } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode, type WorldBuildMessage, type WorldDiffMessage } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { GodLayers } from './layers.ts';
import { inClosure } from './builds.ts';
import { DISTRICT_LIMITS, chapterShape, checkPlan, districtPlanSchema } from './districts.ts';
import { godSchema } from './schema.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** A six-plot street on both sides of one road, in three chapters of two plots (fixtures/district-street.json). */
const streetPlan = () => JSON.parse(readFileSync(new URL('./fixtures/district-street.json', import.meta.url), 'utf8'));
function fixture() {
  const db = new Db(':memory:'), emitted: (WorldDiffMessage | WorldBuildMessage)[] = [];
  let now = 2_000_000;
  const god = new GodMode(db, { worldId: 'district-test', ownerId: 'owner', tick: () => 1, now: () => now, buildPauseMs: 50, buildClosureMs: 500, emit: (m: WorldDiffMessage | WorldBuildMessage) => emitted.push(m) });
  const token = god.mintFor({ id: 'owner', role: 'user' }, 'lead'), other = new GodMode(db, { worldId: 'other-world', ownerId: 'owner', tick: () => 1, emit: () => {} }).mintFor({ id: 'owner', role: 'user' }, 'wrong');
  const app = new Hono();
  mountGodRoutes(app, { god, worldName: 'District test', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'sign in'); }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1', limitIp: () => {} });
  app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code }, e.status as 400) : c.json({ ok: false, internal: String(e) }, 500));
  const req = async (path: string, data?: unknown, auth: string | null = token) => { const r = await app.request(path, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); return { status: r.status, data: await r.json() as any }; };
  const layers = new GodLayers({ get model() { return god.model; }, engine: { world: { tick: 0, entities: {} } }, living: () => null, engineAct: () => ({ accepted: false, failures: [] }) as never, building: id => god.builds.closing(id), closingSites: () => god.builds.closingSites(), log() {} });
  return { db, god, token, other, app, req, emitted, layers, advance: (ms: number) => { now += ms; } };
}
const code = (r: any) => r.failures?.[0]?.code;
const bench = (name: string, x: number, z: number) => ({ op: 'place', def: coreRef('bench'), name, p: [x, z] });
const resident = { soulId: 's_ana', name: 'Ana' } as never;

test('Y3: a district plan is validated with fields, recorded once, replayed, private to god tokens, and advertised', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const plan = streetPlan(), post = (body: unknown) => f.req('/v1/god/districts', body);
  assert.equal(code((await post({ id: 'high', title: 'x' })).data), 'schema');
  // Direct calls: the route's per-token limiter (6 plans a minute) is asserted at the end.
  const caller = f.god.godIdentity(f.token)!, bad = async (mutate: (p: any) => void) => { const p = streetPlan() as any; mutate(p); return { data: f.god.districts.record(p, caller) as any }; };
  let r = (await bad(p => { p.plots[1].id = 'p1'; })).data; assert.equal(code(r), 'district.plan'); assert.equal(r.failures[0].field, 'plots.1.id');
  r = (await bad(p => { p.plots[0].massing[0].at = [6, 0]; })).data; assert.equal(r.failures[0].field, 'plots.0.massing.0'); assert.match(r.failures[0].fix, /plan field/);
  r = (await bad(p => { p.plots[2].at = [-35, -14]; })).data; assert.match(r.failures[0].detail, /p1 and p3 overlap/);
  r = (await bad(p => { p.plots[5].at = [180, 14]; p.chapters = [['p1', 'p6']]; })).data; assert.equal(r.failures[0].field, 'chapters.0'); assert.match(r.failures[0].detail, /spans/);
  r = (await bad(p => { p.chapters = [['p1', 'p9']]; })).data; assert.match(r.failures[0].detail, /unknown plot p9/);
  r = (await bad(p => { p.chapters = [['p1'], ['p1', 'p2']]; })).data; assert.match(r.failures[0].detail, /p1 is in chapters 1 and 2/);
  r = (await bad(p => { p.chapters = [['p3', 'p4'], ['p1', 'p5']]; })).data; assert.equal(r.failures[0].field, 'chapters.1'); assert.match(r.failures[0].detail, /p1,p5 would take a 96×18 m site that covers plot p3, which is not in it/); assert.match(r.failures[0].fix, /separate chapters/);
  r = (await bad(p => { for (const x of p.plots) x.massing = Array.from({ length: 5 }, (_, i) => ({ name: `m${i}`, at: [0, 0], size: [1, 1], h: 3 })); })).data; assert.match(r.failures[0].detail, /10 masses/);
  assert.equal((await f.req('/v1/god/districts')).data.districts.length, 0, 'refusals write nothing');
  const ok = (await post(plan)).data;
  assert.equal(ok.ok, true, JSON.stringify(ok));
  // Each two-sided chapter's rectangle spans the street, so new things placed on that stretch join the chapter: said once, at record time.
  assert.deepEqual(ok.warnings, ['p1,p2', 'p3,p4', 'p5,p6'].map((ids, i) => `chapter ${i + 1} (${ids}) site spans road high: things placed on that road inside the site join the chapter and close with it`));
  assert.deepEqual(ok.district.counts, { plots: 6, built: 0, building: 0, planned: 6 });
  assert.deepEqual(ok.district.next, { action: 'start', id: 'high-1', plots: ['p1', 'p2'] });
  assert.equal((await post(plan)).data.replayed, true);
  assert.equal(code((await post({ ...plan, title: 'Another street' })).data), 'district.exists');
  for (const auth of [null, f.other]) for (const [path, body] of [['/v1/god/districts', undefined], ['/v1/god/districts/high', undefined], ['/v1/god/districts', plan]] as const) assert.equal((await f.req(path, body, auth)).status, 401);
  assert.equal((await f.req('/v1/god/districts/missing')).status, 404);
  const listed = (await f.req('/v1/god/districts')).data.districts; assert.equal(listed[0].id, 'high'); assert.equal(listed[0].counts.planned, 6);
  const schema = godSchema() as any; assert.ok(schema.districts.plan.properties.plots); assert.ok(schema.endpoints.god.includes('POST /v1/god/districts')); assert.ok(schema.refusals.includes('district.plot'));
  const publicData = JSON.stringify([f.god.publicSnapshot(), f.god.builds.publicList(), f.emitted]);
  for (const word of ['six-shop street', 'gentle fall', 'river 40 m', 'Cobbler Lane', 'Bakery']) assert.equal(publicData.includes(word), false, word);
  let limited = false; for (let i = 0; i < 8 && !limited; i++) limited = (await post(plan)).status === 429; assert.ok(limited);
});

test('Y3: plan warnings cover roads, the closure margin and the ground extent without blocking', () => {
  const plan = districtPlanSchema.parse({ ...streetPlan(), plots: [{ id: 'a', at: [0, -6], size: [10, 10], massing: [{ at: [4, 0], size: [2, 2], h: 3 }] }, { id: 'b', at: [10.5, -6], size: [10, 10], massing: [{ at: [-4, 0], size: [2, 2], h: 3 }] }, { id: 'far', at: [5000, 0], size: [10, 10] }], chapters: undefined });
  const fake = { ground: () => ({ extent: [-500, -500, 500, 500] }) } as never;
  const { failures, warnings } = checkPlan(plan, fake, [{ id: 'church', site: { at: [0, -6], size: [4, 4], yaw: 0 } }]);
  assert.deepEqual(failures, []);
  assert.ok(warnings.some(w => /plot a overlaps road high/.test(w))); assert.ok(warnings.some(w => /plots a and b have masses within 1.5 m/.test(w))); assert.ok(warnings.some(w => /far centre is outside the ground/.test(w))); assert.ok(warnings.some(w => /plot a overlaps open build church/.test(w)));
});

test('Y3: chapter shapes keep plot massing in place, including yawed plots', () => {
  const plan = districtPlanSchema.parse(streetPlan()), [p1, p2] = plan.plots;
  const one = chapterShape([p1]); assert.deepEqual(one.site.at, [-40, -14]); assert.deepEqual(one.site.size, [16.02, 18.02]); assert.equal(one.massing[0].name, 'p1-hall');
  const two = chapterShape([p1, p2]); assert.deepEqual(two.site.at, [-40, 0]); assert.deepEqual(two.site.size.map(v => Math.round(v * 100) / 100), [16.02, 46.02]);
  assert.deepEqual(two.massing.map(m => [m.name, m.at.map(v => Math.round(v * 1e6) / 1e6)]), [['p1-hall', [0, -16]], ['p2-hall', [0, 16]]]);
  const turned = chapterShape([{ ...p1, yaw: Math.PI / 2 }, { ...p2, yaw: 0 }]); assert.equal(turned.site.yaw, 0, 'mixed yaw uses world axes');
  assert.ok(Math.abs(turned.massing[0].yaw! - Math.PI / 2) < 1e-9);
});

test('Y3: chapters take site and massing from plots, refuse taken plots, close only their own buildings, and inherit follow-ups', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal((await f.req('/v1/god/districts', streetPlan())).data.ok, true);
  // Refusals use direct calls; the route limits starts to 6 a minute per token.
  const caller = f.god.godIdentity(f.token)!, start = (raw: unknown) => f.god.builds.start(raw, caller) as any;
  assert.equal(code(start({ id: 'x', district: { id: 'missing' } })), 'district.unknown');
  assert.equal(code(start({ id: 'x', district: { id: 'high' }, site: { at: [0, 0], size: [10, 10] } })), 'district.plot');
  assert.equal(code(start({ id: 'x', district: { id: 'high' }, massing: [{ at: [0, 0], size: [2, 2], h: 3 }] })), 'district.plot');
  assert.equal(code(start({ id: 'x', district: { id: 'high', plots: ['p1', 'p1'] } })), 'district.plot');
  assert.equal(code(start({ id: 'x', district: { id: 'high', plots: ['p9'] } })), 'district.plot');
  assert.equal(code(start({ id: 'x', district: { id: 'high', plots: [] } })), 'schema');
  assert.equal(code(start({ id: 'x', district: { id: 'high' }, title: 7 })), 'schema', 'filled values are still validated');
  const input = { id: 'high-1', district: { id: 'high' }, brief: 'Chapter one: bakery and smithy' };
  const s = (await f.req('/v1/god/builds', input)).data;
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.deepEqual(s.build.district, { id: 'high', plots: ['p1', 'p2'] }); assert.equal(s.build.title, 'High Street: Bakery, Smithy'); assert.deepEqual(s.build.plan.steps, ['massing', 'shops', 'details']);
  assert.deepEqual(s.build.site.at, [-40, 0]); assert.deepEqual(s.build.massing.map((m: any) => m.name), ['p1-hall', 'p2-hall']); assert.deepEqual(s.build.roots, [], 'a chapter never adopts earlier roots');
  assert.deepEqual(s.report.district.plots.map((p: any) => p.id), ['p1', 'p2']); assert.deepEqual(s.report.district.frontage[0], { plot: 'p1', road: 'high', gap: 1, side: 'south', frontYaw: 0 });
  assert.deepEqual(s.report.district.neighbours.map((n: any) => n.plot), ['p3', 'p4']);
  assert.deepEqual(s.report.district.warnings, ["this chapter's site spans road high: things placed on that road inside the site join the chapter and close with it"]);
  assert.equal(start(input).replayed, true, 'the expanded start replays');
  const busy = start({ id: 'other', district: { id: 'high', plots: ['p2'] } }); assert.equal(code(busy), 'district.plot'); assert.equal(busy.failures[0].fix, 'build resume high-1');
  const field = { id: 'high-1', lease: s.lease };
  assert.equal(f.god.act({ ops: [bench('bakery-bench', -40, -16), bench('smithy-bench', -40, 16)], build: field }).accepted, true);
  // Once a chapter exists its title (plan and plot titles) is public by design; the plan's brief, terrain, water, road names, plot uses and the chapter brief are not.
  const publicData = JSON.stringify([f.god.publicSnapshot(), f.god.builds.publicList(), f.emitted]);
  assert.ok(publicData.includes('High Street: Bakery, Smithy'));
  for (const word of ['six-shop street', 'gentle fall', 'river 40 m', 'Cobbler Lane', 'Chapter one: bakery and smithy']) assert.equal(publicData.includes(word), false, word);
  const shown = (await f.req('/v1/god/builds/high-1')).data; assert.equal(shown.district.id, 'high'); assert.equal(shown.district.plots.find((p: any) => p.id === 'p1').status, 'building');
  assert.equal(f.layers.refusal(f.god.model.get('bakery-bench')!.id, resident)?.code, 'site.under-construction');
  const done = (await f.req('/v1/god/builds/high-1/done', {})).data; assert.equal(done.ok, true); assert.deepEqual(done.district.next, { action: 'start', id: 'high-2', plots: ['p3', 'p4'] });
  assert.equal(code(start({ id: 'again', district: { id: 'high', plots: ['p1'] } })), 'district.plot');
  // Chapter two is under construction: chapter one stays open to residents (things, seats and walks).
  const two = (await f.req('/v1/god/builds', { id: 'high-2', district: { id: 'high' } })).data; assert.equal(two.ok, true); assert.deepEqual(two.build.district.plots, ['p3', 'p4']);
  assert.equal(two.inventory.things.length, 0); assert.deepEqual(two.report.district.neighbours.find((n: any) => n.plot === 'p1'), { plot: 'p1', status: 'built', chapter: 'high-1' });
  assert.equal(f.god.act({ ops: [bench('inn-bench', 0, -16)], build: { id: 'high-2', lease: two.lease } }).accepted, true);
  const bakery = f.god.model.get('bakery-bench')!.id, inn = f.god.model.get('inn-bench')!.id;
  assert.equal(f.god.builds.closing(bakery), null); assert.equal(f.layers.refusal(bakery, resident), null);
  assert.equal(f.layers.refusal(inn, resident)?.code, 'site.under-construction');
  const walk = (to: [number, number]) => f.layers.constructionRefusal(resident, [{ verb: 'walk_to', params: { to } }]);
  assert.equal(walk([-40, -16]), null); assert.equal(walk([-40, 16]), null); assert.equal(walk([0, -16])?.code, 'site.under-construction');
  assert.equal(f.god.builds.closingSites().every(s => !inClosure(s, [-40, -16])), true);
  // An outside edit from chapter two to a finished plot is the covenant's business, not a silent change.
  assert.equal(code(f.god.act({ ops: [{ op: 'move', id: 'bakery-bench', p: [-41, -16] }], build: { id: 'high-2', lease: two.lease } })), 'build.outside');
  const view = (await f.req('/v1/god/districts/high')).data.district;
  assert.deepEqual(view.counts, { plots: 6, built: 2, building: 2, planned: 2 }); assert.deepEqual(view.next, { action: 'resume', id: 'high-2', plots: ['p3', 'p4'] });
  assert.deepEqual(view.plots.find((p: any) => p.id === 'p1'), { id: 'p1', title: 'Bakery', at: [-40, -14], size: [16, 18], masses: 1, status: 'built', chapter: 'high-1', parts: 1 });
  assert.equal(view.chapters.find((c: any) => c.id === 'high-2').closed, true); assert.equal(view.chapters.find((c: any) => c.id === 'high-1').closed, false);
  // A follow-up chapter on built plots (build continue) inherits the district link and shows up beside them.
  assert.equal((await f.req('/v1/god/builds/high-2/done', {})).data.ok, true);
  const follow = (await f.req('/v1/god/builds', { id: 'high-1-2', root: 'high-1', title: 'Bakery awning', steps: ['awning'], site: s.build.site, brief: 'Add an awning' })).data;
  assert.equal(follow.ok, true, JSON.stringify(follow)); assert.deepEqual(follow.build.district, { id: 'high', plots: ['p1', 'p2'] });
  const after = (await f.req('/v1/god/districts/high')).data.district;
  assert.equal(after.plots.find((p: any) => p.id === 'p1').chapter, 'high-1-2'); assert.equal(after.chapters.find((c: any) => c.id === 'high-1-2').followUpOf, 'high-1');
  assert.deepEqual(after.next, { action: 'resume', id: 'high-1-2', plots: ['p1', 'p2'] });
});

test('Y3: one undo per chapter; abandoned and undone chapters free their plots; the plan survives restart', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal((await f.req('/v1/god/districts', streetPlan())).data.ok, true);
  const leases: Record<string, string> = {};
  for (const [i, xs] of [[1, [-40, -40]], [2, [0, 0]], [3, [40, 40]]] as const) {
    const s = (await f.req('/v1/god/builds', { id: `high-${i}`, district: { id: 'high' } })).data; assert.equal(s.ok, true); leases[i] = s.lease;
    assert.equal(f.god.act({ ops: [bench(`n-${i}`, xs[0], -16)], build: { id: `high-${i}`, lease: s.lease } }).accepted, true);
    assert.equal(f.god.act({ ops: [bench(`s-${i}`, xs[1], 16)], build: { id: `high-${i}`, lease: s.lease } }).accepted, true);
    assert.equal((await f.req(`/v1/god/builds/high-${i}/done`, {})).data.ok, true);
  }
  const names = () => ['n-1', 's-1', 'n-2', 's-2', 'n-3', 's-3'].filter(n => f.god.model.get(n));
  assert.deepEqual(names(), ['n-1', 's-1', 'n-2', 's-2', 'n-3', 's-3']);
  const undo = f.god.undoGroup('high-2'); assert.equal(undo.accepted, true); assert.equal(undo.reverted.length, 2);
  assert.deepEqual(names(), ['n-1', 's-1', 'n-3', 's-3'], 'undoing chapter 2 leaves chapters 1 and 3 intact');
  const restarted = new GodMode(f.db, { worldId: 'district-test', ownerId: 'owner', tick: () => 1, emit() {} });
  const view = restarted.districts.view('high')!;
  assert.deepEqual(view.plots.map(p => p.status), ['built', 'built', 'undone', 'undone', 'built', 'built']); assert.deepEqual(view.next, { action: 'start', id: 'high-4', plots: ['p3', 'p4'] });
  const caller = restarted.godIdentity(f.token)!, rebuilt = restarted.builds.start({ id: 'high-4', district: { id: 'high' } }, caller);
  assert.equal(rebuilt.ok, true); if (!rebuilt.ok) return;
  const abandoned = restarted.builds.abandon('high-4', {}, () => ({ accepted: true, reverted: [], notReverted: [] })); assert.equal(abandoned.ok, true);
  assert.deepEqual(restarted.districts.view('high')!.next, { action: 'start', id: 'high-5', plots: ['p3', 'p4'] });
  assert.equal(restarted.undoGroup('high-1').accepted, true); assert.equal(restarted.undoGroup('high-3').accepted, true);
  assert.equal(restarted.model.get('n-1'), undefined); assert.equal(restarted.model.get('s-3'), undefined);
  assert.equal(restarted.districts.view('high')!.counts.built, 0);
});

test('Y3: without plan chapters each plot is its own chapter, in plan order; unnamed plots follow the named chapters', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const caller = f.god.godIdentity(f.token)!, { chapters: _chapters, ...plain } = streetPlan();
  assert.equal(f.god.districts.record({ ...plain, id: 'solo' }, caller).ok, true);
  assert.deepEqual(f.god.districts.view('solo')!.next, { action: 'start', id: 'solo-1', plots: ['p1'] });
  const one = f.god.builds.start({ id: 'solo-1', district: { id: 'solo' } }, caller) as any; assert.deepEqual(one.build.district.plots, ['p1']); assert.equal(one.build.title, 'High Street: Bakery');
  assert.equal(f.god.districts.record({ ...plain, id: 'mixed', plots: plain.plots.map((p: any) => ({ ...p, at: [p.at[0], p.at[1] + 300] })), chapters: [['p4', 'p3']] }, caller).ok, true);
  assert.deepEqual(f.god.districts.view('mixed')!.next!.plots, ['p4', 'p3']);
  const mixed = f.god.builds.start({ id: 'mixed-1', district: { id: 'mixed' } }, caller) as any; assert.equal(mixed.ok, true, JSON.stringify(mixed));
  assert.deepEqual(f.god.districts.view('mixed')!.next, { action: 'resume', id: 'mixed-1', plots: ['p4', 'p3'] });
  assert.equal(f.god.act({ ops: [bench('mixed-bench', 0, 284), bench('mixed-bench-2', 0, 316)], build: { id: 'mixed-1', lease: mixed.lease } }).accepted, true);
  assert.equal(f.god.builds.done('mixed-1', {}, caller).ok, true); assert.deepEqual(f.god.districts.view('mixed')!.next!.plots, ['p1'], 'after the named chapter, unnamed plots follow in plan order');
});

test('Y3: abandoning a chapter without --undo keeps the plots its parts stand on; a closed chapter counts each plot by its own parts', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal((await f.req('/v1/god/districts', streetPlan())).data.ok, true);
  const caller = f.god.godIdentity(f.token)!, start = (raw: unknown) => f.god.builds.start(raw, caller) as any;
  const s = (await f.req('/v1/god/builds', { id: 'high-1', district: { id: 'high' } })).data; assert.equal(s.ok, true);
  assert.equal(f.god.act({ ops: [bench('bakery-bench', -40, -16)], build: { id: 'high-1', lease: s.lease } }).accepted, true);
  // The CLI default: `build abandon` without --undo leaves the chapter's entities standing.
  const abandoned = (await f.req('/v1/god/builds/high-1/abandon', {})).data; assert.equal(abandoned.ok, true, JSON.stringify(abandoned)); assert.equal(abandoned.build.status, 'abandoned');
  const benchId = f.god.model.get('bakery-bench')!.id;
  const view = f.god.districts.view('high')!, plot = (id: string) => view.plots.find(p => p.id === id)!;
  assert.deepEqual([plot('p1').status, plot('p1').chapter, plot('p1').parts], ['built', 'high-1', 1], 'the bench still stands on p1');
  assert.deepEqual([plot('p2').status, plot('p2').parts], ['undone', 0], 'nothing of high-1 stands on p2, so it is free again');
  assert.deepEqual(view.next, { action: 'start', id: 'high-2', plots: ['p2'] });
  const refused = start({ id: 'high-2', district: { id: 'high', plots: ['p1'] } });
  assert.equal(code(refused), 'district.plot'); assert.match(refused.failures[0].detail, /Plot p1 is built by high-1 \(1 part standing\)/); assert.match(refused.failures[0].fix, /undo --group high-1/);
  const two = start({ id: 'high-2', district: { id: 'high' } }); assert.equal(two.ok, true, JSON.stringify(two)); assert.deepEqual(two.build.district.plots, ['p2']);
  assert.equal(two.inventory.things.some((x: any) => x.id === benchId), false, 'the next chapter does not take in the leftover bench');
  assert.equal(f.god.builds.closing(benchId), null); assert.equal(f.layers.refusal(benchId, resident), null);
  // Undoing the abandoned chapter frees p1 again.
  assert.equal(f.god.builds.done('high-2', {}, caller).ok, true); assert.equal(f.god.undoGroup('high-1').accepted, true);
  assert.equal(f.god.districts.view('high')!.plots[0].status, 'undone');
});

test('Y3: closed chapters outlive the retention prune of build rows through a bounded private ledger', { timeout: 60_000 }, async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal((await f.req('/v1/god/districts', streetPlan())).data.ok, true);
  const caller = f.god.godIdentity(f.token)!, start = (raw: unknown) => f.god.builds.start(raw, caller) as any;
  const s = start({ id: 'high-1', district: { id: 'high', plots: ['p1'] } }); assert.equal(s.ok, true);
  assert.equal(f.god.act({ ops: [bench('bakery-bench', -40, -16)], build: { id: 'high-1', lease: s.lease } }).accepted, true);
  assert.equal(f.god.builds.done('high-1', {}, caller).ok, true);
  // 205 short chapters on p3 push high-1 out of the 200 retained closed build rows.
  for (let i = 0; i < 205; i++) {
    assert.equal(start({ id: `c-${i}`, district: { id: 'high', plots: ['p3'] } }).ok, true, `c-${i}`);
    assert.equal(f.god.builds.abandon(`c-${i}`, {}, () => ({ accepted: true, reverted: [], notReverted: [] })).ok, true);
  }
  assert.equal(f.god.store.build('high-1'), null, 'the retention prune dropped high-1\'s build row');
  const ledger = () => f.db.db.prepare("SELECT chapter FROM god_district_chapters_v1 WHERE world_id='district-test' AND district='high' ORDER BY created_at, chapter").all().map((r: any) => r.chapter);
  assert.equal(ledger().length, DISTRICT_LIMITS.ledgerPerDistrict, 'the ledger is bounded per district'); assert.ok(ledger().includes('high-1'), 'each plot keeps its newest chapter');
  for (const god of [f.god, new GodMode(f.db, { worldId: 'district-test', ownerId: 'owner', tick: () => 1, emit() {} })]) {
    const view = god.districts.view('high')!, p1 = view.plots.find(p => p.id === 'p1')!;
    assert.deepEqual([p1.status, p1.chapter, p1.parts], ['built', 'high-1', 1], 'p1 stays built by high-1 (also after a restart)');
    assert.equal(view.chapters.find(c => c.id === 'high-1')?.status, 'done');
    assert.deepEqual(view.next, { action: 'start', id: 'high-2', plots: ['p2'] }, 'next never offers the built plot');
  }
  assert.equal(code(start({ id: 'again', district: { id: 'high', plots: ['p1'] } })), 'district.plot');
  assert.equal(code(start({ id: 'high-1', district: { id: 'high', plots: ['p2'] } })), 'district.plot', 'a pruned chapter id is not reused');
  // A close whose notice was lost (a stop in between) is copied at the next start.
  f.db.db.prepare("DELETE FROM god_district_chapters_v1 WHERE world_id='district-test' AND chapter='c-204'").run();
  new GodMode(f.db, { worldId: 'district-test', ownerId: 'owner', tick: () => 1, emit() {} }); assert.ok(ledger().includes('c-204'));
});

test('Y3: a chapter of plots that are not next to each other is refused; a next remainder that would cover a taken plot starts one plot at a time', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const caller = f.god.godIdentity(f.token)!, start = (raw: unknown) => f.god.builds.start(raw, caller) as any;
  // One chapter per side of the street: neither rectangle spans the road or the other side.
  const recorded = f.god.districts.record({ ...streetPlan(), id: 'sides', chapters: [['p1', 'p3', 'p5'], ['p2', 'p4', 'p6']] }, caller) as any;
  assert.equal(recorded.ok, true, JSON.stringify(recorded)); assert.deepEqual(recorded.warnings, []);
  const apart = start({ id: 'x', district: { id: 'sides', plots: ['p3', 'p6'] } });
  assert.equal(code(apart), 'district.plot'); assert.equal(apart.failures[0].field, 'district.plots'); assert.match(apart.failures[0].detail, /covers plots p4,p5, which are not in it/); assert.match(apart.failures[0].fix, /--plots p3, then --plots p6/);
  const mid = start({ id: 'mid', district: { id: 'sides', plots: ['p3'] } }); assert.equal(mid.ok, true);
  assert.equal(f.god.act({ ops: [bench('inn-bench', 0, -16)], build: { id: 'mid', lease: mid.lease } }).accepted, true);
  assert.equal(f.god.builds.done('mid', {}, caller).ok, true);
  const next = f.god.districts.view('sides')!.next!; assert.deepEqual(next, { action: 'start', id: 'sides-1', plots: ['p1'] }, 'p1,p5 would cover the finished p3');
  const first = start({ id: next.id, district: { id: 'sides' } }); assert.equal(first.ok, true, JSON.stringify(first)); assert.deepEqual(first.build.district.plots, ['p1']);
  assert.equal(f.god.builds.closing(f.god.model.get('inn-bench')!.id), null);
});

test('Y3: a district is deleted only with no open chapter; buildings and chapter builds stay, the quota slot frees and a reused id starts clean', async t => {
  const f = fixture(); t.after(() => f.db.close());
  assert.equal((await f.req('/v1/god/districts', streetPlan())).data.ok, true);
  const del = async (id: string, auth: string | null = f.token) => { const r = await f.app.request(`/v1/god/districts/${id}`, { method: 'DELETE', headers: auth ? { authorization: `Bearer ${auth}` } : {} }); return { status: r.status, data: await r.json() as any }; };
  const s = (await f.req('/v1/god/builds', { id: 'high-1', district: { id: 'high' } })).data; assert.equal(s.ok, true);
  assert.equal(f.god.act({ ops: [bench('bakery-bench', -40, -16)], build: { id: 'high-1', lease: s.lease } }).accepted, true);
  assert.equal((await del('high', null)).status, 401); assert.equal((await del('high', f.other)).status, 401); assert.equal((await del('missing')).status, 404);
  const busy = (await del('high')).data; assert.equal(code(busy), 'district.open'); assert.match(busy.failures[0].fix, /build resume high-1/);
  assert.equal((await f.req('/v1/god/builds/high-1/done', {})).data.ok, true);
  const gone = (await del('high')).data; assert.deepEqual(gone, { ok: true, deleted: 'high', chapters: ['high-1'] });
  assert.equal((await f.req('/v1/god/districts/high')).status, 404); assert.deepEqual((await f.req('/v1/god/districts')).data.districts, []);
  assert.ok(f.god.model.get('bakery-bench')); assert.equal(f.god.store.build('high-1')?.status, 'done');
  assert.equal((f.db.db.prepare("SELECT count(*) AS n FROM god_district_chapters_v1 WHERE district='high'").get() as any).n, 0);
  // A new plan under the same id does not inherit the old chapters.
  f.advance(1000);
  const caller = f.god.godIdentity(f.token)!, again = f.god.districts.record({ ...streetPlan(), title: 'High Street again' }, caller) as any;
  assert.equal(again.ok, true, JSON.stringify(again)); assert.deepEqual(again.district.chapters, []);
  assert.deepEqual(again.district.next, { action: 'start', id: 'high-2', plots: ['p1', 'p2'] }, 'the fresh id skips the old chapter');
  // The per-world quota counts recorded plans, and a delete frees a slot.
  for (let i = 1; i < DISTRICT_LIMITS.districts; i++) assert.equal(f.god.districts.record({ id: `d${i}`, title: `D${i}`, plots: [{ id: 'a', at: [i * 30, 200], size: [10, 10] }] }, caller).ok, true);
  const full = f.god.districts.record({ id: 'd99', title: 'One too many', plots: [{ id: 'a', at: [0, 300], size: [10, 10] }] }, caller) as any;
  assert.equal(code(full), 'district.limit'); assert.match(full.failures[0].fix, /--delete/);
  assert.equal(f.god.districts.remove('d1')?.ok, true); assert.equal(f.god.districts.record({ id: 'd99', title: 'Now it fits', plots: [{ id: 'a', at: [0, 300], size: [10, 10] }] }, caller).ok, true);
});

test('Y3: frontage measures the plot rectangle to the road carriageway, including yawed plots and road ends', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const caller = f.god.godIdentity(f.token)!;
  // long: yaw π/2 turns its 4×30 m into 30 m along x (x 5..35, z -8..-4), beside the end of the lane (x ≤ 0, z -4..4): 5 m apart.
  // turned: a 10 m square at 45° below the lane; its nearest corner is 5√2 m from the centre, so the gap is 14 − 7.07 − 4 = 2.93 m.
  const plan = { id: 'yaw', title: 'Yawed', roads: [{ id: 'lane', path: [[-60, 0], [0, 0]], width: 8 }], plots: [{ id: 'long', at: [20, -6], size: [4, 30], yaw: Math.PI / 2 }, { id: 'turned', at: [-30, -14], size: [10, 10], yaw: Math.PI / 4 }] };
  assert.equal(f.god.districts.record(plan, caller).ok, true);
  const report = f.god.districts.report({ id: 'yaw-1', site: { at: [0, -10], size: [80, 20], yaw: 0 }, district: { id: 'yaw', plots: ['long', 'turned'] } })!;
  assert.deepEqual(report.frontage, [{ plot: 'long', road: 'lane', gap: 5, side: 'west', frontYaw: -1.279 }, { plot: 'turned', road: 'lane', gap: 2.9, side: 'south', frontYaw: 0 }]);
});

test('Y3: the schema says what a chapter request is; the district view trims chapter briefs and drops them beside one chapter', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const schema = godSchema() as any;
  assert.match(schema.builds.start.properties.district.description, /send only \{id, district: \{id, plots\?\}\}.*server fills site, massing, title and steps/);
  assert.match(schema.districts.request, /omit site, massing and root/); assert.ok(schema.endpoints.god.includes('DELETE /v1/god/districts/:id')); assert.ok(schema.refusals.includes('district.open'));
  assert.equal((await f.req('/v1/god/districts', streetPlan())).data.ok, true);
  const long = 'Owner words: '.padEnd(600, 'x');
  const s = (await f.req('/v1/god/builds', { id: 'high-1', district: { id: 'high' }, brief: long })).data; assert.equal(s.ok, true);
  const full = (await f.req('/v1/god/districts/high')).data.district.chapters[0].brief; assert.equal(full.length, 140); assert.ok(full.endsWith('…'));
  const shown = (await f.req('/v1/god/builds/high-1')).data; assert.equal(shown.build.plan.brief, long, 'build show keeps the full brief');
  assert.equal(shown.district.chapters[0].brief, undefined, 'the view beside a chapter carries no chapter briefs');
});
