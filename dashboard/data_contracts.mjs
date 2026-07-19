import { PROBABILITY_SPACES, assertProbabilitySpace } from "./probability_spaces.mjs";

const REQUIRED_PORTFOLIOS = Object.freeze(["hero", "villain"]);
const REQUIRED_AGGREGATES = Object.freeze(["AGG", "AGG_BOTH", "AGG_H1", "AGG_H2", "AGG_ZERO"]);

export function validateDashboardData(data) {
  assertObject(data, "dashboard data");
  assertPositiveInteger(data.bucketCount, "bucketCount");
  assertPositiveInteger(data.totalCombos, "totalCombos");
  assertArrayLength(data.curve, data.bucketCount, "curve");
  assertArrayLength(data.bucketKeys, data.bucketCount, "bucketKeys");
  assertArrayLength(data.categoryBands, 9, "categoryBands");
  assertObject(data.portfolios, "portfolios");

  for (const page of REQUIRED_PORTFOLIOS) {
    validatePortfolio(data.portfolios[page], page);
  }
  validatePriorAggregate(data.priorAggregate, data.bucketCount);
  return data;
}

export function validatePreflopAggregateCache(cache, { bucketCount, strictCounts = false } = {}) {
  assertObject(cache, "preflop aggregate cache");
  assertPositiveInteger(cache.totalCombos, "preflop aggregate totalCombos");
  assertObject(cache.classes, "preflop aggregate classes");
  if (Object.keys(cache.classes).length !== 169) {
    throw new Error(`preflop aggregate cache must contain 169 classes, got ${Object.keys(cache.classes).length}`);
  }

  for (const [classKey, aggregateCounts] of Object.entries(cache.classes)) {
    assertObject(aggregateCounts, `preflop aggregate class ${classKey}`);
    for (const code of REQUIRED_AGGREGATES.filter((aggregateCode) => aggregateCode !== "AGG_ZERO")) {
      assertTrimmedCounts(aggregateCounts[code], `${classKey}.${code}`, bucketCount, strictCounts ? cache.totalCombos : null);
    }
  }
  return cache;
}

export function validatePreflopAggregateClassPayload(payload, { bucketCount, strictCounts = false } = {}) {
  assertObject(payload, "preflop aggregate class payload");
  assertProbabilitySpace(payload, PROBABILITY_SPACES.HERO_PREFLOP_AGGREGATE);
  assertString(payload.source, "preflop aggregate class source");
  if (payload.exact !== true) {
    throw new Error("preflop aggregate class payload must be marked exact");
  }
  assertPositiveInteger(payload.totalCombos, "preflop aggregate class totalCombos");
  assertPositiveInteger(payload.bucketCount, "preflop aggregate class bucketCount");
  if (bucketCount != null && payload.bucketCount !== bucketCount) {
    throw new Error(`preflop aggregate class bucketCount ${payload.bucketCount} does not match ${bucketCount}`);
  }
  assertString(payload.classKey, "preflop aggregate class key");
  assertObject(payload.aggregates, "preflop aggregate class aggregates");
  for (const code of REQUIRED_AGGREGATES.filter((aggregateCode) => aggregateCode !== "AGG_ZERO")) {
    assertTrimmedCounts(payload.aggregates[code], `${payload.classKey}.${code}`, payload.bucketCount, strictCounts ? payload.totalCombos : null);
  }
  return payload;
}

export function validatePreflopPrimaryPriorCache(cache, { bucketCount, strictCounts = false } = {}) {
  assertObject(cache, "preflop primary prior cache");
  assertPositiveInteger(cache.totalCombos, "preflop primary prior totalCombos");
  if (cache.exact !== true) {
    throw new Error("preflop primary prior cache must be marked exact");
  }
  assertObject(cache.classes, "preflop primary prior classes");
  if (Object.keys(cache.classes).length !== 169) {
    throw new Error(`preflop primary prior cache must contain 169 classes, got ${Object.keys(cache.classes).length}`);
  }

  for (const [classKey, assetCounts] of Object.entries(cache.classes)) {
    assertObject(assetCounts, `preflop primary prior class ${classKey}`);
    if (Object.keys(assetCounts).length !== 21) {
      throw new Error(`${classKey} must contain 21 primary asset priors`);
    }
    for (const [assetCode, trimmedCounts] of Object.entries(assetCounts)) {
      assertTrimmedCounts(trimmedCounts, `${classKey}.${assetCode}`, bucketCount, strictCounts ? cache.totalCombos : null);
    }
  }
  return cache;
}

