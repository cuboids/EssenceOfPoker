import {
  ACTION_STREETS,
  ACTION_TYPES,
  DEFAULT_BIG_BLIND,
  DEFAULT_SMALL_BLIND,
  FORCED_ACTION_TYPES,
  STREET_INDEX,
} from "./player_action_constants.mjs";
import {
  actionLabel,
  actionTagLabel,
  formatAmount,
} from "./player_action_formatting.mjs";
import {
  bettingStateForStreet,
  legalActionPlan,
} from "./player_action_pot.mjs";
import {
  bettingRoundIsClosed,
  nextActionPlayer,
  previousActionStreet,
} from "./player_action_turn_order.mjs";

export {
  ACTION_STREETS,
  ACTION_TYPES,
  DEFAULT_BIG_BLIND,
  DEFAULT_SMALL_BLIND,
  FORCED_ACTION_TYPES,
  actionLabel,
  actionTagLabel,
  bettingStateForStreet,
  bettingRoundIsClosed,
  formatAmount,
  legalActionPlan,
  nextActionPlayer,
};

/**
 * @typedef {{id?: string, player: string, street: string, type: string, amount?: number, forced?: boolean}} PlayerAction
 * @typedef {{[player: string]: number}} StackMap
 * @typedef {{smallBlindPlayer?: string | null, bigBlindPlayer?: string | null, smallBlind?: number, bigBlind?: number}} BlindConfig
 * @typedef {{orderForStreet?: (street: string) => string[], stacks?: StackMap, smallBlindPlayer?: string | null, bigBlindPlayer?: string | null, smallBlind?: number, bigBlind?: number}} ActionLegalityContext
 * @typedef {{actions: PlayerAction[], street: string, order: string[], stacks: StackMap, smallBlindPlayer?: string | null, bigBlindPlayer?: string | null, smallBlind?: number, bigBlind?: number}} BettingStateOptions
 * @typedef {{order: string[], actions: PlayerAction[], street: string, foldedBeforeStreet?: (player: string) => boolean, canAct?: (player: string) => boolean, smallBlind?: number, bigBlind?: number}} ActionOrderOptions
 */

export function normalizePlayerAction(action) {
  if (!action || typeof action !== "object") {
    throw new Error("player action must be an object");
  }
  const player = assertNonEmptyString(action.player, "player");
  const street = assertOneOf(action.street, ACTION_STREETS, "street");
  const type = assertOneOf(action.type, ACTION_TYPES, "action type");
  const id = typeof action.id === "string" && action.id ? action.id : null;
  /** @type {PlayerAction} */
  const normalized = { ...(id ? { id } : {}), player, street, type };
  if (["bet", "raise", "call", "all-in"].includes(type) && action.amount != null) {
    normalized.amount = normalizeAmount(action.amount);
  }
  return normalized;
}

export function appendPlayerAction(actions, nextAction) {
  const normalized = {
    ...normalizePlayerAction(nextAction),
    id: nextAction.id || nextActionId(actions),
  };
  return [...actions, normalized];
}

export function appendLegalPlayerAction(actions, nextAction, context) {
  const normalized = {
    ...normalizePlayerAction(nextAction),
    id: nextAction.id || nextActionId(actions),
  };
  const error = actionLegalityError([...actions, normalized], context);
  if (error) {
    throw new Error(error);
  }
  return [...actions, normalized];
}

export function validateActionSequence(actions, context) {
  const normalizedActions = actions.map(normalizePlayerAction);
  const error = actionLegalityError(normalizedActions, context);
  if (error) {
    throw new Error(error);
  }
  return true;
}

export function deletePlayerAction(actions, actionId) {
  return actions.filter((action) => action.id !== actionId);
}

export function upsertPlayerAction(actions, nextAction) {
  const normalized = {
    ...normalizePlayerAction(nextAction),
    id: nextAction.id || nextActionId(actions),
  };
  return [
    ...actions.filter((action) => !(action.player === normalized.player && action.street === normalized.street)),
    normalized,
  ];
}

export function actionForPlayerStreet(actions, player, street) {
  return actions.find((action) => action.player === player && action.street === street) || null;
}

export function actionsForStreet(actions, street) {
  return actions.filter((action) => action.street === street);
}

/**
 * @param {BlindConfig} [options]
 */
export function forcedBlindActionTags({
  smallBlindPlayer,
  bigBlindPlayer,
  smallBlind = DEFAULT_SMALL_BLIND,
  bigBlind = DEFAULT_BIG_BLIND,
} = {}) {
  return [
    smallBlindPlayer ? {
      id: "forced:small-blind",
      player: smallBlindPlayer,
      street: "preflop",
      type: "small-blind",
      amount: smallBlind,
      forced: true,
    } : null,
    bigBlindPlayer ? {
      id: "forced:big-blind",
      player: bigBlindPlayer,
      street: "preflop",
      type: "big-blind",
      amount: bigBlind,
      forced: true,
    } : null,
  ].filter(Boolean);
}

export function actionsVisibleThroughStreet(actions, street) {
  const targetIndex = STREET_INDEX[street];
  if (targetIndex == null) {
    return [];
  }
  return actions.filter((action) => STREET_INDEX[action.street] <= targetIndex);
}

export function playerHasFoldedByStreet(actions, player, street) {
  const targetIndex = STREET_INDEX[street];
  if (targetIndex == null) {
    return false;
  }
  return actions.some((action) =>
    action.player === player &&
    action.type === "fold" &&
    STREET_INDEX[action.street] <= targetIndex,
  );
}

