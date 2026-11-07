import {
  Runtime, createRegistry, describeVerbs, hashOf, nextFloat, physicalView,
  type ActionDef, type ActivityOption, type Anchor, type ChangeEvent, type Diagnostic, type Engine, type EngineFactory, type Entity,
  type Intent, type Invariant, type PathCommit, type PoseSample, type Program, type ProgramEvent, type RuntimeSnapshot, type Vec3, type WorldState,
} from '@souls/engine-contract';
import { HALF, START_DATETIME, TOY_RULES_VERSION, TOY_SCHEMA, genesis } from './world.ts';
import { PRIMITIVES, distMm, doActivity, mmOf, occupancy, type ToyServices } from './verbs.ts';

const prims = createRegistry(PRIMITIVES);
const REGISTRY = createRegistry([...PRIMITIVES, doActivity(prims)]);
const START_MS = Date.UTC(2026, 9, 1, 8, 0, 0);
if (START_DATETIME !== '2026-10-01T08:00:00') throw new Error('START_DATETIME and START_MS must match');

const inBounds: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  for (const id of Object.keys(rt.world.entities).sort()) {
    const e = rt.world.entities[id];
    if (Math.abs(e.pose.p[0]) > HALF + 0.001 || Math.abs(e.pose.p[2]) > HALF + 0.001) out.push({ code: 'bounds.outside', message: `${id} is outside the ground`, subjects: [id] });
  }
  return out;
};

// 12 spots on a 2.5 m ring around a gathering fixture (mm), precomputed: no trig at runtime.
const RING: [number, number][] = [[2500, 0], [2165, 1250], [1250, 2165], [0, 2500], [-1250, 2165], [-2165, 1250], [-2500, 0], [-2165, -1250], [-1250, -2165], [0, -2500], [1250, -2165], [2165, -1250]];
const slotOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h % RING.length; };

