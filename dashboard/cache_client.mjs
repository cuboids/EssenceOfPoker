export async function readApiCache(key) {
  try {
    const response = await fetch(`api/cache/${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export function writeApiCache(key, value) {
  fetch(`api/cache/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  }).catch(() => {});
}
