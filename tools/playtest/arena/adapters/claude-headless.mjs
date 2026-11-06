// Claude Code headless seat turns (`claude -p … --output-format stream-json --verbose`) and the terminal-like chat render.
// DESIGN §4.1. One session per seat: first turn --session-id, then --resume.
import { run, start } from '../../lib/proc.mjs';

// The ordinary shell verbs a human would approve for their own agent in its own folder; a compound command is allowed
// only when every part is (so echo/mkdir/cp/chmod/head/tail/grep/wc/date/sleep/true/mv/touch/rm-free list matters).
export const DEFAULT_ALLOWED = ['Bash(node eden.mjs:*)', 'Bash(node eden-agent.mjs:*)', 'Bash(node eden-god.mjs:*)', 'Bash(node --version)', 'Bash(curl:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mkdir:*)',
  'Bash(pwd:*)', 'Bash(test:*)', 'Bash(cp:*)', 'Bash(mv:*)', 'Bash(touch:*)', 'Bash(chmod:*)', 'Bash(echo:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(grep:*)', 'Bash(wc:*)', 'Bash(date:*)', 'Bash(sleep:*)', 'Bash(true)', 'Bash(cd:*)',
  'Read(./**)', 'Write(./**)', 'Edit(./**)'];

let effortSupport = null;
/** Whether the installed CLI accepts --effort (checked once from `claude --help`). */
export async function supportsEffort() {
  if (effortSupport !== null) return effortSupport;
  const r = await run('claude', ['--help'], { maxWallMs: 20000 });
  effortSupport = /--effort\b/.test(r.stdout + r.stderr);
  return effortSupport;
}

export function buildArgs({ sessionId, resume, model, effort, text, allowedTools = DEFAULT_ALLOWED, effortOk = false }) {
  const args = ['-p', text, '--model', model, resume ? '--resume' : '--session-id', sessionId, '--setting-sources', 'project', '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}', '--output-format', 'stream-json', '--verbose'];
  if (effort && effortOk) args.push('--effort', effort);
  if (allowedTools.length) args.push('--allowedTools', ...allowedTools);
  return args;
}

/** A turn's closing result event (a resumed session can emit an early empty one: num_turns 0, stop_reason null). */
export const isFinalResult = (e) => e?.type === 'result' && (e.stop_reason != null || (e.num_turns ?? 0) > 0 || e.subtype !== 'success');

export function parseLine(line) { if (!line.trim()) return null; try { return JSON.parse(line); } catch { return { type: 'unparsed', raw: line.slice(0, 2000) }; } }

/** From a turn's stream: {usage:{inputTokens, cachedTokens, cacheCreationTokens, outputTokens, costUsd}, finalText, sessionId, toolCalls}. */
export function summarize(stream) {
  const result = stream.findLast((e) => e?.type === 'result') ?? null;
  const u = result?.usage ?? {};
  const usage = result ? { inputTokens: u.input_tokens ?? 0, cachedTokens: u.cache_read_input_tokens ?? 0, cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0, costUsd: result.total_cost_usd ?? null } : null;
  const lastText = stream.filter((e) => e?.type === 'assistant').flatMap((e) => e.message?.content ?? []).filter((c) => c.type === 'text').at(-1)?.text ?? null;
  const sessionId = result?.session_id ?? stream.find((e) => e?.session_id)?.session_id ?? null;
  return { usage, finalText: result?.result ?? lastText, sessionId, toolCalls: toolCalls(stream), resultSubtype: result?.subtype ?? null, isError: result?.is_error ?? null };
}

/** [{id, name, cmd, input, result, isError, ms}] pairing tool_use with tool_result; ms from harness receive stamps (_rx) when present. */
export function toolCalls(stream) {
  const calls = new Map();
  for (const e of stream) {
    if (e?.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use') calls.set(c.id, { id: c.id, name: c.name, cmd: c.input?.command ?? c.input?.file_path ?? null, input: c.input, result: null, isError: null, ms: null, _t0: e._rx ?? null });
    if (e?.type === 'user') for (const c of e.message?.content ?? []) if (c.type === 'tool_result' && calls.has(c.tool_use_id)) {
      const k = calls.get(c.tool_use_id); k.result = resultText(c.content); k.isError = !!c.is_error; if (k._t0 != null && e._rx != null) k.ms = e._rx - k._t0;
    }
  }
  return [...calls.values()].map(({ _t0, ...k }) => k);
}
const resultText = (content) => typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c.text ?? '').join('\n') : String(content ?? '');

const toolLabel = (c) => {
  const i = c.input ?? {};
  const arg = i.command ?? i.file_path ?? i.pattern ?? i.url ?? i.description ?? '';
  return `${c.name}(${String(arg).replace(/\s+/g, ' ').slice(0, 160)})`;
};
const firstLine = (s) => { const l = String(s ?? '').split('\n').find((x) => x.trim()) ?? ''; return l.length > 160 ? l.slice(0, 157) + '…' : l; };

