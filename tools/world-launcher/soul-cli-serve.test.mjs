// #1096: the resident client. A fake world over HTTP, the real CLI as a child process, the real detached serve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldEvents, foldMessages, reconcileMessages, takePending } from './soul/eden.mjs';

const cli = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A world with an inbox and an event stream. As the real one does (Inbox.takeBacklog): a listen returns every message not
 *  acknowledged after its cursor, and with no cursor every message not acknowledged. */
async function world(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sim-serve-'));
  const w = { dir, inbox: [], events: [], calls: [], acts: 0, keys: [], busyNext: 0, heavyNow: 0, heavyMax: 0, listens: 0, parked: [] };
  const flush = () => { const p = w.parked; w.parked = []; for (const f of p) f(); };
  w.owner = (id, text) => { w.inbox.push({ id, text, sentAt: Date.now(), acked: false }); flush(); };
  w.event = (e) => { w.events.push({ id: `c_${w.events.length + 1}`, ...e }); flush(); };
  const hold = (ms) => new Promise((done) => { const x = setTimeout(done, ms); w.parked.push(() => { clearTimeout(x); done(); }); });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://w');
    assert.ok(url.pathname.startsWith('/w/test/'), `a world's routes sit under its base path: ${url.pathname}`);
    const p = url.pathname.slice('/w/test'.length);
    let body = ''; for await (const c of req) body += c;
    w.calls.push([req.method, p]);
    const json = (status, v, h = {}) => { if (res.destroyed) return; res.writeHead(status, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(v)); };
    if (p === '/v1/edge/inbox/listen') {
      w.listens++;
      const waiting = () => { const from = w.inbox.findIndex((m) => m.id === url.searchParams.get('after')) + 1; return w.inbox.slice(from).filter((m) => !m.acked); };
      if (!waiting().length) await hold(Math.min(Number(url.searchParams.get('timeoutMs')), 200));
      if (req.socket.destroyed) return undefined; // the real route hands nothing to a caller that hung up (inbox-routes.ts)
      const backlog = waiting();
      return json(200, { inbox: { connected: true, latest: backlog[0] }, backlog: backlog.map(({ id, text, sentAt }) => ({ id, text, sentAt })) });
    }
    if (p === '/v1/edge/wait') {
      const after = Number((url.searchParams.get('after') ?? 'c_0').slice(2));
      if (w.events.length <= after) await hold(200);
      const events = w.events.slice(after);
      return json(200, { events, cursor: `c_${after + events.length}` });
    }
    // Everything else is heavy: at most one at a time per Soul, or soul.busy.
    w.heavyNow++; w.heavyMax = Math.max(w.heavyMax, w.heavyNow);
    await sleep(10); w.heavyNow--;
    if (w.busyNext > 0) { w.busyNext--; return json(429, { error: { code: 'soul.busy', message: 'one at a time' } }, { 'retry-after': '0' }); }
    if (p === '/v1/edge/act') { w.acts++; w.keys.push(req.headers['idempotency-key']); return json(200, { accepted: true, receipt: { id: `r_${w.acts}`, capability: 'walk:x', phase: 'started' } }); }
    if (/\/ack$|\/result$/.test(p)) { const m = w.inbox.find((x) => x.id === decodeURIComponent(p.split('/').at(-2))); if (m) m.acked = true; return json(200, { inbox: {} }); }
    if (p === '/v1/edge/here') return json(200, { place: 'green' });
    if (p.startsWith('/v1/edge/receipts/')) return json(200, { receipt: { id: decodeURIComponent(p.split('/').pop()), phase: 'completed', capability: 'walk:x' } });
    return json(404, { error: { code: 'nope', message: p } });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ world: `http://127.0.0.1:${server.address().port}/w/test`, soul: 's', token: 'synthetic-serve-token' }), { mode: 0o600 });
  w.cli = (...args) => new Promise((done) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; });
    child.on('exit', (code) => { let json = null; try { json = JSON.parse(out); } catch { /* text */ } done({ code, out, err, json }); });
  });
  t.after(async () => { await w.cli('serve', '--stop'); await sleep(50); server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true }); });
  return w;
}
const until = async (f, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(30); } return null; };

test('A1: without serve every command goes straight to the world and the folder gains nothing', async (t) => {
  const w = await world(t);
  const r = await w.cli('here');
  assert.equal(r.code, 0);
  assert.equal(r.json.place, 'green');
  assert.equal(existsSync(join(w.dir, '.eden-serve.sock')), false);
  assert.match((await w.cli('pending')).err, /No serve in this folder/);
});

test('A1: one serve per folder: a second start finds the first, and the listen the card shows is its own', async (t) => {
  const w = await world(t);
  const a = await w.cli('serve');
  assert.equal(a.json.serving, true, a.err);
  const b = await w.cli('serve');
  assert.equal(b.json.alreadyServing, true);
  assert.equal(b.json.pid, a.json.pid);
  assert.ok(await until(() => w.listens > 0), 'serve holds the inbox listen');
  assert.equal(readFileSync(join(w.dir, '.eden-serve.lock'), 'utf8').includes(`"pid":${a.json.pid}`), true);
  const stopped = await w.cli('serve', '--stop');
  assert.equal(stopped.json.stopping, true);
  assert.ok(await until(() => !existsSync(join(w.dir, '.eden-serve.sock'))), 'the socket goes with it');
  assert.equal((await w.cli('here')).json.place, 'green', 'and commands go straight to the world again');
});

