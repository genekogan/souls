// #1096: the resident client. A fake world over HTTP, the real CLI as a child process, the real detached serve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldEvents, foldMessages, newPlan, parsePlanSteps, planAnswer, planExpired, planFix, planHeld, planPhase, planStepProblem, reconcileMessages, stepParamsProblem, takePending } from './soul/eden.mjs';

const cli = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A world with an inbox and an event stream. As the real one does (Inbox.takeBacklog): a listen returns every message not
 *  acknowledged after its cursor, and with no cursor every message not acknowledged. */
async function world(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sim-serve-'));
  const w = { dir, inbox: [], events: [], calls: [], acts: 0, keys: [], busyNext: 0, heavyNow: 0, heavyMax: 0, listens: 0, parked: [], bodies: [], refuse: {}, results: [], byRef: new Map(), offers: { 'sit:bench': { seconds: { type: 'integer', optional: true, min: 1, max: 600 } } } };
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
    if (p === '/v1/edge/act') {
      const b = body ? JSON.parse(body) : {}, cap = b.capability ?? 'walk:x';
      w.bodies.push(b);
      if (b.clientRef && w.byRef.has(b.clientRef)) return json(200, w.byRef.get(b.clientRef));   // a retry returns the first result
      if (w.refuse[cap]) return json(200, { accepted: false, code: w.refuse[cap], reason: `${cap} refused`, alternatives: [{ id: 'walk:pond', label: 'Walk to the pond' }] });
      w.acts++; w.keys.push(req.headers['idempotency-key']);
      const out = { accepted: true, channel: /^(look|turn):/.test(cap) ? 'attention' : 'body', receipt: { id: `r_${w.acts}`, capability: cap, phase: 'started' } };
      if (b.clientRef) w.byRef.set(b.clientRef, out);
      if (w.endsBeforeAnswer) { w.endsBeforeAnswer = false; w.event({ kind: 'receipt', receipt: { id: out.receipt.id, capability: cap, phase: 'completed' } }); await sleep(250); }
      return json(200, out);
    }
    if (p === '/v1/edge/resolve') {
      const b = JSON.parse(body), id = b.capability;
      if (id.includes('nowhere')) return json(200, { resolve: { ok: false, code: 'capability.unknown', reason: 'no such offer', did_you_mean: [{ id: 'walk:mill', label: 'Walk to the mill' }], candidates: [{ id: 'walk:mill' }] } });
      if (id.includes('taken')) return json(200, { resolve: { ok: false, code: 'seat.taken', reason: 'someone is there' } });
      return json(200, { resolve: { ok: true, would: { capability: id, available: true }, candidates: [{ id, params: w.offers[id] }] } });
    }
    if (/\/result$/.test(p)) { const m = w.inbox.find((x) => x.id === decodeURIComponent(p.split('/').at(-2))); if (m) m.acked = true; w.results.push({ id: m?.id, ...JSON.parse(body) }); return json(200, { inbox: {} }); }
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
  writeFileSync(join(w.dir, '.eden-serve.json'), JSON.stringify({ inboxAfter: 'msg_1', messages: [{ id: 'msg_1', text: 'Acked by hand', handed: true, acked: false, closed: false }] }));
  await w.cli('serve');
  const p = await until(async () => { const x = (await w.cli('pending')).json; return x.ownerMessages?.some((m) => m.id === 'msg_2') ? x : null; });
  assert.deepEqual(p?.ownerMessages.map((m) => m.id), ['msg_2']);
});

test('listen does not hand over a message already read through pending or already acked', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.owner('msg_1', 'Read through pending');
  assert.ok(await until(async () => (await w.cli('pending')).json.ownerMessages?.length === 1));
  w.owner('msg_2', 'Acked before any read');
  assert.ok(await until(async () => (await w.cli('serve', '--status')).json.unacked === 2), 'the serve holds both');
  await w.cli('ack', 'msg_2', 'On it');
  const r = await w.cli('listen', '--once');
  assert.deepEqual((r.json.messages ?? []).map((m) => m.id), [], r.out);
  w.owner('msg_3', 'New');
  const next = await w.cli('listen');
  assert.deepEqual(next.json.messages.map((m) => m.id), ['msg_3']);
});