/** renderChat(streamEvents) → markdown, as a terminal shows it. A `{type:"harness_user", text}` event marks what the human typed. */
export function renderChat(stream) {
  const out = [], results = new Map();
  for (const e of stream) if (e?.type === 'user') for (const c of e.message?.content ?? []) if (c.type === 'tool_result') results.set(c.tool_use_id, c);
  for (const e of stream) {
    if (e?.type === 'harness_user') out.push(`> ${String(e.text).split('\n').join('\n> ')}`);
    else if (e?.type === 'assistant') for (const c of e.message?.content ?? []) {
      if (c.type === 'text' && c.text.trim()) out.push(`⏺ ${c.text.trim()}`);
      else if (c.type === 'tool_use') { const r = results.get(c.id); out.push(`⏺ ${toolLabel(c)}\n  ⎿  ${r ? (r.is_error ? 'Error: ' : '') + firstLine(resultText(r.content)) : '(no result)'}`); }
    }
    else if (e?.type === 'result' && e.subtype !== 'success') out.push(`⏺ [turn ended: ${e.subtype}]`);
    else if (e?.type === 'harness_timeout') out.push(`⏺ [turn killed after ${e.maxWallSec}s]`);
  }
  return out.join('\n\n') + '\n';
}

/** turn({cwd, sessionId, resume, model, effort, text, allowedTools, maxWallSec}) → {stream, usage, finalText, sessionId, exit, wallMs, timedOut, toolCalls, effortApplied} */
export async function turn({ cwd, sessionId, resume = false, model = 'haiku', effort = null, text, allowedTools = DEFAULT_ALLOWED, maxWallSec = 240, resultGraceMs = 3000 }) {
  const effortOk = effort ? await supportsEffort() : false;
  const args = buildArgs({ sessionId, resume, model, effort, text, allowedTools, effortOk });
  // CLAUDE_CODE_DISABLE_CLAUDE_MDS: a seat must not load the user's or a parent folder's CLAUDE.md (--setting-sources does not stop it).
  const env = { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1' }; delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;
  const stream = [{ type: 'harness_user', text, _rx: Date.now() }];
  // `claude -p` does not exit while the agent's own background Bash tasks (its `listen`) run: the turn is over at the final
  // result event, so after a short grace the harness ends the process group (the wake loop's listen takes over).
  let grace = null, endedAfterResult = false;
  const h = startTurn('claude', args, { cwd, env, maxWallSec, onLine: (l) => {
    const e = parseLine(l); if (!e) return; e._rx = Date.now(); stream.push(e);
    if (grace && e.type === 'assistant') { clearTimeout(grace); grace = null; }
    if (isFinalResult(e)) { clearTimeout(grace); grace = setTimeout(() => { endedAfterResult = true; h.kill(); }, resultGraceMs); }
  } });
  const r = await h.done; clearTimeout(grace);
  const timedOut = r.timedOut && !endedAfterResult;
  if (timedOut) stream.push({ type: 'harness_timeout', maxWallSec, _rx: Date.now() });
  if (endedAfterResult) stream.push({ type: 'harness_end', reason: 'final result; background tasks ended', _rx: Date.now() });
  if (r.code !== 0 && r.stderr && !endedAfterResult) stream.push({ type: 'harness_stderr', text: r.stderr.slice(-2000), _rx: Date.now() });
  const s = summarize(stream);
  return { stream, usage: s.usage, finalText: s.finalText, sessionId: s.sessionId ?? sessionId, exit: endedAfterResult ? 0 : r.code, rawExit: r.code, wallMs: r.wallMs, timedOut, endedAfterResult,
    toolCalls: s.toolCalls, effortApplied: effort ? effortOk : null };
}

/** proc.run with an external kill handle: {done: Promise<{code, signal, stdout, stderr, wallMs, timedOut}>, kill()}. */
function startTurn(cmd, args, { cwd, env, maxWallSec, onLine }) {
  let killFn = () => {};
  const t0 = Date.now(); let timedOut = false;
  const done = new Promise((resolve) => {
    const p = start(cmd, args, { cwd, env, onLine, onExit: ({ code, signal, stdout, stderr }) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, wallMs: Date.now() - t0, timedOut }); } });
    const hardKill = () => { p.kill('SIGTERM'); setTimeout(() => p.kill('SIGKILL'), 5000); };
    killFn = hardKill;
    const timer = setTimeout(() => { timedOut = true; hardKill(); }, maxWallSec * 1000);
  });
  return { done, kill: () => killFn() };
}
/** H-g (#371): is the Claude CLI signed in? `claude auth status` exits 0 unless signed out; JSON output with
 *  `loggedIn: false` also fails. → {ok, exit}. Its output (account details) is read here and never kept. */
export async function authStatus({ runFn = run } = {}) {
  let r; try { r = await runFn('claude', ['auth', 'status'], { maxWallMs: 20000 }); } catch { return { ok: false, exit: null }; }
  let loggedIn = null; try { const j = JSON.parse(r.stdout ?? ''); if (typeof j?.loggedIn === 'boolean') loggedIn = j.loggedIn; } catch { /* plain text */ }
  return { ok: r.code === 0 && loggedIn !== false, exit: r.code ?? null };
}
export const name = 'claude-headless';
