import test from 'node:test';
import assert from 'node:assert/strict';
import {WorldModel,coreLibrary,applyBatch,coreRef} from '@souls/world-compiler';
import {unsupportedRootGap} from './walk-floats.ts';

test('float audit recognizes complete deck support but retains raised and overhanging fixtures',()=>{
 const w=new WorldModel({constants:{extent:1000,ground:'land'},seed:'deck-float-audit'});w.library=coreLibrary();
 const run=(ops:unknown[])=>{const r=applyBatch(w,{ops},'god',0);assert.equal(r.result.accepted,true,JSON.stringify(r.result));};
 run([{op:'place',def:coreRef('pond'),name:'water',shape:{area:[[0,140],[40,140],[40,185],[0,185]]},params:{depth:4}}]);
 run([{op:'place',def:coreRef('pier'),name:'pier',shape:{path:[[10,139],[10,167]]},params:{width:3,height:4,platform:5,rails:true}}]);
 const pier=w.get('pier')!,surface=w.bake(w.resolvedDef(pier.def)!,pier.params??{},0,pier.shape).surfaces!.at(-1)!;
 run([{op:'place',def:coreRef('bench'),name:'bench',p:[10,surface.y,170]}]);
 const bench=w.get('bench')!;
 assert.equal(unsupportedRootGap(w,bench),0);
 assert.ok(unsupportedRootGap(w,{...bench,p:[10,surface.y+1,170]})>.3,'being above a deck is still floating');
 assert.ok(unsupportedRootGap(w,{...bench,p:[12.4,surface.y,170]})>.3,'origin on deck alone cannot exempt an overhang');
 assert.ok(unsupportedRootGap(w,{...bench,p:[25,surface.y,170]})>.3,'same height off deck is still floating');
});
