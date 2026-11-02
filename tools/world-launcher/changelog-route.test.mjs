// node --test tools/world-launcher/changelog-route.test.mjs (issue #388)
// The launcher serves the web build's changelog.html at <base>/changelog. No world processes; ports 9741–9743 only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';

const dir = mkdtempSync(join(tmpdir(), 'launcher-changelog-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const webDir = join(dir, 'web'); mkdirSync(join(webDir, 'assets'), { recursive: true });
writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Sim</title>');
const PAGE = '<!doctype html><title>Changelog · Sim</title><main><section class="cl-release" id="v4.0"></section></main>';
writeFileSync(join(webDir, 'changelog.html'), PAGE);
const command = () => { throw Error('no world is started in this test'); };
const opts = (port, extra = {}) => ({ port, range: [9743, 9743], dataDir: join(dir, `data-${port}`), webDir, templatesDir, command, eager: 0, log: () => {}, ...extra });

await test('root build: /changelog is the static changelog page, the homepage and unknown paths are unchanged', async () => {
  const L = await openLauncher(opts(9741));
  try {
    const get = (p, o) => fetch(`http://127.0.0.1:9741${p}`, o);
    for (const p of ['/changelog', '/changelog/']) {
      const r = await get(p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type') ?? '', /^text\/html/);
      assert.equal(r.headers.get('cache-control'), 'no-cache', 'a new release shows its changelog at once');
      assert.equal(await r.text(), PAGE);
    }
    const etag = (await get('/changelog')).headers.get('etag');
    assert.equal((await get('/changelog', { headers: { 'if-none-match': etag } })).status, 304);
    assert.equal((await get('/changelog', { method: 'HEAD' })).status, 200);
    assert.match(await (await get('/')).text(), /<title>Sim</, 'the homepage is still index.html');
    assert.equal((await get('/changelogs')).status, 404, 'only the exact path; nothing else is served from the page');
    assert.equal((await get('/changelog.html')).status, 404, 'the file is not served under its build name');
  } finally { await L.close(); }
});

await test('under --base /worlds the page is /worlds/changelog, and nothing outside the base', async () => {
  const L = await openLauncher(opts(9742, { base: '/worlds' }));
  try {
    const get = (p) => fetch(`http://127.0.0.1:9742${p}`);
    const r = await get('/worlds/changelog');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), PAGE);
    assert.equal((await get('/changelog')).status, 404, 'outside the prefix belongs to the other release');
    for(const path of ['/worlds/old','/worlds/old/']){const old=await fetch(`http://127.0.0.1:9742${path}?from=bookmark`,{redirect:'manual'});assert.equal(old.status,308);assert.equal(old.headers.get('location'),'/worlds/?from=bookmark#');assert.equal(await old.text(),'');}
    assert.equal((await get('/old')).status,404,'retired route outside this base remains outside this launcher');
  } finally { await L.close(); }
});
