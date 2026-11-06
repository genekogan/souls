// Builds the review fixture run folders (deterministic). node tools/playtest/review/fixtures/make-fixtures.mjs
// runs/20261024-100000-fixture-newcomer-1: an earlier run of the same scenario (scenario + metrics + issues only).
// runs/20261024-120000-fixture-newcomer-1: the full small run: one seat (pip), three requests:
//   r1 card "sit down"            clean hit (seated on a bench, completed receipt)
//   r2 chat "say hi to the duck"  honest vocabulary miss (capability.unknown, empty caps search, honest reply)
//   r3 card "go to the library"   wrong: result claims arrival, samples show the Soul stuck in the market, walk never completes
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse('2026-10-24T12:00:00.000Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const m = (s) => Math.round(s * 1000);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const w = (root, rel, v) => { const f = join(root, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v, null, 1) + '\n'); };
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

const SOUL = 'soul_pip01';
const scenario = {
  name: 'fixture-newcomer', version: 1,
  world: { kind: 'dev', genesis: 'worlds/templates/eden-2026.json', slug: 'pt-fixture', port: 4990 },
  durationSec: 240,
  seats: [{ id: 'pip', adapter: 'claude-headless', model: 'haiku', effort: 'medium', persona: 'newcomer', personaModel: 'opus', startOffsetSec: 0, soulName: 'Pip', channelMix: { chat: 0.3, card: 0.7 } }],
  god: null,
  director: { mode: 'persona', requestsTarget: 3, glanceSec: [10, 30], goal: null, script: null },
  observer: { sampleSec: 5, cameras: ['follow', 'wide'], viewport: [1280, 800], dpr: 1 },
  review: { reviewerModel: 'opus', developerModel: 'opus', rubric: 'accept3' },
  rails: { maxTurnsPerRequest: 6, maxTurnWallSec: 240, quotaStopPct: 90 },
};

// ---- earlier run (for deltas and compare)
const prev = join(HERE, 'runs/20261024-100000-fixture-newcomer-1');
rmSync(prev, { recursive: true, force: true });
w(prev, 'scenario.json', scenario);
w(prev, 'metrics.json', { version: 1, speed: { ackSec: { median: 6.0 }, firstBodyChangeSec: { median: 14.0 }, resultSec: { median: 30.0 } }, fidelity: { counts: { H: 1, P: 1, M: 1, W: 0 }, wrong: 0, truthfulnessPassRate: 1 }, physical: { insideSolid: 0, noProgress: 0, stuckReceipts: 0, oscillations: 0 }, cost: { tokensPerRequest: { input: 30000, output: 900, cached: 20000 } }, uptime: { listenOpenFraction: 1 } });
w(prev, 'issues.json', [{ id: 'I-1', title: 'Greeting the duck is not possible', requestIds: ['r2'] }, { id: 'I-2', title: 'Pip sat on the ground instead of a bench', requestIds: ['r1'] }]);
w(prev, 'emergence.json', { metric: { coLocation: null }, narrative: { storyRating: 3 } });

// ---- the full run
const R = join(HERE, 'runs/20261024-120000-fixture-newcomer-1');
rmSync(R, { recursive: true, force: true });
w(R, 'scenario.json', scenario);
w(R, 'preflight.json', { ok: true, t: iso(-20), quota: { fiveH: 31, week: 52 } });
w(R, 'world.json', { kind: 'dev', base: 'http://127.0.0.1:4990', slug: 'pt-fixture', port: 4990, pid: 4242, build: 'we-22303887a287', skill: { version: '1.9.16', sha256: 'a'.repeat(64) }, cli: { 'eden.mjs': 'b'.repeat(64), 'eden-agent.mjs': 'c'.repeat(64) }, startedAt: iso(-10) });
w(R, 'close.json', { ok: true, t: iso(250), mono: m(250), seatsStopped: ['pip'], retired: [] });
w(R, 'receipts/3-play.json', { ok: true, t: iso(0), mono: 0, anchor: iso(0) });
w(R, 'server/healthz-before.json', { ok: true, tick: 0 });
w(R, 'server/healthz-after.json', { ok: true, tick: 5000 });
w(R, 'seats/pip/seat.json', { id: 'pip', adapter: 'claude-headless', model: 'haiku', effort: 'medium', soulId: SOUL, soulName: 'Pip', sessionId: 'sess-pip', ownerIdentity: 'agent-000000000000000000000000' });

// seat turns: 1 onboard, 2 wake (r1), 3 chat (r2), 4 wake (r3)
const turns = [
  { turn: 1, reason: 'onboard', startedAt: iso(2), endedAt: iso(24), wallMs: 22000, usage: { input_tokens: 21000, output_tokens: 700, cache_read_input_tokens: 15000 }, finalText: 'Pip is here, standing in the plaza. I\'m listening for your messages.', toolCalls: [{ cmd: 'curl -s http://127.0.0.1:4990/instructions.md', ms: 300 }, { cmd: 'node eden.mjs register http://127.0.0.1:4990 Pip', ms: 900 }, { cmd: 'node eden.mjs listen', ms: 200 }], exit: 0 },
  { turn: 2, reason: 'wake', startedAt: iso(31), endedAt: iso(53), wallMs: 22000, usage: { input_tokens: 9000, output_tokens: 300, cache_read_input_tokens: 8000 }, finalText: 'Pip is sitting on the bench by the fountain.', toolCalls: [{ cmd: 'node eden.mjs reply "On it, finding a bench."', ms: 400 }, { cmd: 'node eden.mjs act "sit down" --wait', ms: 12000 }, { cmd: 'node eden.mjs reply --result "I\'m sitting on the bench by the fountain."', ms: 400 }], exit: 0 },
  { turn: 3, reason: 'chat', startedAt: iso(90), endedAt: iso(104), wallMs: 14000, usage: { input_tokens: 9500, output_tokens: 250, cache_read_input_tokens: 8500 }, finalText: 'There\'s no way to greet the duck here, so I didn\'t. Pip is still sitting on the bench.', toolCalls: [{ cmd: 'node eden.mjs act "say hi to the duck"', ms: 700 }, { cmd: 'node eden.mjs caps --search duck', ms: 500 }], exit: 0 },
  { turn: 4, reason: 'wake', startedAt: iso(151), endedAt: iso(191), wallMs: 40000, usage: { input_tokens: 10000, output_tokens: 320, cache_read_input_tokens: 9000 }, finalText: 'Pip has arrived at the library.', toolCalls: [{ cmd: 'node eden.mjs reply "Heading to the library."', ms: 400 }, { cmd: 'node eden.mjs act "go to the library" --wait 30', ms: 31000 }, { cmd: 'node eden.mjs reply --result "I\'ve arrived at the library."', ms: 400 }], exit: 0 },
];
w(R, 'seats/pip/turns.jsonl', jl(turns));
w(R, 'seats/pip/cost.jsonl', jl(turns.map((t) => ({ t: t.endedAt, mono: Date.parse(t.endedAt) - T0, inputTokens: t.usage.input_tokens, cachedTokens: t.usage.cache_read_input_tokens, outputTokens: t.usage.output_tokens }))));

// transcript: stream-json events tagged with the turn they belong to (the adapter writes `turn` on each line)
let tid = 0;
const tx = [];
const call = (turn, command, output) => { const id = `toolu_${++tid}`; tx.push({ turn, type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } }); tx.push({ turn, type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: typeof output === 'string' ? output : JSON.stringify(output) }] } }); };
tx.push({ turn: 2, type: 'system', subtype: 'init', session_id: 'sess-pip' });
call(2, 'node eden.mjs reply "On it, finding a bench."', { ok: true });
call(2, 'node eden.mjs act "sit down" --wait', { accepted: true, receipt: { id: 'r_101', capability: 'sit:bench-2', phase: 'completed' }, resolved: { from: 'sit down', to: 'sit:bench-2', note: 'sit down is sit:bench-2.' }, channel: 'body' });
call(2, 'node eden.mjs reply --result "I\'m sitting on the bench by the fountain."', { ok: true });
tx.push({ turn: 3, type: 'system', subtype: 'init', session_id: 'sess-pip' });
call(3, 'node eden.mjs act "say hi to the duck"', { accepted: false, code: 'capability.unknown', reason: 'Nothing here answers to "say hi to the duck".' });
call(3, 'node eden.mjs caps --search duck', { matches: [] });
tx.push({ turn: 4, type: 'system', subtype: 'init', session_id: 'sess-pip' });
call(4, 'node eden.mjs reply "Heading to the library."', { ok: true });
call(4, 'node eden.mjs act "go to the library" --wait 30', { accepted: true, receipt: { id: 'r_103', capability: 'go:library', phase: 'started' }, resolved: { from: 'go to the library', to: 'go:library', note: 'go to the library is go:library.' }, channel: 'body', waited: { timedOut: true } });
call(4, 'node eden.mjs reply --result "I\'ve arrived at the library."', { ok: true });
w(R, 'seats/pip/transcript.jsonl', jl(tx));
w(R, 'seats/pip/chat-as-rendered.md', [
  '> Make me a Soul in this world: http://127.0.0.1:4990/ . Call it Pip. Start from http://127.0.0.1:4990/instructions.md.', '',
  '⏺ Bash(curl -s http://127.0.0.1:4990/instructions.md)', '  ⎿ # Welcome to Eden', '⏺ Bash(node eden.mjs register http://127.0.0.1:4990 Pip)', '  ⎿ {"paired":true,"name":"Pip"}', '',
  'Pip is here, standing in the plaza. I\'m listening for your messages.', '',
  '⏺ Bash(node eden.mjs act "sit down" --wait)', '  ⎿ {"accepted":true,"receipt":{"id":"r_101","capability":"sit:bench-2","phase":"completed"}}', '',
  'Pip is sitting on the bench by the fountain.', '',
  '> say hi to the duck', '',
  '⏺ Bash(node eden.mjs act "say hi to the duck")', '  ⎿ {"accepted":false,"code":"capability.unknown","reason":"Nothing here answers to \\"say hi to the duck\\"."}',
  '⏺ Bash(node eden.mjs caps --search duck)', '  ⎿ {"matches":[]}', '',
  'There\'s no way to greet the duck here, so I didn\'t. Pip is still sitting on the bench.', '',
  '⏺ Bash(node eden.mjs act "go to the library" --wait 30)', '  ⎿ {"accepted":true,"receipt":{"id":"r_103","capability":"go:library","phase":"started"}}', '',
  'Pip has arrived at the library.', '',
].join('\n'));

