import * as HandModel from "./hand_state.mjs";
import { createHandFlowController } from "./hand_flow_controller.mjs";
import {
  categoryDescriptions,
  categoryLabels,
  categoryOrder,
} from "./app_config.mjs";
import { createAppState, initializeHandState } from "./app_state.mjs";
import { loadDashboardBootstrap } from "./app_bootstrap.mjs";
import { createCardStateController } from "./card_state_controller.mjs";
import {
  aggregateIsActive,
  ceilingForOtherAssetsInPortfolio,
  concreteAssetIsActive,
} from "./asset_status.mjs";
import { createAssetBoardRenderer } from "./asset_board_renderer.mjs";
import {
  buildAsyncSnapshotKey,
  createAsyncStateGuard,
} from "./async_state_guard.mjs";
import { createAsyncJobRunner } from "./async_jobs.mjs";
import {
  cardCompare,
  fullDeck,
  sameCard,
} from "./cards.mjs";
import { preflopClassKeyForCards } from "./cache_keys.mjs";
import { createCalibrationStatusController } from "./calibration_status_controller.mjs";
import {
  bindDashboardControls,
} from "./controllers/dashboard_controls.mjs";
import { createConfigPageController } from "./config_page_controller.mjs";
import { createPlayerActionController } from "./player_action_controller.mjs";
import { createRangeShowdownPanel } from "./range_showdown_panel.mjs";
import { createPageShellController } from "./page_shell_controller.mjs";
import {
  readEmpiricalSpotResult,
  readHealth,
  readPreflopAggregateClassResult,
  readPreflopHiddenVillainClassResult,
  readPreflopPrimaryClassResult,
} from "./data_client.mjs";
import { createDisplayPreferencesController } from "./display_preferences_controller.mjs";
import { createEmpiricalEvidenceController } from "./empirical_evidence_controller.mjs";
import { createEquityController } from "./equity_controller.mjs";
import { createCurveController } from "./curve_controller.mjs";
import { holdingDisplayModel } from "./renderers/holding_renderer.mjs";
import { renderLegendHtml } from "./renderers/legend_renderer.mjs";
import {
  assetsForPage,
  currentConcreteAssetCount as currentConcreteAssetCountForPortfolio,
  normalizedPortfolios as normalizedPortfoliosForConfig,
  portfolioForPage,
  priorAggregateCurve as priorAggregateCurveForData,
  priorCurveForModel as priorCurveForPortfolioModel,
  priorCurvesByPage as priorCurvesByPortfolioPage,
  priorNaturalXMapsByPage,
  villainPageKeysForConfig,
} from "./portfolio_model.mjs";
import {
  createSeededRng,
  drawCardsFromDeck,
  sessionSeed,
} from "./session_rng.mjs";
import {
  actionsForStreet,
  playerHasFoldedByStreet,
} from "./player_actions.mjs";
import { createPreflopClassStore } from "./stores/preflop_class_store.mjs";
import {
  persistCalibrationContext,
  persistHideInactiveAssets,
  persistPlayerProfiles,
  persistTableConfig as persistTableConfigStorage,
  persistTheme,
} from "./local_storage_schema.mjs";
import { createComputationWorker } from "./computation_worker_client.mjs";
import { inferRanges } from "./range_inference.mjs";
import { empiricalSpotRequest } from "./empirical_range_model.mjs";
import {
  escapeHtml,
  formatPercent,
} from "./ui.mjs";
import {
  isVillainPage,
  nextHeroPosition,
  normalizeTableConfig,
  positionDisplayName,
  positionFromPageKey,
} from "./table_positions.mjs";

const ASSET_VERSION = /** @type {Window & { ESSENCE_ASSET_VERSION?: number }} */ (window).ESSENCE_ASSET_VERSION || Date.now();
const sessionRng = createSeededRng(sessionSeed());
const appState = initializeHandState(createAppState({ assetVersion: ASSET_VERSION }));

