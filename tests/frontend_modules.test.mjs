import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import zlib from "node:zlib";

import {
  cardCompare,
  fullDeck,
  parsePhysicalCard,
  rankSymbol,
  sameCard,
  suitSymbol,
} from "../dashboard/cards.mjs";
import { categoryOrder, smallChart } from "../dashboard/app_config.mjs";
import { concreteAssetIsActive } from "../dashboard/asset_status.mjs";
import {
  handAggregateEquityIsEstimated,
  handAggregateEquityVsVillain,
} from "../dashboard/aggregate_equity.mjs";
import { chartDomain, normalCdf, normalPdf, normalQuantileClamped } from "../dashboard/charts.mjs";
import { readApiCache } from "../dashboard/cache_client.mjs";
import { createComputationWorker } from "../dashboard/computation_worker_client.mjs";
import { curvesForKnownAssets as curvesForKnownAssetsKernel } from "../dashboard/curve_distributions.mjs";
import { createHandEvaluator, evaluateKey } from "../dashboard/evaluation.mjs";
import { createPlayerActionController } from "../dashboard/player_action_controller.mjs";
import {
  aggregateGradationsForSevenCards,
  combinationsOfIndexes,
  curveFromCounts,
} from "../dashboard/portfolio_curves.mjs";
import {
  assetsForPage,
  normalizedPortfolios,
  villainPageKeysForConfig,
} from "../dashboard/portfolio_model.mjs";
import {
  bestSevenCardGradation,
  computeMultiwayAggregateEquities,
  computeMultiwayAggregateEquitiesChunked,
  multiwayEquityCacheKey,
  removeKnownCards,
} from "../dashboard/multiway_equity.mjs";
import { PROBABILITY_SPACES, assertProbabilitySpace, probabilitySpaceDefinitions } from "../dashboard/probability_spaces.mjs";
import { computePreflopHeroAssetPriorKernel } from "../dashboard/preflop_asset_priors.mjs";
import {
  accumulatePreflopOrderedStreetShare,
  indexesToMask,
  tokenIndexForWinShare,
} from "../dashboard/win_shares.mjs";
import { winShareSignal } from "../dashboard/win_signal.mjs";
import { chartSvg } from "../dashboard/renderers/chart_renderer.mjs";
import { renderConfigPageHtml } from "../dashboard/renderers/config_renderer.mjs";
import { holdingDisplayModel } from "../dashboard/renderers/holding_renderer.mjs";
import { renderRangeMatrixHtml } from "../dashboard/renderers/range_matrix_renderer.mjs";
import { renderShowdownSectionHtml } from "../dashboard/renderers/showdown_renderer.mjs";
import { cardHtml, compactTokenHtml, escapeHtml, formatCombos, formatPercent } from "../dashboard/ui.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_portfolio.json", import.meta.url), "utf8"));
const priorWinShares = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_win_shares.json", import.meta.url), "utf8"));
const preflopAggregateManifest = JSON.parse(fs.readFileSync(new URL("../essence_of_poker/data/preflop_aggregate_manifest.json", import.meta.url), "utf8"));
const preflopAggregateAces = readJsonOrGzip("../essence_of_poker/data/preflop_aggregate_classes/1-1-pair.json");
const preflopPrimaryClass = readJsonOrGzip("../essence_of_poker/data/preflop_primary_classes/1-1-pair.json");
const preflopHiddenVillainManifest = JSON.parse(fs.readFileSync(new URL("../essence_of_poker/data/preflop_hidden_villain_manifest.json", import.meta.url), "utf8"));
const preflopHiddenVillainAces = readJsonOrGzip("../essence_of_poker/data/preflop_hidden_villain_classes/1-1-pair.json");
const preflopHandEquityCache = JSON.parse(fs.readFileSync(new URL("../dashboard/data/preflop_hand_equity_cache.json", import.meta.url), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("cards module owns rank/suit symbols, parsing, deck identity, and ordering", () => {
  assert.equal(fullDeck.length, 52);
  assert.equal(rankSymbol(1), "A");
  assert.equal(rankSymbol(5), "T");
  assert.equal(suitSymbol(1), "♠");
  assert.deepEqual(parsePhysicalCard("K♠"), card(2, 1));
  assert.ok(sameCard(card(2, 1), parsePhysicalCard("ks")));
  assert.deepEqual(parsePhysicalCard("Td"), card(5, 3));
  assert.deepEqual(parsePhysicalCard("7d"), card(8, 3));
  assert.deepEqual(parsePhysicalCard("2c"), card(13, 4));
  assert.deepEqual([card(13, 4), card(1, 2)].sort(cardCompare), [card(1, 2), card(13, 4)]);
});

test("evaluation module can grade five-card hands without the browser", () => {
  const royal = [card(1, 1), card(2, 1), card(3, 1), card(4, 1), card(5, 1)];
  const worstHighCard = [card(13, 1), card(12, 2), card(11, 3), card(10, 4), card(8, 1)];

  assert.equal(evaluateKey(royal), "1:0");
  assert.equal(evaluator.evaluateGradation(royal), 1);
  assert.equal(evaluator.evaluateGradation(worstHighCard), 7462);
  assert.equal(evaluator.evaluateGradationFive(...royal), 1);
});

test("portfolio curve helpers compute curves and aggregate minimums without the DOM", () => {
  const counts = new Uint32Array(data.bucketCount + 1);
  counts[1] = 1;
  counts[7462] = 3;
  const priorX = new Map(data.curve.map((point) => [point.gradation, point.x]));
  const curve = curveFromCounts(counts, 4, data.bucketCount, priorX);

  assert.equal(curve.totalCombos, 4);
  assert.equal(curve.bestGradation, 1);
  assert.equal(curve.worstGradation, 7462);
  assert.equal(curve.curve[0].probability, 0.25);

  const groups = {
    AGG: combinationsOfIndexes([0, 1, 2, 3, 4, 5, 6], 5),
  };
  const gradations = aggregateGradationsForSevenCards(
    [card(1, 1), card(2, 1), card(3, 1), card(4, 1), card(5, 1), card(9, 2), card(13, 3)],
    groups,
    data.bucketCount,
    evaluator.evaluateGradation,
  );
  assert.equal(gradations.AGG, 1);
  assert.equal(gradations.AGG_BOTH, 1);
});

test("portfolio page model composes hero mirror aggregates outside the app shell", () => {
  const tableConfig = { playerCount: 3, heroPosition: "BTN", positions: ["BTN", "SB", "BB"] };
  const portfolios = normalizedPortfolios(data, tableConfig);
  const pageKeys = villainPageKeysForConfig(tableConfig);
  const heroAssets = assetsForPage({ portfolios, activePage: "hero", villainPageKeys: pageKeys });

  assert.deepEqual(pageKeys, ["villain:SB", "villain:BB"]);
  assert.deepEqual(
    heroAssets.filter((asset) => asset.category === "AGGREGATE").map((asset) => asset.code).slice(0, 4),
    ["AGG", "RANGE_AGG", "villain:SB:AGG", "villain:BB:AGG"],
  );
});

test("known asset curves can hydrate preflop primary classes without enumeration", () => {
  const aggregateOnlyCache = { AGG: preflopAggregateAces.aggregates.AGG, classes: { "1-1-pair": preflopAggregateAces.aggregates } };
  const curves = curvesForKnownAssetsKernel({
    assets: data.portfolios.hero.assets,
    aggregates: [],
    remainingDeck: [],
    knownCardsForAsset: () => {
      throw new Error("preflop primary cache should avoid known-card enumeration");
    },
    bucketCount: data.bucketCount,
    priorXByGradation: new Map(data.curve.map((point) => [point.gradation, point.x])),
    evaluateGradation: evaluator.evaluateGradation,
    preflopPrimaryCache: preflopPrimaryClass.assets,
    preflopAggregateCache: aggregateOnlyCache,
    preflopClassKey: "1-1-pair",
  });

  assert.equal(Object.keys(curves).length, 21);
  assert.equal(curves["1.1"].totalCombos, preflopPrimaryClass.totalCombos);
});

test("multiway aggregate equity scores exact known worlds and splits ties", () => {
  const boardRoyal = [card(1, 1), card(2, 1), card(3, 1), card(4, 1), card(5, 1)];
  const tied = computeMultiwayAggregateEquities({
    participants: [
      { id: "hero", knownHoleCards: [card(8, 2), card(9, 3)] },
      { id: "villain:BB", knownHoleCards: [card(10, 2), card(11, 3)] },
    ],
    knownBoard: boardRoyal,
    deck: [],
    evaluateGradationFive: evaluator.evaluateGradationFive,
  });
  assert.equal(tied.exact, true);
  assert.equal(tied.approximation.method, "exact");
  assert.equal(tied.approximation.conservativeMargin95, 0);
  assert.deepEqual(tied.equities, { hero: 0.5, "villain:BB": 0.5 });

  const heroRoyal = computeMultiwayAggregateEquities({
    participants: [
      { id: "hero", knownHoleCards: [card(1, 1), card(2, 1)] },
      { id: "villain:BB", knownHoleCards: [card(1, 2), card(1, 3)] },
    ],
    knownBoard: [card(3, 1), card(4, 1), card(5, 1), card(12, 4), card(13, 4)],
    deck: [],
    evaluateGradationFive: evaluator.evaluateGradationFive,
  });
  assert.deepEqual(heroRoyal.equities, { hero: 1, "villain:BB": 0 });
  assert.equal(bestSevenCardGradation([...heroRoyalKnownCards()], evaluator.evaluateGradationFive), 1);
});

test("multiway aggregate equity excludes folded participants and keys include blockers", () => {
  const result = computeMultiwayAggregateEquities({
    participants: [
      { id: "hero", knownHoleCards: [card(1, 1), card(1, 2)] },
      { id: "villain:BB", folded: true },
    ],
    knownBoard: [],
    deck: fullDeck,
    evaluateGradationFive: evaluator.evaluateGradationFive,
  });
  assert.deepEqual(result.equities, { hero: 1 });

  const firstKey = multiwayEquityCacheKey({
    matchup: "range",
    participants: [{ id: "range" }, { id: "villain:BB" }],
    knownBoard: [],
    deadCards: [card(1, 1), card(2, 1)],
    foldedPages: [],
    nsims: 100,
  });
  const secondKey = multiwayEquityCacheKey({
    matchup: "range",
    participants: [{ id: "range" }, { id: "villain:BB" }],
    knownBoard: [],
    deadCards: [card(1, 1), card(3, 1)],
    foldedPages: [],
    nsims: 100,
  });
  assert.notEqual(firstKey, secondKey);
  assert.equal(removeKnownCards([card(1, 1), card(2, 1)], [card(1, 1)]).length, 1);
});

test("chunked multiway aggregate equity matches deterministic kernel", async () => {
  const participants = [
    { id: "hero", knownHoleCards: [card(2, 1), card(5, 2)] },
    { id: "villain:SB" },
    { id: "villain:BB" },
  ];
  const deck = removeKnownCards(fullDeck, participants[0].knownHoleCards);
  const direct = computeMultiwayAggregateEquities({
    participants,
    knownBoard: [card(9, 1), card(10, 2), card(12, 3)],
    deck,
    evaluateGradationFive: evaluator.evaluateGradationFive,
    nsims: 120,
    seed: 42,
  });
  const chunked = await computeMultiwayAggregateEquitiesChunked({
    participants,
    knownBoard: [card(9, 1), card(10, 2), card(12, 3)],
    deck,
    evaluateGradationFive: evaluator.evaluateGradationFive,
    nsims: 120,
    seed: 42,
    chunkSize: 10,
    yieldFn: () => Promise.resolve(),
  });

  assert.deepEqual(chunked, direct);
  assert.equal(direct.exact, false);
  assert.equal(direct.seed, 42);
  assert.equal(direct.approximation.method, "monte-carlo");
  assert.ok(direct.approximation.maxStandardError > 0);
  assert.ok(direct.approximation.conservativeMargin95 > direct.approximation.maxStandardError);

  const repeated = computeMultiwayAggregateEquities({
    participants,
    knownBoard: [card(9, 1), card(10, 2), card(12, 3)],
    deck,
    evaluateGradationFive: evaluator.evaluateGradationFive,
    nsims: 120,
    seed: 42,
  });
  assert.deepEqual(repeated, direct);
});

function heroRoyalKnownCards() {
  return [card(1, 1), card(2, 1), card(3, 1), card(4, 1), card(5, 1), card(12, 4), card(13, 4)];
}

test("probability-space registry rejects mismatched generated data", () => {
  assert.equal(probabilitySpaceDefinitions[PROBABILITY_SPACES.HIDDEN_VILLAIN_PREFLOP_PRIMARY].exact, true);
  assert.equal(
    assertProbabilitySpace(preflopHiddenVillainAces, PROBABILITY_SPACES.HIDDEN_VILLAIN_PREFLOP_PRIMARY),
    preflopHiddenVillainAces,
  );
  assert.throws(
    () => assertProbabilitySpace(preflopHiddenVillainAces, PROBABILITY_SPACES.GENERIC_SEVEN_CARD),
    /expected probabilitySpace generic-seven-card/,
  );
});

test("chart math is importable and numerically sane", () => {
  assert.equal(normalPdf(0).toFixed(6), "0.398942");
  assert.equal(normalCdf(0).toFixed(6), "0.500000");
  assert.ok(Math.abs(normalQuantileClamped(0.5)) < 1e-9);

  const curve = [{ probability: 0.25 }, { probability: 0.5 }, { probability: 1 }];
  const domain = chartDomain(1, 3, curve, "cdf-straight", new Map());
  assert.deepEqual(domain, { start: 0, end: 1 });
});

test("win-share primitives split ties and index asset tokens", () => {
  assert.equal(indexesToMask([0, 2, 4]), 21);
  assert.equal(tokenIndexForWinShare("R"), 6);

  const shareValues = new Float64Array(2);
  const winningMasks = new Uint8Array(128);
  winningMasks[indexesToMask([0, 1, 2, 3, 4])] = 1;
  winningMasks[indexesToMask([0, 1, 2, 3, 5])] = 1;
  const plans = [
    [0, 1, 2, 3, 4],
    [0, 1, 2, 3, 5],
  ];

  assert.equal(accumulatePreflopOrderedStreetShare([0, 1, 2, 3, 4, 5, 6], plans, winningMasks, shareValues), 1);
  assert.deepEqual([...shareValues], [0.5, 0.5]);
});

test("win-share signal uses fixed thresholds and deep high-confidence bars", () => {
  assert.deepEqual(winShareSignal(0.0122), { level: 0, deepLevel: 0, isCertain: false });
  assert.deepEqual(winShareSignal(0.01221), { level: 1, deepLevel: 0, isCertain: false });
  assert.deepEqual(winShareSignal(0.04), { level: 2, deepLevel: 0, isCertain: false });
  assert.deepEqual(winShareSignal(0.11), { level: 3, deepLevel: 0, isCertain: false });
  assert.deepEqual(winShareSignal(0.26), { level: 4, deepLevel: 0, isCertain: false });
  assert.deepEqual(winShareSignal(0.5), { level: 5, deepLevel: 0, isCertain: false });
  assert.deepEqual(winShareSignal(0.50001), { level: 5, deepLevel: 1, isCertain: false });
  assert.deepEqual(winShareSignal(0.75), { level: 5, deepLevel: 2, isCertain: false });
  assert.deepEqual(winShareSignal(0.9), { level: 5, deepLevel: 3, isCertain: false });
  assert.deepEqual(winShareSignal(0.96429), { level: 5, deepLevel: 4, isCertain: false });
  assert.deepEqual(winShareSignal(0.9878), { level: 5, deepLevel: 5, isCertain: false });
  assert.deepEqual(winShareSignal(1), { level: 5, deepLevel: 5, isCertain: true });
});

test("prior homepage win-share cache covers the 21 primary assets", () => {
  assert.equal(priorWinShares.totalCombos, 56_189_515_200);
  assert.equal(Object.keys(priorWinShares.shares).length, 21);
  assert.equal(priorWinShares.aggregateMatchups.AGG, 0.5);
  assert.equal(priorWinShares.aggregateMatchups.RANGE_AGG, 0.5);
  assert.ok(Math.abs(Object.values(priorWinShares.shares).reduce((total, share) => total + share, 0) - 1) < 1e-12);
  for (const asset of data.portfolios.hero.assets) {
    assert.equal(typeof priorWinShares.shares[asset.code], "number");
  }
});

test("preflop primary prior kernel counts ordered street layouts outside the DOM", () => {
  const portfolio = {
    assets: [
      { code: "A", name: "H_1 + H_2 + F_1 + F_2 + F_3" },
      { code: "B", name: "H_1 + F_1 + F_2 + T + R" },
    ],
  };
  const handState = {
    h1: card(2, 1),
    h2: card(12, 2),
    suitMap: new Map([[1, 1], [2, 2]]),
  };
  const result = computePreflopHeroAssetPriorKernel({
    portfolio,
    handState,
    remainingDeck: [card(1, 3), card(3, 1), card(5, 4), card(8, 2), card(13, 3)],
    bucketCount: data.bucketCount,
    evaluateGradationFive: evaluator.evaluateGradationFive,
  });

  assert.equal(result.totalCombos, 20);
  assert.equal([...result.countsByCode.A].reduce((sum, count) => sum + count, 0), 20);
  assert.equal([...result.countsByCode.B].reduce((sum, count) => sum + count, 0), 20);
});

test("preflop hidden villain cache covers all canonical holding classes", () => {
  assert.equal(preflopHiddenVillainManifest.bucketCount, data.bucketCount);
  assert.equal(preflopHiddenVillainManifest.classes.length, 169);
  const aces = preflopHiddenVillainAces.curves;
  assert.equal(aces.shared.totalCombos, 2_118_760);
  assert.equal(aces.v1.totalCombos, 238_360_500);
  assert.equal(aces.v2.totalCombos, 238_360_500);
  for (const curve of Object.values(aces)) {
    assert.equal(curve.counts.reduce((sum, count) => sum + count, 0), curve.totalCombos);
  }
});

test("preflop aggregate cache covers all canonical holding classes", () => {
  assert.equal(preflopAggregateManifest.bucketCount, data.bucketCount);
  assert.equal(preflopAggregateManifest.classes.length, 169);
  assert.equal(preflopAggregateAces.probabilitySpace, PROBABILITY_SPACES.HERO_PREFLOP_AGGREGATE);
  assert.equal(preflopAggregateAces.totalCombos, 2_118_760);
  assert.deepEqual(Object.keys(preflopAggregateAces.aggregates).sort(), ["AGG", "AGG_BOTH", "AGG_H1", "AGG_H2"]);
  for (const aggregate of Object.values(preflopAggregateAces.aggregates)) {
    assert.equal(aggregate.counts.reduce((sum, count) => sum + count, 0), preflopAggregateAces.totalCombos);
  }
});

test("preflop hand equity cache covers canonical classes and makes KTo above 50%", () => {
  assert.equal(Object.keys(preflopHandEquityCache.classes).length, 169);
  assert.ok(preflopHandEquityCache.classes["1-1-pair"] > 0.84);
  assert.ok(preflopHandEquityCache.classes["2-5-offsuit"] > 0.57);
  assert.ok(preflopHandEquityCache.classes["2-5-offsuit"] < 0.63);
});

test("hand aggregate equity updates from prior to dealt holding class", () => {
  assert.equal(handAggregateEquityVsVillain({ handState: null, equityCache: preflopHandEquityCache, priorShare: 0.5 }), 0.5);

  const ktoState = {
    h1: card(2, 1),
    h2: card(5, 2),
  };

  assert.equal(
    handAggregateEquityVsVillain({ handState: ktoState, equityCache: preflopHandEquityCache, priorShare: 0.5 }),
    preflopHandEquityCache.classes["2-5-offsuit"],
  );
  assert.ok(handAggregateEquityIsEstimated({ handState: ktoState, equityCache: preflopHandEquityCache }));
});

test("ui helpers format card and numeric display without the DOM", () => {
  assert.equal(cardHtml({ rank: 1, suit: 1, relativeSuit: 2 }), '<span class="known-card">A<sub>2</sub></span>');
  assert.equal(compactTokenHtml("F_3"), "F<sub>3</sub>");
  assert.equal(escapeHtml('<A&"'), "&lt;A&amp;&quot;");
  assert.equal(formatCombos(1_600_000), "1.6m");
  assert.equal(formatCombos(2_809_475_760), "2.8b");
  assert.equal(formatPercent(0.00854), "0.854%");
});

test("renderer helpers produce dashboard HTML without the DOM", () => {
  const configHtml = renderConfigPageHtml({
    normalized: {
      playerCount: 2,
      positions: ["SB", "BB"],
      heroPosition: "SB",
      playerStacks: { SB: 100, BB: 100 },
    },
    hideInactiveAssets: true,
    calibrationContext: { stakeBucket: "micro", yearBucket: "2019+" },
    playerCounts: [2, 3],
    tablePositions: ["SB", "BB", "BTN"],
    archetypeNames: ["tag"],
    profiles: [{ playerId: "hero", label: "Hero (SB)", profile: { tag: 0.4 } }],
  });
  assert.match(configHtml, /name="player-count"/);
  assert.match(configHtml, /Hero \(SB\)/);

  const matrixHtml = renderRangeMatrixHtml({
    title: "Hero range",
    description: "weights",
    explanation: "baseline",
    percent: "13.3%",
    range: { combos: [], summary: { totalCombos: 0, weightedCombos: 0, frequency: 0 } },
    evidence: { status: "idle" },
  });
  assert.match(matrixHtml, /range-matrix-large/);
  assert.match(matrixHtml, /Hero range/);

  const showdownHtml = renderShowdownSectionHtml({
    settlement: { complete: true, potSize: 12 },
    summaryText: "Hero wins 12",
    rows: [{
      label: "Hero",
      net: 10,
      winnings: 12,
      contribution: 2,
      folded: false,
      gradation: 1,
      category: { name: "Straight flush", color: "#00897b" },
      holeCards: [card(1, 1), card(2, 1)],
    }],
    pots: [{ label: "Main pot", amount: 12, winnerLabels: ["Hero"] }],
  });
  assert.match(showdownHtml, /Showdown/);
  assert.match(showdownHtml, /Straight flush/);

  const chartHtml = chartSvg({
    curve: [{ gradation: 1, probability: 0.5, x: 0.5 }, { gradation: 2, probability: 1, x: 1 }],
    bands: [{ start: 1, end: 2, name: "Straight flush", color: "#00897b", shade: 0.5 }],
    bucketCount: 2,
    bestGradation: 1,
    worstGradation: 2,
    ceilingGradation: null,
    config: smallChart,
    showGrid: false,
    label: "test chart",
    chartMode: "cdf-straight",
    naturalXByGradation: new Map([[1, 0.5], [2, 1]]),
    categoryForGradation: () => ({ color: "#00897b" }),
  });
  assert.match(chartHtml, /sparkline/);
  assert.match(chartHtml, /polyline/);

  const holding = holdingDisplayModel({
    activePage: "hero",
    assetCount: 21,
    handState: null,
    draftHoleCards: [card(1, 1), null],
    editableCardHtml: (token, value) => `${token}:${value?.rank || ""}`,
  });
  assert.match(holding.statusText, /before any cards/);
  assert.match(holding.displayHtml, /H_1:1/);
});

test("controller support modules are importable without the DOM", () => {
  assert.equal(smallChart.width, 360);
  assert.deepEqual([...categoryOrder], ["AGGREGATE", "CARD_1_PLUS_CARD_2", "CARD_1", "CARD_2", "ZERO"]);
  assert.equal(concreteAssetIsActive({ curveData: null, ceilingGradation: null, hasHandState: false }), true);
  assert.equal(typeof readApiCache, "function");
  assert.equal(createComputationWorker("test"), null);
  assert.equal(typeof createPlayerActionController, "function");
});

function readJsonOrGzip(relativePath) {
  const jsonUrl = new URL(relativePath, import.meta.url);
  if (fs.existsSync(jsonUrl)) {
    return JSON.parse(fs.readFileSync(jsonUrl, "utf8"));
  }
  const compressed = fs.readFileSync(new URL(`${relativePath}.gz`, import.meta.url));
  return JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
}
