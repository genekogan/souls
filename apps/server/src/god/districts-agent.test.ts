// Y3 acceptance: a scripted fake agent plans a 6-plot street and builds it across 3 chapters in 3 sessions through the
// real CLI (in-process: fetch is routed to this Hono app; no listener, no network). Each session is a fresh folder and
// token, the server restarts between sessions, residents keep using finished plots, and each chapter undoes as one group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { coreRef } from '@souls/world-compiler';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { GodLayers } from './layers.ts';
// @ts-ignore -- the plain-JS CLI under test has no declaration file
import { COMMANDS, checkArgs, parseFlags } from '../../../../tools/god-skill/cli.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('Y3 acceptance: a fake agent plans a 6-plot street and builds it in 3 chapters across 3 sessions and restarts', { timeout: 120_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'y3-street-')), file = join(root, 'sim.db'), cwd = process.cwd(), originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; process.chdir(cwd); rmSync(root, { recursive: true, force: true }); });
  let now = 5_000_000, requests: string[] = [], holder = '';
  const open = () => {
    const db = new Db(file), god = new GodMode(db, { worldId: 'street', ownerId: 'owner', tick: () => 1, now: () => now, buildPauseMs: 60_000, buildClosureMs: 600_000, emit: () => {} });
    const app = new Hono();
    mountGodRoutes(app, { god, worldName: 'Street', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'sign in'); }, soulFromBearer: () => null, baseOf: () => 'http://street.test', limitIp: () => {} });
    app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code }, e.status as 400) : c.json({ ok: false, internal: String(e) }, 500));
    // The resident side of closure, exactly as the engine bridge wires it.
    const layers = new GodLayers({ get model() { return god.model; }, engine: { world: { tick: 0, entities: {} } }, living: () => null, engineAct: () => ({ accepted: false, failures: [] }) as never, building: id => god.builds.closing(id), closingSites: () => god.builds.closingSites(), log() {} });
    return { db, god, app, layers };
  };
  let server = open();
  const restart = (gapMs: number) => { server.db.close(); now += gapMs; server = open(); };
  globalThis.fetch = (async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
    const path = String(url).replace('http://street.test', ''); requests.push(`${init.method} ${path.split('?')[0]}`);
    return server.app.request(path, { ...init, headers: { ...init.headers, 'x-eden-god-holder': holder } });
  }) as typeof fetch;
  // A fresh agent: new folder (no local state), new token, its own process identity.
  const session = (n: number) => {
    const dir = mkdtempSync(join(root, `agent-${n}-`)); process.chdir(dir);
    writeFileSync('.eden-god.json', JSON.stringify({ world: 'http://street.test', token: server.god.mintFor({ id: 'owner', role: 'user' }, `agent-${n}`) }));
    holder = JSON.stringify({ pid: process.pid, host: `agent-host-${n}`, start: `session-${n}`, label: 'eden-god CLI' });
  };
  const cli = async (...argv: string[]) => {
    const [cmd, ...rest] = argv, { flags, rest: words } = parseFlags(rest); checkArgs(cmd, flags, words);
    requests = []; const out = await COMMANDS[cmd](words, flags), text = typeof out === 'string' ? out : JSON.stringify(out);
    if (process.env.Y3_TRANSCRIPT) console.log(`$ eden-god ${argv.join(' ')}   [${requests.length} request(s)]\n${text}\n`);
    return { out: text, calls: requests.length };
  };
  const place = (name: string, x: number, z: number) => cli('act', JSON.stringify({ ops: [{ op: 'place', def: coreRef('bench'), name, p: [x, z] }] }));
  const id = (name: string) => server.god.model.get(name)?.id;
  const resident = { soulId: 's_ana', name: 'Ana' } as never;
  const plan = new URL('./fixtures/district-street.json', import.meta.url).pathname;

  // ---- Session 1: plan once, build chapter 1 (bakery, smithy).
  session(1);
  let r = await cli('build', 'district', 'high', '--file', plan);
  assert.equal(r.calls, 1); assert.match(r.out, /district high: High Street; 0\/6 plots built/); assert.match(r.out, /district brief: Owner words: a lively six-shop street/);
  assert.match(r.out, /next: build start high-1 --district high --plots p1,p2/); assert.match(r.out, /WARNING: chapter 1 \(p1,p2\) site spans road high/);
  r = await cli('build', 'start', 'high-1', '--district', 'high', '--brief', 'Chapter 1: a bakery and a smithy facing the street');
  assert.equal(r.calls, 1, 'a chapter start is one request'); assert.match(r.out, /chapter high-1 builds p1 Bakery, p2 Smithy/); assert.match(r.out, /frontage p1: road high to the south, 1 m from the plot edge \(front yaw 0\)/);
  assert.match(r.out, /massing: p1-hall 10×8 m/); assert.match(r.out, /WARNING: this chapter's site spans road high: things placed on that road inside the site join the chapter/);
  for (const [name, x, z] of [['bakery-bench', -40, -16], ['smithy-bench', -40, 16]] as const) assert.match((await place(name, x, z)).out, /"accepted":true/);
  r = await cli('build', 'done', 'bakery and smithy');
  assert.match(r.out, /high-1: done/); assert.match(r.out, /2\/6 plots built/); assert.match(r.out, /next: build start high-2 --district high --plots p3,p4/);

  // ---- Session 2 (after a restart): a fresh agent reads the plan, starts chapter 2, and stops mid-chapter.
  restart(3_600_000); session(2);
  r = await cli('build', 'district', 'high');
  assert.equal(r.calls, 1); assert.match(r.out, /plot p1 Bakery 16×18 m at \(-40, -14\): built \(high-1, 1 parts\)/); assert.match(r.out, /next: build start high-2 --district high --plots p3,p4/);
  r = await cli('build', 'start', 'high-2', '--district', 'high', '--brief', 'Chapter 2: an inn and a chapel');
  assert.match(r.out, /neighbour plots: p1 built \(high-1\), p2 built \(high-1\), p5 planned, p6 planned/);
  assert.match((await place('inn-bench', 0, -16)).out, /"accepted":true/);
  // Residents keep using the finished plots while chapter 2 is under construction.
  for (const finished of ['bakery-bench', 'smithy-bench']) { assert.equal(server.god.builds.closing(id(finished)!), null); assert.equal(server.layers.refusal(id(finished)!, resident), null); }
  assert.equal(server.layers.refusal(id('inn-bench')!, resident)?.code, 'site.under-construction');
  const walk = (to: [number, number]) => server.layers.constructionRefusal(resident, [{ verb: 'walk_to', params: { to } }]);
  assert.equal(walk([-40, -16]), null); assert.equal(walk([-40, 16]), null); assert.equal(walk([0, -16])?.code, 'site.under-construction');

  // ---- Session 3 (restart, the session-2 agent is gone): resume chapter 2 from the district view, finish, build chapter 3.
  restart(3_600_000); session(3);
  r = await cli('build', 'district', 'high');
  assert.match(r.out, /next: build resume high-2 \(plots p3,p4\)/); assert.match(r.out, /chapter high-2 \[p3,p4\]: paused/);
  r = await cli('build', 'resume', 'high-2');
  assert.equal(r.calls, 1, 'resume needs no extra call for the district'); assert.match(r.out, /^district high: High Street; 2\/6 plots built, 2 building, 2 planned/);
  assert.match(r.out, /plot p3 Inn 16×18 m at \(0, -14\): building \(high-2, 1 parts\) <- this chapter/); assert.match(r.out, /brief: Chapter 2: an inn and a chapel/);
  assert.doesNotMatch(r.out, /plot p1 /, 'beside one chapter the view stays compact');
  assert.match((await place('chapel-bench', 0, 16)).out, /"accepted":true/);
  assert.match((await cli('build', 'done')).out, /next: build start high-3 --district high --plots p5,p6/);
  r = await cli('build', 'start', 'high-3', '--district', 'high', '--brief', 'Chapter 3: a market and a mill');
  assert.match(r.out, /chapter high-3 builds p5 Market, p6 Mill/);
  for (const [name, x, z] of [['market-bench', 40, -16], ['mill-bench', 40, 16]] as const) assert.match((await place(name, x, z)).out, /"accepted":true/);
  assert.match((await cli('build', 'done')).out, /6\/6 plots built.*\n.*next: every plot is built|next: every plot is built/s);

  // ---- The street survives another restart, and each chapter undoes as one group, leaving the others intact.
  restart(60_000); session(4);
  assert.match((await cli('build', 'district', 'high')).out, /6\/6 plots built, 0 building, 0 planned/);
  const standing = () => ['bakery-bench', 'smithy-bench', 'inn-bench', 'chapel-bench', 'market-bench', 'mill-bench'].filter(n => id(n));
  r = await cli('undo', '--group', 'high-2'); assert.match(r.out, /undid group "high-2"/);
  assert.deepEqual(standing(), ['bakery-bench', 'smithy-bench', 'market-bench', 'mill-bench']);
  r = await cli('build', 'district', 'high');
  assert.match(r.out, /plot p3 Inn .*: undone \(high-2, 0 parts\)/); assert.match(r.out, /next: build start high-4 --district high --plots p3,p4/);
  assert.match((await cli('undo', '--group', 'high-3')).out, /undid group "high-3"/); assert.deepEqual(standing(), ['bakery-bench', 'smithy-bench']);
  assert.match((await cli('undo', '--group', 'high-1')).out, /undid group "high-1"/); assert.deepEqual(standing(), []);
  assert.equal(server.god.districts.view('high')!.counts.built, 0);
});
