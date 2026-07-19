import assert from "node:assert/strict";
import test from "node:test";

import { preflopClassKeyForCards } from "../dashboard/cache_keys.mjs";
import { cardKey } from "../dashboard/cards.mjs";
import {
  amountBucketForAction,
  empiricalActionProbability,
  empiricalSpotRequest,
  empiricalTargetFrequency,
} from "../dashboard/empirical_range_model.mjs";
import { applyArchetypeActionProfile, handClassStrength, normalizeArchetypeWeights } from "../dashboard/player_archetypes.mjs";
import { computeMultiwayAggregateEquities } from "../dashboard/multiway_equity.mjs";
import {
  createUniformPreflopRange,
  targetFrequencyForAction,
  thresholdForTarget,
  updatePreflopRangeForAction,
} from "../dashboard/range_model.mjs";
import { legalTwoCardCombos } from "../dashboard/range_universe.mjs";
import { inferRanges } from "../dashboard/range_inference.mjs";
import { inferPreflopRanges } from "../dashboard/range_update.mjs";
import { DEFAULT_PREFLOP_RANGE_MODEL, rangeModelArtifact } from "../dashboard/range_model_defaults.mjs";
import { rangeExplanation } from "../dashboard/range_explainability.mjs";

const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("range model defaults are isolated as a frozen versionable artifact", () => {
  assert.equal(DEFAULT_PREFLOP_RANGE_MODEL.name, "heuristic_empirical_hybrid");
  assert.equal(Object.isFrozen(DEFAULT_PREFLOP_RANGE_MODEL), true);
  assert.equal(Object.isFrozen(DEFAULT_PREFLOP_RANGE_MODEL.openRaiseFrequency[6]), true);
  assert.deepEqual(rangeModelArtifact(DEFAULT_PREFLOP_RANGE_MODEL), {
    kind: "range_model_parameters",
    name: "heuristic_empirical_hybrid",
    version: "heuristic_empirical_hybrid",
    model: DEFAULT_PREFLOP_RANGE_MODEL,
  });
});

test("range universe enumerates legal two-card combos and respects blockers", () => {
  const combos = legalTwoCardCombos();
  assert.equal(combos.length, 1326);
  assert.equal(new Set(combos.map((combo) => combo.id)).size, 1326);

  const blocked = legalTwoCardCombos({ deadCards: [card(1, 1), card(2, 2)] });
  assert.equal(blocked.length, 1225);
  assert.equal(blocked.some((combo) => combo.cards.some((comboCard) => cardKey(comboCard) === "1.1")), false);
});

test("threshold calibration hits target frequency smoothly", () => {
  const range = createUniformPreflopRange({ player: "villain:LJ", position: "LJ" });
  const threshold = thresholdForTarget(range.combos, 0.16);
  const continued = updatePreflopRangeForAction(range, { player: "villain:LJ", street: "preflop", type: "raise", amount: 3 }, { position: "LJ" });

  assert.equal(range.modelMetadata.version, "range-engine-v1");
  assert.equal(range.modelMetadata.source, "uniform");
  assert.ok(Number.isFinite(threshold));
  assert.ok(continued.summary.frequency > 0.14);
  assert.ok(continued.summary.frequency < 0.18);
  assert.equal(continued.modelMetadata.source, "heuristic");
  assert.equal(continued.history.at(-1).modelMetadata.version, "range-engine-v1");
});

test("position and sizing change preflop opening ranges", () => {
  const lj = updatePreflopRangeForAction(
    createUniformPreflopRange({ player: "villain:LJ", position: "LJ" }),
    { player: "villain:LJ", street: "preflop", type: "raise", amount: 3 },
    { position: "LJ" },
  );
  const btn = updatePreflopRangeForAction(
    createUniformPreflopRange({ player: "villain:BTN", position: "BTN" }),
    { player: "villain:BTN", street: "preflop", type: "raise", amount: 3 },
    { position: "BTN" },
  );
  const bigLJ = updatePreflopRangeForAction(
    createUniformPreflopRange({ player: "villain:LJ", position: "LJ" }),
    { player: "villain:LJ", street: "preflop", type: "raise", amount: 5 },
    { position: "LJ" },
  );

  assert.ok(lj.summary.frequency < btn.summary.frequency);
  assert.ok(bigLJ.summary.frequency < lj.summary.frequency);
});

