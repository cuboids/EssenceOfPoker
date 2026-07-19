import assert from "node:assert/strict";
import fc from "fast-check";
import test from "node:test";

import {
  actionLabel,
  actionTagLabel,
  actionsVisibleThroughStreet,
  appendLegalPlayerAction,
  appendPlayerAction,
  actionsForStreet,
  bettingStateForStreet,
  bettingRoundIsClosed,
  deletePlayerAction,
  forcedBlindActionTags,
  actionablePlayersForStreet,
  legalActionPlan,
  livePlayersThroughStreet,
  nextActionPlayer,
  playerHasFoldedByStreet,
  playerIsAllInByStreet,
  upsertPlayerAction,
  validateActionSequence,
} from "../dashboard/player_actions.mjs";
import {
  bettingStateForStreet as potBettingStateForStreet,
  legalActionPlan as potLegalActionPlan,
} from "../dashboard/player_action_pot.mjs";
import {
  bettingRoundIsClosed as turnOrderBettingRoundIsClosed,
  nextActionPlayer as turnOrderNextActionPlayer,
} from "../dashboard/player_action_turn_order.mjs";

const sixMaxOrder = ["villain:LJ", "villain:HJ", "villain:CO", "villain:BTN", "villain:SB", "hero"];
const stacksFor = (order, stack = 100) => Object.fromEntries(order.map((player) => [player, stack]));
const legalityContext = (order = sixMaxOrder) => ({
  orderForStreet: () => order,
  stacks: stacksFor(order),
  smallBlindPlayer: "villain:SB",
  bigBlindPlayer: order.at(-1),
});

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

