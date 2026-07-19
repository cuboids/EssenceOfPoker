import * as HandModel from "./hand_state.mjs";
import { createHandFlowController } from "./hand_flow_controller.mjs";
import {
  categoryDescriptions,
  categoryLabels,
  categoryOrder,
} from "./app_config.mjs";
import { createAppState, initializeHandState } from "./app_state.mjs";
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
import {
  cardCompare,
  cardId,
  fullDeck,
  sameCard,
} from "./cards.mjs";
import { preflopClassKeyForCards } from "./cache_keys.mjs";
import {
  bindDashboardControls,
} from "./controllers/dashboard_controls.mjs";
import { createConfigPageController } from "./config_page_controller.mjs";
import { createPlayerActionController } from "./player_action_controller.mjs";
import { createRangeShowdownPanel } from "./range_showdown_panel.mjs";
import {
  readEmpiricalSpot,
  readHealth,
  readPreflopAggregateClass,
  readPreflopHiddenVillainClass,
  readPreflopPrimaryClass,
} from "./data_client.mjs";
import { createHandEvaluator } from "./evaluation.mjs";
import { createEquityController } from "./equity_controller.mjs";
import { holdingDisplayModel } from "./renderers/holding_renderer.mjs";
import {
  curveFromTrimmedCounts,
  curvesForKnownAssets as curvesForKnownAssetsKernel,
} from "./curve_distributions.mjs";
import {
  validateDashboardData,
  validatePreflopHandEquityCache,
  validatePriorWinShares,
} from "./data_contracts.mjs";
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
  hashString,
  sessionSeed,
} from "./session_rng.mjs";
import {
  actionsForStreet,
  playerHasFoldedByStreet,
} from "./player_actions.mjs";
import { createPreflopClassStore } from "./stores/preflop_class_store.mjs";
import {
  createEmpiricalSpotStore,
  empiricalStatusLabel,
} from "./stores/empirical_spot_store.mjs";
import {
  persistCalibrationContext,
  persistHideInactiveAssets,
  persistPlayerProfiles,
  persistTableConfig as persistTableConfigStorage,
  persistTheme,
} from "./local_storage_schema.mjs";
import {
  DEFAULT_RANGE_CURVE_SIMS,
  curvesFromPreflopHiddenVillainCache,
  hiddenVillainCurves as hiddenVillainCurvesKernel,
  weightedRangeAssetCurves,
} from "./villain_range.mjs";
import { createComputationWorker } from "./computation_worker_client.mjs";
import { inferPreflopRanges } from "./range_update.mjs";
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

