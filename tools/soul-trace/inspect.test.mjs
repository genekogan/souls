// #624: read-only localhost inspector over soul-trace/1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {mkdtempSync, writeFileSync, appendFileSync, readFileSync, truncateSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCHEMA} from './tap.mjs';
import {reconstruct} from './readout.mjs';
import {startInspector, loadTrace, MAX_TRACE_BYTES} from './inspect.mjs';

const base = {v: SCHEMA};
const rec = (proc, seq, kind, at, more) => JSON.stringify({...base, proc, seq, kind, at, mono: seq, ...more});
function fixture(code = 'ride.unavailable', capability = 'walk:gate') {
  return [
    rec('pL', 1, 'proc.start', 1000, {command: 'listen'}),
    rec('pL', 2, 'http', 1010, {method: 'GET', route: '/v1/edge/inbox/listen', status: 200, facts: {messages: [{id: 'm_1', sentAt: 990, state: 'delivered'}]}}),
    rec('pL', 3, 'proc.end', 1020, {exitCode: 0, durationMs: 20, stats: {}}),
    rec('pA', 1, 'proc.start', 3000, {command: 'act'}),
    rec('pA', 2, 'http', 3050, {method: 'POST', route: '/v1/edge/act', op: 'op-1', attempt: 1, status: 200, durationMs: 22, facts: {accepted: false, code}, requestedFor: 'm_1'}),
    rec('pA', 3, 'http', 3100, {method: 'POST', route: '/v1/edge/act', op: 'op-2', attempt: 1, status: 200, durationMs: 50, facts: {accepted: true, for: 'm_1', receipt: {id: 'r_1', capability, phase: 'started', acceptedTick: 10, startedTick: 10}}}),
    rec('pA', 4, 'http', 3900, {method: 'GET', route: '/v1/edge/receipts/r_1', status: 200, facts: {receipt: {id: 'r_1', capability, phase: 'completed', acceptedTick: 10, startedTick: 10, endedTick: 70}}}),
    rec('pA', 5, 'proc.end', 3950, {exitCode: 0, durationMs: 950, stats: {}}),
  ].join('\n') + '\n';
}

function get(origin, path, headers = {}, method = 'GET') {
  const u = new URL(path, origin);
  return new Promise((ok, fail) => {
    const r = request({host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: {host: u.host, ...headers}}, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => ok({status: res.statusCode, headers: res.headers, body: b}));
    });
    r.on('error', fail); r.end();
  });
}

async function open(t, text = fixture()) {
  const dir = mkdtempSync(join(tmpdir(), 'soul-inspect-')), file = join(dir, 'trace.jsonl');
  if (text !== null) writeFileSync(file, text);
  const ins = await startInspector({file});
  t.after(() => ins.close());
  const token = new URL(ins.url).searchParams.get('token');
  const first = await get(ins.origin, '/?token=' + token);
  const cookie = first.headers['set-cookie'][0].split(';')[0];
  return {ins, file, token, first, cookie};
}

