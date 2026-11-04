// Soul Runs SR2 (#751): world source, setup batches and composed casts in the run spec. Deterministic: no world,
// browser, model or network (setup talks to a fake fetch); temporary directories only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSpec } from './spec.mjs';
import { applySetup } from './setup.mjs';
import { startRun, RECEIPT } from './lifecycle.mjs';
import { REPO_ROOT } from '../../lib/paths.mjs';

let nextPort = 43270;
const SCRIPT = { rules: [{ match: 'pond', do: [['act', 'walk to the pond', '--wait', '60']] }] };
const seat = (id) => ({ id, adapter: 'scripted-owner', soulName: id[0].toUpperCase() + id.slice(1), script: SCRIPT });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'soul-compose-'));
  const scenario = { name: 'compose-fixture', version: 1, seed: 1, providers: { allowed: ['codex'] }, world: { kind: 'dev', genesis: 'worlds/templates/hello-hamlet.json', slug: 'pt-compose', port: 4998 }, durationSec: 60,
    seats: [{ id: 'pip', adapter: 'codex-headless', model: null, soulName: 'Pip' }], god: null, director: { mode: 'scripted', sequential: false, script: [{ seat: 'pip', atSec: 1, channel: 'card', text: 'sit' }] },
    observer: { cameras: [], viewport: [1280, 800] }, review: { mode: 'deterministic', developer: false }, rails: {} };
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario));
  writeFileSync(join(dir, 'bench.json'), JSON.stringify({ ops: [{ op: 'place', def: 'core/bench@1', name: 'sr-bench', p: [6, 6] }] }));
  const spec = (extra = {}) => ({ soulRun: 1, scenario: join(dir, 'scenario.json'), world: { port: nextPort++ }, observer: { check: false }, ...extra });
  return { dir, spec, specPath: join(dir, 'spec.json') };
}
const v = (f, spec) => validateSpec(spec, { specPath: f.specPath, serverRoot: REPO_ROOT });

test('a composed cast replaces seats and direction in their own formats; a broadcast stays one auditable entry', () => {
  const f = fixture();
  const r = v(f, f.spec({ cast: { seats: [seat('ada'), seat('bo'), seat('cy')], script: [{ seat: '*', atSec: 2, channel: 'card', text: 'meet at the pond', budgetSec: 30 }, { seat: 'bo', atSec: 40, channel: 'card', text: 'now the pond again' }] } }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.scenario.seats.map((s) => s.id), ['ada', 'bo', 'cy']);
  assert.deepEqual(r.scenario.director.script.map((e) => e.seat), ['*', 'bo']);
  assert.equal(r.scenario.soulRunCast.broadcasts, 1);
  assert.deepEqual(r.policy.required, [], 'scripted-owner seats need no provider');
  assert.deepEqual(r.controllers.map((c) => c.adapter), ['scripted-owner', 'scripted-owner', 'scripted-owner']);
  assert.equal(r.effective.world.source.kind, 'genesis');
  assert.match(r.effective.world.source.sha256, /^[0-9a-f]{64}$/);
});

test('composed casts refuse duplicate seats, too many controllers, bad scripts and unsupported director commands', () => {
  const f = fixture();
  const codes = (cast, extra = {}) => v(f, f.spec({ cast, ...extra })).errors.map((e) => e.code);
  assert.deepEqual(codes({ seats: [seat('ada'), seat('ada')] }), ['cast.seats.duplicate']);
  assert.deepEqual(codes({ seats: [seat('ada'), seat('bo')], script: [{ seat: '*', atSec: 1, channel: 'card', text: 'go' }] }, { limits: { maxControllers: 1 } }), ['limits.maxControllers']);
  assert.deepEqual(codes({ seats: [{ ...seat('ada'), script: { rules: [] } }], script: [{ seat: 'ada', atSec: 1, channel: 'card', text: 'go' }] }), ['cast.scenario']);
  const paused = v(f, f.spec({ cast: { script: [{ seat: 'pip', atSec: 1, command: 'pause' }] } }));
  assert.deepEqual(paused.errors.map((e) => e.code), ['direction.unsupported']);
  assert.match(paused.errors[0].message, /scripted director supports no commands/);
  assert.deepEqual(codes({ seats: [seat('ada')], extra: 1 }), ['cast.unknown-field']);
  assert.deepEqual(codes({ seats: [{ ...seat('ada'), adapter: 'codex-headless', model: null, script: undefined }], script: [{ seat: 'ada', atSec: 1, channel: 'card', text: 'go' }] }), ['controllers.live-model'], 'live adapters still need explicit opt-in');
});

test('world source and setup batches are resolved, hashed and declared before play', () => {
  const f = fixture();
  const r = v(f, f.spec({ cast: 'none', world: { port: nextPort++, genesis: 'worlds/templates/littlemartians-garden.json' }, setup: { batches: ['bench.json', { id: 'inline', ops: [{ op: 'set', id: 'x' }] }] } }));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.scenario.world.genesis, 'worlds/templates/littlemartians-garden.json');
  assert.deepEqual(r.effective.setup.batches.map((b) => [b.id, b.ops]), [['bench', 1], ['inline', 1]]);
  assert.equal(r.setup.batches[0].ops[0].name, 'sr-bench');
  const bad = (setup) => v(f, f.spec({ cast: 'none', setup })).errors.map((e) => e.code);
  assert.deepEqual(bad({ batches: ['missing.json'] }), ['setup.batch-missing']);
  assert.deepEqual(bad({ batches: [] }), ['setup.batches']);
  assert.deepEqual(bad({ batches: [{ ops: [] }] }), ['setup.batch']);
  assert.deepEqual(bad({ batches: ['bench.json'], when: 'later' }), ['setup.unknown-field']);
});

