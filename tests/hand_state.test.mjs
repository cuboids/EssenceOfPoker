import assert from "node:assert/strict";
import test from "node:test";

import {
  HAND_PHASES,
  assertCanonicalHandModel,
  buildModelFromPhysicals,
  dealFlopModel,
  dealRiverModel,
  dealTurnModel,
  editKnownCardModel,
  emptyHandModel,
  pendingHoleCards,
  rebuildTimeline,
  revealVillainModel,
  setPendingHoleCard,
  startPreflopModel,
} from "../dashboard/hand_state.mjs";
import { handViewFromModel } from "../dashboard/hand_view.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("pending hole-card edits move empty to partial_holding without a legacy hand", () => {
  const model = setPendingHoleCard(emptyHandModel(), "H_1", card(2, 1));

  assert.equal(assertCanonicalHandModel(model), true);
  assert.equal(model.phase, HAND_PHASES.PARTIAL_HOLDING);
  assert.deepEqual(pendingHoleCards(model), [card(2, 1), null]);
  assert.equal(handViewFromModel(model), null);
});

test("preflop normalizes hole-card order and hero-relative suits", () => {
  const model = startPreflopModel([card(13, 4), card(1, 2)], [card(8, 1), card(9, 1)]);

  assert.equal(assertCanonicalHandModel(model), true);
  assert.equal(model.phase, HAND_PHASES.PREFLOP);
  assert.equal(model.hole[0].rank, 1);
  assert.equal(model.hole[0].relativeSuit, 1);
  assert.equal(model.hole[1].rank, 13);
  assert.equal(model.hole[1].relativeSuit, 2);
});

test("flop sorting uses rank, known relative suits, then absolute suit", () => {
  const model = startPreflopModel([card(8, 3), card(12, 1)], [card(6, 1), card(7, 1)]);
  const flopModel = dealFlopModel(model, [card(1, 4), card(2, 3), card(2, 1)]);

  assert.equal(assertCanonicalHandModel(flopModel), true);
  assert.deepEqual(
    flopModel.flop.map((flopCard) => [flopCard.rank, flopCard.suit, flopCard.relativeSuit]),
    [
      [1, 4, 3],
      [2, 3, 1],
      [2, 1, 2],
    ],
  );
});

test("turn, river, and showdown phases are explicit", () => {
  const preflop = startPreflopModel([card(1, 1), card(2, 2)], [card(3, 3), card(4, 4)]);
  const flop = dealFlopModel(preflop, [card(5, 1), card(6, 2), card(7, 3)]);
  const turn = dealTurnModel(flop, card(8, 4));
  const river = dealRiverModel(turn, card(9, 1));
  const showdown = revealVillainModel(river);

  for (const streetModel of [preflop, flop, turn, river, showdown]) {
    assert.equal(assertCanonicalHandModel(streetModel), true);
  }
  assert.equal(turn.phase, HAND_PHASES.TURN);
  assert.equal(river.phase, HAND_PHASES.RIVER);
  assert.equal(showdown.phase, HAND_PHASES.SHOWDOWN);
  assert.equal(handViewFromModel(showdown).round, HAND_PHASES.RIVER);
  assert.ok(showdown.villain.every((villainCard) => villainCard.relativeSuit));
});

test("editing a known card rebuilds order and relative suits", () => {
  const preflop = startPreflopModel([card(10, 4), card(11, 4)], [card(3, 1), card(4, 1)]);
  const edited = editKnownCardModel(preflop, "H_2", card(1, 2));

  assert.equal(assertCanonicalHandModel(edited), true);
  assert.deepEqual(
    edited.hole.map((holeCard) => [holeCard.rank, holeCard.suit, holeCard.relativeSuit]),
    [
      [1, 2, 1],
      [10, 4, 2],
    ],
  );
});

test("duplicate visible cards are rejected", () => {
  const preflop = startPreflopModel([card(1, 1), card(2, 2)], [card(3, 3), card(4, 4)]);

  assert.throws(
    () => editKnownCardModel(preflop, "H_2", card(1, 1)),
    /already dealt|duplicates|duplicate/,
  );
});

test("street history is rebuilt from the canonical physical cards", () => {
  const river = buildModelFromPhysicals(HAND_PHASES.RIVER, {
    hole: [card(2, 2), card(1, 1)],
    villain: [card(12, 3), card(13, 4)],
    flop: [card(6, 4), card(4, 2), card(4, 1)],
    turn: card(9, 3),
    river: card(10, 4),
  });

  const timeline = rebuildTimeline(river);

  for (const streetModel of timeline) {
    assert.equal(assertCanonicalHandModel(streetModel), true);
  }
  assert.deepEqual(timeline.map((model) => model.phase), [
    HAND_PHASES.PREFLOP,
    HAND_PHASES.FLOP,
    HAND_PHASES.TURN,
    HAND_PHASES.RIVER,
  ]);
  assert.equal(timeline[1].flop.length, 3);
  assert.equal(timeline[2].turn.rank, 9);
  assert.equal(timeline[3].river.rank, 10);
});

test("canonical auditor catches stale relative suits and unsorted street cards", () => {
  const flop = dealFlopModel(
    startPreflopModel([card(8, 3), card(12, 1)], [card(6, 1), card(7, 1)]),
    [card(1, 4), card(2, 3), card(2, 1)],
  );

  assert.throws(
    () => assertCanonicalHandModel({
      ...flop,
      flop: [flop.flop[1], flop.flop[0], flop.flop[2]],
    }),
    /canonical|order/i,
  );
  assert.throws(
    () => assertCanonicalHandModel({
      ...flop,
      hole: [{ ...flop.hole[0], relativeSuit: 2 }, flop.hole[1]],
    }),
    /canonical|relative-suit/i,
  );
});
