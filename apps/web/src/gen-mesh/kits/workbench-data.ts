import { expandKitProgram, kitWhen, type KitArgs } from '@souls/generators';
import type { StoredDef } from '@souls/world-compiler';

/** Keep the warning aligned with kit/2's default collider eligibility. */
export function tiltedColliderWarning(def: StoredDef, params: Record<string, unknown> = {}): string[] {
  if (def.make.kind !== 'gen' || def.make.gen !== 'kit/2') return [];
  // K2: inspect the same expanded numeric shapes used by the mesh and physics.
  let args: KitArgs;
  try { args = expandKitProgram(def.make.args, params); } catch { return []; }
  const tilted = args.shapes.some(sh => {
    if (!kitWhen(sh.when, params as never) || sh.when?.includes('@')) return false;
    const height = sh.kind === 'sphere' ? 2 * (sh.r ?? .5) : sh.size?.[1] ?? sh.h ?? 1;
    const collide = sh.collide ?? (['box', 'rbox', 'cyl', 'extrude', 'loft'].includes(sh.kind) && height >= .3 && !sh.role);
    return collide && (Math.abs(sh.pitch ?? 0) > 1e-8 || Math.abs(sh.roll ?? 0) > 1e-8);
  });
  return tilted ? ['Tilted collider: physics uses conservative upright slices; check the cyan wireframes.'] : [];
}
