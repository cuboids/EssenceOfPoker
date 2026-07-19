/**
 * @param {{
 *   setTimeoutRef?: typeof globalThis.setTimeout,
 *   clearTimeoutRef?: typeof globalThis.clearTimeout,
 *   onError?: (failure: { key: string, error: unknown, at: string }) => void,
 * }} [options]
 */
export function createAsyncJobRunner({ setTimeoutRef = globalThis.setTimeout, clearTimeoutRef = globalThis.clearTimeout, onError = () => {} } = {}) {
  /** @type {Map<string, { timeoutId: ReturnType<typeof globalThis.setTimeout>, guard: { isCurrent: () => boolean } | null }>} */
  const jobs = new Map();

  /**
   * @param {{
   *   key: string,
   *   delayMs?: number,
   *   guard?: { isCurrent: () => boolean } | null,
   *   run: (guard: { isCurrent: () => boolean } | null) => unknown | Promise<unknown>,
   *   onStale?: ((guard: { isCurrent: () => boolean }) => void) | null,
   *   replace?: boolean,
   * }} job
   */
  function schedule({ key, delayMs = 0, guard = null, run, onStale = null, replace = false }) {
    if (!key || typeof run !== "function") {
      throw new Error("async job requires a key and run function");
    }
    if (jobs.has(key)) {
      if (!replace) {
        return false;
      }
      cancel(key);
    }
    const timeoutId = setTimeoutRef(async () => {
      jobs.delete(key);
      if (guard && !guard.isCurrent()) {
        if (onStale) {
          onStale(guard);
        }
        return;
      }
      try {
        await run(guard);
      } catch (error) {
        onError({ key, error, at: new Date().toISOString() });
      }
    }, delayMs);
    jobs.set(key, { timeoutId, guard });
    return true;
  }

  function isScheduled(key) {
    return jobs.has(key);
  }

  function cancel(key) {
    const job = jobs.get(key);
    if (!job) {
      return false;
    }
    clearTimeoutRef(job.timeoutId);
    jobs.delete(key);
    return true;
  }

  function cancelByPrefix(prefix) {
    let count = 0;
    for (const key of [...jobs.keys()]) {
      if (key.startsWith(prefix) && cancel(key)) {
        count += 1;
      }
    }
    return count;
  }

  function size() {
    return jobs.size;
  }

  return {
    cancel,
    cancelByPrefix,
    isScheduled,
    schedule,
    size,
  };
}
