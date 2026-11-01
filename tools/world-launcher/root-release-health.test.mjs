import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkRootHealth, ROOT_WORLDS } from './deploy/ship/health.mjs';

const BUILD = 'we-0123456789ab';
// A loopback HTTP mirror exercises actual fetch/redirect semantics; it is not a deployment rehearsal.
async function mirror(t, fault = '') {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.url);
    const url = new URL(req.url, 'http://mirror.invalid');
    if (url.pathname === '/__sim/healthz') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, build: fault === 'stale-build' ? 'we-999999999999' : BUILD, worlds: 9, hostOk: fault !== 'unhealthy' })); return;
    }
    for (const [slug, old] of ROOT_WORLDS) {
      if ([`/w/${slug}/v1/config`, `/w/${old}/v1/config`, `/worlds/w/${old}/v1/config`].includes(url.pathname)) {
        const alias = url.pathname.includes(old);
        if (alias && fault === 'api-redirect') { res.writeHead(308, { location: `/w/${slug}/v1/config` }); res.end(); return; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ build: BUILD, worldKey: slug, worldPath: `/w/${slug}`, worldId: alias && fault === 'wrong-identity' ? 'other' : `retained-${old}` })); return;
      }
      if ([`/w/${old}/`, `/worlds/w/${old}/`].includes(url.pathname)) {
        res.writeHead(308, { location: `${fault === 'cross-origin' ? 'https://other.invalid' : ''}/w/${slug}/${fault === 'lost-query' ? '' : url.search}` }); res.end(); return;
      }
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { origin: `http://127.0.0.1:${server.address().port}`, seen };
}

test('root health accepts canonical identities and both forms of preserved aliases', async t => {
  const m = await mirror(t), result = await checkRootHealth(m.origin, BUILD);
  assert.equal(result.status, 'pass', JSON.stringify(result));
  assert.equal(m.seen.length, 16);
  assert.ok(m.seen.includes('/worlds/w/my-mars-college-2026-3/v1/config'));
});
for (const fault of ['stale-build', 'unhealthy', 'api-redirect', 'wrong-identity', 'cross-origin', 'lost-query']) {
  test(`root health refuses ${fault} with an honest failed receipt`, async t => {
    const m = await mirror(t, fault), result = await checkRootHealth(m.origin, BUILD);
    assert.equal(result.status, 'fail'); assert.ok(result.checks.some(c => !c.ok)); assert.ok(result.error);
  });
}
test('root health records transport failures without claiming a check passed', async () => {
  const result = await checkRootHealth('https://mirror.invalid', BUILD, async () => { throw Error('interrupted connection'); });
  assert.equal(result.status, 'fail'); assert.equal(result.error, 'interrupted connection');
  assert.deepEqual(result.checks.map(c => c.name), ['expected immutable build id']);
});
