// Entry 14: the piano's sound and the hands read one score at depicted world seconds.
import test from 'node:test';import assert from 'node:assert/strict';
import {pianoNotes,pianoHands,PIANO_STEP,STRIKE} from '../../../mars/viewer/app/engine-view/piano-score.ts';
test('every note onset is a key strike of that hand, at the same world second, for every viewer',()=>{
 for(const seed of ['h_a','h_b','h_cb33a8d209','h_2a6daed123']){
  const notes=pianoNotes(seed,100,116);assert.ok(notes.length>40,'a real tune: '+notes.length);
  for(const n of notes){const [l,r]=pianoHands(seed,n.t);assert.equal((n.hand===0?l:r).press,1,`${seed} strike at ${n.t}`);const later=pianoHands(seed,n.t+STRIKE*.5);assert.ok((n.hand===0?later[0]:later[1]).press<=.5+1e-9);}
  assert.deepEqual(pianoNotes(seed,100,108).map(n=>[n.t,n.midi,n.hand]),pianoNotes(seed,100,104).concat(pianoNotes(seed,104,108)).map(n=>[n.t,n.midi,n.hand]),'windows compose: schedule order cannot change the notes');
  assert.ok(notes.every(n=>Math.abs(n.t/PIANO_STEP-Math.round(n.t/PIANO_STEP))<1e-9),'on the step grid');
 }
 assert.notDeepEqual(pianoNotes('h_a',0,8).map(n=>n.midi),pianoNotes('h_b',0,8).map(n=>n.midi).length?pianoNotes('h_c',0,8).map(n=>n.midi):[],'players differ (seeded)');
});
test('between notes no key is held down',()=>{const [l,r]=pianoHands('h_a',100+PIANO_STEP*.9);assert.ok(l.press<1&&r.press<1);});
// Entry 26: the drum part shares the piano's clock; the stick is on the drum exactly when a hit sounds.
import { drumHits, drumHands, PIANO_STEP as STEP26 } from '../../../mars/viewer/app/engine-view/piano-score.ts';
test('drums: every hit is on the piano grid, the fill closes the phrase, sticks meet the drums at the hits', () => {
  for (const seed of ['e_a', 'e_b', 'e_c', 'e_d']) {
    const hits = drumHits(seed, 0, 32);
    assert.ok(hits.length > 100);
    for (const h of hits) assert.ok(Math.abs(h.t / STEP26 - Math.round(h.t / STEP26)) < 1e-9, 'on the step grid');
    assert.ok(hits.some((h) => h.kind === 'kick' && Math.abs(h.t) < 1e-9) && hits.some((h) => h.kind === 'crash' && Math.abs(h.t) < 1e-9), 'the phrase starts together');
    const toms = hits.filter((h) => h.kind === 'tom');
    assert.ok(toms.length && toms.every((h) => Math.round(h.t / STEP26) % 32 >= 28 && Math.floor(Math.round(h.t / STEP26) / 32) % 2 === 1), 'the fill ends every other phrase');
    for (const h of hits.filter((x) => x.hand >= 0)) assert.ok(drumHands(seed, h.t)[h.hand as 0 | 1].lift < 1e-6, 'the stick is down at its hit');
    // and up between hits that are a beat or more apart
    const right = hits.filter((x) => x.hand === 1).map((x) => x.t);
    for (let i = 1; i < right.length; i++) if (right[i] - right[i - 1] >= 0.5) assert.ok(drumHands(seed, (right[i] + right[i - 1]) / 2)[1].lift > 0.99);
  }
  // two drummers (different seeds) stay on the same beat: their kicks on the bar line coincide
  const a = drumHits('e_a', 0, 16).filter((h) => h.kind === 'kick' && Math.round(h.t / STEP26) % 8 === 0).map((h) => h.t), b = drumHits('e_b', 0, 16).filter((h) => h.kind === 'kick' && Math.round(h.t / STEP26) % 8 === 0).map((h) => h.t);
  assert.deepEqual(a, b);
});

import {pianoLanes} from '../../../mars/viewer/app/engine-view/piano-score.ts';
test('seated piano lanes arrive at each scored pitch on its onset, with bounded travel between keys',()=>{
 for(const seed of ['h_a','h_b','h_cb33a8d209','h_2a6daed123']){
  for(const n of pianoNotes(seed,100,116))assert.ok(Math.abs(pianoLanes(seed,n.t)[n.hand]-pianoHands(seed,n.t)[n.hand].along)<1e-9,'hand at scored key on onset');
  let prev=pianoLanes(seed,100);for(let k=2001;k<=2320;k++){const now=pianoLanes(seed,k*.05);for(let h=0;h<2;h++)assert.ok(Math.abs(now[h]-prev[h])<=.06,'no sideways wrist teleport');prev=now;}
 }
});
