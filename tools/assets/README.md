# Media assets

Git holds code, not binary media. Models, images, audio and fixture databases live on the asset CDN
(`https://assets.eden.art`, immutable content-addressed keys). `tools/assets/manifest.json` lists every file by
repo path with its `sha256`, `bytes` and `url`; `pull.mjs` puts each one back at its path.

```sh
pnpm assets:pull          # after a clone, and whenever the manifest changes
pnpm assets:check         # verify only: exit 1 if anything is missing or wrong (no network, writes nothing)
```

`pnpm dev` warns, and `pnpm test` and `pnpm --filter @souls/web build` stop, when the media they need is not in place.
`mars-web.mjs` builds the Mars viewer's static site (the people's character set under `/modular`) when its inputs
changed and checks it: `pnpm build` and `pnpm dev` run it, `--check` only verifies (CI runs that after the build).

## Options

| Option | Meaning |
|---|---|
| `--set web,runtime,test` | Only these sets (default: all). `web`: what the web build bundles. `runtime`: dev servers, the Mars viewer, worlds, the release tree and most unit tests. `test`: walk fixtures, Mars e2e baselines, the director fixture. |
| `--only <glob>[,<glob>]` | Only matching paths, e.g. `--only 'worlds/core-assets/**'`. `**` crosses directories; a trailing `/` takes a whole subtree. |
| `--check` | Verify the local files only. With `--remote`: stream every selected object from the CDN and verify its hash (read-only GETs, nothing written). |
| `--dest <tree>` | Pull into another tree (the release does this for its `git archive` copy). |
| `--cache <dir>` | Shared content-addressed cache, default `$SIM_ASSETS_CACHE` or `~/.cache/sim-assets`. Every checkout on the machine reuses it; files are copied out of it (cloned on APFS), never hard-linked. |
| `--from <tree>` | Take files from another checkout that already has them (verified by hash) before trying the network. |
| `--offline` | Never use the network: cache and `--from` only. |
| `--concurrency <n>` | Parallel downloads, default 8, at most 32. |

Every byte that lands is checked against the manifest's `sha256` and size of the decoded file. A re-run skips files
already in place (a small size/mtime state file in the cache avoids rehashing). No credentials are needed.

## Who pulls

| Consumer | How |
|---|---|
| Developers | `pnpm assets:pull` after cloning. |
| Tests | `pretest` checks in the root, `apps/server` and `mars/viewer` (`test:engine`, `e2e`). |
| Web build | `apps/web` `prebuild` checks the `web` set (Vite only warns on a missing `new URL()` asset). |
| Release (`tools/world-launcher/deploy/release.sh`) | Pulls `web` into the worktree before the build and `web,runtime` into the archived release tree. |
| Modal gate (`tools/test-harness/remote-suite.sh`) | Stages this directory; `modal_suite.py` fills a cache layer keyed by the manifest, and each extracted tree pulls from it. |
| Modal web build (`tools/world-launcher/deploy/modal-web-build.py`) | Pulls the `web` set after `pnpm install`. |

## Adding or changing a media file

1. Publish the object to the CDN first (`tools/cdn/publish.mjs`, see `tools/cdn/README.md`).
2. `node tools/assets/pull.mjs entry <file>... [--set runtime]` prints manifest entries with the identity URL
   (`assets/<sha[:2]>/<sha>.<ext>`). Add them to `manifest.json` (one entry per line, sorted by path) or update the
   existing entry; use the published key when it differs, such as a precompressed `assets/br/...` key.
3. `node --test tools/assets/manifest.test.mjs` checks that every manifest path is git-ignored and untracked, and
   that the only binaries in git are the small allowlisted ones (also listed in the root `.gitignore`).
