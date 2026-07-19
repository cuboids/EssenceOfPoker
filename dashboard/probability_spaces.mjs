export const PROBABILITY_SPACES = Object.freeze({
  GENERIC_FIVE_CARD: "generic-five-card",
  GENERIC_SEVEN_CARD: "generic-seven-card",
  ORDERED_NLHE_PRIMARY_PRIOR: "ordered-nlhe-primary-prior",
  HERO_PREFLOP_AGGREGATE: "hero-preflop-aggregate",
  HERO_RUNOUT: "hero-known-state-runout",
  HIDDEN_VILLAIN_PREFLOP_PRIMARY: "hidden-villain-preflop-primary",
  HIDDEN_VILLAIN_KNOWN_BOARD: "hidden-villain-known-board",
  PREFLOP_HAND_EQUITY_MONTE_CARLO: "preflop-hand-equity-monte-carlo",
  PREFLOP_WIN_SHARE: "preflop-win-share",
});

export const probabilitySpaceDefinitions = Object.freeze({
  [PROBABILITY_SPACES.GENERIC_FIVE_CARD]: Object.freeze({
    exact: true,
    description: "Uniform unordered five-card subsets from a physical deck.",
  }),
  [PROBABILITY_SPACES.GENERIC_SEVEN_CARD]: Object.freeze({
    exact: true,
    description: "Uniform unordered seven-card subsets from a physical deck, scored by best five-card hand.",
  }),
  [PROBABILITY_SPACES.ORDERED_NLHE_PRIMARY_PRIOR]: Object.freeze({
    exact: true,
    description: "Canonical holding class plus unordered board set plus flop subset plus ordered turn/river.",
  }),
  [PROBABILITY_SPACES.HERO_PREFLOP_AGGREGATE]: Object.freeze({
    exact: true,
    description: "Known hero holding with every remaining five-card board, scored by same-world asset minimum.",
  }),
  [PROBABILITY_SPACES.HERO_RUNOUT]: Object.freeze({
    exact: true,
    description: "Known hero state with all legal future community-card completions.",
  }),
  [PROBABILITY_SPACES.HIDDEN_VILLAIN_PREFLOP_PRIMARY]: Object.freeze({
    exact: true,
    description: "Hero blockers removed; villain hole cards hidden; primary assets grouped by visible villain-card usage.",
  }),
  [PROBABILITY_SPACES.HIDDEN_VILLAIN_KNOWN_BOARD]: Object.freeze({
    exact: true,
    description: "Hero-visible board with all legal hidden villain holdings and future board completions.",
  }),
  [PROBABILITY_SPACES.PREFLOP_HAND_EQUITY_MONTE_CARLO]: Object.freeze({
    exact: false,
    description: "Monte Carlo estimate of hero hand aggregate equity versus any-two-card villain range.",
  }),
  [PROBABILITY_SPACES.PREFLOP_WIN_SHARE]: Object.freeze({
    exact: true,
    description: "Known hero holding with all ordered board arrangements, splitting tied winning assets.",
  }),
});

export function assertProbabilitySpace(payload, expectedSpace) {
  if (!probabilitySpaceDefinitions[expectedSpace]) {
    throw new Error(`unknown probability space ${expectedSpace}`);
  }
  if (payload?.probabilitySpace !== expectedSpace) {
    throw new Error(`expected probabilitySpace ${expectedSpace}, got ${payload?.probabilitySpace || "missing"}`);
  }
  return payload;
}
