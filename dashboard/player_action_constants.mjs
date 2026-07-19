export const ACTION_STREETS = Object.freeze(["preflop", "flop", "turn", "river"]);
export const ACTION_TYPES = Object.freeze(["fold", "check", "call", "bet", "raise", "all-in"]);
export const FORCED_ACTION_TYPES = Object.freeze(["small-blind", "big-blind"]);
export const DEFAULT_SMALL_BLIND = 0.5;
export const DEFAULT_BIG_BLIND = 1;

export const STREET_INDEX = Object.freeze({
  preflop: 0,
  flop: 1,
  turn: 2,
  river: 3,
});
