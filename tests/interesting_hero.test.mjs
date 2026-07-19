import assert from "node:assert/strict";
import test from "node:test";

import { chooseInterestingHero } from "../dashboard/interesting_hero.mjs";

const player = (id, position, holeCards = ["As", "Kd"], extra = {}) => ({
  source_player_id: id,
  position,
  hole_cards: holeCards,
  ...extra,
});

test("interesting hero prefers a player who stays live over a preflop-folding big blind", () => {
  const players = [
    player("lj", "LJ"),
    player("bb", "BB"),
    player("btn", "BTN"),
  ];
  const actions = [
    { player_id: "lj", street: "preflop", action_type: "raise" },
    { player_id: "btn", street: "preflop", action_type: "call" },
    { player_id: "bb", street: "preflop", action_type: "fold" },
    { player_id: "lj", street: "flop", action_type: "bet" },
    { player_id: "btn", street: "flop", action_type: "call" },
    { player_id: "lj", street: "turn", action_type: "check" },
    { player_id: "btn", street: "turn", action_type: "bet" },
  ];

  assert.equal(chooseInterestingHero(players, actions).source_player_id, "btn");
});

test("interesting hero does not choose by winner, only by live involvement", () => {
  const players = [
    player("co", "CO"),
    player("btn", "BTN", ["Qh", "Qs"]),
  ];
  const actions = [
    { player_id: "co", street: "preflop", action_type: "raise" },
    { player_id: "btn", street: "preflop", action_type: "call" },
    { player_id: "co", street: "flop", action_type: "bet" },
    { player_id: "btn", street: "flop", action_type: "call" },
    { player_id: "co", street: "river", action_type: "check" },
    { player_id: "btn", street: "river", action_type: "check" },
  ];

  assert.equal(chooseInterestingHero(players, actions).source_player_id, "co");
});

test("interesting hero falls back to the original marked hero among equivalent live candidates", () => {
  const players = [
    player("sb", "SB"),
    player("bb", "BB", ["Ah", "Ad"], { is_hero: true }),
  ];

  assert.equal(chooseInterestingHero(players, []).source_player_id, "bb");
});
