#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { cardCompare, fullDeck, sameCard } from "../dashboard/cards.mjs";
import { preflopClassKeyForCards } from "../dashboard/cache_keys.mjs";
import { createHandEvaluator } from "../dashboard/evaluation.mjs";
import { startPreflopModel } from "../dashboard/hand_state.mjs";
import { handViewFromModel } from "../dashboard/hand_view.mjs";
import { computePreflopHeroAssetPriorKernel } from "../dashboard/preflop_asset_priors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
const outputPath = args.output
  ? path.resolve(args.output)
  : path.join(root, "essence_of_poker", "data", "preflop_primary_prior_cache.json");
const limit = args.limit == null ? null : Number(args.limit);
const only = args.only ? new Set(String(args.only).split(",").map((value) => value.trim())) : null;

const data = JSON.parse(fs.readFileSync(path.join(root, "dashboard", "data", "prior_portfolio.json"), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const representatives = representativePreflopHands();
const classes = {};
const started = Date.now();

let attempted = 0;
for (const [index, representative] of representatives.entries()) {
  if (only && !only.has(representative.classKey)) {
    continue;
  }
  if (limit != null && attempted >= limit) {
    break;
  }
  attempted += 1;
  const result = computeClass(representative.first, representative.second);
  classes[representative.classKey] = Object.fromEntries(
    Object.entries(result.countsByCode).map(([code, counts]) => [code, trimCounts([...counts])]),
  );

  if ((index + 1) % 5 === 0 || index === representatives.length - 1) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`cached ${String(index + 1).padStart(3)} / ${representatives.length} in ${elapsed}s`);
  }
}

const payload = `${JSON.stringify(
    {
      source: "exact-ordered-nlhe-primary-asset-priors-v1",
      exact: true,
      sampleSpace: "canonical holding class + unordered board set + flop subset + ordered turn/river",
      totalCombos: 42_375_200,
      bucketCount: data.bucketCount,
      classes,
    },
    null,
    2,
  )}\n`;
fs.writeFileSync(outputPath, payload, "utf8");
fs.writeFileSync(`${outputPath}.gz`, zlib.gzipSync(payload));
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${outputPath}.gz`);

function computeClass(firstCard, secondCard) {
  const [h1, h2] = [firstCard, secondCard].sort(cardCompare);
  const [v1, v2] = fullDeck.filter((card) => !sameCard(card, h1) && !sameCard(card, h2)).slice(0, 2);
  const handState = handViewFromModel(startPreflopModel([h1, h2], [v1, v2]));
  const remainingDeck = fullDeck.filter((card) => !sameCard(card, h1) && !sameCard(card, h2));

  return computePreflopHeroAssetPriorKernel({
    portfolio: data.portfolios.hero,
    handState,
    remainingDeck,
    bucketCount: data.bucketCount,
    evaluateGradationFive: evaluator.evaluateGradationFive,
  });
}

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

function trimCounts(counts) {
  const first = counts.findIndex((count, index) => index > 0 && count > 0);
  let last = counts.length - 1;
  while (last > 0 && !counts[last]) {
    last -= 1;
  }
  const trimmedCounts = counts.slice(first, last + 1).map((count) => count || 0);
  return {
    first,
    counts: trimmedCounts,
    totalCombos: trimmedCounts.reduce((sum, count) => sum + count, 0),
    bestGradation: first,
    worstGradation: last,
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[name] = true;
    } else {
      parsed[name] = next;
      index += 1;
    }
  }
  return parsed;
}
