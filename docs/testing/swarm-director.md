# Swarm director

The swarm director runs a scene with several Souls at once. A cast file names the world, the seats and their
characters, a shared brief, a room, a presentation order and a success condition checked from world truth. The
director gathers everyone in the room, gives each seat its turn in order, and nudges stragglers and silent speakers.
A console (stdin, or a script in headless runs) lets you redirect seats mid-scene. It is built on the
[playtest framework](playtests.md) (`tools/playtest/director/swarm/`) and writes a normal run folder.

## Run

```sh
node tools/playtest/playtest.mjs direct <cast.json> --server-root <sim-checkout> --out <run-dir> \
  [--world <url>] [--headless] [--script <file>] [--only <seat,seat>] [--no-planner] [--force-machine] [--keep-world]
```

| Option | Meaning |
| --- | --- |
| `--server-root` | Sim checkout whose server runs the dev world (needs a built `apps/web/dist`) |
| `--world <url>` | use an existing world instead of provisioning one (same as cast `world.kind: "url"`) |
| `--headless` | no stdin console; the cast's `console.script` plays it |
| `--script <file>` | a console script file |
| `--only` | run a subset of seats; order and script entries are filtered to match |
| `--no-planner` | use template directions instead of a planner model call |
| `--force-machine` | continue past a failed machine gate and record it |
| `--keep-world` | leave the dev world running after the scene |

Steps: preflight, provision (or attach to `--world`), seats onboarding in parallel, cameras (follow per seat plus one
wide), planner, orchestrator with the console, close, verdict, then metrics, journal and `story.html`. Reviewer and
developer are off by default. `node tools/playtest/playtest.mjs review <run-dir>` adds them later.

Outputs in the run folder: `director/directions.jsonl` (every direction and its reason), `director/verdict.json` and
`director/VERDICT.md` (checks plus per-seat cost), `REPORT.md`, `story.html`, and the usual seats, evidence and shots
folders. Re-verify a finished run with `node tools/playtest/director/swarm/verify.mjs <run-dir>`.

Test the director without a world or model: `node --test tools/playtest/director/swarm/test/*.test.mjs`. Example
casts are in `tools/playtest/scenarios/casts/` (`smoke-duo.json` is the smallest). `scenarios/lib/validate.mjs`
checks a cast's room and podium against its genesis template. For cloud runs set `PLAYTEST_DIRECT`
([cloud playtests](playtests-cloud.md)).

## Console

| Line | Effect |
| --- | --- |
| `<text>` | broadcast to every seat's card |
| `<seat>: <text>` | one seat's card (seat id or Soul name, case-insensitive) |
| `redirect <seat>: <text>` | sent now, and replaces that seat's talk when its turn comes |
| `economy <seat\|all> <lean\|normal\|rich>` | change how much a seat may spend per direction |
| `pause`, `resume`, `status`, `end` | control the scene |

Script entries are `{ "atSec": n, "line": "..." }` or `{ "at": "go:<seat>" | "prepare:<seat>" | "phase:<name>",
"line": "...", "expect": ["word"] }`. `expect` lists words the redirected talk must contain.

## Cast file

`director/swarm/cast.mjs` (`normalizeCast`) validates a cast and fills defaults:

```jsonc
{
  "kind": "cast", "name": "smoke-duo", "version": 1, "seed": 7002,
  "world": { "kind": "dev", "genesis": "worlds/templates/eden-district.json", "slug": "pt-duo", "port": 4997,
             "natives": false },                 // or { "kind": "url", "base": "<world url>" }
  "durationSec": 1800,                            // hard stop (default 2400)
  "brief": "One paragraph every seat shares.",
  "room": { "label": "the library hall", "match": ["hall"] },   // case-insensitive place-path substrings
  "podium": { "label": "the lectern", "pos": [0, 0], "radiusM": 2, "ref": "<template op name>" },  // optional
  "order": ["doc", "grumpy"],                    // presentation order (default: seat order)
  "seats": [{ "id": "doc", "soulName": "Doc", "character": "One paragraph.", "topic": "what they present",
              "adapter": "claude-headless", "model": "haiku", "effort": "low", "economy": "lean" }],
  "economy": { "lean": { "maxTurnsPerDirection": 2, "maxTurnWallSec": 480, "guidance": "..." } },  // merged over defaults
  "timing": { "truthPollSec": 5, "gatherMaxSec": 900, "nudgeAfterSec": 150, "maxNudges": 3, "quietSec": 25,
              "speakTimeoutSec": 240, "maxSpeakNudges": 1, "prepareAhead": true, "presentWaitSec": 120 },
  "orchestrator": { "planner": null, "plannerEffort": "medium" },   // planner: a model name, or null for templates
  "success": { "allPresent": true, "minChars": 40, "inOrder": true, "eachOnce": true, "fromPodium": false },
  "observer": { "sampleSec": 15, "cameras": ["follow", "wide"], "viewport": [1024, 640], "dpr": 1 },
  "rails": { "onboardWallSec": 600, "onboardTimeoutSec": 540, "onboardConcurrency": 4, "quotaStopPct": 90,
             "maxTurnsPerRequest": 6, "maxTurnWallSec": 480 },
  "console": { "script": [{ "at": "go:doc", "line": "redirect grumpy: talk about the piano.", "expect": ["piano"] }] }
}
```

Required: `kind: "cast"`, a lowercase `name`, `world` (a `dev` world needs `genesis`), `brief`, `room.label` and
`room.match`, and seats with a unique lowercase `id`, `soulName` and `character`. Seats default to `claude-headless`,
`haiku`, `low` effort and `lean` economy. `success.fromPodium` needs a `podium`. Every economy level allows a seat
turn 480 s of wall time; `lean`, `normal` and `rich` differ in turns per direction and in the words the direction
carries. Shorter walls cut turns off mid-walk on a loaded host.

How the orchestrator behaves:

- `go` for the next speaker waits until the previous speaker has finished. Finished means speech seen, then the card
  result or `quietSec` of silence; raise `quietSec` for seats that talk in short lines with long gaps.
- With `prepareAhead`, the next speaker gets a `prepare` direction when the current one gets `go`.
- Directions sent before a seat's turn tell it to hold until "your turn".

The verdict reads world truth only:

- everyone present in the room
- each seat presented once, in order, with at least `minChars`
- redirects observed
- optionally, every talk given within the podium radius

## Live runs from a chat session

For directing Souls on a live world by hand, without the harness, the `sim-director` Claude Code skill makes the
chat session the coordinator, with one subagent per Soul. Each subagent works in its own folder and onboards from the
world's served `instructions.md` like any new agent. The world owner approves each Soul in their open Sim window.
The coordinator then relays plain-language directions. A subagent runs only a few CLI calls per direction and reports
one line back. It never starts a Soul's live mind and leaves nothing running when the scene ends. Use a dev or forked
world to rehearse; a `--world <url>` run of `direct` onboards seats with the dev onboarding text, which does not cover
a real world's owner approval flow.
