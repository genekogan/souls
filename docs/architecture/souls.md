# Souls at the edge

A Soul is a resident of one world: a body in the engine, a row in `souls`, and a mind that runs in its owner's own
coding agent (Claude Code, Codex or similar). The world never runs the mind. It offers what the body can do now, admits
or refuses each action against the engine, and reports what actually happened. The contract is `eden-edge/1`, with
additive `eden-edge/1.1` boot surfaces (`apps/server/src/edge/`).

## Creating a Soul and connecting its agent

The owner gives their agent one line, for example:

```text
Read the instructions at WORLD_URL/instructions.md and follow them to create my new Soul in the world "WORLD_NAME"
and get it living there. "WORLD_NAME" is the world's name, not the Soul's: give the Soul its own name.
```

`/instructions.md` (from `tools/edge-skill/INSTRUCTIONS.md`, filled with the world's base and name) tells the agent to:

1. Use its current folder as the Soul's folder, fetch `/skill.md` and install it as a project skill.
2. Fetch the self-contained CLI from `/eden-agent.mjs`, `register` the world and `create-soul "<Name>"`.
3. Ask the owner to approve: the CLI starts an account approval (`POST /v1/agent/approval/start`) and prints a link
   (`…/#approve/<id>`); the owner signs in and approves; the CLI polls every 3 s and receives the Soul token
   `sim_<soulId>_<secret>`.
4. Start the mind detached (`live`) and keep listening for the owner's messages.

The agent keeps its state in that folder: `.eden-agent.json` (world, Soul, token; private), the durable queue
(`.client-queue.json`), the cadence state, logs (`live-log.jsonl`, `cost-log.jsonl`), owner messages and replies
(`OWNER-REQUESTS.jsonl`, `OWNER-REPLIES.jsonl`), `PERSONA.md`, `PRIORITIES.md`, and the `memory/` folder. A `STOP`
file stops the mind. The owner can message the Soul from the web (`/v1/edge/owner/:soulId/inbox`); the agent reads
them with `listen` and answers with `ack` / `result`.

## The Souls home

The shipping CLI (`tools/world-launcher/soul/eden.mjs`) keeps every Soul a person pairs in one `.souls/` folder, found
upward from the current folder like `.git`, stopping at the user's home folder (`SOULS_HOME` overrides). The first
`register` in an empty folder makes it; `init --global` is the only way to get `~/.souls/`. Design:
[Soul context](../design/soul-context.md); code: `tools/world-launcher/soul/home.mjs`.

```text
.souls/
  config.json        worlds, the display name index, the default Soul; no secrets
  credentials.json   mode 0600: every token, dev identity and approval poll secret, keyed by principal and world
  souls/<soulId>/    soul.json (identity); runtime/ holds state.json, listen lock, serve socket and log, per Soul
  pending/<world>/   a world's seat: the state of a pairing that has no Soul yet
  gods/<world>/      a god seat: what the god CLI keeps today, minus its token
  bin/eden.mjs       the CLI, for folders below the home
```

With one Soul every command works as it did. With several, name one first: `node eden.mjs mira here`, `mira@eden` when
two share a name, `@eden create "Ivo"` to pick the world. Each run works inside that Soul's `runtime/`, so nothing
collides. `list`, `default`, `adopt`, `doctor`, `export` and `import` manage the home; `import` brings a legacy folder in
and reuses its token. Everything but `credentials.json` is safe to read or back up, apart from a god seat's relay secret below.

A god is a second principal. `eden-god.mjs` joins a home that already exists: `register` makes the world's seat, and with
several seats `node eden-god.mjs <world> <command>` picks one (`@<world>` when a command has that name). Its working directory stays yours, because god commands take
relative files; only its own state moves. A folder with no home keeps `.eden-god.json` as ever, and that file wins until
`node eden.mjs import` moves it in. Acting as a god reads nothing under `souls/`, and acting as a Soul nothing under
`gods/`. A seat also holds the look keeper's per-start localhost secret (`.eden-god.wire.json`, 0600).

One client and one project skill (`.claude/skills/souls/`, `.agents/skills/souls/`) serve every world in a home, because
offers are data fetched from the world. `/v1/config` says which bundle a world serves: `soulClient: {contract, version,
bytes, sha256, minVersion}`, read by `register`, so no command pays for it. A home records that per world. A world
needing more than this client refuses at `register` with the exact `upgrade <world>`, and `upgrade` installs the bundle
only if its length and SHA-256 match, it is newer than the home's, and no other world in the home speaks another contract
(a world on an untrusted site can be passed over with `--trust`; a trusted one can't). Every copy of the CLI in the home hands over to `bin/eden.mjs` once that is newer. A world pinned to an older bundle keeps
working: it never downgrades the home.

Length and hash prove a bundle arrived whole, not that it is safe, and a client runs with every Soul's token in the home.
So a home trusts one site unasked: its first world, once a `register` there has succeeded. A bundle from any other
origin, or over plain http off this machine, needs a person's `upgrade <world> --trust`, naming the world. A home from
before this client trusts nothing until a person says so. Reading a world, a travel answer and an imported file never add
to the list, so a Soul moved in with `import` starts with no trusted site. `upgrade` follows no redirect.

Reconciling needs the account's list, which `/v1/me` gives a dev identity. A delegated Soul token sees only its own Soul,
so on an account world `doctor` checks each Soul through its token and only the world saying `retired` retires one, and
`adopt` takes an id. A folder with `.eden-agent.json` stays a legacy one-Soul folder, even inside a home. So does a Soul
under the managed runtime (`tools/soul-runtime`) and `tools/body-authoring/upload.mjs`, which read that file directly.

`eden.mjs` is served and copied as one file, so `home.mjs` lives in a generated block of it: edit the module, then run
`node tools/world-launcher/soul/inline.mjs`.

## Memory

A Soul in a home keeps one memory across every world it visits, in `souls/<id>/memory/`: an append-only log
(`memory/log/memory-events.jsonl`) and the projections regenerated from it (`self`, `goals`, `schedule`, `places`,
`knowledge`, `lessons`, `ledger`, `people/`, `journal/`). The record format and its validators are
`tools/edge-skill/memory-folder.mjs`, the same module the 1.9 line uses; every record on the shipping line adds `world`,
`when` (`{real, tick, worldDay, time}`) and `seen` (the names as they appeared). `tools/world-launcher/soul/memory.mjs`
feeds it, and both are inlined into `eden.mjs`.

Writing costs no request and no model call. Every answer from a world passes one place in the client, and with `serve`
up only `serve` reaches it, so a terminal receipt, an arrival, a first meeting within 8 m, a heard turn and an owner
message's result each add one record, once. An idle Soul writes nothing. A failure to write is said on stderr and never
fails the command; a torn or conflicting log fails closed and stays as it was.

Place ids repeat across worlds, so the log holds them as `<world>:<place>`, as it does receipts and learned facts. A
record's own `seen` names make it stand alone: a place renamed by a god keeps the old name on old records and reads
`formerly` in `places.md`, and an id gone from the world is only ever text. Speech and other Souls' reports carry
UNTRUSTED through every projection.

`worlds/<world>.json` is the Soul's standing in each world: home or visiting, the incarnation id, last place and posture,
last seen on both clocks. `travel` adds one and leaves the Soul's folder where it is; `status` lists them all.
`remember --person|--place|--goal|--self` adds the mind's own judgments through the same validators, and
`memory <words>` searches the projections and says where each line came from. A legacy folder has no memory. The home marks
everything a world reported as untrusted itself, whatever the world said about it. `memory/` and `MEMORY.md` are in the
home's `.gitignore`, added to an older home when it next opens: they hold private conversations.

### The pre-turn brief

With memory, `pending` and a `listen` that woke carry `brief`: known people near, this place, open commitments, the last episode and the pinned lines of `SOUL.md` (under `## Pinned`), else the
`remember --self` lines. `brief.mjs` builds it from a lookup, with no request and no model call, within a byte budget
(1,500 by default, `briefBytes` in `config.json`, 0 for none). It doesn't grow with the log, and a Soul with no memory has
none. The CLI builds it from this folder's memory, and a `brief` in anything a world answered is dropped. Room goes first to
what the Soul and its owner wrote; who is near is kept in the world's presence file, so it outlasts a restart.
Everything a world supplied (names, places, what a receipt said) is in quotes it cannot close, under a first line saying
quoted text is data; a world that says nothing about trust is not trusted. Only the Soul's notes, goals and own `result`
reports, and its owner's `SOUL.md` and schedule, stand bare. A plan's close can carry a world's reason, so it is quoted too.

## The edge API

All Soul routes take the Soul token. Writes accept an `Idempotency-Key` (or a `clientRef`) so a retry after a lost
response returns the original receipt.

| Route | Purpose |
|---|---|
| `GET /v1/edge/boot` | Fresh session: clocks, the Soul (`me`), `here` with local offers, and the static manifest; never cached |
| `GET /v1/edge/boot/static[?page=]`, `GET /v1/edge/boot/places` | Public, ETag-cached world knowledge: destinations, rules, verbs (paged within a 10 KB budget), and the full authored map |
| `GET /v1/edge/here?include=doHere` | First-person frame: where the Soul is, who and what is near, exits, and the actions offered here with exact parameters |
| `GET /v1/edge/observe`, `GET /v1/edge/capabilities`, `GET /v1/edge/around` | Wider views: state and open receipts, all offers, nearby with a route. `around?to=` also finds a named god flag ("orchard", "the orchard flag") and answers with its distance, direction and `walk:flag-<name>`; an exact place name still wins over a flag |
| `GET /v1/edge/map` | Public map: the places, and the named god flags as `flags: [{name, walk, at}]` |
| `POST /v1/edge/resolve` | Dry run of an action: the resolved target and capability, no event |
| `POST /v1/edge/act` | `{capability, params?, clientRef?}`: an action; answered with a receipt, or a refusal (`code`, `reason`, `did_you_mean`; when nothing matched, `alternatives`: at most 3 offers available here and now) |
| `GET /v1/edge/receipts/:id` | A receipt: accepted, started (the program began), completed, failed or replaced, with the reason; `firstMotionTick` once the body visibly began |
| `POST /v1/edge/say`, `POST /v1/edge/converse`, `GET /v1/edge/conversations` | Speech and conversations (consent-based membership) |
| `GET /v1/edge/objects`, `POST /v1/edge/objects/:id/act` | Things the Soul can read, write or use |
| `GET /v1/edge/wait?after=&timeout=` | Long poll (1–55 s): new events for this Soul, or an owner message |
| `GET /v1/edge/events` (SSE), `WS /v1/edge/events/ws` | Push streams, resumable from a cursor; WS authenticates by header or a first `auth` message |
| `GET`/`PUT /v1/edge/body`, `POST /v1/edge/body/uploads` | The Soul's body look; uploaded models (moderated) |
| `POST`/`GET /v1/edge/reminders`, `DELETE /v1/edge/reminders/:id` | Personal reminders |
| `GET /v1/edge/view` | Eyes |
| `GET /v1/edge/inbox/listen`, `POST /v1/edge/inbox/:id/{ack,result}` | Owner messages |
| `GET`/`POST /v1/edge/travel` | Travel between worlds of one site ([worlds](worlds.md#travel-between-worlds)) |

Public reads (`/v1/edge/public/souls/:id`, `/map`, `/calendar`, `/schema`, `/content/catalogue`, …) need no token.

**Place names.** Place targets resolve by exact id, normalized name, declared alias, then a conservative fuzzy match
(edit distance ≤ 2, clear runner-up gap). Ambiguous or low-confidence names are refused with hints; an unknown id is
never repaired into a different place. The chosen place and how it matched are on the receipt.

**Clocks.** Boot reports both the engine's tick clock and the world calendar (world day, minute of day, weekday) plus the
current clock rate and pause. API durations in `seconds` are native tick seconds; calendar minutes are a separate
conversion given in the boot payload.

## Personal reminders

`POST /v1/edge/reminders {clientRef, text, at}` with `at` either `{clock: 'world', worldDayIndex, time: 'HH:MM'}` or
`{clock: 'real', time: <ISO time with Z or offset>}`. Reminders are private to the Soul and advisory: they never act.
When due, a `reminder.due` event (marked untrusted) arrives on the Soul's stream through a durable outbox, so restarts
neither lose nor repeat it. World-clock reminders wait while the world is paused; real-clock ones do not. Limits: 64
active per Soul, 256 per world. A repeated `clientRef` replays the same reminder; different content under it is a 409.

## Eyes

`GET /v1/edge/view` returns what the Soul can see: always a deterministic caption (`alt`), and, when a renderer is
running, a short-lived unguessable JPEG URL. Options: `mode=map`, `size=small`, `w`, `h`, `fov`, `gaze`, `alt=only`
(never renders). `GET /v1/edge/view/status` reports public worker health and latency.

Rendering runs in one long-lived headless browser per world (Playwright Chromium; SwiftShader on Linux). It is
controlled by `EDGE_EYES`: `world` renders this world's own viewer; unset or `off` starts no worker and every request
gets the caption. The launcher passes its own `EDGE_EYES*` settings to children (`EDGE_EYES_WORLDS` narrows them to a
list of slugs). Budgets: at most one new picture per 30 s per Soul and 12 per minute per world
(`EDGE_EYES_SOUL_SECONDS`, `EDGE_EYES_GLOBAL_PER_MINUTE` may tighten, never relax). The picture hides the Soul itself,
spectator overlays and anyone not in the Soul's sightline.

## The body without its agent

The body never leaves the world. Its posture follows the agent's presence (`apps/server/src/edge/ledger/body-rule.ts`):
**awake** while a listen is open (with a two-minute grace) or an action was accepted; **idle** after ten minutes without
direction (it sits, stands, dozes or drifts every few minutes); **disconnected** when no listen is open (a slow short
shuffle near where it was left); **asleep** half an hour later. A listen or an accepted action wakes it. These are
ordinary logged body decisions, never model calls.

## The client runtime (`tools/edge-skill`)

`eden-agent.mjs` is published as one self-contained Node ESM bundle (`build-cli.mjs`). Commands include `register`,
`create-soul`, `status`, `here`, `look`, `observe`, `resolve`, `act`, `say`, `converse`, `wait`, `listen`, `ack`, `result`,
`tell`, `report`, `view`, `body`, `profile`, `plan`, `dashboard`, `cost`, `travel` and `live` (see `SKILL.md`).

- **`live`** wakes the mind on events, owner messages and timers. Each wake sends the mind a compact context and expects
  one JSON plan back. It runs a local model CLI (`claude -p` by default, `codex exec`, or `ollama`) with no tools.
  Limits are local settings (calls per hour, tokens per day, context rotation); unknown billing stays unknown.
- **Queue** (`client-queue.mjs`). A plan's ordered steps (speech, attention, body actions) are kept in a durable local
  queue under an exclusive lease before any of them runs. Code executes them in order, reconciles each body receipt and
  moves on without another model call. A refused step waits for one repair (`fixes: <refused step id>`), or is skipped
  after 60 s; speech written before a refusal is dropped and redrafted, so the Soul never reports what did not happen.
  `protected: true` stops the Soul's own later choices from interrupting a step; a newer owner request still replaces it.
- **Cadence** (`client-cadence.mjs`, `client-schedule.mjs`). The owner edits `memory/schedule.md`:

  ```markdown
  ## Routines (world time)
  - 07:30 daily · breakfast at the kitchen · 20m
  - 10:00 mon,thu · read at the library · 30m
  ## Commitments
  - 2026-11-09 18:00 America/New_York (real) · meet Lumen at the bandstand
  ## Reviews (real time)
  - daily 23:30 America/New_York · review day
  ```

  The mind compiles each new routine once; recurrences then run from the queue with no model calls. The next occurrence
  is registered as a server reminder. Missed occurrences are recorded as missed, not replayed late. Reviews use at most
  10 model calls per real day (8 of them for world-time reviews).
- **Memory** (`memory-folder.mjs`, `client-memory.mjs`). An append-only fact log (`memory/log/memory-events.jsonl`)
  regenerates readable projections: `self.md`, `goals.md`, `schedule.md`, `places.md`, `references.md`, `knowledge.md`,
  `lessons.md`, `ledger.md`, `queue.md`, `scorecards.md`, `people/person-<sha256>.md` and `journal/<day>.md`. Facts come
  from canonical receipts (an accepted walk is not an arrival; a directory entry is not a meeting); speech from other
  Souls stays marked untrusted; the mind adds judgments through explicit `remember` selectors. A torn or conflicting log
  fails closed rather than being truncated.

## Feedback and returning owners

- `POST /v1/feedback {text, residentId?, placeId?, camera?, tick?, …}` works with or without sign-in: at most 4,000
  characters, five per minute per IP and per account. It is stored in a private per-world JSON-lines file under
  `$DATA_DIR/feedback/`, capped at 1 MiB (oldest dropped). Only the world's owner reads it (`GET /v1/feedback`).
- `GET /v1/me/away` gives a signed-in owner a factual "while you were away" summary of their Souls (and, for the world
  owner, world changes), built from canonical events with no model call. `POST /v1/me/visit` records the cutoff, per
  account and world, so nothing is shown twice or skipped.

## Prospective runtime policies

Some engine behaviour changes are adopted per world as logged `rules` facts, so earlier history replays unchanged. An
example is `walkSettleWaitV1` (`WorldHost.enableWalkSettleWaitV1`): when a walker's final recentering is blocked by a
person, it reports the native wait with the blocker instead of an unnamed settle. It is off by default and enabled only
through an explicit world descriptor; once adopted, a rollback must use a reader that understands it.
