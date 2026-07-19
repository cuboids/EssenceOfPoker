import { cardCompare, sameCard } from "./cards.mjs";
import { curveFromTrimmedCounts, distributionFor } from "./curve_distributions.mjs";
import { fiveCardIndex } from "./evaluation.mjs";
import { curveFromCounts } from "./portfolio_curves.mjs";

export const DEFAULT_RANGE_CURVE_SIMS = 5000;

export function preflopHiddenVillainCurves({ assets, available, bucketCount, priorXByGradation, evaluateGradation }) {
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

export function curvesFromPreflopHiddenVillainCache({
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

export function weightedRangeAssetCurves({
  assets,
  aggregates = [],
  range,
  available,
  knownBoardState = {},
  futureBoardTokens = [],
  holeTokens = ["V_1", "V_2"],
  bucketCount,
  priorXByGradation,
  chooseTable,
  evaluateGradation,
  nsims = DEFAULT_RANGE_CURVE_SIMS,
  seed = 1,
}) {
  const weightedCombos = validWeightedCombos(range, knownBoardState);
  if (!weightedCombos.length || nsims <= 0) {
    return null;
  }

  const countsByCode = Object.fromEntries(
    [...assets, ...aggregates].map((asset) => [asset.code, new Uint32Array(bucketCount + 1)]),
  );
  const assetPlans = assets.map((asset) => ({
    asset,
    tokens: asset.name.split(" + "),
  }));
  const sampleCombo = weightedComboSampler(weightedCombos);
  const random = mulberry32(seed >>> 0);
  const gradationCache = new Map();
  let totalSamples = 0;

  for (let sampleIndex = 0; sampleIndex < nsims; sampleIndex += 1) {
    const combo = sampleCombo(random());
    const deck = available.filter((card) => !combo.cards.some((comboCard) => sameCard(comboCard, card)));
    const boardState = sampledBoardState({
      deck,
      knownBoardState,
      futureBoardTokens,
      random,
    });
    if (!boardState) {
      continue;
    }

    const holeCards = [...combo.cards].sort(cardCompare);
    const state = {
      ...boardState,
      [holeTokens[0]]: holeCards[0],
      [holeTokens[1]]: holeCards[1],
    };
    const gradationsByCode = {};
    let completeSample = true;

    for (const plan of assetPlans) {
      const cards = plan.tokens.map((token) => state[token]);
      if (cards.some((card) => !card)) {
        completeSample = false;
        break;
      }
      const gradation = cachedEvaluateGradation(cards, gradationCache, chooseTable, evaluateGradation);
      gradationsByCode[plan.asset.code] = gradation;
      countsByCode[plan.asset.code][gradation] += 1;
    }
    if (!completeSample) {
      continue;
    }

    for (const aggregate of aggregates) {
      const values = aggregate.assetCodes
        .map((assetCode) => gradationsByCode[assetCode])
        .filter((gradation) => Number.isFinite(gradation));
      if (!values.length) {
        continue;
      }
      countsByCode[aggregate.code][Math.min(...values)] += 1;
    }
    totalSamples += 1;
  }

  if (totalSamples === 0) {
    return null;
  }

  return Object.fromEntries(
    [...assets, ...aggregates].map((asset) => [asset.code, curveFromCounts(countsByCode[asset.code], totalSamples, bucketCount, priorXByGradation)]),
  );
}

export function hiddenVillainCurves({
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

function validWeightedCombos(range, knownBoardState) {
  const boardCards = Object.values(knownBoardState || {}).filter(Boolean);
  return (range?.combos || [])
    .filter((combo) => combo.weight > 0)
    .filter((combo) => !combo.cards.some((comboCard) => boardCards.some((boardCard) => sameCard(comboCard, boardCard))));
}

function weightedComboSampler(combos) {
  const cumulative = [];
  let total = 0;
  for (const combo of combos) {
    total += combo.weight;
    cumulative.push(total);
  }
  return (roll) => {
    const target = roll * total;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (target < cumulative[middle]) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return combos[low];
  };
}

function sampledBoardState({ deck, knownBoardState, futureBoardTokens, random }) {
  const state = { ...knownBoardState };
  const uniqueTokens = futureBoardTokens.filter((token) => !state[token]);
  const drawCount = uniqueTokens.length;
  if (deck.length < drawCount) {
    return null;
  }
  const drawn = sampleCards(deck, drawCount, random);
  let cursor = 0;
  const flopTokens = uniqueTokens.filter((token) => token === "F_1" || token === "F_2" || token === "F_3");
  if (flopTokens.length) {
    const flopCards = drawn.slice(cursor, cursor + flopTokens.length).sort(cardCompare);
    const sortedFlopTokens = [...flopTokens].sort();
    for (let index = 0; index < sortedFlopTokens.length; index += 1) {
      state[sortedFlopTokens[index]] = flopCards[index];
    }
    cursor += flopTokens.length;
  }
  for (const token of uniqueTokens) {
    if (token === "F_1" || token === "F_2" || token === "F_3") {
      continue;
    }
    state[token] = drawn[cursor];
    cursor += 1;
  }
  return state;
}

function sampleCards(deck, count, random) {
  const pool = [...deck];
  const sample = [];
  for (let index = 0; index < count; index += 1) {
    const pick = Math.floor(random() * pool.length);
    sample.push(pool[pick]);
    pool[pick] = pool[pool.length - 1];
    pool.pop();
  }
  return sample;
}

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
