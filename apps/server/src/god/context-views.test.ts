import { totemGlb } from '../../../../tools/library/fixture-glb.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountContextViews } from './context-views.ts';
import { contextEnclosed, contextFront, contextScene, contextTargets } from './context-view-scene.ts';
import { contextSheet, decodeContextPng, encodeContextPng } from './context-sheet.ts';
import { contextChromeLaunch } from './look-renderer.ts';
import { hostRenderLockPath } from './host-render-slot.ts';
import { moderationFor } from '../moderation/store.ts';
// Mocked captures still assemble real sheets, which share the host render slot.
// Own a lock directory on every platform; never contend with a running world.
let renderLockDir: string, previousRenderLockDir: string | undefined;
before(() => {
    previousRenderLockDir = process.env.SIM_RENDER_LOCK_DIR;
    renderLockDir = mkdtempSync(join(tmpdir(), 'souls-context-test-lock-'));
    process.env.SIM_RENDER_LOCK_DIR = renderLockDir;
});
after(() => {
    if (previousRenderLockDir === undefined) delete process.env.SIM_RENDER_LOCK_DIR;
    else process.env.SIM_RENDER_LOCK_DIR = previousRenderLockDir;
    rmSync(renderLockDir, { recursive: true, force: true });
});
function fixture() {
    const db = new Db(':memory:'), dir = mkdtempSync(join(tmpdir(), 'souls-context-test-'));
    const god = new GodMode(db, { worldId: 'context-test', ownerId: null, tick: () => 1, emit() { }, assetDir: dir });
    const act = (ops: unknown[]) => { const result = god.act({ ops }); assert.equal(result.accepted, true, JSON.stringify(result)); return result; };
    act([{ op: 'place', def: 'core/bench@1', name: 'seat', p: [0, 0], about: { title: 'Speaker seat', viewpoint: { eye: [2, 2, 3], at: [0, 1, 0] } } }, { op: 'place', def: 'core/plaza@1', name: 'plaza', shape: { area: [[-10, -10], [10, -10], [10, 10], [-10, 10]] }, about: { title: 'Plaza' } }]);
    return { db, god, act, dir };
}
test('meaning-only revisions reuse detached geometry while authored camera changes invalidate pixels', async () => {
    const { god, db, act } = fixture();
    let snapshots = 0, renders = 0;
    const original = god.publicSnapshot.bind(god);
    god.publicSnapshot = () => { snapshots++; return original(); };
    const app = new Hono(), ref = god.model.get('seat')!.id;
    const service = mountContextViews(app, { god, edge: { places: { byId: new Map() }, knowledge: { knows: () => true } } as never,
        contextReady: () => true, waitForContext: async () => {}, levelAt: () => 0, worldUrl: 'http://127.0.0.1:5980', soul: () => null, limit() {},
        renderer: async () => { renders++; return { png: new Uint8Array([1]) }; } });
    const request = () => app.request('/v1/world/context/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [ref] }) });
    try {
        await request(); await service.cache.settled();
        const first = (await (await request()).json()).views[0];
        assert.equal(snapshots, 1);
        act([{ op: 'set', id: ref, name: 'renamed', about: { ...god.model.get(ref)!.about, title: 'Renamed seat' } }]);
        await service.cache.settled();
        const renamed = (await (await request()).json()).views[0];
        assert.equal(renamed.key, first.key);
        assert.equal(renamed.title, 'Renamed seat');
        assert.equal(renamed.revision, god.model.editSeq);
        assert.equal(snapshots, 1, 'meaning-only change never reconstructs physical scene');
        assert.equal(renders, 1);
        act([{ op: 'set', id: ref, about: { ...god.model.get(ref)!.about, viewpoint: { eye: [3, 2, 3], at: [0, 1, 0] } } }]);
        await service.cache.settled();
        assert.notEqual((await (await request()).json()).views[0].key, first.key);
        assert.equal(snapshots, 1, 'new camera uses existing geometry');
        assert.equal(renders, 2);
    } finally { await service.close(); db.close(); }
});
test('metadata, scene and submitted camera share a frontier across engine-only moves', async () => {
    const { god, db } = fixture();
    const app = new Hono(), ref = god.model.get('seat')!.id;
    let payload: any, revision: number | undefined;
    const service = mountContextViews(app, { god, edge: { places: { byId: new Map() }, knowledge: { knows: () => true } } as never,
        contextReady: () => true, waitForContext: async () => {}, levelAt: () => 0, worldUrl: 'http://127.0.0.1:5980', soul: () => null, limit() {},
        renderer: async input => { payload = input.payload; revision = input.revision; return { png: new Uint8Array([1]) }; } });
    try {
        const metadata = await (await app.request('/v1/world/context?ref=' + ref)).json();
        assert.equal(metadata.targets[0].point[0], 0);
        assert.equal(god.engineAct([{ op: 'move', id: ref, mode: 'strict', p: [2, 0] }], 'before visual frontier').accepted, true);
        const expected = contextTargets(god.model).find(target => target.ref === ref)!;
        const publicSnapshot = god.publicSnapshot.bind(god);
        let moved = false;
        god.publicSnapshot = () => {
            const snapshot = publicSnapshot();
            if (!moved) queueMicrotask(() => {
                moved = true;
                assert.equal(god.engineAct([{ op: 'move', id: ref, mode: 'strict', p: [5, 0] }], 'during visual preparation').accepted, true);
            });
            return snapshot;
        };
        const response = await app.request('/v1/world/context/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [ref] }) });
        assert.equal(response.status, 200);
        await service.cache.settled();
        assert.equal(moved, true);
        assert.deepEqual(payload.target.point, expected.point);
        assert.deepEqual(payload.target.viewpoint, expected.viewpoint);
        assert.equal(payload.snapshot.entities.find((entity: any) => entity.id === ref).p[0], 2);
        assert.equal(god.model.get(ref)!.p![0], 5);
        assert.equal(revision, payload.snapshot.seq);
    } finally { await service.close(); db.close(); }
});
test('meaning and authored cameras retain exact refs through rename/move/repurpose/delete/undo', () => {
    const { db, god, act } = fixture();
    try {
        const seat = god.model.get('seat')!, ref = seat.id;
        act([{ op: 'define', def: { schema: 'def/1', name: 'outdoor-host', size: { box: [8, 1, 8] }, make: { kind: 'none' }, slots: [{ id: 'deck', kind: 'surface', p: [0, 1, 0], accepts: { maxSize: [8, 8, 8] } }] } }, { op: 'place', def: 'outdoor-host@1', name: 'outdoor', p: [30, 0] }, { op: 'place', def: 'core/bench@1', name: 'nested-seat', in: { parent: 'outdoor', slot: 'deck' }, p: [0, 0, 0] }]);
        assert.equal(contextEnclosed(god.model, contextTargets(god.model).find(t => t.entity === god.model.get('outdoor/nested-seat')!.id)!), false, 'outdoor grouped seat does not become an interior');
        act([{ op: 'set', id: 'plaza', about: { title: 'Plaza', parts: [{ id: 'speaker', title: 'Presenter position', anchor: { kind: 'entity', ref: 'seat', slot: god.model.slotsOf(seat).find(s => s.kind === 'seat')!.id } }] } }]);
        const part = contextTargets(god.model).find(t => t.part === 'speaker')!;
        assert.equal(part.entity, ref);
        assert.equal(contextEnclosed(god.model, part), false, 'outdoor seat is not enclosed');
        act([{ op: 'place', def: 'core/bird@1', name: 'wildlife', p: [40, 0] }]);
        assert.equal(contextTargets(god.model).some(t => t.entity === god.model.get('wildlife')!.id), false);
        assert.equal(contextScene(god, new Set()).snapshot.entities.some(e => e.id === god.model.get('wildlife')!.id), false);
        const before = contextScene(god, new Set());
        const initial = contextTargets(god.model).find(t => t.ref === ref)!;
        assert.equal(contextEnclosed(god.model, initial), false, 'authored exterior camera is not enclosure');
        act([{ op: 'set', id: ref, name: 'renamed', about: { ...god.model.entities.get(ref)!.about, title: 'Assembly seat' } }]);
        assert.equal(contextScene(god, new Set()).key, before.key, 'rename reuses pixels');
        assert.equal(contextTargets(god.model).find(t => t.ref === ref)!.title, 'Assembly seat');
        assert.equal(contextTargets(god.model).find(t => t.ref === part.ref)!.entity, ref);
        act([{ op: 'move', id: ref, p: [5, 4], r: 90 }]);
        const moved = contextTargets(god.model).find(t => t.ref === ref)!;
        assert.notDeepEqual(moved.viewpoint, initial.viewpoint);
        assert.notEqual(contextScene(god, new Set()).key, before.key);
        assert.equal(god.act({ ops: [{ op: 'remove', id: ref }] }).accepted, false, 'referenced seat refusal is preserved');
        act([{ op: 'set', id: 'plaza', about: { title: 'Rehearsal courtyard' } }, { op: 'remove', id: ref }]);
        assert.equal(contextTargets(god.model).some(t => t.ref === ref), false);
        assert.equal(god.undo().accepted, true);
        assert.ok(contextTargets(god.model).some(t => t.ref === part.ref && t.entity === ref));
        const bad = god.act({ ops: [{ op: 'set', id: ref, about: { viewpoint: { eye: [1, 1, 1], at: [1, 1, 1] } } }] });
        assert.equal(bad.accepted, false);
    }
    finally {
        db.close();
    }
});
test('shared retrieval reauthorizes metadata, cached pixels, originals and sheets; edits invalidate', async () => {
    const { db, god, act } = fixture();
    let renders = 0, secret = false, knows = false;
    const app = new Hono();
    app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code }, e.status as 400) : c.json({ error: String(e) }, 500));
    const seat = god.model.get('seat')!, place = { id: 'secret', ref: 'seat', level: 0, parent: 'world', polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]] };
    const edge = { beforeMap() { }, places: { byId: new Map([['secret', place]]), containing: () => [] }, knowledge: { knows: (s: string | null) => !secret || !!s && knows } };
    const png = encodeContextPng(1, 1, new Uint8Array([255, 0, 0, 255]));
    const service = mountContextViews(app, { contextReady: () => true, waitForContext: async () => {}, god, edge: edge as never, worldUrl: 'http://127.0.0.1:5980', levelAt: () => 0, soul: c => c.req.header('authorization') ?? null, limit() { }, renderer: async () => { renders++; return { png }; } });
    const request = (refs: string[], auth?: string) => app.request('/v1/world/context/views', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ refs, sheet: true }) });
    try {
        const first = await (await request([seat.id])).json();
        assert.equal(first.views[0].status, 'pending');
        await service.cache.settled();
        await request([seat.id], 'soul');
        await service.cache.settled();
        const ready = await (await request([seat.id], 'soul')).json();
        assert.equal(ready.views[0].status, 'ready');
        assert.equal(ready.sheet.status, 'ready', JSON.stringify(db.db.prepare('SELECT ref,status,reason FROM context_views_v1').all()));
        assert.equal(renders, 1);
        assert.equal((await app.request(ready.views[0].url)).status, 200);
        assert.equal((await app.request(ready.sheet.url)).status, 200);
        secret = true;
        assert.equal((await app.request('/v1/world/context')).status, 200);
        assert.equal((await (await app.request('/v1/world/context')).json()).targets.some((t: any) => t.ref === seat.id), false);
        assert.equal((await request([seat.id])).status, 404);
        assert.equal((await app.request(ready.views[0].url)).status, 404);
        assert.equal((await app.request(ready.sheet.url)).status, 404);
        knows = true;
        assert.equal((await app.request(ready.views[0].url, { headers: { authorization: 'soul' } })).status, 200);
        knows = false;
        assert.equal((await app.request(ready.views[0].url, { headers: { authorization: 'soul' } })).status, 404);
        secret = false;
        act([{ op: 'move', id: seat.id, p: [3, 3] }]);
        assert.equal((await app.request(ready.views[0].url)).status, 404);
        await service.cache.settled();
        assert.equal(renders, 2);
        const a = god.assets.put(png), b = god.assets.put(encodeContextPng(1, 1, new Uint8Array([0, 0, 255, 255])));
        act([{ op: 'place', def: 'core/picture-frame@1', name: 'art', state: { media: `/assets/${a.sha}.png` }, about: { title: 'Art' } }]);
        const art = god.model.get('art')!;
        const priorRenders = renders, metadata = await (await app.request('/v1/world/context?ref=' + art.id)).json();
        const original = metadata.targets[0].original;
        assert.equal(metadata.targets.length, 1);
        assert.equal(renders, priorRenders, 'original metadata does not queue architectural work');
        assert.equal(service.cache.peek(art.id), null);
        assert.equal(original.version, a.sha);
        assert.equal((await app.request(original.url)).status, 200);
        await request([art.id]);
        act([{ op: 'set', id: art.id, state: { media: `/assets/${b.sha}.png` } }]);
        assert.equal((await app.request(original.url)).status, 404);
        await service.cache.settled();
        const artReady = (await (await request([art.id])).json()).views[0];
        assert.equal(artReady.status, 'ready');
        moderationFor(db.db, god.opts.worldId).append({ sha: b.sha, action: 'hide', role: 'creator', actor: 'test' });
        assert.equal((await app.request(`/v1/world/context/original?ref=${art.id}&version=${b.sha}`)).status, 404);
        assert.equal((await app.request(artReady.url)).status, 404, 'moderated pixels cannot survive a cached URL');
        assert.equal((await request(Array.from({ length: 7 }, (_, i) => 'e_' + i))).status, 400);
        assert.equal((await request(['e_guessed'])).status, 404);
    }
    finally {
        await service.close();
        db.close();
    }
});
test('contact sheet has numbered exact tile positions and preserves pixels outside badges', () => {
    const red = encodeContextPng(1, 1, new Uint8Array([255, 0, 0, 255])), blue = encodeContextPng(1, 1, new Uint8Array([0, 0, 255, 255]));
    const sheet = contextSheet([red, blue, red, blue]);
    assert.deepEqual(sheet.tiles.map(t => [t.index, t.x, t.y]), [[1, 0, 0], [2, 320, 0], [3, 640, 0], [4, 0, 224]]);
    const image = decodeContextPng(contextSheet([red, blue]).png);
    assert.deepEqual([...image.pixels.subarray(0, 4)], [255, 0, 0, 255]);
    assert.deepEqual([...image.pixels.subarray(320 * 4, 320 * 4 + 4)], [0, 0, 255, 255]);
    const pixel = (x: number, y: number) => [...image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
    assert.deepEqual(pixel(6, 6), [255, 255, 255, 255], 'badge border');
    assert.deepEqual(pixel(7, 7), [24, 24, 24, 255], 'badge background');
    assert.deepEqual(pixel(17, 10), [255, 255, 255, 255], 'index 1 top stroke');
    assert.deepEqual(pixel(14, 10), [24, 24, 24, 255], 'index 1 differs from index 2');
    assert.deepEqual(pixel(334, 10), [255, 255, 255, 255], 'index 2 top stroke');
    assert.throws(() => contextSheet(Array(7).fill(red)));
});
test('Linux capture requires host-shared lock configuration and uses installed runtime sandbox policy', () => {
    assert.throws(() => hostRenderLockPath({}, 'linux'), /PrivateTmp/);
    assert.equal(hostRenderLockPath({ SIM_RENDER_LOCK_DIR: '/srv/sim-render-locks' }, 'linux'), '/srv/sim-render-locks/render.lock');
    assert.throws(() => hostRenderLockPath({ SIM_RENDER_LOCK_DIR: 'relative' }, 'linux'));
    const launch = contextChromeLaunch('/tmp/owned', { EDGE_EYES_GPU: 'swiftshader' }, 'linux');
    assert.ok(launch.args.includes('--no-sandbox'));
    assert.equal(launch.env.XDG_CONFIG_HOME, '/tmp/owned');
    assert.ok(launch.args.includes('--use-angle=swiftshader'));
});
test('target listing is bounded and complete across revision-guarded pages', async () => {
    const { db, god, act } = fixture();
    const first = god.model.get('seat')!;
    for (let i = 0; i < 105; i++)
        god.model.insert({ ...structuredClone(first), id: ('e_' + String(i).padStart(6, '0')), name: 'listing-' + i, about: { title: 'Listed ' + i } });
    const app = new Hono();
    app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code }, e.status as 400) : c.json({ error: String(e) }, 500));
    const edge = { beforeMap() { }, places: { byId: new Map(), containing: () => [] }, knowledge: { knows: () => true } };
    const service = mountContextViews(app, { contextReady: () => true, waitForContext: async () => {}, god, edge: edge as never, worldUrl: 'http://127.0.0.1:5980', levelAt: () => 0, soul: () => null, limit() { }, renderer: async () => ({ reason: 'not requested' }) });
    try {
        const page = await (await app.request('/v1/world/context')).json();
        assert.equal(page.targets.length, 100);
        assert.equal(page.total, 107);
        assert.ok(page.nextCursor);
        const next = await (await app.request('/v1/world/context?cursor=' + page.nextCursor)).json();
        assert.equal(next.targets.length, 7);
        assert.equal(next.nextCursor, null);
        assert.equal(new Set([...page.targets, ...next.targets].map(t => t.ref)).size, 107);
        const moderation = moderationFor(db.db, god.opts.worldId), version = moderation.version.bind(moderation);
        let frontierReads = 0;
        moderation.version = () => { frontierReads++; return version(); };
        try {
            assert.equal((await app.request('/v1/world/context')).status, 200);
            assert.ok(frontierReads < 20, `one synchronous page must not repeat DB/log frontier reads for every candidate: ${frontierReads}`);
        } finally { moderation.version = version; }
        moderationFor(db.db, god.opts.worldId).append({ sha: 'a'.repeat(64), action: 'hide', role: 'creator', actor: 'test' });
        assert.equal((await app.request('/v1/world/context?cursor=' + page.nextCursor)).status, 409, 'moderation invalidates pagination without editSeq change');
        assert.equal((await app.request('/v1/world/context?q=Listed&cursor=' + page.nextCursor)).status, 409, 'query has a separate listing identity');
        act([{ op: 'set', id: first.id, about: { title: 'Changed' } }]);
        assert.equal((await app.request('/v1/world/context?cursor=' + page.nextCursor)).status, 409);
    }
    finally {
        await service.close();
        db.close();
    }
});
test('listing refuses a moderation change while final target metadata is materialized', async () => {
    const { god, db, act } = fixture();
    const png = encodeContextPng(1, 1, new Uint8Array([255, 0, 0, 255])), asset = god.assets.put(png);
    act([{ op: 'place', def: 'core/picture-frame@1', name: 'art', state: { media: `/assets/${asset.sha}.png` } }]);
    const ref = god.model.get('art')!.id, app = new Hono();
    app.onError((error, c) => error instanceof ApiError ? c.json({ code: error.code }, error.status as 400) : c.json({ error: String(error) }, 500));
    const service = mountContextViews(app, { god, edge: { places: { byId: new Map() }, knowledge: { knows: () => true } } as never,
        contextReady: () => true, waitForContext: async () => {}, levelAt: () => 0, worldUrl: 'http://127.0.0.1:5980', soul: () => null, limit() {} });
    const moderation = moderationFor(db.db, god.opts.worldId), isHidden = moderation.isHidden.bind(moderation);
    try {
        assert.equal((await app.request('/v1/world/context?ref=' + ref)).status, 200);
        let changed = false;
        moderation.isHidden = sha => {
            if (!changed) { changed = true; moderation.append({ sha, action: 'hide', role: 'creator', actor: 'test' }); }
            return false; // Simulate the old value being read immediately before external log growth.
        };
        const response = await app.request('/v1/world/context?ref=' + ref);
        assert.equal(changed, true);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, 'context.pending');
    } finally { moderation.isHidden = isHidden; await service.close(); db.close(); }
});
// Run after the coordinator releases the local measurement window.
test('floor-attached subjects require a real room polygon and matching vertical span', () => {
    const { db, god, act } = fixture();
    try {
        act([{ op: 'define', def: { schema: 'def/1', name: 'room-host', size: { box: [10, 8, 10], scale: [1, 3] }, make: { kind: 'none' }, slots: [
                        { id: 'ground', kind: 'floor', p: [0, 0, 0], accepts: {}, capacity: 8 },
                        { id: 'room', kind: 'room', p: [0, 0, 0], height: 3, polygon: [[-4, -4], [4, -4], [4, 4], [-4, 4]], accepts: {} },
                    ] } }, { op: 'place', def: 'room-host@1', name: 'host', p: [20, 20], r: 90, s: 2 },
            { op: 'place', def: 'core/bench@1', name: 'inside', in: { parent: 'host', slot: 'ground' }, p: [1, 0, 1] },
            { op: 'place', def: 'core/bench@1', name: 'outside', in: { parent: 'host', slot: 'ground' }, p: [6, 0, 1] },
            { op: 'place', def: 'core/bench@1', name: 'above', in: { parent: 'host', slot: 'ground' }, p: [1, 4, 1] }]);
        const targets = contextTargets(god.model);
        for (const [name, expected] of [['inside', true], ['outside', false], ['above', false]] as const) {
            const entity = god.model.get('host/' + name)!;
            assert.equal(contextEnclosed(god.model, targets.find(t => t.entity === entity.id)!), expected, name);
        }
    }
    finally {
        db.close();
    }
});
test('an upper room stays secret while its public building framing midpoint stays public', async () => {
    const { db, god, act } = fixture();
    act([{ op: 'define', def: { schema: 'def/1', name: 'private-room-host', size: { box: [10, 8, 10] }, make: { kind: 'none' }, slots: [{ id: 'upper', kind: 'room', p: [0, 4, 0], height: 3, polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]], accepts: {} }] } }, { op: 'place', def: 'private-room-host@1', name: 'house', p: [0, 0] }]);
    const entity = god.model.get('house')!, ref = entity.id + '/slot/upper';
    let knows = true;
    const edge = { beforeMap() { }, places: { byId: new Map([['private', { id: 'private', ref: 'house/upper', level: 1, parent: 'world', polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]] }]]), containing: (_x: number, _z: number, level: number) => level === 1 ? [{id:'private',ref:'house/upper',level:1}] : [] }, knowledge: { knows: () => knows } };
    const app = new Hono();
    app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code }, e.status as 400) : c.json({ error: String(e) }, 500));
    const service = mountContextViews(app, { contextReady: () => true, waitForContext: async () => {}, god, edge: edge as never, worldUrl: 'http://127.0.0.1:5980', levelAt: (_x, _z, y) => y >= 4 ? 1 : 0, soul: () => null, limit() { }, renderer: async () => ({ png: encodeContextPng(1, 1, new Uint8Array([255, 0, 0, 255])) }) });
    const request = () => app.request('/v1/world/context/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [ref] }) });
    try {
        assert.equal((await request()).status, 200);
        await service.cache.settled();
        const ready = await (await request()).json();
        knows = false;
        assert.equal((await app.request('/v1/world/context?ref='+entity.id)).status,200);
        assert.equal((await(await app.request('/v1/world/context?ref='+entity.id)).json()).targets.length,1,'public exterior must not inherit an upper room secret through its camera midpoint');
        assert.equal((await request()).status, 404);
        assert.equal((await app.request(ready.views[0].url)).status, 404);
        assert.equal((await (await app.request('/v1/world/context')).json()).targets.some((t: any) => t.ref === ref), false);
    }
    finally {
        await service.close();
        db.close();
    }
});
test('point, region and entity parts use actual target level and membership, not owner centroid', async () => {
    const { db, god, act } = fixture();
    act([{ op: 'move', id: 'seat', p: [3, 4, 0] }, { op: 'set', id: 'plaza', about: { title: 'Public author', parts: [
                    { id: 'upper-point', title: 'Upper point', anchor: { kind: 'local', point: [3, 5, 0], stand: [3, 4, 0], level: 1 } },
                    { id: 'look-up', title: 'Upper point from ground', anchor: { kind: 'local', point: [3, 5, 0], stand: [0, 0, 0], level: 0 } },
                    { id: 'upper-region', title: 'Upper region', anchor: { kind: 'local', point: [-5, 5, 0], stand: [-5, 4, 0], level: 1, region: [[2, -1], [4, -1], [4, 1], [2, 1]] } },
                    { id: 'lower-point', title: 'Ground point', anchor: { kind: 'local', point: [3, 0, 0], stand: [3, 0, 0], level: 0 } },
                    { id: 'bound-seat', title: 'Upper seat', anchor: { kind: 'entity', ref: 'seat' } },
                ] } }]);
    const secret = { id: 'private', ref: 'elsewhere/upper', level: 1, polygon: [[2, -1], [4, -1], [4, 1], [2, 1]] as [
            number,
            number
        ][] };
    let knows = true;
    const edge = { beforeMap() { }, places: { byId: new Map([['private', secret]]), containing: (x: number, z: number, level: number) => level === 1 && x > 2 && x < 4 && z > -1 && z < 1 ? [secret] : [] }, knowledge: { knows: () => knows } };
    const app = new Hono();
    app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code }, e.status as 400) : c.json({ error: String(e) }, 500));
    const service = mountContextViews(app, { contextReady: () => true, waitForContext: async () => {}, god, edge: edge as never, worldUrl: 'http://127.0.0.1:5980', levelAt: (_x, _z, y) => y >= 4 ? 1 : 0, soul: () => null, limit() { }, renderer: async () => ({ png: encodeContextPng(1, 1, new Uint8Array([255, 0, 0, 255])) }) });
    const owner = god.model.get('plaza')!.id;
    const request = (id: string) => app.request('/v1/world/context/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [owner + '/part/' + id], sheet: true }) });
    try {
        const urls: string[] = [];
        for (const part of ['upper-point', 'upper-region', 'bound-seat', 'look-up']) {
            await request(part);
            await service.cache.settled();
            await request(part);
            await service.cache.settled();
            const ready = await (await request(part)).json();
            assert.equal(ready.views[0].status, 'ready', JSON.stringify(ready.views[0]));
            assert.equal(ready.sheet.status, 'ready', JSON.stringify(ready.sheet));
            urls.push(ready.views[0].url, ready.sheet.url);
        }
        knows = false;
        for (const part of ['upper-point', 'upper-region', 'bound-seat', 'look-up'])
            assert.equal((await request(part)).status, 404, part);
        for (const url of urls)
            assert.equal((await app.request(url)).status, 404, url);
        assert.equal((await request('lower-point')).status, 200, 'same x/z on a different floor remains public');
        assert.equal((await (await app.request('/v1/world/context')).json()).targets.some((t: any) => t.ref === owner), true, 'public owner is not hidden merely because its part names a secret room');
    }
    finally {
        await service.close();
        db.close();
    }
});
test('missing authoritative floor resolver returns unavailable, including cached retrieval', async () => {
    const { db, god } = fixture(), app = new Hono();
    app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code }, e.status as 400) : c.json({ error: String(e) }, 500));
    const edge = { beforeMap() { }, places: { byId: new Map(), containing: () => [] }, knowledge: { knows: () => true } };
    const service = mountContextViews(app, { contextReady: () => true, waitForContext: async () => {}, god, edge: edge as never, worldUrl: 'http://127.0.0.1:5980', soul: () => null, limit() { }, renderer: async () => { throw Error('must not render'); } });
    try {
        assert.equal((await app.request('/v1/world/context')).status, 503);
        assert.equal((await app.request('/v1/world/context/image?ref=' + god.model.get('seat')!.id + '&key=old')).status, 503);
        await service.cache.settled();
        assert.equal((db.db.prepare('SELECT count(*) n FROM context_views_v1').get() as {
            n: number;
        }).n, 0);
    }
    finally {
        await service.close();
        db.close();
    }
});

