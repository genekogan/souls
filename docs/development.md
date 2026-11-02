# Development

## Requirements

- Node ≥ 22.18. The server runs TypeScript directly by type stripping, so code must be erasable: no `enum`, no
  parameter properties, no namespaces. It uses `node:sqlite`.
- pnpm 10 (the version is pinned in `package.json`).

## First run

```sh
pnpm install --frozen-lockfile
pnpm assets:pull                      # media from assets.eden.art; pnpm assets:check verifies without network
cp .env.example .env
pnpm build
BRAIN_MODE=fake DEV_AUTH=1 DATA_DIR=.local/dev node --env-file=.env apps/server/src/main.ts
```

Open <http://localhost:4500/w/toy/?dev=1>: a world is served under `WORLD_PATH` (`/w/<key>`), and the root `/` is the
multi-world homepage, which lists only a launcher's worlds. With `DEV_AUTH=1` the page offers a dev sign-in; the name
`admin` is an admin. `.env.example` sets `INVITE_REQUIRED=1`, so creating a Soul (**New Soul**, `POST /v1/souls`)
answers `invite-required` for any other name until you use `admin` or set `INVITE_REQUIRED=0`. Variables given on the
command line win over `.env`; to use another port set both `PORT` and `PUBLIC_URL`, since `.env.example` pins
`PUBLIC_URL` to :4500.

`pnpm build` builds the web app (`apps/web/dist`) and then the Mars viewer's static site, `mars/viewer/dist/client`
(`MARS_WEB_DIR`), which holds the humanoid kit and the character models and animations the server serves under
`/modular`. The viewer step (`pnpm build:viewer`, `tools/assets/mars-web.mjs`) is skipped when nothing under
`mars/viewer` changed since the last build (a stamp of input paths, sizes and times), so it costs well under a second
when the site is current. `pnpm dev` runs it too. The server mounts the site only if it exists when it starts and
warns at startup when the character set is missing: without it every world shows "The world could not be prepared:
Person … could not be prepared" and draws no people. If you build it while the server runs, restart the server.
`pnpm --filter mars-campus-viewer build` is the same static build; the standalone Mars site's Cloudflare worker is
`build:cloudflare`, which needs a release staged by `mars/viewer/deploy/prepare.py`.

For front-end work, `pnpm dev` runs the server with `--watch` and Vite on :5173; open
<http://localhost:5173/w/toy/?dev=1>. Vite proxies the server's routes to it: everything under a world's path except
the page itself, and at the root `/v1`, `/ws`, `/__sim`, `/skill.md`, `/cards.md`, `/mcp`, `/healthz` and the Mars web
assets (`/modular`, `/mars-assets`, `/engine`, …). The proxy follows `PORT` (default 4500) when it is set in the
environment; `WEB_PORT` moves Vite, for example `PORT=4600 PUBLIC_URL=http://localhost:4600 WEB_PORT=5200 pnpm dev`.

`pnpm dev` warns, and `pnpm test` and the web build stop, when the media they need is not in place. Media is listed by
repository path in `tools/assets/manifest.json`; see `tools/assets/README.md` and [the CDN](operations/cdn.md).

**Always run locally with `BRAIN_MODE=fake`** unless the task is testing the models. Any other value means live: a
live server spends real money around the clock. Souls are driven by their owners' agents (`MIND_DRIVER=edge`, the
default), so most work needs no model at all.

## Environment variables

