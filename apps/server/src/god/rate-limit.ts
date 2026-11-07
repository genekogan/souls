import type { Context } from 'hono';
import { hashToken, RateLimit } from '../auth.ts';
import { ApiError } from '../souls.ts';
import { CREATION_LIMITS } from '@souls/generators';
import { isIdentity, poolOf } from './builds.ts';

/** Reuse the server's sliding window; authenticate before allocating any token bucket.
 *  WD7 slice 3: helper tokens draw from their lead's buckets, so minting helpers never multiplies a budget. */
export function godTokenLimiter(requireGod: (c: Context) => unknown) {
  const limits = new RateLimit();
  return (c: Context, bucket: string, max: number) => {
    const who = requireGod(c);
    const key = isIdentity(who) ? poolOf(who) : hashToken(c.req.header('authorization')!.replace(/^Bearer\s+/i, ''));
    const result = limits.allow(`${bucket}:${key}`, max, CREATION_LIMITS.rateWindowMs);
    if (!result.ok) throw new ApiError(429, 'rate-limited', `too many ${bucket} requests`, { retry_after: result.retryAfter, retryAfterMs: result.retryAfter * 1000 });
  };
}