let dashboardData;
let bucketLookup;
let handEvaluator;
let priorXByGradation;
let aggregatePriorXByGradation;
let priorNaturalXMaps = {};
let categoryByGradation;
const preflopClassStore = createPreflopClassStore({
  aggregateClasses: appState.data.preflopAggregateClasses,
  hiddenVillainClasses: appState.data.preflopHiddenVillainClasses,
  primaryClasses: {},
  getBucketCount: () => dashboardData.bucketCount,
  readAggregateClassResult: readPreflopAggregateClassResult,
  readHiddenVillainClassResult: readPreflopHiddenVillainClassResult,
  readPrimaryClassResult: readPreflopPrimaryClassResult,
  onPartLoaded: refreshAfterPreflopClassPart,
});
let preflopAggregateClasses = preflopClassStore.aggregateClasses;
let preflopHiddenVillainClasses = preflopClassStore.hiddenVillainClasses;
let preflopPrimaryClasses = preflopClassStore.primaryClasses;
let preflopHandEquityCache;
let handModel = appState.hand.model;
let handState = appState.hand.view;
let handTimeline = appState.hand.timeline;
let playerActions = appState.hand.playerActions;
let viewedStreetIndex = appState.hand.viewedStreetIndex;
let viewedActionCount = null;
let visibleHandSnapshot = null;
let currentCurves = appState.computed.curves;
let currentWinShares = appState.computed.winShares;
let actionMomentCache = new Map();
let workerFailures = appState.computed.workerFailures;
let focusedAsset = appState.ui.focusedAsset;
let activePage = appState.ui.activePage;
let villainShowdown = appState.hand.villainShowdown;
let showdownHoleCardsByPlayer = {};
let editingCardToken = appState.ui.editingCardToken;
let cardEditError = appState.ui.cardEditError;
let curveComputationToken = appState.computed.curveToken;
let villainMirrorComputationScheduled = appState.computed.villainMirrorScheduled;
let computationWorker = null;
let chartMode = appState.ui.chartMode;
let useDarkTheme = appState.ui.useDarkTheme;
let hideInactiveAssets = appState.ui.hideInactiveAssets;
let tableConfig = normalizeTableConfig(appState.ui.tableConfig);
let calibrationContext = appState.ui.calibrationContext || { stakeBucket: "micro", yearBucket: "2009-2010" };
let playerProfiles = appState.ui.playerProfiles || {};
const asyncJobs = createAsyncJobRunner({ onError: recordAsyncJobFailure });
const empiricalEvidence = createEmpiricalEvidenceController({
  readSpot: readEmpiricalSpotResult,
  readHealth,
  requestForAction: empiricalRequestForPlayerAction,
  onLoading: () => {
    renderCalibrationStatus();
    renderHoldingDisplay();
  },
  onEvidenceChanged: () => {
    invalidateRangeDerivedState();
    renderCalibrationStatus();
    renderHoldingDisplay();
    renderAssets();
  },
});
const calibrationStatus = createCalibrationStatusController({
  calibrationContext: () => calibrationContext,
  documentRef: document,
  empiricalEvidence: () => empiricalEvidence,
  setWorkerFailures: (value) => {
    workerFailures = value;
    appState.computed.workerFailures = workerFailures;
  },
  visiblePlayerActionsForCurrentStreet,
  workerFailures: () => workerFailures,
});
const playerActionController = createPlayerActionController({
  activePage: () => activePage,
  bumpCurveComputationToken: () => { curveComputationToken += 1; },
  dashboardData: () => dashboardData,
  documentRef: document,
  empiricalEvidenceForAction,
  handState: () => handState,
  playerActions: () => playerActions,
  priorCurvesByPage,
  refreshVisibleHandSnapshot,
  renderAssets,
  renderCalibrationStatus,
  renderHoldingDisplay,
  renderPortfolioTabs,
  resetWinShareState,
  setActionMomentCache: (value) => { actionMomentCache = value; },
  setCurrentCurves: (value) => { currentCurves = value; },
  setPlayerActions: (value) => { playerActions = value; },
  setViewedActionCount: (value) => { viewedActionCount = value; },
  tableConfig: () => tableConfig,
  updateCurrentStreetSnapshot,
  updateLegend,
  updatePageTabs,
  updateStreetNavButtons,
});
const assetBoard = createAssetBoardRenderer({
  documentRef: document,
  activePage: () => activePage,
  aggregateMatchupTitle,
  aggregatePriorXByGradation: () => aggregatePriorXByGradation,
  cachedWinShareForAsset,
  cardForToken: (token) => cardForTokenOnPage(token, activePage),
  categoryDescriptions,
  categoryForGradation,
  categoryLabels,
  ceilingForOtherAssets,
  chartMode: () => chartMode,
  curveForAsset,
  dashboardData: () => dashboardData,
  editingCardToken: () => editingCardToken,
  handState: () => handState,
  isAggregateMatchup,
  isAssetCurrentlyActive,
  isCategoryAggregate,
  isOpponentPage,
  preflopActionDerivedRangesActive,
  priorNaturalXMaps: () => priorNaturalXMaps,
  priorXByGradation: () => priorXByGradation,
  setFocusedAsset: (asset) => { focusedAsset = asset; },
  showdownHoleCardsForPlayer,
  villainShowdown: () => villainShowdown,
  winShareForAsset,
});
const cardState = createCardStateController({
  activePage: () => activePage,
  cardForTokenOnPage: (token, page) => assetBoard.cardForTokenOnPage(token, page),
  handState: () => handState,
  isOpponentPage,
  showdownHoleCardsByPlayer: () => showdownHoleCardsByPlayer,
  showdownHoleCardsForPlayer,
  villainShowdown: () => villainShowdown,
});
const configPage = createConfigPageController({
  activePage: () => activePage,
  calibrationContext: () => calibrationContext,
  documentRef: document,
  hideInactiveAssets: () => hideInactiveAssets,
  playerProfiles: () => playerProfiles,
  renderAssets,
  tableConfig: () => tableConfig,
  toggleHideInactiveAssets,
  updateCalibrationContext,
  updatePlayerProfiles,
  updateTableConfig,
  villainPageKeys,
});
const equityController = createEquityController({
  activePage: () => activePage,
  activeVillainPageKeys,
  asyncJobs,
  assetVersion: () => ASSET_VERSION,
  cardState,
  computationWorker: () => computationWorker,
  createCurrentAsyncGuard,
  currentWinShares: () => currentWinShares,
  dashboardData: () => dashboardData,
  empiricalSpotsForCurrentActions,
  evaluateGradation,
  evaluateGradationFive,
  focusedAsset: () => focusedAsset,
  handState: () => handState,
  isOpponentPage,
  isVillainPageFolded,
  openFocus,
  patchCurrentWinShares,
  playerProfilesForInference,
  portfolioForCurvePage,
  priorWinSharesByPage,
  recordCacheWriteFailure: recordWorkerFailure,
  renderAssets,
  saveCurrentMomentCache,
  setCurrentWinShares: (shares) => { currentWinShares = shares; },
  tableConfig: () => tableConfig,
  updateCurrentStreetSnapshot,
  villainPageKeys,
  villainShowdown: () => villainShowdown,
  visiblePlayerActionsForCurrentStreet,
});
const curveController = createCurveController({
  activePage: () => activePage,
  asyncJobs,
  assetVersion: () => ASSET_VERSION,
  baseVillainPortfolio,
  boardCardForToken,
  bumpCurveComputationToken: () => { curveComputationToken += 1; },
  cardState,
  createCurrentAsyncGuard,
  currentCurves: () => currentCurves,
  dashboardData: () => dashboardData,
  empiricalSpotsForCurrentActions,
  evaluateGradation,
  focusedAsset: () => focusedAsset,
  handEvaluator: () => handEvaluator,
  handState: () => handState,
  isOpponentPage,
  openFocus,
  playerProfilesForInference,
  preflopActionDerivedRangesActive,
  preflopAggregateClasses: () => preflopAggregateClasses,
  preflopHiddenVillainClasses: () => preflopHiddenVillainClasses,
  preflopPrimaryClasses: () => preflopPrimaryClasses,
  priorAggregateCurve,
  priorCurvesByPage,
  priorXByGradation: () => priorXByGradation,
  renderAssets,
  saveCurrentMomentCache,
  tableConfig: () => tableConfig,
  updateCurrentStreetSnapshot,
  updateLegend,
  villainPageKeys,
  villainShowdown: () => villainShowdown,
  visiblePlayerActionsForCurrentStreet,
});
const rangeShowdownPanel = createRangeShowdownPanel({
  actionPlayerLabel,
  actionPlayerOrder,
  categoryForGradation,
  currentBoardCards,
  dashboardData: () => dashboardData,
  documentRef: document,
  empiricalEvidenceForRange,
  estimatedRangeForPage,
  evaluateGradationFive,
  handState: () => handState,
  playerHasFoldedByStreet,
  playerIdForPosition,
  playerStacksById,
  setFocusedAsset: (asset) => { focusedAsset = asset; },
  showdownHoleCardsForPlayer,
  tableConfig: () => tableConfig,
  visiblePlayerActionsForCurrentStreet,
});
const displayPreferences = createDisplayPreferencesController({
  documentRef: document,
  focusedAsset: () => focusedAsset,
  openFocus,
  persistTheme: (enabled) => persistTheme(localStorage, enabled),
  renderAssets,
  setChartMode: (value) => { chartMode = value; },
  setUseDarkTheme: (value) => { useDarkTheme = value; },
  useDarkTheme: () => useDarkTheme,
});
const pageShell = createPageShellController({
  activePage: () => activePage,
  closeFocus,
  dashboardData: () => dashboardData,
  documentRef: document,
  ensureCurrentPageCurves,
  handState: () => handState,
  isVillainPageFolded,
  renderAssets,
  renderHoldingDisplay,
  revealVillain,
  scheduleCurrentPageCurves,
  setActivePage: (value) => { activePage = value; },
  setFocusedAsset: (value) => { focusedAsset = value; },
  shouldDeferCurrentPageCurves,
  updateLegend,
  villainPageKeys,
  villainShowdown: () => villainShowdown,
});
const handFlow = createHandFlowController({
  activePage: () => activePage,
  actionMomentCache: () => actionMomentCache,
  advanceHeroPositionForNewHand,
  allDealtCardsForDeck,
  cardForTokenOnPage,
  currentCurves: () => currentCurves,
  currentViewedActionCount,
  currentWinShares: () => currentWinShares,
  dashboardData: () => dashboardData,
  dealCardsFromDeck,
  dealHoleCards,
  documentRef: document,
  ensureCurrentPageCurves,
  focusedAsset: () => focusedAsset,
  handModel: () => handModel,
  handState: () => handState,
  handTimeline: () => handTimeline,
  isOpponentPage,
  openFocus,
  persistTableConfig,
  playerActions: () => playerActions,
  priorCurvesByPage,
  priorNaturalXMapsByPage,
  queuePreflopClassDataLoad,
  rebuildDashboardPortfolios,
  remainingDeckForKnownCards,
  renderAssets,
  renderCachedStreet,
  renderCalibrationStatus,
  renderHoldingDisplay,
  renderLoadingAssets,
  renderPortfolioTabs,
  resetWinShareState,
  scheduleCurrentPageCurves,
  setActionMomentCache: (value) => { actionMomentCache = value; },
  setActivePage: (value) => { activePage = value; },
  setCardEditError: (value) => { cardEditError = value; },
  setCurrentCurves: (value) => { currentCurves = value; },
  setCurrentWinShares: (value) => { currentWinShares = value; },
  setEditingCardToken: (value) => { editingCardToken = value; },
  setFocusedAsset: (value) => { focusedAsset = value; },
  setHandModel: (value) => { handModel = value; },
  setHandState: (value) => { handState = value; },
  setHandTimeline: (value) => { handTimeline = value; },
  setPlayerActions: (value) => { playerActions = value; },
  setPriorNaturalXMaps: (value) => { priorNaturalXMaps = value; },
  setShowdownHoleCardsByPlayer: (value) => { showdownHoleCardsByPlayer = value; },
  setTableConfig: (value) => { tableConfig = value; },
  setViewedActionCount: (value) => { viewedActionCount = value; },
  setViewedStreetIndex: (value) => { viewedStreetIndex = value; },
  setVillainMirrorComputationScheduled: (value) => { villainMirrorComputationScheduled = value; },
  setVillainShowdown: (value) => { villainShowdown = value; },
  setVisibleHandSnapshot: (value) => { visibleHandSnapshot = value; },
  shouldDeferCurrentPageCurves,
  shouldDeferPreflopClassData,
  showdownHoleCardsByPlayer: () => showdownHoleCardsByPlayer,
  showdownHoleCardsForPlayer,
  updateLegend,
  updatePageTabs,
  updateRoundButton,
  updateStreetNavButtons,
  villainShowdown: () => villainShowdown,
  viewedActionCount: () => viewedActionCount,
  viewedStreetIndex: () => viewedStreetIndex,
  bumpCurveComputationToken: () => { curveComputationToken += 1; },
  normalizeTableConfig,
});

