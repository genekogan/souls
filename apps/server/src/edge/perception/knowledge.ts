// knowledge/1 (R13, knowledge at several scales): what a Soul knows of the world beyond what it sees.
//
//  - near   : `here` already lists what is in sight (people, things, talk) in detail;
//  - district: the district the Soul is in (the top-level place holding it) is summarised: how many people are out in
//              it, its busiest outdoor places and what is on there now — counts and place names, never who;
//  - far    : other districts are names and compass directions only, unless the Soul has been there: then it also
//              knows how far, and which places in it it has visited (memory of visits, durable per Soul);
//  - explore: `GET /v1/edge/around` (look around) lists more of what is near (descriptions, the people and things a
//              little farther off) and finds secret places close by;
//  - secret : the world's creator can mark a place secret (PLACE-DATA `secret: true`, or the god's
//              POST /v1/god/places/secret). A secret place and everything inside it is left out of the public map, the
//              boot catalogue, exits, walks and `far` until this Soul has been inside it or found it by looking around.
//              Its geometry stays public (the renderer draws the world); only its name and listings are withheld.
//
// Read-mostly and deterministic for a given world state; writes are small upserts on place change or discovery.
import {secretMatcher, type Secrets} from './public-scrub.ts';
import type {Place} from '../ledger/places.ts';
import {centroid, happenings, inPoly} from '../ledger/places.ts';
import type {EdgeLedger} from '../ledger/ledger.ts';
import {compassOf, compassPoint, dist2} from './geometry.ts';

type V2 = [number, number];
export type Known = {visits: number; firstTick: number; lastTick: number; how: 'visited' | 'found'};
/** Secret places within this many metres (edge of the place) are found by looking around. */
export const FIND_RADIUS = 25;
const FAR_LISTED = 6;
const parentOf = (p: Place) => p.semanticParent === undefined ? p.parent : p.semanticParent;
const area = (p: V2[]) => Math.abs(p.reduce((s, [x, z], i) => {const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z;}, 0)) / 2;

export class PlaceKnowledge {
  private readonly L: EdgeLedger;
  private readonly memo = new Map<string, Map<string, Known>>();
  private secretsCache: {size: number; set: Set<string>} | null = null;
  /** Bumped whenever the set of secret places changes (callers that cache place listings compare it). */
  version = 0;
  constructor(L: EdgeLedger) {
    this.L = L;
    L.db.db.exec(`CREATE TABLE IF NOT EXISTS edge_place_knowledge_v1 (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, place_id TEXT NOT NULL,
      how TEXT NOT NULL, visits INTEGER NOT NULL, first_tick INTEGER NOT NULL, last_tick INTEGER NOT NULL, PRIMARY KEY (world_id, soul_id, place_id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS edge_place_secrets_v1 (world_id TEXT NOT NULL, place_id TEXT NOT NULL, secret INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, place_id)) WITHOUT ROWID;`);
  }
  private matcher: {version: number; places: number; re: Secrets | null} | null = null;
  private get w() {return this.L.host.worldId;}

