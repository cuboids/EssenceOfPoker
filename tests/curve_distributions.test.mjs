import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { preflopClassKeyForCards } from "../dashboard/cache_keys.mjs";
import {
  addAggregateCurves,
  curveFromTrimmedCounts,
  curvesForKnownAssets,
  distributionFor,
} from "../dashboard/curve_distributions.mjs";
import { createHandEvaluator } from "../dashboard/evaluation.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_portfolio.json", import.meta.url), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const priorXByGradation = new Map(data.curve.map((point) => [point.gradation, point.x]));
const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("distributionFor enumerates exact completions from known cards and remaining deck", () => {
  const curve = distributionFor(
    [card(1, 1), card(2, 1), card(3, 1)],
    [card(4, 1), card(5, 1), card(6, 1)],
    data.bucketCount,
    priorXByGradation,
    evaluator.evaluateGradation,
  );

  assert.equal(curve.totalCombos, 3);
  assert.equal(curve.bestGradation, 1);
  assert.equal(curve.curve.at(-1).probability, 1);
});

test("aggregate curves enumerate same-world minimums outside the UI", () => {
  const curves = {};
  const aggregate = data.portfolios.hero.aggregates.find((item) => item.code === "AGG_ZERO");
  addAggregateCurves({
    curves,
    aggregates: [aggregate],
    remainingDeck: [card(6, 1), card(7, 2)],
    knownState: {
      H_1: card(1, 1),
      H_2: card(2, 2),
      F_1: card(3, 3),
      F_2: card(4, 4),
      F_3: card(5, 1),
    },
    aggregateTokens: ["H_1", "H_2", "F_1", "F_2", "F_3", "T", "R"],
    bucketCount: data.bucketCount,
    priorXByGradation,
    evaluateGradation: evaluator.evaluateGradation,
  });

  assert.equal(curves.AGG_ZERO.totalCombos, 1);
  assert.equal(curves.AGG_ZERO.curve.at(-1).probability, 1);
  assert.equal(
    curves.AGG_ZERO.bestGradation,
    evaluator.evaluateGradation([card(3, 3), card(4, 4), card(5, 1), card(6, 1), card(7, 2)]),
  );
});

test("known asset curves reuse identical known-card distributions and cached preflop aggregates", () => {
  const h1 = card(2, 1);
  const h2 = card(12, 2);
  const assetA = { code: "A", name: "H_1 + F_1 + F_2 + F_3 + T" };
  const assetB = { code: "B", name: "H_1 + F_1 + F_2 + F_3 + R" };
  const zeroAggregate = { code: "AGG_ZERO" };
  const trimmed = { first: 10, counts: [2, 0, 3] };
  const curves = curvesForKnownAssets({
    assets: [assetA, assetB],
    aggregates: [zeroAggregate],
    remainingDeck: [card(1, 1), card(3, 1), card(4, 1), card(5, 1)],
    knownCardsForAsset: () => [h1],
    knownState: { H_1: h1, H_2: h2 },
    aggregateTokens: ["H_1", "H_2", "F_1", "F_2", "F_3", "T", "R"],
    bucketCount: data.bucketCount,
    priorXByGradation,
    evaluateGradation: evaluator.evaluateGradation,
    preflopAggregateCache: {
      totalCombos: 5,
      classes: {
        [preflopClassKeyForCards(h1, h2)]: { AGG_ZERO: trimmed },
      },
    },
    preflopClassKey: preflopClassKeyForCards(h1, h2),
  });

  assert.equal(curves.A, curves.B);
  assert.deepEqual(curves.AGG_ZERO, curveFromTrimmedCounts(trimmed, 5, data.bucketCount, priorXByGradation));
});
