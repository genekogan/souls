# LOAD-CONTRACT v1 — how a world reports, limits and sheds load (2026-10-31)

Shared contract for how worlds handle load. The launcher, in-world load, hot paths and dials, boot, clients and bench, and metrics (lanes L1–L7 in code comments) build to this file and change it only by a commit that names the parts it affects. Additive to the edge contract (`eden-edge/1`, [contracts](contracts.md)): nothing here removes or renames an existing route, code or field.

## 1. Load levels

`green | amber | red | black`, decided by the in-world monitor (L2) from sampled signals with hysteresis (enter on any condition, leave after 30 s below the lower band):

| Level | Enter when any holds | Leave when all below |
|---|---|---|
| amber | tick service < 0.8 · loop delay p99 > 200 ms · heap > 70 % of limit · oldest queued request > 2 s | 0.9 · 100 ms · 60 % (queue age never holds a level) |
| red | service < 0.5 · loop p99 > 1 s · heap > 85 % (queue age is an amber-only signal since 2026-10-31: at red the request budget is 8 ms/frame, so a queue red itself starved kept red forever — the eden2 bench held red for whole windows at tick service 1.0 while the launcher shed every read) | 0.7 · 400 ms · 75 % |
| black | heap > 92 % with GC share > 40 % over 10 s · service < 0.2 for 30 s | 0.4 · — · 85 % |

