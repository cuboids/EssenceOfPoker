import { cardCompare, parsePhysicalCard } from "./cards.mjs";
import * as HandModel from "./hand_state.mjs";
import { chooseInterestingHero } from "./interesting_hero.mjs";
import { TABLE_POSITIONS, positionPageKey } from "./table_positions.mjs";

export function interestingHandToAppState(hand) {
  const players = (hand.players || [])
    .filter((player) => TABLE_POSITIONS.includes(player.position))
    .slice(0, 6);
  const heroPlayer = chooseInterestingHero(players, hand.actions || []);
  const heroPosition = heroPlayer?.position || "BB";
  const tableConfig = {
    playerCount: Math.min(6, Math.max(2, players.length || hand.max_players || 2)),
    heroPosition,
    playerStacks: Object.fromEntries(players.map((player) => [player.position, player.stack_bb || 100])),
  };
  const playerIdBySource = Object.fromEntries(players.map((player) => [
    player.source_player_id,
    player.position === heroPosition ? "hero" : positionPageKey(player.position),
  ]));
  const heroCards = sortedCardsFromTokens(heroPlayer?.hole_cards || []);
  const boardCards = orderedCardsFromTokens(hand.board || []).slice(0, 5);
  const showdownHoleCardsByPlayer = Object.fromEntries(
    players
      .filter((player) => player.position !== heroPosition)
      .map((player) => [positionPageKey(player.position), sortedCardsFromTokens(player.hole_cards || [])])
      .filter(([, cards]) => cards.length === 2),
  );
  return {
    tableConfig,
    heroCards,
    boardCards,
    showdownHoleCardsByPlayer,
    playerActions: (hand.actions || [])
      .map((action, index) => normalizeInterestingAction(action, index, playerIdBySource))
      .filter(Boolean),
  };
}

export function normalizeInterestingAction(action, index, playerIdBySource) {
  const player = playerIdBySource[action.player_id];
  if (!player) {
    return null;
  }
  return {
    id: `ih${index + 1}`,
    player,
    street: action.street,
    type: action.action_type,
    ...(action.amount_bb == null ? {} : { amount: action.amount_bb }),
  };
}

export function modelFromImportedHandReplay(imported, {
  dealHoleCards,
  dealCardsFromDeck,
  remainingDeckForKnownCards,
}) {
  const heroCards = imported.heroCards.length === 2
    ? imported.heroCards.sort(cardCompare)
    : dealHoleCards();
  const visibleCards = [...heroCards, ...imported.boardCards, ...Object.values(imported.showdownHoleCardsByPlayer).flat()];
  const firstVillainCards = (
    Object.values(imported.showdownHoleCardsByPlayer).find((cards) => cards.length === 2) ||
    dealCardsFromDeck(remainingDeckForKnownCards(visibleCards), 2)
  ).sort(cardCompare);
  let model = HandModel.startPreflopModel(heroCards, firstVillainCards);
  if (imported.boardCards.length >= 3) {
    model = HandModel.dealFlopModel(model, imported.boardCards.slice(0, 3));
  }
  if (imported.boardCards.length >= 4) {
    model = HandModel.dealTurnModel(model, imported.boardCards[3]);
  }
  if (imported.boardCards.length >= 5) {
    model = HandModel.dealRiverModel(model, imported.boardCards[4]);
    if (Object.keys(imported.showdownHoleCardsByPlayer).length) {
      model = HandModel.revealVillainModel(model);
    }
  }
  return model;
}

export function orderedCardsFromTokens(tokens) {
  return (tokens || []).map(parsePhysicalCard).filter(Boolean);
}

export function sortedCardsFromTokens(tokens) {
  return orderedCardsFromTokens(tokens).sort(cardCompare);
}
