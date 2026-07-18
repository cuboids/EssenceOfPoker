import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateIsActive,
  ceilingForOtherAssetsInPortfolio,
  concreteAssetCount,
  concreteAssetIsActive,
  isLockedCurve,
} from "../dashboard/asset_status.mjs";

test("locked river assets stay active when they tie the portfolio ceiling", () => {
  const lockedCurve = { bestGradation: 42, worstGradation: 42 };

  assert.equal(isLockedCurve(lockedCurve), true);
  assert.equal(concreteAssetIsActive({ curveData: lockedCurve, ceilingGradation: 42, hasHandState: true }), true);
  assert.equal(concreteAssetIsActive({ curveData: lockedCurve, ceilingGradation: 41, hasHandState: true }), false);
});

test("non-locked assets require room above their minimum to remain active", () => {
  const curveData = { bestGradation: 100, worstGradation: 300 };

  assert.equal(concreteAssetIsActive({ curveData, ceilingGradation: 100, hasHandState: true }), false);
  assert.equal(concreteAssetIsActive({ curveData, ceilingGradation: 101, hasHandState: true }), true);
});

test("ceilings are the minimum worst-gradation of the other assets", () => {
  const assets = [{ code: "a" }, { code: "b" }, { code: "c" }];
  const curvesByCode = {
    a: { worstGradation: 500 },
    b: { worstGradation: 120 },
    c: { worstGradation: 300 },
  };

  assert.equal(ceilingForOtherAssetsInPortfolio({ assetCode: "a", assets, curvesByCode, bucketCount: 7462 }), 120);
  assert.equal(ceilingForOtherAssetsInPortfolio({ assetCode: "b", assets, curvesByCode, bucketCount: 7462 }), 300);
});

test("aggregates are active when any underlying asset is active", () => {
  const assets = [{ code: "a" }, { code: "b" }];
  const aggregate = { code: "AGG_X", assetCodes: ["a", "b"] };

  assert.equal(aggregateIsActive({ aggregate, assets, hasHandState: false, isUnderlyingAssetActive: () => false }), true);
  assert.equal(aggregateIsActive({ aggregate, assets, hasHandState: true, isUnderlyingAssetActive: (asset) => asset.code === "b" }), true);
  assert.equal(aggregateIsActive({ aggregate, assets, hasHandState: true, isUnderlyingAssetActive: () => false }), false);
});

test("concrete asset count ignores aggregate cards", () => {
  assert.equal(concreteAssetCount({
    assets: [{ code: "1.1" }, { code: "2.1" }],
    aggregates: [{ code: "AGG" }, { code: "AGG_H1" }],
  }), 2);
});
