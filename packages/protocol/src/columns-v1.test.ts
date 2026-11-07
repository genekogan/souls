// columns/1 (lane JOINSET): the column form restores the exact table (JSON.stringify identical, key order included).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packColumnsV1,unpackColumnsV1,isPackedColumnsV1,joinTableOrderV1,worldEntityOrderV1} from './columns-v1.ts';
const rt=(t:unknown,o?:(r:Record<string,unknown>)=>string)=>{const p=packColumnsV1(t,o);assert.ok(p&&isPackedColumnsV1(p));const back=unpackColumnsV1(JSON.parse(JSON.stringify(p)));assert.equal(JSON.stringify(back),JSON.stringify(t));return JSON.stringify(p).length;};
let seed=7;const rnd=()=>((seed=(seed*1103515245+12345)%2**31)/2**31);
const hex=()=>Math.floor(rnd()*2**32).toString(16).padStart(8,'0');
const defs=['ew:core-bin@1:92ff2bdd46','ew:core-bookcase@1:2e5497798b','ew:core-floor-lamp@1:40b00a6bc1'];
function joinTable(n:number){const ids=[...new Set(Array.from({length:n},()=>'e_'+hex()))].sort(),t:Record<string,unknown>={};
 for(const id of ids){const r=rnd(),e:Record<string,unknown>={id,def:defs[Math.floor(r*3)],kind:r<.9?'fixture':'person',label:`thing ${Math.floor(rnd()*50)}`,tags:['entity-world'],
  pose:{p:[+(rnd()*300).toFixed(3),r<.5?0:0.1,-(rnd()*200).toFixed(2)],yaw:[0,1.571,-1.571][Math.floor(rnd()*3)]},provenance:{origin:'design-edit',confidence:'hypothetical',note:'placed'}};
  if(r<.5)e.support={on:ids[0],slot:'floor'};if(r<.1)e.level=Math.floor(rnd()*3);if(r>.95)e.maybe=undefined;t[id]=e;}
 return t;}