test('serves the same reconstruction as readout --json, from loopback only', async t => {
  const {ins, first, cookie, file} = await open(t);
  assert.equal(ins.address.address, '127.0.0.1');
  assert.equal(first.status, 200);
  assert.match(first.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Path=\//);
  const csp = first.headers['content-security-policy'];
  assert.match(csp, /default-src 'none'; script-src 'nonce-[^']+'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.equal(first.headers['x-content-type-options'], 'nosniff');
  const r = await get(ins.origin, '/trace.json', {cookie});
  assert.equal(r.status, 200);
  const d = JSON.parse(r.body);
  assert.deepEqual(d.trace, reconstruct(readFileSync(file, 'utf8')));
  assert.equal(d.file, 'trace.jsonl', 'only the basename reaches the page');
  const e = d.trace.episodes[0];
  assert.equal(e.origin.id, 'm_1');
  assert.equal(e.firstCommand.at - e.deliveredAt, 1990, 'unattributed host gap is available to the page');
  assert.deepEqual(e.acts.map(a => [a.outcome, a.receipt?.terminal ?? null]), [['refused', null], ['accepted', 'completed']]);
});

test('refuses rebinding, cross-site, foreign origin, missing token and writes', async t => {
  const {ins, token, cookie} = await open(t);
  const port = new URL(ins.origin).port;
  const cases = [
    ['/?token=' + token, {host: 'evil.example:' + port}],
    ['/?token=' + token, {host: 'localhost:' + port}],
    ['/trace.json', {cookie, 'sec-fetch-site': 'cross-site'}],
    ['/trace.json', {cookie, 'sec-fetch-site': 'same-site'}],
    ['/trace.json', {cookie, origin: 'http://evil.example'}],
    ['/', {}],
    ['/?token=' + 'x'.repeat(token.length), {}],
    ['/trace.json', {}],
    ['/trace.json', {cookie: 'soul_trace_inspector=' + 'y'.repeat(token.length)}],
  ];
  for (const [path, headers] of cases) assert.equal((await get(ins.origin, path, headers)).status, 403, JSON.stringify([path, headers]));
  for (const m of ['POST', 'PUT', 'DELETE']) assert.equal((await get(ins.origin, '/trace.json', {cookie}, m)).status, 405, m);
  assert.equal((await get(ins.origin, '/stop', {cookie})).status, 404, 'no control endpoint');
  assert.equal((await get(ins.origin, '/trace.json', {cookie, 'sec-fetch-site': 'same-origin', origin: ins.origin})).status, 200);
});

test('page renders data as text only and hostile strings stay JSON data', async t => {
  const evil = '<img src=x onerror="window.pwned=1">', {ins, first, cookie} = await open(t, fixture(evil, '<script>alert(1)</script>'));
  assert.doesNotMatch(first.body, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(first.body, /onerror|alert/, 'no trace data is interpolated into the page');
  const r = await get(ins.origin, '/trace.json', {cookie});
  assert.equal(r.headers['content-type'], 'application/json');
  assert.equal(JSON.parse(r.body).trace.episodes[0].acts[0].code, evil);
});

test('re-reads only on change, reports missing and oversized traces', async t => {
  const {ins, file, cookie} = await open(t, null);
  let r = await get(ins.origin, '/trace.json', {cookie});
  assert.equal(r.status, 200);
  assert.match(JSON.parse(r.body).error, /waiting for the trace file/);
  writeFileSync(file, fixture());
  r = JSON.parse((await get(ins.origin, '/trace.json', {cookie})).body);
  assert.equal(r.trace.episodes.length, 1);
  const same = JSON.parse((await get(ins.origin, '/trace.json?known=' + encodeURIComponent(r.key), {cookie})).body);
  assert.deepEqual(same, {file: 'trace.jsonl', key: r.key, unchanged: true});
  const cache = loadTrace(file);
  assert.equal(loadTrace(file, cache), cache, 'unchanged size/mtime returns the cached reconstruction');
  appendFileSync(file, rec('pB', 1, 'proc.start', 5000, {command: 'here'}) + '\n');
  const grown = JSON.parse((await get(ins.origin, '/trace.json?known=' + encodeURIComponent(r.key), {cookie})).body);
  assert.equal(grown.trace.processes.length, 3);
  truncateSync(file, MAX_TRACE_BYTES + 1);
  r = await get(ins.origin, '/trace.json', {cookie});
  assert.equal(r.status, 413);
  assert.match(JSON.parse(r.body).error, /reads at most/);
});

test('the inspector never opens a network connection or writes', async t => {
  const src = readFileSync(fileURLToPath(new URL('./inspect.mjs', import.meta.url)), 'utf8');
  const imports = [...src.matchAll(/^import (.+) from '([^']+)';$/gm)].map(m => m[2] + ' ' + m[1]);
  assert.deepEqual(imports, ["node:http {createServer}", "node:crypto {randomBytes, timingSafeEqual}",
    "node:fs {openSync, fstatSync, readSync, closeSync}", "node:path {basename, resolve}", "node:url {pathToFileURL}", "./readout.mjs {reconstruct}"]);
  assert.doesNotMatch(src, /\bfetch\(['"`]http|\brequest\(|child_process|process\.kill/);
});
