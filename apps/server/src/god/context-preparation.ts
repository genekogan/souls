import { createHash } from 'node:crypto';
import type { GodMode } from './god.ts';
import type { WorldModel } from '@souls/world-compiler';
import { contextTargetRows, transientDef, type ContextTarget } from './context-view-scene.ts';
import { withoutHidden } from '../moderation/routes.ts';
import { contextStage, contextTiming } from './context-timing.ts';

/** One cooperative job, never an idle poll. The owner checks its frontier at every yield. */
export class ContextPreparation {
    private started = performance.now();
    private maxAtomic = 0;
    private maxSlice = 0;
    private check: () => void;
    private signal: AbortSignal;
    private budgetMs: number;
    constructor(check: () => void, signal: AbortSignal, budgetMs = 4) { this.check = check; this.signal = signal; this.budgetMs = budgetMs; }
    guard() { this.signal.throwIfAborted(); this.check(); }
    work<T>(run: () => T): T {
        const start = performance.now();
        try { return run(); } finally { this.maxAtomic = Math.max(this.maxAtomic, performance.now() - start); }
    }
    finish() {
        this.guard();
        this.maxSlice = Math.max(this.maxSlice, performance.now() - this.started);
        contextTiming('prepare.max-atomic', this.maxAtomic);
        contextTiming('prepare.max-slice', this.maxSlice);
    }
    step(): Promise<void> | undefined {
        if (performance.now() - this.started < this.budgetMs) return;
        this.guard();
        this.maxSlice = Math.max(this.maxSlice, performance.now() - this.started);
        return new Promise<void>(resolve => setImmediate(resolve)).then(() => {
            this.guard();
            this.started = performance.now();
        });
    }
}

export async function prepareContextTargets(model: WorldModel, job: ContextPreparation, artBasePath?: string) {
    job.guard();
    const targets: ContextTarget[] = [];
    const rows = contextTargetRows(model, artBasePath);
    for (;;) {
        const next = job.work(() => rows.next());
        if (next.done) break;
        targets.push(next.value);
        const pause = job.step(); if (pause) { await pause; job.guard(); }
    }
    job.guard();
    return job.work(() => targets.sort((a, b) => a.ref.localeCompare(b.ref)));
}

/** Engine writes replace entity/state rows through applyBatch; definitions are content addressed.
 * publicSnapshot captures their references together before the first yield. We then detach each
 * row, never revisit live entity data, and discard on an authored/moderation frontier change. */
export function captureContextFrontier(god: GodMode, scene: boolean) {
    // No await between model and public snapshot: both refer to exactly this model frontier.
    const model = contextStage('prepare.model-fork', () => god.model.fork());
    const snapshot = scene ? contextStage('prepare.frontier', () => god.publicSnapshot()) : undefined;
    return { model, snapshot };
}
export async function prepareContextScene(god: GodMode, hidden: Set<string>, job: ContextPreparation, captured = captureContextFrontier(god, true)) {
    job.guard();
    const frontier = captured.snapshot!;
    const filtered = hidden.size ? contextStage('prepare.moderation', () => withoutHidden(frontier, hidden)) : frontier;
    const { entities: sourceEntities, defs: sourceDefs, ...header } = filtered;
    const snapshot = {
        ...contextStage('prepare.header', () => structuredClone(header)),
        defs: [] as typeof sourceDefs,
        entities: [] as typeof sourceEntities,
    };
    const excluded = new Set<string>(), children = new Map<string, string[]>();
    const mentionsHidden = (value: unknown) => hidden.size > 0 && (JSON.stringify(value ?? null).match(/[a-f0-9]{64}/g) ?? []).some(sha => hidden.has(sha));
    // Resolve transient status before yielding away from the immutable definition frontier.
    const transientDefs = new Set([...new Set(sourceEntities.map(entity => entity.def))].filter(ref => transientDef(captured.model.resolvedDef(ref))));
    for (const entity of sourceEntities) {
        const list = children.get(entity.in.parent) ?? [];
        list.push(entity.id); children.set(entity.in.parent, list);
        if (entity.id.startsWith('h_') || transientDefs.has(entity.def) || mentionsHidden(entity.state) || mentionsHidden(entity.params)) excluded.add(entity.id);
        const pause = job.step(); if (pause) { await pause; job.guard(); }
    }
    const pending = [...excluded];
    for (let i = 0; i < pending.length; i++) {
        for (const child of children.get(pending[i]) ?? []) if (!excluded.has(child)) { excluded.add(child); pending.push(child); }
        const pause = job.step(); if (pause) { await pause; job.guard(); }
    }
    for (const def of sourceDefs) {
        snapshot.defs.push(job.work(() => structuredClone(def)));
        const pause = job.step(); if (pause) { await pause; job.guard(); }
    }
    for (const entity of sourceEntities) {
        if (!excluded.has(entity.id)) {
            const copy = job.work(() => structuredClone(entity));
            copy.state = { ...copy.state, ...(copy.state && 'doors' in copy.state ? { doors: {} } : {}) };
            snapshot.entities.push(copy);
        }
        const pause = job.step(); if (pause) { await pause; job.guard(); }
    }
    snapshot.state = { ...snapshot.state, sky: { palette: 'clear-day', sun: .6 }, time: { dayTicks: 72000, startTick: 0, paused: true }, weather: { kind: 'clear', intensity: 1, clouds: 0, wind: 0, rain: 0, fog: 0 } };
    snapshot.builds = []; snapshot.buildsRev = 0; snapshot.now = 0; snapshot.tick = 0;
    // Same JSON object property order and omission rules as contextScene. Large arrays are
    // serialized one row at a time rather than allocating/stringifying the complete scene.
    const hash = createHash('sha256');
    hash.update('{');
    let comma = false;
    for (const [key, value] of Object.entries({ moderation: [...hidden].sort(), groundAppearance: snapshot.state.ground, constants: snapshot.constants, ground: snapshot.ground })) {
        const json = job.work(() => JSON.stringify(value));
        if (json !== undefined) { hash.update((comma ? ',' : '') + JSON.stringify(key) + ':' + json); comma = true; }
        const pause = job.step(); if (pause) { await pause; job.guard(); }
    }
    hash.update((comma ? ',' : '') + '"defs":[');
    for (let i = 0; i < snapshot.defs.length; i++) {
        hash.update((i ? ',' : '') + job.work(() => JSON.stringify(snapshot.defs[i])));
        const pause = job.step(); if (pause) { await pause; job.guard(); }
    }
    hash.update('],"entities":[');
    for (let i = 0; i < snapshot.entities.length; i++) {
        const { about, name, v, by, born, ...entity } = snapshot.entities[i];
        hash.update((i ? ',' : '') + job.work(() => JSON.stringify(entity)));
        const pause = job.step(); if (pause) { await pause; job.guard(); }
    }
    hash.update(']}');
    job.guard();
    job.finish();
    return { snapshot, key: hash.digest('hex'), revision: frontier.seq };
}
