import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

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
import { createHandEvaluator, evaluateKey } from "../dashboard/evaluation.mjs";
import {
  aggregateGradationsForSevenCards,
  combinationsOfIndexes,
  curveFromCounts,
} from "../dashboard/portfolio_curves.mjs";
import { computePreflopHeroAssetPriorKernel } from "../dashboard/preflop_asset_priors.mjs";
import {
  accumulatePreflopOrderedStreetShare,
  indexesToMask,
  tokenIndexForWinShare,
} from "../dashboard/win_shares.mjs";
import { winShareSignal } from "../dashboard/win_signal.mjs";
import { cardHtml, compactTokenHtml, escapeHtml, formatCombos, formatPercent } from "../dashboard/ui.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_portfolio.json", import.meta.url), "utf8"));
const priorWinShares = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_win_shares.json", import.meta.url), "utf8"));
const preflopHiddenVillainCache = JSON.parse(fs.readFileSync(new URL("../dashboard/data/preflop_hidden_villain_cache.json", import.meta.url), "utf8"));
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
  assert.equal(preflopHiddenVillainCache.bucketCount, data.bucketCount);
  assert.equal(Object.keys(preflopHiddenVillainCache.classes).length, 169);
  const aces = preflopHiddenVillainCache.classes["1-1-pair"];
  assert.equal(aces.shared.totalCombos, 2_118_760);
  assert.equal(aces.v1.totalCombos, 238_360_500);
  assert.equal(aces.v2.totalCombos, 238_360_500);
  for (const curve of Object.values(aces)) {
    assert.equal(curve.counts.reduce((sum, count) => sum + count, 0), curve.totalCombos);
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

test("controller support modules are importable without the DOM", () => {
  assert.equal(smallChart.width, 360);
  assert.deepEqual([...categoryOrder], ["AGGREGATE", "CARD_1_PLUS_CARD_2", "CARD_1", "CARD_2", "ZERO"]);
  assert.equal(concreteAssetIsActive({ curveData: null, ceilingGradation: null, hasHandState: false }), true);
  assert.equal(typeof readApiCache, "function");
  assert.equal(createComputationWorker("test"), null);
});
