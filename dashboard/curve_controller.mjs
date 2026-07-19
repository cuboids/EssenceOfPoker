import { cardId, sameCard } from "./cards.mjs";
import { preflopClassKeyForCards } from "./cache_keys.mjs";
import { curveFromTrimmedCounts, curvesForKnownAssets as curvesForKnownAssetsKernel } from "./curve_distributions.mjs";
import { inferPreflopRanges } from "./range_update.mjs";
import { hashString } from "./session_rng.mjs";
import {
  DEFAULT_RANGE_CURVE_SIMS,
  curvesFromPreflopHiddenVillainCache,
  hiddenVillainCurves as hiddenVillainCurvesKernel,
  weightedRangeAssetCurves,
} from "./villain_range.mjs";

export function createCurveController(deps) {
  const cardState = deps.cardState || deps;
  function ensureHeroMirrorCurves() {
    if (deps.activePage() !== "hero") {
      return;
    }
    ensureHeroRangeCurves();
    ensureHeroVillainAggregateCurves();
  }

  function ensureHeroRangeCurves() {
    const currentCurves = deps.currentCurves();
    if (currentCurves.range) {
      return;
    }
    if (!deps.handState() || cardState.currentBoardCards().length === 0) {
      currentCurves.range = curvesForRangeAggregate();
      deps.updateCurrentStreetSnapshot();
      return;
    }
    scheduleHeroMirrorCurves("range");
  }

  function ensureHeroVillainAggregateCurves() {
    const currentCurves = deps.currentCurves();
    const pages = deps.villainPageKeys().filter((page) => !currentCurves[page]);
    if (!pages.length) {
      return;
    }
    if (!deps.handState() || cardState.currentBoardCards().length === 0 || deps.villainShowdown()) {
      for (const page of pages) {
        currentCurves[page] = curvesForVillain(page);
      }
      deps.updateCurrentStreetSnapshot();
      return;
    }
    scheduleHeroMirrorCurves(pages);
  }

  function scheduleHeroMirrorCurves(pageOrPages) {
    const pages = Array.isArray(pageOrPages) ? pageOrPages : [pageOrPages];
    const guards = new Map(pages.map((page) => [page, deps.createCurrentAsyncGuard({ purpose: "hero-mirror-curves", page })]));
    let scheduled = false;
    for (const page of pages) {
      const guard = guards.get(page);
      const jobKey = heroMirrorCurveJobKey(page, guard);
      if (deps.asyncJobs.isScheduled(jobKey)) {
        continue;
      }
      scheduled = deps.asyncJobs.schedule({
        key: jobKey,
        delayMs: 20,
        guard,
        run: () => {
          if (!guard.isCurrent()) {
            return;
          }
          const currentCurves = deps.currentCurves();
          if (!currentCurves[page]) {
            currentCurves[page] = page === "range" ? curvesForRangeAggregate() : curvesForVillain(page);
          }
          deps.updateCurrentStreetSnapshot();
          if (deps.activePage() === "hero") {
            deps.updateLegend();
            deps.renderAssets();
            const focusedAsset = deps.focusedAsset();
            if (focusedAsset?.sourcePage === page) {
              deps.openFocus(focusedAsset);
            }
          }
        },
      }) || scheduled;
    }
    return scheduled;
  }

  function heroMirrorCurveJobKey(page, guard) {
    return `curves:hero-mirror:${page}:${hashString(guard.key)}`;
  }

  function currentPageCurveJobKey(page, guard) {
    return `curves:page:${page}:${hashString(guard.key)}`;
  }

  function shouldDeferCurrentPageCurves() {
    const activePage = deps.activePage();
    return (
      deps.isOpponentPage(activePage) &&
      deps.handState() &&
      !deps.villainShowdown() &&
      cardState.currentBoardCards().length > 0 &&
      !deps.preflopActionDerivedRangesActive() &&
      !deps.currentCurves()[activePage]
    );
  }

  function shouldRenderWithoutCurrentPageCurves() {
    return deps.activePage() !== "config" && deps.handState() && !deps.currentCurves()[deps.activePage()];
  }

  function scheduleCurrentPageCurves({ delayMs = 20 } = {}) {
    deps.bumpCurveComputationToken();
    const page = deps.activePage();
    const guard = deps.createCurrentAsyncGuard({ purpose: "current-page-curves", page });
    const jobKey = currentPageCurveJobKey(page, guard);
    deps.asyncJobs.schedule({
      key: jobKey,
      delayMs,
      guard,
      replace: true,
      run: () => {
        ensureCurrentPageCurves();
        if (!guard.isCurrent()) {
          return;
        }
        deps.updateLegend();
        deps.renderAssets();
        deps.saveCurrentMomentCache();
        if (deps.focusedAsset()) {
          deps.openFocus(deps.focusedAsset());
        }
      },
    });
  }

  function ensureCurrentPageCurves() {
    const activePage = deps.activePage();
    const currentCurves = deps.currentCurves();
    if (currentCurves[activePage]) {
      return;
    }
    if (!deps.handState()) {
      currentCurves[activePage] = deps.priorCurvesByPage(deps.dashboardData())[activePage];
      return;
    }
    if (deps.isOpponentPage(activePage)) {
      currentCurves[activePage] = curvesForVillain(activePage);
      return;
    }
    if (deps.handState().round === "preflop") {
      currentCurves.hero = curvesForHeroPreflop();
      return;
    }
    currentCurves.hero = curvesForKnownAssets(
      deps.dashboardData().portfolios.hero.assets,
      cardState.remainingDeckForKnownCards(cardState.knownCardsForHand()),
      "hero",
    );
  }

  function curvesForHeroPreflop() {
    const handState = deps.handState();
    const dashboardData = deps.dashboardData();
    const classKey = preflopClassKeyForCards(handState.h1, handState.h2);
    const portfolio = dashboardData.portfolios.hero;
    const curves = { ...deps.priorCurvesByPage(dashboardData).hero };
    const primaryClass = deps.preflopPrimaryClasses()[classKey];
    if (primaryClass) {
      for (const asset of portfolio.assets) {
        if (primaryClass[asset.code]) {
          curves[asset.code] = curveFromTrimmedCounts(
            primaryClass[asset.code],
            primaryClass[asset.code].totalCombos,
            dashboardData.bucketCount,
            deps.priorXByGradation(),
          );
        }
      }
    }

    const aggregatePayload = deps.preflopAggregateClasses()[classKey];
    const aggregateClass = aggregatePayload?.classes?.[classKey];
    if (aggregateClass) {
      for (const aggregate of portfolio.aggregates || []) {
        if (aggregateClass[aggregate.code]) {
          curves[aggregate.code] = curveFromTrimmedCounts(
            aggregateClass[aggregate.code],
            aggregatePayload.totalCombos,
            dashboardData.bucketCount,
            deps.priorXByGradation(),
          );
        } else if (aggregate.code === "AGG_ZERO" && curves["1.1"]) {
          curves[aggregate.code] = curves["1.1"];
        }
      }
    }
    return curves;
  }

  function curvesForKnownAssets(assets, remainingDeck, page) {
    const dashboardData = deps.dashboardData();
    const portfolio = dashboardData.portfolios[page];
    const handState = deps.handState();
    const aggregates = portfolio.aggregates || [];
    return curvesForKnownAssetsKernel({
      assets,
      aggregates,
      remainingDeck,
      knownCardsForAsset: (asset) => cardState.knownCardsForAsset(asset, page),
      knownState: handState ? (deps.isOpponentPage(page) ? cardState.currentKnownVillainStateForPage(page) : cardState.currentKnownHeroState()) : null,
      aggregateTokens: cardState.aggregateTokensForPage(page),
      bucketCount: dashboardData.bucketCount,
      priorXByGradation: deps.priorXByGradation(),
      evaluateGradation: deps.evaluateGradation,
      preflopPrimaryCache: page === "hero" && handState?.round === "preflop"
        ? deps.preflopPrimaryClasses()[preflopClassKeyForCards(handState.h1, handState.h2)]
        : null,
      preflopAggregateCache: page === "hero" && handState?.round === "preflop"
        ? deps.preflopAggregateClasses()[preflopClassKeyForCards(handState.h1, handState.h2)]
        : null,
      preflopClassKey: page === "hero" && handState?.round === "preflop"
        ? preflopClassKeyForCards(handState.h1, handState.h2)
        : null,
    });
  }

  function curvesForVillain(page = deps.activePage()) {
    const dashboardData = deps.dashboardData();
    const assets = dashboardData.portfolios[page]?.assets || deps.baseVillainPortfolio().assets;
    const aggregates = dashboardData.portfolios[page]?.aggregates || deps.baseVillainPortfolio().aggregates || [];
    if (!deps.handState()) {
      return deps.priorCurvesByPage(dashboardData)[page];
    }
    if (deps.villainShowdown()) {
      return curvesForKnownAssets(assets, cardState.remainingDeckForKnownCards(cardState.allDealtCardsForDeck(page)), page);
    }
    if (deps.preflopActionDerivedRangesActive()) {
      const weighted = weightedCurvesForRangePage({
        page,
        assets,
        aggregates,
        range: inferredRangesForCurves(page)?.[page],
        holeTokens: ["V_1", "V_2"],
        deadCards: cardState.knownCardsForHand(),
      });
      if (weighted) {
        return weighted;
      }
    }
    if (cardState.currentBoardCards().length === 0) {
      return preflopHiddenVillainCurves(assets);
    }
    return hiddenVillainCurves(assets);
  }

  function curvesForRangeAggregate() {
    const dashboardData = deps.dashboardData();
    if (!deps.handState()) {
      return deps.priorCurvesByPage(dashboardData).hero;
    }
    if (deps.preflopActionDerivedRangesActive()) {
      const portfolio = dashboardData.portfolios.hero;
      const weighted = weightedCurvesForRangePage({
        page: "range",
        assets: portfolio.assets,
        aggregates: portfolio.aggregates || [],
        range: inferredRangesForCurves("range")?.hero,
        holeTokens: ["H_1", "H_2"],
        deadCards: cardState.currentBoardCards(),
      });
      if (weighted) {
        return weighted;
      }
    }
    const page = deps.villainPageKeys()[0];
    const assets = dashboardData.portfolios[page]?.assets || deps.baseVillainPortfolio().assets;
    if (cardState.currentBoardCards().length === 0) {
      return preflopHiddenVillainCurves(assets);
    }
    return hiddenVillainCurves(assets);
  }

  function preflopHiddenVillainCurves(assets) {
    const cached = cachedPreflopHiddenVillainCurves(assets);
    return cached || priorHiddenVillainCurves(assets);
  }

  function priorHiddenVillainCurves(assets) {
    const dashboardData = deps.dashboardData();
    const page = deps.villainPageKeys()[0];
    const prior = deps.priorCurvesByPage(dashboardData)[page] || deps.priorCurvesByPage(dashboardData).hero;
    const aggregates = deps.baseVillainPortfolio().aggregates || [];
    return Object.fromEntries(
      [...assets, ...aggregates].map((asset) => [asset.code, prior[asset.code] || deps.priorAggregateCurve(dashboardData)]),
    );
  }

  function cachedPreflopHiddenVillainCurves(assets) {
    const handState = deps.handState();
    if (!handState?.h1 || !handState?.h2) {
      return null;
    }
    const cachedClass = deps.preflopHiddenVillainClasses()[preflopClassKeyForCards(handState.h1, handState.h2)];
    if (!cachedClass) {
      return null;
    }
    return curvesFromPreflopHiddenVillainCache({
      assets,
      aggregates: deps.baseVillainPortfolio().aggregates || [],
      cachedClass,
      bucketCount: deps.dashboardData().bucketCount,
      priorXByGradation: deps.priorXByGradation(),
    });
  }

  function hiddenVillainCurves(assets) {
    const dashboardData = deps.dashboardData();
    const available = cardState.remainingDeckForKnownCards(cardState.knownCardsForHand());
    const futureBoardTokens = ["T", "R"].filter((token) => !deps.boardCardForToken(token));
    const aggregates = deps.baseVillainPortfolio().aggregates || [];
    return hiddenVillainCurvesKernel({
      assets,
      aggregates,
      available,
      knownBoardState: cardState.currentKnownBoardState(),
      futureBoardTokens,
      bucketCount: dashboardData.bucketCount,
      priorXByGradation: deps.priorXByGradation(),
      chooseTable: deps.handEvaluator().chooseTable,
      evaluateGradation: deps.evaluateGradation,
    });
  }

  function weightedCurvesForRangePage({ page, assets, aggregates, range, holeTokens, deadCards }) {
    const knownBoardState = cardState.currentKnownBoardState();
    if (!range || !rangeHasPositiveLegalCombo(range, knownBoardState)) {
      return null;
    }
    return weightedRangeAssetCurves({
      assets,
      aggregates,
      range,
      available: cardState.remainingDeckForKnownCards(deadCards),
      knownBoardState,
      futureBoardTokens: cardState.missingBoardTokens(),
      holeTokens,
      bucketCount: deps.dashboardData().bucketCount,
      priorXByGradation: deps.priorXByGradation(),
      chooseTable: deps.handEvaluator().chooseTable,
      evaluateGradation: deps.evaluateGradation,
      nsims: DEFAULT_RANGE_CURVE_SIMS,
      seed: hashString(`${deps.assetVersion()}:range-curves:${page}:${deps.tableConfig().playerCount}:${JSON.stringify(deps.visiblePlayerActionsForCurrentStreet())}:${JSON.stringify(deadCards.map(cardId))}:${JSON.stringify(cardState.currentBoardCards().map(cardId))}`),
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
    if (!deps.preflopActionDerivedRangesActive()) {
      return {};
    }
    const deadCards = page === "range" ? cardState.currentBoardCards() : cardState.knownCardsForHand();
    const visibleActions = deps.visiblePlayerActionsForCurrentStreet();
    return inferPreflopRanges({
      tableConfig: deps.tableConfig(),
      actions: visibleActions,
      deadCards,
      knownBoard: cardState.currentBoardCards(),
      bucketCount: deps.dashboardData().bucketCount,
      evaluateGradation: deps.evaluateGradation,
      empiricalSpots: deps.empiricalSpotsForCurrentActions(),
      playerProfiles: deps.playerProfilesForInference(),
    });
  }

  return {
    curvesForRangeAggregate,
    curvesForVillain,
    ensureCurrentPageCurves,
    ensureHeroMirrorCurves,
    scheduleCurrentPageCurves,
    shouldDeferCurrentPageCurves,
    shouldRenderWithoutCurrentPageCurves,
  };
}
