#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cardCompare, fullDeck, sameCard } from "../dashboard/cards.mjs";
import { heroPreflopWinShareCacheKey, preflopClassKeyForCards } from "../dashboard/cache_keys.mjs";
import { createHandEvaluator } from "../dashboard/evaluation.mjs";
import { legacyHandState, startPreflopModel } from "../dashboard/hand_state.mjs";
import { computePreflopHeroWinSharesKernel } from "../dashboard/win_shares.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultApi = "http://127.0.0.1:8766";

const args = parseArgs(process.argv.slice(2));
const apiBase = (args.api || defaultApi).replace(/\/$/, "");
const limit = args.limit == null ? null : Number(args.limit);
const only = args.only ? new Set(String(args.only).split(",").map((value) => value.trim())) : null;
const shardCount = args["shard-count"] == null ? 1 : Number(args["shard-count"]);
const shardIndex = args["shard-index"] == null ? 0 : Number(args["shard-index"]);

if (limit != null && (!Number.isInteger(limit) || limit < 0)) {
  throw new Error("--limit must be a non-negative integer");
}
if (!Number.isInteger(shardCount) || shardCount < 1) {
  throw new Error("--shard-count must be a positive integer");
}
if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
  throw new Error("--shard-index must be an integer between 0 and shard-count - 1");
}

const data = JSON.parse(fs.readFileSync(path.join(root, "dashboard", "data", "prior_portfolio.json"), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const handEvaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const heroPortfolio = data.portfolios.hero;

const representatives = representativePreflopHands();
let computed = 0;
let skipped = 0;
let attempted = 0;
const started = Date.now();

for (const [representativeIndex, entry] of representatives.entries()) {
  if (only && !only.has(entry.classKey)) {
    continue;
  }
  if (representativeIndex % shardCount !== shardIndex) {
    continue;
  }
  if (limit != null && attempted >= limit) {
    break;
  }

  attempted += 1;
  const key = heroPreflopWinShareCacheKey(entry.first, entry.second);
  const hit = await readCache(key);
  if (hit) {
    skipped += 1;
    logProgress("hit", entry.classKey, key);
    continue;
  }

  const before = Date.now();
  const result = computePreflopWinShares(entry.first, entry.second);
  await writeCache(key, result);
  computed += 1;
  logProgress("computed", entry.classKey, key, Date.now() - before);
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`Done. attempted=${attempted} computed=${computed} skipped=${skipped} elapsed=${elapsed}s`);

function computePreflopWinShares(firstCard, secondCard) {
  const [h1, h2] = [firstCard, secondCard].sort(cardCompare);
  const [v1, v2] = fullDeck.filter((card) => !sameCard(card, h1) && !sameCard(card, h2)).slice(0, 2);
  const handState = legacyHandState(startPreflopModel([h1, h2], [v1, v2]));
  const remainingDeck = fullDeck.filter((card) => !sameCard(card, h1) && !sameCard(card, h2));

  return computePreflopHeroWinSharesKernel({
    portfolio: heroPortfolio,
    handState,
    remainingDeck,
    evaluateGradationFive: handEvaluator.evaluateGradationFive,
  });
}

function representativePreflopHands() {
  const classes = new Map();
  for (let firstIndex = 0; firstIndex < fullDeck.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < fullDeck.length; secondIndex += 1) {
      const [first, second] = [fullDeck[firstIndex], fullDeck[secondIndex]].sort(cardCompare);
      const classKey = preflopClassKeyForCards(first, second);
      if (!classes.has(classKey)) {
        classes.set(classKey, { classKey, first, second });
      }
    }
  }
  return [...classes.values()].sort((first, second) => first.classKey.localeCompare(second.classKey, undefined, { numeric: true }));
}

async function readCache(key) {
  const response = await fetch(`${apiBase}/api/cache/${encodeURIComponent(key)}`, { cache: "no-store" });
  return response.ok ? response.json() : null;
}

async function writeCache(key, value) {
  const response = await fetch(`${apiBase}/api/cache/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) {
    throw new Error(`cache write failed for ${key}: ${response.status}`);
  }
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

function logProgress(status, classKey, key, elapsedMs = null) {
  const elapsed = elapsedMs == null ? "" : ` ${elapsedMs}ms`;
  console.log(`${status.padEnd(8)} ${classKey.padEnd(16)} ${key}${elapsed}`);
}
