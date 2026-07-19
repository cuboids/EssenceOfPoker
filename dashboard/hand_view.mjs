import { HAND_PHASES, isShowdown } from "./hand_state.mjs";

const VIEW_PHASES = new Set([
  HAND_PHASES.PREFLOP,
  HAND_PHASES.FLOP,
  HAND_PHASES.TURN,
  HAND_PHASES.RIVER,
  HAND_PHASES.SHOWDOWN,
]);

export function handViewFromModel(model) {
  if (!model || !VIEW_PHASES.has(model.phase)) {
    return null;
  }
  return {
    round: isShowdown(model) ? HAND_PHASES.RIVER : model.phase,
    h1: model.hole[0],
    h2: model.hole[1],
    v1: model.villain[0],
    v2: model.villain[1],
    flop: [...model.flop],
    turn: model.turn,
    river: model.river,
    suitMap: new Map(model.suitMap),
  };
}
