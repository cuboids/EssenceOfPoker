import assert from "node:assert/strict";
import test from "node:test";

import {
  dealFlopModel,
  dealRiverModel,
  dealTurnModel,
  emptyHandModel,
  revealVillainModel,
  startPreflopModel,
} from "../dashboard/hand_state.mjs";
import { handViewFromModel } from "../dashboard/hand_view.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("hand view exposes the app read model without requiring the legacy bridge", () => {
  const preflop = startPreflopModel([card(2, 1), card(5, 2)], [card(7, 3), card(8, 4)]);
  const flop = dealFlopModel(preflop, [card(1, 1), card(3, 2), card(12, 4)]);
  const view = handViewFromModel(flop);

  assert.equal(view.round, "flop");
  assert.equal(view.h1.rank, 2);
  assert.equal(view.h2.rank, 5);
  assert.equal(view.flop.length, 3);
  assert.notEqual(view.flop, flop.flop);
  assert.notEqual(view.suitMap, flop.suitMap);
  assert.deepEqual(
    comparableView(view),
    comparableView(handViewFromModel(flop)),
  );
});

test("hand view treats showdown as river for street-scoped UI", () => {
  const preflop = startPreflopModel([card(1, 1), card(2, 1)], [card(3, 1), card(4, 1)]);
  const flop = dealFlopModel(preflop, [card(5, 1), card(6, 2), card(7, 3)]);
  const turn = dealTurnModel(flop, card(8, 4));
  const river = revealVillainModel(dealRiverModel(turn, card(9, 1)));

  assert.equal(handViewFromModel(emptyHandModel()), null);
  assert.equal(handViewFromModel(river).round, "river");
});

function comparableView(view) {
  return {
    ...view,
    suitMap: [...view.suitMap.entries()].sort(([first], [second]) => first - second),
  };
}
