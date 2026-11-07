// Its own small module: the page's first phase reads this, and auth-ui.ts would add 5 KB to the first chunk a phone loads.
/** #531: whether this page's first Clerk load will sync with the primary domain, on a satellite: a top-level navigation to
 *  Clerk and back that makes a new document. It has not synced yet when it has neither Clerk's return parameter nor its
 *  `__client_uat` cookie, whose value (0 when signed out) is set by the sync. */
export function clerkSatelliteSyncs(href:string,cookie:string):boolean{
 return !/[?&]__clerk_synced=/.test(href)&&!/(?:^|;\s*)__client_uat(?:_[^=;]*)?=/.test(cookie);
}
