/** WorldEntityLayer's known no-op after its frozen subtree has current local/world matrices.
 * The static batcher can refresh these nodes individually; arbitrary matrix hooks remain unsupported. */
export function frozenMatrixWorld(){ /* thawed before anything in the subtree changes */ }