test("preflop frequencies depend on table size", () => {
  const headsUpSmallBlind = targetFrequencyForAction(
    { player: "hero", street: "preflop", type: "raise", amount: 3 },
    { position: "SB", playerCount: 2 },
  );
  const sixMaxSmallBlind = targetFrequencyForAction(
    { player: "villain:SB", street: "preflop", type: "raise", amount: 3 },
    { position: "SB", playerCount: 6 },
  );
  const threeMaxButton = targetFrequencyForAction(
    { player: "villain:BTN", street: "preflop", type: "raise", amount: 3 },
    { position: "BTN", playerCount: 3 },
  );
  const sixMaxButton = targetFrequencyForAction(
    { player: "villain:BTN", street: "preflop", type: "raise", amount: 3 },
    { position: "BTN", playerCount: 6 },
  );

  assert.ok(headsUpSmallBlind > sixMaxSmallBlind);
  assert.ok(sixMaxButton > threeMaxButton);
});

test("preflop aggression depth tightens open, three-bet, four-bet, and five-bet targets", () => {
  const open = targetFrequencyForAction(
    { player: "hero", street: "preflop", type: "bet", amount: 3 },
    { position: "BTN", playerCount: 6, facingAggression: false, preflopAggressiveActionsBefore: 0 },
  );
  const threeBet = targetFrequencyForAction(
    { player: "hero", street: "preflop", type: "raise", amount: 3 },
    { position: "BTN", playerCount: 6, facingAggression: true, preflopAggressiveActionsBefore: 1 },
  );
  const fourBet = targetFrequencyForAction(
    { player: "hero", street: "preflop", type: "raise", amount: 3 },
    { position: "BTN", playerCount: 6, facingAggression: true, preflopAggressiveActionsBefore: 2 },
  );
  const fiveBet = targetFrequencyForAction(
    { player: "hero", street: "preflop", type: "raise", amount: 3 },
    { position: "BTN", playerCount: 6, facingAggression: true, preflopAggressiveActionsBefore: 3 },
  );

  assert.ok(open > threeBet);
  assert.ok(fourBet > threeBet);
  assert.ok(fiveBet > fourBet);
  assert.ok(fourBet < 0.16);
});

test("range inference passes table size into action calibration", () => {
  const action = { id: "a1", player: "hero", street: "preflop", type: "raise", amount: 3 };
  const headsUp = inferRanges({
    tableConfig: { playerCount: 2, heroPosition: "SB", positions: ["SB", "BB"] },
    actions: [action],
  });
  const sixMax = inferPreflopRanges({
    tableConfig: { playerCount: 6, heroPosition: "SB", positions: ["LJ", "HJ", "CO", "BTN", "SB", "BB"] },
    actions: [action],
  });

  assert.ok(headsUp.hero.summary.frequency > sixMax.hero.summary.frequency);
});

