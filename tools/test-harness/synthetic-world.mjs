#!/usr/bin/env node
// Lane PERF-STREAM (2026-11-02): a synthetic 10× world for streaming and event-loop work. Eden 2026's public snapshot
// (~5,000 things) is cloned on a grid of copies with position offsets (roots' poses and shapes, the ground's landforms
// and waters), every id and name made unique per copy, and written as a world/1 snapshot plus a DATA_DIR this repo's
// world server boots from (the god store's rows: apps/server/src/god/store.ts). The defs are shared by every copy.
//   node tools/test-harness/synthetic-world.mjs --out <DATA_DIR> [--from <snapshot.json|url>] [--copies 5x2]
//        [--spacing 1000] [--world-id synth-1] [--owner dev:admin]
// Serve: BRAIN_MODE=fake DEV_AUTH=1 WORLD_KEY=synth DATA_DIR=<DATA_DIR> PORT=5321 PUBLIC_URL=http://localhost:5321 \
//        node apps/server/src/main.ts      (see /Users/gene/Eden/team/scratch/perf-synthetic-50k/README.md)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Db } from '../../apps/server/src/db.ts';
import { ensureWorldSchema } from '../../apps/server/src/god/store.ts';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = opt('out', null); if (!out) { console.error('usage: synthetic-world.mjs --out <DATA_DIR> [--from snapshot.json|url] [--copies 5x2] [--spacing 1000]'); process.exit(2); }
const from = opt('from', 'https://souls.game/w/eden/v1/world/snapshot');
const [nx, nz] = opt('copies', '5x2').split('x').map(Number);
const spacing = Number(opt('spacing', '1000'));
const worldId = opt('world-id', 'synth-1'), owner = opt('owner', 'dev:admin');

const source = /^https?:/.test(from) ? await (await fetch(from)).json() : JSON.parse(readFileSync(from, 'utf8'));
if (source.contract !== 'world/1') throw new Error(`not a world/1 snapshot: ${source.contract}`);
const ids = new Set(source.entities.map((e) => e.id));
const ID = /\b[a-z]_[0-9a-f]{6,16}\b/g;
/** A copy's id for a source id: the same prefix and hex length (nothing downstream learns a new id shape); copy 0 keeps its ids. */
const used = new Set(ids);
const idMap = (k) => {
  const m = new Map();
  for (const id of ids) {
    if (k === 0) { m.set(id, id); continue; }
    let n = 0, next;
    const [prefix, hex] = id.split('_');
    do { next = `${prefix}_` + createHash('sha1').update(`${id}:${k}:${n++}`).digest('hex').slice(0, hex.length); } while (used.has(next));
    used.add(next); m.set(id, next);
  }
  return m;
};
const remapText = (text, map) => text.replace(ID, (id) => map.get(id) ?? id);
const shift = (pt, ox, oz) => [pt[0] + ox, pt[1] + oz];
const shiftShape = (s, ox, oz) => {
  if (!s || typeof s !== 'object') return s;
  const o = { ...s };
  if (Array.isArray(o.path)) o.path = o.path.map((p) => shift(p, ox, oz));
  if (Array.isArray(o.area)) o.area = o.area.map((p) => shift(p, ox, oz));
  if (Array.isArray(o.aprons)) o.aprons = o.aprons.map((a) => a.map((p) => shift(p, ox, oz)));
  if (Array.isArray(o.c) && o.c.length === 2) o.c = shift(o.c, ox, oz);
  return o;
};

const entities = [], landforms = [], waters = [];
const [x0, z0, x1, z1] = source.ground.extent;
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const k = j * nx + i, ox = i * spacing, oz = j * spacing, map = idMap(k);
  for (const e of source.entities) {
    const c = JSON.parse(remapText(JSON.stringify(e), map));
    if (k > 0 && typeof c.name === 'string') c.name = `${c.name}~${k}`;
    if (c.in?.parent === 'world') {
      if (Array.isArray(c.p) && c.p.length >= 3) { c.p = [c.p[0] + ox, c.p[1], c.p[2] + oz]; }
      if (c.shape) c.shape = shiftShape(c.shape, ox, oz);
    }
    entities.push(c);
  }
  for (const lf of source.ground.landforms) landforms.push(shiftShape(JSON.parse(remapText(JSON.stringify(lf), map)), ox, oz));
  for (const w of source.ground.waters ?? []) waters.push(shiftShape(JSON.parse(remapText(JSON.stringify(w), map)), ox, oz));
}
const extent = [x0, z0, x1 + (nx - 1) * spacing, z1 + (nz - 1) * spacing];
const ground = { ...source.ground, extent, landforms, waters };
const constants = { ...source.constants, extent: Math.max(extent[2] - extent[0], extent[3] - extent[1]), limits: { ...source.constants.limits, entities: Math.max(source.constants.limits?.entities ?? 0, entities.length + 1000) } };
const snapshot = { ...source, worldId, constants, ground, entities, builds: [], buildsRev: 0, state: { ...source.state, about: { ...(source.state?.about ?? {}), title: `${source.state?.about?.title ?? 'World'} ×${nx * nz}` } } };

mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'snapshot.json'), JSON.stringify(snapshot));
const dbPath = resolve(out, 'sim.db');
for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) if (existsSync(f)) rmSync(f);
const db = new Db(dbPath);
ensureWorldSchema(db);
const defRefs = Object.fromEntries(source.defs.filter((d) => !String(d.ref).startsWith('sha:')).map((d) => [d.ref, d.hash]));
const meta = { constants, state: snapshot.state, seed: source.seed ?? `${worldId}:genesis`, seq: source.counter ?? 0, editSeq: source.seq ?? 0, ground, owner, defRefs };
db.db.exec('BEGIN');
db.db.prepare('INSERT INTO world_meta_v1 (world_id, body) VALUES (?, ?)').run(worldId, JSON.stringify(meta));
const defIns = db.db.prepare('INSERT OR IGNORE INTO world_defs_v1 (world_id, hash, ref, body) VALUES (?, ?, ?, ?)');
for (const d of source.defs) defIns.run(worldId, d.hash, d.ref, JSON.stringify(d));
const entIns = db.db.prepare('INSERT INTO world_entities_v1 (world_id, id, parent, body) VALUES (?, ?, ?, ?)');
for (const e of entities) entIns.run(worldId, e.id, e.in?.parent ?? 'world', JSON.stringify(e));
db.db.exec('COMMIT');
db.db.close();
console.log(`${out}: ${entities.length} things (${nx}×${nz} copies of ${source.entities.length}, spacing ${spacing} m), ${source.defs.length} defs, ${landforms.length} landforms, ${waters.length} waters, extent ${extent.join(',')}`);
