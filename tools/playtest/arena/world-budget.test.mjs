import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worldBudgetFor } from './world-budget.mjs';
import { createSeat } from './seat.mjs';
import * as claude from './adapters/claude-headless.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'pt-budget-'));
const rows = (dir, f) => readFileSync(join(dir, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('#1098 world budget: reserve the worst case before a turn, refuse past the cap, settle with the real cost', () => {
  const run = tmp(), b = worldBudgetFor(run, { capUsd: 0.9, turnCapUsd: 0.2, overshootUsd: 0.05 });
  assert.equal(worldBudgetFor(run), b, 'one ledger per run folder');
  assert.equal(b.reserveUsd, 0.25);
  const r1 = b.reserve('ada'), r2 = b.reserve('bo'), r3 = b.reserve('ada');
  assert.ok(r1.ok && r2.ok && r3.ok); assert.equal(b.reservedUsd, 0.75);
  const r4 = b.reserve('bo'); assert.equal(r4.ok, false, 'a fourth worst case would pass $0.90'); assert.match(r4.reason, /would pass \$0\.9/);
  b.settle(r1, 0.12); b.settle(r2, 0.08); b.settle(r1, 5);   // a second settle is ignored
  assert.equal(b.spentUsd, 0.2); assert.equal(b.reservedUsd, 0.25);
  b.settle(r3, null); assert.equal(b.spentUsd, 0.45, 'an unknown cost counts as the whole reservation');
  assert.ok(b.reserve('ada').ok); assert.equal(b.reserve('bo').ok, false, '0.45 spent + 0.25 + 0.25 > 0.90');
  assert.deepEqual(rows(run, 'budget.jsonl').map((r) => r.kind), ['reserved', 'reserved', 'reserved', 'refused', 'settled', 'settled', 'settled', 'reserved', 'refused']);
  assert.throws(() => worldBudgetFor(tmp(), { capUsd: 1.5 }), /\(0, 1\]/, 'never above the repo rule of $1 per world');
});

test('#1098 a claude seat: per-turn cost from the session total, the CLI capped per turn, and no call once the budget is spent', async () => {
  const run = tmp();
  const s = createSeat({ runDir: run, seat: { id: 'ada', adapter: 'claude-headless' }, worldBase: 'http://h', rails: { worldBudgetUsd: 0.5, turnBudgetUsd: 0.15 } });
  const calls = [], totals = [0.12, 0.24, 0.36];   // claude -p --resume reports the session's total so far
  s.adapter = { turn: async (o) => { calls.push(o); const t = totals[calls.length - 1]; return { stream: [], usage: { inputTokens: 1, outputTokens: 1, costUsd: t }, finalText: 'ok', toolCalls: [], exit: 0, wallMs: 1, sessionId: o.sessionId }; }, renderChat: () => '' };
  await s.chat('one'); await s.chat('two');
  const third = await s.chat('three');   // spent 0.24 + a 0.20 reservation (0.15 cap + 0.05 margin) = 0.44 <= 0.50
  assert.equal(third.refused, undefined);
  const fourth = await s.chat('four');   // spent 0.36 + 0.20 = 0.56 > 0.50
  assert.equal(fourth.refused, 'world-budget'); assert.equal(calls.length, 3, 'the refused turn made no provider call');
  assert.ok(calls.every((c) => c.maxBudgetUsd === 0.15), 'each call carries the per-turn cap');
  assert.deepEqual(rows(join(run, 'seats', 'ada'), 'cost.jsonl').map((r) => r.sessionCostUsd), [0.12, 0.24, 0.36]);
  const cost = rows(join(run, 'seats', 'ada'), 'cost.jsonl').map((r) => Math.round(r.costUsd * 100) / 100);
  assert.deepEqual(cost, [0.12, 0.12, 0.12], 'rows sum to the session total, not to the sum of totals');
  assert.match(s.budgetRefused, /would pass \$0\.5/);
  assert.equal(claude.buildArgs({ sessionId: 'u', resume: true, model: 'sonnet', text: 'x', maxBudgetUsd: 0.2 }).join(' ').includes('--max-budget-usd 0.2'), true);
  assert.equal(claude.buildArgs({ sessionId: 'u', resume: true, model: 'sonnet', text: 'x' }).includes('--max-budget-usd'), false);
});
