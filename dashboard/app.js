import * as HandModel from "./hand_state.mjs";
import {
  POSITION_TOKENS,
  categoryDescriptions,
  categoryLabels,
  categoryOrder,
  largeChart,
  smallChart,
} from "./app_config.mjs";
import {
  aggregateIsActive,
  ceilingForOtherAssetsInPortfolio,
  concreteAssetCount,
  concreteAssetIsActive,
  isLockedCurve,
} from "./asset_status.mjs";
import {
  cardCompare,
  cardId,
  fullDeck,
  hasDuplicateCards,
  parsePhysicalCard,
  rankSymbol,
  rawCard,
  sameCard,
  suitSymbol,
} from "./cards.mjs";
import { readApiCache, writeApiCache } from "./cache_client.mjs";
import { preflopClassKeyForCards, winShareCacheKey as buildWinShareCacheKey } from "./cache_keys.mjs";
import { createHandEvaluator } from "./evaluation.mjs";
import {
  curveFromTrimmedCounts,
  curvesForKnownAssets as curvesForKnownAssetsKernel,
} from "./curve_distributions.mjs";
import {
  validateDashboardData,
  validatePreflopAggregateCache,
  validatePreflopHandEquityCache,
  validatePreflopHiddenVillainCache,
  validatePriorWinShares,
} from "./data_contracts.mjs";
import {
  NORMAL_EDGE,
  axisMaximum,
  axisMinimum,
  bandEndX,
  bandStartX,
  bucketEndX,
  ceilingX,
  chartDomain,
  clamp,
  normalCdf,
  normalPdf,
  normalQuantileClamped,
  normalizeX,
  x,
  y,
} from "./charts.mjs";
import {
  curveFromCounts as curveFromCountsPure,
} from "./portfolio_curves.mjs";
import {
  computePreflopHeroWinSharesKernel,
  computeRunoutWinShares,
} from "./win_shares.mjs";
import { winShareSignal } from "./win_signal.mjs";
import {
  cloneCacheObject,
  cloneHandModel,
  recordStreetSnapshot,
  streetIndexForRound,
  updateStreetSnapshot,
} from "./street_snapshots.mjs";
import {
  curvesFromPreflopHiddenA2CCache,
  hiddenA2CVillainCurves as hiddenA2CVillainCurvesKernel,
  preflopHiddenA2CCurves as preflopHiddenA2CCurvesKernel,
} from "./villain_range.mjs";
import { createComputationWorker } from "./computation_worker_client.mjs";
import {
  cardHtml,
  cardText,
  compactTokenHtml,
  compactTokenText,
  escapeHtml,
  formatCombos,
  formatPercent,
} from "./ui.mjs";

const ASSET_VERSION = window.ESSENCE_ASSET_VERSION || Date.now();

let dashboardData;
let bucketLookup;
let handEvaluator;
let priorXByGradation;
let aggregatePriorXByGradation;
let priorNaturalXMaps = {};
let categoryByGradation;
let preflopAggregateCache;
let preflopHiddenVillainCache;
let preflopHandEquityCache;
let handModel = HandModel.emptyHandModel();
let handState = HandModel.legacyHandState(handModel);
let handTimeline = [];
let viewedStreetIndex = -1;
let currentCurves = {};
let currentWinShares = {};
let focusedAsset = null;
let activePage = "hero";
let villainShowdown = HandModel.isShowdown(handModel);
let editingCardToken = null;
let cardEditError = "";
let curveComputationToken = 0;
let villainMirrorComputationScheduled = false;
let winShareComputationScheduled = false;
let computationWorker = null;
let chartMode = "bell";
let useDarkTheme = localStorage.getItem("essence-theme") === "dark";
let hideInactiveAssets = localStorage.getItem("essence-hide-inactive-assets") === "true";