test('metadata pages, exact refs and search never materialize a render snapshot', async () => {
    const { db, god } = fixture();
    let snapshots = 0, renders = 0;
    const original = god.publicSnapshot.bind(god);
    god.publicSnapshot = () => { snapshots++; return original(); };
    const edge = { beforeMap() {}, places: { byId: new Map(), containing: () => [] }, knowledge: { knows: () => true } };
    const app = new Hono();
    const service = mountContextViews(app, { contextReady: () => true, waitForContext: async () => {}, god, edge: edge as never, worldUrl: 'http://127.0.0.1:5980', levelAt: () => 0, soul: () => null, limit() {}, renderer: async () => { renders++; return { png: encodeContextPng(1, 1, new Uint8Array([1, 2, 3, 255])) }; } });
    try {
        const first = await (await app.request('/v1/world/context')).json();
        await app.request('/v1/world/context?ref=' + first.targets[0].ref);
        await app.request('/v1/world/context?q=seat');
        assert.equal(snapshots, 0);
        assert.equal(renders, 0);
        await app.request('/v1/world/context/views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [first.targets[0].ref] }) });
        await service.cache.settled();
        assert.equal(snapshots, 1, 'pixel snapshot is made only on explicit visual demand');
        assert.equal(renders, 1);
    } finally { await service.close(); db.close(); }
});
test('semantic discovery preserves rooms, parts, art and places; explicit search finds incidental targets', async () => {
    const { db, god, act } = fixture();
    const seat = god.model.get('seat')!;
    god.model.insert({ ...structuredClone(seat), id: 'e_incidental', name: 'incidental', about: undefined });
    god.model.insert({ ...structuredClone(seat), id: 'e_semantic', name: 'semantic-place', about: undefined });
    god.model.insert({ ...structuredClone(seat), id: 'e_art', name: 'art-image', about: undefined, state: { media: '/assets/' + 'a'.repeat(64) + '.png' } });
    act([{ op: 'set', id: seat.id, about: { title: 'Café seat' } }, { op: 'set', id: 'plaza', about: { title: 'Plaza', parts: [{ id: 'bound', title: 'Bound incidental', anchor: { kind: 'entity', ref: 'incidental' } }] } }, { op: 'define', def: { schema: 'def/1', name: 'room-host', size: { box: [4, 3, 4] }, make: { kind: 'none' }, slots: [{ id: 'room', kind: 'room', p: [0, 0, 0], height: 3, polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]], accepts: {} }] } }, { op: 'place', def: 'room-host@1', name: 'plain-room-host', p: [30, 0] }]);
    const room = god.model.get('plain-room-host')!;
    const edge = { beforeMap() {}, places: { byId: new Map([['semantic', { id: 'semantic', ref: 'semantic-place', parent: 'world', level: 0, polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]] }]]) }, knowledge: { knows: () => true } };
    const app = new Hono();
    const service = mountContextViews(app, { contextReady: () => true, waitForContext: async () => {}, god, edge: edge as never, worldUrl: 'http://127.0.0.1:5980', levelAt: () => 0, soul: () => null, limit() {}, renderer: async () => ({ reason: 'not requested' }) });
    try {
        const listing = await (await app.request('/v1/world/context')).json();
        const refs = new Set(listing.targets.map((target: { ref: string }) => target.ref));
        assert.equal(listing.scope, 'semantic');
        assert.equal(refs.has('e_incidental'), false);
        assert.equal(refs.has('e_semantic'), true);
        assert.equal(refs.has('e_art'), true);
        assert.equal(refs.has(room.id + '/slot/room'), true);
        assert.equal(refs.has(god.model.get('plaza')!.id + '/part/bound'), true);
        const search = await (await app.request('/v1/world/context?q=incidental')).json();
        assert.equal(search.scope, 'search-all');
        assert.ok(search.targets.some((target: { ref: string }) => target.ref === 'e_incidental'));
        assert.equal((await (await app.request('/v1/world/context?ref=e_incidental')).json()).targets[0].ref, 'e_incidental');
        assert.equal((await (await app.request('/v1/world/context?q=cafe')).json()).targets[0].ref, seat.id);
    } finally { await service.close(); db.close(); }
});


