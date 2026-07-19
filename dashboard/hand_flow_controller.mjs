import * as HandModel from "./hand_state.mjs";
import { handViewFromModel } from "./hand_view.mjs";
import { cardCompare, cardId, hasDuplicateCards, sameCard } from "./cards.mjs";
import { readRandomInterestingHand } from "./data_client.mjs";
import {
  interestingHandToAppState,
  modelFromImportedHandReplay,
} from "./imported_hand_replay.mjs";
import {
  cloneCacheObject,
  cloneHandModel,
  clonePlayerActions,
  cloneShowdownHoleCardsByPlayer,
  recordStreetSnapshot,
  updateStreetSnapshot,
} from "./street_snapshots.mjs";
import {
  actionCountThroughStreet as visibleSnapshotActionCountThroughStreet,
  actionMomentCacheKey as visibleSnapshotActionMomentCacheKey,
  actionStreetForHandModel as visibleSnapshotActionStreetForHandModel,
  cacheVisibleHandSnapshot,
  resolveVisibleHandSnapshot,
  visibleHandSnapshotForMoment,
} from "./visible_hand_snapshot.mjs";

export function createHandFlowController(deps) {
  function handleCardEditClick(event) {
    const action = event.target.closest("[data-card-edit-action]");
    if (action) {
      handleCardEditorAction(action);
      return;
    }

    const button = event.target.closest("[data-card-token]");
    if (!button) {
      return;
    }
    const token = button.dataset.cardToken;
    if (!deps.handState() && token !== "H_1" && token !== "H_2") {
      return;
    }
    deps.setEditingCardToken(token);
    deps.setCardEditError("");
    deps.renderHoldingDisplay();
  }

  async function handleCardEditorAction(action) {
    const editor = action.closest("[data-editor-token]");
    const token = editor?.dataset.editorToken;
    if (!token) {
      return;
    }
    if (action.dataset.cardEditAction === "cancel") {
      deps.setEditingCardToken(null);
      deps.setCardEditError("");
      deps.renderHoldingDisplay();
      return;
    }
    const rank = Number(editor.querySelector("[data-card-editor-rank]")?.value);
    const suit = Number(editor.querySelector("[data-card-editor-suit]")?.value);
    const nextCard = { rank, suit, id: cardId({ rank, suit }) };
    if (!deps.handState()) {
      await applyPendingHoleCardEdit(token, nextCard);
      return;
    }
    const result = applyCardEdit(token, nextCard);
    if (!result.ok) {
      deps.setCardEditError(result.message);
      deps.renderHoldingDisplay();
      return;
    }
    deps.setEditingCardToken(null);
    deps.setCardEditError("");
    deps.bumpCurveComputationToken();
    deps.setViewedActionCount(null);
    deps.setActionMomentCache(new Map());
    deps.setCurrentCurves({});
    deps.resetWinShareState();
    rebuildTimelineForCurrentHand();
    finishRoundDeal();
  }

  async function applyPendingHoleCardEdit(token, nextCard) {
    const index = token === "H_1" ? 0 : 1;
    const nextPending = [...HandModel.pendingHoleCards(deps.handModel())];
    nextPending[index] = nextCard;
    if (hasDuplicateCards(nextPending.filter(Boolean))) {
      deps.setCardEditError("That card is already in the other hole-card slot.");
      deps.renderHoldingDisplay();
      return;
    }
    deps.setEditingCardToken(null);
    deps.setCardEditError("");
    if (nextPending.every(Boolean)) {
      await startPreflopFromHoleCards(nextPending);
      return;
    }
    deps.setHandModel(HandModel.setPendingHoleCard(deps.handModel(), token, nextCard));
    syncHandStateFromModel();
    deps.renderHoldingDisplay();
  }

  function applyCardEdit(token, nextCard) {
    if ((token === "V_1" || token === "V_2") && deps.villainShowdown() && deps.isOpponentPage(deps.activePage())) {
      return applyShowdownVillainCardEdit(deps.activePage(), token, nextCard);
    }
    try {
      deps.setHandModel(HandModel.editKnownCardModel(deps.handModel(), token, nextCard));
    } catch (error) {
      if (!HandModel.isShowdown(deps.handModel()) && error.message.includes("replacement villain cards")) {
        const currentCard = deps.cardForTokenOnPage(token, deps.activePage());
        const physicals = HandModel.physicalCardsFromModel(deps.handModel());
        const editedVisibleCards = [
          ...physicals.hole,
          ...physicals.flop,
          physicals.turn,
          physicals.river,
        ]
          .filter(Boolean)
          .map((card) => (currentCard && sameCard(card, currentCard) ? nextCard : card));
        const replacementVillain = deps.dealCardsFromDeck(deps.remainingDeckForKnownCards(editedVisibleCards), 2).sort(cardCompare);
        deps.setHandModel(HandModel.editKnownCardModel(deps.handModel(), token, nextCard, replacementVillain));
      } else {
        return { ok: false, message: error.message };
      }
    }
    syncHandStateFromModel();
    return { ok: true };
  }

  function applyShowdownVillainCardEdit(page, token, nextCard) {
    const currentCards = deps.showdownHoleCardsForPlayer(page);
    if (currentCards.length !== 2) {
      return { ok: false, message: "No showdown cards are available for this player." };
    }
    const nextCards = [...currentCards];
    nextCards[token === "V_1" ? 0 : 1] = nextCard;
    const otherRevealedCards = Object.entries(deps.showdownHoleCardsByPlayer())
      .filter(([playerId]) => playerId !== page)
      .flatMap(([, cards]) => cards);
    const handState = deps.handState();
    const visibleCards = [
      handState.h1,
      handState.h2,
      ...handState.flop,
      handState.turn,
      handState.river,
      ...otherRevealedCards,
      ...nextCards,
    ].filter(Boolean);
    if (hasDuplicateCards(visibleCards)) {
      return { ok: false, message: "That card is already dealt somewhere else in this hand." };
    }
    deps.setShowdownHoleCardsByPlayer({
      ...deps.showdownHoleCardsByPlayer(),
      [page]: nextCards.sort(cardCompare),
    });
    return { ok: true };
  }

  function rebuildTimelineForCurrentHand({ viewedIndex = deps.viewedStreetIndex(), preserveStreetModels = false } = {}) {
    const currentModel = cloneHandModel(deps.handModel());
    const timeline = HandModel.rebuildTimeline(deps.handModel()).map((model) => ({
      handModel: cloneHandModel(model),
      currentCurves: {},
      currentWinShares: {},
      playerActions: clonePlayerActions(deps.playerActions()),
      showdownHoleCardsByPlayer: cloneShowdownHoleCardsByPlayer(deps.showdownHoleCardsByPlayer()),
    }));
    const viewedStreetIndex = Math.min(Math.max(viewedIndex, 0), timeline.length - 1);
    if (!preserveStreetModels) {
      timeline[viewedStreetIndex].handModel = currentModel;
    }
    deps.setHandTimeline(timeline);
    deps.setViewedStreetIndex(viewedStreetIndex);
  }

  function resetNewHand() {
    deps.advanceHeroPositionForNewHand();
    deps.setHandModel(HandModel.emptyHandModel());
    syncHandStateFromModel();
    deps.setShowdownHoleCardsByPlayer({});
    deps.setHandTimeline([]);
    deps.setPlayerActions([]);
    deps.setViewedStreetIndex(-1);
    deps.setViewedActionCount(null);
    deps.setActionMomentCache(new Map());
    deps.setEditingCardToken(null);
    deps.setCardEditError("");
    deps.bumpCurveComputationToken();
    deps.setCurrentCurves(deps.priorCurvesByPage(deps.dashboardData()));
    deps.setPriorNaturalXMaps(deps.priorNaturalXMapsByPage(deps.currentCurves()));
    deps.resetWinShareState();
    deps.renderPortfolioTabs();
    deps.renderHoldingDisplay();
    deps.updateRoundButton();
    deps.updateStreetNavButtons();
    deps.updatePageTabs();
    deps.updateLegend();
    deps.renderAssets();
    if (deps.focusedAsset()) {
      deps.openFocus(deps.focusedAsset());
    }
  }

  async function loadRandomInterestingHand() {
    const button = deps.documentRef.getElementById("interesting-hand-button");
    button.disabled = true;
    button.classList.add("is-loading");
    button.title = "Loading random interesting hand";
    try {
      const payload = await readRandomInterestingHand();
      if (!payload?.hand) {
        deps.setCardEditError(payload?.error || "No dashboard-compatible interesting hand is available.");
        deps.renderHoldingDisplay();
        return;
      }
      try {
        loadInterestingHand(payload);
      } catch (error) {
        deps.setCardEditError(`Could not load interesting hand${error?.message ? `: ${error.message}` : "."}`);
        deps.renderHoldingDisplay();
      }
    } finally {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.title = "Random interesting hand";
    }
  }

  function loadInterestingHand(payload) {
    const imported = interestingHandToAppState(payload.hand);
    deps.setTableConfig(deps.normalizeTableConfig(imported.tableConfig));
    deps.persistTableConfig();
    deps.rebuildDashboardPortfolios();
    deps.setHandModel(modelFromImportedHandReplay(imported, {
      dealHoleCards: deps.dealHoleCards,
      dealCardsFromDeck: deps.dealCardsFromDeck,
      remainingDeckForKnownCards: deps.remainingDeckForKnownCards,
    }));
    syncHandStateFromModel();
    deps.setShowdownHoleCardsByPlayer(imported.showdownHoleCardsByPlayer);
    deps.setPlayerActions(imported.playerActions);
    deps.setViewedActionCount(0);
    deps.setActionMomentCache(new Map());
    deps.setActivePage("hero");
    deps.setFocusedAsset(null);
    deps.setEditingCardToken(null);
    deps.setCardEditError("");
    deps.bumpCurveComputationToken();
    deps.setCurrentCurves({});
    deps.setPriorNaturalXMaps(deps.priorNaturalXMapsByPage(deps.priorCurvesByPage(deps.dashboardData())));
    deps.resetWinShareState();
    rebuildTimelineForCurrentHand({ viewedIndex: 0, preserveStreetModels: true });
    deps.setHandModel(cloneHandModel(deps.handTimeline()[deps.viewedStreetIndex()].handModel));
    syncHandStateFromModel();
    deps.setCurrentCurves(cloneCacheObject(deps.handTimeline()[deps.viewedStreetIndex()].currentCurves || {}));
    deps.setCurrentWinShares(cloneCacheObject(deps.handTimeline()[deps.viewedStreetIndex()].currentWinShares || {}));
    updateCurrentStreetSnapshot();
    deps.renderPortfolioTabs();
    deps.renderCalibrationStatus();
    deps.renderCachedStreet();
  }

  function dealNewRound() {
    const handState = deps.handState();
    if (handState?.round === "river") {
      return;
    }

    const button = deps.documentRef.getElementById("new-round-button");
    button.disabled = true;
    button.textContent = "Dealing...";

    setTimeout(() => {
      const latestHandState = deps.handState();
      if (!latestHandState) {
        dealPreflopRound();
      } else if (latestHandState.round === "preflop") {
        dealFlopRound();
      } else if (latestHandState.round === "flop") {
        dealTurnRound();
      } else {
        dealRiverRound();
      }
    }, 20);
  }

  function dealPreflopRound() {
    const selectedHoleCards = HandModel.pendingHoleCards(deps.handModel()).filter(Boolean);
    const [h1, h2] = selectedHoleCards.length
      ? dealHoleCardsAroundPendingCards(selectedHoleCards)
      : deps.dealHoleCards();
    startPreflopFromHoleCards([h1, h2]);
  }

  function dealHoleCardsAroundPendingCards(selectedHoleCards) {
    if (selectedHoleCards.length === 2) {
      return selectedHoleCards.sort(cardCompare);
    }
    const [drawnCard] = deps.dealCardsFromDeck(deps.remainingDeckForKnownCards(selectedHoleCards), 1);
    return [...selectedHoleCards, drawnCard].sort(cardCompare);
  }

  function startPreflopFromHoleCards(holeCards) {
    const [h1, h2] = [...holeCards].sort(cardCompare);
    const [v1, v2] = deps.dealCardsFromDeck(deps.remainingDeckForKnownCards([h1, h2]), 2).sort(cardCompare);
    deps.setHandModel(HandModel.startPreflopModel([h1, h2], [v1, v2]));
    deps.setShowdownHoleCardsByPlayer({});
    syncHandStateFromModel();
    recordCurrentStreet();
    deps.bumpCurveComputationToken();
    deps.setActionMomentCache(new Map());
    deps.setCurrentCurves({});
    deps.resetWinShareState();
    deps.queuePreflopClassDataLoad(h1, h2);

    finishRoundDeal();
  }

  function dealTurnRound() {
    const [turn] = deps.dealCardsFromDeck(deps.remainingDeckForKnownCards(deps.allDealtCardsForDeck()), 1);
    deps.setHandModel(HandModel.dealTurnModel(deps.handModel(), turn));
    finishStreetDeal();
  }

  function dealRiverRound() {
    const [river] = deps.dealCardsFromDeck(deps.remainingDeckForKnownCards(deps.allDealtCardsForDeck()), 1);
    deps.setHandModel(HandModel.dealRiverModel(deps.handModel(), river));
    finishStreetDeal();
  }

  function dealFlopRound() {
    const knownCards = deps.allDealtCardsForDeck();
    const flop = deps.dealCardsFromDeck(deps.remainingDeckForKnownCards(knownCards), 3);
    deps.setHandModel(HandModel.dealFlopModel(deps.handModel(), flop));
    finishStreetDeal();
  }

  function finishStreetDeal() {
    syncHandStateFromModel();
    recordCurrentStreet();
    deps.bumpCurveComputationToken();
    deps.setActionMomentCache(new Map());
    deps.setCurrentCurves({});
    deps.resetWinShareState();
    finishRoundDeal();
  }

  function finishRoundDeal() {
    deps.renderHoldingDisplay();
    deps.updateRoundButton();
    deps.updateStreetNavButtons();
    deps.updatePageTabs();
    if (deps.shouldDeferPreflopClassData()) {
      deps.queuePreflopClassDataLoad(deps.handState().h1, deps.handState().h2);
    }
    if (deps.shouldDeferCurrentPageCurves()) {
      deps.renderLoadingAssets();
      deps.scheduleCurrentPageCurves();
      return;
    }
    deps.ensureCurrentPageCurves();
    deps.updateLegend();
    deps.renderAssets();
    updateCurrentStreetSnapshot();
    if (deps.focusedAsset()) {
      deps.openFocus(deps.focusedAsset());
    }
  }

  function navigateStreet(direction) {
    navigateToMoment(currentNavigationMomentIndex() + direction);
  }

  function navigateToStreet(index) {
    if (index < 0 || index >= deps.handTimeline().length || index === deps.viewedStreetIndex()) {
      return;
    }
    saveCurrentMomentCache();
    const street = actionStreetForHandModel(deps.handTimeline()[index].handModel);
    const visibleSnapshot = visibleHandSnapshotForMoment({
      handTimeline: deps.handTimeline(),
      moment: { streetIndex: index, actionCount: actionCountThroughStreet(street) },
      playerActions: deps.playerActions(),
      actionMomentCache: deps.actionMomentCache(),
      fallbackCurves: deps.handTimeline()[index].currentCurves || {},
      fallbackWinShares: deps.handTimeline()[index].currentWinShares || {},
    });
    commitVisibleHandSnapshot(visibleSnapshot);
    deps.bumpCurveComputationToken();
    deps.setVillainMirrorComputationScheduled(false);
    deps.renderCachedStreet();
  }

  function navigateToMoment(index) {
    const moments = navigationMoments();
    if (index < 0 || index >= moments.length || index === currentNavigationMomentIndex()) {
      return;
    }
    saveCurrentMomentCache();
    const moment = moments[index];
    const visibleSnapshot = visibleHandSnapshotForMoment({
      handTimeline: deps.handTimeline(),
      moment,
      playerActions: deps.playerActions(),
      actionMomentCache: deps.actionMomentCache(),
    });
    commitVisibleHandSnapshot(visibleSnapshot);
    deps.bumpCurveComputationToken();
    deps.setVillainMirrorComputationScheduled(false);
    deps.renderCachedStreet();
  }

  function navigationMoments() {
    return refreshVisibleHandSnapshot().navigationMoments;
  }

  function currentNavigationMomentIndex() {
    return refreshVisibleHandSnapshot().currentNavigationMomentIndex;
  }

  function isViewingLatestMoment() {
    return refreshVisibleHandSnapshot().isViewingLatestMoment;
  }

  function actionStreetForHandModel(model) {
    return visibleSnapshotActionStreetForHandModel(model);
  }

  function actionMomentCacheKey(moment = { streetIndex: deps.viewedStreetIndex(), actionCount: deps.currentViewedActionCount() }) {
    return visibleSnapshotActionMomentCacheKey(moment);
  }

  function saveCurrentMomentCache() {
    deps.setActionMomentCache(cacheVisibleHandSnapshot(deps.actionMomentCache(), refreshVisibleHandSnapshot()));
  }

  function recordCurrentStreet() {
    const snapshot = recordStreetSnapshot(
      deps.handTimeline(),
      deps.handModel(),
      deps.handState().round,
      deps.playerActions(),
      deps.showdownHoleCardsByPlayer(),
    );
    deps.setHandTimeline(snapshot.handTimeline);
    deps.setViewedStreetIndex(snapshot.viewedStreetIndex);
    deps.setViewedActionCount(actionCountThroughStreet(deps.handState().round));
  }

  function updateCurrentStreetSnapshot() {
    if (deps.viewedStreetIndex() < 0 || !deps.handState()) {
      return;
    }
    deps.setHandTimeline(updateStreetSnapshot(
      deps.handTimeline(),
      deps.viewedStreetIndex(),
      deps.handModel(),
      deps.currentCurves(),
      deps.currentWinShares(),
      deps.playerActions(),
      deps.showdownHoleCardsByPlayer(),
    ));
  }

  function syncHandStateFromModel() {
    deps.setHandState(handViewFromModel(deps.handModel()));
    deps.setVillainShowdown(HandModel.isShowdown(deps.handModel()));
    refreshVisibleHandSnapshot();
  }

  function refreshVisibleHandSnapshot() {
    const visibleHandSnapshot = resolveVisibleHandSnapshot({
      handModel: deps.handModel(),
      handTimeline: deps.handTimeline(),
      viewedStreetIndex: deps.viewedStreetIndex(),
      viewedActionCount: deps.viewedActionCount(),
      playerActions: deps.playerActions(),
      currentCurves: deps.currentCurves(),
      currentWinShares: deps.currentWinShares(),
      showdownHoleCardsByPlayer: deps.showdownHoleCardsByPlayer(),
    });
    deps.setVisibleHandSnapshot(visibleHandSnapshot);
    return visibleHandSnapshot;
  }

  function commitVisibleHandSnapshot(snapshot) {
    deps.setHandModel(cloneHandModel(snapshot.handModel));
    deps.setHandState(snapshot.handState);
    deps.setVillainShowdown(snapshot.villainShowdown);
    deps.setHandTimeline(snapshot.handTimeline);
    deps.setPlayerActions(clonePlayerActions(snapshot.playerActions || deps.playerActions()));
    deps.setViewedStreetIndex(snapshot.viewedStreetIndex);
    deps.setViewedActionCount(snapshot.viewedActionCount);
    deps.setCurrentCurves(cloneCacheObject(snapshot.currentCurves || {}));
    deps.setCurrentWinShares(cloneCacheObject(snapshot.currentWinShares || {}));
    deps.setShowdownHoleCardsByPlayer(cloneShowdownHoleCardsByPlayer(snapshot.showdownHoleCardsByPlayer || {}));
    refreshVisibleHandSnapshot();
  }

  function actionCountThroughStreet(street) {
    return visibleSnapshotActionCountThroughStreet(deps.playerActions(), street);
  }

  return {
    actionMomentCacheKey,
    actionStreetForHandModel,
    commitVisibleHandSnapshot,
    currentNavigationMomentIndex,
    dealNewRound,
    finishRoundDeal,
    handleCardEditClick,
    isViewingLatestMoment,
    loadRandomInterestingHand,
    navigateStreet,
    navigateToMoment,
    navigateToStreet,
    navigationMoments,
    rebuildTimelineForCurrentHand,
    recordCurrentStreet,
    refreshVisibleHandSnapshot,
    resetNewHand,
    saveCurrentMomentCache,
    syncHandStateFromModel,
    updateCurrentStreetSnapshot,
  };
}
