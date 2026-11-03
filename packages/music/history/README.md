# Original render and staging utilities

These utilities remain in the preserved original repository at Sim Score commit
`7cb0b2b02ea0b2d4ba9e43484af8e2bd0e81e0f4`. `PROVENANCE.json` records their original paths, byte counts and hashes; no utility code is copied here.
They are not package commands, setup inputs, deployment inputs or game imports. No rendered media was imported.

| Original path | Classification |
|---|---|
| `tools/render-index.mjs` | Reuse candidate: builds metadata for already-rendered MP3 files. Review against the current playlist publication contract before adapting it; it indexes all source pieces and assumes a sibling `renders/` directory. |
| `tools/render.sh` | Archive only: hardcodes a macOS Chrome path, adopts existing workers and uses process-name matching to terminate them. It must not become default setup or a render command. |
| `tools/stage.sh` | Archive only: recursively deletes its destination, and its old engine list omits newer optional modules. It must not become a deployment or staging command. |

The original `.gitignore` excluded `node_modules/`, `.DS_Store` and `renders/`; the monorepo ignores those outputs
without importing the old file. Existing `source/tools/serve.py` and `source/site/render.html` remain explicit local
composition tools. Starting the development server does not start rendering or publish anything. Rendering and
publishing require separate authorization and a maintained, reviewed workflow.

Sim Score retains Gene Kogan's authorship and the MIT licence; see the root `LICENSE` and `NOTICE`.