export function validatePreflopPrimaryClassPayload(payload, { bucketCount, strictCounts = false } = {}) {
  assertObject(payload, "preflop primary class payload");
  assertString(payload.source, "preflop primary class source");
  if (payload.exact !== true) {
    throw new Error("preflop primary class payload must be marked exact");
  }
  assertPositiveInteger(payload.totalCombos, "preflop primary class totalCombos");
  assertPositiveInteger(payload.bucketCount, "preflop primary class bucketCount");
  if (bucketCount != null && payload.bucketCount !== bucketCount) {
    throw new Error(`preflop primary class bucketCount ${payload.bucketCount} does not match ${bucketCount}`);
  }
  assertString(payload.classKey, "preflop primary class key");
  assertObject(payload.assets, "preflop primary class assets");
  if (Object.keys(payload.assets).length !== 21) {
    throw new Error(`${payload.classKey} must contain 21 primary asset priors`);
  }
  for (const [assetCode, trimmedCounts] of Object.entries(payload.assets)) {
    assertTrimmedCounts(trimmedCounts, `${payload.classKey}.${assetCode}`, payload.bucketCount, strictCounts ? payload.totalCombos : null);
  }
  return payload;
}

export function validatePriorWinShares(cache, { assetCount = 21 } = {}) {
  assertObject(cache, "prior win shares");
  assertPositiveInteger(cache.totalCombos, "prior win shares totalCombos");
  assertObject(cache.shares, "prior win shares shares");
  if (Object.keys(cache.shares).length !== assetCount) {
    throw new Error(`prior win shares must contain ${assetCount} shares`);
  }
  const shareTotal = Object.values(cache.shares).reduce((sum, share) => sum + assertProbability(share, "prior win share"), 0);
  if (Math.abs(shareTotal - 1) > 1e-9) {
    throw new Error(`prior win shares sum to ${shareTotal}, expected 1`);
  }
  assertObject(cache.aggregateMatchups, "prior aggregate matchups");
  assertProbability(cache.aggregateMatchups.AGG, "prior aggregate matchup AGG");
  assertProbability(cache.aggregateMatchups.RANGE_AGG, "prior aggregate matchup RANGE_AGG");
  return cache;
}

export function validatePreflopHiddenVillainCache(cache, { bucketCount, strictCounts = false } = {}) {
  assertObject(cache, "preflop hidden villain cache");
  assertObject(cache.classes, "preflop hidden villain classes");
  if (Object.keys(cache.classes).length !== 169) {
    throw new Error(`preflop hidden villain cache must contain 169 classes, got ${Object.keys(cache.classes).length}`);
  }
  for (const [classKey, curves] of Object.entries(cache.classes)) {
    assertObject(curves, `preflop hidden villain class ${classKey}`);
    for (const key of ["shared", "v1", "v2"]) {
      assertTrimmedCounts(curves[key], `${classKey}.${key}`, bucketCount, strictCounts ? curves[key]?.totalCombos : null);
    }
  }
  return cache;
}

export function validatePreflopHiddenVillainClassPayload(payload, { bucketCount, strictCounts = false } = {}) {
  assertObject(payload, "preflop hidden villain class payload");
  assertProbabilitySpace(payload, PROBABILITY_SPACES.HIDDEN_VILLAIN_PREFLOP_PRIMARY);
  assertString(payload.source, "preflop hidden villain class source");
  if (payload.exact !== true) {
    throw new Error("preflop hidden villain class payload must be marked exact");
  }
  assertPositiveInteger(payload.bucketCount, "preflop hidden villain class bucketCount");
  if (bucketCount != null && payload.bucketCount !== bucketCount) {
    throw new Error(`preflop hidden villain class bucketCount ${payload.bucketCount} does not match ${bucketCount}`);
  }
  assertString(payload.classKey, "preflop hidden villain class key");
  assertObject(payload.curves, "preflop hidden villain class curves");
  for (const key of ["shared", "v1", "v2"]) {
    assertTrimmedCounts(payload.curves[key], `${payload.classKey}.${key}`, payload.bucketCount, strictCounts ? payload.curves[key]?.totalCombos : null);
  }
  return payload;
}

