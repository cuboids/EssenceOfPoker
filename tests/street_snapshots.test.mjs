import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneCacheObject,
  cloneHandModel,
  recordStreetSnapshot,
  streetIndexForRound,
  updateStreetSnapshot,
} from "../dashboard/street_snapshots.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("street indexes match NLHE street order", () => {
  assert.equal(streetIndexForRound("preflop"), 0);
  assert.equal(streetIndexForRound("flop"), 1);
  assert.equal(streetIndexForRound("turn"), 2);
  assert.equal(streetIndexForRound("river"), 3);
  assert.equal(streetIndexForRound("showdown"), -1);
});

test("street snapshots clone mutable containers", () => {
  const model = {
    phase: "flop",
    hole: [card(1, 1), card(2, 2)],
    villain: [card(3, 3), card(4, 4)],
    flop: [card(5, 1), card(6, 2), card(7, 3)],
    turn: null,
    river: null,
    suitMap: new Map([[1, 1]]),
  };

  const clone = cloneHandModel(model);
  assert.notEqual(clone.hole, model.hole);
  assert.notEqual(clone.flop, model.flop);
  assert.notEqual(clone.suitMap, model.suitMap);

  const recorded = recordStreetSnapshot([], model, "flop");
  assert.equal(recorded.viewedStreetIndex, 1);
  assert.equal(recorded.handTimeline[1].handModel.phase, "flop");

  const updated = updateStreetSnapshot(recorded.handTimeline, 1, model, { hero: {} }, { hero: {} });
  assert.notEqual(updated, recorded.handTimeline);
  assert.deepEqual(cloneCacheObject({ a: 1 }), { a: 1 });
});
