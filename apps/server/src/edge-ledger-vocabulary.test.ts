// PM-R057: natural names agents actually sent on live 4970 (walk:pond ×37, walk:eden-library-1 ×11, walk:library,
// walk:eden-commons, "hang out at the deck", hang-out:commons-deck[90], …) resolve when unambiguous, else did_you_mean.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability, parseCapability, type VocabContext, type VocabPlace, numberConflict, numberWords} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';

const places: VocabPlace[] = [
 {id: 'commons', name: 'Commons gathering lawn', center: [9, 5]}, {id: 'commons-deck', name: 'Presentation deck', center: [9, -2]},
 {id: 'shore-water', name: 'The pond (connected calm water)', center: [-20, 30]}, {id: 'shore-bank', name: 'Connected sloping bank', center: [-15, 25]},
 {id: 'social-eden-fire-circle', name: 'Campfire clearing', center: [24, -7]}, {id: 'social-eden-dining', name: 'Social dining', center: [23, 6]},
 {id: 'eden-classroom-1', name: 'Eden east classroom', center: [42, -6]}, {id: 'eden-library-1', name: 'Library', center: [74, -7]},
 {id: 'region-park.pond', name: 'Park pond', center: [-6, 112]}, {id: 'region-campus.library-annex', name: 'Library annex', center: [-12, -121]},
];
const at = new Map<string, [number, number]>([...places.map(p => [p.id, p.center] as [string, [number, number]]),
 ['eden-classroom-seat-01', [40, -8]], ['social-eden-fire', [24, -7]], ['commons-bench-east', [12, 6]], ['commons-bench-west', [6, 6]], ['s_moss', [2, 2]], ['s_tinker', [3, 1]]]);
const where = new Map([['eden-classroom-seat-01', 'eden-classroom-1'], ['social-eden-fire', 'social-eden-fire-circle'], ['commons-bench-east', 'commons'], ['commons-bench-west', 'commons']]);
const P = (verb: string, id: string, label?: string): EdgeCapability => ({id: `${verb}:${id}`, verb, label: label ?? places.find(p => p.id === id)?.name ?? id, available: true, target: {id, kind: 'place'}});
const O = (verb: string, id: string, label = id, available = true): EdgeCapability => ({id: `${verb}:${id}`, verb, label, available, target: {id, kind: 'object'}});
const caps: EdgeCapability[] = [
 ...['commons', 'commons-deck', 'shore-water', 'shore-bank', 'social-eden-fire-circle', 'social-eden-dining', 'eden-classroom-1'].flatMap(id => [P('walk', id), P('hang-out', id)]),
 O('walk', 'eden-classroom-seat-01'), O('sit', 'eden-classroom-seat-01'), O('sit', 'commons-bench-east'), O('sit', 'commons-bench-west', 'commons-bench-west', false),
 O('warm-by-fire', 'social-eden-fire', 'Warm up by the fire with whoever is there'), {id: 'swim:shore-water', verb: 'swim', label: 'Swim in the supported pond', available: true, target: {id: 'shore-water', kind: 'place'}},
 {id: 'rest:here', verb: 'rest', label: 'Rest here', available: true}, {id: 'go-near:s_moss', verb: 'go-near', label: 'Go near Moss', available: true, target: {id: 's_moss', kind: 'soul'}},
 {id: 'go-near:s_tinker', verb: 'go-near', label: 'Go near Moss the Tinker', available: true, target: {id: 's_tinker', kind: 'soul'}},
];
const ctx = (me: [number, number] = [10, 5]): VocabContext => ({caps, places, root: ['eden'], me, target: c => {
 const t = c.target; if (!t) return {names: [], around: [], at: null};
 const p = places.find(x => x.id === t.id), w = where.get(t.id), wp = w ? places.find(x => x.id === w) : undefined;
 return {names: p ? [p.name] : t.kind === 'soul' ? [c.label.replace('Go near ', '')] : [], around: wp ? [wp.id, wp.name] : [], at: at.get(t.id) ?? null};
}});
const to = (input: string, me?: [number, number]) => {const r = resolveCapability(input, ctx(me)); return r.kind === 'unknown' ? {unknown: r.didYouMean.map(d => d.id)} : r.cap.id;};

