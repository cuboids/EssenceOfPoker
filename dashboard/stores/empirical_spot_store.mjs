/**
 * @typedef {{ ok: true, value?: any, data?: any } | { ok: false, reason?: string, error?: unknown, data?: any }} StoreResult
 */

/**
 * @param {{
 *   readSpot?: (request: any) => Promise<StoreResult>,
 *   readHealth?: () => Promise<any>,
 *   requestForAction?: (action: any) => any,
 *   onLoadingChange?: () => void,
 *   onUpdated?: () => void,
 * }} [options]
 */
export function createEmpiricalSpotStore({
  readSpot,
  readHealth,
  requestForAction,
  onLoadingChange = () => {},
  onUpdated = () => {},
} = {}) {
  const cache = new Map();
  const misses = new Map();
  const loads = new Set();
  let health = null;

  async function hydrateHealth() {
    health = readHealth ? await readHealth() : null;
    onUpdated();
    return health;
  }

  function clearMisses() {
    misses.clear();
  }

  function summary(actions = []) {
    const requests = actions.map(requestForAction).filter(Boolean);
    const keys = new Set(requests.map(empiricalSpotCacheKey));
    let ready = 0;
    let missed = 0;
    const reasons = {};
    for (const key of keys) {
      if (cache.has(key)) {
        ready += 1;
      } else if (misses.has(key)) {
        missed += 1;
        const reason = misses.get(key)?.reason || "missing";
        reasons[reason] = (reasons[reason] || 0) + 1;
      }
    }
    return { total: keys.size, ready, misses: missed, pending: isLoading(), reasons };
  }

  function status(actions = []) {
    if (isLoading()) {
      return "pending";
    }
    if (!health) {
      return "pending";
    }
    if (!health?.data?.empiricalCalibration?.ok) {
      return "fallback";
    }
    const actionSummary = summary(actions);
    if (!actionSummary.total) {
      return "ready";
    }
    if (actionSummary.ready === actionSummary.total) {
      return "ready";
    }
    return actionSummary.misses ? "fallback" : "pending";
  }

  function evidenceForAction(action) {
    const request = requestForAction?.(action);
    if (!request) {
      return { status: "fallback", reason: "disabled" };
    }
    const key = empiricalSpotCacheKey(request);
    if (cache.has(key)) {
      return { status: "ready", payload: cache.get(key), request };
    }
    if (misses.has(key)) {
      return { status: "fallback", request, ...misses.get(key) };
    }
    return { status: "pending", request };
  }

  function spotsForActions(actions = []) {
    const spots = {};
    for (const action of actions) {
      const request = requestForAction?.(action);
      if (!request) {
        continue;
      }
      const payload = cache.get(empiricalSpotCacheKey(request));
      if (payload) {
        spots[action.id] = payload;
      }
    }
    return spots;
  }

  function evidenceForRange(range, actions = []) {
    const entry = [...(range?.history || [])].reverse().find((candidate) => candidate.empirical);
    if (!entry) {
      return actions.length
        ? { status: "fallback", message: "Waiting for empirical evidence or using heuristic fallback." }
        : { status: "idle", message: "No action history yet." };
    }
    const visibleSpots = spotsForActions(actions);
    const payload = (
      (entry.action?.id ? visibleSpots[entry.action.id] : null) ||
      (entry.request ? cache.get(empiricalSpotCacheKey(entry.request)) : null)
    );
    if (!payload) {
      if (entry.action?.id) {
        const actionEvidence = evidenceForAction(entry.action);
        if (actionEvidence.status === "pending") {
          return { status: "pending", message: "Empirical evidence is loading.", request: actionEvidence.request };
        }
        if (actionEvidence.status === "fallback" && actionEvidence.request) {
          return {
            status: "fallback",
            message: "Empirical evidence is unavailable for this exact spot.",
            request: actionEvidence.request,
            reason: actionEvidence.reason || "missing",
            error: actionEvidence.error,
          };
        }
      }
      const key = entry.request ? empiricalSpotCacheKey(entry.request) : null;
      if (key && misses.has(key)) {
        return {
          status: "fallback",
          message: "Empirical evidence is unavailable for this exact spot.",
          request: entry.request,
          ...misses.get(key),
        };
      }
      return key && loads.has(key)
        ? { status: "pending", message: "Empirical evidence is loading.", request: entry.request }
        : { status: "fallback", message: "Empirical evidence is unavailable for this exact spot.", request: entry.request };
    }
    return { status: "ready", request: entry.request, payload };
  }

  function ensureForActions(actions = []) {
    if (!readSpot || !actions.length) {
      return false;
    }
    const missing = [];
    for (const action of actions) {
      const request = requestForAction?.(action);
      if (!request) {
        continue;
      }
      const key = empiricalSpotCacheKey(request);
      if (!cache.has(key) && !misses.has(key) && !loads.has(key)) {
        missing.push({ key, request });
      }
    }
    if (!missing.length) {
      return false;
    }
    for (const { key } of missing) {
      loads.add(key);
    }
    onLoadingChange();
    Promise.all(missing.map(async ({ key, request }) => {
      const payload = await readSpot(request);
      const normalized = normalizeSpotReadResult(payload);
      if (normalized.ok) {
        cache.set(key, normalized.payload);
      } else {
        misses.set(key, normalized.miss);
      }
      loads.delete(key);
    })).then(onUpdated).catch(() => {
      for (const { key } of missing) {
        loads.delete(key);
        misses.set(key, { reason: "network_error" });
      }
      onUpdated();
    });
    return true;
  }

  function isLoading() {
    return loads.size > 0;
  }

  return {
    cache,
    misses,
    loads,
    get health() {
      return health;
    },
    hydrateHealth,
    clearMisses,
    summary,
    status,
    evidenceForAction,
    evidenceForRange,
    spotsForActions,
    ensureForActions,
    isLoading,
  };
}

function normalizeSpotReadResult(result) {
  if (result?.ok === true && result.value?.ok === true) {
    return { ok: true, payload: result.value };
  }
  if (result?.ok === true) {
    return { ok: true, payload: result };
  }
  if (result && result.ok === false) {
    return {
      ok: false,
      miss: {
        reason: empiricalMissReason(result),
        error: result.error,
        statusCode: result.status,
      },
    };
  }
  return { ok: false, miss: { reason: "missing" } };
}

function empiricalMissReason(result) {
  if (result.reason === "validation") {
    return "incompatible";
  }
  if (result.reason === "network") {
    return "network_error";
  }
  if (result.status === 404 || result.reason === "payload") {
    return "missing";
  }
  return result.reason || "unavailable";
}

export function empiricalSpotCacheKey(request) {
  return [
    request.street,
    request.position,
    request.playerCount,
    request.stakeBucket,
    request.yearBucket,
    request.facingAggression ? 1 : 0,
    request.amountBucket,
  ].join("|");
}

export function empiricalStatusLabel(status) {
  if (status === "ready") {
    return "Empirical";
  }
  if (status === "pending") {
    return "Loading";
  }
  if (status === "idle") {
    return "Idle";
  }
  return "Fallback";
}
