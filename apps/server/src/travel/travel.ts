// Travel between worlds (backlog M3; design: docs/sim/TRAVEL.md).
//
// A resident's home is the world it was born in. Every world it has visited keeps a local incarnation (an ordinary
// Soul row and body, same owner); exactly one is present. Travelling makes the destination's incarnation present and
// puts the origin's away (the fade's beam-up; acts refused except travel). Worlds talk only through the launcher's
// loopback relay with the site key (SIM_SITE_URL, SIM_SITE_KEY); nothing but a small passport crosses, and each
// world's history stays in its own database.
import {randomBytes, timingSafeEqual} from 'node:crypto';
import type {Db, SoulRow} from '../db.ts';
import type {Souls} from '../souls.ts';
import type {WorldHost} from '../world.ts';

export const TRAVEL_CONTRACT = 'travel/1';
const LOG_KEEP = 20, ARRIVE_READY_MS = 30_000, RELAY_MS = 60_000;

export class TravelError extends Error {
  readonly status: number; readonly code: string; readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
export type LogEntry = {at: number; kind: 'travel' | 'refused' | 'recalled'; from: string; fromName: string; to: string; toName: string; code?: string; note?: string};
export type Passport = {contract: typeof TRAVEL_CONTRACT; requestId: string; traveller: string; home: string; homeSoulId: string; name: string; description: string;
  owner: string; body: unknown; bodyNote: string | null; from: string; fromName: string; log: LogEntry[]};
type State = 'present' | 'away' | 'departing';
type Inc = {soul_id: string; traveller: string; home: string; state: State; at: string | null; request_id: string | null; log: string; updated_at: number};
type FadingLike = {enabled: boolean; depart(soulId: string, text: string, data?: Record<string, unknown>): boolean; arrive(soulId: string, text: string, data?: Record<string, unknown>): boolean; addAway(a: (soulId: string) => boolean): void};
export type Relay = (to: string, path: string, body: unknown) => Promise<{status: number; data: any}>;
export type SiteWorld = {slug: string; name: string};

export type TravelDeps = {
  host: WorldHost; db: Db; souls: Souls; fading: FadingLike | null;
  slug: string; name: string;
  /** The launcher's site relay; null when this world runs alone (travel then refuses). */
  site: {worlds(): Promise<SiteWorld[]>; relay: Relay} | null;
  invalidateBodies?(): void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** A body the destination can wear: a kit look or a shipped preset. An owner's uploaded GLB lives in its home world's store. */
export function portableBody(body: unknown): {body: unknown; note: string | null} {
  if (body === undefined || body === null) return {body: null, note: null};
  const model = (body as {model?: unknown}).model;
  if (typeof model === 'string' && /^body_[a-f0-9]{64}$/.test(model)) return {body: null, note: 'an uploaded body stays in its home world; the default look is worn here'};
  return {body: structuredClone(body), note: null};
}
/** Keep the most recent entries. */
export const appendLog = (log: LogEntry[], e: LogEntry) => [...log, e].slice(-LOG_KEEP);

export class Travel {
  readonly d: TravelDeps;
  private sql: Db['db'];
  constructor(d: TravelDeps) {
    this.d = d; this.sql = d.db.db;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS travel_settings_v1 (world_id TEXT PRIMARY KEY, open INTEGER NOT NULL, changed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS travel_incarnations_v1 (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, traveller TEXT NOT NULL, home TEXT NOT NULL, state TEXT NOT NULL,
        at TEXT, request_id TEXT, log TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL, PRIMARY KEY (world_id, soul_id)) WITHOUT ROWID;
      CREATE UNIQUE INDEX IF NOT EXISTS travel_incarnations_v1_traveller ON travel_incarnations_v1 (world_id, traveller);
      CREATE TABLE IF NOT EXISTS travel_where_v1 (world_id TEXT NOT NULL, traveller TEXT NOT NULL, at TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (world_id, traveller)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS travel_requests_v1 (world_id TEXT NOT NULL, request_id TEXT NOT NULL, traveller TEXT NOT NULL, soul_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, request_id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS travel_events_v1 (id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL, at INTEGER NOT NULL, traveller TEXT NOT NULL, soul_id TEXT,
        name TEXT NOT NULL, kind TEXT NOT NULL, other TEXT, other_name TEXT, code TEXT);`);
    d.fading?.addAway(soulId => this.inc(soulId)?.state === 'away');
  }
  private get world() { return this.d.host.worldId; }
  private now() { return (this.d.now ?? Date.now)(); }

  // ---------------------------------------------------------------- state
  get open(): boolean { const r = this.sql.prepare('SELECT open FROM travel_settings_v1 WHERE world_id=?').get(this.world) as {open: number} | undefined; return r ? r.open === 1 : true; }
  setOpen(open: boolean) { this.sql.prepare('INSERT INTO travel_settings_v1 (world_id, open, changed_at) VALUES (?,?,?) ON CONFLICT (world_id) DO UPDATE SET open=excluded.open, changed_at=excluded.changed_at').run(this.world, open ? 1 : 0, this.now()); return this.open; }
  inc(soulId: string) { return this.sql.prepare('SELECT * FROM travel_incarnations_v1 WHERE world_id=? AND soul_id=?').get(this.world, soulId) as Inc | undefined; }
  private incOf(traveller: string) { return this.sql.prepare('SELECT * FROM travel_incarnations_v1 WHERE world_id=? AND traveller=?').get(this.world, traveller) as Inc | undefined; }
  /** This Soul's travel identity: its row, or (never travelled) a resident born here. */
  identity(soul: SoulRow): {traveller: string; home: string; state: State; at: string | null; log: LogEntry[]} {
    const r = this.inc(soul.id);
    return r ? {traveller: r.traveller, home: r.home, state: r.state, at: r.at, log: JSON.parse(r.log)} : {traveller: `${this.d.slug}/${soul.id}`, home: this.d.slug, state: 'present', at: null, log: []};
  }
  isAway(soulId: string) { const s = this.inc(soulId)?.state; return s === 'away' || s === 'departing'; }
  private put(soulId: string, v: {traveller: string; home: string; state: State; at: string | null; requestId?: string | null; log: LogEntry[]}) {
    this.sql.prepare(`INSERT INTO travel_incarnations_v1 (world_id, soul_id, traveller, home, state, at, request_id, log, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT (world_id, soul_id) DO UPDATE SET state=excluded.state, at=excluded.at, request_id=excluded.request_id, log=excluded.log, updated_at=excluded.updated_at`)
      .run(this.world, soulId, v.traveller, v.home, v.state, v.at, v.requestId ?? null, JSON.stringify(v.log), this.now());
  }
  private setState(soulId: string, state: State, at: string | null, log?: LogEntry[]) {
    const r = this.inc(soulId)!; this.put(soulId, {...r, state, at, requestId: r.request_id, log: log ?? JSON.parse(r.log)});
  }
  private event(traveller: string, soulId: string | null, name: string, kind: string, other?: string | null, otherName?: string | null, code?: string | null) {
    this.sql.prepare('INSERT INTO travel_events_v1 (world_id, at, traveller, soul_id, name, kind, other, other_name, code) VALUES (?,?,?,?,?,?,?,?,?)').run(this.world, this.now(), traveller, soulId, name, kind, other ?? null, otherName ?? null, code ?? null);
  }
  private setWhere(traveller: string, at: string) {
    this.sql.prepare('INSERT INTO travel_where_v1 (world_id, traveller, at, updated_at) VALUES (?,?,?,?) ON CONFLICT (world_id, traveller) DO UPDATE SET at=excluded.at, updated_at=excluded.updated_at').run(this.world, traveller, at, this.now());
  }
  private whereOf(traveller: string) { return (this.sql.prepare('SELECT at FROM travel_where_v1 WHERE world_id=? AND traveller=?').get(this.world, traveller) as {at: string} | undefined)?.at ?? null; }

  /** What a Soul's agent or owner sees: where it is, where home is, the carried log, and whether this world takes visitors. */
  status(soul: SoulRow) {
    const id = this.identity(soul);
    return {contract: TRAVEL_CONTRACT, traveller: id.traveller, name: soul.name, here: this.d.slug, hereName: this.d.name, home: id.home, atHome: id.home === this.d.slug,
      state: id.state, at: id.state === 'present' ? this.d.slug : id.at, log: id.log, available: !!this.d.site && !!this.d.fading?.enabled, open: this.open};
  }
  /** The public visitor view of this world (names and where they came from; no owners). */
  visitors() {
    const present = (this.sql.prepare("SELECT i.soul_id, i.traveller, i.home, s.name FROM travel_incarnations_v1 i JOIN souls s ON s.id=i.soul_id WHERE i.world_id=? AND i.state='present' AND i.home<>? AND s.retired_at IS NULL").all(this.world, this.d.slug) as {soul_id: string; traveller: string; home: string; name: string}[])
      .map(r => ({soulId: r.soul_id, name: r.name, home: r.home}));
    const recent = (this.sql.prepare('SELECT at, name, kind, other, other_name, code FROM travel_events_v1 WHERE world_id=? ORDER BY id DESC LIMIT 20').all(this.world) as {at: number; name: string; kind: string; other: string | null; other_name: string | null; code: string | null}[])
      .map(r => ({at: r.at, name: r.name, kind: r.kind, world: r.other, worldName: r.other_name, ...(r.code ? {code: r.code} : {})}));
    return {contract: TRAVEL_CONTRACT, world: this.d.slug, open: this.open, visitors: present, recent};
  }

  // ---------------------------------------------------------------- leaving
  private async resolveWorld(raw: string): Promise<SiteWorld> {
    const all = await this.d.site!.worlds().catch(() => { throw new TravelError(503, 'travel.unavailable', 'The list of worlds on this site is not available right now; try again.'); });
    const want = raw.trim().toLowerCase();
    const w = all.find(x => x.slug === want) ?? all.find(x => x.name.toLowerCase() === want);
    if (!w) throw new TravelError(404, 'travel.unknown-world', `There is no world "${raw}" on this site.`, {worlds: all.map(x => x.slug)});
    return w;
  }
  /** Travel `soul` (present here, or away here when this is its home: a recall) to the world `toRaw` (slug, name or "home"). */
  async travel(soul: SoulRow, toRaw: string, opts: {by: 'agent' | 'owner'} = {by: 'agent'}) {
    if (!this.d.site || !this.d.fading?.enabled) throw new TravelError(503, 'travel.unavailable', 'This world does not connect to other worlds.');
    if (typeof toRaw !== 'string' || !toRaw.trim() || toRaw.length > 80) throw new TravelError(400, 'invalid', 'body must be JSON {"to": "<world slug or name>" | "home"}');
    const id = this.identity(soul), home = toRaw.trim().toLowerCase() === 'home';
    if (id.state === 'departing') throw new TravelError(409, 'travel.busy', `${soul.name} is already on the way to ${id.at}.`);
    if (id.state === 'away') {
      if (home && id.home === this.d.slug) return this.recall(soul, id);
      throw new TravelError(409, 'travel.away', `${soul.name} is not in this world now (it is in ${id.at}).`, {at: id.at});
    }
    const dest = home ? await this.resolveWorld(id.home).catch(e => { if (e instanceof TravelError && e.code === 'travel.unknown-world') throw new TravelError(410, 'travel.home-gone', `${soul.name}'s home world ${id.home} is no longer on this site.`); throw e; }) : await this.resolveWorld(toRaw);
    if (dest.slug === this.d.slug) throw new TravelError(409, 'travel.same-world', `${soul.name} is already in ${this.d.name}.`);
    const requestId = 'tr_' + randomBytes(16).toString('hex'), existed = !!this.inc(soul.id), engineBody = (this.d.host.engine.world.entities as Record<string, {body?: unknown}>)[soul.entity_id]?.body;
    const {body, note} = portableBody(engineBody);
    const leaving: LogEntry = {at: this.now(), kind: 'travel', from: this.d.slug, fromName: this.d.name, to: dest.slug, toName: dest.name, ...(note ? {note} : {})};
    this.put(soul.id, {traveller: id.traveller, home: id.home, state: 'departing', at: dest.slug, requestId, log: id.log});
    const passport: Passport = {contract: TRAVEL_CONTRACT, requestId, traveller: id.traveller, home: id.home, homeSoulId: id.traveller.slice(id.home.length + 1), name: soul.name, description: soul.description,
      owner: soul.owner, body, bodyNote: note, from: this.d.slug, fromName: this.d.name, log: appendLog(id.log, leaving)};
    let r: {status: number; data: any};
    try { r = await this.d.site.relay(dest.slug, '/v1/site/arrive', passport); }
    catch (e) { r = {status: 503, data: {code: 'travel.unreachable', message: `${dest.name} did not answer (${(e as Error).message}).`}}; }
    if (r.status !== 200 || !r.data?.ok) {
      const code = typeof r.data?.code === 'string' ? r.data.code : 'travel.refused', message = typeof r.data?.message === 'string' ? r.data.message : `${dest.name} did not admit ${soul.name}.`;
      const refused: LogEntry = {at: this.now(), kind: 'refused', from: this.d.slug, fromName: this.d.name, to: dest.slug, toName: dest.name, code};
      if (existed) this.setState(soul.id, 'present', null, appendLog(id.log, refused));
      else this.sql.prepare('DELETE FROM travel_incarnations_v1 WHERE world_id=? AND soul_id=?').run(this.world, soul.id);
      this.event(id.traveller, soul.id, soul.name, 'refused', dest.slug, dest.name, code);
      // B may have admitted before failing to answer: ask it to let go (it reconciles with home at boot otherwise).
      if (code === 'travel.unreachable') void this.d.site.relay(dest.slug, '/v1/site/release', {traveller: id.traveller, requestId, reason: 'origin gave up'}).catch(() => {});
      throw new TravelError(r.status >= 400 && r.status < 600 ? r.status : 502, code, message, {to: dest.slug});
    }
    const log: LogEntry[] = Array.isArray(r.data.log) ? r.data.log : appendLog(id.log, leaving);
    this.setState(soul.id, 'away', dest.slug, log);
    this.d.fading.depart(soul.id, `You leave ${this.d.name} for ${dest.name}.`, {to: dest.slug});
    this.event(id.traveller, soul.id, soul.name, 'left', dest.slug, dest.name);
    await this.informHome(id.traveller, id.home, dest.slug);
    return {contract: TRAVEL_CONTRACT, ok: true, traveller: id.traveller, from: this.d.slug, fromName: this.d.name, to: dest.slug, toName: dest.name, soulId: r.data.soulId as string,
      name: r.data.name as string, token: opts.by === 'agent' ? r.data.token as string : undefined, returned: !!r.data.returned, created: !!r.data.created, atHome: dest.slug === id.home, home: id.home, log};
  }
  /** Home is the authority on where its resident is: record it (locally when this is home). */
  private async informHome(traveller: string, home: string, at: string) {
    if (home === this.d.slug) { this.setWhere(traveller, at); return; }
    await this.d.site!.relay(home, '/v1/site/where', {traveller, at}).catch(() => { /* home reconciles: arrivals ask it at boot */ });
  }
  /** At home, a resident that is away elsewhere comes back now: the other world is asked to let go, and home wins if it does not answer. */
  private async recall(soul: SoulRow, id: ReturnType<Travel['identity']>) {
    const at = this.whereOf(id.traveller) ?? id.at;
    let released: string = 'not-asked';
    if (at && at !== this.d.slug) {
      try { const r = await this.d.site!.relay(at, '/v1/site/release', {traveller: id.traveller, reason: 'called home'}); released = r.status === 200 ? (r.data?.released ? 'released' : 'not-there') : `refused:${r.status}`; }
      catch { released = 'unreachable'; }
    }
    const atName = at ?? 'elsewhere', entry: LogEntry = {at: this.now(), kind: 'recalled', from: atName, fromName: atName, to: this.d.slug, toName: this.d.name, note: released};
    this.setState(soul.id, 'present', null, appendLog(id.log, entry));
    this.d.fading!.arrive(soul.id, `You come home to ${this.d.name}.`, {from: at});
    this.setWhere(id.traveller, this.d.slug);
    this.event(id.traveller, soul.id, soul.name, 'came-home', at, at, released === 'released' ? null : released);
    return {contract: TRAVEL_CONTRACT, ok: true, traveller: id.traveller, from: at, fromName: atName, to: this.d.slug, toName: this.d.name, soulId: soul.id, name: soul.name, recalled: true, released, atHome: true, home: id.home, log: appendLog(id.log, entry)};
  }

  // ---------------------------------------------------------------- arriving (site routes; the launcher relays)
  async arrive(p: Passport) {
    if (!p || p.contract !== TRAVEL_CONTRACT || typeof p.requestId !== 'string' || !/^tr_[a-f0-9]{32}$/.test(p.requestId) || typeof p.traveller !== 'string' || typeof p.home !== 'string'
      || p.traveller !== `${p.home}/${p.homeSoulId}` || typeof p.owner !== 'string' || !p.owner || typeof p.name !== 'string' || typeof p.from !== 'string' || !Array.isArray(p.log))
      throw new TravelError(400, 'invalid', 'not a travel/1 passport');
    const done = this.sql.prepare('SELECT soul_id FROM travel_requests_v1 WHERE world_id=? AND request_id=?').get(this.world, p.requestId) as {soul_id: string} | undefined;
    if (done && this.inc(done.soul_id)?.state === 'present') return this.admitted(p, done.soul_id, false, true);
    const atHome = p.home === this.d.slug;
    let soulId: string, created = false, returned = false;
    if (atHome) {
      // a world never refuses its own resident coming home (closed or not)
      const row = this.d.db.soul(p.homeSoulId), inc = this.inc(p.homeSoulId);
      if (!row || row.retired_at !== null || row.world_id !== this.world) throw new TravelError(410, 'travel.home-gone', `${p.name} no longer lives in ${this.d.name}.`);
      if (inc && inc.state === 'present') return this.admitted(p, row.id, false, true);
      soulId = row.id; returned = true;
      this.put(soulId, {traveller: p.traveller, home: p.home, state: 'present', at: null, log: p.log});
      this.d.fading?.arrive(soulId, `You come home to ${this.d.name} from ${p.fromName}.`, {from: p.from});
    } else {
      if (!this.open) { this.event(p.traveller, null, p.name, 'refused', p.from, p.fromName, 'travel.closed'); throw new TravelError(403, 'travel.closed', `${this.d.name} is closed to visitors.`); }
      const inc = this.incOf(p.traveller), row = inc ? this.d.db.soul(inc.soul_id) : undefined;
      if (inc && row && row.retired_at === null) {
        soulId = row.id; returned = true;
        if (inc.state !== 'present') { this.put(soulId, {traveller: p.traveller, home: p.home, state: 'present', at: null, log: p.log}); this.d.fading?.arrive(soulId, `You arrive in ${this.d.name} from ${p.fromName}.`, {from: p.from}); }
      } else {
        if (inc) this.sql.prepare('DELETE FROM travel_incarnations_v1 WHERE world_id=? AND soul_id=?').run(this.world, inc.soul_id);
        soulId = await this.newcomer(p); created = true;
        this.put(soulId, {traveller: p.traveller, home: p.home, state: 'present', at: null, log: p.log});
      }
    }
    this.sql.prepare('INSERT OR REPLACE INTO travel_requests_v1 (world_id, request_id, traveller, soul_id, at) VALUES (?,?,?,?,?)').run(this.world, p.requestId, p.traveller, soulId, this.now());
    if (atHome) this.setWhere(p.traveller, this.d.slug);
    const worn=await this.wear(soulId, p.body);
    if(p.body&&!worn){const inc=this.inc(soulId)!,log=JSON.parse(inc.log) as LogEntry[];if(log.length)log[log.length-1].note='The destination did not admit the carried body; its existing body is retained.';this.sql.prepare('UPDATE travel_incarnations_v1 SET log=? WHERE world_id=? AND soul_id=?').run(JSON.stringify(log),this.world,soulId);}
    this.event(p.traveller, soulId, p.name, atHome ? 'came-home' : 'arrived', p.from, p.fromName);
    return this.admitted(p, soulId, created, returned);
  }
  private admitted(p: Passport, soulId: string, created: boolean, returned: boolean) {
    const row = this.d.db.soul(soulId)!;
    return {contract: TRAVEL_CONTRACT, ok: true, soulId, name: row.name, world: this.d.slug, worldName: this.d.name, created, returned, token: this.d.souls.travelToken(soulId), log: JSON.parse(this.inc(soulId)!.log) as LogEntry[]};
  }
  /** A first visit: a new Soul here through the native lifecycle (birth, admission), owned by the same account. */
  private async newcomer(p: Passport): Promise<string> {
    const {db, souls, host} = this.d;
    if (!db.user(p.owner)) db.upsertUser({id: p.owner, email: null, wallet: null, role: 'user'});
    if (db.soulByName(this.world, p.name)) throw new TravelError(409, 'travel.name-taken', `Someone in ${this.d.name} is already called ${p.name}.`);
    let op;
    try { op = souls.acceptLifecycleCreate(p.owner, {name: p.name, ...(p.description?.trim().length >= 3 ? {description: p.description} : {})}, undefined, true); }
    catch (e) { const x = e as {status?: number; code?: string; message?: string}; throw new TravelError(x.status ?? 409, `travel.${x.code ?? 'refused'}`, x.message ?? 'arrival refused'); }
    const id = op.scope.soulId, until = this.now() + ARRIVE_READY_MS;
    for (;;) {
      const row = db.soul(id);
      if (row && row.retired_at === null && host.minds.get(id) && souls.controlReady(row)) return id;
      if (row?.retired_at !== null && row?.retired_at !== undefined) throw new TravelError(409, 'travel.no-room', `${this.d.name} had no safe place for ${p.name} to arrive.`);
      if (this.now() > until) throw new TravelError(504, 'travel.arrival-slow', `${p.name}'s arrival in ${this.d.name} did not finish in time; try again.`);
      await (this.d.sleep ?? sleep)(50);
    }
  }
  /** Put on the carried body (an ordinary body-assignment-v1 event; the engine's safe-swap check applies). */
  private async wear(soulId: string, body: unknown) {
    if (body === null || body === undefined) return false;
    const {host} = this.d, entityId = this.d.db.soul(soulId)!.entity_id;
    const engine = host.engine as unknown as {world: {entities: Record<string, {body?: unknown}>}; bodyAssignmentProblemV1?(id: string, body: unknown): string | null};
    if (!engine.bodyAssignmentProblemV1) return false;
    for (let i = 0; i < 100; i++) {
      const ent = engine.world.entities[entityId];
      if(engine.bodyAssignmentProblemV1!(entityId,body)==='body.world-policy')return false;
      if (ent && JSON.stringify(ent.body) === JSON.stringify(body)) return true;
      const guard = (): true => { const e = engine.world.entities[entityId]; if (!e || host.quietBarrier || engine.bodyAssignmentProblemV1!(entityId, body)) throw new Error('travel.body-not-ready'); return true; };
      try { guard(); await host.enqueueChecked('body-assignment-v1', 'world:body', {contract: 'body-assignment/1', worldId: this.world, soulId, entityId, body: structuredClone(body)}, guard, () => true); this.d.invalidateBodies?.(); }
      catch { /* not standing still yet (or the birth look landed in between): try again */ }
      await (this.d.sleep ?? sleep)(100);
    }
    return false;
  }
  /** Home records where its resident is now. */
  where(traveller: string, at: string) {
    if (typeof traveller !== 'string' || !traveller.startsWith(`${this.d.slug}/`) || typeof at !== 'string') throw new TravelError(400, 'invalid', 'only the home world keeps where its residents are');
    this.setWhere(traveller, at); return {ok: true};
  }
  whereIs(traveller: string) {
    if (typeof traveller !== 'string' || !traveller.startsWith(`${this.d.slug}/`)) throw new TravelError(400, 'invalid', 'not a resident of this world');
    const inc = this.incOf(traveller);
    return {ok: true, at: inc?.state === 'present' || !inc ? this.d.slug : (this.whereOf(traveller) ?? inc.at)};
  }
  presence(traveller: string) { const inc = this.incOf(traveller); return {ok: true, present: inc?.state === 'present', state: inc?.state ?? null, soulId: inc?.soul_id ?? null}; }
  /** Let a visitor go (its home called it back, or its origin gave up on the arrival). Never applies to residents at home. */
  release(traveller: string, reason: string) {
    const inc = this.incOf(traveller);
    if (!inc || inc.state !== 'present' || inc.home === this.d.slug) return {ok: true, released: false, state: inc?.state ?? null};
    const row = this.d.db.soul(inc.soul_id);
    this.setState(inc.soul_id, 'away', inc.home);
    this.d.fading?.depart(inc.soul_id, `You are called home${reason ? ` (${reason})` : ''}.`, {to: inc.home});
    this.event(traveller, inc.soul_id, row?.name ?? traveller, 'released', inc.home, inc.home, null);
    return {ok: true, released: true};
  }
  /** After a restart: settle departures that were in flight, and visitors whose home says they are elsewhere. */
  async reconcile() {
    if (!this.d.site) return [];
    const out: string[] = [];
    for (const r of this.sql.prepare("SELECT * FROM travel_incarnations_v1 WHERE world_id=? AND (state='departing' OR (state='present' AND home<>?))").all(this.world, this.d.slug) as Inc[]) {
      try {
        if (r.state === 'departing') {
          const p = await this.d.site.relay(r.at!, '/v1/site/presence', {traveller: r.traveller});
          if (p.status !== 200) continue;
          if (p.data?.present) { this.setState(r.soul_id, 'away', r.at); this.d.fading?.depart(r.soul_id, 'You have left.'); out.push(`${r.soul_id}: away`); }
          else { this.setState(r.soul_id, 'present', null); out.push(`${r.soul_id}: stayed`); }
        } else {
          const w = await this.d.site.relay(r.home, '/v1/site/where-is', {traveller: r.traveller});
          if (w.status === 200 && typeof w.data?.at === 'string' && w.data.at !== this.d.slug) { this.release(r.traveller, 'you were elsewhere'); out.push(`${r.soul_id}: released`); }
        }
      } catch { /* the other world is not up; next boot */ }
    }
    return out;
  }
}

/** The world's side of the launcher's site: requests carry the site key and never come through the public proxy. */
export function siteRequestOk(key: string | undefined, header: string | undefined, forwarded: string | undefined) {
  if (!key || !header || forwarded) return false;
  const a = Buffer.from(key), b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** The launcher's relay, as this world sees it (SIM_SITE_URL is the launcher origin + base). */
export function launcherSite(url: string | undefined, key: string | undefined): TravelDeps['site'] {
  if (!url || !key) return null;
  const headers = {'content-type': 'application/json', 'x-sim-site-key': key};
  return {
    async worlds() { const r = await fetch(`${url}/__sim/site/worlds`, {headers, signal: AbortSignal.timeout(10_000)}); if (!r.ok) throw new Error(`site ${r.status}`); return ((await r.json()) as {worlds: SiteWorld[]}).worlds; },
    async relay(to, path, body) {
      const r = await fetch(`${url}/__sim/site/relay`, {method: 'POST', headers, body: JSON.stringify({to, path, body}), signal: AbortSignal.timeout(RELAY_MS)});
      const data = await r.json().catch(() => ({}));
      return {status: r.status, data};
    },
  };
}
