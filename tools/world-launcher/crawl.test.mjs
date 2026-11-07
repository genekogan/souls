// #894: robots.txt, sitemap.xml and the noindex rules, unit and through a real launcher with stand-in worlds.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CRAWLERS, NOINDEX, robotsTxt, sitemapXml } from './crawl.mjs';
import { openLauncher } from './launcher.mjs';
import { defaultCommand } from './children.mjs';

test('robots.txt names every crawler, allows the site, disallows the private paths and points at the sitemap', () => {
  const t = robotsTxt({ origin: 'https://soul.game' });
  for (const ua of [...CRAWLERS, '*']) assert.match(t, new RegExp(`^User-agent: ${ua.replace('*', '\\*')}$`, 'm'));
  for (const ua of ['GPTBot', 'ClaudeBot', 'Googlebot', 'PerplexityBot', 'Google-Extended', 'OAI-SearchBot']) assert.ok(CRAWLERS.includes(ua), ua);
  assert.match(t, /^Allow: \/$/m);
  for (const p of ['/__sim/', '/ops', '/health', '/w/*/v1/debug/', '/w/*/mcp']) assert.ok(t.includes(`\nDisallow: ${p}\n`), p);
  assert.ok(!/^Disallow: \/$/m.test(t), 'the site itself is never disallowed');
  assert.match(t, /^Sitemap: https:\/\/soul\.game\/sitemap\.xml$/m);
  // one group: every User-agent line precedes the rules (a blank line would end the group)
  assert.ok(t.split('\n\n')[0].includes('User-agent: *') && t.split('\n\n')[0].includes('Disallow: /ops'));
  const based = robotsTxt({ origin: 'https://x.test', base: '/worlds' });
  assert.match(based, /^Allow: \/worlds\/$/m); assert.match(based, /^Disallow: \/worlds\/__sim\/$/m); assert.match(based, /^Sitemap: https:\/\/x\.test\/worlds\/sitemap\.xml$/m);
});

test('sitemap.xml: sitemaps.org 0.9, absolute locs on the public origin, home, changelog, extra pages and the given worlds once each', () => {
  const x = sitemapXml({ origin: 'https://soul.game', worlds: [{ slug: 'eden-2026' }, { slug: 'a&b' }], pages: ['/docs', '/changelog'] });
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">\n/);
  const locs = [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, ['https://soul.game/', 'https://soul.game/changelog', 'https://soul.game/docs', 'https://soul.game/w/eden-2026/', 'https://soul.game/w/a&amp;b/']);
  assert.equal(x.match(/<url>/g).length, x.match(/<\/url>/g).length);
  assert.ok(x.trimEnd().endsWith('</urlset>'));
});

