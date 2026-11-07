// CTX-4 (#1137): one memory per Soul across worlds, from fixture receipts and through the real CLI on two stand-in worlds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSoulMemory, presences, worldKey } from './soul/memory.mjs';

const cli = fileURLToPath(new URL('./soul/eden.mjs', import.meta.url));
const tmp = (t) => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'souls-memory-'))); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const logOf = (dir) => { const f = join(dir, 'memory/log/memory-events.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
const events = (dir) => logOf(dir).map((r) => r.value);
const T0 = Date.parse('2026-11-07T10:00:00.000Z');
const frame = (over = {}) => ({ tick: 100, clock: '09:15', now: 'Sat 7 Nov 2026 · 09:15 · day · world day 3', me: { place: 'pier', placePath: ['the pier', 'Harbour'], posture: 'standing' }, near: [], ...over });
const receipt = (id, over = {}) => ({ id, capability: 'read:bench', phase: 'completed', endedTick: 120, endedAt: { place: 'pier' }, outcome: { kind: 'act', summary: 'Read the notice.', learned: [{ fact: 'The ferry runs at dawn.', about: 'pier', source: 'book:ferry', provenance: 'authored-content' }], produced: [], met: [] }, ...over });
const open = (dir, over = {}) => openSoulMemory(dir, { world: 'eden', url: 'https://x.test/w/eden', soul: 's_me', ...over });

function lived(t) {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame());
  m.sawEvents([{ id: 'c_1', kind: 'receipt', tick: 120, at: T0, clock: '09:20', receipt: receipt('r_1') }]);
  m.sawEvents([{ id: 'c_2', kind: 'approach', tick: 130, at: T0 + 1000, clock: '09:21', from: { soulId: 's_ana', name: 'Ana' }, text: 'Ana is close by.', untrusted: true }]);
  m.sawEvents([{ id: 'c_3', kind: 'conversation.turn', tick: 140, at: T0 + 2000, clock: '09:22', conversation: 'cv_1', turn: { seq: 1, from: { soulId: 's_ana', name: 'Ana' }, text: 'Meet me at the mill tomorrow.' }, untrusted: true }]);
  m.sawResult('m_1', true, 'Read the notice for you.');
  return { dir, m };
}

test('A1: an act, an arrival, a meeting, a turn and an owner outcome are one validated event each, with world, when and seen', (t) => {
  const { dir } = lived(t), all = events(dir);
  assert.deepEqual(all.map((e) => e.type), ['arrival', 'outcome', 'meet', 'speech', 'outcome']);
  for (const e of all) {
    assert.equal(e.world, 'eden'); assert.ok(Date.parse(e.when.real)); assert.ok('tick' in e.when && 'worldDay' in e.when && 'time' in e.when); assert.equal(typeof e.seen, 'object');
  }
  const [arrival, act, meet, speech, owner] = all;
  assert.equal(arrival.placeId, 'eden:pier'); assert.equal(arrival.seen['eden:pier'], 'the pier');
  assert.deepEqual([arrival.when.tick, arrival.when.worldDay, arrival.when.time], [100, 3, '09:15']);
  assert.deepEqual([act.receiptId, act.when.time, act.when.worldDay], ['eden:r_1', '09:20', 3]);
  assert.equal(act.learned[0].provenance, 'authored-fiction');
  assert.equal(meet.seen.s_ana, 'Ana'); assert.equal(meet.placeId, 'eden:pier');
  assert.equal(speech.untrusted, true); assert.equal(speech.conversationId, 'cv_1'); assert.equal(speech.channel, 'private-conversation');
  assert.deepEqual([owner.act, owner.phase, owner.messageId], ['owner-message', 'completed', 'm_1']);
});

test('A1: what is seen twice is written once, and a repeat answer never conflicts', (t) => {
  const { dir, m } = lived(t), before = logOf(dir).length;
  m.sawEvents([{ id: 'c_1', kind: 'receipt', tick: 120, at: T0, clock: '09:20', receipt: receipt('r_1') }]);
  m.sawReceipt(receipt('r_1'));
  m.sawResult('m_1', true, 'Read the notice for you.');
  m.sawHere(frame());
  m.sawEvents([{ id: 'c_2', kind: 'approach', tick: 131, at: T0 + 9000, clock: '09:29', from: { soulId: 's_ana', name: 'Ana' } }]);
  assert.equal(logOf(dir).length, before);
  const again = open(dir);   // a restart reads the same log
  again.sawReceipt(receipt('r_1'));
  assert.equal(logOf(dir).length, before);
});

test('A1: a torn log fails closed and is left as it is', (t) => {
  const { dir } = lived(t), file = join(dir, 'memory/log/memory-events.jsonl');
  appendFileSync(file, '{"version":"eden-memory-folder/1","kind":"event"');
  const torn = readFileSync(file, 'utf8');
  assert.throws(() => open(dir).sawResult('m_2', true, 'x'), /incomplete machine log/);
  assert.equal(readFileSync(file, 'utf8'), torn);
});

test('A1: an act for an owner message carries the message when it ends', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame());
  m.sawAct('r_9', 'm_9');
  m.sawReceipt(receipt('r_9'));
  assert.equal(events(dir).at(-1).messageId, 'm_9');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'worlds/eden.json'), 'utf8')).openFor, {});
});

