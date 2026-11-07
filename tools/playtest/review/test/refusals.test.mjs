import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,mkdirSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{DatabaseSync}from'node:sqlite';import{attachRefusals}from'../refusals.mjs';
test('local refusal evidence selects only this Soul and request window, and excludes prose',()=>{
 const dir=mkdtempSync(join(tmpdir(),'souls-refusals-'));mkdirSync(join(dir,'server','data'),{recursive:true});const db=new DatabaseSync(join(dir,'server','data','sim.db'));
 db.exec('CREATE TABLE edge_refusals_v1(soul_id TEXT,at INTEGER,capability TEXT,code TEXT,reason TEXT)');const q=db.prepare('INSERT INTO edge_refusals_v1 VALUES(?,?,?,?,?)');for(const[soul,at]of[['s',1000],['s',3000],['other',1000]])q.run(soul,at,'walk:closed/hall','route.unreachable','untrusted prose');db.close();
 const evidence=[{seat:'sol',sentAt:new Date(0).toISOString(),cutoffAt:new Date(2000).toISOString()}];attachRefusals(dir,evidence,{sol:{seat:{soulId:'s'}}});assert.deepEqual(evidence[0].refusals.map(x=>({...x})),[{at:1000,capability:'walk:closed/hall',code:'route.unreachable'}]);
});
