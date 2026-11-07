// CTRL-1 (#1093): the strict contract's core promise, swept on real worlds rather than found one id at a time: every id the
// world offers, on the page or off it, passes the strict gate with the example params its own schema implies; and the real
// CLI sends each kind of offer rather than refusing it as words. The Soul's menu changes with where it stands and what it
// is doing, so each world is swept from a fresh Soul, from several places, and seated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Hono} from 'hono';
import {getRequestListener} from '@hono/node-server';
import {accept} from '../test/native-owner-fixture.ts';
import {bootEden} from '../test/eden-capabilities-timing.ts';
import {mountEdgeRoutes} from './edge/routes.ts';
import {offerParams, type ParamSchema} from './edge/intents/offer-schema.ts';
import type {EdgeCapability} from './edge/contract.ts';

const CLI = fileURLToPath(new URL('../../../tools/world-launcher/soul/eden.mjs', import.meta.url));
const OFFER_SHAPE = /^[a-z][\w-]*:\S+$/i;

/** Values the schema itself allows, for every parameter it declares. */
export function exampleParams(schema: ParamSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(schema)) {
    if (spec.enum?.length) {out[name] = spec.enum[0]; continue;}
    if (spec.pattern) continue;
    if (spec.type === 'integer' || spec.type === 'number') out[name] = spec.default ?? spec.min ?? spec.max ?? 1;
    else if (spec.type === 'string') out[name] = 'x';
    else if (spec.type === 'boolean') out[name] = true;
    else if (spec.type === 'array') out[name] = [];
    else if (spec.type === 'object') out[name] = {};
    else out[name] = 'x';
  }
  return out;
}

type Miss = {state: string; id: string; code?: string; reason?: string};
async function sweepWorld(t: {after(fn: () => void): void}, template: string) {
  const w = await bootEden(() => {}, new URL(`../../../worlds/templates/${template}.json`, import.meta.url));
  t.after(() => w.close());
  const {edge, soul} = w, misses: Miss[] = [], seen = new Set<string>(), shapes = new Map<string, EdgeCapability>();
  const sweep = (state: string) => {
    const page = edge.capabilitiesPage(soul).capabilities, all = edge.coreA.binds(soul).caps;
    assert.ok(page.every(c => all.some(x => x.id === c.id)), 'the page is part of the whole menu');
    for (const c of all) {
      seen.add(c.id);
      const key = OFFER_SHAPE.test(c.id) ? c.verb : `odd:${c.id}`; if (!shapes.has(key) && c.available) shapes.set(key, c);
      const no = edge.offerGate(soul, {capability: c.id, params: exampleParams(offerParams(c))});
      if (no) misses.push({state, id: c.id, code: no.code, reason: no.reason.slice(0, 120)});
    }
  };
  sweep('fresh');
  // from places around the world (a logged relocate, test setup only)
  const places = [...edge.places.byId.values()].filter(p => p.parent !== null && p.polygon?.length), step = Math.max(1, Math.floor(places.length / 8));
  for (let i = 0; i < places.length; i += step) {
    const poly = places[i]!.polygon!, x = poly.reduce((a, q) => a + q[0]!, 0) / poly.length, z = poly.reduce((a, q) => a + q[1]!, 0) / poly.length;
    const moved = await accept(w.host, w.host.enqueue('edge-relocate', `sweep:${i}`, {soulId: soul.soulId, entityId: soul.entityId, to: [x, z], why: 'test setup'})).then(() => true, () => false);
    if (!moved) continue;
    await w.settle(3); sweep(`at ${places[i]!.id}`);
  }
  const sat = edge.capabilities(soul).find(c => c.id === 'sit:here' && c.available);
  if (sat) {const a = await Promise.race([accept(w.host, edge.act(soul, {capability: 'sit:here'})), w.settle(40).then(() => null)]); await w.settle(40); if (a) sweep('seated');}
  return {w, misses, seen, shapes};
}

for (const template of ['hello-hamlet', 'eden-2026', 'mars-two']) {
  test(`every offer on ${template} passes the strict gate, and the real CLI sends each kind of offer`, {timeout: 600000}, async t => {
    const {w, misses, seen, shapes} = await sweepWorld(t, template);
    assert.ok(seen.size > 30, `${seen.size} offers`);
    const uniq = [...new Map(misses.map(m => [`${m.id}|${m.code}`, m])).values()];
    assert.deepEqual(uniq, [], `${uniq.length} refused of ${seen.size} offers`);

    const app = new Hono(), {edge, soul} = w;
    const comms = mountEdgeRoutes(app, {host: w.host, db: w.db, souls: w.souls, ledger: edge, soul: () => soul} as never);
    const server = createServer(getRequestListener(app.fetch)); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const dir = mkdtempSync(join(tmpdir(), 'strict-sweep-'));
    t.after(() => {comms.close(); server.close(); rmSync(dir, {recursive: true, force: true});});
    writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({world: `http://127.0.0.1:${(server.address() as {port: number}).port}`, token: 'tok'}));
    const cli = async (...args: string[]) => {
      let done = false, out = '', exit = 0;
      const p = new Promise<void>(r => execFile(process.execPath, [CLI, ...args], {cwd: dir}, (e, stdout) => {out = stdout; exit = typeof e?.code === 'number' ? e.code : 0; done = true; r();}));
      while (!done) {await w.settle(1); await new Promise(r => setTimeout(r, 5));}
      await p; try {return {...JSON.parse(out), exit};} catch {return {raw: out.slice(0, 200), exit};}
    };
    const wrong: unknown[] = []; let sent = 0;
    for (const [key, c] of shapes) {
      // an act can change what is on offer: only an offer still there is a finding
      if (!edge.coreA.binds(soul).caps.some(x => x.id === c.id)) continue;
      // required params only: an optional `with: []` or `to: "x"` fits its schema and the plan rightly refuses what it means
      const needed = Object.fromEntries(Object.entries(offerParams(c)).filter(([, spec]) => spec.required));
      const r = await cli('act', c.id, ...(Object.keys(needed).length ? [JSON.stringify(exampleParams(needed))] : []));
      sent++;
      if (['act.not-an-id', 'capability.unknown', 'capability.params'].includes(r.code)) wrong.push({key, id: c.id, code: r.code, reason: String(r.reason).slice(0, 120)});
    }
    assert.deepEqual(wrong, []);
    console.log(`${template}: ${seen.size} offers swept, ${sent} kinds sent through the CLI`);
  });
}
