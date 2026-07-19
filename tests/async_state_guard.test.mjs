import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAsyncSnapshotKey,
  createAsyncStateGuard,
} from "../dashboard/async_state_guard.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

function baseSnapshot(overrides = {}) {
  return {
    assetVersion: "test-version",
    purpose: "aggregate-equities",
    page: "hero",
    handModel: {
      phase: "flop",
      villain: [card(8, 3), card(9, 4)],
    },
    handState: {
      round: "flop",
      h1: card(2, 1),
      h2: card(5, 2),
      flop: [card(1, 1), card(7, 2), card(7, 3)],
      turn: null,
      river: null,
    },
    viewedStreetIndex: 1,
    viewedActionCount: 2,
    visibleActions: [
      { id: "a1", player: "hero", street: "preflop", type: "call", amount: 1 },
      { id: "a2", player: "hero", street: "flop", type: "check" },
    ],
    tableConfig: {
      playerCount: 6,
      heroPosition: "BTN",
      positions: ["LJ", "HJ", "CO", "BTN", "SB", "BB"],
      playerStacks: { BTN: 100, SB: 100, BB: 100 },
    },
    activeVillains: ["villain:SB", "villain:BB"],
    villainShowdown: false,
    showdownHoleCardsByPlayer: {},
    ...overrides,
  };
}

test("async snapshot keys change when cards, actions, or table context changes", () => {
  const key = buildAsyncSnapshotKey(baseSnapshot());

  assert.notEqual(key, buildAsyncSnapshotKey(baseSnapshot({
    handState: { ...baseSnapshot().handState, flop: [card(1, 1), card(7, 2), card(8, 2)] },
  })));
  assert.notEqual(key, buildAsyncSnapshotKey(baseSnapshot({
    visibleActions: [...baseSnapshot().visibleActions, { id: "a3", player: "villain:SB", street: "flop", type: "bet", amount: 4 }],
  })));
  assert.notEqual(key, buildAsyncSnapshotKey(baseSnapshot({
    tableConfig: { ...baseSnapshot().tableConfig, playerCount: 5 },
  })));
  assert.notEqual(key, buildAsyncSnapshotKey(baseSnapshot({
    page: "villain:SB",
  })));
});

test("async snapshot keys are stable under object insertion order", () => {
  const first = buildAsyncSnapshotKey(baseSnapshot({
    tableConfig: {
      playerStacks: { BB: 100, SB: 100, BTN: 100 },
      positions: ["LJ", "HJ", "CO", "BTN", "SB", "BB"],
      heroPosition: "BTN",
      playerCount: 6,
    },
  }));
  const second = buildAsyncSnapshotKey(baseSnapshot({
    tableConfig: {
      heroPosition: "BTN",
      playerCount: 6,
      positions: ["LJ", "HJ", "CO", "BTN", "SB", "BB"],
      playerStacks: { BTN: 100, SB: 100, BB: 100 },
    },
  }));

  assert.equal(first, second);
});

test("async guard requires both token and snapshot identity to remain current", () => {
  let token = 7;
  let key = "snapshot-a";
  const guard = createAsyncStateGuard({
    captureToken: token,
    captureKey: key,
    currentToken: () => token,
    currentKey: () => key,
  });

  assert.equal(guard.isCurrent(), true);
  key = "snapshot-b";
  assert.equal(guard.isCurrent(), false);
  key = "snapshot-a";
  token += 1;
  assert.equal(guard.isCurrent(), false);
});
