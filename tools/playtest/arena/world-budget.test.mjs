import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worldBudgetFor, worstCallUsd, turnReservation, WORLD_BUDGET_DEFAULTS as K } from './world-budget.mjs';
import { createSeat } from './seat.mjs';
import * as claude from './adapters/claude-headless.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'pt-budget-'));
const rows = (file) => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const kinds = (file) => rows(file).map((r) => r.kind);

test('#1098 on the live turns, every reservation covers the turn\'s real cost, and the next-call assumptions held', () => {
  const { sessions } = JSON.parse(readFileSync(new URL('./fixtures/1098-live-turns.json', import.meta.url), 'utf8'));
  let checked = 0;
  for (const [name, turns] of Object.entries(sessions)) {
    let ctx = null;
    for (const t of turns) {
      const plan = turnReservation(ctx, K);
      assert.ok(t.costUsd <= plan.usd, `${name} turn ${t.turn}: cost ${t.costUsd} > reservation ${plan.usd} (${plan.basis})`);
      assert.ok(plan.capUsd < plan.usd && plan.capUsd >= K.minTurnCapUsd, `${name} turn ${t.turn}: CLI cap ${plan.capUsd}`);
      let prev = ctx;
      for (const [c, out] of t.calls) {
        assert.ok(out <= K.maxOutputTokens, `${name}: output ${out}`);
        if (prev == null) assert.ok(c <= K.maxContextTokens, `${name}: first-call context ${c}`);
        else assert.ok(c <= prev + K.maxObservationTokens + K.maxOutputTokens, `${name}: context grew ${c - prev}`);
        prev = c + out;
      }
      ctx = prev; checked++;
    }
  }
  assert.equal(checked, 12);
});

test('#1098 the margin is a worst-case uncached Sonnet call: every context token written to the 1 h cache, plus the most output', () => {
  assert.equal(worstCallUsd({ maxContextTokens: 60_000, maxOutputTokens: 4_096 }), 0.42144);   // 60k x $6/M + 4096 x $15/M
  const b = worldBudgetFor(tmp());
  assert.equal(b.marginUsd, 0.42144); assert.equal(b.reserveUsd, 0.62144, 'the turn cap ($0.20) plus that call');
});

test('#1098 world budget: refuse on what is spent, wait on what is in flight, settle with the real cost', async () => {
  const run = tmp(), b = worldBudgetFor(run, { capUsd: 0.9, turnCapUsd: 0.1, maxContextTokens: 10_000, maxOutputTokens: 1_000 });   // reserve 0.1 + 0.075 = 0.175
  assert.equal(worldBudgetFor(run), b, 'one ledger per world');
  const held = await Promise.all([1, 2, 3, 4, 5].map((i) => b.reserve('s' + i)));   // 5 x 0.175 = 0.875 <= 0.9
  assert.ok(held.every((h) => h.ok)); assert.equal(b.reservedUsd, 0.875);
  let sixth = null; const p = b.reserve('s6').then((h) => { sixth = h; });
  await new Promise((r) => setImmediate(r)); assert.equal(sixth, null, 'a turn that collides only with turns in flight waits');
  b.settle(held[0], 0.02); await p; assert.equal(sixth.ok, true, 'and runs once one settles');
  for (const h of held.slice(1)) b.settle(h, 0.1); b.settle(sixth, null);   // unknown cost: the whole reservation
  assert.equal(b.spentUsd, 0.595); assert.equal(b.reservedUsd, 0);
  const r = await b.reserve('s7'); assert.equal(r.ok, true);   // 0.595 + 0.175 = 0.77
  b.settle(r, 0.15); assert.equal((await b.reserve('s8')).ok, false, '0.745 spent + 0.175 would pass 0.9');
  assert.deepEqual(kinds(join(run, 'budget.jsonl')).filter((k) => k !== 'reserved' && k !== 'settled'), ['opened', 'waiting', 'refused']);
  assert.throws(() => worldBudgetFor(tmp(), { capUsd: 1.5 }), /\(0, 1\]/, 'never above the repo rule of $1 per world');
});

