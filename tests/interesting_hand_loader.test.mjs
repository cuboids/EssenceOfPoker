import assert from "node:assert/strict";
import test from "node:test";

import { loadRandomInterestingHandResult } from "../dashboard/interesting_hand_loader.mjs";

const importedHand = {
  source_hand_id: "demo",
  table_config: { player_count: 2, hero_position: "BB" },
  players: [
    { position: "SB", source_player_id: "p1", hole_cards: ["As", "Kd"] },
    { position: "BB", source_player_id: "p2", hole_cards: ["Qc", "Jh"] },
  ],
  board: ["2s", "3h", "4d", "5c", "6s"],
  actions: [
    { player_id: "p1", street: "preflop", action_type: "raise", amount_bb: 2 },
    { player_id: "p2", street: "preflop", action_type: "call", amount_bb: 2 },
  ],
};

test("interesting hand loader returns a parsed hand model", async () => {
  const result = await loadRandomInterestingHandResult({
    readHand: async () => ({ ok: true, hand: importedHand }),
    dealers: deterministicDealers(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.imported.tableConfig.playerCount, 2);
  assert.equal(result.imported.tableConfig.heroPosition, "SB");
  assert.equal(result.imported.playerActions.length, 2);
  assert.equal(result.handModel.phase, "showdown");
});

test("interesting hand loader reports unavailable and thrown failures as Results", async () => {
  const unavailable = await loadRandomInterestingHandResult({
    readHand: async () => ({ ok: false, error: "none ready" }),
    dealers: deterministicDealers(),
  });
  assert.deepEqual(
    { ok: unavailable.ok, message: unavailable.message },
    { ok: false, message: "none ready" },
  );

  const thrown = await loadRandomInterestingHandResult({
    readHand: async () => {
      throw new Error("network sad");
    },
    dealers: deterministicDealers(),
  });
  assert.equal(thrown.ok, false);
  assert.match(thrown.message, /network sad/);
});

function deterministicDealers() {
  return {
    dealHoleCards: () => [{ rank: 1, suit: 1 }, { rank: 2, suit: 2 }],
    dealCardsFromDeck: (deck, count) => deck.slice(0, count),
    remainingDeckForKnownCards: () => [
      { rank: 3, suit: 1 },
      { rank: 4, suit: 1 },
      { rank: 5, suit: 1 },
      { rank: 6, suit: 1 },
      { rank: 7, suit: 1 },
    ],
  };
}
