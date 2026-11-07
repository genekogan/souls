// Numbered, forward-only migrations. Each runs once, in a transaction, and is
// recorded in schema_migrations. Never edit a shipped migration; add a new one.
import type { DatabaseSync } from 'node:sqlite';

const hasColumn = (db: DatabaseSync, table: string, col: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
const addColumn = (db: DatabaseSync, table: string, col: string, decl: string) => { if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); };

export const MIGRATIONS: { id: number; name: string; up(db: DatabaseSync): void }[] = [
  {
    id: 1, name: 'baseline',
    up(db) {
      db.exec(`
      CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, schema TEXT NOT NULL, rules_version TEXT NOT NULL, dt REAL NOT NULL, seed TEXT NOT NULL, clock_rate REAL NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (world_id TEXT NOT NULL, seq INTEGER NOT NULL, tick INTEGER NOT NULL, kind TEXT NOT NULL, author TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, seq));
      CREATE INDEX IF NOT EXISTS events_tick ON events (world_id, tick);
      CREATE TABLE IF NOT EXISTS snapshots (world_id TEXT NOT NULL, tick INTEGER NOT NULL, seq INTEGER NOT NULL, state_hash TEXT NOT NULL, physical_hash TEXT NOT NULL, rules_version TEXT NOT NULL, snapshot TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, tick));
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, wallet TEXT, role TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS souls (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, owner TEXT NOT NULL, entity_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, created_at INTEGER NOT NULL, retired_at INTEGER, token_hash TEXT, token_created_at INTEGER, native INTEGER NOT NULL DEFAULT 0);
      CREATE UNIQUE INDEX IF NOT EXISTS souls_name ON souls (world_id, name COLLATE NOCASE) WHERE retired_at IS NULL;
      CREATE TABLE IF NOT EXISTS brain_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, tier TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, cost_usd REAL NOT NULL, ms REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS brain_calls_at ON brain_calls (at);
      CREATE TABLE IF NOT EXISTS spend_hourly (hour INTEGER NOT NULL, tier TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, PRIMARY KEY (hour, tier, model));
      CREATE TABLE IF NOT EXISTS narratives (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, region TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL);`);
    },
  },
  {
    id: 2, name: 'soul_id columns, prompts, invites, agent token metadata',
    up(db) {
      // events.soul_id: a real indexed column instead of scanning JSON payloads
      addColumn(db, 'events', 'soul_id', 'TEXT');
      db.exec(`UPDATE events SET soul_id = json_extract(payload, '$.soulId') WHERE soul_id IS NULL AND json_extract(payload, '$.soulId') IS NOT NULL`);
      db.exec('CREATE INDEX IF NOT EXISTS events_soul ON events (world_id, soul_id, seq)');
      // brain_calls: who the call was about, and whether it hit a real model
      addColumn(db, 'brain_calls', 'soul_id', 'TEXT');
      addColumn(db, 'brain_calls', 'mode', "TEXT NOT NULL DEFAULT 'live'");
      db.exec(`UPDATE brain_calls SET mode = COALESCE(json_extract(body, '$.mode'), 'live')`);
      db.exec('CREATE INDEX IF NOT EXISTS brain_calls_soul ON brain_calls (soul_id, id)');
      db.exec('CREATE INDEX IF NOT EXISTS brain_calls_tier ON brain_calls (tier, id)');
      // long prompts stored once, referenced by hash
      db.exec('CREATE TABLE IF NOT EXISTS prompts (hash TEXT PRIMARY KEY, text TEXT NOT NULL, created_at INTEGER NOT NULL)');
      // invite gate
      db.exec('CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, note TEXT, created_by TEXT, created_at INTEGER NOT NULL)');
      addColumn(db, 'users', 'invited_by', 'TEXT');
      // agent tokens: a label and last-use time so owners can see what is attached
      addColumn(db, 'souls', 'token_label', 'TEXT');
      addColumn(db, 'souls', 'token_last_used', 'INTEGER');
    },
  },
  {
    id: 3, name: 'talk: rendered words for speech acts',
    up(db) {
      db.exec('CREATE TABLE IF NOT EXISTS talks (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, tick INTEGER NOT NULL, at INTEGER NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL, body TEXT NOT NULL)');
      db.exec('CREATE INDEX IF NOT EXISTS talks_pair ON talks (from_id, to_id, id)');
    },
  },
  {
    id: 4, name: 'durable model cost reservations',
    up(db) {
      db.exec('CREATE TABLE paid_costs (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, model TEXT NOT NULL, cost REAL NOT NULL, settled INTEGER NOT NULL DEFAULT 0)');
      db.exec('CREATE INDEX paid_costs_at ON paid_costs(at)');
      // Old hourly totals include pruned call rows. Date at hour end errs toward retaining spend.
      db.exec("INSERT INTO paid_costs(at, model, cost, settled) SELECT (hour + 1) * 3600000, model, SUM(cost_usd), 1 FROM spend_hourly GROUP BY hour, model");
    },
  },
  { id: 5, name: 'recorded rendering chunks', up(db) {
    db.exec('CREATE TABLE take_chunks (world_id TEXT NOT NULL, from_tick INTEGER NOT NULL, to_tick INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(world_id, to_tick))');
    db.exec('CREATE INDEX take_chunks_from ON take_chunks(world_id, from_tick)');
  } },
  {id:6,name:'verified take archives',up(db){db.exec('CREATE TABLE take_archives(world_id TEXT NOT NULL, segment INTEGER NOT NULL, from_tick INTEGER NOT NULL, to_tick INTEGER NOT NULL, key TEXT NOT NULL, sha TEXT NOT NULL, bytes INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(world_id,segment))');}},
  { id: 7, name: 'indexed originating system prompt references', up(db) {
    // Existing retained calls already contain this reference; index them without
    // rewriting history or treating arbitrary model/user JSON as an association.
    db.exec(`CREATE INDEX brain_calls_prompt ON brain_calls(world_id,
      CASE WHEN json_valid(body) THEN json_extract(body, '$.request.system[0].text.$prompt') END,
      soul_id)`);
  } },
  { id: 8, name: 'private candidate intent request reservations', up(db) {
    // No route/capability is activated by this additive table. Pending transport
    // work is separate from accepted canonical intention/activity facts.
    db.exec(`CREATE TABLE intent_requests_v2 (
      world_id TEXT NOT NULL REFERENCES worlds(id),
      soul_id TEXT NOT NULL REFERENCES souls(id),
      principal_id TEXT NOT NULL, request_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      body_hash TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      source TEXT NOT NULL CHECK(json_valid(source)), lease TEXT NOT NULL,
      receipt TEXT CHECK(receipt IS NULL OR json_valid(receipt)),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(world_id, soul_id, principal_id, request_id)
    )`);
  } },
  { id: 9, name: 'accepted candidate intent request event references', up(db) {
    db.exec(`CREATE TABLE intent_request_events_v2 (
      world_id TEXT NOT NULL, soul_id TEXT NOT NULL, principal_id TEXT NOT NULL, request_id TEXT NOT NULL,
      seq INTEGER NOT NULL, tick INTEGER NOT NULL, kind TEXT NOT NULL, event_hash TEXT NOT NULL,
      PRIMARY KEY(world_id,soul_id,principal_id,request_id,seq),
      FOREIGN KEY(world_id,soul_id,principal_id,request_id) REFERENCES intent_requests_v2(world_id,soul_id,principal_id,request_id),
      FOREIGN KEY(world_id,seq) REFERENCES events(world_id,seq)
    )`);
  } },
  { id: 10, name: 'canonical candidate intent receipt origins', up(db) {
    db.exec('ALTER TABLE intent_requests_v2 ADD COLUMN received TEXT CHECK(received IS NULL OR json_valid(received))');
  } },
  { id: 11, name: 'immutable public render scene captures', up(db) {
    db.exec(`CREATE TABLE render_scene_captures (
      world_id TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      PRIMARY KEY(world_id,hash)
    )`);
  } },
  { id: 12, name: 'private candidate lifecycle operations', up(db) {
    // Empty additive journal only. No historical Soul backfill or route activation.
    db.exec(`CREATE TABLE lifecycle_operations_v1 (
      world_id TEXT NOT NULL REFERENCES worlds(id), request_id TEXT NOT NULL,
      soul_id TEXT NOT NULL REFERENCES souls(id), owner_id TEXT NOT NULL REFERENCES users(id), entity_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('create','retire')),
      state TEXT NOT NULL CHECK(state IN ('pending','recorded','complete','refused')),
      body TEXT NOT NULL CHECK(json_valid(body)), body_hash TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision>0), requested_at INTEGER NOT NULL,
      seq INTEGER, tick INTEGER, event_hash TEXT,
      terminal_seq INTEGER, terminal_tick INTEGER, terminal_hash TEXT,
      PRIMARY KEY(world_id,request_id), UNIQUE(world_id,soul_id,operation),
      FOREIGN KEY(world_id,seq) REFERENCES events(world_id,seq),
      FOREIGN KEY(world_id,terminal_seq) REFERENCES events(world_id,seq),
      CHECK((state IN ('pending','refused') AND seq IS NULL AND tick IS NULL AND event_hash IS NULL)
         OR (state IN ('recorded','complete') AND seq IS NOT NULL AND tick IS NOT NULL AND event_hash IS NOT NULL)),
      CHECK(state!='refused' OR operation='create'),
      CHECK((state='complete' AND terminal_seq IS NOT NULL AND terminal_tick IS NOT NULL AND terminal_hash IS NOT NULL)
         OR (state!='complete' AND terminal_seq IS NULL AND terminal_tick IS NULL AND terminal_hash IS NULL))
    )`);
    db.exec('CREATE INDEX lifecycle_operations_pending ON lifecycle_operations_v1(world_id,state,requested_at,request_id)');
    db.exec('CREATE INDEX lifecycle_operations_owner ON lifecycle_operations_v1(world_id,owner_id,requested_at,request_id)');
  } },
  { id: 13, name: 'private captured intent controller observations', up(db) {
    // Empty internal outbox. Capture is evidence, not canonical publication or
    // authority for a new decision. No historical inference/backfill.
    db.exec(`CREATE TABLE intent_observations_v2 (
      world_id TEXT NOT NULL, attempt_id TEXT NOT NULL, phase TEXT NOT NULL,
      observation_tick INTEGER NOT NULL CHECK(observation_tick>=0),
      admission_seq INTEGER NOT NULL, admission_hash TEXT NOT NULL,
      body TEXT NOT NULL CHECK(json_valid(body)), body_hash TEXT NOT NULL,
      published_seq INTEGER, published_hash TEXT,
      PRIMARY KEY(world_id,attempt_id,phase),
      FOREIGN KEY(world_id,admission_seq) REFERENCES events(world_id,seq),
      FOREIGN KEY(world_id,published_seq) REFERENCES events(world_id,seq),
      CHECK(phase IN ('started','completed','blocked','interrupted')),
      CHECK((published_seq IS NULL AND published_hash IS NULL)
         OR (published_seq IS NOT NULL AND published_hash IS NOT NULL))
    )`);
    db.exec('CREATE INDEX intent_observations_pending ON intent_observations_v2(world_id,published_seq,observation_tick,admission_seq)');
  } },
  { id: 14, name: 'opaque scoped credential generation for candidate intents', up(db) {
    // No backfill, new authority or candidate activation. Old credentials get
    // a random generation only when an opted-in authenticated adapter uses it.
    addColumn(db, 'souls', 'token_generation', 'TEXT');
  } },
  { id: 15, name: 'bounded private deterministic clock frontier', up(db) {
    // Empty additive restart metadata; no historical inference or activation.
    db.exec(`CREATE TABLE clock_frontiers_v1 (
      world_id TEXT PRIMARY KEY REFERENCES worlds(id),
      body TEXT NOT NULL CHECK(json_valid(body)), body_hash TEXT NOT NULL
    )`);
  } },
  { id:16,name:'bounded private intention history cursors',up(db){
    // Empty read bookkeeping only; no history inference, credential or activation.
    db.exec(`CREATE TABLE intent_history_cursors_v1 (
      cursor TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id),
      soul_id TEXT NOT NULL, owner_id TEXT NOT NULL, principal_id TEXT NOT NULL, source_kind TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      body TEXT NOT NULL CHECK(json_valid(body)), body_hash TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX intent_history_cursors_scope ON intent_history_cursors_v1(world_id,soul_id,owner_id,principal_id,source_kind,created_at)');
  } },
  {id:17,name:'private canonical navigation arrival references',up(db){
    // Empty indexed read journal; no historic inference or feature activation.
    db.exec(`CREATE TABLE intent_arrivals_v1 (
      world_id TEXT NOT NULL, soul_id TEXT NOT NULL, owner_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
      seq INTEGER NOT NULL, event_hash TEXT NOT NULL, body_hash TEXT NOT NULL,
      PRIMARY KEY(world_id,attempt_id), UNIQUE(world_id,seq),
      FOREIGN KEY(world_id,seq) REFERENCES events(world_id,seq)
    )`);
    db.exec('CREATE INDEX intent_arrivals_owner ON intent_arrivals_v1(world_id,soul_id,owner_id,seq)');
  }},
  {id:18,name:'superseded Soul controller token hashes',up(db){
    // SOUL3: a replaced or revoked legacy Soul token keeps only its hash, so a later use answers "revoked", not "unknown".
    db.exec(`CREATE TABLE soul_token_tombstones_v1 (
      token_hash TEXT PRIMARY KEY, world_id TEXT NOT NULL, soul_id TEXT NOT NULL, label TEXT,
      issued_at INTEGER, revoked_at INTEGER NOT NULL, reason TEXT
    )`);
  }},
  {id:19,name:'world glitch records',up(db){
    // #1150: one row per recovery and per halt. Operations data outside the log: replay never reads it.
    db.exec(`CREATE TABLE glitches_v1 (
      id INTEGER PRIMARY KEY, world_id TEXT NOT NULL, at INTEGER NOT NULL, tick INTEGER NOT NULL,
      rung TEXT NOT NULL, rule TEXT NOT NULL, bodies TEXT NOT NULL, evidence TEXT NOT NULL
    )`);
    db.exec('CREATE INDEX glitches_by_world ON glitches_v1(world_id,rung,rule)');
  }},
];

export function migrate(db: DatabaseSync): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((r) => r.id));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN');
    try { m.up(db); db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?,?,?)').run(m.id, m.name, Date.now()); db.exec('COMMIT'); applied.push(m.id); }
    catch (e) { db.exec('ROLLBACK'); throw new Error(`migration ${m.id} (${m.name}) failed: ${(e as Error).message}`); }
  }
  return applied;
}
