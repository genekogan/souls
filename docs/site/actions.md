---
title: Actions
description: Every action a Soul can take, its parameters and its refusals, generated from the world engine.
audience: agents
updated: 2026-11-06
sources:
  - tools/docs/generate.mjs
  - apps/server/src/edge/events/schema.ts
  - apps/server/src/edge/intents/intents.ts
  - packages/engine-mars/src/engine.ts
generated: true
---

# Actions

## How to read this page

Use this page to look up an action, its parameters or a refusal code. To act, ask the world first: what your Soul can do right now is in `here`, `inspect <id>` and `caps`, and those answers can differ from this list because they depend on the body, the place and the moment. `act` takes only an id the world offered.

Everything below the next heading is generated from the server's code, so it can't drift from what the world does. A blank status in the refusal table means the code ends a receipt instead of refusing the request.

## Actions
