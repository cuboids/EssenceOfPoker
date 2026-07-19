/**
 * @typedef {{
 *   activePage?: string,
 *   actionMomentCache?: Map<string, any>,
 *   cardEditError?: string,
 *   currentCurves?: Record<string, any>,
 *   currentWinShares?: Record<string, any>,
 *   editingCardToken?: string | null,
 *   focusedAsset?: any,
 *   handModel?: any,
 *   handState?: any,
 *   handTimeline?: any[],
 *   playerActions?: any[],
 *   priorNaturalXMaps?: Record<string, any>,
 *   showdownHoleCardsByPlayer?: Record<string, any>,
 *   tableConfig?: any,
 *   viewedActionCount?: number | null,
 *   viewedStreetIndex?: number,
 *   villainShowdown?: boolean,
 *   visibleHandSnapshot?: any,
 * }} HandStatePatch
 *
 * @typedef {{
 *   type: string,
 *   patch?: HandStatePatch,
 *   effects?: string[],
 * }} HandTransaction
 */

export const HAND_EFFECTS = Object.freeze({
  BUMP_CURVE_TOKEN: "bumpCurveToken",
  RENDER_ASSETS: "renderAssets",
  RENDER_CACHED_STREET: "renderCachedStreet",
  RENDER_CALIBRATION_STATUS: "renderCalibrationStatus",
  RENDER_HOLDING: "renderHolding",
  RENDER_PORTFOLIO_TABS: "renderPortfolioTabs",
  RESET_WIN_SHARES: "resetWinShares",
  SYNC_HAND_STATE: "syncHandState",
  UPDATE_LEGEND: "updateLegend",
  UPDATE_PAGE_TABS: "updatePageTabs",
  UPDATE_ROUND_BUTTON: "updateRoundButton",
  UPDATE_STREET_NAV_BUTTONS: "updateStreetNavButtons",
});

/**
 * @param {{
 *   setters: Record<string, (value: any) => void>,
 *   effects?: Record<string, () => void>,
 * }} deps
 */
export function createHandTransactionDispatcher({ setters, effects = {} }) {
  function dispatch(transaction) {
    if (!transaction || typeof transaction !== "object") {
      throw new Error("hand transaction must be an object");
    }
    applyPatch(transaction.patch || {});
    for (const effect of transaction.effects || []) {
      const handler = effects[effect];
      if (!handler) {
        throw new Error(`unknown hand transaction effect: ${effect}`);
      }
      handler();
    }
    return transaction;
  }

  function applyPatch(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const setter = setters[key];
      if (!setter) {
        throw new Error(`unknown hand transaction patch key: ${key}`);
      }
      setter(value);
    }
  }

  return { dispatch };
}

export function handTransaction(type, { patch = {}, effects = [] } = {}) {
  return { type, patch, effects };
}
