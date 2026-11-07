import type {Connection,PrivateMeSession} from '@souls/client';
import type {Me,BrainCall,ServerStats} from '@souls/protocol';
import {matchingMe} from './auth-projection.ts';
type PrivateState={me:Me|null;brain:BrainCall[];stats:ServerStats|null;privateAuthorityGeneration?:number};
const scope=(me:Me|null)=>me?JSON.stringify([me.userId,me.role,me.invited,me.souls.slice().sort()]):null;
/** Only a canonical server projection may enter this cache. User identity,
 * invitation, role or ownership changes retire all prior private observations.
 * Display/contact metadata and reordered IDs do not invent an authority change. */
export function acceptPrivateAuthority(state:PrivateState,authed:boolean,identity:string|null,raw:Me|null){
 const next=matchingMe(authed,identity,raw);
 if(!next||scope(state.me)!==scope(next))retirePrivateAuthority(state);
 state.me=next;return next;
}

/** Latch retirement at the event boundary, even if authority returns to A before
 * a queued request samples it again. A connection renewal also retires A. */
export function retirePrivateAuthority(state:PrivateState){
 state.privateAuthorityGeneration=(state.privateAuthorityGeneration??0)+1;
 state.me=null;state.brain=[];state.stats=null;
}

/** The SDK validates wire scope. Bind its callback to the current transport and
 * configured world too; private authority never comes from the public replica. */
export function acceptLivePrivateAuthority(state:PrivateState,authed:boolean,identity:string|null,me:Me|null,scope:PrivateMeSession|null,connection:Pick<Connection,'session'|'meSession'>,worldId?:string){
 const transport=connection.session,current=connection.meSession;
 if(!scope||!transport||!current||(worldId!==undefined&&scope.worldId!==worldId)
  ||scope.generation!==transport.generation||scope.worldId!==transport.worldId||scope.epoch!==transport.epoch
  ||scope.connectionId!==current.connectionId||scope.userId!==current.userId||scope.revision!==current.revision||scope.generation!==current.generation){
  retirePrivateAuthority(state);return null;
 }
 return acceptPrivateAuthority(state,authed,identity,me);
}
