# Capacity comparison (cw8-compare/1)

Baseline run 41915686991 at `5856b689` · candidate run 41915686991 at `5856b689`. Ranges are the repeats (min–max); a direction is called only when they do not overlap.

- **Verdict before:** inconclusive (indicative only, does not qualify)
  - objectives missed: even r1: read; even r1: actionStart; even r1: delivery; even r1: clock; even r1: failures; even r1: restarts; meetup r1: read; meetup r1: actionStart; meetup r1: failures; even r2: read; even r2: actionStart; even r2: delivery; even r2: clock; even r2: failures; even r2: restarts; meetup r2: read; meetup r2: actionStart; meetup r2: failures
  - allocation unknown (no cgroup v2 limits): even r1, meetup r1, even r2, meetup r2
  - unreadable (unknown, not 0): even r1 swapPeakMb, even r1 throttledPeriodShare, meetup r1 swapPeakMb, meetup r1 throttledPeriodShare, even r2 swapPeakMb, even r2 throttledPeriodShare, meetup r2 swapPeakMb, meetup r2 throttledPeriodShare
- **Verdict after:** inconclusive (indicative only, does not qualify)
  - objectives missed: even r1: read; even r1: actionStart; even r1: delivery; even r1: clock; even r1: failures; even r1: restarts; meetup r1: read; meetup r1: actionStart; meetup r1: failures; even r2: read; even r2: actionStart; even r2: delivery; even r2: clock; even r2: failures; even r2: restarts; meetup r2: read; meetup r2: actionStart; meetup r2: failures
  - allocation unknown (no cgroup v2 limits): even r1, meetup r1, even r2, meetup r2
  - unreadable (unknown, not 0): even r1 swapPeakMb, even r1 throttledPeriodShare, meetup r1 swapPeakMb, meetup r1 throttledPeriodShare, even r2 swapPeakMb, even r2 throttledPeriodShare, meetup r2 swapPeakMb, meetup r2 throttledPeriodShare

Conditions are like for like on the known conditions.

Not recorded on either side, so not compared: `cpuMax`, `memoryMaxMb`.

## even

| cell | better | baseline | candidate | direction |
|---|---|---|---|---|
| joined | higher | 50 | 50 | overlaps |
| readE2eP95Ms | lower | 2057–4362 | 2057–4362 | overlaps |
| readE2eP99Ms | lower | 40352–220193 | 40352–220193 | overlaps |
| actE2eP95Ms | lower | 1541–2932 | 1541–2932 | overlaps |
| actE2eP99Ms | lower | 43913–220383 | 43913–220383 | overlaps |
| actionStartP95Ms | lower | 1290–1358 | 1290–1358 | overlaps |
| deliveryP95Ms | lower | 407–473 | 407–473 | overlaps |
| overdue | lower | 627–976 | 627–976 | overlaps |
| unissued | lower | 606–1396 | 606–1396 | overlaps |
| loadFailures | lower | 182–440 | 182–440 | overlaps |
| clockMinQuiet | higher | 1.0003–1.0004 | 1.0003–1.0004 | overlaps |
| clockMinActive | higher | 0.5745 | 0.5745 | overlaps |
| restarts | lower | 0 | 0 | overlaps |

| objective | rep | baseline | candidate | state |
|---|---|---|---|---|
| read | 1 | misses | **misses** | **still failing** |
| actionStart | 1 | misses | **misses** | **still failing** |
| delivery | 1 | misses | **misses** | **still failing** |
| clock | 1 | misses | **misses** | **still failing** |
| failures | 1 | misses | **misses** | **still failing** |
| restarts | 1 | misses | **misses** | **still failing** |
| read | 2 | misses | **misses** | **still failing** |
| actionStart | 2 | misses | **misses** | **still failing** |
| delivery | 2 | misses | **misses** | **still failing** |
| clock | 2 | misses | **misses** | **still failing** |
| failures | 2 | misses | **misses** | **still failing** |
| restarts | 2 | misses | **misses** | **still failing** |

