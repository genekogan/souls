// The compiler: a batch of ops → either a refusal with precise codes, or a
// committed change with its inverse (spec §5). Two phases: `plan` simulates on
// a scratch copy and never touches the model; `commit` applies a plan. The god
// skill runs `plan` locally (dry runs); the server runs both.
import { footprintOf, padFor, pointInPoly, settle, waterLevelAt, SKIRT_MAX_M as SKIRT_MAX, type Landform, type PadDoor } from '@sim/ground';
import { CREATION_LIMITS, GENERATORS, kitFootprintIssues, prepareFor, queryOf } from '@sim/generators';
import { z } from 'zod';
import { hashOf } from './hash.ts';
import { handlingProblem } from './handling.ts';
import { connectorProblem, joinProblem, supportProblem, withHalf, withoutHalf } from './joints.ts';
import { offsetPolyline, pointAlong } from '@sim/generators';
import { BakeError, WorldModel, definitionRefs, obbOverlap, type OBB } from './model.ts';
import { batchSchema, trustedBatchSchema, jointId, type Batch, type Entity, type Failure, type Field, type Op, type Result, type StoredDef, type Value, worldStateSchema, SKY_PALETTES } from './schemas.ts';
import { layersStateSchema, type LayersState, type Schedule } from './layers.ts';
import { sealedRouteFailure } from './architecture.ts';
import { overlapNotWorse } from './overlap.ts';
import { RESETTLE_TOL_M } from './pad-resettle.ts';
import { worldBudgetFailure } from './budgets.ts';
import { creationInputFailure } from './input.ts';
import { signMediaFailure } from './sign-media.ts';
import { decalFailure, kitFaceFailure } from './faces.ts'; // XP8 hook
import { canonicalAbout, canonicalWorldAbout, meaningFailure, remapAbout, sameMeaning } from './meaning.ts';
import { isWetSetting, showerUntil } from './weather-rules.ts';

export type Diff = { upserts: Entity[]; removes: string[]; defs: StoredDef[]; world?: Partial<WorldModel['state']>; constants?: WorldModel['constants']; tiles: string[]; answers: { prayer: string; text: string }[]; /** LAYERS: state.layers changed (wallets, relations, currency; never sent to viewers) */ layers?: true };
/** Body-aware edits: an entity the god may not edit as a thing (a resident's body; G1 "god rules" walks residents out
 *  of everything else instead of refusing). Checked for every entity in the subtree of a remove / move / set-params
 *  target; null = free. */
export type UsesHook = (id: string) => { code: 'body.protected'; detail: string } | null;
/** Body-aware edits, the would-be world's side (31 §3 rule 8, R2): called once after a plan succeeds, with the plan's own
 *  scratch (the world as it would be), its diff and the batch's ops; a Failure refuses the whole batch (null = fine). The
 *  engine bridge uses it to refuse edits of a resident's body itself (residents in the way are walked out, not refused).
 *  With the hook set, `uses` refusals are held back until it has run (it is called even when one was found), so its
 *  refusal wins as when it planned on a fork first; failing that, the earliest held-back one refuses the batch. */
export type RefuseHook = (scratch: WorldModel, diff: Diff, ops: Op[]) => Failure | null;
/** `sealed: false` skips the sealed-room refusal: the god server's commit repairs or reports a sealed room instead
 *  (buildsafe/1, apps/server/src/god/buildsafe.ts), never refusing the edit. */
export type PlanOptions = { trusted?: boolean; uses?: UsesHook; refuse?: RefuseHook; sealed?: false };

export type Plan = { ok: true; apply: () => { seq: number; undoId: string; diff: Diff; inverse: Op[] }; ids: Record<string, string>; warnings: string[]; diff: Diff } | { ok: false; failures: Failure[] };

const fail = (op: number, code: string, detail: string, suggest?: Failure['suggest']): Failure => ({ op, code, detail, suggest });
/** A retired slot (building/1: a facade frame of an earlier release on a wall run with no clear wall) keeps only what
 *  already hangs in it. Putting anything new there is refused as unknown, naming the slots of its kind that remain. */
function retiredSlot(w: WorldModel, parentId: string, slotId: string | undefined, i: number): Failure | null {
  const parent = slotId && parentId !== 'world' ? w.entities.get(parentId) : undefined; if (!parent) return null;
  const slots = w.slotsOf(parent), slot = slots.find((x) => x.id === slotId);
  if (!slot?.retired) return null;
  const family = slot.id.split('-')[0] + '-', live = slots.filter((x) => !x.retired && x.kind === slot.kind);
  const same = live.filter((x) => x.id.startsWith(family)).map((x) => x.id), other = live.filter((x) => !x.id.startsWith(family)).map((x) => x.id);
  const names = [same.length ? `its ${family}* slots: ${same.join(', ')}` : '', other.length ? `other ${slot.kind} slots: ${other.join(', ')}` : ''].filter(Boolean).join('; ');
  return { ...fail(i, 'slot.unknown', `${w.pathOf(parent.id)} has no slot ${slot.id}: that wall run has no clear wall, so the frame is retired and keeps only what already hangs there; ${names || 'no other slot of its kind'}`),
    field: 'in.slot', fix: same.length || other.length ? `Mount on ${[...same, ...other][0]}, or another slot named above.` : 'Mount it elsewhere, or stand it on the ground.' };
}

/** Keep a generator's validation issues machine-addressable, without exposing a raw Zod dump. */
function generatorFailure(op: number, error: unknown, def?: StoredDef, entity?: string, field = 'make'): Failure {
  if (error instanceof BakeError) { def = error.def; error = error.cause; }
  const base = { op, code: 'def.invalid', ...(def ? { def: def.ref } : {}), ...(entity ? { entity } : {}) };
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const path = issue?.path ?? [];
    const at = ['make.args', ...path].join('.');
    const args = def?.make.kind === 'gen' ? def.make.args ?? {} : {};
    let value: unknown = args, parent: unknown;
    for (const part of path) { parent = value; value = value && typeof value === 'object' ? (value as Record<PropertyKey, unknown>)[part] : undefined; }
    const kind = parent && typeof parent === 'object' && 'kind' in parent ? `${String(parent.kind)} ` : '';
    const subject = `${kind}${String(path.at(-1) ?? 'arguments')}`;
    let fix = `Correct ${at}: ${issue?.message ?? 'invalid generator arguments'}`;
    let measured: unknown = Array.isArray(value) || typeof value === 'string' ? value.length : value === undefined ? 'missing' : typeof value === 'object' ? typeof value : value;
    let limit: unknown;
    if (issue?.code === 'too_small' || issue?.code === 'too_big') {
      limit = issue.code === 'too_small' ? issue.minimum : issue.maximum;
      if (typeof value === 'number') measured = value;
      const unit = Array.isArray(value) ? ['profile', 'polygon', 'path'].includes(String(path.at(-1))) ? ' points' : ' entries' : typeof value === 'string' ? ' characters' : '';
      fix = `${subject} needs ${issue.code === 'too_small' ? '≥' : '≤'}${String(limit)}${unit}`;
    }
    return { ...base, field: at, detail: `${def?.ref ?? 'generator'}: ${at}: ${issue?.message ?? 'invalid arguments'}`, fix, measured, ...(limit !== undefined ? { limit } : {}) };
  }
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 600);
  return { ...base, field, detail: `${def?.ref ?? 'generator'}: ${message}`, measured: message,
    fix: `Correct ${field} for ${def?.make.kind === 'gen' ? def.make.gen : def?.ref ?? 'this definition'} so its physics bake succeeds: ${message}` };
}

class PlanningFailure extends Error {
  readonly failure: Failure;
  constructor(failure: Failure) { super(failure.detail); this.failure = failure; }
}

/** Deterministic nearest ids for repairing a mistyped generator name. */
function nearestGenerators(id: string): string[] {
  // Generator ids arrive from untrusted JSON; cap suggestion work for a wildly long typo.
  const needle = id.slice(0, 128);
  const distance = (other: string) => {
    let row = Array.from({ length: other.length + 1 }, (_, i) => i);
    for (let i = 0; i < needle.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < other.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(needle[i] !== other[j])));
      row = next;
    }
    return row[other.length];
  };
  return Object.keys(GENERATORS).sort((a, b) => distance(a) - distance(b) || a.localeCompare(b)).slice(0, 3);
}

/** Validate values against fields; fills defaults; returns the problem or the normalised record. */
export function checkFields(fields: Record<string, Field>, values: Record<string, Value> | undefined, fillDefaults: boolean): { ok: true; values: Record<string, Value> } | { ok: false; detail: string } {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    const f = fields[k];
    if (!f) return { ok: false, detail: `unknown field ${k}` };
    switch (f.type) {
      case 'number': case 'int':
        if (typeof v !== 'number' || (f.type === 'int' && !Number.isInteger(v))) return { ok: false, detail: `${k} must be ${f.type}` };
        if (f.min !== undefined && v < f.min) return { ok: false, detail: `${k} < ${f.min}` };
        if (f.max !== undefined && v > f.max) return { ok: false, detail: `${k} > ${f.max}` };
        break;
      case 'bool': if (typeof v !== 'boolean') return { ok: false, detail: `${k} must be boolean` }; break;
      case 'string':
        if (typeof v !== 'string' || v.length > f.max) return { ok: false, detail: `${k} must be a string ≤ ${f.max}` };
        // `lines`: a text shown on a fixed face (a neon sign's two tube rows) refuses more lines than it can show
        if (f.lines !== undefined && v.split(/\r\n|\r|\n/).length > f.lines) return { ok: false, detail: `${k} must be at most ${f.lines} lines` };
        break;
      case 'enum': if (typeof v !== 'string' || !f.values.includes(v)) return { ok: false, detail: `${k} must be one of ${f.values.join(', ')}` }; break;
      case 'color': if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/.test(v)) return { ok: false, detail: `${k} must be #rrggbb` }; break;
      case 'ref': if (typeof v !== 'string') return { ok: false, detail: `${k} must be an id` }; break;
    }
    out[k] = v;
  }
  if (fillDefaults) for (const [k, f] of Object.entries(fields)) if (out[k] === undefined && f.default !== undefined) out[k] = f.default as Value;
  return { ok: true, values: out };
}

