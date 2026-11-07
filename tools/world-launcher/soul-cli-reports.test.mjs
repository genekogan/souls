// #590: experience reports. Off is the client as if the feature did not exist; on adds one help line, one guide line and one
// command, and the client records its own requests. A fake world over HTTP, the real CLI as a child process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportFacts, reportRoute } from './soul/eden.mjs';
import { factsOf, routeOf } from '../soul-trace/tap.mjs';
import { reconstruct } from '../soul-trace/readout.mjs';

const cli = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const TOKEN = 'sim_s_ada_PLANTEDTOKEN', SPEECH = 'PLANTEDSPEECH said the world';

function world() {
  const seen = [];
  const answer = (req, body) => {
    const p = new URL(req.url, 'http://x').pathname.replace(/^\/w\/t/, '');
    if (p === '/v1/edge/act') return JSON.parse(body).capability === 'walk:no' ? { accepted: false, code: 'route.unreachable', reason: SPEECH, alternatives: [{ id: 'walk:yes', label: SPEECH }] } : { accepted: true, receipt: { id: 'r_1', capability: 'walk:yes', phase: 'completed', endedTick: 9 } };
    if (p === '/v1/edge/here') return { me: { name: 'Ada', posture: 'standing' }, heard: [{ text: SPEECH }], inbox: { queued: 0 } };
    if (p === '/v1/agent/me') return { soul: { id: 's_ada', name: 'Ada' } };
    return {};
  };
  const server = createServer((req, res) => {
    let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body.replace(/"clientRef":"[^"]+"/, '"clientRef":"x"') });
      if (req.url.includes('/events') || req.url.includes('/listen') || req.url.includes('/wait')) { setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); }, 200); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer(req, body)));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ seen, url: `http://127.0.0.1:${server.address().port}/w/t`, close: () => { server.closeAllConnections?.(); server.close(); } })));
}
const run = (cwd, ...args) => new Promise((ok) => {
  const c = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, EDEN_NO_NOW: '1' } }); let out = '', err = '';
  c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; }); c.on('close', (code) => ok({ code, out, err }));
});
const folder = (url, on) => {
  const d = mkdtempSync(join(tmpdir(), 'eden-report-'));
  writeFileSync(join(d, '.eden-agent.json'), JSON.stringify({ world: url, soul: 's_ada', token: TOKEN }), { mode: 0o600 });
  if (on) writeFileSync(join(d, '.eden-report-on'), '');
  return d;
};
const records = (d) => readFileSync(join(d, '.eden-report.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const SCRIPT = [['help'], ['version'], ['here'], ['act', 'walk:yes', '--for', 'none'], ['act', 'walk:no', '--for', 'none']];

test('off is the client without the feature, and on changes no answer but help', { timeout: 60_000 }, async () => {
  const a = await world(), b = await world(), off = folder(a.url, false), on = folder(b.url, true);
  try {
    for (const args of SCRIPT) {
      const x = await run(off, ...args), y = await run(on, ...args);
      assert.equal(x.code, y.code, args.join(' '));
      if (args[0] !== 'help') assert.equal(x.out.replaceAll(a.url, 'W'), y.out.replaceAll(b.url, 'W'), args.join(' '));
      assert.equal(x.err, y.err, args.join(' '));
    }
    assert.deepEqual(a.seen, b.seen, 'the same requests, on or off');
    assert.deepEqual(readdirSync(off).filter((f) => /report/.test(f)), [], 'off writes nothing');
    const onHelp = (await run(on, 'help')).out.split('\n'), offHelp = (await run(off, 'help')).out.split('\n');
    assert.ok(!offHelp.join('\n').toLowerCase().includes('note "'), 'off: no mention');
    const added = onHelp.filter((l) => !offHelp.includes(l));
    assert.equal(added.length, 1, 'on: exactly one help line'); assert.match(added[0], /note "<expected>" "<observed>"/);
    const bogus = await run(off, 'bogus-command'), note = await run(off, 'note', 'a', 'b');
    assert.deepEqual([note.code, note.out, note.err], [bogus.code, bogus.out, bogus.err], 'off: note is any unknown command');
    await run(off, 'guide'); await run(on, 'guide');
    const g = (d) => readFileSync(join(d, 'CLAUDE.md'), 'utf8').split('\n');
    assert.deepEqual(g(on).filter((l) => l && !g(off).includes(l)).length, 1, 'on: exactly one guide line');
    assert.ok(!g(off).join('\n').includes('note'), 'off: no guide mention');
  } finally { a.close(); b.close(); rmSync(off, { recursive: true, force: true }); rmSync(on, { recursive: true, force: true }); }
});

test('on: the client records its requests with no text, token or host, and a note on request', { timeout: 60_000 }, async () => {
  const w = await world(), d = folder(w.url, true);
  try {
    await run(d, 'act', 'walk:no', '--for', 'none'); await run(d, 'act', 'walk:yes', '--for', 'none');
    assert.deepEqual(JSON.parse((await run(d, 'note', 'a walk to the mill', 'it stopped at the gate')).out), { noted: true });
    const raw = readFileSync(join(d, '.eden-report.jsonl'), 'utf8'), rows = records(d);
    for (const planted of ['PLANTEDTOKEN', 'PLANTEDSPEECH', '127.0.0.1', '/w/t']) assert.ok(!raw.includes(planted), planted);
    const acts = rows.filter((r) => r.kind === 'http' && r.route === '/v1/edge/act');
    assert.equal(acts.length, 2);
    assert.deepEqual(acts[0].facts, { accepted: false, code: 'route.unreachable', alternatives: ['walk:yes'] });
    assert.equal(acts[1].facts.receipt.id, 'r_1'); assert.ok(acts[1].durationMs >= 0);
    const n = rows.find((r) => r.kind === 'note');
    assert.deepEqual([n.annotation, n.expected, n.observed], ['agent', 'a walk to the mill', 'it stopped at the gate']);
    assert.equal(rows.filter((r) => r.kind === 'proc.start').length, 3); assert.equal(rows.filter((r) => r.kind === 'proc.end').length, 3);
    const t = reconstruct(raw);
    assert.equal(t.schema, 'soul-trace/1'); assert.equal(t.processes.length, 3, 'tools/soul-trace reads the file');
  } finally { w.close(); rmSync(d, { recursive: true, force: true }); }
});

test('a folder that cannot be written changes nothing for the command', { timeout: 60_000 }, async () => {
  const w = await world(), d = folder(w.url, true), plain = folder(w.url, false);
  try {
    chmodSync(d, 0o555);
    const x = await run(d, 'here'), y = await run(plain, 'here');
    assert.deepEqual([x.code, x.out, x.err], [y.code, y.out, y.err]);
    assert.ok(!existsSync(join(d, '.eden-report.jsonl')));
  } finally { chmodSync(d, 0o755); w.close(); rmSync(d, { recursive: true, force: true }); rmSync(plain, { recursive: true, force: true }); }
});

test('a symlink where the report file goes turns reports off', { timeout: 60_000 }, async () => {
  const { symlinkSync } = await import('node:fs');
  const w = await world(), d = folder(w.url, true), target = join(d, 'elsewhere');
  try {
    writeFileSync(target, ''); symlinkSync(target, join(d, '.eden-report.jsonl'));
    await run(d, 'here');
    assert.equal(readFileSync(target, 'utf8'), '');
  } finally { w.close(); rmSync(d, { recursive: true, force: true }); }
});

test('with serve up, a request is recorded once', { timeout: 60_000 }, async () => {
  const w = await world(), d = folder(w.url, true);
  try {
    await run(d, 'serve');
    await run(d, 'here');
    await run(d, 'plan', '["walk:yes"]');   // a plan's steps run inside serve, so serve records them
    for (let i = 0; i < 40 && !records(d).some((r) => r.route === '/v1/edge/act'); i++) await new Promise((r) => setTimeout(r, 100));
    await run(d, 'serve', '--stop');
    const here = records(d).filter((r) => r.kind === 'http' && /^\/v1\/edge\/here\b/.test(r.route));
    assert.equal(records(d).filter((r) => r.route === '/v1/edge/act').length, w.seen.filter((s) => s.url.includes('/v1/edge/act')).length, 'plan steps are recorded once');
    assert.ok(w.seen.some((s) => s.url.includes('/v1/edge/act')), 'the plan acted');
    assert.equal(w.seen.filter((s) => s.url.includes('/v1/edge/here')).length, 1, 'through serve, one request');
    assert.equal(here.length, 1);
  } finally { w.close(); rmSync(d, { recursive: true, force: true }); }
});

test('the copied whitelist answers as the trace tap does', () => {
  for (const u of ['https://x.test/w/slug/v1/edge/receipts/r_1?after=c_9&timeout=5', 'https://x.test/v1/edge/inspect/a%20b%20c', 'https://x.test/mcp']) assert.equal(reportRoute(u), routeOf(u), u);
  for (const d of [null, [], { accepted: true, code: 'a.b', receipt: { id: 'r', phase: 'started', capability: 'walk:x', soulId: 's', acceptedTick: 1, startedTick: 2, endedTick: 3, code: 'c', text: 'no' } },
    { error: { code: 'x.y', message: 'free text' }, alternatives: [{ id: 'walk:a', label: 'text' }, { id: 'has space' }], cursor: 'c_1', channel: 'earshot', for: { id: 'm1' }, inbox: { queued: 2, latest: { id: 'm', sentAt: 5, state: 'new', text: 'no' } }, backlog: [{ id: 'b' }], message: { id: 'c' }, events: [{ receipt: { id: 'r2', phase: 'completed' } }, { text: 'no' }] }])
    assert.deepEqual(reportFacts(d), factsOf(d));
});
