#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "dashboard", "data", "prior_win_shares.json");

const keys = execFileSync("redis-cli", ["--scan", "--pattern", "eop:winshare-runouts-v2:hero:preflop:*"], {
  encoding: "utf8",
})
  .trim()
  .split(/\n/)
  .filter(Boolean)
  .sort();

if (keys.length !== 169) {
  throw new Error(`expected 169 cached preflop win-share classes, got ${keys.length}`);
}

const weightedShares = {};
let totalCombos = 0;

for (const redisKey of keys) {
  const classKey = redisKey.split(":").at(-1);
  const payload = JSON.parse(execFileSync("redis-cli", ["get", redisKey], { encoding: "utf8" }));
  const weight = startingHandClassWeight(classKey);
  totalCombos += payload.totalCombos * weight;

  for (const [assetCode, share] of Object.entries(payload.shares)) {
    weightedShares[assetCode] = (weightedShares[assetCode] || 0) + share * payload.totalCombos * weight;
  }
}

const shares = Object.fromEntries(
  Object.entries(weightedShares)
    .map(([assetCode, weightedShare]) => [assetCode, weightedShare / totalCombos])
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true })),
);

fs.writeFileSync(
  outputPath,
  `${JSON.stringify({
    source: "folded-169-preflop-winshare-cache",
    totalCombos,
    shares,
    aggregateMatchups: {
      AGG: 0.5,
      RANGE_AGG: 0.5,
    },
  }, null, 2)}\n`,
  "utf8",
);
console.log(`Wrote ${outputPath} from ${keys.length} cached classes`);

function startingHandClassWeight(classKey) {
  if (classKey.endsWith("-pair")) {
    return 6;
  }
  if (classKey.endsWith("-suited")) {
    return 4;
  }
  if (classKey.endsWith("-offsuit")) {
    return 12;
  }
  throw new Error(`unknown starting-hand class key: ${classKey}`);
}
