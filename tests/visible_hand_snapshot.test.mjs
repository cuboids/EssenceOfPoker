import assert from "node:assert/strict";
import test from "node:test";

import * as HandModel from "../dashboard/hand_state.mjs";
import {
  actionCountBeforeStreet,
  actionCountsForStreet,
  actionCountThroughStreet,
  actionMomentCacheKey,
  navigationMomentsForTimeline,
  resolveVisibleHandSnapshot,
  visibleActionsForStreet,
  visibleHandSnapshotForMoment,
} from "../dashboard/visible_hand_snapshot.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

function snapshotForModel(handModel, extras = {}) {
  return {
    handModel,
    currentCurves: extras.currentCurves || {},
    currentWinShares: extras.currentWinShares || {},
    playerActions: extras.playerActions || [],
    showdownHoleCardsByPlayer: extras.showdownHoleCardsByPlayer || {},
  };
}

test("visible snapshot derives action prefixes and latest moment from one state object", () => {
  const preflop = HandModel.startPreflopModel([card(2, 1), card(5, 2)], [card(8, 3), card(9, 4)]);
  const flop = HandModel.dealFlopModel(preflop, [card(1, 1), card(7, 2), card(7, 3)]);
  const actions = [
    { id: "a1", player: "hero", street: "preflop", type: "call", amount: 1 },
    { id: "a2", player: "hero", street: "flop", type: "check" },
    { id: "a3", player: "villain:BB", street: "flop", type: "bet", amount: 2 },
  ];
  const timeline = [
    snapshotForModel(preflop, { playerActions: actions }),
    snapshotForModel(flop, { playerActions: actions }),
  ];

  assert.equal(actionCountBeforeStreet(actions, "flop"), 1);
  assert.equal(actionCountThroughStreet(actions, "flop"), 3);
  assert.deepEqual(actionCountsForStreet(actions, "flop"), [1, 2, 3]);
  assert.deepEqual(navigationMomentsForTimeline(timeline, actions), [
    { streetIndex: 0, actionCount: 0 },
    { streetIndex: 0, actionCount: 1 },
    { streetIndex: 1, actionCount: 1 },
    { streetIndex: 1, actionCount: 2 },
    { streetIndex: 1, actionCount: 3 },
  ]);

  const snapshot = resolveVisibleHandSnapshot({
    handModel: flop,
    handTimeline: timeline,
    viewedStreetIndex: 1,
    viewedActionCount: null,
    playerActions: actions,
  });

  assert.equal(snapshot.currentActionStreet, "flop");
  assert.equal(snapshot.viewedActionCount, 3);
  assert.equal(snapshot.currentNavigationMomentIndex, 4);
  assert.equal(snapshot.isViewingLatestMoment, true);
  assert.deepEqual(snapshot.visiblePlayerActions.map((action) => action.id), ["a1", "a2", "a3"]);
});

test("visible snapshot can restore a cached action moment without borrowing latest street caches", () => {
  const preflop = HandModel.startPreflopModel([card(2, 1), card(5, 2)], [card(8, 3), card(9, 4)]);
  const flop = HandModel.dealFlopModel(preflop, [card(1, 1), card(7, 2), card(7, 3)]);
  const actions = [
    { id: "a1", player: "hero", street: "preflop", type: "call", amount: 1 },
    { id: "a2", player: "hero", street: "flop", type: "check" },
    { id: "a3", player: "villain:BB", street: "flop", type: "bet", amount: 2 },
  ];
  const timeline = [
    snapshotForModel(preflop, { playerActions: actions }),
    snapshotForModel(flop, {
      playerActions: actions,
      currentCurves: { hero: { latestOnly: true } },
      currentWinShares: { hero: { latestOnly: true } },
    }),
  ];
  const cache = new Map([
    [actionMomentCacheKey({ streetIndex: 1, actionCount: 2 }), {
      currentCurves: { hero: { cachedMoment: true } },
      currentWinShares: { hero: { shares: { cachedMoment: 1 } } },
    }],
  ]);

  const restored = visibleHandSnapshotForMoment({
    handTimeline: timeline,
    moment: { streetIndex: 1, actionCount: 2 },
    playerActions: actions,
    actionMomentCache: cache,
  });

  assert.equal(restored.isViewingLatestMoment, false);
  assert.deepEqual(restored.visiblePlayerActions.map((action) => action.id), ["a1", "a2"]);
  assert.deepEqual(restored.currentCurves, { hero: { cachedMoment: true } });
  assert.deepEqual(restored.currentWinShares, { hero: { shares: { cachedMoment: 1 } } });

  const uncached = visibleHandSnapshotForMoment({
    handTimeline: timeline,
    moment: { streetIndex: 1, actionCount: 1 },
    playerActions: actions,
    actionMomentCache: cache,
  });
  assert.deepEqual(uncached.currentCurves, {});
  assert.deepEqual(uncached.currentWinShares, {});
});

test("visible action helpers return defensive action copies", () => {
  const preflop = HandModel.startPreflopModel([card(2, 1), card(5, 2)], [card(8, 3), card(9, 4)]);
  const actions = [{ id: "a1", player: "hero", street: "preflop", type: "call", amount: 1 }];
  const snapshot = resolveVisibleHandSnapshot({
    handModel: preflop,
    handTimeline: [snapshotForModel(preflop, { playerActions: actions })],
    viewedStreetIndex: 0,
    viewedActionCount: 1,
    playerActions: actions,
  });

  const visible = visibleActionsForStreet(snapshot, "preflop");
  visible[0].type = "fold";

  assert.equal(snapshot.visiblePlayerActions[0].type, "call");
  assert.equal(actions[0].type, "call");
});
