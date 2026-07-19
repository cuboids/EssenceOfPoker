import assert from "node:assert/strict";
import test from "node:test";

import {
  pendingHoleCardEdit,
  showdownVillainCardEditPatch,
} from "../dashboard/hand_flow_card_edit.mjs";
import { emptyHandModel, setPendingHoleCard } from "../dashboard/hand_state.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("pending hole-card edit rejects duplicates and completes two-card holdings", () => {
  const first = card(2, 1);
  const partial = setPendingHoleCard(emptyHandModel(), "H_1", first);

  assert.equal(pendingHoleCardEdit({ handModel: partial, token: "H_2", nextCard: first }).ok, false);

  const completed = pendingHoleCardEdit({ handModel: partial, token: "H_2", nextCard: card(12, 2) });
  assert.equal(completed.ok, true);
  assert.equal(completed.complete, true);
  assert.deepEqual(completed.holeCards, [first, card(12, 2)]);
});

test("showdown villain card edit rejects visible duplicate cards", () => {
  const result = showdownVillainCardEditPatch({
    page: "villain:BB",
    token: "V_1",
    nextCard: card(1, 1),
    currentCards: [card(7, 1), card(8, 1)],
    otherRevealedCards: [],
    handState: {
      h1: card(1, 1),
      h2: card(2, 2),
      flop: [card(3, 1), card(4, 1), card(5, 1)],
      turn: card(6, 1),
      river: card(9, 1),
    },
    showdownHoleCardsByPlayer: { "villain:BB": [card(7, 1), card(8, 1)] },
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /already dealt/);
});
