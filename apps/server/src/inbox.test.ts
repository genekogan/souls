import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Db} from './db.ts';
import {AgentInbox, INBOX_CONNECTED_MS, SOUL_LISTEN_GRACE_MS, GOD_LISTEN_LEASE_MS} from './inbox.ts';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';
import {GodMode} from './god/god.ts';
import {coreRef} from '@souls/world-compiler';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {streamSSE} from 'hono/streaming';

test('soul queue: nothing overwrites, the oldest waits first, listen takes the whole backlog, ack and result per id, restart', t => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-inbox-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  let db = new Db(join(dir, 'fixture.db')), now = 1000, inbox = new AgentInbox(db, 'w1', () => now);
  const a = {scope: 'soul:a', owner: 'alice'}, b = {scope: 'soul:a', owner: 'bob'}, other = new AgentInbox(db, 'w2', () => now);
  assert.deepEqual(inbox.view(a), {connected: false, lastSeenAt: null, listenedAt: null, latest: null, queued: 0, presence: 'away'});
  const first = inbox.send(a, 'go find the horses').latest!; now++;
  assert.throws(() => inbox.send(a, '\u0000'.repeat(1000)), /control characters/);
  const second = inbox.send(a, 'hello?').latest!; now++;
  const third = inbox.send(a, 'can you ride the horse?').latest!; now++;
  assert.equal(inbox.ownerView(a).latest!.id, third.id, 'the owner card shows the newest message');
  assert.equal(inbox.view(a).latest!.id, first.id, 'the agent sees the oldest waiting'); assert.equal(inbox.view(a).queued, 3);
  assert.equal(inbox.view(b).latest, null); assert.equal(other.view(a).latest, null);
  // a private notice on any other answer does not consume it (listen is the one consumer)
  inbox.touch(a); assert.equal(inbox.view(a).latest!.state, 'sent'); assert.equal(inbox.view(a).presence, 'away', 'PRESENCE: other calls never make a Soul present');
  const backlog = inbox.takeBacklog(a); inbox.listening(a)(true);   // the route's listen closes as it hands them over
  assert.deepEqual(backlog.map(m => m.text), ['go find the horses', 'hello?', 'can you ride the horse?']);
  assert.deepEqual(backlog.map(m => m.state), ['delivered', 'delivered', 'delivered']);
  assert.equal(inbox.view(a).presence, 'working');
  assert.throws(() => inbox.acknowledge(a, first.id, 'x'.repeat(141)), /140/);
  assert.throws(() => inbox.acknowledge(a, first.id, 'two\nlines'), /one line/);
  // ack in any order, by id; nothing is "no longer the latest"
  assert.equal(inbox.acknowledge(a, second.id, 'Hello! I am here.').latest!.state, 'acknowledged');
  const ack1 = inbox.acknowledge(a, first.id, 'Got it: walking to the horses.');
  assert.equal(ack1.latest!.reply, 'Got it: walking to the horses.'); assert.equal(ack1.latest!.outcome, undefined, 'the ack is not the outcome'); assert.equal(ack1.queued, 1);
  assert.equal(inbox.acknowledge(a, first.id, 'Changed reply').latest!.reply, 'Got it: walking to the horses.', 'an ack retry is idempotent');
  assert.throws(() => inbox.result(a, first.id, 'Arrived', 'maybe'), /done or failed/);
  assert.throws(() => inbox.result(a, first.id, '', 'done'), /1–140/);
  const res = inbox.result(a, first.id, 'Arrived at the horses.', 'done').latest!;
  assert.equal(res.result, 'Arrived at the horses.'); assert.equal(res.outcome, 'done'); assert.equal(res.reply, 'Got it: walking to the horses.');
  assert.equal(inbox.result(a, first.id, 'Arrived at the horses.', 'done').latest!.result, 'Arrived at the horses.', 'a result retry is idempotent');
  assert.throws(() => inbox.result(a, first.id, 'Something else', 'failed'), /already has its result/);
  // a result without an ack acknowledges it too
  const r3 = inbox.result(a, third.id, "Couldn't: no saddle here. Options: walk beside it.", 'failed').latest!;
  assert.equal(r3.state, 'acknowledged'); assert.equal(r3.outcome, 'failed');
  assert.equal(inbox.view(a).queued, 0); assert.equal(inbox.view(a).latest!.id, third.id);
  // a Soul's id reaches only its agent: acknowledging one it saw in a private notice marks it received too
  const fourth = inbox.send(a, 'sit down on the grass').latest!;
  assert.equal(inbox.acknowledge(a, fourth.id, 'Sitting.').latest!.state, 'acknowledged');
  assert.throws(() => inbox.acknowledge(a, 'msg_none', 'x'), /no such message/);
  assert.throws(() => inbox.result({scope: 'god', owner: 'alice'}, first.id, 'x', 'done'), /god commands/);
  // bounded: 50 wait at most
  for (let i = 0; i < 50; i++) inbox.send(a, `msg ${i}`);
  assert.throws(() => inbox.send(a, 'one too many'), (e: {status?: number; code?: string}) => e.status === 429 && e.code === 'queue-full');
  now += INBOX_CONNECTED_MS + 1; assert.equal(inbox.view(a).connected, false);
  db.close(); db = new Db(join(dir, 'fixture.db')); inbox = new AgentInbox(db, 'w1', () => now); t.after(() => db.close());
  assert.equal(inbox.view(a).latest!.text, 'msg 0'); assert.equal(inbox.view(a).queued, 50); assert.equal(inbox.takeBacklog(a).length, 50);
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM agent_inbox_v1').get()!.n, 1, 'the old slot keeps only presence');
});

