# First-party music source

Sim Score is authored procedural music, maintained in this repository. `source/` owns its engine, pieces,
catalog, optional browser composition/player UI and Node lint/score tools. The source and original UI are retained
without changes from the imported revision; there are no audio samples or rendered media here.

`source/PROVENANCE.json` records the historical import from Sim Score commit
`7cb0b2b02ea0b2d4ba9e43484af8e2bd0e81e0f4`. Its hashes describe that intake, rather than a requirement to edit
another checkout. New first-party changes belong here and must update the generated playlist and focused tests.
Do not overwrite owned changes by syncing an external checkout.

## Compatibility boundary

`vendor/sim-score` is a relative compatibility symlink to `packages/music/source`, not a second source copy.
The existing playlist generator and tools can retain their paths during the coordinated performance migration.
The game consumes generated `apps/web/src/score/playlist/` modules: the engine factory takes Tone explicitly, pieces
register lazily, and importing the playlist starts no sound. Do not import the optional studio into the game or
add it to the root development or deployment commands.

## Optional local composition app

Run from the repository root, only when wanted:

```sh
python3 packages/music/source/tools/serve.py 4802
```

Open `http://127.0.0.1:4802/`. The existing page uses Tone 15.1.22 from cdnjs, loads procedural pieces and starts
playback through its controls. `dev.html` and `render.html` are existing explicit development tools; they are not
part of normal startup. The server binds only to localhost. Its explicit save endpoint can write local render
outputs and invoke ffmpeg; starting the server or loading the ordinary composer page does not render or publish.
Rendered output stays ignored and outside git.

For inert composition checks, `node packages/music/source/tools/lint.mjs <ids> --cycles 32 --seed 7` does not produce
audio. The archived render/stage utilities and their limitations are documented in [history](history/README.md).

Sim Score is © Gene Kogan under the MIT License; see root `LICENSE` and `NOTICE`. Tone and other dependencies keep
their own licences. Historical source titles, namespaces and authorship are preserved.