test('A2: batch returns several reads in one call, each standing on its own; a write is refused', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  const r = await w.cli('batch', '[{"here":{}},{"receipt":"r_9"},{"act":"walk"}]');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.results[0].here.place, 'green');
  assert.equal(r.json.results[1].receipt.phase, 'completed');
  assert.match(r.json.results[2].error, /reads only/);
  assert.equal(w.acts, 0);
  assert.match((await w.cli('batch', 'not json')).err, /usage: batch/);
});

test('A3: act returns the receipt at acceptance; pending lists open receipts, events and unacked messages once', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.owner('msg_1', 'Walk to the mill');
  const a = await w.cli('act', 'walk:mill');
  assert.equal(a.json.receipt.id, 'r_1');
  w.event({ kind: 'approach', text: 'Bo is close by.' });
  const p = await until(async () => { const x = (await w.cli('pending')).json; return x.events?.length ? x : null; });
  assert.deepEqual(p.ownerMessages.map((m) => m.id), ['msg_1']);
  assert.deepEqual(p.openReceipts.map((r) => r.id), ['r_1']);
  assert.equal(p.events[0].text, 'Bo is close by.');
  const again = (await w.cli('pending')).json;
  assert.deepEqual(again.events, [], 'an event is handed over once');
  assert.deepEqual(again.ownerMessages.map((m) => m.id), ['msg_1'], 'an owner message stays until it is acked');
  await w.cli('ack', 'msg_1', 'On it');
  assert.deepEqual((await w.cli('pending')).json.ownerMessages, []);
  w.event({ kind: 'receipt', receipt: { id: 'r_1', capability: 'walk:mill', phase: 'completed' } });
  const done = await until(async () => { const x = (await w.cli('pending')).json; return x.endedReceipts?.length ? x : null; });
  assert.deepEqual(done.endedReceipts.map((r) => [r.id, r.phase]), [['r_1', 'completed']]);
  assert.deepEqual(done.openReceipts, []);
  assert.deepEqual((await w.cli('pending')).json.endedReceipts, [], 'an ended receipt is reported once');
});

test('A5: a message the world handed over just before a kill, unsaved, comes back on restart', async (t) => {
  const w = await world(t);
  w.owner('msg_1', 'Lost in the window'); w.owner('msg_2', 'Saved as the cursor only');
  // The state of a serve killed after the world answered: the cursor moved on, the messages were never kept.
  writeFileSync(join(w.dir, '.eden-serve.json'), JSON.stringify({ inboxAfter: 'msg_2', messages: [] }));
  await w.cli('serve');
  const p = await until(async () => { const x = (await w.cli('pending')).json; return x.ownerMessages?.length === 2 ? x : null; });
  assert.deepEqual(p?.ownerMessages.map((m) => m.id), ['msg_1', 'msg_2']);
  w.owner('msg_3', 'And a new one');
  const next = await until(async () => { const x = (await w.cli('pending')).json; return x.ownerMessages?.length === 3 ? x : null; });
  assert.deepEqual(next?.ownerMessages.map((m) => m.id), ['msg_1', 'msg_2', 'msg_3'], 'each once, oldest first');
});

test('A5: a message acked while no serve was up leaves the queue on restart', async (t) => {
  const w = await world(t);
  w.owner('msg_1', 'Acked by hand'); w.inbox[0].acked = true;
  w.owner('msg_2', 'Still open');
  writeFileSync(join(w.dir, '.eden-serve.json'), JSON.stringify({ inboxAfter: 'msg_1', messages: [{ id: 'msg_1', text: 'Acked by hand', acked: false, closed: false }] }));
  await w.cli('serve');
  const p = await until(async () => { const x = (await w.cli('pending')).json; return x.ownerMessages?.some((m) => m.id === 'msg_2') ? x : null; });
  assert.deepEqual(p?.ownerMessages.map((m) => m.id), ['msg_2']);
});

test('listen follows the world\'s rule: every message not acked after the cursor, however often it was seen', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.owner('msg_1', 'Read through pending');
  assert.ok(await until(async () => (await w.cli('pending')).json.ownerMessages?.length === 1));
  w.owner('msg_2', 'Acked before any read');
  assert.ok(await until(async () => (await w.cli('serve', '--status')).json.unacked === 2), 'the serve holds both');
  await w.cli('ack', 'msg_2', 'On it');
  assert.deepEqual((await w.cli('listen', '--once')).json.messages.map((m) => m.id), ['msg_1'], 'not acked: still there; acked: gone');
  assert.deepEqual((await w.cli('listen', '--once', '--after', 'msg_1')).json.messages, [], 'nothing after the cursor');
  w.owner('msg_3', 'New');
  const next = await w.cli('listen', '--after', 'msg_1');
  assert.deepEqual(next.json.messages.map((m) => m.id), ['msg_3']);
});

