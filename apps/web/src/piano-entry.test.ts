// #422: a piano note sounds only once the arm entry blend has put the hands on the keys; the score clock never shifts.
//   node --test apps/web/src/piano-entry.test.ts
import test from 'node:test';import assert from 'node:assert/strict';
import {pianoEndAt,pianoNotes,pianoReadyAt} from '../../../mars/viewer/app/engine-view/piano-score.ts';
import {notesToSound} from './gen-mesh/sound-plan.ts';
import {activityFrame,PIANO_FADE} from '../../../mars/viewer/app/engine-view/activity-poses.ts';
const weight=(seed:string,t:number,since:number|undefined)=>activityFrame('play-piano','sit',t,seed,{actorId:seed,since})!.piano!.weight;
test('every audible onset finds the hands fully on the keys; the ungated score sounded during the entry blend',()=>{
 let entryOnsets=0;
 for(const seed of ['h_a','h_b','h_cb33a8d209','h_2a6daed123'])for(const start of [100,100.05,100.13,101.2,257.35]){
  const notes=pianoNotes(seed,start,start+6);assert.ok(notes.length>10);
  // the schedule asks at every depicted second `now` (look-back .05 s, look-ahead .35 s); age is now - start
  for(let now=start;now<start+6;now+=.05){const ready=pianoReadyAt(now,now-start,PIANO_FADE);
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

/** The sound step's decision over consecutive steps (as sound.ts playPianos runs it: look-back .05 s, look-ahead .35 s). */
function schedule(seed:string,steps:{now:number;age?:number;left?:number}[]){
 const done=new Map<string,number>(),out:{t:number;hand:number;at:number}[]=[];
 for(const s of steps)for(const n of notesToSound(pianoNotes(seed,s.now-.05,s.now+.35),pianoReadyAt(s.now,s.age,PIANO_FADE),pianoEndAt(s.now,s.left),done,n=>`${n.t}:${n.hand}`))out.push({t:n.t,hand:n.hand,at:s.now});
 return out;
}
test('the schedule over a whole run: nothing before the hands reach the keys, nothing at or after the recorded end, each note once',()=>{
 for(const seed of ['h_a','h_cb33a8d209'])for(const [start,stop] of [[100,106],[100.05,103.2],[257.35,259.3]]){
  // sound steps every .1 s, at an offset from the score grid; the end is known from 1.5 s before it (live depiction lag)
  const steps=[];for(let now=start+.03;now<stop+1;now+=.1)if(now<stop)steps.push({now,age:now-start,...(now>stop-1.5?{left:stop-now}:{})});
  const out=schedule(seed,steps),want=pianoNotes(seed,start+PIANO_FADE-1e-6,stop-1e-6);
  assert.deepEqual(out.map(n=>[n.t,n.hand]),want.map(n=>[n.t,n.hand]),`${seed} ${start}-${stop}: exactly the score from the ready time to the end`);
  assert.ok(out.every(n=>n.t>=start+PIANO_FADE-1e-6&&n.t<stop-1e-6));
  // ungated, the same steps sound notes during the entry blend and after the stop (the #646 counterexample and review P2-1)
  const ungated=schedule(seed,steps.map(s=>({now:s.now})));assert.ok(ungated.some(n=>n.t<start+PIANO_FADE-1e-6));
 }
 // a stop just before a note, seen only by a later step: without the recorded end the next note was already started
 const seed='h_a',notes=pianoNotes(seed,100,104),t=notes.find(n=>n.t>101.5)!.t,stop=t-.05;
 const late=schedule(seed,[{now:stop-.04,age:5},{now:stop-.04+.1,age:5}]);assert.ok(late.some(n=>n.t===t),'no end known: the note after the stop sounds');
 const ended=schedule(seed,[{now:stop-.04,age:5,left:.04}]);assert.ok(!ended.some(n=>n.t>=stop),'recorded end: nothing at or after it');
});
test('a note silenced during the entry blend is never revived when a later step sees an earlier ready time',()=>{
 const seed='h_a',first=pianoNotes(seed,100.5,101)[0].t;
 // step 1: entry under way, the note is gated; step 2 (.04 s later, inside the look-back): the age is unknown (settled)
 const out=schedule(seed,[{now:first-.01,age:first-.01-100.5},{now:first+.03}]);
 assert.ok(first<100.5+PIANO_FADE,'the note falls inside the blend');assert.ok(!out.some(n=>n.t===first),'never revived by the look-back');
});