test('vocabulary: exact ids win; natural names resolve when unambiguous', () => {
 assert.equal(to('walk:commons'), 'walk:commons');
 assert.equal(to('walk:pond'), 'walk:shore-water', 'pond is the pond');
 assert.equal(to('swim:pond'), 'swim:shore-water');
 assert.equal(to('walk:eden-pond'), 'walk:shore-water', 'the world name is ignored when the rest still names something');
 assert.equal(to('walk:eden-commons'), 'walk:commons');
 assert.equal(to('hang-out:commons-gathering-lawn'), 'hang-out:commons', 'by place name');
 assert.equal(to('hang-out:commons-deck[90]'), 'hang-out:commons-deck', 'bracket junk ignored');
 assert.equal(to('hang out at the deck'), 'hang-out:commons-deck', 'free text verb + words');
 assert.equal(to('go to the deck'), 'walk:commons-deck', 'verb synonym');
 assert.equal(to('warm-by-fire:social-eden-fire-circle'), 'warm-by-fire:social-eden-fire', 'the place an object stands in');
 assert.equal(to('rest'), 'rest:here');assert.equal(to('rest:on-the-grass'), 'rest:here', 'single non-targeted capability');
 assert.equal(to('go-near:Moss'), 'go-near:s_moss', 'exact Soul name beats Moss the Tinker');
 assert.equal(to('sit:commons'), 'sit:commons-bench-east', 'two benches there, only one free');
 assert.equal(to('sit:here', [11, 6]), 'sit:commons-bench-east', 'nearest free seat within reach');
});
test('vocabulary (CN5): a known place that cannot be reached is refused honestly (place.unreachable), never swapped for another place', () => {
 const lib = resolveCapability('walk:eden-library-1', ctx());assert.equal(lib.kind, 'unknown');assert.equal((lib as any).code, 'place.unreachable');assert.match((lib as any).reason, /Library is not walkable ground yet/);
 assert.equal((lib as any).didYouMean[0].id, 'walk:eden-classroom-1', 'the nearest whole place you can walk to, offered (not chosen)');
 const named = resolveCapability('walk:library', ctx());assert.equal(named.kind, 'unknown');assert.match((named as any).reason, /Library is not walkable/, 'Library (exact name) beats Library annex');
 const far = resolveCapability('walk:region-park.pond', ctx());assert.equal(far.kind, 'unknown');assert.match((far as any).reason, /not walkable ground yet/);
});
// Keep the published TAP identity; ambiguity now returns choices unless "nearest" is explicit.
test('vocabulary: several matches prefer the obvious one (nearest, with the others named); unknown names get did_you_mean', () => {
 const shore = resolveCapability('walk:shore', ctx());assert.equal(shore.kind, 'unknown');assert.equal((shore as any).code, 'place.ambiguous');assert.ok((shore as any).didYouMean.some((c:any)=>c.id==='walk:shore-water'));const near=resolveCapability('walk to nearest shore',ctx());assert.equal(near.kind,'alias');assert.equal((near as any).cap.id,'walk:shore-bank');
 const dining = to('walk:dining-common') as {unknown: string[]};assert.equal(dining.unknown[0], 'walk:social-eden-dining');
 const bogus = resolveCapability('dance:moon', ctx());assert.equal(bogus.kind, 'unknown');assert.match((bogus as any).reason, /No "dance" capability/);assert.ok((bogus as any).didYouMean.some((d: any) => d.id === 'rest:here'), 'real things to do');
 const sit = resolveCapability('sit:here', ctx([-40, 40]));assert.equal(sit.kind, 'alias');assert.equal((sit as any).cap.id, 'rest:here');assert.match((sit as any).note, /No free seat within 30 m/);
 assert.deepEqual(parseCapability('hang out at the deck', new Set(['hang-out'])), {verb: 'hang-out', rest: 'at the deck'});
});
test('vocabulary: everyday sentences become activities (activities/1) and places resolve by name, synonym and description', () => {
 const verbs = new Set(['walk', 'read', 'lie', 'nap', 'sit', 'sit-ground', 'stroll', 'play-piano', 'stand', 'warm-by-fire']);
 assert.equal(parseCapability('find somewhere to read a book', verbs).verb, 'read');assert.equal(parseCapability('find somewhere to read a book', verbs).rest, '');
 assert.equal(parseCapability('read a book in the library', verbs).verb, 'read');
 assert.equal(parseCapability('lie down', verbs).verb, 'lie');assert.equal(parseCapability('take a nap on the grass', verbs).verb, 'nap');
 assert.equal(parseCapability('sit down', verbs).verb, 'sit');assert.equal(parseCapability('take a seat', verbs).verb, 'sit');assert.equal(parseCapability('sit on the grass', verbs).verb, 'sit-ground');
 assert.equal(parseCapability('take a walk through the park', verbs).verb, 'stroll');assert.equal(parseCapability('come back to the fire', verbs).verb, 'walk');
 assert.equal(parseCapability('play the piano', verbs).verb, 'play-piano');
 const here = (id: string, verb: string): EdgeCapability => ({id, verb, label: id, available: true});
 const park = {id: 'region-park', name: 'Park with pond', center: [-5, 114] as [number, number], parent: 'eden', kind: 'outdoor', walkable: true, description: 'A green park round an oval pond with reeds, a ring path and benches; a white gazebo'};
 const gazebo = {id: 'region-park.gazebo', name: 'Park gazebo', center: [-28, 110] as [number, number], parent: 'region-park', kind: 'pavilion', walkable: true};
 const woods = {id: 'eden-north-woods', name: 'Northern woodland', center: [5, -47] as [number, number], parent: 'eden', kind: 'outdoor', walkable: true};
 const fire = {id: 'social-eden-fire-circle', name: 'Campfire clearing', center: [24, -7] as [number, number], parent: 'field', kind: 'outdoor', walkable: true};
 const ps = [...places, park, gazebo, woods, fire];
 const cs: EdgeCapability[] = [...caps, ...[park, gazebo, woods].map(p => P('walk', p.id, p.name)), {id: 'stroll:region-park', verb: 'stroll', label: 'Stroll through Park with pond', available: true, target: {id: 'region-park', kind: 'place'}},
  here('sit:here', 'sit'), here('lie:here', 'lie'), here('nap:here', 'nap'), here('read:here', 'read'), {id: 'read:eden-library-1', verb: 'read', label: 'Read a book in Library', available: true, target: {id: 'eden-library-1', kind: 'place'}}, here('wander:here', 'wander')];
 const c2: VocabContext = {...ctx(), caps: cs, places: ps, target: c => {const p = ps.find(x => x.id === c.target?.id); return p ? {names: [p.name], around: [], at: p.center} : ctx().target(c);}};
 const go = (s: string) => {const r = resolveCapability(s, c2); return r.kind === 'unknown' ? 'unknown: ' + r.reason : r.cap.id;};
 assert.equal(go('sit down'), 'sit:commons-bench-east');assert.equal(go('take a seat'), 'sit:commons-bench-east');assert.equal(go('lie down'), 'lie:here');assert.equal(go('take a nap'), 'nap:here');
 assert.equal(go('find somewhere to read a book'), 'read:here');assert.equal(go('read a book in the library'), 'read:eden-library-1');
 assert.equal(go('walk:park'), 'walk:region-park', 'the park, not its gazebo');assert.equal(go('go to the park'), 'walk:region-park');
 assert.equal(go('take a walk through the park'), 'stroll:region-park');assert.equal(go('stroll'), 'wander:here');
 assert.equal(go('walk to the woods'), 'walk:eden-north-woods', 'synonym woods → woodland');assert.equal(go('walk:forest'), 'walk:eden-north-woods');
 assert.equal(go('come back to the fire'), 'walk:social-eden-fire-circle');assert.equal(go('walk:campfire'), 'walk:social-eden-fire-circle');
 assert.equal(go('walk:gazebo'), 'walk:region-park.gazebo');
});
test('vocabulary (audit P0a): "go for a X" resolves X; rides join the balloon; unsupported motions are refused honestly', () => {
 const join: EdgeCapability = {id: 'object:ride-eden-balloon:join', verb: 'object', label: 'Take a ride: walk to the boarding step and climb into the basket (Red balloon)', available: true, object: 'ride-eden-balloon', action: 'join'};
 const here = (id: string, verb: string): EdgeCapability => ({id, verb, label: id, available: true});
 const cs = [...caps, join, here('wander:here', 'wander'), here('dance:here', 'dance'), here('situps:here', 'situps'), here('pushups:here', 'pushups'), here('jumping-jacks:here', 'jumping-jacks'), here('nap:here', 'nap'), here('wave:s_moss', 'wave')];
 const c3: VocabContext = {...ctx(), caps: cs};
 const go = (s: string) => {const r = resolveCapability(s, c3); return r.kind === 'unknown' ? 'unknown' : r.cap.id;};
 assert.equal(go('go for a swim'), 'swim:shore-water');assert.equal(go('go for a walk'), 'wander:here');assert.equal(go('take a nap'), 'nap:here');
 assert.equal(go('go for a balloon ride'), join.id);assert.equal(go('ride the balloon'), join.id);assert.equal(go('fly in the balloon'), join.id);assert.equal(go('take a ride'), join.id);
 for (const s of ['go for a run', 'run to the deck', 'jog around', 'give Moss a hug', 'go for a jog']) {const r = resolveCapability(s, c3);assert.equal(r.kind, 'unknown', s);}
 assert.match((resolveCapability('go for a run', c3) as any).reason, /No "run-around" capability/);
 assert.equal(go('do some sit-ups'), 'situps:here');assert.equal(go('do push ups'), 'pushups:here');assert.equal(go('jumping jacks'), 'jumping-jacks:here');assert.equal(go('dance'), 'dance:here');
});
test('vocabulary (CN5): computers, stage music, singing, the audience, the gym and park games in plain words; nothing named → the nearest free spot', () => {
 const S = (verb: string, id: string, label: string, at: [number, number], extra: string[] = []): EdgeCapability & {at: [number, number]; names: string[]} => ({id: `${verb}:${id}`, verb, label, available: true, target: {id, kind: 'spot'}, at, names: [label, ...extra]});
 const spots = [S('use-computer', 'pc-house-3', 'Use the computer (Laptop at the house 3 bedroom desk)', [29, 30]), S('use-computer', 'pc-office-1', 'Use the computer (Office workstation 1)', [91, 16]),
  S('play-music', 'stage-drums', 'Play the drums (Drum kit on the performance stage)', [92, -31], ['drums']), S('play-music', 'band-chair-4', 'Play the cello (Bandstand quartet chair 4 (cello))', [39, -26], ['cello']),
  S('play-music', 'amph-guitar', 'Play the guitar (Stool and guitar on the amphitheatre stage)', [76, 80], ['guitar']), S('sing', 'amph-mic', 'Sing at the microphone (Microphone on the amphitheatre stage)', [76, 80]),
  S('sing', 'stage-mic-1', 'Sing at the microphone (Lead microphone on the performance stage)', [92, -29]), S('listen', 'amph-seat-2-1', 'Sit in the audience and listen (Amphitheatre step 2, seat 1)', [77, 83]),
  S('bench-press', 'gym-bench-press', 'Do a bench press (Outdoor gym: bench press)', [30, 110]), S('lift-weights', 'gym-weights', 'Lift weights (dumbbell curls) (Outdoor gym: dumbbells)', [30, 112]),
  S('pull-ups', 'gym-pull-ups-1', 'Do pull-ups (Outdoor gym: low pull-up bar)', [29, 100]), S('dips', 'gym-dips', 'Do dips on the bars (Outdoor gym: dip bars)', [30, 102]),
  S('play-petanque', 'sport-petanque-1', 'Play pétanque (Petanque court, throwing end)', [1, 123]), S('play-frisbee', 'sport-frisbee-1', 'Throw a frisbee (Frisbee lawn, north end)', [5, 113]),
  S('play-volleyball', 'sport-volleyball-3', 'Play beach volleyball (Beach volleyball court, east side)', [22, 114])];
 const around = new Map([['amph-mic', ['eden-amphitheatre', 'Amphitheatre']], ['stage-mic-1', ['eden-performance-stage', 'Performance stage']], ['amph-guitar', ['eden-amphitheatre', 'Amphitheatre']]]);
 const c5: VocabContext = {...ctx([10, 5]), caps: [...caps, ...spots], target: c => {const s = spots.find(x => x.id === c.id); return s ? {names: s.names, around: around.get(c.target!.id) ?? [], at: s.at} : ctx().target(c);}};
 const go = (s: string) => {const r = resolveCapability(s, c5); return r.kind === 'unknown' ? 'unknown: ' + r.reason : r.cap.id;};
 assert.equal(go('use a computer'), 'use-computer:pc-house-3', 'the nearest free computer');assert.equal(go('check my email on a computer in the office'), 'use-computer:pc-office-1');
 assert.equal(go('play the drums'), 'play-music:stage-drums');assert.equal(go('play the cello'), 'play-music:band-chair-4');assert.equal(go('play guitar'), 'play-music:amph-guitar');
 assert.equal(go('sing at the amphitheatre'), 'sing:amph-mic');assert.equal(go('sing on the performance stage'), 'sing:stage-mic-1');assert.equal(go('listen to the concert'), 'listen:amph-seat-2-1');
 assert.equal(go('do a bench press'), 'bench-press:gym-bench-press');assert.equal(go('lift weights'), 'lift-weights:gym-weights');assert.equal(go('do some pull-ups'), 'pull-ups:gym-pull-ups-1');assert.equal(go('dips'), 'dips:gym-dips');
 assert.equal(go('play petanque'), 'play-petanque:sport-petanque-1');assert.equal(go('play boules'), 'play-petanque:sport-petanque-1');assert.equal(go('throw a frisbee'), 'play-frisbee:sport-frisbee-1');
 assert.equal(go('play beach volleyball'), 'play-volleyball:sport-volleyball-3');assert.equal(go('go for a swim'), 'swim:shore-water', 'a swim is still a swim');
});
test('vocabulary (CN5 acceptance): verbs never swap either — "go fishing" refused, "go swimming" swims, "A, then B" walks chain, a solo wave', () => {
 const here = (id: string, verb: string): EdgeCapability => ({id, verb, label: id, available: true});
 const park = {id: 'region-park', name: 'Park with pond', center: [-5, 114] as [number, number], parent: 'eden', kind: 'outdoor', walkable: true};
 const ps = [...places, park, {id: 'region-park.playground', name: 'Playground', center: [19, 103] as [number, number], parent: 'region-park', kind: 'playground', walkable: true}];
 const cs: EdgeCapability[] = [...caps, P('walk', 'region-park', 'Park with pond'), P('walk', 'region-park.playground', 'Playground'), {id: 'stroll:region-park', verb: 'stroll', label: 'Stroll through Park with pond', available: true, target: {id: 'region-park', kind: 'place'}},
  here('wave:here', 'wave'), here('wander:here', 'wander'), here('sit:here', 'sit'), here('dance:here', 'dance'), {id: 'wave:s_moss', verb: 'wave', label: 'Wave to Moss', available: true, target: {id: 's_moss', kind: 'soul'}}];
 const c6: VocabContext = {...ctx(), caps: cs, places: ps, target: c => {const p = ps.find(x => x.id === c.target?.id); return p ? {names: [p.name], around: [], at: p.center} : ctx().target(c);}};
 const r = (s: string) => resolveCapability(s, c6);
 for (const s of ['go fishing', "let's go fishing at the pond", 'row a boat', 'go on the swings', 'feed the ducks', 'go bowling']) assert.equal(r(s).kind, 'unknown', s);
 assert.match((r('go bowling') as any).reason, /not something bodies can do here yet/);
 assert.equal((r('go swimming') as any).cap.id, 'swim:shore-water');
 const two = r('take a walk through the park, then come back to the fire') as any;
 assert.equal(two.kind, 'alias'); assert.equal(two.cap.id, 'walk:social-eden-fire-circle'); assert.deepEqual(two.params, {via: ['stroll:region-park']});
 const mixed = r('sit down then dance') as any; assert.equal(mixed.kind, 'alias'); assert.match(mixed.note, /act again for "dance"/);
 assert.equal((r('wave') as any).cap.id, 'wave:here', 'a solo wave'); assert.equal((r('wave to Moss') as any).cap.id, 'wave:s_moss');
 assert.equal((r('walk to the fish market') as any).kind, 'unknown', 'a place word with fish is a place, refused as unknown place, not "fishing"');
});