test('a keyed join table round-trips exactly, regrouped or not, and is far smaller',()=>{
 const t=joinTable(3000),raw=JSON.stringify(t).length;
 assert.ok(rt(t)<raw/2);assert.ok(rt(t,joinTableOrderV1)<raw/2);
 assert.equal(packColumnsV1(t,joinTableOrderV1)!.$columnsV1.sorted,'');
});
test('an array table round-trips; regrouping only when its ids ascend',()=>{
 const rows=Object.values(joinTable(500)).map((e:any,i)=>({id:e.id,def:e.def,in:i%3?{parent:'e_00000001',slot:'a'}:undefined,name:e.label,p:e.pose.p,params:i%2?{a:i,b:[1,{c:null}]}:{},...(i%7?{}:{state:{on:true}})}));
 rt(rows,worldEntityOrderV1);assert.equal(packColumnsV1(rows,worldEntityOrderV1)!.$columnsV1.sorted,'id');
 const shuffled=[...rows].reverse();rt(shuffled,worldEntityOrderV1);assert.equal(packColumnsV1(shuffled,worldEntityOrderV1)!.$columnsV1.sorted,undefined);
 const dup=[rows[0],rows[0],rows[1]];rt(dup,worldEntityOrderV1);
});
test('odd values: mixed tuples, nested shapes, -0, nulls, unicode keys, dictionary objects are copies',()=>{
 const t={b:{v:[1,2],o:{x:1}},c:{v:[1,2,3],o:{y:'é',x:null}},a:{v:[-0,1e-7],o:{}},d:{v:'s',o:{x:[1]}},'ü':{v:[1,2],o:{x:1}}};rt(t);rt(t,()=>'');
 const same=Object.fromEntries(Array.from({length:40},(_,i)=>['k'+i,{tags:['x','y']}])),back=unpackColumnsV1(packColumnsV1(same)!) as any;
 back.k0.tags.push('z');assert.deepEqual(back.k1.tags,['x','y']);
});
test('refuses what it cannot restore exactly; garbage throws',()=>{
 assert.equal(packColumnsV1([]),null);assert.equal(packColumnsV1({}),null);assert.equal(packColumnsV1([1,2]),null);assert.equal(packColumnsV1({a:1}),null);
 assert.equal(packColumnsV1(JSON.parse('{"__proto__":{"a":1}}')),null);assert.equal(packColumnsV1([{f:()=>1}]),null);
 assert.throws(()=>unpackColumnsV1({$columnsV1:{n:2,shapes:[['a']],shape:[0,0],cols:{a:{r:[1]}}}} as any),/columns-v1.invalid/);
 assert.throws(()=>unpackColumnsV1({$columnsV1:{n:1,shapes:[['a']],shape:[0],cols:{}}} as any),/columns-v1.invalid/);
 assert.throws(()=>unpackColumnsV1({$columnsV1:{n:1,shapes:[['__proto__']],shape:[0],cols:{__proto__:{r:[1]}}}} as any),/columns-v1.invalid/);
});
// #619: malformed wire metadata is refused before it is used: no borrowed prototype, no inherited property as data
test('malformed keys, shapes, indices and columns from the wire are refused (#619)',()=>{
 const bad=(json:string)=>assert.throws(()=>unpackColumnsV1(JSON.parse(json)),/columns-v1.invalid/,json.slice(0,200));
 // the two payloads reported in #619, as literal JSON
 bad('{"$columnsV1":{"n":1,"keys":[["__proto__"]],"shapes":[["__columns_triage_marker_20261103__"]],"shape":[0],"cols":{"__columns_triage_marker_20261103__":{"r":[true]}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["value"]],"shape":[0],"cols":{"value":{"d":[],"i":["constructor"]}}}}');
 // keys: strings only, as many as rows, distinct, never __proto__
 bad('{"$columnsV1":{"n":1,"keys":[1],"shapes":[["a"]],"shape":[0],"cols":{"a":{"r":[1]}}}}');
 bad('{"$columnsV1":{"n":1,"keys":"a","shapes":[["a"]],"shape":[0],"cols":{"a":{"r":[1]}}}}');
 bad('{"$columnsV1":{"n":1,"keys":["__proto__"],"shapes":[["a"]],"shape":[0],"cols":{"a":{"r":[1]}}}}');
 bad('{"$columnsV1":{"n":2,"keys":["x","x"],"shapes":[["a"]],"shape":[0,0],"cols":{"a":{"r":[1,2]}}}}');
 bad('{"$columnsV1":{"n":1,"keys":["x","y"],"shapes":[["a"]],"shape":[0],"cols":{"a":{"r":[1]}}}}');
 // dictionary indices: own, in-range integers of an array
 for (const i of ['"0"','-1','1','0.5','"length"','null']) bad(`{"$columnsV1":{"n":1,"shapes":[["v"]],"shape":[0],"cols":{"v":{"d":[7],"i":[${i}]}}}}`);
 bad('{"$columnsV1":{"n":1,"shapes":[["v"]],"shape":[0],"cols":{"v":{"d":{"0":7},"i":[0]}}}}');
 // envelope: n, shapes, shape, sorted, cols
 bad('{"$columnsV1":{"n":"1","shapes":[["a"]],"shape":[0],"cols":{"a":{"r":[1]}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[[["a"]]],"shape":[0],"cols":{"a":{"r":[1]}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":["constructor"],"cols":{"a":{"r":[1]}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":[1],"cols":{"a":{"r":[1]}}}}');
 bad('{"$columnsV1":{"n":1,"sorted":["id"],"shapes":[["id"]],"shape":[0],"cols":{"id":{"r":["x"]}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":null}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":[1]}}}');
 // column variants
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":{"r":"x"}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":{"f":0,"v":[]}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":{"f":1,"v":["x"]}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":{"k":1}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":{"o":{"n":1,"keys":[["__proto__"]],"shapes":[["b"]],"shape":[0],"cols":{"b":{"r":[1]}}}}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":{"x":1}}}}');
 bad('{"$columnsV1":{"n":-1,"shapes":[],"shape":[],"cols":{}}}');
 bad('{"$columnsV1":{"n":0.5,"shapes":[],"shape":[],"cols":{}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["v"]],"shape":[0],"cols":{"v":{"d":[7],"i":0}}}}');
 bad('{"$columnsV1":{"n":2,"sorted":"constructor","shapes":[["id"]],"shape":[0,0],"cols":{"id":{"r":["x","y"]}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a","a"]],"shape":[0],"cols":{"a":{"r":[1,2]}}}}');
 bad('{"$columnsV1":{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":{"f":1,"v":[1e400]}}}}');
 // nesting deeper than the encoder's three levels is refused with the same error, never a stack overflow
 let deep = '{"n":1,"shapes":[["x"]],"shape":[0],"cols":{"x":{"r":[1]}}}';
 for (let d = 0; d < 4; d++) deep = `{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":{"o":${deep}}}}`;
 bad(`{"$columnsV1":${deep}}`);
 let wide = '{"n":1,"shapes":[["x"]],"shape":[0],"cols":{"x":{"r":[1]}}}';
 for (let d = 0; d < 20000; d++) wide = `{"n":1,"shapes":[["a"]],"shape":[0],"cols":{"a":{"o":${wide}}}}`;
 bad(`{"$columnsV1":${wide}}`);
 // a well-formed envelope of the same shapes still decodes

 assert.deepEqual(unpackColumnsV1(JSON.parse('{"$columnsV1":{"n":2,"keys":["x","y"],"shapes":[["id","v","t"]],"shape":[0,0],"cols":{"id":{"k":1},"v":{"d":[7],"i":[0,0]},"t":{"f":2,"v":[1,2,3,4]}}}}')),{x:{id:'x',v:7,t:[1,2]},y:{id:'y',v:7,t:[3,4]}});
});
