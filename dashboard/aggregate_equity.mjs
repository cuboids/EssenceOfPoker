import { cardCompare } from "./cards.mjs";
import { preflopClassKeyForCards } from "./cache_keys.mjs";

export function handAggregateEquityVsVillain({ handState, equityCache, priorShare = 0.5 }) {
  if (!handState?.h1 || !handState?.h2) {
    return priorShare;
  }
  const [h1, h2] = [handState.h1, handState.h2].sort(cardCompare);
  const classKey = preflopClassKeyForCards(h1, h2);
  return equityCache?.classes?.[classKey] ?? priorShare;
}

export function handAggregateEquityIsEstimated({ handState, equityCache }) {
  return Boolean(handState?.h1 && handState?.h2 && equityCache?.exact === false);
}
