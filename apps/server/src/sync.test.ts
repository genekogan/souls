// End-to-end sync: a real server process, real WebSocket clients, fake brain.
// Asserts that replicas agree with the server's view hash, survive a dropped
// socket by resuming from the ring buffer, and that the agent API steers.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Connection } from '@souls/client';
import {testPort} from '../test/test-port.ts';
const TEST_PORT=await testPort();

const PORT = TEST_PORT; // Core's reserved local range; suite runs serially.
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clients = new Set<Connection>();
const client = (token: string | null = null) => { const c = new Connection(`ws://127.0.0.1:${PORT}/ws`, async () => token, {}, (u) => new WebSocket(u) as any); clients.add(c); c.connect(); return c; };
const api = async (path: string, token: string, body?: unknown, method?: string) => {
  const r = await fetch(BASE + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t as any }; }
};

before(async () => {
  proc = spawn(process.execPath, [new URL('./main.ts', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: mkdtempSync(join(tmpdir(), 'souls-sync-')), BRAIN_MODE: 'fake', MIND_DRIVER: 'central', DEV_AUTH: '1', PUBLIC_URL: BASE, WEB_DIR: '/nonexistent', INVITE_REQUIRED: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* not up yet */ } await sleep(200); }
  throw new Error('server did not start');
});
after(() => { proc?.kill('SIGTERM'); });
afterEach(() => { for (const c of clients) c.close(); clients.clear(); });

test('two clients joining at different times agree with the server', async () => {
  const a = client(); await sleep(3000);
  const b = client(); await sleep(12000);
  for (const c of [a, b]) {
    assert.equal(c.stats.state, 'open');
    assert.ok(c.stats.heartbeats >= 2, `heartbeats ${c.stats.heartbeats}`);
    assert.equal(c.stats.lastCheck, 'ok');
    assert.equal(c.stats.resyncs, 0);
    assert.equal(c.stats.snapshots, 1);
  }
  assert.equal(a.replica.viewHash(a.stats.lastHeartbeatTick), b.replica.viewHash(a.stats.lastHeartbeatTick));
  assert.ok(Object.values(a.replica.entities).filter((e) => e.kind === 'human').length >= 6);
  a.close(); b.close();
});

test('a dropped socket resumes from the ring buffer without a new snapshot and converges', async () => {
  const c = client(); await sleep(6000);
  assert.equal(c.stats.lastCheck, 'ok');
  c.dropForTest(); await sleep(7000);
  assert.equal(c.stats.state, 'open');
  assert.equal(c.stats.reconnects, 1);
  assert.equal(c.stats.snapshots, 1, 'resumed from the ring, no second snapshot');
  await sleep(5500);
  assert.equal(c.stats.lastCheck, 'ok');
  assert.equal(c.stats.resyncs, 0);
  c.close();
});

test('a corrupted replica detects the mismatch and resyncs', async () => {
  const c = client(); await sleep(6000);
  const id = Object.keys(c.replica.entities).find((k) => c.replica.entities[k].kind === 'human')!;
  // Ordinary activity/path deltas can repair a corrupted field before a
  // heartbeat checks it. An extra body persists until the full resync snapshot.
  const phantom = 'corrupted-replica-body';
  c.replica.entities[phantom] = { ...structuredClone(c.replica.entities[id]), id: phantom };
  await sleep(11000);
  assert.ok(c.stats.resyncs >= 1, 'asked for a resync');
  assert.ok(c.stats.snapshots >= 2);
  assert.equal(c.stats.lastCheck, 'ok');
  assert.equal(c.replica.entities[phantom], undefined, 'snapshot removed the corrupted body');
  c.close();
});

test('invite gate: a new user cannot create a Soul until they redeem a code', async () => {
  const blocked = await api('/v1/souls', 'dev:alice', { name: 'Testa', description: 'a test soul who likes benches' });
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'invite-required');
  assert.equal((await api('/v1/me', 'dev:alice')).body.me.invited, false);
  assert.equal((await api('/v1/admin', 'dev:alice', { action: 'invite', uses: 2 })).status, 403);
  const inv = await api('/v1/admin', 'dev:admin', { action: 'invite', uses: 2, note: 'test' });
  assert.equal(inv.status, 200);
  assert.equal((await api('/v1/invite', 'dev:alice', { code: 'nope' })).status, 404);
  assert.equal((await api('/v1/invite', 'dev:alice', { code: inv.body.code })).status, 200);
  assert.equal((await api('/v1/invite', 'dev:bob', { code: inv.body.code })).status, 200);
  assert.equal((await api('/v1/invite', 'dev:carol', { code: inv.body.code })).status, 404, 'code is used up');
  assert.equal((await api('/v1/me', 'dev:alice')).body.me.invited, true);
});

