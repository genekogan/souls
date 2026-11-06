// What Souls perceive of god-built things (party lane F1). On an entity world the god's fountain, lamps, signs, statues,
// houses, ponds and plazas are walk targets (nav.ts); here they also become things a Soul can look at, name and read:
//
//  - each named god-built thing (and every sign, named or not) is an object of the kind `built`, registered through the
//    edge's object framework (OBJECT-CONTRACT-v1: "how an object kind enters the world without core changes"). Its
//    public state says what it is, what it is by, where it is, and the words written on it (a sign's text). So
//    `observe` → here.objects lists the nearest ones (readable), `look <name>` / `look <id>` find them through the
//    ledger's own perception, and `object <id>` reads a sign;
//  - a sign near a Soul is offered as `read:<id>` (walk up to it and face it), labelled with its words, so "read the
//    welcome sign" resolves through the ledger's own vocabulary.
//
// The object id is the entity id. Objects follow the entity world: re-derived on each god edit, removed with the thing.
// No edge file changes: the kind registers on the ledger's comms objects when they exist; the read capability goes in
// through the ledger's world-profile hook (as nav.ts's `walk:<path>`).
import { checkersStatus, containerInside, gameStatus, type Entity, type StoredDef, type WorldModel } from '@sim/world-compiler';
import { paintingLine } from '../art/art.ts';
import type { EdgeCapability, EdgeSoul } from '../edge/contract.ts';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import { readOnlyObjectAdvance, refreshOnlyObjectAdvance } from '../edge/comms/objects/framework.ts';
import type { NearFilter, Objects } from '../edge/comms/objects/framework.ts';
import { canonicalJson, stateDigest } from '../edge/comms/objects/table.ts';
import { ACT_SIGHT, actionsOf, actuatedState, keptShut, kindActions, wrapAct, type Thing } from './actuators.ts';
import { heldGodThing } from './held.ts';
import { waterRole, wordOf } from './water.ts';
import { economyOn } from './layers.ts';
import { supportY } from './nav.ts';
import { posterStale, worldDay } from './poster-boards.ts';
import { posterList, signupNoun, wantedList } from '@sim/world-compiler';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Plans = Map<string, { label: string; steps: { verb: string; params: Record<string, unknown> }[]; seconds?: boolean }>;
type Want = { name: string; kind: string; description: string; params: BuiltState & { paintingWhat?: true } };
/** Entry 27: a game board's read offer names only its state, never the grid or the players. */
function gameLabel(state: Record<string, unknown>): string { const st = gameStatus(String(state.text ?? '')); return st.moves === 0 ? 'a game of noughts and crosses, not started' : st.winner ? `a game of noughts and crosses, won by ${st.winner}` : st.draw ? 'a game of noughts and crosses, a draw' : `a game of noughts and crosses, ${st.turn} to play`; }
/** #439 W093: a checkers board's read offer names only its state, never the board or the players. */
function checkersLabel(state: Record<string, unknown>): string { const st = checkersStatus(state.text); return st.fresh ? 'a game of checkers, not started' : st.winner ? `a game of checkers, won by ${st.winner}` : `a game of checkers, ${st.turn} to play`; }
type SignRow = { id: string; at: Vec2; front: Vec2; name: string; text: string; writable?: boolean; pinboard?: boolean; list?: 'signup' | 'poll' | 'posters' | 'wanted'; noun?: string; votes?: number; game?: string; state?: Record<string, unknown> };
/** x0, z0, x1, z1 */
type Box = [number, number, number, number];
type Run = { queue: string[]; i: number; changed: string[]; made: number; root: string; layersOn: boolean; full: boolean; ms: number };
const CELL = 16;
const NEAR = 13;               // m: `near` names the named things within 12 m (nav namesNear), plus slack
const cellKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
/** The box of a named thing's outline (its area, path grown by half its width, room polygon, or its point). */
function boxOf(t: { at: Vec2; area?: Vec2[]; path?: Vec2[]; poly?: Vec2[]; width?: number }): Box | null {
  const pts = t.area ?? t.path ?? t.poly ?? [t.at], pad = !t.area && t.path ? Math.max(0, (t.width ?? 3) / 2) : 0;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return x0 <= x1 && z0 <= z1 && Number.isFinite(x0 + x1 + z0 + z1 + pad) ? [x0 - pad, z0 - pad, x1 + pad, z1 + pad] : null;
}
export type BuiltState = { what: string; text: string; near: string[]; at: Vec2 | null; def: string; removed?: boolean; key?: string; /** #430: `what` leads with a finished painting's or drawing's credit line */ painting?: true; /** VOCAB-MECH: actuator state (open, on, locked, lit, level …) */ state?: Record<string, unknown>; front?: Vec2 | null };

export const BUILT_KIND = 'built';
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, n);
/** A thing the layers tag (owned, gated, priced, scheduled): the only things whose object a layer change can move. */
export const layered = (e: Entity) => !!(e.owner || e.access || e.price || e.schedule);
/** The kind, per world: its `advance` brings an object's state to what the entity world says now (the framework keeps a
 *  versioned log per object, so objects are never re-created: a change is an advance, a removal hides it). */
