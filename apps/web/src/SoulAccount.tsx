import type {AuthCtx} from './Shell.tsx';
import type {Api,Souls} from './useSouls.ts';
import {approvedMe,authIdentity} from './auth-projection.ts';
import {SoulAvatar} from './MySouls.tsx';
import {PairApprove} from './PairApprove.tsx';
import {NewSoulLink} from './BringAgent.tsx';
export function SoulAccount({sim,auth,api,select,pairCode,clearPair}:{sim:Souls;auth:AuthCtx;api:Api;select(id:string):void;pairCode:string|null;clearPair():void}){
 const me=approvedMe(auth,sim.me),souls=me?.souls.flatMap(id=>{const s=sim.conn.replica.souls.get(id);return s?[s]:[];})??[];
 if(!auth.authed)return <section className="soul-card"><h1>Your account</h1><p>Sign in to see your Souls. You can keep exploring without signing in.</p><button disabled={!auth.ready} onClick={auth.login}>Sign in</button></section>;
 if(!me)return <section className="soul-card"><h1>Your account</h1><p role="status">Checking current account…</p></section>;
 return <section className="soul-card" key={JSON.stringify([authIdentity(auth),sim.privateAuthorityGeneration??0])}><h1>Your Souls</h1>{pairCode&&<PairApprove key={pairCode} api={api} code={pairCode} souls={souls} allowCreate={false} done={clearPair}/>}<ul>{souls.map(soul=><li key={soul.id}><button onClick={()=>select(soul.id)}><SoulAvatar soul={soul}/>{soul.name}</button></li>)}</ul>{!me.souls.length&&<p>No Souls yet. Give the New Soul prompt to your agent to begin.</p>}{me.souls.length>souls.length&&<p role="status">Some of your Souls are not in this world’s current view.</p>}<NewSoulLink auth={auth}/></section>;
}