export function livePlayersThroughStreet({ order, actions, street }) {
  return order.filter((player) => !playerHasFoldedByStreet(actions, player, street));
}

/**
 * @param {BettingStateOptions} options
 */
export function actionablePlayersForStreet({
  order,
  actions,
  street,
  stacks,
  smallBlindPlayer,
  bigBlindPlayer,
  smallBlind = DEFAULT_SMALL_BLIND,
  bigBlind = DEFAULT_BIG_BLIND,
}) {
  const state = bettingStateForStreet({
    actions,
    street,
    order,
    stacks,
    smallBlindPlayer,
    bigBlindPlayer,
    smallBlind,
    bigBlind,
  });
  return order.filter((player) =>
    !playerHasFoldedByStreet(actions, player, previousActionStreet(street)) &&
    state.remainingStack(player) > 0
  );
}

/**
 * @param {BettingStateOptions & {player: string}} options
 */
export function playerIsAllInByStreet({
  order,
  actions,
  player,
  street,
  stacks,
  smallBlindPlayer,
  bigBlindPlayer,
  smallBlind = DEFAULT_SMALL_BLIND,
  bigBlind = DEFAULT_BIG_BLIND,
}) {
  if (playerHasFoldedByStreet(actions, player, street)) {
    return false;
  }
  const state = bettingStateForStreet({
    actions,
    street,
    order,
    stacks,
    smallBlindPlayer,
    bigBlindPlayer,
    smallBlind,
    bigBlind,
  });
  return state.remainingStack(player) <= 0;
}

/**
 * @param {PlayerAction[]} actions
 * @param {ActionLegalityContext} [context]
 */
export function actionLegalityError(actions, {
  orderForStreet,
  stacks,
  smallBlindPlayer,
  bigBlindPlayer,
  smallBlind = DEFAULT_SMALL_BLIND,
  bigBlind = DEFAULT_BIG_BLIND,
} = {}) {
  if (typeof orderForStreet !== "function") {
    return "action legality requires an orderForStreet function";
  }
  const previousActions = [];
  let previousStreetIndex = -1;
  for (const rawAction of actions) {
    let action;
    try {
      action = normalizePlayerAction(rawAction);
    } catch (error) {
      return error.message;
    }
    const streetIndex = STREET_INDEX[action.street];
    if (streetIndex < previousStreetIndex) {
      return "actions cannot move backwards through streets";
    }
    previousStreetIndex = streetIndex;
    const order = orderForStreet(action.street);
    if (!Array.isArray(order) || !order.includes(action.player)) {
      return `${action.player} is not seated in the ${action.street} action order`;
    }
    const state = bettingStateForStreet({
      actions: previousActions,
      street: action.street,
      order,
      stacks,
      smallBlindPlayer,
      bigBlindPlayer,
      smallBlind,
      bigBlind,
    });
    const actor = nextActionPlayer({
      order,
      actions: previousActions,
      street: action.street,
      foldedBeforeStreet: (player) => playerHasFoldedByStreet(previousActions, player, previousActionStreet(action.street)),
      canAct: (player) => state.remainingStack(player) > 0,
      smallBlind,
      bigBlind,
    });
    if (!actor) {
      return `${action.street} betting round is already closed`;
    }
    if (action.player !== actor) {
      return `${action.player} cannot act now; expected ${actor}`;
    }
    const plan = legalActionPlan({ player: action.player, street: action.street, state, bigBlind });
    if (!plan.actions.includes(action.type)) {
      return `${action.type} is not legal for ${action.player} on ${action.street}`;
    }
    const amountError = actionAmountLegalityError(action, plan);
    if (amountError) {
      return amountError;
    }
    previousActions.push(action);
  }
  return null;
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number");
  }
  return Math.round(amount * 10) / 10;
}

function actionAmountLegalityError(action, plan) {
  if (action.type === "fold" || action.type === "check") {
    return action.amount == null ? null : `${action.type} cannot have an amount`;
  }
  if (!Number.isFinite(action.amount)) {
    return `${action.type} requires an amount`;
  }
  if (action.amount <= 0) {
    return `${action.type} amount must be positive`;
  }
  if (action.amount > plan.maxAmount + 0.0001) {
    return `${action.type} amount exceeds remaining stack`;
  }
  if (action.type === "call" && Math.abs(action.amount - plan.callAmount) > 0.0001) {
    return `call amount must be ${formatAmount(plan.callAmount)}`;
  }
  if (action.type === "bet" && action.amount + 0.0001 < plan.minBet) {
    return `bet amount must be at least ${formatAmount(plan.minBet)}`;
  }
  if (action.type === "raise" && action.amount + 0.0001 < plan.minRaiseAmount) {
    return `raise amount must be at least ${formatAmount(plan.minRaiseAmount)}`;
  }
  if (action.type === "all-in" && Math.abs(action.amount - plan.remaining) > 0.0001) {
    return `all-in amount must be ${formatAmount(plan.remaining)}`;
  }
  return null;
}

function nextActionId(actions) {
  const nextIndex = actions.reduce((maxIndex, action) => {
    const match = /^a(\d+)$/.exec(action.id || "");
    return match ? Math.max(maxIndex, Number(match[1])) : maxIndex;
  }, 0) + 1;
  return `a${nextIndex}`;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function assertOneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}