const ASSET_VERSION = window.ESSENCE_ASSET_VERSION || Date.now();
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
  readAggregateClass: readPreflopAggregateClass,
  readHiddenVillainClass: readPreflopHiddenVillainClass,
  readPrimaryClass: readPreflopPrimaryClass,
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
const empiricalSpotStore = createEmpiricalSpotStore({
  readSpot: readEmpiricalSpot,
  readHealth,
  requestForAction: empiricalRequestForPlayerAction,
  onLoadingChange: () => {
    renderCalibrationStatus();
    renderHoldingDisplay();
  },
  onUpdated: () => {
    invalidateRangeDerivedState();
    renderCalibrationStatus();
    renderHoldingDisplay();
    renderAssets();
  },
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
  allDealtCardsForDeck,
  assetVersion: () => ASSET_VERSION,
  computationWorker: () => computationWorker,
  createCurrentAsyncGuard,
  currentBoardCards,
  currentKnownHeroState,
  currentKnownVillainStateForPage,
  currentWinShares: () => currentWinShares,
  dashboardData: () => dashboardData,
  empiricalSpotsForCurrentActions,
  evaluateGradation,
  evaluateGradationFive,
  focusedAsset: () => focusedAsset,
  handState: () => handState,
  isOpponentPage,
  isVillainPageFolded,
  knownCardsForHand,
  openFocus,
  patchCurrentWinShares,
  playerProfilesForInference,
  portfolioForCurvePage,
  priorWinSharesByPage,
  remainingDeckForKnownCards,
  renderAssets,
  saveCurrentMomentCache,
  setCurrentWinShares: (shares) => { currentWinShares = shares; },
  tableConfig: () => tableConfig,
  updateCurrentStreetSnapshot,
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

Promise.all([
  fetch(`data/prior_portfolio.json?v=${ASSET_VERSION}`).then((response) => response.json()),
  fetch(`data/prior_win_shares.json?v=${ASSET_VERSION}`).then((response) => response.json()),
  fetch(`data/preflop_hand_equity_cache.json?v=${ASSET_VERSION}`).then((response) => response.json()),
])
  .then(([data, priorWinShares, handEquityCache]) => {
    validateDashboardData(data);
    validatePriorWinShares(priorWinShares);
    validatePreflopHandEquityCache(handEquityCache);
    preflopHandEquityCache = handEquityCache;
    bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
    handEvaluator = createHandEvaluator(bucketLookup, data.bucketCount);
    computationWorker = createComputationWorker(ASSET_VERSION, { onFailure: recordWorkerFailure });
    priorXByGradation = new Map(data.curve.map((point) => [point.gradation, point.x]));
    aggregatePriorXByGradation = aggregatePriorXMap(data);
    data.priorWinShares = priorWinShares;
    renderDashboard(data);
    hydrateEmpiricalCalibrationHealth();
  });

function aggregatePriorXMap(data) {
  const lookup = new Map();
  const aggregate = data.priorAggregate;
  if (!aggregate?.counts || !aggregate.totalCombos) {
    return priorXByGradation;
  }

  let cumulative = 0;
  for (let gradation = 1; gradation <= data.bucketCount; gradation += 1) {
    cumulative += aggregate.counts[gradation] || 0;
    lookup.set(gradation, cumulative / aggregate.totalCombos);
  }
  return lookup;
}

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
  chartMode = event.target.value;
  renderAssets();
  if (focusedAsset) {
    openFocus(focusedAsset);
  }
}

function toggleThemeMode(event) {
  useDarkTheme = event.target.checked;
  persistTheme(localStorage, useDarkTheme);
  applyThemeMode();
}

function applyThemeMode() {
  document.body.classList.toggle("theme-dark", useDarkTheme);
  document.getElementById("theme-toggle").checked = useDarkTheme;
}

async function hydrateEmpiricalCalibrationHealth() {
  await empiricalSpotStore.hydrateHealth();
}

function renderCalibrationStatus() {
  const container = document.getElementById("calibration-status");
  if (!container) {
    return;
  }
  const health = empiricalSpotStore.health?.data?.empiricalCalibration;
  const actions = visiblePlayerActionsForCurrentStreet();
  const summary = empiricalSpotStore.summary(actions);
  const status = empiricalSpotStore.status(actions);
  const corpusLabel = !empiricalSpotStore.health
    ? "Checking empirical calibration"
    : health?.ok
      ? `${formatInteger(health.hands)} hands · ${formatInteger(health.actions)} actions`
      : "Empirical calibration unavailable";
  const spotLabel = summary.total
    ? `${summary.ready}/${summary.total} action spots loaded${summary.pending ? " · loading" : ""}`
    : "No action spots yet";
  const latestWorkerFailure = workerFailures.at(-1);
  const workerStatus = latestWorkerFailure
    ? `<span class="empirical-pill fallback" title="${escapeHtml(latestWorkerFailure.message)}">Worker fallback</span>`
    : "";
  container.innerHTML = `
    <span class="empirical-pill ${status}">${escapeHtml(empiricalStatusLabel(status))}</span>
    <span>${escapeHtml(corpusLabel)}</span>
    <span>${escapeHtml(calibrationContext.stakeBucket)} · ${escapeHtml(calibrationContext.yearBucket)}</span>
    <span>${escapeHtml(spotLabel)}</span>
    ${workerStatus}
  `;
}

function recordWorkerFailure(failure) {
  workerFailures = [...workerFailures.slice(-4), failure];
  appState.computed.workerFailures = workerFailures;
  renderCalibrationStatus();
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
  const container = document.getElementById("portfolio-tabs");
  const villainTabs = villainPageKeys()
    .map((page) => `
      <button
        class="page-tab ${isVillainPageFolded(page) ? "is-folded" : ""}"
        type="button"
        data-page="${page}"
        title="${isVillainPageFolded(page) ? `${dashboardData.portfolios[page].name} folded` : dashboardData.portfolios[page].name}"
      >
        ${dashboardData.portfolios[page].name}
      </button>
    `)
    .join("");
  container.innerHTML = `
    <button class="page-tab" id="hero-page-button" type="button" data-page="hero">Hero</button>
    ${villainTabs}
    <button class="control-button showdown-button" id="showdown-button" type="button" hidden>Showdown</button>
  `;
  for (const button of container.querySelectorAll("[data-page]")) {
    button.addEventListener("click", () => switchPage(button.dataset.page));
  }
  document.getElementById("showdown-button").addEventListener("click", revealVillain);
}

function switchPage(page) {
  if (page !== "config" && !dashboardData.portfolios[page]) {
    return;
  }
  activePage = page;
  focusedAsset = null;
  closeFocus();
  renderHoldingDisplay();
  updatePageTabs();
  if (shouldDeferCurrentPageCurves()) {
    renderLoadingAssets();
    scheduleCurrentPageCurves();
    return;
  }
  ensureCurrentPageCurves();
  updateLegend();
  renderAssets();
}

function updatePageTabs() {
  for (const button of document.querySelectorAll("[data-page]")) {
    button.classList.toggle("is-active", button.dataset.page === activePage);
    button.classList.toggle("is-folded", isVillainPageFolded(button.dataset.page));
  }
  const showdownButton = document.getElementById("showdown-button");
  showdownButton.hidden = !(handState?.round === "river" && !villainShowdown);
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
  const ranges = inferPreflopRanges({
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
  if (activePage !== "hero") {
    return;
  }
  ensureHeroRangeCurves();
  ensureHeroVillainAggregateCurves();
}

function ensureHeroRangeCurves() {
  if (currentCurves.range) {
    return;
  }
  if (!handState || currentBoardCards().length === 0) {
    currentCurves.range = curvesForRangeAggregate();
    updateCurrentStreetSnapshot();
    return;
  }
  scheduleHeroMirrorCurves("range");
}

function ensureHeroVillainAggregateCurves() {
  const pages = villainPageKeys().filter((page) => !currentCurves[page]);
  if (!pages.length) {
    return;
  }
  if (!handState || currentBoardCards().length === 0 || villainShowdown) {
    for (const page of pages) {
      currentCurves[page] = curvesForVillain(page);
    }
    updateCurrentStreetSnapshot();
    return;
  }
  scheduleHeroMirrorCurves(pages);
}

function scheduleHeroMirrorCurves(pageOrPages) {
  if (villainMirrorComputationScheduled) {
    return;
  }
  const pages = Array.isArray(pageOrPages) ? pageOrPages : [pageOrPages];
  const guards = new Map(pages.map((page) => [page, createCurrentAsyncGuard({ purpose: "hero-mirror-curves", page })]));
  villainMirrorComputationScheduled = true;
  setTimeout(() => {
    villainMirrorComputationScheduled = false;
    if (!pages.some((page) => guards.get(page).isCurrent())) {
      return;
    }
    for (const page of pages) {
      if (guards.get(page).isCurrent() && !currentCurves[page]) {
        currentCurves[page] = page === "range" ? curvesForRangeAggregate() : curvesForVillain(page);
      }
    }
    updateCurrentStreetSnapshot();
    if (activePage === "hero") {
      updateLegend();
      renderAssets();
      if (focusedAsset?.sourcePage && pages.includes(focusedAsset.sourcePage)) {
        openFocus(focusedAsset);
      }
    }
  }, 20);
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
  empiricalSpotStore.clearMisses();
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
  const container = document.getElementById("asset-grid");
  container.innerHTML = `
    <section class="asset-loading" aria-live="polite">
      <span class="asset-loading-title">${escapeHtml(title)}</span>
      <span class="asset-loading-copy">${escapeHtml(copy)}</span>
    </section>
  `;
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
  return empiricalSpotStore.evidenceForAction(action);
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

function createCurrentAsyncGuard({ purpose, page = activePage } = {}) {
  return createAsyncStateGuard({
    captureToken: curveComputationToken,
    captureKey: currentAsyncSnapshotKey({ purpose, page }),
    currentToken: () => curveComputationToken,
    currentKey: () => currentAsyncSnapshotKey({ purpose, page }),
  });
}

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
  return (
    isOpponentPage(activePage) &&
    handState &&
    !villainShowdown &&
    currentBoardCards().length > 0 &&
    !preflopActionDerivedRangesActive() &&
    !currentCurves[activePage]
  );
}

function shouldRenderWithoutCurrentPageCurves() {
  return activePage !== "config" && handState && !currentCurves[activePage];
}

function scheduleCurrentPageCurves({ delayMs = 20 } = {}) {
  curveComputationToken += 1;
  const guard = createCurrentAsyncGuard({ purpose: "current-page-curves", page: activePage });
  setTimeout(() => {
    if (!guard.isCurrent()) {
      return;
    }
    ensureCurrentPageCurves();
    if (!guard.isCurrent()) {
      return;
    }
    updateLegend();
    renderAssets();
    saveCurrentMomentCache();
    if (focusedAsset) {
      openFocus(focusedAsset);
    }
  }, delayMs);
}

function updateRoundButton() {
  const button = document.getElementById("new-round-button");
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
  document.getElementById("previous-street-button").disabled = currentIndex <= 0;
  document.getElementById("next-street-button").disabled =
    currentIndex < 0 || currentIndex >= momentCount - 1;
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
  if (!handState) {
    return [];
  }
  return [handState.h1, handState.h2, ...handState.flop, handState.turn, handState.river].filter(Boolean);
}

function allDealtCardsForDeck(page = null) {
  if (!handState) {
    return [];
  }
  return [...knownCardsForHand(), ...showdownHoleCardsForDeadCards(page)].filter(Boolean);
}

function showdownHoleCardsForDeadCards(page = null) {
  if (!villainShowdown) {
    return handState?.v1 && handState?.v2 ? [handState.v1, handState.v2] : [];
  }
  if (isOpponentPage(page)) {
    return showdownHoleCardsForPlayer(page);
  }
  return Object.values(showdownHoleCardsByPlayer).flat();
}

function remainingDeckForKnownCards(knownCards) {
  return fullDeck.filter((card) => !knownCards.some((knownCard) => sameCard(card, knownCard)));
}

function ensureCurrentPageCurves() {
  if (currentCurves[activePage]) {
    return;
  }
  if (!handState) {
    currentCurves[activePage] = priorCurvesByPage(dashboardData)[activePage];
    return;
  }
  if (isOpponentPage(activePage)) {
    currentCurves[activePage] = curvesForVillain(activePage);
    return;
  }
  if (handState.round === "preflop") {
    currentCurves.hero = curvesForHeroPreflop();
    return;
  }
  currentCurves.hero = curvesForKnownAssets(dashboardData.portfolios.hero.assets, remainingDeckForKnownCards(knownCardsForHand()), "hero");
}

function curvesForHeroPreflop() {
  const classKey = preflopClassKeyForCards(handState.h1, handState.h2);
  const portfolio = dashboardData.portfolios.hero;
  const curves = { ...priorCurvesByPage(dashboardData).hero };
  const primaryClass = preflopPrimaryClasses[classKey];
  if (primaryClass) {
    for (const asset of portfolio.assets) {
      if (primaryClass[asset.code]) {
        curves[asset.code] = curveFromTrimmedCounts(
          primaryClass[asset.code],
          primaryClass[asset.code].totalCombos,
          dashboardData.bucketCount,
          priorXByGradation,
        );
      }
    }
  }

  const aggregateClass = preflopAggregateClasses[classKey]?.classes?.[classKey];
  if (aggregateClass) {
    for (const aggregate of portfolio.aggregates || []) {
      if (aggregateClass[aggregate.code]) {
        curves[aggregate.code] = curveFromTrimmedCounts(
          aggregateClass[aggregate.code],
          preflopAggregateClasses[classKey].totalCombos,
          dashboardData.bucketCount,
          priorXByGradation,
        );
      } else if (aggregate.code === "AGG_ZERO" && curves["1.1"]) {
        curves[aggregate.code] = curves["1.1"];
      }
    }
  }
  return curves;
}

function curvesForKnownAssets(assets, remainingDeck, page) {
  const portfolio = dashboardData.portfolios[page];
  const aggregates = portfolio.aggregates || [];
  return curvesForKnownAssetsKernel({
    assets,
    aggregates,
    remainingDeck,
    knownCardsForAsset: (asset) => knownCardsForAsset(asset, page),
    knownState: handState ? (isOpponentPage(page) ? currentKnownVillainStateForPage(page) : currentKnownHeroState()) : null,
    aggregateTokens: aggregateTokensForPage(page),
    bucketCount: dashboardData.bucketCount,
    priorXByGradation,
    evaluateGradation,
    preflopPrimaryCache: page === "hero" && handState?.round === "preflop"
      ? preflopPrimaryClasses[preflopClassKeyForCards(handState.h1, handState.h2)]
      : null,
    preflopAggregateCache: page === "hero" && handState?.round === "preflop"
      ? preflopAggregateClasses[preflopClassKeyForCards(handState.h1, handState.h2)]
      : null,
    preflopClassKey: page === "hero" && handState?.round === "preflop"
      ? preflopClassKeyForCards(handState.h1, handState.h2)
      : null,
  });
}

function curvesForVillain(page = activePage) {
  const assets = dashboardData.portfolios[page]?.assets || baseVillainPortfolio().assets;
  const aggregates = dashboardData.portfolios[page]?.aggregates || baseVillainPortfolio().aggregates || [];
  if (!handState) {
    return priorCurvesByPage(dashboardData)[page];
  }
  if (villainShowdown) {
    return curvesForKnownAssets(assets, remainingDeckForKnownCards(allDealtCardsForDeck(page)), page);
  }
  if (preflopActionDerivedRangesActive()) {
    const weighted = weightedCurvesForRangePage({
      page,
      assets,
      aggregates,
      range: inferredRangesForCurves(page)?.[page],
      holeTokens: ["V_1", "V_2"],
      deadCards: knownCardsForHand(),
    });
    if (weighted) {
      return weighted;
    }
  }
  if (currentBoardCards().length === 0) {
    return preflopHiddenVillainCurves(assets);
  }

  return hiddenVillainCurves(assets);
}

function curvesForRangeAggregate() {
  if (!handState) {
    return priorCurvesByPage(dashboardData).hero;
  }
  if (preflopActionDerivedRangesActive()) {
    const portfolio = dashboardData.portfolios.hero;
    const weighted = weightedCurvesForRangePage({
      page: "range",
      assets: portfolio.assets,
      aggregates: portfolio.aggregates || [],
      range: inferredRangesForCurves("range")?.hero,
      holeTokens: ["H_1", "H_2"],
      deadCards: currentBoardCards(),
    });
    if (weighted) {
      return weighted;
    }
  }
  const page = villainPageKeys()[0];
  const assets = dashboardData.portfolios[page]?.assets || baseVillainPortfolio().assets;
  if (currentBoardCards().length === 0) {
    return preflopHiddenVillainCurves(assets);
  }
  return hiddenVillainCurves(assets);
}

function preflopHiddenVillainCurves(assets) {
  const cached = cachedPreflopHiddenVillainCurves(assets);
  if (cached) {
    return cached;
  }
  return priorHiddenVillainCurves(assets);
}

function priorHiddenVillainCurves(assets) {
  const page = villainPageKeys()[0];
  const prior = priorCurvesByPage(dashboardData)[page] || priorCurvesByPage(dashboardData).hero;
  const aggregates = baseVillainPortfolio().aggregates || [];
  return Object.fromEntries(
    [...assets, ...aggregates].map((asset) => [asset.code, prior[asset.code] || priorAggregateCurve(dashboardData)]),
  );
}

function cachedPreflopHiddenVillainCurves(assets) {
  if (!handState?.h1 || !handState?.h2) {
    return null;
  }
  const cachedClass = preflopHiddenVillainClasses[preflopClassKeyForCards(handState.h1, handState.h2)];
  if (!cachedClass) {
    return null;
  }
  return curvesFromPreflopHiddenVillainCache({
    assets,
    aggregates: baseVillainPortfolio().aggregates || [],
    cachedClass,
    bucketCount: dashboardData.bucketCount,
    priorXByGradation,
  });
}

function hiddenVillainCurves(assets) {
  const available = remainingDeckForKnownCards(knownCardsForHand());
  const futureBoardTokens = ["T", "R"].filter((token) => !boardCardForToken(token));
  const aggregates = baseVillainPortfolio().aggregates || [];
  return hiddenVillainCurvesKernel({
    assets,
    aggregates,
    available,
    knownBoardState: currentKnownBoardState(),
    futureBoardTokens,
    bucketCount: dashboardData.bucketCount,
    priorXByGradation,
    chooseTable: handEvaluator.chooseTable,
    evaluateGradation,
  });
}

function weightedCurvesForRangePage({ page, assets, aggregates, range, holeTokens, deadCards }) {
  const knownBoardState = currentKnownBoardState();
  if (!range || !rangeHasPositiveLegalCombo(range, knownBoardState)) {
    return null;
  }
  return weightedRangeAssetCurves({
    assets,
    aggregates,
    range,
    available: remainingDeckForKnownCards(deadCards),
    knownBoardState,
    futureBoardTokens: missingBoardTokens(),
    holeTokens,
    bucketCount: dashboardData.bucketCount,
    priorXByGradation,
    chooseTable: handEvaluator.chooseTable,
    evaluateGradation,
    nsims: DEFAULT_RANGE_CURVE_SIMS,
    seed: hashString(`${ASSET_VERSION}:range-curves:${page}:${tableConfig.playerCount}:${JSON.stringify(visiblePlayerActionsForCurrentStreet())}:${JSON.stringify(deadCards.map(cardId))}:${JSON.stringify(currentBoardCards().map(cardId))}`),
  });
}

function rangeHasPositiveLegalCombo(range, knownBoardState = {}) {
  const boardCards = Object.values(knownBoardState || {}).filter(Boolean);
  return Boolean(range?.combos?.some((combo) =>
    combo.weight > 0 &&
    combo.cards?.length === 2 &&
    combo.cards.every((card) => !boardCards.some((boardCard) => sameCard(card, boardCard))),
  ));
}

function inferredRangesForCurves(page) {
  if (!preflopActionDerivedRangesActive()) {
    return {};
  }
  const deadCards = page === "range" ? currentBoardCards() : knownCardsForHand();
  const visibleActions = visiblePlayerActionsForCurrentStreet();
  return inferPreflopRanges({
    tableConfig,
    actions: visibleActions,
    deadCards,
    knownBoard: currentBoardCards(),
    bucketCount: dashboardData.bucketCount,
    evaluateGradation,
    empiricalSpots: empiricalSpotsForCurrentActions(),
    playerProfiles: playerProfilesForInference(),
  });
}

function ensureEmpiricalSpotsForActions() {
  empiricalSpotStore.ensureForActions(visiblePlayerActionsForCurrentStreet());
}

function empiricalSpotsForCurrentActions() {
  return empiricalSpotStore.spotsForActions(visiblePlayerActionsForCurrentStreet());
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
  return empiricalSpotStore.evidenceForRange(range, visiblePlayerActionsForCurrentStreet());
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

function formatInteger(value) {
  return Number(value || 0).toLocaleString();
}

function invalidateRangeDerivedState() {
  currentCurves = handState ? {} : priorCurvesByPage(dashboardData);
  currentWinShares = handState ? {} : priorWinSharesByPage();
  actionMomentCache = new Map();
  resetWinShareState();
  curveComputationToken += 1;
}

function missingBoardTokens() {
  const state = currentKnownBoardState();
  return ["F_1", "F_2", "F_3", "T", "R"].filter((token) => !state[token]);
}

function aggregateTokensForPage(page) {
  return isOpponentPage(page)
    ? ["V_1", "V_2", "F_1", "F_2", "F_3", "T", "R"]
    : ["H_1", "H_2", "F_1", "F_2", "F_3", "T", "R"];
}

function currentKnownBoardState() {
  const state = {};
  if (handState.flop[0]) {
    state.F_1 = handState.flop[0];
  }
  if (handState.flop[1]) {
    state.F_2 = handState.flop[1];
  }
  if (handState.flop[2]) {
    state.F_3 = handState.flop[2];
  }
  if (handState.turn) {
    state.T = handState.turn;
  }
  if (handState.river) {
    state.R = handState.river;
  }
  return state;
}

function currentKnownHeroState() {
  if (!handState) {
    return {};
  }
  return {
    H_1: handState.h1,
    H_2: handState.h2,
    ...(handState.flop[0] ? { F_1: handState.flop[0] } : {}),
    ...(handState.flop[1] ? { F_2: handState.flop[1] } : {}),
    ...(handState.flop[2] ? { F_3: handState.flop[2] } : {}),
    ...(handState.turn ? { T: handState.turn } : {}),
    ...(handState.river ? { R: handState.river } : {}),
  };
}

function currentKnownVillainState() {
  return currentKnownVillainStateForPage(activePage);
}

function currentKnownVillainStateForPage(page) {
  if (!handState) {
    return {};
  }
  const [v1, v2] = showdownHoleCardsForPlayer(page);
  return {
    ...(villainShowdown && v1 && v2 ? { V_1: v1, V_2: v2 } : {}),
    ...(handState.flop[0] ? { F_1: handState.flop[0] } : {}),
    ...(handState.flop[1] ? { F_2: handState.flop[1] } : {}),
    ...(handState.flop[2] ? { F_3: handState.flop[2] } : {}),
    ...(handState.turn ? { T: handState.turn } : {}),
    ...(handState.river ? { R: handState.river } : {}),
  };
}

function evaluateGradation(cards) {
  return handEvaluator.evaluateGradation(cards);
}

function evaluateGradationFive(first, second, third, fourth, fifth) {
  return handEvaluator.evaluateGradationFive(first, second, third, fourth, fifth);
}

function renderLegend({ bands, firstActiveIndex, lastActiveIndex }) {
  const legend = document.getElementById("legend");
  legend.innerHTML = "";

  for (const [index, band] of bands.entries()) {
    if (index === firstActiveIndex) {
      legend.appendChild(legendBoundary());
    }

    const item = document.createElement("div");
    item.className = `legend-item ${band.active ? "is-active" : "is-inactive"}`;
    item.title = band.name;
    item.innerHTML = `<span class="legend-swatch" style="--swatch-color: ${band.color}"></span><span>${band.name}</span>`;
    legend.appendChild(item);

    if (index === lastActiveIndex) {
      legend.appendChild(legendBoundary());
    }
  }
}

function legendBoundary() {
  const separator = document.createElement("span");
  separator.className = "legend-ceiling-separator";
  separator.setAttribute("aria-hidden", "true");
  return separator;
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
  if (!handState) {
    return [];
  }
  return [...handState.flop, handState.turn, handState.river].filter(Boolean);
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
  return asset.name
    .split(" + ")
    .map((token) => cardForTokenOnPage(token, page))
    .filter(Boolean);
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