test('a peek does not take a message from the listener waiting for it (A6: "Your turn" never reached the seat)', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  const held = w.cli('listen');       // the seat's listener, waiting
  await sleep(150);
  w.owner('msg_1', 'Your turn');
  assert.ok(await until(async () => (await w.cli('serve', '--status')).json.unacked === 1));
  const peek = await w.cli('listen', '--once');   // what a wait's owner interrupt does
  assert.deepEqual(peek.json.messages.map((m) => m.id), ['msg_1']);
  assert.deepEqual((await held).json.messages.map((m) => m.id), ['msg_1'], 'the listener gets it too');
});

test('the harness listen keeps working through serve: same output, by cursor, and it never races the serve', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  const held = w.cli('listen');
  await sleep(150);
  w.owner('msg_2', 'Say hello');
  const r = await held;
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.messages.map((m) => [m.id, m.text]), [['msg_2', 'Say hello']]);
  assert.match(r.json.next, /ack each/);
  w.owner('msg_3', 'And wave');
  const next = await w.cli('listen', '--after', 'msg_2');
  assert.deepEqual(next.json.messages.map((m) => m.id), ['msg_3'], 'the next listen gets only the new one');
});

test('A4: soul.busy is waited out inside serve, and heavy requests never overlap', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.busyNext = 2;
  const r = await w.cli('here');
  assert.equal(r.json.place, 'green', r.err);
  assert.equal(r.err.includes('busy'), false, 'the client never saw it');
  assert.equal((await w.cli('serve', '--status')).json.busyWaited, 2);
  w.heavyMax = 0;
  await Promise.all(Array.from({ length: 6 }, () => w.cli('here')));
  assert.equal(w.heavyMax, 1, 'six commands at once reach the world one at a time');
});

test('A5 (short form): a killed serve resumes from its cursor: nothing replayed, nothing lost, an open message still pending', async (t) => {
  const w = await world(t);
  const a = await w.cli('serve');
  w.owner('msg_k', 'Before the kill');
  w.event({ kind: 'approach', text: 'First' });
  const first = await until(async () => { const x = (await w.cli('pending')).json; return x.events?.length ? x : null; });
  assert.equal(first.events[0].text, 'First');
  process.kill(a.json.pid, 'SIGKILL');
  await sleep(50);
  w.event({ kind: 'approach', text: 'While down' });
  w.owner('msg_d', 'While down');
  assert.equal((await w.cli('here')).json.place, 'green', 'a dead serve leaves the commands working');
  const b = await w.cli('serve');
  assert.notEqual(b.json.pid, a.json.pid, b.err);
  const seen = [];
  const after = await until(async () => { const x = (await w.cli('pending')).json; seen.push(...x.events); return seen.length && x.ownerMessages.length === 2 ? x : null; });
  assert.deepEqual(seen.map((e) => e.text), ['While down'], 'only what was not read; the stream resumes from the cursor');
  assert.deepEqual(after.ownerMessages.map((m) => m.id).sort(), ['msg_d', 'msg_k']);
  assert.equal(w.acts, 0, 'serve starts no act of its own, before or after');
});

test('a keyed write repeated for soul.busy keeps its one key, so the world acts once', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.busyNext = 1;
  const r = await w.cli('act', 'walk:mill');
  assert.equal(r.json.accepted, true, r.err);
  assert.equal(w.keys.length, 1, 'the refused try did not reach the act handler');
  assert.ok(w.keys[0]);
});

test('pure state: an event is read once across a cut, a long tail hands over in pieces, messages fold once', () => {
  const st = { cursor: null, inboxAfter: null, readCursor: null, messages: [], receipts: {}, events: [], omitted: 0, gap: false };
  foldEvents(st, Array.from({ length: 150 }, (_, i) => ({ id: `c_${i + 1}`, kind: 'x' })), 'c_150');
  const a = takePending(st);
  assert.equal(a.events.length, 100);
  assert.equal(a.moreEvents, 50);
  assert.equal(takePending(st).events[0].id, 'c_101');
  assert.equal(foldMessages(st, [{ id: 'msg_1', text: 'a' }, { id: 'msg_1', text: 'a' }]), 1);
  assert.equal(foldMessages(st, [{ id: 'msg_1', text: 'a' }]), 0);
  st.messages.push({ id: 'msg_acked', acked: true }, { id: 'msg_gone', acked: false });
  assert.deepEqual(reconcileMessages(st, [{ id: 'msg_1' }]).messages.map((m) => m.id), ['msg_1', 'msg_acked'], 'held and open stays; acked here stays until closed; gone from the world leaves');
  foldEvents(st, Array.from({ length: 1100 }, (_, i) => ({ id: `c_${i + 151}`, kind: 'x' })), 'c_1250');
  const c = takePending(st);
  assert.ok(c.omitted > 0, 'events cut from the buffer before they were read are counted');
});
