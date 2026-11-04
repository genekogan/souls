# Retained collection evidence

The release driver's complete contract is documented in [Remote gate](../../docs/testing/remote-gate.md).

The current collector retains every group's `V0-assets.log` alongside its preflight log and copies the first group's
diagnostics into the serial layout. These expected per-group diagnostics do not collide; other duplicate files still
fail collection. The historical recovery below remains limited to its original collector and evidence.

For the historical four-group collector blob `f2812707466098b30ab8fd7f280cd65bee6a8481`, the driver can validate
completed execution despite exactly three duplicate informational `V0-assets.log` collisions. This is restricted to
a full run: every retained group must have completed on the same source, harness and runtime; the original harness
archive must match its commit; summaries must cover the fixed group plan and reconstruct the merged summary; server
file inventories must cover the source tree exactly; and merged server logs and attribution must match the retained
shards. Missing, altered, scoped or unsupported evidence fails closed. Every ordinary log, TAP, scenario, assertion,
skip and attribution check still applies. An empty assets diagnostic is valid; a missing one is not.

Raw `RUN-METADATA.json` remains unchanged with `suiteCompleted: false`. The receipt exposes `collectionRecovery`
with the original false value, collector identity, exact collisions and group inventory; `evidence` hashes every
read artifact. Recovery proves collection completeness, not passing assertions. An unquarantined baseline failure
remains a failure and cannot be cache-added as passing evidence; the candidate must fix it.

A solo `--baseline-results` import uses the same executed-suite identity as the cache. The recorded original harness
commit, tree and archive are verified; only `DRIVER_ONLY` files may differ from the current harness. Such imports
record `driverTestsChanged`, permitting only attributed driver self-tests to be renamed or removed. Runtime mismatch
blocks comparison without rerunning the imported baseline. Explicit baseline/candidate pair imports retain exact
full harness identity. Collector, validation scripts, quarantine and all other execution inputs remain in the suite
identity and cannot use this exception.
