import { escapeHtml } from "./ui.mjs";
import {
  ACTION_STREETS,
  actionTagLabel,
  bettingStateForStreet,
  formatAmount,
  forcedBlindActionTags,
  legalActionPlan,
  nextActionPlayer,
  playerHasFoldedByStreet,
} from "./player_actions.mjs";
import {
  actionCountBeforeStreet,
  actionCountsForStreet,
  actionCountThroughStreet,
  visibleActionsForStreet,
} from "./visible_hand_snapshot.mjs";
import {
  actionPositionsForStreet,
  positionDisplayName,
  positionFromPageKey,
  positionPageKey,
} from "./table_positions.mjs";

export function actionPanelViewModel({
  handState,
  tableConfig,
  playerActions,
  visibleSnapshot,
  currentStreet = handState?.round || null,
  pendingSizingActionType = null,
  empiricalEvidenceForAction = () => ({ status: "fallback" }),
}) {
  if (!handState || !currentStreet) {
    return null;
  }
  const helpers = actionHelpers({ handState, tableConfig, playerActions, visibleSnapshot });
  const visibleActions = helpers.visiblePlayerActionsForStreet(currentStreet);
  const currentActor = visibleSnapshot.isViewingLatestMoment ? helpers.currentActionActor(currentStreet) : null;
  const actionPlan = currentActor ? helpers.legalActionPlanForActor(currentActor.id, currentStreet) : { actions: [] };
  return {
    street: currentStreet,
    visibleActions,
    currentActor,
    actionPlan,
    pendingSizingActionType,
    actionPlayerLabel: helpers.actionPlayerLabel,
    visibleActionStreets: helpers.visibleActionStreets,
    displayActionsForStreet: helpers.displayActionsForStreet,
    lastRemovableActionId: () => helpers.lastRemovableActionId(currentStreet),
    empiricalEvidenceForAction,
    replayLabel: visibleSnapshot.isViewingLatestMoment ? "Action closed" : "Replay",
  };
}

export function renderPlayerActionsHtml(model) {
  if (!model) {
    return "";
  }
  return `
    <div class="action-history">
      ${model.visibleActionStreets(model.street).map((streetName) => actionStreetSectionHtml(model, streetName)).join("")}
    </div>
    <div class="action-composer" data-action-composer data-current-action-player="${escapeHtml(model.currentActor?.id || "")}">
      <span class="action-current-player">${model.currentActor ? `${escapeHtml(model.actionPlayerLabel(model.currentActor.id))} to act` : model.replayLabel}</span>
      ${model.currentActor ? actionButtonsHtml(model.actionPlan, model.pendingSizingActionType) : ""}
    </div>
  `;
}

export function actionHelpers({ handState, tableConfig, playerActions, visibleSnapshot }) {
  const currentStreet = handState?.round || null;

  function visiblePlayerActionsForStreet(street = currentStreet) {
    return visibleActionsForStreet(visibleSnapshot, street);
  }

  function currentActionActor(street = currentStreet) {
    const order = actionPlayerOrder(street);
    const actorId = nextActionPlayer({
      order: order.map((player) => player.id),
      actions: visiblePlayerActionsForStreet(street),
      street,
      foldedBeforeStreet: (playerId) => playerIsFoldedBeforeStreet(playerId, street),
      canAct: (playerId) => bettingStateForCurrentStreet(street).remainingStack(playerId) > 0,
    });
    if (!actorId) {
      return null;
    }
    return order.find((player) => player.id === actorId) || null;
  }

  function actionPlayerOrder(street = currentStreet) {
    return actionPositionsForStreet(tableConfig, street).map((position) => ({
      id: position === tableConfig.heroPosition ? "hero" : positionPageKey(position),
      position,
      label: position === tableConfig.heroPosition
        ? `Hero (${positionDisplayName(position)})`
        : positionDisplayName(position),
    }));
  }

  function legalActionPlanForActor(playerId, street = currentStreet) {
    return legalActionPlan({
      player: playerId,
      street,
      state: bettingStateForCurrentStreet(street),
    });
  }

  function bettingStateForCurrentStreet(street = currentStreet) {
    const order = actionPlayerOrder(street).map((player) => player.id);
    return bettingStateForStreet({
      actions: visiblePlayerActionsForStreet(street),
      street,
      order,
      stacks: playerStacksById(),
      smallBlindPlayer: playerIdForPosition("SB"),
      bigBlindPlayer: playerIdForPosition("BB"),
    });
  }

  function playerStacksById() {
    return Object.fromEntries(
      tableConfig.positions.map((position) => [playerIdForPosition(position), tableConfig.playerStacks?.[position] || 100]),
    );
  }

  function playerIdForPosition(position) {
    return position === tableConfig.heroPosition ? "hero" : positionPageKey(position);
  }

  function playerIsFoldedBeforeStreet(playerId, street) {
    if (playerId === "hero") {
      return playerHasFoldedByStreet(visiblePlayerActionsForStreet(street), playerId, previousActionStreet(street));
    }
    const position = positionFromPageKey(playerId);
    return Boolean(position && playerHasFoldedByStreet(visiblePlayerActionsForStreet(street), playerId, previousActionStreet(street)));
  }

  function previousActionStreet(street) {
    const index = ACTION_STREETS.indexOf(street);
    return index > 0 ? ACTION_STREETS[index - 1] : null;
  }

  function visibleActionStreets(street) {
    const index = ACTION_STREETS.indexOf(street);
    return ACTION_STREETS.slice(0, index + 1);
  }

  function displayActionsForStreet(visibleActions, street) {
    const streetActions = visibleActions.filter((action) => action.street === street);
    if (street !== "preflop") {
      return streetActions;
    }
    return [
      ...forcedBlindActionTags({
        smallBlindPlayer: playerIdForPosition("SB"),
        bigBlindPlayer: playerIdForPosition("BB"),
      }),
      ...streetActions,
    ];
  }

  function lastRemovableActionId(street = currentStreet) {
    if (!visibleSnapshot.isViewingLatestMoment) {
      return null;
    }
    const visibleActions = visiblePlayerActionsForStreet(street)
      .filter((action) => action.street === street);
    return visibleActions.at(-1)?.id || null;
  }

  function actionPlayerLabel(playerId) {
    if (playerId === "hero") {
      return tableConfig.heroPosition;
    }
    return positionFromPageKey(playerId) || playerId;
  }

  return {
    visiblePlayerActionsForStreet,
    currentActionActor,
    actionPlayerOrder,
    legalActionPlanForActor,
    bettingStateForCurrentStreet,
    playerStacksById,
    playerIdForPosition,
    playerIsFoldedBeforeStreet,
    previousActionStreet,
    visibleActionStreets,
    actionCountThroughStreet: (street) => actionCountThroughStreet(playerActions, street),
    actionCountBeforeStreet: (street) => actionCountBeforeStreet(playerActions, street),
    actionCountsForStreet: (street) => actionCountsForStreet(playerActions, street),
    displayActionsForStreet,
    lastRemovableActionId,
    actionPlayerLabel,
  };
}

