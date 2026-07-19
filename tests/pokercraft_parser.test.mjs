import assert from "node:assert/strict";
import test from "node:test";

import { cardCompare, cardKey, sameCard } from "../dashboard/cards.mjs";
import {
  assertCanonicalHandModel,
  dealFlopModel,
  dealRiverModel,
  dealTurnModel,
  startPreflopModel,
} from "../dashboard/hand_state.mjs";
import { handViewFromModel } from "../dashboard/hand_view.mjs";
import { normalizeImportedHandForApp } from "../dashboard/import_normalizer.mjs";
import { validateActionSequence } from "../dashboard/player_actions.mjs";
import { parsePokerCraftHandHistory } from "../dashboard/pokercraft_parser.mjs";
import { actionPositionsForStreet, positionPageKey } from "../dashboard/table_positions.mjs";

const sample = `
Poker Hand #RC123456: Hold'em No Limit ($0.50/$1.00) - 2026/07/19 09:02:11
Table 'RushAndCash123' 6-max Seat #4 is the button
Seat 1: Alice ($100 in chips)
Seat 2: Bob ($100 in chips)
Seat 3: Hero ($100 in chips)
Seat 4: Dina ($100 in chips)
Seat 5: Evan ($100 in chips)
Seat 6: Finn ($100 in chips)
Evan: posts small blind $0.50
Finn: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ks Td]
Alice: raises $3 to $3
Bob: folds
Hero: calls $3
Dina: folds
Evan: folds
Finn: calls $2
*** FLOP *** [Ah 7d 2c]
Finn: checks
Alice: bets $4
Hero: calls $4
Finn: folds
*** TURN *** [Ah 7d 2c] [Kc]
Alice: checks
Hero: bets $10
Alice: calls $10
*** RIVER *** [Ah 7d 2c Kc] [3s]
Alice: checks
Hero: checks
`;

test("PokerCraft parser extracts seats, positions, cards, board, and actions", () => {
  const history = parsePokerCraftHandHistory(sample);

  assert.equal(history.sourceFormat, "pokercraft");
  assert.equal(history.handId, "RC123456:");
  assert.equal(history.stakes.smallBlind, 0.5);
  assert.equal(history.stakes.bigBlind, 1);
  assert.equal(history.hero.name, "Hero");
  assert.equal(history.hero.position, "CO");
  assert.deepEqual(history.hero.cards.map(cardKey), ["2.1", "5.3"]);
  assert.deepEqual(history.board.flop.map(cardKey), ["1.2", "8.3", "13.4"]);
  assert.equal(cardKey(history.board.turn), "2.4");
  assert.equal(cardKey(history.board.river), "12.1");

  assert.deepEqual(
    history.table.players.map((player) => [player.name, player.position, player.role]),
    [
      ["Alice", "LJ", "villain"],
      ["Bob", "HJ", "villain"],
      ["Hero", "CO", "hero"],
      ["Dina", "BTN", "villain"],
      ["Evan", "SB", "villain"],
      ["Finn", "BB", "villain"],
    ],
  );
  assert.deepEqual(
    history.actions.slice(0, 6).map((action) => [action.player, action.street, action.type, action.amount]),
    [
      ["villain:LJ", "preflop", "raise", 3],
      ["villain:HJ", "preflop", "fold", undefined],
      ["hero", "preflop", "call", 3],
      ["villain:BTN", "preflop", "fold", undefined],
      ["villain:SB", "preflop", "fold", undefined],
      ["villain:BB", "preflop", "call", 2],
    ],
  );
});

test("import normalizer returns app-level table config and linear actions", () => {
  const imported = normalizeImportedHandForApp(parsePokerCraftHandHistory(sample));

  assert.deepEqual(imported.tableConfig.positions, ["LJ", "HJ", "CO", "BTN", "SB", "BB"]);
  assert.equal(imported.tableConfig.heroPosition, "CO");
  assert.deepEqual(imported.heroCards.map(cardKey), ["2.1", "5.3"]);
  assert.deepEqual(imported.boardCards.map(cardKey), ["1.2", "8.3", "13.4", "2.4", "12.1"]);
  assert.deepEqual(imported.playerActions.slice(0, 3), [
    { id: "i1", player: "villain:LJ", street: "preflop", type: "raise", amount: 3 },
    { id: "i2", player: "villain:HJ", street: "preflop", type: "fold" },
    { id: "i3", player: "hero", street: "preflop", type: "call", amount: 3 },
  ]);
});

test("imported PokerCraft hand is equivalent to manual canonical app entry", () => {
  const imported = normalizeImportedHandForApp(parsePokerCraftHandHistory(sample));
  const villainCards = [
    { rank: 4, suit: 1, id: 12 },
    { rank: 6, suit: 2, id: 21 },
  ].filter((candidate) =>
    ![...imported.heroCards, ...imported.boardCards].some((known) => sameCard(candidate, known)),
  );
  let model = startPreflopModel(imported.heroCards, villainCards.sort(cardCompare));
  model = dealFlopModel(model, imported.boardCards.slice(0, 3));
  model = dealTurnModel(model, imported.boardCards[3]);
  model = dealRiverModel(model, imported.boardCards[4]);

  assert.equal(assertCanonicalHandModel(model), true);
  const state = handViewFromModel(model);
  assert.deepEqual([state.h1, state.h2].map(cardKey), imported.heroCards.map(cardKey));
  assert.deepEqual([...state.flop, state.turn, state.river].map(cardKey), imported.boardCards.map(cardKey));
  assert.equal(validateActionSequence(imported.playerActions, {
    orderForStreet: (street) => actionPositionsForStreet(imported.tableConfig, street).map((position) =>
      position === imported.tableConfig.heroPosition ? "hero" : positionPageKey(position),
    ),
    stacks: Object.fromEntries(imported.tableConfig.positions.map((position) => [
      position === imported.tableConfig.heroPosition ? "hero" : positionPageKey(position),
      imported.tableConfig.playerStacks[position],
    ])),
    smallBlindPlayer: positionPageKey("SB"),
    bigBlindPlayer: positionPageKey("BB"),
    smallBlind: 0.5,
    bigBlind: 1,
  }), true);
});
