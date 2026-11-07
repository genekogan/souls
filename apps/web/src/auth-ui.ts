import {worldTitle} from './world-title.ts';
import {approvalFromHash} from './approval-link.ts';
import {soulFromFragment,soulFragment} from './soul-link.ts';
/** Sign-in is part of the shared world chrome; public viewing remains unsigned. */
export const AUTH_UI=true;
/** `devSignIn`: new (world-engine) worlds only — local dev sign-in (dev auth, no provider) shows the same Sign in
 * button there. Old worlds pass nothing and keep main's (e8) rule exactly. */
export function configuredSignIn(cfg:{authProvider?:'clerk'|'privy'|'none';privyAppId?:string;clerkPublishableKey?:string;clerkIssuer?:string;devAuth?:boolean},devSignIn=false){
 if(cfg.authProvider==='none')return false;
 return cfg.authProvider==='clerk'?!!cfg.clerkPublishableKey&&!!cfg.clerkIssuer:!!cfg.privyAppId||devSignIn&&!!cfg.devAuth;
}

/** Raw-world bootstrap prompt; full runtime instructions live in the installed skill. */
export function agentOnboarding(worldUrl:string,worldName?:string,windowCode?:string|null){
 // The world slug is the path's first `/w/<slug>` (a launcher base such as `/worlds` may precede it).
 const base=worldUrl.replace(/\/+$/,''),key=new URL(base).pathname.match(/\/w\/([a-z][a-z0-9-]{0,31})(?:\/|$)/)?.[1];
 const world=worldTitle(worldName,key);
 // lane PUX: the signed-in window's code, so the agent's request comes up in this window (instructions.md?for=CODE)
 const instructionsUrl=base+'/instructions.md'+(windowCode&&/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(windowCode)?'?for='+windowCode:'');
 return {world,instructionsUrl,text:`Read the instructions at ${instructionsUrl} to create a new soul in the world ${world}.`};
}
export function agentQuickstart(worldUrl:string,worldName?:string):string{return agentOnboarding(worldUrl,worldName).text;}

/** The app's path prefix: '' (root build) or e.g. '/worlds' (launcher `--base /worlds`); see base-path.ts. */
const basePrefix=/^(?:\/[a-z0-9][a-z0-9-]{0,31})*$/;
/** The old root-path worlds, whose rules stay main's (e8) exactly. */
const oldWorldPath=/^\/w\/(eden|mars|littlemartians|toy)\/?$/;
/** `path` is exactly `<base>/w/<slug>` (optional trailing slash): a world page under this build's prefix.
 * With base '' and an old world key this is main's check, unchanged. */
export function isWorldPath(path:string,base='',trailingSlash=false){
 if(!basePrefix.test(base)||!path.startsWith(base+'/'))return false;
 return (trailingSlash?/^\/w\/[a-z][a-z0-9-]{0,31}\/?$/:/^\/w\/[a-z][a-z0-9-]{0,31}$/).test(path.slice(base.length));
}
/** Authentication comes from server configuration, never request-derived publicUrl.
 * New worlds: any launcher world slug under the build prefix, and a god pairing link (#godpair/CODE) survives the hop. */
export function clerkOriginRoute(authenticationOrigin:string|undefined,currentOrigin:string,path:string,hash='',base=''){
 let origin:URL;try{origin=new URL(authenticationOrigin??'');}catch{return {initialize:false,signInUrl:null};}
 if(origin.origin!==authenticationOrigin||origin.username||origin.password||!['https:','http:'].includes(origin.protocol)||origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||!isWorldPath(path,base,true))return {initialize:false,signInUrl:null};
 const oldWorld=base===''&&oldWorldPath.test(path);
 const approval=approvalFromHash(hash),soul=soulFromFragment(hash);
 const fragment=approval?'#approve/'+approval:!oldWorld&&/^#godpair\/[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(hash)?hash:soul?'#'+soulFragment(soul):hash==='#join'?'#join':'#watch';
 return {initialize:currentOrigin===origin.origin,signInUrl:origin.origin+path.replace(/\/$/,'')+fragment};
}
/** P1 phones: whether a Clerk world page loads its sign-in before the arrival (else once the card has gone): Clerk's
 *  own redirect parameters, a fragment that is a sign-in step (approval, pairing, join, a tab) rather than watching
 *  or a Soul link, or a browser that is probably signed in. */
export function clerkNow(href:string,hash:string,cookie=''):boolean{
 return /[?&#]__clerk|__session=|__dev_session/.test(href)||!(hash===''||hash==='#'||hash==='#watch'||!!soulFromFragment(hash))||clerkSignedInHint(cookie);
}
/** Clerk's own "client updated at" cookie on the app's domain (`__client_uat`, or `__client_uat_<suffix>`): non-zero
 *  when this browser holds a signed-in session. Only a hint for when to load Clerk; Clerk itself decides. */
export function clerkSignedInHint(cookie:string):boolean{return /(?:^|;\s*)__client_uat(?:_[^=;]*)?=[1-9]/.test(cookie);}
/** The launcher homepage (`<base>/`) mounts Clerk only on the configured origin too. */
export function clerkHomeRoute(authenticationOrigin:string|undefined,currentOrigin:string,base=''){
 let origin:URL;try{origin=new URL(authenticationOrigin??'');}catch{return {initialize:false,signInUrl:null};}
 if(origin.origin!==authenticationOrigin||origin.username||origin.password||!['https:','http:'].includes(origin.protocol)||origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))return {initialize:false,signInUrl:null};
 if(!basePrefix.test(base))return {initialize:false,signInUrl:null};
 return {initialize:currentOrigin===origin.origin,signInUrl:origin.origin+base+'/'};
}
export function unsignedPreviewAuth(signInUrl:string|null,login:()=>void){return {ready:true,authed:false,label:null,signInUrl:signInUrl??undefined,login,logout:()=>{},getToken:async()=>null,debug:{privyUserId:null,wallet:null,linked:[]}};}
