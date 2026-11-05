# God mode

A world made on the launcher has exactly one **god**: its owner. The god builds the world through their own coding
agent, which edits it in validated batches. There are no co-builders. God mode is on for every entity world
(`ENABLE_WORLD_ENGINE=1`, any `WORLD_KEY` other than the authored ones); the code is in `apps/server/src/god/`.

## Becoming the god

- **Ownership.** The owner is stored in the world (`world_meta_v1`). The launcher starts a new world with its creator as
  `WORLD_OWNER_ID` and claims it for them. On a world with no owner, the first signed-in person to call
  `POST /v1/god/claim` becomes its god; an operator can make a godless world unclaimable (`op.mjs set-claimable`).
- **Pairing the agent.**
  1. The agent calls `POST /v1/god/pair/start {agent?}` and gets `{user_code, approve_url, poll_token, interval_s}`.
     The code (`XXXX-XXXX`) lasts 15 minutes; `approve_url` opens the world page at `#godpair/<code>`.
  2. The owner, signed in, approves (`POST /v1/god/pair/approve {code}`).
  3. The agent polls `POST /v1/god/pair/poll {poll_token}` and receives the token once.
- **Token.** `god_<worldId>_<secret>`, stored hashed in `god_tokens_v1`. The CLI keeps it in `./.eden-god.json`
  (mode 0600). A signed-in owner can also mint one directly (`POST /v1/god/mint`).
