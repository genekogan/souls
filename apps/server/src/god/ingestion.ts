// Bound the wire body before JSON/multipart parsers allocate their decoded forms.
// Hono's standard limiter trusts Content-Length; God uploads also count the stream.
import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../souls.ts';
import { CREATION_LIMITS as L } from '@souls/generators';

export const GOD_JSON_BYTES = L.jsonBodyBytes;
export const FOOTPRINT_BYTES = L.footprintBytes;
export const MULTIPART_OVERHEAD_BYTES = L.multipartOverheadBytes;
const bounded = new WeakMap<Request, number>();

export function godBodyLimit(budget: () => { bytes: number }): MiddlewareHandler {
  return async (c, next) => {
    const asset = c.req.path === '/v1/god/assets';
    const multipart = (c.req.header('content-type') ?? '').startsWith('multipart/form-data');
    const max = asset ? budget().bytes + (multipart ? FOOTPRINT_BYTES + MULTIPART_OVERHEAD_BYTES : 0) : GOD_JSON_BYTES;
    const code = asset ? 'asset.budget' : 'too-large';
    const tooLarge = (bytes: number) => new ApiError(413, code, `request body ${bytes} bytes > ${max}`, { field: 'body', measured: { bytes }, allowed: { bytes: max }, fix: 'Send a smaller request body.' });
    const length = c.req.header('content-length');
    if (length !== undefined) {
      if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))
        throw new ApiError(400, asset ? 'asset.invalid' : 'invalid', 'Content-Length must be a nonnegative integer', { field: 'content-length', measured: length, allowed: 'nonnegative safe integer' });
      if (Number(length) > max) throw tooLarge(Number(length));
    }
    const known = bounded.get(c.req.raw);
    if (known !== undefined) { if (known > max) throw tooLarge(known); return next(); }
    if (!c.req.raw.body) return next();
    const reader = c.req.raw.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > max) {
          void reader.cancel().catch(() => {});
          throw tooLarge(bytes);
        }
        chunks.push(part.value);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, asset ? 'asset.invalid' : 'bad-json', 'request body was interrupted', { field: 'body', measured: { bytes, complete: false }, allowed: { bytes: max, complete: true }, fix: 'Retry the complete upload.' });
    } finally { reader.releaseLock(); }
    c.req.raw = new Request(c.req.raw, {
      body: new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }),
      // Node requires duplex for a streaming Request body.
      duplex: 'half',
    } as RequestInit);
    bounded.set(c.req.raw, bytes);
    await next();
  };
}
