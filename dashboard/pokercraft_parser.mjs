import { parsePhysicalCard } from "./cards.mjs";
import { canonicalHandHistory } from "./hand_history_model.mjs";
import {
  activePositionsForPlayerCount,
  normalizeTableConfig,
  positionPageKey,
} from "./table_positions.mjs";

const STREET_MARKERS = Object.freeze({
  "*** HOLE CARDS ***": "preflop",
  "*** FLOP ***": "flop",
  "*** TURN ***": "turn",
  "*** RIVER ***": "river",
});

const ACTION_TYPE_BY_VERB = Object.freeze({
  folds: "fold",
  checks: "check",
  calls: "call",
  bets: "bet",
  raises: "raise",
});

export function parsePokerCraftHandHistory(text) {
  const rawLines = String(text || "").split(/\r?\n/);
  const lines = rawLines.map((line) => line.trim()).filter(Boolean);
  const warnings = [];
  const players = [];
  const board = { flop: [], turn: null, river: null };
  const actions = [];
  let handId = "";
  let tableName = "";
  let buttonSeat = null;
  let smallBlind = null;
  let bigBlind = null;
  let heroName = "";
  let heroCards = [];
  let currentStreet = "preflop";

  for (const line of lines) {
    const header = parseHeader(line);
    if (header) {
      handId = header.handId || handId;
      smallBlind = header.smallBlind ?? smallBlind;
      bigBlind = header.bigBlind ?? bigBlind;
      continue;
    }

    const table = parseTableLine(line);
    if (table) {
      tableName = table.name || tableName;
      buttonSeat = table.buttonSeat ?? buttonSeat;
      continue;
    }

    const player = parseSeatLine(line);
    if (player) {
      players.push(player);
      continue;
    }

    const blind = parseBlindLine(line);
    if (blind) {
      smallBlind = blind.smallBlind ?? smallBlind;
      bigBlind = blind.bigBlind ?? bigBlind;
      continue;
    }

    const streetMarker = parseStreetMarker(line);
    if (streetMarker) {
      currentStreet = streetMarker.street;
      applyBoardCards(board, streetMarker.street, streetMarker.cards, streetMarker.cardGroups);
      continue;
    }

    const dealt = parseDealtLine(line);
    if (dealt) {
      heroName = dealt.player;
      heroCards = dealt.cards;
      continue;
    }

    const action = parseActionLine(line, currentStreet);
    if (action) {
      actions.push(action);
      continue;
    }
  }

  const positionedPlayers = assignPositions({ players, buttonSeat, heroName, warnings });
  const playerByName = new Map(positionedPlayers.map((player) => [player.name, player]));
  const normalizedActions = actions.map((action) => ({
    ...action,
    player: playerIdForName(action.playerName, playerByName, heroName),
  }));
  const heroPlayer = playerByName.get(heroName);

  return canonicalHandHistory({
    sourceFormat: "pokercraft",
    handId,
    stakes: { smallBlind, bigBlind },
    table: {
      name: tableName,
      maxPlayers: positionedPlayers.length,
      buttonSeat,
      players: positionedPlayers,
    },
    hero: {
      name: heroName,
      seat: heroPlayer?.seat ?? null,
      position: heroPlayer?.position ?? null,
      cards: heroCards,
    },
    board,
    actions: normalizedActions,
    rawLines,
    warnings,
  });
}

function parseHeader(line) {
  const handMatch = line.match(/(?:Poker Hand|Hand)\s+#?([A-Za-z0-9:-]+)/i);
  const blindMatch = line.match(/\((?:[^$€£\d-]*)([$€£]?\s*[\d,.]+)\s*\/\s*([$€£]?\s*[\d,.]+)/);
  if (!handMatch && !blindMatch) {
    return null;
  }
  return {
    handId: handMatch?.[1] || "",
    smallBlind: blindMatch ? parseAmount(blindMatch[1]) : null,
    bigBlind: blindMatch ? parseAmount(blindMatch[2]) : null,
  };
}

function parseTableLine(line) {
  const match = line.match(/^Table\s+'?([^']+?)'?\s+(?:\d+-max\s+)?Seat\s+#(\d+)\s+is\s+the\s+button/i);
  if (!match) {
    return null;
  }
  return {
    name: match[1].trim(),
    buttonSeat: Number(match[2]),
  };
}

function parseSeatLine(line) {
  const match = line.match(/^Seat\s+(\d+):\s+(.+?)\s+\(([^)]*?)(?:\s+in\s+chips)?\)$/i);
  if (!match) {
    return null;
  }
  return {
    seat: Number(match[1]),
    name: match[2].trim(),
    stack: parseAmount(match[3]),
  };
}

