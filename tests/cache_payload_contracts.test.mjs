import assert from "node:assert/strict";
import test from "node:test";

import {
  validateCompactPreflopMultiwayEquityCachePayload,
  validateMultiwayEquityCachePayload,
  validateWinShareCachePayload,
} from "../dashboard/cache_payload_contracts.mjs";

test("win-share cache payloads require normalized asset shares", () => {
  const payload = {
    totalCombos: 10,
    shares: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`${index}`, index === 0 ? 1 : 0])),
  };

  assert.equal(validateWinShareCachePayload(payload, { expectedShareCount: 21 }), payload);
  assert.throws(
    () => validateWinShareCachePayload({ totalCombos: 10, shares: { "1.1": 0.4 } }),
    /sum to 0.4, expected 1/,
  );
  assert.throws(
    () => validateWinShareCachePayload({ totalCombos: 10, shares: { "1.1": 1.2 } }),
    /must be a probability/,
  );
});

test("multiway equity cache payloads validate exact and monte carlo envelopes", () => {
  const exactPayload = {
    equities: { hero: 0.5, "villain:BB": 0.5 },
    nsims: 1,
    exact: true,
    seed: 42,
    approximation: {
      method: "exact",
      standardError: { hero: 0, "villain:BB": 0 },
      maxStandardError: 0,
      conservativeMargin95: 0,
    },
  };

  assert.equal(validateMultiwayEquityCachePayload(exactPayload, { expectedParticipants: 2 }), exactPayload);
  assert.throws(
    () => validateMultiwayEquityCachePayload({ equities: { hero: 1 }, nsims: 1, exact: false, approximation: { method: "exact", standardError: {}, maxStandardError: 0, conservativeMargin95: 0 } }),
    /method must match exact flag/,
  );
});

test("compact preflop multiway cache payloads are scoped by player count", () => {
  const payload = { hero: 0.57, villain: 0.43, playerCount: 6, nsims: 5000, exact: false };

  assert.equal(validateCompactPreflopMultiwayEquityCachePayload(payload, { playerCount: 6 }), payload);
  assert.throws(
    () => validateCompactPreflopMultiwayEquityCachePayload(payload, { playerCount: 2 }),
    /does not match 2/,
  );
  assert.throws(
    () => validateCompactPreflopMultiwayEquityCachePayload({ hero: 0.5, villain: 0.5, playerCount: 9, nsims: 1, exact: true }),
    /integer from 2 through 6/,
  );
});
