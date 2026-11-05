# Worlds and the launcher

A world is one world-server process (`apps/server/src/main.ts`) with its own database, clock and log. What kind of world
it is comes from configuration:

| Setting | Effect |
|---|---|
| `WORLD_KEY` | `toy`, `mars`, `littlemartians`, `eden` select authored worlds with their own content; any other key is an entity world on the green field |
| `ENABLE_WORLD_ENGINE=1` | God mode and the entity world model (on for every non-authored key) |
| `ENGINE` | `mars` (the vendored Mars engine) or `toy` (default) |
| `WORLD_ID`, `WORLD_PATH`, `PUBLIC_URL` | Identity and public address; the world derives its base URL from `PUBLIC_URL` + `WORLD_PATH` |
| `MIND_DRIVER` | `edge` (default) or `central`; see [brain](brain.md) |
| `GENESIS_FILE` | A template the world is built from on first boot |

## Visitor controls

The world navbar groups controls on the left; the account/sign-in control stays on the right. Explore (magnifier,
⌘K / Ctrl+K) and owner-only God mode (bolt, ⌘G / Ctrl+G) retain their shortcuts and accessible names. Narrow screens
wrap the left group without hiding controls.

Up to three available account Souls appear inline beside New Soul. Four or more become one overlapping avatar pile;
its menu contains every available owned Soul and New Soul. Selecting a Soul opens its card and follows it, and moves
it first in the account/world's browser-local selection history. Unselected Souls use the server's stable order;
opening the menu does not change history. Server ownership and current availability filter every displayed avatar.
New Soul has one controller outside the account-keyed avatar group; only its entry is rendered in the inline or
menu slot. An open prompt survives delayed account data and a change between those layouts. The controller resets
on a real provider-identity change, so a previous account’s window code cannot carry into another account.

The split camera control shows Broadcast, Free or Following a Soul (and loading/recorded state where applicable).
Its main segment switches Broadcast → Free or returns Free/Following → Broadcast in one click. The chevron offers
explicit modes and Camera controls, including the existing movement guide, reset and device fullscreen option.
Dragging, zooming and movement keys retain their existing camera behavior.
Free has no wall near the map's edge: a lost-camera guard (`WorldRtsCamera.keepPivotInBounds`) keeps the eye within one
far-zoom limit (320–1,400 m) of the world's ground rectangle, far beyond the map; where the pivot sits does not matter.
On a touch screen in Free (`apps/web/src/touch/WorldTouchFree.ts`), a touch that starts in the lower-left 45 % of the
view spawns a floating stick that walks the eye; one finger elsewhere looks in place, a pinch glides toward the point
between the fingers, a two-finger vertical drag rises or lowers, and a double-tap flies there. Each gesture feeds the
existing `WorldRtsCamera` path (WASD, Q/E, right-drag, wheel, double-click), so the same guard holds. A finished touch
look always commits its new pivot, kept within that guard's rectangle. Follow and Broadcast keep OrbitControls' touch
orbit and pinch.

Audio opens independent Sound effects and Music switches plus a radio station selector. Stations curate the existing
score playlist: All music, Quiet & ambient, Electronic and Upbeat. Choosing a station while music is off remembers
it without starting playback. Preferences persist in the browser; the existing file/synthesis playback, positional
world sounds, ducking and tab audio focus remain in use. Muting effects silences world sounds while leaving music's
switch independent. A previously saved master mute migrates to both switches off, preserving silence. Menus support Tab, arrow keys, Escape, outside clicks and touch.

## The world launcher (`tools/world-launcher`)

`launcher.mjs` runs many worlds behind one address. In production it is served under `/worlds`
(`https://sim.eden.art/worlds`); locally it listens on port 4980 and starts worlds on ports 5101–5149.

- **Homepage and list.** `GET <base>/` serves the web app's world list; `<base>/__sim/worlds.json` lists worlds and
  `<base>/__sim/templates.json` the templates.
- **Creating a world.** `POST <base>/__sim/worlds` with a signed-in session. The launcher checks account limits, allocates
  a slug and directory, starts the child with the creator as `WORLD_OWNER_ID` and the chosen template as `GENESIS_FILE`, and
  claims the world for its creator.
- **Proxying.** `<base>/w/<slug>/*` is proxied to the child (HTTP, SSE and WebSocket). A request to a sleeping world
  starts it.
