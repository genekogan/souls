// OWNER-DAY: "what my Soul did today", for its owner only. A read-only view over the Soul's own
// ledger records: terminal and open act receipts (what it did), the world's refusals with its reason,
// and the Soul's own speech (what it said). Every entry carries where it happened so the page can
// move the camera there. Nothing here is another owner's private text: only this Soul's rows.
import type {Context, Hono} from 'hono';
import {EDGE_CONTRACT, EdgeError, type EdgeSoul, edgeErrorOf} from './contract.ts';
import type {EdgeLedger} from './ledger/ledger.ts';
import type {Db} from '../db.ts';
import {SPOT_ACTIVITIES} from './ledger/activities.ts';

export type DayEntry = {
  at: number; kind: 'did' | 'doing' | 'stopped' | 'refused' | 'said';
  /** `cut`: begun but cut short by the Soul's own next act (a `replaced` receipt). */
  text: string; reason?: string; code?: string; cut?: true;
  where: {x: number; z: number} | null; place?: string | null;
};

// Plain past-tense words for an owner reading the day. Bare verbs (no target) and verbs with a target differ:
// `jog:here` is "went for a jog", `jog:park` is "jogged to the park". Spot activities fall back to their own
// labels in activities.ts ("Do yoga" -> "did yoga"); anything unknown reads as its verb.
const PAST: Record<string, string> = {
  walk: 'went for a walk', go: 'went out', sit: 'sat down', rest: 'rested', stand: 'stood', look: 'looked around', swim: 'went for a swim',
  hug: 'hugged someone', make: 'made something', 'pick-up': 'picked something up', 'put-down': 'put something down', accept: 'accepted an invitation',
  decline: 'declined an invitation', wave: 'waved', dance: 'danced', play: 'played', eat: 'ate', drink: 'had a drink',
  follow: 'followed someone', give: 'gave something', greet: 'greeted someone', sleep: 'slept', read: 'did some reading', watch: 'watched', visit: 'visited',
  stretch: 'did a stretch', yoga: 'did yoga', clap: 'clapped', jog: 'went for a jog', run: 'went for a run', fly: 'flew', ride: 'went for a ride',
  stargaze: 'watched the stars', bow: 'bowed', cheer: 'cheered', point: 'pointed', wait: 'waited', jump: 'jumped', 'jumping-jacks': 'did jumping jacks',
  pushups: 'did push-ups', situps: 'did sit-ups', write: 'wrote', paint: 'painted', cook: 'cooked', talk: 'talked', listen: 'listened', nap: 'took a nap',
  lie: 'lay down', 'sit-ground': 'sat on the ground', 'high-five': 'high-fived someone', craft: 'made something', 'play-piano': 'played the piano',
  'play-music': 'played music', 'play-game': 'played a game', warm: 'warmed up by the fire', 'warm-by-fire': 'warmed up by the fire', wade: 'waded',
  meditate: 'meditated', board: 'got on board', alight: 'stepped out', browse: 'browsed a shelf',
};
const PAST_TO: Record<string, string> = {
  walk: 'walked to', go: 'went to', jog: 'jogged to', run: 'ran to', fly: 'flew to', swim: 'swam in', ride: 'rode', visit: 'visited', follow: 'followed',
  greet: 'greeted', hug: 'hugged', watch: 'watched', read: 'read', sit: 'sat at', look: 'looked at', 'pick-up': 'picked up', 'put-down': 'put down',
  give: 'gave', eat: 'ate', drink: 'drank', play: 'played', make: 'made', board: 'boarded', wade: 'waded in',
};
/** The base form, for "tried to ...": `sit:here` -> "sit down", `fly:moon` -> "fly to moon". */
const BASE: Record<string, string> = {sit: 'sit down', stand: 'stand up', lie: 'lie down', stargaze: 'watch the stars', 'sit-ground': 'sit on the ground', nap: 'take a nap', look: 'look around'};
const BASE_TO: Record<string, string> = {walk: 'walk to', go: 'go to', jog: 'jog to', run: 'run to', fly: 'fly to', swim: 'swim in', sit: 'sit at', look: 'look at'};
const IRREGULAR: Record<string, string> = {do: 'did', have: 'had', sit: 'sat', read: 'read', lie: 'lay', write: 'wrote', throw: 'threw', tell: 'told', take: 'took', swing: 'swung',
  sing: 'sang', ride: 'rode', make: 'made', give: 'gave', eat: 'ate', feed: 'fed', go: 'went', run: 'ran', swim: 'swam', get: 'got', put: 'put'};
/** "Do yoga" -> "did yoga", "Join the yoga class" -> "joined the yoga class" (the label's first word to the past). */
const labelPast = (label: string) => { const [w = '', ...rest] = label.split(' '), v = w.toLowerCase(); return [IRREGULAR[v] ?? (v.endsWith('e') ? `${v}d` : `${v}ed`), ...rest].join(' '); };
const DAY_MS = 86_400_000, MAX = 200;

