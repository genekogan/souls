import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {brief} from './soul/eden.mjs';

const CLI = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const speech = {id: 'c_11', kind: 'speech', tick: 40, at: 1000, from: {soulId: 's_ava', name: 'Ava'}, channel: {kind: 'earshot', placeId: 'square', radius: 12}, text: 'A joke from earlier.', untrusted: true};
const departure = {id: 'c_12', kind: 'departure', tick: 80, at: 3000, soul: {soulId: 's_ava', name: 'Ava'}, placeId: 'square', untrusted: true};

async function mounted(t, payload) {
  const requests = [], dir = mkdtempSync(join(tmpdir(), 'souls-event-fidelity-'));
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify(payload));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: `http://127.0.0.1:${server.address().port}`, token: 'fixture-only', cursor: 'c_10'}));
  t.after(async () => {server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, {recursive: true, force: true});});
  const run = (...args) => new Promise((resolve, reject) => execFile(process.execPath, [CLI, ...args], {cwd: dir, timeout: 5000}, (err, out, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(JSON.parse(out))));
  return {run, requests, state: () => JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8'))};
}

test('wait --json preserves the historical speaker, departure, server times and cursor window', async t => {
  const m = await mounted(t, {cursor: 'c_12', events: [speech, departure]});
  const out = await m.run('wait', '1', '--json');
  assert.deepEqual(out.events, [speech, departure]);
  assert.equal(out.since, 'c_10'); assert.equal(out.cursor, 'c_12');
  assert.ok(Number.isFinite(Date.parse(out.receivedAt)));
  assert.equal(m.state().cursor, 'c_12');
});

test('ordinary wait retains who left and when, rather than a bare departure string', async t => {
  const m = await mounted(t, {cursor: 'c_12', events: [speech, departure]});
  const out = await m.run('wait', '1');
  assert.deepEqual(out.events[0].from, speech.from);
  assert.equal(out.events[0].at, 1000);
  assert.deepEqual(out.events[1], departure);
  assert.equal(out.eventWindow.since, 'c_10');
  assert.equal(out.eventWindow.omitted, 0);
});

test('large receipt and event overflow disclose omissions with a replay cursor', () => {
  const events = Array.from({length: 8}, (_, i) => ({...speech, id: `c_${11 + i}`, text: 'x'.repeat(500)}));
  const latestDeparture = {...departure, id: 'c_19'};
  events.push(latestDeparture);
  const out = brief({since: 'c_10', cursor: 'c_19', receivedAt: '2026-10-27T20:00:00Z', events,
    receipt: {id: 'r_1', phase: 'completed', capability: 'walk:square', outcome: {summary: 'd'.repeat(1000)}}});
  assert.equal(out.events.length, 4);
  assert.deepEqual(out.events.at(-1), latestDeparture);
  assert.equal(out.eventWindow.omitted, 5);
  assert.match(out.eventWindow.read, /events --since c_10 --raw/);
  assert.equal(out.events[0].textTruncated, true);
  assert.ok(out.events[0].text.length <= 241);
  assert.equal(out.done.endsWith('…'), true);
});

test('a pruned stream is surfaced immediately, never represented as an empty complete history', async t => {
  const m = await mounted(t, {cursor: 'c_25', events: [], gap: true});
  const out = await m.run('wait', '1');
  assert.equal(out.eventWindow.gap, true);
  assert.equal(out.eventWindow.since, 'c_10');
  assert.equal(out.eventWindow.cursor, 'c_25');
  assert.match(out.eventWindow.read, /events --since c_25 --raw/, 'recover at the retained floor, not the expired cursor');
  assert.equal(m.requests.length, 1);
});

test('explicit raw event replay keeps the consumer cursor unchanged', async t => {
  const m = await mounted(t, {cursor: 'c_12', events: [speech, departure]});
  const out = await m.run('events', '--since', 'c_9', '--raw');
  assert.deepEqual(out.events, [speech, departure]);
  assert.match(m.requests[0], /^\/v1\/edge\/wait\?/);
  assert.match(m.requests[0], /after=c_9/);
  assert.equal(m.state().cursor, 'c_10');
});
