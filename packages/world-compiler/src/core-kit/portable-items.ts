// New revisions opt into the native item clock; frozen predecessors keep their bytes.
import { SWITCHABLE_LIGHTS } from './switchable-lights.ts';
import kitchen from './kitchen.json' with {type:'json'};
import type {DefInput} from '../schemas.ts';
/** #441 (W107): three balls, carried as one thing; the `juggling` tag is what offers `juggle:<id>` while it is held. */
const JUGGLING_BALLS:DefInput={schema:'def/1',name:'core-juggling-balls',version:1,description:'Three juggling balls (carryable; a Soul holding them can juggle).',tags:['toy','item','balls','juggling'],form:'point',
 make:{kind:'gen',gen:'kit/2',args:{shapes:[{kind:'sphere',at:[-.042,.04,.024],r:.04,segments:6,tint:'one'},{kind:'sphere',at:[.042,.04,.024],r:.04,segments:6,tint:'two'},{kind:'sphere',at:[0,.04,-.048],r:.04,segments:6,tint:'three'}],round:.015}},
 params:{one:{type:'color',default:'#e2583e',doc:'first ball colour'},two:{type:'color',default:'#e8b93c',doc:'second ball colour'},three:{type:'color',default:'#3f8fc4',doc:'third ball colour'}},
 components:{carryable:{mass:.3,grips:1}},layer:'decor',palette:{one:'#e2583e',two:'#e8b93c',three:'#3f8fc4'},size:{box:[.17,.08,.16]}} as unknown as DefInput;
export const PORTABLE_ITEMS:DefInput[] = [
  {...structuredClone(SWITCHABLE_LIGHTS.find(d=>d.name==='core-lantern')!),version:3},
  {...structuredClone(kitchen.find(d=>d.name==='core-bowl')!) as unknown as DefInput,version:2},
  JUGGLING_BALLS,
].map(d=>({...d,tags:[...(d.tags??[]),'recorded-item']}));
