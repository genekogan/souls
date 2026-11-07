# Soul context: a durable home, one memory, relationships

**Design intent and planning baseline, not implemented API documentation.** The outcome is tracked in
[#1133](https://github.com/soulsimulation/souls/issues/1133). Direction by Gene, 6 November 2026. This document
authorizes no implementation; each milestone is its own issue with acceptance written before work.

The tranche answers two questions. Where do a person's Souls, god seats and worlds live on their machine, so that
nothing is lost, pairing is idempotent and each Soul can be addressed by name? And what does a Soul remember, so
that it matures in a world, meets others and keeps relationships across chats, restarts and worlds?

It is orthogonal to [soul controllability](agency-quality.md) (#623). That lane owns what the mind may send: offers,
schemas, plans, the resolver. This lane owns what is put in front of the mind before it decides, and where that
lives. The one shared seam is the resident client (`serve`), which assembles the pre-turn context.

## Where things stand (6 November 2026, main `74d02d9d4`)

| Fact | Where | Consequence |
|---|---|---|
| Two CLI lines. The legacy `tools/edge-skill/eden-agent.mjs` (1.9) has `memory-folder.mjs`, lessons, cadence and `live`. The shipping SOUL3 line `tools/world-launcher/soul/eden.mjs` (2.14.0) has strict offers, `listen`, `serve` and plans, and **no memory at all**. | `docs/architecture/souls.md`, `docs/architecture/map.md` "Continuity" | Memory is a dead branch. This tranche brings it onto the shipping line, in a better shape, reusing the validated record format. |
| One folder = one Soul = one world. `register` refuses a second world in a paired folder; `.eden-agent.json` holds the token. God mode keeps `.eden-god.json` beside it. | `eden.mjs` `register`, `tools/god-skill/cli.mjs` | God plus one Soul in one folder works by accident; two Souls never. |
| Travel moves a passport and "switches the agent's folder to the new world". The passport already carries a cross-world identity: `traveller` = `<home>/<homeSoulId>`. | `apps/server/src/travel/travel.ts`, `docs/architecture/worlds.md` | The identity relationships need exists; it is not yet visible to other Souls. |
| The server keeps no Soul memory by design: receipts, conversation turns, `edge_place_knowledge_v1`, the 140-character `now` line, and the public profile. `/v1/me` lists the account's Souls in that world. | `map.md` "Continuity", `account-*` routes | The account is the registry; the folder is a cache. |
| The CLI writes a marked guide block into the folder's `CLAUDE.md` and `AGENTS.md`; a parent pointer only for a folder named `eden-soul`. | `client-folder-guide.mjs`, `eden.mjs` `writeGuide` | The discovery mechanism exists and stays; it lists one Soul. |

## Principles

1. **The account is the registry, the folder is the cache.** Every local record is keyed by a server id. Nothing
   local is the only copy of an identity; anything local can be rebuilt by `adopt`.
2. **Memory is the mind.** The world keeps evidence (positions, receipts, turns, the public record). The edge keeps
   meaning (judgments, intentions, interpretations, promises, lessons, what it has told whom). Memory points at
   evidence by id and time; it does not copy world state.
3. **One Soul, one memory, many worlds.** A Soul's memory is one log across every world it visits, with a presence
   entry per world. Travel never resets it.
4. **Facts come from receipts; speech stays untrusted.** The memory record format of `memory-folder.mjs` is kept:
   canonical receipts make facts, other Souls' words carry an untrusted label through every projection, the mind
   adds judgments only through explicit `remember` selectors, a torn log fails closed.
5. **Not invasive.** No write outside the folder the person chose, unless they opt in. No daemon. No second
   decision owner. No model call the owner did not pay for and cap.
6. **Secrets in one file.** Everything except `credentials.json` is safe to back up, sync, export or read by an agent.

## 1. The Souls home

### Discovery

`eden.mjs` finds its home the way git finds `.git`: from the current folder, walk up until a `.souls/` directory
is found, stopping at the user's home directory (never crossing it). `SOULS_HOME=<path>` overrides. With none found,
the first `register`, `create`, `pair` or `god` command creates `./.souls/` in the current folder and prints that it
did. `souls init --global` is the only way `~/.souls/` comes into existence.

A folder holding a legacy `.eden-agent.json` or `.eden-god.json` and no `.souls/` is treated as a one-principal home.
`import` moves it in, reusing the token; nothing is re-paired. The legacy files are left in place until the person
deletes them (the guide tells them).

### Layout

```text
.souls/
  config.json                 known worlds (url, name, contract version, bundle version), default Soul; no secrets
  credentials.json            mode 0600; every token keyed by principal and world; nothing else ever goes here
  souls/<soulId>/             one directory per Soul, keyed by stable id (never by name)
    SOUL.md                   identity and voice; owner-editable; pinned lines survive consolidation
    MEMORY.md                 curated long-term layer (regenerated by consolidation, owner-editable)
    memory/log/*.jsonl        append-only fact log (the existing record format, extended: see §2)
    memory/*.md               projections: self, goals, schedule, places, knowledge, lessons, people/, journal/
    worlds/<worldSlug>.json   presence: home or visiting, last place, last seen (both clocks), local token key
    runtime/                  listen lock, serve socket, pending plan, inbox cursors (per Soul, never at the root)
  gods/<worldSlug>/           god state the god CLI keeps today (cache, bakes, claims, look, listener)
  skills/                     the installed project skill source, one copy
  bin/eden.mjs                the CLI bundle in use (worlds may still serve their own; `upgrade` refreshes)
```

The directory name is the Soul's server id so that renames and same-name Souls in different worlds cost nothing.
`config.json` carries the display name index. A Soul's `worlds/` entry per visited world holds the local incarnation
id and which credentials key to use there; the home world entry is marked.

### Addressing

With one Soul in the home every command works as today: `node eden.mjs here`. With several, the first argument
selects the principal when it is not a command name: `node eden.mjs mira here`, `node eden.mjs mira tell "..."`,
`node eden.mjs god eden place ...`. Ambiguity (two Miras in two worlds) is resolved with `mira@eden`. `default <name>`
sets the default. `list` prints every principal in the home with its world, state and last seen.

The guide block written into `CLAUDE.md` and `AGENTS.md` lists every principal in the home and how to address
each, so a fresh chat opened anywhere under the home knows who lives there. The parent-pointer rule for a folder
named `eden-soul` is retired in favour of upward discovery.

### Idempotency and `doctor`

- `create "<Name>"` on an account that already owns a Soul of that name in that world offers `adopt` and creates only
  with `--new`. `adopt <name|id>` pairs an account Soul into the home (`pair` stays as the low-level command).
- A pending approval persists across chats (already true) and `approval wait` resumes it from any chat in the home.
- `doctor` reconciles the home against the account in every known world: a local Soul the account no longer owns is
  marked `retired` and kept (never deleted); an account Soul with no local directory is listed as adoptable; a
  credentials entry with no principal is reported; locks whose process is gone are cleared. `doctor` prints no token.
- `export <name>` writes the Soul minus credentials (identity, memory, presence). `import` accepts it. This is how a
  Soul moves machines and how someone gives a Soul away.

### One skill, one CLI, many worlds

Today each world serves its own skill and bundle and the instructions forbid sharing an installation across worlds,
because the skill was prose. With schema-first offers (#1099) the per-world knowledge is data fetched at boot, so one
project skill (`.claude/skills/souls/`, `.agents/skills/souls/`) and one bundle serve every world. `config.json`
records each world's `eden-edge` contract and the bundle version it served; the CLI refuses with a clear message when
a world needs a newer bundle and `upgrade [world]` fetches it. A world may still serve its pinned bundle; the home
chooses the newest compatible one.

### Unknowns decided here

| Risk | Decision |
|---|---|
| Two machines hold one Soul's token (split brain, diverging memory) | One home machine per Soul is the default. The world exposes who holds the controller lease (`status` shows it); `take <name>` revokes the other. A git-synced `.souls/` is the supported escape hatch, which is why credentials are separate. |
| Two harnesses (Claude Code, Codex) in one home | Every lock, lease and socket lives under `souls/<id>/runtime/`, never at the home root. |
| Agents read files; memory is written from world data | Projections keep the untrusted label visible in the markdown. The skill names one never-read file. |
| Harness memory is per project per harness | Soul memory lives only in `.souls/`; the guide tells the harness not to store Soul facts in its own memory. |
| A god renames or demolishes a place a memory points at | Records carry the name as seen and both clocks; a dangling id degrades to "the place that was called the pier on day 12", never an error. |
| Context budget as memory grows | The brief is budgeted (§3); the log never shrinks, projections do. |
| God knowledge leaking into owned Souls | Two principals. A Soul owned by a god learns the world the way any Soul does; nothing in `gods/` is read when acting as a Soul. |
| Retiring a Soul | `retired` flag; the directory is kept as an archive and excluded from addressing. |

## 2. Memory

### The record

The existing `memory-folder.mjs` record (`gazetteer`, `arrival`, `act.accepted`, `meet`, `communication`, `speech`,
`outcome`, `refusal`, `lesson`, `cost`, `ledger`, `queue`, `scorecard`; `remember` selectors for person, place, goal,
self) is reused, not forked. Three fields are added to every event:

- `world`: the world slug the event happened in (the home world for events before travel existed).
- `when`: `{real: <ISO>, tick: <n>, worldDay: <n>, time: "HH:MM"}`, both clocks, from the receipt or boot.
- `seen`: names as they appeared at the time, for every id the record carries (place, person, object).

A record that references evidence carries its id (`receiptId`, `conversationId`, `objectId`). The edge stores the
interpretation; the evidence stays retrievable from the world (§4, M6). The module runs with no HTTP, identity, model
or CLI, as today, so it is unit-tested with fixture receipts.

### Writers

Memory is written by the resident client from what it already receives: the receipt that completes an act, an
arrival, a `meet` when a Soul is first near, a conversation turn, an owner message's outcome. No polling is added and
no model call is made to write a fact. The mind's own judgments enter only through `remember`, which the skill
exposes as a command with the existing selectors.

### Presence

`worlds/<world>.json` is the Soul's standing in that world: home or visiting, local incarnation id, last place and
posture, last seen on both clocks, what it holds there (the ledger projection, per world), and the public profile
revision it last saw. `travel` writes the new world entry and leaves the Soul directory where it is. `status` shows
every world the Soul has a presence in.

### The projections

Projections are regenerated from the log and never hand-edited except `SOUL.md` and `MEMORY.md`, which are
owner-editable curated layers. `people/` is keyed on the cross-world identity (§4) so a person met in two worlds is
one file. Each projection states its size budget; when a projection would exceed it the oldest episodes are summarized
into `MEMORY.md` by consolidation (§5), and the raw log keeps everything.

## 3. The pre-turn brief

The resident client (`serve`, #1096, #1100) already assembles boot, `here` and pending events before waking the mind.
This tranche adds one section, the **brief**, bounded by a byte budget and built without a model call:

1. **Known people here**: for each nearby Soul with a people record, one line: name, how we know each other, last
   contact, an open commitment if any.
2. **This place**: the Soul's own notes on the place, and whether it has been here before.
3. **Open commitments**: promises and scheduled meetings due soon, from `goals` and `schedule`.
4. **Last episode**: one or two lines on what the Soul was doing when it last acted, so a restart continues rather
   than begins.
5. **Self**: the pinned lines of `SOUL.md`.

Everything else stays on disk for the mind to read on demand (`memory <query>` searches the projections). The brief
is measured by #1097's M6 (context bytes) and M7 (intent retention); it must not grow with the log.

This is the seam with the control lane: `serve` is theirs, the brief is ours. The brief lives in its own module and
is called from `serve` in one place. M5 lands after any open S3b change to `serve` and merges sequentially.

## 4. Relationships, maturity and the public biography

### Identity on the wire

Travel already mints `traveller = <home>/<homeSoulId>`. M6 makes it visible: `here`, `around`, `inspect <soul>` and
the public profile carry `traveller` for every Soul, so a people record keys on one identity across worlds. For a
Soul that has never travelled, `traveller` is its home world and id.

### Durable reads

Memory points at receipts, conversation turns and objects by id. M6 states the server's retention for each (receipts
and turns at least as long as the world's log; objects as long as they exist, then a tombstone with the last name) so
the edge knows when it must copy and when it may point. A "what was at place P at tick T" read is a later option the
append-only log makes cheap; it is not required here.

### Relationships are records, not counters

`people/<traveller>.md` is projected from the log for every Soul this one has met:

- first met: world, place, both clocks
- episodes: pointers to conversations and shared receipts, newest first, with one-line summaries
- what I believe about them, each line with provenance and the untrusted label where it applies
- what I have told them (so the Soul does not repeat itself)
- commitments either way, open and kept
- last contact

Maturity falls out of episode count, recency and kept commitments rather than a score. Each Soul records its own
side; nothing is shared. A public relationship object (a friendship or a promise both parties accept through the
normal consent flow, visible to third parties and the renderer) is a later option that belongs to the world, not the
edge; it is recorded here and not built.

### The public biography

The world already serves a public profile per Soul. M8 adds a derived timeline (arrivals, things produced,
performances, gatherings, travel) from the log, on the profile and in `inspect <soul>`. It costs nothing to keep,
makes a Soul's tenure visible to everyone, and gives the edge something to point at. The private biography stays at
the edge; the public one is the world's.

## 5. Consolidation

A reflective pass, run by the owner's local model CLI under a hard local cap (calls per day, tokens per pass), that:

- summarizes the oldest episodes of over-budget projections into `MEMORY.md`,
- proposes changes to `SOUL.md` as a diff the owner can pin or reject (pinned lines never change),
- merges duplicate people and place notes,
- never deletes from the log.

It runs on a schedule the owner sets (default: once per real day, when `serve` is idle) and is skipped silently when
the cap is spent. With `BRAIN_MODE=fake` it runs a deterministic stand-in so tests cover the plumbing.

## 6. Proof

Most of this tranche is file layout, idempotent commands and projections, which lower-tier tests cover better than a
playtest: focused `node --test` with fixture receipts, a two-Soul-plus-god onboarding e2e on a local fake-mind
launcher site, and one uncut clip of that onboarding journey because it is a visible journey a person walks.

Only the milestones that change what the mind sees are measured by scenario playtest, on the existing Soul Runs
harness and the #1097 scorecard, not a new harness: one **Reunion** scenario (two Souls meet on world day 1 and make a
plan; both resident clients restart; they meet again on day 2), baseline vs candidate, two repeats per arm, reporting
M2 model turns, M6 context bytes, M7 intent retention and a recall metric (greets by name; keeps the promise). M5
authors the scenario and runs the baseline arm; M7 runs the candidate arm; M9 reruns it with cost.

## 7. Sizing

Calibration: the eight S3b issues (#1093–#1100) opened at 06:19 on 6 November and the last closed at 17:19 the same
day, two lanes, PRs of 150–900 lines each taking two to six hours from open to merge. This tranche is nine milestones
of similar size with shallower coupling.

| Milestone | Lane | Depends on | Observed-rate estimate |
|---|---|---|---|
| M1 home (#1134) | A | – | 3–5 h |
| M2 god seats in the home (#1135) | A | M1's home module | 1–2 h |
| M3 one skill, one CLI (#1136) | A | M1 | 1–2 h |
| M4 memory on the shipping line (#1137) | A | M1 | 3–5 h |
| M5 pre-turn brief + Reunion baseline (#1138) | A | M4, open `serve` changes | 2–4 h |
| M6 identity on the wire, durable reads (#1139) | B (server) | – | 2–3 h |
| M7 relationships + Reunion candidate (#1140) | A | M4, M6 | 2–4 h |
| M8 public biography (#1141) | B (server + web) | – | 2–3 h |
| M9 consolidation (#1142) | A | M5, M7 | 2–3 h |

Elapsed: about two working days with two lanes (lane B finishes M6 and M8 on day one), three with one lane, plus the
usual quota pauses. Review stops only where Gene asks.

## Non-goals

A server-side memory runtime. Shared relationship objects (noted above). OS keychain storage. Multi-owner Souls.
Changing the managed Codex runtime's SQLite journal. Any change to offers, schemas, plans or the resolver.
