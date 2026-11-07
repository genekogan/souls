// R8: residents learn about map changes near them without asking again. Built on G1's resident notice (notices.ts):
// when the creator's god commits an edit that visibly changes the map within ~30 m of a resident, or changes something
// the resident owns, lives at or works at, that resident gets ONE plain sentence for the whole request ("The god built
// a lighthouse at the harbour."), summarised by the build's title/say or the batch note when there is one. Never for a
// resident a G1 walk-out already told in the same request, never for a state-only or naming tweak, never for things in
// a resident's hands (bodies move themselves). At most one per resident per minute: what comes sooner is merged into
// one later notice. Construction gets its own pair: when a build starts near a resident and when it is done.
// Planning is pure and runs in the god request (bounded: top-level changes only, at most MAP_NOTICE.changes of them);
// delivery waits for the request to finish (the bridge stages, then delivers on a microtask).
import type { Diff, Entity, WorldModel } from '@souls/world-compiler';
import { inSite, siteLocal, type Site } from './builds.ts';
import { thingName } from './walkout.ts';

type Vec2 = [number, number];
export const MAP_NOTICE = { nearM: 30, everyMs: 60_000, changes: 200 } as const;

export type MapVerb = 'built' | 'placed' | 'removed' | 'moved' | 'changed' | 'reshaped';
export type MapChange = {
  id: string; verb: MapVerb; name: string;
  /** Where it is now (where it was, for a removal) and how far its footprint reaches from there. */
  at: Vec2; r: number; from?: Vec2;
  /** Who it belongs to, for "a place they use": owner refs on it and its ancestors, and `thing:<id>` of each of them. */
  owners: string[]; things: string[];
};
export type MapResident = { soulId: string; name: string; p: Vec2 };
export type MapPlan = { changes: MapChange[]; souls: string[]; at: Vec2 };
export type MapLabel = { title?: string; say?: string; note?: string };

const round = (n: number) => Math.round(n * 1000) / 1000;
const isBody = (m: WorldModel, e: Entity) => !!m.resolvedDef(e.def)?.components.body;
const inHands = (m: WorldModel, e: Entity) => { for (let p = e.in.parent; p !== 'world';) { const x = m.entities.get(p); if (!x) return false; if (isBody(m, x)) return true; p = x.in.parent; } return false; };
const isBuilding = (m: WorldModel, e: Entity) => { const d = m.resolvedDef(e.def); return !!d && ((d.make.kind === 'gen' && d.make.gen.startsWith('building/')) || d.tags.includes('building')); };
/** What a passer-by sees of a thing: what it is, where it stands, its shape and make. Not its state (a door shut), name,
 *  owner, schedule or price. */
function visibleKey(m: WorldModel, e: Entity): string {
  const p = m.worldPose(e);
  return JSON.stringify([e.def, e.in.parent, e.in.slot ?? null, [p.x, p.y, p.z, p.yaw, p.s].map(round), e.params ?? null, e.shape ?? null, e.seed ?? null, e.anchor ?? null]);
}
/** Its centre on the ground and the radius its footprint reaches (a world-frame road or area: its outline). */
function reachOf(m: WorldModel, e: Entity): { at: Vec2; r: number } {
  const pts = ((e.shape as { path?: Vec2[]; area?: Vec2[] } | undefined)?.path ?? (e.shape as { area?: Vec2[] } | undefined)?.area);
  if (pts?.length && e.in.parent === 'world') {
    const xs = pts.map(q => q[0]), zs = pts.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    return { at: [(x0 + x1) / 2, (z0 + z1) / 2], r: Math.hypot(x1 - x0, z1 - z0) / 2 };
  }
  // Indexed solid footprints when it has them (no bake on the request path), else the def's declared box.
  const wp = m.worldPose(e), at: Vec2 = [wp.x, wp.z], fp = m.footprintsOf(e.id);
  if (fp.length) return { at, r: Math.max(...fp.map(o => Math.hypot(o.c[0] - at[0], o.c[1] - at[1]) + Math.hypot(o.half[0], o.half[1]))) };
  const box = m.resolvedDef(e.def)?.size.box;
  return { at, r: box ? Math.hypot(box[0], box[2]) / 2 * wp.s : 0 };
}
const isLandform = (m: WorldModel, e: Entity) => { const d = m.resolvedDef(e.def); try { return !!d && !!m.bake(d, e.params ?? {}, e.seed ?? 0, e.shape).landform; } catch { return false; } };
function ownersOf(m: WorldModel, id: string, out: { owners: string[]; things: string[] }) {
  for (let e = m.entities.get(id); e; e = e.in.parent === 'world' ? undefined : m.entities.get(e.in.parent)) {
    if (e.owner && !out.owners.includes(e.owner)) out.owners.push(e.owner);
    if (!out.things.includes(`thing:${e.id}`)) out.things.push(`thing:${e.id}`);
  }
}

