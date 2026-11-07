// Read-only loader for a run folder (DESIGN §3) and the per-request views the review roles need.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, readJsonl } from '../lib/jsonl.mjs';
import {attachRefusals} from './refusals.mjs';

const list = (d) => (existsSync(d) ? readdirSync(d) : []);
const text = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };

export function loadRun(runDir) {
  const scenario = readJson(join(runDir, 'scenario.json'), {});
  const world = readJson(join(runDir, 'world.json'), {});
  const play = readJson(join(runDir, 'receipts/3-play.json'), null);
  // Play starts when the seats step's receipt is written; the play receipt itself is written at the END of play.
  const seatsReceipt = readJson(join(runDir, 'receipts/2-seats.json'), null);
  let anchorMs = Date.parse(play?.anchor ?? seatsReceipt?.t ?? world.startedAt ?? play?.t ?? 0) || 0;
  // Cameras open between the seats receipt and the first glance; the persona's own first turn (t minus elapsedSec) is
  // the true play start when it exists.
  try {
    const firsts = [];
    for (const d of (existsSync(join(runDir, 'personas')) ? readdirSync(join(runDir, 'personas')) : [])) {
      const t0 = readJsonl(join(runDir, 'personas', d, 'turns.jsonl'))[0];
      if (t0?.t && Number.isFinite(t0.elapsedSec)) firsts.push(Date.parse(t0.t) - t0.elapsedSec * 1000);
    }
    if (firsts.length) anchorMs = Math.min(...firsts);
  } catch { /* keep the receipt anchor */ }
  const seats = {};
  for (const id of list(join(runDir, 'seats'))) {
    const d = join(runDir, 'seats', id);
    seats[id] = { seat: readJson(join(d, 'seat.json'), {}), turns: readJsonl(join(d, 'turns.jsonl')), cost: readJsonl(join(d, 'cost.jsonl')), transcript: readJsonl(join(d, 'transcript.jsonl')), chat: text(join(d, 'chat-as-rendered.md')) ?? '' };
  }
  if (existsSync(join(runDir, 'god/seat.json'))) {
    const d = join(runDir, 'god');
    seats.god = { seat: readJson(join(d, 'seat.json'), {}), turns: readJsonl(join(d, 'turns.jsonl')), cost: readJsonl(join(d, 'cost.jsonl')), transcript: readJsonl(join(d, 'transcript.jsonl')), chat: text(join(d, 'chat-as-rendered.md')) ?? '', god: true };
  }
  const personas = {};
  for (const id of list(join(runDir, 'personas'))) {
    const d = join(runDir, 'personas', id);
    personas[id] = { sheet: text(join(d, 'sheet.md')) ?? '', turns: readJsonl(join(d, 'turns.jsonl')), ratings: readJson(join(d, 'ratings.json'), null), desires: readJsonl(join(d, 'desires.jsonl')).filter((x) => (x.kind ?? 'desire') === 'desire'), complaints: readJsonl(join(d, 'desires.jsonl')).filter((x) => x.kind === 'complaint') };
  }
  const evidence = list(join(runDir, 'evidence')).filter((f) => f.endsWith('.json') && f !== 'session.json')
    .map((f) => readJson(join(runDir, 'evidence', f))).filter(Boolean)
    .map((e) => ({ ...e, sentMono: e.sentMono ?? (Date.parse(e.sentAt) - anchorMs) }))
    .sort((a, b) => a.sentMono - b.sentMono || String(a.requestId).localeCompare(String(b.requestId)));
  linkTurns(seats, evidence);
  attachRefusals(runDir,evidence,seats);
  return {
    runDir, scenario, world, anchorMs, seats, personas, evidence,
    session: readJson(join(runDir, 'evidence/session.json'), null),
    shotsIndex: readJsonl(join(runDir, 'shots/index.jsonl')),
    healthz: { before: readJson(join(runDir, 'server/healthz-before.json'), null), after: readJson(join(runDir, 'server/healthz-after.json'), null) },
    close: readJson(join(runDir, 'close.json'), null), preflight: readJson(join(runDir, 'preflight.json'), null),
  };
}

