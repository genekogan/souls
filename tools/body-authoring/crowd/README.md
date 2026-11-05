# Body crowd comparison

Run the real `HumanViews` and `FloaterView` with twenty sampled bodies, a fixed 1280×720 camera, and the same lighting. This isolates renderer costs; it does not simulate a world or qualify gameplay, shadows, mobile performance, or GPU frame times.

Prerequisites: normal workspace dependencies, the web media overlay, all thirteen canonical Little Martians character GLBs, and a Playwright Chromium cache. Resolve media through the normal asset setup; no generated proof or media belongs in git.

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/.e2e/browsers" node tools/body-authoring/crowd/run.mjs
```

By default this records resource counts and an uncut browser clip, without claiming wall-clock performance. Output goes to `.local/body-crowd/`. `CROWD_OUT`, `CROWD_MEDIA` (default `.lane/mars-web`), and `CROWD_MARTIANS` (default `worlds/littlemartians/characters`) select isolated local inputs and output. The runner owns its Vite server and browser and closes both on success or failure.

The five arms are absent, current CC0 humanoids, canonical Martians with original textures (`?tex=full`), Martians with the normal web texture budget, and Pip. Each arm gets a fresh browser context, with two repeats in opposite order. Nearby idle, nearby dance and distant cases use the same downloaded assets. The resource-entry lists must remain identical across those mode changes. Shared geometry/material/texture costs are deduplicated; triangle and draw counts describe the actual scene submission. Texture bytes estimate RGBA8 storage from decoded image dimensions, excluding mipmaps and driver overhead; they are not measured GPU allocation. Geometry bytes count vertex/index buffers. Cached templates can retain resources after actors leave the scene. Distant cases report actual submissions and 24-frame humanoid pose counts; distance does not imply zero draws, even when pose updates are decimated.

For quiet-host CPU/frame measurements, explicitly add `--timings`. This requires at least 70% CPU idle and normalized load no more than 0.75 before each arm. Busy hosts leave timings pending; contention detected at a later arm admission fails the incomplete timing run. This sampling does not certify continuous host quiet. Timings separate body-update CPU, render submission CPU, and animation-frame intervals, and include JS heap where available. They do not use GPU timer queries or establish a phone budget. The video runs after measurements to avoid encoder contention. Structural counts remain usable under host contention.

The page also exposes the cases and measurement button for a manual walk. Scripted interactions use those controls; the read-only probe supplies evidence. Defaults use the normal split humanoid mesh and clip pipeline, all thirteen Martian scans cycle across the twenty bodies, and Pip uses its canonical authoring generator. No source model or original texture is rewritten.