test('A1: a world\'s answer that outgrows a record is bounded, not lost', (t) => {
  const dir = tmp(t), m = open(dir), long = 'x'.repeat(5000);
  m.sawHere(frame());
  m.sawReceipt(receipt('r_big', { capability: long, outcome: { summary: long, learned: Array.from({ length: 9 }, (_, i) => ({ fact: long, about: `place ${i} with spaces`, source: `s${i}` })), produced: [], met: [{ soulId: 's_bo', name: long, placeId: 'mill' }] } }));
  const e = events(dir).at(-1);
  assert.equal(e.type, 'outcome'); assert.equal(e.summary.length, 160); assert.equal(e.learned.length, 5); assert.equal(e.met[0].id, 's_bo');
});

test('A1: two sources with one name in two worlds do not conflict; a source that changes is a new reading', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame());
  m.sawReceipt(receipt('r_a'));
  open(dir, { world: 'mars', role: 'visiting' }).sawReceipt(receipt('r_a'));
  m.sawReceipt(receipt('r_b', { outcome: { summary: 'Read it again.', learned: [{ fact: 'The ferry runs at noon.', about: 'pier', source: 'book:ferry' }], produced: [], met: [] } }));
  assert.deepEqual(events(dir).filter((e) => e.type === 'outcome').map((e) => [e.world, e.receiptId, e.learned.length]), [['eden', 'eden:r_a', 1], ['mars', 'mars:r_a', 1], ['eden', 'eden:r_b', 1]]);
  const knowledge = readFileSync(join(dir, 'memory/knowledge.md'), 'utf8');
  assert.match(knowledge, /runs at dawn/); assert.match(knowledge, /runs at noon/);
});

test('a batch survives a bad event: one the record won\'t take costs only itself', (t) => {
  const dir = tmp(t), m = open(dir), good = (id, text) => ({ id, kind: 'speech', tick: 5, at: T0, clock: '09:00', from: { soulId: 's_ana', name: 'Ana' }, text });
  m.sawHere(frame());
  for (const bad of [{ ...good('c_1', '\u0001') }, { ...good('c_2', 'x'), at: 1e20 }, { ...good('c_3', 'x'), tick: -1 }, { ...good('c_4', 'x'), from: { soulId: 's_x', name: ' \u0001 ' } }, { ...good('c_5', 'x'), from: { soulId: 7, name: 'N' } }, { kind: 'receipt', tick: 6, at: T0, receipt: receipt('r_dup', { outcome: { summary: 'ok', learned: [null, { fact: ' ', about: 'pier' }], produced: [{ id: 'o_1' }, { id: 'o_1' }], met: [{ soulId: 's_b', name: 'B' }, { soulId: 's_b', name: 'B' }] } }) }]) m.sawEvents([bad, good(`after-${bad.id ?? 'r'}`, 'Still here.')]);
  const all = events(dir);
  assert.equal(all.filter((e) => e.text === 'Still here.').length, 6, 'every event after a bad one was kept');
  assert.equal(all.find((e) => e.receiptId === 'eden:r_dup').produced.length, 1); assert.equal(all.find((e) => e.receiptId === 'eden:r_dup').met.length, 1);
  assert.equal(open(dir).search('Still here').query, 'Still here', 'and it all replays');
});

