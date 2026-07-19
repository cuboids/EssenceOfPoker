import assert from "node:assert/strict";
import test from "node:test";

import { cacheNamespace } from "../dashboard/cache_keys.mjs";
import {
  buildAggregateEquityCacheKey,
  buildMultiwayEquityPayload,
  compactPreflopAggregateEquity,
  expandCachedPreflopAggregateEquity,
  participantHasNoLegalRange,
  preflopAggregateEquityUsesCanonicalCache,
} from "../dashboard/equity_payload_builder.mjs";
import { preflopMultiwayEquityCacheKey } from "../dashboard/multiway_equity.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("equity payload builder owns actual/range blockers and deterministic seeds", () => {
  const handState = { h1: card(2, 1), h2: card(12, 2), round: "preflop" };
  const knownBoard = [card(5, 3), card(6, 4), card(7, 1)];
  const actual = buildMultiwayEquityPayload({
    matchup: "actual",
    assetVersion: "build42",
    handState,
    knownBoard,
    knownCardsForHand: [handState.h1, handState.h2, ...knownBoard],
    activeVillainPageKeys: ["villain:SB", "villain:BB"],
    dashboardData: { bucketCount: 7462, bucketKeys: ["1"] },
  });
  const range = buildMultiwayEquityPayload({
    matchup: "range",
    assetVersion: "build42",
    handState,
    knownBoard,
    knownCardsForHand: [handState.h1, handState.h2, ...knownBoard],
    activeVillainPageKeys: ["villain:SB", "villain:BB"],
    dashboardData: { bucketCount: 7462, bucketKeys: ["1"] },
  });

  assert.deepEqual(actual.deadCards, [handState.h1, handState.h2, ...knownBoard]);
  assert.deepEqual(range.deadCards, [handState.h1, handState.h2, ...knownBoard]);
  assert.equal(actual.participants[0].id, "hero");
  assert.deepEqual(actual.participants[0].knownHoleCards, [handState.h1, handState.h2]);
  assert.equal(range.participants[0].id, "range");
  assert.equal(actual.seed, buildMultiwayEquityPayload({
    matchup: "actual",
    assetVersion: "build42",
    handState,
    knownBoard,
    knownCardsForHand: [handState.h1, handState.h2, ...knownBoard],
    activeVillainPageKeys: ["villain:SB", "villain:BB"],
    dashboardData: { bucketCount: 7462, bucketKeys: ["1"] },
  }).seed);
});

test("aggregate equity cache builder chooses canonical preflop class cache only when safe", () => {
  const handState = { h1: card(2, 1), h2: card(12, 2), round: "preflop" };
  const payload = buildMultiwayEquityPayload({
    matchup: "actual",
    assetVersion: "build42",
    handState,
    activeVillainPageKeys: ["villain:SB", "villain:BB"],
    dashboardData: { bucketCount: 7462, bucketKeys: ["1"] },
  });
  assert.equal(preflopAggregateEquityUsesCanonicalCache({
    matchup: "actual",
    payload,
    handRound: "preflop",
    visibleActions: [],
  }), true);
  assert.equal(
    buildAggregateEquityCacheKey({
      matchup: "actual",
      payload,
      assetVersion: "build42",
      foldedPages: [],
    }),
    preflopMultiwayEquityCacheKey({
      namespace: cacheNamespace("build42"),
      matchup: "actual",
      heroCards: [handState.h1, handState.h2],
      activePlayerCount: 3,
      nsims: payload.nsims,
    }),
  );
  assert.equal(preflopAggregateEquityUsesCanonicalCache({
    matchup: "actual",
    payload,
    handRound: "preflop",
    visibleActions: [{ street: "preflop", type: "raise" }],
  }), false);
});

test("compact preflop equity cache splits a shared villain value back onto each villain", () => {
  const payload = {
    participants: [{ id: "hero" }, { id: "villain:SB" }, { id: "villain:BB" }],
  };
  const compact = compactPreflopAggregateEquity({
    equities: { hero: 0.48, "villain:SB": 0.30, "villain:BB": 0.22 },
    nsims: 5000,
    exact: false,
  }, payload);
  assert.deepEqual(compact, {
    hero: 0.48,
    villain: 0.26,
    playerCount: 3,
    nsims: 5000,
    exact: false,
  });
  assert.deepEqual(expandCachedPreflopAggregateEquity(compact, payload).equities, {
    hero: 0.48,
    "villain:SB": 0.26,
    "villain:BB": 0.26,
  });
});

test("empty weighted range detection respects known board blockers", () => {
  assert.equal(participantHasNoLegalRange({ id: "range" }, []), false);
  assert.equal(participantHasNoLegalRange({
    id: "range",
    rangeCombos: [{ cards: [card(1, 1), card(2, 2)], weight: 0 }],
  }), true);
  assert.equal(participantHasNoLegalRange({
    id: "range",
    rangeCombos: [{ cards: [card(1, 1), card(2, 2)], weight: 1 }],
  }, [card(1, 1)]), true);
  assert.equal(participantHasNoLegalRange({
    id: "range",
    rangeCombos: [{ cards: [card(1, 1), card(2, 2)], weight: 1 }],
  }, [card(3, 3)]), false);
});