  // ------------------------------------------------------------ secrets
  /** The god's settings: place id → secret (true) or explicitly public (false, overrides PLACE-DATA). */
  private overrides(): Map<string, boolean> {
    return new Map((this.L.db.db.prepare('SELECT place_id, secret FROM edge_place_secrets_v1 WHERE world_id=?').all(this.w) as {place_id: string; secret: number}[]).map(r => [r.place_id, r.secret === 1]));
  }
  /** Places marked secret themselves (not counting their insides). */
  marked(): Set<string> {
    // keyed on the place count: a god edit that adds or removes places re-derives (a re-added place keeps its id)
    if (this.secretsCache && this.secretsCache.size === this.L.places.version) return this.secretsCache.set;
    const o = this.overrides(), out = new Set<string>();
    for (const p of this.L.places.byId.values()) if (o.get(p.id) ?? (p as Place & {secret?: boolean}).secret === true) out.add(p.id);
    for (const [id, on] of o) if (on && this.L.places.byId.has(id)) out.add(id);
    this.secretsCache = {size: this.L.places.version, set: out}; return out;   // keyed on the index version: a replaced place (same count) re-derives
  }
  /** The outermost secret place holding (or being) this place, by the parent chain; null when nothing about it is secret. */
  secretRoot(placeId: string): string | null {
    const marked = this.marked(); if (!marked.size) return null;
    let root: string | null = null, p = this.L.places.byId.get(placeId); const seen = new Set<string>();
    while (p && !seen.has(p.id)) {seen.add(p.id); if (marked.has(p.id)) root = p.id; p = p.parent ? this.L.places.byId.get(p.parent) : undefined;}
    return root;
  }
  isSecret(placeId: string): boolean {return this.secretRoot(placeId) !== null;}
  /** Can this Soul know of the place? Public places: always. Secret ones: once it has been inside or found it. */
  knows(soulId: string | null, placeId: string): boolean {
    const root = this.secretRoot(placeId); if (root === null) return true; if (!soulId) return false;
    return this.memory(soulId).has(root);
  }
  /** Mark (or unmark) a place secret. Returns false for an unknown place. */
  setSecret(placeId: string, secret: boolean): boolean {
    if (!this.L.places.byId.has(placeId)) return false;
    this.L.db.db.prepare('INSERT INTO edge_place_secrets_v1 (world_id, place_id, secret, at) VALUES (?,?,?,?) ON CONFLICT(world_id, place_id) DO UPDATE SET secret=excluded.secret, at=excluded.at')
      .run(this.w, placeId, secret ? 1 : 0, Date.now());
    this.changed(); return true;
  }
  /** Places change (a god edit re-derives them): drop caches. */
  changed() {this.secretsCache = null; this.matcher = null; this.version++; this.L.invalidateBodies();}
  /** Read worker: main writes visits and secrets; forget what was read so the next read sees the database (WAL). */
  reload() {this.memo.clear(); this.secretsCache = null; this.matcher = null;}
  /** Everything a secret place, or anything inside one, goes by, for answers anyone can read. */
  publicMatcher(): Secrets | null {
    if (this.matcher?.version === this.version && this.matcher.places === this.L.places.version) return this.matcher.re;
    const hidden = [...this.L.places.byId.values()].filter((p) => this.isSecret(p.id));
    // a seat or a rider's slot has its own id and goes by its place's name
    const occupiers = [...this.L.places.occupierOf.values()].filter((o) => this.isSecret(o.place.id)).map((o) => o.occ.id);
    const re = secretMatcher([...hidden.flatMap((p) => [p.id, (p as Place & {ref?: unknown}).ref]), ...occupiers], hidden.map((p) => p.name)); this.matcher = {version: this.version, places: this.L.places.version, re}; return re;
  }
  secrets(): {id: string; name: string}[] {return [...this.marked()].sort().map(id => ({id, name: this.L.places.byId.get(id)?.name ?? id}));}

  // ------------------------------------------------------------ memory of visits
  memory(soulId: string): Map<string, Known> {
    let m = this.memo.get(soulId); if (m) return m;
    m = new Map((this.L.db.db.prepare('SELECT place_id, how, visits, first_tick, last_tick FROM edge_place_knowledge_v1 WHERE world_id=? AND soul_id=?').all(this.w, soulId) as {place_id: string; how: string; visits: number; first_tick: number; last_tick: number}[])
      .map(r => [r.place_id, {visits: r.visits, firstTick: r.first_tick, lastTick: r.last_tick, how: r.how === 'found' ? 'found' : 'visited'} as Known]));
    this.memo.set(soulId, m); return m;
  }
  /** Read worker (L.readOnly): the visits/finds a read records, for main to merge (the worker's database is read-only). */
  readonly outbox: {soulId: string; placeId: string; k: Known}[] = [];
  /** Main: a read worker's recorded visits/finds, merged as touch/find would (a visit beats a find; never downgraded). */
  merge(rows: readonly {soulId: string; placeId: string; k: Known}[]) {
    for (const r of rows) {
      const have = this.memory(r.soulId).get(r.placeId);
      if (have?.how === 'visited' || (have && r.k.how === 'found')) continue;
      this.write(r.soulId, r.placeId, have ? {...r.k, firstTick: have.firstTick} : r.k);
    }
  }
  private write(soulId: string, placeId: string, k: Known) {
    this.memory(soulId).set(placeId, k);
    if (this.L.readOnly) {if (this.outbox.length < 4096) this.outbox.push({soulId, placeId, k}); return;}
    this.L.db.db.prepare(`INSERT INTO edge_place_knowledge_v1 (world_id, soul_id, place_id, how, visits, first_tick, last_tick) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(world_id, soul_id, place_id) DO UPDATE SET how=excluded.how, visits=excluded.visits, last_tick=excluded.last_tick`).run(this.w, soulId, placeId, k.how, k.visits, k.firstTick, k.lastTick);
  }
  /** The Soul arrived in these places (innermost first): a visit to each it was not already in. */
  arrive(soulId: string, placeIds: readonly string[], tick: number, previous: readonly string[] = []) {
    const before = new Set(previous);
    for (const id of placeIds) {
      if (!memorable(this.L.places.byId.get(id))) continue;
      const k = this.memory(soulId).get(id);
      if (k && before.has(id)) continue;
      this.write(soulId, id, {visits: (k?.how === 'visited' ? k.visits : 0) + 1, firstTick: k?.firstTick ?? tick, lastTick: tick, how: 'visited'});
    }
  }
  /** Being somewhere counts as having been there (a Soul standing in a place since before this feature). */
  touch(soulId: string, placeIds: readonly string[], tick: number) {
    const mem = this.memory(soulId);
    for (const id of placeIds) if (memorable(this.L.places.byId.get(id)) && mem.get(id)?.how !== 'visited') this.write(soulId, id, {visits: 1, firstTick: mem.get(id)?.firstTick ?? tick, lastTick: tick, how: 'visited'});
  }
  /** Found by looking around (not been inside yet). */
  find(soulId: string, placeId: string, tick: number) {if (!this.memory(soulId).has(placeId)) this.write(soulId, placeId, {visits: 0, firstTick: tick, lastTick: tick, how: 'found'});}

