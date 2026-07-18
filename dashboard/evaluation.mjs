import { cardId } from "./cards.mjs";

export const HAND_CATEGORIES = Object.freeze({
  STRAIGHT_FLUSH: 1,
  FOUR_OF_A_KIND: 2,
  FULL_HOUSE: 3,
  FLUSH: 4,
  STRAIGHT: 5,
  THREE_OF_A_KIND: 6,
  TWO_PAIR: 7,
  ONE_PAIR: 8,
  HIGH_CARD: 9,
});

export const STRAIGHTS = Object.freeze([
  Object.freeze([1, 2, 3, 4, 5]),
  Object.freeze([2, 3, 4, 5, 6]),
  Object.freeze([3, 4, 5, 6, 7]),
  Object.freeze([4, 5, 6, 7, 8]),
  Object.freeze([5, 6, 7, 8, 9]),
  Object.freeze([6, 7, 8, 9, 10]),
  Object.freeze([7, 8, 9, 10, 11]),
  Object.freeze([8, 9, 10, 11, 12]),
  Object.freeze([9, 10, 11, 12, 13]),
  Object.freeze([1, 10, 11, 12, 13]),
]);

const straightOrder = new Map(STRAIGHTS.map((ranks, index) => [rankSetKey(ranks), index]));

export function createHandEvaluator(bucketLookup, bucketCount = 7462) {
  const chooseTable = buildChooseTable(52, 5);
  const cache = new Uint16Array(chooseTable[52][5]);

  function evaluateGradation(cards) {
    const cacheIndex = fiveCardIndex(cards, chooseTable);
    const cached = cache[cacheIndex];
    if (cached) {
      return cached;
    }
    const key = evaluateKey(cards);
    const gradation = bucketLookup.get(key);
    if (gradation == null) {
      throw new Error(`Unknown hand bucket: ${key}`);
    }
    cache[cacheIndex] = gradation;
    return gradation;
  }

  function evaluateGradationFive(first, second, third, fourth, fifth) {
    const cacheIndex = fiveCardIndexFromCards(first, second, third, fourth, fifth, chooseTable);
    const cached = cache[cacheIndex];
    if (cached) {
      return cached;
    }
    const gradation = evaluateGradation([first, second, third, fourth, fifth]);
    cache[cacheIndex] = gradation;
    return gradation;
  }

  return Object.freeze({
    bucketCount,
    cache,
    chooseTable,
    evaluateGradation,
    evaluateGradationFive,
  });
}

export function evaluateKey(cards) {
  const ranks = cards.map((card) => card.rank).sort((a, b) => a - b);
  const suits = new Set(cards.map((card) => card.suit));
  const counts = new Map();
  for (const rank of ranks) {
    counts.set(rank, (counts.get(rank) || 0) + 1);
  }
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const straightIndex = straightOrder.get(rankSetKey(ranks));
  const isFlush = suits.size === 1;

  if (straightIndex != null && isFlush) {
    return keyString(HAND_CATEGORIES.STRAIGHT_FLUSH, straightIndex);
  }
  if (byCount[0][1] === 4) {
    const quadRank = byCount[0][0];
    const kicker = ranks.find((rank) => rank !== quadRank);
    return keyString(HAND_CATEGORIES.FOUR_OF_A_KIND, quadRank, kicker);
  }
  if (byCount[0][1] === 3 && byCount[1][1] === 2) {
    return keyString(HAND_CATEGORIES.FULL_HOUSE, byCount[0][0], byCount[1][0]);
  }
  if (isFlush) {
    return keyString(HAND_CATEGORIES.FLUSH, ...ranks);
  }
  if (straightIndex != null) {
    return keyString(HAND_CATEGORIES.STRAIGHT, straightIndex);
  }
  if (byCount[0][1] === 3) {
    const tripRank = byCount[0][0];
    const kickers = ranks.filter((rank) => rank !== tripRank);
    return keyString(HAND_CATEGORIES.THREE_OF_A_KIND, tripRank, ...kickers);
  }
  if (byCount[0][1] === 2 && byCount[1][1] === 2) {
    const pairRanks = byCount.filter((entry) => entry[1] === 2).map((entry) => entry[0]).sort((a, b) => a - b);
    const kicker = ranks.find((rank) => !pairRanks.includes(rank));
    return keyString(HAND_CATEGORIES.TWO_PAIR, ...pairRanks, kicker);
  }
  if (byCount[0][1] === 2) {
    const pairRank = byCount[0][0];
    const kickers = ranks.filter((rank) => rank !== pairRank);
    return keyString(HAND_CATEGORIES.ONE_PAIR, pairRank, ...kickers);
  }
  return keyString(HAND_CATEGORIES.HIGH_CARD, ...ranks);
}

export function buildChooseTable(maximumN, maximumK) {
  const table = Array.from({ length: maximumN + 1 }, () => Array(maximumK + 1).fill(0));
  for (let n = 0; n <= maximumN; n += 1) {
    table[n][0] = 1;
    for (let k = 1; k <= Math.min(n, maximumK); k += 1) {
      table[n][k] = k === n ? 1 : table[n - 1][k - 1] + table[n - 1][k];
    }
  }
  return table;
}

export function fiveCardIndex(cards, chooseTable) {
  const ids = cards.map((card) => card.id ?? cardId(card)).sort((first, second) => first - second);
  return fiveCardIndexFromSortedIds(ids, chooseTable);
}

export function fiveCardIndexFromCards(first, second, third, fourth, fifth, chooseTable) {
  const ids = [
    first.id ?? cardId(first),
    second.id ?? cardId(second),
    third.id ?? cardId(third),
    fourth.id ?? cardId(fourth),
    fifth.id ?? cardId(fifth),
  ].sort((left, right) => left - right);
  return fiveCardIndexFromSortedIds(ids, chooseTable);
}

export function fiveCardIndexFromSortedIds(ids, chooseTable) {
  return (
    chooseTable[ids[0]][1] +
    chooseTable[ids[1]][2] +
    chooseTable[ids[2]][3] +
    chooseTable[ids[3]][4] +
    chooseTable[ids[4]][5]
  );
}

export function rankSetKey(ranks) {
  return [...new Set(ranks)].sort((a, b) => a - b).join(":");
}

export function keyString(...values) {
  return values.join(":");
}
