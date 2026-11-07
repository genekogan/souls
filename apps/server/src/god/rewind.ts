// Y5 (CE3 Rewind): pure helpers for `POST /v1/god/builds/:id/rewind`. The atomic inverse chain itself is R1's
// preflightUndo/commitSequence; this file only reads its result: what a rewind would change, and which later live
// edits outside the reverted set would lose their effect (refused with a field and a fix, never silently destroyed).
import { hashOf, type Diff, type Entity, type Failure, type WorldModel } from '@souls/world-compiler';
import type { EditRow } from './store.ts';

const FIELDS = ['def', 'in', 'name', 'p', 'r', 's', 'shape', 'anchor', 'params', 'state', 'seed', 'constraints', 'owner', 'access', 'schedule', 'price'] as const;
const POSE = ['in', 'p', 'r', 's', 'shape', 'constraints'];
const SET = ['name', 'params', 'state', 'constraints', 'owner', 'access', 'schedule', 'price'];
const differs = (a: Entity, b: Entity, f: typeof FIELDS[number]) => hashOf(a[f] ?? null) !== hashOf(b[f] ?? null);
export type RewindTarget = EditRow & { step: number };
export type RewindEntry = { model: WorldModel; diff: Diff };
type Touch = { seq: number; n: number };

/** What each live journal row did, read from its own inverse: [entity id or '#world', fields | '#exists']. */
export function touchesOf(r: Pick<EditRow, 'inverse'>): [string, string[]][] {
  const out: [string, string[]][] = [];
  for (const op of r.inverse) {
    if (op.op === 'remove') out.push([op.id, ['#exists']]);
    else if (op.op === 'restore') out.push([op.entity.id, ['#exists']]);
    else if (op.op === 'move') out.push([op.id, POSE]);
    else if (op.op === 'set') out.push([op.id, SET.filter(k => k in op)]);
    else if (op.op === 'restore-def') for (const i of op.instances ?? []) out.push([i.entity.id, [...i.fields]]);
    else if (op.op === 'world') out.push(['#world', Object.keys(op.state ?? {})]);
  }
  return out;
}

/** Entities the chain removes, brings back or changes (count + top-level names, like "removes 18 parts"). */
export function rewindChanges(model: WorldModel, after: WorldModel, entries: readonly RewindEntry[]) {
  const ids = new Set(entries.flatMap(e => [...e.diff.upserts.map(u => u.id), ...e.diff.removes]));
  const removed: string[] = [], restored: string[] = [], changed: string[] = [], world = new Set(entries.flatMap(e => Object.keys(e.diff.world ?? {})));
  for (const id of ids) {
    const a = model.entities.get(id), b = after.entities.get(id);
    if (a && !b) removed.push(id); else if (!a && b) restored.push(id); else if (a && b && FIELDS.some(f => differs(a, b, f))) changed.push(id);
  }
  const names = (list: string[], m: WorldModel, tops = true) => {
    const set = new Set(list), shown = list.filter(id => !tops || !set.has(m.entities.get(id)!.in.parent)).map(id => m.pathOf(id) || id).sort();
    return { count: list.length, names: shown.slice(0, 24), ...(shown.length > 24 ? { more: shown.length - 24 } : {}) };
  };
  return { removes: names(removed, model), restores: names(restored, after), changes: names(changed, model, false), ...(world.size ? { world: [...world].sort() } : {}) };
}

/** Later live rows (any group, including kept edits of this build) whose effect the chain would remove or revert.
 *  Only rows after the first reverted edit that touched the same entity field qualify; an earlier row's effect is what
 *  the inverse restores. Engine rows carry no inverse; a resident-made thing inside removed work is refused instead. */
