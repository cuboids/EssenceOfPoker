export const ACTION_STREETS = Object.freeze(["preflop", "flop", "turn", "river"]);
export const ACTION_TYPES = Object.freeze(["fold", "check", "call", "bet", "raise", "all-in"]);

const STREET_INDEX = Object.freeze({
  preflop: 0,
  flop: 1,
  turn: 2,
  river: 3,
});

export function normalizePlayerAction(action) {
  if (!action || typeof action !== "object") {
    throw new Error("player action must be an object");
  }
  const player = assertNonEmptyString(action.player, "player");
  const street = assertOneOf(action.street, ACTION_STREETS, "street");
  const type = assertOneOf(action.type, ACTION_TYPES, "action type");
  const id = typeof action.id === "string" && action.id ? action.id : null;
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

export function actionsVisibleThroughStreet(actions, street) {
  const targetIndex = STREET_INDEX[street];
  if (targetIndex == null) {
    return [];
  }
  return actions.filter((action) => STREET_INDEX[action.street] <= targetIndex);
}

export function nextActionPlayer({ order, actions, street, foldedBeforeStreet = () => false, canAct = () => true }) {
  if (!Array.isArray(order) || order.length <= 1) {
    return null;
  }
  if (bettingRoundIsClosed({ order, actions, street, foldedBeforeStreet, canAct })) {
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
      nextIndex = activeOrder.length ? Math.min(actorIndex, activeOrder.length - 1) : -1;
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

export function bettingRoundIsClosed({ order, actions, street, foldedBeforeStreet = () => false, canAct = () => true }) {
  const streetActions = actionsForStreet(actions, street);
  let activeOrder = order.filter((player) => !foldedBeforeStreet(player) && canAct(player));
  if (activeOrder.length <= 1) {
    return true;
  }
  const actedSinceAggression = new Set();
  let hasVoluntaryAction = false;
  let currentBet = street === "preflop" ? 1 : 0;
  const committed = Object.fromEntries(activeOrder.map((player) => [player, 0]));
  if (street === "preflop" && activeOrder.length >= 2) {
    committed[activeOrder[activeOrder.length - 2]] = 0.5;
    committed[activeOrder[activeOrder.length - 1]] = 1;
  }

  for (const action of streetActions) {
    if (!activeOrder.includes(action.player)) {
      continue;
    }
    hasVoluntaryAction = true;
    if (action.type === "fold") {
      activeOrder = activeOrder.filter((player) => player !== action.player);
      delete committed[action.player];
      actedSinceAggression.delete(action.player);
      if (activeOrder.length <= 1) {
        return true;
      }
      continue;
    }
    if (action.amount != null) {
      committed[action.player] = (committed[action.player] || 0) + action.amount;
    }
    if (["bet", "raise", "all-in"].includes(action.type) && (committed[action.player] || 0) > currentBet) {
      currentBet = committed[action.player];
      actedSinceAggression.clear();
    }
    actedSinceAggression.add(action.player);
  }

  if (!hasVoluntaryAction) {
    return false;
  }
  return activeOrder.every((player) =>
    actedSinceAggression.has(player) &&
    Math.abs((committed[player] || 0) - currentBet) < 0.0001,
  );
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

export function actionLabel(action) {
  if (!action) {
    return "";
  }
  return action.amount != null ? `${action.type} ${formatAmount(action.amount)}` : action.type;
}

export function actionTagLabel(action, streetActions = []) {
  if (!action) {
    return "";
  }
  if (action.type === "bet" || action.type === "raise") {
    return aggressiveActionLabel(action, streetActions);
  }
  return action.type;
}

export function bettingStateForStreet({
  actions,
  street,
  order,
  stacks,
  smallBlindPlayer,
  bigBlindPlayer,
  smallBlind = 0.5,
  bigBlind = 1,
}) {
  const invested = Object.fromEntries(order.map((player) => [player, 0]));
  const streetCommitted = Object.fromEntries(order.map((player) => [player, 0]));
  let currentBet = 0;
  let lastRaiseSize = bigBlind;
  if (street === "preflop") {
    if (smallBlindPlayer && invested[smallBlindPlayer] != null) {
      invested[smallBlindPlayer] += smallBlind;
      streetCommitted[smallBlindPlayer] += smallBlind;
    }
    if (bigBlindPlayer && invested[bigBlindPlayer] != null) {
      invested[bigBlindPlayer] += bigBlind;
      streetCommitted[bigBlindPlayer] += bigBlind;
    }
    currentBet = bigBlind;
  }

  for (const action of actionsVisibleThroughStreet(actions, street)) {
    if (invested[action.player] == null) {
      continue;
    }
    const previousCurrentBet = currentBet;
    if (action.amount != null) {
      invested[action.player] += action.amount;
      if (action.street === street) {
        streetCommitted[action.player] += action.amount;
      }
    }
    if (action.street !== street || !["bet", "raise", "all-in"].includes(action.type) || action.amount == null) {
      continue;
    }
    const totalAfterAction = streetCommitted[action.player] || 0;
    if (totalAfterAction > currentBet) {
      lastRaiseSize = Math.max(lastRaiseSize, totalAfterAction - previousCurrentBet);
      currentBet = totalAfterAction;
    }
  }

  return {
    currentBet,
    lastRaiseSize,
    invested,
    streetCommitted,
    remainingStack: (player) => Math.max(0, (stacks[player] ?? 0) - (invested[player] ?? 0)),
    toCall: (player) => Math.max(0, currentBet - (streetCommitted[player] ?? 0)),
  };
}

export function legalActionPlan({ player, street, state, bigBlind = 1 }) {
  if (!player) {
    return { actions: [], toCall: 0, remaining: 0, minBet: bigBlind, minRaiseAmount: bigBlind, maxAmount: 0 };
  }
  const remaining = state.remainingStack(player);
  const toCall = state.toCall(player);
  if (remaining <= 0) {
    return { actions: [], toCall, remaining, minBet: bigBlind, minRaiseAmount: 0, maxAmount: 0 };
  }
  if (toCall > 0) {
    const callAmount = Math.min(toCall, remaining);
    const minRaiseAmount = Math.min(remaining, toCall + state.lastRaiseSize);
    const actions = ["fold", "call"];
    if (remaining > toCall) {
      actions.push("raise");
    }
    actions.push("all-in");
    return { actions, toCall, callAmount, remaining, minBet: bigBlind, minRaiseAmount, maxAmount: remaining };
  }
  return {
    actions: ["check", "bet", "all-in"],
    toCall,
    callAmount: 0,
    remaining,
    minBet: Math.min(bigBlind, remaining),
    minRaiseAmount: Math.min(bigBlind, remaining),
    maxAmount: remaining,
  };
}

export function formatAmount(value) {
  const amount = normalizeAmount(value);
  return Number.isInteger(amount) ? `${amount}` : `${amount.toFixed(1)}`;
}

function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number");
  }
  return Math.round(amount * 10) / 10;
}

function aggressiveActionLabel(action, streetActions) {
  const aggressiveActions = streetActions.filter((streetAction) =>
    streetAction.type === "bet" || streetAction.type === "raise" || streetAction.type === "all-in",
  );
  const actionIndex = Math.max(0, aggressiveActions.findIndex((streetAction) => streetAction.id === action.id));
  if (actionIndex === 0) {
    return "bets";
  }
  if (actionIndex === 1) {
    return "raises";
  }
  return `${actionIndex + 2}bets`;
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
