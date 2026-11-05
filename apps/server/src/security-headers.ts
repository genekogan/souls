// The security headers every answer carries (#1006), defined once. A leaf module with no runtime imports, so the read worker
// (split/read-worker.ts, #1025) can set them without loading the HTTP app; http.ts re-exports all three.
import type {ServerResponse} from 'node:http';

/** Hono's, from buildApp; the few answers main.ts writes itself (/mcp and the restart 503, #1017); and the read
 *  worker's own answers (#1025). docs/architecture/api.md "Headers". */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = { 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" };
/** A response's own CSP keeps its directives, with frame-ancestors 'none' added; no CSP gets the shared one. */
export const withFrameAncestors = (csp: string | null | undefined) => !csp ? SECURITY_HEADERS['Content-Security-Policy'] : /frame-ancestors/i.test(csp) ? csp : `${csp}; ${SECURITY_HEADERS['Content-Security-Policy']}`;
/** The same headers on a Node response that never reaches Hono. Call it before the response is written. Its CSP is
 *  the plain shared one: an answer that writes its own CSP header later replaces it (none does today). */
export function secureNodeResponse(res: ServerResponse) { for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value); }
