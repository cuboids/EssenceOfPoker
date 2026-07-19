import { createEmpiricalSpotStore } from "./stores/empirical_spot_store.mjs";

/**
 * @param {{
 *   readSpot?: (request: any) => Promise<any>,
 *   readHealth?: () => Promise<any>,
 *   requestForAction?: (action: any) => any,
 *   onLoading?: () => void,
 *   onEvidenceChanged?: () => void,
 * }} [options]
 */
export function createEmpiricalEvidenceController({
  readSpot,
  readHealth,
  requestForAction,
  onLoading = () => {},
  onEvidenceChanged = () => {},
} = {}) {
  const store = createEmpiricalSpotStore({
    readSpot,
    readHealth,
    requestForAction,
    onLoadingChange: onLoading,
    onUpdated: onEvidenceChanged,
  });

  return {
    store,
    hydrateHealth: () => store.hydrateHealth(),
    clearMisses: () => store.clearMisses(),
    ensureForActions: (actions) => store.ensureForActions(actions),
    evidenceForAction: (action) => store.evidenceForAction(action),
    evidenceForRange: (range, actions) => store.evidenceForRange(range, actions),
    spotsForActions: (actions) => store.spotsForActions(actions),
    status: (actions) => store.status(actions),
    summary: (actions) => store.summary(actions),
    get health() {
      return store.health;
    },
  };
}
