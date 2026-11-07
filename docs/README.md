# Soul documentation

The code is the authority. When a doc and the code disagree, the code wins: fix the doc in the same change.

## Read by task

| I want to… | Read |
|---|---|
| oversee work, review proof or change worker capacity | [owner playbook](process/owner-playbook.md) |
| set direction or turn a request into work | [vision](design/vision.md), [roadmap](design/roadmap.md), [planning and intake](process/planning.md) |
| improve agent control, diagnose delays and plan expressive collaboration | [agency quality design](design/agency-quality.md), [umbrella #623](https://github.com/soulsimulation/souls/issues/623) |
| run Soul locally | [development](development.md) |
| write the public docs served at soul.game/docs | [writing guide](site/WRITING.md); pages in [site/](site/), linted by `node tools/docs/lint.mjs` |
| understand how it fits together | [architecture](architecture.md), then the [glossary](glossary.md) |
| reason about contracts, performance or where a feature plugs in | [component and data-flow map](architecture/map.md) |
| change the server API or protocol | [API](architecture/api.md), [protocol](architecture/protocol.md), [contracts](architecture/contracts.md) |
| plan cooperative physical actions and construction within controllability | [physical coordination design](design/physical-coordination.md), [workstream #560](https://github.com/soulsimulation/souls/issues/560) under [#623](https://github.com/soulsimulation/souls/issues/623) |
| understand folder ownership and ordinary commands | [repository layout](development/repository-layout.md), [development](development.md) |
| understand project reporting and visual release history | [project visibility design](design/project-visibility.md), [contribution attribution](process/contribution-attribution.md) |
| work on Souls or the Soul client | [Souls at the edge](architecture/souls.md) |
| plan where Souls live on a machine, Soul memory, presence and relationships | [Soul context design](design/soul-context.md), [tranche #1133](https://github.com/soulsimulation/souls/issues/1133) |
| plan custom bodies and non-humanoid actions | [custom body design](design/custom-bodies.md) |
| diagnose experiences spanning an edge agent and world | [experience report design](design/experience-reports.md) |
| work on god mode | [god mode](architecture/godmode.md), [safety](architecture/safety.md) |
| know what Souls do by hand (lamps, doors, water, carrying, boards, music, play, tea) | [Soul Actions](architecture/soul-actions.md) |
| add something a Soul can do | [adding a Soul action](architecture/adding-an-action.md) |
| work on worlds or the launcher | [worlds](architecture/worlds.md), [data](architecture/data.md), [load](architecture/load.md), [split](architecture/split.md) |
| touch an engine | [engine contract](architecture/engine-contract.md), the [Mars engine docs](mars/README.md) |
| touch model calls or the budget | [brain](architecture/brain.md) |
| know which tests to run | [testing](testing.md) |
| run a playtest or direct a cast | [playtests](testing/playtests.md), [swarm director](testing/swarm-director.md) |
| ship a release | [release](release.md) |
| know how the version lines relate and what a release carries | [versioning](process/versioning.md) |
| operate the production host | [operations](operations.md) |
| take an issue to a merged PR as an agent | [agent lifecycle](process/agent-lifecycle.md), [agent workflow](process/agent-workflow.md) |
| know what a Mars building or place is | [Mars campus](mars/campus.md) |

## Contents

- [architecture.md](architecture.md): system overview
  - [architecture/](architecture/): [map](architecture/map.md), [api](architecture/api.md), [protocol](architecture/protocol.md),
    [engine contract](architecture/engine-contract.md), [brain](architecture/brain.md), [data](architecture/data.md),
    [worlds](architecture/worlds.md), [souls](architecture/souls.md), [god mode](architecture/godmode.md),
    [contracts](architecture/contracts.md), [load](architecture/load.md), [split](architecture/split.md), [Soul Actions](architecture/soul-actions.md), [safety](architecture/safety.md)
- [glossary.md](glossary.md)
- [development.md](development.md): setup, environment variables, local worlds, media
- [testing.md](testing.md): unit tests, gates, e2e, playtests, proof tiers
  - [testing/](testing/): [e2e](testing/e2e.md), [remote gate](testing/remote-gate.md),
    [playtests](testing/playtests.md), [cloud playtests](testing/playtests-cloud.md),
    [swarm director](testing/swarm-director.md)
- [release.md](release.md): the release workflow, `ship.sh`, rollback; [versioning](process/versioning.md): the version lines
- [operations.md](operations.md): services, health, backups
  - [operations/](operations/): [runbook](operations/runbook.md), [disaster recovery](operations/disaster-recovery.md),
    [CDN](operations/cdn.md), [auth](operations/auth.md), [analytics](operations/analytics.md)
- [process/](process/): how work gets done
  - [agent lifecycle](process/agent-lifecycle.md), [agent workflow](process/agent-workflow.md), [review](process/review.md),
    [playtest method](process/playtest-method.md), [Modal policy](process/modal-policy.md),
    [lessons](process/lessons.md), [PROOF-POLICY.yml](process/PROOF-POLICY.yml)
- [design/vision.md](design/vision.md): where Soul is heading
- [design/roadmap.md](design/roadmap.md): outcome themes and unresolved product questions
- [design/physical-coordination.md](design/physical-coordination.md): proposed shared physical activities and reusable construction
- [design/soul-context.md](design/soul-context.md): a durable home for Souls and god seats, one memory across worlds, relationships
- [design/project-visibility.md](design/project-visibility.md): private progress overview and public visual release history
- [development/repository-layout.md](development/repository-layout.md): current folder responsibilities and staged first-party ownership
- [process/planning.md](process/planning.md): intake, ready work and portable handoffs
- [mars/](mars/README.md): the vendored deterministic engine

Docs that belong to one folder stay next to its code as that folder's `README.md` (for example
`tools/core/multiworld/`, `tools/cdn/`, `packages/conformance/conformance/`, `packages/music/source/`). Files the server
serves to agents (`tools/edge-skill/SKILL.md`, `tools/god-skill/SKILL.md`, `tools/world-skill/SKILL.md`, the
playtest personas and rubric) are product content, not documentation: change them like code.
