// #531: the world stays behind the arrival light until a known navigation has happened, so a visitor never sees a world
// and then the page starting again. Bounded: a Clerk that never loads must not hold an arrival for long.
export const ARRIVAL_HOLD_MS = 6000;

let held = false, timer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();
const tell = () => { for (const f of [...subs]) f(); };

export const arrivalHold = {
  held: () => held,
  /** Starts the hold; the returned function is the effect's cleanup. */
  hold(ms = ARRIVAL_HOLD_MS) {
    if (!held) { held = true; timer = setTimeout(() => arrivalHold.release(), ms); tell(); }
    return () => arrivalHold.release();
  },
  release() { if (!held) return; held = false; if (timer) clearTimeout(timer); timer = null; tell(); },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
