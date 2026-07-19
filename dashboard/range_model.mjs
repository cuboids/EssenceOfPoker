import { preflopComboScore } from "./range_features.mjs";
import { legalTwoCardCombos } from "./range_universe.mjs";

export const DEFAULT_PREFLOP_RANGE_MODEL = Object.freeze({
  openRaiseFrequency: Object.freeze({
    2: Object.freeze({ SB: 0.48, BB: 0.18 }),
    3: Object.freeze({ BTN: 0.40, SB: 0.34, BB: 0.18 }),
    4: Object.freeze({ CO: 0.25, BTN: 0.38, SB: 0.34, BB: 0.18 }),
    5: Object.freeze({ HJ: 0.19, CO: 0.25, BTN: 0.39, SB: 0.36, BB: 0.18 }),
    6: Object.freeze({ LJ: 0.16, HJ: 0.20, CO: 0.27, BTN: 0.42, SB: 0.38, BB: 0.18 }),
  }),
  callOpenFrequency: Object.freeze({
    2: Object.freeze({ SB: 0.26, BB: 0.42 }),
    3: Object.freeze({ BTN: 0.18, SB: 0.15, BB: 0.36 }),
    4: Object.freeze({ CO: 0.12, BTN: 0.20, SB: 0.15, BB: 0.34 }),
    5: Object.freeze({ HJ: 0.09, CO: 0.12, BTN: 0.21, SB: 0.15, BB: 0.33 }),
    6: Object.freeze({ LJ: 0.08, HJ: 0.10, CO: 0.13, BTN: 0.21, SB: 0.15, BB: 0.32 }),
  }),
  threeBetFrequency: Object.freeze({
    2: Object.freeze({ SB: 0.12, BB: 0.12 }),
    3: Object.freeze({ BTN: 0.08, SB: 0.10, BB: 0.105 }),
    4: Object.freeze({ CO: 0.065, BTN: 0.09, SB: 0.105, BB: 0.10 }),
    5: Object.freeze({ HJ: 0.052, CO: 0.07, BTN: 0.092, SB: 0.105, BB: 0.097 }),
    6: Object.freeze({ LJ: 0.045, HJ: 0.055, CO: 0.075, BTN: 0.095, SB: 0.105, BB: 0.095 }),
  }),
  softness: 0.075,
});

export function createUniformPreflopRange({ player, position, deadCards = [], profile = {} } = {}) {
  const combos = legalTwoCardCombos({ deadCards }).map((combo) => ({
    ...combo,
    weight: 1,
    score: preflopComboScore(combo, profile),
  }));
  return summarizeRange({ player, position, combos });
}

export function updatePreflopRangeForAction(range, action, context = {}) {
  if (action.street !== "preflop") {
    return range;
  }
  const model = context.model || DEFAULT_PREFLOP_RANGE_MODEL;
  const position = context.position || range.position;
  const targetFrequency = targetFrequencyForAction(action, { ...context, position, model });
  if (targetFrequency == null) {
    return range;
  }
  const threshold = thresholdForTarget(range.combos, targetFrequency, model.softness);
  const nextCombos = range.combos.map((combo) => {
    const continueProbability = logistic((combo.score - threshold) / model.softness);
    const likelihood = action.type === "fold" ? 1 - continueProbability : continueProbability;
    return { ...combo, weight: combo.weight * clampProbability(likelihood) };
  });
  return summarizeRange({
    player: range.player,
    position: range.position,
    combos: nextCombos,
    history: [
      ...(range.history || []),
      {
        action,
        targetFrequency,
        threshold,
      },
    ],
  });
}

export function summarizeRange({ player, position, combos, history = [] }) {
  const totalCombos = combos.length;
  const weightedCombos = combos.reduce((sum, combo) => sum + combo.weight, 0);
  return {
    player,
    position,
    combos,
    history,
    summary: {
      totalCombos,
      weightedCombos,
      frequency: totalCombos ? weightedCombos / totalCombos : 0,
    },
  };
}

export function targetFrequencyForAction(action, {
  position,
  model = DEFAULT_PREFLOP_RANGE_MODEL,
  facingAggression = false,
  playerCount = 6,
} = {}) {
  const normalizedPlayerCount = clampPlayerCount(playerCount);
  if (action.type === "fold") {
    return facingAggression
      ? frequencyFor(model.callOpenFrequency, normalizedPlayerCount, position, 0.2)
      : frequencyFor(model.openRaiseFrequency, normalizedPlayerCount, position, 0.25);
  }
  if (action.type === "raise" || action.type === "bet" || action.type === "all-in") {
    const base = facingAggression
      ? frequencyFor(model.threeBetFrequency, normalizedPlayerCount, position, 0.07)
      : frequencyFor(model.openRaiseFrequency, normalizedPlayerCount, position, 0.25);
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

function frequencyFor(table, playerCount, position, fallback) {
  return table?.[playerCount]?.[position] ?? table?.[6]?.[position] ?? fallback;
}

function clampPlayerCount(value) {
  const count = Number(value);
  return [2, 3, 4, 5, 6].includes(count) ? count : 6;
}

export function thresholdForTarget(combos, targetFrequency, softness = DEFAULT_PREFLOP_RANGE_MODEL.softness) {
  const target = clampProbability(targetFrequency);
  let low = Math.min(...combos.map((combo) => combo.score)) - 1;
  let high = Math.max(...combos.map((combo) => combo.score)) + 1;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const middle = (low + high) / 2;
    const frequency = averageContinuation(combos, middle, softness);
    if (frequency > target) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

function averageContinuation(combos, threshold, softness) {
  if (!combos.length) {
    return 0;
  }
  const totalWeight = combos.reduce((sum, combo) => sum + combo.weight, 0);
  if (totalWeight <= 0) {
    return 0;
  }
  return combos.reduce((sum, combo) =>
    sum + combo.weight * logistic((combo.score - threshold) / softness), 0) / totalWeight;
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