export function plan(world: WorldModel, input: unknown, by: string, tick: number, opts: PlanOptions = {}): Plan {
  const inputFailure = creationInputFailure(input);
  if (inputFailure) return { ok: false, failures: [inputFailure] };
  const parsed = (opts.trusted ? trustedBatchSchema : batchSchema).safeParse(input);
  if (!parsed.success) return { ok: false, failures: [fail(-1, 'schema', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))] };
  const batch: Batch = parsed.data as Batch;
  const ops = parsed.data.ops as unknown as Op[];
  // Scratch copy: structural maps are cloned; the terrain is shared but every landform change is recorded and
  // undone if the plan fails, so a failed dry run leaves the model untouched.
  const scratch = world.fork();
  const failures: Failure[] = [], warnings: string[] = [], ids: Record<string, string> = {};
  const diff: Diff = { upserts: [], removes: [], defs: [], tiles: [], answers: [] };
  const inverse: Op[] = [];
  const touched = new Set<string>(), geometryTouched = new Set<string>();
  const touchedAt = new Map<string, number>(), tileAt = new Map<string, number>(), removedAt = new Map<string, number>();
  let activeOp = 0;
  let layersTouched = false;
  /** PC12 (#691): parts whose joints this batch made, released or removed, and the op that did it (the support check). */
  const jointsTouched = new Map<string, number>();
  const setJoins = (e: Entity) => { scratch.replaceJoins(e); upsert(e, false); jointsTouched.set(e.id, activeOp); };
  const upsert = (e: Entity, geometry = true) => {
    if (geometry) geometryTouched.add(e.id);
    touched.add(e.id); touchedAt.set(e.id, activeOp);
    if (touched.size > CREATION_LIMITS.batchEntityChanges) throw new PlanningFailure({ ...fail(activeOp, 'budget.world', 'batch expansion exceeds the entity-change budget'), field: 'batch.entities', measured: touched.size, limit: CREATION_LIMITS.batchEntityChanges, fix: 'Split the construction into smaller batches.' });
  };
  const resolveId = (ref: string, opIndex: number): string | null => {
    if (ref === 'world') return 'world';
    if (ref.startsWith('$')) { const id = ids[ref]; if (!id) failures.push(fail(opIndex, 'entity.unknown', `${ref} is not placed in this batch`)); return id ?? null; }
    const e = scratch.get(ref);
    if (!e) { failures.push(fail(opIndex, 'entity.unknown', `${ref}`)); return null; }
    return e.id;
  };
  /** With a `refuse` hook, uses refusals are held back while the batch is simulated to the end, so the hook sees the
   *  would-be world first (its refusal wins); then the earliest held-back one is the batch's refusal. */
  const heldBack: Failure[] = [];
  // Content hashes already summarize stored defs. Resolve each distinct instance ref only once
  // per binding set; never serialize a large resolved kit for every entity in a define batch.
  let effectiveDefs = new Map<string, string>();
  const instanceDefs = () => {
    for (const e of scratch.entities.values()) scratch.effectiveDefIdentity(e.def, effectiveDefs);
    return effectiveDefs;
  };
  /** A Soul uses something in this subtree: refuse naming them. */
  const inUse = (id: string, i: number): boolean => {
    if (!opts.uses) return false;
    for (const sid of scratch.subtree(id)) {
      const u = opts.uses(sid);
      if (!u) continue;
      const f = fail(i, u.code, `${sid !== id ? `${scratch.pathOf(id)}: ` : ''}${u.detail}`);
      f.entity = sid; f.field = 'entity'; f.fix = 'Residents move their own bodies; edit the things around them instead.';
      if (opts.refuse) { heldBack.push(f); return false; }
      failures.push(f); return true;
    }
    return false;
  };

  /** A ref change is a physical edit of every instance whose effective def changed, plus its children (slots may
   * move/disappear). Remove all old indices first, then admit parent-first against the new geometry as one plan. */
  const rebindInstances = (before: Map<string, string>, i: number, restores: NonNullable<Extract<Op, { op: 'restore-def' }>['instances']> = []) => {
    const back: typeof restores = [], restore = new Map(restores.map(r => [r.entity.id, r]));
    const affected = new Set<string>();
    for (const e of scratch.entities.values()) if (restore.has(e.id) || before.get(e.def) !== scratch.effectiveDefIdentity(e.def, effectiveDefs)) {
      for (const id of scratch.subtree(e.id)) affected.add(id);
    }
    const instances = [...affected].map(id => scratch.entities.get(id)!).sort((a, b) => scratch.ancestors(a.id).size - scratch.ancestors(b.id).size);
    for (const e of instances) if (inUse(e.id, i)) return back;
    for (const e of instances) { scratch.unindex(e.id); clearGround(scratch, e, diff); }
    for (const e of instances) {
      const def = scratch.resolvedDef(e.def);
      const repair = (f: Failure): Failure => ({ ...f, entity: e.id, def: def?.ref ?? e.def,
        detail: `${scratch.pathOf(e.id)}: ${f.detail}`, field: f.field ?? 'def',
        fix: f.fix ?? `Adjust the definition or move ${scratch.pathOf(e.id)} so it fits, then retry the definition change.` });
      if (!def) throw new PlanningFailure(repair(fail(i, 'def.unknown', e.def)));
      const next: Entity = { ...e, v: e.v + 1 };
      const previous = restore.get(e.id);
      for (const field of previous?.fields ?? []) {
        if (previous!.entity[field] === undefined) delete next[field];
        else (next as Record<string, unknown>)[field] = previous!.entity[field];
      }
      const params = checkFields(def.params, next.params, false);
      if (!params.ok) throw new PlanningFailure(repair({ ...fail(i, 'params.invalid', params.detail), field: 'params' }));
      if (def.form !== 'point' && !next.shape) throw new PlanningFailure(repair({ ...fail(i, 'params.invalid', `${def.form} form needs a shape`), field: 'shape' }));
      try {
        prepareEntity(scratch, def, next, next.params);
        const problem = admit(scratch, next, def, i, 'strict', false, world);
        if (problem) throw new PlanningFailure(repair(problem));
        const fields = (['p', 'r', 'shape', 'params'] as const).filter(field => hashOf(e[field] ?? null) !== hashOf(next[field] ?? null));
        if (fields.length) back.push({ entity: e, fields });
        scratch.delete(e.id); scratch.insert(next); indexAndGround(scratch, next, def, diff); upsert(next);
      } catch (error) {
        throw error instanceof PlanningFailure ? error : new PlanningFailure(repair(generatorFailure(i, error, def, e.id)));
      }
    }
    return back;
  };

  // sky palettes are a closed list (replayed inverses may restore an older free-form one)
  if (!opts.trusted) ops.forEach((op, i) => {
    const pal = op.op === 'world' ? op.state.sky?.palette : undefined;
    if (pal !== undefined && !(SKY_PALETTES as readonly string[]).includes(pal)) failures.push(fail(i, 'state.invalid', `sky palette ${pal} is not one of ${SKY_PALETTES.join(', ')}`));
  });
  ops.forEach((op, i) => {
    if (failures.length) return;
    activeOp = i;
    const before = 'id' in op ? scratch.get(op.id) : undefined;
    let entity = before?.id ?? (op.op === 'restore' ? op.entity.id : undefined);
    let contextDef: StoredDef | undefined;
    const tileCount = diff.tiles.length, removeCount = diff.removes.length;
    try {
    contextDef = scratch.resolvedDef(op.op === 'place' ? op.def : before?.def ?? (op.op === 'restore' ? op.entity.def : ''));
    switch (op.op) {
      // W1: the server also excludes refs used in placement history. Keep dependency safety here.
      case 'undefine': {
        const d = scratch.def(op.ref);
        if (!d || !scratch.owns(d.ref) || d.by === 'core' || scratch.library?.get(d.ref)) {
          failures.push(fail(i, 'constant.immutable', 'Only a world-local unused definition can be retired')); return;
        }
        if ([...scratch.entities.values()].some(e => scratch.def(e.def)?.ref === d.ref) ||
            scratch.allDefs().some(other => other.ref !== d.ref && definitionRefs(other).some(ref => scratch.def(ref)?.ref === d.ref))) {
          failures.push(fail(i, 'def.in-use', `${d.ref} is referenced by an entity or another definition`)); return;
        }
        for (const [ref, value] of scratch.defs) if (!ref.startsWith('sha:') && value.ref === d.ref) scratch.defs.delete(ref);
        inverse.unshift({ op: 'revive-def', ref: d.ref, hash: d.hash });
        return;
      }
      case 'revive-def': {
        const d = scratch.def('sha:' + op.hash);
        if (!d || d.ref !== op.ref || scratch.def(op.ref)) { failures.push(fail(i, 'undo.conflict', 'Retired definition is unavailable or its name has been reused')); return; }
        scratch.defs.set(d.ref, d); diff.defs.push(d);
        inverse.unshift({ op: 'undefine', ref: d.ref }); return;
      }
      case 'define': {
        const ref = `${op.def.name}@${op.def.version}`, previous = scratch.def(ref), owned = scratch.owns(ref);
        const refuse = checkDef(scratch, op.def as never, i);
        if (refuse) { failures.push(refuse); return; }
        // Discover affected instances before rebinding, including inheritance and expanded prefab/contents children.
        const before = previous ? instanceDefs() : undefined;
        const stored = scratch.defineDef(op.def as never, by, tick);
        effectiveDefs = new Map();
        if (previous?.hash === stored.hash) {
          // Preserve first adoption of an identical shared library record; an already owned identical def is a no-op.
          if (!owned) diff.defs.push(stored);
          return;
        }
        // Ownership comes from the library (or a legacy core record), not the spelling of a local name.
        // Trusted import/undo may retain historical revisions; ordinary define cannot replace library content.
        if (previous && (scratch.library?.get(ref) || previous.by === 'core') && !opts.trusted) {
          failures.push({ ...fail(i, 'constant.immutable', `${ref} is a library definition and cannot be redefined`), def: ref, field: 'def.name', fix: 'Choose a world-local name for your definition.' }); return;
        }
        diff.defs.push(stored);
        if (previous) {
          const instances = rebindInstances(before!, i);
          inverse.unshift({ op: 'restore-def', ref, hash: previous.hash, ...(instances.length ? { instances } : {}) });
        }
        return;
      }
      case 'restore-def': {
        const previous = scratch.def(op.ref);
        const before = instanceDefs();
        const stored = scratch.restoreDef(op.ref, op.hash);
        effectiveDefs = new Map();
        if (!stored || !previous) { failures.push({ ...fail(i, 'undo.conflict', `stored definition ${op.ref} at ${op.hash} is unavailable`), field: 'def', fix: 'Restore the missing stored definition before retrying undo.' }); return; }
        if (previous.hash === stored.hash && !op.instances?.length) return;
        diff.defs.push(stored);
        const instances = rebindInstances(before, i, op.instances);
        inverse.unshift({ op: 'restore-def', ref: op.ref, hash: previous.hash, ...(instances.length ? { instances } : {}) });
        return;
      }
      case 'place': {
        const placedRef = scratch.library?.placementRef?.(op.def);
        const def = placedRef === null ? undefined : scratch.resolvedDef(placedRef ?? op.def);
        if (!def) { failures.push(fail(i, 'def.unknown', op.def)); return; }
        const parentId = resolveId(op.in.parent, i); if (!parentId) return;
        if (op.name && scratch.names.has(`${parentId}/${op.name}`)) { failures.push(fail(i, 'name.taken', op.name)); return; }
        { const retired = opts.trusted ? null : retiredSlot(scratch, parentId, op.in.slot, i); if (retired) { failures.push(retired); return; } }
        const fieldsOk = checkFields(def.params, op.params, true);
        if (!fieldsOk.ok) { failures.push(fail(i, 'params.invalid', fieldsOk.detail)); return; }
        const stateOk = checkFields(def.state, op.state, true);
        if (!stateOk.ok) { failures.push(fail(i, 'state.invalid', stateOk.detail)); return; }
        if (def.form !== 'point' && !op.shape) { failures.push(fail(i, 'params.invalid', `${def.form} form needs a shape`)); return; }
        if (scratch.entities.size >= Math.min(CREATION_LIMITS.worldEntities, scratch.constants.limits.entities)) { failures.push({ ...fail(i, 'budget.world', 'entity count exceeds the world limit'), field: 'entities', measured: scratch.entities.size + 1, limit: Math.min(CREATION_LIMITS.worldEntities, scratch.constants.limits.entities), fix: 'Remove entities or reuse existing construction.' }); return; }
        const id = scratch.nextId();
        const e: Entity = { id, def: def.ref, in: { parent: parentId, ...(op.in.slot ? { slot: op.in.slot } : {}) }, by, born: tick, v: 1, ...(op.name ? { name: op.name } : {}), ...(op.p ? { p: op.p } : {}), ...(op.r !== undefined ? { r: op.r } : {}), ...(op.s !== undefined ? { s: op.s } : {}), ...(op.shape ? { shape: op.shape } : {}), ...(op.anchor ? { anchor: op.anchor } : {}), ...(Object.keys(fieldsOk.values).length ? { params: fieldsOk.values } : {}), ...(Object.keys(stateOk.values).length ? { state: stateOk.values } : {}), ...(op.seed !== undefined ? { seed: op.seed } : {}), ...(op.constraints?.length ? { constraints: op.constraints } : {}) };
        if (op.about) e.about = canonicalAbout(scratch, op.about, ids);
        contextDef = def; entity = id;
        if (scratch.library?.placementRef || op.def.startsWith('sha:')) e.def = 'sha:' + def.hash;
        { const bad = followProblem(def, op.schedule); if (bad) { failures.push(fail(i, 'state.invalid', bad)); return; } }
        { const L = def.layers ?? {};   // VOCAB-W3: the def's LAYERS defaults, unless the op says otherwise
          const owner = op.owner ?? L.owner, access = op.access ?? L.access, schedule = op.schedule ?? L.schedule, price = op.price ?? L.price;
          if (owner !== undefined) e.owner = owner;
          if (access !== undefined) e.access = access;
          if (schedule !== undefined) e.schedule = schedule;
          if (price !== undefined) e.price = price; }
        prepareEntity(scratch, def, e, op.params);
        const problem = admit(scratch, e, def, i, op.mode, true, world);
        if (problem) { failures.push(problem); return; }
        scratch.insert(e); indexAndGround(scratch, e, def, diff);
        if (op.tmp) ids[op.tmp] = id;
        ids[id] = id;
        upsert(e);
        inverse.unshift({ op: 'remove', id, cascade: true });
        if (def.make.kind === 'parts') expandParts(scratch, e, def, by, tick, diff, inverse, upsert);
        else if (def.contents?.length) expandParts(scratch, e, { ...def, make: { kind: 'parts', parts: def.contents } } as StoredDef, by, tick, diff, inverse, upsert);
        return;
      }
      case 'remove': {
        const id = resolveId(op.id, i); if (!id || id === 'world') return;
        const sub = scratch.subtree(id);
        if (!op.cascade && sub.length > 1) { failures.push(fail(i, 'params.invalid', `${op.id} has ${sub.length - 1} children; set cascade`)); return; }
        if (inUse(id, i)) return;
        for (const sid of sub) {
          const e = scratch.entities.get(sid)!;
          // A body inside the removed thing is refused for every caller; the body itself only for an untrusted one (an
          // engine retire removes its own body, its carried things moved out first).
          if (isBody(scratch, e) && (sid !== id || !opts.trusted)) { failures.push(fail(i, 'body.protected', sid !== id ? `${scratch.pathOf(sid)} is a resident's body inside ${op.id}; bodies move themselves` : `${scratch.pathOf(sid)} is a resident's body; bodies move themselves`)); return; }
        }
        // children first for the forward diff; parents first for the inverse (restore in dependency order)
        const before = sub.map((sid) => scratch.entities.get(sid)!);
        // PC12: a removed part takes its joints with it; each part it was joined to loses that half (and must still be
        // held up: the support check at the end). Undo restores the part verbatim, which puts the halves back.
        for (const e of before) for (const j of Object.values(e.joins ?? {})) {
          const o = scratch.entities.get(j.to); if (!o || sub.includes(o.id) || o.joins?.[j.at]?.to !== e.id) continue;
          setJoins(withoutHalf(o, j.at));
        }
        for (const sid of [...sub].reverse()) {
          const e = scratch.entities.get(sid)!;
          scratch.delete(sid); clearGround(scratch, e, diff);
          diff.removes.push(sid); touched.delete(sid);
        }
        // PC12: a part's joints are restored as they stood when it was removed (an earlier op may have released some)
        const asRemoved = (e: Entity): Entity => { const o = world.entities.get(e.id) ?? e; if (o === e || JSON.stringify(o.joins ?? null) === JSON.stringify(e.joins ?? null)) return o; const x = { ...o }; if (e.joins) x.joins = e.joins; else delete x.joins; return x; };
        for (const e of [...before].reverse()) inverse.unshift({ op: 'restore', entity: asRemoved(e) });
        return;
      }
      case 'move': {
        const id = resolveId(op.id, i); if (!id || id === 'world') return;
        if (inUse(id, i)) return;
        const prev = scratch.entities.get(id)!;
        const def = scratch.resolvedDef(prev.def)!;
        // PC12: a joined part never moves under its joints (they would no longer meet); disconnect it first
        { const f = joinedProblem(scratch, id, i); if (f) { failures.push(f); return; } }
        const next: Entity = { ...prev, v: prev.v + 1 };
        if (op.in) { const pid = resolveId(op.in.parent, i); if (!pid) return; if (scratch.subtree(id).includes(pid)) { failures.push(fail(i, 'parent.unknown', 'cannot move a thing into itself')); return; } next.in = { parent: pid, ...(op.in.slot ? { slot: op.in.slot } : {}) }; }
        if (op.p) next.p = op.p; if (op.r !== undefined) next.r = op.r; if (op.s !== undefined) next.s = op.s; if (op.shape) next.shape = op.shape;
        if (op.constraints) next.constraints = op.constraints;
        // a thing already in a retired slot moves within it freely; moving something new into one is refused (undo/redo, trusted, may)
        if (!opts.trusted && (next.in.parent !== prev.in.parent || next.in.slot !== prev.in.slot)) { const retired = retiredSlot(scratch, next.in.parent, next.in.slot, i); if (retired) { failures.push(retired); return; } }
        // PADFIX: a move in place (no new pose, parent or shape) re-settles a thing on its own pose: it keeps (or gets) a
        // foundation pad at its own level wherever it had one or the ground under it is not at that level, even when that
        // ground lies within the skirt (a neighbour's bank there would otherwise leave it sunk or hanging).
        const inPlace = !op.in && !op.p && op.r === undefined && op.s === undefined && !op.shape;
        if (inPlace) (next as Entity & { _resettle?: 'pad' | 'check' })._resettle = scratch.ground().landforms.some((l) => l.id === `${id}:pad`) ? 'pad' : 'check';
        scratch.delete(id); clearGround(scratch, prev, diff);
        if (op.shape) prepareEntity(scratch, def, next, undefined);
        const problem = admit(scratch, next, def, i, op.mode, false, world);
        delete (next as Entity & { _resettle?: 'pad' | 'check' })._resettle;
        if (problem) { failures.push(problem); return; }
        scratch.insert(next); indexAndGround(scratch, next, def, diff);
        reindexDescendants(scratch, id);
        upsert(next);
        inverse.unshift({ op: 'move', id, in: prev.in, p: prev.p ?? [0, 0], r: prev.r ?? 0, s: prev.s ?? 1, ...(prev.shape ? { shape: prev.shape } : {}), mode: 'strict' });
        return;
      }
      case 'set': {
        const id = resolveId(op.id, i); if (!id || id === 'world') return;
        const prev = scratch.entities.get(id)!;
        const def = scratch.resolvedDef(prev.def)!;
        const next: Entity = { ...prev, v: prev.v + 1 };
        const inv: Extract<Op, { op: 'set' }> = { op: 'set', id };
        if (op.about !== undefined) {
          inv.about = prev.about ?? null;
          if (op.about === null) delete next.about; else next.about = canonicalAbout(scratch, op.about, ids);
          // Pure meaning edits preserve the terrain, footprint, slot and safety indices.
          if (Object.keys(op).every(k => k === 'op' || k === 'id' || k === 'about')) {
            if (sameMeaning(next.about, prev.about)) return;
            scratch.replaceAbout(next); upsert(next, false); inverse.unshift(inv); return;
          }
        }
        if (op.params && inUse(id, i)) return;
        if (op.params) { const f = joinedProblem(scratch, id, i); if (f) { failures.push(f); return; } }
        if (op.state) {
          const ok = checkFields(def.state, op.state, false); if (!ok.ok) { failures.push(fail(i, 'state.invalid', ok.detail)); return; }
          inv.state = Object.fromEntries(Object.keys(op.state).map((k) => [k, prev.state?.[k] ?? (def.state[k]?.default as Value) ?? null]));
          next.state = { ...prev.state, ...ok.values };
        }
        if (op.params) {
          const ok = checkFields(def.params, op.params, false); if (!ok.ok) { failures.push(fail(i, 'params.invalid', ok.detail)); return; }
          inv.params = Object.fromEntries(Object.keys(op.params).map((k) => [k, prev.params?.[k] ?? (def.params[k]?.default as Value) ?? null]));
          next.params = { ...prev.params, ...ok.values };
        }
        if (op.constraints !== undefined) { inv.constraints = prev.constraints ?? []; next.constraints = op.constraints; }
        // LAYERS: owner, access, schedule, price (null clears; the inverse puts back what was there, or clears)
        if (op.schedule) { const bad = followProblem(def, op.schedule); if (bad) { failures.push(fail(i, 'state.invalid', bad)); return; } }
        for (const k of ['owner', 'access', 'schedule', 'price'] as const) {
          const v = op[k]; if (v === undefined) continue;
          (inv as Record<string, unknown>)[k] = prev[k] ?? null;
          if (v === null) delete next[k]; else (next as Record<string, unknown>)[k] = v;
        }
        if (op.name !== undefined) {
          if (scratch.names.has(`${prev.in.parent}/${op.name}`)) { failures.push(fail(i, 'name.taken', op.name)); return; }
          inv.name = prev.name; next.name = op.name;
        }
        // B12: furniture keeps its place in its room when the building is resized, so a resize that pushes a piece through
        // a wall is refused (pieces already poking before the edit, in an older world, are left alone)
        const pokedBefore = op.params && !opts.trusted && scratch.children.get(id)?.size ? pokingPieces(scratch, id, scratch.slotsOf(prev)) : null;
        scratch.delete(id); clearGround(scratch, prev, diff);
        if (op.params) prepareEntity(scratch, def, next, op.params);
        if (op.params || op.constraints) { const problem = admit(scratch, next, def, i, 'strict', false, world); if (problem) { failures.push(problem); return; } }
        scratch.insert(next);
        if (pokedBefore) { const problem = furnitureFit(scratch, prev, next, def, pokedBefore, i); if (problem) { failures.push(problem); return; } }
        indexAndGround(scratch, next, def, diff);
        upsert(next);
        // children in slots the new params no longer have (a room that went away) move to the ground floor
        const orphans: Op[] = [];
        if (op.params) {
          const oldSlots = scratch.bake(def, prev.params ?? {}, prev.seed ?? 0, prev.shape).slots, newSlots = scratch.slotsOf(next);
          for (const cid of [...(scratch.children.get(id) ?? [])]) {
            const c = scratch.entities.get(cid); if (!c?.in.slot || newSlots.some((x) => x.id === c.in.slot)) continue;
            const from = oldSlots.find((x) => x.id === c.in.slot), ground = newSlots.some((x) => x.id === 'ground');
            const lp = c.p ?? [0, 0], lx = lp[0], lz = lp[lp.length - 1];
            const moved: Entity = { ...c, v: c.v + 1, in: ground ? { parent: id, slot: 'ground' } : { parent: id }, p: [(from?.p[0] ?? 0) + lx, 0, (from?.p[2] ?? 0) + lz] };
            scratch.delete(cid); scratch.insert(moved); indexAndGround(scratch, moved, scratch.resolvedDef(moved.def)!, diff); upsert(moved);
            orphans.push({ op: 'move', id: cid, in: c.in, p: c.p ?? [0, 0], r: c.r ?? 0, s: c.s ?? 1, mode: 'strict' } as Op);
            warnings.push(`${scratch.pathOf(cid)}: ${c.in.slot} is gone; moved to the ground floor`);
          }
        }
        for (const o of orphans) inverse.unshift(o);
        inverse.unshift(inv);
        return;
      }
      case 'clone': {
        const srcId = resolveId(op.id, i); if (!srcId || srcId === 'world') return;
        const src = scratch.entities.get(srcId)!;
        const parentId = op.in ? resolveId(op.in.parent, i) : src.in.parent; if (!parentId) return;
        const base = op.p ?? (src.p ? [src.p[0], src.p[src.p.length - 1]] as [number, number] : [0, 0] as [number, number]);
        const step = op.step ?? (op.count > 1 ? [Math.max(2, scratch.bake(scratch.resolvedDef(src.def)!, src.params ?? {}, src.seed ?? 0, src.shape).box[0] * 1.5), 0] as [number, number] : [0, 0] as [number, number]);
        const subtree = scratch.subtree(srcId).map((id) => scratch.entities.get(id)!);
        for (let k = 0; k < op.count; k++) {
          const map = new Map<string, string>();
          for (const orig of subtree) map.set(orig.id, scratch.nextId());
          let rootName = op.name ? (op.count > 1 ? `${op.name}-${k + 1}` : op.name) : src.name ? uniqueName(scratch, parentId, src.name) : undefined;
          if (rootName && scratch.names.has(`${parentId}/${rootName}`)) rootName = uniqueName(scratch, parentId, rootName);
          for (const orig of subtree) {
            const isRoot = orig.id === srcId;
            const copy: Entity = { ...structuredClone(orig), id: map.get(orig.id)!, by, born: tick, v: 1, in: isRoot ? { parent: parentId, ...(op.in?.slot ? { slot: op.in.slot } : {}) } : { ...orig.in, parent: map.get(orig.in.parent) ?? orig.in.parent } };
            if (copy.about) copy.about = remapAbout(canonicalAbout(scratch, copy.about, ids), map);
            delete copy.joins;   // PC12: a copy is a loose part; joints are made with `connect`
            if (isRoot) {
              if (rootName) copy.name = rootName; else delete copy.name;
              const x = base[0] + step[0] * (op.p || op.count > 1 ? k : k + 1), z = base[base.length - 1] + step[1] * (op.p || op.count > 1 ? k : k + 1);
              copy.p = base.length === 3 && op.p ? [x, base[1], z] : [x, z];
              if (op.r !== undefined) copy.r = op.r;
              if (copy.shape) copy.shape = shiftShape(copy.shape, x - (src.p?.[0] ?? 0), z - (src.p?.[src.p.length - 1] ?? 0));
              if (copy.seed !== undefined) copy.seed = (copy.seed + k + 1) | 0;
              const cdef = scratch.resolvedDef(copy.def)!;
              { const retired = opts.trusted ? null : retiredSlot(scratch, parentId, copy.in.slot, i); if (retired) { failures.push(retired); return; } }
              if (copy.shape) prepareEntity(scratch, cdef, copy, undefined);
              const problem = admit(scratch, copy, cdef, i, op.mode, true, world);
              if (problem) { failures.push(problem); return; }
            }
            scratch.insert(copy); indexAndGround(scratch, copy, scratch.resolvedDef(copy.def)!, diff); upsert(copy);
          }
          const rootCopy = map.get(srcId)!;
          if (op.tmp) ids[op.count > 1 ? `${op.tmp}${k + 1}` : op.tmp] = rootCopy;
          ids[rootCopy] = rootCopy;
          inverse.unshift({ op: 'remove', id: rootCopy, cascade: true });
        }
        return;
      }
      case 'world': {
        // a patch: each key merges into what is there (sky, time, weather, ground field by field); keys it does not name keep their values
        const cur = scratch.state as Record<string, unknown>, next: Record<string, unknown> = { ...cur };
        for (const [k, v] of Object.entries(op.state)) if (v !== undefined) {
          if (k === 'about') { if (v === null) delete next.about; else next.about = canonicalWorldAbout(scratch, v as NonNullable<typeof scratch.state.about>, ids); }
          else next[k] = v !== null && typeof v === 'object' ? { ...(cur[k] as object | undefined), ...v } : v;
        }
        const merged = worldStateSchema.parse(next);
        if (Object.keys(op.state).length === 1 && op.state.about !== undefined && sameMeaning(merged.about, scratch.state.about)) return;
        // WEATHER-RULES: a set rain/storm gets its end tick now (a strike alone leaves the shower as it is)
        const wp = op.state.weather as Record<string, unknown> | undefined;
        // (re-sending the same weather while its shower runs keeps the end: a carried-along weather never stretches a storm)
        const cw = (cur.weather ?? {}) as Record<string, unknown>, running = typeof cw.until === 'number' && tick < cw.until;
        const fields = ['kind', 'intensity', 'rain', 'minutes'].filter((f) => wp?.[f] !== undefined);
        if (wp && fields.length && !(running && fields.every((f) => wp[f] === cw[f]))) {
          const mw = merged.weather as typeof merged.weather & { until?: number | null };
          mw.until = isWetSetting(mw) ? showerUntil(mw, tick, Number(merged.time.dayTicks)) : null;
        }
        const prevPatch: Record<string, unknown> = {}, changed: Record<string, unknown> = {};
        for (const k of Object.keys(op.state)) {
          if (k === 'about') { prevPatch[k] = cur[k] ?? null; changed[k] = merged.about ?? null; continue; }
          prevPatch[k] = cur[k]; changed[k] = (merged as Record<string, unknown>)[k];
          // a field the patch sets that was absent before (an optional, nullable one: time.set, weather.strike) undoes to null
          const pv = (op.state as Record<string, unknown>)[k], was = cur[k];
          if (pv && typeof pv === 'object' && was && typeof was === 'object') { const back = { ...(was as object) } as Record<string, unknown>; let added = false; for (const f of Object.keys(pv)) if (!(f in back)) { back[f] = null; added = true; } if (added) prevPatch[k] = back; }
        }
        scratch.state = merged; diff.world = { ...(diff.world ?? {}), ...changed };
        inverse.unshift({ op: 'world', state: prevPatch as never });
        return;
      }
      case 'expand': {
        // GOD-ENV: the world's bounds are the ground recipe's extent [x0, z0, x1, z1] (a rectangle); `extent` grows the
        // centred square (the original op), `bounds` any side. Forward: grow only. The inverse (trusted) shrinks back,
        // refused when anything now stands in the land it would take away.
        const old = boundsOf(scratch), oldExtent = scratch.constants.extent;
        if (op.extent === undefined && !op.bounds) { failures.push(fail(i, 'schema', 'expand needs extent (a centred square, m) or bounds [x0, z0, x1, z1]')); return; }
        let nb: [number, number, number, number] = op.bounds ? [...op.bounds] : [...old];
        if (op.extent !== undefined && !op.bounds) { const h = op.extent / 2; nb = [Math.min(old[0], -h), Math.min(old[1], -h), Math.max(old[2], h), Math.max(old[3], h)]; }
        if (!(nb[2] > nb[0] && nb[3] > nb[1]) || nb[2] - nb[0] > 16000 || nb[3] - nb[1] > 16000) { failures.push(fail(i, 'size.range', `bounds [${nb.join(', ')}]: each side 0 < … ≤ 16000 m`)); return; }
        const shrinks = nb[0] > old[0] + 1e-9 || nb[1] > old[1] + 1e-9 || nb[2] < old[2] - 1e-9 || nb[3] < old[3] - 1e-9;
        if (shrinks && !opts.trusted) { failures.push(fail(i, 'constant.immutable', 'the world only grows (undo an extension to take it back)')); return; }
        if (op.extent !== undefined && op.extent < oldExtent && !opts.trusted) { failures.push(fail(i, 'constant.immutable', 'extent only grows')); return; }
        if (shrinks) {
          const out = [...scratch.entities.values()].find((e) => { if (e.in.parent !== 'world') return false; const b = rootBox(scratch, e); return b[0] < nb[0] - 1e-6 || b[1] < nb[1] - 1e-6 || b[2] > nb[2] + 1e-6 || b[3] > nb[3] + 1e-6; });
          if (out) { failures.push(fail(i, 'undo.conflict', `${scratch.pathOf(out.id)} stands on the land this would take away`)); return; }
        }
        const extent = op.extent ?? oldExtent;   // the centred square's side; directional growth lives in the bounds
        scratch.constants = { ...scratch.constants, extent };
        scratch.terrain.update({ ...scratch.ground(), extent: nb }, []);
        diff.constants = scratch.constants;
        inverse.unshift({ op: 'expand', bounds: old, extent: oldExtent });
        return;
      }
      case 'answer': { diff.answers.push({ prayer: op.prayer, text: op.text }); return; }
      // LAYERS: currency, wallets and relationships live in state.layers (made on first use; viewers never get wallets)
      case 'economy': {
        const L = layersOf(scratch), prev = L.currency ?? null;
        const next = { ...L }; if (op.currency === null) delete next.currency; else next.currency = op.currency;
        scratch.state = { ...scratch.state, layers: next }; layersTouched = true;
        inverse.unshift({ op: 'economy', currency: prev });
        return;
      }
      case 'mint': case 'pay': {
        const L = layersOf(scratch), w = { ...L.wallets };
        const from = op.op === 'pay' ? op.from : null, to = op.to, amount = op.amount;
        if (from !== null && from === to) { failures.push(fail(i, 'schema', 'pay: from and to are the same wallet')); return; }
        const after = (ref: string, d: number) => Math.round(((w[ref] ?? 0) + d) * 100) / 100;
        if (from !== null) { const left = after(from, -amount); if (left < 0) { failures.push(fail(i, 'wallet.insufficient', `${from} has ${w[from] ?? 0}${L.currency ? ' ' + L.currency : ''}; ${amount} is more`)); return; } w[from] = left; }
        const got = after(to, amount); if (got < 0) { failures.push(fail(i, 'wallet.insufficient', `${to} has ${w[to] ?? 0}${L.currency ? ' ' + L.currency : ''}; cannot take ${-amount}`)); return; }
        w[to] = got;
        for (const k of Object.keys(w)) if (w[k] === 0) delete w[k];
        scratch.state = { ...scratch.state, layers: { ...L, wallets: w } }; layersTouched = true;
        inverse.unshift(op.op === 'pay' ? { op: 'pay', from: to, to: from!, amount, ...(op.for ? { for: `undo: ${op.for}`.slice(0, 120) } : {}) } : { op: 'mint', to, amount: -amount });
        return;
      }
      case 'relate': {
        const end = (r: string): string | null => {
          if (!r.startsWith('thing:')) return r;
          const e = scratch.get(r.slice(6)); if (!e) { failures.push(fail(i, 'relation.invalid', `${r}: no such thing`)); return null; }
          return `thing:${e.id}`;
        };
        const a = end(op.a), b = end(op.b); if (!a || !b) return;
        if (a === b) { failures.push(fail(i, 'relation.invalid', 'a relation needs two different ends')); return; }
        const L = layersOf(scratch), has = L.relations.some((x) => x.a === a && x.rel === op.rel && x.b === b);
        if (has === op.on) return;   // already so: nothing to do, nothing to undo
        const relations = op.on ? [...L.relations, { a, rel: op.rel, b }] : L.relations.filter((x) => !(x.a === a && x.rel === op.rel && x.b === b));
        scratch.state = { ...scratch.state, layers: { ...L, relations } }; layersTouched = true;
        inverse.unshift({ op: 'relate', a, rel: op.rel, b, on: !op.on });
        return;
      }
      case 'restore': {
        if (!opts.trusted) { failures.push(fail(i, 'schema', 'restore is internal')); return; }
        const e = op.entity; const def = scratch.resolvedDef(e.def);
        if (!def) { failures.push(fail(i, 'def.unknown', e.def)); return; }
        if (e.in.parent !== 'world' && !scratch.entities.has(e.in.parent)) { failures.push(fail(i, 'parent.unknown', e.in.parent)); return; }
        const problem = admit(scratch, e, def, i, 'strict', false, world);
        if (problem) { failures.push({ ...problem, code: 'undo.conflict' }); return; }
        scratch.insert(e); indexAndGround(scratch, e, def, diff); upsert(e);
        // PC12: a restored part's joints come back with it: each part it was joined to gets its half again (a part
        // restored later in the batch brings its own); a connector taken meanwhile is a conflict
        for (const [c, j] of Object.entries(e.joins ?? {})) {
          jointsTouched.set(e.id, i);
          const o = scratch.entities.get(j.to); if (!o) continue;
          const h = o.joins?.[j.at];
          if (h?.to === e.id && h.at === c) continue;
          if (h) { failures.push(fail(i, 'undo.conflict', `${scratch.pathOf(o.id)} ${j.at} is now joined to ${scratch.pathOf(h.to)} ${h.at}`)); return; }
          setJoins(withHalf(o, j.at, e.id, c));
        }
        inverse.unshift({ op: 'remove', id: e.id, cascade: true });
        return;
      }
      case 'connect': case 'disconnect': {
        const aid = resolveId(op.a.id, i); if (!aid || aid === 'world') { if (aid === 'world') failures.push(fail(i, 'entity.unknown', 'world')); return; }
        const a = scratch.entities.get(aid)!;
        if (op.op === 'disconnect') {
          const j = a.joins?.[op.a.connector];
          if (!j) {
            const known = scratch.resolvedDef(a.def)?.components.connectors?.some((c) => c.id === op.a.connector);
            failures.push({ ...fail(i, known ? 'connector.free' : 'connector.unknown', `${scratch.pathOf(aid)} ${known ? `${op.a.connector} is not joined` : `has no connector ${op.a.connector}`}`), entity: aid, field: 'connector' }); return;
          }
          const o = scratch.entities.get(j.to);
          if (o?.joins?.[j.at]?.to !== aid) { failures.push(fail(i, 'undo.conflict', `${scratch.pathOf(aid)} ${op.a.connector} names ${j.to} ${j.at}, which does not join it back`)); return; }
          setJoins(withoutHalf(a, op.a.connector));
          setJoins(withoutHalf(scratch.entities.get(o.id)!, j.at));
          inverse.unshift({ op: 'connect', a: { id: aid, connector: op.a.connector }, b: { id: o.id, connector: j.at } });
          return;
        }
        const bid = resolveId(op.b.id, i); if (!bid || bid === 'world') { if (bid === 'world') failures.push(fail(i, 'entity.unknown', 'world')); return; }
        const b = scratch.entities.get(bid)!;
        // a part a Soul is using (carrying it, standing or sitting on it) is not joined under them
        if (inUse(aid, i) || inUse(bid, i)) return;
        const problem = joinProblem(scratch, a, op.a.connector, b, op.b.connector, i);
        if (problem) { failures.push(problem); return; }
        setJoins(withHalf(a, op.a.connector, bid, op.b.connector));
        setJoins(withHalf(scratch.entities.get(bid)!, op.b.connector, aid, op.a.connector));
        warnings.push(`joint ${jointId(aid, op.a.connector, bid, op.b.connector)}`);
        inverse.unshift({ op: 'disconnect', a: { id: aid, connector: op.a.connector } });
        return;
      }
    }
    } catch (error) {
      if (error instanceof BakeError && error.def.hash !== contextDef?.hash) {
        entity = [...scratch.entities.values()].find((e) => scratch.def(e.def)?.hash === error.def.hash)?.id ?? entity;
      }
      const f = error instanceof PlanningFailure ? error.failure : generatorFailure(i, error, contextDef, entity,
        op.op === 'set' && op.params ? 'params' : op.op === 'move' && op.shape ? 'shape' : 'make');
      if (op.op === 'define') f.def ??= `${op.def.name}@${op.def.version}`;
      failures.push(f);
    } finally {
      for (const tile of diff.tiles.slice(tileCount)) tileAt.set(tile, i);
      for (const id of diff.removes.slice(removeCount)) removedAt.set(id, i);
    }
  });

  if (failures.length) return { ok: false, failures: heldBack.length && heldBack[0].op <= failures[0].op ? [heldBack[0]] : failures };
  // PC12 (#691): every part whose joints changed, and what it holds up or rests on, is still held up, and every half
  // has its mirror (an undo that brought back one end without the other is a conflict)
  for (const id of placedBearing(scratch, touched)) jointsTouched.set(id, touchedAt.get(id) ?? ops.length - 1);
  if (jointsTouched.size) {
    for (const [id, at] of jointsTouched) for (const [c, j] of Object.entries(scratch.entities.get(id)?.joins ?? {})) {
      const h = scratch.entities.get(j.to)?.joins?.[j.at];
      if (h?.to !== id || h.at !== c) return { ok: false, failures: [fail(at, 'undo.conflict', `${scratch.pathOf(id)} ${c} is joined to ${j.to} ${j.at}, which does not join it back`)] };
    }
    const failure = supportProblem(scratch, jointsTouched.keys(), (id) => jointsTouched.get(id) ?? ops.length - 1);
    if (failure) return { ok: false, failures: [failure] };
  }
  // Body/state writebacks do not scan every meaning record; structural/meaning edits validate the final graph.
  const meaningTouched = ops.some(op => ['place','clone','remove','restore','define','restore-def'].includes(op.op) || (op.op==='set' && (op.about!==undefined||op.name!==undefined||op.params!==undefined)) || (op.op==='world' && op.state.about!==undefined));
  // Canonicalize late references after all placements; reject dangling references/cycles atomically.
  if (meaningTouched) {
    for (const e of [...scratch.entities.values()]) if (e.about) {
      const about = canonicalAbout(scratch, e.about, ids);
      if (!sameMeaning(about, e.about)) { const next = { ...e, about }; scratch.replaceAbout(next); upsert(next, false); }
    }
    if (scratch.state.about) {
      const about = canonicalWorldAbout(scratch, scratch.state.about, ids);
      if (!sameMeaning(about, scratch.state.about)) { scratch.state = { ...scratch.state, about }; if (diff.world) diff.world.about = about; }
    }
    { const failure = meaningFailure(scratch, ops.length - 1); if (failure) return { ok: false, failures: [failure] }; }
  }
  // Persistent relationships: re-solve server-maintained constraints whose refs moved or whose ground changed (33 §3.3).
  const sourceOp = (e: Entity) => {
    const indices: number[] = [];
    for (const c of e.constraints ?? []) if ('ref' in c) {
      const id = scratch.get(c.ref)?.id ?? world.get(c.ref)?.id ?? c.ref;
      const at = touchedAt.get(id) ?? removedAt.get(id); if (at !== undefined) indices.push(at);
    }
    if (e.p) { const at = tileAt.get(`${Math.floor(e.p[0] / 64)},${Math.floor(e.p[e.p.length - 1] / 64)}`); if (at !== undefined) indices.push(at); }
    let latest = indices.reduce((n, at) => Math.max(n, at), -1);
    if (e.shape && 'path' in e.shape) for (const at of tileAt.values()) latest = Math.max(latest, at);
    return latest >= 0 ? latest : touchedAt.get(e.id) ?? ops.length - 1;
  };
  let resolved: string[];
  try {
    resolved = resolveDependents(scratch, geometryTouched, new Set(diff.removes), new Set(diff.tiles), warnings, diff.tiles, sourceOp, world);
  } catch (error) {
    return { ok: false, failures: [error instanceof PlanningFailure ? error.failure : generatorFailure(ops.length - 1, error)] };
  }
  for (const id of resolved) touched.add(id);
  for (const id of touched) { const e = scratch.entities.get(id); if (e) diff.upserts.push(e); }
  for (const e of diff.upserts) {
    const def = scratch.resolvedDef(e.def)!;
    const failure = signMediaFailure(scratch, def, e.state?.media ?? def.state.media?.default, touchedAt.get(e.id) ?? sourceOp(e), e.id)
      ?? decalFailure(scratch, def, e.params?.decals ?? (def.params.decals as { default?: unknown } | undefined)?.default, { params: e.params ?? {}, slots: () => scratch.slotsOf(e) }, touchedAt.get(e.id) ?? sourceOp(e), e.id); // XP8 hook
    if (failure) return { ok: false, failures: [failure] };
  }
  // CATRUN: a def this batch uses that only the shared library holds enters the world's own store, pinned by hash
  // (with its `extends` chain and any def named by a param), so the world keeps exactly what it placed.
  if (scratch.library) {
    const pending = [...diff.upserts.flatMap(e => [e.def, ...definitionRefs(e.params)]),
      ...diff.defs.flatMap(d => definitionRefs({extends:d.extends,make:d.make,contents:d.contents,params:d.params,components:d.components}))];
    const seen = new Set<string>();
    while (pending.length) {
      const ref = pending.pop()!; if (seen.has(ref)) continue; seen.add(ref);
      const got = scratch.adopt(ref); if (got) diff.defs.push(got);
      const d = scratch.def(ref); if (d) pending.push(...definitionRefs({extends:d.extends,make:d.make,contents:d.contents,params:d.params,components:d.components}));
    }
  }
  diff.tiles = [...new Set(diff.tiles)];
  if (layersTouched) diff.layers = true;
  let refused: Failure | null | undefined;
  try { refused = worldBudgetFailure(world, scratch, diff, ops.length - 1) ?? (opts.sealed === false ? null : sealedRouteFailure(world, scratch, diff, ops.length - 1)) ?? opts.refuse?.(scratch, diff, ops); }
  catch (error) {
    if (!(error instanceof BakeError)) throw error;
    const entity = [...scratch.entities.values()].find((e) => scratch.def(e.def)?.hash === error.def.hash);
    return { ok: false, failures: [generatorFailure(entity ? sourceOp(entity) : ops.length - 1, error, error.def, entity?.id)] };
  }
  if (refused) return { ok: false, failures: [refused] };
  if (heldBack.length) return { ok: false, failures: [heldBack[0]] };
  const seq = world.editSeq + 1;
  const undoId = 'u_' + hashOf([world.seed, seq]).slice(0, 10);
  return {
    ok: true, ids, warnings, diff,
    apply() {
      // Commit = replace the live model's structure with the scratch's. Cheap enough for now (maps copy), and
      // guarantees the live model equals the simulated one. Tile caches carry over via the ground record.
      world.seq = scratch.seq; world.editSeq = seq; world.state = scratch.state; world.constants = scratch.constants;
      world.defs = scratch.defs; world.entities = scratch.entities; world.children = scratch.children; world.names = scratch.names;
      (world as unknown as { footprints: unknown; cells: unknown; bakes: unknown }).footprints = (scratch as unknown as { footprints: unknown }).footprints;
      (world as unknown as { cells: unknown }).cells = (scratch as unknown as { cells: unknown }).cells;
      (world as unknown as { bakes: unknown }).bakes = (scratch as unknown as { bakes: unknown }).bakes;
      world.terrain = scratch.terrain;
      world.adoptSafetyCache(scratch);
      return { seq, undoId, diff, inverse };
    },
  };
}

