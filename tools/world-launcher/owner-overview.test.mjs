import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { collectOverview } from './owner-overview-collect.mjs';
import { checkpointFrom, projectRecords, presentSnapshot, recordUrl, validateSnapshot, MAX_AGE_MS } from './owner-overview-data.mjs';
import { productionSettings } from './production.mjs';
import { slugFor } from './registry.mjs';
import { ownerOverview, overviewShell } from './owner-overview.mjs';
const at = '2026-11-02T10:00:00.000Z';
const cp = { at, state: 'active', changed: 'A focused result', next: 'Owner checkpoint', eta: { range: 'unknown', confidence: 'unknown', basis: 'Final validation not measured' }, sha: 'a'.repeat(40), proofs: [{ url: 'https://github.com/genekogan/souls/pull/600', outcome: 'candidate', environment: 'local' }] };
const comment = (v = cp) => ({ body: '```ops-checkpoint\n' + JSON.stringify(v) + '\n```', updatedAt: at, author: { login: 'worker' }, authorAssociation: 'COLLABORATOR', url: 'https://github.com/genekogan/souls/issues/556#issuecomment-123' });
const issue = (n = 556, comments = [comment()]) => ({ number: n, title: 'Performance <img onerror="bad()">', url: `https://github.com/genekogan/souls/issues/${n}`, updatedAt: at, state: 'OPEN', assignees: [{ login: 'actual-owner' }], comments, labels: [] });
const snapshot = () => projectRecords({ issues: [issue()], observedAt: at });

test('projection separates observation, checkpoint, merge, release and live qualification; links stay source journals', () => {
  const p = { number: 600, title: 'Change', url: 'https://github.com/genekogan/souls/pull/600', state: 'MERGED', mergedAt: at, headRefName: 'agent/556-perf', headRefOid: 'b'.repeat(40), closingIssuesReferences: [{ number: 556 }] };
  let s = projectRecords({ issues: [issue()], pulls: [p], observedAt: at });
  assert.equal(s.items[0].lifecycle, 'source issue only'); assert.equal(s.items[0].relatedLifecycle, 'merged'); assert.equal(s.items[0].group, 'Now'); assert.equal(s.items[0].sha, p.headRefOid);
  const release = { name: '4.14', html_url: 'https://github.com/genekogan/souls/releases/tag/4.14', published_at: at, body: 'Included #600' };
  s = projectRecords({ issues: [issue()], pulls: [p], releases: [release], observedAt: at });
  assert.equal(s.items[0].lifecycle, 'source issue only'); assert.equal(s.items[0].relatedLifecycle, 'released'); assert.equal(s.items[0].group, 'Now');
  const open = { ...p, number: 601, mergedAt: null, state: 'OPEN' };
  s = projectRecords({ issues: [issue()], pulls: [open, p], releases: [release], observedAt: at });
  assert.equal(s.items[0].lifecycle, 'branch-only'); assert.equal(s.items[0].group, 'Now'); assert.equal(s.items[0].relatedLifecycle, 'released');
  s = projectRecords({ issues: [{ ...issue(556, []), state: 'CLOSED' }], pulls: [p], releases: [release], observedAt: at });
  assert.equal(s.items[0].lifecycle, 'released'); assert.equal(s.items[0].group, 'Recently shipped');
  assert.deepEqual(s.items[0].owner, ['actual-owner']);
  assert.equal(recordUrl('https://cdn.example/private.mp4?token=secret'), null);
  assert.equal(recordUrl('javascript:alert(1)'), null);
  assert.equal(recordUrl('https://github.com/genekogan/souls/pull/600?token=x'), null);
  assert.equal(recordUrl('https://user:password@github.com/genekogan/souls/pull/600'), null);
});