const bucket = (mm: number): 'here' | 'close' | 'near' | 'far' => (mm < 2500 ? 'here' : mm < 9000 ? 'close' : mm < 28000 ? 'near' : 'far');
const inPoly = (p: [number, number], poly: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

export class ToyEngine implements Engine {
  readonly rulesVersion = TOY_RULES_VERSION;
  readonly dt = 1 / 20;
  readonly schema = TOY_SCHEMA;
  readonly runtime: Runtime;
  registry: Map<string, ActionDef> = REGISTRY;
  private paths: PathCommit[] = [];
  private changes: ChangeEvent[] = [];
  private cursor = 0;

  constructor(world: WorldState | Runtime) {
    const services: ToyServices = {
      emitPath: (p) => { this.paths.push(p); },
      change: (entity, field, value) => { this.changes.push([this.runtime.tick, entity, field, value]); },
    };
    if (world instanceof Runtime) { this.runtime = world; this.runtime.services = services; this.cursor = this.runtime.events.length; }
    else this.runtime = new Runtime(world, REGISTRY, services, [inBounds]);
  }

  get world() { return this.runtime.world; }
  describeVerbs() { return describeVerbs(this.registry); }
  stateHash() { return this.runtime.stateHash(); }
  physicalHash() { return hashOf(physicalView(this.world)); }

  step() {
    this.runtime.step();
    if (this.world.tick % 1200 === 0) {
      this.world.env.datetime = new Date(START_MS + this.world.tick * 50).toISOString().slice(0, 19);
      this.changes.push([this.world.tick, '$env', 'datetime', this.world.env.datetime]);
    }
    const events = this.runtime.events.slice(this.cursor);
    const programs: ProgramEvent[] = [];
    for (const ev of events) {
      if (ev.type !== 'action' || ev.verb !== 'do_activity') continue;
      const actor = (this.runtime.records.get(ev.id)?.params as { actor?: string } | undefined)?.actor ?? '';
      if (ev.status === 'executing' && ev.phase) programs.push({ tick: ev.tick, id: ev.id, actor, kind: 'step', step: Number(ev.phase.split(':')[0]) });
      else if (ev.status === 'completed' || ev.status === 'failed' || ev.status === 'cancelled') programs.push({ tick: ev.tick, id: ev.id, actor, kind: ev.status, step: -1, code: ev.code, message: ev.message });
    }
    const out = { paths: this.paths, changes: this.changes, events, programs };
    this.paths = []; this.changes = []; this.cursor = this.runtime.events.length;
    // Bound memory: the runtime event list and terminal records are not part of the hashed world.
    if (this.runtime.events.length > 20000) { this.runtime.events.splice(0, this.runtime.events.length - 1000); this.cursor = this.runtime.events.length; }
    if (this.world.tick % 600 === 0) for (const [id, r] of this.runtime.records) { if (r.endedTick !== undefined && r.endedTick < this.world.tick - 1200) this.runtime.records.delete(id); }
    return out;
  }

  submit(verb: string, params: unknown, opts?: { id?: string; parent?: string; preempt?: boolean }) { return this.runtime.submit(verb, params, opts); }

  perform(p: Program) {
    const r = this.runtime.submit('do_activity', { actor: p.actor, label: p.label.slice(0, 200), steps: p.steps }, { preempt: true });
    return { id: r.id, ok: r.status !== 'failed', ...(r.diagnostic ? { diagnostic: { code: r.diagnostic.code, message: r.diagnostic.message } } : {}) };
  }
  stop(programId: string) { if (this.runtime.isActive(programId)) this.runtime.cancel(programId, { code: 'program.stopped', message: 'stopped' }); }
  canPerform(p: Program) {
    const first = p.steps[0]; if (!first) return null;
    const def = prims.get(first.verb); if (!def) return { code: 'action.unknown-verb', message: `unknown verb ${first.verb}` };
    const parsed = def.schema.safeParse({ ...first.params, actor: p.actor }); if (!parsed.success) return { code: 'params.invalid', message: parsed.error.message };
    const plan = def.plan(this.runtime, parsed.data);
    return plan.ok ? null : { code: plan.diagnostic.code, message: plan.diagnostic.message };
  }
  programOf(actor: string) { return this.world.entities[actor]?.human?.task ?? null; }
  cancel(id: string, reason?: { code: string; message: string }) { return this.runtime.cancel(id, reason); }
  snapshot(): RuntimeSnapshot { return this.runtime.snapshot(); }

  spawnHuman({ id, label, soul }: { id: string; label: string; soul: string }): string {
    if (this.world.entities[id]) return id;
    const gate = this.world.entities['gate'];
    const jx = (nextFloat(this.world.rng) * 2 - 1) * 3, jz = -nextFloat(this.world.rng) * 4;
    const x = Math.round((gate.pose.p[0] + jx) * 1000) / 1000, z = Math.round((gate.pose.p[2] + jz) * 1000) / 1000;
    const e: Entity = {
      id, def: 'human-casual', kind: 'human', label,
      pose: { p: [x, 0, z], yaw: 3.142 }, provenance: { origin: 'simulation', confidence: 'hypothetical' },
      human: { activity: 'idle', level: 0, soul },
    };
    this.world.entities[id] = e;
    this.changes.push([this.world.tick, id, 'present', e]);
    return id;
  }

  removeEntity(id: string) {
    for (const lid of this.runtime.liveIds()) { const r = this.runtime.records.get(lid); if ((r?.params as { actor?: string } | undefined)?.actor === id) this.runtime.cancel(lid, { code: 'actor.removed', message: 'actor removed' }); }
    delete this.world.entities[id];
    this.changes.push([this.world.tick, id, 'present', null]);
  }

  anchors(): Anchor[] {
    const w = this.world, out: Anchor[] = [];
    for (const id of Object.keys(w.regions).sort()) { const r = w.regions[id], poly = r.polygon; out.push({ id, kind: 'region', name: r.label, point: [(poly[0][0] + poly[2][0]) / 2, (poly[0][1] + poly[2][1]) / 2] }); }
    for (const id of Object.keys(w.entities).sort()) { const e = w.entities[id]; if (e.kind !== 'fixture') continue; out.push({ id, kind: 'place', name: e.label ?? id, in: this.regionAt(e.pose.p), entity: id, tags: [e.def, ...(e.seats ? ['seats'] : []), ...(id === 'gate' ? ['arrival'] : [])] }); }
    return out;
  }

  regionAt(p: Vec3): string {
    const pt: [number, number] = [p[0], p[2]];
    return inPoly(pt, this.world.regions.center.polygon) ? 'center' : 'ring';
  }

  poseSampleOf(id: string): PoseSample {
    const e = this.world.entities[id];
    return [this.world.tick, Math.round(e.pose.p[0] * 1000), 0, Math.round(e.pose.p[2] * 1000), Math.round(e.pose.yaw * 1000)];
  }
  /** The path an entity is currently walking, derived from in-flight action state (so it survives restore). */
  currentPath(id: string): PathCommit | undefined {
    for (const { record, exec } of this.runtime.liveEntries()) {
      if ((record.params as { actor?: string }).actor !== id) continue;
      const x = exec as { samples?: PoseSample[] | null; child?: { samples?: PoseSample[] | null } | null };
      const samples = x.samples ?? x.child?.samples;
      if (samples && samples[samples.length - 1][0] > this.world.tick) return { entity: id, startTick: samples[0][0], speed: 0, waypoints: samples, activity: 'walk', actionId: record.id };
    }
    return undefined;
  }

  describeSurroundings(actorId: string) {
    const w = this.world, a = w.entities[actorId];
    const me = mmOf(a);
    const items = Object.keys(w.entities).sort().filter((id) => id !== actorId && id !== 'gate').map((id) => {
      const e = w.entities[id];
      const d = distMm(me, mmOf(e));
      if (e.kind === 'human') return { id, d, who: e.label ?? id, what: 'a soul', doing: doingOf(w, e) };
      const n = occupancy(w, id);
      return { id, d, who: e.label ?? id, what: e.def, doing: n === 0 ? 'empty' : n === 1 ? '1 soul here' : `${n} souls here${n >= 4 ? ', lively' : ''}` };
    }).sort((x, y) => x.d - y.d || x.id.localeCompare(y.id));
    const humans = items.filter((i) => w.entities[i.id].kind === 'human').slice(0, 5);
    const fixtures = items.filter((i) => w.entities[i.id].kind !== 'human').slice(0, 4);
    const nearby = [...humans, ...fixtures].sort((x, y) => x.d - y.d).slice(0, 8).map(({ id, who, what, doing, d }) => ({ id, who, what, distance: bucket(d), doing }));
    const fire = occupancy(w, 'campfire');
    return { nearby, region: this.regionAt(a.pose.p), happening: fire >= 2 ? `a gathering at the campfire (${fire} souls)` : 'nothing in particular' };
  }

  enumerateActivities(actorId: string, intent: Intent | null): ActivityOption[] {
    const w = this.world, a = w.entities[actorId];
    if (!a?.human) return [];
    const me = mmOf(a);
    const opts: ActivityOption[] = [];
    const others = Object.keys(w.entities).sort().filter((id) => id !== actorId && w.entities[id].kind === 'human')
      .map((id) => ({ e: w.entities[id], d: distMm(me, mmOf(w.entities[id])) })).sort((x, y) => x.d - y.d || x.e.id.localeCompare(y.e.id));
    const name = (e: Entity) => e.label ?? e.id;

    // attend the campfire
    const fire = w.entities['campfire'];
    if (a.human.on !== 'campfire' && occupancy(w, 'campfire') < (fire.seats ?? 0)) {
      const s = RING[slotOf(actorId)];
      opts.push({
        id: 'attend:campfire', template: 'attend', target: 'campfire', durationHint: 'minutes',
        label: 'Walk to the campfire and join whoever is gathered there', goodWhen: 'the soul wants company or the intent is to attend or gather', notFor: 'the soul wants to be alone or is exhausted',
        steps: [{ verb: 'walk_to', params: { to: [s[0] / 1000, s[1] / 1000] } }, { verb: 'gather', params: { at: 'campfire', seconds: 150 } }],
      });
    }
    // rest on a bench with a free seat (nearest two)
    const benches = Object.keys(w.entities).sort().filter((id) => w.entities[id].def === 'bench' && occupancy(w, id) < (w.entities[id].seats ?? 0))
      .map((id) => ({ id, d: distMm(me, mmOf(w.entities[id])) })).sort((x, y) => x.d - y.d).slice(0, 2);
    for (const b of benches) opts.push({
      id: `rest:${b.id}`, template: 'rest', target: b.id, durationHint: 'minutes',
      label: `Walk to ${name(w.entities[b.id])} (${bucket(b.d)}) and rest there`, goodWhen: 'energy is low, the intent is to rest, or the soul wants quiet', notFor: 'the soul is energetic and something interesting is happening nearby',
      steps: [{ verb: 'walk_to', params: { to: b.id, standoff: 1 } }, { verb: 'sit', params: { on: b.id, seconds: 5 } }, { verb: 'rest', params: { seconds: 120 } }],
    });
    // converse with the nearest few souls
    for (const o of others.slice(0, 3)) opts.push({
      id: `converse:${o.e.id}`, template: 'converse', target: o.e.id, durationHint: 'minute',
      label: `Go to ${name(o.e)} (${bucket(o.d)}, ${doingOf(w, o.e)}) and talk`, goodWhen: `the soul wants company, or the intent names ${name(o.e)}`, notFor: 'the soul wants to be alone, or the other soul is far away',
      steps: [{ verb: 'walk_to', params: { to: o.e.id, standoff: 1.3 } }, { verb: 'wave', params: { at: o.e.id, seconds: 2 } }, { verb: 'converse', params: { with: o.e.id, seconds: 45 } }],
    });
    // intent-specific
    const t = intent?.target ?? undefined;
    if (t && w.entities[t] && t !== actorId) {
      const te = w.entities[t];
      if (intent!.goal === 'follow' && te.kind === 'human' && !opts.some((o) => o.id === `follow:${t}`)) opts.unshift({
        id: `follow:${t}`, template: 'follow', target: t, durationHint: 'minute',
        label: `Follow ${name(te)} wherever they are going`, goodWhen: `the intent is to follow ${name(te)}`, notFor: 'the intent is about something else',
        steps: [{ verb: 'walk_to', params: { to: t, standoff: 2 } }, { verb: 'rest', params: { seconds: 8 } }, { verb: 'walk_to', params: { to: t, standoff: 2 } }, { verb: 'rest', params: { seconds: 8 } }, { verb: 'walk_to', params: { to: t, standoff: 2 } }],
      });
      if ((intent!.goal === 'go' || (intent!.goal === 'converse' && te.kind !== 'human')) && distMm(me, mmOf(te)) > 3000) opts.unshift({
        id: `go:${t}`, template: 'go', target: t, durationHint: 'minute',
        label: `Walk to ${name(te)} and stay there a while`, goodWhen: `the intent is to go to ${name(te)}`, notFor: 'the intent is about something else',
        steps: [{ verb: 'walk_to', params: { to: t, standoff: 1.5 } }, { verb: 'rest', params: { seconds: 60 } }],
      });
    }
    if (t && w.regions[t] && intent!.goal === 'go' && this.regionAt(a.pose.p) !== t) {
      const poly = w.regions[t].polygon; const cx = (poly[0][0] + poly[2][0]) / 2, cz = (poly[0][1] + poly[2][1]) / 2;
      opts.unshift({ id: `go:${t}`, template: 'go', target: t, durationHint: 'minute', label: `Walk to ${w.regions[t].label}`, goodWhen: `the intent is to go to ${w.regions[t].label}`, notFor: 'the intent is about something else', steps: [{ verb: 'walk_to', params: { to: [cx, cz] } }, { verb: 'rest', params: { seconds: 30 } }] });
    }
    // An intent that names a soul or a bench must always have a matching option, however far the target is.
    if (t && w.entities[t] && t !== actorId) {
      const te = w.entities[t], d = distMm(me, mmOf(te));
      if (intent!.goal === 'converse' && te.kind === 'human' && !opts.some((o) => o.id === `converse:${t}`)) opts.unshift({
        id: `converse:${t}`, template: 'converse', target: t, durationHint: 'minute',
        label: `Go to ${name(te)} (${bucket(d)}, ${doingOf(w, te)}) and talk`, goodWhen: `the intent names ${name(te)}`, notFor: 'the intent is about something else',
        steps: [{ verb: 'walk_to', params: { to: t, standoff: 1.3 } }, { verb: 'wave', params: { at: t, seconds: 2 } }, { verb: 'converse', params: { with: t, seconds: 45 } }],
      });
      if (intent!.goal === 'rest' && te.def === 'bench' && !opts.some((o) => o.id === `rest:${t}`) && occupancy(w, t) < (te.seats ?? 0)) opts.unshift({
        id: `rest:${t}`, template: 'rest', target: t, durationHint: 'minutes',
        label: `Walk to ${name(te)} (${bucket(d)}) and rest there`, goodWhen: `the intent is to rest at ${name(te)}`, notFor: 'the intent is about something else',
        steps: [{ verb: 'walk_to', params: { to: t, standoff: 1 } }, { verb: 'sit', params: { on: t, seconds: 5 } }, { verb: 'rest', params: { seconds: 120 } }],
      });
    }
    opts.push({ id: 'perform', template: 'perform', durationHint: 'seconds', label: 'Perform something (sing, dance or tell a story) right here', goodWhen: 'others are close by to watch and the personality enjoys an audience', notFor: 'nobody is close, or the soul is shy or tired', steps: [{ verb: 'perform', params: { seconds: 30 } }] });
    opts.push({ id: 'wander', template: 'wander', durationHint: 'minute', label: 'Drift around nearby with no particular aim', goodWhen: 'there is no intent and nothing nearby appeals', notFor: 'the intent names something specific to do', steps: [{ verb: 'ambient_wander', params: { seconds: 60, radius: 12 } }] });
    opts.push({ id: 'wander:far', template: 'wander', durationHint: 'minutes', label: 'Go exploring farther afield', goodWhen: 'the soul is energetic and curious, or the intent is to wander', notFor: 'the soul is tired, or the intent is to stay with others', steps: [{ verb: 'ambient_wander', params: { seconds: 120, radius: 35 } }] });
    // Flag what the intent asks for (a fact code knows), and list those first so they survive the cap.
    if (intent) for (const o of opts) {
      const g = intent.goal, tmpl = o.template;
      o.servesIntent = t ? o.target === t && (tmpl === g || (g === 'gather' && tmpl === 'attend') || (g === 'attend' && tmpl === 'attend') || (g === 'go' && tmpl === 'go'))
        : tmpl === g || (g === 'gather' && tmpl === 'attend');
    }
    const seen = new Set<string>();
    return opts.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true))).sort((a, b) => Number(!!b.servesIntent) - Number(!!a.servesIntent)).slice(0, 9);
  }
}

export function doingOf(w: WorldState, e: Entity): string {
  const h = e.human!;
  const at = h.on ? ` at ${w.entities[h.on]?.label ?? h.on}` : '';
  switch (h.activity) {
    case 'idle': return 'standing around';
    case 'walk': return 'walking';
    case 'sit': return `sitting${at}`;
    case 'rest': return `resting${at}`;
    case 'gather': return `gathered${at}`;
    case 'converse': return 'talking with someone';
    case 'perform': return 'performing';
    case 'wave': return 'waving';
    default: return h.activity;
  }
}

export const toyFactory: EngineFactory = {
  rulesVersion: TOY_RULES_VERSION,
  genesis,
  create: (world) => new ToyEngine(world),
  restore: (snap) => new ToyEngine(Runtime.restore(snap as RuntimeSnapshot, REGISTRY, {}, [inBounds])),
};
