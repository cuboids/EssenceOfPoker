import { cardId, sameCard } from "./cards.mjs";
import { cacheNamespace, preflopClassKeyForCards } from "./cache_keys.mjs";

export const DEFAULT_MULTIWAY_EQUITY_SIMS = 5_000;
export const MULTIWAY_EQUITY_CACHE_VERSION = "multiway-equity-v1";

const SEVEN_CARD_INDEXES = Object.freeze([
  Object.freeze([0, 1, 2, 3, 4]),
  Object.freeze([0, 1, 2, 3, 5]),
  Object.freeze([0, 1, 2, 3, 6]),
  Object.freeze([0, 1, 2, 4, 5]),
  Object.freeze([0, 1, 2, 4, 6]),
  Object.freeze([0, 1, 2, 5, 6]),
  Object.freeze([0, 1, 3, 4, 5]),
  Object.freeze([0, 1, 3, 4, 6]),
  Object.freeze([0, 1, 3, 5, 6]),
  Object.freeze([0, 1, 4, 5, 6]),
  Object.freeze([0, 2, 3, 4, 5]),
  Object.freeze([0, 2, 3, 4, 6]),
  Object.freeze([0, 2, 3, 5, 6]),
  Object.freeze([0, 2, 4, 5, 6]),
  Object.freeze([0, 3, 4, 5, 6]),
  Object.freeze([1, 2, 3, 4, 5]),
  Object.freeze([1, 2, 3, 4, 6]),
  Object.freeze([1, 2, 3, 5, 6]),
  Object.freeze([1, 2, 4, 5, 6]),
  Object.freeze([1, 3, 4, 5, 6]),
  Object.freeze([2, 3, 4, 5, 6]),
]);

export function computeMultiwayAggregateEquities({
  participants,
  knownBoard = [],
  deck,
  evaluateGradationFive,
  nsims = DEFAULT_MULTIWAY_EQUITY_SIMS,
  seed = 1,
}) {
  const activeParticipants = participants.filter((participant) => !participant.folded);
  if (!activeParticipants.length) {
    return { equities: {}, nsims: 0, exact: true };
  }
  if (activeParticipants.length === 1) {
    return { equities: { [activeParticipants[0].id]: 1 }, nsims: 1, exact: true };
  }

  const missingHoleCards = activeParticipants.reduce((total, participant) =>
    total + (participant.knownHoleCards?.length === 2 ? 0 : 2), 0);
  const missingBoardCards = 5 - knownBoard.length;
  const drawsNeeded = missingHoleCards + missingBoardCards;
  const hasWeightedRanges = activeParticipants.some((participant) => Array.isArray(participant.rangeCombos));
  const exact = drawsNeeded === 0 && !hasWeightedRanges;
  const iterations = exact ? 1 : nsims;
  const shares = Object.fromEntries(activeParticipants.map((participant) => [participant.id, 0]));
  const rng = mulberry32(seed >>> 0);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const { playerHands, board } = samplePlayerHandsAndBoard({
      activeParticipants,
      knownBoard,
      deck,
      missingBoardCards,
      rng,
    });

    const gradations = activeParticipants.map((participant, index) => ({
      id: participant.id,
      gradation: bestSevenCardGradation([...playerHands[index], ...board], evaluateGradationFive),
    }));
    const bestGradation = Math.min(...gradations.map((result) => result.gradation));
    const winners = gradations.filter((result) => result.gradation === bestGradation);
    const splitShare = 1 / winners.length;
    for (const winner of winners) {
      shares[winner.id] += splitShare;
    }
  }

  for (const id of Object.keys(shares)) {
    shares[id] /= iterations;
  }
  return { equities: shares, nsims: iterations, exact };
}

export async function computeMultiwayAggregateEquitiesChunked({
  participants,
  knownBoard = [],
  deck,
  evaluateGradationFive,
  nsims = DEFAULT_MULTIWAY_EQUITY_SIMS,
  seed = 1,
  chunkSize = 500,
  yieldFn = defaultYield,
}) {
  const activeParticipants = participants.filter((participant) => !participant.folded);
  if (!activeParticipants.length) {
    return { equities: {}, nsims: 0, exact: true };
  }
  if (activeParticipants.length === 1) {
    return { equities: { [activeParticipants[0].id]: 1 }, nsims: 1, exact: true };
  }

  const missingHoleCards = activeParticipants.reduce((total, participant) =>
    total + (participant.knownHoleCards?.length === 2 ? 0 : 2), 0);
  const missingBoardCards = 5 - knownBoard.length;
  const drawsNeeded = missingHoleCards + missingBoardCards;
  const hasWeightedRanges = activeParticipants.some((participant) => Array.isArray(participant.rangeCombos));
  const exact = drawsNeeded === 0 && !hasWeightedRanges;
  const iterations = exact ? 1 : nsims;
  const shares = Object.fromEntries(activeParticipants.map((participant) => [participant.id, 0]));
  const rng = mulberry32(seed >>> 0);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    scoreSample({
      activeParticipants,
      knownBoard,
      deck,
      drawsNeeded,
      missingBoardCards,
      exact,
      rng,
      shares,
      evaluateGradationFive,
    });
    if (!exact && iteration > 0 && iteration % chunkSize === 0) {
      await yieldFn();
    }
  }

  for (const id of Object.keys(shares)) {
    shares[id] /= iterations;
  }
  return { equities: shares, nsims: iterations, exact };
}

