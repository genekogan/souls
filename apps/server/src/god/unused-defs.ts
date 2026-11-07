// W1: protect definitions used through inheritance/prefabs, including historical revisions.
import { definitionRefs, type StoredDef, type WorldModel } from '@souls/world-compiler';
export function definitionUseClosure(model: WorldModel, placed: Iterable<string>): Set<string> {
  const variants = new Map<string, StoredDef[]>();
  for (const d of new Set(model.defs.values())) { const rows = variants.get(d.ref) ?? []; rows.push(d); variants.set(d.ref, rows); }
  const used = new Set<string>(), pending = [...placed];
  while (pending.length) {
    const d = model.def(pending.pop()!); if (!d || used.has(d.ref)) continue;
    used.add(d.ref);
    for (const version of variants.get(d.ref) ?? [d]) for (const ref of definitionRefs(version)) if (model.def(ref)?.ref !== d.ref) pending.push(ref);
  }
  return used;
}
