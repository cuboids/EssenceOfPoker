export async function readApiCache(key, { validator = null } = {}) {
  try {
    const response = await fetch(`api/cache/${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return validator ? validator(payload) : payload;
  } catch {
    return null;
  }
}

export function writeApiCache(key, value, { validator = null, shouldWrite = null } = {}) {
  if (shouldWrite && !shouldWrite()) {
    return;
  }
  let payload = value;
  try {
    payload = validator ? validator(value) : value;
  } catch {
    return;
  }
  if (shouldWrite && !shouldWrite()) {
    return;
  }
  fetch(`api/cache/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
