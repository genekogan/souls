import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';
import {GodMode} from './god/god.ts';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

// V1 (3.2 walk): the viewer titled Eden 2026 "Eden-2026" (and LM "Little-martians-arium") from the URL slug until a late
// god-status call answered. The world's real title must be in the bootstrap config the viewer renders its first frame from.
const app = (f: ReturnType<typeof fixture>, worldKey: string, god?: GodMode) => buildApp({cfg: {...config, port: TEST_PORT, worldKey, worldPath: `/w/${worldKey}`, publicUrl: `http://127.0.0.1:${TEST_PORT}/w/${worldKey}`, accountAuthRequired: false, webDir: '/nonexistent-title-fixture', marsWebDir: '/nonexistent-title-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, ...(god ? {god} : {}), hub: {clients: new Map(), refreshMe() {}} as never});
const cfgOf = async (a: ReturnType<typeof app>) => (await (await a.request('/v1/config', {headers: {host: `127.0.0.1:${TEST_PORT}`}})).json()) as {worldName?: string};

test('bootstrap config carries the world title, never the slug', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:alice', tick: () => f.host.engine.world.tick, emit() {}});
  const saved = process.env.WORLD_NAME; t.after(() => { if (saved === undefined) delete process.env.WORLD_NAME; else process.env.WORLD_NAME = saved; });
  delete process.env.WORLD_NAME;
  assert.equal((await cfgOf(app(f, 'eden-2026', god))).worldName, 'Eden 2026', 'no launcher name: slug words, spaced');
  process.env.WORLD_NAME = 'Little Martians (Arium)';
  const lm = app(f, 'little-martians-arium', god);
  assert.equal((await cfgOf(lm)).worldName, 'Little Martians (Arium)', 'launcher name wins');
  const status = (await (await lm.request('/v1/god/status', {headers: {host: `127.0.0.1:${TEST_PORT}`}})).json()) as {name: string};
  assert.equal(status.name, 'Little Martians (Arium)', 'config and god status agree');
  delete process.env.WORLD_NAME;
  assert.equal((await cfgOf(app(f, 'littlemartians'))).worldName, 'Little Martians', 'shared old world keeps its title');
  assert.equal((await cfgOf(app(f, 'mars'))).worldName, 'Mars');
});


test('renamed world publishes canonical routing and engine kind without changing its world identity', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  const cfg = { ...config, worldKey: 'eden-2026', worldSlug: 'eden', worldEngine: true, worldPath: '/w/eden', publicUrl: 'http://localhost/w/eden', accountAuthRequired: false };
  const a = buildApp({ cfg, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, hub: { clients: new Map(), refreshMe() {} } as never });
  const body = await (await a.request('/v1/config')).json() as Record<string, unknown>;
  assert.equal(body.worldKey, 'eden'); assert.equal(body.worldPath, '/w/eden'); assert.equal(body.worldId, f.host.worldId); assert.equal(body.worldEngine, true);
  assert.equal(cfg.worldKey, 'eden-2026');
});
