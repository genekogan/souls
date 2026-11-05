// Request budgets and the scripted schedule (#371 H-f). A scripted request must be able to finish inside the run:
// atSec + budgetSec + 15 s of queue slack ≤ durationSec. `playtest.mjs run` refuses a scenario that breaks it, before
// provisioning; generated replays get a duration that fits (never a shorter budget).
export const QUEUE_SLACK_SEC = 15;

/** A request's budget (ms): its own budgetSec, else the god default for a god request, else the scenario default. */
export function budgetMsFor({ scenario, quick, budgetSec, god = false }) {
  if (Number.isFinite(budgetSec)) return budgetSec * 1000;
  if (god) return (scenario.director?.godBudgetSec ?? 600) * 1000; // a build outlives a Soul request window
  const o = scenario.director?.budgetSec;
  if (Number.isFinite(o)) return o * 1000;
  return ((quick ? o?.quick : o?.default) ?? (quick ? 90 : 180)) * 1000;
}

const ends = (scenario) => {
  if (scenario?.director?.mode !== 'scripted' || !Array.isArray(scenario.director.script)) return [];
  const godId = scenario.god ? (scenario.god.id ?? 'god') : null;
  return scenario.director.script.map((e, index) => {
    const budgetSec = budgetMsFor({ scenario, budgetSec: e.budgetSec ?? null, god: e.seat === godId }) / 1000;
    return { index, seat: e.seat, atSec: e.atSec, budgetSec, endSec: Number.isFinite(e.atSec) ? Math.round((e.atSec + budgetSec + QUEUE_SLACK_SEC) * 10) / 10 : NaN };
  });
};

/** Script entries that cannot finish inside the run → [{index, seat, atSec, budgetSec, endSec, durationSec, message}]. Persona mode: []. */
export function scheduleProblems(scenario) {
  const dur = scenario?.durationSec;
  if (!Number.isFinite(dur)) return [];
  return ends(scenario).filter((x) => !Number.isFinite(x.endSec) || x.endSec > dur).map((x) => (Number.isFinite(x.endSec) ? x : { ...x, endSec: null, missingAtSec: true })).map((x) => ({ ...x, durationSec: dur, message: x.missingAtSec ? `script[${x.index}] (${x.seat}, "${String(scenario.director.script[x.index].text ?? '').slice(0, 60)}"): no numeric atSec` : `script[${x.index}] (${x.seat} at ${x.atSec} s, "${String(scenario.director.script[x.index].text ?? '').slice(0, 60)}"): budget ${x.budgetSec} s + ${QUEUE_SLACK_SEC} s slack ends at ${x.endSec} s, after the run's ${dur} s` }));
}

/** The scenario with durationSec raised (never lowered) so every scripted request fits; persona mode unchanged. */
export function fitDuration(scenario) {
  const need = Math.max(0, ...ends(scenario).map((x) => x.endSec).filter(Number.isFinite));
  return Number.isFinite(scenario?.durationSec) && need > scenario.durationSec ? { ...scenario, durationSec: Math.ceil(need) } : scenario;
}
