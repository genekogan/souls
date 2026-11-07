// LINK card fixtures: every owner and visitor state as SoulCardView props, for the component tests and the shot page.
import type {PublicSoul} from '@souls/protocol';
import type {SoulCardViewProps} from './SoulCard.tsx';
import type {AgentHere} from './agent-presence.ts';
import type {Link} from './soul-state.ts';
const T=Date.UTC(2026,9,24,14,30),min=60_000;
const soul=(id:string,name:string,description='A new Soul.'):PublicSoul=>({id,entityId:'h_'+id,name,description,owner:'o1',intent:null,intentText:'',mood:'',energy:'fine',doing:'',native:true});
const mickey=soul('s_7f3mickey','Mickey'),wren=soul('s_wren','Wren');
const here=(state:AgentHere['state'],link:Link|null):AgentHere=>({away:state==='away',state,since:T-20*min,waiting:0,readAt:T,lastSeenAt:T-20*min,link});
const prompt='Read https://sim.eden.art/worlds/w/eden-2026/SKILL.md and resume my existing Soul "Mickey" (ID "s_7f3mickey") in this folder. Do not create another Soul.\nIf this folder is not paired with it yet, run node eden-agent.mjs pair-soul "s_7f3mickey" --for K7QX-M2PA (the request comes up in my open Sim window), then node eden-agent.mjs approval wait; then listen as the skill says.';
const connected:Link={state:'connected',reason:'listening',since:T-28*min,holder:{label:'eden-agent 1.9.16',since:T-28*min}};
const off=(reason:Link['reason'],since:number|null=T-2*60*min):Link=>({state:'disconnected',reason,since,holder:null});
const camera={following:false,follow(){},stop(){}};
const inbox={connected:true,lastSeenAt:T,latest:{id:'m1',text:'go to the pond',state:'acknowledged' as const,reply:null,result:'Arrived at the pond.',outcome:'done' as const,sentAt:T-5*min},queued:0,presence:'listening' as const};
const owner=(link:Link|null,extra:Partial<SoulCardViewProps>={}):SoulCardViewProps=>({soul:mickey,view:'owner',link,here:here(link?.state==='connected'?'listening':'away',link),inbox,send:async()=>inbox,prompt,camera,clock:T,body:{state:'awake',doing:null,since:T-28*min},now:{text:'Heading to the pond to see if the koi are up.',at:T-3*min},place:'the pond',...extra});
const lastNow={text:'Heading to the pond to see if the koi are up.',at:T-2*60*min};
export const CARD_FIXTURES:Record<string,SoulCardViewProps>={
 'connected':owner(connected),
 'connected-open':owner(connected,{open:{details:true,pair:true}}),
 'connected-idle':owner(connected,{body:{state:'idle',doing:'dozing',since:T-40*min},now:{text:'Watching the koi. Nothing to do for now.',at:T-40*min}}),
 'disconnected-zombie':owner(off('stopped-listening',T-10*min),{body:{state:'zombie',doing:null,since:T-10*min},now:lastNow}),
 'disconnected-asleep':owner(off('stopped-listening'),{body:{state:'asleep',doing:null,since:T-2*60*min},now:lastNow}),
 'disconnected-floating':owner(off('stopped-listening'),{body:{state:'asleep',doing:'floating',since:T-90*min},now:lastNow}),
 'disconnected-replaced':owner(off('replaced',T-50*min),{body:{state:'zombie',doing:null,since:T-50*min},now:lastNow}),
 'disconnected-revoked':owner(off('revoked',T-45*min),{body:{state:'asleep',doing:null,since:T-15*min},now:lastNow}),
 'disconnected-never':owner(off('never',null),{body:{state:'asleep',doing:null,since:T-5*min},now:null,place:'the commons'}),
 'approved-waiting':owner(off('approved-waiting',T-20_000),{body:{state:'awake',doing:'standing',since:T-20_000},now:null,place:'the commons'}),
 'approved-waiting-late':owner(off('approved-waiting',T-90_000),{body:{state:'awake',doing:'standing',since:T-90_000},now:null,place:'the commons'}),
 'approved-waiting-asleep':owner(off('approved-waiting',T-30*min),{body:{state:'asleep',doing:null,since:T-10*min},now:null,place:'the commons'}),
 'pairing':owner({state:'pairing',reason:'pending-approval',since:T-10_000,holder:null,approvalId:'ap_0123456789abcdef0123456789abcdef'}),
 'visitor-awake':{soul:mickey,view:'visitor',camera,clock:T,body:{state:'awake',doing:null,since:T-28*min},now:{text:'Heading to the pond to see if the koi are up.',at:T-3*min},place:'the pond'},
 'visitor-idle':{soul:mickey,view:'visitor',camera,clock:T,body:{state:'idle',doing:'sitting',since:T-12*min},now:{text:'Watching the koi.',at:T-12*min},place:'the pond'},
 'visitor-zombie':{soul:wren,view:'visitor',camera,clock:T,body:{state:'zombie',doing:null,since:T-8*min},now:{text:'Danced for ten minutes. Hello, field.',at:T-60*min},place:'the commons'},
 'visitor-asleep':{soul:wren,view:'visitor',camera,clock:T,body:{state:'asleep',doing:null,since:T-20*60*min},now:{text:'Danced for ten minutes. Hello, field.',at:T-21*60*min},place:'the commons'},
};
export const FIXTURE_CLOCK=T;