Read in `apps/server/src/config.ts` (and `thinking-budget.ts`, `auth.ts`). `.env.example` is the template.

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `4500`, `127.0.0.1` | Listen address |
| `DATA_DIR` | `./data` | SQLite file and its on-host backups. Use a separate ignored directory per process |
| `PUBLIC_URL` | `http://localhost:$PORT` | Fallback base URL; requests use their own host |
| `WORLD_KEY` | `toy` | `toy`, `mars`, `littlemartians` or `eden` load authored content; any other key is an entity world |
| `WORLD_ID`, `WORLD_PATH` | `<key>-1` (`toy-1`), `/w/<key>` | History id and URL prefix |
| `WORLD_OWNER_ID` | `dev:admin` with `DEV_AUTH=1`, else none | The world's god |
| `ENGINE` | `toy` | `mars` runs the vendored engine through its adapter; anything else is the toy engine |
| `ENABLE_LIVING_WORLD` | off | `1` enables the persistent world day for non-toy worlds |
| `ENABLE_WORLD_ENGINE` | off (on for entity worlds) | Entity-world engine for known keys |
| `MIND_DRIVER` | `edge` | `edge`: owners' agents choose Souls' actions; `central` is the legacy in-world brain |
| `AUTH_PROVIDER` | `privy` in code, `none` in `.env.example` | `clerk` for real sign-in, `none` for local work |
| `ACCOUNT_AUTH_REQUIRED` | off | `1` requires a signed-in account to create Souls and worlds |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_ISSUER_URL`, `CLERK_AUTHORIZED_PARTIES` | none | Clerk sign-in ([auth](operations/auth.md)) |
| `ACCOUNT_REGISTRY_PATH` | none | Identity-only SQLite registry shared by every world on a host |
| `ADMIN_EMAILS` | none | Comma-separated admin emails |
| `DEV_AUTH` | off | `1` accepts `Bearer dev:<name>`. Never in production |
| `INVITE_REQUIRED` | on | `0` lets any signed-in user create Souls |
| `MAX_SOULS_PER_USER` | `20` | Soul bodies per account in one world |
| `SEED_NATIVES` | on | Seed a new world's defined cast |
| `WORLD_SEED` | `sim-genesis-1` | Genesis RNG seed |
| `SNAPSHOT_EVERY_TICKS` | `6000` | Snapshot interval (5 minutes at clock rate 1) |
| `BRAIN_MODE` | live | `fake`: no model calls. Any other value is live |
| `BRAIN_BUDGET_USD_PER_DAY` | `0.5` | Per-world rolling 24 h model budget, clamped to the ceiling ($1) |
| `TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY` | none | Model providers; without a key that tier is fake or off |
| `NARRATOR_MODEL`, `COMPILER_MODEL`, `TALK_MODEL` | `claude-haiku-4-5-20251001` | Models per role; the latter two default to the narrator |
| `EDGE_SKILL_FILE`, `EDGE_INSTRUCTIONS_FILE`, `EDGE_CLI_FILE`, `EDGE_CONTROLLER_CLI_FILE` | built-in | Override the Soul skill, instructions and CLI the world serves |
| `EDGE_EYES` | unset (off) | `world` renders Soul views in a headless browser ([Souls](architecture/souls.md#eyes)) |
| `TAKES_PERSIST`, `ARCHIVE_TAKES` | off | Persist recorded takes; archive them to R2 (`R2_*`) |
| `WEB_DIR`, `MARS_WEB_DIR`, `BUILD_ID` | built app dirs, `BUILD` file or `dev` | Static assets and the reported build |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | none | Legacy sign-in, kept only for rollback |

## Running other worlds

The vendored engine lives in `mars/viewer/engine`; nothing outside the repository is needed. A world on that engine:

```sh
WORLD_KEY=mars ENGINE=mars ENABLE_LIVING_WORLD=1 BRAIN_MODE=fake DEV_AUTH=1 DATA_DIR=.local/mars \
  node --env-file=.env apps/server/src/main.ts
```

Use `WORLD_KEY=littlemartians` or `eden` for the other authored worlds. Use one `DATA_DIR` per world and engine: a
snapshot is bound to its engine's rules version. The engine's viewer assets come from the same
`pnpm build` (or `pnpm build:viewer`) as the first run (served from `MARS_WEB_DIR`, default
`mars/viewer/dist/client`).

Many worlds on one origin, as in production, run under the world launcher:

```sh
node tools/world-launcher/launcher.mjs --port 4980 --data .local/launcher
```

It keeps a registry of worlds, runs one server per world on a private port and fronts them all, with the homepage,
`POST /__sim/worlds` to create a world and `/__sim/healthz`. Its children are fake-minded and accept dev names. They
take ports from `--range` (default `5101-5149`), which must not include `--port`. A world you create with
`curl -X POST -H 'authorization: Bearer dev:<name>' -H 'content-type: application/json'
-d '{"name":"My world","template":"hello-hamlet"}' localhost:4980/__sim/worlds` is claimed by `<name>` as its god;
`GET /__sim/worlds.json` lists the worlds and templates. See [worlds](architecture/worlds.md). For the local edge
worlds behind a loopback proxy, see `tools/core/multiworld/README.md`.

## Layout

| Package | What |
|---|---|
| `packages/kernel` | Meaning: things, links, the changes, the coherence rule, cards, base vocabulary |
| `packages/engine-contract` | The engine interface, scaffold runtime, hashing, RNG, kinematics, conformance helpers |
| `packages/engine-toy`, `engine-mars`, `engine-native` | The toy engine, the adapter for the vendored engine, native engine lifecycle |
| `packages/brain` | Request builders and interpreters for every model call |
| `packages/protocol` | Everything that crosses a process boundary |
| `packages/client` | The replica and connection, for browsers and Node |
| `packages/world-compiler`, `generators`, `ground`, `library` | World authoring, procedural generators, terrain, the core kit |
| `packages/conformance` | Library conformance sweep and its pins |
| `apps/server`, `apps/web` | The server process and the web app |

## Conventions

- Anything that crosses a process boundary is defined in `packages/protocol`.
- Engine and kernel code is deterministic: no `Date.now`, no `Math.random`; randomness comes from the world RNG. The
  toy engine and the shared kinematics use no transcendental `Math.*` in positions, because clients recompute them.
- Kernel code is total: a change applies or is refused with a reason. New thing ids come from the kernel state.
- Model output reaches the engine or the kernel only as a logged event. Meaning changes only through logged events.
- Local runs, tests and tools write under ignored paths (`.local/`, `.e2e/`), never into tracked folders.

## TypeScript toolchain

`pnpm typecheck` uses native TypeScript 7 (`@typescript/native`, aliased to `typescript`). The separate
`typescript` import resolves to the official TypeScript 6 compatibility package so test loaders can continue using
`transpileModule`; its optional CLI is `tsc6`. Keep both aliases together when updating the compiler. Node declarations
stay on the Node 22 line to match the minimum supported runtime and CI; a declaration-major bump requires a runtime
migration review.
