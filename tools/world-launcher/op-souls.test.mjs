// node --test tools/world-launcher/op-souls.test.mjs — lane OPS2: the operator's TEST-Soul commands end to end, through
// op.mjs, the launcher (Clerk mode, real Sim world processes with fake minds, $0) and the world (apps/server/src/op-souls.ts).
// Lane ports: proxy and children on a block (OPSOULS_TEST_PORT picks the block, else a free one). A synthetic Clerk issuer, as launcher-auth.test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openLauncher } from './launcher.mjs';
import { notTestWorld, deniedSoul, opSoul, NEVER_TEST_SLUGS } from './op-souls.mjs';
import { clerkKeys, ISSUER, PUBLISHABLE_KEY } from '../../apps/server/test/clerk-fixture.ts';
import { testPort } from '../../apps/server/test/test-port.ts';

const PORT = Number(process.env.OPSOULS_TEST_PORT ?? await testPort(9)), RANGE = [PORT + 1, PORT + 8], ORIGIN = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'launcher-op-souls-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
const preload = new URL('../../apps/server/test/clerk-jwks-preload.mjs', import.meta.url).pathname;
const OP = new URL('./op.mjs', import.meta.url).pathname;
let L, sign;
const api = (p, o = {}) => fetch(`${ORIGIN}${p}`, o);
const post = async (p, body, headers = {}) => { const r = await api(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
/** op.mjs itself, as the release owner runs it on eden2 */
const op = async (...args) => {
  try { const { stdout } = await promisify(execFile)(process.execPath, [OP, args[0], '--port', String(PORT), ...args.slice(1)]); return { code: 0, ...JSON.parse(stdout) }; }
  catch (e) { if (e.code === 2) return { code: 2, usage: String(e.stderr) }; return { code: e.code, ...JSON.parse(e.stdout) }; }
};
const auditRows = () => readFileSync(join(dir, 'data', 'audit.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

before(async () => {
  const keys = await clerkKeys(ORIGIN); sign = keys.sign;
  writeFileSync(join(dir, 'jwks.json'), JSON.stringify({ keys: [keys.jwk] }));
  const envFile = join(dir, 'clerk.env');
  writeFileSync(envFile, [`CLERK_PUBLISHABLE_KEY=${PUBLISHABLE_KEY}`, `CLERK_ISSUER_URL=${ISSUER}`, `CLERK_AUTHORIZED_PARTIES=${ORIGIN}`,
    `SIM_TEST_JWKS_FILE=${join(dir, 'jwks.json')}`, `NODE_OPTIONS=--import=${preload}`, 'DEV_AUTH=1', ''].join('\n'));
  L = await openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), templatesDir, authEnvFile: envFile, publicOrigin: ORIGIN, eager: 0, log: () => {} });
});
// world processes may still be flushing their compile cache into <data> after close: a leftover tmp dir is not a failure
after(async () => { await L?.close(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {} });

test('guards without a world process: test flag or allowlist, never product worlds or forks, Gene\'s Souls by id and name', () => {
  const d = mkdtempSync(join(tmpdir(), 'op-souls-guard-'));
  try {
    assert.equal(notTestWorld(null, d)[1], 'not-found');
    assert.equal(notTestWorld({ slug: 'bench-hamlet' }, d)[1], 'op.not-test-world', 'scratch by name is not enough: it must be flagged');
    assert.equal(notTestWorld({ slug: 'bench-hamlet', test: true }, d), null);
    writeFileSync(join(d, 'op-test-worlds.json'), JSON.stringify(['release-probe', 'eden-2026']));
    assert.equal(notTestWorld({ slug: 'release-probe' }, d), null, 'listed in op-test-worlds.json');
    for (const slug of NEVER_TEST_SLUGS) assert.equal(notTestWorld({ slug, test: true }, d)[1], 'op.not-test-world', slug);
    assert.equal(notTestWorld({ slug: 'eden', fork: { slug: 'eden' }, test: true }, d)[1], 'op.not-test-world');
    assert.ok(deniedSoul(d, 's_c8520a0a76', 'TestAnything')); assert.ok(deniedSoul(d, 's_x', 'Kwyjibo')); assert.ok(deniedSoul(d, undefined, 'TestKwyjibo2'));
    assert.ok(!deniedSoul(d, 's_0f72ce999a', 'TestMsg'));
    writeFileSync(join(d, 'op-deny-souls.json'), JSON.stringify({ ids: ['s_aaaaaaaaaa'], names: ['Gene.Agent'] }));
    assert.ok(deniedSoul(d, 's_aaaaaaaaaa', 'TestX')); assert.ok(deniedSoul(d, 's_b', 'Test gene.agent')); assert.ok(!deniedSoul(d, 's_b', 'Test geneXagent'), 'names are literal, not patterns');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('op.mjs soul-*: approve a TEST Soul on a test world, message it as the card does, read its inbox, delete it; every guard', { timeout: 300_000 }, async () => {
  const gene = await sign('user_gene');
  const made = await post('/__sim/worlds', { name: 'Release probe', template: 'empty' }, { authorization: `Bearer ${gene}` });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const slug = made.data.slug, base = `/w/${slug}`;
  // not flagged yet: every command is refused before the world is called
  const before = await op('soul-pending', '--slug', slug);
  assert.equal(before.status, 403); assert.equal(before.code, 'op.not-test-world');
  // the flag: product worlds never; this scratch world yes
  assert.equal((await op('set-test', '--slug', 'eden-2026', '--test', 'true')).status, 404, 'no such world here');
  assert.equal((await op('set-test', '--slug', slug, '--test', 'true')).status, 200);
  // through the public proxy (x-forwarded-for) an operator command is refused
  assert.equal((await post('/__sim/op/soul-pending', { slug }, { 'x-forwarded-for': '203.0.113.7' })).status, 403);
  assert.equal((await post('/__sim/op/set-test', { slug, test: false }, { 'x-forwarded-for': '203.0.113.7' })).status, 403);
  // and the world's own routes answer nobody but the launcher (no site key)
  assert.equal((await post(`${base}/v1/op/souls/pending`, {})).status, 404);
  // a test agent asks for a Soul (no window code: a plain link request), and a real-looking one asks too
  const ask = async (name) => { const pollSecret = randomBytes(32).toString('base64url'), r = await post(`${base}/v1/agent/approval/start`, { agentLabel: 'eden-agent test', name, idempotencyKey: 'op-souls-e2e-' + name + '-' + randomBytes(4).toString('hex'), pollSecret }); assert.equal(r.status, 200, JSON.stringify(r.data)); return { id: r.data.approval.id, pollSecret }; };
  const mine = await ask('TestProbe'), real = await ask('Qwyjibo'), kw = await ask('TestKwyjibo');
  const pending = await op('soul-pending', '--slug', slug);
  assert.equal(pending.status, 200, JSON.stringify(pending));
  assert.deepEqual(Object.fromEntries(pending.pending.map((p) => [p.name, p.test])), { TestProbe: true, Qwyjibo: false, TestKwyjibo: false });
  assert.equal((await op('soul-approve', '--slug', slug, '--request', real.id, '--name', 'Qwyjibo')).code, 'op.not-test-soul');
  assert.equal((await op('soul-approve', '--slug', slug, '--request', kw.id, '--name', 'TestKwyjibo')).code, 'op.denied-soul');
  assert.equal((await op('soul-approve', '--slug', slug, '--request', mine.id, '--name', 'TestOther')).code, 'op.name-mismatch');
  assert.equal((await op('soul-approve', '--slug', slug, '--request', mine.id)).code, 2, 'usage: the name is required');
  const approved = await op('soul-approve', '--slug', slug, '--request', mine.id, '--name', 'TestProbe');
  assert.equal(approved.status, 200, JSON.stringify(approved)); assert.equal(approved.owner, 'op:test-operator');
  // the agent's own poll ends with its Soul token, unattended
  let polled;
  for (let i = 0; i < 100; i++) { polled = (await post(`${base}/v1/agent/approval/poll`, { approvalId: mine.id, pollSecret: mine.pollSecret })).data; if (polled.token) break; await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(polled.status, 'ready', JSON.stringify(polled)); assert.match(polled.token, /^sim_s_/);
  const soulId = polled.soulId;
  // Gene's Soul by id is refused before the world is asked
  assert.equal((await op('soul-message', '--slug', slug, '--soul', 's_c8520a0a76', '--name', 'Kwyjibo', '--text', 'hi')).code, 'op.denied-soul');
  // the owner message, then the agent hears it on its inbox and acknowledges it; the operator reads the ack state
  const sent = await op('soul-message', '--slug', slug, '--soul', soulId, '--name', 'TestProbe', '--text', 'walk to the well');
  assert.equal(sent.status, 200, JSON.stringify(sent)); assert.equal(sent.inbox.latest.text, 'walk to the well');
  const agent = { authorization: `Bearer ${polled.token}` };
  const heard = await (await api(`${base}/v1/edge/inbox/listen?timeoutMs=1000`, { headers: agent })).json();
  const msg = heard.backlog?.[0] ?? heard.inbox?.latest;
  assert.equal(msg?.id, sent.inbox.latest.id, JSON.stringify(heard));
  const ack = await post(`${base}/v1/edge/inbox/${msg.id}/ack`, { reply: 'On my way.' }, agent);
  assert.equal(ack.status, 200, JSON.stringify(ack.data));
  const read = await op('soul-inbox', '--slug', slug, '--soul', soulId, '--name', 'TestProbe');
  assert.equal(read.status, 200); assert.equal(read.inbox.latest.state, 'acknowledged'); assert.equal(read.inbox.latest.reply, 'On my way.');
  // delete by name + id (a wrong name is refused), then nothing answers for it
  assert.equal((await op('soul-delete', '--slug', slug, '--soul', soulId, '--name', 'TestOther')).code, 'op.name-mismatch');
  assert.equal((await op('soul-delete', '--slug', slug, '--soul', soulId, '--name', 'TestProbe')).status, 200);
  let gone; for (let i = 0; i < 50; i++) { gone = await op('soul-inbox', '--slug', slug, '--soul', soulId, '--name', 'TestProbe'); if (gone.status === 404) break; await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(gone.status, 404);
  // unflagged again: refused again
  assert.equal((await op('set-test', '--slug', slug, '--test', 'false')).status, 200);
  assert.equal((await op('soul-pending', '--slug', slug)).code, 'op.not-test-world');
  // the journal: every call, by operator; the message text never
  const rows = auditRows().filter((r) => r.slug === slug);
  assert.ok(rows.length >= 15, String(rows.length)); assert.ok(rows.every((r) => r.by === 'operator'));
  assert.deepEqual(rows.filter((r) => r.op === 'soul-approve' && r.status === 200).map((r) => [r.name, r.soulId]), [['TestProbe', soulId]]);
  assert.equal(JSON.stringify(rows).includes('walk to the well'), false);
  assert.equal(rows.find((r) => r.op === 'soul-message' && r.status === 200).chars, 16);
});

test('god-approve guards without a world process: product worlds and unflagged worlds are refused before the world is called', async () => {
  const d = mkdtempSync(join(tmpdir(), 'op-god-guard-'));
  try {
    let called = 0; const call = async () => { called++; return [200, { ok: true }]; };
    const run = (w, body) => opSoul({ verb: 'god-approve', body: { slug: w.slug, code: 'ABCD-EFGH', ...body }, registry: { get: () => w }, dataDir: d, ensure: async () => 1, call });
    for (const slug of NEVER_TEST_SLUGS) assert.equal((await run({ slug, test: true }))[1].code, 'op.not-test-world', slug);
    assert.equal((await run({ slug: 'bench-hamlet' }))[1].code, 'op.not-test-world', 'bench-hamlet is not flagged test');
    assert.equal((await run({ slug: 'release-probe', test: true }, { code: '' }))[1].code, 'invalid', 'the code is required');
    assert.equal(called, 0);
    assert.equal((await run({ slug: 'release-probe', test: true }))[0], 200); assert.equal(called, 1);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('op.mjs god-pending/god-approve: the owner\'s god pairing approved unattended on a scratch test world; refused once a person\'s Soul lives there', { timeout: 300_000 }, async () => {
  const gene = await sign('user_godprobe'), auth = { authorization: `Bearer ${gene}` };
  const made = await post('/__sim/worlds', { name: 'God probe', template: 'empty' }, auth);
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const slug = made.data.slug, base = `/w/${slug}`;
  const pair = async (agent) => { const r = await post(`${base}/v1/god/pair/start`, { agent }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const first = await pair('release-probe');
  // not flagged: refused before the world is asked
  assert.equal((await op('god-pending', '--slug', slug)).code, 'op.not-test-world');
  assert.equal((await op('god-approve', '--slug', slug, '--code', first.user_code)).code, 'op.not-test-world');
  assert.equal((await op('god-approve', '--slug', slug)).code, 2, 'usage: the code is required');
  assert.equal((await post('/__sim/op/god-approve', { slug, code: first.user_code }, { 'x-forwarded-for': '203.0.113.7' })).status, 403);
  assert.equal((await post(`${base}/v1/op/god/approve`, { code: first.user_code })).status, 404, 'the world answers only the launcher');
  assert.equal((await op('set-test', '--slug', slug, '--test', 'true')).status, 200);
  const pending = await op('god-pending', '--slug', slug);
  assert.equal(pending.status, 200, JSON.stringify(pending)); assert.equal(pending.owned, true);
  assert.deepEqual(pending.pending.map((p) => p.agent), ['release-probe']);
  assert.equal((await op('god-approve', '--slug', slug, '--code', 'ZZZZ-ZZZZ')).code, 'pair-invalid');
  const ok = await op('god-approve', '--slug', slug, '--code', first.user_code.toLowerCase());
  assert.equal(ok.status, 200, JSON.stringify(ok));
  const polled = (await post(`${base}/v1/god/pair/poll`, { poll_token: first.poll_token })).data;
  assert.equal(polled.status, 'approved', JSON.stringify(polled)); assert.ok(polled.token);
  const status = await (await api(`${base}/v1/god/status`, { headers: { authorization: `Bearer ${polled.token}` } })).json();
  assert.equal(status.you, 'god', JSON.stringify(status));
  // a person's Soul arrives (bench-hamlet holds Kwyjibo): from then on the operator never approves a god here
  const pollSecret = randomBytes(32).toString('base64url');
  const asked = await post(`${base}/v1/agent/approval/start`, { agentLabel: 'eden-agent test', name: 'Kwyjibo', idempotencyKey: 'op-god-e2e-' + randomBytes(4).toString('hex'), pollSecret });
  assert.equal(asked.status, 200, JSON.stringify(asked.data));
  const yes = await post(`${base}/v1/account/approvals/${asked.data.approval.id}/approve`, {}, auth);
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  let soul; for (let i = 0; i < 100; i++) { soul = (await post(`${base}/v1/agent/approval/poll`, { approvalId: asked.data.approval.id, pollSecret })).data; if (soul.token) break; await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(soul.status, 'ready', JSON.stringify(soul));
  const second = await pair('release-probe-2');
  const refused = await op('god-approve', '--slug', slug, '--code', second.user_code);
  assert.equal(refused.status, 409, JSON.stringify(refused)); assert.equal(refused.code, 'op.foreign-souls');
  assert.equal((await post(`${base}/v1/god/pair/poll`, { poll_token: second.poll_token })).data.status, 'pending');
  const rows = auditRows().filter((r) => r.slug === slug && r.op.startsWith('god-'));
  assert.ok(rows.every((r) => r.by === 'operator')); assert.equal(rows.filter((r) => r.op === 'god-approve' && r.status === 200).length, 1);
  assert.equal(JSON.stringify(rows).includes(first.user_code), false, 'pairing codes are never journaled');
});
