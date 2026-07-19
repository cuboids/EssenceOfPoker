import {
  cardCompare,
  cardId,
  cardKey,
  hasDuplicateCards,
  rawCard,
  sameCard,
} from "./cards.mjs";

export const HAND_PHASES = Object.freeze({
  EMPTY: "empty",
  PARTIAL_HOLDING: "partial_holding",
  PREFLOP: "preflop",
  FLOP: "flop",
  TURN: "turn",
  RIVER: "river",
  SHOWDOWN: "showdown",
});

const STREET_PHASES = [HAND_PHASES.PREFLOP, HAND_PHASES.FLOP, HAND_PHASES.TURN, HAND_PHASES.RIVER];

export function emptyHandModel() {
  return freezeModel({
    phase: HAND_PHASES.EMPTY,
    hole: [null, null],
    villain: [null, null],
    flop: [],
    turn: null,
    river: null,
    suitMap: new Map(),
  });
}

export function startPreflopModel(holeCards, villainCards = []) {
  validateCardCount(holeCards, 2, "holding");
  validateCardCount(villainCards, 2, "villain");
  rejectDuplicates([...holeCards, ...villainCards], "preflop cards cannot contain duplicates");
  return buildModelFromPhysicals(HAND_PHASES.PREFLOP, {
    hole: holeCards,
    villain: villainCards,
    flop: [],
    turn: null,
    river: null,
  });
}

export function setPendingHoleCard(model, token, card) {
  assertToken(token, ["H_1", "H_2"]);
  if (![HAND_PHASES.EMPTY, HAND_PHASES.PARTIAL_HOLDING].includes(model.phase)) {
    throw new Error("pending hole cards can only be edited before preflop");
  }
  const hole = [...model.hole];
  hole[token === "H_1" ? 0 : 1] = rawCard(card);
  rejectDuplicates(hole.filter(Boolean), "that card is already in the other hole-card slot");
  return freezeModel({
    ...model,
    phase: HAND_PHASES.PARTIAL_HOLDING,
    hole,
  });
}

export function clearPendingHoleCards(model) {
  return freezeModel({ ...model, hole: [null, null], phase: HAND_PHASES.EMPTY });
}

export function dealFlopModel(model, flopCards) {
  assertPhase(model, [HAND_PHASES.PREFLOP]);
  validateCardCount(flopCards, 3, "flop");
  rejectDuplicates([...knownPhysicalCards(model), ...flopCards], "flop cannot duplicate a known card");
  return buildModelFromPhysicals(HAND_PHASES.FLOP, {
    ...physicalCardsFromModel(model),
    flop: flopCards,
  });
}

export function dealTurnModel(model, turnCard) {
  assertPhase(model, [HAND_PHASES.FLOP]);
  rejectDuplicates([...knownPhysicalCards(model), turnCard], "turn cannot duplicate a known card");
  return buildModelFromPhysicals(HAND_PHASES.TURN, {
    ...physicalCardsFromModel(model),
    turn: turnCard,
  });
}

export function dealRiverModel(model, riverCard) {
  assertPhase(model, [HAND_PHASES.TURN]);
  rejectDuplicates([...knownPhysicalCards(model), riverCard], "river cannot duplicate a known card");
  return buildModelFromPhysicals(HAND_PHASES.RIVER, {
    ...physicalCardsFromModel(model),
    river: riverCard,
  });
}

export function revealVillainModel(model) {
  assertPhase(model, [HAND_PHASES.RIVER]);
  return buildModelFromPhysicals(HAND_PHASES.SHOWDOWN, physicalCardsFromModel(model));
}

