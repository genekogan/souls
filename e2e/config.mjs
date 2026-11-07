// Browser e2e settings. Contract and how to run: docs/testing/e2e.md.
// The client fixture scenario attaches only to an explicitly owned isolated fixture on the reserved ports below;
// the local smoke (e2e/local-smoke.mjs) runs on any free port outside them.
export const config={docs:'docs/testing/e2e.md',paths:{scenarios:'e2e/scenarios',runs:'.e2e/runs',smokeRuns:'.local/e2e'},smoke:{scenario:'e2e/scenarios/local-smoke.md',runner:'e2e/local-smoke.mjs'},boot:{buildArtifacts:['apps/web/dist/index.html','mars/viewer/dist/client/modular'],buildCommand:'pnpm --filter @souls/web build && pnpm --filter mars-campus-viewer build:static (release bundles are built on Modal: docs/testing/remote-gate.md)'},ports:{app:7830,candidate:7834,control:7835,cdp:7838,phone:7839},iterationCap:3};
