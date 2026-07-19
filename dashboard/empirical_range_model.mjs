export const EMPIRICAL_DEFAULTS = Object.freeze({
  stakeBucket: "micro",
  yearBucket: "2009-2010",
  amountBucket: "none",
});

export function empiricalActionProbability(empiricalSpot, classKey, actionType, { profile = null } = {}) {
  const normalizedAction = normalizeActionType(actionType);
  const classEntry = empiricalSpot?.handClasses?.[classKey];
  const classProbabilities = classEntry?.probabilities
    ? applyArchetypeActionProfile(classEntry.probabilities, { classKey, profile })
    : null;
  const classProbability = classProbabilities?.[normalizedAction];
  if (Number.isFinite(classProbability)) {
    return clampProbability(classProbability);
  }
  const spotProbabilities = empiricalSpot?.spotProbabilities
    ? applyArchetypeActionProfile(empiricalSpot.spotProbabilities, { classKey, profile })
    : null;
  const spotProbability = spotProbabilities?.[normalizedAction];
  if (Number.isFinite(spotProbability)) {
    return clampProbability(spotProbability);
  }
  return null;
}

export function empiricalTargetFrequency(action, empiricalSpot) {
  const actionProbability = empiricalSpot?.spotProbabilities?.[normalizeActionType(action.type)];
  if (!Number.isFinite(actionProbability)) {
    return null;
  }
  const probability = clampProbability(actionProbability);
  return action.type === "fold" ? 1 - probability : probability;
}

export function empiricalSpotRequest({
  action,
  position,
  playerCount,
  facingAggression = false,
  stakeBucket = EMPIRICAL_DEFAULTS.stakeBucket,
  yearBucket = EMPIRICAL_DEFAULTS.yearBucket,
} = {}) {
  return {
    street: action?.street || "preflop",
    position,
    playerCount,
    stakeBucket,
    yearBucket,
    facingAggression: Boolean(facingAggression),
    amountBucket: amountBucketForAction(action),
  };
}

export function empiricalSpotUrl(request) {
  const params = new URLSearchParams({
    street: request.street,
    position: request.position,
    playerCount: String(request.playerCount),
    stakeBucket: request.stakeBucket || EMPIRICAL_DEFAULTS.stakeBucket,
    yearBucket: request.yearBucket || EMPIRICAL_DEFAULTS.yearBucket,
    facingAggression: request.facingAggression ? "1" : "0",
    amountBucket: request.amountBucket || EMPIRICAL_DEFAULTS.amountBucket,
  });
  return `/api/calibration/empirical-spot?${params}`;
}

export function amountBucketForAction(action = {}) {
  const amount = Number(action.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "none";
  }
  if (amount < 0.35) {
    return "small";
  }
  if (amount < 0.8) {
    return "medium";
  }
  if (amount < 1.5) {
    return "large";
  }
  return "overbet";
}

function normalizeActionType(actionType) {
  return actionType === "all-in" ? "all-in" : String(actionType || "");
}

function clampProbability(value) {
  return Math.min(1, Math.max(0, Number(value)));
}
import { applyArchetypeActionProfile } from "./player_archetypes.mjs";
