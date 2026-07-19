import assert from "node:assert/strict";
import test from "node:test";

import {
  actionLabel,
  actionTagLabel,
  actionsVisibleThroughStreet,
  appendPlayerAction,
  actionsForStreet,
  bettingStateForStreet,
  bettingRoundIsClosed,
  deletePlayerAction,
  legalActionPlan,
  nextActionPlayer,
  playerHasFoldedByStreet,
  upsertPlayerAction,
} from "../dashboard/player_actions.mjs";

test("player actions append into a deletable linear history", () => {
  let actions = [];
  actions = appendPlayerAction(actions, { player: "villain:BB", street: "preflop", type: "raise", amount: 3 });
  actions = appendPlayerAction(actions, { player: "hero", street: "preflop", type: "call", amount: 3 });
  actions = appendPlayerAction(actions, { player: "villain:BB", street: "flop", type: "bet", amount: 5 });

  assert.equal(actions.length, 3);
  assert.deepEqual(actions[0], {
    id: "a1",
    player: "villain:BB",
    street: "preflop",
    type: "raise",
    amount: 3,
  });
  assert.equal(actionsForStreet(actions, "preflop").length, 2);
  assert.deepEqual(actionsVisibleThroughStreet(actions, "preflop").map((action) => action.id), ["a1", "a2"]);
  assert.deepEqual(actionsVisibleThroughStreet(actions, "flop").map((action) => action.id), ["a1", "a2", "a3"]);
  assert.deepEqual(deletePlayerAction(actions, "a2").map((action) => action.id), ["a1", "a3"]);
});

test("upsert remains available for state-like callers", () => {
  let actions = [];
  actions = upsertPlayerAction(actions, { player: "hero", street: "preflop", type: "call" });
  actions = upsertPlayerAction(actions, { player: "hero", street: "preflop", type: "check" });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "check");
});

test("fold actions make a player folded from that street onward", () => {
  const actions = [
    { player: "villain:CO", street: "flop", type: "fold" },
  ];

  assert.equal(playerHasFoldedByStreet(actions, "villain:CO", "preflop"), false);
  assert.equal(playerHasFoldedByStreet(actions, "villain:CO", "flop"), true);
  assert.equal(playerHasFoldedByStreet(actions, "villain:CO", "turn"), true);
  assert.equal(playerHasFoldedByStreet(actions, "villain:CO", "river"), true);
});

test("sized actions require a positive amount and format labels", () => {
  assert.equal(actionLabel({ player: "hero", street: "turn", type: "raise", amount: 12.5 }), "raise 12.5");
  assert.throws(
    () => upsertPlayerAction([], { player: "hero", street: "turn", type: "raise", amount: 0 }),
    /amount/,
  );
  assert.throws(
    () => upsertPlayerAction([], { player: "hero", street: "showdown", type: "call" }),
    /street/,
  );
});

test("street action tags describe aggressive sequence naturally", () => {
  const streetActions = [
    { id: "a1", player: "villain:BB", street: "flop", type: "bet", amount: 5 },
    { id: "a2", player: "hero", street: "flop", type: "raise", amount: 15 },
    { id: "a3", player: "villain:BB", street: "flop", type: "raise", amount: 30 },
    { id: "a4", player: "hero", street: "flop", type: "call" },
  ];

  assert.equal(actionTagLabel(streetActions[0], streetActions), "bets");
  assert.equal(actionTagLabel(streetActions[1], streetActions), "raises");
  assert.equal(actionTagLabel(streetActions[2], streetActions), "4bets");
  assert.equal(actionTagLabel(streetActions[3], streetActions), "call");
});

test("betting state makes preflop checking illegal and caps sizes by stack", () => {
  const order = ["villain:LJ", "villain:HJ", "villain:CO", "hero", "villain:SB", "villain:BB"];
  const state = bettingStateForStreet({
    actions: [],
    street: "preflop",
    order,
    stacks: Object.fromEntries(order.map((player) => [player, 100])),
    smallBlindPlayer: "villain:SB",
    bigBlindPlayer: "villain:BB",
  });
  const plan = legalActionPlan({ player: "villain:LJ", street: "preflop", state });

  assert.deepEqual(plan.actions, ["fold", "call", "raise", "all-in"]);
  assert.equal(plan.toCall, 1);
  assert.equal(plan.callAmount, 1);
  assert.equal(plan.minRaiseAmount, 2);
  assert.equal(plan.maxAmount, 100);
});

test("postflop first action can check or bet, then later players face a call", () => {
  const order = ["villain:SB", "villain:BB", "hero"];
  let actions = [];
  let state = bettingStateForStreet({
    actions,
    street: "flop",
    order,
    stacks: { "villain:SB": 100, "villain:BB": 100, hero: 100 },
    smallBlindPlayer: "villain:SB",
    bigBlindPlayer: "villain:BB",
  });
  assert.deepEqual(legalActionPlan({ player: "villain:SB", street: "flop", state }).actions, ["check", "bet", "all-in"]);

  actions = appendPlayerAction(actions, { player: "villain:SB", street: "flop", type: "bet", amount: 5 });
  state = bettingStateForStreet({
    actions,
    street: "flop",
    order,
    stacks: { "villain:SB": 100, "villain:BB": 100, hero: 100 },
    smallBlindPlayer: "villain:SB",
    bigBlindPlayer: "villain:BB",
  });
  assert.deepEqual(legalActionPlan({ player: "villain:BB", street: "flop", state }).actions, ["fold", "call", "raise", "all-in"]);
  assert.equal(state.toCall("villain:BB"), 5);
});

test("next action player follows street order and skips folders", () => {
  const order = ["villain:LJ", "villain:HJ", "villain:CO", "hero", "villain:SB", "villain:BB"];
  let actions = [];
  assert.equal(nextActionPlayer({ order, actions, street: "preflop" }), "villain:LJ");

  actions = appendPlayerAction(actions, { player: "villain:LJ", street: "preflop", type: "fold" });
  assert.equal(nextActionPlayer({ order, actions, street: "preflop" }), "villain:HJ");

  actions = appendPlayerAction(actions, { player: "villain:HJ", street: "preflop", type: "call" });
  assert.equal(nextActionPlayer({ order, actions, street: "preflop" }), "villain:CO");

  assert.equal(
    nextActionPlayer({
      order,
      actions,
      street: "preflop",
      foldedBeforeStreet: (player) => player === "villain:CO",
    }),
    "hero",
  );
});

test("next action player returns null once only one player remains", () => {
  const order = ["hero", "villain:BB"];
  const actions = appendPlayerAction([], { player: "hero", street: "river", type: "fold" });

  assert.equal(nextActionPlayer({ order, actions, street: "river" }), null);
});

test("preflop action closes after open, folds, and big blind call", () => {
  const order = ["villain:LJ", "villain:HJ", "villain:CO", "villain:BTN", "villain:SB", "hero"];
  const actions = [
    { id: "a1", player: "villain:LJ", street: "preflop", type: "raise", amount: 3 },
    { id: "a2", player: "villain:HJ", street: "preflop", type: "fold" },
    { id: "a3", player: "villain:CO", street: "preflop", type: "fold" },
    { id: "a4", player: "villain:BTN", street: "preflop", type: "fold" },
    { id: "a5", player: "villain:SB", street: "preflop", type: "fold" },
    { id: "a6", player: "hero", street: "preflop", type: "call", amount: 2 },
  ];

  assert.equal(bettingRoundIsClosed({ order, actions, street: "preflop" }), true);
  assert.equal(nextActionPlayer({ order, actions, street: "preflop" }), null);
});
