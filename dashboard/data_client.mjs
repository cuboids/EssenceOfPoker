import { validateEmpiricalSpotPayload } from "./data_contracts.mjs";

export async function readPreflopHiddenVillainClass(classKey) {
  const result = await readPreflopHiddenVillainClassResult(classKey);
  return result.ok ? result.value : null;
}

export function readPreflopHiddenVillainClassResult(classKey) {
  return readJsonResult(`api/data/preflop-hidden-villain/${encodeURIComponent(classKey)}`, { cache: "force-cache" });
}

export async function readPreflopAggregateClass(classKey) {
  const result = await readPreflopAggregateClassResult(classKey);
  return result.ok ? result.value : null;
}

export function readPreflopAggregateClassResult(classKey) {
  return readJsonResult(`api/data/preflop-aggregate/${encodeURIComponent(classKey)}`, { cache: "force-cache" });
}

export async function readPreflopPrimaryClass(classKey) {
  const result = await readPreflopPrimaryClassResult(classKey);
  return result.ok ? result.value : null;
}

export function readPreflopPrimaryClassResult(classKey) {
  return readJsonResult(`api/data/preflop-primary/${encodeURIComponent(classKey)}`, { cache: "force-cache" });
}

export async function readEmpiricalSpot(request) {
  const result = await readEmpiricalSpotResult(request);
  return result.ok && result.value?.ok ? result.value : null;
}

export async function readEmpiricalSpotResult(request) {
  const params = new URLSearchParams({
    street: request.street,
    position: request.position,
    playerCount: String(request.playerCount),
    stakeBucket: request.stakeBucket || "micro",
    yearBucket: request.yearBucket || "2009-2010",
    facingAggression: request.facingAggression ? "1" : "0",
    amountBucket: request.amountBucket || "none",
  });
  const result = await readJsonResult(`api/calibration/empirical-spot?${params}`, { cache: "force-cache" });
  if (!result.ok || result.value?.ok) {
    if (!result.ok) {
      return result;
    }
    try {
      return { ...result, value: validateEmpiricalSpotPayload(result.value) };
    } catch (error) {
      return {
        ok: false,
        status: result.status,
        reason: "validation",
        error: error?.message || "Empirical spot payload validation failed.",
        value: result.value,
      };
    }
  }
  return {
    ok: false,
    status: result.status,
    reason: "payload",
    error: result.value?.error || "Empirical spot payload is unavailable.",
    value: result.value,
  };
}

export async function readHealth() {
  try {
    const response = await fetch("api/health", { cache: "no-store" });
    if (!response.ok) {
      return {
        ok: false,
        error: await responseErrorMessage(response, "Dashboard health check failed."),
      };
    }
    return await response.json();
  } catch (error) {
    return {
      ok: false,
      error: `Cannot reach the dashboard server${error?.message ? `: ${error.message}` : "."}`,
    };
  }
}

export async function readRandomInterestingHand() {
  try {
    const response = await fetch("api/interesting-hands/random", { cache: "no-store" });
    if (!response.ok) {
      return {
        ok: false,
        error: await responseErrorMessage(response, "No dashboard-compatible interesting hand is available."),
      };
    }
    const payload = await response.json();
    return payload?.ok ? payload : { ok: false, error: payload?.error || "No dashboard-compatible interesting hand is available." };
  } catch (error) {
    return {
      ok: false,
      error: `Cannot reach the dashboard server${error?.message ? `: ${error.message}` : "."}`,
    };
  }
}

async function responseErrorMessage(response, fallback) {
  try {
    const payload = await response.json();
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
}

async function readJsonResult(url, options = {}) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: response.status === 404 ? "miss" : "http",
        error: await responseErrorMessage(response, response.statusText || `HTTP ${response.status}`),
      };
    }
    return {
      ok: true,
      status: response.status,
      value: await response.json(),
    };
  } catch (error) {
    return {
      ok: false,
      reason: "network",
      error: error?.message || "Dashboard data request failed.",
    };
  }
}
