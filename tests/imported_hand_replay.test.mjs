import assert from "node:assert/strict";
import test from "node:test";

import { cardKey } from "../dashboard/cards.mjs";
import { handViewFromModel } from "../dashboard/hand_view.mjs";
import {
  interestingHandToAppState,
  modelFromImportedHandReplay,
  normalizeInterestingAction,
} from "../dashboard/imported_hand_replay.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("interesting hand replay normalizes hero, actions, board, and showdown cards", () => {
  const imported = interestingHandToAppState({
    players: [
      { position: "LJ", source_player_id: "lj", stack_bb: 88, hole_cards: ["Ah", "Ad"] },
      { position: "HJ", source_player_id: "hj", stack_bb: 100, hole_cards: ["Ks", "Td"] },
      { position: "BB", source_player_id: "bb", stack_bb: 120, hole_cards: ["9c", "8d"] },
    ],
    board: ["As", "7d", "6c", "Qc", "3s"],
    actions: [
      { player_id: "lj", street: "preflop", action_type: "fold" },
      { player_id: "hj", street: "preflop", action_type: "raise", amount_bb: 3 },
      { player_id: "bb", street: "preflop", action_type: "call", amount_bb: 2 },
      { player_id: "hj", street: "flop", action_type: "bet", amount_bb: 4 },
      { player_id: "bb", street: "flop", action_type: "call", amount_bb: 4 },
    ],
  });

  assert.equal(imported.tableConfig.heroPosition, "HJ");
  assert.equal(imported.tableConfig.playerStacks.HJ, 100);
  assert.deepEqual(imported.heroCards.map(cardKey), ["2.1", "5.3"]);
  assert.deepEqual(imported.boardCards.map(cardKey), ["1.1", "8.3", "9.4", "3.4", "12.1"]);
  assert.deepEqual(imported.playerActions.slice(0, 3), [
    { id: "ih1", player: "villain:LJ", street: "preflop", type: "fold" },
    { id: "ih2", player: "hero", street: "preflop", type: "raise", amount: 3 },
    { id: "ih3", player: "villain:BB", street: "preflop", type: "call", amount: 2 },
  ]);

  const model = modelFromImportedHandReplay(imported, fallbackDealers());
  const view = handViewFromModel(model);
  assert.equal(view.round, "river");
  assert.deepEqual([view.h1, view.h2].map(cardKey), imported.heroCards.map(cardKey));
  assert.deepEqual([...view.flop, view.turn, view.river].map(cardKey), ["1.1", "8.3", "9.4", "3.4", "12.1"]);
});

test("interesting action normalization drops unmapped source players", () => {
  assert.equal(normalizeInterestingAction({ player_id: "x" }, 0, {}), null);
});

function fallbackDealers() {
  return {
    dealHoleCards: () => [card(1, 1), card(2, 1)],
    dealCardsFromDeck: (deck, count) => deck.slice(0, count),
    remainingDeckForKnownCards: (knownCards) => [
      card(4, 1),
      card(5, 2),
      card(6, 3),
      card(7, 4),
    ].filter((candidate) => !knownCards.some((known) => cardKey(candidate) === cardKey(known))),
  };
}
