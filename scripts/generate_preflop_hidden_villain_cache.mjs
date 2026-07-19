#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cardCompare, fullDeck, sameCard } from "../dashboard/cards.mjs";
import { preflopClassKeyForCards } from "../dashboard/cache_keys.mjs";
import { createHandEvaluator } from "../dashboard/evaluation.mjs";
import { preflopHiddenVillainCurves } from "../dashboard/villain_range.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "essence_of_poker", "data", "preflop_hidden_villain_cache.json");

const data = JSON.parse(fs.readFileSync(path.join(root, "dashboard", "data", "prior_portfolio.json"), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const priorXByGradation = new Map(data.curve.map((point) => [point.gradation, point.x]));
const assets = data.portfolios.villain.assets;
const classes = {};
const representatives = representativePreflopHands();
const started = Date.now();

for (const [index, representative] of representatives.entries()) {
  const available = fullDeck.filter((card) => !sameCard(card, representative.first) && !sameCard(card, representative.second));
  const curves = preflopHiddenVillainCurves({
    assets,
    available,
    bucketCount: data.bucketCount,
    priorXByGradation,
    evaluateGradation: evaluator.evaluateGradation,
  });

  classes[representative.classKey] = {
    shared: trimCurve(curves["1.1"]),
    v1: trimCurve(curves["2.1"]),
    v2: trimCurve(curves["3.1"]),
  };

  if ((index + 1) % 10 === 0 || index === representatives.length - 1) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`cached ${String(index + 1).padStart(3)} / ${representatives.length} in ${elapsed}s`);
  }
}

fs.writeFileSync(
  outputPath,
  `${JSON.stringify({ source: "preflop-hidden-villain-curves-v1", bucketCount: data.bucketCount, classes }, null, 2)}\n`,
  "utf8",
);
console.log(`Wrote ${outputPath}`);

function representativePreflopHands() {
  const classesByKey = new Map();
  for (let firstIndex = 0; firstIndex < fullDeck.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < fullDeck.length; secondIndex += 1) {
      const [first, second] = [fullDeck[firstIndex], fullDeck[secondIndex]].sort(cardCompare);
      const classKey = preflopClassKeyForCards(first, second);
      if (!classesByKey.has(classKey)) {
        classesByKey.set(classKey, { classKey, first, second });
      }
    }
  }
  return [...classesByKey.values()].sort((first, second) =>
    first.classKey.localeCompare(second.classKey, undefined, { numeric: true }),
  );
}

function trimCurve(curveData) {
  const counts = [];
  let previousCumulative = 0;
  for (const point of curveData.curve) {
    const cumulative = Math.round(point.probability * curveData.totalCombos);
    counts[point.gradation] = cumulative - previousCumulative;
    previousCumulative = cumulative;
  }
  const first = counts.findIndex((count, index) => index > 0 && count > 0);
  let last = counts.length - 1;
  while (last > 0 && !counts[last]) {
    last -= 1;
  }
  return {
    first,
    counts: counts.slice(first, last + 1).map((count) => count || 0),
    totalCombos: curveData.totalCombos,
    bestGradation: first,
    worstGradation: last,
  };
}