/** Plan + apply in one step (the server's path). */
export function applyBatch(world: WorldModel, input: unknown, by: string, tick: number, opts?: PlanOptions): { result: Result; diff?: Diff; inverse?: Op[] } {
  const p = plan(world, input, by, tick, opts);
  if (!p.ok) return { result: { accepted: false, failures: p.failures } };
  const { seq, undoId, diff, inverse } = p.apply();
  return { result: { accepted: true, seq, undoId, ids: p.ids, warnings: p.warnings }, diff, inverse };
}

// ---------- helpers ----------

/** state.layers with its defaults (a world that has none gets one on the first layers op). */
function layersOf(w: WorldModel): LayersState { return layersStateSchema.parse(w.state.layers ?? {}); }
/** A schedule's `follow` fields must be state fields of the def, and their values valid. */
function followProblem(def: StoredDef, s: Schedule | null | undefined): string | null {
  for (const f of s?.follow ?? []) {
    if (!def.state[f.field]) return `schedule.follow: ${def.name} has no state field ${f.field} (it has ${Object.keys(def.state).join(', ') || 'none'})`;
    for (const v of [f.is, ...(f.else !== undefined ? [f.else] : [])]) { const ok = checkFields(def.state, { [f.field]: v }, false); if (!ok.ok) return `schedule.follow: ${ok.detail}`; }
  }
  return null;
}

