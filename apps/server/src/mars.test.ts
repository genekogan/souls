const WORLD_ID = 'toy-1';
// The same shell on the Mars engine: replay, restart, client sync and the DJ story,
// with Mars bodies doing the walking, sitting and talking. Skipped without a Mars checkout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Connection } from '@souls/client';
import { marsAvailable, marsFactory } from '@souls/engine-mars';
import { kernelHash } from '@souls/kernel';
import { Db } from './db.ts';
import { optionsFor } from './deck.ts';
import { initKernel, replayKernel } from './fold.ts';
import { WorldHost, replayFromGenesis } from './world.ts';
import {testPort} from '../test/test-port.ts';

if (!marsAvailable()) test('the shell on the Mars engine (skipped: no Mars checkout on this machine)', { skip: true }, () => {});
else {
  const factory = await marsFactory();
  function drive(host: WorldHost, ticks: number, pick: (i: number) => number) {
    for (let i = 0; i < ticks; i++) {
      if (i % 170 === 7) for (const m of host.minds.values()) {
        const opts = optionsFor(host, m); if (!opts.length) continue; const o = opts[pick(i + m.name.length) % opts.length];
        void host.enqueue('decision', 'test', { soulId: m.soulId, entityId: m.entityId, option: o.id, label: o.label, steps: o.steps, reevalTicks: 600, fallback: false, trigger: 'test', card: o.card, target: o.cardTarget, manner: 'warmly', approachLen: o.approachLen });
      }
      host.tickOnce();
    }
  }
  const births = (host: WorldHost, names: string[]) => names.forEach((n) => void host.enqueue('birth', 'test', { soulId: `s_${n}`, entityId: `h_${n}`, name: n, description: 'test soul', owner: 'system' }));

  test('mars: replay from genesis reproduces the live world, and the kernel replays without the engine', () => {
    const db = new Db(join(mkdtempSync(join(tmpdir(), 'souls-mars-')), 't.db'));
    const host = new WorldHost(db, factory, 'mars-replay', 1e9); host.boot();
    births(host, ['a', 'b', 'c', 'd', 'e']);
    drive(host, 3000, (i) => i * 7);
    void host.enqueue('retire', 'test', { soulId: 's_c', entityId: 'h_c' });
    drive(host, 1500, (i) => i * 3);
    const replayed = replayFromGenesis(factory, 'mars-replay', db.events(WORLD_ID), host.engine.world.tick);
    assert.equal(replayed.engine.stateHash(), host.engine.stateHash());
    host.kernel.tick = replayed.kernel.tick;
    assert.equal(kernelHash(replayed.kernel), kernelHash(host.kernel));
    const alone = replayKernel(initKernel(factory.create(factory.genesis('mars-replay'))), db.events(WORLD_ID)); alone.tick = host.kernel.tick;
    assert.equal(kernelHash(alone), kernelHash(host.kernel));
    const plays = db.events(WORLD_ID).filter((e) => e.kind === 'play').length;
    assert.ok(plays > 10, `cards were played on Mars bodies: ${plays}`);
    assert.equal(host.engine.world.entities['h_c'], undefined);
    assert.deepEqual([...new Set(host.engine.runtime.violations.map((v) => v.code))], [], 'no physical violations');
    db.close();
  });

  test('mars: restart from a snapshot taken mid-action equals the uninterrupted world', () => {
    const db = new Db(join(mkdtempSync(join(tmpdir(), 'souls-mars-')), 't.db'));
    const host = new WorldHost(db, factory, 'mars-restart', 1e9); host.boot();
    births(host, ['a', 'b', 'c']);
    drive(host, 1200, (i) => i);
    host.saveSnapshot();
    drive(host, 900, (i) => i * 5);
    const lastEventTick = db.tailEvents(WORLD_ID, 1)[0].tick;
    const host2 = new WorldHost(db, factory, 'mars-restart', 1e9);
    const boot = host2.boot();
    assert.equal(boot.from, 'snapshot'); assert.ok(boot.replayed > 0);
    assert.equal(host2.engine.world.tick, lastEventTick);
    for (let i = 0; i < 400; i++) host2.tickOnce();
    const ref = replayFromGenesis(factory, 'mars-restart', db.events(WORLD_ID), lastEventTick + 400);
    assert.equal(host2.engine.stateHash(), ref.engine.stateHash());
    host2.kernel.tick = ref.kernel.tick; assert.equal(kernelHash(host2.kernel), kernelHash(ref.kernel));
    db.close();
  });

  // ---------------------------------------------------------------- a real server process on the Mars engine
  // A free port by default, which is outside 4930-4970 (the laptop's release listeners); override with TEST_MARS_PORT.
  const PORT = Number(process.env.TEST_MARS_PORT ?? await testPort());
  assert.ok(Number.isInteger(PORT) && PORT >= 1024 && PORT <= 65535,'explicit valid fixture port');
  assert.ok(PORT < 4930 || PORT > 4970,'TEST_MARS_PORT must be outside 4930-4970 (release listeners)');
  const BASE = `http://127.0.0.1:${PORT}`;
  let proc: ChildProcess;let fixtureReady=false;
  const fixtureBuild=`isolated-mars-test-${process.pid}`,connections=new Set<Connection>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const client = () => { assert.ok(fixtureReady,'owned fixture must be ready before WS');const c = new Connection(`ws://127.0.0.1:${PORT}/ws`, async () => null, {}, (u) => new WebSocket(u) as any); connections.add(c);c.connect(); return c; };
  const api = async (path: string, token: string, body?: unknown) => {
    assert.ok(fixtureReady,'owned fixture must be ready before API');const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t as any }; }
  };
  before(async () => {
    const vacancy=createServer();await new Promise<void>((resolve,reject)=>{vacancy.once('error',reject);vacancy.listen(PORT,'127.0.0.1',()=>vacancy.close(error=>error?reject(error):resolve()));});
    let listening=false,startupError:Error|undefined;
    const fixtureData=mkdtempSync(join(tmpdir(),'souls-mars-'));
    proc = spawn(process.execPath, [new URL('./main.ts', import.meta.url).pathname], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...(process.env.MARS_ENGINE_DIR ? { MARS_ENGINE_DIR: process.env.MARS_ENGINE_DIR } : {}), WORLD_KEY:'toy',WORLD_ID:WORLD_ID, BUILD_ID:fixtureBuild, ENGINE: 'mars', MIND_DRIVER: 'central', PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR:fixtureData,ACCOUNT_REGISTRY_PATH:join(fixtureData,'accounts.sqlite'),ACCOUNT_AUTH_REQUIRED:'0',SEED_NATIVES:'1', BRAIN_MODE: 'fake', DEV_AUTH: '1', PUBLIC_URL: BASE, WEB_DIR: '/nonexistent' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    proc.once('error',error=>{startupError=error;});
    let stdout='';proc.stdout!.on('data',chunk=>{stdout=(stdout+String(chunk)).slice(-65536);listening=stdout.includes(`[http] listening on ${BASE} `)&&stdout.includes(`build ${fixtureBuild},`);});
    for (let i = 0; i < 50; i++) {
      if(startupError)throw startupError;
      if(proc.exitCode!==null||proc.signalCode!==null)throw Error('owned Mars fixture exited before readiness');
      if(listening){try{const response=await fetch(`${BASE}/healthz`);if(response.ok){const health=await response.json() as any;assert.equal(health.worldId,WORLD_ID,'fixture world identity');assert.equal(health.build,fixtureBuild,'fixture child-specific build identity');fixtureReady=true;return;}}catch(error){if(error instanceof assert.AssertionError)throw error;}}
      await sleep(200);
    }
    throw new Error('server did not start');
  });
  after(async () => {
    fixtureReady=false;for(const c of connections)c.close();
    if(proc?.pid&&proc.exitCode===null&&proc.signalCode===null){const exited=once(proc,'exit');proc.kill('SIGTERM');await exited;}
  });

  test('mars: clients fed keyframes agree with the server', async t => {
    const a = client();t.after(()=>a.close()); await sleep(4000);
    const b = client();t.after(()=>b.close()); await sleep(12000);
    for (const c of [a, b]) {
      assert.equal(c.stats.state, 'open');
      assert.ok(c.stats.heartbeats >= 2, `heartbeats ${c.stats.heartbeats}`);
      assert.equal(c.stats.lastCheck, 'ok');
      assert.equal(c.stats.resyncs, 0);
    }
    assert.ok(Object.values(a.replica.entities).filter((e) => e.kind === 'human').length >= 6);
    a.close(); b.close();
  });

  test('mars: the DJ story, with Mars bodies', async t => {
    const admin = 'dev:admin';
    const robReply=await api('/v1/souls', admin, { name: 'Rob', description: 'a generous host who loves a crowd' });assert.equal(robReply.status,200,'private legacy fixture creates Rob through actual dev-auth route');const rob=robReply.body.soul;
    const wrenReply=await api('/v1/souls', admin, { name: 'Wren', description: 'a kite maker who secretly wants to DJ' });assert.equal(wrenReply.status,200,'private legacy fixture creates Wren through actual dev-auth route');const wren=wrenReply.body.soul;
    assert.ok(rob?.id && wren?.id);
    await sleep(600);
    const grammar = await (await fetch(`${BASE}/cards.md`)).text();
    assert.ok(grammar.includes('`mars:serve`') && grammar.includes('`walk_to`'), 'the grammar lists the body language and the raw Mars verbs');
    const cards = [
      { name: 'ask to be the dj', summary: 'Ask the host of a gathering to let you play the music', good_when: 'the intent is to DJ', not_for: 'there is already a DJ',
        target: { kind: 'gathering' }, derive: { host: { link: 'hosts', to: '$target' } },
        when: [{ at: ['$actor', '$target'] }, { noneLinkedTo: ['dj of', '$target'] }, { distinct: ['$actor', '$host'] }, { notLinked: ['asked', '$actor', '$host'] }, { notLinked: ['agreed', '$host', '$actor'] }],
        then: [{ say: ['$actor', '$host', 'ask'], about: 'being the DJ at $target.name' }],
        approach: [{ verb: 'walk_to', params: { to: '$host', standoff: 1.3 } }], during: [{ verb: 'wave', params: { at: '$host', seconds: 2 } }], takes: 'seconds' },
      { name: 'be the dj', summary: 'Set up and play music at a gathering, once the host has agreed', good_when: 'the host said yes', not_for: 'no agreement yet',
        target: { kind: 'gathering' }, derive: { host: { link: 'hosts', to: '$target' } },
        when: [{ at: ['$actor', '$target'] }, { linked: ['agreed', '$host', '$actor'] }, { noneLinkedTo: ['dj of', '$target'] }],
        then: [{ link: ['dj of', '$actor', '$target'] }, { appear: { kind: 'dj kit', name: 'a DJ kit', at: '$target.at', with: '$target', states: { state: 'playing' } }, linkFromActor: 'made' }, { set: ['$target', 'music', 'playing'] }, { set: ['$actor', 'doing', 'playing music'] }],
        approach: [], during: [{ verb: 'perform', params: { seconds: 60 } }], wants: ['set up equipment', 'dj at a deck'], takes: 'minutes' },
    ];
    const proposed = await api(`/v1/souls/${wren.id}/cards`, admin, { cards, links: { 'dj of': { summary: 'plays the music at', control: true } }, kinds: { 'dj kit': { summary: 'turntables and speakers' } } });
    assert.equal(proposed.body.ok, true, JSON.stringify(proposed.body));
    assert.equal((await api(`/v1/souls/${rob.id}/intent`, admin, { intent: { agenda: [{ card: 'host a gathering', target: 'fire' }, { card: 'say yes', target: null }], text: 'throw a party at the fire and let people help' } })).status, 200);
    assert.equal((await api(`/v1/souls/${wren.id}/intent`, admin, { intent: { agenda: [{ card: 'ask to be the dj', of: 'Rob' }, { card: 'be the dj', of: 'Rob' }], text: "go to Rob's party and ask him if you can DJ" } })).status, 200);
    assert.equal((await api('/v1/admin', admin, { action: 'clock_rate', rate: 5 })).status, 200);
    const mine = async () => (await (await fetch(`${BASE}/v1/plays?limit=200`)).json() as any).plays.filter((p: any) => [rob.id, wren.id].includes(p.soulId));
    let plays: any[] = [];
    for (let i = 0; i < 400; i++) { await sleep(300); plays = await mine(); if (plays.some((p) => p.ok && p.card === 'be the dj')) break; }
    await api('/v1/admin', admin, { action: 'clock_rate', rate: 1 });
    const trace = plays.map((p: any) => `${p.tick} ${p.soul}:${p.card}→${p.targetName}${p.ok ? '' : ' REFUSED ' + p.reason}`).join('\n');
    const done = plays.filter((p) => p.ok).map((p) => `${p.soul}:${p.card}`);
    let at = -1; for (const step of ['Rob:host a gathering', 'Wren:ask to be the dj', 'Rob:say yes', 'Wren:be the dj']) { const i = done.indexOf(step, at + 1); assert.ok(i > at, `${step} happened in order\n${trace}`); at = i; }
    // the bodies really were there: both ended up near the fire
    const snap = (await api('/v1/world', admin)).body;
    void snap;
    const c = client();t.after(()=>c.close()); await sleep(6500);
    const near = (id: string) => { const e = c.replica.entities[id], f = c.replica.entities['fire']; return Math.hypot(e.pose.p[0] - f.pose.p[0], e.pose.p[2] - f.pose.p[2]); };
    assert.ok(near(rob.entityId) < 6 && near(wren.entityId) < 6, `Rob ${near(rob.entityId).toFixed(1)} m and Wren ${near(wren.entityId).toFixed(1)} m from the fire`);
    assert.equal(c.stats.lastCheck, 'ok'); c.close();
  });
}
