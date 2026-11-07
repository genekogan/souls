# souls-director — measured mode (swarm director and playtests)

Not the default: see `SKILL.md` for the plain coordinator + subagents mode. Use this for measured runs: a cast
directed by the harness with a VERDICT, or a playtest scenario (the T3 proof in `docs/process/PROOF-POLICY.yml`:
scenario playtest, 2 repeats per arm).

Two tools in `tools/playtest/`, driven here by background scripts so the chat stays free while they run:

- **Swarm director** (`playtest.mjs direct <cast.json>`): one director above N seats. Each seat is a headless
  `claude` CLI session that makes and plays one Soul. The director writes on each Soul's owner card (gather in the
  room, prepare, "your turn"), gates turn-taking on world truth (public placePath and speech), nudges stragglers, and
  takes live console lines on stdin. At the end it writes `director/VERDICT.md` and a story.
- **Playtest** (`playtest.mjs run <scenario.json>`): a scripted battery or persona-driven session with seats,
  cameras and oracles, then a Reviewer and Developer pass. No live console.

Scripts (`.claude/skills/souls-director/scripts/`, each has `--help`):

| script | does |
|---|---|
| `direct.sh [--dry-run] [--force] [--with-cast-script] [--checkout DIR] <cast.json> [args]` | validates the cast, checks the server root and the machine, makes the console pipe, starts the director detached, records the run |
| `run.sh [--dry-run] [--force] [--checkout DIR] <scenario.json> [args]` | same for a playtest scenario (runs `scenarios/lib/validate.mjs`) |
| `say.sh [--broadcast] "<console line>"` | parses the line with the harness's own parser, prints how it will be read, writes it to the live console |
| `status.sh [RUN_DIR] [--lines N]` | process state, seat pairing, phase and speaker, per-seat table, last director lines, last world speech, tokens, verdict |
| `end.sh [--wait SEC] [--no-wait] [--kill]` | sends `end`, waits for the close (seats, world, verdict, story), clears the state |

Paths (all overridable): checkout `SIM_CHECKOUT` (default: this repo), state `SIM_DIRECTOR_STATE` (default
`.e2e/playtest/live/current.env`, moved to `last.env` by `end.sh`), runs `SIM_RUNS_ROOT` (default
`.e2e/playtest/runs/<YYYYMMDD-HHMMSS>-<name>-<seed>/`, harness output in `console.log`), load limit `SIM_LOAD_MAX`.

## Hard rules
1. **Dev world first.** Casts default to a fresh local dev world built from a genesis template with fake natives.
   Pass `--world <url>` (a real or forked world) **only when the user says so in this conversation**. Production worlds
   use the real owner approval flow, and seats onboard with the dev text (see Known limits).
2. **One cast or playtest at a time per machine.** The scripts refuse while one of ours is live or any
   `playtest.mjs run|direct|replay|replay-set` process runs, or when the 1-minute load is over `SIM_LOAD_MAX`.
   On a BLOCK, tell the user what is running and ask; `--force` only on their explicit say-so. (The harness
   preflight has its own machine gate for load and free memory, overridable with `--force-machine`.)
3. **Seats use real model calls.** Every seat is a `claude` CLI session (haiku by default), plus a planner call if the
   cast enables one, plus Reviewer/Developer calls for a playtest. The harness checks usage before and during the run
   (`rails.quotaStopPct`). Say the seat count and models before starting; never run one nobody asked for.
4. **Start detached, never in the foreground.** The scripts use `nohup setsid … &` (plain `nohup` where `setsid` is
   missing). Do not run `playtest.mjs` directly from a tool call: it outlives the 10-minute foreground limit.
5. Never edit the harness, the repo's casts, or the server root mid-run. Write new casts and scenarios under
   `.e2e/playtest/casts/` unless they are meant to be committed in a PR.

## Before starting: server root
- **Server root** (`--server-root`, default: the checkout) must be a built Souls checkout containing
  `tools/god-skill/dev-world.mjs`, `apps/web/dist/index.html` and `tools/world-launcher/soul/eden.mjs`; the scripts
  refuse otherwise. Build with `pnpm install --frozen-lockfile && pnpm build`. Say which root you used.
- Optional read-only check: `node tools/playtest/playtest.mjs preflight --server-root <root>` (usage, CLI versions,
  load, free memory; starts nothing).
- Cameras need Playwright and Chromium (`PLAYWRIGHT_BROWSERS_PATH`, `/opt/pw-browsers` when present). No GPU needed.