loadDashboardBootstrap({ assetVersion: ASSET_VERSION })
  .then((bootstrap) => {
    preflopHandEquityCache = bootstrap.preflopHandEquityCache;
    bucketLookup = bootstrap.bucketLookup;
    handEvaluator = bootstrap.handEvaluator;
    priorXByGradation = bootstrap.priorXByGradation;
    aggregatePriorXByGradation = bootstrap.aggregatePriorXByGradation;
    computationWorker = createComputationWorker(ASSET_VERSION, { onFailure: recordWorkerFailure });
    renderDashboard(bootstrap.dashboardData);
    hydrateEmpiricalCalibrationHealth();
  });

function renderDashboard(data) {
  dashboardData = data;
  dashboardData.portfolios = normalizedPortfolios(dashboardData);
  categoryByGradation = categoryLookup(data.categoryBands, data.bucketCount);
  currentCurves = Object.keys(currentCurves).length ? currentCurves : priorCurvesByPage(data);
  priorNaturalXMaps = priorNaturalXMapsByPage(currentCurves);
  currentWinShares = Object.keys(currentWinShares).length ? currentWinShares : priorWinSharesByPage();
  document.getElementById("asset-count").textContent = currentConcreteAssetCount();
  document.getElementById("bucket-count").textContent = data.bucketCount.toLocaleString();
  document.getElementById("combo-count").textContent = data.totalCombos.toLocaleString();
  bindDashboardControls({
    documentRef: document,
    handlers: {
      resetNewHand,
      navigateStreet,
      dealNewRound,
      loadRandomInterestingHand,
      revealVillain,
      handleCardEditClick,
      handlePlayerActionClick,
      handleRaisePercentChange,
      switchPage,
      changeChartMode,
      toggleThemeMode,
    },
  });
  renderPortfolioTabs();

  applyThemeMode();
  renderHoldingDisplay();
  updateRoundButton();
  updateStreetNavButtons();
  updatePageTabs();
  updateLegend();
  renderFocusLayer();
  renderAssets();
  renderCalibrationStatus();
}

function changeChartMode(event) {
  displayPreferences.changeChartMode(event);
}

function toggleThemeMode(event) {
  displayPreferences.toggleThemeMode(event);
}

function applyThemeMode() {
  displayPreferences.applyThemeMode();
}

async function hydrateEmpiricalCalibrationHealth() {
  await calibrationStatus.hydrateEmpiricalCalibrationHealth();
}

function renderCalibrationStatus() {
  calibrationStatus.renderCalibrationStatus();
}

function recordWorkerFailure(failure) {
  calibrationStatus.recordWorkerFailure(failure);
}

function recordAsyncJobFailure(failure) {
  calibrationStatus.recordAsyncJobFailure(failure);
}

function resetWinShareState() {
  equityController.resetWinShareState();
}

function patchCurrentWinShares(page, updater) {
  currentWinShares = {
    ...currentWinShares,
    [page]: updater(currentWinShares[page]),
  };
}

function priorWinSharesByPage() {
  const prior = dashboardData?.priorWinShares;
  if (!prior?.shares) {
    return {};
  }
  const shares = {
    hero: { shares: { ...prior.shares }, aggregateShares: { ...(prior.aggregateMatchups || {}) }, totalCombos: prior.totalCombos },
    range: { shares: { ...prior.shares }, totalCombos: prior.totalCombos },
  };
  for (const page of villainPageKeys()) {
    shares[page] = { shares: { ...prior.shares }, totalCombos: prior.totalCombos };
  }
  return shares;
}

function normalizedPortfolios(data) {
  return normalizedPortfoliosForConfig(data, tableConfig);
}

function rebuildDashboardPortfolios() {
  dashboardData.portfolios = normalizedPortfolios(dashboardData);
}

