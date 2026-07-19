import {
  AGGREGATE_INDEX_GROUPS,
  aggregateGradationsForSevenCards,
  curveFromCounts,
} from "./portfolio_curves.mjs";

export function curvesForKnownAssets({
  assets,
  aggregates = [],
  remainingDeck,
  knownCardsForAsset,
  knownState = null,
  aggregateTokens = [],
  bucketCount,
  priorXByGradation,
  evaluateGradation,
  preflopPrimaryCache = null,
  preflopAggregateCache = null,
  preflopClassKey = null,
  aggregateIndexGroups = AGGREGATE_INDEX_GROUPS,
}) {
  const curves = {};
  const cache = new Map();
  for (const asset of assets) {
    if (preflopPrimaryCache?.[asset.code]) {
      curves[asset.code] = curveFromTrimmedCounts(
        preflopPrimaryCache[asset.code],
        preflopPrimaryCache[asset.code].totalCombos,
        bucketCount,
        priorXByGradation,
      );
      continue;
    }
    const knownCards = knownCardsForAsset(asset);
    const cacheKey = knownCards.map((card) => `${card.rank}:${card.suit}`).sort().join("|");
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, distributionFor(knownCards, remainingDeck, bucketCount, priorXByGradation, evaluateGradation));
    }
    curves[asset.code] = cache.get(cacheKey);
  }

  addAggregateCurves({
    curves,
    aggregates,
    remainingDeck,
    knownState,
    aggregateTokens,
    bucketCount,
    priorXByGradation,
    evaluateGradation,
    preflopAggregateCache,
    preflopClassKey,
    aggregateIndexGroups,
  });
  return curves;
}

export function addAggregateCurves({
  curves,
  aggregates = [],
  remainingDeck,
  knownState,
  aggregateTokens,
  bucketCount,
  priorXByGradation,
  evaluateGradation,
  preflopAggregateCache = null,
  preflopClassKey = null,
  aggregateIndexGroups = AGGREGATE_INDEX_GROUPS,
}) {
  if (!aggregates.length || !knownState) {
    return;
  }
  if (preflopAggregateCache && preflopClassKey) {
    addCachedPreflopAggregateCurves(curves, aggregates, preflopAggregateCache, preflopClassKey, bucketCount, priorXByGradation);
    return;
  }

  const countsByCode = Object.fromEntries(
    aggregates.map((aggregate) => [aggregate.code, new Uint32Array(bucketCount + 1)]),
  );
  const missingTokens = aggregateTokens.filter((token) => !knownState[token]);
  const missingIndexes = missingTokens.map((token) => aggregateTokens.indexOf(token));
  const selected = [];
  let totalCombos = 0;

  function visit(start, depth) {
    if (depth === missingTokens.length) {
      const completedCards = [];
      for (let index = 0; index < aggregateTokens.length; index += 1) {
        completedCards[index] = knownState[aggregateTokens[index]];
      }
      for (let index = 0; index < missingTokens.length; index += 1) {
        completedCards[missingIndexes[index]] = selected[index];
      }
      const aggregateGradations = aggregateGradationsForSevenCards(completedCards, aggregateIndexGroups, bucketCount, evaluateGradation);
      for (const aggregate of aggregates) {
        countsByCode[aggregate.code][aggregateGradations[aggregate.code]] += 1;
      }
      totalCombos += 1;
      return;
    }

    const remainingNeeded = missingTokens.length - depth;
    for (let index = start; index <= remainingDeck.length - remainingNeeded; index += 1) {
      selected[depth] = remainingDeck[index];
      visit(index + 1, depth + 1);
    }
  }

  visit(0, 0);
  for (const aggregate of aggregates) {
    curves[aggregate.code] = curveFromCounts(countsByCode[aggregate.code], totalCombos, bucketCount, priorXByGradation);
  }
}

export function addCachedPreflopAggregateCurves(curves, aggregates, preflopAggregateCache, preflopClassKey, bucketCount, priorXByGradation) {
  const cachedClass = preflopAggregateCache.classes[preflopClassKey];
  if (!cachedClass) {
    return;
  }
  for (const aggregate of aggregates) {
    if (cachedClass[aggregate.code]) {
      curves[aggregate.code] = curveFromTrimmedCounts(
        cachedClass[aggregate.code],
        preflopAggregateCache.totalCombos,
        bucketCount,
        priorXByGradation,
      );
    } else if (aggregate.code === "AGG_ZERO") {
      curves[aggregate.code] = curves["1.1"];
    }
  }
}

export function curveFromTrimmedCounts(trimmedCounts, totalCombos, bucketCount, priorXByGradation) {
  const curve = [];
  let cumulative = 0;
  let bestGradation = null;
  let worstGradation = null;
  for (let gradation = 1; gradation <= bucketCount; gradation += 1) {
    const index = gradation - trimmedCounts.first;
    const count = index >= 0 && index < trimmedCounts.counts.length ? trimmedCounts.counts[index] : 0;
    if (count > 0) {
      bestGradation = bestGradation ?? gradation;
      worstGradation = gradation;
    }
    cumulative += count;
    curve.push({
      gradation,
      probability: cumulative / totalCombos,
      x: priorXByGradation.get(gradation),
    });
  }
  return { curve, totalCombos, bestGradation, worstGradation };
}

export function distributionFor(knownCards, remainingDeck, bucketCount, priorXByGradation, evaluateGradation) {
  const counts = new Uint32Array(bucketCount + 1);
  const drawCount = 5 - knownCards.length;
  let totalCombos = 0;

  accumulateDistributionCounts(knownCards, remainingDeck, drawCount, counts, evaluateGradation, () => {
    totalCombos += 1;
  });

  return curveFromCounts(counts, totalCombos, bucketCount, priorXByGradation);
}

export function accumulateDistributionCounts(knownCards, remainingDeck, drawCount, counts, evaluateGradation, onCombo = () => {}) {
  const selected = [];

  function visit(start, depth) {
    if (depth === drawCount) {
      const gradation = evaluateGradation(knownCards.concat(selected));
      counts[gradation] += 1;
      onCombo();
      return;
    }

    const remainingNeeded = drawCount - depth;
    for (let index = start; index <= remainingDeck.length - remainingNeeded; index += 1) {
      selected[depth] = remainingDeck[index];
      visit(index + 1, depth + 1);
    }
  }

  visit(0, 0);
}