/** The world's bounds [x0, z0, x1, z1] (m): the ground recipe's extent (GOD-ENV; ±extent/2 on worlds never extended). */
export function boundsOf(w: WorldModel): [number, number, number, number] { const e = w.ground().extent; return [e[0], e[1], e[2], e[3]]; }
/** A root entity's ground-plan box [x0, z0, x1, z1]: its shape's points, or its position. */
function rootBox(w: WorldModel, e: Entity): [number, number, number, number] {
  const sh = e.shape as { area?: [number, number][]; path?: [number, number][] } | undefined, pts = sh?.area ?? sh?.path;
  if (pts?.length) { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; }
  const p = w.worldPose(e); return [p.x, p.z, p.x, p.z];
}

function isBody(w: WorldModel, e: Entity): boolean { return !!w.resolvedDef(e.def)?.components.body; }

function checkDef(w: WorldModel, def: Parameters<WorldModel['defineDef']>[0], i: number): Failure | null {
  const lim = w.constants.limits;
  const bytes = new TextEncoder().encode(JSON.stringify(def)).byteLength;
  if (bytes > CREATION_LIMITS.defBytes) return { ...fail(i, 'def.budget', `definition ${bytes} bytes > ${CREATION_LIMITS.defBytes}`), field: 'def', measured: bytes, limit: CREATION_LIMITS.defBytes, fix: 'Simplify the definition or reuse library parts.' };
  const box = def.size?.box;
  if (!box) return fail(i, 'def.invalid', 'size.box required');
  if (box[0] > lim.sizeMax[0] || box[1] > lim.sizeMax[1] || box[2] > lim.sizeMax[2]) return fail(i, 'size.range', `box ${box.join('×')} exceeds world limit ${lim.sizeMax.join('×')}`);
  if (Math.min(...box) < lim.sizeMin) return fail(i, 'size.range', `box below ${lim.sizeMin} m`);
  // PC11 (#690): a loose material's handling must fit together (crew range, grips per crew, mass, reach)
  const handling = handlingProblem(def as never);
  if (handling) return { ...fail(i, handling.code, handling.message), field: handling.field, fix: handling.fix };
  // PC12 (#691): connectors lie on the part
  const conn = connectorProblem(def as never);
  if (conn) return { ...fail(i, conn.code, conn.message), field: conn.field, fix: conn.fix };
  if (def.make.kind === 'mesh') {
    const info = w.assets(def.make.asset);
    if (!info) return fail(i, 'def.invalid', `asset ${def.make.asset.slice(0, 12)}… not uploaded`);
    if (info.tris > lim.budget.tris) return fail(i, 'def.budget', `${info.tris} tris > ${lim.budget.tris}`);
    if (info.bytes > lim.budget.bytes) return fail(i, 'def.budget', `${info.bytes} bytes > ${lim.budget.bytes}`);
    (def as { budget?: unknown }).budget = { tris: info.tris, bytes: info.bytes, textures: info.textures };
  }
  if (def.make.kind === 'parts') {
    let total = 0;
    const walk = (parts: typeof def.make.parts, depth: number): string | null => {
      if (depth > CREATION_LIMITS.prefabDepth) return `prefab nesting deeper than ${CREATION_LIMITS.prefabDepth}`;
      for (const p of parts) {
        total++; if (total > CREATION_LIMITS.prefabParts) return `prefab expands to more than ${CREATION_LIMITS.prefabParts} parts`;
        const d = w.resolvedDef(p.def); if (!d) return `part ${p.id}: def ${p.def} unknown`;
        if (d.make.kind === 'parts') { const r = walk(d.make.parts, depth + 1); if (r) return r; }
      }
      return null;
    };
    const r = walk(def.make.parts, 1);
    if (r) return fail(i, 'def.expansion', r);
  }
  for (const p of def.contents ?? []) if (!w.resolvedDef(p.def)) return fail(i, 'def.expansion', `contents ${p.id}: def ${p.def} unknown`);
  if (def.extends && !w.def(def.extends)) return fail(i, 'def.unknown', `extends ${def.extends}`);
  // One deterministic trial with defaults and at most three shape points. Resolve inheritance in an isolated
  // fork so a refused def never enters the scratch world's catalogue. Generator schemas bound fixed args.
  let resolved: StoredDef | undefined;
  try {
    const trial = w.fork(), stored = trial.defineDef(def, 'admission', 0);
    resolved = trial.resolvedDef(stored.ref)!;
    const mediaFailure = signMediaFailure(trial, resolved, resolved.state.media?.default, i) ?? kitFaceFailure(trial, resolved, i); // XP8 hook
    if (mediaFailure) return mediaFailure;
    if (resolved.make.kind === 'gen') {
      const g = GENERATORS[resolved.make.gen];
      if (!g) return { ...fail(i, 'def.invalid', `generator ${resolved.make.gen} unknown`), def: stored.ref,
        field: 'make.gen', measured: resolved.make.gen, fix: `Use a known generator: ${nearestGenerators(resolved.make.gen).join(', ')}` };
      const args = g.args?.safeParse(resolved.make.args ?? {});
      if (args && !args.success) return generatorFailure(i, args.error, resolved);
      const params = checkFields(resolved.params, undefined, true);
      const shape: Entity['shape'] = resolved.form === 'path' ? { path: [[0, 0], [1, 0]] }
        : resolved.form === 'area' ? { area: [[0, 0], [1, 0], [0, 1]] } : undefined;
      const baked = trial.bake(resolved, params.ok ? params.values : {}, 0, shape);
      const decals = decalFailure(trial, resolved, params.ok ? params.values.decals : undefined, { params: params.ok ? params.values : {}, slots: () => baked.slots }, i); // XP8 hook
      if (decals) return decals;
      if (baked.tris > lim.budget.tris) return { ...fail(i, 'def.budget', `${baked.tris} tris > ${lim.budget.tris}`), field: 'make', measured: baked.tris, limit: lim.budget.tris, fix: 'Simplify the generated definition.' };
    }
  } catch (error) {
    return { ...generatorFailure(i, error, resolved), def: resolved?.ref ?? `${def.name}@${def.version ?? 1}` };
  }
  return null;
}

