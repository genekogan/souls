# Score: world music

Every world page plays a playlist of Sim Score pieces: Tone.js music written as code and composed in the browser, with
no samples. Sim Score is MIT licensed, © Gene Kogan (see `SOURCE-NOTICE.md`).

## Vendored Sim Score

`vendor/sim-score/` is a byte-for-byte copy of one Sim Score commit: its `site/` (engine, pieces, catalog, browser
page), its Node lint harness (`tools/load.mjs`, `lint.mjs`, `score.mjs`, `serve.py`), `README.md` and `COMPOSING.md`.
`vendor/sim-score/PROVENANCE.json` records the source commit and a sha256 per file. Never edit the copy: fix a piece in
the Sim Score repository, commit there, and sync:

```sh
node tools/score/sync-sim-score.mjs <path-to-sim-score> [commit]   # commit defaults to HEAD
```

The sync refuses a source with uncommitted changes and a vendored copy edited by hand. It copies the commit's files,
removes the ones it dropped, rewrites `PROVENANCE.json`, prints what was added, changed or removed, and rebuilds the
playlist. Lint vendored pieces in place with `node vendor/sim-score/tools/lint.mjs <id ...> --cycles 32 --seed 7`. The
browser page runs from the copy too: `python3 vendor/sim-score/tools/serve.py 4802` (Tone comes from cdnjs).

## Playlist

`node tools/score/build-playlist.mjs` builds `playlist/` from the vendored copy:

- `playlist/engine.mjs`: the nine engine files (theory, compose, instruments, more-instruments, conductor, then the
  optional phrasing, spc, dialogue, groove) unchanged inside `createPlaylistScore(Tone)`, which takes Tone explicitly and
  keeps `Sim` private; plus `PLAYLIST` and `loadPiece(id)`. Nothing plays on import.
- `playlist/pieces/<id>.mjs`: each piece unchanged inside `register(Sim, Tone)`, one chunk per piece.
- `playlist/order.mjs`: the playlist order alone, for the file source, which needs neither Tone nor the engine.
- `playlist/BUILD.json`: source commit, playlist and a sha256 per generated file.

To change the playlist, edit `PLAYLIST` in the builder and rerun it. The builder prints any catalog "New pieces" id the
playlist leaves out. The current order is the "New pieces" family in catalog order, then twelve earlier pieces.

