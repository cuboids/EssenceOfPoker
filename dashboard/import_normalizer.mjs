import { cardCompare } from "./cards.mjs";
import { normalizeTableConfig } from "./table_positions.mjs";

export function normalizeImportedHandForApp(history) {
  const heroPosition = history.hero?.position || firstKnownPosition(history) || "SB";
  const playerCount = clampPlayerCount(history.table?.players?.length || 2);
  const tableConfig = normalizeTableConfig({
    playerCount,
    heroPosition,
    playerStacks: Object.fromEntries(
      (history.table?.players || [])
        .filter((player) => player.position)
        .map((player) => [player.position, player.stack || 100]),
    ),
  });

  return {
    tableConfig,
    heroCards: [...(history.hero?.cards || [])].sort(cardCompare),
    boardCards: [
      ...(history.board?.flop || []),
      history.board?.turn,
      history.board?.river,
    ].filter(Boolean),
    playerActions: (history.actions || []).map((action, index) => ({
      id: action.id || `i${index + 1}`,
      player: action.player,
      street: action.street,
      type: action.type,
      ...(action.amount == null ? {} : { amount: action.amount }),
    })),
    source: {
      site: history.site,
      format: history.sourceFormat,
      handId: history.handId,
      warnings: history.warnings || [],
    },
  };
}

function firstKnownPosition(history) {
  return history.table?.players?.find((player) => player.position)?.position || null;
}

function clampPlayerCount(playerCount) {
  return Math.min(6, Math.max(2, Number(playerCount) || 2));
}