test('a world\'s lies stay out of presence and the clock', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame({ now: 'world day 99999999999999999999', me: { place: { evil: 1 }, placePath: ['x'], posture: 'p'.repeat(5000) } }));
  m.sawHere(frame({ me: { place: 'pier', placePath: ['n'.repeat(5000)], posture: 'standing' } }));
  m.sawHere(frame({ me: { place: 'pier', placePath: ['the pier'], posture: 'standing' } }));
  const p = JSON.parse(readFileSync(join(dir, 'worlds/eden.json'), 'utf8'));
  assert.equal(p.worldDay, 3); assert.ok(readFileSync(join(dir, 'worlds/eden.json'), 'utf8').length < 2000);
  m.remember('self', undefined, 'Fine.');
  m.sawResult('m_1', true, 'Fine.');
  assert.equal(events(dir).at(-1).type, 'outcome');
});

test('backlog adds no day; a clock going back as ticks go on does', (t) => {
  const dir = tmp(t), m = open(dir), at = (id, tick, clock) => ({ id, kind: 'speech', tick, at: T0, clock, from: { soulId: 's_ana', name: 'Ana' }, text: id });
  m.sawHere(frame({ tick: 100, clock: '12:00' }));
  m.sawEvents([at('old-1', 50, '08:00'), at('old-2', 60, '08:30')]);
  m.sawEvents([at('old-3', 70, '07:00')]);
  assert.deepEqual(events(dir).filter((e) => e.type === 'speech').map((e) => e.when.worldDay), [3, 3, 3]);
  m.sawEvents([at('next', 500, '06:00')]);
  assert.equal(events(dir).at(-1).when.worldDay, 4);
});

test('a together-act names no place by its id: the name as known stays', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame());
  m.sawReceipt(receipt('r_t', { outcome: { summary: 'Danced with Ana.', learned: [], produced: [], met: [{ soulId: 's_ana', name: 'Ana', placeId: 'pier' }] } }));
  const places = readFileSync(join(dir, 'memory/places.md'), 'utf8');
  assert.match(places, /the pier/); assert.doesNotMatch(places, /formerly/);
  const person = readdirSync(join(dir, 'memory/people')).map((f) => readFileSync(join(dir, 'memory/people', f), 'utf8')).join('');
  assert.match(person, /at the pier/);
  m.sawReceipt(receipt('r_u', { endedAt: { place: 'mill' } }));
  m.sawHere(frame({ tick: 150, me: { place: 'mill', placePath: ['the mill'], posture: 'standing' } }));
  const after = readFileSync(join(dir, 'memory/places.md'), 'utf8');
  assert.match(after, /the mill/); assert.doesNotMatch(after, /formerly/, 'a name turning up for an id is no rename');
});

test('a record names what it carries, and what won\'t fit is cut, not lost', (t) => {
  const dir = tmp(t), m = open(dir), wide = '字'.repeat(200);
  m.sawHere(frame());
  m.sawReceipt(receipt('r_many', { outcome: { summary: 'Made things.', learned: [], produced: Array.from({ length: 32 }, (_, i) => ({ id: `o_${i}`, title: wide, kind: wide, where: `w${i}` })), met: Array.from({ length: 32 }, (_, i) => ({ soulId: `s_${i}`, name: wide, placeId: `m${i}` })) } }));
  const e = events(dir).at(-1);
  assert.equal(e.receiptId, 'eden:r_many'); assert.ok(e.produced.length > 0); assert.equal(e.seen[e.produced[0].id], wide);
});

test('a prototype name is only a name', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame());
  m.sawEvents([{ id: 'c_1', kind: 'speech', tick: 5, at: T0, clock: '09:00', from: { soulId: 'constructor', name: '   ' }, text: 'Boo.' }, { id: 'c_2', kind: 'approach', tick: 6, at: T0, clock: '09:00', from: { soulId: 's_zed', name: 'Zed' } }]);
  assert.equal(m.remember('person', 'Zed', 'Fine.').id, 's_zed');
});

