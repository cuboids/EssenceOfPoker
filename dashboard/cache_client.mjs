export async function readApiCache(key, { validator = null } = {}) {
  const result = await readApiCacheResult(key, { validator });
  return result.ok ? result.value : null;
}

export async function readApiCacheResult(key, { validator = null } = {}) {
  try {
    const response = await fetch(`api/cache/${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: response.status === 404 ? "miss" : "http",
        error: response.statusText || `HTTP ${response.status}`,
      };
    }
    const payload = await response.json();
    try {
      return {
        ok: true,
        value: validator ? validator(payload) : payload,
        status: response.status,
      };
    } catch (error) {
      return {
        ok: false,
        status: response.status,
        reason: "validation",
        error: error?.message || "cache payload validation failed",
      };
    }
  } catch (error) {
    return {
      ok: false,
      reason: "network",
      error: error?.message || "cache request failed",
    };
  }
}

export function writeApiCache(key, value, { validator = null, shouldWrite = null } = {}) {
  void writeApiCacheResult(key, value, { validator, shouldWrite });
}

export async function writeApiCacheResult(key, value, { validator = null, shouldWrite = null } = {}) {
  if (shouldWrite && !shouldWrite()) {
    return { ok: false, reason: "cancelled", error: "cache write cancelled before validation" };
  }
  let payload = value;
  try {
    payload = validator ? validator(value) : value;
  } catch (error) {
    return {
      ok: false,
      reason: "validation",
      error: error?.message || "cache payload validation failed",
    };
  }
  if (shouldWrite && !shouldWrite()) {
    return { ok: false, reason: "cancelled", error: "cache write cancelled before request" };
  }
  try {
    const response = await fetch(`api/cache/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: "http",
        error: response.statusText || `HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      status: response.status,
      value: await response.json().catch(() => null),
    };
  } catch (error) {
    return {
      ok: false,
      reason: "network",
      error: error?.message || "cache write failed",
    };
  }
}
