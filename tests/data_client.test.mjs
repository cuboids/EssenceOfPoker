import assert from "node:assert/strict";
import test from "node:test";

import {
  readEmpiricalSpot,
  readEmpiricalSpotResult,
  readPreflopPrimaryClass,
  readPreflopPrimaryClassResult,
} from "../dashboard/data_client.mjs";

test("preflop data client exposes typed miss results while preserving null wrapper", async () => {
  await withFetchStub(async () => ({
    ok: false,
    status: 404,
    statusText: "Not Found",
    json: async () => ({ error: "missing class" }),
  }), async () => {
    const result = await readPreflopPrimaryClassResult("1-1-pair");

    assert.equal(result.ok, false);
    assert.equal(result.reason, "miss");
    assert.equal(result.error, "missing class");
    assert.equal(await readPreflopPrimaryClass("1-1-pair"), null);
  });
});

test("empirical spot client separates unavailable payload from transport failure", async () => {
  await withFetchStub(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: false, error: "no exact spot" }),
  }), async () => {
    const result = await readEmpiricalSpotResult({
      street: "preflop",
      position: "BTN",
      playerCount: 6,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "payload");
    assert.equal(result.error, "no exact spot");
    assert.equal(await readEmpiricalSpot({ street: "preflop", position: "BTN", playerCount: 6 }), null);
  });
});

test("empirical spot client returns network errors as typed results", async () => {
  await withFetchStub(async () => {
    throw new Error("offline");
  }, async () => {
    const result = await readEmpiricalSpotResult({
      street: "preflop",
      position: "BTN",
      playerCount: 6,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "network");
    assert.equal(result.error, "offline");
  });
});

async function withFetchStub(fetchStub, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
