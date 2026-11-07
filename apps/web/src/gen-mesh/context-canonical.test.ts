import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CORE_KIT, WorldModel, type Entity } from '@souls/world-compiler';
import { GENERATORS, type Value } from '@souls/generators';
import { MaterialLib } from './materials.ts';
import { meshFor, type MeshCtx } from './registry.ts';
import './building.mesh.ts';

test('canonical building skips implicit cuts without mutating shared live templates', () => {
    const model = new WorldModel({ constants: { extent: 100, ground: 'land' }, seed: 'context' });
    for (const def of CORE_KIT) model.defineDef(def, 'core', 0);
    const def = model.def('core/cottage@1')!;
    const params = Object.fromEntries(Object.entries({ ...GENERATORS['building/1'].params, ...def.params }).filter(([, field]) => field.default !== undefined).map(([key, field]) => [key, field.default]));
    const context: MeshCtx = { def, entity: { id: 'fixture', def: def.ref, in: { parent: 'world' }, by: 'test', born: 0, v: 1, params } as Entity, params: params as Record<string, Value>, args: def.make.kind === 'gen' ? def.make.args ?? {} : {}, baked: model.bake(def, params as Record<string, Value>, 0), model, materials: new MaterialLib(), tint: (_key, fallback) => fallback };
    const live = meshFor(def)!.build(context)!;
    const canonical = meshFor(def)!.build({ ...context, canonicalContext: true })!;
    const laterLive = meshFor(def)!.build(context)!;
    const meshes = (root: THREE.Object3D) => { const result: THREE.Mesh[] = []; root.traverse(object => { if (object instanceof THREE.Mesh) result.push(object); }); return result; };
    assert.ok(live.userData.interior);
    assert.ok(laterLive.userData.interior);
    assert.equal(canonical.userData.interior, undefined);
    assert.ok(meshes(canonical).every(mesh => mesh.onBeforeRender === THREE.Object3D.prototype.onBeforeRender));
    assert.ok(meshes(live).some(mesh => mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender));
    assert.ok(meshes(canonical).some(mesh => mesh.userData.contextStructure?.classification === 'roof'));
    assert.ok(meshes(canonical).filter(mesh => mesh.userData.contextStructure?.classification === 'wall').every(mesh => mesh.userData.contextStructure.exteriorFacade === true));
    assert.equal(meshes(canonical)[0].geometry, meshes(live)[0].geometry, 'shared geometry remains reusable');
});

test('bounded blocker rays inventory both real building roofs and retain unknown obstructions', async () => {
    const { contextPhotoGeometry } = await import('../context-photo-scene.ts');
    const model = new WorldModel({ constants: { extent: 100, ground: 'land' }, seed: 'nested-roofs' });
    for (const def of CORE_KIT) model.defineDef(def, 'core', 0);
    const def = model.def('core/cottage@1')!;
    const params = Object.fromEntries(Object.entries({ ...GENERATORS['building/1'].params, ...def.params }).filter(([, field]) => field.default !== undefined).map(([key, field]) => [key, field.default]));
    const context: MeshCtx = { def, entity: { id: 'roof-fixture', def: def.ref, in: { parent: 'world' }, by: 'test', born: 0, v: 1, params } as Entity, params: params as Record<string, Value>, args: def.make.kind === 'gen' ? def.make.args ?? {} : {}, baked: model.bake(def, params as Record<string, Value>, 0), model, materials: new MaterialLib(), tint: (_key, fallback) => fallback, canonicalContext: true };
    const entries: { id: string; entity: string; mesh: THREE.Mesh }[] = [];
    for (const [entity, y] of [['outer',5],['inner',1]] as const) {
        const root = meshFor(def)!.build(context)!; root.position.y = y; root.updateMatrixWorld(true);
        root.traverse(object => { if (object instanceof THREE.Mesh && object.userData.contextStructure?.classification === 'roof') entries.push({id:`${entity}:${entries.length}`,entity,mesh:object}); });
    }
    const unknown = new THREE.Mesh(new THREE.BoxGeometry(2,.1,2),new THREE.MeshBasicMaterial());
    unknown.position.set(0,13,0); unknown.updateMatrixWorld(true); entries.push({id:'unknown',entity:'unknown',mesh:unknown});
    const subject = { ref:'seat',kind:'part' as const,target:[0,.5,0] as const,bounds:{min:[-.5,0,-.5] as const,max:[.5,1,.5] as const},objectIds:['seat'] };
    const candidate = { id:'above',eye:[0,20,0] as const,at:[0,.5,0] as const,fov:64,ordinaryAllowed:true,provenance:{camera:'geometric' as const,front:'unknown' as const} };
    const evidence = contextPhotoGeometry(subject,candidate,entries);
    assert.ok(evidence.occluderIds?.some(id=>id.startsWith('outer:')));
    assert.ok(evidence.occluderIds?.some(id=>id.startsWith('inner:')));
    assert.ok(evidence.occluderIds?.includes('unknown'),'inventory does not relabel or hide unknown geometry');
    assert.ok(entries.every(entry=>entry.mesh.visible),'geometry evidence never mutates visibility');
});

test('only generator top ceiling joins roof assembly; lower floors and geometry/materials remain intact', async () => {
    const { buildingLayout } = await import('../../../../packages/generators/src/building.ts');
    const { buildingBuffers } = await import('./building-buffers.ts');
    const { Builder } = await import('./building-kit.ts');
    const params = { floors: 3, floorHeight: 3, w: 10, d: 10 }, L = buildingLayout(params, { style: 'shed' });
    assert.equal(L.floors,3);
    const made = buildingBuffers({L,params,presetTrim:'#6b4a2b',paint:'#eee',seed:1});
    const marked = made.raw.filter(soup=>soup.topCeilingVertices !== undefined);
    assert.equal(marked.length,1);
    assert.equal(marked[0].topCeilingVertices,marked[0].p.length/3);
    assert.ok(made.raw.filter(soup=>soup.k.endsWith('|floor')).length>=3);
    assert.ok(made.raw.filter(soup=>soup.k.endsWith('|floor')).every(soup=>soup.topCeilingVertices===undefined));
    const materials = new MaterialLib();
    const tagged = Builder.fromRaw(made.raw).emit(materials);
    const plain = Builder.fromRaw(made.raw.map(({topCeilingVertices,...soup})=>soup)).emit(materials);
    let ceilings=0;
    for (const [name,group] of tagged.groups) {
        const control = plain.groups.get(name)!;
        group.children.forEach((object,i)=>{
            const mesh=object as THREE.Mesh, other=control.children[i] as THREE.Mesh;
            assert.deepEqual(mesh.geometry.getAttribute('position').array,other.geometry.getAttribute('position').array);
            assert.equal(mesh.material,other.material);
            if(mesh.userData.contextStructure?.assembly==='top-ceiling'){
                ceilings++;const box=new THREE.Box3().setFromObject(mesh);
                assert.ok(Math.abs(box.min.y-(L.wallTop-.1))<1e-5);
                assert.ok(Math.abs(box.max.y-(L.wallTop+.02))<1e-5);
                assert.equal(mesh.userData.contextStructure.exteriorFacade,false);
            }
        });
    }
    assert.equal(ceilings,1);
    const changed=Builder.fromRaw(made.raw);changed.group=marked[0].k.split('|')[0];
    changed.box(0,0,0,1,1,1,'#fff','wall');
    const mixed=changed.emit(materials).groups.get(changed.group)!.children[0];
    assert.notEqual(mixed.userData.contextStructure?.assembly,'top-ceiling','later mixed geometry revokes roof eligibility');
});
