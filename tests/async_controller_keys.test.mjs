import assert from "node:assert/strict";
import test from "node:test";

import { createCurveController } from "../dashboard/curve_controller.mjs";
import { createEquityController } from "../dashboard/equity_controller.mjs";

test("hero mirror curve jobs are keyed by page and snapshot", () => {
  const scheduled = [];
  const currentCurves = {};
  const controller = createCurveController({
    activePage: () => "hero",
    asyncJobs: recordingJobs(scheduled),
    createCurrentAsyncGuard: ({ page }) => ({ key: `snapshot:${page}`, isCurrent: () => true }),
    currentBoardCards: () => [{ rank: 1, suit: 1 }],
    currentCurves: () => currentCurves,
    focusedAsset: () => null,
    handState: () => ({ round: "flop" }),
    renderAssets: () => {},
    updateCurrentStreetSnapshot: () => {},
    updateLegend: () => {},
    villainPageKeys: () => ["villain:SB", "villain:BB"],
    villainShowdown: () => false,
  });

  controller.ensureHeroMirrorCurves();

  assert.equal(scheduled.length, 3);
  assert.equal(new Set(scheduled.map((job) => job.key)).size, 3);
  assert.ok(scheduled.every((job) => job.key.startsWith("curves:hero-mirror:")));
  assert.ok(scheduled.some((job) => job.key.includes("range:")));
  assert.ok(scheduled.some((job) => job.key.includes("villain:SB:")));
  assert.ok(scheduled.some((job) => job.key.includes("villain:BB:")));
});

test("aggregate equity jobs are keyed by full async snapshot", () => {
  const scheduled = [];
  let snapshot = "first";
  const controller = createEquityController({
    activePage: () => "hero",
    activeVillainPageKeys: () => ["villain:SB"],
    asyncJobs: recordingJobs(scheduled),
    createCurrentAsyncGuard: () => ({ key: `snapshot:${snapshot}`, isCurrent: () => true }),
    currentWinShares: () => ({}),
    handState: () => ({ round: "flop" }),
    priorWinSharesByPage: () => ({}),
    setCurrentWinShares: () => {},
    villainPageKeys: () => ["villain:SB"],
  });

  controller.ensureAggregateEquities();
  snapshot = "second";
  controller.ensureAggregateEquities();

  assert.equal(scheduled.length, 2);
  assert.notEqual(scheduled[0].key, scheduled[1].key);
  assert.ok(scheduled.every((job) => job.key.startsWith("equity:aggregate:")));
});

function recordingJobs(scheduled) {
  return {
    cancelByPrefix: () => 0,
    isScheduled: (key) => scheduled.some((job) => job.key === key),
    schedule: (job) => {
      scheduled.push(job);
      return true;
    },
  };
}