test('public authored front normalizes and follows the rotated mesh owner through edits and undo', () => {
    const { db, god, act } = fixture();
    try {
        const meta = god.assets.put(totemGlb(), { name: 'front-fixture', license: 'CC0-1.0', by: 'god' });
        act([{ op: 'define', def: { schema: 'def/1', name: 'front-fixture', make: { kind: 'mesh', asset: meta.sha }, size: { box: [1, 1, 1] }, layer: 'solid', anchor: 'base' } },
            { op: 'place', def: 'front-fixture@1', name: 'front-object', p: [20, 0], r: Math.PI / 2, about: { title: 'Front object', front: [0, 4], parts: [{ id: 'face', title: 'Face', front: [3, 0], anchor: { kind: 'local', point: [0, 1, 0], stand: [0, 0, 0], level: 0 } }] } }]);
        const entity = god.model.get('front-object')!;
        assert.deepEqual(entity.about!.front, [0, 1]);
        const front = contextFront(god.model, entity)!;
        assert.equal(front.source, 'declared-front');
        assert.ok(Math.abs(front.direction[0] - 1) < 1e-9);
        const part = contextTargets(god.model).find(t => t.ref === entity.id + '/part/face')!;
        assert.ok(Math.abs(part.front!.direction[2] + 1) < 1e-9, 'part uses owner-local direction');
        const oldScene = contextScene(god, new Set()).key;
        act([{ op: 'set', id: entity.id, about: { ...entity.about, front: [1, 0] } }]);
        assert.equal(contextScene(god, new Set()).key, oldScene, 'direction is a camera dependency, not geometry');
        assert.notDeepEqual(contextFront(god.model, god.model.entities.get(entity.id)!), front);
        assert.equal(god.undo().accepted, true);
        assert.deepEqual(contextFront(god.model, god.model.entities.get(entity.id)!), front);
        assert.equal(god.act({ ops: [{ op: 'set', id: entity.id, about: { front: [0, 0] } }] }).accepted, false);
        assert.equal(contextFront(god.model, god.model.get('seat')!), undefined, 'arbitrary yaw does not establish a front');
    } finally { db.close(); }
});

