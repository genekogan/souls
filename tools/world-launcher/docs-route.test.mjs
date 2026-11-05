// #896: the launcher serves the built docs: HTML pages, their Markdown twins (<path>.md or Accept: text/markdown),
// llms.txt, llms-full.txt and the changelog's twin; the sitemap lists the build's published pages. No world is involved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docFile, openLauncher } from './launcher.mjs';
import { TAKEN_PREFIXES } from './production.mjs';
import { RESERVED } from './registry.mjs';

test('docFile maps docs and changelog paths to build files, and nothing else', () => {
  const cases = [['/docs', '', 'docs/index.html'], ['/docs/', '', 'docs/index.html'], ['/docs.md', '', 'docs.md'], ['/docs', 'text/markdown', 'docs.md'],
    ['/docs/concepts', '', 'docs/concepts/index.html'], ['/docs/concepts/', '', 'docs/concepts/index.html'], ['/docs/concepts.md', '', 'docs/concepts.md'],
    ['/docs/concepts', 'text/markdown, text/plain;q=0.5', 'docs/concepts.md'], ['/docs/concepts', 'text/html,application/xhtml+xml,*/*;q=0.8', 'docs/concepts/index.html'],
    ['/docs/essays/few-rules', '', 'docs/essays/few-rules/index.html'], ['/changelog.md', '', 'changelog.md'], ['/changelog', 'text/markdown', 'changelog.md'],
    ['/changelog', '', null], ['/docs/../etc', '', null], ['/docs/a%2fb', '', null], ['/docsx', '', null], ['/docs/Concepts', '', null], ['/w/docs', '', null]];
  for (const [p, a, want] of cases) assert.equal(docFile(p, a), want, `${p} ${a}`);
});

test('the public paths are taken prefixes and docs is a reserved slug', () => {
  for (const p of ['/docs', '/changelog', '/llms.txt', '/llms-full.txt', '/robots.txt', '/sitemap.xml']) assert.ok(TAKEN_PREFIXES.includes(p), p);
  assert.ok(RESERVED.has('docs'));
});

const PORT = Number(process.env.DOCS_ROUTE_TEST_PORT ?? 7110);
const dir = mkdtempSync(join(tmpdir(), 'launcher-docs-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
writeFileSync(join(templatesDir, 'plain.json'), JSON.stringify({ schema: 'genesis/1', name: 'Plain', description: 'x', batches: [] }));
const webDir = join(dir, 'web'); mkdirSync(join(webDir, 'docs', 'concepts'), { recursive: true });
const files = { 'index.html': '<!doctype html><title>Souls</title>', 'changelog.html': '<!doctype html><title>Changelog</title>', 'changelog.md': '# Changelog\n',
  'docs/index.html': '<!doctype html><title>What Souls is</title>', 'docs.md': '# What Souls is\n', 'docs/concepts/index.html': '<!doctype html><title>Concepts</title>', 'docs/concepts.md': '# Concepts\n',
  'llms.txt': '# Souls\n', 'llms-full.txt': '# What Souls is\n', 'docs/pages.json': JSON.stringify({ pages: [{ url: '/docs' }, { url: '/docs/concepts' }, { url: '/docs/../x' }] }) };
for (const [f, t] of Object.entries(files)) writeFileSync(join(webDir, f), t);
let L;
before(async () => { L = await openLauncher({ port: PORT, range: [PORT + 1, PORT + 3], dataDir: join(dir, 'data'), webDir, templatesDir, eager: 0, log: () => {} }); });
after(async () => { await L?.close(); });
const get = (p, accept) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers: accept ? { accept } : {} });

test('through the launcher: HTML, twins by suffix and by Accept, llms files, changelog twin, sitemap pages; no world, no noindex', async () => {
  const want = [['/docs', undefined, 'text/html', '<title>What Souls is'], ['/docs/', undefined, 'text/html', '<title>What Souls is'], ['/docs.md', undefined, 'text/markdown', '# What Souls is'],
    ['/docs', 'text/markdown', 'text/markdown', '# What Souls is'], ['/docs/concepts', 'text/html', 'text/html', '<title>Concepts'], ['/docs/concepts', 'text/markdown', 'text/markdown', '# Concepts'],
    ['/docs/concepts.md', undefined, 'text/markdown', '# Concepts'], ['/llms.txt', undefined, 'text/plain', '# Souls'], ['/llms-full.txt', undefined, 'text/plain', '# What Souls is'],
    ['/changelog.md', undefined, 'text/markdown', '# Changelog'], ['/changelog', 'text/markdown', 'text/markdown', '# Changelog'], ['/changelog', undefined, 'text/html', '<title>Changelog']];
  for (const [p, accept, type, start] of want) {
    const r = await get(p, accept);
    assert.equal(r.status, 200, `${p} ${accept}`); assert.ok(r.headers.get('content-type').startsWith(type), `${p} ${accept}: ${r.headers.get('content-type')}`);
    assert.equal(r.headers.get('x-robots-tag'), null, p);
    if (p.startsWith('/docs')) assert.equal(r.headers.get('vary'), 'Accept', p);
  }
  for (const [p, accept, , start] of want) assert.ok((await (await get(p, accept)).text()).includes(start.replace(/^<title>/, '')), p);
  assert.equal((await get('/docs/nowhere')).status, 404);
  const locs = [...(await (await get('/sitemap.xml')).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(`http://127.0.0.1:${PORT}`, ''));
  assert.deepEqual(locs, ['/', '/changelog', '/docs', '/docs/concepts'], 'published docs pages from the build; a malformed entry is dropped');
  assert.equal(L.registry.worlds.length, 0);
});
