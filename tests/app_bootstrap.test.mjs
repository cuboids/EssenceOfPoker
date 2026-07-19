import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregatePriorXMap,
  loadDashboardBootstrap,
} from "../dashboard/app_bootstrap.mjs";

test("aggregate prior x map uses aggregate counts when available", () => {
  const fallback = new Map([[1, 0.5]]);
  const data = {
    bucketCount: 3,
    priorAggregate: {
      totalCombos: 4,
      counts: { 1: 1, 2: 2, 3: 1 },
    },
  };
  assert.deepEqual([...aggregatePriorXMap(data, fallback).entries()], [
    [1, 0.25],
    [2, 0.75],
    [3, 1],
  ]);
  assert.equal(aggregatePriorXMap({ bucketCount: 3 }, fallback), fallback);
});

test("dashboard bootstrap validates artifacts and builds evaluator helpers", async () => {
  const dashboardData = {
    title: "Test",
    totalCombos: 1,
    bucketCount: 1,
    curve: [{ gradation: 1, x: 1 }],
    priorAggregate: { totalCombos: 1, counts: [0, 1], bestGradation: 1, worstGradation: 1 },
    bucketKeys: [{ key: "straight flush|1", gradation: 1 }],
    categoryBands: Array.from({ length: 9 }, (_, index) => ({
      name: `cat-${index}`,
      start: 1,
      end: 1,
      color: "#000",
    })),
    portfolios: {
      hero: portfolioFixture(),
      villain: portfolioFixture(),
    },
  };
  const priorWinShares = {
    totalCombos: 1,
    shares: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`${index + 1}`, index === 0 ? 1 : 0])),
    aggregateMatchups: { AGG: 0.5, RANGE_AGG: 0.5 },
  };
  const handEquity = {
    source: "test",
    exact: false,
    iterations: 1,
    classes: Object.fromEntries(Array.from({ length: 169 }, (_, index) => [`class-${index}`, 0.5])),
  };
  const payloads = [dashboardData, priorWinShares, handEquity];
  const fetchRef = async () => ({ json: async () => payloads.shift() });

  const bootstrap = await loadDashboardBootstrap({ assetVersion: "test", fetchRef });

  assert.equal(bootstrap.dashboardData.priorWinShares, priorWinShares);
  assert.equal(bootstrap.bucketLookup.get("straight flush|1"), 1);
  assert.equal(bootstrap.preflopHandEquityCache, handEquity);
  assert.equal(bootstrap.priorXByGradation.get(1), 1);
});

function portfolioFixture() {
  const assets = Array.from({ length: 21 }, (_, index) => ({
    code: `${index + 1}`,
    category: "test",
    name: `Asset ${index + 1}`,
    positions: [],
    prior: { first: 1, counts: [1], totalCombos: 1, bestGradation: 1, worstGradation: 1 },
  }));
  return {
    assets,
    aggregates: ["AGG", "AGG_BOTH", "AGG_H1", "AGG_H2", "AGG_ZERO"].map((code) => ({
      code,
      assetCodes: assets.map((asset) => asset.code),
      prior: { first: 1, counts: [1], totalCombos: 1, bestGradation: 1, worstGradation: 1 },
    })),
  };
}
