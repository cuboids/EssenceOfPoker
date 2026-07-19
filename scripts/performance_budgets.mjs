#!/usr/bin/env node

import fs from "node:fs";
import { performance } from "node:perf_hooks";

import { fullDeck, sameCard } from "../dashboard/cards.mjs";
import { distributionFor } from "../dashboard/curve_distributions.mjs";
import { createHandEvaluator } from "../dashboard/evaluation.mjs";
import { legacyHandState, startPreflopModel } from "../dashboard/hand_state.mjs";
import { hiddenVillainCurves } from "../dashboard/villain_range.mjs";
import { computeMultiwayAggregateEquities } from "../dashboard/multiway_equity.mjs";
import { computePreflopHeroWinSharesKernel } from "../dashboard/win_shares.mjs";

const args = parseArgs(process.argv.slice(2));
const failOnBudget = !args["no-fail"];
const data = JSON.parse(fs.readFileSync(new URL("../dashboard/data/prior_portfolio.json", import.meta.url), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const priorXByGradation = new Map(data.curve.map((point) => [point.gradation, point.x]));
const card = (rank, suit) => ({ rank, suit, id: (rank - 1) * 4 + (suit - 1) });

const benchmarks = [
  {
    name: "evaluate-five-card-cache",
    budgetMs: 30,
    run() {
      const hands = [
        [card(1, 1), card(2, 1), card(3, 1), card(4, 1), card(5, 1)],
        [card(1, 2), card(1, 3), card(1, 4), card(2, 1), card(2, 2)],
        [card(13, 1), card(12, 2), card(11, 3), card(10, 4), card(8, 1)],
      ];
      for (let index = 0; index < 15_000; index += 1) {
        evaluator.evaluateGradation(hands[index % hands.length]);
      }
    },
  },
  {
    name: "known-card-distribution-reduced",
    budgetMs: 50,
    run() {
      distributionFor(
        [card(1, 1), card(2, 1), card(3, 1)],
        [card(4, 1), card(5, 1), card(6, 2), card(7, 3), card(8, 4), card(9, 1), card(10, 2), card(11, 3)],
        data.bucketCount,
        priorXByGradation,
        evaluator.evaluateGradation,
      );
    },
  },
  {
    name: "hidden-villain-complete-board-reduced",
    budgetMs: 80,
    run() {
      hiddenVillainCurves({
        assets: data.portfolios.villain.assets,
        aggregates: data.portfolios.villain.aggregates,
        available: [card(6, 1), card(7, 1), card(8, 2), card(9, 3), card(10, 4), card(11, 1), card(12, 2), card(13, 3)],
        knownBoardState: {
          F_1: card(1, 1),
          F_2: card(2, 1),
          F_3: card(3, 1),
          T: card(4, 1),
          R: card(5, 1),
        },
        futureBoardTokens: [],
        bucketCount: data.bucketCount,
        priorXByGradation,
        chooseTable: evaluator.chooseTable,
        evaluateGradation: evaluator.evaluateGradation,
      });
    },
  },
  {
    name: "preflop-win-share-kernel-reduced",
    budgetMs: 120,
    run() {
      const model = startPreflopModel([card(2, 1), card(12, 2)], [card(6, 3), card(7, 4)]);
      const handState = legacyHandState(model);
      const remainingDeck = fullDeck
        .filter((deckCard) => ![handState.h1, handState.h2].some((knownCard) => sameCard(deckCard, knownCard)))
        .slice(0, 9);
      computePreflopHeroWinSharesKernel({
        portfolio: data.portfolios.hero,
        handState,
        remainingDeck,
        evaluateGradationFive: evaluator.evaluateGradationFive,
      });
    },
  },
  {
    name: "multiway-equity-six-max-5k",
    budgetMs: 400,
    run() {
      const heroCards = [card(2, 1), card(5, 2)];
      computeMultiwayAggregateEquities({
        participants: [
          { id: "hero", knownHoleCards: heroCards },
          { id: "villain:SB" },
          { id: "villain:BB" },
          { id: "villain:LJ" },
          { id: "villain:HJ" },
          { id: "villain:CO" },
        ],
        knownBoard: [],
        deck: fullDeck.filter((deckCard) => !heroCards.some((knownCard) => sameCard(deckCard, knownCard))),
        evaluateGradationFive: evaluator.evaluateGradationFive,
        nsims: 5_000,
        seed: 1,
      });
    },
  },
];

const results = benchmarks.map((benchmark) => {
  const durationMs = measure(benchmark.run);
  return {
    name: benchmark.name,
    durationMs: Number(durationMs.toFixed(3)),
    budgetMs: benchmark.budgetMs,
    ok: durationMs <= benchmark.budgetMs,
  };
});

if (args.json) {
  console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
} else {
  for (const result of results) {
    const status = result.ok ? "ok" : "slow";
    console.log(`${status.padEnd(5)} ${result.name.padEnd(38)} ${result.durationMs.toFixed(3)}ms / ${result.budgetMs}ms`);
  }
}

if (failOnBudget && results.some((result) => !result.ok)) {
  process.exitCode = 1;
}

function measure(fn) {
  fn();
  const started = performance.now();
  fn();
  return performance.now() - started;
}

function parseArgs(argv) {
  return Object.fromEntries(argv.filter((arg) => arg.startsWith("--")).map((arg) => [arg.slice(2), true]));
}
