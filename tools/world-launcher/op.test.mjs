// node --test tools/world-launcher/op.test.mjs — the operator's create-world (lane RELEASE ports: proxy 6230, children 6231–6235).
// A stand-in world writes its owner into sim.db the way GodMode does on first boot (WORLD_OWNER_ID), then runs fake-world.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openLauncher } from './launcher.mjs';
import { defaultCommand } from './children.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';

const PORT = Number(process.env.OP_TEST_PORT ?? await testPort(6)), RANGE = [PORT + 1, PORT + 5];
const dir = mkdtempSync(join(tmpdir(), 'launcher-op-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
writeFileSync(join(templatesDir, 'arium.json'), JSON.stringify({ schema: 'genesis/1', name: 'Arium', description: 'x', batches: [] }));
const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
const born = join(dir, 'born.mjs');
writeFileSync(born, `import { DatabaseSync } from 'node:sqlite'; import { join } from 'node:path';
const db = new DatabaseSync(join(process.env.DATA_DIR, 'sim.db')); db.exec('CREATE TABLE IF NOT EXISTS world_meta_v1 (world_id TEXT PRIMARY KEY, body TEXT)');
if (!db.prepare('SELECT 1 FROM world_meta_v1 WHERE world_id=?').get(process.env.WORLD_KEY + '-1')) db.prepare('INSERT INTO world_meta_v1 VALUES (?, ?)').run(process.env.WORLD_KEY + '-1', JSON.stringify({ owner: process.env.WORLD_OWNER_ID || null }));
db.close(); await import(${JSON.stringify(new URL('./fake-world.mjs', import.meta.url).pathname)});`);
// the real child env (so WORLD_OWNER_ID comes from defaultCommand), but the stand-in script
const command = (w, port) => { const c = defaultCommand(w, port, { publicOrigin: `http://127.0.0.1:${PORT}` }); return { cmd: process.execPath, args: [born], env: { ...c.env, DATA_DIR: w.dataDir } }; };
let L;
before(async () => { L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {} }); });
after(async () => { await L?.close(); });
const op = (body, headers = {}) => fetch(`http://127.0.0.1:${PORT}/__sim/op/create-world`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('operator create: born owned by the account; ownerOf copies an existing god; the public path still claims nothing', async () => {
  let r = await op({ name: 'First', template: 'arium', owner: 'acct_gene123' });
  let d = await r.json();
  assert.equal(r.status, 201, JSON.stringify(d)); assert.equal(d.owner, 'acct_gene123'); assert.equal(d.slug, 'first');
  r = await op({ name: 'Little Martians (Arium)', template: 'arium', ownerOf: 'first' }); d = await r.json();
  assert.equal(r.status, 201, JSON.stringify(d)); assert.equal(d.owner, 'acct_gene123'); assert.equal(d.world.template, 'arium');
  const db = new DatabaseSync(join(dir, 'data/worlds', d.slug, 'sim.db'), { readOnly: true });
  assert.equal(JSON.parse(db.prepare('SELECT body FROM world_meta_v1').get().body).owner, 'acct_gene123'); db.close();
  r = await fetch(`http://127.0.0.1:${PORT}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Public', template: 'arium', owner: 'acct_gene123' }) });
  d = await r.json(); assert.equal(r.status, 201); assert.equal(d.owner, undefined);
  const db2 = new DatabaseSync(join(dir, 'data/worlds', d.slug, 'sim.db'), { readOnly: true });
  assert.equal(JSON.parse(db2.prepare('SELECT body FROM world_meta_v1').get().body).owner, null); db2.close();
});
test('operator create is refused through a reverse proxy and on bad input', async () => {
  let r = await op({ name: 'X', template: 'arium', owner: 'acct_gene123' }, { 'x-forwarded-for': '1.2.3.4' });
  assert.equal(r.status, 403); assert.equal((await r.json()).code, 'local-only');
  r = await op({ name: 'X', template: 'arium' }); assert.equal(r.status, 400);
  r = await op({ name: 'X', template: 'arium', ownerOf: 'nope' }); assert.equal(r.status, 404);
  r = await op({ name: 'X', template: 'nope', owner: 'acct_gene123' }); assert.equal(r.status, 400);
  r = await op({ name: 'X', template: 'arium', owner: 'bad owner!' }); assert.equal(r.status, 400);
});
test('operator create may choose the slug (eden-2026, not my-eden-2026); reserved, old-world and taken slugs are refused', async () => {
  let r = await op({ name: 'Eden 2026', template: 'arium', owner: 'acct_gene123', slug: 'eden-2026' }); let d = await r.json();
  assert.equal(r.status, 201, JSON.stringify(d)); assert.equal(d.slug, 'eden-2026'); assert.equal(d.owner, 'acct_gene123');
  for (const slug of ['eden', 'mars', 'api', 'Bad Slug', '2026']) { r = await op({ name: 'Y', template: 'arium', owner: 'acct_gene123', slug }); assert.equal(r.status, 400, slug); }
  r = await op({ name: 'Y', template: 'arium', owner: 'acct_gene123', slug: 'eden-2026' }); assert.equal(r.status, 409);
  r = await fetch(`http://127.0.0.1:${PORT}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Eden 2026', template: 'arium', slug: 'eden-2026b' }) });
  d = await r.json(); assert.equal(r.status, 201); assert.notEqual(d.slug, 'eden-2026b');
});
