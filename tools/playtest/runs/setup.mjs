// Soul Runs setup (#751): existing god-edit batches applied to a freshly provisioned isolated world before any seat
// exists, through the world owner's own route (POST /v1/god/mint as the dev owner, then /v1/god/act, i.e. the same
// validated commitBatch the god CLI uses). Setup is separate from measured play: it is receipted before play starts and
// a refused batch stops the run at stage "setup". The minted god token is a controller credential and is never recorded.
import { physicalSnapshotSha256 } from '../lib/physical-fixture.mjs';

// Dev auth only: validation refuses any world kind other than an isolated dev world before applySetup can run
// (`world.kind`, runs.test.mjs), so this owner never reaches a real world.
const DEV_OWNER = 'dev:admin';
const short = (x) => String(x ?? '').slice(0, 300);
const CREATES = { place: () => 1, clone: (op) => Math.max(1, op.count ?? 1) };

/** The entities an accepted batch created or changed (#784), from the act response's `ids` and the ops themselves.
 * The compiler records each created root as ids[id] = id (and ids[tmp] = id) in op order, so created ids are attributed
 * to the creating ops (place, clone) in that order; any other op that names an entity by `id` changed it. */
export function batchEntities(ops, ids) {
  const created = [...new Set(Object.values(ids ?? {}).filter((v) => typeof v === 'string'))];
  const byTmp = new Map(Object.entries(ids ?? {}).filter(([k]) => k !== ids[k]).map(([k, v]) => [v, k]));
  const slots = ops.flatMap((op, i) => (CREATES[op?.op] ? Array.from({ length: CREATES[op.op](op) }, () => ({ i, op })) : []));
  const out = created.map((id, k) => {
    const s = slots.length === created.length ? slots[k] : null;
    return { id, op: s?.op.op ?? 'created', ...(s ? { opIndex: s.i } : {}), ...(byTmp.has(id) ? { tmp: byTmp.get(id) } : {}), ...(s?.op.name ? { name: s.op.name } : {}), ...(s?.op.def ? { def: s.op.def } : {}) };
  });
  ops.forEach((op, i) => {
    if (op?.op === 'clone' || typeof op?.id !== 'string') return; // a clone's id is its source, not a change to it
    const id = ids?.[op.id] ?? op.id;
    if (!created.includes(id)) out.push({ id, op: op.op ?? null, opIndex: i });
  });
  return out;
}

async function call(fetchImpl, url, init, left) {
  const r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(Math.max(1, left())) });
  let body = null; try { body = await r.json(); } catch { /* not json */ }
  return { status: r.status, ok: r.ok, body };
}

/** applySetup({base, setup:{batches:[{id, path, sha256, ops, note}], maxWallSec}}) → {ok, batches:[…], fixture, error?}. */
export async function applySetup({ base, setup, fetchImpl = fetch, now = Date.now }) {
  const t0 = now(), left = () => t0 + (setup.maxWallSec ?? 120) * 1000 - now();
  const out = { ok: false, startedAt: new Date(t0).toISOString(), route: 'POST /v1/god/act (world owner, dev auth)', batches: [], fixture: null };
  const physical = async () => { const r = await call(fetchImpl, `${base}/v1/world/snapshot`, {}, left); if (!r.ok) return `unavailable: HTTP ${r.status}`; try { return physicalSnapshotSha256(r.body); } catch (e) { return `unavailable: ${short(e.message)}`; } };
  try {
    const before = await physical();
    const minted = await call(fetchImpl, `${base}/v1/god/mint`, { method: 'POST', headers: { authorization: `Bearer ${DEV_OWNER}`, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'soul-run-setup' }) }, left);
    if (!minted.ok || !minted.body?.token) throw new Error(`god mint refused: HTTP ${minted.status} ${short(minted.body?.code ?? minted.body?.error)}`);
    const auth = { authorization: `Bearer ${minted.body.token}`, 'content-type': 'application/json' };
    for (const b of setup.batches) {
      if (left() <= 0) throw new Error('setup.maxWallSec reached');
      const r = await call(fetchImpl, `${base}/v1/god/act`, { method: 'POST', headers: auth, body: JSON.stringify({ ops: b.ops, note: b.note ?? `soul-run setup ${b.id}` }) }, left);
      const accepted = r.ok && r.body?.accepted === true;
      const row = { id: b.id, path: b.path, sha256: b.sha256, ops: b.ops.length, status: r.status, accepted, seq: r.body?.seq ?? r.body?.edit?.seq ?? null,
        ...(accepted ? { entities: batchEntities(b.ops, r.body?.ids) } : {}),
        ...(accepted ? {} : { refusal: { code: r.body?.code ?? r.body?.failures?.[0]?.code ?? null, failures: (r.body?.failures ?? []).slice(0, 10).map((f) => ({ op: f.op ?? null, code: f.code ?? null, detail: short(f.detail) })) } }) };
      out.batches.push(row);
      if (!accepted) throw new Error(`setup batch ${b.id} refused: ${row.refusal.code ?? `HTTP ${r.status}`}`);
    }
    out.fixture = { physicalBeforeSetupSha256: before, physicalAfterSetupSha256: await physical() };
    out.ok = true;
  } catch (e) { out.error = short(e?.message ?? e); }
  out.elapsedMs = now() - t0;
  return out;
}

