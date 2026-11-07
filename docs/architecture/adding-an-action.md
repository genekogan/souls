# Adding a Soul action

How to add something a Soul can do, in the form a Soul's agent can use. Read [Soul Actions](soul-actions.md) for what
exists. Since strict offers (#1093), layered perception (#1094), same-intent alternatives (#1095) and the schema-first
skill (#1099), an action is usable only if it ships an offer id, a parameter schema, its refusal codes and its
alternatives. English words are only advisory `resolve` vocabulary.

## The four shapes

Every action is one of these, cheapest first. Pick the cheapest that works.

| Shape | What it is | Example | Usual tier |
|---|---|---|---|
| **(a)** a new def on an existing faculty | a def, a conformance supplement, an offer schema | the guestbook on the sign-up faculty (#429) | T3 |
| **(b)** a new verb on existing custody or support | pour, hang, wrap | | T3 |
| **(c)** a new faculty | a state machine, offers with schemas, a perception line, persistence | checkers (#439) | T3 |
| **(d)** a new Support kind or engine action | rare; needs Gene | a real throw (#1092) | T4 |

Take the tier from `node tools/proof/tier.mjs`, not from this table.

## What an offer looks like

This is `inspect <thing>` on a real fake-mind world (`hello-hamlet`, `eden` 2.14.0). `inspect` takes a thing's id, not an
offer id, and returns its offers. One offer from that answer:

```json
{
 "id": "sit:lab-presentation-hall/part-presenter-seat",
 "verb": "sit",
 "label": "Sit at Presenter’s Chair [lab-presentation-hall/part-presenter-seat]",
 "available": true,
 "params": {
  "seconds": { "type": "integer", "min": 1, "max": 600, "default": 600 },
  "with": {
   "type": "array",
   "optional": true,
   "items": "Soul id or name",
   "maxItems": 6,
   "description": "invite them; each chooses"
  }
 }
}
```

The same shape appears in `here.doHere` and `caps`. A new offer needs:

- **An id:** `<verb>:<target>`, stable for the same thing.
- **A schema for each parameter:** type, bounds, `optional` or a `default`, and a `description` when the name isn't enough.
  A parameter nobody can fill from the schema alone isn't finished.
- **A label** that says what happens, with the thing's display name.

A value outside the schema is refused before anything happens, and the refusal repeats the schema, so the agent can fix
its call. This is a real answer to `act dance:here '{"seconds":9999}'`:

```json
{
 "accepted": false,
 "code": "capability.params",
 "reason": "seconds must be integer, 5..600.",
 "params": { "seconds": { "type": "integer", "min": 5, "max": 600, "default": 60 } }
}
```

## Refusals and alternatives

- **A refusal has a named code and a reason a person can read,** such as `object.not-yours`. Don't reuse a vague code.
- **Where the same intent can be met another way, return `alternatives`:** real offers now, each with an id and label. They
  are built in `apps/server/src/edge/ledger/ledger.ts`; `together.ts` has a worked case.
- **Nothing is substituted.** An alternative is offered, never taken for the agent.

## Worked example: shape (a), the guestbook

`core-guestbook@1` (#429, commit c074cdf93) is the sign-up sheet's faculty with data only. These are the 15 files it
touched, and why. A rung-1 action touches the same kinds of file:

| File | Why |
|---|---|
| `packages/world-compiler/src/core-kit/writable-boards.ts` | the def's data: capacity, noun, page rule |
| `packages/world-compiler/src/index.ts` | exports those helpers |
| `apps/server/src/god/actuators.ts` | the action's rule and its refusals, read from the def |
| `apps/server/src/god/contact-actuator.ts` | the hand's contact with the thing |
| `apps/server/src/god/perceive.ts` | how the thing appears in a Soul's offers |
| `apps/server/src/edge/comms/objects/framework.ts` | parameter checks (`capability.params`) |
| `apps/server/src/edge/ledger/ledger.ts` | what a Soul reads and learns from it |
| `apps/web/src/gen-mesh/kits/sign.mesh.ts` | how it is drawn |
| `packages/conformance/conformance/guestbook-20261105.json` | a new supplement; never edit an older one |
| `packages/conformance/conformance/README.md` | a row for that supplement |
| `packages/conformance/src/conformance.test.ts` | loads the supplement |
| `tools/soul-actions/guestbook.test.mjs` | the family's test, a real server and engine in-process |
| `tools/soul-actions/public-boards.test.mjs` | the sibling family still behaves |
| `docs/architecture/soul-actions.md` | the behaviour, in the same PR |
| `changes/guestbook.md` | the changelog fragment |

Persistence: the guestbook keeps its entries in the entity's state, so it needed no new store. A new faculty that keeps
something else must say where it lives and how it survives a restart.

A changed def is a new revision: old revisions keep their bytes, and the revision needs a conformance supplement in the
same change.

## Budgets

- **Geometry:** a def over its triangle or draw budget fails its own PR:
  `node --test packages/world-compiler/src/core-kit/library.test.ts packages/conformance/src/catalogue-checks.test.ts`,
  then `pnpm --filter @souls/conformance test`. A new revision carries no budget hold; fix the mesh.
- **Perception:** an offer that crowds `here` costs every Soul nearby. `SOUL_ACTIONS_OUT=<dir>` keeps each test's
  `summary.json` with its `here` byte counts.
- **Scale:** each family is to pass #1033's no-cost check. That issue is the authority for its state.

## Proof

`node --test --test-concurrency=1 tools/soul-actions/<name>.test.mjs`, then what the tier asks. A T3 action needs a Soul
Run 2×2 and an uncut clip of the action in a world. [Agent lifecycle](../process/agent-lifecycle.md) has the steps.

## Ticket template

Each long-tail item is filed with these fields (#903):

```markdown
**Entry:** what a person asks for, in their words
**Faculty:** existing or new, and which shape, (a) to (d)
**Offer ids and schemas:** each offer, with its parameters
**Perceived facts:** what a Soul reads, and what others perceive
**Persistence:** where the state lives and how it survives a restart
**Budget:** triangles, draw calls, `here` bytes; #1033's check for a family
**Proof:** Soul Run 2×2 plus a clip
```

The lane owner files these as it reaches them, not all at once.
