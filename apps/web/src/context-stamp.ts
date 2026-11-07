import type { Entity } from '@souls/world-compiler';
/** Authored visual state matters; engine diffs are excluded by the caller. */
export const contextStamp = (e: Entity | undefined) => e && !e.id.startsWith('h_') ? JSON.stringify([e.def, e.name, e.about, e.in, e.p, e.r, e.s, e.params, e.shape, e.access, e.owner, e.state]) : null;
