// Pure renderer-dispatch test. Images below stand in for decoded immutable PNG originals;
// real browser texture/pixel/hover/refresh checks remain the display acceptance authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CORE_KIT, WorldModel, applyBatch, coreRef, type Entity, type StoredDef } from '@souls/world-compiler';
import furniture from '../../../../../packages/world-compiler/src/core-kit/furniture.json' with { type: 'json' };
import { MaterialLib } from '../materials.ts';
import { meshFor, type MeshCtx } from '../registry.ts';

function bodyGeometry(root: THREE.Object3D) {
    const body: unknown[] = [];
    root.traverse(object => {
        if (!(object instanceof THREE.Mesh) || object.name === 'sign-face') return;
        const geometry = object.geometry as THREE.BufferGeometry;
        body.push({
            position: object.position.toArray(), rotation: object.rotation.toArray().map(value => Object.is(value, -0) ? 0 : value), scale: object.scale.toArray(),
            attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([key, attribute]) =>
                [key, { itemSize: attribute.itemSize, array: Array.from((attribute as THREE.BufferAttribute).array) }])),
            index: geometry.index ? Array.from(geometry.index.array) : null,
        });
    });
    return body;
}

test('published easel v2 dispatches real media faces and immutable originals while v1 stays decorative', async () => {
    const globals = globalThis as unknown as { location?: URL; document?: unknown };
    const previousLocation = globals.location, previousDocument = globals.document;
    const originalLoad = THREE.TextureLoader.prototype.load;
    const materials = new MaterialLib(), loaded: { url: string; texture: THREE.Texture }[] = [];
    const media = ['/w/fixture/art/' + 'a'.repeat(64) + '.png', '/w/fixture/art/' + 'b'.repeat(64) + '.png'];
    const originals = media.map(src => Object.freeze({ src, width: 512, height: 512, naturalWidth: 512, naturalHeight: 512 }));
    const canvasContext = { font: '', fillStyle: '', textAlign: '', textBaseline: '', fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, quadraticCurveTo() {}, lineTo() {}, measureText: (s: string) => ({ width: s.length * 12 }), fillText() {} };
    globals.location = new URL('http://offline.invalid/w/fixture?shot=1');
    globals.document = { createElement: (tag: string) => {
        assert.equal(tag, 'canvas', 'the original-image loader is stubbed; no network image element');
        return { width: 0, height: 0, getContext: () => canvasContext };
    } };
    THREE.TextureLoader.prototype.load = function(url, onLoad) {
        const original = originals[media.indexOf(url)];
        assert.ok(original, 'renderer requested only the supplied immutable painting original: ' + url);
        const texture = new THREE.Texture(original as unknown as HTMLImageElement);
        loaded.push({ url, texture });
        queueMicrotask(() => onLoad?.(texture));
        return texture;
    };
    try {
        // Register the actual generic and tag builders after installing the DOM/image stubs.
        await import('../kit.mesh.ts');
        await import('./sign.mesh.ts');
        const oldInput = furniture.find(def => def.name === 'core-easel')!;
        const publishedV1 = CORE_KIT.find(def => def.name === 'core-easel' && def.version === 1)!;
        const publishedV2 = CORE_KIT.find(def => def.name === 'core-easel' && def.version === 2)!;
        assert.deepEqual(publishedV1, oldInput, 'published v1 remains the frozen original definition');
        const frozenV1 = JSON.stringify(publishedV1);
        assert.equal(coreRef('easel'), 'core/easel@1');
        const model = new WorldModel({ constants: { ground: 'land' }, seed: 'published-easel-media-dispatch' });
        const v1 = model.defineDef(publishedV1, 'core', 0), v2 = model.defineDef(publishedV2, 'core', 0);
        assert.equal(applyBatch(model, { ops: [
            { op: 'place', def: coreRef('easel', 1), name: 'legacy-easel', p: [-3, 0] },
            { op: 'place', def: coreRef('easel', 2), name: 'paintable-easel', p: [3, 0] },
        ] }, 'god', 1).result.accepted, true);
        const context = (entity: Entity, def: StoredDef): MeshCtx => {
            const params = entity.params ?? {};
            return { def, entity, params, args: def.make.kind === 'gen' ? def.make.args ?? {} : {},
                baked: model.bake(def, entity.params ?? {}, entity.seed ?? 0, entity.shape), model, materials,
                tint: (key, fallback) => { const value = key ? params[key] : undefined; return typeof value === 'string' && value.startsWith('#') ? value : key ? def.palette?.[key] ?? fallback : fallback; } };
        };
        const legacyCtx = context(model.get('legacy-easel')!, v1), paintable = model.get('paintable-easel')!;
        const legacyBuilder = meshFor(v1)!, mediaBuilder = meshFor(v2)!;
        const legacy = legacyBuilder.build(legacyCtx)!;
        assert.ok(legacy, 'published v1 actually renders through its generic builder');
        assert.equal(legacy.getObjectByName('sign-face'), undefined);
        assert.equal(typeof legacyBuilder.instanceKey?.(legacyCtx), 'string', 'v1 keeps generic kit instancing');
        assert.equal(mediaBuilder.instanceKey, undefined, 'media faces must retain per-entity metadata and cannot use generic kit instancing');
        const blank = mediaBuilder.build(context(paintable, v2))!;
        const blankFace = blank.getObjectByName('sign-face') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
        assert.ok(blankFace?.isMesh, 'actual published v2 creates its media plane even before a painting exists');
        assert.equal(blankFace.userData.art, undefined);
        assert.deepEqual(bodyGeometry(blank), bodyGeometry(legacy), 'v2 retains the same easel body beneath its media plane');
        assert.equal(loaded.length, 0, 'v1 and an empty v2 canvas request no original');
        const maker = 'soul:s_painter:Painting Witness';
        const buildPainting = (version: number) => {
            const state = { media: media[version], title: version ? 'Blue garden' : 'Amber garden', maker };
            assert.equal(applyBatch(model, { ops: [{ op: 'set', id: paintable.id, state }] }, 'engine', version + 2, { trusted: true }).result.accepted, true);
            const root = mediaBuilder.build(context(model.entities.get(paintable.id)!, v2))!;
            const face = root.getObjectByName('sign-face') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
            assert.ok(face?.isMesh, 'native painting state reaches an actual media face');
            assert.deepEqual(face.userData.art, { frame: paintable.id, slot: 0, url: state.media, kind: 'image', title: state.title, maker });
            assert.ok(face.material instanceof THREE.MeshBasicMaterial);
            assert.equal(face.material.toneMapped, false);
            const texture = face.material.map!;
            assert.ok(texture instanceof THREE.Texture);
            assert.equal(texture, loaded[version].texture, 'the face attaches the TextureLoader result for this immutable original');
            assert.equal(texture.image, originals[version]);
            const image = texture.image as typeof originals[number];
            assert.equal(image.naturalWidth, 512);
            assert.equal(image.naturalHeight, 512);
            assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
            assert.deepEqual(Array.from(face.geometry.attributes.uv.array), [0, 1, 1, 1, 0, 0, 1, 0], 'square original is not cropped or stretched on the square media face');
            return face;
        };
        const first = buildPainting(0), replacement = buildPainting(1);
        assert.deepEqual(loaded.map(row => row.url), media, 'replacement requests a distinct immutable original, not a stale cache hit');
        assert.notEqual(first.material.map, replacement.material.map);
        assert.equal(first.material.map!.image, originals[0], 'the first immutable original remains distinct after overwrite');
        assert.equal(first.userData.art.url, media[0]);
        assert.equal(replacement.userData.art.url, media[1]);
        assert.equal(JSON.stringify(publishedV1), frozenV1, 'renderer dispatch and painting updates do not mutate v1');
    } finally {
        THREE.TextureLoader.prototype.load = originalLoad;
        globals.location = previousLocation;
        globals.document = previousDocument;
        for (const { texture } of loaded) texture.dispose();
        materials.dispose();
    }
});