// Baseline id kept for the release gate. The Soul box became a queue (MSG 1.9.5): a newer message no longer replaces
// the older one; the rest of the old contract (transitions, validation, isolation, presence expiry, restart) holds.
test('one durable latest message: truthful transitions, replacement, isolation, expiry and restart', t => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-inbox-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  let db = new Db(join(dir, 'fixture.db')), now = 1000, inbox = new AgentInbox(db, 'w1', () => now);
  const a = {scope: 'soul:a', owner: 'alice'}, b = {scope: 'soul:a', owner: 'bob'}, other = new AgentInbox(db, 'w2', () => now);
  assert.equal(inbox.view(a).latest, null);
  const first = inbox.send(a, 'A private request').latest!;
  assert.throws(() => inbox.send(a, '\u0000'.repeat(1000)), /control characters/);
  assert.equal(first.state, 'sent'); assert.equal(inbox.view(a).connected, false);
  assert.equal(inbox.view(b).latest, null); assert.equal(other.view(a).latest, null);
  inbox.touch(a); assert.equal(inbox.view(a).connected, false, 'PRESENCE: a call is not a listen');
  inbox.listening(a)(); assert.equal(inbox.view(a).connected, true); assert.equal(inbox.view(a).latest!.state, 'sent');
  now++; assert.equal(inbox.deliver(a).latest!.state, 'delivered');
  assert.throws(() => inbox.acknowledge(a, first.id, 'x'.repeat(141)), /140/);
  assert.throws(() => inbox.acknowledge(a, first.id, 'two\nlines'), /one line/);
  assert.equal(inbox.acknowledge(a, first.id, 'Received; I will check.').latest!.state, 'acknowledged');
  assert.equal(inbox.acknowledge(a, first.id, 'Changed reply').latest!.reply, 'Received; I will check.');
  const second = inbox.send(a, 'A newer request').latest!; assert.notEqual(second.id, first.id); assert.equal(second.state, 'sent'); assert.equal(second.reply, undefined);
  // no replacement any more: the older message keeps its ack, the newer one waits
  assert.equal(inbox.acknowledge(a, first.id, 'Again').latest!.reply, 'Received; I will check.');
  now += INBOX_CONNECTED_MS + 1; assert.equal(inbox.view(a).connected, false);
  db.close(); db = new Db(join(dir, 'fixture.db')); inbox = new AgentInbox(db, 'w1', () => now); t.after(() => db.close());
  assert.equal(inbox.view(a).latest!.id, second.id); assert.equal(inbox.view(a).latest!.state, 'sent'); assert.equal(inbox.view(a).connected, false);
  assert.equal(inbox.view(a).queued, 1);
});

// Historical title retained as the release gate's stable test identity. Its scenarios (the gap between two long-polls, a
// listener that is gone, an agent holding a message) are kept, but the SOUL3 PRESENCE semantics intentionally supersede the
// old expectations per Gene's brief: a Soul is listening while a listen is open or closed <= SOUL_LISTEN_GRACE_MS (60 s) ago,
// then 'away' (was 'recent' after a short gap); after handing messages, a newer queued message within the grace still shows
// 'listening' (was "nobody listens until the agent runs listen again"). The full new contract is the PRESENCE test below.
test('presence stays listening across the gap between two long-polls, not after the listener is gone or once it holds a message', t => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-inbox-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  const db = new Db(join(dir, 'fixture.db')); t.after(() => db.close());
  let now = 1000; const inbox = new AgentInbox(db, 'w1', () => now), a = {scope: 'soul:a', owner: 'alice'};
  inbox.touch(a); const end = inbox.listening(a); assert.equal(inbox.view(a).presence, 'listening');
  end(); now += 60; assert.equal(inbox.view(a).presence, 'listening', 're-polling');
  now += SOUL_LISTEN_GRACE_MS; assert.equal(inbox.view(a).presence, 'away', 'gone: grace over (superseded: was recent)');
  inbox.send(a, 'go to the cottage'); const end2 = inbox.listening(a); const [m] = inbox.takeBacklog(a); end2(true); now += 10;
  assert.equal(inbox.view(a).presence, 'working', 'it took a message: working, not listening');
  inbox.result(a, m.id, 'Arrived.', 'done'); inbox.send(a, 'now the garden'); now += 100;
  assert.equal(inbox.view(a).presence, 'listening', 'superseded: within the grace a newer queued message shows listening');
  now += SOUL_LISTEN_GRACE_MS; assert.equal(inbox.view(a).presence, 'away', 'after the grace nobody listens until the agent runs listen again');
});

test('PRESENCE: a Soul listens while a listen is open or closed <= 60 s ago; other traffic, a stepped-back clock and the god box', t => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-inbox-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  let db = new Db(join(dir, 'fixture.db')); t.after(() => db.close());
  let now = 1000, inbox = new AgentInbox(db, 'w1', () => now); const a = {scope: 'soul:a', owner: 'alice'}, g = {scope: 'god', owner: 'alice'};
  assert.equal(inbox.view(a).presence, 'away'); assert.equal(inbox.view(a).listenedAt, null, 'never seen');
  inbox.touch(a); assert.equal(inbox.view(a).presence, 'away', 'other traffic alone never counts');
  const end = inbox.listening(a); now += 20_000;
  assert.equal(inbox.view(a).presence, 'listening'); assert.equal(inbox.view(a).listenedAt, now, 'open: listening now');
  end(); const closed = now;
  now += SOUL_LISTEN_GRACE_MS; assert.equal(inbox.view(a).presence, 'listening', 'within the grace after close');
  assert.equal(inbox.view(a).listenedAt, closed); assert.equal(inbox.view(a).connected, true);
  now += 1; assert.equal(inbox.view(a).presence, 'away', 'grace over'); assert.equal(inbox.view(a).connected, false);
  inbox.touch(a); now += 10_000; inbox.touch(a);
  assert.equal(inbox.view(a).presence, 'away', 'ack/act/other calls do not keep presence alive'); assert.equal(inbox.view(a).listenedAt, closed, 'away since the close');
  const end2 = inbox.listening(a); assert.equal(inbox.view(a).presence, 'listening', 'reopen'); end2(); now += 59_000;
  // the stamp is durable: a restart within the grace still says listening, and after it, away since that close
  db.close(); db = new Db(join(dir, 'fixture.db')); inbox = new AgentInbox(db, 'w1', () => now);
  assert.equal(inbox.view(a).presence, 'listening', 'restart within the grace'); now += 2_000; assert.equal(inbox.view(a).presence, 'away');
  assert.equal(inbox.view(a).listenedAt, now - 61_000);
  now -= 120_000; assert.equal(inbox.view(a).presence, 'away', 'a clock stepped back claims nothing'); now += 120_000;
  // it took messages: working within the grace (still not away), away after
  inbox.send(a, 'go to the cottage'); const end3 = inbox.listening(a); const [m] = inbox.takeBacklog(a); end3(true); now += 10;
  assert.equal(inbox.view(a).presence, 'working'); assert.equal(inbox.ownerView(a).queued, 1, 'unacked count');
  now += SOUL_LISTEN_GRACE_MS; assert.equal(inbox.view(a).presence, 'away');
  inbox.result(a, m.id, 'Arrived.', 'done'); assert.equal(inbox.ownerView(a).queued, 0);
  // The God box now also requires an inbox poll: generic calls grant no listener lease.
  inbox.touch(g); assert.equal(inbox.view(g).presence, 'away'); assert.equal(inbox.view(g).listenedAt, null);
  now += 31_000; assert.equal(inbox.view(g).presence, 'away');
});