export function bestSevenCardGradation(cards, evaluateGradationFive) {
  if (cards.length !== 7) {
    throw new Error(`Expected 7 cards, received ${cards.length}`);
  }
  let best = Infinity;
  for (const indexes of SEVEN_CARD_INDEXES) {
    const gradation = evaluateGradationFive(
      cards[indexes[0]],
      cards[indexes[1]],
      cards[indexes[2]],
      cards[indexes[3]],
      cards[indexes[4]],
    );
    if (gradation < best) {
      best = gradation;
    }
  }
  return best;
}

export function multiwayEquityCacheKey({
  namespace = "development",
  matchup,
  participants,
  knownBoard = [],
  deadCards = [],
  foldedPages = [],
  nsims,
}) {
  const participantKey = participants
    .map((participant) => `${participant.id}:${participant.knownHoleCards?.map(cardId).sort((a, b) => a - b).join(".") || participant.rangeKey || "range"}`)
    .sort()
    .join("|");
  const boardKey = knownBoard.map(cardId).sort((a, b) => a - b).join(".");
  const deadKey = deadCards.map(cardId).sort((a, b) => a - b).join(".");
  const foldedKey = [...foldedPages].sort().join(".");
  return `${namespace}:${MULTIWAY_EQUITY_CACHE_VERSION}:${matchup}:p=${participantKey}:b=${boardKey}:d=${deadKey}:f=${foldedKey}:n=${nsims}`;
}

export function preflopMultiwayEquityCacheKey({
  namespace = cacheNamespace(),
  matchup = "actual",
  heroCards,
  activePlayerCount,
  nsims,
}) {
  if (!Array.isArray(heroCards) || heroCards.length !== 2) {
    throw new Error("preflop multiway equity cache key requires exactly two hero cards");
  }
  return `${namespace}:${MULTIWAY_EQUITY_CACHE_VERSION}:preflop:${matchup}:h=${preflopClassKeyForCards(heroCards[0], heroCards[1])}:players=${activePlayerCount}:n=${nsims}`;
}

export function removeKnownCards(deck, knownCards) {
  return deck.filter((card) => !knownCards.some((knownCard) => sameCard(card, knownCard)));
}

function sampleWithoutReplacement(deck, count, rng) {
  const sampled = new Array(count);
  const indexes = new Set();
  for (let position = 0; position < count; position += 1) {
    let index = Math.floor(rng() * deck.length);
    while (indexes.has(index)) {
      index = Math.floor(rng() * deck.length);
    }
    indexes.add(index);
    sampled[position] = deck[index];
  }
  return sampled;
}

function scoreSample({
  activeParticipants,
  knownBoard,
  deck,
  drawsNeeded,
  missingBoardCards,
  exact,
  rng,
  shares,
  evaluateGradationFive,
}) {
  const { playerHands, board } = samplePlayerHandsAndBoard({
    activeParticipants,
    knownBoard,
    deck,
    missingBoardCards,
    rng,
  });

  const gradations = activeParticipants.map((participant, index) => ({
    id: participant.id,
    gradation: bestSevenCardGradation([...playerHands[index], ...board], evaluateGradationFive),
  }));
  const bestGradation = Math.min(...gradations.map((result) => result.gradation));
  const winners = gradations.filter((result) => result.gradation === bestGradation);
  const splitShare = 1 / winners.length;
  for (const winner of winners) {
    shares[winner.id] += splitShare;
  }
}

export function samplePlayerHandsAndBoard({
  activeParticipants,
  knownBoard = [],
  deck,
  missingBoardCards,
  rng,
}) {
  const usedCards = [...knownBoard];
  const playerHands = activeParticipants.map((participant) => {
    if (participant.knownHoleCards?.length === 2) {
      usedCards.push(...participant.knownHoleCards);
      return participant.knownHoleCards;
    }
    const hand = sampleParticipantRange(participant, deck, usedCards, rng);
    usedCards.push(...hand);
    return hand;
  });
  const boardDeck = deck.filter((card) => !usedCards.some((usedCard) => sameCard(card, usedCard)));
  const board = knownBoard.length === 5
    ? knownBoard
    : [...knownBoard, ...sampleWithoutReplacement(boardDeck, missingBoardCards, rng)];
  return { playerHands, board };
}

function sampleParticipantRange(participant, deck, usedCards, rng) {
  const rangeCombos = Array.isArray(participant.rangeCombos) ? participant.rangeCombos : null;
  if (!rangeCombos) {
    return sampleWithoutReplacement(
      deck.filter((card) => !usedCards.some((usedCard) => sameCard(card, usedCard))),
      2,
      rng,
    );
  }
  const availableCombos = rangeCombos.filter((combo) =>
    Number(combo.weight) > 0 &&
    combo.cards?.length === 2 &&
    combo.cards.every((card) => !usedCards.some((usedCard) => sameCard(card, usedCard))),
  );
  if (!availableCombos.length) {
    return sampleWithoutReplacement(
      deck.filter((card) => !usedCards.some((usedCard) => sameCard(card, usedCard))),
      2,
      rng,
    );
  }
  const totalWeight = availableCombos.reduce((sum, combo) => sum + Number(combo.weight), 0);
  let target = rng() * totalWeight;
  for (const combo of availableCombos) {
    target -= Number(combo.weight);
    if (target <= 0) {
      return combo.cards;
    }
  }
  return availableCombos[availableCombos.length - 1].cards;
}

function defaultYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mulberry32(seed) {
  return function next() {
    seed += 0x6D2B79F5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
