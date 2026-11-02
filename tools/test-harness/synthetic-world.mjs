#!/usr/bin/env node
// Lane PERF-EVENTLOOP (2026-11-02): a synthetic entity world of ~50,000 things, the Eden snapshot cloned N times on a
// grid of 1,000 m cells (unique ids, offset poses, shapes, landforms and waters), written as a world server DATA_DIR
// (apps/server: world_meta_v1 / world_defs_v1 / world_entities_v1 under WORLD_ID `<key>-1`) plus the plain world/1
// snapshot as JSON. Shared by the perf-eventloop and perf-stream lanes; the README next to the output says how to serve it.
//
//   node tools/test-harness/synthetic-world.mjs [--snapshot eden.json | --from https://souls.game/w/eden]
//        [--copies 10] [--cols 5] [--cell 1000] [--key synth50k] [--out /Users/gene/Eden/team/scratch/perf-synthetic-50k]
//
// Copy 0 keeps the original ids (its things are the reference), copies 1..N-1 get ids of the same shape (`e_` + 8 hex,
// `h_` + 10 hex) derived from (copy, id), with every reference (parents, landform and water ids, the world state's
// district list) remapped. Child things keep their slot-relative poses; only world-level poses, shapes, landforms and
// waters move. Names get a `~k` suffix in the copies. Minds: none (an entity world; the edge driver, fake brain).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const copies = Number(opt('copies', '10')), cols = Number(opt('cols', '5')), cell = Number(opt('cell', '1000')), key = opt('key', 'synth50k');
const out = resolve(opt('out', '/Users/gene/Eden/team/scratch/perf-synthetic-50k'));
const worldId = `${key}-1`;

async function source() {
  const file = opt('snapshot', null);
  if (file) return JSON.parse(readFileSync(resolve(file), 'utf8'));
  const from = opt('from', 'https://souls.game/w/eden').replace(/\/+$/, '');
  const r = await fetch(`${from}/v1/world/snapshot`); if (!r.ok) throw new Error(`snapshot ${r.status} from ${from}`);
  return r.json();
}

const hex = (s, n) => createHash('sha1').update(s).digest('hex').slice(0, n);
/** Points [[x, z], ...] moved by (dx, dz); anything else is left alone. */
const movePts = (pts, dx, dz) => pts.map(([x, z, ...rest]) => [x + dx, z + dz, ...rest]);

export function cloneWorld(snap, { copies, cols, cell }) {
  const rows = Math.ceil(copies / cols);
  const [x0, z0, x1, z1] = snap.ground.extent, w = x1 - x0, d = z1 - z0;
  const entities = [], landforms = [], waters = [], used = new Set(snap.entities.map((e) => e.id));
  const idMaps = [];
  for (let k = 0; k < copies; k++) {
    const dx = (k % cols) * cell, dz = Math.floor(k / cols) * cell;
    // ids: copy 0 keeps its own; a copy's id keeps the prefix and length of the original (both `e_xxxxxxxx` and `h_…` occur)
    const map = new Map();
    for (const e of snap.entities) {
      if (k === 0) { map.set(e.id, e.id); continue; }
      const m = /^([a-z]+_)([0-9a-f]+)$/.exec(e.id); let id, n = 0;
      do { id = m ? m[1] + hex(`${k}:${e.id}:${n}`, m[2].length) : `${e.id}~${k}`; n++; } while (used.has(id));
      used.add(id); map.set(e.id, id);
    }
    idMaps.push(map);
    const remap = (id) => map.get(id) ?? id;
    for (const e of snap.entities) {
      const c = structuredClone(e);
      c.id = remap(e.id); c.in = { ...e.in, parent: e.in.parent === 'world' ? 'world' : remap(e.in.parent) };
      if (k > 0 && typeof c.name === 'string') c.name = `${c.name}~${k}`;
      if (e.in.parent === 'world') {
        if (Array.isArray(c.p)) { c.p[0] += dx; c.p[c.p.length - 1] += dz; }
        if (c.shape?.area) c.shape = { ...c.shape, area: movePts(c.shape.area, dx, dz) };
        if (c.shape?.path) c.shape = { ...c.shape, path: movePts(c.shape.path, dx, dz) };
      }
      entities.push(c);
    }
    for (const l of snap.ground.landforms) {
      const c = structuredClone(l); if (c.id) c.id = remap(c.id);
      if (Array.isArray(c.c)) { c.c = [c.c[0] + dx, c.c[1] + dz]; }
      if (c.area) c.area = movePts(c.area, dx, dz); if (c.path) c.path = movePts(c.path, dx, dz);
      if (c.aprons) c.aprons = c.aprons.map((poly) => movePts(poly, dx, dz));
      landforms.push(c);
    }
    for (const wtr of snap.ground.waters) {
      const c = structuredClone(wtr); if (c.id) c.id = remap(c.id);
      if (c.area) c.area = movePts(c.area, dx, dz); if (c.path) c.path = movePts(c.path, dx, dz);
      waters.push(c);
    }
  }
  const extent = [x0, z0, x0 + w + (cols - 1) * cell, z0 + d + (rows - 1) * cell];
  const ground = { ...snap.ground, extent, landforms, waters };
  const constants = { ...snap.constants, extent: Math.max(extent[2] - extent[0], extent[3] - extent[1]), limits: { ...(snap.constants.limits ?? {}), entities: Math.max(snap.constants.limits?.entities ?? 0, entities.length + 1000) } };
  // the world state is one (copy 0's); its district list names copy 0's things, which keep their ids
  return { ...snap, worldId, constants, ground, entities, tiles: {}, builds: [], buildsRev: 0, assetBytes: snap.assetBytes ?? {} };
}

async function main() {
  const snap = await source();
  if (snap.contract !== 'world/1') throw new Error('not a world/1 snapshot');
  const world = cloneWorld(snap, { copies, cols, cell });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'snapshot.json'), JSON.stringify(world));
  // the server's DATA_DIR: the same rows the god store writes (apps/server/src/god/store.ts), so the real world server
  // boots it as an entity world under WORLD_KEY=<key>
  const data = join(out, 'data'); mkdirSync(data, { recursive: true });
  for (const f of ['sim.db', 'sim.db-wal', 'sim.db-shm']) rmSync(join(data, f), { force: true });   // only the database: a running server's live.json and backups stay
  const { Db } = await import(join(ROOT, 'apps/server/src/db.ts'));
  const { WorldStore } = await import(join(ROOT, 'apps/server/src/god/store.ts'));
  const { WorldModel, coreLibrary } = await import(join(ROOT, 'packages/world-compiler/src/index.ts'));
  const db = new Db(join(data, 'sim.db'));
  const store = new WorldStore(db, worldId);
  const model = WorldModel.fromSnapshot({ constants: world.constants, state: world.state, seed: world.seed ?? 'synthetic', seq: world.counter ?? 0, editSeq: world.seq, defs: world.defs, entities: world.entities, ground: world.ground }, undefined, coreLibrary(), { lazyIndex: true });
  store.init(model, 'dev:admin');
  const up = db.db.prepare('INSERT INTO world_entities_v1 (world_id, id, parent, body) VALUES (?, ?, ?, ?)');
  db.db.exec('BEGIN');
  for (const e of world.entities) up.run(worldId, e.id, e.in.parent, JSON.stringify(e));
  db.db.exec('COMMIT');
  db.db.close();
  console.log(`${out}: ${world.entities.length} things (${snap.entities.length} × ${copies}, ${cols} per row, ${cell} m cells), extent ${JSON.stringify(world.ground.extent)}, ${world.defs.length} defs, world ${worldId}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
