import { cardId } from "./cards.mjs";

export function buildAsyncSnapshotKey({
  assetVersion,
  purpose,
  page,
  handModel,
  handState,
  viewedStreetIndex,
  viewedActionCount,
  visibleActions = [],
  tableConfig = {},
  activeVillains = [],
  villainShowdown = false,
  showdownHoleCardsByPlayer = {},
} = {}) {
  return stableJson({
    assetVersion,
    purpose,
    page,
    phase: handModel?.phase || null,
    round: handState?.round || null,
    viewedStreetIndex,
    viewedActionCount,
    knownCards: knownCardIds(handState),
    hiddenVillainCards: (handModel?.villain || []).filter(Boolean).map(cardId).sort((a, b) => a - b),
    visibleActions: visibleActions.map(actionKey),
    table: {
      playerCount: tableConfig.playerCount,
      heroPosition: tableConfig.heroPosition,
      positions: tableConfig.positions || [],
      stacks: tableConfig.playerStacks || {},
    },
    activeVillains,
    villainShowdown,
    showdownCards: Object.fromEntries(
      Object.entries(showdownHoleCardsByPlayer || {})
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([player, cards]) => [player, (cards || []).filter(Boolean).map(cardId).sort((a, b) => a - b)]),
    ),
  });
}

export function createAsyncStateGuard({ captureKey, captureToken, currentKey, currentToken }) {
  return {
    key: captureKey,
    token: captureToken,
    isCurrent() {
      return captureToken === currentToken() && captureKey === currentKey();
    },
  };
}

function knownCardIds(handState) {
  if (!handState) {
    return [];
  }
  return [
    handState.h1,
    handState.h2,
    ...(handState.flop || []),
    handState.turn,
    handState.river,
  ].filter(Boolean).map(cardId);
}

function actionKey(action) {
  return {
    id: action.id || null,
    player: action.player,
    street: action.street,
    type: action.type,
    amount: action.amount ?? null,
  };
}

function stableJson(value) {
  return JSON.stringify(normalize(value));
}

function normalize(value) {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, nested]) => [key, normalize(nested)]),
  );
}
