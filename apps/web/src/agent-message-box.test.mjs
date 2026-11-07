import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {build} = createRequire(require.resolve('vite/package.json'))('esbuild');
const dir = await mkdtemp(join(tmpdir(), 'souls-inbox-render-'));
Object.assign(globalThis, {location: {origin: 'http://localhost:5960', pathname: '/w/inbox/', search: '', hash: ''}, sessionStorage: {getItem: () => null}});
const outfile = join(dir, 'render.cjs');
await build({stdin: {contents: `export {AgentMessageBoxView, soulStartPrompt} from './AgentMessageBox.tsx';export {watchStatus} from './god-ui/god-api.ts';export {watchInbox, godState} from './god-ui/god-store.ts';export {publishSession} from './auth-session.ts';export {SoulFocus} from './SoulFocus.tsx';export {reportAgentPresence} from './agent-presence.ts';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx'}, outfile, bundle: true, format: 'cjs', platform: 'node', jsx: 'automatic', loader: {'.css': 'empty'}, logLevel: 'silent'});
const {AgentMessageBoxView, soulStartPrompt, watchStatus, watchInbox, godState, publishSession, SoulFocus, reportAgentPresence, createElement: h, renderToStaticMarkup: render} = require(outfile);
const props = {kind: 'god', prompt: 'Resume the existing agent and listen.', text: '', onText() {}, onSend() {}, onCopy() {}};
test('absent and unknown agent presence make no delivery claim; start prompt is copyable', () => {
  const absent = render(h(AgentMessageBoxView, {...props, inbox: {connected: false, lastSeenAt: null, latest: null}}));
  assert.match(absent, /Your agent is away — messages will wait/); assert.match(absent, /Copy start prompt/);
  assert.match(absent, /title="Resume the existing agent and listen\."/);
  assert.doesNotMatch(absent, /Picked up|Acknowledged|listening/);
  const unknown = render(h(AgentMessageBoxView, {...props, inbox: null}));
  assert.match(unknown, /Agent status unavailable/); assert.doesNotMatch(unknown, /listening|Picked up/);
});
for (const kind of ['god', 'soul']) for (const state of ['sent', 'delivered', 'acknowledged']) test(`${kind} overlay shows only latest ${state} receipt as plain text`, () => {
  const inbox = {connected: state !== 'sent', lastSeenAt: state === 'sent' ? null : Date.now(), latest: {id: 'one', text: '<script>owner words</script>', state, ...(state === 'acknowledged' ? {reply: '<b>On my way</b>'} : {})}};
  const html = render(h(AgentMessageBoxView, {...props, kind, inbox}));
  assert.match(html, new RegExp(`data-agent-message="${kind}"`));
  assert.match(html, new RegExp(`data-message-state="${state}"`));
  assert.match(html, /&lt;script&gt;owner words&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>|<b>On my way/);
  assert.equal((html.match(/data-message-state=/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<ol|<ul|textarea/);
  assert.match(html, state === 'sent' ? />Sent</ : state === 'delivered' ? /Picked up/ : /Acknowledged/);
  if (state === 'acknowledged') assert.match(html, /&lt;b&gt;On my way&lt;\/b&gt;/);
});
test('MSG: presence says listening now / seen recently / away; an unread message says how long; queued count; reply then result', () => {
  const now = 1_000_000, base = {connected: true, lastSeenAt: now - 12_000};
  const at = (inbox, kind = 'soul') => render(h(AgentMessageBoxView, {...props, kind, now, inbox}));
  // LINK (2026-10-24): a Soul's box is only the form and the receipt; the card's status line says Connected/Disconnected
  // and the box is shown only while Connected, so it carries no presence line and no start prompt of its own.
  const listening = at({...base, presence: 'listening', queued: 0, latest: null});
  assert.doesNotMatch(listening, /agent-message-presence|is listening|Copy start prompt/); assert.match(listening, /Message your agent/);
  assert.match(at({...base, presence: 'listening', latest: null}, 'god'), /Your agent is listening now/, 'god copy unchanged');
  assert.match(at({...base, presence: 'recent', latest: null}, 'god'), /Your agent was seen recently \(12 s ago\)/);
  assert.match(at({...base, presence: 'working', latest: null}, 'god'), /seen recently/);
  const godAway = at({connected: false, lastSeenAt: now - 3_600_000, presence: 'away', latest: null}, 'god'); assert.match(godAway, /away — messages will wait/); assert.match(godAway, /Message your agent/); assert.match(godAway, /Copy start prompt/);
  const fresh = at({...base, presence: 'listening', queued: 1, latest: {id: 'm', text: 'run!', state: 'sent', sentAt: now - 4_000}});
  assert.match(fresh, />Sent</); assert.doesNotMatch(fresh, /Not picked up/);
  const stuck = at({...base, presence: 'listening', queued: 3, latest: {id: 'm', text: 'the house!!!!', state: 'sent', sentAt: now - 14_000}});
  assert.match(stuck, /Not picked up yet \(14 s\) · 3 waiting</, 'the Soul receipt carries the waiting count now');
  assert.match(at({...base, presence: 'away', connected: false, queued: 3, latest: {id: 'm', text: 'x', state: 'sent', sentAt: now - 14_000}}, 'god'), /Not picked up yet \(14 s\) · 3 waiting/, 'god receipt unchanged');
  assert.match(at({...base, queued: 2, latest: {id: 'm', text: 'x', state: 'delivered', sentAt: now - 60_000}}, 'god'), /Picked up · 2 waiting/);
  const done = at({...base, queued: 0, latest: {id: 'm', text: 'go to the cottage', state: 'acknowledged', reply: 'Got it: walking there.', result: 'Arrived.', outcome: 'done', sentAt: now - 90_000}});
  assert.match(done, />Done</); assert.ok(done.indexOf('Got it: walking there.') < done.indexOf('Arrived.'), 'the ack reply, then the result');
  assert.match(at({...base, latest: {id: 'm', text: 'ride', state: 'acknowledged', reply: 'Trying.', result: "Couldn't: no saddle.", outcome: 'failed'}}), /Could not do it/);
  // D3c (rook-003): an act that served an earlier step leaves the message open: Under way with the world's progress line,
  // never Done; the result replaces the progress line
  const going = at({...base, queued: 0, latest: {id: 'm', text: 'rest, then come back', state: 'acknowledged', reply: 'Got it.', progress: 'now: wave completed at g-commons; not resting yet', sentAt: now - 30_000}});
  assert.match(going, />Under way</); assert.doesNotMatch(going, />Done</); assert.match(going, /not resting yet/);
  const closed = at({...base, queued: 0, latest: {id: 'm', text: 'rest, then come back', state: 'acknowledged', reply: 'Got it.', progress: 'now: sat; not there yet', result: 'Arrived at the balloon.', outcome: 'done'}});
  assert.match(closed, />Done</); assert.match(closed, /Arrived at the balloon/); assert.doesNotMatch(closed, /not there yet/);
  assert.match(at({connected: true, lastSeenAt: now}, 'god'), /seen recently/, 'an older server without presence: connected means seen recently');
});
test('Soul card inbox belongs only to its authenticated owner, including account switch', () => {
  const soul = {id: 's_A', entityId: 'h_A', name: 'Ana', description: '', doing: '', energy: 'fine'};
  const sim = {me: {userId: 'acct_A', souls: ['s_A'], role: 'user', invited: true}, privateAuthorityGeneration: 1, conn: {welcome: {worldId: 'inbox-1', epoch: 1}, replica: {souls: new Map([['s_A', soul]]), entities: {}, tick: 0}}, plays: [], talk: [], edge: []};
  const card = (identity) => render(h(SoulFocus, {sim, auth: {authed: !!identity, ready: true, label: identity, debug: {accountIdentity: identity, privyUserId: null}, login() {}, logout() {}}, api: async () => {throw Error('Rendering must not request');}, selected: 's_A', select() {}, manage() {}}));
  // LINK, an older server (no `link` field): away since the last listen = Disconnected with the Reconnect box; nobody else sees it
  const left = new Date(); left.setHours(21, 40, 0, 0);
  reportAgentPresence('s_A', {connected: false, lastSeenAt: Date.now(), listenedAt: Math.min(left.getTime(), Date.now()), presence: 'away', queued: 2});
  for (const identity of ['acct_A', 'acct_B', null]) {
    const html = card(identity);
    assert.equal(/data-status="disconnected"[^>]*>.*Disconnected</.test(html), identity === 'acct_A', `card state for ${identity}`);
    assert.equal(html.includes('data-reconnect="1"'), identity === 'acct_A', `Reconnect box for ${identity}`);
    assert.doesNotMatch(html, /data-agent-message="soul"/, 'no message box while disconnected (D3)');
    if (identity !== 'acct_A') assert.doesNotMatch(html, /waiting|Reconnect|agent-message|Disconnected/, 'a visitor sees no owner state');
  }
  if (left.getTime() <= Date.now()) assert.match(card('acct_A'), /since 21:40/);
  reportAgentPresence('s_A', {connected: true, lastSeenAt: Date.now(), listenedAt: Date.now(), presence: 'listening', queued: 0});
  const live = card('acct_A');
  assert.match(live, /data-status="connected"/); assert.match(live, /data-agent-message="soul"/); assert.doesNotMatch(live, /Reconnect|Copy start prompt/);
  // the server's `link` wins over presence
  reportAgentPresence('s_A', {connected: true, lastSeenAt: Date.now(), listenedAt: Date.now(), presence: 'listening', queued: 0, link: {state: 'disconnected', reason: 'revoked', since: Date.now(), holder: null}});
  const revoked = card('acct_A');
  assert.match(revoked, /You disconnected the agent at \d\d:\d\d\./); assert.doesNotMatch(revoked, /data-agent-message/);
  reportAgentPresence('s_A', null);
});
// G4: the God box is the God modal's agent section now (the God button watches the owner's inbox while the world's status
// says owner). Signing out resets the status even when the provider keeps the same label, so the owner view and the
// command log go away with it.
test('God box disappears on sign-out even if the provider retains the same label', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ok: true, status: 200, json: async () => String(url).includes('/v1/god/inbox')
    ? {inbox: {connected: true, lastSeenAt: 1, latest: null, queued: 1, log: [{id: 'm1', text: 'Build a barn', state: 'sent', sentAt: 1}]}}
    : {you: 'owner', pending: [], agents: 1}});
  const until = async (ok) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(ok()); };
  const session = {mode: 'dev', ready: true, authed: true, label: 'same-label', getToken: async () => 'dev:same-label', login() {}, logout() {}};
  publishSession(session);
  const seen = []; const stopStatus = watchStatus((s) => seen.push(s?.you ?? null));
  try {
    await until(() => seen.at(-1) === 'owner');
    const stopInbox = watchInbox();   // what GodButton does while the status says owner
    await until(() => godState().inbox?.log?.length === 1);
    publishSession({...session, authed: false});
    assert.equal(seen.at(-1), null);   // the owner status is gone at once, same label or not
    stopInbox();                      // GodButton stops watching when owner turns false
    assert.equal(godState().inbox, null);
  } finally { stopStatus(); globalThis.fetch = realFetch; }
});
test.after(() => rm(dir, {recursive: true, force: true}));

// Lane PAIR-INWINDOW (Gene's review 2026-10-22 #1): the card's start prompt carries the window code like the New Soul prompt
// Test ID kept from main (the gate compares assertion IDs); the command is now `pair` (eden.mjs 2.x), was `pair-soul`.
test('Soul card start prompt names pair-soul with the window code; without a code it still names the command', () => {
  const withCode = soulStartPrompt('http://localhost:5960/w/inbox', 's_abc', 'Ada', 'K7QX-M2PA');
  assert.match(withCode, /node eden\.mjs pair "s_abc" --for K7QX-M2PA/);
  assert.match(withCode, /Soul "Ada" \(ID "s_abc"\)/);
  assert.match(withCode, /open Sim window/);
  assert.match(withCode, /start listening/);
  assert.doesNotMatch(withCode, /eden-agent|pair-soul|approval wait|auto mode/);
  assert.match(withCode, /Do not create another Soul/);
  assert.match(withCode, /in this folder\. Do not create another Soul\.\n/, 'PROMPT-SHORT: line 1 = read the skill, resume this Soul here, no new Soul');
  assert.equal(withCode.split('\n').length, 2); assert.doesNotMatch(withCode, /Always listen|run_in_background|ack each/);
  assert.ok(withCode.length < 400, `short prompt (${withCode.length} chars)`);
  const plain = soulStartPrompt('http://localhost:5960/w/inbox', 's_abc', 'Ada', null);
  assert.match(plain, /node eden\.mjs pair "s_abc" \(/);
  assert.doesNotMatch(plain, /--for/);
});

test('AWAY-UI: the page-wide agent presence store follows owner-inbox reports both ways; unknown makes no claim', async () => {
  const {build: b} = createRequire(require.resolve('vite/package.json'))('esbuild');
  const out = join(dir, 'presence.cjs');
  await b({stdin: {contents: `export * from './agent-presence.ts';`, resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts'}, bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent'});
  const {reportAgentPresence, agentPresence, clockAt, PRESENCE_STALE_MS} = require(out);
  assert.equal(agentPresence('s_x'), null);
  reportAgentPresence('s_x', {connected: false, lastSeenAt: 5, presence: 'away'}); assert.equal(agentPresence('s_x').away, true); assert.equal(agentPresence('s_x').since, 5);
  reportAgentPresence('s_x', {connected: true, lastSeenAt: 9, presence: 'listening'}); assert.equal(agentPresence('s_x').away, false);
  reportAgentPresence('s_x', {connected: true, lastSeenAt: 9}); assert.equal(agentPresence('s_x').away, false, 'older server: connected = here');
  reportAgentPresence('s_x', null); assert.equal(agentPresence('s_x'), null, 'status unavailable clears the claim');
  reportAgentPresence('s_x', {connected: false, lastSeenAt: 99, listenedAt: 7, presence: 'away', queued: 2}, 1000);
  assert.equal(agentPresence('s_x', 1000).since, 7, 'away since the last listen, not the last other call'); assert.equal(agentPresence('s_x', 1000).waiting, 2);
  assert.equal(agentPresence('s_x', 1000 + PRESENCE_STALE_MS + 1), null, 'a stale answer is not shown as current');
  const d = new Date(2026, 9, 23, 21, 40).getTime();
  assert.equal(clockAt(d, d + 60_000), '21:40'); assert.match(clockAt(d, d + 86_400_000), /^Oct 23, 21:40$/);
});

test('AWAY-UI phone: the Copy start prompt link never shrinks (card buttons carry min-width:44px); the away line wraps or the link stacks', async () => {
  const {readFile} = await import('node:fs/promises');
  const css = (await readFile(new URL('./AgentMessageBox.css', import.meta.url), 'utf8')).replace(/\s+/g, '');
  assert.match(css, /\.agent-message\.agent-message-presencebutton\{[^}]*flex:00auto[^}]*white-space:nowrap/);
  assert.match(css, /\.agent-message-presence\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.agent-message-presence>span\{[^}]*min-width:0/);
});
