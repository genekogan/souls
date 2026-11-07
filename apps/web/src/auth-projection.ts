import type {Me} from '@souls/protocol';
import type {AuthCtx} from './Shell.tsx';
/** Canonical provider ID, or the explicit local development identity from main.
 * Display names/emails are never treated as ownership identities. */
export function authIdentity(auth:AuthCtx):string|null {
  return auth.debug.accountIdentity??auth.debug.privyUserId??(auth.label?.startsWith('dev:')?auth.label:null);
}
/** Unknown identities and late projections from another account fail closed. */
export function matchingMe(authed:boolean,identity:string|null,me:Me|null):Me|null {
  return authed&&identity&&me?.userId===identity?me:null;
}
export function approvedMe(auth:AuthCtx,me:Me|null):Me|null {
  return matchingMe(auth.authed,authIdentity(auth),me);
}
