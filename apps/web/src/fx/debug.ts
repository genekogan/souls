// W2: one switch for every effect of this lane, for the frame-cost bench (team/scratch/t4/w2/shots.mjs):
// window.__soulsFx.set(false) hides them all at once (no tick needed), set(true) restores them; stats() counts them.
type Fx = { set(on: boolean): void; stats(): Record<string, unknown> };
const all = new Map<string, Fx>();
export function registerFx(name: string, fx: Fx) {
  all.set(name, fx);
  (globalThis as { __soulsFx?: unknown }).__soulsFx ??= {
    set(on: boolean) { for (const f of all.values()) f.set(on); },
    stats() { return Object.fromEntries([...all].map(([k, f]) => [k, f.stats()])); },
  };
}