export function editKnownCardModel(model, token, nextCard, replacementVillainCards = null) {
  assertPhase(model, [HAND_PHASES.PREFLOP, HAND_PHASES.FLOP, HAND_PHASES.TURN, HAND_PHASES.RIVER, HAND_PHASES.SHOWDOWN]);
  const physicals = physicalCardsFromModel(model);
  if (token === "H_1" || token === "H_2") {
    physicals.hole[token === "H_1" ? 0 : 1] = rawCard(nextCard);
  } else if (token === "F_1" || token === "F_2" || token === "F_3") {
    assertPhase(model, [HAND_PHASES.FLOP, HAND_PHASES.TURN, HAND_PHASES.RIVER, HAND_PHASES.SHOWDOWN]);
    physicals.flop[Number(token.slice(-1)) - 1] = rawCard(nextCard);
  } else if (token === "T") {
    assertPhase(model, [HAND_PHASES.TURN, HAND_PHASES.RIVER, HAND_PHASES.SHOWDOWN]);
    physicals.turn = rawCard(nextCard);
  } else if (token === "R") {
    assertPhase(model, [HAND_PHASES.RIVER, HAND_PHASES.SHOWDOWN]);
    physicals.river = rawCard(nextCard);
  } else if (token === "V_1" || token === "V_2") {
    assertPhase(model, [HAND_PHASES.SHOWDOWN]);
    physicals.villain[token === "V_1" ? 0 : 1] = rawCard(nextCard);
  } else {
    throw new Error(`unknown editable card token: ${token}`);
  }

  if (replacementVillainCards) {
    validateCardCount(replacementVillainCards, 2, "replacement villain");
    physicals.villain = replacementVillainCards.map(rawCard);
  }

  const visibleKnownCards = [
    ...physicals.hole,
    ...physicals.flop,
    physicals.turn,
    physicals.river,
    ...(model.phase === HAND_PHASES.SHOWDOWN ? physicals.villain : []),
  ].filter(Boolean);
  rejectDuplicates(visibleKnownCards, "that card is already dealt somewhere else in this hand");

  const hiddenConflictCards = [...physicals.hole, ...physicals.flop, physicals.turn, physicals.river].filter(Boolean);
  if (
    model.phase !== HAND_PHASES.SHOWDOWN &&
    physicals.villain.some((card) => hiddenConflictCards.some((knownCard) => sameCard(card, knownCard)))
  ) {
    throw new Error("replacement villain cards are required after editing into a hidden villain conflict");
  }

  return buildModelFromPhysicals(model.phase, physicals);
}

export function rebuildTimeline(model) {
  if (![HAND_PHASES.PREFLOP, HAND_PHASES.FLOP, HAND_PHASES.TURN, HAND_PHASES.RIVER, HAND_PHASES.SHOWDOWN].includes(model.phase)) {
    return [];
  }
  const physicals = physicalCardsFromModel(model);
  const finalIndex = streetIndexForPhase(model.phase);
  return STREET_PHASES.slice(0, finalIndex + 1).map((phase) => {
    const streetModel = buildModelFromPhysicals(phase, projectedPhysicalsForPhase(physicals, phase));
    return model.phase === HAND_PHASES.SHOWDOWN && phase === HAND_PHASES.RIVER ? revealVillainModel(streetModel) : streetModel;
  });
}

export function legacyHandState(model) {
  if (![HAND_PHASES.PREFLOP, HAND_PHASES.FLOP, HAND_PHASES.TURN, HAND_PHASES.RIVER, HAND_PHASES.SHOWDOWN].includes(model.phase)) {
    return null;
  }
  return {
    round: model.phase === HAND_PHASES.SHOWDOWN ? HAND_PHASES.RIVER : model.phase,
    h1: model.hole[0],
    h2: model.hole[1],
    v1: model.villain[0],
    v2: model.villain[1],
    flop: [...model.flop],
    turn: model.turn,
    river: model.river,
    suitMap: new Map(model.suitMap),
  };
}

export function pendingHoleCards(model) {
  return [model.hole[0], model.hole[1]];
}

export function isShowdown(model) {
  return model.phase === HAND_PHASES.SHOWDOWN;
}

export function streetIndexForPhase(phase) {
  const normalized = phase === HAND_PHASES.SHOWDOWN ? HAND_PHASES.RIVER : phase;
  return STREET_PHASES.indexOf(normalized);
}

export function physicalCardsFromModel(model) {
  return {
    hole: model.hole.filter(Boolean).map(rawCard).sort(cardCompare),
    villain: model.villain.filter(Boolean).map(rawCard).sort(cardCompare),
    flop: model.flop.map(rawCard),
    turn: model.turn ? rawCard(model.turn) : null,
    river: model.river ? rawCard(model.river) : null,
  };
}

export function knownPhysicalCards(model, includeHiddenVillain = false) {
  const physicals = physicalCardsFromModel(model);
  return [
    ...physicals.hole,
    ...(includeHiddenVillain || model.phase === HAND_PHASES.SHOWDOWN ? physicals.villain : []),
    ...physicals.flop,
    physicals.turn,
    physicals.river,
  ].filter(Boolean);
}

export function assertCanonicalHandModel(model) {
  assertPhase(model, Object.values(HAND_PHASES));
  assertCardSlots(model);
  const physicals = physicalCardsFromModel(model);

  if (model.phase === HAND_PHASES.EMPTY) {
    assertEmptyStreetCards(model);
    assertNoDuplicateModelCards(model);
    return true;
  }

  if (model.phase === HAND_PHASES.PARTIAL_HOLDING) {
    assertEmptyStreetCards(model);
    assertSortedNullableHoleCards(model.hole);
    assertNoDuplicateModelCards(model);
    return true;
  }

  validateCardCount(model.hole.filter(Boolean), 2, "canonical holding");
  validateCardCount(model.villain.filter(Boolean), 2, "canonical villain");
  assertSortedCards(model.hole, "canonical holding");
  assertSortedCards(model.villain, "canonical villain");
  assertNoDuplicateModelCards(model);

  const expected = buildModelFromPhysicals(model.phase, physicals);
  assertEquivalentCanonicalModel(model, expected);
  return true;
}

