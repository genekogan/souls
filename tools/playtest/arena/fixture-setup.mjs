// Deterministic, physical setup outside the owner's measured request. Never teleports a body.
import { appendJsonl } from '../lib/jsonl.mjs';
import { join } from 'node:path';
export function checkStart(me, expected = {}) {
  const problems = [];
  const raw = Array.isArray(me?.pos) ? me.pos : me?.pos && [me.pos.x, me.pos.z];
  const p = Array.isArray(raw) && [2,3].includes(raw.length) && raw.every(Number.isFinite) ? raw : null;
  if (expected.pos && (!p || Math.hypot(p[0] - expected.pos[0], p[p.length - 1] - expected.pos[1]) > (expected.radiusM ?? 2))) problems.push('initial position outside frozen region');
  if (expected.heading != null && (!Number.isFinite(me?.heading) || Math.abs(((me.heading - expected.heading + 540) % 360) - 180) > (expected.headingToleranceDeg ?? 5))) problems.push('initial heading differs');
  if (expected.places && !expected.places.includes(me?.place)) problems.push('initial place differs');
  if (expected.posture && !expected.posture.includes(me?.posture)) problems.push('initial posture differs');
  return problems;
}
/** CTRL-1 (#1093): `act` takes offered ids. Setup is scaffolding, not the agent under test: its words go through `resolve`
 *  and it sends the first available candidate. A client without candidates (the baseline) gets the words, as before. */
async function offered(cli, intent, left) {
  const text = typeof intent === 'string' ? intent : JSON.stringify(intent);
  if (/^[a-z][\w-]*:\S+$/i.test(text)) return [text];
  const c = (await cli(['resolve', text], left)).data?.candidates?.find((x) => x.available);
  return c ? [c.id, ...(c.args ? [JSON.stringify(c.args)] : [])] : [text];
}
export async function runFixtureSetup({ seat, setup, runDir, requestKey, now = Date.now }) {
  const started = now(), end = started + (setup.maxWallSec ?? 120) * 1000;
  const cli = (seat.fixtureCliJson ?? seat.cliJson).bind(seat);
  const rows = []; let error = null, me = null;
  try {
    // Let the previous model turn finish before moving its body, including a turn that outlived its request.
    await Promise.race([seat.chain, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('previous seat turn did not finish')), Math.max(1, end - now())); t.unref?.(); })]);
    for (const intent of setup.steps ?? []) {
      const left = end - now(); if (left <= 0) throw new Error('setup wall budget exhausted');
      let r = await cli(['act', ...await offered(cli, intent, left), '--for', 'none', '--json', '--wait', String(Math.max(1, Math.floor(left / 1000)))], left);
      while (r.ok && r.data?.accepted && r.data.receipt?.id && ['accepted', 'started', 'running'].includes(r.data.receipt.phase) && now() < end) {
        const wait = await cli(['wait', String(Math.max(1, Math.min(60, Math.floor((end-now())/1000)))), r.data.receipt.id, '--json'], Math.max(1,end-now()));
        r = wait.ok ? { ...wait, data: { ...r.data, ...wait.data } } : wait;
      }
      rows.push(r.data ?? { error: r.reason });
      if (!r.ok || !r.data?.accepted || (r.data.receipt && r.data.receipt.phase !== 'completed')) throw new Error(`setup action not completed: ${r.data?.code ?? r.data?.receipt?.phase ?? r.reason ?? 'unknown'}`);
    }
    const r = await cli(['here'], Math.max(1, end - now()));
    if (!r.ok) throw new Error('cannot verify setup perception');
    me = r.data?.me;
    const problems = checkStart(me, setup.expect); if (problems.length) throw new Error(problems.join('; '));
  } catch (e) { error = e.message; }
  const result = { requestKey, ok: error == null, startedAt: new Date(started).toISOString(), elapsedMs: now() - started, expected: setup.expect, me, actions: rows, error };
  appendJsonl(join(runDir, 'fixture-setup.jsonl'), result);
  return result;
}