// God-built places are often named by their id ("place-commons-kitchen"): read those as words ("commons kitchen").
// Same rules as the web's place label (world-env.ts placeLabel): drop kind prefixes, the copy number and sub-parts, so
// "g-commons-kitchen-table-3" reads "commons kitchen table" and a god's tree stand "trees-south-park-canopy" reads "south park trees".
export const plain = (n: string) => {
  if (/\s/.test(n)) return n;
  let t = (n.split('/')[0] ?? n).replace(/^g-/, '').replace(/^(?:(?:region|place|land|int|eden)-)+/, '').replace(/(?:-\d+)+$/, '');
  const trees = /^trees-(.+?)(?:-canopy)?$/.exec(t); if (trees) t = `${trees[1]}-trees`;
  return t.replace(/[-_]+/g, ' ').trim() || n.replace(/[-_]+/g, ' ');
};

// Owner words for a refusal: the engine's codes ("(pose.not-still)") never reach the owner. Energy first (a Soul freed after
// hours held is exhausted), then known codes by full code or by their last part, then the engine's own sentence without the code.
const PLAIN_REASON: Record<string, string> = {
  'not-still': 'still moving: stand still first', 'no-room': 'no room there', 'hands.full': 'hands full: put something down first',
  'hands.empty': 'nothing in hand to do that with', 'walk.stuck': 'got stuck on the way', 'walk.obstacle': 'something was in the way',
  'walk.goal-occupied': 'someone was already standing there', 'slot.none-free': 'no free spot there', 'slot.none': 'no free spot there',
  'traffic.person': 'gave way to someone passing', 'traffic.vehicle': 'gave way to a vehicle',
  'traffic.yield': 'gave way to someone passing', 'soul.faded': 'it had faded', 'conversation.out-of-range': 'too far away to talk',
  'gesture.partner-unavailable': 'the other one was not there', 'follow.unavailable': 'nobody there to follow',
  'place.ambiguous': 'not sure which place was meant', 'entity.unknown': 'could not find that here', 'capability.unknown': 'not something it can do here',
  'action.unknown-verb': 'not something it can do here', 'capability.params': 'the request was missing something', 'action.invalid-params': 'the request was missing something',
  'ride.full': 'the ride was full', 'ride.departed': 'the ride had already left', 'ride.closed': 'the ride is closed now', 'ride.aboard': 'already on a ride',
  'ride.already-aboard': 'already on a ride', 'window-closed': 'too late to join in', 'hands-out-of-reach': 'out of reach',
};
const TIRED = /\b(energy|tired|exhaust\w*|fatigue\w*)\b/i;
export function plainReason(code: string | null | undefined, reason: string | null | undefined): string {
  const c = code ?? '', r = (reason ?? '').trim();
  if (TIRED.test(c.replace(/[.-]/g, ' ')) || TIRED.test(r)) return 'too tired: rest first';
  const jargon = !r || (c && r.includes(c)) || /\bis supported, but\b/.test(r) || /\([a-z]+\.[a-z.-]+\)/.test(r);
  const mapped = PLAIN_REASON[c] ?? PLAIN_REASON[c.slice(c.lastIndexOf('.') + 1)];
  if (mapped && jargon) return mapped;
  const cleaned = r.replace(/\s*\([a-z]+\.[a-z.-]+\)/g, '').replace(/^.{1,120}? is supported, but /, '').trim();
  return cleaned || mapped || 'the world said no';
}
const targetOf = (rest: string[], nameOf: (id: string) => string | null) => { const t = rest.join(':'); return !t || t === 'here' || t === 'ahead' ? '' : (nameOf(t) ?? plain(t)); };

/** Human words for a capability id like `walk:place_bakery`, `object:ride-eden-balloon:join` or `rest:here`. */
export function describeCapability(cap: string, nameOf: (id: string) => string | null): string {
  const [verb = cap, ...rest] = cap.split(':');
  if (verb === 'object') { const [obj = '', action = 'use'] = rest; return `${action === 'join' ? 'joined' : action.replace(/-/g, ' ')} ${nameOf(obj) ?? plain(obj)}`.trim(); }
  const named = targetOf(rest, nameOf), spot = SPOT_ACTIVITIES[verb]?.label;
  if (named) return `${PAST_TO[verb] ?? (spot ? labelPast(spot) + ' at' : PAST[verb] ?? verb.replace(/-/g, ' '))} ${named}`;
  return PAST[verb] ?? (spot ? labelPast(spot) : verb.replace(/-/g, ' '));
}