Promise.all([
  fetch(`data/prior_portfolio.json?v=${ASSET_VERSION}`).then((response) => response.json()),
  fetch(`data/preflop_aggregate_cache.json?v=${ASSET_VERSION}`).then((response) => response.json()),
  fetch(`data/prior_win_shares.json?v=${ASSET_VERSION}`).then((response) => response.json()),
  fetch(`data/preflop_hidden_villain_cache.json?v=${ASSET_VERSION}`).then((response) => response.json()),
  fetch(`data/preflop_hand_equity_cache.json?v=${ASSET_VERSION}`).then((response) => response.json()),
])
  .then(([data, aggregateCache, priorWinShares, hiddenVillainCache, handEquityCache]) => {
    validateDashboardData(data);
    validatePreflopAggregateCache(aggregateCache, { bucketCount: data.bucketCount });
    validatePriorWinShares(priorWinShares);
    validatePreflopHiddenVillainCache(hiddenVillainCache, { bucketCount: data.bucketCount });
    validatePreflopHandEquityCache(handEquityCache);
    preflopAggregateCache = aggregateCache;
    preflopHiddenVillainCache = hiddenVillainCache;
    preflopHandEquityCache = handEquityCache;
    bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
    handEvaluator = createHandEvaluator(bucketLookup, data.bucketCount);
    computationWorker = createComputationWorker(ASSET_VERSION);
    priorXByGradation = new Map(data.curve.map((point) => [point.gradation, point.x]));
    aggregatePriorXByGradation = aggregatePriorXMap(data);
    data.priorWinShares = priorWinShares;
    renderDashboard(data);
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
  document.getElementById("new-hand-button").addEventListener("click", resetNewHand);
  document.getElementById("previous-street-button").addEventListener("click", () => navigateStreet(-1));
  document.getElementById("next-street-button").addEventListener("click", () => navigateStreet(1));
  document.getElementById("new-round-button").addEventListener("click", dealNewRound);
  document.getElementById("showdown-button").addEventListener("click", revealA2CVillain);
  document.getElementById("holding-display").addEventListener("click", handleCardEditClick);
  for (const button of document.querySelectorAll("[data-page]")) {
    button.addEventListener("click", () => switchPage(button.dataset.page));
  }
  for (const input of document.querySelectorAll('input[name="chart-mode"]')) {
    input.addEventListener("change", changeChartMode);
  }
  document.getElementById("theme-toggle").addEventListener("change", toggleThemeMode);

  applyThemeMode();
  renderHoldingDisplay();
  updateRoundButton();
  updateStreetNavButtons();
  updatePageTabs();
  updateLegend();
  renderFocusLayer();
  renderAssets();
}

function normalizedPortfolios(data) {
  const heroAssets = data.portfolios?.hero?.assets || data.assets;
  const heroAggregates = data.portfolios?.hero?.aggregates || defaultAggregates(heroAssets);
  const a2cAssets = data.portfolios?.a2cVillain?.assets || heroAssets.map((asset) => ({
    ...asset,
    name: asset.name.replaceAll("H_1", "V_1").replaceAll("H_2", "V_2"),
    positions: asset.positions?.map((position) =>
      position.replace("hole_1", "villain_1").replace("hole_2", "villain_2"),
    ),
  }));
  const villainAggregates = data.portfolios?.a2cVillain?.aggregates || defaultAggregates(a2cAssets);
  return {
    hero: { name: "Hero", assets: heroAssets, aggregates: heroAggregates },
    a2cVillain: { name: "Villain", assets: a2cAssets, aggregates: villainAggregates },
  };
}

function defaultAggregates(assets) {
  return [
    aggregateSpec("AGG", "Hand Aggregate", "AGGREGATE", assets),
    aggregateSpec("AGG_BOTH", "Both hole cards aggregate", "CARD_1_PLUS_CARD_2", assets.filter((asset) => asset.category === "CARD_1_PLUS_CARD_2")),
    aggregateSpec("AGG_H1", "First hole card aggregate", "CARD_1", assets.filter((asset) => asset.category === "CARD_1")),
    aggregateSpec("AGG_H2", "Second hole card aggregate", "CARD_2", assets.filter((asset) => asset.category === "CARD_2")),
    aggregateSpec("AGG_ZERO", "Only community cards aggregate", "ZERO", assets.filter((asset) => asset.category === "ZERO")),
  ];
}

function aggregateSpec(code, name, category, assets) {
  return {
    code,
    category,
    name,
    assetCodes: assets.map((asset) => asset.code),
    active: true,
    isAggregate: true,
  };
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
  localStorage.setItem("essence-theme", useDarkTheme ? "dark" : "light");
  applyThemeMode();
}

function applyThemeMode() {
  document.body.classList.toggle("theme-dark", useDarkTheme);
  document.getElementById("theme-toggle").checked = useDarkTheme;
}

function resetWinShareState() {
  currentWinShares = handState ? {} : priorWinSharesByPage();
  winShareComputationScheduled = false;
}

function priorWinSharesByPage() {
  const prior = dashboardData?.priorWinShares;
  if (!prior?.shares) {
    return {};
  }
  return {
    hero: { shares: { ...prior.shares }, aggregateShares: { ...(prior.aggregateMatchups || {}) }, totalCombos: prior.totalCombos },
    a2cVillain: { shares: { ...prior.shares }, totalCombos: prior.totalCombos },
    range: { shares: { ...prior.shares }, totalCombos: prior.totalCombos },
  };
}

function priorCurvesByPage(data) {
  return Object.fromEntries(
    Object.keys(data.portfolios).map((page) => {
      const curves = priorCurvesForAssets(data.portfolios[page].assets, data);
      for (const aggregate of data.portfolios[page].aggregates || []) {
        curves[aggregate.code] = priorCurveForModel(aggregate, data, priorAggregateCurve(data));
      }
      return [page, curves];
    }),
  );
}

function priorAggregateCurve(data = dashboardData) {
  const aggregate = data.priorAggregate;
  if (!aggregate?.counts) {
    return {
      curve: data.curve,
      totalCombos: data.totalCombos,
      bestGradation: 1,
      worstGradation: data.bucketCount,
    };
  }

  let cumulative = 0;
  const curve = [];
  for (let gradation = 1; gradation <= data.bucketCount; gradation += 1) {
    cumulative += aggregate.counts[gradation] || 0;
    curve.push({
      gradation,
      probability: cumulative / aggregate.totalCombos,
      x: priorXByGradation.get(gradation),
    });
  }
  return {
    curve,
    totalCombos: aggregate.totalCombos,
    bestGradation: aggregate.bestGradation,
    worstGradation: aggregate.worstGradation,
  };
}

function priorCurvesForAssets(assets, data = dashboardData) {
  const fallback = {
    curve: data.curve,
    totalCombos: data.totalCombos,
    bestGradation: 1,
    worstGradation: data.bucketCount,
  };
  return Object.fromEntries(assets.map((asset) => [asset.code, priorCurveForModel(asset, data, fallback)]));
}

function priorCurveForModel(model, data = dashboardData, fallback = null) {
  if (!model?.prior) {
    return fallback;
  }
  return curveFromTrimmedCounts(
    model.prior,
    model.prior.totalCombos,
    data.bucketCount,
    priorXByGradation,
  );
}

function priorNaturalXMapsByPage(curvesByPage) {
  return Object.fromEntries(
    Object.entries(curvesByPage).map(([page, curves]) => [
      page,
      Object.fromEntries(
        Object.entries(curves).map(([code, curveData]) => [code, naturalXMapFromCurve(curveData?.curve || [])]),
      ),
    ]),
  );
}

function naturalXMapFromCurve(curve) {
  return new Map(curve.map((point) => [point.gradation, point.probability]));
}

function currentPortfolio() {
  return dashboardData.portfolios[activePage] || dashboardData.portfolios.hero;
}

function currentAssets() {
  const aggregates = currentPortfolio().aggregates || [];
  if (activePage === "hero") {
    return [...withHeroVillainAggregate(aggregates), ...currentPortfolio().assets];
  }
  return [...aggregates, ...currentPortfolio().assets];
}

function currentConcreteAssetCount() {
  if (activePage === "config") {
    return concreteAssetCount(dashboardData.portfolios.hero);
  }
  return concreteAssetCount(currentPortfolio());
}

function withHeroVillainAggregate(aggregates) {
  const villainAggregate = dashboardData.portfolios.a2cVillain?.aggregates?.find((aggregate) => aggregate.code === "AGG");
  if (!villainAggregate) {
    return aggregates;
  }
  const handAggregate = aggregates.find((aggregate) => aggregate.code === "AGG");
  const otherAggregates = aggregates.filter((aggregate) => aggregate.code !== "AGG");
  const rangeAggregate = {
    ...villainAggregate,
    code: "RANGE_AGG",
    sourcePage: "range",
    sourceCode: "AGG",
    name: "Range Aggregate",
    category: "AGGREGATE",
    isAggregate: true,
    isRangeAggregate: true,
  };
  const mirroredVillainAggregate = {
    ...villainAggregate,
    code: "VILLAIN_AGG",
    sourcePage: "a2cVillain",
    sourceCode: "AGG",
    name: "Villain Aggregate",
    category: "AGGREGATE",
    isAggregate: true,
    isVillainMirror: true,
  };
  return [
    ...(handAggregate ? [handAggregate] : []),
    rangeAggregate,
    mirroredVillainAggregate,
    ...otherAggregates,
  ];
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
  }
  const showdownButton = document.getElementById("showdown-button");
  showdownButton.hidden = !(activePage === "a2cVillain" && handState?.round === "river" && !villainShowdown);
}