test('real-fire qualifier keeps sit as an offered fire seat, warm as the actual fire, and refuses missing/named alternatives',()=>{
 const seat:EdgeCapability={id:'sit:fire-bench',verb:'sit',label:'Fire Bench South',target:{id:'fire-bench',kind:'object'},available:true};
 const fire:EdgeCapability={id:'warm-by-fire:actual-fire',verb:'warm-by-fire',label:'Warm by the fire',target:{id:'actual-fire',kind:'object'},available:true};
 const ordinary:EdgeCapability={id:'sit:plain-bench',verb:'sit',label:'Nearer ordinary bench',target:{id:'plain-bench',kind:'object'},available:true};
 const c:VocabContext={caps:[seat,fire,ordinary],places:[],root:['eden'],me:[0,0],target:cap=>({names:[cap.label],around:[],at:cap===ordinary?[1,0]:[12,0]})};
 for(const verb of ['sit','warm'])for(const prep of ['by','near','beside'])for(const article of ['a','the'])for(const noun of ['fire','campfire']){
  const words=`${verb} ${prep} ${article} real ${noun}`,r=resolveCapability(words,c);assert.notEqual(r.kind,'unknown',words);if(r.kind==='unknown')throw Error(words);
  assert.equal(r.cap.id,verb==='sit'?seat.id:fire.id,words);assert.equal(r.cap.verb,verb==='sit'?'sit':'warm-by-fire','never turn sitting into warming');
 }
 const missing={...c,caps:[seat,ordinary]};assert.equal(resolveCapability('sit by a real fire',missing).kind,'unknown','a fire seat label does not invent a missing actual fire');
 for(const words of ['sit by a real fire on the moon','sit by a real fountain','sit:real fire','warm-by-fire:real fire'])assert.equal(resolveCapability(words,c).kind,'unknown',words);
 const named:EdgeCapability={...seat,id:'sit:real-fire-bench',label:'Real Fire Bench',target:{id:'real-fire-bench',kind:'object'}};
 const explicit=resolveCapability(named.id,{...c,caps:[...c.caps,named]});assert.equal(explicit.kind,'exact');assert.equal(explicit.cap.id,named.id,'explicit named ID untouched');
});