test('the lock: a dead holder is passed over, a live one is waited for and reported, and only its owner frees it', (t) => {
  const dir = tmp(t), m = openSoulMemory(dir, { world: 'eden', soul: 's_me', sleepMs: () => {} }), lock = join(dir, 'runtime/.memory.lock');
  m.sawHere(frame());
  writeFileSync(lock, '999999:gone');
  m.remember('self', undefined, 'A dead holder.');
  assert.ok(!existsSync(lock));
  writeFileSync(lock, `${process.pid}:someone`);
  assert.throws(() => m.remember('self', undefined, 'Waits.'), /another writer holds the lock/);
  assert.equal(readFileSync(lock, 'utf8'), `${process.pid}:someone`, 'the holder keeps it');
  rmSync(lock); mkdirSync(lock);
  assert.throws(() => m.remember('self', undefined, 'A folder.'), /memory:/);
  rmSync(lock, { recursive: true });
});

test('remember --place prefers the world the Soul is in', (t) => {
  const dir = tmp(t), a = open(dir, { world: 'aa' }), b = open(dir, { world: 'bb', role: 'visiting' });
  a.sawHere(frame({ me: { place: 'green', placePath: ['Village Green'], posture: 'standing' } }));
  b.sawHere(frame({ tick: 200, me: { place: 'green', placePath: ['Village Green'], posture: 'standing' } }));
  assert.equal(b.remember('place', 'Village Green', 'Same name, this world.').id, 'bb:green');
});

test('A2: every projection regenerates, and speech and reports keep their label', (t) => {
  const { dir, m } = lived(t);
  m.sawReceipt(receipt('r_said', { outcome: { summary: 'Ana said the mill floods.', untrusted: true, learned: [{ fact: 'The mill floods.', about: 'mill', source: 'said:1', provenance: 'other-soul-report', untrusted: true }], produced: [], met: [] } }));
  const memory = join(dir, 'memory'), people = readdirSync(join(memory, 'people'));
  for (const f of ['self.md', 'goals.md', 'schedule.md', 'places.md', 'knowledge.md', 'lessons.md', 'ledger.md']) assert.ok(existsSync(join(memory, f)), f);
  assert.equal(people.length, 1); assert.equal(readdirSync(join(memory, 'journal')).length, 1);
  const person = readFileSync(join(memory, 'people', people[0]), 'utf8');
  assert.match(person, /UNTRUSTED/); assert.match(person, /Meet me at the mill tomorrow/); assert.match(person, /eden, day 3, 09:21 at the pier/);
  assert.match(readFileSync(join(memory, 'knowledge.md'), 'utf8'), /The mill floods\..*UNTRUSTED/);
  assert.match(readdirSync(join(memory, 'journal')).map((f) => readFileSync(join(memory, 'journal', f), 'utf8')).join(''), /Ana said the mill floods.*untrusted content/);
  rmSync(join(memory, 'places.md')); rmSync(join(memory, 'people', people[0]));
  open(dir).search('anything');
  assert.ok(existsSync(join(memory, 'places.md')) && existsSync(join(memory, 'people', people[0])), 'regenerated from the log');
});

test('A4: remember goes through the validators; memory finds it with its provenance', (t) => {
  const { dir, m } = lived(t);
  assert.deepEqual(m.remember('person', 's_ana', 'Keeps her word.').id, 's_ana');
  assert.equal(m.remember('person', 'ana', 'Likes the mill.').name, 'Ana', 'by the name as seen');
  assert.equal(m.remember('place', 'pier', 'Quiet at dawn.').id, 'eden:pier');
  assert.equal(m.remember('goal', 'learn-boats', 'Learn the boats.', { horizon: 'week', next: 'Ask at the pier' }).id, 'learn-boats');
  m.remember('self', undefined, 'I am patient.'); assert.equal(m.remember('self', undefined, 'I like the sea.').lines, 2, 'self adds a line');
  assert.throws(() => m.remember('person', 's_nobody', 'x'), /no record of meeting/);
  assert.throws(() => m.remember('place', 'moon', 'x'), /no record of being at/);
  assert.throws(() => m.remember('goal', 'g', 'x', { horizon: 'someday' }), /goal horizon/);
  const own = m.search('keeps her word').matches[0];
  assert.match(own.provenance, /What I believe/); assert.equal(own.untrusted, false); assert.match(own.provenance, /Ana/);
  const said = m.search('mill tomorrow').matches[0];
  assert.equal(said.untrusted, true); assert.match(said.provenance, /UNTRUSTED/);
  assert.match(m.search('ferry dawn').matches[0].file, /knowledge\.md/);
  assert.equal(m.search('s_ana').matches.length > 0, true, 'an id is found though markdown escapes it');
  assert.deepEqual(m.search('nothing like this').matches, []);
  assert.equal(logOf(dir).filter((r) => r.kind === 'remember').every((r) => r.value.world === 'eden' && r.value.when), true);
});

