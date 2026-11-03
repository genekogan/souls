import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Finding} from './conformance.ts';

test('EF4 measures canonical apartment geometry without counting its auxiliary shadow copies or waiving its documented overrun',{timeout:30_000},t=>{
 const dir=mkdtempSync(join(tmpdir(),'ef4-canonical-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const out=join(dir,'report.json');
 const result=spawnSync(process.execPath,[new URL('../bin/conformance.mjs',import.meta.url).pathname,'--filter','core-apartment-block@1','--k','2','--out',out,'--report-only'],{encoding:'utf8',timeout:25_000});assert.equal(result.status,0,result.stderr);
 const report=JSON.parse(readFileSync(out,'utf8')) as {rendered:number;findings:Finding[]};assert(report.rendered>0);
 const gallery=report.findings.filter(f=>f.stage==='gallery-budget'&&f.code==='triangles');
 assert.equal(gallery.find(f=>f.field==='defaults')?.detail,'6214 > 6000','The original measured budget failure remains visible');
 assert.equal(gallery.find(f=>f.field==='params.w.max')?.detail,'10598 > 6000','Endpoint source geometry remains counted');
 const known=JSON.parse(readFileSync(new URL('../conformance/bsgen-20261021.json',import.meta.url),'utf8')) as {findings:(Omit<Finding,'field'>&{fields:string[]})[]};
 const signature=(f:Finding)=>JSON.stringify([f.def,f.hash,f.field,f.stage,f.code,f.detail]);const allowed=new Set(known.findings.flatMap(f=>f.fields.map(field=>signature({...f,field}))));
 assert.deepEqual(gallery.filter(f=>!allowed.has(signature(f))),[],'Canonical capture must preserve the exact prior apartment findings, not a new triangle allowance');
});