test('todo gaits and water rides resolve only to the requested activity and named place', () => {
 const jog = P('jog', 'commons'), run = P('run', 'commons-deck'), loop = P('jog-around', 'shore-water');
 const punt: EdgeCapability = {id:'object:ride-eden-punt:join',verb:'object',object:'ride-eden-punt',action:'join',label:'Join ride (Pond rowing punt)',available:true};
 const balloon: EdgeCapability = {id:'object:ride-balloon:join',verb:'object',object:'ride-balloon',action:'join',label:'Join ride (Red balloon)',available:true};
 const c: VocabContext = {...ctx(),caps:[...caps,jog,run,loop,punt,balloon]};
 const id=(s:string)=>{const r=resolveCapability(s,c); assert.notEqual(r.kind,'unknown',s+' '+JSON.stringify(r));return r.kind==='unknown'?'':r.cap.id;};
 assert.equal(id('jog to the commons'),jog.id);
 assert.equal(id('go to the deck running'),run.id);
 assert.equal(id('run to the deck'),run.id);
 assert.equal(id('go for a jog around the pond'),loop.id);
 assert.equal(id('jog around pond'),loop.id);
 for(const s of ['row a boat','go rowing','row the punt','go for a punt ride'])assert.equal(id(s),punt.id,s);
 assert.equal(id('ride the balloon'),balloon.id);
 for(const s of ['go to the boat','walk to the punt','sit by the boat']){const r=resolveCapability(s,c);assert.ok(r.kind==='unknown'||r.cap.id!==punt.id,s+' never boards unasked');}
 const noWater=resolveCapability('row a boat',{...c,caps:c.caps.filter(x=>x!==punt)});
 assert.equal(noWater.kind,'unknown');assert.equal((noWater as any).code,'ride.no-water-route');
 assert.equal(resolveCapability('row a boat on the moon',c).kind,'unknown','unknown named water is never another ride');
 assert.equal(resolveCapability('go fishing',c).kind,'unknown');assert.equal(resolveCapability('go sailing',c).kind,'unknown');
 assert.equal(resolveCapability('run to the moon',c).kind,'unknown','never select another run target');
});

