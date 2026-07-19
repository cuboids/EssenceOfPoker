import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import fc from "fast-check";

import { cardCompare, cardId, sameCard } from "../dashboard/cards.mjs";
import { createHandEvaluator } from "../dashboard/evaluation.mjs";
import { legacyHandState, startPreflopModel } from "../dashboard/hand_state.mjs";
import { AGGREGATE_INDEX_GROUPS, aggregateGradationsForSevenCards } from "../dashboard/portfolio_curves.mjs";
import {
  computePreflopHeroWinSharesBruteForce,
  computePreflopHeroWinSharesKernel,
} from "../dashboard/win_shares.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_portfolio.json", import.meta.url), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const heroPortfolio = data.portfolios.hero;

function cardFromId(id) {
  const rank = Math.floor(id / 4) + 1;
  const suit = (id % 4) + 1;
  return { rank, suit, id: cardId({ rank, suit }) };
}

function sumShares(result) {
  return Object.values(result.shares).reduce((total, share) => total + share, 0);
}

test("property: aggregate gradations are exactly minima over their asset groups", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 51 }), { minLength: 7, maxLength: 7 }), (ids) => {
      const cards = ids.map(cardFromId);
      const aggregate = aggregateGradationsForSevenCards(
        cards,
        AGGREGATE_INDEX_GROUPS,
        data.bucketCount,
        evaluator.evaluateGradation,
      );

      for (const [code, groups] of Object.entries(AGGREGATE_INDEX_GROUPS)) {
        const expected = Math.min(...groups.map((indexes) => evaluator.evaluateGradation(indexes.map((index) => cards[index]))));
        assert.equal(aggregate[code], expected, code);
      }
    }),
    { numRuns: 100, seed: 20260718 },
  );
});

test("property: optimized preflop win shares match brute force on small deterministic decks", () => {
  fc.assert(
    fc.property(fc.uniqueArray(fc.integer({ min: 0, max: 51 }), { minLength: 9, maxLength: 11 }), (ids) => {
      const [rawH1, rawH2, rawV1, rawV2, ...deck] = ids.map(cardFromId);
      const [h1, h2] = [rawH1, rawH2].sort(cardCompare);
      const model = startPreflopModel([h1, h2], [rawV1, rawV2]);
      const handState = legacyHandState(model);
      const remainingDeck = deck.filter((sampleCard) => ![handState.h1, handState.h2].some((known) => sameCard(sampleCard, known)));

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
      for (const asset of heroPortfolio.assets) {
        assert.ok(
          Math.abs(optimized.shares[asset.code] - bruteForce.shares[asset.code]) < 1e-12,
          `${asset.code}: optimized=${optimized.shares[asset.code]} brute=${bruteForce.shares[asset.code]}`,
        );
      }
    }),
    { numRuns: 40, seed: 20260718 },
  );
});
