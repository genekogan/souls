// Scripted-owner seat turns (#751, decision D006): a model-free controller that plays one Soul from a per-seat script,
// only through the world's served Soul CLI (`node eden.mjs …` in the seat folder), as an agent would. No model, no
// provider, no hidden channel: owner cards arrive through the harness wake loop's `listen`, and every effect is a CLI
// command recorded in the seat transcript. Deterministic from its script; reusable by any scenario seat
// (`"adapter": "scripted-owner", "script": {...}`). See tools/playtest/runs/README.md.
//
// script: { rules: [{ match, ack?, do: [[eden.mjs args…], …], close?: "done"|"open", result?, supersede? }], unmatched? }
//   match      case-insensitive regular expression tested against the owner's message text; the first rule that matches wins
//   ack        reply sent with `ack <id>` (≤140 chars); default "On it."
//   do         eden.mjs argument lists run in order; "{id}" is replaced by the message id. A `--wait` step that an owner
//              message ends while its receipt is still open keeps checking that receipt (`receipt <id>` every 2 s) for the rest
//              of its window (#832); the message is handled on the next turn. A step that is refused or fails
//              stops the rule, unless the step ends with an options object {"onRefused": "continue"} (default "fail"):
//              then the refusal is recorded and the next step runs (#828). "{{prev.<path>}}" in an argument is replaced
//              from the previous step's JSON output (a refusal's too), e.g. "{{prev.did_you_mean[0].id}}"; a placeholder
//              that does not resolve fails its step without running it.
//   close      "done" (default): `result <id> done|failed` from the steps' outcome. "open": leave the request open (the
//              activity continues in the world) until a later rule supersedes it or the run ends.
//   supersede  text for `result <old> failed "<text>"` on every request still open when this rule fires (owner redirection)
//   unmatched  text for `result <id> failed` when no rule matches (default "no scripted response")
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../lib/proc.mjs';
import { renderChat as claudeRender, toolCalls as claudeToolCalls } from './claude-headless.mjs';

export const name = 'scripted-owner';
const STATE = '.scripted-owner.json';
const ONBOARD = /^Make me a Soul in this world: (\S+?)\/? \. Call it (.+?)\. /;
const NUDGE = /^Onboarding is not finished\./;
const WAKE = /^\[background task\] [^\n]* exited with output:\n([\s\S]*)$/;
const CLOSES = ['done', 'open'];

/** Every problem with a script, as strings (empty when valid). Used by run validation before anything starts. */
export function validateScript(script) {
  const errs = [];
  if (!script || typeof script !== 'object' || !Array.isArray(script.rules) || !script.rules.length) return ['script.rules[] required'];
  for (const k of Object.keys(script)) if (!['rules', 'unmatched'].includes(k)) errs.push(`script.${k} is unknown`);
  script.rules.forEach((r, i) => {
    const at = `script.rules[${i}]`;
    for (const k of Object.keys(r ?? {})) if (!['match', 'ack', 'do', 'close', 'result', 'supersede'].includes(k)) errs.push(`${at}.${k} is unknown`);
    if (typeof r?.match !== 'string') errs.push(`${at}.match: a regular expression string`);
    else { try { new RegExp(r.match, 'i'); } catch (e) { errs.push(`${at}.match: ${e.message}`); } }
    if (!Array.isArray(r?.do) || !r.do.every((s) => Array.isArray(s) && stepArgs(s).length && stepArgs(s).every((a) => typeof a === 'string'))) errs.push(`${at}.do: a list of eden.mjs argument lists`);
    else {
      if (r.do.some((s) => ['register', 'create', 'pair', 'listen', 'ack', 'result', 'travel'].includes(s[0]))) errs.push(`${at}.do: setup, inbox and travel commands are the adapter's own (use ack/result/close fields)`);
      r.do.forEach((s, j) => {
        const o = stepOptions(s);
        if (o) for (const [k, v] of Object.entries(o)) if (k !== 'onRefused') errs.push(`${at}.do[${j}].${k} is unknown (step options: onRefused)`); else if (!['continue', 'fail'].includes(v)) errs.push(`${at}.do[${j}].onRefused: continue or fail`);
        for (const a of stepArgs(s)) for (const m of a.matchAll(PREV)) {
          if (j === 0) errs.push(`${at}.do[0]: ${m[0]} needs a previous step`);
          if (!PATH.test(m[1])) errs.push(`${at}.do[${j}]: ${m[0]} is not a path like prev.did_you_mean[0].id`);
        }
      });
    }
    if (r?.close != null && !CLOSES.includes(r.close)) errs.push(`${at}.close: done or open`);
    for (const k of ['ack', 'result', 'supersede']) if (r?.[k] != null && (typeof r[k] !== 'string' || !r[k].trim() || r[k].length > 140)) errs.push(`${at}.${k}: 1-140 characters`);
  });
  if (script.unmatched != null && (typeof script.unmatched !== 'string' || script.unmatched.length > 140)) errs.push('script.unmatched: up to 140 characters');
  return errs;
}

