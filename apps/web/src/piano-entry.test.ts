// #422: a piano note sounds only once the arm entry blend has put the hands on the keys; the score clock never shifts.
//   node --test apps/web/src/piano-entry.test.ts
import test from 'node:test';import assert from 'node:assert/strict';
import {pianoNotes,pianoReadyAt} from '../../../mars/viewer/app/engine-view/piano-score.ts';
import {activityFrame,PIANO_FADE} from '../../../mars/viewer/app/engine-view/activity-poses.ts';
const weight=(seed:string,t:number,since:number|undefined)=>activityFrame('play-piano','sit',t,seed,{actorId:seed,since})!.piano!.weight;
test('every audible onset finds the hands fully on the keys; the ungated score sounded during the entry blend',()=>{
 let entryOnsets=0;
 for(const seed of ['h_a','h_b','h_cb33a8d209','h_2a6daed123'])for(const start of [100,100.05,100.13,101.2,257.35]){
  const notes=pianoNotes(seed,start,start+6);assert.ok(notes.length>10);
  // the schedule asks at every depicted second `now` (look-back .05 s, look-ahead .35 s); age is now - start
  for(let now=start;now<start+6;now+=.05){const ready=pianoReadyAt(now,now-start,PIANO_FADE);assert.ok(Math.abs(ready-(start+PIANO_FADE))<1e-9,'ready time is the same from every frame');
   for(const n of pianoNotes(seed,now-.05,now+.35)){
    const since=n.t-start;
    if(n.t<ready-1e-6){entryOnsets++;assert.ok(weight(seed,n.t,since)<1,'a gated note falls inside the blend');continue;}
    assert.equal(weight(seed,n.t,since),1,`${seed} start ${start}: onset ${n.t} sounds with the hands on the keys`);
   }}
  // the audible score is the absolute score from the ready time on: nothing shifted, nothing synthesized
  assert.deepEqual(notes.filter(n=>n.t>=start+PIANO_FADE-1e-6).map(n=>[n.t,n.midi,n.hand]),pianoNotes(seed,start+PIANO_FADE-1e-6,start+6).map(n=>[n.t,n.midi,n.hand]));
 }
 assert.ok(entryOnsets>0,'without the gate these onsets sounded while the arms were still blending in (the #646 counterexample)');
});
test('an activity of unknown age (began before the known history) is settled for hands and sound alike',()=>{
 assert.equal(pianoReadyAt(300,undefined,PIANO_FADE),-Infinity);
 for(const n of pianoNotes('h_a',300,302))assert.equal(weight('h_a',n.t,undefined),1);
});
