import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WorldMotionHistory } from '../src/WorldMotionHistory.ts';
import { TakePeople } from '../../../mars/viewer/app/engine-view/take-replay.ts';
import { templateFromGltf } from '../../../mars/viewer/app/engine-view/people.ts';
import { CHARACTER_WIRE } from '../../../mars/viewer/app/engine-view/character-wire.ts';
import { Runtime } from '../../../mars/viewer/engine/runtime/runtime.ts';
import { Spatial } from '../../../mars/viewer/engine/spatial/service.ts';
import { emptyWorld, human } from '../../../mars/viewer/engine/world/factory.ts';
import { TakeRecorder } from '../../../mars/viewer/engine/take/recorder.ts';
import { openGround } from '../../../mars/viewer/engine/test/frame-fixtures.ts';
import { poseV1 } from '../../../mars/viewer/engine/social/pose.ts';
const DT = .05, ID = 'cold_join_wave';
async function glb(file: string) { const s = readFileSync(new URL('../../../mars/viewer/public/modular/environment/' + file, import.meta.url)), n = s.readUInt32LE(12), j = JSON.parse(s.subarray(20, 20 + n).toString()), bin = s.subarray(20 + n); j.materials = j.materials?.map(() => ({ pbrMetallicRoughness: { baseColorFactor: [.5, .5, .5, 1] } })); delete j.textures; delete j.images; delete j.samplers; let b = Buffer.from(JSON.stringify(j)); b = Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4, 32)]); const h = Buffer.from(s.subarray(0, 20)); h.writeUInt32LE(20 + b.length + bin.length, 8); h.writeUInt32LE(b.length, 12); const out = Buffer.concat([h, b, bin]); return new GLTFLoader().parseAsync(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), ''); }
const template = (async () => { const wire = CHARACTER_WIRE.casual, g = await glb(wire.mesh); g.animations = (await glb(wire.clips)).animations; return templateFromGltf('cold-join-casual', g); })();
function recording(early = false, reentry = false) { const scene = openGround(), w = emptyWorld('cold-join', scene); w.entities[ID] = human(ID, 0, 0); const rt = new Runtime(w, new Map([[poseV1.verb, poseV1]]), { spatial: new Spatial(scene) }, []), all = new TakeRecorder(rt, { rulesVersion: 'cold-join-v1' }); let rec = new TakeRecorder(rt, { rulesVersion: 'cold-join-v1' }), action: ReturnType<Runtime['submit']> | undefined; const chunks: {
    fromTick: number;
    toTick: number;
    take: ReturnType<TakeRecorder['finish']>;
}[] = []; for (let k = 0; k < 600; k++) {
    if (k === 100 || reentry && k === 112) {
        action = rt.submit('pose_v1', { actor: ID, activity: 'wave', seconds: 2.5 });
        assert.equal(action.status, 'executing');
    }
    if ((early && k === 106) || (reentry && k === 118))
        rt.cancel(action!.id);
    rt.step();
    if (rt.tick % 20 === 0) {
        const take = rec.finish();
        chunks.push({ fromTick: take.startTick, toTick: take.startTick + take.ticks, take });
        if (rt.tick < 600)
            rec = new TakeRecorder(rt, { rulesVersion: 'cold-join-v1' });
    }
} assert.deepEqual(rt.violations, []); return { take: all.finish(), chunks }; }
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((x, i) => x - b[i]));
for (const [early, reentry] of [[false, false], [true, false], [true, true]])
    test(`actual native wave cold join early=${early} reentry=${reentry}: socket prefix and delayed depiction`, async () => {
        const r = recording(early, reentry), end = reentry ? 118 : early ? 106 : 150, server = Math.ceil((end + 50) / 20) * 20, depicted = server - 30, hot = (at: number) => r.chunks.filter(c => c.toTick <= at).slice(-12), socket = (at: number) => hot(at).filter(c => c.toTick > at - 40), selected = (at: number) => r.chunks.find(c => at >= c.fromTick && at < c.toTick)!;
        const full = new TakePeople(r.take);
        full.setTemplates([await template]);
        full.show(depicted * DT, depicted * DT);
        const own = selected(depicted), short = new TakePeople(own.take);
        short.setTemplates([await template]);
        short.setWaterHistory(socket(server).map(c => c.take));
        short.show((depicted - own.fromTick) * DT, depicted * DT);
        const before = Math.max(...full.bones(ID)[ID].arms.map((a, i) => distance(a.palm, short.bones(ID)[ID].arms[i].palm)));
        assert.ok(before > .0003, 'actual old socket prefix violates the existing0.3mm fresh-wave equivalence bound');
        let requests = 0, bytes = 0, release!: () => void;
        const pending = new Promise<void>(r => release = r), ctl = new AbortController(), history = new WorldMotionHistory(async (from, to, limit) => { requests++; await pending; const chunks = hot(server + 4).filter(c => c.toTick > from && c.fromTick < to).slice(0, limit); bytes = JSON.stringify({ chunks, next: null }).length; return chunks; }, ctl.signal), loading = history.start(socket(server), server, 30, 'world/epoch', () => 'world/epoch');
        assert.equal(history.start(socket(server), server, 30, 'world/epoch', () => 'world/epoch'), loading);
        assert.equal(history.loading, true);
        release();
        await loading;
        let after = 0, maxChunks = 0;
        for (let tick = depicted + 4; tick <= depicted + 270; tick += 5) {
            for (const fraction of [0, .25, .75]) {
                const t = tick + fraction, c = selected(t), prefix = history.history(socket(t + 30), c, t);
                assert.equal(history.enabled, true, 'bounded rolling history remains usable beyond12 seconds');
                maxChunks = Math.max(maxChunks, prefix.length);
                const fresh = new TakePeople(c.take);
                fresh.setTemplates([await template]);
                fresh.setWaterHistory(prefix.map(c => c.take));
                fresh.show((t - c.fromTick) * DT, t * DT);
                full.show(t * DT, t * DT);
                for (let i = 0; i < 2; i++)
                    after = Math.max(after, distance(full.bones(ID)[ID].arms[i].palm, fresh.bones(ID)[ID].arms[i].palm));
            }
        }
        console.log(JSON.stringify({ early, reentry, serverTick: server, depictedTick: depicted, socketFrom: socket(server)[0].fromTick, oldPrefixPalmDeltaM: before, supplementedPalmDeltaM: after, requests, responseBytes: bytes, maxChunks, delayedResponseTicks: 4, rollingTicks: 270 }));
        assert.ok(after < .0003, 'same existing0.3mm fresh-wave equivalence bound');
        assert.equal(requests, 1);
        assert.ok(maxChunks <= 14);
    });