test("folded players are not live on later streets", () => {
  const order = ["villain:CO", "hero"];
  const actions = [
    { player: "villain:CO", street: "flop", type: "fold" },
  ];

  assert.deepEqual(livePlayersThroughStreet({ order, actions, street: "preflop" }), order);
  assert.deepEqual(livePlayersThroughStreet({ order, actions, street: "turn" }), ["hero"]);
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

test("forced blind tags are derived display actions", () => {
  const blinds = forcedBlindActionTags({
    smallBlindPlayer: "villain:SB",
    bigBlindPlayer: "hero",
  });

  assert.deepEqual(blinds.map((action) => action.type), ["small-blind", "big-blind"]);
  assert.ok(blinds.every((action) => action.forced));
  assert.equal(actionTagLabel(blinds[0], blinds), "posts SB 0.5");
  assert.equal(actionTagLabel(blinds[1], blinds), "posts BB 1");
  assert.equal(actionsForStreet(blinds, "preflop").length, 2);
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

  assert.equal(potBettingStateForStreet({
    actions: [],
    street: "preflop",
    order,
    stacks: Object.fromEntries(order.map((player) => [player, 100])),
    smallBlindPlayer: "villain:SB",
    bigBlindPlayer: "villain:BB",
  }).currentBet, state.currentBet);
  assert.deepEqual(potLegalActionPlan({ player: "villain:LJ", street: "preflop", state }), plan);
  assert.deepEqual(plan.actions, ["fold", "call", "raise", "all-in"]);
  assert.equal(plan.toCall, 1);
  assert.equal(plan.callAmount, 1);
  assert.equal(plan.minRaiseAmount, 2);
  assert.equal(plan.maxAmount, 100);
});

test("betting state is the authoritative pot and contribution model", () => {
  const order = ["villain:SB", "hero"];
  const actions = [
    { id: "a1", player: "villain:SB", street: "preflop", type: "raise", amount: 2.5 },
  ];
  const state = bettingStateForStreet({
    actions,
    street: "preflop",
    order,
    stacks: { "villain:SB": 100, hero: 100 },
    smallBlindPlayer: "villain:SB",
    bigBlindPlayer: "hero",
  });

  assert.equal(state.currentBet, 3);
  assert.equal(state.lastRaiseSize, 2);
  assert.equal(state.potSize, 4);
  assert.equal(state.totalInvested("villain:SB"), 3);
  assert.equal(state.totalInvested("hero"), 1);
  assert.equal(state.streetContribution("villain:SB"), 3);
  assert.equal(state.toCall("hero"), 2);
  assert.equal(state.minRaiseTo(), 5);
  assert.equal(state.minRaiseAmount("hero"), 4);
  assert.equal(state.remainingStack("villain:SB"), 97);
});

test("pot model carries prior-street investments into later streets", () => {
  const order = ["villain:SB", "hero"];
  const actions = [
    { id: "a1", player: "villain:SB", street: "preflop", type: "call", amount: 0.5 },
    { id: "a2", player: "hero", street: "preflop", type: "check" },
    { id: "a3", player: "hero", street: "flop", type: "bet", amount: 4 },
  ];
  const state = bettingStateForStreet({
    actions,
    street: "flop",
    order,
    stacks: { "villain:SB": 100, hero: 100 },
    smallBlindPlayer: "villain:SB",
    bigBlindPlayer: "hero",
  });

  assert.equal(state.potSize, 6);
  assert.equal(state.totalInvested("hero"), 5);
  assert.equal(state.totalInvested("villain:SB"), 1);
  assert.equal(state.streetContribution("hero"), 4);
  assert.equal(state.streetContribution("villain:SB"), 0);
  assert.equal(state.toCall("villain:SB"), 4);
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

test("postflop action returns to the original bettor after a raise and fold", () => {
  const order = ["villain:CO", "villain:BTN", "villain:SB", "villain:BB"];
  const stacks = Object.fromEntries(order.map((player) => [player, 100]));
  const actions = [
    { id: "a1", player: "villain:CO", street: "flop", type: "bet", amount: 5 },
    { id: "a2", player: "villain:BTN", street: "flop", type: "fold" },
    { id: "a3", player: "villain:SB", street: "flop", type: "raise", amount: 15 },
    { id: "a4", player: "villain:BB", street: "flop", type: "fold" },
  ];
  const state = bettingStateForStreet({
    actions,
    street: "flop",
    order,
    stacks,
    smallBlindPlayer: "villain:SB",
    bigBlindPlayer: "villain:BB",
  });

  assert.equal(nextActionPlayer({ order, actions, street: "flop" }), "villain:CO");
  assert.equal(state.toCall("villain:CO"), 10);
  assert.deepEqual(legalActionPlan({ player: "villain:CO", street: "flop", state }).actions, ["fold", "call", "raise", "all-in"]);
});

test("next action player follows street order and skips folders", () => {
  const order = ["villain:LJ", "villain:HJ", "villain:CO", "hero", "villain:SB", "villain:BB"];
  let actions = [];
  assert.equal(nextActionPlayer({ order, actions, street: "preflop" }), "villain:LJ");
  assert.equal(turnOrderNextActionPlayer({ order, actions, street: "preflop" }), "villain:LJ");

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
  assert.equal(turnOrderBettingRoundIsClosed({ order, actions, street: "preflop" }), true);
  assert.equal(nextActionPlayer({ order, actions, street: "preflop" }), null);
});

test("hero remains live after raise-call sequence even when surrounding villains fold", () => {
  const actions = [
    { id: "a1", player: "villain:LJ", street: "preflop", type: "fold" },
    { id: "a2", player: "hero", street: "preflop", type: "raise", amount: 3 },
    { id: "a3", player: "villain:CO", street: "preflop", type: "fold" },
    { id: "a4", player: "villain:BTN", street: "preflop", type: "fold" },
    { id: "a5", player: "villain:SB", street: "preflop", type: "raise", amount: 8 },
    { id: "a6", player: "villain:BB", street: "preflop", type: "fold" },
    { id: "a7", player: "hero", street: "preflop", type: "call", amount: 5 },
  ];

  assert.equal(playerHasFoldedByStreet(actions, "hero", "preflop"), false);
  assert.equal(playerHasFoldedByStreet(actions, "villain:LJ", "preflop"), true);
  assert.equal(playerHasFoldedByStreet(actions, "villain:CO", "preflop"), true);
  assert.equal(playerHasFoldedByStreet(actions, "villain:BTN", "preflop"), true);
  assert.equal(playerHasFoldedByStreet(actions, "villain:BB", "preflop"), true);
  assert.deepEqual(
    livePlayersThroughStreet({
      order: ["villain:LJ", "hero", "villain:CO", "villain:BTN", "villain:SB", "villain:BB"],
      actions,
      street: "preflop",
    }),
    ["hero", "villain:SB"],
  );
});

test("formal action validator accepts a complete legal preflop sequence", () => {
  const actions = [
    { id: "a1", player: "villain:LJ", street: "preflop", type: "raise", amount: 3 },
    { id: "a2", player: "villain:HJ", street: "preflop", type: "fold" },
    { id: "a3", player: "villain:CO", street: "preflop", type: "fold" },
    { id: "a4", player: "villain:BTN", street: "preflop", type: "fold" },
    { id: "a5", player: "villain:SB", street: "preflop", type: "fold" },
    { id: "a6", player: "hero", street: "preflop", type: "call", amount: 2 },
  ];

  assert.equal(validateActionSequence(actions, legalityContext()), true);
});

test("formal action validator rejects out-of-turn and impossible action tags", () => {
  assert.throws(
    () => validateActionSequence([
      { id: "a1", player: "villain:CO", street: "preflop", type: "fold" },
    ], legalityContext()),
    /expected villain:LJ/,
  );
  assert.throws(
    () => validateActionSequence([
      { id: "a1", player: "villain:LJ", street: "preflop", type: "check" },
    ], legalityContext()),
    /check is not legal/,
  );
  assert.throws(
    () => validateActionSequence([
      { id: "a1", player: "villain:LJ", street: "preflop", type: "raise", amount: 3 },
      { id: "a2", player: "villain:HJ", street: "preflop", type: "call", amount: 1 },
    ], legalityContext()),
    /call amount must be 3/,
  );
});

test("appendLegalPlayerAction is a legality gate for UI callers", () => {
  let actions = [];
  actions = appendLegalPlayerAction(actions, { player: "villain:LJ", street: "preflop", type: "fold" }, legalityContext());
  assert.equal(actions[0].id, "a1");

  assert.throws(
    () => appendLegalPlayerAction(actions, { player: "villain:CO", street: "preflop", type: "fold" }, legalityContext()),
    /expected villain:HJ/,
  );
});

test("heads-up preflop small blind call gives big blind the option", () => {
  const order = ["villain:SB", "hero"];
  const actions = [
    { id: "a1", player: "villain:SB", street: "preflop", type: "call", amount: 0.5 },
  ];
  const context = {
    orderForStreet: () => order,
    stacks: stacksFor(order),
    smallBlindPlayer: "villain:SB",
    bigBlindPlayer: "hero",
  };

  assert.equal(validateActionSequence(actions, context), true);
  assert.equal(nextActionPlayer({
    order,
    actions,
    street: "preflop",
  }), "hero");

  const closed = [...actions, { id: "a2", player: "hero", street: "preflop", type: "check" }];
  assert.equal(validateActionSequence(closed, context), true);
  assert.equal(bettingRoundIsClosed({ order, actions: closed, street: "preflop" }), true);
});

test("heads-up postflop big blind acts first and two checks close the street", () => {
  const order = ["hero", "villain:SB"];
  const actions = [
    { id: "a1", player: "hero", street: "flop", type: "check" },
    { id: "a2", player: "villain:SB", street: "flop", type: "check" },
  ];

  assert.equal(validateActionSequence(actions, {
    orderForStreet: () => order,
    stacks: stacksFor(order),
    smallBlindPlayer: "villain:SB",
    bigBlindPlayer: "hero",
  }), true);
  assert.equal(bettingRoundIsClosed({ order, actions, street: "flop" }), true);
  assert.equal(nextActionPlayer({ order, actions, street: "flop" }), null);
});

test("all-in actors are skipped only after the next live player receives action", () => {
  const order = ["villain:CO", "villain:BTN", "hero"];
  const stacks = stacksFor(order, 100);
  const actions = [
    { id: "a1", player: "villain:CO", street: "flop", type: "all-in", amount: 100 },
  ];

  assert.equal(nextActionPlayer({
    order,
    actions,
    street: "flop",
    canAct: (player) => {
      const state = bettingStateForStreet({
        actions,
        street: "flop",
        order,
        stacks,
        smallBlindPlayer: null,
        bigBlindPlayer: null,
      });
      return state.remainingStack(player) > 0;
    },
  }), "villain:BTN");
});

test("all-in players remain live but stop being actionable", () => {
  const order = ["villain:CO", "villain:BTN", "hero"];
  const stacks = stacksFor(order, 10);
  const actions = [
    { id: "a1", player: "villain:CO", street: "flop", type: "all-in", amount: 10 },
  ];
  const context = {
    order,
    actions,
    street: "flop",
    stacks,
    smallBlindPlayer: null,
    bigBlindPlayer: null,
  };

  assert.equal(playerIsAllInByStreet({ ...context, player: "villain:CO" }), true);
  assert.deepEqual(livePlayersThroughStreet({ order, actions, street: "flop" }), order);
  assert.deepEqual(actionablePlayersForStreet(context), ["villain:BTN", "hero"]);
});

test("short all-in does not reopen raising to a player who already acted", () => {
  const order = ["villain:CO", "villain:BTN", "hero"];
  const stacks = { "villain:CO": 100, "villain:BTN": 15, hero: 100 };
  const actions = [
    { id: "a1", player: "villain:CO", street: "flop", type: "bet", amount: 10 },
    { id: "a2", player: "villain:BTN", street: "flop", type: "all-in", amount: 15 },
    { id: "a3", player: "hero", street: "flop", type: "call", amount: 15 },
  ];
  const state = bettingStateForStreet({
    actions,
    street: "flop",
    order,
    stacks,
    smallBlindPlayer: null,
    bigBlindPlayer: null,
  });

  assert.equal(nextActionPlayer({ order, actions, street: "flop" }), "villain:CO");
  assert.equal(state.toCall("villain:CO"), 5);
  assert.equal(state.canRaise("villain:CO"), false);
  assert.deepEqual(legalActionPlan({ player: "villain:CO", street: "flop", state }).actions, ["fold", "call"]);
});

test("cumulative short all-ins reopen betting once they equal a full raise", () => {
  const order = ["villain:CO", "villain:BTN", "villain:SB", "hero"];
  const stacks = { "villain:CO": 100, "villain:BTN": 12.5, "villain:SB": 20, hero: 100 };
  const actions = [
    { id: "a1", player: "villain:CO", street: "flop", type: "bet", amount: 10 },
    { id: "a2", player: "villain:BTN", street: "flop", type: "all-in", amount: 12.5 },
    { id: "a3", player: "villain:SB", street: "flop", type: "all-in", amount: 20 },
    { id: "a4", player: "hero", street: "flop", type: "call", amount: 20 },
  ];
  const state = bettingStateForStreet({
    actions,
    street: "flop",
    order,
    stacks,
    smallBlindPlayer: null,
    bigBlindPlayer: null,
  });

  assert.equal(state.toCall("villain:CO"), 10);
  assert.equal(state.canRaise("villain:CO"), true);
  assert.deepEqual(legalActionPlan({ player: "villain:CO", street: "flop", state }).actions, ["fold", "call", "raise", "all-in"]);
});

test("short all-in is legal as all-in but not as a raise", () => {
  const order = ["villain:CO", "hero"];
  const stacks = { "villain:CO": 100, hero: 14 };
  const context = {
    orderForStreet: () => order,
    stacks,
    smallBlindPlayer: null,
    bigBlindPlayer: null,
  };

  assert.equal(validateActionSequence([
    { id: "a1", player: "villain:CO", street: "flop", type: "bet", amount: 10 },
    { id: "a2", player: "hero", street: "flop", type: "all-in", amount: 14 },
  ], context), true);
  assert.throws(
    () => validateActionSequence([
      { id: "a1", player: "villain:CO", street: "flop", type: "bet", amount: 10 },
      { id: "a2", player: "hero", street: "flop", type: "raise", amount: 14 },
    ], context),
    /raise is not legal/,
  );
});

test("short all-in opener is all-in rather than a bet below the minimum", () => {
  const order = ["villain:CO", "hero"];
  const stacks = { "villain:CO": 0.7, hero: 100 };
  const state = bettingStateForStreet({
    actions: [],
    street: "flop",
    order,
    stacks,
    smallBlindPlayer: null,
    bigBlindPlayer: null,
  });

  assert.deepEqual(legalActionPlan({ player: "villain:CO", street: "flop", state }).actions, ["check", "all-in"]);
  assert.equal(validateActionSequence([
    { id: "a1", player: "villain:CO", street: "flop", type: "all-in", amount: 0.7 },
  ], {
    orderForStreet: () => order,
    stacks,
    smallBlindPlayer: null,
    bigBlindPlayer: null,
  }), true);
  assert.throws(
    () => validateActionSequence([
      { id: "a1", player: "villain:CO", street: "flop", type: "bet", amount: 0.7 },
    ], {
      orderForStreet: () => order,
      stacks,
      smallBlindPlayer: null,
      bigBlindPlayer: null,
    }),
    /bet is not legal/,
  );
});

test("multiway limped preflop pot closes after big blind checks", () => {
  const actions = [
    { id: "a1", player: "villain:LJ", street: "preflop", type: "call", amount: 1 },
    { id: "a2", player: "villain:HJ", street: "preflop", type: "call", amount: 1 },
    { id: "a3", player: "villain:CO", street: "preflop", type: "call", amount: 1 },
    { id: "a4", player: "villain:BTN", street: "preflop", type: "call", amount: 1 },
    { id: "a5", player: "villain:SB", street: "preflop", type: "call", amount: 0.5 },
    { id: "a6", player: "hero", street: "preflop", type: "check" },
  ];

  assert.equal(validateActionSequence(actions, legalityContext()), true);
  assert.equal(bettingRoundIsClosed({ order: sixMaxOrder, actions, street: "preflop" }), true);
  assert.equal(nextActionPlayer({ order: sixMaxOrder, actions, street: "preflop" }), null);
});

test("formal validator rejects extra actions after a street has closed", () => {
  const actions = [
    { id: "a1", player: "villain:SB", street: "preflop", type: "call", amount: 0.5 },
    { id: "a2", player: "hero", street: "preflop", type: "check" },
    { id: "a3", player: "villain:SB", street: "preflop", type: "raise", amount: 6 },
  ];
  const order = ["villain:SB", "hero"];

  assert.throws(
    () => validateActionSequence(actions, {
      orderForStreet: () => order,
      stacks: stacksFor(order),
      smallBlindPlayer: "villain:SB",
      bigBlindPlayer: "hero",
    }),
    /already closed/,
  );
});

test("property: legally generated betting prefixes remain formally valid", () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 32 }), (choices) => {
      const order = ["LJ", "HJ", "CO", "BTN", "SB", "BB"];
      const context = {
        orderForStreet: () => order,
        stacks: Object.fromEntries(order.map((player) => [player, 100])),
        smallBlindPlayer: "SB",
        bigBlindPlayer: "BB",
        smallBlind: 0.5,
        bigBlind: 1,
      };
      let actions = [];
      for (const choice of choices) {
        const state = bettingStateForStreet({
          actions,
          street: "preflop",
          order,
          stacks: context.stacks,
          smallBlindPlayer: "SB",
          bigBlindPlayer: "BB",
        });
        if (bettingRoundIsClosed({
          order,
          actions,
          street: "preflop",
          canAct: (player) => state.remainingStack(player) > 0,
        })) {
          break;
        }
        const actor = nextActionPlayer({
          order,
          actions,
          street: "preflop",
          canAct: (player) => state.remainingStack(player) > 0,
        });
        if (!actor) {
          break;
        }
        const plan = legalActionPlan({ player: actor, street: "preflop", state });
        const type = plan.actions[choice % plan.actions.length];
        const nextAction = actionFromPlan(actor, type, plan);
        actions = appendLegalPlayerAction(actions, nextAction, context);
        assert.equal(validateActionSequence(actions, context), true);
      }
    }),
    { numRuns: 100 },
  );
});

function actionFromPlan(player, type, plan) {
  if (type === "fold" || type === "check") {
    return { player, street: "preflop", type };
  }
  if (type === "call") {
    return { player, street: "preflop", type, amount: plan.callAmount };
  }
  if (type === "all-in") {
    return { player, street: "preflop", type, amount: plan.maxAmount };
  }
  return {
    player,
    street: "preflop",
    type,
    amount: type === "bet" ? plan.minBet : plan.minRaiseAmount,
  };
}
