import { CREATION_LIMITS as L } from '@souls/generators';
import type { Failure } from './schemas.ts';

/** Iterative before Zod's recursive JSON parser: malformed/deep/cyclic local inputs cannot overflow it. */
export function creationInputFailure(input: unknown): Failure | null {
  const refusal = (field: string, measured: unknown, limit: unknown): Failure => ({ op: -1, code: 'schema', field, measured, limit,
    detail: `Invalid or oversized creation input at ${field}`, fix: 'Send finite JSON values in a smaller, shallower batch.' });
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value: input, depth: 0 }], seen = new WeakSet<object>();
  let nodes = 0;
  try {
    while (stack.length) {
      const { value, depth, exit } = stack.pop()!;
      if (exit) { seen.delete(value as object); continue; }
      if (++nodes > L.inputNodes) return refusal('body.nodes', nodes, L.inputNodes);
      if (depth > L.inputDepth) return refusal('body.depth', depth, L.inputDepth);
      if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > L.numericMagnitude)) return refusal('body.number', String(value), L.numericMagnitude);
      if (typeof value === 'string' && value.length > L.jsonBodyBytes) return refusal('body.string', value.length, L.jsonBodyBytes);
      if (value && typeof value === 'object') {
        if (seen.has(value)) return refusal('body', 'cyclic object', 'JSON tree');
        seen.add(value);
        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null && !Array.isArray(value)) return refusal('body', 'non-JSON object', 'JSON object');
        stack.push({ value, depth, exit: true });
        for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 });
      } else if (value !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return refusal('body', typeof value, 'JSON value');
    }
    const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
    return bytes > L.jsonBodyBytes ? refusal('body.bytes', bytes, L.jsonBodyBytes) : null;
  } catch { return refusal('body', 'unreadable JSON', 'JSON tree'); }
}