export function buildModelFromPhysicals(phase, physicals) {
  const hole = physicals.hole.filter(Boolean).map(rawCard).sort(cardCompare);
  validateCardCount(hole, 2, "holding");
  const villain = physicals.villain.filter(Boolean).map(rawCard).sort(cardCompare);
  validateCardCount(villain, 2, "villain");
  const visibleKnownCards = [
    ...hole,
    ...physicals.flop,
    physicals.turn,
    physicals.river,
    ...(phase === HAND_PHASES.SHOWDOWN ? villain : []),
  ].filter(Boolean);
  rejectDuplicates(visibleKnownCards, "known cards cannot contain duplicates");
  rejectDuplicates([...hole, ...villain, ...physicals.flop, physicals.turn, physicals.river].filter(Boolean), "physical hand cannot contain duplicates");

  const [h1, h2] = hole;
  const relativeHoleCards = assignRelativeSuits(h1, h2);
  let suitMap = new Map([
    [relativeHoleCards.h1.suit, 1],
    [relativeHoleCards.h2.suit, relativeHoleCards.h2.relativeSuit],
  ]);
  const model = {
    phase,
    hole: [relativeHoleCards.h1, relativeHoleCards.h2],
    villain,
    flop: [],
    turn: null,
    river: null,
    suitMap,
  };

  if (streetIndexForPhase(phase) >= streetIndexForPhase(HAND_PHASES.FLOP)) {
    validateCardCount(physicals.flop, 3, "flop");
    const flop = assignFlopOrderAndSuits(physicals.flop, suitMap);
    model.flop = flop.orderedFlop;
    suitMap = flop.suitMap;
    model.suitMap = suitMap;
  }
  if (streetIndexForPhase(phase) >= streetIndexForPhase(HAND_PHASES.TURN)) {
    if (!physicals.turn) {
      throw new Error("turn phase requires a turn card");
    }
    const turn = assignSingleBoardCardAndSuit(physicals.turn, suitMap);
    model.turn = turn.card;
    suitMap = turn.suitMap;
    model.suitMap = suitMap;
  }
  if (streetIndexForPhase(phase) >= streetIndexForPhase(HAND_PHASES.RIVER)) {
    if (!physicals.river) {
      throw new Error("river phase requires a river card");
    }
    const river = assignSingleBoardCardAndSuit(physicals.river, suitMap);
    model.river = river.card;
    suitMap = river.suitMap;
    model.suitMap = suitMap;
  }
  if (phase === HAND_PHASES.SHOWDOWN) {
    const firstVillain = assignSingleBoardCardAndSuit(villain[0], suitMap);
    const secondVillain = assignSingleBoardCardAndSuit(villain[1], firstVillain.suitMap);
    model.villain = [firstVillain.card, secondVillain.card];
    model.suitMap = secondVillain.suitMap;
  }
  return freezeModel(model);
}

export function projectedPhysicalsForPhase(physicals, phase) {
  const streetIndex = streetIndexForPhase(phase);
  return {
    hole: [...physicals.hole],
    villain: [...physicals.villain],
    flop: streetIndex >= streetIndexForPhase(HAND_PHASES.FLOP) ? [...physicals.flop] : [],
    turn: streetIndex >= streetIndexForPhase(HAND_PHASES.TURN) ? physicals.turn : null,
    river: streetIndex >= streetIndexForPhase(HAND_PHASES.RIVER) ? physicals.river : null,
  };
}

export function assignRelativeSuits(h1, h2) {
  return {
    h1: { ...h1, relativeSuit: 1 },
    h2: { ...h2, relativeSuit: h1.suit === h2.suit ? 1 : 2 },
  };
}

export function assignFlopOrderAndSuits(flop, currentSuitMap) {
  const orderedRawFlop = [...flop].sort((first, second) => flopCardCompare(first, second, currentSuitMap));
  const suitMap = new Map(currentSuitMap);
  let nextRelativeSuit = Math.max(...suitMap.values()) + 1;
  const orderedFlop = orderedRawFlop.map((card) => {
    if (!suitMap.has(card.suit)) {
      suitMap.set(card.suit, nextRelativeSuit);
      nextRelativeSuit += 1;
    }
    return { ...rawCard(card), relativeSuit: suitMap.get(card.suit) };
  });
  return { orderedFlop, suitMap };
}