export function rewindDependents(build: string, to: number, model: WorldModel, after: WorldModel, entries: readonly RewindEntry[], targets: readonly RewindTarget[], later: readonly EditRow[]): Failure[] {
  const touch = new Map<string, Map<string, Touch[]>>();
  const add = (id: string, field: string, t: Touch) => { let m = touch.get(id); if (!m) touch.set(id, m = new Map()); m.set(field, [...(m.get(field) ?? []), t]); };
  let before = model;
  entries.forEach((entry, i) => {
    const t = { seq: targets[i].seq, n: targets[i].step };
    for (const id of new Set([...entry.diff.upserts.map(e => e.id), ...entry.diff.removes])) {
      const a = before.entities.get(id), b = entry.model.entities.get(id);
      if (!a || !b) add(id, '#exists', t); else for (const f of FIELDS) if (differs(a, b, f)) add(id, f, t);
    }
    for (const key of Object.keys(entry.diff.world ?? {})) add('#world', key, t);
    before = entry.model;
  });
  const failures: Failure[] = [], reverted = new Set(targets.map(t => t.seq));
  const path = (id: string) => id === '#world' ? 'world state' : (model.entities.has(id) ? model.pathOf(id) : after.pathOf(id)) || id;
  const verb = (id: string) => id === '#world' ? 'revert' : !after.entities.has(id) ? 'remove' : !model.entities.has(id) ? 'bring back' : 'revert';
  const ours = (g: string | null) => g === build || !!g?.startsWith(build + '/');
  for (const r of later) {
    if (reverted.has(r.seq) || failures.length >= 8) continue;
    const hits: { id: string; t: Touch[] }[] = [];
    for (const [id, fields] of touchesOf(r)) {
      const m = touch.get(id); if (!m) continue;
      // An undo row restores the state from before the edit it reverted (undo_of): only a reverted edit between the two
      // would put that edit's change back. Every other row's effect is lost when an earlier reverted edit touched it.
      const t = [...(m.get('#exists') ?? []), ...(fields.includes('#exists') ? [] : fields.flatMap(f => m.get(f) ?? []))].filter(x => x.seq < r.seq && (r.kind !== 'undo' || r.undo_of === null || x.seq > r.undo_of));
      if (t.length) hits.push({ id, t });
    }
    if (!hits.length) continue;
    const [first] = hits, on = Math.min(...first.t.map(x => x.seq)), step = first.t.find(x => x.seq === on)!.n, keep = Math.max(...hits.flatMap(h => h.t.map(x => x.n)));
    const who = ours(r.grp) ? `kept edit ${r.seq} of this build (${r.grp})` : `edit ${r.seq} (${r.grp ? `group ${r.grp}` : 'ungrouped'})`;
    // An undo row is reversed by redo; group undo only reverts edits and redos.
    const remedy = r.kind === 'undo' ? `redo edit ${r.undo_of} first (\`redo\` while undo ${r.seq} is the newest undo)` : `undo edit ${r.seq} first (${r.grp ? `undo --group ${r.grp}` : '`undo` while it is the newest edit'})`;
    failures.push({ op: -1, code: 'build.depends', field: 'to', ...(first.id === '#world' ? {} : { entity: first.id }),
      detail: `${who} changed ${path(first.id)} after edit ${on} (step ${step}); rewinding to step ${to} would ${verb(first.id)} it${hits.length > 1 ? ` (and ${hits.length - 1} more thing(s) it touched)` : ''}.`,
      fix: keep > to ? `Rewind to step ${keep} or later, or ${remedy}, then retry.` : `${remedy[0].toUpperCase()}${remedy.slice(1)}, then retry.`,
      measured: { seq: r.seq, group: r.grp, kind: r.kind, dependsOn: on, things: hits.length }, ...(keep > to ? { limit: { to: keep } } : {}) });
  }
  const resident = new Set<string>();
  for (const entry of entries) for (const id of entry.diff.removes) {
    const e = model.entities.get(id);
    if (e?.by === 'engine' && !after.entities.has(id) && !resident.has(id) && !model.resolvedDef(e.def)?.components.body && failures.length < 8) {
      resident.add(id);
      failures.push({ op: -1, code: 'build.depends', field: 'to', entity: id, detail: `${path(id)} was made by a resident inside work this rewind removes.`, fix: 'Move it out of the build (or ask its owner), then retry; or rewind to a later step.' });
    }
  }
  return failures;
}