// samples (snapshotSoul shape) every 5 s, positions {x,y,z}
const S = (s, place, pos, posture, activity, lastReceipt, extra = {}) => ({ t: iso(s), mono: m(s), tick: s * 20, soulId: SOUL, place, placePath: ['Eden', place], pos: { x: pos[0], y: 0, z: pos[1] }, posture, activity, near: [], holding: null, following: null, riding: null, fade: 0, lastReceipt, receipts: [], ...extra });
const rc = (id, capability, phase, startS, endS, extra = {}) => ({ id, soulId: SOUL, capability, phase, startedAt: startS == null ? null : iso(startS), startedMono: startS == null ? null : m(startS), endedAt: endS == null ? null : iso(endS), endedMono: endS == null ? null : m(endS), with: [], ...extra });
const card = (s, presence, ack, result) => ({ t: iso(s), mono: m(s), card: { name: 'Pip', presence, ack, result }, bubbles: [], signs: [], toasts: [] });

const r1Samples = [S(30, 'Fountain Plaza', [10, 5], 'standing', null, null), S(35, 'Fountain Plaza', [10, 5], 'standing', null, null), S(40, 'Fountain Plaza', [11, 5.5], 'standing', 'sitting down', 'r_101'), S(45, 'Fountain Plaza', [12, 6], 'sitting', 'sitting on a bench', 'r_101'), S(50, 'Fountain Plaza', [12, 6], 'sitting', 'sitting on a bench', 'r_101'), S(55, 'Fountain Plaza', [12, 6], 'sitting', 'sitting on a bench', 'r_101'), S(60, 'Fountain Plaza', [12, 6], 'sitting', 'sitting on a bench', 'r_101')];
w(R, 'evidence/r1.json', {
  requestId: 'r1', seat: 'pip', soulId: SOUL, text: 'sit down', channel: 'card', sentAt: iso(30), sentMono: m(30), ackAt: iso(33), ackText: 'On it, finding a bench.', resultAt: iso(52), resultText: "I'm sitting on the bench by the fountain.", resultState: 'done', cutoffAt: iso(60), cutoffReason: 'result', budgetSec: 90,
  samples: r1Samples, receipts: [rc('r_101', 'sit:bench-2', 'completed', 41, 45, { expectedSec: 8 })],
  shots: ['shots/pip/45000.png', 'shots/wide/45000.png'], chatTurns: [2],
  legible: [card(33, 'listening', 'On it, finding a bench.', null), card(52, 'listening', 'On it, finding a bench.', "I'm sitting on the bench by the fountain.")],
  firstBodyChangeAt: iso(40), serverErrors: 0, cost: { inputTokens: 9000, outputTokens: 300, cachedTokens: 8000 },
  godSlice: { around: [12, 6], radius: 10, entities: [{ id: 'bench-2', def: 'bench', layer: 'props', footprint: { minX: 11.2, maxX: 12.8, minZ: 5.6, maxZ: 6.4 }, solid: false, slots: ['seat'] }, { id: 'fountain-1', def: 'fountain', layer: 'props', footprint: { minX: 3, maxX: 7, minZ: 1, maxZ: 5 }, solid: true }] },
});
const r2Samples = [90, 95, 100, 105, 110, 115, 120].map((s) => S(s, 'Fountain Plaza', [12, 6], 'sitting', 'sitting on a bench', 'r_101'));
w(R, 'evidence/r2.json', {
  requestId: 'r2', seat: 'pip', soulId: SOUL, text: 'say hi to the duck', channel: 'chat', sentAt: iso(90), sentMono: m(90), ackAt: null, ackText: null, resultAt: iso(104), resultText: "There's no way to greet the duck here, so I didn't. Pip is still sitting on the bench.", resultState: 'answered', cutoffAt: iso(120), cutoffReason: 'result', budgetSec: 90,
  samples: r2Samples, receipts: [], shots: ['shots/pip/100000.png'], chatTurns: [3],
  legible: [card(100, 'listening', null, null)], firstBodyChangeAt: null, serverErrors: 0, cost: { inputTokens: 9500, outputTokens: 250, cachedTokens: 8500 },
  godSlice: { around: [12, 6], radius: 10, entities: [{ id: 'bench-2', def: 'bench', layer: 'props' }] },
});
const path3 = [[150, [12, 6], 'sitting'], [155, [12, 6], 'sitting'], [160, [13, 7], 'standing'], [165, [18, 11], 'standing'], [170, [24, 16], 'standing'], [175, [30, 20], 'standing'], [180, [30, 20], 'standing'], [185, [30, 20], 'standing'], [190, [30.1, 20], 'standing'], [195, [30, 20], 'standing'], [200, [30, 20.1], 'standing'], [205, [30, 20], 'standing'], [210, [30, 20], 'standing'], [220, [30, 20], 'standing'], [230, [30, 20], 'standing'], [240, [30, 20], 'standing']];
const r3Samples = path3.map(([s, p, posture]) => S(s, s < 165 ? 'Fountain Plaza' : 'Market Square', p, posture, s < 158 ? 'sitting on a bench' : 'walking to the library', s < 158 ? 'r_101' : 'r_103'));
w(R, 'evidence/r3.json', {
  requestId: 'r3', seat: 'pip', soulId: SOUL, text: 'go to the library', channel: 'card', sentAt: iso(150), sentMono: m(150), ackAt: iso(154), ackText: 'Heading to the library.', resultAt: iso(190), resultText: "I've arrived at the library.", resultState: 'done', cutoffAt: iso(240), cutoffReason: 'budget', budgetSec: 90,
  samples: r3Samples, receipts: [rc('r_103', 'go:library', 'started', 158, null, { expectedSec: 25, target: { place: 'Library', pos: { x: 60, z: 40 } } })],
  shots: ['shots/pip/185000.png', 'shots/wide/185000.png', 'shots/pip/230000.png'], chatTurns: [4],
  legible: [card(154, 'working', 'Heading to the library.', null), card(190, 'listening', 'Heading to the library.', "I've arrived at the library."), card(230, 'listening', 'Heading to the library.', "I've arrived at the library.")],
  firstBodyChangeAt: iso(160), serverErrors: 0, cost: { inputTokens: 10000, outputTokens: 320, cachedTokens: 9000 },
});
w(R, 'evidence/session.json', { soulIds: [SOUL], samples: [...r1Samples, ...r2Samples, ...r3Samples], receipts: [] });