function priorCurvesByPage(data) {
  return priorCurvesByPortfolioPage(data, priorXByGradation);
}

function priorAggregateCurve(data = dashboardData) {
  return priorAggregateCurveForData(data, priorXByGradation);
}

function priorCurveForModel(model, data = dashboardData, fallback = null) {
  return priorCurveForPortfolioModel(model, data, priorXByGradation, fallback);
}

function currentPortfolio() {
  return portfolioForPage(dashboardData.portfolios, activePage);
}

function currentAssets() {
  return assetsForPage({
    portfolios: dashboardData.portfolios,
    activePage,
    villainPageKeys: villainPageKeys(),
  });
}

function currentConcreteAssetCount() {
  return currentConcreteAssetCountForPortfolio({
    activePage,
    dashboardData,
    currentPortfolio: currentPortfolio(),
  });
}

function villainPageKeys() {
  return villainPageKeysForConfig(tableConfig);
}

function activeVillainPageKeys() {
  return villainPageKeys().filter((page) => !isVillainPageFolded(page));
}

function isVillainPageFolded(page) {
  const position = positionFromPageKey(page);
  return Boolean(
    position &&
    playerHasFoldedByStreet(visiblePlayerActionsForCurrentStreet(), page, currentActionStreet()),
  );
}

function isOpponentPage(page) {
  return isVillainPage(page);
}

function baseVillainPortfolio() {
  return dashboardData.portfolios[villainPageKeys()[0]] || dashboardData.portfolios.hero;
}

function renderPortfolioTabs() {
  pageShell.renderPortfolioTabs();
}

function switchPage(page) {
  pageShell.switchPage(page);
}

function updatePageTabs() {
  pageShell.updatePageTabs();
}

function shouldDeferPreflopClassData() {
  return (
    handState?.round === "preflop" &&
    handState.h1 &&
    handState.h2 &&
    !preflopClassDataReady(handState.h1, handState.h2) &&
    !preflopClassDataUnavailable(handState.h1, handState.h2)
  );
}

function preflopClassDataReady(h1, h2) {
  return preflopClassStore.ready(h1, h2);
}

function preflopClassDataUnavailable(h1, h2) {
  return preflopClassStore.unavailable(h1, h2);
}

function renderAssets({ deferMissingCurves = false } = {}) {
  if (activePage === "config") {
    renderConfigPage();
    return;
  }
  if (shouldDeferPreflopClassData()) {
    queuePreflopClassDataLoad(handState.h1, handState.h2);
  }
  ensureEmpiricalSpotsForActions();
  if (deferMissingCurves && shouldRenderWithoutCurrentPageCurves()) {
    renderLoadingAssets({
      title: "Restoring street",
      copy: "The hand state is ready. Curves are loading in the background.",
    });
    scheduleCurrentPageCurves({ delayMs: 120 });
    return;
  }
  if (shouldDeferCurrentPageCurves()) {
    renderLoadingAssets();
    scheduleCurrentPageCurves();
    return;
  }
  ensureCurrentPageCurves();
  ensureHeroMirrorCurves();
  ensureCurrentPageWinShares();
  ensureAggregateEquities();
  const container = document.getElementById("asset-grid");
  container.innerHTML = "";
  const showdownSection = currentShowdownSection();
  if (showdownSection) {
    container.appendChild(showdownSection);
  }
  if (activePage === "hero" || isOpponentPage(activePage)) {
    container.appendChild(rangeMatrixSection(activePage));
  }
  for (const category of categoryOrder) {
    const assets = currentAssets().filter((asset) => asset.category === category);
    const visibleAssets = hideInactiveAssets ? assets.filter((asset) => isAssetCurrentlyActive(asset)) : assets;
    if (!visibleAssets.length) {
      continue;
    }
    container.appendChild(assetSection(category, visibleAssets, assets));
  }
}

function rangeMatrixSection(page) {
  return rangeShowdownPanel.rangeMatrixSection(page);
}

function currentShowdownSection() {
  return rangeShowdownPanel.currentShowdownSection();
}

function showdownHoleCardsForPlayer(playerId) {
  if (playerId === "hero") {
    return handState ? [handState.h1, handState.h2].filter(Boolean) : [];
  }
  return showdownHoleCardsByPlayer[playerId] || [];
}

function estimatedRangeForPage(page) {
  const deadCards = page === "hero" ? currentBoardCards() : knownCardsForHand();
  const ranges = inferRanges({
    tableConfig,
    actions: visiblePlayerActionsForCurrentStreet(),
    deadCards,
    knownBoard: currentBoardCards(),
    bucketCount: dashboardData.bucketCount,
    evaluateGradation,
    empiricalSpots: empiricalSpotsForCurrentActions(),
    playerProfiles: playerProfilesForInference(),
  });
  return ranges[page] || ranges.hero || null;
}

function openRangeMatrixFocus(page) {
  rangeShowdownPanel.openRangeMatrixFocus(page);
}

function ensureCurrentPageWinShares() {
  equityController.ensureCurrentPageWinShares();
}

function ensureAggregateEquities() {
  equityController.ensureAggregateEquities();
}

function aggregateEquitiesAreReady() {
  return equityController.aggregateEquitiesAreReady();
}

function ensureHeroMirrorCurves() {
  return curveController.ensureHeroMirrorCurves();
}

function renderConfigPage() {
  configPage.renderConfigPage();
}

function updateCalibrationContext(nextContext) {
  calibrationContext = {
    stakeBucket: nextContext.stakeBucket || "micro",
    yearBucket: nextContext.yearBucket || "2009-2010",
  };
  persistCalibrationContext(localStorage, calibrationContext);
  empiricalEvidence.clearMisses();
  invalidateRangeDerivedState();
  renderAssets();
}

function updatePlayerProfiles(nextProfiles) {
  playerProfiles = nextProfiles;
  persistPlayerProfiles(localStorage, playerProfiles);
  invalidateRangeDerivedState();
}

function updateTableConfig(nextConfig) {
  tableConfig = normalizeTableConfig(nextConfig);
  persistTableConfig();
  dashboardData.portfolios = normalizedPortfolios(dashboardData);
  currentCurves = handState ? {} : priorCurvesByPage(dashboardData);
  priorNaturalXMaps = priorNaturalXMapsByPage(currentCurves);
  resetWinShareState();
  if (isOpponentPage(activePage) && !dashboardData.portfolios[activePage]) {
    activePage = villainPageKeys()[0] || "hero";
  }
  renderPortfolioTabs();
  renderHoldingDisplay();
  updatePageTabs();
  updateLegend();
  renderCalibrationStatus();
  renderAssets();
}

function advanceHeroPositionForNewHand() {
  tableConfig = normalizeTableConfig({
    ...tableConfig,
    heroPosition: nextHeroPosition(tableConfig),
  });
  persistTableConfig();
  dashboardData.portfolios = normalizedPortfolios(dashboardData);
  if (isOpponentPage(activePage) && !dashboardData.portfolios[activePage]) {
    activePage = villainPageKeys()[0] || "hero";
  }
}