test('the harness listen keeps working through serve: same output, delivered once, and it never races the serve', async (t) => {
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

// ---------------------------------------------------------------- #1100: durable plans
const ended = (w, id, phase = 'completed') => w.event({ kind: 'receipt', receipt: { id, capability: 'walk:x', phase } });
const planNow = async (w, want) => until(async () => { const p = (await w.cli('plan', '--status')).json; return want(p) ? p : null; });
const steps3 = JSON.stringify(['walk:mill', { id: 'sit:bench', params: { seconds: 30 } }, 'walk:pond']);

test('plan A1: nothing runs until every step is an offer whose params fit', async (t) => {
  const w = await world(t);
  assert.match((await w.cli('plan', steps3)).err, /none is up in this folder/);
  await w.cli('serve');
  const unknown = await w.cli('plan', JSON.stringify(['walk:mill', 'walk:nowhere']));
  assert.equal(unknown.code, 2);
  assert.equal(unknown.json.accepted, false);
  assert.equal(unknown.json.code, 'capability.unknown');
  assert.equal(unknown.json.problems[0].did_you_mean[0].id, 'walk:mill');
  const params = await w.cli('plan', JSON.stringify(['walk:mill', { id: 'sit:bench', params: { seconds: 9000 } }]));
  assert.equal(params.json.code, 'capability.params');
  assert.match((await w.cli('plan', '["walk to the mill"]')).err, /not an offered id/);
  await sleep(100);
  assert.equal(w.acts, 0, 'no step ran');
  assert.equal((await w.cli('plan', JSON.stringify(['sit:taken']))).json.accepted, true, 'a state refusal now may be open by its turn: the step finds out');
});

test('plan A1: serve runs the steps in order with no CLI call between them, links each to the message, and closes it', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.owner('msg_1', 'Mill, bench, pond');
  const r = await w.cli('plan', steps3, '--for', 'msg_1');
  assert.equal(r.json.accepted, true, r.err);
  assert.equal(r.json.plan.of, 3);
  assert.ok(await until(() => w.acts === 1));
  await sleep(120);
  assert.equal(w.acts, 1, 'the next step waits for this receipt');
  ended(w, 'r_1');
  assert.ok(await until(() => w.acts === 2), 'step 2 starts on the stream, with no command from the agent');
  ended(w, 'r_2');
  assert.ok(await until(() => w.acts === 3));
  assert.deepEqual(w.results, [], 'the message stays open until the plan ends');
  ended(w, 'r_3');
  assert.ok(await until(() => w.results.length === 1));
  assert.equal(w.results[0].id, 'msg_1');
  assert.equal(w.results[0].outcome, 'done');
  assert.deepEqual(w.bodies.map((b) => b.capability), ['walk:mill', 'sit:bench', 'walk:pond']);
  assert.deepEqual(w.bodies.map((b) => b.for), ['msg_1', 'msg_1', 'msg_1']);
  assert.deepEqual(w.bodies.map((b) => b.forDefault ?? false), [true, true, false], 'only the last step can close the card');
  assert.ok(w.bodies.every((b) => b.strict === true));
  assert.equal(w.bodies[1].params.seconds, 30);
  const p = (await w.cli('pending')).json;
  assert.equal(p.planEnded[0].state, 'done');
  assert.equal(p.plan, undefined);
  assert.equal((await w.cli('pending')).json.planEnded, undefined, 'reported once');
});

test('plan: a held sit has done its work, and the next step goes on', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  await w.cli('plan', JSON.stringify(['sit:bench', 'walk:pond']), '--for', 'none');
  assert.ok(await until(() => w.acts === 1));
  w.event({ kind: 'activity.observed', receipt: { id: 'r_1', capability: 'sit:bench', phase: 'started' }, action: { status: 'executing', phase: 'occupied' }, body: { posture: 'seated' } });
  assert.ok(await until(() => w.acts === 2), 'the receipt stays open while seated');
});

test('plan A2: a refused step stops the plan with its alternatives; no substitution; one replacement', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.owner('msg_1', 'Mill then pond');
  w.refuse['walk:mill'] = 'route.unreachable';
  const r = await w.cli('plan', JSON.stringify(['walk:mill', 'walk:pond']), '--for', 'msg_1');
  assert.equal(r.json.accepted, true);
  const stopped = await planNow(w, (p) => p.plan?.state === 'stopped');
  assert.equal(stopped.plan.steps[0].code, 'route.unreachable');
  await sleep(100);
  assert.equal(w.acts, 0, 'nothing else ran');
  const p = (await w.cli('pending')).json;
  assert.equal(p.plan.steps[0].alternatives[0].id, 'walk:pond', 'the refusal and its alternatives are in pending');
  assert.match(p.plan.next, /fixes":1/);
  assert.equal((await w.cli('plan', '[{"id":"walk:pond","fixes":2}]')).json.reason, 'step 1 is the refused one');
  w.refuse['walk:orchard'] = 'route.unreachable';
  assert.equal((await w.cli('plan', '[{"id":"walk:orchard","fixes":1}]')).json.accepted, true);
  assert.ok(await until(() => w.results.length === 1), 'a second refusal of the same step ends the plan');
  assert.equal(w.results[0].outcome, 'failed');
  assert.match(w.results[0].text, /Stopped at step 1/);
  assert.equal((await w.cli('plan', '[{"id":"walk:mill","fixes":1}]')).json.code, 'plan.no-fix');
});