function renderAssets() {
  if (activePage === "config") {
    renderConfigPage();
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
  const container = document.getElementById("asset-grid");
  container.innerHTML = "";
  for (const category of categoryOrder) {
    const assets = currentAssets().filter((asset) => asset.category === category);
    const visibleAssets = hideInactiveAssets ? assets.filter((asset) => isAssetCurrentlyActive(asset)) : assets;
    if (!visibleAssets.length) {
      continue;
    }
    container.appendChild(assetSection(category, visibleAssets, assets));
  }
}

function ensureCurrentPageWinShares() {
  if (!handState || activePage === "config" || currentWinShares[activePage] || winShareComputationScheduled) {
    return;
  }
  if (activePage === "a2cVillain" && !villainShowdown) {
    return;
  }

  const token = curveComputationToken;
  const page = activePage;
  winShareComputationScheduled = true;
  setTimeout(async () => {
    winShareComputationScheduled = false;
    if (token !== curveComputationToken || currentWinShares[page]) {
      return;
    }
    currentWinShares[page] = await cachedOrComputedWinSharesForPage(page);
    updateCurrentStreetSnapshot();
    if (activePage === page) {
      renderAssets();
      if (focusedAsset && !focusedAsset.isAggregate) {
        openFocus(focusedAsset);
      }
    }
  }, 20);
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
  if (currentCurves.a2cVillain) {
    return;
  }
  if (!handState || currentBoardCards().length === 0 || villainShowdown) {
    currentCurves.a2cVillain = curvesForA2CVillain();
    updateCurrentStreetSnapshot();
    return;
  }
  scheduleHeroMirrorCurves("a2cVillain");
}

function scheduleHeroMirrorCurves(page) {
  if (villainMirrorComputationScheduled) {
    return;
  }
  const token = curveComputationToken;
  villainMirrorComputationScheduled = true;
  setTimeout(() => {
    villainMirrorComputationScheduled = false;
    if (token !== curveComputationToken || currentCurves[page]) {
      return;
    }
    currentCurves[page] = page === "range" ? curvesForRangeAggregate() : curvesForA2CVillain();
    updateCurrentStreetSnapshot();
    if (activePage === "hero") {
      updateLegend();
      renderAssets();
      if (focusedAsset?.sourcePage === page) {
        openFocus(focusedAsset);
      }
    }
  }, 20);
}

function renderConfigPage() {
  const container = document.getElementById("asset-grid");
  container.innerHTML = `
    <section class="config-panel">
      <div class="section-header">
        <div>
          <h2>Config</h2>
          <p>Display preferences</p>
        </div>
      </div>
      <label class="config-row">
        <span>
          <span class="config-title">Hide inactive assets</span>
          <span class="config-copy">Only active assets remain visible in each portfolio section.</span>
        </span>
        <span class="toggle-control config-toggle">
          <input id="hide-inactive-toggle" type="checkbox" ${hideInactiveAssets ? "checked" : ""}>
          <span class="toggle-track" aria-hidden="true"></span>
        </span>
      </label>
    </section>
  `;
  document.getElementById("hide-inactive-toggle").addEventListener("change", toggleHideInactiveAssets);
}

function toggleHideInactiveAssets(event) {
  hideInactiveAssets = event.target.checked;
  localStorage.setItem("essence-hide-inactive-assets", hideInactiveAssets ? "true" : "false");
}

function renderLoadingAssets() {
  const container = document.getElementById("asset-grid");
  container.innerHTML = `
    <section class="asset-loading" aria-live="polite">
      <span class="asset-loading-title">Calculating villain distributions</span>
      <span class="asset-loading-copy">The tab is active. Hidden-card curves are being rebuilt from hero's perspective.</span>
    </section>
  `;
}

function renderHoldingDisplay() {
  const status = document.getElementById("portfolio-status");
  const display = document.getElementById("holding-display");
  const assetCount = currentConcreteAssetCount();
  document.getElementById("asset-count").textContent = assetCount;
  if (activePage === "config") {
    status.textContent = "Display configuration";
    return;
  }
  if (!handState) {
    status.textContent = `${assetCount} five-card assets before any cards are dealt`;
    const draftHoleCards = HandModel.pendingHoleCards(handModel);
    display.innerHTML = `
      <span class="holding-label">Holding</span>
      ${editableCardHtml("H_1", draftHoleCards[0])}
      ${editableCardHtml("H_2", draftHoleCards[1])}
      ${cardEditError ? `<span class="card-edit-error">${escapeHtml(cardEditError)}</span>` : ""}
    `;
    return;
  }

  const statusByRound = {
    preflop: `${assetCount} five-card assets after hero's holding cards are known`,
    flop: `${assetCount} five-card assets after the flop is known`,
    turn: `${assetCount} five-card assets after the turn is known`,
    river: `${assetCount} five-card assets after the river is known`,
  };
  status.textContent = statusByRound[handState.round];

  const flopHtml = handState.flop.length
    ? `
      <span class="holding-label">Flop</span>
      ${handState.flop.map((card, index) => editableCardHtml(`F_${index + 1}`, card)).join("")}
    `
    : "";
  const turnHtml = handState.turn
    ? `
      <span class="holding-label">Turn</span>
      ${editableCardHtml("T", handState.turn)}
    `
    : "";
  const riverHtml = handState.river
    ? `
      <span class="holding-label">River</span>
      ${editableCardHtml("R", handState.river)}
    `
    : "";
  const villainHtml = activePage === "a2cVillain" && villainShowdown
    ? `
      <span class="holding-label">Villain</span>
      ${editableCardHtml("V_1", handState.v1)}
      ${editableCardHtml("V_2", handState.v2)}
    `
    : "";

  display.innerHTML = `
    <span class="holding-label">Holding</span>
    ${editableCardHtml("H_1", handState.h1)}
    ${editableCardHtml("H_2", handState.h2)}
    ${flopHtml}
    ${turnHtml}
    ${riverHtml}
    ${villainHtml}
    ${cardEditError ? `<span class="card-edit-error">${escapeHtml(cardEditError)}</span>` : ""}
  `;
}

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
  if (!handState && token !== "H_1" && token !== "H_2") {
    return;
  }
  editingCardToken = token;
  cardEditError = "";
  renderHoldingDisplay();
}

function handleCardEditorAction(action) {
  const editor = action.closest("[data-editor-token]");
  const token = editor?.dataset.editorToken;
  if (!token) {
    return;
  }
  if (action.dataset.cardEditAction === "cancel") {
    editingCardToken = null;
    cardEditError = "";
    renderHoldingDisplay();
    return;
  }
  const rank = Number(editor.querySelector("[data-card-editor-rank]")?.value);
  const suit = Number(editor.querySelector("[data-card-editor-suit]")?.value);
  const nextCard = { rank, suit, id: cardId({ rank, suit }) };
  if (!handState) {
    applyPendingHoleCardEdit(token, nextCard);
    return;
  }
  const result = applyCardEdit(token, nextCard);
  if (!result.ok) {
    cardEditError = result.message;
    renderHoldingDisplay();
    return;
  }
  editingCardToken = null;
  cardEditError = "";
  curveComputationToken += 1;
  currentCurves = {};
  resetWinShareState();
  rebuildTimelineForCurrentHand();
  finishRoundDeal();
}

function applyPendingHoleCardEdit(token, nextCard) {
  const index = token === "H_1" ? 0 : 1;
  const nextPending = [...HandModel.pendingHoleCards(handModel)];
  nextPending[index] = nextCard;
  if (hasDuplicateCards(nextPending.filter(Boolean))) {
    cardEditError = "That card is already in the other hole-card slot.";
    renderHoldingDisplay();
    return;
  }
  editingCardToken = null;
  cardEditError = "";
  if (nextPending.every(Boolean)) {
    startPreflopFromHoleCards(nextPending);
    return;
  }
  handModel = HandModel.setPendingHoleCard(handModel, token, nextCard);
  syncHandStateFromModel();
  renderHoldingDisplay();
}

function applyCardEdit(token, nextCard) {
  try {
    handModel = HandModel.editKnownCardModel(handModel, token, nextCard);
  } catch (error) {
    if (!HandModel.isShowdown(handModel) && error.message.includes("replacement villain cards")) {
      const currentCard = cardForTokenOnPage(token, activePage);
      const physicals = HandModel.physicalCardsFromModel(handModel);
      const editedVisibleCards = [
        ...physicals.hole,
        ...physicals.flop,
        physicals.turn,
        physicals.river,
      ]
        .filter(Boolean)
        .map((card) => (currentCard && sameCard(card, currentCard) ? nextCard : card));
      const replacementVillain = dealCardsFromDeck(remainingDeckForKnownCards(editedVisibleCards), 2).sort(cardCompare);
      handModel = HandModel.editKnownCardModel(handModel, token, nextCard, replacementVillain);
    } else {
      return { ok: false, message: error.message };
    }
  }
  syncHandStateFromModel();
  return { ok: true };
}

function rebuildTimelineForCurrentHand() {
  const previousIndex = viewedStreetIndex;
  handTimeline = HandModel.rebuildTimeline(handModel).map((model) => ({
    handModel: cloneHandModel(model),
    currentCurves: {},
    currentWinShares: {},
  }));
  viewedStreetIndex = Math.min(Math.max(previousIndex, 0), handTimeline.length - 1);
  handTimeline[viewedStreetIndex].handModel = cloneHandModel(handModel);
}

