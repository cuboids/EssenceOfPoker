import assert from "node:assert/strict";
import test from "node:test";

import {
  WIN_SHARE_CACHE_VERSION,
  heroPreflopWinShareCacheKey,
  preflopClassKeyForCards,
  winShareCacheKey,
} from "../dashboard/cache_keys.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("preflop class keys distinguish pairs, suited hands, and offsuit hands", () => {
  assert.equal(preflopClassKeyForCards(card(3, 1), card(3, 4)), "3-3-pair");
  assert.equal(preflopClassKeyForCards(card(2, 1), card(12, 1)), "2-12-suited");
  assert.equal(preflopClassKeyForCards(card(2, 1), card(12, 2)), "2-12-offsuit");
});

test("win-share cache keys are deterministic and shared by app/script callers", () => {
  assert.equal(WIN_SHARE_CACHE_VERSION, "winshare-runouts-v2");
  assert.equal(
    heroPreflopWinShareCacheKey(card(3, 1), card(12, 2)),
    "winshare-runouts-v2:hero:preflop:3-12-offsuit",
  );
  assert.equal(
    winShareCacheKey({
      page: "hero",
      state: { T: card(5, 1), H_1: card(1, 2) },
      street: "hidden",
    }),
    "winshare-runouts-v2:hero:hidden:H_1-1.2|T-5.1",
  );
});