export function validatePreflopHandEquityCache(cache) {
  assertObject(cache, "preflop hand equity cache");
  assertString(cache.source, "preflop hand equity source");
  if (cache.exact === true) {
    throw new Error("preflop hand equity cache is not generated by a proven exact equity engine yet");
  }
  assertPositiveInteger(cache.iterations, "preflop hand equity iterations");
  assertObject(cache.classes, "preflop hand equity classes");
  if (Object.keys(cache.classes).length !== 169) {
    throw new Error(`preflop hand equity cache must contain 169 classes, got ${Object.keys(cache.classes).length}`);
  }
  for (const [classKey, equity] of Object.entries(cache.classes)) {
    assertProbability(equity, `${classKey} equity`);
  }
  return cache;
}

function validatePortfolio(portfolio, page) {
  assertObject(portfolio, `${page} portfolio`);
  assertArrayLength(portfolio.assets, 21, `${page}.assets`);
  assertArrayLength(portfolio.aggregates, 5, `${page}.aggregates`);

  const assetCodes = new Set();
  for (const asset of portfolio.assets) {
    assertObject(asset, `${page} asset`);
    assertString(asset.code, `${page} asset code`);
    assertString(asset.category, `${page}.${asset.code}.category`);
    assertString(asset.name, `${page}.${asset.code}.name`);
    assertArray(asset.positions, `${page}.${asset.code}.positions`);
    assertPriorPayload(asset.prior, `${page}.${asset.code}.prior`);
    assetCodes.add(asset.code);
  }

  for (const aggregate of portfolio.aggregates) {
    assertObject(aggregate, `${page} aggregate`);
    assertString(aggregate.code, `${page} aggregate code`);
    if (!REQUIRED_AGGREGATES.includes(aggregate.code)) {
      throw new Error(`${page} aggregate has unknown code ${aggregate.code}`);
    }
    assertArray(aggregate.assetCodes, `${page}.${aggregate.code}.assetCodes`);
    for (const assetCode of aggregate.assetCodes) {
      if (!assetCodes.has(assetCode)) {
        throw new Error(`${page}.${aggregate.code} references unknown asset ${assetCode}`);
      }
    }
    assertPriorPayload(aggregate.prior, `${page}.${aggregate.code}.prior`);
  }
}

function validatePriorAggregate(priorAggregate, bucketCount) {
  assertObject(priorAggregate, "priorAggregate");
  assertPositiveInteger(priorAggregate.totalCombos, "priorAggregate.totalCombos");
  assertArrayLength(priorAggregate.counts, bucketCount + 1, "priorAggregate.counts");
  assertPositiveInteger(priorAggregate.bestGradation, "priorAggregate.bestGradation");
  assertPositiveInteger(priorAggregate.worstGradation, "priorAggregate.worstGradation");
}

function assertTrimmedCounts(trimmedCounts, label, bucketCount, expectedTotal = null) {
  assertObject(trimmedCounts, label);
  assertPositiveInteger(trimmedCounts.first, `${label}.first`);
  assertArray(trimmedCounts.counts, `${label}.counts`);
  if (trimmedCounts.first + trimmedCounts.counts.length - 1 > bucketCount) {
    throw new Error(`${label} extends beyond bucketCount`);
  }
  if (expectedTotal != null) {
    const total = trimmedCounts.counts.reduce((sum, count) => sum + count, 0);
    if (total !== expectedTotal) {
      throw new Error(`${label} counts sum to ${total}, expected ${expectedTotal}`);
    }
  }
}

function assertPriorPayload(prior, label) {
  assertObject(prior, label);
  assertPositiveInteger(prior.first, `${label}.first`);
  assertArray(prior.counts, `${label}.counts`);
  assertPositiveInteger(prior.totalCombos, `${label}.totalCombos`);
  assertPositiveInteger(prior.bestGradation, `${label}.bestGradation`);
  assertPositiveInteger(prior.worstGradation, `${label}.worstGradation`);
  const total = prior.counts.reduce((sum, count) => sum + count, 0);
  if (total !== prior.totalCombos) {
    throw new Error(`${label}.counts sum to ${total}, expected ${prior.totalCombos}`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

function assertArrayLength(value, length, label) {
  assertArray(value, label);
  if (value.length !== length) {
    throw new Error(`${label} must contain ${length} items, got ${value.length}`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertProbability(value, label) {
  if (typeof value !== "number" || value < 0 || value > 1) {
    throw new Error(`${label} must be a probability between 0 and 1`);
  }
  return value;
}