/** L3: freeze what a path/area generator needs from the ground (road grade + bridges, river flow + snapped ends, deck heights) into the entity's params, before admission. Explicitly given params win. */
function prepareEntity(w: WorldModel, def: StoredDef, e: Entity, explicit: Record<string, unknown> | undefined) {
  if (def.make.kind !== 'gen' || def.form === 'point' || !e.shape) return;
  const prep = prepareFor(def.make.gen, queryOf(w), e.shape as never, e.params ?? {});
  if (!prep) return;
  let took = false;
  for (const [k, v] of Object.entries(prep.params)) if (def.params[k] && explicit?.[k] === undefined) { e.params = { ...(e.params ?? {}), [k]: v }; took = true; }
  if (took && prep.path && 'path' in e.shape) e.shape = { ...e.shape, path: prep.path };
}

/** Physical admission of an entity at its (new) pose: size, extent, support/settle, slot, overlap. May adjust `e.p` (settle y, nudge). */
function admit(w: WorldModel, e: Entity, def: StoredDef, i: number, mode: 'strict' | 'nudge', creating: boolean, baseline?: WorldModel): Failure | null {
  const s = e.s ?? 1;
  if (s < def.size.scale[0] || s > def.size.scale[1]) return fail(i, 'size.range', `scale ${s} outside [${def.size.scale.join(', ')}]`);
  const baked = w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
  // K2 hook: instance $params/repeat counts must retain the definition triangle budget.
  if (def.make.kind === 'gen' && def.make.gen === 'kit/2' && baked.tris > w.constants.limits.budget.tris) return {
    ...fail(i, 'def.budget', `${baked.tris} tris > ${w.constants.limits.budget.tris}`), def: def.ref, entity: e.id,
    field: 'make.args.shapes', measured: baked.tris, limit: w.constants.limits.budget.tris, fix: 'Reduce kit repeat/radial counts or primitive segments.',
  };
  // XP5: opt-in kit rooms use their actual solids and the placed body's clearance.
  if (def.make.kind === 'gen' && def.make.gen === 'kit/2' && def.make.args?.footprint) {
    const issue = kitFootprintIssues(baked, w.worldPose(e).s)[0];
    if (issue) return { ...fail(i, issue.code, issue.detail), entity: e.id, field: 'make.args.footprint', fix: 'Keep a ground entrance at least 0.75 m wide, 2 m headroom, and a clear route into each room.' };
  }
  // generators report design faults as `violation:` notes (building/1: sealed rooms, blocked stairs, headroom)
  const violations = (baked.notes ?? []).filter((n) => n.startsWith('violation: '));
  if (violations.length) return fail(i, 'architecture', violations.map((n) => n.slice(11)).join('; '));
  const lim = w.constants.limits.sizeMax;
  if (def.layer === 'solid' && (baked.box[0] * s > lim[0] || baked.box[1] * s > lim[1] || baked.box[2] * s > lim[2])) return fail(i, 'size.range', `${baked.box.map((v) => (v * s).toFixed(1)).join('×')} exceeds ${lim.join('×')}`);
  // slot compatibility
  if (e.in.parent !== 'world') {
    const parent = w.entities.get(e.in.parent);
    if (!parent) return fail(i, 'parent.unknown', e.in.parent);
    if (e.in.slot) {
      const slot = w.slotsOf(parent).find((x) => x.id === e.in.slot);
      if (!slot) return fail(i, 'slot.unknown', `${w.pathOf(parent.id)} has no slot ${e.in.slot}`);
      if (slot.accepts.kinds && !slot.accepts.kinds.includes(def.name) && !def.tags.some((t) => slot.accepts.kinds!.includes(t))) return fail(i, 'slot.incompatible', `${e.in.slot} accepts ${slot.accepts.kinds.join(', ')}`);
      // a thing a body can carry (components.carryable) fits a carry slot without the `item` tag: catalogue carryables
      // such as core-watering-can are tagged object/tool, and the engine's write-back of one in a Soul's hands was refused
      const carried = slot.kind === 'carry' && !!def.components?.carryable;
      if (slot.accepts.tags && !carried && !def.tags.some((t) => slot.accepts.tags!.includes(t))) return fail(i, 'slot.incompatible', `${e.in.slot} accepts tags ${slot.accepts.tags.join(', ')}`);
      if (slot.accepts.maxSize && (baked.box[0] * s > slot.accepts.maxSize[0] || baked.box[1] * s > slot.accepts.maxSize[1] || baked.box[2] * s > slot.accepts.maxSize[2])) return fail(i, 'slot.incompatible', 'too big for the slot');
      const occupants = [...(w.children.get(parent.id) ?? [])].filter((c) => c !== e.id && w.entities.get(c)?.in.slot === e.in.slot).length;
      if (occupants >= slot.capacity) return fail(i, 'slot.full', `${e.in.slot} holds ${slot.capacity}`);
      // a slot with a polygon (rooms, floors): the child's centre lies on it; p in a slot is relative to the slot's origin, in the parent's frame
      if (slot.polygon && slot.polygon.length >= 3) {
        const lp = e.p ?? [0, 0], x = lp[0], z = lp[lp.length - 1], out = outsideBy(x, z, slot.polygon);
        if (out > 0.05) return fail(i, 'slot.outside', `(${x.toFixed(2)}, ${z.toFixed(2)}) is ${out.toFixed(2)} m outside ${e.in.slot}; p in a slot is relative to the slot's origin`);
      }
    }
  }
  // along: position (and turn to face) a point on a path entity before settling
  const along = e.constraints?.find((c) => c.kind === 'along') as { kind: 'along'; ref: string; t: number; side: 'center' | 'left' | 'right'; offset: number } | undefined;
  if (along && e.in.parent === 'world') {
    const ref = w.get(along.ref);
    if (!ref || !ref.shape || !('path' in ref.shape)) return fail(i, 'constraint.unsatisfied', `along: ${along.ref} is not a path entity`);
    const sideK = along.side === 'left' ? -1 : along.side === 'right' ? 1 : 0;   // offsetPolyline(+d) is the walker's right (+z is south)
    const path = sideK ? offsetPolyline(ref.shape.path, sideK * ((ref.shape.width ?? 0) / 2 + along.offset)) : ref.shape.path;
    const { p: at, dir } = pointAlong(path, along.t);
    e.p = [at[0], at[1]];
    // front faces the path: rotate toward the centre line (for side placements), else along the travel direction
    e.r = sideK ? Math.atan2(sideK * dir[1], -sideK * dir[0]) : Math.atan2(dir[0], dir[1]);
  }
  // settle on the ground when at the root with a 2-D position
  if (e.in.parent === 'world') {
    const p = e.p ?? [0, 0];
    const bb = boundsOf(w);
    if (p[0] < bb[0] || p[0] > bb[2] || p[p.length - 1] < bb[1] || p[p.length - 1] > bb[3]) return fail(i, 'extent.outside', `(${p[0]}, ${p[p.length - 1]}) is outside the world [${bb.join(', ')}] (x0, z0, x1, z1)`);
    const floatC = e.constraints?.find((c) => c.kind === 'float') as { kind: 'float'; sink: number } | undefined;
    const anchorKind = floatC ? 'float' : (e.anchor ?? def.anchor);
    if (anchorKind === 'float') {
      const x = p[0], z = p[p.length - 1];
      const level = waterLevelAt(w.ground(), x, z);
      if (level === null) return fail(i, 'float.no-water', `no water at (${x.toFixed(1)}, ${z.toFixed(1)}); place it on a lake, pond, river or the sea`);
      e.p = [x, level - (floatC?.sink ?? 0), z];
    } else if (def.form !== 'point') {
      // world-frame shapes (roads, walls, lawns…): heights are ground-relative per point (or absolute with `abs`); no settle
      e.p = [0, 0, 0];
    } else if (p.length === 2 && def.layer !== 'volume' && !baked.landform) {
      const yaw = typeof e.r === 'number' ? e.r : Array.isArray(e.r) ? e.r[0] : 0;
      const fp = footprintOf(p[0], p[1], (baked.box[0] * s) / 2, (baked.box[2] * s) / 2, yaw);
      const anchor = anchorKind as Exclude<typeof anchorKind, 'float'>;
      const st = settle(w.terrain, fp, anchor, { maxTiltRad: def.tilt ? (def.tilt.maxDeg * Math.PI) / 180 : 0 });
      e.p = [p[0], st.y, p[1]];
      if (anchor === 'conform' && st.pitch !== undefined) e.r = [yaw, st.pitch, st.roll ?? 0];
      if (anchor === 'base' && st.needsPad && (def.components.foundation?.kind ?? 'pad') === 'pad') {
        (e as Entity & { _pad?: Landform })._pad = padFor(`${e.id}:pad`, fp, st.y, padGrading(w, baked, p[0], p[1], yaw, s));
      }
    // PC12 (#691): a part with connectors is held up by its joints or lies on the ground; it never raises the ground under it
    } else if (p.length === 3 && (e.anchor ?? def.anchor) === 'base' && def.layer !== 'volume' && !baked.landform && (def.components.foundation?.kind ?? 'pad') === 'pad' && !def.components.connectors) {
      // a pre-settled pose (restore after undo, or an explicit y): keep y, but a building on a slope still needs its terrace
      const yaw = typeof e.r === 'number' ? e.r : Array.isArray(e.r) ? e.r[0] : 0;
      const fp = footprintOf(p[0], p[2], (baked.box[0] * s) / 2, (baked.box[2] * s) / 2, yaw);
      const st = settle(w.terrain, fp, 'base'), re = (e as Entity & { _resettle?: 'pad' | 'check' })._resettle;
      const keep = re === 'pad' || (re === 'check' && (st.gap > RESETTLE_TOL_M || Math.abs(st.y - p[1]) > RESETTLE_TOL_M));
      if ((keep || st.needsPad || Math.abs(st.y - p[1]) > SKIRT_MAX) && !onAbsoluteDeck(w, e, fp, p[1])) (e as Entity & { _pad?: Landform })._pad = padFor(`${e.id}:pad`, fp, p[1], padGrading(w, baked, p[0], p[2], yaw, s));
    }
  }
  // facing: turn the entity's front (+z) toward the ref
  const facing = e.constraints?.find((c) => c.kind === 'facing') as { kind: 'facing'; ref: string; offset: number } | undefined;
  if (facing) {
    const ref = w.get(facing.ref);
    if (!ref) return fail(i, 'constraint.unsatisfied', `facing: no such ref ${facing.ref}`);
    const me = w.worldPose(e), them = aimOf(w, ref);
    const parentYaw = e.in.parent === 'world' ? 0 : w.worldPose(w.entities.get(e.in.parent)!).yaw;
    const yaw = Math.atan2(them.x - me.x, them.z - me.z) - parentYaw + facing.offset;
    e.r = Array.isArray(e.r) ? [yaw, e.r[1], e.r[2]] : yaw;
  }
  // overlap (solids only; ancestors, descendants and declared overlaps are exempt)
  if (def.layer === 'solid' && baked.colliders.length) {
    const boxes = w.footprint(e, def);
    // inside an enterable thing (rooms: building/1): never through its walls, stairs, rails or posts
    for (let pid = e.in.parent; pid !== 'world';) {
      const pe = w.entities.get(pid); if (!pe) break;
      const pd = w.resolvedDef(pe.def);
      if (pd) {
        const pb = w.bake(pd, pe.params ?? {}, pe.seed ?? 0, pe.shape);
        if (pb.rooms?.length) {
          const fp = w.footprint(pe, pd);
          if (overlapNotWorse(baseline, e, pe.id, boxes, fp)) { pid = pe.in.parent; continue; }
          for (const a of boxes) for (let k = 0; k < fp.length; k++) if (obbOverlap(a, fp[k])) {
            if (mode === 'nudge') { const nudged = nudge(w, e, def, boxes, fp[k]); if (nudged) { e.p = nudged; return admit(w, e, def, i, 'strict', creating, baseline); } }
            return fail(i, 'overlap.solid', `crosses ${w.pathOf(pe.id)} ${pb.colliders[k]?.tag ?? 'wall'}`, localSuggest(w, e, envelope(boxes), suggestFrom(envelope(boxes), fp[k])));
          }
        }
      }
      pid = pe.in.parent;
    }
    const exempt = new Set([e.id, ...w.subtree(e.id)]);
    for (let pid: string | undefined = e.in.parent === 'world' ? undefined : e.in.parent; pid; pid = w.entities.get(pid)?.in.parent === 'world' ? undefined : w.entities.get(pid)?.in.parent) exempt.add(pid);
    for (const other of w.near(boxes)) {
      if (exempt.has(other)) continue;
      const oe = w.entities.get(other); if (!oe) continue;
      const od = w.resolvedDef(oe.def); if (!od) continue;
      if (def.overlaps.some((t) => od.tags.includes(t) || od.name === t) || od.overlaps.some((t) => def.tags.includes(t) || def.name === t)) continue;
      if (w.ancestors(other).has(e.id)) continue;
      if (overlapNotWorse(baseline, e, other, boxes, w.footprintsOf(other))) continue;
      for (const a of boxes) for (const b of w.footprintsOf(other)) if (obbOverlap(a, b)) {
        if (mode === 'nudge') {
          const nudged = nudge(w, e, def, boxes, b);
          if (nudged) { e.p = nudged; return admit(w, e, def, i, 'strict', creating, baseline); }
        }
        const label = oe.name ? w.pathOf(other) : `${od.name} ${other}`;
        return fail(i, 'overlap.solid', `overlaps ${label}`, localSuggest(w, e, envelope(boxes), suggestFrom(envelope(boxes), b)));
      }
    }
  }
  return null;
}

