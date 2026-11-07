// Local inventory is credential-free. Durable workflow files are state, never deleted as locks.
import { existsSync, readdirSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { breakLock, CHROME_LOCK, inspectLock, lockStatus, parseHolder } from './locks.mjs';
import { chromeSlotDirs } from './chrome-lease.mjs';
import { call, load, ok } from './state.mjs';
import { seatDir } from './seat.mjs';
export function localDoctor({ fix = false, cwd = seatDir() ?? process.cwd(), chrome = CHROME_LOCK } = {}) {
  const slots = chromeSlotDirs(chrome), paths = [...slots, resolve(cwd, '.eden-god.look.json.lock'), resolve(cwd, '.eden-god.json.lock'), ...readdirSync(cwd).filter(n => /^\.eden-god\.claim-c_[0-9a-f]{8}\.json\.lock$/.test(n)).map(n => resolve(cwd, n))];
  for (let i = 0; i < paths.length; i++) if (existsSync(paths[i] + '.reclaim')) paths.push(paths[i] + '.reclaim');
  const locks = paths.map(path => { const slot = slots.indexOf(path), row = { kind: slot >= 0 ? 'chrome' : 'state', ...(slot >= 0 ? { slot } : {}), ...inspectLock(path) }; if (fix && row.stale) row.fixed = breakLock(path); return row; });
  const path = resolve(cwd, '.eden-god.look.json');
  if (existsSync(path)) {
    let raw, k; try { raw = readFileSync(path, 'utf8'); k = JSON.parse(raw); } catch { /* malformed gets bounded grace */ }
    const status = lockStatus(parseHolder(k?.holder), k?.heartbeatAt ?? statSync(path).mtimeMs, k?.ttlMs ?? 30_000);
    const row = { kind: 'look-keeper', path, present: true, ...status };
    if (fix && row.stale && readFileSync(path, 'utf8') === raw) { unlinkSync(path); row.fixed = true; }
    locks.push(row);
  } else locks.push({ kind: 'look-keeper', path, present: false, stale: false, holder: null });
  for (const name of readdirSync(cwd).filter(n => /^\.eden-god(?:\.claim-c_[0-9a-f]{8})?\.json$/.test(n))) {
    try { const b = JSON.parse(readFileSync(resolve(cwd, name), 'utf8')).build; if (b) locks.push({ kind: b.claim ? 'claim/step-file' : 'build/step-file', path: resolve(cwd, name), present: true, stale: false, durable: true, build: b.id, step: b.n, claim: b.claim, note: 'durable workflow state; server lease below is authoritative' }); } catch { /* never print raw state */ }
  }
  return locks;
}
export async function doctor(flags = {}) {
  const locks = localDoctor({ fix: !!flags.fix }); let server;
  if (!flags.local && load().world) {
    const r = await call('/v1/god/doctor', { ...(flags.fix ? { body: { fix: true } } : {}), timeoutMs: 10_000 });
    if (r.status === 404) server = 'server does not support lock inventory';
    else { const data = ok(r, 'doctor'); locks.push(...data.locks); }
  }
  const result = { schema: 'eden-locks/1', locks, ...(server ? { server } : {}) };
  if (flags.json) return result;
  return locks.map(l => `${l.kind ?? 'lock'} ${l.path ?? l.id}: ${l.durable ? 'saved' : !l.present ? 'free' : l.stale ? 'STALE' : 'held'}${l.holder ? ` by ${l.holder.label ?? ''} pid=${l.holder.pid ?? '?'} host=${l.holder.host ?? '?'} start=${l.holder.start ?? '?'}` : ''}${l.reason ? ` (${l.reason})` : ''}${l.fixed ? ' — fixed' : ''}`).concat(server ?? []).join('\n');
}
