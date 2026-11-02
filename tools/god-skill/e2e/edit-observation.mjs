// E1/F1 observe two cache layers: the launcher C3 cache keys the URL (1s, 2s hot),
// while the world's snapshot cache keys edit/model revisions. A unique query bypasses
// only C3; seq and the exact entity state still have to prove the accepted edit.
import { randomUUID } from 'node:crypto';
export const EDIT_OBSERVATION_BOUND_MS = 3000; // hot C3 TTL 2000ms + 1000ms observation budget
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function observeEdit({ entity, present, ...options }) {
  return observeChange({ ...options, cacheBust: 'e1-edit',
    select: body => ({ entitiesValid: Array.isArray(body.entities),
      entities: Array.isArray(body.entities) ? body.entities.filter(e => e.id === entity.id || e.name === entity.name).map(e => ({ id: e.id, name: e.name })) : [] }),
    matchesState: sample => sample.entitiesValid && (present ? sample.entities.length === 1 && sample.entities[0].id === entity.id && sample.entities[0].name === entity.name : sample.entities.length === 0) });
}

export function observeWeather({ weather, ...options }) {
  return observeChange({ ...options, cacheBust: 'f1-weather', select: body => ({ weather: body.state?.weather ?? null }),
    matchesState: sample => sample.weather?.kind === weather.kind && sample.weather?.rain === weather.rain && sample.weather?.intensity === weather.intensity });
}

async function observeChange({ snapshotUrl, action, select, matchesState, cacheBust, fetchImpl = fetch,
  now = () => performance.now(), sleep = pause, pageErrors = () => [] }) {
  const startedAtMs = now(), ack = await action(), ackAtMs = now();
  const deadline = ackAtMs + EDIT_OBSERVATION_BOUND_MS;
  const report = { startedAtMs, ackAtMs, boundMs: EDIT_OBSERVATION_BOUND_MS, ack,
    firstSameUrl: null, immediateAuthoritative: null, convergence: [], pageErrors: [] };
  const accepted = ack.status === 200 && ack.body?.accepted === true && Number.isSafeInteger(ack.body.seq) && ack.body.seq >= 0;
  const read = async url => {
    const atMs = now();
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(Math.max(1, Math.ceil(deadline - now()))) });
      const body = await response.json();
      return { atMs, endedAtMs: now(), status: response.status, seq: body.seq ?? null,
        cache: response.headers.get('x-sim-cache'), age: response.headers.get('age'), cacheControl: response.headers.get('cache-control'),
        ...select(body) };
    } catch (error) { return { atMs, endedAtMs: now(), error: String(error) }; }
  };
  const matches = sample => sample.status === 200 && Number.isSafeInteger(sample.seq) && sample.seq >= ack.body.seq &&
    matchesState(sample);
  if (accepted) {
    const unique = new URL(snapshotUrl); unique.searchParams.set(cacheBust, randomUUID());
    // Preserve both first responses before polling or screenshots; no later read repairs
    // an immediate authoritative failure. A unique-URL MISS is not an assertion by itself.
    [report.firstSameUrl, report.immediateAuthoritative] = await Promise.all([read(snapshotUrl), read(unique.href)]);
    let current = report.firstSameUrl;
    while (!matches(current) && now() < deadline) {
      await sleep(Math.min(100, deadline - now()));
      if (now() >= deadline) break;
      current = await read(snapshotUrl); report.convergence.push(current);
    }
    report.authoritativeOk = report.immediateAuthoritative.cache === 'miss' && matches(report.immediateAuthoritative) && report.immediateAuthoritative.endedAtMs <= deadline;
    report.converged = matches(current) && current.endedAtMs <= deadline;
    report.convergedAfterAckMs = report.converged ? current.endedAtMs - ackAtMs : null;
  } else { report.authoritativeOk = false; report.converged = false; report.convergedAfterAckMs = null; }
  report.pageErrors = [...pageErrors()];
  report.ok = accepted && report.authoritativeOk && report.converged && report.pageErrors.length === 0;
  return report;
}
