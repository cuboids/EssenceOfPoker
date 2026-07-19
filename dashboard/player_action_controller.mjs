import {
  actionHelpers,
  actionPanelViewModel,
  renderPlayerActionsHtml,
} from "./action_panel.mjs";
import {
  appendLegalPlayerAction,
  deletePlayerAction,
  formatAmount,
} from "./player_actions.mjs";
import {
  actionCountBeforeStreet as visibleSnapshotActionCountBeforeStreet,
  actionCountsForStreet as visibleSnapshotActionCountsForStreet,
  actionCountThroughStreet as visibleSnapshotActionCountThroughStreet,
  visibleActionsForStreet as visibleSnapshotActionsForStreet,
} from "./visible_hand_snapshot.mjs";

export function createPlayerActionController(deps) {
  let pendingSizingActionType = null;

  function renderPlayerActions() {
    const container = deps.documentRef.getElementById("action-controls");
    if (!container || deps.activePage() === "config" || !deps.handState()) {
      if (container) {
        container.innerHTML = "";
      }
      return;
    }
    container.innerHTML = renderPlayerActionsHtml(actionPanelView());
  }

  function actionPanelView() {
    return actionPanelViewModel({
      handState: deps.handState(),
      tableConfig: deps.tableConfig(),
      playerActions: deps.playerActions(),
      visibleSnapshot: deps.refreshVisibleHandSnapshot(),
      currentStreet: currentActionStreet(),
      pendingSizingActionType,
      empiricalEvidenceForAction: deps.empiricalEvidenceForAction,
    });
  }

  function currentActionStreet() {
    return deps.handState()?.round || null;
  }

  function visiblePlayerActionsForCurrentStreet(street = currentActionStreet()) {
    return visibleSnapshotActionsForStreet(deps.refreshVisibleHandSnapshot(), street);
  }

  function currentActionPrefix() {
    return deps.refreshVisibleHandSnapshot().currentActionPrefix;
  }

  function currentViewedActionCount() {
    return deps.refreshVisibleHandSnapshot().viewedActionCount;
  }

  function currentActionActor(street = currentActionStreet()) {
    return currentActionHelpers().currentActionActor(street);
  }

  function actionPlayerOrder(street = currentActionStreet()) {
    return currentActionHelpers().actionPlayerOrder(street);
  }

  function legalActionPlanForActor(playerId, street = currentActionStreet()) {
    return currentActionHelpers().legalActionPlanForActor(playerId, street);
  }

  function bettingStateForCurrentStreet(street = currentActionStreet()) {
    return currentActionHelpers().bettingStateForCurrentStreet(street);
  }

  function playerStacksById() {
    return currentActionHelpers().playerStacksById();
  }

  function playerIdForPosition(position) {
    return currentActionHelpers().playerIdForPosition(position);
  }

  function playerIsFoldedBeforeStreet(playerId, street) {
    return currentActionHelpers().playerIsFoldedBeforeStreet(playerId, street);
  }

  function previousActionStreet(street) {
    return currentActionHelpers().previousActionStreet(street);
  }

  function visibleActionStreets(street) {
    return currentActionHelpers().visibleActionStreets(street);
  }

  function actionCountThroughStreet(street) {
    return visibleSnapshotActionCountThroughStreet(deps.playerActions(), street);
  }

  function actionCountBeforeStreet(street) {
    return visibleSnapshotActionCountBeforeStreet(deps.playerActions(), street);
  }

  function actionCountsForStreet(street) {
    return visibleSnapshotActionCountsForStreet(deps.playerActions(), street);
  }

  function lastRemovableActionId() {
    return currentActionHelpers().lastRemovableActionId();
  }

  function actionPlayerLabel(playerId) {
    return currentActionHelpers().actionPlayerLabel(playerId);
  }

  function currentActionHelpers() {
    return actionHelpers({
      handState: deps.handState(),
      tableConfig: deps.tableConfig(),
      playerActions: deps.playerActions(),
      visibleSnapshot: deps.refreshVisibleHandSnapshot(),
    });
  }

  function handlePlayerActionClick(event) {
    const deleteButton = event.target.closest("[data-delete-action]");
    if (deleteButton) {
      deleteAction(deleteButton.dataset.deleteAction);
      return;
    }
    const cancelSizing = event.target.closest("[data-cancel-sized-action]");
    if (cancelSizing) {
      pendingSizingActionType = null;
      deps.renderHoldingDisplay();
      return;
    }
    const confirmSizing = event.target.closest("[data-confirm-sized-action]");
    if (confirmSizing) {
      const sizing = confirmSizing.closest("[data-sizing-action]");
      const composer = confirmSizing.closest("[data-action-composer]");
      applyCurrentPlayerAction({
        type: sizing.dataset.sizingAction,
        amount: Number(sizing.querySelector("[data-sizing-slider]")?.value),
        composer,
      });
      return;
    }
    const instantButton = event.target.closest("[data-instant-action]");
    if (!instantButton) {
      return;
    }
    const type = instantButton.dataset.instantAction;
    if (type === "bet" || type === "raise") {
      pendingSizingActionType = type;
      deps.renderHoldingDisplay();
      return;
    }
    applyCurrentPlayerAction({
      type,
      composer: instantButton.closest("[data-action-composer]"),
    });
  }

  function applyCurrentPlayerAction({ type, amount = null, composer }) {
    const player = composer?.dataset.currentActionPlayer;
    const plan = player ? legalActionPlanForActor(player, currentActionStreet()) : null;
    const action = {
      player,
      street: currentActionStreet(),
      type,
    };
    if (type === "call") {
      action.amount = plan?.callAmount || 0;
    } else if (type === "all-in") {
      action.amount = plan?.remaining || 0;
    } else if (type === "bet" || type === "raise") {
      action.amount = amount;
    }
    applyPlayerAction(action);
  }

  function handleRaisePercentChange(event) {
    if (!event.target.matches("[data-sizing-slider]")) {
      return;
    }
    const output = event.target.closest("[data-sizing-action]")?.querySelector("[data-sizing-output]");
    if (output) {
      output.textContent = formatAmount(event.target.value);
    }
  }

  function applyPlayerAction(action) {
    try {
      deps.setPlayerActions(appendLegalPlayerAction(deps.playerActions(), action, actionLegalityContext()));
    } catch {
      return;
    }
    deps.setViewedActionCount(null);
    pendingSizingActionType = null;
    refreshAfterPlayerActionChange();
  }

  function deleteAction(actionId) {
    if (actionId !== lastRemovableActionId()) {
      return;
    }
    deps.setPlayerActions(deletePlayerAction(deps.playerActions(), actionId));
    deps.setViewedActionCount(null);
    pendingSizingActionType = null;
    refreshAfterPlayerActionChange();
  }

  function actionLegalityContext() {
    return {
      orderForStreet: (street) => actionPlayerOrder(street).map((player) => player.id),
      stacks: playerStacksById(),
      smallBlindPlayer: playerIdForPosition("SB"),
      bigBlindPlayer: playerIdForPosition("BB"),
    };
  }

  function refreshAfterPlayerActionChange() {
    deps.bumpCurveComputationToken();
    deps.setActionMomentCache(new Map());
    deps.setCurrentCurves(deps.handState() ? {} : deps.priorCurvesByPage(deps.dashboardData()));
    deps.resetWinShareState();
    deps.updateCurrentStreetSnapshot();
    deps.renderPortfolioTabs();
    deps.renderHoldingDisplay();
    deps.updatePageTabs();
    deps.updateLegend();
    deps.updateStreetNavButtons();
    deps.renderCalibrationStatus();
    deps.renderAssets();
  }

  return {
    actionCountBeforeStreet,
    actionCountsForStreet,
    actionCountThroughStreet,
    actionPanelView,
    actionPlayerLabel,
    actionPlayerOrder,
    bettingStateForCurrentStreet,
    currentActionActor,
    currentActionPrefix,
    currentActionStreet,
    currentViewedActionCount,
    handlePlayerActionClick,
    handleRaisePercentChange,
    lastRemovableActionId,
    legalActionPlanForActor,
    playerIdForPosition,
    playerIsFoldedBeforeStreet,
    playerStacksById,
    previousActionStreet,
    renderPlayerActions,
    visibleActionStreets,
    visiblePlayerActionsForCurrentStreet,
  };
}
