import type {AuthCtx} from './Shell.tsx';
import type {Api,Souls} from './useSouls.ts';
import {approvedMe,authIdentity} from './auth-projection.ts';
import {SoulCard} from './SoulCard.tsx';
import {SoulChoices} from './SoulChoices.tsx';
import {VisitorsLine} from './SoulTravel.tsx';
import {ApprovalCard} from './god-ui/ApprovalDialog.tsx';
import {useCardOpen,useShownApproval} from './pairing-slot.ts';
import {bodiesFromEvents} from './soul-state.ts';
type FocusProps={sim:Souls;api:Api;auth:AuthCtx;selected:string|null;select(id:string|null):void;manage():void;active?:boolean;camera?:{following:boolean;follow():void;stop():void}};
export function SoulFocus(props:FocusProps){
 const own=!!props.selected&&!!approvedMe(props.auth,props.sim.me)?.souls.includes(props.selected);
 const key=JSON.stringify([props.sim.privateAuthorityGeneration??0,props.sim.conn.welcome?.worldId,props.sim.conn.welcome?.epoch,props.selected,authIdentity(props.auth),own]);
 return <FocusCard key={key} {...props} own={own}/>;
}
function FocusCard({sim,api,auth,selected,select,manage,camera,own,active=false}:FocusProps&{own:boolean}){
 // LINK Pairing: while this card is visible, a request the god panel would force up is drawn here instead (pairing-slot.ts)
 useCardOpen(active);
 const shown=useShownApproval(),soul=selected?sim.conn.replica.souls.get(selected):null;
 if(active&&shown&&auth.authed)return <section className="soul-card" aria-label="Pairing" data-soul-state="pairing"><ApprovalCard key={shown.id} id={shown.id} signedIn embedded onDone={shown.done}/></section>;
 if(!soul)return <><h1>Meet its Souls</h1><p>Each Soul is run by its owner’s AI agent. Choose someone to watch.</p><VisitorsLine/><SoulChoices souls={[...sim.conn.replica.souls.values()]} ownedIds={approvedMe(auth,sim.me)?.souls??[]} select={select}/><button onClick={manage}>Your account</button></>;
 return <SoulCard api={api} soul={soul} owner={own} signedIn={auth.authed} bodyEvent={bodiesFromEvents(sim.edge??[]).get(soul.id)??null} camera={camera}/>;
}