function persistTableConfig() {
  persistTableConfigStorage(localStorage, tableConfig);
}

function toggleHideInactiveAssets(event) {
  hideInactiveAssets = event.target.checked;
  persistHideInactiveAssets(localStorage, hideInactiveAssets);
}

function renderLoadingAssets({
  title = "Calculating villain distributions",
  copy = "The tab is active. Hidden-card curves are being rebuilt from hero's perspective.",
} = {}) {
  pageShell.renderLoadingAssets({ title, copy });
}

function renderHoldingDisplay() {
  renderPlayerActions();
  const status = document.getElementById("portfolio-status");
  const display = document.getElementById("holding-display");
  const assetCount = currentConcreteAssetCount();
  document.getElementById("asset-count").textContent = assetCount;
  const model = holdingDisplayModel({
    activePage,
    assetCount,
    handState,
    draftHoleCards: HandModel.pendingHoleCards(handModel),
    cardEditError,
    currentPortfolioName: currentPortfolio()?.name,
    isOpponentPage: isOpponentPage(activePage),
    villainShowdown,
    villainCards: showdownHoleCardsForPlayer(activePage),
    editableCardHtml,
  });
  status.textContent = model.statusText;
  if (model.displayHtml != null) {
    display.innerHTML = model.displayHtml;
  }
}

function renderPlayerActions() {
  return playerActionController.renderPlayerActions();
}

function currentActionStreet() {
  return playerActionController.currentActionStreet();
}

function actionPanelView() {
  return playerActionController.actionPanelView();
}

function visiblePlayerActionsForCurrentStreet(street = currentActionStreet()) {
  return playerActionController.visiblePlayerActionsForCurrentStreet(street);
}

function currentActionPrefix() {
  return playerActionController.currentActionPrefix();
}

function currentViewedActionCount() {
  return playerActionController.currentViewedActionCount();
}

function currentActionActor(street = currentActionStreet()) {
  return playerActionController.currentActionActor(street);
}

function actionPlayerOrder(street = currentActionStreet()) {
  return playerActionController.actionPlayerOrder(street);
}

function legalActionPlanForActor(playerId, street = currentActionStreet()) {
  return playerActionController.legalActionPlanForActor(playerId, street);
}

function bettingStateForCurrentStreet(street = currentActionStreet()) {
  return playerActionController.bettingStateForCurrentStreet(street);
}

function playerStacksById() {
  return playerActionController.playerStacksById();
}

function playerIdForPosition(position) {
  return playerActionController.playerIdForPosition(position);
}

function playerIsFoldedBeforeStreet(playerId, street) {
  return playerActionController.playerIsFoldedBeforeStreet(playerId, street);
}

function previousActionStreet(street) {
  return playerActionController.previousActionStreet(street);
}

function visibleActionStreets(street) {
  return playerActionController.visibleActionStreets(street);
}

function actionCountThroughStreet(street) {
  return playerActionController.actionCountThroughStreet(street);
}

function actionCountBeforeStreet(street) {
  return playerActionController.actionCountBeforeStreet(street);
}

function actionCountsForStreet(street) {
  return playerActionController.actionCountsForStreet(street);
}

function lastRemovableActionId() {
  return playerActionController.lastRemovableActionId();
}

function empiricalEvidenceForAction(action) {
  return empiricalEvidence.evidenceForAction(action);
}

function actionPlayerLabel(playerId) {
  return playerActionController.actionPlayerLabel(playerId);
}

function handlePlayerActionClick(event) {
  return playerActionController.handlePlayerActionClick(event);
}

function handleRaisePercentChange(event) {
  return playerActionController.handleRaisePercentChange(event);
}

function handleCardEditClick(event) {
  return handFlow.handleCardEditClick(event);
}

async function handleCardEditorAction(action) {
  return handFlow.handleCardEditorAction(action);
}

function rebuildTimelineForCurrentHand({ viewedIndex = viewedStreetIndex, preserveStreetModels = false } = {}) {
  return handFlow.rebuildTimelineForCurrentHand({ viewedIndex, preserveStreetModels });
}

function resetNewHand() {
  return handFlow.resetNewHand();
}

async function loadRandomInterestingHand() {
  return handFlow.loadRandomInterestingHand();
}

function dealNewRound() {
  return handFlow.dealNewRound();
}

function refreshAfterPreflopClassPart(classKey) {
  if (
    !handState ||
    handState.round !== "preflop" ||
    preflopClassKeyForCards(handState.h1, handState.h2) !== classKey
  ) {
    return;
  }
  currentCurves = {};
  actionMomentCache = new Map();
  updateLegend();
  renderAssets();
  if (focusedAsset) {
    openFocus(focusedAsset);
  }
}

function queuePreflopClassDataLoad(h1, h2) {
  const guard = createCurrentAsyncGuard({ purpose: "preflop-class-data", page: activePage });
  return preflopClassStore.queueLoad(h1, h2, {
    onLoaded: ({ classKey }) => {
      if (
        !guard.isCurrent() ||
        !handState ||
        handState.round !== "preflop" ||
        preflopClassKeyForCards(handState.h1, handState.h2) !== classKey
      ) {
        return;
      }
      currentCurves = {};
      actionMomentCache = new Map();
      resetWinShareState();
      updateLegend();
      renderAssets();
      if (focusedAsset) {
        openFocus(focusedAsset);
      }
    },
  });
}

function navigateStreet(direction) {
  return handFlow.navigateStreet(direction);
}

function navigateToStreet(index) {
  return handFlow.navigateToStreet(index);
}

function navigateToMoment(index) {
  return handFlow.navigateToMoment(index);
}

function navigationMoments() {
  return handFlow.navigationMoments();
}

function currentNavigationMomentIndex() {
  return handFlow.currentNavigationMomentIndex();
}

function isViewingLatestMoment() {
  return handFlow.isViewingLatestMoment();
}

function actionStreetForHandModel(model) {
  return handFlow.actionStreetForHandModel(model);
}

function actionMomentCacheKey(moment = { streetIndex: viewedStreetIndex, actionCount: currentViewedActionCount() }) {
  return handFlow.actionMomentCacheKey(moment);
}

function saveCurrentMomentCache() {
  return handFlow.saveCurrentMomentCache();
}

function recordCurrentStreet() {
  return handFlow.recordCurrentStreet();
}

function updateCurrentStreetSnapshot() {
  return handFlow.updateCurrentStreetSnapshot();
}

function renderCachedStreet() {
  renderHoldingDisplay();
  updateRoundButton();
  updateStreetNavButtons();
  updatePageTabs();
  updateLegend({ deferMissingCurves: true });
  renderAssets({ deferMissingCurves: true });
  if (focusedAsset && currentCurves[activePage]) {
    openFocus(focusedAsset);
  }
}

function syncHandStateFromModel() {
  return handFlow.syncHandStateFromModel();
}

