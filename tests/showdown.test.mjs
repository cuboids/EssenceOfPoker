import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createHandEvaluator } from "../dashboard/evaluation.mjs";
import { computeShowdownSettlement, formatChipAmount, sidePots } from "../dashboard/showdown.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_portfolio.json", import.meta.url), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("showdown settlement awards a heads-up pot to the best seven-card hand", () => {
  const settlement = computeShowdownSettlement({
    participants: [
      { id: "hero", label: "Hero", holeCards: [card(1, 1), card(2, 1)] },
      { id: "villain:BB", label: "Big blind", holeCards: [card(9, 2), card(10, 3)] },
    ],
    board: [card(3, 1), card(4, 1), card(5, 1), card(12, 2), card(13, 3)],
    actions: [
      { id: "a1", player: "hero", street: "preflop", type: "call", amount: 0.5 },
      { id: "a2", player: "villain:BB", street: "preflop", type: "check" },
      { id: "a3", player: "villain:BB", street: "river", type: "bet", amount: 4 },
      { id: "a4", player: "hero", street: "river", type: "call", amount: 4 },
    ],
    order: ["hero", "villain:BB"],
    stacks: { hero: 100, "villain:BB": 100 },
    smallBlindPlayer: "hero",
    bigBlindPlayer: "villain:BB",
    evaluateGradationFive: evaluator.evaluateGradationFive,
  });

  assert.equal(settlement.complete, true);
  assert.equal(settlement.potSize, 10);
  assert.equal(settlement.winners[0].id, "hero");
  assert.equal(settlement.rows.find((row) => row.id === "hero").winnings, 10);
  assert.equal(settlement.rows.find((row) => row.id === "villain:BB").net, -5);
});

test("showdown settlement splits tied pots", () => {
  const settlement = computeShowdownSettlement({
    participants: [
      { id: "hero", label: "Hero", holeCards: [card(9, 1), card(10, 2)] },
      { id: "villain:BB", label: "Big blind", holeCards: [card(11, 3), card(12, 4)] },
    ],
    board: [card(1, 1), card(2, 1), card(3, 1), card(4, 1), card(5, 1)],
    actions: [
      { id: "a1", player: "hero", street: "preflop", type: "call", amount: 0.5 },
      { id: "a2", player: "villain:BB", street: "preflop", type: "check" },
    ],
    order: ["hero", "villain:BB"],
    stacks: { hero: 100, "villain:BB": 100 },
    smallBlindPlayer: "hero",
    bigBlindPlayer: "villain:BB",
    evaluateGradationFive: evaluator.evaluateGradationFive,
  });

  assert.equal(settlement.complete, true);
  assert.equal(settlement.winners.length, 2);
  assert.equal(settlement.rows.find((row) => row.id === "hero").net, 0);
  assert.equal(settlement.rows.find((row) => row.id === "villain:BB").net, 0);
});

test("showdown side pots include folded contributions but award only eligible live players", () => {
  const pots = sidePots([
    { id: "hero", folded: false, contribution: 50 },
    { id: "villain:BTN", folded: true, contribution: 50 },
    { id: "villain:SB", folded: false, contribution: 20 },
  ]);

  assert.deepEqual(pots.map((pot) => [pot.amount, pot.contributorIds, pot.eligibleIds]), [
    [60, ["hero", "villain:BTN", "villain:SB"], ["hero", "villain:SB"]],
    [60, ["hero", "villain:BTN"], ["hero"]],
  ]);
});

test("showdown settlement reports incomplete when live cards are unknown", () => {
  const settlement = computeShowdownSettlement({
    participants: [
      { id: "hero", label: "Hero", holeCards: [card(1, 1), card(2, 1)] },
      { id: "villain:BB", label: "Big blind", holeCards: [] },
    ],
    board: [card(3, 1), card(4, 1), card(5, 1), card(12, 2), card(13, 3)],
    actions: [],
    order: ["hero", "villain:BB"],
    stacks: { hero: 100, "villain:BB": 100 },
    smallBlindPlayer: "hero",
    bigBlindPlayer: "villain:BB",
    evaluateGradationFive: evaluator.evaluateGradationFive,
  });

  assert.equal(settlement.complete, false);
  assert.match(settlement.reason, /not known/);
});

test("chip formatter is zero-safe and concise", () => {
  assert.equal(formatChipAmount(0), "0");
  assert.equal(formatChipAmount(1.25), "1.3");
  assert.equal(formatChipAmount(-4), "-4");
});
