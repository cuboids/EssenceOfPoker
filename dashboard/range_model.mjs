import { preflopComboScore } from "./range_features.mjs";
import { empiricalActionProbability, empiricalTargetFrequency } from "./empirical_range_model.mjs";
import { DEFAULT_PREFLOP_RANGE_MODEL } from "./range_model_defaults.mjs";
import { rangeModelMetadata } from "./range_model_metadata.mjs";
import { legalTwoCardCombos } from "./range_universe.mjs";

export { DEFAULT_PREFLOP_RANGE_MODEL };

/**
 * @param {{player?: string, position?: string, deadCards?: any[], profile?: any}} [options]
 */
export function createUniformPreflopRange({ player, position, deadCards = [], profile = {} } = {}) {
  const combos = legalTwoCardCombos({ deadCards }).map((combo) => ({
    ...combo,
    weight: 1,
    score: preflopComboScore(combo, profile),
  }));
  return summarizeRange({
    player,
    position,
    combos,
    modelMetadata: rangeModelMetadata({ source: "uniform", model: DEFAULT_PREFLOP_RANGE_MODEL }),
  });
}

/**
 * @param {any} range
 * @param {any} action
 * @param {any} [context]
 */
export function updatePreflopRangeForAction(range, action, context = {}) {
  return updateRangeForAction(range, action, context);
}

/**
 * @param {any} range
 * @param {any} action
 * @param {any} [context]
 */
export function updateRangeForAction(range, action, context = {}) {
  const model = context.model || DEFAULT_PREFLOP_RANGE_MODEL;
  const position = context.position || range.position;
  if (context.empiricalSpot?.handClasses) {
    return updateRangeWithEmpiricalSpot(range, action, context.empiricalSpot, { ...context, position, model });
  }
  const targetFrequency = targetFrequencyForAction(action, { ...context, position, model });
  if (targetFrequency == null) {
    return range;
  }
  const scoredCombos = range.combos.map((combo) => ({
    ...combo,
    actionScore: actionScoreForCombo(combo, action, context),
  }));
  const softness = action.street === "preflop" ? model.softness : model.postflopSoftness;
  const threshold = thresholdForTarget(scoredCombos, targetFrequency, softness, "actionScore");
  const nextCombos = range.combos.map((combo) => {
    const score = actionScoreForCombo(combo, action, context);
    const continueProbability = logistic((score - threshold) / softness);
    const likelihood = action.type === "fold" ? 1 - continueProbability : continueProbability;
    return { ...combo, weight: combo.weight * clampProbability(likelihood) };
  });
  return summarizeRange({
    player: range.player,
    position: range.position,
    combos: nextCombos,
    modelMetadata: rangeModelMetadata({ source: "heuristic", model, action }),
    history: [
      ...(range.history || []),
      {
        action,
        targetFrequency,
        threshold,
        modelMetadata: rangeModelMetadata({ source: "heuristic", model, action }),
      },
    ],
  });
}

/**
 * @param {any} range
 * @param {any} action
 * @param {any} empiricalSpot
 * @param {any} [context]
 */
function updateRangeWithEmpiricalSpot(range, action, empiricalSpot, context = {}) {
  const model = context.model || DEFAULT_PREFLOP_RANGE_MODEL;
  const profile = context.profile || {};
  const targetFrequency = targetFrequencyForAction(action, { ...context, model, empiricalSpot });
  const scoredCombos = range.combos.map((combo) => {
    const actionScore = empiricalAdjustedActionScore(combo, action, empiricalSpot, { model, profile, context });
    return { ...combo, actionScore };
  });
  const nextCombos = targetFrequency == null
    ? range.combos.map((combo) => {
      const likelihood = empiricalActionProbability(empiricalSpot, combo.classKey, action.type, { profile });
      return { ...combo, weight: combo.weight * (likelihood == null ? 1 : likelihood) };
    })
    : (() => {
      const threshold = thresholdForTarget(scoredCombos, targetFrequency, model.softness, "actionScore");
      return range.combos.map((combo, index) => {
        const continueProbability = logistic((scoredCombos[index].actionScore - threshold) / model.softness);
        const likelihood = action.type === "fold" ? 1 - continueProbability : continueProbability;
        return { ...combo, weight: combo.weight * clampProbability(likelihood) };
      });
    })();
  return summarizeRange({
    player: range.player,
    position: range.position,
    combos: nextCombos,
    modelMetadata: rangeModelMetadata({ source: "empirical", model, empiricalSpot, action }),
    history: [
      ...(range.history || []),
      {
        action,
        empirical: true,
        request: empiricalSpot.request || null,
        targetFrequency,
        modelMetadata: rangeModelMetadata({ source: "empirical", model, empiricalSpot, action }),
      },
    ],
  });
}