/** A step is eden.mjs arguments, optionally ending with an options object ({onRefused}). */
const PREV = /\{\{prev\.([^}]*)\}\}/g, PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;
export const stepOptions = (s) => (s.length && s.at(-1) && typeof s.at(-1) === 'object' && !Array.isArray(s.at(-1)) ? s.at(-1) : null);
export const stepArgs = (s) => (stepOptions(s) ? s.slice(0, -1) : s);
/** The previous step's JSON (stdout, else stderr), or null. */
export function stepJson(r) { for (const t of [r?.stdout, r?.stderr]) { try { const d = JSON.parse(t); if (d && typeof d === 'object') return d; } catch { /* not JSON */ } } return null; }
/** bindPrev(args, prev) → {args} with every {{prev.<path>}} replaced, or {error} naming the first that does not resolve
 *  to a string or number. */
export function bindPrev(args, prev) {
  let error = null;
  const out = args.map((a) => a.replace(PREV, (m, path) => {
    let v = prev;
    for (const k of path.match(/[^.[\]]+/g) ?? []) v = v == null ? undefined : v[k];
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) return String(v);
    error ??= `unresolved ${m}${prev ? '' : ' (the previous step printed no JSON)'}`;
    return m;
  }));
  return error ? { error } : { args: out };
}

/** The first rule whose match fits the text, or null. */
// `match` is local spec data compiled per message; a pathological pattern only slows its own seat's turn.
export function matchRule(script, text) { return script.rules.find((r) => new RegExp(r.match, 'i').test(String(text ?? ''))) ?? null; }

/** What a turn's text asks for: onboarding, a wake carrying owner messages, or typed chat. */
export function classify(text) {
  const o = ONBOARD.exec(text);
  if (o) return { kind: 'onboard', base: o[1], soulName: o[2] };
  if (NUDGE.test(text)) return { kind: 'onboard', base: null, soulName: null };
  const w = WAKE.exec(text);
  if (w) { let d = null; try { d = JSON.parse(w[1]); } catch { /* not a listen result */ } return { kind: 'wake', messages: Array.isArray(d?.messages) ? d.messages.filter((m) => m?.id) : [] }; }
  return { kind: 'chat', text };
}

/** Did one eden.mjs step do what it asked? Exit code, refusals and terminal receipt phases, read from its JSON. A step
 *  that waited (`--wait`) must end with its receipt completed, or with the world observing that receipt's activity under
 *  way (a sit holds its receipt open while seated). Anything else after the wait is a failure, never a claimed success:
 *  `done: false`, a receipt the CLI could not read back (`receipt.error`), or no receipt at all (the brief output drops it
 *  past 600 characters, e.g. a wait cut short by several owner messages, and on a receipt-fetch error). */
