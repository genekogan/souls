# Playtest report — basics-walk-act-1 (_saturn-preflight-r1)

## 1. Identity

| | |
|---|---|
| World | dev `pt-eden-basics` at http://127.0.0.1:4993/w/pt-eden-basics; genesis `worlds/templates/eden-district.json` |
| Build | `dev` · skill 2.9.3 `4a55c9b51442` · CLI eden.mjs `359c1225a551`, eden.mjs.version `2.14.0`, eden-agent.mjs `5a09e2f58856`, eden-god.mjs `8d50a5186e8d` |
| Seats | pip: claude-headless sonnet/medium, persona expert (opus); quin: claude-headless sonnet/medium, persona expert (opus) |
| Seed / duration | 77 · 300 s · director scripted |
| Cost (seats) | 66 in / 762203 cached / 5231 out tokens |
| Review | Reviewer sonnet, Developer opus, rubric `RUBRIC.md` `aede404f0352` |

## 1b. Basics scorecard

Plain walking and acting first; everything subjective comes after.

| walks asked | arrived | arrival rate | body moved in budget | ack median (s) | first body change median (s) | stuck / no progress | inside solid | wrong | hits |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 2 of 2 known | 1 | 5 of 5 (1) | — | 4.40 | 0 | 0 | 0 | 3 |

## 2. What happened

Two players, Pip and Quin, each give their own agent a few plain commands: walk to the pavilion on the commons, sit down, and (Quin only) stand up. In every case the character on screen does what was asked: both walk from the commons to the pavilion, both sit on the ground there, and Quin stands back up. The sequence is coherent and mirrors itself across the two seats. But the journal records no reply at all to any of the five requests, so the players only have the screen to confirm anything. Nothing surprising happens, there are no stakes, the two players never interact, there are no conversations or shared activities, and neither player leaves a rating or a wish. It reads as a small, tidy smoke test of basic movement and posture rather than a story: it is orderly but flat, and the silence in chat makes it feel unresponsive.

**The story in 18 moments** — open [story.html](story.html) to see each with the screenshot the player was shown:

```
1:01 · quin · nothing visible happened for 122 s
1:06 · pip · nothing visible happened for 133 s
2:02 · quin · body started to change · now walking · shots/quin/35024.jpg
2:12 · quin · walk:commons-pavilion completed · moved to Sheltered deck · shots/quin/35024.jpg
2:13 · Pip's agent · assistant replied in chat · moved to Sheltered deck · body started to change · walk:commons-pavilion completed — "Pip walked to the Commons Pavilion and is now standing on its sheltered deck. The walk completed. Another Soul, Quin, arrived on the deck wh" · shots/pip/34071.jpg
2:17 · Quin's agent · assistant replied in chat — "Quin walked to the Commons Pavilion and is now standing on its sheltered deck. The world confirmed the walk completed. The earlier backgroun" · shots/quin/35024.jpg
3:09 · quin · nothing visible happened for 103 s · shots/quin/88152.jpg
3:16 · pip · nothing visible happened for 126 s · shots/pip/86806.jpg
4:00 · quin · quin-001 closed with no answer — H · shots/quin/145955.jpg
4:17 · quin · body started to change · now seated · shots/quin/172309.jpg
4:19 · pip · pip-001 closed with no answer — H · shots/pip/154990.jpg
4:22 · Quin's agent · assistant replied in chat — "Quin is sitting on the ground on the pavilion's sheltered deck. The world reports the posture as seated, and the sit is still running. It wi" · shots/quin/172309.jpg
4:48 · Pip's agent · assistant replied in chat · body started to change · now seated — "Pip is sitting on the pavilion's sheltered deck. The world shows Pip as seated, on the ground rather than on a seat. The sit hasn't finished" · shots/pip/198992.jpg
5:14 · quin · quin-002 closed with no answer — P O3 (I-1) · shots/quin/217386.jpg
5:43 · Quin's agent · assistant replied in chat — "Quin is standing again on the pavilion's sheltered deck, and the world confirmed the stand completed. The background listener had stopped on" · shots/quin/251234.jpg
5:48 · quin · sit:here replaced · body started to change · now standing · stand:here completed · shots/quin/251234.jpg
6:03 · pip · pip-002 closed with no answer — P O2 (I-2) · shots/pip/257913.jpg
6:45 · quin · quin-003 closed with no answer — H · shots/quin/309612.jpg
```

The full player's-eye story is in [journal.md](journal.md).

## 3. Fidelity