function refreshVisibleHandSnapshot() {
  return handFlow.refreshVisibleHandSnapshot();
}

function commitVisibleHandSnapshot(snapshot) {
  return handFlow.commitVisibleHandSnapshot(snapshot);
}

/**
 * @param {{ purpose?: string, page?: string }} [options]
 */
function createCurrentAsyncGuard({ purpose, page = activePage } = {}) {
  return createAsyncStateGuard({
    captureToken: curveComputationToken,
    captureKey: currentAsyncSnapshotKey({ purpose, page }),
    currentToken: () => curveComputationToken,
    currentKey: () => currentAsyncSnapshotKey({ purpose, page }),
  });
}

/**
 * @param {{ purpose?: string, page?: string }} [options]
 */
function currentAsyncSnapshotKey({ purpose, page = activePage } = {}) {
  const snapshot = refreshVisibleHandSnapshot();
  return buildAsyncSnapshotKey({
    assetVersion: ASSET_VERSION,
    purpose,
    page,
    handModel,
    handState,
    viewedStreetIndex,
    viewedActionCount: snapshot.viewedActionCount,
    visibleActions: snapshot.visiblePlayerActions,
    tableConfig,
    activeVillains: activeVillainPageKeys(),
    villainShowdown,
    showdownHoleCardsByPlayer,
  });
}

function shouldDeferCurrentPageCurves() {
  return curveController.shouldDeferCurrentPageCurves();
}

function shouldRenderWithoutCurrentPageCurves() {
  return curveController.shouldRenderWithoutCurrentPageCurves();
}

function scheduleCurrentPageCurves({ delayMs = 20 } = {}) {
  return curveController.scheduleCurrentPageCurves({ delayMs });
}

function updateRoundButton() {
  const button = /** @type {HTMLButtonElement | null} */ (document.getElementById("new-round-button"));
  if (!button) {
    return;
  }
  if (!handState) {
    button.disabled = false;
    button.textContent = "Deal holding";
  } else if (handState.round === "preflop") {
    button.disabled = !isViewingLatestMoment();
    button.textContent = "Deal flop";
  } else if (handState.round === "flop") {
    button.disabled = !isViewingLatestMoment();
    button.textContent = "Deal turn";
  } else if (handState.round === "turn") {
    button.disabled = !isViewingLatestMoment();
    button.textContent = "Deal river";
  } else {
    button.disabled = !isViewingLatestMoment() || viewedStreetIndex >= handTimeline.length - 1;
    button.textContent = "River dealt";
  }
}

function updateStreetNavButtons() {
  const currentIndex = currentNavigationMomentIndex();
  const momentCount = navigationMoments().length;
  const previousButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("previous-street-button"));
  const nextButton = /** @type {HTMLButtonElement | null} */ (document.getElementById("next-street-button"));
  if (previousButton) {
    previousButton.disabled = currentIndex <= 0;
  }
  if (nextButton) {
    nextButton.disabled = currentIndex < 0 || currentIndex >= momentCount - 1;
  }
}

function revealVillain() {
  if (!handState || handState.round !== "river" || villainShowdown) {
    return;
  }

  showdownHoleCardsByPlayer = assignShowdownHoleCards();
  handModel = HandModel.revealVillainModel(handModel);
  syncHandStateFromModel();
  updateCurrentStreetSnapshot();
  for (const page of villainPageKeys()) {
    currentCurves[page] = curvesForVillain(page);
  }
  resetWinShareState();
  updateCurrentStreetSnapshot();
  renderHoldingDisplay();
  updatePageTabs();
  updateLegend();
  renderAssets();
  if (focusedAsset) {
    openFocus(focusedAsset);
  }
}

function assignShowdownHoleCards() {
  const assigned = {
    hero: [handState.h1, handState.h2].filter(Boolean),
    ...showdownHoleCardsByPlayer,
  };
  let usedCards = [
    ...knownCardsForHand(),
    ...Object.values(assigned).flat(),
  ];
  const liveVillains = villainPageKeys().filter((page) => !playerHasFoldedByStreet(playerActions, page, "river"));
  for (const page of liveVillains) {
    if (assigned[page]?.length === 2) {
      continue;
    }
    assigned[page] = dealCardsFromDeck(remainingDeckForKnownCards(usedCards), 2).sort(cardCompare);
    usedCards = [...usedCards, ...assigned[page]];
  }
  return assigned;
}

function dealHoleCards() {
  return dealCardsFromDeck(fullDeck, 2).sort(cardCompare);
}

function dealCardsFromDeck(deck, count) {
  return drawCardsFromDeck(deck, count, sessionRng);
}

function knownCardsForHand() {
  return cardState.knownCardsForHand();
}

function allDealtCardsForDeck(page = null) {
  return cardState.allDealtCardsForDeck(page);
}

function showdownHoleCardsForDeadCards(page = null) {
  return cardState.showdownHoleCardsForDeadCards(page);
}

function remainingDeckForKnownCards(knownCards) {
  return cardState.remainingDeckForKnownCards(knownCards);
}

function ensureCurrentPageCurves() {
  return curveController.ensureCurrentPageCurves();
}

function curvesForVillain(page = activePage) {
  return curveController.curvesForVillain(page);
}

function curvesForRangeAggregate() {
  return curveController.curvesForRangeAggregate();
}

function ensureEmpiricalSpotsForActions() {
  empiricalEvidence.ensureForActions(visiblePlayerActionsForCurrentStreet());
}

function empiricalSpotsForCurrentActions() {
  return empiricalEvidence.spotsForActions(visiblePlayerActionsForCurrentStreet());
}

function empiricalRequestForPlayerAction(action) {
  const position = actionPositionForPlayer(action.player);
  if (!position) {
    return null;
  }
  return empiricalSpotRequest({
    action,
    position,
    playerCount: tableConfig.playerCount,
    facingAggression: actionFacesAggression(action),
    stakeBucket: calibrationContext.stakeBucket,
    yearBucket: calibrationContext.yearBucket,
  });
}

function empiricalEvidenceForRange(range) {
  return empiricalEvidence.evidenceForRange(range, visiblePlayerActionsForCurrentStreet());
}

function playerProfilesForInference() {
  const profiles = {};
  for (const [playerId, profile] of Object.entries(playerProfiles || {})) {
    profiles[playerId] = profile;
    const position = playerId === "hero" ? tableConfig.heroPosition : positionFromPageKey(playerId);
    if (position) {
      profiles[position] = profile;
    }
  }
  return profiles;
}

function actionPositionForPlayer(player) {
  return player === "hero" ? tableConfig.heroPosition : positionFromPageKey(player);
}

function actionFacesAggression(action) {
  const streetActions = visiblePlayerActionsForCurrentStreet(action.street).filter((candidate) => candidate.street === action.street);
  return streetActions.some((candidate) =>
    candidate.player !== action.player &&
    ["bet", "raise", "all-in"].includes(candidate.type) &&
    streetActions.indexOf(candidate) < streetActions.indexOf(action),
  );
}