const PORT = Number(process.env.CRAWL_TEST_PORT ?? 7090), RANGE = [PORT + 1, PORT + 6];
const dir = mkdtempSync(join(tmpdir(), 'launcher-crawl-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
writeFileSync(join(templatesDir, 'plain.json'), JSON.stringify({ schema: 'genesis/1', name: 'Plain', description: 'x', batches: [] }));
const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Souls</title>'); writeFileSync(join(webDir, 'changelog.html'), '<!doctype html>');
const born = join(dir, 'born.mjs');
writeFileSync(born, `import { DatabaseSync } from 'node:sqlite'; import { join } from 'node:path';
const db = new DatabaseSync(join(process.env.DATA_DIR, 'sim.db')); db.exec('CREATE TABLE IF NOT EXISTS world_meta_v1 (world_id TEXT PRIMARY KEY, body TEXT)');
db.exec('CREATE TABLE IF NOT EXISTS god_tokens_v1 (world_id TEXT NOT NULL, token_hash TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL, last_used INTEGER, PRIMARY KEY (world_id, token_hash))');
if (!db.prepare('SELECT 1 FROM world_meta_v1 WHERE world_id=?').get(process.env.WORLD_KEY + '-1')) db.prepare('INSERT INTO world_meta_v1 VALUES (?, ?)').run(process.env.WORLD_KEY + '-1', JSON.stringify({ owner: process.env.WORLD_OWNER_ID || null }));
db.close(); await import(${JSON.stringify(new URL('./fake-world.mjs', import.meta.url).pathname)});`);
const command = (w, port) => { const c = defaultCommand(w, port, { publicOrigin: `http://127.0.0.1:${PORT}` }); return { cmd: process.execPath, args: [born], env: { ...c.env, DATA_DIR: w.dataDir } }; };
let L;
before(async () => { L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {} }); });
after(async () => { await L?.close(); });
const api = (p, o = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, o);
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const locs = async () => [...(await (await api('/sitemap.xml')).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(`http://127.0.0.1:${PORT}`, ''));

test('through the launcher: robots and sitemap answered without a world, a listed world indexable, an unlisted one noindex everywhere, flips at once', async () => {
  const o = `http://127.0.0.1:${PORT}`;
  let r = await api('/robots.txt');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /^text\/plain/); assert.equal(r.headers.get('x-robots-tag'), null);
  assert.match(await r.text(), new RegExp(`Sitemap: ${o}/sitemap.xml`));
  r = await api('/sitemap.xml'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /^application\/xml/);
  assert.deepEqual(await locs(), ['/', '/changelog']);
  assert.equal(L.registry.worlds.length, 0, 'answered with no world at all: the launcher never asks a world for these');
  // the home page and the changelog carry no robots header; the launcher's JSON always does
  for (const p of ['/', '/changelog']) { r = await api(p); assert.equal(r.status, 200, p); assert.equal(r.headers.get('x-robots-tag'), null, p); }
  r = await api('/__sim/worlds.json'); assert.equal(r.headers.get('x-robots-tag'), NOINDEX);

  for (const name of ['Garden', 'Hidden Garden']) assert.equal((await post('/__sim/worlds', { name, template: 'plain' })).status, 201);
  assert.equal((await post('/__sim/op/set-unlisted', { slug: 'hidden-garden', unlisted: true })).status, 200);
  assert.deepEqual(await locs(), ['/', '/changelog', '/w/garden/'], 'listed worlds only');
  assert.ok(!(await (await api('/robots.txt')).text()).includes('hidden-garden'), 'robots.txt never names an unlisted world');
  r = await api('/w/garden/v1/config'); assert.equal(r.status, 200); assert.equal(r.headers.get('x-robots-tag'), null, 'a listed world passes its own headers');
  r = await api('/w/hidden-garden/v1/config'); assert.equal(r.status, 200); assert.equal(r.headers.get('x-robots-tag'), NOINDEX, 'an unlisted world is noindex');
  r = await api('/w/hidden-garden/v1/world/snapshot'); assert.equal(r.headers.get('x-robots-tag'), NOINDEX);
  // a root path a world answers (whichever runs, maybe the unlisted one) is never indexable under the site root
  for (const p of ['/llms.txt', '/skill.md', '/v1/world/snapshot']) { r = await api(p); assert.equal(r.headers.get('x-robots-tag'), NOINDEX, p); }

  // listing and unlisting apply at once, to both the sitemap and the header
  assert.equal((await post('/__sim/op/set-unlisted', { slug: 'hidden-garden', unlisted: false })).status, 200);
  assert.deepEqual((await locs()).sort(), ['/', '/changelog', '/w/garden/', '/w/hidden-garden/']);
  assert.equal((await api('/w/hidden-garden/v1/config')).headers.get('x-robots-tag'), null);
  assert.equal((await post('/__sim/op/set-unlisted', { slug: 'garden', unlisted: true })).status, 200);
  assert.deepEqual(await locs(), ['/', '/changelog', '/w/hidden-garden/']);
  assert.equal((await api('/w/garden/v1/config')).headers.get('x-robots-tag'), NOINDEX);
});
