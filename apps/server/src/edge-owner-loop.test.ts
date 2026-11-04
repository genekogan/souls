// D3 (playtest 2026-10-25, ROOT-CAUSES §C D3): the server closes the owner loop. An act names the owner message it serves
// (`for`); when its receipt ends the world writes that message's result (resultBy 'server') unless the agent already
// did, and the agent's own result still replaces it. A `wait`, which ends when the owner writes, counts as listening, so
// the card no longer reads "away" while the agent waits on its act.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Db} from './db.ts';
import {AgentInbox} from './inbox.ts';
import {OwnerLoop, type OwnerLoopWorld} from './edge/owner-loop.ts';
import {messageSteps} from './edge/ledger/vocabulary.ts';
import type {EdgeReceipt} from './edge/contract.ts';
import type {Objects} from './edge/comms/objects/framework.ts';

// D3d: a small commons as the ledger would report it: the balloon and a bench 40 m apart on g-commons, the pavilion's room
const commonsWorld = (): OwnerLoopWorld => {
  const paths: Record<string, string[]> = {'g-commons': ['g-commons', 'world'], 'commons-pavilion': ['commons-pavilion', 'g-commons', 'world'],
    'commons-pavilion/pavilion': ['commons-pavilion/pavilion', 'commons-pavilion', 'g-commons', 'world'], world: ['world']};
  const pos: Record<string, [number, number]> = {'festival-balloon': [290, 65], 'bank-bench': [250, 60], 's_tam': [270, 50], 's_mira': [280, 40]};
  return {
    stepTarget: (_soul, words) => {
      const souls = words.flatMap(w => w === 'tam' ? ['s_tam'] : w === 'mira' ? ['s_mira'] : []), rest = words.filter(w => w !== 'tam' && w !== 'mira');
      if (rest.some(w => !['balloon', 'pavilion', 'commons'].includes(w))) return null;
      return {souls, things: rest.includes('balloon') ? ['festival-balloon'] : [], places: rest.includes('pavilion') ? ['commons-pavilion'] : rest.includes('commons') ? ['g-commons'] : []};
    },
    // walk:pavilion is offered as a walk to the commons-pavilion place (an id unlike its own words)
    actTarget: (_soul, capability) => capability === 'walk:pavilion' ? 'commons-pavilion' : null,
    placePath: id => paths[id] ?? null,
    posOf: id => pos[id] ?? null,
  };
};