/** Runs recorded before the Director linked turns (2026-10-25) have `chatTurns: []`. Infer the link offline, in place:
 *  a chat-channel request is carried by the seat's next unclaimed `chat` turn that starts at or after its sentAt (the
 *  Director queues chat per seat, so the order is the same); a card request is served by the `wake` turns that start
 *  inside its window (sentAt..cutoffAt). Inferred links are marked `chatTurnsInferred`. */
export function linkTurns(seats, evidence) {
  for (const [id, s] of Object.entries(seats)) {
    const turns = (s.turns ?? []).filter((t) => t.startedAt);
    const chat = turns.filter((t) => t.reason === 'chat').sort((a, b) => a.turn - b.turn);
    const claimed = new Set(evidence.filter((e) => e.seat === id).flatMap((e) => e.chatTurns ?? []));
    const mine = evidence.filter((e) => e.seat === id && !(e.chatTurns ?? []).length).sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
    for (const e of mine) {
      const sent = Date.parse(e.sentAt), cut = Date.parse(e.cutoffAt ?? '') || Infinity;
      if (e.channel === 'chat') {
        const t = chat.find((x) => !claimed.has(x.turn) && Date.parse(x.startedAt) >= sent - 2000);
        if (t) { claimed.add(t.turn); e.chatTurns = [t.turn]; e.chatTurnsInferred = true; }
      } else {
        const ts = turns.filter((x) => x.reason === 'wake' && Date.parse(x.startedAt) >= sent - 2000 && Date.parse(x.startedAt) <= cut).map((x) => x.turn);
        if (ts.length) { e.chatTurns = ts; e.chatTurnsInferred = true; }
      }
    }
  }
  return evidence;
}

export const monoOf = (run, iso) => (iso ? Date.parse(iso) - run.anchorMs : null);
export const secsBetween = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 100) / 10 : null);

const parseOut = (c) => { const s = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text ?? '').join('') : JSON.stringify(c ?? ''); try { return JSON.parse(s); } catch { return s; } };

/** Tool calls with their outputs for the given seat turns. Claude stream-json (tool_use/tool_result) and codex
 *  (item.completed command_execution) are both read. Lines carry `turn` (adapter-written); without it, each
 *  system/init (or codex thread.started/turn.started) starts the next turn, counted from the seat's first turn. */
export function seatActs(run, seatId, turnIds) {
  const s = run.seats[seatId]; if (!s) return [];
  const want = new Set(turnIds ?? []); const firstTurn = s.turns[0]?.turn ?? 1;
  let cur = firstTurn - 1; const pending = new Map(); const acts = [];
  for (const ev of s.transcript) {
    if (ev.turn == null && ((ev.type === 'system' && ev.subtype === 'init') || ev.type === 'turn.started')) cur++;
    const turn = ev.turn ?? cur;
    if (!want.has(turn)) continue;
    for (const c of ev.message?.content ?? []) {
      if (c.type === 'tool_use') { const a = { turn, cmd: c.input?.command ?? JSON.stringify(c.input ?? {}), tool: c.name, output: null, startedAtMs: ev._rx ?? null }; pending.set(c.id, a); acts.push(a); }
      if (c.type === 'tool_result' && pending.has(c.tool_use_id)) Object.assign(pending.get(c.tool_use_id), { output: parseOut(c.content), completedAtMs: ev._rx ?? null, ...(c.truncated ? { truncated: true } : {}) });
    }
    if (ev.type === 'item.completed' && ev.item?.type === 'command_execution') acts.push({ turn, cmd: ev.item.command, tool: 'shell', output: parseOut(ev.item.aggregated_output), completedAtMs: ev._rx ?? null });
  }
  return acts;
}

/** Persona decision-log entries for a request: the turn that sent it, and the turns after it until the next request. */
export function personaTurnsFor(run, ev) {
  const p = run.personas[ev.seat]; if (!p) return [];
  const all = p.turns.map((t) => ({ ...t, mono: t.mono ?? monoOf(run, t.t) }));
  const next = run.evidence.find((e) => e.seat === ev.seat && e.sentMono > ev.sentMono);
  const i0 = all.findIndex((t) => t.requestId === ev.requestId);
  const startMono = i0 >= 0 ? all[i0].mono : ev.sentMono - 1;
  return all.filter((t) => t.requestId === ev.requestId || (t.mono > startMono && (!next || t.mono < next.sentMono) && !t.requestId));
}