test('PRESENCE: an older agent_inbox_v1 table without listened_at gains the column at boot and keeps its rows', t => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-inbox-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  const db = new Db(join(dir, 'fixture.db')); t.after(() => db.close());
  db.db.exec(`CREATE TABLE agent_inbox_v1 (world_id TEXT NOT NULL, scope TEXT NOT NULL, owner TEXT NOT NULL, id TEXT, text TEXT, sent_at INTEGER, delivered_at INTEGER, acknowledged_at INTEGER, reply TEXT, last_seen_at INTEGER, PRIMARY KEY(world_id,scope,owner)) WITHOUT ROWID;
    INSERT INTO agent_inbox_v1(world_id,scope,owner,last_seen_at) VALUES('w1','soul:a','alice',7)`);
  let now = 1000; const inbox = new AgentInbox(db, 'w1', () => now), a = {scope: 'soul:a', owner: 'alice'};
  assert.deepEqual([inbox.view(a).lastSeenAt, inbox.view(a).listenedAt, inbox.view(a).presence], [7, null, 'away']);
  inbox.listening(a)(); now += 5; assert.equal(inbox.view(a).listenedAt, 1000); assert.equal(inbox.view(a).presence, 'listening');
});

test('LISTEN-LEAK: a newer listen supersedes only the same agent (same Soul, same owner, same world), never another Soul, owner, god box or world', t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  const inbox = new AgentInbox(db, 'w1'), otherWorld = new AgentInbox(db, 'w2');
  const soulA = {scope: 'soul:a', owner: 'alice'}, soulB = {scope: 'soul:b', owner: 'alice'}, soulAbob = {scope: 'soul:a', owner: 'bob'};
  const godAlice = {scope: 'god', owner: 'alice'}, godBob = {scope: 'god', owner: 'bob'};
  const first = inbox.claimListen(soulA);
  const others = [inbox.claimListen(soulB), inbox.claimListen(soulAbob), inbox.claimListen(godAlice), inbox.claimListen(godBob), otherWorld.claimListen(soulA)];
  assert.equal(first.signal.aborted, false, 'other Souls, owners, god boxes and worlds leave the listen alone');
  assert.ok(others.every(o => !o.signal.aborted), 'and it leaves theirs alone');
  const newer = inbox.claimListen(soulA);
  assert.equal(first.signal.aborted, true, 'the same Soul listening again supersedes its older listen');
  assert.ok(others.every(o => !o.signal.aborted), 'and nobody else\'s');
  assert.equal(newer.signal.aborted, false);
  first.release(); assert.equal(newer.signal.aborted, false, 'releasing the superseded one does not touch the newer');
  const godNewer = inbox.claimListen(godAlice);
  assert.equal(others[2].signal.aborted, true, 'the god box supersedes its own older listen'); assert.equal(others[3].signal.aborted, false, 'not another owner\'s god box');
  assert.equal(newer.signal.aborted, false); assert.equal(godNewer.signal.aborted, false);
});

test('soul queue: a message waiting in the old one-message box moves into the queue at boot, once', t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  db.db.exec(`CREATE TABLE agent_inbox_v1 (world_id TEXT NOT NULL, scope TEXT NOT NULL, owner TEXT NOT NULL, id TEXT, text TEXT, sent_at INTEGER, delivered_at INTEGER, acknowledged_at INTEGER, reply TEXT, last_seen_at INTEGER, PRIMARY KEY(world_id,scope,owner)) WITHOUT ROWID`);
  db.db.prepare('INSERT INTO agent_inbox_v1 VALUES(?,?,?,?,?,?,?,?,?,?)').run('w', 'soul:s1', 'alice', 'msg_old', 'the house!!!!', 5, 6, null, null, 7);
  db.db.prepare('INSERT INTO agent_inbox_v1 VALUES(?,?,?,?,?,?,?,?,?,?)').run('w', 'soul:s2', 'alice', 'msg_done', 'Finished', 5, 6, 8, 'ok', 7);
  const inbox = new AgentInbox(db, 'w', () => 100), s1 = {scope: 'soul:s1', owner: 'alice'};
  const v = inbox.view(s1); assert.equal(v.latest!.id, 'msg_old'); assert.equal(v.latest!.text, 'the house!!!!'); assert.equal(v.queued, 1); assert.equal(v.lastSeenAt, 7, 'presence stays');
  assert.equal(inbox.view({scope: 'soul:s2', owner: 'alice'}).latest, null, 'a finished message is not replayed');
  inbox.acknowledge(s1, 'msg_old', 'Going home.');
  new AgentInbox(db, 'w', () => 100);
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM soul_inbox_queue_v1').get()!.n, 1, 'a second boot moves nothing again');
  assert.equal(inbox.view(s1).queued, 0);
});

test('listen wakes on a new request and cleans up on timeout and abort', async t => {
  const db = new Db(':memory:'); t.after(() => db.close()); const inbox = new AgentInbox(db, 'w'), scope = {scope: 'god', owner: 'alice'};
  const ac = new AbortController(), first = inbox.send(scope, 'First').latest!;
  await inbox.listen(scope, undefined, 25_000, ac.signal);
  let woke = false; const waiting = inbox.listen(scope, first.id, 25_000, ac.signal).then(() => { woke = true; });
  await new Promise(r => setImmediate(r)); assert.equal(woke, false);
  inbox.send(scope, 'Second'); await waiting; assert.equal(woke, true);
  const latest = inbox.view(scope).latest!.id, abort = new AbortController();
  const aborted = inbox.listen(scope, latest, 25_000, abort.signal); abort.abort(); await aborted;
  await inbox.listen(scope, latest, 5, ac.signal);
  assert.equal((inbox as unknown as {waiters: Map<string, unknown>}).waiters.size, 0);
});