export function actionTypeLabel(type) {
  return type === "all-in" ? "All-in" : type;
}

function actionStreetSectionHtml(model, street) {
  const streetActions = model.displayActionsForStreet(model.visibleActions, street);
  const removableActionId = model.lastRemovableActionId();
  const empty = streetActions.length
    ? ""
    : `<span class="action-empty">No actions</span>`;
  return `
    <div class="action-street-section" data-action-street="${street}">
      <span class="action-street" data-street="${street}">${street}</span>
      <div class="action-tags">
        ${empty}
        ${streetActions.map((action) => actionTagHtml(model, action, streetActions, action.id === removableActionId)).join("")}
      </div>
    </div>
  `;
}

function actionTagHtml(model, action, streetActions, isRemovable = false) {
  if (action.forced) {
    return `
      <span class="action-tag action-tag-forced" data-street="${action.street}" title="${escapeHtml(model.actionPlayerLabel(action.player))} ${escapeHtml(actionTagLabel(action, streetActions))}">
        <span class="action-tag-player">${escapeHtml(model.actionPlayerLabel(action.player))}</span>
        <span>${escapeHtml(actionTagLabel(action, streetActions))}</span>
      </span>
    `;
  }
  const evidence = model.empiricalEvidenceForAction(action);
  const title = escapeHtml(actionEvidenceTitle(model, action, evidence, isRemovable));
  const inner = `
    <span class="action-tag-player">${escapeHtml(model.actionPlayerLabel(action.player))}</span>
    <span>${escapeHtml(actionTagLabel(action, streetActions))}</span>
    <span class="empirical-dot ${evidence.status}" aria-hidden="true"></span>
    ${isRemovable ? '<span class="action-tag-delete" aria-hidden="true">x</span>' : ""}
  `;
  if (!isRemovable) {
    return `
      <span class="action-tag action-tag-locked" data-street="${action.street}" title="${title}">
        ${inner}
      </span>
    `;
  }
  return `
    <button class="action-tag" type="button" data-delete-action="${escapeHtml(action.id)}" data-street="${action.street}" title="${title}">
      ${inner}
    </button>
  `;
}

function actionEvidenceTitle(model, action, evidence, isRemovable = true) {
  const base = `${isRemovable ? "Delete latest action" : "Locked action"} · ${model.actionPlayerLabel(action.player)} ${action.type}`;
  if (evidence.status === "ready") {
    const payload = evidence.payload;
    return `${base} · empirical ${payload.request.position} ${payload.request.street}, ${formatInteger(payload.source.actions)} actions`;
  }
  if (evidence.status === "pending") {
    return `${base} · empirical evidence loading`;
  }
  return `${base} · heuristic fallback`;
}

function actionButtonsHtml(actionPlan, pendingSizingActionType) {
  if (pendingSizingActionType && actionPlan.actions.includes(pendingSizingActionType)) {
    const minAmount = pendingSizingActionType === "bet" ? actionPlan.minBet : actionPlan.minRaiseAmount;
    const maxAmount = actionPlan.maxAmount;
    const value = Math.max(minAmount, Math.min(maxAmount, Math.round((minAmount + maxAmount) / 2)));
    return `
      <div class="action-sizing" data-sizing-action="${pendingSizingActionType}">
        <span class="sizing-label">${actionTypeLabel(pendingSizingActionType)}</span>
        <input class="sizing-slider" type="range" min="${minAmount}" max="${maxAmount}" step="1" value="${value}" data-sizing-slider>
        <output class="sizing-output" data-sizing-output>${formatAmount(value)}</output>
        <button class="action-button action-add-button" type="button" data-confirm-sized-action>OK</button>
        <button class="action-button" type="button" data-cancel-sized-action>Cancel</button>
      </div>
    `;
  }
  return `
    <span class="action-buttons">
      ${actionPlan.actions.map((type) => `
        <button class="action-button ${type === "bet" || type === "raise" ? "action-sized-button" : ""}" type="button" data-instant-action="${type}">
          ${actionTypeLabel(type)}
        </button>
      `).join("")}
    </span>
  `;
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString();
}
