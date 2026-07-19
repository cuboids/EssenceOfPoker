import { cardCompare, cardId, cardKey, fullDeck, rankSymbol, sameCard } from "./cards.mjs";
import { preflopClassKeyForCards } from "./cache_keys.mjs";

export function legalTwoCardCombos({ deck = fullDeck, deadCards = [] } = {}) {
  const available = deck.filter((card) => !deadCards.some((deadCard) => sameCard(card, deadCard)));
  const combos = [];
  for (let firstIndex = 0; firstIndex < available.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < available.length; secondIndex += 1) {
      combos.push(normalizeCombo(available[firstIndex], available[secondIndex]));
    }
  }
  return combos;
}

export function normalizeCombo(firstCard, secondCard) {
  const [first, second] = [firstCard, secondCard].sort(cardCompare);
  return Object.freeze({
    id: comboId(first, second),
    cards: Object.freeze([first, second]),
    classKey: preflopClassKeyForCards(first, second),
    label: comboLabel(first, second),
  });
}

export function comboId(firstCard, secondCard) {
  const ids = [cardId(firstCard), cardId(secondCard)].sort((first, second) => first - second);
  return `${ids[0]}-${ids[1]}`;
}

export function comboLabel(firstCard, secondCard) {
  const [first, second] = [firstCard, secondCard].sort(cardCompare);
  const firstRank = rankSymbol(first.rank);
  const secondRank = rankSymbol(second.rank);
  if (first.rank === second.rank) {
    return `${firstRank}${secondRank}`;
  }
  return `${firstRank}${secondRank}${first.suit === second.suit ? "s" : "o"}`;
}

export function comboBlocks(combo, knownCards = []) {
  return combo.cards.some((card) => knownCards.some((knownCard) => cardKey(card) === cardKey(knownCard)));
}
