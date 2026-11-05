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
