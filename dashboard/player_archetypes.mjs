export const ARCHETYPE_NAMES = Object.freeze([
  "complete_novice",
  "calling_station",
  "nit",
  "tag",
  "lag",
  "gto",
  "maniac",
]);

const ACTION_SHIFTS = Object.freeze({
  complete_novice: Object.freeze({ fold: -0.15, check: 0.1, call: 0.3, bet: -0.05, raise: -0.1, "all-in": 0.02 }),
  calling_station: Object.freeze({ fold: -0.45, check: 0.05, call: 0.65, bet: -0.18, raise: -0.25, "all-in": -0.1 }),
  nit: Object.freeze({ fold: 0.45, check: 0.15, call: -0.12, bet: -0.12, raise: -0.22, "all-in": -0.18 }),
  tag: Object.freeze({ fold: 0.08, check: 0, call: -0.04, bet: 0.12, raise: 0.16, "all-in": 0.08 }),
  lag: Object.freeze({ fold: -0.18, check: -0.1, call: 0.02, bet: 0.25, raise: 0.38, "all-in": 0.16 }),
  gto: Object.freeze({ fold: 0, check: 0, call: 0, bet: 0, raise: 0, "all-in": 0 }),
  maniac: Object.freeze({ fold: -0.35, check: -0.25, call: 0.08, bet: 0.42, raise: 0.75, "all-in": 0.55 }),
});

export function applyArchetypeActionProfile(probabilities, { classKey, profile = {} } = {}) {
  profile = profile || {};
  const archetypes = normalizeArchetypeWeights(profile.archetypes || profile.archetypeWeights);
  if (!archetypes) {
    return probabilities;
  }
  const strength = handClassStrength(classKey);
  const logits = Object.fromEntries(Object.entries(probabilities).map(([action, probability]) => [
    action,
    probabilityToLogit(probability) + archetypeShift(action, archetypes, strength),
  ]));
  return softmaxObject(logits);
}

export function normalizeArchetypeWeights(weights) {
  if (!weights || typeof weights !== "object") {
    return null;
  }
  const normalized = {};
  let total = 0;
  for (const name of ARCHETYPE_NAMES) {
    const value = Number(weights[name] || 0);
    if (value > 0 && Number.isFinite(value)) {
      normalized[name] = value;
      total += value;
    }
  }
  if (total <= 0) {
    return null;
  }
  for (const name of Object.keys(normalized)) {
    normalized[name] /= total;
  }
  return normalized;
}

export function handClassStrength(classKey) {
  const [firstRaw, secondRaw, kind] = String(classKey || "").split("-");
  const first = Number(firstRaw);
  const second = Number(secondRaw);
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return 0.5;
  }
  let strength = ((14 - first) + (14 - second)) / 26;
  if (kind === "pair") {
    strength += 0.22;
  } else if (kind === "suited") {
    strength += 0.06;
  }
  strength -= Math.min(0.18, Math.max(0, second - first - 1) * 0.025);
  return Math.min(1, Math.max(0, strength));
}

function archetypeShift(action, weights, strength) {
  let shift = 0;
  for (const [name, weight] of Object.entries(weights)) {
    const base = ACTION_SHIFTS[name]?.[action] || 0;
    const strengthAdjustment = strengthAdjustmentForAction(action, name, strength);
    shift += weight * (base + strengthAdjustment);
  }
  return shift;
}

function strengthAdjustmentForAction(action, name, strength) {
  const centered = strength - 0.5;
  if (["raise", "bet", "all-in"].includes(action)) {
    return centered * (name === "nit" ? 0.8 : 0.35);
  }
  if (action === "fold") {
    return -centered * 0.35;
  }
  return 0;
}

function probabilityToLogit(probability) {
  const clamped = Math.min(1 - 1e-9, Math.max(1e-9, Number(probability)));
  return Math.log(clamped);
}

function softmaxObject(logits) {
  const entries = Object.entries(logits);
  const peak = Math.max(...entries.map(([, value]) => value));
  const exps = entries.map(([key, value]) => [key, Math.exp(value - peak)]);
  const total = exps.reduce((sum, [, value]) => sum + value, 0);
  return Object.fromEntries(exps.map(([key, value]) => [key, value / total]));
}
