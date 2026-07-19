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
