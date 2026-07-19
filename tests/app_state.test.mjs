import assert from "node:assert/strict";
import test from "node:test";

import { HAND_PHASES } from "../dashboard/hand_state.mjs";
import { createAppState, initializeHandState, resetComputedState } from "../dashboard/app_state.mjs";

test("app state groups runtime data into explicit ownership buckets", () => {
  const storage = new Map([
    ["essence-theme", "dark"],
    ["essence-hide-inactive-assets", "true"],
    ["essence-folded-villains", "[\"BB\"]"],
    ["essence-player-stacks", "{\"SB\":40,\"BB\":120}"],
  ]);
  const state = initializeHandState(createAppState({
    assetVersion: "test-version",
    localStorageRef: { getItem: (key) => storage.get(key) ?? null },
  }));

  assert.equal(state.assetVersion, "test-version");
  assert.equal(state.hand.model.phase, HAND_PHASES.EMPTY);
  assert.equal(state.hand.legacy, null);
  assert.equal(state.hand.villainShowdown, false);
  assert.deepEqual(state.data.preflopAggregateClasses, {});
  assert.deepEqual(state.computed.curves, {});
  assert.equal(state.ui.activePage, "hero");
  assert.equal(state.ui.chartMode, "bell");
  assert.equal(state.ui.useDarkTheme, true);
  assert.equal(state.ui.hideInactiveAssets, true);
  assert.deepEqual(state.ui.tableConfig, {
    playerCount: 2,
    heroPosition: null,
    foldedVillainPositions: [],
    playerStacks: { SB: 40, BB: 120 },
  });

  const fallbackState = createAppState({
    assetVersion: "test-version",
    localStorageRef: { getItem: (key) => (key === "essence-player-stacks" ? "not-json" : null) },
  });
  assert.deepEqual(fallbackState.ui.tableConfig.playerStacks, {});
});

test("resetComputedState clears computed curves and bumps invalidation token", () => {
  const state = initializeHandState(createAppState({ assetVersion: "test-version", localStorageRef: null }));
  state.computed.curves = { hero: { "1.1": {} } };
  state.computed.winShares = { hero: { shares: {} } };

  resetComputedState(state);

  assert.deepEqual(state.computed.curves, {});
  assert.deepEqual(state.computed.winShares, {});
  assert.equal(state.computed.curveToken, 1);
});
