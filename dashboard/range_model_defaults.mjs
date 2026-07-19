export const DEFAULT_PREFLOP_RANGE_MODEL = deepFreeze({
  name: "heuristic_empirical_hybrid",
  openRaiseFrequency: {
    2: { SB: 0.48, BB: 0.18 },
    3: { BTN: 0.40, SB: 0.34, BB: 0.18 },
    4: { CO: 0.25, BTN: 0.38, SB: 0.34, BB: 0.18 },
    5: { HJ: 0.19, CO: 0.25, BTN: 0.39, SB: 0.36, BB: 0.18 },
    6: { LJ: 0.16, HJ: 0.20, CO: 0.27, BTN: 0.42, SB: 0.38, BB: 0.18 },
  },
  callOpenFrequency: {
    2: { SB: 0.26, BB: 0.42 },
    3: { BTN: 0.18, SB: 0.15, BB: 0.36 },
    4: { CO: 0.12, BTN: 0.20, SB: 0.15, BB: 0.34 },
    5: { HJ: 0.09, CO: 0.12, BTN: 0.21, SB: 0.15, BB: 0.33 },
    6: { LJ: 0.08, HJ: 0.10, CO: 0.13, BTN: 0.21, SB: 0.15, BB: 0.32 },
  },
  threeBetFrequency: {
    2: { SB: 0.12, BB: 0.12 },
    3: { BTN: 0.08, SB: 0.10, BB: 0.105 },
    4: { CO: 0.065, BTN: 0.09, SB: 0.105, BB: 0.10 },
    5: { HJ: 0.052, CO: 0.07, BTN: 0.092, SB: 0.105, BB: 0.097 },
    6: { LJ: 0.045, HJ: 0.055, CO: 0.075, BTN: 0.095, SB: 0.105, BB: 0.095 },
  },
  fourBetFrequency: {
    2: { SB: 0.150, BB: 0.120 },
    3: { BTN: 0.135, SB: 0.125, BB: 0.115 },
    4: { CO: 0.105, BTN: 0.140, SB: 0.120, BB: 0.110 },
    5: { HJ: 0.095, CO: 0.112, BTN: 0.145, SB: 0.120, BB: 0.108 },
    6: { LJ: 0.085, HJ: 0.098, CO: 0.118, BTN: 0.145, SB: 0.120, BB: 0.108 },
  },
  fiveBetFrequency: {
    2: { SB: 0.420, BB: 0.360 },
    3: { BTN: 0.380, SB: 0.360, BB: 0.340 },
    4: { CO: 0.320, BTN: 0.390, SB: 0.350, BB: 0.330 },
    5: { HJ: 0.300, CO: 0.330, BTN: 0.400, SB: 0.350, BB: 0.320 },
    6: { LJ: 0.280, HJ: 0.310, CO: 0.340, BTN: 0.410, SB: 0.350, BB: 0.320 },
  },
  postflopFrequency: {
    bet: { flop: 0.56, turn: 0.50, river: 0.44 },
    call: { flop: 0.46, turn: 0.40, river: 0.34 },
    raise: { flop: 0.18, turn: 0.14, river: 0.10 },
    allIn: { flop: 0.12, turn: 0.10, river: 0.08 },
    foldFacingAggression: { flop: 0.46, turn: 0.40, river: 0.34 },
  },
  softness: 0.075,
  postflopSoftness: 0.11,
  empiricalScoreWeight: 0.16,
  empiricalShrinkageHands: 240,
  empiricalProbabilityBuckets: [0, 0.015, 0.04, 0.08, 0.14, 0.22, 0.34, 0.50, 0.72, 0.90, 1],
});

export function rangeModelArtifact(model = DEFAULT_PREFLOP_RANGE_MODEL) {
  return {
    kind: "range_model_parameters",
    name: model.name,
    version: model.name,
    model,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
