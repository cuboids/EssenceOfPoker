import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmpiricalSpotStore,
  empiricalSpotCacheKey,
  empiricalStatusLabel,
} from "../dashboard/stores/empirical_spot_store.mjs";

test("empirical spot store tracks health, loading, ready, and miss states", async () => {
  const loadedKeys = [];
  let loadingChanges = 0;
  let updates = 0;
  const store = createEmpiricalSpotStore({
    readHealth: async () => ({ data: { empiricalCalibration: { ok: true, hands: 10, actions: 20 } } }),
    readSpot: async (request) => {
      loadedKeys.push(empiricalSpotCacheKey(request));
      return request.position === "BTN" ? { ok: true, request, source: { actions: 99 }, handClasses: {} } : null;
    },
    requestForAction: (action) => ({
      street: action.street,
      position: action.position,
      playerCount: 6,
      stakeBucket: "micro",
      yearBucket: "2019+",
      facingAggression: false,
      amountBucket: "medium",
    }),
    onLoadingChange: () => { loadingChanges += 1; },
    onUpdated: () => { updates += 1; },
  });
  const actions = [
    { id: "a1", street: "preflop", position: "BTN" },
    { id: "a2", street: "preflop", position: "SB" },
  ];

  await store.hydrateHealth();
  assert.equal(store.status(actions), "pending");
  assert.equal(store.ensureForActions(actions), true);
  assert.equal(store.isLoading(), true);
  assert.equal(loadingChanges, 1);

  await nextTick();

  assert.equal(store.isLoading(), false);
  assert.equal(updates, 2);
  assert.equal(loadedKeys.length, 2);
  assert.equal(store.status(actions), "fallback");
  assert.deepEqual(store.summary(actions).reasons, { missing: 1 });
  assert.equal(store.evidenceForAction(actions[0]).status, "ready");
  assert.equal(store.evidenceForAction(actions[1]).status, "fallback");
  assert.equal(store.evidenceForAction(actions[1]).reason, "missing");
  assert.deepEqual(Object.keys(store.spotsForActions(actions)), ["a1"]);
  assert.equal(store.ensureForActions(actions), false);
});

test("empirical spot store preserves typed unavailable reasons", async () => {
  const action = { id: "a1", street: "preflop", position: "BTN" };
  const store = createEmpiricalSpotStore({
    readHealth: async () => ({ data: { empiricalCalibration: { ok: true } } }),
    readSpot: async () => ({ ok: false, status: 200, reason: "validation", error: "bad model" }),
    requestForAction: () => ({
      street: "preflop",
      position: "BTN",
      playerCount: 6,
      stakeBucket: "micro",
      yearBucket: "2019+",
      facingAggression: false,
      amountBucket: "medium",
    }),
  });

  await store.hydrateHealth();
  store.ensureForActions([action]);
  await nextTick();

  const evidence = store.evidenceForAction(action);
  assert.equal(evidence.status, "fallback");
  assert.equal(evidence.reason, "incompatible");
  assert.equal(evidence.error, "bad model");
  assert.deepEqual(store.summary([action]).reasons, { incompatible: 1 });
});

test("empirical range evidence resolves from action history and visible spot cache", async () => {
  const action = { id: "a1", street: "flop", position: "CO" };
  const store = createEmpiricalSpotStore({
    readSpot: async (request) => ({ ok: true, request, source: { actions: 12 }, handClasses: {} }),
    requestForAction: () => ({
      street: "flop",
      position: "CO",
      playerCount: 4,
      stakeBucket: "micro",
      yearBucket: "2019+",
      facingAggression: true,
      amountBucket: "large",
    }),
  });

  assert.equal(store.evidenceForRange({ history: [] }, [action]).status, "fallback");
  store.ensureForActions([action]);
  assert.equal(store.evidenceForRange({ history: [{ empirical: true, action }] }, [action]).status, "pending");

  await nextTick();

  const evidence = store.evidenceForRange({ history: [{ empirical: true, action }] }, [action]);
  assert.equal(evidence.status, "ready");
  assert.equal(evidence.payload.source.actions, 12);
});

test("empirical spot key and labels are stable", () => {
  assert.equal(empiricalSpotCacheKey({
    street: "turn",
    position: "HJ",
    playerCount: 5,
    stakeBucket: "small",
    yearBucket: "2014-2018",
    facingAggression: true,
    amountBucket: "overbet",
  }), "turn|HJ|5|small|2014-2018|1|overbet");
  assert.equal(empiricalStatusLabel("ready"), "Empirical");
  assert.equal(empiricalStatusLabel("pending"), "Loading");
  assert.equal(empiricalStatusLabel("idle"), "Idle");
  assert.equal(empiricalStatusLabel("fallback"), "Fallback");
});

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
