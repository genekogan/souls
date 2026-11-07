// What the managed runtime bundle may contain: this folder, and the two soul-trace modules it imports. Named one by one because
// the rest of soul-trace isn't runtime code: tap.mjs wraps a process's fetch the moment it's imported (#733, #1181).
const SOUL_TRACE=new Set(['tools/soul-trace/sink.mjs','tools/soul-trace/host.mjs']);
export const isRuntimeSource=local=>local.startsWith('tools/soul-runtime/')||SOUL_TRACE.has(local);