test('context waits for maintained publication, rechecks edits/access, and never forces beforeMap', async () => {
    const { db, god, act } = fixture();
    const app = new Hono();
    app.onError((error, c) => error instanceof ApiError ? c.json({ code: error.code }, error.status as 400) : c.json({ error: String(error) }, 500));
    let ready = false, waits = 0;
    const edge = { beforeMap() { throw Error('context must not force perception'); }, places: { byId: new Map() }, knowledge: { knows: () => true } };
    const service = mountContextViews(app, { god, edge: edge as never, levelAt: () => 0, worldUrl: 'http://127.0.0.1:5980', soul: () => null, limit() {}, contextReady: () => ready, waitForContext: async () => {
        waits++;
        act([{ op: 'set', id: 'seat', about: { title: 'New committed title' } }]);
        ready = true;
    } });
    try {
        const result = await app.request('/v1/world/context?ref=' + god.model.get('seat')!.id);
        assert.equal(result.status, 200);
        const data = await result.json();
        assert.equal(data.targets[0].title, 'New committed title');
        assert.equal(data.revision, god.model.editSeq);
        assert.equal(waits, 1);
        ready = false;
        // A completion that is invalidated before the continuation must not publish stale data.
        const second = new Hono(); second.onError((error, c) => error instanceof ApiError ? c.json({ code: error.code }, error.status as 400) : c.json({ error: String(error) }, 500));
        const stale = mountContextViews(second, { god, edge: edge as never, levelAt: () => 0, worldUrl: 'http://127.0.0.1:5980', soul: () => null, limit() {}, contextReady: () => false, waitForContext: async () => {} });
        try { assert.equal((await second.request('/v1/world/context')).status, 503); }
        finally { await stale.cache.close(); }
    } finally { await service.cache.close(); db.close(); }
});
