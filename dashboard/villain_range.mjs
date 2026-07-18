import { cardCompare, sameCard } from "./cards.mjs";
import { curveFromTrimmedCounts, distributionFor } from "./curve_distributions.mjs";
import { fiveCardIndex } from "./evaluation.mjs";
import { curveFromCounts } from "./portfolio_curves.mjs";

export function preflopHiddenA2CCurves({ assets, available, bucketCount, priorXByGradation, evaluateGradation }) {
  const sharedFiveUnknown = distributionFor([], available, bucketCount, priorXByGradation, evaluateGradation);
  const singleV1 = weightedPreflopSingleVillainCardDistribution({
    visibleToken: "V_1",
    available,
    bucketCount,
    priorXByGradation,
    evaluateGradation,
  });
  const singleV2 = weightedPreflopSingleVillainCardDistribution({
    visibleToken: "V_2",
    available,
    bucketCount,
    priorXByGradation,
    evaluateGradation,
  });

  return Object.fromEntries(
    assets.map((asset) => {
      const tokens = asset.name.split(" + ");
      const usesV1 = tokens.includes("V_1");
      const usesV2 = tokens.includes("V_2");
      if (usesV1 && !usesV2) {
        return [asset.code, singleV1];
      }
      if (usesV2 && !usesV1) {
        return [asset.code, singleV2];
      }
      return [asset.code, sharedFiveUnknown];
    }),
  );
}

export function curvesFromPreflopHiddenA2CCache({
  assets,
  aggregates = [],
  cachedClass,
  bucketCount,
  priorXByGradation,
}) {
  if (!cachedClass?.shared || !cachedClass?.v1 || !cachedClass?.v2) {
    return null;
  }

  const shared = curveFromTrimmedCounts(cachedClass.shared, cachedClass.shared.totalCombos, bucketCount, priorXByGradation);
  const v1 = curveFromTrimmedCounts(cachedClass.v1, cachedClass.v1.totalCombos, bucketCount, priorXByGradation);
  const v2 = curveFromTrimmedCounts(cachedClass.v2, cachedClass.v2.totalCombos, bucketCount, priorXByGradation);
  const curves = Object.fromEntries(
    assets.map((asset) => {
      const tokens = asset.name.split(" + ");
      const usesV1 = tokens.includes("V_1");
      const usesV2 = tokens.includes("V_2");
      if (usesV1 && !usesV2) {
        return [asset.code, v1];
      }
      if (usesV2 && !usesV1) {
        return [asset.code, v2];
      }
      return [asset.code, shared];
    }),
  );

  for (const aggregate of aggregates) {
    if (aggregate.code === "AGG_ZERO") {
      curves[aggregate.code] = shared;
    }
  }
  return curves;
}

export function hiddenA2CVillainCurves({
  assets,
  aggregates = [],
  available,
  knownBoardState,
  futureBoardTokens,
  bucketCount,
  priorXByGradation,
  chooseTable,
  evaluateGradation,
}) {
  const countsByCode = Object.fromEntries(
    [...assets, ...aggregates].map((asset) => [asset.code, new Uint32Array(bucketCount + 1)]),
  );
  const assetPlans = assets.map((asset) => ({
    asset,
    tokens: asset.name.split(" + "),
  }));
  const state = { ...knownBoardState };
  const futureBoardCards = [];
  const gradationCache = new Map();
  let totalCombos = 0;

  for (let firstIndex = 0; firstIndex < available.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < available.length; secondIndex += 1) {
      const [v1, v2] = [available[firstIndex], available[secondIndex]].sort(cardCompare);
      const futureBoardDeck = available.filter((card) => !sameCard(card, v1) && !sameCard(card, v2));
      state.V_1 = v1;
      state.V_2 = v2;

      visitFutureBoard(0, 0, futureBoardDeck, futureBoardTokens, futureBoardCards, state, () => {
        const gradationsByCode = {};
        for (const plan of assetPlans) {
          const cards = plan.tokens.map((token) => state[token]);
          const gradation = cachedEvaluateGradation(cards, gradationCache, chooseTable, evaluateGradation);
          gradationsByCode[plan.asset.code] = gradation;
          countsByCode[plan.asset.code][gradation] += 1;
        }
        for (const aggregate of aggregates) {
          const bestGradation = Math.min(...aggregate.assetCodes.map((assetCode) => gradationsByCode[assetCode]));
          countsByCode[aggregate.code][bestGradation] += 1;
        }
        totalCombos += 1;
      });
    }
  }

  return Object.fromEntries(
    [...assets, ...aggregates].map((asset) => [asset.code, curveFromCounts(countsByCode[asset.code], totalCombos, bucketCount, priorXByGradation)]),
  );
}

export function visitFutureBoard(start, depth, deck, tokens, selected, state, onRunout) {
  if (depth === tokens.length) {
    for (let index = 0; index < tokens.length; index += 1) {
      state[tokens[index]] = selected[index];
    }
    onRunout();
    for (const token of tokens) {
      delete state[token];
    }
    return;
  }

  const remainingNeeded = tokens.length - depth;
  for (let index = start; index <= deck.length - remainingNeeded; index += 1) {
    selected[depth] = deck[index];
    visitFutureBoard(index + 1, depth + 1, deck, tokens, selected, state, onRunout);
  }
}

export function weightedPreflopSingleVillainCardDistribution({
  visibleToken,
  available,
  bucketCount,
  priorXByGradation,
  evaluateGradation,
}) {
  const sortedAvailable = [...available].sort(cardCompare);
  const counts = new Uint32Array(bucketCount + 1);
  const selectedIndexes = [];
  let totalCombos = 0;

  function visit(start, depth) {
    if (depth === 5) {
      const cards = selectedIndexes.map((index) => sortedAvailable[index]);
      const weight = visibleToken === "V_1"
        ? selectedIndexes.reduce((total, cardIndex, position) => total + sortedAvailable.length - cardIndex - 1 - (4 - position), 0)
        : selectedIndexes.reduce((total, cardIndex, position) => total + cardIndex - position, 0);
      if (weight > 0) {
        counts[evaluateGradation(cards)] += weight;
        totalCombos += weight;
      }
      return;
    }

    const remainingNeeded = 5 - depth;
    for (let index = start; index <= sortedAvailable.length - remainingNeeded; index += 1) {
      selectedIndexes[depth] = index;
      visit(index + 1, depth + 1);
    }
  }

  visit(0, 0);
  return curveFromCounts(counts, totalCombos, bucketCount, priorXByGradation);
}

function cachedEvaluateGradation(cards, cache, chooseTable, evaluateGradation) {
  const cacheIndex = fiveCardIndex(cards, chooseTable);
  if (!cache.has(cacheIndex)) {
    cache.set(cacheIndex, evaluateGradation(cards));
  }
  return cache.get(cacheIndex);
}