test('malformed, future or missing checkpoints stay missing; timestamps are not refresh time', () => {
  assert.equal(checkpointFrom([comment({ ...cp, at: '2027-01-01' })], at), null);
  assert.equal(checkpointFrom([{ ...comment(), body: '```ops-checkpoint\n{"invalid"}\n```' }], at), null);
  assert.equal(checkpointFrom([comment({ ...cp, state: '99% done' })], at), null);
  const s = snapshot(), t = Date.parse(at) + MAX_AGE_MS + 1;
  const d = presentSnapshot(s, t); assert.equal(d.source.state, 'stale'); assert.equal(d.items[0].checkpointStale, true); assert.equal(d.items[0].checkpoint.at, at);
  assert.equal(presentSnapshot(null, t).source.state, 'unavailable');
  assert.equal(presentSnapshot(s, Date.parse(at), 'invalid').source.state, 'stale');
  const missing = projectRecords({ issues: [issue(560, [])], observedAt: at });
  assert.equal(missing.items[0].checkpoint, null); assert.equal(missing.items[0].group, 'Next');
});

test('schema strips extra fields and rejects invalid cache; proof media is never exported', () => {
  const s = snapshot(); s.secret = 'do-not-export'; s.items[0].rawBody = 'secret'; s.items[0].checkpoint.proofs.push({ url: 'https://private.example/secret.mp4', outcome: 'passed' });
  const clean = validateSnapshot(s); assert.equal(JSON.stringify(clean).includes('secret'), false); assert.equal(clean.items[0].checkpoint.proofs.length, 1);
  assert.throws(() => validateSnapshot({ ...s, version: 2 }));
  assert.throws(() => validateSnapshot({ ...s, items: [{ ...s.items[0], group: 'evil' }] }));
  const page = overviewShell({ clerkPublishableKey: '</script><script>bad', clerkIssuer: 'https://clerk.example.test' });
  assert.equal(page.html.includes('</script><script>bad'), false); assert.match(page.csp, /sha256-/);
  const scripts = page.csp.split(';').find(x => x.trim().startsWith('script-src')).trim().split(/\s+/);
  assert.ok(scripts.includes('https://clerk.example.test')); assert.equal(scripts.includes('https://*.clerk.example.test'), false);
});

test('collector is deterministic, private and atomic; failed API call preserves last observation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'owner-collect-')), file = join(dir, 'owner-overview.json');
  try {
    const run = async args => args[0] === 'issue' ? issue(Number(args[2])) : [];
    const s = await collectOverview(file, run, () => at); assert.equal(s.items.length, 6); assert.equal(statSync(file).mode & 0o777, 0o600);
    const before = readFileSync(file, 'utf8');
    await assert.rejects(collectOverview(file, async () => { throw new Error('offline'); }, () => '2026-11-03T10:00:00Z'));
    assert.equal(readFileSync(file, 'utf8'), before); assert.equal(JSON.stringify(s).includes('ops-checkpoint'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP boundary: data-free shell, strict auth, private cache, no static/media methods; retain stale cache on failure', async () => {
  const old = process.env.SIM_SITE_OWNERS; process.env.SIM_SITE_OWNERS = 'acct_owner';
  const dir = mkdtempSync(join(tmpdir(), 'owner-http-')); const dataDir = join(dir, 'data'); mkdirSync(dataDir);
  const file = join(dataDir, 'owner-overview.json'); writeFileSync(file, JSON.stringify(snapshot()));
  const app = ownerOverview({ dataDir, auth: { public: {} }, base: '/worlds', now: () => Date.parse(at), allowed: async (req, direct) => { assert.equal(direct, false); return req.headers.authorization === 'Bearer owner' ? 200 : req.headers.authorization === 'Bearer other' ? 403 : 401; } });
  const server = createServer((req, res) => app.handle(req, res, new URL(req.url, 'http://test'))); await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/ops', '/worlds/ops']) { const r = await fetch(origin + path); assert.equal(r.status, 200); const html = await r.text(); for (const secret of ['actual-owner', 'A focused result', 'Performance <img', 'owner-overview.json']) assert.equal(html.includes(secret), false); }
    for (const [auth, status] of [[null, 401], ['Bearer other', 403], ['Bearer owner', 200]]) {
      const r = await fetch(origin + '/ops?json=1', { headers: auth ? { authorization: auth } : {} }); assert.equal(r.status, status); assert.equal(r.headers.get('cache-control'), 'private, no-store, max-age=0'); assert.match(r.headers.get('vary'), /Cookie/);
      const body = await r.text(); if (status !== 200) assert.equal(body.includes('actual-owner'), false);
    }
    const ownerHeaders = { authorization: 'Bearer owner' };
    let r = await fetch(origin + '/ops?json=1', { method: 'HEAD', headers: ownerHeaders }); assert.equal(r.status, 200); assert.equal(await r.text(), '');
    writeFileSync(file, '{invalid'); r = await fetch(origin + '/ops?json=1', { headers: ownerHeaders }); assert.equal((await r.json()).source.state, 'stale');
    for (const path of ['/ops/snapshot.json', '/ops/proof.mp4', '/ops/owner-overview.json']) { r = await fetch(origin + path, { headers: ownerHeaders }); assert.equal(r.status, 404); assert.equal((await r.text()).includes('actual-owner'), false); }
    r = await fetch(origin + '/ops', { method: 'POST', headers: ownerHeaders }); assert.equal(r.status, 405);
    process.env.SIM_SITE_OWNERS = ' '; r = await fetch(origin + '/ops?json=1', { headers: ownerHeaders }); assert.equal(r.status, 503);
  } finally { await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); if (old === undefined) delete process.env.SIM_SITE_OWNERS; else process.env.SIM_SITE_OWNERS = old; }
});

