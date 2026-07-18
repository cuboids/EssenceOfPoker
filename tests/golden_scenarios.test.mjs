import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { fullDeck, sameCard } from "../dashboard/cards.mjs";
import { curvesForKnownAssets } from "../dashboard/curve_distributions.mjs";
import { createHandEvaluator } from "../dashboard/evaluation.mjs";
import {
  HAND_PHASES,
  dealFlopModel,
  dealRiverModel,
  dealTurnModel,
  editKnownCardModel,
  emptyHandModel,
  legacyHandState,
  pendingHoleCards,
  rebuildTimeline,
  setPendingHoleCard,
  startPreflopModel,
} from "../dashboard/hand_state.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_portfolio.json", import.meta.url), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const priorXByGradation = new Map(data.curve.map((point) => [point.gradation, point.x]));
const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

test("golden street sequence preserves editing, flop sorting, and street history", () => {
  let model = emptyHandModel();
  model = setPendingHoleCard(model, "H_1", card(8, 3));
  assert.equal(model.phase, HAND_PHASES.PARTIAL_HOLDING);
  assert.deepEqual(pendingHoleCards(model), [card(8, 3), null]);
  assert.throws(() => setPendingHoleCard(model, "H_2", card(8, 3)), /already|duplicate/i);

  model = setPendingHoleCard(model, "H_2", card(12, 1));
  model = startPreflopModel(pendingHoleCards(model), [card(6, 2), card(7, 4)]);
  assert.deepEqual(
    model.hole.map((holeCard) => [holeCard.rank, holeCard.suit, holeCard.relativeSuit]),
    [
      [8, 3, 1],
      [12, 1, 2],
    ],
  );

  model = dealFlopModel(model, [card(1, 4), card(2, 3), card(2, 1)]);
  assert.deepEqual(
    model.flop.map((flopCard) => [flopCard.rank, flopCard.suit, flopCard.relativeSuit]),
    [
      [1, 4, 3],
      [2, 3, 1],
      [2, 1, 2],
    ],
  );

  model = dealTurnModel(model, card(5, 2));
  model = dealRiverModel(model, card(9, 4));
  model = editKnownCardModel(model, "R", card(10, 4));

  const timeline = rebuildTimeline(model);
  assert.deepEqual(timeline.map((street) => street.phase), [
    HAND_PHASES.PREFLOP,
    HAND_PHASES.FLOP,
    HAND_PHASES.TURN,
    HAND_PHASES.RIVER,
  ]);
  assert.equal(timeline[0].flop.length, 0);
  assert.equal(timeline[1].flop.length, 3);
  assert.equal(timeline[2].turn.rank, 5);
  assert.equal(timeline[3].river.rank, 10);
});

test("golden river scenario keeps the winning concrete hero asset active", () => {
  const model = dealRiverModel(
    dealTurnModel(
      dealFlopModel(
        startPreflopModel([card(1, 1), card(13, 4)], [card(6, 2), card(7, 3)]),
        [card(2, 1), card(3, 1), card(4, 1)],
      ),
      card(5, 1),
    ),
    card(9, 4),
  );
  const state = legacyHandState(model);
  const assets = data.portfolios.hero.assets;
  const curves = curvesForKnownAssets({
    assets,
    aggregates: data.portfolios.hero.aggregates,
    remainingDeck: remainingDeckForKnownCards([state.h1, state.h2, ...state.flop, state.turn, state.river]),
    knownCardsForAsset: (asset) => knownCardsForAsset(asset, state),
    knownState: currentKnownHeroState(state),
    aggregateTokens: ["H_1", "H_2", "F_1", "F_2", "F_3", "T", "R"],
    bucketCount: data.bucketCount,
    priorXByGradation,
    evaluateGradation: evaluator.evaluateGradation,
  });
  const concreteResults = assets.map((asset) => ({
    asset,
    gradation: curves[asset.code].bestGradation,
    ceiling: ceilingForOtherAssets(asset, assets, curves),
  }));
  const bestGradation = Math.min(...concreteResults.map((result) => result.gradation));
  const activeResults = concreteResults.filter((result) => isConcreteAssetActive(result.gradation, result.ceiling));

  assert.ok(activeResults.length >= 1);
  assert.ok(activeResults.every((result) => result.gradation === bestGradation));
  assert.equal(curves.AGG.bestGradation, bestGradation);
  assert.equal(curves.AGG.curve.at(-1).probability, 1);
});

function currentKnownHeroState(state) {
  return {
    H_1: state.h1,
    H_2: state.h2,
    F_1: state.flop[0],
    F_2: state.flop[1],
    F_3: state.flop[2],
    T: state.turn,
    R: state.river,
  };
}

function knownCardsForAsset(asset, state) {
  const knownState = currentKnownHeroState(state);
  return asset.name
    .split(" + ")
    .map((token) => knownState[token])
    .filter(Boolean);
}

function remainingDeckForKnownCards(knownCards) {
  return fullDeck.filter((deckCard) => !knownCards.some((knownCard) => sameCard(deckCard, knownCard)));
}

function ceilingForOtherAssets(asset, assets, curves) {
  return assets
    .filter((otherAsset) => otherAsset.code !== asset.code)
    .reduce((ceiling, otherAsset) => Math.min(ceiling, curves[otherAsset.code].worstGradation), data.bucketCount);
}

function isConcreteAssetActive(gradation, ceiling) {
  return ceiling >= gradation;
}
