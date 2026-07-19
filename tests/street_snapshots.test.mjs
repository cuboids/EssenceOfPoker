import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneCacheObject,
  cloneHandModel,
  clonePlayerActions,
  cloneShowdownHoleCardsByPlayer,
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

  const actions = [{ player: "hero", street: "flop", type: "check" }];
  const recorded = recordStreetSnapshot([], model, "flop", actions);
  assert.equal(recorded.viewedStreetIndex, 1);
  assert.equal(recorded.handTimeline[1].handModel.phase, "flop");
  assert.deepEqual(recorded.handTimeline[1].playerActions, actions);
  assert.notEqual(recorded.handTimeline[1].playerActions, actions);

  const updated = updateStreetSnapshot(recorded.handTimeline, 1, model, { hero: {} }, { hero: {} }, actions);
  assert.notEqual(updated, recorded.handTimeline);
  assert.deepEqual(cloneCacheObject({ a: 1 }), { a: 1 });
  assert.deepEqual(clonePlayerActions(actions), actions);
  assert.notEqual(clonePlayerActions(actions), actions);
});

test("street snapshots preserve per-villain showdown cards", () => {
  const model = {
    phase: "river",
    hole: [card(1, 1), card(2, 2)],
    villain: [card(3, 3), card(4, 4)],
    flop: [card(5, 1), card(6, 2), card(7, 3)],
    turn: card(8, 4),
    river: card(9, 1),
    suitMap: new Map([[1, 1]]),
  };
  const showdownCards = {
    "villain:SB": [card(10, 1), card(11, 2)],
    "villain:BB": [card(12, 3), card(13, 4)],
  };

  const recorded = recordStreetSnapshot([], model, "river", [], showdownCards);
  assert.deepEqual(recorded.handTimeline[3].showdownHoleCardsByPlayer, showdownCards);
  assert.notEqual(recorded.handTimeline[3].showdownHoleCardsByPlayer["villain:SB"], showdownCards["villain:SB"]);

  const updated = updateStreetSnapshot(recorded.handTimeline, 3, model, {}, {}, [], showdownCards);
  const cloned = cloneShowdownHoleCardsByPlayer(showdownCards);
  showdownCards["villain:SB"][0].rank = 1;
  assert.equal(updated[3].showdownHoleCardsByPlayer["villain:SB"][0].rank, 10);
  assert.equal(cloned["villain:SB"][0].rank, 10);
});

test("recording a newly dealt street truncates stale future streets", () => {
  const preflop = {
    phase: "preflop",
    hole: [card(1, 1), card(2, 2)],
    villain: [card(3, 3), card(4, 4)],
    flop: [],
    turn: null,
    river: null,
    suitMap: new Map([[1, 1]]),
  };
  const staleFlop = {
    ...preflop,
    phase: "flop",
    flop: [card(5, 1), card(6, 2), card(7, 3)],
  };
  const freshFlop = {
    ...preflop,
    phase: "flop",
    flop: [card(8, 1), card(9, 2), card(10, 3)],
  };
  const staleTimeline = [
    { handModel: cloneHandModel(preflop), currentCurves: { old: true }, currentWinShares: {}, playerActions: [] },
    { handModel: cloneHandModel(staleFlop), currentCurves: { stale: true }, currentWinShares: {}, playerActions: [] },
    { handModel: { ...staleFlop, phase: "turn", turn: card(11, 4) }, currentCurves: {}, currentWinShares: {}, playerActions: [] },
  ];

  const recorded = recordStreetSnapshot(staleTimeline, freshFlop, "flop", []);

  assert.equal(recorded.viewedStreetIndex, 1);
  assert.equal(recorded.handTimeline.length, 2);
  assert.deepEqual(
    recorded.handTimeline[1].handModel.flop.map((flopCard) => [flopCard.rank, flopCard.suit]),
    [
      [8, 1],
      [9, 2],
      [10, 3],
    ],
  );
  assert.equal(recorded.handTimeline[1].currentCurves.old, undefined);
  assert.equal(recorded.handTimeline[1].currentCurves.stale, undefined);
});
