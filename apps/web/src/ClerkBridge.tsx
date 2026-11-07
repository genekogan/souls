// P1 phones: Clerk for a world page, loaded on its own after the arrival (main.tsx ClerkWorld). It renders nothing on
// screen: it mounts ClerkProvider beside the world's Shell (a sibling, so the Shell never remounts when it arrives) and
// hands the signed-in state up through onAuth once Clerk has loaded. The world's socket never waited for Clerk (useSouls
// re-hellos when a session lands).
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiPath } from './world-path.ts';
import { signOutAndReturn } from './clerk-sign-out.ts';
import { clerkSatelliteOptions, startClerkSignIn, type ClerkSatellite } from './clerk-satellite.ts';
import type { AuthCtx } from './Shell.tsx';

export type ClerkBridgeProps = { publishableKey: string; satellite?: ClerkSatellite; issuer: string | undefined; onAuth(auth: AuthCtx): void; takePendingLogin(): boolean };

export default function ClerkBridge(props: ClerkBridgeProps) {
  return <ClerkProvider publishableKey={props.publishableKey} {...clerkSatelliteOptions(props.satellite, location.origin)}><Bridge {...props} /></ClerkProvider>;
}

function Bridge({ satellite, issuer, onAuth, takePendingLogin }: ClerkBridgeProps) {
  const session = useAuth(), clerk = useClerk(), profile = useUser();
  const [binding, setBinding] = useState<{ accountId: string; issuer: string; subject: string } | null>(null);
  const subject = session.userId, sessionId = session.sessionId;
  const [resolveAttempt, setResolveAttempt] = useState(0);
  useEffect(() => {
    setBinding(null); if (!session.isLoaded || !session.isSignedIn || !subject) return;
    let active = true; const abort = new AbortController();
    void (async () => { for (let attempt = 0; active && attempt < 5; attempt++) { try { const token: string | null = await session.getToken(); if (!active || !token) return;
      const response: Response = await fetch(apiPath('/v1/account/session'), { headers: { authorization: 'Bearer ' + token }, signal: abort.signal, cache: 'no-store' });
      const value: unknown = await response.json();
      if (active && response.ok && value !== null && typeof value === 'object') { const candidate = value as Record<string, unknown>; if (candidate.subject === subject && typeof candidate.issuer === 'string' && candidate.issuer === issuer && typeof candidate.accountId === 'string' && candidate.accountId.startsWith('acct_')) { setBinding({ accountId: candidate.accountId, issuer: candidate.issuer, subject }); return; } }
    } catch { /* retried */ } if (active) await new Promise<void>(yes => setTimeout(yes, 1000)); } })(); return () => { active = false; abort.abort(); };
  }, [session.isLoaded, session.isSignedIn, subject, sessionId, issuer, resolveAttempt]);
  const accountId = binding && binding.subject === subject && binding.issuer === issuer ? binding.accountId : null;
  const currentProfile = profile.user?.id === subject ? profile.user : null;
  // The latest Clerk handles, read by the published functions (the published auth changes only when what it says does).
  const live = useRef({ session, clerk }); live.current = { session, clerk };
  // Clerk can emit signed-out before signOut settles. Keep its modal closed until the document returns.
  const signingOut = useRef(false);
  const ready = session.isLoaded, signedIn = !!session.isSignedIn, authed = ready && signedIn && !!accountId;
  const label = currentProfile?.primaryEmailAddress?.emailAddress ?? currentProfile?.firstName ?? null, avatarUrl = currentProfile?.imageUrl ?? null;
  const auth = useMemo<AuthCtx>(() => ({ mode: 'clerk', ready, authed, label, avatarUrl,
    login: () => { if (signingOut.current) return; const { session: s, clerk: c } = live.current; if (s.isSignedIn) setResolveAttempt(n => n + 1); else startClerkSignIn(c, satellite, location.href, url => location.assign(url)); },
    logout: async (returnUrl) => { if (signingOut.current) return; signingOut.current = true; try { await signOutAndReturn(live.current.clerk, returnUrl); } catch (error) { signingOut.current = false; throw error; } },
    getToken: async () => { const s = live.current.session; return s.isLoaded && s.isSignedIn ? s.getToken() : null; },
    debug: { privyUserId: null, accountIdentity: accountId, wallet: null, linked: [] } }), [ready, authed, label, avatarUrl, accountId, satellite]);
  // Published once Clerk has loaded: the placeholder before it (signed-out controls, or "Signing in…") stays until then.
  useEffect(() => { if (auth.ready) onAuth(auth); }, [auth, onAuth]);
  // A sign-in asked for before Clerk had loaded (the Shell's placeholder login) opens once it has.
  useEffect(() => { if (ready && takePendingLogin()) auth.login(); }, [ready, auth, takePendingLogin]);
  return null;
}