/**
 * @param {any} combo
 * @param {any} action
 * @param {any} empiricalSpot
 * @param {{model: any, profile: any, context: any}} options
 */
function empiricalAdjustedActionScore(combo, action, empiricalSpot, { model, profile, context }) {
  const baseScore = actionScoreForCombo(combo, action, context);
  const rawProbability = empiricalActionProbability(empiricalSpot, combo.classKey, action.type, { profile });
  if (rawProbability == null) {
    return baseScore;
  }
  const spotProbability = empiricalActionProbability({ spotProbabilities: empiricalSpot.spotProbabilities }, combo.classKey, action.type, { profile });
  const continuationProbability = action.type === "fold" ? 1 - rawProbability : rawProbability;
  const spotContinuationProbability = action.type === "fold" ? 1 - (spotProbability ?? rawProbability) : (spotProbability ?? rawProbability);
  const classCount = Number(empiricalSpot.handClasses?.[combo.classKey]?.count || 0);
  const reliability = classCount / (classCount + Number(model.empiricalShrinkageHands || 0));
  const bucketedClass = bucketProbability(continuationProbability, model.empiricalProbabilityBuckets);
  const bucketedSpot = bucketProbability(spotContinuationProbability, model.empiricalProbabilityBuckets);
  const shrunkProbability = bucketedSpot + reliability * (bucketedClass - bucketedSpot);
  return baseScore + empiricalScoreAdjustment(shrunkProbability, Number(model.empiricalScoreWeight || 0));
}

/**
 * @param {{player?: string, position?: string, combos: any[], history?: any[], modelMetadata?: any}} options
 */
export function summarizeRange({ player, position, combos, history = [], modelMetadata = rangeModelMetadata() }) {
  const totalCombos = combos.length;
  const weightedCombos = combos.reduce((sum, combo) => sum + combo.weight, 0);
  return {
    player,
    position,
    combos,
    history,
    modelMetadata,
    summary: {
      totalCombos,
      weightedCombos,
      frequency: totalCombos ? weightedCombos / totalCombos : 0,
    },
  };
}

/**
 * @param {any} action
 * @param {any} [options]
 */
export function targetFrequencyForAction(action, {
  position,
  model = DEFAULT_PREFLOP_RANGE_MODEL,
  facingAggression = false,
  playerCount = 6,
  empiricalSpot = null,
  preflopAggressiveActionsBefore = 0,
} = {}) {
  const tacticalFrequency = tacticalTargetFrequencyForAction(action, {
    position,
    model,
    facingAggression,
    playerCount,
    preflopAggressiveActionsBefore,
  });
  const empiricalFrequency = empiricalTargetFrequency(action, empiricalSpot || model?.empiricalSpot);
  if (empiricalFrequency != null) {
    return calibratedEmpiricalTarget(empiricalFrequency, tacticalFrequency, action, { preflopAggressiveActionsBefore });
  }
  return tacticalFrequency;
}

/**
 * @param {any} action
 * @param {any} [options]
 */
function tacticalTargetFrequencyForAction(action, {
  position,
  model = DEFAULT_PREFLOP_RANGE_MODEL,
  facingAggression = false,
  playerCount = 6,
  preflopAggressiveActionsBefore = 0,
} = {}) {
  const normalizedPlayerCount = clampPlayerCount(playerCount);
  if (action.street && action.street !== "preflop") {
    return targetPostflopFrequencyForAction(action, { model, facingAggression });
  }
  if (action.type === "fold") {
    return facingAggression
      ? frequencyFor(model.callOpenFrequency, normalizedPlayerCount, position, 0.2)
      : frequencyFor(model.openRaiseFrequency, normalizedPlayerCount, position, 0.25);
  }
  if (action.type === "raise" || action.type === "bet" || action.type === "all-in") {
    const base = aggressivePreflopFrequency({
      model,
      playerCount: normalizedPlayerCount,
      position,
      facingAggression,
      preflopAggressiveActionsBefore,
    });
    return sizedFrequency(base, action.amount);
  }
  if (action.type === "call") {
    return sizedFrequency(frequencyFor(model.callOpenFrequency, normalizedPlayerCount, position, 0.18), action.amount);
  }
  if (action.type === "check") {
    return null;
  }
  return null;
}

function aggressivePreflopFrequency({
  model,
  playerCount,
  position,
  facingAggression,
  preflopAggressiveActionsBefore,
}) {
  if (!facingAggression || preflopAggressiveActionsBefore <= 0) {
    return frequencyFor(model.openRaiseFrequency, playerCount, position, 0.25);
  }
  if (preflopAggressiveActionsBefore === 1) {
    return frequencyFor(model.threeBetFrequency, playerCount, position, 0.07);
  }
  if (preflopAggressiveActionsBefore === 2) {
    return frequencyFor(model.fourBetFrequency, playerCount, position, 0.045);
  }
  return frequencyFor(model.fiveBetFrequency, playerCount, position, 0.025);
}