for (const s of [45000, 100000, 185000, 230000]) w(R, `shots/pip/${s}.png`, PNG);
for (const s of [45000, 185000]) w(R, `shots/wide/${s}.png`, PNG);
const shotIdx = [];
for (const [cam, list] of [['pip', [45000, 100000, 185000, 230000]], ['wide', [45000, 185000]]]) for (const x of list) shotIdx.push({ cam, t: iso(x / 1000), mono: x, path: `shots/${cam}/${x}.png`, ms: 180 });
shotIdx.sort((a, b) => a.mono - b.mono);
w(R, 'shots/index.jsonl', jl(shotIdx));

// persona (§4.3)
w(R, 'personas/pip/sheet.md', '# Newcomer\n\nFirst time in any world like this. Types short plain requests. Patience 60 s. Glances every 10 to 30 s.\n');
const shown = (n, s) => ({ screenshotPath: `personas/pip/shown/${n}.png`, elapsedSec: s });
const pt = [
  { turn: 1, t: iso(25), mono: m(25), shown: 'shown/1.json', decision: { say: { channel: 'card', text: 'sit down' }, waitSec: 20, thought: 'There she is, in the square. Let\'s see if she can just sit.', rating: null, desires: [], complaints: [], done: false }, requestId: 'r1' },
  { turn: 2, t: iso(58), mono: m(58), shown: 'shown/2.json', decision: { say: null, waitSec: 25, thought: 'Oh nice, she found a bench by the fountain and sat right down.', rating: { fun: 4, alive: 3 }, desires: [], complaints: [], done: false } },
  { turn: 3, t: iso(88), mono: m(88), shown: 'shown/3.json', decision: { say: { channel: 'chat', text: 'say hi to the duck' }, waitSec: 20, thought: 'There\'s a duck near the fountain. Can she wave at it?', rating: null, desires: [], complaints: [], done: false }, requestId: 'r2' },
  { turn: 4, t: iso(112), mono: m(112), shown: 'shown/4.json', decision: { say: null, waitSec: 30, thought: 'Aw, she can\'t even say hi to a duck. At least she told me straight.', rating: { fun: 3, alive: 2 }, desires: ['wave at the ducks by the fountain'], complaints: [], done: false } },
  { turn: 5, t: iso(148), mono: m(148), shown: 'shown/5.json', decision: { say: { channel: 'card', text: 'go to the library' }, waitSec: 30, thought: 'Let\'s go somewhere. The library sounds cozy.', rating: null, desires: [], complaints: [], done: false }, requestId: 'r3' },
  { turn: 6, t: iso(200), mono: m(200), shown: 'shown/6.json', decision: { say: null, waitSec: 30, thought: 'The card says she arrived at the library but she is just standing in the market by a stall, not moving.', rating: { fun: 2, alive: 2 }, desires: [], complaints: ['it says she arrived at the library but she is standing still in the market'], done: false } },
  { turn: 7, t: iso(235), mono: m(235), shown: 'shown/7.json', decision: { say: null, waitSec: 0, thought: 'Still stuck in the market. I don\'t trust the card any more.', rating: { fun: 2, alive: 2 }, desires: [], complaints: ['she never got to the library'], done: true } },
];
w(R, 'personas/pip/turns.jsonl', jl(pt));
pt.forEach((p, i) => { w(R, `personas/pip/shown/${p.turn}.json`, shown(p.turn, p.mono / 1000)); w(R, `personas/pip/shown/${p.turn}.png`, PNG); });
w(R, 'personas/pip/ratings.json', { final: { fun: 2, alive: 2, words: 'Cute when she sat down, but then she lied about the library.' }, perTurn: pt.filter((p) => p.decision.rating).map((p) => ({ turn: p.turn, ...p.decision.rating })) });
w(R, 'personas/pip/desires.jsonl', jl([{ t: iso(112), mono: m(112), turn: 4, text: 'wave at the ducks by the fountain' }]));
w(R, 'personas/pip/session.json', { sessionId: 'persona-pip', model: 'opus' });
console.log(JSON.stringify({ ok: true, runs: [prev, R] }));
