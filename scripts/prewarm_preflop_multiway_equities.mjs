#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cardCompare, fullDeck, sameCard } from "../dashboard/cards.mjs";
import { validateCompactPreflopMultiwayEquityCachePayload } from "../dashboard/cache_payload_contracts.mjs";
import { cacheNamespace, preflopClassKeyForCards } from "../dashboard/cache_keys.mjs";
import { createHandEvaluator } from "../dashboard/evaluation.mjs";
import {
  DEFAULT_MULTIWAY_EQUITY_SIMS,
  computeMultiwayAggregateEquities,
  preflopMultiwayEquityCacheKey,
} from "../dashboard/multiway_equity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const defaultApi = "http://127.0.0.1:8766";

const args = parseArgs(process.argv.slice(2));
const apiBase = (args.api || defaultApi).replace(/\/$/, "");
const cacheVersion = args["cache-version"] || process.env.ESSENCE_ASSET_VERSION || "development";
const nsims = args.nsims == null ? DEFAULT_MULTIWAY_EQUITY_SIMS : Number(args.nsims);
const players = (args.players || "2,3,4,5,6").split(",").map((value) => Number(value.trim()));
const limit = args.limit == null ? null : Number(args.limit);
const only = args.only ? new Set(String(args.only).split(",").map((value) => value.trim())) : null;
const cacheWriteToken = args["cache-write-token"] || process.env.ESSENCE_CACHE_WRITE_TOKEN || "";

if (!Number.isInteger(nsims) || nsims < 1) {
  throw new Error("--nsims must be a positive integer");
}
if (players.some((count) => !Number.isInteger(count) || count < 2 || count > 6)) {
  throw new Error("--players must contain only integers from 2 through 6");
}
if (limit != null && (!Number.isInteger(limit) || limit < 0)) {
  throw new Error("--limit must be a non-negative integer");
}

const data = JSON.parse(fs.readFileSync(path.join(root, "dashboard", "data", "prior_portfolio.json"), "utf8"));
const bucketLookup = new Map(data.bucketKeys.map((bucket) => [bucket.key, bucket.gradation]));
const evaluator = createHandEvaluator(bucketLookup, data.bucketCount);
const representatives = representativePreflopHands();
let attempted = 0;
let computed = 0;
let skipped = 0;
const started = Date.now();

for (const playerCount of players) {
  for (const entry of representatives) {
    if (only && !only.has(entry.classKey)) {
      continue;
    }
    if (limit != null && attempted >= limit) {
      break;
    }

    attempted += 1;
    const key = preflopMultiwayEquityCacheKey({
      namespace: cacheNamespace(cacheVersion),
      matchup: "actual",
      heroCards: [entry.first, entry.second],
      activePlayerCount: playerCount,
      nsims,
    });
    const hit = await readCache(key);
    if (validatedCacheHit(hit, playerCount)) {
      skipped += 1;
      logProgress("hit", playerCount, entry.classKey);
      continue;
    }

    const before = Date.now();
    const result = compactResult(computeEquity(entry.first, entry.second, playerCount), playerCount);
    validateCompactPreflopMultiwayEquityCachePayload(result, { playerCount });
    await writeCache(key, result);
    computed += 1;
    logProgress("computed", playerCount, entry.classKey, Date.now() - before);
  }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`Done. attempted=${attempted} computed=${computed} skipped=${skipped} elapsed=${elapsed}s`);

function computeEquity(firstCard, secondCard, playerCount) {
  const [h1, h2] = [firstCard, secondCard].sort(cardCompare);
  const heroCards = [h1, h2];
  return computeMultiwayAggregateEquities({
    participants: [
      { id: "hero", knownHoleCards: heroCards },
      ...Array.from({ length: playerCount - 1 }, (_, index) => ({ id: `villain:${index + 1}` })),
    ],
    knownBoard: [],
    deck: fullDeck.filter((card) => !heroCards.some((knownCard) => sameCard(card, knownCard))),
    evaluateGradationFive: evaluator.evaluateGradationFive,
    nsims,
    seed: seedFor(entrySeed(firstCard, secondCard), playerCount, nsims),
  });
}

function compactResult(result, playerCount) {
  const villainIds = Object.keys(result.equities).filter((id) => id !== "hero");
  const villain = villainIds.length
    ? villainIds.reduce((sum, id) => sum + result.equities[id], 0) / villainIds.length
    : 0;
  return {
    hero: result.equities.hero ?? 0,
    villain,
    playerCount,
    nsims: result.nsims,
    exact: result.exact,
  };
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

function entrySeed(firstCard, secondCard) {
  return `${preflopClassKeyForCards(firstCard, secondCard)}:${firstCard.id}:${secondCard.id}`;
}

function seedFor(value, playerCount, nsims) {
  let hash = 2166136261;
  const text = `${value}:${playerCount}:${nsims}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function readCache(key) {
  const response = await fetch(`${apiBase}/api/cache/${encodeURIComponent(key)}`, { cache: "no-store" });
  return response.ok ? response.json() : null;
}

function validatedCacheHit(payload, playerCount) {
  if (!payload) {
    return null;
  }
  try {
    return validateCompactPreflopMultiwayEquityCachePayload(payload, { playerCount });
  } catch {
    return null;
  }
}

async function writeCache(key, value) {
  const response = await fetch(`${apiBase}/api/cache/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: cacheWriteHeaders(),
    body: JSON.stringify(value),
  });
  if (!response.ok) {
    throw new Error(`cache write failed for ${key}: ${response.status}`);
  }
}

function cacheWriteHeaders() {
  return {
    "Content-Type": "application/json",
    ...(cacheWriteToken ? { "X-Essence-Cache-Token": cacheWriteToken } : {}),
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

function logProgress(status, playerCount, classKey, elapsedMs = null) {
  const elapsed = elapsedMs == null ? "" : ` ${elapsedMs}ms`;
  console.log(`${status.padEnd(8)} ${String(playerCount).padStart(1)}p ${classKey.padEnd(16)}${elapsed}`);
}
