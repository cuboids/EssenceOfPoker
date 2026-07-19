export const TABLE_POSITIONS = Object.freeze(["LJ", "HJ", "CO", "BTN", "SB", "BB"]);
export const PLAYER_COUNTS = Object.freeze([2, 3, 4, 5, 6]);
export const POSITION_LABELS = Object.freeze({
  LJ: "Lojack",
  HJ: "Hijack",
  CO: "Cutoff",
  BTN: "Button",
  SB: "Small blind",
  BB: "Big blind",
});

const ACTIVE_POSITIONS_BY_COUNT = Object.freeze({
  2: Object.freeze(["SB", "BB"]),
  3: Object.freeze(["BTN", "SB", "BB"]),
  4: Object.freeze(["CO", "BTN", "SB", "BB"]),
  5: Object.freeze(["HJ", "CO", "BTN", "SB", "BB"]),
  6: TABLE_POSITIONS,
});

export function activePositionsForPlayerCount(playerCount) {
  return ACTIVE_POSITIONS_BY_COUNT[playerCount] || ACTIVE_POSITIONS_BY_COUNT[2];
}

export function normalizeTableConfig({
  playerCount = 2,
  heroPosition = null,
  foldedVillainPositions: requestedFoldedVillainPositions = [],
  playerStacks: requestedPlayerStacks = {},
} = {}) {
  const normalizedPlayerCount = PLAYER_COUNTS.includes(Number(playerCount)) ? Number(playerCount) : 2;
  const activePositions = activePositionsForPlayerCount(normalizedPlayerCount);
  const normalizedHeroPosition = activePositions.includes(heroPosition) ? heroPosition : activePositions[0];
  const foldedVillainPositions = normalizeFoldedVillainPositions({
    positions: activePositions,
    heroPosition: normalizedHeroPosition,
  }, requestedFoldedVillainPositions);
  return {
    playerCount: normalizedPlayerCount,
    heroPosition: normalizedHeroPosition,
    positions: activePositions,
    foldedVillainPositions,
    playerStacks: normalizePlayerStacks(activePositions, requestedPlayerStacks),
  };
}

export function normalizePlayerStacks(positions, playerStacks = {}) {
  return Object.fromEntries(
    positions.map((position) => [position, normalizeStack(playerStacks[position])]),
  );
}

function normalizeStack(value) {
  const stack = Number(value);
  return Number.isFinite(stack) && stack > 0 ? Math.round(stack * 10) / 10 : 100;
}

export function villainPositionsForConfig(config) {
  const normalized = normalizeTableConfig(config);
  const heroIndex = normalized.positions.indexOf(normalized.heroPosition);
  return [
    ...normalized.positions.slice(heroIndex + 1),
    ...normalized.positions.slice(0, heroIndex),
  ];
}

export function normalizeFoldedVillainPositions(config, foldedVillainPositions = []) {
  const positions = config.positions || activePositionsForPlayerCount(config.playerCount);
  const folded = Array.isArray(foldedVillainPositions) ? foldedVillainPositions : [];
  return positions.filter((position) => position !== config.heroPosition && folded.includes(position));
}

export function activeVillainPositionsForConfig(config) {
  const normalized = normalizeTableConfig(config);
  const folded = new Set(normalized.foldedVillainPositions);
  return villainPositionsForConfig(normalized).filter((position) => !folded.has(position));
}

export function actionPositionsForStreet(config, street) {
  const normalized = normalizeTableConfig(config);
  if (street === "preflop") {
    return normalized.positions;
  }
  if (normalized.playerCount === 2) {
    return ["BB", "SB"].filter((position) => normalized.positions.includes(position));
  }
  return ["SB", "BB", "LJ", "HJ", "CO", "BTN"].filter((position) => normalized.positions.includes(position));
}

export function nextHeroPosition(config) {
  const normalized = normalizeTableConfig(config);
  const currentIndex = normalized.positions.indexOf(normalized.heroPosition);
  const nextIndex = (currentIndex - 1 + normalized.positions.length) % normalized.positions.length;
  return normalized.positions[nextIndex];
}

export function positionPageKey(position) {
  return `villain:${position}`;
}

export function positionFromPageKey(pageKey) {
  return typeof pageKey === "string" && pageKey.startsWith("villain:") ? pageKey.slice("villain:".length) : null;
}

export function isVillainPage(pageKey) {
  return Boolean(positionFromPageKey(pageKey));
}

export function positionDisplayName(position) {
  return POSITION_LABELS[position] || position;
}
