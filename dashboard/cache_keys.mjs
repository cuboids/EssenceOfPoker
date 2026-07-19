import { cardKey } from "./cards.mjs";
import { VERSION_REGISTRY, cacheFamilyVersion, cacheNamespace } from "./version_registry.mjs";

export { cacheNamespace };
export const WIN_SHARE_CACHE_VERSION = cacheFamilyVersion("winShareRunouts");
export const CACHE_KEY_SCHEMA_VERSION = VERSION_REGISTRY.cacheSchema;

export function preflopClassKeyForCards(first, second) {
  if (first.rank === second.rank) {
    return `${first.rank}-${second.rank}-pair`;
  }
  return `${first.rank}-${second.rank}-${first.suit === second.suit ? "suited" : "offsuit"}`;
}

export function heroPreflopWinShareCacheKey(first, second, { dataVersion = "development" } = {}) {
  return `${cacheNamespace(dataVersion)}:${WIN_SHARE_CACHE_VERSION}:hero:preflop:${preflopClassKeyForCards(first, second)}`;
}

export function winShareCacheKey({ page, state, street = "hidden", isHeroPreflop = false, h1 = null, h2 = null, dataVersion = "development" }) {
  if (isHeroPreflop) {
    return heroPreflopWinShareCacheKey(h1, h2, { dataVersion });
  }

  const stateKey = Object.entries(state)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([token, card]) => `${token}-${cardKey(card)}`)
    .join("|");
  return `${cacheNamespace(dataVersion)}:${WIN_SHARE_CACHE_VERSION}:${page}:${street}:${stateKey}`;
}