test('todo named gait places refuse instead of substituting a park description or Library annex', () => {
 const pond:VocabPlace={id:'shore-water',name:'The pond (connected calm water)',aliases:['pond','the pond'],kind:'water',center:[-50,0]};
 const park:VocabPlace={id:'region-park',name:'Park with pond',kind:'outdoor',center:[0,50]};
 const library:VocabPlace={id:'library',name:'Library',center:[60,0]},annex:VocabPlace={id:'library-annex',name:'Library annex',center:[65,0]};
 const known=[pond,park,library,annex];
 for(const verb of ['jog','run','jog-around','run-around']){
  const offers=[park,annex].map(p=>P(verb,p.id,`${verb} ${p.name}`));
  const c:VocabContext={...ctx(),caps:offers,places:known,target:c=>{const p=known.find(p=>p.id===c.target?.id);return {names:p?[p.name]:[],around:[],at:p?.center??null};}};
  for(const input of [`${verb}:pond`,`${verb}:the pond`,`${verb}:eden pond`,`${verb}:Library`]){
   const r=resolveCapability(input,c);assert.equal(r.kind,'unknown',input+' '+JSON.stringify(r));if(r.kind!=='unknown')continue;
   assert.equal(r.code,verb.endsWith('-around')&&input.toLowerCase().includes('pond')?'gait.no-bank-loop':'gait.unavailable');assert.match(r.reason,/nothing else was chosen/);
  }
  if(!verb.endsWith('-around')){const r=resolveCapability(`go to the pond ${verb==='run'?'running':'jogging'}`,c);assert.equal(r.kind,'unknown');}
 }
});

