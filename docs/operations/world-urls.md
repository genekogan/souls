# World URLs and offline slug migration

A launcher can serve the world list at `/` and worlds at `/w/<slug>/`. Set its arguments to `--base /` and build the
web app with `SIM_WORLDS_BASE=/ tools/world-launcher/deploy/release.sh production --reload`. A prefixed deployment
still uses `--base /worlds` and `SIM_WORLDS_BASE=/worlds`; the build and running launcher must agree. Changing launcher
arguments requires a service restart, not a generation handover. Stage the matching web build before starting it.

The public slug is distinct from identity: an entry can contain `dataSlug`, `worldId`, `worldKey`, and `aliases`.
Absent these fields, existing registries behave as before. `dataSlug` names the original physical directory;
`worldId` identifies persisted state and god tokens; `worldKey` retains engine behavior. The server receives the new
slug as `WORLD_SLUG` and `WORLD_PATH`, and publishes that slug plus `worldEngine` in its public config. The client uses
the inline runtime kind, so an entity world named `eden` does not accidentally load the legacy Eden renderer.

## Migrate a stopped copy

Stop the target launcher **and all of its children** before applying this command. Run the migration as the service
user that owns the copied registry (for example, `sudo -u simworlds node ...`), not as root: its replacement and backup
files are intentionally mode 0600 and must remain readable by the launcher. Use a completed copy or a backup;
do not operate on a running registry. No command below opens account or world databases, or rewrites paired folders.
The dry run prints only counts. For the launch mappings:

```sh
node tools/world-launcher/reslug.mjs /path/to/copied-data \
  eden-2026=eden my-mars-college-2026-3=mars-college-2026 mars-2027=mars-college-2027
# After checking the dry run and confirming the target is stopped:
node tools/world-launcher/reslug.mjs /path/to/copied-data \
  eden-2026=eden my-mars-college-2026-3=mars-college-2026 mars-2027=mars-college-2027 --apply --offline
```

The command validates the whole batch before writing, refuses existing destination slugs/aliases/directories and
legacy forks, retains every entry's ownership and resource settings, and saves the original registry as
`worlds.before-reslug.json` (mode 0600; never overwritten). The new registry replaces `worlds.json` atomically.
World folders, `sim.db`, Souls, god folders, tokens and `accounts.sqlite` are untouched. Retain the backup privately.
For rollback, stop the target again and restore the saved registry together with the previous launcher base/build.
Do not run old code against a migrated registry: it does not understand the retained storage names.

Review slug-scoped operational settings at the same time. `EDGE_EYES_WORLDS`, operator/test allowlists, health
observers, probes and launcher process names use **canonical slugs**. Flags keyed by stable world IDs keep their
original values. Product worlds remain barred from TEST-Soul operations under both old and new names. The migration
refuses legacy forks rather than silently modifying their descriptors. Account registries remain a separate opaque
copy in the migration procedure.

## Compatibility

`legacyBases` in `worlds.json` records the previous prefix (default `/worlds`); each migrated entry records its old
slug in `aliases`. These bounded aliases resolve to one registered world, without simulation events or added Soul
context. GET/HEAD requests for old home/world pages receive a same-origin 308 to the canonical page, preserving query
parameters and browser fragments. Old HTTP API requests (including POST bodies and authorization), SSE and WebSocket
upgrades are internally routed to the canonical path. They are not redirected across authentication boundaries.
Old paired Soul/god folders can therefore keep their stored URL **on this hostname**. Keeping a different old hostname
available is a separate proxy/DNS responsibility; registry aliases do not forward traffic from another server.

Newly generated world list, skill and config URLs use canonical paths. The old prefix still answers machine
endpoints such as `/worlds/__sim/healthz`. Alias slugs remain reserved against new world creation.

## Verify the root deployment

Use `/__sim/healthz`, `/__sim/worlds.json`, and `/w/<slug>/v1/config` for health and identity checks. Verify all three
canonical pages and their old `/worlds/w/<old>/` links. Use a previously paired Soul and god agent, including a streamed
listen and WebSocket connection; a synthetic proxy test alone is not live pairing proof.

The probe and CDN tools accept explicit URLs, so choose the canonical paths:

```sh
node tools/world-launcher/deploy/swap-probe.mjs --origin https://souls.game --base / \
  --slugs eden,mars-college-2026,mars-college-2027 --out .local/root-probe.json
node tools/cdn/cdn-walk.mjs .local/root-cdn-walk https://souls.game/w/eden/ \
  https://souls.game/w/mars-college-2026/ https://souls.game/w/mars-college-2027/
```

`ship.sh --topology root-only` selects the production-only ceremony with canonical probe/walk URLs. The old
combined ceremony requires explicit `--topology dual-prefix`. See [release](../release.md) for the required mirror
rehearsal and review before enabling workflow automation. If using prebuilt web
artifacts, `modal-web-build.py --base /` produces the production build with a root base; its receipt is checked against
`release.sh`'s source SHA, build ID and base. Never substitute a prefixed web artifact for a root build.
