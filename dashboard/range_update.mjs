import { playerHasFoldedByStreet } from "./player_actions.mjs";
import { positionFromPageKey, positionPageKey } from "./table_positions.mjs";
import {
  createUniformPreflopRange,
  updatePreflopRangeForAction,
} from "./range_model.mjs";

export function inferPreflopRanges({
  tableConfig,
  actions = [],
  deadCards = [],
  playerProfiles = {},
  model = undefined,
} = {}) {
  const ranges = {};
  for (const position of tableConfig.positions || []) {
    const player = position === tableConfig.heroPosition ? "hero" : positionPageKey(position);
    let range = createUniformPreflopRange({
      player,
      position,
      deadCards,
      profile: playerProfiles[player] || playerProfiles[position] || {},
    });
    const preflopActions = actions.filter((candidate) => candidate.street === "preflop");
    for (const action of preflopActions.filter((candidate) => candidate.player === player)) {
      range = updatePreflopRangeForAction(range, action, {
        position,
        model,
        playerCount: tableConfig.playerCount,
        facingAggression: preflopActions.some((candidate) =>
          candidate.player !== player &&
          ["bet", "raise", "all-in"].includes(candidate.type) &&
          actionIndex(preflopActions, candidate) < actionIndex(preflopActions, action),
        ),
      });
    }
    if (playerHasFoldedByStreet(actions, player, "preflop")) {
      range = {
        ...range,
        combos: range.combos.map((combo) => ({ ...combo, weight: 0 })),
        summary: { ...range.summary, weightedCombos: 0, frequency: 0 },
        folded: true,
      };
    }
    ranges[player] = range;
  }
  return ranges;
}

function actionIndex(actions, action) {
  return actions.indexOf(action);
}

export function rangeForPosition(ranges, position) {
  return ranges[positionPageKey(position)] || ranges.hero || null;
}

export function positionForRangePlayer(player, tableConfig) {
  return player === "hero" ? tableConfig.heroPosition : positionFromPageKey(player);
}