test('todo around-pond aliases identify the native pond before a separately offered park pond', () => {
 const native:VocabPlace={id:'shore-water',name:'Connected calm water',aliases:['pond','the pond'],kind:'water',center:[-50,0]};
 const parkPond:VocabPlace={id:'region-park.pond',name:'Park pond',kind:'water',center:[0,50]},known=[native,parkPond];
 for(const verb of ['jog-around','run-around']){
  const park=P(verb,parkPond.id,`${verb} ${parkPond.name}`),home=P(verb,native.id,`${verb} ${native.name}`);
  const c:VocabContext={...ctx(),caps:[park],places:known,target:c=>{const p=known.find(p=>p.id===c.target?.id);return {names:p?[p.name]:[],around:[],at:p?.center??null};}};
  const no=resolveCapability(`${verb}:pond`,c);assert.equal(no.kind,'unknown');if(no.kind==='unknown')assert.equal(no.code,'gait.no-bank-loop');
  const named=resolveCapability(`${verb}:park pond`,c);assert.notEqual(named.kind,'unknown');if(named.kind!=='unknown')assert.equal(named.cap.id,park.id);
  const yes=resolveCapability(`${verb==='jog-around'?'go for a jog':'run'} around the pond`,{...c,caps:[park,home]});assert.notEqual(yes.kind,'unknown');if(yes.kind!=='unknown')assert.equal(yes.cap.id,home.id);
 }
});

test('todo an authored world-engine Pond name still resolves its offered natural loop', () => {
 const pond:VocabPlace={id:'god-place-pond',name:'Pond',kind:'water',center:[12,4]};
 const loop=P('jog-around',pond.id,'Jog around Pond'),c:VocabContext={...ctx(),caps:[loop],places:[pond],target:()=>({names:['Pond'],around:[],at:pond.center})};
 const r=resolveCapability('go for a jog around the pond',c);assert.notEqual(r.kind,'unknown');if(r.kind!=='unknown')assert.equal(r.cap.id,loop.id);
});

