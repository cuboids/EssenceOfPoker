import assert from "node:assert/strict";
import test from "node:test";

import {
  createHandTransactionDispatcher,
  handTransaction,
} from "../dashboard/hand_transactions.mjs";

test("hand transaction dispatcher applies patches before named effects", () => {
  const state = { handModel: null, effects: [] };
  const dispatcher = createHandTransactionDispatcher({
    setters: {
      handModel: (value) => { state.handModel = value; },
      cardEditError: (value) => { state.cardEditError = value; },
    },
    effects: {
      sync: () => state.effects.push(`sync:${state.handModel.phase}`),
      render: () => state.effects.push(`render:${state.cardEditError}`),
    },
  });

  dispatcher.dispatch(handTransaction("test", {
    patch: {
      handModel: { phase: "preflop" },
      cardEditError: "",
    },
    effects: ["sync", "render"],
  }));

  assert.deepEqual(state, {
    handModel: { phase: "preflop" },
    cardEditError: "",
    effects: ["sync:preflop", "render:"],
  });
});

test("hand transaction dispatcher rejects unknown patch keys and effects", () => {
  const dispatcher = createHandTransactionDispatcher({ setters: {}, effects: {} });

  assert.throws(
    () => dispatcher.dispatch(handTransaction("bad-patch", { patch: { mystery: 1 } })),
    /unknown hand transaction patch key/,
  );
  assert.throws(
    () => dispatcher.dispatch(handTransaction("bad-effect", { effects: ["mystery"] })),
    /unknown hand transaction effect/,
  );
});
