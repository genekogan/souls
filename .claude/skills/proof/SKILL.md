---
name: proof
description: Record the proof clip a T2+ change needs — one uncut, real-speed Playwright video of the changed user journey on a local fake-mind world, with a scrub bar and timecode burned in, desktop and (when layout changed) phone — then attach it to the pull request without committing video into the repo. Use when a change is tier T2 or higher, when a PR or issue asks for a clip, when the finish skill reaches its proof step, or when reproducing a bug on camera for triage.
---

# proof — an uncut clip of the changed journey

A reviewer should be able to watch what a user would see, at normal speed, start to finish. The clip is the
evidence; a screenshot, a contact sheet or a sped-up recording is not.

Source of truth for what a tier needs: `docs/process/PROOF-POLICY.yml` (T0 nothing; T1 focused tests + typecheck;
T2 adds one clip of the changed journey, desktop, plus phone if layout changed, on a fake-mind world; T3/T4 add more).
Get the tier of the current diff with `node tools/proof/tier.mjs --base origin/main`.

## Rules
- **Uncut and real speed.** One browser context, one take. Never trim, splice, speed up or slow down. If the journey
  is longer than the policy's `max_seconds`, record a shorter journey that still shows the change, not a faster one.
- **The take starts at arrival** (the default): the recording begins once the world is on screen, the arrival card
  is gone and the page has painted that (two frames), so the clip opens on the world, not on loading. From there it is one uncut, real-speed take of the journey,
  which is what the policy asks. When loading or arrival is itself what the change is about (the arrival card, a
  loading screen, first paint), or the journey is not on a world page (the world list, sign-in), pass `--from-load`:
  the take then starts at page creation. The sidecar's `start` (`arrival` or `load`) says which was used, and
  `upload.mjs --proof` copies it into proof.json `media[]`.
- **By day.** On a local world URL the recorder sets the world to midday with its clock paused before the page opens
  (`--time-of-day 12`, the default; the god env route as the dev owner). Dev worlds boot at 06:00 and run a world day
  per real hour, so without it a world up for 40 minutes is at night. Setting it is one `world` entry in the world's god
  history, and the clock stays paused afterwards. Pass another hour, or `--time-of-day keep` when the clock, the light
  or the god history is what the change is about. The sidecar's `worldTime` says what was set.
- **Real input.** Drive with `page.mouse`, `page.keyboard`, `page.touchscreen` or locator clicks, the way a user
  would. Do not call app internals from `page.evaluate` to make things happen on camera.
- **Fake minds, isolated data.** Local worlds only, `BRAIN_MODE=fake`, a fresh data dir. Never record against a
  production world unless the maintainer asks, and never with a signed-in personal browser profile.
- **No local URL on screen.** A Soul's owner card shows the Reconnect box whenever the Soul reads as disconnected, and
  the box prints the world's URL and the Soul's id. Keep an agent listening for the whole take. The recorder watches
  for this and fails a take that shows it (section 3).
- **Never commit video** (or frames) into the repo. Work under `.e2e/` (gitignored).
- The clip must show the change. Watch it (or at least extract frames, below) before you attach it.

## 1. Boot a fake-mind world

Needs a built web client (`pnpm install --frozen-lockfile && pnpm build`; skip if
`apps/web/dist/index.html` exists and is current for your change). In a fresh clone the build's prebuild check fails
until the web media are in place: `node tools/assets/pull.mjs --only 'apps/web/**'` (a few files) is enough for it.

```bash
node tools/god-skill/dev-world.mjs proof 4710 --genesis worlds/templates/hello-hamlet.json --fresh --data .local/proof
# prints http://127.0.0.1:4710/w/proof?dev=1 (pid N, log .lane/proof.log); the server keeps running detached
```

The homepage (world list, New world) is served by the world launcher, not by a single world. For a journey that
starts there, run a launcher (its worlds always get fake minds) and make a world for the list through its API:

```bash
node tools/world-launcher/launcher.mjs --port 4720 --range 4721-4723 --data "$PWD/.local/proof-launcher" --eager 0 &
curl -s -X POST -H 'content-type: application/json' -H 'authorization: Bearer dev:proof' \
  -d '{"name":"Proof Garden","template":"hello-hamlet"}' http://127.0.0.1:4720/__sim/worlds
# record against http://127.0.0.1:4720/ ; stop the launcher by its pid (it stops its worlds)
```

Pick the template that contains the changed surface (`worlds/templates/`: hello-hamlet is small and fast; eden-2026,
mars-two and others are larger). Use a free port; `e2e/config.mjs` lists ports reserved for other harnesses. Stop the server
with `kill <pid>` when done.