The player is `apps/web/src/gen-mesh/music.ts`. The first piece is random per visit, then playlist order; each plays
240 s, fades over 4 s, and the next starts. Mute or music off (bottom-right buttons; on a phone, the HUD's More menu)
stops it; turning it on restarts the current piece. A world's own `music` things stay quiet under it, and moving the
camera never restarts a piece.

Nothing loads at arrival. The player loads after arrival, after the first gesture, with music on and sound unmuted, in
idle time. It has two sources, chosen per piece (`source` in `state()` and the log):

- `file` (the default): every piece pre-rendered to audio by the score engine itself and streamed from the asset CDN
  (below), through a media element and a GainNode graph (`gen-mesh/music-file.ts`). The browser's media pipeline decodes
  it off the main thread, so a frame spike cannot drop a note. The next file is prefetched 20 s before the end and
  crossfades in 3 s before it while the current fades over 4 s. Each piece has several performances (renders with
  different seeds); every start of a piece (first, next, the crossfade's prefetch) picks one at random, and a resume after
  a hidden tab plays the same performance from the same position. Tone and the engine are never loaded.
- `tone`: the live Tone.js path, synthesised on the main thread, when the index lacks a piece or its file fails (three
  failures in a row give up on files for the session). `tone` and the engine are lazy chunks; each piece chunk is fetched
  just before it plays, the next one 20 s before the end. Tone owns its AudioContext (latency hint `playback`, 0.3 s
  lookAhead); a gesture resumes it where the browser requires (iOS).

### Rendered audio

`playlist/playlist-audio.json` is the index the file source imports (version 2): piece id → seconds and its
performances, each `{seed, url, bytes, sha256}`. A version 1 index (one file per piece, inline) still reads as one
performance each.
The files are not in git (nor in `tools/assets/manifest.json`: nothing pulls them into a checkout; they stream at play
time). To render and publish, after a playlist or engine change:

```sh
node tools/score/render-playlist.mjs [--pieces a,b] [--performances 3] [--force]   # headless Chrome, Sim.renderOffline, ffmpeg AAC
node tools/score/publish-playlist-audio.mjs                              # dry run: the plan
EDEN_ASSETS_CREDENTIALS=<0600 file> node tools/score/publish-playlist-audio.mjs --apply --receipt .local/<new>.json
node tools/score/publish-playlist-audio.mjs --verify                     # public GETs: headers, CORS, bytes
```

Each performance renders with a deterministic seed (performance 0: FNV-1a of the piece id; performance k: FNV-1a of
`<id>#<k>`), 240 s at 44.1 kHz stereo, through the engine's
master compressor and limiter, is encoded with ffmpeg (AAC 160 kb/s in an `.m4a` with the moov up front; `--format
opus|mp3` for the others) and is named by its SHA-256, the CDN's content-addressed key (`docs/operations/cdn.md`). The
renderer records peak and RMS per performance in `.local/score-audio/renders.json`. Tone's limiter is not a brick wall, so
about half the pieces overshoot 0 dBFS in the float render (live playback clips them at the output); those are scaled to
-1 dBFS before encoding (`gainDb` in the stats). A render more than 12 dB over, silent, or ending early fails. The seed
fixes the notes and `Math.random` is seeded too, but Tone's reverb impulses make renders differ slightly run to run: the
file is the record, its sha256 is in the index. `--index <file>` writes another index (trials). A
performance already in the index whose file is in `.local/score-audio` is skipped unless `--force`; renders run
performance by performance (every piece's second before any third) and the index keeps each piece's performances
contiguous from 0, so an interrupted run leaves a usable index. Publishing verifies and skips objects already in the
bucket. Commit the index with the
code once `--verify` passes; the files are inert until a build names them.

Proof of a local build: the bucket's CORS admits only the production origins, so serve the rendered files locally with
`node tools/score/serve-playlist-audio.mjs` and open the world with `?musicAudio=http://127.0.0.1:5213`.

Checks:

- `window.__edenMusic.state() / log() / level() / next() / trackSeconds(s)` in the browser (`state().fetched` lists the
  piece chunks fetched so far).
- `playlist.test.ts`: every piece registers once and composes its first cycles under an inert Tone, the optional modules
  load, the vendored copy matches its provenance, and the generated chunks match a fresh build.
- `gen-mesh/music-file.test.ts`: the file source's prefetch, fade, crossfade, end, resume at a position, volume ramps
  and the fallback signal, with fake media elements and gain nodes. `tools/score/render-playlist.test.mjs`: seeds, keys,
  the index text and the publish plan.
- `node vendor/sim-score/tools/lint.mjs <ids> --cycles 32 --seed 1` (also seeds 7 and 12345) over the playlist.
- `tools/sound/camera-restarts.mjs`: 60 s of camera drags, counting sound and music restarts.

## Other modules

- `station-connection.mjs` and `server-clock.mjs` follow a world's music station over the existing connection and
  estimate the server clock from ping/pong (used by `useSim.ts`). They open no sockets and start no audio.
- `runtime.mjs`, `composition.mjs`, `preview.mjs` and `MusicPreview.tsx` are an older development adapter: an earlier
  Sim Score revision (`PROVENANCE.json`) wrapped in a private namespace with Tone passed explicitly, a bounded 64-cycle
  composer (`createComposition`, `composeAt`) and a gesture-started local preview with mute, volume and disposal. The
  product does not mount them.