export function stepOutcome(r, { waited = false } = {}) {
  let d = null; try { d = JSON.parse(r.stdout); } catch { /* plain text */ }
  if (r.code !== 0) return { ok: false, why: firstLine(r.stderr || r.stdout) || `exit ${r.code}` };
  if (d?.accepted === false) return { ok: false, why: d.code ?? d.reason ?? 'not accepted' };
  const rec = d?.receipt && !d.receipt.error ? d.receipt : null;
  const phase = rec?.phase ?? d?.phase;
  if (['failed', 'refused', 'cancelled', 'interrupted'].includes(phase)) return { ok: false, why: `${phase}${rec?.reason ? `: ${rec.reason}` : ''}` };
  if (!waited) return { ok: true, phase: phase ?? null };
  if (!rec?.id) return { ok: false, why: 'receipt unknown after waiting: completion not confirmed' };
  if (phase === 'completed' && d.done !== false) return { ok: true, phase };
  const ongoing = (d.events ?? []).some((e) => e?.kind === 'activity.observed' && e.receipt?.id === rec.id && e.action?.status === 'executing');
  if (!ongoing) return { ok: false, why: `still ${phase ?? 'open'} after waiting` };
  return { ok: true, phase, ongoing: true };
}
/** #832: an owner message ends a `--wait` early, by design, so the agent can read it. The receipt id to keep waiting on
 *  when that happened and the receipt has not ended, else null. The message itself is handled on the next turn. */
const ENDED = ['completed', 'failed', 'refused', 'cancelled', 'interrupted', 'replaced'], POLL_MS = 2000;
export function ownerWokeOpen(r) {
  const d = stepJson(r), rec = d?.receipt && !d.receipt.error ? d.receipt : null;
  return r?.code === 0 && d?.ownerMessages?.length && rec?.id && !ENDED.includes(rec.phase) ? rec.id : null;
}
/** The window a step's `--wait [s]` asked for, as the CLI applies it (at most 60 s; 60 when no number follows). */
export function waitWindowSec(args) {
  const i = args.indexOf('--wait'), n = /^\d+$/.test(args[i + 1] ?? '') ? Number(args[i + 1]) : 60;
  return Math.min(60, Math.max(1, n));
}
const firstLine = (s) => String(s ?? '').split('\n').find((l) => l.trim())?.slice(0, 120) ?? '';
const clip = (s) => String(s).slice(0, 140);