test('plan A2: the replacement runs in the refused step\'s place and the plan goes on', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.refuse['walk:mill'] = 'route.unreachable';
  await w.cli('plan', JSON.stringify(['walk:mill', 'walk:pond']), '--for', 'none');
  await planNow(w, (p) => p.plan?.state === 'stopped');
  await w.cli('plan', '[{"id":"walk:orchard","fixes":1}]');
  assert.ok(await until(() => w.acts === 1));
  assert.equal(w.bodies.at(-1).capability, 'walk:orchard');
  ended(w, 'r_1');
  assert.ok(await until(() => w.acts === 2));
  assert.equal(w.bodies.at(-1).capability, 'walk:pond');
});

test('plan: a step that ends on the stream before its answer is back still moves on', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.endsBeforeAnswer = true;
  await w.cli('plan', JSON.stringify(['walk:mill', 'walk:pond']), '--for', 'none');
  assert.ok(await until(() => w.acts === 2), 'without waiting for the slow poll');
});

test('plan: a refused step wakes a listening agent, once', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  const held = w.cli('listen');
  await sleep(150);
  w.refuse['walk:mill'] = 'route.unreachable';
  await w.cli('plan', '["walk:mill"]', '--for', 'none');
  const r = await held;
  assert.equal(r.json.plan.state, 'stopped', r.out);
  assert.match(r.json.next, /fixes/);
  assert.equal((await w.cli('listen', '--once')).json.plan, undefined);
});

test('plan A3: talk and attention leave the plan alone; a newer body act replaces it and says so', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.owner('msg_1', 'Mill then pond'); w.owner('msg_2', 'Lovely day!');
  await w.cli('plan', JSON.stringify(['walk:mill', 'walk:pond']), '--for', 'msg_1');
  assert.ok(await until(() => w.acts === 1));
  await w.cli('ack', 'msg_2', 'It is');
  await w.cli('act', 'look:pond', '--for', 'none');
  assert.equal((await w.cli('plan', '--status')).json.plan.state, 'running', 'an ack and an attention act do not touch it');
  w.owner('msg_3', 'Actually come here');
  await w.cli('act', 'walk:here', '--for', 'msg_3');
  assert.ok(await until(() => w.results.some((x) => x.id === 'msg_1')));
  assert.equal(w.results.find((x) => x.id === 'msg_1').outcome, 'failed');
  assert.match(w.results.find((x) => x.id === 'msg_1').text, /Replaced/);
  const p = (await w.cli('pending')).json;
  assert.equal(p.planEnded[0].state, 'replaced');
  const count = w.acts; ended(w, 'r_1', 'replaced'); await sleep(150);
  assert.equal(w.acts, count, 'the old plan takes no further step');
});

test('plan A3: a new plan replaces the old one; for the same message there is no failed line', async (t) => {
  const w = await world(t);
  await w.cli('serve');
  w.owner('msg_1', 'Mill');
  await w.cli('plan', '["walk:mill"]', '--for', 'msg_1');
  assert.ok(await until(() => w.acts === 1));
  await w.cli('plan', '["walk:pond"]', '--for', 'msg_1');
  assert.ok(await until(() => w.acts === 2));
  ended(w, 'r_1', 'replaced'); await sleep(100);
  assert.deepEqual(w.results, []);
  ended(w, 'r_2');
  assert.ok(await until(() => w.results.length === 1));
  assert.equal(w.results[0].outcome, 'done');
  assert.deepEqual((await w.cli('pending')).json.planEnded.map((x) => x.state), ['replaced', 'done']);
});

test('plan: durable: a killed serve carries on at the same step and the world acts once per step', async (t) => {
  const w = await world(t);
  const a = await w.cli('serve');
  w.owner('msg_1', 'Mill then pond');
  await w.cli('plan', JSON.stringify(['walk:mill', 'walk:pond']), '--for', 'msg_1');
  assert.ok(await until(() => w.acts === 1));
  process.kill(a.json.pid, 'SIGKILL');
  await sleep(100);
  ended(w, 'r_1');                  // it ended while no serve was up
  await w.cli('serve');
  assert.ok(await until(() => w.acts === 2), 'the stream cursor brings the receipt, and step 2 starts');
  ended(w, 'r_2');
  assert.ok(await until(() => w.results.length === 1));
  assert.equal(w.results[0].outcome, 'done');
  assert.equal(w.acts, 2);
  assert.deepEqual(w.bodies.map((b) => b.capability), ['walk:mill', 'walk:pond']);
});

