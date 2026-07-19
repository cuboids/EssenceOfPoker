import * as HandModel from "./hand_state.mjs";
import { cardCompare, hasDuplicateCards, sameCard } from "./cards.mjs";

export function pendingHoleCardEdit({ handModel, token, nextCard }) {
  const index = token === "H_1" ? 0 : 1;
  const nextPending = [...HandModel.pendingHoleCards(handModel)];
  nextPending[index] = nextCard;
  if (hasDuplicateCards(nextPending.filter(Boolean))) {
    return {
      ok: false,
      reason: "duplicate",
      message: "That card is already in the other hole-card slot.",
    };
  }
  if (nextPending.every(Boolean)) {
    return { ok: true, complete: true, holeCards: nextPending };
  }
  return {
    ok: true,
    complete: false,
    handModel: HandModel.setPendingHoleCard(handModel, token, nextCard),
  };
}

export function knownCardEditPatch({
  handModel,
  token,
  nextCard,
  activePage,
  villainShowdown,
  isOpponentPage,
  currentCard,
  remainingDeckForKnownCards,
  dealCardsFromDeck,
}) {
  if ((token === "V_1" || token === "V_2") && villainShowdown && isOpponentPage(activePage)) {
    return { deferredShowdownEdit: true };
  }
  try {
    return { ok: true, patch: { handModel: HandModel.editKnownCardModel(handModel, token, nextCard) } };
  } catch (error) {
    if (!HandModel.isShowdown(handModel) && error.message.includes("replacement villain cards")) {
      const physicals = HandModel.physicalCardsFromModel(handModel);
      const editedVisibleCards = [
        ...physicals.hole,
        ...physicals.flop,
        physicals.turn,
        physicals.river,
      ]
        .filter(Boolean)
        .map((card) => (currentCard && sameCard(card, currentCard) ? nextCard : card));
      const replacementVillain = dealCardsFromDeck(remainingDeckForKnownCards(editedVisibleCards), 2).sort(cardCompare);
      return {
        ok: true,
        patch: {
          handModel: HandModel.editKnownCardModel(handModel, token, nextCard, replacementVillain),
        },
      };
    }
    return { ok: false, message: error.message };
  }
}

export function showdownVillainCardEditPatch({
  page,
  token,
  nextCard,
  currentCards,
  otherRevealedCards,
  handState,
  showdownHoleCardsByPlayer,
}) {
  if (currentCards.length !== 2) {
    return { ok: false, message: "No showdown cards are available for this player." };
  }
  const nextCards = [...currentCards];
  nextCards[token === "V_1" ? 0 : 1] = nextCard;
  const visibleCards = [
    handState.h1,
    handState.h2,
    ...handState.flop,
    handState.turn,
    handState.river,
    ...otherRevealedCards,
    ...nextCards,
  ].filter(Boolean);
  if (hasDuplicateCards(visibleCards)) {
    return { ok: false, message: "That card is already dealt somewhere else in this hand." };
  }
  return {
    ok: true,
    patch: {
      showdownHoleCardsByPlayer: {
        ...showdownHoleCardsByPlayer,
        [page]: nextCards.sort(cardCompare),
      },
    },
  };
}
