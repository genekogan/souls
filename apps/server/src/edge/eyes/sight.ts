// Eyes (M3): what a Soul can see from its own eyes. Pure and deterministic: the same world state, pose and gaze give
// the same visible set and the same caption, byte for byte. No model calls. The render worker draws exactly this set
// (every other Soul body is hidden in the frame), so the picture and the `alt` caption agree.
//
// Sightline rule (v1): same enclosure as the viewer (or both outdoors), same floor level, within the light-dependent
// range, inside the horizontal field of view around the gaze, and no occluder on the straight line between the eyes
// and the target in plan: enclosed building footprints (from outside), interior wall runs and tall furniture (from
// inside), and World's tall scenery solids. Low things (rails, benches, rings under 1.5 m) never block.
import {runWalls, type Solid, type Interior} from '../ledger/nav.ts';
import {inPoly, centroid, type Place} from '../ledger/places.ts';

export type V2 = [number, number];
export type EyePose = {p: [number, number, number]; yaw: number; pitch: number; hfov: number; vfov: number};
export type Light = {clock: string | null; label: 'day' | 'morning' | 'evening' | 'dusk' | 'night'; dark: boolean; weather: string[]};
export type Seen = {soulId: string; entityId: string; name: string; distance: number; bearing: number; side: string; state: string; activity: string; facingYou: boolean};
export type SeenThing = {id: string; name: string; kind: 'fixture' | 'spot' | 'place'; distance: number; bearing: number; side: string; count?: number};
export type Sight = {pose: EyePose; heading: {yaw: number; degrees: number; compass: string}; gaze: {mode: string; yaw: number; degrees: number; compass: string; target?: string};
  where: {place: string | null; enclosure: string | null; inside: boolean}; light: Light; souls: Seen[]; things: SeenThing[]; range: number; alt: string};

const TAU = Math.PI * 2;
export const wrap = (a: number) => {let x = a % TAU; if (x > Math.PI) x -= TAU; if (x < -Math.PI) x += TAU; return x;};
const r1 = (n: number) => Math.round(n * 10) / 10, r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Engine yaw: 0 faces +x, forward = (cos yaw, sin yaw) in x/z; north is −z, east is +x. */
export function compassOf(yaw: number): {degrees: number; compass: string} {
  const d = ((Math.round(Math.atan2(Math.cos(yaw), -Math.sin(yaw)) * 180 / Math.PI) % 360) + 360) % 360;   // atan2(dx, −dz): 0 = north, 90 = east
  const names = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return {degrees: d, compass: names[Math.round(d / 45) % 8]};
}
/** Where a bearing (relative to the gaze, + = right) falls in the frame, left to right. */
export function sideOf(rel: number, hfov: number): string {
  const f = rel / (hfov / 2);   // −1 … 1 across the frame
  return f < -0.6 ? 'far left' : f < -0.2 ? 'left' : f < -0.07 ? 'ahead-left' : f <= 0.07 ? 'ahead' : f <= 0.2 ? 'ahead-right' : f <= 0.6 ? 'right' : 'far right';
}