| world | met (baseline) | met (candidate) | hottestCores before → after | loopP99MsMax before → after | queueMax before → after |
|---|---|---|---|---|---|
| mw0 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.536–0.537 → 0.536–0.537 (overlaps) | 558–700 → 558–700 (overlaps) | 5 → 5 (overlaps) |
| mw1 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.135–0.172 → 0.135–0.172 (overlaps) | 264–271 → 264–271 (overlaps) | 4–5 → 4–5 (overlaps) |
| mw2 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.127–0.137 → 0.127–0.137 (overlaps) | 103–191 → 103–191 (overlaps) | 2–3 → 2–3 (overlaps) |
| mw3 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.147 → 0.147 (overlaps) | 261–280 → 261–280 (overlaps) | 5 → 5 (overlaps) |
| mw4 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.091–0.099 → 0.091–0.099 (overlaps) | 267–1065 → 267–1065 (overlaps) | 4 → 4 (overlaps) |
| mw5 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.15–0.152 → 0.15–0.152 (overlaps) | 563–572 → 563–572 (overlaps) | 5 → 5 (overlaps) |
| mw6 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.387–0.418 → 0.387–0.418 (overlaps) | 187–201 → 187–201 (overlaps) | 5 → 5 (overlaps) |
| mw7 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.133–0.201 → 0.133–0.201 (overlaps) | 219–570 → 219–570 (overlaps) | 5 → 5 (overlaps) |
| mw8 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.094–0.126 → 0.094–0.126 (overlaps) | 103–125 → 103–125 (overlaps) | 3 → 3 (overlaps) |
| mw9 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.367–0.384 → 0.367–0.384 (overlaps) | 167–190 → 167–190 (overlaps) | 5 → 5 (overlaps) |

## meetup

| cell | better | baseline | candidate | direction |
|---|---|---|---|---|
| joined | higher | 50 | 50 | overlaps |
| readE2eP95Ms | lower | 559503–561717 | 559503–561717 | overlaps |
| readE2eP99Ms | lower | 694748–699183 | 694748–699183 | overlaps |
| actE2eP95Ms | lower | 546712–554780 | 546712–554780 | overlaps |
| actE2eP99Ms | lower | 686864–691693 | 686864–691693 | overlaps |
| actionStartP95Ms | lower | 524714–526364 | 524714–526364 | overlaps |
| deliveryP95Ms | lower | 133–183 | 133–183 | overlaps |
| overdue | lower | 2991–3037 | 2991–3037 | overlaps |
| unissued | lower | 4555–4603 | 4555–4603 | overlaps |
| loadFailures | lower | 81–120 | 81–120 | overlaps |
| clockMinQuiet | higher | 0.9992–0.9993 | 0.9992–0.9993 | overlaps |
| clockMinActive | higher | 0.9937–0.9977 | 0.9937–0.9977 | overlaps |
| restarts | lower | 0 | 0 | overlaps |

| objective | rep | baseline | candidate | state |
|---|---|---|---|---|
| read | 1 | misses | **misses** | **still failing** |
| actionStart | 1 | misses | **misses** | **still failing** |
| delivery | 1 | meets | meets | meets |
| clock | 1 | meets | meets | meets |
| failures | 1 | misses | **misses** | **still failing** |
| restarts | 1 | meets | meets | meets |
| read | 2 | misses | **misses** | **still failing** |
| actionStart | 2 | misses | **misses** | **still failing** |
| delivery | 2 | meets | meets | meets |
| clock | 2 | meets | meets | meets |
| failures | 2 | misses | **misses** | **still failing** |
| restarts | 2 | meets | meets | meets |

| world | met (baseline) | met (candidate) | hottestCores before → after | loopP99MsMax before → after | queueMax before → after |
|---|---|---|---|---|---|
| mw0 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.604–0.608 → 0.604–0.608 (overlaps) | 342–488 → 342–488 (overlaps) | 20 → 20 (overlaps) |
| mw1 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.128–0.164 → 0.128–0.164 (overlaps) | 209–262 → 209–262 (overlaps) | 3–4 → 3–4 (overlaps) |
| mw2 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.1–0.109 → 0.1–0.109 (overlaps) | 96–115 → 96–115 (overlaps) | 1–2 → 1–2 (overlaps) |
| mw3 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.141–0.142 → 0.141–0.142 (overlaps) | 284–340 → 284–340 (overlaps) | 4 → 4 (overlaps) |
| mw4 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.06 → 0.06 (overlaps) | 109–137 → 109–137 (overlaps) | 2–3 → 2–3 (overlaps) |
| mw5 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.08 → 0.08 (overlaps) | 533–540 → 533–540 (overlaps) | 3 → 3 (overlaps) |
| mw6 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.287–0.292 → 0.287–0.292 (overlaps) | 167–184 → 167–184 (overlaps) | 3 → 3 (overlaps) |
| mw7 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.104–0.107 → 0.104–0.107 (overlaps) | 236–286 → 236–286 (overlaps) | 2–3 → 2–3 (overlaps) |
| mw8 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.079 → 0.079 (overlaps) | 99–113 → 99–113 (overlaps) | 3 → 3 (overlaps) |
| mw9 | r1 missed, r2 missed | **r1 missed, r2 missed** | 0.285–0.288 → 0.285–0.288 (overlaps) | 198–200 → 198–200 (overlaps) | 3 → 3 (overlaps) |

