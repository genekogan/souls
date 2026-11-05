import type { Take } from '../../../mars/viewer/engine/take/types.ts';
type Chunk = {
    fromTick: number;
    toTick: number;
    take: Take;
};
const identity = (c: Chunk) => JSON.stringify([c.take.id, c.take.startTick, c.take.ticks, c.take.baselineStateHash, c.take.finalStateHash, c.take.rulesVersion, c.take.dt]);
const adjacent = (a: Chunk, b: Chunk) => a.toTick === b.fromTick && a.take.dt === b.take.dt && a.take.rulesVersion === b.take.rulesVersion && a.take.finalStateHash === b.take.baselineStateHash;
/** One owner/epoch-local initial supplement. Never polls, guesses a missing chunk or mutates live input. */
export class WorldMotionHistory {
    private state: 'new' | 'loading' | 'ready' | 'legacy' = 'new';
    private saved: Chunk[] = [];
    private pending: Promise<void> | null = null;
    private cachedLive: readonly Chunk[] | null = null;
    private cachedSelected: Chunk | null = null;
    private cachedRequired = Infinity;
    private cachedHistory: Chunk[] = [];
    private readonly fetch: (from: number, to: number, limit: number, signal: AbortSignal) => Promise<Chunk[]>;
    private readonly signal: AbortSignal;
    private readonly requiredSeconds: number;
    private readonly deadlineMs: number;
    constructor(fetch: (from: number, to: number, limit: number, signal: AbortSignal) => Promise<Chunk[]>, signal: AbortSignal, requiredSeconds = 4, deadlineMs = 5000) { this.fetch = fetch; this.signal = signal; this.requiredSeconds = requiredSeconds; this.deadlineMs = deadlineMs; }
    get loading() { return this.state === 'new' || this.state === 'loading'; }
    get enabled() { return this.state === 'ready'; }
    start(live: readonly Chunk[], serverTick: number, delayTicks: number, owner: string, currentOwner: () => string) {
        if (this.pending || this.state !== 'new' || !live.length)
            return this.pending;
        const last = live.at(-1)!, dt = last.take.dt, from = Math.max(0, Math.floor(serverTick - delayTicks - this.requiredSeconds / dt)), to = last.toTick;
        this.state = 'loading';
        const ctl = new AbortController(), cancel = () => ctl.abort();
        this.signal.addEventListener('abort', cancel, { once: true });
        if (this.signal.aborted)
            ctl.abort();
        const deadline = setTimeout(cancel, this.deadlineMs);
        this.pending = this.fetch(from, to, 12, ctl.signal).then(got => {
            if (this.signal.aborted)
                return;
            if (currentOwner() !== owner) {
                this.state = 'legacy';
                return;
            }
            const world = JSON.stringify(last.take.finalState.base);
            if (got.some(c => JSON.stringify(c.take.finalState.base) !== world || c.take.dt !== dt || c.take.rulesVersion !== last.take.rulesVersion)) {
                this.state = 'legacy';
                return;
            }
            this.saved = got.slice(0, 12);
            this.state = 'ready';
        }, () => { if (!this.signal.aborted)
            this.state = 'legacy'; }).finally(() => { clearTimeout(deadline); this.signal.removeEventListener('abort', cancel); });
        return this.pending;
    }
    /** Supply only a unique, hash-contiguous prefix for the actual first depicted frame. */
    history(live: readonly Chunk[], selected: Chunk, depictedTick: number): Chunk[] {
        if (this.state !== 'ready')
            return [...live];
        const required = Math.max(0, depictedTick - this.requiredSeconds / selected.take.dt);
        if (this.cachedLive === live && this.cachedSelected === selected && required >= this.cachedRequired)
            return this.cachedHistory;
        const byStart = new Map<number, Chunk>();
        for (const c of [...this.saved, ...live]) {
            const old = byStart.get(c.fromTick);
            if (old && identity(old) !== identity(c)) {
                this.state = 'legacy';
                return [...live];
            }
            byStart.set(c.fromTick, c);
        }
        const all = [...byStart.values()].sort((a, b) => a.fromTick - b.fromTick), at = all.findIndex(c => identity(c) === identity(selected));
        if (at < 0) {
            this.state = 'legacy';
            return [...live];
        }
        let lo = at;
        while (lo > 0 && adjacent(all[lo - 1], all[lo]))
            lo--;
        if (all[lo].fromTick > required) {
            this.state = 'legacy';
            return [...live];
        }
        const out = all.filter(c => c.toTick >= required && c.fromTick <= selected.toTick);
        // The socket's own bounded history replaces the initial supplement naturally.
        this.saved = all.filter(c => c.toTick >= required).slice(-14);
        this.cachedLive = live;
        this.cachedSelected = selected;
        this.cachedRequired = required;
        this.cachedHistory = out;
        return out;
    }
}
