import { ACTION_STREETS, ACTION_TYPES, normalizePlayerAction } from "./player_actions.mjs";

export const SUPPORTED_HAND_HISTORY_FORMATS = Object.freeze(["pokercraft"]);

export function canonicalHandHistory({
  site = "GGPoker",
  sourceFormat = "pokercraft",
  handId = "",
  game = "NLHE",
  stakes = {},
  table = {},
  hero = {},
  board = {},
  actions = [],
  rawLines = [],
  warnings = [],
} = {}) {
  if (!SUPPORTED_HAND_HISTORY_FORMATS.includes(sourceFormat)) {
    throw new Error(`unsupported hand-history source format: ${sourceFormat}`);
  }
  return {
    site,
    sourceFormat,
    handId: String(handId || ""),
    game,
    stakes: normalizeStakes(stakes),
    table: normalizeHistoryTable(table),
    hero: normalizeHero(hero),
    board: normalizeBoard(board),
    actions: actions.map(normalizeHistoryAction),
    rawLines: Array.isArray(rawLines) ? rawLines.map(String) : [],
    warnings: Array.isArray(warnings) ? warnings.map(String) : [],
  };
}

export function normalizeHistoryAction(action) {
  return normalizePlayerAction({
    ...action,
    street: assertOneOf(action.street, ACTION_STREETS, "street"),
    type: assertOneOf(action.type, ACTION_TYPES, "action type"),
  });
}

function normalizeStakes(stakes) {
  return {
    smallBlind: normalizeOptionalAmount(stakes.smallBlind),
    bigBlind: normalizeOptionalAmount(stakes.bigBlind),
    ante: normalizeOptionalAmount(stakes.ante),
  };
}

function normalizeHistoryTable(table) {
  return {
    name: String(table.name || ""),
    maxPlayers: normalizeOptionalInteger(table.maxPlayers),
    buttonSeat: normalizeOptionalInteger(table.buttonSeat),
    players: Array.isArray(table.players) ? table.players.map(normalizeHistoryPlayer) : [],
  };
}

function normalizeHistoryPlayer(player) {
  return {
    seat: normalizeOptionalInteger(player.seat),
    name: String(player.name || ""),
    stack: normalizeOptionalAmount(player.stack),
    position: player.position || null,
    role: player.role || null,
  };
}

function normalizeHero(hero) {
  return {
    name: String(hero.name || ""),
    seat: normalizeOptionalInteger(hero.seat),
    position: hero.position || null,
    cards: Array.isArray(hero.cards) ? hero.cards : [],
  };
}

function normalizeBoard(board) {
  return {
    flop: Array.isArray(board.flop) ? board.flop : [],
    turn: board.turn || null,
    river: board.river || null,
  };
}

function normalizeOptionalAmount(value) {
  if (value == null || value === "") {
    return null;
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 1000) / 1000 : null;
}

function normalizeOptionalInteger(value) {
  if (value == null || value === "") {
    return null;
  }
  const integer = Number(value);
  return Number.isInteger(integer) ? integer : null;
}

function assertOneOf(value, options, label) {
  if (!options.includes(value)) {
    throw new Error(`${label} must be one of ${options.join(", ")}`);
  }
  return value;
}