// World time (#888): a run's clips show the world by day. Dev and run worlds boot at 06:00 and run one world day per real
// hour, so a server up for 40 minutes is at night. A run sets the time of day (default midday) and the clock's speed
// (default 0, paused) through the god env route before any seat or camera exists.
export const WORLD_TIME_DEFAULTS = Object.freeze({ timeOfDay: 12, timeScale: 0 });
const HOUR = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;

/** The hour a timeOfDay names (0..24 hours, "HH:MM", "7pm"), as the server's parseHour reads it; null when invalid. */
export function parseTimeOfDay(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 24 ? v % 24 : null;
  if (typeof v !== 'string') return null;
  const m = HOUR.exec(v); if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0), ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  return h > 24 || min > 59 ? null : (h + min / 60) % 24;
}

/** worldTimeRequest({timeOfDay, timeScale}) → {time, errors}: the env body to send (null = leave the clock alone).
 *  timeOfDay "keep" leaves the time of day; timeScale "keep" leaves the speed; both default to midday, paused. */
export function worldTimeRequest({ timeOfDay, timeScale } = {}) {
  const errors = [], tod = timeOfDay ?? WORLD_TIME_DEFAULTS.timeOfDay;
  const scale = timeScale ?? (tod === 'keep' ? 'keep' : WORLD_TIME_DEFAULTS.timeScale);
  if (tod !== 'keep' && parseTimeOfDay(tod) == null) errors.push({ code: 'world.timeOfDay', message: `world.timeOfDay ${JSON.stringify(tod)}: hours 0-24, "HH:MM" (or "7pm"), or "keep"` });
  // The server's own bound: a day of 1200 to 20,000,000 ticks, so 0 (paused) or 0.0864 to 1440 world hours per real hour.
  if (scale !== 'keep' && !(typeof scale === 'number' && (scale === 0 || (scale >= 0.0864 && scale <= 1440)))) errors.push({ code: 'world.timeScale', message: `world.timeScale ${JSON.stringify(scale)}: world hours per real hour, 0 (paused) or 0.09 to 1440, or "keep"` });
  if (errors.length) return { time: null, errors };
  const time = { ...(tod !== 'keep' ? { timeOfDay: tod } : {}), ...(scale !== 'keep' ? { timeScale: scale } : {}) };
  return { time: Object.keys(time).length ? time : null, errors };
}

/** applyWorldTime({base, time}) → {ok, requested, applied?, error?}: POST /v1/god/env as the dev owner, then the clock the
 *  world reports. Never throws: a run whose clock could not be set still runs, and its receipt says so. */
export async function applyWorldTime({ base, time, fetchImpl = fetch, maxWallSec = 30, now = Date.now, note = 'run world time (#888)' }) {
  const t0 = now(), left = () => t0 + maxWallSec * 1000 - now();
  const out = { ok: false, requested: time, route: 'POST /v1/god/env (world owner, dev auth)' };
  try {
    const minted = await call(fetchImpl, `${base}/v1/god/mint`, { method: 'POST', headers: { authorization: `Bearer ${DEV_OWNER}`, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'world-time' }) }, left);
    if (!minted.ok || !minted.body?.token) throw new Error(`god mint refused: HTTP ${minted.status} ${short(minted.body?.code ?? minted.body?.error)}`);
    const r = await call(fetchImpl, `${base}/v1/god/env`, { method: 'POST', headers: { authorization: `Bearer ${minted.body.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...time, note }) }, left);
    if (!r.ok || r.body?.accepted === false) throw new Error(`env refused: HTTP ${r.status} ${short(r.body?.code ?? r.body?.message ?? r.body?.failures?.[0]?.code)}`);
    const t = r.body?.env?.time ?? {};
    out.applied = { clock: t.clock ?? null, datetime: t.datetime ?? null, paused: t.paused ?? null, timeScale: t.timeScale ?? null };
    out.ok = true;
  } catch (e) { out.error = short(e?.message ?? e); }
  out.elapsedMs = now() - t0;
  return out;
}