test('A5: a place renamed by a god reads by the name as seen and when; a gone id is never an error', (t) => {
  const dir = tmp(t), m = open(dir);
  m.sawHere(frame());
  m.sawEvents([{ id: 'c_1', kind: 'approach', tick: 130, at: T0, clock: '09:21', from: { soulId: 's_ana', name: 'Ana' } }]);
  m.sawHere(frame({ tick: 200, me: { place: 'mill', placePath: ['the mill'], posture: 'standing' } }));
  m.sawHere(frame({ tick: 300, now: '· world day 12', me: { place: 'pier', placePath: ['the old dock'], posture: 'standing' } }));
  const memory = join(dir, 'memory'), journal = readdirSync(join(memory, 'journal')).map((f) => readFileSync(join(memory, 'journal', f), 'utf8')).join('');
  assert.match(journal, /Arrived at the pier/); assert.match(journal, /Arrived at the old dock/);
  assert.match(readFileSync(join(memory, 'places.md'), 'utf8'), /the old dock.*formerly the pier until day 12/);
  const person = readdirSync(join(memory, 'people')).map((f) => readFileSync(join(memory, 'people', f), 'utf8')).join('');
  assert.match(person, /at the pier/, 'the meeting keeps the name it happened under');
  assert.equal(m.remember('place', 'the pier', 'Still smells of tar.').id, 'eden:pier', 'the old name still finds it');
  m.sawReceipt(receipt('r_gone', { endedAt: { place: 'demolished-hut' } }));
  assert.equal(events(dir).at(-1).placeId, 'eden:demolished-hut');
  assert.ok(m.search('demolished-hut').matches.length);
  assert.ok(open(dir).search('old dock').matches.length, 'a reopen replays it all');
});

test('A6: an idle Soul writes nothing', (t) => {
  const { dir, m } = lived(t), log = join(dir, 'memory/log/memory-events.jsonl'), presence = join(dir, 'worlds/eden.json');
  const before = [statSync(log).mtimeMs, statSync(presence).mtimeMs, readFileSync(log, 'utf8')];
  for (let i = 0; i < 3; i++) { m.sawEvents([]); m.sawEvents(undefined); m.sawEvents([{ kind: 'receipt', receipt: { id: 'r_x', phase: 'started' } }, { kind: 'light.changed' }]); m.sawHere(frame()); m.sawReceipt({ id: 'r_y', phase: 'started' }); }
  assert.deepEqual([statSync(log).mtimeMs, statSync(presence).mtimeMs, readFileSync(log, 'utf8')], before);
});

test('two writers: a chat remembers while a serve holds the log open', (t) => {
  const { dir, m } = lived(t), chat = open(dir);
  chat.remember('person', 's_ana', 'From the chat.');
  m.sawEvents([{ id: 'c_9', kind: 'speech', tick: 150, at: T0 + 5000, clock: '09:30', from: { soulId: 's_bo', name: 'Bo' }, text: 'Morning.', untrusted: true }]);
  chat.remember('person', 's_bo', 'New here.');
  assert.deepEqual(logOf(dir).slice(-3).map((r) => r.kind), ['remember', 'event', 'remember']);
  assert.ok(!existsSync(join(dir, 'runtime/.memory.lock')));
});

test('a place id that is no id in the record is kept by its hash, and world keys never collide', () => {
  assert.equal(worldKey('eden', 'pier'), 'eden:pier'); assert.notEqual(worldKey('eden', 'pier'), worldKey('mars', 'pier'));
  assert.match(worldKey('eden', 'a place with spaces'), /^eden:h-[0-9a-f]{40}$/);
});