test('untrusted public comments cannot set worker status; assigned owners and collaborators can; needs:gene wins', () => {
  const untrusted = { ...comment(), author: { login: 'drive-by' }, authorAssociation: 'NONE' };
  let s = projectRecords({ issues: [issue(556, [untrusted])], observedAt: at });
  assert.equal(s.items[0].checkpoint, null); assert.equal(s.items[0].group, 'Next');
  const assigned = { ...untrusted, author: { login: 'actual-owner' } };
  s = projectRecords({ issues: [issue(556, [assigned])], observedAt: at });
  assert.equal(s.items[0].checkpoint.author, 'actual-owner'); assert.equal(validateSnapshot(s).items[0].checkpoint.author, 'actual-owner');
  s = projectRecords({ issues: [{ ...issue(), labels: [{ name: 'needs:gene' }] }], observedAt: at });
  assert.equal(s.items[0].group, 'Needs you');
});

test('incidental issue mentions do not attribute another domain PR or its branch to the tracked work', () => {
  const unrelated = { number: 601, body: 'Preserve active performance #556; no renderer changes.', state: 'OPEN', headRefName: 'agent/560-coordination' };
  let s = projectRecords({ issues: [issue()], pulls: [unrelated], observedAt: at });
  assert.equal(s.items[0].pulls.length, 0); assert.equal(s.items[0].branch, null);
  s = projectRecords({ issues: [issue()], pulls: [{ ...unrelated, body: 'Refs #556' }], observedAt: at });
  assert.equal(s.items[0].pulls.length, 1); assert.equal(s.items[0].branch, unrelated.headRefName);
});

test('the root overview namespace cannot be the launcher mount; similarly named world and unrelated prefixes stay valid', () => {
  const cfg = { range: [19952, 19953], devAuth: true };
  for (const base of ['/ops', '/ops/', '/ops/children']) assert.throws(() => productionSettings({ ...cfg, base }, 'http://127.0.0.1:19951'), /belongs to the existing release|one path segment/);
  for (const base of ['', '/worlds', '/ops-other']) assert.equal(productionSettings({ ...cfg, base }, 'http://127.0.0.1:19951').base, base);
  assert.equal(slugFor('Ops'), 'ops', 'world identity remains distinct at /w/ops');
});