// ---------------------------------------------------------------- occluders
type Box = {id: string; c: V2; half: V2; yaw: number; owner?: string};
export type Occluders = {buildings: {id: string; poly: V2[]; bbox: [number, number, number, number]}[]; boxes: Box[]};
const bboxOf = (poly: V2[]): [number, number, number, number] => {const xs = poly.map(v => v[0]), zs = poly.map(v => v[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];};
/** Blocking geometry from PLACE-DATA (enclosed buildings) and activity-spots/1 (interiors, tall solids). */
export function buildOccluders(places: Iterable<Place>, spots: {interiors?: Interior[]; solids?: Solid[]}): Occluders {
  const buildings: Occluders['buildings'] = [], boxes: Box[] = [];
  for (const p of places) if (p.enclosed && (p.level ?? 0) === 0 && !p.carrier && p.parent !== null && p.polygon.length >= 3) buildings.push({id: p.id, poly: p.polygon, bbox: bboxOf(p.polygon)});
  for (const i of spots.interiors ?? []) {
    for (const w of runWalls(i.place, i.walls ?? [], i.doors, 0.15)) boxes.push({...w, owner: i.place});
    for (const f of i.furniture ?? []) if ((f.height ?? 0) >= 1.5) boxes.push({id: `${i.place}#f-${f.id}`, c: f.c, half: f.half, yaw: f.yaw, owner: i.place});
  }
  for (const s of spots.solids ?? []) if ((s.height ?? 3) >= 1.5) boxes.push({id: s.id, c: s.c, half: s.half, yaw: s.yaw});
  buildings.sort((a, b) => a.id.localeCompare(b.id)); boxes.sort((a, b) => a.id.localeCompare(b.id));
  return {buildings, boxes};
}
const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;
function segsCross(a: V2, b: V2, c: V2, d: V2): boolean {
  const r: V2 = [b[0] - a[0], b[1] - a[1]], s: V2 = [d[0] - c[0], d[1] - c[1]], den = cross(r[0], r[1], s[0], s[1]);
  if (Math.abs(den) < 1e-12) return false;
  const t = cross(c[0] - a[0], c[1] - a[1], s[0], s[1]) / den, u = cross(c[0] - a[0], c[1] - a[1], r[0], r[1]) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1;
}
const toLocal = (p: V2, b: Box): V2 => {const dx = p[0] - b.c[0], dz = p[1] - b.c[1], c = Math.cos(b.yaw), n = Math.sin(b.yaw); return [dx * c + dz * n, -dx * n + dz * c];};
const inBox = (p: V2, b: Box) => {const l = toLocal(p, b); return Math.abs(l[0]) < b.half[0] && Math.abs(l[1]) < b.half[1];};
/** Liang–Barsky slab test of segment a→b against an oriented box. */
function segHitsBox(a: V2, b: V2, box: Box): boolean {
  const p = toLocal(a, box), q = toLocal(b, box), d: V2 = [q[0] - p[0], q[1] - p[1]];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-12) {if (Math.abs(p[k]) > box.half[k]) return false; continue;}
    let ta = (-box.half[k] - p[k]) / d[k], tb = (box.half[k] - p[k]) / d[k]; if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
  }
  return t1 > 1e-6 && t0 < 1 - 1e-6;
}
/** Is the straight sightline from the eyes `e` to `t` clear? `skip` ignores the target's own geometry. */
export function clearLine(occ: Occluders, e: V2, t: V2, skip?: (id: string) => boolean): boolean {
  const sx0 = Math.min(e[0], t[0]), sx1 = Math.max(e[0], t[0]), sz0 = Math.min(e[1], t[1]), sz1 = Math.max(e[1], t[1]);
  const insideE = new Set<string>();
  for (const bld of occ.buildings) {
    const near = !(bld.bbox[2] < sx0 || bld.bbox[0] > sx1 || bld.bbox[3] < sz0 || bld.bbox[1] > sz1);
    const ie = inPoly(e[0], e[1], bld.poly); if (ie) insideE.add(bld.id);
    if (!near || skip?.(bld.id)) continue;
    const it = inPoly(t[0], t[1], bld.poly);
    if (ie && it) continue;                 // both inside this building: its outer walls are not in the way
    if (ie !== it) return false;            // one inside, one outside: a wall is in the way
    const poly = bld.poly; for (let i = 0; i < poly.length; i++) if (segsCross(e, t, poly[i], poly[(i + 1) % poly.length])) return false;
  }
  for (const box of occ.boxes) {
    if (box.owner && !insideE.has(box.owner)) continue;   // interior walls/furniture matter only from inside
    if (skip?.(box.id) || inBox(e, box) || inBox(t, box)) continue;
    const reach = Math.hypot(box.half[0], box.half[1]);
    if (box.c[0] + reach < sx0 || box.c[0] - reach > sx1 || box.c[1] + reach < sz0 || box.c[1] - reach > sz1) continue;
    if (segHitsBox(e, t, box)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- light and weather
// The viewer draws weather as a deterministic function of the world clock (web atmosphere/weather.ts: a kind per
// 2-hour slot, seeded by the day). Mirrored here so the caption names the weather the picture shows.
const hash01 = (a: number, b = 0) => {let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0; h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296;};
type Kind = 'clear' | 'cloudy' | 'rain' | 'wind' | 'fog' | 'storm';
const REGIMES: [string, number][] = [['fair', .34], ['unsettled', .26], ['misty', .2], ['breezy', .2]];
const WEIGHTS: Record<string, Record<Kind, number>> = {
  fair: {clear: .64, cloudy: .24, rain: .005, wind: .115, fog: 0, storm: 0}, unsettled: {clear: .22, cloudy: .42, rain: .115, wind: .21, fog: 0, storm: .035},
  misty: {clear: .33, cloudy: .3, rain: .015, wind: 0, fog: .355, storm: 0}, breezy: {clear: .42, cloudy: .2, rain: .015, wind: .36, fog: 0, storm: .005}};
const pick = <T extends string>(rows: [T, number][], u: number): T => {const total = rows.reduce((t, r) => t + r[1], 0); let x = u * total; for (const [k, w] of rows) {if (x < w) return k; x -= w;} return rows[rows.length - 1][0];};
export function viewerWeatherKind(datetime: string): Kind | null {
  const m = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?/.exec(datetime), ms = m ? Date.parse(m[0] + 'Z') : NaN; if (!Number.isFinite(ms)) return null;
  const day = Math.floor(ms / 86_400_000), slot = Math.floor((ms - day * 86_400_000) / 3_600_000 / 2);
  // WEATHER-RULES: a shower is one 2 h slot at most (the slot after a wet one is dry), as the viewer draws it
  const k = slotKind(day, slot); if (!wetKind(k)) return k;
  return wetKind(slot > 0 ? slotKind(day, slot - 1) : slotKind(day - 1, 11)) ? slotKind(day, slot, true) : k;
}
const wetKind = (k: Kind) => k === 'rain' || k === 'storm';
function slotKind(day: number, slot: number, dry = false): Kind {
  const w = {...WEIGHTS[pick(REGIMES, hash01(day, 7919))]};
  if (slot === 2 || slot === 3) w.fog *= 2.2; else if (slot >= 5 && slot <= 8) w.fog *= .25;
  if (slot >= 6 && slot <= 8) {w.rain *= 1.3; w.storm *= 1.8;}
  if (dry) w.rain = w.storm = 0;
  return pick(Object.entries(w) as [Kind, number][], hash01(day, slot * 131 + 17));
}
const KIND_WORDS: Record<Kind, string[]> = {clear: ['clear sky'], cloudy: ['cloudy'], rain: ['raining'], wind: ['windy'], fog: ['foggy'], storm: ['stormy', 'raining']};
export function lightOf(datetime: string | null, weather: {clouds?: number; rain?: number; wind?: number; dust?: number; fog?: number; kind?: string} | undefined, indoors: boolean): Light {
  const hh = datetime ? Number(datetime.slice(11, 13)) : NaN, mm = datetime ? Number(datetime.slice(14, 16)) : NaN, m = hh * 60 + mm;
  const label: Light['label'] = !Number.isFinite(m) ? 'day' : m < 330 || m >= 1260 ? 'night' : m < 420 ? 'morning' : m < 1080 ? 'day' : m < 1170 ? 'evening' : 'dusk';
  // a god world's set weather (R4-LIVE: weather.kind other than auto) names itself; 'manual' reads the channels below
  const set = weather?.kind && weather.kind !== 'auto' ? weather.kind : null;
  const kind = set ? (set in KIND_WORDS ? set as Kind : null) : datetime ? viewerWeatherKind(datetime) : null, w: string[] = kind ? [...KIND_WORDS[kind]] : [];
  // The picture eases between slots (about a world hour at Eden's clock rate): say so rather than contradict it.
  if (kind && !set && datetime && Number.isFinite(m) && m % 120 < 60) {
    const before = viewerWeatherKind(new Date(Date.parse(datetime.slice(0, 19) + 'Z') - 61 * 60_000).toISOString());
    const wet = (k: Kind | null) => k === 'rain' || k === 'storm';
    if (wet(before) && !wet(kind)) w.splice(0, w.length, 'rain clearing', ...KIND_WORDS[kind].filter(x => x !== 'raining'));
    else if (!wet(before) && wet(kind)) w.unshift('rain starting');
  }
  if (!kind) {
    if ((weather?.rain ?? 0) > 0.1) w.push('raining'); else if ((weather?.clouds ?? 0) > 0.6) w.push('overcast'); else if ((weather?.clouds ?? 0) > 0.25) w.push('some cloud'); else w.push('clear sky');
    if ((weather?.wind ?? 0) > 0.5) w.push('windy');
    if ((weather?.fog ?? 0) > 0.5) w.push('foggy');
  }
  if ((weather?.dust ?? 0) > 0.3) w.push('dusty air');
  return {clock: Number.isFinite(m) ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : null, label, dark: label === 'night' && !indoors, weather: w};
}
/** How far the Soul can make out people (m): dark outdoors shortens sight; indoors rooms are lit. */
export const sightRange = (l: Light, indoors: boolean) => indoors ? 40 : l.label === 'night' ? 14 : l.label === 'dusk' || l.label === 'morning' ? 30 : 60;

// ---------------------------------------------------------------- the visible set
export type SightBody = {soulId: string; entityId: string; name: string; p: [number, number, number]; yaw: number; level: number; enclosure: string | null; state: string; activity: string};
export type SightFixture = {id: string; name: string; p: [number, number, number]; enclosure: string | null};
export type SightInput = {
  me: SightBody; pose: EyePose; gaze: {mode: string; yaw: number; target?: string}; light: Light;
  place: string | null; enclosureName: string | null;
  others: SightBody[]; fixtures: SightFixture[]; spots: SightFixture[];
  places: Place[]; containing: Set<string>; occluders: Occluders;
};
const clean = (s: string, n = 48) => s.replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const ACTIVITY: Record<string, string> = {
  warm: 'warming by the fire', 'warm-by-fire': 'warming by the fire', read: 'reading', write: 'writing', paint: 'painting', chalk: 'drawing in chalk', talk: 'talking', listen: 'listening', dance: 'dancing',
  'play-piano': 'playing the piano', 'play-music': 'playing music', sing: 'singing at the microphone', eat: 'eating', drink: 'drinking', cook: 'cooking', hug: 'hugging someone', 'high-five': 'high-fiving someone', wave: 'waving',
  swim: 'swimming', tread: 'treading water', wade: 'wading', walk: 'walking', run: 'running', jog: 'jogging', sleep: 'asleep', nap: 'napping', lie: 'lying down', 'sit-ground': 'sitting on the ground',
  yoga: 'doing yoga', stretch: 'stretching', craft: 'making something', 'play-game': 'playing a game', clap: 'clapping', bow: 'bowing', cheer: 'cheering', point: 'pointing', wait: 'waiting',
};
export function doingOf(state: string, activity: string): string {
  if (state === 'sleeping') return 'asleep';
  if (state === 'riding') return 'riding';
  if (state === 'seated') return activity && !activity.startsWith('sit') && ACTIVITY[activity] ? `sitting, ${ACTIVITY[activity]}` : 'sitting';
  if (ACTIVITY[activity]) return ACTIVITY[activity];
  if (state === 'lying') return 'lying down'; if (state === 'walking') return 'walking'; if (state === 'swimming') return 'swimming';
  if (activity && activity !== 'idle') return clean(activity.replace(/[_:-]+/g, ' '), 30);
  return 'standing';
}
/** Place kinds that are landmarks one can see (big areas, rooms and sleeping mats are not). */
const NOT_LANDMARK = new Set(['world', 'outdoor', 'sleeping-mat', 'room', 'bedroom', 'street', 'field', 'residential-row', 'vehicle', 'kitchen']);
function nearestOnPoly(e: V2, poly: V2[]): V2 {
  let best: V2 = poly[0], bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ab: V2 = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] ** 2 + ab[1] ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((e[0] - a[0]) * ab[0] + (e[1] - a[1]) * ab[1]) / l2)) : 0, q: V2 = [a[0] + ab[0] * t, a[1] + ab[1] * t], d = Math.hypot(q[0] - e[0], q[1] - e[1]);
    if (d < bd) {bd = d; best = q;}
  }
  return best;
}

