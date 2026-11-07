import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSeat, listenMessages, wakeText, onboardingText } from './seat.mjs';
import { assertKind, worldEnv } from './provision.mjs';

test('listen output: Soul CLI messages and god CLI latest', () => {
  const soul = JSON.stringify({ messages: [{ id: 'm_1', text: 'a' }, { id: 'm_2', text: 'b' }], next: 'ack each …' }, null, 1);
  assert.deepEqual(listenMessages(soul).map((m) => m.id), ['m_1', 'm_2']);
  assert.deepEqual(listenMessages(JSON.stringify({ messages: [], next: 'nothing waiting' })), []);
  assert.deepEqual(listenMessages(JSON.stringify({ inbox: { latest: { id: 'g_1', state: 'delivered' } } })).map((m) => m.id), ['g_1']);
  assert.deepEqual(listenMessages(JSON.stringify({ inbox: { latest: { id: 'g_1', state: 'acknowledged' } } })), []);
  assert.deepEqual(listenMessages('listen: 503, retrying'), []);
});

test('wake text is what Claude Code shows for a finished background task; onboarding text is §6', () => {
  assert.equal(wakeText('node eden.mjs listen', '{"messages":[]}\n'), '[background task] node eden.mjs listen exited with output:\n{"messages":[]}\n');
  assert.equal(onboardingText('http://h/w/x', 'Pip'), 'Make me a Soul in this world: http://h/w/x/ . Call it Pip. Start from http://h/w/x/instructions.md.');
});

// #1138: a stand-in CLI: logs each call, keeps `serve` state in a file; a stopping serve answers once more.
const FAKE_CLI = `import { appendFileSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
const a = process.argv.slice(2), up = () => existsSync('up'); appendFileSync('calls', a.join(' ') + '\\n');
if (existsSync('fail') && readFileSync('fail', 'utf8') === a.join(' ')) { console.error('no'); process.exit(3); }
if (a[0] === 'serve' && a[1] === '--status') { const left = up() ? Number(readFileSync('up', 'utf8')) : 0; if (left > 0) { writeFileSync('up', String(left - 1)); if (left === 1) rmSync('up'); } console.log(JSON.stringify({ serving: left > 0 })); }
else if (a[0] === 'serve' && a[1] === '--stop') { if (up()) writeFileSync('up', '1'); console.log('{}'); }
else if (a[0] === 'serve') { writeFileSync('up', '99'); console.log(JSON.stringify({ serving: true })); }
else if (a[0] === 'import') { rmSync('.eden-agent.json'); console.log('{}'); }
else console.log('{}');
`;
function restartable(seat = {}) {
  const s = createSeat({ runDir: mkdtempSync(join(tmpdir(), 'pt-seat-')), seat: { id: 'pip', adapter: 'claude-headless', ...seat }, worldBase: 'http://h/w/x' });
  writeFileSync(join(s.folder, s.cli.file), FAKE_CLI); s.info.sessionId = 'old';
  return { s, calls: () => readFileSync(join(s.folder, 'calls'), 'utf8').trim().split('\n') };
}

test('restart: reads what the last chat left, waits out a stopping serve, starts anew, moves a `home` seat in, opens a new chat', async () => {
  const { s, calls } = restartable({ home: true });
  await s.restart();
  assert.deepEqual(calls(), ['serve --status', 'serve --stop', 'serve --status', 'import', 'serve']);
  assert.equal(s.info.sessionId, null);
  writeFileSync(join(s.folder, 'calls'), '');
  await s.restart();
  assert.deepEqual(calls(), ['serve --status', 'pending', 'serve --stop', 'serve --status', 'serve --status', 'serve']);
});

test('restart: a step that fails says which, and the seat keeps its chat; a turn in flight ends first', async () => {
  const { s } = restartable();
  writeFileSync(join(s.folder, 'fail'), 'serve');
  await assert.rejects(s.restart(), /seat pip: serve exited 3: no/); assert.equal(s.info.sessionId, 'old');
  writeFileSync(join(s.folder, 'fail'), '');
  let done = false; s.chain = new Promise((r) => setTimeout(() => { done = true; r(); }, 50));
  await s.restart(); assert.equal(done, true); assert.equal(s.info.sessionId, null);
});