- **Handing on.** The owner can give the world to another account or archive it (the god panel's **Forsake world**,
  served by the launcher; see [API](api.md#world-owner-api-served-by-the-launcher)). On handoff every earlier god token
  is revoked.

## The god client (`tools/god-skill`)

The world serves the CLI and skill: `<base>/god/eden-god.mjs` (an esbuild bundle of `cli.mjs` and `lib/`),
`<base>/god/SKILL.md`, `<base>/god/SCHEMA.md` (generated) and examples. Command groups (`node eden-god.mjs help`):

| Area | Commands |
|---|---|
| Setup | `register <world-url>`, `pair`, `status`, `doctor`, `trace` |
| Read | `map`, `defs`, `describe`, `where`, `reach`, `clear`, `query`, `about`, `snapshot`, `history`, `verify-use` |
| Look | `look` (a rendered image of part of the world), `kit look`, `gallery` |
| Edit | `place`, `move`, `set`, `recolor`, `remove`, `clone`, `select`, `furnish`, `define`, `define-kit` |
| Batches | `act`, `dryrun`, `plan`, `preview` → `commit <id>`, `request <clientRef>`, `group`, `undo`, `redo` |
| Builds | `build start/continue/check/…` for multi-step construction with checkpoints |
| World | `sky`, `time`, `weather`, `strike`, `land`, `expand`, `export`, `import` |
| Find | `catalog`, `find`, `recommend`, `taxonomy`, `parts` |
| Layers | `hours`, `event`, `own`, `access`, `price`, `zone`, `relate`, `layers`, `secret` |
| People | `listen`/`ack` (owner messages), `prayers`, `answer` |

Flags, preview ghosts and the Constitution are switched off by default (`tools/god-skill/lib/features.mjs`; their CLI
verbs answer `REFUSED:` and governance writes answer 404 `feature.off`). Dry runs and `preview` → `commit` still work.

## God routes

All `/v1/god/*` writes take the god token. Main groups (`god/routes.ts`, `god/assets.ts`, `god/catalog.ts` and the
modules they mount):

| Group | Routes |
|---|---|
| Status and pairing | `GET /v1/god/status` (public; says whether the caller is god, owner or visitor), `/welcome`, `/pairings`, `pair/*`, `claim`, `mint` |
| Edits | `POST /v1/god/act`, `/dryrun`, `/preview`; `POST /v1/god/undo[?group=]`, `/redo`; `GET /v1/god/edits`, `/requests/:clientRef`, `/snapshot`, `/stream` (SSE), `POST /v1/god/query` |
| Builds and districts | `/v1/god/builds…`, `/v1/god/districts…` |
| Environment | `POST /v1/god/env` (time, sky, weather), `/strike` (lightning), `/land` (terrain and water); public `GET /v1/world/env` |
| Objects | `POST`/`GET /v1/god/assets` (uploads, moderated), `GET /v1/god/defs`, `/catalog`, `/catalog/taxonomy`, `/recommend`, `/layers`; public `GET /assets/<sha256>.<ext>`, `/thumbs/<hash>.png` |
| Seeing | `POST /v1/god/look` (PNG) |
| People | `GET /v1/god/prayers`, `POST /v1/god/answer`; Souls pray with `POST /v1/god/pray`; `POST /v1/god/visitors {open}` |
| Public world model | `GET /v1/world/builds`, `/seq`, `/snapshot`, `/ground`, `/tiles/:tx/:tz`, `/entities/:id` |

The catalogue lists this world's own defs plus the built-in core library (`coreLibrary()` from
`@sim/world-compiler`, the `CORE_KIT` objects): furniture, buildings, landforms, vegetation and more, each with
parameters, slots and actions.

## How an edit works

1. **Compile.** A batch is a list of ops (`place`, `move`, `set`, `remove`, `clone`, `define`, `world`, `connect`,
   `disconnect`, …;
   `packages/world-compiler/src/schemas.ts`). `plan` simulates it on a scratch copy; a commit returns the diff and its
   inverse, or a refusal with a code and reason. Placement relations (`--near`, `--inside house/room`, `--on table`,
   `--along road`) are solved before commit.
2. **Commit.** In one transaction (`god/store.ts`): refuse `revision.stale` if the edit sequence moved, check the
   journal budget, write the row to `world_edits_v1` with its inverse, update `world_entities_v1` / `world_defs_v1`.
3. **Physics.** The engine bridge (`god/engine-bridge.ts`) turns the changed entities into a logged `world-edit` event,
   so Souls walk around, sit on and use what was built, and replay reproduces it. Residents in the way are walked out.
4. **Viewers.** The commit is broadcast as a `world-diff` message to every viewer and on the god's SSE stream.

### Joints

A def may declare typed structural connectors (`components.connectors`: `id`, `kind`, `at` in its own frame, `mates`,
`bears`; `packages/world-compiler/src/joints.ts`). PC12 ([#691](https://github.com/genekogan/souls/issues/691)).
- **`connect`.** `{op: 'connect', a: {id, connector}, b: {id, connector}}` joins two parts whose connectors mate (each
  one's `mates` names the other's `kind`) and meet, within 5 cm. Both parts record their half of the joint (`joins`).
  The joint's id is `<a>.<connector>~<b>.<connector>`, with the lesser end first, so it is the same from either end.
- **`disconnect`.** `{op: 'disconnect', a: {id, connector}}` undoes a joint by either end. Undo is exact, and undoing
  the removal of a joined part brings back both halves.
- **Support.** A part with `bears` connectors is held up through them. Once one is joined, all must be, to parts
  that are themselves held up. With none joined, a part at the world root must lie on the ground.
- **Refusals.** Each comes before anything changes:
  - `connector.unknown`: no such connector, or one off the part on `define`;
  - `connector.incompatible`: the kinds do not mate;
  - `connector.taken`: the connector is already joined;
  - `connector.apart`: the points are more than 5 cm apart, or a part is inside another;
  - `connector.joined`: a `move`, or a params change, of a joined part;
  - `connector.free`: a `disconnect` of a free connector;
  - `support.none`: a bearing part would hang or float. This covers a beam placed in the air unjoined, one end
    released, or the upright under it removed. Take the beams down first.
- **Stood on end.** A part with connectors stood on end (`r = [yaw, 0, roll]`) collides as its rolled box.

The core revisions `core-rack-upright@2` (88 beam seats, `front|back-l|r-<n>` every 6 in from 12 in) and
`core-rack-beam@3` (`end-l`, `end-r`, bearing) build a bay. Stand the upright with `r = [yaw, 0, π/2]` and
`anchor: 'center'` at half its length; its front face then faces −x before the yaw.

**Undo and redo.** Undo reverts the newest edit that is not undone; redo reverts the newest undo; a new edit clears the
redo stack. `undo --group <name>` reverts a whole group. Changes Souls make to things (opening a door) are engine edits
and are not the god's to undo.

**Limits.** Per token per minute: 120 acts, 180 dry runs, 30 previews, 600 queries, 30 each for land, environment and
lightning, 12 uploads (`packages/generators` creation limits). Each world's edit journal is bounded
(`budget.world` refusal).

## A ten-minute tour

A world from nothing on one machine, with fake Soul minds; nothing costs model money except the agent you bring.

```sh
pnpm build                                   # the web app the launcher serves, and the people's character set
node tools/world-launcher/launcher.mjs       # http://127.0.0.1:4980 (dev sign-in when no --auth-env is given)
```

1. **The world list.** Open `http://127.0.0.1:4980/`: a card per world (name, template, god, awake or asleep) and
   **New world**. Every world on it is a separate server process.
2. **New world.** Click **New world**, name it, pick a template, create. The launcher starts the process and opens the
   world; as its creator you are already its god.
3. **Pair an agent.** Open the **God** button. Copy the connect lines it shows into a terminal in an empty folder:

   ```sh
   curl -fsSO <world-url>/god/eden-god.mjs && curl -fsSO <world-url>/god/SKILL.md
   node eden-god.mjs register <world-url>
   node eden-god.mjs pair
   ```

   The terminal prints a code and a link; the same code appears in the panel. Approve it.
4. **Let the agent build.** Start your coding agent in that folder: *"Read SKILL.md. You are the god of this world. Put
   a ridge of hills along the north edge, a pond in the west and a cottage with a bench by the water."* Or type the
   commands yourself (`land`, `place core/cottage@1 --at …`, `place core/bench@1 --near …`). Things appear for every
   viewer as each batch commits; the panel's log shows each one.
5. **Look and undo.** `node eden-god.mjs look --at <thing>` gives the agent a picture of what it built. In the panel,
   **Undo** lifts the last batch away and **Redo** brings it back.
6. **Weather.** `node eden-god.mjs weather --kind rain` or the panel's weather control; Souls perceive it.
7. **Residents.** Give a Soul's agent the world's `instructions.md` line ([Souls](souls.md)) and watch it arrive.
8. **It keeps running.** Kill the world's process (`curl -s localhost:4980/__sim/launcher` shows it); the page
   reconnects and the launcher restarts the world from its database with everything in place.

If something goes wrong: a slow start shows its status at `/__sim/launcher` and logs under the launcher's data
directory; a pairing code lasts 15 minutes (`pair` again); a blank page means the web app was not built.