test('real owner and paired HTTP flows: absent, browser, command polling, listening, ack, private scope and revocation', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice'); await invite(f, 'bob');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Inbox fixture'}));
  const b = await accept(f.host, f.souls.create('dev:bob', {name: 'Briar', description: 'Other owner fixture'}));
  const tokenA = f.souls.pairExchange(f.souls.pairCode(a, 'http://127.0.0.1:5960').code, 'scripted').token;
  const tokenB = f.souls.pairExchange(f.souls.pairCode(b, 'http://127.0.0.1:5960').code, 'scripted').token;
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:alice', tick: () => f.host.engine.world.tick, emit() {}});
  const owner = f.db.user('dev:alice')!, godToken = god.mintFor(owner, 'scripted'), browserToken = god.mintFor(owner, 'browser');
  const app = buildApp({cfg: {...config, port: 5960, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5960/w/eden', accountAuthRequired: false, webDir: '/nonexistent-inbox-fixture', marsWebDir: '/nonexistent-inbox-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), god, hub: {clients: new Map(), refreshMe() {}} as never});
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  app.get('/v1/test-inbox-binary', c => c.body(png, 200, {'content-type': 'image/png', etag: 'fixture-original', 'cache-control': 'public, max-age=60'}));
  app.get('/v1/test-inbox-sse', c => streamSSE(c, async stream => { await stream.writeSSE({event: 'fixture', data: 'Original stream data'}); }));
  const req = async (path: string, token?: string, body?: unknown, signal?: AbortSignal) => {
    const r = await app.request(path, {method: body === undefined ? 'GET' : 'POST', headers: {...(token ? {authorization: `Bearer ${token}`} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), ...(signal ? {signal} : {})});
    return {status: r.status, headers: r.headers, data: await r.json() as any};
  };
  for (const [path, token, polling] of [
    ['/v1/god/inbox', godToken, '/v1/god/status'],
  ] as const) {
    const agentPath = path.startsWith('/v1/god') ? '/v1/god/inbox' : '/v1/edge/inbox';
    assert.equal((await req(path)).status, 401);
    assert.equal((await req(path, 'dev:bob')).status, 403);
    const sent = await req(path, 'dev:alice', {text: `Private ${agentPath} request`}); assert.equal(sent.status, 200); assert.equal(sent.data.inbox.latest.state, 'sent'); assert.equal(sent.data.inbox.connected, false);
    const id = sent.data.inbox.latest.id;
    await req('/v1/god/status', browserToken);
    const before = await req(path, 'dev:alice'); assert.equal(before.data.inbox.connected, false); assert.equal(before.data.inbox.latest.state, 'sent');
    assert.equal((await req(`${agentPath}/${id}/ack`, token, {reply: 'Too early'})).status, 409);
    // The authenticated refusal itself carries the request, honestly delivering it.
    assert.equal((await req(path, 'dev:alice')).data.inbox.latest.state, 'delivered');
    const poll = await req(polling, token); assert.equal(poll.data.inbox.latest.id, id); assert.equal(poll.data.inbox.latest.state, 'delivered'); assert.equal(poll.headers.get('cache-control'), 'no-store');
    assert.equal((await req(`${agentPath}/${id}/ack`, token, {reply: 'I have it.'})).data.inbox.latest.state, 'acknowledged');
    assert.equal((await req(path, 'dev:alice')).data.inbox.latest.reply, 'I have it.');
    const begun = performance.now(), listening = req(`${agentPath}/listen?after=${id}&timeoutMs=25000`, token);
    await new Promise(r => setImmediate(r)); const next = await req(path, 'dev:alice', {text: 'A new request while listening'});
    const delivery = await listening; assert.equal(delivery.data.inbox.latest.id, next.data.inbox.latest.id); assert.equal(delivery.data.inbox.latest.state, 'delivered'); assert.ok(performance.now() - begun < 10_000);
    assert.equal((await req(`${agentPath}/${id}/ack`, token, {reply: 'Old request'})).status, 404);
    assert.equal((await req(`${agentPath}/${next.data.inbox.latest.id}/ack`, token, {reply: 'Done listening.'})).status, 200);
  }
  {
    // MSG: a Soul's box over HTTP. Three messages typed while the agent is busy all wait; another command carries a private
    // notice without consuming them; one listen hands over the whole backlog oldest first; ack and result per id.
    const path = `/v1/edge/owner/${a.id}/inbox`;
    assert.equal((await req(path)).status, 401); assert.equal((await req(path, 'dev:bob')).status, 403);
    const texts = ['go find the horses', 'hello?', 'can you ride the horse?'], ids: string[] = [];
    for (const text of texts) { const r = await req(path, 'dev:alice', {text}); assert.equal(r.status, 200); ids.push(r.data.inbox.latest.id); }
    let box = (await req(path, 'dev:alice')).data.inbox; assert.equal(box.latest.id, ids[2]); assert.equal(box.queued, 3); assert.equal(box.presence, 'away');
    const busy = await req('/v1/edge/observe', tokenA); assert.equal(busy.data.inbox.latest.id, ids[0]); assert.equal(busy.data.inbox.latest.state, 'sent', 'a notice is not a delivery');
    assert.equal(busy.headers.get('cache-control'), 'no-store');
    box = (await req(path, 'dev:alice')).data.inbox; assert.equal(box.presence, 'away', 'PRESENCE: an authenticated observe is not a listen'); assert.equal(box.listenedAt, null);
    const got = await req('/v1/edge/inbox/listen?timeoutMs=25000', tokenA);
    assert.deepEqual(got.data.backlog.map((m: any) => m.text), texts); assert.deepEqual(got.data.backlog.map((m: any) => m.state), ['delivered', 'delivered', 'delivered']);
    box = (await req(path, 'dev:alice')).data.inbox; assert.equal(box.presence, 'working'); assert.equal(box.latest.state, 'delivered');
    assert.equal((await req(`/v1/edge/inbox/${ids[0]}/ack`, tokenA, {reply: 'Got it: walking to the horses.'})).data.inbox.latest.reply, 'Got it: walking to the horses.');
    assert.equal((await req(`/v1/edge/inbox/${ids[1]}/ack`, tokenA, {reply: 'Hello!'})).status, 200);
    assert.equal((await req(`/v1/edge/inbox/${ids[0]}/ack`, tokenA, {reply: 'retry'})).status, 200, 'an ack retry stays idempotent');
    const res = await req(`/v1/edge/inbox/${ids[2]}/result`, tokenA, {text: "Couldn't: no saddle. Options: walk beside it.", outcome: 'failed'});
    assert.equal(res.status, 200); assert.equal(res.data.inbox.latest.outcome, 'failed'); assert.equal(res.data.inbox.latest.state, 'acknowledged');
    assert.equal((await req(`/v1/edge/inbox/${ids[0]}/result`, tokenA, {text: 'Arrived at the horses.', outcome: 'done'})).data.inbox.latest.result, 'Arrived at the horses.');
    assert.equal((await req(`/v1/edge/inbox/${ids[0]}/result`, godToken, {text: 'x', outcome: 'done'})).status, 401, 'the god token is not this Soul\'s agent');
    box = (await req(path, 'dev:alice')).data.inbox; assert.equal(box.queued, 0); assert.equal(box.latest.result, "Couldn't: no saddle. Options: walk beside it.");
    // a waiting listen wakes at once on the next message and reports listening meanwhile
    const begun = performance.now(), listening = req('/v1/edge/inbox/listen?timeoutMs=25000', tokenA);
    await new Promise(r => setTimeout(r, 20)); assert.equal((await req(path, 'dev:alice')).data.inbox.presence, 'listening');
    const next = await req(path, 'dev:alice', {text: 'the house!!!!'});
    const woke = await listening; assert.deepEqual(woke.data.backlog.map((m: any) => m.id), [next.data.inbox.latest.id]); assert.ok(performance.now() - begun < 10_000);
    assert.equal((await req(`/v1/edge/inbox/${next.data.inbox.latest.id}/ack`, tokenA, {reply: 'Going to the house.'})).status, 200);
    // LISTEN-LEAK: a newer listen supersedes the older ones (409 superseded, nothing handed) instead of being refused; the
    // message then reaches exactly one listener, the newest, and is acked once.
    const tick = () => new Promise(r => setTimeout(r, 20));
    const l1 = req('/v1/edge/inbox/listen?timeoutMs=25000', tokenA); await tick();
    const l2 = req('/v1/edge/inbox/listen?timeoutMs=25000', tokenA); await tick();
    const l3 = req('/v1/edge/inbox/listen?timeoutMs=25000', tokenA); await tick();
    assert.equal((await req('/v1/edge/inbox/listen?timeoutMs=0', tokenA)).status, 200, 'a peek (the CLI wait interrupt) supersedes nothing');
    for (const old of await Promise.all([l1, l2])) { assert.equal(old.status, 409); assert.equal(old.data.code, 'superseded'); assert.equal(old.data.backlog, undefined); }
    assert.equal((await req(path, 'dev:alice')).data.inbox.presence, 'listening');
    const only = (await req(path, 'dev:alice', {text: 'just once'})).data.inbox.latest.id;
    const newest = await l3; assert.equal(newest.status, 200); assert.deepEqual(newest.data.backlog.map((m: any) => m.id), [only]);
    assert.equal((await req(`/v1/edge/inbox/${only}/ack`, tokenA, {reply: 'Once.'})).status, 200);
    assert.equal((await req(`/v1/edge/inbox/listen?after=${only}&timeoutMs=0`, tokenA)).data.backlog.length, 0, 'nothing handed twice');
    // an older CLI's `listen --follow` loop (after = the last it printed) walks the queue in order and then waits
    const m1 = (await req(path, 'dev:alice', {text: 'one'})).data.inbox.latest.id, m2 = (await req(path, 'dev:alice', {text: 'two'})).data.inbox.latest.id;
    const f1 = await req('/v1/edge/inbox/listen?timeoutMs=25000', tokenA); assert.equal(f1.data.inbox.latest.id, m1); assert.equal(f1.data.backlog.length, 2);
    const f2 = await req(`/v1/edge/inbox/listen?after=${m1}&timeoutMs=25000`, tokenA); assert.equal(f2.data.inbox.latest.id, m2, 'the next after the cursor, though one is unacked'); assert.deepEqual(f2.data.backlog.map((m: any) => m.id), [m2]);
    const t0 = performance.now(), f3 = await req(`/v1/edge/inbox/listen?after=${m2}&timeoutMs=60`, tokenA); assert.ok(performance.now() - t0 >= 50, 'nothing new after the cursor: it waits'); assert.deepEqual(f3.data.backlog, []);
    for (const id of [m1, m2]) assert.equal((await req(`/v1/edge/inbox/${id}/ack`, tokenA, {})).status, 200);
  }
  const foreign = await req('/v1/edge/observe', tokenB); assert.equal(foreign.data.inbox.latest, null);
  const callsBefore = f.db.brainCalls(100).length, eventsBefore = f.host.seq;
  const command = await req(`/v1/souls/${a.id}/command`, 'dev:alice', {text: 'Owner command uses the same inbox'});
  assert.equal(command.status, 200); assert.equal(command.data.ok, true); assert.equal(command.data.inbox.latest.state, 'sent');
  assert.equal((await req(`/v1/edge/owner/${a.id}/inbox`, 'dev:alice')).data.inbox.latest.id, command.data.inbox.latest.id);
  assert.equal((await req('/v1/edge/observe', tokenA)).data.inbox.latest.text, 'Owner command uses the same inbox');
  assert.equal((await req(`/v1/edge/inbox/${command.data.inbox.latest.id}/ack`, tokenA, {})).status, 200);
  assert.equal(f.db.brainCalls(100).length, callsBefore); assert.equal(f.host.seq, eventsBefore, 'delivery does not translate or execute a body command');
  const publicRead = await req('/v1/world/snapshot'); assert.equal(publicRead.data.inbox, undefined);
  assert.equal((await req('/v1/god/inbox/listen?timeoutMs=0', browserToken)).status, 401);
  for (const [path, token, ownerPath, expected] of [
    ['/v1/test-inbox-binary', godToken, '/v1/god/inbox', png],
    ['/v1/test-inbox-sse', tokenA, `/v1/edge/owner/${a.id}/inbox`, new TextEncoder().encode('event: fixture\ndata: Original stream data\n\n')],
  ] as const) {
    const sent = await req(ownerPath, 'dev:alice', {text: 'A private note carried with bytes.'});
    const browser = await app.request(path, {headers: {authorization: `Bearer ${browserToken}`}});
    assert.equal(browser.headers.get('X-Sim-Agent-Inbox'), null); await browser.arrayBuffer();
    assert.equal((await req(ownerPath, 'dev:alice')).data.inbox.latest.state, 'sent', 'browser does not deliver binary or SSE notes');
    const response = await app.request(path, {headers: {authorization: `Bearer ${token}`}});
    const encoded = response.headers.get('X-Sim-Agent-Inbox')!; assert.ok(encoded);
    const delivered = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).inbox;
    assert.equal(delivered.latest.id, sent.data.inbox.latest.id); assert.equal(delivered.latest.state, token === godToken ? 'delivered' : 'sent', 'a Soul notice does not consume'); assert.equal(delivered.connected, true);
    assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('ETag'), null);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected, 'private header leaves original binary/SSE bytes unchanged');
  }
  // the god's box is a queue: finish the binary note it still holds, so the largest command is the one it carries next
  const held = (await req('/v1/god/inbox', 'dev:alice')).data.inbox.latest;
  assert.equal((await req(`/v1/god/inbox/${held.id}/ack`, godToken, {})).status, 200);
  const largest = await req('/v1/god/inbox', 'dev:alice', {text: '\ufffd'.repeat(1000)});
  await req('/v1/god/status', godToken);
  assert.equal((await req(`/v1/god/inbox/${largest.data.inbox.latest.id}/ack`, godToken, {reply: '\u0000'.repeat(140)})).status, 200);
  const maxHeader = await app.request('/v1/test-inbox-binary', {headers: {authorization: `Bearer ${godToken}`}});
  assert.ok(Buffer.byteLength(maxHeader.headers.get('X-Sim-Agent-Inbox')!) < 8000, 'max UTF16 text plus escaped reply stays under an 8KB header'); await maxHeader.arrayBuffer();
  const privateId = (await req(`/v1/edge/owner/${a.id}/inbox`, 'dev:alice')).data.inbox.latest.id;
  const waiting = req(`/v1/edge/inbox/listen?after=${privateId}&timeoutMs=15`, tokenA);
  await new Promise(r => setImmediate(r)); f.db.setSoulToken(a.id, null);
  const revoked = await waiting; assert.equal(revoked.status, 401); assert.equal(revoked.data.inbox, undefined);
  assert.equal(f.db.paidCost(), 0);
});

