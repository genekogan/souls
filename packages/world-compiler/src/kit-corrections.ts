// Harvest fix kitlenient: correct kit/2 defines in a raw batch before it is parsed, so dryrun, preview, act and the
// kit workbench admit (and store) the same corrected definition, and say what they changed.
import { correctKitArgs, isKitProgram, kitPhysics } from '@souls/generators';
import { checkFields } from './compile.ts';
import { defSchema } from './schemas.ts';

const fmt = (v: unknown) => JSON.stringify(v);
type RawDef = { name?: unknown; version?: unknown; make?: { kind?: unknown; gen?: unknown; args?: unknown }; size?: Record<string, unknown>; params?: unknown; extends?: unknown };

/** One kit/2 definition corrected; anything else comes back as given. Warnings read `kit.corrected: <ref> <field> <what was done>`. */
export function correctKitDef(input: unknown): { def: unknown; warnings: string[] } {
  const d = input as RawDef | null;
  if (!d || typeof d !== 'object' || d.make?.kind !== 'gen' || d.make.gen !== 'kit/2') return { def: input, warnings: [] };
  const ref = `${typeof d.name === 'string' ? d.name : 'kit'}@${typeof d.version === 'number' ? d.version : 1}`;
  const { args, corrections } = correctKitArgs(d.make.args);
  const warnings = corrections.map(c => `kit.corrected: ${ref} make.args.${c.field} ${c.done}`);
  let def: Record<string, unknown> = args === d.make.args ? d as Record<string, unknown> : { ...d, make: { ...d.make, args } };
  // No box (kit programs especially): measure the expanded geometry with the default params, exactly as admission bakes it.
  const shapes = (args as { shapes?: unknown } | undefined)?.shapes;
  if ((d.size === undefined || (typeof d.size === 'object' && d.size?.box === undefined)) && d.extends === undefined && Array.isArray(shapes)) {
    const fields = defSchema.shape.params.safeParse(d.params ?? {}), params = fields.success ? checkFields(fields.data, undefined, true) : undefined;
    let box: number[] | undefined;
    try { box = kitPhysics(args, params?.ok ? params.values : {}).box.map(n => Math.max(0.05, Math.round(n * 100) / 100)); } catch { /* refused below */ }
    // Unmeasurable geometry gets a stand-in box so admission refuses it for the real reason, not for the missing box.
    def = { ...def, size: { ...(d.size ?? {}), box: box ?? [1, 1, 1] } };
    if (box) warnings.push(`kit.corrected: ${ref} size.box computed ${fmt(box)} from the ${isKitProgram(shapes) ? 'expanded ' : ''}shapes`);
  }
  return { def, warnings };
}

/** Every define op of a raw batch, corrected. The batch is copied only when something changed. */
export function correctKitDefines<T>(batch: T): { batch: T; warnings: string[] } {
  const ops = (batch as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) return { batch, warnings: [] };
  const warnings: string[] = [];
  let changed = false;
  const next = ops.map(op => {
    if (!op || typeof op !== 'object' || (op as { op?: unknown }).op !== 'define') return op;
    const r = correctKitDef((op as { def?: unknown }).def);
    if (r.def === (op as { def?: unknown }).def) return op;
    changed = true; warnings.push(...r.warnings);
    return { ...op, def: r.def };
  });
  return { batch: changed ? { ...(batch as object), ops: next } as T : batch, warnings };
}
