// #1160's predeclared scorer: `node tools/soul-trace/report-2x2/score.mjs [dir]` reads <dir>/{off,on}-{1,2}/result.json, applies the four declared rules, prints JSON.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const dir = resolve(process.argv[2] ?? '.local/report/x22b');
const load = (arm, rep) => JSON.parse(readFileSync(join(dir, `${arm}-${rep}`, 'result.json'), 'utf8'));
const off = [load('off', 1), load('off', 2)], on = [load('on', 1), load('on', 2)], all = [...off, ...on];
const misses = [], check = (rule, ok, what) => { if (!ok) misses.push(`${rule}: ${what}`); return !!ok; };
const shape = (r) => JSON.stringify({ steps: Object.fromEntries(Object.entries(r.steps).filter(([k]) => k !== 'note').sort()), planEnded: r.planEnded, planSteps: r.planSteps });
const R1 = all.every((r) => check('R1', shape(r) === shape(off[0]), `${r.arm}-${r.rep} differs from off-1: ${shape(r)}`)) && check('R1', off[0].planEnded === 'done' && off[0].steps.walk.phase === 'completed' && !!off[0].steps.refused.code, 'the episode itself');
const R2 = off.every((r) => check('R2', r.reportFile === false && r.helpHasNote === false, `${r.arm}-${r.rep}`)) && on.every((r) => check('R2', r.helpHasNote === true, `${r.arm}-${r.rep}`));
const R3 = on.every((r) => check('R3', r.reportFile === true && Array.isArray(r.anomalies) && r.anomalies.length === 0, `${r.arm}-${r.rep} anomalies`) && check('R3', r.actRows > 0 && r.actRows === r.actDistinct, `${r.arm}-${r.rep} act rows ${r.actRows}/${r.actDistinct}`) && check('R3', r.tokenInFile === false && r.hostInFile === false, `${r.arm}-${r.rep} token or host`));
// Rule 4: the arms' means differ by less than the larger difference between repeats of one arm, or by under 5 ms.
const mean = (a, k) => (a[0].medianMs[k] + a[1].medianMs[k]) / 2, spread = (a, k) => Math.abs(a[0].medianMs[k] - a[1].medianMs[k]);
const overhead = Object.fromEntries(['here', 'pending', 'act'].map((k) => [k, { off: off.map((r) => r.medianMs[k]), on: on.map((r) => r.medianMs[k]), armDiff: Math.abs(mean(off, k) - mean(on, k)), repeatDiff: Math.max(spread(off, k), spread(on, k)) }]));
const R4 = Object.entries(overhead).every(([k, v]) => check('R4', v.armDiff < v.repeatDiff || v.armDiff < 5, `${k}: arm ${v.armDiff}, repeat ${v.repeatDiff}`));
const rules = { R1, R2, R3, R4 }, pass = Object.values(rules).every(Boolean);
console.log(JSON.stringify({ pass, rules, misses, errors: all.map((r) => r.error).filter(Boolean), overhead, report: on.map((r) => ({ records: r.records, bytes: r.bytes, anomalies: r.anomalies?.length, actRows: r.actRows, actDistinct: r.actDistinct })), helpBytes: all.map((r) => r.helpBytes), times: all.map((r) => ({ arm: r.arm, rep: r.rep, startedAt: r.startedAt, finishedAt: r.finishedAt ?? null })) }, null, 1));
process.exit(pass ? 0 : 1);