function parseBlindLine(line) {
  const small = line.match(/:\s+posts\s+small\s+blind\s+(.+)$/i);
  if (small) {
    return { smallBlind: parseAmount(small[1]) };
  }
  const big = line.match(/:\s+posts\s+big\s+blind\s+(.+)$/i);
  if (big) {
    return { bigBlind: parseAmount(big[1]) };
  }
  return null;
}

function parseStreetMarker(line) {
  for (const [marker, street] of Object.entries(STREET_MARKERS)) {
    if (line.startsWith(marker)) {
      const cardGroups = parseBracketedCardGroups(line);
      return { street, cards: cardGroups.flat(), cardGroups };
    }
  }
  return null;
}

function parseDealtLine(line) {
  const match = line.match(/^Dealt\s+to\s+(.+?)\s+\[([^\]]+)\]/i);
  if (!match) {
    return null;
  }
  return {
    player: match[1].trim(),
    cards: parseCards(match[2]),
  };
}

function parseActionLine(line, street) {
  const match = line.match(/^(.+?):\s+(folds|checks|calls|bets|raises)(?:\s+(.+?))?$/i);
  if (!match) {
    return null;
  }
  const verb = match[2].toLowerCase();
  const type = ACTION_TYPE_BY_VERB[verb];
  const amount = parseActionAmount(type, match[3] || "");
  return {
    playerName: match[1].trim(),
    street,
    type,
    ...(amount == null ? {} : { amount }),
  };
}

function parseActionAmount(type, text) {
  if (type === "fold" || type === "check") {
    return null;
  }
  const amounts = [...text.matchAll(/[$€£]?\s*[\d,.]+/g)].map((match) => parseAmount(match[0]));
  if (!amounts.length) {
    return null;
  }
  return amounts[0];
}

function parseBracketedCardGroups(line) {
  return [...line.matchAll(/\[([^\]]+)\]/g)].map((match) => parseCards(match[1]));
}

function parseCards(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .map(parsePokerCraftCard)
    .filter(Boolean);
}

function parsePokerCraftCard(token) {
  const normalized = String(token || "").trim().replace(/^10/i, "T");
  const match = normalized.match(/^([AKQJT98765432])([shdc♠♥♦♣])$/i);
  if (!match) {
    return parsePhysicalCard(normalized);
  }
  const rank = {
    A: 1,
    K: 2,
    Q: 3,
    J: 4,
    T: 5,
    9: 6,
    8: 7,
    7: 8,
    6: 9,
    5: 10,
    4: 11,
    3: 12,
    2: 13,
  }[match[1].toUpperCase()];
  const suit = { s: 1, "♠": 1, h: 2, "♥": 2, d: 3, "♦": 3, c: 4, "♣": 4 }[match[2].toLowerCase()];
  return { rank, suit, id: (rank - 1) * 4 + (suit - 1) };
}

function applyBoardCards(board, street, cards, cardGroups = []) {
  if (street === "flop") {
    board.flop = (cardGroups[0] || cards).slice(0, 3);
  } else if (street === "turn") {
    board.turn = (cardGroups[1] || [cards[cards.length - 1]])[0] || null;
  } else if (street === "river") {
    board.river = (cardGroups[1] || [cards[cards.length - 1]])[0] || null;
  }
}

function assignPositions({ players, buttonSeat, heroName, warnings }) {
  if (!players.length) {
    warnings.push("No seat lines found.");
    return [];
  }
  const sorted = [...players].sort((first, second) => first.seat - second.seat);
  const positions = activePositionsForPlayerCount(Math.min(6, Math.max(2, sorted.length)));
  const buttonIndex = sorted.findIndex((player) => player.seat === buttonSeat);
  if (buttonIndex < 0) {
    warnings.push("Button seat not found; assigning positions by seat order.");
  }

  const rotated = buttonIndex >= 0
    ? [...sorted.slice(buttonIndex), ...sorted.slice(0, buttonIndex)]
    : sorted;
  const positionCycle = positionsFromButton(positions);
  const bySeat = new Map(
    rotated.map((player, index) => [player.seat, {
      ...player,
      position: positionCycle[index] || null,
      role: player.name === heroName ? "hero" : "villain",
    }]),
  );
  return sorted.map((player) => bySeat.get(player.seat));
}

function positionsFromButton(positions) {
  const config = normalizeTableConfig({ playerCount: positions.length, heroPosition: positions[0] });
  if (positions.length === 2) {
    return ["SB", "BB"];
  }
  const postButton = ["BTN", "SB", "BB", "LJ", "HJ", "CO"];
  return postButton.filter((position) => config.positions.includes(position));
}

function playerIdForName(name, playerByName, heroName) {
  if (name === heroName) {
    return "hero";
  }
  const player = playerByName.get(name);
  return player?.position ? positionPageKey(player.position) : `unknown:${name}`;
}

function parseAmount(text) {
  const normalized = String(text || "").replace(/[,$€£]/g, "").trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}
