// CTX-9 (#1142): a capped reflective pass: curated layers change, the log and pinned lines never do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAPS, consolidate, fakeMind } from './soul/consolidate.mjs';
import { openSoulMemory } from './soul/memory.mjs';

const tmp = (t) => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'souls-cons-'))); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const NOW = () => '2026-11-10T12:00:00.000Z';
const big = 'x'.repeat(3000);
function lived(t, days = 5) {
  const dir = tmp(t), m = openSoulMemory(dir, { world: 'eden', soul: 's_me' });
  m.sawHere({ tick: 1, clock: '09:00', now: '· world day 1', me: { place: 'pier', placePath: ['the pier'], posture: 'standing' }, near: [{ id: 's_ana', name: 'Ana', dist: 2 }] });
  m.remember('person', 's_ana', 'Keeps her word.'); m.remember('person', 's_ana', 'Keeps her word.'); m.remember('self', undefined, 'I am patient.');
  for (let d = 1; d <= days; d++) m.sawEvents([{ id: `c_${d}`, kind: 'receipt', tick: d * 100, at: Date.parse(`2026-11-0${d}T10:00:00.000Z`), clock: '10:00', receipt: { id: `r_${d}`, capability: 'play:x', phase: 'completed', outcome: { summary: `Played on day ${d}.`, learned: [], produced: [], met: [] } } }]);
  return { dir, m };
}
const asked = () => { const calls = []; return { calls, ask: async (p, o) => { calls.push({ p, o }); return ['Played for days.', '- with Ana']; } }; };
const logOf = (dir) => readFileSync(join(dir, 'memory/log/memory-events.jsonl'), 'utf8');

test('A1: the oldest days go to MEMORY.md, repeated notes gather, SOUL.md is only proposed, the log stays', async (t) => {
  const { dir } = lived(t), log = logOf(dir), a = asked();
  writeFileSync(join(dir, 'SOUL.md'), '# Me\n\n## Pinned\n- I never lie.\n');
  const soul = readFileSync(join(dir, 'SOUL.md'), 'utf8');
  const r = await consolidate(dir, { ask: a.ask, budget: 10, now: NOW });
  assert.deepEqual(r.consolidated, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  const memory = readFileSync(join(dir, 'MEMORY.md'), 'utf8');
  assert.match(memory, /## 2026-11-01 to 2026-11-04\n- Played for days\.\n- with Ana/);
  assert.match(memory, /## Noted more than once|consolidated/);
  assert.match(readFileSync(join(dir, 'memory/soul-proposal.diff'), 'utf8'), /\+ I am patient\./);
  assert.equal(readFileSync(join(dir, 'SOUL.md'), 'utf8'), soul, 'pinned lines and the file itself are the owner\'s');
  assert.equal(logOf(dir), log, 'the log is never touched');
  assert.ok(existsSync(join(dir, 'memory/journal/2026-11-05.md')) && !existsSync(join(dir, 'memory/journal/2026-11-04.md')), 'the newest days stay');
  assert.match(a.calls[0].p, /Played on day 1/);
});

test('A1: an owner\'s words in MEMORY.md stay, and a summarized day does not come back on reopen', async (t) => {
  const { dir } = lived(t);
  writeFileSync(join(dir, 'MEMORY.md'), '# Memory\n\nMy own note.\n');
  await consolidate(dir, { budget: 10, now: NOW });
  await consolidate(dir, { budget: 10, now: NOW, force: true });
  assert.match(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), /My own note\./);
  openSoulMemory(dir, { world: 'eden', soul: 's_me' }).search('anything');
  assert.ok(!existsSync(join(dir, 'memory/journal/2026-11-01.md')));
});

test('A2: the caps are enforced before any call, and a spent day is skipped and logged', async (t) => {
  const { dir } = lived(t), a = asked();
  assert.equal(CAPS.callsPerDay, 2);
  assert.equal((await consolidate(dir, { ask: a.ask, budget: 10, caps: { tokensPerPass: 1 }, now: NOW })).skipped, 'tokens per pass too low for one day');
  assert.equal(a.calls.length, 0);
  await consolidate(dir, { ask: a.ask, budget: 10, caps: { callsPerDay: 1 }, now: NOW });
  assert.equal(a.calls.length, 1);
  const again = await consolidate(dir, { ask: a.ask, budget: 10, caps: { callsPerDay: 1 }, now: NOW, force: true });
  assert.equal(again.skipped, 'calls per day spent'); assert.equal(a.calls.length, 1);
  assert.equal(JSON.parse(readFileSync(join(dir, 'memory/consolidation.json'), 'utf8')).lastSkip, 'calls per day spent');
  const next = await consolidate(dir, { ask: a.ask, budget: 10, caps: { callsPerDay: 1 }, now: () => '2026-11-11T12:00:00.000Z', force: true });
  assert.equal(next.skipped, undefined, 'a new day, a new allowance');
});

test('A2: a pass that dies has still spent its call', async (t) => {
  const { dir } = lived(t);
  await assert.rejects(consolidate(dir, { ask: async () => { throw new Error('no model'); }, budget: 10, now: NOW }));
  assert.equal(JSON.parse(readFileSync(join(dir, 'memory/consolidation.json'), 'utf8')).calls, 1);
  assert.ok(existsSync(join(dir, 'memory/journal/2026-11-01.md')), 'and nothing was lost');
});

test('A3: the stand-in runs the same plumbing, deterministically', async (t) => {
  assert.deepEqual(fakeMind('head\n- one\n- two\n'), ['2 moments, from "one" to "two".']);
  assert.deepEqual(fakeMind('nothing'), []);
  const a = lived(t).dir, b = lived(t).dir;
  await consolidate(a, { budget: 10, now: NOW }); await consolidate(b, { budget: 10, now: NOW });
  assert.equal(readFileSync(join(a, 'MEMORY.md'), 'utf8'), readFileSync(join(b, 'MEMORY.md'), 'utf8'));
});

test('A5: under budget, no call; no memory, no call', async (t) => {
  const { dir } = lived(t, 2), a = asked();
  assert.equal((await consolidate(dir, { ask: a.ask, now: NOW })).skipped, 'under budget');
  assert.equal((await consolidate(tmp(t), { ask: a.ask, now: NOW })).skipped, 'no memory yet');
  assert.equal(a.calls.length, 0);
  assert.ok(!existsSync(join(dir, 'MEMORY.md')));
});