export function assignSingleBoardCardAndSuit(card, currentSuitMap) {
  const suitMap = new Map(currentSuitMap);
  if (!suitMap.has(card.suit)) {
    suitMap.set(card.suit, Math.max(...suitMap.values()) + 1);
  }
  return { card: { ...rawCard(card), relativeSuit: suitMap.get(card.suit) }, suitMap };
}

export function flopCardCompare(first, second, suitMap) {
  return first.rank - second.rank || relativeSuitSortValue(first, suitMap) - relativeSuitSortValue(second, suitMap);
}

export function relativeSuitSortValue(card, suitMap) {
  return suitMap.has(card.suit) ? suitMap.get(card.suit) : 100 + card.suit;
}

function assertPhase(model, phases) {
  if (!phases.includes(model.phase)) {
    throw new Error(`expected phase ${phases.join(" or ")}, got ${model.phase}`);
  }
}

function assertToken(token, tokens) {
  if (!tokens.includes(token)) {
    throw new Error(`expected token ${tokens.join(" or ")}, got ${token}`);
  }
}

function validateCardCount(cards, count, label) {
  if (cards.length !== count) {
    throw new Error(`${label} requires ${count} cards`);
  }
}

function rejectDuplicates(cards, message) {
  if (hasDuplicateCards(cards)) {
    throw new Error(message);
  }
}

function assertCardSlots(model) {
  if (!Array.isArray(model.hole) || model.hole.length !== 2) {
    throw new Error("canonical model requires exactly two hole-card slots");
  }
  if (!Array.isArray(model.villain) || model.villain.length !== 2) {
    throw new Error("canonical model requires exactly two villain-card slots");
  }
  if (!Array.isArray(model.flop)) {
    throw new Error("canonical model requires a flop array");
  }
  if (!(model.suitMap instanceof Map)) {
    throw new Error("canonical model requires a relative-suit map");
  }
  for (const card of [...model.hole, ...model.villain, ...model.flop, model.turn, model.river].filter(Boolean)) {
    assertPhysicalCardShape(card);
  }
}

function assertPhysicalCardShape(card) {
  if (!Number.isInteger(card.rank) || card.rank < 1 || card.rank > 13) {
    throw new Error("card rank must be an integer from 1 to 13");
  }
  if (!Number.isInteger(card.suit) || card.suit < 1 || card.suit > 4) {
    throw new Error("card suit must be an integer from 1 to 4");
  }
  if (card.id !== cardId(card)) {
    throw new Error("card id must match rank and suit");
  }
}

function assertEmptyStreetCards(model) {
  if (model.flop.length || model.turn || model.river) {
    throw new Error("empty or partial-holding phases cannot contain board cards");
  }
}

function assertNoDuplicateModelCards(model) {
  const includeHiddenVillain = model.phase === HAND_PHASES.SHOWDOWN;
  rejectDuplicates(knownPhysicalCards(model, includeHiddenVillain), "canonical model contains duplicate visible cards");
  rejectDuplicates(
    [
      ...model.hole,
      ...model.villain,
      ...model.flop,
      model.turn,
      model.river,
    ].filter(Boolean),
    "canonical model contains duplicate physical cards",
  );
}

function assertSortedNullableHoleCards(cards) {
  const knownCards = cards.filter(Boolean);
  assertSortedCards(knownCards, "pending holding");
}

function assertSortedCards(cards, label) {
  for (let index = 1; index < cards.length; index += 1) {
    if (cardCompare(cards[index - 1], cards[index]) > 0) {
      throw new Error(`${label} cards must be sorted in canonical order`);
    }
  }
}

function assertEquivalentCanonicalModel(actual, expected) {
  const comparableActual = comparableModel(actual);
  const comparableExpected = comparableModel(expected);
  if (JSON.stringify(comparableActual) !== JSON.stringify(comparableExpected)) {
    throw new Error("hand model is not in canonical rank, suit, token, and relative-suit order");
  }
}

function comparableModel(model) {
  return {
    phase: model.phase,
    hole: model.hole.map(comparableCard),
    villain: model.villain.map(comparableCard),
    flop: model.flop.map(comparableCard),
    turn: comparableCard(model.turn),
    river: comparableCard(model.river),
    suitMap: [...model.suitMap.entries()].sort(([first], [second]) => first - second),
  };
}

function comparableCard(card) {
  if (!card) {
    return null;
  }
  return {
    rank: card.rank,
    suit: card.suit,
    id: card.id,
    relativeSuit: card.relativeSuit ?? null,
  };
}

function freezeModel(model) {
  return Object.freeze({
    ...model,
    hole: Object.freeze([...model.hole]),
    villain: Object.freeze([...model.villain]),
    flop: Object.freeze([...model.flop]),
    suitMap: new Map(model.suitMap),
  });
}