test('D3: act --for links the receipt to the owner message; the world writes the result; the agent overrides; wait is listening', {timeout: 300000}, async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Owner loop fixture'}));
  const token = f.souls.pairExchange(f.souls.pairCode(a, 'http://127.0.0.1:5964').code, 'scripted').token;
  const edge = new EdgeLedger(f.host, f.db);
  const app = buildApp({cfg: {...config, port: 5964, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5964/w/eden', accountAuthRequired: false, webDir: '/nonexistent-loop-fixture', marsWebDir: '/nonexistent-loop-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge, hub: {clients: new Map(), refreshMe() {}} as never});
  const req = async (path: string, auth?: string, body?: unknown, method?: string) => {
    const r = await app.request(path, {method: method ?? (body === undefined ? 'GET' : 'POST'), headers: {...(auth ? {authorization: `Bearer ${auth}`} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: r.status, data: await r.json() as any};
  };
  const box = `/v1/edge/owner/${a.id}/inbox`, owner = async () => (await req(box, 'dev:alice')).data.inbox;
  assert.equal((await req(box, 'dev:alice', {text: 'wave to me'})).status, 200);
  const msg = (await req('/v1/edge/inbox/listen?timeoutMs=0', token)).data.backlog[0];
  assert.equal((await req(`/v1/edge/inbox/${msg.id}/ack`, token, {reply: 'Will try a wave'})).status, 200);

  // presence: with the listen grace long past, the box is away; while a wait is open it is listening
  f.db.db.prepare('UPDATE agent_inbox_v1 SET listened_at=0').run();
  assert.equal((await owner()).presence, 'away');
  const cursor = (await req('/v1/edge/wait?after=c_0&timeout=1', token)).data.cursor;
  f.db.db.prepare('UPDATE agent_inbox_v1 SET listened_at=0').run();
  const waiting = req(`/v1/edge/wait?after=${cursor}&timeout=2`, token);
  await new Promise(r => setTimeout(r, 50));
  assert.equal((await owner()).presence, 'listening', 'an open wait is listening');
  await waiting;

  // `for` must name a message of this Soul
  const bad = await req('/v1/edge/act', token, {capability: 'wave', for: 'm_nope'});
  assert.equal(bad.status, 400); assert.match(bad.data.error.message, /no owner message/);
  // the act's end writes the result
  const out = (await accept(f.host, req('/v1/edge/act', token, {capability: 'wave', for: msg.id}))).data;
  assert.equal(out.accepted, true, JSON.stringify(out)); assert.equal(out.for, msg.id);
  for (let i = 0; i < 2000 && ['waiting', 'started', 'accepted'].includes(edge.receipt(a.id, out.receipt.id)!.phase); i++) { f.host.tickOnce(); if (i % 20 === 0) { await new Promise(r => setImmediate(r)); f.host.drainInputs(); } }
  assert.equal(edge.receipt(a.id, out.receipt.id)!.phase, 'completed');
  await new Promise(r => setTimeout(r, 20));
  const closed = (await owner()).log?.find((m: any) => m.id === msg.id) ?? (await req('/v1/edge/inbox/listen?timeoutMs=0', token)).data.inbox.latest;
  const row = f.db.db.prepare('SELECT result,outcome,result_by FROM soul_inbox_queue_v1 WHERE id=?').get(msg.id) as any;
  assert.equal(row.result_by, 'server', JSON.stringify({row, closed})); assert.equal(row.outcome, 'done'); assert.ok(row.result.length > 0 && row.result.length <= 140);
  // the agent's own words replace the world's line; then a second agent result is refused as before
  assert.equal((await req(`/v1/edge/inbox/${msg.id}/result`, token, {outcome: 'done', text: 'Waved at you'})).status, 200);
  const mine = f.db.db.prepare('SELECT result,result_by FROM soul_inbox_queue_v1 WHERE id=?').get(msg.id) as any;
  assert.equal(mine.result, 'Waved at you'); assert.equal(mine.result_by, null);
  assert.equal((await req(`/v1/edge/inbox/${msg.id}/result`, token, {outcome: 'done', text: 'something else'})).status, 409);
  // a later linked act never overwrites the agent's result
  const again = (await accept(f.host, req('/v1/edge/act', token, {capability: 'wave', for: msg.id}))).data;
  for (let i = 0; i < 2000 && ['waiting', 'started', 'accepted'].includes(edge.receipt(a.id, again.receipt.id)!.phase); i++) { f.host.tickOnce(); if (i % 20 === 0) { await new Promise(r => setImmediate(r)); f.host.drainInputs(); } }
  await new Promise(r => setTimeout(r, 20));
  assert.equal((f.db.db.prepare('SELECT result FROM soul_inbox_queue_v1 WHERE id=?').get(msg.id) as any).result, 'Waved at you');
  // D3c: the CLI's default link (forDefault) on an act that is not the message's last step answers `open` and leaves it open
  assert.equal((await req(box, 'dev:alice', {text: 'sit down for a bit, then come back to me'})).status, 200);
  const next = (await req(`/v1/edge/inbox/listen?after=${msg.id}&timeoutMs=0`, token)).data.backlog[0];
  assert.equal((await req(`/v1/edge/inbox/${next.id}/ack`, token, {reply: 'Got it'})).status, 200);
  const open = (await accept(f.host, req('/v1/edge/act', token, {capability: 'wave', for: next.id, forDefault: true}))).data;
  assert.equal(open.accepted, true, JSON.stringify(open)); assert.equal(open.for, next.id); assert.equal(open.open, true);
  for (let i = 0; i < 2000 && ['waiting', 'started', 'accepted'].includes(edge.receipt(a.id, open.receipt.id)!.phase); i++) { f.host.tickOnce(); if (i % 20 === 0) { await new Promise(r => setImmediate(r)); f.host.drainInputs(); } }
  await new Promise(r => setTimeout(r, 20));
  const kept = f.db.db.prepare('SELECT result,progress FROM soul_inbox_queue_v1 WHERE id=?').get(next.id) as any;
  assert.equal(kept.result, null, 'a wave does not close "sit down, then come back"'); assert.match(kept.progress, /^now: .+; not sitting yet$/);
});

// D3c (laptop-20261026 fix/trio-r1 rook-003, W/O2): Mira asked "find a comfy spot and have a little rest, then come back
// to the balloon to meet me"; Rook acked "rest a bit, then back to the balloon", then waved at Tam; the CLI's default link
// put the wave on the message and its end closed the card Done. A default (implicit) link now closes only with an act of
// the message's last step; any other act's end writes a progress line and the card stays open. Explicit links unchanged.
test('D3c rook-003: a default-linked wave, then a sit, keep "rest, then come back to the balloon" open; the walk back closes it', t => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-d3c-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  const db = new Db(join(dir, 'fixture.db')); t.after(() => db.close());
  const inbox = new AgentInbox(db, 'w1'), soul = {soulId: 's_rook', entityId: 'h_rook', name: 'Rook', owner: 'mira'}, scope = {scope: 'soul:s_rook', owner: 'mira'};
  let emit: (r: EdgeReceipt) => void = () => {};
  const done = new Map<string, string>(), ends = new Map<string, unknown>();
  // D3d: the ledger's world (resolver, place ancestry, positions) and where each act's body ended
  const loop = new OwnerLoop(inbox, (_s, id) => ({...rec(id, '', 'completed'), ...(done.has(id) ? {done: done.get(id)} : {}), ...(ends.has(id) ? {endedAt: ends.get(id)} : {})}) as never, l => { emit = l; }, commonsWorld());
  const rec = (id: string, capability: string, phase: EdgeReceipt['phase']) => ({id, soulId: 's_rook', capability, phase, acceptedTick: 1, startedTick: 1, endedTick: phase === 'completed' || phase === 'failed' ? 2 : null, code: null, reason: null, programId: null}) as EdgeReceipt;
  const end = (id: string, capability: string, line: string, endedAt?: unknown) => { done.set(id, line); if (endedAt) ends.set(id, endedAt); emit(rec(id, capability, 'completed')); };
  const row = (id: string) => db.db.prepare('SELECT result,outcome,result_by,progress FROM soul_inbox_queue_v1 WHERE id=?').get(id) as {result: string | null; outcome: string | null; result_by: string | null; progress: string | null};
  inbox.send(scope, 'Aww, well done Rook! Now could you find a comfy spot and have a little rest, then come back to the balloon to meet me?');
  const msg = inbox.takeBacklog(scope)[0]; inbox.acknowledge(scope, msg.id, 'Got it: will say hi to Mira, rest a bit, then back to the balloon');

  // the first act after the ack: a wave to Tam (the receipt that closed the card Done in trio-r1)
  assert.deepEqual(loop.link(soul, rec('r_wave', 'wave:s_tam', 'started'), msg.id, true), {open: true}, 'a wave is no step of this message');
  end('r_wave', 'wave:s_tam', 'wave completed at g-commons.');
  let r = row(msg.id);
  assert.equal(r.result, null, 'the wave does not close the message'); assert.equal(r.outcome, null);
  assert.equal(r.progress, 'now: wave completed at g-commons; not resting yet');
  assert.equal(inbox.ownerView(scope).latest?.progress, r.progress, 'the owner card shows the progress line');
  // the rest: a sit is its first step, not its last, so the message stays open and says what is still to come
  assert.deepEqual(loop.link(soul, rec('r_sit', 'sit:bench-2', 'started'), msg.id, true), {open: true});
  end('r_sit', 'sit:bench-2', 'sat on bench 2 at g-commons for 60 s.');
  r = row(msg.id); assert.equal(r.result, null, 'still open after the rest'); assert.equal(r.progress, 'now: sat on bench 2 at g-commons for 60 s; not there yet');
  // D3d (fix-d3c-c trio-r1 rook-003): a walk to a bench on the commons is a walk, but not back to the balloon (40 m off);
  // D3c closed the card here as "walk completed at g-commons."
  assert.deepEqual(loop.link(soul, rec('r_bench', 'walk:bank-bench', 'started'), msg.id, true), {open: true}, 'a walk to the bench is not the way back to the balloon');
  end('r_bench', 'walk:bank-bench', 'walk completed at g-commons.', {place: 'g-commons', placePath: ['Commons'], pos: [250, 60], posture: 'standing'});
  r = row(msg.id); assert.equal(r.result, null, 'the bench walk does not close it'); assert.equal(r.outcome, null);
  assert.equal(r.progress, 'now: walk completed at g-commons; not there yet');
  // nor a sit on that bench
  assert.deepEqual(loop.link(soul, rec('r_bsit', 'sit:bank-bench', 'started'), msg.id, true), {open: true});
  end('r_bsit', 'sit:bank-bench', 'sat on bank-bench at g-commons.', {place: 'g-commons', placePath: ['Commons'], pos: [250, 60], posture: 'sitting', seat: 'bank-bench'});
  r = row(msg.id); assert.equal(r.result, null, 'the sit on the bench does not close it'); assert.equal(r.progress, 'now: sat on bank-bench at g-commons; not there yet');
  // back to the balloon: the last step closes it
  assert.deepEqual(loop.link(soul, rec('r_walk', 'walk:festival-balloon', 'started'), msg.id, true), {open: false});
  end('r_walk', 'walk:festival-balloon', 'arrived at the festival balloon.', {place: 'g-commons', placePath: ['Commons'], pos: [288, 63], posture: 'standing'});
  r = row(msg.id); assert.equal(r.result, 'arrived at the festival balloon.'); assert.equal(r.outcome, 'done'); assert.equal(r.result_by, 'server');
  assert.equal(inbox.ownerView(scope).latest?.result, 'arrived at the festival balloon.');

  // an explicit link (the agent chose it) keeps D3's behaviour: the wave closes it
  inbox.send(scope, 'have a little rest, then come back to the balloon');
  const two = inbox.takeBacklog(scope)[0]; inbox.acknowledge(scope, two.id, 'Got it');
  assert.deepEqual(loop.link(soul, rec('r_wave2', 'wave:s_tam', 'started'), two.id), {open: false});
  end('r_wave2', 'wave:s_tam', 'wave completed at g-commons.');
  assert.equal(row(two.id).result, 'wave completed at g-commons.');
  // a message whose words name no act cannot be judged: the default link closes it as before
  inbox.send(scope, 'Do something fun!');
  const three = inbox.takeBacklog(scope)[0]; inbox.acknowledge(scope, three.id, 'Got it');
  assert.deepEqual(loop.link(soul, rec('r_dance', 'dance:here', 'started'), three.id, true), {open: false});
  end('r_dance', 'dance:here', 'danced at g-commons.');
  assert.equal(row(three.id).outcome, 'done');
  // a progress line never lands on a message that already has a result, and a mismatched act on a one-step message stays open
  inbox.send(scope, 'sit on the bench');
  const four = inbox.takeBacklog(scope)[0]; inbox.acknowledge(scope, four.id, 'Got it');
  assert.deepEqual(loop.link(soul, rec('r_w4', 'wave:here', 'started'), four.id, true), {open: true});
  inbox.result(scope, four.id, 'Sat down already.', 'done');
  end('r_w4', 'wave:here', 'wave completed at g-commons.');
  assert.equal(row(four.id).progress, null); assert.equal(row(four.id).result, 'Sat down already.');
});

// D3d (laptop-20261026 fix-d3c-c trio-r1 rook-003): D3c matched the last step on its verb only, so "…then come back to
// the balloon" was closed by a walk to a bench. The last step of a several-step message now names a target the act must
// reach (the receipt's own target, a place inside the named one, or where the body ended); an unresolved target is
// never closed by default (the agent's result closes it). One-step messages keep D3c's verb rule.
test('D3d: a default-linked last step closes only at its target; an unresolved target stays open until the agent says', t => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-d3d-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  const db = new Db(join(dir, 'fixture.db')); t.after(() => db.close());
  const inbox = new AgentInbox(db, 'w1'), soul = {soulId: 's_rook', entityId: 'h_rook', name: 'Rook', owner: 'mira'}, scope = {scope: 'soul:s_rook', owner: 'mira'};
  let emit: (r: EdgeReceipt) => void = () => {};
  const done = new Map<string, string>(), ends = new Map<string, unknown>(), world = commonsWorld();
  const loop = new OwnerLoop(inbox, (_s, id) => ({...rec(id, '', 'completed'), done: done.get(id), ...(ends.has(id) ? {endedAt: ends.get(id)} : {})}) as never, l => { emit = l; }, world);
  const rec = (id: string, capability: string, phase: EdgeReceipt['phase']) => ({id, soulId: 's_rook', capability, phase, acceptedTick: 1, startedTick: 1, endedTick: phase === 'completed' ? 2 : null, code: null, reason: null, programId: null}) as EdgeReceipt;
  const act = (msg: string, id: string, capability: string, line: string, endedAt: unknown) => {const out = loop.link(soul, rec(id, capability, 'started'), msg, true); done.set(id, line); ends.set(id, endedAt); emit(rec(id, capability, 'completed')); return out;};
  const row = (id: string) => db.db.prepare('SELECT result,outcome,result_by,progress FROM soul_inbox_queue_v1 WHERE id=?').get(id) as {result: string | null; outcome: string | null; result_by: string | null; progress: string | null};
  const send = (text: string) => {inbox.send(scope, text); const m = inbox.takeBacklog(scope)[0]; inbox.acknowledge(scope, m.id, 'Got it'); return m.id;};
  const at = (place: string, pos: [number, number]) => ({place, placePath: [], pos, posture: 'standing'});

  // the steps carry their targets: words naming nothing ("a comfy spot", "me") leave none, unknown words are unresolved
  const rook = messageSteps('find a comfy spot and have a little rest, then come back to the balloon to meet me', w => world.stepTarget(soul, w));
  assert.equal(rook.length, 2); assert.equal(rook[0].target, null); assert.equal(rook[0].unresolved, undefined);
  assert.deepEqual(rook[1].target, {souls: [], things: ['festival-balloon'], places: []}); assert.equal(rook[1].words, 'balloon');
  assert.deepEqual(messageSteps('say hi to Tam and Mira, then come back to me', w => world.stepTarget(soul, w)).map(s => s.target), [{souls: ['s_tam', 's_mira'], things: [], places: []}, null]);
  const gazebo = messageSteps('have a rest, then go to the gazebo', w => world.stepTarget(soul, w)).at(-1)!;
  assert.equal(gazebo.target, null); assert.equal(gazebo.unresolved, true); assert.equal(gazebo.words, 'gazebo');
  assert.equal(messageSteps('have a rest, then go to the gazebo').at(-1)!.unresolved, undefined, 'no resolver: no target is judged');

  // a place target: a walk that ends outside it keeps the card open; a walk into a room inside it closes it
  const pav = send('have a rest, then go to the pavilion');
  assert.deepEqual(act(pav, 'p1', 'walk:bank-bench', 'walk completed at g-commons.', at('g-commons', [250, 60])), {open: true});
  assert.equal(row(pav).result, null, 'the commons is not the pavilion'); assert.equal(row(pav).progress, 'now: walk completed at g-commons; not resting yet');
  assert.deepEqual(act(pav, 'p2', 'walk:commons-pavilion/pavilion', 'arrived in the pavilion.', at('commons-pavilion/pavilion', [255, 30])), {open: false}, 'a room of the pavilion is the pavilion');
  assert.equal(row(pav).result, 'arrived in the pavilion.'); assert.equal(row(pav).outcome, 'done'); assert.equal(row(pav).result_by, 'server');
  const pav2 = send('have a rest, then go to the pavilion');
  assert.deepEqual(act(pav2, 'p3', 'walk:pavilion', 'walk completed.', at('g-commons', [256, 36])), {open: false}, 'an offered walk whose target is the pavilion');
  assert.equal(row(pav2).result, 'walk completed.');
  // a thing target: a walk to some place counts when the body ended at the balloon (its answer cannot know that yet)
  const bal = send('rest a bit, then come back to the balloon');
  assert.deepEqual(act(bal, 'b1', 'walk:g-commons', 'walk completed at g-commons.', at('g-commons', [288, 64])), {open: true});
  assert.equal(row(bal).result, 'walk completed at g-commons.', 'ended 2 m from the balloon: there');
  // a Soul target: a wave to someone else is not a hi to Tam
  const hi = send('sit down, then say hi to Tam');
  assert.deepEqual(act(hi, 'h1', 'wave:s_mira', 'waved at Mira.', at('g-commons', [280, 41])), {open: true});
  assert.equal(row(hi).result, null); assert.match(row(hi).progress!, /^now: waved at Mira; not sitting yet$/);
  assert.deepEqual(act(hi, 'h2', 'wave:s_tam', 'waved at Tam.', at('g-commons', [268, 50])), {open: false});
  assert.equal(row(hi).result, 'waved at Tam.');
  // an unresolved target: no act closes it by default, the agent's own result does
  const gz = send('have a rest, then go to the gazebo');
  assert.deepEqual(act(gz, 'g1', 'sit:bank-bench', 'sat on bank-bench.', at('g-commons', [250, 60])), {open: true});
  assert.equal(row(gz).result, null); assert.equal(row(gz).progress, 'now: sat on bank-bench; not there yet');
  assert.deepEqual(act(gz, 'g2', 'walk:commons-pavilion', 'arrived at the pavilion.', at('commons-pavilion', [255, 30])), {open: true}, 'the world cannot tell where the gazebo is');
  assert.equal(row(gz).result, null, 'an unresolved target is not closed by a walk'); assert.equal(row(gz).progress, 'now: arrived at the pavilion; not there yet');
  inbox.result(scope, gz, 'This is the closest thing to a gazebo here.', 'done');
  assert.equal(row(gz).result, 'This is the closest thing to a gazebo here.'); assert.equal(row(gz).result_by, null);
  // one step keeps D3c's verb rule, target or not
  const one = send('go to the pavilion');
  assert.deepEqual(act(one, 'o1', 'walk:bank-bench', 'walk completed at g-commons.', at('g-commons', [250, 60])), {open: false});
  assert.equal(row(one).result, 'walk completed at g-commons.');
});

// #804: the object act route names the owner message it serves (`for`), checked and linked as on /v1/edge/act. A
// body-moving action links its Ledger receipt; a non-body one is a defined immediate result (the message closes now).
test('#804: POST /objects/:id/act --for: a bad id is refused; a non-body action closes the message now; a body action closes it when its receipt ends; default links serve the action\'s own verb', {timeout: 300000}, async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Object loop fixture'}));
  const token = f.souls.pairExchange(f.souls.pairCode(a, 'http://127.0.0.1:5964').code, 'scripted').token;
  const edge = new EdgeLedger(f.host, f.db);
  const app = buildApp({cfg: {...config, port: 5964, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5964/w/eden', accountAuthRequired: false, webDir: '/nonexistent-loop-fixture', marsWebDir: '/nonexistent-loop-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge, hub: {clients: new Map(), refreshMe() {}} as never});
  const req = async (path: string, auth?: string, body?: unknown) => {
    const r = await app.request(path, {method: body === undefined ? 'GET' : 'POST', headers: {...(auth ? {authorization: `Bearer ${auth}`} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: r.status, data: await r.json() as any};
  };
  const objects = edge.comms!.objects as unknown as Objects;
  objects.create({id: 'chess-o', kind: 'chess', name: 'Chess table', placeId: 'world'});
  // a body-moving object action (OBJECT-CONTRACT §7): the Ledger performs its steps as a logged decision with a receipt
  objects.register({kind: 'test-ride', description: 'a little ride', listed: true, roles: [], schema: {}, initial: () => ({}), rolesOf: () => [],
    actions: {join: {label: 'Get on the little ride', movesBody: true, roles: 'anyone', reach: 'anywhere', params: {}, validate: () => null, apply: (s: object) => ({state: s, bodies: [{label: 'Get on the little ride', steps: [{verb: 'wave', params: {seconds: 1}}]}]})}}});
  objects.create({id: 'ride-o', kind: 'test-ride', name: 'Little ride', placeId: 'world'});
  const box = `/v1/edge/owner/${a.id}/inbox`, row = (id: string) => f.db.db.prepare('SELECT result,outcome,result_by,progress FROM soul_inbox_queue_v1 WHERE id=?').get(id) as any;
  const ask = async (text: string, after?: string) => {
    assert.equal((await req(box, 'dev:alice', {text})).status, 200);
    const m = (await req(`/v1/edge/inbox/listen?${after ? `after=${after}&` : ''}timeoutMs=0`, token)).data.backlog.at(-1);
    assert.equal((await req(`/v1/edge/inbox/${m.id}/ack`, token, {reply: 'On it'})).status, 200); return m;
  };
  const m1 = await ask('sit at the chess table');
  // A1: the same check as /v1/edge/act, before the object acts
  const bad = await req('/v1/edge/objects/chess-o/act', token, {action: 'sit', for: 'm_nope'});
  assert.equal(bad.status, 400); assert.match(bad.data.error.message, /no owner message/);
  // A3: a non-body action is an immediate result: the world writes the message's result line now
  // (the CLI's and the managed runtime's default link: the action `sit` is the message's one step, so it closes it)
  const sat = (await req('/v1/edge/objects/chess-o/act', token, {action: 'sit', for: m1.id, forDefault: true})).data;
  assert.equal(sat.accepted, true, JSON.stringify(sat)); assert.equal(sat.for, m1.id); assert.equal(sat.open, undefined); assert.equal(sat.receipt, undefined, 'no Ledger receipt is invented');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(row(m1.id).result_by, 'server', JSON.stringify(row(m1.id))); assert.equal(row(m1.id).outcome, 'done'); assert.equal(row(m1.id).result, 'Sit at the chess table: done.', 'the action label, not the capability id'); assert.equal(row(m1.id).progress, null, 'no "not sitting yet" line');
  // a default link on a message this action is not the last step of answers `open` and leaves it open
  const m2 = await ask('leave the chess table, then come back to me', m1.id);
  const left = (await req('/v1/edge/objects/chess-o/act', token, {action: 'leave', for: m2.id, forDefault: true})).data;
  assert.equal(left.accepted, true, JSON.stringify(left)); assert.equal(left.for, m2.id); assert.equal(left.open, true);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(row(m2.id).result, null, 'still open'); assert.match(row(m2.id).progress, /; not there yet$/, 'the leave is not the walk back');
  // A1: a body-moving action links its receipt; the message closes when the receipt ends
  // (a default link: "ride" widens to the ride's `join`, so this body action is the message's one step)
  const m3 = await ask('ride the little ride', m2.id);
  const g = (await accept(f.host, req('/v1/edge/objects/ride-o/act', token, {action: 'join', for: m3.id, forDefault: true}))).data;
  assert.equal(g.accepted, true, JSON.stringify(g)); assert.equal(g.for, m3.id); assert.equal(g.open, undefined); assert.ok(g.receipt?.id);
  assert.equal(row(m3.id).result, null, 'not before the receipt ends');
  for (let i = 0; i < 2000 && ['waiting', 'started', 'accepted'].includes(edge.receipt(a.id, g.receipt.id)!.phase); i++) { f.host.tickOnce(); if (i % 20 === 0) { await new Promise(r => setImmediate(r)); f.host.drainInputs(); } }
  await new Promise(r => setTimeout(r, 20));
  assert.equal(edge.receipt(a.id, g.receipt.id)!.phase, 'completed'); assert.equal(row(m3.id).result_by, 'server', JSON.stringify(row(m3.id))); assert.equal(row(m3.id).progress, null);
  // a refused object action is never linked; no `for` is unchanged
  const m4 = await ask('make a chess move', m3.id);
  const no = (await req('/v1/edge/objects/chess-o/act', token, {action: 'move', params: {from: 'e2', to: 'e4'}, for: m4.id})).data;
  assert.equal(no.accepted, false); assert.equal(no.for, undefined); assert.equal(row(m4.id).result, null);
  const plain = (await req('/v1/edge/objects/chess-o/act', token, {action: 'sit'})).data;
  assert.equal(plain.accepted, true, JSON.stringify(plain)); assert.equal(plain.for, undefined);
});