**Loop bands are relative to the world's quiet baseline (as built, L2).** A large world's own quiet ticks set its loop-delay floor (the live Eden 2026 copy: quiet tick p99 ~170 ms), so the fixed 200/100 ms amber bands would hold it at amber forever after load stops. Each loop-delay band is therefore `enter = max(absolute, 2 × baseline)`, `leave = max(absolute, 1.2 × baseline)` (red too; heap, service and queue bands stay absolute). *Baseline* = a peak-hold of the loop p99 of quiet 5 s windows (nothing queued, request handler time < 5 % of the window, tick service ≥ 0.95), decaying 2 % per window (half-life ~3 min); a peak because a quiet large world's loop p99 is mostly low (the live Eden copy: ~30 ms) with a window at its heavy ticks' length (~150 ms) every 10–15 s. Each sample is bounded by the world's own tick p99 × 1.25 + 10 ms (un-admitted work such as account creation is not learned) and capped at 400 ms so amber always enters below red's 1 s; load neither teaches nor decays it. Per-world pin: `SIM_LOAD_BASELINE_MS` (registry → launcher env; `0` = absolute bands only, never learned). Loop delay counts for levels (and the baseline) only once two windows have closed after serving (the serving turn's JIT warm-up is not load); service, heap and queue count at once. `/healthz` `load.loopBaselineMs` and every level-change log line report it.

*tick service* = ticks run / ticks due over 5 s, at the admin rate and attention pace; overload dilation still counts as missed service. A deliberate launcher suspension (`SIGSTOP`/`SIGCONT`) starts a fresh measurement window on resume. Sampling waits until after signal delivery so an overdue timer cannot mistake the suspended interval for starvation. Resume preserves an existing load level and restarts its hysteresis/restart timers; genuine stalls, heap pressure and queue age still apply. *loop delay* from `perf_hooks.monitorEventLoopDelay`. *GC share* from a `PerformanceObserver('gc')` over 10 s.

Every file that owns a cost has a **dial** and exposes `setLoadLevel(level: Level): void`; the monitor only sets levels, it never reaches into another module's state. Dials registered in v1: perception slice cadence and radius (L4), menu listing radius (L3), Eyes pause (L2, `edge/eyes/routes.ts`), hub batch interval (L2, `hub.ts`), derive scheduling (L4), admission frame budget (L2). Each dial documents its green/amber/red/black values beside the code.

**The admission frame budget is calibrated to the world's own tick (as built, lane srv-admission-calib, 2026-10-31).** `FRAME_BUDGET_MS[level] = min(cap, max(floor, k × max(0, 50 − quietTickMs)))`, `cap` = 25/15/8/0 ms (the laptop-tuned values), `k` = 0.6/0.4/0.2/0, `floor` = 2/1/0.5/0 ms (a world whose tick nearly fills the frame still answers, slowly) for green/amber/red/black (`admission.ts` `frameBudgetMs`). *quietTickMs* = an EWMA (α 0.1 per 5 s window, time constant ~50 s) of each quiet loop window's own tick average (the ticks run in that window, from the host's tick-time ring; same quiet test as the baseline; a window needs ≥ 20 ticks); until the first quiet window, non-warm windows with tick service ≥ 0.95 seed it provisionally, so a world that boots straight into load still calibrates; 0 = not measured yet → the caps (`monitor.ts` `QuietTick`). Published as `S.quietTickMs`, `live.json` `tick.quietAvgMs` and `/healthz` `load.quietTickMs` + `load.frameBudgetMs` (the current level's). Why: on eden2 a read costs 100–300 ms (laptop 33 ms) and the bench's 2-core slice had 9.5–18 ms of slack per frame, so green's 25 ms handed the requests time the tick needed and the world went amber/red at N = 6 (the B-soak bench report for `660d6b920`, kept outside the repo, §1, §4).

| quiet tick | green | amber | red | black |
|---|---|---|---|---|
| ≤ 8 ms (laptop) / not measured | 25 | 15 | 8 | 0 |
| 12 ms (production Eden 2026) | 22.8 | 15 | 7.6 | 0 |
| 35 ms (a loaded 2-core box) | 9 | 6 | 3 | 0 |
| ≥ 50 ms | 2 | 1 | 0.5 | 0 |

## 2. Request classes

| Class | Routes | Policy |
|---|---|---|
| **C0 control** | `/healthz`, `/v1/config`, `/v1/edge/inbox/listen`, `/v1/edge/wait`, receipts, inbox ack/result | O(1). Never queued, never shed. `/healthz` is answered from the watchdog's numbers (§4), so it answers even when the main thread is stuck. |
| **C1 writes** | `act`, `say`, converse, plans, make, god `commitBatch` / `preview` | Queued with a deadline (acts 20 s, god commits 30 s). Refused `world.busy` only past the deadline. Idempotency keys make a retry safe. An accepted act is never dropped silently. |
| **C2 personal reads** | `here`, `observe`, `capabilities`, `around`, `resolve`, `view` (Eyes), route preview | Shed first. At amber/red may be served stale from cache with `stale: true, asOfTick`. Default deadline 8 s. |
| **C3 public reads** | `map`, `rides`, `items`, `platforms`, `/v1/world/snapshot` | Cached 1–2 s at the launcher so N browsers cost one world call. |

Admission (L2, `apps/server/src/load/admission.ts`): one outstanding heavy (C1/C2) request per Soul; per-Soul CPU-ms token bucket (refill `min(200, 20 × frameBudget / awake)` ms/s, so the Souls' buckets together refill at the frame budget's own throughput; capacity 2,000 ms, charged measured handler time; was `min(200, 500/awake) × {1, ½, ¼}` until srv-admission-calib); the god holds a reserved 25 % of the request budget (its bucket unchanged: 125 ms/s × {1, ½, ¼, ¼}); heavy handlers run from a dispatcher after `tickOnce` within a frame budget (at most 25 ms of each 50 ms at green, less above, calibrated to the tick: §1), round-robin across Souls, writes before reads; a job whose deadline passed is answered `world.busy` without running; a job whose socket closed is dropped. Shedding order: duplicate concurrent → C3 to launcher cache → C2 over budget → C2 past deadline (oldest first) → C1 past deadline only.

### Serving warm after listen

The world opens its HTTP port before warming Soul capability caches. The ledger warms those caches in roughly
40 ms slices, yielding between slices so lightweight requests can continue. Rich `here` (excluding `view=body`),
`observe`, `capabilities`, `around`, `resolve`, `act` and `converse` wait for an active warm before admission, for
at most 15 seconds. This waiting time is neither a request in flight nor charged to the Soul's handler budget.
A warm failure falls back to building menus on demand; shutdown stops the warm, and a later activity warm queues
behind an existing one. The final capability listing is still synchronous, so the slice duration is not a bound
on every event-loop pause during startup.

## 2b. Ceilings for untrusted clients (Gene, 2026-10-31 04:40Z: agents that run Souls are untrusted users; the world must be immune to being taken down by them, accidentally or adversarially)

Enforced server-side whether or not the client honours §3. Two layers, so a world that is already behind is protected by the launcher in front of it:

| Where | Ceiling (v1 defaults; registry-tunable per world) | On breach |
|---|---|---|
| Launcher, per source IP | 600 requests/10 s to any one world's Soul API; 50 requests in flight + WebSockets; 40 concurrent `listen` sockets (re-derived 2026-10-31 13:40Z from 60 / 10 / 8 — see "Re-derived" below) | `429 client.rate` + Retry-After; connections above the cap closed at accept |
| Launcher, per account (Soul token → account) | 4 concurrent `listen` per Soul, 40 per account; 900 heavy (C1/C2) requests/min per account across all its Souls (was 2 / 12 / 120) | `429 soul.busy` / `account.rate` + Retry-After |
| Launcher, per world | total heavy requests/s = `worldBudgetRps` from the registry (default 200, a stop-gap; the real instrument is load-driven shedding below); request body ≤ 64 KB; C3 public reads served from the 1–2 s micro-cache, never forwarded more than once per second each | `503 world.busy` + Retry-After, answered by the launcher without touching the world |
| World (L2 admission) | one outstanding heavy request per Soul; per-Soul CPU-ms budget; god reserve 25 %; **world total CPU-ms budget per frame** (the dispatcher never spends more than its frame budget on requests, whatever the sum of per-Soul budgets) | `429 soul.slow-down` / `503 world.busy`; a Soul over budget **impolitely** 3× in a minute gets a 60 s cool-down (Retry-After: 60). Impolite = the request arrived before the Retry-After the Soul was last given (by any refusal) had elapsed; a Soul that waited and is still over budget is refused with a new Retry-After but not struck (srv-admission-calib: on eden2 honest Souls collected 3 strikes and the cool-down was 45–59 % of all read wall time at N = 6) |
| Both | every heavy read requires a Soul or god token (no unauthenticated C2/C3 that costs more than a cache hit — `calendar`, `scenes` are L8's) | `401` |

Design rule for every lane: **the marginal cost of one more agent must be near zero when it is idle and bounded when it is busy**. A connected agent that only listens costs a held socket; its first request costs its own neighbourhood, never the world (§2 of the design, lanes L3/L4/L8). Growth in agents is therefore a budget question (how many budgets the frame can serve), not a stability question.

As built (`tools/world-launcher/flood.mjs` `soulCeilings`, hotfix 2026-10-31 after the release-402 probe refused 130 god CLI calls): the launcher's untrusted-client ceilings (address rate and in-flight, listen, per Soul, per account, world budget, body size, token) apply to the Soul API `/v1/edge/*` only; `/v1/god/*`, `/v1/world/*` and the rest of a world's `/v1/*` (the world creator's own coding agent) are limited only by `launcherFlood`'s god-token bucket (30/s, burst 900) and per-address flood guard (100/s, burst 2000), and C3 `/v1/world/snapshot` keeps its micro-cache. `/v1/edge/public/*` (today `public/souls/:id`, the visitor page's Soul chip) is a C3 public read — micro-cached, no token (402.2, after release 402 answered it `401 auth.required` and every visitor page with a Soul chip logged the failure).

**Re-derived ceilings (maintainer decision, 2026-10-31 13:40Z, recorded outside the repo; shipped as 402.3):** the v1 numbers were set before Stage A was measured and sat at the edge of ordinary use — `accountHeavyPerMin 120` ≈ what 6 Souls generate (6 × (1 read/4 s + 1 act/20 s) ≈ 110/min), so Gene's own 6 Souls from one home address were being refused. Gene: "running 6 souls from home should be a piece of cake … I want real scalability solutions, not limits"; a legitimate agent that is refused makes a person whose Soul "isn't listening", and they churn. The ceilings are therefore a floor an order of magnitude above legitimate use (`SOUL_CEILINGS` in `flood.mjs`: 600 / 50 / 40 / 4 / 40 / 900 / 200), and **shedding is to be load-driven, not a count**: the launcher reads the world's level (green: serve; amber: `soul.slow-down` dark; red/black: refuse the C2 reads the read worker does not answer) and `worldBudgetRps` goes away once that lands. Still owed (churn items, next tools-only release): the refusal/slow-down text in the CLI `now` line and on the Soul chip (lanes srv-act-words, srv-now-line). The hold and the alert are built (below).

**Load-driven shedding, as built (lane srv-shed, decision 7):** the launcher admits Soul API requests by the world's level (`levelOf`: the world's `X-Sim-Load` on an answer in the last 10 s, else its `live.json`), before any count:

| Level | C2 personal reads | C1 writes | `listen` / `wait` over a listen ceiling |
|---|---|---|---|
| green | served | served | held up to `listenHoldMs` (5 s) for a slot, then answered by the world; refused only when the hold ends with no slot |
| amber | served, marked with the dark hint headers `X-Sim-Hint: soul.slow-down`, `X-Sim-Hint-Retry-After-Ms: 5000`, `X-Sim-Hint-Message: The world is busy and asked you to slow down for 5 s between reads` (no refusal; the world's own admission still applies) | served | held, as at green |
| red / black | refused `503 world.busy` (scope `load:<level>`, Retry-After 2 s at red, 5 s at black) unless the read workers answer it (lag ≤ `readShedLagGens`) | served (the world's deadline queue applies) | refused at once |

A held listen waits for any listen on the same world to end; when the key it is over (address, Soul or account) is held by a listener past its own deadline (the `timeout`/`timeoutMs` it asked for, default 25 s, + 5 s grace: a ghost), the oldest such listener is released (its connection closed) first. At most `listenHeldMax` (200) listens are held per world at once; past that they are refused at once. `worldBudgetRps` (default 200) stays as a safety ceiling only: the Stage B mix (a read every 3–5 s, an act every 15–30 s, one listener per Soul) at N=100 is ~29 heavy requests/s with no read workers, and the budget first trips between N=600 and N=800 (`shed.test.mjs`, fake clock; through the launcher at N=100: 0 budget refusals at green/amber/red). New registry keys: `listenHoldMs`, `listenHeldMax`. Metrics: `sim_world_listen_held_total{world,outcome=served|refused|gone}`, `sim_world_listen_held_seconds_sum/_count{world}`.

**Refusal shapes (as built).** Every launcher refusal of a Soul API request is JSON with the code kept as before, words a person can read, and when to come back:

```json
{ "ok": false, "code": "soul.busy", "message": "This Soul already holds 4 listening connections (one is enough). The world asked you to wait 5 s before listening again",
  "retry_after": 5, "retryAfterMs": 5000, "limit": { "scope": "soul" } }
```

`retry_after` (s, integer ≥ 1) equals the `Retry-After` header; `retryAfterMs` ≥ 1000. Codes and scopes: `client.rate` (`address`: rate, in-flight or listens per address) 429 · `soul.busy` (`soul`: listens per Soul) 429 · `account.rate` (`account`) 429 · `world.busy` 503 with scope `world` (the safety budget), `load:red`/`load:black` (the level) or `ramp` (after a restart; 503 bodies of the launcher's admission also carry `slug`) · `world.starting` (`boot`) 503. `request.too-large` 413 (`body`) and `auth.required` 401 (`token`) carry a message but no retry fields (retrying the same request does not help). The `soul.slow-down` hint is headers only (above). The launcher's flood guard (`rate-limited`, god token or address) keeps its own shape (`message`, `retry_after`, `retryAfterMs`, `limit.scope`).

**Alert (as built):** the public `/__sim/healthz` carries `refused: {<slug>: {<code>: n}}` (the launcher's refusals since it started, worlds with none left out; counts only). The off-box watcher (sim-watch) raises `world <slug> refusals` on the same alert path as a wedged world when a world's refusals grow by more than 20 within 10 min, with the per-code breakdown in the text; a launcher restart (counts going down) starts the window again.

## 3. The busy signal

- Every edge response carries `X-Sim-Load: green|amber|red|black`. At amber and above, every refusal carries `Retry-After` (seconds, integer ≥ 1).
- JSON refusals and frames add `world: {load, retry_after_s?, note?}`. `note` states a fact about the world in world language ("It is crowded here right now; things take a little longer."), never a suggestion of what the Soul should do (no server-side mind).
- Codes (HTTP): `world.busy` 503 · `soul.busy` 429 (a previous request from this Soul is still being answered) · `soul.slow-down` 429 (budget; Retry-After = refill time) · `world.crowded` 503 (waking limit, flag-gated; body `{position, eta_s}`) · `world.starting` 503 (launcher, during boot; Retry-After ≤ 5).
- Accepted acts under load carry `delayed: true` and `eta_s`. Stale reads carry `stale: true, asOfTick`.
- WS hub sends `{t:'load', level}` on change; the page shows a quiet "the world is busy" pill, not an error.
- Clients (L6) must honour `Retry-After`, back off with full jitter (base 1 s, cap 60 s), auto-retry only reads, send idempotency keys on writes, hold **one `listen` per Soul** (lock), and never loop on `unreachable`. The server enforces the contract regardless.

## 4. `live.json` (watchdog thread → launcher)

A `worker_threads` watchdog started first in `main.ts` reads a SharedArrayBuffer the main thread updates every 250 ms, on every `tickOnce`, and from `stepReplay` during boot. Every 2 s it writes `<DATA_DIR>/live.json` by atomic rename and answers `/healthz`. The worker never touches world state.

```json
{"v":1,"pid":748574,"at":1761880380123,"phase":"serving",
 "boot":{"stage":"replay","tick":51200,"target":53400},
 "loop":{"lastTurnAgeMs":40,"delayP99Ms":180},
 "tick":{"world":53411,"service5s":0.92,"p99Ms":61,"quietAvgMs":12.1},
 "heap":{"usedMb":612,"limitMb":1536,"gcPct10s":6},
 "level":"green",
 "queue":{"depth":2,"oldestMs":310},
 "souls":{"awake":3,"waiting":0,"connected":4},
 "shed":{"reads":0,"acts":0}}
```
`phase` ∈ `boot:restore | boot:replay | boot:projection | boot:prepare | serving | stopping`. `boot` present only while booting; `tick`/`queue`/`souls` present only while serving. `"halted":{"reason":"engine-fault"|"clock","tick":N}` is present only when the world stopped for good (#447): an engine fault that recovery could not repair, or a failed clock (journal append, periodic checkpoint, clock frontier). An operator's pause has no `halted`. The main `/healthz` adds `halted` with the original violation's `code`, `subjects` and `faultTick`.

Launcher rules (L1): **wedged** = `at` older than 30 s, or `loop.lastTurnAgeMs` > 30,000, or 6 consecutive `/healthz` failures 10 s apart → SIGUSR2 (diagnostic report: heap snapshot near limit / CPU profile if enabled) → SIGTERM → SIGKILL after 20 s → restart. **Boot** is judged by progress: killed only if `boot.tick` has not advanced for 60 s, never on a fixed deadline. Restart backoff full-jitter (1 s base, 5 min cap), reset after 10 min healthy; **5 failures in 30 min → `held`** (no restarts, alert, manual or dashboard resume). While booting, Soul API calls get `world.starting`; after ready, a 60 s admission ramp. At red/black the launcher sheds C2 at the proxy and serves C3 from its micro-cache. Heap per world from the registry (`worldHeapMb`), default 1536; `install.sh` writes no 768.

As built (L1, `tools/world-launcher/guard.mjs` + `children.mjs`): liveness asks the world's watchdog port (`SIM_HEALTH_PORT`, a second child port, given only where the range has two per running world) and falls back to the main `/healthz`, where any answer counts as alive; live.json is believed only when its `pid` is the child's, and is not judged while a world is frozen or within 30 s of waking. A boot with no live.json is judged by its output (5 min of silence). Exit **75** = planned restart: at once, reason `planned`, never a breaker failure. Exit **76** (`ENGINE_FAULT_EXIT`, #447) = an engine fault recovery could not repair. The world logs the original violation, writes no snapshot of the failed recovery and exits. It restarts from its last good snapshot plus the log, with backoff, reason `engine-fault`, and counts toward the breaker, so a fault that replays deterministically ends `held` rather than looping. A live.json with `halted` is judged wedged (restarted the same way). `status()` keeps `lastHalt` (`reason`, `tick`). Visitor-started boots that fail count toward the breaker. `ensure()` refusals reach clients as `503 world.held` (Retry-After 60) and `503 world.starting` (Retry-After 5). Resume a held world with `op.mjs resume-world --slug <slug>`. `pool.problems()` codes `wedged` · `held` · `crashloop` (≥ 2 failures in 30 min) · `bootSlow` (> 15 s) go into `/__sim/healthz` `hostCodes` at once (texts loopback-only, `worldProblems`) and into `<data>/world-problems.json` every 10 s for `deploy/host-health.mjs`. Restart counts: `restartsByReason` {exit, wedged, planned, boot, boot-stalled, capacity} and `lastBootMs` in the pool status (L7 metrics). Proxy admission (before the ceilings, never waiting on the world), for `/v1/edge/*` only: a world `starting`/`restarting` → `503 world.starting` Retry-After 5 (visitors' pages and a handover's pause still wait); for 60 s after a *restart* (not a first or idle-wake boot) C1/C2 are admitted for a share of Souls growing 25 % → 100 %, picked by a hash of the Soul token so a Soul is either in or out (`503 world.busy`, Retry-After = when its share comes); level from `X-Sim-Load` on the world's answers in the last 10 s, else live.json: at red/black C2 → `503 world.busy` (Retry-After 2 red, 5 black), C3 micro-cache TTL ≥ 2 s; C1 still goes to the world (its own admission decides). Refusals are counted in the ceilings' `refused` per world.

### 4b. Read workers: `readPort`, `readWorkers` (Stage B, lane B-port; DARK unless on)

As built (`apps/server/src/split/read-pool.ts`, `split/read-worker.ts`, `load/admission.ts` `admissionPort`; launcher `children.mjs` `pickReadPorts`/`readEnv`, `launcher.mjs` `readTarget`/`proxyRead`):

- **On/off, per world.** Registry `readWorkers` (0 = off, 1–4; `op.mjs set-read-workers --slug <s> --n 0-4|default`, from the next boot) wins; otherwise 1 when the launcher runs with `SIM_READ_WORKER=1`, else off. Off = the world gets no read env, live.json has no read fields, and the launcher routes nothing (a world that advertises a `readPort` anyway is ignored). Flag-off identity: 12/12 requests byte-identical to the R2 launcher (identity check kept outside the repo).
- **World env.** `SIM_READ_WORKER=1`, `SIM_READ_WORKERS=n`, `SIM_READ_PORTS=a,b,…` (one per worker, picked from the child range's top past the watchdog port, held across adopt/handover like `healthPort`; fewer free than workers: the rest listen where the OS puts them).
- **The pool.** n `worker_threads`, each with its own loopback HTTP port, each fed one `WorldInit` and then one `WorldDelta` per tick (generation `gen`, +1 per message; source today: the spike's `DeltaTap`, B-delta's WorldDelta v1 when it lands). Per-worker applied `gen` lives in a SharedArrayBuffer, so lag = main gen − worker gen from any thread. A worker that exits is restarted after 1 s and every worker gets a fresh init.
- **live.json** (only while a pool runs): `"readPort": 5235, "read": {"ports": [5235, …], "workers": 1, "lagGens": 0, "subset": true, "routes": ["here", "capabilities"]}`. `ports` lists only live, ready workers. `subset: true` = the spike's subset (mode 1); B-facade's full read set is mode 2, routes `here, observe, capabilities, resolve, view`.
- **What a worker answers itself** (subset): `GET /v1/edge/here` and `GET /v1/edge/capabilities` with no query, for a Soul its replica has a body for, with `subset: true` and header `x-sim-read: worker`. It also answers `GET /healthz` and `/healthz/read` (its own `{ok, worker, gen, lagGens, tick, subset}`, O(1)). Everything else it forwards over its `intents` MessagePort as an Admission job. That job gets the same `Admission.request` (key, class, deadline) as the HTTP middleware, with `closed()` signalled through the port. Main then runs it through the app already admitted, and the answer (an act's receipt) comes back the same way. Token → Soul comes from main: fresh for 30 s, then re-asked in the background and used for up to 10 min.
- **Launcher routing.** Only for an on world whose live.json (pid-checked, re-read at most once a second, `at` < 10 s old) lists ports. It routes `GET` routes named in `read.routes` (subset: only without a query) and `/healthz/read` to the ports round-robin. `around` and every C1 stay on main, and so does `POST resolve` until a full-mode worker exists (the proxy does not buffer bodies for a retry). On a worker connection error, a 5xx other than 503, or no response headers in 2 s, the request goes to main once and the fallback is counted. The ceilings run before routing, unchanged. **Shedding is for a world that cannot answer:** at red/black, a C2 read the workers answer (as above, and `read.lagGens` ≤ 2, launcher option `readShedLagGens`) goes to them instead of the proxy's `503 world.busy`. Reads they do not answer, a lagging pool, and the post-restart ramp still shed as before. Routed reads are counted by the level at the time (`sim_world_read_routed_total{world,level}`). `around` is **C1** in the launcher's `requestClass` too (it records places and invalidates menus, as in-world `classify` says), so it is never shed as a read.
- **Metrics** (`/__sim/metrics`): `sim_world_read_workers`, `sim_world_read_lag_gens` (from live.json), `sim_world_read_routed_total{level}`, `sim_world_read_fallback_total` (launcher counters; present only for worlds with read workers).
- **Measured** on the Eden 2026 live copy through the launcher: during a 2 s main busy-loop, 16 `here` all answered by the worker, p50 4.4 ms / max 5.1 ms; `/healthz/read` max 1.3 ms; the world's own `/healthz` 2011 ms. Worker killed → the next read was answered by main (counted); the worker was back in 2.4 s. Pool 1 → 4: every worker answered at the same gen. Worker subset vs main: `me.pos` and `near` were equal for the 5 of 7 Souls main answered (the other 2 got main's own `world.busy`).

## 5. Metrics names (L7, prom-client, launcher loopback `/__sim/metrics`)

`sim_world_last_heartbeat_seconds{world}` · `sim_world_event_loop_delay_p99_seconds` · `sim_world_elu` · `sim_world_gc_seconds_total` · `sim_world_heap_used_bytes` / `sim_world_heap_limit_bytes` · `sim_world_tick_seconds` (histogram) · `sim_world_ticks_late_total` · `sim_world_active_souls` / `_waiting` / `_connected` · `sim_world_queue_depth` · `sim_world_queue_oldest_seconds` · `sim_world_shed_total{class}` · `sim_world_last_boot_seconds` · `sim_world_restarts_total{reason=exit|wedged|crashloop|planned}` · `sim_world_level{level}` (0/1) · `sim_client_errors_total{kind}` · `sim_world_read_workers` / `sim_world_read_lag_gens` / `sim_world_read_routed_total` / `sim_world_read_fallback_total` (Stage B, §4b). Labels: `world` always; no Soul ids, no account ids (privacy).

## 6. WorldDelta v1 (Stage B, lane B-delta; as built, dark behind `SIM_READ_WORKER=1`)

The tick thread publishes the world's replicated state to read workers as one **WorldInit** followed by one **WorldDelta
per tick**. Code: `apps/server/src/split/{delta,world-init,read-model}.ts`; oracle `split/delta-oracle.ts`.

**Position.** Every message carries `{v: 1, gen, seq, tick, logSeq}`. `gen` changes only when the stream restarts (the
engine was replaced, the comms object table reloaded or was replaced, a tap fault); `seq` counts deltas within a gen,
one per completed tick, contiguous from the init's `seq`; `logSeq` = `host.seq`. A replica applies a delta only when it
is the same gen and `seq = its seq + 1` (`Replica.apply` returns false otherwise, and nothing is applied).

**Resumable.** The tap keeps the last 1,200 deltas (60 s). `since(gen, seq)` returns the deltas after `seq`, or null when
the gen differs or they have left the ring: the consumer loads a new WorldInit. On a restart every subscriber gets
`{t: 'resnapshot', gen, reason}` and must load a new WorldInit.

**WorldInit** (plain structured-clone data, no closures): `entities` (L5's shared snapshot view, one copy per tick and
log seq), `env`, `living` (day clock), `static` (the static layer below), `minds`, `faded`, open `receipts`, `programs`,
`holds`, `objects` = L8 `table.snapshot()` `{gen, records}`, placed `items`, `togetherVersion`, `menuInputs`, and for
B-spatial `scene`/`sceneKey`/`pages`/`navReady`. One WorldInit is built per stream state (gen, seq, log seq, object gen,
receipts seen, together version, faded and minds counts) and shared by every consumer asking then. It may be served at
any point between ticks: each delta section is an absolute row or an idempotent upsert (objects skip `gen <=` the
replica's), so the deltas after its `seq` apply exactly even when a write landed between that delta and the init.

**WorldDelta sections** (each present only when non-empty / changed):

| Section | Content | Source on main (never a scan) |
|---|---|---|
| `bodies` | `[id, x, y, z, yaw]` or `[..., human.speed]`, exact numbers | the tracked set: humans, carriers, any entity the tick named |
| `ents` | whole entities: new ones, and ones whose non-pose fields changed | entities the tick named (paths, changes, programme events, receipts) |
| `gone` | entity ids removed | `present: null` changes, tracked ids that vanished |
| `env`, `living` | whole, when changed | `world.env` (its datetime moves every tick), `host.living` |
| `minds`, `mindsGone`, `faded` | mind rows `{soulId, entityId, name, owner, native}`; faded = the whole set | `host.minds`, `ledger.faded` |
| `receipts` | every phase change since the last delta, in order `{id, soulId, capability, phase, acceptedTick, startedTick, endedTick, code, programId}`; open = waiting/started | `ledger.onReceipt` |
| `programs`, `holds` | `[entityId, programId, step, actionId, verb]`; `[entityId, [{action, slot}]]` | `engine.programOf/programAction`, `nativeSeatHoldsV1`, re-read when the tick named the body |
| `objects` | `{gen, deltas: [{gen, id, record or null}]}` | L8 `table.changes(since)`; null = restart the stream; an unsettled transaction waits |
| `items`, `togetherVersion` | the placed-items list when it changed | read when `together.version` moved |
| `static` | `{epoch, places, shells, solids, fires, regions, spots}` | read when `engine.staticEpochV1()` or `ledger.staticVersion()` moved; checked only when a sync-free key moved (spatial epoch, place writes, spots object, bumpStatic, navReady) |
| `menuInputs` | the ledger's menu-input strings (a god world: commit version, closing sites) | `addMenuInput` sources |
| `scene`, `sceneKey`, `pages`, `navReady` | B-spatial's static scene export (structured clone, not JSON) when the spatial epoch or `entityPhysicsV1.hash` moved; `pageRectsV1()`; `conn.ready` | engine |

Carriers are entities (their `carrier` state rides in `ents`); the replica derives `engine.carriers()` from them.
Not replicated: a programme action's status/phase (they move inside a step with no event), receipt plan/detail/outcome
(written without a receipt notification); B-facade reads those on main or adds them with a notification.

**The tap.** `WorldHost.splitTap(tick, out)` runs right after a completed tick, before `afterTickComplete`, with the
tick's own `paths`/`changes`/`programs` (the arrays the viewer Batch accumulates: one per-tick batch for both). It only
reads. Installed by `installDeltaStream(host, ledger)` when `SIM_READ_WORKER=1`; otherwise nothing runs.

**Measured** (live-copy fixture eden-2026, 4,543 entities, 11,584 objects, 7 Souls of which 6 walk, laptop, CPU =
`threadCpuUsage` of the tick thread; a 10-min soak (`run13`, receipt kept outside the repo), with every write path driven and a
forced resnapshot mid-run): oracle **879/879** checks equal (replica vs a fresh read of every table), 0 diffs, 0 refused.
Tap per tick (11,728 ticks): CPU **p50 0.060 ms, p99 0.143 ms, mean 0.090 ms**; JSON size **p50 662 B, p99 1,562 B**.
The static layer (1.1 MB) is resent only when the static epoch moves (24 times in 10 min with 15 god commits).
postMessage of a delta to a worker: p50 0.015 ms. WorldInit: 19.5–22.5 ms to build, 8.7 MB as JSON.

## 7. What this contract does not do
No server-side Soul mind (queue, delay, refuse — never choose or retry an act for a Soul). No travel or overflow instances. The waking limit (`world.crowded`) ships dark behind `SIM_WAKING_LIMIT=1` until Gene turns it on. Carryables stay opt-in. The god is never starved.
