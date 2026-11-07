# Data: tables, retention, backups

Each world has one SQLite file (`node:sqlite`, WAL) at `$DATA_DIR/sim.db`. Core SQL is in `apps/server/src/db.ts`.
Core schema changes are numbered, forward-only migrations in `apps/server/src/migrations.ts`, recorded in
`schema_migrations`; never edit a shipped one. Feature modules (accounts, edge, god, travel, welcome, moderation, …)
create their own versioned tables (`*_v1`) with `CREATE TABLE IF NOT EXISTS` when they open.

## Core tables

| Table | Holds | Retention |
|---|---|---|
| `worlds` | id, schema, rules version, dt, seed, clock rate | one row |
| `events` | the canonical log: `seq, tick, kind, author, payload, at, soul_id` | never pruned |
| `snapshots` | engine + kernel + minds at a tick, with state and physical hashes and rules version | latest 5, plus the first of each day for 7 days |
| `users`, `souls`, `invites` | accounts, Souls (owner, entity id, name, token hash), invites | canonical |
| `paid_costs` | model cost reservations: time, model, cost, settled | the rolling 24-hour budget window (see [brain](brain.md)) |
| `brain_calls`, `prompts`, `spend_hourly` | model call bodies; long prompts by hash; hourly spend totals | call bodies: 24 h and 6,000 rows; totals kept |
| `talks`, `narratives` | rendered speech; narrator plans (central driver) | newest 20,000 talk lines |
| `take_chunks`, `take_archives` | recorded pose chunks for the viewer; archive manifest | only with `TAKES_PERSIST=1` (off by default) |
| `glitches_v1` | one row per refusal, recovery and halt: rung, rule, bodies, tick, evidence (`glitch.ts`) | operations data; replay never reads it |
| `render_scene_captures` | content-addressed public render scenes | canonical for the takes that cite them |
| `intent_*`, `lifecycle_operations_v1`, `clock_frontiers_v1`, … | structured intent, Soul lifecycle and durable clock facts | canonical |

## Feature tables (examples)

| Prefix | Owner module | Holds |
|---|---|---|
| `world_*` (`world_meta_v1`, `world_defs_v1`, `world_entities_v1`, `world_edits_v1`, `world_assets_v1`, …) | `god/store.ts`, `god/assets.ts` | the god's world model, edit journal with inverses, uploaded assets |
| `god_*` | `god/` | god tokens (hashed), builds, prayers, receipts, notices |
| `edge_*` | `edge/` | receipts, outcomes, idempotency keys, conversations and streams, reminders, bodies, items, mail |
| `account_*`, `provider_accounts_v1` | `accounts/`, `account-registry.ts` | approvals, grants, window codes, identities |
| `travel_*` | `travel/travel.ts` | incarnations, requests, where each traveller is |
| `welcome_*` | `welcome.ts` | feedback rate limits, "since your last visit" cutoffs |

**The kernel has no table.** Things, links, decks and the vocabulary are rebuilt from the log and carried in snapshots.
**Edge memory is not here.** A Soul's notes, schedule and memory live in its agent's folder.

## What is canonical

World metadata, accepted events, accounts and Souls, god edits, and paid-cost reservations. Snapshots and take chunks
are caches: a world boots from its latest admitted snapshot and replays later events, or replays from genesis. Takes are
a pose-keyframe cache for the viewer, not the source of truth.

## Privacy

Owner words, private rules, journals and recovery details are carried in private payloads and minds. Public projections
(`publicEvent()`, kernel views, takes) remove them. Treat raw databases, snapshots and model requests as private.

## Maintenance and backups

In-process, a minute after boot and then hourly (`apps/server/src/main.ts`): prune call bodies and talk lines, `VACUUM`
when the file is bloated, write `backup-YYYYMMDDHH.db`, and keep the 6 newest plus the 00:00 UTC file of each recent
day (about a week). Off-host copies: a launcher host backs up world data with restic. See [disaster recovery](../operations/disaster-recovery.md).

With `ARCHIVE_TAKES=1` (requires `TAKES_PERSIST=1`) take segments are uploaded to R2 (`R2_*` settings, prefix
`R2_PREFIX`, default `sim`) and verified before local pruning.