test('createSeat: empty folder plus only the identity seed; refuses a non-empty folder', () => {
  const run = mkdtempSync(join(tmpdir(), 'pt-seat-'));
  const s = createSeat({ runDir: run, seat: { id: 'pip', adapter: 'claude-headless', model: 'haiku', soulName: 'Pip' }, worldBase: 'http://h/w/x' });
  assert.deepEqual(readdirSync(s.folder), ['.eden-agent.json']);
  const seed = JSON.parse(readFileSync(join(s.folder, '.eden-agent.json'), 'utf8'));
  assert.match(seed.identity, /^agent-[0-9a-f]{24}$/); assert.deepEqual(Object.keys(seed), ['identity']);
  const info = JSON.parse(readFileSync(join(run, 'seats/pip/seat.json'), 'utf8'));
  assert.equal(info.ownerIdentity, seed.identity); assert.equal(info.wake, true); assert.equal(info.assisted, false);
  const run2 = mkdtempSync(join(tmpdir(), 'pt-seat-'));
  mkdirSync(join(run2, 'seats/x/folder'), { recursive: true }); writeFileSync(join(run2, 'seats/x/folder/junk'), '');
  assert.throws(() => createSeat({ runDir: run2, seat: { id: 'x' }, worldBase: 'http://h' }), /not empty/);
  const c = createSeat({ runDir: run, seat: { id: 'cx', adapter: 'codex-headless' }, worldBase: 'http://h' });
  assert.equal(c.info.wake, false, 'codex seats do not wake unless seat.wake === true');
});

test('provision: only dev worlds; §0 env names the SOUL3 clients and the 2.0 guides', () => {
  assert.doesNotThrow(() => assertKind('dev'));
  for (const k of ['fork', 'template-eden2', 'live']) assert.throws(() => assertKind(k), /reserved/);
  const e = worldEnv('/srv');
  assert.equal(e.INVITE_REQUIRED, '0'); assert.equal(e.EDGE_CONTROLLER_CLI_FILE, '/srv/tools/world-launcher/soul/eden.mjs');
  assert.equal(e.EDGE_INSTRUCTIONS_FILE, '/srv/tools/world-launcher/soul/instructions.md'); assert.equal(e.WEB_DIR, '/srv/apps/web/dist');
});

test('renderedChatSince splits chat-as-rendered.md at turn markers; turnCount reads turns.jsonl', async () => {
  const { splitRendered } = await import('./seat.mjs');
  const md = '\n<!-- turn 1 (onboard) t -->\n\n> a\n\n⏺ ok\n\n<!-- turn 2 (wake) t -->\n\n> b\n\n<!-- turn 3 (chat) t -->\n\n> c\n';
  assert.deepEqual(splitRendered(md).map((b) => b.turn), [1, 2, 3]);
  const run = mkdtempSync(join(tmpdir(), 'pt-seat-'));
  const s = createSeat({ runDir: run, seat: { id: 'p' }, worldBase: 'http://h' });
  writeFileSync(join(s.dir, 'chat-as-rendered.md'), md);
  writeFileSync(join(s.dir, 'turns.jsonl'), '{"turn":1}\n{"turn":2}\n{"turn":3}\n');
  assert.equal(s.turnCount(), 3);
  const since1 = s.renderedChatSince(1);
  assert.ok(!since1.includes('> a') && since1.includes('> b') && since1.includes('> c'));
  assert.equal(s.renderedChatSince(3), '');
  assert.ok(s.renderedChatSince(0).includes('> a'));
});

test('chat onStart fires when the queued turn actually starts (after the running turn), with its turn number', async () => {
  const run = mkdtempSync(join(tmpdir(), 'pt-seat-'));
  const s = createSeat({ runDir: run, seat: { id: 'q', adapter: 'claude-headless' }, worldBase: 'http://h' });
  const log = [];
  s.adapter = { turn: async ({ text }) => { log.push(`run ${text}`); await new Promise((r) => setTimeout(r, 40)); log.push(`end ${text}`); return { stream: [], usage: { costUsd: 0.01 * log.length }, finalText: 'ok', toolCalls: [], exit: 0, wallMs: 40 }; }, renderChat: () => '' };
  const a = s.chat('wake', { reason: 'wake' });
  const b = s.chat('sit down', { onStart: (i) => log.push(`start ${i.turn} ${i.reason}`) });
  await Promise.all([a, b]);
  assert.deepEqual(log, ['run wake', 'end wake', 'start 2 chat', 'run sit down', 'end sit down']);
});
