import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { marsFactory,GREEN_FIELD_WORLD } from '@souls/engine-mars';
import { fixture,invite } from '../test/native-owner-fixture.ts';
const factory=await marsFactory({...GREEN_FIELD_WORLD,safeCrewRemoval:true});
for(const damaged of ['body','event_hash'] as const)test(`private receipt authorizes before verifying a foreign damaged ${damaged}`,async t=>{
  const errors=t.mock.method(console,'error',()=>{});
  const httpErrors=()=>errors.mock.calls.filter(c=>c.arguments[0]==='[http]').length;
  const f=fixture(':memory:',factory);f.souls.enableLifecycle();t.after(()=>f.db.close());await invite(f,'alice');await invite(f,'bob');
  const created=await f.app.request('/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:alice','content-type':'application/json','X-Sim-Lifecycle':'1'},body:JSON.stringify({name:'Alice',description:'synthetic local corruption fixture'})});
  assert.equal(created.status,202);const {lifecycle}=await created.json() as {lifecycle:{requestId:string}};f.host.drainInputs();await delay(0);
  f.db.db.prepare(`UPDATE lifecycle_operations_v1 SET ${damaged}=? WHERE request_id=?`).run(damaged==='body'?'{}':'0'.repeat(64),lifecycle.requestId);
  let decodes=0;const journal=f.souls.lifecycle!.journal,original=journal.get.bind(journal);
  journal.get=(...args)=>{decodes++;return original(...args);};
  const foreign=await f.app.request(`/v1/lifecycle/${lifecycle.requestId}`,{headers:{authorization:'Bearer dev:bob'}});
  assert.equal(foreign.status,404);assert.equal(foreign.headers.get('cache-control'),'no-store');assert.deepEqual(await foreign.json(),{ok:false,code:'not-found',message:'no such lifecycle'});assert.equal(decodes,0);
  assert.equal((await f.app.request('/v1/lifecycle?owner=dev:alice',{headers:{authorization:'Bearer dev:bob'}})).status,404);
  const ownHistory=await f.app.request('/v1/lifecycle',{headers:{authorization:'Bearer dev:bob'}});assert.equal(ownHistory.status,200);assert.deepEqual((await ownHistory.json() as {requests:unknown[]}).requests,[]);assert.equal(decodes,0);assert.equal(httpErrors(),0,'foreign/own-empty reads produce no HTTP invariant error');
  for(const owner of ['alice','admin']){
    const authorized=await f.app.request(`/v1/lifecycle/${lifecycle.requestId}`,{headers:{authorization:'Bearer dev:'+owner}});
    assert.equal(authorized.status,500);assert.equal(authorized.headers.get('cache-control'),'no-store');assert.equal((await authorized.json() as {code:string}).code,'internal');
  }
  assert.equal(decodes,2);assert.equal(httpErrors(),2,'only authorized invariant errors reach HTTP error reporting');
});
