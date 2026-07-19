import * as HandModel from "./hand_state.mjs";
import { handViewFromModel } from "./hand_view.mjs";
import { cardCompare, cardId, hasDuplicateCards, sameCard } from "./cards.mjs";
import { loadRandomInterestingHandResult } from "./interesting_hand_loader.mjs";
import { createHandTransactionDispatcher, handTransaction, HAND_EFFECTS } from "./hand_transactions.mjs";
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
  const transactions = createHandTransactionDispatcher({
    setters: {
      activePage: deps.setActivePage,
      actionMomentCache: deps.setActionMomentCache,
      cardEditError: deps.setCardEditError,
      currentCurves: deps.setCurrentCurves,
      currentWinShares: deps.setCurrentWinShares,
      editingCardToken: deps.setEditingCardToken,
      focusedAsset: deps.setFocusedAsset,
      handModel: deps.setHandModel,
      handState: deps.setHandState,
      handTimeline: deps.setHandTimeline,
      playerActions: deps.setPlayerActions,
      priorNaturalXMaps: deps.setPriorNaturalXMaps,
      showdownHoleCardsByPlayer: deps.setShowdownHoleCardsByPlayer,
      tableConfig: deps.setTableConfig,
      viewedActionCount: deps.setViewedActionCount,
      viewedStreetIndex: deps.setViewedStreetIndex,
      villainShowdown: deps.setVillainShowdown,
      visibleHandSnapshot: deps.setVisibleHandSnapshot,
    },
    effects: {
      [HAND_EFFECTS.BUMP_CURVE_TOKEN]: deps.bumpCurveComputationToken,
      [HAND_EFFECTS.RENDER_ASSETS]: deps.renderAssets,
      [HAND_EFFECTS.RENDER_CACHED_STREET]: deps.renderCachedStreet,
      [HAND_EFFECTS.RENDER_CALIBRATION_STATUS]: deps.renderCalibrationStatus,
      [HAND_EFFECTS.RENDER_HOLDING]: deps.renderHoldingDisplay,
      [HAND_EFFECTS.RENDER_PORTFOLIO_TABS]: deps.renderPortfolioTabs,
      [HAND_EFFECTS.RESET_WIN_SHARES]: deps.resetWinShareState,
      [HAND_EFFECTS.SYNC_HAND_STATE]: syncHandStateFromModel,
      [HAND_EFFECTS.UPDATE_LEGEND]: deps.updateLegend,
      [HAND_EFFECTS.UPDATE_PAGE_TABS]: deps.updatePageTabs,
      [HAND_EFFECTS.UPDATE_ROUND_BUTTON]: deps.updateRoundButton,
      [HAND_EFFECTS.UPDATE_STREET_NAV_BUTTONS]: deps.updateStreetNavButtons,
    },
  });

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
    transactions.dispatch(handTransaction("known-card-edited", {
      patch: {
        ...result.patch,
        editingCardToken: null,
        cardEditError: "",
        viewedActionCount: null,
        actionMomentCache: new Map(),
        currentCurves: {},
      },
      effects: [
        HAND_EFFECTS.SYNC_HAND_STATE,
        HAND_EFFECTS.BUMP_CURVE_TOKEN,
        HAND_EFFECTS.RESET_WIN_SHARES,
      ],
    }));
    rebuildTimelineForCurrentHand();
    finishRoundDeal();
  }

  async function applyPendingHoleCardEdit(token, nextCard) {
    const index = token === "H_1" ? 0 : 1;
    const nextPending = [...HandModel.pendingHoleCards(deps.handModel())];
    nextPending[index] = nextCard;
    if (hasDuplicateCards(nextPending.filter(Boolean))) {
      transactions.dispatch(handTransaction("pending-hole-card-duplicate", {
        patch: { cardEditError: "That card is already in the other hole-card slot." },
        effects: [HAND_EFFECTS.RENDER_HOLDING],
      }));
      return;
    }
    transactions.dispatch(handTransaction("pending-hole-card-edit-accepted", {
      patch: { editingCardToken: null, cardEditError: "" },
    }));
    if (nextPending.every(Boolean)) {
      await startPreflopFromHoleCards(nextPending);
      return;
    }
    transactions.dispatch(handTransaction("pending-hole-card-edited", {
      patch: { handModel: HandModel.setPendingHoleCard(deps.handModel(), token, nextCard) },
      effects: [HAND_EFFECTS.SYNC_HAND_STATE, HAND_EFFECTS.RENDER_HOLDING],
    }));
  }

  function applyCardEdit(token, nextCard) {
    if ((token === "V_1" || token === "V_2") && deps.villainShowdown() && deps.isOpponentPage(deps.activePage())) {
      return applyShowdownVillainCardEdit(deps.activePage(), token, nextCard);
    }
    try {
      return { ok: true, patch: { handModel: HandModel.editKnownCardModel(deps.handModel(), token, nextCard) } };
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
        return {
          ok: true,
          patch: {
            handModel: HandModel.editKnownCardModel(deps.handModel(), token, nextCard, replacementVillain),
          },
        };
      } else {
        return { ok: false, message: error.message };
      }
    }
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
    return {
      ok: true,
      patch: {
        showdownHoleCardsByPlayer: {
          ...deps.showdownHoleCardsByPlayer(),
          [page]: nextCards.sort(cardCompare),
        },
      },
    };
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
    const priorCurves = deps.priorCurvesByPage(deps.dashboardData());
    transactions.dispatch(handTransaction("new-hand-reset", {
      patch: {
        handModel: HandModel.emptyHandModel(),
        showdownHoleCardsByPlayer: {},
        handTimeline: [],
        playerActions: [],
        viewedStreetIndex: -1,
        viewedActionCount: null,
        actionMomentCache: new Map(),
        editingCardToken: null,
        cardEditError: "",
        currentCurves: priorCurves,
        priorNaturalXMaps: deps.priorNaturalXMapsByPage(priorCurves),
      },
      effects: [
        HAND_EFFECTS.SYNC_HAND_STATE,
        HAND_EFFECTS.BUMP_CURVE_TOKEN,
        HAND_EFFECTS.RESET_WIN_SHARES,
        HAND_EFFECTS.RENDER_PORTFOLIO_TABS,
        HAND_EFFECTS.RENDER_HOLDING,
        HAND_EFFECTS.UPDATE_ROUND_BUTTON,
        HAND_EFFECTS.UPDATE_STREET_NAV_BUTTONS,
        HAND_EFFECTS.UPDATE_PAGE_TABS,
        HAND_EFFECTS.UPDATE_LEGEND,
        HAND_EFFECTS.RENDER_ASSETS,
      ],
    }));
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
      const result = await loadRandomInterestingHandResult({
        dealers: {
          dealHoleCards: deps.dealHoleCards,
          dealCardsFromDeck: deps.dealCardsFromDeck,
          remainingDeckForKnownCards: deps.remainingDeckForKnownCards,
        },
      });
      if (!result.ok) {
        transactions.dispatch(handTransaction("interesting-hand-load-failed", {
          patch: { cardEditError: result.message },
          effects: [HAND_EFFECTS.RENDER_HOLDING],
        }));
        return;
      }
      loadInterestingHand(result);
    } finally {
      button.disabled = false;
      button.classList.remove("is-loading");
      button.title = "Random interesting hand";
    }
  }

  function loadInterestingHand({ imported, handModel }) {
    const tableConfig = deps.normalizeTableConfig(imported.tableConfig);
    transactions.dispatch(handTransaction("interesting-hand-loaded-initial", {
      patch: { tableConfig },
    }));
    deps.persistTableConfig();
    deps.rebuildDashboardPortfolios();
    transactions.dispatch(handTransaction("interesting-hand-loaded", {
      patch: {
        handModel,
        showdownHoleCardsByPlayer: imported.showdownHoleCardsByPlayer,
        playerActions: imported.playerActions,
        viewedActionCount: 0,
        actionMomentCache: new Map(),
        activePage: "hero",
        focusedAsset: null,
        editingCardToken: null,
        cardEditError: "",
        currentCurves: {},
        priorNaturalXMaps: deps.priorNaturalXMapsByPage(deps.priorCurvesByPage(deps.dashboardData())),
      },
      effects: [
        HAND_EFFECTS.SYNC_HAND_STATE,
        HAND_EFFECTS.BUMP_CURVE_TOKEN,
        HAND_EFFECTS.RESET_WIN_SHARES,
      ],
    }));
    rebuildTimelineForCurrentHand({ viewedIndex: 0, preserveStreetModels: true });
    const viewedSnapshot = deps.handTimeline()[deps.viewedStreetIndex()];
    transactions.dispatch(handTransaction("interesting-hand-viewed-snapshot", {
      patch: {
        handModel: cloneHandModel(viewedSnapshot.handModel),
        currentCurves: cloneCacheObject(viewedSnapshot.currentCurves || {}),
        currentWinShares: cloneCacheObject(viewedSnapshot.currentWinShares || {}),
      },
      effects: [HAND_EFFECTS.SYNC_HAND_STATE],
    }));
    updateCurrentStreetSnapshot();
    transactions.dispatch(handTransaction("interesting-hand-render", {
      effects: [
        HAND_EFFECTS.RENDER_PORTFOLIO_TABS,
        HAND_EFFECTS.RENDER_CALIBRATION_STATUS,
        HAND_EFFECTS.RENDER_CACHED_STREET,
      ],
    }));
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
    transactions.dispatch(handTransaction("preflop-started", {
      patch: {
        handModel: HandModel.startPreflopModel([h1, h2], [v1, v2]),
        showdownHoleCardsByPlayer: {},
        actionMomentCache: new Map(),
        currentCurves: {},
      },
      effects: [
        HAND_EFFECTS.SYNC_HAND_STATE,
        HAND_EFFECTS.BUMP_CURVE_TOKEN,
        HAND_EFFECTS.RESET_WIN_SHARES,
      ],
    }));
    recordCurrentStreet();
    deps.queuePreflopClassDataLoad(h1, h2);

    finishRoundDeal();
  }

  function dealTurnRound() {
    const [turn] = deps.dealCardsFromDeck(deps.remainingDeckForKnownCards(deps.allDealtCardsForDeck()), 1);
    finishStreetDeal(HandModel.dealTurnModel(deps.handModel(), turn));
  }

  function dealRiverRound() {
    const [river] = deps.dealCardsFromDeck(deps.remainingDeckForKnownCards(deps.allDealtCardsForDeck()), 1);
    finishStreetDeal(HandModel.dealRiverModel(deps.handModel(), river));
  }

  function dealFlopRound() {
    const knownCards = deps.allDealtCardsForDeck();
    const flop = deps.dealCardsFromDeck(deps.remainingDeckForKnownCards(knownCards), 3);
    finishStreetDeal(HandModel.dealFlopModel(deps.handModel(), flop));
  }

  function finishStreetDeal(nextHandModel) {
    transactions.dispatch(handTransaction("street-dealt", {
      patch: {
        handModel: nextHandModel,
        actionMomentCache: new Map(),
        currentCurves: {},
      },
      effects: [
        HAND_EFFECTS.SYNC_HAND_STATE,
        HAND_EFFECTS.BUMP_CURVE_TOKEN,
        HAND_EFFECTS.RESET_WIN_SHARES,
      ],
    }));
    recordCurrentStreet();
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
    transactions.dispatch(handTransaction("commit-visible-hand-snapshot", {
      patch: {
        handModel: cloneHandModel(snapshot.handModel),
        handState: snapshot.handState,
        villainShowdown: snapshot.villainShowdown,
        handTimeline: snapshot.handTimeline,
        playerActions: clonePlayerActions(snapshot.playerActions || deps.playerActions()),
        viewedStreetIndex: snapshot.viewedStreetIndex,
        viewedActionCount: snapshot.viewedActionCount,
        currentCurves: cloneCacheObject(snapshot.currentCurves || {}),
        currentWinShares: cloneCacheObject(snapshot.currentWinShares || {}),
        showdownHoleCardsByPlayer: cloneShowdownHoleCardsByPlayer(snapshot.showdownHoleCardsByPlayer || {}),
      },
    }));
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