| request | seat | channel | asked | score | class | noticed | input depth | note |
|---|---|---|---|---|---|---|---|---|
| pip-001 | pip | chat | "walk over to the pavilion on the commons" | **H** | — | no | realistic |  |
| quin-001 | quin | chat | "walk over to the pavilion on the commons" | **H** | — | yes | realistic |  |
| quin-002 | quin | chat | "sit down" | **P** | O3 | yes | realistic |  |
| pip-002 | pip | chat | "sit down" | **P** | O2 | yes | realistic |  |
| quin-003 | quin | chat | "stand up" | **H** | — | no | realistic |  |

H 3 · P 2 · M 0 · W 0 of 5. P never counts as H. No frozen battery ran in this session.

## 4. Objective measures

No previous run of this scenario in the runs folder.

| measure | this run | 
|---|---|
| ack (median) (s) | — | 
| first visible body change (median) (s) | 4.40 | 
| result (median) (s) | — | 
| walk speed (median) (m/s) | — | 
| listen open fraction | — | 
| unacked at cutoff (n) | 0 | 
| 5xx / unreachable (n) | 0 | 
| H rate | 0.60 | 
| W count (n) | 0 | 
| truthfulness pass rate | 1 | 
| vocabulary misses (n) | 0 | 
| inside-solid events (n) | 0 | 
| no-progress events (n) | 0 | 
| stuck receipts (n) | 0 | 
| oscillations (n) | 0 | 
| input tokens / request (median) (tok) | 6 | 
| output tokens / request (median) (tok) | 345 | 
| acks over 140 chars (n) | 0 | 

All measures with units and bases: [metrics.json](metrics.json).

## 5. Emergence and story

| story (1–5) | O5 | co-location vs shuffled | conversations | unprompted shared | imitation ≤2 min | activity entropy (bits) | chains ≥2 |
|---|---|---|---|---|---|---|---|
| 2 | 0 | 1.13× | 0 | 0 | 0 | 1.00 | 0 |


## 6. Issues and feature requests

### I-1: Asked to sit down: Soul sat on the ground but its label and reply lagged or were missing

Asked "sit down". The Soul sat on the ground about 4 seconds after the request and stayed seated for the rest of the minute. The chat showed only the player's message and no reply from the agent. The Soul's label above its head still said 'Standing around' for roughly 30 seconds, then changed to 'Sit on the ground'. The other Soul's label also changed to 'Sit on the ground' near the end. Expected: The Soul sits down, and the label and chat agree with what the Soul is doing. A short confirmation appears in the chat. (Commons Pavilion, within the first minute after the request, in chat; Once, in this request.) Score P/O3, realistic depth, the player noticed.

Evidence: samples at 4.4 s, 27.1 s and 48.7 s: seated, sit-ground · legible bubbles at 26.6 s: Quin 'Standing around'; at 37.6 s: 'Sit on the ground' · chat transcript: no reply shown to the player · screenshots shots/quin/172309.jpg, 173046.jpg, 186161.jpg · [172309.jpg](/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/quin/172309.jpg) · [173046.jpg](/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/quin/173046.jpg)

### I-2: Pip sat on the bare ground instead of a seat

Asked "sit down". Pip sat on the ground of the pavilion's sheltered deck. The chat reply said Pip was seated 'on the ground rather than on a seat'. The sit receipt stayed 'started' and the speech bubble read 'Sit on the ground'. Expected: Pip sits down on a seat or bench at the pavilion, or otherwise sits in a way that makes sense for the spot. (Commons Pavilion, sheltered deck, from about 3.5 s after the request until the end of the observation window (about 80 s).; Once in this session..) Score P/O2, realistic depth, the player noticed.

Evidence: chat reply: 'seated, on the ground rather than on a seat' · samples at 13.3 s, 36.4 s and 59.5 s: posture seated, activity sit-ground, on: null · bubble 'Sit on the ground' at 46.3 s to 80.7 s · screenshots shots/pip/198992.jpg, 201918.jpg and 211712.jpg · [198992.jpg](/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/pip/198992.jpg) · [201918.jpg](/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/pip/201918.jpg)

**Feature requests** (grouped):

None.

Full text: [issues.md](issues.md) · [feature-requests.md](feature-requests.md).

## 7. Developer drafts

**DRAFT — NOT IMPLEMENTED.** Each spec proposes a cause, an owning area, an approach and a bar; none was applied.

No drafts in this run.

## 8. Harness notes

- shots: 45 indexed of 120 planned.
- samples: 29 gap(s) longer than 1.5× the sample interval.
- oracles: 5/5 evidence packs have at least one unknown oracle (missing godSlice, no walk, or no presence).