export function computeSight(input: SightInput): Sight {
  const {me, pose, gaze, light, occluders: occ} = input, e: V2 = [pose.p[0], pose.p[2]], half = pose.hfov / 2;
  const indoors = me.enclosure !== null, range = sightRange(light, indoors), aloft = pose.p[1] - me.p[1] > 6 || pose.p[1] > 8;
  const rel = (t: V2) => wrap(Math.atan2(t[1] - e[1], t[0] - e[0]) - gaze.yaw);
  const clear = (t: V2, skip?: (id: string) => boolean) => aloft || clearLine(occ, e, t, skip);
  const souls: Seen[] = [];
  for (const o of input.others) {
    const t: V2 = [o.p[0], o.p[2]], d = Math.hypot(t[0] - e[0], t[1] - e[1]);
    if (d > range || o.enclosure !== me.enclosure || o.level !== me.level) continue;
    const b = rel(t); if (Math.abs(b) > half + Math.atan2(0.35, Math.max(d, 0.35))) continue;
    if (d > 0.6 && !clear(t)) continue;
    const toMe = Math.atan2(e[1] - t[1], e[0] - t[0]);
    souls.push({soulId: o.soulId, entityId: o.entityId, name: clean(o.name), distance: r1(d), bearing: r3(b), side: sideOf(b, pose.hfov), state: o.state, activity: o.activity,
      facingYou: d < 25 && Math.abs(wrap(o.yaw - toMe)) < 0.7});
  }
  const things: SeenThing[] = [];
  const point = (id: string, name: string, kind: SeenThing['kind'], t: V2, enclosure: string | null, max: number) => {
    const d = Math.hypot(t[0] - e[0], t[1] - e[1]); if (d > max || d < 0.3 || enclosure !== me.enclosure) return;
    const b = rel(t); if (Math.abs(b) > half + Math.atan2(0.5, Math.max(d, 0.5))) return;
    if (!clear(t, x => x === id || x.startsWith(id + '#'))) return;
    things.push({id, name: clean(name), kind, distance: r1(d), bearing: r3(b), side: sideOf(b, pose.hfov)});
  };
  for (const f of input.fixtures) point(f.id, f.name, 'fixture', [f.p[0], f.p[2]], f.enclosure, Math.min(range, 25));
  for (const s of input.spots) point(s.id, s.name, 'spot', [s.p[0], s.p[2]], s.enclosure, indoors ? 20 : Math.min(range, 12));
  const byId = new Map(input.places.map(p => [p.id, p]));
  /** A place inside a building (a room, a courtyard) is not a landmark from outside that building. */
  const walledIn = (p: Place) => {for (let q = p.parent ? byId.get(p.parent) : undefined; q; q = q.parent ? byId.get(q.parent) : undefined) if (q.enclosed && !input.containing.has(q.id)) return true; return false;};
  if (!indoors) for (const p of input.places) {
    if (NOT_LANDMARK.has(p.kind) || p.parent === null || p.carrier || (p.level ?? 0) !== 0 || input.containing.has(p.id) || p.polygon.length < 3 || walledIn(p)) continue;
    const n = nearestOnPoly(e, p.polygon), d = Math.hypot(n[0] - e[0], n[1] - e[1]), max = light.label === 'night' ? 40 : 120; if (d > max) continue;
    // in view if any of its outline (nearest point, centroid, corners) is inside the frame
    const c = centroid(p.polygon), pts = [n, c, ...p.polygon], inView = pts.filter(q => Math.abs(rel(q)) <= half);
    if (!inView.length) continue;
    const aim = inView.reduce((best, q) => Math.hypot(q[0] - e[0], q[1] - e[1]) < Math.hypot(best[0] - e[0], best[1] - e[1]) ? q : best);
    // step 0.3 m inside its outline so the place's own walls never hide it
    const k = Math.hypot(c[0] - aim[0], c[1] - aim[1]), inward: V2 = k > 0.3 ? [aim[0] + (c[0] - aim[0]) * 0.3 / k, aim[1] + (c[1] - aim[1]) * 0.3 / k] : c;
    if (!clear(inward, x => x === p.id || x.startsWith(p.id + '#') || x.startsWith(p.id + '-'))) continue;
    const b = rel(aim); things.push({id: p.id, name: clean(p.name.replace(/ \(.*\)$/, '')), kind: 'place', distance: r1(d), bearing: r3(b), side: sideOf(b, pose.hfov)});
  }
  // group repeated things with one name (six camp chairs), keep the nearest as the anchor
  const grouped = new Map<string, SeenThing>();
  for (const t of things.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))) {
    const key = t.kind + ':' + t.name.toLowerCase(), g = grouped.get(key);
    if (g) g.count = (g.count ?? 1) + 1; else grouped.set(key, {...t});
  }
  const thingList = [...grouped.values()].sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id)).slice(0, 10);
  souls.sort((a, b) => a.distance - b.distance || a.soulId.localeCompare(b.soulId));
  const heading = {yaw: r3(me.yaw), ...compassOf(me.yaw)}, gz = {mode: gaze.mode, yaw: r3(gaze.yaw), ...compassOf(gaze.yaw), ...(gaze.target ? {target: gaze.target} : {})};
  const sight: Sight = {pose, heading, gaze: gz, where: {place: input.place, enclosure: input.enclosureName, inside: indoors}, light, souls, things: thingList, range, alt: ''};
  sight.alt = caption(sight, clean(me.name), doingOf(me.state, me.activity));
  return sight;
}

