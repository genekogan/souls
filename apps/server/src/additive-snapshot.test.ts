import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {marsFactory} from '@souls/engine-mars';
import {Db} from './db.ts';
import {WorldHost} from './world.ts';
test('additive Mars registry upgrade resumes the pinned checkpoint; unknown physics stays unqualified',async()=>{
 const factory=await marsFactory(); const old=factory.rulesVersion.replace('+bodies/1','').replace('activities/31','activities/29');
 assert.equal(factory.canRestoreSnapshot?.(old),true);
 assert.equal(factory.canRestoreSnapshot?.(old.replace('mars-assembly/3','mars-assembly/2')),false);
 const db=new Db(join(mkdtempSync(join(tmpdir(),'souls-additive-')),'world.db'));
 const h=new WorldHost(db,factory,'additive',1e9); h.boot();
 void h.enqueue('birth','test',{soulId:'s',entityId:'a',name:'Alice',description:'test',owner:'owner'});h.tickOnce();
 for(let i=0;i<300;i++)h.tickOnce(); h.saveSnapshot(true);
 const s=db.latestSnapshot(h.worldId)!;db.saveSnapshot(h.worldId,{...s,physicalHash:h.engine.physicalHash(),rulesVersion:old});
 const restored=new WorldHost(db,factory,'additive',1e9);assert.equal(restored.boot().from,'snapshot');
 assert.equal(restored.engine.stateHash(),h.engine.stateHash());assert.equal(restored.engine.world.tick,301);
 for(let i=0;i<100;i++){h.tickOnce();restored.tickOnce();}
 assert.equal(restored.engine.stateHash(),h.engine.stateHash());db.close();
});