/** B12: the pieces inside a building (children in a room or floor slot with a polygon) whose footprint crosses the walls of
 *  their room by more than 0.15 m, given the building's slots at some size. p in a slot is relative to the slot's origin. */
function pokingPieces(w: WorldModel, parentId: string, slots: ReturnType<WorldModel['slotsOf']>): Set<string> {
  const out = new Set<string>();
  for (const cid of w.children.get(parentId) ?? []) {
    const c = w.entities.get(cid), slot = c?.in.slot ? slots.find((x) => x.id === c.in.slot) : undefined;
    if (!c || !slot?.polygon || slot.polygon.length < 3) continue;
    const box = w.resolvedDef(c.def)?.size.box; if (!box) continue;
    const lp = c.p ?? [0, 0], x = lp[0], z = lp[lp.length - 1], s = c.s ?? 1, yaw = typeof c.r === 'number' ? c.r : Array.isArray(c.r) ? c.r[0] : 0;
    const co = Math.cos(yaw), si = Math.sin(yaw), hx = (box[0] * s) / 2, hz = (box[2] * s) / 2;
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const lx = a * hx, lz = b * hz;
      if (outsideBy(x + lx * co + lz * si, z - lx * si + lz * co, slot.polygon) > 0.15) { out.add(cid); break; }
    }
  }
  return out;
}

/** B12: refuse a resize (`set` params) of a furnished building that would push its furniture through its walls. Names the
 *  smallest w / d the furniture still fits (each on its own, from the current size, in 0.1 m steps). */
function furnitureFit(w: WorldModel, prev: Entity, next: Entity, def: StoredDef, before: Set<string>, i: number): Failure | null {
  const poking = (params: Record<string, Value>) => [...pokingPieces(w, prev.id, w.bake(def, params, next.seed ?? 0, next.shape).slots)].filter((c) => !before.has(c));
  const now = poking(next.params ?? {});
  if (!now.length) return null;
  const cur = (k: string) => (prev.params?.[k] ?? def.params[k]?.default) as number | undefined;
  const mins: Record<string, number> = {};
  for (const k of ['w', 'd']) {
    const from = cur(k), to = next.params?.[k];
    if (typeof from !== 'number' || typeof to !== 'number' || to >= from) continue;
    const step = Math.max(0.1, (from - to) / 40);
    let ok = from;
    for (let v = from - step; v > to; v -= step) { if (poking({ ...(prev.params ?? {}), [k]: Math.round(v * 100) / 100 }).length) break; ok = v; }
    mins[k] = Math.ceil(ok * 10 - 1e-9) / 10;
  }
  const path = w.pathOf(prev.id), names = now.slice(0, 3).map((c) => w.pathOf(c).split('/').pop()).join(', ') + (now.length > 3 ? ` and ${now.length - 3} more` : '');
  const fits = Object.entries(mins).map(([k, v]) => `${k} ${v} m`).join(' and '), keep = Object.entries(mins).map(([k, v]) => `${k} ≥ ${v}`).join(' and ');
  return {
    ...fail(i, 'size.furnished', `${path} is furnished: ${now.length} piece${now.length > 1 ? 's' : ''} (${names}) would poke through its walls at that size${fits ? `; its furniture fits down to ${fits}` : ''}`),
    entity: prev.id, field: 'params', ...(keep ? { limit: mins } : {}), measured: now.length,
    fix: `${keep ? `Keep ${keep}. ` : ''}To make it smaller, take its furniture out first (\`select --in ${path} --remove\`), resize, then \`furnish ${path}\` lays its rooms out again.`,
  };
}

