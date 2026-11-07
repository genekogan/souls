// #894: which world responses may be indexed, and the world page's own title, canonical URL and Open Graph fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toyFactory } from '@souls/engine-toy';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { Db } from './db.ts';
import { buildApp } from './http.ts';
import type { Hub } from './hub.ts';
import { withWorldMeta } from './inline-config.ts';
import { Souls } from './souls.ts';
import { WorldHost } from './world.ts';

const home = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');

test('withWorldMeta: the world page gets its own title, description, canonical and og:url; markup in a name stays text', () => {
  const html = withWorldMeta(home, { name: 'Eden 2026', url: 'https://soul.game/w/eden-2026/' });
  assert.match(html, /<title>Eden 2026 · Souls<\/title>/);
  assert.ok(html.includes('<link rel="canonical" href="https://soul.game/w/eden-2026/" />'));
  assert.ok(html.includes('<meta property="og:url" content="https://soul.game/w/eden-2026/" />'));
  for (const k of ['property="og:title"', 'name="twitter:title"']) assert.ok(html.includes(`<meta ${k} content="Eden 2026 · Souls" />`), k);
  for (const k of ['name="description"', 'property="og:description"', 'name="twitter:description"']) assert.match(html, new RegExp(`<meta ${k} content="Eden 2026, a persistent world in Souls\\.`), k);
  assert.ok(!html.includes('href="https://soul.game/" />'), 'no world page canonicalises to the home page');
  assert.ok(html.includes('"@type":"SoftwareApplication"') && html.includes('og:image'), 'the rest of the head is kept');
  const hostile = withWorldMeta(home, { name: '"><script>x</script>', url: 'https://soul.game/w/x/' });
  assert.ok(!hostile.includes('<script>x</script>') && hostile.includes('&quot;&gt;&lt;script&gt;'));
});

test('the world page and its public guides may be indexed; API, MCP, health, debug and query variants are noindex', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'indexing-')), db = new Db(':memory:');
  const host = new WorldHost(db, toyFactory, 'indexing', 1e9, 'indexing-toy'); host.boot();
  writeFileSync(join(dir, 'index.html'), home);
  const cfg = { ...config, worldKey: 'toy', worldId: host.worldId, worldPath: '/w/toy', publicUrl: 'https://soul.game/w/toy', webDir: dir, marsWebDir: '/nonexistent',
    brainMode: 'fake' as const, budgetUsdPerDay: 0, typesafeKey: undefined, anthropicKey: undefined, privyAppId: '', privyAppSecret: '' };
  const auth = new Auth(cfg, db), brain = new Brain(host, db, cfg, { clients: () => 0, onCall() {}, onCamera() {}, onTicker() {}, onNarrative() {} }), souls = new Souls(host, db, brain, cfg);
  const app = buildApp({ cfg, db, host, auth, brain, souls, hub: { clients: new Map(), refreshMe() {} } as unknown as Hub });
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const robots = async (path: string, method = 'GET') => (await app.request(path, { method })).headers.get('x-robots-tag');
  for (const p of ['/', '/skill.md', '/cards.md']) assert.equal(await robots(p), null, p);
  assert.equal(await robots('/', 'HEAD'), null);
  for (const p of ['/v1/config', '/v1/world', '/v1/debug/world', '/healthz', '/mcp', '/unmatched', '/?dev=1', '/instructions.md?for=K7QX-M2PA', '/v1/nope'])
    assert.equal(await robots(p), 'noindex, nofollow', p);
  assert.equal(await robots('/v1/agent/pair', 'POST'), 'noindex, nofollow');
  const page = await (await app.request('/')).text();
  assert.match(page, /<title>Toy · Souls<\/title>/); assert.ok(page.includes('<link rel="canonical" href="https://soul.game/w/toy/" />'));
});
