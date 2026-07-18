import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createHandEvaluator } from "../dashboard/evaluation.mjs";
import {
  curvesFromPreflopHiddenA2CCache,
  hiddenA2CVillainCurves,
  preflopHiddenA2CCurves,
  visitFutureBoard,
  weightedPreflopSingleVillainCardDistribution,
} from "../dashboard/villain_range.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_portfolio.json", import.meta.url), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const priorXByGradation = new Map(data.curve.map((point) => [point.gradation, point.x]));
const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("future-board visitor enumerates combinations and restores state", () => {
  const state = { F_1: card(1, 1) };
  const seen = [];

  visitFutureBoard(0, 0, [card(2, 1), card(3, 1), card(4, 1)], ["T", "R"], [], state, () => {
    seen.push([state.T.rank, state.R.rank]);
  });

  assert.deepEqual(seen, [[2, 3], [2, 4], [3, 4]]);
  assert.equal(state.T, undefined);
  assert.equal(state.R, undefined);
  assert.equal(state.F_1.rank, 1);
});

test("weighted preflop single-villain curves account for hidden companion card order", () => {
  const available = [card(1, 1), card(2, 1), card(3, 1), card(4, 1), card(5, 1), card(6, 1)];
  const v1 = weightedPreflopSingleVillainCardDistribution({
    visibleToken: "V_1",
    available,
    bucketCount: data.bucketCount,
    priorXByGradation,
    evaluateGradation: evaluator.evaluateGradation,
  });
  const v2 = weightedPreflopSingleVillainCardDistribution({
    visibleToken: "V_2",
    available,
    bucketCount: data.bucketCount,
    priorXByGradation,
    evaluateGradation: evaluator.evaluateGradation,
  });

  assert.equal(v1.totalCombos, 15);
  assert.equal(v2.totalCombos, 15);
  assert.equal(v1.curve.at(-1).probability, 1);
  assert.equal(v2.curve.at(-1).probability, 1);
});

test("preflop hidden villain curves are grouped by visible villain-card usage", () => {
  const assets = data.portfolios.a2cVillain.assets;
  const available = [card(1, 1), card(2, 1), card(3, 1), card(4, 1), card(5, 1), card(6, 1)];
  const curves = preflopHiddenA2CCurves({
    assets,
    available,
    bucketCount: data.bucketCount,
    priorXByGradation,
    evaluateGradation: evaluator.evaluateGradation,
  });

  const v1Only = assets.find((asset) => asset.name === "V_1 + F_1 + F_2 + F_3 + T");
  const v2Only = assets.find((asset) => asset.name === "V_2 + F_1 + F_2 + F_3 + T");
  const both = assets.find((asset) => asset.name === "V_1 + V_2 + F_1 + F_2 + F_3");

  assert.equal(curves[v1Only.code].totalCombos, 15);
  assert.equal(curves[v2Only.code].totalCombos, 15);
  assert.equal(curves[both.code].totalCombos, 6);
});

test("preflop hidden villain cache reconstruction avoids fake aggregate fallback curves", () => {
  const assets = data.portfolios.a2cVillain.assets;
  const aggregates = data.portfolios.a2cVillain.aggregates;
  const curves = curvesFromPreflopHiddenA2CCache({
    assets,
    aggregates,
    cachedClass: {
      shared: { first: 10, counts: [2, 3], totalCombos: 5, bestGradation: 10, worstGradation: 11 },
      v1: { first: 20, counts: [7], totalCombos: 7, bestGradation: 20, worstGradation: 20 },
      v2: { first: 30, counts: [11], totalCombos: 11, bestGradation: 30, worstGradation: 30 },
    },
    bucketCount: data.bucketCount,
    priorXByGradation,
  });

  const v1Only = assets.find((asset) => asset.name === "V_1 + F_1 + F_2 + F_3 + T");
  const v2Only = assets.find((asset) => asset.name === "V_2 + F_1 + F_2 + F_3 + T");
  const both = assets.find((asset) => asset.name === "V_1 + V_2 + F_1 + F_2 + F_3");

  assert.equal(curves[v1Only.code].totalCombos, 7);
  assert.equal(curves[v2Only.code].totalCombos, 11);
  assert.equal(curves[both.code].totalCombos, 5);
  assert.equal(curves.AGG, undefined);
  assert.equal(curves.AGG_ZERO.totalCombos, 5);
});

test("hidden villain curves include aggregate minimums when the board is complete", () => {
  const portfolio = data.portfolios.a2cVillain;
  const curves = hiddenA2CVillainCurves({
    assets: portfolio.assets,
    aggregates: portfolio.aggregates,
    available: [card(6, 1), card(7, 1), card(8, 2), card(9, 3)],
    knownBoardState: {
      F_1: card(1, 1),
      F_2: card(2, 1),
      F_3: card(3, 1),
      T: card(4, 1),
      R: card(5, 1),
    },
    futureBoardTokens: [],
    bucketCount: data.bucketCount,
    priorXByGradation,
    chooseTable: evaluator.chooseTable,
    evaluateGradation: evaluator.evaluateGradation,
  });

  assert.equal(curves["1.1"].totalCombos, 6);
  assert.equal(curves.AGG.totalCombos, 6);
  assert.equal(curves.AGG.curve.at(-1).probability, 1);
  assert.ok(curves.AGG.bestGradation <= curves["1.1"].bestGradation);
});
