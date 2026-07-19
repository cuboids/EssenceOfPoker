export const VERSION_REGISTRY = Object.freeze({
  cacheSchema: "cache-schema-v1",
  cacheFamilies: Object.freeze({
    winShareRunouts: "winshare-runouts-v2",
    multiwayEquity: "multiway-equity-v1",
  }),
  models: Object.freeze({
    rangeEngine: "range-engine-v1",
  }),
  generatedData: Object.freeze({
    empiricalBaselineTables: "empirical-baseline-tables-v1",
    empiricalSpotCache: "empirical-spot-cache-v1",
    preflopAggregateClasses: "preflop-aggregate-classes-v1",
    preflopHiddenVillainClasses: "preflop-hidden-villain-classes-v1",
    preflopPrimaryClasses: "preflop-primary-classes-v1",
    priorPortfolio: "prior-portfolio-v1",
    priorWinShares: "prior-win-shares-v1",
    preflopHandEquity: "preflop-hand-equity-v1",
  }),
});

export function cacheNamespace(dataVersion = "development") {
  return `${VERSION_REGISTRY.cacheSchema}:${dataVersion}`;
}

export function cacheFamilyVersion(family) {
  const version = VERSION_REGISTRY.cacheFamilies[family];
  if (!version) {
    throw new Error(`Unknown cache family: ${family}`);
  }
  return version;
}

export function generatedDataVersion(family) {
  const version = VERSION_REGISTRY.generatedData[family];
  if (!version) {
    throw new Error(`Unknown generated data family: ${family}`);
  }
  return version;
}
