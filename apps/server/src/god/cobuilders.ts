// Y4b: narrow co-builder god tokens. The world launcher's worldops lane pairs a co-builder's agent and stores its god token
// in this world's god_tokens_v1 with the label `cobuilder:<account>:<agent>` (the account is set by the launcher after the
// co-builder signs in; the agent name follows it). Such a token builds (act, place, define, builds it leads, claims), but
// never changes env/sky/time/weather or strikes, never undoes, redoes, takes, releases, pauses, resumes, finishes or abandons
// another account's work, and never mints. Owner tokens (any other label) are unchanged.
import type { Failure, Op } from '@souls/world-compiler';

export const COBUILDER_PREFIX = 'cobuilder:';
/** The co-builder account named by a root token label, or null for an owner token. */
export function cobuilderOf(label: string | null | undefined): string | null {
  return label?.startsWith(COBUILDER_PREFIX) ? label.slice(COBUILDER_PREFIX.length).split(':')[0] : null;
}
/** Journal/ownership key: `cobuilder:<account>` for co-builder work, null for the owner's side (owner tokens, system rows). */
export const accountKey = (cobuilder: string | null | undefined) => (cobuilder === null || cobuilder === undefined ? null : COBUILDER_PREFIX + cobuilder);
export const labelAccount = (label: string | null | undefined) => accountKey(cobuilderOf(label));
/** How a refused co-builder action names the other side. */
export const whose = (key: string | null) => (key === null ? "the world owner's" : `co-builder ${key.slice(COBUILDER_PREFIX.length)}'s`);

export const cobuilderFailure = (detail: string, extra: Partial<Failure> = {}): Failure =>
  ({ op: -1, code: 'cobuilder.scope', field: 'build', detail, fix: 'A co-builder works on its own builds, claims and edits; ask the world owner for the rest.', ...extra });

/** World state (sky, time, weather and strikes, constitution, ground) belongs to the owner. */
export function cobuilderOpFailure(ops: readonly Op[] | undefined): Failure | null {
  for (const [i, op] of (ops ?? []).entries()) if (op.op === 'world')
    return cobuilderFailure(`Co-builder tokens cannot change ${Object.keys((op as { state?: object }).state ?? {}).join(', ') || 'world state'}: env, sky, time, weather, lightning, the constitution and the ground belong to the world owner.`, { op: i, field: 'op' });
  return null;
}

/** Route deny-list for co-builder tokens (everything else follows the per-action checks). Returns the refusal, or null. */
export function cobuilderRoute(method: string, rawPath: string): string | null {
  const at = rawPath.indexOf('/v1/god/'), path = at < 0 ? rawPath : rawPath.slice(at);
  if (method !== 'POST') return null;
  if (/^\/v1\/god\/(env|strike)$/.test(path)) return `co-builder tokens cannot use POST ${path}: env, sky, time, weather and lightning belong to the world owner`;
  if (/^\/v1\/god\/builds\/[^/]+\/claims\/[^/]+\/helper$/.test(path)) return 'co-builder tokens cannot mint tokens; give a sub-agent EDEN_GOD_CLAIM instead, or ask the world owner';
  return null;
}