test('plan: a step retried after a kill keeps its clientRef, so the world acts once', async (t) => {
  const w = await world(t);
  const plan = newPlan([{ id: 'walk:mill' }], null);
  writeFileSync(join(w.dir, '.eden-serve.json'), JSON.stringify({ plan }));
  w.byRef.set(plan.steps[0].clientRef, { accepted: true, channel: 'body', receipt: { id: 'r_first', capability: 'walk:mill', phase: 'started' } });
  await w.cli('serve');
  const p = await planNow(w, (x) => x.plan?.steps[0].receipt);
  assert.equal(p.plan.steps[0].receipt, 'r_first');
  assert.equal(w.acts, 0, 'the first result came back; nothing ran again');
});

test('plan: pure: parsing, params and transitions', () => {
  assert.deepEqual(parsePlanSteps('["walk:a",{"id":"sit:b","params":{"seconds":3}}]').steps, [{ id: 'walk:a' }, { id: 'sit:b', params: { seconds: 3 } }]);
  assert.equal(parsePlanSteps('[{"id":"walk:a","fixes":2}]').fixes, 2);
  for (const bad of ['', 'x', '[]', '{}', '[1]', '["two words"]', '[{"id":"walk:a","params":[]}]', '[{"id":"a:b","fixes":1},"c:d"]', JSON.stringify(Array(25).fill('walk:a'))]) assert.throws(() => parsePlanSteps(bad), undefined, bad);
  assert.equal(stepParamsProblem({ n: { type: 'integer', min: 1, max: 5 } }, { n: 3 }), null);
  assert.match(stepParamsProblem({ n: { type: 'integer' } }, { n: 1.5 }), /integer/);
  assert.match(stepParamsProblem({ n: { type: 'integer', max: 5 } }, { n: 6 }), /\.\.5/);
  assert.match(stepParamsProblem({ k: { type: 'string', enum: ['a'] } }, { k: 'b' }), /one of a/);
  assert.match(stepParamsProblem({ k: { type: 'string', required: true } }, {}), /needs k/);
  assert.equal(stepParamsProblem(undefined, { any: 1 }), null);
  assert.equal(planStepProblem({ id: 'sit:b' }, { ok: false, code: 'seat.taken' }), null, 'state is for the step to find out');
  assert.equal(planStepProblem({ id: 'walk:a' }, { ok: true, would: { capability: 'walk:b' } }).code, 'capability.unknown', 'an id read as something else is not that offer');
  const p = newPlan([{ id: 'walk:a' }, { id: 'walk:b' }], 'msg', 0);
  const a = p.steps[0].clientRef; assert.ok(a); assert.notEqual(a, p.steps[1].clientRef);
  planAnswer(p, { accepted: true, receipt: { id: 'r1', phase: 'started' } }, 1);
  planPhase(p, { id: 'other', phase: 'completed' }, 2); assert.equal(p.at, 0, 'another receipt is none of its business');
  planHeld(p, { kind: 'activity.observed', receipt: { id: 'r1', capability: 'walk:a', phase: 'started' }, action: { status: 'executing' }, body: { posture: 'standing' } }, 2); assert.equal(p.at, 0, 'a walk does not hold');
  planPhase(p, { id: 'r1', phase: 'completed' }, 3); assert.deepEqual([p.at, p.state], [1, 'running']);
  planAnswer(p, { accepted: true, receipt: { id: 'r2', phase: 'started' } }, 4);
  planPhase(p, { id: 'r2', phase: 'failed', code: 'route.blocked', reason: 'blocked' }, 5);
  assert.deepEqual([p.state, p.stoppedAt, p.steps[1].why.code], ['stopped', 5, 'route.blocked'], 'accepted and then failed stops it like a refusal');
  assert.equal(planExpired(p, 100, 1000).state, 'stopped');
  assert.equal(planFix(p, 2, { id: 'walk:c' }), null);
  assert.deepEqual([p.state, p.steps[1].id, p.steps[1].replaces], ['running', 'walk:c', 'walk:b']);
  planAnswer(p, { accepted: false, code: 'x' }, 6);
  assert.equal(p.state, 'failed', 'one replacement per step');
  const q = newPlan([{ id: 'walk:a' }], null, 0); planAnswer(q, { accepted: false, code: 'x' }, 10);
  assert.equal(planExpired(q, 1009, 1000).state, 'stopped'); assert.equal(planExpired(q, 1010, 1000).state, 'failed');
  const r = newPlan([{ id: 'walk:a' }], null, 0); planAnswer(r, { accepted: true, receipt: { id: 'r1', phase: 'started' } }); planPhase(r, { id: 'r1', phase: 'replaced' });
  assert.equal(r.state, 'replaced');
});
