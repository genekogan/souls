// #430 (W054): pavement chalk on the painting faculty with data only. Real native-engine activity/receipt path, fake
// brain, no HTTP listener or renderer: plain words, completion credit, fading by the world day, refusals, interruption,
// drawing over, persistence and the long tail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Hono } from 'hono';
import { coreRef, WorldModel } from '@sim/world-compiler';
import { fixture, invite, accept, factory } from '../test/native-owner-fixture.ts';
import { EdgeLedger } from './edge/ledger/ledger.ts';
import { mountEdgeRoutes } from './edge/routes.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';
import { worldDay } from './god/poster-boards.ts';
import { createPaintingService } from './art/painting-completion.ts';
import { planHang } from './art/art.ts';
import { resolveCapability } from './edge/ledger/vocabulary.ts';

const sun = { title: 'Sun', background: '#bdb8ad', shapes: [{ kind: 'ellipse', cx: 0.5, cy: 0.45, rx: 0.2, ry: 0.2, colour: '#ffd23f' }, { kind: 'line', x1: 0.2, y1: 0.85, x2: 0.8, y2: 0.85, width: 0.03, colour: '#ffffff' }] };
const boat = { title: 'Boat', background: '#bdb8ad', shapes: [{ kind: 'rect', x: 0.25, y: 0.55, width: 0.5, height: 0.12, colour: '#3a7bd5' }] };
const out = process.env.SOUL_ACTIONS_OUT;

