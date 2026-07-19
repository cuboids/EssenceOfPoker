import { createHandEvaluator } from "./evaluation.mjs";
import {
  validateDashboardData,
  validatePreflopHandEquityCache,
  validatePriorWinShares,
} from "./data_contracts.mjs";

export async function loadDashboardBootstrap({ assetVersion, fetchRef = globalThis.fetch }) {
  const [dashboardData, priorWinShares, preflopHandEquityCache] = await Promise.all([
    fetchRef(`data/prior_portfolio.json?v=${assetVersion}`).then((response) => response.json()),
    fetchRef(`data/prior_win_shares.json?v=${assetVersion}`).then((response) => response.json()),
    fetchRef(`data/preflop_hand_equity_cache.json?v=${assetVersion}`).then((response) => response.json()),
  ]);
  validateDashboardData(dashboardData);
  validatePriorWinShares(priorWinShares);
  validatePreflopHandEquityCache(preflopHandEquityCache);

  const bucketLookup = new Map(dashboardData.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
  const handEvaluator = createHandEvaluator(bucketLookup, dashboardData.bucketCount);
  const priorXByGradation = new Map(dashboardData.curve.map((point) => [point.gradation, point.x]));
  const aggregatePriorXByGradation = aggregatePriorXMap(dashboardData, priorXByGradation);
  dashboardData.priorWinShares = priorWinShares;

  return {
    dashboardData,
    priorWinShares,
    preflopHandEquityCache,
    bucketLookup,
    handEvaluator,
    priorXByGradation,
    aggregatePriorXByGradation,
  };
}

export function aggregatePriorXMap(data, fallbackPriorXByGradation) {
  const lookup = new Map();
  const aggregate = data.priorAggregate;
  if (!aggregate?.counts || !aggregate.totalCombos) {
    return fallbackPriorXByGradation;
  }

  let cumulative = 0;
  for (let gradation = 1; gradation <= data.bucketCount; gradation += 1) {
    cumulative += aggregate.counts[gradation] || 0;
    lookup.set(gradation, cumulative / aggregate.totalCombos);
  }
  return lookup;
}
