#!/usr/bin/env node
// The resident client's unattended run (#1096 A5): a local fake-mind world, one Soul, one `serve`, owner messages on a clock
// and a model-free "agent" that wakes on a clock, reads `pending`, answers and sometimes acts. Halfway it kills the serve with
// SIGKILL and starts it again. It writes soak.json: messages sent against received, acts against receipts, body states.
// A held `listen` runs like a seat's, stopped during a busy turn like a seat's, so a message that a `wait` peeks at while it is down
// must still reach it when it comes back (A6 found that one: the old soak read only `pending`, and never saw a seat miss "Your turn").
//   node tools/playtest/serve-soak.mjs --server-root <checkout with a web build> --port 4390 --hours 4 --out .local/soak-1
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { startWorld, stopWorld } from './arena/provision.mjs';
import { sendCard, publicSoul } from './arena/owner.mjs';

const flag = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const hours = Number(flag('hours', 4)), port = Number(flag('port', 4390)), serverRoot = resolve(flag('server-root', '.'));
const out = resolve(flag('out', `.local/serve-soak-${Date.now()}`)), messageEvery = Number(flag('message-every', 120)) * 1000, turnEvery = Number(flag('turn-every', 60)) * 1000, actEvery = Number(flag('act-every', 600)) * 1000, busyEvery = Number(flag('busy-every', 420)) * 1000, sampleEvery = 30_000;
const cliSource = flag('cli') ? resolve(flag('cli')) : fileURLToPath(new URL('../world-launcher/soul/eden.mjs', import.meta.url));
const folder = join(out, 'folder'); mkdirSync(folder, { recursive: true });
const line = (o) => appendFileSync(join(out, 'soak.jsonl'), JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eden = (...args) => new Promise((done) => execFile(process.execPath, ['eden.mjs', ...args], { cwd: folder, timeout: 120_000, maxBuffer: 1 << 24 }, (e, stdout, stderr) => { let json = null; try { json = JSON.parse(stdout); } catch { /* text */ } done({ code: e?.code ?? 0, json, err: String(stderr).slice(0, 300) }); }));

const identity = `agent-${randomBytes(12).toString('hex')}`, slug = 'serve-soak';
writeFileSync(join(folder, '.eden-agent.json'), JSON.stringify({ identity }) + '\n', { mode: 0o600 });
copyFileSync(cliSource, join(folder, 'eden.mjs'));
const w = await startWorld({ serverRoot, slug, port, genesis: flag('genesis', 'worlds/templates/hello-hamlet.json'), dataDir: join(out, 'data'), log: join(out, 'world.log') });
const base = `http://127.0.0.1:${port}/w/${slug}`;
await eden('register', base);
const made = await eden('create', 'Soak');
const soulId = made.json?.soul?.id; if (!soulId) throw new Error(`create failed: ${made.err}`);
let served = await eden('serve'); line({ ev: 'serve', pid: served.json?.pid });

const t0 = Date.now(), end = t0 + hours * 3600_000, killAt = t0 + hours * 1800_000;
const sent = new Map(), received = new Map(), acts = [], unexpectedReceipts = new Set(), bodies = {}, bad = [];
let nextBusy = t0 + 45_000, nextMsg = t0 + 5000, nextTurn = t0 + 10_000, nextAct = t0 + 30_000, nextSample = t0, killed = false, down = null, n = 0, turns = 0, gaps = 0, seenReceipts = new Set(), targets = ['walk:flag-orchard', 'walk:lab-pond-hall'];

// The seat's listener: one `listen --after <last>` at a time, relaunched when it ends, as the harness keeps one.
const heard = new Map(); let listenAfter = null, listener = null, listening = false;
function startListener() {
  if (listening) return; listening = true;
  const go = () => {
    if (!listening) return;
    const child = spawn(process.execPath, ['eden.mjs', 'listen', ...(listenAfter ? ['--after', listenAfter] : [])], { cwd: folder, stdio: ['ignore', 'pipe', 'ignore'] });
    let so = ''; child.stdout.on('data', (b) => { so += b; }); listener = child;
    child.on('exit', () => {
      let d = null; try { d = JSON.parse(so); } catch { /* killed, or superseded */ }
      for (const m of d?.messages ?? []) { if (!heard.has(m.text)) heard.set(m.text, Date.now()); listenAfter = m.id; }
      if (listener === child) listener = null;
      setTimeout(go, 200);
    });
  };
  go();
}
function stopListener() { listening = false; listener?.kill('SIGTERM'); }
const until = async (f, ms) => { const t1 = Date.now(); while (Date.now() - t1 < ms) { if (f()) return true; await sleep(250); } return false; };
const lateHeard = [];
/** A busy turn: the listener is down, the owner writes, a `wait` and a peek see the message, and only then does the listener return. */
async function busyTurn() {
  stopListener(); await sleep(500);
  n++; const text = `Soak message ${n}`, at = Date.now();
  try { const r = await sendCard({ base, soulId, identity, text }); sent.set(r?.id ?? r?.messageId ?? text, { text, at, busy: true }); } catch (e) { line({ ev: 'send-failed', err: String(e).slice(0, 200) }); }
  await sleep(1000);
  await eden('wait', '1'); await eden('listen', '--once');
  const back = Date.now(); startListener();
  if (!(await until(() => heard.has(text), 30_000))) { lateHeard.push({ text, sec: null }); line({ ev: 'not-heard-after-busy-turn', text }); } else if (heard.get(text) - back > 5000) lateHeard.push({ text, sec: Math.round((heard.get(text) - back) / 1000) });
}
async function agentTurn() {
  const p = await eden('pending'); turns++;
  if (!p.json) { line({ ev: 'pending-failed', err: p.err }); return; }
  if (p.json.gap) gaps++;
  for (const m of p.json.ownerMessages ?? []) {
    if (!received.has(m.id)) received.set(m.id, { text: m.text, at: Date.now() });
    if (!heard.has(m.text)) continue;   // an ack would end the listener's chance to hear it: leave it for the next turn
    await eden('ack', m.id, 'Got it');
    await eden('result', m.id, 'done', 'Noted');
  }
  for (const r of [...(p.json.openReceipts ?? []), ...(p.json.endedReceipts ?? [])]) { seenReceipts.add(r.id); if (!acts.some((a) => a.receipt === r.id)) unexpectedReceipts.add(r.id); }
}
startListener();
while (Date.now() < end) {
  const now = Date.now();
  if (!killed && now >= killAt) {
    killed = true; try { process.kill(served.json.pid, 'SIGKILL'); line({ ev: 'killed', pid: served.json.pid }); } catch (e) { line({ ev: 'kill-failed', err: String(e) }); }
    down = now + 30_000;
  }
  if (down && now >= down) { down = null; served = await eden('serve'); line({ ev: 'restarted', pid: served.json?.pid, err: served.err }); }
  if (now >= nextMsg) {
    nextMsg += messageEvery; n++;
    const text = `Soak message ${n}`;
    try { const r = await sendCard({ base, soulId, identity, text }); sent.set(r?.id ?? r?.messageId ?? text, { text, at: now }); } catch (e) { line({ ev: 'send-failed', err: String(e).slice(0, 200) }); }
  }
  if (now >= nextBusy && !down) { nextBusy += busyEvery; await busyTurn(); }
  if (now >= nextTurn && !down) { nextTurn += turnEvery; await agentTurn(); }
  if (now >= nextAct && !down) {
    nextAct += actEvery;
    const r = await eden('act', targets[acts.length % targets.length], '--for', 'none');
    acts.push({ at: now, accepted: r.json?.accepted ?? null, code: r.json?.code ?? null, receipt: r.json?.receipt?.id ?? null });
  }
  if (now >= nextSample) {
    nextSample += sampleEvery;
    try { const s = await publicSoul({ base, soulId }); const st = s?.body?.state ?? s?.soul?.body?.state ?? 'unknown'; const key = down ? `serve-down:${st}` : st; bodies[key] = (bodies[key] ?? 0) + 1; if (!down && ['zombie', 'asleep'].includes(st)) bad.push({ at: new Date().toISOString(), state: st }); } catch (e) { bodies.error = (bodies.error ?? 0) + 1; }
  }
  await sleep(500);
}
await sleep(2 * turnEvery); await agentTurn();
stopListener();
const status = await eden('serve', '--status');
const sentTexts = [...sent.values()].map((m) => m.text), gotTexts = [...received.values()].map((m) => m.text);
const report = {
  schema: 'serve-soak/2', hours, cli: (await eden('version')).json?.version, cliSha256: createHash('sha256').update(readFileSync(join(folder, 'eden.mjs'))).digest('hex'), startedAt: new Date(t0).toISOString(), endedAt: new Date().toISOString(),
  messages: { sent: sentTexts.length, received: gotTexts.length, missed: sentTexts.filter((t) => !gotTexts.includes(t)), duplicates: gotTexts.length - new Set(gotTexts).size, heardByListener: heard.size, notHeardByListener: sentTexts.filter((t) => !heard.has(t)), busyTurns: [...sent.values()].filter((m) => m.busy).length, slowAfterBusyTurn: lateHeard },
  acts: { issued: acts.length, accepted: acts.filter((a) => a.accepted).length, refused: acts.filter((a) => a.accepted === false).map((a) => a.code), receiptsSeen: seenReceipts.size, notIssuedByTheAgent: [...unexpectedReceipts] },
  body: { samples: bodies, zombieOrAsleepWhileServing: bad.length, examples: bad.slice(0, 5) },
  turns, streamGaps: gaps, killed, serveStatus: status.json,
};
report.pass = !report.messages.missed.length && !report.messages.duplicates && !report.messages.notHeardByListener.length && !lateHeard.length && !report.acts.notIssuedByTheAgent.length && report.acts.issued > 0 && report.acts.accepted === report.acts.issued && !report.body.zombieOrAsleepWhileServing && killed;
writeFileSync(join(out, 'soak.json'), JSON.stringify(report, null, 1) + '\n');
await eden('serve', '--stop');
await stopWorld({ pid: w.pid });
process.stdout.write(JSON.stringify({ pass: report.pass, out }) + '\n');
process.exit(report.pass ? 0 : 1);
