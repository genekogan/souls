// Eden 2026 capabilities timing (engine P4): a fresh Soul's first GET /v1/edge/capabilities used to block the server
// 79–85 s. Boots the world the way main.ts does for a launcher entity world (green-field engine, GodMode with the
// eden-2026 genesis, ground host + paged nav, entity bridge, world env, edge ledger), in memory, fake minds, no
// network; creates one Soul through the owner flow and times its capabilities calls, before and after it walks.
//   node apps/server/test/eden-capabilities-timing.ts [--json out.json] [--walk]
// Also exports `bootEden` for the regression test (eden-capabilities-budget.test.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fixture, invite, accept } from './native-owner-fixture.ts';
import { GodMode, type Genesis } from '../src/god/god.ts';
import { GroundHost, installGroundCapabilities, loadGroundRecipes } from '../src/god/ground-host.ts';
import { installEngineBridge } from '../src/god/engine-bridge.ts';
import { installWorldEnv } from '../src/god/world-env.ts';
import { EdgeLedger } from '../src/edge/ledger/ledger.ts';

const templateUrl = (name: string) => new URL(`../../../worlds/templates/${name}.json`, import.meta.url);

/** `template`: another launcher template by name (worlds/templates/<name>.json), booted the same way (#958 display scan). */
export async function bootEden(log: (m: string) => void = () => {}, template = 'eden-2026') {
  const t0 = performance.now();
  const f = fixture(':memory:');
  loadGroundRecipes(f.db, f.host.worldId);
  const edge = new EdgeLedger(f.host, f.db);
  const genesis = JSON.parse(readFileSync(templateUrl(template), 'utf8')) as Genesis;
  const god = new GodMode(f.db, { genesis, worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  log(`genesis: ${god.model.entities.size} entities in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  new GroundHost(f.db, f.host, god);
  installGroundCapabilities(edge as never, god, f.host);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  installWorldEnv(f.host, god, edge);
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await settle(3);
  log(`world ready in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  await invite(f, 'ana');
  const row = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' })) as { id: string; entity_id: string; name: string; owner: string };
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const close = () => { f.brain.quiesce(); f.host.stop(); f.db.close(); };
  return { ...f, god, edge, bridge, settle, soul, close };
}

/** Wall time of one synchronous capabilities call (it runs on the event loop, so this is how long the server blocks). */
export function timed<T>(fn: () => T): { ms: number; value: T } { const t = performance.now(); const value = fn(); return { ms: performance.now() - t, value }; }

/** L3 (suite trust): the runner's speed, as the best of `runs` timings of one fixed reference workload made of what a
 *  /here or a capability sweep spends its time on (object building, Map reads, float point-in-polygon tests, a sort and a
 *  JSON round trip). Wall-clock budgets are written in these units, so a slower or shared runner (Modal: ~2-3x the
 *  laptop) gets a proportionally larger budget, and a faster one a smaller one; the work counts stay strict. The best
 *  of several runs reads the machine's speed, not one moment's neighbour noise. */
export function referenceMs(runs = 7): number {
  let best = Infinity, sink = 0;
  for (let r = 0; r < runs; r++) { const t = performance.now(); sink += referenceWork(); best = Math.min(best, performance.now() - t); }
  if (sink === 42) console.log('');   // keeps the work observable
  return best;
}
function referenceWork(): number {
  const poly: [number, number][] = Array.from({ length: 24 }, (_, k) => [40 + 30 * Math.cos(k * Math.PI / 12) * (k % 2 ? 0.7 : 1), 30 + 30 * Math.sin(k * Math.PI / 12)]);
  const inside = (x: number, z: number) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const m = new Map<string, { id: string; p: number[]; tags: string[]; in: boolean }>();
  for (let i = 0; i < 20_000; i++) { const p = [(i % 97) * 0.83, (i % 89) * 0.71, i % 13]; m.set(`o${i}`, { id: `o${i}`, p, tags: [`a${i % 7}`, `b${i % 5}`], in: inside(p[0], p[1]) }); }
  let n = 0;
  for (let i = 0; i < 20_000; i += 3) if (m.get(`o${i}`)!.in) n++;
  const keys = [...m.keys()].sort();
  return n + keys.length + (JSON.parse(JSON.stringify([...m.values()])) as unknown[]).length;
}

/** Stable view of a capability list for before/after comparison (ids, availability, targets, reasons). */
export function capsDigest(caps: unknown[]): string { return JSON.stringify(caps); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
  const walk = process.argv.includes('--walk');
  const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
  const w = await bootEden((m) => console.log(m));
  const L = w.edge;
  const res: Record<string, unknown> = {};
  const c1 = timed(() => L.capabilities(w.soul)); console.log(`first capabilities: ${c1.ms.toFixed(0)} ms (${c1.value.length} capabilities)`);
  const c2 = timed(() => L.capabilities(w.soul)); console.log(`second capabilities: ${c2.ms.toFixed(0)} ms`);
  Object.assign(res, { firstMs: Math.round(c1.ms), secondMs: Math.round(c2.ms), count: c1.value.length, same: capsDigest(c1.value) === capsDigest(c2.value), caps: c1.value });
  if (walk) {
    const target = (c1.value as { verb: string; available?: boolean; id: string; target?: { kind?: string } }[]).find((c) => c.verb === 'walk' && c.available && c.target?.kind === 'place');
    if (target) {
      const a = await accept(w.host, Promise.resolve(L.act(w.soul, { capability: target.id }))) as { accepted?: boolean };
      console.log(`walk ${target.id}: accepted=${a?.accepted}`);
      await w.settle(200);
      const c3 = timed(() => L.capabilities(w.soul)); console.log(`after 200 ticks of walking: ${c3.ms.toFixed(0)} ms`);
      const c4 = timed(() => L.capabilities(w.soul)); console.log(`again: ${c4.ms.toFixed(0)} ms`);
      Object.assign(res, { walk: target.id, afterWalkMs: Math.round(c3.ms), afterWalkAgainMs: Math.round(c4.ms), afterWalkCaps: c3.value });
    }
  }
  lag.disable();
  console.log(`event loop max delay over the run: ${(lag.max / 1e6).toFixed(0)} ms`);
  if (out) writeFileSync(out, JSON.stringify(res, null, 1));
  w.close();
  process.exit(0);
}