// Two worlds on one port. Events a test queues come back on the next wait; every request is counted.
async function worlds(t) {
  const w = { a: new Map(), b: new Map() }, seen = [], moves = new Map(), queued = new Map(), places = new Map();
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
      const m = /^\/w\/([ab])(\/.*)$/.exec(req.url); if (!m) return json(res, 404, {});
      const [, slug, full] = m, path = full.split('?')[0], souls = w[slug], body = raw ? JSON.parse(raw) : {}, auth = req.headers.authorization ?? '';
      seen.push({ slug, path, method: req.method });
      const owner = auth.startsWith('Bearer dev:') ? auth.slice(11) : null, me = /^Bearer sim_(s_[a-z0-9]+)_/.exec(auth)?.[1];
      if (path === '/v1/config') return json(res, 200, { devAuth: true, worldId: `w_${slug}`, worldName: `World ${slug}` });
      if (path === '/v1/souls' && req.method === 'POST') { const id = `s_${slug}${souls.size + 1}`; souls.set(id, { name: body.name, owner }); return json(res, 200, { soul: { id, name: body.name } }); }
      const pair = /^\/v1\/souls\/(s_[a-z0-9]+)\/pair$/.exec(path); if (pair) return json(res, 200, { code: `code-${pair[1]}` });
      if (path === '/v1/agent/pair') return json(res, 200, { token: `sim_${body.code.slice(5)}_x` });
      if (path === '/v1/me') return json(res, 200, { souls: [...souls].filter(([, s]) => s.owner === owner).map(([id, s]) => ({ id, name: s.name })) });
      if (path === '/v1/edge/travel' && req.method === 'POST') { const id = me === 's_b9' ? 's_a1' : me, step = moves.get(id).shift(); w[step.to].set(step.soulId, { name: step.name, owner: souls.get(me).owner }); return json(res, 200, { ok: true, to: step.to, base: `http://${req.headers.host}/w/${step.to}`, soulId: step.soulId, token: step.token }); }
      if (!me || !souls.has(me)) return json(res, 401, { code: 'control.unknown' });
      if (path === '/v1/agent/me') return json(res, 200, { soul: { id: me, name: souls.get(me).name }, inbox: {} });
      if (path === '/v1/edge/self/link') return json(res, 200, { link: { state: 'connected' }, now: null });
      if (path === '/v1/edge/here') { const p = places.get(slug) ?? { id: 'square', name: 'the square' }; return json(res, 200, { here: { tick: seen.length, clock: '08:00', now: '· world day 2', me: { soulId: me, name: souls.get(me).name, place: p.id, placePath: [p.name], posture: 'standing' }, near: [] } }); }
      if (path === '/v1/edge/wait') { const list = queued.get(slug) ?? []; queued.set(slug, []); return setTimeout(() => json(res, 200, { cursor: `c_${list.length}`, events: list }), list.length ? 0 : 150); }
      if (path.startsWith('/v1/edge/inbox/listen')) return setTimeout(() => json(res, 200, { items: [] }), 150);
      if (/\/v1\/edge\/inbox\/[^/]+\/result$/.test(path)) return json(res, 200, { ok: true });
      json(res, 404, { code: 'no-route', path });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { base: `http://127.0.0.1:${server.address().port}/w`, seen, moves, places, queue: (slug, ...list) => queued.set(slug, [...(queued.get(slug) ?? []), ...list]) };
}
const cliIn = (cwd) => (...args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [cli, ...args], { cwd, env: { ...process.env, HOME: cwd, SOULS_HOME: '', SOULS_PRINCIPAL: '', EDEN_TIME_SCALE: '0.01' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', (c) => { out += c; }); child.stderr.on('data', (c) => { err += c; });
  child.on('exit', (code) => { let d = null; try { d = JSON.parse(out); } catch { /* words */ } resolve({ code, d, out, err }); });
});

test('A3: travel keeps one log, writes a presence per world, and comes home without loss', async (t) => {
  const f = await worlds(t), dir = tmp(t), run = cliIn(dir), soul = join(dir, '.souls/souls/s_a1');
  await run('register', `${f.base}/a`); await run('create', 'Mira');
  await run('here');
  assert.equal(events(soul)[0].world, 'a'); assert.equal(events(soul)[0].seen['a:square'], 'the square');
  f.moves.set('s_a1', [{ to: 'b', soulId: 's_b9', token: 'sim_s_b9_x', name: 'Mira' }, { to: 'a', soulId: 's_a1', token: 'sim_s_a1_back', name: 'Mira' }]);
  assert.equal((await run('travel', 'b')).d.ok, true);
  assert.ok(existsSync(join(soul, 'worlds/b.json')), 'the new world has a presence'); assert.equal(events(soul).length, 1, 'the log stays');
  f.places.set('b', { id: 'square', name: 'the other square' });
  await run('here');
  assert.deepEqual(events(soul).map((e) => [e.world, e.placeId]), [['a', 'a:square'], ['b', 'b:square']], 'same place id, another world');
  const status = (await run('status')).d;
  assert.deepEqual(status.worlds.map((p) => [p.world, p.role, p.soul]), [['a', 'home', 's_a1'], ['b', 'visiting', 's_b9']]);
  assert.ok(status.worlds[0].left, 'the home world shows the Soul left');
  assert.equal((await run('travel', 'a')).d.ok, true);
  await run('here');
  assert.deepEqual(events(soul).map((e) => e.world), ['a', 'b', 'a'], 'coming back is an arrival, and nothing was lost');
  assert.deepEqual(presences(soul).map((p) => p.world), ['a', 'b']);
  assert.equal(presences(soul)[0].left, null);
  assert.equal((await run('memory', 'other', 'square')).d.matches.length > 0, true);
});

test('A6: remember and memory make no request; a command writes only what it was already told', async (t) => {
  const f = await worlds(t), dir = tmp(t), run = cliIn(dir), soul = join(dir, '.souls/souls/s_a1');
  await run('register', `${f.base}/a`); await run('create', 'Mira'); await run('here');
  const asked = f.seen.length;
  assert.equal((await run('remember', '--place', 'square', 'Good', 'light', 'here.')).d.remembered, 'place');
  assert.equal((await run('remember', '--self', 'I keep promises.')).d.lines, 1);
  const found = (await run('memory', 'good', 'light')).d;
  assert.match(found.matches[0].text, /Good light here/);
  assert.equal(f.seen.length, asked, 'neither touched the world');
  assert.match((await run('remember', 'no', 'selector')).err, /usage: remember/);
  assert.match((await run('memory')).err, /usage: memory/);
  assert.equal(events(soul).length, 3);
});

test('wait and result are noted without a serve; with one up the serve notes them, once', async (t) => {
  const f = await worlds(t), dir = tmp(t), run = cliIn(dir), soul = join(dir, '.souls/souls/s_a1');
  await run('register', `${f.base}/a`); await run('create', 'Mira'); await run('here');
  f.queue('a', { id: 'c_1', kind: 'speech', tick: 11, at: T0, clock: '08:01', from: { soulId: 's_ana', name: 'Ana' }, text: 'Hello.', untrusted: true });
  await run('wait', '1');
  assert.deepEqual(events(soul).map((e) => e.type), ['arrival', 'speech']);
  await run('result', 'm_1', 'done', 'Said hello back.');
  assert.deepEqual(events(soul).at(-1).summary, 'Said hello back.');
  assert.equal((await run('serve')).d.serving, true);
  try {
  f.queue('a', { id: 'c_2', kind: 'conversation.turn', tick: 12, at: T0 + 1000, clock: '08:02', conversation: 'cv_1', turn: { seq: 1, from: { soulId: 's_ana', name: 'Ana' }, text: 'Are you there?' }, untrusted: true });
  for (let i = 0; i < 100 && !events(soul).some((e) => e.conversationId === 'cv_1'); i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(events(soul).filter((e) => e.conversationId === 'cv_1').length, 1, 'the resident client wrote it');
  await run('remember', '--person', 'Ana', 'Asked after me.');
  await run('result', 'm_2', 'failed', 'Could not reach her.');
  await run('here');
  assert.equal(events(soul).filter((e) => e.messageId === 'm_2').length, 1);
  assert.equal(logOf(soul).filter((r) => r.kind === 'remember').length, 1);
  } finally {
    await run('serve', '--stop');
    for (let i = 0; i < 100 && existsSync(join(soul, 'runtime/.eden-serve.lock')); i++) await new Promise((r) => setTimeout(r, 20));
  }
});

test('a legacy folder is left as it was: no memory, and it says how to get one', async (t) => {
  const dir = tmp(t), run = cliIn(dir), f = await worlds(t);
  writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ world: `${f.base}/a`, soul: 's_a1', token: 'sim_s_a1_x' }));
  assert.match((await run('remember', '--self', 'x')).err, /Move this folder in first/);
  assert.ok(!existsSync(join(dir, 'memory')));
});