/** What the Soul tried, for a refusal: "tried to sit down", "tried to fly to moon". */
export function describeAttempt(cap: string, nameOf: (id: string) => string | null): string {
  const [verb = cap, ...rest] = cap.split(':');
  if (verb === 'object') { const [obj = '', action = 'use'] = rest; return `tried to ${action.replace(/-/g, ' ')} ${nameOf(obj) ?? plain(obj)}`.trim(); }
  const named = targetOf(rest, nameOf), spot = SPOT_ACTIVITIES[verb]?.label, verbWords = verb.replace(/-/g, ' ');
  if (named) return `tried to ${BASE_TO[verb] ?? (spot ? spot.toLowerCase() + ' at' : verbWords)} ${named}`;
  return `tried to ${BASE[verb] ?? (spot ? spot.toLowerCase() : verbWords)}`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const xz = (p: unknown): {x: number; z: number} | null => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' ? {x: r1(p[0]), z: r1(p[1])} : null;

export function ownerDay(L: EdgeLedger, db: Db, soulId: string, since: number): DayEntry[] {
  const w = L.host.worldId, sql = db.db;
  const nameOf = (id: string) => { const n = L.places.byId.get(id)?.name ?? (L.host.nameOf(id) !== id ? L.host.nameOf(id) : null) ?? (L.places.byId.has(id.replace(/^g-/, '')) ? id : null); return n == null ? null : plain(n); };
  const out: DayEntry[] = [];
  const ids = sql.prepare('SELECT receipt_id FROM edge_receipts_v1 WHERE world_id=? AND soul_id=? AND created_at>=? ORDER BY created_at DESC LIMIT ?').all(w, soulId, since, MAX) as {receipt_id: string}[];
  const created = sql.prepare('SELECT created_at FROM edge_receipts_v1 WHERE world_id=? AND receipt_id=?');
  for (const {receipt_id} of ids) {
    const r = L.receipt(soulId, receipt_id); if (!r) continue;
    const at = (created.get(w, receipt_id) as {created_at: number}).created_at;
    const end = r.endedAt as {pos?: unknown; place?: unknown} | undefined;
    const place = typeof end?.place === 'string' ? (nameOf(end.place) ?? end.place) : null;
    const text = describeCapability(r.capability, nameOf);
    // `replaced` is the Soul's own next act taking over: the act happened (a jog that moved the body still did), so it reads as done,
    if (r.phase === 'completed') out.push({at, kind: 'did', text, where: xz(end?.pos), place});
    // ...but it did not finish: say so ("watched the stars (cut short)") so the owner can tell.
    else if (r.phase === 'replaced') out.push({at, kind: 'did', text: `${text} (cut short)`, cut: true, where: xz(end?.pos), place});
    else if (r.phase === 'started' || r.phase === 'waiting') out.push({at, kind: 'doing', text, where: xz(end?.pos), place});
    else if (r.phase === 'failed') out.push({at, kind: 'stopped', text, where: xz(end?.pos), place, ...(r.reason || r.code ? {reason: plainReason(r.code, r.reason)} : {}), ...(r.code ? {code: r.code} : {})});
  }
  const cols = new Set((sql.prepare('PRAGMA table_info(edge_refusals_v1)').all() as {name: string}[]).map(c => c.name));
  if (cols.has('reason')) for (const f of sql.prepare('SELECT at,capability,code,reason,x,z FROM edge_refusals_v1 WHERE world_id=? AND soul_id=? AND at>=? ORDER BY at DESC LIMIT ?').all(w, soulId, since, MAX) as {at: number; capability: string; code: string; reason: string | null; x: number | null; z: number | null}[])
    out.push({at: f.at, kind: 'refused', text: describeAttempt(f.capability, nameOf), code: f.code, reason: plainReason(f.code, f.reason), where: f.x == null || f.z == null ? null : {x: r1(f.x), z: r1(f.z)}});
  if (sql.prepare("SELECT 1 FROM sqlite_master WHERE name='edge_comms_speech'").get())
    for (const s of sql.prepare('SELECT at,text FROM edge_comms_speech WHERE world_id=? AND soul_id=? AND at>=? ORDER BY at DESC LIMIT ?').all(w, soulId, since, MAX) as {at: number; text: string}[])
      out.push({at: s.at, kind: 'said', text: s.text, where: null});
  out.sort((a, b) => a.at - b.at);
  // Speech carries no position of its own: it happened where the body was at the act just before it.
  let last: {x: number; z: number} | null = null;
  for (const e of out) { if (e.where) last = e.where; else if (e.kind === 'said') e.where = last; }
  return out.slice(-MAX);
}

/** GET /v1/souls/:id/day?since=<ms>: owner-scoped (another account gets 403 from ownerSoul). */
export function mountOwnerDay(app: Hono, deps: {ledger: EdgeLedger; db: Db; ownerSoul?: (c: Context, id: string) => Promise<EdgeSoul>; now?: () => number}) {
  if (!deps.ownerSoul) return;
  app.get('/v1/souls/:id/day', async c => {
    c.header('Cache-Control', 'no-store');
    try {
      const s = await deps.ownerSoul!(c, c.req.param('id') ?? '');
      const now = (deps.now ?? Date.now)(), asked = Number(c.req.query('since'));
      const since = Number.isFinite(asked) && asked > 0 ? Math.max(asked, now - 2 * DAY_MS) : now - DAY_MS;
      return c.json({contract: EDGE_CONTRACT, soul: {id: s.soulId, name: s.name}, since, entries: ownerDay(deps.ledger, deps.db, s.soulId, since)});
    } catch (error) {
      if (error instanceof EdgeError) return c.json({contract: EDGE_CONTRACT, error: edgeErrorOf(error)}, error.status as 403);
      throw error;
    }
  });
}
