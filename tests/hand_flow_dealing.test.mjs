import assert from "node:assert/strict";
import test from "node:test";

import * as HandModel from "../dashboard/hand_state.mjs";
import {
  dealHoleCardsAroundPendingCards,
  nextRoundDeal,
  startPreflopFromHoleCards,
} from "../dashboard/hand_flow_dealing.mjs";

const AS = { rank: 1, suit: 1, id: "1s" };
const KC = { rank: 2, suit: 4, id: "2c" };
const QH = { rank: 3, suit: 2, id: "3h" };
const JD = { rank: 4, suit: 3, id: "4d" };
const TS = { rank: 5, suit: 1, id: "5s" };
const NINE_H = { rank: 6, suit: 2, id: "6h" };
const EIGHT_D = { rank: 7, suit: 3, id: "7d" };

test("pending one-card holding is completed from the remaining deck in sorted order", () => {
  const cards = dealHoleCardsAroundPendingCards([KC], {
    dealCardsFromDeck: () => [AS],
    remainingDeckForKnownCards: (knownCards) => knownCards,
  });
  assert.deepEqual(cards, [AS, KC]);
});

test("preflop deal builds hero and hidden villain hole cards without overlap", () => {
  const result = startPreflopFromHoleCards([KC, AS], {
    dealCardsFromDeck: () => [QH, JD],
    remainingDeckForKnownCards: (knownCards) => knownCards,
  });
  assert.equal(result.ok, true);
  assert.equal(result.type, "preflop");
  assert.deepEqual(result.heroHoleCards, [AS, KC]);
  assert.equal(result.handModel.phase, HandModel.HAND_PHASES.PREFLOP);
  assert.deepEqual(HandModel.physicalCardsFromModel(result.handModel).hole, [AS, KC]);
});

test("next round deal advances preflop through flop with fresh board cards", () => {
  const preflop = HandModel.startPreflopModel([AS, KC], [QH, JD]);
  const result = nextRoundDeal({
    handState: { round: "preflop" },
    handModel: preflop,
    dealHoleCards: () => [AS, KC],
    dealCardsFromDeck: () => [TS, NINE_H, EIGHT_D],
    remainingDeckForKnownCards: (knownCards) => knownCards,
    allDealtCardsForDeck: () => [AS, KC, QH, JD],
  });
  assert.equal(result.ok, true);
  assert.equal(result.type, "street");
  assert.equal(result.handModel.phase, HandModel.HAND_PHASES.FLOP);
  assert.deepEqual(HandModel.physicalCardsFromModel(result.handModel).flop, [TS, NINE_H, EIGHT_D]);
});