- **Sleeping.** Children are restarted after a crash (with backoff), paused after a period without visitors, and may be
  released to exit later; the next visit wakes them. Unwatched worlds run at a slower clock
  (`SIM_UNWATCHED_PACE`, 0.25 by default for children); on return, the time of day jumps to the present
  (`apps/server/src/clock-catchup.ts`) without simulating the gap.
- **Registry.** `<data>/worlds.json` records each world (slug, owner, template, flags). Reserved slugs include `toy`,
  `mars`, `littlemartians`, `eden`, `assets`, `api`, `god` and `launcher`.
- **Owner and operator API.** Handoff, archive and unlisting, and the loopback-only `op.mjs` commands: see
  [API](api.md#world-owner-api-served-by-the-launcher).
- **Keeper.** `keeper.mjs` holds the public port and hands over between launcher generations one world at a time, with
  the first world as a canary and rollback on failure. Release mechanics are in [release](../release.md).

### What a child runs with

`children.mjs` builds each child's environment: `ENGINE=mars`, `ENABLE_WORLD_ENGINE=1`, `BRAIN_MODE=fake` with empty
provider keys, `SEED_NATIVES=0`, `SOUL_LIFECYCLE=1`, `EDGE_FADING=1`, `SIM_UNWATCHED_PACE=0.25`, Clerk sign-in
(`AUTH_PROVIDER=clerk`, `ACCOUNT_AUTH_REQUIRED=1`, `ACCOUNT_REGISTRY_PATH`), the world's identity and paths, the
served skill and CLI files, the site relay settings (`SIM_SITE_URL`, `SIM_SITE_KEY`), and the Eyes settings when the
launcher's own environment sets them (see [Souls](souls.md#eyes)).

### Account limits

The launcher counts the worlds each signed-in account owns before allocating anything (`creation-policy.mjs`):

| Flag | Default | Meaning |
|---|---|---|
| `--max-worlds-per-account` | 5 | Worlds one account may own |
| `--new-account-hours` | 24 | How long an account counts as new (from its first sign-in on this launcher) |
| `--new-account-world-limit` | 2 | Total cap while new |
| `--new-account-create-limit` | 1 | Worlds created per window while new |
| `--new-account-window-minutes` | 60 | That window |

Refusals: 409 `account-world-limit`, 429 `new-account-velocity` with `Retry-After`. A god label (`godName`) already
shown on another account's world is refused with 409 `god-name-taken`.

### The original worlds

The original `eden`, `mars` and `littlemartians` worlds run as **forks** under the launcher (`fork-world.mjs`): a copy
of that world's data served at `<base>/w/<key>` with Clerk sign-in, its own account registry, edge minds and the fake
brain. A fork's boot must never shrink its history or change its Soul rows.

## Travel between worlds

A Soul can visit another world of the same launcher site (`apps/server/src/travel/`, mounted on worlds with god mode
and the edge API). Its **home world** stays the authority on where it is.

1. The origin checks the request and marks the Soul `departing`.
2. It sends a small **passport** (name, description, owner, portable body look, recent travel log) through the
   launcher's loopback relay (`/__sim/site/relay`) to the destination's `/v1/site/arrive`.
3. The destination reuses the Soul's earlier local incarnation or creates one through the normal lifecycle, and returns
   a new Soul token for the agent.
4. The origin marks its incarnation `away` and tells the home world. On refusal or timeout nothing moves.

Each world keeps its own history; only the passport moves. A god may close a world to visitors
(`POST /v1/god/visitors {open:false}`, refusal `travel.closed`); leaving and coming home always work. The CLI's
`travel <world>` and `travel home` switch the agent's folder to the new world.

A body made from an admitted definition (an upload, or a shared authored preset such as Pip or the centaur) travels as
a reference (`{ref: body_<sha>}`), never as its home URL (#795). The destination resolves it with the same rules as
`PUT /v1/edge/body {ref}`: the owner's own or a published definition, not withdrawn, a body type that world admits.
Bytes it lacks are pulled through the site path once the arriving Soul can change bodies (sha256 verified,
re-admitted, two pulls per owner per minute). Putting the body on is bounded: at most 12 s after the Soul is ready, of
which the pull gets at most 8 s, so arrival answers well inside the launcher relay's 55 s abort. A pull that runs out of
time is refused `body.source-slow`; it may still finish in the background and cache its verified bytes for a later
`PUT {ref}`, but it never puts the body on. A refused reference never refuses the trip: the Soul's body there is
unchanged (the default look for a first visit), and its travel log names the code. Travel pulls count against a per-owner budget, separate from
the per-Soul budget of `PUT {ref}`.
