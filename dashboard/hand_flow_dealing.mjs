import * as HandModel from "./hand_state.mjs";
import { cardCompare } from "./cards.mjs";

export function nextRoundDeal({
  handState,
  handModel,
  dealHoleCards,
  dealCardsFromDeck,
  remainingDeckForKnownCards,
  allDealtCardsForDeck,
}) {
  if (handState?.round === "river") {
    return { ok: false, reason: "river" };
  }
  if (!handState) {
    return startPreflopDeal({
      handModel,
      dealHoleCards,
      dealCardsFromDeck,
      remainingDeckForKnownCards,
    });
  }
  if (handState.round === "preflop") {
    const flop = dealCardsFromDeck(remainingDeckForKnownCards(allDealtCardsForDeck()), 3);
    return { ok: true, type: "street", handModel: HandModel.dealFlopModel(handModel, flop) };
  }
  if (handState.round === "flop") {
    const [turn] = dealCardsFromDeck(remainingDeckForKnownCards(allDealtCardsForDeck()), 1);
    return { ok: true, type: "street", handModel: HandModel.dealTurnModel(handModel, turn) };
  }
  const [river] = dealCardsFromDeck(remainingDeckForKnownCards(allDealtCardsForDeck()), 1);
  return { ok: true, type: "street", handModel: HandModel.dealRiverModel(handModel, river) };
}

export function startPreflopDeal({ handModel, dealHoleCards, dealCardsFromDeck, remainingDeckForKnownCards }) {
  const selectedHoleCards = HandModel.pendingHoleCards(handModel).filter(Boolean);
  const heroHoleCards = selectedHoleCards.length
    ? dealHoleCardsAroundPendingCards(selectedHoleCards, { dealCardsFromDeck, remainingDeckForKnownCards })
    : dealHoleCards();
  return startPreflopFromHoleCards(heroHoleCards, { dealCardsFromDeck, remainingDeckForKnownCards });
}

export function dealHoleCardsAroundPendingCards(selectedHoleCards, { dealCardsFromDeck, remainingDeckForKnownCards }) {
  if (selectedHoleCards.length === 2) {
    return [...selectedHoleCards].sort(cardCompare);
  }
  const [drawnCard] = dealCardsFromDeck(remainingDeckForKnownCards(selectedHoleCards), 1);
  return [...selectedHoleCards, drawnCard].sort(cardCompare);
}

export function startPreflopFromHoleCards(holeCards, { dealCardsFromDeck, remainingDeckForKnownCards }) {
  const heroHoleCards = [...holeCards].sort(cardCompare);
  const villainHoleCards = dealCardsFromDeck(remainingDeckForKnownCards(heroHoleCards), 2).sort(cardCompare);
  return {
    ok: true,
    type: "preflop",
    heroHoleCards,
    handModel: HandModel.startPreflopModel(heroHoleCards, villainHoleCards),
  };
}