test("empirical four-bet buckets are capped by tactical aggression depth", () => {
  const actions = [
    { id: "a1", player: "villain:LJ", street: "preflop", type: "fold" },
    { id: "a2", player: "villain:HJ", street: "preflop", type: "fold" },
    { id: "a3", player: "villain:CO", street: "preflop", type: "fold" },
    { id: "a4", player: "hero", street: "preflop", type: "bet", amount: 3 },
    { id: "a5", player: "villain:SB", street: "preflop", type: "raise", amount: 10 },
    { id: "a6", player: "villain:BB", street: "preflop", type: "fold" },
    { id: "a7", player: "hero", street: "preflop", type: "raise", amount: 24 },
  ];
  const broadFourBetSpot = {
    request: { street: "preflop", position: "BTN", playerCount: 6, facingAggression: true, amountBucket: "overbet" },
    spotProbabilities: { fold: 0.1, check: 0, call: 0.2, bet: 0, raise: 0.66, "all-in": 0.04 },
    handClasses: Object.fromEntries(
      ["1-1-pair", "1-2-suited", "2-2-pair", "5-5-pair", "12-13-offsuit"].map((classKey) => [
        classKey,
        { probabilities: { fold: 0.1, check: 0, call: 0.2, bet: 0, raise: 0.66, "all-in": 0.04 } },
      ]),
    ),
  };
  const ranges = inferPreflopRanges({
    tableConfig: { playerCount: 6, heroPosition: "BTN", positions: ["LJ", "HJ", "CO", "BTN", "SB", "BB"] },
    actions,
    empiricalSpots: { a7: broadFourBetSpot },
  });

  assert.ok(ranges.hero.summary.frequency < 0.08);
  assert.ok(ranges.hero.summary.frequency > 0.04);
  assert.ok(averageClassWeight(ranges.hero, "1-1-pair") > averageClassWeight(ranges.hero, "12-13-offsuit"));
});

test("empirical spot model exposes action probabilities and request buckets", () => {
  const spot = {
    spotProbabilities: { fold: 0.6, check: 0.1, call: 0.2, bet: 0.03, raise: 0.07, "all-in": 0 },
    handClasses: {
      "1-1-pair": {
        probabilities: { fold: 0.01, check: 0.02, call: 0.12, bet: 0.05, raise: 0.8, "all-in": 0 },
      },
    },
  };

  assert.equal(empiricalActionProbability(spot, "1-1-pair", "raise"), 0.8);
  assert.equal(empiricalActionProbability(spot, "12-13-offsuit", "fold"), 0.6);
  assert.equal(empiricalTargetFrequency({ type: "fold" }, spot), 0.4);
  assert.equal(amountBucketForAction({ amount: 1 }), "large");
  assert.deepEqual(empiricalSpotRequest({
    action: { street: "preflop", amount: 3 },
    position: "BTN",
    playerCount: 6,
    facingAggression: true,
  }), {
    street: "preflop",
    position: "BTN",
    playerCount: 6,
    stakeBucket: "micro",
    yearBucket: "2009-2010",
    facingAggression: true,
    amountBucket: "overbet",
  });
});

test("empirical range updates use per-class action likelihoods", () => {
  const range = createUniformPreflopRange({ player: "villain:BTN", position: "BTN" });
  const updated = updatePreflopRangeForAction(
    range,
    { player: "villain:BTN", street: "preflop", type: "raise", amount: 3 },
    {
      position: "BTN",
      empiricalSpot: {
        version: 1,
        request: { street: "preflop", position: "BTN" },
        source: { sourceKey: "unit-test-source" },
        cache: { hit: true },
        smoothing: { alpha: 0.5 },
        spotProbabilities: { fold: 0.7, check: 0, call: 0.2, bet: 0, raise: 0.1, "all-in": 0 },
        handClasses: {
          "1-1-pair": { probabilities: { fold: 0.01, check: 0, call: 0.09, bet: 0, raise: 0.9, "all-in": 0 } },
          "12-13-offsuit": { probabilities: { fold: 0.99, check: 0, call: 0.01, bet: 0, raise: 0, "all-in": 0 } },
        },
      },
    },
  );

  assert.ok(averageClassWeight(updated, "1-1-pair") > 0.89);
  assert.ok(averageClassWeight(updated, "12-13-offsuit") < 0.04);
  assert.equal(updated.history.at(-1).empirical, true);
  assert.equal(updated.modelMetadata.source, "empirical");
  assert.equal(updated.modelMetadata.empirical.sourceKey, "unit-test-source");
  assert.equal(updated.modelMetadata.empirical.cacheHit, true);
  assert.equal(updated.history.at(-1).modelMetadata.empirical.spotVersion, 1);
});

