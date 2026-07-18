import { cardKey } from "./cards.mjs";

export const WIN_SHARE_CACHE_VERSION = "winshare-runouts-v2";

export function preflopClassKeyForCards(first, second) {
  if (first.rank === second.rank) {
    return `${first.rank}-${second.rank}-pair`;
  }
  return `${first.rank}-${second.rank}-${first.suit === second.suit ? "suited" : "offsuit"}`;
}

export function heroPreflopWinShareCacheKey(first, second) {
  return `${WIN_SHARE_CACHE_VERSION}:hero:preflop:${preflopClassKeyForCards(first, second)}`;
}

export function winShareCacheKey({ page, state, street = "hidden", isHeroPreflop = false, h1 = null, h2 = null }) {
  if (isHeroPreflop) {
    return heroPreflopWinShareCacheKey(h1, h2);
  }

  const stateKey = Object.entries(state)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([token, card]) => `${token}-${cardKey(card)}`)
    .join("|");
  return `${WIN_SHARE_CACHE_VERSION}:${page}:${street}:${stateKey}`;
}