test('vocabulary (SOULSIM-E): a thing answers to its everyday synonyms after its own words fail (Mars: sit by the campfire)', () => {
 // Mars's fire circle: benches "Fire bench (north/south)" in the place "Fire circle"; "sit by the fire" already sat on one
 const mp: VocabPlace[] = [{id: 'fire-circle', name: 'Fire circle', center: [0, 0]}, {id: 'kitchen', name: 'Kitchen', center: [30, 0]}];
 const mcaps: EdgeCapability[] = [O('sit', 'fire-bench-north', 'Fire bench (north)'), O('sit', 'fire-bench-south', 'Fire bench (south)'), O('sit', 'reading-chair', 'Reading chair'),
  {id: 'sit:here', verb: 'sit', label: 'Sit down on the nearest free seat', available: true}, P('walk', 'fire-circle', 'Fire circle'), P('walk', 'kitchen', 'Kitchen')];
 const mat = new Map<string, [number, number]>([['fire-bench-north', [0, 3]], ['fire-bench-south', [0, -3]], ['reading-chair', [9, 0]], ['fire-circle', [0, 0]], ['kitchen', [30, 0]]]);
 const mctx: VocabContext = {caps: mcaps, places: mp, root: ['mars'], me: [1, 4], target: c => {
  const t = c.target; if (!t) return {names: [], around: [], at: null};
  const p = mp.find(x => x.id === t.id), w = t.id.startsWith('fire-bench') ? mp[0] : undefined;
  return {names: p ? [p.name] : [], around: w ? [w.id, w.name] : [], at: mat.get(t.id) ?? null};
 }};
 const go = (input: string) => {const r = resolveCapability(input, mctx); return r.kind === 'unknown' ? `unknown:${r.code ?? ''}` : r.cap.id;};
 assert.equal(go('sit by the fire'), 'sit:fire-bench-north', 'unchanged: the exact word');
 assert.equal(go('sit by the campfire'), 'sit:fire-bench-north', 'campfire is the fire (nearest bench)');
 assert.equal(go('sit by the bonfire'), 'sit:fire-bench-north');
 assert.equal(go('sit in the reading chair'), 'sit:reading-chair', 'unchanged');
 assert.equal(go('walk to the campfire'), 'walk:fire-circle', 'places keep their own path (3b)');
 assert.match(go('sit by the waterfall'), /^unknown/, 'no synonym, no swap');
});

test('vocabulary (D2, playtest 2026-10-25): "house 2" is the house named 2, never a label\'s "(2 m)" or "2 rooms"; room words go to rooms, not kitchen chairs', () => {
 const hp: VocabPlace[] = [
  {id: 'g-eden-house-1', name: 'eden-house-1', center: [32, 17], kind: 'building', parent: null, walkable: true},
  {id: 'g-eden-house-1.kitchen', name: 'eden-house-1/kitchen', center: [31, 17], kind: 'room', parent: 'g-eden-house-1', walkable: true},
  {id: 'g-eden-house-2', name: 'eden-house-2', center: [50, 15], kind: 'building', parent: null, walkable: true},
  {id: 'g-eden-house-2.kitchen', name: 'eden-house-2/kitchen', center: [49, 15], kind: 'room', parent: 'g-eden-house-2', walkable: true},
 ] as VocabPlace[];
 const W = (id: string, label: string): EdgeCapability => ({id: `walk:${hp.find(p => p.id === id)!.name}`, verb: 'walk', label, available: true, target: {id, kind: 'place'}});
 const hcaps: EdgeCapability[] = [
  W('g-eden-house-1', 'Walk to eden-house-1, a house: in at its front door (2 rooms, each walk:eden-house-1/<room>; 4 m)'), W('g-eden-house-1.kitchen', 'Go into Kitchen of eden-house-1 (eden-house-1/kitchen; 2 m)'),
  W('g-eden-house-2', 'Walk to eden-house-2, a house: in at its front door (2 rooms, each walk:eden-house-2/<room>; 20 m)'), W('g-eden-house-2.kitchen', 'Go into Kitchen of eden-house-2 (eden-house-2/kitchen; 18 m)'),
  {id: 'walk:eden-house-1/kitchen-chair-2', verb: 'walk', label: 'Walk to eden-house-1/kitchen-chair-2, a chair in eden-house-1, by eden-house-1/kitchen-chair-1 (8 m)', available: true, target: {id: 'e_chair2', kind: 'object'}},
 ];
 const hctx = (me: [number, number], caps = hcaps): VocabContext => ({caps, places: hp, root: ['eden'], me, target: c => {
  const p = hp.find(x => x.id === c.target?.id); return {names: p ? [p.name] : [], around: c.target?.id === 'e_chair2' ? ['g-eden-house-1.kitchen', 'eden-house-1/kitchen'] : [], at: p ? p.center : [31, 17]};
 }});
 const go = (q: string, c: VocabContext) => {const r = resolveCapability(q, c); return r.kind === 'unknown' ? 'unknown' : r.cap.id;};
 for (const q of ['go inside house 2, into the kitchen', 'walk to the kitchen in house 2', 'go to the kitchen of house 2']) assert.equal(go(q, hctx([31.8, 17.2])), 'walk:eden-house-2/kitchen', q);
 assert.equal(go('go into house 2', hctx([31.8, 17.2])), 'walk:eden-house-2');
 assert.equal(go('go to the kitchen', hctx([20, 10], hcaps.filter(c => c.id !== 'walk:eden-house-1/kitchen'))), 'walk:eden-house-2/kitchen', 'a room word names the room, not the nearer kitchen chair');
 assert.equal(go('go to the kitchen chair', hctx([31.8, 17.2])), 'walk:eden-house-1/kitchen-chair-2', 'the chair, when the words say chair');
});

