import {
  ACTION_STREETS,
  DEFAULT_BIG_BLIND,
  DEFAULT_SMALL_BLIND,
  STREET_INDEX,
} from "./player_action_constants.mjs";
import { bettingStateForStreet } from "./player_action_pot.mjs";

/**
 * @typedef {{order: string[], actions: any[], street: string, foldedBeforeStreet?: (player: string) => boolean, canAct?: (player: string) => boolean, smallBlind?: number, bigBlind?: number}} ActionOrderOptions
 */

/**
 * @param {ActionOrderOptions} options
 */
export function nextActionPlayer({
  order,
  actions,
  street,
  foldedBeforeStreet = () => false,
  canAct = () => true,
  smallBlind = DEFAULT_SMALL_BLIND,
  bigBlind = DEFAULT_BIG_BLIND,
}) {
  if (!Array.isArray(order) || order.length <= 1) {
    return null;
  }
  if (bettingRoundIsClosed({ order, actions, street, foldedBeforeStreet, canAct, smallBlind, bigBlind })) {
    return null;
  }
  let activeOrder = order.filter((player) => !foldedBeforeStreet(player) && canAct(player));
  if (activeOrder.length <= 1) {
    return null;
  }
  let nextIndex = 0;
  for (const action of actionsForStreet(actions, street)) {
    const actorIndex = activeOrder.indexOf(action.player);
    if (actorIndex < 0) {
      continue;
    }
    if (action.type === "fold") {
      activeOrder = activeOrder.filter((player) => player !== action.player);
      nextIndex = activeOrder.length ? actorIndex % activeOrder.length : -1;
    } else {
      nextIndex = activeOrder.length ? (actorIndex + 1) % activeOrder.length : -1;
    }
    activeOrder = activeOrder.filter((player) => canAct(player));
    if (activeOrder.length <= 1) {
      return null;
    }
  }
  return nextIndex >= 0 ? activeOrder[nextIndex] : null;
}

/**
 * @param {ActionOrderOptions} options
 */
export function bettingRoundIsClosed({
  order,
  actions,
  street,
  foldedBeforeStreet = () => false,
  canAct = () => true,
  smallBlind = DEFAULT_SMALL_BLIND,
  bigBlind = DEFAULT_BIG_BLIND,
}) {
  const streetActions = actionsForStreet(actions, street);
  const state = bettingStateForStreet({
    actions,
    street,
    order,
    stacks: Object.fromEntries(order.map((player) => [player, Number.POSITIVE_INFINITY])),
    smallBlindPlayer: street === "preflop" ? order[order.length - 2] : null,
    bigBlindPlayer: street === "preflop" ? order[order.length - 1] : null,
    smallBlind,
    bigBlind,
  });
  let activeOrder = order.filter((player) => !foldedBeforeStreet(player) && canAct(player));
  if (activeOrder.length <= 1) {
    return true;
  }
  let hasVoluntaryAction = false;

  for (const action of streetActions) {
    if (!activeOrder.includes(action.player)) {
      continue;
    }
    hasVoluntaryAction = true;
    if (action.type === "fold") {
      activeOrder = activeOrder.filter((player) => player !== action.player);
      if (activeOrder.length <= 1) {
        return true;
      }
      continue;
    }
  }

  if (!hasVoluntaryAction) {
    return false;
  }
  return activeOrder.every((player) =>
    state.hasActedSinceFullRaise(player) &&
    Math.abs((state.streetContribution(player) || 0) - state.currentBet) < 0.0001,
  );
}

export function previousActionStreet(street) {
  const index = STREET_INDEX[street];
  return index > 0 ? ACTION_STREETS[index - 1] : null;
}

function actionsForStreet(actions, street) {
  return actions.filter((action) => action.street === street);
}