test('#1098 the ledger is read back when a run starts: settled spend and unsettled reservations of the last 24 h count', async () => {
  const dir = tmp(), file = join(dir, 'shared-world.jsonl'), old = new Date(Date.now() - 25 * 3600 * 1000).toISOString(), recent = new Date().toISOString();
  writeFileSync(file, [{ t: old, run: 'a', kind: 'settled', id: 1, costUsd: 0.7 }, { t: recent, run: 'a', kind: 'reserved', id: 2, usd: 0.2 }, { t: recent, run: 'a', kind: 'settled', id: 2, costUsd: 0.1 },
    { t: recent, run: 'a', kind: 'reserved', id: 3, usd: 0.2 }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const b = worldBudgetFor(join(dir, 'run-b'), { file, turnCapUsd: 0.2, maxContextTokens: 10_000, maxOutputTokens: 1_000 });
  assert.equal(b.spentUsd, 0.3, 'the 25 h old row is outside the window; the crashed reservation counts in full');
  assert.equal(rows(file).at(-1).priorSpentUsd, 0.3);
  const a = await b.reserve('ada'); b.settle(a, 0.3); assert.equal(b.spentUsd, 0.6);
  assert.equal((await b.reserve('bo')).ok, true, '0.6 + 0.275 <= 0.9'); assert.equal(worldBudgetFor(join(dir, 'run-c'), { file }), b, 'same world file, same ledger in this process');
});

test('#1098 a claude seat: per-turn cost from the session total, the CLI capped per turn, and no call once the budget is spent', async () => {
  const run = tmp();
  const s = createSeat({ runDir: run, seat: { id: 'ada', adapter: 'claude-headless' }, worldBase: 'http://h', rails: { worldBudgetUsd: 0.5 } });
  const calls = [], totals = [0.12, 0.24];   // claude -p --resume reports the session's total so far
  s.adapter = { turn: async (o) => { calls.push(o); const t = totals[calls.length - 1]; return { stream: [{ type: 'assistant', message: { usage: { input_tokens: 5, cache_read_input_tokens: 30_000, output_tokens: 200 } } }], usage: { inputTokens: 1, outputTokens: 1, costUsd: t }, finalText: 'ok', toolCalls: [], exit: 0, wallMs: 1, sessionId: o.sessionId }; }, renderChat: () => '' };
  await s.chat('one');   // 0 + 0.62 > 0.5 is refused... with the default margin a $0.50 world can't take one turn
  assert.equal(calls.length, 0); assert.match(s.budgetRefused, /would pass \$0\.5/);
  const run2 = tmp(), t = createSeat({ runDir: run2, seat: { id: 'bo', adapter: 'claude-headless' }, worldBase: 'http://h', rails: {} });
  t.adapter = s.adapter; calls.length = 0;
  await t.chat('one'); await t.chat('two');
  assert.ok(calls.every((c) => c.maxOutputTokens === 4096), 'each call carries the output bound');
  assert.equal(calls[0].maxBudgetUsd, 0.2, 'the first call of a session: the fixed turn cap');
  assert.equal(calls[1].maxBudgetUsd, turnReservation(30_205).capUsd, 'later calls: the cap priced from the session\'s last context (30,005 + 200 output)');
  assert.deepEqual(rows(join(run2, 'seats', 'bo', 'cost.jsonl')).map((r) => [Math.round(r.costUsd * 100) / 100, r.sessionCostUsd]), [[0.12, 0.12], [0.12, 0.24]], 'rows sum to the session total');
  assert.equal(t.budgetRefused, null, '0.24 spent + 0.62 = 0.86 <= 0.90');
  assert.equal(claude.buildArgs({ sessionId: 'u', resume: true, model: 'sonnet', text: 'x', maxBudgetUsd: 0.2 }).join(' ').includes('--max-budget-usd 0.2'), true);
});

test('#1098 a call bigger than the sized worst case ends the world\'s turns; a Codex seat is refused under a world budget', async () => {
  const run = tmp(), s = createSeat({ runDir: run, seat: { id: 'ada', adapter: 'claude-headless' }, worldBase: 'http://h', rails: {} });
  let n = 0;
  s.adapter = { turn: async () => { n++; return { stream: [{ type: 'assistant', message: { usage: { input_tokens: 2, cache_read_input_tokens: 70_000, output_tokens: 10 } } }], usage: { costUsd: 0.05 }, finalText: 'ok', toolCalls: [], exit: 0, wallMs: 1 }; }, renderChat: () => '' };
  await s.chat('one'); const second = await s.chat('two');
  assert.equal(n, 1); assert.equal(second.refused, 'world-budget'); assert.match(s.budgetRefused, /exceeded the sized worst case \(first-call context 70002 tokens/);
  const c = createSeat({ runDir: tmp(), seat: { id: 'cx', adapter: 'codex-headless' }, worldBase: 'http://h', rails: {} });
  let called = false; c.adapter = { turn: async () => { called = true; return { stream: [], usage: {}, toolCalls: [] }; }, renderChat: () => '' };
  const r = await c.chat('hi'); assert.equal(called, false); assert.equal(r.refused, 'world-budget'); assert.match(c.budgetRefused, /reports no turn cost/);
});
