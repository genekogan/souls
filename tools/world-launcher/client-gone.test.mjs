// node --test tools/world-launcher/client-gone.test.mjs (lane soul-listen-leak; proxy and fake worlds on a free block of ports)
// A request whose client hangs up while the launcher waits for its world (booting, restarting) is never sent to the world:
// a long-poll listen replayed after its agent left would be a ghost that holds the world's inbox for up to 55 s, and under
// "a newer listen supersedes the older" it would push the agent's real listener out. A client still connected is served.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { testPort } from '../../apps/server/test/test-port.ts';
const P0 = await testPort(5);

const PORT = P0 + 4, RANGE = [P0, P0 + 3];
const dir = mkdtempSync(join(tmpdir(), 'launcher-gone-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const webDir = join(dir, 'web'); mkdirSync(webDir);
const hits = join(dir, 'hits.log');
const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
let bootMs = 50;
const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), FAKE_BOOT_MS: String(bootMs), FAKE_HITS: hits } });
const open = () => openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {} });
const api = (p, o = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, o);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slowHits = () => (existsSync(hits) ? readFileSync(hits, 'utf8') : '').split('\n').filter((l) => l.startsWith('/slow'));
let L;
after(async () => { await L?.close(); });

test('a request whose client leaves while its world boots never reaches the world; a connected one does', async () => {
  L = await open();
  const r = await api('/__sim/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ghost Town' }) });
  assert.equal(r.status, 201); const { slug } = await r.json();
  // reopen with nothing woken eagerly and a slow boot: the next visit waits in pool.ensure
  await L.close(); bootMs = 1500; L = await open();
  const gone = request({ hostname: '127.0.0.1', port: PORT, path: `/w/${slug}/slow?ms=100&who=gone` });
  gone.on('error', () => {}); gone.end();
  await sleep(300); gone.destroy();                       // the agent's CLI is killed while the world is still booting
  const kept = await api(`/w/${slug}/slow?ms=50&who=kept`); // a connected client waits through the same kind of boot
  assert.equal(kept.status, 200); assert.equal(await kept.text(), 'ok');
  await sleep(500);
  assert.deepEqual(slowHits(), ['/slow?ms=50&who=kept'], 'only the connected request reached the world');
});
test('a long-poll in flight when its world restarts is not replayed once its client has left (the retry path)', async () => {
  const slug = 'ghost-town';
  bootMs = 50;
  for (let i = 0; i < 50 && (await api(`/w/${slug}/healthz`)).status !== 200; i++) await sleep(100);
  const before = slowHits().length;
  // the agent's listen is waiting at the world when the world goes down (its connection drops just after the exit):
  // the launcher asks again once the world is back
  const gone = request({ hostname: '127.0.0.1', port: PORT, path: `/w/${slug}/slow?ms=5000&who=listen` });
  gone.on('error', () => {}); gone.end();
  const stays = api(`/w/${slug}/slow?ms=4000&who=stays`).then(async (r) => [r.status, await r.text()]);   // one that keeps waiting
  await sleep(200);
  bootMs = 1500;
  assert.equal((await api(`/w/${slug}/crash-hold?ms=300`)).status, 200);
  await sleep(700); gone.destroy();                       // ... but the agent's CLI was stopped during the restart
  for (let i = 0; i < 50 && (await api(`/w/${slug}/healthz`)).status !== 200; i++) await sleep(100);
  await sleep(500);
  assert.deepEqual(await stays, [200, 'ok'], 'a client still connected is asked again and answered by the restarted world');
  assert.deepEqual(slowHits().slice(before).sort(), ['/slow?ms=4000&who=stays', '/slow?ms=4000&who=stays', '/slow?ms=5000&who=listen'], 'the listen that left reached the world once, never again as a ghost');
  const kept = await api(`/w/${slug}/slow?ms=50&who=after`);
  assert.equal(await kept.text(), 'ok');
});