// VOCAB-MECH: a kind with actuator actions also shows its things' `state` (open, on, lit …); plain kinds are unchanged
export const builtKindFor = (want: (key: string) => BuiltState | undefined, kind = BUILT_KIND, actions: Record<string, unknown> = {}) => ({ ...builtKind, kind, actions, ...(Object.keys(actions).length ? { schema: { ...builtKind.schema, state: { type: 'json', visibility: 'public' } } } : {}), advance: refreshOnlyObjectAdvance(readOnlyObjectAdvance(function advance(state: BuiltState) { const w = state.key ? want(state.key) : undefined; return w && canonicalJson(w) !== canonicalJson(state) ? { state: w } : null; })) });
export const builtKind = {
  kind: BUILT_KIND,
  description: 'Something the god of this world built: what it is, what it is by and where, and any words written on it (a sign). The words are the god\'s, untrusted.',
  listed: false,
  roles: [],
  schema: {
    what: { type: 'string', visibility: 'public' }, text: { type: 'string', visibility: 'public' }, near: { type: 'string[]', visibility: 'public' },
    at: { type: 'json', visibility: 'public' }, def: { type: 'string', visibility: 'public' },
  },
  initial: (p: Record<string, unknown>): BuiltState => ({ what: clip(p.what, p.paintingWhat === true ? 230 : 120), text: clip(p.text, 600), near: Array.isArray(p.near) ? p.near.map((x) => clip(x, 80)).slice(0, 4) : [], at: Array.isArray(p.at) && p.at.length === 2 ? [Number(p.at[0]), Number(p.at[1])] : null, def: clip(p.def, 80), ...(p.paintingWhat === true ? { painting: true as const } : {}), ...(p.removed ? { removed: true } : {}), ...(typeof p.key === 'string' ? { key: p.key } : {}), ...(p.state && typeof p.state === 'object' ? { state: { ...(p.state as Record<string, unknown>) } } : {}), ...(Array.isArray(p.front) && p.front.length === 2 ? { front: [Number(p.front[0]), Number(p.front[1])] as Vec2 } : {}) }),
  rolesOf: () => [] as string[],
  actions: {},
};