/** How far a point lies outside a polygon (0 inside). */
function outsideBy(x: number, z: number, poly: [number, number][]): number {
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi, dz = zj - zi, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / l2));
    best = Math.min(best, Math.hypot(x - xi - t * dx, z - zi - t * dz));
  }
  return inside ? 0 : best;
}

/** One round box around all of a thing's boxes (a suggestion must clear the whole thing, not the box that touched). */
function envelope(boxes: OBB[]): OBB {
  if (boxes.length === 1) return boxes[0];
  let x = 0, z = 0; for (const b of boxes) { x += b.c[0]; z += b.c[1]; } x /= boxes.length; z /= boxes.length;
  let r = 0; for (const b of boxes) r = Math.max(r, Math.hypot(b.c[0] - x, b.c[1] - z) + Math.hypot(b.half[0], b.half[1]));
  const h = r / Math.SQRT2;
  return { c: [x, z], half: [h, h], yaw: 0, y0: Math.min(...boxes.map((b) => b.y0)), y1: Math.max(...boxes.map((b) => b.y1)) };
}
function suggestFrom(a: OBB, b: OBB): Failure['suggest'] {
  let dx = a.c[0] - b.c[0], dz = a.c[1] - b.c[1], len = Math.sqrt(dx * dx + dz * dz);
  const apart = len;
  if (len < 1e-6) { dx = 1; dz = 0; len = 1; } // coincident centres: push east (the whole way: they are 0 apart, not 1)
  const push = Math.sqrt(a.half[0] ** 2 + a.half[1] ** 2) + Math.sqrt(b.half[0] ** 2 + b.half[1] ** 2) - apart + 0.2;
  return { p: [Math.round((a.c[0] + (dx / len) * push) * 100) / 100, Math.round((a.c[1] + (dz / len) * push) * 100) / 100] };
}
/** suggestFrom works on world boxes; a child's `p` is in its parent's (slot) frame — move the suggestion there. */
function localSuggest(w: WorldModel, e: Entity, a: OBB, s: Failure['suggest']): Failure['suggest'] {
  if (!s?.p || e.in.parent === 'world') return s;
  const me = w.worldPose(e), lp = w.localPose(e), yaw = me.yaw - lp.yaw, k = lp.s / (me.s || 1);
  const dx = s.p[0] - a.c[0], dz = s.p[1] - a.c[1], c = Math.cos(yaw), sn = Math.sin(yaw);
  const lx = (dx * c - dz * sn) * k, lz = (dx * sn + dz * c) * k, p = e.p ?? [0, 0];
  return { ...s, p: [Math.round((p[0] + lx) * 100) / 100, Math.round((p[p.length - 1] + lz) * 100) / 100] };
}
function nudge(w: WorldModel, e: Entity, _def: StoredDef, mine: OBB[], other: OBB): [number, number] | null {
  const env = envelope(mine), s = localSuggest(w, e, env, suggestFrom(env, other));
  if (!s?.p) return null;
  const p = e.p ?? [0, 0];
  const moved = Math.hypot(s.p[0] - p[0], s.p[1] - p[p.length - 1]);
  return moved <= 6 ? [s.p[0], s.p[1]] : null;
}

/** A moved parent carries its parent-local children: re-index their solid footprints at the new world pose. Without
 *  this, later checks in the same batch and later edits (overlap, sealed entrances) measured the children where they
 *  stood before the move (seen turning the Mars campus: Mimos's stale furniture "blocked" the showers' door). */
function reindexDescendants(w: WorldModel, id: string) {
  for (const cid of w.subtree(id)) {
    if (cid === id) continue;
    const c = w.entities.get(cid), d = c && w.resolvedDef(c.def); if (!c || !d) continue;
    if (d.layer === 'solid' && w.bake(d, c.params ?? {}, c.seed ?? 0, c.shape).colliders.length) w.index(cid, w.footprint(c, d));
  }
}

/** An explicitly placed fixture on a real deck must not terraform the seabed.
 * Only existing absolute world-frame surfaces count. One convex polygon must
 * contain the entire footprint, so a roof bound or a gap between slabs cannot
 * manufacture support. Ground-relative roads still receive ordinary pads. */
export function onAbsoluteDeck(w: WorldModel, e: Entity, fp: ReturnType<typeof footprintOf>, y: number): boolean {
  for (const other of w.entities.values()) {
    if (other.id === e.id || other.in.parent !== 'world' || !other.shape) continue;
    const def = w.resolvedDef(other.def); if (!def || def.form === 'point') continue;
    const baked = w.bake(def, other.params ?? {}, other.seed ?? 0, other.shape);
    for (const surface of baked.surfaces ?? []) {
      if (!(surface as {abs?: boolean}).abs || Math.abs(surface.y-y) > .002) continue;
      const p=surface.polygon; if (p.length<3) continue;
      let sign=0,convex=true;
      for(let i=0;i<p.length;i++) {
        const a=p[i],b=p[(i+1)%p.length],c=p[(i+2)%p.length];
        const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
        if(Math.abs(cross)<1e-8) continue;
        if(sign&&Math.sign(cross)!==sign){convex=false;break;}sign=Math.sign(cross);
      }
      if(convex&&sign&&fp.corners.every(([x,z])=>pointInPoly(x,z,p))) return true;
    }
  }
  return false;
}

/** After admission: index solids, and install any landform / water / foundation pad the entity brings. */
function indexAndGround(w: WorldModel, e: Entity, def: StoredDef, diff: Diff) {
  const baked = w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
  if (def.layer === 'solid' && baked.colliders.length) w.index(e.id, w.footprint(e, def));
  if (baked.landform) {
    const wp = w.worldPose(e);
    // E2 #5: a def's own landform (components.landform: a pool's basin) is authored in the def frame, bed relative to
    // where the thing stands; a generator's landform keeps its world-frame shapes.
    const lf = def.components.landform ? placeDefLandform(baked.landform, wp, e.id) : placeLandform(baked.landform, wp, e.id);
    for (const t of w.terrain.update(w.ground(), [])) diff.tiles.push(t);
    const changed = w.setLandform(lf, e.id);
    for (const c of changed) for (const t of w.terrain.invalidate(c)) diff.tiles.push(t);
  }
  if (baked.water && e.shape && 'area' in e.shape) w.setWater({ id: e.id, area: e.shape.area, level: baked.water.level }, e.id);
  else if (baked.water && e.shape && 'path' in e.shape) {
    const bw = baked.water as typeof baked.water & { levels?: number[] };
    const path = bw.path ?? e.shape.path;
    w.setWater({ id: e.id, path, w: bw.width ?? e.shape.width ?? 4, level: bw.level, ...(bw.levels && bw.levels.length === path.length ? { levels: bw.levels } : {}) }, e.id);
  }
  const pad = (e as Entity & { _pad?: Landform })._pad;
  if (pad) { delete (e as Entity & { _pad?: Landform })._pad; for (const c of w.setLandform(pad, pad.id)) for (const t of w.terrain.invalidate(c)) diff.tiles.push(t); }
}
function clearGround(w: WorldModel, e: Entity, diff: Diff) {
  for (const c of w.setLandform(null, e.id)) for (const t of w.terrain.invalidate(c)) diff.tiles.push(t);
  for (const c of w.setLandform(null, `${e.id}:pad`)) for (const t of w.terrain.invalidate(c)) diff.tiles.push(t);
  w.setWater(null, e.id);
}
/** pad/2 (lane RT): what a new foundation pad grades against: the ground as it is now, and the thing's ground-floor
 *  exterior doors in world metres (each gets a flat landing; settle.ts padFor). */
function padGrading(w: WorldModel, baked: ReturnType<WorldModel['bake']>, x: number, z: number, yaw: number, s: number): { sample(x: number, z: number): number; doors: PadDoor[] } {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const doors = (baked.openings ?? []).filter((o) => o.exterior && o.kind !== 'window' && !o.level && o.to !== 'balcony').map((o): PadDoor => {
    const nx = Math.sin(o.yaw), nz = Math.cos(o.yaw);
    return { at: [x + (o.at[0] * c + o.at[1] * sn) * s, z + (-o.at[0] * sn + o.at[1] * c) * s], out: [nx * c + nz * sn, -nx * sn + nz * c], width: o.width * s };
  });
  return { sample: (px, pz) => w.terrain.sample(px, pz), doors };
}
/** E2 #5: a def-carried landform, authored in the def frame: area/path points turn and move with the entity, widths scale,
 *  and levels (carve bed, pad level) are relative to the entity's own height. */
function placeDefLandform(lf: NonNullable<ReturnType<WorldModel['bake']>['landform']>, wp: { x: number; y: number; z: number; yaw: number; s: number }, id: string): Landform {
  const c = Math.cos(wp.yaw), sn = Math.sin(wp.yaw);
  const at = ([u, v]: [number, number]): [number, number] => [wp.x + (u * c + v * sn) * wp.s, wp.z + (-u * sn + v * c) * wp.s];
  const o = { ...lf, id } as Landform & { area?: [number, number][]; path?: [number, number][]; w?: number; bed?: number; level?: number };
  if (o.area) o.area = o.area.map(at);
  if (o.path) o.path = o.path.map(at);
  if (typeof o.w === 'number') o.w *= wp.s;
  if (o.kind === 'carve') o.bed = wp.y + (o.bed ?? 0) * wp.s;
  if (o.kind === 'pad') o.level = wp.y + (o.level ?? 0) * wp.s;
  if (o.kind === 'pad' && o.aprons) o.aprons = o.aprons.map((q) => q.map(at));
  if (o.kind === 'bump' || o.kind === 'brush') return placeLandform(lf, wp, id);
  return o;
}
/** A def's landform is authored in the def frame; bumps move to the entity's world position, shapes are already in world metres. */
function placeLandform(lf: NonNullable<ReturnType<WorldModel['bake']>['landform']>, wp: { x: number; z: number; s: number }, id: string): Landform {
  if (lf.kind === 'bump') return { ...lf, id, c: [wp.x + lf.c[0] * wp.s, wp.z + lf.c[1] * wp.s], r: lf.r * wp.s, h: lf.h * wp.s };
  if (lf.kind === 'brush') return { ...lf, id, c: [wp.x + lf.c[0] * wp.s, wp.z + lf.c[1] * wp.s], r: lf.r * wp.s };
  return { ...lf, id } as Landform;
}

