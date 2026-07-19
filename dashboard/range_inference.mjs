import { ACTION_STREETS, playerHasFoldedByStreet } from "./player_actions.mjs";
import { positionFromPageKey, positionPageKey } from "./table_positions.mjs";
import {
  createUniformPreflopRange,
  updateRangeForAction,
} from "./range_model.mjs";

/**
 * @param {{tableConfig?: any, actions?: any[], deadCards?: any[], knownBoard?: any[], bucketCount?: number, evaluateGradation?: Function|null, playerProfiles?: Record<string, any>, model?: any, empiricalSpots?: any}} [options]
 */
export function inferRanges({
  tableConfig,
  actions = [],
  deadCards = [],
  knownBoard = [],
  bucketCount = 7462,
  evaluateGradation = null,
  playerProfiles = {},
  model = undefined,
  empiricalSpots = {},
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
    const profile = playerProfiles[player] || playerProfiles[position] || {};
    for (const action of actions.filter((candidate) => candidate.player === player)) {
      const streetActions = actions.filter((candidate) => candidate.street === action.street);
      const previousStreetActions = streetActions.slice(0, actionIndex(streetActions, action));
      range = updateRangeForAction(range, action, {
        position,
        model,
        profile,
        empiricalSpot: empiricalSpotForAction(empiricalSpots, action, player, position),
        playerCount: tableConfig.playerCount,
        facingAggression: previousStreetActions.some((candidate) =>
          candidate.player !== player &&
          ["bet", "raise", "all-in"].includes(candidate.type),
        ),
        preflopAggressiveActionsBefore: action.street === "preflop"
          ? previousStreetActions.filter((candidate) => ["bet", "raise", "all-in"].includes(candidate.type)).length
          : 0,
        scoreComboForAction: (combo, candidateAction) => comboScoreForAction(combo, candidateAction, {
          knownBoard,
          bucketCount,
          evaluateGradation,
        }),
      });
    }
    if (playerHasFoldedByStreet(actions, player, lastActionStreet(actions))) {
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

export const inferPreflopRanges = inferRanges;

function empiricalSpotForAction(empiricalSpots, action, player, position) {
  if (!empiricalSpots) {
    return null;
  }
  if (typeof empiricalSpots === "function") {
    return empiricalSpots(action, { player, position }) || null;
  }
  return empiricalSpots[action.id] || empiricalSpots[`${player}:${action.id}`] || null;
}

function actionIndex(actions, action) {
  return actions.indexOf(action);
}

function lastActionStreet(actions) {
  return actions.reduce((latest, action) =>
    ACTION_STREETS.indexOf(action.street) > ACTION_STREETS.indexOf(latest) ? action.street : latest, "preflop");
}

function comboScoreForAction(combo, action, { knownBoard, bucketCount, evaluateGradation }) {
  if (action.street === "preflop" || typeof evaluateGradation !== "function") {
    return combo.score;
  }
  const board = boardVisibleOnStreet(knownBoard, action.street);
  if (board.length < 3) {
    return combo.score;
  }
  const cards = [...combo.cards, ...board];
  const bestGradation = bestFiveCardGradation(cards, evaluateGradation);
  return 1 - ((bestGradation - 1) / Math.max(1, bucketCount - 1));
}

function boardVisibleOnStreet(knownBoard, street) {
  const counts = { flop: 3, turn: 4, river: 5 };
  return knownBoard.slice(0, counts[street] || 0);
}

function bestFiveCardGradation(cards, evaluateGradation) {
  let best = Infinity;
  for (let first = 0; first < cards.length - 4; first += 1) {
    for (let second = first + 1; second < cards.length - 3; second += 1) {
      for (let third = second + 1; third < cards.length - 2; third += 1) {
        for (let fourth = third + 1; fourth < cards.length - 1; fourth += 1) {
          for (let fifth = fourth + 1; fifth < cards.length; fifth += 1) {
            const gradation = evaluateGradation([cards[first], cards[second], cards[third], cards[fourth], cards[fifth]]);
            if (gradation < best) {
              best = gradation;
            }
          }
        }
      }
    }
  }
  return best;
}

export function rangeForPosition(ranges, position) {
  return ranges[positionPageKey(position)] || ranges.hero || null;
}

export function positionForRangePlayer(player, tableConfig) {
  return player === "hero" ? tableConfig.heroPosition : positionFromPageKey(player);
}
