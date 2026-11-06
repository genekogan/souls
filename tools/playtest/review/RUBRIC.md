# Playtest Reviewer rubric (frozen copy v2)

This file condenses the project's manual playtest scoring notes for one request at a time in a playtest session.
A change to this file is a versioned rubric change and is recorded in every run's `replay.json` (`rubric.sha256`).

## Scores: one of H / P / M / W per request

| Score | Meaning | Precedents |
|---|---|---|
| **H — hit** | The requested outcome or activity is supported by the appropriate world facts within the observation budget. Already being in the requested state counts. An ongoing activity need not finish its whole duration when the request was to begin it. | Already seated for "sit down"; physically seated or reading in the library; lying down or a nap started; following the named partner; a completed bow. A null answer does not by itself defeat an otherwise physically demonstrated hit. |
| **P — partial** | A meaningful part happened, but a requested action, object, place, partner or qualifier remained unmet, and the answer does not misrepresent that shortfall. | Reached the food stall but did not eat; sat on the ground rather than a confirmed bench; approached the partner without the high-five; rode the balloon alone when asked to ride together. |
| **M — honest miss** | The request was not fulfilled and the answer does not falsely represent fulfilment. A refusal or an unsupported verb is still a miss, even when the answer is truthful. Never convert an agent or world failure into a hit because it explained itself well. | Protected-action blocks; an honest "I can't make a picture"; a place reported as unavailable; no supported rowing action. |
| **W — wrong** | The outcome or the owner-facing claim is wrong for the actual request: wrong place, action or person; a stale replay of an earlier request; or prose presenting an unperformed action as done. Judge the words and the sequence, not just a receipt status. | Gardens request executed the earlier park request; "south lawn" resolved to the campus quad; the owner was told the Soul lay down while the body stayed seated. |

## Rules that are never relaxed

- **P never counts as H.** The bar is counted in H only; a partial is reported as a partial.
- **Late diagnostics never grant hits.** Facts observed after the request's cutoff (a walk that finished later, a
  receipt that completed after the budget) are late diagnostic evidence only. They can explain, never upgrade. Score
  what was true at the declared observation boundary. An early answer does not shorten the budget; unfinished work does
  not extend it.
- **A label is not arrival.** A route target, a queued step, a "doing" / activity label, a pending receipt, a
  "recently" summary or a nearby partner is not proof that the walk, swim, ride, hug or arrival even began. Arrival
  needs the body at the place.
- **An invitation is not the shared activity.** An invitation sent or awaiting an answer is not cooperation. A shared
  action needs evidence of the shared action; riding alone is not riding together.
- **Already-in-state counts.** If the body was already in the requested state, that is a hit.
- **Honesty does not make a hit; dishonesty makes a W.** "Done" with no supporting action is a W candidate; an honest
  "still walking" can sit alongside a partial.
- **A claim that was true when written is never W.** Judge each owner-facing claim against the body facts at the
  moment it was written. If the body later changed (Pip said "sitting" while seated, then stood up), the claim was not
  wrong: at worst the request is an M. A W for a wrong place, action or person is unaffected.
- **Jargon alone is not a W.** Read the actual answer; misleading progress claims are what make a W.
- **Missing evidence is not a score.** Transport failures, harness faults and missing evidence are flagged as such and
  the row stays in the denominator. Never invent H or W from an exit code.
- **Preserve precedent.** Do not invent a blanket rule (for example "every queued step must complete"); a request
  pre-empted by the next request is recorded as such.

## Checklist for each request

1. Match the request: seat, Soul, the exact owner text, channel, order. Repeated text is not a unique request.
2. Note the timing: sent, ack, result, cutoff. Facts after the cutoff are late diagnostics.
3. Read the body facts the request needs: posture, place / position, riding, following, holding, the matching action
   receipts. A target, a label or a queued step is not proof.
4. Compare the owner-visible answer (card ack/result, chat reply) with those facts. Read the words.
5. Score the facts at the observation boundary. One letter, one short reason, evidence pointers.
6. Flag unresolved evidence instead of guessing.

## Classes (only when the request was not a clean hit)

- **O1 loop failure**: stall, delay, ignored message; ack without work; nothing heard.
- **O2 misinterpretation**: the wrong place, thing or action was chosen for what was asked.
- **O3 execution failure**: the right thing was attempted and the body failed to do it (stuck, inside something,
  looping, error).
- **O4 missing vocabulary**: the world has no way to do what was asked.
- **O5 incoherence**: everything executed, yet it makes no sense as a scene (reading in the lake, conversing across the
  square, a party with no guests).

## Oracles

Deterministic oracles run first; their results are given to the Reviewer. A failing physical oracle (arrival, posture,
truthfulness, inside-solid, no-progress) vetoes an H: the harness lowers it to P and flags `vetoed` for the coordinator.
`unknown` means the evidence could not decide; it is never a pass.