test("empirical range updates smooth noisy class islands into a coherent frontier", () => {
  const range = createUniformPreflopRange({ player: "hero", position: "SB" });
  const updated = updatePreflopRangeForAction(
    range,
    { player: "hero", street: "preflop", type: "raise", amount: 3 },
    {
      position: "SB",
      playerCount: 6,
      empiricalSpot: {
        request: { street: "preflop", position: "SB" },
        spotProbabilities: { fold: 0.8, check: 0, call: 0.05, bet: 0, raise: 0.15, "all-in": 0 },
        handClasses: {
          "1-1-pair": { count: 10_000, probabilities: { fold: 0, check: 0, call: 0, bet: 0, raise: 1, "all-in": 0 } },
          "12-13-offsuit": { count: 10_000, probabilities: { fold: 0, check: 0, call: 0, bet: 0, raise: 1, "all-in": 0 } },
        },
      },
    },
  );

  assert.ok(averageClassWeight(updated, "1-1-pair") > 0.99);
  assert.ok(averageClassWeight(updated, "1-2-suited") > 0.95);
  assert.ok(averageClassWeight(updated, "12-13-offsuit") < 0.01);
});

test("archetype profiles adjust empirical probabilities without breaking normalization", () => {
  const probabilities = { fold: 0.2, check: 0.1, call: 0.25, bet: 0.1, raise: 0.3, "all-in": 0.05 };
  const nit = applyArchetypeActionProfile(probabilities, {
    classKey: "1-1-pair",
    profile: { archetypes: { nit: 0.7, tag: 0.3 } },
  });
  const maniac = applyArchetypeActionProfile(probabilities, {
    classKey: "12-13-offsuit",
    profile: { archetypes: { maniac: 1 } },
  });

  assert.equal(Object.keys(normalizeArchetypeWeights({ nit: 2, tag: 1 })).length, 2);
  assert.ok(handClassStrength("1-1-pair") > handClassStrength("12-13-offsuit"));
  assert.ok(nit.raise > probabilities.raise);
  assert.ok(maniac.raise > probabilities.raise);
  assert.ok(maniac.fold < probabilities.fold);
  assert.ok(Math.abs(Object.values(nit).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
});

test("range explanation distinguishes empirical and heuristic histories", () => {
  assert.equal(rangeExplanation({ history: [] }), "Uniform range before action evidence");
  assert.match(rangeExplanation({
    history: [{
      empirical: true,
      request: {
        street: "preflop",
        position: "BTN",
        playerCount: 6,
        facingAggression: false,
        amountBucket: "overbet",
      },
      action: { type: "raise" },
    }],
  }), /Empirical PHH baseline/);
  assert.match(rangeExplanation({
    history: [{ targetFrequency: 0.25, action: { type: "call" } }],
  }), /Heuristic range update/);
});

test("strong hands retain far more weight than weak hands after LJ opens", () => {
  const opened = updatePreflopRangeForAction(
    createUniformPreflopRange({ player: "villain:LJ", position: "LJ" }),
    { player: "villain:LJ", street: "preflop", type: "raise", amount: 3 },
    { position: "LJ" },
  );
  const aa = averageClassWeight(opened, "1-1-pair");
  const kto = averageClassWeight(opened, preflopClassKeyForCards(card(2, 1), card(5, 2)));
  const trash = averageClassWeight(opened, preflopClassKeyForCards(card(12, 1), card(13, 2)));

  assert.ok(aa > 0.98);
  assert.ok(kto > trash);
  assert.ok(trash < 0.03);
});

test("preflop range inference collapses folded players and preserves actor ranges", () => {
  const ranges = inferPreflopRanges({
    tableConfig: { playerCount: 6, heroPosition: "CO", positions: ["LJ", "HJ", "CO", "BTN", "SB", "BB"] },
    actions: [
      { id: "a1", player: "villain:LJ", street: "preflop", type: "raise", amount: 3 },
      { id: "a2", player: "villain:HJ", street: "preflop", type: "fold" },
      { id: "a3", player: "hero", street: "preflop", type: "call", amount: 3 },
    ],
  });

  assert.ok(ranges["villain:LJ"].summary.frequency > 0.14);
  assert.equal(ranges["villain:HJ"].summary.frequency, 0);
  assert.equal(ranges["villain:HJ"].folded, true);
  assert.ok(ranges.hero.summary.frequency > 0);
  assert.ok(ranges.hero.summary.frequency < 1);
});

test("postflop actions update range weights using the known board", () => {
  const ranges = inferPreflopRanges({
    tableConfig: { playerCount: 6, heroPosition: "BB", positions: ["LJ", "HJ", "CO", "BTN", "SB", "BB"] },
    actions: [
      { id: "a1", player: "villain:LJ", street: "flop", type: "bet", amount: 5 },
    ],
    knownBoard: [card(5, 1), card(8, 2), card(12, 3)],
    bucketCount: 7462,
    evaluateGradation: fakeBoardEvaluator,
  });

  const range = ranges["villain:LJ"];
  const aa = averageClassWeight(range, "1-1-pair");
  const trash = averageClassWeight(range, "12-13-offsuit");

  assert.ok(range.summary.frequency > 0);
  assert.ok(range.summary.frequency < 1);
  assert.ok(aa > trash);
});

test("postflop folds collapse a player's visible range", () => {
  const ranges = inferPreflopRanges({
    tableConfig: { playerCount: 3, heroPosition: "BB", positions: ["BTN", "SB", "BB"] },
    actions: [
      { id: "a1", player: "villain:BTN", street: "flop", type: "fold" },
    ],
    knownBoard: [card(5, 1), card(8, 2), card(12, 3)],
    bucketCount: 7462,
    evaluateGradation: fakeBoardEvaluator,
  });

  assert.equal(ranges["villain:BTN"].summary.frequency, 0);
  assert.equal(ranges["villain:BTN"].folded, true);
});

test("multiway equity samples weighted range combos", () => {
  const board = [card(6, 1), card(7, 2), card(8, 3), card(9, 4), card(10, 1)];
  const result = computeMultiwayAggregateEquities({
    participants: [
      { id: "hero", knownHoleCards: [card(2, 1), card(2, 2)] },
      {
        id: "villain:LJ",
        rangeCombos: [
          { cards: [card(1, 1), card(1, 2)], weight: 1 },
          { cards: [card(13, 3), card(12, 4)], weight: 0 },
        ],
      },
    ],
    knownBoard: board,
    deck: [
      card(1, 1),
      card(1, 2),
      card(12, 4),
      card(13, 3),
    ],
    evaluateGradationFive: (...cards) => cards.reduce((sum, comboCard) => sum + comboCard.rank, 0),
    nsims: 20,
    seed: 7,
  });

  assert.equal(result.exact, false);
  assert.equal(result.equities["villain:LJ"], 1);
  assert.equal(result.equities.hero, 0);
});

test("multiway equity rejects empty weighted ranges instead of sampling random cards", () => {
  assert.throws(() => computeMultiwayAggregateEquities({
    participants: [
      { id: "hero", knownHoleCards: [card(2, 1), card(2, 2)] },
      {
        id: "villain:LJ",
        rangeCombos: [
          { cards: [card(1, 1), card(1, 2)], weight: 0 },
        ],
      },
    ],
    knownBoard: [card(6, 1), card(7, 2), card(8, 3), card(9, 4), card(10, 1)],
    deck: [card(1, 1), card(1, 2)],
    evaluateGradationFive: (...cards) => cards.reduce((sum, comboCard) => sum + comboCard.rank, 0),
    nsims: 20,
    seed: 7,
  }), /no legal positive-weight combos/);
});

function averageClassWeight(range, classKey) {
  const matching = range.combos.filter((combo) => combo.classKey === classKey);
  return matching.reduce((sum, combo) => sum + combo.weight, 0) / matching.length;
}

function fakeBoardEvaluator(cards) {
  const counts = new Map();
  for (const comboCard of cards) {
    counts.set(comboCard.rank, (counts.get(comboCard.rank) || 0) + 1);
  }
  const pairRanks = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([rank]) => rank);
  if (pairRanks.length) {
    return Math.min(...pairRanks) * 10;
  }
  return 7000 + Math.min(...cards.map((comboCard) => comboCard.rank));
}
