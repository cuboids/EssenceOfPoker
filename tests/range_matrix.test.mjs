import assert from "node:assert/strict";
import test from "node:test";

import {
  matrixClassKey,
  rangeMatrixCells,
  rangeMatrixSummary,
} from "../dashboard/range_matrix.mjs";

test("range matrix uses pair diagonal, suited upper triangle, and offsuit lower triangle", () => {
  assert.equal(matrixClassKey(1, 1), "1-1-pair");
  assert.equal(matrixClassKey(1, 2), "1-2-suited");
  assert.equal(matrixClassKey(2, 1), "1-2-offsuit");
  assert.equal(matrixClassKey(5, 13), "5-13-suited");
  assert.equal(matrixClassKey(13, 5), "5-13-offsuit");
});

test("range matrix cells summarize average class weights", () => {
  const cells = rangeMatrixCells({
    combos: [
      { classKey: "1-1-pair", weight: 1 },
      { classKey: "1-1-pair", weight: 0.5 },
      { classKey: "1-2-suited", weight: 0.25 },
      { classKey: "1-2-offsuit", weight: 0 },
    ],
  });

  assert.equal(cells[0][0].label, "AA");
  assert.equal(cells[0][0].frequency, 0.75);
  assert.equal(cells[0][1].label, "AK");
  assert.equal(cells[0][1].type, "suited");
  assert.equal(cells[0][1].frequency, 0.25);
  assert.equal(cells[1][0].label, "AK");
  assert.equal(cells[1][0].type, "offsuit");
  assert.equal(cells[1][0].frequency, 0);
});

test("range matrix summary reports total weighted frequency", () => {
  const summary = rangeMatrixSummary({
    combos: [
      { classKey: "1-1-pair", weight: 1 },
      { classKey: "1-2-suited", weight: 0.5 },
      { classKey: "1-2-offsuit", weight: 0 },
    ],
  });

  assert.equal(summary.totalCombos, 3);
  assert.equal(summary.weightedCombos, 1.5);
  assert.equal(summary.frequency, 0.5);
});
