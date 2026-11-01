import { pageHidden } from '../poll-pace.ts';
/** One live request and one timer, shared by all views of the world's status. PERF-EDEN: every 8 s (was 4), and not at all
 *  while the page is hidden (the first visible tick after that reads at once). */
export function statusPoll<T>(read: () => Promise<T>, intervalMs = 8000) {
  const listeners = new Set<(value: T) => void>();
  let pending: Promise<T> | null = null;
  let latest: T;
  let hasValue = false;
  let readAt = -Infinity;
  let timer: ReturnType<typeof setInterval> | null = null;
  let generation = 0;

  const refresh = (): Promise<T> => {
    if (pending) return pending;
    const started = generation;
    readAt = Date.now();
    const request: Promise<T> = read().then((value) => {
      // An account switch must not publish an old owner's result, including
      // through a caller awaiting refresh() directly.
      if (started !== generation) return latest;
      latest = value; hasValue = true;
      for (const listener of listeners) listener(value);
      return value;
    }).finally(() => { if (pending === request) pending = null; });
    pending = request;
    return request;
  };
  let skipped = false;
  const poll = () => { if (pageHidden()) { skipped = true; return; } skipped = false; void refresh().catch(() => {}); };
  const onVisible = () => { if (skipped && !pageHidden() && listeners.size) poll(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  const subscribe = (listener: (value: T) => void) => {
    listeners.add(listener);
    if (hasValue) listener(latest);
    if (listeners.size === 1) {
      // The shell may already have fetched the name before its two panels mount.
      if (!hasValue || Date.now() - readAt >= intervalMs) poll();
      timer = setInterval(poll, intervalMs);
    }
    return () => {
      listeners.delete(listener);
      if (!listeners.size && timer !== null) { clearInterval(timer); timer = null; }
    };
  };
  const reset = (value: T) => {
    generation++; pending = null; latest = value; hasValue = true; readAt = -Infinity;
    for (const listener of listeners) listener(value);
    if (listeners.size) poll();
  };
  return { refresh, subscribe, reset };
}