/** The visible changes of an edit, outermost first (the house, not the chair in it). `skip`: things a walk-out set down. */
export function mapChanges(before: WorldModel, after: WorldModel, diff: Diff, skip: Iterable<string> = []): MapChange[] {
  const skipped = new Set(skip), rebound = new Set(diff.defs.map(d => d.ref)), changed = new Map<string, 'added' | 'removed' | 'changed'>();
  for (const id of diff.removes) { const e = before.entities.get(id); if (e && !skipped.has(id) && !isBody(before, e) && !inHands(before, e)) changed.set(id, 'removed'); }
  for (const u of diff.upserts) {
    if (skipped.has(u.id) || changed.has(u.id)) continue;
    const a = after.entities.get(u.id); if (!a || isBody(after, a) || inHands(after, a)) continue;
    const b = before.entities.get(u.id);
    if (!b) changed.set(u.id, 'added');
    else if (rebound.has(after.resolvedDef(a.def)?.ref ?? '') || visibleKey(before, b) !== visibleKey(after, a)) changed.set(u.id, 'changed');
  }
  // Only the outermost changed thing speaks for its subtree.
  const outer = (id: string, m: WorldModel) => { for (let p = m.entities.get(id)?.in.parent; p && p !== 'world'; p = m.entities.get(p)?.in.parent) if (changed.has(p)) return false; return true; };
  const out: MapChange[] = [];
  for (const [id, how] of changed) {
    if (out.length >= MAP_NOTICE.changes) break;
    const m = how === 'removed' ? before : after, e = m.entities.get(id)!;
    if (!outer(id, m)) continue;
    const d = m.resolvedDef(e.def), { at, r } = reachOf(m, e), refs = { owners: [] as string[], things: [] as string[] };
    ownersOf(m, id, refs); if (how !== 'removed' && before.entities.has(id)) ownersOf(before, id, refs);
    let verb: MapVerb, from: Vec2 | undefined;
    // only an edit that re-made ground tiles can be a landform (the bake lookup is skipped otherwise)
    const ground = diff.tiles.length > 0 && isLandform(m, e);
    if (how === 'removed') verb = ground ? 'reshaped' : 'removed';
    else if (ground) verb = 'reshaped';
    else if (how === 'added') verb = isBuilding(after, e) ? 'built' : 'placed';
    else {
      const b = before.entities.get(id)!, was = reachOf(before, b);
      const same = JSON.stringify([b.def, b.params ?? null, b.shape ?? null, b.seed ?? null]) === JSON.stringify([e.def, e.params ?? null, e.shape ?? null, e.seed ?? null]) && !rebound.has(d?.ref ?? '');
      verb = same ? 'moved' : 'changed';
      if (Math.hypot(was.at[0] - at[0], was.at[1] - at[1]) > .01) from = was.at;
    }
    out.push({ id, verb, name: ground ? 'the ground' : thingName(m, id), at, r, ...(from ? { from } : {}), ...refs });
  }
  // Buildings first, then additions and removals: the first change names the request.
  const rank = (c: MapChange) => (c.verb === 'built' ? 0 : c.verb === 'removed' ? 1 : c.verb === 'placed' ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Ground distance from a point to a change's footprint (where it is now, or where it was). */
const distTo = (p: Vec2, c: MapChange) => Math.min(...[c.at, ...(c.from ? [c.from] : [])].map(q => Math.max(0, Math.hypot(p[0] - q[0], p[1] - q[1]) - c.r)));
/** Ground distance from a point to a build site's rectangle. */
export function distToSite(site: Site, p: Vec2): number { const [x, z] = siteLocal(site, p); return Math.hypot(Math.max(0, Math.abs(x) - site.size[0] / 2), Math.max(0, Math.abs(z) - site.size[1] / 2)); }

/** Who hears about an edit: residents near a change, or whose own place it changed; minus those told already. */
export function planMapNotices(changes: MapChange[], residents: Iterable<MapResident>, o: { exclude?: Set<string>; mine?: (r: MapResident, c: MapChange) => boolean } = {}): MapPlan | null {
  if (!changes.length) return null;
  const souls: string[] = [];
  for (const r of residents) {
    if (o.exclude?.has(r.soulId)) continue;
    if (changes.some(c => distTo(r.p, c) <= MAP_NOTICE.nearM || (o.mine?.(r, c) ?? false))) souls.push(r.soulId);
  }
  return souls.length ? { changes, souls, at: changes[0].at } : null;
}
/** Residents near a build site (inside it too, unless `inside` excludes them: a closing site walks them out itself). */
export function nearSite(site: Site, residents: Iterable<MapResident>, o: { skipInside?: Site[] } = {}): string[] {
  const out: string[] = [];
  for (const r of residents) {
    if (o.skipInside?.some(z => inSite(z, r.p, .35))) continue;
    if (distToSite(site, r.p) <= MAP_NOTICE.nearM) out.push(r.soulId);
  }
  return out;
}

const clean = (s: string | undefined, n = 120) => s?.replace(/\s+/g, ' ').trim().replace(/[.!?;:,\s]+$/, '').slice(0, n) || undefined;
const article = (name: string) => /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
const the = (name: string) => name.startsWith('the ') ? name : `the ${name}`;
const phrase = (c: MapChange) => `${c.verb} ${c.verb === 'built' || c.verb === 'placed' ? article(c.name) : the(c.name)}`;
/** The sentence: the build's title (and its say), else the batch note, else what changed. `where`: " at the harbour". */
export function mapNoticeText(changes: MapChange[], label: MapLabel = {}, where = ' near you'): string {
  const title = clean(label.title, 60), say = clean(label.say), note = clean(label.note);
  if (title) return `The god is building ${title} nearby${say ? `: ${say}` : ''}.`;
  if (note) return `The god changed things${where}: ${note}.`;
  const [first, ...rest] = changes;
  if (!rest.length) return `The god ${phrase(first)}${where}.`;
  return `The god ${phrase(first)} and changed ${rest.length} other thing${rest.length === 1 ? '' : 's'}${where}.`;
}

type Tell = (soulId: string, text: string, place?: string) => void;
/** Delivery with the spam bound: one notice per resident per minute; sooner ones merge into one later notice. */
export class MapNotices {
  private readonly tell: Tell; private readonly now: () => number;
  private last = new Map<string, number>();
  private pending = new Map<string, { n: number; text: string; place?: string }>();
  private staged = new Map<string, { text: string; place?: string }>();
  constructor(tell: Tell, now: () => number) { this.tell = tell; this.now = now; }
  /** Hold a request's notices until it has finished (a build done in the same request replaces them). */
  stage(souls: string[], text: string, place?: string) {
    // an earlier request's notices go out first (requests run back to back without yielding: each keeps its own)
    if (this.staged.size) this.deliverStaged();
    for (const s of souls) this.staged.set(s, { text, ...(place ? { place } : {}) });
  }
  get hasStaged() { return this.staged.size > 0; }
  deliverStaged() { const staged = [...this.staged]; this.staged.clear(); for (const [s, n] of staged) this.send(s, n.text, n.place); }
  /** Rate-limited: now, or merged into the resident's next notice once its minute is up. */
  send(soulId: string, text: string, place?: string) {
    const now = this.now(), last = this.last.get(soulId);
    if (last !== undefined && now - last < MAP_NOTICE.everyMs) {
      const p = this.pending.get(soulId);
      this.pending.set(soulId, p ? { n: p.n + 1, text: p.text, ...(p.place === place && place ? { place } : {}) } : { n: 1, text, ...(place ? { place } : {}) });
      return;
    }
    this.last.set(soulId, now); this.tell(soulId, text, place);
  }
  /** Construction (a build started or done near the resident): told now, replacing what this request staged for it. */
  construction(souls: string[], text: string, place?: string) {
    const now = this.now();
    for (const s of souls) { this.staged.delete(s); this.pending.delete(s); this.last.set(s, now); this.tell(s, text, place); }
  }
  /** Deliver merged notices whose minute is up (the bridge calls this on its tick cadence). */
  flush() {
    const now = this.now();
    for (const [s, p] of [...this.pending]) {
      if (now - (this.last.get(s) ?? 0) < MAP_NOTICE.everyMs) continue;
      this.pending.delete(s); this.last.set(s, now);
      this.tell(s, p.n === 1 ? p.text : `The god kept changing things nearby (${p.n} more edits since the last notice).`, p.place);
    }
    // forget residents not told for a while (the map stays as small as the residents recently told)
    if (this.last.size > 512) for (const [s, at] of this.last) if (now - at >= MAP_NOTICE.everyMs && !this.pending.has(s)) this.last.delete(s);
  }
  pendingFor(soulId: string) { return this.pending.get(soulId)?.n ?? 0; }
}