const fakeWorld = ({ refuse = false } = {}) => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname; seen.push({ path, auth: init.headers?.authorization ?? null });
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (path.endsWith('/v1/world/snapshot')) return json({ entities: [], defs: [], ground: {}, constants: {}, state: {}, seed: 's', seq: 1 });
    if (path.endsWith('/v1/god/mint')) return json({ ok: true, token: 'god-token-secret' });
    if (path.endsWith('/v1/god/act')) return json(refuse ? { accepted: false, failures: [{ op: 0, code: 'overlap.solid', detail: 'bench overlaps cottage' }] } : { accepted: true, seq: 2 });
    return json({}, 404);
  };
  return { seen, fetchImpl };
};

test('applySetup mints as the dev owner, acts per batch and never records the god token', async () => {
  const w = fakeWorld();
  const r = await applySetup({ base: 'http://127.0.0.1:1/w/x', setup: { batches: [{ id: 'bench', path: null, sha256: 'h', ops: [{}] }] }, fetchImpl: w.fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(w.seen.map((s) => s.path.split('/w/x')[1]), ['/v1/world/snapshot', '/v1/god/mint', '/v1/god/act', '/v1/world/snapshot']);
  assert.equal(w.seen[1].auth, 'Bearer dev:admin');
  assert.equal(JSON.stringify(r).includes('god-token-secret'), false);
  assert.match(r.fixture.physicalAfterSetupSha256, /^[0-9a-f]{64}$/);
});

test('a refused setup batch fails the run at stage setup with the refusal recorded; play never starts', async () => {
  const f = fixture();
  const serverRoot = join(f.dir, 'root');
  for (const p of ['apps/server/src/main.ts', 'apps/web/dist/index.html', 'tools/world-launcher/soul/eden.mjs', 'worlds/templates/hello-hamlet.json']) { mkdirSync(join(serverRoot, p, '..'), { recursive: true }); writeFileSync(join(serverRoot, p), '{}'); }
  const w = fakeWorld({ refuse: true });
  let played = false;
  const r = await startRun({ spec: f.spec({ cast: 'none', setup: { batches: ['bench.json'] } }), specPath: f.specPath, serverRoot, outDir: join(f.dir, 'run'),
    setupFn: (a) => applySetup({ ...a, fetchImpl: w.fetchImpl }),
    execute: async ({ hooks }) => { try { await hooks.afterProvision({ world: { base: 'http://127.0.0.1:1/w/x' } }); played = true; return 0; } catch { return 1; } } });
  assert.equal(r.status, 'failed');
  assert.equal(r.stage, 'setup');
  assert.equal(played, false);
  const rec = JSON.parse(readFileSync(join(f.dir, 'run', RECEIPT), 'utf8'));
  assert.equal(rec.setup.batches[0].refusal.code, 'overlap.solid');
  assert.match(rec.reason, /setup refused: setup batch bench refused: overlap.solid/);
});