## Quick proof the app works: the local smoke

Before recording, or as the whole proof of a T1 change that touches the server or web app, run the local smoke. It
boots its own isolated launcher (fake minds, dev sign-in, data under the run dir) on a free port, opens the world list
and one world, checks that a person is drawn with no console errors and no failed requests, and stops what it started:

```bash
node e2e/local-smoke.mjs --port 9950 --clip      # --build first on a fresh clone; omit --port for any free port
# → .local/e2e/<timestamp>/summary.json, shots/1-world-list.png 2-world.png 3-person.png, clip.mp4
node tools/proof/upload.mjs --pr $N .local/e2e/<timestamp>/summary.json .local/e2e/<timestamp>/shots/*.png
```

`status: "pass"` in `summary.json` is the evidence; its clip is one uncut, real-speed take of the smoke journey. It is
not a clip of your change: a T2 change still records its own journey below. Details: `docs/testing/e2e.md#local-smoke`.

## 2. Write the steps

Copy `.claude/skills/proof/steps.example.mjs` to `.e2e/proof/<slug>/steps.mjs` and script the changed journey:
do the thing, show the result. With the default arrival start the steps begin on the arrived world (the `arrived` mark
is 0:00); with `--from-load` they begin right after navigation. `mark('label')` stamps a chapter time into the sidecar
so the PR can say "the panel opens at 0:07". Keep it to the journey the change affects.

