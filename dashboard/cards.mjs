export const RANK_SYMBOLS = Object.freeze(["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"]);
export const SUIT_SYMBOLS = Object.freeze(["♠", "♥", "♦", "♣"]);

export const fullDeck = Object.freeze(
  Array.from({ length: 13 }, (_, rankIndex) =>
    Array.from({ length: 4 }, (_, suitIndex) => Object.freeze({
      rank: rankIndex + 1,
      suit: suitIndex + 1,
      id: cardId({ rank: rankIndex + 1, suit: suitIndex + 1 }),
    })),
  ).flat(),
);

export function cardId(card) {
  return (card.rank - 1) * 4 + (card.suit - 1);
}

export function cardCompare(first, second) {
  return first.rank - second.rank || first.suit - second.suit;
}

export function sameCard(first, second) {
  return first.rank === second.rank && first.suit === second.suit;
}

export function cardKey(card) {
  return `${card.rank}.${card.suit}`;
}

export function rawCard(card) {
  return { rank: card.rank, suit: card.suit, id: card.id ?? cardId(card) };
}

export function hasDuplicateCards(cards) {
  return new Set(cards.map(cardKey)).size !== cards.length;
}

export function rankSymbol(rank) {
  return RANK_SYMBOLS[rank - 1];
}

export function suitSymbol(suit) {
  return SUIT_SYMBOLS[suit - 1];
}

export function parsePhysicalCard(input) {
  const match = input.trim().toLowerCase().match(/^(1[0-3]|[1-9]|a|k|q|j|t|10)\s*([shdc♠♥♦♣])$/);
  if (!match) {
    return null;
  }
  const rankLookup = { a: 1, k: 2, q: 3, j: 4, t: 5, "10": 5 };
  const rank = rankLookup[match[1]] || Number(match[1] === "10" ? 5 : match[1]);
  const suit = { s: 1, "♠": 1, h: 2, "♥": 2, d: 3, "♦": 3, c: 4, "♣": 4 }[match[2]];
  return { rank, suit, id: cardId({ rank, suit }) };
}
