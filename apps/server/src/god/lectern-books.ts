// Soul Actions #428 (W016): a lectern that holds a book of the library catalogue (core-lectern@2, param `book`). Reading
// at it (its derived reading spot, read:read.<lectern>, or read:here chosen at that spot) reads that book's next
// passage with the library's own per-Soul progress, in any world. A lectern with no book ('', @1 and every other def)
// reads exactly as before. Like world-lore.ts it wraps the ledger's outcome store and world profile, outermost.
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import { ActionOutcomes } from '../edge/outcomes/store.ts';
import { EDEN_LIBRARY_CATALOGUE } from '../edge/content/eden-library-catalogue.ts';
import type { GodMode } from './god.ts';

/** The catalogue book a reading at this spot reads, or null. */
export function lecternBook(god: GodMode, capability: string, readSpot?: string): (typeof EDEN_LIBRARY_CATALOGUE)[number] | null {
  const spot = /^read:(read\..+)$/.exec(capability)?.[1] ?? (capability === 'read:here' ? readSpot : undefined);
  const id = spot && /^read\.(.+)$/.exec(spot)?.[1]; if (!id) return null;
  const e = god.model.entities.get(id), def = e && god.model.resolvedDef(e.def); if (!e || !def || def.name !== 'core-lectern' || !def.params.book) return null;
  const book = String(e.params?.book ?? def.params.book.default ?? '');
  return book ? EDEN_LIBRARY_CATALOGUE.find(b => b.id === book) ?? null : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function installLecternBooks(L: EdgeLedger, god: GodMode) {
  const o = L.outcomes as any, inner = o.readPassage.bind(o), library = (ActionOutcomes.prototype as any).readPassage.bind(o);
  o.readPassage = (context: any, out: any) => {
    const book = lecternBook(god, String(context.capability ?? ''), context.readSpot);
    return book ? library({ ...context, params: { ...context.params, book: book.id } }, out) : inner(context, out);
  };
  // the reading offer at such a lectern names its book (after any relabel of reading as the world's constitution)
  const prev = L.worldProfile;
  L.worldProfile = (soul, caps, plans) => {
    prev?.(soul, caps, plans);
    for (const c of caps) {
      if (c.verb !== 'read') continue;
      const book = lecternBook(god, c.id, c.target?.kind === 'spot' ? c.target.id : undefined); if (!book) continue;
      c.label = String(c.label).replace(/^Read (?:this world's constitution|about this world|a book|the book you carry)/i, `Read ${book.title}`);
      const p = plans.get(c.id); if (p) p.label = `Read ${book.title}`;
    }
  };
  L.registerExactWalkProfile(L.worldProfile!, prev);
}
