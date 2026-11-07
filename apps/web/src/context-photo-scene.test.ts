import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Terrain, emptyGround } from '@souls/ground';
import { planContextPhoto, chooseContextPhoto } from './context-photographer.ts';
import { contextPhotoScene, contextPhotoGeometry, roomPlanes, type ContextMesh } from './context-photo-scene.ts';
const box = (id: string, size: [number,number,number], at: [number,number,number], structure?: { classification: string; exteriorFacade?: boolean }): ContextMesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.position.set(...at); mesh.updateMatrixWorld(true);
    if (structure) mesh.userData.contextStructure = structure;
    return { id, entity: 'hall', mesh };
};
const room = { polygon: [[-3,-3],[3,-3],[3,3],[-3,3]] as [number,number][], floor: 0, ceiling: 3 };
test('room mask clips actual volume and excludes roof while preserving its walls and contained subject', () => {
    const floor = box('hall:floor',[12,.2,12],[0,-.1,0]);
    const roof = box('hall:roof',[12,.2,12],[0,3.1,0],{classification:'roof'});
    const wall = box('hall:wall',[.2,3,6],[3,1.5,0],{classification:'wall',exteriorFacade:true});
    const podium = { ...box('podium:mesh',[1,1,1],[0,.5,0]), entity:'podium' };
    const far = { ...box('outside:mesh',[1,1,1],[20,.5,0]), entity:'outside' };
    const result = contextPhotoScene({ref:'hall/slot/room',entity:'hall',point:[0,1.2,0],radius:4,subjectKind:'room',interior:true,room},[floor,roof,wall,podium,far])!;
    try {
        assert.deepEqual(result.subject.bounds,{min:[-3,0,-3],max:[3,3,3]});
        assert.deepEqual(result.subject.objectIds,['hall:floor','hall:wall','podium:mesh']);
        assert.equal(result.subject.occluders!.find(o=>o.id==='hall:wall')!.exteriorFacade,true);
        assert.equal(result.subject.occluders!.find(o=>o.id==='hall:roof')!.classification,'roof');
        assert.equal(result.planes.length,6);
        assert.equal(result.subject.authoredCamera,undefined);
    } finally { result.dispose(); }
    assert.equal(roof.mesh.visible,true,'selection never mutates immutable scene visibility');
});
test('real triangle parity rejects a solid eye but accepts a hollow room; concave clipping is unavailable', () => {
    const solid = box('solid',[2,2,2],[0,1,0]);
    const target = { ref:'subject',kind:'part' as const,bounds:{min:[-.5,0,-.5] as const,max:[.5,1,.5] as const},target:[0,.5,0] as const,objectIds:['subject'] };
    const camera = { id:'eye',eye:[0,1,0] as const,at:[0,1,4] as const,fov:64,ordinaryAllowed:true,provenance:{camera:'geometric' as const,front:'unknown' as const} };
    assert.equal(contextPhotoGeometry(target,camera,[solid]).insideSolid,true);
    const walls = [box('left',[.2,3,6],[-3,1.5,0]),box('right',[.2,3,6],[3,1.5,0]),box('front',[6,3,.2],[0,1.5,3]),box('back',[6,3,.2],[0,1.5,-3])];
    assert.equal(contextPhotoGeometry(target,camera,walls).insideSolid,false);
    assert.equal(roomPlanes({...room,polygon:[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4]]}),null);
});

test('authored camera below sampled terrain is rejected without treating a carved depression as solid', async () => {
    const terrain = new Terrain({ ...emptyGround(100, 4), landforms: [{ id: 'depression', kind: 'carve', area: [[10,10],[20,10],[20,20],[10,20]], bed: -2, edge: 1 }] });
    const target = { ref: 'subject', kind: 'part' as const, bounds: { min: [0,4,0] as const, max: [1,5,1] as const }, target: [.5,4.5,.5] as const, objectIds: ['subject'], authoredCamera: { eye: [0,1,-3] as const, at: [.5,4.5,.5] as const } };
    const plan = planContextPhoto(target);
    const ground = (x: number, z: number) => terrain.sample(x,z);
    const choice = await chooseContextPhoto(plan, candidate => ({ ...contextPhotoGeometry(target, candidate, [], ground), subjectPresent: true, visibleFraction: 1, projectedFill: .4 }));
    assert.equal(choice.status, 'unavailable');
    assert.equal(contextPhotoGeometry(target, { ...plan.candidates[0], eye: [15,0,15] }, [], ground).insideSolid, false, 'actual carved surface permits an eye below the uncarved base');
});

test('semantic region masks its actual polygon; unsupported point/seat scope never substitutes the owner', () => {
    const hall = box('hall:mesh', [20,8,20], [0,4,0]);
    const target = { ref:'hall/part/corner', entity:'hall', point:[3,0,3] as [number,number,number], radius:2, region:[[2,2],[4,2],[4,4],[2,4]] as [number,number][], scope:'region' as const };
    const region = contextPhotoScene(target, [hall])!;
    try {
        for (const [actual, expected] of [[region.subject.bounds.min,[2,0,2]],[region.subject.bounds.max,[4,0,4]],[region.subject.target,[3,0,3]]] as const)
            actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-8));
        assert.deepEqual(region.subject.objectIds,[], 'owner is an occluder, not the region mask');
        assert.equal(region.subject.kind,'landscape');
    } finally { region.dispose(); }
    assert.equal(contextPhotoScene({...target,scope:'point'},[hall]),null);
    assert.equal(contextPhotoScene({...target,scope:'slot'},[hall]),null);
    const bound = contextPhotoScene({...target,scope:'entity',region:undefined},[hall])!;
    try { assert.deepEqual(bound.subject.objectIds,['hall:mesh']); }
    finally { bound.dispose(); }
});
