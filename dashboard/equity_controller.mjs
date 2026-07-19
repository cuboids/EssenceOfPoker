import { readApiCacheResult, writeApiCacheResult } from "./cache_client.mjs";
import { winShareCacheKey as buildWinShareCacheKey } from "./cache_keys.mjs";
import {
  validateCompactPreflopMultiwayEquityCachePayload,
  validateMultiwayEquityCachePayload,
  validateWinShareCachePayload,
} from "./cache_payload_contracts.mjs";
import {
  computeMultiwayAggregateEquities,
  computeMultiwayAggregateEquitiesChunked,
} from "./multiway_equity.mjs";
import {
  buildAggregateEquityCacheKey,
  buildMultiwayEquityPayload,
  compactPreflopAggregateEquity,
  expandCachedPreflopAggregateEquity,
  participantHasNoLegalRange,
  preflopAggregateEquityUsesCanonicalCache,
} from "./equity_payload_builder.mjs";
import { hashString } from "./session_rng.mjs";
import {
  computePreflopHeroWinSharesKernel,
  computeRunoutWinShares,
} from "./win_shares.mjs";

export function createEquityController(deps) {
  const cardState = deps.cardState || deps;
  function resetWinShareState() {
    deps.setCurrentWinShares(deps.handState() ? {} : deps.priorWinSharesByPage());
    deps.asyncJobs.cancelByPrefix("equity:");
  }

  function ensureCurrentPageWinShares() {
    const handState = deps.handState();
    const activePage = deps.activePage();
    const guard = deps.createCurrentAsyncGuard({ purpose: "page-win-shares", page: activePage });
    const jobKey = `equity:win-shares:${activePage}:${hashString(guard.key)}`;
    if (!handState || activePage === "config" || deps.currentWinShares()[activePage] || deps.asyncJobs.isScheduled(jobKey)) {
      return;
    }
    if (deps.isOpponentPage(activePage) && !deps.villainShowdown()) {
      return;
    }

    const page = activePage;
    deps.asyncJobs.schedule({
      key: jobKey,
      delayMs: 20,
      guard,
      run: async () => {
        if (deps.currentWinShares()[page]) {
          return;
        }
        const result = await cachedOrComputedWinSharesForPage(page, { guard });
        if (!guard.isCurrent() || deps.currentWinShares()[page]) {
          return;
        }
        deps.patchCurrentWinShares(page, (currentPageShares = {}) => ({
          ...currentPageShares,
          ...result,
          aggregateShares: currentPageShares.aggregateShares,
          aggregateEquityMeta: currentPageShares.aggregateEquityMeta,
        }));
        deps.updateCurrentStreetSnapshot();
        deps.saveCurrentMomentCache();
        if (deps.activePage() === page) {
          deps.renderAssets();
          if (deps.focusedAsset() && !deps.focusedAsset().isAggregate) {
            deps.openFocus(deps.focusedAsset());
          }
        }
      },
    });
  }

  function ensureAggregateEquities() {
    const guard = deps.createCurrentAsyncGuard({ purpose: "aggregate-equities", page: deps.activePage() });
    const jobKey = aggregateEquityJobKey(guard);
    if (deps.activePage() === "config" || aggregateEquitiesAreReady() || deps.asyncJobs.isScheduled(jobKey)) {
      return;
    }
    if (!deps.handState()) {
      applyAggregateEquities(priorMultiwayAggregateEquities());
      return;
    }

    deps.asyncJobs.schedule({
      key: jobKey,
      delayMs: 250,
      guard,
      run: async () => {
        if (aggregateEquitiesAreReady()) {
          return;
        }
        const equities = await cachedOrComputedAggregateEquities({ guard });
        if (!guard.isCurrent()) {
          return;
        }
        applyAggregateEquities(equities);
        deps.updateCurrentStreetSnapshot();
        deps.saveCurrentMomentCache();
        deps.renderAssets();
        if (deps.focusedAsset()?.isAggregate) {
          deps.openFocus(deps.focusedAsset());
        }
      },
    });
  }

  function aggregateEquityJobKey(guard) {
    return `equity:aggregate:${hashString(guard.key)}`;
  }

  function aggregateEquitiesAreReady() {
    const currentWinShares = deps.currentWinShares();
    const activeVillains = deps.activeVillainPageKeys();
    if (currentWinShares.hero?.aggregateShares?.AGG == null || currentWinShares.hero?.aggregateShares?.RANGE_AGG == null) {
      return false;
    }
    return deps.villainPageKeys().every((page) =>
      currentWinShares[page]?.aggregateShares?.AGG != null ||
      (!activeVillains.includes(page) && deps.isVillainPageFolded(page)),
    );
  }

  function priorMultiwayAggregateEquities() {
    const activeVillains = deps.activeVillainPageKeys();
    const participantCount = activeVillains.length + 1;
    const share = participantCount > 0 ? 1 / participantCount : 1;
    return {
      actual: {
        equities: {
          hero: share,
          ...Object.fromEntries(activeVillains.map((page) => [page, share])),
        },
        nsims: 1,
        exact: true,
      },
      range: {
        equities: { range: share },
        nsims: 1,
        exact: true,
      },
    };
  }

  function applyAggregateEquities({ actual, range }) {
    deps.patchCurrentWinShares("hero", (heroShares = {}) => ({
      ...heroShares,
      aggregateShares: {
        ...(heroShares.aggregateShares || {}),
        AGG: actual.equities.hero ?? 0,
        RANGE_AGG: range.equities.range ?? 0,
      },
      aggregateEquityMeta: { actual, range },
    }));

    for (const page of deps.villainPageKeys()) {
      deps.patchCurrentWinShares(page, (pageShares = {}) => ({
        ...pageShares,
        aggregateShares: {
          ...(pageShares.aggregateShares || {}),
          AGG: deps.isVillainPageFolded(page) ? 0 : (actual.equities[page] ?? 0),
        },
        aggregateEquityMeta: actual,
      }));
    }
  }

  async function cachedOrComputedAggregateEquities({ guard = null } = {}) {
    const actual = await cachedOrComputedAggregateEquity("actual", { guard });
    const range = deps.visiblePlayerActionsForCurrentStreet().length
      ? await cachedOrComputedAggregateEquity("range", { guard })
      : exactRangeAggregateEquity();
    return { actual, range };
  }

  function exactRangeAggregateEquity() {
    const participantCount = deps.activeVillainPageKeys().length + 1;
    return {
      equities: { range: participantCount > 0 ? 1 / participantCount : 1 },
      nsims: 1,
      exact: true,
    };
  }

  async function cachedOrComputedAggregateEquity(matchup, { guard = null } = {}) {
    const payload = multiwayEquityPayload(matchup);
    if (matchup === "range" && participantHasNoLegalRange(payload.participants.find((participant) => participant.id === "range"), payload.knownBoard)) {
      return {
        equities: { range: 0 },
        nsims: 0,
        exact: true,
      };
    }
    const usesCanonicalCache = preflopAggregateEquityUsesCanonicalCache({
      matchup,
      payload,
      handRound: deps.handState()?.round,
      visibleActions: deps.visiblePlayerActionsForCurrentStreet(),
    });
    const cacheKey = buildAggregateEquityCacheKey({
      matchup,
      payload,
      assetVersion: deps.assetVersion(),
      foldedPages: deps.villainPageKeys().filter(deps.isVillainPageFolded),
      usesCanonicalCache,
    });
    const cached = await readApiCacheResult(cacheKey, {
      validator: (candidate) => usesCanonicalCache
        ? validateCompactPreflopMultiwayEquityCachePayload(candidate, { playerCount: payload.participants.length })
        : validateMultiwayEquityCachePayload(candidate, { expectedParticipants: payload.participants.length }),
    });
    if (cached.ok) {
      return usesCanonicalCache
        ? expandCachedPreflopAggregateEquity(cached.value, payload)
        : cached.value;
    }
    const result = await computeMultiwayEquityAsync(payload);
    observeCacheWrite(writeApiCacheResult(
      cacheKey,
      usesCanonicalCache
        ? compactPreflopAggregateEquity(result, payload)
        : result,
      {
        shouldWrite: () => !guard || guard.isCurrent(),
        validator: (candidate) => usesCanonicalCache
          ? validateCompactPreflopMultiwayEquityCachePayload(candidate, { playerCount: payload.participants.length })
          : validateMultiwayEquityCachePayload(candidate, { expectedParticipants: payload.participants.length }),
      },
    ), { cacheKey, family: "aggregate-equity" });
    return result;
  }

  async function computeMultiwayEquityAsync(payload) {
    if (!deps.computationWorker()) {
      return computeMultiwayAggregateEquitiesChunked({
        participants: payload.participants,
        knownBoard: payload.knownBoard,
        deck: payload.deck,
        evaluateGradationFive: deps.evaluateGradationFive,
        nsims: payload.nsims,
        seed: payload.seed,
      });
    }
    return deps.computationWorker().computeMultiwayEquities(payload, () => computeMultiwayEquity(payload));
  }

  function computeMultiwayEquity(payload) {
    return computeMultiwayAggregateEquities({
      participants: payload.participants,
      knownBoard: payload.knownBoard,
      deck: payload.deck,
      evaluateGradationFive: deps.evaluateGradationFive,
      nsims: payload.nsims,
      seed: payload.seed,
    });
  }

  function multiwayEquityPayload(matchup) {
    const knownBoard = cardState.currentBoardCards();
    const handState = deps.handState();
    return buildMultiwayEquityPayload({
      matchup,
      assetVersion: deps.assetVersion(),
      handState,
      knownBoard,
      knownCardsForHand: cardState.knownCardsForHand(),
      activeVillainPageKeys: deps.activeVillainPageKeys(),
      visibleActions: deps.visiblePlayerActionsForCurrentStreet(),
      tableConfig: deps.tableConfig(),
      dashboardData: deps.dashboardData(),
      evaluateGradation: deps.evaluateGradation,
      empiricalSpots: deps.empiricalSpotsForCurrentActions(),
      playerProfiles: deps.playerProfilesForInference(),
    });
  }

  async function cachedOrComputedWinSharesForPage(page, { guard = null } = {}) {
    const cacheKey = winShareCacheKey(page);
    const cached = await readApiCacheResult(cacheKey, {
      validator: (payload) => validateWinShareCachePayload(payload, { expectedShareCount: 21 }),
    });
    if (cached.ok) {
      return cached.value;
    }
    if (page === "hero" && deps.handState()?.round === "preflop") {
      return { shares: {}, totalCombos: 0, pending: true };
    }

    const result = await computeWinSharesForPageAsync(page);
    observeCacheWrite(writeApiCacheResult(cacheKey, result, {
      shouldWrite: () => !guard || guard.isCurrent(),
      validator: (payload) => validateWinShareCachePayload(payload, { expectedShareCount: 21 }),
    }), { cacheKey, family: "win-shares" });
    return result;
  }

  function observeCacheWrite(writePromise, { cacheKey, family }) {
    void writePromise.then((result) => {
      if (!result.ok && result.reason !== "cancelled") {
        deps.recordCacheWriteFailure?.({
          type: `cache-write:${family}`,
          message: `Cache write failed for ${family}: ${result.error || result.reason || "unknown error"}`,
          cacheKey,
          result,
          at: new Date().toISOString(),
        });
      }
    }).catch((error) => {
      deps.recordCacheWriteFailure?.({
        type: `cache-write:${family}`,
        message: `Cache write failed for ${family}: ${error?.message || "unknown error"}`,
        cacheKey,
        error,
        at: new Date().toISOString(),
      });
    });
  }

  function winShareCacheKey(page) {
    const handState = deps.handState();
    const state = deps.isOpponentPage(page) ? cardState.currentKnownVillainStateForPage(page) : cardState.currentKnownHeroState();
    return buildWinShareCacheKey({
      page,
      state,
      street: deps.villainShowdown() ? "showdown" : "hidden",
      isHeroPreflop: page === "hero" && handState?.round === "preflop",
      h1: handState?.h1,
      h2: handState?.h2,
      dataVersion: deps.assetVersion(),
    });
  }

  async function computeWinSharesForPageAsync(page) {
    const payload = winShareWorkerPayload(page);
    if (!deps.computationWorker() || !payload) {
      return computeWinSharesForPage(page);
    }
    return deps.computationWorker().computeWinShares(payload, () => computeWinSharesForPage(page));
  }

  function winShareWorkerPayload(page) {
    const handState = deps.handState();
    if (!handState) {
      return null;
    }
    const isHeroPreflop = page === "hero" && handState.round === "preflop";
    const portfolio = isHeroPreflop ? deps.dashboardData().portfolios.hero : deps.portfolioForCurvePage(page);
    const knownState = deps.isOpponentPage(page) ? cardState.currentKnownVillainStateForPage(page) : cardState.currentKnownHeroState();
    const remainingDeck = deps.isOpponentPage(page)
      ? cardState.remainingDeckForKnownCards(cardState.allDealtCardsForDeck(page))
      : cardState.remainingDeckForKnownCards(cardState.knownCardsForHand());
    return {
      kind: isHeroPreflop ? "heroPreflop" : "runout",
      bucketKeys: deps.dashboardData().bucketKeys,
      bucketCount: deps.dashboardData().bucketCount,
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
    if (page === "hero" && deps.handState()?.round === "preflop") {
      return computePreflopHeroWinShares();
    }

    const portfolio = deps.portfolioForCurvePage(page);
    const knownState = deps.isOpponentPage(page) ? cardState.currentKnownVillainStateForPage(page) : cardState.currentKnownHeroState();
    const remainingDeck = deps.isOpponentPage(page)
      ? cardState.remainingDeckForKnownCards(cardState.allDealtCardsForDeck(page))
      : cardState.remainingDeckForKnownCards(cardState.knownCardsForHand());
    return computeRunoutWinShares({
      portfolio,
      knownState,
      remainingDeck,
      suitMap: deps.handState()?.suitMap || new Map(),
      evaluateGradation: deps.evaluateGradation,
    });
  }

  function computePreflopHeroWinShares() {
    return computePreflopHeroWinSharesKernel({
      portfolio: deps.dashboardData().portfolios.hero,
      handState: deps.handState(),
      remainingDeck: cardState.remainingDeckForKnownCards(cardState.knownCardsForHand()),
      evaluateGradationFive: deps.evaluateGradationFive,
    });
  }

  return {
    aggregateEquitiesAreReady,
    ensureAggregateEquities,
    ensureCurrentPageWinShares,
    resetWinShareState,
  };
}