  // ------------------------------------------------------------ scales
  /** Districts: the places directly under the world's root — except a ground cover (a place spanning half the world or
   *  more, like a god world's "Green field"), whose own children stand in for it. */
  private tops(): {list: Place[]; covers: Set<string>} {
    const all = [...this.L.places.byId.values()], root = all.find(p => p.parent === null); if (!root) return {list: [], covers: new Set()};
    const authored = all.filter(p => p.semanticRole === 'district' || p.semanticRole === 'quarter');
    if (authored.length) return {list: authored, covers: new Set()};
    const kids = (id: string) => all.filter(p => parentOf(p) === id && !p.carrier), whole = area(root.polygon), covers = new Set<string>(), list: Place[] = [];
    for (const p of kids(root.id)) {const inner = kids(p.id); if (whole > 0 && area(p.polygon) >= whole / 2 && inner.length) {covers.add(p.id); list.push(...inner);} else list.push(p);}
    return {list, covers};
  }
  /** The district holding this place (on a ground cover outside any district: the cover itself). */
  districtOf(placeId: string | null): Place | null {
    const {list, covers} = this.tops(), ids = new Set(list.map(p => p.id));
    let p = placeId ? this.L.places.byId.get(placeId) : undefined, cover: Place | null = null; const seen = new Set<string>();
    while (p && !seen.has(p.id)) {seen.add(p.id); if (ids.has(p.id)) return p; if (covers.has(p.id)) cover = p; const parent = parentOf(p); p = parent ? this.L.places.byId.get(parent) : undefined;}
    return cover;
  }
  private districts(): Place[] {return this.tops().list;}
  private within(p: Place, ancestor: string): boolean {
    let q: Place | undefined = p; const seen = new Set<string>();
    while (q && !seen.has(q.id)) {if (q.id === ancestor) return true; seen.add(q.id); const parent = parentOf(q); q = parent ? this.L.places.byId.get(parent) : undefined;}
    return false;
  }
  /** Who is where, counted: innermost outdoor (not enclosed) place → people. Enclosed rooms are never counted. */
  private crowd(exclude: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const m of this.L.host.minds.values()) {
      if (m.soulId === exclude || this.L.faded.has(m.soulId)) continue;
      if (this.L.enclosureOf(m.soulId)) continue;
      const path = this.L.placePathOf(m.soulId).filter(p => p.kind !== 'occupier' && p.kind !== 'carrier');
      const inner = path.find(p => this.L.places.byId.get(p.id)?.parent); if (inner) out.set(inner.id, (out.get(inner.id) ?? 0) + 1);
    }
    return out;
  }
  /** The district summary and the far-away names, for `here`. Short: a few dozen tokens. */
  scales(soulId: string, placePath: readonly string[], pos: V2 | null, minuteOfDay: number | null) {
    this.touch(soulId, placePath, this.L.mw.world.tick);
    const district = this.districtOf(placePath[0] ?? null), mem = this.memory(soulId);
    let summary: {name: string; people: number; busy?: string[]; on?: string[]} | undefined;
    if (district) {
      const crowd = this.crowd(soulId), counts = new Map<string, number>(); let people = 0;
      for (const [id, n] of crowd) {
        const p = this.L.places.byId.get(id); if (!p || !this.within(p, district.id) || !this.knows(soulId, id)) continue;
        people += n; if (id !== district.id && id !== placePath[0]) counts.set(p.name, (counts.get(p.name) ?? 0) + n);
      }
      const busy = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([name, n]) => `${name} ${n}`);
      const inside = [...this.L.places.byId.values()].filter(p => this.within(p, district.id) && this.knows(soulId, p.id));
      const on = minuteOfDay === null ? [] : happenings(inside, minuteOfDay, pos, 2, 0).filter(h => h.now).map(h => `${h.label} @ ${h.place}`);
      summary = {name: district.name, people, ...(busy.length ? {busy} : {}), ...(on.length ? {on} : {})};
    }
    const landmarks = [...this.L.places.byId.values()].filter(p => p.semanticRole === 'landmark' && (p.salience ?? 0) >= 2);
    const farPlaces = [...new Map([...this.districts(), ...landmarks].map(p => [p.id,p])).values()];
    const others = farPlaces.filter(d => d.id !== district?.id && this.knows(soulId, d.id)).map(d => {const at = centroid(d.polygon); return {d, at, m: pos ? dist2(pos, at) : 0};})
      .sort((a, b) => { const nearA = a.m <= 160, nearB = b.m <= 160; return Number(nearB) - Number(nearA) || (nearA ? a.m - b.m : (b.d.salience ?? 0) - (a.d.salience ?? 0) || a.m - b.m) || a.d.id.localeCompare(b.d.id); });
    const far = others.slice(0, FAR_LISTED).map(({d, at, m}) => {
      const dir = pos ? compassPoint(compassOf(at[0] - pos[0], at[1] - pos[1])) : '?';
      const districtName = d.semanticRole === 'landmark' ? this.districtOf(d.id)?.name : undefined;
      const name = districtName && districtName !== d.name ? `${d.name} (${districtName})` : d.name;
      if (!mem.has(d.id)) return `${name} · ${dir}`;
      const been = [...mem].filter(([id, k]) => id !== d.id && k.how === 'visited' && this.L.places.byId.get(id) && this.within(this.L.places.byId.get(id)!, d.id))
        .sort((a, b) => b[1].lastTick - a[1].lastTick || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, 2).map(([id]) => this.L.places.byId.get(id)!.name);   // ties (a room and its house, one tick) in id order, not memory order
      return `${name} · ${dir} ${Math.round(m / 10) * 10}m${been.length ? ` · been: ${been.join(', ')}` : ' · been'}`;
    });
    return {...(summary ? {district: summary} : {}), far, ...(others.length > FAR_LISTED ? {farMore: others.length - FAR_LISTED} : {})};
  }
  /** Secret places close enough to be found by looking around from here (not yet known). */
  findable(soulId: string, pos: V2, level: number): Place[] {
    const out: Place[] = [];
    for (const id of this.marked()) {
      if (this.memory(soulId).has(id)) continue;
      const p = this.L.places.byId.get(id); if (!p || Math.abs((p.level ?? 0) - level) > 1 || p.carrier) continue;   // a raised deck or a sunken garden is in view too
      if (inPoly(pos[0], pos[1], p.polygon) || edgeDistance(pos, p.polygon) <= FIND_RADIUS) out.push(p);
    }
    return out;
  }
}

/** Places worth remembering: not the world itself, not a personal sleeping mat. */
const memorable = (p: Place | undefined) => !!p && p.parent !== null && p.kind !== 'sleeping-mat' && !/(^|-)mat-\d+$/.test(p.id);
/** Distance from a point to a polygon's outline (m). */
export function edgeDistance(pt: V2, poly: V2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i], dx = bx - ax, dz = bz - az, len = dx * dx + dz * dz;
    const t = len ? Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - az) * dz) / len)) : 0;
    best = Math.min(best, Math.hypot(pt[0] - (ax + t * dx), pt[1] - (az + t * dz)));
  }
  return best;
}