test('vocabulary (D3b, cloud fix-r3 basics-1 pip-010): "house 2" / "house two" never resolves into house 1, offered room or not', () => {
 const hp: VocabPlace[] = [
  {id: 'g-eden-house-1', name: 'eden-house-1', center: [32, 17], kind: 'building', parent: null, walkable: true},
  {id: 'g-eden-house-1.kitchen', name: 'eden-house-1/kitchen', center: [31, 17], kind: 'room', parent: 'g-eden-house-1', walkable: true},
  {id: 'g-eden-house-2', name: 'eden-house-2', center: [50, 15], kind: 'building', parent: null, walkable: true},
  {id: 'g-eden-house-2.kitchen', name: 'eden-house-2/kitchen', center: [49, 15], kind: 'room', parent: 'g-eden-house-2', walkable: true},
 ] as VocabPlace[];
 const W = (id: string, label: string): EdgeCapability => ({id: `walk:${hp.find(p => p.id === id)!.name}`, verb: 'walk', label, available: true, target: {id, kind: 'place'}});
 const chair: EdgeCapability = {id: 'walk:eden-house-1/kitchen-chair-2', verb: 'walk', label: 'Walk to eden-house-1/kitchen-chair-2, a chair in eden-house-1, by eden-house-1/kitchen-chair-1 (8 m)', available: true, target: {id: 'e_chair2', kind: 'object'}};
 const all: EdgeCapability[] = [
  W('g-eden-house-1', 'Walk to eden-house-1, a house: in at its front door (2 rooms, each walk:eden-house-1/<room>; 4 m)'), W('g-eden-house-1.kitchen', 'Go into Kitchen of eden-house-1 (eden-house-1/kitchen; 2 m)'),
  W('g-eden-house-2', 'Walk to eden-house-2, a house: in at its front door (2 rooms, each walk:eden-house-2/<room>; 20 m)'), W('g-eden-house-2.kitchen', 'Go into Kitchen of eden-house-2 (eden-house-2/kitchen; 18 m)'), chair,
 ];
 const ctx = (caps: EdgeCapability[]): VocabContext => ({caps, places: hp, root: ['eden'], me: [31.8, 17.2], target: c => {
  const p = hp.find(x => x.id === c.target?.id); return {names: p ? [p.name] : [], around: c.target?.id === 'e_chair2' ? ['g-eden-house-1.kitchen', 'eden-house-1/kitchen'] : [], at: p ? p.center : [31, 17]};
 }});
 const go = (q: string, caps: EdgeCapability[]) => {const r = resolveCapability(q, ctx(caps)); return r.kind === 'unknown' ? 'unknown' : r.cap.id;};
 const asked = ['walk to the kitchen in eden-house-2', 'go inside house 2, into the kitchen', 'go inside house two, into the kitchen', 'walk to the kitchen of house two'];
 for (const q of asked) assert.equal(go(q, all), 'walk:eden-house-2/kitchen', q);
 // the playtest: house 2's kitchen not offered from where the Soul stood; "chair-2" in house 1 matched every word before
 const far = all.filter(c => c.id !== 'walk:eden-house-2/kitchen');
 for (const q of asked) assert.equal(go(q, far), 'walk:eden-house-2', q + ' (the house that holds the kitchen, never house 1)');
 assert.equal(go('walk to kitchen chair 2', all), chair.id, 'a number after "chair" still names chair-2');
 assert.equal(go('walk to house one', all), 'walk:eden-house-1', 'a number word after a numbered word');
 assert.deepEqual(numberWords(['red', 'one'], () => [['eden', 'house', '1']]), ['red', 'one'], 'a number word after an unnumbered word stays a word');
 assert.equal(numberConflict(['house', '2'], [['eden', 'house', '1', 'kitchen', 'chair', '2']]), true);
 assert.equal(numberConflict(['house', '2'], [['eden', 'house', '2', 'kitchen'], ['by', 'eden', 'house', '1']]), false);
});

// #1051 (review): "stop the record" takes only a record player's offer that can happen, and only when there is one
test('record words: one playing record player, or the ordinary way', () => {
  const mk = (o: string, action: string, available = true, n = 'player') => ({id: `object:${o}:${action}`, verb: 'object', object: o, action, label: `${action} (${n})`, available, ...(available ? {} : {blocked: {code: 'object.state', reason: 'off'}}), target: {id: o, kind: 'object'}}) as any;
  const go = (t: string, caps: any[]) => { const r: any = resolveCapability(t, {caps, target: () => ({names: [], around: [], at: [1, 1]}), places: [], roots: [], me: [0, 0]} as any); return r.cap?.id ?? r.code ?? r.kind; };
  const on = [mk('e_aaaa0001', 'put-on-record'), mk('e_aaaa0001', 'switch-off')], off = [mk('e_bbbb0002', 'put-on-record'), mk('e_bbbb0002', 'switch-off', false)];
  assert.equal(go('stop the record', [...off, ...on]), 'object:e_aaaa0001:switch-off', 'the playing one, wherever it comes in the list');
  assert.equal(go('stop the record', [...on, mk('e_cccc0003', 'put-on-record'), mk('e_cccc0003', 'switch-off')]), 'unknown', 'two playing: neither is picked');
  assert.notEqual(go('stop the record', [...off, mk('e_dddd0004', 'switch-off', true, 'radio')]), 'object:e_dddd0004:switch-off', 'a silent player: not the radio beside it');
});