test('initial history settles owner/error/short/foreign/gap/conflict fallbacks without refetching', async () => {
    const r = recording(), live = r.chunks.filter(c => c.toTick <= 200 && c.toTick > 160), selected = r.chunks.find(c => c.fromTick === 160)!, ctl = new AbortController();
    let owner = 'old', finish!: (v: typeof live) => void;
    const changed = new WorldMotionHistory(() => new Promise(r => finish = r), ctl.signal), pending = changed.start(live, 200, 30, owner, () => owner);
    owner = 'new';
    finish(r.chunks.slice(4, 10));
    await pending;
    assert.equal(changed.loading, false);
    assert.equal(changed.enabled, false);
    for (const kind of ['error', 'short', 'foreign', 'gap', 'conflict']) {
        let count = 0;
        const fetched = structuredClone(r.chunks.slice(4, 10));
        if (kind === 'foreign')
            fetched[0].take.rulesVersion += 'foreign';
        if (kind === 'gap')
            fetched.splice(2, 1);
        if (kind === 'conflict')
            fetched.at(-1)!.take.finalStateHash = 'a'.repeat(64);
        const h = new WorldMotionHistory(async () => { count++; if (kind === 'error')
            throw Error('offline'); return kind === 'short' ? live : fetched; }, ctl.signal);
        await h.start(live, 200, 30, 'same', () => 'same');
        h.history(live, selected, 170);
        assert.equal(h.enabled, false, kind + ' cannot qualify a prefix');
        await h.start(live, 200, 30, 'same', () => 'same');
        assert.equal(count, 1);
    }
});
test('initial history abort/deadline settles and does not adopt a late owner response', async () => {
    const r = recording(), live = r.chunks.slice(8, 10);
    for (const deadline of [false, true]) {
        const ctl = new AbortController(), h = new WorldMotionHistory((_f, _t, _l, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })), ctl.signal, 4, 10), p = h.start(live, 200, 30, 'same', () => 'same');
        if (!deadline)
            ctl.abort();
        await p;
        assert.equal(h.enabled, false);
        if (deadline)
            assert.equal(h.loading, false);
    }
});
