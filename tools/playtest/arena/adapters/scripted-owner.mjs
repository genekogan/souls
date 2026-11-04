// Scripted-owner seat turns (#751, decision D006): a model-free controller that plays one Soul from a per-seat script,
// only through the world's served Soul CLI (`node eden.mjs …` in the seat folder), as an agent would. No model, no
// provider, no hidden channel: owner cards arrive through the harness wake loop's `listen`, and every effect is a CLI
// command recorded in the seat transcript. Deterministic from its script; reusable by any scenario seat
// (`"adapter": "scripted-owner", "script": {...}`). See tools/playtest/runs/README.md.
//
// script: { rules: [{ match, ack?, do: [[eden.mjs args…], …], close?: "done"|"open", result?, supersede? }], unmatched? }
//   match      case-insensitive regular expression tested against the owner's message text; the first rule that matches wins
//   ack        reply sent with `ack <id>` (≤140 chars); default "On it."
//   do         eden.mjs argument lists run in order; "{id}" is replaced by the message id. A step that fails stops the rule.
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
    if (!Array.isArray(r?.do) || !r.do.every((s) => Array.isArray(s) && s.length && s.every((a) => typeof a === 'string'))) errs.push(`${at}.do: a list of eden.mjs argument lists`);
    else if (r.do.some((s) => ['register', 'create', 'pair', 'listen', 'ack', 'result', 'travel'].includes(s[0]))) errs.push(`${at}.do: setup, inbox and travel commands are the adapter's own (use ack/result/close fields)`);
    if (r?.close != null && !CLOSES.includes(r.close)) errs.push(`${at}.close: done or open`);
    for (const k of ['ack', 'result', 'supersede']) if (r?.[k] != null && (typeof r[k] !== 'string' || !r[k].trim() || r[k].length > 140)) errs.push(`${at}.${k}: 1-140 characters`);
  });
  if (script.unmatched != null && (typeof script.unmatched !== 'string' || script.unmatched.length > 140)) errs.push('script.unmatched: up to 140 characters');
  return errs;
}

/** The first rule whose match fits the text, or null. */
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
 *  that waited (`--wait`) must end completed, or with the world observing its activity under way (a sit holds its
 *  receipt open while seated); anything else after the wait is a failure, never a claimed success. */
export function stepOutcome(r, { waited = false } = {}) {
  let d = null; try { d = JSON.parse(r.stdout); } catch { /* plain text */ }
  if (r.code !== 0) return { ok: false, why: firstLine(r.stderr || r.stdout) || `exit ${r.code}` };
  if (d?.accepted === false) return { ok: false, why: d.code ?? d.reason ?? 'not accepted' };
  const phase = d?.receipt?.phase ?? d?.phase;
  if (['failed', 'refused', 'cancelled', 'interrupted'].includes(phase)) return { ok: false, why: `${phase}${d?.receipt?.reason ? `: ${d.receipt.reason}` : ''}` };
  if (waited && d?.receipt && phase !== 'completed') {
    const ongoing = (d.events ?? []).some((e) => e?.kind === 'activity.observed' && e.receipt?.id === d.receipt.id && e.action?.status === 'executing');
    if (!ongoing) return { ok: false, why: `still ${phase ?? 'open'} after waiting` };
    return { ok: true, phase, ongoing: true };
  }
  return { ok: true, phase: phase ?? null };
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
    say(`Set up ${state.soulName}; waiting for messages.`);
    return done(0);
  }

  const handle = async ({ id = null, text: msg }) => {
    const rule = matchRule(script, msg);
    if (id && state.handled.includes(id)) return;
    if (id) { state.handled.push(id); save(); }
    if (!rule) {
      say(`No scripted response to: ${clip(msg)}`);
      if (id) { await cli(['ack', id]); await cli(['result', id, 'failed', clip(script.unmatched ?? 'no scripted response')]); }
      return;
    }
    if (rule.supersede && state.open.length) {
      for (const old of state.open.splice(0)) await cli(['result', old, 'failed', rule.supersede]);
      save();
    }
    if (id) await cli(['ack', id, clip(rule.ack ?? 'On it.')]);
    let failed = null;
    for (const step of rule.do) {
      const r = await cli(step.map((a) => (id ? a.replaceAll('{id}', id) : a)));
      const o = stepOutcome(r, { waited: step.includes('--wait') });
      if (!o.ok) { failed = `${step[0]}: ${o.why}`; break; }
    }
    if (!id) return;
    if ((rule.close ?? 'done') === 'open' && !failed) { state.open.push(id); save(); say(`Started; ${id} stays open.`); return; }
    await cli(['result', id, failed ? 'failed' : 'done', clip(failed ?? rule.result ?? 'Done.')]);
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
