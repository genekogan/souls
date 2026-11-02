// The god panel's view of the server: status, the god token for *this* world,
// edits, undo/redo, flags, previews. One origin may front many worlds (the
// launcher), so the token is kept per world and checked against the world id it
// was minted for.
import { BASE } from '../base-path.ts';
import { apiPath, worldKey } from '../world-path.ts';
import { isFlagDef } from './checklist.ts';
import { userAuthHeaders, watchSession, session } from '../auth-session.ts';
import { statusPoll } from './status-poll.ts';
export { isFlagDef };

export type Pending = { code: string; agent: string; expiresIn: number };
export type Status = { worldId: string; name: string; hasOwner: boolean; you: 'god' | 'owner' | 'claimant' | 'visitor' | 'anonymous'; pending: Pending[]; entities: number; seq: number; base: string; template?: string | null; agents?: number };
export type Op = { op: string; def?: string; name?: string; id?: string; [k: string]: unknown };
export type EditRow = { seq: number; by: string; at: number; note: string | null; grp: string | null; ops: Op[]; undone: number; undo_of: number | null; kind: 'edit' | 'undo' | 'redo' };
export type FlagRef = { id: string; name: string; label: string; p: [number, number, number] };
export type PreviewRow = { id: string; accepted: boolean; summary: Record<string, unknown> | null; at: number };
export type LauncherWorld = { slug: string; name: string; template: string; templateName: string; createdAt: number; claimable?: boolean };
export type LauncherSeen = { looks: number; lastLookAt: number | null; agentSeenAt: number | null; previews: number };

const TOKEN_KEY = `sim.godToken:${worldKey}`;
let tokenGeneration = 0;
let pendingToken: Promise<string> | null = null;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Tokens are `god_<worldId>_<secret>` and world ids are `<slug>-<n>`. */
export const tokenIsFor = (token: string | null, key = worldKey) => !!token && new RegExp(`^god_${escapeRe(key)}-\\d+_`).test(token);

/** The signed-in person's bearer (Clerk session token in production, `dev:<name>` locally): see auth-session.ts. */
export const authHeaders = userAuthHeaders;

/**
 * Run once at import (before the world page's own effects read 'sim.godToken'):
 * a token another world left in this tab is dropped, and this world's remembered
 * token is offered to the page so it does not mint another.
 */
export function adoptStoredToken() {
  try {
    const session = sessionStorage.getItem('sim.godToken');
    if (session && !tokenIsFor(session)) sessionStorage.removeItem('sim.godToken');
    if (session && tokenIsFor(session) && !localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, session);
    const kept = localStorage.getItem(TOKEN_KEY);
    if (kept && tokenIsFor(kept) && !sessionStorage.getItem('sim.godToken')) sessionStorage.setItem('sim.godToken', kept);
  } catch { /* storage disabled */ }
}
if (typeof window !== 'undefined') adoptStoredToken();

export function storedToken(): string | null {
  try { const t = localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem('sim.godToken'); return tokenIsFor(t) ? t : null; } catch { return null; }
}
export function keepToken(token: string) { try { localStorage.setItem(TOKEN_KEY, token); sessionStorage.setItem('sim.godToken', token); } catch { /* storage disabled */ } }
export function forgetToken(refused?: string) {
  // A late 401 for an older token must not cancel another caller's replacement.
  if (refused !== undefined && storedToken() !== refused) return;
  tokenGeneration++; pendingToken = null;
  try { localStorage.removeItem(TOKEN_KEY); if (!tokenIsFor(sessionStorage.getItem('sim.godToken'))) return; sessionStorage.removeItem('sim.godToken'); } catch { /* storage disabled */ }
}

async function json<T>(r: Response): Promise<T> { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error((d as { message?: string }).message ?? `HTTP ${r.status}`); return d as T; }

