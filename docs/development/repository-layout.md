# Repository layout and source ownership

Soul is one pnpm workspace. Runnable applications, reusable code, authored content and developer tools have
different responsibilities. A directory's size or historical name does not establish whether it is obsolete.
The migration is tracked in [#577](https://github.com/genekogan/souls/issues/577); the boundaries below distinguish
the current tree from intended destinations.

| Location | Responsibility and current exceptions |
|---|---|
| `apps/` | Runnable server and browser applications. An optional music studio can be a separate app without entering the game's bundle or production deployment. |
| `packages/` | First-party reusable code with explicit interfaces. The current `engine-mars` adapter still loads code from `mars/viewer/engine`; it is not yet an isolated engine package. |
| `worlds/` | Curated templates, content definitions, source manifests and examples. Named worlds are legitimate data. Historical patch scripts need a documented role and are not automatically part of world startup. |
| `tools/` | Maintained development, asset, test, proof, authoring and release CLIs. Consult the relevant tool's README; this is where most repository scripts live. |
| `scripts/` | Thin environment entrypoints. Currently `cloud-session-start.sh` is a Claude cloud hook, not a universal setup command. |
| `changes/` | Unreleased changelog fragments. Release compilation consumes them into `CHANGELOG.md`; a README-only directory is normal. |
| `vendor/` | Source treated as externally maintained. Sim Score currently has enforced upstream provenance, although the intended ownership is now first-party. |
| `mars/` | A mixed historical boundary containing the live deterministic engine, viewer, Lab, content and asset tools. Preserve capabilities while extracting them; do not delete it as cosmetic cleanup. |
| `docs/` | Current contracts, instructions and durable design intent. Issues and PRs hold execution status and proof. |

## World data versus world-specific behavior

A world-agnostic platform can contain a Mars template or a Little Martians asset pack. It should select behavior
from declared capabilities, body definitions and content contracts, rather than a world's spelling or a character's
display name. A new compatible world should not require editing the engine.

The current engine still has scene-specific constructors and a named-character floating-body selection in
`packages/engine-mars/src/engine.ts`. Server startup/runtime rules and some browser asset defaults also distinguish
legacy worlds. These paths need a consumer and compatibility audit: some preserve historical replay or deliberate
feature exclusions. [#579](https://github.com/genekogan/souls/issues/579) tracks the migration to explicit contracts.

The `/old` page is only the previous world-list UI. Its retirement
([#582](https://github.com/genekogan/souls/issues/582)) does not retire the underlying bodies, physics, construction,
music, content or stored worlds. Map these capabilities to supported homes before removing their last consumer.

## Changes that preserve behavior

1. Inventory imports, dynamic loading, generated assets, test coverage and deployment inputs before moving code
   ([#381](https://github.com/genekogan/souls/issues/381)).
2. Define package boundaries; move code and its tests together, updating CI scope and asset/release inputs.
   Separate mechanical moves from behavioral changes ([#382](https://github.com/genekogan/souls/issues/382)).
3. Generalize content and capability inputs while preserving compatible saves, replay and asset URLs. Internal
   `sim-*` identifiers and old wire/snapshot versions are not global search-and-replace targets.
4. Retire a source only after its consumers and required capabilities have migrated. Preserve the Lab recovery
   inventory and evidence in [physical coordination](../design/physical-coordination.md).

Coordinate broad path changes with active owners before editing. A source move must not cause a feature lane to
lose its implementation or invalidate proof without review. Keep the normal tier, review and release requirements.

## First-party music

[#578](https://github.com/genekogan/souls/issues/578) moves source ownership into Soul. The proposed split is a
reusable `packages/music` and optional `apps/music-studio`; these are destinations, not existing packages.
The current upstream-sync rule, generator and provenance tests must change together. Preserve source/licence
notices, deterministic composition, lazy playback and the existing UI. Render outputs stay outside git.

## Ordinary development commands

[Development](../development.md) is the executable setup guide. Root `package.json` defines these existing commands:

| Purpose | Command / boundary |
|---|---|
| Install locked dependencies | `pnpm install --frozen-lockfile` |
| Obtain required media | `pnpm assets:pull`; `pnpm assets:check` checks availability |
| Develop locally | Follow [development](../development.md) to set fake minds, isolated data and free ports explicitly; `pnpm dev` alone only starts the app scripts |
| Build | `pnpm build`, including viewer assets through `tools/assets/mars-web.mjs` |
| Typecheck | `pnpm typecheck`; use the affected package's check while iterating |
| Test | `pnpm test` for repository tests; focused `node --test` and scoped checks per [testing](../testing.md) |
| Browser smoke | `pnpm e2e:smoke` when the required isolated services and media are ready |
| Release qualification | Authorized release owner only; [release](../release.md) and existing gate accounting |

This list describes checked-in commands; it is not a receipt that they all ran in a fresh cloud environment.
The clean-cloud pilot in [#554](https://github.com/genekogan/souls/issues/554) must qualify that path. The current
Claude hook includes its own install/asset logic; a future shared bootstrap should own that logic, with thin provider
wrappers. Do not make another provider emulate Claude environment variables to obtain a normal checkout.
