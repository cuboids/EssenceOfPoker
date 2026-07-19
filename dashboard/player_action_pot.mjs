import {
  DEFAULT_BIG_BLIND,
  DEFAULT_SMALL_BLIND,
  STREET_INDEX,
} from "./player_action_constants.mjs";

/**
 * @typedef {{id?: string, player: string, street: string, type: string, amount?: number, forced?: boolean}} PlayerAction
 * @typedef {{[player: string]: number}} StackMap
 * @typedef {{actions: PlayerAction[], street: string, order: string[], stacks: StackMap, smallBlindPlayer?: string | null, bigBlindPlayer?: string | null, smallBlind?: number, bigBlind?: number}} BettingStateOptions
 */

/**
 * @param {BettingStateOptions} options
 */
export function bettingStateForStreet({
  actions,
  street,
  order,
  stacks,
  smallBlindPlayer,
  bigBlindPlayer,
  smallBlind = DEFAULT_SMALL_BLIND,
  bigBlind = DEFAULT_BIG_BLIND,
}) {
  const invested = Object.fromEntries(order.map((player) => [player, 0]));
  const streetCommitted = Object.fromEntries(order.map((player) => [player, 0]));
  let currentBet = 0;
  let lastFullRaiseSize = bigBlind;
  const actedSinceFullRaise = new Set();
  const committedAtLastAction = Object.fromEntries(order.map((player) => [player, 0]));
  if (smallBlindPlayer && invested[smallBlindPlayer] != null) {
    invested[smallBlindPlayer] += smallBlind;
    if (street === "preflop") {
      streetCommitted[smallBlindPlayer] += smallBlind;
      committedAtLastAction[smallBlindPlayer] = smallBlind;
    }
  }
  if (bigBlindPlayer && invested[bigBlindPlayer] != null) {
    invested[bigBlindPlayer] += bigBlind;
    if (street === "preflop") {
      streetCommitted[bigBlindPlayer] += bigBlind;
      committedAtLastAction[bigBlindPlayer] = bigBlind;
    }
  }
  if (street === "preflop") {
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
      if (action.street === street) {
        actedSinceFullRaise.add(action.player);
        committedAtLastAction[action.player] = streetCommitted[action.player] || 0;
      }
      continue;
    }
    const totalAfterAction = streetCommitted[action.player] || 0;
    if (totalAfterAction > currentBet) {
      const raiseSize = totalAfterAction - previousCurrentBet;
      if (raiseSize >= lastFullRaiseSize - 0.0001) {
        lastFullRaiseSize = raiseSize;
        actedSinceFullRaise.clear();
      }
      currentBet = totalAfterAction;
    }
    if (action.street === street) {
      actedSinceFullRaise.add(action.player);
      committedAtLastAction[action.player] = streetCommitted[action.player] || 0;
    }
  }

  return {
    currentBet,
    lastRaiseSize: lastFullRaiseSize,
    lastFullRaiseSize,
    invested,
    streetCommitted,
    committedAtLastAction,
    potSize: sumValues(invested),
    totalInvested: (player) => invested[player] ?? 0,
    streetContribution: (player) => streetCommitted[player] ?? 0,
    hasActedSinceFullRaise: (player) => actedSinceFullRaise.has(player),
    canRaise: (player) =>
      !actedSinceFullRaise.has(player) ||
      currentBet - (committedAtLastAction[player] ?? 0) >= lastFullRaiseSize - 0.0001,
    remainingStack: (player) => Math.max(0, (stacks[player] ?? 0) - (invested[player] ?? 0)),
    toCall: (player) => Math.max(0, currentBet - (streetCommitted[player] ?? 0)),
    minRaiseTo: () => currentBet + lastFullRaiseSize,
    minRaiseAmount: (player) => Math.max(0, currentBet - (streetCommitted[player] ?? 0)) + lastFullRaiseSize,
  };
}

export function legalActionPlan({ player, street, state, bigBlind = DEFAULT_BIG_BLIND }) {
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
    const minRaiseAmount = state.minRaiseAmount?.(player) ?? toCall + state.lastRaiseSize;
    const canRaise = state.canRaise?.(player) ?? true;
    const canMakeFullRaise = remaining >= minRaiseAmount - 0.0001;
    const actions = ["fold", "call"];
    if (remaining > toCall) {
      if (canRaise && canMakeFullRaise) {
        actions.push("raise");
      }
      if (canRaise) {
        actions.push("all-in");
      }
    }
    return {
      actions,
      toCall,
      callAmount,
      remaining,
      minBet: bigBlind,
      minRaiseAmount,
      canRaise,
      canMakeFullRaise,
      maxAmount: remaining,
    };
  }
  const actions = ["check"];
  if (remaining >= bigBlind - 0.0001) {
    actions.push("bet");
  }
  actions.push("all-in");
  return {
    actions,
    toCall,
    callAmount: 0,
    remaining,
    minBet: bigBlind,
    minRaiseAmount: bigBlind,
    maxAmount: remaining,
  };
}

function actionsVisibleThroughStreet(actions, street) {
  const targetIndex = STREET_INDEX[street];
  if (targetIndex == null) {
    return [];
  }
  return actions.filter((action) => STREET_INDEX[action.street] <= targetIndex);
}

function sumValues(record) {
  return Object.values(record).reduce((total, value) => total + Number(value || 0), 0);
}