function expandParts(w: WorldModel, root: Entity, def: StoredDef, by: string, tick: number, diff: Diff, inverse: Op[], upsert: (e: Entity) => void, depth = 1) {
  if (def.make.kind !== 'parts') return;
  const local: Record<string, string> = {};
  const rp = root.params ?? {};
  for (const part of def.make.parts) {
    if (part.when !== undefined && !truthy(evaluate(part.when, rp))) continue;
    const placedRef = w.library?.placementRef?.(part.def);
    const pdef = placedRef === null ? undefined : w.resolvedDef(placedRef ?? part.def); if (!pdef) continue;
    const count = part.repeat ? Math.max(0, Math.min(CREATION_LIMITS.partRepeats, Math.round(Number(typeof part.repeat.count === 'number' ? part.repeat.count : evaluate(part.repeat.count, rp)) || 0))) : 1;
    for (let k = 0; k < count; k++) {
      const params = Object.fromEntries(Object.entries(part.params ?? {}).map(([key, v]) => [key, substitute(v, rp)]));
      const state = Object.fromEntries(Object.entries(part.state ?? {}).map(([key, v]) => [key, substitute(v, rp)]));
      const parentId = part.in ? local[part.in] ?? root.id : root.id;
      const p0 = part.p?.map((v) => (typeof v === 'number' ? v : Number(substitute(v as never, rp)))) as Entity['p'] | undefined;
      const step = part.repeat?.step ?? [0, 0];
      const p = p0 ? (p0.length === 3 ? [p0[0] + step[0] * k, p0[1], p0[2] + step[1] * k] : [p0[0] + step[0] * k, p0[1] + step[1] * k]) as Entity['p'] : (k ? [step[0] * k, step[1] * k] as Entity['p'] : undefined);
      const yaw = (typeof part.r === 'number' ? part.r : 0) + (part.repeat?.yaw ?? 0) * k;
      const name = count > 1 ? `${part.id}-${k + 1}` : part.id;
      const e: Entity = { id: w.nextId(), name, def: pdef.ref, in: { parent: parentId, ...(part.slot ? { slot: part.slot } : {}) }, by, born: tick, v: 1, ...(p ? { p } : {}), ...(part.r !== undefined || part.repeat?.yaw ? { r: Array.isArray(part.r) ? part.r : yaw } : {}), ...(part.s !== undefined ? { s: part.s } : {}), ...(Object.keys(params).length ? { params } : {}), ...(Object.keys(state).length ? { state } : {}) };
      if (w.library?.placementRef || part.def.startsWith('sha:')) e.def = 'sha:' + pdef.hash;
      { const L = pdef.layers ?? {}; for (const k of ['owner', 'access', 'schedule', 'price'] as const) { const v = part[k] ?? L[k]; if (v !== undefined) (e as Record<string, unknown>)[k] = v; } }
      w.insert(e); indexAndGround(w, e, pdef, diff); upsert(e);
      if (pdef.make.kind !== 'parts' && pdef.contents?.length && depth < CREATION_LIMITS.prefabDepth) expandParts(w, e, { ...pdef, make: { kind: 'parts', parts: pdef.contents } } as StoredDef, by, tick, diff, inverse, upsert, depth + 1);
      if (k === 0) local[part.id] = e.id;
      if (pdef.make.kind === 'parts' && depth < CREATION_LIMITS.prefabDepth) expandParts(w, e, pdef, by, tick, diff, inverse, upsert, depth + 1);
    }
  }
}
/** Tiny expression evaluator for prefab `when`/`repeat`: "$x", "!$x", "$x > 2", "$x * 2", "$x == cottage". */
function evaluate(expr: string, params: Record<string, Value>): Value {
  const t = expr.trim();
  if (t.startsWith('!')) return !truthy(evaluate(t.slice(1), params));
  const m = t.match(/^\$([a-zA-Z][a-zA-Z0-9_]*)(?:\s*(==|!=|>=|<=|>|<|[+\-*/])\s*(.+))?$/);
  if (!m) return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t;
  const a = params[m[1]];
  if (!m[2]) return a ?? null;
  const rhsRaw = m[3].trim(); const rhs: Value = /^-?\d+(\.\d+)?$/.test(rhsRaw) ? Number(rhsRaw) : rhsRaw === 'true' ? true : rhsRaw === 'false' ? false : rhsRaw.replace(/^['"]|['"]$/g, '');
  switch (m[2]) {
    case '==': return a === rhs; case '!=': return a !== rhs;
    case '>': return Number(a) > Number(rhs); case '<': return Number(a) < Number(rhs); case '>=': return Number(a) >= Number(rhs); case '<=': return Number(a) <= Number(rhs);
    case '+': return Number(a) + Number(rhs); case '-': return Number(a) - Number(rhs); case '*': return Number(a) * Number(rhs); case '/': return Number(a) / Number(rhs);
  }
  return null;
}
const truthy = (v: Value) => !(v === false || v === null || v === 0 || v === '' || v === undefined);
function uniqueName(w: WorldModel, parent: string, base: string): string {
  const stem = base.replace(/-\d+$/, '');
  for (let k = 2; k < 1000; k++) { const n = `${stem}-${k}`; if (!w.names.has(`${parent}/${n}`)) return n; }
  return `${stem}-${Date.now() % 100000}`;
}
function shiftShape(shape: NonNullable<Entity['shape']>, dx: number, dz: number): NonNullable<Entity['shape']> {
  if ('area' in shape) return { area: shape.area.map(([x, z]) => [x + dx, z + dz] as [number, number]) };
  return { ...shape, path: shape.path.map(([x, z]) => [x + dx, z + dz] as [number, number]) };
}
/** `$param` substitution and `+ - * /` with one operator: "$floors * 3", "$w / 2 + 1" is not supported (one op). */
function substitute(v: number | string | boolean, params: Record<string, Value>): Value {
  if (typeof v !== 'string' || !v.includes('$')) return v;
  if (/(==|!=|>=|<=|>|<)/.test(v) || v.trim().startsWith('!')) return evaluate(v, params);
  const m = v.trim().match(/^\$([a-z][a-z0-9_]*)(?:\s*([+\-*/])\s*(-?\d+(?:\.\d+)?))?$/);
  if (!m) return v;
  const base = params[m[1]];
  if (typeof base !== 'number' || !m[2]) return base ?? v;
  const n = Number(m[3]);
  return m[2] === '+' ? base + n : m[2] === '-' ? base - n : m[2] === '*' ? base * n : base / n;
}

const MAX_DEPENDENTS = 500;
const ROADS = new Set(['road/1', 'path/1']);
/** Does a polyline pass through any of these 64 m tiles (sampled every 8 m)? */
function crossesTiles(path: [number, number][], tiles: Set<string>, tileOf: (x: number, z: number) => string): boolean {
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[i + 1] ?? a, n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
    for (let k = 0; k <= n; k++) if (tiles.has(tileOf(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n))) return true;
  }
  return false;
}
/** Re-solve `float`, `facing`, `along` and ground settling for entities affected by this batch. Returns ids changed. */
function resolveDependents(w: WorldModel, touched: Set<string>, removed: Set<string>, tiles: Set<string>, warnings: string[], outTiles: string[] = [], sourceOp: (e: Entity) => number = () => -1, before?: WorldModel): string[] {
  const changed: string[] = [];
  if (!touched.size && !tiles.size && !removed.size) return changed;
  const tileOfXZ = (x: number, z: number) => `${Math.floor(x / 64)},${Math.floor(z / 64)}`;
  for (const e of [...w.entities.values()]) {  // snapshot: re-inserting during iteration would revisit keys
    let def: StoredDef | undefined;
    try {
    if (changed.length >= MAX_DEPENDENTS) { warnings.push(`more than ${MAX_DEPENDENTS} dependents; run resolve to finish`); break; }
    if (touched.has(e.id) && !e.constraints?.length) continue;
    def = w.resolvedDef(e.def); if (!def) continue;
    let next: Entity | null = null;
    const cons = e.constraints ?? [];
    for (const c of cons) {
      if (c.kind === 'facing') {
        if (removed.has(w.get(c.ref)?.id ?? c.ref)) { warnings.push(`${w.pathOf(e.id)}: facing ref ${c.ref} was removed`); continue; }
        const ref = w.get(c.ref); if (!ref || !touched.has(ref.id)) continue;
        const me = w.worldPose(next ?? e), them = aimOf(w, ref);
        const parentYaw = e.in.parent === 'world' ? 0 : w.worldPose(w.entities.get(e.in.parent)!).yaw;
        const yaw = Math.atan2(them.x - me.x, them.z - me.z) - parentYaw + c.offset;
        next = { ...(next ?? e), r: Array.isArray(e.r) ? [yaw, e.r[1], e.r[2]] : yaw };
      } else if (c.kind === 'along') {
        const ref = w.get(c.ref); if (!ref || !touched.has(ref.id)) continue;
        next = { ...(next ?? e) };  // admit() recomputes the point on the path
      }
    }
    // roads and paths on changed tiles: a stream, river or lake added (or removed) across them since they were laid
    // gets (or loses) its bridge — the same prepare step that froze their grade, kept only when the crossings change
    if (e.in.parent === 'world' && tiles.size && !touched.has(e.id) && def.make.kind === 'gen' && ROADS.has(def.make.gen) && e.shape && 'path' in e.shape && crossesTiles(e.shape.path as [number, number][], tiles, tileOfXZ)) {
      const prep = prepareFor(def.make.gen, queryOf(w), e.shape as never, e.params ?? {});
      const spansOf = (g: unknown) => JSON.stringify(((g as { spans?: unknown[] } | undefined)?.spans ?? []).map((s) => { const x = s as { from: number; to: number }; return [Math.round(x.from), Math.round(x.to)]; }));
      if (prep?.params.grade && spansOf(prep.params.grade) !== spansOf(e.params?.grade)) {
        const n = ((prep.params.grade as { spans?: unknown[] }).spans ?? []).length;
        next = { ...(next ?? e), params: { ...(e.params ?? {}), grade: prep.params.grade } };
        warnings.push(`${w.pathOf(e.id)}: ${n ? `now bridges the water it crosses (${n} span${n > 1 ? 's' : ''})` : 'no longer crosses water (bridge removed)'}`);
      }
    }
    // ground: root things on changed tiles settle again (float re-reads the water level)
    if (e.in.parent === 'world' && e.p && tiles.size && !def.components.landform && def.layer !== 'volume') {
      const x = e.p[0], z = e.p[e.p.length - 1];
      if (tiles.has(tileOfXZ(x, z))) {
        // Tiles are cache invalidation bounds, not evidence that this support moved.
        // Compare the same five samples used by settle before discarding explicit Y
        // (e.g. a chair on a mesh slab, with a new pond 30 m away in the same tile).
        const baked = w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), s = e.s ?? 1;
        const yaw = typeof e.r === 'number' ? e.r : e.r?.[0] ?? 0;
        const fp = footprintOf(x, z, baked.box[0] * s / 2, baked.box[2] * s / 2, yaw);
        // An existing foundation masks the ground underneath it. Re-admit padded
        // buildings with their pad removed below; visible samples cannot prove
        // that their underlying support is unchanged.
        const hasPad = w.ground().landforms.some(l => l.id === `${e.id}:pad`);
        const terrainChanged = hasPad || !before || [...fp.corners, fp.center].some(([a,b]) => Math.abs(w.terrain.sample(a,b) - before.terrain.sample(a,b)) > 1e-5);
        const floats = (e.anchor ?? def.anchor) === 'float' || e.constraints?.some(c => c.kind === 'float');
        const waterChanged = floats && (!before || waterLevelAt(w.ground(),x,z) !== waterLevelAt(before.ground(),x,z));
        if (terrainChanged || waterChanged) next = { ...(next ?? e), p: [x, z] };
      }
    }
    if (!next) continue;
    // keep a pre-existing pad-free settle: re-admit (settles y, re-applies float/facing); skip if it no longer fits
    const prevP = e.p, prevR = e.r;
    const trial: Entity = { ...next, v: e.v + 1 };
    w.delete(e.id);
    // GOD-ENV: a building re-settles on the ground as it is now, so its old foundation pad comes up first (and goes
    // back if it cannot re-settle); a new pad is installed when the new ground needs one (as on a fresh placement)
    const padId = `${e.id}:pad`, oldPad = w.ground().landforms.find((l) => l.id === padId) ?? null;
    if (oldPad && trial.p) { trial.p = [trial.p[0], trial.p[trial.p.length - 1]]; for (const c of w.setLandform(null, padId)) for (const t of w.terrain.invalidate(c)) outTiles.push(t); }
    const problem = admitForResolve(w, trial, def);
    if (problem) { if (oldPad) for (const c of w.setLandform(oldPad, padId)) for (const t of w.terrain.invalidate(c)) outTiles.push(t); w.insert(e); w.index(e.id, w.footprint(e, def)); warnings.push(`${w.pathOf(e.id)}: ${problem}`); continue; }
    const pad = (trial as Entity & { _pad?: Landform })._pad;
    if (pad) { delete (trial as Entity & { _pad?: Landform })._pad; for (const c of w.setLandform(pad, pad.id)) for (const t of w.terrain.invalidate(c)) outTiles.push(t); }
    w.insert(trial); if (def.layer === 'solid') w.index(trial.id, w.footprint(trial, def));
    if (JSON.stringify(prevP) !== JSON.stringify(trial.p) || JSON.stringify(prevR) !== JSON.stringify(trial.r) || trial.params !== e.params) changed.push(e.id); else { w.delete(trial.id); w.insert(e); if (def.layer === 'solid') w.index(e.id, w.footprint(e, def)); }
    } catch (error) {
      throw new PlanningFailure(generatorFailure(sourceOp(e), error, def, e.id));
    }
  }
  return changed;
}
/** Settle-and-orient only (no overlap refusal: a dependent follows its ref even into a tight spot; warnings report it). */
function admitForResolve(w: WorldModel, e: Entity, def: StoredDef): string | null {
  const f = admit(w, e, def, -1, 'strict', false);
  if (!f) return null;
  return f.code === 'overlap.solid' ? null : `${f.code}: ${f.detail}`;
}

/** Where `facing` aims: an area's centroid or a path's midpoint (in the ref's frame), else the ref's origin. */
export function aimOf(w: WorldModel, ref: Entity): { x: number; z: number } {
  const pose = w.worldPose(ref), sh = ref.shape as { area?: [number, number][]; path?: [number, number][] } | undefined;
  let local: [number, number] | undefined;
  if (sh?.area?.length) { let x = 0, z = 0; for (const q of sh.area) { x += q[0]; z += q[1]; } local = [x / sh.area.length, z / sh.area.length]; }
  else if (sh?.path?.length) { const m = pointAlong(sh.path, 0.5).p; local = [m[0], m[1]]; }
  if (!local) return pose;
  const c = Math.cos(pose.yaw), sn = Math.sin(pose.yaw);
  return { x: pose.x + local[0] * c + local[1] * sn, z: pose.z - local[0] * sn + local[1] * c };
}

/** PC12 (#691): a joined part is refused an edit that would move its connectors. */
function joinedProblem(w: WorldModel, id: string, i: number): Failure | null {
  const e = w.entities.get(id), js = Object.entries(e?.joins ?? {});
  if (!js.length) return null;
  return { ...fail(i, 'connector.joined', `${w.pathOf(id)} is joined (${js.map(([c, j]) => `${c} to ${w.pathOf(j.to)} ${j.at}`).join('; ')}); it does not move while joined`), entity: id, field: 'joins', fix: 'Disconnect its joints first (what it holds up must be held up another way).' };
}
/** PC12: placed or moved parts with bearing connectors get the support check too (a beam placed in the air unjoined). */
function placedBearing(w: WorldModel, touched: Set<string>): string[] {
  const out: string[] = [];
  for (const id of touched) { const e = w.entities.get(id); if (e && w.resolvedDef(e.def)?.components.connectors?.some((c) => c.bears)) out.push(id); }
  return out;
}
