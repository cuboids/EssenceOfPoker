import * as HandModel from "./hand_state.mjs";
import { handViewFromModel } from "./hand_view.mjs";
import { cardId } from "./cards.mjs";
import { nextRoundDeal, startPreflopFromHoleCards as buildPreflopDeal } from "./hand_flow_dealing.mjs";
import {
  knownCardEditPatch,
  pendingHoleCardEdit,
  showdownVillainCardEditPatch,
} from "./hand_flow_card_edit.mjs";
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
    const result = pendingHoleCardEdit({ handModel: deps.handModel(), token, nextCard });
    if (!result.ok) {
      transactions.dispatch(handTransaction("pending-hole-card-duplicate", {
        patch: { cardEditError: result.message },
        effects: [HAND_EFFECTS.RENDER_HOLDING],
      }));
      return;
    }
    transactions.dispatch(handTransaction("pending-hole-card-edit-accepted", {
      patch: { editingCardToken: null, cardEditError: "" },
    }));
    if (result.complete) {
      await startPreflopFromHoleCards(result.holeCards);
      return;
    }
    transactions.dispatch(handTransaction("pending-hole-card-edited", {
      patch: { handModel: result.handModel },
      effects: [HAND_EFFECTS.SYNC_HAND_STATE, HAND_EFFECTS.RENDER_HOLDING],
    }));
  }

  function applyCardEdit(token, nextCard) {
    const result = knownCardEditPatch({
      handModel: deps.handModel(),
      token,
      nextCard,
      activePage: deps.activePage(),
      villainShowdown: deps.villainShowdown(),
      isOpponentPage: deps.isOpponentPage,
      currentCard: deps.cardForTokenOnPage(token, deps.activePage()),
      remainingDeckForKnownCards: deps.remainingDeckForKnownCards,
      dealCardsFromDeck: deps.dealCardsFromDeck,
    });
    if (result.deferredShowdownEdit) {
      return applyShowdownVillainCardEdit(deps.activePage(), token, nextCard);
    }
    return result;
  }

  function applyShowdownVillainCardEdit(page, token, nextCard) {
    const currentCards = deps.showdownHoleCardsForPlayer(page);
    const otherRevealedCards = Object.entries(deps.showdownHoleCardsByPlayer())
      .filter(([playerId]) => playerId !== page)
      .flatMap(([, cards]) => cards);
    return showdownVillainCardEditPatch({
      page,
      token,
      nextCard,
      currentCards,
      otherRevealedCards,
      handState: deps.handState(),
      showdownHoleCardsByPlayer: deps.showdownHoleCardsByPlayer(),
    });
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
      const result = nextRoundDeal({
        handState: deps.handState(),
        handModel: deps.handModel(),
        dealHoleCards: deps.dealHoleCards,
        dealCardsFromDeck: deps.dealCardsFromDeck,
        remainingDeckForKnownCards: deps.remainingDeckForKnownCards,
        allDealtCardsForDeck: deps.allDealtCardsForDeck,
      });
      if (!result.ok) {
        return;
      }
      if (result.type === "preflop") {
        finishPreflopDeal(result);
        return;
      }
      finishStreetDeal(result.handModel);
    }, 20);
  }

  function startPreflopFromHoleCards(holeCards) {
    finishPreflopDeal(buildPreflopDeal(holeCards, {
      dealCardsFromDeck: deps.dealCardsFromDeck,
      remainingDeckForKnownCards: deps.remainingDeckForKnownCards,
    }));
  }

  function finishPreflopDeal(result) {
    const [h1, h2] = result.heroHoleCards;
    transactions.dispatch(handTransaction("preflop-started", {
      patch: {
        handModel: result.handModel,
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