function resetNewHand() {
  handModel = HandModel.emptyHandModel();
  syncHandStateFromModel();
  handTimeline = [];
  viewedStreetIndex = -1;
  editingCardToken = null;
  cardEditError = "";
  curveComputationToken += 1;
  currentCurves = priorCurvesByPage(dashboardData);
  resetWinShareState();
  renderHoldingDisplay();
  updateRoundButton();
  updateStreetNavButtons();
  updatePageTabs();
  updateLegend();
  renderAssets();
  if (focusedAsset) {
    openFocus(focusedAsset);
  }
}

function dealNewRound() {
  if (viewedStreetIndex >= 0 && viewedStreetIndex < handTimeline.length - 1) {
    navigateToStreet(viewedStreetIndex + 1);
    return;
  }
  if (handState?.round === "river") {
    return;
  }

  const button = document.getElementById("new-round-button");
  button.disabled = true;
  button.textContent = "Dealing...";

  setTimeout(() => {
    if (!handState) {
      dealPreflopRound();
    } else if (handState.round === "preflop") {
      dealFlopRound();
    } else if (handState.round === "flop") {
      dealTurnRound();
    } else {
      dealRiverRound();
    }
  }, 20);
}

function dealPreflopRound() {
  const selectedHoleCards = HandModel.pendingHoleCards(handModel).filter(Boolean);
  const [h1, h2] = selectedHoleCards.length
    ? dealHoleCardsAroundPendingCards(selectedHoleCards)
    : dealHoleCards();
  startPreflopFromHoleCards([h1, h2]);
}

function dealHoleCardsAroundPendingCards(selectedHoleCards) {
  if (selectedHoleCards.length === 2) {
    return selectedHoleCards.sort(cardCompare);
  }
  const [drawnCard] = dealCardsFromDeck(remainingDeckForKnownCards(selectedHoleCards), 1);
  return [...selectedHoleCards, drawnCard].sort(cardCompare);
}

function startPreflopFromHoleCards(holeCards) {
  const [h1, h2] = [...holeCards].sort(cardCompare);
  const [v1, v2] = dealCardsFromDeck(remainingDeckForKnownCards([h1, h2]), 2).sort(cardCompare);
  handModel = HandModel.startPreflopModel([h1, h2], [v1, v2]);
  syncHandStateFromModel();
  recordCurrentStreet();
  curveComputationToken += 1;
  currentCurves = {};
  resetWinShareState();

  finishRoundDeal();
}

function dealTurnRound() {
  const [turn] = dealCardsFromDeck(remainingDeckForKnownCards(allDealtCardsForDeck()), 1);
  handModel = HandModel.dealTurnModel(handModel, turn);
  syncHandStateFromModel();
  recordCurrentStreet();
  curveComputationToken += 1;
  currentCurves = {};
  resetWinShareState();

  finishRoundDeal();
}

function dealRiverRound() {
  const [river] = dealCardsFromDeck(remainingDeckForKnownCards(allDealtCardsForDeck()), 1);
  handModel = HandModel.dealRiverModel(handModel, river);
  syncHandStateFromModel();
  recordCurrentStreet();
  curveComputationToken += 1;
  currentCurves = {};
  resetWinShareState();

  finishRoundDeal();
}

function dealFlopRound() {
  const knownCards = allDealtCardsForDeck();
  const remainingBeforeFlop = remainingDeckForKnownCards(knownCards);
  const flop = dealCardsFromDeck(remainingBeforeFlop, 3);
  handModel = HandModel.dealFlopModel(handModel, flop);
  syncHandStateFromModel();
  recordCurrentStreet();
  curveComputationToken += 1;
  currentCurves = {};
  resetWinShareState();

  finishRoundDeal();
}

function finishRoundDeal() {
  renderHoldingDisplay();
  updateRoundButton();
  updateStreetNavButtons();
  updatePageTabs();
  if (shouldDeferCurrentPageCurves()) {
    renderLoadingAssets();
    scheduleCurrentPageCurves();
    return;
  }
  ensureCurrentPageCurves();
  updateLegend();
  renderAssets();
  updateCurrentStreetSnapshot();
  if (focusedAsset) {
    openFocus(focusedAsset);
  }
}

function navigateStreet(direction) {
  navigateToStreet(viewedStreetIndex + direction);
}

function navigateToStreet(index) {
  if (index < 0 || index >= handTimeline.length || index === viewedStreetIndex) {
    return;
  }
  const snapshot = handTimeline[index];
  handModel = cloneHandModel(snapshot.handModel);
  syncHandStateFromModel();
  viewedStreetIndex = index;
  curveComputationToken += 1;
  villainMirrorComputationScheduled = false;
  winShareComputationScheduled = false;
  currentCurves = cloneCacheObject(snapshot.currentCurves || {});
  currentWinShares = cloneCacheObject(snapshot.currentWinShares || {});
  renderCachedStreet();
}

function recordCurrentStreet() {
  const snapshot = recordStreetSnapshot(handTimeline, handModel, handState.round);
  handTimeline = snapshot.handTimeline;
  viewedStreetIndex = snapshot.viewedStreetIndex;
}

function updateCurrentStreetSnapshot() {
  if (viewedStreetIndex < 0 || !handState) {
    return;
  }
  handTimeline = updateStreetSnapshot(handTimeline, viewedStreetIndex, handModel, currentCurves, currentWinShares);
}

function renderCachedStreet() {
  renderHoldingDisplay();
  updateRoundButton();
  updateStreetNavButtons();
  updatePageTabs();
  updateLegend();
  renderAssets();
  if (focusedAsset) {
    openFocus(focusedAsset);
  }
}

function syncHandStateFromModel() {
  handState = HandModel.legacyHandState(handModel);
  villainShowdown = HandModel.isShowdown(handModel);
}

function shouldDeferCurrentPageCurves() {
  return (
    activePage === "a2cVillain" &&
    handState &&
    !villainShowdown &&
    currentBoardCards().length > 0 &&
    !currentCurves.a2cVillain
  );
}

function scheduleCurrentPageCurves() {
  const token = curveComputationToken + 1;
  curveComputationToken = token;
  setTimeout(() => {
    if (token !== curveComputationToken) {
      return;
    }
    ensureCurrentPageCurves();
    if (token !== curveComputationToken) {
      return;
    }
    updateLegend();
    renderAssets();
    if (focusedAsset) {
      openFocus(focusedAsset);
    }
  }, 20);
}

function updateRoundButton() {
  const button = document.getElementById("new-round-button");
  button.disabled = handState?.round === "river" && viewedStreetIndex >= handTimeline.length - 1;
  if (!handState) {
    button.textContent = "Deal holding";
  } else if (handState.round === "preflop") {
    button.textContent = "Deal flop";
  } else if (handState.round === "flop") {
    button.textContent = "Deal turn";
  } else if (handState.round === "turn") {
    button.textContent = "Deal river";
  } else {
    button.textContent = "River dealt";
  }
}

function updateStreetNavButtons() {
  document.getElementById("previous-street-button").disabled = viewedStreetIndex <= 0;
  document.getElementById("next-street-button").disabled =
    viewedStreetIndex < 0 || viewedStreetIndex >= handTimeline.length - 1;
}

