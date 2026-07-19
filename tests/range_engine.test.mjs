import assert from "node:assert/strict";
import test from "node:test";

import { preflopClassKeyForCards } from "../dashboard/cache_keys.mjs";
import { cardKey } from "../dashboard/cards.mjs";
import { computeMultiwayAggregateEquities } from "../dashboard/multiway_equity.mjs";
import {
  createUniformPreflopRange,
  targetFrequencyForAction,
  thresholdForTarget,
  updatePreflopRangeForAction,
} from "../dashboard/range_model.mjs";
import { legalTwoCardCombos } from "../dashboard/range_universe.mjs";
import { inferPreflopRanges } from "../dashboard/range_update.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("range universe enumerates legal two-card combos and respects blockers", () => {
  const combos = legalTwoCardCombos();
  assert.equal(combos.length, 1326);
  assert.equal(new Set(combos.map((combo) => combo.id)).size, 1326);

  const blocked = legalTwoCardCombos({ deadCards: [card(1, 1), card(2, 2)] });
  assert.equal(blocked.length, 1225);
  assert.equal(blocked.some((combo) => combo.cards.some((comboCard) => cardKey(comboCard) === "1.1")), false);
});

test("threshold calibration hits target frequency smoothly", () => {
  const range = createUniformPreflopRange({ player: "villain:LJ", position: "LJ" });
  const threshold = thresholdForTarget(range.combos, 0.16);
  const continued = updatePreflopRangeForAction(range, { player: "villain:LJ", street: "preflop", type: "raise", amount: 3 }, { position: "LJ" });

  assert.ok(Number.isFinite(threshold));
  assert.ok(continued.summary.frequency > 0.14);
  assert.ok(continued.summary.frequency < 0.18);
});

test("position and sizing change preflop opening ranges", () => {
  const lj = updatePreflopRangeForAction(
    createUniformPreflopRange({ player: "villain:LJ", position: "LJ" }),
    { player: "villain:LJ", street: "preflop", type: "raise", amount: 3 },
    { position: "LJ" },
  );
  const btn = updatePreflopRangeForAction(
    createUniformPreflopRange({ player: "villain:BTN", position: "BTN" }),
    { player: "villain:BTN", street: "preflop", type: "raise", amount: 3 },
    { position: "BTN" },
  );
  const bigLJ = updatePreflopRangeForAction(
    createUniformPreflopRange({ player: "villain:LJ", position: "LJ" }),
    { player: "villain:LJ", street: "preflop", type: "raise", amount: 5 },
    { position: "LJ" },
  );

  assert.ok(lj.summary.frequency < btn.summary.frequency);
  assert.ok(bigLJ.summary.frequency < lj.summary.frequency);
});

test("preflop frequencies depend on table size", () => {
  const headsUpSmallBlind = targetFrequencyForAction(
    { player: "hero", street: "preflop", type: "raise", amount: 3 },
    { position: "SB", playerCount: 2 },
  );
  const sixMaxSmallBlind = targetFrequencyForAction(
    { player: "villain:SB", street: "preflop", type: "raise", amount: 3 },
    { position: "SB", playerCount: 6 },
  );
  const threeMaxButton = targetFrequencyForAction(
    { player: "villain:BTN", street: "preflop", type: "raise", amount: 3 },
    { position: "BTN", playerCount: 3 },
  );
  const sixMaxButton = targetFrequencyForAction(
    { player: "villain:BTN", street: "preflop", type: "raise", amount: 3 },
    { position: "BTN", playerCount: 6 },
  );

  assert.ok(headsUpSmallBlind > sixMaxSmallBlind);
  assert.ok(sixMaxButton > threeMaxButton);
});

test("range inference passes table size into action calibration", () => {
  const action = { id: "a1", player: "hero", street: "preflop", type: "raise", amount: 3 };
  const headsUp = inferPreflopRanges({
    tableConfig: { playerCount: 2, heroPosition: "SB", positions: ["SB", "BB"] },
    actions: [action],
  });
  const sixMax = inferPreflopRanges({
    tableConfig: { playerCount: 6, heroPosition: "SB", positions: ["LJ", "HJ", "CO", "BTN", "SB", "BB"] },
    actions: [action],
  });

  assert.ok(headsUp.hero.summary.frequency > sixMax.hero.summary.frequency);
});

test("strong hands retain far more weight than weak hands after LJ opens", () => {
  const opened = updatePreflopRangeForAction(
    createUniformPreflopRange({ player: "villain:LJ", position: "LJ" }),
    { player: "villain:LJ", street: "preflop", type: "raise", amount: 3 },
    { position: "LJ" },
  );
  const aa = averageClassWeight(opened, "1-1-pair");
  const kto = averageClassWeight(opened, preflopClassKeyForCards(card(2, 1), card(5, 2)));
  const trash = averageClassWeight(opened, preflopClassKeyForCards(card(12, 1), card(13, 2)));

  assert.ok(aa > 0.98);
  assert.ok(kto > trash);
  assert.ok(trash < 0.03);
});

test("preflop range inference collapses folded players and preserves actor ranges", () => {
  const ranges = inferPreflopRanges({
    tableConfig: { playerCount: 6, heroPosition: "CO", positions: ["LJ", "HJ", "CO", "BTN", "SB", "BB"] },
    actions: [
      { id: "a1", player: "villain:LJ", street: "preflop", type: "raise", amount: 3 },
      { id: "a2", player: "villain:HJ", street: "preflop", type: "fold" },
      { id: "a3", player: "hero", street: "preflop", type: "call", amount: 3 },
    ],
  });

  assert.ok(ranges["villain:LJ"].summary.frequency > 0.14);
  assert.equal(ranges["villain:HJ"].summary.frequency, 0);
  assert.equal(ranges["villain:HJ"].folded, true);
  assert.ok(ranges.hero.summary.frequency > 0);
  assert.ok(ranges.hero.summary.frequency < 1);
});

test("multiway equity samples weighted range combos", () => {
  const board = [card(6, 1), card(7, 2), card(8, 3), card(9, 4), card(10, 1)];
  const result = computeMultiwayAggregateEquities({
    participants: [
      { id: "hero", knownHoleCards: [card(2, 1), card(2, 2)] },
      {
        id: "villain:LJ",
        rangeCombos: [
          { cards: [card(1, 1), card(1, 2)], weight: 1 },
          { cards: [card(13, 3), card(12, 4)], weight: 0 },
        ],
      },
    ],
    knownBoard: board,
    deck: [
      card(1, 1),
      card(1, 2),
      card(12, 4),
      card(13, 3),
    ],
    evaluateGradationFive: (...cards) => cards.reduce((sum, comboCard) => sum + comboCard.rank, 0),
    nsims: 20,
    seed: 7,
  });

  assert.equal(result.exact, false);
  assert.equal(result.equities["villain:LJ"], 1);
  assert.equal(result.equities.hero, 0);
});

function averageClassWeight(range, classKey) {
  const matching = range.combos.filter((combo) => combo.classKey === classKey);
  return matching.reduce((sum, combo) => sum + combo.weight, 0) / matching.length;
}