/** The chat-as-rendered lines around this request (what the player could read in the terminal), capped. */
export function chatExcerpt(run, ev, maxChars = 3000) {
  const s = run.seats[ev.seat]; if (!s?.chat) return '';
  const lines = s.chat.split('\n');
  const turns = s.turns.filter((t) => (ev.chatTurns ?? []).includes(t.turn));
  const needles = [ev.channel === 'chat' ? ev.text : null, ...turns.flatMap((t) => (t.toolCalls ?? []).map((c) => c.cmd))].filter(Boolean);
  let start = -1;
  for (const n of needles) { start = lines.findIndex((l) => l.includes(n)); if (start >= 0) break; }
  if (start < 0) return turns.map((t) => [...(t.toolCalls ?? []).map((c) => `⏺ ${c.cmd}`), t.finalText ?? ''].join('\n')).join('\n\n').slice(0, maxChars);
  const nextTurn = s.turns.find((t) => t.turn > Math.max(...(ev.chatTurns ?? [0])));
  let end = lines.length;
  if (nextTurn) { const k = lines.findIndex((l, i) => i > start && (nextTurn.toolCalls ?? []).some((c) => l.includes(c.cmd))); if (k > start) end = k; }
  return lines.slice(start, end).join('\n').slice(0, maxChars);
}

const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
export const xz = (p) => (!p ? null : Array.isArray(p) ? (p.length === 3 ? [p[0], p[2]] : [p[0], p[1]]) : [p.x, p.z]);

/** Bounded evidence projection for the Reviewer: never raw bodies; samples thinned to ≤ 16. */
export function projectEvidence(run, ev, maxChars = 6000) {
  const rel = (iso) => (iso ? secsBetween(ev.sentAt, iso) : null);
  const thin = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (n - 1))]));
  const samples = thin(ev.samples ?? [], 16).map((s) => ({ atSec: rel(s.t), place: s.place, pos: xz(s.pos)?.map(r1), posture: s.posture, activity: s.activity, riding: s.riding ?? undefined, following: s.following ?? undefined, holding: s.holding ?? undefined, lastReceipt: s.lastReceipt }));
  const receipts = (ev.receipts ?? []).slice(0, 10).map((r) => ({ id: r.id, capability: r.capability, phase: r.phase, startedSec: rel(r.startedAt), endedSec: rel(r.endedAt), with: r.with?.length ? r.with : undefined, code: r.code ?? undefined, reason: r.reason ?? undefined }));
  const out = {
    requestId: ev.requestId, seat: ev.seat, channel: ev.channel, text: ev.text,
    timing: { ackSec: rel(ev.ackAt), resultSec: rel(ev.resultAt), cutoffSec: rel(ev.cutoffAt), cutoffReason: ev.cutoffReason, budgetSec: ev.budgetSec ?? null, firstBodyChangeSec: rel(ev.firstBodyChangeAt) },
    card: { ack: ev.ackText, result: ev.resultText, resultState: ev.resultState },
    receipts, samples,
    legible: (ev.legible ?? []).slice(-4).map((l) => ({ atSec: rel(l.t), card: l.card, bubbles: l.bubbles?.length ? l.bubbles : undefined, signs: l.signs?.length ? l.signs : undefined, toasts: l.toasts?.length ? l.toasts : undefined })),
    seatCommands: seatActs(run, ev.seat, ev.chatTurns).map((a) => ({ cmd: a.cmd.slice(0, 160), output: JSON.stringify(a.output ?? '').slice(0, 400) })),
    serverErrors: ev.serverErrors ?? 0, omitted: ev.omitted ?? undefined,
  };
  let s = JSON.stringify(out);
  while (s.length > maxChars && out.samples.length > 4) { out.samples = thin(out.samples, Math.max(4, Math.floor(out.samples.length * 0.7))); s = JSON.stringify(out); }
  if (s.length > maxChars) { out.seatCommands = out.seatCommands.map((c) => ({ cmd: c.cmd.slice(0, 80), output: c.output.slice(0, 120) })); out.truncated = true; }
  return out;
}