const m = (d: number) => d < 10 ? `${r1(d)} m` : `${Math.round(d)} m`;
const art = (name: string) => /^(the|a|an)\s/i.test(name) ? name : 'the ' + name;
/** One deterministic paragraph, left to right, from the same visible set the frame shows. */
export function caption(s: Sight, name: string, doing: string): string {
  const head = s.gaze.mode === 'forward' ? `looking ${s.gaze.compass}` : `facing ${s.heading.compass} with the head turned ${s.gaze.mode === 'target' ? 'toward ' + (s.gaze.target ?? 'something') : s.gaze.mode} (looking ${s.gaze.compass})`;
  const where = s.where.inside ? `inside ${s.where.enclosure ?? 'a building'}${s.where.place && s.where.place !== s.where.enclosure ? ` (${s.where.place})` : ''}` : s.where.place ? `at ${s.where.place}` : 'outdoors';
  const light = s.where.inside ? `${s.light.clock ? s.light.clock + ', ' : ''}${s.light.label}, indoors` : `${s.light.clock ? s.light.clock + ', ' : ''}${s.light.label}${s.light.dark ? ' (dark: only nearby things are clear)' : ''}, ${s.light.weather.join(', ')}`;
  const near = s.souls.slice(0, 8).map(o => ({b: o.bearing, d: o.distance, text: `${o.name}, ${m(o.distance)} ${o.side}, ${doingOf(o.state, o.activity)}${o.facingYou ? ', facing you' : ''}`}));
  const close = s.things.filter(t => t.kind !== 'place' && t.distance <= 15).slice(0, 6).map(t => ({b: t.bearing, d: t.distance, text: `${t.count && t.count > 1 ? `${t.count} × ${t.name.toLowerCase()} (nearest ${m(t.distance)} ${t.side})` : `${art(t.name)} ${m(t.distance)} ${t.side}`}`}));
  const ltr = [...near, ...close].sort((a, b) => a.b - b.b || a.d - b.d).map(x => x.text);
  const far = s.things.filter(t => t.kind === 'place' || t.distance > 15).slice(0, 5).sort((a, b) => a.bearing - b.bearing).map(t => `${art(t.name)} ${m(t.distance)} ${t.side}`);
  const more = s.souls.length > 8 ? ` and ${s.souls.length - 8} more people` : '';
  const people = s.souls.length === 0 ? 'Nobody else is in view.' : s.souls.length === 1 ? 'One other person is in view.' : `${s.souls.length} other people are in view.`;
  return `${name} sees this, ${doing} ${where}, ${head} (${light}). ` +
    (ltr.length ? `Left to right: ${ltr.join('; ')}${more}. ` : '') + (far.length ? `Further off: ${far.join('; ')}. ` : '') + people +
    ' Only what is in front of the eyes is shown: nothing behind, nothing through walls.';
}
