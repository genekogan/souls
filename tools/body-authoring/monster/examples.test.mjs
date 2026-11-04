import test from 'node:test';import assert from 'node:assert/strict';
import {admitBodyGLB,BODY_LIMITS} from '../../../apps/server/src/edge/body/admission.ts';
import {authorMonster} from './author.mjs';import {authorGhost} from '../ghost/author.mjs';

test('monster and ghost pass unchanged owner admission inside ordinary budgets, reproducibly',()=>{
 const m=authorMonster(),g=authorGhost();
 for(const [made,draws]of [[m,BODY_LIMITS.humanoidDrawCalls],[g,BODY_LIMITS.rigidDrawCalls]]){
  const a=admitBodyGLB(made.bytes,made.manifest);assert.ok(a.bytes<BODY_LIMITS.bytes/4);assert.ok(a.triangles<BODY_LIMITS.triangles/3);assert.equal(a.images,0);assert.ok(made.stats.drawCalls<=draws);}
 assert.equal(admitBodyGLB(m.bytes,m.manifest).rig,'quaternius/1');assert.deepEqual(m.stats.clips,['Idle','Walk']);assert.equal(m.manifest.actionProfile,undefined,'plain canonical humanoid profile');
 assert.equal(g.manifest.type,'ceramic');assert.ok(g.manifest.motion.dance);
 assert.deepEqual(authorMonster().bytes,m.bytes,'same source, same bytes');assert.deepEqual(authorGhost().bytes,g.bytes);
});