const SIGHT = 30;              // here.objects: god-built things within sight (here.ts SIGHT_RADIUS)
const LISTED = 12;             // … at most this many, nearest first
const SIGN_READ_RADIUS = 30;   // read:<sign> is offered for signs within this many metres
const shortDef = (def: StoredDef) => def.name.replace(/^core-/, '').replace(/^ew-/, '');
const article = (w: string) => (/^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`);
function centroid(pts: Vec2[]): Vec2 { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; }

/** A sign's words: its `text` state, else the def's default lines. */
export function signText(e: Entity, def: StoredDef): string | null {
  const sign = (def.components as Record<string, any>).sign; if (!sign) return null;
  const t = typeof e.state?.text === 'string' && e.state.text.trim() ? e.state.text : Array.isArray(sign.lines) ? sign.lines.join('\n') : '';
  return clip(t, 600);
}

export type PerceiveHost = {
  model: WorldModel;
  version?: () => number;
  edge?: EdgeLedger;
  engine: { world: { entities: Record<string, any> } };
  engineOwned(e: Entity): boolean;
  namesNear(at: Vec2, except: string): string[];
  /** The named things (nav.ts): an edit re-derives the objects within 12 m of the ones it touched. Without it every
   *  catch-up re-derives every thing. */
  things?(): { id: string; at: Vec2; area?: Vec2[]; path?: Vec2[]; poly?: Vec2[]; width?: number }[];
  /** R4-INFO: the god-built places layer (places.ts): synced first, then each object's place is the innermost one
   *  holding it. */
  places?: { sync(): void; syncStep?(budgetMs: number): boolean; placeAt(at: Vec2, level?: number): string | null; ofEntity(id: string): { id: string } | undefined };
  /** Engine level of a standing height (the bridge's levelAt). */
  levelAt?(x: number, z: number, y: number): number;
  /** VOCAB-MECH: commit a Soul's actuator action on a god thing (engine edit). Without it, things offer no actions. */
  commit?(ops: unknown[], note: string): { accepted: boolean };
  log(m: string): void;
  /** Entry 34 (watering.ts): "water <plant>" with a watering can from its hook. */
  watering?: { plan(soul: { entityId: string }, plant: string): { steps: { verb: string; params: Record<string, unknown> }[]; summary: string } | { code: string; reason: string } | null; expect(body: string): void };
  /** Entry 43 (tea.ts): the kettle and cup acts. */
  tea?: { plan(soul: { entityId: string }, id: string, action: string): { steps: { verb: string; params: Record<string, unknown> }[]; summary: string } | { code: string; reason: string } | null; expect(body: string): void };
  /** #435 (W072): a thing kept in a lost-and-found (a container with `claim: "owner"`) is only its owner's to handle. */
  claim?: (id: string, soul: EdgeSoul) => { code: string; reason: string } | null;
  /** LAYERS (layers.ts): owner/price/hours in what Souls see; private things refuse other Souls' actuators. */
  layers?: { active(): boolean; tag(e: Entity): string; refusal(id: string, soul: { soulId: string; name: string }): { code: string; reason: string } | null; ownerWord(id: string, soul?: { soulId: string; name: string }): string | null; hoursOf(s: Entity['schedule']): string };
};

/** Item 6 (F1): god-built buildings, their rooms and named areas (a plaza, a pond, a meadow) join the ledger's places
 *  layer, so arrivals and `here` say "moss-cottage" or "plaza" instead of "World"/"Green field", and the Souls' `map`
 *  lists them. Never enclosed (privacy and earshot rules unchanged), never starting, no capacity; ids `g-<path>`. */
export const GOD_PLACES = process.env.GOD_PLACES !== '0';

export class GodPerceive {
  private h: PerceiveHost;
  private sigs = new Map<string, string>();
  /** What each `built` object's state should be now (its kind's advance reads this). */
  private desired = new Map<string, BuiltState>();
  private signs = new Map<string, SignRow>();
  constructor(h: PerceiveHost) { this.h = h; }

  private objects() {
    const o = (this.h.edge as any)?.comms?.objects as { kindOf(k: string): unknown; register(k: unknown): void; create(i: unknown): unknown; fresh(): unknown; all(): { id: string; kind: string; name: string; state: unknown }[] } | undefined;
    if (!o) return null;
    if (!o.kindOf(BUILT_KIND)) { o.register(builtKindFor((key) => this.desired.get(key))); this.kinds.add(BUILT_KIND); }
    this.objs = o;
    this.wrapVisible(o as never);
    this.wrapCapabilities(o as never);
    if (this.h.commit) wrapAct(o as never, (id) => { const e = this.h.model.entities.get(id), def = e && this.h.model.resolvedDef(e.def); return e && def ? { def, state: actuatedState(e, def), name: e.name ? this.h.model.pathOf(e.id) : shortDef(def) } : null; }, this.actHost(), this.h.log);
    return o;
  }
  private objs: { kindOf(k: string): unknown; register(k: unknown): void } | null = null;
  /** R4-INFO: each built object's place (innermost god-built or world place holding it) and standing level. */
  private placed = new Map<string, { place: string | null; level: number }>();
  private kinds = new Set<string>();
  /** One object kind per kind of thing (fountain, lamp-post, sign …): here.objects lists at most two of each kind, so
   *  a single kind would show only the two nearest god things. A name the framework already uses gets `built-`. */
  private kindFor(short: string, def?: StoredDef): string {
    const o = this.objs!; let k = short.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || BUILT_KIND;
    // Different published revisions may expose different actions. Never give a frozen v1
    // object v2 actions (or hide v2 actions) because another revision registered first.
    if (def && def.version > 1) k = `${k}-v${def.version}`.slice(0, 48);
    if (!this.kinds.has(k) && o.kindOf(k)) k = `built-${k}`.slice(0, 48);
    // VOCAB-MECH: a def with actions (actuators) gives its kind those actions (one kind per kind of thing)
    if (!this.kinds.has(k)) this.registerBuiltKind(k, def, short);
    return k;
  }
  private registerBuiltKind(k: string, def?: StoredDef, short = k) {
    if (!this.objs!.kindOf(k)) this.objs!.register(builtKindFor(key => this.desired.get(key), k,
      def && actionsOf(def).length && this.h.commit ? kindActions(def, this.actHost(), st => {
        const id = (st as BuiltState).key, e = id ? this.h.model.entities.get(id) : undefined;
        return e?.name ? this.h.model.pathOf(e.id) : short;
      }) : {}));
    this.kinds.add(k);
  }
  /** Entry 42: a thing inside a container that is shut (a lantern in a closed locker). */
  private keptShut(id: string): boolean { const e = this.h.model.entities.get(id); return !!e && keptShut(this.h.model, e); }
  /** #439: the checkers boards, found once per world version (never a scan per offer). */
  private checkersIndex: { v: number; ids: string[] } | null = null;
  /** #439: another checkers board within ACT_SIGHT where this Soul has a game in progress (not won): its name, or null. */
  private gameElsewhere(soul: EdgeSoul, id: string): string | null {
    const m = this.h.model, v = this.h.version?.() ?? -1;
    if (!this.checkersIndex || this.checkersIndex.v !== v || v < 0) this.checkersIndex = { v, ids: [...m.entities.values()].filter((e) => m.resolvedDef(e.def)?.tags.includes('checkers')).map((e) => e.id) };
    const b = this.h.engine.world.entities[soul.entityId]?.pose?.p; if (!b) return null;
    for (const o of this.checkersIndex.ids) {
      const e = m.entities.get(o), def = e && m.resolvedDef(e.def); if (o === id || !e || !def) continue;
      const st = { ...actuatedState(e, def), ...(e.state ?? {}) }, ids = typeof st.textBy === 'string' && st.textBy ? st.textBy.split(',') : [];
      if (!ids.includes(soul.soulId) || checkersStatus(st.text).winner) continue;
      const wp = m.worldPose(e); if (Math.hypot(wp.x - b[0], wp.z - b[2]) <= ACT_SIGHT) return m.pathOf(o);
    }
    return null;
  }
  private actHost() {
    return {
      // entry 42: a container is not shut on a hand that is putting something in or taking something out
      busy: (id: string, action: string) => {
        if (action !== 'close') return null;
        const m = this.h.model, e = m.entities.get(id), ins = e ? containerInside(m.resolvedDef(e.def)) : null; if (!e || !ins) return null;
        const rt = (this.h.engine as unknown as { rt?: { holder(r: string): string[] } }).rt; if (!rt) return null;
        const slots = new Set(ins.slots.map((s) => s.id));
        const busy = ins.slots.some((s) => rt.holder(`surface-slot:${id}#${s.id}`).length) || [...(m.children.get(id) ?? [])].some((c) => slots.has(m.entities.get(c)?.in.slot ?? '') && rt.holder(`entity:${c}`).length);
        return busy ? { code: 'container.in-use', reason: `Someone's hand is in ${e.name ? m.pathOf(id) : 'it'}; wait until they are done.` } : null;
      },
      deferContacts: !!this.h.edge?.contactActuator,
      watering: (soul: EdgeSoul, id: string) => this.h.watering?.plan(soul, id) ?? null,
      wateringBegun: (soul: EdgeSoul) => this.h.watering?.expect(soul.entityId),
      tea: (soul: EdgeSoul, id: string, action: string) => this.h.tea?.plan(soul, id, action) ?? null,
      teaBegun: (soul: EdgeSoul) => this.h.tea?.expect(soul.entityId),
      gameElsewhere: (soul: EdgeSoul, id: string) => this.gameElsewhere(soul, id),
      contactPlan:(soul:EdgeSoul,id:string,action:string,params?:Record<string,unknown>)=>this.h.edge?.contactActuator?.plan(soul,id,action,params)??null,
      policy:(id:string,soul:EdgeSoul,action:string)=>this.h.edge?.contactActuator?.policy(soul,id,action)??null,
      bodyAt: (soul: EdgeSoul): Vec2 | null => { const b = this.h.engine.world.entities[soul.entityId]; return b?.pose?.p ? [b.pose.p[0], b.pose.p[2]] : null; },
      commit: (id: string, patch: Record<string, unknown>, note: string) => this.h.commit!([{ op: 'set', id, state: patch }], note),
      stateOf: (id: string) => { const e = this.h.model.entities.get(id), def = e && this.h.model.resolvedDef(e.def); return e && def ? actuatedState(e, def) : null; },
      access: (id: string, soul: EdgeSoul) => this.h.layers?.refusal(id, soul) ?? this.h.claim?.(id, soul) ?? null,
      // W5 (water.ts): tank → can → planter
      water: {
        thing: (id: string) => this.thing(id),
        held: (soul: EdgeSoul) => { const x = heldGodThing(this.h.engine.world.entities, soul.entityId); return x ? this.thing(x.id) : null; },
        sourceNear: (id: string, r: number) => {
          const e = this.h.model.entities.get(id); if (!e) return null;
          const p = this.h.model.worldPose(e); let best: Thing | null = null, bd = r;
          for (const o of this.h.model.entities.values()) {
            if (o.id === id) continue; const d0 = this.h.model.resolvedDef(o.def); if (!d0 || waterRole(d0) !== 'source') continue;
            const q = this.h.model.worldPose(o), d = Math.hypot(q.x - p.x, q.z - p.z); if (d <= bd) { bd = d; best = this.thing(o.id); }
          }
          return best;
        },
        commit: (set: { id: string; field: string; value: number }[], note: string) => this.h.commit!(set.map((x) => ({ op: 'set', id: x.id, state: { [x.field]: x.value } })), note),
      },
      // SOULFIX: where to stand to operate it: a clear spot within reach (1.5 m) on its level that the body can walk to,
      // nearest its front first, else nearest the thing (bars across a cell work from either side); deterministic order
      approach: (id: string, soul: EdgeSoul, front: Vec2 | null, radius = 1.5) => {
        const E = this.h.engine as unknown as { clearanceAtV1?: (x: number, z: number, level?: number) => number; reachV1?: (a: { p: Vec2; level?: number }, b: { p: Vec2; level?: number }) => { ok: boolean } };
        const e = this.h.model.entities.get(id), b = this.h.engine.world.entities[soul.entityId];
        if (!e || !b?.pose?.p || !E.clearanceAtV1 || !E.reachV1) return null;
        const wp = this.h.model.worldPose(e), at: Vec2 = [wp.x, wp.z], level = this.h.levelAt ? this.h.levelAt(wp.x, wp.z, wp.y) : 0;
        const me = { p: [b.pose.p[0], b.pose.p[2]] as Vec2, level: b.human?.level ?? 0 };
        const cands: { p: Vec2; d: number }[] = [];
        for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
          const p: Vec2 = [Math.round((at[0] + i * 0.25) * 100) / 100, Math.round((at[1] + j * 0.25) * 100) / 100], r = Math.hypot(p[0] - at[0], p[1] - at[1]);
          if (r < 0.3 || r > radius || E.clearanceAtV1(p[0], p[1], level) < 0.4) continue;
          cands.push({ p, d: front ? Math.hypot(p[0] - front[0], p[1] - front[1]) : r });
        }
        cands.sort((x, y) => x.d - y.d || x.p[0] - y.p[0] || x.p[1] - y.p[1]);
        for (const c of cands.slice(0, 16)) if (E.reachV1(me, { p: c.p, level }).ok) return { p: c.p, level };
        return null;
      },
    };
  }
  private thing(id: string): Thing | null {
    const e = this.h.model.entities.get(id), def = e && this.h.model.resolvedDef(e.def); if (!e || !def) return null;
    return { id, name: e.name ? this.h.model.pathOf(id) : `the ${wordOf(def)}`, def, state: actuatedState(e, def), params: (e.params ?? {}) as Record<string, unknown> };
  }
  private rootPlace(): string | null {
    const places = (this.h.edge as any)?.places?.byId as Map<string, { id: string; parent: string | null }> | undefined;
    for (const p of places?.values() ?? []) if (p.parent === null) return p.id;
    return null;
  }

  /** What one entity is as a `built` object (params keyed by its id), or null when it is not one: a named god thing, a
   *  sign, a thing with actuators or layers. Depends on the entity, its def, its ancestors' names, the named things
   *  within 12 m of it (`near`) and the layers; never on the places (an object's place is looked up when seen). */
  private wantOne(e: Entity, layersOn: boolean): { w: Want; sign?: SignRow } | null {
    const m = this.h.model, def = m.resolvedDef(e.def); if (!def) return null;
    const c = def.components as Record<string, unknown>;
    if (c.body || c.behavior || c.hover || /^core[-/]flag@/.test(def.ref) || this.h.engineOwned(e)) return null;
    if (keptShut(m, e)) return null;   // entry 42: kept in a shut drawer or locker: not a thing anyone sees until it is opened
    const text = signText(e, def), acts = this.h.commit ? actionsOf(def).length > 0 : false;
    // LAYERS: an owned, priced or scheduled thing is seen as such (a loaf for sale, Ana's door, the café's hours)
    const lay = layersOn && layered(e) ? this.h.layers!.tag(e) : '';
    if (!e.name && text === null && !acts && !lay) return null;
    // seats and things to carry are perceived as seats and items already (unless they have actuators: a chest's lid)
    if ((c.seat || c.carryable) && !acts && !lay) return null;
    // R4-INFO: ground the god laid out (a plaza, a lawn, a pond, a road) is a place to be in (places.ts), not a thing
    { const sh = e.shape as { area?: unknown; path?: unknown } | undefined; if (GOD_PLACES && this.h.places && def.form !== 'point' && e.in.parent === 'world' && sh && text === null) return null; }
    const at = this.at(e, def); if (!at) return null;
    const kind = shortDef(def), parent = e.in.parent !== 'world' ? m.entities.get(e.in.parent) : undefined;
    const name = e.name ? m.pathOf(e.id) : `${kind} ${e.id.slice(2, 6)}`;
    const near = this.h.namesNear(at, e.id).filter((n) => n !== name).slice(0, 2);
    const prefix = article(kind);
    const suffix = `${parent?.name ? ` in ${m.pathOf(parent.id)}` : ''}${near.length ? `, by ${near.join(' and ')}` : ''}${lay ? `; ${lay}` : ''}`;
    const painting = paintingLine(e, def, worldDay());
    // Keep the complete bounded painting credit plus exactly the suffix visible before it was painted.
    // Unpainted input is unchanged; only painted initialization opts into the 230-character bound.
    const what = painting ? painting + clip(prefix + suffix, 120).slice(prefix.length) : prefix + suffix;
    const wp0 = m.worldPose(e), front: Vec2 | null = acts ? [Math.round((at[0] + Math.sin(wp0.yaw) * (0.6 + def.size.box[2] * (wp0.s || 1) / 2)) * 100) / 100, Math.round((at[1] + Math.cos(wp0.yaw) * (0.6 + def.size.box[2] * (wp0.s || 1) / 2)) * 100) / 100] : null;
    // a board Souls write on keeps its own kind: kinds carry actions, and two writable v1 boards (a sign-up sheet, a poll, a game board)
    // under one `sign` kind would share whichever registered first (entries 25, 27)
    const w: Want = { name, kind: this.kindFor(text !== null && !def.tags.includes('hand-writable') ? 'sign' : kind, def), description: clip(def.description || kind, 400), params: { what, ...(painting ? { paintingWhat: true as const } : {}), text: text ?? '', near, at: [Math.round(at[0] * 100) / 100, Math.round(at[1] * 100) / 100], def: def.ref, ...(acts ? { state: actuatedState(e, def), front } : {}) } };
    if (text === null) return { w };
    // read from in front of its face (entity frame: the front is +z, turned by the yaw)
    const d = 1.4; return { w, sign: { id: e.id, at, front: [at[0] + Math.sin(wp0.yaw) * d, at[1] + Math.cos(wp0.yaw) * d], name, text, ...(def.tags.includes('hand-writable') ? { writable: true } : {}), ...(def.tags.includes('pinboard') ? { pinboard: true } : {}), ...(def.tags.includes('posters') ? { list: 'posters' as const, state: e.state ?? {} } : def.tags.includes('wanted') ? { list: 'wanted' as const, state: e.state ?? {} } : def.tags.includes('signup') ? { list: 'signup' as const, ...(signupNoun(def) ? { noun: signupNoun(def)! } : {}) } : def.tags.includes('poll') ? { list: 'poll' as const, votes: typeof e.state?.textBy === 'string' && e.state.textBy ? e.state.textBy.split(',').length : 0 } : {}), ...(def.tags.includes('tictactoe') ? { game: gameLabel(e.state ?? {}) } : def.tags.includes('checkers') ? { game: checkersLabel(e.state ?? {}) } : {}) } };
  }
  private at(e: Entity, def: StoredDef): Vec2 | null {
    const sh = e.shape as { area?: Vec2[]; path?: Vec2[] } | undefined;
    if (def.form !== 'point' && e.in.parent === 'world' && sh) return sh.area?.length ? centroid(sh.area) : sh.path?.length ? sh.path[Math.floor(sh.path.length / 2)] : null;
    const wp = this.h.model.worldPose(e); return [wp.x, wp.z];
  }
  /** R4-INFO: a built object's place (the innermost god-built or world place holding it) and standing level, looked up
   *  when a Soul sees it and remembered until the next catch-up. */
  private placeOf(id: string, at: Vec2): { place: string | null; level: number } {
    const hit = this.placed.get(id); if (hit) return hit;
    const e = this.h.model.entities.get(id);
    const level = e && this.h.levelAt ? this.h.levelAt(at[0], at[1], supportY(this.h.model, e)) : 0;
    const v = { place: this.h.places?.ofEntity(id)?.id ?? this.h.places?.placeAt(at, level) ?? null, level };
    this.placed.set(id, v); return v;
  }

  // ------------------------------------------------------------------ catching up with the god's edits
  // G1 (tranche 2026-10-19): at 4,900 entities a whole pass (places, then every named thing with its `near`) took
  // ~0.7 s and ran inside a tick after every edit, so the god's next request queued behind it. Now an edit only notes
  // what changed (`note`); the host runs the catch-up coalesced (at most every ~2 s while a god edits, and a second
  // after the last edit) in slices of a few ms (`step`), over the edited things and the ones within reach of their
  // names (12 m), not every thing. Souls may see an edit up to ~2 s late. `sync()` still catches up at once.
  private entries = new Map<string, { w: Want; sign?: SignRow; at: Vec2 }>();
  private cells = new Map<number, Set<string>>();
  private roots = new Set<string>();
  private rootOrigins = new Map<string, number>();
  private fullOrigin = 4;
  private needFull = true;
  private layersOn = false;
  private regions = new Map<string, Box>();
  private run: Run | null = null;
  private placesDone = false;
  /** For the host's log and tests: runs done, ids recomputed in the last one, whether it was a whole pass, its ms. */
  readonly stats = { runs: 0, lastIds: 0, lastFull: false, lastMs: 0 };

  /** An edit (any commit): these entities changed or went; `all` re-derives every thing (terrain moved, a build began
   *  or ended). Cheap: the work happens in `step`. */
  note(ids: Iterable<string>, all = false, origin: 'authored' | 'engine' | 'other' = 'other') {
    const bit = origin === 'authored' ? 1 : origin === 'engine' ? 2 : 4;
    if (all) { this.needFull = true; this.fullOrigin |= bit; }
    else for (const id of ids) {
      this.roots.add(id);
      if (process.env.SIM_CONTEXT_TIMINGS === '1') this.rootOrigins.set(id, (this.rootOrigins.get(id) ?? 0) | bit);
    }
  }
  /** Bounded diagnostic counters, never object names or payloads. Does not advance maintenance. */
  pendingSummary() {
    const values = [...this.rootOrigins.values()];
    return { full: this.needFull, fullOrigin: this.fullOrigin, roots: this.roots.size,
      authoredRoots: values.filter(value => value & 1).length, engineRoots: values.filter(value => value & 2).length,
      otherRoots: values.filter(value => value & 4).length, running: this.run !== null, placesDone: this.placesDone };
  }
  /** L4 item 5: things whose layer tag alone may have changed (a build event, the layers switching on or off): each is
   *  recomputed itself, with no neighbourhood expansion (a tag is not a name, so no other object's `near` moves). */
  noteRetag(ids: Iterable<string>) { for (const id of ids) this.retag.add(id); }
  private retag = new Set<string>();
  /** Anything noted and not caught up yet (or a catch-up under way)? */
  pending(): boolean { return this.needFull || this.roots.size > 0 || this.retag.size > 0 || this.run !== null; }

  private cellAdd(id: string, at: Vec2) { const k = cellKey(Math.floor(at[0] / CELL), Math.floor(at[1] / CELL)); let s = this.cells.get(k); if (!s) this.cells.set(k, s = new Set()); s.add(id); }
  private cellDel(id: string, at: Vec2) { this.cells.get(cellKey(Math.floor(at[0] / CELL), Math.floor(at[1] / CELL)))?.delete(id); }
  /** The objects whose point lies in a box. */
  private inBox(b: Box, out: Set<string>) {
    const i0 = Math.floor(b[0] / CELL), i1 = Math.floor(b[2] / CELL), j0 = Math.floor(b[1] / CELL), j1 = Math.floor(b[3] / CELL);
    const hit = (id: string, x: Vec2) => { if (x[0] >= b[0] && x[0] <= b[2] && x[1] >= b[1] && x[1] <= b[3]) out.add(id); };
    if (!((i1 - i0 + 1) * (j1 - j0 + 1) <= 4096)) { for (const [id, x] of this.entries) hit(id, x.at); return; }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const id of this.cells.get(cellKey(i, j)) ?? []) hit(id, this.entries.get(id)!.at);
  }

  /** Start a catch-up: which ids to recompute (all, or the noted ones, what they hold and what holds them, and the
   *  objects within 12 m of every named thing among them, before and after the edit). */
  private begin(): Run | null {
    const objs = this.objects(); if (!objs) return null;
    const root = this.rootPlace(); if (!root) return null;
    if (!this.sigs.size) for (const o of objs.all()) if (this.kinds.has(o.kind) || (o.state as BuiltState)?.key === o.id) { this.sigs.set(o.id, stateDigest(o.state)); if (!this.kinds.has(o.kind)) { const e = this.h.model.entities.get(o.id), def = e && this.h.model.resolvedDef(e.def); this.registerBuiltKind(o.kind, def ?? undefined); } }
    const layersOn = !!this.h.layers?.active();
    // L4 item 5: the layers switching on or off changes only what wantOne's `lay` reads: things with a layer field
    if (layersOn !== this.layersOn) { this.layersOn = layersOn; for (const e of this.h.model.entities.values()) if (layered(e)) this.retag.add(e.id); }
    const full = this.needFull || !this.h.things, roots = this.roots, retag = this.retag; this.needFull = false; this.roots = new Set(); this.retag = new Set(); this.rootOrigins.clear(); this.fullOrigin = 0;
    // the named things now (their outlines: what `near` measures to), against the last catch-up's
    const now = new Map<string, Box>();
    for (const t of this.h.things?.() ?? []) { const b = boxOf(t); if (!b) continue; const o = now.get(t.id); now.set(t.id, o ? [Math.min(o[0], b[0]), Math.min(o[1], b[1]), Math.max(o[2], b[2]), Math.max(o[3], b[3])] : b); }
    let ids: Set<string>;
    if (full) ids = new Set([...this.h.model.entities.keys(), ...this.entries.keys(), ...this.sigs.keys()]);
    else {
      const m = this.h.model, touched = new Set<string>();
      ids = new Set();
      for (const id of roots) {
        for (const x of m.entities.has(id) ? m.subtree(id) : [id]) touched.add(x);
        for (let p = m.entities.get(id)?.in.parent; p && p !== 'world'; p = m.entities.get(p)?.in.parent) touched.add(p);
      }
      for (const id of touched) {
        ids.add(id);
        for (const b of [this.regions.get(id), now.get(id)]) if (b) this.inBox([b[0] - NEAR, b[1] - NEAR, b[2] + NEAR, b[3] + NEAR], ids);
      }
      for (const id of retag) ids.add(id);
    }
    this.regions = now;
    this.placed.clear();
    return { queue: [...ids], i: 0, changed: [], made: 0, root, layersOn, full, ms: 0 };
  }
  /** Recompute one id and bring its object in line. */
  private apply(r: Run, id: string, objs: { create(i: unknown): unknown; refresh?(ids: string[]): void }) {
    const e = this.h.model.entities.get(id), x = e ? this.wantOne(e, r.layersOn) : null;
    const old = this.entries.get(id);
    if (old) { this.cellDel(id, old.at); this.entries.delete(id); this.signs.delete(id); }
    if (!x) {
      // gone from the entity world: hidden (removed), never deleted (an undo brings the same id back)
      const sig = this.sigs.get(id); if (sig === undefined) return;
      const st = { ...(JSON.parse(sig) as BuiltState), removed: true, key: id }, n = canonicalJson(st);
      if (n !== sig) { this.desired.set(id, st); this.sigs.set(id, n); r.changed.push(id); objs.refresh?.([id]); }
      return;
    }
    const at = x.w.params.at as Vec2;
    this.entries.set(id, { ...x, at }); this.cellAdd(id, at); if (x.sign) this.signs.set(id, x.sign);
    const state = builtKind.initial({ ...x.w.params, key: id } as never), sig = canonicalJson(state);
    if (this.sigs.get(id) === sig) return;
    this.desired.set(id, state);
    try {
      // L8: a changed object is brought in line at once, not at the end of the (sliced) catch-up: built kinds' advance is
      // refresh-only, so a listing between slices would otherwise show the old state of an object already recomputed
      if (!this.sigs.has(id)) { objs.create({ id, kind: x.w.kind, name: x.w.name, description: x.w.description, placeId: r.root, params: { ...x.w.params, key: id } }); r.made++; } else { r.changed.push(id); objs.refresh?.([id]); }
      this.sigs.set(id, sig);
    } catch (err) { this.h.log(`built object ${id}: ${(err as Error).message}`); }
  }
  /** Do up to `budgetMs` of a catch-up (starting one when something is noted). True when it is done (or none was due). */
  step(budgetMs = Infinity): boolean {
    const t0 = performance.now();
    if (!this.run) {
      if (!this.pending()) return true;
      // the places first (an object's place is the innermost one holding it); a world without objects has places too
      if (GOD_PLACES && this.h.places && !this.placesDone) {
        try { const P = this.h.places; if (!(P.syncStep ? P.syncStep(budgetMs) : (P.sync(), true))) return false; } catch (err) { this.h.log(`god places: ${(err as Error).message}`); }
        this.placesDone = true;
        if (performance.now() - t0 >= budgetMs) return false;
      }
      this.placesDone = false;
      this.run = this.begin();
      // no comms objects (or no root place) yet: what is noted stays noted, tried again at the next catch-up
      if (!this.run) { this.noObjects = true; return true; }
      if (performance.now() - t0 >= budgetMs) { this.run.ms += performance.now() - t0; return false; }
    }
    const r = this.run, objs = this.objs as unknown as { create(i: unknown): unknown; fresh(): unknown; refresh?(ids: string[]): void };
    while (r.i < r.queue.length) {
      this.apply(r, r.queue[r.i++], objs);
      // One apply can rebuild the named-thing index; do not start another object after it consumes the slice.
      if (performance.now() - t0 >= budgetMs) { r.ms += performance.now() - t0; return false; }
    }
    if (r.changed.length && !objs.refresh) objs.fresh();   // with refresh, apply() already brought each one in line
    r.ms += performance.now() - t0;
    this.run = null;
    Object.assign(this.stats, { runs: this.stats.runs + 1, lastIds: r.queue.length, lastFull: r.full, lastMs: Math.round(r.ms * 10) / 10 });
    if (r.made + r.changed.length > 8) this.h.log(`built objects: ${r.made} made, ${r.changed.length} changed (${this.sigs.size} in all)`);
    return true;
  }
  /** Bring the `built` objects in line with the entity world now (tests; `force` re-derives every thing). */
  sync(force = false) { if (force) this.needFull = true; this.noObjects = false; for (let n = 0; n < 100 && this.pending() && !this.noObjects; n++) this.step(); }
  private noObjects = false;
  /** What a Soul's read sees: the objects as they are (an edit shows within ~2 s), caught up once at the start. */
  ensure() { if (!this.stats.runs) this.sync(); }

  /** R4-INFO: `observe` → here.objects lists what a Soul sees of god-built things as Eden lists things: those within
   *  sight (30 m) in the same enclosure (a room's walls hide the plaza; the plaza does not see into the cottage), nearest
   *  first, each with the place it stands in (`placeId`), `here` when that is a place the Soul is in, and its distance.
   *  (The framework would list every one, everywhere, `here`, in the world's root place.) Other kinds pass unchanged. */
  private wrapVisible(o: { visibleTo(soul: EdgeSoul, near?: NearFilter): any[] } & { __godVisible?: boolean }) {
    if (o.__godVisible || !this.h.edge) return; o.__godVisible = true;
    const orig = o.visibleTo.bind(o), L = this.h.edge;
    o.visibleTo = (soul: EdgeSoul) => {
      // L8: only built things within sight are viewed at all (the framework's cell index), not every one in the world
      const me = this.h.engine.world.entities[soul.entityId], list = orig(soul, me ? { at: [me.pose.p[0], me.pose.p[2]], radius: SIGHT, kinds: this.kinds } : undefined);
      if (!me) return list;
      this.ensure();
      const pos: Vec2 = [me.pose.p[0], me.pose.p[2]], path = L.placePathOf(soul.soulId), root = path.find((p) => p.kind !== 'occupier' && L.places.byId.get(p.id)?.parent === null)?.id;
      const inside = new Set(path.map((p) => p.id)), myEnc = L.enclosureOf(soul.soulId), lay = !!this.h.layers?.active();
      const built: any[] = [], rest: any[] = [];
      for (const v of list) {
        if (!this.kinds.has(v.kind)) { rest.push(v); continue; }
        const at = v.public?.at as Vec2 | null | undefined; if (!Array.isArray(at)) continue;
        const d = Math.hypot(at[0] - pos[0], at[1] - pos[1]); if (d > SIGHT) continue;
        if (this.keptShut(v.id)) continue;   // entry 42: a thing kept in a shut drawer or locker is not seen
        const pl = this.placeOf(v.id, at), lvl = pl.level;
        if (L.enclosureAtPoint(at[0], at[1], lvl) !== myEnc) continue;
        const placeId = pl.place ?? v.placeId;
        // LAYERS: whose it is, to this viewer ("yours" / "Ana's, private" / "public"), its price and hours now
        const ent = lay ? this.h.model.entities.get(v.id) : undefined, word = ent ? this.h.layers!.ownerWord(v.id, soul) : null;
        const extra = ent ? { ...(word ? { owner: word } : {}), ...(ent.price && economyOn() ? { price: ent.price } : {}), ...(ent.schedule ? { hours: this.h.layers!.hoursOf(ent.schedule) } : {}) } : {};
        built.push({ ...v, placeId, here: placeId !== root && inside.has(placeId), dist: Math.round(d * 10) / 10, ...extra });
      }
      built.sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : 1));
      return [...rest, ...built.slice(0, LISTED)];
    };
  }

  /** Unreachable built-object actuators do not belong in discovery. Keep direct admission's
   * honest refusal and nearby state/permission refusals; do not affect other object kinds. */
  private wrapCapabilities(o: Pick<Objects, 'capabilities'> & { __godCaps?: boolean }) {
    if (o.__godCaps) return; o.__godCaps = true;
    const original = o.capabilities.bind(o);
    o.capabilities = (...args) => original(...args).filter(cap =>
      !(cap.object && this.desired.has(cap.object) && cap.blocked?.code === 'object.out-of-reach'));
  }

  /** `read:<sign>` for signs near this Soul: walk up to it and face it; the label carries its words. */
  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Plans) {
    this.ensure();
    const me = this.h.engine.world.entities[soul.entityId]; if (!me?.human || !this.signs.size) return;
    const here: Vec2 = [me.pose.p[0], me.pose.p[2]];
    const seated = me.human.activity === 'sit' || me.human.baseActivity === 'sit';
    for (const s of this.signs.values()) {
      const d = Math.hypot(s.at[0] - here[0], s.at[1] - here[1]); if (d > SIGN_READ_RADIUS) continue;
      const id = `read:${s.id}`; if (caps.some((c) => c.id === id)) continue;
      const words = s.text.replace(/\s*\n\s*/g, ' / ');
      // A Soul-written board offers a read only when written on, and never carries its words: they come with the read.
      if (s.writable && !words && s.list !== 'poll' && !s.game) continue;
      const pinned = s.pinboard ? s.text.split('\n').length : 0;
      const names = s.list === 'signup' ? s.text.split('\n').filter(Boolean).length : 0;
      // entry 25: counts only, never the names or the question (they come with the read)
      // entry 38: counts only (posters, out-of-date ones, wanted / offered / taken notes), never a title, a note or a name
      const listLabel = s.list === 'posters' ? (() => { const ps = posterList(s.state ?? {}), old = ps.filter(p => posterStale(p)).length; return `Read ${s.name} (a poster wall, ${ps.length} poster${ps.length === 1 ? '' : 's'}${old ? `, ${old} out of date` : ''}, ${Math.round(d)} m)`; })()
        : s.list === 'wanted' ? (() => { const ns = wantedList(s.state ?? {}), w = ns.filter(n => n.c === 'w').length, tk = ns.filter(n => n.tk).length; return `Read ${s.name} (a wanted/offered board, ${w} wanted, ${ns.length - w} offered${tk ? `, ${tk} taken` : ''}, ${Math.round(d)} m)`; })() : null;
      const label = listLabel ?? (s.game ? `Read ${s.name} (${s.game}, ${Math.round(d)} m)` : s.list === 'poll' ? `Read ${s.name} (a poll, ${s.votes ?? 0} vote${s.votes === 1 ? '' : 's'}, ${Math.round(d)} m)` : names ? `Read ${s.name} (a ${s.noun ?? 'sign-up sheet'}, ${names} name${names > 1 ? 's' : ''}, ${Math.round(d)} m)` : pinned ? `Read ${s.name} (${pinned} pinned note${pinned > 1 ? 's' : ''}, ${Math.round(d)} m)` : s.writable ? `Read ${s.name} (a board with writing on it, ${Math.round(d)} m)` : `Read ${s.name} (a sign, ${Math.round(d)} m): "${words.length > 160 ? words.slice(0, 157) + '…' : words}"`);
      caps.push({ id, verb: 'read', label, target: { id: s.id, kind: 'object' }, available: true });
      plans.set(id, { label: `Read ${s.name}`, steps: [...(seated ? [{ verb: 'stand', params: {} }] : []), ...(Math.hypot(s.front[0] - here[0], s.front[1] - here[1]) > 0.8 ? [{ verb: 'walk_to', params: { to: s.front, standoff: 0 } }] : []), { verb: 'wave', params: { at: s.id, seconds: 1 } }] });
    }
  }
}