test('create a Soul, steer it from the page, pair an agent both ways, steer by REST and MCP', async () => {
  const user = 'dev:alice';
  const made = await api('/v1/souls', user, { name: 'Testa', description: 'a test soul who likes benches' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = made.body.soul.id;
  assert.equal((await api('/v1/souls', 'dev:bob', { name: 'testa', description: 'imposter' })).status, 409);
  assert.equal((await api(`/v1/souls/${id}`, 'dev:bob')).status, 403);
  assert.deepEqual((await api('/v1/me', user)).body.me.souls, [id]);
  await sleep(500);
  // structured intent from the page, with a private note
  const set = await api(`/v1/souls/${id}/intent`, user, { intent: { goal: 'go', target: 'the kiosk', note: 'secret plan' } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.intent.target, 'kiosk');

  // --- pairing, owner-initiated: a short code in a one-line prompt
  const pair = await api(`/v1/souls/${id}/pair`, user, {});
  assert.match(pair.body.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.ok(pair.body.prompt.includes('/skill.md') && pair.body.prompt.includes(pair.body.code));
  const skill = await (await fetch(`${BASE}/skill.md`)).text();
  assert.ok(skill.startsWith('---\nname: sim') && skill.includes('/v1/agent/pair'));
  const post = (path: string, b: unknown) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() as any }));
  const ex = await post('/v1/agent/pair', { code: pair.body.code.toLowerCase().replace('-', ''), agent: 'test agent' });
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  const token = ex.body.token as string;
  assert.equal(ex.body.soul.name, 'Testa');
  assert.equal((await post('/v1/agent/pair', { code: pair.body.code })).status, 404, 'a code works once');

  // --- the agent API
  assert.equal((await api('/v1/agent/me', token)).body.paired_as, 'test agent');
  const seen = await api('/v1/agent/perceive', token);
  assert.equal(seen.status, 200);
  assert.ok(seen.body.nearby.length > 0 && seen.body.could_do_now.length > 0 && seen.body.soul.intent.note === 'secret plan');
  const waitP = api('/v1/agent/wait?seconds=20', token);
  const steer = await api('/v1/agent/intent', token, { intent: { goal: 'rest' } });
  assert.equal(steer.status, 200); assert.ok(steer.body.accepted_at_tick > 0);
  const waited = await waitP;
  assert.notEqual(waited.body.reason, 'timeout');
  assert.equal((await api('/v1/agent/intent', token, { intent: { goal: 'fly' } })).status, 400);
  assert.equal((await api('/v1/agent/intent', token, { intent: { goal: 'go', target: 'atlantis' } })).status, 400);

  // --- MCP with the same token: header form and URL form
  const mcp = async (method: string, params: unknown, url = `${BASE}/mcp`, auth = true) => (await fetch(url, { method: 'POST', headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json() as Promise<any>;
  assert.equal((await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } })).result.serverInfo.name, 'sim');
  assert.deepEqual((await mcp('tools/list', {})).result.tools.map((t: any) => t.name).sort(), ['soul_command', 'soul_deck', 'soul_log', 'soul_mandate', 'soul_perceive', 'soul_propose_cards', 'soul_remove_rule', 'soul_set_intent', 'soul_status', 'soul_steer', 'soul_wait', 'world_query']);
  const call = await mcp('tools/call', { name: 'soul_set_intent', arguments: { goal: 'attend', target: 'campfire' } }, `${BASE}/mcp/${token}`, false);
  assert.equal(JSON.parse(call.result.content[0].text).ok, true);
  assert.equal((await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);

  // --- the owner's dashboard
  const dash = await api(`/v1/souls/${id}`, user);
  assert.equal(dash.body.agent.attached, true); assert.equal(dash.body.agent.label, 'test agent'); assert.ok(dash.body.agent.last_used > 0);
  await sleep(2500);
  const tl = await api(`/v1/souls/${id}/timeline`, user);
  assert.ok(tl.body.events.some((e: any) => e.kind === 'birth'));
  assert.ok(tl.body.events.some((e: any) => e.kind === 'intent' && e.text.includes('secret plan')), 'the owner sees their own note');
  assert.ok(tl.body.events.some((e: any) => e.kind === 'intent' && e.text.includes('your agent')));
  assert.ok(tl.body.events.some((e: any) => e.kind === 'decision' && e.why));

  // --- privacy: nobody else sees the note or the model calls about this Soul
  const log = await (await fetch(`${BASE}/v1/log?limit=1000`)).json() as any;
  assert.ok(log.events.some((e: any) => e.kind === 'intent' && e.payload.soulId === id && e.payload.source === 'mcp'));
  assert.ok(!JSON.stringify(log).includes('secret plan'), 'notes are not in the public log');
  assert.ok(!JSON.stringify(await (await fetch(`${BASE}/v1/world`)).json()).includes('secret plan'));
  const mine = await api('/v1/brain?limit=200', user), bobs = await api('/v1/brain?limit=200', 'dev:bob'), all = await api('/v1/brain?limit=200', 'dev:admin');
  assert.ok(mine.body.calls.length > 0 && mine.body.calls.every((c: any) => c.soulId === id));
  assert.equal(bobs.body.calls.length, 0);
  assert.ok(all.body.calls.length > mine.body.calls.length);
  assert.equal((await api('/v1/spend', user)).status, 403);
  const spy = client('dev:bob'); const got: any[] = []; spy.handlers.onBrain = (c) => got.push(...c);
  await sleep(4000);
  assert.equal(got.length, 0, 'another user receives no model calls over the socket');
  spy.close();

  // --- pairing, agent-initiated: the agent asks, the owner approves, the agent polls
  const start = await post('/v1/agent/pair/start', { agent: 'second agent' });
  assert.ok(start.body.approve_url.includes('#pair/'));
  assert.equal((await (await fetch(`${BASE}/v1/agent/pair/poll?poll_token=${start.body.poll_token}`)).json() as any).status, 'pending');
  assert.equal((await api(`/v1/pair/${start.body.user_code}`, user)).body.agent, 'second agent');
  assert.equal((await api('/v1/pair/approve', 'dev:bob', { code: start.body.user_code, soulId: id })).status, 403, 'only the owner can approve for a Soul');
  assert.equal((await api('/v1/pair/approve', user, { code: start.body.user_code, soulId: id })).status, 200);
  const polled = await (await fetch(`${BASE}/v1/agent/pair/poll?poll_token=${start.body.poll_token}`)).json() as any;
  assert.equal(polled.status, 'approved');
  assert.equal((await api('/v1/agent/status', token)).status, 401, 'the old token was replaced');
  assert.equal((await api('/v1/agent/status', polled.token)).body.name, 'Testa');

  // --- revoke and retire
  await api(`/v1/souls/${id}/revoke`, user, {});
  assert.equal((await api('/v1/agent/status', polled.token)).status, 401);
  assert.equal((await api(`/v1/souls/${id}`, user, undefined, 'DELETE')).status, 200);
  await sleep(1000);
  assert.ok(!((await (await fetch(`${BASE}/v1/world`)).json()) as any).souls.some((s: any) => s.name === 'Testa'));
});

test('the DJ story through the real server: an agent proposes cards, two owners set agendas, the party happens', async () => {
  const admin = 'dev:admin'; // admins need no invite
  const rob = (await api('/v1/souls', admin, { name: 'Rob', description: 'a generous host who loves a crowd' })).body.soul;
  const wren = (await api('/v1/souls', admin, { name: 'Wren', description: 'a kite maker who secretly wants to DJ' })).body.soul;
  assert.ok(rob?.id && wren?.id);
  await sleep(600);

  // the grammar is published for agents
  const grammar = await (await fetch(`${BASE}/cards.md`)).text();
  assert.ok(grammar.includes('a Soul acts only for itself') && grammar.includes('`walk_to`'));

  // Wren's deck starts with the base cards and three manners
  const deck0 = (await api(`/v1/souls/${wren.id}/deck`, admin)).body;
  assert.ok(deck0.cards.some((c: any) => c.name === 'talk with') && deck0.manners.length >= 1);

  // an invalid card is refused with reasons, and nothing is minted
  const bad = await api(`/v1/souls/${wren.id}/cards`, admin, { cards: [{ name: 'seize the party', summary: 'Take over', target: { kind: 'gathering' }, when: [], then: [{ link: ['hosts', '$target', '$actor'] }], approach: [], during: [{ verb: 'teleport', params: {} }], takes: 'seconds' }] });
  assert.equal(bad.body.ok, false);
  assert.ok(bad.body.cards[0].problems.some((p: string) => p.includes('must start from the actor')));

  // run the world at five times speed so the test does not take minutes
  assert.equal((await api('/v1/admin', admin, { action: 'clock_rate', rate: 5 })).status, 200);
  const mine = async () => (await (await fetch(`${BASE}/v1/plays?limit=200`)).json() as any).plays.filter((p: any) => [rob.id, wren.id].includes(p.soulId));
  // each owner gives direction as an agenda of cards; nobody scripts the other Soul
  assert.equal((await api(`/v1/souls/${rob.id}/intent`, admin, { intent: { agenda: [{ card: 'host a gathering', target: 'the campfire' }, { card: 'say yes', target: null }], text: 'throw a party at the campfire and let people help' } })).status, 200);
  // Rob's gathering exists before Wren holds the DJ cards or a plan. Otherwise, while her plan has no Rob's gathering to
  // aim at, a near-tie choice can spend the new card at whichever native gathering she happens to be standing in.
  for (let i = 0; i < 200 && !(await mine()).some((p: any) => p.ok && p.soulId === rob.id && p.card === 'host a gathering'); i++) await sleep(300);

  // Wren's agent proposes the two cards the DJ story needs
  const cards = [
    { name: 'ask to be the dj', summary: 'Ask the host of a gathering to let you play the music', good_when: 'the intent is to DJ', not_for: 'there is already a DJ',
      target: { kind: 'gathering' }, derive: { host: { link: 'hosts', to: '$target' } },
      when: [{ at: ['$actor', '$target'] }, { noneLinkedTo: ['dj of', '$target'] }, { distinct: ['$actor', '$host'] }, { notLinked: ['asked', '$actor', '$host'] }, { notLinked: ['agreed', '$host', '$actor'] }],
      then: [{ say: ['$actor', '$host', 'ask'], about: 'being the DJ at $target.name' }],
      approach: [{ verb: 'walk_to', params: { to: '$host', standoff: 1.3 } }], during: [{ verb: 'wave', params: { at: '$host', seconds: 2 } }], takes: 'seconds' },
    { name: 'be the dj', summary: 'Set up and play music at a gathering, once the host has agreed', good_when: 'the host said yes', not_for: 'no agreement yet',
      target: { kind: 'gathering' }, derive: { host: { link: 'hosts', to: '$target' } },
      when: [{ at: ['$actor', '$target'] }, { linked: ['agreed', '$host', '$actor'] }, { noneLinkedTo: ['dj of', '$target'] }],
      then: [{ link: ['dj of', '$actor', '$target'] }, { appear: { kind: 'dj kit', name: 'a DJ kit', at: '$target.at', with: '$target', states: { state: 'playing' } }, linkFromActor: 'made' }, { set: ['$target', 'music', 'playing'] }, { set: ['$actor', 'doing', 'playing music'] }],
      approach: [], during: [{ verb: 'perform', params: { seconds: 60 } }], wants: ['set up equipment', 'dj at a deck'], takes: 'minutes' },
  ];
  const proposed = await api(`/v1/souls/${wren.id}/cards`, admin, { cards, links: { 'dj of': { summary: 'plays the music at', control: true } }, kinds: { 'dj kit': { summary: 'turntables and speakers' } } });
  assert.equal(proposed.body.ok, true, JSON.stringify(proposed.body));
  await sleep(300);

  // Wren's owner gives her direction the same way (the tick just before it bounds which of her plays the owner directed)
  const intentTick = ((await (await fetch(`${BASE}/v1/kernel`)).json()) as any).tick as number;
  assert.ok(Number.isInteger(intentTick));
  const wrenIntent = await api(`/v1/souls/${wren.id}/intent`, admin, { intent: { agenda: [{ card: 'go to', target: 'the gate' }, { card: 'ask to be the dj', of: 'Rob' }, { card: 'be the dj', of: 'Rob' }], text: "go to Rob's party and ask him if you can DJ" } });
  // (That agenda is deliberately clumsy, as a model wrote it once: its first step is already true, and it never says to join.
  //  The plan must still work: a step that cannot be played does not block the rest, and getting there is found by looking ahead.)
  assert.equal(wrenIntent.status, 200, JSON.stringify(wrenIntent.body));
  assert.equal((await api(`/v1/souls/${wren.id}/intent`, admin, { intent: { agenda: [{ card: 'no such card', target: null }] } })).status, 400);

  // the world runs: wait until the record shows Wren became the DJ
  let plays: any[] = [];
  for (let i = 0; i < 400; i++) { await sleep(300); plays = await mine(); if (plays.some((p) => p.ok && p.card === 'be the dj')) break; }
  await api('/v1/admin', admin, { action: 'clock_rate', rate: 1 });
  const trace = plays.map((p: any) => `${p.tick} ${p.soul}:${p.card}→${p.targetName}${p.ok ? '' : ' REFUSED ' + p.reason}`).join('\n');
  // the chain happened, in order, as independent plays by two Souls
  const done = plays.filter((p) => p.ok).map((p) => `${p.soul}:${p.card}`);
  const order = ['Rob:host a gathering', 'Wren:ask to be the dj', 'Rob:say yes', 'Wren:be the dj'];
  let at = -1; for (const step of order) { const i = done.indexOf(step, at + 1); assert.ok(i > at, `${step} happened in order\n${trace}`); at = i; }
  // what "be the dj" changed: a role, a new thing, the music
  const dj = plays.find((p) => p.ok && p.card === 'be the dj');
  assert.equal(dj.targetName, 'Rob’s gathering');
  assert.ok(dj.changes.some((c: any) => c.op === 'link' && c.kind === 'dj of' && c.from === wren.id));
  assert.ok(dj.changes.some((c: any) => c.op === 'appear' && c.kind === 'dj kit'));
  assert.ok(dj.changes.some((c: any) => c.op === 'set' && c.key === 'music' && c.value === 'playing'));
  // The owner-directed ask is Wren's first ask after her owner's intent, and every ask after it goes to Rob's gathering.
  // An ask BEFORE the intent is not part of the chain: Wren holds the new card with no plan for that moment, and the real
  // server's seeded natives (main.ts NATIVES) host their own gatherings, so she may spend it at one (R392 gate: "Basil’s
  // gathering" as her first ask; reproduced with a widened plan-less window: Tamsin’s gathering at tick 2213 < intent 2699,
  // then Rob’s at 4885). The old "first ask" selection picked that ambient ask.
  const asks = plays.filter((p) => p.ok && p.soul === 'Wren' && p.card === 'ask to be the dj'), directed = asks.filter((p) => p.tick >= intentTick);
  const askTrace = `intent at tick ${intentTick}; asks: ${asks.map((p) => `${p.tick} ${p.targetName}`).join(', ')}\n${trace}`;
  assert.ok(directed.length > 0, `Wren asked after her owner's intent\n${askTrace}`);
  assert.deepEqual(directed.filter((p) => p.targetName !== 'Rob’s gathering').map((p) => `${p.tick} ${p.targetName}`), [], `no owner-directed ask to another host\n${askTrace}`);
  const asked = directed[0];
  assert.deepEqual(asked.changes[0], { op: 'say', from: wren.id, to: rob.id, act: 'ask', about: 'being the DJ at Rob’s gathering', manner: asked.manner }, askTrace);
  const k = await (await fetch(`${BASE}/v1/kernel`)).json() as any;
  assert.equal(k.vocab.cards['be the dj'].origin, 'agent'); assert.equal(k.plays['be the dj'], 1);
  // words were rendered for what was said
  const talk = (await (await fetch(`${BASE}/v1/talk?limit=200`)).json() as any).lines;
  assert.ok(talk.some((l: any) => l.fromName === 'Wren' && l.toName === 'Rob' && l.act === 'ask'));
  assert.ok(talk.some((l: any) => l.fromName === 'Rob' && l.toName === 'Wren' && l.act === 'agree'));
  // Wren's agenda is complete and her dashboard story shows it
  const deck = (await api(`/v1/souls/${wren.id}/deck`, admin)).body;
  assert.equal(deck.agendaPos, 3);
  const tl = (await api(`/v1/souls/${wren.id}/timeline?limit=200`, admin)).body.events;
  assert.ok(tl.some((e: any) => e.kind === 'play' && e.text.startsWith('be the dj')));
  // and a client that joined late agrees with the server about all of it
  const c = client(); await sleep(6500);
  assert.equal(c.stats.lastCheck, 'ok'); c.close();
});
