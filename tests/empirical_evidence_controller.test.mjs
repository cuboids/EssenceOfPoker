import assert from "node:assert/strict";
import test from "node:test";

import { createEmpiricalEvidenceController } from "../dashboard/empirical_evidence_controller.mjs";

test("empirical evidence controller owns store loading and update callbacks", async () => {
  const events = [];
  const controller = createEmpiricalEvidenceController({
    readHealth: async () => ({ ok: true, data: { empiricalCalibration: { ok: true } } }),
    readSpot: async () => ({
      ok: true,
      request: empiricalRequest(),
      handClasses: {},
      spotProbabilities: {},
    }),
    requestForAction: () => empiricalRequest(),
    onLoading: () => events.push("loading"),
    onEvidenceChanged: () => events.push("updated"),
  });

  await controller.hydrateHealth();
  assert.deepEqual(events, ["updated"]);

  controller.ensureForActions([{ player: "hero", street: "preflop", type: "call" }]);
  assert.equal(controller.status([{ player: "hero", street: "preflop", type: "call" }]), "pending");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, ["updated", "loading", "updated"]);
  assert.equal(controller.status([{ player: "hero", street: "preflop", type: "call" }]), "ready");
});

function empiricalRequest() {
  return {
    street: "preflop",
    position: "BTN",
    playerCount: 6,
    stakeBucket: "micro",
    yearBucket: "2019+",
    facingAggression: false,
    amountBucket: "none",
  };
}