function revealA2CVillain() {
  if (!handState || handState.round !== "river" || villainShowdown) {
    return;
  }

  handModel = HandModel.revealVillainModel(handModel);
  syncHandStateFromModel();
  updateCurrentStreetSnapshot();
  currentCurves.a2cVillain = curvesForA2CVillain();
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

function dealHoleCards() {
  const firstIndex = Math.floor(Math.random() * fullDeck.length);
  let secondIndex = Math.floor(Math.random() * (fullDeck.length - 1));
  if (secondIndex >= firstIndex) {
    secondIndex += 1;
  }

  return [fullDeck[firstIndex], fullDeck[secondIndex]].sort(cardCompare);
}

function dealCardsFromDeck(deck, count) {
  const remaining = [...deck];
  const cards = [];
  for (let cardIndex = 0; cardIndex < count; cardIndex += 1) {
    const deckIndex = Math.floor(Math.random() * remaining.length);
    cards.push(remaining.splice(deckIndex, 1)[0]);
  }
  return cards;
}

function knownCardsForHand() {
  if (!handState) {
    return [];
  }
  return [handState.h1, handState.h2, ...handState.flop, handState.turn, handState.river].filter(Boolean);
}

function allDealtCardsForDeck() {
  if (!handState) {
    return [];
  }
  return [handState.h1, handState.h2, handState.v1, handState.v2, ...handState.flop, handState.turn, handState.river].filter(Boolean);
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
  if (activePage === "a2cVillain") {
    currentCurves.a2cVillain = curvesForA2CVillain();
    return;
  }
  currentCurves.hero = curvesForKnownAssets(dashboardData.portfolios.hero.assets, remainingDeckForKnownCards(knownCardsForHand()), "hero");
}

function curvesForKnownAssets(assets, remainingDeck, page) {
  const portfolio = dashboardData.portfolios[page];
  const aggregates = portfolio.aggregates || [];
  return curvesForKnownAssetsKernel({
    assets,
    aggregates,
    remainingDeck,
    knownCardsForAsset: (asset) => knownCardsForAsset(asset, page),
    knownState: handState ? (page === "a2cVillain" ? currentKnownVillainState() : currentKnownHeroState()) : null,
    aggregateTokens: aggregateTokensForPage(page),
    bucketCount: dashboardData.bucketCount,
    priorXByGradation,
    evaluateGradation,
    preflopAggregateCache: page === "hero" && handState?.round === "preflop" ? preflopAggregateCache : null,
    preflopClassKey: page === "hero" && handState?.round === "preflop"
      ? preflopClassKeyForCards(handState.h1, handState.h2)
      : null,
  });
}

function curvesForA2CVillain() {
  const assets = dashboardData.portfolios.a2cVillain.assets;
  if (!handState) {
    return priorCurvesByPage(dashboardData).a2cVillain;
  }
  if (villainShowdown) {
    return curvesForKnownAssets(assets, remainingDeckForKnownCards(allDealtCardsForDeck()), "a2cVillain");
  }
  if (currentBoardCards().length === 0) {
    return preflopHiddenA2CCurves(assets);
  }

  return hiddenA2CVillainCurves(assets);
}

function curvesForRangeAggregate() {
  const assets = dashboardData.portfolios.a2cVillain.assets;
  if (!handState) {
    return priorCurvesByPage(dashboardData).a2cVillain;
  }
  if (currentBoardCards().length === 0) {
    return preflopHiddenA2CCurves(assets);
  }
  return hiddenA2CVillainCurves(assets);
}

function preflopHiddenA2CCurves(assets) {
  const cached = cachedPreflopHiddenA2CCurves(assets);
  if (cached) {
    return cached;
  }
  const available = remainingDeckForKnownCards(knownCardsForHand());
  return preflopHiddenA2CCurvesKernel({
    assets,
    available,
    bucketCount: dashboardData.bucketCount,
    priorXByGradation,
    evaluateGradation,
  });
}

function cachedPreflopHiddenA2CCurves(assets) {
  if (!preflopHiddenVillainCache?.classes || !handState?.h1 || !handState?.h2) {
    return null;
  }
  const cachedClass = preflopHiddenVillainCache.classes[preflopClassKeyForCards(handState.h1, handState.h2)];
  if (!cachedClass) {
    return null;
  }
  return curvesFromPreflopHiddenA2CCache({
    assets,
    aggregates: dashboardData.portfolios.a2cVillain.aggregates || [],
    cachedClass,
    bucketCount: dashboardData.bucketCount,
    priorXByGradation,
  });
}

function hiddenA2CVillainCurves(assets) {
  const available = remainingDeckForKnownCards(knownCardsForHand());
  const futureBoardTokens = ["T", "R"].filter((token) => !boardCardForToken(token));
  const aggregates = dashboardData.portfolios.a2cVillain.aggregates || [];
  return hiddenA2CVillainCurvesKernel({
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

function aggregateTokensForPage(page) {
  return page === "a2cVillain"
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
  if (!handState) {
    return {};
  }
  return {
    ...(villainShowdown ? { V_1: handState.v1, V_2: handState.v2 } : {}),
    ...(handState.flop[0] ? { F_1: handState.flop[0] } : {}),
    ...(handState.flop[1] ? { F_2: handState.flop[1] } : {}),
    ...(handState.flop[2] ? { F_3: handState.flop[2] } : {}),
    ...(handState.turn ? { T: handState.turn } : {}),
    ...(handState.river ? { R: handState.river } : {}),
  };
}

function curveFromCounts(counts, totalCombos) {
  return curveFromCountsPure(counts, totalCombos, dashboardData.bucketCount, priorXByGradation);
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

function updateLegend() {
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
  if (document.getElementById("focus-layer")) {
    return;
  }

  const layer = document.createElement("div");
  layer.id = "focus-layer";
  layer.className = "focus-layer";
  layer.hidden = true;
  layer.innerHTML = `
    <div class="focus-backdrop" data-close-focus></div>
    <section class="focus-panel" role="dialog" aria-modal="true" aria-labelledby="focus-title">
      <button class="focus-close" type="button" data-close-focus aria-label="Close">x</button>
      <div class="focus-header">
        <div>
          <span class="focus-code"></span>
          <h2 id="focus-title"></h2>
          <p class="focus-subtitle"></p>
        </div>
        <span class="focus-state"></span>
      </div>
      <div class="focus-chart"></div>
    </section>
  `;
  layer.addEventListener("click", (event) => {
    if (event.target.matches("[data-close-focus]")) {
      closeFocus();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeFocus();
    }
  });
  document.body.appendChild(layer);
}

function assetSection(category, assets, allAssets = assets) {
  const section = document.createElement("section");
  section.className = "asset-section";
  const activeCount = allAssets.filter((asset) => isAssetCurrentlyActive(asset)).length;
  section.innerHTML = `
    <div class="section-header">
      <div>
        <h2>${categoryLabels[category]}</h2>
        <p>${categoryDescriptions[category]}</p>
      </div>
      <span class="section-count">${activeCount} active</span>
    </div>
    <div class="asset-grid-inner"></div>
  `;

  const grid = section.querySelector(".asset-grid-inner");
  for (const asset of sortedAssetsByActiveState(assets)) {
    grid.appendChild(assetCard(asset));
  }

  return section;
}

function sortedAssetsByActiveState(assets) {
  return [
    ...assets.filter((asset) => isAssetCurrentlyActive(asset)),
    ...assets.filter((asset) => !isAssetCurrentlyActive(asset)),
  ];
}

function assetCard(asset) {
  const card = document.createElement("button");
  const curveData = curveForAsset(asset);
  const ceilingGradation = ceilingForOtherAssets(asset);
  const isActive = isAssetCurrentlyActive(asset, curveData, ceilingGradation);
  const streetBadge = asset.isAggregate
    ? `<span class="asset-street asset-street-aggregate" title="Aggregate">A</span>`
    : `<span class="asset-street" title="${completionStreetTitle(asset)}">${completionStreetLabel(asset)}</span>`;
  const winBars = winBarsHtml(asset, isActive);
  card.type = "button";
  card.className = `asset-card ${asset.isAggregate ? "is-aggregate" : "is-primary"} ${isActive ? "is-active" : "is-inactive"}`;
  card.addEventListener("click", () => openFocus(asset));
  if (!curveData) {
    card.innerHTML = `
      <span class="asset-header">
        <span class="asset-code">${asset.code}</span>
        <span class="asset-name" title="${assetDisplayText(asset.name)}">${assetDisplayHtml(asset.name)}</span>
        ${winBars}
        <span class="asset-state">Pending</span>
      </span>
      <span class="asset-pending">Exact aggregate curve pending</span>
      <span class="spark-labels">
        <span>-</span>
        <span>same-world min</span>
        <span>-</span>
      </span>
    `;
    return card;
  }
  const locked = isLockedCurve(curveData);
  card.innerHTML = `
    <span class="asset-header">
      <span class="asset-code">${asset.code}</span>
      <span class="asset-name" title="${assetDisplayText(asset.name)}">${assetDisplayHtml(asset.name)}</span>
      ${winBars}
      ${streetBadge}
      <span class="asset-state">${isActive ? "Active" : "Inactive"}</span>
    </span>
    ${chartSvg({
      curve: curveData.curve,
      bands: dashboardData.subcategoryBands,
      bucketCount: dashboardData.bucketCount,
      bestGradation: curveData.bestGradation,
      worstGradation: curveData.worstGradation,
      ceilingGradation,
      config: smallChart,
      showGrid: false,
      label: assetChartLabel(asset),
      chartMode,
      naturalXByGradation: naturalXByGradationForAsset(asset),
    })}
    <span class="spark-labels">
      <span>${locked ? "Locked" : curveData.bestGradation}</span>
      <span>${formatCombos(curveData.totalCombos)}</span>
      <span>${curveData.worstGradation}</span>
    </span>
  `;
  return card;
}

function openFocus(asset) {
  focusedAsset = asset;
  const layer = document.getElementById("focus-layer");
  const curveData = curveForAsset(asset);
  const ceilingGradation = ceilingForOtherAssets(asset);
  const isActive = isAssetCurrentlyActive(asset, curveData, ceilingGradation);
  layer.hidden = false;
  document.body.classList.add("has-focus-layer");

  layer.querySelector(".focus-code").textContent = asset.code;
  layer.querySelector("#focus-title").innerHTML = assetDisplayHtml(asset.name);
  if (!curveData) {
    layer.querySelector(".focus-subtitle").textContent = "Exact same-world aggregate curve pending";
    layer.querySelector(".focus-state").textContent = "Pending";
    layer.querySelector(".focus-chart").innerHTML = `<div class="asset-pending asset-pending-large">This aggregate is visible, but its exact curve is not available for the current hidden state yet.</div>`;
    return;
  }
  const winShare = winShareForAsset(asset);
  const winShareText = winShareDetailText(asset, winShare);
  layer.querySelector(".focus-subtitle").innerHTML = asset.isAggregate
    ? `${categoryLabels[asset.category]} · ${curveData.totalCombos.toLocaleString()} seven-card completions · ${curveData.bestGradation} to ${curveData.worstGradation}${winShareText}`
    : `${categoryLabels[asset.category]} · ${completionStreetTitle(asset)} · ${curveData.totalCombos.toLocaleString()} combos · ${curveData.bestGradation} best to ${curveData.worstGradation} worst${winShareText}`;
  layer.querySelector(".focus-state").textContent = isActive ? "Active" : "Inactive";
  layer.querySelector(".focus-chart").innerHTML = isLockedCurve(curveData)
    ? lockedResultPanel(asset, curveData, ceilingGradation)
    : chartSvg({
      curve: curveData.curve,
      bands: dashboardData.subcategoryBands,
      categoryBands: dashboardData.categoryBands,
      bucketCount: dashboardData.bucketCount,
      bestGradation: curveData.bestGradation,
      worstGradation: curveData.worstGradation,
      ceilingGradation,
      config: largeChart,
      showGrid: true,
      label: `Expanded ${assetChartKind()} for ${assetDisplayText(asset.name)}`,
      chartMode,
      naturalXByGradation: naturalXByGradationForAsset(asset),
    });
}

function lockedResultPanel(asset, curveData, ceilingGradation) {
  const category = categoryForGradation(curveData.bestGradation);
  return `
    <div class="locked-panel" style="--locked-color: ${category.color}">
      <span class="locked-grade">${curveData.bestGradation}</span>
    </div>
  `;
}

function winBarsHtml(asset, isActive) {
  if (asset.isAggregate && !isCategoryAggregate(asset) && !isAggregateMatchup(asset)) {
    return "";
  }
  if (!isActive) {
    return "";
  }
  const share = cachedWinShareForAsset(asset);
  const signal = winShareSignal(share);
  const title = share == null
    ? "Win share calculating"
    : aggregateMatchupTitle(asset, share) || `Win share ${formatPercent(share)}`;
  const colorClass = asset.isAggregate ? "win-bars-aggregate" : "";
  const content = signal.isCertain
    ? '<span class="win-check" aria-hidden="true">&#10003;</span>'
    : Array.from({ length: 5 }, (_, index) => {
      const classes = [
        "win-bar",
        index < signal.level ? "is-lit" : "",
        index < signal.deepLevel ? "is-deep" : "",
      ].filter(Boolean).join(" ");
      return `<span class="${classes}"></span>`;
    }).join("");
  return `
    <span class="win-bars ${colorClass} ${share == null ? "is-pending" : ""}" title="${title}" aria-label="${title}">
      ${content}
    </span>
  `;
}

function winShareDetailText(asset, winShare) {
  if (winShare == null) {
    return "";
  }
  const matchupTitle = aggregateMatchupTitle(asset, winShare);
  if (matchupTitle) {
    return ` · ${matchupTitle}`;
  }
  return ` · Win ${formatPercent(winShare)}`;
}

function cachedWinShareForAsset(asset) {
  if (isAggregateMatchup(asset)) {
    return aggregateMatchupShare(asset);
  }
  if (asset.isAggregate) {
    return cachedWinShareForAggregate(asset);
  }
  const page = asset.sourcePage || activePage;
  if (handState && (page === "range" || (page === "a2cVillain" && !villainShowdown))) {
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
  if (handState && (page === "range" || (page === "a2cVillain" && !villainShowdown))) {
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
  if (isHandAggregateMatchup(asset) && handState?.h1 && handState?.h2) {
    const classKey = preflopClassKeyForCards(handState.h1, handState.h2);
    return preflopHandEquityCache?.classes?.[classKey] ?? priorAggregateMatchupShare(asset);
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
    return `Range equity vs villain range ${formatPercent(share)}`;
  }
  if (isHandAggregateMatchup(asset)) {
    const prefix = preflopHandEquityCache?.exact === false && handState?.h1 && handState?.h2 ? "Estimated equity" : "Equity";
    return `${prefix} vs villain ${formatPercent(share)}`;
  }
  return "";
}

async function cachedOrComputedWinSharesForPage(page) {
  const cacheKey = winShareCacheKey(page);
  const cached = await readApiCache(cacheKey);
  if (cached) {
    return cached;
  }

  const result = await computeWinSharesForPageAsync(page);
  writeApiCache(cacheKey, result);
  return result;
}

function winShareCacheKey(page) {
  const state = page === "a2cVillain" ? currentKnownVillainState() : currentKnownHeroState();
  return buildWinShareCacheKey({
    page,
    state,
    street: villainShowdown ? "showdown" : "hidden",
    isHeroPreflop: page === "hero" && handState?.round === "preflop",
    h1: handState?.h1,
    h2: handState?.h2,
  });
}

async function computeWinSharesForPageAsync(page) {
  const payload = winShareWorkerPayload(page);
  if (!computationWorker || !payload) {
    return computeWinSharesForPage(page);
  }
  return computationWorker.computeWinShares(payload, () => computeWinSharesForPage(page));
}

function winShareWorkerPayload(page) {
  if (!handState) {
    return null;
  }
  const isHeroPreflop = page === "hero" && handState.round === "preflop";
  const portfolio = isHeroPreflop ? dashboardData.portfolios.hero : portfolioForCurvePage(page);
  const knownState = page === "a2cVillain" ? currentKnownVillainState() : currentKnownHeroState();
  const remainingDeck = page === "a2cVillain"
    ? remainingDeckForKnownCards(allDealtCardsForDeck())
    : remainingDeckForKnownCards(knownCardsForHand());
  return {
    kind: isHeroPreflop ? "heroPreflop" : "runout",
    bucketKeys: dashboardData.bucketKeys,
    bucketCount: dashboardData.bucketCount,
    portfolio,
    knownState,
    remainingDeck,
    suitMapEntries: Array.from(handState.suitMap.entries()),
    handState: {
      ...handState,
      suitMapEntries: Array.from(handState.suitMap.entries()),
    },
  };
}

function computeWinSharesForPage(page) {
  if (page === "hero" && handState?.round === "preflop") {
    return computePreflopHeroWinShares();
  }

  const portfolio = portfolioForCurvePage(page);
  const knownState = page === "a2cVillain" ? currentKnownVillainState() : currentKnownHeroState();
  const remainingDeck = page === "a2cVillain"
    ? remainingDeckForKnownCards(allDealtCardsForDeck())
    : remainingDeckForKnownCards(knownCardsForHand());
  return computeRunoutWinShares({
    portfolio,
    knownState,
    remainingDeck,
    suitMap: handState?.suitMap || new Map(),
    evaluateGradation,
  });
}

function computePreflopHeroWinShares() {
  return computePreflopHeroWinSharesKernel({
    portfolio: dashboardData.portfolios.hero,
    handState,
    remainingDeck: remainingDeckForKnownCards(knownCardsForHand()),
    evaluateGradationFive,
  });
}

function naturalXByGradationForAsset(asset) {
  const curvePage = asset.sourcePage || activePage;
  const curveCode = asset.sourceCode || asset.code;
  return priorNaturalXMaps[curvePage]?.[curveCode]
    || (asset.isAggregate ? aggregatePriorXByGradation : priorXByGradation);
}

function assetChartLabel(asset) {
  return `${assetChartKind()} for ${assetDisplayText(asset.name)}`;
}

function assetChartKind() {
  return chartMode === "bell" ? "bell density distribution" : "cumulative distribution";
}

function completionStreetLabel(asset) {
  if (asset.name.includes("R")) {
    return "R";
  }
  if (asset.name.includes("T")) {
    return "T";
  }
  return "F";
}

function completionStreetTitle(asset) {
  const titles = {
    F: "Full on flop",
    T: "Full on turn",
    R: "Full on river",
  };
  return titles[completionStreetLabel(asset)];
}

function closeFocus() {
  const layer = document.getElementById("focus-layer");
  if (!layer) {
    return;
  }
  focusedAsset = null;
  layer.hidden = true;
  document.body.classList.remove("has-focus-layer");
}

function curveForAsset(asset) {
  const curvePage = asset.sourcePage || activePage;
  const curveCode = asset.sourceCode || asset.code;
  const curve = currentCurves[curvePage]?.[curveCode];
  if (curve || asset.isAggregate) {
    return curve || null;
  }
  return { curve: dashboardData.curve, totalCombos: dashboardData.totalCombos };
}

function isAssetCurrentlyActive(asset, curveData = curveForAsset(asset), ceilingGradation = ceilingForOtherAssets(asset)) {
  if (asset.isAggregate) {
    return isAggregateCurrentlyActive(asset);
  }
  return isConcreteAssetCurrentlyActive(asset, curveData, ceilingGradation);
}

function isAggregateCurrentlyActive(asset) {
  if (!handState) {
    return true;
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
    return dashboardData.portfolios.a2cVillain;
  }
  return dashboardData.portfolios[page] || currentPortfolio();
}

function chartSvg({
  curve,
  bands,
  categoryBands = [],
  bucketCount,
  bestGradation,
  worstGradation,
  ceilingGradation,
  config,
  showGrid,
  label,
  chartMode,
  naturalXByGradation,
}) {
  if (bestGradation === worstGradation) {
    return lockedResultSvg({
      gradation: bestGradation,
      ceilingGradation,
      bucketCount,
      config,
      showGrid,
      label,
    });
  }

  const { width, height, padding } = config;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const domain = chartDomain(bestGradation, worstGradation, curve, chartMode, naturalXByGradation);
  const visibleCurve = curve.filter((point) => point.gradation >= bestGradation && point.gradation <= worstGradation);
  const ceiling = ceilingOverlay(ceilingGradation, bucketCount, curve, domain, plotWidth, plotHeight, padding, chartMode, naturalXByGradation);
  const curvePoints = chartPoints(visibleCurve, curve, domain, config, plotWidth, plotHeight, padding, chartMode, naturalXByGradation);
  const areaPoints = [
    `${padding.left},${height - padding.bottom}`,
    curvePoints,
    `${width - padding.right},${height - padding.bottom}`,
  ].join(" ");
  const bandRects = bands.map((band) => bandRect(band, curve, domain, plotWidth, plotHeight, padding, chartMode, naturalXByGradation)).join("");
  const grid = showGrid ? gridLines(width, height, padding, plotHeight) : "";
  const categoryTicks = showGrid ? categoryMarkers(categoryBands, curve, domain, plotWidth, padding, height, chartMode, naturalXByGradation) : "";

  return `
    <svg class="${showGrid ? "focus-svg" : "sparkline"}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
      ${bandRects}
      ${grid}
      <line class="axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />
      <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" />
      <polygon class="area" points="${areaPoints}" />
      <polyline class="curve" points="${curvePoints}" />
      ${categoryTicks}
      ${ceiling}
    </svg>
  `;
}

function lockedResultSvg({ gradation, ceilingGradation, bucketCount, config, showGrid, label }) {
  const { width, height, padding } = config;
  const plotHeight = height - padding.top - padding.bottom;
  const category = categoryForGradation(gradation);

  return `
    <svg class="${showGrid ? "focus-svg locked-svg" : "sparkline locked-svg"}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
      <rect class="locked-svg-bg" style="--locked-color: ${category.color}" x="${padding.left}" y="${padding.top}" width="${width - padding.left - padding.right}" height="${plotHeight}" rx="6" />
      <text class="locked-svg-grade" x="${width / 2}" y="${padding.top + plotHeight / 2}" dominant-baseline="middle" text-anchor="middle">${gradation}</text>
    </svg>
  `;
}

function chartPoints(visibleCurve, curve, domain, config, plotWidth, plotHeight, padding, chartMode, naturalXByGradation) {
  if (chartMode === "bell") {
    const densityPoints = bellDensityPoints(domain, config);
    const maxDensity = Math.max(...densityPoints.map((point) => point.density), Number.EPSILON);
    return densityPoints
      .map((point) => `${x(normalizeX(point.value, domain), plotWidth, padding)},${y(point.density / maxDensity, plotHeight, padding)}`)
      .join(" ");
  }
  const cumulativePoints = visibleCurve
    .map((point) => `${x(normalizeX(pointX(point, chartMode, naturalXByGradation), domain), plotWidth, padding)},${y(point.probability, plotHeight, padding)}`)
    .join(" ");
  return `${padding.left},${padding.top + plotHeight} ${cumulativePoints}`;
}

function bellDensityPoints(domain, config) {
  const pointCount = config === largeChart ? 220 : 96;
  return Array.from({ length: pointCount }, (_, index) => {
    const ratio = pointCount === 1 ? 0 : index / (pointCount - 1);
    const value = domain.start + ratio * (domain.end - domain.start);
    return { value, density: normalPdf(value) };
  });
}

function ceilingOverlay(ceilingGradation, bucketCount, curve, domain, plotWidth, plotHeight, padding, chartMode, naturalXByGradation) {
  if (!handState || ceilingGradation == null || ceilingGradation >= bucketCount) {
    return "";
  }

  const ceilingProbability = ceilingX(ceilingGradation, curve, chartMode, naturalXByGradation);
  if (ceilingProbability == null) {
    return "";
  }

  const visibleCeilingProbability = clamp(ceilingProbability, domain.start, domain.end);
  const ceilingPosition = x(normalizeX(visibleCeilingProbability, domain), plotWidth, padding);
  const tailWidth = Math.max(0, padding.left + plotWidth - ceilingPosition);
  const labelPadding = 5;
  const labelAnchor = ceilingPosition > padding.left + plotWidth - 42 ? "end" : "start";
  const labelX = labelAnchor === "end" ? ceilingPosition - labelPadding : ceilingPosition + labelPadding;
  const labelY = padding.top + 11;
  const tail = tailWidth > 0 ? `
    <rect class="ceiling-tail" x="${ceilingPosition}" y="${padding.top}" width="${tailWidth}" height="${plotHeight}">
      <title>Worse than the current ceiling from the other assets: gradation ${ceilingGradation}</title>
    </rect>
  ` : "";
  return `
    ${tail}
    <line class="ceiling-line" x1="${ceilingPosition}" y1="${padding.top}" x2="${ceilingPosition}" y2="${padding.top + plotHeight}">
      <title>Current ceiling from the other assets: gradation ${ceilingGradation}</title>
    </line>
    <text class="ceiling-label" x="${labelX}" y="${labelY}" text-anchor="${labelAnchor}">
      ${ceilingGradation}
    </text>
  `;
}

function bandRect(band, curve, domain, plotWidth, plotHeight, padding, chartMode, naturalXByGradation) {
  const bandStart = bandStartX(band, curve, chartMode, naturalXByGradation);
  const bandEnd = bandEndX(band, curve, chartMode, naturalXByGradation);
  const clippedStart = Math.max(bandStart, domain.start);
  const clippedEnd = Math.min(bandEnd, domain.end);
  if (clippedEnd <= clippedStart) {
    return "";
  }

  const start = x(normalizeX(clippedStart, domain), plotWidth, padding);
  const end = x(normalizeX(clippedEnd, domain), plotWidth, padding);
  return `<rect class="band" style="--band-color: ${band.color}; --band-opacity: ${band.shade}" x="${start}" y="${padding.top}" width="${end - start}" height="${plotHeight}"><title>${band.name}</title></rect>`;
}

function gridLines(width, height, padding, plotHeight) {
  const lines = [];
  for (let tick = 0; tick <= 10; tick += 1) {
    const probability = tick / 10;
    const yPos = y(probability, plotHeight, padding);
    lines.push(`
      <line class="grid-line" x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" />
      <text class="grid-label" x="${padding.left - 10}" y="${yPos + 4}" text-anchor="end">${tick * 10}%</text>
    `);
  }
  return lines.join("");
}

function categoryMarkers(categoryBands, curve, domain, plotWidth, padding, height, chartMode, naturalXByGradation) {
  return categoryBands
    .map((band) => {
      const rawStart = bandStartX(band, curve, chartMode, naturalXByGradation);
      if (rawStart <= domain.start || rawStart >= domain.end) {
        return "";
      }

      const start = x(normalizeX(rawStart, domain), plotWidth, padding);
      return `
        <line class="category-marker" x1="${start}" y1="${padding.top}" x2="${start}" y2="${height - padding.bottom}" />
        <title>${band.name}</title>
      `;
    })
    .join("");
}

function pointX(point, chartMode, naturalXByGradation) {
  if (chartMode === "cdf-straight") {
    return point.probability;
  }
  return naturalXByGradation.get(point.gradation) ?? point.x;
}

function assetDisplayHtml(name) {
  return name
    .split(" + ")
    .map((token) => {
      const card = cardForToken(token);
      if (card) {
        return cardHtml(card);
      }
      return compactTokenHtml(token);
    })
    .join("");
}

function assetDisplayText(name) {
  return name
    .split(" + ")
    .map((token) => {
      const card = cardForToken(token);
      if (card) {
        return cardText(card);
      }
      return token;
    })
    .join("");
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
  if (!handState) {
    return null;
  }
  const position = POSITION_TOKENS[token];
  if (!position) {
    return null;
  }

  if (position === "f1") {
    return handState.flop[0] || null;
  }
  if (position === "f2") {
    return handState.flop[1] || null;
  }
  if (position === "f3") {
    return handState.flop[2] || null;
  }
  if (position === "turn") {
    return handState.turn || null;
  }
  if (position === "river") {
    return handState.river || null;
  }
  if ((position === "v1" || position === "v2") && (page !== "a2cVillain" || !villainShowdown)) {
    return null;
  }
  return handState[position] || null;
}

function boardCardForToken(token) {
  return cardForTokenOnPage(token, "board");
}

function isBoardToken(token) {
  return token === "F_1" || token === "F_2" || token === "F_3" || token === "T" || token === "R";
}

function editableCardHtml(token, card) {
  if (editingCardToken === token) {
    return `
      <span class="card-editor" data-editor-token="${token}" aria-label="Edit ${compactTokenText(token)}">
        <select class="card-editor-select" data-card-editor-rank aria-label="${compactTokenText(token)} rank">
          ${Array.from({ length: 13 }, (_, index) => {
            const rank = index + 1;
            return `<option value="${rank}"${card && rank === card.rank ? " selected" : ""}>${rankSymbol(rank)}</option>`;
          }).join("")}
        </select>
        <select class="card-editor-select" data-card-editor-suit aria-label="${compactTokenText(token)} suit">
          ${[
            [1, suitSymbol(1)],
            [2, suitSymbol(2)],
            [3, suitSymbol(3)],
            [4, suitSymbol(4)],
          ].map(([suit, label]) => `<option value="${suit}"${card && suit === card.suit ? " selected" : ""}>${label}</option>`).join("")}
        </select>
        <button class="card-editor-action" type="button" data-card-edit-action="save" title="Save ${compactTokenText(token)}">OK</button>
        <button class="card-editor-action" type="button" data-card-edit-action="cancel" title="Cancel edit">X</button>
      </span>
    `;
  }
  return `
    <button class="holding-card editable-card" type="button" data-card-token="${token}" title="Edit ${compactTokenText(token)}">
      ${card ? cardHtml(card) : compactTokenHtml(token)}
    </button>
  `;
}
