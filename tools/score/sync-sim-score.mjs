#!/usr/bin/env node
// Retired external-sync entrypoint: first-party edits must not be overwritten by a sibling checkout.
console.error('Sim Score is first-party source in packages/music/source. Edit it here, then run node tools/score/build-playlist.mjs. Historical import metadata is retained; external sync is retired.');
process.exitCode = 2;
