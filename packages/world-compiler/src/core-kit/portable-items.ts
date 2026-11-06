// New revisions opt into the native item clock; frozen predecessors keep their bytes.
import { SWITCHABLE_LIGHTS } from './switchable-lights.ts';
import kitchen from './kitchen.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';
/** #441 (W108): a kite and its string on a spool, carried as one thing; the `kite` tag is what offers `kite:<id>` while it is held. */
const KITE:DefInput={schema:'def/1',name:'core-kite',version:2,description:'A paper kite with its string on a spool, small enough to carry (a Soul holding it can fly it).',tags:['toy','item','kite'],form:'point',
 make:{kind:'gen',gen:'kit/2',args:{shapes:[{kind:'box',at:[.03,.2,0],size:[.012,.42,.3],round:0,tint:'sail'},{kind:'box',at:[.03,.2,0],size:[.016,.42,.012],round:0,tint:'spar'},{kind:'box',at:[.03,.22,0],size:[.016,.012,.3],round:0,tint:'spar'},{kind:'cyl',at:[.03,.03,0],r:.03,h:.06,segments:8,tint:'spar'}],round:.002}},
 params:{sail:{type:'color',default:'#d9483b',doc:'sail colour'},spar:{type:'color',default:'#8a6a3f',doc:'spars and spool colour'}},
 components:{carryable:{mass:.2,grips:1}},layer:'decor',palette:{sail:'#d9483b',spar:'#8a6a3f'},size:{box:[.07,.42,.3]}} as unknown as DefInput;
/** #441 (W107): three balls, carried as one thing; the `juggling` tag is what offers `juggle:<id>` while it is held. */
const JUGGLING_BALLS:DefInput={schema:'def/1',name:'core-juggling-balls',version:1,description:'Three juggling balls (carryable; a Soul holding them can juggle).',tags:['toy','item','balls','juggling'],form:'point',
 make:{kind:'gen',gen:'kit/2',args:{shapes:[{kind:'sphere',at:[-.042,.04,.024],r:.04,segments:6,tint:'one'},{kind:'sphere',at:[.042,.04,.024],r:.04,segments:6,tint:'two'},{kind:'sphere',at:[0,.04,-.048],r:.04,segments:6,tint:'three'}],round:.015}},
 params:{one:{type:'color',default:'#e2583e',doc:'first ball colour'},two:{type:'color',default:'#e8b93c',doc:'second ball colour'},three:{type:'color',default:'#3f8fc4',doc:'third ball colour'}},
 components:{carryable:{mass:.3,grips:1}},layer:'decor',palette:{one:'#e2583e',two:'#e8b93c',three:'#3f8fc4'},size:{box:[.17,.08,.16]}} as unknown as DefInput;
export const PORTABLE_ITEMS:DefInput[] = [
  {...structuredClone(SWITCHABLE_LIGHTS.find(d=>d.name==='core-lantern')!),version:3},
  {...structuredClone(kitchen.find(d=>d.name==='core-bowl')!) as unknown as DefInput,version:2},
  JUGGLING_BALLS,
  KITE,
].map(d=>({...d,tags:[...(d.tags??[]),'recorded-item']}));
