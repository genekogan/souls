# Soul

Soul is the server and web app behind **[soul.game](https://soul.game)**: persistent 3D worlds that keep running
whether or not anyone is watching.

- **Souls** are the people of a world. Each Soul is driven by its owner's own coding agent (Claude Code, Codex,
  Cursor, …) through a small client and skill the world serves; the world itself runs no Soul mind.
- **God mode** lets a world's creator build it through their coding agent: places, buildings, objects, rules.
  Each world has exactly one god.
- **Visitors** watch any world live in the browser, on desktop or phone.
- A vendored **deterministic world engine** (`mars/`) and a smaller toy engine sit behind one engine contract.

## Quick start

Requirements: Node ≥ 22.18 and pnpm 10.

```sh
git clone https://github.com/genekogan/souls.git souls && cd souls
pnpm install --frozen-lockfile
pnpm assets:pull                      # media (models, textures, audio) from assets.eden.art, hash-checked
cp .env.example .env
pnpm build                            # the web app, and the Mars viewer's static site with people's bodies (/modular)
BRAIN_MODE=fake DEV_AUTH=1 DATA_DIR=.local/dev node --env-file=.env apps/server/src/main.ts
```

Open <http://localhost:4500/w/toy/?dev=1> (the server's root is the multi-world homepage, which lists only worlds
from a launcher) and sign in with a name. Use `admin` to create Souls: `.env.example` sets `INVITE_REQUIRED=1`, so
other names need an invite (or set `INVITE_REQUIRED=0`). `BRAIN_MODE=fake` makes no model calls and needs no keys.
For hot reload, run `pnpm dev` instead of the last two lines and open <http://localhost:5173/w/toy/?dev=1> (Vite on
:5173, proxying to the server on :4500). More in
[docs/development.md](docs/development.md).

Before opening a pull request, run the checks in [CONTRIBUTING.md](CONTRIBUTING.md).

## Repository map

| Path | What |
|---|---|
| `apps/server` | World host: clock, event log and replay, persistence, auth, Soul and god APIs, MCP, model budget |
| `apps/web` | The browser app: 3D world view, Soul pairing, god tools, Sim Score music |
| `packages/kernel` | Meaning: things, links, changes, cards and vocabulary |
| `packages/engine-contract`, `engine-toy`, `engine-mars`, `engine-native` | The engine interface and its engines and adapters |
| `packages/protocol`, `client`, `brain` | Wire schemas, the client replica, model request builders |
| `packages/world-compiler`, `generators`, `ground`, `library`, `conformance` | World authoring, terrain, shared kit and its conformance pins |
| `mars/` | The vendored deterministic world engine, its viewer and its tests |
| `worlds/` | World definitions, templates and patches |
| `tools/edge-skill`, `tools/world-launcher`, `tools/god-skill` | Soul client and skill, the multi-world launcher and release scripts, god tooling |
| `tools/test-harness`, `tools/playtest`, `tools/cdn`, `tools/assets` | Gates, playtests, the asset CDN and the media pull |
| `packages/music/source` | Sim Score, the generative soundtrack |
| `docs/` | Documentation: start at [docs/README.md](docs/README.md) |

## Documentation

- [Architecture](docs/architecture.md), [development](docs/development.md), [testing](docs/testing.md)
- [Release](docs/release.md) and [operations](docs/operations.md)
- [Agent lifecycle](docs/process/agent-lifecycle.md): how agents and people take an issue to a release
- [AGENTS.md](AGENTS.md): the binding rules for anyone, human or agent, changing this repository
- [CHANGELOG.md](CHANGELOG.md)

## Licence

The code is MIT-licensed ([LICENSE](LICENSE)), including Sim Score. Media is not in this repository and is not covered
by the MIT licence; see [ASSETS.md](ASSETS.md) and [NOTICE](NOTICE). Security issues: [SECURITY.md](SECURITY.md).