## From the user's words to a cast
Write the cast to `.e2e/playtest/casts/<name>.json`, copying `tools/playtest/scenarios/casts/smoke-duo.json` (two
seats) or `seven-dwarves.json` (seven, planner, one scripted redirect). `direct.sh --dry-run <cast>` validates it
(`normalizeCast` lists every problem at once) and prints seats, order, room and planner; also run
`node tools/playtest/scenarios/lib/validate.mjs <cast>`.

Schema (`tools/playtest/director/swarm/cast.mjs`; defaults filled in when omitted):

| field | meaning |
|---|---|
| `kind`, `name`, `version`, `seed` | `"cast"`; lowercase name (names the run folder); 1; an integer label |
| `world` | `{"kind":"dev","genesis":"worlds/templates/<t>.json","slug":"pt-…","port":N,"natives":false}`: a fresh local world from a template (relative to the server root). Pick a port no other run uses and none `e2e/config.mjs` reserves. `{"kind":"url","base":"https://…"}` only on the user's word |
| `durationSec` | hard cap; the session also stops when the last talk is done |
| `brief` | the shared plan in owner language: who they are, where they meet, what each does, in what order |
| `room` | `{"label":"the library hall","match":["hall"]}`: `match` are lowercase substrings of the Soul's public `placePath`. Find names in a template with `tools/playtest/scenarios/lib/world-names.mjs` (`templateNames`) |
| `podium` | `{"label":…,"pos":[x,z],"radiusM":…,"refs":[…]}`: the speaker is sent there; `success.fromPodium` checks it |
| `order` | seat ids in speaking order, each once |
| `seats[]` | `id`, `soulName`, `character` (one paragraph), `topic`, `model` (`haiku` default, `sonnet`, `opus`), `effort`, `economy` (`lean` default, `normal`, `rich`), `adapter` (`claude-headless`) |
| `economy` | optional overrides of the per-direction turn and time budgets per level |
| `orchestrator` | `{"planner":"opus","plannerEffort":"medium"}` writes in-character directions; `"planner":null` (or `--no-planner`) uses fixed templates, cheaper and predictable |
| `timing` | `truthPollSec`, `gatherMaxSec`, `nudgeAfterSec`, `maxNudges`, `quietSec`, `speakTimeoutSec`, `maxSpeakNudges`, `prepareAhead`, `presentWaitSec` |
| `success` | `allPresent`, `minChars`, `inOrder`, `eachOnce`, `fromPodium` |
| `observer` | cameras `["follow","wide"]`, `sampleSec`, `viewport`, `dpr`, `arrivalTimeoutMs` |
| `rails` | onboarding wall/timeouts, `onboardConcurrency`, `quotaStopPct`, per-request turn limits |
| `console.script` | scripted lines: `{"at":"go:<seat>","line":"redirect grumpy: …","expect":["piano"]}` (events `go:`, `prepare:`, `done:`, `redirect:<seat>`, `phase:turns`, `phase:done`) or `{"atSec":300,"line":"…"}`. **Live mode ignores it** unless `--with-cast-script` (or `--headless`) |

Turning words into fields: "seven friends meet in the library and each gives a short talk" is the brief, room, order
and one seat each; "give Doc more room" is Doc `economy: normal`; "cheap" is haiku, `lean`, no planner; "then Grumpy
surprises everyone" is a scripted redirect at `go:<the seat before him>` with an `expect` word, or a live `redirect`.
Show the user the `--dry-run` summary before starting.

## Running a cast
```bash
S=.claude/skills/souls-director/scripts
$S/direct.sh --dry-run .e2e/playtest/casts/<name>.json --server-root <root>   # read the gate, show the user
$S/direct.sh .e2e/playtest/casts/<name>.json --server-root <root>             # returns in ~3 s
$S/status.sh                                   # every few minutes, and whenever the user asks
$S/say.sh "grumpy: sit at the front, please"   # forward the user's instruction
$S/end.sh                                      # when the user says stop, or after the verdict
```
Passthrough args: `--only doc,grumpy` (subset; not with `--with-cast-script`), `--no-planner`, `--keep-world`,
`--headless` (no console; lines only from the cast or `--script FILE`). `direct.sh` passes `--out` itself.

The console is a named pipe (`$SIM_DIRECTOR_STATE/console.fifo`) on the director's stdin; `holder.sh` keeps a writer
open so each short `say.sh` write never ends the input. `--headless --script FILE` is the alternative when no
steering is wanted (JSON array as in `console.script`, or lines `+<sec> <line>` / `@go:<seat> <line>` / `<line>`).