test('owner box and edge command need an invited owner (same gate as the central /v1/souls/:id/command)', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'carol');
  const s = await accept(f.host, f.souls.create('dev:carol', {name: 'Cato', description: 'Invite gate fixture'}));
  const app = buildApp({cfg: {...config, port: 5961, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5961/w/eden', accountAuthRequired: false, inviteRequired: true, webDir: '/nonexistent-inbox-fixture', marsWebDir: '/nonexistent-inbox-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), hub: {clients: new Map(), refreshMe() {}} as never});
  const post = (path: string) => app.request(path, {method: 'POST', headers: {authorization: 'Bearer dev:carol', 'content-type': 'application/json'}, body: JSON.stringify({text: 'come home'})});
  assert.equal((await post(`/v1/souls/${s.id}/command`)).status, 200);
  (f.db as unknown as {db: {prepare(q: string): {run(...a: unknown[]): void}}}).db.prepare('UPDATE users SET invited_by = NULL WHERE id = ?').run('dev:carol');
  for (const path of [`/v1/souls/${s.id}/command`, `/v1/edge/owner/${s.id}/inbox`]) {
    const r = await post(path); assert.equal(r.status, 403, path); assert.equal(((await r.json()) as {code?: string; error?: string}).code ?? 'invite-required', 'invite-required');
  }
});

