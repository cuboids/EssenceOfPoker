import assert from "node:assert/strict";
import test from "node:test";

import {
  actionPositionsForStreet,
  activeVillainPositionsForConfig,
  activePositionsForPlayerCount,
  isVillainPage,
  normalizeFoldedVillainPositions,
  normalizeTableConfig,
  nextHeroPosition,
  positionDisplayName,
  positionFromPageKey,
  positionPageKey,
  villainPositionsForConfig,
} from "../dashboard/table_positions.mjs";

test("active positions follow short-handed to six-max order", () => {
  assert.deepEqual(activePositionsForPlayerCount(2), ["SB", "BB"]);
  assert.deepEqual(activePositionsForPlayerCount(3), ["BTN", "SB", "BB"]);
  assert.deepEqual(activePositionsForPlayerCount(4), ["CO", "BTN", "SB", "BB"]);
  assert.deepEqual(activePositionsForPlayerCount(5), ["HJ", "CO", "BTN", "SB", "BB"]);
  assert.deepEqual(activePositionsForPlayerCount(6), ["LJ", "HJ", "CO", "BTN", "SB", "BB"]);
});

test("action positions follow poker street order", () => {
  assert.deepEqual(actionPositionsForStreet({ playerCount: 6 }, "preflop"), ["LJ", "HJ", "CO", "BTN", "SB", "BB"]);
  assert.deepEqual(actionPositionsForStreet({ playerCount: 6 }, "flop"), ["SB", "BB", "LJ", "HJ", "CO", "BTN"]);
  assert.deepEqual(actionPositionsForStreet({ playerCount: 3 }, "preflop"), ["BTN", "SB", "BB"]);
  assert.deepEqual(actionPositionsForStreet({ playerCount: 3 }, "turn"), ["SB", "BB", "BTN"]);
  assert.deepEqual(actionPositionsForStreet({ playerCount: 2 }, "preflop"), ["SB", "BB"]);
  assert.deepEqual(actionPositionsForStreet({ playerCount: 2 }, "river"), ["BB", "SB"]);
});

test("position display names are human readable", () => {
  assert.equal(positionDisplayName("LJ"), "Lojack");
  assert.equal(positionDisplayName("HJ"), "Hijack");
  assert.equal(positionDisplayName("CO"), "Cutoff");
  assert.equal(positionDisplayName("BTN"), "Button");
  assert.equal(positionDisplayName("SB"), "Small blind");
  assert.equal(positionDisplayName("BB"), "Big blind");
});

test("villain positions are occupied seats excluding hero", () => {
  assert.deepEqual(villainPositionsForConfig({ playerCount: 2, heroPosition: "SB" }), ["BB"]);
  assert.deepEqual(villainPositionsForConfig({ playerCount: 6, heroPosition: "CO" }), ["BTN", "SB", "BB", "LJ", "HJ"]);
  assert.deepEqual(villainPositionsForConfig({ playerCount: 6, heroPosition: "BTN" }), ["SB", "BB", "LJ", "HJ", "CO"]);
});

test("table config normalizes invalid values to a legal seat", () => {
  assert.deepEqual(normalizeTableConfig({ playerCount: 9, heroPosition: "UTG" }), {
    playerCount: 2,
    heroPosition: "SB",
    positions: ["SB", "BB"],
    foldedVillainPositions: [],
    playerStacks: { SB: 100, BB: 100 },
  });
  assert.deepEqual(normalizeTableConfig({ playerCount: 4, heroPosition: "LJ" }), {
    playerCount: 4,
    heroPosition: "CO",
    positions: ["CO", "BTN", "SB", "BB"],
    foldedVillainPositions: [],
    playerStacks: { CO: 100, BTN: 100, SB: 100, BB: 100 },
  });
});

test("folded villain positions normalize to occupied non-hero seats", () => {
  assert.deepEqual(
    normalizeFoldedVillainPositions(
      { positions: ["CO", "BTN", "SB", "BB"], heroPosition: "BTN" },
      ["CO", "BTN", "LJ", "SB", "SB"],
    ),
    ["CO", "SB"],
  );
  assert.deepEqual(
    normalizeTableConfig({ playerCount: 6, heroPosition: "CO", foldedVillainPositions: ["BTN", "CO", "UTG", "HJ"] }),
    {
      playerCount: 6,
      heroPosition: "CO",
      positions: ["LJ", "HJ", "CO", "BTN", "SB", "BB"],
      foldedVillainPositions: ["HJ", "BTN"],
      playerStacks: { LJ: 100, HJ: 100, CO: 100, BTN: 100, SB: 100, BB: 100 },
    },
  );
});

test("player stacks normalize for active seats", () => {
  assert.deepEqual(
    normalizeTableConfig({ playerCount: 3, playerStacks: { BTN: 25, SB: "80.25", BB: -1, CO: 900 } }).playerStacks,
    { BTN: 25, SB: 80.3, BB: 100 },
  );
});

test("active villain positions exclude folded villains but keep table order", () => {
  assert.deepEqual(
    activeVillainPositionsForConfig({ playerCount: 6, heroPosition: "BTN", foldedVillainPositions: ["BB", "HJ"] }),
    ["SB", "LJ", "CO"],
  );
});

test("villain page keys are explicit and reversible", () => {
  assert.equal(positionPageKey("BB"), "villain:BB");
  assert.equal(positionFromPageKey("villain:HJ"), "HJ");
  assert.equal(positionFromPageKey("hero"), null);
  assert.equal(isVillainPage("villain:CO"), true);
  assert.equal(isVillainPage("villain"), false);
});

test("hero position advances correctly between hands", () => {
  assert.equal(nextHeroPosition({ playerCount: 2, heroPosition: "BB" }), "SB");
  assert.equal(nextHeroPosition({ playerCount: 2, heroPosition: "SB" }), "BB");
  assert.equal(nextHeroPosition({ playerCount: 6, heroPosition: "BB" }), "SB");
  assert.equal(nextHeroPosition({ playerCount: 6, heroPosition: "SB" }), "BTN");
  assert.equal(nextHeroPosition({ playerCount: 6, heroPosition: "BTN" }), "CO");
  assert.equal(nextHeroPosition({ playerCount: 6, heroPosition: "LJ" }), "BB");
});
