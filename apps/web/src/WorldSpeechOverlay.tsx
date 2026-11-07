import {useCallback,type RefObject} from 'react';
import type {Souls} from './useSouls.ts';
import type {WorldViewerHandle,WorldViewerState} from './WorldViewer.ts';
import {DialogueDock} from './DialogueDock.tsx';
import type {DialogueEdgeMessage} from './dialogue-threads.ts';
/** Spectator dialogue (DLG2): edge `say` lines and conversation turns (spectators see every channel, doc 26 §10)
 * plus brain talk, threaded in the dialogue dock beside the scene. The dock is always mounted (hidden while
 * empty) so the viewer's inset measurement can keep the camera's composition clear of it. */
export function WorldSpeechOverlay({root,sim,state,active,handle}:{root:RefObject<HTMLDivElement|null>;sim:Souls;state:WorldViewerState|null;active:boolean;handle?:WorldViewerHandle|null}){
 const welcome=sim.conn.welcome,replica=sim.conn.replica;
 const nameOf=useCallback((id:string)=>replica.souls.get(id)?.name??'someone',[replica]);
 return <DialogueDock root={root} scope={welcome?JSON.stringify([welcome.worldId,welcome.epoch]):''} edge={sim.edge as unknown as readonly DialogueEdgeMessage[]|undefined} talk={sim.talk}
  state={state} active={active&&!!welcome} handle={handle??null} nameOf={nameOf}/>;
}