Timeline: onboarding (each seat makes its Soul from `instructions.md`, up to 10 min) → gather (walk to the room,
nudges) → gate (everyone in, or `gatherMaxSec`) → turns → close (seats and world stopped, verdict, story; a few
minutes). A two-seat cast takes roughly 10 minutes; seven seats 20–30. To wait without blocking chat, use the Monitor
tool with an until-loop on the log (e.g. until `grep -q '^\[..:..\] gate:' <run>/console.log`) or poll `status.sh`.

## Console vocabulary (what `say.sh` sends)
| line | effect |
|---|---|
| `<text>` | written on every paired seat's owner card |
| `<seat>: <text>` | that seat only (id or Soul name). An unknown `word:` would go to everyone: refused unless `--broadcast` |
| `redirect <seat>: <text>` | changes what that seat does: folded into its turn if before it, applied now if during it |
| `economy <seat\|all> <lean\|normal\|rich>` | per-direction budget from the next direction on |
| `pause` / `resume` | stop / restart new directions; the world and seats keep running |
| `status` | one status line into the log |
| `end` | stop the plan; the run closes and writes the verdict (use `end.sh`) |

Phrase forwarded lines the way an owner writes to their Soul: plain words, no commands or file paths.

## Reporting each turn
From `status.sh`, a short update: phase and elapsed time; seats paired or not, in or out of the room, nudges and why;
who has spoken, from where, a line of what they said, who is next; what you forwarded and how it was read; tokens per
seat; anything odd in the log (`ERROR`, `NOT PAIRED`, `camera … failed`).

## Reading a finished cast
In the run folder: `director/VERDICT.md` (PASS/FAIL per check, talks per seat, redirects and whether `expect` words
were heard; `node tools/playtest/director/swarm/verify.mjs <run>` rewrites it from the logs), `story.html`,
`journal.md`, `REPORT.md`, `director/*.jsonl` (directions, speech, presence, timeline), `seats/<id>/chat-as-rendered.md`,
`shots/`. The Reviewer is off for casts; `node tools/playtest/playtest.mjs review <run>` runs it later (ask first).

## Playtests (scenarios)
A scenario (`tools/playtest/DESIGN.md` §2) has `name`, `version`, `seed`, `world`, `durationSec`, `seats[]` (`id`,
`adapter`, `model`, `effort`, `persona`, `personaModel`, `startOffsetSec`, `soulName`, `channelMix`), `god`,
`director`, `observer`, `review`, `rails`. Examples in `tools/playtest/scenarios/`.
- **Battery** (`director.mode: "scripted"`) for concrete asks ("walk to the fire circle, describe what you see"):
  `director.script` entries `{seat, atSec, channel, text, budgetSec, expect}`; `expect` kinds go/find/near/which-way/
  face/look with `targets` whose refs and positions come from the template (`validate.mjs` checks them), scored by
  `review/expect-oracles.mjs`.
- **Persona** (`director.mode: "persona"`) for a kind of user ("a newcomer", "someone trying to break it"): pick
  `tools/playtest/personas/<name>.md`.

Validate with `run.sh --dry-run <scenario>`; run with `run.sh <scenario> --server-root <root>`; check with
`status.sh`. It ends by itself after `durationSec` plus review (30–65 min). `end.sh` only waits for a scenario;
`end.sh --kill` stops it without the close step. Afterwards: `REPORT.md`, `story.html`, `reviews.jsonl`,
`issues.md`, `feature-requests.md`, `oracles.jsonl`, `metrics.json`; `node tools/playtest/review/rescore-oracles.mjs
<run>` re-scores oracles without a model. For T3 proof, run each arm twice and put both verdicts in the PR.

## Known limits
- `--world <url>` still onboards seats with the dev-world text, and a production world asks the real owner to approve
  pairing. Rehearse on dev or forked worlds.
- Seats run under a fixed command allowlist. A seat that uses absolute paths or compound commands gets "requires
  approval" and may give up. Tell it on its card to work only inside its own folder with relative paths
  (`node eden.mjs status`), one simple command at a time, no `&&`, no pipes.
- Under heavy load every client call slows down and slow walkers need all their nudges; keep to the gate.
- `quietSec` can cut a slow speaker short; raise it for long talks. Console lines you forward carry no hold guard,
  so a seat told something directly may act on it at once.
- `--kill` skips the close: seat CLIs and the dev world may keep running (`end.sh --kill` lists processes naming the
  run folder and the dev-world port) and no verdict is written until `verify.mjs <run>`.
