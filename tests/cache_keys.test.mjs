import assert from "node:assert/strict";
import test from "node:test";

import {
  CACHE_KEY_SCHEMA_VERSION,
  WIN_SHARE_CACHE_VERSION,
  cacheNamespace,
  heroPreflopWinShareCacheKey,
  preflopClassKeyForCards,
  winShareCacheKey,
} from "../dashboard/cache_keys.mjs";
import { preflopMultiwayEquityCacheKey } from "../dashboard/multiway_equity.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("preflop class keys distinguish pairs, suited hands, and offsuit hands", () => {
  assert.equal(preflopClassKeyForCards(card(3, 1), card(3, 4)), "3-3-pair");
  assert.equal(preflopClassKeyForCards(card(2, 1), card(12, 1)), "2-12-suited");
  assert.equal(preflopClassKeyForCards(card(2, 1), card(12, 2)), "2-12-offsuit");
});

test("win-share cache keys are deterministic and shared by app/script callers", () => {
  assert.equal(WIN_SHARE_CACHE_VERSION, "winshare-runouts-v2");
  assert.equal(CACHE_KEY_SCHEMA_VERSION, "cache-schema-v1");
  assert.equal(cacheNamespace("abc123"), "cache-schema-v1:abc123");
  assert.equal(
    heroPreflopWinShareCacheKey(card(3, 1), card(12, 2)),
    "cache-schema-v1:development:winshare-runouts-v2:hero:preflop:3-12-offsuit",
  );
  assert.equal(
    heroPreflopWinShareCacheKey(card(3, 1), card(12, 2), { dataVersion: "build42" }),
    "cache-schema-v1:build42:winshare-runouts-v2:hero:preflop:3-12-offsuit",
  );
  assert.equal(
    winShareCacheKey({
      page: "hero",
      state: { T: card(5, 1), H_1: card(1, 2) },
      street: "hidden",
    }),
    "cache-schema-v1:development:winshare-runouts-v2:hero:hidden:H_1-1.2|T-5.1",
  );
});

test("preflop multiway equity cache keys collapse physical suits to class and player count", () => {
  const first = preflopMultiwayEquityCacheKey({
    namespace: cacheNamespace("build42"),
    heroCards: [card(2, 1), card(5, 2)],
    activePlayerCount: 6,
    nsims: 5000,
  });
  const sameClass = preflopMultiwayEquityCacheKey({
    namespace: cacheNamespace("build42"),
    heroCards: [card(2, 3), card(5, 4)],
    activePlayerCount: 6,
    nsims: 5000,
  });
  const fewerPlayers = preflopMultiwayEquityCacheKey({
    namespace: cacheNamespace("build42"),
    heroCards: [card(2, 3), card(5, 4)],
    activePlayerCount: 3,
    nsims: 5000,
  });
  assert.equal(first, sameClass);
  assert.notEqual(first, fewerPlayers);
});