function formatEvidenceProbabilities(probabilities = {}) {
  return ["fold", "check", "call", "bet", "raise", "all-in"]
    .filter((action) => Number.isFinite(probabilities[action]))
    .map((action) => `${action}:${Math.round(probabilities[action] * 100)}%`)
    .join(" ");
}

function invalidateRangeDerivedState() {
  currentCurves = handState ? {} : priorCurvesByPage(dashboardData);
  currentWinShares = handState ? {} : priorWinSharesByPage();
  actionMomentCache = new Map();
  resetWinShareState();
  curveComputationToken += 1;
}

function missingBoardTokens() {
  return cardState.missingBoardTokens();
}

function aggregateTokensForPage(page) {
  return cardState.aggregateTokensForPage(page);
}

function currentKnownBoardState() {
  return cardState.currentKnownBoardState();
}

function currentKnownHeroState() {
  return cardState.currentKnownHeroState();
}

function currentKnownVillainState() {
  return cardState.currentKnownVillainState();
}

function currentKnownVillainStateForPage(page) {
  return cardState.currentKnownVillainStateForPage(page);
}

function evaluateGradation(cards) {
  return handEvaluator.evaluateGradation(cards);
}

function evaluateGradationFive(first, second, third, fourth, fifth) {
  return handEvaluator.evaluateGradationFive(first, second, third, fourth, fifth);
}

function renderLegend({ bands, firstActiveIndex, lastActiveIndex }) {
  renderLegendHtml(document, { bands, firstActiveIndex, lastActiveIndex });
}

function updateLegend({ deferMissingCurves = false } = {}) {
  if (deferMissingCurves && shouldRenderWithoutCurrentPageCurves()) {
    renderLegend({
      bands: dashboardData.categoryBands.map((band) => ({ ...band, active: true })),
      firstActiveIndex: 0,
      lastActiveIndex: dashboardData.categoryBands.length - 1,
    });
    return;
  }
  ensureCurrentPageCurves();
  renderLegend(possibleCategoryBands());
}

function possibleCategoryBands() {
  const activeCategories = activeLegendCategories();
  const bands = dashboardData.categoryBands.map((band) => ({
    ...band,
    active: activeCategories.has(band.category),
  }));
  const activeIndexes = bands
    .map((band, index) => (band.active ? index : null))
    .filter((index) => index != null);

  if (activeIndexes.length === 0) {
    return { bands, firstActiveIndex: 0, lastActiveIndex: bands.length - 1 };
  }

  return {
    bands,
    firstActiveIndex: Math.min(...activeIndexes),
    lastActiveIndex: Math.max(...activeIndexes),
  };
}

function activeLegendCategories() {
  const categories = pagePossibleCategories();
  if (categories.size === dashboardData.categoryBands.length) {
    return categories;
  }

  for (const category of opponentPossibleCategories(categories)) {
    categories.add(category);
  }
  return categories;
}

function pagePossibleCategories() {
  const categories = new Set();
  for (const band of dashboardData.categoryBands) {
    if (currentAssets().some((asset) => {
      const curveData = curveForAsset(asset);
      return curveData && distributionCanReachBand(curveData, band);
    })) {
      categories.add(band.category);
    }
  }
  return categories;
}

function opponentPossibleCategories(existingCategories = new Set()) {
  const categories = new Set();
  const board = currentBoardCards();
  if (handState?.round === "preflop" && board.length === 0) {
    return new Set(dashboardData.categoryBands.map((band) => band.category));
  }
  const futureBoardSlots = 5 - board.length;
  const candidateCards = board.concat(remainingDeckForKnownCards(knownCardsForHand()));
  const selected = [];

  function visit(start, depth, unknownCount) {
    if (categories.size + existingCategories.size >= dashboardData.categoryBands.length) {
      return;
    }
    if (unknownCount > futureBoardSlots + 2) {
      return;
    }
    if (depth === 5) {
      const category = categoryByGradation[evaluateGradation(selected)];
      if (!existingCategories.has(category)) {
        categories.add(category);
      }
      return;
    }

    const remainingNeeded = 5 - depth;
    for (let index = start; index <= candidateCards.length - remainingNeeded; index += 1) {
      const card = candidateCards[index];
      selected[depth] = card;
      visit(index + 1, depth + 1, unknownCount + (board.some((boardCard) => sameCard(boardCard, card)) ? 0 : 1));
    }
  }

  visit(0, 0, 0);
  return categories;
}

function currentBoardCards() {
  return cardState.currentBoardCards();
}

function categoryLookup(categoryBands, bucketCount) {
  const lookup = new Array(bucketCount + 1);
  for (const band of categoryBands) {
    for (let gradation = band.start; gradation <= band.end; gradation += 1) {
      lookup[gradation] = band.category;
    }
  }
  return lookup;
}

function distributionCanReachBand(curveData, band) {
  const startProbability = band.start === 1 ? 0 : curveData.curve[band.start - 2].probability;
  const endProbability = curveData.curve[band.end - 1].probability;
  return endProbability - startProbability > 0;
}

function categoryForGradation(gradation) {
  return dashboardData.categoryBands.find((band) => gradation >= band.start && gradation <= band.end) || {
    name: "Hand",
    color: "var(--accent)",
  };
}

function renderFocusLayer() {
  assetBoard.renderFocusLayer();
}

function assetSection(category, assets, allAssets = assets) {
  return assetBoard.assetSection(category, assets, allAssets);
}

function openFocus(asset) {
  assetBoard.openFocus(asset);
}

function cachedWinShareForAsset(asset) {
  if (isAggregateMatchup(asset)) {
    return aggregateMatchupShare(asset);
  }
  if (asset.isAggregate) {
    return cachedWinShareForAggregate(asset);
  }
  const page = asset.sourcePage || activePage;
  if (handState && (page === "range" || (isOpponentPage(page) && !villainShowdown))) {
    return null;
  }
  return currentWinShares[page]?.shares?.[asset.code] ?? null;
}

function cachedWinShareForAggregate(asset) {
  if (!isCategoryAggregate(asset)) {
    return null;
  }
  const page = asset.sourcePage || activePage;
  const shares = currentWinShares[page]?.shares;
  if (!shares) {
    return null;
  }
  return asset.assetCodes.reduce((total, assetCode) => total + (shares[assetCode] || 0), 0);
}

function winShareForAsset(asset) {
  if (isAggregateMatchup(asset)) {
    return aggregateMatchupShare(asset);
  }
  if (asset.isAggregate) {
    if (!isCategoryAggregate(asset)) {
      return null;
    }
    const page = asset.sourcePage || activePage;
    if (!currentWinShares[page]) {
      ensureCurrentPageWinShares();
      return null;
    }
    return cachedWinShareForAggregate(asset);
  }

  const page = asset.sourcePage || activePage;
  if (handState && (page === "range" || (isOpponentPage(page) && !villainShowdown))) {
    return null;
  }

  if (!currentWinShares[page]) {
    ensureCurrentPageWinShares();
    return null;
  }
  return currentWinShares[page]?.shares[asset.code] ?? null;
}

