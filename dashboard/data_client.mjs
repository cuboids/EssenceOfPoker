export async function readPreflopHiddenVillainClass(classKey) {
  try {
    const response = await fetch(`api/data/preflop-hidden-villain/${encodeURIComponent(classKey)}`, { cache: "force-cache" });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export async function readPreflopAggregateClass(classKey) {
  try {
    const response = await fetch(`api/data/preflop-aggregate/${encodeURIComponent(classKey)}`, { cache: "force-cache" });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export async function readPreflopPrimaryClass(classKey) {
  try {
    const response = await fetch(`api/data/preflop-primary/${encodeURIComponent(classKey)}`, { cache: "force-cache" });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export async function readEmpiricalSpot(request) {
  try {
    const params = new URLSearchParams({
      street: request.street,
      position: request.position,
      playerCount: String(request.playerCount),
      stakeBucket: request.stakeBucket || "micro",
      yearBucket: request.yearBucket || "2009-2010",
      facingAggression: request.facingAggression ? "1" : "0",
      amountBucket: request.amountBucket || "none",
    });
    const response = await fetch(`api/calibration/empirical-spot?${params}`, { cache: "force-cache" });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return payload?.ok ? payload : null;
  } catch {
    return null;
  }
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
