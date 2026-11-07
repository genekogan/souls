// cmdDirect lifecycle hooks (#783 slice 1): with fake modules, a directed session registers every resource it creates,
// refuses live minds before creating anything, stops between steps on abort and ends play on a lifecycle cancel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdDirect } from '../run.mjs';
import { castPolicy, normalizeCast } from '../cast.mjs';
import { createLedger } from '../../../runs/ledger.mjs';
import { fakeDirectModules as fakeModules } from './fakes.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'direct-hooks-'));
const scripted = { rules: [{ match: '.', ack: 'On it.', do: [['look']] }] };
function castFile(dir, { live = false, planner = null } = {}) {
  const seats = ['ann', 'bob', 'cy'].map((id) => ({ id, soulName: id, character: `${id} is a test character.`, topic: 'rocks', ...(live ? {} : { adapter: 'scripted-owner', model: null, script: scripted }) }));
  const cast = { kind: 'cast', name: 'hooks-trio', brief: 'Three friends give short talks in the hall.', world: { kind: 'dev', genesis: 'g.json', slug: 'pt-hooks', port: 43290 },
    room: { label: 'the hall', match: ['hall'] }, seats, durationSec: 30, orchestrator: { planner },
    timing: { truthPollSec: 0.05, gatherMaxSec: 20, nudgeAfterSec: 5, quietSec: 1, speakTimeoutSec: 5, presentWaitSec: 1 }, observer: { cameras: ['wide'], sampleSec: 1 } };
  const f = join(dir, 'cast.json'); writeFileSync(f, JSON.stringify(cast)); return f;
}
const PREFLIGHT = { ok: true, allow: { allowed: true }, checks: { providersOk: true, machineOk: true } };

const quiet = () => {};
const silence = (fn) => fn(); // cmdDirect prints its one-line result; patching stdout would also swallow the test reporter

test('castPolicy: scripted-owner seats with no planner need no provider; live seats and a planner are named', () => {
  const base = (over) => normalizeCast({ kind: 'cast', name: 'p', brief: 'b', world: { kind: 'dev', genesis: 'g' }, room: { label: 'r', match: ['r'] }, seats: [{ id: 'a', soulName: 'A', character: 'c' }], ...over });
  assert.deepEqual(castPolicy(base({ seats: [{ id: 'a', soulName: 'A', character: 'c', adapter: 'scripted-owner', script: scripted }] })).live, []);
  assert.equal(castPolicy(base({ seats: [{ id: 'a', soulName: 'A', character: 'c', adapter: 'scripted-owner', script: scripted }] })).claude, false);
  assert.deepEqual(castPolicy(base({ orchestrator: { planner: 'sonnet' } })).live, ['a:claude-headless/haiku', 'planner:sonnet']);
});

test('with hooks, live seats or a live planner are refused before anything is created', async () => {
  for (const opts of [{ live: true }, { planner: 'sonnet' }]) {
    const dir = tmp(), f = fakeModules();
    const out = join(dir, 'run');
    const code = await cmdDirect({ _: ['direct', castFile(dir, opts)], headless: true, out }, { own: () => assert.fail('nothing to own'), modules: f.modules, preflight: PREFLIGHT }, { log: quiet });
    assert.equal(code, 2);
    assert.deepEqual(f.made, []);
    assert.equal(existsSync(out), false, 'no run folder');
  }
});

test('an abort before provision creates nothing; before seats, the world is owned and stopped', async () => {
  const dir = tmp(), f = fakeModules(), ac = new AbortController(); ac.abort('test');
  const ledger = createLedger();
  const code = await silence(() => cmdDirect({ _: ['direct', castFile(dir)], headless: true, out: join(dir, 'run') }, { own: ledger.own, signal: ac.signal, modules: f.modules, preflight: PREFLIGHT }, { log: quiet }));
  assert.notEqual(code, 0);
  assert.deepEqual(f.made, []);
  assert.equal(JSON.parse(readFileSync(join(dir, 'run', 'receipts', '9-failure.json'), 'utf8')).code, 'RUN_CANCELLED');

  const dir2 = tmp(), ac2 = new AbortController(), ledger2 = createLedger();
  const f2 = fakeModules();
  const afterProvision = async () => { ac2.abort('test'); };
  await silence(() => cmdDirect({ _: ['direct', castFile(dir2)], headless: true, out: join(dir2, 'run') }, { own: ledger2.own, signal: ac2.signal, modules: f2.modules, preflight: PREFLIGHT, afterProvision }, { log: quiet }));
  assert.deepEqual(f2.made, ['world:900001']);
  assert.deepEqual(f2.stopped, ['world:900001']);
  assert.deepEqual(ledger2.entries.map((e) => `${e.kind}:${e.id}`), ['world:pt-hooks']);
});

test('a lifecycle cancel during play ends the session; every created resource was owned and is released', async () => {
  const dir = tmp(), ac = new AbortController(), ledger = createLedger();
  const f = fakeModules({ onCard: (n) => { if (n === 2) ac.abort('SIGINT'); } });
  const out = join(dir, 'run');
  let pre = 0;
  const code = await silence(() => cmdDirect({ _: ['direct', castFile(dir)], headless: true, out }, { own: ledger.own, signal: ac.signal, modules: f.modules, preflight: { ...PREFLIGHT, marker: ++pre } }, { log: quiet }));
  assert.notEqual(code, 1, 'not a failure: the session ended and closed');
  const play = JSON.parse(readFileSync(join(out, 'receipts', '3-play.json'), 'utf8'));
  assert.equal(play.stoppedBy, 'lifecycle-cancel');
  assert.equal(JSON.parse(readFileSync(join(out, 'preflight.json'), 'utf8')).marker, 1, 'the hook preflight is used, not recomputed');
  assert.deepEqual(ledger.entries.map((e) => `${e.kind}:${e.id}`).sort(), ['browser:observer', 'controller:ann', 'controller:bob', 'controller:cy', 'world:pt-hooks']);
  assert.deepEqual(ledger.entries.find((e) => e.kind === 'controller').meta, { dir: 'seats/ann', adapter: 'scripted-owner', model: null });
  for (const r of ['seat:ann', 'seat:bob', 'seat:cy', 'browser', 'world:900001']) assert.ok(f.stopped.includes(r), `${r} stopped by the close step`);
  const sum = await ledger.releaseAll({ waitMs: 1000 });
  assert.equal(sum.ok, true, JSON.stringify(sum.failed));
  assert.equal(sum.owned, 5);
});