const status = statusPoll<Status | null>(async () => {
  try { const r = await fetch(apiPath('/v1/god/status'), { headers: await authHeaders(), cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; }
});
// Owner-only pending codes belong to the current account, including during
// sign-out and same-label account switches. Old requests cannot refill this cache.
let tokenSession = session();
watchSession(() => {
  const next = session();
  if (next.mode !== tokenSession.mode || next.authed !== tokenSession.authed || next.scope !== tokenSession.scope ||
      (next.scope == null && next.label !== tokenSession.label)) {
    // Invalidate only work started for the previous identity. Stored bearer
    // adoption stays unchanged; explicit sign-out/401 paths call forgetToken.
    tokenGeneration++; pendingToken = null;
  }
  tokenSession = next;
  status.reset(null);
});
export const getStatus = status.refresh;
export const watchStatus = status.subscribe;
export async function getWelcome(): Promise<string | null> {
  try { const r = await fetch(apiPath('/v1/god/welcome'), { headers: await authHeaders(), cache: 'no-store' }); return r.ok ? await r.text() : null; } catch { return null; }
}
/** The owner's browser token for this world: the remembered one, else minted with the signed-in owner's identity (claims an unowned world). */
export async function ensureToken(): Promise<string> {
  const t = storedToken(); if (t) return t;
  if (pendingToken) return pendingToken;
  const generation = tokenGeneration;
  const current = () => { if (generation !== tokenGeneration) throw new Error('Sign-in changed. Try again.'); };
  const request = (async () => {
    const headers = await authHeaders(); current();
    if (!headers.authorization) throw new Error('Sign in first.');
    const d = await json<{ token: string }>(await fetch(apiPath('/v1/god/mint'), { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'browser' }) }));
    current(); keepToken(d.token); return d.token;
  })().finally(() => { if (pendingToken === request) pendingToken = null; });
  pendingToken = request;
  return request;
}
/** A god call with this world's token; a refused token is forgotten and re-minted once. */
export async function god<T>(path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = await ensureToken();
    const r = await fetch(apiPath(path), { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
    if (r.status === 401 && attempt === 0) { forgetToken(token); continue; }
    return json<T>(r);
  }
}
/** Become this world's god as the signed-in person, then hold a browser god token. */
export async function claim() {
  const headers = await authHeaders(); if (!headers.authorization) throw new Error('Sign in first.');
  await json(await fetch(apiPath('/v1/god/claim'), { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' }));
  return ensureToken();
}
export const approve = async (code: string) => json(await fetch(apiPath('/v1/god/pair/approve'), { method: 'POST', headers: { ...await authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ code }) }));
export const edits = (limit = 30) => god<{ edits: EditRow[] }>(`/v1/god/edits?limit=${limit}`).then((d) => d.edits);
export type UndoResult = { accepted: boolean; reverted?: number | number[]; failures?: { code: string; detail: string }[] };
export const undo = () => god<UndoResult>('/v1/god/undo', { method: 'POST' });
export const redo = () => god<UndoResult>('/v1/god/redo', { method: 'POST' });
export const undoGroup = (group: string) => god<UndoResult>(`/v1/god/undo?group=${encodeURIComponent(group)}`, { method: 'POST' });

export type FlagSource = { id: string; name?: string; def: string; p?: readonly number[]; state?: { label?: string } | unknown; in: { parent: string } };
/** The flags among a world's entities (positions resolved for the camera): the public snapshot's, or the entity layer's
 *  copy of it (GodPanel, lane L3h: no second snapshot download per edit). */
export function flagRefsOf(entities: Iterable<FlagSource>): FlagRef[] {
  const out: FlagRef[] = [];
  for (const e of entities) {
    if (!isFlagDef(e.def) || e.in.parent !== 'world' || !Array.isArray(e.p)) continue;
    const p = e.p; const xyz: [number, number, number] = p.length === 3 ? [p[0], p[1], p[2]] : [p[0], 0, p[1]];
    const label = (e.state as { label?: string } | undefined)?.label;
    out.push({ id: e.id, name: e.name ?? e.id, label: label ?? e.name ?? e.id, p: xyz });
  }
  return out;
}
/** Flags from the public snapshot (a page without the entity layer's copy). */
export async function flags(): Promise<FlagRef[]> {
  const r = await fetch(apiPath('/v1/world/snapshot')); if (!r.ok) return [];
  return flagRefsOf((await r.json() as { entities: FlagSource[] }).entities);
}

// ---- the launcher (only when this page is served by tools/world-launcher)
export async function launcherWorld(): Promise<{ world: LauncherWorld; seen: LauncherSeen } | null> {
  try { const r = await fetch(`${BASE}/__sim/worlds/${worldKey}`); return r.ok ? await r.json() : null; } catch { return null; }
}
/** Recent previews the god asked for: the server's own list when it has one, else what the launcher saw. */
export async function previews(): Promise<PreviewRow[]> {
  try { return (await god<{ previews: PreviewRow[] }>('/v1/god/previews')).previews; } catch { /* not on this server yet */ }
  try {
    const token = await ensureToken();
    const r = await fetch(`${BASE}/__sim/worlds/${worldKey}/previews`, { headers: { authorization: `Bearer ${token}` } });
    return r.ok ? (await r.json()).previews : [];
  } catch { return []; }
}

/** The one line the god pastes to their agent (the same line the world's welcome gives). */
export const godPrompt = (base: string) => `Read ${base || location.origin + apiPath('')}/SKILL.md and follow its God mode section: you are the god of this world.`;
