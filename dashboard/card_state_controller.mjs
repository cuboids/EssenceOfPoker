import { fullDeck, sameCard } from "./cards.mjs";

export function createCardStateController(deps) {
  function knownCardsForHand() {
    const handState = deps.handState();
    if (!handState) {
      return [];
    }
    return [handState.h1, handState.h2, ...handState.flop, handState.turn, handState.river].filter(Boolean);
  }

  function allDealtCardsForDeck(page = null) {
    if (!deps.handState()) {
      return [];
    }
    return [...knownCardsForHand(), ...showdownHoleCardsForDeadCards(page)].filter(Boolean);
  }

  function showdownHoleCardsForDeadCards(page = null) {
    const handState = deps.handState();
    if (!deps.villainShowdown()) {
      return handState?.v1 && handState?.v2 ? [handState.v1, handState.v2] : [];
    }
    if (deps.isOpponentPage(page)) {
      return deps.showdownHoleCardsForPlayer(page);
    }
    return Object.values(deps.showdownHoleCardsByPlayer()).flat();
  }

  function remainingDeckForKnownCards(knownCards) {
    return fullDeck.filter((card) => !knownCards.some((knownCard) => sameCard(card, knownCard)));
  }

  function missingBoardTokens() {
    const state = currentKnownBoardState();
    return ["F_1", "F_2", "F_3", "T", "R"].filter((token) => !state[token]);
  }

  function aggregateTokensForPage(page) {
    return deps.isOpponentPage(page)
      ? ["V_1", "V_2", "F_1", "F_2", "F_3", "T", "R"]
      : ["H_1", "H_2", "F_1", "F_2", "F_3", "T", "R"];
  }

  function currentKnownBoardState() {
    const handState = deps.handState();
    const state = {};
    if (!handState) {
      return state;
    }
    if (handState.flop[0]) {
      state.F_1 = handState.flop[0];
    }
    if (handState.flop[1]) {
      state.F_2 = handState.flop[1];
    }
    if (handState.flop[2]) {
      state.F_3 = handState.flop[2];
    }
    if (handState.turn) {
      state.T = handState.turn;
    }
    if (handState.river) {
      state.R = handState.river;
    }
    return state;
  }

  function currentKnownHeroState() {
    const handState = deps.handState();
    if (!handState) {
      return {};
    }
    return {
      H_1: handState.h1,
      H_2: handState.h2,
      ...currentKnownBoardState(),
    };
  }

  function currentKnownVillainState() {
    return currentKnownVillainStateForPage(deps.activePage());
  }

  function currentKnownVillainStateForPage(page) {
    const handState = deps.handState();
    if (!handState) {
      return {};
    }
    const [v1, v2] = deps.showdownHoleCardsForPlayer(page);
    return {
      ...(deps.villainShowdown() && v1 && v2 ? { V_1: v1, V_2: v2 } : {}),
      ...currentKnownBoardState(),
    };
  }

  function currentBoardCards() {
    const handState = deps.handState();
    if (!handState) {
      return [];
    }
    return [...handState.flop, handState.turn, handState.river].filter(Boolean);
  }

  function knownCardsForAsset(asset, page = deps.activePage()) {
    return asset.name
      .split(" + ")
      .map((token) => deps.cardForTokenOnPage(token, page))
      .filter(Boolean);
  }

  return {
    aggregateTokensForPage,
    allDealtCardsForDeck,
    currentBoardCards,
    currentKnownBoardState,
    currentKnownHeroState,
    currentKnownVillainState,
    currentKnownVillainStateForPage,
    knownCardsForAsset,
    knownCardsForHand,
    missingBoardTokens,
    remainingDeckForKnownCards,
    showdownHoleCardsForDeadCards,
  };
}