When an owner's card is on screen, set `SOUL_DIR` to the Soul's CLI folder (and `EDEN` to its `eden.mjs` if it isn't this
checkout's). The example then holds a `listen` from before the page opens until the recorder exits, starting it again
when the owner's message ends it. Keep that block when you copy the file.

## 3. Record

```bash
node .claude/skills/proof/record.mjs --url 'http://127.0.0.1:4710/w/proof?dev=1' \
  --steps .e2e/proof/<slug>/steps.mjs --out .e2e/proof/<slug>/desktop.mp4 --viewport desktop
# layout or touch changed? also:
node .claude/skills/proof/record.mjs --url '...' --steps .e2e/proof/<slug>/steps.mjs \
  --out .e2e/proof/<slug>/phone.mp4 --viewport phone
```

- Browsers: uses `PLAYWRIGHT_BROWSERS_PATH`, else `/opt/pw-browsers` when present. If Chromium is missing:
  `PLAYWRIGHT_BROWSERS_PATH="$PWD/.e2e/browsers" pnpm --filter mars-campus-viewer exec playwright install chromium`.
- Playwright is resolved the same way the playtest harness does (`tools/playtest/lib/platform.mjs`: a global
  `playwright`, else `@playwright/test` from `mars/viewer`). No GPU is needed; WebGL runs on SwiftShader.
- `--max-seconds` defaults to the policy's `max_seconds`. Exit 3 means the journey ran past it: shorten it.
- With ffmpeg: an mp4 with a progress bar along the bottom and a `hh:mm:ss / total` timecode (the timecode needs an
  ffmpeg built with drawtext; the sidecar's `timecode` says whether it is there). Without ffmpeg: the raw `.webm`;
  say so in the PR (players still show their own scrub bar).
- Each clip gets a `<clip>.json` sidecar: url, viewport, `durationSec`, `videoSec` (the recording's own length, about a
  second longer), `start`, `startedAt`, marks (`arrived` among them), `worldTime`, console errors, `privacy`, commit and
  dirty flag. Sidecars hold local paths: they stay unpublished, and `upload.mjs` refuses one. A Playwright without `page.screencast` records from page creation
  even without `--from-load`; the sidecar says so in `startFallback`.
- **Exit 4: the take showed something private.** Every 500 ms the recorder reads the page's visible text, fields
  included, for the page's own host (any port; `soul.game` is exempt) and the wording of the Reconnect box and the start
  prompt. The sidecar's `privacy` lists each hit by kind and second, never the text: `page-host`, `reconnect-box`,
  `start-prompt`, or `not-watched` when no read succeeded. `upload.mjs` refuses the clip. Fix the cause (usually a listen
  that wasn't held) and record a new take; never delete or edit the sidecar to get past this. It reads text, not
  pixels, and something on screen for less than the sidecar's `maxGapSec` can slip between reads, so step 4 still
  stands.
- The page has `--arrival-seconds` (default 120) to arrive before the take starts; a page that never shows a world fails
  (exit 1) with a hint to use `--from-load`, a still of where it stuck (`<clip>.open-failed.png`) and a sidecar.
  Console errors in the sidecar are findings: explain or fix them.

The run takes well under the 10-minute foreground limit. For several clips in one go, run them in the background
(`nohup setsid node ... > .e2e/proof/<slug>/rec.log 2>&1 &`) and poll the log.

## 4. Check it yourself

```bash
for t in 1 4 8; do ffmpeg -loglevel error -y -ss $t -i .e2e/proof/<slug>/desktop.mp4 -frames:v 1 .e2e/proof/<slug>/t$t.png; done
```

Look at the frames (Read the PNGs). The changed state must be visible, the world must have loaded (not a blank or
loading canvas), and nothing in frame should be private. If it does not show the change, fix the steps and record a
new take; do not attach a clip that does not prove the claim.

## 5. Attach it to the PR (never commit it)

Check every outgoing text/JSON payload with `node tools/proof/publication.mjs <payload files>` before publication.
Inspect media pixels, audio, filenames and binary metadata separately. Device paths, hostnames, device/private IPs,
local URLs and operational identifiers belong only in private records. Use relative paths and neutral capture
labels. The uploader blocks detected text leaks before uploading the batch; this cannot certify media privacy.

```bash
node tools/proof/upload.mjs --pr $N --proof .e2e/journal/$ISSUE/proof.json .e2e/proof/$SLUG/desktop.mp4 .e2e/proof/$SLUG/phone.mp4
```

- The default target is the PR's own prerelease `proofs-<n>` (tag on the default branch, created on first use);
  one release per PR keeps each under GitHub's 1000-asset limit, which the old shared `proofs` release reached.
  `--release <tag>` (or `SIM_PROOF_RELEASE`) names another release. The shared `proofs` release is full: on a branch
  whose `upload.mjs` still defaults to it, run main's copy (`git show origin/main:tools/proof/upload.mjs > .local/upload-main.mjs`). Assets are named
  `pr-<n>.<file>`, and a re-take gets `-2`, `-3`, so earlier takes, including failed ones, stay linkable.
  `SIM_PROOF_UPLOAD_URL` (+ `SIM_PROOF_UPLOAD_TOKEN`) switches to another endpoint, such as a CDN.
- With `--proof`, clip and image links are written into proof.json `media[]`, other files (logs, JSON) into
  `files[]`, and proof.json is uploaded last. Paste its link
  and the clip links into the PR's Proof section. The `journal` skill covers proof.json.
- With `--proof`, a clip's `uncut`, `realSpeed`, `seconds`, `viewport` and caption come from its recorder sidecar where
  proof.json leaves them unset; what you stated is never overwritten, so write `uncut: false` and it stays. A clip whose
  `uncut` or `realSpeed` would stay unset is refused before anything is uploaded (`proof.media-incomplete`): keep the
  sidecar beside the clip, or state both in its media entry.
- A clip whose sidecar records a privacy hit is refused, with or without `--proof` (`proof.clip-private`).
- **Inline preview.** GitHub serves release assets as downloads, so an mp4 link never plays in the PR. For each
  video, `upload.mjs` makes a small animated GIF with ffmpeg (`<clip>.preview.gif`: 6 s at real speed from the clip's
  `arrived` mark, or from 0 for a `--from-load` take; at most 5 MB), uploads it beside the clip, records it as `media[].preview` and prints a line like
  `[![desktop.mp4](…pr-412.desktop.preview.gif)](…pr-412.desktop.mp4)`. Paste that line: the preview plays in the
  PR and clicking it opens the full clip. When the change shows later in the clip, pick the window with
  `--preview-start <s>` (and `--preview-seconds <s>`). The preview is a pointer, not the proof: the uncut mp4 is.
  Always put an explicit **Full-resolution uncut video** link before each preview, stating the actual encoded
  dimensions and duration. Preserve capture resolution and frame the action so contact can be reviewed. Do not
  upscale a capture or use the reduced GIF to claim motion proof.
- **Exit 3: the upload is blocked** (no `gh`, not signed in, no permission, or no network, as in many cloud
  sessions). Tell the user which clips are waiting and where. Post a PR comment with each clip's duration,
  viewport, sanitized sidecar summary (marks, console errors, commit), and a repository-relative `record.mjs`
  command and steps file, so
  anyone can re-record it. Mark the proof "pending upload" in the PR body. Never paste video as base64, never
  commit it, and never push it to another branch.

`gh pr` may not work in cloud sessions; comment with
`gh api repos/$REPO/issues/$N/comments -F body=@.e2e/proof/$SLUG/comment.md`.

## What to write next to the clip
One line per clip: what journey, which world template, viewport, duration, commit, and the moment the change is
visible ("0:07 the seat highlights and the Soul sits"). Plus any console errors and why they are acceptable.