// #399: the god's presence after a listen hands over a command is 'working' however the clock moves between the
// middleware's seen stamp and the delivery stamp (it read 'listening' when a millisecond passed in between).
test('god presence is working right after a listen hands over a command, even if the clock ticks in between', t => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-godp-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  let now = 1000;
  const db = new Db(join(dir, 'p.db')), inbox = new AgentInbox(db, 'w1', () => now++);   // every read of the clock moves it 1 ms
  t.after(() => db.close());
  const g = {scope: 'god', owner: 'alice'};
  inbox.send(g, 'Put a cottage by the knoll');
  // what the listen route and the agent middleware do for GET /v1/god/inbox/listen?timeoutMs=0
  inbox.touch(g); const end = inbox.listening(g); end(); inbox.touch(g); const v = inbox.deliver(g);
  assert.equal(v.latest!.state, 'delivered');
  assert.equal(inbox.view(g).presence, 'working');
  assert.equal(inbox.ownerView(g).presence, 'working');
});

test('god queue: commands typed while away wait in order; tickets move pending -> in progress -> done/failed/withdrawn', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'souls-godq-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  let db = new Db(join(dir, 'q.db')), now = 1000, inbox = new AgentInbox(db, 'w1', () => now);
  const g = {scope: 'god', owner: 'alice'}, other = {scope: 'god', owner: 'bob'};
  const a = inbox.send(g, 'Build a pier').latest!; now++;
  const b = inbox.send(g, 'Paint the barn red').latest!; now++;
  const c = inbox.send(g, 'Plant an orchard').latest!; now++;
  // nothing overwrote anything: the agent sees the oldest, with how many wait; the owner sees all three newest first
  let seen = inbox.view(g); assert.equal(seen.latest!.id, a.id); assert.equal(seen.queued, 3); assert.equal(seen.presence, 'away'); assert.equal(seen.connected, false);
  let log = inbox.ownerView(g).log!; assert.deepEqual(log.map(x => x.id), [c.id, b.id, a.id]); assert.deepEqual(log.map(x => x.state), ['sent', 'sent', 'sent']);
  assert.equal(inbox.ownerView(g).latest!.id, c.id, 'the owner box shows the newest command');
  assert.equal(inbox.view(other).latest, null, 'another owner never sees them');
  // delivery hands over only the head; touched edits belong to the command in progress
  inbox.recordTouched(g, ['x0']); assert.equal(inbox.ownerView(g).log![2].touched, undefined, 'nothing is recorded before delivery');
  inbox.touch(g); assert.equal(inbox.deliver(g).latest!.id, a.id);
  assert.deepEqual(inbox.ownerView(g).log!.map(x => x.state), ['sent', 'sent', 'delivered']);
  assert.equal(inbox.view(g).presence, 'working');
  inbox.recordTouched(g, ['pier', 'post-1', 'pier']);
  const focus = {x: 10, y: 1, z: -4, span: 12, label: 'pier', count: 2};
  let asked: string[] = []; inbox.focusOf = ids => { asked = ids; return focus; };
  // a successful ack answers with the finished command; the next waits for the next listen
  assert.throws(() => inbox.acknowledge(g, a.id, undefined, 'maybe'), /done or failed/);
  const acked = inbox.acknowledge(g, a.id, 'Pier built at the lake.');
  assert.equal(acked.latest!.id, a.id); assert.equal(acked.latest!.state, 'acknowledged'); assert.equal(acked.latest!.outcome, 'done'); assert.equal(acked.queued, 2);
  assert.deepEqual(asked, ['pier', 'post-1']);
  assert.equal(inbox.ownerView(g).log!.find(x => x.id === b.id)!.state, 'sent', 'the ack did not deliver the next command');
  assert.deepEqual(inbox.acknowledge(g, a.id, 'retry').latest!.reply, 'Pier built at the lake.', 'an ack retry is idempotent');
  // listen after the finished one returns at once with the next, in order
  await inbox.listen(g, a.id, 25_000, new AbortController().signal);
  assert.equal(inbox.deliver(g).latest!.id, b.id);
  assert.throws(() => inbox.acknowledge(g, a.id, 'late retry'), /no longer the latest/, 'a retry after a later delivery is refused, as before');
  inbox.focusOf = () => null;
  assert.equal(inbox.acknowledge(g, b.id, 'No barn in this world.', 'failed').latest!.outcome, 'failed');
  // the owner withdraws the last; a listener waiting behind it wakes
  let woke = false; const waiting = inbox.listen(g, c.id, 25_000, new AbortController().signal).then(() => { woke = true; });
  await new Promise(r => setImmediate(r)); assert.equal(woke, false, 'a listener that already has c waits');
  inbox.withdraw(g, c.id); await waiting; assert.equal(woke, true);
  assert.throws(() => inbox.withdraw(g, c.id), /already finished/); assert.throws(() => inbox.withdraw(g, 'msg_none'), /no such/);
  assert.throws(() => inbox.withdraw({scope: 'soul:s', owner: 'alice'}, c.id), /only god/);
  log = inbox.ownerView(g).log!;
  assert.deepEqual(log.map(x => [x.state, x.outcome, x.reply ?? null]), [['acknowledged', 'withdrawn', null], ['acknowledged', 'failed', 'No barn in this world.'], ['acknowledged', 'done', 'Pier built at the lake.']]);
  assert.deepEqual(log[2].focus, focus); assert.equal(log[2].touched, 2); assert.equal(log[1].focus, undefined);
  seen = inbox.view(g); assert.equal(seen.queued, 0); assert.equal(seen.latest!.id, c.id, 'with nothing waiting the agent sees the newest, finished');
  await inbox.listen(g, undefined, 5, new AbortController().signal);
  // Presence follows the poll-start lease across re-polls; generic calls do not renew it.
  const end = inbox.listening(g); assert.equal(inbox.view(g).presence, 'listening'); assert.equal(inbox.listenerCount(g), 1); end(); end(); assert.equal(inbox.listenerCount(g), 0);
  inbox.touch(g); now += 29_000; assert.equal(inbox.view(g).presence, 'listening'); now += GOD_LISTEN_LEASE_MS - 29_000 + 1; assert.equal(inbox.view(g).presence, 'away');
  // the queue is bounded, and it survives a restart
  for (let i = 0; i < 50; i++) inbox.send(g, `cmd ${i}`);
  assert.throws(() => inbox.send(g, 'one too many'), (e: {status?: number; code?: string}) => e.status === 429 && e.code === 'queue-full');
  db.close(); db = new Db(join(dir, 'q.db')); inbox = new AgentInbox(db, 'w1', () => now); t.after(() => db.close());
  assert.equal(inbox.view(g).latest!.text, 'cmd 0'); assert.equal(inbox.view(g).queued, 50); assert.equal(inbox.ownerView(g).log!.length, 50);
});

