// #1160's predeclared 2x2 (second declaration, on #590): reports off or on, 2 repeats each, one fake-mind world and one Soul per run. No model.
//   node tools/soul-trace/report-2x2/x22.mjs <off|on> <repeat>
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startWorld, stopWorld } from '../../playtest/arena/provision.mjs';
import { reconstruct } from '../readout.mjs';
const [arm, rep] = process.argv.slice(2);
if (!['off', 'on'].includes(arm) || !rep) throw new Error('usage: x22.mjs <off|on> <repeat>');
const out = resolve(`.local/report/x22b/${arm}-${rep}`); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const port = 4474, slug = 'reports', dir = join(out, 'ada'); mkdirSync(dir);
copyFileSync('tools/world-launcher/soul/eden.mjs', join(dir, 'eden.mjs'));
writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ identity: `agent-${randomBytes(12).toString('hex')}` }), { mode: 0o600 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ms = [];
const eden = (...a) => new Promise((ok) => { const t = performance.now(); execFile(process.execPath, ['eden.mjs', ...a], { cwd: dir, timeout: 120_000 }, (e, so) => { const took = performance.now() - t; ms.push({ cmd: a[0], ms: took }); let json = null; try { json = JSON.parse(so); } catch {} ok({ exit: e ? e.code : 0, out: so, json, ms: took }); }); });
const keys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort() : null);
const w = await startWorld({ serverRoot: resolve('.'), slug, port, genesis: 'worlds/templates/hello-hamlet.json', dataDir: join(out, 'data'), log: join(out, 'world.log') });
const R = { arm, rep, startedAt: new Date().toISOString(), steps: {} }, step = (k, r, extra = {}) => { R.steps[k] = { exit: r.exit, keys: keys(r.json), ...extra }; };
try {
  await eden('register', w.base); step('create', await eden('create', 'Ada'));
  if (arm === 'on') writeFileSync(join(dir, '.eden-report-on'), '');
  const help = await eden('help'); R.helpBytes = Buffer.byteLength(help.out); R.helpHasNote = help.out.includes('note "');
  step('here', await eden('here'));
  const refused = await eden('act', 'walk:nowhere-at-all', '--for', 'none'); step('refused', refused, { code: refused.json?.code });
  const walk = await eden('act', 'walk:cottage', '--wait', '60', '--for', 'none'); step('walk', walk, { phase: walk.json?.receipt?.phase });
  if (arm === 'on') step('note', await eden('note', 'a short walk', 'it took a while'));
  step('serve', await eden('serve')); step('here-serve', await eden('here'));
  const plan = await eden('plan', '["walk:flag-orchard","wave:here"]', '--for', 'none'); step('plan', plan, { accepted: plan.json?.accepted });
  let ended = null; for (let i = 0; i < 120 && !ended; i++) { ended = (await eden('pending')).json?.planEnded?.[0] ?? null; if (!ended) await sleep(1000); }
  R.planEnded = ended?.state ?? null; R.planSteps = ended?.steps?.map((s) => s.state) ?? null;
  await eden('serve', '--stop'); await sleep(1000);
  R.finishedAt = new Date().toISOString();
  const file = join(dir, '.eden-report.jsonl');
  R.reportFile = existsSync(file);
  if (R.reportFile) {
    const raw = readFileSync(file, 'utf8'), rows = raw.trim().split('\n').map((l) => JSON.parse(l)), t = reconstruct(raw), token = JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8')).token;
    R.records = rows.length; R.bytes = Buffer.byteLength(raw); R.anomalies = t.anomalies; R.tokenInFile = !!token && raw.includes(token); R.hostInFile = raw.includes(new URL(w.base).hostname);
    const actReceipts = rows.filter((r) => r.route === '/v1/edge/act').map((r) => r.facts?.receipt?.id).filter(Boolean); R.actRows = actReceipts.length; R.actDistinct = new Set(actReceipts).size;
  }
} catch (e) { R.error = e.stack; }
finally { await stopWorld({ pid: w.pid }); }
const q = (cmd) => { const v = ms.filter((m) => m.cmd === cmd).map((m) => m.ms).sort((a, b) => a - b); return v.length ? Math.round(v[v.length >> 1]) : null; };
R.medianMs = { here: q('here'), pending: q('pending'), act: q('act') }; R.pendingPolls = ms.filter((m) => m.cmd === 'pending').length;
writeFileSync(join(out, 'result.json'), JSON.stringify(R, null, 1));
console.log(JSON.stringify({ ...R, steps: undefined, anomalies: R.anomalies?.length })); process.exit(0);
