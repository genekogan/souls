import { test } from 'node:test';
import { hashOf } from '../../../mars/viewer/engine/core/hash.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HumanoidKit } from '../src/humanoid/compose.ts';
import { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../../../mars/viewer/engine/api/registry.ts';
import { Spatial } from '../../../mars/viewer/engine/spatial/service.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../../../mars/viewer/engine/world/factory.ts';
import { openGround } from '../../../mars/viewer/engine/test/frame-fixtures.ts';
import { itemEntity, graspPoint, reachStation } from '../../../mars/viewer/engine/items/model.ts';
import { sampleTake } from '../../../mars/viewer/engine/take/replay.ts';
import { TakeRecorder } from '../../../mars/viewer/engine/take/recorder.ts';
import { TakePeople } from '../../../mars/viewer/app/engine-view/take-replay.ts';
const DT = .05;
type Placement = {
    yaw: number;
    origin: [
        number,
        number
    ];
    def: string;
};
const placements: Placement[] = [{ yaw: 0, origin: [0, 0], def: 'table-6ft' }, { yaw: 1.2, origin: [3, -2], def: 'table-6ft' }, { yaw: 0, origin: [0, 0], def: 'eden-commons-table' }, { yaw: Math.PI / 2, origin: [-3, 2], def: 'eden-commons-table' }];
function run(marked = true, placement = placements[0]) {
    const { yaw, origin, def } = placement;
    const point = (x: number, z: number) => [origin[0] + x * Math.cos(yaw) - z * Math.sin(yaw), origin[1] + x * Math.sin(yaw) + z * Math.cos(yaw)] as [
        number,
        number
    ];
    const ap = point(1.28, .15), ip = point(.44, .15);
    const scene = openGround(), w = addAll(emptyWorld('counter-station', scene), { id: 'counter', kind: 'fixture', def, pose: { p: [origin[0], 0, origin[1]], yaw }, provenance: FIXTURE, support: { kind: 'ground' } }, human('a', ap[0], ap[1], { yaw }));
    const item = itemEntity('bowl', 'bowl', [ip[0], .75, ip[1]], yaw);
    item.tags = ['entity-world', 'entity-world-item-pose'];
    item.support = { kind: 'resting-on', on: 'counter', slot: 'r0c0' };
    delete item.phase;
    w.entities.bowl = item;
    const rt = new Runtime(w, createRegistry(), { spatial: new Spatial(scene) }, ENGINE_INVARIANTS), target = graspPoint(item), preferred = reachStation(rt, w.entities.a, target, w.entities.counter, 'bowl', .3);
    assert.ok(!('code' in preferred));
    const rec = new TakeRecorder(rt, { rulesVersion: 'counter-audit' }), action = rt.submit('take_item', { actor: 'a', item: 'bowl', hand: 'right', ...(marked ? { reachPolicy: 'short-station-v1' } : {}) });
    assert.equal(action.status, 'executing', JSON.stringify(action));
    const snapshots = new Map<number, ReturnType<Runtime['snapshot']>>();
    const hashes: {
        tick: number;
        world: string;
        events: string;
    }[] = [];
    let contactTick = -1, reach = 0, reachRoot: number[] = [];
    for (let k = 0; k < 300; k++) {
        const old = item.support?.kind;
        rt.step();
        hashes.push({ tick: rt.tick, world: rt.stateHash(), events: hashOf(rt.events) });
        if ([15, 40, 80].includes(rt.tick))
            snapshots.set(rt.tick, JSON.parse(JSON.stringify(rt.snapshot())));
        if (item.support?.kind === 'in-hand' && old !== 'in-hand') {
            contactTick = rt.tick;
            reachRoot = [...w.entities.a.pose.p];
            reach = Math.hypot(target[0] - reachRoot[0], target[2] - reachRoot[2]);
        }
    }
    assert.equal(action.status as string, 'completed');
    assert.deepEqual(rt.violations, []);
    assert.ok(contactTick > 0);
    for (const [tick, snapshot] of snapshots) {
        const restored = Runtime.restore(snapshot, createRegistry(), { spatial: new Spatial(scene) }, ENGINE_INVARIANTS);
        for (let k = tick + 1; k <= tick + 20; k++) {
            restored.step();
            assert.equal(restored.stateHash(), hashes[k - 1].world, 'active snapshot continuation');
        }
    }
    const take = rec.finish();
    for (const tick of [contactTick - 1, contactTick, contactTick + 1])
        assert.equal(sampleTake(take, tick * DT).entities.bowl.state.support?.kind, tick < contactTick ? 'resting-on' : 'in-hand', 'recorded contact custody tick');
    return { take, target, preferred, reach, reachRoot, contactTick, traceHash: hashOf(hashes) };
}
for (const placement of placements)
    for (const frame of ['masc', 'fem'] as const)
        test(`supported counter pickup ${frame}/${placement.def}/${placement.yaw}: use existing shorter admitted station`, async () => {
            const r = run(true, placement), kit = new HumanoidKit(new GLTFLoader(), '/modular/humanoid/', async (url) => { const b = readFileSync(new URL('../../../mars/viewer/public' + url, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; }), tpl = await kit.template({ frame, preset: frame === 'masc' ? 'casual' : 'woman' }), view = new TakePeople(r.take);
            view.setTemplates([tpl]);
            let drop = 0, kneel = 0, bend = 0, contactError = 0, maxStep = 0, transitionStep = 0, yawRelativeStep = 0, previousLocal: number[][] | undefined, maxAt: unknown = null, transitionAt: unknown = null, previousWalk = 0, previousRoot: number[] | undefined, previousYaw = 0, prev: number[][] | undefined;
            for (let tick = r.take.startTick; tick <= r.take.startTick + r.take.ticks; tick++) {
                view.show((tick - r.take.startTick) * DT, tick * DT);
                const b = view.bones().a;
                if (!b)
                    continue;
                drop = Math.max(drop, b.pose.drop);
                kneel = Math.max(kneel, b.pose.kneel);
                bend = Math.max(bend, b.pose.bend);
                const palms = b.arms.map(a => a.palm.map((x, i) => x - (i === 0 ? view.frame!.entities.a.p[0] : i === 1 ? view.frame!.entities.a.p[1] : view.frame!.entities.a.p[2])));
                const yaw = view.frame!.entities.a.yaw, local = palms.map(p => [p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), p[1], -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw)]);
                const walk = view.gait().a?.walk ?? 0;
                if (previousLocal && !(walk >= .9 && previousWalk >= .9))
                    for (let i = 0; i < local.length; i++)
                        yawRelativeStep = Math.max(yawRelativeStep, Math.hypot(...local[i].map((x, j) => x - previousLocal![i][j])));
                previousLocal = local;
                if (prev)
                    for (let i = 0; i < palms.length; i++) {
                        const step = Math.hypot(...palms[i].map((x, j) => x - prev![i][j]));
                        if (!(walk >= .9 && previousWalk >= .9) && step > transitionStep) {
                            transitionStep = step;
                            transitionAt = { tick, hand: b.arms[i].side, activity: view.frame!.entities.a.activity, walk, previousWalk, root: view.frame!.entities.a.p, previousRoot, yaw: view.frame!.entities.a.yaw, previousYaw, palm: palms[i], previousPalm: prev![i] };
                        }
                        if (step > maxStep) {
                            maxStep = step;
                            maxAt = { tick, activity: view.frame!.entities.a.activity, speed: view.frame!.entities.a.speed, walk: view.gait().a?.walk };
                        }
                    }
                ;
                prev = palms;
                previousWalk = walk;
                previousRoot = [...view.frame!.entities.a.p];
                previousYaw = view.frame!.entities.a.yaw;
                if (tick === r.contactTick)
                    contactError = Math.hypot(...b.arms.find(a => a.side === 'right')!.palm.map((x, i) => x - r.target[i]));
            }
            const preferredReach = Math.hypot(r.target[0] - r.preferred.p[0], r.target[2] - r.preferred.p[1]);
            console.log(JSON.stringify({ frame, placement, traceHash: r.traceHash, reach: r.reach, preferredReach, reachRoot: r.reachRoot, contactTick: r.contactTick, drop, kneel, bend, contactError, maxStep, transitionStep, yawRelativeStep, maxAt, transitionAt }));
            assert.ok(r.reach <= preferredReach + 1e-6, 'pickup bypassed existing shorter admitted station');
            assert.ok(contactError <= .02, 'existing actual-rig contact bound');
            assert.ok(yawRelativeStep <= .08, 'unchanged M04 non-full-stride body-coordinate palm bound; world-axis turn metrics reported separately');
            assert.ok(drop <= .03 && kneel === 0, 'shorter supported standing reach avoids unnecessary dip');
        });
test('absent reach policy retains the pinned pre-edit world/event trace', () => { const r = run(false); assert.equal(r.traceHash, 'e3ad8d0100634fbbf42d7b7e00e18680bfa00579523b7b771e53494d66d5e88a'); assert.equal(r.reach, .8400000000000001); });
// Rigidly rotating and translating an observed rig frame must leave its body-coordinate displacement invariant.
test('body-coordinate displacement is invariant under an independent rigid world transform', async () => {
    const r = run(), kit = new HumanoidKit(new GLTFLoader(), '/modular/humanoid/', async (url) => { const b = readFileSync(new URL('../../../mars/viewer/public' + url, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; }), tpl = await kit.template({ frame: 'masc', preset: 'casual' }), view = new TakePeople(r.take);
    view.setTemplates([tpl]);
    let error = 0;
    const theta = 1.37, c = Math.cos(theta), s = Math.sin(theta), shift = [4, 1.4, -3];
    for (let tick = 0; tick <= r.take.ticks; tick++) {
        view.show(tick * DT, tick * DT);
        const e = view.frame!.entities.a, b = view.bones().a;
        for (const arm of b.arms) {
            const original = arm.palm.map((x, i) => x - e.p[i]), rotated = [c * arm.palm[0] - s * arm.palm[2] + shift[0], arm.palm[1] + shift[1], s * arm.palm[0] + c * arm.palm[2] + shift[2]], root = [c * e.p[0] - s * e.p[2] + shift[0], e.p[1] + shift[1], s * e.p[0] + c * e.p[2] + shift[2]], q = rotated.map((x, i) => x - root[i]), yaw = e.yaw + theta;
            const a = [original[0] * Math.cos(e.yaw) + original[2] * Math.sin(e.yaw), original[1], -original[0] * Math.sin(e.yaw) + original[2] * Math.cos(e.yaw)], z = [q[0] * Math.cos(yaw) + q[2] * Math.sin(yaw), q[1], -q[0] * Math.sin(yaw) + q[2] * Math.cos(yaw)];
            error = Math.max(error, Math.hypot(...a.map((x, i) => x - z[i])));
        }
    }
    console.log(JSON.stringify({ case: 'rigid-coordinate-invariance', samples: r.take.ticks + 1, error }));
    assert.ok(error < 1e-12);
});
test('blocked counter stations refuse by name without moving or acquiring the bowl', () => {
    const scene = openGround();
    scene.obstacles = [{ id: 'north-wall', label: 'north wall', obb: { c: [0, .8], half: [1.8, .3], yaw: 0 }, y0: 0, y1: 3 }, { id: 'south-wall', label: 'south wall', obb: { c: [0, -.8], half: [1.8, .3], yaw: 0 }, y0: 0, y1: 3 }, { id: 'east-wall', label: 'east wall', obb: { c: [1.3, 0], half: [.3, 1.4], yaw: 0 }, y0: 0, y1: 3 }, { id: 'west-wall', label: 'west wall', obb: { c: [-1.3, 0], half: [.3, 1.4], yaw: 0 }, y0: 0, y1: 3 }];
    const w = addAll(emptyWorld('blocked-counter', scene), { id: 'counter', kind: 'fixture', def: 'table-6ft', pose: { p: [0, 0, 0], yaw: 0 }, provenance: FIXTURE, support: { kind: 'ground' } }, human('a', 3, 0)), item = itemEntity('bowl', 'bowl', [.44, .75, .15]);
    item.tags = ['entity-world-item-pose'];
    item.support = { kind: 'resting-on', on: 'counter', slot: 'r0c0' };
    delete item.phase;
    w.entities.bowl = item;
    const rt = new Runtime(w, createRegistry(), { spatial: new Spatial(scene) }, ENGINE_INVARIANTS), before = rt.stateHash(), a = rt.submit('take_item', { actor: 'a', item: 'bowl', hand: 'right', reachPolicy: 'short-station-v1' });
    assert.equal(a.status, 'failed');
    assert.equal(a.diagnostic?.code, 'item.unreachable');
    assert.match(a.diagnostic!.message, /bowl.*counter/);
    assert.ok(a.diagnostic?.subjects?.some(x => x.endsWith('-wall')));
    assert.equal(rt.stateHash(), before);
    assert.equal(item.support.kind, 'resting-on');
    assert.deepEqual(rt.holder('actor:a'), []);
    console.log(JSON.stringify({ case: 'blocked', diagnostic: a.diagnostic }));
});
for (const eligible of [true, false])
    test(`nearby current point eligibility ${eligible}: native station branch`, () => {
        const scene = openGround(), a = human('a', 1.04, .25), w = addAll(emptyWorld('current-counter', scene), { id: 'counter', kind: 'fixture', def: 'eden-commons-table', pose: { p: [0, 0, 0], yaw: 0 }, provenance: FIXTURE, support: { kind: 'ground' } }, a), item = itemEntity('bowl', 'bowl', [.44, .75, .15]);
        item.tags = ['entity-world-item-pose'];
        item.support = { kind: 'resting-on', on: 'counter', slot: 'r0c0' };
        delete item.phase;
        w.entities.bowl = item;
        // An authored non-still admission state checks the shortcut predicate; the native child owns any subsequent motion.
        if (!eligible)
            a.human!.activity = 'operate';
        const rt = new Runtime(w, createRegistry(), { spatial: new Spatial(scene) }, ENGINE_INVARIANTS), initial = [...a.pose.p], r = rt.submit('take_item', { actor: 'a', item: 'bowl', hand: 'right', reachPolicy: 'short-station-v1' });
        assert.equal(r.status, 'executing', JSON.stringify(r));
        const walks = [...rt.records.values()].filter(x => x.parent === r.id && x.verb === 'walk_to');
        assert.equal(walks.length, eligible ? 0 : 1, 'existing still-standing predicate controls nearby shortcut');
        let movement = 0;
        for (let k = 0; k < 200; k++) {
            rt.step();
            movement = Math.max(movement, Math.hypot(a.pose.p[0] - initial[0], a.pose.p[2] - initial[2]));
        }
        assert.equal(r.status as string, 'completed');
        assert.deepEqual(rt.violations, []);
        if (eligible)
            assert.equal(movement, 0);
        else
            assert.ok(movement > .05);
        console.log(JSON.stringify({ case: 'current-point', eligible, walkChildren: walks.length, movement }));
    });