/** turn({cwd, text, script, maxWallSec}) → the same record shape as the model adapters, with zero usage. */
export async function turn({ cwd, text, script, maxWallSec = 240 }) {
  const t0 = Date.now(), end = t0 + maxWallSec * 1000;
  const stream = [{ type: 'harness_user', text, _rx: t0 }];
  let n = 0, timedOut = false;
  const say = (t) => stream.push({ type: 'assistant', message: { content: [{ type: 'text', text: t }] }, _rx: Date.now() });
  const cli = async (args) => {
    const id = `so_${++n}`, left = end - Date.now();
    const command = `node eden.mjs ${args.map((a) => (/^[\w./:@-]+$/.test(a) ? a : JSON.stringify(a))).join(' ')}`;
    stream.push({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] }, _rx: Date.now() });
    const r = left > 0 ? await run('node', ['eden.mjs', ...args], { cwd, maxWallMs: left }) : { code: null, stdout: '', stderr: 'turn wall reached' };
    if (r.timedOut || left <= 0) timedOut = true;
    stream.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: (r.stdout || r.stderr || '').slice(0, 4000), is_error: r.code !== 0 }] }, _rx: Date.now() });
    return r;
  };
  const errs = validateScript(script);
  if (errs.length) { say(`[scripted-owner] invalid script: ${errs.join('; ')}`); return done(1); }
  const statePath = join(cwd, STATE);
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { open: [], handled: [] };
  const save = () => writeFileSync(statePath, JSON.stringify(state, null, 1) + '\n');
  const what = classify(text);

  if (what.kind === 'onboard') {
    // The same path an agent follows from instructions.md: fetch the served CLI, register, create, check status.
    if (what.base) { state.base = what.base; state.soulName = what.soulName; save(); }
    if (!state.base) { say('[scripted-owner] no world to onboard into'); return done(1); }
    if (!existsSync(join(cwd, 'eden.mjs'))) {
      const id = `so_${++n}`, url = `${state.base}/eden.mjs`;
      stream.push({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: `curl -fsSo eden.mjs ${url}` } }] }, _rx: Date.now() });
      let ok = false, note;
      try { const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, end - Date.now())) }); const body = await res.text(); ok = res.ok && !/^\s*<!doctype html/i.test(body); if (ok) writeFileSync(join(cwd, 'eden.mjs'), body); note = ok ? `${body.length} bytes` : `HTTP ${res.status}`; }
      catch (e) { note = String(e?.message ?? e); }
      stream.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: note, is_error: !ok }] }, _rx: Date.now() });
      if (!ok) return done(1);
    }
    await cli(['register', state.base]);
    await cli(['create', state.soulName]);
    await cli(['status']);
    if (process.env.SOUL_RUNS_RESIDENT) await cli(['serve']); // #1096 A6: the candidate arm; every later command goes through it
    say(`Set up ${state.soulName}; waiting for messages.`);
    return done(0);
  }

  const handle = async ({ id = null, text: msg }) => {
    const rule = matchRule(script, msg);
    if (id && state.handled.includes(id)) return;
    // A message counts as handled only once its result was accepted (or it is deliberately left open), so a turn cut
    // short mid-rule (maxWallSec, kill) leaves the card to be handled again on re-delivery instead of never answered.
    const handled = () => { if (id) { state.handled.push(id); save(); } };
    if (!rule) {
      say(`No scripted response to: ${clip(msg)}`);
      if (id) { await cli(['ack', id]); if ((await cli(['result', id, 'failed', clip(script.unmatched ?? 'no scripted response')])).code === 0) handled(); }
      return;
    }
    if (rule.supersede && state.open.length) {
      for (const old of state.open.splice(0)) await cli(['result', old, 'failed', rule.supersede]);
      save();
    }
    if (id) await cli(['ack', id, clip(rule.ack ?? 'On it.')]);
    let failed = null, prev = null;
    for (const step of rule.do) {
      const args = stepArgs(step), onRefused = stepOptions(step)?.onRefused ?? 'fail';
      const bound = bindPrev(args.map((a) => (id ? a.replaceAll('{id}', id) : a)), prev);
      let o;
      if (bound.error) o = { ok: false, why: bound.error };
      else {
        const waited = args.includes('--wait'), until = Date.now() + waitWindowSec(args) * 1000;
        let r = await cli(bound.args); prev = stepJson(r);
        // #832: woken by an owner message with the act still going: keep waiting on its receipt for the rest of the window.
        // A `wait` would return at once while that card is unacknowledged (the world's rule, so "stop" is never slept
        // through), so check the receipt instead, every POLL_MS, until it ends or the window does.
        // Not when the woken output already shows the act under way (a seated sit holds its receipt open while seated).
        const rid = waited && !stepOutcome(r, { waited }).ok ? ownerWokeOpen(r) : null;
        while (rid && Date.now() + POLL_MS <= until) {
          await new Promise((ok) => setTimeout(ok, POLL_MS));
          const q = await cli(['receipt', rid]), rec = stepJson(q);
          if (q.code !== 0 || !rec?.id) break;
          r = { code: 0, stdout: JSON.stringify({ receipt: rec }) };
          if (ENDED.includes(rec.phase)) break;
        }
        o = stepOutcome(r, { waited });
      }
      if (o.ok) continue;
      if (onRefused === 'continue') { say(`[scripted-owner] ${args[0]} refused, continuing: ${o.why}`); continue; }
      failed = `${args[0]}: ${o.why}`; break;
    }
    if (!id) return;
    if ((rule.close ?? 'done') === 'open' && !failed) { state.open.push(id); handled(); say(`Started; ${id} stays open.`); return; }
    if ((await cli(['result', id, failed ? 'failed' : 'done', clip(failed ?? rule.result ?? 'Done.')])).code === 0) handled();
  };

  if (what.kind === 'wake') for (const m of what.messages) await handle(m);
  else await handle({ text: what.text });
  return done(0);

  function done(exit) {
    return { stream, usage: { inputTokens: 0, cachedTokens: 0, cacheCreationTokens: 0, outputTokens: 0, costUsd: 0 }, finalText: stream.filter((e) => e.type === 'assistant').flatMap((e) => e.message.content).filter((c) => c.type === 'text').at(-1)?.text ?? null,
      sessionId: null, exit, wallMs: Date.now() - t0, timedOut, endedAfterResult: null, toolCalls: claudeToolCalls(stream), effortApplied: null };
  }
}

export const renderChat = claudeRender;