test('chalk: draw on a chalk square by plain words, credited at completion, fading over world days; refusals, drawing over, persistence, long tail', { timeout: 300000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'chalk-native-')), f = fixture(':memory:', factory, { durableClockV1: true }); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, { ambient: false }); const app = new Hono(); let soul: { soulId: string; entityId: string; name: string; owner: string };
  const comms = mountEdgeRoutes(app, { host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul } as never);
  t.after(() => { comms.close(); f.host.stop(); f.db.close(); rmSync(dir, { recursive: true, force: true }); });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {}, assetDir: dir });
  installEngineBridge({ host: f.host, god, edge, log: () => {}, worldLore: false, worldClock: false });
  edge.painting = createPaintingService({ model: () => god.model, dir, basePath: '/w/fixture', worldId: f.host.worldId, commit: (ops, note, done, durable) => god.engineAct(ops, note, done, durable) });
  const tick = async (n = 5) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await tick();
  // a short world day (1500 ticks; the drying test uses 200), starting on day 10; days pass by ticking, never by setting the day
  const DAY = 1500, living0 = (f.host as unknown as { living?: object }).living ?? {};
  Object.defineProperty(f.host, 'living', { configurable: true, value: { ...living0, origin: f.host.engine.world.tick - 10 * DAY - 20, dayTicks: DAY } });
  const toDay = async (d: number) => { while (worldDay() < d) { for (let i = 0; i < 100; i++) f.host.tickOnce(); await tick(1); } await tick(10); assert.equal(worldDay(), d); };
  const join_ = async (id: string, name: string) => { await invite(f, id); const row = await accept(f.host, f.souls.create('dev:' + id, { name, description: 'Chalk test' })); await tick(); return { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner }; };
  const ana = await join_('ana', 'Ana'), ben = await join_('ben', 'Ben'); soul = ana;
  const here = async (s: typeof ana) => { soul = s; const r = await app.request('/v1/edge/here?include=doHere'); assert.equal(r.status, 200); return (await r.json()).here; };
  const body = (s: typeof ana) => f.host.engine.world.entities[s.entityId] as { pose: { p: number[] } };
  const absent = await here(ana);
  // C9: 100 drawn chalk squares 120 m away add nothing
  const distant = Array.from({ length: 100 }, (_, i) => ({ op: 'place', def: coreRef('chalk-square', 1), name: `distant-chalk-${i}`, p: [120 + i % 10 * 3, 120 + Math.floor(i / 10) * 3], state: { media: '/w/fixture/art/' + 'a'.repeat(64) + '.png', title: 'secret drawing', maker: 'soul:s_z:Zed', day: 10 } }));
  assert.equal(god.act({ ops: distant as never }).accepted, true); await tick(45);
  const far = await here(ana); assert.ok(!/secret|distant-|Zed/.test(JSON.stringify(far)), 'distant squares add nothing to here');
  const farIds = new Set(distant.map(d => god.model.get(d.name)!.id));
  assert.deepEqual(edge.capabilities(ana).filter(c => [...farIds].some(id => c.id.includes(id))).map(c => c.id), [], 'no distant chalk offers');
  // the clock fields, and the doHere byte budget left after them (it moved by 2 bytes between frames hours apart), are not the squares'
  const strip = (h: Record<string, unknown>) => JSON.stringify({ ...h, tick: 0, now: '', clock: '', light: '', day: '', doHereCoverage: { ...(h.doHereCoverage as object), byteBudget: 0 } });
  assert.equal(strip(far), strip(absent), 'the here frame with 100 distant squares is the absent one apart from its tick and clock');
  const [ax, az] = [body(ana).pose.p[0], body(ana).pose.p[2]];
  assert.equal(god.act({ ops: [{ op: 'place', def: coreRef('chalk-square', 1), name: 'chalk-square', p: [ax + 0.5, az + 3] }, { op: 'place', def: coreRef('easel', 2), name: 'easel', p: [ax - 3, az + 2] }] as never }).accepted, true); await tick(45);
  const sq = god.model.get('chalk-square')!.id, easel = god.model.get('easel')!.id, state = () => ({ ...god.model.entities.get(sq)!.state });
  const near = await here(ana);
  // C2: the offer is the painting faculty's, worded and posed for the ground; the easel's is unchanged
  const caps = edge.capabilities(ana), chalk = caps.find(c => c.id === `paint:paint.${sq}`)!, paint = caps.find(c => c.id === `paint:paint.${easel}`)!;
  assert.ok(chalk?.available, JSON.stringify(caps.filter(c => c.verb === 'paint')));
  assert.match(chalk.label, /^Draw in chalk/); assert.match((chalk.params!.painting as { description: string }).description, /chalk drawing on the ground.*fades over 4 world days/);
  assert.match(paint.label, /^Paint at the easel/); assert.match((paint.params!.painting as { description: string }).description, /^Optional lasting painting/);
  const wait = async (s: typeof ana, id: string) => { for (let i = 0; i < 3000; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); } const r = edge.receipt(s.soulId, id)!; if (!['waiting', 'started'].includes(r.phase)) return r; } assert.fail('chalk did not finish within bounded native ticks'); };
  const act = async (s: typeof ana, capability: string, params?: Record<string, unknown>) => { soul = s; return await accept(f.host, edge.act(s, { capability, ...(params ? { params } : {}) })) as { accepted: boolean; code?: string; reason?: string; receipt: { id: string } }; };
  const results: Record<string, unknown> = {};
  // C5: an invalid drawing is refused at admission with the painting limits
  const bad = await act(ana, chalk.id, { painting: { ...sun, shapes: [{ kind: 'star', colour: '#ffffff' }] } }); assert.equal(bad.accepted, false); assert.equal(bad.code, 'painting.invalid', JSON.stringify(bad)); results.invalid = bad.reason;
  // C6: interrupted before completion changes nothing
  { const cut = await act(ana, chalk.id, { seconds: 5, painting: sun }); assert.equal(cut.accepted, true, JSON.stringify(cut)); await tick(30); await act(ana, 'stand:here'); await tick(60);
    assert.equal(state().media, '', 'interrupted: the square stays blank'); assert.ok(['replaced', 'cancelled', 'failed'].includes(edge.receipt(ana.soulId, cut.receipt.id)!.phase)); results.interrupted = edge.receipt(ana.soulId, cut.receipt.id)!.phase; }
  // C1: plain words; the Soul stoops over the square; the drawing appears at completion with her credit
  const a = await act(ana, 'draw in chalk', { seconds: 5, painting: sun }); assert.equal(a.accepted, true, JSON.stringify(a));
  const ar = edge.receipt(ana.soulId, a.receipt.id)!; assert.equal(ar.capability, chalk.id, 'plain words chose the chalk square, not the easel');
  let posed = false; for (let i = 0; i < 3000 && ['waiting', 'started'].includes(edge.receipt(ana.soulId, a.receipt.id)!.phase); i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); } const h = (f.host.engine.world.entities[ana.entityId] as { human?: { activity?: string } }).human; if (h?.activity === 'chalk') { posed = true; assert.equal(state().media, '', 'nothing before completion'); } }
  const done = edge.receipt(ana.soulId, a.receipt.id)!; assert.equal(done.phase, 'completed', JSON.stringify(done)); assert.ok(posed, 'the body took the chalk pose');
  const s1 = state(); assert.equal(s1.title, 'Sun'); assert.equal(s1.maker, `soul:${encodeURIComponent(ana.soulId)}:Ana`); assert.match(s1.media as string, /\/art\/[0-9a-f]{64}\.png$/); assert.equal(s1.day, 10, 'the drawn world day');
  assert.equal(done.outcome!.produced[0].kind, 'painting'); results.ana = { capability: ar.capability, state: s1 };
  // C4: perceived from the drawn day, recipe never; C3: it fades by the world day (the bridge's day pass refreshes the line)
  const lineOf = async (s: typeof ana) => { await tick(40); const fr = await here(s), o = (fr.objects as { id: string; what?: string }[]).find(x => x.id === sq); assert.ok(o, 'the square is in the nearby frame'); assert.ok(!/ellipse|ffd23f|shapes|3a7bd5/.test(JSON.stringify(fr)), 'the recipe is never perception'); return o!.what ?? null; };
  // the line, then the square's own place words (", by easel")
  const is = (line: string | null, expected: string) => { assert.ok(line === expected || !!line?.startsWith(expected + ', by '), `${line} / ${expected}`); assert.ok(!line!.slice(expected.length).includes('fading') && !line!.slice(expected.length).includes('washed')); };
  const lines: Record<string, string | null> = {};
  lines.day10 = await lineOf(ben); is(lines.day10, 'Ana’s chalk drawing “Sun” on the pavement');
  await toDay(11); lines.day11 = await lineOf(ben); is(lines.day11, 'Ana’s chalk drawing “Sun” on the pavement, fading');
  // C7: drawing over replaces it, credited to the new Soul, drawn today; the old one is in the edit's note
  // her body stands on its only drawing spot: Ben's plain words are refused. With the easel free nearby it is not chosen
  // instead (a generic no-match); with no free paint offer in reach the refusal names the square in chalk's own words
  { const busy = await act(ben, 'draw in chalk', { seconds: 5, painting: boat }); assert.equal(busy.accepted, false, JSON.stringify(busy)); assert.match(busy.reason ?? '', /^Nothing offered matches "draw in chalk"/); results.busyEaselNear = busy.reason; }
  assert.equal(god.act({ ops: [{ op: 'move', id: easel, p: [ax + 60, az + 2] }] as never }).accepted, true); await tick(45);
  { const busy = await act(ben, 'draw in chalk', { seconds: 5, painting: boat }); assert.equal(busy.accepted, false, JSON.stringify(busy)); assert.match(busy.reason ?? '', /^Draw in chalk is not free right now: the nearest, .*is in use by someone/, JSON.stringify(busy)); results.busy = busy.reason; }
  assert.equal(god.act({ ops: [{ op: 'move', id: easel, p: [ax - 3, az + 2] }] as never }).accepted, true); await tick(45);
  // Ana steps away from the square first (her body stands on its only drawing spot)
  { const w = await act(ana, 'walk:easel'); assert.equal(w.accepted, true, JSON.stringify(w)); assert.equal((await wait(ana, w.receipt.id)).phase, 'completed'); }
  const b = await act(ben, chalk.id, { seconds: 5, painting: boat }); assert.equal(b.accepted, true, JSON.stringify(b)); const bd = await wait(ben, b.receipt.id); assert.equal(bd.phase, 'completed', JSON.stringify(bd));
  const s2 = state(); assert.equal(s2.title, 'Boat'); assert.equal(s2.maker, `soul:${encodeURIComponent(ben.soulId)}:Ben`); assert.equal(s2.day, worldDay()); assert.notEqual(s2.media, s1.media);
  const note = (f.db.db.prepare("SELECT note FROM world_edits_v1 WHERE note LIKE 'painting/1 %' ORDER BY seq DESC LIMIT 1").get() as { note: string } | undefined)?.note ?? '';
  assert.match(note, /"previous":\{"media":"[^"]+","title":"Sun","maker":"soul:[^"]+:Ana","day":10\}/); results.ben = s2;
  const drawn = s2.day as number; await tick(10);
  lines.boat0 = await lineOf(ana); is(lines.boat0, 'Ben’s chalk drawing “Boat” on the pavement');
  await toDay(drawn + 2); lines.boat2 = await lineOf(ana); is(lines.boat2, 'Ben’s chalk drawing “Boat” on the pavement, fading');
  await toDay(drawn + 3); lines.boat3 = await lineOf(ana); is(lines.boat3, 'Ben’s chalk drawing “Boat” on the pavement, nearly washed away');
  // a clock that jumps (a catch-up after nobody was in the world) and one set back: the line follows the world day either way
  const living = (f.host as unknown as { living: { origin: number; dayTicks: number } }).living, shift = (days: number) => Object.defineProperty(f.host, 'living', { configurable: true, value: { ...living, origin: (f.host as unknown as { living: { origin: number } }).living.origin - days * DAY } });
  shift(3); await tick(30); assert.equal(worldDay(), drawn + 6); lines.jump6 = await lineOf(ana); assert.equal(lines.jump6, null, 'a three-day jump past the fade: washed away');
  shift(-4); await tick(30); assert.equal(worldDay(), drawn + 2); lines.back2 = await lineOf(ana); is(lines.back2, 'Ben’s chalk drawing “Boat” on the pavement, fading');
  await toDay(drawn + 4); lines.boat4 = await lineOf(ana); assert.equal(lines.boat4, null, 'washed away: no drawing line, the square still there');
  assert.equal(state().media, s2.media, 'washing away writes nothing: the state keeps the drawing and its day'); results.lines = lines;
  // C5: out of reach publishes nothing; the drawing param elsewhere is refused
  const elsewhere = caps.find(c => c.verb !== 'paint' && c.available && c.id !== 'stand:here' && /^(read|sit|lie|nap|stretch):/.test(c.id));
  assert.ok(elsewhere, 'an unrelated offer to try the drawing on'); { const r = await act(ana, elsewhere!.id, { painting: sun }); assert.equal(r.accepted, false); assert.equal(r.code, 'painting.no-easel', JSON.stringify(r)); results.elsewhere = r.code; }
  // the public hang route cannot put an image on a chalk square; the world's creator may still clear one
  const hung = planHang(god.model, { kind: 'soul', id: ana.soulId, name: 'Ana' }, { frame: sq, media: 'https://example.com/photo.png' }) as { ok: boolean; code?: string };
  assert.equal(hung.ok, false); assert.equal(hung.code, 'art.drawn-only'); results.hang = hung.code;
  assert.equal(planHang(god.model, { kind: 'creator', owner: 'dev:admin' }, { frame: sq, media: null }).ok, true, 'the creator can clear a drawing');
  const svc = edge.painting!; const intent = svc.prepare(ana, sq, sun);
  assert.ok(!('ok' in intent), JSON.stringify(intent));
  const p = god.model.worldPose(god.model.entities.get(sq)!);
  assert.equal((svc.reached(intent as never, { position: [p.x + 0.9, p.y, p.z], level: 0, scale: 1 }) as unknown), null, 'beside the square, on its ground: reached');
  assert.equal((svc.reached(intent as never, { position: [p.x + 0.9, p.y + 1.2, p.z], level: 0, scale: 1 }) as { code: string }).code, 'painting.not-reached', 'standing a level above it: not reached');
  assert.equal((svc.reached(intent as never, { position: [p.x + 3, p.y, p.z], level: 0, scale: 1 }) as { code: string }).code, 'painting.not-reached', '3 m away: not reached');
  // C8: persistence
  const restored = WorldModel.fromSnapshot(JSON.parse(JSON.stringify(god.model.snapshot())), undefined, god.model.library);
  for (const k of ['media', 'title', 'maker', 'day']) assert.equal(restored.get('chalk-square')!.state![k], s2[k]);
  assert.deepEqual(f.host.engine.runtime.violations, []);
  assert.equal(readdirSync(dir).filter(x => x.endsWith('.png')).length, 2, 'two drawings, two PNGs');
  const nearFinal = await here(ana);
  const report = { status: 'pass', hereBytes: { absent: JSON.stringify(absent).length, distant100: JSON.stringify(far).length, nearbyBlank: JSON.stringify(near).length, nearbyDrawn: JSON.stringify(nearFinal).length }, results };
  if (out) { mkdirSync(out, { recursive: true }); writeFileSync(`${out}/chalk-summary.json`, JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify(report.hereBytes));
});

// #430 review of the 2×2: a taken chalk square is refused in chalk's own words, not as "Paint at the easel"
test('chalk: a taken square is refused as "Draw in chalk is not free right now"', () => {
  const ctx = { caps: [], places: [], root: ['w'], me: [0, 0] as [number, number], target: () => ({ names: [], around: [], at: [0, 0] as [number, number] }),
    elsewhere: (v: string) => v === 'paint' ? { label: 'Chalk square', title: 'Draw in chalk', place: 'Green field', distance: 4.6 } : undefined };
  const r = resolveCapability('draw in chalk', ctx as never);
  assert.equal(r.kind, 'unknown'); if (r.kind === 'unknown') assert.match(r.reason, /^Draw in chalk is not free right now: the nearest, Chalk square in Green field \(about 5 m away\), is in use by someone/);
  const easel = resolveCapability('paint at the easel', { ...ctx, elsewhere: (v: string) => v === 'paint' ? { label: 'Easel', distance: 3 } : undefined } as never);
  assert.equal(easel.kind, 'unknown'); if (easel.kind === 'unknown') assert.match(easel.reason, /^Paint at the easel is not free right now/);
});