test('god presence: a command handed over reads working even when the clock moves between the seen stamp and the delivery', t => {
  // R5 gate (run-fd2b22dec): the agent middleware stamps last_seen_at, then delivers; a millisecond boundary between the two
  // left last_seen_at < delivered_at, so the owner saw 'listening' (and 'away' after the 75 s lease) for a held command.
  const db = new Db(':memory:'); t.after(() => db.close());
  let now = 1000; const inbox = new AgentInbox(db, 'w1', () => now++), g = {scope: 'god', owner: 'alice'};
  inbox.send(g, 'Build a pier'); inbox.send(g, 'Paint the barn red');
  inbox.listening(g)();                     // a poll start (lease) that has ended, as after a timeoutMs=0 listen
  inbox.touch(g); const v = inbox.deliver(g);  // the middleware's order: seen, then delivered
  assert.equal(v.latest!.state, 'delivered'); assert.equal(v.presence, 'working');
  now += GOD_LISTEN_LEASE_MS + 1; assert.equal(inbox.view(g).presence, 'working', 'a held command outlives the listen lease');
});

test('god queue: a message waiting in the old one-message box moves into the queue at boot', t => {
  const db = new Db(':memory:'); t.after(() => db.close());
  db.db.exec(`CREATE TABLE agent_inbox_v1 (world_id TEXT NOT NULL, scope TEXT NOT NULL, owner TEXT NOT NULL, id TEXT, text TEXT, sent_at INTEGER, delivered_at INTEGER, acknowledged_at INTEGER, reply TEXT, last_seen_at INTEGER, PRIMARY KEY(world_id,scope,owner)) WITHOUT ROWID`);
  db.db.prepare('INSERT INTO agent_inbox_v1 VALUES(?,?,?,?,?,?,?,?,?,?)').run('w', 'god', 'alice', 'msg_old', 'Old pending command', 5, 6, null, null, 7);
  db.db.prepare('INSERT INTO agent_inbox_v1 VALUES(?,?,?,?,?,?,?,?,?,?)').run('w', 'god', 'bob', 'msg_done', 'Finished command', 5, 6, 8, 'ok', 7);
  const inbox = new AgentInbox(db, 'w', () => 100), again = new AgentInbox(db, 'w', () => 100);
  const v = again.view({scope: 'god', owner: 'alice'}); assert.equal(v.latest!.id, 'msg_old'); assert.equal(v.latest!.state, 'delivered'); assert.equal(v.queued, 1);
  assert.equal(inbox.view({scope: 'god', owner: 'bob'}).latest, null, 'a finished message is not replayed');
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM god_inbox_queue_v1').get()!.n, 1, 'migrating twice adds nothing');
});

