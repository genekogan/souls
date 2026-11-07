import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collect } from './e2e-receipt.mjs';

function fixture(t, report) {
  const root=mkdtempSync(join(tmpdir(),'souls-gate-e2e-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const dir=join(root,'.lane/e2e-party/fresh'); mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'report.json'),JSON.stringify({startedAt:'2026-10-15T23:00:00Z',steps:[{name:'admitted arrival',ok:true}],summary:{steps:1,failed:0},failures:[],...report}));
  return root;
}
test('e2e receipt retains actual assertion IDs and excludes raw results and tokens',t=>{
  const root=fixture(t,{steps:[{name:'admitted arrival',ok:true,result:{token:'test-only-do-not-copy'}}]});
  const r=collect('V6-party',root,root,0);
  assert.deepEqual(r.steps,[{id:'admitted arrival',status:'pass'}]);
  assert.ok(!readFileSync(join(root,'V6-party-cases.json'),'utf8').includes('do-not-copy'));
});
test('missing, stale, incomplete and duplicate e2e reports cannot qualify',t=>{
  const root=fixture(t,{summary:{steps:2,failed:0}});
  assert.throws(()=>collect('V6-party',root,root,0),/incomplete/);
  assert.throws(()=>collect('V6-party',root,root,Date.now()/1000+1e9),/fresh report/);
  assert.throws(()=>collect('V6-no-such-case',root,root,0),/unregistered/);
});
test('unrepresented harness failures survive independently of assertion results',t=>{
  const root=fixture(t,{summary:{steps:1,failed:1},failures:[{name:'harness',error:'fixture startup'}]});
  assert.deepEqual(collect('V6-party',root,root,0).harnessFailures,['harness']);
});