function isCategoryAggregate(asset) {
  return asset.isAggregate && asset.category !== "AGGREGATE" && Array.isArray(asset.assetCodes);
}

function isAggregateMatchup(asset) {
  return isHandAggregateMatchup(asset) || isRangeAggregateMatchup(asset);
}

function isHandAggregateMatchup(asset) {
  return asset.isAggregate && asset.category === "AGGREGATE" && (asset.sourceCode || asset.code) === "AGG" && (asset.sourcePage || activePage) === "hero";
}

function isRangeAggregateMatchup(asset) {
  return asset.isAggregate && asset.category === "AGGREGATE" && asset.code === "RANGE_AGG";
}

function aggregateMatchupShare(asset) {
  if (isRangeAggregateMatchup(asset)) {
    return currentWinShares.hero?.aggregateShares?.RANGE_AGG ?? 0.5;
  }
  const page = asset.sourcePage || activePage;
  return currentWinShares[page]?.aggregateShares?.[asset.sourceCode || asset.code] ?? priorAggregateMatchupShare(asset);
}

function priorAggregateMatchupShare(asset) {
  const prior = dashboardData?.priorWinShares?.aggregateMatchups || {};
  if (isRangeAggregateMatchup(asset)) {
    return prior.RANGE_AGG ?? 0.5;
  }
  if (isHandAggregateMatchup(asset)) {
    return prior.AGG ?? 0.5;
  }
  return null;
}

function aggregateMatchupTitle(asset, share) {
  if (isRangeAggregateMatchup(asset)) {
    return `Equity vs active villains ${formatPercent(share)}`;
  }
  if (isHandAggregateMatchup(asset)) {
    const prefix = aggregateEquityIsEstimated("actual") ? "Estimated equity" : "Equity";
    return `${prefix} vs active villains ${formatPercent(share)}`;
  }
  if (asset.isVillainMirror || isOpponentPage(asset.sourcePage || activePage)) {
    const prefix = aggregateEquityIsEstimated("actual") ? "Estimated equity" : "Equity";
    return `${prefix} vs Hero and active villains ${formatPercent(share)}`;
  }
  return "";
}

function aggregateEquityIsEstimated(matchup) {
  return Boolean(handState && currentWinShares.hero?.aggregateEquityMeta?.[matchup]?.exact === false);
}

function closeFocus() {
  assetBoard.closeFocus();
}

function curveForAsset(asset) {
  const curvePage = asset.sourcePage || activePage;
  const curveCode = asset.sourceCode || asset.code;
  const curve = currentCurves[curvePage]?.[curveCode];
  if (!curve && handState?.round === "preflop" && (asset.isRangeAggregate || asset.isVillainMirror)) {
    return priorCurveForModel(
      portfolioForCurvePage(curvePage).aggregates?.find((aggregate) => aggregate.code === curveCode),
      dashboardData,
      priorAggregateCurve(dashboardData),
    );
  }
  if (curve || asset.isAggregate) {
    return curve || null;
  }
  return { curve: dashboardData.curve, totalCombos: dashboardData.totalCombos };
}

function preflopActionDerivedRangesActive() {
  return Boolean(handState && visiblePlayerActionsForCurrentStreet().length);
}

function isAssetCurrentlyActive(asset, curveData = curveForAsset(asset), ceilingGradation = ceilingForOtherAssets(asset)) {
  if (isVillainPageFolded(asset.sourcePage || activePage)) {
    return false;
  }
  if (asset.isAggregate) {
    return isAggregateCurrentlyActive(asset);
  }
  return isConcreteAssetCurrentlyActive(asset, curveData, ceilingGradation);
}

function isAggregateCurrentlyActive(asset) {
  if (!handState) {
    return true;
  }
  if (isHandAggregateMatchup(asset) || isRangeAggregateMatchup(asset)) {
    return !playerHasFoldedByStreet(visiblePlayerActionsForCurrentStreet(), "hero", currentActionStreet());
  }
  if (asset.isVillainMirror || isOpponentPage(asset.sourcePage || activePage)) {
    return !isVillainPageFolded(asset.sourcePage || activePage);
  }

  const sourcePortfolio = portfolioForCurvePage(asset.sourcePage || activePage);
  return aggregateIsActive({
    aggregate: asset,
    assets: sourcePortfolio.assets,
    hasHandState: Boolean(handState),
    isUnderlyingAssetActive: (underlyingAsset) =>
      isConcreteAssetCurrentlyActiveOnPage(underlyingAsset, asset.sourcePage || activePage),
  });
}

function isConcreteAssetCurrentlyActiveOnPage(asset, page) {
  if (isVillainPageFolded(page)) {
    return false;
  }
  const curveData = currentCurves[page]?.[asset.code];
  if (!curveData) {
    return true;
  }
  return isConcreteAssetCurrentlyActive(
    { ...asset, sourcePage: page, sourceCode: asset.code },
    curveData,
    ceilingForOtherAssetsOnPage(asset, page),
  );
}

function isConcreteAssetCurrentlyActive(asset, curveData = curveForAsset(asset), ceilingGradation = ceilingForOtherAssets(asset)) {
  return concreteAssetIsActive({
    curveData,
    ceilingGradation,
    hasHandState: Boolean(handState),
  });
}

function ceilingForOtherAssets(asset) {
  if (asset.isAggregate) {
    return curveForAsset(asset)?.worstGradation ?? null;
  }
  if (!handState) {
    return dashboardData.bucketCount;
  }

  return ceilingForOtherAssetsOnPage(asset, asset.sourcePage || activePage);
}

function ceilingForOtherAssetsOnPage(asset, page) {
  if (!handState) {
    return dashboardData.bucketCount;
  }
  const sourcePortfolio = portfolioForCurvePage(page);
  return ceilingForOtherAssetsInPortfolio({
    assetCode: asset.code,
    assets: sourcePortfolio.assets,
    curvesByCode: currentCurves[page],
    bucketCount: dashboardData.bucketCount,
  });
}

function portfolioForCurvePage(page) {
  if (page === "range") {
    return baseVillainPortfolio();
  }
  return dashboardData.portfolios[page] || currentPortfolio();
}

function knownCardsForAsset(asset, page = activePage) {
  return cardState.knownCardsForAsset(asset, page);
}

function cardForToken(token) {
  return cardForTokenOnPage(token, activePage);
}

function cardForTokenOnPage(token, page) {
  return assetBoard.cardForTokenOnPage(token, page);
}

function boardCardForToken(token) {
  return cardForTokenOnPage(token, "board");
}

function isBoardToken(token) {
  return token === "F_1" || token === "F_2" || token === "F_3" || token === "T" || token === "R";
}

function editableCardHtml(token, card) {
  return assetBoard.editableCardHtml(token, card);
}