test('god queue over HTTP: a real build links its ticket to where it stands; failed and withdrawn tickets; presence flips', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice');
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:alice', tick: () => f.host.engine.world.tick, emit() {}});
  const owner = f.db.user('dev:alice')!, godToken = god.mintFor(owner, 'scripted');
  const app = buildApp({cfg: {...config, port: 5962, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5962/w/eden', accountAuthRequired: false, webDir: '/nonexistent-inbox-fixture', marsWebDir: '/nonexistent-inbox-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), god, hub: {clients: new Map(), refreshMe() {}} as never});
  const req = async (path: string, token?: string, body?: unknown) => {
    const r = await app.request(path, {method: body === undefined ? 'GET' : 'POST', headers: {...(token ? {authorization: `Bearer ${token}`} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: r.status, data: await r.json() as any};
  };
  const ownerBox = async () => (await req('/v1/god/inbox', 'dev:alice')).data.inbox;
  const texts = ['Put a cottage by the knoll', 'Paint the moon green', 'Never mind the third'];
  for (const text of texts) assert.equal((await req('/v1/god/inbox', 'dev:alice', {text})).status, 200);
  let box = await ownerBox(); assert.equal(box.presence, 'away'); assert.equal(box.connected, false); assert.deepEqual(box.log.map((x: any) => x.text), [...texts].reverse());
  // the agent comes back: a listen hands over the first command (in progress), the others stay pending
  const first = (await req('/v1/god/inbox/listen?timeoutMs=0', godToken)).data.inbox; assert.equal(first.latest.text, texts[0]); assert.equal(first.queued, 3);
  box = await ownerBox(); assert.equal(box.presence, 'working'); assert.deepEqual(box.log.map((x: any) => x.state), ['sent', 'sent', 'delivered']);
  const built = await req('/v1/god/act', godToken, {ops: [{op: 'place', tmp: '$c', def: coreRef('cottage'), name: 'knoll-cottage', p: [48, 10], r: 1.2}, {op: 'place', def: coreRef('bench'), name: 'porch-bench', in: {parent: '$c'}, p: [0, 0, 5]}]});
  assert.equal(built.data.accepted, true, JSON.stringify(built.data).slice(0, 300));
  const done = await req(`/v1/god/inbox/${first.latest.id}/ack`, godToken, {reply: 'Cottage and bench by the knoll.'});
  assert.equal(done.status, 200); assert.equal(done.data.inbox.latest.id, first.latest.id); assert.equal(done.data.inbox.latest.outcome, 'done');
  box = await ownerBox(); const t0 = box.log[2];
  assert.equal(t0.outcome, 'done'); assert.equal(t0.reply, 'Cottage and bench by the knoll.'); assert.equal(t0.touched, 2);
  assert.equal(t0.focus.label, 'knoll-cottage'); assert.equal(t0.focus.count, 2); assert.ok(Math.abs(t0.focus.x - 48) < 8 && Math.abs(t0.focus.z - 10) < 8, JSON.stringify(t0.focus)); assert.ok(t0.focus.span >= 6);
  assert.equal(box.log[1].state, 'sent', 'the ack did not hand over the next command');
  // an old CLI's loop: listen after the acked id gets the next in order
  const second = (await req(`/v1/god/inbox/listen?after=${first.latest.id}&timeoutMs=0`, godToken)).data.inbox; assert.equal(second.latest.text, texts[1]);
  assert.equal((await req(`/v1/god/inbox/${second.latest.id}/ack`, godToken, {reply: 'There is no moon to paint.', outcome: 'failed'})).data.inbox.latest.outcome, 'failed');
  assert.equal((await req(`/v1/god/inbox/${second.latest.id}/ack`, godToken, {outcome: 'shrug'})).status, 400);
  const third = (await ownerBox()).log[0];
  assert.equal((await req(`/v1/god/inbox/${third.id}/withdraw`, godToken, {})).status >= 400, true, 'the agent cannot withdraw');
  assert.equal((await req(`/v1/god/inbox/${third.id}/withdraw`, 'dev:alice', {})).data.inbox.log[0].outcome, 'withdrawn');
  box = await ownerBox(); assert.deepEqual(box.log.map((x: any) => x.outcome), ['withdrawn', 'failed', 'done']); assert.equal(box.queued, 0);
  // Presence stays listening through the poll-start lease after a long-poll ends.
  const ac = new AbortController(), open = app.request(`/v1/god/inbox/listen?after=${third.id}&timeoutMs=300`, {headers: {authorization: `Bearer ${godToken}`}, signal: ac.signal});
  await new Promise(r => setTimeout(r, 30)); assert.equal((await ownerBox()).presence, 'listening');
  await (await open).arrayBuffer(); assert.equal((await ownerBox()).presence, 'listening');
  // LISTEN-LEAK: the god's box too: a second listen supersedes the first (409) and is the one live listener.
  const g1 = req(`/v1/god/inbox/listen?after=${third.id}&timeoutMs=25000`, godToken); await new Promise(r => setTimeout(r, 20));
  const g2 = req(`/v1/god/inbox/listen?after=${third.id}&timeoutMs=300`, godToken);
  const sup = await g1; assert.equal(sup.status, 409); assert.equal(sup.data.code, 'superseded');
  assert.equal((await g2).status, 200);
});

// LISTEN-LEAK (2026-10-23): live refusals "at most two inbox listeners per agent" came within ~45 s of each world boot while
// the owner ran ONE listen process. After a boot, one client reconnecting N times in a row (attempts cut client-side, or
// overlapping before the old socket is reaped, plus a request that was in flight across the boot) is never refused: each
// newer listen supersedes the older, a wait peek is answered, one live listener takes the message and it is acked once.
test('after a boot, one client reconnecting N times in a row is never refused and leaves one live listener', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Reboot fixture'}));
  const tokenA = f.souls.pairExchange(f.souls.pairCode(a, 'http://127.0.0.1:5960').code, 'scripted').token;
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:alice', tick: () => f.host.engine.world.tick, emit() {}});
  const boot = () => buildApp({cfg: {...config, port: 5960, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5960/w/eden', accountAuthRequired: false, webDir: '/nonexistent-inbox-fixture', marsWebDir: '/nonexistent-inbox-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), god, hub: {clients: new Map(), refreshMe() {}} as never});
  const req = async (app: ReturnType<typeof boot>, path: string, token?: string, body?: unknown, signal?: AbortSignal) => {
    const r = await app.request(path, {method: body === undefined ? 'GET' : 'POST', headers: {...(token ? {authorization: `Bearer ${token}`} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), ...(signal ? {signal} : {})});
    return {status: r.status, data: await r.json() as any};
  };
  const tick = () => new Promise(r => setTimeout(r, 20)), listen = '/v1/edge/inbox/listen?timeoutMs=25000';
  const before = boot(), gone = new AbortController();
  const stale = req(before, listen, tokenA, undefined, gone.signal);   // in flight when the process went away
  await tick();
  const app = boot(), statuses: number[] = [], overlapping: Promise<{status: number, data: any}>[] = [];
  for (let i = 0; i < 8; i++) {
    const cut = new AbortController(), p = req(app, listen, tokenA, undefined, cut.signal); await tick();
    if (i % 2 === 0) { cut.abort(); statuses.push((await p).status); }   // cut client-side: its socket is reaped
    else overlapping.push(p);                                            // the old socket not yet reaped
    statuses.push((await req(app, '/v1/edge/inbox/listen?timeoutMs=0', tokenA)).status);   // the CLI's wait peek
  }
  assert.ok(!statuses.includes(429), `never refused: ${statuses}`);
  assert.equal((await req(app, `/v1/edge/owner/${a.id}/inbox`, 'dev:alice')).data.inbox.presence, 'listening');
  const id = (await req(app, `/v1/souls/${a.id}/command`, 'dev:alice', {text: 'after the boot'})).data.inbox.latest.id;
  const answers = await Promise.all(overlapping), handed = answers.filter(x => x.status === 200 && x.data.backlog?.length);
  assert.deepEqual(answers.slice(0, -1).map(x => [x.status, x.data.code]), Array(overlapping.length - 1).fill([409, 'superseded']));
  assert.equal(handed.length, 1, 'exactly one live listener took it'); assert.deepEqual(handed[0].data.backlog.map((m: any) => m.id), [id]);
  assert.equal((await req(app, `/v1/edge/inbox/${id}/ack`, tokenA, {reply: 'Once.'})).status, 200);
  assert.equal((await req(app, `/v1/edge/inbox/listen?after=${id}&timeoutMs=0`, tokenA)).data.backlog.length, 0, 'nothing handed twice');
  gone.abort(); await stale;
});
