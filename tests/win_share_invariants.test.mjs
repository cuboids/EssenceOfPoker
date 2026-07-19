import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { cardCompare, fullDeck, sameCard } from "../dashboard/cards.mjs";
import { createHandEvaluator } from "../dashboard/evaluation.mjs";
import { startPreflopModel, dealFlopModel } from "../dashboard/hand_state.mjs";
import { handViewFromModel } from "../dashboard/hand_view.mjs";
import { AGGREGATE_INDEX_GROUPS, aggregateGradationsForSevenCards } from "../dashboard/portfolio_curves.mjs";
import {
  computePreflopHeroWinSharesBruteForce,
  computePreflopHeroWinSharesKernel,
  computeRunoutWinShares,
} from "../dashboard/win_shares.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_portfolio.json", import.meta.url), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const heroPortfolio = data.portfolios.hero;
const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });
const without = (deck, cards) => deck.filter((deckCard) => !cards.some((knownCard) => sameCard(deckCard, knownCard)));
const sumShares = (result) => Object.values(result.shares).reduce((total, share) => total + share, 0);

test("aggregate gradation equals the minimum over the relevant five-card assets", () => {
  const sevenCards = [
    card(1, 1),
    card(2, 2),
    card(3, 3),
    card(4, 4),
    card(5, 1),
    card(9, 2),
    card(13, 3),
  ];
  const aggregate = aggregateGradationsForSevenCards(sevenCards, AGGREGATE_INDEX_GROUPS, data.bucketCount, evaluator.evaluateGradation);
  const allAssetGradations = AGGREGATE_INDEX_GROUPS.AGG.map((indexes) =>
    evaluator.evaluateGradation(indexes.map((index) => sevenCards[index])),
  );
  const bothAssetGradations = AGGREGATE_INDEX_GROUPS.AGG_BOTH.map((indexes) =>
    evaluator.evaluateGradation(indexes.map((index) => sevenCards[index])),
  );
  const h1AssetGradations = AGGREGATE_INDEX_GROUPS.AGG_H1.map((indexes) =>
    evaluator.evaluateGradation(indexes.map((index) => sevenCards[index])),
  );
  const h2AssetGradations = AGGREGATE_INDEX_GROUPS.AGG_H2.map((indexes) =>
    evaluator.evaluateGradation(indexes.map((index) => sevenCards[index])),
  );

  assert.equal(aggregate.AGG, Math.min(...allAssetGradations));
  assert.equal(aggregate.AGG_BOTH, Math.min(...bothAssetGradations));
  assert.equal(aggregate.AGG_H1, Math.min(...h1AssetGradations));
  assert.equal(aggregate.AGG_H2, Math.min(...h2AssetGradations));
  assert.equal(aggregate.AGG_ZERO, evaluator.evaluateGradation(sevenCards.slice(2)));
});

test("generic runout win shares sum to 100% and preserve turn/river symmetry", () => {
  const model = dealFlopModel(
    startPreflopModel([card(2, 1), card(12, 2)], [card(6, 3), card(7, 4)]),
    [card(1, 3), card(8, 1), card(10, 2)],
  );
  const handState = handViewFromModel(model);
  const knownState = {
    H_1: handState.h1,
    H_2: handState.h2,
    F_1: handState.flop[0],
    F_2: handState.flop[1],
    F_3: handState.flop[2],
  };
  const reducedRunoutDeck = [card(3, 1), card(4, 2), card(9, 3), card(13, 4)];
  const result = computeRunoutWinShares({
    portfolio: heroPortfolio,
    knownState,
    remainingDeck: reducedRunoutDeck,
    suitMap: handState.suitMap,
    evaluateGradation: evaluator.evaluateGradation,
  });

  assert.equal(result.totalCombos, 12);
  assert.ok(Math.abs(sumShares(result) - 1) < 1e-12);

  const h1F1F2TR = heroPortfolio.assets.find((asset) => asset.name === "H_1 + F_1 + F_2 + T + R");
  const h1F1F3TR = heroPortfolio.assets.find((asset) => asset.name === "H_1 + F_1 + F_3 + T + R");
  const bothF1F2T = heroPortfolio.assets.find((asset) => asset.name === "H_1 + H_2 + F_1 + F_2 + T");
  const bothF1F2R = heroPortfolio.assets.find((asset) => asset.name === "H_1 + H_2 + F_1 + F_2 + R");

  assert.notEqual(result.shares[h1F1F2TR.code], result.shares[h1F1F3TR.code]);
  assert.equal(result.shares[bothF1F2T.code], result.shares[bothF1F2R.code]);
});

test("optimized preflop win shares equal brute force on reduced deterministic decks", () => {
  const model = startPreflopModel([card(2, 1), card(12, 2)], [card(6, 3), card(7, 4)]);
  const handState = handViewFromModel(model);
  const samples = [
    [card(1, 3), card(3, 1), card(5, 4), card(8, 2), card(13, 3)],
    [card(4, 1), card(4, 2), card(9, 3), card(10, 4), card(11, 1), card(13, 4)],
  ];

  for (const sampleDeck of samples) {
    const remainingDeck = sampleDeck.filter((sampleCard) => ![handState.h1, handState.h2].some((known) => sameCard(sampleCard, known)));
    const optimized = computePreflopHeroWinSharesKernel({
      portfolio: heroPortfolio,
      handState,
      remainingDeck,
      evaluateGradationFive: evaluator.evaluateGradationFive,
    });
    const bruteForce = computePreflopHeroWinSharesBruteForce({
      portfolio: heroPortfolio,
      handState,
      remainingDeck,
      evaluateGradation: evaluator.evaluateGradation,
    });

    assert.equal(optimized.totalCombos, bruteForce.totalCombos);
    assert.ok(Math.abs(sumShares(optimized) - 1) < 1e-12);
    assert.ok(Math.abs(sumShares(bruteForce) - 1) < 1e-12);
    for (const asset of heroPortfolio.assets) {
      assert.ok(
        Math.abs(optimized.shares[asset.code] - bruteForce.shares[asset.code]) < 1e-12,
        `${asset.code} ${asset.name}: optimized=${optimized.shares[asset.code]} brute=${bruteForce.shares[asset.code]}`,
      );
    }
  }
});

test("preflop optimized path is invariant to physical deck ordering", () => {
  const [h1, h2] = [card(3, 1), card(11, 2)].sort(cardCompare);
  const model = startPreflopModel([h1, h2], [card(6, 3), card(7, 4)]);
  const handState = handViewFromModel(model);
  const remainingDeck = without(fullDeck, [handState.h1, handState.h2]).slice(0, 7);
  const reversedDeck = [...remainingDeck].reverse();

  const first = computePreflopHeroWinSharesKernel({
    portfolio: heroPortfolio,
    handState,
    remainingDeck,
    evaluateGradationFive: evaluator.evaluateGradationFive,
  });
  const second = computePreflopHeroWinSharesKernel({
    portfolio: heroPortfolio,
    handState,
    remainingDeck: reversedDeck,
    evaluateGradationFive: evaluator.evaluateGradationFive,
  });

  assert.equal(first.totalCombos, second.totalCombos);
  for (const asset of heroPortfolio.assets) {
    assert.ok(Math.abs(first.shares[asset.code] - second.shares[asset.code]) < 1e-12);
  }
});
