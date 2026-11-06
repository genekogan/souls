// One Soul seat: an empty folder + identity seed, one agent session for the whole run, and Claude Code's
// background-task plumbing played by the harness (the wake loop). DESIGN §4.1, §6.
// The harness writes `.eden-agent.json` ONLY before register (the identity seed) and never reads it.
import { join } from 'node:path';
import { mkdirSync, readdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { run, start } from '../lib/proc.mjs';
import { appendJsonl, writeJson, readJson, readJsonl } from '../lib/jsonl.mjs';
import { newIdentity } from '../lib/hash.mjs';
import { now, sleep } from '../lib/clock.mjs';
import * as claude from './adapters/claude-headless.mjs';
import * as codex from './adapters/codex-headless.mjs';
import * as scriptedOwner from './adapters/scripted-owner.mjs';
import { worldBudgetFor } from './world-budget.mjs';

export const ADAPTERS = { 'claude-headless': claude, 'codex-headless': codex, 'scripted-owner': scriptedOwner };
export const LIVE_ADAPTERS = new Set(['claude-headless', 'codex-headless']);
export const onboardingText = (base, name) => `Make me a Soul in this world: ${base}/ . Call it ${name}. Start from ${base}/instructions.md.`;
export const wakeText = (cmdLine, stdout) => `[background task] ${cmdLine} exited with output:\n${stdout}`;

/** The Soul CLI's listen prints {messages:[...], next}; the god CLI's prints {inbox:{latest}}. → [{id, text}] */
export function listenMessages(stdout) {
  let d = null; try { d = JSON.parse(stdout); } catch { return []; }
  if (Array.isArray(d?.messages)) return d.messages;
  const l = d?.inbox?.latest; return l && l.state !== 'acknowledged' ? [l] : [];
}

const parseJsonStatus = (stdout, code) => { try { return { ok: code === 0, data: JSON.parse(stdout) }; } catch { return { ok: false, reason: stdout.slice(0, 300) }; } };
/** chat-as-rendered.md → [{turn, text}] split at the `<!-- turn N (...) -->` markers each turn writes. */
export function splitRendered(md) {
  const out = [], re = /\n?<!-- turn (\d+) [^>]*-->\n/g; let m, last = null;
  while ((m = re.exec(md))) { if (last) last.text = md.slice(last.start, m.index); last = { turn: Number(m[1]), start: m.index }; out.push(last); }
  if (last) last.text = md.slice(last.start);
  return out.map(({ turn, text }) => ({ turn, text }));
}

export const SOUL_CLI = { file: 'eden.mjs', fallbackFile: 'eden-agent.mjs', listen: (after) => ['listen', ...(after ? ['--after', after] : [])], status: ['status'], parseStatus: parseJsonStatus };

export class Seat {
  constructor({ dir, seat, worldBase, rails = {}, cli = SOUL_CLI, allowedTools, kind = 'soul', budget = null }) {
    this.dir = dir; this.folder = join(dir, 'folder'); this.seat = seat; this.base = worldBase; this.kind = kind; this.cli = cli;
    this.adapter = ADAPTERS[seat.adapter ?? 'claude-headless']; if (!this.adapter) throw new Error(`unknown adapter ${seat.adapter}`);
    this.rails = { maxTurnsPerRequest: 6, maxTurnWallSec: 240, ...rails };
    // 2026-10-26 (round 2): seats sometimes call the CLI by its absolute path and write the skill under .claude/; both were
    // refused by the allowlist and the seat never paired (fix-d3d trio r1, round2 run 1). Allow them for this folder only.
    this.allowedTools = [...(allowedTools ?? claude.DEFAULT_ALLOWED), `Bash(node ${this.folder}/eden.mjs:*)`, `Bash(node ${this.folder}/eden-agent.mjs:*)`,
      `Write(${this.folder}/.claude/**)`, `Edit(${this.folder}/.claude/**)`, 'Write(./.claude/**)', 'Edit(./.claude/**)'];
    this.turnN = 0; this.chain = Promise.resolve(); this.listener = null; this.waking = false; this.stopped = false;
    this.lastListenId = null; this.wakesSinceRequest = 0; this.cumulative = null; this.listenFailures = 0;
    // #1098: live model turns reserve their worst case from the run's world budget before the call (scripted seats spend nothing)
    this.budget = LIVE_ADAPTERS.has(seat.adapter ?? 'claude-headless') ? budget : null; this.budgetRefused = null;
    this.info = readJson(join(dir, 'seat.json'), null) ?? { id: seat.id, kind, adapter: seat.adapter ?? 'claude-headless', model: seat.model ?? null, effort: seat.effort ?? null,
      soulName: seat.soulName ?? null, worldBase, folder: this.folder, createdAt: now().t, sessionId: null, soulId: null, ownerIdentity: null, assisted: false,
      wake: (seat.adapter ?? 'claude-headless') === 'codex-headless' ? seat.wake === true : seat.wake !== false };
  }
  save() { writeJson(join(this.dir, 'seat.json'), this.info); }
  get sessionId() { return this.info.sessionId; }
  /** Number of completed turns (as recorded in turns.jsonl, so it survives a harness restart). */
  turnCount() { return readJsonl(join(this.dir, 'turns.jsonl')).length; }
  /** Markdown of chat-as-rendered.md for the turns after turnIndex (0 → everything). */
  renderedChatSince(turnIndex = 0) {
    const f = join(this.dir, 'chat-as-rendered.md'); if (!existsSync(f)) return '';
    return splitRendered(readFileSync(f, 'utf8')).filter((b) => b.turn > turnIndex).map((b) => b.text).join('');
  }

  /** Run the seat's own CLI in its folder (read-only commands only: status). Never logs credentials: these print none. */
  async cliJson(args, maxWallMs = 20000) {
    const file = existsSync(join(this.folder, this.cli.file)) ? this.cli.file : this.cli.fallbackFile && existsSync(join(this.folder, this.cli.fallbackFile)) ? this.cli.fallbackFile : null;
    if (!file) return { ok: false, reason: `no ${this.cli.file} in folder` };
    const r = await run('node', [file, ...args], { cwd: this.folder, maxWallMs });
    return { file, ...(this.cli.parseStatus ?? parseJsonStatus)(r.stdout, r.code, r.stderr) };
  }
  status() { return this.cliJson(this.cli.status); }

  // Measurement setup uses one frozen transport in both arms; the model still receives its world's served CLI.
  async fixtureCliJson(args, maxWallMs = 20000) {
    const file = fileURLToPath(new URL('../../../tools/world-launcher/soul/eden.mjs', import.meta.url));
    const r = await run('node', [file, ...args], { cwd: this.folder, maxWallMs });
    return { file, ...parseJsonStatus(r.stdout, r.code) };
  }

  /** One agent turn through the adapter; serialized; writes turns/transcript/cost/chat files.
   *  onStart({turn, reason, startedAt, startMono}) is called when this turn actually starts (after any running turn). */
  chat(text, { reason = 'chat', onStart = null } = {}) {
    if (reason === 'chat') this.noteRequest();
    const p = this.chain.then(() => this._turn(text, reason, onStart));
    this.chain = p.catch(() => {});
    return p;
  }
  noteRequest() { this.wakesSinceRequest = 0; }

  async _turn(text, reason, onStart = null) {
    if (this.stopped && reason !== 'final') throw new Error('seat stopped');
    // Fidelity: Claude Code keeps a background `listen` alive across turns, so the harness one keeps running during a turn.
    // The agent's own `listen` supersedes it (the old one prints `listen: superseded` and exits); ours restarts at turn end.
    this.inTurn = true;
    const n = ++this.turnN, started = now();
    try { onStart?.({ turn: n, reason, startedAt: started.t, startMono: started.mono }); } catch { /* observer hook is best effort */ }
    const hold = this.budget ? this.budget.reserve(this.seat.id) : null;
    if (hold && !hold.ok) {   // #1098: refused before any provider call; recorded as a turn with no model use
      const ended = now(); this.budgetRefused = hold.reason; this.inTurn = false;
      const rec = { turn: n, reason, startedAt: started.t, endedAt: ended.t, startMono: started.mono, endMono: ended.mono, wallMs: 0, usage: null, finalText: null, toolCalls: [], exit: null, timedOut: false, endedAfterResult: null, refused: 'world-budget', refusedReason: hold.reason };
      appendJsonl(join(this.dir, 'turns.jsonl'), rec);
      if (this.waking && !this.stopped) this.startListen();
      return rec;
    }
    const first = !this.info.sessionId;
    if (first && this.info.adapter === 'claude-headless') { this.info.sessionId = randomUUID(); this.save(); }
    let r;
    try {
      r = await this.adapter.turn({ cwd: this.folder, sessionId: this.info.sessionId, resume: !first, model: this.info.model ?? undefined, effort: this.info.effort,
        text, allowedTools: this.allowedTools, maxWallSec: this.rails.maxTurnWallSec, prevCumulative: this.cumulative, script: this.seat.script,
        ...(hold ? { maxBudgetUsd: this.budget.turnCapUsd } : {}) });
    } catch (e) { if (hold) this.budget.settle(hold, null); throw e; }
    const ended = now();
    // #1098: `claude -p --resume` reports total_cost_usd for the whole session so far, so this turn's cost is the difference
    // from the session's last total (a crashed turn can report zero: then its cost is unknown and the whole reservation counts).
    const sessionCost = this.info.adapter === 'claude-headless' ? r.usage?.costUsd ?? null : null;
    let turnCost = r.usage?.costUsd ?? null;
    if (sessionCost != null) {
      const sid = r.sessionId ?? this.info.sessionId, prev = this.info.sessionCostUsd?.[sid] ?? 0;
      turnCost = sessionCost >= prev ? sessionCost - prev : null;
      this.info.sessionCostUsd = { ...(this.info.sessionCostUsd ?? {}), [sid]: Math.max(prev, sessionCost) };
    }
    if (hold) this.budget.settle(hold, turnCost);
    if (r.cumulative) this.cumulative = r.cumulative;
    if (r.sessionId && r.sessionId !== this.info.sessionId) { this.info.sessionId = r.sessionId; }
    if (this.info.effortApplied === undefined && r.effortApplied !== null) this.info.effortApplied = r.effortApplied;
    this.save();
    for (const e of r.stream) appendJsonl(join(this.dir, 'transcript.jsonl'), { turn: n, ...e });
    const rec = { turn: n, reason, startedAt: started.t, endedAt: ended.t, startMono: started.mono, endMono: ended.mono, wallMs: r.wallMs, usage: r.usage ? { ...r.usage, costUsd: turnCost, ...(sessionCost != null ? { sessionCostUsd: sessionCost } : {}) } : r.usage, finalText: r.finalText,
      toolCalls: r.toolCalls.map((c) => ({ cmd: c.cmd ?? c.name, ms: c.ms, isError: c.isError })), exit: r.exit, timedOut: r.timedOut, endedAfterResult: r.endedAfterResult ?? null };
    appendJsonl(join(this.dir, 'turns.jsonl'), rec);
    const u = r.usage ?? {};
    appendJsonl(join(this.dir, 'cost.jsonl'), { t: ended.t, mono: ended.mono, turn: n, inputTokens: u.inputTokens ?? null, cachedTokens: u.cachedTokens ?? null,
      cacheCreationTokens: u.cacheCreationTokens ?? null, outputTokens: u.outputTokens ?? null, ...(turnCost != null ? { costUsd: turnCost } : {}), ...(sessionCost != null ? { sessionCostUsd: sessionCost } : {}),
      ...(hold ? { reservedUsd: hold.usd } : {}) });
    writeFileSync(join(this.dir, 'chat-as-rendered.md'), `\n<!-- turn ${n} (${reason}) ${started.t} -->\n\n${this.adapter.renderChat(r.stream)}`, { flag: 'a' });
    this.inTurn = false;
    if (this.waking && !this.stopped) this.startListen();
    return rec;
  }

  /** Onboarding turn (§6) + poll `status` for paired, up to timeoutSec from the turn's start. Never pairs on the agent's behalf
   *  unless assist is set (harness debugging only, recorded as assisted:true). */
  async onboard({ text, timeoutSec = 180, assist = false, maxWallSec = null } = {}) {
    const name = this.info.soulName ?? this.seat.id;
    text ??= onboardingText(this.base, name);
    const t0 = Date.now();
    if (assist) await this.assistPair(name);
    // Onboarding is one long turn (fetch, register, create, approval wait); it gets its own wall cap.
    const savedCap = this.rails.maxTurnWallSec;
    if (maxWallSec) this.rails.maxTurnWallSec = Math.max(savedCap ?? 0, maxWallSec);
    // The onboarding turn may end unpaired with time left (seen 2026-10-25: a seat found a seeded `.eden-agent.json`,
    // read "reuse that Soul", saw paired: false and stopped). Then it gets a nudge that quotes the status and asks it to
    // finish, up to two more turns inside the same timeout. Each nudge is a recorded turn (reason onboard-nudge).
    let paired = null, pairedMs = null, last = null, turn = null, attempts = 0;
    const nudge = () => `Onboarding is not finished. Run one command per call from this folder with relative paths (\`node eden.mjs …\`), no cd and no && chains. \`node eden.mjs status\` shows ${JSON.stringify(last ?? {}).slice(0, 300)}. Run the \`next\` command it prints (register, then create the Soul "${name}"), keep going until status shows paired: true, then start listening as the instructions say. Do not stop to ask me anything.`;
    while (!paired && attempts < 3 && (attempts === 0 || Date.now() - t0 < timeoutSec * 1000)) {
      attempts += 1;
      let ended = false;
      const turnP = this.chat(attempts === 1 ? text : nudge(), { reason: attempts === 1 ? 'onboard' : 'onboard-nudge' }).catch((e) => ({ error: String(e) })).finally(() => { ended = true; });
      while (Date.now() - t0 < timeoutSec * 1000) {
        const s = await this.status(); last = s.data ?? s.reason;
        if (s.ok && s.data?.paired && (this.kind === 'god' || s.data?.soul?.id)) { paired = s.data; pairedMs = Date.now() - t0; break; }
        if (ended) break;
        await sleep(3000);
      }
      turn = await turnP;
      if (!paired) { const s = await this.status(); last = s.data ?? s.reason; if (s.ok && s.data?.paired && (this.kind === 'god' || s.data?.soul?.id)) { paired = s.data; pairedMs = Date.now() - t0; } }
    }
    this.rails.maxTurnWallSec = savedCap;
    this.info.onboard = { ok: !!paired, pairedWithinSec: paired ? Math.round(pairedMs / 1000) : null, timeoutSec, onboardTurnWallMs: turn?.wallMs ?? null, attempts,
      cliFile: paired ? (existsSync(join(this.folder, this.cli.file)) ? this.cli.file : this.cli.fallbackFile) : null, lastStatus: paired ? null : last };
    if (paired && paired.soul) { this.info.soulId = paired.soul.id; this.info.soulName = paired.soul.name ?? name; }
    this.save();
    return { ok: !!paired, soulId: this.info.soulId, soulName: this.info.soulName, turn, status: paired ?? last };
  }

  /** --assist-onboard: fetch eden.mjs and run register+create in the folder (outputs discarded unread except exit codes). */
  async assistPair(name) {
    this.info.assisted = true; this.save();
    const r0 = await run('curl', ['-fsSo', 'eden.mjs', `${this.base}/eden.mjs`], { cwd: this.folder, maxWallMs: 20000 });
    const r1 = await run('node', ['eden.mjs', 'register', this.base], { cwd: this.folder, maxWallMs: 30000 });
    const r2 = await run('node', ['eden.mjs', 'create', name], { cwd: this.folder, maxWallMs: 60000 });
    this.info.assistExit = { fetch: r0.code, register: r1.code, create: r2.code }; this.save();
  }

  /** Keep `listen [--after <lastId>]` running between turns; a listen that exits with messages becomes a wake turn. */
  wakeLoop() { if (!this.info.wake) return false; this.waking = true; this.startListen(); return true; }
  startListen() {
    if (this.listener || this.stopped || !this.waking) return;
    const file = existsSync(join(this.folder, this.cli.file)) ? this.cli.file : this.cli.fallbackFile;
    const args = [file, ...this.cli.listen(this.lastListenId)];
    const cmdLine = `node ${args.join(' ')}`;
    const startedAt = now();
    const h = start('node', args, { cwd: this.folder, onExit: ({ code, signal, stdout, stderr }) => {
      const killed = h.killedByUs; if (this.listener === h) this.listener = null;
      const msgs = listenMessages(stdout);
      appendJsonl(join(this.dir, 'listen.jsonl'), { ...now(), startMono: startedAt.mono, cmd: cmdLine, code, signal, killedByUs: !!killed, messages: msgs.map((m) => m.id), stdout: killed ? undefined : stdout, stderr: stderr.slice(-500) || undefined });
      if (killed || this.stopped) return;
      if (/superseded/i.test(stdout)) { this.supersededAt = Date.now(); if (!this.inTurn) setTimeout(() => this.startListen(), 2000); return; }
      if (msgs.length) {
        this.listenFailures = 0; this.lastListenId = msgs.at(-1).id;
        if (++this.wakesSinceRequest > this.rails.maxTurnsPerRequest) { this.info.wakeCapped = (this.info.wakeCapped ?? 0) + 1; this.save(); return; }
        this.chat(wakeText(cmdLine, stdout), { reason: 'wake' }).catch(() => {});
      } else {
        // Exited without messages (god listen timeout, or an error): restart, backing off on errors.
        const delay = code === 0 ? 200 : Math.min(30000, 1000 * 2 ** this.listenFailures++);
        setTimeout(() => this.startListen(), delay);
      }
    } });
    this.listener = h;
  }
  stopListen() { const h = this.listener; if (h) { h.killedByUs = true; this.listener = null; h.kill(); } }
  /** Ends listen, no more turns (waits for an in-flight turn). */
  async stop() { this.stopped = true; this.waking = false; this.stopListen(); await this.chain; }
  /** Kept worlds only: retire the Soul as its owner. */
  async retire() {
    if (!this.info.soulId || !this.info.ownerIdentity) return { ok: false };
    const r = await fetch(`${this.base}/v1/souls/${encodeURIComponent(this.info.soulId)}`, { method: 'DELETE', headers: { authorization: `Bearer dev:${this.info.ownerIdentity}` } });
    return { ok: r.ok, status: r.status };
  }
}

/** createSeat({runDir, seat, worldBase, rails}) → Seat: an empty folder holding only the identity seed. */
export function createSeat({ runDir, seat, worldBase, rails }) {
  const dir = join(runDir, 'seats', seat.id);
  const budget = worldBudgetFor(runDir, { capUsd: rails?.worldBudgetUsd, turnCapUsd: rails?.turnBudgetUsd });   // one per run (one world)
  const s = new Seat({ dir, seat, worldBase, rails, budget });
  mkdirSync(s.folder, { recursive: true });
  if (!s.info.ownerIdentity) {
    if (readdirSync(s.folder).length) throw new Error(`seat folder not empty: ${s.folder}`);
    const identity = newIdentity();
    writeFileSync(join(s.folder, '.eden-agent.json'), JSON.stringify({ identity }) + '\n', { mode: 0o600 });
    s.info.ownerIdentity = identity;
  }
  s.save();
  return s;
}
