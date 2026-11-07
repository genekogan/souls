import type { GodMode } from './god.ts';
import type { Entity, WorldModel } from '@souls/world-compiler';
import { contextHash } from './context-view-cache.ts';
import { humanTitle, meaningParts } from './meaning.ts';
import { withoutHidden } from '../moderation/routes.ts';
import { inPoly } from './places.ts';
import { contextOriginal, type ContextOriginal } from './context-original-art.ts';
export type ContextTarget = {
    ref: string;
    entity: string;
    part?: string;
    scope?: 'entity' | 'room' | 'slot' | 'point' | 'region';
    slot?: string;
    title: string;
    what?: string;
    aliases?: string[];
    kind?: string;
    role?: string;
    level?: number;
    stand?: [
        number,
        number,
        number
    ];
    point: [
        number,
        number,
        number
    ];
    radius: number;
    viewpoint?: {
        eye: [
            number,
            number,
            number
        ];
        at: [
            number,
            number,
            number
        ];
    };
    region?: [
        number,
        number
    ][];
    front?: { direction: [number, number, number]; source: 'declared-front' | 'entrance'; ambiguous?: boolean; alternatives?: [number, number, number][] };
    original?: ContextOriginal;
};
export function localContextPoint(m: WorldModel, e: Entity, p: readonly number[]): [
    number,
    number,
    number
] { const w = m.worldPose(e), c = Math.cos(w.yaw), s = Math.sin(w.yaw); return [w.x + (p[0] * c + p[2] * s) * w.s, w.y + p[1] * w.s, w.z + (-p[0] * s + p[2] * c) * w.s]; }
/** Authored direction is owner-local; an entity yaw alone never establishes a front. */
export function contextFront(m: WorldModel, owner: Entity, declared = owner.about?.front): ContextTarget['front'] {
    const pose = m.worldPose(owner);
    if (declared) {
        const [x, z] = declared, c = Math.cos(pose.yaw), s = Math.sin(pose.yaw), length = Math.hypot(x, z);
        return { direction: [(x * c + z * s) / length, 0, (-x * s + z * c) / length], source: 'declared-front' };
    }
    const def = m.resolvedDef(owner.def);
    if (!def) return undefined;
    const entrances = (m.bake(def, owner.params ?? {}, owner.seed ?? 0, owner.shape).openings ?? [])
        .filter(opening => opening.exterior && ['door', 'gate', 'arch'].includes(opening.kind));
    const directions: [number, number, number][] = [];
    for (const entrance of entrances) {
        const yaw = pose.yaw + entrance.yaw, direction: [number, number, number] = [Math.sin(yaw), 0, Math.cos(yaw)];
        if (!directions.some(existing => Math.hypot(existing[0] - direction[0], existing[2] - direction[2]) < .01)) directions.push(direction);
    }
    return directions.length ? { direction: directions[0], source: 'entrance', ...(directions.length > 1 ? { ambiguous: true, alternatives: directions.slice(1) } : {}) } : undefined;
}
/** Stable refs use entity ids, never rename-sensitive paths. No invented binding for an unanchored description. */
export function transientDef(d: ReturnType<WorldModel['resolvedDef']>) { return !!d && (!!d.components.body || !!d.components.carryable || d.tags?.some(t => ['creature', 'animal', 'animals', 'creature-group'].includes(t)) || d.make?.kind === 'gen' && d.make.gen === 'animals/1'); }
export function* contextTargetRows(m: WorldModel, artBasePath?: string): Generator<ContextTarget> {
    for (const e of m.entities.values()) {
        const d = m.resolvedDef(e.def);
        if (!d || e.id.startsWith('h_') || transientDef(d))
            continue;
        const p = m.worldPose(e), box = d.size.box, point: [
            number,
            number,
            number
        ] = [p.x, p.y + box[1] * p.s / 2, p.z], radius0 = Math.max(.5, Math.hypot(box[0], box[2]) * p.s / 2);
        const area = e.shape && 'area' in e.shape ? e.shape.area : undefined;
        let radius = radius0;
        if (area?.length) {
            point[0] = area.reduce((n, p) => n + p[0], 0) / area.length;
            point[2] = area.reduce((n, p) => n + p[1], 0) / area.length;
            point[1] = Number(e.params?.level ?? 0);
            radius = Math.max(...area.map(q => Math.hypot(q[0] - point[0], q[1] - point[2])));
        }
        const view = (v: {
            eye: number[];
            at: number[];
        } | undefined) => v ? { eye: localContextPoint(m, e, v.eye), at: localContextPoint(m, e, v.at) } : undefined;
        const original = contextOriginal(e.state?.media, artBasePath);
        const base: ContextTarget = { front: e.about?.front ? contextFront(m, e) : undefined, ref: e.id, entity: e.id, title: e.about?.title ?? humanTitle(m.pathOf(e.id)), ...(e.about?.what ? { what: e.about.what } : {}), aliases: e.about?.aliases, kind: e.about?.kind, role: e.about?.role, point, radius, ...(area ? { region: area } : {}), ...(e.about?.viewpoint ? { viewpoint: view(e.about.viewpoint) } : {}), ...(original ? { original } : {}) };
        yield base;
        for (const part of meaningParts(m, e.id)) {
            if (!part.target)
                continue;
            const bound = part.target.entity ? m.entities.get(part.target.entity) : e;
            if (!bound)
                continue;
            const q = m.worldPose(bound), slot = part.target.slot ? m.slotsOf(bound).find(s => s.id === part.target!.slot) : undefined;
            const at = part.target.point ?? (slot ? localContextPoint(m, bound, slot.p) : [q.x, q.y + Math.max(.4, m.resolvedDef(bound.def)?.size.box[1] ?? 1) / 2, q.z] as [
                number,
                number,
                number
            ]);
            yield { ...base, ref: `${e.id}/part/${part.id}`, entity: bound.id, part: part.id, scope: part.anchor?.kind === 'entity' ? slot ? slot.kind === 'room' ? 'room' : 'slot' : 'entity' : part.target.region ? 'region' : 'point', title: part.title, what: part.what, aliases: part.aliases, point: at, level: part.target.level, stand: part.target.stand, radius: slot?.kind === 'seat' ? 1 : Math.min(radius, 3), viewpoint: view(part.viewpoint), front: part.front ? contextFront(m, e, part.front) : bound.about?.front ? contextFront(m, bound) : undefined, region: part.target.region, original: undefined, ...(slot ? { slot: slot.id } : {}) };
        }
        for (const slot of m.slotsOf(e).filter(s => s.kind === 'room')) {
            const declaration = e.about?.parts?.find(part => part.anchor?.kind === 'entity' && part.anchor.ref === e.id && part.anchor.slot === slot.id);
            yield { ...base, ref: `${e.id}/slot/${slot.id}`, slot: slot.id, title: declaration?.title ?? `${base.title} / ${humanTitle(slot.id)}`, point: localContextPoint(m, e, [slot.p[0], slot.p[1] + 1.2, slot.p[2]]), radius: Math.max(1, ...(slot.polygon ?? []).map(p => Math.hypot(...p))), viewpoint: view(declaration?.viewpoint), original: undefined };
        }
    }
}
export function contextTargets(m: WorldModel, artBasePath?: string): ContextTarget[] { return [...contextTargetRows(m, artBasePath)]; }
export type ContextRoom = { polygon: [number, number][]; floor: number; ceiling: number };
/** Real room polygon and vertical span in world coordinates; grouping alone is not enclosure. */
export function contextRoom(m: WorldModel, target: ContextTarget): ContextRoom | undefined {
    let entity = m.entities.get(target.entity);
    const roomFor = (owner: Entity, slot: ReturnType<WorldModel['slotsOf']>[number]): ContextRoom | undefined => {
        if (slot.kind !== 'room' || !slot.polygon?.length || slot.height === undefined) return undefined;
        const floor = localContextPoint(m, owner, slot.p)[1];
        return { polygon: slot.polygon.map(([x, z]) => { const point = localContextPoint(m, owner, [slot.p[0] + x, slot.p[1], slot.p[2] + z]); return [point[0], point[2]]; }), floor, ceiling: floor + slot.height * m.worldPose(owner).s };
    };
    if (!entity) return undefined;
    if (target.slot) {
        const slot = m.slotsOf(entity).find(slot => slot.id === target.slot);
        if (slot?.kind === 'room') return roomFor(entity, slot);
    }
    const visited = new Set<string>();
    while (entity && entity.in.parent !== 'world' && !visited.has(entity.id)) {
        visited.add(entity.id);
        const parent = m.entities.get(entity.in.parent);
        if (!parent) break;
        for (const slot of m.slotsOf(parent)) {
            const room = roomFor(parent, slot);
            if (room && target.point[1] >= room.floor - .01 && target.point[1] < room.ceiling && inPoly(target.point[0], target.point[2], room.polygon)) return room;
        }
        entity = parent;
    }
    return undefined;
}
/** A container or a camera does not prove enclosure. Only a real room slot does. */
export function contextEnclosed(m: WorldModel, target: ContextTarget): boolean {
    return contextRoom(m, target) !== undefined;
}
/** Metadata visibility uses entity/definition facts, without cloning or hashing a render scene. */
export function contextVisibleEntityIds(god: GodMode, hidden: Set<string>): Set<string> {
    // Reuse the established moderation dependency traversal when a hidden asset exists.
    const entities = hidden.size ? withoutHidden(god.publicSnapshot(), hidden).entities : [...god.model.entities.values()];
    const mentionsHidden = (value: unknown) => hidden.size > 0 && (JSON.stringify(value ?? null).match(/[a-f0-9]{64}/g) ?? []).some(sha => hidden.has(sha));
    const excluded = new Set(entities.filter(e => mentionsHidden(e.state) || mentionsHidden(e.params) || e.id.startsWith('h_') || transientDef(god.model.resolvedDef(e.def))).map(e => e.id));
    for (let changed = true; changed;) {
        changed = false;
        for (const e of entities)
            if (excluded.has(e.in.parent) && !excluded.has(e.id)) {
                excluded.add(e.id);
                changed = true;
            }
    }
    return new Set(entities.filter(entity => !excluded.has(entity.id)).map(entity => entity.id));
}
/** Snapshot detached synchronously, then rendered without a socket or live clock. */
export function contextScene(god: GodMode, hidden: Set<string>) {
    const snapshot = structuredClone(withoutHidden(god.publicSnapshot(), hidden));
    const visible = contextVisibleEntityIds(god, hidden);
    snapshot.entities = snapshot.entities.filter(e => visible.has(e.id)).map(e => ({ ...e, state: { ...e.state, ...(e.state && 'doors' in e.state ? { doors: {} } : {}) } }));
    snapshot.state = { ...snapshot.state, sky: { palette: 'clear-day', sun: .6 }, time: { dayTicks: 72000, startTick: 0, paused: true }, weather: { kind: 'clear', intensity: 1, clouds: 0, wind: 0, rain: 0, fog: 0 } };
    snapshot.builds = [];
    snapshot.buildsRev = 0;
    snapshot.now = 0;
    snapshot.tick = 0;
    const pixels = { moderation: [...hidden].sort(), groundAppearance: snapshot.state.ground, constants: snapshot.constants, ground: snapshot.ground, defs: snapshot.defs, entities: snapshot.entities.map(({ about, name, v, by, born, ...e }) => e) };
    return { snapshot, key: contextHash(pixels), revision: god.model.editSeq };
}