function calibratedEmpiricalTarget(empiricalFrequency, tacticalFrequency, action, { preflopAggressiveActionsBefore = 0 } = {}) {
  if (tacticalFrequency == null) {
    return empiricalFrequency;
  }
  if (action.street === "preflop" && ["bet", "raise", "all-in"].includes(action.type)) {
    const capMultiplier = preflopAggressiveActionsBefore >= 2 ? 1.25 : preflopAggressiveActionsBefore === 1 ? 1.55 : 1.2;
    return Math.min(empiricalFrequency, tacticalFrequency * capMultiplier);
  }
  return Math.min(empiricalFrequency, Math.max(tacticalFrequency * 1.75, tacticalFrequency + 0.08));
}

function targetPostflopFrequencyForAction(action, { model, facingAggression }) {
  const street = ["flop", "turn", "river"].includes(action.street) ? action.street : "flop";
  if (action.type === "check") {
    return null;
  }
  if (action.type === "fold") {
    return facingAggression ? model.postflopFrequency.foldFacingAggression[street] : 0.72;
  }
  if (action.type === "bet") {
    return sizedFrequency(model.postflopFrequency.bet[street], action.amount);
  }
  if (action.type === "raise") {
    const base = facingAggression ? model.postflopFrequency.raise[street] : model.postflopFrequency.bet[street];
    return sizedFrequency(base, action.amount);
  }
  if (action.type === "all-in") {
    return sizedFrequency(model.postflopFrequency.allIn[street], action.amount);
  }
  if (action.type === "call") {
    return sizedFrequency(model.postflopFrequency.call[street], action.amount);
  }
  return null;
}

function frequencyFor(table, playerCount, position, fallback) {
  return table?.[playerCount]?.[position] ?? table?.[6]?.[position] ?? fallback;
}

function clampPlayerCount(value) {
  const count = Number(value);
  return [2, 3, 4, 5, 6].includes(count) ? count : 6;
}

export function thresholdForTarget(combos, targetFrequency, softness = DEFAULT_PREFLOP_RANGE_MODEL.softness, scoreKey = "score") {
  const target = clampProbability(targetFrequency);
  let low = Math.min(...combos.map((combo) => combo[scoreKey])) - 1;
  let high = Math.max(...combos.map((combo) => combo[scoreKey])) + 1;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (low + high) / 2;
    const frequency = averageContinuation(combos, middle, softness, scoreKey);
    if (frequency > target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

function averageContinuation(combos, threshold, softness, scoreKey = "score") {
  if (!combos.length) {
    return 0;
  }
  const totalWeight = combos.reduce((sum, combo) => sum + combo.weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  return combos.reduce((sum, combo) =>
    sum + combo.weight * logistic((combo[scoreKey] - threshold) / softness), 0) / totalWeight;
}

function actionScoreForCombo(combo, action, context) {
  if (action.street === "preflop") {
    return combo.score;
  }
  if (typeof context.scoreComboForAction === "function") {
    return context.scoreComboForAction(combo, action);
  }
  return combo.score;
}

function sizedFrequency(base, amount) {
  if (!Number.isFinite(Number(amount))) {
    return base;
  }
  const size = Number(amount);
  if (size <= 2.2) {
    return base * 1.12;
  }
  if (size >= 4) {
    return base * 0.82;
  }
  return base;
}

function bucketProbability(probability, buckets = DEFAULT_PREFLOP_RANGE_MODEL.empiricalProbabilityBuckets) {
  const value = clampProbability(probability);
  let best = buckets[0] ?? 0;
  let bestDistance = Math.abs(value - best);
  for (const bucket of buckets || []) {
    const distance = Math.abs(value - bucket);
    if (distance < bestDistance) {
      best = bucket;
      bestDistance = distance;
    }
  }
  return clampProbability(best);
}

function empiricalScoreAdjustment(probability, weight) {
  if (!Number.isFinite(weight) || weight <= 0) {
    return 0;
  }
  const centered = probabilityToLogit(probability) / 8;
  return Math.max(-weight, Math.min(weight, centered * weight));
}

function probabilityToLogit(probability) {
  const clamped = Math.min(1 - 1e-6, Math.max(1e-6, Number(probability)));
  return Math.log(clamped / (1 - clamped));
}

function logistic(value) {
  if (value > 40) {
    return 1;
  }
  if (value < -40) {
    return 0;
  }
  return 1 / (1 + Math.exp(-value));
}

function clampProbability(value) {
  return Math.min(1, Math.max(0, Number(value)));
}
