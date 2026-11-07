// C2 (Gene 2026-10-26): name plates hang under the body, just outside the selection ring; no leader line; the packing
// solver only moves a plate sideways or down, never up over its body, at most 180 px.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const here=new URL('.',import.meta.url).pathname,outfile=join(await mkdtemp(join(tmpdir(),'souls-world-labels-')),'labels.cjs');
await build({entryPoints:[join(here,'WorldLabels.ts')],outfile,bundle:true,format:'cjs',platform:'node',logLevel:'silent'});
const {placeWorldLabels,plateAnchor,nameTag}=createRequire(import.meta.url)(outfile);
const area={left:0,top:0,width:390,height:700,aspect:390/700};
const box=(id,x,y,o={})=>({id,x,y,width:80,height:18,selected:false,...o});
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
// a little seeded generator: crowds of plates at random spots
const rng=(seed=>()=>((seed=Math.imul(seed^seed>>>15,1|seed)+0x6d2b79f5|0)>>>0)/2**32)(7);

test('solver: a free plate stays at its anchor',()=>{
 const r=placeWorldLabels([box('a',100,300)],area);assert.deepEqual(r.get('a'),{dx:0,dy:0});
});
test('solver: two Souls standing together get plates that do not overlap, the second below or beside, never above',()=>{
 const r=placeWorldLabels([box('a',100,300),box('b',104,302)],area),a=r.get('a'),b=r.get('b');
 assert.deepEqual(a,{dx:0,dy:0});assert.ok(b&&b.dy>=0);
 assert.ok(!overlap({x:100+a.dx,y:300+a.dy,width:80,height:18},{x:104+b.dx,y:302+b.dy,width:80,height:18}));
});
test('solver never returns a negative dy, nor an offset beyond 180 px, nor overlapping plates (random crowds)',()=>{
 for(let round=0;round<300;round++){
  const n=2+Math.floor(rng()*12),boxes=[];
  for(let i=0;i<n;i++)boxes.push(box(`s${i}`,rng()*360-20,rng()*720-10,{width:40+rng()*120,selected:i===0&&rng()<.5,previous:rng()<.3?{dx:rng()*80-40,dy:rng()*80-40}:undefined}));
  const r=placeWorldLabels(boxes,area),rects=[];
  for(const [id,o] of r){const b=boxes.find(x=>x.id===id);
   assert.ok(o.dy>=0,`round ${round} ${id}: dy ${o.dy}`);assert.ok(Math.hypot(o.dx,o.dy)<=180);
   const rect={x:b.x+o.dx,y:b.y+o.dy,width:b.width,height:b.height};
   assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=390&&rect.y+rect.height<=700);
   for(const q of rects)assert.ok(!overlap(rect,q),`round ${round}: overlap`);rects.push(rect);}
 }
});
test('solver: a free plate goes back under its body; a crowded one keeps its previous lane',()=>{
 assert.deepEqual(placeWorldLabels([box('a',100,300,{previous:{dx:-35,dy:0}})],area).get('a'),{dx:0,dy:0});
 const r=placeWorldLabels([box('a',100,300),box('b',104,302,{previous:{dx:90,dy:0}})],area);assert.deepEqual(r.get('b'),{dx:90,dy:0});
});
test('solver: a stale upward placement is dropped for a downward one',()=>{
 const r=placeWorldLabels([box('a',100,300,{previous:{dx:0,dy:-30}})],area);assert.deepEqual(r.get('a'),{dx:0,dy:0});
});
test('solver: a plate whose anchor (its top centre) is off screen stays hidden; one near the bottom edge is never pushed up',()=>{
 assert.equal(placeWorldLabels([box('a',100,-5)],area).has('a'),false);
 assert.equal(placeWorldLabels([box('a',100,690)],area).has('a'),false);
 assert.deepEqual(placeWorldLabels([box('a',-30,300)],area).get('a'),{dx:30,dy:0},'sideways onto the screen is fine');
});
test('plateAnchor: the ground point moved toward the eye by the ring radius, height unchanged',()=>{
 const p=plateAnchor([10,2,5],{x:10,z:25},{x:0,z:1},0.64);
 assert.deepEqual(p.map(v=>+v.toFixed(6)),[10,2,5.64]);
 const q=plateAnchor([0,0,0],{x:3,z:4},{x:0,z:1},1);assert.deepEqual(q.map(v=>+v.toFixed(6)),[0.6,0,0.8]);
 // eye straight above: the camera's screen-down on the ground decides
 assert.deepEqual(plateAnchor([1,0,1],{x:1,z:1},{x:-2,z:0},0.5),[0.5,0,1]);
 // a lying sleeper's anchor is still its ground point (no head lift)
 assert.equal(plateAnchor([4,0.3,4],{x:4,z:10},{x:0,z:1},0.64)[1],0.3);
 assert.deepEqual(plateAnchor([1,2,3],{x:1,z:3},{x:0,z:0},0.64),[1,2,3],'degenerate: the ground point itself');
});
test('name tag has no leader line: name, doing, card, channel chip only',()=>{
 const make=tag=>({tagName:tag.toUpperCase(),style:{},dataset:{},className:'',children:[],append(...c){this.children.push(...c);}});
 const {el}=nameTag({createElement:make});
 assert.equal(el.className,'world-name-tag');assert.deepEqual(el.children.map(c=>c.tagName),['B','DIV','DIV','DIV']);
 for(const c of el.children)assert.doesNotMatch(c.style.cssText??'',/width:1px|transform-origin/);
});
test('LiveWorld hangs the plate below its anchor and reads the radius from the drawn ring',async()=>{
 const src=await readFile(join(here,'LiveWorld.tsx'),'utf8');
 assert.match(src,/obj\.center\.set\(0\.5, 0\)/);assert.match(src,/ring\.geometry\.parameters\.outerRadius/);
 assert.doesNotMatch(src,/leader/);assert.match(src,/plateAnchor\(pos, eye, down, ringR\)/);
});
