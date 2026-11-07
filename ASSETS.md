# Assets

The code in this repository is MIT-licensed ([LICENSE](LICENSE)). **Art, 3D models, textures, audio, video and other
media are not in this repository and are not covered by the MIT licence.** They are served from
`https://assets.eden.art` under immutable, content-addressed keys. `pnpm assets:pull` downloads the ones a checkout
needs, checking each file's SHA-256 against `tools/assets/manifest.json`. The CDN is a transport: it grants no licence.
Rights stay with their holders, as listed below.

## Third-party assets (CC0)

These are public domain (CC0 1.0). No attribution is required; we credit them with thanks.

- **Kenney** (kenney.nl): Nature, Food, Furniture, Watercraft, City, Fantasy Town and other kits
- **Quaternius** (quaternius.com): Ultimate Nature, Crops, Food, Animated Animals and House Interior; Ultimate
  Modular Men and Ultimate Modular Women; Universal Animation Library 1 and 2; animated people
- **Drummyfish** (opengameart.org): props used for reference renders
- **freesound.org** ambient recordings:
  - *Birds In Spring (Scotland)* by BurghRecords (#463903)
  - *Night Crickets Back Porch* by hdfreema (#333221)
  - *water medium gentle lake waves* by kyles (#451630)
  - *wind in the grass small town* by strangy (#176252)
  - *geroezemoes (murmur)* by gecop (#640254)

## Third-party assets (attribution required)

- **"Retro Computer & Monitor"** by JasperTobias
  (<https://sketchfab.com/3d-models/retro-computer-monitor-8926293078874194b551e74c40a3debf>), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Used unchanged; the renderer replaces the screen region
  at runtime.

## Project assets (all rights reserved)

- **Little Martians**, by Vanessa Rosa (Little Martians): the characters, ceramic scans and buildings, and the world's
  character names, descriptions and lore, including that text in `worlds/littlemartians/` and the Little Martians
  templates, are © Vanessa Rosa. They are used in Souls with permission and are **not** covered by this repository's
  licence or available for reuse.
- **Mars College**: campus models and campus geometry data (including `mars/viewer/public/engine/campus-*.json` and
  the campus catalogues) are © Mars College. They are used with permission and are **not** covered by this
  repository's licence or available for reuse.

## Our own media

PWA icons, procedural loops, diagrams and the few small test fixtures kept in git are our own work under the MIT
licence. Renders, screenshots and test baselines served from the CDN are our own work too.

## Code notices

- **Sim Score** (`packages/music/source/`, `apps/web/src/score/`), the generative soundtrack, is © Gene Kogan under the
  MIT licence, like the rest of the code.
- `mars/viewer/simulation/env.d.ts` contains generated type declarations © Cloudflare, Inc. and © Microsoft
  Corporation, licensed under the Apache License 2.0 (header kept in the file).
- npm dependencies are installed from the registry under their own licences (`pnpm licenses list`).

## Adding an asset

Publish it to the CDN first with its licence evidence ([docs/operations/cdn.md](docs/operations/cdn.md)), add it to
the asset manifest (`tools/assets/README.md`), and add a credit here if its licence asks for one or it is third-party.
Only CC0, CC BY or our own work can be added; anything else needs the maintainer.
