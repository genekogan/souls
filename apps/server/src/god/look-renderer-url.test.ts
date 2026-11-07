import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rendererWorldUrl } from './look-renderer-url.ts';
import {testPort} from '../../test/test-port.ts';
const TEST_PORT=await testPort(2);

// The launcher is a JavaScript test API without TypeScript declarations.
const { openLauncher } = await import(new URL('../../../../tools/world-launcher/launcher.mjs', import.meta.url).href);

const child = 'http://127.0.0.1:4628/worlds/w/eden-2026';
test('context uses the configured loopback launcher with the exact world path', () => {
  for (const suffix of ['', '/']) {
    assert.equal(rendererWorldUrl(child + suffix, true, 'http://127.0.0.1:4620/worlds/').href,
      'http://127.0.0.1:4620/worlds/w/eden-2026' + suffix);
    assert.equal(rendererWorldUrl('http://127.0.0.1:4678/w/eden' + suffix, true, 'http://127.0.0.1:4670/').href,
      'http://127.0.0.1:4670/w/eden' + suffix);
  }
  assert.equal(rendererWorldUrl(child, true).href, child, 'standalone context retains its child origin');
  assert.equal(rendererWorldUrl(child, false, 'https://attacker.invalid/worlds').href, child,
    'legacy God look does not consult the context launcher setting');
});

test('renderer routing refuses unsafe configuration before choosing a launcher', () => {
  const unsafe = ['broken', '', 'https://127.0.0.1:4620/worlds', 'http://localhost:4620/worlds',
    'http://127.0.0.2:4620/worlds', 'http://attacker.invalid/worlds', 'http://user:pass@127.0.0.1:4620/worlds',
    'http://127.0.0.1:4620/worlds?asset=external', 'http://127.0.0.1:4620/worlds#fragment'];
  for (const url of unsafe) {
    assert.throws(() => rendererWorldUrl(child, true, url), /127\.0\.0\.1 HTTP URL/);
    assert.throws(() => rendererWorldUrl(url, true, 'http://127.0.0.1:4620/worlds'), /127\.0\.0\.1 HTTP URL/);
  }
  for (const base of ['/world', '/worlds/w', '/worlds-other', '/']) {
    assert.throws(() => rendererWorldUrl(child, true, 'http://127.0.0.1:4620' + base), /launcher base/);
  }
  for (const path of ['/worlds-other/w/eden', '/worlds/w/', '/worlds/w/eden/extra']) {
    assert.throws(() => rendererWorldUrl('http://127.0.0.1:4628' + path, true, 'http://127.0.0.1:4620/worlds'), /launcher base/);
  }
  for (const base of ['//worlds', '/%77orlds', '/worlds/nested', '/worlds//']) {
    assert.throws(() => rendererWorldUrl(`http://127.0.0.1:4628${base}/w/eden`, true, `http://127.0.0.1:4620${base}`), /launcher base/);
  }
});

test('production-prefixed context HTML loads JavaScript through the real launcher instead of child fallback HTML', { timeout: 30_000 }, async () => {
  const port = TEST_PORT, childPort = TEST_PORT + 1, origin = `http://127.0.0.1:${port}`;
  const dir = mkdtempSync(join(tmpdir(), 'context-renderer-route-'));
  const webDir = join(dir, 'web'), templatesDir = join(dir, 'templates');
  mkdirSync(join(webDir, 'assets'), { recursive: true }); mkdirSync(templatesDir);
  const scriptPath = '/worlds/assets/contextView-fixture.js';
  const html = `<!doctype html><script type="module" src="${scriptPath}"></script>`;
  const module = 'import "./contextDependency-fixture.js"; window.contextRender = async () => ({data: "fixture"});';
  const dependency = 'export const fixture = true;';
  writeFileSync(join(webDir, 'index.html'), '<title>Fallback world index</title>');
  writeFileSync(join(webDir, 'context-view.html'), html);
  writeFileSync(join(webDir, 'assets/contextView-fixture.js'), module);
  writeFileSync(join(webDir, 'assets/contextDependency-fixture.js'), dependency);
  // A child has the same sealed HTML and unprefixed static assets as production.
  // The launcher itself supplies /worlds/assets; do not rewrite any HTML bytes.
  const fixture = `
    import {createServer} from 'node:http';
    import {readFileSync} from 'node:fs';
    import {join} from 'node:path';
    createServer((req,res) => {
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      if (path.endsWith('/healthz')) return res.writeHead(200, {'content-type':'application/json'}).end('{"ok":true}');
      const context = path === process.env.WORLD_PATH + '/context-view';
      const asset = /^\\/assets\\/[a-zA-Z0-9.-]+\\.js$/.test(path);
      const file = context ? 'context-view.html' : asset ? path.slice(1) : 'index.html';
      res.writeHead(200, {'content-type':asset ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8'});
      res.end(readFileSync(join(process.env.WEB_DIR, file)));
    }).listen(Number(process.env.PORT), '127.0.0.1');`;
  let launcher: { close(): Promise<void> } | undefined;
  const get = (url: string | URL) => fetch(url, { signal: AbortSignal.timeout(10_000) });
  try {
    launcher = await openLauncher({ port, range: [childPort, childPort], base: '/worlds', dataDir: join(dir, 'data'),
      templatesDir, webDir, eager: 0, compileCache: false, sleepMs: 0, devAuth: true,
      command: (world: { slug: string }, assignedPort: number) => ({ cmd: process.execPath, args: ['--input-type=module', '-e', fixture],
        env: { PATH: process.env.PATH, PORT: String(assignedPort), WORLD_PATH: `/worlds/w/${world.slug}` } }), log: () => {} });
    const created = await fetch(`${origin}/worlds/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Context Route Fixture' }), signal: AbortSignal.timeout(15_000) });
    assert.equal(created.status, 201);
    const { slug } = await created.json() as { slug: string };
    const childWorld = `http://127.0.0.1:${childPort}/worlds/w/${slug}`;
    const directHtml = await get(childWorld + '/context-view');
    assert.equal(await directHtml.text(), html);
    const brokenModule = await get(new URL(scriptPath, childWorld));
    assert.match(brokenModule.headers.get('content-type')!, /^text\/html/);
    assert.equal(await brokenModule.text(), '<title>Fallback world index</title>', 'a 200 alone hides the production failure');

    const selected = rendererWorldUrl(childWorld, true, `${origin}/worlds`);
    assert.equal(selected.href, `${origin}/worlds/w/${slug}`);
    const page = await get(selected.href + '/context-view');
    assert.equal(page.status, 200); assert.equal(await page.text(), html, 'sealed renderer HTML bytes are unchanged');
    const moduleUrl = new URL(scriptPath, selected);
    const response = await get(moduleUrl);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /(?:javascript|ecmascript)/);
    assert.equal(await response.text(), module);
    const imported = new URL('./contextDependency-fixture.js', moduleUrl);
    assert.equal(imported.origin, selected.origin, 'module dependencies remain within the existing same-origin policy');
    const dependencyResponse = await get(imported);
    assert.equal(dependencyResponse.status, 200); assert.match(dependencyResponse.headers.get('content-type')!, /(?:javascript|ecmascript)/);
    assert.equal(await dependencyResponse.text(), dependency);
  } finally { await launcher?.close(); rmSync(dir, { recursive: true, force: true }); }
});
